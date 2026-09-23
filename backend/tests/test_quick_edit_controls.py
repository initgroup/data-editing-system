import json
import sqlite3
import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from backend.database_helper import SqlLoader
from backend.routers import M04001
from backend.services import flow_work_service as service
from backend.services import anly_work_service as analysis
from backend.services.flow_work_router import QuickEditControlRequest


class QuickEditControlTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("CREATE TABLE INIT$_TB_FLOW_WORK_RUN (FLOW_RUN_ID, FLOW_ID, RUN_TYPE, STATUS, MESSAGE, PLAN_JSON, STARTED_AT, FINISHED_AT)")
        self.db.execute("INSERT INTO INIT$_TB_FLOW_WORK_RUN (FLOW_RUN_ID, FLOW_ID, STATUS) VALUES (1, 2, 'QUEUED')")

    def sql(self, key, **params):
        return self.db.execute(SqlLoader.get_sql(key).replace("SYSTIMESTAMP", "CURRENT_TIMESTAMP"), params)

    def status(self):
        return self.sql("FLOW_WORK_RUN_CONTROL_STATUS", flowRunId=1).fetchone()[0]

    def test_pause_survives_queued_start_and_stop_wins_over_pause(self):
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="PAUSE")
        self.sql("FLOW_WORK_RUN_START", flowRunId=1, message="start")
        self.assertEqual("PAUSE_REQUESTED", self.status())
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="STOP")
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="PAUSE")
        self.assertEqual("STOP_REQUESTED", self.status())
        self.sql("FLOW_WORK_RUN_CONTROL_APPLY", flowRunId=1, planJson="{}")
        self.sql("FLOW_WORK_RUN_START", flowRunId=1, message="late start")
        self.assertEqual("CANCELLED", self.status())

    def test_pause_resume_is_atomic_and_a_second_resume_cannot_start_duplicate_work(self):
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="PAUSE")
        self.sql("FLOW_WORK_RUN_CONTROL_APPLY", flowRunId=1, planJson="{}")
        self.assertEqual("PAUSED", self.status())
        params = dict(flowRunId=1, flowId=2, runType="QUICK_EDIT", status="STARTED", message="resume", planJson="{}")
        self.assertEqual(1, self.sql("FLOW_WORK_RUN_RESUME", **params).rowcount)
        self.assertEqual(0, self.sql("FLOW_WORK_RUN_RESUME", **params).rowcount)

    def test_stop_paused_run_requires_no_worker_and_terminal_runs_do_not_change(self):
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="PAUSE")
        self.sql("FLOW_WORK_RUN_CONTROL_APPLY", flowRunId=1, planJson="{}")
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="STOP")
        self.assertEqual("CANCELLED", self.status())
        self.assertEqual(0, self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="STOP").rowcount)

    def test_stop_during_last_node_is_not_overwritten_by_success(self):
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="STOP")
        self.sql("FLOW_WORK_RUN_UPDATE", flowRunId=1, status="SUCCESS", message="done", planJson="{}")
        self.assertEqual("CANCELLED", self.status())

    def test_pause_during_last_node_completes_if_no_work_remains(self):
        self.sql("FLOW_WORK_RUN_CONTROL_REQUEST", flowRunId=1, action="PAUSE")
        self.sql("FLOW_WORK_RUN_UPDATE", flowRunId=1, status="SUCCESS", message="done", planJson="{}")
        self.assertEqual("SUCCESS", self.status())

    def test_checkpoint_finishes_current_node_and_keeps_next_node_pending(self):
        conn = MagicMock()
        plan = [{"nodeKey": "A"}, {"nodeKey": "B"}]
        with ExitStack() as stack:
            for name in ("prepare_flow_run_session", "start_node_run_by_key", "update_node_run_runtime_params",
                         "update_node_run_output", "update_node_run_by_key"):
                stack.enter_context(patch.object(service, name))
            run_node = stack.enter_context(patch.object(service, "execute_flow_node", return_value={"message": "ok"}))
            checkpoint = stack.enter_context(patch.object(service, "apply_run_control", side_effect=[None, {"status": "PAUSED"}]))
            final_update = stack.enter_context(patch.object(service, "update_run"))
            result = service.execute_flow_plan(conn, 1, plan, run_context={"quickEditSummary": {"source": "QUICK_EDIT"}})
        self.assertEqual("PAUSED", result["status"])
        self.assertEqual(1, run_node.call_count)
        self.assertEqual("A", checkpoint.call_args.args[2]["plan"][0]["nodeKey"])
        self.assertEqual("SUCCESS", checkpoint.call_args.args[2]["plan"][0]["status"])
        self.assertNotIn("status", checkpoint.call_args.args[2]["plan"][1])
        final_update.assert_not_called()

    def test_control_authorization_uses_session_and_denies_unowned_run(self):
        endpoint = next(r.endpoint for r in M04001.router.routes if r.path.endswith("/{flow_run_id}/control"))
        conn = MagicMock()
        with patch("backend.services.flow_work_router.get_target_db_connection", return_value=conn), \
             patch("backend.services.flow_work_router.get_request_user_id", return_value=7), \
             patch("backend.services.flow_work_router.get_request_role_code", return_value="USER"), \
             patch.object(service, "list_quick_edit_history", return_value={"data": []}) as history, \
             patch.object(service, "request_run_control") as control:
            with self.assertRaises(HTTPException) as raised:
                endpoint(1, QuickEditControlRequest(action="STOP"), object())
        self.assertEqual(404, raised.exception.status_code)
        self.assertEqual((7, False), history.call_args.args[2:4])
        control.assert_not_called()
        conn.close.assert_called_once()

    def test_history_restores_paused_and_stopped_states(self):
        for status, expected in [("PAUSED", "paused"), ("CANCELLED", "stopped"), ("PAUSE_REQUESTED", "running"), ("STOP_REQUESTED", "running")]:
            detail = service.build_quick_edit_history_detail({"STATUS": status, "FLOW_RUN_ID": 1}, [])
            self.assertEqual(expected, detail["restoreState"]["status"])

    def test_mixed_statistics_reuses_common_calculation_without_classification(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        descriptions = [[(k,) for k in ("FLOW_NODE_RUN_ID", "RUNTIME_PARAM_JSON", "NODE_PAYLOAD_JSON", "EXEC_METHOD")], [("PROJECT_ID",), ("SCENARIO_ID",)]]
        cursor.execute.side_effect = lambda *_: setattr(cursor, "description", descriptions.pop(0))
        cursor.fetchall.return_value = [(1, json.dumps({"INIT$TargetOwner": "OWNER", "INIT$TargetTable": "SOURCE"}), "{}", "MIXED_XAI_RULE_DISCOVER")]
        cursor.fetchone.return_value = (2, 3)
        stats = analysis.descriptive_statistics
        with patch.object(analysis, "get_target_db_connection", return_value=conn), \
             patch.object(analysis, "get_request_user_id", return_value=7), \
             patch.object(analysis, "get_request_role_code", return_value="USER"), \
             patch.object(stats, "resolve_registered_pair", return_value={"SOURCE_OWNER": "OWNER", "SOURCE_TABLE": "SOURCE", "EDIT_OWNER": "OWNER", "EDIT_TABLE": "EDIT"}), \
             patch.object(stats, "build_statistics", return_value={"available": True, "columns": []}) as build, \
             patch.object(stats, "load_violation_column_insights") as legacy_insights, \
             patch("backend.services.mixed_xai_service.read_results", return_value={"data": {"ruleSummary": {"rules": [{"CONDITION_COLUMNS": ["VALUE"], "MATCH_COUNT": 12}]}}}) as mixed:
            result = analysis.get_descriptive_statistics(1, object())
        self.assertTrue(result["data"]["available"])
        self.assertEqual("MIXED_XAI", result["data"]["context"]["processType"])
        self.assertEqual(1, build.call_count)
        self.assertEqual("SOURCE", mixed.call_args.kwargs["target_table"])
        legacy_insights.assert_not_called()


if __name__ == "__main__":
    unittest.main()
