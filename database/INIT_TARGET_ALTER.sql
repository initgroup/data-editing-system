SET SERVEROUTPUT ON;

-- INIT_TARGET_ALTER
-- Purpose:
--   Patch existing target schemas without mixing ALTER logic into
--   INIT_TARGET_DDL.sql. New installations should use INIT_TARGET_DDL.sql.
--
-- Notes:
--   Oracle 12c+ can change SELECT * display order by toggling columns
--   INVISIBLE and then VISIBLE. Run this only during a maintenance window.

DECLARE
    FUNCTION table_exists(p_table_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_TABLES
         WHERE TABLE_NAME = UPPER(p_table_name);

        RETURN v_count > 0;
    END;

    FUNCTION column_exists(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND COLUMN_NAME = UPPER(p_column_name);

        RETURN v_count > 0;
    END;

    FUNCTION column_hidden_yn(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_hidden VARCHAR2(3);
    BEGIN
        SELECT NVL(HIDDEN_COLUMN, 'NO')
          INTO v_hidden
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND COLUMN_NAME = UPPER(p_column_name)
           AND ROWNUM = 1;

        RETURN v_hidden;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
    END;

    FUNCTION column_nullable_yn(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_nullable VARCHAR2(1);
    BEGIN
        SELECT NULLABLE
          INTO v_nullable
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND COLUMN_NAME = UPPER(p_column_name)
           AND ROWNUM = 1;

        RETURN v_nullable;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
    END;

    FUNCTION index_exists(p_index_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_INDEXES
         WHERE INDEX_NAME = UPPER(p_index_name);

        RETURN v_count > 0;
    END;

    FUNCTION constraint_exists(p_constraint_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_CONSTRAINTS
         WHERE CONSTRAINT_NAME = UPPER(p_constraint_name);

        RETURN v_count > 0;
    END;

    PROCEDURE run_ddl(p_name IN VARCHAR2, p_sql IN CLOB) IS
    BEGIN
        EXECUTE IMMEDIATE p_sql;
        DBMS_OUTPUT.PUT_LINE('[OK] ' || p_name);
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('[ERROR] ' || p_name || ' - ' || SQLERRM);
    END;

    PROCEDURE add_column_if_missing(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2, p_column_sql IN VARCHAR2) IS
    BEGIN
        IF table_exists(p_table_name) AND NOT column_exists(p_table_name, p_column_name) THEN
            run_ddl(
                'ALTER TABLE ' || p_table_name || ' ADD ' || p_column_name,
                'ALTER TABLE "' || UPPER(p_table_name) || '" ADD (' || p_column_sql || ')'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] COLUMN ' || p_table_name || '.' || p_column_name || ' already exists or table is missing.');
        END IF;
    END;

    PROCEDURE create_table_if_missing(p_table_name IN VARCHAR2, p_sql IN CLOB) IS
    BEGIN
        IF table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || p_table_name || ' already exists.');
        ELSE
            run_ddl('CREATE TABLE ' || p_table_name, p_sql);
        END IF;
    END;

    PROCEDURE create_index_if_missing(p_index_name IN VARCHAR2, p_table_name IN VARCHAR2, p_sql IN CLOB) IS
    BEGIN
        IF NOT table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || p_index_name || ' table is missing.');
        ELSIF index_exists(p_index_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || p_index_name || ' already exists.');
        ELSE
            run_ddl('CREATE INDEX ' || p_index_name, p_sql);
        END IF;
    END;

    PROCEDURE drop_index_if_exists(p_index_name IN VARCHAR2) IS
    BEGIN
        IF index_exists(p_index_name) THEN
            run_ddl(
                'DROP INDEX ' || p_index_name,
                'DROP INDEX "' || UPPER(p_index_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || p_index_name || ' does not exist.');
        END IF;
    END;

    PROCEDURE drop_constraint_if_exists(p_constraint_name IN VARCHAR2, p_table_name IN VARCHAR2) IS
    BEGIN
        IF table_exists(p_table_name) AND constraint_exists(p_constraint_name) THEN
            run_ddl(
                'DROP CONSTRAINT ' || p_constraint_name,
                'ALTER TABLE "' || UPPER(p_table_name) || '" DROP CONSTRAINT "' || UPPER(p_constraint_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] CONSTRAINT ' || p_constraint_name || ' does not exist.');
        END IF;
    END;

    PROCEDURE modify_column_default_not_null(
        p_table_name IN VARCHAR2,
        p_column_name IN VARCHAR2,
        p_default_sql IN VARCHAR2
    ) IS
        v_nullable VARCHAR2(1);
        v_column_sql VARCHAR2(4000);
    BEGIN
        IF table_exists(p_table_name) AND column_exists(p_table_name, p_column_name) THEN
            v_nullable := column_nullable_yn(p_table_name, p_column_name);
            v_column_sql := '"' || UPPER(p_column_name) || '" DEFAULT ' || p_default_sql;

            IF v_nullable = 'Y' THEN
                v_column_sql := v_column_sql || ' NOT NULL ENABLE';
            END IF;

            run_ddl(
                'MODIFY ' || p_table_name || '.' || p_column_name,
                'ALTER TABLE "' || UPPER(p_table_name) || '" MODIFY (' || v_column_sql || ')'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] COLUMN ' || p_table_name || '.' || p_column_name || ' is missing.');
        END IF;
    END;

    PROCEDURE set_column_visibility(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2, p_visibility IN VARCHAR2) IS
        v_hidden VARCHAR2(3);
        v_target_hidden VARCHAR2(3);
    BEGIN
        IF table_exists(p_table_name) AND column_exists(p_table_name, p_column_name) THEN
            v_hidden := column_hidden_yn(p_table_name, p_column_name);
            v_target_hidden := CASE WHEN UPPER(p_visibility) = 'INVISIBLE' THEN 'YES' ELSE 'NO' END;

            IF v_hidden = v_target_hidden THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] COLUMN ' || p_table_name || '.' || p_column_name || ' already ' || p_visibility || '.');
            ELSE
                run_ddl(
                    'ALTER TABLE ' || p_table_name || ' MODIFY ' || p_column_name || ' ' || p_visibility,
                    'ALTER TABLE "' || UPPER(p_table_name) || '" MODIFY ("' || UPPER(p_column_name) || '" ' || p_visibility || ')'
                );
            END IF;
        END IF;
    END;

    PROCEDURE reorder_assoc_rule_summary_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TARGET_OWNER',
            'TARGET_TABLE',
            'MODEL_NAME',
            'MODEL_TYPE',
            'RULE_SOURCE',
            'RULE_ID',
            'CONDITION_COUNT',
            'CONDITION_COLUMN',
            'CONDITION_VALUE',
            'RESULT_COLUMN',
            'RESULT_VALUE',
            'RESULT_HAS_VALUE_YN',
            'RULE_SUPPORT',
            'RULE_CONFIDENCE',
            'RULE_LIFT',
            'SUPPORT_COUNT',
            'CONDITION_TOTAL_COUNT',
            'RESULT_TOTAL_COUNT',
            'TOTAL_COUNT',
            'CONDITION_TEXT',
            'RESULT_TEXT',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_ASSOC_RULE_SUMMARY') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_ASSOC_RULE_SUMMARY does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_ASSOC_RULE_SUMMARY', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_ASSOC_RULE_SUMMARY column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_ASSOC_RULE_SUMMARY'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TARGET_OWNER',
               'TARGET_TABLE',
               'MODEL_NAME',
               'MODEL_TYPE',
               'RULE_SOURCE',
               'RULE_ID',
               'CONDITION_COUNT',
               'CONDITION_COLUMN',
               'CONDITION_VALUE',
               'RESULT_COLUMN',
               'RESULT_VALUE',
               'RESULT_HAS_VALUE_YN',
               'RULE_SUPPORT',
               'RULE_CONFIDENCE',
               'RULE_LIFT',
               'SUPPORT_COUNT',
               'CONDITION_TOTAL_COUNT',
               'RESULT_TOTAL_COUNT',
               'TOTAL_COUNT',
               'CONDITION_TEXT',
               'RESULT_TEXT',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_ASSOC_RULE_SUMMARY column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_ASSOC_RULE_SUMMARY', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_ASSOC_RULE_SUMMARY', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_ASSOC_RULE_SUMMARY column display order refreshed.');
    END;

    PROCEDURE reorder_predicted_type_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'MODEL_NAME',
            'COLUMN_DESC',
            'COLUMN_ID',
            'COLUMN_NAME',
            'DATA_TYPE',
            'TOTAL_ROWS',
            'NUM_DISTINCT',
            'DIST_VAL_RT',
            'LOG_DATA_TYPE',
            'ENTROPY',
            'NORM_ENTROPY',
            'BASE_PREDICTED_TYPE',
            'BASE_REASON',
            'MODL_PREDICTED_TYPE',
            'FINAL_PREDICTED_TYPE',
            'FINAL_REASON',
            'FINAL_UPDATE_DT',
            'FINAL_UPDATE_USER',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_PREDICTED_TYPE') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_PREDICTED_TYPE does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_PREDICTED_TYPE', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_PREDICTED_TYPE column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_PREDICTED_TYPE'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'MODEL_NAME',
               'COLUMN_DESC',
               'COLUMN_ID',
               'COLUMN_NAME',
               'DATA_TYPE',
               'TOTAL_ROWS',
               'NUM_DISTINCT',
               'DIST_VAL_RT',
               'LOG_DATA_TYPE',
               'ENTROPY',
               'NORM_ENTROPY',
               'BASE_PREDICTED_TYPE',
               'BASE_REASON',
               'MODL_PREDICTED_TYPE',
               'FINAL_PREDICTED_TYPE',
               'FINAL_REASON',
               'FINAL_UPDATE_DT',
               'FINAL_UPDATE_USER',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_PREDICTED_TYPE column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_PREDICTED_TYPE', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_PREDICTED_TYPE', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_PREDICTED_TYPE column display order refreshed.');
    END;

    PROCEDURE reorder_predicted_type_final_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'OWNER',
            'TABLE_NAME',
            'COLUMN_NAME',
            'COLUMN_DESC',
            'COLUMN_ID',
            'DATA_TYPE',
            'SOURCE_RUN_SOURCE_TYPE',
            'SOURCE_RUN_ID',
            'SOURCE_MODEL_NAME',
            'BASE_PREDICTED_TYPE',
            'MODL_PREDICTED_TYPE',
            'FINAL_PREDICTED_TYPE',
            'FINAL_REASON',
            'FINAL_UPDATE_DT',
            'FINAL_UPDATE_USER',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_PREDICTED_TYPE_FINAL') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_PREDICTED_TYPE_FINAL does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_PREDICTED_TYPE_FINAL', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_PREDICTED_TYPE_FINAL column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_PREDICTED_TYPE_FINAL'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'OWNER',
               'TABLE_NAME',
               'COLUMN_NAME',
               'COLUMN_DESC',
               'COLUMN_ID',
               'DATA_TYPE',
               'SOURCE_RUN_SOURCE_TYPE',
               'SOURCE_RUN_ID',
               'SOURCE_MODEL_NAME',
               'BASE_PREDICTED_TYPE',
               'MODL_PREDICTED_TYPE',
               'FINAL_PREDICTED_TYPE',
               'FINAL_REASON',
               'FINAL_UPDATE_DT',
               'FINAL_UPDATE_USER',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_PREDICTED_TYPE_FINAL column display order already matches.');
            RETURN;
        END IF;

        -- Keep OWNER visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_PREDICTED_TYPE_FINAL', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_PREDICTED_TYPE_FINAL', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_PREDICTED_TYPE_FINAL column display order refreshed.');
    END;

    PROCEDURE reorder_cat_corr_pair_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'COL_A',
            'COL_B',
            'ROW_COUNT',
            'DF',
            'CHI_SQUARE',
            'P_VALUE',
            'CRAMERS_V',
            'PASS_YN',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_CAT_CORR_PAIR') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_CAT_CORR_PAIR does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_CAT_CORR_PAIR', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_CAT_CORR_PAIR column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_CAT_CORR_PAIR'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'COL_A',
               'COL_B',
               'ROW_COUNT',
               'DF',
               'CHI_SQUARE',
               'P_VALUE',
               'CRAMERS_V',
               'PASS_YN',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_CAT_CORR_PAIR column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_CAT_CORR_PAIR', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_CAT_CORR_PAIR', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_CAT_CORR_PAIR column display order refreshed.');
    END;

    PROCEDURE reorder_cat_corr_summary_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'COLUMN_NAME',
            'PAIR_COUNT',
            'PASS_PAIR_COUNT',
            'AVG_CRAMERS_V',
            'MAX_CRAMERS_V',
            'RANK_NO',
            'SELECTED_YN',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_CAT_CORR_SUMMARY') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_CAT_CORR_SUMMARY does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_CAT_CORR_SUMMARY', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_CAT_CORR_SUMMARY column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_CAT_CORR_SUMMARY'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'COLUMN_NAME',
               'PAIR_COUNT',
               'PASS_PAIR_COUNT',
               'AVG_CRAMERS_V',
               'MAX_CRAMERS_V',
               'RANK_NO',
               'SELECTED_YN',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_CAT_CORR_SUMMARY column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_CAT_CORR_SUMMARY', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_CAT_CORR_SUMMARY', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_CAT_CORR_SUMMARY column display order refreshed.');
    END;

    PROCEDURE reorder_rule_violation_result_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'VIOLATION_ID',
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'TARGET_OWNER',
            'TARGET_TABLE',
            'RULE_OWNER',
            'MODEL_NAME',
            'RULE_ID',
            'CASE_ID',
            'CASE_ROWID',
            'CONDITION_COUNT',
            'CONDITION_TEXT',
            'RESULT_COLUMN',
            'EXPECTED_VALUE',
            'ACTUAL_VALUE',
            'RULE_SUPPORT',
            'RULE_CONFIDENCE',
            'RULE_LIFT',
            'SUPPORT_COUNT',
            'CONDITION_TOTAL_COUNT',
            'RESULT_TOTAL_COUNT',
            'TOTAL_COUNT',
            'VIOLATION_SCORE',
            'VIOLATION_REASON',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_RULE_VIOLATION_RESULT') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_RULE_VIOLATION_RESULT does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_RULE_VIOLATION_RESULT', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_RULE_VIOLATION_RESULT column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_RULE_VIOLATION_RESULT'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'VIOLATION_ID',
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'TARGET_OWNER',
               'TARGET_TABLE',
               'RULE_OWNER',
               'MODEL_NAME',
               'RULE_ID',
               'CASE_ID',
               'CASE_ROWID',
               'CONDITION_COUNT',
               'CONDITION_TEXT',
               'RESULT_COLUMN',
               'EXPECTED_VALUE',
               'ACTUAL_VALUE',
               'RULE_SUPPORT',
               'RULE_CONFIDENCE',
               'RULE_LIFT',
               'SUPPORT_COUNT',
               'CONDITION_TOTAL_COUNT',
               'RESULT_TOTAL_COUNT',
               'TOTAL_COUNT',
               'VIOLATION_SCORE',
               'VIOLATION_REASON',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_RULE_VIOLATION_RESULT column display order already matches.');
            RETURN;
        END IF;

        -- Keep VIOLATION_ID visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_RULE_VIOLATION_RESULT', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_RULE_VIOLATION_RESULT', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_RULE_VIOLATION_RESULT column display order refreshed.');
    END;
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET ALTER START ===');

    IF table_exists('INIT$_TB_DATA_WORK_JOB') THEN
        drop_constraint_if_exists('CK_INIT$_TB_DATA_WORK_RESULT', 'INIT$_TB_DATA_WORK_JOB');

        UPDATE "INIT$_TB_DATA_WORK_JOB"
           SET "RESULT_CREATE_YN" = CASE
                   WHEN UPPER(TRIM("RESULT_CREATE_YN")) = 'Y' THEN 'T'
                   WHEN UPPER(TRIM("RESULT_CREATE_YN")) IN ('N', 'T', 'M') THEN UPPER(TRIM("RESULT_CREATE_YN"))
                   ELSE 'N'
               END;
        DBMS_OUTPUT.PUT_LINE('[OK] NORMALIZE INIT$_TB_DATA_WORK_JOB.RESULT_CREATE_YN');

        run_ddl('ADD CK_INIT$_TB_DATA_WORK_RESULT', q'[ALTER TABLE "INIT$_TB_DATA_WORK_JOB" ADD CONSTRAINT "CK_INIT$_TB_DATA_WORK_RESULT" CHECK ("RESULT_CREATE_YN" IN ('N', 'T', 'M')) ENABLE]');
    END IF;

    drop_constraint_if_exists('FK_INIT$_TB_DATA_WORK_RUN_JOB', 'INIT$_TB_DATA_WORK_RUN');
    drop_constraint_if_exists('FK_INIT$_TB_FLOW_RUN_FLOW', 'INIT$_TB_FLOW_WORK_RUN');
    drop_constraint_if_exists('FK_INIT$_TB_FLOW_NODE_RUN_RUN', 'INIT$_TB_FLOW_WORK_NODE_RUN');
    drop_constraint_if_exists('FK_INIT$_TB_FLOW_NODE_RUN_FLOW', 'INIT$_TB_FLOW_WORK_NODE_RUN');

    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'MODEL_TYPE', '"MODEL_TYPE" VARCHAR2(80 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'TARGET_OWNER', '"TARGET_OWNER" VARCHAR2(128 BYTE) DEFAULT ''UNKNOWN'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'TARGET_TABLE', '"TARGET_TABLE" VARCHAR2(128 BYTE) DEFAULT ''UNKNOWN'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'RULE_SOURCE', '"RULE_SOURCE" VARCHAR2(80 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'CONDITION_COLUMN', '"CONDITION_COLUMN" VARCHAR2(128 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'CONDITION_VALUE', '"CONDITION_VALUE" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'SUPPORT_COUNT', '"SUPPORT_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'CONDITION_TOTAL_COUNT', '"CONDITION_TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'RESULT_TOTAL_COUNT', '"RESULT_TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'TOTAL_COUNT', '"TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'COLUMN_DESC', '"COLUMN_DESC" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'BASE_REASON', '"BASE_REASON" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'FINAL_PREDICTED_TYPE', '"FINAL_PREDICTED_TYPE" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'FINAL_REASON', '"FINAL_REASON" VARCHAR2(1000 BYTE)');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'FINAL_UPDATE_DT', '"FINAL_UPDATE_DT" DATE');
    add_column_if_missing('INIT$_TB_PREDICTED_TYPE', 'FINAL_UPDATE_USER', '"FINAL_UPDATE_USER" VARCHAR2(128 BYTE)');
    add_column_if_missing('INIT$_TB_CAT_CORR_PAIR', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_CAT_CORR_PAIR', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_CAT_CORR_SUMMARY', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_CAT_CORR_SUMMARY', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULE_VIOLATION_RESULT', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULE_VIOLATION_RESULT', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_FLOW_WORK_NODE', 'USE_YN', '"USE_YN" CHAR(1 BYTE) DEFAULT ''Y'' NOT NULL ENABLE');

    FOR table_rec IN (
        SELECT 'INIT$_TB_PREDICTED_TYPE' AS TABLE_NAME, 'CK_INIT$_TB_PREDICTED_RUN_SRC' AS CONSTRAINT_NAME FROM DUAL UNION ALL
        SELECT 'INIT$_TB_CAT_CORR_PAIR', 'CK_INIT$_TB_CAT_CORR_PAIR_RUN' FROM DUAL UNION ALL
        SELECT 'INIT$_TB_CAT_CORR_SUMMARY', 'CK_INIT$_TB_CAT_CORR_SUM_RUN' FROM DUAL UNION ALL
        SELECT 'INIT$_TB_ASSOC_RULE_SUMMARY', 'CK_INIT$_TB_ASSOC_RULE_RUN' FROM DUAL UNION ALL
        SELECT 'INIT$_TB_RULE_VIOLATION_RESULT', 'CK_INIT$_TB_RULE_VIOL_RUN' FROM DUAL
    ) LOOP
        IF table_exists(table_rec.TABLE_NAME) AND column_exists(table_rec.TABLE_NAME, 'RUN_SOURCE_TYPE') THEN
            run_ddl(
                'NORMALIZE ' || table_rec.TABLE_NAME || '.RUN_SOURCE_TYPE',
                'UPDATE "' || table_rec.TABLE_NAME || '" ' ||
                '   SET "RUN_SOURCE_TYPE" = CASE WHEN UPPER(TRIM(NVL("RUN_SOURCE_TYPE", ''DATA_WORK''))) = ''FLOW_WORK'' THEN ''FLOW_WORK'' ELSE ''DATA_WORK'' END, ' ||
                '       "RUN_ID" = NVL("RUN_ID", 0)'
            );

            modify_column_default_not_null(table_rec.TABLE_NAME, 'RUN_SOURCE_TYPE', q'['DATA_WORK']');
            modify_column_default_not_null(table_rec.TABLE_NAME, 'RUN_ID', '0');

            IF NOT constraint_exists(table_rec.CONSTRAINT_NAME) THEN
                run_ddl(
                    'ADD ' || table_rec.CONSTRAINT_NAME,
                    'ALTER TABLE "' || table_rec.TABLE_NAME || '" ADD CONSTRAINT "' || table_rec.CONSTRAINT_NAME || '" CHECK ("RUN_SOURCE_TYPE" IN (''DATA_WORK'', ''FLOW_WORK'')) ENABLE'
                );
            ELSE
                DBMS_OUTPUT.PUT_LINE('[SKIP] CONSTRAINT ' || table_rec.CONSTRAINT_NAME || ' already exists.');
            END IF;
        END IF;
    END LOOP;

    IF table_exists('INIT$_TB_PREDICTED_TYPE') THEN
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."RUN_ID" IS 'WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.COLUMN_DESC', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."COLUMN_DESC" IS 'Target table column comment']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.BASE_REASON', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."BASE_REASON" IS 'Reason produced by rule-based profiling logic']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.FINAL_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."FINAL_PREDICTED_TYPE" IS 'Deprecated execution snapshot final predicted type. Source of truth is INIT$_TB_PREDICTED_TYPE_FINAL']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.FINAL_REASON', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."FINAL_REASON" IS 'Deprecated execution snapshot final reason. Source of truth is INIT$_TB_PREDICTED_TYPE_FINAL']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.FINAL_UPDATE_DT', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."FINAL_UPDATE_DT" IS 'Deprecated execution snapshot final update date. Source of truth is INIT$_TB_PREDICTED_TYPE_FINAL']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE.FINAL_UPDATE_USER', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE"."FINAL_UPDATE_USER" IS 'Deprecated execution snapshot final update user. Source of truth is INIT$_TB_PREDICTED_TYPE_FINAL']');

        drop_constraint_if_exists('PK_INIT$_TB_PREDICTED_TYPE', 'INIT$_TB_PREDICTED_TYPE');
        IF NOT constraint_exists('PK_INIT$_TB_PREDICTED_TYPE') THEN
            run_ddl(
                'ADD PK_INIT$_TB_PREDICTED_TYPE',
                q'[ALTER TABLE "INIT$_TB_PREDICTED_TYPE" ADD CONSTRAINT "PK_INIT$_TB_PREDICTED_TYPE" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "MODEL_NAME", "COLUMN_NAME") ENABLE]'
            );
        END IF;

        drop_index_if_exists('IX_INIT$_TB_PREDICTED_TYPE_01');
    END IF;

    create_table_if_missing('INIT$_TB_PREDICTED_TYPE_FINAL', q'[
CREATE TABLE "INIT$_TB_PREDICTED_TYPE_FINAL" (
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_DESC" VARCHAR2(4000 BYTE),
    "COLUMN_ID" NUMBER,
    "DATA_TYPE" VARCHAR2(128 BYTE),
    "SOURCE_RUN_SOURCE_TYPE" VARCHAR2(30 BYTE),
    "SOURCE_RUN_ID" NUMBER,
    "SOURCE_MODEL_NAME" VARCHAR2(261 BYTE),
    "BASE_PREDICTED_TYPE" VARCHAR2(100 BYTE),
    "MODL_PREDICTED_TYPE" VARCHAR2(4000 BYTE),
    "FINAL_PREDICTED_TYPE" VARCHAR2(4000 BYTE) NOT NULL ENABLE,
    "FINAL_REASON" VARCHAR2(1000 BYTE),
    "FINAL_UPDATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    "FINAL_UPDATE_USER" VARCHAR2(128 BYTE),
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FINAL_SRC" CHECK ("SOURCE_RUN_SOURCE_TYPE" IS NULL OR "SOURCE_RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_PRED_TYPE_FINAL" PRIMARY KEY ("OWNER", "TABLE_NAME", "COLUMN_NAME")
)]');

    IF table_exists('INIT$_TB_PREDICTED_TYPE_FINAL') THEN
        add_column_if_missing('INIT$_TB_PREDICTED_TYPE_FINAL', 'COLUMN_DESC', '"COLUMN_DESC" VARCHAR2(4000 BYTE)');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL', q'[COMMENT ON TABLE "INIT$_TB_PREDICTED_TYPE_FINAL" IS 'User-confirmed final column logical type master']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.OWNER', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."OWNER" IS 'Target table owner']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.TABLE_NAME', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."TABLE_NAME" IS 'Target table name']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.COLUMN_NAME', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."COLUMN_NAME" IS 'Column name']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.COLUMN_DESC', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."COLUMN_DESC" IS 'Target table column comment captured from the latest confirmation source']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.COLUMN_ID', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."COLUMN_ID" IS 'Column order captured from the latest confirmation source']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.DATA_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."DATA_TYPE" IS 'Physical data type captured from the latest confirmation source']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.SOURCE_RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."SOURCE_RUN_SOURCE_TYPE" IS 'Run source type that produced the latest confirmed evidence']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.SOURCE_RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."SOURCE_RUN_ID" IS 'WORK_RUN_ID or FLOW_RUN_ID that produced the latest confirmed evidence']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.SOURCE_MODEL_NAME', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."SOURCE_MODEL_NAME" IS 'Prediction model name used as confirmation evidence']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.BASE_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."BASE_PREDICTED_TYPE" IS 'Rule-based predicted type captured when confirmed']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.MODL_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."MODL_PREDICTED_TYPE" IS 'Model predicted type captured when confirmed']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."FINAL_PREDICTED_TYPE" IS 'User-confirmed final predicted type']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_REASON', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."FINAL_REASON" IS 'User note for final predicted type decision']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_UPDATE_DT', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."FINAL_UPDATE_DT" IS 'Final predicted type update date']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_UPDATE_USER', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."FINAL_UPDATE_USER" IS 'Final predicted type update user']');
        run_ddl('COMMENT INIT$_TB_PREDICTED_TYPE_FINAL.CREATE_DT', q'[COMMENT ON COLUMN "INIT$_TB_PREDICTED_TYPE_FINAL"."CREATE_DT" IS 'Create date']');
    END IF;

    create_index_if_missing('IX_INIT$_TB_PRED_TYPE_FINAL_01', 'INIT$_TB_PREDICTED_TYPE_FINAL', q'[
CREATE INDEX "IX_INIT$_TB_PRED_TYPE_FINAL_01"
    ON "INIT$_TB_PREDICTED_TYPE_FINAL" ("FINAL_PREDICTED_TYPE", "OWNER", "TABLE_NAME")
]');

    create_index_if_missing('IX_INIT$_TB_PRED_TYPE_FINAL_02', 'INIT$_TB_PREDICTED_TYPE_FINAL', q'[
CREATE INDEX "IX_INIT$_TB_PRED_TYPE_FINAL_02"
    ON "INIT$_TB_PREDICTED_TYPE_FINAL" ("SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID", "SOURCE_MODEL_NAME")
]');

    IF table_exists('INIT$_TB_CAT_CORR_PAIR') THEN
        run_ddl('COMMENT INIT$_TB_CAT_CORR_PAIR.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_CAT_CORR_PAIR"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_CAT_CORR_PAIR.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_CAT_CORR_PAIR"."RUN_ID" IS 'WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');

        drop_constraint_if_exists('PK_INIT$_TB_CAT_CORR_PAIR', 'INIT$_TB_CAT_CORR_PAIR');
        IF NOT constraint_exists('PK_INIT$_TB_CAT_CORR_PAIR') THEN
            run_ddl(
                'ADD PK_INIT$_TB_CAT_CORR_PAIR',
                q'[ALTER TABLE "INIT$_TB_CAT_CORR_PAIR" ADD CONSTRAINT "PK_INIT$_TB_CAT_CORR_PAIR" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COL_A", "COL_B") ENABLE]'
            );
        END IF;

        drop_index_if_exists('IX_INIT$_TB_CAT_CORR_PAIR_01');
    END IF;

    IF table_exists('INIT$_TB_CAT_CORR_SUMMARY') THEN
        run_ddl('COMMENT INIT$_TB_CAT_CORR_SUMMARY.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_CAT_CORR_SUMMARY"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_CAT_CORR_SUMMARY.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_CAT_CORR_SUMMARY"."RUN_ID" IS 'WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');

        drop_constraint_if_exists('PK_INIT$_TB_CAT_CORR_SUMMARY', 'INIT$_TB_CAT_CORR_SUMMARY');
        IF NOT constraint_exists('PK_INIT$_TB_CAT_CORR_SUMMARY') THEN
            run_ddl(
                'ADD PK_INIT$_TB_CAT_CORR_SUMMARY',
                q'[ALTER TABLE "INIT$_TB_CAT_CORR_SUMMARY" ADD CONSTRAINT "PK_INIT$_TB_CAT_CORR_SUMMARY" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME") ENABLE]'
            );
        END IF;

        drop_index_if_exists('IX_INIT$_TB_CAT_CORR_SUMMARY_01');
    END IF;

    IF table_exists('INIT$_TB_FLOW_WORK_NODE') AND column_exists('INIT$_TB_FLOW_WORK_NODE', 'USE_YN') THEN
        run_ddl(
            'NORMALIZE INIT$_TB_FLOW_WORK_NODE.USE_YN',
            q'[UPDATE "INIT$_TB_FLOW_WORK_NODE"
                  SET "USE_YN" = CASE WHEN UPPER(TRIM(NVL("USE_YN", 'Y'))) = 'N' THEN 'N' ELSE 'Y' END]'
        );

        IF NOT constraint_exists('CK_INIT$_TB_FLOW_NODE_USE') THEN
            run_ddl('ADD CK_INIT$_TB_FLOW_NODE_USE', q'[ALTER TABLE "INIT$_TB_FLOW_WORK_NODE" ADD CONSTRAINT "CK_INIT$_TB_FLOW_NODE_USE" CHECK ("USE_YN" IN ('Y', 'N')) ENABLE]');
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] CONSTRAINT CK_INIT$_TB_FLOW_NODE_USE already exists.');
        END IF;
    END IF;

    IF table_exists('INIT$_TB_FLOW_WORK_NODE_RUN') THEN
        run_ddl('ALTER INIT$_TB_FLOW_WORK_NODE_RUN NOPARALLEL', q'[ALTER TABLE "INIT$_TB_FLOW_WORK_NODE_RUN" NOPARALLEL]');

        create_index_if_missing('IX_INIT$_TB_FLOW_NODE_RUN_02', 'INIT$_TB_FLOW_WORK_NODE_RUN', q'[
CREATE INDEX "IX_INIT$_TB_FLOW_NODE_RUN_02"
    ON "INIT$_TB_FLOW_WORK_NODE_RUN" ("FLOW_RUN_ID", "NODE_KEY")
    NOPARALLEL
]');

        IF index_exists('IX_INIT$_TB_FLOW_NODE_RUN_01') THEN
            run_ddl('ALTER IX_INIT$_TB_FLOW_NODE_RUN_01 NOPARALLEL', q'[ALTER INDEX "IX_INIT$_TB_FLOW_NODE_RUN_01" NOPARALLEL]');
        END IF;

        IF index_exists('IX_INIT$_TB_FLOW_NODE_RUN_02') THEN
            run_ddl('ALTER IX_INIT$_TB_FLOW_NODE_RUN_02 NOPARALLEL', q'[ALTER INDEX "IX_INIT$_TB_FLOW_NODE_RUN_02" NOPARALLEL]');
        END IF;
    END IF;

    IF table_exists('INIT$_TB_ASSOC_RULE_SUMMARY') THEN
        IF column_exists('INIT$_TB_ASSOC_RULE_SUMMARY', 'TARGET_OWNER') AND column_exists('INIT$_TB_ASSOC_RULE_SUMMARY', 'TARGET_TABLE') THEN
            run_ddl(
                'NORMALIZE INIT$_TB_ASSOC_RULE_SUMMARY TARGET SCOPE',
                q'[UPDATE "INIT$_TB_ASSOC_RULE_SUMMARY"
                      SET "TARGET_OWNER" = NVL(NULLIF(TRIM("TARGET_OWNER"), ''), 'UNKNOWN'),
                          "TARGET_TABLE" = NVL(NULLIF(TRIM("TARGET_TABLE"), ''), 'UNKNOWN')
                    WHERE "TARGET_OWNER" IS NULL
                       OR "TARGET_TABLE" IS NULL
                       OR TRIM("TARGET_OWNER") IS NULL
                       OR TRIM("TARGET_TABLE") IS NULL]'
            );

            modify_column_default_not_null('INIT$_TB_ASSOC_RULE_SUMMARY', 'TARGET_OWNER', q'['UNKNOWN']');
            modify_column_default_not_null('INIT$_TB_ASSOC_RULE_SUMMARY', 'TARGET_TABLE', q'['UNKNOWN']');

            drop_constraint_if_exists('PK_INIT$_TB_ASSOC_RULE_SUMMARY', 'INIT$_TB_ASSOC_RULE_SUMMARY');
            IF NOT constraint_exists('PK_INIT$_TB_ASSOC_RULE_SUMMARY') THEN
                run_ddl(
                    'ADD PK_INIT$_TB_ASSOC_RULE_SUMMARY',
                    q'[ALTER TABLE "INIT$_TB_ASSOC_RULE_SUMMARY" ADD CONSTRAINT "PK_INIT$_TB_ASSOC_RULE_SUMMARY" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "RULE_ID") ENABLE]'
                );
            END IF;

            drop_index_if_exists('IX_INIT$_TB_ASSOC_RULE_SUMMARY_01');
            drop_index_if_exists('IX_INIT$_TB_ASSOC_RULE_SUMMARY_02');
            drop_index_if_exists('IX_INIT$_TB_ASSOC_RULE_SUMMARY_03');
        END IF;

        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY', q'[COMMENT ON TABLE "INIT$_TB_ASSOC_RULE_SUMMARY" IS 'Association model rule summary for fast drill-down analysis']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."RUN_ID" IS 'WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.TARGET_OWNER', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."TARGET_OWNER" IS 'Target table owner used to calculate this rule summary']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.TARGET_TABLE', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."TARGET_TABLE" IS 'Target table used to calculate this rule summary']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.MODEL_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."MODEL_TYPE" IS 'Human-readable rule model type such as Apriori or Decision Tree']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.RULE_SOURCE', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."RULE_SOURCE" IS 'Rule summary source such as conditional frequency']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.CONDITION_COLUMN', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."CONDITION_COLUMN" IS 'Condition column name for conditional probability rules']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.CONDITION_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."CONDITION_VALUE" IS 'Condition column value for conditional probability rules']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.SUPPORT_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."SUPPORT_COUNT" IS 'Rows matching both condition and result']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.CONDITION_TOTAL_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."CONDITION_TOTAL_COUNT" IS 'Rows matching the condition']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.RESULT_TOTAL_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."RESULT_TOTAL_COUNT" IS 'Rows matching the result']');
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY.TOTAL_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_ASSOC_RULE_SUMMARY"."TOTAL_COUNT" IS 'Total rows used for rule probability calculation']');
    END IF;

    create_index_if_missing('IX_INIT$_TB_ASSOC_RULE_SUMMARY_01', 'INIT$_TB_ASSOC_RULE_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_ASSOC_RULE_SUMMARY_01"
    ON "INIT$_TB_ASSOC_RULE_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "CONDITION_COUNT", "RULE_CONFIDENCE", "RULE_LIFT", "RULE_SUPPORT")
]');

    create_index_if_missing('IX_INIT$_TB_ASSOC_RULE_SUMMARY_02', 'INIT$_TB_ASSOC_RULE_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_ASSOC_RULE_SUMMARY_02"
    ON "INIT$_TB_ASSOC_RULE_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "RESULT_COLUMN", "RESULT_HAS_VALUE_YN")
]');

    create_index_if_missing('IX_INIT$_TB_ASSOC_RULE_SUMMARY_03', 'INIT$_TB_ASSOC_RULE_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_ASSOC_RULE_SUMMARY_03"
    ON "INIT$_TB_ASSOC_RULE_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "MODEL_TYPE", "RULE_SOURCE")
]');

    create_index_if_missing('IX_INIT$_TB_PREDICTED_TYPE_01', 'INIT$_TB_PREDICTED_TYPE', q'[
CREATE INDEX "IX_INIT$_TB_PREDICTED_TYPE_01"
    ON "INIT$_TB_PREDICTED_TYPE" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "MODEL_NAME", "COLUMN_ID")
]');

    create_index_if_missing('IX_INIT$_TB_CAT_CORR_PAIR_01', 'INIT$_TB_CAT_CORR_PAIR', q'[
CREATE INDEX "IX_INIT$_TB_CAT_CORR_PAIR_01"
    ON "INIT$_TB_CAT_CORR_PAIR" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "PASS_YN", "CRAMERS_V")
]');

    create_index_if_missing('IX_INIT$_TB_CAT_CORR_SUMMARY_01', 'INIT$_TB_CAT_CORR_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_CAT_CORR_SUMMARY_01"
    ON "INIT$_TB_CAT_CORR_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "SELECTED_YN", "RANK_NO")
]');

    create_table_if_missing('INIT$_TB_NUM_CORR_PAIR', q'[
CREATE TABLE "INIT$_TB_NUM_CORR_PAIR" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_A" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_B" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "ROW_COUNT" NUMBER,
    "PEARSON_R" NUMBER,
    "ABS_PEARSON_R" NUMBER,
    "P_VALUE" NUMBER,
    "PASS_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_NUM_CORR_PAIR_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_NUM_CORR_PAIR_PASS" CHECK ("PASS_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_NUM_CORR_PAIR" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COL_A", "COL_B")
)]');

    create_table_if_missing('INIT$_TB_NUM_CORR_SUMMARY', q'[
CREATE TABLE "INIT$_TB_NUM_CORR_SUMMARY" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "PAIR_COUNT" NUMBER,
    "PASS_PAIR_COUNT" NUMBER,
    "AVG_ABS_PEARSON_R" NUMBER,
    "MAX_ABS_PEARSON_R" NUMBER,
    "RANK_NO" NUMBER,
    "SELECTED_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_NUM_CORR_SUM_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_NUM_CORR_SUM_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_NUM_CORR_SUMMARY" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME")
)]');

    create_table_if_missing('INIT$_TB_LASSO_FEATURE', q'[
CREATE TABLE "INIT$_TB_LASSO_FEATURE" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TARGET_COLUMN" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "FEATURE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COEFFICIENT" NUMBER,
    "ABS_COEFFICIENT" NUMBER,
    "RANK_NO" NUMBER,
    "SELECTED_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "MODEL_ALPHA" NUMBER,
    "R2_SCORE" NUMBER,
    "MESSAGE" VARCHAR2(4000 BYTE),
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_LASSO_FEATURE_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_LASSO_FEATURE_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_LASSO_FEATURE" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "FEATURE_NAME")
)]');

    create_table_if_missing('INIT$_TB_SYMBOLIC_RULE', q'[
CREATE TABLE "INIT$_TB_SYMBOLIC_RULE" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TARGET_COLUMN" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RULE_ID" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "EXPRESSION" CLOB,
    "SCORE" NUMBER,
    "COMPLEXITY" NUMBER,
    "RANK_NO" NUMBER,
    "SELECTED_YN" CHAR(1 BYTE) DEFAULT 'Y' NOT NULL ENABLE,
    "FEATURE_COLUMNS" VARCHAR2(4000 BYTE),
    "METHOD" VARCHAR2(80 BYTE),
    "MESSAGE" VARCHAR2(4000 BYTE),
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_SYMBOLIC_RULE_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_SYMBOLIC_RULE_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_SYMBOLIC_RULE" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "RULE_ID")
)]');

    create_table_if_missing('INIT$_TB_API_RESULT', q'[
CREATE TABLE "INIT$_TB_API_RESULT" (
    "API_RESULT_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE
  , "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE
  , "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE
  , "API_OBJECT_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE
  , "API_ENDPOINT" VARCHAR2(500 BYTE)
  , "TARGET_OWNER" VARCHAR2(128 BYTE)
  , "TARGET_TABLE" VARCHAR2(128 BYTE)
  , "RESULT_MODEL_NAME" VARCHAR2(128 BYTE)
  , "REQUEST_JSON" CLOB
  , "RESPONSE_JSON" CLOB
  , "RESULT_STATUS" VARCHAR2(50 BYTE)
  , "MESSAGE" VARCHAR2(4000 BYTE)
  , "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE
  , CONSTRAINT "CK_INIT$_TB_API_RESULT_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE
  , CONSTRAINT "PK_INIT$_TB_API_RESULT" PRIMARY KEY ("API_RESULT_ID")
)]');

    create_index_if_missing('IX_INIT$_TB_NUM_CORR_PAIR_01', 'INIT$_TB_NUM_CORR_PAIR', q'[
CREATE INDEX "IX_INIT$_TB_NUM_CORR_PAIR_01"
    ON "INIT$_TB_NUM_CORR_PAIR" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "PASS_YN", "ABS_PEARSON_R")
]');

    create_index_if_missing('IX_INIT$_TB_NUM_CORR_SUMMARY_01', 'INIT$_TB_NUM_CORR_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_NUM_CORR_SUMMARY_01"
    ON "INIT$_TB_NUM_CORR_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "SELECTED_YN", "RANK_NO")
]');

    create_index_if_missing('IX_INIT$_TB_LASSO_FEATURE_01', 'INIT$_TB_LASSO_FEATURE', q'[
CREATE INDEX "IX_INIT$_TB_LASSO_FEATURE_01"
    ON "INIT$_TB_LASSO_FEATURE" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "SELECTED_YN", "RANK_NO")
]');

    create_index_if_missing('IX_INIT$_TB_SYMBOLIC_RULE_01', 'INIT$_TB_SYMBOLIC_RULE', q'[
CREATE INDEX "IX_INIT$_TB_SYMBOLIC_RULE_01"
    ON "INIT$_TB_SYMBOLIC_RULE" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "SELECTED_YN", "RANK_NO")
]');

    create_table_if_missing('INIT$_TB_SYMBOLIC_RULE_VIOLATION', q'[
CREATE TABLE "INIT$_TB_SYMBOLIC_RULE_VIOLATION" (
    "VIOLATION_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "TARGET_OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TARGET_TABLE" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RULE_OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RULE_TABLE" VARCHAR2(128 BYTE) DEFAULT 'INIT$_TB_SYMBOLIC_RULE' NOT NULL ENABLE,
    "RULE_ID" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TARGET_COLUMN" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "CASE_ID" VARCHAR2(4000 BYTE),
    "CASE_ROWID" VARCHAR2(30 BYTE),
    "EXPRESSION" CLOB,
    "FEATURE_COLUMNS" VARCHAR2(4000 BYTE),
    "PREDICTED_VALUE" NUMBER,
    "ACTUAL_VALUE" NUMBER,
    "LOWER_BOUND" NUMBER,
    "UPPER_BOUND" NUMBER,
    "ABS_ERROR" NUMBER,
    "ERROR_PCT" NUMBER,
    "TOLERANCE_PCT" NUMBER,
    "ABS_ERROR_THRESHOLD" NUMBER,
    "RULE_SCORE" NUMBER,
    "RULE_COMPLEXITY" NUMBER,
    "RULE_METHOD" VARCHAR2(80 BYTE),
    "VIOLATION_SCORE" NUMBER,
    "VIOLATION_REASON" VARCHAR2(4000 BYTE),
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_SYM_RULE_VIOL_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_SYM_RULE_VIOL" PRIMARY KEY ("VIOLATION_ID")
)]');

    IF table_exists('INIT$_TB_SYMBOLIC_RULE_VIOLATION') THEN
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION', q'[COMMENT ON TABLE "INIT$_TB_SYMBOLIC_RULE_VIOLATION" IS 'Rows outside the accepted error range of symbolic regression rules']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."RUN_ID" IS 'WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.RULE_ID', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."RULE_ID" IS 'Symbolic rule ID']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.TARGET_COLUMN', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."TARGET_COLUMN" IS 'Dependent variable checked by the symbolic expression']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.PREDICTED_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."PREDICTED_VALUE" IS 'Expected value calculated by the symbolic expression']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.ACTUAL_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."ACTUAL_VALUE" IS 'Actual target row value']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.ERROR_PCT', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."ERROR_PCT" IS 'Absolute error divided by expected value']');
        run_ddl('COMMENT INIT$_TB_SYMBOLIC_RULE_VIOLATION.TOLERANCE_PCT', q'[COMMENT ON COLUMN "INIT$_TB_SYMBOLIC_RULE_VIOLATION"."TOLERANCE_PCT" IS 'Accepted relative error range such as 0.05 for plus/minus 5 percent']');
    END IF;

    create_index_if_missing('IX_INIT$_TB_SYM_RULE_VIOL_01', 'INIT$_TB_SYMBOLIC_RULE_VIOLATION', q'[
CREATE INDEX "IX_INIT$_TB_SYM_RULE_VIOL_01"
    ON "INIT$_TB_SYMBOLIC_RULE_VIOLATION" ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "TARGET_COLUMN", "VIOLATION_SCORE")
]');

    create_index_if_missing('IX_INIT$_TB_SYM_RULE_VIOL_02', 'INIT$_TB_SYMBOLIC_RULE_VIOLATION', q'[
CREATE INDEX "IX_INIT$_TB_SYM_RULE_VIOL_02"
    ON "INIT$_TB_SYMBOLIC_RULE_VIOLATION" ("RUN_SOURCE_TYPE", "RUN_ID", "RULE_OWNER", "RULE_TABLE", "RULE_ID")
]');

    create_index_if_missing('IX_INIT$_TB_API_RESULT_01', 'INIT$_TB_API_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_API_RESULT_01"
    ON "INIT$_TB_API_RESULT" ("RUN_SOURCE_TYPE", "RUN_ID", "API_OBJECT_NAME", "CREATE_DT")
]');

    create_table_if_missing('INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE TABLE "INIT$_TB_RULE_VIOLATION_RESULT" (
    "VIOLATION_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "TARGET_OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TARGET_TABLE" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RULE_OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "MODEL_NAME" VARCHAR2(261 BYTE) NOT NULL ENABLE,
    "RULE_ID" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "CASE_ID" VARCHAR2(4000 BYTE),
    "CASE_ROWID" VARCHAR2(30 BYTE),
    "CONDITION_COUNT" NUMBER,
    "CONDITION_TEXT" CLOB,
    "RESULT_COLUMN" VARCHAR2(128 BYTE),
    "EXPECTED_VALUE" VARCHAR2(4000 BYTE),
    "ACTUAL_VALUE" VARCHAR2(4000 BYTE),
    "RULE_SUPPORT" NUMBER,
    "RULE_CONFIDENCE" NUMBER,
    "RULE_LIFT" NUMBER,
    "SUPPORT_COUNT" NUMBER,
    "CONDITION_TOTAL_COUNT" NUMBER,
    "RESULT_TOTAL_COUNT" NUMBER,
    "TOTAL_COUNT" NUMBER,
    "VIOLATION_SCORE" NUMBER,
    "VIOLATION_REASON" VARCHAR2(4000 BYTE),
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_RULE_VIOL_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_RULE_VIOLATION" PRIMARY KEY ("VIOLATION_ID")
)]');

    IF table_exists('INIT$_TB_RULE_VIOLATION_RESULT') THEN
        run_ddl('COMMENT INIT$_TB_RULE_VIOLATION_RESULT', q'[COMMENT ON TABLE "INIT$_TB_RULE_VIOLATION_RESULT" IS 'Rows that violate discovered human-readable rules']');
        run_ddl('COMMENT INIT$_TB_RULE_VIOLATION_RESULT.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_RULE_VIOLATION_RESULT"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULE_VIOLATION_RESULT.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_RULE_VIOLATION_RESULT"."RUN_ID" IS 'WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULE_VIOLATION_RESULT.VIOLATION_SCORE', q'[COMMENT ON COLUMN "INIT$_TB_RULE_VIOLATION_RESULT"."VIOLATION_SCORE" IS 'Rule confidence/lift based priority score']');

        drop_index_if_exists('IX_INIT$_TB_RULE_VIOLATION_01');
        drop_index_if_exists('IX_INIT$_TB_RULE_VIOLATION_02');
        drop_index_if_exists('IX_INIT$_TB_RULE_VIOLATION_03');
    END IF;

    create_index_if_missing('IX_INIT$_TB_RULE_VIOLATION_01', 'INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_RULE_VIOLATION_01"
    ON "INIT$_TB_RULE_VIOLATION_RESULT" ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "VIOLATION_SCORE")
]');

    create_index_if_missing('IX_INIT$_TB_RULE_VIOLATION_02', 'INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_RULE_VIOLATION_02"
    ON "INIT$_TB_RULE_VIOLATION_RESULT" ("RUN_SOURCE_TYPE", "RUN_ID", "RULE_OWNER", "MODEL_NAME", "RULE_ID")
]');

    create_index_if_missing('IX_INIT$_TB_RULE_VIOLATION_03', 'INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_RULE_VIOLATION_03"
    ON "INIT$_TB_RULE_VIOLATION_RESULT" ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "CASE_ID")
]');

    IF table_exists('INIT$_TB_FLOW_WORK_NODE') THEN
        run_ddl('COMMENT INIT$_TB_FLOW_WORK_NODE.USE_YN', q'[COMMENT ON COLUMN "INIT$_TB_FLOW_WORK_NODE"."USE_YN" IS 'Node execution use Y/N. N keeps graph links but skips the node during execution']');
    END IF;

    reorder_assoc_rule_summary_columns;
    reorder_predicted_type_columns;
    reorder_predicted_type_final_columns;
    reorder_cat_corr_pair_columns;
    reorder_cat_corr_summary_columns;
    reorder_rule_violation_result_columns;

    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET ALTER END ===');
END;
/
