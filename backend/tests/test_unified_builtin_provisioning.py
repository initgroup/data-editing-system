"""Real UNIFIED preset -> save/reload -> graph -> dispatch upgrade contracts.

Only database/execution boundaries are substituted; no Oracle or network access.
"""
import json
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend.routers import M02002 as scenario_router
from backend.services import api_call_service as api
from backend.services import data_work_service as jobs
from backend.services import flow_work_service as flows
from backend.services import integrated_editing_service as integrated
from backend.services import scenario_default_design_service as defaults
from backend.services.flow_work_router import normalize_quick_edit_summary
from backend.tests.test_mixed_xai_builtin_provisioning import RecordingDatabase, SCOPE


class UnifiedBuiltinProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.db = RecordingDatabase()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(defaults, "execute_query", side_effect=self.db.query))
        self.stack.enter_context(patch.object(jobs, "execute_query", side_effect=self.db.query))

    def ensure(self, stage):
        return defaults.ensure_default_job(self.db, stage, **SCOPE)

    def saved(self):
        return [self.ensure(stage)[0] for stage in defaults.UNIFIED_STAGES]

    def clean_graph(self, saved):
        nodes, edges = defaults.build_sample_flow_graph(saved)
        clean_nodes, clean_edges = flows.normalize_graph(
            [flows.FlowNodeRequest(**node) for node in nodes],
            [flows.FlowEdgeRequest(**edge) for edge in edges])
        validation = flows.validate_graph(clean_nodes, clean_edges)
        self.assertEqual("success", validation["status"], validation)
        return nodes, edges

    def test_missing_resources_snapshot_safe_builtins_and_validate_actual_four_stage_graph(self):
        saved = self.saved()
        self.assertEqual(4, len(saved))
        for stage, job in zip(defaults.UNIFIED_STAGES, saved):
            with self.subTest(stage=stage["modelName"]):
                self.assertIsNone(job["EXEC_RESOURCE_ID"])
                self.assertEqual(stage["modelName"], job["EXEC_METHOD"])
                spec = json.loads(job["EXEC_SPEC_JSON"])
                self.assertEqual("INTERNAL_PYTHON_API", spec["adapter"])
                self.assertEqual("SERVICE_MANAGED", spec["output"]["persistMode"])
                self.assertEqual(stage["resultName"], spec["output"]["resultTableName"])
                self.assertEqual("/api/mlAnalysis/" + stage["modelName"].lower().replace("_", "-"), spec["endpoint"])
                self.assertNotIn("auth", spec)
                self.assertNotIn("INIT_INTERNAL_API_KEY", job["EXEC_SPEC_JSON"])
                params = {item["itemName"]: item["itemDefault"] for item in job["PARAMS"]}
                self.assertEqual("HASH", params["P_SAMPLING_STRATEGY"])
                self.assertEqual(":INIT$RunId", params["P_RUN_ID"])
                self.assertTrue(all(name.startswith("P_") for name in params))
        nodes, edges = self.clean_graph(saved)
        self.assertEqual(["M03001", "M03002", "M03003", "M03004"], [node["nodeType"] for node in nodes])
        self.assertEqual(["PREDICTED_TYPE_FINAL", "CAT_CORR_PAIR", "ASSOCIATION_MODEL"],
                         [edge["params"]["artifact"] for edge in edges])
        self.assertTrue(all(sql_id in {"DATA_WORK_JOB_INSERT", "DATA_WORK_JOB_ID_LATEST"} for sql_id, _ in self.db.writes))

    def test_retry_preserves_user_parameters_disabled_job_and_snapshot_without_registry_reads(self):
        saved = self.saved()
        first = self.db.stored[0]
        first["PARAM_JSON"] = json.dumps([{"itemName": "P_SAMPLE_ROWS", "itemDefault": "1234"}])
        first["EXEC_SPEC_JSON"] = json.dumps({"method": "UNIFIED_EDITING_PROFILE", "note": "Saved user snapshot"})
        first["USE_YN"] = "N"
        self.db.matches["UNIFIED_EDITING_PROFILE"] = [{"USE_YN": "N", "LANGUAGE": "PYTHON"}]
        read_start = len(self.db.reads)
        for stage, previous in zip(defaults.UNIFIED_STAGES, saved):
            restored, created = self.ensure(stage)
            self.assertFalse(created)
            self.assertEqual(previous["WORK_JOB_ID"], restored["WORK_JOB_ID"])
        restored, _ = self.ensure(defaults.UNIFIED_STAGES[0])
        self.assertEqual("1234", restored["PARAMS"][0]["itemDefault"])
        self.assertEqual("N", restored["USE_YN"])
        self.assertEqual("Saved user snapshot", json.loads(restored["EXEC_SPEC_JSON"])["note"])
        self.assertTrue(all(sql_id in {"DATA_WORK_JOB_LIST", "DATA_WORK_JOB_DETAIL"}
                            for sql_id, _ in self.db.reads[read_start:]))
        self.assertEqual(4, len(self.db.stored))

    def test_unified_does_not_reuse_or_modify_saved_mixed_jobs_and_flow(self):
        old_jobs = [defaults.ensure_default_job(self.db, stage, **SCOPE)[0] for stage in defaults.MIXED_XAI_STAGES]
        self.db.stored[0]["PARAM_JSON"] = json.dumps([{"itemName": "P_SAMPLE_ROWS", "itemDefault": "777"}])
        saved = self.saved()
        self.assertEqual([105, 106, 107, 108], [job["WORK_JOB_ID"] for job in saved])
        self.assertEqual(8, len(self.db.stored))
        old, created = defaults.ensure_default_job(self.db, defaults.MIXED_XAI_STAGES[0], **SCOPE)
        self.assertFalse(created)
        self.assertEqual("777", old["PARAMS"][0]["itemDefault"])
        old_flow = {"FLOW_ID": 91, "FLOW_TYPE": "MIXED_XAI_SCENARIO",
                    "FLOW_NAME": defaults.create_flow_name("INITUP$SOURCE", "MIXED_XAI"),
                    "FLOW_DESC": defaults.create_flow_marker(33, "MIXED_XAI"),
                    "NODES": [{"REF_WORK_JOB_ID": job["WORK_JOB_ID"]} for job in old_jobs]}
        with patch.object(flows, "list_flows", return_value={"data": [old_flow]}), \
             patch.object(flows, "save_flow", return_value=92) as save, \
             patch.object(flows, "load_flow", return_value={"FLOW_ID": 92}) as load:
            new_flow, created = defaults.ensure_default_flow(self.db, jobs=saved, process_type="UNIFIED", **SCOPE)
        self.assertTrue(created)
        self.assertEqual(92, new_flow["FLOW_ID"])
        self.assertEqual("UNIFIED_EDITING_SCENARIO", save.call_args.args[2].flowType)
        self.assertIsNone(save.call_args.args[2].flowId)
        self.assertEqual(92, load.call_args.args[2])
        self.assertEqual("MIXED_XAI_SCENARIO", old_flow["FLOW_TYPE"])

    def test_partial_registration_keeps_custom_alias_and_defaults_and_contract_graph(self):
        stage = defaults.UNIFIED_STAGES[2]
        self.db.resources = [{"OML_RESOURCE_ID": 901, "RESOURCE_NAME": "CUSTOM_UNIFIED_DISCOVER", "EXEC_METHOD": stage["modelName"]}]
        spec = {"adapter": "INTERNAL_PYTHON_API", "endpoint": "/api/mlAnalysis/custom-unified",
                "output": {"resultCreateYn": "T", "resultTableName": stage["resultName"], "persistMode": "SERVICE_MANAGED"}}
        self.db.details[901] = [{"RESOURCE_NAME": "CUSTOM_UNIFIED_DISCOVER", "RESOURCE_LABEL": "User discovery",
            "EXEC_METHOD": stage["modelName"], "SPEC_JSON": json.dumps(spec), "PARAM_NAME": "P_MIN_CONFIDENCE",
            "DATA_TYPE": "NUMBER", "DEFAULT_VALUE": "0.973", "ITEM_ORDER": 1, "BIND_NAME": "P_MIN_CONFIDENCE"}]
        saved = self.saved()
        self.assertEqual([None, None, 901, None], [job["EXEC_RESOURCE_ID"] for job in saved])
        self.assertEqual("CUSTOM_UNIFIED_DISCOVER", saved[2]["EXEC_OBJECT_NAME"])
        self.assertEqual("0.973", saved[2]["PARAMS"][0]["itemDefault"])
        self.assertEqual("/api/mlAnalysis/custom-unified", json.loads(saved[2]["EXEC_SPEC_JSON"])["endpoint"])
        self.clean_graph(saved)

    def test_inactive_non_python_or_wrong_stage_registration_cannot_be_bypassed(self):
        for stage in defaults.UNIFIED_STAGES:
            for registration in ({"USE_YN": "N", "LANGUAGE": "PYTHON"}, {"USE_YN": "Y", "LANGUAGE": "SQL"}):
                with self.subTest(stage=stage["modelName"], registration=registration):
                    self.db.matches[stage["modelName"]] = [registration]
                    with self.assertRaises(HTTPException) as raised:
                        self.ensure(stage)
                    self.assertEqual(409, raised.exception.status_code)
        self.db.matches.clear()
        with self.assertRaises(HTTPException) as raised:
            self.ensure({**defaults.UNIFIED_STAGES[0], "menuCode": "M03004"})
        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual([], self.db.writes)

    def test_saved_jobs_bind_target_run_and_hash_policy_into_real_internal_dispatch(self):
        runtime = {"INIT$TargetOwner": "APP_OWNER", "INIT$TargetTable": "INITUP$SOURCE",
                   "INIT$RunSourceType": "FLOW_WORK", "INIT$RunId": 721}
        for job in self.saved():
            with self.subTest(method=job["EXEC_METHOD"]), \
                 patch.object(integrated, "execute", return_value={"status": "success", "algorithm": "UNIFIED_EDITING"}) as execution, \
                 patch.object(api, "call_http_json_api", side_effect=AssertionError("Unexpected network path")):
                result = api.execute_api_job(self.db, job, runtime_values=runtime, run_id=721, include_result=True)
            execution.assert_called_once()
            self.assertIs(self.db, execution.call_args.args[0])
            self.assertEqual(job["EXEC_METHOD"], execution.call_args.args[1])
            payload = execution.call_args.args[2]
            self.assertEqual(("APP_OWNER", "INITUP$SOURCE", "FLOW_WORK", 721),
                             tuple(payload[key] for key in ("P_TARGET_OWNER", "P_TARGET_TABLE", "P_RUN_SOURCE_TYPE", "P_RUN_ID")))
            self.assertEqual("HASH", payload["P_SAMPLING_STRATEGY"])
            self.assertFalse(any(key.startswith(("AUTH.", "OUTPUT.")) for key in payload))
            self.assertEqual("success", result["result"]["status"])

    def test_reported_dynamic_model_and_both_rule_families_preserve_output_lineage(self):
        saved = self.saved()
        nodes, _ = self.clean_graph(saved)
        result = {"resultTables": ["INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEDISC_SYMBOLIC", "INIT$_TB_XAI_RUN"],
                  "resultModels": ["OML_UNIFIED_ACTUAL_RUN_721"]}
        output = flows.build_contract_node_output({"nodePayload": nodes[2]}, saved[2], execution_result=result)
        objects = {item["artifact"]: item for item in output["resultObjects"]}
        self.assertEqual("OML_UNIFIED_ACTUAL_RUN_721", objects["ASSOCIATION_MODEL"]["objectName"])
        self.assertEqual("INIT$_TB_RULEDISC_ASSOC_SUM", objects["ASSOC_RULE_SUMMARY"]["objectName"])
        self.assertEqual("INIT$_TB_RULEDISC_ASSOC_SUM", objects["MIXED_XAI_RULES"]["objectName"])
        self.assertIn("SYMBOLIC_RULE", objects)
        skipped = flows.build_contract_node_output({"nodePayload": nodes[2]}, saved[2], execution_result={
            "resultTables": ["INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_XAI_RUN"], "resultModels": []})
        artifacts = {item["artifact"] for item in skipped["resultObjects"]}
        self.assertNotIn("ASSOCIATION_MODEL", artifacts)
        self.assertNotIn("SYMBOLIC_RULE", artifacts)
        self.assertIn("MIXED_XAI_RULES", artifacts)

    def provision_route(self, *, flow_error=None):
        request = Request({"type": "http", "method": "POST", "path": "/api/M02002/scenario-table/provision-default-design", "headers": []})
        request.state.authenticated_user_id = 7
        req = scenario_router.ScenarioDefaultDesignRequest(projectId=11, scenarioId=22, scenarioTableId=33, processType="UNIFIED")
        saved_flows = []

        def save_flow(_conn, _menu, flow_request, _group, _flow_type):
            saved_flows.append(flow_request)
            if flow_error:
                raise flow_error
            return 551

        with patch.object(scenario_router, "get_target_db_connection", return_value=self.db), \
             patch.object(scenario_router, "require_project_scenario_access") as access, \
             patch.object(flows, "list_flows", return_value={"data": []}), \
             patch.object(flows, "save_flow", side_effect=save_flow), \
             patch.object(flows, "load_flow", return_value={"FLOW_ID": 551, "FLOW_NAME": "Unified flow"}):
            result = scenario_router.provision_scenario_default_design(req, request)
        access.assert_called_once()
        self.assertIs(request, access.call_args.args[1])
        return result, saved_flows

    def test_authenticated_route_builds_real_jobs_and_graph_before_commit(self):
        result, saved_flows = self.provision_route()
        self.assertEqual("UNIFIED", result["automation"]["processType"])
        self.assertEqual([101, 102, 103, 104], result["automation"]["jobIds"])
        self.assertEqual("UNIFIED_EDITING_SCENARIO", saved_flows[0].flowType)
        self.assertIn(":UNIFIED:V1", saved_flows[0].flowDesc)
        self.assertEqual((1, 0, 1), (self.db.commits, self.db.rollbacks, self.db.closed_connections))
        self.assertEqual(4, len(self.db.committed))

    def test_flow_failure_rolls_back_real_jobs_and_retry_recreates_one_set(self):
        with self.assertRaises(HTTPException):
            self.provision_route(flow_error=HTTPException(409, "Injected flow persistence failure"))
        self.assertEqual([], self.db.stored)
        self.assertEqual((0, 1), (self.db.commits, self.db.rollbacks))
        result, _ = self.provision_route()
        self.assertEqual([101, 102, 103, 104], result["automation"]["createdJobIds"])
        self.assertEqual(4, len(self.db.committed))

    def test_disabled_third_model_rolls_back_previous_new_jobs(self):
        self.db.matches["UNIFIED_EDITING_DISCOVER"] = [{"USE_YN": "N", "LANGUAGE": "PYTHON"}]
        with self.assertRaises(HTTPException) as raised:
            self.provision_route()
        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual(2, sum(sql_id == "DATA_WORK_JOB_INSERT" for sql_id, _ in self.db.writes))
        self.assertEqual([], self.db.stored)
        self.assertEqual((0, 1), (self.db.commits, self.db.rollbacks))

    def test_history_restores_unified_from_compact_flow_type_or_saved_summary(self):
        row = {"FLOW_RUN_ID": 50, "FLOW_ID": 40, "PROJECT_ID": 11, "SCENARIO_ID": 22,
               "FLOW_TYPE": "UNIFIED_EDITING_SCENARIO", "STATUS": "SUCCESS",
               "OWNER_NAME": "APP_OWNER", "TABLE_NAME": "INITUP$SOURCE", "JOB_COUNT": 4}
        self.assertEqual("UNIFIED", flows.build_quick_edit_history_detail(row, [])["restoreState"]["processType"])
        row.pop("FLOW_TYPE")
        row["PLAN_JSON"] = json.dumps({"quickEditSummary": normalize_quick_edit_summary({"source": "QUICK_EDIT", "processType": "UNIFIED"})})
        self.assertEqual("UNIFIED", flows.build_quick_edit_history_detail(row, [])["restoreState"]["processType"])
        self.assertEqual("LEGACY", normalize_quick_edit_summary({"source": "QUICK_EDIT", "processType": "UNRECOGNIZED"})["processType"])


if __name__ == "__main__":
    unittest.main()
