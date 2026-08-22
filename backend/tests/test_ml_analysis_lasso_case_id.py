import unittest
from unittest.mock import patch

from backend.database_helper import SqlLoader
from backend.services import ml_analysis_service


class MlAnalysisLassoCaseIdTests(unittest.TestCase):
    def test_auto_lasso_excludes_default_and_configured_case_id_columns(self):
        seen_excludes = []

        def load_columns(_conn, _owner, _table, exclude=None):
            seen_excludes.append(set(exclude or set()))
            return []

        with patch.object(ml_analysis_service, "require_sklearn", lambda: None), patch.object(
            ml_analysis_service,
            "load_predicted_continuous_columns",
            load_columns,
        ), patch.object(
            ml_analysis_service,
            "load_auto_corr_target_columns",
            lambda *_args, **_kwargs: ["FILE_ROW_NO", "PERSON_ID"],
        ):
            result = ml_analysis_service.run_lasso_feature_select(
                object(),
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_TARGET_COLUMN": "(auto)",
                    "P_CASE_ID_COLUMN_NAME": "PERSON_ID",
                },
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["skippedYn"], "Y")
        self.assertEqual(result["skipReason"], "NO_ELIGIBLE_CONTINUOUS_TARGET")
        self.assertEqual(seen_excludes, [{"FILE_ROW_NO", "PERSON_ID"}])

    def test_manual_case_id_target_is_safely_skipped(self):
        with patch.object(ml_analysis_service, "require_sklearn", lambda: None):
            result = ml_analysis_service.run_lasso_feature_select(
                object(),
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_TARGET_COLUMN": "FILE_ROW_NO",
                },
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["skippedYn"], "Y")
        self.assertEqual(result["skipReason"], "CASE_ID_TARGET_EXCLUDED")
        self.assertEqual(result["failedCount"], 0)

    def test_manual_target_without_candidate_features_is_safely_skipped(self):
        with patch.object(ml_analysis_service, "require_sklearn", lambda: None), patch.object(
            ml_analysis_service,
            "load_predicted_continuous_columns",
            lambda *_args, **_kwargs: [],
        ), patch.object(
            ml_analysis_service,
            "load_numeric_corr_candidates",
            lambda *_args, **_kwargs: [],
        ):
            result = ml_analysis_service.run_lasso_feature_select(
                object(),
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_TARGET_COLUMN": "WORK_HOURS",
                },
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["skippedYn"], "Y")
        self.assertEqual(result["skipReason"], "NO_NUMERIC_CANDIDATE_FEATURES")
        self.assertEqual(result["candidateCount"], 0)

    def test_manual_symbolic_case_id_target_is_safely_skipped(self):
        with patch.object(ml_analysis_service, "require_sklearn", lambda: None):
            result = ml_analysis_service.run_symbolic_regression_rule(
                object(),
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_TARGET_COLUMN": "FILE_ROW_NO",
                },
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["skippedYn"], "Y")
        self.assertEqual(result["skipReason"], "CASE_ID_TARGET_EXCLUDED")

    def test_integrated_discovery_stays_successful_when_continuous_work_is_skipped(self):
        categorical = {
            "task": "CATEGORICAL_APRIORI",
            "status": "success",
            "resultTable": "INIT$_TB_RULEDISC_ASSOC_SUM",
        }
        lasso_skip = ml_analysis_service.build_lasso_skip_result(
            "NO_ELIGIBLE_CONTINUOUS_TARGET",
            "LASSO safely skipped.",
        )
        symbolic_skip = {
            "status": "success",
            "skippedYn": "Y",
            "skipReason": "NO_QUALIFIED_LASSO_TARGET",
            "targetCount": 0,
            "successCount": 0,
            "failedCount": 0,
            "featureCount": 0,
            "ruleCount": 0,
            "method": "NONE",
        }

        with patch.object(
            ml_analysis_service,
            "run_integrated_apriori_assoc_model",
            lambda *_args, **_kwargs: categorical,
        ), patch.object(
            ml_analysis_service,
            "run_lasso_feature_select",
            lambda *_args, **_kwargs: lasso_skip,
        ), patch.object(
            ml_analysis_service,
            "run_symbolic_regression_rule",
            lambda *_args, **_kwargs: symbolic_skip,
        ):
            result = ml_analysis_service.run_integrated_rule_discover(
                object(),
                {
                    "P_TARGET_OWNER": "OWNER1",
                    "P_TARGET_TABLE": "TABLE1",
                    "P_RULE_PARTS": "ALL",
                },
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["taskCount"], 3)
        self.assertEqual(result["successCount"], 1)
        self.assertEqual(result["skippedCount"], 2)
        self.assertEqual(result["failedCount"], 0)
        self.assertEqual(result["failedTasks"], [])
        self.assertNotIn("INIT$_TB_COLREL_LASSO_FEATURE", result["resultTables"])
        self.assertNotIn("INIT$_TB_RULEDISC_SYMBOLIC", result["resultTables"])

    def test_continuous_target_queries_hide_file_row_number(self):
        data_work_sql = SqlLoader.get_sql("MCOMMON_ANLY_WORK_CONTINUOUS_TARGET_COLUMNS")
        ml_sql = SqlLoader.get_sql("ML_ANALYSIS_CONTINUOUS_TARGET_COLUMNS")

        self.assertIn("COLUMN_NAME <> 'FILE_ROW_NO'", data_work_sql)
        self.assertIn("COLUMN_NAME <> 'FILE_ROW_NO'", ml_sql)

    def test_auto_type_fusion_keeps_file_row_number_rule_type(self):
        with open(
            "database/model_objects/INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql",
            encoding="utf-8",
        ) as stream:
            sql = stream.read()

        self.assertIn(
            "WHEN UPPER(TRIM(S.\"COLUMN_NAME\")) = ''FILE_ROW_NO'' THEN S.\"BASE_PREDICTED_TYPE\"",
            sql,
        )


if __name__ == "__main__":
    unittest.main()
