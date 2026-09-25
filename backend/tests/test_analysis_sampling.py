"""Offline hash-sampling contracts; does not claim Oracle plan validation."""
import hashlib
import random
import unittest

from backend.services.analysis_sampling import sample_rows


COLUMNS = [{"COLUMN_NAME": "GROUP_CODE", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 30},
           {"COLUMN_NAME": "VALUE_NUM", "DATA_TYPE": "NUMBER", "DATA_LENGTH": 22}]


class SamplingCursor:
    def __init__(self, records):
        self.records = records
        self.position = 0
        self.queries = []
        self.candidates = []
        self.finished = False

    def execute(self, sql, binds=None):
        binds = binds or {}
        self.queries.append((sql, binds))
        self.position = 0
        if "COUNT(*)" in sql:
            self.result = (len(self.records),)
        elif "ORA_HASH" in sql:
            # A deterministic hash adapter exercises the streaming contract,
            # without substituting this hash for Oracle in production.
            self.candidates = []
            for rowid, group, value in self.records:
                hash_value = int.from_bytes(hashlib.sha256(f"{binds['sampleSeed']}:{rowid}".encode()).digest()[:4], "big")
                if hash_value <= binds["hashThreshold"]:
                    self.candidates.append((rowid, hash_value, group, value))
        else:
            self.candidates = [(group, value) for _, group, value in self.records[:binds["rowLimit"]]]

    def fetchone(self):
        return self.result

    def fetchmany(self, count):
        batch = self.candidates[self.position:self.position + count]
        self.position += len(batch)
        if not batch:
            self.finished = True
        return batch


class AnalysisSamplingTests(unittest.TestCase):
    def sample(self, records, **kwargs):
        cursor = SamplingCursor(records)
        rows, diagnostics = sample_rows(cursor, owner="SOURCE", table="DATASET", columns=COLUMNS,
                                        row_limit=kwargs.pop("row_limit", 100), **kwargs)
        return rows, diagnostics, cursor

    def test_hash_visits_later_source_groups_and_consumes_all_candidates(self):
        records = [(str(i), "EARLY" if i < 1000 else "LATE", i) for i in range(10000)]
        rows, info, cursor = self.sample(records, strategy="HASH")
        self.assertEqual(100, len(rows))
        self.assertGreater(sum(row["GROUP_CODE"] == "LATE" for row in rows), 75)
        self.assertTrue(cursor.finished)
        self.assertEqual(len(cursor.candidates), info["hashCandidateCount"])
        self.assertGreater(info["hashCandidateCount"], len(rows))
        self.assertNotIn("ROWNUM", cursor.queries[1][0])
        self.assertNotIn("ORDER BY", cursor.queries[1][0])
        self.assertEqual(2, info["samplingSourcePasses"])
        self.assertFalse(info["sourceSnapshotPinned"])
        self.assertNotIn("SAMPLE_ROWID", rows[0])
        self.assertEqual(10000, info["sourceRowCountAtSampling"])

    def test_hash_reuses_same_subset_despite_scan_order_but_seed_changes_it(self):
        records = [(str(i), "G", i) for i in range(1000)]
        shuffled = list(records)
        random.Random(709).shuffle(shuffled)
        rows, _, _ = self.sample(records, strategy="HASH")
        repeated, _, _ = self.sample(shuffled, strategy="HASH")
        different, _, _ = self.sample(records, strategy="HASH", seed=43)
        self.assertEqual(rows, repeated)
        self.assertNotEqual(rows, different)

    def test_byte_bound_is_honest_and_scan_order_independent(self):
        records = [(str(i), "G" * (10 + i % 19), i) for i in range(250)]
        rows, info, cursor = self.sample(records, strategy="HASH", byte_limit=2400)
        reverse, reverse_info, _ = self.sample(list(reversed(records)), strategy="HASH", byte_limit=2400)
        self.assertEqual(rows, reverse)
        self.assertTrue(info["sampleByteLimitReached"])
        self.assertTrue(reverse_info["sampleByteLimitReached"])
        self.assertLessEqual(info["sampleEstimatedBytes"], 2400)
        self.assertTrue(cursor.finished)
        self.assertIn("HASH_SAMPLE_BYTE_TRUNCATED_NOT_REPRESENTATIVE", info["samplingWarnings"])

    def test_small_source_keeps_every_row_and_empty_source_avoids_second_scan(self):
        records = [(str(i), "G", i) for i in range(7)]
        rows, info, _ = self.sample(records, strategy="HASH")
        self.assertEqual(set(range(7)), {row["VALUE_NUM"] for row in rows})
        self.assertEqual(1., info["hashCandidateFraction"])
        self.assertFalse(info["sampleLimitReached"])
        rows, info, cursor = self.sample([], strategy="HASH")
        self.assertEqual([], rows)
        self.assertEqual(1, len(cursor.queries))
        self.assertEqual(1, info["samplingSourcePasses"])

    def test_unspecified_strategy_remains_explicit_legacy_prefix(self):
        rows, info, cursor = self.sample([(str(i), "G", i) for i in range(1000)])
        self.assertEqual(list(range(100)), [row["VALUE_NUM"] for row in rows])
        self.assertEqual("FIRST_ROWS", info["sampling"])
        self.assertEqual(1, len(cursor.queries))
        self.assertIn("NOT_POPULATION_REPRESENTATIVE", info["selectionMeaning"])

    def test_invalid_identifiers_limits_or_strategy_never_execute_sql(self):
        for options in ({"owner": "X;DROP TABLE X"}, {"row_limit": 25001}, {"seed": -1},
                        {"strategy": "RANDOM"}, {"byte_limit": 0}, {"row_limit": True}):
            cursor = SamplingCursor([])
            arguments = {"owner": "SOURCE", "table": "DATASET", "columns": COLUMNS, "row_limit": 100, **options}
            with self.assertRaises(ValueError):
                sample_rows(cursor, **arguments)
            self.assertEqual([], cursor.queries)


if __name__ == "__main__":
    unittest.main()
