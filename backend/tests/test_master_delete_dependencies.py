import inspect
import unittest
from unittest.mock import Mock, call, patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.routers import M01001, M01002, M02002


class MasterDeleteDependencyTests(unittest.TestCase):
    def setUp(self):
        self.conn = Mock()
        self.cursor = Mock()
        self.conn.cursor.return_value = self.cursor
        self.request = Mock()

    def test_project_delete_blocks_flow_dependency_even_without_scenario_table(self):
        self.cursor.fetchone.return_value = (10,)
        child = {
            "SCENARIO_COUNT": 0,
            "SCENARIO_TABLE_COUNT": 0,
            "DATA_WORK_JOB_COUNT": 0,
            "FLOW_WORK_COUNT": 2,
            "EDIT_RULE_COUNT": 0,
            "EDIT_SESSION_COUNT": 0,
            "MANAGED_TABLE_PAIR_COUNT": 0,
        }

        with (
            patch("backend.routers.M01001.get_request_user_id", return_value=7),
            patch("backend.routers.M01001.get_target_db_connection", return_value=self.conn),
            patch("backend.routers.M01001.SqlLoader.get_sql", side_effect=lambda sql_id: sql_id),
            patch(
                "backend.routers.M01001.execute_query",
                return_value={"status": "success", "data": [child]},
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                M01001.delete_project(M01001.ProjectDeleteRequest(projectId=10), self.request)

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("FLOW 2건", str(raised.exception.detail))
        self.cursor.execute.assert_called_once_with(
            "M01001_PROJECT_DELETE_SCOPE_LOCK",
            {"projectId": 10, "userId": 7},
        )
        self.conn.rollback.assert_called_once()
        self.conn.commit.assert_not_called()

    def test_project_delete_cleans_stale_upload_metadata_in_same_transaction(self):
        self.cursor.fetchone.return_value = (10,)
        self.cursor.rowcount = 1
        child = {
            "SCENARIO_COUNT": 0,
            "SCENARIO_TABLE_COUNT": 0,
            "DATA_WORK_JOB_COUNT": 0,
            "FLOW_WORK_COUNT": 0,
            "EDIT_RULE_COUNT": 0,
            "EDIT_SESSION_COUNT": 0,
            "MANAGED_TABLE_PAIR_COUNT": 0,
        }

        with (
            patch("backend.routers.M01001.get_request_user_id", return_value=7),
            patch("backend.routers.M01001.get_target_db_connection", return_value=self.conn),
            patch("backend.routers.M01001.SqlLoader.get_sql", side_effect=lambda sql_id: sql_id),
            patch(
                "backend.routers.M01001.execute_query",
                return_value={"status": "success", "data": [child]},
            ),
        ):
            result = M01001.delete_project(M01001.ProjectDeleteRequest(projectId=10), self.request)

        self.assertEqual(1, result["deletedCount"])
        self.assertEqual("NONE", result["physicalTableAction"])
        self.cursor.execute.assert_has_calls([
            call("M01001_PROJECT_DELETE_SCOPE_LOCK", {"projectId": 10, "userId": 7}),
            call("M01001_UPLOAD_META_DELETE_STALE_BY_PROJECT", {"projectId": 10}),
            call("M01001_PROJECT_DELETE", {"projectId": 10, "userId": 7}),
        ])
        self.conn.commit.assert_called_once()

    def test_scenario_delete_blocks_editing_dependency(self):
        self.cursor.fetchone.return_value = (20,)
        child = {
            "SCENARIO_TABLE_COUNT": 0,
            "DATA_WORK_JOB_COUNT": 0,
            "FLOW_WORK_COUNT": 0,
            "EDIT_RULE_COUNT": 3,
            "EDIT_SESSION_COUNT": 1,
        }

        with (
            patch("backend.routers.M01002.get_request_user_id", return_value=7),
            patch("backend.routers.M01002.get_target_db_connection", return_value=self.conn),
            patch("backend.routers.M01002.SqlLoader.get_sql", side_effect=lambda sql_id: sql_id),
            patch(
                "backend.routers.M01002.execute_query",
                return_value={"status": "success", "data": [child]},
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                M01002.delete_scenario(M01002.ScenarioDeleteRequest(scenarioId=20), self.request)

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("편집 규칙 3건", str(raised.exception.detail))
        self.assertIn("편집 실행 1건", str(raised.exception.detail))
        self.conn.rollback.assert_called_once()
        self.conn.commit.assert_not_called()

    def test_dependency_sql_covers_all_direct_master_references(self):
        project_sql = SqlLoader.get_sql("M01001_PROJECT_CHILD_COUNT")
        scenario_sql = SqlLoader.get_sql("M01002_SCENARIO_CHILD_COUNT")

        for table_name in (
            "INIT$_TB_SCENARIO",
            "INIT$_TB_TABLES",
            "INIT$_TB_DATA_WORK_JOB",
            "INIT$_TB_FLOW_WORK",
            "INIT$_TB_EDIT_RULE",
            "INIT$_TB_EDIT_SESSION",
            "INIT$_TB_UPLOAD_TABLE_META",
        ):
            self.assertIn(table_name, project_sql)
        for table_name in (
            "INIT$_TB_TABLES",
            "INIT$_TB_DATA_WORK_JOB",
            "INIT$_TB_FLOW_WORK",
            "INIT$_TB_EDIT_RULE",
            "INIT$_TB_EDIT_SESSION",
        ):
            self.assertIn(table_name, scenario_sql)

    def test_physical_cleanup_uses_drop_purge_not_truncate(self):
        source = inspect.getsource(M02002.drop_table_if_exists)

        self.assertIn("DROP TABLE", source)
        self.assertIn("PURGE", source)
        self.assertNotIn("TRUNCATE TABLE", source)


if __name__ == "__main__":
    unittest.main()
