"""Saved API contracts survive the authorized import -> save -> execution path.

Registry/JOB SQL runs in SQLite; model execution and run-log writes are isolated.
No Oracle connection, internal HTTP service, or actual model training is used.
"""
import copy
import json
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend.routers import M90002 as registry
from backend.services import api_call_service as api
from backend.services import data_work_router as work_router
from backend.services import data_work_service as jobs
from backend.services import flow_work_service as flows
from backend.services import integrated_editing_service as integrated
from backend.services import scenario_default_design_service as defaults
from backend.tests.test_api_registry_defaults import RegistryDatabase
from backend.tests.test_mixed_xai_builtin_provisioning import SCOPE
from backend.tests.test_xai_sql_compatibility import schema_columns


class UnifiedJobImportTests(unittest.TestCase):
    def setUp(self):
        self.db = RegistryDatabase()
        self.addCleanup(self.db.sqlite.close)
        columns = schema_columns()["INIT$_TB_PROJECT"]
        self.db.sqlite.execute('CREATE TABLE "INIT$_TB_PROJECT" (' + ", ".join(f'"{column}"' for column in columns) + ")")
        self.db.sqlite.execute('INSERT INTO "INIT$_TB_PROJECT" (PROJECT_ID, USER_ID) VALUES (11, 7)')
        self.db.commit()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for module in (defaults, jobs):
            self.stack.enter_context(patch.object(module, "execute_query", side_effect=self.db.query))
        for module in (registry, work_router):
            self.stack.enter_context(patch.object(module, "get_target_db_connection", return_value=self.db))
        self.routes = {
            stage["menuCode"]: {route.path: route.endpoint for route in work_router.create_data_work_router(stage["menuCode"], stage["menuCode"]).routes}
            for stage in defaults.UNIFIED_STAGES
        }
        path = Path(__file__).resolve().parents[2] / "frontend/config/M90002.python-api-presets.json"
        self.presets = {item["objectName"]: item for group in json.loads(path.read_text(encoding="utf-8"))["groups"]
                        for item in group["resources"]}

    def request(self, user_id=7, role="USER"):
        request = Request({"type": "http", "method": "GET", "path": "/import-jobs/1",
                           "headers": [(b"x-login-user-id", b"7"), (b"x-login-role", b"ADMIN")]})
        if user_id:
            request.state.auth_user = {"userId": user_id, "roleCode": role}
        return request

    def source(self, stage, registered=False):
        if registered:
            preset = copy.deepcopy(self.presets[stage["modelName"]])
            registry.save_api_object(registry.ApiObjectSaveRequest(
                apiObject={**preset, "resultCreateYn": "T", "resultOwner": ":INIT$TargetOwner",
                           "resultName": stage["resultName"]}, details=preset["details"], createOnly=True), self.request())
        request = defaults.build_web_api_job_request(self.db, stage, sort_order=1, **SCOPE)
        request.params.append({"itemName": "P_USER_TUNING", "itemDefault": "preserved", "itemOrder": 999})
        return self.routes[stage["menuCode"]]["/job/save"](request, self.request())["data"]

    def import_source(self, stage, source, request=None, **scope):
        return self.routes[stage["menuCode"]]["/import-jobs/{profile_job_id}"](
            source["WORK_JOB_ID"], request or self.request(),
            projectId=scope.get("project_id", 11), scenarioId=scope.get("scenario_id", 22))["data"]

    def copy_request(self, imported):
        return jobs.DataWorkRunJobRequest(
            projectId=11, scenarioId=23, scenarioTableId=44,
            jobName="Imported unified JOB", ownerName="APP_OWNER", tableName="INITUP$DESTINATION",
            execSourceType=imported["EXEC_SOURCE_TYPE"], execResourceId=imported["EXEC_RESOURCE_ID"],
            execMethod=imported["EXEC_METHOD"], execSpecJson=imported["EXEC_SPEC_JSON"],
            execObjectType=imported["EXEC_OBJECT_TYPE"], execObjectName=imported["EXEC_OBJECT_NAME"],
            execObjectLabel=imported["EXEC_OBJECT_LABEL"], execPlsql=imported["EXEC_PLSQL"],
            params=imported["PARAMS"], resultCreateYn=imported["RESULT_CREATE_YN"],
            resultOwner=imported["RESULT_OWNER"], resultTableName=imported["RESULT_TABLE_NAME"],
            runtimeBindValues={"INIT$RunId": 812})

    def test_builtin_import_save_test_run_and_flow_keep_each_stage_contract(self):
        for stage in defaults.UNIFIED_STAGES:
            with self.subTest(stage=stage["modelName"]):
                source = self.source(stage)
                imported = self.import_source(stage, source)
                self.assertEqual(source["EXEC_SPEC_JSON"], imported["EXEC_SPEC_JSON"])
                self.assertIsNone(imported["EXEC_RESOURCE_ID"])
                self.assertFalse({"WORK_JOB_ID", "PROFILE_JOB_ID", "PROJECT_ID", "SCENARIO_ID", "SCENARIO_TABLE_ID"} & imported.keys())
                copied_request = self.copy_request(imported)
                copied = self.routes[stage["menuCode"]]["/job/save"](copied_request, self.request())["data"]
                self.assertNotEqual(source["WORK_JOB_ID"], copied["WORK_JOB_ID"])
                self.assertEqual(source["EXEC_SPEC_JSON"], copied["EXEC_SPEC_JSON"])
                self.assertEqual(source["PARAMS"], copied["PARAMS"])
                self.assertEqual(source["EXEC_PLSQL"], copied["EXEC_PLSQL"])
                copied_request.profileJobId = copied["WORK_JOB_ID"]
                self.db.statements.clear()
                with patch.object(integrated, "execute", return_value={"status": "success"}) as execute, \
                     patch.object(api, "call_http_json_api", side_effect=AssertionError("Unexpected HTTP execution")), \
                     patch.object(jobs, "create_run", return_value=912), \
                     patch.object(jobs, "update_run"), patch.object(jobs, "update_job_status"):
                    for endpoint in ("/job/test-draft", "/job/run"):
                        result = self.routes[stage["menuCode"]][endpoint](copied_request, self.request())
                        self.assertEqual("success", result["status"])
                        payload = execute.call_args.args[2]
                        self.assertEqual(("INITUP$DESTINATION", "DATA_WORK", 812, "preserved"),
                                         tuple(payload[key] for key in ("P_TARGET_TABLE", "P_RUN_SOURCE_TYPE", "P_RUN_ID", "P_USER_TUNING")))
                    flow_result = flows.execute_flow_node(self.db, {
                        "nodeType": stage["menuCode"], "refMenuCode": stage["menuCode"],
                        "refWorkJobId": copied["WORK_JOB_ID"], "nodePayload": {},
                    }, {"INIT$TargetOwner": "APP_OWNER", "INIT$TargetTable": "INITUP$DESTINATION", "INIT$RunSourceType": "FLOW_WORK", "INIT$RunId": 813})
                    self.assertEqual("SUCCESS", flow_result["status"])
                    self.assertEqual("FLOW_WORK", execute.call_args.args[2]["P_RUN_SOURCE_TYPE"])
                    self.assertEqual(813, execute.call_args.args[2]["P_RUN_ID"])
                    self.assertEqual(3, execute.call_count)
                    self.assertTrue(all(call.args[1] == stage["modelName"] for call in execute.call_args_list))
                self.assertTrue(all(sql_id == "DATA_WORK_JOB_DETAIL" for sql_id in self.db.statements))
                self.assertEqual(source["EXEC_SPEC_JSON"], jobs.load_job(self.db, stage["menuCode"], source["WORK_JOB_ID"])["EXEC_SPEC_JSON"])

    def test_registered_import_keeps_resource_link_and_snapshot_without_registry_refresh(self):
        for stage in defaults.UNIFIED_STAGES:
            with self.subTest(stage=stage["modelName"]):
                source = self.source(stage, registered=True)
                self.db.sqlite.execute('UPDATE "INIT$_TB_OML_RESOURCE" SET USE_YN = ?, SPEC_JSON = ? WHERE OML_RESOURCE_ID = ?',
                                       ("N", '{"changed":true}', source["EXEC_RESOURCE_ID"]))
                self.db.commit()
                self.db.statements.clear()
                imported = self.import_source(stage, source)
                self.assertEqual(["DATA_WORK_IMPORT_JOB_DETAIL"], self.db.statements)
                copied = self.routes[stage["menuCode"]]["/job/save"](self.copy_request(imported), self.request())["data"]
                self.assertEqual(source["EXEC_RESOURCE_ID"], copied["EXEC_RESOURCE_ID"])
                self.assertEqual(source["EXEC_SPEC_JSON"], copied["EXEC_SPEC_JSON"])
                self.assertEqual(source["PARAMS"], copied["PARAMS"])

    def test_import_route_enforces_server_user_and_source_scope(self):
        stage = defaults.UNIFIED_STAGES[0]
        source = self.source(stage)
        for request, scope, expected_status in (
            (self.request(user_id=None), {}, 401),
            (self.request(user_id=8), {}, 404),
            (self.request(), {"project_id": 12}, 404),
            (self.request(), {"scenario_id": 23}, 404),
        ):
            with self.subTest(status=expected_status, scope=scope), self.assertRaises(HTTPException) as raised:
                self.import_source(stage, source, request, **scope)
            self.assertEqual(expected_status, raised.exception.status_code)
        self.assertEqual(source["EXEC_SPEC_JSON"], self.import_source(stage, source, self.request(user_id=8, role="ADMIN"))["EXEC_SPEC_JSON"])

    def test_full_registered_spec_and_generated_preview_survive_save_import_and_draft(self):
        stage = defaults.UNIFIED_STAGES[2]
        source = self.source(stage, registered=True)
        registered_spec = self.db.sqlite.execute('SELECT SPEC_JSON FROM "INIT$_TB_OML_RESOURCE" WHERE OML_RESOURCE_ID = ?',
                                                 (source["EXEC_RESOURCE_ID"],)).fetchone()[0]
        request = self.copy_request(source)
        request.execSpecJson = registered_spec
        request.execPlsql = json.dumps({"type": "WEB_API", "method": source["EXEC_METHOD"], "parameters": request.params})
        self.assertGreater(len(request.execSpecJson), 4000)
        self.assertGreater(len(request.execPlsql), 4000)
        saved = self.routes[stage["menuCode"]]["/job/save"](request, self.request())["data"]
        imported = self.import_source(stage, saved, scenario_id=23)
        self.assertEqual(registered_spec, imported["EXEC_SPEC_JSON"])
        self.assertEqual(request.execPlsql, imported["EXEC_PLSQL"])
        request.profileJobId = saved["WORK_JOB_ID"]
        draft = jobs.build_draft_job(self.db, stage["menuCode"], request, saved)
        self.assertEqual(registered_spec, draft["EXEC_SPEC_JSON"])
        self.assertEqual(request.execPlsql, draft["EXEC_PLSQL"])
        self.assertEqual(json.loads(registered_spec), json.loads(draft["EXEC_SPEC_JSON"]))

    def test_flow_import_preserves_scenario_type_but_requires_rebinding_each_job_node(self):
        for flow_type in ("UNIFIED_EDITING_SCENARIO", "MIXED_XAI_SCENARIO", "RULE_DISCOVERY"):
            source = {"FLOW_NAME": "Imported flow", "FLOW_TYPE": flow_type, "NODES": [
                {"nodeType": stage["menuCode"], "refMenuCode": stage["menuCode"], "refWorkJobId": index,
                 "params": [{"itemName": "P_WORK_JOB_ID", "itemDefault": index}, {"itemName": "P_SAMPLE_ROWS", "itemDefault": "1234"}]}
                for index, stage in enumerate(defaults.UNIFIED_STAGES, start=1)], "EDGES": []}
            with patch.object(flows, "execute_query", return_value={"status": "success", "data": [{"FLOW_ID": 1}]}), \
                 patch.object(flows, "load_flow", return_value=source):
                imported = flows.load_importable_flow(self.db, "M04001", 1, 11, 22, 7, False)
            self.assertEqual(flow_type, imported["FLOW_TYPE"])
            for node in imported["NODES"]:
                self.assertIsNone(node["refWorkJobId"])
                self.assertEqual([{"itemName": "P_SAMPLE_ROWS", "itemDefault": "1234"}], node["params"])
                with self.assertRaises(HTTPException) as raised:
                    flows.execute_flow_node(self.db, node)
                self.assertEqual(400, raised.exception.status_code)
                self.assertIn("saved work job", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
