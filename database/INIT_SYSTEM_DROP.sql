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
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT_SYSTEM DROP START ===');

    DBMS_OUTPUT.PUT_LINE('[INIT_SYSTEM] Drop tables');
    drop_table_if_exists('INIT$_TB_SETUP_LOG');
    drop_table_if_exists('INIT$_TB_NOTICE');
    drop_table_if_exists('INIT$_TB_SYSTEM_SETTING');
    drop_table_if_exists('INIT$_TB_DB_CONNECTION');
    drop_table_if_exists('INIT$_TB_USER');

    DBMS_OUTPUT.PUT_LINE('[INIT_SYSTEM] Drop remaining indexes, if any');
    drop_index_if_exists('INIT$_IX_SETUP_LOG_CONN');
    drop_index_if_exists('INIT$_IX_NOTICE_POPUP');
    drop_index_if_exists('INIT$_IX_NOTICE_ACTIVE');
    drop_index_if_exists('INIT$_IX_SYSTEM_SETTING_CONN');
    drop_index_if_exists('INIT$_IX_DB_CONN_DEFAULT');
    drop_index_if_exists('INIT$_IX_USER_USE');

    DBMS_OUTPUT.PUT_LINE('=== INIT_SYSTEM DROP END ===');
END;
/
