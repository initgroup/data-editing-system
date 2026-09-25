"""Portable wide-upload regressions; no user CSV, Oracle or network is used."""
import hashlib
import math
import re
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

from backend.services import mixed_pattern_service as patterns
from backend.services.mixed_continuous_algorithm import discover_continuous_rules, _rank_targets
from backend.services.mixed_feature_screening import column_screen_evidence, screen_feature_columns


class SourceCursor:
    def __init__(self, rows):
        self.rows, self.queries = rows, []

    def execute(self, sql, params=None):
        params = params or {}
        self.queries.append((sql, params))
        self.position = 0
        names = re.findall(r'T\."([A-Za-z0-9_$#]+)"', sql)
        self.description = [(name,) for name in names]
        if "COUNT(*)" in sql:
            self.one = (len(self.rows),)
            self.values = []
        elif "ORA_HASH" in sql:
            self.values = []
            for index, row in enumerate(self.rows):
                rowid = str(index)
                hashed = int.from_bytes(hashlib.sha256(f"{params['sampleSeed']}:{rowid}".encode()).digest()[:4], "big")
                if hashed <= params["hashThreshold"]:
                    self.values.append((rowid, hashed, *(row.get(name) for name in names)))
        else:
            self.values = [tuple(row.get(name) for name in names) for row in self.rows[:params["rowLimit"]]]

    def fetchmany(self, count):
        batch = self.values[self.position:self.position + count]
        self.position += len(batch)
        return batch

    def fetchone(self):
        return self.one


def column(name, data_type="VARCHAR2"):
    return {"COLUMN_NAME": name, "DATA_TYPE": data_type, "DATA_LENGTH": 4000 if data_type == "VARCHAR2" else 22}


class MixedFeatureScreeningTests(unittest.TestCase):
    @staticmethod
    def wide_rows(count=1200):
        rng = np.random.default_rng(196)
        rows = []
        for _ in range(count):
            row = {f"COL{i:03d}": str(int(value)) for i, value in enumerate(rng.integers(1, 6, 80), start=1)}
            x, z, w = rng.integers(5, 95, 3)
            row.update(COL081=str(x), COL082=str(z), COL083=str(w), COL084=str(x + z + w))
            rows.append(row)
        return rows, [column(f"COL{i:03d}") for i in range(1, 85)]

    def sample(self, rows, columns, **payload):
        cursor = SourceCursor(rows)
        with patch.object(patterns.xai, "_columns", return_value=columns), \
             patch.object(patterns.xai.ml, "_ml_input_feature_limit", return_value=50), \
             patch.object(patterns.xai.ml, "_ml_in_memory_row_limit", return_value=25000):
            result = patterns._sample(cursor, {"owner": "APP", "tableName": "SOURCE"}, payload)
        return result, cursor

    def test_wide_upload_late_formula_components_survive_without_exceeding_feature_cap(self):
        rows, columns = self.wide_rows()
        (sample, selected, _, sampling), cursor = self.sample(rows, columns)
        names = {item["COLUMN_NAME"] for item in selected}
        self.assertEqual(50, len(selected))
        self.assertTrue({"COL081", "COL082", "COL083", "COL084"} <= names)
        self.assertEqual(34, len(sampling["featureLimitExcludedColumns"]))
        self.assertEqual(3, sampling["featureScreening"]["probeQueryCount"])
        self.assertTrue(all(len(re.findall(r'T\."', sql)) <= 50 for sql, _ in cursor.queries))
        self.assertTrue(all("COUNT(*)" not in sql and "ORDER BY" not in sql for sql, _ in cursor.queries))
        permutation = np.random.default_rng(42).permutation(len(sample))
        cut = math.ceil(len(sample) * .25)
        result = discover_continuous_rules(sample, selected, np.sort(permutation[cut:]), np.sort(permutation[:cut]),
            {"targetColumns": ["COL084"], "maxConditionalGroups": 0})
        self.assertEqual(1, len(result["rules"]))
        self.assertEqual(1, result["rules"][0]["confidence"])
        self.assertEqual("SUM_DIFFERENCE", result["rules"][0]["validation"]["discoveryMethod"])

    def test_explicit_targets_exclusions_and_lower_admin_limits_are_preserved(self):
        rows, columns = self.wide_rows(600)
        (sample, selected, _, info), _ = self.sample(rows, columns, APP_ML_MAX_INPUT_FEATURES=3,
            APP_ML_MAX_IN_MEMORY_ROWS=100, targetColumns=["COL084"], excludeColumns=["COL081"])
        names = {item["COLUMN_NAME"] for item in selected}
        self.assertEqual({"COL082", "COL083", "COL084"}, names)
        self.assertEqual(100, len(sample))
        self.assertEqual(100, info["featureScreening"]["probeRowLimit"])
        self.assertTrue(all(item["columnCount"] <= 3 for item in info["featureScreening"]["probes"]))
        self.assertNotIn("COL081", {item["column"] for item in info["featureScreening"]["columns"]})
        (_, selected, _, info), cursor = self.sample(rows, columns, featureColumns=["COL083", "COL084"], targetColumns=["COL084"])
        self.assertEqual(["COL083", "COL084"], [item["COLUMN_NAME"] for item in selected])
        self.assertNotIn("featureScreening", info)
        self.assertEqual(1, len(cursor.queries))
        with self.assertRaises(HTTPException):
            self.sample(rows, columns, targetColumns=["COL084"], excludeColumns=["COL084"])
        with self.assertRaises(HTTPException):
            self.sample(rows, columns, APP_ML_MAX_INPUT_FEATURES=2, targetColumns=["COL082", "COL083", "COL084"])

    def test_better_coverage_does_not_force_a_formula_for_unrelated_measurements(self):
        rows, columns = self.wide_rows()
        rng = np.random.default_rng(241)
        for row, value in zip(rows, rng.uniform(20, 300, len(rows))):
            row["COL084"] = str(value)
        (sample, selected, _, _), _ = self.sample(rows, columns)
        permutation = np.random.default_rng(42).permutation(len(sample))
        cut = math.ceil(len(sample) * .25)
        result = discover_continuous_rules(sample, selected, np.sort(permutation[cut:]), np.sort(permutation[:cut]),
            {"targetColumns": ["COL084"], "maxConditionalGroups": 0})
        self.assertEqual([], result["rules"])
        self.assertEqual("NO_VALIDATED_RULES", result["metrics"]["status"])
        self.assertGreater(result["metrics"]["fittedCandidateCount"], 0)
        self.assertEqual(.9, result["metrics"]["minFormulaR2"])

    def test_probe_has_its_own_small_memory_bound_and_reports_unobserved_values(self):
        columns = [column(f"COL{i:03d}") for i in range(1, 9)]
        rows = [{item["COLUMN_NAME"]: "A" * 500 for item in columns} for _ in range(1000)]
        cursor = SourceCursor(rows)
        selected, info = screen_feature_columns(cursor, owner="APP", table="SOURCE", columns=columns,
            feature_limit=4, probe_byte_limit=4096)
        self.assertEqual(4, len(selected))
        self.assertTrue(all(item["estimatedBytes"] <= 4096 and item["byteLimitReached"] for item in info["probes"]))
        self.assertTrue(all(item["sampleCount"] < 512 for item in info["probes"]))
        self.assertIn("PREFIX_FEATURE_PROBE_MAY_MISS_LATE_OR_RARE_VALUES", info["warnings"])
        self.assertTrue(all(params["rowLimit"] == 512 for _, params in cursor.queries))

    def test_screen_reuses_numeric_text_code_and_identifier_protection(self):
        values = {"LEADING": [f"{i:03d}" for i in range(100)], "SEQUENCE": [str(i) for i in range(100)],
                  "ROW_ID": [str(i % 30) for i in range(100)], "DIRTY": [str(i % 30) for i in range(99)] + ["invalid"]}
        for name, source in values.items():
            evidence = column_screen_evidence(column(name), [{name: value} for value in source])
            if name == "DIRTY":
                self.assertTrue(evidence["numericEligible"])
            else:
                self.assertFalse(evidence["numericEligible"])
        physical = column_screen_evidence(column("MEASURE", "NUMBER"), [{"MEASURE": i} for i in range(100)])
        self.assertTrue(physical["numericEligible"])
        # A source sorted by region can expose only a few fractional weights in
        # the prefix, even though their full-source cardinality is much larger.
        weights = column_screen_evidence(column("WEIGHT"), [{"WEIGHT": str((i % 12 + 1) * .1234)} for i in range(512)])
        self.assertEqual(12, weights["numericDistinctCount"])
        self.assertEqual(0, weights["priority"])

    def test_target_budget_prioritizes_measurements_but_keeps_exact_small_sum_first(self):
        rng = np.random.default_rng(25)
        code = rng.integers(0, 11, 800).astype(float)
        numeric = {"CODE_A": code, "CODE_B": code.copy(), "MEASURE": rng.normal(size=800), "SMALL_TOTAL": rng.integers(0, 5, 800).astype(float)}
        class Evidence:
            def priority(self, name):
                return 0.0 if name == "SMALL_TOTAL" else 1.0
        ranked = _rank_targets(numeric, list(numeric), np.arange(800), Evidence())
        self.assertEqual(["SMALL_TOTAL", "MEASURE"], ranked[:2])


if __name__ == "__main__":
    unittest.main()
