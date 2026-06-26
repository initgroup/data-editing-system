SET SERVEROUTPUT ON;

-- INIT_MODEL_OBJECTS
-- Purpose:
--   Deploy project-provided model packages, procedures, and functions to a
--   selected target DB. Keep Oracle built-in packages out of this file.
--
-- Version:
--   Change the value below whenever model objects are patched.
--
-- Authoring rule:
--   Paste CREATE OR REPLACE source text as-is.
--   "/" terminators are supported, but not required when each object starts
--   with CREATE OR REPLACE PROCEDURE/FUNCTION/PACKAGE/PACKAGE BODY.
--   Internal PL/SQL semicolons are preserved and are not used as delimiters.
--
--   CREATE OR REPLACE PROCEDURE SP_SAMPLE AS
--   BEGIN
--       NULL;
--   END;
--   /
--
--   CREATE OR REPLACE PACKAGE PKG_SAMPLE AS
--       PROCEDURE RUN;
--   END PKG_SAMPLE;
--   /
--
--   CREATE OR REPLACE PACKAGE BODY PKG_SAMPLE AS
--       PROCEDURE RUN AS
--       BEGIN
--           NULL;
--       END;
--   END PKG_SAMPLE;
--   /

DECLARE
    v_version CONSTANT VARCHAR2(50) := '1.0.8';
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL OBJECTS DEPLOY START ===');
    DBMS_OUTPUT.PUT_LINE('[INFO] Bundle version: ' || v_version);
    DBMS_OUTPUT.PUT_LINE('[INFO] Add CREATE OR REPLACE model objects to database/INIT_MODEL_OBJECTS.sql.');
    DBMS_OUTPUT.PUT_LINE('[INFO] Deploy status is recorded by M91001 after execution.');
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL OBJECTS DEPLOY END ===');
END;
/

CREATE OR REPLACE PACKAGE "INIT$_PKG_OML_SCRIPT" AS
    FUNCTION HAS_CREATE_API RETURN VARCHAR2;
    PROCEDURE CREATE_SCRIPT(
        p_script_name IN VARCHAR2,
        p_script_source IN CLOB
    );
END "INIT$_PKG_OML_SCRIPT";
/

CREATE OR REPLACE PACKAGE BODY "INIT$_PKG_OML_SCRIPT" AS
    FUNCTION HAS_CREATE_API RETURN VARCHAR2 IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM ALL_OBJECTS
         WHERE UPPER(OBJECT_NAME) = 'PYQSCRIPTCREATE'
           AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION');

        IF v_count > 0 THEN
            RETURN 'Y';
        END IF;

        SELECT COUNT(*)
          INTO v_count
          FROM ALL_PROCEDURES
         WHERE UPPER(OBJECT_NAME) = 'PYQSCRIPTCREATE'
            OR UPPER(PROCEDURE_NAME) = 'PYQSCRIPTCREATE';

        IF v_count > 0 THEN
            RETURN 'Y';
        END IF;

        SELECT COUNT(*)
          INTO v_count
          FROM ALL_SYNONYMS
         WHERE UPPER(SYNONYM_NAME) = 'PYQSCRIPTCREATE';

        IF v_count > 0 THEN
            RETURN 'Y';
        END IF;

        RETURN 'N';
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 'N';
    END HAS_CREATE_API;

    PROCEDURE APPEND_ERROR(
        p_errors IN OUT VARCHAR2,
        p_label IN VARCHAR2,
        p_error IN VARCHAR2
    ) IS
    BEGIN
        IF p_errors IS NOT NULL THEN
            p_errors := p_errors || ' | ';
        END IF;
        p_errors := SUBSTR(p_errors || p_label || ': ' || p_error, 1, 3000);
    END APPEND_ERROR;

    PROCEDURE VERIFY_REGISTERED(p_script_name IN VARCHAR2) IS
        v_count NUMBER;
    BEGIN
        EXECUTE IMMEDIATE
            'SELECT COUNT(*) FROM USER_PYQ_SCRIPTS WHERE UPPER(NAME) = :script_name'
            INTO v_count
            USING UPPER(p_script_name);

        IF v_count = 0 THEN
            RAISE_APPLICATION_ERROR(
                -20073,
                'OML4Py script create call completed, but ' || p_script_name || ' was not found in USER_PYQ_SCRIPTS.'
            );
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -20073 THEN
                RAISE;
            END IF;
            RAISE_APPLICATION_ERROR(
                -20074,
                'USER_PYQ_SCRIPTS verification failed: ' || SQLERRM
            );
    END VERIFY_REGISTERED;

    PROCEDURE CREATE_SCRIPT(
        p_script_name IN VARCHAR2,
        p_script_source IN CLOB
    ) IS
        v_errors VARCHAR2(3000);
    BEGIN
        IF p_script_name IS NULL OR NOT REGEXP_LIKE(p_script_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20070, 'Invalid OML4Py script name.');
        END IF;

        IF p_script_source IS NULL OR DBMS_LOB.GETLENGTH(p_script_source) = 0 THEN
            RAISE_APPLICATION_ERROR(-20071, 'OML4Py script source is required.');
        END IF;

        IF HAS_CREATE_API() <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20072, 'PYQSCRIPTCREATE API is not visible in this DB session.');
        END IF;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN SYS.PYQSCRIPTCREATE(v_script_name => :script_name, v_script => :script_source, v_overwrite => TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'SYS.PYQSCRIPTCREATE(v_script_name,v_script,v_overwrite)', SQLERRM);
        END;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN SYS.PYQSCRIPTCREATE(script_name => :script_name, script => :script_source, overwrite => TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'SYS.PYQSCRIPTCREATE(script_name,script,overwrite)', SQLERRM);
        END;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN SYS.PYQSCRIPTCREATE(name => :script_name, script => :script_source, overwrite => TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'SYS.PYQSCRIPTCREATE(name,script,overwrite)', SQLERRM);
        END;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN SYS.PYQSCRIPTCREATE(:script_name, :script_source, TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'SYS.PYQSCRIPTCREATE(name,script,TRUE)', SQLERRM);
        END;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN SYS.PYQSCRIPTCREATE(:script_name, :script_source, FALSE, TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'SYS.PYQSCRIPTCREATE(name,script,FALSE,TRUE)', SQLERRM);
        END;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN PYQSCRIPTCREATE(:script_name, :script_source, TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'PYQSCRIPTCREATE(name,script,TRUE)', SQLERRM);
        END;

        BEGIN
            EXECUTE IMMEDIATE
                'BEGIN PYQSCRIPTCREATE(:script_name, :script_source, FALSE, TRUE); END;'
                USING p_script_name, p_script_source;
            VERIFY_REGISTERED(p_script_name);
            RETURN;
        EXCEPTION
            WHEN OTHERS THEN
                APPEND_ERROR(v_errors, 'PYQSCRIPTCREATE(name,script,FALSE,TRUE)', SQLERRM);
        END;

        RAISE_APPLICATION_ERROR(
            -20075,
            'OML4Py script repository registration failed. ' || SUBSTR(v_errors, 1, 1800)
        );
    END CREATE_SCRIPT;
END "INIT$_PKG_OML_SCRIPT";
/

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
        p_target_table        IN VARCHAR2 DEFAULT NULL
    );
END "INIT$_PKG_RULE_SUMMARY";
/

CREATE OR REPLACE PACKAGE BODY "INIT$_PKG_RULE_SUMMARY" AS
    TYPE t_column_list IS TABLE OF VARCHAR2(128);
    TYPE t_index_list IS TABLE OF PLS_INTEGER;

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
        p_target_table IN VARCHAR2
    ) RETURN t_column_list IS
        v_cols t_column_list := t_column_list();
        v_limit PLS_INTEGER := GREATEST(1, NVL(p_max_columns, 25));
    BEGIN
        IF p_target_owner IS NULL OR p_target_table IS NULL THEN
            RETURN v_cols;
        END IF;

        IF NOT table_exists('INIT$_TB_CAT_CORR_PAIR') THEN
            RETURN v_cols;
        END IF;

        FOR corr_rec IN (
            SELECT COL1
              FROM (
                    SELECT DISTINCT COL1
                      FROM (
                            SELECT "COL_A" AS COL1
                              FROM "INIT$_TB_CAT_CORR_PAIR"
                             WHERE "OWNER" = p_target_owner
                               AND "TABLE_NAME" = p_target_table
                               AND "PASS_YN" = 'Y'
                            UNION
                            SELECT "COL_B" AS COL1
                              FROM "INIT$_TB_CAT_CORR_PAIR"
                             WHERE "OWNER" = p_target_owner
                               AND "TABLE_NAME" = p_target_table
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
        p_target_table        IN VARCHAR2 DEFAULT NULL
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
        v_effective_max_condition_count NUMBER := 1;
        v_loaded_count NUMBER := 0;
        v_symmetric_pair_mode VARCHAR2(1) := 'N';

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
INSERT INTO "INIT$_TB_ASSOC_RULE_SUMMARY" (
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
SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'),
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
            IF p_depth > p_needed THEN
                load_multi_condition_rule(p_indexes);
                RETURN;
            END IF;

            v_max_idx := v_candidates.COUNT - (p_needed - p_depth);
            IF p_start_idx > v_max_idx THEN
                RETURN;
            END IF;
            FOR idx IN p_start_idx .. v_max_idx LOOP
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
        v_max_columns := GREATEST(2, LEAST(80, NVL(p_max_columns, 25)));
        v_max_rules_per_pair := GREATEST(1, LEAST(200, NVL(p_max_rules_per_pair, 25)));
        v_max_input_rows := CASE WHEN p_max_input_rows IS NULL OR p_max_input_rows <= 0 THEN NULL ELSE LEAST(p_max_input_rows, 1000000) END;

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
                v_target_table
            );

            IF v_candidates.COUNT > 0 THEN
                DBMS_OUTPUT.PUT_LINE('[INFO] Candidate columns loaded from INIT$_TB_CAT_CORR_PAIR PASS_YN=Y: '
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
            DBMS_OUTPUT.PUT_LINE('[WARN] Conditional rule summary skipped. No usable candidate/target columns.');
            RETURN;
        END IF;

        v_effective_max_condition_count :=
            CASE
                WHEN v_candidates.COUNT <= 6 THEN 5
                WHEN v_candidates.COUNT <= 9 THEN 3
                WHEN v_candidates.COUNT <= 15 THEN 2
                ELSE 1
            END;

        IF v_effective_max_condition_count < 5 THEN
            DBMS_OUTPUT.PUT_LINE('[WARN] Conditional rule max condition count adjusted to '
                || v_effective_max_condition_count
                || ' because candidate column count is '
                || v_candidates.COUNT
                || '. Limit candidate columns to 6 or fewer to calculate up to 5 conditions safely.');
        END IF;

        IF UPPER(TRIM(NVL(p_clear_existing_yn, 'Y'))) = 'Y' THEN
            DELETE FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
             WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
               AND "TARGET_OWNER" = v_target_owner
               AND "TARGET_TABLE" = v_target_table
               AND "MODEL_NAME" = v_model_name;
        END IF;

        FOR target_idx IN 1 .. v_targets.COUNT LOOP
            v_result_col := v_targets(target_idx);

            FOR cond_idx IN 1 .. v_candidates.COUNT LOOP
                v_condition_col := v_candidates(cond_idx);
                IF v_condition_col = v_result_col THEN
                    CONTINUE;
                END IF;
                IF v_symmetric_pair_mode = 'Y' AND cond_idx >= target_idx THEN
                    CONTINUE;
                END IF;

                v_sql := q'[
INSERT INTO "INIT$_TB_ASSOC_RULE_SUMMARY" (
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
SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'),
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

            IF v_effective_max_condition_count >= 2 AND v_candidates.COUNT >= 2 THEN
                FOR cond1_idx IN 1 .. v_candidates.COUNT - 1 LOOP
                    v_condition_col := v_candidates(cond1_idx);
                    IF v_condition_col = v_result_col THEN
                        CONTINUE;
                    END IF;

                    FOR cond2_idx IN cond1_idx + 1 .. v_candidates.COUNT LOOP
                        v_condition_col2 := v_candidates(cond2_idx);
                        IF v_condition_col2 = v_result_col THEN
                            CONTINUE;
                        END IF;
                        IF v_symmetric_pair_mode = 'Y' AND cond2_idx >= target_idx THEN
                            CONTINUE;
                        END IF;

                        v_sql := q'[
INSERT INTO "INIT$_TB_ASSOC_RULE_SUMMARY" (
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
SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'),
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

            IF v_effective_max_condition_count >= 3 AND v_candidates.COUNT >= 4 THEN
                FOR condition_size IN 3 .. LEAST(v_effective_max_condition_count, v_candidates.COUNT - 1) LOOP
                    DECLARE
                        v_indexes t_index_list := t_index_list();
                    BEGIN
                        collect_multi_condition_rules(target_idx, 1, 1, condition_size, v_indexes);
                    END;
                END LOOP;
            END IF;
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] Conditional rule summary loaded: ' || v_loaded_count
            || ' rows (model=' || v_model_name
            || ', candidates=' || v_candidates.COUNT
            || ', targets=' || v_targets.COUNT
            || ', source=' || v_rule_source || ')');
    END LOAD_CONDITIONAL_RULES;
END "INIT$_PKG_RULE_SUMMARY";
/

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
    p_target_table        IN VARCHAR2 DEFAULT NULL
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

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_label IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128);
    BEGIN
        v_value := UPPER(TRIM(BOTH '"' FROM TRIM(p_value)));
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20206, 'Invalid ' || p_label || ' parameter: ' || SUBSTR(NVL(p_value, '(null)'), 1, 200));
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
                   AND "PASS_YN" = 'Y'
                UNION
                SELECT "COL_B" AS COLUMN_NAME
                  FROM "INIT$_TB_CAT_CORR_PAIR"
                 WHERE "OWNER" = v_target_owner
                   AND "TABLE_NAME" = v_target_table
                   AND "PASS_YN" = 'Y'
            ),
            CATEGORICAL_COLS AS (
                SELECT "COLUMN_NAME",
                       MIN(NVL("COLUMN_ID", 999999)) AS COLUMN_ID
                  FROM "INIT$_TB_PREDICTED_TYPE"
                 WHERE "OWNER" = v_target_owner
                   AND "TABLE_NAME" = v_target_table
                   AND "MODL_PREDICTED_TYPE" LIKE '%범주형'
                 GROUP BY "COLUMN_NAME"
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

        RETURN v_cols;
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
            RAISE_APPLICATION_ERROR(
                -20209,
                'No Apriori input columns found. Required columns must be both MODL_PREDICTED_TYPE LIKE ''%범주형'' and INIT$_TB_CAT_CORR_PAIR PASS_YN = ''Y'' for '
                || v_target_owner || '.' || v_target_table || '.'
            );
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
    v_model_name := UPPER(TRIM(p_model_name));
    v_case_id_col := UPPER(TRIM(p_case_id_column_name));
    v_drop_existing := CASE WHEN UPPER(TRIM(NVL(p_drop_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;

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
            p_target_table        => p_target_table
        );

        SELECT COUNT(*)
          INTO v_conditional_rule_count
          FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
         WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
           AND "TARGET_OWNER" = v_target_owner
           AND "TARGET_TABLE" = v_target_table
           AND "MODEL_NAME" = v_model_name
           AND "RULE_SOURCE" = 'CONDITIONAL_FREQUENCY';

        v_conditional_loaded := v_conditional_rule_count > 0;
    EXCEPTION
        WHEN OTHERS THEN
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

            DELETE FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
             WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
               AND "TARGET_OWNER" = v_target_owner
               AND "TARGET_TABLE" = v_target_table
               AND "MODEL_NAME" = v_model_name;

            EXECUTE IMMEDIATE
                'INSERT INTO "INIT$_TB_ASSOC_RULE_SUMMARY" (' ||
                ' "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "MODEL_TYPE", "RULE_SOURCE", "RULE_ID", "CONDITION_COUNT", "RESULT_COLUMN", "RESULT_VALUE", ' ||
                ' "RESULT_HAS_VALUE_YN", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT", "CONDITION_TEXT", "RESULT_TEXT", "CREATE_DT") ' ||
                'SELECT SYS_CONTEXT(''USERENV'', ''CURRENT_SCHEMA''), :target_owner, :target_table, :model_name, ''APRIORI_ASSOCIATION'', ''ORACLE_DM_VR'', ' || v_rule_id_expr || ', ' ||
                '       REGEXP_COUNT(NVL(' || v_antecedent_expr || ', ''''), ''<item([[:space:]>])'', 1, ''i''), ' ||
                '       REGEXP_SUBSTR(' || v_consequent_expr || ', ''<item_name>([^<]+)</item_name>'', 1, 1, ''i'', 1), ' ||
                '       REGEXP_SUBSTR(' || v_consequent_expr || ', ''<item_value>([^<]+)</item_value>'', 1, 1, ''i'', 1), ' ||
                '       CASE WHEN REGEXP_SUBSTR(' || v_consequent_expr || ', ''<item_value>([^<]+)</item_value>'', 1, 1, ''i'', 1) IS NULL THEN ''N'' ELSE ''Y'' END, ' ||
                '       ' || v_support_expr || ', ' || v_confidence_expr || ', ' || v_lift_expr || ', ' ||
                '       ' || v_antecedent_expr || ', ' || v_consequent_expr || ', SYSDATE ' ||
                '  FROM "' || REPLACE(v_rule_view_name, '"', '""') || '"'
            USING v_target_owner, v_target_table, v_model_name;

            DBMS_OUTPUT.PUT_LINE('[OK] Association rule summary loaded: ' || SQL%ROWCOUNT || ' rows');
            DBMS_OUTPUT.PUT_LINE('[INFO] Rule summary columns: rule_id=' || NVL(v_rule_id_col, '(ROWNUM)') ||
                                 ', antecedent=' || NVL(v_antecedent_col, '(none)') ||
                                 ', consequent=' || NVL(v_consequent_col, '(none)'));
        EXCEPTION
            WHEN OTHERS THEN
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
    p_target_table        IN VARCHAR2 DEFAULT NULL
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
BEGIN
    v_model_name := UPPER(TRIM(p_model_name));
    v_case_id_col := UPPER(TRIM(p_case_id_column_name));
    v_target_col := UPPER(TRIM(p_target_column_name));
    v_drop_existing := CASE WHEN UPPER(TRIM(NVL(p_drop_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;

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
        p_target_owner        => p_target_owner,
        p_target_table        => p_target_table
    );

    SELECT COUNT(*)
      INTO v_rule_count
      FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
     WHERE "OWNER" = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
       AND "TARGET_OWNER" = v_target_owner
       AND "TARGET_TABLE" = v_target_table
       AND "MODEL_NAME" = v_model_name
       AND "RULE_SOURCE" = 'TARGET_CONDITIONAL_FREQUENCY';

    DBMS_OUTPUT.PUT_LINE('[OK] Decision Tree classification model created: ' || v_model_name);
    DBMS_OUTPUT.PUT_LINE('[OK] Decision Tree target conditional rule summary loaded: ' || v_rule_count || ' rows');
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
    p_commit_yn             IN VARCHAR2 DEFAULT 'Y'
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
    v_inserted_total NUMBER := 0;

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

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    IF v_clear_existing = 'Y' THEN
        EXECUTE IMMEDIATE
            'DELETE FROM ' || v_result_object ||
            ' WHERE "TARGET_OWNER" = :target_owner' ||
            '   AND "TARGET_TABLE" = :target_table' ||
            '   AND "RULE_OWNER" = :rule_owner' ||
            '   AND "MODEL_NAME" = :model_name'
            USING v_target_owner, v_target_table, v_rule_owner, v_rule_model;
    END IF;

    FOR rule_rec IN (
        SELECT *
          FROM (
                SELECT S.*,
                       ROW_NUMBER() OVER (
                           ORDER BY S.RULE_CONFIDENCE DESC NULLS LAST,
                                    S.RULE_LIFT DESC NULLS LAST,
                                    S.SUPPORT_COUNT DESC NULLS LAST,
                                    S.RULE_ID
                       ) AS RN__
                 FROM "INIT$_TB_ASSOC_RULE_SUMMARY" S
                 WHERE S."OWNER" = v_rule_owner
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
                'INSERT INTO ' || v_result_object || ' (' ||
                '"TARGET_OWNER", "TARGET_TABLE", "RULE_OWNER", "MODEL_NAME", "RULE_ID", ' ||
                '"CASE_ID", "CASE_ROWID", "CONDITION_COUNT", "CONDITION_TEXT", "RESULT_COLUMN", ' ||
                '"EXPECTED_VALUE", "ACTUAL_VALUE", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT", ' ||
                '"SUPPORT_COUNT", "CONDITION_TOTAL_COUNT", "RESULT_TOTAL_COUNT", "TOTAL_COUNT", ' ||
                '"VIOLATION_SCORE", "VIOLATION_REASON", "CREATE_DT") ' ||
                'SELECT ' ||
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
            v_inserted_total := v_inserted_total + SQL%ROWCOUNT;
        END;
    END LOOP;

    IF v_commit = 'Y' THEN
        COMMIT;
    END IF;

    DBMS_OUTPUT.PUT_LINE('[OK] Rule violation detection completed. inserted=' || v_inserted_total ||
        ', target=' || v_target_owner || '.' || v_target_table ||
        ', model=' || v_rule_owner || '.' || v_rule_model);
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_DM_MODEL_VIEW_LIST" (
    p_model_name IN VARCHAR2,
    p_result     OUT SYS_REFCURSOR
) AUTHID CURRENT_USER IS
    v_model_name VARCHAR2(128);
BEGIN
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
        SELECT V.VIEW_TYPE,
               'DM$' || V.VIEW_TYPE || v_model_name AS VIEW_NAME,
               V.DESCRIPTION,
               O.OBJECT_TYPE,
               CASE WHEN O.OBJECT_NAME IS NULL THEN 'N' ELSE 'Y' END AS EXISTS_YN
          FROM VIEW_TYPES V
          LEFT JOIN USER_OBJECTS O
            ON O.OBJECT_NAME = 'DM$' || V.VIEW_TYPE || v_model_name
         ORDER BY V.VIEW_TYPE;
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
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_CAT_CORR_ANALYZE" (
    p_owner       IN VARCHAR2,
    p_tableName   IN VARCHAR2,
    p_min_pvalue  IN NUMBER DEFAULT 0.05,
    p_min_cramer  IN NUMBER DEFAULT 0.3,
    p_min_avg_v   IN NUMBER DEFAULT 0.5,
    p_sample_rows IN NUMBER DEFAULT 100000,
    p_max_distinct IN NUMBER DEFAULT 100,
    p_max_columns IN NUMBER DEFAULT 80
) AUTHID CURRENT_USER IS
    TYPE t_column_list IS TABLE OF VARCHAR2(128);

    v_owner       VARCHAR2(128);
    v_table_name  VARCHAR2(128);
    v_cols        t_column_list := t_column_list();
    v_col_a       VARCHAR2(128);
    v_col_b       VARCHAR2(128);
    v_sql         CLOB;
    v_row_count   NUMBER;
    v_df          NUMBER;
    v_chi_square  NUMBER;
    v_p_value     NUMBER;
    v_cramers_v   NUMBER;
    v_pass_yn     CHAR(1);
    v_sample_rows NUMBER;
    v_max_distinct NUMBER;
    v_max_columns NUMBER;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;

    FUNCTION ln_gamma(p_x IN NUMBER) RETURN NUMBER IS
        v_tmp NUMBER;
        v_ser NUMBER := 1.000000000190015;
        v_y   NUMBER := p_x;
        TYPE t_coef IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
        c t_coef;
    BEGIN
        c(1) := 76.18009172947146;
        c(2) := -86.50532032941677;
        c(3) := 24.01409824083091;
        c(4) := -1.231739572450155;
        c(5) := 0.001208650973866179;
        c(6) := -0.000005395239384953;
        v_tmp := p_x + 5.5;
        v_tmp := v_tmp - (p_x + 0.5) * LN(v_tmp);
        FOR i IN 1 .. 6 LOOP
            v_y := v_y + 1;
            v_ser := v_ser + c(i) / v_y;
        END LOOP;
        RETURN -v_tmp + LN(2.5066282746310005 * v_ser / p_x);
    END;

    FUNCTION gamma_q(p_a IN NUMBER, p_x IN NUMBER) RETURN NUMBER IS
        v_itmax CONSTANT PLS_INTEGER := 100;
        v_eps   CONSTANT NUMBER := 3.0e-7;
        v_fpmin CONSTANT NUMBER := 1.0e-30;
        v_gln   NUMBER;
        v_ap    NUMBER;
        v_sum   NUMBER;
        v_del   NUMBER;
        v_b     NUMBER;
        v_c     NUMBER;
        v_d     NUMBER;
        v_h     NUMBER;
        v_an    NUMBER;
    BEGIN
        IF p_a <= 0 OR p_x < 0 THEN
            RETURN NULL;
        END IF;
        IF p_x = 0 THEN
            RETURN 1;
        END IF;

        v_gln := ln_gamma(p_a);

        IF p_x < p_a + 1 THEN
            v_ap := p_a;
            v_sum := 1 / p_a;
            v_del := v_sum;
            FOR n IN 1 .. v_itmax LOOP
                v_ap := v_ap + 1;
                v_del := v_del * p_x / v_ap;
                v_sum := v_sum + v_del;
                EXIT WHEN ABS(v_del) < ABS(v_sum) * v_eps;
            END LOOP;
            RETURN GREATEST(0, LEAST(1, 1 - v_sum * EXP(-p_x + p_a * LN(p_x) - v_gln)));
        END IF;

        v_b := p_x + 1 - p_a;
        v_c := 1 / v_fpmin;
        v_d := 1 / v_b;
        v_h := v_d;
        FOR i IN 1 .. v_itmax LOOP
            v_an := -i * (i - p_a);
            v_b := v_b + 2;
            v_d := v_an * v_d + v_b;
            IF ABS(v_d) < v_fpmin THEN
                v_d := v_fpmin;
            END IF;
            v_c := v_b + v_an / v_c;
            IF ABS(v_c) < v_fpmin THEN
                v_c := v_fpmin;
            END IF;
            v_d := 1 / v_d;
            v_del := v_d * v_c;
            v_h := v_h * v_del;
            EXIT WHEN ABS(v_del - 1) < v_eps;
        END LOOP;
        RETURN GREATEST(0, LEAST(1, EXP(-p_x + p_a * LN(p_x) - v_gln) * v_h));
    END;

    FUNCTION chi_square_pvalue(p_chi_square IN NUMBER, p_df IN NUMBER) RETURN NUMBER IS
    BEGIN
        IF p_chi_square IS NULL OR p_df IS NULL OR p_df <= 0 THEN
            RETURN NULL;
        END IF;
        RETURN gamma_q(p_df / 2, p_chi_square / 2);
    END;
BEGIN
    v_owner := UPPER(TRIM(p_owner));
    v_table_name := UPPER(TRIM(p_tableName));
    v_sample_rows := CASE WHEN p_sample_rows IS NULL OR p_sample_rows <= 0 THEN NULL ELSE p_sample_rows END;
    v_max_distinct := CASE WHEN p_max_distinct IS NULL OR p_max_distinct <= 0 THEN 100 ELSE p_max_distinct END;
    v_max_columns := CASE WHEN p_max_columns IS NULL OR p_max_columns <= 0 THEN 80 ELSE p_max_columns END;

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20101, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20102, 'Invalid tableName parameter.');
    END IF;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_CAT_CORR_SUMMARY"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name;

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_CAT_CORR_PAIR"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name;

    SELECT COLUMN_NAME
      BULK COLLECT INTO v_cols
      FROM (
            SELECT COLUMN_NAME
              FROM (
                    SELECT COLUMN_NAME,
                           MIN(NVL(COLUMN_ID, 999999)) AS COLUMN_ID
                      FROM "INIT$_TB_PREDICTED_TYPE"
                     WHERE "OWNER" = v_owner
                       AND "TABLE_NAME" = v_table_name
                       AND "MODL_PREDICTED_TYPE" LIKE '%범주형'
                     GROUP BY COLUMN_NAME
                     ORDER BY COLUMN_ID, COLUMN_NAME
                   )
             WHERE ROWNUM <= v_max_columns
           );

    IF v_cols.COUNT < 2 THEN
        SELECT COLUMN_NAME
          BULK COLLECT INTO v_cols
          FROM (
                SELECT COLUMN_NAME
                  FROM ALL_TAB_COLUMNS
                 WHERE OWNER = v_owner
                   AND TABLE_NAME = v_table_name
                   AND COLUMN_NAME <> 'FILE_ROW_NO'
                   AND DATA_TYPE IN ('CHAR', 'NCHAR', 'VARCHAR2', 'NVARCHAR2')
                   AND NVL(NUM_DISTINCT, 0) BETWEEN 2 AND v_max_distinct
                 ORDER BY COLUMN_ID
               )
         WHERE ROWNUM <= v_max_columns;
    END IF;

    FOR i IN 1 .. v_cols.COUNT LOOP
        FOR j IN i + 1 .. v_cols.COUNT LOOP
            v_col_a := v_cols(i);
            v_col_b := v_cols(j);

            v_sql := '
WITH BASE AS (
    SELECT TO_CHAR(A_RAW) AS A_VAL,
           TO_CHAR(B_RAW) AS B_VAL
      FROM (
            SELECT ' || quote_name(v_col_a) || ' AS A_RAW,
                   ' || quote_name(v_col_b) || ' AS B_RAW
              FROM ' || quote_name(v_owner) || '.' || quote_name(v_table_name) || '
             WHERE ' || quote_name(v_col_a) || ' IS NOT NULL
               AND ' || quote_name(v_col_b) || ' IS NOT NULL
               AND (:sampleRows IS NULL OR ROWNUM <= :sampleRows)
           )
),
OBS AS (
    SELECT A_VAL, B_VAL, COUNT(*) AS OBS_CNT
      FROM BASE
     GROUP BY A_VAL, B_VAL
),
RT AS (
    SELECT A_VAL, SUM(OBS_CNT) AS ROW_CNT
      FROM OBS
     GROUP BY A_VAL
),
CT AS (
    SELECT B_VAL, SUM(OBS_CNT) AS COL_CNT
      FROM OBS
     GROUP BY B_VAL
),
TOT AS (
    SELECT COUNT(*) AS TOTAL_CNT,
           COUNT(DISTINCT A_VAL) AS R_CNT,
           COUNT(DISTINCT B_VAL) AS C_CNT
      FROM BASE
),
CHI AS (
    SELECT SUM(
               CASE
                   WHEN (RT.ROW_CNT * CT.COL_CNT / NULLIF(TOT.TOTAL_CNT, 0)) > 0
                   THEN POWER(OBS.OBS_CNT - (RT.ROW_CNT * CT.COL_CNT / TOT.TOTAL_CNT), 2)
                        / (RT.ROW_CNT * CT.COL_CNT / TOT.TOTAL_CNT)
                   ELSE 0
               END
           ) AS CHI_SQUARE
      FROM OBS
      JOIN RT
        ON RT.A_VAL = OBS.A_VAL
      JOIN CT
        ON CT.B_VAL = OBS.B_VAL
      CROSS JOIN TOT
)
SELECT TOT.TOTAL_CNT,
       (TOT.R_CNT - 1) * (TOT.C_CNT - 1) AS DF,
       CASE
           WHEN TOT.TOTAL_CNT > 0 AND TOT.R_CNT > 1 AND TOT.C_CNT > 1
           THEN CHI.CHI_SQUARE
           ELSE NULL
       END AS CHI_SQUARE,
       CASE
           WHEN TOT.TOTAL_CNT > 0 AND LEAST(TOT.R_CNT - 1, TOT.C_CNT - 1) > 0
           THEN SQRT(CHI.CHI_SQUARE / (TOT.TOTAL_CNT * LEAST(TOT.R_CNT - 1, TOT.C_CNT - 1)))
           ELSE NULL
       END AS CRAMERS_V
  FROM TOT
 CROSS JOIN CHI';

            EXECUTE IMMEDIATE v_sql
               INTO v_row_count, v_df, v_chi_square, v_cramers_v
              USING v_sample_rows, v_sample_rows;

            v_p_value := chi_square_pvalue(v_chi_square, v_df);
            v_pass_yn := CASE
                             WHEN v_p_value IS NOT NULL
                              AND v_p_value < NVL(p_min_pvalue, 0.05)
                              AND NVL(v_cramers_v, 0) > NVL(p_min_cramer, 0.3)
                             THEN 'Y'
                             ELSE 'N'
                         END;

            INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_CAT_CORR_PAIR" (
                "OWNER",
                "TABLE_NAME",
                "COL_A",
                "COL_B",
                "ROW_COUNT",
                "DF",
                "CHI_SQUARE",
                "P_VALUE",
                "CRAMERS_V",
                "PASS_YN",
                "CREATE_DT"
            ) VALUES (
                v_owner,
                v_table_name,
                v_col_a,
                v_col_b,
                v_row_count,
                v_df,
                v_chi_square,
                v_p_value,
                v_cramers_v,
                v_pass_yn,
                SYSDATE
            );
        END LOOP;
    END LOOP;

    INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_CAT_CORR_SUMMARY" (
        "OWNER",
        "TABLE_NAME",
        "COLUMN_NAME",
        "PAIR_COUNT",
        "PASS_PAIR_COUNT",
        "AVG_CRAMERS_V",
        "MAX_CRAMERS_V",
        "RANK_NO",
        "SELECTED_YN",
        "CREATE_DT"
    )
    WITH PAIRS AS (
        SELECT COL_A AS COLUMN_NAME, CRAMERS_V, PASS_YN
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
        UNION ALL
        SELECT COL_B AS COLUMN_NAME, CRAMERS_V, PASS_YN
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
    ),
    SUMMARY AS (
        SELECT COLUMN_NAME,
               COUNT(*) AS PAIR_COUNT,
               SUM(CASE WHEN PASS_YN = 'Y' THEN 1 ELSE 0 END) AS PASS_PAIR_COUNT,
               AVG(CASE WHEN PASS_YN = 'Y' THEN CRAMERS_V END) AS AVG_CRAMERS_V,
               MAX(CASE WHEN PASS_YN = 'Y' THEN CRAMERS_V END) AS MAX_CRAMERS_V
          FROM PAIRS
         GROUP BY COLUMN_NAME
    )
    SELECT v_owner,
           v_table_name,
           COLUMN_NAME,
           PAIR_COUNT,
           PASS_PAIR_COUNT,
           AVG_CRAMERS_V,
           MAX_CRAMERS_V,
           ROW_NUMBER() OVER (ORDER BY AVG_CRAMERS_V DESC NULLS LAST, COLUMN_NAME) AS RANK_NO,
           CASE WHEN NVL(AVG_CRAMERS_V, 0) >= NVL(p_min_avg_v, 0.5) THEN 'Y' ELSE 'N' END AS SELECTED_YN,
           SYSDATE
      FROM SUMMARY;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_CAT_CORR_ANALYZE analyzed '
        || v_cols.COUNT || ' categorical columns for ' || v_owner || '.' || v_table_name
        || ' (sample_rows=' || NVL(TO_CHAR(v_sample_rows), 'ALL')
        || ', max_distinct=' || v_max_distinct
        || ', max_columns=' || v_max_columns || ')');
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_PREDICTED_TYPE" (
    p_owner              IN VARCHAR2,
    p_tableName          IN VARCHAR2,
    p_dynamic_model_name IN VARCHAR2 DEFAULT 'OML_DECISION_TREE_MODEL_01'
) AUTHID CURRENT_USER IS
    v_owner      VARCHAR2(128);
    v_table_name VARCHAR2(128);
    v_model_name VARCHAR2(261);
    v_sql        CLOB;
BEGIN
    v_owner := UPPER(TRIM(p_owner));
    v_table_name := UPPER(TRIM(p_tableName));
    v_model_name := DBMS_ASSERT.QUALIFIED_SQL_NAME(UPPER(TRIM(p_dynamic_model_name)));

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20001, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20002, 'Invalid tableName parameter.');
    END IF;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_PREDICTED_TYPE"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name
       AND "MODEL_NAME" = v_model_name;

    v_sql := q'~
INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_PREDICTED_TYPE" (
    "OWNER",
    "TABLE_NAME",
    "MODEL_NAME",
    "COLUMN_ID",
    "COLUMN_NAME",
    "DATA_TYPE",
    "TOTAL_ROWS",
    "NUM_DISTINCT",
    "DIST_VAL_RT",
    "LOG_DATA_TYPE",
    "ENTROPY",
    "NORM_ENTROPY",
    "BASE_PREDICTED_TYPE",
    "MODL_PREDICTED_TYPE",
    "CREATE_DT"
)
WITH BASE_COL AS (
    SELECT C.OWNER
         , C.TABLE_NAME
         , C.COLUMN_ID
         , C.COLUMN_NAME
         , C.DATA_TYPE
         , C.NUM_DISTINCT
         , MAX(CASE
                   WHEN C.COLUMN_ID = 1
                    AND C.COLUMN_NAME = 'FILE_ROW_NO'
                   THEN C.NUM_DISTINCT
               END) OVER (PARTITION BY C.OWNER, C.TABLE_NAME) AS TOTAL_ROWS
      FROM ALL_TAB_COLUMNS C
     WHERE C.OWNER = :owner
       AND C.TABLE_NAME = :tableName
)
SELECT B.OWNER
     , B.TABLE_NAME
     , :modelName AS MODEL_NAME
     , B.COLUMN_ID
     , B.COLUMN_NAME
     , B.DATA_TYPE
     , B.TOTAL_ROWS
     , B.NUM_DISTINCT
     , ROUND(B.NUM_DISTINCT / NULLIF(B.TOTAL_ROWS, 0), 6) AS DIST_VAL_RT
     , CASE
           WHEN X.SAMPLE_NOT_NULL_COUNT = 0 THEN 'ETC'
           WHEN X.SAMPLE_NOT_NULL_COUNT = X.NUMERIC_CONVERTIBLE_COUNT THEN 'NUM'
           ELSE 'CHR'
       END AS LOG_DATA_TYPE
     , X.ENTROPY
     , X.NORM_ENTROPY
     , CASE
           WHEN B.COLUMN_NAME = 'FILE_ROW_NO' THEN '식별자'
           WHEN X.SAMPLE_NOT_NULL_COUNT = 0 THEN '기타'
           WHEN X.SAMPLE_NOT_NULL_COUNT = X.NUMERIC_CONVERTIBLE_COUNT
                AND NVL(B.NUM_DISTINCT, 0) >= 20
                AND NVL(B.NUM_DISTINCT / NULLIF(B.TOTAL_ROWS, 0), 0) >= 0.05
                AND NVL(X.NORM_ENTROPY, 0) >= 0.70
           THEN '연속형'
           ELSE '범주형'
       END AS BASE_PREDICTED_TYPE
     , PREDICTION(~' || v_model_name || q'~ USING *) AS MODL_PREDICTED_TYPE
     , SYSDATE AS CREATE_DT
  FROM BASE_COL B
       CROSS APPLY XMLTABLE(
           '/ROWSET/ROW'
           PASSING DBMS_XMLGEN.GETXMLTYPE(
               'WITH S AS (
                    SELECT "' || REPLACE(B.COLUMN_NAME, '"', '""') || '" AS COL_VALUE
                      FROM "' || REPLACE(B.OWNER, '"', '""') || '"."' || REPLACE(B.TABLE_NAME, '"', '""') || '"
                     WHERE "' || REPLACE(B.COLUMN_NAME, '"', '""') || '" IS NOT NULL
                       AND ROWNUM <= 10000
                ),
                FREQ AS (
                    SELECT COL_VALUE,
                           COUNT(*) AS CNT
                      FROM S
                     GROUP BY COL_VALUE
                ),
                TOTAL AS (
                    SELECT SUM(CNT) AS TOTAL_CNT,
                           COUNT(*) AS DIST_CNT
                      FROM FREQ
                ),
                STAT AS (
                    SELECT COUNT(*) AS SAMPLE_NOT_NULL_COUNT,
                           NVL(SUM(
                               CASE
                                   WHEN VALIDATE_CONVERSION(TRIM(COL_VALUE) AS NUMBER) = 1
                                   THEN 1
                                   ELSE 0
                               END
                           ), 0) AS NUMERIC_CONVERTIBLE_COUNT
                      FROM S
                ),
                ENT AS (
                    SELECT CASE
                               WHEN T.TOTAL_CNT = 0 THEN 0
                               ELSE -SUM((F.CNT / T.TOTAL_CNT) * LN(F.CNT / T.TOTAL_CNT))
                           END AS ENTROPY,
                           CASE
                               WHEN T.TOTAL_CNT = 0 OR T.DIST_CNT <= 1 THEN 0
                               ELSE -SUM((F.CNT / T.TOTAL_CNT) * LN(F.CNT / T.TOTAL_CNT)) / LN(T.DIST_CNT)
                           END AS NORM_ENTROPY
                      FROM FREQ F
                           CROSS JOIN TOTAL T
                     GROUP BY T.TOTAL_CNT, T.DIST_CNT
                )
                SELECT STAT.SAMPLE_NOT_NULL_COUNT,
                       STAT.NUMERIC_CONVERTIBLE_COUNT,
                       ROUND(NVL(ENT.ENTROPY, 0), 6) AS ENTROPY,
                       ROUND(NVL(ENT.NORM_ENTROPY, 0), 6) AS NORM_ENTROPY
                  FROM STAT
                       CROSS JOIN ENT'
           )
           COLUMNS
               SAMPLE_NOT_NULL_COUNT      NUMBER PATH 'SAMPLE_NOT_NULL_COUNT',
               NUMERIC_CONVERTIBLE_COUNT  NUMBER PATH 'NUMERIC_CONVERTIBLE_COUNT',
               ENTROPY                    NUMBER PATH 'ENTROPY',
               NORM_ENTROPY               NUMBER PATH 'NORM_ENTROPY'
       ) X
 ORDER BY B.COLUMN_ID~';

    EXECUTE IMMEDIATE v_sql USING v_owner, v_table_name, v_model_name;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_PREDICTED_TYPE loaded '
        || SQL%ROWCOUNT || ' column prediction rows for '
        || v_owner || '.' || v_table_name || ' using ' || v_model_name);
END;
/
