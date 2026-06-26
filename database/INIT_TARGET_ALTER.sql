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
            'OWNER',
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
               'OWNER',
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

        -- Keep OWNER visible so the table never has zero visible columns.
        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_ASSOC_RULE_SUMMARY', v_cols(i), 'INVISIBLE');
        END LOOP;

        FOR i IN 2 .. v_cols.COUNT LOOP
            set_column_visibility('INIT$_TB_ASSOC_RULE_SUMMARY', v_cols(i), 'VISIBLE');
        END LOOP;

        DBMS_OUTPUT.PUT_LINE('[OK] INIT$_TB_ASSOC_RULE_SUMMARY column display order refreshed.');
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
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'RULE_SOURCE', '"RULE_SOURCE" VARCHAR2(80 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'CONDITION_COLUMN', '"CONDITION_COLUMN" VARCHAR2(128 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'CONDITION_VALUE', '"CONDITION_VALUE" VARCHAR2(4000 BYTE)');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'SUPPORT_COUNT', '"SUPPORT_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'CONDITION_TOTAL_COUNT', '"CONDITION_TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'RESULT_TOTAL_COUNT', '"RESULT_TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_ASSOC_RULE_SUMMARY', 'TOTAL_COUNT', '"TOTAL_COUNT" NUMBER');
    add_column_if_missing('INIT$_TB_FLOW_WORK_NODE', 'USE_YN', '"USE_YN" CHAR(1 BYTE) DEFAULT ''Y'' NOT NULL ENABLE');

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
        run_ddl('COMMENT INIT$_TB_ASSOC_RULE_SUMMARY', q'[COMMENT ON TABLE "INIT$_TB_ASSOC_RULE_SUMMARY" IS 'Association model rule summary for fast drill-down analysis']');
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
    ON "INIT$_TB_ASSOC_RULE_SUMMARY" ("OWNER", "MODEL_NAME", "CONDITION_COUNT", "RULE_CONFIDENCE", "RULE_LIFT", "RULE_SUPPORT")
]');

    create_index_if_missing('IX_INIT$_TB_ASSOC_RULE_SUMMARY_02', 'INIT$_TB_ASSOC_RULE_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_ASSOC_RULE_SUMMARY_02"
    ON "INIT$_TB_ASSOC_RULE_SUMMARY" ("OWNER", "MODEL_NAME", "RESULT_COLUMN", "RESULT_HAS_VALUE_YN")
]');

    create_index_if_missing('IX_INIT$_TB_ASSOC_RULE_SUMMARY_03', 'INIT$_TB_ASSOC_RULE_SUMMARY', q'[
CREATE INDEX "IX_INIT$_TB_ASSOC_RULE_SUMMARY_03"
    ON "INIT$_TB_ASSOC_RULE_SUMMARY" ("OWNER", "MODEL_NAME", "MODEL_TYPE", "RULE_SOURCE")
]');

    create_table_if_missing('INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE TABLE "INIT$_TB_RULE_VIOLATION_RESULT" (
    "VIOLATION_ID" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL ENABLE,
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
    CONSTRAINT "PK_INIT$_TB_RULE_VIOLATION" PRIMARY KEY ("VIOLATION_ID")
)]');

    IF table_exists('INIT$_TB_RULE_VIOLATION_RESULT') THEN
        run_ddl('COMMENT INIT$_TB_RULE_VIOLATION_RESULT', q'[COMMENT ON TABLE "INIT$_TB_RULE_VIOLATION_RESULT" IS 'Rows that violate discovered human-readable rules']');
        run_ddl('COMMENT INIT$_TB_RULE_VIOLATION_RESULT.VIOLATION_SCORE', q'[COMMENT ON COLUMN "INIT$_TB_RULE_VIOLATION_RESULT"."VIOLATION_SCORE" IS 'Rule confidence/lift based priority score']');
    END IF;

    create_index_if_missing('IX_INIT$_TB_RULE_VIOLATION_01', 'INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_RULE_VIOLATION_01"
    ON "INIT$_TB_RULE_VIOLATION_RESULT" ("TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "VIOLATION_SCORE")
]');

    create_index_if_missing('IX_INIT$_TB_RULE_VIOLATION_02', 'INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_RULE_VIOLATION_02"
    ON "INIT$_TB_RULE_VIOLATION_RESULT" ("RULE_OWNER", "MODEL_NAME", "RULE_ID")
]');

    create_index_if_missing('IX_INIT$_TB_RULE_VIOLATION_03', 'INIT$_TB_RULE_VIOLATION_RESULT', q'[
CREATE INDEX "IX_INIT$_TB_RULE_VIOLATION_03"
    ON "INIT$_TB_RULE_VIOLATION_RESULT" ("TARGET_OWNER", "TARGET_TABLE", "CASE_ID")
]');

    IF table_exists('INIT$_TB_FLOW_WORK_NODE') THEN
        run_ddl('COMMENT INIT$_TB_FLOW_WORK_NODE.USE_YN', q'[COMMENT ON COLUMN "INIT$_TB_FLOW_WORK_NODE"."USE_YN" IS 'Node execution use Y/N. N keeps graph links but skips the node during execution']');
    END IF;

    reorder_assoc_rule_summary_columns;

    DBMS_OUTPUT.PUT_LINE('=== INIT_TARGET ALTER END ===');
END;
/
