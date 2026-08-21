import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.routers import M04001
from backend.database_helper import SqlLoader
from backend.services.flow_work_router import normalize_quick_edit_summary
from backend.services import flow_work_service


def get_route_endpoint(path: str, method: str):
    for route in M04001.router.routes:
        if route.path == path and method.upper() in route.methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


class QuickEditHistoryTests(unittest.TestCase):
    def test_quick_edit_summary_is_compact_and_normalized(self):
        summary = normalize_quick_edit_summary({
            "source": "quick_edit",
            "projectCode": "QE_20260821",
            "projectName": "퀵 에디팅 20260821-143000",
            "ownerName": "init$edit01",
            "tableName": "initup$qedit",
            "fileSize": "2048",
            "estimatedRowCount": -1,
        })

        self.assertEqual("QUICK_EDIT", summary["source"])
        self.assertEqual(1, summary["version"])
        self.assertEqual("INIT$EDIT01", summary["ownerName"])
        self.assertEqual("INITUP$QEDIT", summary["tableName"])
        self.assertEqual(2048, summary["fileSize"])
        self.assertIsNone(summary["estimatedRowCount"])

    def test_completed_run_keeps_quick_edit_summary(self):
        conn = Mock()
        summary = {"source": "QUICK_EDIT", "projectName": "Quick project"}

        with (
            patch("backend.services.flow_work_service.prepare_flow_run_session"),
            patch("backend.services.flow_work_service.update_run") as update_run,
        ):
            flow_work_service.execute_flow_plan(
                conn,
                1044,
                [],
                run_context={"quickEditSummary": summary},
            )

        persisted_plan = update_run.call_args.args[4]
        self.assertEqual(summary, persisted_plan["quickEditSummary"])

    def test_history_sql_uses_summary_path_and_legacy_fallback(self):
        sql = SqlLoader.get_sql("FLOW_WORK_QUICK_EDIT_HISTORY")

        self.assertIn("STORED_QUICK_RUNS", sql)
        self.assertIn("R.RUN_TYPE = 'QUICK_EDIT'", sql)
        self.assertIn("'$.quickEditSummary' NULL ON ERROR", sql)
        self.assertIn("PROJECT_NAME VARCHAR2(200) PATH '$.projectName'", sql)
        self.assertIn("PR.SUMMARY_YN = 'Y'", sql)
        self.assertIn("LEGACY_RUN_SCOPE", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QEDIT\\_%'", sql)
        self.assertIn("DBMS_LOB.INSTR", sql)

    def test_success_detail_restores_all_eight_steps_without_run_request(self):
        detail = flow_work_service.build_quick_edit_history_detail(
            {
                "FLOW_RUN_ID": 1041,
                "FLOW_ID": 88,
                "PROJECT_ID": 10,
                "PROJECT_CODE": "P10",
                "PROJECT_NAME": "Quick project",
                "SCENARIO_ID": 20,
                "SCENARIO_CODE": "S20",
                "SCENARIO_NAME": "Quick scenario",
                "SCENARIO_TABLE_ID": 30,
                "OWNER_NAME": "INIT$EDIT01",
                "TABLE_NAME": "INITUP$QEDIT",
                "FLOW_NAME": "Quick flow",
                "STATUS": "SUCCESS",
                "MESSAGE": "Completed",
                "NODE_COUNT": 4,
                "SUCCESS_NODE_COUNT": 4,
            },
            [
                {"REF_WORK_JOB_ID": 101, "STATUS": "SUCCESS"},
                {"REF_WORK_JOB_ID": 102, "STATUS": "SUCCESS"},
                {"REF_WORK_JOB_ID": 103, "STATUS": "SUCCESS"},
                {"REF_WORK_JOB_ID": 104, "STATUS": "SUCCESS"},
            ],
        )

        self.assertEqual(list(range(8)), detail["restoreState"]["completedSteps"])
        self.assertEqual("success", detail["restoreState"]["status"])
        self.assertTrue(detail["restoreState"]["historyView"])
        self.assertEqual([101, 102, 103, 104], detail["restoreState"]["jobIds"])
        self.assertEqual(8, len(detail["steps"]))

    def test_failed_detail_stops_at_saved_execution_step(self):
        detail = flow_work_service.build_quick_edit_history_detail(
            {
                "FLOW_RUN_ID": 1042,
                "FLOW_ID": 89,
                "PROJECT_ID": 10,
                "SCENARIO_ID": 20,
                "SCENARIO_TABLE_ID": 31,
                "OWNER_NAME": "INIT$EDIT01",
                "TABLE_NAME": "INITUP$FAILED",
                "STATUS": "FAILED",
                "MESSAGE": "Node failed",
            },
            [{"REF_WORK_JOB_ID": 201, "STATUS": "FAILED"}],
        )

        self.assertEqual(list(range(6)), detail["restoreState"]["completedSteps"])
        self.assertEqual(6, detail["restoreState"]["currentStep"])
        self.assertEqual("failed", detail["restoreState"]["status"])
        self.assertEqual("FAILED", detail["steps"][6]["status"])
        self.assertEqual("PENDING", detail["steps"][7]["status"])

    def test_history_detail_returns_404_when_run_is_not_visible(self):
        endpoint = get_route_endpoint("/quick-edit/history/{flow_run_id}", "GET")
        conn = Mock()
        request = Mock()

        with (
            patch("backend.services.flow_work_router.get_target_db_connection", return_value=conn),
            patch("backend.services.flow_work_router.get_request_user_id", return_value=7),
            patch("backend.services.flow_work_router.get_request_role_code", return_value="USER"),
            patch(
                "backend.services.flow_work_router.flow_work.list_quick_edit_history",
                return_value={"status": "success", "data": [], "total": 0},
            ),
            patch("backend.services.flow_work_router.flow_work.list_node_runs") as list_nodes,
        ):
            with self.assertRaises(HTTPException) as raised:
                endpoint(9999, request)

        self.assertEqual(404, raised.exception.status_code)
        list_nodes.assert_not_called()
        conn.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
