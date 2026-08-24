from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.routers import M90003


ROOT_DIR = Path(__file__).resolve().parents[2]


class QuickEditColumnTypeLearningTests(unittest.TestCase):
    def test_quick_edit_reuses_m03001_final_query_and_save_endpoints(self):
        api_client = (ROOT_DIR / "quick-edit" / "js" / "api-client.js").read_text(encoding="utf-8")
        quick_edit = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        page = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")

        self.assertIn('request("/M03001/data/editable"', api_client)
        self.assertIn('request("/M03001/data/update"', api_client)
        self.assertIn('tableName: "INIT$_TB_COLTYPE_FINAL"', api_client)
        self.assertIn('columnName: "FINAL_PREDICTED_TYPE"', quick_edit)
        self.assertIn('columnName: "CONFIRMED_YN"', quick_edit)
        self.assertIn('id="qeColumnTypeSummary"', page)
        self.assertIn('id="qeColumnTypeSaveButton"', page)
        self.assertIn('id="qeColumnTypeTrainingButton"', page)
        self.assertIn("const displayLabel = columnLabel ? `${columnName} · ${columnLabel}` : columnName;", quick_edit)
        editor_markup = page.split('id="qeColumnTypeEditor"', 1)[1].split('id="qeColumnTypeNotice"', 1)[0]
        self.assertLess(editor_markup.index('id="qeColumnTypeEditorToggle"'), editor_markup.index('id="qeColumnTypeSaveButton"'))
        self.assertLess(editor_markup.index('id="qeColumnTypeSaveButton"'), editor_markup.index('id="qeColumnTypeEditorPanel"'))
        self.assertNotIn("<details", editor_markup)

    def test_quick_edit_column_labels_are_the_primary_editor_text(self):
        quick_edit = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        styles = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")
        editor_rows = quick_edit.split('class="qe-column-type-row', 1)[1].split(
            "table.innerHTML = rows.map", 1
        )[0]

        self.assertIn("qe-column-type-column__label", editor_rows)
        self.assertIn('columnLabel || "컬럼 라벨 없음"', editor_rows)
        self.assertIn("qe-column-type-column__id", editor_rows)
        self.assertLess(editor_rows.index("qe-column-type-column__label"), editor_rows.index("qe-column-type-column__id"))
        self.assertIn("grid-template-columns: minmax(280px, 1.65fr)", styles)
        self.assertIn(".qe-column-type-column strong {", styles)
        self.assertIn("font-size: 14px;", styles)
        self.assertIn("overflow-wrap: anywhere;", styles)

    def test_quick_edit_model_training_opens_user_confirmed_dataset(self):
        quick_edit = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        model_page = (ROOT_DIR / "frontend" / "js" / "M90003.js").read_text(encoding="utf-8")

        self.assertIn('const MODEL_TRAINING_NAVIGATION_KEY = "init.m90003.navigation.v1";', quick_edit)
        self.assertIn('tab: "dataset"', quick_edit)
        self.assertIn('labelSource: "USER_CONFIRMED"', quick_edit)
        self.assertIn('PageManager.load("M90003", "모델 학습 관리", true)', quick_edit)
        self.assertIn('const NAVIGATION_STORAGE_KEY = "init.m90003.navigation.v1";', model_page)
        self.assertIn("async applyNavigationIntent(intent = {})", model_page)
        self.assertIn('sourceSelect.value = source;', model_page)
        self.assertIn('await this.openTab("dataset")', model_page)

    def test_historical_quick_run_recovers_column_type_target_from_m03001_node(self):
        quick_edit = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        load_results = quick_edit.split("async function loadResultsData()", 1)[1].split(
            "\n    function getResultColumnComments", 1
        )[0]

        self.assertIn("function resolveColumnTypeTarget", quick_edit)
        self.assertIn("node?.TARGET_OWNER", quick_edit)
        self.assertIn("node?.TARGET_TABLE", quick_edit)
        self.assertIn("const columnTypeTarget = resolveColumnTypeTarget(nodes, artifacts, statisticsNode);", load_results)
        self.assertLess(
            load_results.index("const columnTypeTarget = resolveColumnTypeTarget"),
            load_results.index("client.getColumnTypeFinal"),
        )

    def test_m03001_confirmation_stays_the_single_learning_write_path(self):
        confirm_sql = SqlLoader.get_sql("DATA_WORK_COLUMN_TYPE_CONFIRM")

        self.assertIn("INIT$_SP_COLUMN_TYPE_CONFIRM", confirm_sql)
        self.assertIn("p_label_source    => 'USER_CONFIRMED'", confirm_sql)

    def test_m90003_dataset_can_distinguish_initial_and_user_sources(self):
        label_sql = SqlLoader.get_sql("M90003_LABEL_LIST")
        summary_sql = SqlLoader.get_sql("M90003_SUMMARY")
        distribution_sql = SqlLoader.get_sql("M90003_DATASET_DETAIL_DISTRIBUTION")
        page = (ROOT_DIR / "frontend" / "pages" / "M90003.html").read_text(encoding="utf-8")

        self.assertIn(":labelSource = 'ALL'", label_sql)
        self.assertIn("L.LABEL_SOURCE = :labelSource", label_sql)
        self.assertIn("IMPORTED_GOLD_COUNT", summary_sql)
        self.assertIn("USER_CONFIRMED_COUNT", summary_sql)
        self.assertIn("P.PROFILE_ID = L.SOURCE_PROFILE_ID", label_sql)
        self.assertIn("F.PROFILE_ID = L.SOURCE_PROFILE_ID", summary_sql)
        self.assertIn("F.PROFILE_ID = L.SOURCE_PROFILE_ID", distribution_sql)
        self.assertIn("P.RUN_SOURCE_TYPE = F.RUN_SOURCE_TYPE", summary_sql)
        self.assertIn("R.RUN_SOURCE_TYPE = P.RUN_SOURCE_TYPE", label_sql)
        self.assertIn('id="datasetSource-M90003"', page)

    def test_m90003_readiness_uses_the_same_normalized_x_dedup_population_as_training(self):
        summary_sql = SqlLoader.get_sql("M90003_SUMMARY")
        group_sql = SqlLoader.get_sql("M90003_DATASET_GROUP_DISTRIBUTION")
        detail_sql = SqlLoader.get_sql("M90003_DATASET_DETAIL_DISTRIBUTION")

        for sql in (summary_sql, group_sql, detail_sql):
            self.assertIn("SIGNED_ELIGIBLE", sql)
            self.assertIn("DEDUP_ELIGIBLE", sql)
            self.assertIn("STANDARD_HASH", sql)
            self.assertIn("CHR(31)", sql)
            self.assertIn("NLS_NUMERIC_CHARACTERS=.,", sql)
            self.assertIn("F.PROFILE_ID = L.SOURCE_PROFILE_ID", sql)
            for feature in (
                "DATA_TYPE",
                "TOTAL_ROWS",
                "NON_NULL_ROWS",
                "SAMPLE_ROWS",
                "SAMPLE_NOT_NULL_ROWS",
                "NUM_DISTINCT",
                "SAMPLE_DISTINCT",
                "DIST_VAL_RT",
                "NULL_RATIO",
                "LOG_DATA_TYPE",
                "ENTROPY",
                "NORM_ENTROPY",
                "NUMERIC_RATIO",
                "INTEGER_RATIO",
                "MIN_NUM_VALUE",
                "MAX_NUM_VALUE",
                "AVG_TEXT_LENGTH",
                "MAX_TEXT_LENGTH",
            ):
                self.assertIn(feature, sql)

        self.assertIn("RAW_CONFIRMED_ELIGIBLE_COUNT", summary_sql)
        self.assertIn("T.CONFIRMED_ELIGIBLE_COUNT", summary_sql)
        self.assertIn("T.DUPLICATE_COUNT", summary_sql)
        self.assertIn("FROM DEDUP_ELIGIBLE E", group_sql)
        self.assertIn("FROM DEDUP_ELIGIBLE E", detail_sql)
        self.assertIn("INIT$_FN_TYPE_GROUP_CODE(E.TYPE_CODE)", group_sql)

    def test_additional_training_is_gated_but_rebuilds_the_full_corpus(self):
        additional_sql = SqlLoader.get_sql("M90003_ADDITIONAL_LABEL_INFO")
        model_sql = (
            ROOT_DIR / "database" / "model_objects" / "INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql"
        ).read_text(encoding="utf-8")
        page = (ROOT_DIR / "frontend" / "pages" / "M90003.html").read_text(encoding="utf-8")

        self.assertEqual({"FULL", "ADDITIONAL"}, M90003.ALLOWED_TRAINING_SCOPES)
        self.assertIn("L.LABEL_SOURCE = 'USER_CONFIRMED'", additional_sql)
        self.assertIn("L.UPDATED_AT > S.LAST_SUCCESSFUL_TRAINED_AT", additional_sql)
        self.assertIn("L.\"LABEL_SOURCE\" IN (''USER_CONFIRMED'', ''IMPORTED_GOLD'')", model_sql)
        self.assertIn('id="trainScope-M90003"', page)
        self.assertIn('value="ADDITIONAL"', page)

    def test_additional_training_rejects_when_no_new_user_label_exists(self):
        conn = Mock()
        request = Mock()
        req = M90003.TrainingStartRequest(trainingScope="ADDITIONAL")

        with (
            patch.object(M90003, "get_request_user_id", return_value=7),
            patch.object(M90003, "get_target_connection_id", return_value=3),
            patch.object(M90003, "get_target_db_connection", return_value=conn),
            patch.object(
                M90003,
                "_query",
                side_effect=[
                    {"data": [{"ACTIVE_RUN_COUNT": 0}]},
                    {"data": [{"ADDITIONAL_USER_COUNT": 0}]},
                ],
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                M90003.start_training(req, request)

        self.assertEqual(400, raised.exception.status_code)
        conn.cursor.assert_not_called()
        conn.close.assert_called_once()

    def test_additional_training_records_scope_and_queues_full_corpus_rebuild(self):
        conn = Mock()
        cursor = Mock()
        run_id_var = Mock()
        run_id_var.getvalue.return_value = 101
        cursor.var.return_value = run_id_var
        conn.cursor.return_value = cursor
        request = Mock()
        req = M90003.TrainingStartRequest(trainingScope="ADDITIONAL")

        with (
            patch.object(M90003, "get_request_user_id", return_value=7),
            patch.object(M90003, "get_target_connection_id", return_value=3),
            patch.object(M90003, "get_target_db_connection", return_value=conn),
            patch.object(
                M90003,
                "_query",
                side_effect=[
                    {"data": [{"ACTIVE_RUN_COUNT": 0}]},
                    {
                        "data": [{
                            "ADDITIONAL_USER_COUNT": 4,
                            "LAST_SUCCESSFUL_TRAINED_AT": "2026-08-20T10:00:00",
                        }]
                    },
                ],
            ),
            patch.object(M90003, "submit_background_job") as submit_job,
        ):
            response = M90003.start_training(req, request)

        params = cursor.execute.call_args.args[1]
        self.assertEqual("IMPORTED_GOLD,USER_CONFIRMED|MODE=ADDITIONAL", params["trainSourceFilter"])
        self.assertIn('"trainingScope":"ADDITIONAL"', params["configJson"])
        self.assertIn('"corpusPolicy":"FULL_CONFIRMED_REBUILD"', params["configJson"])
        self.assertIn('"casePolicy":"CONFIRMED_PROFILE_SNAPSHOT"', params["configJson"])
        self.assertIn('"dedupPolicy":"NORMALIZED_X_SIGNATURE"', params["configJson"])
        self.assertIn(
            '"splitPolicy":"DETAILED_TYPE_STRATIFIED_DETERMINISTIC_HASH_V1"',
            params["configJson"],
        )
        self.assertEqual(4, response["data"]["additionalUserCount"])
        submit_job.assert_called_once()

    def test_training_split_uses_normalized_profile_features_not_physical_objects(self):
        model_sql = (
            ROOT_DIR / "database" / "model_objects" / "INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql"
        ).read_text(encoding="utf-8")
        signature_function = model_sql.split("FUNCTION feature_signature_expr", 1)[1].split(
            "    /*\n       CREATE_MODEL2", 1
        )[0]
        profile_population = model_sql.split("v_raw_profile_query :=", 1)[1].split(
            "    EXECUTE IMMEDIATE", 1
        )[0]
        split_section = model_sql.split("v_split_query :=", 1)[1].split(
            "    v_model_data_query :=", 1
        )[0]

        self.assertIn("STANDARD_HASH", signature_function)
        self.assertIn("'SHA256'", signature_function)
        self.assertIn("CHR(31)", signature_function)
        self.assertIn("NLS_NUMERIC_CHARACTERS=.,", signature_function)
        for feature in (
            "DATA_TYPE",
            "TOTAL_ROWS",
            "NON_NULL_ROWS",
            "SAMPLE_ROWS",
            "SAMPLE_NOT_NULL_ROWS",
            "NUM_DISTINCT",
            "SAMPLE_DISTINCT",
            "DIST_VAL_RT",
            "NULL_RATIO",
            "LOG_DATA_TYPE",
            "ENTROPY",
            "NORM_ENTROPY",
            "NUMERIC_RATIO",
            "INTEGER_RATIO",
            "MIN_NUM_VALUE",
            "MAX_NUM_VALUE",
            "AVG_TEXT_LENGTH",
            "MAX_TEXT_LENGTH",
        ):
            self.assertIn(f'"{feature}"', signature_function)
        for physical_or_target in ("OWNER", "TABLE_NAME", "COLUMN_NAME", "COLUMN_DESC", "TARGET_TYPE_CODE"):
            self.assertNotIn(f'"{physical_or_target}"', signature_function)

        self.assertIn('P."PROFILE_ID" = L."SOURCE_PROFILE_ID"', profile_population)
        self.assertNotIn('NVL(\n                        L."SOURCE_PROFILE_ID"', profile_population)
        self.assertNotIn('AS "SOURCE_OWNER"', profile_population)
        self.assertNotIn('AS "SOURCE_TABLE"', profile_population)
        self.assertIn('SELECT DISTINCT ', profile_population)

        self.assertIn('PARTITION BY E."TARGET_TYPE_CODE"', split_section)
        self.assertIn('ORA_HASH(E."FEATURE_SIGNATURE"', split_section)
        self.assertIn('S."SPLIT_CLASS_ROWS" - 2', split_section)
        self.assertIn('GREATEST(1, ROUND(S."SPLIT_CLASS_ROWS"', split_section)
        self.assertNotIn('SOURCE_OWNER', split_section)
        self.assertNotIn('SOURCE_TABLE', split_section)
        self.assertNotIn('GROUP_RN', split_section)

    def test_training_deduplicates_equal_x_and_protects_sparse_classes(self):
        model_sql = (
            ROOT_DIR / "database" / "model_objects" / "INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql"
        ).read_text(encoding="utf-8")
        alter_sql = (ROOT_DIR / "database" / "INIT_TARGET_ALTER.sql").read_text(encoding="utf-8")

        self.assertIn('HAVING COUNT(DISTINCT E."TARGET_TYPE_CODE") > 1', model_sql)
        self.assertIn("Identical normalized column profiles have conflicting confirmed type labels", model_sql)
        self.assertIn('CASE WHEN R."CAP_CLASS_RN" <= 3 THEN 0 ELSE 1 END', model_sql)
        self.assertIn("at least three unique confirmed column profiles", model_sql)
        self.assertIn('v_holdout_class_count <> v_population_class_count', model_sql)
        self.assertNotIn("Grouped holdout", model_sql)
        self.assertNotIn(
            "P.\"OWNER\" || ''|'' || P.\"TABLE_NAME\"",
            model_sql.split("v_raw_profile_query :=", 1)[1].split("v_model_data_query :=", 1)[0],
        )
        self.assertIn("WHERE L.SOURCE_PROFILE_ID IS NULL", alter_sql)
        self.assertIn("P.RUN_SOURCE_TYPE = L.SOURCE_RUN_SOURCE_TYPE", alter_sql)
        self.assertIn("T.SOURCE_PROFILE_ID = S.PROFILE_ID", alter_sql)

    def test_code_suffix_column_label_is_a_categorical_base_rule(self):
        model_sql = (
            ROOT_DIR / "database" / "model_objects" / "INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql"
        ).read_text(encoding="utf-8")
        base_type = model_sql.split('CREATE OR REPLACE FUNCTION "INIT$_FN_PREDICT_BASE_TYPE"', 1)[1].split(
            'CREATE OR REPLACE FUNCTION "INIT$_FN_PREDICT_BASE_REASON"', 1
        )[0]
        base_reason = model_sql.split('CREATE OR REPLACE FUNCTION "INIT$_FN_PREDICT_BASE_REASON"', 1)[1].split(
            'CREATE OR REPLACE PROCEDURE "INIT$_SP_COLUMN_TYPE_CONFIRM"', 1
        )[0]
        final_both = model_sql.split("ELSIF v_method = 'FINAL_BOTH' THEN", 1)[1].split(
            "    END IF;", 1
        )[0]

        self.assertIn("p_column_label     IN VARCHAR2 DEFAULT NULL", base_type)
        self.assertIn("v_column_label := NULLIF(TRIM(p_column_label), '');", base_type)
        self.assertIn("REGEXP_LIKE(v_column_label, '코드$')", base_type)
        self.assertIn("RETURN '숫자형범주형';", base_type)
        self.assertIn("RETURN '문자형범주형';", base_type)
        self.assertIn("REGEXP_LIKE(v_column_label, '코드$')", base_reason)
        self.assertIn("[라벨기반 RULE] 컬럼 라벨이 코드로 끝나 범주형으로 판단", base_reason)
        self.assertGreaterEqual(model_sql.count("P.COLUMN_DESC"), 3)

        code_rule = "REGEXP_LIKE(TRIM(S.\"COLUMN_DESC\"), ''코드$'')"
        model_confidence = 'WHEN NVL(S."MODEL_CONFIDENCE", 0)'
        self.assertIn(code_rule, final_both)
        self.assertLess(final_both.index(code_rule), final_both.index(model_confidence))


if __name__ == "__main__":
    unittest.main()
