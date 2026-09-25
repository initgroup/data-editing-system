import json
import unittest

import numpy as np

from backend.services.mixed_continuous_algorithm import (
    discover_continuous_rules, evaluate_formula_expression, formula_result_accepts,
)
from backend.services.mixed_pattern_algorithm import analyze_pattern_rows, evaluate_pattern_predicate


def metadata(rows):
    return [{"name": name, "dataType": "VARCHAR2" if isinstance(value, str) else "NUMBER"} for name, value in rows[0].items()]


def discover(rows, **options):
    permutation = np.random.default_rng(42).permutation(len(rows))
    size = int(len(rows) * .25)
    return discover_continuous_rules(rows, metadata(rows), np.sort(permutation[size:]), np.sort(permutation[:size]),
                                     {"targetColumns": ["Y"], **options})


def formula_columns(expression):
    if "column" in expression:
        return {expression["column"]}
    if "value" in expression:
        return set()
    return formula_columns(expression["left"]) | formula_columns(expression["right"])


class MixedContinuousAlgorithmTests(unittest.TestCase):
    def test_noisy_linear_pattern_finds_outliers_with_actual_expected_numeric_value(self):
        rng = np.random.default_rng(127)
        rows = [{"X": float(value), "Y": float(2.5 * value + 7 + rng.normal(0, .04))} for value in rng.uniform(10, 100, 2000)]
        bad = set(range(0, len(rows), 100))
        for index in bad:
            rows[index]["Y"] += 35
        result = discover(rows)
        self.assertEqual(len(result["rules"]), 1)
        rule = result["rules"][0]
        self.assertEqual(rule["resultKind"], "FORMULA")
        self.assertEqual(rule["resultColumn"], "Y")
        self.assertEqual(formula_columns(rule["resultPredicate"]["expression"]), {"X"})
        self.assertIsNone(rule["lift"])
        self.assertIsNone(rule["resultCount"])
        self.assertGreater(rule["confidence"], .97)
        self.assertEqual(rule["validation"]["source"], "SELECTION_VALIDATION")
        detected = {index for index, row in enumerate(rows) if not formula_result_accepts(rule["resultPredicate"], row)}
        self.assertTrue(bad <= detected)
        self.assertLess(len(detected - bad), 5)
        expected = evaluate_formula_expression(rule["resultPredicate"]["expression"], rows[0])
        self.assertAlmostEqual(expected, 2.5 * rows[0]["X"] + 7, delta=.1)
        self.assertLess(rule["validation"]["absoluteTolerance"], 1)
        self.assertIn("calibration", rule["validation"])
        self.assertNotEqual(rule["validation"]["train"]["totalCount"], rule["validation"]["calibration"]["totalCount"])
        json.dumps(result, allow_nan=False)

    def test_conditional_formulas_discover_distinct_group_slopes(self):
        rng = np.random.default_rng(58)
        rows = []
        for index, value in enumerate(rng.uniform(5, 100, 2400)):
            group = "A" if index % 2 else "B"
            rows.append({"GROUP": group, "X": float(value), "Y": float((2 * value + 3) if group == "A" else (5 * value - 10))})
        result = discover(rows)
        self.assertEqual(len(result["rules"]), 2)
        self.assertTrue(all("GROUP" in rule["expression"] for rule in result["rules"]))
        for rule in result["rules"]:
            matches = [row for row in rows if evaluate_pattern_predicate(rule["predicate"], row)]
            self.assertEqual(len(matches), 1200)
            self.assertTrue(all(formula_result_accepts(rule["resultPredicate"], row) for row in matches))

    def test_accepted_global_formula_does_not_hide_or_flag_stable_minority_regime(self):
        rng = np.random.default_rng(83)
        rows = []
        for index, value in enumerate(rng.uniform(5, 100, 5000)):
            group = "B" if index % 25 == 0 else "A"
            rows.append({"GROUP": group, "GROUP_COPY": group, "CHANNEL": "C" if index % 2 else "D",
                         "X": float(value), "Y": float(5 * value - 10 if group == "B" else 2 * value + 3)})
        result = discover(rows)
        self.assertEqual(2, len(result["rules"]))
        self.assertIn("GLOBAL_FORMULA_SCOPED_AROUND_VALIDATED_GROUPS", result["warnings"])
        global_rule = next(rule for rule in result["rules"]
                           if rule["validation"].get("scopePolicy") == "EXCLUDES_VALIDATED_ALTERNATIVE_GROUPS")
        minority_rule = next(rule for rule in result["rules"]
                             if rule["validation"].get("scopePolicy") == "VALIDATED_ALTERNATIVE_GROUP")
        self.assertEqual({"A"}, {row["GROUP"] for row in rows if evaluate_pattern_predicate(global_rule["predicate"], row)})
        self.assertEqual({"B"}, {row["GROUP"] for row in rows if evaluate_pattern_predicate(minority_rule["predicate"], row)})
        for row in rows:
            applicable = [rule for rule in result["rules"] if evaluate_pattern_predicate(rule["predicate"], row)]
            self.assertEqual(1, len(applicable))
            self.assertTrue(formula_result_accepts(applicable[0]["resultPredicate"], row))
        self.assertTrue(evaluate_pattern_predicate(global_rule["predicate"], {"GROUP": None, "X": 10, "Y": 23}))
        # Saved expressions, counts and scoped AST must be reproducible.
        self.assertIn("GROUP != 'B'", global_rule["expression"])
        self.assertEqual(1, global_rule["validation"]["alternativeGroupCount"])
        json.dumps(result, allow_nan=False)

    def test_groups_do_not_turn_unrelated_data_into_conditional_formulas(self):
        rng = np.random.default_rng(207)
        rows = [{"GROUP": "A" if index % 2 else "B", "X": float(x), "Y": float(y)}
                for index, (x, y) in enumerate(rng.normal(size=(2400, 2)))]
        self.assertEqual([], discover(rows)["rules"])

    def test_additive_formula_uses_multiple_predictors_without_target_leakage(self):
        rng = np.random.default_rng(223)
        rows = [{"A": float(a), "B": float(b), "Y": float(3 * a - 2 * b + 4)}
                for a, b in rng.uniform(-10, 10, (1800, 2))]
        result = discover(rows)
        self.assertEqual(len(result["rules"]), 1)
        rule = result["rules"][0]
        self.assertEqual(formula_columns(rule["resultPredicate"]["expression"]), {"A", "B"})
        self.assertTrue(all(formula_result_accepts(rule["resultPredicate"], row) for row in rows))

    def test_ratio_formula_excludes_zero_denominator_and_missing_predictors(self):
        rng = np.random.default_rng(745)
        rows = [{"A": float(a), "B": float(b), "Y": float(a / b)} for a, b in
                np.column_stack([rng.uniform(-50, 50, 2200), rng.uniform(1, 10, 2200)])]
        result = discover(rows)
        self.assertEqual(len(result["rules"]), 1)
        rule = result["rules"][0]
        self.assertIn('"DIVIDE"', json.dumps(rule["resultPredicate"]))
        self.assertFalse(evaluate_pattern_predicate(rule["predicate"], {"A": 3, "B": 0, "Y": 1}))
        self.assertFalse(evaluate_pattern_predicate(rule["predicate"], {"A": None, "B": 3, "Y": 1}))
        self.assertIsNone(evaluate_formula_expression(rule["resultPredicate"]["expression"], {"A": 3, "B": 0}))

    def test_unrelated_numeric_columns_reject_broad_or_constant_formulas(self):
        rng = np.random.default_rng(627)
        rows = [{"A": float(a), "B": float(b), "Y": float(y)} for a, b, y in rng.normal(size=(2400, 3))]
        self.assertEqual(discover(rows)["rules"], [])
        rows = [{"X": float(index), "Y": 4.0} for index in range(200)]
        self.assertEqual(discover(rows)["rules"], [])

    def test_missing_result_is_violation_while_missing_input_is_not_applicable(self):
        rows = [{"X": float(index % 311), "Y": float(3 * (index % 311) + 5)} for index in range(1800)]
        for index in range(0, len(rows), 120):
            rows[index]["Y"] = None
        result = discover(rows)
        rule = result["rules"][0]
        self.assertTrue(evaluate_pattern_predicate(rule["predicate"], {"X": 5, "Y": None}))
        self.assertFalse(formula_result_accepts(rule["resultPredicate"], {"X": 5, "Y": None}))
        self.assertFalse(evaluate_pattern_predicate(rule["predicate"], {"X": None, "Y": 20}))
        self.assertGreater(rule["validation"]["train"]["missingActualCount"], 0)

    def test_validation_cannot_refit_coefficients_or_widen_calibrated_tolerance(self):
        count = 1600
        validation_indices = set(np.random.default_rng(42).permutation(count)[:400])
        rows = [{"X": float(i % 257), "Y": float(4 * (i % 257) + (100 if i in validation_indices else 2))} for i in range(count)]
        self.assertEqual(discover(rows)["rules"], [])

    def test_integrated_budget_reserves_formula_and_keeps_value_rules(self):
        rng = np.random.default_rng(68)
        rows = [{"X": float(x), "Y": float(3 * x + 2), "CATEGORY": "a" if i % 2 else "b", "CODE": i % 2}
                for i, x in enumerate(rng.uniform(-50, 50, 2000))]
        result = analyze_pattern_rows(rows, metadata(rows), {"maxRules": 4, "targetColumns": ["Y", "CODE"]})
        self.assertLessEqual(len(result["rules"]), 4)
        self.assertTrue(any(rule["resultKind"] == "FORMULA" for rule in result["rules"]))
        self.assertTrue(any(rule["resultKind"] == "VALUE" for rule in result["rules"]))
        self.assertEqual(result["metrics"]["formulaRuleCount"], 1)

    def test_relative_tolerance_uses_maximum_not_sum(self):
        predicate = {"operator": "WITHIN_TOLERANCE", "column": "Y", "expression": {"column": "X"},
                     "absoluteTolerance": 2., "relativeTolerance": .1}
        self.assertTrue(formula_result_accepts(predicate, {"X": 100, "Y": 110}))
        self.assertFalse(formula_result_accepts(predicate, {"X": 100, "Y": 111}))

    def test_extreme_numeric_values_do_not_publish_unbindable_or_nonfinite_formulas(self):
        rows = [{"X": float(index + 1), "Y": float((index + 1) * 1e200)} for index in range(400)]
        result = discover(rows)
        self.assertEqual(result["rules"], [])
        self.assertIn("EXTREME_NUMERIC_FORMULA_COLUMNS_SKIPPED", result["warnings"])
        json.dumps(result, allow_nan=False)

    def test_uploaded_numeric_text_is_inferred_on_fit_and_keeps_real_formula_target(self):
        rng = np.random.default_rng(972)
        rows = [{"X": format(x, ".17g"), "Y": format(3.5 * x + 8, ".17g"),
                 "REGION": "001" if index % 2 else "002", "CATEGORY": "a" if index % 2 else "b"}
                for index, x in enumerate(rng.uniform(-40, 40, 1800))]
        result = analyze_pattern_rows(rows, metadata(rows), {"targetColumns": ["Y", "REGION"]})
        formula = next(rule for rule in result["rules"] if rule["resultKind"] == "FORMULA")
        self.assertEqual(formula["resultColumn"], "Y")
        self.assertTrue(formula["resultPredicate"]["numericText"])
        self.assertIn('"numericText": true', json.dumps(formula["resultPredicate"]["expression"]))
        self.assertTrue(all(formula_result_accepts(formula["resultPredicate"], row) for row in rows))
        self.assertTrue(any(rule["resultColumn"] == "REGION" and rule["resultValue"] in {"001", "002"}
                            for rule in result["rules"] if rule["resultKind"] == "VALUE"))
        metrics = result["metrics"]["continuous"]
        self.assertEqual(metrics["inferredNumericTextColumnCount"], 2)
        self.assertEqual(metrics["physicalNumericColumnCount"], 0)
        self.assertEqual(metrics["status"], "RULES_AVAILABLE")
        self.assertEqual(metrics["publishedRuleCount"], 1)
        self.assertEqual(metrics["eligibilityReasons"]["LEADING_ZERO_CODE"], 1)
        json.dumps(result, allow_nan=False)

    def test_text_inference_does_not_read_validation_and_invalid_predictor_is_not_applicable(self):
        rows = [{"X": str(index % 107), "Y": str(4 * (index % 107) + 2)} for index in range(1800)]
        held_out = np.random.default_rng(42).permutation(len(rows))[:450]
        rows[int(held_out[0])]["X"] = "not numeric"
        rows[int(held_out[1])]["Y"] = "not numeric"
        result = discover(rows)
        rule = result["rules"][0]
        self.assertFalse(evaluate_pattern_predicate(rule["predicate"], rows[int(held_out[0])]))
        self.assertTrue(evaluate_pattern_predicate(rule["predicate"], rows[int(held_out[1])]))
        self.assertFalse(formula_result_accepts(rule["resultPredicate"], rows[int(held_out[1])]))
        self.assertEqual(rule["validation"]["conditionCount"], 449)
        self.assertEqual(rule["validation"]["missingActualCount"], 1)
        inferred = result["metrics"]["columnInference"]
        self.assertTrue(all(item["invalidCount"] == 0 and item["fitSource"] == "TRAIN_FIT" for item in inferred))

    def test_isolated_malformed_fit_text_keeps_column_but_marks_original_as_violation(self):
        rows = [{"X": str(i % 107), "Y": str(4 * (i % 107) + 2)} for i in range(1600)]
        train = np.sort(np.random.default_rng(42).permutation(len(rows))[400:])
        fit = np.random.default_rng(43).permutation(train)[300:]
        rows[int(fit[0])]["Y"] = "unknown"
        result = discover(rows)
        self.assertEqual(1, len(result["rules"]))
        rule = result["rules"][0]
        self.assertTrue(rule["resultPredicate"]["numericText"])
        self.assertTrue(evaluate_pattern_predicate(rule["predicate"], rows[int(fit[0])]))
        self.assertFalse(formula_result_accepts(rule["resultPredicate"], rows[int(fit[0])]))
        self.assertEqual("unknown", rows[int(fit[0])]["Y"])
        inferred = next(item for item in result["metrics"]["columnInference"] if item["column"] == "Y")
        self.assertEqual(1, inferred["invalidCount"])
        self.assertEqual({"fit": 1, "calibration": 0, "validation": 0}, inferred["invalidTextAssessment"])
        self.assertEqual(1, rule["validation"]["train"]["invalidNumericTextCount"])
        self.assertIn("DIRTY_NUMERIC_TEXT_RETAINED_AS_INVALID", result["warnings"])

    def test_substantial_malformed_fit_text_does_not_force_numeric_type(self):
        rows = [{"X": str(i % 107), "Y": str(4 * (i % 107) + 2)} for i in range(1600)]
        train = np.sort(np.random.default_rng(42).permutation(len(rows))[400:])
        fit = np.random.default_rng(43).permutation(train)[300:]
        for index in fit[:45]:
            rows[int(index)]["Y"] = "unknown"
        result = discover(rows)
        self.assertEqual([], result["rules"])
        rejected = next(item for item in result["metrics"]["excludedColumns"] if item["column"] == "Y")
        self.assertEqual("NON_NUMERIC_TEXT", rejected["reason"])
        self.assertEqual(45, rejected["invalidCount"])

    def test_small_count_measurements_can_be_formula_targets_without_relaxing_quality(self):
        rng = np.random.default_rng(19)
        rows = [{"X": str(int(x)), "Y": str(3 * int(x) + 7)} for x in rng.integers(0, 10, 1500)]
        result = discover(rows)
        self.assertEqual(len(result["rules"]), 1)
        self.assertEqual(result["rules"][0]["confidence"], 1)
        self.assertEqual(result["metrics"]["minFormulaR2"], .9)
        self.assertEqual(result["metrics"]["maxToleranceFraction"], .05)

    def test_target_limit_ranks_fit_relationship_strength_not_source_column_order(self):
        rng = np.random.default_rng(918)
        rows = [{**{f"NOISE_{j}": float(v) for j, v in enumerate(noises)}, "X": float(x), "Y": float(8 * x - 2)}
                for noises, x in zip(rng.normal(size=(1700, 6)), rng.uniform(-20, 20, 1700))]
        result = discover(rows, targetColumns=None, maxContinuousTargets=2)
        self.assertEqual(set(result["metrics"]["targets"]), {"X", "Y"})
        self.assertEqual(result["metrics"]["eligibleTargetCount"], 8)
        self.assertEqual(len(result["metrics"]["excludedTargets"]), 6)
        self.assertEqual({rule["resultColumn"] for rule in result["rules"]}, {"X", "Y"})

    def test_zero_rule_diagnostics_distinguish_disabled_ineligible_and_quality_rejection(self):
        rng = np.random.default_rng(216)
        noise = [{"X": float(x), "Y": float(y)} for x, y in rng.normal(size=(2000, 2))]
        disabled = discover(noise, continuousEnabled=False)
        self.assertEqual(disabled["metrics"]["status"], "DISABLED")
        rejected = discover(noise)
        self.assertEqual(rejected["metrics"]["status"], "NO_VALIDATED_RULES")
        self.assertEqual(rejected["metrics"]["attemptedTargetCount"], 1)
        self.assertGreater(sum(rejected["metrics"]["rejectionReasons"].values()), 0)
        codes = [{"X": "001", "Y": "002"} for _ in range(200)]
        ineligible = discover(codes)
        self.assertEqual(ineligible["metrics"]["status"], "NO_ELIGIBLE_TARGETS")
        self.assertEqual(ineligible["metrics"]["attemptedTargetCount"], 0)
        self.assertEqual(ineligible["metrics"]["eligibilityReasons"], {"LEADING_ZERO_CODE": 2})
        self.assertEqual(ineligible["metrics"]["diagnosticVersion"], 1)


if __name__ == "__main__":
    unittest.main()
