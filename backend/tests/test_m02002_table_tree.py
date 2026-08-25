from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from backend.routers import M02002


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class M02002TableTreeTests(unittest.TestCase):
    def test_table_tree_returns_rows_without_save_timing_state(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        query_result = {
            "status": "success",
            "data": [
                {
                    "OWNER": "INIT$EDIT01",
                    "TABLE_NAME": "INITUP$SAMPLE",
                }
            ],
            "columns": ["OWNER", "TABLE_NAME"],
        }

        with (
            patch.object(M02002, "get_target_db_connection", return_value=connection),
            patch.object(M02002, "ensure_upload_table_metadata"),
            patch.object(M02002, "get_table_exclude_patterns", return_value=[]),
            patch.object(M02002, "get_table_include_owner_patterns", return_value=["INIT$EDIT01"]),
            patch.object(M02002, "execute_query", return_value=query_result),
        ):
            response = M02002.get_table_tree(
                request=MagicMock(),
                keyword="",
                offset=0,
                limit=200,
                registeredOnly="N",
                projectId=None,
                scenarioId=None,
            )

        self.assertEqual(response["status"], "success")
        self.assertEqual(response["data"], query_result["data"])
        self.assertEqual(response["total"], 1)
        self.assertFalse(response["hasMore"])
        cursor.close.assert_called_once()
        connection.close.assert_called_once()

    def test_project_context_changes_are_coalesced_cancelled_and_serialized(self):
        source = (PROJECT_ROOT / "frontend" / "js" / "M02002.js").read_text(encoding="utf-8")
        method_start = source.index("async handleContextProjectChange(projectId)")
        method_end = source.index("async loadContextScenarios", method_start)
        method = source[method_start:method_end]

        self.assertIn("CONTEXT_CHANGE_DEBOUNCE_MS", source)
        self.assertIn("this.cancelContextRequests({ includeProjectList: true })", method)
        self.assertNotIn("Promise.all", method)
        self.assertLess(method.index("await this.loadContextScenarios"), method.index("await this.loadTableTree"))
        self.assertLess(method.index("await this.loadTableTree"), method.index("await this.loadScenarioTables"))
        self.assertIn("signal: controller.signal", source)


if __name__ == "__main__":
    unittest.main()
