import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.routers import home


class FakeCursor:
    def __init__(self):
        self.executions = []
        self.description = []
        self.mode = ""
        self.closed = False

    def execute(self, sql, params=None):
        self.executions.append((sql, params or {}))
        self.mode = sql
        if sql == "HOME_NOTICE_FILES_FOR_NOTICES":
            self.description = [
                ("FILE_ID",),
                ("NOTICE_ID",),
                ("FILE_NAME",),
                ("CONTENT_TYPE",),
                ("FILE_SIZE",),
                ("SORT_ORDER",),
                ("CREATED_AT",),
            ]

    def fetchall(self):
        if self.mode == "HOME_ACTIVE_NOTICES":
            return [
                (1, "INFO", "Notice 1", "Content 1", "N", "Y", None, None, 7, None, "User", "user1"),
                (2, "WARNING", "Notice 2", "Content 2", "N", "N", None, None, 7, None, "User", "user1"),
            ]
        if self.mode == "HOME_NOTICE_FILES_FOR_NOTICES":
            return [
                (11, 1, "one.txt", "text/plain", 3, 1, None),
                (12, 2, "two.txt", "text/plain", 3, 1, None),
            ]
        return []

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, cursor=None):
        self.cursor_value = cursor or FakeCursor()
        self.closed = False
        self.call_timeout = 0

    def cursor(self):
        return self.cursor_value

    def close(self):
        self.closed = True


class HomeDashboardOptimizationTests(unittest.TestCase):
    def setUp(self):
        home._TARGET_SCHEMA_CACHE.clear()
        home._NOTICE_SCHEMA_CACHE = None

    def test_dashboard_rejects_unknown_section(self):
        with self.assertRaises(HTTPException) as raised:
            home._normalize_dashboard_sections("workflow,unknown")

        self.assertEqual(raised.exception.status_code, 400)

    def test_workflow_refresh_does_not_acquire_system_connection(self):
        target = {"connected": True, "flowTrend": [], "recentFlowRuns": []}
        with patch.object(home, "get_request_user_id", return_value=7), patch.object(
            home,
            "get_request_role_code",
            return_value="USER",
        ), patch.object(home, "get_target_connection_id", return_value=3), patch.object(
            home,
            "_get_target_summary",
            return_value=target,
        ) as target_summary, patch.object(home, "get_db_connection") as system_connection:
            result = home.dashboard(object(), "workflow")

        self.assertEqual(result["target"], target)
        self.assertNotIn("system", result)
        self.assertNotIn("notices", result)
        system_connection.assert_not_called()
        target_summary.assert_called_once()

    def test_initial_dashboard_reuses_one_system_connection(self):
        cursor = FakeCursor()
        connection = FakeConnection(cursor)
        with patch.object(home, "get_request_user_id", return_value=7), patch.object(
            home,
            "get_request_role_code",
            return_value="USER",
        ), patch.object(home, "get_target_connection_id", return_value=3), patch.object(
            home,
            "get_db_connection",
            return_value=connection,
        ) as system_connection, patch.object(
            home,
            "_get_system_summary",
            return_value={"connection": {"connectionId": 3}},
        ) as system_summary, patch.object(
            home,
            "_get_active_system_notices",
            return_value=[],
        ) as notices, patch.object(
            home,
            "_get_target_summary",
            return_value={"connected": True, "flowTrend": [], "recentFlowRuns": []},
        ):
            result = home.dashboard(object())

        system_connection.assert_called_once()
        self.assertIs(system_summary.call_args.kwargs["cursor"], cursor)
        self.assertIs(notices.call_args.kwargs["cursor"], cursor)
        self.assertTrue(connection.closed)
        self.assertEqual(result["sections"], ["notices", "system", "workflow"])

    def test_notice_attachments_are_loaded_in_one_batch(self):
        cursor = FakeCursor()
        with patch.object(
            home,
            "_get_notice_table_status",
            return_value={"INIT$_TB_NOTICE", "INIT$_TB_NOTICE_FILE"},
        ), patch.object(home.SqlLoader, "get_sql", side_effect=lambda sql_id: sql_id):
            notices = home._get_active_system_notices(20, cursor=cursor)

        self.assertEqual(len(cursor.executions), 2)
        self.assertEqual(cursor.executions[0][0], "HOME_ACTIVE_NOTICES")
        self.assertEqual(cursor.executions[1][0], "HOME_NOTICE_FILES_FOR_NOTICES")
        self.assertEqual(cursor.executions[1][1], {"noticeId0": 1, "noticeId1": 2})
        self.assertEqual(notices[0]["attachments"][0]["FILE_ID"], 11)
        self.assertEqual(notices[1]["attachments"][0]["FILE_ID"], 12)

    def test_target_summary_executes_only_flow_dashboard_queries(self):
        cursor = FakeCursor()
        connection = FakeConnection(cursor)
        existing = {name: True for name in home.TARGET_TABLES}
        executed_sql_ids = []

        def record_target_execute(target_cursor, sql_id, _params=None):
            executed_sql_ids.append(sql_id)
            target_cursor.mode = sql_id
            target_cursor.description = []
            return target_cursor

        with patch.object(home, "get_target_db_connection", return_value=connection), patch.object(
            home,
            "_get_target_table_status",
            return_value=existing,
        ), patch.object(home, "_target_execute", side_effect=record_target_execute):
            result = home._get_target_summary(object(), 7, 3, False)

        self.assertEqual(executed_sql_ids, ["HOME_FLOW_RUN_TREND", "HOME_RECENT_FLOW_RUNS"])
        self.assertNotIn("counts", result)
        self.assertNotIn("ruleTrend", result)
        self.assertTrue(connection.closed)

    def test_target_schema_status_is_reused_during_cache_ttl(self):
        existing = {name: True for name in home.TARGET_TABLES}
        cursor = FakeCursor()
        with patch.object(home, "_count_existing_tables", return_value=existing) as table_query, patch.object(
            home,
            "_schema_cache_seconds",
            return_value=60.0,
        ):
            first = home._get_target_table_status(cursor, 3)
            second = home._get_target_table_status(cursor, 3)

        self.assertEqual(first, existing)
        self.assertEqual(second, existing)
        table_query.assert_called_once_with(cursor, home.TARGET_TABLES)

    def test_optimized_sql_uses_grouped_node_counts_and_batch_notice_binds(self):
        recent_runs_sql = SqlLoader.get_sql("HOME_RECENT_FLOW_RUNS").upper()
        notice_files_sql = SqlLoader.get_sql("HOME_NOTICE_FILES_FOR_NOTICES").upper()

        self.assertIn("NODE_COUNTS AS", recent_runs_sql)
        self.assertIn("GROUP BY NR.FLOW_RUN_ID", recent_runs_sql)
        self.assertNotIn("SELECT COUNT(*)", recent_runs_sql)
        self.assertIn("/* --NOTICE_BINDS-- */", notice_files_sql)


if __name__ == "__main__":
    unittest.main()
