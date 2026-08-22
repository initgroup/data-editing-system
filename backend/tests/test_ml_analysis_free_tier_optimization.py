import unittest
from unittest.mock import patch

import numpy

from backend.services import ml_analysis_service


class MatrixCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def execute(self, _sql, _binds):
        self.connection.execute_count += 1
        self.rows = [(1, 2, 3), (4, 5, 6)]

    def fetchmany(self, _size):
        rows, self.rows = self.rows, []
        return rows

    def close(self):
        pass


class MatrixConnection:
    def __init__(self):
        self.execute_count = 0

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


class MlAnalysisFreeTierOptimizationTests(unittest.TestCase):
    def test_numeric_matrix_cache_reuses_exact_complete_row_set(self):
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
                "B",
                ["A", "C"],
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
        self.assertEqual(y_second.tolist(), [2.0, 5.0])
        self.assertEqual(x_second.tolist(), [[1.0, 3.0], [4.0, 6.0]])

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
