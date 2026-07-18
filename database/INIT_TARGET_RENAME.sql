SET SERVEROUTPUT ON;

-- INIT_TARGET_RENAME
-- Purpose:
--   Rename existing target-schema tables, primary keys, and indexes without
--   copying or deleting data.
--
-- Existing schema deployment order:
--   1. Stop application traffic and scheduled/running analysis jobs.
--   2. Back up the target schema and record invalid objects.
--   3. Run this file before INIT_TARGET_DDL.sql or INIT_TARGET_ALTER.sql.
--   4. Run INIT_TARGET_ALTER.sql to migrate generic OML metric columns.
--   5. Recompile model objects, then deploy/restart the application.
--
-- Safety:
--   If both the old and new table names exist, this script stops immediately.
--   It never merges, drops, truncates, or overwrites either table.
--   Constraint/index renames are idempotent and can be rerun after a previous
--   table-only migration or a partially completed INIT_TARGET_ALTER.sql run.

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

    FUNCTION column_exists(
        p_table_name IN VARCHAR2,
        p_column_name IN VARCHAR2
    ) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND COLUMN_NAME = UPPER(p_column_name);

        RETURN v_count > 0;
    END;

    FUNCTION constraint_exists(
        p_table_name IN VARCHAR2,
        p_constraint_name IN VARCHAR2
    ) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_CONSTRAINTS
         WHERE TABLE_NAME = UPPER(p_table_name)
           AND CONSTRAINT_NAME = UPPER(p_constraint_name);

        RETURN v_count > 0;
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

    PROCEDURE assert_no_collision(
        p_old_table_name IN VARCHAR2,
        p_new_table_name IN VARCHAR2
    ) IS
    BEGIN
        IF table_exists(p_old_table_name) AND table_exists(p_new_table_name) THEN
            RAISE_APPLICATION_ERROR(
                -20001,
                'Migration collision: both ' || UPPER(p_old_table_name)
                    || ' and ' || UPPER(p_new_table_name) || ' exist.'
            );
        END IF;
    END;

    PROCEDURE rename_table_if_needed(
        p_old_table_name IN VARCHAR2,
        p_new_table_name IN VARCHAR2
    ) IS
        v_old_exists BOOLEAN;
        v_new_exists BOOLEAN;
    BEGIN
        v_old_exists := table_exists(p_old_table_name);
        v_new_exists := table_exists(p_new_table_name);

        IF v_old_exists AND v_new_exists THEN
            RAISE_APPLICATION_ERROR(
                -20001,
                'Migration collision: both ' || UPPER(p_old_table_name)
                    || ' and ' || UPPER(p_new_table_name) || ' exist.'
            );
        ELSIF v_old_exists THEN
            EXECUTE IMMEDIATE
                'RENAME "' || UPPER(p_old_table_name) || '" TO "' || UPPER(p_new_table_name) || '"';
            DBMS_OUTPUT.PUT_LINE(
                '[RENAMED] ' || UPPER(p_old_table_name) || ' -> ' || UPPER(p_new_table_name)
            );
        ELSIF v_new_exists THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] ' || UPPER(p_new_table_name) || ' already exists.');
        ELSE
            DBMS_OUTPUT.PUT_LINE(
                '[SKIP] Neither ' || UPPER(p_old_table_name)
                    || ' nor ' || UPPER(p_new_table_name) || ' exists.'
            );
        END IF;
    END;

    PROCEDURE rename_constraint_if_needed(
        p_table_name IN VARCHAR2,
        p_old_constraint_name IN VARCHAR2,
        p_new_constraint_name IN VARCHAR2
    ) IS
    BEGIN
        IF NOT table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || UPPER(p_table_name) || ' does not exist.');
        ELSIF constraint_exists(p_table_name, p_new_constraint_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] CONSTRAINT ' || UPPER(p_new_constraint_name) || ' already exists.');
        ELSIF constraint_exists(p_table_name, p_old_constraint_name) THEN
            EXECUTE IMMEDIATE
                'ALTER TABLE "' || UPPER(p_table_name) || '" RENAME CONSTRAINT "'
                    || UPPER(p_old_constraint_name) || '" TO "' || UPPER(p_new_constraint_name) || '"';
            DBMS_OUTPUT.PUT_LINE(
                '[RENAMED] CONSTRAINT ' || UPPER(p_old_constraint_name)
                    || ' -> ' || UPPER(p_new_constraint_name)
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE(
                '[SKIP] CONSTRAINT ' || UPPER(p_old_constraint_name)
                    || ' does not exist on ' || UPPER(p_table_name) || '.'
            );
        END IF;
    END;

    PROCEDURE rename_index_if_needed(
        p_old_index_name IN VARCHAR2,
        p_new_index_name IN VARCHAR2
    ) IS
    BEGIN
        IF index_exists(p_new_index_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || UPPER(p_new_index_name) || ' already exists.');
        ELSIF index_exists(p_old_index_name) THEN
            EXECUTE IMMEDIATE
                'ALTER INDEX "' || UPPER(p_old_index_name) || '" RENAME TO "'
                    || UPPER(p_new_index_name) || '"';
            DBMS_OUTPUT.PUT_LINE(
                '[RENAMED] INDEX ' || UPPER(p_old_index_name)
                    || ' -> ' || UPPER(p_new_index_name)
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || UPPER(p_old_index_name) || ' does not exist.');
        END IF;
    END;

    PROCEDURE rename_primary_key_objects_if_needed(
        p_table_name IN VARCHAR2,
        p_old_object_name IN VARCHAR2,
        p_new_object_name IN VARCHAR2
    ) IS
        v_index_name USER_CONSTRAINTS.INDEX_NAME%TYPE;
    BEGIN
        IF NOT table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || UPPER(p_table_name) || ' does not exist.');
            RETURN;
        END IF;

        BEGIN
            SELECT INDEX_NAME
              INTO v_index_name
              FROM USER_CONSTRAINTS
             WHERE TABLE_NAME = UPPER(p_table_name)
               AND CONSTRAINT_TYPE = 'P'
               AND CONSTRAINT_NAME IN (UPPER(p_old_object_name), UPPER(p_new_object_name))
               AND ROWNUM = 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                v_index_name := p_old_object_name;
        END;

        rename_constraint_if_needed(p_table_name, p_old_object_name, p_new_object_name);
        rename_index_if_needed(v_index_name, p_new_object_name);
    END;

    PROCEDURE replace_column_reference(
        p_table_name IN VARCHAR2,
        p_column_name IN VARCHAR2,
        p_old_value IN VARCHAR2,
        p_new_value IN VARCHAR2
    ) IS
        v_sql VARCHAR2(4000);
        v_row_count PLS_INTEGER;
    BEGIN
        IF NOT table_exists(p_table_name) OR NOT column_exists(p_table_name, p_column_name) THEN
            RETURN;
        END IF;

        v_sql := 'UPDATE "' || UPPER(p_table_name) || '" '
            || 'SET "' || UPPER(p_column_name) || '" = REPLACE("' || UPPER(p_column_name) || '", :1, :2) '
            || 'WHERE INSTR("' || UPPER(p_column_name) || '", :3) > 0';
        EXECUTE IMMEDIATE v_sql USING p_old_value, p_new_value, p_old_value;
        v_row_count := SQL%ROWCOUNT;

        IF v_row_count > 0 THEN
            DBMS_OUTPUT.PUT_LINE(
                '[UPDATED] ' || UPPER(p_table_name) || '.' || UPPER(p_column_name)
                    || ': ' || v_row_count || ' row(s)'
            );
        END IF;
    END;

    PROCEDURE replace_saved_references(
        p_old_table_name IN VARCHAR2,
        p_new_table_name IN VARCHAR2
    ) IS
    BEGIN
        replace_column_reference('INIT$_TB_DATA_WORK_JOB', 'TABLE_NAME', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_DATA_WORK_JOB', 'EXEC_SPEC_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_DATA_WORK_JOB', 'PARAM_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_DATA_WORK_JOB', 'EXEC_PLSQL', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_DATA_WORK_JOB', 'RESULT_TABLE_NAME', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_DATA_WORK_RUN', 'RESULT_TABLE_NAME', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK', 'GRAPH_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE', 'TABLE_NAME', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE', 'INPUT_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE', 'OUTPUT_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE', 'PARAM_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE', 'EXEC_PLSQL', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_RUN', 'PLAN_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE_RUN', 'RUNTIME_PARAM_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE_RUN', 'NODE_PAYLOAD_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_FLOW_WORK_NODE_RUN', 'RUN_OUTPUT_JSON', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_OBJECT_DETAIL', 'ITEM_VALUE', p_old_table_name, p_new_table_name);
        replace_column_reference('INIT$_TB_OBJECT_DETAIL', 'ITEM_DEFAULT', p_old_table_name, p_new_table_name);
    END;
BEGIN
    -- Preflight every mapping before the first auto-committing RENAME statement.
    assert_no_collision('INIT$_TB_TYPE_MODEL_DEPLOY_HIST', 'INIT$_TB_OML_MODEL_DEPLOY_HIST');
    assert_no_collision('INIT$_TB_TYPE_ACTIVE_MODEL', 'INIT$_TB_OML_ACTIVE_MODEL');
    assert_no_collision('INIT$_TB_TYPE_MODEL_METRIC', 'INIT$_TB_OML_MODEL_METRIC');
    assert_no_collision('INIT$_TB_TYPE_MODEL_REGISTRY', 'INIT$_TB_OML_MODEL_REGISTRY');
    assert_no_collision('INIT$_TB_TYPE_MODEL_TRAIN_RUN', 'INIT$_TB_OML_TRAIN_RUN');
    assert_no_collision('INIT$_TB_SYMBOLIC_RULE_VIOLATION', 'INIT$_TB_RULEVIOL_SYMBOLIC');
    assert_no_collision('INIT$_TB_RULE_VIOLATION_RESULT', 'INIT$_TB_RULEVIOL_ASSOC');
    assert_no_collision('INIT$_TB_SYMBOLIC_RULE', 'INIT$_TB_RULEDISC_SYMBOLIC');
    assert_no_collision('INIT$_TB_ASSOC_RULE_SUMMARY', 'INIT$_TB_RULEDISC_ASSOC_SUM');
    assert_no_collision('INIT$_TB_LASSO_FEATURE', 'INIT$_TB_COLREL_LASSO_FEATURE');
    assert_no_collision('INIT$_TB_RELATION_NETWORK_EDGE', 'INIT$_TB_COLREL_NETWORK_EDGE');
    assert_no_collision('INIT$_TB_RELATION_NETWORK_NODE', 'INIT$_TB_COLREL_NETWORK_NODE');
    assert_no_collision('INIT$_TB_RELATION_SUMMARY', 'INIT$_TB_COLREL_SUMMARY');
    assert_no_collision('INIT$_TB_RELATION_PAIR', 'INIT$_TB_COLREL_PAIR');
    assert_no_collision('INIT$_TB_NUM_CORR_SUMMARY', 'INIT$_TB_COLREL_NUM_SUMMARY');
    assert_no_collision('INIT$_TB_NUM_CORR_PAIR', 'INIT$_TB_COLREL_NUM_PAIR');
    assert_no_collision('INIT$_TB_CAT_CORR_SUMMARY', 'INIT$_TB_COLREL_CAT_SUMMARY');
    assert_no_collision('INIT$_TB_CAT_CORR_PAIR', 'INIT$_TB_COLREL_CAT_PAIR');
    assert_no_collision('INIT$_TB_COLUMN_TYPE_LABEL_HIST', 'INIT$_TB_COLTYPE_LABEL_HIST');
    assert_no_collision('INIT$_TB_COLUMN_TYPE_LABEL', 'INIT$_TB_COLTYPE_LABEL');
    assert_no_collision('INIT$_TB_COLUMN_PROFILE_FEATURE', 'INIT$_TB_COLTYPE_PROFILE');
    assert_no_collision('INIT$_TB_PREDICTED_TYPE_FINAL', 'INIT$_TB_COLTYPE_FINAL');
    assert_no_collision('INIT$_TB_PREDICTED_TYPE', 'INIT$_TB_COLTYPE_RESULT');

    -- Generic Oracle Machine Learning lifecycle tables (children first).
    rename_table_if_needed('INIT$_TB_TYPE_MODEL_DEPLOY_HIST', 'INIT$_TB_OML_MODEL_DEPLOY_HIST');
    rename_table_if_needed('INIT$_TB_TYPE_ACTIVE_MODEL', 'INIT$_TB_OML_ACTIVE_MODEL');
    rename_table_if_needed('INIT$_TB_TYPE_MODEL_METRIC', 'INIT$_TB_OML_MODEL_METRIC');
    rename_table_if_needed('INIT$_TB_TYPE_MODEL_REGISTRY', 'INIT$_TB_OML_MODEL_REGISTRY');
    rename_table_if_needed('INIT$_TB_TYPE_MODEL_TRAIN_RUN', 'INIT$_TB_OML_TRAIN_RUN');

    -- Stage 4: rule violation detection.
    rename_table_if_needed('INIT$_TB_SYMBOLIC_RULE_VIOLATION', 'INIT$_TB_RULEVIOL_SYMBOLIC');
    rename_table_if_needed('INIT$_TB_RULE_VIOLATION_RESULT', 'INIT$_TB_RULEVIOL_ASSOC');

    -- Stage 3: automatic rule discovery.
    rename_table_if_needed('INIT$_TB_SYMBOLIC_RULE', 'INIT$_TB_RULEDISC_SYMBOLIC');
    rename_table_if_needed('INIT$_TB_ASSOC_RULE_SUMMARY', 'INIT$_TB_RULEDISC_ASSOC_SUM');

    -- Stage 2: column relationship analysis.
    rename_table_if_needed('INIT$_TB_LASSO_FEATURE', 'INIT$_TB_COLREL_LASSO_FEATURE');
    rename_table_if_needed('INIT$_TB_RELATION_NETWORK_EDGE', 'INIT$_TB_COLREL_NETWORK_EDGE');
    rename_table_if_needed('INIT$_TB_RELATION_NETWORK_NODE', 'INIT$_TB_COLREL_NETWORK_NODE');
    rename_table_if_needed('INIT$_TB_RELATION_SUMMARY', 'INIT$_TB_COLREL_SUMMARY');
    rename_table_if_needed('INIT$_TB_RELATION_PAIR', 'INIT$_TB_COLREL_PAIR');
    rename_table_if_needed('INIT$_TB_NUM_CORR_SUMMARY', 'INIT$_TB_COLREL_NUM_SUMMARY');
    rename_table_if_needed('INIT$_TB_NUM_CORR_PAIR', 'INIT$_TB_COLREL_NUM_PAIR');
    rename_table_if_needed('INIT$_TB_CAT_CORR_SUMMARY', 'INIT$_TB_COLREL_CAT_SUMMARY');
    rename_table_if_needed('INIT$_TB_CAT_CORR_PAIR', 'INIT$_TB_COLREL_CAT_PAIR');

    -- Stage 1: column type profiling and classification.
    rename_table_if_needed('INIT$_TB_COLUMN_TYPE_LABEL_HIST', 'INIT$_TB_COLTYPE_LABEL_HIST');
    rename_table_if_needed('INIT$_TB_COLUMN_TYPE_LABEL', 'INIT$_TB_COLTYPE_LABEL');
    rename_table_if_needed('INIT$_TB_COLUMN_PROFILE_FEATURE', 'INIT$_TB_COLTYPE_PROFILE');
    rename_table_if_needed('INIT$_TB_PREDICTED_TYPE_FINAL', 'INIT$_TB_COLTYPE_FINAL');
    rename_table_if_needed('INIT$_TB_PREDICTED_TYPE', 'INIT$_TB_COLTYPE_RESULT');

    -- RENAME TABLE preserves dependent constraint and index names. Normalize
    -- primary-key constraints, their backing indexes, and secondary indexes
    -- after every table has reached its final name. These calls are rerunnable,
    -- including after a previous table-only migration or a partial ALTER run.
    rename_primary_key_objects_if_needed('INIT$_TB_OML_MODEL_DEPLOY_HIST', 'PK_INIT$_TB_TYPE_DEPLOY_HIST', 'PK_INIT$_TB_OML_MODEL_DEPLOY_HIST');
    rename_primary_key_objects_if_needed('INIT$_TB_OML_ACTIVE_MODEL', 'PK_INIT$_TB_TYPE_ACTIVE_MODEL', 'PK_INIT$_TB_OML_ACTIVE_MODEL');
    rename_primary_key_objects_if_needed('INIT$_TB_OML_MODEL_METRIC', 'PK_INIT$_TB_TYPE_MODEL_MET', 'PK_INIT$_TB_OML_MODEL_METRIC');
    rename_primary_key_objects_if_needed('INIT$_TB_OML_MODEL_METRIC', 'PK_INIT$_TB_TYPE_MODEL_METRIC', 'PK_INIT$_TB_OML_MODEL_METRIC');
    rename_primary_key_objects_if_needed('INIT$_TB_OML_MODEL_REGISTRY', 'PK_INIT$_TB_TYPE_MODEL_REG', 'PK_INIT$_TB_OML_MODEL_REGISTRY');
    rename_primary_key_objects_if_needed('INIT$_TB_OML_MODEL_REGISTRY', 'PK_INIT$_TB_TYPE_MODEL_REGISTRY', 'PK_INIT$_TB_OML_MODEL_REGISTRY');
    rename_primary_key_objects_if_needed('INIT$_TB_OML_TRAIN_RUN', 'PK_INIT$_TB_TYPE_TRAIN_RUN', 'PK_INIT$_TB_OML_TRAIN_RUN');
    rename_primary_key_objects_if_needed('INIT$_TB_RULEVIOL_SYMBOLIC', 'PK_INIT$_TB_SYM_RULE_VIOL', 'PK_INIT$_TB_RULEVIOL_SYMBOLIC');
    rename_primary_key_objects_if_needed('INIT$_TB_RULEVIOL_ASSOC', 'PK_INIT$_TB_RULE_VIOLATION', 'PK_INIT$_TB_RULEVIOL_ASSOC');
    rename_primary_key_objects_if_needed('INIT$_TB_RULEDISC_SYMBOLIC', 'PK_INIT$_TB_SYMBOLIC_RULE', 'PK_INIT$_TB_RULEDISC_SYMBOLIC');
    rename_primary_key_objects_if_needed('INIT$_TB_RULEDISC_ASSOC_SUM', 'PK_INIT$_TB_ASSOC_RULE_SUMMARY', 'PK_INIT$_TB_RULEDISC_ASSOC_SUM');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_LASSO_FEATURE', 'PK_INIT$_TB_LASSO_FEATURE', 'PK_INIT$_TB_COLREL_LASSO_FEATURE');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_NETWORK_EDGE', 'PK_INIT$_TB_REL_NET_EDGE', 'PK_INIT$_TB_COLREL_NETWORK_EDGE');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_NETWORK_NODE', 'PK_INIT$_TB_REL_NET_NODE', 'PK_INIT$_TB_COLREL_NETWORK_NODE');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_SUMMARY', 'PK_INIT$_TB_RELATION_SUMMARY', 'PK_INIT$_TB_COLREL_SUMMARY');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_PAIR', 'PK_INIT$_TB_RELATION_PAIR', 'PK_INIT$_TB_COLREL_PAIR');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_NUM_SUMMARY', 'PK_INIT$_TB_NUM_CORR_SUMMARY', 'PK_INIT$_TB_COLREL_NUM_SUMMARY');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_NUM_PAIR', 'PK_INIT$_TB_NUM_CORR_PAIR', 'PK_INIT$_TB_COLREL_NUM_PAIR');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_CAT_SUMMARY', 'PK_INIT$_TB_CAT_CORR_SUMMARY', 'PK_INIT$_TB_COLREL_CAT_SUMMARY');
    rename_primary_key_objects_if_needed('INIT$_TB_COLREL_CAT_PAIR', 'PK_INIT$_TB_CAT_CORR_PAIR', 'PK_INIT$_TB_COLREL_CAT_PAIR');
    rename_primary_key_objects_if_needed('INIT$_TB_COLTYPE_LABEL_HIST', 'PK_INIT$_TB_COL_LABEL_HIST', 'PK_INIT$_TB_COLTYPE_LABEL_HIST');
    rename_primary_key_objects_if_needed('INIT$_TB_COLTYPE_LABEL', 'PK_INIT$_TB_COL_TYPE_LABEL', 'PK_INIT$_TB_COLTYPE_LABEL');
    rename_primary_key_objects_if_needed('INIT$_TB_COLTYPE_PROFILE', 'PK_INIT$_TB_COL_PROFILE', 'PK_INIT$_TB_COLTYPE_PROFILE');
    rename_primary_key_objects_if_needed('INIT$_TB_COLTYPE_FINAL', 'PK_INIT$_TB_PRED_TYPE_FINAL', 'PK_INIT$_TB_COLTYPE_FINAL');
    rename_primary_key_objects_if_needed('INIT$_TB_COLTYPE_RESULT', 'PK_INIT$_TB_PREDICTED_TYPE', 'PK_INIT$_TB_COLTYPE_RESULT');

    rename_index_if_needed('IX_INIT$_TB_TYPE_REG_01', 'IX_INIT$_TB_OML_MODEL_REGISTRY_01');
    rename_index_if_needed('IX_INIT$_TB_TYPE_RUN_01', 'IX_INIT$_TB_OML_TRAIN_RUN_01');
    rename_index_if_needed('IX_INIT$_TB_SYM_RULE_VIOL_01', 'IX_INIT$_TB_RULEVIOL_SYMBOLIC_01');
    rename_index_if_needed('IX_INIT$_TB_SYM_RULE_VIOL_02', 'IX_INIT$_TB_RULEVIOL_SYMBOLIC_02');
    rename_index_if_needed('IX_INIT$_TB_RULE_VIOLATION_01', 'IX_INIT$_TB_RULEVIOL_ASSOC_01');
    rename_index_if_needed('IX_INIT$_TB_RULE_VIOLATION_02', 'IX_INIT$_TB_RULEVIOL_ASSOC_02');
    rename_index_if_needed('IX_INIT$_TB_RULE_VIOLATION_03', 'IX_INIT$_TB_RULEVIOL_ASSOC_03');
    rename_index_if_needed('IX_INIT$_TB_SYMBOLIC_RULE_01', 'IX_INIT$_TB_RULEDISC_SYMBOLIC_01');
    rename_index_if_needed('IX_INIT$_TB_ASSOC_RULE_SUMMARY_01', 'IX_INIT$_TB_RULEDISC_ASSOC_SUM_01');
    rename_index_if_needed('IX_INIT$_TB_ASSOC_RULE_SUMMARY_02', 'IX_INIT$_TB_RULEDISC_ASSOC_SUM_02');
    rename_index_if_needed('IX_INIT$_TB_ASSOC_RULE_SUMMARY_03', 'IX_INIT$_TB_RULEDISC_ASSOC_SUM_03');
    rename_index_if_needed('IX_INIT$_TB_LASSO_FEATURE_01', 'IX_INIT$_TB_COLREL_LASSO_FEATURE_01');
    rename_index_if_needed('IX_INIT$_TB_REL_NET_EDGE_01', 'IX_INIT$_TB_COLREL_NETWORK_EDGE_01');
    rename_index_if_needed('IX_INIT$_TB_REL_NET_NODE_01', 'IX_INIT$_TB_COLREL_NETWORK_NODE_01');
    rename_index_if_needed('IX_INIT$_TB_REL_SUMMARY_01', 'IX_INIT$_TB_COLREL_SUMMARY_01');
    rename_index_if_needed('IX_INIT$_TB_REL_PAIR_01', 'IX_INIT$_TB_COLREL_PAIR_01');
    rename_index_if_needed('IX_INIT$_TB_REL_PAIR_02', 'IX_INIT$_TB_COLREL_PAIR_02');
    rename_index_if_needed('IX_INIT$_TB_NUM_CORR_SUMMARY_01', 'IX_INIT$_TB_COLREL_NUM_SUMMARY_01');
    rename_index_if_needed('IX_INIT$_TB_NUM_CORR_PAIR_01', 'IX_INIT$_TB_COLREL_NUM_PAIR_01');
    rename_index_if_needed('IX_INIT$_TB_CAT_CORR_SUMMARY_01', 'IX_INIT$_TB_COLREL_CAT_SUMMARY_01');
    rename_index_if_needed('IX_INIT$_TB_CAT_CORR_PAIR_01', 'IX_INIT$_TB_COLREL_CAT_PAIR_01');
    rename_index_if_needed('IX_INIT$_TB_COL_PROFILE_01', 'IX_INIT$_TB_COLTYPE_PROFILE_01');
    rename_index_if_needed('IX_INIT$_TB_COL_LABEL_01', 'IX_INIT$_TB_COLTYPE_LABEL_01');
    rename_index_if_needed('IX_INIT$_TB_PRED_TYPE_FINAL_01', 'IX_INIT$_TB_COLTYPE_FINAL_01');
    rename_index_if_needed('IX_INIT$_TB_PRED_TYPE_FINAL_02', 'IX_INIT$_TB_COLTYPE_FINAL_02');
    rename_index_if_needed('IX_INIT$_TB_PREDICTED_TYPE_01', 'IX_INIT$_TB_COLTYPE_RESULT_01');

    -- Keep saved job, flow, and object-detail payloads aligned with renamed tables.
    replace_saved_references('INIT$_TB_TYPE_MODEL_DEPLOY_HIST', 'INIT$_TB_OML_MODEL_DEPLOY_HIST');
    replace_saved_references('INIT$_TB_TYPE_ACTIVE_MODEL', 'INIT$_TB_OML_ACTIVE_MODEL');
    replace_saved_references('INIT$_TB_TYPE_MODEL_METRIC', 'INIT$_TB_OML_MODEL_METRIC');
    replace_saved_references('INIT$_TB_TYPE_MODEL_REGISTRY', 'INIT$_TB_OML_MODEL_REGISTRY');
    replace_saved_references('INIT$_TB_TYPE_MODEL_TRAIN_RUN', 'INIT$_TB_OML_TRAIN_RUN');
    replace_saved_references('INIT$_TB_SYMBOLIC_RULE_VIOLATION', 'INIT$_TB_RULEVIOL_SYMBOLIC');
    replace_saved_references('INIT$_TB_RULE_VIOLATION_RESULT', 'INIT$_TB_RULEVIOL_ASSOC');
    replace_saved_references('INIT$_TB_SYMBOLIC_RULE', 'INIT$_TB_RULEDISC_SYMBOLIC');
    replace_saved_references('INIT$_TB_ASSOC_RULE_SUMMARY', 'INIT$_TB_RULEDISC_ASSOC_SUM');
    replace_saved_references('INIT$_TB_LASSO_FEATURE', 'INIT$_TB_COLREL_LASSO_FEATURE');
    replace_saved_references('INIT$_TB_RELATION_NETWORK_EDGE', 'INIT$_TB_COLREL_NETWORK_EDGE');
    replace_saved_references('INIT$_TB_RELATION_NETWORK_NODE', 'INIT$_TB_COLREL_NETWORK_NODE');
    replace_saved_references('INIT$_TB_RELATION_SUMMARY', 'INIT$_TB_COLREL_SUMMARY');
    replace_saved_references('INIT$_TB_RELATION_PAIR', 'INIT$_TB_COLREL_PAIR');
    replace_saved_references('INIT$_TB_NUM_CORR_SUMMARY', 'INIT$_TB_COLREL_NUM_SUMMARY');
    replace_saved_references('INIT$_TB_NUM_CORR_PAIR', 'INIT$_TB_COLREL_NUM_PAIR');
    replace_saved_references('INIT$_TB_CAT_CORR_SUMMARY', 'INIT$_TB_COLREL_CAT_SUMMARY');
    replace_saved_references('INIT$_TB_CAT_CORR_PAIR', 'INIT$_TB_COLREL_CAT_PAIR');
    replace_saved_references('INIT$_TB_COLUMN_TYPE_LABEL_HIST', 'INIT$_TB_COLTYPE_LABEL_HIST');
    replace_saved_references('INIT$_TB_COLUMN_TYPE_LABEL', 'INIT$_TB_COLTYPE_LABEL');
    replace_saved_references('INIT$_TB_COLUMN_PROFILE_FEATURE', 'INIT$_TB_COLTYPE_PROFILE');
    replace_saved_references('INIT$_TB_PREDICTED_TYPE_FINAL', 'INIT$_TB_COLTYPE_FINAL');
    replace_saved_references('INIT$_TB_PREDICTED_TYPE', 'INIT$_TB_COLTYPE_RESULT');

    COMMIT;

    DBMS_OUTPUT.PUT_LINE('[DONE] Target table rename migration completed.');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        DBMS_OUTPUT.PUT_LINE('[FAILED] Target table rename migration: ' || SQLERRM);
        RAISE;
END;
/
