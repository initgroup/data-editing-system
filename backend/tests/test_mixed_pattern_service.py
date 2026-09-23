"""Offline SQL-backed contract checks, without accessing a target database.

Oracle dictionary metadata is synthesized from the checked-in installation DDL.
SQLite evaluates actual generated IF/THEN predicates and full-source aggregates;
only Oracle scalar/ROWNUM syntax is adapted. Decimal bind fidelity is also checked
separately because SQLite does not have Oracle NUMBER's decimal precision.
"""
import copy
import json
import re
import sqlite3
import unittest
from pathlib import Path
from decimal import Decimal
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import mixed_pattern_service as service
from backend.services import mixed_xai_service as xai
from backend.tests.test_xai_sql_compatibility import schema_columns, sqlite_statement


PAYLOAD = {"targetOwner": "APP_OWNER", "targetTable": "SOURCE_DATA", "runSourceType": "FLOW_WORK", "runId": 41}
CTX = {"owner": "APP_OWNER", "tableName": "SOURCE_DATA", "runSourceType": "FLOW_WORK", "runId": 41}
COLUMNS = [{"COLUMN_NAME": "GROUP_CODE", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 40},
           {"COLUMN_NAME": "VALUE", "DATA_TYPE": "NUMBER", "DATA_LENGTH": 22},
           {"COLUMN_NAME": "FILE_ROW_NO", "DATA_TYPE": "NUMBER", "DATA_LENGTH": 22}]


def stored_rule(rule_id="R1", group="A", expected=1):
    return {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 41, "OWNER": "APP_OWNER",
            "TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": "SOURCE_DATA", "MODEL_NAME": "XAI_PATTERN_41",
            "MODEL_TYPE": "MIXED_PATTERN_TREE", "RULE_SOURCE": "MIXED_PATTERN_TREE", "RULE_ID": rule_id,
            "CONDITION_COUNT": 1, "CONDITION_TEXT": f"GROUP_CODE = '{group}'", "RESULT_COLUMN": "VALUE",
            "RESULT_VALUE": str(expected), "RESULT_TEXT": f"VALUE = {expected}", "RESULT_HAS_VALUE_YN": "Y",
            "RULE_CONFIDENCE": .99, "RULE_SUPPORT": .49, "RULE_LIFT": 1.98,
            "CONDITION_JSON": json.dumps({"column": "GROUP_CODE", "operator": "=", "value": group}),
            "RESULT_JSON": json.dumps({"column": "VALUE", "operator": "=", "value": expected, "valueType": "NUMBER"}),
            "RESULT_KIND": "VALUE", "VALIDATION_JSON": json.dumps({"confidence": .97, "conditionCount": 100,
                "supportCount": 97, "status": "VALIDATED", "source": "SELECTION_VALIDATION",
                "train": {"confidence": .99, "conditionCount": 300}})}


class SqlCursor:
    def __init__(self, connection):
        self.connection = connection
        self.cursor = connection.db.cursor()

    @property
    def description(self):
        return self.cursor.description

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()
        self.connection.closed_cursors += 1

    def execute(self, sql, params=None):
        params = params or {}
        expected = set(re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql))
        if expected != set(params):
            raise AssertionError(f"Bind mismatch: expected {expected}; got {set(params)}")
        sql_id = next((key for key, query in SqlLoader._query_map.items()
                       if key.startswith(("XAI_", "PATTERN_")) and query == sql), None)
        if sql_id is None:
            if "AS CASE_ROWID" in sql:
                sql_id = "PATTERN_PREVIEW"
            elif "SUM(CASE WHEN" in sql:
                sql_id = "XAI_MATCH_COUNTS"
            elif "COUNT(*)" in sql:
                sql_id = "PATTERN_UNIQUE_COUNT"
            elif "ROWNUM <= :rowLimit" in sql:
                sql_id = "XAI_SOURCE_SAMPLE"
        if sql_id is None:
            raise AssertionError("Unrecognized SQL executed")
        self.connection.events.append((sql_id, copy.deepcopy(params), sql))
        if sql_id == self.connection.fail_on:
            raise RuntimeError("Injected statement failure")
        adapted = sqlite_statement(sql).replace('"APP_OWNER"."SOURCE_DATA"', "SOURCE_TEST")
        if "ROWNUM <= :rowLimit" in adapted:
            adapted = adapted.replace("ROWNUM <= :rowLimit", "1=1") + " LIMIT :rowLimit"
        # Decimal accuracy is separately asserted on the original bind values.
        sqlite_params = {key: str(value) if isinstance(value, Decimal) else value for key, value in params.items()}
        return self.cursor.execute(adapted, sqlite_params)

    def fetchall(self):
        return self.cursor.fetchall()

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchmany(self, count):
        self.connection.fetch_sizes.append(count)
        return self.cursor.fetchmany(count)


class SqlConnection:
    def __init__(self, rows=None):
        self.db = sqlite3.connect(":memory:")
        self.events, self.fetch_sizes = [], []
        self.closed_cursors = self.commits = self.rollbacks = 0
        self.fail_on = None
        tables = schema_columns()
        for table in [*xai.TABLES, service.RULE_TABLE, service.VIOLATION_TABLE]:
            self.db.execute('CREATE TABLE "' + table + '" (' + ", ".join('"' + name + '"' for name in tables[table]) + ')')
        self.db.executescript("""
            CREATE VIEW USER_TABLES AS SELECT name AS TABLE_NAME FROM sqlite_master WHERE type = 'table';
            CREATE TABLE USER_TAB_COLUMNS (TABLE_NAME, COLUMN_NAME);
            CREATE TABLE ALL_TAB_COLS (OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, HIDDEN_COLUMN, COLUMN_ID);
            CREATE TABLE SOURCE_TEST (GROUP_CODE TEXT, VALUE NUMERIC, FILE_ROW_NO INTEGER);
        """)
        for table in [service.RULE_TABLE, service.VIOLATION_TABLE]:
            self.db.executemany("INSERT INTO USER_TAB_COLUMNS VALUES (?, ?)", [(table, name) for name in tables[table]])
        for index, column in enumerate(COLUMNS):
            self.db.execute("INSERT INTO ALL_TAB_COLS VALUES (?, ?, ?, ?, ?, ?, ?)",
                            ("APP_OWNER", "SOURCE_DATA", column["COLUMN_NAME"], column["DATA_TYPE"], column["DATA_LENGTH"], "NO", index))
        self.db.create_function("ROWIDTOCHAR", 1, lambda value: str(value))
        self.db.create_function("TO_CHAR", 1, lambda value: None if value is None else str(value))
        self.db.create_function("NVL", 2, lambda value, fallback: fallback if value is None else value)
        self.db.create_function("GREATEST", 2, lambda a, b: None if a is None or b is None else max(float(a), float(b)))
        rows = rows if rows is not None else [("A", 1, 101), ("A", 0, 102), ("A", None, 103),
                                               ("B", 2, 104), ("B", 3, 105), ("B", None, 106)]
        self.db.executemany("INSERT INTO SOURCE_TEST VALUES (?, ?, ?)", rows)
        self.db.commit()

    def cursor(self):
        return SqlCursor(self)

    def commit(self):
        self.commits += 1
        self.db.commit()

    def rollback(self):
        self.rollbacks += 1
        self.db.rollback()

    def insert(self, table, row):
        self.db.execute('INSERT INTO "' + table + '" (' + ", ".join(row) + ") VALUES (" + ", ".join("?" for _ in row) + ")", tuple(row.values()))

    def records(self, table):
        cursor = self.db.execute('SELECT * FROM "' + table + '"')
        names = [item[0] for item in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]

    def seed_rules(self, rules=None):
        for rule in rules if rules is not None else [stored_rule(), stored_rule("R2", "B", 2)]:
            self.insert(service.RULE_TABLE, rule)
        self.insert(xai.TABLES[0], {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 41, "TARGET_OWNER": "APP_OWNER",
                                  "TARGET_TABLE": "SOURCE_DATA", "SUMMARY_JSON": json.dumps({"algorithm": service.ALGORITHM, "algorithmVersion": 2})})
        self.db.commit()


class MixedPatternServiceTests(unittest.TestCase):
    def connection(self, rows=None):
        connection = SqlConnection(rows)
        self.addCleanup(connection.db.close)
        return connection

    def test_formula_counts_preserve_predictions_and_have_no_association_lift(self):
        conn = self.connection([("A", 202, 101), ("A", 210, 102), ("A", None, 103), ("B", 9, 104)])
        rule = stored_rule()
        result = {"operator": "WITHIN_TOLERANCE", "column": "VALUE",
            "expression": {"operator": "MULTIPLY", "left": {"column": "FILE_ROW_NO"}, "right": {"value": 2}},
            "absoluteTolerance": 1, "relativeTolerance": 0}
        rule.update(RESULT_KIND="FORMULA", RESULT_JSON=json.dumps(result), RESULT_VALUE="2 * FILE_ROW_NO ± 1")
        conn.seed_rules([rule])
        summary = xai.detect(conn, {**PAYLOAD, "maxViolationRows": 10})
        self.assertEqual(2, summary["violationCount"])
        self.assertEqual(2, summary["uniqueViolationCount"])
        stored = conn.records(service.RULE_TABLE)[0]
        self.assertAlmostEqual(1/3, stored["RULE_CONFIDENCE"])
        self.assertIsNone(stored["RULE_LIFT"])
        self.assertIsNone(stored["RESULT_TOTAL_COUNT"])
        violations = conn.records(service.VIOLATION_TABLE)
        self.assertEqual(["204", "206"], [v["EXPECTED_VALUE"] for v in violations])
        self.assertEqual(["210", None], [v["ACTUAL_VALUE"] for v in violations])
        self.assertEqual(["PATTERN_FORMULA_MISMATCH", "PATTERN_RESULT_MISSING"], [v["VIOLATION_REASON"] for v in violations])

    def test_formula_compiler_binds_literals_and_rejects_target_leakage(self):
        from backend.services.mixed_formula import compile_expression
        result = {"operator": "WITHIN_TOLERANCE", "column": "VALUE",
            "expression": {"operator": "DIVIDE", "left": {"column": "FILE_ROW_NO"}, "right": {"value": 2}},
            "absoluteTolerance": .5, "relativeTolerance": .1}
        sql, binds = xai.compile_predicate(result, COLUMNS)
        self.assertIn("NULLIF", sql)
        self.assertIn("GREATEST", sql)
        self.assertEqual({Decimal('2'), Decimal('.5'), Decimal('.1')}, set(binds.values()))
        for expression in ({"column": "VALUE"}, {"column": "GROUP_CODE"}, {"column": "FILE_ROW_NO);DROP TABLE T"}, {"value": 4}):
            with self.subTest(expression=expression), self.assertRaises(HTTPException):
                compile_expression(expression, COLUMNS, forbidden_column="VALUE")
        for tolerance in (-1, float('nan'), float('inf')):
            with self.subTest(tolerance=tolerance), self.assertRaises(HTTPException):
                xai.compile_predicate({**result, "absoluteTolerance": tolerance}, COLUMNS)

    def test_schema_error_identifies_missing_columns_without_writing_results(self):
        conn = self.connection()
        conn.db.execute("DELETE FROM USER_TAB_COLUMNS WHERE COLUMN_NAME IN ('RESULT_JSON', 'VIOLATION_COUNT')")
        with conn.cursor() as cursor, self.assertRaises(HTTPException) as caught:
            service.require_schema(cursor)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn('INIT$_TB_RULEDISC_ASSOC_SUM.RESULT_JSON', caught.exception.detail)
        self.assertIn('INIT$_TB_RULEDISC_ASSOC_SUM.VIOLATION_COUNT', caught.exception.detail)
        self.assertNotIn('INIT$_TB_RULEDISC_ASSOC_SUM.CONDITION_JSON', caught.exception.detail)
        self.assertIn('same Target DB account', caught.exception.detail)
        self.assertEqual([event[0] for event in conn.events], ['XAI_SCHEMA_CHECK', 'PATTERN_SCHEMA_CHECK'])
        self.assertEqual(conn.commits, 0)

    def test_manual_installers_declare_variables_before_local_subprograms(self):
        root = Path(__file__).resolve().parents[2] / 'database'
        for filename in ('INIT_TARGET_PATTERN.sql', 'INIT_TARGET_XAI.sql', 'INIT_TARGET_DDL.sql', 'INIT_TARGET_ALTER.sql'):
            with self.subTest(installer=filename):
                source = (root / filename).read_text(encoding='utf-8')
                block = source.split('-- Mixed pattern v2:', 1)[1].split('\n/\n', 1)[0]
                # Oracle requires local subprogram declarations after other
                # declarations. The former END; v_table_count NUMBER; failed
                # compilation before any of the five ALTERs could run.
                self.assertLess(block.index('v_table_count NUMBER;'), block.index('PROCEDURE add_pattern_column'))
                self.assertNotRegex(block, r'END;\s+v_table_count\s+NUMBER;')
                self.assertEqual(block.count('v_table_count NUMBER;'), 1)
                self.assertIn("IF v_table_count <> 5 THEN", block)
                self.assertIn("[OK] Mixed pattern schema: all 5 rule columns installed", block)

    def test_full_source_counts_null_violations_actual_values_and_fair_previews(self):
        conn = self.connection()
        conn.seed_rules()
        result = xai.detect(conn, {**PAYLOAD, "maxViolationRows": 3})
        self.assertEqual(result["violationCount"], 4)
        self.assertEqual(result["uniqueViolationCount"], 4)
        self.assertEqual(result["savedViolationCount"], 3)
        self.assertEqual(result["evaluatedRows"], 6)
        self.assertEqual(result["metricsCohort"], "FULL_TARGET")
        self.assertTrue(result["previewTruncated"])
        rules = conn.records(service.RULE_TABLE)
        for rule in rules:
            self.assertEqual((rule["CONDITION_TOTAL_COUNT"], rule["SUPPORT_COUNT"], rule["RESULT_TOTAL_COUNT"], rule["TOTAL_COUNT"]), (3, 1, 1, 6))
            self.assertEqual(rule["VIOLATION_COUNT"], 2)
            self.assertAlmostEqual(rule["RULE_CONFIDENCE"], 1 / 3)
            self.assertAlmostEqual(rule["RULE_SUPPORT"], 1 / 6)
            self.assertEqual(rule["RULE_LIFT"], 2)
        previews = conn.records(service.VIOLATION_TABLE)
        self.assertEqual({row["RULE_ID"] for row in previews}, {"R1", "R2"})
        self.assertEqual({row["CASE_ID"] for row in previews}, {"102", "103", "105"})
        self.assertEqual({row["ACTUAL_VALUE"] for row in previews}, {"0", None, "3"})
        self.assertEqual({row["RESULT_COLUMN"] for row in previews}, {"VALUE"})
        missing = next(row for row in previews if row["ACTUAL_VALUE"] is None)
        self.assertEqual(missing["VIOLATION_REASON"], "PATTERN_RESULT_MISSING")
        self.assertEqual(missing["EXPECTED_VALUE"], "1")
        self.assertAlmostEqual(missing["RULE_CONFIDENCE"], 1 / 3)
        self.assertIsNone(missing["VIOLATION_SCORE"])
        counts = [event for event in conn.events if event[0] == "XAI_MATCH_COUNTS"]
        self.assertEqual(len(counts), 1)
        self.assertNotIn("rowLimit", counts[0][1])
        self.assertNotIn("ROWNUM", counts[0][2])
        self.assertEqual(conn.commits, 0)

    def test_unique_rows_are_distinct_from_rule_row_violations(self):
        conn = self.connection()
        conn.seed_rules([stored_rule(), stored_rule("R2", "B", 2), stored_rule("R3")])
        result = xai.detect(conn, {**PAYLOAD, "maxViolationRows": 6})
        self.assertEqual(result["violationCount"], 6)
        self.assertEqual(result["uniqueViolationCount"], 4)
        self.assertEqual(result["savedViolationCount"], 6)

    def test_separate_data_work_detection_snapshots_rules_without_changing_discovery(self):
        conn = self.connection()
        rule = {**stored_rule(), "RUN_SOURCE_TYPE": "DATA_WORK", "RUN_ID": 39, "MODEL_NAME": "XAI_PATTERN_39"}
        conn.insert(service.RULE_TABLE, rule)
        current = {**CTX, "runSourceType": "DATA_WORK"}
        source = {**current, "runId": 39}
        with conn.cursor() as cursor:
            result = service.detect_patterns(cursor, current, source, {"algorithm": service.ALGORITHM, "ruleCount": 1}, 10)
        rows = conn.records(service.RULE_TABLE)
        self.assertEqual({r["RUN_ID"] for r in rows}, {39, 41})
        discovery = next(r for r in rows if r["RUN_ID"] == 39)
        applied = next(r for r in rows if r["RUN_ID"] == 41)
        self.assertEqual(discovery["RULE_CONFIDENCE"], .99)
        self.assertIsNone(discovery["VIOLATION_COUNT"])
        self.assertAlmostEqual(applied["RULE_CONFIDENCE"], 1 / 3)
        self.assertEqual(applied["VIOLATION_COUNT"], 2)
        self.assertTrue(all(v["RUN_ID"] == 41 and v["MODEL_NAME"] == applied["MODEL_NAME"] for v in conn.records(service.VIOLATION_TABLE)))
        self.assertEqual(result["discoveryRunId"], 39)
        self.assertEqual(conn.commits, 0)

    def test_full_source_count_batches_cover_all_rules_after_first_32(self):
        conn = self.connection()
        conn.seed_rules([stored_rule(f"R{index:02}") for index in range(33)])
        result = xai.detect(conn, {**PAYLOAD, "maxViolationRows": 40})
        counts = [event for event in conn.events if event[0] == "XAI_MATCH_COUNTS"]
        self.assertEqual(len(counts), 2)
        self.assertEqual(result["violationCount"], 66)
        self.assertEqual(result["uniqueViolationCount"], 2)
        self.assertEqual(result["savedViolationCount"], 40)
        self.assertEqual(len({row["RULE_ID"] for row in conn.records(service.VIOLATION_TABLE)}), 33)

    def test_generated_predicate_is_null_safe_and_exact_decimal_is_bound(self):
        rule = stored_rule()
        rule["RESULT_JSON"] = {"column": "VALUE", "operator": "=", "valueType": "NUMBER", "value": "1.000000000000000000001"}
        a, b, violation, binds = service.compile_violation(rule, COLUMNS)
        self.assertIn("CASE WHEN", violation)
        self.assertNotIn("NOT (", violation)
        self.assertNotIn("BINARY_FLOAT", b)
        self.assertEqual(binds["pb0"], Decimal("1.000000000000000000001"))
        self.assertNotIn("1.000000000000000000001", violation)
        rule["CONDITION_JSON"] = {"column": "GROUP_CODE", "operator": "=", "value": "a' OR 1=1 --"}
        _, _, sql, params = service.compile_violation(rule, COLUMNS)
        self.assertNotIn("a' OR 1=1 --", sql)
        self.assertIn("a' OR 1=1 --", params.values())

    def test_real_discovery_default_dispatch_persists_true_consequents_and_validation(self):
        rows = [("A" if i % 2 else "B", 1 if i % 2 else 2, i + 1) for i in range(800)]
        conn = self.connection(rows)
        result = xai.discover(conn, {**PAYLOAD, "sampleRows": 800})
        self.assertEqual(result["algorithm"], service.ALGORITHM)
        self.assertEqual(result["resultTable"], service.RULE_TABLE)
        self.assertGreater(result["ruleCount"], 0)
        rules = conn.records(service.RULE_TABLE)
        self.assertEqual(len(rules), result["ruleCount"])
        self.assertTrue(all(rule["RESULT_COLUMN"] != "ANOMALY_CANDIDATE" for rule in rules))
        self.assertTrue(all(rule["RESULT_VALUE"] is not None for rule in rules))
        self.assertTrue(all(json.loads(rule["VALIDATION_JSON"])["confidence"] == 1 for rule in rules))
        self.assertEqual(conn.records(xai.TABLES[1]), [])
        self.assertIn("FIRST_ROWS_SAMPLE_NOT_POPULATION_REPRESENTATIVE", result["warnings"])
        self.assertLessEqual(max(conn.fetch_sizes), 250)
        self.assertEqual(conn.commits, 0)
        self.assertEqual(conn.closed_cursors, 1)

    def test_detection_rejects_bad_then_before_any_result_writes(self):
        conn = self.connection()
        rule = stored_rule()
        rule["RESULT_JSON"] = json.dumps({"column": "MISSING", "operator": "=", "value": "bad"})
        conn.seed_rules([rule])
        with self.assertRaises(HTTPException) as caught:
            xai.detect(conn, PAYLOAD)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertFalse(any(event[0] in {"PATTERN_CLEAR_VIOLATIONS", "PATTERN_UPDATE_COUNTS"} for event in conn.events))

    def test_failure_never_commits_and_caller_can_roll_back_metrics_and_previews(self):
        conn = self.connection()
        conn.seed_rules()
        conn.fail_on = "PATTERN_INSERT_VIOLATION"
        with self.assertRaisesRegex(RuntimeError, "Injected statement failure"):
            xai.detect(conn, PAYLOAD)
        self.assertEqual(conn.commits, 0)
        conn.rollback()
        self.assertEqual(conn.records(service.VIOLATION_TABLE), [])
        self.assertTrue(all(rule["RULE_CONFIDENCE"] == .99 for rule in conn.records(service.RULE_TABLE)))

    def test_schema_is_manual_and_scope_preserves_other_runs_targets_and_models(self):
        conn = self.connection()
        conn.seed_rules()
        other = {**stored_rule("OTHER"), "RUN_ID": 42}
        conn.insert(service.RULE_TABLE, other)
        other = {**stored_rule("LEGACY"), "RULE_SOURCE": "ASSOCIATION_RULES", "MODEL_NAME": "OLD_MODEL"}
        conn.insert(service.RULE_TABLE, other)
        conn.db.commit()
        xai.detect(conn, PAYLOAD)
        untouched = [row for row in conn.records(service.RULE_TABLE) if row["RULE_ID"] in {"OTHER", "LEGACY"}]
        self.assertTrue(all(row["RULE_CONFIDENCE"] == .99 for row in untouched))
        self.assertEqual(len(untouched), 2)
        for sql_id, params, _ in conn.events:
            if sql_id in {"PATTERN_CLEAR_VIOLATIONS", "PATTERN_UPDATE_COUNTS", "PATTERN_INSERT_VIOLATION"}:
                self.assertEqual({key: params[key] for key in CTX}, CTX)
        conn.db.execute("DELETE FROM USER_TAB_COLUMNS WHERE COLUMN_NAME = 'RESULT_JSON'")
        conn.events.clear()
        with self.assertRaises(HTTPException) as caught:
            xai.detect(conn, PAYLOAD)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("INIT_TARGET_PATTERN.sql", str(caught.exception.detail))
        self.assertFalse(any("CREATE TABLE" in event[2] or "ALTER TABLE" in event[2] for event in conn.events))

    def test_rule_summary_preserves_real_result_and_separates_validation_from_population_confidence(self):
        stored = {**stored_rule(), "RULE_CONFIDENCE": .98, "VIOLATION_COUNT": 20}
        payload = service.rule_summary([stored], {"VALUE": "Actual numeric value"})
        result = payload["rules"][0]
        self.assertEqual(result["RULE_KIND"], service.ALGORITHM)
        self.assertEqual(result["RESULT_COLUMN"], "VALUE")
        self.assertEqual(result["RESULT_VALUE"], "1")
        self.assertEqual(result["RULE_CONFIDENCE"], .98)
        self.assertEqual(result["VALIDATION_CONFIDENCE"], .97)
        self.assertEqual(result["TRAIN_CONFIDENCE"], .99)
        self.assertEqual(result["VALIDATION_KIND"], "SELECTION_VALIDATION")
        self.assertEqual(result["CONDITION_COLUMNS"], ["GROUP_CODE"])
        self.assertEqual(payload["resultTop"][0]["RESULT_COLUMN"], "VALUE")
        self.assertEqual(payload["conditionDist"][0]["NON_PERFECT_CONF_RULES"], 1)

    def test_empty_rule_set_has_no_source_scan_and_retains_no_rules_state(self):
        conn = self.connection()
        conn.seed_rules([])
        result = xai.detect(conn, PAYLOAD)
        self.assertEqual(result["violationCount"], 0)
        self.assertEqual(result["savedViolationCount"], 0)
        self.assertFalse(any(event[0] in {"XAI_MATCH_COUNTS", "PATTERN_UNIQUE_COUNT", "PATTERN_PREVIEW"} for event in conn.events))


if __name__ == "__main__":
    unittest.main()
