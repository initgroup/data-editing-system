"""Exercise preset registration and JOB preparation using actual registry SQL.

An in-memory SQLite adapter replaces the Oracle connection only. Timestamp and
row-lock syntax are adapted; this does not validate Oracle locking behavior.
"""
import copy
import json
import re
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend.database_helper import SqlLoader
from backend.routers import M90002 as registry
from backend.services import data_work_service as jobs
from backend.services import scenario_default_design_service as defaults
from backend.tests.test_mixed_xai_builtin_provisioning import SCOPE
from backend.tests.test_xai_sql_compatibility import schema_columns


class RegistryCursor:
    def __init__(self, connection):
        self.connection = connection
        self.cursor = connection.sqlite.cursor()

    def execute(self, sql, params=None):
        sql_id = next(key for key, value in SqlLoader._query_map.items() if value == sql)
        self.connection.statements.append(sql_id)
        if sql_id == self.connection.fail_sql_id:
            raise RuntimeError("Injected registry write failure")
        adapted = re.sub(r"\s+FOR UPDATE WAIT \d+", "", sql).replace("SYSTIMESTAMP", "CURRENT_TIMESTAMP")
        self.cursor.execute(adapted, params or {})

    @property
    def rowcount(self):
        return self.cursor.rowcount

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        return self.cursor.fetchall()

    def close(self):
        self.cursor.close()
        self.connection.closed_cursors += 1


class RegistryDatabase:
    def __init__(self):
        self.sqlite = sqlite3.connect(":memory:")
        self.sqlite.row_factory = sqlite3.Row
        self.statements = []
        self.fail_sql_id = ""
        self.commits = self.rollbacks = self.closed_connections = self.closed_cursors = 0
        primary_keys = {"INIT$_TB_OML_RESOURCE": "OML_RESOURCE_ID", "INIT$_TB_DATA_WORK_JOB": "WORK_JOB_ID"}
        for table, columns in schema_columns().items():
            if table not in {*primary_keys, "INIT$_TB_OML_RESOURCE_PARAM"}:
                continue
            definitions = [f'"{name}" INTEGER PRIMARY KEY' if name == primary_keys.get(table)
                           else f'"{name}"' for name in columns]
            if table.endswith("RESOURCE"):
                definitions.append('UNIQUE ("RESOURCE_NAME")')
            self.sqlite.execute(f'CREATE TABLE "{table}" (' + ", ".join(definitions) + ")")

    def cursor(self):
        return RegistryCursor(self)

    def commit(self):
        self.commits += 1
        self.sqlite.commit()

    def rollback(self):
        self.rollbacks += 1
        self.sqlite.rollback()

    def close(self):
        self.closed_connections += 1

    def query(self, conn, sql_id, params=None):
        if conn is not self:
            raise AssertionError("Registry connection changed")
        cursor = self.cursor()
        try:
            cursor.execute(SqlLoader.get_sql(sql_id), params)
            return {"status": "success", "data": [dict(row) for row in cursor.fetchall()]}
        finally:
            cursor.close()


class ApiRegistryDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.db = RegistryDatabase()
        self.addCleanup(self.db.sqlite.close)
        self.request = Request({"type": "http", "method": "POST", "path": "/api/M90002/api-object/save", "headers": []})
        path = Path(__file__).resolve().parents[2] / "frontend/config/M90002.python-api-presets.json"
        self.config = json.loads(path.read_text(encoding="utf-8"))
        self.presets = {item["objectName"]: item for group in self.config["groups"]
                        for item in group["resources"]}

    def payload(self, stage, **overrides):
        preset = copy.deepcopy(self.presets[stage["modelName"]])
        output = preset["output"]
        return registry.ApiObjectSaveRequest(
            apiObject={**preset, "resultCreateYn": output["resultCreateYn"],
                       "resultOwner": output["resultOwner"], "resultName": output["resultTableName"], **overrides},
            details=preset["details"], createOnly=True)

    def save(self, payload):
        with patch.object(registry, "get_target_db_connection", return_value=self.db):
            return registry.save_api_object(payload, self.request)

    def rows(self, table):
        return [dict(row) for row in self.db.sqlite.execute(f'SELECT * FROM "{table}"')]

    def test_all_unified_presets_register_and_prepare_linked_jobs_with_distinct_parameter_binds(self):
        for stage in defaults.UNIFIED_STAGES:
            with self.subTest(model=stage["modelName"]):
                saved = self.save(self.payload(stage))
                self.assertTrue(saved["created"])
                self.assertFalse(saved["skipped"])
                with patch.object(defaults, "execute_query", side_effect=self.db.query):
                    job = defaults.build_web_api_job_request(self.db, stage, sort_order=1, **SCOPE)
                self.assertEqual(saved["objectId"], job.execResourceId)
                self.assertEqual(stage["modelName"], job.execMethod)
                self.assertEqual(stage["modelName"], job.execObjectName)
                binds = [param["bindName"] for param in job.params]
                self.assertEqual(len(binds), len(set(binds)))
                self.assertNotIn("IN", binds)
                params = {param["itemName"]: param["itemDefault"] for param in job.params}
                self.assertEqual("HASH", params["P_SAMPLING_STRATEGY"])
                self.assertEqual(":INIT$RunId", params["P_RUN_ID"])
                spec = json.loads(job.execSpecJson)
                self.assertEqual("SERVICE_MANAGED", spec["output"]["persistMode"])
                self.assertNotIn("auth", spec)
        self.assertEqual(4, len(self.rows("INIT$_TB_OML_RESOURCE")))
        self.assertEqual(4, self.db.closed_connections)

    def test_create_only_keeps_existing_disabled_alias_non_python_and_custom_values(self):
        stage = defaults.UNIFIED_STAGES[0]
        first = self.save(self.payload(stage, label="User label", useYn="N"))
        self.db.sqlite.execute('UPDATE "INIT$_TB_OML_RESOURCE" SET RESOURCE_NAME = ?, LANGUAGE = ? WHERE OML_RESOURCE_ID = ?',
                               ("CUSTOM_PROFILE", "SQL", first["objectId"]))
        self.db.sqlite.commit()
        before_resources = self.rows("INIT$_TB_OML_RESOURCE")
        before_params = self.rows("INIT$_TB_OML_RESOURCE_PARAM")
        self.db.statements.clear()
        result = self.save(self.payload(stage, objectId=9999))
        self.assertEqual(first["objectId"], result["objectId"])
        self.assertTrue(result["skipped"])
        self.assertFalse(result["created"])
        self.assertEqual(["M90002_RESOURCE_MATCH"], self.db.statements)
        self.assertEqual(before_resources, self.rows("INIT$_TB_OML_RESOURCE"))
        self.assertEqual(before_params, self.rows("INIT$_TB_OML_RESOURCE_PARAM"))
        self.assertEqual(1, self.db.commits)
        with patch.object(defaults, "execute_query", side_effect=self.db.query):
            with self.assertRaises(HTTPException) as raised:
                defaults.build_web_api_job_request(self.db, stage, sort_order=1, **SCOPE)
        self.assertEqual(409, raised.exception.status_code)

    def test_create_only_is_idempotent_but_explicit_edit_still_updates(self):
        stage = defaults.UNIFIED_STAGES[0]
        first = self.save(self.payload(stage))
        second = self.save(self.payload(stage, label="Must not overwrite"))
        self.assertTrue(second["skipped"])
        edit = self.payload(stage, objectId=first["objectId"], label="Explicit edit", useYn="N")
        edit.createOnly = False
        result = self.save(edit)
        self.assertFalse(result["created"])
        self.assertFalse(result["skipped"])
        row = self.rows("INIT$_TB_OML_RESOURCE")[0]
        self.assertEqual("Explicit edit", row["RESOURCE_LABEL"])
        self.assertEqual("N", row["USE_YN"])
        self.assertEqual(1, len(self.rows("INIT$_TB_OML_RESOURCE")))

    def test_registered_output_owner_is_preserved_in_prepared_job_contract(self):
        stage = defaults.UNIFIED_STAGES[0]
        self.save(self.payload(stage, resultOwner="RESULT_OWNER"))
        with patch.object(defaults, "execute_query", side_effect=self.db.query):
            job = defaults.build_web_api_job_request(self.db, stage, sort_order=1, **SCOPE)
        self.assertEqual("RESULT_OWNER", job.resultOwner)
        self.assertEqual("RESULT_OWNER", json.loads(job.execSpecJson)["output"]["resultOwner"])

    def test_default_registration_and_flow_contracts_match_all_unified_stage_inputs_and_outputs(self):
        contract_path = Path(__file__).resolve().parents[2] / "frontend/config/flow-model-contracts.json"
        contracts = json.loads(contract_path.read_text(encoding="utf-8"))["models"]
        default_names = self.config["defaultObjectNames"]
        self.assertEqual(len(default_names), len(set(default_names)))
        self.assertTrue({"INTEGRATED_RELATION_CLUSTER", "INTEGRATED_RULE_DISCOVER",
                         "INTEGRATED_RULE_VIOLATION_DETECT"} <= set(default_names))
        for index, stage in enumerate(defaults.UNIFIED_STAGES, start=1):
            with self.subTest(model=stage["modelName"]):
                self.assertIn(stage["modelName"], default_names)
                self.save(self.payload(stage))
                with patch.object(defaults, "execute_query", side_effect=self.db.query):
                    request = defaults.build_web_api_job_request(self.db, stage, sort_order=index, **SCOPE)
                contract = contracts[request.execMethod]
                self.assertEqual(index, contract["stage"])
                self.assertEqual("UNIFIED", contract["scenario"])
                self.assertEqual(f"M0300{index}", stage["menuCode"])
                self.assertEqual(stage["resultName"], request.resultTableName)
                self.assertIn(request.resultTableName, {item.get("objectName") for item in contract["outputs"]})
                actual = {item["itemName"]: (item["itemValue"], item["itemDefault"]) for item in request.params}
                builtin = {row["PARAM_NAME"]: (row["DATA_TYPE"], defaults.normalize_default_value(row["DEFAULT_VALUE"], SCOPE["owner_name"]))
                           for row in defaults.load_builtin_api_resource_rows(stage)}
                self.assertEqual(builtin, actual)
                for dependency in contract["inputs"]:
                    condition = dependency.get("requiredWhen")
                    if condition:
                        self.assertEqual(condition["default"], actual[condition["param"]][1])

    def test_registered_job_reload_and_resave_preserve_snapshot_after_registry_changes(self):
        for stage in defaults.UNIFIED_STAGES:
            with self.subTest(model=stage["modelName"]):
                saved = self.save(self.payload(stage))
                with patch.object(defaults, "execute_query", side_effect=self.db.query):
                    request = defaults.build_web_api_job_request(self.db, stage, sort_order=1, **SCOPE)
                request.params[0]["itemDefault"] = "SAVED_USER_OWNER"
                spec = json.loads(request.execSpecJson)
                spec["snapshotNote"] = "Saved user execution contract"
                request.execSpecJson = json.dumps(spec)
                request.useYn = "N"
                job_id = jobs.save_job(self.db, stage["menuCode"], request)
                self.db.commit()
                # A deliberate admin edit changes the same registered resource.
                edited = self.payload(stage, objectId=saved["objectId"], label="Changed registration", useYn="N")
                edited.createOnly = False
                edited.details[0]["defaultValue"] = "NEW_REGISTRY_OWNER"
                self.save(edited)
                self.db.statements.clear()
                with patch.object(defaults, "execute_query", side_effect=self.db.query), \
                     patch.object(jobs, "execute_query", side_effect=self.db.query):
                    restored, created = defaults.ensure_default_job(self.db, stage, **SCOPE)
                    self.assertFalse(created)
                    self.assertEqual(job_id, restored["WORK_JOB_ID"])
                    self.assertEqual(request.execSpecJson, restored["EXEC_SPEC_JSON"])
                    self.assertEqual(request.params, restored["PARAMS"])
                    self.assertEqual("N", restored["USE_YN"])
                    request.profileJobId = job_id
                    request.params = restored["PARAMS"]
                    request.execSpecJson = restored["EXEC_SPEC_JSON"]
                    self.assertEqual(job_id, jobs.save_job(self.db, stage["menuCode"], request))
                    reloaded = jobs.load_job(self.db, stage["menuCode"], job_id)
                self.assertEqual(saved["objectId"], reloaded["EXEC_RESOURCE_ID"])
                self.assertEqual(request.execSpecJson, reloaded["EXEC_SPEC_JSON"])
                self.assertEqual(request.params, reloaded["PARAMS"])
                self.assertEqual(["DATA_WORK_JOB_LIST", "DATA_WORK_JOB_DETAIL", "DATA_WORK_JOB_UPDATE", "DATA_WORK_JOB_DETAIL"],
                                 self.db.statements)

    def test_failed_parameter_registration_rolls_back_the_resource(self):
        self.db.fail_sql_id = "M90002_PARAM_INSERT"
        with self.assertRaises(HTTPException) as raised:
            self.save(self.payload(defaults.UNIFIED_STAGES[0]))
        self.assertEqual(500, raised.exception.status_code)
        self.assertEqual([], self.rows("INIT$_TB_OML_RESOURCE"))
        self.assertEqual([], self.rows("INIT$_TB_OML_RESOURCE_PARAM"))
        self.assertEqual(1, self.db.rollbacks)
        self.assertEqual(1, self.db.closed_cursors)
        self.assertEqual(1, self.db.closed_connections)

    def test_zero_and_false_defaults_and_explicit_bind_names_are_preserved(self):
        rows = registry.normalize_detail_payload([
            {"key": "INPUT.P_ZERO", "defaultValue": 0},
            {"key": "INPUT.P_FALSE", "defaultValue": False},
        ])
        self.assertEqual(["0", "False"], [row["defaultValue"] for row in rows])
        self.assertEqual("customTarget", registry.extract_bind_name("customTarget IN VARCHAR2", "P_TARGET"))
        self.assertEqual("target", registry.extract_bind_name("IN VARCHAR2", "P_TARGET"))


if __name__ == "__main__":
    unittest.main()
