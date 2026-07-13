CREATE OR REPLACE PROCEDURE "INIT$_SP_APRIORI_ASSOC_MODEL" (
    p_model_name          IN VARCHAR2,
    p_data_query          IN VARCHAR2,
    p_case_id_column_name IN VARCHAR2,
    p_min_support         IN NUMBER   DEFAULT 0.2,
    p_min_confidence      IN NUMBER   DEFAULT 0.7,
    p_max_rule_length     IN NUMBER   DEFAULT 3,
    p_drop_existing_yn    IN VARCHAR2 DEFAULT 'Y',
    p_max_input_rows      IN NUMBER   DEFAULT 100000,
    p_candidate_columns   IN VARCHAR2 DEFAULT NULL,
    p_min_rule_support_count IN NUMBER DEFAULT 30,
    p_min_rule_lift       IN NUMBER   DEFAULT 1,
    p_max_rule_summary_columns IN NUMBER DEFAULT 50,
    p_max_rule_summary_per_pair IN NUMBER DEFAULT 50,
    p_target_owner        IN VARCHAR2 DEFAULT NULL,
    p_target_table        IN VARCHAR2 DEFAULT NULL,
    p_run_source_type     IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id              IN NUMBER   DEFAULT 0
) AUTHID CURRENT_USER IS
    TYPE t_column_list IS TABLE OF VARCHAR2(128);

    v_setlist       DBMS_DATA_MINING.SETTING_LIST;
    v_model_name    VARCHAR2(128);
    v_case_id_col   VARCHAR2(128);
    v_model_count   NUMBER;
    v_drop_existing VARCHAR2(1);
    v_min_support NUMBER;
    v_min_confidence NUMBER;
    v_max_rule_length NUMBER;
    v_max_input_rows NUMBER;
    v_base_query VARCHAR2(32767);
    v_data_query VARCHAR2(32767);
    v_target_owner VARCHAR2(128);
    v_target_table VARCHAR2(128);
    v_apriori_candidate_columns VARCHAR2(4000);
    v_apriori_input_column_count NUMBER := 0;
    v_rule_view_name VARCHAR2(261);
    v_rule_view_count NUMBER;
    v_rule_id_col VARCHAR2(128);
    v_antecedent_col VARCHAR2(128);
    v_consequent_col VARCHAR2(128);
    v_support_col VARCHAR2(128);
    v_confidence_col VARCHAR2(128);
    v_lift_col VARCHAR2(128);
    v_rule_id_expr VARCHAR2(1000);
    v_antecedent_expr VARCHAR2(1000);
    v_consequent_expr VARCHAR2(1000);
    v_support_expr VARCHAR2(1000);
    v_confidence_expr VARCHAR2(1000);
    v_lift_expr VARCHAR2(1000);
    v_conditional_loaded BOOLEAN := FALSE;
    v_conditional_rule_count NUMBER := 0;
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_label IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128);
    BEGIN
        v_value := UPPER(TRIM(BOTH '"' FROM TRIM(p_value)));
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20206, 'Invalid ' || p_label || ' parameter: ' || SUBSTR(NVL(p_value, '(null)'), 1, 200));
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;

    FUNCTION contains_column(p_cols IN t_column_list, p_col IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        FOR i IN 1 .. p_cols.COUNT LOOP
            IF p_cols(i) = p_col THEN
                RETURN TRUE;
            END IF;
        END LOOP;
        RETURN FALSE;
    END;

    FUNCTION describe_data_query_columns(p_query IN VARCHAR2) RETURN t_column_list IS
        v_cursor INTEGER;
        v_col_count INTEGER;
        v_desc DBMS_SQL.DESC_TAB2;
        v_cols t_column_list := t_column_list();
        v_col VARCHAR2(128);
    BEGIN
        v_cursor := DBMS_SQL.OPEN_CURSOR;
        DBMS_SQL.PARSE(v_cursor, 'SELECT * FROM (' || p_query || ') WHERE 1 = 0', DBMS_SQL.NATIVE);
        DBMS_SQL.DESCRIBE_COLUMNS2(v_cursor, v_col_count, v_desc);

        FOR i IN 1 .. v_col_count LOOP
            v_col := UPPER(TRIM(v_desc(i).col_name));
            IF REGEXP_LIKE(v_col, '^[A-Z][A-Z0-9_$#]{0,127}$')
               AND NOT contains_column(v_cols, v_col) THEN
                v_cols.EXTEND;
                v_cols(v_cols.COUNT) := v_col;
            END IF;
        END LOOP;

        DBMS_SQL.CLOSE_CURSOR(v_cursor);
        RETURN v_cols;
    EXCEPTION
        WHEN OTHERS THEN
            IF v_cursor IS NOT NULL AND DBMS_SQL.IS_OPEN(v_cursor) THEN
                DBMS_SQL.CLOSE_CURSOR(v_cursor);
            END IF;
            RAISE_APPLICATION_ERROR(-20207, 'Failed to describe Apriori data query columns: ' || SQLERRM);
    END;

    FUNCTION apriori_candidate_columns(
        p_available_cols IN t_column_list
    ) RETURN t_column_list IS
        v_cols t_column_list := t_column_list();
        v_col VARCHAR2(128);
    BEGIN
        FOR col_rec IN (
            WITH CORR_COLS AS (
                SELECT "COL_A" AS COLUMN_NAME
                  FROM "INIT$_TB_CAT_CORR_PAIR"
                 WHERE "OWNER" = v_target_owner
                   AND "TABLE_NAME" = v_target_table
                   AND "RUN_SOURCE_TYPE" = v_run_source_type
                   AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
                   AND "PASS_YN" = 'Y'
                UNION
                SELECT "COL_B" AS COLUMN_NAME
                  FROM "INIT$_TB_CAT_CORR_PAIR"
                 WHERE "OWNER" = v_target_owner
                   AND "TABLE_NAME" = v_target_table
                   AND "RUN_SOURCE_TYPE" = v_run_source_type
                   AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
                   AND "PASS_YN" = 'Y'
            ),
            CATEGORICAL_COLS AS (
                SELECT P."COLUMN_NAME"
                     , MIN(NVL(P."COLUMN_ID", 999999)) AS COLUMN_ID
                  FROM "INIT$_TB_PREDICTED_TYPE" P
                  LEFT JOIN "INIT$_TB_PREDICTED_TYPE_FINAL" F
                    ON F."OWNER" = P."OWNER"
                   AND F."TABLE_NAME" = P."TABLE_NAME"
                   AND F."COLUMN_NAME" = P."COLUMN_NAME"
                 WHERE P."OWNER" = v_target_owner
                   AND P."TABLE_NAME" = v_target_table
                   AND P."RUN_SOURCE_TYPE" = v_run_source_type
                   AND (v_run_source_type = 'DATA_WORK' OR P."RUN_ID" = v_run_id)
                   AND COALESCE(TRIM(F."FINAL_PREDICTED_TYPE"), TRIM(P."FINAL_PREDICTED_TYPE"), TRIM(P."MODL_PREDICTED_TYPE"), TRIM(P."BASE_PREDICTED_TYPE")) LIKE '%범주형'
                 GROUP BY P."COLUMN_NAME"
            )
            SELECT C."COLUMN_NAME"
              FROM CATEGORICAL_COLS C
              JOIN CORR_COLS R
                ON R.COLUMN_NAME = C."COLUMN_NAME"
             WHERE C."COLUMN_NAME" IS NOT NULL
             ORDER BY C.COLUMN_ID, C."COLUMN_NAME"
        ) LOOP
            v_col := UPPER(TRIM(col_rec.COLUMN_NAME));
            IF REGEXP_LIKE(v_col, '^[A-Z][A-Z0-9_$#]{0,127}$')
               AND v_col <> v_case_id_col
               AND contains_column(p_available_cols, v_col)
               AND NOT contains_column(v_cols, v_col) THEN
                v_cols.EXTEND;
                v_cols(v_cols.COUNT) := v_col;
            END IF;
        END LOOP;

        IF v_cols.COUNT = 0 THEN
            DBMS_OUTPUT.PUT_LINE('[WARN] No PASS_YN=Y categorical correlation columns found. Falling back to categorical predicted columns only.');
            FOR col_rec IN (
                SELECT "COLUMN_NAME"
                  FROM (
                    SELECT P."COLUMN_NAME"
                         , MIN(NVL(P."COLUMN_ID", 999999)) AS COLUMN_ID
                      FROM "INIT$_TB_PREDICTED_TYPE" P
                      LEFT JOIN "INIT$_TB_PREDICTED_TYPE_FINAL" F
                        ON F."OWNER" = P."OWNER"
                       AND F."TABLE_NAME" = P."TABLE_NAME"
                       AND F."COLUMN_NAME" = P."COLUMN_NAME"
                     WHERE P."OWNER" = v_target_owner
                       AND P."TABLE_NAME" = v_target_table
                       AND P."RUN_SOURCE_TYPE" = v_run_source_type
                       AND (v_run_source_type = 'DATA_WORK' OR P."RUN_ID" = v_run_id)
                       AND COALESCE(TRIM(F."FINAL_PREDICTED_TYPE"), TRIM(P."FINAL_PREDICTED_TYPE"), TRIM(P."MODL_PREDICTED_TYPE"), TRIM(P."BASE_PREDICTED_TYPE")) LIKE '%범주형'
                     GROUP BY P."COLUMN_NAME"
                     ORDER BY COLUMN_ID, "COLUMN_NAME"
                   )
            ) LOOP
                v_col := UPPER(TRIM(col_rec.COLUMN_NAME));
                IF REGEXP_LIKE(v_col, '^[A-Z][A-Z0-9_$#]{0,127}$')
                   AND v_col <> v_case_id_col
                   AND contains_column(p_available_cols, v_col)
                   AND NOT contains_column(v_cols, v_col) THEN
                    v_cols.EXTEND;
                    v_cols(v_cols.COUNT) := v_col;
                END IF;
            END LOOP;
        END IF;

        RETURN v_cols;
    END;

    PROCEDURE raise_no_apriori_input_columns(
        p_available_cols IN t_column_list
    ) IS
        v_predicted_categorical_cols NUMBER := 0;
        v_corr_pair_count NUMBER := 0;
        v_pass_pair_count NUMBER := 0;
        v_pass_column_count NUMBER := 0;
        v_candidate_before_query_count NUMBER := 0;
        v_reason VARCHAR2(1000);
    BEGIN
        SELECT COUNT(DISTINCT P."COLUMN_NAME")
          INTO v_predicted_categorical_cols
          FROM "INIT$_TB_PREDICTED_TYPE" P
          LEFT JOIN "INIT$_TB_PREDICTED_TYPE_FINAL" F
            ON F."OWNER" = P."OWNER"
           AND F."TABLE_NAME" = P."TABLE_NAME"
           AND F."COLUMN_NAME" = P."COLUMN_NAME"
         WHERE P."OWNER" = v_target_owner
           AND P."TABLE_NAME" = v_target_table
           AND P."RUN_SOURCE_TYPE" = v_run_source_type
           AND (v_run_source_type = 'DATA_WORK' OR P."RUN_ID" = v_run_id)
           AND COALESCE(TRIM(F."FINAL_PREDICTED_TYPE"), TRIM(P."FINAL_PREDICTED_TYPE"), TRIM(P."MODL_PREDICTED_TYPE"), TRIM(P."BASE_PREDICTED_TYPE")) LIKE '%범주형';

        SELECT COUNT(*)
          INTO v_corr_pair_count
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_target_owner
           AND "TABLE_NAME" = v_target_table
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id);

        SELECT COUNT(*)
          INTO v_pass_pair_count
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_target_owner
           AND "TABLE_NAME" = v_target_table
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
           AND "PASS_YN" = 'Y';

        SELECT COUNT(DISTINCT COLUMN_NAME)
          INTO v_pass_column_count
          FROM (
                SELECT "COL_A" AS COLUMN_NAME
                  FROM "INIT$_TB_CAT_CORR_PAIR"
                 WHERE "OWNER" = v_target_owner
                   AND "TABLE_NAME" = v_target_table
                   AND "RUN_SOURCE_TYPE" = v_run_source_type
                   AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
                   AND "PASS_YN" = 'Y'
                UNION
                SELECT "COL_B" AS COLUMN_NAME
                  FROM "INIT$_TB_CAT_CORR_PAIR"
                 WHERE "OWNER" = v_target_owner
                   AND "TABLE_NAME" = v_target_table
                   AND "RUN_SOURCE_TYPE" = v_run_source_type
                   AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
                   AND "PASS_YN" = 'Y'
               );

        SELECT COUNT(*)
          INTO v_candidate_before_query_count
          FROM (
                WITH CORR_COLS AS (
                    SELECT "COL_A" AS COLUMN_NAME
                      FROM "INIT$_TB_CAT_CORR_PAIR"
                     WHERE "OWNER" = v_target_owner
                       AND "TABLE_NAME" = v_target_table
                       AND "RUN_SOURCE_TYPE" = v_run_source_type
                       AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
                       AND "PASS_YN" = 'Y'
                    UNION
                    SELECT "COL_B" AS COLUMN_NAME
                      FROM "INIT$_TB_CAT_CORR_PAIR"
                     WHERE "OWNER" = v_target_owner
                       AND "TABLE_NAME" = v_target_table
                       AND "RUN_SOURCE_TYPE" = v_run_source_type
                       AND (v_run_source_type = 'DATA_WORK' OR "RUN_ID" = v_run_id)
                       AND "PASS_YN" = 'Y'
                ),
                CATEGORICAL_COLS AS (
                    SELECT DISTINCT P."COLUMN_NAME"
                      FROM "INIT$_TB_PREDICTED_TYPE" P
                      LEFT JOIN "INIT$_TB_PREDICTED_TYPE_FINAL" F
                        ON F."OWNER" = P."OWNER"
                       AND F."TABLE_NAME" = P."TABLE_NAME"
                       AND F."COLUMN_NAME" = P."COLUMN_NAME"
                     WHERE P."OWNER" = v_target_owner
                       AND P."TABLE_NAME" = v_target_table
                       AND P."RUN_SOURCE_TYPE" = v_run_source_type
                       AND (v_run_source_type = 'DATA_WORK' OR P."RUN_ID" = v_run_id)
                       AND COALESCE(TRIM(F."FINAL_PREDICTED_TYPE"), TRIM(P."FINAL_PREDICTED_TYPE"), TRIM(P."MODL_PREDICTED_TYPE"), TRIM(P."BASE_PREDICTED_TYPE")) LIKE '%범주형'
                )
                SELECT C."COLUMN_NAME"
                  FROM CATEGORICAL_COLS C
                  JOIN CORR_COLS R
                    ON R.COLUMN_NAME = C."COLUMN_NAME"
               );

        v_reason := CASE
            WHEN v_predicted_categorical_cols = 0 THEN
                'Run M03001 predicted type with RULE or BOTH first; no categorical predicted columns were found.'
            WHEN v_corr_pair_count = 0 THEN
                'Run M03002 correlation analysis first; no correlation pair rows were found.'
            WHEN v_pass_pair_count = 0 THEN
                'Relax M03002 thresholds or review data; no correlation pair passed PASS_YN=Y.'
            WHEN v_candidate_before_query_count = 0 THEN
                'Predicted categorical columns and PASS_YN=Y columns do not overlap.'
            ELSE
                'Candidate columns exist before query filtering, but data_query does not include usable candidate columns or only contains the case id column.'
        END;

        RAISE_APPLICATION_ERROR(
            -20209,
            'No Apriori input columns found for ' || v_target_owner || '.' || v_target_table
            || '. categorical_cols=' || v_predicted_categorical_cols
            || ', corr_pairs=' || v_corr_pair_count
            || ', pass_pairs=' || v_pass_pair_count
            || ', pass_cols=' || v_pass_column_count
            || ', candidate_cols_before_query_filter=' || v_candidate_before_query_count
            || ', data_query_cols=' || p_available_cols.COUNT
            || ', case_id=' || v_case_id_col
            || '. Next action: ' || v_reason
        );
    END;

    PROCEDURE prepare_apriori_data_query(p_input_rows IN NUMBER) IS
        v_available_cols t_column_list;
        v_candidate_cols t_column_list;
        v_select_list VARCHAR2(32767);
        v_candidate_csv VARCHAR2(4000);
        v_next_piece VARCHAR2(4000);
    BEGIN
        v_available_cols := describe_data_query_columns(v_base_query);

        IF NOT contains_column(v_available_cols, v_case_id_col) THEN
            RAISE_APPLICATION_ERROR(-20208, 'case_id_column_name is not included in Apriori data query: ' || v_case_id_col);
        END IF;

        v_candidate_cols := apriori_candidate_columns(v_available_cols);
        IF v_candidate_cols.COUNT = 0 THEN
            raise_no_apriori_input_columns(v_available_cols);
        END IF;

        v_select_list := quote_name(v_case_id_col);
        v_candidate_csv := NULL;

        FOR i IN 1 .. v_candidate_cols.COUNT LOOP
            v_next_piece := ', ' || quote_name(v_candidate_cols(i));
            IF LENGTH(v_select_list) + LENGTH(v_next_piece) > 30000 THEN
                RAISE_APPLICATION_ERROR(-20210, 'Apriori input column list is too long. Reduce selected categorical/correlation columns.');
            END IF;
            v_select_list := v_select_list || v_next_piece;

            IF v_candidate_csv IS NULL THEN
                v_candidate_csv := v_candidate_cols(i);
            ELSIF LENGTH(v_candidate_csv) + LENGTH(v_candidate_cols(i)) + 1 <= 4000 THEN
                v_candidate_csv := v_candidate_csv || ',' || v_candidate_cols(i);
            END IF;
        END LOOP;

        IF LENGTH(v_base_query) + LENGTH(v_select_list) + 80 > 32767 THEN
            RAISE_APPLICATION_ERROR(-20211, 'Apriori data query is too long after applying categorical/correlation column filter.');
        END IF;

        v_apriori_candidate_columns := v_candidate_csv;
        v_apriori_input_column_count := v_candidate_cols.COUNT + 1;
        v_data_query := 'SELECT ' || v_select_list || ' FROM (' || v_base_query || ') WHERE ROWNUM <= ' || TO_CHAR(p_input_rows);

        DBMS_OUTPUT.PUT_LINE('[INFO] Apriori input columns filtered by categorical prediction and PASS_YN=Y correlation pairs: '
            || TO_CHAR(v_candidate_cols.COUNT) || ' candidate columns, plus case id ' || v_case_id_col || '.');
    END;

    PROCEDURE apply_model_settings IS
    BEGIN
        v_setlist(DBMS_DATA_MINING.ALGO_NAME) := 'ALGO_APRIORI_ASSOCIATION_RULES';
        v_setlist('PREP_AUTO') := 'ON';
        v_setlist(DBMS_DATA_MINING.ASSO_MIN_SUPPORT) := TO_CHAR(v_min_support, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
        v_setlist(DBMS_DATA_MINING.ASSO_MIN_CONFIDENCE) := TO_CHAR(v_min_confidence, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
        v_setlist(DBMS_DATA_MINING.ASSO_MAX_RULE_LENGTH) := TO_CHAR(v_max_rule_length, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
    END;

    PROCEDURE create_apriori_model IS
    BEGIN
        DBMS_DATA_MINING.CREATE_MODEL2(
            MODEL_NAME          => v_model_name,
            MINING_FUNCTION     => DBMS_DATA_MINING.ASSOCIATION,
            DATA_QUERY          => v_data_query,
            SET_LIST            => v_setlist,
            CASE_ID_COLUMN_NAME => v_case_id_col
        );
    END;

    FUNCTION find_detail_column(p_object_name IN VARCHAR2, p_candidates IN SYS.ODCIVARCHAR2LIST) RETURN VARCHAR2 IS
        v_column_name VARCHAR2(128);
    BEGIN
        FOR i IN 1 .. p_candidates.COUNT LOOP
            BEGIN
                SELECT COLUMN_NAME
                  INTO v_column_name
                  FROM USER_TAB_COLUMNS
                 WHERE TABLE_NAME = p_object_name
                   AND COLUMN_NAME = UPPER(p_candidates(i))
                   AND ROWNUM = 1;
                RETURN v_column_name;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    NULL;
            END;
        END LOOP;
        RETURN NULL;
    END;

    FUNCTION text_column_expr(p_column_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_data_type VARCHAR2(128);
    BEGIN
        IF p_column_name IS NULL THEN
            RETURN '''''';
        END IF;

        SELECT DATA_TYPE
          INTO v_data_type
          FROM USER_TAB_COLUMNS
         WHERE TABLE_NAME = v_rule_view_name
           AND COLUMN_NAME = p_column_name
           AND ROWNUM = 1;

        IF v_data_type IN ('CLOB', 'NCLOB') THEN
            RETURN 'DBMS_LOB.SUBSTR("' || REPLACE(p_column_name, '"', '""') || '", 4000, 1)';
        ELSIF v_data_type = 'XMLTYPE' THEN
            RETURN 'XMLSERIALIZE(CONTENT "' || REPLACE(p_column_name, '"', '""') || '" AS VARCHAR2(4000))';
        END IF;

        RETURN 'TO_CHAR("' || REPLACE(p_column_name, '"', '""') || '")';
    END;

    FUNCTION number_column_expr(p_column_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_column_name IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN '"' || REPLACE(p_column_name, '"', '""') || '"';
    END;
BEGIN
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL QUERY';

    v_model_name := UPPER(TRIM(p_model_name));
    v_case_id_col := UPPER(TRIM(p_case_id_column_name));
    v_drop_existing := CASE WHEN UPPER(TRIM(NVL(p_drop_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20201, 'Invalid model_name parameter.');
    END IF;

    IF p_data_query IS NULL OR TRIM(p_data_query) IS NULL THEN
        RAISE_APPLICATION_ERROR(-20202, 'data_query parameter is required.');
    END IF;

    IF NOT REGEXP_LIKE(v_case_id_col, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20203, 'Invalid case_id_column_name parameter.');
    END IF;

    v_target_owner := normalize_identifier(p_target_owner, 'target_owner');
    v_target_table := normalize_identifier(p_target_table, 'target_table');

    SELECT COUNT(*)
      INTO v_model_count
      FROM USER_MINING_MODELS
     WHERE MODEL_NAME = v_model_name;

    IF v_model_count > 0 THEN
        IF v_drop_existing = 'Y' THEN
            DBMS_DATA_MINING.DROP_MODEL(v_model_name);
            DBMS_OUTPUT.PUT_LINE('[INFO] Dropped existing model: ' || v_model_name);
        ELSE
            RAISE_APPLICATION_ERROR(-20204, 'Mining model already exists: ' || v_model_name);
        END IF;
    END IF;

    v_min_support := GREATEST(0.2, LEAST(0.95, NVL(p_min_support, 0.2)));
    v_min_confidence := GREATEST(0.5, LEAST(0.99, NVL(p_min_confidence, 0.7)));
    v_max_rule_length := GREATEST(2, LEAST(3, NVL(p_max_rule_length, 3)));
    v_max_input_rows := GREATEST(1000, LEAST(100000, NVL(p_max_input_rows, 100000)));
    v_base_query := REGEXP_REPLACE(TRIM(p_data_query), ';+[[:space:]]*$', '');
    prepare_apriori_data_query(v_max_input_rows);

    IF NVL(p_min_support, 0.2) <> v_min_support THEN
        DBMS_OUTPUT.PUT_LINE('[WARN] min_support adjusted to ' || TO_CHAR(v_min_support) || ' to avoid Apriori PGA exhaustion.');
    END IF;
    IF NVL(p_max_rule_length, 3) <> v_max_rule_length THEN
        DBMS_OUTPUT.PUT_LINE('[WARN] max_rule_length adjusted to ' || TO_CHAR(v_max_rule_length) || ' to avoid Apriori candidate explosion.');
    END IF;
    DBMS_OUTPUT.PUT_LINE('[INFO] Apriori safe settings: min_support=' || TO_CHAR(v_min_support) ||
                         ', min_confidence=' || TO_CHAR(v_min_confidence) ||
                         ', max_rule_length=' || TO_CHAR(v_max_rule_length) ||
                         ', max_input_rows=' || TO_CHAR(v_max_input_rows));

    apply_model_settings;

    BEGIN
        create_apriori_model;
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -4036 THEN
                DBMS_OUTPUT.PUT_LINE('[WARN] Apriori exceeded PGA. Retrying with stricter safe settings.');
                BEGIN
                    DBMS_DATA_MINING.DROP_MODEL(v_model_name);
                EXCEPTION
                    WHEN OTHERS THEN
                        NULL;
                END;
                v_min_support := 0.3;
                v_min_confidence := GREATEST(v_min_confidence, 0.8);
                v_max_rule_length := 2;
                v_max_input_rows := 50000;
                prepare_apriori_data_query(v_max_input_rows);
                apply_model_settings;
                DBMS_OUTPUT.PUT_LINE('[INFO] Apriori retry settings: min_support=' || TO_CHAR(v_min_support, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') ||
                                     ', min_confidence=' || TO_CHAR(v_min_confidence, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') ||
                                     ', max_rule_length=' || TO_CHAR(v_max_rule_length, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') ||
                                     ', max_input_rows=' || TO_CHAR(v_max_input_rows));
                BEGIN
                    create_apriori_model;
                EXCEPTION
                    WHEN OTHERS THEN
                        RAISE_APPLICATION_ERROR(
                            -20205,
                            'Apriori model creation exceeded PGA memory even after retry. Reduce selected columns/rows or use safer parameters: min_support >= 0.4, max_rule_length <= 2. ' ||
                            'Retry settings were min_support=' || TO_CHAR(v_min_support, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') ||
                            ', max_rule_length=' || TO_CHAR(v_max_rule_length, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') ||
                            ', max_input_rows=' || TO_CHAR(v_max_input_rows) || '. Original error: ' || SQLERRM
                        );
                END;
            ELSE
                RAISE;
            END IF;
    END;

    BEGIN
        INIT$_PKG_RULE_SUMMARY.LOAD_CONDITIONAL_RULES(
            p_model_name          => v_model_name,
            p_data_query          => v_data_query,
            p_case_id_column_name => v_case_id_col,
            p_candidate_columns   => v_apriori_candidate_columns,
            p_target_columns      => NULL,
            p_model_type          => 'APRIORI_ASSOCIATION',
            p_rule_source         => 'CONDITIONAL_FREQUENCY',
            p_min_support_count   => p_min_rule_support_count,
            p_min_confidence      => v_min_confidence,
            p_min_lift            => p_min_rule_lift,
            p_max_columns         => p_max_rule_summary_columns,
            p_max_rules_per_pair  => p_max_rule_summary_per_pair,
            p_max_input_rows      => NULL,
            p_clear_existing_yn   => 'Y',
            p_target_owner        => p_target_owner,
            p_target_table        => p_target_table,
            p_run_source_type     => v_run_source_type,
            p_run_id              => v_run_id
        );

        SELECT COUNT(*)
          INTO v_conditional_rule_count
          FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
         WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
           AND "TARGET_OWNER" = v_target_owner
           AND "TARGET_TABLE" = v_target_table
           AND "MODEL_NAME" = v_model_name
           AND "RULE_SOURCE" = 'CONDITIONAL_FREQUENCY';

        v_conditional_loaded := v_conditional_rule_count > 0;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            DBMS_OUTPUT.PUT_LINE('[WARN] Conditional frequency rule summary skipped: ' || SQLERRM);
            DBMS_OUTPUT.PUT_LINE('[WARN] ' || DBMS_UTILITY.FORMAT_ERROR_BACKTRACE);
    END;

    IF v_conditional_loaded THEN
        DBMS_OUTPUT.PUT_LINE('[OK] Apriori conditional frequency rule summary available: ' || v_conditional_rule_count || ' rows');
    ELSE
        v_rule_view_name := 'DM$VR' || v_model_name;
        SELECT COUNT(*)
          INTO v_rule_view_count
          FROM USER_OBJECTS
         WHERE OBJECT_NAME = v_rule_view_name
           AND OBJECT_TYPE IN ('VIEW', 'TABLE');

        IF v_rule_view_count > 0 THEN
        BEGIN
            v_rule_id_col := find_detail_column(v_rule_view_name, SYS.ODCIVARCHAR2LIST('RULE_ID', 'ID'));
            v_antecedent_col := find_detail_column(v_rule_view_name, SYS.ODCIVARCHAR2LIST('ANTECEDENT', 'ANTECEDENT_ITEMS', 'LHS', 'PREMISE', 'CONDITION', 'IF'));
            v_consequent_col := find_detail_column(v_rule_view_name, SYS.ODCIVARCHAR2LIST('CONSEQUENT', 'RHS', 'PREDICT', 'OUTCOME', 'THEN'));
            v_support_col := find_detail_column(v_rule_view_name, SYS.ODCIVARCHAR2LIST('RULE_SUPPORT', 'SUPPORT'));
            v_confidence_col := find_detail_column(v_rule_view_name, SYS.ODCIVARCHAR2LIST('RULE_CONFIDENCE', 'CONFIDENCE'));
            v_lift_col := find_detail_column(v_rule_view_name, SYS.ODCIVARCHAR2LIST('RULE_LIFT', 'LIFT'));

            v_rule_id_expr := CASE
                                  WHEN v_rule_id_col IS NULL THEN 'TO_CHAR(ROWNUM)'
                                  ELSE 'NVL(' || text_column_expr(v_rule_id_col) || ', TO_CHAR(ROWNUM))'
                              END;
            v_antecedent_expr := text_column_expr(v_antecedent_col);
            v_consequent_expr := text_column_expr(v_consequent_col);
            v_support_expr := number_column_expr(v_support_col);
            v_confidence_expr := number_column_expr(v_confidence_col);
            v_lift_expr := number_column_expr(v_lift_col);

            DELETE /*+ NO_PARALLEL */ FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
             WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
               AND "RUN_SOURCE_TYPE" = v_run_source_type
               AND "RUN_ID" = v_run_id
               AND "TARGET_OWNER" = v_target_owner
               AND "TARGET_TABLE" = v_target_table
               AND "MODEL_NAME" = v_model_name;

            EXECUTE IMMEDIATE
                'INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_ASSOC_RULE_SUMMARY" (' ||
                ' "RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "MODEL_TYPE", "RULE_SOURCE", "RULE_ID", "CONDITION_COUNT", "RESULT_COLUMN", "RESULT_VALUE", ' ||
                ' "RESULT_HAS_VALUE_YN", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT", "CONDITION_TEXT", "RESULT_TEXT", "CREATE_DT") ' ||
                'SELECT :run_source_type, :run_id, SYS_CONTEXT(''USERENV'', ''CURRENT_SCHEMA''), :target_owner, :target_table, :model_name, ''APRIORI_ASSOCIATION'', ''ORACLE_DM_VR'', ' || v_rule_id_expr || ', ' ||
                '       REGEXP_COUNT(NVL(' || v_antecedent_expr || ', ''''), ''<item([[:space:]>])'', 1, ''i''), ' ||
                '       REGEXP_SUBSTR(' || v_consequent_expr || ', ''<item_name>([^<]+)</item_name>'', 1, 1, ''i'', 1), ' ||
                '       REGEXP_SUBSTR(' || v_consequent_expr || ', ''<item_value>([^<]+)</item_value>'', 1, 1, ''i'', 1), ' ||
                '       CASE WHEN REGEXP_SUBSTR(' || v_consequent_expr || ', ''<item_value>([^<]+)</item_value>'', 1, 1, ''i'', 1) IS NULL THEN ''N'' ELSE ''Y'' END, ' ||
                '       ' || v_support_expr || ', ' || v_confidence_expr || ', ' || v_lift_expr || ', ' ||
                '       ' || v_antecedent_expr || ', ' || v_consequent_expr || ', SYSDATE ' ||
                '  FROM "' || REPLACE(v_rule_view_name, '"', '""') || '"'
            USING v_run_source_type, v_run_id, v_target_owner, v_target_table, v_model_name;

            DBMS_OUTPUT.PUT_LINE('[OK] Association rule summary loaded: ' || SQL%ROWCOUNT || ' rows');
            DBMS_OUTPUT.PUT_LINE('[INFO] Rule summary columns: rule_id=' || NVL(v_rule_id_col, '(ROWNUM)') ||
                                 ', antecedent=' || NVL(v_antecedent_col, '(none)') ||
                                 ', consequent=' || NVL(v_consequent_col, '(none)'));
        EXCEPTION
            WHEN OTHERS THEN
                ROLLBACK;
                DBMS_OUTPUT.PUT_LINE('[WARN] Association rule summary load skipped: ' || SQLERRM);
                DBMS_OUTPUT.PUT_LINE('[WARN] Rule summary columns: rule_id=' || NVL(v_rule_id_col, '(ROWNUM)') ||
                                     ', antecedent=' || NVL(v_antecedent_col, '(none)') ||
                                     ', consequent=' || NVL(v_consequent_col, '(none)'));
                DBMS_OUTPUT.PUT_LINE('[WARN] ' || DBMS_UTILITY.FORMAT_ERROR_BACKTRACE);
        END;
        ELSE
            DBMS_OUTPUT.PUT_LINE('[WARN] Rule detail view not found for summary: ' || v_rule_view_name);
        END IF;
    END IF;

    DBMS_OUTPUT.PUT_LINE('[OK] Apriori association model created: ' || v_model_name);
    DBMS_OUTPUT.PUT_LINE('[INFO] Check generated detail views with USER_OBJECTS LIKE DM$V%' || v_model_name);
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_DECISION_TREE_RULE_MODEL" (
    p_model_name          IN VARCHAR2,
    p_data_query          IN VARCHAR2,
    p_case_id_column_name IN VARCHAR2,
    p_target_column_name  IN VARCHAR2,
    p_candidate_columns   IN VARCHAR2 DEFAULT NULL,
    p_min_support_count   IN NUMBER   DEFAULT 30,
    p_min_confidence      IN NUMBER   DEFAULT 0.7,
    p_min_lift            IN NUMBER   DEFAULT 1,
    p_drop_existing_yn    IN VARCHAR2 DEFAULT 'Y',
    p_max_input_rows      IN NUMBER   DEFAULT 100000,
    p_max_rule_summary_columns IN NUMBER DEFAULT 25,
    p_max_rule_summary_per_pair IN NUMBER DEFAULT 50,
    p_target_owner        IN VARCHAR2 DEFAULT NULL,
    p_target_table        IN VARCHAR2 DEFAULT NULL,
    p_run_source_type     IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id              IN NUMBER   DEFAULT 0
) AUTHID CURRENT_USER IS
    v_setlist DBMS_DATA_MINING.SETTING_LIST;
    v_model_name VARCHAR2(128);
    v_case_id_col VARCHAR2(128);
    v_target_col VARCHAR2(128);
    v_model_count NUMBER;
    v_drop_existing VARCHAR2(1);
    v_data_query VARCHAR2(32767);
    v_max_input_rows NUMBER;
    v_rule_count NUMBER := 0;
    v_target_owner VARCHAR2(128);
    v_target_table VARCHAR2(128);
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_label IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128);
    BEGIN
        v_value := UPPER(TRIM(BOTH '"' FROM TRIM(p_value)));
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20407, 'Invalid ' || p_label || ' parameter: ' || SUBSTR(NVL(p_value, '(null)'), 1, 200));
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    PROCEDURE prepare_rule_summary_for_decision_tree IS
    BEGIN
        DBMS_OUTPUT.PUT_LINE('[INFO] Disabling parallel DML before Decision Tree rule summary'
            || ' (model=' || NVL(v_model_name, '(null)')
            || ', target=' || NVL(v_target_owner, '(null)') || '.' || NVL(v_target_table, '(null)') || ')');

        EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

        DBMS_OUTPUT.PUT_LINE('[INFO] Parallel DML disabled for Decision Tree rule summary.');
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(
                -20408,
                'Could not disable parallel DML for Decision Tree rule summary. model='
                || NVL(v_model_name, '(null)')
                || ', target=' || NVL(v_target_owner, '(null)') || '.' || NVL(v_target_table, '(null)')
                || ', error=' || SQLERRM
            );
    END prepare_rule_summary_for_decision_tree;
BEGIN
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    v_model_name := UPPER(TRIM(p_model_name));
    v_case_id_col := UPPER(TRIM(p_case_id_column_name));
    v_target_col := UPPER(TRIM(p_target_column_name));
    v_drop_existing := CASE WHEN UPPER(TRIM(NVL(p_drop_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20401, 'Invalid model_name parameter.');
    END IF;

    IF p_data_query IS NULL OR TRIM(p_data_query) IS NULL THEN
        RAISE_APPLICATION_ERROR(-20402, 'data_query parameter is required.');
    END IF;

    IF NOT REGEXP_LIKE(v_case_id_col, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20403, 'Invalid case_id_column_name parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_target_col, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20404, 'Invalid target_column_name parameter.');
    END IF;

    IF v_case_id_col = v_target_col THEN
        RAISE_APPLICATION_ERROR(-20405, 'case_id_column_name and target_column_name must be different.');
    END IF;

    v_target_owner := CASE
        WHEN p_target_owner IS NULL OR TRIM(p_target_owner) IS NULL THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_target_owner, 'target_owner')
    END;
    v_target_table := CASE
        WHEN p_target_table IS NULL OR TRIM(p_target_table) IS NULL THEN 'UNKNOWN'
        ELSE normalize_identifier(p_target_table, 'target_table')
    END;

    SELECT COUNT(*)
      INTO v_model_count
      FROM USER_MINING_MODELS
     WHERE MODEL_NAME = v_model_name;

    IF v_model_count > 0 THEN
        IF v_drop_existing = 'Y' THEN
            DBMS_DATA_MINING.DROP_MODEL(v_model_name);
            DBMS_OUTPUT.PUT_LINE('[INFO] Dropped existing model: ' || v_model_name);
        ELSE
            RAISE_APPLICATION_ERROR(-20406, 'Mining model already exists: ' || v_model_name);
        END IF;
    END IF;

    v_max_input_rows := GREATEST(1000, LEAST(1000000, NVL(p_max_input_rows, 100000)));
    v_data_query := REGEXP_REPLACE(TRIM(p_data_query), ';+[[:space:]]*$', '');
    v_data_query := 'SELECT * FROM (' || v_data_query || ') WHERE ROWNUM <= ' || TO_CHAR(v_max_input_rows);

    v_setlist(DBMS_DATA_MINING.ALGO_NAME) := 'ALGO_DECISION_TREE';
    v_setlist('PREP_AUTO') := 'ON';

    DBMS_DATA_MINING.CREATE_MODEL2(
        MODEL_NAME          => v_model_name,
        MINING_FUNCTION     => DBMS_DATA_MINING.CLASSIFICATION,
        DATA_QUERY          => v_data_query,
        SET_LIST            => v_setlist,
        CASE_ID_COLUMN_NAME => v_case_id_col,
        TARGET_COLUMN_NAME  => v_target_col
    );

    prepare_rule_summary_for_decision_tree;

    INIT$_PKG_RULE_SUMMARY.LOAD_CONDITIONAL_RULES(
        p_model_name          => v_model_name,
        p_data_query          => v_data_query,
        p_case_id_column_name => v_case_id_col,
        p_candidate_columns   => p_candidate_columns,
        p_target_columns      => v_target_col,
        p_model_type          => 'DECISION_TREE_CLASSIFICATION',
        p_rule_source         => 'TARGET_CONDITIONAL_FREQUENCY',
        p_min_support_count   => p_min_support_count,
        p_min_confidence      => p_min_confidence,
        p_min_lift            => p_min_lift,
        p_max_columns         => p_max_rule_summary_columns,
        p_max_rules_per_pair  => p_max_rule_summary_per_pair,
        p_max_input_rows      => NULL,
        p_clear_existing_yn   => 'Y',
        p_target_owner        => v_target_owner,
        p_target_table        => v_target_table,
        p_run_source_type     => v_run_source_type,
        p_run_id              => v_run_id
    );

    SELECT COUNT(*)
      INTO v_rule_count
      FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
     WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
       AND "RUN_SOURCE_TYPE" = v_run_source_type
       AND "RUN_ID" = v_run_id
       AND "TARGET_OWNER" = v_target_owner
       AND "TARGET_TABLE" = v_target_table
       AND "MODEL_NAME" = v_model_name
       AND "RULE_SOURCE" = 'TARGET_CONDITIONAL_FREQUENCY';

    DBMS_OUTPUT.PUT_LINE('[OK] Decision Tree classification model created: ' || v_model_name);
    DBMS_OUTPUT.PUT_LINE('[OK] Decision Tree target conditional rule summary loaded: ' || v_rule_count || ' rows');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_RULE_VIOLATION_DETECT" (
    p_rule_owner_name       IN VARCHAR2 DEFAULT NULL,
    p_rule_model_name       IN VARCHAR2,
    p_target_owner          IN VARCHAR2 DEFAULT NULL,
    p_target_table          IN VARCHAR2,
    p_case_id_column_name   IN VARCHAR2 DEFAULT 'FILE_ROW_NO',
    p_result_owner          IN VARCHAR2 DEFAULT NULL,
    p_result_table          IN VARCHAR2 DEFAULT 'INIT$_TB_RULE_VIOLATION_RESULT',
    p_min_confidence        IN NUMBER   DEFAULT 0.8,
    p_min_lift              IN NUMBER   DEFAULT 1,
    p_max_rules             IN NUMBER   DEFAULT 500,
    p_max_violations_per_rule IN NUMBER DEFAULT 1000,
    p_clear_existing_yn     IN VARCHAR2 DEFAULT 'Y',
    p_commit_yn             IN VARCHAR2 DEFAULT 'Y',
    p_run_source_type       IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id                IN NUMBER   DEFAULT 0,
    p_commit_interval       IN NUMBER   DEFAULT 10000
) AUTHID CURRENT_USER IS
    v_rule_owner VARCHAR2(128);
    v_rule_model VARCHAR2(128);
    v_target_owner VARCHAR2(128);
    v_target_table VARCHAR2(128);
    v_result_owner VARCHAR2(128);
    v_result_table VARCHAR2(128);
    v_case_id_col VARCHAR2(128);
    v_case_id_expr VARCHAR2(4000);
    v_target_object VARCHAR2(600);
    v_result_object VARCHAR2(600);
    v_clear_existing VARCHAR2(1);
    v_commit VARCHAR2(1);
    v_min_confidence NUMBER;
    v_min_lift NUMBER;
    v_max_rules NUMBER;
    v_max_violations_per_rule NUMBER;
    v_commit_interval NUMBER;
    v_pending_dml_count NUMBER := 0;
    v_deleted_count NUMBER := 0;
    v_inserted_total NUMBER := 0;
    v_committed_chunks NUMBER := 0;
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;

    FUNCTION is_null_token(p_value IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_value IS NULL OR TRIM(p_value) IS NULL OR UPPER(TRIM(p_value)) IN ('NULL', '-', 'NONE');
    END;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := UPPER(TRIM(p_value));
    BEGIN
        IF NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20501, 'Invalid ' || p_name || ' parameter.');
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION quote_name(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_value, '"', '""') || '"';
    END;

    FUNCTION qualified_name(p_owner IN VARCHAR2, p_object IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN quote_name(p_owner) || '.' || quote_name(p_object);
    END;

    FUNCTION sql_literal(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN '''' || REPLACE(p_value, '''', '''''') || '''';
    END;

    FUNCTION number_literal(p_value IN NUMBER, p_default IN NUMBER DEFAULT 0) RETURN VARCHAR2 IS
    BEGIN
        RETURN TO_CHAR(NVL(p_value, p_default), 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
    END;

    FUNCTION table_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM ALL_TABLES
         WHERE OWNER = p_owner
           AND TABLE_NAME = p_table;
        RETURN v_count > 0;
    END;

    FUNCTION column_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2, p_column IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM ALL_TAB_COLUMNS
         WHERE OWNER = p_owner
           AND TABLE_NAME = p_table
           AND COLUMN_NAME = p_column;
        RETURN v_count > 0;
    END;

    FUNCTION build_condition_where(p_condition_text IN CLOB) RETURN CLOB IS
        v_text VARCHAR2(32767) := DBMS_LOB.SUBSTR(p_condition_text, 32767, 1);
        v_rest VARCHAR2(32767);
        v_token VARCHAR2(4000);
        v_pos PLS_INTEGER;
        v_col VARCHAR2(128);
        v_val VARCHAR2(4000);
        v_where CLOB := NULL;
        v_count PLS_INTEGER := 0;
    BEGIN
        v_rest := TRIM(v_text);
        WHILE v_rest IS NOT NULL LOOP
            v_pos := INSTR(v_rest, ' AND ');
            IF v_pos > 0 THEN
                v_token := TRIM(SUBSTR(v_rest, 1, v_pos - 1));
                v_rest := TRIM(SUBSTR(v_rest, v_pos + 5));
            ELSE
                v_token := TRIM(v_rest);
                v_rest := NULL;
            END IF;

            v_col := UPPER(REGEXP_SUBSTR(v_token, '^[[:space:]]*([A-Za-z][A-Za-z0-9_$#]{0,127})[[:space:]]*=', 1, 1, 'i', 1));
            v_val := REGEXP_REPLACE(v_token, '^[[:space:]]*[A-Za-z][A-Za-z0-9_$#]{0,127}[[:space:]]*=[[:space:]]*', '', 1, 1, 'i');

            IF v_col IS NULL OR NOT column_exists(v_target_owner, v_target_table, v_col) THEN
                RETURN NULL;
            END IF;

            IF v_count > 0 THEN
                v_where := v_where || ' AND ';
            END IF;
            v_where := v_where || 'TO_CHAR(' || quote_name(v_col) || ') = ' || sql_literal(v_val);
            v_count := v_count + 1;
        END LOOP;

        IF v_count > 0 THEN
            RETURN v_where;
        END IF;
        RETURN NULL;
    END;

    PROCEDURE commit_work_chunk(p_force IN BOOLEAN DEFAULT FALSE) IS
    BEGIN
        IF v_commit = 'Y'
           AND v_commit_interval > 0
           AND v_pending_dml_count > 0
           AND (p_force OR v_pending_dml_count >= v_commit_interval) THEN
            COMMIT;
            v_committed_chunks := v_committed_chunks + 1;
            v_pending_dml_count := 0;
        END IF;
    END;

    PROCEDURE disable_parallel_execution IS
    BEGIN
        BEGIN
            EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLCODE <> -12841 THEN
                    RAISE;
                END IF;
        END;

        BEGIN
            EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL QUERY';
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLCODE <> -12841 THEN
                    RAISE;
                END IF;
        END;
    END;
BEGIN
    v_rule_owner := CASE
        WHEN is_null_token(p_rule_owner_name) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_rule_owner_name, 'rule_owner_name')
    END;
    v_rule_model := normalize_identifier(p_rule_model_name, 'rule_model_name');
    v_target_owner := CASE
        WHEN is_null_token(p_target_owner) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_target_owner, 'target_owner')
    END;
    v_target_table := normalize_identifier(p_target_table, 'target_table');
    v_result_owner := CASE
        WHEN is_null_token(p_result_owner) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_result_owner, 'result_owner')
    END;
    v_result_table := normalize_identifier(NVL(p_result_table, 'INIT$_TB_RULE_VIOLATION_RESULT'), 'result_table');
    v_case_id_col := CASE
        WHEN is_null_token(p_case_id_column_name) THEN NULL
        ELSE normalize_identifier(p_case_id_column_name, 'case_id_column_name')
    END;
    v_clear_existing := CASE WHEN UPPER(TRIM(NVL(p_clear_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    v_commit := CASE WHEN UPPER(TRIM(NVL(p_commit_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    v_min_confidence := GREATEST(0, LEAST(1, NVL(p_min_confidence, 0.8)));
    v_min_lift := GREATEST(0, NVL(p_min_lift, 1));
    v_max_rules := GREATEST(1, LEAST(10000, NVL(p_max_rules, 500)));
    v_max_violations_per_rule := GREATEST(1, LEAST(100000, NVL(p_max_violations_per_rule, 1000)));
    v_commit_interval := GREATEST(0, LEAST(1000000, NVL(p_commit_interval, 10000)));
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);
    v_target_object := qualified_name(v_target_owner, v_target_table);
    v_result_object := qualified_name(v_result_owner, v_result_table);

    IF NOT table_exists(v_target_owner, v_target_table) THEN
        RAISE_APPLICATION_ERROR(-20502, 'Target table does not exist: ' || v_target_owner || '.' || v_target_table);
    END IF;

    IF NOT table_exists(v_result_owner, v_result_table) THEN
        RAISE_APPLICATION_ERROR(-20503, 'Result table does not exist: ' || v_result_owner || '.' || v_result_table);
    END IF;

    IF v_case_id_col IS NOT NULL AND column_exists(v_target_owner, v_target_table, v_case_id_col) THEN
        v_case_id_expr := 'SUBSTR(TO_CHAR(' || quote_name(v_case_id_col) || '), 1, 4000)';
    ELSE
        v_case_id_expr := 'NULL';
    END IF;

    disable_parallel_execution;

    IF v_clear_existing = 'Y' THEN
        EXECUTE IMMEDIATE
            'DELETE /*+ NO_PARALLEL */ FROM ' || v_result_object ||
            ' WHERE "RUN_SOURCE_TYPE" = :run_source_type' ||
            '   AND "RUN_ID" = :run_id' ||
            '   AND "TARGET_OWNER" = :target_owner' ||
            '   AND "TARGET_TABLE" = :target_table' ||
            '   AND "RULE_OWNER" = :rule_owner' ||
            '   AND "MODEL_NAME" = :model_name'
            USING v_run_source_type, v_run_id, v_target_owner, v_target_table, v_rule_owner, v_rule_model;
        v_deleted_count := SQL%ROWCOUNT;
        v_pending_dml_count := v_pending_dml_count + v_deleted_count;
        commit_work_chunk(FALSE);
    END IF;

    FOR rule_rec IN (
        SELECT *
          FROM (
                SELECT S.*
                     , ROW_NUMBER() OVER (
                           ORDER BY S.RULE_CONFIDENCE DESC NULLS LAST,
                                    S.RULE_LIFT DESC NULLS LAST,
                                    S.SUPPORT_COUNT DESC NULLS LAST,
                                    S.RULE_ID
                       ) AS RN__
                 FROM "INIT$_TB_ASSOC_RULE_SUMMARY" S
                 WHERE S."OWNER" = v_rule_owner
                   AND S."RUN_SOURCE_TYPE" = v_run_source_type
                   AND (v_run_source_type = 'DATA_WORK' OR S."RUN_ID" = v_run_id)
                   AND S."TARGET_OWNER" = v_target_owner
                   AND S."TARGET_TABLE" = v_target_table
                   AND S."MODEL_NAME" = v_rule_model
                   AND S."RESULT_HAS_VALUE_YN" = 'Y'
                   AND S."RESULT_COLUMN" IS NOT NULL
                   AND S."RESULT_VALUE" IS NOT NULL
                   AND S."CONDITION_TEXT" IS NOT NULL
                   AND NVL(S."RULE_CONFIDENCE", 0) >= v_min_confidence
                   AND NVL(S."RULE_LIFT", 0) >= v_min_lift
               )
         WHERE RN__ <= v_max_rules
    ) LOOP
        DECLARE
            v_result_col VARCHAR2(128) := UPPER(TRIM(rule_rec.RESULT_COLUMN));
            v_expected VARCHAR2(4000) := DBMS_LOB.SUBSTR(TO_CLOB(rule_rec.RESULT_VALUE), 4000, 1);
            v_condition_where CLOB;
            v_sql CLOB;
            v_score NUMBER;
            v_reason VARCHAR2(4000);
            v_inserted_count NUMBER := 0;
        BEGIN
            IF NOT column_exists(v_target_owner, v_target_table, v_result_col) THEN
                CONTINUE;
            END IF;

            v_condition_where := build_condition_where(rule_rec.CONDITION_TEXT);
            IF v_condition_where IS NULL THEN
                CONTINUE;
            END IF;

            v_score := NVL(rule_rec.RULE_CONFIDENCE, 0) * GREATEST(NVL(rule_rec.RULE_LIFT, 1), 1);
            v_reason := 'Expected ' || v_result_col || ' = ' || v_expected || ' but actual value is different.';

            v_sql :=
                'INSERT /*+ NO_PARALLEL */ INTO ' || v_result_object || ' (' ||
                '"RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "RULE_OWNER", "MODEL_NAME", "RULE_ID", ' ||
                '"CASE_ID", "CASE_ROWID", "CONDITION_COUNT", "CONDITION_TEXT", "RESULT_COLUMN", ' ||
                '"EXPECTED_VALUE", "ACTUAL_VALUE", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT", ' ||
                '"SUPPORT_COUNT", "CONDITION_TOTAL_COUNT", "RESULT_TOTAL_COUNT", "TOTAL_COUNT", ' ||
                '"VIOLATION_SCORE", "VIOLATION_REASON", "CREATE_DT") ' ||
                'SELECT /*+ NO_PARALLEL */ ' ||
                sql_literal(v_run_source_type) || ', ' ||
                number_literal(v_run_id) || ', ' ||
                sql_literal(v_target_owner) || ', ' ||
                sql_literal(v_target_table) || ', ' ||
                sql_literal(v_rule_owner) || ', ' ||
                sql_literal(v_rule_model) || ', ' ||
                sql_literal(rule_rec.RULE_ID) || ', ' ||
                v_case_id_expr || ', ' ||
                'ROWIDTOCHAR(ROWID), ' ||
                number_literal(rule_rec.CONDITION_COUNT) || ', ' ||
                sql_literal(DBMS_LOB.SUBSTR(rule_rec.CONDITION_TEXT, 4000, 1)) || ', ' ||
                sql_literal(v_result_col) || ', ' ||
                sql_literal(v_expected) || ', ' ||
                'SUBSTR(TO_CHAR(' || quote_name(v_result_col) || '), 1, 4000), ' ||
                number_literal(rule_rec.RULE_SUPPORT) || ', ' ||
                number_literal(rule_rec.RULE_CONFIDENCE) || ', ' ||
                number_literal(rule_rec.RULE_LIFT, 1) || ', ' ||
                number_literal(rule_rec.SUPPORT_COUNT) || ', ' ||
                number_literal(rule_rec.CONDITION_TOTAL_COUNT) || ', ' ||
                number_literal(rule_rec.RESULT_TOTAL_COUNT) || ', ' ||
                number_literal(rule_rec.TOTAL_COUNT) || ', ' ||
                number_literal(v_score) || ', ' ||
                sql_literal(v_reason) || ', SYSDATE ' ||
                'FROM ' || v_target_object ||
                ' WHERE ' || v_condition_where ||
                '   AND (' || quote_name(v_result_col) || ' IS NULL OR TO_CHAR(' || quote_name(v_result_col) || ') <> ' || sql_literal(v_expected) || ')' ||
                '   AND ROWNUM <= ' || TO_CHAR(v_max_violations_per_rule);

            EXECUTE IMMEDIATE v_sql;
            v_inserted_count := SQL%ROWCOUNT;
            v_inserted_total := v_inserted_total + v_inserted_count;
            v_pending_dml_count := v_pending_dml_count + v_inserted_count;
            commit_work_chunk(FALSE);
        END;
    END LOOP;

    IF v_commit = 'Y' THEN
        IF v_pending_dml_count > 0 THEN
            v_committed_chunks := v_committed_chunks + 1;
        END IF;
        COMMIT;
        v_pending_dml_count := 0;
    END IF;

    DBMS_OUTPUT.PUT_LINE('[OK] Rule violation detection completed. inserted=' || v_inserted_total ||
        ', deleted=' || v_deleted_count ||
        ', commitInterval=' || v_commit_interval ||
        ', commits=' || v_committed_chunks ||
        ', target=' || v_target_owner || '.' || v_target_table ||
        ', model=' || v_rule_owner || '.' || v_rule_model);
EXCEPTION
    WHEN OTHERS THEN
        IF v_committed_chunks > 0 THEN
            DBMS_OUTPUT.PUT_LINE('[WARN] Rule violation detection failed after committed chunks. Only uncommitted work will be rolled back.');
        END IF;
        IF v_commit = 'Y' THEN
            ROLLBACK;
        END IF;
        RAISE;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_RULE_VIOLATION_SQL" (
    p_rule_owner_name     IN VARCHAR2 DEFAULT NULL,
    p_rule_model_name     IN VARCHAR2,
    p_rule_id             IN VARCHAR2,
    p_target_owner        IN VARCHAR2 DEFAULT NULL,
    p_target_table        IN VARCHAR2,
    p_case_id_column_name IN VARCHAR2 DEFAULT 'FILE_ROW_NO',
    p_run_source_type     IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id              IN NUMBER   DEFAULT 0
) RETURN CLOB AUTHID CURRENT_USER IS
    v_rule_owner VARCHAR2(128);
    v_rule_model VARCHAR2(128);
    v_rule_id VARCHAR2(128);
    v_target_owner VARCHAR2(128);
    v_target_table VARCHAR2(128);
    v_case_id_col VARCHAR2(128);
    v_case_id_expr VARCHAR2(4000);
    v_target_object VARCHAR2(600);
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;
    v_result_col VARCHAR2(128);
    v_expected VARCHAR2(4000);
    v_condition_text CLOB;
    v_condition_count NUMBER;
    v_rule_support NUMBER;
    v_rule_confidence NUMBER;
    v_rule_lift NUMBER;
    v_support_count NUMBER;
    v_condition_total_count NUMBER;
    v_result_total_count NUMBER;
    v_total_count NUMBER;
    v_condition_where CLOB;
    v_score NUMBER;
    v_sql CLOB;

    FUNCTION is_null_token(p_value IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_value IS NULL OR TRIM(p_value) IS NULL OR UPPER(TRIM(p_value)) IN ('NULL', '-', 'NONE');
    END;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := UPPER(TRIM(p_value));
    BEGIN
        IF NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20581, 'Invalid ' || p_name || ' parameter.');
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_rule_id(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := TRIM(p_value);
    BEGIN
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Za-z0-9_$#:-]{1,128}$') THEN
            RAISE_APPLICATION_ERROR(-20582, 'Invalid rule_id parameter.');
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION quote_name(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_value, '"', '""') || '"';
    END;

    FUNCTION qualified_name(p_owner IN VARCHAR2, p_object IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN quote_name(p_owner) || '.' || quote_name(p_object);
    END;

    FUNCTION sql_literal(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN '''' || REPLACE(p_value, '''', '''''') || '''';
    END;

    FUNCTION number_literal(p_value IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN TO_CHAR(p_value, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
    END;

    FUNCTION table_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM ALL_TABLES
         WHERE OWNER = p_owner
           AND TABLE_NAME = p_table;
        RETURN v_count > 0;
    END;

    FUNCTION column_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2, p_column IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        IF p_column IS NULL THEN
            RETURN FALSE;
        END IF;
        SELECT COUNT(*)
          INTO v_count
          FROM ALL_TAB_COLUMNS
         WHERE OWNER = p_owner
           AND TABLE_NAME = p_table
           AND COLUMN_NAME = p_column;
        RETURN v_count > 0;
    END;

    FUNCTION build_condition_where(p_condition_text IN CLOB) RETURN CLOB IS
        v_text VARCHAR2(32767) := DBMS_LOB.SUBSTR(p_condition_text, 32767, 1);
        v_rest VARCHAR2(32767);
        v_token VARCHAR2(4000);
        v_pos PLS_INTEGER;
        v_col VARCHAR2(128);
        v_val VARCHAR2(4000);
        v_where CLOB := NULL;
        v_count PLS_INTEGER := 0;
    BEGIN
        v_rest := TRIM(v_text);
        WHILE v_rest IS NOT NULL LOOP
            v_pos := INSTR(v_rest, ' AND ');
            IF v_pos > 0 THEN
                v_token := TRIM(SUBSTR(v_rest, 1, v_pos - 1));
                v_rest := TRIM(SUBSTR(v_rest, v_pos + 5));
            ELSE
                v_token := TRIM(v_rest);
                v_rest := NULL;
            END IF;

            v_col := UPPER(REGEXP_SUBSTR(v_token, '^[[:space:]]*([A-Za-z][A-Za-z0-9_$#]{0,127})[[:space:]]*=', 1, 1, 'i', 1));
            v_val := REGEXP_REPLACE(v_token, '^[[:space:]]*[A-Za-z][A-Za-z0-9_$#]{0,127}[[:space:]]*=[[:space:]]*', '', 1, 1, 'i');

            IF v_col IS NULL OR NOT column_exists(v_target_owner, v_target_table, v_col) THEN
                RETURN NULL;
            END IF;

            IF v_count > 0 THEN
                v_where := v_where || ' AND ';
            END IF;
            v_where := v_where || 'TO_CHAR(T.' || quote_name(v_col) || ') = ' || sql_literal(v_val);
            v_count := v_count + 1;
        END LOOP;

        IF v_count > 0 THEN
            RETURN v_where;
        END IF;
        RETURN NULL;
    END;
BEGIN
    v_rule_owner := CASE
        WHEN is_null_token(p_rule_owner_name) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_rule_owner_name, 'rule_owner_name')
    END;
    v_rule_model := normalize_identifier(p_rule_model_name, 'rule_model_name');
    v_rule_id := normalize_rule_id(p_rule_id);
    v_target_owner := CASE
        WHEN is_null_token(p_target_owner) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_target_owner, 'target_owner')
    END;
    v_target_table := normalize_identifier(p_target_table, 'target_table');
    v_case_id_col := CASE
        WHEN is_null_token(p_case_id_column_name) THEN NULL
        ELSE normalize_identifier(p_case_id_column_name, 'case_id_column_name')
    END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);
    v_target_object := qualified_name(v_target_owner, v_target_table);

    IF NOT table_exists(v_target_owner, v_target_table) THEN
        RAISE_APPLICATION_ERROR(-20583, 'Target table does not exist: ' || v_target_owner || '.' || v_target_table);
    END IF;

    IF v_case_id_col IS NOT NULL AND column_exists(v_target_owner, v_target_table, v_case_id_col) THEN
        v_case_id_expr := 'SUBSTR(TO_CHAR(T.' || quote_name(v_case_id_col) || '), 1, 4000)';
    ELSE
        v_case_id_expr := 'NULL';
    END IF;

    SELECT UPPER(TRIM(S."RESULT_COLUMN"))
         , DBMS_LOB.SUBSTR(TO_CLOB(S."RESULT_VALUE"), 4000, 1)
         , S."CONDITION_TEXT"
         , S."CONDITION_COUNT"
         , S."RULE_SUPPORT"
         , S."RULE_CONFIDENCE"
         , S."RULE_LIFT"
         , S."SUPPORT_COUNT"
         , S."CONDITION_TOTAL_COUNT"
         , S."RESULT_TOTAL_COUNT"
         , S."TOTAL_COUNT"
      INTO v_result_col
         , v_expected
         , v_condition_text
         , v_condition_count
         , v_rule_support
         , v_rule_confidence
         , v_rule_lift
         , v_support_count
         , v_condition_total_count
         , v_result_total_count
         , v_total_count
      FROM "INIT$_TB_ASSOC_RULE_SUMMARY" S
     WHERE S."OWNER" = v_rule_owner
       AND S."RUN_SOURCE_TYPE" = v_run_source_type
       AND (v_run_source_type = 'DATA_WORK' OR S."RUN_ID" = v_run_id)
       AND S."TARGET_OWNER" = v_target_owner
       AND S."TARGET_TABLE" = v_target_table
       AND S."MODEL_NAME" = v_rule_model
       AND S."RULE_ID" = v_rule_id
       AND S."RESULT_HAS_VALUE_YN" = 'Y'
       AND S."RESULT_COLUMN" IS NOT NULL
       AND S."RESULT_VALUE" IS NOT NULL
       AND S."CONDITION_TEXT" IS NOT NULL
       AND ROWNUM = 1;

    IF NOT column_exists(v_target_owner, v_target_table, v_result_col) THEN
        RAISE_APPLICATION_ERROR(-20584, 'Rule result column does not exist: ' || v_result_col);
    END IF;

    v_condition_where := build_condition_where(v_condition_text);
    IF v_condition_where IS NULL THEN
        RAISE_APPLICATION_ERROR(-20585, 'Rule condition could not be translated to SQL.');
    END IF;

    v_score := NVL(v_rule_confidence, 0) * GREATEST(NVL(v_rule_lift, 1), 1);
    v_sql :=
        'SELECT CAST(NULL AS NUMBER) AS V_VIOLATION_ID' || CHR(10) ||
        '     , ' || sql_literal(v_rule_id) || ' AS V_RULE_ID' || CHR(10) ||
        '     , ' || sql_literal(v_result_col) || ' AS V_RESULT_COLUMN' || CHR(10) ||
        '     , ' || sql_literal(v_expected) || ' AS V_EXPECTED_VALUE' || CHR(10) ||
        '     , SUBSTR(TO_CHAR(T.' || quote_name(v_result_col) || '), 1, 4000) AS V_ACTUAL_VALUE' || CHR(10) ||
        '     , ' || number_literal(v_score) || ' AS V_VIOLATION_SCORE' || CHR(10) ||
        '     , ' || number_literal(v_rule_confidence) || ' AS V_RULE_CONFIDENCE' || CHR(10) ||
        '     , ' || number_literal(v_rule_lift) || ' AS V_RULE_LIFT' || CHR(10) ||
        '     , ' || v_case_id_expr || ' AS V_CASE_ID' || CHR(10) ||
        '     , ' || number_literal(v_condition_count) || ' AS V_CONDITION_COUNT' || CHR(10) ||
        '     , ' || sql_literal(DBMS_LOB.SUBSTR(v_condition_text, 4000, 1)) || ' AS V_CONDITION_TEXT' || CHR(10) ||
        '     , ' || number_literal(v_rule_support) || ' AS V_RULE_SUPPORT' || CHR(10) ||
        '     , ' || number_literal(v_support_count) || ' AS V_SUPPORT_COUNT' || CHR(10) ||
        '     , ' || number_literal(v_condition_total_count) || ' AS V_CONDITION_TOTAL_COUNT' || CHR(10) ||
        '     , ' || number_literal(v_result_total_count) || ' AS V_RESULT_TOTAL_COUNT' || CHR(10) ||
        '     , ' || number_literal(v_total_count) || ' AS V_TOTAL_COUNT' || CHR(10) ||
        '     , T.*' || CHR(10) ||
        '  FROM ' || v_target_object || ' T' || CHR(10) ||
        ' WHERE 1=1' || CHR(10) ||
        '   AND ' || v_condition_where || CHR(10) ||
        '   AND (T.' || quote_name(v_result_col) || ' IS NULL OR TO_CHAR(T.' || quote_name(v_result_col) || ') <> ' || sql_literal(v_expected) || ')' || CHR(10) ||
        ' ORDER BY V_VIOLATION_SCORE DESC NULLS LAST, V_RULE_CONFIDENCE DESC NULLS LAST, V_CASE_ID';

    RETURN v_sql;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20586, 'Rule summary row was not found for realtime violation query.');
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_SYMBOLIC_RULE_VIOLATION_SQL" (
    p_rule_owner_name       IN VARCHAR2 DEFAULT NULL,
    p_rule_table_name       IN VARCHAR2 DEFAULT 'INIT$_TB_SYMBOLIC_RULE',
    p_rule_id               IN VARCHAR2,
    p_target_owner          IN VARCHAR2 DEFAULT NULL,
    p_target_table          IN VARCHAR2,
    p_case_id_column_name   IN VARCHAR2 DEFAULT 'FILE_ROW_NO',
    p_error_pct_threshold   IN NUMBER   DEFAULT 0.05,
    p_abs_error_threshold   IN NUMBER   DEFAULT NULL,
    p_run_source_type       IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id                IN NUMBER   DEFAULT 0,
    p_max_expression_length IN NUMBER   DEFAULT 8000
) RETURN CLOB AUTHID CURRENT_USER IS
    v_current_schema VARCHAR2(128) := UPPER(SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'));
    v_rule_owner VARCHAR2(128);
    v_rule_table VARCHAR2(128);
    v_rule_id VARCHAR2(128);
    v_target_owner VARCHAR2(128);
    v_target_table VARCHAR2(128);
    v_case_id_col VARCHAR2(128);
    v_case_id_expr VARCHAR2(4000);
    v_target_object VARCHAR2(600);
    v_rule_object VARCHAR2(600);
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;
    v_tolerance_pct NUMBER;
    v_abs_error_threshold NUMBER;
    v_max_expression_length NUMBER;
    v_target_col VARCHAR2(128);
    v_rule_expression CLOB;
    v_rule_feature_columns VARCHAR2(4000);
    v_rule_score NUMBER;
    v_rule_complexity NUMBER;
    v_rule_method VARCHAR2(80);
    v_expr_sql VARCHAR2(32767);
    v_sql CLOB;
    TYPE t_column_cache IS TABLE OF VARCHAR2(1) INDEX BY VARCHAR2(128);
    TYPE t_column_type_cache IS TABLE OF VARCHAR2(128) INDEX BY VARCHAR2(128);
    v_target_column_cache t_column_cache;
    v_target_column_type_cache t_column_type_cache;
    v_target_column_cache_loaded BOOLEAN := FALSE;

    FUNCTION is_null_token(p_value IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_value IS NULL OR TRIM(p_value) IS NULL OR UPPER(TRIM(p_value)) IN ('NULL', '-', 'NONE');
    END;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := UPPER(TRIM(p_value));
    BEGIN
        IF NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20681, 'Invalid ' || p_name || ' parameter.');
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_rule_id(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := TRIM(p_value);
    BEGIN
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Za-z0-9_$#:-]{1,128}$') THEN
            RAISE_APPLICATION_ERROR(-20682, 'Invalid rule_id parameter.');
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION is_current_schema(p_owner IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN UPPER(TRIM(p_owner)) = v_current_schema;
    END;

    FUNCTION quote_name(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_value, '"', '""') || '"';
    END;

    FUNCTION qualified_name(p_owner IN VARCHAR2, p_object IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN quote_name(p_owner) || '.' || quote_name(p_object);
    END;

    FUNCTION sql_literal(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN '''' || REPLACE(p_value, '''', '''''') || '''';
    END;

    FUNCTION number_literal(p_value IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN TO_CHAR(p_value, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
    END;

    FUNCTION table_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        IF is_current_schema(p_owner) THEN
            SELECT COUNT(*)
              INTO v_count
              FROM USER_TABLES
             WHERE TABLE_NAME = p_table;
        ELSE
            SELECT COUNT(*)
              INTO v_count
              FROM ALL_TABLES
             WHERE OWNER = p_owner
               AND TABLE_NAME = p_table;
        END IF;
        RETURN v_count > 0;
    END;

    PROCEDURE load_target_column_cache IS
    BEGIN
        IF v_target_column_cache_loaded THEN
            RETURN;
        END IF;

        v_target_column_cache.DELETE;
        v_target_column_type_cache.DELETE;
        IF is_current_schema(v_target_owner) THEN
            FOR r IN (
                SELECT COLUMN_NAME
                     , DATA_TYPE
                  FROM USER_TAB_COLUMNS
                 WHERE TABLE_NAME = v_target_table
            ) LOOP
                v_target_column_cache(r.COLUMN_NAME) := 'Y';
                v_target_column_type_cache(r.COLUMN_NAME) := r.DATA_TYPE;
            END LOOP;
        ELSE
            FOR r IN (
                SELECT COLUMN_NAME
                     , DATA_TYPE
                  FROM ALL_TAB_COLUMNS
                 WHERE OWNER = v_target_owner
                   AND TABLE_NAME = v_target_table
            ) LOOP
                v_target_column_cache(r.COLUMN_NAME) := 'Y';
                v_target_column_type_cache(r.COLUMN_NAME) := r.DATA_TYPE;
            END LOOP;
        END IF;
        v_target_column_cache_loaded := TRUE;
    END;

    FUNCTION column_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2, p_column IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        IF p_column IS NULL THEN
            RETURN FALSE;
        END IF;

        IF UPPER(TRIM(p_owner)) = v_target_owner
           AND UPPER(TRIM(p_table)) = v_target_table THEN
            load_target_column_cache;
            RETURN v_target_column_cache.EXISTS(UPPER(TRIM(p_column)));
        END IF;

        IF is_current_schema(p_owner) THEN
            SELECT COUNT(*)
              INTO v_count
              FROM USER_TAB_COLUMNS
             WHERE TABLE_NAME = p_table
               AND COLUMN_NAME = p_column;
        ELSE
            SELECT COUNT(*)
              INTO v_count
              FROM ALL_TAB_COLUMNS
             WHERE OWNER = p_owner
               AND TABLE_NAME = p_table
               AND COLUMN_NAME = p_column;
        END IF;
        RETURN v_count > 0;
    END;

    FUNCTION numeric_column_expr(p_column IN VARCHAR2, p_alias IN VARCHAR2 DEFAULT 'T') RETURN VARCHAR2 IS
        v_column VARCHAR2(128) := UPPER(TRIM(p_column));
        v_data_type VARCHAR2(128);
        v_ref VARCHAR2(4000);
    BEGIN
        load_target_column_cache;
        v_data_type := UPPER(NVL(v_target_column_type_cache(v_column), ''));
        v_ref := CASE
            WHEN p_alias IS NULL OR TRIM(p_alias) IS NULL THEN quote_name(v_column)
            ELSE p_alias || '.' || quote_name(v_column)
        END;
        IF v_data_type IN ('NUMBER', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'FLOAT') THEN
            RETURN v_ref;
        END IF;
        RETURN 'TO_NUMBER(NULLIF(TRIM(TO_CHAR(' || v_ref || ')), '''') DEFAULT NULL ON CONVERSION ERROR)';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_ref := CASE
                WHEN p_alias IS NULL OR TRIM(p_alias) IS NULL THEN quote_name(v_column)
                ELSE p_alias || '.' || quote_name(v_column)
            END;
            RETURN 'TO_NUMBER(NULLIF(TRIM(TO_CHAR(' || v_ref || ')), '''') DEFAULT NULL ON CONVERSION ERROR)';
    END;

    FUNCTION is_identifier_char(p_char IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_char IS NOT NULL
           AND INSTR('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$#', UPPER(SUBSTR(p_char, 1, 1))) > 0;
    END;

    FUNCTION is_alpha_char(p_char IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_char IS NOT NULL
           AND INSTR('ABCDEFGHIJKLMNOPQRSTUVWXYZ', UPPER(SUBSTR(p_char, 1, 1))) > 0;
    END;

    FUNCTION is_allowed_expr_token(p_token IN VARCHAR2) RETURN BOOLEAN IS
        v_token VARCHAR2(128) := UPPER(TRIM(p_token));
    BEGIN
        RETURN v_token IN (
            'T',
            'TO_NUMBER',
            'POWER',
            'SQRT',
            'ABS',
            'LN',
            'EXP',
            'SIN',
            'COS',
            'TAN',
            'NULLIF',
            'TRIM',
            'TO_CHAR',
            'DEFAULT',
            'ON',
            'CONVERSION',
            'ERROR',
            'NULL'
        );
    END;

    FUNCTION has_blocked_expr_char(p_expr IN VARCHAR2) RETURN BOOLEAN IS
        v_char VARCHAR2(1);
    BEGIN
        IF p_expr IS NULL THEN
            RETURN TRUE;
        END IF;
        FOR i IN 1 .. LENGTH(p_expr) LOOP
            v_char := SUBSTR(p_expr, i, 1);
            IF INSTR('''";[]{}', v_char) > 0 THEN
                RETURN TRUE;
            END IF;
        END LOOP;
        RETURN FALSE;
    END;

    FUNCTION has_unknown_expression_token(p_expr IN VARCHAR2) RETURN BOOLEAN IS
        v_pos PLS_INTEGER := 1;
        v_len PLS_INTEGER := NVL(LENGTH(p_expr), 0);
        v_char VARCHAR2(1);
        v_start PLS_INTEGER;
        v_token VARCHAR2(128);
    BEGIN
        WHILE v_pos <= v_len LOOP
            v_char := SUBSTR(p_expr, v_pos, 1);
            IF v_char = '"' THEN
                v_pos := v_pos + 1;
                WHILE v_pos <= v_len AND SUBSTR(p_expr, v_pos, 1) <> '"' LOOP
                    v_pos := v_pos + 1;
                END LOOP;
                v_pos := v_pos + 1;
            ELSIF is_alpha_char(v_char) THEN
                v_start := v_pos;
                WHILE v_pos <= v_len AND is_identifier_char(SUBSTR(p_expr, v_pos, 1)) LOOP
                    v_pos := v_pos + 1;
                END LOOP;
                v_token := SUBSTR(p_expr, v_start, v_pos - v_start);
                IF NOT is_allowed_expr_token(v_token) THEN
                    RETURN TRUE;
                END IF;
            ELSE
                v_pos := v_pos + 1;
            END IF;
        END LOOP;
        RETURN FALSE;
    END;

    FUNCTION replace_identifier_expr(
        p_expr IN VARCHAR2,
        p_identifier IN VARCHAR2,
        p_replacement IN VARCHAR2
    ) RETURN VARCHAR2 IS
        v_source VARCHAR2(32767) := p_expr;
        v_upper_source VARCHAR2(32767) := UPPER(p_expr);
        v_identifier VARCHAR2(128) := UPPER(TRIM(p_identifier));
        v_identifier_len PLS_INTEGER := LENGTH(UPPER(TRIM(p_identifier)));
        v_pos PLS_INTEGER := 1;
        v_found PLS_INTEGER;
        v_result VARCHAR2(32767) := '';
        v_prev_char VARCHAR2(1);
        v_next_char VARCHAR2(1);
    BEGIN
        IF v_source IS NULL OR v_identifier IS NULL OR v_identifier_len = 0 THEN
            RETURN v_source;
        END IF;

        LOOP
            v_found := INSTR(v_upper_source, v_identifier, v_pos);
            EXIT WHEN v_found = 0;

            v_prev_char := CASE WHEN v_found > 1 THEN SUBSTR(v_source, v_found - 1, 1) END;
            v_next_char := CASE
                WHEN v_found + v_identifier_len <= LENGTH(v_source) THEN SUBSTR(v_source, v_found + v_identifier_len, 1)
            END;

            IF NOT is_identifier_char(v_prev_char) AND NOT is_identifier_char(v_next_char) THEN
                IF NVL(LENGTH(v_result), 0) + (v_found - v_pos) + NVL(LENGTH(p_replacement), 0) > 32767 THEN
                    RETURN NULL;
                END IF;
                v_result := v_result || SUBSTR(v_source, v_pos, v_found - v_pos) || p_replacement;
                v_pos := v_found + v_identifier_len;
            ELSE
                IF NVL(LENGTH(v_result), 0) + (v_found - v_pos + v_identifier_len) > 32767 THEN
                    RETURN NULL;
                END IF;
                v_result := v_result || SUBSTR(v_source, v_pos, v_found - v_pos + v_identifier_len);
                v_pos := v_found + v_identifier_len;
            END IF;
        END LOOP;

        IF NVL(LENGTH(v_result), 0) + NVL(LENGTH(SUBSTR(v_source, v_pos)), 0) > 32767 THEN
            RETURN NULL;
        END IF;
        RETURN v_result || SUBSTR(v_source, v_pos);
    END;

    FUNCTION protect_division_denominators(p_expr IN VARCHAR2) RETURN VARCHAR2 IS
        v_source VARCHAR2(32767) := p_expr;
        v_result VARCHAR2(32767) := '';
        v_pos PLS_INTEGER := 1;
        v_len PLS_INTEGER := NVL(LENGTH(p_expr), 0);
        v_start PLS_INTEGER;
        v_end PLS_INTEGER;
        v_scan PLS_INTEGER;
        v_char VARCHAR2(1);
        v_spaces VARCHAR2(4000);
        v_denom VARCHAR2(32767);

        FUNCTION find_balanced_end(p_start IN PLS_INTEGER) RETURN PLS_INTEGER IS
            v_i PLS_INTEGER := p_start;
            v_level PLS_INTEGER := 0;
            v_c VARCHAR2(1);
        BEGIN
            WHILE v_i <= v_len LOOP
                v_c := SUBSTR(v_source, v_i, 1);
                IF v_c = '(' THEN
                    v_level := v_level + 1;
                ELSIF v_c = ')' THEN
                    v_level := v_level - 1;
                    IF v_level = 0 THEN
                        RETURN v_i;
                    END IF;
                END IF;
                v_i := v_i + 1;
            END LOOP;
            RETURN NULL;
        END;

        PROCEDURE append_text(p_text IN VARCHAR2) IS
        BEGIN
            IF NVL(LENGTH(v_result), 0) + NVL(LENGTH(p_text), 0) > 32767 THEN
                v_result := NULL;
            ELSE
                v_result := v_result || p_text;
            END IF;
        END;
    BEGIN
        IF v_source IS NULL OR INSTR(v_source, '/') = 0 THEN
            RETURN v_source;
        END IF;

        WHILE v_pos <= v_len LOOP
            v_char := SUBSTR(v_source, v_pos, 1);
            IF v_char <> '/' THEN
                append_text(v_char);
                IF v_result IS NULL THEN
                    RETURN NULL;
                END IF;
                v_pos := v_pos + 1;
                CONTINUE;
            END IF;

            append_text('/');
            IF v_result IS NULL THEN
                RETURN NULL;
            END IF;
            v_pos := v_pos + 1;
            v_spaces := '';
            WHILE v_pos <= v_len AND SUBSTR(v_source, v_pos, 1) IN (' ', CHR(9), CHR(10), CHR(13)) LOOP
                v_spaces := v_spaces || SUBSTR(v_source, v_pos, 1);
                v_pos := v_pos + 1;
            END LOOP;

            IF v_pos > v_len THEN
                append_text(v_spaces);
                RETURN v_result;
            END IF;

            v_start := v_pos;
            v_char := SUBSTR(v_source, v_pos, 1);
            IF v_char = '(' THEN
                v_end := find_balanced_end(v_pos);
            ELSIF v_char = '"' THEN
                v_scan := v_pos + 1;
                WHILE v_scan <= v_len LOOP
                    IF SUBSTR(v_source, v_scan, 1) = '"' THEN
                        EXIT;
                    END IF;
                    v_scan := v_scan + 1;
                END LOOP;
                v_end := LEAST(v_scan, v_len);
            ELSIF is_alpha_char(v_char) THEN
                v_scan := v_pos;
                WHILE v_scan <= v_len AND is_identifier_char(SUBSTR(v_source, v_scan, 1)) LOOP
                    v_scan := v_scan + 1;
                END LOOP;
                v_end := v_scan - 1;
                WHILE v_scan <= v_len AND SUBSTR(v_source, v_scan, 1) IN (' ', CHR(9), CHR(10), CHR(13)) LOOP
                    v_scan := v_scan + 1;
                END LOOP;
                IF v_scan <= v_len AND SUBSTR(v_source, v_scan, 1) = '(' THEN
                    v_end := find_balanced_end(v_scan);
                END IF;
            ELSIF INSTR('+-0123456789.', v_char) > 0 THEN
                v_scan := v_pos;
                IF SUBSTR(v_source, v_scan, 1) IN ('+', '-') THEN
                    v_scan := v_scan + 1;
                END IF;
                WHILE v_scan <= v_len
                  AND REGEXP_LIKE(SUBSTR(v_source, v_scan, 1), '[0-9.]')
                LOOP
                    v_scan := v_scan + 1;
                END LOOP;
                IF v_scan <= v_len AND UPPER(SUBSTR(v_source, v_scan, 1)) = 'E' THEN
                    v_scan := v_scan + 1;
                    IF v_scan <= v_len AND SUBSTR(v_source, v_scan, 1) IN ('+', '-') THEN
                        v_scan := v_scan + 1;
                    END IF;
                    WHILE v_scan <= v_len
                      AND REGEXP_LIKE(SUBSTR(v_source, v_scan, 1), '[0-9]')
                    LOOP
                        v_scan := v_scan + 1;
                    END LOOP;
                END IF;
                v_end := v_scan - 1;
            ELSE
                append_text(v_spaces || v_char);
                IF v_result IS NULL THEN
                    RETURN NULL;
                END IF;
                v_pos := v_pos + 1;
                CONTINUE;
            END IF;

            IF v_end IS NULL OR v_end < v_start THEN
                RETURN NULL;
            END IF;
            v_denom := SUBSTR(v_source, v_start, v_end - v_start + 1);
            IF UPPER(TRIM(v_denom)) LIKE 'NULLIF(%' THEN
                append_text(v_spaces || v_denom);
            ELSE
                append_text(v_spaces || 'NULLIF(' || v_denom || ', 0)');
            END IF;
            IF v_result IS NULL THEN
                RETURN NULL;
            END IF;
            v_pos := v_end + 1;
        END LOOP;

        RETURN v_result;
    END;

    FUNCTION translate_expression(
        p_expression IN CLOB,
        p_feature_columns IN VARCHAR2
    ) RETURN VARCHAR2 IS
        v_expr VARCHAR2(32767);
        v_rest VARCHAR2(32767) := p_feature_columns || ',';
        v_token VARCHAR2(4000);
        v_pos PLS_INTEGER;
        v_col VARCHAR2(128);
        v_replacement VARCHAR2(4000);
        v_feature_count PLS_INTEGER := 0;
    BEGIN
        IF p_expression IS NULL THEN
            RETURN NULL;
        END IF;
        IF v_max_expression_length IS NOT NULL
           AND DBMS_LOB.GETLENGTH(p_expression) > v_max_expression_length THEN
            RETURN NULL;
        END IF;
        v_expr := TRIM(DBMS_LOB.SUBSTR(p_expression, 32767, 1));
        IF INSTR(v_expr, '=') > 0 THEN
            v_expr := TRIM(SUBSTR(v_expr, INSTR(v_expr, '=', -1) + 1));
        END IF;
        IF has_blocked_expr_char(v_expr) OR INSTR(v_expr, '**') > 0 THEN
            RETURN NULL;
        END IF;

        LOOP
            EXIT WHEN v_rest IS NULL;
            v_pos := INSTR(v_rest, ',');
            EXIT WHEN v_pos IS NULL OR v_pos = 0;
            v_token := TRIM(SUBSTR(v_rest, 1, v_pos - 1));
            v_rest := SUBSTR(v_rest, v_pos + 1);
            IF v_token IS NULL THEN
                CONTINUE;
            END IF;

            v_col := normalize_identifier(v_token, 'feature column');
            IF v_feature_count >= 200 THEN
                RETURN NULL;
            END IF;
            IF NOT column_exists(v_target_owner, v_target_table, v_col) THEN
                RETURN NULL;
            END IF;
            v_replacement := numeric_column_expr(v_col, NULL);
            v_expr := replace_identifier_expr(v_expr, v_col, v_replacement);
            IF v_expr IS NULL THEN
                RETURN NULL;
            END IF;
            v_feature_count := v_feature_count + 1;
        END LOOP;

        IF v_feature_count = 0 OR has_unknown_expression_token(v_expr) THEN
            RETURN NULL;
        END IF;
        v_expr := protect_division_denominators(v_expr);
        IF v_expr IS NULL THEN
            RETURN NULL;
        END IF;
        IF v_max_expression_length IS NOT NULL
           AND LENGTH(v_expr) > v_max_expression_length THEN
            RETURN NULL;
        END IF;
        RETURN v_expr;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;
BEGIN
    v_rule_owner := CASE
        WHEN is_null_token(p_rule_owner_name) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_rule_owner_name, 'rule_owner_name')
    END;
    v_rule_table := normalize_identifier(NVL(p_rule_table_name, 'INIT$_TB_SYMBOLIC_RULE'), 'rule_table_name');
    v_rule_id := normalize_rule_id(p_rule_id);
    v_target_owner := CASE
        WHEN is_null_token(p_target_owner) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_target_owner, 'target_owner')
    END;
    v_target_table := normalize_identifier(p_target_table, 'target_table');
    v_case_id_col := CASE
        WHEN is_null_token(p_case_id_column_name) THEN NULL
        ELSE normalize_identifier(p_case_id_column_name, 'case_id_column_name')
    END;
    v_tolerance_pct := NVL(p_error_pct_threshold, 0.05);
    IF v_tolerance_pct > 1 THEN
        v_tolerance_pct := v_tolerance_pct / 100;
    END IF;
    v_tolerance_pct := GREATEST(0, LEAST(1, v_tolerance_pct));
    v_abs_error_threshold := CASE WHEN p_abs_error_threshold IS NULL THEN NULL ELSE GREATEST(0, p_abs_error_threshold) END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);
    v_max_expression_length := CASE
        WHEN p_max_expression_length IS NULL THEN 8000
        WHEN p_max_expression_length <= 0 THEN NULL
        ELSE GREATEST(1000, LEAST(32767, p_max_expression_length))
    END;
    v_target_object := qualified_name(v_target_owner, v_target_table);
    v_rule_object := qualified_name(v_rule_owner, v_rule_table);

    IF NOT table_exists(v_target_owner, v_target_table) THEN
        RAISE_APPLICATION_ERROR(-20683, 'Target table does not exist: ' || v_target_owner || '.' || v_target_table);
    END IF;
    IF NOT table_exists(v_rule_owner, v_rule_table) THEN
        RAISE_APPLICATION_ERROR(-20684, 'Symbolic rule table does not exist: ' || v_rule_owner || '.' || v_rule_table);
    END IF;
    load_target_column_cache;

    IF v_case_id_col IS NOT NULL AND column_exists(v_target_owner, v_target_table, v_case_id_col) THEN
        v_case_id_expr := 'SUBSTR(TO_CHAR(T.' || quote_name(v_case_id_col) || '), 1, 4000)';
    ELSE
        v_case_id_expr := 'NULL';
    END IF;

    EXECUTE IMMEDIATE
        'SELECT R."TARGET_COLUMN", R."EXPRESSION", R."FEATURE_COLUMNS", R."SCORE", R."COMPLEXITY", R."METHOD" ' ||
        '  FROM ' || v_rule_object || ' R ' ||
        ' WHERE R."RUN_SOURCE_TYPE" = :run_source_type ' ||
        '   AND (:run_source_type = ''DATA_WORK'' OR R."RUN_ID" = :run_id) ' ||
        '   AND R."OWNER" = :target_owner ' ||
        '   AND R."TABLE_NAME" = :target_table ' ||
        '   AND R."RULE_ID" = :rule_id ' ||
        '   AND R."EXPRESSION" IS NOT NULL ' ||
        '   AND R."FEATURE_COLUMNS" IS NOT NULL ' ||
        '   AND ROWNUM = 1'
        INTO v_target_col, v_rule_expression, v_rule_feature_columns, v_rule_score, v_rule_complexity, v_rule_method
        USING v_run_source_type, v_run_source_type, v_run_id, v_target_owner, v_target_table, v_rule_id;

    v_target_col := normalize_identifier(v_target_col, 'target_column');
    IF NOT column_exists(v_target_owner, v_target_table, v_target_col) THEN
        RAISE_APPLICATION_ERROR(-20685, 'Rule target column does not exist: ' || v_target_col);
    END IF;

    v_expr_sql := translate_expression(v_rule_expression, v_rule_feature_columns);
    IF v_expr_sql IS NULL THEN
        RAISE_APPLICATION_ERROR(-20686, 'Symbolic expression could not be translated to SQL.');
    END IF;

    v_sql :=
        'SELECT CAST(NULL AS NUMBER) AS V_VIOLATION_ID' || CHR(10) ||
        '     , ' || sql_literal(v_rule_id) || ' AS V_RULE_ID' || CHR(10) ||
        '     , ' || sql_literal(v_target_col) || ' AS V_TARGET_COLUMN' || CHR(10) ||
        '     , Q.PREDICTED_VALUE AS V_PREDICTED_VALUE' || CHR(10) ||
        '     , Q.ACTUAL_VALUE AS V_ACTUAL_VALUE' || CHR(10) ||
        '     , Q.LOWER_BOUND AS V_LOWER_BOUND' || CHR(10) ||
        '     , Q.UPPER_BOUND AS V_UPPER_BOUND' || CHR(10) ||
        '     , Q.ABS_ERROR AS V_ABS_ERROR' || CHR(10) ||
        '     , Q.ERROR_PCT AS V_ERROR_PCT' || CHR(10) ||
        '     , NVL(Q.ERROR_PCT, Q.ABS_ERROR) AS V_VIOLATION_SCORE' || CHR(10) ||
        '     , Q.CASE_ID AS V_CASE_ID' || CHR(10) ||
        '     , T.*' || CHR(10) ||
        '  FROM (' || CHR(10) ||
        '        SELECT P.CASE_ID' || CHR(10) ||
        '             , P.CASE_ROWID' || CHR(10) ||
        '             , P.PREDICTED_VALUE' || CHR(10) ||
        '             , P.ACTUAL_VALUE' || CHR(10) ||
        '             , P.PREDICTED_VALUE - ABS(P.PREDICTED_VALUE) * ' || number_literal(v_tolerance_pct) || ' AS LOWER_BOUND' || CHR(10) ||
        '             , P.PREDICTED_VALUE + ABS(P.PREDICTED_VALUE) * ' || number_literal(v_tolerance_pct) || ' AS UPPER_BOUND' || CHR(10) ||
        '             , ABS(P.ACTUAL_VALUE - P.PREDICTED_VALUE) AS ABS_ERROR' || CHR(10) ||
        '             , CASE WHEN ABS(P.PREDICTED_VALUE) > 0 THEN ABS(P.ACTUAL_VALUE - P.PREDICTED_VALUE) / ABS(P.PREDICTED_VALUE) END AS ERROR_PCT' || CHR(10) ||
        '          FROM (' || CHR(10) ||
        '                SELECT /*+ NO_PARALLEL */ ' || v_case_id_expr || ' AS CASE_ID' || CHR(10) ||
        '                     , ROWIDTOCHAR(T.ROWID) AS CASE_ROWID' || CHR(10) ||
        '                     , (' || v_expr_sql || ') AS PREDICTED_VALUE' || CHR(10) ||
        '                     , ' || numeric_column_expr(v_target_col, 'T') || ' AS ACTUAL_VALUE' || CHR(10) ||
        '                  FROM ' || v_target_object || ' T' || CHR(10) ||
        '               ) P' || CHR(10) ||
        '         WHERE 1=1' || CHR(10) ||
        '           AND P.PREDICTED_VALUE IS NOT NULL' || CHR(10) ||
        '           AND P.ACTUAL_VALUE IS NOT NULL' || CHR(10) ||
        '       ) Q' || CHR(10) ||
        '  JOIN ' || v_target_object || ' T' || CHR(10) ||
        '    ON ROWIDTOCHAR(T.ROWID) = Q.CASE_ROWID' || CHR(10) ||
        ' WHERE 1=1' || CHR(10) ||
        '   AND (' || CHR(10) ||
        '        (ABS(Q.PREDICTED_VALUE) > 0 AND Q.ERROR_PCT > ' || number_literal(v_tolerance_pct) || ')' || CHR(10) ||
        '        OR (ABS(Q.PREDICTED_VALUE) = 0 AND Q.ABS_ERROR > ' || number_literal(NVL(v_abs_error_threshold, v_tolerance_pct)) || ')' || CHR(10);

    IF v_abs_error_threshold IS NOT NULL THEN
        v_sql := v_sql || '        OR Q.ABS_ERROR > ' || number_literal(v_abs_error_threshold) || CHR(10);
    END IF;

    v_sql := v_sql ||
        '       )' || CHR(10) ||
        ' ORDER BY V_VIOLATION_SCORE DESC NULLS LAST, V_ERROR_PCT DESC NULLS LAST, V_ABS_ERROR DESC NULLS LAST, V_CASE_ID';

    RETURN v_sql;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20687, 'Symbolic rule row was not found for realtime violation query.');
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_SYMBOLIC_RULE_VIOLATION_DETECT" (
    p_rule_owner_name         IN VARCHAR2 DEFAULT NULL,
    p_rule_table_name         IN VARCHAR2 DEFAULT 'INIT$_TB_SYMBOLIC_RULE',
    p_rule_id                 IN VARCHAR2 DEFAULT NULL,
    p_target_owner            IN VARCHAR2 DEFAULT NULL,
    p_target_table            IN VARCHAR2,
    p_case_id_column_name     IN VARCHAR2 DEFAULT 'FILE_ROW_NO',
    p_result_owner            IN VARCHAR2 DEFAULT NULL,
    p_result_table            IN VARCHAR2 DEFAULT 'INIT$_TB_SYMBOLIC_RULE_VIOLATION',
    p_error_pct_threshold     IN NUMBER   DEFAULT 0.05,
    p_abs_error_threshold     IN NUMBER   DEFAULT NULL,
    p_max_rules               IN NUMBER   DEFAULT 50,
    p_max_violations_per_rule IN NUMBER   DEFAULT 200,
    p_clear_existing_yn       IN VARCHAR2 DEFAULT 'Y',
    p_commit_interval         IN NUMBER   DEFAULT 1000,
    p_commit_yn               IN VARCHAR2 DEFAULT 'Y',
    p_run_source_type         IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id                  IN NUMBER   DEFAULT 0,
    p_max_scan_rows           IN NUMBER   DEFAULT 50000,
    p_max_elapsed_seconds     IN NUMBER   DEFAULT 1800,
    p_max_expression_length   IN NUMBER   DEFAULT 8000
) AUTHID CURRENT_USER IS
    v_current_schema VARCHAR2(128) := UPPER(SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'));
    v_rule_owner VARCHAR2(128);
    v_rule_table VARCHAR2(128);
    v_rule_id VARCHAR2(128);
    v_target_owner VARCHAR2(128);
    v_target_table VARCHAR2(128);
    v_result_owner VARCHAR2(128);
    v_result_table VARCHAR2(128);
    v_case_id_col VARCHAR2(128);
    v_case_id_expr VARCHAR2(4000);
    v_target_object VARCHAR2(600);
    v_rule_object VARCHAR2(600);
    v_result_object VARCHAR2(600);
    v_clear_existing VARCHAR2(1);
    v_commit VARCHAR2(1);
    v_tolerance_pct NUMBER;
    v_abs_error_threshold NUMBER;
    v_max_rules NUMBER;
    v_max_violations_per_rule NUMBER;
    v_max_scan_rows NUMBER;
    v_max_elapsed_seconds NUMBER;
    v_max_expression_length NUMBER;
    v_commit_interval NUMBER;
    v_delete_batch_size NUMBER;
    v_pending_dml_count NUMBER := 0;
    v_deleted_count NUMBER := 0;
    v_deleted_chunk NUMBER := 0;
    v_inserted_total NUMBER := 0;
    v_skipped_total NUMBER := 0;
    v_committed_chunks NUMBER := 0;
    v_processed_rules NUMBER := 0;
    v_rule_total NUMBER := 0;
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;
    v_rule_filter_sql VARCHAR2(32767);
    v_rule_total_sql VARCHAR2(32767);
    v_rule_cursor SYS_REFCURSOR;
    v_rule_item_id VARCHAR2(128);
    v_rule_target_column VARCHAR2(128);
    v_rule_expression CLOB;
    v_rule_feature_columns VARCHAR2(4000);
    v_rule_score NUMBER;
    v_rule_complexity NUMBER;
    v_rule_method VARCHAR2(80);
    TYPE t_column_cache IS TABLE OF VARCHAR2(1) INDEX BY VARCHAR2(128);
    TYPE t_column_type_cache IS TABLE OF VARCHAR2(128) INDEX BY VARCHAR2(128);
    v_target_column_cache t_column_cache;
    v_target_column_type_cache t_column_type_cache;
    v_target_column_cache_loaded BOOLEAN := FALSE;
    v_started_at DATE := SYSDATE;
    v_stop_requested BOOLEAN := FALSE;

    FUNCTION is_null_token(p_value IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_value IS NULL OR TRIM(p_value) IS NULL OR UPPER(TRIM(p_value)) IN ('NULL', '-', 'NONE');
    END;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := UPPER(TRIM(p_value));
    BEGIN
        IF NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20601, 'Invalid ' || p_name || ' parameter.');
        END IF;
        RETURN v_value;
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION is_current_schema(p_owner IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN UPPER(TRIM(p_owner)) = v_current_schema;
    END;

    FUNCTION quote_name(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_value, '"', '""') || '"';
    END;

    FUNCTION qualified_name(p_owner IN VARCHAR2, p_object IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN quote_name(p_owner) || '.' || quote_name(p_object);
    END;

    FUNCTION sql_literal(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN '''' || REPLACE(p_value, '''', '''''') || '''';
    END;

    FUNCTION number_literal(p_value IN NUMBER, p_default IN NUMBER DEFAULT 0) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN TO_CHAR(NVL(p_value, p_default), 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
    END;

    FUNCTION table_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        IF is_current_schema(p_owner) THEN
            SELECT COUNT(*)
              INTO v_count
              FROM USER_TABLES
             WHERE TABLE_NAME = p_table;
        ELSE
            SELECT COUNT(*)
              INTO v_count
              FROM ALL_TABLES
             WHERE OWNER = p_owner
               AND TABLE_NAME = p_table;
        END IF;
        RETURN v_count > 0;
    END;

    PROCEDURE load_target_column_cache IS
    BEGIN
        IF v_target_column_cache_loaded THEN
            RETURN;
        END IF;

        v_target_column_cache.DELETE;
        v_target_column_type_cache.DELETE;
        IF is_current_schema(v_target_owner) THEN
            FOR r IN (
                SELECT COLUMN_NAME
                     , DATA_TYPE
                  FROM USER_TAB_COLUMNS
                 WHERE TABLE_NAME = v_target_table
            ) LOOP
                v_target_column_cache(r.COLUMN_NAME) := 'Y';
                v_target_column_type_cache(r.COLUMN_NAME) := r.DATA_TYPE;
            END LOOP;
        ELSE
            FOR r IN (
                SELECT COLUMN_NAME
                     , DATA_TYPE
                  FROM ALL_TAB_COLUMNS
                 WHERE OWNER = v_target_owner
                   AND TABLE_NAME = v_target_table
            ) LOOP
                v_target_column_cache(r.COLUMN_NAME) := 'Y';
                v_target_column_type_cache(r.COLUMN_NAME) := r.DATA_TYPE;
            END LOOP;
        END IF;
        v_target_column_cache_loaded := TRUE;
    END;

    FUNCTION column_exists(p_owner IN VARCHAR2, p_table IN VARCHAR2, p_column IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        IF p_column IS NULL THEN
            RETURN FALSE;
        END IF;

        IF UPPER(TRIM(p_owner)) = v_target_owner
           AND UPPER(TRIM(p_table)) = v_target_table THEN
            load_target_column_cache;
            RETURN v_target_column_cache.EXISTS(UPPER(TRIM(p_column)));
        END IF;

        IF is_current_schema(p_owner) THEN
            SELECT COUNT(*)
              INTO v_count
              FROM USER_TAB_COLUMNS
             WHERE TABLE_NAME = p_table
               AND COLUMN_NAME = p_column;
        ELSE
            SELECT COUNT(*)
              INTO v_count
              FROM ALL_TAB_COLUMNS
             WHERE OWNER = p_owner
               AND TABLE_NAME = p_table
               AND COLUMN_NAME = p_column;
        END IF;
        RETURN v_count > 0;
    END;

    FUNCTION numeric_column_expr(p_column IN VARCHAR2) RETURN VARCHAR2 IS
        v_column VARCHAR2(128) := UPPER(TRIM(p_column));
        v_data_type VARCHAR2(128);
    BEGIN
        load_target_column_cache;
        v_data_type := UPPER(NVL(v_target_column_type_cache(v_column), ''));
        IF v_data_type IN ('NUMBER', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'FLOAT') THEN
            RETURN quote_name(v_column);
        END IF;
        RETURN 'TO_NUMBER(NULLIF(TRIM(TO_CHAR(' || quote_name(v_column) || ')), '''') DEFAULT NULL ON CONVERSION ERROR)';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN 'TO_NUMBER(NULLIF(TRIM(TO_CHAR(' || quote_name(v_column) || ')), '''') DEFAULT NULL ON CONVERSION ERROR)';
    END;

    FUNCTION is_identifier_char(p_char IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_char IS NOT NULL
           AND INSTR('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$#', UPPER(SUBSTR(p_char, 1, 1))) > 0;
    END;

    FUNCTION is_alpha_char(p_char IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_char IS NOT NULL
           AND INSTR('ABCDEFGHIJKLMNOPQRSTUVWXYZ', UPPER(SUBSTR(p_char, 1, 1))) > 0;
    END;

    FUNCTION is_allowed_expr_token(p_token IN VARCHAR2) RETURN BOOLEAN IS
        v_token VARCHAR2(128) := UPPER(TRIM(p_token));
    BEGIN
        RETURN v_token IN (
            'TO_NUMBER',
            'POWER',
            'SQRT',
            'ABS',
            'LN',
            'EXP',
            'SIN',
            'COS',
            'TAN',
            'NULLIF',
            'TRIM',
            'TO_CHAR',
            'DEFAULT',
            'ON',
            'CONVERSION',
            'ERROR',
            'NULL'
        );
    END;

    FUNCTION has_blocked_expr_char(p_expr IN VARCHAR2) RETURN BOOLEAN IS
        v_char VARCHAR2(1);
    BEGIN
        IF p_expr IS NULL THEN
            RETURN TRUE;
        END IF;
        FOR i IN 1 .. LENGTH(p_expr) LOOP
            v_char := SUBSTR(p_expr, i, 1);
            IF INSTR('''";[]{}', v_char) > 0 THEN
                RETURN TRUE;
            END IF;
        END LOOP;
        RETURN FALSE;
    END;

    FUNCTION has_unknown_expression_token(p_expr IN VARCHAR2) RETURN BOOLEAN IS
        v_pos PLS_INTEGER := 1;
        v_len PLS_INTEGER := NVL(LENGTH(p_expr), 0);
        v_char VARCHAR2(1);
        v_start PLS_INTEGER;
        v_token VARCHAR2(128);
    BEGIN
        WHILE v_pos <= v_len LOOP
            v_char := SUBSTR(p_expr, v_pos, 1);
            IF v_char = '"' THEN
                v_pos := v_pos + 1;
                WHILE v_pos <= v_len AND SUBSTR(p_expr, v_pos, 1) <> '"' LOOP
                    v_pos := v_pos + 1;
                END LOOP;
                v_pos := v_pos + 1;
            ELSIF is_alpha_char(v_char) THEN
                v_start := v_pos;
                WHILE v_pos <= v_len AND is_identifier_char(SUBSTR(p_expr, v_pos, 1)) LOOP
                    v_pos := v_pos + 1;
                END LOOP;
                v_token := SUBSTR(p_expr, v_start, v_pos - v_start);
                IF NOT is_allowed_expr_token(v_token) THEN
                    RETURN TRUE;
                END IF;
            ELSE
                v_pos := v_pos + 1;
            END IF;
        END LOOP;
        RETURN FALSE;
    END;

    FUNCTION is_complex_symbolic_expression(p_expr IN VARCHAR2) RETURN BOOLEAN IS
        v_expr VARCHAR2(32767) := UPPER(NVL(p_expr, ''));
    BEGIN
        RETURN INSTR(v_expr, 'POWER(') > 0
            OR INSTR(v_expr, 'SQRT(') > 0
            OR INSTR(v_expr, 'ABS(') > 0
            OR INSTR(v_expr, 'LN(') > 0
            OR INSTR(v_expr, 'EXP(') > 0
            OR INSTR(v_expr, 'SIN(') > 0
            OR INSTR(v_expr, 'COS(') > 0
            OR INSTR(v_expr, 'TAN(') > 0
            OR INSTR(v_expr, '**') > 0;
    END;

    FUNCTION replace_identifier_expr(
        p_expr IN VARCHAR2,
        p_identifier IN VARCHAR2,
        p_replacement IN VARCHAR2
    ) RETURN VARCHAR2 IS
        v_source VARCHAR2(32767) := p_expr;
        v_upper_source VARCHAR2(32767) := UPPER(p_expr);
        v_identifier VARCHAR2(128) := UPPER(TRIM(p_identifier));
        v_identifier_len PLS_INTEGER := LENGTH(UPPER(TRIM(p_identifier)));
        v_pos PLS_INTEGER := 1;
        v_found PLS_INTEGER;
        v_result VARCHAR2(32767) := '';
        v_prev_char VARCHAR2(1);
        v_next_char VARCHAR2(1);
    BEGIN
        IF v_source IS NULL OR v_identifier IS NULL OR v_identifier_len = 0 THEN
            RETURN v_source;
        END IF;

        LOOP
            v_found := INSTR(v_upper_source, v_identifier, v_pos);
            EXIT WHEN v_found = 0;

            v_prev_char := CASE WHEN v_found > 1 THEN SUBSTR(v_source, v_found - 1, 1) END;
            v_next_char := CASE
                WHEN v_found + v_identifier_len <= LENGTH(v_source) THEN SUBSTR(v_source, v_found + v_identifier_len, 1)
            END;

            IF NOT is_identifier_char(v_prev_char) AND NOT is_identifier_char(v_next_char) THEN
                IF NVL(LENGTH(v_result), 0) + (v_found - v_pos) + NVL(LENGTH(p_replacement), 0) > 32767 THEN
                    RETURN NULL;
                END IF;
                v_result := v_result || SUBSTR(v_source, v_pos, v_found - v_pos) || p_replacement;
                v_pos := v_found + v_identifier_len;
            ELSE
                IF NVL(LENGTH(v_result), 0) + (v_found - v_pos + v_identifier_len) > 32767 THEN
                    RETURN NULL;
                END IF;
                v_result := v_result || SUBSTR(v_source, v_pos, v_found - v_pos + v_identifier_len);
                v_pos := v_found + v_identifier_len;
            END IF;
        END LOOP;

        IF NVL(LENGTH(v_result), 0) + NVL(LENGTH(SUBSTR(v_source, v_pos)), 0) > 32767 THEN
            RETURN NULL;
        END IF;
        RETURN v_result || SUBSTR(v_source, v_pos);
    END;

    FUNCTION protect_division_denominators(p_expr IN VARCHAR2) RETURN VARCHAR2 IS
        v_source VARCHAR2(32767) := p_expr;
        v_result VARCHAR2(32767) := '';
        v_pos PLS_INTEGER := 1;
        v_len PLS_INTEGER := NVL(LENGTH(p_expr), 0);
        v_start PLS_INTEGER;
        v_end PLS_INTEGER;
        v_scan PLS_INTEGER;
        v_depth PLS_INTEGER;
        v_char VARCHAR2(1);
        v_spaces VARCHAR2(4000);
        v_denom VARCHAR2(32767);

        FUNCTION find_balanced_end(p_start IN PLS_INTEGER) RETURN PLS_INTEGER IS
            v_i PLS_INTEGER := p_start;
            v_level PLS_INTEGER := 0;
            v_c VARCHAR2(1);
        BEGIN
            WHILE v_i <= v_len LOOP
                v_c := SUBSTR(v_source, v_i, 1);
                IF v_c = '(' THEN
                    v_level := v_level + 1;
                ELSIF v_c = ')' THEN
                    v_level := v_level - 1;
                    IF v_level = 0 THEN
                        RETURN v_i;
                    END IF;
                END IF;
                v_i := v_i + 1;
            END LOOP;
            RETURN NULL;
        END;

        PROCEDURE append_text(p_text IN VARCHAR2) IS
        BEGIN
            IF NVL(LENGTH(v_result), 0) + NVL(LENGTH(p_text), 0) > 32767 THEN
                v_result := NULL;
            ELSE
                v_result := v_result || p_text;
            END IF;
        END;
    BEGIN
        IF v_source IS NULL OR INSTR(v_source, '/') = 0 THEN
            RETURN v_source;
        END IF;

        WHILE v_pos <= v_len LOOP
            v_char := SUBSTR(v_source, v_pos, 1);
            IF v_char <> '/' THEN
                append_text(v_char);
                IF v_result IS NULL THEN
                    RETURN NULL;
                END IF;
                v_pos := v_pos + 1;
                CONTINUE;
            END IF;

            append_text('/');
            IF v_result IS NULL THEN
                RETURN NULL;
            END IF;
            v_pos := v_pos + 1;
            v_spaces := '';
            WHILE v_pos <= v_len AND SUBSTR(v_source, v_pos, 1) IN (' ', CHR(9), CHR(10), CHR(13)) LOOP
                v_spaces := v_spaces || SUBSTR(v_source, v_pos, 1);
                v_pos := v_pos + 1;
            END LOOP;

            IF v_pos > v_len THEN
                append_text(v_spaces);
                RETURN v_result;
            END IF;

            v_start := v_pos;
            v_char := SUBSTR(v_source, v_pos, 1);
            IF v_char = '(' THEN
                v_end := find_balanced_end(v_pos);
            ELSIF v_char = '"' THEN
                v_scan := v_pos + 1;
                WHILE v_scan <= v_len LOOP
                    IF SUBSTR(v_source, v_scan, 1) = '"' THEN
                        EXIT;
                    END IF;
                    v_scan := v_scan + 1;
                END LOOP;
                v_end := LEAST(v_scan, v_len);
            ELSIF is_alpha_char(v_char) THEN
                v_scan := v_pos;
                WHILE v_scan <= v_len AND is_identifier_char(SUBSTR(v_source, v_scan, 1)) LOOP
                    v_scan := v_scan + 1;
                END LOOP;
                v_end := v_scan - 1;
                WHILE v_scan <= v_len AND SUBSTR(v_source, v_scan, 1) IN (' ', CHR(9), CHR(10), CHR(13)) LOOP
                    v_scan := v_scan + 1;
                END LOOP;
                IF v_scan <= v_len AND SUBSTR(v_source, v_scan, 1) = '(' THEN
                    v_end := find_balanced_end(v_scan);
                END IF;
            ELSIF INSTR('+-0123456789.', v_char) > 0 THEN
                v_scan := v_pos;
                IF SUBSTR(v_source, v_scan, 1) IN ('+', '-') THEN
                    v_scan := v_scan + 1;
                END IF;
                WHILE v_scan <= v_len
                  AND REGEXP_LIKE(SUBSTR(v_source, v_scan, 1), '[0-9.]')
                LOOP
                    v_scan := v_scan + 1;
                END LOOP;
                IF v_scan <= v_len AND UPPER(SUBSTR(v_source, v_scan, 1)) = 'E' THEN
                    v_scan := v_scan + 1;
                    IF v_scan <= v_len AND SUBSTR(v_source, v_scan, 1) IN ('+', '-') THEN
                        v_scan := v_scan + 1;
                    END IF;
                    WHILE v_scan <= v_len
                      AND REGEXP_LIKE(SUBSTR(v_source, v_scan, 1), '[0-9]')
                    LOOP
                        v_scan := v_scan + 1;
                    END LOOP;
                END IF;
                v_end := v_scan - 1;
            ELSE
                append_text(v_spaces || v_char);
                IF v_result IS NULL THEN
                    RETURN NULL;
                END IF;
                v_pos := v_pos + 1;
                CONTINUE;
            END IF;

            IF v_end IS NULL OR v_end < v_start THEN
                RETURN NULL;
            END IF;
            v_denom := SUBSTR(v_source, v_start, v_end - v_start + 1);
            IF UPPER(TRIM(v_denom)) LIKE 'NULLIF(%' THEN
                append_text(v_spaces || v_denom);
            ELSE
                append_text(v_spaces || 'NULLIF(' || v_denom || ', 0)');
            END IF;
            IF v_result IS NULL THEN
                RETURN NULL;
            END IF;
            v_pos := v_end + 1;
        END LOOP;

        RETURN v_result;
    END;

    FUNCTION translate_expression(
        p_expression IN CLOB,
        p_feature_columns IN VARCHAR2
    ) RETURN VARCHAR2 IS
        v_expr VARCHAR2(32767);
        v_rest VARCHAR2(32767) := p_feature_columns || ',';
        v_token VARCHAR2(4000);
        v_pos PLS_INTEGER;
        v_col VARCHAR2(128);
        v_replacement VARCHAR2(4000);
        v_feature_count PLS_INTEGER := 0;
        v_is_complex BOOLEAN := FALSE;
        PROCEDURE mark_translate_step(p_step IN VARCHAR2) IS
        BEGIN
            DBMS_APPLICATION_INFO.SET_ACTION(
                SUBSTR(
                    'TR_' || p_step || ' ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
                    1,
                    32
                )
            );
        EXCEPTION
            WHEN OTHERS THEN
                NULL;
        END;
    BEGIN
        mark_translate_step('CLOB');
        IF p_expression IS NULL THEN
            RETURN NULL;
        END IF;
        v_expr := DBMS_LOB.SUBSTR(p_expression, 32767, 1);
        mark_translate_step('START');
        v_expr := TRIM(v_expr);
        IF INSTR(v_expr, '=') > 0 THEN
            v_expr := TRIM(SUBSTR(v_expr, INSTR(v_expr, '=', -1) + 1));
        END IF;

        IF has_blocked_expr_char(v_expr) THEN
            RETURN NULL;
        END IF;
        IF v_max_expression_length IS NOT NULL
           AND DBMS_LOB.GETLENGTH(p_expression) > v_max_expression_length THEN
            RETURN NULL;
        END IF;

        IF INSTR(v_expr, '**') > 0 THEN
            RETURN NULL;
        END IF;
        v_is_complex := is_complex_symbolic_expression(v_expr);
        mark_translate_step(CASE WHEN v_is_complex THEN 'COMPLEX' ELSE 'SIMPLE' END);

        LOOP
            EXIT WHEN v_rest IS NULL;
            v_pos := INSTR(v_rest, ',');
            EXIT WHEN v_pos IS NULL OR v_pos = 0;
            v_token := TRIM(SUBSTR(v_rest, 1, v_pos - 1));
            v_rest := SUBSTR(v_rest, v_pos + 1);
            IF v_token IS NULL THEN
                CONTINUE;
            END IF;

            IF v_max_elapsed_seconds IS NOT NULL
               AND NOT v_stop_requested
               AND ROUND((SYSDATE - v_started_at) * 86400) > v_max_elapsed_seconds THEN
                v_stop_requested := TRUE;
                RETURN NULL;
            END IF;

            v_col := normalize_identifier(v_token, 'feature column');
            IF v_feature_count >= 200 THEN
                RETURN NULL;
            END IF;
            IF NOT column_exists(v_target_owner, v_target_table, v_col) THEN
                RETURN NULL;
            END IF;
            mark_translate_step('COL_' || SUBSTR(v_col, 1, 20));
            mark_translate_step('TYPE_' || SUBSTR(v_col, 1, 19));
            v_replacement := numeric_column_expr(v_col);
            mark_translate_step('REPL_' || SUBSTR(v_col, 1, 19));
            v_expr := replace_identifier_expr(v_expr, v_col, v_replacement);
            IF v_expr IS NULL THEN
                RETURN NULL;
            END IF;
            v_feature_count := v_feature_count + 1;
            mark_translate_step('NEXT');
        END LOOP;

        IF v_feature_count = 0 THEN
            RETURN NULL;
        END IF;

        mark_translate_step('CHECK');
        IF has_unknown_expression_token(v_expr) THEN
            RETURN NULL;
        END IF;
        IF v_is_complex AND LENGTH(v_expr) > NVL(v_max_expression_length, 8000) THEN
            RETURN NULL;
        END IF;
        mark_translate_step('DIV0');
        v_expr := protect_division_denominators(v_expr);
        IF v_expr IS NULL THEN
            RETURN NULL;
        END IF;
        IF LENGTH(v_expr) > NVL(v_max_expression_length, 8000) THEN
            RETURN NULL;
        END IF;
        RETURN v_expr;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    PROCEDURE set_runtime_progress(
        p_action IN VARCHAR2,
        p_client_info IN VARCHAR2 DEFAULT NULL
    ) IS
    BEGIN
        DBMS_APPLICATION_INFO.SET_MODULE(
            'INIT$_SP_SYMBOLIC_RULE_VIOLATION_DETECT',
            SUBSTR(p_action, 1, 32)
        );
        IF p_client_info IS NOT NULL THEN
            DBMS_APPLICATION_INFO.SET_CLIENT_INFO(SUBSTR(p_client_info, 1, 64));
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            NULL;
    END;

    PROCEDURE disable_parallel_execution IS
    BEGIN
        BEGIN
            EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLCODE <> -12841 THEN
                    RAISE;
                END IF;
        END;

        BEGIN
            EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL QUERY';
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLCODE <> -12841 THEN
                    RAISE;
                END IF;
        END;
    END;

    PROCEDURE check_elapsed(p_phase IN VARCHAR2) IS
        v_elapsed_seconds NUMBER;
    BEGIN
        IF v_max_elapsed_seconds IS NULL OR v_stop_requested THEN
            RETURN;
        END IF;

        v_elapsed_seconds := ROUND((SYSDATE - v_started_at) * 86400);
        IF v_elapsed_seconds > v_max_elapsed_seconds THEN
            v_stop_requested := TRUE;
            set_runtime_progress(
                'TIME LIMIT',
                'phase=' || SUBSTR(p_phase, 1, 16) || ' elapsed=' || v_elapsed_seconds || 's rules=' || v_processed_rules || ' ins=' || v_inserted_total
            );
        END IF;
    END;

    PROCEDURE commit_work_chunk(p_force IN BOOLEAN DEFAULT FALSE) IS
    BEGIN
        IF v_commit = 'Y'
           AND v_commit_interval > 0
           AND v_pending_dml_count > 0
           AND (p_force OR v_pending_dml_count >= v_commit_interval) THEN
            COMMIT;
            v_committed_chunks := v_committed_chunks + 1;
            v_pending_dml_count := 0;
        END IF;
    END;
BEGIN
    v_rule_owner := CASE
        WHEN is_null_token(p_rule_owner_name) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_rule_owner_name, 'rule_owner_name')
    END;
    v_rule_table := normalize_identifier(NVL(p_rule_table_name, 'INIT$_TB_SYMBOLIC_RULE'), 'rule_table_name');
    v_rule_id := CASE
        WHEN is_null_token(p_rule_id) THEN NULL
        ELSE normalize_identifier(p_rule_id, 'rule_id')
    END;
    v_target_owner := CASE
        WHEN is_null_token(p_target_owner) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_target_owner, 'target_owner')
    END;
    v_target_table := normalize_identifier(p_target_table, 'target_table');
    v_result_owner := CASE
        WHEN is_null_token(p_result_owner) THEN SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        ELSE normalize_identifier(p_result_owner, 'result_owner')
    END;
    v_result_table := normalize_identifier(NVL(p_result_table, 'INIT$_TB_SYMBOLIC_RULE_VIOLATION'), 'result_table');
    v_case_id_col := CASE
        WHEN is_null_token(p_case_id_column_name) THEN NULL
        ELSE normalize_identifier(p_case_id_column_name, 'case_id_column_name')
    END;
    v_clear_existing := CASE WHEN UPPER(TRIM(NVL(p_clear_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    v_commit := CASE WHEN UPPER(TRIM(NVL(p_commit_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    v_tolerance_pct := NVL(p_error_pct_threshold, 0.05);
    IF v_tolerance_pct > 1 THEN
        v_tolerance_pct := v_tolerance_pct / 100;
    END IF;
    v_tolerance_pct := GREATEST(0, LEAST(1, v_tolerance_pct));
    v_abs_error_threshold := CASE WHEN p_abs_error_threshold IS NULL THEN NULL ELSE GREATEST(0, p_abs_error_threshold) END;
    v_max_rules := GREATEST(1, LEAST(10000, NVL(p_max_rules, 50)));
    v_max_violations_per_rule := GREATEST(1, LEAST(100000, NVL(p_max_violations_per_rule, 200)));
    v_max_scan_rows := CASE
        WHEN p_max_scan_rows IS NULL THEN 50000
        WHEN p_max_scan_rows <= 0 THEN NULL
        ELSE GREATEST(1, LEAST(10000000, p_max_scan_rows))
    END;
    v_max_elapsed_seconds := CASE
        WHEN p_max_elapsed_seconds IS NULL THEN 1800
        WHEN p_max_elapsed_seconds <= 0 THEN NULL
        ELSE GREATEST(60, LEAST(86400, p_max_elapsed_seconds))
    END;
    v_max_expression_length := CASE
        WHEN p_max_expression_length IS NULL THEN 8000
        WHEN p_max_expression_length <= 0 THEN NULL
        ELSE GREATEST(1000, LEAST(32767, p_max_expression_length))
    END;
    v_commit_interval := GREATEST(0, LEAST(1000000, NVL(p_commit_interval, 1000)));
    v_delete_batch_size := CASE
        WHEN v_commit_interval > 0 THEN GREATEST(1000, LEAST(50000, v_commit_interval))
        ELSE 10000
    END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);
    v_target_object := qualified_name(v_target_owner, v_target_table);
    v_rule_object := qualified_name(v_rule_owner, v_rule_table);
    v_result_object := qualified_name(v_result_owner, v_result_table);
    set_runtime_progress(
        'INIT',
        'run=' || v_run_id || ' target=' || SUBSTR(v_target_table, 1, 30)
    );

    IF NOT table_exists(v_target_owner, v_target_table) THEN
        RAISE_APPLICATION_ERROR(-20602, 'Target table does not exist: ' || v_target_owner || '.' || v_target_table);
    END IF;
    IF NOT table_exists(v_rule_owner, v_rule_table) THEN
        RAISE_APPLICATION_ERROR(-20603, 'Symbolic rule table does not exist: ' || v_rule_owner || '.' || v_rule_table);
    END IF;
    IF NOT table_exists(v_result_owner, v_result_table) THEN
        RAISE_APPLICATION_ERROR(-20604, 'Result table does not exist: ' || v_result_owner || '.' || v_result_table);
    END IF;

    set_runtime_progress(
        'LOAD COLUMNS',
        'target=' || SUBSTR(v_target_table, 1, 30)
    );
    load_target_column_cache;

    IF v_case_id_col IS NOT NULL AND column_exists(v_target_owner, v_target_table, v_case_id_col) THEN
        v_case_id_expr := 'SUBSTR(TO_CHAR(' || quote_name(v_case_id_col) || '), 1, 4000)';
    ELSE
        v_case_id_expr := 'NULL';
    END IF;

    disable_parallel_execution;
    set_runtime_progress(
        'READY',
        'run=' || v_run_id || ' maxRules=' || v_max_rules || ' maxViol=' || v_max_violations_per_rule || ' scan=' || NVL(TO_CHAR(v_max_scan_rows), 'ALL') || ' limit=' || NVL(TO_CHAR(v_max_elapsed_seconds), 'NONE') || ' expr=' || NVL(TO_CHAR(v_max_expression_length), 'ALL')
    );

    IF v_clear_existing = 'Y' THEN
        LOOP
            set_runtime_progress('DELETE OLD', 'run=' || v_run_id || ' del=' || v_deleted_count || ' batch=' || v_delete_batch_size);
            EXECUTE IMMEDIATE
                'DELETE /*+ NO_PARALLEL */ FROM ' || v_result_object ||
                ' WHERE "RUN_SOURCE_TYPE" = :run_source_type' ||
                '   AND "RUN_ID" = :run_id' ||
                '   AND "TARGET_OWNER" = :target_owner' ||
                '   AND "TARGET_TABLE" = :target_table' ||
                '   AND "RULE_OWNER" = :rule_owner' ||
                '   AND "RULE_TABLE" = :rule_table' ||
                '   AND ROWNUM <= :delete_batch'
                USING v_run_source_type, v_run_id, v_target_owner, v_target_table, v_rule_owner, v_rule_table, v_delete_batch_size;
            v_deleted_chunk := SQL%ROWCOUNT;
            v_deleted_count := v_deleted_count + v_deleted_chunk;
            v_pending_dml_count := v_pending_dml_count + v_deleted_chunk;
            commit_work_chunk(TRUE);
            check_elapsed('delete old');
            EXIT WHEN v_deleted_chunk = 0 OR v_stop_requested;
        END LOOP;
        set_runtime_progress('DELETE DONE', 'del=' || v_deleted_count || ' run=' || v_run_id);
    END IF;

    v_rule_filter_sql :=
        '          FROM ' || v_rule_object || ' R ' ||
        '         WHERE R."RUN_SOURCE_TYPE" = ' || sql_literal(v_run_source_type) ||
        '           AND (' || sql_literal(v_run_source_type) || ' = ''DATA_WORK'' OR R."RUN_ID" = ' || number_literal(v_run_id) || ') ' ||
        '           AND R."OWNER" = ' || sql_literal(v_target_owner) ||
        '           AND R."TABLE_NAME" = ' || sql_literal(v_target_table) ||
        '           AND R."SELECTED_YN" = ''Y'' ' ||
        '           AND R."EXPRESSION" IS NOT NULL ' ||
        '           AND R."FEATURE_COLUMNS" IS NOT NULL ' ||
        CASE
            WHEN v_rule_id IS NULL THEN ''
            ELSE '           AND R."RULE_ID" = ' || sql_literal(v_rule_id) || ' '
        END;

    v_rule_total_sql := 'SELECT LEAST(COUNT(*), ' || TO_CHAR(v_max_rules) || ') ' || v_rule_filter_sql;
    EXECUTE IMMEDIATE v_rule_total_sql INTO v_rule_total;

    set_runtime_progress(
        'LOAD RULES',
        'run=' || v_run_id || ' rules=' || v_rule_total || ' maxRules=' || v_max_rules
    );
    OPEN v_rule_cursor FOR
        'SELECT RULE_ID, TARGET_COLUMN, EXPRESSION, FEATURE_COLUMNS, SCORE, COMPLEXITY, METHOD ' ||
        '  FROM (' ||
        '        SELECT R."RULE_ID" AS RULE_ID, ' ||
        '               R."TARGET_COLUMN" AS TARGET_COLUMN, ' ||
        '               R."EXPRESSION" AS EXPRESSION, ' ||
        '               R."FEATURE_COLUMNS" AS FEATURE_COLUMNS, ' ||
        '               R."SCORE" AS SCORE, ' ||
        '               R."COMPLEXITY" AS COMPLEXITY, ' ||
        '               R."METHOD" AS METHOD, ' ||
        '               ROW_NUMBER() OVER (' ||
        '                   ORDER BY CASE WHEN R."SELECTED_YN" = ''Y'' THEN 0 ELSE 1 END, ' ||
        '                            R."RANK_NO" NULLS LAST, ' ||
        '                            R."SCORE" DESC NULLS LAST, ' ||
        '                            R."TARGET_COLUMN", ' ||
        '                            R."RULE_ID" ' ||
        '               ) AS RN__ ' ||
        v_rule_filter_sql ||
        '       ) ' ||
        ' WHERE RN__ <= ' || TO_CHAR(v_max_rules);

    LOOP
        check_elapsed('rule loop');
        EXIT WHEN v_stop_requested;

        FETCH v_rule_cursor
         INTO v_rule_item_id,
              v_rule_target_column,
              v_rule_expression,
              v_rule_feature_columns,
              v_rule_score,
              v_rule_complexity,
              v_rule_method;
        EXIT WHEN v_rule_cursor%NOTFOUND;
        v_processed_rules := v_processed_rules + 1;
        set_runtime_progress(
            'RULE ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
            'rule=' || SUBSTR(v_rule_item_id, 1, 20) || ' ins=' || v_inserted_total || ' skip=' || v_skipped_total
        );

        DECLARE
            v_target_col VARCHAR2(128) := UPPER(TRIM(v_rule_target_column));
            v_expr_sql VARCHAR2(32767);
            v_sql CLOB;
            v_scan_filter_sql VARCHAR2(1000);
            v_reason VARCHAR2(4000);
            v_inserted_count NUMBER := 0;
        BEGIN
            set_runtime_progress(
                'CHECK ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
                'target=' || SUBSTR(v_target_col, 1, 20) || ' feat=' || SUBSTR(v_rule_feature_columns, 1, 35)
            );
            IF NOT column_exists(v_target_owner, v_target_table, v_target_col) THEN
                v_skipped_total := v_skipped_total + 1;
                CONTINUE;
            END IF;

            set_runtime_progress(
                'TRANSLATE ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
                'rule=' || SUBSTR(v_rule_item_id, 1, 20) || ' feat=' || SUBSTR(v_rule_feature_columns, 1, 35)
            );
            check_elapsed('before translate');
            IF v_stop_requested THEN
                CONTINUE;
            END IF;

            v_expr_sql := translate_expression(v_rule_expression, v_rule_feature_columns);
            check_elapsed('after translate');
            IF v_stop_requested THEN
                CONTINUE;
            END IF;

            IF v_expr_sql IS NULL THEN
                v_skipped_total := v_skipped_total + 1;
                CONTINUE;
            END IF;

            v_reason := 'Actual value is outside symbolic expression tolerance '
                || TO_CHAR(v_tolerance_pct * 100, 'FM9999990D9999', 'NLS_NUMERIC_CHARACTERS=.,') || '%.';
            v_scan_filter_sql := CASE
                WHEN v_max_scan_rows IS NULL THEN ''
                ELSE ' WHERE ROWNUM <= ' || TO_CHAR(v_max_scan_rows)
            END;

            v_sql :=
                'INSERT /*+ NO_PARALLEL */ INTO ' || v_result_object || ' (' ||
                '"RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "RULE_OWNER", "RULE_TABLE", ' ||
                '"RULE_ID", "TARGET_COLUMN", "CASE_ID", "CASE_ROWID", "EXPRESSION", "FEATURE_COLUMNS", ' ||
                '"PREDICTED_VALUE", "ACTUAL_VALUE", "LOWER_BOUND", "UPPER_BOUND", "ABS_ERROR", "ERROR_PCT", ' ||
                '"TOLERANCE_PCT", "ABS_ERROR_THRESHOLD", "RULE_SCORE", "RULE_COMPLEXITY", "RULE_METHOD", ' ||
                '"VIOLATION_SCORE", "VIOLATION_REASON", "CREATE_DT") ' ||
                'SELECT /*+ NO_PARALLEL */ ' ||
                sql_literal(v_run_source_type) || ', ' ||
                number_literal(v_run_id) || ', ' ||
                sql_literal(v_target_owner) || ', ' ||
                sql_literal(v_target_table) || ', ' ||
                sql_literal(v_rule_owner) || ', ' ||
                sql_literal(v_rule_table) || ', ' ||
                sql_literal(v_rule_item_id) || ', ' ||
                sql_literal(v_target_col) || ', ' ||
                'Q.CASE_ID, Q.CASE_ROWID, ' ||
                sql_literal(DBMS_LOB.SUBSTR(v_rule_expression, 4000, 1)) || ', ' ||
                sql_literal(v_rule_feature_columns) || ', ' ||
                'Q.PREDICTED_VALUE, Q.ACTUAL_VALUE, Q.LOWER_BOUND, Q.UPPER_BOUND, Q.ABS_ERROR, Q.ERROR_PCT, ' ||
                number_literal(v_tolerance_pct) || ', ' ||
                number_literal(v_abs_error_threshold) || ', ' ||
                number_literal(v_rule_score) || ', ' ||
                number_literal(v_rule_complexity) || ', ' ||
                sql_literal(v_rule_method) || ', ' ||
                'NVL(Q.ERROR_PCT, Q.ABS_ERROR) AS VIOLATION_SCORE, ' ||
                sql_literal(v_reason) || ', SYSDATE ' ||
                '  FROM (' ||
                '        SELECT P.CASE_ID, P.CASE_ROWID, P.PREDICTED_VALUE, P.ACTUAL_VALUE, ' ||
                '               P.PREDICTED_VALUE - ABS(P.PREDICTED_VALUE) * ' || number_literal(v_tolerance_pct) || ' AS LOWER_BOUND, ' ||
                '               P.PREDICTED_VALUE + ABS(P.PREDICTED_VALUE) * ' || number_literal(v_tolerance_pct) || ' AS UPPER_BOUND, ' ||
                '               ABS(P.ACTUAL_VALUE - P.PREDICTED_VALUE) AS ABS_ERROR, ' ||
                '               CASE WHEN ABS(P.PREDICTED_VALUE) > 0 THEN ABS(P.ACTUAL_VALUE - P.PREDICTED_VALUE) / ABS(P.PREDICTED_VALUE) END AS ERROR_PCT ' ||
                '          FROM (' ||
                '                SELECT /*+ NO_PARALLEL */ ' || v_case_id_expr || ' AS CASE_ID, ' ||
                '                       ROWIDTOCHAR(ROWID) AS CASE_ROWID, ' ||
                '                       (' || v_expr_sql || ') AS PREDICTED_VALUE, ' ||
                '                       ' || numeric_column_expr(v_target_col) || ' AS ACTUAL_VALUE ' ||
                '                  FROM ' || v_target_object || v_scan_filter_sql ||
                '               ) P ' ||
                '         WHERE P.PREDICTED_VALUE IS NOT NULL ' ||
                '           AND P.ACTUAL_VALUE IS NOT NULL ' ||
                '       ) Q ' ||
                ' WHERE (' ||
                '        (ABS(Q.PREDICTED_VALUE) > 0 AND Q.ERROR_PCT > ' || number_literal(v_tolerance_pct) || ') ' ||
                '        OR (ABS(Q.PREDICTED_VALUE) = 0 AND Q.ABS_ERROR > ' || number_literal(NVL(v_abs_error_threshold, v_tolerance_pct)) || ') ';

            IF v_abs_error_threshold IS NOT NULL THEN
                v_sql := v_sql || '        OR Q.ABS_ERROR > ' || number_literal(v_abs_error_threshold) || ' ';
            END IF;

            v_sql := v_sql ||
                '       ) ' ||
                '   AND ROWNUM <= ' || TO_CHAR(v_max_violations_per_rule);

            BEGIN
                set_runtime_progress(
                    'SCAN ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
                    'rule=' || SUBSTR(v_rule_item_id, 1, 20) || ' scan=' || NVL(TO_CHAR(v_max_scan_rows), 'ALL') || ' ins=' || v_inserted_total
                );
                check_elapsed('before scan');
                IF v_stop_requested THEN
                    CONTINUE;
                END IF;

                EXECUTE IMMEDIATE v_sql;
                v_inserted_count := SQL%ROWCOUNT;
                v_inserted_total := v_inserted_total + v_inserted_count;
                v_pending_dml_count := v_pending_dml_count + v_inserted_count;
                commit_work_chunk(TRUE);
                check_elapsed('after scan');
                IF v_stop_requested THEN
                    set_runtime_progress(
                        'STOPPING',
                        'last=' || v_inserted_count || ' ins=' || v_inserted_total || ' skip=' || v_skipped_total
                    );
                ELSE
                    set_runtime_progress(
                        'DONE ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
                        'last=' || v_inserted_count || ' ins=' || v_inserted_total || ' skip=' || v_skipped_total
                    );
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    v_skipped_total := v_skipped_total + 1;
                    set_runtime_progress(
                        'SKIP ' || v_processed_rules || '/' || GREATEST(v_rule_total, v_processed_rules),
                        'rule=' || SUBSTR(v_rule_item_id, 1, 20) || ' ins=' || v_inserted_total || ' skip=' || v_skipped_total
                    );
            END;
        END;
    END LOOP;
    CLOSE v_rule_cursor;

    IF v_commit = 'Y' THEN
        IF v_pending_dml_count > 0 THEN
            v_committed_chunks := v_committed_chunks + 1;
        END IF;
        COMMIT;
        v_pending_dml_count := 0;
    END IF;
    set_runtime_progress(
        CASE WHEN v_stop_requested THEN 'STOPPED' ELSE 'COMPLETE' END,
        'rules=' || v_processed_rules || ' ins=' || v_inserted_total || ' skip=' || v_skipped_total
    );

    IF v_stop_requested THEN
        DBMS_OUTPUT.PUT_LINE('[WARN] Symbolic rule violation detection stopped by max elapsed seconds. inserted=' || v_inserted_total ||
            ', deleted=' || v_deleted_count ||
            ', skipped=' || v_skipped_total ||
            ', maxRules=' || v_max_rules ||
            ', maxViolationsPerRule=' || v_max_violations_per_rule ||
            ', commitInterval=' || v_commit_interval ||
            ', commits=' || v_committed_chunks ||
            ', maxScanRows=' || NVL(TO_CHAR(v_max_scan_rows), 'ALL') ||
            ', maxElapsedSeconds=' || NVL(TO_CHAR(v_max_elapsed_seconds), 'NONE') ||
            ', maxExpressionLength=' || NVL(TO_CHAR(v_max_expression_length), 'ALL') ||
            ', target=' || v_target_owner || '.' || v_target_table ||
            ', tolerance=' || TO_CHAR(v_tolerance_pct));
    ELSE
        DBMS_OUTPUT.PUT_LINE('[OK] Symbolic rule violation detection completed. inserted=' || v_inserted_total ||
        ', deleted=' || v_deleted_count ||
        ', skipped=' || v_skipped_total ||
        ', maxRules=' || v_max_rules ||
        ', maxViolationsPerRule=' || v_max_violations_per_rule ||
        ', commitInterval=' || v_commit_interval ||
        ', commits=' || v_committed_chunks ||
        ', maxScanRows=' || NVL(TO_CHAR(v_max_scan_rows), 'ALL') ||
        ', maxElapsedSeconds=' || NVL(TO_CHAR(v_max_elapsed_seconds), 'NONE') ||
        ', maxExpressionLength=' || NVL(TO_CHAR(v_max_expression_length), 'ALL') ||
        ', target=' || v_target_owner || '.' || v_target_table ||
        ', tolerance=' || TO_CHAR(v_tolerance_pct));
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        set_runtime_progress(
            'FAILED',
            'rules=' || v_processed_rules || ' ins=' || v_inserted_total || ' skip=' || v_skipped_total
        );
        IF v_rule_cursor%ISOPEN THEN
            CLOSE v_rule_cursor;
        END IF;
        IF v_committed_chunks > 0 THEN
            DBMS_OUTPUT.PUT_LINE('[WARN] Symbolic rule violation detection failed after committed chunks. Only uncommitted work will be rolled back.');
        END IF;
        IF v_commit = 'Y' THEN
            ROLLBACK;
        END IF;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_DM_MODEL_VIEW_LIST" (
    p_model_name IN VARCHAR2,
    p_result     OUT SYS_REFCURSOR
) AUTHID CURRENT_USER IS
    v_model_name VARCHAR2(128);
BEGIN
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    v_model_name := UPPER(TRIM(p_model_name));

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20211, 'Invalid model_name parameter.');
    END IF;

    OPEN p_result FOR
        WITH VIEW_TYPES AS (
            SELECT 'VA' AS VIEW_TYPE, 'Attribute/detail view' AS DESCRIPTION FROM DUAL UNION ALL
            SELECT 'VG', 'Global/detail view' FROM DUAL UNION ALL
            SELECT 'VI', 'Itemset/detail view' FROM DUAL UNION ALL
            SELECT 'VN', 'Node/detail view' FROM DUAL UNION ALL
            SELECT 'VP', 'Pattern/partition/detail view' FROM DUAL UNION ALL
            SELECT 'VR', 'Rule/detail view' FROM DUAL UNION ALL
            SELECT 'VT', 'Transformation/detail view' FROM DUAL
        )
        SELECT V.VIEW_TYPE
             , 'DM$' || V.VIEW_TYPE || v_model_name AS VIEW_NAME
             , V.DESCRIPTION
             , O.OBJECT_TYPE
             , CASE WHEN O.OBJECT_NAME IS NULL THEN 'N' ELSE 'Y' END AS EXISTS_YN
          FROM VIEW_TYPES V
          LEFT JOIN USER_OBJECTS O
            ON O.OBJECT_NAME = 'DM$' || V.VIEW_TYPE || v_model_name
         ORDER BY V.VIEW_TYPE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_DM_MODEL_VIEW_OPEN" (
    p_model_name IN VARCHAR2,
    p_view_type  IN VARCHAR2 DEFAULT 'VR',
    p_result     OUT SYS_REFCURSOR
) AUTHID CURRENT_USER IS
    v_model_name VARCHAR2(128);
    v_view_type  VARCHAR2(2);
    v_view_name  VARCHAR2(261);
    v_count      NUMBER;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;
BEGIN
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    v_model_name := UPPER(TRIM(p_model_name));
    v_view_type := UPPER(TRIM(p_view_type));

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20221, 'Invalid model_name parameter.');
    END IF;

    IF v_view_type NOT IN ('VA', 'VG', 'VI', 'VN', 'VP', 'VR', 'VT') THEN
        RAISE_APPLICATION_ERROR(-20222, 'Invalid view_type parameter. Use VA, VG, VI, VN, VP, VR, or VT.');
    END IF;

    v_view_name := 'DM$' || v_view_type || v_model_name;

    SELECT COUNT(*)
      INTO v_count
      FROM USER_OBJECTS
     WHERE OBJECT_NAME = v_view_name
       AND OBJECT_TYPE IN ('VIEW', 'TABLE');

    IF v_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20223, 'Model detail object was not found: ' || v_view_name);
    END IF;

    OPEN p_result FOR 'SELECT * FROM ' || quote_name(v_view_name);
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
/

