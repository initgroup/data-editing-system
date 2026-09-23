import json
import unittest
from decimal import Decimal

import numpy as np

from backend.services.mixed_pattern_algorithm import (
    _target_encoding, analyze_pattern_rows, evaluate_pattern_predicate, pattern_expression,
)


def metadata(*columns):
    return [{"name": name, "dataType": kind} for name, kind in columns]


def ast_columns(predicate):
    if predicate.get("conditions"):
        return set().union(*(ast_columns(item) for item in predicate["conditions"]))
    return {predicate["column"]}


class MixedPatternAlgorithmTests(unittest.TestCase):
    def pattern_data(self, count=4000):
        rng = np.random.default_rng(127)
        rows = [{"ROW_ID": index + 1, "GROUP_CODE": "01" if index % 2 else "02",
                 "RESULT_CODE": 1 if index % 2 else 2, "MEASUREMENT": float(rng.normal()),
                 "SECOND_RESULT": "yes" if index % 2 else "no"} for index in range(count)]
        for index in range(0, count, 100):
            rows[index]["RESULT_CODE"] = 1
        return rows, metadata(("ROW_ID", "NUMBER"), ("GROUP_CODE", "VARCHAR2"),
                              ("RESULT_CODE", "NUMBER"), ("MEASUREMENT", "NUMBER"), ("SECOND_RESULT", "VARCHAR2"))

    def test_actual_then_patterns_find_corrupt_rows_and_report_exact_cohort_metrics(self):
        rows, columns = self.pattern_data()
        result = analyze_pattern_rows(rows, columns, {"targetColumns": ["RESULT_CODE"], "minConfidence": .95})
        self.assertEqual(result["algorithm"], "MIXED_PATTERN_TREE")
        self.assertEqual(result["algorithmVersion"], 2)
        self.assertTrue(result["rules"])
        self.assertEqual({rule["resultColumn"] for rule in result["rules"]}, {"RESULT_CODE"})
        train = [rows[item["rowIndex"]] for item in result["rows"] if item["partition"] == "TRAIN"]
        validation = [rows[item["rowIndex"]] for item in result["rows"] if item["partition"] == "VALIDATION"]
        violations = set()
        for rule in result["rules"]:
            self.assertNotIn("RESULT_CODE", ast_columns(rule["predicate"]))
            self.assertNotIn("ANOMALY_CANDIDATE", rule["fullText"])
            a = [row for row in train if evaluate_pattern_predicate(rule["predicate"], row)]
            ab = [row for row in a if evaluate_pattern_predicate(rule["resultPredicate"], row)]
            b = [row for row in train if evaluate_pattern_predicate(rule["resultPredicate"], row)]
            self.assertEqual(rule["conditionCount"], len(a))
            self.assertEqual(rule["supportCount"], len(ab))
            self.assertEqual(rule["resultCount"], len(b))
            self.assertEqual(rule["totalCount"], len(train))
            self.assertAlmostEqual(rule["confidence"], len(ab) / len(a))
            self.assertAlmostEqual(rule["support"], len(ab) / len(train))
            self.assertAlmostEqual(rule["lift"], (len(ab) / len(a)) / (len(b) / len(train)))
            va = [row for row in validation if evaluate_pattern_predicate(rule["predicate"], row)]
            vab = [row for row in va if evaluate_pattern_predicate(rule["resultPredicate"], row)]
            self.assertEqual(rule["validation"]["conditionCount"], len(va))
            self.assertEqual(rule["validation"]["supportCount"], len(vab))
            self.assertAlmostEqual(rule["validation"]["confidence"], len(vab) / len(va))
            for index, row in enumerate(rows):
                if evaluate_pattern_predicate(rule["predicate"], row) and not evaluate_pattern_predicate(rule["resultPredicate"], row):
                    violations.add(index)
        self.assertEqual(violations, set(range(0, len(rows), 100)))
        json.dumps(result, allow_nan=False)

    def test_multiple_real_targets_and_global_rule_limit(self):
        rows, columns = self.pattern_data()
        result = analyze_pattern_rows(rows, columns, {"targetColumns": ["RESULT_CODE", "SECOND_RESULT"], "minConfidence": .95})
        self.assertEqual({rule["resultColumn"] for rule in result["rules"]}, {"RESULT_CODE", "SECOND_RESULT"})
        capped = analyze_pattern_rows(rows, columns, {"targetColumns": ["RESULT_CODE"], "maxRules": 1, "minConfidence": .95})
        self.assertEqual(len(capped["rules"]), 1)

    def test_entire_target_feature_family_is_excluded(self):
        rows = [{"Y": None if i % 31 == 0 else ("a" if i % 2 else "b"), "ROW_ID": i + 1, "CONSTANT": 1} for i in range(1000)]
        result = analyze_pattern_rows(rows, metadata(("Y", "VARCHAR2"), ("ROW_ID", "NUMBER"), ("CONSTANT", "NUMBER")), {"targetColumns": ["Y"]})
        self.assertEqual(result["rules"], [])
        self.assertEqual(result["metrics"]["fittedTargetCount"], 0)

    def test_numeric_bins_fit_training_only_and_match_explicit_non_float32_ranges(self):
        rng = np.random.default_rng(614)
        values = rng.uniform(-100, 100, 2400)
        rows = [{"INPUT": float(value), "OUTPUT": float(value * 3.25 + 2)} for value in values]
        result = analyze_pattern_rows(rows, metadata(("INPUT", "NUMBER"), ("OUTPUT", "NUMBER")),
                                      {"targetColumns": ["OUTPUT"], "targetBins": 4, "treeMaxDepth": 4, "continuousEnabled": False})
        self.assertTrue(result["rules"])
        train_values = sorted(Decimal(str(rows[item["rowIndex"]]["OUTPUT"])) for item in result["rows"] if item["partition"] == "TRAIN")
        target = next(item for item in result["encoding"]["targetEncodings"] if item["column"] == "OUTPUT")
        position = Decimal(len(train_values) - 1) / 4
        lower = int(position)
        boundary = train_values[lower] + (train_values[lower + 1] - train_values[lower]) * (position - lower)
        self.assertEqual(Decimal(str(target["boundaries"][0])), boundary)
        for rule in result["rules"]:
            self.assertEqual(rule["resultKind"], "RANGE")
            self.assertNotIn("BINARY_FLOAT", json.dumps(rule["resultPredicate"]))
            self.assertFalse(evaluate_pattern_predicate(rule["resultPredicate"], {"OUTPUT": None}))
            self.assertIn("OUTPUT", rule["resultText"])

    def test_missing_target_is_a_violation_not_a_missing_expected_value(self):
        rows, columns = self.pattern_data(3000)
        for index in range(0, len(rows), 100):
            rows[index]["RESULT_CODE"] = None
        result = analyze_pattern_rows(rows, columns, {"targetColumns": ["RESULT_CODE"], "minConfidence": .95})
        detected = set()
        for rule in result["rules"]:
            self.assertNotEqual(rule["resultPredicate"]["operator"], "IS_NULL")
            detected |= {index for index, row in enumerate(rows) if evaluate_pattern_predicate(rule["predicate"], row) and not evaluate_pattern_predicate(rule["resultPredicate"], row)}
        self.assertEqual(detected, set(range(0, len(rows), 100)))

    def test_noise_constants_and_uninformative_high_baseline_publish_no_rules(self):
        rng = np.random.default_rng(916)
        rows = [{"GROUP": int(rng.integers(0, 5)), "NOISE": int(rng.integers(0, 2)),
                 "CONSTANT": 3, "BASELINE": 0 if i % 500 == 0 else 1} for i in range(5000)]
        result = analyze_pattern_rows(rows, metadata(*[(name, "NUMBER") for name in rows[0]]),
                                      {"targetColumns": ["NOISE", "CONSTANT", "BASELINE"]})
        self.assertEqual(result["rules"], [])
        self.assertIn("NO_VALIDATED_COLUMN_PATTERNS", result["warnings"])

    def test_string_codes_and_exact_decimal_expected_values(self):
        rows = [{"GROUP": "A" if i % 2 else "B", "TEXT_CODE": "01" if i % 2 else "1",
                 "DECIMAL_VALUE": Decimal("1.000000000000000000001") if i % 2 else Decimal("2.000000000000000000002")} for i in range(1000)]
        result = analyze_pattern_rows(rows, metadata(("GROUP", "VARCHAR2"), ("TEXT_CODE", "VARCHAR2"), ("DECIMAL_VALUE", "NUMBER")),
                                      {"targetColumns": ["TEXT_CODE", "DECIMAL_VALUE"]})
        string_rules = [rule for rule in result["rules"] if rule["resultColumn"] == "TEXT_CODE"]
        self.assertEqual({rule["resultValue"] for rule in string_rules}, {"01", "1"})
        decimal_rules = [rule for rule in result["rules"] if rule["resultColumn"] == "DECIMAL_VALUE"]
        self.assertEqual({rule["resultValue"] for rule in decimal_rules}, {"1.000000000000000000001", "2.000000000000000000002"})
        for rule in decimal_rules:
            self.assertEqual(rule["resultPredicate"]["valueType"], "NUMBER")
            expected = rule["resultPredicate"]["value"]
            self.assertTrue(evaluate_pattern_predicate(rule["resultPredicate"], {"DECIMAL_VALUE": Decimal(expected)}))
            self.assertFalse(evaluate_pattern_predicate(rule["resultPredicate"], {"DECIMAL_VALUE": Decimal(expected) + Decimal("0.000000000000000000001")}))
            self.assertIn(expected, pattern_expression(rule["resultPredicate"]))
        json.dumps(result, allow_nan=False)

    def test_validation_only_categories_and_values_do_not_fit_encoders(self):
        count = 1000
        validation = set(np.random.default_rng(42).permutation(count)[:250].tolist())
        rows = [{"GROUP": "only_validation" if i in validation else ("a" if i % 2 else "b"),
                 "Y": 9 if i in validation else (1 if i % 2 else 2)} for i in range(count)]
        result = analyze_pattern_rows(rows, metadata(("GROUP", "VARCHAR2"), ("Y", "NUMBER")), {"targetColumns": ["Y"]})
        feature = next(item for item in result["encoding"]["features"] if item["column"] == "GROUP")
        self.assertNotIn("only_validation", feature["categories"])
        self.assertEqual(result["rules"], [])
        self.assertGreater(result["metrics"]["rejectedRules"]["validationEvidence"], 0)

    def test_range_boundaries_preserve_full_oracle_number_precision(self):
        rows = [{"VALUE": Decimal(f"12345678901234567890.12345678901234{i:04}")} for i in range(100)]
        target, reason = _target_encoding(rows, "VALUE", True, np.arange(100), 4, 4)
        self.assertIsNone(reason)
        self.assertEqual(target["boundaries"][0], "12345678901234567890.12345678901234002475")
        self.assertEqual(target["boundaries"][1], "12345678901234567890.1234567890123400495")
        self.assertEqual(target["classCount"], 4)
        for index, row in enumerate(rows):
            matches = [evaluate_pattern_predicate(result["resultPredicate"], row) for result in target["results"]]
            self.assertEqual(sum(matches), 1)
            self.assertTrue(matches[target["labels"][index]])

    def test_identifier_exclusion_preserves_continuous_measurements(self):
        rng = np.random.default_rng(79)
        rows = [{"COL001": i + 1, "CONTINUOUS": float(rng.normal()), "GROUP": i % 2, "RESULT": i % 2} for i in range(1000)]
        result = analyze_pattern_rows(rows, metadata(*[(name, "NUMBER") for name in rows[0]]), {"targetColumns": ["RESULT"]})
        encoded = {item["column"] for item in result["encoding"]["features"]}
        self.assertNotIn("COL001", encoded)
        self.assertIn("CONTINUOUS", encoded)
        self.assertTrue(result["rules"])

    def test_parameter_limits_are_enforced(self):
        rows, columns = self.pattern_data(100)
        for options in ({"maxRows": 25001}, {"maxTargets": 65}, {"treeMaxDepth": 7}, {"maxRules": 257}, {"targetColumns": ["MISSING"]}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                analyze_pattern_rows(rows, columns, options)


if __name__ == "__main__":
    unittest.main()
