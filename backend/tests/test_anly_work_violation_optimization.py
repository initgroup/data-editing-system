import unittest

from backend.services import anly_work_service


class FakeViolationCursor:
    def __init__(self, violation_count: int):
        self.violation_count = violation_count
        self.description = []
        self._rows = []
        self.executed = []

    def execute(self, sql, params=None):
        sql_text = str(sql)
        self.executed.append((sql_text, dict(params or {})))
        if sql_text.startswith("SELECT COUNT(*) AS VIOLATION_COUNT"):
            self.description = [
                ("VIOLATION_COUNT",),
                ("VIOLATED_ROW_COUNT",),
                ("VIOLATED_RULE_COUNT",),
                ("AVG_VIOLATION_SCORE",),
                ("MAX_VIOLATION_SCORE",),
                ("AVG_RULE_CONFIDENCE",),
                ("MAX_RULE_CONFIDENCE",),
            ]
            self._rows = [(
                self.violation_count,
                self.violation_count,
                1 if self.violation_count else 0,
                0.5 if self.violation_count else None,
                0.5 if self.violation_count else None,
                0.9 if self.violation_count else None,
                0.9 if self.violation_count else None,
            )]
            return
        if "GROUP BY GROUPING SETS" in sql_text:
            self.description = [
                ("IS_TOTAL",),
                ("CONDITION_COUNT",),
                ("TOTAL_RULES",),
                ("RULE_COUNT",),
                ("MAPPED_RULES",),
                ("MISSING_RESULT_RULES",),
                ("NON_PERFECT_CONF_RULES",),
                ("MODEL_TYPE",),
                ("RULE_SOURCE",),
                ("AVG_SUPPORT",),
                ("AVG_CONFIDENCE",),
                ("AVG_LIFT",),
                ("MAX_SUPPORT",),
                ("MAX_CONFIDENCE",),
                ("MAX_LIFT",),
            ]
            self._rows = [
                (1, None, 5, 5, 5, 0, 4, "APRIORI", "MODEL", 0.2, 0.9, 1.2, 0.3, 0.95, 1.5),
                (0, 2, 5, 5, 5, 0, 4, "APRIORI", "MODEL", 0.2, 0.9, 1.2, 0.3, 0.95, 1.5),
            ]
            return
        if "DETECTABLE_RULE_COUNT" in sql_text:
            self.description = [
                ("CANDIDATE_RULE_COUNT",),
                ("CONFIDENCE_CUTOFF_COUNT",),
                ("LIFT_CUTOFF_COUNT",),
                ("DETECTION_ELIGIBLE_RULE_COUNT",),
                ("MAX_RULES_CUTOFF_COUNT",),
                ("MIN_DETECTION_RN",),
                ("MAX_DETECTION_RN",),
            ]
            self._rows = [(4, 0, 0, 4, 0, 1, 4)]
            return
        if "WITH VIOLATION_BASE AS" in sql_text and "RANKED_RULES AS" in sql_text:
            self.description = [
                ("RULE_OWNER",),
                ("MODEL_NAME",),
                ("RUN_SOURCE_TYPE",),
                ("RUN_ID",),
                ("RULE_ID",),
                ("CONDITION_COUNT",),
                ("CONDITION_TEXT",),
                ("RESULT_COLUMN",),
                ("EXPECTED_VALUE",),
                ("VIOLATION_COUNT",),
                ("VIOLATED_ROW_COUNT",),
                ("AVG_VIOLATION_SCORE",),
                ("DETECTION_RN",),
                ("DETECTION_SCANNED_YN",),
                ("RULE_SUPPORT",),
                ("RULE_CONFIDENCE",),
                ("RULE_LIFT",),
                ("RN__",),
                ("TOTAL_COUNT",),
            ]
            self._rows = [(
                "OWNER1", "MODEL1", "FLOW_WORK", 1182, "RULE1", 2,
                "COL1=A", "COL2", "B", self.violation_count, 1, 0.5,
                None, "Y", 0.2, 0.9, 1.2, 1, 1,
            )]
            return
        if "GROUP BY RESULT_COLUMN" in sql_text:
            self.description = [
                ("RESULT_COLUMN",),
                ("VIOLATION_COUNT",),
                ("VIOLATED_ROW_COUNT",),
                ("AVG_VIOLATION_SCORE",),
            ]
            self._rows = [("COL2", self.violation_count, 1, 0.5)]
            return
        if "ALL_COL_COMMENTS" in sql_text:
            self.description = [("COLUMN_NAME",), ("COLUMN_COMMENT",)]
            self._rows = [("COL2", "결과 컬럼")]
            return
        raise AssertionError(f"Unexpected SQL: {sql_text[:160]}")

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class AnalysisViolationOptimizationTests(unittest.TestCase):
    def fetch_summary(self, violation_count: int):
        cursor = FakeViolationCursor(violation_count)
        summary = anly_work_service._fetch_rule_violation_summary(
            cursor,
            "OWNER1",
            "INIT$_TB_RULEVIOL_ASSOC",
            "OWNER1",
            "TARGET1",
            "MODEL1",
            run_source_type="FLOW_WORK",
            run_id=1182,
        )
        return cursor, summary

    def test_zero_hit_result_skips_ranked_rules_and_top_columns(self):
        cursor, summary = self.fetch_summary(0)
        executed_sql = "\n".join(sql for sql, _params in cursor.executed)

        self.assertEqual(summary["overview"]["VIOLATION_COUNT"], 0)
        self.assertEqual(summary["topRules"], [])
        self.assertEqual(summary["topColumns"], [])
        self.assertNotIn("DETECTABLE_ALL", executed_sql)
        self.assertNotIn("RANKED_RULES AS", executed_sql)
        self.assertNotIn("GROUP BY RESULT_COLUMN", executed_sql)
        self.assertEqual(len(cursor.executed), 4)

    def test_hit_result_uses_violation_driven_fast_query(self):
        cursor, summary = self.fetch_summary(3)
        executed_sql = "\n".join(sql for sql, _params in cursor.executed)

        self.assertIn("WITH VIOLATION_BASE AS", executed_sql)
        self.assertIn("RANKED_RULES AS", executed_sql)
        self.assertNotIn("DETECTABLE_ALL", executed_sql)
        self.assertEqual(summary["topRuleTotal"], 1)
        self.assertEqual(summary["topRules"][0]["RULE_ID"], "RULE1")
        self.assertNotIn("RN__", summary["topRules"][0])
        self.assertNotIn("TOTAL_COUNT", summary["topRules"][0])
        self.assertEqual(summary["columnComments"], {"COL2": "결과 컬럼"})
        self.assertEqual(len(cursor.executed), 6)


if __name__ == "__main__":
    unittest.main()
