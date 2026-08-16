import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import edit_work_service


class EditWorkRuleLinkageTests(unittest.TestCase):
    class Cursor:
        def __init__(self):
            self.executions = []

        def execute(self, sql, params):
            self.executions.append((sql, params))

    @staticmethod
    def session():
        return {
            "PROJECT_ID": 22,
            "SCENARIO_ID": 3,
            "TARGET_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
        }

    @patch.object(edit_work_service, "_fetch_all")
    def test_only_requested_current_rules_are_appended_to_execution_history(self, fetch_all):
        cursor = self.Cursor()
        fetch_all.side_effect = [
            [{"EDIT_RULE_ID": 10, "TARGET_COLUMN": "COL001"}],
            [
                {"EDIT_RULE_ID": 21, "TARGET_COLUMN": "COL002"},
                {"EDIT_RULE_ID": 22, "TARGET_COLUMN": "COL003"},
            ],
        ]

        rules = edit_work_service._session_rules_for_changes(
            cursor,
            session=self.session(),
            edit_session_id=7,
            requested_rule_ids={21},
        )

        self.assertEqual([21, 22], list(rules))
        self.assertEqual(1, len(cursor.executions))
        self.assertIn("MERGE INTO", cursor.executions[0][0].upper())
        self.assertEqual(
            {"editSessionId": 7, "editRuleId": 21},
            cursor.executions[0][1],
        )

    @patch.object(edit_work_service, "_fetch_all")
    def test_empty_request_does_not_link_unused_current_rules(self, fetch_all):
        cursor = self.Cursor()
        fetch_all.side_effect = [
            [{"EDIT_RULE_ID": 10, "TARGET_COLUMN": "COL001"}],
            [{"EDIT_RULE_ID": 21, "TARGET_COLUMN": "COL002"}],
        ]

        rules = edit_work_service._session_rules_for_changes(
            cursor,
            session=self.session(),
            edit_session_id=7,
            requested_rule_ids=set(),
        )

        self.assertEqual([21], list(rules))
        self.assertEqual([], cursor.executions)

    @patch.object(edit_work_service, "_fetch_all")
    def test_inactive_historical_rule_cannot_be_used_for_new_change(self, fetch_all):
        cursor = self.Cursor()
        fetch_all.side_effect = [
            [{"EDIT_RULE_ID": 10, "TARGET_COLUMN": "COL001"}],
            [{"EDIT_RULE_ID": 21, "TARGET_COLUMN": "COL002"}],
        ]

        with self.assertRaises(HTTPException) as raised:
            edit_work_service._session_rules_for_changes(
                cursor,
                session=self.session(),
                edit_session_id=7,
                requested_rule_ids={10},
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual([], cursor.executions)


if __name__ == "__main__":
    unittest.main()
