import json
import unittest
from unittest.mock import Mock, patch

from backend.services.mixed_analysis_profile import describe_rows, relate_rows
from backend.services import mixed_analysis_profile_service as service

COLUMNS = [{"COLUMN_NAME": name, "DATA_TYPE": dtype, "DATA_LENGTH": 30} for name, dtype in [("A", "NUMBER"), ("B", "NUMBER"), ("C", "VARCHAR2")]]
ROWS = [{"A": n, "B": 2 * n, "C": "x"} for n in range(10)] + [{"A": None, "B": 100, "C": "y"}, {"A": None, "B": 100, "C": "y"}]


class MixedProfileTests(unittest.TestCase):
    def test_profile_reports_missing_distinct_distribution_and_duplicate_rows(self):
        result = describe_rows(ROWS, COLUMNS, sampling={"sampling": "FIRST_ROWS", "sampleLimit": 100}, source_column_count=5)
        a, _, c = result["columns"]
        self.assertEqual(2, a["NULL_COUNT"])
        self.assertEqual(10, a["DISTINCT_COUNT"])
        self.assertEqual(4.5, a["MEAN"])
        self.assertEqual(4.5, a["MEDIAN"])
        self.assertEqual(1, a["ZERO_COUNT"])
        self.assertEqual(1, result["duplicateRowCount"])
        self.assertEqual(2, result["skippedColumnCount"])
        self.assertEqual({"value": "x", "count": 10, "rate": 10 / 12}, c["TOP_VALUES"][0])

    def test_pairwise_coverage_and_no_false_correlation_for_constant_columns(self):
        result = relate_rows(ROWS, COLUMNS)
        pair = result["correlationPairs"][0]
        self.assertAlmostEqual(1, pair["CORRELATION"])
        self.assertEqual(10, pair["PAIR_COUNT"])
        self.assertAlmostEqual(10 / 12, pair["COVERAGE"])
        self.assertEqual(2, result["missingColumns"][0]["NULL_COUNT"])
        constant = relate_rows([{"A": 1, "B": n} for n in range(10)], COLUMNS[:2])
        self.assertIsNone(constant["correlationPairs"][0]["CORRELATION"])

    def test_exact_duplicate_columns_and_analysis_limits_are_explicit(self):
        rows = [{"A": n, "B": float(n), "C": str(n)} for n in range(5)]
        result = relate_rows(rows, COLUMNS, max_numeric_columns=1, max_pairs=1)
        self.assertEqual(1, result["skippedNumericColumnCount"])
        self.assertEqual(0, result["pairCount"])
        self.assertEqual([{"COLUMN_X": "A", "COLUMN_Y": "B", "MATCH_COUNT": 5, "COVERAGE": 1.0}], result["duplicateColumns"])
        self.assertEqual(0, describe_rows([], COLUMNS)["sampleCount"])

    def test_extreme_finite_values_produce_json_safe_statistics(self):
        rows = [{"A": value, "B": value} for value in [1e308, -1e308, 0, float("inf")]]
        result = describe_rows(rows, COLUMNS[:2])
        self.assertEqual(1, result["columns"][0]["INVALID_NUMERIC_COUNT"])
        self.assertEqual(0, result["columns"][0]["MEAN"])
        json.dumps(result, allow_nan=False)
        relationship = relate_rows(rows, COLUMNS[:2])
        self.assertAlmostEqual(1, relationship["correlationPairs"][0]["CORRELATION"])
        json.dumps(relationship, allow_nan=False)

    def test_profile_service_preflights_schema_and_preserves_existing_diagnostics(self):
        cursor = Mock()
        cursor.fetchone.return_value = (json.dumps({"algorithm": "MIXED_PATTERN_TREE", "ruleCount": 4, "relationships": {"old": True}}),)
        conn = Mock()
        conn.cursor.return_value.__enter__ = Mock(return_value=cursor)
        conn.cursor.return_value.__exit__ = Mock(return_value=False)
        ctx = {"owner": "OWNER", "tableName": "INITUP$T", "runSourceType": "FLOW_WORK", "runId": 2}
        with patch.object(service.xai, "context", return_value=ctx), patch.object(service.patterns, "require_schema") as schema, \
             patch.object(service.patterns, "_sample", return_value=(ROWS, COLUMNS, COLUMNS, {"sampling": "FIRST_ROWS", "sampleLimit": 100})), \
             patch.object(service.xai, "_rows", return_value=[{"COLUMN_NAME": "A", "COLUMN_COMMENT": "값"}]), \
             patch.object(service.xai, "_execute") as execute:
            result = service._run(conn, {}, relation=False)
        schema.assert_called_once_with(cursor)
        stored = json.loads(execute.call_args.args[2]["summaryJson"])
        self.assertEqual(4, stored["ruleCount"])
        self.assertEqual({"old": True}, stored["relationships"])
        self.assertEqual("값", stored["profile"]["columns"][0]["COLUMN_COMMENT"])
        self.assertEqual("INIT$_TB_XAI_RUN", result["resultTable"])
        self.assertEqual("XAI_UPDATE_RUN", execute.call_args.args[1])
        conn.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
