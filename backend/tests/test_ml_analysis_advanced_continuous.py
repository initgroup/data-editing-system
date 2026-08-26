import unittest

import numpy as np

from backend.services.ml_analysis_service import (
    apply_pca_representative_screening,
    build_symbolic_holdout_indexes,
    fit_symbolic_expression,
    require_sklearn,
    run_monte_carlo_stability_diagnostic,
)


class MlAnalysisAdvancedContinuousTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        require_sklearn()

    def test_pca_screening_returns_only_representative_source_columns(self):
        rng = np.random.default_rng(42)
        latent = rng.normal(size=(500, 3))
        columns = [
            latent[:, index % 3] + rng.normal(scale=0.01, size=len(latent))
            for index in range(15)
        ]
        matrix = np.column_stack(columns)
        feature_names = [f"COL{index:03d}" for index in range(1, 16)]

        reduced, representatives, diagnostics = apply_pca_representative_screening(
            matrix,
            feature_names,
            "AUTO",
            max_representatives=6,
        )

        self.assertEqual(diagnostics["appliedYn"], "Y")
        self.assertEqual(diagnostics["syntheticFeatureYn"], "N")
        self.assertLess(reduced.shape[1], matrix.shape[1])
        self.assertEqual(reduced.shape[1], len(representatives))
        self.assertTrue(set(representatives).issubset(set(feature_names)))
        self.assertFalse(any(name.startswith("PC") for name in representatives))

    def test_auto_robust_irls_requires_deterministic_holdout_improvement(self):
        rng = np.random.default_rng(31)
        source = rng.normal(size=300)
        target = 3.0 * source + rng.normal(scale=0.1, size=len(source))
        train_mask, _ = build_symbolic_holdout_indexes(len(source))
        contaminated_indexes = np.where(train_mask)[0][:30]
        target[contaminated_indexes] += rng.normal(
            loc=50.0,
            scale=5.0,
            size=len(contaminated_indexes),
        )

        _, _, _, method, message = fit_symbolic_expression(
            source.reshape(-1, 1),
            target,
            ["COL001"],
            100,
            False,
            True,
            0.0,
            8,
            estimation_mode="AUTO",
            monte_carlo_mode="OFF",
            banff_mode="OFF",
        )

        self.assertEqual(method, "ROBUST_STUDENT_T_IRLS")
        self.assertIn("validationSource=DETERMINISTIC_20PCT_HOLDOUT", message)
        self.assertIn("robustIrlsReason=HEAVY_TAIL_HOLDOUT_IMPROVEMENT", message)

    def test_forced_robust_irls_is_not_described_as_nonparametric_mle(self):
        rng = np.random.default_rng(7)
        source = rng.normal(size=300)
        target = 4.0 * source + rng.normal(scale=0.1, size=len(source))
        target[::17] += rng.normal(loc=40.0, scale=3.0, size=len(target[::17]))

        _, _, _, method, message = fit_symbolic_expression(
            source.reshape(-1, 1),
            target,
            ["COL001"],
            100,
            False,
            True,
            0.0,
            8,
            estimation_mode="ROBUST_IRLS",
            monte_carlo_mode="OFF",
            banff_mode="OFF",
        )

        self.assertEqual(method, "ROBUST_STUDENT_T_IRLS")
        self.assertIn("parametric robust estimator", message)
        self.assertIn("not a nonparametric maximum-likelihood method", message)

    def test_auto_banff_inspired_ratio_requires_strong_ratio(self):
        rng = np.random.default_rng(19)
        source = rng.uniform(10.0, 100.0, size=300)
        target = 2.5 * source + rng.normal(scale=0.02, size=len(source))

        expression, score, complexity, method, message = fit_symbolic_expression(
            source.reshape(-1, 1),
            target,
            ["COL001"],
            100,
            False,
            True,
            0.995,
            8,
            estimation_mode="OLS",
            monte_carlo_mode="OFF",
            banff_mode="AUTO",
        )

        self.assertEqual(method, "BANFF_INSPIRED_RATIO")
        self.assertEqual(complexity, 1)
        self.assertGreaterEqual(score, 0.98)
        self.assertIn("COL001", expression)
        self.assertIn("fullBanffImplementation=N", message)
        self.assertIn("donorImputation=N", message)
        self.assertIn("minimumChangeOptimization=N", message)

    def test_small_sample_prefers_dominant_coefficient_free_sum_with_one_violation(self):
        x_values = np.asarray(
            [
                [20, 80],
                [30, 50],
                [40, 20],
                [50, 80],
                [10, 50],
                [70, 20],
                [80, 80],
                [90, 50],
                [100, 20],
                [110, 50],
                [0, 20],
            ],
            dtype=float,
        )
        y_values = np.asarray(
            [100, 80, 60, 130, 110, 90, 160, 140, 120, 160, 20],
            dtype=float,
        )

        expression, score, complexity, method, message = fit_symbolic_expression(
            x_values,
            y_values,
            ["DOMESTIC_TRAINING_COST", "OVERSEAS_TRAINING_COST"],
            1000,
            False,
            True,
            0.995,
            8,
            monte_carlo_mode="OFF",
            banff_mode="OFF",
        )

        self.assertEqual(method, "SIMPLE_ARITHMETIC")
        self.assertEqual(
            expression,
            "DOMESTIC_TRAINING_COST + OVERSEAS_TRAINING_COST",
        )
        self.assertEqual(complexity, 2)
        self.assertAlmostEqual(score, 0.8630478087649402)
        self.assertIn("matchRows=10/11", message)
        self.assertIn("selection=SIMPLE_ARITHMETIC", message)

    def test_simple_arithmetic_search_uses_features_after_first_six(self):
        rng = np.random.default_rng(81)
        row_count = 40
        unrelated = rng.normal(size=(row_count, 6))
        domestic = rng.integers(10, 100, size=row_count).astype(float)
        overseas = rng.integers(10, 100, size=row_count).astype(float)
        x_values = np.column_stack([unrelated, domestic, overseas])
        y_values = domestic + overseas
        y_values[:4] += 250.0

        expression, _, _, method, message = fit_symbolic_expression(
            x_values,
            y_values,
            [
                "NOISE_1",
                "NOISE_2",
                "NOISE_3",
                "NOISE_4",
                "NOISE_5",
                "NOISE_6",
                "DOMESTIC",
                "OVERSEAS",
            ],
            1000,
            False,
            True,
            0.995,
            8,
            monte_carlo_mode="OFF",
            banff_mode="OFF",
        )

        self.assertEqual(method, "SIMPLE_ARITHMETIC")
        self.assertEqual(expression, "DOMESTIC + OVERSEAS")
        self.assertIn("matchRows=36/40", message)

    def test_simple_arithmetic_supports_subtraction_multiplication_and_safe_division(self):
        left = np.arange(11, 41, dtype=float)
        right = (np.arange(30, dtype=float) % 7.0) + 2.0
        cases = [
            (left - right, "LEFT - RIGHT"),
            (left * right, "LEFT*RIGHT"),
            (left / right, "LEFT/NULLIF(RIGHT, 0)"),
        ]

        for target, expected_expression in cases:
            with self.subTest(expression=expected_expression):
                expression, _, _, method, _ = fit_symbolic_expression(
                    np.column_stack([left, right]),
                    target,
                    ["LEFT", "RIGHT"],
                    1000,
                    False,
                    True,
                    0.995,
                    8,
                    monte_carlo_mode="OFF",
                    banff_mode="OFF",
                    simple_arithmetic_max_terms=2,
                )

                self.assertEqual(method, "SIMPLE_ARITHMETIC")
                self.assertEqual(expression, expected_expression)

    def test_simple_arithmetic_excludes_median_imputed_cells_from_match_support(self):
        domestic = np.arange(10, 21, dtype=float)
        overseas = np.arange(30, 41, dtype=float)
        y_values = domestic + overseas
        x_values = np.column_stack([domestic, overseas])
        valid_masks = np.ones_like(x_values, dtype=bool)
        x_values[0, 0] = 999.0
        valid_masks[0, 0] = False

        expression, _, _, method, message = fit_symbolic_expression(
            x_values,
            y_values,
            ["DOMESTIC", "OVERSEAS"],
            1000,
            False,
            True,
            0.995,
            8,
            monte_carlo_mode="OFF",
            banff_mode="OFF",
            feature_valid_masks=valid_masks,
        )

        self.assertEqual(method, "SIMPLE_ARITHMETIC")
        self.assertEqual(expression, "DOMESTIC + OVERSEAS")
        self.assertIn("matchRows=10/10", message)
        self.assertIn("coverage=0.909091", message)

    def test_monte_carlo_is_fixed_seed_and_diagnostic_only(self):
        rng = np.random.default_rng(23)
        source = rng.normal(size=400)
        target = 1.75 * source + rng.normal(scale=0.15, size=len(source))
        arguments = (
            source.reshape(-1, 1),
            target,
            ["COL001"],
            "1.75*COL001",
            "LINEAR_REGRESSION",
            "REPEATED_HOLDOUT",
            10,
            300,
        )

        first = run_monte_carlo_stability_diagnostic(*arguments)
        second = run_monte_carlo_stability_diagnostic(*arguments)

        self.assertEqual(first, second)
        self.assertIn("monteCarloExecuted=Y", first)
        self.assertIn("monteCarloSeed=42", first)
        self.assertIn("scope=STABILITY_ONLY", first)
        self.assertIn("randomizedPredictionOutput=N", first)
        self.assertIn("monteCarloRows=300", first)


if __name__ == "__main__":
    unittest.main()
