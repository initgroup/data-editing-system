import re
import unittest
from unittest.mock import ANY, patch

from backend.database_helper import SqlLoader
from backend.services import edit_work_service


class _AggregateCursor:
    def __init__(self):
        self.executions = []
        self.description = []

    def execute(self, sql, params):
        aliases = re.findall(r"AS (RULE_\d+_COUNT)", sql)
        self.executions.append((sql, params))
        self.description = [(alias,) for alias in aliases]

    def fetchone(self):
        return tuple(range(1, len(self.description) + 1))


class M05003ValidationPerformanceTests(unittest.TestCase):
    TABLE_COLUMNS = {
        "COL_A": {"COLUMN_NAME": "COL_A", "DATA_TYPE": "VARCHAR2"},
        "COL_B": {"COLUMN_NAME": "COL_B", "DATA_TYPE": "VARCHAR2"},
    }

    @staticmethod
    def _rule(edit_rule_id):
        return {
            "EDIT_RULE_ID": edit_rule_id,
            "RULE_NAME": f"RULE_{edit_rule_id}",
            "SOURCE_RULE_TYPE": "ASSOCIATION",
            "USER_RULE_YN": "N",
            "SOURCE_RULE_ID": f"COND_{edit_rule_id}",
            "TARGET_COLUMN": "COL_B",
            "RULE_EXPRESSION": "COL_A = 'X'",
            "EXPECTED_VALUE": "Y",
        }

    @patch.object(edit_work_service, "_table_column_map", return_value=TABLE_COLUMNS)
    def test_many_rules_share_one_table_scan_per_batch(self, _table_column_map):
        cursor = _AggregateCursor()

        rows = edit_work_service._evaluate_rules_on_table(
            cursor,
            [self._rule(index) for index in range(1, 101)],
            target_owner="INIT$EDIT01",
            target_table="INITUP$_DATA",
        )

        self.assertEqual(1, len(cursor.executions))
        sql, params = cursor.executions[0]
        self.assertEqual(1, sql.count('FROM "INIT$EDIT01"."INITUP$_DATA" T'))
        self.assertNotIn("UNION ALL", sql.upper())
        self.assertEqual(100, len(params))
        self.assertEqual(100, len(rows))
        self.assertEqual(1, rows[0]["VIOLATION_COUNT"])
        self.assertEqual(100, rows[-1]["VIOLATION_COUNT"])

    @patch.object(edit_work_service, "_table_column_map", return_value=TABLE_COLUMNS)
    def test_rules_over_batch_limit_use_bounded_scans(self, _table_column_map):
        cursor = _AggregateCursor()

        rows = edit_work_service._evaluate_rules_on_table(
            cursor,
            [self._rule(index) for index in range(1, 102)],
            target_owner="INIT$EDIT01",
            target_table="INITUP$_DATA",
        )

        self.assertEqual(2, len(cursor.executions))
        self.assertEqual(101, len(rows))

    def test_session_summary_aggregates_each_history_table_once(self):
        sql = SqlLoader.get_sql("MCOMMON_EDIT_SESSION_LIST").upper()

        self.assertIn("WITH SESSION_SCOPE AS", sql)
        self.assertIn("CHANGE_SUMMARY AS", sql)
        self.assertIn("DML_SUMMARY AS", sql)
        self.assertIn("RULE_SUMMARY AS", sql)
        self.assertEqual(1, sql.count('FROM "INIT$_TB_EDIT_CHANGE" C'))
        self.assertNotIn("(SELECT COUNT(", sql)

    def test_validation_change_query_uses_database_top_n_page(self):
        sql = SqlLoader.get_sql("MCOMMON_EDIT_VALIDATION_CHANGE_PAGE").upper()

        self.assertIn("ROW_NUMBER() OVER", sql)
        self.assertIn("P.RN__ > :OFFSET", sql)
        self.assertIn("P.RN__ <= :ENDROW", sql)

    @patch.object(edit_work_service, "_evaluate_rules_on_table")
    @patch.object(edit_work_service, "_count_session_violations")
    @patch.object(edit_work_service, "_edit_rule_tolerance_column_exists", return_value=False)
    @patch.object(edit_work_service, "_fetch_all")
    @patch.object(edit_work_service, "_fetch_one")
    def test_summary_mode_skips_full_rule_evaluation(
        self,
        fetch_one,
        fetch_all,
        _tolerance_exists,
        count_violations,
        evaluate_rules,
    ):
        fetch_one.return_value = {
            "TOTAL_CHANGE_COUNT": 1,
            "APPLIED_CHANGE_COUNT": 1,
        }
        result = edit_work_service._build_validation_data(
            object(),
            {
                "SESSION_STATUS": "EDITING",
                "SOURCE_ROW_COUNT": 10,
                "TARGET_OWNER": "INIT$EDIT01",
                "SOURCE_TABLE": "INITUP$_DATA",
                "EDIT_TABLE": "INITDN$_DATA",
            },
            41,
            evaluate_rules=False,
        )

        evaluate_rules.assert_not_called()
        count_violations.assert_not_called()
        fetch_all.assert_not_called()
        self.assertEqual("EDIT_EXECUTION_SUMMARY", result["ANALYSIS_SOURCE"])
        self.assertFalse(result["FULL_ANALYSIS_READY"])
        self.assertEqual(1, result["EDIT_ANALYSIS"]["OVERALL"]["APPLIED_CHANGE_COUNT"])

    @patch.object(edit_work_service, "_attach_column_metadata")
    @patch.object(edit_work_service, "_fetch_all")
    @patch.object(edit_work_service, "_fetch_one")
    def test_validation_change_rows_are_loaded_by_database_page(
        self,
        fetch_one,
        fetch_all,
        attach_column_metadata,
    ):
        fetch_one.return_value = {"TOTAL_COUNT": 235}
        fetch_all.return_value = [
            {
                "EDIT_CHANGE_ID": 77,
                "COLUMN_NAME": "COL_B",
                "RN__": 101,
            }
        ]

        result = edit_work_service._load_validation_change_page(
            object(),
            {
                "TARGET_OWNER": "INIT$EDIT01",
                "SOURCE_TABLE": "INITUP$_DATA",
            },
            41,
            keyword="case-1",
            page=2,
            page_size=100,
        )

        self.assertEqual(235, result["CHANGE_TOTAL"])
        self.assertEqual(2, result["CHANGE_PAGE"])
        self.assertEqual(1, len(result["CHANGE_ROWS"]))
        self.assertNotIn("RN__", result["CHANGE_ROWS"][0])
        fetch_all.assert_called_once_with(
            ANY,
            "MCOMMON_EDIT_VALIDATION_CHANGE_PAGE",
            {
                "editSessionId": 41,
                "keyword": "case-1",
                "offset": 100,
                "endRow": 200,
            },
        )
        attach_column_metadata.assert_called_once()


if __name__ == "__main__":
    unittest.main()
