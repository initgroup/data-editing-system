SET SERVEROUTPUT ON;

-- Mixed XAI scenario: manual, additive installation for the Target DB schema.
-- Existing source tables, legacy rules and FLOW/JOB histories are preserved.
-- Also embedded in INIT_TARGET_DDL.sql and INIT_TARGET_ALTER.sql.
DECLARE
    PROCEDURE create_if_missing(p_name IN VARCHAR2, p_sql IN CLOB) IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM USER_TABLES
         WHERE TABLE_NAME = p_name;
        IF v_count = 0 THEN
            EXECUTE IMMEDIATE p_sql;
            DBMS_OUTPUT.PUT_LINE('Created ' || p_name);
        ELSE
            DBMS_OUTPUT.PUT_LINE('Already installed: ' || p_name);
        END IF;
    END;
BEGIN
    create_if_missing('INIT$_TB_XAI_RUN', q'~
CREATE TABLE INIT$_TB_XAI_RUN (
    RUN_SOURCE_TYPE VARCHAR2(20) NOT NULL
  , RUN_ID NUMBER NOT NULL
  , TARGET_OWNER VARCHAR2(128) NOT NULL
  , TARGET_TABLE VARCHAR2(128) NOT NULL
  , SUMMARY_JSON CLOB NOT NULL
  , CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
  , UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
  , CONSTRAINT PK_INIT_XAI_RUN PRIMARY KEY (RUN_SOURCE_TYPE, RUN_ID, TARGET_OWNER, TARGET_TABLE)
  , CONSTRAINT CK_INIT_XAI_RUN_SRC CHECK (RUN_SOURCE_TYPE IN ('FLOW_WORK', 'DATA_WORK'))
  , CONSTRAINT CK_INIT_XAI_RUN_JSON CHECK (SUMMARY_JSON IS JSON)
)~');

    create_if_missing('INIT$_TB_RULEDISC_XAI', q'~
CREATE TABLE INIT$_TB_RULEDISC_XAI (
    RUN_SOURCE_TYPE VARCHAR2(20) NOT NULL
  , RUN_ID NUMBER NOT NULL
  , TARGET_OWNER VARCHAR2(128) NOT NULL
  , TARGET_TABLE VARCHAR2(128) NOT NULL
  , RULE_ID VARCHAR2(128) NOT NULL
  , RULE_TEXT CLOB NOT NULL
  , CONDITION_JSON CLOB NOT NULL
  , SUPPORT_COUNT NUMBER NOT NULL
  , ANOMALY_COUNT NUMBER NOT NULL
  , RULE_PURITY NUMBER
  , MATCH_COUNT NUMBER
  , VALIDATION_JSON CLOB
  , STATUS VARCHAR2(20) DEFAULT 'CANDIDATE' NOT NULL
  , CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
  , CONSTRAINT PK_INIT_RULEDISC_XAI PRIMARY KEY (RUN_SOURCE_TYPE, RUN_ID, TARGET_OWNER, TARGET_TABLE, RULE_ID)
  , CONSTRAINT CK_INIT_XAI_PURITY CHECK (RULE_PURITY BETWEEN 0 AND 1)
  , CONSTRAINT CK_INIT_XAI_CONDITION CHECK (CONDITION_JSON IS JSON)
  , CONSTRAINT CK_INIT_XAI_VALIDATION CHECK (VALIDATION_JSON IS JSON)
)~');

    create_if_missing('INIT$_TB_RULEVIOL_XAI', q'~
CREATE TABLE INIT$_TB_RULEVIOL_XAI (
    RUN_SOURCE_TYPE VARCHAR2(20) NOT NULL
  , RUN_ID NUMBER NOT NULL
  , TARGET_OWNER VARCHAR2(128) NOT NULL
  , TARGET_TABLE VARCHAR2(128) NOT NULL
  , DISCOVERY_RUN_ID NUMBER NOT NULL
  , RULE_ID VARCHAR2(128) NOT NULL
  , CASE_ID VARCHAR2(400) NOT NULL
  , ANOMALY_SCORE NUMBER
  , RULE_PURITY NUMBER
  , ROW_DATA_JSON CLOB
  , STATUS VARCHAR2(20) DEFAULT 'CANDIDATE' NOT NULL
  , CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
  , CONSTRAINT PK_INIT_RULEVIOL_XAI PRIMARY KEY (RUN_SOURCE_TYPE, RUN_ID, TARGET_OWNER, TARGET_TABLE, RULE_ID, CASE_ID)
  , CONSTRAINT CK_INIT_XAI_ROW_JSON CHECK (ROW_DATA_JSON IS JSON)
)~');
END;
/

COMMENT ON TABLE INIT$_TB_XAI_RUN IS 'Unified editing and mixed pattern diagnostics, with legacy anomaly results identified by algorithm version';
COMMENT ON TABLE INIT$_TB_RULEDISC_XAI IS 'Surrogate anomaly candidate predicates; not confirmed business editing rules';
COMMENT ON COLUMN INIT$_TB_RULEDISC_XAI.RULE_PURITY IS 'Isolation Forest anomaly fraction among matched sampled rows; not business rule confidence';
COMMENT ON COLUMN INIT$_TB_RULEDISC_XAI.MATCH_COUNT IS 'Whole-source candidate rule matches from the last detection; may overlap other rules';
COMMENT ON TABLE INIT$_TB_RULEVIOL_XAI IS 'Bounded candidate row preview from surrogate predicates; no source updates';
COMMENT ON COLUMN INIT$_TB_RULEVIOL_XAI.ANOMALY_SCORE IS 'NULL when not rescored by Isolation Forest; do not substitute rule purity';
COMMENT ON COLUMN INIT$_TB_RULEVIOL_XAI.CASE_ID IS 'Source ROWID snapshot; not a stable key after source table rebuild';

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
