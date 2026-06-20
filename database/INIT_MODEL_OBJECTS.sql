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
    v_version CONSTANT VARCHAR2(50) := '1.0.5';
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL OBJECTS DEPLOY START ===');
    DBMS_OUTPUT.PUT_LINE('[INFO] Bundle version: ' || v_version);
    DBMS_OUTPUT.PUT_LINE('[INFO] Add CREATE OR REPLACE model objects to database/INIT_MODEL_OBJECTS.sql.');
    DBMS_OUTPUT.PUT_LINE('[INFO] Deploy status is recorded by M91001 after execution.');
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL OBJECTS DEPLOY END ===');
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_APRIORI_ASSOC_MODEL" (
    p_model_name          IN VARCHAR2 DEFAULT 'TB_DATA002_SURVEY_ASSOC_MODEL',
    p_data_query          IN VARCHAR2 DEFAULT 'SELECT * FROM TB_DATA002',
    p_case_id_column_name IN VARCHAR2 DEFAULT 'RNUM',
    p_min_support         IN NUMBER   DEFAULT 0.1,
    p_min_confidence      IN NUMBER   DEFAULT 0.6,
    p_max_rule_length     IN NUMBER   DEFAULT 4,
    p_drop_existing_yn    IN VARCHAR2 DEFAULT 'Y'
) AUTHID CURRENT_USER IS
    v_setlist       DBMS_DATA_MINING.SETTING_LIST;
    v_model_name    VARCHAR2(128);
    v_case_id_col   VARCHAR2(128);
    v_model_count   NUMBER;
    v_drop_existing VARCHAR2(1);
BEGIN
    v_model_name := UPPER(TRIM(p_model_name));
    v_case_id_col := UPPER(TRIM(p_case_id_column_name));
    v_drop_existing := CASE WHEN UPPER(TRIM(NVL(p_drop_existing_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20201, 'Invalid model_name parameter.');
    END IF;

    IF p_data_query IS NULL OR TRIM(p_data_query) IS NULL THEN
        RAISE_APPLICATION_ERROR(-20202, 'data_query parameter is required.');
    END IF;

    IF NOT REGEXP_LIKE(v_case_id_col, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20203, 'Invalid case_id_column_name parameter.');
    END IF;

    SELECT COUNT(*)
      INTO v_model_count
      FROM USER_MINING_MODELS
     WHERE MODEL_NAME = v_model_name;

    IF v_model_count > 0 THEN
        IF v_drop_existing = 'Y' THEN
            DBMS_DATA_MINING.DROP_MODEL(v_model_name);
            DBMS_OUTPUT.PUT_LINE('[INFO] Dropped existing model: ' || v_model_name);
        ELSE
            RAISE_APPLICATION_ERROR(-20204, 'Mining model already exists: ' || v_model_name);
        END IF;
    END IF;

    v_setlist(DBMS_DATA_MINING.ALGO_NAME) := 'ALGO_APRIORI_ASSOCIATION_RULES';
    v_setlist('PREP_AUTO') := 'ON';
    v_setlist(DBMS_DATA_MINING.ASSO_MIN_SUPPORT) := TO_CHAR(NVL(p_min_support, 0.1));
    v_setlist(DBMS_DATA_MINING.ASSO_MIN_CONFIDENCE) := TO_CHAR(NVL(p_min_confidence, 0.6));
    v_setlist(DBMS_DATA_MINING.ASSO_MAX_RULE_LENGTH) := TO_CHAR(NVL(p_max_rule_length, 4));

    DBMS_DATA_MINING.CREATE_MODEL2(
        MODEL_NAME          => v_model_name,
        MINING_FUNCTION     => DBMS_DATA_MINING.ASSOCIATION,
        DATA_QUERY          => p_data_query,
        SET_LIST            => v_setlist,
        CASE_ID_COLUMN_NAME => v_case_id_col
    );

    DBMS_OUTPUT.PUT_LINE('[OK] Apriori association model created: ' || v_model_name);
    DBMS_OUTPUT.PUT_LINE('[INFO] Check generated detail views with USER_OBJECTS LIKE DM$V%' || v_model_name);
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_DM_MODEL_VIEW_LIST" (
    p_model_name IN VARCHAR2,
    p_result     OUT SYS_REFCURSOR
) AUTHID CURRENT_USER IS
    v_model_name VARCHAR2(128);
BEGIN
    v_model_name := UPPER(TRIM(p_model_name));

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20211, 'Invalid model_name parameter.');
    END IF;

    OPEN p_result FOR
        WITH VIEW_TYPES AS (
            SELECT 'VA' AS VIEW_TYPE, 'Attribute/detail view' AS DESCRIPTION FROM DUAL UNION ALL
            SELECT 'VG', 'Global/detail view' FROM DUAL UNION ALL
            SELECT 'VI', 'Itemset/detail view' FROM DUAL UNION ALL
            SELECT 'VN', 'Node/detail view' FROM DUAL UNION ALL
            SELECT 'VP', 'Pattern/partition/detail view' FROM DUAL UNION ALL
            SELECT 'VR', 'Rule/detail view' FROM DUAL UNION ALL
            SELECT 'VT', 'Transformation/detail view' FROM DUAL
        )
        SELECT V.VIEW_TYPE,
               'DM$' || V.VIEW_TYPE || v_model_name AS VIEW_NAME,
               V.DESCRIPTION,
               O.OBJECT_TYPE,
               CASE WHEN O.OBJECT_NAME IS NULL THEN 'N' ELSE 'Y' END AS EXISTS_YN
          FROM VIEW_TYPES V
          LEFT JOIN USER_OBJECTS O
            ON O.OBJECT_NAME = 'DM$' || V.VIEW_TYPE || v_model_name
         ORDER BY V.VIEW_TYPE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_DM_MODEL_VIEW_OPEN" (
    p_model_name IN VARCHAR2,
    p_view_type  IN VARCHAR2 DEFAULT 'VR',
    p_result     OUT SYS_REFCURSOR
) AUTHID CURRENT_USER IS
    v_model_name VARCHAR2(128);
    v_view_type  VARCHAR2(2);
    v_view_name  VARCHAR2(261);
    v_count      NUMBER;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;
BEGIN
    v_model_name := UPPER(TRIM(p_model_name));
    v_view_type := UPPER(TRIM(p_view_type));

    IF NOT REGEXP_LIKE(v_model_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20221, 'Invalid model_name parameter.');
    END IF;

    IF v_view_type NOT IN ('VA', 'VG', 'VI', 'VN', 'VP', 'VR', 'VT') THEN
        RAISE_APPLICATION_ERROR(-20222, 'Invalid view_type parameter. Use VA, VG, VI, VN, VP, VR, or VT.');
    END IF;

    v_view_name := 'DM$' || v_view_type || v_model_name;

    SELECT COUNT(*)
      INTO v_count
      FROM USER_OBJECTS
     WHERE OBJECT_NAME = v_view_name
       AND OBJECT_TYPE IN ('VIEW', 'TABLE');

    IF v_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20223, 'Model detail object was not found: ' || v_view_name);
    END IF;

    OPEN p_result FOR 'SELECT * FROM ' || quote_name(v_view_name);
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_CAT_CORR_ANALYZE" (
    p_owner       IN VARCHAR2,
    p_tableName   IN VARCHAR2,
    p_min_pvalue  IN NUMBER DEFAULT 0.05,
    p_min_cramer  IN NUMBER DEFAULT 0.3,
    p_min_avg_v   IN NUMBER DEFAULT 0.5,
    p_sample_rows IN NUMBER DEFAULT 100000,
    p_max_distinct IN NUMBER DEFAULT 100,
    p_max_columns IN NUMBER DEFAULT 80
) AUTHID CURRENT_USER IS
    TYPE t_column_list IS TABLE OF VARCHAR2(128);

    v_owner       VARCHAR2(128);
    v_table_name  VARCHAR2(128);
    v_cols        t_column_list := t_column_list();
    v_col_a       VARCHAR2(128);
    v_col_b       VARCHAR2(128);
    v_sql         CLOB;
    v_row_count   NUMBER;
    v_df          NUMBER;
    v_chi_square  NUMBER;
    v_p_value     NUMBER;
    v_cramers_v   NUMBER;
    v_pass_yn     CHAR(1);
    v_sample_rows NUMBER;
    v_max_distinct NUMBER;
    v_max_columns NUMBER;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;

    FUNCTION ln_gamma(p_x IN NUMBER) RETURN NUMBER IS
        v_tmp NUMBER;
        v_ser NUMBER := 1.000000000190015;
        v_y   NUMBER := p_x;
        TYPE t_coef IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
        c t_coef;
    BEGIN
        c(1) := 76.18009172947146;
        c(2) := -86.50532032941677;
        c(3) := 24.01409824083091;
        c(4) := -1.231739572450155;
        c(5) := 0.001208650973866179;
        c(6) := -0.000005395239384953;
        v_tmp := p_x + 5.5;
        v_tmp := v_tmp - (p_x + 0.5) * LN(v_tmp);
        FOR i IN 1 .. 6 LOOP
            v_y := v_y + 1;
            v_ser := v_ser + c(i) / v_y;
        END LOOP;
        RETURN -v_tmp + LN(2.5066282746310005 * v_ser / p_x);
    END;

    FUNCTION gamma_q(p_a IN NUMBER, p_x IN NUMBER) RETURN NUMBER IS
        v_itmax CONSTANT PLS_INTEGER := 100;
        v_eps   CONSTANT NUMBER := 3.0e-7;
        v_fpmin CONSTANT NUMBER := 1.0e-30;
        v_gln   NUMBER;
        v_ap    NUMBER;
        v_sum   NUMBER;
        v_del   NUMBER;
        v_b     NUMBER;
        v_c     NUMBER;
        v_d     NUMBER;
        v_h     NUMBER;
        v_an    NUMBER;
    BEGIN
        IF p_a <= 0 OR p_x < 0 THEN
            RETURN NULL;
        END IF;
        IF p_x = 0 THEN
            RETURN 1;
        END IF;

        v_gln := ln_gamma(p_a);

        IF p_x < p_a + 1 THEN
            v_ap := p_a;
            v_sum := 1 / p_a;
            v_del := v_sum;
            FOR n IN 1 .. v_itmax LOOP
                v_ap := v_ap + 1;
                v_del := v_del * p_x / v_ap;
                v_sum := v_sum + v_del;
                EXIT WHEN ABS(v_del) < ABS(v_sum) * v_eps;
            END LOOP;
            RETURN GREATEST(0, LEAST(1, 1 - v_sum * EXP(-p_x + p_a * LN(p_x) - v_gln)));
        END IF;

        v_b := p_x + 1 - p_a;
        v_c := 1 / v_fpmin;
        v_d := 1 / v_b;
        v_h := v_d;
        FOR i IN 1 .. v_itmax LOOP
            v_an := -i * (i - p_a);
            v_b := v_b + 2;
            v_d := v_an * v_d + v_b;
            IF ABS(v_d) < v_fpmin THEN
                v_d := v_fpmin;
            END IF;
            v_c := v_b + v_an / v_c;
            IF ABS(v_c) < v_fpmin THEN
                v_c := v_fpmin;
            END IF;
            v_d := 1 / v_d;
            v_del := v_d * v_c;
            v_h := v_h * v_del;
            EXIT WHEN ABS(v_del - 1) < v_eps;
        END LOOP;
        RETURN GREATEST(0, LEAST(1, EXP(-p_x + p_a * LN(p_x) - v_gln) * v_h));
    END;

    FUNCTION chi_square_pvalue(p_chi_square IN NUMBER, p_df IN NUMBER) RETURN NUMBER IS
    BEGIN
        IF p_chi_square IS NULL OR p_df IS NULL OR p_df <= 0 THEN
            RETURN NULL;
        END IF;
        RETURN gamma_q(p_df / 2, p_chi_square / 2);
    END;
BEGIN
    v_owner := UPPER(TRIM(p_owner));
    v_table_name := UPPER(TRIM(p_tableName));
    v_sample_rows := CASE WHEN p_sample_rows IS NULL OR p_sample_rows <= 0 THEN NULL ELSE p_sample_rows END;
    v_max_distinct := CASE WHEN p_max_distinct IS NULL OR p_max_distinct <= 0 THEN 100 ELSE p_max_distinct END;
    v_max_columns := CASE WHEN p_max_columns IS NULL OR p_max_columns <= 0 THEN 80 ELSE p_max_columns END;

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20101, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20102, 'Invalid tableName parameter.');
    END IF;

    DELETE FROM "INIT$_TB_CAT_CORR_SUMMARY"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name;

    DELETE FROM "INIT$_TB_CAT_CORR_PAIR"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name;

    SELECT COLUMN_NAME
      BULK COLLECT INTO v_cols
      FROM (
            SELECT COLUMN_NAME
              FROM (
                    SELECT COLUMN_NAME,
                           MIN(NVL(COLUMN_ID, 999999)) AS COLUMN_ID
                      FROM "INIT$_TB_PREDICTED_TYPE"
                     WHERE "OWNER" = v_owner
                       AND "TABLE_NAME" = v_table_name
                       AND "MODL_PREDICTED_TYPE" LIKE '%범주형'
                     GROUP BY COLUMN_NAME
                     ORDER BY COLUMN_ID, COLUMN_NAME
                   )
             WHERE ROWNUM <= v_max_columns
           );

    IF v_cols.COUNT < 2 THEN
        SELECT COLUMN_NAME
          BULK COLLECT INTO v_cols
          FROM (
                SELECT COLUMN_NAME
                  FROM ALL_TAB_COLUMNS
                 WHERE OWNER = v_owner
                   AND TABLE_NAME = v_table_name
                   AND COLUMN_NAME <> 'FILE_ROW_NO'
                   AND DATA_TYPE IN ('CHAR', 'NCHAR', 'VARCHAR2', 'NVARCHAR2')
                   AND NVL(NUM_DISTINCT, 0) BETWEEN 2 AND v_max_distinct
                 ORDER BY COLUMN_ID
               )
         WHERE ROWNUM <= v_max_columns;
    END IF;

    FOR i IN 1 .. v_cols.COUNT LOOP
        FOR j IN i + 1 .. v_cols.COUNT LOOP
            v_col_a := v_cols(i);
            v_col_b := v_cols(j);

            v_sql := '
WITH BASE AS (
    SELECT TO_CHAR(A_RAW) AS A_VAL,
           TO_CHAR(B_RAW) AS B_VAL
      FROM (
            SELECT ' || quote_name(v_col_a) || ' AS A_RAW,
                   ' || quote_name(v_col_b) || ' AS B_RAW
              FROM ' || quote_name(v_owner) || '.' || quote_name(v_table_name) || '
             WHERE ' || quote_name(v_col_a) || ' IS NOT NULL
               AND ' || quote_name(v_col_b) || ' IS NOT NULL
               AND (:sampleRows IS NULL OR ROWNUM <= :sampleRows)
           )
),
OBS AS (
    SELECT A_VAL, B_VAL, COUNT(*) AS OBS_CNT
      FROM BASE
     GROUP BY A_VAL, B_VAL
),
RT AS (
    SELECT A_VAL, SUM(OBS_CNT) AS ROW_CNT
      FROM OBS
     GROUP BY A_VAL
),
CT AS (
    SELECT B_VAL, SUM(OBS_CNT) AS COL_CNT
      FROM OBS
     GROUP BY B_VAL
),
TOT AS (
    SELECT COUNT(*) AS TOTAL_CNT,
           COUNT(DISTINCT A_VAL) AS R_CNT,
           COUNT(DISTINCT B_VAL) AS C_CNT
      FROM BASE
),
CHI AS (
    SELECT SUM(
               CASE
                   WHEN (RT.ROW_CNT * CT.COL_CNT / NULLIF(TOT.TOTAL_CNT, 0)) > 0
                   THEN POWER(OBS.OBS_CNT - (RT.ROW_CNT * CT.COL_CNT / TOT.TOTAL_CNT), 2)
                        / (RT.ROW_CNT * CT.COL_CNT / TOT.TOTAL_CNT)
                   ELSE 0
               END
           ) AS CHI_SQUARE
      FROM OBS
      JOIN RT
        ON RT.A_VAL = OBS.A_VAL
      JOIN CT
        ON CT.B_VAL = OBS.B_VAL
      CROSS JOIN TOT
)
SELECT TOT.TOTAL_CNT,
       (TOT.R_CNT - 1) * (TOT.C_CNT - 1) AS DF,
       CASE
           WHEN TOT.TOTAL_CNT > 0 AND TOT.R_CNT > 1 AND TOT.C_CNT > 1
           THEN CHI.CHI_SQUARE
           ELSE NULL
       END AS CHI_SQUARE,
       CASE
           WHEN TOT.TOTAL_CNT > 0 AND LEAST(TOT.R_CNT - 1, TOT.C_CNT - 1) > 0
           THEN SQRT(CHI.CHI_SQUARE / (TOT.TOTAL_CNT * LEAST(TOT.R_CNT - 1, TOT.C_CNT - 1)))
           ELSE NULL
       END AS CRAMERS_V
  FROM TOT
 CROSS JOIN CHI';

            EXECUTE IMMEDIATE v_sql
               INTO v_row_count, v_df, v_chi_square, v_cramers_v
              USING v_sample_rows, v_sample_rows;

            v_p_value := chi_square_pvalue(v_chi_square, v_df);
            v_pass_yn := CASE
                             WHEN v_p_value IS NOT NULL
                              AND v_p_value < NVL(p_min_pvalue, 0.05)
                              AND NVL(v_cramers_v, 0) > NVL(p_min_cramer, 0.3)
                             THEN 'Y'
                             ELSE 'N'
                         END;

            INSERT INTO "INIT$_TB_CAT_CORR_PAIR" (
                "OWNER",
                "TABLE_NAME",
                "COL_A",
                "COL_B",
                "ROW_COUNT",
                "DF",
                "CHI_SQUARE",
                "P_VALUE",
                "CRAMERS_V",
                "PASS_YN",
                "CREATE_DT"
            ) VALUES (
                v_owner,
                v_table_name,
                v_col_a,
                v_col_b,
                v_row_count,
                v_df,
                v_chi_square,
                v_p_value,
                v_cramers_v,
                v_pass_yn,
                SYSDATE
            );
        END LOOP;
    END LOOP;

    INSERT INTO "INIT$_TB_CAT_CORR_SUMMARY" (
        "OWNER",
        "TABLE_NAME",
        "COLUMN_NAME",
        "PAIR_COUNT",
        "PASS_PAIR_COUNT",
        "AVG_CRAMERS_V",
        "MAX_CRAMERS_V",
        "RANK_NO",
        "SELECTED_YN",
        "CREATE_DT"
    )
    WITH PAIRS AS (
        SELECT COL_A AS COLUMN_NAME, CRAMERS_V, PASS_YN
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
        UNION ALL
        SELECT COL_B AS COLUMN_NAME, CRAMERS_V, PASS_YN
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
    ),
    SUMMARY AS (
        SELECT COLUMN_NAME,
               COUNT(*) AS PAIR_COUNT,
               SUM(CASE WHEN PASS_YN = 'Y' THEN 1 ELSE 0 END) AS PASS_PAIR_COUNT,
               AVG(CASE WHEN PASS_YN = 'Y' THEN CRAMERS_V END) AS AVG_CRAMERS_V,
               MAX(CASE WHEN PASS_YN = 'Y' THEN CRAMERS_V END) AS MAX_CRAMERS_V
          FROM PAIRS
         GROUP BY COLUMN_NAME
    )
    SELECT v_owner,
           v_table_name,
           COLUMN_NAME,
           PAIR_COUNT,
           PASS_PAIR_COUNT,
           AVG_CRAMERS_V,
           MAX_CRAMERS_V,
           ROW_NUMBER() OVER (ORDER BY AVG_CRAMERS_V DESC NULLS LAST, COLUMN_NAME) AS RANK_NO,
           CASE WHEN NVL(AVG_CRAMERS_V, 0) >= NVL(p_min_avg_v, 0.5) THEN 'Y' ELSE 'N' END AS SELECTED_YN,
           SYSDATE
      FROM SUMMARY;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_CAT_CORR_ANALYZE analyzed '
        || v_cols.COUNT || ' categorical columns for ' || v_owner || '.' || v_table_name
        || ' (sample_rows=' || NVL(TO_CHAR(v_sample_rows), 'ALL')
        || ', max_distinct=' || v_max_distinct
        || ', max_columns=' || v_max_columns || ')');
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_PREDICTED_TYPE" (
    p_owner              IN VARCHAR2,
    p_tableName          IN VARCHAR2,
    p_dynamic_model_name IN VARCHAR2
) AUTHID CURRENT_USER IS
    v_owner      VARCHAR2(128);
    v_table_name VARCHAR2(128);
    v_model_name VARCHAR2(261);
    v_sql        CLOB;
BEGIN
    v_owner := UPPER(TRIM(p_owner));
    v_table_name := UPPER(TRIM(p_tableName));
    v_model_name := DBMS_ASSERT.QUALIFIED_SQL_NAME(UPPER(TRIM(p_dynamic_model_name)));

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20001, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20002, 'Invalid tableName parameter.');
    END IF;

    DELETE FROM "INIT$_TB_PREDICTED_TYPE"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name;

    v_sql := q'~
INSERT INTO "INIT$_TB_PREDICTED_TYPE" (
    "OWNER",
    "TABLE_NAME",
    "MODEL_NAME",
    "COLUMN_ID",
    "COLUMN_NAME",
    "DATA_TYPE",
    "TOTAL_ROWS",
    "NUM_DISTINCT",
    "DIST_VAL_RT",
    "LOG_DATA_TYPE",
    "ENTROPY",
    "NORM_ENTROPY",
    "BASE_PREDICTED_TYPE",
    "MODL_PREDICTED_TYPE",
    "CREATE_DT"
)
WITH BASE_COL AS (
    SELECT C.OWNER
         , C.TABLE_NAME
         , C.COLUMN_ID
         , C.COLUMN_NAME
         , C.DATA_TYPE
         , C.NUM_DISTINCT
         , MAX(CASE
                   WHEN C.COLUMN_ID = 1
                    AND C.COLUMN_NAME = 'FILE_ROW_NO'
                   THEN C.NUM_DISTINCT
               END) OVER (PARTITION BY C.OWNER, C.TABLE_NAME) AS TOTAL_ROWS
      FROM ALL_TAB_COLUMNS C
     WHERE C.OWNER = :owner
       AND C.TABLE_NAME = :tableName
)
SELECT B.OWNER
     , B.TABLE_NAME
     , :modelName AS MODEL_NAME
     , B.COLUMN_ID
     , B.COLUMN_NAME
     , B.DATA_TYPE
     , B.TOTAL_ROWS
     , B.NUM_DISTINCT
     , ROUND(B.NUM_DISTINCT / NULLIF(B.TOTAL_ROWS, 0), 6) AS DIST_VAL_RT
     , CASE
           WHEN X.SAMPLE_NOT_NULL_COUNT = 0 THEN 'ETC'
           WHEN X.SAMPLE_NOT_NULL_COUNT = X.NUMERIC_CONVERTIBLE_COUNT THEN 'NUM'
           ELSE 'CHR'
       END AS LOG_DATA_TYPE
     , X.ENTROPY
     , X.NORM_ENTROPY
     , CASE
           WHEN B.COLUMN_NAME = 'FILE_ROW_NO' THEN '식별자'
           WHEN X.SAMPLE_NOT_NULL_COUNT = 0 THEN '기타'
           WHEN X.SAMPLE_NOT_NULL_COUNT = X.NUMERIC_CONVERTIBLE_COUNT
                AND NVL(B.NUM_DISTINCT, 0) >= 20
                AND NVL(B.NUM_DISTINCT / NULLIF(B.TOTAL_ROWS, 0), 0) >= 0.05
                AND NVL(X.NORM_ENTROPY, 0) >= 0.70
           THEN '연속형'
           ELSE '범주형'
       END AS BASE_PREDICTED_TYPE
     , PREDICTION(~' || v_model_name || q'~ USING *) AS MODL_PREDICTED_TYPE
     , SYSDATE AS CREATE_DT
  FROM BASE_COL B
       CROSS APPLY XMLTABLE(
           '/ROWSET/ROW'
           PASSING DBMS_XMLGEN.GETXMLTYPE(
               'WITH S AS (
                    SELECT "' || REPLACE(B.COLUMN_NAME, '"', '""') || '" AS COL_VALUE
                      FROM "' || REPLACE(B.OWNER, '"', '""') || '"."' || REPLACE(B.TABLE_NAME, '"', '""') || '"
                     WHERE "' || REPLACE(B.COLUMN_NAME, '"', '""') || '" IS NOT NULL
                       AND ROWNUM <= 10000
                ),
                FREQ AS (
                    SELECT COL_VALUE,
                           COUNT(*) AS CNT
                      FROM S
                     GROUP BY COL_VALUE
                ),
                TOTAL AS (
                    SELECT SUM(CNT) AS TOTAL_CNT,
                           COUNT(*) AS DIST_CNT
                      FROM FREQ
                ),
                STAT AS (
                    SELECT COUNT(*) AS SAMPLE_NOT_NULL_COUNT,
                           NVL(SUM(
                               CASE
                                   WHEN VALIDATE_CONVERSION(TRIM(COL_VALUE) AS NUMBER) = 1
                                   THEN 1
                                   ELSE 0
                               END
                           ), 0) AS NUMERIC_CONVERTIBLE_COUNT
                      FROM S
                ),
                ENT AS (
                    SELECT CASE
                               WHEN T.TOTAL_CNT = 0 THEN 0
                               ELSE -SUM((F.CNT / T.TOTAL_CNT) * LN(F.CNT / T.TOTAL_CNT))
                           END AS ENTROPY,
                           CASE
                               WHEN T.TOTAL_CNT = 0 OR T.DIST_CNT <= 1 THEN 0
                               ELSE -SUM((F.CNT / T.TOTAL_CNT) * LN(F.CNT / T.TOTAL_CNT)) / LN(T.DIST_CNT)
                           END AS NORM_ENTROPY
                      FROM FREQ F
                           CROSS JOIN TOTAL T
                     GROUP BY T.TOTAL_CNT, T.DIST_CNT
                )
                SELECT STAT.SAMPLE_NOT_NULL_COUNT,
                       STAT.NUMERIC_CONVERTIBLE_COUNT,
                       ROUND(NVL(ENT.ENTROPY, 0), 6) AS ENTROPY,
                       ROUND(NVL(ENT.NORM_ENTROPY, 0), 6) AS NORM_ENTROPY
                  FROM STAT
                       CROSS JOIN ENT'
           )
           COLUMNS
               SAMPLE_NOT_NULL_COUNT      NUMBER PATH 'SAMPLE_NOT_NULL_COUNT',
               NUMERIC_CONVERTIBLE_COUNT  NUMBER PATH 'NUMERIC_CONVERTIBLE_COUNT',
               ENTROPY                    NUMBER PATH 'ENTROPY',
               NORM_ENTROPY               NUMBER PATH 'NORM_ENTROPY'
       ) X
 ORDER BY B.COLUMN_ID~';

    EXECUTE IMMEDIATE v_sql USING v_owner, v_table_name, v_model_name;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_PREDICTED_TYPE loaded '
        || SQL%ROWCOUNT || ' column prediction rows for '
        || v_owner || '.' || v_table_name || ' using ' || v_model_name);
END;
/
