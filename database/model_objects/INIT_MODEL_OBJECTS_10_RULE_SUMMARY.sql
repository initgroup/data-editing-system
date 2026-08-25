CREATE OR REPLACE PACKAGE "INIT$_PKG_RULE_SUMMARY" AS
    PROCEDURE LOAD_CONDITIONAL_RULES(
        p_model_name          IN VARCHAR2,
        p_data_query          IN VARCHAR2,
        p_case_id_column_name IN VARCHAR2 DEFAULT NULL,
        p_candidate_columns   IN VARCHAR2 DEFAULT NULL,
        p_target_columns      IN VARCHAR2 DEFAULT NULL,
        p_model_type          IN VARCHAR2 DEFAULT 'CONDITIONAL_RULE',
        p_rule_source         IN VARCHAR2 DEFAULT 'CONDITIONAL_FREQUENCY',
        p_min_support_count   IN NUMBER   DEFAULT 30,
        p_min_confidence      IN NUMBER   DEFAULT 0.7,
        p_min_lift            IN NUMBER   DEFAULT 1,
        p_max_columns         IN NUMBER   DEFAULT 25,
        p_max_rules_per_pair  IN NUMBER   DEFAULT 25,
        p_max_input_rows      IN NUMBER   DEFAULT NULL,
        p_clear_existing_yn   IN VARCHAR2 DEFAULT 'Y',
        p_target_owner        IN VARCHAR2 DEFAULT NULL,
        p_target_table        IN VARCHAR2 DEFAULT NULL,
        p_run_source_type     IN VARCHAR2 DEFAULT 'DATA_WORK',
        p_run_id              IN NUMBER   DEFAULT 0,
        p_max_condition_count IN NUMBER   DEFAULT 5,
        p_max_rule_combinations IN NUMBER DEFAULT 1000
    );

    FUNCTION GET_LAST_EFFECTIVE_MAX_COLUMNS RETURN NUMBER;
    FUNCTION GET_LAST_EFFECTIVE_MAX_RULES_PER_PAIR RETURN NUMBER;
    FUNCTION GET_LAST_CANDIDATE_COUNT RETURN NUMBER;
    FUNCTION GET_LAST_REQUESTED_MAX_CONDITION_COUNT RETURN NUMBER;
    FUNCTION GET_LAST_EFFECTIVE_MAX_CONDITION_COUNT RETURN NUMBER;
    FUNCTION GET_LAST_MAX_RULE_COMBINATIONS RETURN NUMBER;
    FUNCTION GET_LAST_ESTIMATED_COMBINATION_COUNT RETURN NUMBER;
    FUNCTION GET_LAST_EVALUATED_COMBINATION_COUNT RETURN NUMBER;
    FUNCTION GET_LAST_ADJUSTMENT_REASON RETURN VARCHAR2;
END "INIT$_PKG_RULE_SUMMARY";
/

CREATE OR REPLACE PACKAGE BODY "INIT$_PKG_RULE_SUMMARY" AS
    TYPE t_column_list IS TABLE OF VARCHAR2(128);
    TYPE t_index_list IS TABLE OF PLS_INTEGER;

    g_last_effective_max_columns NUMBER := 0;
    g_last_effective_max_rules_per_pair NUMBER := 0;
    g_last_candidate_count NUMBER := 0;
    g_last_requested_max_condition_count NUMBER := 0;
    g_last_effective_max_condition_count NUMBER := 0;
    g_last_max_rule_combinations NUMBER := 0;
    g_last_estimated_combination_count NUMBER := 0;
    g_last_evaluated_combination_count NUMBER := 0;
    g_last_adjustment_reason VARCHAR2(4000) := 'NONE';

    FUNCTION GET_LAST_EFFECTIVE_MAX_COLUMNS RETURN NUMBER IS
    BEGIN
        RETURN g_last_effective_max_columns;
    END;

    FUNCTION GET_LAST_EFFECTIVE_MAX_RULES_PER_PAIR RETURN NUMBER IS
    BEGIN
        RETURN g_last_effective_max_rules_per_pair;
    END;

    FUNCTION GET_LAST_CANDIDATE_COUNT RETURN NUMBER IS
    BEGIN
        RETURN g_last_candidate_count;
    END;

    FUNCTION GET_LAST_REQUESTED_MAX_CONDITION_COUNT RETURN NUMBER IS
    BEGIN
        RETURN g_last_requested_max_condition_count;
    END;

    FUNCTION GET_LAST_EFFECTIVE_MAX_CONDITION_COUNT RETURN NUMBER IS
    BEGIN
        RETURN g_last_effective_max_condition_count;
    END;

    FUNCTION GET_LAST_MAX_RULE_COMBINATIONS RETURN NUMBER IS
    BEGIN
        RETURN g_last_max_rule_combinations;
    END;

    FUNCTION GET_LAST_ESTIMATED_COMBINATION_COUNT RETURN NUMBER IS
    BEGIN
        RETURN g_last_estimated_combination_count;
    END;

    FUNCTION GET_LAST_EVALUATED_COMBINATION_COUNT RETURN NUMBER IS
    BEGIN
        RETURN g_last_evaluated_combination_count;
    END;

    FUNCTION GET_LAST_ADJUSTMENT_REASON RETURN VARCHAR2 IS
    BEGIN
        RETURN g_last_adjustment_reason;
    END;

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_label IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128);
    BEGIN
        v_value := UPPER(TRIM(BOTH '"' FROM TRIM(p_value)));
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20301, 'Invalid ' || p_label || ' parameter: ' || SUBSTR(NVL(p_value, '(null)'), 1, 200));
        END IF;
        RETURN v_value;
    END;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;

    FUNCTION sql_literal(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_value IS NULL THEN
            RETURN 'NULL';
        END IF;
        RETURN '''' || REPLACE(SUBSTR(p_value, 1, 4000), '''', '''''') || '''';
    END;

    FUNCTION clean_query(p_query IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_query IS NULL OR TRIM(p_query) IS NULL THEN
            RAISE_APPLICATION_ERROR(-20302, 'data_query parameter is required.');
        END IF;
        RETURN REGEXP_REPLACE(TRIM(p_query), ';+[[:space:]]*$', '');
    END;

    FUNCTION is_null_token(p_value IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN p_value IS NULL
            OR TRIM(p_value) IS NULL
            OR UPPER(TRIM(p_value)) IN ('NULL', '(NULL)');
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
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

    FUNCTION table_exists(p_table_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_TABLES
         WHERE TABLE_NAME = UPPER(p_table_name);

        RETURN v_count > 0;
    END;

    FUNCTION infer_query_owner(p_query IN VARCHAR2) RETURN VARCHAR2 IS
        v_owner VARCHAR2(128);
    BEGIN
        v_owner := REGEXP_SUBSTR(p_query, '"([^"]+)"[[:space:]]*\.[[:space:]]*"([^"]+)"', 1, 1, 'i', 1);
        IF v_owner IS NOT NULL THEN
            RETURN normalize_identifier(v_owner, 'target_owner');
        END IF;

        v_owner := REGEXP_SUBSTR(UPPER(p_query), '([A-Z][A-Z0-9_$#]{0,127})[[:space:]]*\.[[:space:]]*([A-Z][A-Z0-9_$#]{0,127})', 1, 1, 'i', 1);
        IF v_owner IS NOT NULL THEN
            RETURN normalize_identifier(v_owner, 'target_owner');
        END IF;

        RETURN NULL;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    FUNCTION infer_query_table(p_query IN VARCHAR2) RETURN VARCHAR2 IS
        v_table VARCHAR2(128);
    BEGIN
        v_table := REGEXP_SUBSTR(p_query, '"([^"]+)"[[:space:]]*\.[[:space:]]*"([^"]+)"', 1, 1, 'i', 2);
        IF v_table IS NOT NULL THEN
            RETURN normalize_identifier(v_table, 'target_table');
        END IF;

        v_table := REGEXP_SUBSTR(UPPER(p_query), '([A-Z][A-Z0-9_$#]{0,127})[[:space:]]*\.[[:space:]]*([A-Z][A-Z0-9_$#]{0,127})', 1, 1, 'i', 2);
        IF v_table IS NOT NULL THEN
            RETURN normalize_identifier(v_table, 'target_table');
        END IF;

        RETURN NULL;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    FUNCTION split_columns(
        p_csv IN VARCHAR2,
        p_exclude IN VARCHAR2,
        p_max_columns IN PLS_INTEGER
    ) RETURN t_column_list IS
        v_cols t_column_list := t_column_list();
        v_pos PLS_INTEGER := 1;
        v_token VARCHAR2(4000);
        v_col VARCHAR2(128);
        v_limit PLS_INTEGER := GREATEST(1, NVL(p_max_columns, 25));
    BEGIN
        LOOP
            v_token := REGEXP_SUBSTR(p_csv, '[^,]+', 1, v_pos);
            EXIT WHEN v_token IS NULL OR v_cols.COUNT >= v_limit;
            IF NOT is_null_token(v_token) THEN
                v_col := normalize_identifier(v_token, 'column');
                IF (p_exclude IS NULL OR v_col <> p_exclude) AND NOT contains_column(v_cols, v_col) THEN
                    v_cols.EXTEND;
                    v_cols(v_cols.COUNT) := v_col;
                END IF;
            END IF;
            v_pos := v_pos + 1;
        END LOOP;
        RETURN v_cols;
    END;

    FUNCTION describe_query_columns(
        p_query IN VARCHAR2,
        p_exclude IN VARCHAR2,
        p_max_columns IN PLS_INTEGER
    ) RETURN t_column_list IS
        v_cursor INTEGER;
        v_col_count INTEGER;
        v_desc DBMS_SQL.DESC_TAB2;
        v_cols t_column_list := t_column_list();
        v_col VARCHAR2(128);
        v_limit PLS_INTEGER := GREATEST(1, NVL(p_max_columns, 25));
    BEGIN
        v_cursor := DBMS_SQL.OPEN_CURSOR;
        DBMS_SQL.PARSE(v_cursor, 'SELECT * FROM (' || p_query || ') WHERE 1 = 0', DBMS_SQL.NATIVE);
        DBMS_SQL.DESCRIBE_COLUMNS2(v_cursor, v_col_count, v_desc);

        FOR i IN 1 .. v_col_count LOOP
            EXIT WHEN v_cols.COUNT >= v_limit;
            v_col := UPPER(TRIM(v_desc(i).col_name));
            IF REGEXP_LIKE(v_col, '^[A-Z][A-Z0-9_$#]{0,127}$')
               AND (p_exclude IS NULL OR v_col <> p_exclude)
               AND NOT contains_column(v_cols, v_col)
               AND v_desc(i).col_type IN (1, 2, 12, 96, 180, 181) THEN
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
            RAISE;
    END;

    FUNCTION correlated_pair_columns(
        p_available_cols IN t_column_list,
        p_exclude IN VARCHAR2,
        p_max_columns IN PLS_INTEGER,
        p_target_owner IN VARCHAR2,
        p_target_table IN VARCHAR2,
        p_run_source_type IN VARCHAR2,
        p_run_id IN NUMBER
    ) RETURN t_column_list IS
        v_cols t_column_list := t_column_list();
        v_limit PLS_INTEGER := GREATEST(1, NVL(p_max_columns, 25));
    BEGIN
        IF p_target_owner IS NULL OR p_target_table IS NULL THEN
            RETURN v_cols;
        END IF;

        IF NOT table_exists('INIT$_TB_COLREL_CAT_PAIR') THEN
            RETURN v_cols;
        END IF;

        FOR corr_rec IN (
            SELECT COL1
              FROM (
                    SELECT DISTINCT COL1
                      FROM (
                            SELECT "COL_A" AS COL1
                             FROM "INIT$_TB_COLREL_CAT_PAIR"
                             WHERE "OWNER" = p_target_owner
                               AND "TABLE_NAME" = p_target_table
                               AND "RUN_SOURCE_TYPE" = p_run_source_type
                               AND (p_run_source_type = 'DATA_WORK' OR "RUN_ID" = p_run_id)
                               AND "PASS_YN" = 'Y'
                            UNION
                            SELECT "COL_B" AS COL1
                              FROM "INIT$_TB_COLREL_CAT_PAIR"
                             WHERE "OWNER" = p_target_owner
                               AND "TABLE_NAME" = p_target_table
                               AND "RUN_SOURCE_TYPE" = p_run_source_type
                               AND (p_run_source_type = 'DATA_WORK' OR "RUN_ID" = p_run_id)
                               AND "PASS_YN" = 'Y'
                           )
                     WHERE COL1 IS NOT NULL
                     ORDER BY COL1
                   )
             WHERE ROWNUM <= v_limit
        ) LOOP
            IF (p_exclude IS NULL OR corr_rec.COL1 <> p_exclude)
               AND contains_column(p_available_cols, corr_rec.COL1)
               AND NOT contains_column(v_cols, corr_rec.COL1) THEN
                v_cols.EXTEND;
                v_cols(v_cols.COUNT) := corr_rec.COL1;
            END IF;
        END LOOP;

        RETURN v_cols;
    END;

    PROCEDURE LOAD_CONDITIONAL_RULES(
        p_model_name          IN VARCHAR2,
        p_data_query          IN VARCHAR2,
        p_case_id_column_name IN VARCHAR2 DEFAULT NULL,
        p_candidate_columns   IN VARCHAR2 DEFAULT NULL,
        p_target_columns      IN VARCHAR2 DEFAULT NULL,
        p_model_type          IN VARCHAR2 DEFAULT 'CONDITIONAL_RULE',
        p_rule_source         IN VARCHAR2 DEFAULT 'CONDITIONAL_FREQUENCY',
        p_min_support_count   IN NUMBER   DEFAULT 30,
        p_min_confidence      IN NUMBER   DEFAULT 0.7,
        p_min_lift            IN NUMBER   DEFAULT 1,
        p_max_columns         IN NUMBER   DEFAULT 25,
        p_max_rules_per_pair  IN NUMBER   DEFAULT 25,
        p_max_input_rows      IN NUMBER   DEFAULT NULL,
        p_clear_existing_yn   IN VARCHAR2 DEFAULT 'Y',
        p_target_owner        IN VARCHAR2 DEFAULT NULL,
        p_target_table        IN VARCHAR2 DEFAULT NULL,
        p_run_source_type     IN VARCHAR2 DEFAULT 'DATA_WORK',
        p_run_id              IN NUMBER   DEFAULT 0,
        p_max_condition_count IN NUMBER   DEFAULT 5,
        p_max_rule_combinations IN NUMBER DEFAULT 1000
    ) IS
        v_model_name VARCHAR2(128);
        v_case_id_col VARCHAR2(128);
        v_target_owner VARCHAR2(128);
        v_target_table VARCHAR2(128);
        v_model_type VARCHAR2(80);
        v_rule_source VARCHAR2(80);
        v_base_query VARCHAR2(32767);
        v_described_candidates t_column_list := t_column_list();
        v_candidates t_column_list := t_column_list();
        v_targets t_column_list := t_column_list();
        v_condition_col VARCHAR2(128);
        v_condition_col2 VARCHAR2(128);
        v_result_col VARCHAR2(128);
        v_sql CLOB;
        v_min_support_count NUMBER;
        v_min_confidence NUMBER;
        v_min_lift NUMBER;
        v_max_columns NUMBER;
        v_max_rules_per_pair NUMBER;
        v_max_input_rows NUMBER;
        v_requested_max_condition_count NUMBER := 5;
        v_normalized_max_condition_count NUMBER := 5;
        v_effective_max_condition_count NUMBER := 0;
        v_max_possible_condition_count NUMBER := 0;
        v_target_available_count NUMBER := 0;
        v_max_rule_combinations NUMBER := 1000;
        v_estimated_combination_count NUMBER := 0;
        v_evaluated_combination_count NUMBER := 0;
        v_budget_slot_count NUMBER := 1;
        v_budget_per_slot NUMBER := 0;
        v_budget_remainder NUMBER := 0;
        v_current_slot_budget NUMBER := 0;
        v_current_slot_evaluated NUMBER := 0;
        v_adjustment_reason VARCHAR2(4000) := 'NONE';
        v_loaded_count NUMBER := 0;
        v_symmetric_pair_mode VARCHAR2(1) := 'N';
        v_run_source_type VARCHAR2(30);
        v_run_id NUMBER;

        PROCEDURE append_adjustment_reason(p_reason IN VARCHAR2) IS
        BEGIN
            IF p_reason IS NULL OR TRIM(p_reason) IS NULL THEN
                RETURN;
            END IF;
            IF v_adjustment_reason = 'NONE' THEN
                v_adjustment_reason := SUBSTR(TRIM(p_reason), 1, 4000);
            ELSIF INSTR(v_adjustment_reason, TRIM(p_reason)) = 0 THEN
                v_adjustment_reason := SUBSTR(v_adjustment_reason || '; ' || TRIM(p_reason), 1, 4000);
            END IF;
        END append_adjustment_reason;

        FUNCTION choose_count(
            p_item_count IN PLS_INTEGER,
            p_pick_count IN PLS_INTEGER
        ) RETURN NUMBER IS
            v_pick_count PLS_INTEGER;
            v_result NUMBER := 1;
        BEGIN
            IF p_pick_count < 0 OR p_item_count < p_pick_count THEN
                RETURN 0;
            END IF;
            IF p_pick_count = 0 OR p_item_count = p_pick_count THEN
                RETURN 1;
            END IF;

            v_pick_count := LEAST(p_pick_count, p_item_count - p_pick_count);
            FOR i IN 1 .. v_pick_count LOOP
                v_result := v_result * (p_item_count - v_pick_count + i) / i;
            END LOOP;
            RETURN v_result;
        END choose_count;

        FUNCTION estimate_rule_combinations(p_condition_count IN PLS_INTEGER) RETURN NUMBER IS
            v_total NUMBER := 0;
            v_term NUMBER;
            v_available_count PLS_INTEGER;
        BEGIN
            IF p_condition_count <= 0 THEN
                RETURN 0;
            END IF;

            FOR condition_size IN 1 .. p_condition_count LOOP
                IF v_symmetric_pair_mode = 'Y' THEN
                    v_term := choose_count(
                        v_candidates.COUNT,
                        condition_size + 1
                    );
                    v_total := v_total + v_term;
                ELSE
                    FOR target_idx IN 1 .. v_targets.COUNT LOOP
                        v_available_count := v_candidates.COUNT;
                        IF contains_column(v_candidates, v_targets(target_idx)) THEN
                            v_available_count := v_available_count - 1;
                        END IF;
                        v_term := choose_count(
                            v_available_count,
                            condition_size
                        );
                        v_total := v_total + v_term;
                    END LOOP;
                END IF;
            END LOOP;

            RETURN v_total;
        END estimate_rule_combinations;

        PROCEDURE begin_combination_budget_slot(
            p_target_idx IN PLS_INTEGER,
            p_condition_count IN PLS_INTEGER
        ) IS
            v_slot_index NUMBER;
        BEGIN
            IF v_symmetric_pair_mode = 'Y' THEN
                v_slot_index := 0;
                IF p_target_idx > 1 THEN
                    FOR prior_target_idx IN 1 .. (p_target_idx - 1) LOOP
                        v_slot_index := v_slot_index + LEAST(
                            v_effective_max_condition_count,
                            GREATEST(0, prior_target_idx - 1)
                        );
                    END LOOP;
                END IF;
                IF p_condition_count >= p_target_idx THEN
                    v_current_slot_budget := 0;
                    v_current_slot_evaluated := 0;
                    RETURN;
                END IF;
                v_slot_index := v_slot_index + p_condition_count;
            ELSE
                v_slot_index := ((p_target_idx - 1) * v_effective_max_condition_count) + p_condition_count;
            END IF;
            v_current_slot_budget := v_budget_per_slot
                + CASE WHEN v_slot_index <= v_budget_remainder THEN 1 ELSE 0 END;
            v_current_slot_evaluated := 0;
        END begin_combination_budget_slot;

        FUNCTION current_budget_slot_available RETURN BOOLEAN IS
        BEGIN
            RETURN v_evaluated_combination_count < v_max_rule_combinations
               AND v_current_slot_evaluated < v_current_slot_budget;
        END current_budget_slot_available;

        PROCEDURE mark_combination_evaluated IS
        BEGIN
            v_evaluated_combination_count := v_evaluated_combination_count + 1;
            v_current_slot_evaluated := v_current_slot_evaluated + 1;
        END mark_combination_evaluated;

        PROCEDURE load_multi_condition_rule(p_indexes IN t_index_list) IS
            v_condition_count PLS_INTEGER := p_indexes.COUNT;
            v_base_select CLOB := NULL;
            v_base_where CLOB := NULL;
            v_group_cols CLOB := NULL;
            v_metric_select CLOB := NULL;
            v_join_condition CLOB := NULL;
            v_order_cols CLOB := NULL;
            v_condition_columns VARCHAR2(4000) := NULL;
            v_condition_value_expr CLOB := NULL;
            v_condition_text_expr CLOB := NULL;
            v_hash_expr CLOB := NULL;
            v_col VARCHAR2(128);
        BEGIN
            IF v_condition_count < 3 OR v_condition_count > 5 THEN
                RETURN;
            END IF;
            IF NOT current_budget_slot_available THEN
                RETURN;
            END IF;

            mark_combination_evaluated;

            FOR i IN 1 .. v_condition_count LOOP
                v_col := v_candidates(p_indexes(i));
                IF i > 1 THEN
                    v_base_select := v_base_select || ',' || CHR(10) || '           ';
                    v_base_where := v_base_where || CHR(10) || '       AND ';
                    v_group_cols := v_group_cols || ', ';
                    v_metric_select := v_metric_select || ', ';
                    v_join_condition := v_join_condition || CHR(10) || '       AND ';
                    v_order_cols := v_order_cols || ',' || CHR(10) || '                        ';
                    v_condition_columns := v_condition_columns || ',';
                    v_condition_value_expr := v_condition_value_expr || q'[ || ' | ' || ]';
                    v_condition_text_expr := v_condition_text_expr || ' || TO_CLOB(' || sql_literal(' AND ' || v_col || ' = ') || ') || CONDITION_VALUE' || i;
                    v_hash_expr := v_hash_expr || q'[ || ';' || ]';
                ELSE
                    v_condition_text_expr := 'TO_CLOB(' || sql_literal(v_col || ' = ') || ') || CONDITION_VALUE1';
                END IF;

                v_base_select := v_base_select || 'TO_CHAR(' || quote_name(v_col) || ') AS CONDITION_VALUE' || i;
                v_base_where := v_base_where || quote_name(v_col) || ' IS NOT NULL';
                v_group_cols := v_group_cols || 'CONDITION_VALUE' || i;
                v_metric_select := v_metric_select || 'P.CONDITION_VALUE' || i;
                v_join_condition := v_join_condition || 'C.CONDITION_VALUE' || i || ' = P.CONDITION_VALUE' || i;
                v_order_cols := v_order_cols || 'M.CONDITION_VALUE' || i;
                v_condition_columns := v_condition_columns || v_col;
                v_condition_value_expr := v_condition_value_expr || 'CONDITION_VALUE' || i;
                v_hash_expr := v_hash_expr || sql_literal(v_col || '=') || ' || SUBSTR(CONDITION_VALUE' || i || ', 1, 300)';
            END LOOP;

            v_sql := q'[
INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_RULEDISC_ASSOC_SUM" (
    "RUN_SOURCE_TYPE",
    "RUN_ID",
    "OWNER",
    "TARGET_OWNER",
    "TARGET_TABLE",
    "MODEL_NAME",
    "MODEL_TYPE",
    "RULE_SOURCE",
    "RULE_ID",
    "CONDITION_COUNT",
    "CONDITION_COLUMN",
    "CONDITION_VALUE",
    "RESULT_COLUMN",
    "RESULT_VALUE",
    "RESULT_HAS_VALUE_YN",
    "RULE_SUPPORT",
    "RULE_CONFIDENCE",
    "RULE_LIFT",
    "SUPPORT_COUNT",
    "CONDITION_TOTAL_COUNT",
    "RESULT_TOTAL_COUNT",
    "TOTAL_COUNT",
    "CONDITION_TEXT",
    "RESULT_TEXT",
    "CREATE_DT"
)
WITH BASE AS (
    SELECT ]' || v_base_select || q'[,
           TO_CHAR(]' || quote_name(v_result_col) || q'[) AS RESULT_VALUE
      FROM (]' || v_base_query || q'[)
     WHERE ]' || v_base_where || q'[
       AND ]' || quote_name(v_result_col) || q'[ IS NOT NULL
),
TOTALS AS (
    SELECT COUNT(*) AS TOTAL_COUNT
      FROM BASE
),
PAIR_COUNTS AS (
    SELECT ]' || v_group_cols || q'[,
           RESULT_VALUE,
           COUNT(*) AS SUPPORT_COUNT
      FROM BASE
     GROUP BY ]' || v_group_cols || q'[, RESULT_VALUE
),
CONDITION_COUNTS AS (
    SELECT ]' || v_group_cols || q'[,
           COUNT(*) AS CONDITION_TOTAL_COUNT
      FROM BASE
     GROUP BY ]' || v_group_cols || q'[
),
RESULT_COUNTS AS (
    SELECT RESULT_VALUE,
           COUNT(*) AS RESULT_TOTAL_COUNT
      FROM BASE
     GROUP BY RESULT_VALUE
),
METRICS AS (
    SELECT ]' || v_metric_select || q'[,
           P.RESULT_VALUE,
           P.SUPPORT_COUNT,
           C.CONDITION_TOTAL_COUNT,
           R.RESULT_TOTAL_COUNT,
           T.TOTAL_COUNT,
           P.SUPPORT_COUNT / NULLIF(T.TOTAL_COUNT, 0) AS RULE_SUPPORT,
           P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0) AS RULE_CONFIDENCE,
           (P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0))
             / NULLIF(R.RESULT_TOTAL_COUNT / NULLIF(T.TOTAL_COUNT, 0), 0) AS RULE_LIFT
      FROM PAIR_COUNTS P
      JOIN CONDITION_COUNTS C
        ON ]' || v_join_condition || q'[
      JOIN RESULT_COUNTS R
        ON R.RESULT_VALUE = P.RESULT_VALUE
      CROSS JOIN TOTALS T
),
RANKED AS (
    SELECT M.*,
           ROW_NUMBER() OVER (
               ORDER BY M.RULE_CONFIDENCE DESC NULLS LAST,
                        M.RULE_LIFT DESC NULLS LAST,
                        M.SUPPORT_COUNT DESC NULLS LAST,
                        ]' || v_order_cols || q'[,
                        M.RESULT_VALUE
           ) AS RN__
      FROM METRICS M
     WHERE M.SUPPORT_COUNT >= ]' || TO_CHAR(v_min_support_count) || q'[
       AND M.RULE_CONFIDENCE >= ]' || TO_CHAR(v_min_confidence, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[
       AND M.RULE_LIFT >= ]' || TO_CHAR(v_min_lift, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[
)
SELECT ]' || sql_literal(v_run_source_type) || q'[,
       ]' || TO_CHAR(v_run_id, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[,
       SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'),
       ]' || sql_literal(v_target_owner) || q'[,
       ]' || sql_literal(v_target_table) || q'[,
       ]' || sql_literal(v_model_name) || q'[,
       ]' || sql_literal(v_model_type) || q'[,
       ]' || sql_literal(v_rule_source) || q'[,
       SUBSTR('COND_' || RAWTOHEX(STANDARD_HASH(]' || v_hash_expr || q'[ || '->' || ]' || sql_literal(v_result_col || '=') || q'[ || SUBSTR(RESULT_VALUE, 1, 1000), 'SHA1')), 1, 128),
       ]' || TO_CHAR(v_condition_count) || q'[,
       ]' || sql_literal(v_condition_columns) || q'[,
       SUBSTR(]' || v_condition_value_expr || q'[, 1, 4000),
       ]' || sql_literal(v_result_col) || q'[,
       SUBSTR(RESULT_VALUE, 1, 4000),
       'Y',
       RULE_SUPPORT,
       RULE_CONFIDENCE,
       RULE_LIFT,
       SUPPORT_COUNT,
       CONDITION_TOTAL_COUNT,
       RESULT_TOTAL_COUNT,
       TOTAL_COUNT,
       ]' || v_condition_text_expr || q'[,
       TO_CLOB(]' || sql_literal(v_result_col || ' = ') || q'[) || RESULT_VALUE,
       SYSDATE
  FROM RANKED
 WHERE RN__ <= ]' || TO_CHAR(v_max_rules_per_pair);

            EXECUTE IMMEDIATE v_sql;
            v_loaded_count := v_loaded_count + SQL%ROWCOUNT;
        END load_multi_condition_rule;

        PROCEDURE collect_multi_condition_rules(
            p_target_idx IN PLS_INTEGER,
            p_start_idx IN PLS_INTEGER,
            p_depth IN PLS_INTEGER,
            p_needed IN PLS_INTEGER,
            p_indexes IN OUT t_index_list
        ) IS
            v_max_idx PLS_INTEGER;
        BEGIN
            IF NOT current_budget_slot_available THEN
                RETURN;
            END IF;
            IF p_depth > p_needed THEN
                load_multi_condition_rule(p_indexes);
                RETURN;
            END IF;

            v_max_idx := v_candidates.COUNT - (p_needed - p_depth);
            IF p_start_idx > v_max_idx THEN
                RETURN;
            END IF;
            FOR idx IN p_start_idx .. v_max_idx LOOP
                EXIT WHEN NOT current_budget_slot_available;
                IF v_candidates(idx) = v_result_col THEN
                    CONTINUE;
                END IF;
                IF v_symmetric_pair_mode = 'Y' AND idx >= p_target_idx THEN
                    CONTINUE;
                END IF;
                IF p_indexes.COUNT < p_depth THEN
                    p_indexes.EXTEND;
                END IF;
                p_indexes(p_depth) := idx;
                collect_multi_condition_rules(p_target_idx, idx + 1, p_depth + 1, p_needed, p_indexes);
            END LOOP;
        END collect_multi_condition_rules;
    BEGIN
        disable_parallel_execution;

        g_last_effective_max_columns := 0;
        g_last_effective_max_rules_per_pair := 0;
        g_last_candidate_count := 0;
        g_last_requested_max_condition_count := 0;
        g_last_effective_max_condition_count := 0;
        g_last_max_rule_combinations := 0;
        g_last_estimated_combination_count := 0;
        g_last_evaluated_combination_count := 0;
        g_last_adjustment_reason := 'NONE';

        v_model_name := normalize_identifier(p_model_name, 'model_name');
        IF NOT is_null_token(p_case_id_column_name) THEN
            v_case_id_col := normalize_identifier(p_case_id_column_name, 'case_id_column_name');
        END IF;
        IF NOT is_null_token(p_target_owner) THEN
            v_target_owner := normalize_identifier(p_target_owner, 'target_owner');
        END IF;
        IF NOT is_null_token(p_target_table) THEN
            v_target_table := normalize_identifier(p_target_table, 'target_table');
        END IF;

        v_model_type := SUBSTR(UPPER(TRIM(NVL(p_model_type, 'CONDITIONAL_RULE'))), 1, 80);
        v_rule_source := SUBSTR(UPPER(TRIM(NVL(p_rule_source, 'CONDITIONAL_FREQUENCY'))), 1, 80);
        v_run_source_type := normalize_run_source_type(p_run_source_type);
        v_run_id := NVL(p_run_id, 0);
        v_base_query := clean_query(p_data_query);
        IF v_target_owner IS NULL THEN
            v_target_owner := NVL(infer_query_owner(v_base_query), SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'));
        END IF;
        IF v_target_table IS NULL THEN
            v_target_table := NVL(infer_query_table(v_base_query), 'UNKNOWN');
        END IF;
        v_min_support_count := GREATEST(1, NVL(p_min_support_count, 30));
        v_min_confidence := GREATEST(0, LEAST(1, NVL(p_min_confidence, 0.7)));
        v_min_lift := GREATEST(0, NVL(p_min_lift, 1));
        v_max_columns := GREATEST(2, LEAST(80, TRUNC(NVL(p_max_columns, 25))));
        v_max_rules_per_pair := GREATEST(1, LEAST(200, TRUNC(NVL(p_max_rules_per_pair, 25))));
        v_max_input_rows := CASE WHEN p_max_input_rows IS NULL OR p_max_input_rows <= 0 THEN NULL ELSE LEAST(p_max_input_rows, 1000000) END;
        v_requested_max_condition_count := GREATEST(1, TRUNC(NVL(p_max_condition_count, 5)));
        v_normalized_max_condition_count := LEAST(5, v_requested_max_condition_count);
        v_max_rule_combinations := GREATEST(1, LEAST(100000, TRUNC(NVL(p_max_rule_combinations, 1000))));

        IF NVL(p_max_columns, 25) <> v_max_columns THEN
            append_adjustment_reason('Candidate column limit was constrained to the supported range 2..80.');
        END IF;
        IF NVL(p_max_rules_per_pair, 25) <> v_max_rules_per_pair THEN
            append_adjustment_reason('Rules-per-combination limit was constrained to the supported range 1..200.');
        END IF;
        IF NVL(p_max_condition_count, 5) <> v_normalized_max_condition_count THEN
            append_adjustment_reason('Condition count was constrained to the supported range 1..5.');
        END IF;
        IF NVL(p_max_rule_combinations, 1000) <> v_max_rule_combinations THEN
            append_adjustment_reason('Combination budget was constrained to the supported range 1..100000.');
        END IF;

        IF v_max_input_rows IS NOT NULL THEN
            v_base_query := 'SELECT * FROM (' || v_base_query || ') WHERE ROWNUM <= ' || TO_CHAR(v_max_input_rows);
        END IF;

        IF NOT is_null_token(p_candidate_columns) THEN
            v_candidates := split_columns(p_candidate_columns, v_case_id_col, v_max_columns);
        ELSE
            v_described_candidates := describe_query_columns(v_base_query, v_case_id_col, v_max_columns);
            v_candidates := correlated_pair_columns(
                v_described_candidates,
                v_case_id_col,
                v_max_columns,
                v_target_owner,
                v_target_table,
                v_run_source_type,
                v_run_id
            );

            IF v_candidates.COUNT > 0 THEN
                DBMS_OUTPUT.PUT_LINE('[INFO] Candidate columns loaded from INIT$_TB_COLREL_CAT_PAIR PASS_YN=Y: '
                    || v_candidates.COUNT || ' columns for ' || v_target_owner || '.' || v_target_table);
            ELSE
                v_candidates := v_described_candidates;
                DBMS_OUTPUT.PUT_LINE('[WARN] PASS_YN=Y correlated columns not found. Fallback to described query columns: '
                    || v_candidates.COUNT || ' columns.');
            END IF;
        END IF;

        IF NOT is_null_token(p_target_columns) THEN
            v_targets := split_columns(p_target_columns, NULL, v_max_columns);
        ELSE
            v_targets := v_candidates;
            v_symmetric_pair_mode := 'Y';
        END IF;

        IF v_candidates.COUNT = 0 OR v_targets.COUNT = 0 THEN
            g_last_effective_max_columns := v_max_columns;
            g_last_effective_max_rules_per_pair := v_max_rules_per_pair;
            g_last_candidate_count := v_candidates.COUNT;
            g_last_requested_max_condition_count := v_requested_max_condition_count;
            g_last_effective_max_condition_count := 0;
            g_last_max_rule_combinations := v_max_rule_combinations;
            g_last_estimated_combination_count := 0;
            g_last_evaluated_combination_count := 0;
            append_adjustment_reason('No usable candidate or target columns were found.');
            g_last_adjustment_reason := v_adjustment_reason;
            DBMS_OUTPUT.PUT_LINE('[WARN] Conditional rule summary skipped. No usable candidate/target columns.');
            RETURN;
        END IF;

        FOR target_idx IN 1 .. v_targets.COUNT LOOP
            v_target_available_count := v_candidates.COUNT;
            IF contains_column(v_candidates, v_targets(target_idx)) THEN
                v_target_available_count := v_target_available_count - 1;
            END IF;
            v_max_possible_condition_count := GREATEST(
                v_max_possible_condition_count,
                v_target_available_count
            );
        END LOOP;
        v_max_possible_condition_count := LEAST(5, v_max_possible_condition_count);
        v_effective_max_condition_count := LEAST(
            v_normalized_max_condition_count,
            v_max_possible_condition_count
        );

        IF v_effective_max_condition_count < v_normalized_max_condition_count THEN
            append_adjustment_reason(
                'Condition count was reduced because only '
                || v_max_possible_condition_count
                || ' distinct condition column(s) are available for a target.'
            );
        END IF;

        v_estimated_combination_count := estimate_rule_combinations(v_effective_max_condition_count);
        IF v_symmetric_pair_mode = 'Y' THEN
            v_budget_slot_count := 0;
            FOR target_idx IN 1 .. v_targets.COUNT LOOP
                v_budget_slot_count := v_budget_slot_count + LEAST(
                    v_effective_max_condition_count,
                    GREATEST(0, target_idx - 1)
                );
            END LOOP;
            v_budget_slot_count := GREATEST(1, v_budget_slot_count);
        ELSE
            v_budget_slot_count := GREATEST(1, v_targets.COUNT * v_effective_max_condition_count);
        END IF;
        v_budget_per_slot := FLOOR(v_max_rule_combinations / v_budget_slot_count);
        v_budget_remainder := MOD(v_max_rule_combinations, v_budget_slot_count);

        IF v_estimated_combination_count > v_max_rule_combinations THEN
            append_adjustment_reason(
                'The combination space exceeds the evaluation budget of '
                || v_max_rule_combinations
                || '; the budget was distributed across target and condition-size groups without reducing the requested condition count.'
            );
        END IF;

        g_last_effective_max_columns := v_max_columns;
        g_last_effective_max_rules_per_pair := v_max_rules_per_pair;
        g_last_candidate_count := v_candidates.COUNT;
        g_last_requested_max_condition_count := v_requested_max_condition_count;
        g_last_effective_max_condition_count := v_effective_max_condition_count;
        g_last_max_rule_combinations := v_max_rule_combinations;
        g_last_estimated_combination_count := v_estimated_combination_count;
        g_last_adjustment_reason := v_adjustment_reason;

        DBMS_OUTPUT.PUT_LINE('[INFO] Conditional rule limits: requestedColumns=' || NVL(TO_CHAR(p_max_columns), '(default)')
            || ', effectiveColumnLimit=' || v_max_columns
            || ', selectedCandidates=' || v_candidates.COUNT
            || ', requestedRulesPerCombination=' || NVL(TO_CHAR(p_max_rules_per_pair), '(default)')
            || ', effectiveRulesPerCombination=' || v_max_rules_per_pair
            || ', requestedMaxConditions=' || v_requested_max_condition_count
            || ', effectiveMaxConditions=' || v_effective_max_condition_count
            || ', maxCombinations=' || v_max_rule_combinations
            || ', estimatedCombinations=' || v_estimated_combination_count
            || ', adjustmentReason=' || v_adjustment_reason);

        IF UPPER(TRIM(NVL(p_clear_existing_yn, 'Y'))) = 'Y' THEN
            DELETE /*+ NO_PARALLEL */ FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
             WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
               AND "RUN_SOURCE_TYPE" = v_run_source_type
               AND "RUN_ID" = v_run_id
               AND "TARGET_OWNER" = v_target_owner
               AND "TARGET_TABLE" = v_target_table
               AND "MODEL_NAME" = v_model_name;
        END IF;

        FOR target_idx IN 1 .. v_targets.COUNT LOOP
            EXIT WHEN v_evaluated_combination_count >= v_max_rule_combinations;
            v_result_col := v_targets(target_idx);

            begin_combination_budget_slot(target_idx, 1);
            IF v_effective_max_condition_count >= 1 THEN
                FOR cond_idx IN 1 .. v_candidates.COUNT LOOP
                    EXIT WHEN NOT current_budget_slot_available;
                    v_condition_col := v_candidates(cond_idx);
                    IF v_condition_col = v_result_col THEN
                        CONTINUE;
                    END IF;
                    IF v_symmetric_pair_mode = 'Y' AND cond_idx >= target_idx THEN
                        CONTINUE;
                    END IF;

                    mark_combination_evaluated;

                    v_sql := q'[
INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_RULEDISC_ASSOC_SUM" (
    "RUN_SOURCE_TYPE",
    "RUN_ID",
    "OWNER",
    "TARGET_OWNER",
    "TARGET_TABLE",
    "MODEL_NAME",
    "MODEL_TYPE",
    "RULE_SOURCE",
    "RULE_ID",
    "CONDITION_COUNT",
    "CONDITION_COLUMN",
    "CONDITION_VALUE",
    "RESULT_COLUMN",
    "RESULT_VALUE",
    "RESULT_HAS_VALUE_YN",
    "RULE_SUPPORT",
    "RULE_CONFIDENCE",
    "RULE_LIFT",
    "SUPPORT_COUNT",
    "CONDITION_TOTAL_COUNT",
    "RESULT_TOTAL_COUNT",
    "TOTAL_COUNT",
    "CONDITION_TEXT",
    "RESULT_TEXT",
    "CREATE_DT"
)
WITH BASE AS (
    SELECT TO_CHAR(]' || quote_name(v_condition_col) || q'[) AS CONDITION_VALUE,
           TO_CHAR(]' || quote_name(v_result_col) || q'[) AS RESULT_VALUE
      FROM (]' || v_base_query || q'[)
     WHERE ]' || quote_name(v_condition_col) || q'[ IS NOT NULL
       AND ]' || quote_name(v_result_col) || q'[ IS NOT NULL
),
TOTALS AS (
    SELECT COUNT(*) AS TOTAL_COUNT
      FROM BASE
),
PAIR_COUNTS AS (
    SELECT CONDITION_VALUE,
           RESULT_VALUE,
           COUNT(*) AS SUPPORT_COUNT
      FROM BASE
     GROUP BY CONDITION_VALUE, RESULT_VALUE
),
CONDITION_COUNTS AS (
    SELECT CONDITION_VALUE,
           COUNT(*) AS CONDITION_TOTAL_COUNT
      FROM BASE
     GROUP BY CONDITION_VALUE
),
RESULT_COUNTS AS (
    SELECT RESULT_VALUE,
           COUNT(*) AS RESULT_TOTAL_COUNT
      FROM BASE
     GROUP BY RESULT_VALUE
),
METRICS AS (
    SELECT P.CONDITION_VALUE,
           P.RESULT_VALUE,
           P.SUPPORT_COUNT,
           C.CONDITION_TOTAL_COUNT,
           R.RESULT_TOTAL_COUNT,
           T.TOTAL_COUNT,
           P.SUPPORT_COUNT / NULLIF(T.TOTAL_COUNT, 0) AS RULE_SUPPORT,
           P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0) AS RULE_CONFIDENCE,
           (P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0))
             / NULLIF(R.RESULT_TOTAL_COUNT / NULLIF(T.TOTAL_COUNT, 0), 0) AS RULE_LIFT
      FROM PAIR_COUNTS P
      JOIN CONDITION_COUNTS C
        ON C.CONDITION_VALUE = P.CONDITION_VALUE
      JOIN RESULT_COUNTS R
        ON R.RESULT_VALUE = P.RESULT_VALUE
      CROSS JOIN TOTALS T
),
RANKED AS (
    SELECT M.*,
           ROW_NUMBER() OVER (
               ORDER BY M.RULE_CONFIDENCE DESC NULLS LAST,
                        M.RULE_LIFT DESC NULLS LAST,
                        M.SUPPORT_COUNT DESC NULLS LAST,
                        M.CONDITION_VALUE,
                        M.RESULT_VALUE
           ) AS RN__
      FROM METRICS M
     WHERE M.SUPPORT_COUNT >= ]' || TO_CHAR(v_min_support_count) || q'[
       AND M.RULE_CONFIDENCE >= ]' || TO_CHAR(v_min_confidence, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[
       AND M.RULE_LIFT >= ]' || TO_CHAR(v_min_lift, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[
)
SELECT ]' || sql_literal(v_run_source_type) || q'[,
       ]' || TO_CHAR(v_run_id, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[,
       SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'),
       ]' || sql_literal(v_target_owner) || q'[,
       ]' || sql_literal(v_target_table) || q'[,
       ]' || sql_literal(v_model_name) || q'[,
       ]' || sql_literal(v_model_type) || q'[,
       ]' || sql_literal(v_rule_source) || q'[,
       SUBSTR('COND_' || RAWTOHEX(STANDARD_HASH(]' || sql_literal(v_condition_col || '=') || q'[ || SUBSTR(CONDITION_VALUE, 1, 1000) || '->' || ]' || sql_literal(v_result_col || '=') || q'[ || SUBSTR(RESULT_VALUE, 1, 1000), 'SHA1')), 1, 128),
       1,
       ]' || sql_literal(v_condition_col) || q'[,
       SUBSTR(CONDITION_VALUE, 1, 4000),
       ]' || sql_literal(v_result_col) || q'[,
       SUBSTR(RESULT_VALUE, 1, 4000),
       'Y',
       RULE_SUPPORT,
       RULE_CONFIDENCE,
       RULE_LIFT,
       SUPPORT_COUNT,
       CONDITION_TOTAL_COUNT,
       RESULT_TOTAL_COUNT,
       TOTAL_COUNT,
       TO_CLOB(]' || sql_literal(v_condition_col || ' = ') || q'[) || CONDITION_VALUE,
       TO_CLOB(]' || sql_literal(v_result_col || ' = ') || q'[) || RESULT_VALUE,
       SYSDATE
  FROM RANKED
 WHERE RN__ <= ]' || TO_CHAR(v_max_rules_per_pair);

                    EXECUTE IMMEDIATE v_sql;
                    v_loaded_count := v_loaded_count + SQL%ROWCOUNT;
                END LOOP;
            END IF;

            begin_combination_budget_slot(target_idx, 2);
            IF current_budget_slot_available
               AND v_effective_max_condition_count >= 2
               AND v_candidates.COUNT >= 2 THEN
                FOR cond1_idx IN 1 .. v_candidates.COUNT - 1 LOOP
                    EXIT WHEN NOT current_budget_slot_available;
                    v_condition_col := v_candidates(cond1_idx);
                    IF v_condition_col = v_result_col THEN
                        CONTINUE;
                    END IF;

                    FOR cond2_idx IN cond1_idx + 1 .. v_candidates.COUNT LOOP
                        EXIT WHEN NOT current_budget_slot_available;
                        v_condition_col2 := v_candidates(cond2_idx);
                        IF v_condition_col2 = v_result_col THEN
                            CONTINUE;
                        END IF;
                        IF v_symmetric_pair_mode = 'Y' AND cond2_idx >= target_idx THEN
                            CONTINUE;
                        END IF;

                        mark_combination_evaluated;

                        v_sql := q'[
INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_RULEDISC_ASSOC_SUM" (
    "RUN_SOURCE_TYPE",
    "RUN_ID",
    "OWNER",
    "TARGET_OWNER",
    "TARGET_TABLE",
    "MODEL_NAME",
    "MODEL_TYPE",
    "RULE_SOURCE",
    "RULE_ID",
    "CONDITION_COUNT",
    "CONDITION_COLUMN",
    "CONDITION_VALUE",
    "RESULT_COLUMN",
    "RESULT_VALUE",
    "RESULT_HAS_VALUE_YN",
    "RULE_SUPPORT",
    "RULE_CONFIDENCE",
    "RULE_LIFT",
    "SUPPORT_COUNT",
    "CONDITION_TOTAL_COUNT",
    "RESULT_TOTAL_COUNT",
    "TOTAL_COUNT",
    "CONDITION_TEXT",
    "RESULT_TEXT",
    "CREATE_DT"
)
WITH BASE AS (
    SELECT TO_CHAR(]' || quote_name(v_condition_col) || q'[) AS CONDITION_VALUE1,
           TO_CHAR(]' || quote_name(v_condition_col2) || q'[) AS CONDITION_VALUE2,
           TO_CHAR(]' || quote_name(v_result_col) || q'[) AS RESULT_VALUE
      FROM (]' || v_base_query || q'[)
     WHERE ]' || quote_name(v_condition_col) || q'[ IS NOT NULL
       AND ]' || quote_name(v_condition_col2) || q'[ IS NOT NULL
       AND ]' || quote_name(v_result_col) || q'[ IS NOT NULL
),
TOTALS AS (
    SELECT COUNT(*) AS TOTAL_COUNT
      FROM BASE
),
PAIR_COUNTS AS (
    SELECT CONDITION_VALUE1,
           CONDITION_VALUE2,
           RESULT_VALUE,
           COUNT(*) AS SUPPORT_COUNT
      FROM BASE
     GROUP BY CONDITION_VALUE1, CONDITION_VALUE2, RESULT_VALUE
),
CONDITION_COUNTS AS (
    SELECT CONDITION_VALUE1,
           CONDITION_VALUE2,
           COUNT(*) AS CONDITION_TOTAL_COUNT
      FROM BASE
     GROUP BY CONDITION_VALUE1, CONDITION_VALUE2
),
RESULT_COUNTS AS (
    SELECT RESULT_VALUE,
           COUNT(*) AS RESULT_TOTAL_COUNT
      FROM BASE
     GROUP BY RESULT_VALUE
),
METRICS AS (
    SELECT P.CONDITION_VALUE1,
           P.CONDITION_VALUE2,
           P.RESULT_VALUE,
           P.SUPPORT_COUNT,
           C.CONDITION_TOTAL_COUNT,
           R.RESULT_TOTAL_COUNT,
           T.TOTAL_COUNT,
           P.SUPPORT_COUNT / NULLIF(T.TOTAL_COUNT, 0) AS RULE_SUPPORT,
           P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0) AS RULE_CONFIDENCE,
           (P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0))
             / NULLIF(R.RESULT_TOTAL_COUNT / NULLIF(T.TOTAL_COUNT, 0), 0) AS RULE_LIFT
      FROM PAIR_COUNTS P
      JOIN CONDITION_COUNTS C
        ON C.CONDITION_VALUE1 = P.CONDITION_VALUE1
       AND C.CONDITION_VALUE2 = P.CONDITION_VALUE2
      JOIN RESULT_COUNTS R
        ON R.RESULT_VALUE = P.RESULT_VALUE
      CROSS JOIN TOTALS T
),
RANKED AS (
    SELECT M.*,
           ROW_NUMBER() OVER (
               ORDER BY M.RULE_CONFIDENCE DESC NULLS LAST,
                        M.RULE_LIFT DESC NULLS LAST,
                        M.SUPPORT_COUNT DESC NULLS LAST,
                        M.CONDITION_VALUE1,
                        M.CONDITION_VALUE2,
                        M.RESULT_VALUE
           ) AS RN__
      FROM METRICS M
     WHERE M.SUPPORT_COUNT >= ]' || TO_CHAR(v_min_support_count) || q'[
       AND M.RULE_CONFIDENCE >= ]' || TO_CHAR(v_min_confidence, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[
       AND M.RULE_LIFT >= ]' || TO_CHAR(v_min_lift, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[
)
SELECT ]' || sql_literal(v_run_source_type) || q'[,
       ]' || TO_CHAR(v_run_id, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'[,
       SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'),
       ]' || sql_literal(v_target_owner) || q'[,
       ]' || sql_literal(v_target_table) || q'[,
       ]' || sql_literal(v_model_name) || q'[,
       ]' || sql_literal(v_model_type) || q'[,
       ]' || sql_literal(v_rule_source) || q'[,
       SUBSTR('COND_' || RAWTOHEX(STANDARD_HASH(]' || sql_literal(v_condition_col || '=') || q'[ || SUBSTR(CONDITION_VALUE1, 1, 1000) || ';' || ]' || sql_literal(v_condition_col2 || '=') || q'[ || SUBSTR(CONDITION_VALUE2, 1, 1000) || '->' || ]' || sql_literal(v_result_col || '=') || q'[ || SUBSTR(RESULT_VALUE, 1, 1000), 'SHA1')), 1, 128),
       2,
       ]' || sql_literal(v_condition_col || ',' || v_condition_col2) || q'[,
       SUBSTR(CONDITION_VALUE1 || ' | ' || CONDITION_VALUE2, 1, 4000),
       ]' || sql_literal(v_result_col) || q'[,
       SUBSTR(RESULT_VALUE, 1, 4000),
       'Y',
       RULE_SUPPORT,
       RULE_CONFIDENCE,
       RULE_LIFT,
       SUPPORT_COUNT,
       CONDITION_TOTAL_COUNT,
       RESULT_TOTAL_COUNT,
       TOTAL_COUNT,
       TO_CLOB(]' || sql_literal(v_condition_col || ' = ') || q'[) || CONDITION_VALUE1 || TO_CLOB(' AND ' || ]' || sql_literal(v_condition_col2 || ' = ') || q'[) || CONDITION_VALUE2,
       TO_CLOB(]' || sql_literal(v_result_col || ' = ') || q'[) || RESULT_VALUE,
       SYSDATE
  FROM RANKED
 WHERE RN__ <= ]' || TO_CHAR(v_max_rules_per_pair);

                        EXECUTE IMMEDIATE v_sql;
                        v_loaded_count := v_loaded_count + SQL%ROWCOUNT;
                    END LOOP;
                END LOOP;
            END IF;

            IF v_effective_max_condition_count >= 3
               AND v_candidates.COUNT >= 4 THEN
                FOR condition_size IN 3 .. LEAST(v_effective_max_condition_count, v_candidates.COUNT - 1) LOOP
                    begin_combination_budget_slot(target_idx, condition_size);
                    CONTINUE WHEN NOT current_budget_slot_available;
                    DECLARE
                        v_indexes t_index_list := t_index_list();
                    BEGIN
                        collect_multi_condition_rules(target_idx, 1, 1, condition_size, v_indexes);
                    END;
                END LOOP;
            END IF;
        END LOOP;

        g_last_evaluated_combination_count := v_evaluated_combination_count;
        g_last_adjustment_reason := v_adjustment_reason;

        DBMS_OUTPUT.PUT_LINE('[OK] Conditional rule summary loaded: ' || v_loaded_count
            || ' rows (model=' || v_model_name
            || ', candidates=' || v_candidates.COUNT
            || ', targets=' || v_targets.COUNT
            || ', evaluatedCombinations=' || v_evaluated_combination_count
            || ', source=' || v_rule_source || ')');
    EXCEPTION
        WHEN OTHERS THEN
            g_last_evaluated_combination_count := v_evaluated_combination_count;
            ROLLBACK;
            RAISE;
    END LOAD_CONDITIONAL_RULES;
END "INIT$_PKG_RULE_SUMMARY";
/

