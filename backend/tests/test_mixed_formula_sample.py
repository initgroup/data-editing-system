"""Read-only chart queries execute saved predicates against an offline source."""
import json
import re
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from backend.database_helper import SqlLoader
from backend.services import mixed_formula_sample_service as service
from backend.services.anly_work_router import create_anly_work_router
from backend.tests.test_mixed_continuous_pipeline import UploadedNumericConnection
from backend.tests.test_mixed_pattern_service import stored_rule
from backend.tests.test_xai_sql_compatibility import sqlite_statement
from backend.tests.mixed_numeric_sqlite import adapt_numeric_text_sql


class GraphCursor:
    def __init__(self, connection):
        self.connection, self.cursor = connection, connection.db.cursor()
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.cursor.close()
    def __getattr__(self, name):
        return getattr(self.cursor, name)
    def execute(self, sql, params=None):
        params = params or {}
        self.connection.executions.append((sql, dict(params)))
        self.assert_binds(sql, params)
        sql = adapt_numeric_text_sql(sqlite_statement(sql)).replace('"APP_OWNER"."SOURCE_DATA"', 'SOURCE_UPLOADED')
        sql = sql.replace("WHERE ROWNUM <= :scanLimit", "LIMIT :scanLimit")
        return self.cursor.execute(sql, {key: float(value) if isinstance(value, Decimal) else value for key, value in params.items()})
    @staticmethod
    def assert_binds(sql, params):
        assert set(re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql)) == set(params)


class GraphConnection(UploadedNumericConnection):
    def __init__(self, rows):
        super().__init__(rows)
        self.executions, self.close_calls = [], 0
        self.db.executescript("""
            CREATE TABLE INIT$_TB_PROJECT (PROJECT_ID, USER_ID);
            CREATE TABLE INIT$_TB_FLOW_WORK (FLOW_ID, PROJECT_ID);
            CREATE TABLE INIT$_TB_FLOW_WORK_RUN (FLOW_RUN_ID, FLOW_ID);
            INSERT INTO INIT$_TB_PROJECT VALUES (10, 7);
            INSERT INTO INIT$_TB_FLOW_WORK VALUES (20, 10);
            INSERT INTO INIT$_TB_FLOW_WORK_RUN VALUES (41, 20);
        """)
        condition = {"column": "X", "operator": "NOT_NULL", "numericText": True}
        result = {"column": "Y", "operator": "WITHIN_TOLERANCE", "numericText": True,
                  "expression": {"operator": "ADD", "left": {"column": "X", "numericText": True}, "right": {"value": 2}},
                  "absoluteTolerance": .1, "relativeTolerance": 0}
        rule = {**stored_rule("FORMULA_1"), "RESULT_COLUMN": "Y", "RESULT_KIND": "FORMULA",
                "CONDITION_TEXT": "NUMERIC(X) IS NOT NULL", "RESULT_TEXT": "Y ≈ X + 2 ± 0.1",
                "CONDITION_JSON": json.dumps(condition), "RESULT_JSON": json.dumps(result)}
        self.insert("INIT$_TB_RULEDISC_ASSOC_SUM", rule)
        self.db.commit()
    def cursor(self):
        return GraphCursor(self)
    def close(self):
        self.close_calls += 1


class MixedFormulaSampleTests(unittest.TestCase):
    def connection(self, rows=None):
        conn = GraphConnection(rows if rows is not None else [
            ("A", "001", 1, "1", "3"), ("A", "001", 2, "1", "4"),
            ("A", "001", 3, "1", None), ("A", "001", 4, "1", "invalid"),
            ("A", "001", 5, "invalid", "3"), ("A", "001", 6, " 12 ", "14"),
            ("A", "001", 7, None, "3")])
        self.addCleanup(conn.db.close)
        return conn

    def read(self, conn, **overrides):
        return service.read_formula_sample(conn, **{"flow_run_id": 41, "owner": "APP_OWNER", "table": "SOURCE_DATA",
            "model_name": "XAI_PATTERN_41", "rule_id": "FORMULA_1", "user_id": 7, **overrides})["data"]

    def test_saved_formula_sql_includes_normal_and_violation_points_without_coercing_invalid_to_zero(self):
        conn = self.connection()
        changes = conn.db.total_changes
        data = self.read(conn)
        self.assertEqual((7, 5, 2, 3), (data["scannedCount"], data["applicableCount"], data["normalCount"], data["violationCount"]))
        self.assertEqual({"conditionFalse": 2, "nullActual": 1, "invalidActual": 1, "nonFinitePrediction": 0}, data["skipped"])
        self.assertEqual(["1", "2", "6"], [row["rowId"] for row in data["points"]])
        self.assertEqual([False, True, False], [row["violation"] for row in data["points"]])
        self.assertEqual([0, 1, 0], [row["residual"] for row in data["points"]])
        self.assertEqual((2.9, 3.1), (data["points"][1]["lower"], data["points"][1]["upper"]))
        self.assertEqual({"X": "1"}, data["points"][1]["values"])
        self.assertEqual(["X"], data["inputColumns"])
        self.assertEqual("FILE_ROW_NO", data["rowIdColumn"])
        self.assertEqual("CURRENT_SOURCE", data["source"])
        self.assertEqual(3, data["sampleCount"])
        self.assertFalse(data["hasMore"])
        self.assertEqual(changes, conn.db.total_changes)
        self.assertEqual(0, conn.commits)
        json.dumps(data, allow_nan=False)
        conn.db.execute("UPDATE SOURCE_UPLOADED SET Y='3' WHERE FILE_ROW_NO=2")
        self.assertEqual(0, self.read(conn)["shownViolationCount"])

    def test_empty_source_retains_input_metadata_and_rowid_fallback(self):
        conn = self.connection([])
        conn.db.execute("DELETE FROM ALL_TAB_COLS WHERE COLUMN_NAME='FILE_ROW_NO'")
        changes = conn.db.total_changes
        data = self.read(conn)
        self.assertEqual([], data["points"])
        self.assertEqual(["X"], data["inputColumns"])
        self.assertEqual("ROWID", data["rowIdColumn"])
        self.assertEqual(changes, conn.db.total_changes)
        self.assertEqual(0, conn.commits)

    def test_prefix_is_bounded_before_if_filter_and_balances_rare_violation(self):
        rows = [("A", "001", index, "1", "3") for index in range(1, 5000)]
        rows.extend([("A", "001", 5000, "1", "4"), ("A", "001", 5001, "1", "4")])
        conn = self.connection(rows)
        data = self.read(conn, sample_limit=2)
        self.assertEqual((5000, 4999, 1), (data["scannedCount"], data["normalCount"], data["violationCount"]))
        self.assertEqual((1, 1), (data["shownNormalCount"], data["shownViolationCount"]))
        self.assertTrue(data["scanLimitReached"])
        self.assertNotIn("5001", {point["rowId"] for point in data["points"]})
        source_sql, source_binds = conn.executions[-1]
        self.assertIn("NO_MERGE(T)", source_sql)
        self.assertIn("WHERE ROWNUM <= :scanLimit", source_sql)
        self.assertEqual(5001, source_binds["scanLimit"])

    def test_scope_and_full_rule_identity_are_required_before_source_access(self):
        for override in ({"user_id": 8}, {"flow_run_id": 42}, {"model_name": "WRONG"},
                         {"owner": "OTHER"}, {"table": "OTHER"}, {"rule_id": "OTHER"}):
            with self.subTest(override=override):
                conn = self.connection()
                with self.assertRaises(HTTPException) as error:
                    self.read(conn, **override)
                self.assertEqual(404, error.exception.status_code)
                self.assertFalse(any("NO_MERGE(T)" in sql for sql, _ in conn.executions))
        self.assertEqual(3, self.read(self.connection(), user_id=8, include_all_users=True)["sampleCount"])

    def test_missing_formula_or_stale_ast_fails_without_evaluating_source(self):
        for update in ("RESULT_KIND='VALUE'", "RESULT_JSON='{}'"):
            conn = self.connection()
            conn.db.execute("UPDATE INIT$_TB_RULEDISC_ASSOC_SUM SET " + update)
            with self.assertRaises(HTTPException) as error:
                self.read(conn)
            self.assertIn(error.exception.status_code, {400, 409})
            self.assertFalse(any("NO_MERGE(T)" in sql for sql, _ in conn.executions))

    def test_route_uses_server_identity_closes_connection_and_does_not_allow_internal_admin_bypass(self):
        router = create_anly_work_router("M04002")
        endpoint = next(route.endpoint for route in router.routes if route.path == "/mixed-formula-sample")
        kwargs = {"flowRunId": 41, "targetOwner": "APP_OWNER", "targetTable": "SOURCE_DATA",
                  "modelName": "XAI_PATTERN_41", "ruleId": "FORMULA_1", "sampleLimit": 10}
        for internal, succeeds in [(False, True), (True, False)]:
            conn = self.connection()
            request = SimpleNamespace(state=SimpleNamespace(internal_api_user_id=8 if internal else None))
            with patch.object(service, "get_target_db_connection", return_value=conn), \
                 patch.object(service, "get_request_user_id", return_value=8), \
                 patch.object(service, "get_request_role_code", return_value="ADMIN"):
                if succeeds:
                    self.assertEqual("success", endpoint(request, **kwargs)["status"])
                else:
                    with self.assertRaises(HTTPException) as denied:
                        endpoint(request, **kwargs)
                    self.assertEqual(404, denied.exception.status_code)
            self.assertEqual(1, conn.close_calls)
            self.assertEqual(0, conn.commits)
        with patch.object(service, "get_target_db_connection") as connect:
            with self.assertRaises(HTTPException):
                endpoint(SimpleNamespace(), **{**kwargs, "modelName": None})
            with self.assertRaises(HTTPException):
                endpoint(SimpleNamespace(), **{**kwargs, "targetOwner": "APP; DROP TABLE X"})
            with self.assertRaises(HTTPException):
                endpoint(SimpleNamespace(), **{**kwargs, "sampleLimit": 301})
            connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
