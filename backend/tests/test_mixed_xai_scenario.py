import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import flow_work_service as flows
from backend.services import scenario_default_design_service as defaults


class MixedXaiScenarioTests(unittest.TestCase):
    def test_selected_process_provisions_only_its_registered_python_jobs(self):
        jobs = []

        def create_job(_conn, stage, **_kwargs):
            job = {"WORK_JOB_ID": len(jobs) + 1, "EXEC_METHOD": stage["modelName"]}
            jobs.append(job)
            return job, True

        with (
            patch.object(defaults, "lock_scenario_table", return_value={"ownerName": "OWNER", "tableName": "INITUP$SOURCE"}),
            patch.object(defaults, "ensure_default_job", side_effect=create_job) as ensure_job,
            patch.object(defaults, "ensure_default_flow", return_value=({"FLOW_ID": 7}, True)) as ensure_flow,
        ):
            result = defaults.provision_default_design(
                Mock(), project_id=1, scenario_id=2, scenario_table_id=3, process_type="MIXED_XAI"
            )

        self.assertEqual("MIXED_XAI", result["processType"])
        self.assertEqual([1, 2, 3, 4], result["jobIds"])
        self.assertEqual(["MIXED_XAI_PROFILE", "MIXED_XAI_RELATION", "MIXED_XAI_RULE_DISCOVER", "MIXED_XAI_RULE_DETECT"], [row["EXEC_METHOD"] for row in jobs])
        self.assertTrue(all(call.args[1]["sourceType"] == "WEB_API" for call in ensure_job.call_args_list))
        self.assertEqual("MIXED_XAI", ensure_flow.call_args.kwargs["process_type"])

    def test_unknown_process_rejected_before_database_access(self):
        conn = Mock()
        with self.assertRaises(HTTPException) as raised:
            defaults.provision_default_design(conn, project_id=1, scenario_id=2, scenario_table_id=3, process_type="UNKNOWN")
        self.assertEqual(422, raised.exception.status_code)
        conn.cursor.assert_not_called()

    def test_xai_does_not_reuse_legacy_flow_with_same_job_references(self):
        jobs = [{"WORK_JOB_ID": 11}, {"WORK_JOB_ID": 12}]
        legacy = {"FLOW_ID": 9, "FLOW_TYPE": defaults.FLOW_TYPE, "FLOW_NAME": "Legacy"}
        with (
            patch.object(flows, "list_flows", return_value={"data": [legacy]}),
            patch.object(flows, "load_flow", return_value={"FLOW_ID": 10}) as load,
            patch.object(flows, "save_flow", return_value=10) as save,
            patch.object(defaults, "build_sample_flow_graph", return_value=([], [])),
        ):
            _flow, created = defaults.ensure_default_flow(
                Mock(), project_id=1, scenario_id=2, scenario_table_id=3,
                owner_name="OWNER", table_name="INITUP$SOURCE", jobs=jobs, process_type="MIXED_XAI"
            )
        self.assertTrue(created)
        self.assertEqual(10, load.call_args.args[2])
        request = save.call_args.args[2]
        self.assertEqual("MIXED_XAI_SCENARIO", request.flowType)
        self.assertIn("[AUTO_SCENARIO_TABLE:3:MIXED_XAI:V3]", request.flowDesc)

    def test_four_stage_graph_has_profile_relationships_and_actual_rules(self):
        jobs = [{
            "WORK_JOB_ID": index,
            "MENU_CODE": stage["menuCode"], "JOB_GROUP": stage["menuCode"],
            "EXEC_OBJECT_NAME": stage["modelName"], "EXEC_METHOD": stage["modelName"],
            "OWNER_NAME": "OWNER", "TABLE_NAME": "INITUP$DATA",
            "RESULT_CREATE_YN": "T", "RESULT_OWNER": "OWNER", "RESULT_TABLE_NAME": stage["resultName"],
            "PARAMS": [],
        } for index, stage in enumerate(defaults.MIXED_XAI_STAGES, start=1)]
        nodes, edges = defaults.build_sample_flow_graph(jobs)
        clean_nodes, clean_edges = flows.normalize_graph(
            [flows.FlowNodeRequest(**node) for node in nodes],
            [flows.FlowEdgeRequest(**edge) for edge in edges],
        )
        validation = flows.validate_graph(clean_nodes, clean_edges)
        self.assertEqual("success", validation["status"], validation)
        self.assertEqual(["M03001", "M03002", "M03003", "M03004"], [node["nodeType"] for node in nodes])
        self.assertEqual(["MIXED_XAI_PROFILE", "MIXED_XAI_RELATION", "MIXED_XAI_RULES"], [edge["params"]["artifact"] for edge in edges])
        # Existing saved two-stage histories remain a valid independent graph.
        old_nodes, old_edges = defaults.build_sample_flow_graph(jobs[2:])
        clean_nodes, clean_edges = flows.normalize_graph([flows.FlowNodeRequest(**node) for node in old_nodes], [flows.FlowEdgeRequest(**edge) for edge in old_edges])
        self.assertEqual("success", flows.validate_graph(clean_nodes, clean_edges)["status"])

    def test_new_template_does_not_rewrite_existing_two_stage_flow(self):
        old_flow = {"FLOW_ID": 9, "FLOW_TYPE": "MIXED_XAI_SCENARIO", "FLOW_NAME": "INITUP$SOURCE 혼합형 XAI 규칙발굴 FLOW",
                    "FLOW_DESC": "[AUTO_SCENARIO_TABLE:3:MIXED_XAI] user-adjusted", "NODES": [{"REF_WORK_JOB_ID": 3}, {"REF_WORK_JOB_ID": 4}]}
        with patch.object(flows, "list_flows", return_value={"data": [old_flow]}), \
             patch.object(flows, "load_flow", side_effect=lambda _c, _m, fid: old_flow if fid == 9 else {"FLOW_ID": fid}), \
             patch.object(flows, "save_flow", return_value=10) as save, \
             patch.object(defaults, "build_sample_flow_graph", return_value=([], [])):
            result, created = defaults.ensure_default_flow(Mock(), project_id=1, scenario_id=2, scenario_table_id=3,
                owner_name="OWNER", table_name="INITUP$SOURCE", jobs=[{"WORK_JOB_ID": n} for n in range(1, 5)], process_type="MIXED_XAI")
        self.assertTrue(created)
        self.assertEqual(10, result["FLOW_ID"])
        self.assertIsNone(save.call_args.args[2].flowId)
        self.assertEqual("[AUTO_SCENARIO_TABLE:3:MIXED_XAI] user-adjusted", old_flow["FLOW_DESC"])

    def test_scenario_names_and_markers_are_distinct(self):
        self.assertEqual("[AUTO_SCENARIO_TABLE:42]", defaults.create_flow_marker(42))
        self.assertNotEqual(defaults.create_flow_marker(42), defaults.create_flow_marker(42, "MIXED_XAI"))
        self.assertNotEqual(defaults.create_flow_name("INITUP$DATA"), defaults.create_flow_name("INITUP$DATA", "MIXED_XAI"))

    def test_history_restore_uses_flow_type_projected_by_real_history_queries(self):
        for sql_id in ("FLOW_WORK_QUICK_EDIT_HISTORY_LIST", "FLOW_WORK_QUICK_EDIT_HISTORY"):
            sql = SqlLoader.get_sql(sql_id)
            self.assertIn("HF.FLOW_TYPE", sql)
        row = {
            "FLOW_RUN_ID": 50, "FLOW_ID": 40, "PROJECT_ID": 10, "SCENARIO_ID": 20,
            "FLOW_TYPE": "MIXED_XAI_SCENARIO", "STATUS": "SUCCESS",
            "OWNER_NAME": "OWNER", "TABLE_NAME": "INITUP$DATA", "JOB_COUNT": 2,
        }
        # Compact history rows deliberately do not include PLAN_JSON or execution method.
        detail = flows.build_quick_edit_history_detail(row, [{"REF_MENU_CODE": "M03003", "STATUS": "SUCCESS"}])
        self.assertEqual("MIXED_XAI", detail["restoreState"]["processType"])
        row.pop("FLOW_TYPE")
        self.assertEqual("LEGACY", flows.build_quick_edit_history_detail(row, [])["restoreState"]["processType"])


if __name__ == "__main__":
    unittest.main()
