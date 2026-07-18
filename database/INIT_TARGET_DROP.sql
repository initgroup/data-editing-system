SET SERVEROUTPUT ON;

DECLARE
    FUNCTION object_exists(p_object_name IN VARCHAR2, p_object_type IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_OBJECTS
         WHERE OBJECT_NAME = UPPER(p_object_name)
           AND OBJECT_TYPE = UPPER(p_object_type);

        RETURN v_count > 0;
    END;

    PROCEDURE run_ddl(p_name IN VARCHAR2, p_sql IN VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE p_sql;
        DBMS_OUTPUT.PUT_LINE('[OK] ' || p_name);
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('[ERROR] ' || p_name || ' - ' || SQLERRM);
    END;

    PROCEDURE drop_table_if_exists(p_table_name IN VARCHAR2) IS
    BEGIN
        IF object_exists(p_table_name, 'TABLE') THEN
            run_ddl(
                'DROP TABLE ' || p_table_name,
                'DROP TABLE "' || UPPER(p_table_name) || '" CASCADE CONSTRAINTS PURGE'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || p_table_name || ' does not exist.');
        END IF;
    END;

    PROCEDURE drop_index_if_exists(p_index_name IN VARCHAR2) IS
    BEGIN
        IF object_exists(p_index_name, 'INDEX') THEN
            run_ddl(
                'DROP INDEX ' || p_index_name,
                'DROP INDEX "' || UPPER(p_index_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || p_index_name || ' does not exist.');
        END IF;
    END;

    PROCEDURE drop_package_if_exists(p_package_name IN VARCHAR2) IS
    BEGIN
        IF object_exists(p_package_name, 'PACKAGE') THEN
            run_ddl(
                'DROP PACKAGE ' || p_package_name,
                'DROP PACKAGE "' || UPPER(p_package_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] PACKAGE ' || p_package_name || ' does not exist.');
        END IF;
    END;

    PROCEDURE drop_function_if_exists(p_function_name IN VARCHAR2) IS
    BEGIN
        IF object_exists(p_function_name, 'FUNCTION') THEN
            run_ddl(
                'DROP FUNCTION ' || p_function_name,
                'DROP FUNCTION "' || UPPER(p_function_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] FUNCTION ' || p_function_name || ' does not exist.');
        END IF;
    END;

    PROCEDURE drop_procedure_if_exists(p_procedure_name IN VARCHAR2) IS
    BEGIN
        IF object_exists(p_procedure_name, 'PROCEDURE') THEN
            run_ddl(
                'DROP PROCEDURE ' || p_procedure_name,
                'DROP PROCEDURE "' || UPPER(p_procedure_name) || '"'
            );
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] PROCEDURE ' || p_procedure_name || ' does not exist.');
        END IF;
    END;
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET DROP START ===');

    DBMS_OUTPUT.PUT_LINE('[INIT_TARGET] Drop packages');
    drop_package_if_exists('INIT$_PKG_RULE_SUMMARY');
    drop_package_if_exists('INIT$_PKG_OML_SCRIPT');

    DBMS_OUTPUT.PUT_LINE('[INIT_TARGET] Drop functions');
    drop_function_if_exists('INIT$_FN_PREDICT_BASE_REASON');
    drop_function_if_exists('INIT$_FN_PREDICT_BASE_TYPE');
    drop_function_if_exists('INIT$_FN_TYPE_GROUP_LABEL');
    drop_function_if_exists('INIT$_FN_TYPE_GROUP_CODE');
    drop_function_if_exists('INIT$_FN_TYPE_LABEL');
    drop_function_if_exists('INIT$_FN_TYPE_CODE');
    drop_function_if_exists('INIT$_FN_PREDICT_LOG_DATA_TYPE');
    drop_function_if_exists('INIT$_FN_TOKEN_LIST_CONTAINS');
    drop_function_if_exists('INIT$_FN_TARGET_SETTING_USE_YN');
    drop_function_if_exists('INIT$_FN_TARGET_SETTING_NUMBER');
    drop_function_if_exists('INIT$_FN_TARGET_SETTING_VALUE');

    DBMS_OUTPUT.PUT_LINE('[INIT_TARGET] Drop column type lifecycle procedures');
    drop_procedure_if_exists('INIT$_SP_TYPE_MODEL_ROLLBACK');
    drop_procedure_if_exists('INIT$_SP_TYPE_MODEL_ARCHIVE');
    drop_procedure_if_exists('INIT$_SP_TYPE_MODEL_ACTIVATE');
    drop_procedure_if_exists('INIT$_SP_TYPE_MODEL_TRAIN');
    drop_procedure_if_exists('INIT$_SP_COLUMN_TYPE_CONFIRM');
    drop_procedure_if_exists('SP_ANALYZE_FEATURE_TYPES');
    drop_procedure_if_exists('INIT$_SP_ANALYZE_FEATURE_TYPES');

    DBMS_OUTPUT.PUT_LINE('[INIT_TARGET] Drop tables');
    drop_table_if_exists('INIT$_TB_OBJECT_DEPLOY');
    drop_table_if_exists('INIT$_TB_FLOW_WORK_NODE_RUN');
    drop_table_if_exists('INIT$_TB_FLOW_WORK_RUN');
    drop_table_if_exists('INIT$_TB_FLOW_WORK_EDGE');
    drop_table_if_exists('INIT$_TB_FLOW_WORK_NODE');
    drop_table_if_exists('INIT$_TB_FLOW_WORK');
    drop_table_if_exists('INIT$_TB_API_RESULT');
    drop_table_if_exists('INIT$_TB_RULEVIOL_SYMBOLIC');
    drop_table_if_exists('INIT$_TB_RULEDISC_SYMBOLIC');
    drop_table_if_exists('INIT$_TB_COLREL_LASSO_FEATURE');
    drop_table_if_exists('INIT$_TB_COLREL_NETWORK_EDGE');
    drop_table_if_exists('INIT$_TB_COLREL_NETWORK_NODE');
    drop_table_if_exists('INIT$_TB_COLREL_SUMMARY');
    drop_table_if_exists('INIT$_TB_COLREL_PAIR');
    drop_table_if_exists('INIT$_TB_COLREL_NUM_SUMMARY');
    drop_table_if_exists('INIT$_TB_COLREL_NUM_PAIR');
    drop_table_if_exists('INIT$_TB_COLREL_CAT_SUMMARY');
    drop_table_if_exists('INIT$_TB_COLREL_CAT_PAIR');
    drop_table_if_exists('INIT$_TB_RULEVIOL_ASSOC');
    drop_table_if_exists('INIT$_TB_RULEDISC_ASSOC_SUM');
    drop_table_if_exists('INIT$_TB_OML_MODEL_DEPLOY_HIST');
    drop_table_if_exists('INIT$_TB_OML_ACTIVE_MODEL');
    drop_table_if_exists('INIT$_TB_OML_MODEL_METRIC');
    drop_table_if_exists('INIT$_TB_OML_MODEL_REGISTRY');
    drop_table_if_exists('INIT$_TB_OML_TRAIN_RUN');
    drop_table_if_exists('INIT$_TB_COLTYPE_LABEL_HIST');
    drop_table_if_exists('INIT$_TB_COLTYPE_LABEL');
    drop_table_if_exists('INIT$_TB_COLTYPE_PROFILE');
    drop_table_if_exists('INIT$_TB_COLTYPE_FINAL');
    drop_table_if_exists('INIT$_TB_COLTYPE_RESULT');
    drop_table_if_exists('INIT$_TB_DATA_WORK_RUN');
    drop_table_if_exists('INIT$_TB_DATA_WORK_JOB');
    drop_table_if_exists('INIT$_TB_TARGET_SETTING');
    drop_table_if_exists('INIT$_TB_OML_RESOURCE_PARAM');
    drop_table_if_exists('INIT$_TB_OML_RESOURCE');
    drop_table_if_exists('INIT$_TB_OBJECT_DETAIL');
    drop_table_if_exists('INIT$_TB_TABLES');
    drop_table_if_exists('INIT$_TB_SCENARIO');
    drop_table_if_exists('INIT$_TB_OBJECT');
    drop_table_if_exists('INIT$_TB_PROJECT');

    DBMS_OUTPUT.PUT_LINE('[INIT_TARGET] Drop remaining indexes, if any');
    drop_index_if_exists('IX_INIT$_TB_COLREL_CAT_SUMMARY_01');
    drop_index_if_exists('IX_INIT$_TB_COLREL_CAT_PAIR_01');
    drop_index_if_exists('IX_INIT$_TB_API_RESULT_01');
    drop_index_if_exists('IX_INIT$_TB_SYM_RULE_VIOL_02');
    drop_index_if_exists('IX_INIT$_TB_SYM_RULE_VIOL_01');
    drop_index_if_exists('IX_INIT$_TB_RULEDISC_SYMBOLIC_01');
    drop_index_if_exists('IX_INIT$_TB_COLREL_LASSO_FEATURE_01');
    drop_index_if_exists('IX_INIT$_TB_REL_NET_EDGE_01');
    drop_index_if_exists('IX_INIT$_TB_REL_NET_NODE_01');
    drop_index_if_exists('IX_INIT$_TB_REL_SUMMARY_01');
    drop_index_if_exists('IX_INIT$_TB_REL_PAIR_02');
    drop_index_if_exists('IX_INIT$_TB_REL_PAIR_01');
    drop_index_if_exists('IX_INIT$_TB_COLREL_NUM_SUMMARY_01');
    drop_index_if_exists('IX_INIT$_TB_COLREL_NUM_PAIR_01');
    drop_index_if_exists('IX_INIT$_TB_RULE_VIOLATION_03');
    drop_index_if_exists('IX_INIT$_TB_RULE_VIOLATION_02');
    drop_index_if_exists('IX_INIT$_TB_RULE_VIOLATION_01');
    drop_index_if_exists('IX_INIT$_TB_RULEDISC_ASSOC_SUM_03');
    drop_index_if_exists('IX_INIT$_TB_RULEDISC_ASSOC_SUM_02');
    drop_index_if_exists('IX_INIT$_TB_RULEDISC_ASSOC_SUM_01');
    drop_index_if_exists('IX_INIT$_TB_TYPE_RUN_01');
    drop_index_if_exists('IX_INIT$_TB_TYPE_REG_01');
    drop_index_if_exists('IX_INIT$_TB_COL_LABEL_01');
    drop_index_if_exists('IX_INIT$_TB_COL_PROFILE_01');
    drop_index_if_exists('IX_INIT$_TB_PRED_TYPE_FINAL_02');
    drop_index_if_exists('IX_INIT$_TB_PRED_TYPE_FINAL_01');
    drop_index_if_exists('IX_INIT$_TB_COLTYPE_RESULT_01');
    drop_index_if_exists('IX_INIT$_TB_COLTYPE_RESULT_02');
    drop_index_if_exists('IX_INIT$_TB_TARGET_SETTING_01');
    drop_index_if_exists('IX_INIT$_TB_OML_RESOURCE_01');
    drop_index_if_exists('IX_INIT$_TB_OBJECT_DETAIL_01');
    drop_index_if_exists('IX_INIT$_TB_OBJECT_01');
    drop_index_if_exists('IX_INIT$_TB_FLOW_NODE_RUN_02');
    drop_index_if_exists('IX_INIT$_TB_FLOW_NODE_RUN_01');
    drop_index_if_exists('IX_INIT$_TB_FLOW_WORK_RUN_01');
    drop_index_if_exists('IX_INIT$_TB_FLOW_WORK_EDGE_01');
    drop_index_if_exists('IX_INIT$_TB_FLOW_WORK_01');
    drop_index_if_exists('IX_INIT$_TB_DATA_WORK_RUN_02');
    drop_index_if_exists('IX_INIT$_TB_DATA_WORK_RUN_01');

    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET DROP END ===');
END;
/
