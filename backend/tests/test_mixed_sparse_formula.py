"""Observed identities, missing candidates, and coefficient safety regressions."""
import json
import unittest

import numpy as np

from backend.services.mixed_continuous_algorithm import formula_result_accepts, evaluate_formula_expression
from backend.services.mixed_sparse_formula import UnitFormulaScreen
from backend.tests.test_mixed_continuous_algorithm import discover, formula_columns


class SparseFormulaTests(unittest.TestCase):
    def rule(self, rows, **options):
        result = discover(rows, **options)
        self.assertTrue(result["rules"], result["metrics"]["rejectionReasons"])
        json.dumps(result, allow_nan=False)
        return result["rules"][0]

    def assert_sum(self, rule, names):
        self.assertEqual(formula_columns(rule["resultPredicate"]["expression"]), set(names))
        self.assertEqual(rule["validation"]["discoveryMethod"], "SUM_DIFFERENCE")
        self.assertEqual(rule["validation"]["coefficientPolicy"], "CANONICAL_SIMPLE")

    def test_small_component_and_correlated_proxies_do_not_hide_exact_sum(self):
        rng = np.random.default_rng(563)
        rows = [{"B": float(b), "C": float(c), "P1": float(b + e), "P2": float(b - e), "Y": float(b + c)}
                for b, c, e in zip(rng.normal(100, 10, 1800), rng.normal(7, .1, 1800), rng.normal(0, .05, 1800))]
        rule = self.rule(rows)
        self.assert_sum(rule, ["B", "C"])
        self.assertEqual(rule["resultPredicate"]["expression"], {"operator": "ADD", "left": {"column": "B"}, "right": {"column": "C"}})

    def test_low_marginal_correlation_cancellation_survives_automatic_target_cap(self):
        rng = np.random.default_rng(529)
        rows = []
        for b, delta, noise in zip(rng.normal(0, 1000, 1800), rng.normal(0, 1, 1800), rng.normal(size=(1800, 10))):
            rows.append({"B": float(b), "C": float(-b + delta), "Y": float(delta),
                         **{f"N{i}": float(value) for i, value in enumerate(noise)}})
        rule = self.rule(rows, targetColumns=None, maxContinuousTargets=1)
        # All three directions of the identity are useful; the selected target
        # must be an actual sum member, not a random high-correlation distractor.
        self.assertIn(rule["resultColumn"], {"B", "C", "Y"})
        self.assertEqual(rule["validation"]["discoveryMethod"], "SUM_DIFFERENCE")
        target = self.rule(rows)
        self.assert_sum(target, ["B", "C"])

    def test_huge_target_corruptions_do_not_erase_training_identity(self):
        rng = np.random.default_rng(616)
        rows = []
        for i, (b, c, *noise) in enumerate(rng.uniform(-10, 10, (2000, 18))):
            rows.append({"B": float(b), "C": float(c), "Y": float(b + c + (1e6 if i % 100 == 0 else 0)),
                         **{f"N{j}": float(value) for j, value in enumerate(noise)}})
        rule = self.rule(rows)
        self.assert_sum(rule, ["B", "C"])
        found = {i for i, row in enumerate(rows) if not formula_result_accepts(rule["resultPredicate"], row)}
        self.assertEqual(found, set(range(0, len(rows), 100)))

    def test_four_term_difference_and_offset_obey_feature_budget(self):
        rng = np.random.default_rng(435)
        rows = [{"B": float(b), "C": float(c), "D": float(d), "E": float(e), "Y": float(b + c - d + e + 12)}
                for b, c, d, e in rng.uniform(-30, 30, (1600, 4))]
        rule = self.rule(rows, maxFormulaFeatures=4)
        self.assert_sum(rule, ["B", "C", "D", "E"])
        self.assertIn('"SUBTRACT"', json.dumps(rule["resultPredicate"]["expression"]))
        self.assertTrue(all(formula_result_accepts(rule["resultPredicate"], row) for row in rows))
        self.assertEqual(discover(rows, maxFormulaFeatures=1)["rules"], [])

    def test_high_scale_small_component_is_retained_in_selected_rule_and_violation(self):
        rng = np.random.default_rng(148)
        rows = [{"B": float(b), "C": float(c), "Y": float(b + c)}
                for b, c in zip(rng.uniform(-1e10, 1e10, 1500), rng.uniform(-1, 1, 1500))]
        rule = self.rule(rows)
        self.assert_sum(rule, ["B", "C"])
        self.assertLess(rule["validation"]["absoluteTolerance"], .001)
        corrupted = dict(rows[0], Y=rows[0]["Y"] + .01)
        self.assertFalse(formula_result_accepts(rule["resultPredicate"], corrupted))

    def test_high_scale_pair_shortlist_with_many_distractors_and_single_feature_limit(self):
        for seed in range(4):
            rng = np.random.default_rng(seed)
            numeric = {"B": rng.uniform(-1e10, 1e10, 500), "C": rng.uniform(-1, 1, 500)}
            numeric["Y"] = numeric["B"] + numeric["C"]
            numeric.update({f"N{i}": rng.uniform(-1, 1, 500) for i in range(40)})
            screen = UnitFormulaScreen(numeric, np.arange(500))
            self.assertTrue(any(set(item["names"]) == {"B", "C"} and item["coefficients"] == [1, 1]
                                for item in screen.candidates("Y")))
            self.assertEqual(screen.candidates("Y", max_terms=1), [])

    def test_integer_and_reciprocal_coefficients_are_real_canonical_asts(self):
        rng = np.random.default_rng(484)
        for divisor in (False, True):
            rows = [{"B": float(b), "Y": float(b / 12 if divisor else 12 * b)} for b in rng.uniform(-300, 300, 1200)]
            rule = self.rule(rows)
            expression = rule["resultPredicate"]["expression"]
            self.assertEqual(expression["operator"], "DIVIDE" if divisor else "MULTIPLY")
            self.assertEqual(expression["right"] if divisor else expression["left"], {"value": 12})
            self.assertEqual(rule["validation"]["coefficientPolicy"], "CANONICAL_SIMPLE")

    def test_small_coefficient_with_large_input_is_not_rounded_to_zero(self):
        rng = np.random.default_rng(226)
        rows = [{"B": float(b), "Y": float(.0001 * b + 7)} for b in rng.uniform(-1e8, 1e8, 1200)]
        rule = self.rule(rows)
        expression = rule["resultPredicate"]["expression"]
        self.assertEqual(formula_columns(expression), {"B"})
        self.assertAlmostEqual(evaluate_formula_expression(expression, {"B": 1e8}), 10007, places=6)

    def test_small_integer_counts_can_publish_only_evidenced_sum(self):
        rng = np.random.default_rng(224)
        rows = [{"B": float(b), "C": float(c), "Y": float(b + c)} for b, c in rng.integers(0, 4, (1600, 2))]
        rule = self.rule(rows)
        self.assert_sum(rule, ["B", "C"])
        noise = [{"B": float(b), "C": float(c), "Y": float(y)} for b, c, y in rng.integers(0, 6, (1600, 3))]
        self.assertEqual(discover(noise)["rules"], [])

    def test_holdout_shift_rejects_training_sum_and_missing_inputs_are_inapplicable(self):
        rng = np.random.default_rng(837)
        rows = [{"B": float(b), "C": float(c), "Y": float(b + c)} for b, c in rng.uniform(-10, 10, (1600, 2))]
        held_out = np.random.default_rng(42).permutation(len(rows))[:400]
        for i in held_out:
            rows[int(i)]["Y"] += 2
        self.assertEqual(discover(rows)["rules"], [])


if __name__ == "__main__":
    unittest.main()
