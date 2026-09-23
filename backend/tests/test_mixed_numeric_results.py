"""Imported numeric text must survive statistics and result-summary boundaries."""
import json
import unittest

from backend.services import mixed_analysis_profile as profiles
from backend.services import mixed_pattern_service as patterns
from backend.tests.test_mixed_pattern_service import SqlConnection, stored_rule


class MixedNumericResultTests(unittest.TestCase):
    def test_upload_shaped_columns_report_numeric_statistics_without_changing_physical_types(self):
        columns = [{"COLUMN_NAME": name, "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 4000}
                   for name in ("X", "Y", "CODE", "CATEGORY")]
        rows = [{"X": str(n / 10), "Y": str(2 * n / 10 + 3), "CODE": f"{n:03d}",
                 "CATEGORY": str(n % 3)} for n in range(1, 101)]
        rows.append({"X": None, "Y": None, "CODE": "001", "CATEGORY": "0"})
        profile = profiles.describe_rows(rows, columns)
        self.assertEqual(profile["numericTextColumnCount"], 2)
        x, y, code, category = profile["columns"]
        self.assertEqual(x["DATA_TYPE"], "VARCHAR2")
        self.assertEqual(x["NUMERIC_SOURCE"], "NUMERIC_TEXT")
        self.assertAlmostEqual(x["MEAN"], 5.05)
        self.assertAlmostEqual(y["MEAN"], 13.1)
        self.assertEqual(x["NULL_COUNT"], 1)
        self.assertIn("NUMERIC_TEXT_INFERRED", x["NUMERIC_WARNINGS"])
        self.assertIsNone(code["MEAN"])
        self.assertIsNone(category["MEAN"])
        relations = profiles.relate_rows(rows, columns, profile=profile)
        self.assertEqual(relations["numericTextColumnCount"], 2)
        self.assertEqual(relations["pairCount"], 1)
        self.assertEqual(relations["correlationPairs"][0]["PAIR_COUNT"], 100)
        self.assertAlmostEqual(relations["correlationPairs"][0]["CORRELATION"], 1)
        json.dumps({"profile": profile, "relationships": relations}, allow_nan=False)

    def test_mixed_text_and_format_codes_are_not_silently_coerced_into_statistics(self):
        columns = [{"COLUMN_NAME": name, "DATA_TYPE": "VARCHAR2"} for name in ("A", "B", "C")]
        rows = [{"A": str(n), "B": str(n), "C": str(n)} for n in range(20)]
        rows[-1].update(A="not a number", B="1,000", C="001")
        profile = profiles.describe_rows(rows, columns)
        self.assertEqual(profile["numericTextColumnCount"], 0)
        self.assertTrue(all(row["MEAN"] is None for row in profile["columns"]))
        self.assertEqual(profiles.relate_rows(rows, columns)["pairCount"], 0)

    def test_api_overview_reports_actual_confidence_and_ignores_absent_formula_lift(self):
        value = stored_rule()
        value.update(RULE_CONFIDENCE=.8, RULE_LIFT=2)
        formula = stored_rule("F1")
        formula.update(RESULT_KIND="FORMULA", RULE_CONFIDENCE=.96, RULE_LIFT=None,
                       RESULT_JSON=json.dumps({"operator": "WITHIN_TOLERANCE", "column": "VALUE",
                           "expression": {"column": "X", "numericText": True}, "numericText": True,
                           "absoluteTolerance": 1, "relativeTolerance": 0}))
        formula["VALIDATION_JSON"] = json.dumps({"discoveryMethod": "SUM_DIFFERENCE",
                                                "coefficientPolicy": "CANONICAL_SIMPLE"})
        summary = patterns.rule_summary([value, formula], {})
        self.assertEqual(summary["overview"]["VALUE_RULE_COUNT"], 1)
        self.assertEqual(summary["overview"]["FORMULA_RULE_COUNT"], 1)
        self.assertEqual(summary["overview"]["RANGE_RULE_COUNT"], 0)
        self.assertAlmostEqual(summary["overview"]["AVG_CONFIDENCE"], .88)
        self.assertEqual(summary["overview"]["AVG_LIFT"], 2)
        self.assertIsNone(patterns.rule_summary([formula], {})["overview"]["AVG_LIFT"])
        self.assertIsNone(patterns.rule_summary([], {})["overview"]["AVG_CONFIDENCE"])
        self.assertEqual(summary["rules"][1]["FORMULA_METHOD"], "SUM_DIFFERENCE")
        self.assertEqual(summary["rules"][1]["COEFFICIENT_POLICY"], "CANONICAL_SIMPLE")
        formula["VALIDATION_JSON"] = "{}"
        historical = patterns.rule_summary([formula], {})["rules"][0]
        self.assertIsNone(historical["FORMULA_METHOD"])
        self.assertIsNone(historical["COEFFICIENT_POLICY"])

    def test_result_api_keeps_invalid_numeric_actual_text_without_decimal_exception(self):
        conn = SqlConnection([])
        self.addCleanup(conn.db.close)
        conn.db.execute("CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS)")
        rule = stored_rule("F_TEXT")
        rule.update(RESULT_KIND="FORMULA", RULE_LIFT=None, RESULT_JSON=json.dumps({
            "operator": "WITHIN_TOLERANCE", "column": "VALUE", "numericText": True,
            "expression": {"column": "OTHER", "numericText": True}, "absoluteTolerance": 1,
            "relativeTolerance": 0}))
        conn.seed_rules([rule])
        conn.insert(patterns.VIOLATION_TABLE, {
            "RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 41, "TARGET_OWNER": "APP_OWNER",
            "TARGET_TABLE": "SOURCE_DATA", "MODEL_NAME": "XAI_PATTERN_41", "RULE_ID": "F_TEXT", "RULE_OWNER": "APP_OWNER",
            "RESULT_COLUMN": "VALUE", "EXPECTED_VALUE": "10", "ACTUAL_VALUE": "invalid",
            "CASE_ID": "1", "VIOLATION_REASON": "PATTERN_FORMULA_MISMATCH"})
        with conn.cursor() as cursor:
            result = patterns.read_pattern_results(cursor,
                {"runId": 41, "owner": "APP_OWNER", "tableName": "SOURCE_DATA"},
                [{"summary": {"algorithm": patterns.ALGORITHM, "algorithmVersion": 2}}])
        row = result["data"]["violations"][0]
        self.assertEqual(row["ACTUAL_VALUE"], "invalid")
        self.assertEqual(row["EXPECTED_LOWER"], "9")
        self.assertEqual(row["EXPECTED_UPPER"], "11")
        self.assertEqual(row["ACTUAL_NUMERIC_VALID_YN"], "N")
        self.assertIsNone(row["RESIDUAL"])
        self.assertIsNone(row["ABS_ERROR"])
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
