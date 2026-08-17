import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import edit_work_service


class _Cursor:
    def close(self):
        return None


class _Connection:
    def __init__(self):
        self.cursor_instance = _Cursor()

    def cursor(self):
        return self.cursor_instance

    def close(self):
        return None


class EditWorkRunConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.mapping = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$_DATA",
        }
        self.latest_rules = [
            {
                "EDIT_RULE_ID": 101,
                "SOURCE_RULE_TYPE": "ASSOCIATION",
                "SOURCE_RUN_SOURCE_TYPE": "FLOW_WORK",
                "SOURCE_RUN_ID": 1081,
                "SOURCE_RULE_ID": "COND_101",
                "USER_RULE_YN": "N",
                "TARGET_OWNER": "INIT$EDIT01",
                "TARGET_TABLE": "INITUP$_DATA",
            }
        ]

    @patch.object(edit_work_service, "_editing_table_structure_status")
    @patch.object(edit_work_service, "_list_latest_selected_source_rules")
    @patch.object(edit_work_service, "_require_target_table_access")
    @patch.object(edit_work_service, "_fetch_all")
    @patch.object(edit_work_service, "_require_project_access", return_value=10)
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_editing_table_marks_previous_run_execution_as_stale(
        self,
        get_connection,
        _require_project_access,
        fetch_all,
        require_mapping,
        latest_rules,
        table_status,
    ):
        get_connection.return_value = _Connection()
        fetch_all.side_effect = [
            [
                {
                    "OWNER_NAME": "INIT$EDIT01",
                    "TABLE_NAME": "INITUP$_DATA",
                    "FINAL_RULE_COUNT": 4,
                }
            ],
            [
                {
                    "EDIT_SESSION_ID": 41,
                    "TARGET_OWNER": "INIT$EDIT01",
                    "SOURCE_TABLE": "INITUP$_DATA",
                    "EDIT_TABLE": "INITDN$_DATA",
                    "SESSION_STATUS": "EDITING",
                    "SOURCE_RUN_SOURCE_TYPE": "FLOW_WORK",
                    "SOURCE_RUN_ID": 961,
                }
            ],
        ]
        require_mapping.return_value = self.mapping
        latest_rules.return_value = (
            self.latest_rules,
            {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 1081},
        )
        table_status.return_value = {
            "exists": True,
            "trackingColumnExists": True,
            "structureMatches": True,
            "message": "ready",
        }

        result = edit_work_service.list_editing_tables(
            object(),
            project_id=10,
            scenario_id=20,
        )

        row = result["data"][0]
        self.assertEqual("N", row["CURRENT_RUN_MATCHES_YN"])
        self.assertEqual(961, row["CURRENT_RUN_ID"])
        self.assertEqual(1081, row["SOURCE_RUN_ID"])
        self.assertFalse(row["EDITABLE"])

    @patch.object(edit_work_service, "_list_latest_selected_source_rules")
    @patch.object(edit_work_service, "_require_target_table_access")
    @patch.object(edit_work_service, "_select_session")
    @patch.object(edit_work_service, "_require_project_access", return_value=10)
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_live_violation_query_rejects_previous_run_execution(
        self,
        get_connection,
        _require_project_access,
        select_session,
        require_mapping,
        latest_rules,
    ):
        get_connection.return_value = _Connection()
        require_mapping.return_value = self.mapping
        select_session.return_value = {
            "EDIT_SESSION_ID": 41,
            "PROJECT_ID": 10,
            "SCENARIO_ID": 20,
            "SESSION_STATUS": "EDITING",
            "TARGET_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_TABLE": "INITDN$_DATA",
            "SOURCE_RUN_SOURCE_TYPE": "FLOW_WORK",
            "SOURCE_RUN_ID": 961,
        }
        latest_rules.return_value = (
            self.latest_rules,
            {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 1081},
        )

        with self.assertRaises(HTTPException) as raised:
            edit_work_service.list_violations(
                object(),
                project_id=10,
                scenario_id=20,
                target_owner="INIT$EDIT01",
                target_table="INITUP$_DATA",
                edit_session_id=41,
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("FLOW_WORK #961", raised.exception.detail)
        self.assertIn("FLOW_WORK #1081", raised.exception.detail)

    @patch.object(edit_work_service, "_editing_table_structure_status")
    @patch.object(edit_work_service, "_list_latest_selected_source_rules")
    @patch.object(edit_work_service, "_require_target_table_access")
    @patch.object(edit_work_service, "_fetch_all")
    @patch.object(edit_work_service, "_require_project_access", return_value=10)
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_editing_table_status_rejects_previous_run_execution(
        self,
        get_connection,
        _require_project_access,
        fetch_all,
        require_mapping,
        latest_rules,
        table_status,
    ):
        get_connection.return_value = _Connection()
        require_mapping.return_value = self.mapping
        fetch_all.return_value = [
            {
                "EDIT_SESSION_ID": 41,
                "TARGET_OWNER": "INIT$EDIT01",
                "SOURCE_TABLE": "INITUP$_DATA",
                "EDIT_TABLE": "INITDN$_DATA",
                "SESSION_STATUS": "EDITING",
                "SOURCE_RUN_SOURCE_TYPE": "FLOW_WORK",
                "SOURCE_RUN_ID": 961,
            }
        ]
        latest_rules.return_value = (
            self.latest_rules,
            {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 1081},
        )
        table_status.return_value = {
            "exists": True,
            "trackingColumnExists": True,
            "structureMatches": True,
            "message": "ready",
        }

        result = edit_work_service.editing_table_status(
            object(),
            project_id=10,
            scenario_id=20,
            target_owner="INIT$EDIT01",
            target_table="INITUP$_DATA",
        )["data"]

        self.assertFalse(result["currentRunMatches"])
        self.assertFalse(result["editable"])
        self.assertEqual(961, result["currentRunId"])
        self.assertEqual(1081, result["latestRunId"])

    @patch.object(edit_work_service, "editing_table_status")
    def test_prepare_does_not_reuse_previous_run_execution(self, editing_status):
        editing_status.return_value = {
            "status": "success",
            "data": {
                "exists": True,
                "structureMatches": True,
                "editable": False,
                "currentRunMatches": False,
                "currentRunSourceType": "FLOW_WORK",
                "currentRunId": 961,
                "latestRunSourceType": "FLOW_WORK",
                "latestRunId": 1081,
                "editSessionId": 41,
                "sessionStatus": "EDITING",
            },
        }

        with self.assertRaises(HTTPException) as raised:
            edit_work_service.create_editing_table(
                object(),
                edit_work_service.EditingTableCreateRequest(
                    projectId=10,
                    scenarioId=20,
                    targetOwner="INIT$EDIT01",
                    targetTable="INITUP$_DATA",
                    editRuleIds=[],
                ),
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("FLOW_WORK #961", raised.exception.detail)
        self.assertIn("FLOW_WORK #1081", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
