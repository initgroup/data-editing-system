SET SERVEROUTPUT ON;

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

    PROCEDURE truncate_table_if_exists(p_table_name IN VARCHAR2) IS
    BEGIN
        IF table_exists(p_table_name) THEN
            EXECUTE IMMEDIATE 'TRUNCATE TABLE "' || UPPER(p_table_name) || '" CASCADE';
            DBMS_OUTPUT.PUT_LINE('[OK] TRUNCATE TABLE ' || p_table_name);
        ELSE
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || p_table_name || ' does not exist.');
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('[ERROR] TRUNCATE TABLE ' || p_table_name || ' - ' || SQLERRM);
    END;
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET TRUNCATE START ===');

    truncate_table_if_exists('INIT$_TB_OBJECT_DEPLOY');
    truncate_table_if_exists('INIT$_TB_FLOW_WORK_NODE_RUN');
    truncate_table_if_exists('INIT$_TB_FLOW_WORK_RUN');
    truncate_table_if_exists('INIT$_TB_FLOW_WORK_EDGE');
    truncate_table_if_exists('INIT$_TB_FLOW_WORK_NODE');
    truncate_table_if_exists('INIT$_TB_FLOW_WORK');
    truncate_table_if_exists('INIT$_TB_CAT_CORR_SUMMARY');
    truncate_table_if_exists('INIT$_TB_CAT_CORR_PAIR');
    truncate_table_if_exists('INIT$_TB_RULE_VIOLATION_RESULT');
    truncate_table_if_exists('INIT$_TB_ASSOC_RULE_SUMMARY');
    truncate_table_if_exists('INIT$_TB_PREDICTED_TYPE_FINAL');
    truncate_table_if_exists('INIT$_TB_PREDICTED_TYPE');
    truncate_table_if_exists('INIT$_TB_DATA_WORK_RUN');
    truncate_table_if_exists('INIT$_TB_DATA_WORK_JOB');
    truncate_table_if_exists('INIT$_TB_TARGET_SETTING');
    truncate_table_if_exists('INIT$_TB_OML_RESOURCE_PARAM');
    truncate_table_if_exists('INIT$_TB_OML_RESOURCE');
    truncate_table_if_exists('INIT$_TB_OBJECT_DETAIL');
    truncate_table_if_exists('INIT$_TB_TABLES');
    truncate_table_if_exists('INIT$_TB_SCENARIO');
    truncate_table_if_exists('INIT$_TB_OBJECT');
    truncate_table_if_exists('INIT$_TB_PROJECT');

    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET TRUNCATE END ===');
END;
/
