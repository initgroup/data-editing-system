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
    v_version CONSTANT VARCHAR2(50) := '1.0.14';
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
        EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

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
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END CREATE_SCRIPT;
END "INIT$_PKG_OML_SCRIPT";
/

