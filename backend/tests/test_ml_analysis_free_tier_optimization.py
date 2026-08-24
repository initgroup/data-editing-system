import unittest
from pathlib import Path
from unittest.mock import patch

import numpy
import oracledb

from backend import oracle_session
from backend.services import ml_analysis_service
from backend.services import flow_work_service


ROOT_DIR = Path(__file__).resolve().parents[2]


class MatrixCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def execute(self, sql, _binds):
        self.connection.execute_count += 1
        self.connection.last_sql = sql
        self.rows = list(self.connection.rows)

    def fetchmany(self, _size):
        rows, self.rows = self.rows, []
        return rows

    def close(self):
        pass


class MatrixConnection:
    def __init__(self, rows=None):
        self.execute_count = 0
        self.last_sql = ""
        self.rows = rows or [(1, 2, 3), (4, 5, 6)]

    def cursor(self):
        return MatrixCursor(self)


class ProcedureCursor:
    def __init__(self):
        self.call_args = None

    def callproc(self, _name, args):
        self.call_args = args

    def close(self):
        pass


class ProcedureConnection:
    def __init__(self):
        self.last_cursor = None

    def cursor(self):
        self.last_cursor = ProcedureCursor()
        return self.last_cursor


class ParallelGuardCursor:
    def __init__(self, fail_dml=False):
        self.fail_dml = fail_dml
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)
        if self.fail_dml and statement.endswith("DML"):
            raise oracledb.Error(type("OracleError", (), {"code": 12841})())


class MlAnalysisFreeTierOptimizationTests(unittest.TestCase):
    def test_rule_discovery_disables_parallel_before_clearing_run_results(self):
        connection = ProcedureConnection()
        events = []
        with patch.object(
            ml_analysis_service,
            "disable_parallel_execution",
            side_effect=lambda *_args, **_kwargs: events.append("disable_parallel"),
        ), patch.object(
            ml_analysis_service,
            "clear_integrated_analysis_scope",
            side_effect=lambda *_args, **_kwargs: events.append("clear_scope"),
        ), patch.object(
            ml_analysis_service,
            "run_integrated_apriori_assoc_model",
            side_effect=lambda *_args, **_kwargs: (
                events.append("run_apriori")
                or {
                    "status": "success",
                    "resultTable": "INIT$_TB_RULEDISC_ASSOC_SUM",
                    "modelName": "MODEL1",
                }
            ),
        ):
            result = ml_analysis_service.run_integrated_rule_discover(
                connection,
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_RUN_SOURCE_TYPE": "FLOW_WORK",
                    "P_RUN_ID": 1241,
                    "P_RULE_PARTS": "CATEGORICAL",
                },
            )

        self.assertEqual(["disable_parallel", "clear_scope", "run_apriori"], events)
        self.assertEqual("success", result["status"])

    def test_flow_session_parallel_guard_limits_only_dml(self):
        connection = ProcedureConnection()
        with patch.object(flow_work_service, "disable_parallel_execution") as disable_parallel:
            flow_work_service.prepare_flow_run_session(connection)

        disable_parallel.assert_called_once_with(
            connection.last_cursor,
            include_query=False,
            context="flow-work-run",
        )

    def test_parallel_guard_defaults_to_dml_only(self):
        cursor = ParallelGuardCursor()

        oracle_session.disable_parallel_execution(cursor)

        self.assertEqual(["ALTER SESSION DISABLE PARALLEL DML"], cursor.statements)

    def test_parallel_guard_continues_to_query_after_active_transaction_warning(self):
        cursor = ParallelGuardCursor(fail_dml=True)

        oracle_session.disable_parallel_execution(cursor, include_query=True, context="test")

        self.assertEqual(
            [
                "ALTER SESSION DISABLE PARALLEL DML",
                "ALTER SESSION DISABLE PARALLEL QUERY",
            ],
            cursor.statements,
        )

    def test_apriori_and_rule_summary_ignore_only_active_transaction_parallel_error(self):
        apriori_sql = (
            ROOT_DIR / "database" / "model_objects" / "INIT_MODEL_OBJECTS_20_RULE_MODELS.sql"
        ).read_text(encoding="utf-8")
        summary_sql = (
            ROOT_DIR / "database" / "model_objects" / "INIT_MODEL_OBJECTS_10_RULE_SUMMARY.sql"
        ).read_text(encoding="utf-8")
        apriori_section = apriori_sql.split('CREATE OR REPLACE PROCEDURE "INIT$_SP_APRIORI_ASSOC_MODEL"', 1)[1].split(
            "\n/", 1
        )[0]

        self.assertIn("PROCEDURE disable_parallel_execution IS", apriori_section)
        self.assertIn("IF SQLCODE <> -12841 THEN", apriori_section)
        self.assertIn("BEGIN\n    disable_parallel_execution;", apriori_section)
        self.assertIn("PROCEDURE disable_parallel_execution IS", summary_sql)
        self.assertIn("IF SQLCODE <> -12841 THEN", summary_sql)
        self.assertIn("BEGIN\n        disable_parallel_execution;", summary_sql)

    def test_analysis_procedures_do_not_disable_parallel_ddl(self):
        model_object_dir = ROOT_DIR / "database" / "model_objects"
        sql_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(model_object_dir.glob("INIT_MODEL_OBJECTS_*.sql"))
        )

        self.assertNotIn("ALTER SESSION DISABLE PARALLEL DDL", sql_text)

    def test_every_database_parallel_session_change_has_narrow_ora_12841_guard(self):
        for path in sorted((ROOT_DIR / "database").rglob("*.sql")):
            sql_text = path.read_text(encoding="utf-8")
            search_from = 0
            while True:
                alter_at = sql_text.find("ALTER SESSION DISABLE PARALLEL", search_from)
                if alter_at < 0:
                    break
                guard = sql_text[alter_at : alter_at + 320]
                self.assertIn("EXCEPTION", guard, path.name)
                self.assertIn("IF SQLCODE <> -12841 THEN", guard, path.name)
                search_from = alter_at + 1

    def test_backend_parallel_changes_are_centralized_and_global_policy_is_dml_only(self):
        backend_dir = ROOT_DIR / "backend"
        session_path = backend_dir / "oracle_session.py"
        for path in sorted(backend_dir.rglob("*.py")):
            if path == session_path or "tests" in path.parts:
                continue
            source = path.read_text(encoding="utf-8")
            self.assertNotIn('cursor.execute("ALTER SESSION DISABLE PARALLEL', source, path.name)

        target_source = (backend_dir / "target_database.py").read_text(encoding="utf-8")
        policy_block = target_source.split('TARGET_DB_DISABLE_PARALLEL", "Y"', 1)[1].split(
            "except Exception:", 1
        )[0]
        self.assertIn("include_query=False", policy_block)

    def test_rerun_scope_cleanup_uses_statement_level_no_parallel_hints(self):
        analysis_sql = (ROOT_DIR / "database" / "MCOM_ANLY_WORK.sql").read_text(encoding="utf-8")
        discovery_scope = analysis_sql.split("-- [ML_ANALYSIS_RULE_DISCOVERY_SCOPE_CLEAR]", 1)[1].split(
            "-- [ML_ANALYSIS_RULE_VIOLATION_SCOPE_CLEAR]", 1
        )[0]
        violation_scope = analysis_sql.split("-- [ML_ANALYSIS_RULE_VIOLATION_SCOPE_CLEAR]", 1)[1].split(
            "-- [ML_ANALYSIS_ASSOC_RULE_MODEL_FOR_RUN]", 1
        )[0]

        self.assertEqual(5, discovery_scope.count("DELETE /*+ NO_PARALLEL */"))
        self.assertEqual(2, violation_scope.count("DELETE /*+ NO_PARALLEL */"))

    def test_numeric_matrix_cache_reuses_same_target_sample_with_feature_reordering(self):
        connection = MatrixConnection()
        previous_np = ml_analysis_service.np
        ml_analysis_service.np = numpy
        ml_analysis_service._ml_execution_state.matrix_cache = {}
        ml_analysis_service._ml_execution_state.matrix_cache_bytes = 0
        try:
            x_first, y_first, _features, first_limits = ml_analysis_service.fetch_numeric_matrix(
                connection,
                "OWNER1",
                "TABLE1",
                "A",
                ["B", "C"],
                100,
            )
            y_first[0] = 999
            x_second, y_second, _features, second_limits = ml_analysis_service.fetch_numeric_matrix(
                connection,
                "OWNER1",
                "TABLE1",
                "A",
                ["C", "B"],
                100,
            )
        finally:
            ml_analysis_service.np = previous_np
            ml_analysis_service._ml_execution_state.matrix_cache = {}
            ml_analysis_service._ml_execution_state.matrix_cache_bytes = 0

        self.assertEqual(connection.execute_count, 1)
        self.assertEqual(first_limits["cacheHitYn"], "N")
        self.assertEqual(second_limits["cacheHitYn"], "Y")
        self.assertEqual(x_first.tolist(), [[2.0, 3.0], [5.0, 6.0]])
        self.assertEqual(y_second.tolist(), [1.0, 4.0])
        self.assertEqual(x_second.tolist(), [[3.0, 2.0], [6.0, 5.0]])

    def test_numeric_matrix_uses_target_rows_and_imputes_sparse_features(self):
        rows = [
            (index, None if index == 1 else index * 2, None if index == 2 else index * 3)
            for index in range(1, 11)
        ]
        connection = MatrixConnection(rows)
        previous_np = ml_analysis_service.np
        ml_analysis_service.np = numpy
        ml_analysis_service._ml_execution_state.matrix_cache = {}
        ml_analysis_service._ml_execution_state.matrix_cache_bytes = 0
        try:
            x_values, y_values, features, limits = ml_analysis_service.fetch_numeric_matrix(
                connection,
                "OWNER1",
                "TABLE1",
                "A",
                ["B", "C"],
                100,
            )
        finally:
            ml_analysis_service.np = previous_np
            ml_analysis_service._ml_execution_state.matrix_cache = {}
            ml_analysis_service._ml_execution_state.matrix_cache_bytes = 0

        self.assertEqual(features, ["B", "C"])
        self.assertEqual(y_values.tolist(), list(range(1, 11)))
        self.assertTrue(numpy.isfinite(x_values).all())
        self.assertEqual(limits["imputedCellCount"], 2)
        self.assertEqual(limits["missingValueStrategy"], "MEDIAN_BY_FEATURE")
        self.assertIn('WHERE "A" IS NOT NULL', connection.last_sql)
        self.assertNotIn('"B" IS NOT NULL', connection.last_sql)

    def test_integrated_relation_sample_is_capped_for_free_tier(self):
        connection = ProcedureConnection()
        with patch.object(ml_analysis_service, "_relation_sample_row_limit", return_value=50000), patch.object(
            ml_analysis_service,
            "count_result_rows",
            return_value=10,
        ), patch.object(
            ml_analysis_service,
            "run_relation_network_cluster",
            return_value={"clusterCount": 1},
        ):
            result = ml_analysis_service.run_integrated_relation_cluster(
                connection,
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_SAMPLE_ROWS": 100000,
                },
            )

        self.assertEqual(connection.last_cursor.call_args[4], 50000)
        self.assertEqual(result["sampleRows"]["requested"], 100000)
        self.assertEqual(result["sampleRows"]["effective"], 50000)

    def test_integrated_association_input_is_capped_for_free_tier(self):
        connection = ProcedureConnection()
        with patch.object(ml_analysis_service, "_association_input_row_limit", return_value=50000), patch.object(
            ml_analysis_service,
            "count_result_rows",
            return_value=3,
        ):
            result = ml_analysis_service.run_integrated_apriori_assoc_model(
                connection,
                {"P_MAX_INPUT_ROWS": 100000},
                "OWNER1",
                "TABLE1",
                "DATA_WORK",
                1,
            )

        self.assertEqual(connection.last_cursor.call_args[7], 50000)
        self.assertEqual(result["maxInputRows"]["effective"], 50000)


if __name__ == "__main__":
    unittest.main()
