SET SERVEROUTPUT ON;

-- Execute this entire script on the SAME Target DB/account selected in the app.
-- Re-running it is additive: existing columns and result rows are preserved.
SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB_NAME
     , SYS_CONTEXT('USERENV', 'SESSION_USER') AS SESSION_USER
     , SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS CURRENT_SCHEMA
  FROM DUAL
;

-- Mixed pattern v2: preserve the shared rule/violation tables and legacy histories.
-- Run manually in the Target DB schema after the core INIT tables are installed.
DECLARE
    v_table_count NUMBER;

    PROCEDURE add_pattern_column(p_name IN VARCHAR2, p_type IN VARCHAR2) IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_TAB_COLUMNS
         WHERE TABLE_NAME = 'INIT$_TB_RULEDISC_ASSOC_SUM'
           AND COLUMN_NAME = p_name;
        IF v_count = 0 THEN
            EXECUTE IMMEDIATE 'ALTER TABLE INIT$_TB_RULEDISC_ASSOC_SUM ADD (' || p_name || ' ' || p_type || ')';
            DBMS_OUTPUT.PUT_LINE('Added INIT$_TB_RULEDISC_ASSOC_SUM.' || p_name);
        END IF;
    END;
BEGIN
    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TABLES
     WHERE TABLE_NAME = 'INIT$_TB_RULEDISC_ASSOC_SUM';
    IF v_table_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Install the core INIT_TARGET_DDL.sql tables before the mixed pattern extension.');
    END IF;
    add_pattern_column('CONDITION_JSON', 'CLOB');
    add_pattern_column('RESULT_JSON', 'CLOB');
    add_pattern_column('VALIDATION_JSON', 'CLOB');
    add_pattern_column('RESULT_KIND', 'VARCHAR2(20 BYTE)');
    add_pattern_column('VIOLATION_COUNT', 'NUMBER');

    SELECT COUNT(*)
      INTO v_table_count
      FROM USER_TAB_COLUMNS
     WHERE 1=1
       AND TABLE_NAME = 'INIT$_TB_RULEDISC_ASSOC_SUM'
       AND COLUMN_NAME IN ('CONDITION_JSON', 'RESULT_JSON', 'VALIDATION_JSON', 'RESULT_KIND', 'VIOLATION_COUNT');
    IF v_table_count <> 5 THEN
        RAISE_APPLICATION_ERROR(-20002, 'Mixed pattern schema verification failed: not all five rule columns are installed.');
    END IF;
    DBMS_OUTPUT.PUT_LINE('[OK] Mixed pattern schema: all 5 rule columns installed in ' || USER);
END;
/

COMMENT ON COLUMN INIT$_TB_RULEDISC_ASSOC_SUM.CONDITION_JSON IS 'Versioned pattern antecedent AST; NULL for legacy summaries';
COMMENT ON COLUMN INIT$_TB_RULEDISC_ASSOC_SUM.RESULT_JSON IS 'Versioned consequent AST: equality, numeric range or formula with tolerance; never an anomaly label';
COMMENT ON COLUMN INIT$_TB_RULEDISC_ASSOC_SUM.VALIDATION_JSON IS 'Training, calibration and selection-validation metrics with cohort metadata; not full-source detection counts';
COMMENT ON COLUMN INIT$_TB_RULEDISC_ASSOC_SUM.RESULT_KIND IS 'Pattern consequent semantics: VALUE, RANGE or FORMULA; NULL for legacy summaries';
COMMENT ON COLUMN INIT$_TB_RULEDISC_ASSOC_SUM.VIOLATION_COUNT IS 'Whole-source rows satisfying IF and failing THEN; includes NULL consequent failures';
