import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.routers import M04001
from backend.services import flow_work_service


def get_route_endpoint(path: str, method: str):
    for route in M04001.router.routes:
        if route.path == path and method.upper() in route.methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


class QuickEditHistoryTests(unittest.TestCase):
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
