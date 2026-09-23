"""Numeric-text inference, generated SQL evaluation and edit policy agree."""
from decimal import Decimal
import json
import sqlite3
import unittest

from fastapi import HTTPException
from backend.services import mixed_formula as formula
from backend.services import mixed_numeric as numeric
from backend.services import mixed_pattern_service as patterns
from backend.services import mixed_xai_service as xai
from backend.services import edit_work_service as editing
from backend.tests.mixed_numeric_sqlite import adapt_numeric_text_sql, install_numeric_text_functions
from backend.tests.test_xai_sql_compatibility import sqlite_statement


COLUMNS = [{"COLUMN_NAME": name, "DATA_TYPE": "VARCHAR2"} for name in ("X", "Y")]
RESULT = {"operator": "WITHIN_TOLERANCE", "column": "Y", "numericText": True,
          "expression": {"operator": "ADD", "left": {"column": "X", "numericText": True}, "right": {"value": 2}},
          "absoluteTolerance": .01, "relativeTolerance": 0}


class MixedNumericTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("CREATE TABLE SOURCE (X TEXT, Y TEXT)")
        install_numeric_text_functions(self.db)

    def test_parser_and_generated_sql_agree_on_decimal_scientific_invalid_and_bounds(self):
        values = [None, "", " ", " 12.5 ", "+12", "-2", ".5", "-.5", "1.", "1.e2", "+.5E+2",
                  "0", "-0.0e999", "1e-125", "1e124", "1e-126", "1e125", "1e999", "1,234", "1,2",
                  "01", "001.2", "NaN", "Infinity", "abc", "3x", "１.５", "1\n", "\t1", "9" * 39]
        self.db.executemany("INSERT INTO SOURCE(X) VALUES (?)", [(value,) for value in values])
        expression = adapt_numeric_text_sql(numeric.numeric_text_sql('T."X"'))
        outputs = [row[0] for row in self.db.execute(f"SELECT {expression} FROM SOURCE T")]
        for value, output in zip(values, outputs):
            with self.subTest(value=value):
                expected = numeric.parse_numeric_text(value)
                self.assertEqual(expected, output)
        self.assertEqual(Decimal("12345678901234567890123456789012345678"),
                         numeric.parse_numeric_decimal("12345678901234567890123456789012345678"))

    def test_inference_uses_only_given_cohort_and_preserves_codes(self):
        values = [str(value) for value in range(30)]
        self.assertTrue(numeric.inspect_numeric_text(values)["eligible"])
        self.assertEqual("LEADING_ZERO_CODE", numeric.inspect_numeric_text(values + ["01"])["reason"])
        self.assertEqual("NON_NUMERIC_TEXT", numeric.inspect_numeric_text(values + ["invalid"])["reason"])
        self.assertEqual("INSUFFICIENT_NUMERIC_TEXT", numeric.inspect_numeric_text(["1", "2"])["reason"])

    def test_invalid_predictor_excluded_but_invalid_result_is_a_violation(self):
        rows = [("1", "3"), ("1e1", "12"), (".5", "2.5"), ("+2", "4"),
                ("1", "4"), ("1", None), ("1", "bad"), ("1", "03"),
                ("bad", "99"), (None, "99"), ("01", "99"), ("1,2", "99")]
        self.db.executemany("INSERT INTO SOURCE VALUES (?,?)", rows)
        stored = {"CONDITION_JSON": {"column": "X", "operator": "NOT_NULL", "numericText": True},
                  "RESULT_JSON": RESULT, "RESULT_COLUMN": "Y"}
        _, _, violation, binds = patterns.compile_violation(stored, COLUMNS)
        evaluated = self.db.execute("SELECT X,Y FROM SOURCE T WHERE " + adapt_numeric_text_sql(violation),
                                   {key: float(value) if isinstance(value, Decimal) else value for key, value in binds.items()}).fetchall()
        self.assertEqual(rows[4:8], evaluated)
        self.assertIsNone(formula.evaluate_expression(RESULT["expression"], {"X": "01"}))
        self.assertEqual(Decimal("2.5"), formula.evaluate_expression(RESULT["expression"], {"X": ".5"}))
        rule = {"RESULT_AST": RESULT, "RESULT_COLUMN": "Y"}
        for value, expected in [("3", True), ("3.005", True), ("3.1", False), ("03", False), ("bad", False), (None, False)]:
            self.assertEqual(expected, editing._pattern_result_accepts_value(rule, value, expected_value=3))

    def test_annotations_are_explicit_and_identifier_validation_still_applies(self):
        for expression in ({"column": "X"}, {"column": "X", "numericText": "true"},
                           {"column": 'X";DROP TABLE SOURCE', "numericText": True}):
            with self.subTest(expression=expression), self.assertRaises(HTTPException):
                formula.compile_expression(expression, COLUMNS)
        with self.assertRaises(HTTPException):
            xai.compile_predicate({"column": "X", "operator": "NOT_NULL", "numericText": True},
                                  [{"COLUMN_NAME": "X", "DATA_TYPE": "NUMBER"}])
        sql, binds = xai.compile_predicate({"column": "X", "operator": "!=", "value": 0, "numericText": True}, COLUMNS)
        self.assertIn("JSON_VALUE", sql)
        self.assertEqual([0], list(binds.values()))
        with self.assertRaises(ValueError):
            numeric.numeric_text_sql('T."X" OR 1=1')

    def test_final_edit_live_preview_preserves_invalid_actual_without_implicit_arithmetic(self):
        self.db.executemany("INSERT INTO SOURCE VALUES (?,?)", [("1", "3"), ("1", "4"), ("1", "bad"), ("bad", "4")])
        self.db.create_function("TO_CHAR", 1, lambda value: str(value) if value is not None else None)
        self.db.create_function("ROWIDTOCHAR", 1, str)
        self.db.create_function("ORA_HASH", 2, lambda value, _limit: int(value))
        rule = {"EDIT_RULE_ID": 1, "SOURCE_RULE_TYPE": "ASSOCIATION", "USER_RULE_YN": "N",
                "SOURCE_RULE_ID": "MIXED_FORMULA_TEXT", "RULE_SOURCE": "MIXED_PATTERN_TREE",
                "TARGET_OWNER": "OWNER", "TARGET_TABLE": "SOURCE", "TARGET_COLUMN": "Y",
                "RESULT_KIND": "FORMULA", "RESULT_AST": RESULT,
                "CONDITION_AST": {"column": "X", "operator": "NOT_NULL", "numericText": True}}
        sql, binds = editing._build_live_rule_violation_sql(None, rule, None,
            table_columns_override={column["COLUMN_NAME"]: column for column in COLUMNS})
        adapted = adapt_numeric_text_sql(sqlite_statement(sql)).replace('"OWNER"."SOURCE"', 'SOURCE')
        cursor = self.db.execute(adapted, {key: float(value) if isinstance(value, Decimal) else value for key, value in binds.items()})
        rows = [dict(zip([column[0] for column in cursor.description], row)) for row in cursor.fetchall()]
        self.assertEqual(["4", "bad"], [row["ACTUAL_VALUE"] for row in rows])
        self.assertEqual([1, None], [row["ABS_ERROR"] for row in rows])

    def test_final_analysis_does_not_treat_invalid_numeric_text_as_zero_error(self):
        rule = {"EDIT_RULE_ID": 1, "SOURCE_RULE_TYPE": "ASSOCIATION", "RESULT_KIND": "FORMULA",
                "RESULT_AST": RESULT, "TARGET_COLUMN": "Y"}
        def analyze(changes):
            return editing._build_edit_analysis(session={"SOURCE_ROW_COUNT": 10}, summary={}, rules=[rule],
                changes=[{"EDIT_RULE_ID": 1, "EDIT_CHANGE_ID": index, "CHANGE_STATUS": "APPLIED",
                          "OLD_VALUE": before, "NEW_VALUE": after, "EXPECTED_VALUE": "3"}
                         for index, (before, after) in enumerate(changes, start=1)],
                source_evaluation=[], edit_evaluation=[], evaluation_error=None)
        unavailable = analyze([("03", "3"), ("bad", "3"), (None, "3"), ("3", "03")])
        self.assertEqual(4, unavailable["CONTINUOUS"]["NON_NUMERIC_COUNT"])
        self.assertEqual(0, unavailable["CONTINUOUS"]["EVALUATED_COUNT"])
        self.assertIsNone(unavailable["CONTINUOUS"]["BEFORE_MAE"])
        self.assertIsNone(unavailable["CONTINUOUS"]["AFTER_MAE"])
        self.assertEqual(3, unavailable["OVERALL"]["EXPECTED_MATCH_COUNT"])
        valid = analyze([("3.1", "3")])
        self.assertEqual(0, valid["CONTINUOUS"]["NON_NUMERIC_COUNT"])
        self.assertEqual(1, valid["CONTINUOUS"]["EVALUATED_COUNT"])
        self.assertAlmostEqual(.1, valid["CONTINUOUS"]["BEFORE_MAE"])
        self.assertEqual(0, valid["CONTINUOUS"]["AFTER_MAE"])


if __name__ == "__main__":
    unittest.main()
