"""Provision real saved jobs from built-in mixed presets without a registry row.

Only database reads/writes and model execution are replaced. Request construction,
job validation/save/load, parameter binding and internal dispatch remain real.
"""
import copy
import json
import re
import sqlite3
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend.database_helper import SqlLoader
from backend.routers import M02002 as scenario_router
from backend.services import api_call_service as api
from backend.services import data_work_service as jobs
from backend.services import scenario_default_design_service as defaults
from backend.tests.test_xai_sql_compatibility import schema_columns


SCOPE = {"project_id": 11, "scenario_id": 22, "scenario_table_id": 33,
         "owner_name": "APP_OWNER", "table_name": "INITUP$SOURCE"}


def database_key(name):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection
        self.next_row = None

    def execute(self, sql, params=None):
        sql_id = next((key for key in ("DATA_WORK_JOB_INSERT", "DATA_WORK_JOB_ID_LATEST", "M02002_SCENARIO_TABLE_LOCK") if SqlLoader.get_sql(key) == sql), None)
        if sql_id is None:
            raise AssertionError("Unexpected SQL mutation during built-in provisioning")
        params = params or {}
        expected = set(re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql))
        if set(params) != expected:
            raise AssertionError(f"Saved-job bind mismatch for {sql_id}")
        if sql_id == "M02002_SCENARIO_TABLE_LOCK":
            self.connection.reads.append((sql_id, copy.deepcopy(params)))
            self.next_row = (params["scenarioTableId"], "APP_OWNER", "INITUP$SOURCE", "APP_OWNER", "INITDN$SOURCE")
            return
        self.connection.writes.append((sql_id, copy.deepcopy(params)))
        if sql_id == "DATA_WORK_JOB_INSERT":
            job_id = len(self.connection.stored) + 101
            record = {database_key(key): value for key, value in params.items()}
            record.update(WORK_JOB_ID=job_id, PROFILE_JOB_ID=job_id)
            self.connection.stored.append(record)
        else:
            matching = [row for row in self.connection.stored
                        if all(row[database_key(key)] == value for key, value in params.items())]
            self.next_row = (matching[-1]["WORK_JOB_ID"],) if matching else None

    def fetchone(self):
        return self.next_row

    def close(self):
        self.connection.closed_cursors += 1


class RecordingDatabase:
    def __init__(self):
        self.resources, self.matches, self.details = [], {}, {}
        self.stored, self.reads, self.writes = [], [], []
        self.closed_cursors = 0
        self.commits = self.rollbacks = self.closed_connections = 0
        self.committed = []

    def cursor(self):
        return RecordingCursor(self)

    def commit(self):
        self.commits += 1
        self.committed = copy.deepcopy(self.stored)

    def rollback(self):
        self.rollbacks += 1
        self.stored = copy.deepcopy(self.committed)

    def close(self):
        self.closed_connections += 1

    def query(self, conn, sql_id, params=None):
        if conn is not self:
            raise AssertionError("Target connection was replaced during provisioning")
        params = params or {}
        self.reads.append((sql_id, copy.deepcopy(params)))
        if sql_id == "DATA_WORK_OML_RESOURCE_LIST":
            rows = self.resources
        elif sql_id == "DATA_WORK_OML_RESOURCE_MATCH":
            if set(params) != {"modelName"}:
                raise AssertionError("Registry collision check must bind the exact model name")
            rows = self.matches.get(params["modelName"], [])
        elif sql_id == "DATA_WORK_OML_RESOURCE_DETAIL":
            rows = self.details.get(params["resourceId"], [])
        elif sql_id == "DATA_WORK_JOB_LIST":
            rows = [row for row in self.stored if row["MENU_CODE"] == params["menuCode"]
                    and row["PROJECT_ID"] == params["projectId"] and row["SCENARIO_ID"] == params["scenarioId"]]
        elif sql_id == "DATA_WORK_JOB_DETAIL":
            rows = [row for row in self.stored if row["MENU_CODE"] == params["menuCode"] and row["PROFILE_JOB_ID"] == params["profileJobId"]]
        else:
            raise AssertionError(f"Unexpected registry or job SQL: {sql_id}")
        return {"status": "success", "data": copy.deepcopy(rows)}


class MixedXaiBuiltinProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.db = RecordingDatabase()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(defaults, "execute_query", side_effect=self.db.query))
        self.stack.enter_context(patch.object(jobs, "execute_query", side_effect=self.db.query))

    def request(self, stage):
        return defaults.build_web_api_job_request(self.db, stage, sort_order=1, **SCOPE)

    def ensure(self, stage, **scope):
        return defaults.ensure_default_job(self.db, stage, **{**SCOPE, **scope})

    def test_all_four_missing_resources_build_safe_builtin_requests(self):
        for stage in defaults.MIXED_XAI_STAGES:
            with self.subTest(model=stage["modelName"]):
                request = self.request(stage)
                self.assertEqual(request.execSourceType, "WEB_API")
                self.assertIsNone(request.execResourceId)
                self.assertEqual(request.execMethod, stage["modelName"])
                self.assertEqual(request.execObjectName, stage["modelName"])
                self.assertEqual(request.resultOwner, "APP_OWNER")
                self.assertEqual(request.resultTableName, stage["resultName"])
                self.assertEqual((request.projectId, request.scenarioId, request.scenarioTableId), (11, 22, 33))
                spec = json.loads(request.execSpecJson)
                self.assertEqual(spec["adapter"], "INTERNAL_PYTHON_API")
                self.assertEqual(spec["output"]["persistMode"], "SERVICE_MANAGED")
                self.assertTrue(spec["endpoint"].startswith("/api/mlAnalysis/mixed-xai-"))
                self.assertEqual(spec["method"], stage["modelName"])
                self.assertNotIn("auth", spec)
                names = {param["itemName"] for param in request.params}
                self.assertTrue({"P_TARGET_OWNER", "P_TARGET_TABLE", "P_RUN_SOURCE_TYPE", "P_RUN_ID"} <= names)
                self.assertTrue(all(name.startswith("P_") for name in names))
                self.assertFalse(any(name.startswith(("INPUT.", "OUTPUT.", "AUTH.")) for name in names))
                self.assertNotIn("INIT_INTERNAL_API_KEY", request.execSpecJson)
        matches = [params["modelName"] for sql_id, params in self.db.reads if sql_id == "DATA_WORK_OML_RESOURCE_MATCH"]
        self.assertEqual(matches, [stage["modelName"] for stage in defaults.MIXED_XAI_STAGES])
        self.assertEqual(self.db.writes, [])

    def test_save_reload_and_retry_are_idempotent_without_global_registration(self):
        for stage in defaults.MIXED_XAI_STAGES:
            first, created = self.ensure(stage)
            self.assertTrue(created)
            self.assertIsNone(first["EXEC_RESOURCE_ID"])
            self.assertEqual(first["EXEC_METHOD"], stage["modelName"])
            self.assertTrue(first["PARAMS"])
            reads_before_retry = len(self.db.reads)
            second, created = self.ensure(stage)
            self.assertFalse(created)
            self.assertEqual(first["WORK_JOB_ID"], second["WORK_JOB_ID"])
            self.assertEqual(first["EXEC_SPEC_JSON"], second["EXEC_SPEC_JSON"])
            retry_sql = [sql_id for sql_id, _ in self.db.reads[reads_before_retry:]]
            self.assertEqual(retry_sql, ["DATA_WORK_JOB_LIST", "DATA_WORK_JOB_DETAIL"])
        self.assertEqual(len(self.db.stored), 4)
        self.assertEqual(sum(sql_id == "DATA_WORK_JOB_INSERT" for sql_id, _ in self.db.writes), 4)
        self.assertTrue(all(sql_id in {"DATA_WORK_JOB_INSERT", "DATA_WORK_JOB_ID_LATEST"} for sql_id, _ in self.db.writes))

    def test_saved_builtin_jobs_bind_actual_run_scope_and_dispatch_locally(self):
        functions = {"MIXED_XAI_PROFILE": "backend.services.mixed_analysis_profile_service.profile",
                     "MIXED_XAI_RELATION": "backend.services.mixed_analysis_profile_service.relationships",
                     "MIXED_XAI_RULE_DISCOVER": "backend.services.mixed_xai_service.discover",
                     "MIXED_XAI_RULE_DETECT": "backend.services.mixed_xai_service.detect"}
        runtime = {"INIT$TargetOwner": "APP_OWNER", "INIT$TargetTable": "INITUP$SOURCE", "INIT$RunSourceType": "FLOW_WORK", "INIT$RunId": 721}
        for stage in defaults.MIXED_XAI_STAGES:
            with self.subTest(model=stage["modelName"]):
                saved, _ = self.ensure(stage)
                with patch(functions[stage["modelName"]], return_value={"status": "success", "algorithm": "MIXED_PATTERN_TREE", "ruleCount": 2}) as model, \
                        patch.object(api, "call_http_json_api", side_effect=AssertionError("A built-in model must not call HTTP")):
                    result = api.execute_api_job(self.db, saved, runtime_values=runtime, run_id=721, include_result=True)
                model.assert_called_once()
                self.assertIs(model.call_args.args[0], self.db)
                payload = model.call_args.args[1]
                self.assertEqual(payload["P_TARGET_OWNER"], "APP_OWNER")
                self.assertEqual(payload["P_TARGET_TABLE"], "INITUP$SOURCE")
                self.assertEqual(payload["P_RUN_SOURCE_TYPE"], "FLOW_WORK")
                self.assertEqual(payload["P_RUN_ID"], 721)
                self.assertFalse(any(str(key).startswith(("OUTPUT.", "AUTH.")) for key in payload))
                self.assertEqual(result["result"]["status"], "success")

    def test_active_registered_custom_resource_is_preserved_instead_of_builtin(self):
        stage = defaults.MIXED_XAI_STAGES[0]
        self.db.resources = [{"OML_RESOURCE_ID": 901, "RESOURCE_NAME": "CUSTOM_PROFILE", "EXEC_METHOD": stage["modelName"]}]
        spec = {"adapter": "INTERNAL_PYTHON_API", "endpoint": "/api/mlAnalysis/custom-profile", "apiRegistryVersion": 2,
                "output": {"resultCreateYn": "T", "resultTableName": "CUSTOM_PROFILE_RESULT", "resultOwner": "CUSTOM_OWNER", "persistMode": "SERVICE_MANAGED"}}
        self.db.details[901] = [{"RESOURCE_NAME": "CUSTOM_PROFILE", "RESOURCE_LABEL": "Registered custom profile",
            "EXEC_METHOD": stage["modelName"], "SPEC_JSON": json.dumps(spec), "PARAM_NAME": "P_SAMPLE_ROWS", "DATA_TYPE": "IN NUMBER",
            "DEFAULT_VALUE": "1234", "PARAM_DESC": "Custom setting", "ITEM_ORDER": 1, "BIND_NAME": "P_SAMPLE_ROWS"}]
        request = self.request(stage)
        self.assertEqual(request.execResourceId, 901)
        self.assertEqual(request.execObjectName, "CUSTOM_PROFILE")
        self.assertEqual(request.execObjectLabel, "Registered custom profile")
        self.assertEqual(request.resultTableName, "CUSTOM_PROFILE_RESULT")
        self.assertEqual(request.resultOwner, "CUSTOM_OWNER")
        self.assertEqual(request.params[0]["itemDefault"], "1234")
        self.assertEqual(json.loads(request.execSpecJson)["endpoint"], "/api/mlAnalysis/custom-profile")
        self.assertFalse(any(sql_id == "DATA_WORK_OML_RESOURCE_MATCH" for sql_id, _ in self.db.reads))

    def test_explicitly_inactive_or_non_python_registration_is_not_bypassed(self):
        stage = defaults.MIXED_XAI_STAGES[0]
        for registered in ({"RESOURCE_NAME": stage["modelName"], "USE_YN": "N", "LANGUAGE": "PYTHON"},
                           {"EXEC_METHOD": stage["modelName"], "USE_YN": "Y", "LANGUAGE": "SQL"},
                           {"SCRIPT_NAME": stage["modelName"], "STATUS": "DISABLED"}):
            with self.subTest(registered=registered):
                self.db.matches[stage["modelName"]] = [registered]
                with self.assertRaises(HTTPException) as raised:
                    self.request(stage)
                self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.db.writes, [])

    def test_legacy_unknown_and_wrong_stage_models_still_require_registration(self):
        legacy = next(stage for stage in defaults.DEFAULT_STAGES if stage["sourceType"] == "WEB_API")
        unsupported = {**defaults.MIXED_XAI_STAGES[0], "modelName": "MIXED_XAI_UNKNOWN"}
        wrong_stage = {**defaults.MIXED_XAI_STAGES[0], "menuCode": "M03004"}
        for stage in (legacy, unsupported, wrong_stage):
            with self.subTest(model=stage["modelName"], menu=stage["menuCode"]), self.assertRaises(HTTPException) as raised:
                self.request(stage)
            self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.db.writes, [])

    def test_existing_job_customization_survives_retry_and_other_table_is_separate(self):
        stage = defaults.MIXED_XAI_STAGES[0]
        first, _ = self.ensure(stage)
        self.db.stored[0]["EXEC_SPEC_JSON"] = json.dumps({"method": stage["modelName"], "note": "User configured"})
        self.db.stored[0]["PARAM_JSON"] = json.dumps([{"itemName": "P_SAMPLE_ROWS", "itemDefault": "999"}])
        restored, created = self.ensure(stage)
        self.assertFalse(created)
        self.assertEqual(json.loads(restored["EXEC_SPEC_JSON"])["note"], "User configured")
        self.assertEqual(restored["PARAMS"][0]["itemDefault"], "999")
        second, created = self.ensure(stage, scenario_table_id=44, table_name="INITUP$OTHER")
        self.assertTrue(created)
        self.assertNotEqual(first["WORK_JOB_ID"], second["WORK_JOB_ID"])
        self.assertEqual(second["SCENARIO_TABLE_ID"], 44)
        self.assertEqual(second["TABLE_NAME"], "INITUP$OTHER")

    def test_registry_collision_sql_resolves_installation_columns_and_all_registration_states(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        columns = schema_columns()["INIT$_TB_OML_RESOURCE"]
        conn.execute('CREATE TABLE "INIT$_TB_OML_RESOURCE" (' + ", ".join('"' + name + '"' for name in columns) + ')')
        records = [(1, " mixed_xai_profile ", "OTHER", "OTHER", "PYTHON", "N"),
                   (2, "CUSTOM", "mixed_xai_profile", "OTHER", "SQL", "Y"),
                   (3, "CUSTOM_SCRIPT", "OTHER", " MIXED_XAI_PROFILE ", "R", "N"),
                   (4, "MIXED_XAI_RELATION", "MIXED_XAI_RELATION", "OTHER", "PYTHON", "Y")]
        conn.executemany('INSERT INTO "INIT$_TB_OML_RESOURCE" (OML_RESOURCE_ID, RESOURCE_NAME, EXEC_METHOD, SCRIPT_NAME, LANGUAGE, USE_YN) VALUES (?, ?, ?, ?, ?, ?)', records)
        matches = conn.execute(SqlLoader.get_sql("DATA_WORK_OML_RESOURCE_MATCH"), {"modelName": "MIXED_XAI_PROFILE"}).fetchall()
        self.assertEqual({row[0] for row in matches}, {1, 2, 3})
        active_python = conn.execute(SqlLoader.get_sql("DATA_WORK_OML_RESOURCE_LIST")).fetchall()
        self.assertEqual([row[0] for row in active_python], [4])
        self.assertEqual(conn.execute(SqlLoader.get_sql("DATA_WORK_OML_RESOURCE_MATCH"),
                                      {"modelName": "MIXED_XAI_PROFILE' OR 1=1 --"}).fetchall(), [])

    def test_missing_preset_file_fails_before_a_job_is_saved(self):
        with patch.object(defaults.Path, "read_text", side_effect=FileNotFoundError("fixture missing")):
            with self.assertRaises(HTTPException) as raised:
                self.ensure(defaults.MIXED_XAI_STAGES[0])
        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("M90002.python-api-presets.json", raised.exception.detail)
        self.assertEqual(self.db.writes, [])

    def test_partial_upgrade_keeps_registered_rule_models_and_builds_valid_four_stage_graph(self):
        for resource_id, stage, parameter, value in (
            (951, defaults.MIXED_XAI_STAGES[2], "P_MIN_CONFIDENCE", "0.975"),
            (952, defaults.MIXED_XAI_STAGES[3], "P_MAX_VIOLATION_ROWS", "222"),
        ):
            self.db.resources.append({"OML_RESOURCE_ID": resource_id, "RESOURCE_NAME": f"CUSTOM_{resource_id}", "EXEC_METHOD": stage["modelName"]})
            spec = {"adapter": "INTERNAL_PYTHON_API", "endpoint": f"/api/mlAnalysis/custom-{resource_id}",
                    "output": {"resultCreateYn": "T", "resultTableName": stage["resultName"], "persistMode": "SERVICE_MANAGED"}}
            self.db.details[resource_id] = [{"RESOURCE_NAME": f"CUSTOM_{resource_id}", "RESOURCE_LABEL": f"Custom resource {resource_id}",
                "EXEC_METHOD": stage["modelName"], "SPEC_JSON": json.dumps(spec), "PARAM_NAME": parameter,
                "DATA_TYPE": "NUMBER", "DEFAULT_VALUE": value, "ITEM_ORDER": 1, "BIND_NAME": parameter}]
        saved = [self.ensure(stage)[0] for stage in defaults.MIXED_XAI_STAGES]
        self.assertEqual([job["EXEC_RESOURCE_ID"] for job in saved], [None, None, 951, 952])
        self.assertEqual(saved[2]["PARAMS"][0]["itemDefault"], "0.975")
        self.assertEqual(saved[3]["PARAMS"][0]["itemDefault"], "222")
        self.assertEqual(json.loads(saved[2]["EXEC_SPEC_JSON"])["endpoint"], "/api/mlAnalysis/custom-951")
        self.assertEqual(saved[3]["EXEC_OBJECT_NAME"], "CUSTOM_952")
        checked_missing = [params["modelName"] for sql_id, params in self.db.reads if sql_id == "DATA_WORK_OML_RESOURCE_MATCH"]
        self.assertEqual(checked_missing, ["MIXED_XAI_PROFILE", "MIXED_XAI_RELATION"])
        nodes, edges = defaults.build_sample_flow_graph(saved)
        flow = defaults.flow_work
        clean_nodes, clean_edges = flow.normalize_graph([flow.FlowNodeRequest(**node) for node in nodes],
                                                        [flow.FlowEdgeRequest(**edge) for edge in edges])
        validation = flow.validate_graph(clean_nodes, clean_edges)
        self.assertEqual(validation["status"], "success", validation)
        self.assertEqual([node["nodeType"] for node in nodes], ["M03001", "M03002", "M03003", "M03004"])
        self.assertEqual([edge["params"]["artifact"] for edge in edges], ["MIXED_XAI_PROFILE", "MIXED_XAI_RELATION", "MIXED_XAI_RULES"])

    def invoke_provision_route(self, *, access_error=None):
        request = Request({"type": "http", "method": "POST", "path": "/api/M02002/scenario-table/provision-default-design", "headers": []})
        request.state.authenticated_user_id = 7

        def check_access(cursor, current_request, project_id, scenario_id):
            self.assertIs(cursor.connection, self.db)
            self.assertIs(current_request, request)
            self.assertEqual(current_request.state.authenticated_user_id, 7)
            self.assertEqual((project_id, scenario_id), (11, 22))
            self.assertEqual(self.db.reads, [])
            self.assertEqual(self.db.writes, [])
            if access_error:
                raise access_error

        access = self.stack.enter_context(patch.object(scenario_router, "require_project_scenario_access", side_effect=check_access))
        self.stack.enter_context(patch.object(scenario_router, "get_target_db_connection", return_value=self.db))
        flow = self.stack.enter_context(patch.object(defaults, "ensure_default_flow", return_value=({"FLOW_ID": 551, "FLOW_NAME": "Mixed flow"}, True)))
        req = scenario_router.ScenarioDefaultDesignRequest(projectId=11, scenarioId=22, scenarioTableId=33, processType="MIXED_XAI")
        return request, req, access, flow

    def test_authenticated_provision_route_commits_only_after_all_four_jobs_and_flow(self):
        request, req, access, flow = self.invoke_provision_route()
        result = scenario_router.provision_scenario_default_design(req, request)
        access.assert_called_once()
        flow.assert_called_once()
        self.assertEqual(len(flow.call_args.kwargs["jobs"]), 4)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["automation"]["jobIds"], [101, 102, 103, 104])
        self.assertEqual((self.db.commits, self.db.rollbacks, self.db.closed_connections), (1, 0, 1))
        self.assertEqual(len(self.db.committed), 4)
        self.assertEqual(self.db.closed_cursors, 6)  # Access check, table lock, four inserts.

    def test_authenticated_provision_route_rolls_back_earlier_jobs_if_third_model_fails(self):
        self.db.matches["MIXED_XAI_RULE_DISCOVER"] = [{"RESOURCE_NAME": "MIXED_XAI_RULE_DISCOVER", "USE_YN": "N", "LANGUAGE": "PYTHON"}]
        request, req, access, flow = self.invoke_provision_route()
        with self.assertRaises(HTTPException) as raised:
            scenario_router.provision_scenario_default_design(req, request)
        self.assertEqual(raised.exception.status_code, 409)
        access.assert_called_once()
        flow.assert_not_called()
        self.assertEqual(sum(sql_id == "DATA_WORK_JOB_INSERT" for sql_id, _ in self.db.writes), 2)
        self.assertEqual((self.db.commits, self.db.rollbacks, self.db.closed_connections), (0, 1, 1))
        self.assertEqual(self.db.stored, [])
        self.assertEqual(self.db.committed, [])
        self.assertEqual(self.db.closed_cursors, 4)

    def test_provision_route_access_denial_closes_connection_before_preparing_models(self):
        request, req, access, flow = self.invoke_provision_route(access_error=HTTPException(404, "Project not accessible"))
        with self.assertRaises(HTTPException) as raised:
            scenario_router.provision_scenario_default_design(req, request)
        self.assertEqual(raised.exception.status_code, 404)
        access.assert_called_once()
        flow.assert_not_called()
        self.assertEqual(self.db.reads, [])
        self.assertEqual(self.db.writes, [])
        self.assertEqual((self.db.commits, self.db.rollbacks, self.db.closed_connections), (0, 1, 1))
        self.assertEqual(self.db.closed_cursors, 1)


if __name__ == "__main__":
    unittest.main()
