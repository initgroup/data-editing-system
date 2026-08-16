import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import edit_work_service


class _Cursor:
    def __init__(self, *, rowcount=1):
        self.executions = []
        self.rowcount = rowcount

    def execute(self, sql, params=None):
        self.executions.append((sql, params or {}))

    def close(self):
        pass


class _Connection:
    def __init__(self, *, rowcount=1):
        self.cursor_instance = _Cursor(rowcount=rowcount)
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        pass


class EditWorkSessionCancelTests(unittest.TestCase):
    def setUp(self):
        self.session = {
            "EDIT_SESSION_ID": 31,
            "PROJECT_ID": 22,
            "SCENARIO_ID": 7,
            "SESSION_STATUS": "EDITING",
            "TARGET_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_TABLE": "INITDN$_DATA",
        }

    def test_cancel_sql_preserves_execution_history_and_edit_table(self):
        sql = SqlLoader.get_sql("MCOMMON_EDIT_SESSION_CANCEL").upper()

        self.assertIn('UPDATE "INIT$_TB_EDIT_SESSION"', sql)
        self.assertIn("SET SESSION_STATUS = 'CANCELLED'", sql)
        self.assertIn(
            "SESSION_STATUS IN ('DRAFT', 'EDITING', 'VALIDATED', 'APPLY_READY')",
            sql,
        )
        self.assertNotIn("DELETE FROM", sql)
        self.assertNotIn("DROP TABLE", sql)

    @patch.object(edit_work_service, "_event")
    @patch.object(edit_work_service, "_fetch_all", return_value=[])
    @patch.object(edit_work_service, "_require_session_table_mapping")
    @patch.object(edit_work_service, "_select_session")
    @patch.object(edit_work_service, "_get_user_text", return_value="tester")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_cancel_marks_active_execution_without_deleting_objects(
        self,
        get_connection,
        _get_user_text,
        select_session,
        require_mapping,
        _fetch_all,
        event,
    ):
        connection = _Connection()
        get_connection.return_value = connection
        select_session.return_value = self.session

        result = edit_work_service.cancel_session(object(), 31)

        executed_sql = [sql.upper() for sql, _params in connection.cursor_instance.executions]
        self.assertEqual(1, len(executed_sql))
        self.assertFalse(any("DELETE FROM" in sql or "DROP TABLE" in sql for sql in executed_sql))
        require_mapping.assert_called_once_with(connection.cursor_instance, self.session)
        event.assert_called_once()
        self.assertEqual("CANCELLED", result["sessionStatus"])
        self.assertTrue(connection.committed)
        self.assertFalse(connection.rolled_back)

    @patch.object(edit_work_service, "_fetch_all", return_value=[{"DML_STATUS": "EXECUTED"}])
    @patch.object(edit_work_service, "_require_session_table_mapping")
    @patch.object(edit_work_service, "_select_session")
    @patch.object(edit_work_service, "_get_user_text", return_value="tester")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_cancel_rejects_execution_with_applied_dml(
        self,
        get_connection,
        _get_user_text,
        select_session,
        _require_mapping,
        _fetch_all,
    ):
        connection = _Connection()
        get_connection.return_value = connection
        select_session.return_value = self.session

        with self.assertRaises(HTTPException) as raised:
            edit_work_service.cancel_session(object(), 31)

        self.assertEqual(409, raised.exception.status_code)
        self.assertTrue(connection.rolled_back)
        self.assertFalse(connection.committed)
        self.assertEqual([], connection.cursor_instance.executions)

    @patch.object(edit_work_service, "_event")
    @patch.object(edit_work_service, "_fetch_all", return_value=[])
    @patch.object(edit_work_service, "_require_session_table_mapping")
    @patch.object(edit_work_service, "_select_session")
    @patch.object(edit_work_service, "_get_user_text", return_value="tester")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_cancel_rolls_back_after_concurrent_status_change(
        self,
        get_connection,
        _get_user_text,
        select_session,
        _require_mapping,
        _fetch_all,
        event,
    ):
        connection = _Connection(rowcount=0)
        get_connection.return_value = connection
        select_session.return_value = self.session

        with self.assertRaises(HTTPException) as raised:
            edit_work_service.cancel_session(object(), 31)

        self.assertEqual(409, raised.exception.status_code)
        self.assertTrue(connection.rolled_back)
        self.assertFalse(connection.committed)
        event.assert_not_called()


if __name__ == "__main__":
    unittest.main()
