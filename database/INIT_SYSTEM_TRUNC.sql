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
    DBMS_OUTPUT.PUT_LINE('=== INIT_SYSTEM TRUNCATE START ===');

    truncate_table_if_exists('INIT$_TB_SETUP_LOG');
    truncate_table_if_exists('INIT$_TB_SYSTEM_SETTING');
    truncate_table_if_exists('INIT$_TB_DB_CONNECTION');
    truncate_table_if_exists('INIT$_TB_USER');

    DBMS_OUTPUT.PUT_LINE('=== INIT_SYSTEM TRUNCATE END ===');
END;
/
