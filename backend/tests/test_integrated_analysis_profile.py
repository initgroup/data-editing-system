import json
import unittest

from backend.services.mixed_analysis_profile import describe_rows, relate_rows


def columns(*pairs):
    return [{"COLUMN_NAME": name, "DATA_TYPE": kind, "DATA_LENGTH": 4000 if kind == "VARCHAR2" else 22}
            for name, kind in pairs]


class IntegratedProfileTests(unittest.TestCase):
    def test_dirty_numeric_semantics_separate_invalid_missing_and_identifier(self):
        rows = [{"ROW_KEY": str(i), "AMOUNT": str(i * 1.25), "CODE": "001" if i % 2 else "002"}
                for i in range(200)]
        rows[8]["AMOUNT"] = "typo"
        rows[9]["AMOUNT"] = "   "
        result = describe_rows(rows, columns(("ROW_KEY", "VARCHAR2"), ("AMOUNT", "VARCHAR2"), ("CODE", "VARCHAR2")))
        identifier, amount, code = result["columns"]
        self.assertEqual("IDENTIFIER", identifier["SEMANTIC_TYPE"])
        self.assertEqual("CONTINUOUS", amount["SEMANTIC_TYPE"])
        self.assertEqual("CATEGORICAL", code["SEMANTIC_TYPE"])
        self.assertEqual(1, amount["INVALID_NUMERIC_COUNT"])
        self.assertEqual(1, amount["BLANK_TEXT_COUNT"])
        self.assertEqual("NUMERIC_TEXT", amount["NUMERIC_SOURCE"])
        self.assertIsNone(code["NUMERIC_SOURCE"])
        self.assertEqual("LEADING_ZERO_CODE", code["NUMERIC_INFERENCE"]["reason"])
        json.dumps(result, allow_nan=False)

    def test_categorical_relationship_without_numeric_correlation_gate(self):
        rows = [{"REGION": "A" if i % 2 else "B", "CATEGORY": "X" if i % 2 else "Y", "AMOUNT": i}
                for i in range(200)]
        result = relate_rows(rows, columns(("REGION", "VARCHAR2"), ("CATEGORY", "VARCHAR2"), ("AMOUNT", "NUMBER")))
        self.assertEqual([], result["correlationPairs"])
        self.assertAlmostEqual(1., result["categoricalPairs"][0]["CRAMERS_V"])
        self.assertEqual("BIAS_CORRECTED_CRAMERS_V", result["categoricalPairs"][0]["METRIC"])
        self.assertEqual(2, result["categoricalNumericPairCount"])

    def test_categorical_numeric_effect_and_missing_pairwise_coverage(self):
        rows = [{"REGION": "A" if i < 100 else "B", "AMOUNT": float(i % 100) + (0 if i < 100 else 10000)}
                for i in range(200)]
        rows[0]["REGION"] = None
        rows[100]["AMOUNT"] = None
        result = relate_rows(rows, columns(("REGION", "VARCHAR2"), ("AMOUNT", "NUMBER")))
        pair = result["categoricalNumericPairs"][0]
        self.assertGreater(pair["CORRELATION_RATIO"], .99)
        self.assertEqual(198, pair["PAIR_COUNT"])
        self.assertEqual(.99, pair["COVERAGE"])
        self.assertEqual(99, pair["MIN_GROUP_COUNT"])
        json.dumps(result, allow_nan=False)

    def test_sparse_categories_limits_and_nonfinite_values_are_explicit(self):
        metadata = columns(*[(f"C{i}", "VARCHAR2") for i in range(5)], ("AMOUNT", "NUMBER"))
        rows = [{**{f"C{j}": "A" if i % (j + 2) else "B" for j in range(5)}, "AMOUNT": i}
                for i in range(100)]
        rows[1]["AMOUNT"] = float("inf")
        result = relate_rows(rows, metadata, max_categorical_columns=3, max_mixed_pairs=2, max_pairs=1)
        self.assertEqual(3, result["categoricalColumnCount"])
        self.assertEqual(2, len(result["excludedCategoricalColumns"]))
        self.assertEqual(3, result["categoricalCandidatePairCount"])
        self.assertEqual(2, result["categoricalPairCount"])
        self.assertTrue(result["categoricalPairsTruncated"])
        self.assertTrue(result["categoricalNumericPairsTruncated"])
        self.assertEqual(1, len(result["categoricalNumericPairs"]))
        json.dumps(result, allow_nan=False)

    def test_identifier_does_not_become_categorical_relationship(self):
        rows = [{"PERSON_ID": i, "GROUP_CODE": "A" if i % 2 else "B", "AMOUNT": i / 2}
                for i in range(100)]
        result = relate_rows(rows, columns(("PERSON_ID", "NUMBER"), ("GROUP_CODE", "VARCHAR2"), ("AMOUNT", "NUMBER")))
        self.assertEqual(1, result["categoricalNumericPairCount"])
        self.assertEqual("AMOUNT", result["categoricalNumericPairs"][0]["COLUMN_Y"])


if __name__ == "__main__":
    unittest.main()
