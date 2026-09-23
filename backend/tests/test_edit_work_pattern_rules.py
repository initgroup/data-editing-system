"""Offline contract tests for true mixed-pattern rules in final editing."""
import json
import re
import sqlite3
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from backend.database_helper import SqlLoader
from backend.services import edit_work_service as service
from backend.services import mixed_formula
from backend.tests.mixed_numeric_sqlite import adapt_numeric_text_sql, install_numeric_text_functions

ROOT = Path(__file__).resolve().parents[2]
COLUMNS = {name: {"COLUMN_NAME": name, "DATA_TYPE": "NUMBER"} for name in ("GROUP_CODE", "RESULT_CODE")}


def atom(column, operator, value=None):
    return {"column": column, "operator": operator, "value": value, "valueType": "NUMBER"}


def rule(result=None):
    return {
        "EDIT_RULE_ID": 7, "SOURCE_RULE_TYPE": "ASSOCIATION", "USER_RULE_YN": "N",
        "SOURCE_RUN_SOURCE_TYPE": "FLOW_WORK", "SOURCE_RUN_ID": 10,
        "SOURCE_OWNER": "OWNER", "SOURCE_OBJECT_NAME": "XAI_PATTERN_10", "SOURCE_RULE_ID": "RULE_1",
        "TARGET_OWNER": "OWNER", "TARGET_TABLE": "INITUP_TEST", "TARGET_COLUMN": "RESULT_CODE",
        "RULE_EXPRESSION": "GROUP_CODE = 1", "EXPECTED_VALUE": "2", "RULE_SOURCE": "MIXED_PATTERN_TREE",
        "CONDITION_AST": atom("GROUP_CODE", "=", 1),
        "RESULT_AST": result or atom("RESULT_CODE", "=", 2),
    }


class PatternEditingTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.execute("ATTACH DATABASE ':memory:' AS OWNER")
        self.conn.execute("CREATE TABLE OWNER.INITUP_TEST (GROUP_CODE NUMBER, RESULT_CODE NUMBER)")
        self.conn.create_function("ROWIDTOCHAR", 1, str)
        self.conn.create_function("ORA_HASH", 2, lambda value, maximum: int(value))
        self.conn.create_function("TO_CHAR", 1, lambda value: None if value is None else str(value))
        self.conn.create_function("GREATEST", 2, lambda a, b: None if a is None or b is None else max(float(a), float(b)))
        self.cursor = self.conn.cursor()
        self.addCleanup(self.cursor.close)

    def live(self, row, records):
        self.conn.executemany("INSERT INTO OWNER.INITUP_TEST VALUES (?, ?)", records)
        sql, binds = service._build_live_rule_violation_sql(self.cursor, row, None, table_columns_override=COLUMNS)
        self.assertNotIn("{resultExpression}", sql)
        self.assertIn("CASE WHEN", sql)
        self.cursor.execute(sql.replace("SYSTIMESTAMP", "CURRENT_TIMESTAMP"),
                            {key: float(value) if isinstance(value, Decimal) else value for key, value in binds.items()})
        return [dict(zip([c[0] for c in self.cursor.description], values)) for values in self.cursor.fetchall()]

    def test_equality_detects_different_and_null_then_but_not_unrelated_rows(self):
        rows = self.live(rule(), [(1, 2), (1, 3), (1, None), (0, 3), (None, 3)])
        self.assertEqual(["3", None], [row["ACTUAL_VALUE"] for row in rows])
        self.assertEqual(["2", "2"], [row["EXPECTED_VALUE"] for row in rows])
        with patch.object(service, "_table_column_map", return_value=COLUMNS):
            evaluated = service._evaluate_rules_on_table(self.cursor, [rule()], target_owner="OWNER", target_table="INITUP_TEST")
        self.assertEqual(2, evaluated[0]["VIOLATION_COUNT"])

    def formula_rule(self):
        result = {"operator": "WITHIN_TOLERANCE", "column": "RESULT_CODE",
            "expression": {"operator": "ADD", "left": {"column": "GROUP_CODE"}, "right": {"value": 2}},
            "absoluteTolerance": .25, "relativeTolerance": 0}
        return {**rule(result), "RESULT_KIND": "FORMULA", "EXPECTED_VALUE": "GROUP_CODE + 2 ± .25"}

    def test_formula_live_results_use_row_predictions_and_null_safe_band(self):
        rows = self.live(self.formula_rule(), [(1, 3), (1, 3.2), (1, 4), (1, None), (0, 99)])
        self.assertEqual(["4", None], [r["ACTUAL_VALUE"] for r in rows])
        self.assertEqual(["3.0", "3.0"], [r["EXPECTED_VALUE"] for r in rows])
        self.assertEqual([1, None], [r["ABS_ERROR"] for r in rows])

    def test_formula_correction_uses_current_source_predictors(self):
        row = self.formula_rule()
        class PredictionCursor:
            def execute(self, sql, binds):
                self.sql, self.binds = sql, binds
            def fetchone(self):
                return (Decimal(3),)
        cursor = PredictionCursor()
        for value in ("GROUP_CODE + 2", "NaN", 3.3, None):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                service._validate_pattern_replacement(cursor, row, value, COLUMNS,
                    owner="OWNER", edit_table="INITDN_TEST", source_rowid="ROW1")
        self.assertEqual("3", service._validate_pattern_replacement(cursor, row, 3.1, COLUMNS,
            owner="OWNER", edit_table="INITDN_TEST", source_rowid="ROW1"))
        self.assertIn('"OWNER"."INITDN_TEST"', cursor.sql)
        self.assertEqual('ROW1', cursor.binds['sourceRowid'])
        self.assertTrue(service._pattern_result_accepts_value(row, 3.1, expected_value=3))
        self.assertFalse(service._pattern_result_accepts_value(row, 3.3, expected_value=3))

    def test_formula_final_analysis_uses_continuous_error_and_absolute_tolerance(self):
        row = self.formula_rule()
        analysis = service._build_edit_analysis(session={"SOURCE_ROW_COUNT": 10}, summary={}, rules=[row],
            changes=[{"EDIT_RULE_ID": 7, "CHANGE_STATUS": "APPLIED", "OLD_VALUE": "4", "NEW_VALUE": "3.2", "EXPECTED_VALUE": "3"}],
            source_evaluation=[{"EDIT_RULE_ID": 7, "VIOLATION_COUNT": 1, "VIOLATED_ROW_COUNT": 1}],
            edit_evaluation=[{"EDIT_RULE_ID": 7, "VIOLATION_COUNT": 0, "VIOLATED_ROW_COUNT": 0}], evaluation_error=None)
        self.assertEqual(0, analysis["CATEGORICAL"]["RULE_COUNT"])
        self.assertEqual(1, analysis["CONTINUOUS"]["RULE_COUNT"])
        self.assertEqual(1, analysis["OVERALL"]["EXPECTED_MATCH_COUNT"])

    def test_numeric_text_addition_correction_rechecks_saved_ast_and_current_predictors(self):
        install_numeric_text_functions(self.conn)
        self.conn.execute('CREATE TABLE OWNER.INITDN_ARITH (A TEXT, B TEXT, C TEXT, "INIT$_SOURCE_ROWID" TEXT)')
        self.conn.executemany("INSERT INTO OWNER.INITDN_ARITH VALUES (?,?,?,?)", [
            ("20", "12", "8", "NORMAL"), ("21", "12", "8", "DIFFERENT"),
            (None, "12", "8", "MISSING"), ("invalid", "12", "8", "INVALID"),
            ("20", "invalid", "8", "BAD_INPUT"), ("20", "12", None, "MISSING_INPUT"),
            ("20", "12", "08", "CODE_INPUT"), ("12.5", "1.2e1", ".5", "SCIENTIFIC")])
        columns = {name: {"COLUMN_NAME": name, "DATA_TYPE": "VARCHAR2"}
                   for name in ("A", "B", "C", service.TRACKING_COLUMN)}
        saved = {"operator": "WITHIN_TOLERANCE", "column": "A", "numericText": True,
                 "expression": {"operator": "ADD", "left": {"column": "B", "numericText": True},
                                "right": {"column": "C", "numericText": True}},
                 "absoluteTolerance": .000001, "relativeTolerance": 0}
        reviewed = {**rule(json.loads(json.dumps(saved))), "RESULT_KIND": "FORMULA", "TARGET_COLUMN": "A",
                    "TARGET_TABLE": "INITDN_ARITH", "CASE_ID_COLUMN": service.TRACKING_COLUMN,
                    "CONDITION_AST": {"operator": "AND", "conditions": [
                        {"column": name, "operator": "NOT_NULL", "numericText": True} for name in ("B", "C")]}}

        class NumericCursor:
            def __init__(self, cursor):
                self.cursor = cursor
            def execute(self, sql, binds=None):
                sql = adapt_numeric_text_sql(sql).replace("SYSTIMESTAMP", "CURRENT_TIMESTAMP")
                return self.cursor.execute(sql, {key: float(value) if isinstance(value, Decimal) else value
                                                for key, value in (binds or {}).items()})
            def __getattr__(self, name):
                return getattr(self.cursor, name)

        cursor = NumericCursor(self.cursor)
        sql, binds = service._build_live_rule_violation_sql(cursor, reviewed, None, table_columns_override=columns)
        cursor.execute(sql, binds)
        live = [dict(zip([column[0] for column in cursor.description], values)) for values in cursor.fetchall()]
        self.assertEqual({"DIFFERENT", "MISSING", "INVALID"}, {row["CASE_ID"] for row in live})
        self.assertEqual({"20.0"}, {row["EXPECTED_VALUE"] for row in live})
        for value in ("B + C", "21", "020", "invalid", None):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                service._validate_pattern_replacement(cursor, reviewed, value, columns,
                    owner="OWNER", edit_table="INITDN_ARITH", source_rowid="DIFFERENT")
        self.assertEqual("20.0", service._validate_pattern_replacement(cursor, reviewed, "20", columns,
            owner="OWNER", edit_table="INITDN_ARITH", source_rowid="DIFFERENT"))
        # A changed input invalidates a stale correction even without model refit.
        self.conn.execute('UPDATE OWNER.INITDN_ARITH SET C = ? WHERE "INIT$_SOURCE_ROWID" = ?', ("9", "DIFFERENT"))
        with self.assertRaises(HTTPException):
            service._validate_pattern_replacement(cursor, reviewed, "20", columns,
                owner="OWNER", edit_table="INITDN_ARITH", source_rowid="DIFFERENT")
        self.assertEqual("21.0", service._validate_pattern_replacement(cursor, reviewed, "21", columns,
            owner="OWNER", edit_table="INITDN_ARITH", source_rowid="DIFFERENT"))
        with self.assertRaises(HTTPException) as invalid_input:
            service._validate_pattern_replacement(cursor, reviewed, "20", columns,
                owner="OWNER", edit_table="INITDN_ARITH", source_rowid="BAD_INPUT")
        self.assertEqual(409, invalid_input.exception.status_code)

    def test_canonical_add_subtract_signed_unit_and_intercept_compile_exactly(self):
        install_numeric_text_functions(self.conn)
        self.conn.execute("CREATE TABLE OWNER.FORMULA_INPUT (B TEXT, C TEXT)")
        self.conn.execute("INSERT INTO OWNER.FORMULA_INPUT VALUES ('12', '8')")
        columns = [{"COLUMN_NAME": name, "DATA_TYPE": "VARCHAR2"} for name in ("B", "C")]
        b, c = {"column": "B", "numericText": True}, {"column": "C", "numericText": True}
        addition = {"operator": "ADD", "left": b, "right": c}
        cases = [(addition, 20), ({"operator": "SUBTRACT", "left": b, "right": c}, 4),
                 ({"operator": "ADD", "left": {"operator": "MULTIPLY", "left": {"value": -1}, "right": b}, "right": c}, -4),
                 ({"operator": "ADD", "left": addition, "right": {"value": 5}}, 25)]
        for expression, expected in cases:
            with self.subTest(expression=expression):
                sql, binds, referenced = mixed_formula.compile_expression(expression, columns)
                self.assertEqual({"B", "C"}, referenced)
                result = self.conn.execute("SELECT " + adapt_numeric_text_sql(sql) + " FROM OWNER.FORMULA_INPUT T",
                    {key: float(value) if isinstance(value, Decimal) else value for key, value in binds.items()}).fetchone()[0]
                self.assertEqual(expected, result)
                self.assertEqual(Decimal(expected), mixed_formula.evaluate_expression(expression, {"B": "12", "C": "8"}))

    def test_rule_group_sql_keeps_formulas_in_continuous_without_new_column_dependencies(self):
        from backend.tests.test_xai_sql_compatibility import schema_columns
        schema = schema_columns()
        for table in ("INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEDISC_SYMBOLIC", "INIT$_TB_RULEVIOL_ASSOC", "INIT$_TB_RULEVIOL_SYMBOLIC", "INIT$_TB_EDIT_RULE"):
            # This lookup must also parse on pre-pattern installations.
            old_columns = [c for c in schema[table] if c not in {"CONDITION_JSON", "RESULT_JSON", "VALIDATION_JSON", "RESULT_KIND", "VIOLATION_COUNT"}]
            self.conn.execute('CREATE TABLE "' + table + '" (' + ','.join('"' + c + '"' for c in old_columns) + ')')
        self.conn.execute('CREATE TABLE DUAL (DUMMY)')
        self.conn.execute('INSERT INTO DUAL VALUES (1)')
        self.conn.create_function("LOB_SUBSTR", 3, lambda value, length, start: value[start-1:start-1+length] if value is not None else None)
        self.conn.create_function("NVL", 2, lambda value, default: default if value is None else value)
        for rule_id, source in (("MIXED_FORMULA_A", "MIXED_PATTERN_TREE"), ("MIXED_PATTERN_B", "MIXED_PATTERN_TREE"), ("MIXED_FORMULA_LEGACY", "ASSOCIATION_RULES")):
            self.conn.execute('INSERT INTO "INIT$_TB_RULEDISC_ASSOC_SUM" (RUN_SOURCE_TYPE,RUN_ID,OWNER,MODEL_NAME,RULE_ID,TARGET_OWNER,TARGET_TABLE,RESULT_COLUMN,RULE_SOURCE) VALUES (?,?,?,?,?,?,?,?,?)',
                ("FLOW_WORK", 10, "OWNER", "XAI_PATTERN_10", rule_id, "OWNER", "INITUP_TEST", "RESULT_CODE", source))
        params = {"runSourceType": "FLOW_WORK", "runId": 10, "targetOwner": "OWNER", "targetTable": "INITUP_TEST",
            "decisionStatus": "ALL", "violationScope": "ALL", "projectId": 1, "scenarioId": 2, "resolvedScenarioId": 2,
            "keyword": None, "offset": 0, "limit": 20}
        for group, expected in (("CONTINUOUS", {"MIXED_FORMULA_A"}), ("CATEGORICAL", {"MIXED_PATTERN_B", "MIXED_FORMULA_LEGACY"})):
            with self.subTest(group=group):
                sql = SqlLoader.get_sql("MCOMMON_EDIT_RULE_SOURCE_PAGE").replace("DBMS_LOB.SUBSTR", "LOB_SUBSTR")
                sql = re.sub(r"OFFSET :offset ROWS\s+FETCH NEXT :limit ROWS ONLY", "LIMIT :limit OFFSET :offset", sql)
                self.cursor.execute(sql, {**params, "ruleGroup": group})
                rows = [dict(zip([c[0] for c in self.cursor.description], values)) for values in self.cursor.fetchall()]
                self.assertEqual(expected, {r["SOURCE_RULE_ID"] for r in rows})
                self.assertTrue(all(r["RULE_GROUP_CODE"] == group and r["SOURCE_RULE_TYPE"] == "ASSOCIATION" for r in rows))
                counts_sql = SqlLoader.get_sql("MCOMMON_EDIT_RULE_SOURCE_COUNTS").replace("DBMS_LOB.SUBSTR", "LOB_SUBSTR")
                self.cursor.execute(counts_sql, {**params, "ruleGroup": group})
                self.assertEqual((len(expected), 0), self.cursor.fetchone())

    def test_range_has_explicit_boundaries_and_null_is_failure(self):
        result = {"operator": "AND", "conditions": [atom("RESULT_CODE", ">", 10), atom("RESULT_CODE", "<=", 20)]}
        row = rule(result)
        row["EXPECTED_VALUE"] = "(10, 20]"
        rows = self.live(row, [(1, 10), (1, 11), (1, 20), (1, 21), (1, None), (0, 30)])
        self.assertEqual(["10", "21", None], [item["ACTUAL_VALUE"] for item in rows])
        with patch.object(service, "_table_column_map", return_value=COLUMNS):
            result_rows = service._evaluate_rules_on_table(self.cursor, [row], target_owner="OWNER", target_table="INITUP_TEST")
        self.assertEqual(3, result_rows[0]["VIOLATION_COUNT"])
        self.assertEqual("N", row["AUTO_REPLACE_YN"])

    def test_range_display_text_is_rejected_before_any_edit_dml(self):
        row = rule({"operator": "AND", "conditions": [atom("RESULT_CODE", ">", 10), atom("RESULT_CODE", "<=", 20)]})
        for value in ("(10, 20]", "NaN", None, 10, 21):
            with self.subTest(value=value), self.assertRaises(HTTPException) as raised:
                service._validate_pattern_replacement(self.cursor, row, value, COLUMNS)
            self.assertEqual(400, raised.exception.status_code)
        service._validate_pattern_replacement(self.cursor, row, 15, COLUMNS)
        self.assertTrue(service._pattern_result_accepts_value(row, "15"))
        self.assertFalse(service._pattern_result_accepts_value(row, "(10, 20]"))

    def test_result_column_cannot_leak_into_conditions_or_predict_another_column(self):
        row = rule()
        row["CONDITION_AST"] = atom("RESULT_CODE", "=", 2)
        with self.assertRaises(HTTPException) as raised:
            service._compile_pattern_rule(self.cursor, row, COLUMNS)
        self.assertEqual(409, raised.exception.status_code)
        row = rule(atom("GROUP_CODE", "=", 1))
        with self.assertRaises(HTTPException):
            service._compile_pattern_rule(self.cursor, row, COLUMNS)

    def test_legacy_rules_never_query_new_schema_columns(self):
        class NoQueries:
            def execute(self, *args):
                raise AssertionError("Legacy rules must not query v2 AST columns")
        self.assertIsNone(service._pattern_rule_metadata(NoQueries(), {"SOURCE_OBJECT_NAME": "OML_ASSOC_10"}))

    def test_metadata_read_is_fully_scoped_and_does_not_trust_display_expression(self):
        row = rule()
        row.pop("CONDITION_AST")
        row.pop("RESULT_AST")
        metadata = {"CONDITION_JSON": json.dumps(atom("GROUP_CODE", "=", 1)),
                    "RESULT_JSON": json.dumps(atom("RESULT_CODE", "=", 2)), "RESULT_KIND": "VALUE"}
        with patch.object(service, "_fetch_one", return_value=metadata) as fetch:
            service._pattern_rule_metadata(self.cursor, row)
        self.assertEqual("MCOMMON_EDIT_PATTERN_SOURCE_DETAIL", fetch.call_args.args[1])
        self.assertEqual({"runSourceType": "FLOW_WORK", "runId": 10, "sourceOwner": "OWNER", "sourceObjectName": "XAI_PATTERN_10",
                          "sourceRuleId": "RULE_1", "targetOwner": "OWNER", "targetTable": "INITUP_TEST", "targetColumn": "RESULT_CODE"}, fetch.call_args.args[2])
        self.assertEqual(2, row["RESULT_AST"]["value"])

    def test_sql_metadata_scope_resolves_only_requested_rule(self):
        self.conn.execute('CREATE TABLE "INIT$_TB_RULEDISC_ASSOC_SUM" (RUN_SOURCE_TYPE, RUN_ID, OWNER, MODEL_NAME, RULE_ID, TARGET_OWNER, TARGET_TABLE, RESULT_COLUMN, RULE_SOURCE, CONDITION_JSON, RESULT_JSON, VALIDATION_JSON, RESULT_KIND, VIOLATION_COUNT, RESULT_TEXT)')
        base = ("FLOW_WORK", 10, "OWNER", "XAI_PATTERN_10", "RULE_1", "OWNER", "INITUP_TEST", "RESULT_CODE", "MIXED_PATTERN_TREE", "{}", "{}", "{}", "VALUE", 2, "RESULT_CODE = 2")
        records = [base, (base[0], 11, *base[2:]), (*base[:6], "OTHER_TABLE", *base[7:])]
        self.conn.executemany('INSERT INTO "INIT$_TB_RULEDISC_ASSOC_SUM" VALUES (' + ','.join('?' for _ in base) + ')', records)
        self.cursor.execute(SqlLoader.get_sql("MCOMMON_EDIT_PATTERN_SOURCE_DETAIL"), {"runSourceType": "FLOW_WORK", "runId": 10, "sourceOwner": "OWNER", "sourceObjectName": "XAI_PATTERN_10", "sourceRuleId": "RULE_1", "targetOwner": "OWNER", "targetTable": "INITUP_TEST", "targetColumn": "RESULT_CODE"})
        self.assertEqual(1, len(self.cursor.fetchall()))

    def test_manual_migrations_are_additive_and_match_shared_schema(self):
        expected = {"CONDITION_JSON", "RESULT_JSON", "VALIDATION_JSON", "RESULT_KIND", "VIOLATION_COUNT"}
        for name in ("INIT_TARGET_DDL.sql", "INIT_TARGET_ALTER.sql", "INIT_TARGET_XAI.sql", "INIT_TARGET_PATTERN.sql"):
            text = (ROOT / "database" / name).read_text(encoding="utf-8")
            block = text.split("-- Mixed pattern v2:", 1)[1]
            for column in expected:
                self.assertIn("add_pattern_column('" + column + "'", block)
            self.assertNotIn("DELETE ", block)
            self.assertNotIn("DROP ", block)
            self.assertNotIn("NOT NULL", block)


if __name__ == "__main__":
    unittest.main()
