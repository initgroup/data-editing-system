SET SERVEROUTPUT ON;

-- INIT_SYSTEM_ALTER
-- Purpose:
--   Patch existing system schemas without mixing ALTER logic into
--   INIT_SYSTEM_DDL.sql. New installations should use INIT_SYSTEM_DDL.sql.
--
-- Notes:
--   Run this only against the INIT system schema during a maintenance window.
--   Oracle 12c+ can change SELECT * display order by toggling columns
--   INVISIBLE and then VISIBLE.

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

    FUNCTION index_exists(p_index_name IN VARCHAR2) RETURN BOOLEAN IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_INDEXES
         WHERE INDEX_NAME = UPPER(p_index_name);

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

    PROCEDURE create_table_if_missing(p_table_name IN VARCHAR2, p_ddl IN CLOB) IS
    BEGIN
        IF table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] TABLE ' || p_table_name || ' already exists.');
        ELSE
            run_ddl('CREATE TABLE ' || p_table_name, p_ddl);
        END IF;
    END;

    PROCEDURE create_index_if_missing(p_index_name IN VARCHAR2, p_table_name IN VARCHAR2, p_ddl IN CLOB) IS
    BEGIN
        IF NOT table_exists(p_table_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || p_index_name || ' table is missing.');
        ELSIF index_exists(p_index_name) THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INDEX ' || p_index_name || ' already exists.');
        ELSE
            run_ddl('CREATE INDEX ' || p_index_name, p_ddl);
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

    PROCEDURE reorder_auth_session_columns IS
        TYPE t_col_list IS TABLE OF VARCHAR2(128);
        v_cols t_col_list := t_col_list(
            'SESSION_TOKEN_HASH',
            'USER_ID',
            'TARGET_CONNECTION_ID',
            'CREATED_AT',
            'LAST_SEEN_AT',
            'EXPIRES_AT',
            'REVOKED_AT'
        );
        v_current_order VARCHAR2(32767);
        v_expected_order VARCHAR2(32767);
    BEGIN
        IF NOT table_exists('INIT$_TB_AUTH_SESSION') THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] REORDER INIT$_TB_AUTH_SESSION table is missing.');
            RETURN;
        END IF;

        FOR i IN 1 .. v_cols.COUNT LOOP
            IF NOT column_exists('INIT$_TB_AUTH_SESSION', v_cols(i)) THEN
                DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_AUTH_SESSION column order refresh skipped. Missing column: ' || v_cols(i));
                RETURN;
            END IF;
            v_expected_order := v_expected_order || CASE WHEN i > 1 THEN ',' END || v_cols(i);
        END LOOP;

        SELECT LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY COLUMN_ID)
          INTO v_current_order
          FROM USER_TAB_COLS
         WHERE TABLE_NAME = 'INIT$_TB_AUTH_SESSION'
           AND HIDDEN_COLUMN = 'NO'
           AND COLUMN_NAME IN (
               'SESSION_TOKEN_HASH',
               'USER_ID',
               'TARGET_CONNECTION_ID',
               'CREATED_AT',
               'LAST_SEEN_AT',
               'EXPIRES_AT',
               'REVOKED_AT'
           );

        IF v_current_order = v_expected_order THEN
            DBMS_OUTPUT.PUT_LINE('[SKIP] INIT$_TB_AUTH_SESSION column display order already matches.');
            RETURN;
        END IF;

        -- Keep SESSION_TOKEN_HASH visible so the table never has zero visible columns.
        IF column_exists('INIT$_TB_AUTH_SESSION', v_cols(1)) THEN
            set_column_visibility('INIT$_TB_AUTH_SESSION', v_cols(1), 'VISIBLE');
        END IF;

        FOR i IN 2 .. v_cols.COUNT LOOP
            IF column_exists('INIT$_TB_AUTH_SESSION', v_cols(i)) THEN
                set_column_visibility('INIT$_TB_AUTH_SESSION', v_cols(i), 'INVISIBLE');
            END IF;
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            IF column_exists('INIT$_TB_AUTH_SESSION', v_cols(i)) THEN
                set_column_visibility('INIT$_TB_AUTH_SESSION', v_cols(i), 'VISIBLE');
            END IF;
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_AUTH_SESSION column display order refreshed.');
    END;
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT_SYSTEM ALTER START ===');

    create_table_if_missing('INIT$_TB_AUTH_SESSION', q'[
CREATE TABLE "INIT$_TB_AUTH_SESSION" (
    "SESSION_TOKEN_HASH" VARCHAR2(128 BYTE) NOT NULL ENABLE,
    "USER_ID" NUMBER NOT NULL ENABLE,
    "TARGET_CONNECTION_ID" NUMBER,
    "CREATED_AT" TIMESTAMP (6) DEFAULT LOCALTIMESTAMP NOT NULL ENABLE,
    "LAST_SEEN_AT" TIMESTAMP (6) DEFAULT LOCALTIMESTAMP NOT NULL ENABLE,
    "EXPIRES_AT" TIMESTAMP (6) NOT NULL ENABLE,
    "REVOKED_AT" TIMESTAMP (6),
    CONSTRAINT "INIT$_PK_AUTH_SESSION" PRIMARY KEY ("SESSION_TOKEN_HASH"),
    CONSTRAINT "INIT$_FK_AUTH_SESSION_USER" FOREIGN KEY ("USER_ID")
        REFERENCES "INIT$_TB_USER" ("USER_ID") ON DELETE CASCADE ENABLE
)
]');

    create_index_if_missing(
        'INIT$_IX_AUTH_SESSION_USER',
        'INIT$_TB_AUTH_SESSION',
        'CREATE INDEX "INIT$_IX_AUTH_SESSION_USER" ON "INIT$_TB_AUTH_SESSION" ("USER_ID", "EXPIRES_AT")'
    );

    modify_column_default_not_null('INIT$_TB_AUTH_SESSION', 'CREATED_AT', 'LOCALTIMESTAMP');
    modify_column_default_not_null('INIT$_TB_AUTH_SESSION', 'LAST_SEEN_AT', 'LOCALTIMESTAMP');
    reorder_auth_session_columns;

    DBMS_OUTPUT.PUT_LINE('=== INIT_SYSTEM ALTER END ===');
END;
/
