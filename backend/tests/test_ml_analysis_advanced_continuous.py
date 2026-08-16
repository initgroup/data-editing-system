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
