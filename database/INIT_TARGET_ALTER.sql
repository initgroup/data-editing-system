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

    FUNCTION primary_key_exists(p_table_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_CONSTRAINTS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND CONSTRAINT_TYPE = 'P';

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

    PROCEDURE rename_column_if_needed(
        p_table_name IN VARCHAR2,
        p_old_column_name IN VARCHAR2,
        p_new_column_name IN VARCHAR2
    ) IS
    BEGIN
        IF NOT table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || p_table_name || ' is missing.');
        ELSIF column_exists(p_table_name, p_new_column_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] COLUMN ' || p_table_name || '.' || p_new_column_name || ' already exists.');
        ELSIF column_exists(p_table_name, p_old_column_name) THEN
            run_ddl(
                'RENAME COLUMN ' || p_table_name || '.' || p_old_column_name || ' TO ' || p_new_column_name,
                'ALTER TABLE "' || UPPER(p_table_name) || '" RENAME COLUMN "'
                    || UPPER(p_old_column_name) || '" TO "' || UPPER(p_new_column_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] COLUMN ' || p_table_name || '.' || p_old_column_name || ' is missing.');
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
            BEGIN
                EXECUTE IMMEDIATE p_sql;
                DBMS_OUTPUT.PUT_LINE('[OK] CREATE INDEX ' || p_index_name);
            EXCEPTION
                WHEN OTHERS THEN
                    IF SQLCODE = -1408 THEN
                        DBMS_OUTPUT.PUT_LINE(
                            '[SKIP] INDEX ' || p_index_name
                                || ' has an equivalent column list under another index name.'
                        );
                    ELSE
                        DBMS_OUTPUT.PUT_LINE('[ERROR] CREATE INDEX ' || p_index_name || ' - ' || SQLERRM);
                    END IF;
            END;
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

    PROCEDURE drop_primary_key_if_exists(p_table_name IN VARCHAR2) IS
        v_constraint_name USER_CONSTRAINTS.CONSTRAINT_NAME%TYPE;
    BEGIN
        SELECT CONSTRAINT_NAME
          INTO v_constraint_name
          FROM USER_CONSTRAINTS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND CONSTRAINT_TYPE = 'P'
           AND ROWNUM = 1;

        run_ddl(
            'DROP PRIMARY KEY ' || p_table_name || '.' || v_constraint_name,
            'ALTER TABLE "' || UPPER(p_table_name) || '" DROP CONSTRAINT "' || v_constraint_name || '"'
        );
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] PRIMARY KEY ' || p_table_name || ' does not exist.');
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
        IF NOT table_exists('INIT$_TB_RULEDISC_ASSOC_SUM') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_RULEDISC_ASSOC_SUM does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_RULEDISC_ASSOC_SUM', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_RULEDISC_ASSOC_SUM column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_RULEDISC_ASSOC_SUM'
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
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_RULEDISC_ASSOC_SUM column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_RULEDISC_ASSOC_SUM', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_RULEDISC_ASSOC_SUM', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_RULEDISC_ASSOC_SUM column display order refreshed.');
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
            'PROFILE_VERSION',
            'SAMPLE_ROWS',
            'SAMPLE_NOT_NULL_ROWS',
            'SAMPLE_DISTINCT',
            'NON_NULL_ROWS',
            'NULL_RATIO',
            'NUMERIC_RATIO',
            'INTEGER_RATIO',
            'MIN_NUM_VALUE',
            'MAX_NUM_VALUE',
            'AVG_TEXT_LENGTH',
            'MAX_TEXT_LENGTH',
            'BASE_PREDICTED_TYPE',
            'BASE_TYPE_CODE',
            'BASE_REASON',
            'MODL_PREDICTED_TYPE',
            'MODL_TYPE_CODE',
            'MODEL_VERSION_ID',
            'MODEL_VERSION',
            'MODEL_CONFIDENCE',
            'FINAL_PREDICTED_TYPE',
            'FINAL_TYPE_CODE',
            'TYPE_GROUP_CODE',
            'FINAL_REASON',
            'FINAL_UPDATE_DT',
            'FINAL_UPDATE_USER',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_COLTYPE_RESULT') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLTYPE_RESULT does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLTYPE_RESULT', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLTYPE_RESULT column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLTYPE_RESULT'
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
               'PROFILE_VERSION',
               'SAMPLE_ROWS',
               'SAMPLE_NOT_NULL_ROWS',
               'SAMPLE_DISTINCT',
               'NON_NULL_ROWS',
               'NULL_RATIO',
               'NUMERIC_RATIO',
               'INTEGER_RATIO',
               'MIN_NUM_VALUE',
               'MAX_NUM_VALUE',
               'AVG_TEXT_LENGTH',
               'MAX_TEXT_LENGTH',
               'BASE_PREDICTED_TYPE',
               'BASE_TYPE_CODE',
               'BASE_REASON',
               'MODL_PREDICTED_TYPE',
               'MODL_TYPE_CODE',
               'MODEL_VERSION_ID',
               'MODEL_VERSION',
               'MODEL_CONFIDENCE',
               'FINAL_PREDICTED_TYPE',
               'FINAL_TYPE_CODE',
               'TYPE_GROUP_CODE',
               'FINAL_REASON',
               'FINAL_UPDATE_DT',
               'FINAL_UPDATE_USER',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLTYPE_RESULT column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLTYPE_RESULT', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLTYPE_RESULT', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLTYPE_RESULT column display order refreshed.');
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
            'FINAL_TYPE_CODE',
            'TYPE_GROUP_CODE',
            'LABEL_SOURCE',
            'CONFIRMED_YN',
            'MODEL_VERSION_ID',
            'MODEL_VERSION',
            'MODEL_CONFIDENCE',
            'FINAL_REASON',
            'FINAL_UPDATE_DT',
            'FINAL_UPDATE_USER',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_COLTYPE_FINAL') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLTYPE_FINAL does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLTYPE_FINAL', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLTYPE_FINAL column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLTYPE_FINAL'
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
               'FINAL_TYPE_CODE',
               'TYPE_GROUP_CODE',
               'LABEL_SOURCE',
               'CONFIRMED_YN',
               'MODEL_VERSION_ID',
               'MODEL_VERSION',
               'MODEL_CONFIDENCE',
               'FINAL_REASON',
               'FINAL_UPDATE_DT',
               'FINAL_UPDATE_USER',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLTYPE_FINAL column display order already matches.');
            RETURN;
        END IF;

        -- Keep OWNER visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLTYPE_FINAL', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLTYPE_FINAL', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLTYPE_FINAL column display order refreshed.');
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
        IF NOT table_exists('INIT$_TB_COLREL_CAT_PAIR') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLREL_CAT_PAIR does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLREL_CAT_PAIR', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_CAT_PAIR column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLREL_CAT_PAIR'
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
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_CAT_PAIR column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_CAT_PAIR', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_CAT_PAIR', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLREL_CAT_PAIR column display order refreshed.');
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
        IF NOT table_exists('INIT$_TB_COLREL_CAT_SUMMARY') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLREL_CAT_SUMMARY does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLREL_CAT_SUMMARY', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_CAT_SUMMARY column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLREL_CAT_SUMMARY'
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
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_CAT_SUMMARY column display order already matches.');
            RETURN;
        END IF;

        -- Keep RUN_SOURCE_TYPE visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_CAT_SUMMARY', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_CAT_SUMMARY', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLREL_CAT_SUMMARY column display order refreshed.');
    END;

    PROCEDURE reorder_relation_pair_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'COL_A',
            'COL_B',
            'COL_A_TYPE',
            'COL_B_TYPE',
            'RELATION_TYPE',
            'METRIC_NAME',
            'METRIC_VALUE',
            'ABS_METRIC_VALUE',
            'P_VALUE',
            'ROW_COUNT',
            'DF',
            'EXTRA_JSON',
            'PASS_YN',
            'CLUSTER_ID',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_COLREL_PAIR') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLREL_PAIR does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLREL_PAIR', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_PAIR column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLREL_PAIR'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'COL_A',
               'COL_B',
               'COL_A_TYPE',
               'COL_B_TYPE',
               'RELATION_TYPE',
               'METRIC_NAME',
               'METRIC_VALUE',
               'ABS_METRIC_VALUE',
               'P_VALUE',
               'ROW_COUNT',
               'DF',
               'EXTRA_JSON',
               'PASS_YN',
               'CLUSTER_ID',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_PAIR column display order already matches.');
            RETURN;
        END IF;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_PAIR', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_PAIR', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLREL_PAIR column display order refreshed.');
    END;

    PROCEDURE reorder_relation_summary_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'COLUMN_NAME',
            'COLUMN_TYPE',
            'PAIR_COUNT',
            'PASS_PAIR_COUNT',
            'AVG_ABS_METRIC_VALUE',
            'MAX_ABS_METRIC_VALUE',
            'RANK_NO',
            'SELECTED_YN',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_COLREL_SUMMARY') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLREL_SUMMARY does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLREL_SUMMARY', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_SUMMARY column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLREL_SUMMARY'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'COLUMN_NAME',
               'COLUMN_TYPE',
               'PAIR_COUNT',
               'PASS_PAIR_COUNT',
               'AVG_ABS_METRIC_VALUE',
               'MAX_ABS_METRIC_VALUE',
               'RANK_NO',
               'SELECTED_YN',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_SUMMARY column display order already matches.');
            RETURN;
        END IF;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_SUMMARY', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_SUMMARY', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLREL_SUMMARY column display order refreshed.');
    END;

    PROCEDURE reorder_relation_network_node_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'COLUMN_NAME',
            'COLUMN_TYPE',
            'CLUSTER_ID',
            'DEGREE_COUNT',
            'WEIGHTED_DEGREE',
            'CENTRALITY_SCORE',
            'SELECTED_YN',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_COLREL_NETWORK_NODE') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLREL_NETWORK_NODE does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLREL_NETWORK_NODE', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_NETWORK_NODE column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLREL_NETWORK_NODE'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'COLUMN_NAME',
               'COLUMN_TYPE',
               'CLUSTER_ID',
               'DEGREE_COUNT',
               'WEIGHTED_DEGREE',
               'CENTRALITY_SCORE',
               'SELECTED_YN',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_NETWORK_NODE column display order already matches.');
            RETURN;
        END IF;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_NETWORK_NODE', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_NETWORK_NODE', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLREL_NETWORK_NODE column display order refreshed.');
    END;

    PROCEDURE reorder_relation_network_edge_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'RUN_SOURCE_TYPE',
            'RUN_ID',
            'OWNER',
            'TABLE_NAME',
            'COL_A',
            'COL_B',
            'RELATION_TYPE',
            'METRIC_NAME',
            'METRIC_VALUE',
            'ABS_METRIC_VALUE',
            'CLUSTER_ID',
            'PASS_YN',
            'CREATE_DT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_COLREL_NETWORK_EDGE') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_COLREL_NETWORK_EDGE does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_COLREL_NETWORK_EDGE', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_NETWORK_EDGE column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_COLREL_NETWORK_EDGE'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'RUN_SOURCE_TYPE',
               'RUN_ID',
               'OWNER',
               'TABLE_NAME',
               'COL_A',
               'COL_B',
               'RELATION_TYPE',
               'METRIC_NAME',
               'METRIC_VALUE',
               'ABS_METRIC_VALUE',
               'CLUSTER_ID',
               'PASS_YN',
               'CREATE_DT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLREL_NETWORK_EDGE column display order already matches.');
            RETURN;
        END IF;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_NETWORK_EDGE', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_COLREL_NETWORK_EDGE', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_COLREL_NETWORK_EDGE column display order refreshed.');
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
        IF NOT table_exists('INIT$_TB_RULEVIOL_ASSOC') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_RULEVIOL_ASSOC does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_RULEVIOL_ASSOC', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_RULEVIOL_ASSOC column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_RULEVIOL_ASSOC'
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
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_RULEVIOL_ASSOC column display order already matches.');
            RETURN;
        END IF;

        -- Keep VIOLATION_ID visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_RULEVIOL_ASSOC', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_RULEVIOL_ASSOC', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_RULEVIOL_ASSOC column display order refreshed.');
    END;

    PROCEDURE reorder_flow_work_node_run_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'FLOW_NODE_RUN_ID',
            'FLOW_RUN_ID',
            'FLOW_ID',
            'NODE_KEY',
            'NODE_NAME',
            'NODE_TYPE',
            'RUN_LEVEL',
            'SORT_ORDER',
            'STATUS',
            'MESSAGE',
            'RUNTIME_PARAM_JSON',
            'NODE_PAYLOAD_JSON',
            'RUN_OUTPUT_JSON',
            'STARTED_AT',
            'FINISHED_AT',
            'CREATED_AT',
            'UPDATED_AT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_FLOW_WORK_NODE_RUN') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE INIT$_TB_FLOW_WORK_NODE_RUN does not exist.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_FLOW_WORK_NODE_RUN', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_FLOW_WORK_NODE_RUN column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_FLOW_WORK_NODE_RUN'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'FLOW_NODE_RUN_ID',
               'FLOW_RUN_ID',
               'FLOW_ID',
               'NODE_KEY',
               'NODE_NAME',
               'NODE_TYPE',
               'RUN_LEVEL',
               'SORT_ORDER',
               'STATUS',
               'MESSAGE',
               'RUNTIME_PARAM_JSON',
               'NODE_PAYLOAD_JSON',
               'RUN_OUTPUT_JSON',
               'STARTED_AT',
               'FINISHED_AT',
               'CREATED_AT',
               'UPDATED_AT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_FLOW_WORK_NODE_RUN column display order already matches.');
            RETURN;
        END IF;

        -- Keep FLOW_NODE_RUN_ID visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_FLOW_WORK_NODE_RUN', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_FLOW_WORK_NODE_RUN', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_FLOW_WORK_NODE_RUN column display order refreshed.');
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

    add_column_if_missing('INIT$_TB_SCENARIO', 'DATA_WORK_RUN_ID', '"DATA_WORK_RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_SCENARIO', 'DATA_WORK_RUN_AT', '"DATA_WORK_RUN_AT" TIMESTAMP (6)');
    add_column_if_missing('INIT$_TB_DATA_WORK_RUN', 'DATA_RUN_ID', '"DATA_RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');

    IF table_exists('INIT$_TB_DATA_WORK_RUN') AND column_exists('INIT$_TB_DATA_WORK_RUN', 'DATA_RUN_ID') THEN
        run_ddl(
            'MIGRATE INIT$_TB_DATA_WORK_RUN.DATA_RUN_ID',
            q'[UPDATE "INIT$_TB_DATA_WORK_RUN"
                  SET "DATA_RUN_ID" = "WORK_RUN_ID"
                WHERE NVL("DATA_RUN_ID", 0) = 0]'
        );
        modify_column_default_not_null('INIT$_TB_DATA_WORK_RUN', 'DATA_RUN_ID', '0');
        run_ddl('COMMENT INIT$_TB_DATA_WORK_RUN.DATA_RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_DATA_WORK_RUN"."DATA_RUN_ID" IS 'Scenario shared DATA_WORK RUN_ID used by this job execution']');
    END IF;

    IF table_exists('INIT$_TB_SCENARIO') AND column_exists('INIT$_TB_SCENARIO', 'DATA_WORK_RUN_ID') THEN
        IF table_exists('INIT$_TB_DATA_WORK_RUN')
           AND table_exists('INIT$_TB_DATA_WORK_JOB')
           AND column_exists('INIT$_TB_DATA_WORK_RUN', 'DATA_RUN_ID') THEN
            run_ddl(
                'MIGRATE INIT$_TB_SCENARIO.DATA_WORK_RUN_ID',
                q'[UPDATE "INIT$_TB_SCENARIO" S
                      SET "DATA_WORK_RUN_ID" = NVL((
                              SELECT MAX(R."DATA_RUN_ID")
                                FROM "INIT$_TB_DATA_WORK_RUN" R
                                JOIN "INIT$_TB_DATA_WORK_JOB" J
                                  ON J."WORK_JOB_ID" = R."WORK_JOB_ID"
                               WHERE J."PROJECT_ID" = S."PROJECT_ID"
                                 AND J."SCENARIO_ID" = S."SCENARIO_ID"
                          ), NVL(S."DATA_WORK_RUN_ID", 0))
                    WHERE NVL(S."DATA_WORK_RUN_ID", 0) = 0]'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] MIGRATE INIT$_TB_SCENARIO.DATA_WORK_RUN_ID source tables are missing.');
        END IF;

        run_ddl(
            'NORMALIZE INIT$_TB_SCENARIO.DATA_WORK_RUN_ID',
            q'[UPDATE "INIT$_TB_SCENARIO"
                  SET "DATA_WORK_RUN_ID" = NVL("DATA_WORK_RUN_ID", 0)
                WHERE "DATA_WORK_RUN_ID" IS NULL]'
        );
        modify_column_default_not_null('INIT$_TB_SCENARIO', 'DATA_WORK_RUN_ID', '0');
        run_ddl('COMMENT INIT$_TB_SCENARIO.DATA_WORK_RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_SCENARIO"."DATA_WORK_RUN_ID" IS 'Current shared DATA_WORK RUN_ID for validation jobs']');
        run_ddl('COMMENT INIT$_TB_SCENARIO.DATA_WORK_RUN_AT', q'[COMMENT ON COLUMN "INIT$_TB_SCENARIO"."DATA_WORK_RUN_AT" IS 'Last DATA_WORK RUN_ID creation date/time']');
    END IF;

    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'MODEL_TYPE', '"MODEL_TYPE" VARCHAR2(80 BYTE)');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'TARGET_OWNER', '"TARGET_OWNER" VARCHAR2(128 BYTE) DEFAULT ''UNKNOWN'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'TARGET_TABLE', '"TARGET_TABLE" VARCHAR2(128 BYTE) DEFAULT ''UNKNOWN'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'RULE_SOURCE', '"RULE_SOURCE" VARCHAR2(80 BYTE)');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'CONDITION_COLUMN', '"CONDITION_COLUMN" VARCHAR2(128 BYTE)');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'CONDITION_VALUE', '"CONDITION_VALUE" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'SUPPORT_COUNT', '"SUPPORT_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'CONDITION_TOTAL_COUNT', '"CONDITION_TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'RESULT_TOTAL_COUNT', '"RESULT_TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_RULEDISC_ASSOC_SUM', 'TOTAL_COUNT', '"TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'COLUMN_DESC', '"COLUMN_DESC" VARCHAR2(4000 BYTE)');
    -- Existing prediction rows predate the V2 feature contract. Add the column
    -- without a default first so only migrated legacy rows are marked V1; new
    -- procedure executions write V2 explicitly and the steady-state default is V2.
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'PROFILE_VERSION', '"PROFILE_VERSION" VARCHAR2(30 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'SAMPLE_ROWS', '"SAMPLE_ROWS" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'SAMPLE_NOT_NULL_ROWS', '"SAMPLE_NOT_NULL_ROWS" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'SAMPLE_DISTINCT', '"SAMPLE_DISTINCT" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'NON_NULL_ROWS', '"NON_NULL_ROWS" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'NULL_RATIO', '"NULL_RATIO" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'NUMERIC_RATIO', '"NUMERIC_RATIO" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'INTEGER_RATIO', '"INTEGER_RATIO" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MIN_NUM_VALUE', '"MIN_NUM_VALUE" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MAX_NUM_VALUE', '"MAX_NUM_VALUE" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'AVG_TEXT_LENGTH', '"AVG_TEXT_LENGTH" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MAX_TEXT_LENGTH', '"MAX_TEXT_LENGTH" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'BASE_TYPE_CODE', '"BASE_TYPE_CODE" VARCHAR2(40 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'BASE_REASON', '"BASE_REASON" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MODL_TYPE_CODE', '"MODL_TYPE_CODE" VARCHAR2(40 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MODEL_VERSION_ID', '"MODEL_VERSION_ID" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MODEL_VERSION', '"MODEL_VERSION" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'MODEL_CONFIDENCE', '"MODEL_CONFIDENCE" NUMBER');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'FINAL_PREDICTED_TYPE', '"FINAL_PREDICTED_TYPE" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'FINAL_TYPE_CODE', '"FINAL_TYPE_CODE" VARCHAR2(40 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'TYPE_GROUP_CODE', '"TYPE_GROUP_CODE" VARCHAR2(20 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'FINAL_REASON', '"FINAL_REASON" VARCHAR2(1000 BYTE)');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'FINAL_UPDATE_DT', '"FINAL_UPDATE_DT" DATE');
    add_column_if_missing('INIT$_TB_COLTYPE_RESULT', 'FINAL_UPDATE_USER', '"FINAL_UPDATE_USER" VARCHAR2(128 BYTE)');

    IF table_exists('INIT$_TB_COLTYPE_RESULT') AND column_exists('INIT$_TB_COLTYPE_RESULT', 'PROFILE_VERSION') THEN
        run_ddl(
            'MIGRATE INIT$_TB_COLTYPE_RESULT.PROFILE_VERSION',
            q'[UPDATE "INIT$_TB_COLTYPE_RESULT"
                  SET "PROFILE_VERSION" = 'V1'
                WHERE "PROFILE_VERSION" IS NULL]'
        );
        modify_column_default_not_null('INIT$_TB_COLTYPE_RESULT', 'PROFILE_VERSION', q'['V2']');
    END IF;
    add_column_if_missing('INIT$_TB_COLREL_CAT_PAIR', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_COLREL_CAT_PAIR', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_COLREL_CAT_SUMMARY', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_COLREL_CAT_SUMMARY', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULEVIOL_ASSOC', 'RUN_SOURCE_TYPE', '"RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT ''DATA_WORK'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_RULEVIOL_ASSOC', 'RUN_ID', '"RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_FLOW_WORK_NODE', 'USE_YN', '"USE_YN" CHAR(1 BYTE) DEFAULT ''Y'' NOT NULL ENABLE');
    add_column_if_missing('INIT$_TB_FLOW_WORK_NODE_RUN', 'RUN_OUTPUT_JSON', '"RUN_OUTPUT_JSON" CLOB');

    FOR table_rec IN (
        SELECT 'INIT$_TB_COLTYPE_RESULT' AS TABLE_NAME, 'CK_INIT$_TB_PREDICTED_RUN_SRC' AS CONSTRAINT_NAME FROM DUAL UNION ALL
        SELECT 'INIT$_TB_COLREL_CAT_PAIR', 'CK_INIT$_TB_COLREL_CAT_PAIR_RUN' FROM DUAL UNION ALL
        SELECT 'INIT$_TB_COLREL_CAT_SUMMARY', 'CK_INIT$_TB_CAT_CORR_SUM_RUN' FROM DUAL UNION ALL
        SELECT 'INIT$_TB_RULEDISC_ASSOC_SUM', 'CK_INIT$_TB_ASSOC_RULE_RUN' FROM DUAL UNION ALL
        SELECT 'INIT$_TB_RULEVIOL_ASSOC', 'CK_INIT$_TB_RULE_VIOL_RUN' FROM DUAL
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

    IF table_exists('INIT$_TB_COLTYPE_RESULT') THEN
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."RUN_ID" IS 'DATA_WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.MODEL_NAME', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."MODEL_NAME" IS 'Logical model name requested by the caller; lifecycle physical model is identified by MODEL_VERSION_ID']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.COLUMN_DESC', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."COLUMN_DESC" IS 'Target table column comment']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.BASE_REASON', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."BASE_REASON" IS 'Reason produced by rule-based profiling logic']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.FINAL_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."FINAL_PREDICTED_TYPE" IS 'Deprecated execution snapshot final predicted type. Source of truth is INIT$_TB_COLTYPE_FINAL']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.FINAL_REASON', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."FINAL_REASON" IS 'Deprecated execution snapshot final reason. Source of truth is INIT$_TB_COLTYPE_FINAL']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.FINAL_UPDATE_DT', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."FINAL_UPDATE_DT" IS 'Deprecated execution snapshot final update date. Source of truth is INIT$_TB_COLTYPE_FINAL']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_RESULT.FINAL_UPDATE_USER', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_RESULT"."FINAL_UPDATE_USER" IS 'Deprecated execution snapshot final update user. Source of truth is INIT$_TB_COLTYPE_FINAL']');

        drop_primary_key_if_exists('INIT$_TB_COLTYPE_RESULT');
        IF NOT primary_key_exists('INIT$_TB_COLTYPE_RESULT') THEN
            run_ddl(
                'ADD PK_INIT$_TB_COLTYPE_RESULT',
                q'[ALTER TABLE "INIT$_TB_COLTYPE_RESULT" ADD CONSTRAINT "PK_INIT$_TB_COLTYPE_RESULT" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "MODEL_NAME", "COLUMN_NAME") ENABLE]'
            );
        END IF;

        drop_index_if_exists('IX_INIT$_TB_COLTYPE_RESULT_01');
    END IF;

    create_table_if_missing('INIT$_TB_COLTYPE_FINAL', q'[
CREATE TABLE "INIT$_TB_COLTYPE_FINAL" (
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
    "FINAL_PREDICTED_TYPE" VARCHAR2(4000 BYTE),
    "FINAL_TYPE_CODE" VARCHAR2(40 BYTE),
    "TYPE_GROUP_CODE" VARCHAR2(20 BYTE),
    "LABEL_SOURCE" VARCHAR2(30 BYTE) DEFAULT 'LEGACY_UNKNOWN' NOT NULL ENABLE,
    "CONFIRMED_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "MODEL_VERSION_ID" NUMBER,
    "MODEL_VERSION" NUMBER,
    "MODEL_CONFIDENCE" NUMBER,
    "FINAL_REASON" VARCHAR2(1000 BYTE),
    "FINAL_UPDATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    "FINAL_UPDATE_USER" VARCHAR2(128 BYTE),
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FINAL_SRC" CHECK ("SOURCE_RUN_SOURCE_TYPE" IS NULL OR "SOURCE_RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FINAL_LABEL" CHECK ("LABEL_SOURCE" IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH', 'USER_CONFIRMED', 'IMPORTED_GOLD', 'LEGACY_UNKNOWN')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FINAL_CONF" CHECK ("CONFIRMED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FINAL_GROUP" CHECK ("TYPE_GROUP_CODE" IS NULL OR "TYPE_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FIN_CODE" CHECK ("FINAL_TYPE_CODE" IS NULL OR "FINAL_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_PRED_FIN_SCORE" CHECK ("MODEL_CONFIDENCE" IS NULL OR "MODEL_CONFIDENCE" BETWEEN 0 AND 1) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLTYPE_FINAL" PRIMARY KEY ("OWNER", "TABLE_NAME", "COLUMN_NAME")
)]');

    IF table_exists('INIT$_TB_COLTYPE_FINAL') THEN
        -- A user may explicitly clear a previously confirmed final type.
        -- Keep the master row for provenance, but permit FINAL_PREDICTED_TYPE
        -- and its derived codes to be NULL.
        IF column_nullable_yn('INIT$_TB_COLTYPE_FINAL', 'FINAL_PREDICTED_TYPE') = 'N' THEN
            run_ddl(
                'ALLOW NULL INIT$_TB_COLTYPE_FINAL.FINAL_PREDICTED_TYPE',
                q'[ALTER TABLE "INIT$_TB_COLTYPE_FINAL" MODIFY ("FINAL_PREDICTED_TYPE" NULL)]'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_COLTYPE_FINAL.FINAL_PREDICTED_TYPE is already nullable.');
        END IF;
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'COLUMN_DESC', '"COLUMN_DESC" VARCHAR2(4000 BYTE)');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'FINAL_TYPE_CODE', '"FINAL_TYPE_CODE" VARCHAR2(40 BYTE)');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'TYPE_GROUP_CODE', '"TYPE_GROUP_CODE" VARCHAR2(20 BYTE)');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'LABEL_SOURCE', '"LABEL_SOURCE" VARCHAR2(30 BYTE) DEFAULT ''LEGACY_UNKNOWN'' NOT NULL ENABLE');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'CONFIRMED_YN', '"CONFIRMED_YN" CHAR(1 BYTE) DEFAULT ''N'' NOT NULL ENABLE');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'MODEL_VERSION_ID', '"MODEL_VERSION_ID" NUMBER');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'MODEL_VERSION', '"MODEL_VERSION" NUMBER');
        add_column_if_missing('INIT$_TB_COLTYPE_FINAL', 'MODEL_CONFIDENCE', '"MODEL_CONFIDENCE" NUMBER');

        -- Existing rows survive a RENAME, but their new canonical-code columns
        -- must be populated before the model-lifecycle screens can group them.
        -- Do not promote historical values to confirmed labels here: old final
        -- values may have come from a rule/model rather than an explicit user
        -- decision. M90003 trains only after a user confirms the label.
        run_ddl('BACKFILL INIT$_TB_COLTYPE_FINAL TYPE CODES', q'[
MERGE INTO "INIT$_TB_COLTYPE_FINAL" T
USING (
    SELECT ROWID AS ROW_KEY
         , CASE UPPER(TRIM("FINAL_PREDICTED_TYPE"))
               WHEN '숫자형식별자' THEN 'NUM_IDENTIFIER'
               WHEN 'NUM_IDENTIFIER' THEN 'NUM_IDENTIFIER'
               WHEN 'NUMERIC IDENTIFIER' THEN 'NUM_IDENTIFIER'
               WHEN '문자형식별자' THEN 'CHAR_IDENTIFIER'
               WHEN 'CHAR_IDENTIFIER' THEN 'CHAR_IDENTIFIER'
               WHEN 'CHARACTER IDENTIFIER' THEN 'CHAR_IDENTIFIER'
               WHEN '숫자형연속형' THEN 'NUM_CONTINUOUS'
               WHEN 'NUM_CONTINUOUS' THEN 'NUM_CONTINUOUS'
               WHEN 'NUMERIC CONTINUOUS' THEN 'NUM_CONTINUOUS'
               WHEN '이산형연속형' THEN 'NUM_DISCRETE'
               WHEN 'NUM_DISCRETE' THEN 'NUM_DISCRETE'
               WHEN 'NUMERIC DISCRETE' THEN 'NUM_DISCRETE'
               WHEN '일반적범주형' THEN 'CAT_GENERAL'
               WHEN 'CAT_GENERAL' THEN 'CAT_GENERAL'
               WHEN 'GENERAL CATEGORICAL' THEN 'CAT_GENERAL'
               WHEN '문자형범주형' THEN 'CAT_CHAR'
               WHEN 'CAT_CHAR' THEN 'CAT_CHAR'
               WHEN 'CHARACTER CATEGORICAL' THEN 'CAT_CHAR'
               WHEN '순서형범주형' THEN 'CAT_ORDINAL'
               WHEN 'CAT_ORDINAL' THEN 'CAT_ORDINAL'
               WHEN 'ORDINAL CATEGORICAL' THEN 'CAT_ORDINAL'
               WHEN '숫자형범주형' THEN 'CAT_NUMERIC'
               WHEN 'CAT_NUMERIC' THEN 'CAT_NUMERIC'
               WHEN 'NUMERIC CATEGORICAL' THEN 'CAT_NUMERIC'
               WHEN '단순형텍스트' THEN 'FREE_TEXT'
               WHEN 'FREE_TEXT' THEN 'FREE_TEXT'
               WHEN 'FREE TEXT' THEN 'FREE_TEXT'
               WHEN '기타데이터형' THEN 'OTHER'
               WHEN 'OTHER' THEN 'OTHER'
               WHEN '미상데이터형' THEN 'UNKNOWN'
               WHEN 'UNKNOWN' THEN 'UNKNOWN'
               ELSE 'UNKNOWN'
           END AS TYPE_CODE
      FROM "INIT$_TB_COLTYPE_FINAL"
     WHERE "FINAL_PREDICTED_TYPE" IS NOT NULL
) S
   ON (T.ROWID = S.ROW_KEY)
 WHEN MATCHED THEN UPDATE
     SET T."FINAL_TYPE_CODE" = S.TYPE_CODE
       , T."TYPE_GROUP_CODE" = CASE
             WHEN S.TYPE_CODE IN ('NUM_CONTINUOUS', 'NUM_DISCRETE') THEN 'CONTINUOUS'
             WHEN S.TYPE_CODE IN ('CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC') THEN 'CATEGORICAL'
             ELSE 'OTHER'
         END
       , T."LABEL_SOURCE" = NVL(T."LABEL_SOURCE", 'LEGACY_UNKNOWN')
       , T."CONFIRMED_YN" = NVL(T."CONFIRMED_YN", 'N')
 WHERE NVL(T."FINAL_TYPE_CODE", '~') <> S.TYPE_CODE
    OR NVL(T."TYPE_GROUP_CODE", '~') <> CASE
           WHEN S.TYPE_CODE IN ('NUM_CONTINUOUS', 'NUM_DISCRETE') THEN 'CONTINUOUS'
           WHEN S.TYPE_CODE IN ('CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC') THEN 'CATEGORICAL'
           ELSE 'OTHER'
       END
    OR T."LABEL_SOURCE" IS NULL
    OR T."CONFIRMED_YN" IS NULL
]');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL', q'[COMMENT ON TABLE "INIT$_TB_COLTYPE_FINAL" IS 'Effective column logical type master with label provenance']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.OWNER', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."OWNER" IS 'Target table owner']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.TABLE_NAME', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."TABLE_NAME" IS 'Target table name']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.COLUMN_NAME', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."COLUMN_NAME" IS 'Column name']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.COLUMN_DESC', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."COLUMN_DESC" IS 'Target table column comment captured from the latest label source']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.COLUMN_ID', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."COLUMN_ID" IS 'Column order captured from the latest label source']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.DATA_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."DATA_TYPE" IS 'Physical data type captured from the latest label source']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.SOURCE_RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."SOURCE_RUN_SOURCE_TYPE" IS 'Run source type that produced the latest label evidence']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.SOURCE_RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."SOURCE_RUN_ID" IS 'DATA_WORK_RUN_ID or FLOW_RUN_ID that produced the latest label evidence']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.SOURCE_MODEL_NAME', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."SOURCE_MODEL_NAME" IS 'Prediction model name used as label evidence']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.BASE_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."BASE_PREDICTED_TYPE" IS 'Rule-based prediction retained as label evidence']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.MODL_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."MODL_PREDICTED_TYPE" IS 'Model prediction retained as label evidence']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.FINAL_PREDICTED_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."FINAL_PREDICTED_TYPE" IS 'Effective display type; provenance and confirmation columns identify its source']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.FINAL_TYPE_CODE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."FINAL_TYPE_CODE" IS 'Canonical final type code']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.TYPE_GROUP_CODE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."TYPE_GROUP_CODE" IS 'Top-level type group: CATEGORICAL, CONTINUOUS, or OTHER']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.LABEL_SOURCE', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."LABEL_SOURCE" IS 'Label provenance']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.CONFIRMED_YN', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."CONFIRMED_YN" IS 'Explicit confirmation flag']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.FINAL_REASON', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."FINAL_REASON" IS 'User note for final predicted type decision']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.FINAL_UPDATE_DT', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."FINAL_UPDATE_DT" IS 'Final predicted type update date']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.FINAL_UPDATE_USER', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."FINAL_UPDATE_USER" IS 'Final predicted type update user']');
        run_ddl('COMMENT INIT$_TB_COLTYPE_FINAL.CREATE_DT', q'[COMMENT ON COLUMN "INIT$_TB_COLTYPE_FINAL"."CREATE_DT" IS 'Create date']');
        IF NOT constraint_exists('CK_INIT$_TB_PRED_FINAL_LABEL') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_FINAL_LABEL', q'[ALTER TABLE "INIT$_TB_COLTYPE_FINAL" ADD CONSTRAINT "CK_INIT$_TB_PRED_FINAL_LABEL" CHECK ("LABEL_SOURCE" IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH', 'USER_CONFIRMED', 'IMPORTED_GOLD', 'LEGACY_UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_FINAL_CONF') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_FINAL_CONF', q'[ALTER TABLE "INIT$_TB_COLTYPE_FINAL" ADD CONSTRAINT "CK_INIT$_TB_PRED_FINAL_CONF" CHECK ("CONFIRMED_YN" IN ('Y', 'N')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_FINAL_GROUP') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_FINAL_GROUP', q'[ALTER TABLE "INIT$_TB_COLTYPE_FINAL" ADD CONSTRAINT "CK_INIT$_TB_PRED_FINAL_GROUP" CHECK ("TYPE_GROUP_CODE" IS NULL OR "TYPE_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_FIN_CODE') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_FIN_CODE', q'[ALTER TABLE "INIT$_TB_COLTYPE_FINAL" ADD CONSTRAINT "CK_INIT$_TB_PRED_FIN_CODE" CHECK ("FINAL_TYPE_CODE" IS NULL OR "FINAL_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_FIN_SCORE') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_FIN_SCORE', q'[ALTER TABLE "INIT$_TB_COLTYPE_FINAL" ADD CONSTRAINT "CK_INIT$_TB_PRED_FIN_SCORE" CHECK ("MODEL_CONFIDENCE" IS NULL OR "MODEL_CONFIDENCE" BETWEEN 0 AND 1) ENABLE]');
        END IF;
    END IF;

    IF table_exists('INIT$_TB_COLTYPE_RESULT') THEN
        IF NOT constraint_exists('CK_INIT$_TB_PRED_TYPE_GROUP') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_TYPE_GROUP', q'[ALTER TABLE "INIT$_TB_COLTYPE_RESULT" ADD CONSTRAINT "CK_INIT$_TB_PRED_TYPE_GROUP" CHECK ("TYPE_GROUP_CODE" IS NULL OR "TYPE_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_BASE_CODE') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_BASE_CODE', q'[ALTER TABLE "INIT$_TB_COLTYPE_RESULT" ADD CONSTRAINT "CK_INIT$_TB_PRED_BASE_CODE" CHECK ("BASE_TYPE_CODE" IS NULL OR "BASE_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_MODL_CODE') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_MODL_CODE', q'[ALTER TABLE "INIT$_TB_COLTYPE_RESULT" ADD CONSTRAINT "CK_INIT$_TB_PRED_MODL_CODE" CHECK ("MODL_TYPE_CODE" IS NULL OR "MODL_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_FINAL_CODE') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_FINAL_CODE', q'[ALTER TABLE "INIT$_TB_COLTYPE_RESULT" ADD CONSTRAINT "CK_INIT$_TB_PRED_FINAL_CODE" CHECK ("FINAL_TYPE_CODE" IS NULL OR "FINAL_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_PRED_MODEL_CONF') THEN
            run_ddl('ADD CK_INIT$_TB_PRED_MODEL_CONF', q'[ALTER TABLE "INIT$_TB_COLTYPE_RESULT" ADD CONSTRAINT "CK_INIT$_TB_PRED_MODEL_CONF" CHECK ("MODEL_CONFIDENCE" IS NULL OR "MODEL_CONFIDENCE" BETWEEN 0 AND 1) ENABLE]');
        END IF;
    END IF;

    create_index_if_missing('IX_INIT$_TB_COLTYPE_FINAL_01', 'INIT$_TB_COLTYPE_FINAL', q'[
CREATE INDEX "IX_INIT$_TB_COLTYPE_FINAL_01"
    ON "INIT$_TB_COLTYPE_FINAL" ("FINAL_PREDICTED_TYPE", "OWNER", "TABLE_NAME")
]');

    create_index_if_missing('IX_INIT$_TB_COLTYPE_FINAL_02', 'INIT$_TB_COLTYPE_FINAL', q'[
CREATE INDEX "IX_INIT$_TB_COLTYPE_FINAL_02"
    ON "INIT$_TB_COLTYPE_FINAL" ("SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID", "SOURCE_MODEL_NAME")
]');

    create_table_if_missing('INIT$_TB_COLTYPE_PROFILE', q'[
CREATE TABLE "INIT$_TB_COLTYPE_PROFILE" (
    "PROFILE_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "FEATURE_VERSION" VARCHAR2(30 BYTE) DEFAULT 'V2' NOT NULL ENABLE,
    "COLUMN_DESC" VARCHAR2(4000 BYTE),
    "COLUMN_ID" NUMBER,
    "DATA_TYPE" VARCHAR2(128 BYTE),
    "TOTAL_ROWS" NUMBER,
    "NON_NULL_ROWS" NUMBER,
    "SAMPLE_ROWS" NUMBER,
    "SAMPLE_NOT_NULL_ROWS" NUMBER,
    "NUM_DISTINCT" NUMBER,
    "SAMPLE_DISTINCT" NUMBER,
    "DISTINCT_RATIO" NUMBER,
    "NULL_RATIO" NUMBER,
    "LOG_DATA_TYPE" VARCHAR2(30 BYTE),
    "ENTROPY" NUMBER,
    "NORM_ENTROPY" NUMBER,
    "NUMERIC_RATIO" NUMBER,
    "INTEGER_RATIO" NUMBER,
    "MIN_NUM_VALUE" NUMBER,
    "MAX_NUM_VALUE" NUMBER,
    "AVG_TEXT_LENGTH" NUMBER,
    "MAX_TEXT_LENGTH" NUMBER,
    "PROFILE_HASH" VARCHAR2(64 BYTE),
    "CREATED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLTYPE_PROFILE" PRIMARY KEY ("PROFILE_ID"),
    CONSTRAINT "UK_INIT$_TB_COL_PROFILE" UNIQUE ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME", "FEATURE_VERSION"),
    CONSTRAINT "CK_INIT$_TB_COL_PROFILE_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE
)]');

    create_table_if_missing('INIT$_TB_COLTYPE_LABEL', q'[
CREATE TABLE "INIT$_TB_COLTYPE_LABEL" (
    "LABEL_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TYPE_CODE" VARCHAR2(40 BYTE) NOT NULL ENABLE,
    "TYPE_GROUP_CODE" VARCHAR2(20 BYTE) NOT NULL ENABLE,
    "DISPLAY_TYPE_VALUE" VARCHAR2(4000 BYTE),
    "LABEL_SOURCE" VARCHAR2(30 BYTE) DEFAULT 'LEGACY_UNKNOWN' NOT NULL ENABLE,
    "CONFIRMED_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "LABEL_CONFIDENCE" NUMBER,
    "SOURCE_PROFILE_ID" NUMBER,
    "SOURCE_RUN_SOURCE_TYPE" VARCHAR2(30 BYTE),
    "SOURCE_RUN_ID" NUMBER,
    "SOURCE_MODEL_NAME" VARCHAR2(261 BYTE),
    "LABEL_REASON" VARCHAR2(1000 BYTE),
    "CONFIRMED_BY" VARCHAR2(128 BYTE),
    "CONFIRMED_AT" TIMESTAMP (6),
    "CREATED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    "UPDATED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLTYPE_LABEL" PRIMARY KEY ("LABEL_ID"),
    CONSTRAINT "UK_INIT$_TB_COL_TYPE_LABEL" UNIQUE ("OWNER", "TABLE_NAME", "COLUMN_NAME"),
    CONSTRAINT "CK_INIT$_TB_COL_LABEL_SRC" CHECK ("LABEL_SOURCE" IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH', 'USER_CONFIRMED', 'IMPORTED_GOLD', 'LEGACY_UNKNOWN')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_LABEL_CONF" CHECK ("CONFIRMED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_LABEL_GROUP" CHECK ("TYPE_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_LABEL_TYPE" CHECK ("TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_LABEL_SCORE" CHECK ("LABEL_CONFIDENCE" IS NULL OR "LABEL_CONFIDENCE" BETWEEN 0 AND 1) ENABLE
)]');

    create_table_if_missing('INIT$_TB_COLTYPE_LABEL_HIST', q'[
CREATE TABLE "INIT$_TB_COLTYPE_LABEL_HIST" (
    "LABEL_HISTORY_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "LABEL_ID" NUMBER,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "PREVIOUS_TYPE_CODE" VARCHAR2(40 BYTE),
    "NEW_TYPE_CODE" VARCHAR2(40 BYTE),
    "PREVIOUS_GROUP_CODE" VARCHAR2(20 BYTE),
    "NEW_GROUP_CODE" VARCHAR2(20 BYTE),
    "PREVIOUS_DISPLAY_VALUE" VARCHAR2(4000 BYTE),
    "NEW_DISPLAY_VALUE" VARCHAR2(4000 BYTE),
    "LABEL_SOURCE" VARCHAR2(30 BYTE) NOT NULL ENABLE,
    "CONFIRMED_YN" CHAR(1 BYTE) NOT NULL ENABLE,
    "CHANGE_REASON" VARCHAR2(1000 BYTE),
    "SOURCE_RUN_SOURCE_TYPE" VARCHAR2(30 BYTE),
    "SOURCE_RUN_ID" NUMBER,
    "SOURCE_MODEL_NAME" VARCHAR2(261 BYTE),
    "CHANGED_BY" VARCHAR2(128 BYTE),
    "CHANGED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLTYPE_LABEL_HIST" PRIMARY KEY ("LABEL_HISTORY_ID"),
    CONSTRAINT "CK_INIT$_TB_COL_HIST_SRC" CHECK ("LABEL_SOURCE" IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH', 'USER_CONFIRMED', 'IMPORTED_GOLD', 'LEGACY_UNKNOWN')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_HIST_CONF" CHECK ("CONFIRMED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_HIST_PGRP" CHECK ("PREVIOUS_GROUP_CODE" IS NULL OR "PREVIOUS_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_HIST_NGRP" CHECK ("NEW_GROUP_CODE" IS NULL OR "NEW_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_HIST_PREV" CHECK ("PREVIOUS_TYPE_CODE" IS NULL OR "PREVIOUS_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COL_HIST_NEW" CHECK ("NEW_TYPE_CODE" IS NULL OR "NEW_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE
)]');

    create_table_if_missing('INIT$_TB_OML_TRAIN_RUN', q'[
CREATE TABLE "INIT$_TB_OML_TRAIN_RUN" (
    "TRAIN_RUN_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "MODEL_KEY" VARCHAR2(100 BYTE) NOT NULL ENABLE,
    "STATUS_CODE" VARCHAR2(20 BYTE) DEFAULT 'REQUESTED' NOT NULL ENABLE,
    "ALGORITHM_CODE" VARCHAR2(50 BYTE) DEFAULT 'DECISION_TREE' NOT NULL ENABLE,
    "FEATURE_VERSION" VARCHAR2(30 BYTE) DEFAULT 'V2' NOT NULL ENABLE,
    "LABEL_VERSION" VARCHAR2(30 BYTE) DEFAULT 'V2' NOT NULL ENABLE,
    "TRAIN_SOURCE_FILTER" VARCHAR2(200 BYTE),
    "MIN_TRAIN_ROWS" NUMBER DEFAULT 100 NOT NULL ENABLE,
    "HOLDOUT_PERCENT" NUMBER DEFAULT 20 NOT NULL ENABLE,
    "MAX_INPUT_ROWS" NUMBER DEFAULT 100000 NOT NULL ENABLE,
    "RANDOM_SEED" NUMBER DEFAULT 42 NOT NULL ENABLE,
    "CONFIG_JSON" CLOB,
    "CANDIDATE_MODEL_NAME" VARCHAR2(128 BYTE),
    "MODEL_VERSION_ID" NUMBER,
    "REQUESTED_BY" VARCHAR2(128 BYTE),
    "REQUESTED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    "STARTED_AT" TIMESTAMP (6),
    "FINISHED_AT" TIMESTAMP (6),
    "TRAIN_ROW_COUNT" NUMBER,
    "VALID_ROW_COUNT" NUMBER,
    "TEST_ROW_COUNT" NUMBER,
    "ERROR_MESSAGE" CLOB,
    CONSTRAINT "PK_INIT$_TB_OML_TRAIN_RUN" PRIMARY KEY ("TRAIN_RUN_ID"),
    CONSTRAINT "CK_INIT$_TB_TYPE_RUN_STATUS" CHECK ("STATUS_CODE" IN ('REQUESTED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_TYPE_HOLDOUT" CHECK ("HOLDOUT_PERCENT" BETWEEN 5 AND 40) ENABLE
)]');

    rename_column_if_needed(
        'INIT$_TB_OML_TRAIN_RUN',
        'LABEL_SOURCE_FILTER',
        'TRAIN_SOURCE_FILTER'
    );
    rename_column_if_needed(
        'INIT$_TB_OML_TRAIN_RUN',
        'MIN_CONFIRMED_ROWS',
        'MIN_TRAIN_ROWS'
    );
    add_column_if_missing(
        'INIT$_TB_OML_TRAIN_RUN',
        'TRAIN_SOURCE_FILTER',
        '"TRAIN_SOURCE_FILTER" VARCHAR2(200 BYTE)'
    );
    add_column_if_missing(
        'INIT$_TB_OML_TRAIN_RUN',
        'MIN_TRAIN_ROWS',
        '"MIN_TRAIN_ROWS" NUMBER DEFAULT 100 NOT NULL ENABLE'
    );

    IF table_exists('INIT$_TB_OML_TRAIN_RUN') THEN
        run_ddl(
            'REMOVE INIT$_TB_OML_TRAIN_RUN.MODEL_KEY DEFAULT',
            q'[ALTER TABLE "INIT$_TB_OML_TRAIN_RUN" MODIFY ("MODEL_KEY" DEFAULT NULL)]'
        );
        run_ddl('COMMENT INIT$_TB_OML_TRAIN_RUN.MODEL_KEY', q'[COMMENT ON COLUMN "INIT$_TB_OML_TRAIN_RUN"."MODEL_KEY" IS 'Logical namespace that separates reusable OML model families']');
        run_ddl('COMMENT INIT$_TB_OML_TRAIN_RUN.TRAIN_SOURCE_FILTER', q'[COMMENT ON COLUMN "INIT$_TB_OML_TRAIN_RUN"."TRAIN_SOURCE_FILTER" IS 'Optional domain-specific training source filter']');
        run_ddl('COMMENT INIT$_TB_OML_TRAIN_RUN.MIN_TRAIN_ROWS', q'[COMMENT ON COLUMN "INIT$_TB_OML_TRAIN_RUN"."MIN_TRAIN_ROWS" IS 'Minimum usable training row count']');
    END IF;

    create_table_if_missing('INIT$_TB_OML_MODEL_REGISTRY', q'[
CREATE TABLE "INIT$_TB_OML_MODEL_REGISTRY" (
    "MODEL_VERSION_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "MODEL_KEY" VARCHAR2(100 BYTE) NOT NULL ENABLE,
    "VERSION_NO" NUMBER NOT NULL ENABLE,
    "PHYSICAL_MODEL_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "ALGORITHM_CODE" VARCHAR2(50 BYTE) DEFAULT 'DECISION_TREE' NOT NULL ENABLE,
    "FEATURE_VERSION" VARCHAR2(30 BYTE) DEFAULT 'V2' NOT NULL ENABLE,
    "LABEL_VERSION" VARCHAR2(30 BYTE) DEFAULT 'V2' NOT NULL ENABLE,
    "STATUS_CODE" VARCHAR2(20 BYTE) DEFAULT 'CANDIDATE' NOT NULL ENABLE,
    "TRAIN_RUN_ID" NUMBER,
    "TRAIN_ROW_COUNT" NUMBER,
    "VALID_ROW_COUNT" NUMBER,
    "TEST_ROW_COUNT" NUMBER,
    "ACCURACY" NUMBER,
    "BALANCED_ACCURACY" NUMBER,
    "MACRO_F1" NUMBER,
    "METRICS_JSON" CLOB,
    "ERROR_MESSAGE" CLOB,
    "CREATED_BY" VARCHAR2(128 BYTE),
    "CREATED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    "ACTIVATED_BY" VARCHAR2(128 BYTE),
    "ACTIVATED_AT" TIMESTAMP (6),
    "ARCHIVED_BY" VARCHAR2(128 BYTE),
    "ARCHIVED_AT" TIMESTAMP (6),
    CONSTRAINT "PK_INIT$_TB_OML_MODEL_REGISTRY" PRIMARY KEY ("MODEL_VERSION_ID"),
    CONSTRAINT "UK_INIT$_TB_TYPE_MODEL_VER" UNIQUE ("MODEL_KEY", "VERSION_NO"),
    CONSTRAINT "UK_INIT$_TB_TYPE_MODEL_NAME" UNIQUE ("PHYSICAL_MODEL_NAME"),
    CONSTRAINT "CK_INIT$_TB_TYPE_REG_STATUS" CHECK ("STATUS_CODE" IN ('CANDIDATE', 'ACTIVE', 'ARCHIVED', 'FAILED')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_TYPE_REG_ACC" CHECK ("ACCURACY" IS NULL OR "ACCURACY" BETWEEN 0 AND 1) ENABLE,
    CONSTRAINT "CK_INIT$_TB_TYPE_REG_BAL" CHECK ("BALANCED_ACCURACY" IS NULL OR "BALANCED_ACCURACY" BETWEEN 0 AND 1) ENABLE,
    CONSTRAINT "CK_INIT$_TB_TYPE_REG_F1" CHECK ("MACRO_F1" IS NULL OR "MACRO_F1" BETWEEN 0 AND 1) ENABLE
)]');

    IF table_exists('INIT$_TB_OML_MODEL_REGISTRY') THEN
        run_ddl(
            'REMOVE INIT$_TB_OML_MODEL_REGISTRY.MODEL_KEY DEFAULT',
            q'[ALTER TABLE "INIT$_TB_OML_MODEL_REGISTRY" MODIFY ("MODEL_KEY" DEFAULT NULL)]'
        );
    END IF;

    create_table_if_missing('INIT$_TB_OML_MODEL_METRIC', q'[
CREATE TABLE "INIT$_TB_OML_MODEL_METRIC" (
    "METRIC_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "MODEL_VERSION_ID" NUMBER NOT NULL ENABLE,
    "SPLIT_CODE" VARCHAR2(20 BYTE) DEFAULT 'HOLDOUT' NOT NULL ENABLE,
    "ACTUAL_CLASS_CODE" VARCHAR2(400 BYTE),
    "PREDICTED_CLASS_CODE" VARCHAR2(400 BYTE),
    "CLASS_GROUP_CODE" VARCHAR2(100 BYTE),
    "METRIC_NAME" VARCHAR2(50 BYTE) NOT NULL ENABLE,
    "METRIC_VALUE" NUMBER,
    "SUPPORT_COUNT" NUMBER,
    "CREATED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    CONSTRAINT "PK_INIT$_TB_OML_MODEL_METRIC" PRIMARY KEY ("METRIC_ID"),
    CONSTRAINT "UK_INIT$_TB_TYPE_MODEL_MET" UNIQUE ("MODEL_VERSION_ID", "SPLIT_CODE", "ACTUAL_CLASS_CODE", "PREDICTED_CLASS_CODE", "CLASS_GROUP_CODE", "METRIC_NAME")
)]');

    rename_column_if_needed(
        'INIT$_TB_OML_MODEL_METRIC',
        'TYPE_CODE',
        'ACTUAL_CLASS_CODE'
    );
    rename_column_if_needed(
        'INIT$_TB_OML_MODEL_METRIC',
        'PREDICTED_TYPE_CODE',
        'PREDICTED_CLASS_CODE'
    );
    rename_column_if_needed(
        'INIT$_TB_OML_MODEL_METRIC',
        'TYPE_GROUP_CODE',
        'CLASS_GROUP_CODE'
    );
    add_column_if_missing(
        'INIT$_TB_OML_MODEL_METRIC',
        'ACTUAL_CLASS_CODE',
        '"ACTUAL_CLASS_CODE" VARCHAR2(400 BYTE)'
    );
    add_column_if_missing(
        'INIT$_TB_OML_MODEL_METRIC',
        'PREDICTED_CLASS_CODE',
        '"PREDICTED_CLASS_CODE" VARCHAR2(400 BYTE)'
    );
    add_column_if_missing(
        'INIT$_TB_OML_MODEL_METRIC',
        'CLASS_GROUP_CODE',
        '"CLASS_GROUP_CODE" VARCHAR2(100 BYTE)'
    );
    IF table_exists('INIT$_TB_OML_MODEL_METRIC') THEN
        run_ddl(
            'MODIFY INIT$_TB_OML_MODEL_METRIC.ACTUAL_CLASS_CODE',
            q'[ALTER TABLE "INIT$_TB_OML_MODEL_METRIC" MODIFY ("ACTUAL_CLASS_CODE" VARCHAR2(400 BYTE))]'
        );
        run_ddl(
            'MODIFY INIT$_TB_OML_MODEL_METRIC.PREDICTED_CLASS_CODE',
            q'[ALTER TABLE "INIT$_TB_OML_MODEL_METRIC" MODIFY ("PREDICTED_CLASS_CODE" VARCHAR2(400 BYTE))]'
        );
        run_ddl(
            'MODIFY INIT$_TB_OML_MODEL_METRIC.CLASS_GROUP_CODE',
            q'[ALTER TABLE "INIT$_TB_OML_MODEL_METRIC" MODIFY ("CLASS_GROUP_CODE" VARCHAR2(100 BYTE))]'
        );
    END IF;
    IF table_exists('INIT$_TB_OML_MODEL_METRIC') THEN
        drop_constraint_if_exists('CK_INIT$_TB_TYPE_MET_GROUP', 'INIT$_TB_OML_MODEL_METRIC');
        drop_constraint_if_exists('CK_INIT$_TB_TYPE_MET_ACTUAL', 'INIT$_TB_OML_MODEL_METRIC');
        drop_constraint_if_exists('CK_INIT$_TB_TYPE_MET_PRED', 'INIT$_TB_OML_MODEL_METRIC');
        drop_constraint_if_exists('UK_INIT$_TB_TYPE_MODEL_MET', 'INIT$_TB_OML_MODEL_METRIC');
        IF NOT constraint_exists('UK_INIT$_TB_TYPE_MODEL_MET') THEN
            run_ddl(
                'ADD UK_INIT$_TB_TYPE_MODEL_MET',
                q'[ALTER TABLE "INIT$_TB_OML_MODEL_METRIC" ADD CONSTRAINT "UK_INIT$_TB_TYPE_MODEL_MET" UNIQUE ("MODEL_VERSION_ID", "SPLIT_CODE", "ACTUAL_CLASS_CODE", "PREDICTED_CLASS_CODE", "CLASS_GROUP_CODE", "METRIC_NAME") ENABLE]'
            );
        END IF;
        run_ddl('COMMENT INIT$_TB_OML_MODEL_METRIC.ACTUAL_CLASS_CODE', q'[COMMENT ON COLUMN "INIT$_TB_OML_MODEL_METRIC"."ACTUAL_CLASS_CODE" IS 'Generic actual class code for any OML classification model']');
        run_ddl('COMMENT INIT$_TB_OML_MODEL_METRIC.PREDICTED_CLASS_CODE', q'[COMMENT ON COLUMN "INIT$_TB_OML_MODEL_METRIC"."PREDICTED_CLASS_CODE" IS 'Generic predicted class code for any OML classification model']');
        run_ddl('COMMENT INIT$_TB_OML_MODEL_METRIC.CLASS_GROUP_CODE', q'[COMMENT ON COLUMN "INIT$_TB_OML_MODEL_METRIC"."CLASS_GROUP_CODE" IS 'Optional domain-specific group for the actual class']');
    END IF;

    create_table_if_missing('INIT$_TB_OML_ACTIVE_MODEL', q'[
CREATE TABLE "INIT$_TB_OML_ACTIVE_MODEL" (
    "MODEL_KEY" VARCHAR2(100 BYTE) NOT NULL ENABLE,
    "MODEL_VERSION_ID" NUMBER NOT NULL ENABLE,
    "PREVIOUS_MODEL_VERSION_ID" NUMBER,
    "UPDATED_BY" VARCHAR2(128 BYTE),
    "UPDATED_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    CONSTRAINT "PK_INIT$_TB_OML_ACTIVE_MODEL" PRIMARY KEY ("MODEL_KEY")
)]');

    create_table_if_missing('INIT$_TB_OML_MODEL_DEPLOY_HIST', q'[
CREATE TABLE "INIT$_TB_OML_MODEL_DEPLOY_HIST" (
    "DEPLOY_HISTORY_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "MODEL_KEY" VARCHAR2(100 BYTE) NOT NULL ENABLE,
    "MODEL_VERSION_ID" NUMBER NOT NULL ENABLE,
    "PREVIOUS_MODEL_VERSION_ID" NUMBER,
    "ACTION_CODE" VARCHAR2(20 BYTE) NOT NULL ENABLE,
    "ACTION_BY" VARCHAR2(128 BYTE),
    "ACTION_AT" TIMESTAMP (6) DEFAULT SYSTIMESTAMP NOT NULL ENABLE,
    CONSTRAINT "PK_INIT$_TB_OML_MODEL_DEPLOY_HIST" PRIMARY KEY ("DEPLOY_HISTORY_ID"),
    CONSTRAINT "CK_INIT$_TB_TYPE_DEPLOY_ACT" CHECK ("ACTION_CODE" IN ('ACTIVATE', 'ROLLBACK', 'ARCHIVE')) ENABLE
)]');

    IF table_exists('INIT$_TB_COLTYPE_LABEL') THEN
        IF NOT constraint_exists('CK_INIT$_TB_COL_LABEL_TYPE') THEN
            run_ddl('ADD CK_INIT$_TB_COL_LABEL_TYPE', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL" ADD CONSTRAINT "CK_INIT$_TB_COL_LABEL_TYPE" CHECK ("TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_COL_LABEL_SCORE') THEN
            run_ddl('ADD CK_INIT$_TB_COL_LABEL_SCORE', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL" ADD CONSTRAINT "CK_INIT$_TB_COL_LABEL_SCORE" CHECK ("LABEL_CONFIDENCE" IS NULL OR "LABEL_CONFIDENCE" BETWEEN 0 AND 1) ENABLE]');
        END IF;
    END IF;

    IF table_exists('INIT$_TB_COLTYPE_LABEL_HIST') THEN
        IF NOT constraint_exists('CK_INIT$_TB_COL_HIST_SRC') THEN
            run_ddl('ADD CK_INIT$_TB_COL_HIST_SRC', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL_HIST" ADD CONSTRAINT "CK_INIT$_TB_COL_HIST_SRC" CHECK ("LABEL_SOURCE" IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH', 'USER_CONFIRMED', 'IMPORTED_GOLD', 'LEGACY_UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_COL_HIST_CONF') THEN
            run_ddl('ADD CK_INIT$_TB_COL_HIST_CONF', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL_HIST" ADD CONSTRAINT "CK_INIT$_TB_COL_HIST_CONF" CHECK ("CONFIRMED_YN" IN ('Y', 'N')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_COL_HIST_PGRP') THEN
            run_ddl('ADD CK_INIT$_TB_COL_HIST_PGRP', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL_HIST" ADD CONSTRAINT "CK_INIT$_TB_COL_HIST_PGRP" CHECK ("PREVIOUS_GROUP_CODE" IS NULL OR "PREVIOUS_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_COL_HIST_NGRP') THEN
            run_ddl('ADD CK_INIT$_TB_COL_HIST_NGRP', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL_HIST" ADD CONSTRAINT "CK_INIT$_TB_COL_HIST_NGRP" CHECK ("NEW_GROUP_CODE" IS NULL OR "NEW_GROUP_CODE" IN ('CATEGORICAL', 'CONTINUOUS', 'OTHER')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_COL_HIST_PREV') THEN
            run_ddl('ADD CK_INIT$_TB_COL_HIST_PREV', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL_HIST" ADD CONSTRAINT "CK_INIT$_TB_COL_HIST_PREV" CHECK ("PREVIOUS_TYPE_CODE" IS NULL OR "PREVIOUS_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_COL_HIST_NEW') THEN
            run_ddl('ADD CK_INIT$_TB_COL_HIST_NEW', q'[ALTER TABLE "INIT$_TB_COLTYPE_LABEL_HIST" ADD CONSTRAINT "CK_INIT$_TB_COL_HIST_NEW" CHECK ("NEW_TYPE_CODE" IS NULL OR "NEW_TYPE_CODE" IN ('NUM_IDENTIFIER', 'CHAR_IDENTIFIER', 'NUM_CONTINUOUS', 'NUM_DISCRETE', 'CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC', 'FREE_TEXT', 'OTHER', 'UNKNOWN')) ENABLE]');
        END IF;
    END IF;

    IF table_exists('INIT$_TB_OML_MODEL_REGISTRY') THEN
        IF NOT constraint_exists('CK_INIT$_TB_TYPE_REG_ACC') THEN
            run_ddl('ADD CK_INIT$_TB_TYPE_REG_ACC', q'[ALTER TABLE "INIT$_TB_OML_MODEL_REGISTRY" ADD CONSTRAINT "CK_INIT$_TB_TYPE_REG_ACC" CHECK ("ACCURACY" IS NULL OR "ACCURACY" BETWEEN 0 AND 1) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_TYPE_REG_BAL') THEN
            run_ddl('ADD CK_INIT$_TB_TYPE_REG_BAL', q'[ALTER TABLE "INIT$_TB_OML_MODEL_REGISTRY" ADD CONSTRAINT "CK_INIT$_TB_TYPE_REG_BAL" CHECK ("BALANCED_ACCURACY" IS NULL OR "BALANCED_ACCURACY" BETWEEN 0 AND 1) ENABLE]');
        END IF;
        IF NOT constraint_exists('CK_INIT$_TB_TYPE_REG_F1') THEN
            run_ddl('ADD CK_INIT$_TB_TYPE_REG_F1', q'[ALTER TABLE "INIT$_TB_OML_MODEL_REGISTRY" ADD CONSTRAINT "CK_INIT$_TB_TYPE_REG_F1" CHECK ("MACRO_F1" IS NULL OR "MACRO_F1" BETWEEN 0 AND 1) ENABLE]');
        END IF;
    END IF;

    create_index_if_missing('IX_INIT$_TB_COLTYPE_PROFILE_01', 'INIT$_TB_COLTYPE_PROFILE', q'[
CREATE INDEX "IX_INIT$_TB_COLTYPE_PROFILE_01"
    ON "INIT$_TB_COLTYPE_PROFILE" ("OWNER", "TABLE_NAME", "COLUMN_NAME", "CREATED_AT")
]');

    create_index_if_missing('IX_INIT$_TB_COLTYPE_LABEL_01', 'INIT$_TB_COLTYPE_LABEL', q'[
CREATE INDEX "IX_INIT$_TB_COLTYPE_LABEL_01"
    ON "INIT$_TB_COLTYPE_LABEL" ("CONFIRMED_YN", "LABEL_SOURCE", "TYPE_CODE", "TYPE_GROUP_CODE")
]');

    create_index_if_missing('IX_INIT$_TB_OML_MODEL_REGISTRY_01', 'INIT$_TB_OML_MODEL_REGISTRY', q'[
CREATE INDEX "IX_INIT$_TB_OML_MODEL_REGISTRY_01"
    ON "INIT$_TB_OML_MODEL_REGISTRY" ("MODEL_KEY", "STATUS_CODE", "VERSION_NO")
]');

    create_index_if_missing('IX_INIT$_TB_OML_TRAIN_RUN_01', 'INIT$_TB_OML_TRAIN_RUN', q'[
CREATE INDEX "IX_INIT$_TB_OML_TRAIN_RUN_01"
    ON "INIT$_TB_OML_TRAIN_RUN" ("MODEL_KEY", "STATUS_CODE", "REQUESTED_AT")
]');

    IF table_exists('INIT$_TB_COLREL_CAT_PAIR') THEN
        run_ddl('COMMENT INIT$_TB_COLREL_CAT_PAIR.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_CAT_PAIR"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_COLREL_CAT_PAIR.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_CAT_PAIR"."RUN_ID" IS 'DATA_WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');

        drop_primary_key_if_exists('INIT$_TB_COLREL_CAT_PAIR');
        IF NOT primary_key_exists('INIT$_TB_COLREL_CAT_PAIR') THEN
            run_ddl(
                'ADD PK_INIT$_TB_COLREL_CAT_PAIR',
                q'[ALTER TABLE "INIT$_TB_COLREL_CAT_PAIR" ADD CONSTRAINT "PK_INIT$_TB_COLREL_CAT_PAIR" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COL_A", "COL_B") ENABLE]'
            );
        END IF;

        drop_index_if_exists('IX_INIT$_TB_COLREL_CAT_PAIR_01');
    END IF;

    IF table_exists('INIT$_TB_COLREL_CAT_SUMMARY') THEN
        run_ddl('COMMENT INIT$_TB_COLREL_CAT_SUMMARY.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_CAT_SUMMARY"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_COLREL_CAT_SUMMARY.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_CAT_SUMMARY"."RUN_ID" IS 'DATA_WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');

        drop_primary_key_if_exists('INIT$_TB_COLREL_CAT_SUMMARY');
        IF NOT primary_key_exists('INIT$_TB_COLREL_CAT_SUMMARY') THEN
            run_ddl(
                'ADD PK_INIT$_TB_COLREL_CAT_SUMMARY',
                q'[ALTER TABLE "INIT$_TB_COLREL_CAT_SUMMARY" ADD CONSTRAINT "PK_INIT$_TB_COLREL_CAT_SUMMARY" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME") ENABLE]'
            );
        END IF;

        drop_index_if_exists('IX_INIT$_TB_COLREL_CAT_SUMMARY_01');
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

    IF table_exists('INIT$_TB_RULEDISC_ASSOC_SUM') THEN
        IF column_exists('INIT$_TB_RULEDISC_ASSOC_SUM', 'TARGET_OWNER') AND column_exists('INIT$_TB_RULEDISC_ASSOC_SUM', 'TARGET_TABLE') THEN
            run_ddl(
                'NORMALIZE INIT$_TB_RULEDISC_ASSOC_SUM TARGET SCOPE',
                q'[UPDATE "INIT$_TB_RULEDISC_ASSOC_SUM"
                      SET "TARGET_OWNER" = NVL(NULLIF(TRIM("TARGET_OWNER"), ''), 'UNKNOWN'),
                          "TARGET_TABLE" = NVL(NULLIF(TRIM("TARGET_TABLE"), ''), 'UNKNOWN')
                    WHERE "TARGET_OWNER" IS NULL
                       OR "TARGET_TABLE" IS NULL
                       OR TRIM("TARGET_OWNER") IS NULL
                       OR TRIM("TARGET_TABLE") IS NULL]'
            );

            modify_column_default_not_null('INIT$_TB_RULEDISC_ASSOC_SUM', 'TARGET_OWNER', q'['UNKNOWN']');
            modify_column_default_not_null('INIT$_TB_RULEDISC_ASSOC_SUM', 'TARGET_TABLE', q'['UNKNOWN']');

            drop_primary_key_if_exists('INIT$_TB_RULEDISC_ASSOC_SUM');
            IF NOT primary_key_exists('INIT$_TB_RULEDISC_ASSOC_SUM') THEN
                run_ddl(
                    'ADD PK_INIT$_TB_RULEDISC_ASSOC_SUM',
                    q'[ALTER TABLE "INIT$_TB_RULEDISC_ASSOC_SUM" ADD CONSTRAINT "PK_INIT$_TB_RULEDISC_ASSOC_SUM" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "RULE_ID") ENABLE]'
                );
            END IF;

            drop_index_if_exists('IX_INIT$_TB_RULEDISC_ASSOC_SUM_01');
            drop_index_if_exists('IX_INIT$_TB_RULEDISC_ASSOC_SUM_02');
            drop_index_if_exists('IX_INIT$_TB_RULEDISC_ASSOC_SUM_03');
        END IF;

        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM', q'[COMMENT ON TABLE "INIT$_TB_RULEDISC_ASSOC_SUM" IS 'Association model rule summary for fast drill-down analysis']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."RUN_ID" IS 'DATA_WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.TARGET_OWNER', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."TARGET_OWNER" IS 'Target table owner used to calculate this rule summary']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.TARGET_TABLE', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."TARGET_TABLE" IS 'Target table used to calculate this rule summary']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.MODEL_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."MODEL_TYPE" IS 'Human-readable rule model type such as Apriori or Decision Tree']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.RULE_SOURCE', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."RULE_SOURCE" IS 'Rule summary source such as conditional frequency']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.CONDITION_COLUMN', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."CONDITION_COLUMN" IS 'Condition column name for conditional probability rules']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.CONDITION_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."CONDITION_VALUE" IS 'Condition column value for conditional probability rules']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.SUPPORT_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."SUPPORT_COUNT" IS 'Rows matching both condition and result']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.CONDITION_TOTAL_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."CONDITION_TOTAL_COUNT" IS 'Rows matching the condition']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.RESULT_TOTAL_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."RESULT_TOTAL_COUNT" IS 'Rows matching the result']');
        run_ddl('COMMENT INIT$_TB_RULEDISC_ASSOC_SUM.TOTAL_COUNT', q'[COMMENT ON COLUMN "INIT$_TB_RULEDISC_ASSOC_SUM"."TOTAL_COUNT" IS 'Total rows used for rule probability calculation']');
    END IF;

    create_index_if_missing('IX_INIT$_TB_RULEDISC_ASSOC_SUM_01', 'INIT$_TB_RULEDISC_ASSOC_SUM', q'[
CREATE INDEX "IX_INIT$_TB_RULEDISC_ASSOC_SUM_01"
    ON "INIT$_TB_RULEDISC_ASSOC_SUM" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "CONDITION_COUNT", "RULE_CONFIDENCE", "RULE_LIFT", "RULE_SUPPORT")
]');

    create_index_if_missing('IX_INIT$_TB_RULEDISC_ASSOC_SUM_02', 'INIT$_TB_RULEDISC_ASSOC_SUM', q'[
CREATE INDEX "IX_INIT$_TB_RULEDISC_ASSOC_SUM_02"
    ON "INIT$_TB_RULEDISC_ASSOC_SUM" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "RESULT_COLUMN", "RESULT_HAS_VALUE_YN")
]');

    create_index_if_missing('IX_INIT$_TB_RULEDISC_ASSOC_SUM_03', 'INIT$_TB_RULEDISC_ASSOC_SUM', q'[
CREATE INDEX "IX_INIT$_TB_RULEDISC_ASSOC_SUM_03"
    ON "INIT$_TB_RULEDISC_ASSOC_SUM" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "MODEL_TYPE", "RULE_SOURCE")
]');

    create_index_if_missing('IX_INIT$_TB_COLTYPE_RESULT_01', 'INIT$_TB_COLTYPE_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_COLTYPE_RESULT_01"
    ON "INIT$_TB_COLTYPE_RESULT" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "MODEL_NAME", "COLUMN_ID")
]');

    create_index_if_missing('IX_INIT$_TB_COLTYPE_RESULT_02', 'INIT$_TB_COLTYPE_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_COLTYPE_RESULT_02"
    ON "INIT$_TB_COLTYPE_RESULT" ("OWNER", "TABLE_NAME", "COLUMN_NAME", "CREATE_DT", "RUN_ID")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_CAT_PAIR_01', 'INIT$_TB_COLREL_CAT_PAIR', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_CAT_PAIR_01"
    ON "INIT$_TB_COLREL_CAT_PAIR" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "PASS_YN", "CRAMERS_V")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_CAT_SUMMARY_01', 'INIT$_TB_COLREL_CAT_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_CAT_SUMMARY_01"
    ON "INIT$_TB_COLREL_CAT_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "SELECTED_YN", "RANK_NO")
]');

    create_index_if_missing('IX_INIT$_TB_DATA_WORK_RUN_02', 'INIT$_TB_DATA_WORK_RUN', q'[
CREATE INDEX "IX_INIT$_TB_DATA_WORK_RUN_02"
    ON "INIT$_TB_DATA_WORK_RUN" ("DATA_RUN_ID", "CREATED_AT", "STATUS")
]');

    create_table_if_missing('INIT$_TB_COLREL_NUM_PAIR', q'[
CREATE TABLE "INIT$_TB_COLREL_NUM_PAIR" (
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
    CONSTRAINT "CK_INIT$_TB_COLREL_NUM_PAIR_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COLREL_NUM_PAIR_PASS" CHECK ("PASS_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLREL_NUM_PAIR" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COL_A", "COL_B")
)]');

    create_table_if_missing('INIT$_TB_COLREL_NUM_SUMMARY', q'[
CREATE TABLE "INIT$_TB_COLREL_NUM_SUMMARY" (
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
    CONSTRAINT "PK_INIT$_TB_COLREL_NUM_SUMMARY" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME")
)]');

    create_table_if_missing('INIT$_TB_COLREL_PAIR', q'[
CREATE TABLE "INIT$_TB_COLREL_PAIR" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_A" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_B" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_A_TYPE" VARCHAR2(30 BYTE),
    "COL_B_TYPE" VARCHAR2(30 BYTE),
    "RELATION_TYPE" VARCHAR2(50 BYTE) NOT NULL ENABLE,
    "METRIC_NAME" VARCHAR2(50 BYTE) NOT NULL ENABLE,
    "METRIC_VALUE" NUMBER,
    "ABS_METRIC_VALUE" NUMBER,
    "P_VALUE" NUMBER,
    "ROW_COUNT" NUMBER,
    "DF" NUMBER,
    "EXTRA_JSON" CLOB,
    "PASS_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "CLUSTER_ID" NUMBER,
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_PAIR_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_PAIR_PASS" CHECK ("PASS_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLREL_PAIR" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COL_A", "COL_B", "METRIC_NAME")
)]');

    IF table_exists('INIT$_TB_COLREL_PAIR') THEN
        run_ddl('COMMENT INIT$_TB_COLREL_PAIR', q'[COMMENT ON TABLE "INIT$_TB_COLREL_PAIR" IS 'Unified variable relation matrix result']');
        run_ddl('COMMENT INIT$_TB_COLREL_PAIR.RELATION_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_PAIR"."RELATION_TYPE" IS 'NUMERIC_NUMERIC, CATEGORICAL_CATEGORICAL, or CATEGORICAL_NUMERIC']');
        run_ddl('COMMENT INIT$_TB_COLREL_PAIR.METRIC_NAME', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_PAIR"."METRIC_NAME" IS 'Relation metric such as PEARSON_R, SPEARMAN_R, CRAMERS_V, or ETA_SQUARED']');
        run_ddl('COMMENT INIT$_TB_COLREL_PAIR.ABS_METRIC_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_PAIR"."ABS_METRIC_VALUE" IS 'Absolute relation strength used for ranking and network edges']');
        run_ddl('COMMENT INIT$_TB_COLREL_PAIR.EXTRA_JSON', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_PAIR"."EXTRA_JSON" IS 'Optional metric-specific JSON metadata']');
    END IF;

    create_table_if_missing('INIT$_TB_COLREL_SUMMARY', q'[
CREATE TABLE "INIT$_TB_COLREL_SUMMARY" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_TYPE" VARCHAR2(30 BYTE),
    "PAIR_COUNT" NUMBER,
    "PASS_PAIR_COUNT" NUMBER,
    "AVG_ABS_METRIC_VALUE" NUMBER,
    "MAX_ABS_METRIC_VALUE" NUMBER,
    "RANK_NO" NUMBER,
    "SELECTED_YN" CHAR(1 BYTE) DEFAULT 'N' NOT NULL ENABLE,
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_SUM_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_SUM_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLREL_SUMMARY" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME")
)]');

    IF table_exists('INIT$_TB_COLREL_SUMMARY') THEN
        run_ddl('COMMENT INIT$_TB_COLREL_SUMMARY', q'[COMMENT ON TABLE "INIT$_TB_COLREL_SUMMARY" IS 'Unified relation summary by variable']');
        run_ddl('COMMENT INIT$_TB_COLREL_SUMMARY.COLUMN_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_SUMMARY"."COLUMN_TYPE" IS 'Final logical type used by relation analysis']');
        run_ddl('COMMENT INIT$_TB_COLREL_SUMMARY.SELECTED_YN', q'[COMMENT ON COLUMN "INIT$_TB_COLREL_SUMMARY"."SELECTED_YN" IS 'Relation strength threshold pass Y/N']');
    END IF;

    create_table_if_missing('INIT$_TB_COLREL_NETWORK_NODE', q'[
CREATE TABLE "INIT$_TB_COLREL_NETWORK_NODE" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COLUMN_TYPE" VARCHAR2(30 BYTE),
    "CLUSTER_ID" NUMBER,
    "DEGREE_COUNT" NUMBER,
    "WEIGHTED_DEGREE" NUMBER,
    "CENTRALITY_SCORE" NUMBER,
    "SELECTED_YN" CHAR(1 BYTE) DEFAULT 'Y' NOT NULL ENABLE,
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_NODE_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_NODE_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLREL_NETWORK_NODE" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME")
)]');

    IF table_exists('INIT$_TB_COLREL_NETWORK_NODE') THEN
        run_ddl('COMMENT INIT$_TB_COLREL_NETWORK_NODE', q'[COMMENT ON TABLE "INIT$_TB_COLREL_NETWORK_NODE" IS 'Variable relation network node and community result']');
    END IF;

    create_table_if_missing('INIT$_TB_COLREL_NETWORK_EDGE', q'[
CREATE TABLE "INIT$_TB_COLREL_NETWORK_EDGE" (
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TABLE_NAME" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_A" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "COL_B" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RELATION_TYPE" VARCHAR2(50 BYTE) NOT NULL ENABLE,
    "METRIC_NAME" VARCHAR2(50 BYTE) NOT NULL ENABLE,
    "METRIC_VALUE" NUMBER,
    "ABS_METRIC_VALUE" NUMBER,
    "CLUSTER_ID" NUMBER,
    "PASS_YN" CHAR(1 BYTE) DEFAULT 'Y' NOT NULL ENABLE,
    "CREATE_DT" DATE DEFAULT SYSDATE NOT NULL ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_EDGE_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_REL_EDGE_PASS" CHECK ("PASS_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLREL_NETWORK_EDGE" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COL_A", "COL_B", "METRIC_NAME")
)]');

    IF table_exists('INIT$_TB_COLREL_NETWORK_EDGE') THEN
        run_ddl('COMMENT INIT$_TB_COLREL_NETWORK_EDGE', q'[COMMENT ON TABLE "INIT$_TB_COLREL_NETWORK_EDGE" IS 'Variable relation network edge result for visualization']');
    END IF;

    create_table_if_missing('INIT$_TB_COLREL_LASSO_FEATURE', q'[
CREATE TABLE "INIT$_TB_COLREL_LASSO_FEATURE" (
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
    CONSTRAINT "CK_INIT$_TB_COLREL_LASSO_FEATURE_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_COLREL_LASSO_FEATURE_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_COLREL_LASSO_FEATURE" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "FEATURE_NAME")
)]');

    create_table_if_missing('INIT$_TB_RULEDISC_SYMBOLIC', q'[
CREATE TABLE "INIT$_TB_RULEDISC_SYMBOLIC" (
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
    CONSTRAINT "CK_INIT$_TB_RULEDISC_SYMBOLIC_RUN" CHECK ("RUN_SOURCE_TYPE" IN ('DATA_WORK', 'FLOW_WORK')) ENABLE,
    CONSTRAINT "CK_INIT$_TB_RULEDISC_SYMBOLIC_SEL" CHECK ("SELECTED_YN" IN ('Y', 'N')) ENABLE,
    CONSTRAINT "PK_INIT$_TB_RULEDISC_SYMBOLIC" PRIMARY KEY ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "RULE_ID")
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

    create_index_if_missing('IX_INIT$_TB_COLREL_NUM_PAIR_01', 'INIT$_TB_COLREL_NUM_PAIR', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_NUM_PAIR_01"
    ON "INIT$_TB_COLREL_NUM_PAIR" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "PASS_YN", "ABS_PEARSON_R")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_NUM_SUMMARY_01', 'INIT$_TB_COLREL_NUM_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_NUM_SUMMARY_01"
    ON "INIT$_TB_COLREL_NUM_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "SELECTED_YN", "RANK_NO")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_PAIR_01', 'INIT$_TB_COLREL_PAIR', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_PAIR_01"
    ON "INIT$_TB_COLREL_PAIR" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "PASS_YN", "ABS_METRIC_VALUE")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_PAIR_02', 'INIT$_TB_COLREL_PAIR', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_PAIR_02"
    ON "INIT$_TB_COLREL_PAIR" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "RELATION_TYPE", "METRIC_NAME")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_SUMMARY_01', 'INIT$_TB_COLREL_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_SUMMARY_01"
    ON "INIT$_TB_COLREL_SUMMARY" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "SELECTED_YN", "RANK_NO")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_NETWORK_NODE_01', 'INIT$_TB_COLREL_NETWORK_NODE', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_NETWORK_NODE_01"
    ON "INIT$_TB_COLREL_NETWORK_NODE" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "CLUSTER_ID", "CENTRALITY_SCORE")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_NETWORK_EDGE_01', 'INIT$_TB_COLREL_NETWORK_EDGE', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_NETWORK_EDGE_01"
    ON "INIT$_TB_COLREL_NETWORK_EDGE" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "CLUSTER_ID", "ABS_METRIC_VALUE")
]');

    create_index_if_missing('IX_INIT$_TB_COLREL_LASSO_FEATURE_01', 'INIT$_TB_COLREL_LASSO_FEATURE', q'[
CREATE INDEX "IX_INIT$_TB_COLREL_LASSO_FEATURE_01"
    ON "INIT$_TB_COLREL_LASSO_FEATURE" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "SELECTED_YN", "RANK_NO")
]');

    create_index_if_missing('IX_INIT$_TB_RULEDISC_SYMBOLIC_01', 'INIT$_TB_RULEDISC_SYMBOLIC', q'[
CREATE INDEX "IX_INIT$_TB_RULEDISC_SYMBOLIC_01"
    ON "INIT$_TB_RULEDISC_SYMBOLIC" ("RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "TARGET_COLUMN", "SELECTED_YN", "RANK_NO")
]');

    create_table_if_missing('INIT$_TB_RULEVIOL_SYMBOLIC', q'[
CREATE TABLE "INIT$_TB_RULEVIOL_SYMBOLIC" (
    "VIOLATION_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
    "RUN_SOURCE_TYPE" VARCHAR2(30 BYTE) DEFAULT 'DATA_WORK' NOT NULL ENABLE,
    "RUN_ID" NUMBER DEFAULT 0 NOT NULL ENABLE,
    "TARGET_OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "TARGET_TABLE" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RULE_OWNER" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "RULE_TABLE" VARCHAR2(128 BYTE) DEFAULT 'INIT$_TB_RULEDISC_SYMBOLIC' NOT NULL ENABLE,
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
    CONSTRAINT "PK_INIT$_TB_RULEVIOL_SYMBOLIC" PRIMARY KEY ("VIOLATION_ID")
)]');

    IF table_exists('INIT$_TB_RULEVIOL_SYMBOLIC') THEN
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC', q'[COMMENT ON TABLE "INIT$_TB_RULEVIOL_SYMBOLIC" IS 'Rows outside the accepted error range of symbolic regression rules']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."RUN_ID" IS 'DATA_WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.RULE_ID', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."RULE_ID" IS 'Symbolic rule ID']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.TARGET_COLUMN', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."TARGET_COLUMN" IS 'Dependent variable checked by the symbolic expression']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.PREDICTED_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."PREDICTED_VALUE" IS 'Expected value calculated by the symbolic expression']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.ACTUAL_VALUE', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."ACTUAL_VALUE" IS 'Actual target row value']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.ERROR_PCT', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."ERROR_PCT" IS 'Absolute error divided by expected value']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_SYMBOLIC.TOLERANCE_PCT', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_SYMBOLIC"."TOLERANCE_PCT" IS 'Accepted relative error range such as 0.05 for plus/minus 5 percent']');
    END IF;

    create_index_if_missing('IX_INIT$_TB_RULEVIOL_SYMBOLIC_01', 'INIT$_TB_RULEVIOL_SYMBOLIC', q'[
CREATE INDEX "IX_INIT$_TB_RULEVIOL_SYMBOLIC_01"
    ON "INIT$_TB_RULEVIOL_SYMBOLIC" ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "TARGET_COLUMN", "VIOLATION_SCORE")
]');

    create_index_if_missing('IX_INIT$_TB_RULEVIOL_SYMBOLIC_02', 'INIT$_TB_RULEVIOL_SYMBOLIC', q'[
CREATE INDEX "IX_INIT$_TB_RULEVIOL_SYMBOLIC_02"
    ON "INIT$_TB_RULEVIOL_SYMBOLIC" ("RUN_SOURCE_TYPE", "RUN_ID", "RULE_OWNER", "RULE_TABLE", "RULE_ID")
]');

    create_index_if_missing('IX_INIT$_TB_API_RESULT_01', 'INIT$_TB_API_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_API_RESULT_01"
    ON "INIT$_TB_API_RESULT" ("RUN_SOURCE_TYPE", "RUN_ID", "API_OBJECT_NAME", "CREATE_DT")
]');

    create_table_if_missing('INIT$_TB_RULEVIOL_ASSOC', q'[
CREATE TABLE "INIT$_TB_RULEVIOL_ASSOC" (
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
    CONSTRAINT "PK_INIT$_TB_RULEVIOL_ASSOC" PRIMARY KEY ("VIOLATION_ID")
)]');

    IF table_exists('INIT$_TB_RULEVIOL_ASSOC') THEN
        run_ddl('COMMENT INIT$_TB_RULEVIOL_ASSOC', q'[COMMENT ON TABLE "INIT$_TB_RULEVIOL_ASSOC" IS 'Rows that violate discovered human-readable rules']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_ASSOC.RUN_SOURCE_TYPE', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_ASSOC"."RUN_SOURCE_TYPE" IS 'Run source type: DATA_WORK or FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_ASSOC.RUN_ID', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_ASSOC"."RUN_ID" IS 'DATA_WORK_RUN_ID for DATA_WORK or FLOW_RUN_ID for FLOW_WORK']');
        run_ddl('COMMENT INIT$_TB_RULEVIOL_ASSOC.VIOLATION_SCORE', q'[COMMENT ON COLUMN "INIT$_TB_RULEVIOL_ASSOC"."VIOLATION_SCORE" IS 'Rule confidence/lift based priority score']');

        drop_index_if_exists('IX_INIT$_TB_RULEVIOL_ASSOC_01');
        drop_index_if_exists('IX_INIT$_TB_RULEVIOL_ASSOC_02');
        drop_index_if_exists('IX_INIT$_TB_RULEVIOL_ASSOC_03');
    END IF;

    create_index_if_missing('IX_INIT$_TB_RULEVIOL_ASSOC_01', 'INIT$_TB_RULEVIOL_ASSOC', q'[
CREATE INDEX "IX_INIT$_TB_RULEVIOL_ASSOC_01"
    ON "INIT$_TB_RULEVIOL_ASSOC" ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "VIOLATION_SCORE")
]');

    create_index_if_missing('IX_INIT$_TB_RULEVIOL_ASSOC_02', 'INIT$_TB_RULEVIOL_ASSOC', q'[
CREATE INDEX "IX_INIT$_TB_RULEVIOL_ASSOC_02"
    ON "INIT$_TB_RULEVIOL_ASSOC" ("RUN_SOURCE_TYPE", "RUN_ID", "RULE_OWNER", "MODEL_NAME", "RULE_ID")
]');

    create_index_if_missing('IX_INIT$_TB_RULEVIOL_ASSOC_03', 'INIT$_TB_RULEVIOL_ASSOC', q'[
CREATE INDEX "IX_INIT$_TB_RULEVIOL_ASSOC_03"
    ON "INIT$_TB_RULEVIOL_ASSOC" ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "CASE_ID")
]');

    IF table_exists('INIT$_TB_FLOW_WORK_NODE') THEN
        run_ddl('COMMENT INIT$_TB_FLOW_WORK_NODE.USE_YN', q'[COMMENT ON COLUMN "INIT$_TB_FLOW_WORK_NODE"."USE_YN" IS 'Node execution use Y/N. N keeps graph links but skips the node during execution']');
    END IF;

    IF table_exists('INIT$_TB_FLOW_WORK_NODE_RUN')
       AND column_exists('INIT$_TB_FLOW_WORK_NODE_RUN', 'RUN_OUTPUT_JSON') THEN
        run_ddl('COMMENT INIT$_TB_FLOW_WORK_NODE_RUN.RUN_OUTPUT_JSON', q'[COMMENT ON COLUMN "INIT$_TB_FLOW_WORK_NODE_RUN"."RUN_OUTPUT_JSON" IS 'Resolved model/table output lineage captured after node execution']');
    END IF;

    reorder_assoc_rule_summary_columns;
    reorder_predicted_type_columns;
    reorder_predicted_type_final_columns;
    reorder_cat_corr_pair_columns;
    reorder_cat_corr_summary_columns;
    reorder_relation_pair_columns;
    reorder_relation_summary_columns;
    reorder_relation_network_node_columns;
    reorder_relation_network_edge_columns;
    reorder_rule_violation_result_columns;
    reorder_flow_work_node_run_columns;

    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET ALTER END ===');
END;
/

-- Column-type model training is owned exclusively by M90003 and
-- INIT$_SP_TYPE_MODEL_TRAIN. Remove the former per-job training procedure so
-- it cannot be registered again as an M03001/FLOW work item.
DECLARE
    v_count           NUMBER;
    v_table_count     NUMBER;
    v_reference_count NUMBER;
BEGIN
    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TABLES
     WHERE TABLE_NAME = 'INIT$_TB_DATA_WORK_JOB';

    IF v_table_count > 0 THEN
        EXECUTE IMMEDIATE q'~
UPDATE "INIT$_TB_DATA_WORK_JOB"
   SET "EXEC_PLSQL" = REGEXP_REPLACE(
           "EXEC_PLSQL",
           '[[:space:]]*,[[:space:]]*P_DYNAMIC_MODEL_NAME[[:space:]]*=>[[:space:]]*[^,)]*',
           ''
       )
     , "PARAM_JSON" = REGEXP_REPLACE(
           REGEXP_REPLACE(
               REGEXP_REPLACE(
                   "PARAM_JSON",
                   '[{][^{}]*"key"[[:space:]]*:[[:space:]]*"P_DYNAMIC_MODEL_NAME"[^{}]*[}][[:space:]]*,',
                   ''
               ),
               ',[[:space:]]*[{][^{}]*"key"[[:space:]]*:[[:space:]]*"P_DYNAMIC_MODEL_NAME"[^{}]*[}]',
               ''
           ),
           '[{][^{}]*"key"[[:space:]]*:[[:space:]]*"P_DYNAMIC_MODEL_NAME"[^{}]*[}]',
           ''
       )
     , "UPDATED_AT" = SYSTIMESTAMP
 WHERE "EXEC_OBJECT_NAME" = 'INIT$_SP_PREDICTED_TYPE'
   AND DBMS_LOB.INSTR("EXEC_PLSQL", 'P_DYNAMIC_MODEL_NAME') > 0
~';
        DBMS_OUTPUT.PUT_LINE('[OK] MIGRATE INIT$_SP_PREDICTED_TYPE jobs to active-model lookup');

        EXECUTE IMMEDIATE q'~
UPDATE "INIT$_TB_DATA_WORK_JOB"
   SET "USE_YN" = 'N'
     , "UPDATED_AT" = SYSTIMESTAMP
 WHERE "EXEC_OBJECT_NAME" = 'INIT$_SP_DECISION_TREE_RULE_MODEL'
~';
        DBMS_OUTPUT.PUT_LINE('[OK] DISABLE DEPRECATED INIT$_SP_DECISION_TREE_RULE_MODEL jobs');
        COMMIT;
    END IF;

    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TABLES
     WHERE TABLE_NAME IN ('INIT$_TB_DATA_WORK_JOB', 'INIT$_TB_FLOW_WORK_NODE');

    IF v_table_count = 2 THEN
        EXECUTE IMMEDIATE q'~
UPDATE "INIT$_TB_FLOW_WORK_NODE" N
   SET N."EXEC_PLSQL" = REGEXP_REPLACE(
           N."EXEC_PLSQL",
           '[[:space:]]*,[[:space:]]*P_DYNAMIC_MODEL_NAME[[:space:]]*=>[[:space:]]*[^,)]*',
           ''
       )
     , N."PARAM_JSON" = REGEXP_REPLACE(
           REGEXP_REPLACE(
               REGEXP_REPLACE(
                   N."PARAM_JSON",
                   '[{][^{}]*"key"[[:space:]]*:[[:space:]]*"P_DYNAMIC_MODEL_NAME"[^{}]*[}][[:space:]]*,',
                   ''
               ),
               ',[[:space:]]*[{][^{}]*"key"[[:space:]]*:[[:space:]]*"P_DYNAMIC_MODEL_NAME"[^{}]*[}]',
               ''
           ),
           '[{][^{}]*"key"[[:space:]]*:[[:space:]]*"P_DYNAMIC_MODEL_NAME"[^{}]*[}]',
           ''
       )
     , N."UPDATED_AT" = SYSTIMESTAMP
 WHERE DBMS_LOB.INSTR(N."EXEC_PLSQL", 'P_DYNAMIC_MODEL_NAME') > 0
   AND EXISTS (
       SELECT 1
         FROM "INIT$_TB_DATA_WORK_JOB" J
        WHERE J."WORK_JOB_ID" = N."REF_WORK_JOB_ID"
          AND J."EXEC_OBJECT_NAME" = 'INIT$_SP_PREDICTED_TYPE'
   )
~';
        DBMS_OUTPUT.PUT_LINE('[OK] MIGRATE FLOW INIT$_SP_PREDICTED_TYPE nodes to active-model lookup');

        EXECUTE IMMEDIATE q'~
UPDATE "INIT$_TB_FLOW_WORK_NODE" N
   SET N."USE_YN" = 'N'
     , N."UPDATED_AT" = SYSTIMESTAMP
 WHERE EXISTS (
       SELECT 1
         FROM "INIT$_TB_DATA_WORK_JOB" J
        WHERE J."WORK_JOB_ID" = N."REF_WORK_JOB_ID"
          AND J."EXEC_OBJECT_NAME" = 'INIT$_SP_DECISION_TREE_RULE_MODEL'
   )
~';
        DBMS_OUTPUT.PUT_LINE('[OK] DISABLE FLOW nodes that reference deprecated training jobs');
        COMMIT;
    END IF;

    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TABLES
     WHERE TABLE_NAME = 'INIT$_TB_OBJECT_DETAIL';

    IF v_table_count > 0 THEN
        DELETE FROM "INIT$_TB_OBJECT_DETAIL"
         WHERE "OBJECT_NAME" = 'INIT$_SP_PREDICTED_TYPE'
           AND "ITEM_NAME" = 'P_DYNAMIC_MODEL_NAME';

        DELETE FROM "INIT$_TB_OBJECT_DETAIL"
         WHERE "OBJECT_NAME" = 'INIT$_SP_DECISION_TREE_RULE_MODEL';

        DBMS_OUTPUT.PUT_LINE('[OK] REMOVE DEPRECATED model parameter/object details');
        COMMIT;
    END IF;

    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TABLES
     WHERE TABLE_NAME = 'INIT$_TB_OBJECT';

    IF v_table_count > 0 THEN
        DELETE FROM "INIT$_TB_OBJECT"
         WHERE "OBJECT_NAME" = 'INIT$_SP_DECISION_TREE_RULE_MODEL'
           AND "OBJECT_TYPE" = 'PROCEDURE';

        DBMS_OUTPUT.PUT_LINE('[OK] REMOVE DEPRECATED registered training object');
        COMMIT;
    END IF;

    SELECT COUNT(*)
      INTO v_count
      FROM USER_OBJECTS
     WHERE OBJECT_NAME = 'INIT$_SP_DECISION_TREE_RULE_MODEL'
       AND OBJECT_TYPE = 'PROCEDURE';

    IF v_count > 0 THEN
        EXECUTE IMMEDIATE 'DROP PROCEDURE "INIT$_SP_DECISION_TREE_RULE_MODEL"';
        DBMS_OUTPUT.PUT_LINE('[OK] DROP DEPRECATED PROCEDURE INIT$_SP_DECISION_TREE_RULE_MODEL');
    ELSE
        DBMS_OUTPUT.PUT_LINE('[SKIP] DEPRECATED PROCEDURE INIT$_SP_DECISION_TREE_RULE_MODEL is missing.');
    END IF;

    /*
       SP_ANALYZE_FEATURE_TYPES was an abandoned internal-model prototype.
       It is not part of the current INIT$_SP_PREDICTED_TYPE execution path.
       Retire it only when no saved DATA_WORK job still references it.
    */
    v_reference_count := 0;
    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TABLES
     WHERE TABLE_NAME = 'INIT$_TB_DATA_WORK_JOB';

    IF v_table_count > 0 THEN
        EXECUTE IMMEDIATE q'[
SELECT COUNT(*)
  FROM "INIT$_TB_DATA_WORK_JOB"
 WHERE "EXEC_OBJECT_NAME" IN ('SP_ANALYZE_FEATURE_TYPES', 'INIT$_SP_ANALYZE_FEATURE_TYPES')
]'
           INTO v_reference_count;
    END IF;

    IF v_reference_count > 0 THEN
        DBMS_OUTPUT.PUT_LINE('[SKIP] RETAIN deprecated SP_ANALYZE_FEATURE_TYPES because saved jobs still reference it: ' || v_reference_count);
    ELSE
        SELECT COUNT(*)
          INTO v_table_count
          FROM USER_TABLES
         WHERE TABLE_NAME = 'INIT$_TB_OBJECT_DETAIL';

        IF v_table_count > 0 THEN
            DELETE FROM "INIT$_TB_OBJECT_DETAIL"
             WHERE "OBJECT_NAME" IN ('SP_ANALYZE_FEATURE_TYPES', 'INIT$_SP_ANALYZE_FEATURE_TYPES');
        END IF;

        SELECT COUNT(*)
          INTO v_table_count
          FROM USER_TABLES
         WHERE TABLE_NAME = 'INIT$_TB_OBJECT';

        IF v_table_count > 0 THEN
            DELETE FROM "INIT$_TB_OBJECT"
             WHERE "OBJECT_NAME" IN ('SP_ANALYZE_FEATURE_TYPES', 'INIT$_SP_ANALYZE_FEATURE_TYPES')
               AND "OBJECT_TYPE" = 'PROCEDURE';
        END IF;

        SELECT COUNT(*)
          INTO v_count
          FROM USER_OBJECTS
         WHERE OBJECT_NAME = 'SP_ANALYZE_FEATURE_TYPES'
           AND OBJECT_TYPE = 'PROCEDURE';

        IF v_count > 0 THEN
            EXECUTE IMMEDIATE 'DROP PROCEDURE "SP_ANALYZE_FEATURE_TYPES"';
            DBMS_OUTPUT.PUT_LINE('[OK] DROP UNUSED PROCEDURE SP_ANALYZE_FEATURE_TYPES');
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] UNUSED PROCEDURE SP_ANALYZE_FEATURE_TYPES is missing.');
        END IF;

        SELECT COUNT(*)
          INTO v_count
          FROM USER_OBJECTS
         WHERE OBJECT_NAME = 'INIT$_SP_ANALYZE_FEATURE_TYPES'
           AND OBJECT_TYPE = 'PROCEDURE';

        IF v_count > 0 THEN
            EXECUTE IMMEDIATE 'DROP PROCEDURE "INIT$_SP_ANALYZE_FEATURE_TYPES"';
            DBMS_OUTPUT.PUT_LINE('[OK] DROP UNUSED PROCEDURE INIT$_SP_ANALYZE_FEATURE_TYPES');
        END IF;
        COMMIT;
    END IF;
END;
/
