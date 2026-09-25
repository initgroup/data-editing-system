"""Real algorithm -> persisted shared objects -> SQL detection -> analysis adapter.

The only database here is SQLite in memory, using the existing DDL-derived Oracle
test harness. No model results are mocked, so contract drift crosses all stages.
"""
import json
import unittest
from decimal import Decimal
from unittest.mock import patch

import numpy as np

from backend.services import mixed_pattern_service as patterns
from backend.services import mixed_xai_service as xai
from backend.services import edit_work_service as editing
from backend.services import mixed_formula
from backend.tests.test_mixed_pattern_service import SqlConnection, SqlCursor, PAYLOAD
from backend.tests.test_xai_sql_compatibility import sqlite_statement
from backend.tests.mixed_numeric_sqlite import adapt_numeric_text_sql, install_numeric_text_functions


class ContinuousPipelineConnection(SqlConnection):
    def __init__(self, rows):
        super().__init__([])
        self.db.execute("ALTER TABLE SOURCE_TEST ADD COLUMN X REAL")
        self.db.execute("ALTER TABLE SOURCE_TEST ADD COLUMN Y REAL")
        self.db.execute("ALTER TABLE SOURCE_TEST ADD COLUMN DENOM REAL")
        for offset, name in enumerate(["X", "Y", "DENOM"], start=3):
            self.db.execute("INSERT INTO ALL_TAB_COLS VALUES (?, ?, ?, ?, ?, ?, ?)",
                            ("APP_OWNER", "SOURCE_DATA", name, "NUMBER", 22, "NO", offset))
        self.db.execute("CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS)")
        self.db.executemany("INSERT INTO ALL_COL_COMMENTS VALUES (?, ?, ?, ?)",
                            [("APP_OWNER", "SOURCE_DATA", "Y", "Expected numeric result"),
                             ("APP_OWNER", "SOURCE_DATA", "VALUE", "Category code")])
        self.db.executemany("INSERT INTO SOURCE_TEST (GROUP_CODE, VALUE, FILE_ROW_NO, X, Y, DENOM) VALUES (?, ?, ?, ?, ?, ?)", rows)
        self.db.commit()


class UploadedNumericCursor(SqlCursor):
    def execute(self, sql, params=None):
        def adapt(statement):
            return adapt_numeric_text_sql(sqlite_statement(statement)).replace(
                '"APP_OWNER"."SOURCE_DATA"', 'SOURCE_UPLOADED')
        with patch("backend.tests.test_mixed_pattern_service.sqlite_statement", side_effect=adapt):
            return super().execute(sql, params)


class UploadedNumericConnection(SqlConnection):
    """M02001 upload contract: every user data column is VARCHAR2, row key NUMBER."""
    def __init__(self, rows, numeric_columns=("X", "Y")):
        super().__init__([])
        self.db.execute("CREATE TABLE SOURCE_UPLOADED (GROUP_CODE TEXT, REGION TEXT, FILE_ROW_NO INTEGER, "
                        + ", ".join(name + " TEXT" for name in numeric_columns) + ")")
        self.db.execute("DELETE FROM ALL_TAB_COLS")
        for offset, name in enumerate(["GROUP_CODE", "REGION", "FILE_ROW_NO", *numeric_columns]):
            self.db.execute("INSERT INTO ALL_TAB_COLS VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("APP_OWNER", "SOURCE_DATA", name, "NUMBER" if name == "FILE_ROW_NO" else "VARCHAR2", 4000, "NO", offset))
        self.db.execute("CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS)")
        self.db.executemany("INSERT INTO SOURCE_UPLOADED VALUES (" + ",".join("?" for _ in range(3 + len(numeric_columns))) + ")", rows)
        install_numeric_text_functions(self.db)
        self.db.create_function("ORA_HASH", 2, lambda value, _maximum: int(value))
        self.db.commit()

    def cursor(self):
        return UploadedNumericCursor(self)


class MixedContinuousPipelineTests(unittest.TestCase):
    def connection(self, rows):
        conn = ContinuousPipelineConnection(rows)
        self.addCleanup(conn.db.close)
        return conn

    def read_results(self, conn):
        summaries = conn.records(xai.TABLES[0])
        runs = [{"TARGET_OWNER": row["TARGET_OWNER"], "TARGET_TABLE": row["TARGET_TABLE"],
                 "summary": json.loads(row["SUMMARY_JSON"])} for row in summaries]
        with conn.cursor() as cursor:
            return patterns.read_pattern_results(cursor, {"runId": 41, "owner": "APP_OWNER", "tableName": "SOURCE_DATA"}, runs)["data"]

    def test_mixed_real_discovery_detection_and_analysis_preserve_formula_profiles(self):
        rng = np.random.default_rng(167)
        rows, expected, corrupt = [], {}, set()
        for index, value in enumerate(rng.uniform(5, 120, 1600)):
            actual = float(2.75 * value + 4)
            if index % 100 == 0:
                actual += 25
                corrupt.add(str(index + 1))
            elif index % 151 == 0:
                actual = None
                corrupt.add(str(index + 1))
            predictor = None if index == 17 else float(value)
            expected[str(index + 1)] = float(2.75 * value + 4)
            rows.append(("A" if index % 2 else "B", 1 if index % 2 else 2, index + 1, predictor, actual, 1.0))
        conn = self.connection(rows)
        snapshots = {
            "profile": {"stage": "M03001", "rowCount": len(rows), "columns": [{"column": "Y", "mean": 172.5, "missingCount": 10}]},
            "relationships": {"stage": "M03002", "pairs": [{"left": "X", "right": "Y", "correlation": .985}], "sampleRows": len(rows)},
        }
        conn.insert(xai.TABLES[0], {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 41,
            "TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": "SOURCE_DATA",
            "SUMMARY_JSON": json.dumps({"algorithm": "MIXED_PROFILE", **snapshots})})
        conn.db.commit()
        discovery = xai.discover(conn, {**PAYLOAD, "targetColumns": ["Y", "VALUE"], "sampleRows": 1600, "maxRules": 12})
        self.assertEqual({key: discovery[key] for key in snapshots}, snapshots)
        saved_discovery_summary = json.loads(conn.records(xai.TABLES[0])[0]["SUMMARY_JSON"])
        self.assertEqual({key: saved_discovery_summary[key] for key in snapshots}, snapshots)
        self.assertGreater(discovery["formulaRuleCount"], 0)
        stored = conn.records(patterns.RULE_TABLE)
        kinds = {rule["RESULT_KIND"] for rule in stored}
        self.assertTrue({"VALUE", "FORMULA"} <= kinds)
        formula = next(rule for rule in stored if rule["RESULT_KIND"] == "FORMULA")
        rule_id = formula["RULE_ID"]
        profile = json.loads(formula["VALIDATION_JSON"])
        self.assertIn("mae", profile["train"])
        self.assertIn("r2", profile["train"])
        self.assertIn("calibration", profile)
        self.assertLess(profile["toleranceFraction"], .05)
        detected = xai.detect(conn, {**PAYLOAD, "maxViolationRows": 1000})
        self.assertEqual(detected["metricsCohort"], "FULL_TARGET")
        self.assertEqual({key: detected[key] for key in snapshots}, snapshots)
        data = self.read_results(conn)
        self.assertEqual({key: data["summary"][key] for key in snapshots}, snapshots)
        normalized = next(rule for rule in data["ruleSummary"]["rules"] if rule["RULE_ID"] == rule_id)
        violations = [row for row in data["violations"] if row["RULE_ID"] == rule_id]
        self.assertEqual({row["CASE_ID"] for row in violations}, corrupt)
        self.assertNotIn("18", {row["CASE_ID"] for row in violations})
        self.assertEqual(normalized["RESULT_COLUMN"], "Y")
        self.assertEqual(normalized["RESULT_KIND"], "FORMULA")
        self.assertIsNone(normalized["RULE_LIFT"])
        self.assertIsNone(normalized["RESULT_TOTAL_COUNT"])
        self.assertEqual(normalized["CONDITION_TOTAL_COUNT"], len(rows) - 1)
        self.assertAlmostEqual(normalized["RULE_CONFIDENCE"], (len(rows) - 1 - len(corrupt)) / (len(rows) - 1))
        for row in violations:
            self.assertAlmostEqual(float(row["EXPECTED_VALUE"]), expected[row["CASE_ID"]], delta=1e-6)
            self.assertEqual(row["RESULT_COLUMN"], "Y")
            self.assertIn("EXPECTED_LOWER", row)
            self.assertIn("EXPECTED_UPPER", row)
            if row["ACTUAL_VALUE"] is not None:
                self.assertAlmostEqual(float(row["RESIDUAL"]), 25, delta=1e-6)
                self.assertEqual(row["VIOLATION_REASON"], "PATTERN_FORMULA_MISMATCH")
            else:
                self.assertEqual(row["VIOLATION_REASON"], "PATTERN_RESULT_MISSING")
        updated = next(rule for rule in conn.records(patterns.RULE_TABLE) if rule["RULE_ID"] == rule_id)
        self.assertEqual(json.loads(updated["VALIDATION_JSON"]), profile)
        self.assertEqual(data["ruleSummary"]["columnComments"]["Y"], "Expected numeric result")
        self.assertEqual(conn.commits, 0)
        json.dumps(data, allow_nan=False)

    def test_actual_ratio_discovery_sql_preserves_division_and_invalid_input_scope(self):
        rng = np.random.default_rng(225)
        rows = []
        for index, (a, b) in enumerate(np.column_stack([rng.uniform(-30, 70, 1800), rng.uniform(1, 8, 1800)])):
            actual = float(a / b + (10 if index % 200 == 0 else 0))
            denominator = 0.0 if index == 1 else float(b)
            rows.append(("A", 1, index + 1, float(a), actual, denominator))
        conn = self.connection(rows)
        discovery = xai.discover(conn, {**PAYLOAD, "targetColumns": ["Y"], "sampleRows": 1800})
        self.assertGreater(discovery["formulaRuleCount"], 0)
        formula = next(rule for rule in conn.records(patterns.RULE_TABLE) if rule["RESULT_KIND"] == "FORMULA")
        self.assertIn('"DIVIDE"', formula["RESULT_JSON"])
        xai.detect(conn, {**PAYLOAD, "maxViolationRows": 1000})
        data = self.read_results(conn)
        violations = [row for row in data["violations"] if row["RULE_ID"] == formula["RULE_ID"]]
        self.assertEqual({row["CASE_ID"] for row in violations}, {str(i + 1) for i in range(0, len(rows), 200)})
        self.assertNotIn("2", {row["CASE_ID"] for row in violations})
        for row in violations:
            source = rows[int(row["CASE_ID"]) - 1]
            self.assertAlmostEqual(float(row["EXPECTED_VALUE"]), source[3] / source[5], delta=1e-6)
            self.assertAlmostEqual(float(row["ABS_ERROR"]), 10, delta=1e-6)

    def test_csv_varchar_discovery_persistence_numeric_sql_and_real_result_analysis(self):
        rng = np.random.default_rng(706)
        rows, corrupted = [], set()
        for index, value in enumerate(rng.uniform(-40, 40, 800)):
            actual = 3.5 * value + 2
            if index % 100 == 0:
                actual += 10
                corrupted.add(str(index + 1))
            rows.append(("A" if index % 2 else "B", "001" if index % 2 else "002", index + 1,
                         format(value, ".17g"), format(actual, ".17g")))
        conn = UploadedNumericConnection(rows)
        self.addCleanup(conn.db.close)
        # An existing saved JOB has no newly introduced continuous parameters.
        discovery = xai.discover(conn, {**PAYLOAD, "targetColumns": ["Y", "REGION"]})
        continuous = discovery["continuous"]
        self.assertEqual(continuous["physicalNumericColumnCount"], 0)
        self.assertEqual(continuous["inferredNumericTextColumnCount"], 2)
        self.assertEqual(continuous["status"], "RULES_AVAILABLE")
        self.assertEqual(continuous["publishedRuleCount"], 1)
        stored = conn.records(patterns.RULE_TABLE)
        formula = next(rule for rule in stored if rule["RESULT_KIND"] == "FORMULA")
        self.assertTrue(json.loads(formula["RESULT_JSON"])["numericText"])
        self.assertEqual({r["RESULT_VALUE"] for r in stored if r["RESULT_KIND"] == "VALUE"}, {"001", "002"})
        # Later source rows must be safely checked under exactly the saved AST.
        conn.db.executemany("INSERT INTO SOURCE_UPLOADED VALUES (?, ?, ?, ?, ?)", [
            ("A", "001", 801, "12", "not numeric"),
            ("A", "001", 802, "12", None),
            ("A", "001", 803, "NaN", "44"),
            ("A", "001", 804, "012", "44"),
            ("A", "001", 805, " 12 ", "44"),
        ])
        detected = xai.detect(conn, {**PAYLOAD, "maxViolationRows": 1000})
        self.assertEqual(detected["continuous"], continuous)
        data = self.read_results(conn)
        self.assertEqual(data["summary"]["continuous"], continuous)
        result_rule = next(rule for rule in data["ruleSummary"]["rules"] if rule["RULE_ID"] == formula["RULE_ID"])
        self.assertEqual(result_rule["CONDITION_TOTAL_COUNT"], 803)
        violations = [row for row in data["violations"] if row["RULE_ID"] == formula["RULE_ID"]]
        self.assertEqual({v["CASE_ID"] for v in violations}, corrupted | {"801", "802"})
        invalid = next(row for row in violations if row["CASE_ID"] == "801")
        self.assertEqual(invalid["RESULT_COLUMN"], "Y")
        self.assertEqual(invalid["ACTUAL_VALUE"], "not numeric")
        self.assertAlmostEqual(float(invalid["EXPECTED_VALUE"]), 44, delta=1e-6)
        self.assertIsNone(invalid["RESIDUAL"])
        missing = next(row for row in violations if row["CASE_ID"] == "802")
        self.assertEqual(missing["VIOLATION_REASON"], "PATTERN_RESULT_MISSING")
        self.assertIn("EXPECTED_LOWER", missing)
        self.assertIn("JSON_VALUE", next(event[2] for event in conn.events if event[0] == "XAI_MATCH_COUNTS"))
        json.dumps(data, allow_nan=False)

    def test_disabled_saved_job_preserves_explicit_spaced_flag_and_diagnostic(self):
        rows = [("A" if index % 2 else "B", "001" if index % 2 else "002", index + 1,
                 str(index % 103), str(2 * (index % 103) + 1)) for index in range(400)]
        conn = UploadedNumericConnection(rows)
        self.addCleanup(conn.db.close)
        result = xai.discover(conn, {**PAYLOAD, "continuousEnabled": " N "})
        self.assertEqual(result["formulaRuleCount"], 0)
        self.assertFalse(result["continuous"]["enabled"])
        self.assertEqual(result["continuous"]["status"], "DISABLED")

    def test_uploaded_dirty_numeric_and_minority_regime_keep_sql_and_final_edit_scope(self):
        rng = np.random.default_rng(303)
        count = 3000
        train = np.sort(np.random.default_rng(42).permutation(count)[count // 4:])
        fit = np.random.default_rng(43).permutation(train)[int(np.ceil(len(train) * .25)):]
        majority_fit = [int(index) for index in fit if index % 25]
        invalid_target, invalid_predictor = majority_fit[:2]
        numeric_corruption = 0  # A minority row; both regimes need real checks.
        rows = []
        for index, x in enumerate(rng.uniform(5, 100, count)):
            group = "B" if index % 25 == 0 else "A"
            y = 5 * x - 10 if group == "B" else 2 * x + 3
            if index == numeric_corruption:
                y += 25
            rows.append((group, "001", index + 1,
                         "bad input" if index == invalid_predictor else format(x, ".17g"),
                         "bad result" if index == invalid_target else format(y, ".17g")))
        conn = UploadedNumericConnection(rows)
        self.addCleanup(conn.db.close)
        discovery = xai.discover(conn, {**PAYLOAD, "targetColumns": ["Y"], "sampleRows": count})
        self.assertEqual(2, discovery["formulaRuleCount"])
        inference = {item["column"]: item for item in discovery["continuous"]["columnInference"]}
        self.assertEqual(1, inference["Y"]["invalidCount"])
        self.assertEqual(1, inference["X"]["invalidCount"])
        xai.detect(conn, {**PAYLOAD, "maxViolationRows": 1000})
        data = self.read_results(conn)
        violations = data["violations"]
        expected_ids = {str(invalid_target + 1), str(numeric_corruption + 1)}
        self.assertEqual(expected_ids, {row["CASE_ID"] for row in violations})
        self.assertEqual(2, len(violations))
        invalid = next(row for row in violations if row["CASE_ID"] == str(invalid_target + 1))
        self.assertEqual("bad result", invalid["ACTUAL_VALUE"])
        self.assertIsNone(invalid["ABS_ERROR"])
        self.assertNotIn(str(invalid_predictor + 1), expected_ids)

        columns = {name: {"COLUMN_NAME": name, "DATA_TYPE": "NUMBER" if name == "FILE_ROW_NO" else "VARCHAR2"}
                   for name in ("GROUP_CODE", "REGION", "FILE_ROW_NO", "X", "Y")}
        live_ids = set()
        for number, stored in enumerate(conn.records(patterns.RULE_TABLE), start=1):
            if stored["RESULT_KIND"] != "FORMULA":
                continue
            result = json.loads(stored["RESULT_JSON"])
            self.assertTrue(result["numericText"])
            reviewed = {**stored, "EDIT_RULE_ID": number, "SOURCE_RULE_TYPE": "ASSOCIATION", "USER_RULE_YN": "N",
                        "SOURCE_OBJECT_NAME": stored["MODEL_NAME"], "SOURCE_RULE_ID": stored["RULE_ID"],
                        "TARGET_COLUMN": "Y", "CASE_ID_COLUMN": "FILE_ROW_NO",
                        "CONDITION_AST": json.loads(stored["CONDITION_JSON"]), "RESULT_AST": result}
            sql, binds = editing._build_live_rule_violation_sql(None, reviewed, None, table_columns_override=columns)
            adapted = adapt_numeric_text_sql(sqlite_statement(sql)).replace('"APP_OWNER"."SOURCE_DATA"', "SOURCE_UPLOADED")
            cursor = conn.db.execute(adapted, {key: float(value) if isinstance(value, Decimal) else value for key, value in binds.items()})
            live = [dict(zip([column[0] for column in cursor.description], row)) for row in cursor.fetchall()]
            live_ids.update(row["CASE_ID"] for row in live)
        self.assertEqual(expected_ids, live_ids)

    def test_small_additive_component_survives_varchar_discovery_sql_and_final_edit_review(self):
        rng = np.random.default_rng(202610)
        source = np.column_stack([rng.uniform(-1000, 1000, 800), rng.uniform(-3, 3, 800)])
        rows, corrupted = [], set()
        for index, (b, c) in enumerate(source):
            actual = b + c
            if index % 100 == 0:
                actual += 25
                corrupted.add(str(index + 1))
            rows.append(("A", "001", index + 1, format(b, ".17g"), format(c, ".17g"), format(actual, ".17g")))
        conn = UploadedNumericConnection(rows, numeric_columns=("B", "C", "A"))
        self.addCleanup(conn.db.close)
        discovery = xai.discover(conn, {**PAYLOAD, "targetColumns": ["A"]})
        self.assertGreater(discovery["formulaRuleCount"], 0)
        stored = next(row for row in conn.records(patterns.RULE_TABLE) if row["RESULT_KIND"] == "FORMULA")
        result = json.loads(stored["RESULT_JSON"])
        expression = result["expression"]
        self.assertEqual("ADD", expression["operator"])
        self.assertEqual({"column", "numericText"}, set(expression["left"]), json.dumps(expression))
        self.assertEqual({"column", "numericText"}, set(expression["right"]), json.dumps(expression))
        self.assertEqual({"B", "C"}, {expression["left"]["column"], expression["right"]["column"]})
        self.assertTrue(expression["left"]["numericText"] and expression["right"]["numericText"])
        self.assertLess(result["absoluteTolerance"], 1e-5)
        validation = json.loads(stored["VALIDATION_JSON"])
        self.assertEqual("SUM_DIFFERENCE", validation["discoveryMethod"])
        self.assertEqual("CANONICAL_SIMPLE", validation["coefficientPolicy"])
        additions = [
            ("A", "001", 801, "12", "8", "20"),
            ("A", "001", 802, "12", "8", "21"),
            ("A", "001", 803, "12", "8", None),
            ("A", "001", 804, "12", "8", "invalid"),
            ("A", "001", 805, "invalid", "8", "20"),
            ("A", "001", 806, "12", None, "20"),
            ("A", "001", 807, "12", "08", "20"),
            ("A", "001", 808, "1.2e1", "+.5", "12.5"),
        ]
        conn.db.executemany("INSERT INTO SOURCE_UPLOADED VALUES (?, ?, ?, ?, ?, ?)", additions)
        xai.detect(conn, {**PAYLOAD, "maxViolationRows": 1000})
        data = self.read_results(conn)
        normalized = next(row for row in data["ruleSummary"]["rules"] if row["RULE_ID"] == stored["RULE_ID"])
        violations = [row for row in data["violations"] if row["RULE_ID"] == stored["RULE_ID"]]
        self.assertEqual(corrupted | {"802", "803", "804"}, {row["CASE_ID"] for row in violations})
        self.assertEqual(805, normalized["CONDITION_TOTAL_COUNT"])
        self.assertEqual(expression, normalized["FORMULA_EXPRESSION"])
        self.assertEqual("SUM_DIFFERENCE", normalized["FORMULA_METHOD"])
        self.assertEqual("CANONICAL_SIMPLE", normalized["COEFFICIENT_POLICY"])
        for row in violations:
            if row["CASE_ID"] in {"802", "803", "804"}:
                self.assertAlmostEqual(20, float(row["EXPECTED_VALUE"]), delta=1e-8)
        invalid = next(row for row in violations if row["CASE_ID"] == "804")
        self.assertEqual("invalid", invalid["ACTUAL_VALUE"])
        self.assertIsNone(invalid["ABS_ERROR"])

        # Reuse the persisted source AST in final editing, with no model refit.
        reviewed = {**stored, "EDIT_RULE_ID": 7, "SOURCE_RULE_TYPE": "ASSOCIATION", "USER_RULE_YN": "N",
                    "SOURCE_OBJECT_NAME": stored["MODEL_NAME"], "SOURCE_RULE_ID": stored["RULE_ID"],
                    "TARGET_COLUMN": "A", "CASE_ID_COLUMN": "FILE_ROW_NO",
                    "CONDITION_AST": json.loads(stored["CONDITION_JSON"]), "RESULT_AST": result}
        columns = {name: {"COLUMN_NAME": name, "DATA_TYPE": "NUMBER" if name == "FILE_ROW_NO" else "VARCHAR2"}
                   for name in ("GROUP_CODE", "REGION", "FILE_ROW_NO", "B", "C", "A")}
        sql, binds = editing._build_live_rule_violation_sql(None, reviewed, None, table_columns_override=columns)
        adapted = adapt_numeric_text_sql(sqlite_statement(sql)).replace('"APP_OWNER"."SOURCE_DATA"', "SOURCE_UPLOADED")
        cursor = conn.db.execute(adapted, {key: float(value) if isinstance(value, Decimal) else value for key, value in binds.items()})
        live = [dict(zip([column[0] for column in cursor.description], row)) for row in cursor.fetchall()]
        self.assertEqual({row["CASE_ID"] for row in violations}, {row["CASE_ID"] for row in live})
        self.assertEqual("N", reviewed["AUTO_REPLACE_YN"])
        self.assertTrue(editing._pattern_result_accepts_value(reviewed, "20", expected_value="20"))
        self.assertFalse(editing._pattern_result_accepts_value(reviewed, "B + C", expected_value="20"))

    def test_cancelling_numeric_text_inputs_keep_decimal_source_rows_inside_saved_tolerance(self):
        rng = np.random.default_rng(921)
        b_values = 1e10 + rng.uniform(-100, 100, 1000)
        c_values = -1e10 + rng.uniform(-100, 100, 1000)
        rows = [("A", "001", index + 1, format(b, ".17g"), format(c, ".17g"), format(b + c, ".17g"))
                for index, (b, c) in enumerate(zip(b_values, c_values))]
        conn = UploadedNumericConnection(rows, numeric_columns=("B", "C", "A"))
        self.addCleanup(conn.db.close)
        discovery = xai.discover(conn, {**PAYLOAD, "targetColumns": ["A"]})
        self.assertGreater(discovery["formulaRuleCount"], 0)
        stored = next(row for row in conn.records(patterns.RULE_TABLE) if row["RESULT_KIND"] == "FORMULA")
        result = json.loads(stored["RESULT_JSON"])
        validation = json.loads(stored["VALIDATION_JSON"])
        self.assertEqual("SUM_DIFFERENCE", validation["discoveryMethod"])
        self.assertGreater(validation["numericalToleranceFloor"], 0)
        self.assertLessEqual(validation["numericalToleranceFloor"], result["absoluteTolerance"])
        self.assertLessEqual(validation["toleranceFraction"], .05)
        expression = result["expression"]
        self.assertEqual("ADD", expression["operator"])
        self.assertEqual({"B", "C"}, {expression["left"]["column"], expression["right"]["column"]})
        # SQLite uses binary arithmetic. Explicitly cross-check the saved AST
        # with 38-digit Decimal source semantics used by Oracle NUMBER instead.
        false_violations, source_differences = [], []
        for row in rows:
            expected = mixed_formula.evaluate_expression(expression, {"B": row[3], "C": row[4]})
            source_differences.append(abs(Decimal(row[5]) - expected))
            if not mixed_formula.accepts_expected(result, row[5], expected):
                false_violations.append(row[2])
        self.assertGreater(max(source_differences), Decimal("1e-7"))
        self.assertEqual([], false_violations,
            f"Saved tolerance {result['absoluteTolerance']} must cover source decimal roundoff {max(source_differences)}")
        self.assertLess(result["absoluteTolerance"], .001)
        expected = mixed_formula.evaluate_expression(expression, {"B": rows[0][3], "C": rows[0][4]})
        self.assertFalse(mixed_formula.accepts_expected(result, str(expected + Decimal(".01")), expected))
        self.assertFalse(mixed_formula.accepts_expected(result, None, expected))
        self.assertFalse(mixed_formula.accepts_expected(result, "invalid", expected))


if __name__ == "__main__":
    unittest.main()
