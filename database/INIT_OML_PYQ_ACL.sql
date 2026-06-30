SET SERVEROUTPUT ON;

-- INIT_OML_PYQ_ACL
-- Purpose:
--   ADMIN-run helper for Oracle Machine Learning for Python / Embedded Python
--   Execution SQL API errors such as:
--     ORA-20101: Host Access Control List(ACL) not configured for current user
--
-- Run as:
--   ADMIN or another account allowed to execute DBMS_NETWORK_ACL_ADMIN.
--
-- After running this file as ADMIN, test pyqEval again as the application
-- target schema user, for example INIT$EDIT01.

DECLARE
    c_app_user CONSTANT VARCHAR2(128) := 'INIT$EDIT01';

    PROCEDURE print_line(p_text IN VARCHAR2) IS
    BEGIN
        DBMS_OUTPUT.PUT_LINE(p_text);
    END;

    PROCEDURE append_host_ace(
        p_host IN VARCHAR2,
        p_privilege IN VARCHAR2
    ) IS
    BEGIN
        DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
            host => p_host,
            ace  => XS$ACE_TYPE(
                privilege_list => XS$NAME_LIST(LOWER(p_privilege)),
                principal_name => c_app_user,
                principal_type => XS_ACL.PTYPE_DB
            )
        );
        print_line('[OK] ACL granted. host=' || p_host || ', privilege=' || p_privilege || ', principal=' || c_app_user);
    EXCEPTION
        WHEN OTHERS THEN
            IF INSTR(LOWER(SQLERRM), 'already') > 0
               OR INSTR(LOWER(SQLERRM), 'duplicate') > 0
               OR SQLCODE IN (-24243, -46212, -46375) THEN
                print_line('[SKIP] ACL already exists. host=' || p_host || ', privilege=' || p_privilege || ', principal=' || c_app_user || ' - ' || SQLERRM);
            ELSE
                print_line('[ERROR] ACL grant failed. host=' || p_host || ', privilege=' || p_privilege || ', principal=' || c_app_user || ' - ' || SQLERRM);
                RAISE;
            END IF;
    END;

    PROCEDURE print_host_aces IS
    BEGIN
        print_line('[INFO] DBA_HOST_ACES for ' || c_app_user);
        FOR rec IN (
            SELECT HOST
                 , LOWER_PORT
                 , UPPER_PORT
                 , PRIVILEGE
                 , GRANT_TYPE
              FROM DBA_HOST_ACES
             WHERE PRINCIPAL = c_app_user
             ORDER BY HOST, PRIVILEGE
        ) LOOP
            print_line('  HOST=' || rec.HOST
                || ', PRIVILEGE=' || rec.PRIVILEGE
                || ', GRANT_TYPE=' || rec.GRANT_TYPE
                || ', LOWER_PORT=' || NVL(TO_CHAR(rec.LOWER_PORT), 'NULL')
                || ', UPPER_PORT=' || NVL(TO_CHAR(rec.UPPER_PORT), 'NULL'));
        END LOOP;
    EXCEPTION
        WHEN OTHERS THEN
            print_line('[WARN] DBA_HOST_ACES report failed: ' || SQLERRM);
    END;

BEGIN
    print_line('=== INIT OML/PYQ ACL START ===');
    print_line('[INFO] Current user: ' || SYS_CONTEXT('USERENV', 'SESSION_USER'));
    print_line('[INFO] Target application DB user: ' || c_app_user);

    append_host_ace('*', 'connect');
    append_host_ace('*', 'resolve');

    append_host_ace('pod', 'connect');
    append_host_ace('pod', 'resolve');

    append_host_ace('POD', 'connect');
    append_host_ace('POD', 'resolve');

    print_host_aces;

    print_line('[INFO] Host lookup verification must be run as ' || c_app_user || ', not as ADMIN.');

    print_line('=== INIT OML/PYQ ACL END ===');
END;
/

PROMPT
PROMPT Run this verification as the target application user, for example INIT$EDIT01:
PROMPT
PROMPT SELECT * FROM USER_HOST_ACES ORDER BY HOST, PRIVILEGE;
PROMPT
PROMPT SELECT UTL_INADDR.GET_HOST_ADDRESS('pod') AS POD_IP FROM DUAL;
PROMPT
PROMPT SELECT * FROM USER_PYQ_SCRIPTS WHERE UPPER(NAME) = 'OML_HELLO_PYTHON';
PROMPT
PROMPT SELECT *
PROMPT   FROM TABLE(pyqEval(
PROMPT         par_lst => JSON_OBJECT('pMessage' VALUE 'Hello OML4Py' RETURNING CLOB),
PROMPT         out_fmt => 'JSON',
PROMPT         scr_name => 'OML_HELLO_PYTHON'
PROMPT   ));
