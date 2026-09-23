import json
import unittest
from decimal import Decimal

import numpy as np

from backend.services.mixed_xai_algorithm import (
    _branch_predicate,
    analyze_mixed_rows,
    evaluate_predicate,
)


class MixedXaiAlgorithmTests(unittest.TestCase):
    @staticmethod
    def dataset(count=480):
        rng = np.random.default_rng(314)
        rows = []
        for index in range(count):
            unusual = index % 10 == 0
            rows.append({
                "ROW_ID": index + 1,
                "AMOUNT": float(rng.normal(80 if unusual else 10, 2)),
                "COUNT_VALUE": float(rng.normal(40 if unusual else 5, .6)),
                "KIND": "rare" if unusual else ("a" if index % 2 else "b"),
                "OPTIONAL_VALUE": None if index % 23 == 0 else float(rng.normal()),
                "CONSTANT": "same",
                "ALL_NULL": None,
                "DESCRIPTION": f"unique description {index}",
            })
        columns = [{"COLUMN_NAME": name, "DATA_TYPE": physical_type} for name, physical_type in [
            ("ROW_ID", "NUMBER"), ("AMOUNT", "NUMBER"), ("COUNT_VALUE", "BINARY_DOUBLE"),
            ("KIND", "VARCHAR2"), ("OPTIONAL_VALUE", "NUMBER"), ("CONSTANT", "VARCHAR2"),
            ("ALL_NULL", "NUMBER"), ("DESCRIPTION", "VARCHAR2"),
        ]]
        return rows, columns

    def test_anomaly_candidates_and_null_safe_rules_match_surrogate_leaves(self):
        rows, columns = self.dataset()
        result = analyze_mixed_rows(rows, columns, {"contamination": .1, "minRulePurity": .5})
        self.assertTrue(result["rules"])
        self.assertFalse(result["metrics"]["hasGroundTruth"])
        for row_result in result["rows"]:
            matches = [rule for rule in result["rules"] if evaluate_predicate(rule["predicate"], rows[row_result["rowIndex"]])]
            self.assertEqual(bool(matches), row_result["ruleCandidate"])
            self.assertLessEqual(len(matches), 1)
            self.assertEqual(row_result["isAnomaly"], row_result["anomalyScore"] > result["metrics"]["anomalyThreshold"])
        anomalous = {item["rowIndex"] for item in result["rows"] if item["isAnomaly"]}
        self.assertGreater(len(anomalous & set(range(0, len(rows), 10))), 20)
        json.dumps(result, allow_nan=False)

    def test_holdout_metrics_are_calculated_on_reserved_rows_only(self):
        rows, columns = self.dataset()
        result = analyze_mixed_rows(rows, columns, {"contamination": .1})
        holdout = [item for item in result["rows"] if item["partition"] == "HOLDOUT"]
        self.assertEqual(len(holdout), result["metrics"]["holdoutCount"])
        self.assertEqual(len(result["rows"]) - len(holdout), result["metrics"]["trainCount"])
        tp = sum(item["isAnomaly"] and item["surrogateAnomaly"] for item in holdout)
        predicted = sum(item["surrogateAnomaly"] for item in holdout)
        actual = sum(item["isAnomaly"] for item in holdout)
        agreement = sum(item["isAnomaly"] == item["surrogateAnomaly"] for item in holdout)
        self.assertAlmostEqual(result["metrics"]["holdoutFidelity"], agreement / len(holdout))
        self.assertEqual(result["metrics"]["holdoutPrecision"], tp / predicted if predicted else None)
        self.assertEqual(result["metrics"]["holdoutRecall"], tp / actual if actual else None)
        for rule in result["rules"]:
            matched = [item for item in holdout if evaluate_predicate(rule["predicate"], rows[item["rowIndex"]])]
            self.assertEqual(rule["holdoutSupportCount"], len(matched))
            self.assertEqual(rule["holdoutAnomalyPurity"], sum(item["isAnomaly"] for item in matched) / len(matched) if matched else None)

    def test_fit_preprocessing_does_not_use_holdout_medians_or_categories(self):
        count = 160
        permutation = np.random.default_rng(42).permutation(count)
        holdout_indices = set(permutation[:40].tolist())
        rows = [{"VALUE": 10000.0 + i if i in holdout_indices else float(i % 9),
                 "TYPE_CODE": "holdout_only" if i in holdout_indices else ("a" if i % 2 else "b")}
                for i in range(count)]
        columns = [{"name": "VALUE", "dataType": "NUMBER"}, {"name": "TYPE_CODE", "dataType": "VARCHAR2"}]
        result = analyze_mixed_rows(rows, columns)
        numeric, categorical = result["encoding"]["features"]
        self.assertEqual(numeric["imputeValue"], float(np.median([row["VALUE"] for i, row in enumerate(rows) if i not in holdout_indices])))
        self.assertNotIn("holdout_only", categorical["categories"])
        self.assertEqual(categorical["unknownCategoryCount"], 40)
        self.assertEqual(result["encoding"]["fitSource"], "TRAIN_ONLY")

    def test_excludes_identifiers_constants_unbounded_text_and_user_columns(self):
        rows, columns = self.dataset()
        result = analyze_mixed_rows(rows, columns, {"excludeColumns": ["COUNT_VALUE"]})
        exclusions = {item["column"]: item["reason"] for item in result["encoding"]["excludedColumns"]}
        self.assertEqual(exclusions["ROW_ID"], "IDENTIFIER_LIKE")
        self.assertEqual(exclusions["CONSTANT"], "CONSTANT_IN_TRAIN")
        self.assertEqual(exclusions["ALL_NULL"], "ALL_NULL_IN_TRAIN")
        self.assertEqual(exclusions["DESCRIPTION"], "HIGH_CARDINALITY")
        self.assertEqual(exclusions["COUNT_VALUE"], "USER_EXCLUDED")
        self.assertTrue(result["encoding"]["sparse"])

    def test_bounded_sampling_is_deterministic_and_preserves_source_indices(self):
        rows, columns = self.dataset()
        options = {"maxRows": 96, "maxFeatures": 4, "maxColumns": 2, "nEstimators": 32}
        first = analyze_mixed_rows(rows, columns, options)
        second = analyze_mixed_rows(rows, columns, options)
        self.assertEqual(first, second)
        self.assertEqual(len(first["rows"]), 96)
        self.assertEqual(first["metrics"]["inputCount"], len(rows))
        self.assertGreater(max(item["rowIndex"] for item in first["rows"]), 96)
        self.assertLessEqual(first["encoding"]["encodedFeatureCount"], 4)
        self.assertIn("ROW_LIMIT_UNIFORM_SAMPLE_ONLY", first["warnings"])

    def test_numeric_tree_predicate_preserves_float32_boundaries_and_imputed_nulls(self):
        a = np.float32(1.0)
        b = np.nextafter(a, np.float32(np.inf), dtype=np.float32)
        midpoint = (float(a) + float(b)) / 2
        feature = {"kind": "numeric", "column": "VALUE", "imputeValue": float(b)}
        left = _branch_predicate(feature, midpoint, True)
        right = _branch_predicate(feature, midpoint, False)
        values = [None, "", Decimal("1"), float(a), midpoint - 1e-10, midpoint, midpoint + 1e-10, float(b), 2.0]
        for value in values:
            encoded = feature["imputeValue"] if value is None or value == "" else float(np.float32(value))
            self.assertEqual(evaluate_predicate(left, {"VALUE": value}), encoded <= midpoint)
            self.assertEqual(evaluate_predicate(right, {"VALUE": value}), encoded > midpoint)

    def test_category_tokens_do_not_collide_with_null_and_unknown_values(self):
        feature = {"kind": "category", "column": "KIND", "category": "M:"}
        for value in [None, "", "M:", "V:", "unseen", "O'Reilly"]:
            self.assertEqual(evaluate_predicate(_branch_predicate(feature, .5, False), {"KIND": value}), value == "M:")
            self.assertEqual(evaluate_predicate(_branch_predicate(feature, .5, True), {"KIND": value}), value != "M:")
        feature["category"] = None
        self.assertTrue(evaluate_predicate(_branch_predicate(feature, .5, False), {"KIND": ""}))
        self.assertFalse(evaluate_predicate(_branch_predicate(feature, .5, False), {"KIND": "M:"}))

    def test_nonfinite_physical_numbers_are_excluded_without_false_null_predicates(self):
        rows, columns = self.dataset()
        rows[0]["AMOUNT"] = float("nan")
        rows[1]["COUNT_VALUE"] = 1e100
        result = analyze_mixed_rows(rows, columns)
        excluded = {item["column"]: item["reason"] for item in result["encoding"]["excludedColumns"]}
        self.assertEqual(excluded["AMOUNT"], "INVALID_OR_NONFINITE_NUMERIC")
        self.assertEqual(excluded["COUNT_VALUE"], "INVALID_OR_NONFINITE_NUMERIC")

    def test_service_option_aliases_control_actual_model_settings(self):
        rows, columns = self.dataset()
        result = analyze_mixed_rows(rows, columns, {"maxDepth": 1, "minSamplesLeaf": 8, "randomState": 17})
        self.assertLessEqual(result["metrics"]["treeDepth"], 1)
        self.assertEqual(result["metrics"]["randomSeed"], 17)
        for rule in result["rules"]:
            self.assertGreaterEqual(rule["supportCount"], 8)

    def test_no_predicted_anomalies_returns_empty_candidates_with_summary(self):
        rows = [{"VALUE": float(index % 2)} for index in range(80)]
        result = analyze_mixed_rows(rows, [{"name": "VALUE", "dataType": "NUMBER"}], {"contamination": .001})
        self.assertEqual(result["rules"], [])
        self.assertEqual(result["metrics"]["anomalyCount"], 0)
        self.assertIsNone(result["metrics"]["holdoutRecall"])
        self.assertIn("NO_RELIABLE_SURROGATE_RULE_CANDIDATES", result["warnings"])

    def test_empty_constant_small_and_invalid_configuration_fail_clearly(self):
        with self.assertRaisesRegex(ValueError, "at least 32"):
            analyze_mixed_rows([], [{"name": "VALUE", "dataType": "NUMBER"}])
        rows = [{"VALUE": 1.0} for _ in range(40)]
        columns = [{"name": "VALUE", "dataType": "NUMBER"}]
        with self.assertRaisesRegex(ValueError, "No usable features"):
            analyze_mixed_rows(rows, columns)
        for options in [{"maxRows": 50001}, {"contamination": float("nan")}, {"treeMaxDepth": 2.2}, {"maxCategories": True}]:
            with self.assertRaises(ValueError):
                analyze_mixed_rows(rows, columns, options)
        with self.assertRaisesRegex(ValueError, "invalid Oracle"):
            analyze_mixed_rows(rows, [{"name": "VALUE);DROP", "dataType": "NUMBER"}])


if __name__ == "__main__":
    unittest.main()
