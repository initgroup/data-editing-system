CREATE OR REPLACE PROCEDURE "INIT$_SP_CAT_CORR_ANALYZE" (
    p_target_owner IN VARCHAR2,
    p_target_table IN VARCHAR2,
    p_min_pvalue  IN NUMBER DEFAULT 0.05,
    p_min_cramer  IN NUMBER DEFAULT 0.3,
    p_min_avg_v   IN NUMBER DEFAULT 0.5,
    p_sample_rows IN NUMBER DEFAULT 100000,
    p_max_distinct IN NUMBER DEFAULT 100,
    p_max_columns IN NUMBER DEFAULT 80,
    p_run_source_type IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id IN NUMBER DEFAULT 0
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
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
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
    v_owner := UPPER(TRIM(p_target_owner));
    v_table_name := UPPER(TRIM(p_target_table));
    v_sample_rows := CASE WHEN p_sample_rows IS NULL OR p_sample_rows <= 0 THEN NULL ELSE p_sample_rows END;
    v_max_distinct := CASE WHEN p_max_distinct IS NULL OR p_max_distinct <= 0 THEN 100 ELSE p_max_distinct END;
    v_max_columns := CASE WHEN p_max_columns IS NULL OR p_max_columns <= 0 THEN 80 ELSE p_max_columns END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20101, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20102, 'Invalid tableName parameter.');
    END IF;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_CAT_CORR_SUMMARY"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name
       AND "RUN_SOURCE_TYPE" = v_run_source_type
       AND "RUN_ID" = v_run_id;

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_CAT_CORR_PAIR"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name
       AND "RUN_SOURCE_TYPE" = v_run_source_type
       AND "RUN_ID" = v_run_id;

    SELECT COLUMN_NAME
      BULK COLLECT INTO v_cols
      FROM (
            SELECT COLUMN_NAME
              FROM (
                    SELECT P.COLUMN_NAME
                         , MIN(NVL(P.COLUMN_ID, 999999)) AS COLUMN_ID
                      FROM "INIT$_TB_PREDICTED_TYPE" P
                      LEFT JOIN "INIT$_TB_PREDICTED_TYPE_FINAL" F
                        ON F."OWNER" = P."OWNER"
                       AND F."TABLE_NAME" = P."TABLE_NAME"
                       AND F."COLUMN_NAME" = P."COLUMN_NAME"
                     WHERE P."OWNER" = v_owner
                       AND P."TABLE_NAME" = v_table_name
                       AND P."RUN_SOURCE_TYPE" = v_run_source_type
                       AND (v_run_source_type = 'DATA_WORK' OR P."RUN_ID" = v_run_id)
                       AND COALESCE(TRIM(F."FINAL_PREDICTED_TYPE"), TRIM(P."FINAL_PREDICTED_TYPE"), TRIM(P."MODL_PREDICTED_TYPE"), TRIM(P."BASE_PREDICTED_TYPE")) LIKE '%범주형'
                     GROUP BY P.COLUMN_NAME
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

            INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_CAT_CORR_PAIR" (
                "RUN_SOURCE_TYPE"
              , "RUN_ID"
              , "OWNER"
              , "TABLE_NAME"
              , "COL_A"
              , "COL_B"
              , "ROW_COUNT"
              , "DF"
              , "CHI_SQUARE"
              , "P_VALUE"
              , "CRAMERS_V"
              , "PASS_YN"
              , "CREATE_DT"
            ) VALUES (
                v_run_source_type
              , v_run_id
              , v_owner
              , v_table_name
              , v_col_a
              , v_col_b
              , v_row_count
              , v_df
              , v_chi_square
              , v_p_value
              , v_cramers_v
              , v_pass_yn
              , SYSDATE
            );
        END LOOP;
    END LOOP;

    INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_CAT_CORR_SUMMARY" (
        "RUN_SOURCE_TYPE"
      , "RUN_ID"
      , "OWNER"
      , "TABLE_NAME"
      , "COLUMN_NAME"
      , "PAIR_COUNT"
      , "PASS_PAIR_COUNT"
      , "AVG_CRAMERS_V"
      , "MAX_CRAMERS_V"
      , "RANK_NO"
      , "SELECTED_YN"
      , "CREATE_DT"
    )
    WITH PAIRS AS (
        SELECT COL_A AS COLUMN_NAME, CRAMERS_V, PASS_YN
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
        UNION ALL
        SELECT COL_B AS COLUMN_NAME, CRAMERS_V, PASS_YN
          FROM "INIT$_TB_CAT_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
    ),
    SUMMARY AS (
        SELECT COLUMN_NAME
             , COUNT(*) AS PAIR_COUNT
             , SUM(CASE WHEN PASS_YN = 'Y' THEN 1 ELSE 0 END) AS PASS_PAIR_COUNT
             , AVG(CASE WHEN PASS_YN = 'Y' THEN CRAMERS_V END) AS AVG_CRAMERS_V
             , MAX(CASE WHEN PASS_YN = 'Y' THEN CRAMERS_V END) AS MAX_CRAMERS_V
          FROM PAIRS
         GROUP BY COLUMN_NAME
    )
    SELECT v_run_source_type
         , v_run_id
         , v_owner
         , v_table_name
         , COLUMN_NAME
         , PAIR_COUNT
         , PASS_PAIR_COUNT
         , AVG_CRAMERS_V
         , MAX_CRAMERS_V
         , ROW_NUMBER() OVER (ORDER BY AVG_CRAMERS_V DESC NULLS LAST, COLUMN_NAME) AS RANK_NO
         , CASE WHEN NVL(AVG_CRAMERS_V, 0) >= NVL(p_min_avg_v, 0.5) THEN 'Y' ELSE 'N' END AS SELECTED_YN
         , SYSDATE
      FROM SUMMARY;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_CAT_CORR_ANALYZE analyzed '
        || v_cols.COUNT || ' categorical columns for ' || v_owner || '.' || v_table_name
        || ' (sample_rows=' || NVL(TO_CHAR(v_sample_rows), 'ALL')
        || ', max_distinct=' || v_max_distinct
        || ', max_columns=' || v_max_columns || ')');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_NUM_CORR_ANALYZE" (
    p_target_owner IN VARCHAR2,
    p_target_table IN VARCHAR2,
    p_min_pvalue IN NUMBER DEFAULT 0.05,
    p_min_abs_corr IN NUMBER DEFAULT 0.6,
    p_min_avg_abs_corr IN NUMBER DEFAULT 0.6,
    p_sample_rows IN NUMBER DEFAULT 100000,
    p_max_columns IN NUMBER DEFAULT 80,
    p_min_rows IN NUMBER DEFAULT 30,
    p_run_source_type IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id IN NUMBER DEFAULT 0
) AUTHID CURRENT_USER IS
    TYPE t_column_list IS TABLE OF VARCHAR2(128);

    v_owner VARCHAR2(128);
    v_table_name VARCHAR2(128);
    v_cols t_column_list := t_column_list();
    v_col_a VARCHAR2(128);
    v_col_b VARCHAR2(128);
    v_sql CLOB;
    v_row_count NUMBER;
    v_pearson_r NUMBER;
    v_abs_pearson_r NUMBER;
    v_p_value NUMBER;
    v_pass_yn CHAR(1);
    v_sample_rows NUMBER;
    v_max_columns NUMBER;
    v_min_rows NUMBER;
    v_run_source_type VARCHAR2(30);
    v_run_id NUMBER;

    FUNCTION quote_name(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(p_name, '"', '""') || '"';
    END;

    FUNCTION numeric_expr(p_name IN VARCHAR2) RETURN VARCHAR2 IS
        v_quoted_name VARCHAR2(4000);
    BEGIN
        v_quoted_name := quote_name(p_name);
        RETURN 'CASE WHEN VALIDATE_CONVERSION(TRIM(TO_CHAR(' || v_quoted_name || ')) AS NUMBER) = 1 THEN TO_NUMBER(TRIM(TO_CHAR(' || v_quoted_name || '))) END';
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION normal_cdf(p_x IN NUMBER) RETURN NUMBER IS
        v_t NUMBER;
        v_d NUMBER;
        v_prob NUMBER;
        v_abs_x NUMBER;
    BEGIN
        IF p_x IS NULL THEN
            RETURN NULL;
        END IF;

        v_abs_x := ABS(p_x);
        v_t := 1 / (1 + 0.2316419 * v_abs_x);
        v_d := 0.3989422804014327 * EXP(-v_abs_x * v_abs_x / 2);
        v_prob := 1 - v_d * (((((1.330274429 * v_t - 1.821255978) * v_t + 1.781477937) * v_t - 0.356563782) * v_t + 0.319381530) * v_t);

        IF p_x < 0 THEN
            RETURN 1 - v_prob;
        END IF;
        RETURN v_prob;
    END;

    FUNCTION pearson_pvalue(p_r IN NUMBER, p_n IN NUMBER) RETURN NUMBER IS
        v_r NUMBER;
        v_z NUMBER;
    BEGIN
        IF p_r IS NULL OR p_n IS NULL OR p_n <= 3 THEN
            RETURN NULL;
        END IF;

        IF ABS(p_r) >= 1 THEN
            RETURN 0;
        END IF;

        v_r := GREATEST(-0.999999999999, LEAST(0.999999999999, p_r));
        v_z := 0.5 * LN((1 + v_r) / (1 - v_r)) * SQRT(p_n - 3);
        RETURN GREATEST(0, LEAST(1, 2 * (1 - normal_cdf(ABS(v_z)))));
    END;
BEGIN
    v_owner := UPPER(TRIM(p_target_owner));
    v_table_name := UPPER(TRIM(p_target_table));
    v_sample_rows := CASE WHEN p_sample_rows IS NULL OR p_sample_rows <= 0 THEN NULL ELSE p_sample_rows END;
    v_max_columns := CASE WHEN p_max_columns IS NULL OR p_max_columns <= 0 THEN 80 ELSE p_max_columns END;
    v_min_rows := CASE WHEN p_min_rows IS NULL OR p_min_rows <= 3 THEN 30 ELSE p_min_rows END;
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20101, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20102, 'Invalid tableName parameter.');
    END IF;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_NUM_CORR_SUMMARY"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name
       AND "RUN_SOURCE_TYPE" = v_run_source_type
       AND "RUN_ID" = v_run_id;

    DELETE /*+ NO_PARALLEL */
      FROM "INIT$_TB_NUM_CORR_PAIR"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name
       AND "RUN_SOURCE_TYPE" = v_run_source_type
       AND "RUN_ID" = v_run_id;

    SELECT COLUMN_NAME
      BULK COLLECT INTO v_cols
      FROM (
            SELECT COLUMN_NAME
              FROM (
                    SELECT P."COLUMN_NAME"
                         , MIN(NVL(P."COLUMN_ID", C.COLUMN_ID)) AS COLUMN_ID
                      FROM "INIT$_TB_PREDICTED_TYPE" P
                      JOIN ALL_TAB_COLUMNS C
                        ON C.OWNER = P."OWNER"
                       AND C.TABLE_NAME = P."TABLE_NAME"
                       AND C.COLUMN_NAME = P."COLUMN_NAME"
                      JOIN "INIT$_TB_PREDICTED_TYPE_FINAL" F
                        ON F."OWNER" = P."OWNER"
                       AND F."TABLE_NAME" = P."TABLE_NAME"
                       AND F."COLUMN_NAME" = P."COLUMN_NAME"
                     WHERE P."OWNER" = v_owner
                       AND P."TABLE_NAME" = v_table_name
                       AND P."RUN_SOURCE_TYPE" = v_run_source_type
                       AND (v_run_source_type = 'DATA_WORK' OR P."RUN_ID" = v_run_id)
                       AND TRIM(F."FINAL_PREDICTED_TYPE") LIKE '%연속형'
                     GROUP BY P."COLUMN_NAME"
                     ORDER BY COLUMN_ID, COLUMN_NAME
                   )
             WHERE ROWNUM <= v_max_columns
           );

    FOR i IN 1 .. v_cols.COUNT LOOP
        FOR j IN i + 1 .. v_cols.COUNT LOOP
            v_col_a := v_cols(i);
            v_col_b := v_cols(j);

            v_sql := '
WITH BASE AS (
    SELECT ' || numeric_expr(v_col_a) || ' AS A_VAL
         , ' || numeric_expr(v_col_b) || ' AS B_VAL
      FROM ' || quote_name(v_owner) || '.' || quote_name(v_table_name) || '
     WHERE ' || quote_name(v_col_a) || ' IS NOT NULL
       AND ' || quote_name(v_col_b) || ' IS NOT NULL
       AND (:sampleRows IS NULL OR ROWNUM <= :sampleRows)
)
SELECT COUNT(*) AS ROW_COUNT
     , CORR(A_VAL, B_VAL) AS PEARSON_R
  FROM BASE
 WHERE A_VAL IS NOT NULL
   AND B_VAL IS NOT NULL';

            EXECUTE IMMEDIATE v_sql
               INTO v_row_count, v_pearson_r
              USING v_sample_rows, v_sample_rows;

            v_abs_pearson_r := ABS(v_pearson_r);
            v_p_value := pearson_pvalue(v_pearson_r, v_row_count);
            v_pass_yn := CASE
                             WHEN NVL(v_row_count, 0) >= v_min_rows
                              AND v_p_value IS NOT NULL
                              AND v_p_value < NVL(p_min_pvalue, 0.05)
                              AND NVL(v_abs_pearson_r, 0) >= NVL(p_min_abs_corr, 0.6)
                             THEN 'Y'
                             ELSE 'N'
                         END;

            INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_NUM_CORR_PAIR" (
                "RUN_SOURCE_TYPE"
              , "RUN_ID"
              , "OWNER"
              , "TABLE_NAME"
              , "COL_A"
              , "COL_B"
              , "ROW_COUNT"
              , "PEARSON_R"
              , "ABS_PEARSON_R"
              , "P_VALUE"
              , "PASS_YN"
              , "CREATE_DT"
            ) VALUES (
                v_run_source_type
              , v_run_id
              , v_owner
              , v_table_name
              , v_col_a
              , v_col_b
              , v_row_count
              , v_pearson_r
              , v_abs_pearson_r
              , v_p_value
              , v_pass_yn
              , SYSDATE
            );
        END LOOP;
    END LOOP;

    INSERT /*+ NO_PARALLEL */ INTO "INIT$_TB_NUM_CORR_SUMMARY" (
        "RUN_SOURCE_TYPE"
      , "RUN_ID"
      , "OWNER"
      , "TABLE_NAME"
      , "COLUMN_NAME"
      , "PAIR_COUNT"
      , "PASS_PAIR_COUNT"
      , "AVG_ABS_PEARSON_R"
      , "MAX_ABS_PEARSON_R"
      , "RANK_NO"
      , "SELECTED_YN"
      , "CREATE_DT"
    )
    WITH PAIRS AS (
        SELECT "COL_A" AS COLUMN_NAME, "ABS_PEARSON_R", "PASS_YN"
          FROM "INIT$_TB_NUM_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
        UNION ALL
        SELECT "COL_B" AS COLUMN_NAME, "ABS_PEARSON_R", "PASS_YN"
          FROM "INIT$_TB_NUM_CORR_PAIR"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
    ),
    SUMMARY AS (
        SELECT COLUMN_NAME
             , COUNT(*) AS PAIR_COUNT
             , SUM(CASE WHEN PASS_YN = 'Y' THEN 1 ELSE 0 END) AS PASS_PAIR_COUNT
             , AVG(CASE WHEN PASS_YN = 'Y' THEN ABS_PEARSON_R END) AS AVG_ABS_PEARSON_R
             , MAX(CASE WHEN PASS_YN = 'Y' THEN ABS_PEARSON_R END) AS MAX_ABS_PEARSON_R
          FROM PAIRS
         GROUP BY COLUMN_NAME
    )
    SELECT v_run_source_type
         , v_run_id
         , v_owner
         , v_table_name
         , COLUMN_NAME
         , PAIR_COUNT
         , PASS_PAIR_COUNT
         , AVG_ABS_PEARSON_R
         , MAX_ABS_PEARSON_R
         , ROW_NUMBER() OVER (ORDER BY AVG_ABS_PEARSON_R DESC NULLS LAST, COLUMN_NAME) AS RANK_NO
         , CASE WHEN NVL(AVG_ABS_PEARSON_R, 0) >= NVL(p_min_avg_abs_corr, 0.6) THEN 'Y' ELSE 'N' END AS SELECTED_YN
         , SYSDATE
      FROM SUMMARY;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_NUM_CORR_ANALYZE analyzed '
        || v_cols.COUNT || ' numeric columns for ' || v_owner || '.' || v_table_name
        || ' (sample_rows=' || NVL(TO_CHAR(v_sample_rows), 'ALL')
        || ', max_columns=' || v_max_columns
        || ', min_rows=' || v_min_rows || ')');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/

