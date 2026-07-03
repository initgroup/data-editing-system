CREATE OR REPLACE FUNCTION "INIT$_FN_TARGET_SETTING_VALUE" (
    p_category_code IN VARCHAR2,
    p_setting_key   IN VARCHAR2,
    p_default_value IN VARCHAR2
) RETURN VARCHAR2
AUTHID CURRENT_USER
IS
    v_value VARCHAR2(4000);
BEGIN
    SELECT DBMS_LOB.SUBSTR("SETTING_VALUE", 4000, 1)
      INTO v_value
      FROM "INIT$_TB_TARGET_SETTING"
     WHERE "CATEGORY_CODE" = UPPER(TRIM(p_category_code))
       AND "SETTING_KEY" = UPPER(TRIM(p_setting_key))
       AND "USE_YN" = 'Y'
       AND ROWNUM = 1;

    RETURN NVL(v_value, p_default_value);
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN p_default_value;
    WHEN OTHERS THEN
        RETURN p_default_value;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TARGET_SETTING_NUMBER" (
    p_category_code IN VARCHAR2,
    p_setting_key   IN VARCHAR2,
    p_default_value IN NUMBER
) RETURN NUMBER
AUTHID CURRENT_USER
IS
    v_value VARCHAR2(4000);
BEGIN
    v_value := "INIT$_FN_TARGET_SETTING_VALUE"(p_category_code, p_setting_key, TO_CHAR(p_default_value));
    RETURN TO_NUMBER(TRIM(v_value));
EXCEPTION
    WHEN OTHERS THEN
        RETURN p_default_value;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TARGET_SETTING_USE_YN" (
    p_category_code IN VARCHAR2,
    p_setting_key   IN VARCHAR2,
    p_default_yn    IN VARCHAR2 DEFAULT 'Y'
) RETURN VARCHAR2
AUTHID CURRENT_USER
IS
    v_use_yn VARCHAR2(1);
BEGIN
    SELECT NVL("USE_YN", 'N')
      INTO v_use_yn
      FROM "INIT$_TB_TARGET_SETTING"
     WHERE "CATEGORY_CODE" = UPPER(TRIM(p_category_code))
       AND "SETTING_KEY" = UPPER(TRIM(p_setting_key))
       AND ROWNUM = 1;

    RETURN CASE WHEN UPPER(TRIM(v_use_yn)) = 'Y' THEN 'Y' ELSE 'N' END;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN CASE WHEN UPPER(TRIM(NVL(p_default_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
    WHEN OTHERS THEN
        RETURN CASE WHEN UPPER(TRIM(NVL(p_default_yn, 'Y'))) = 'Y' THEN 'Y' ELSE 'N' END;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TOKEN_LIST_CONTAINS" (
    p_token_list IN VARCHAR2,
    p_token      IN VARCHAR2
) RETURN VARCHAR2
AUTHID CURRENT_USER
DETERMINISTIC
IS
    v_list  VARCHAR2(4000);
    v_token VARCHAR2(4000);
BEGIN
    v_list := UPPER(NVL(p_token_list, ''));
    v_list := REPLACE(v_list, CHR(13), ',');
    v_list := REPLACE(v_list, CHR(10), ',');
    v_list := REPLACE(v_list, ';', ',');
    v_list := REPLACE(v_list, ' ', '');
    v_list := ',' || v_list || ',';
    v_token := UPPER(TRIM(p_token));

    IF v_token IS NOT NULL AND INSTR(v_list, ',' || v_token || ',') > 0 THEN
        RETURN 'Y';
    END IF;

    RETURN 'N';
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_PREDICT_LOG_DATA_TYPE" (
    p_data_type                 IN VARCHAR2,
    p_sample_not_null_count     IN NUMBER,
    p_numeric_convertible_count IN NUMBER
) RETURN VARCHAR2
AUTHID CURRENT_USER
IS
    v_data_type VARCHAR2(128);
    v_numeric_types VARCHAR2(4000);
BEGIN
    v_data_type := UPPER(TRIM(p_data_type));
    v_numeric_types := "INIT$_FN_TARGET_SETTING_VALUE"('DATA_PROFILING', 'NUMERIC_TYPES', 'NUMBER,FLOAT');

    IF "INIT$_FN_TOKEN_LIST_CONTAINS"(v_numeric_types, v_data_type) = 'Y' THEN
        RETURN 'NUM';
    END IF;

    IF NVL(p_sample_not_null_count, 0) = 0 THEN
        RETURN 'ETC';
    END IF;

    IF NVL(p_sample_not_null_count, 0) = NVL(p_numeric_convertible_count, 0) THEN
        RETURN 'NUM';
    END IF;

    RETURN 'CHR';
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_PREDICT_BASE_TYPE" (
    p_column_name      IN VARCHAR2,
    p_log_data_type    IN VARCHAR2,
    p_num_distinct     IN NUMBER,
    p_dist_val_rt      IN NUMBER,
    p_is_integer       IN NUMBER,
    p_norm_entropy     IN NUMBER,
    p_min_num_value    IN NUMBER DEFAULT NULL,
    p_max_num_value    IN NUMBER DEFAULT NULL
) RETURN VARCHAR2
AUTHID CURRENT_USER
IS
    v_column_name   VARCHAR2(128);
    v_log_data_type VARCHAR2(50);
    v_force_identifier_columns VARCHAR2(4000);
    v_identifier_dist_ratio NUMBER;
    v_low_cardinality_count NUMBER;
    v_text_dist_ratio NUMBER;
    v_high_entropy NUMBER;
    v_discrete_numeric_min_distinct NUMBER;
    v_dense_numeric_range_ratio NUMBER;
    v_ordinal_max_distinct NUMBER;
    v_numeric_range_size NUMBER;
    v_observed_range_ratio NUMBER;
    v_use_force_identifier VARCHAR2(1);
    v_use_identifier_dist_ratio VARCHAR2(1);
    v_use_low_cardinality VARCHAR2(1);
    v_use_text_dist_ratio VARCHAR2(1);
    v_use_high_entropy VARCHAR2(1);
    v_use_discrete_numeric_min VARCHAR2(1);
    v_use_dense_numeric_range VARCHAR2(1);
    v_use_ordinal_max_distinct VARCHAR2(1);
BEGIN
    v_column_name := UPPER(TRIM(p_column_name));
    v_log_data_type := UPPER(TRIM(p_log_data_type));
    v_use_force_identifier := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'FORCE_IDENTIFIER_COLUMNS', 'Y');
    v_use_identifier_dist_ratio := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'IDENTIFIER_DIST_RATIO', 'Y');
    v_use_low_cardinality := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'LOW_CARDINALITY_COUNT', 'Y');
    v_use_text_dist_ratio := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'TEXT_DIST_RATIO', 'Y');
    v_use_high_entropy := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'HIGH_ENTROPY', 'Y');
    v_use_discrete_numeric_min := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'DISCRETE_NUMERIC_MIN_DISTINCT', 'Y');
    v_use_dense_numeric_range := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'DENSE_NUMERIC_RANGE_RATIO', 'Y');
    v_use_ordinal_max_distinct := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'ORDINAL_MAX_DISTINCT', 'Y');
    v_force_identifier_columns := "INIT$_FN_TARGET_SETTING_VALUE"('DATA_PROFILING', 'FORCE_IDENTIFIER_COLUMNS', 'FILE_ROW_NO');
    v_identifier_dist_ratio := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'IDENTIFIER_DIST_RATIO', 0.9);
    v_low_cardinality_count := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'LOW_CARDINALITY_COUNT', 15);
    v_text_dist_ratio := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'TEXT_DIST_RATIO', 0.5);
    v_high_entropy := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'HIGH_ENTROPY', 0.7);
    v_discrete_numeric_min_distinct := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'DISCRETE_NUMERIC_MIN_DISTINCT', GREATEST(v_low_cardinality_count + 1, 6));
    v_dense_numeric_range_ratio := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'DENSE_NUMERIC_RANGE_RATIO', 0.8);
    v_ordinal_max_distinct := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'ORDINAL_MAX_DISTINCT', GREATEST(v_low_cardinality_count * 2, 10));
    v_numeric_range_size := CASE
        WHEN p_min_num_value IS NOT NULL AND p_max_num_value IS NOT NULL
        THEN ABS(p_max_num_value - p_min_num_value) + 1
        ELSE NULL
    END;
    v_observed_range_ratio := CASE
        WHEN NVL(v_numeric_range_size, 0) > 0
        THEN NVL(p_num_distinct, 0) / v_numeric_range_size
        ELSE 0
    END;

    IF v_use_force_identifier = 'Y'
       AND "INIT$_FN_TOKEN_LIST_CONTAINS"(v_force_identifier_columns, v_column_name) = 'Y' THEN
        IF v_log_data_type = 'NUM' THEN
            RETURN '숫자형식별자';
        END IF;
        RETURN '문자형식별자';
    END IF;

    IF v_use_identifier_dist_ratio = 'Y'
       AND NVL(p_dist_val_rt, 0) > v_identifier_dist_ratio THEN
        IF v_log_data_type = 'NUM' THEN
            RETURN '숫자형식별자';
        END IF;
        RETURN '문자형식별자';
    END IF;

    IF v_log_data_type = 'NUM'
       AND NVL(p_is_integer, 0) = 1
       AND v_use_discrete_numeric_min = 'Y'
       AND v_use_dense_numeric_range = 'Y'
       AND NVL(p_num_distinct, 0) >= v_discrete_numeric_min_distinct
       AND NVL(p_min_num_value, -1) >= 0
       AND v_observed_range_ratio >= v_dense_numeric_range_ratio THEN
        RETURN '이산형연속형';
    END IF;

    IF v_log_data_type = 'NUM'
       AND v_use_low_cardinality = 'Y'
       AND NVL(p_num_distinct, 0) <= v_low_cardinality_count THEN
        RETURN '숫자형범주형';
    END IF;

    IF v_log_data_type = 'NUM'
       AND NVL(p_is_integer, 0) = 1
       AND v_use_high_entropy = 'Y'
       AND v_use_ordinal_max_distinct = 'Y'
       AND NVL(p_num_distinct, 0) <= v_ordinal_max_distinct
       AND NVL(p_norm_entropy, 0) < v_high_entropy THEN
        RETURN '순서형범주형';
    END IF;

    IF v_log_data_type = 'NUM' THEN
        RETURN '숫자형연속형';
    END IF;

    IF v_log_data_type = 'CHR'
       AND v_use_low_cardinality = 'Y'
       AND NVL(p_num_distinct, 0) <= v_low_cardinality_count THEN
        RETURN '문자형범주형';
    END IF;

    IF v_log_data_type = 'CHR'
       AND v_use_text_dist_ratio = 'Y'
       AND v_use_high_entropy = 'Y'
       AND NVL(p_dist_val_rt, 0) > v_text_dist_ratio
       AND NVL(p_norm_entropy, 0) >= v_high_entropy THEN
        RETURN '단순형텍스트';
    END IF;

    IF v_log_data_type = 'CHR' THEN
        RETURN '일반적범주형';
    END IF;

    IF v_log_data_type = 'ETC' THEN
        RETURN '기타데이터형';
    END IF;

    RETURN '미상데이터형';
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_PREDICT_BASE_REASON" (
    p_column_name      IN VARCHAR2,
    p_log_data_type    IN VARCHAR2,
    p_num_distinct     IN NUMBER,
    p_dist_val_rt      IN NUMBER,
    p_is_integer       IN NUMBER,
    p_norm_entropy     IN NUMBER,
    p_min_num_value    IN NUMBER DEFAULT NULL,
    p_max_num_value    IN NUMBER DEFAULT NULL
) RETURN VARCHAR2
AUTHID CURRENT_USER
IS
    v_column_name   VARCHAR2(128);
    v_log_data_type VARCHAR2(50);
    v_force_identifier_columns VARCHAR2(4000);
    v_identifier_dist_ratio NUMBER;
    v_low_cardinality_count NUMBER;
    v_text_dist_ratio NUMBER;
    v_high_entropy NUMBER;
    v_discrete_numeric_min_distinct NUMBER;
    v_dense_numeric_range_ratio NUMBER;
    v_ordinal_max_distinct NUMBER;
    v_numeric_range_size NUMBER;
    v_observed_range_ratio NUMBER;
    v_use_force_identifier VARCHAR2(1);
    v_use_identifier_dist_ratio VARCHAR2(1);
    v_use_low_cardinality VARCHAR2(1);
    v_use_text_dist_ratio VARCHAR2(1);
    v_use_high_entropy VARCHAR2(1);
    v_use_discrete_numeric_min VARCHAR2(1);
    v_use_dense_numeric_range VARCHAR2(1);
    v_use_ordinal_max_distinct VARCHAR2(1);
BEGIN
    v_column_name := UPPER(TRIM(p_column_name));
    v_log_data_type := UPPER(TRIM(p_log_data_type));
    v_use_force_identifier := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'FORCE_IDENTIFIER_COLUMNS', 'Y');
    v_use_identifier_dist_ratio := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'IDENTIFIER_DIST_RATIO', 'Y');
    v_use_low_cardinality := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'LOW_CARDINALITY_COUNT', 'Y');
    v_use_text_dist_ratio := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'TEXT_DIST_RATIO', 'Y');
    v_use_high_entropy := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'HIGH_ENTROPY', 'Y');
    v_use_discrete_numeric_min := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'DISCRETE_NUMERIC_MIN_DISTINCT', 'Y');
    v_use_dense_numeric_range := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'DENSE_NUMERIC_RANGE_RATIO', 'Y');
    v_use_ordinal_max_distinct := "INIT$_FN_TARGET_SETTING_USE_YN"('DATA_PROFILING', 'ORDINAL_MAX_DISTINCT', 'Y');
    v_force_identifier_columns := "INIT$_FN_TARGET_SETTING_VALUE"('DATA_PROFILING', 'FORCE_IDENTIFIER_COLUMNS', 'FILE_ROW_NO');
    v_identifier_dist_ratio := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'IDENTIFIER_DIST_RATIO', 0.9);
    v_low_cardinality_count := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'LOW_CARDINALITY_COUNT', 15);
    v_text_dist_ratio := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'TEXT_DIST_RATIO', 0.5);
    v_high_entropy := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'HIGH_ENTROPY', 0.7);
    v_discrete_numeric_min_distinct := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'DISCRETE_NUMERIC_MIN_DISTINCT', GREATEST(v_low_cardinality_count + 1, 6));
    v_dense_numeric_range_ratio := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'DENSE_NUMERIC_RANGE_RATIO', 0.8);
    v_ordinal_max_distinct := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'ORDINAL_MAX_DISTINCT', GREATEST(v_low_cardinality_count * 2, 10));
    v_numeric_range_size := CASE
        WHEN p_min_num_value IS NOT NULL AND p_max_num_value IS NOT NULL
        THEN ABS(p_max_num_value - p_min_num_value) + 1
        ELSE NULL
    END;
    v_observed_range_ratio := CASE
        WHEN NVL(v_numeric_range_size, 0) > 0
        THEN NVL(p_num_distinct, 0) / v_numeric_range_size
        ELSE 0
    END;

    IF v_use_force_identifier = 'Y'
       AND "INIT$_FN_TOKEN_LIST_CONTAINS"(v_force_identifier_columns, v_column_name) = 'Y' THEN
        RETURN '[설정기반 RULE] 강제 식별자 컬럼으로 판단';
    END IF;

    IF v_use_identifier_dist_ratio = 'Y'
       AND NVL(p_dist_val_rt, 0) > v_identifier_dist_ratio THEN
        RETURN '[설정기반 RULE] 고유값 비율이 식별자 기준을 초과';
    END IF;

    IF v_log_data_type = 'NUM'
       AND NVL(p_is_integer, 0) = 1
       AND v_use_discrete_numeric_min = 'Y'
       AND v_use_dense_numeric_range = 'Y'
       AND NVL(p_num_distinct, 0) >= v_discrete_numeric_min_distinct
       AND NVL(p_min_num_value, -1) >= 0
       AND v_observed_range_ratio >= v_dense_numeric_range_ratio THEN
        RETURN '[설정기반 RULE] 정수형 숫자이며 값 범위가 조밀한 이산/카운트형 수량으로 분포';
    END IF;

    IF v_log_data_type = 'NUM'
       AND v_use_low_cardinality = 'Y'
       AND NVL(p_num_distinct, 0) <= v_low_cardinality_count THEN
        RETURN '[설정기반 RULE] 숫자형이나 고유값 건수가 범주 기준 이하';
    END IF;

    IF v_log_data_type = 'NUM'
       AND NVL(p_is_integer, 0) = 1
       AND v_use_high_entropy = 'Y'
       AND v_use_ordinal_max_distinct = 'Y'
       AND NVL(p_num_distinct, 0) <= v_ordinal_max_distinct
       AND NVL(p_norm_entropy, 0) < v_high_entropy THEN
        RETURN '[설정기반 RULE] 정수형이며 고유값 건수와 정규화 엔트로피가 순서형 범주 기준에 해당';
    END IF;

    IF v_log_data_type = 'NUM' THEN
        RETURN '[설정기반 RULE] 숫자형이며 고유값이 다양함';
    END IF;

    IF v_log_data_type = 'CHR'
       AND v_use_low_cardinality = 'Y'
       AND NVL(p_num_distinct, 0) <= v_low_cardinality_count THEN
        RETURN '[설정기반 RULE] 문자형이며 고유값 건수가 범주 기준 이하';
    END IF;

    IF v_log_data_type = 'CHR'
       AND v_use_text_dist_ratio = 'Y'
       AND v_use_high_entropy = 'Y'
       AND NVL(p_dist_val_rt, 0) > v_text_dist_ratio
       AND NVL(p_norm_entropy, 0) >= v_high_entropy THEN
        RETURN '[설정기반 RULE] 고유값 비율과 정규화 엔트로피가 텍스트 기준을 충족';
    END IF;

    IF v_log_data_type = 'CHR' THEN
        RETURN '[설정기반 RULE] 일반 문자형 그룹핑 속성';
    END IF;

    IF v_log_data_type = 'ETC' THEN
        RETURN '[설정기반 RULE] 날짜 또는 LOB 등 특수 데이터 타입';
    END IF;

    RETURN '[설정기반 RULE] 조건 분류 실패';
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_PREDICTED_TYPE" (
    p_target_owner       IN VARCHAR2,
    p_target_table       IN VARCHAR2,
    p_dynamic_model_name IN VARCHAR2 DEFAULT 'OML_DECISION_TREE_MODEL_01',
    p_prediction_method  IN VARCHAR2 DEFAULT 'ONLY_RULE',
    p_run_source_type    IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id             IN NUMBER   DEFAULT 0
) AUTHID CURRENT_USER IS
    v_owner                   VARCHAR2(128);
    v_table_name              VARCHAR2(128);
    v_model_name              VARCHAR2(261);
    v_method                  VARCHAR2(20);
    v_use_rule                BOOLEAN;
    v_use_model               BOOLEAN;
    v_sql                     CLOB;
    v_update_rule_sql         CLOB := '';
    v_update_model_sql        CLOB := '';
    v_update_final_sql        CLOB := '';
    v_model_prediction_expr   VARCHAR2(1000);
    v_insert_base_type_expr   VARCHAR2(1000);
    v_insert_base_reason_expr VARCHAR2(1000);
    v_insert_model_expr       VARCHAR2(1000);
    v_final_type_expr         CLOB := 'CAST(NULL AS VARCHAR2(4000))';
    v_final_reason_expr       VARCHAR2(1000) := 'CAST(NULL AS VARCHAR2(1000))';
    v_final_dt_expr           VARCHAR2(1000) := 'CAST(NULL AS DATE)';
    v_final_user_expr         VARCHAR2(1000) := 'CAST(NULL AS VARCHAR2(128))';
    v_run_source_type         VARCHAR2(30);
    v_run_id                  NUMBER;
    v_predicted_rowcount      NUMBER := 0;
    v_final_rowcount          NUMBER := 0;

    FUNCTION sql_literal(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '''' || REPLACE(NVL(p_value, ''), '''', '''''') || '''';
    END;

    FUNCTION normalize_run_source_type(p_value IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(30) := UPPER(TRIM(NVL(p_value, 'DATA_WORK')));
    BEGIN
        IF v_value NOT IN ('DATA_WORK', 'FLOW_WORK') THEN
            RETURN 'DATA_WORK';
        END IF;
        RETURN v_value;
    END;

    FUNCTION prediction_type_rank_expr(p_sql_expr IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN 'CASE TRIM(' || p_sql_expr || ')
                   WHEN ''숫자형식별자'' THEN 1
                   WHEN ''문자형식별자'' THEN 2
                   WHEN ''숫자형연속형'' THEN 3
                   WHEN ''이산형연속형'' THEN 4
                   WHEN ''일반적범주형'' THEN 5
                   WHEN ''문자형범주형'' THEN 6
                   WHEN ''순서형범주형'' THEN 7
                   WHEN ''숫자형범주형'' THEN 8
                   WHEN ''단순형텍스트'' THEN 9
                   WHEN ''기타데이터형'' THEN 10
                   ELSE 999
               END';
    END;
BEGIN
    v_owner := UPPER(TRIM(p_target_owner));
    v_table_name := UPPER(TRIM(p_target_table));
    v_model_name := DBMS_ASSERT.QUALIFIED_SQL_NAME(UPPER(NVL(NULLIF(TRIM(p_dynamic_model_name), ''), 'OML_DECISION_TREE_MODEL_01')));
    v_method := UPPER(TRIM(NVL(p_prediction_method, 'ONLY_RULE')));
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);

    IF NOT REGEXP_LIKE(v_owner, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20001, 'Invalid owner parameter.');
    END IF;

    IF NOT REGEXP_LIKE(v_table_name, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
        RAISE_APPLICATION_ERROR(-20002, 'Invalid tableName parameter.');
    END IF;

    IF v_method IN ('FIXED', 'BASE', 'RULE') THEN
        v_method := 'ONLY_RULE';
    ELSIF v_method IN ('ML', 'MODEL') THEN
        v_method := 'ONLY_MODEL';
    ELSIF v_method IN ('ALL', 'BOTH') THEN
        v_method := 'ONLY_BOTH';
    END IF;

    IF v_method NOT IN ('ONLY_RULE', 'ONLY_MODEL', 'ONLY_BOTH', 'FINAL_RULE', 'FINAL_MODEL', 'FINAL_BOTH') THEN
        RAISE_APPLICATION_ERROR(-20003, 'Invalid prediction_method parameter. Use ONLY_RULE, ONLY_MODEL, ONLY_BOTH, FINAL_RULE, FINAL_MODEL, or FINAL_BOTH.');
    END IF;

    v_use_rule := v_method IN ('ONLY_RULE', 'ONLY_BOTH', 'FINAL_RULE', 'FINAL_BOTH');
    v_use_model := v_method IN ('ONLY_MODEL', 'ONLY_BOTH', 'FINAL_MODEL', 'FINAL_BOTH');

    IF v_use_rule THEN
        v_update_rule_sql := q'[
        T."BASE_PREDICTED_TYPE" = S."BASE_PREDICTED_TYPE",
        T."BASE_REASON" = S."BASE_REASON",
]';
        v_insert_base_type_expr := 'S."BASE_PREDICTED_TYPE"';
        v_insert_base_reason_expr := 'S."BASE_REASON"';
    ELSE
        v_insert_base_type_expr := 'CAST(NULL AS VARCHAR2(100))';
        v_insert_base_reason_expr := 'CAST(NULL AS VARCHAR2(4000))';
    END IF;

    IF v_use_model THEN
        v_update_model_sql := q'[
        T."MODL_PREDICTED_TYPE" = S."MODL_PREDICTED_TYPE",
]';
        v_model_prediction_expr := 'PREDICTION(' || v_model_name || ' USING *)';
        v_insert_model_expr := 'S."MODL_PREDICTED_TYPE"';
    ELSE
        v_model_prediction_expr := 'CAST(NULL AS VARCHAR2(4000))';
        v_insert_model_expr := 'CAST(NULL AS VARCHAR2(4000))';
    END IF;

    IF v_method = 'FINAL_RULE' THEN
        v_final_type_expr := 'S."BASE_PREDICTED_TYPE"';
        v_final_reason_expr := sql_literal('[자동결정] FINAL_RULE: BASE_PREDICTED_TYPE 값을 FINAL_PREDICTED_TYPE에 반영');
    ELSIF v_method = 'FINAL_MODEL' THEN
        v_final_type_expr := 'S."MODL_PREDICTED_TYPE"';
        v_final_reason_expr := sql_literal('[자동결정] FINAL_MODEL: MODL_PREDICTED_TYPE 값을 FINAL_PREDICTED_TYPE에 반영');
    ELSIF v_method = 'FINAL_BOTH' THEN
        v_final_type_expr :=
            'CASE
                 WHEN TRIM(S."BASE_PREDICTED_TYPE") IS NULL THEN S."MODL_PREDICTED_TYPE"
                 WHEN TRIM(S."MODL_PREDICTED_TYPE") IS NULL THEN S."BASE_PREDICTED_TYPE"
                 WHEN ' || prediction_type_rank_expr('S."BASE_PREDICTED_TYPE"') || ' <= ' || prediction_type_rank_expr('S."MODL_PREDICTED_TYPE"') || '
                 THEN S."BASE_PREDICTED_TYPE"
                 ELSE S."MODL_PREDICTED_TYPE"
             END';
        v_final_reason_expr := sql_literal('[자동결정] FINAL_BOTH: BASE/MODL 결과 중 유형 우선순위가 높은 값을 FINAL_PREDICTED_TYPE에 반영');
    END IF;

    IF v_method IN ('FINAL_RULE', 'FINAL_MODEL', 'FINAL_BOTH') THEN
        v_final_dt_expr := 'SYSDATE';
        v_final_user_expr := 'SYS_CONTEXT(''USERENV'', ''SESSION_USER'')';
        v_update_final_sql := '
        T."FINAL_PREDICTED_TYPE" = ' || v_final_type_expr || ',
        T."FINAL_REASON" = ' || v_final_reason_expr || ',
        T."FINAL_UPDATE_DT" = ' || v_final_dt_expr || ',
        T."FINAL_UPDATE_USER" = ' || v_final_user_expr || ',
';
    END IF;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';

    v_sql := q'~
MERGE /*+ NO_PARALLEL */ INTO "INIT$_TB_PREDICTED_TYPE" T
USING (
    WITH BASE_COL AS (
        SELECT C.OWNER,
               C.TABLE_NAME,
               CM.COMMENTS AS COLUMN_DESC,
               C.COLUMN_ID,
               C.COLUMN_NAME,
               C.DATA_TYPE,
               C.NUM_DISTINCT,
               TT.TOTAL_ROWS
          FROM ALL_TAB_COLUMNS C
               LEFT JOIN ALL_COL_COMMENTS CM
                 ON CM.OWNER = C.OWNER
                AND CM.TABLE_NAME = C.TABLE_NAME
                AND CM.COLUMN_NAME = C.COLUMN_NAME
               CROSS JOIN (
                   SELECT COUNT(*) AS TOTAL_ROWS
                     FROM "~' || REPLACE(v_owner, '"', '""') || q'~"."~' || REPLACE(v_table_name, '"', '""') || q'~"
               ) TT
         WHERE C.OWNER = ~' || sql_literal(v_owner) || q'~
           AND C.TABLE_NAME = ~' || sql_literal(v_table_name) || q'~
    ),
    PROFILE AS (
        SELECT B.OWNER,
               B.TABLE_NAME,
               ~' || sql_literal(v_model_name) || q'~ AS MODEL_NAME,
               B.COLUMN_DESC,
               B.COLUMN_ID,
               B.COLUMN_NAME,
               B.DATA_TYPE,
               B.TOTAL_ROWS,
               NVL(B.NUM_DISTINCT, X.DIST_CNT) AS NUM_DISTINCT,
               ROUND(NVL(B.NUM_DISTINCT, X.DIST_CNT) / NULLIF(B.TOTAL_ROWS, 0), 6) AS DIST_VAL_RT,
               "INIT$_FN_PREDICT_LOG_DATA_TYPE"(
                   B.DATA_TYPE,
                   X.SAMPLE_NOT_NULL_COUNT,
                   X.NUMERIC_CONVERTIBLE_COUNT
               ) AS LOG_DATA_TYPE,
               X.ENTROPY,
               X.NORM_ENTROPY,
               X.MIN_NUM_VALUE,
               X.MAX_NUM_VALUE,
               CASE
                   WHEN X.SAMPLE_NOT_NULL_COUNT > 0
                    AND X.NUMERIC_CONVERTIBLE_COUNT = X.INTEGER_CONVERTIBLE_COUNT
                   THEN 1 ELSE 0
               END AS IS_INTEGER
          FROM BASE_COL B
               CROSS APPLY XMLTABLE(
                   '/ROWSET/ROW'
                   PASSING DBMS_XMLGEN.GETXMLTYPE(
                       'WITH S AS (
                            SELECT TO_CHAR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '") AS COL_VALUE
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
                                            AND NOT (
                                                REGEXP_LIKE(TRIM(COL_VALUE), ''^0[0-9]'')
                                                AND NOT REGEXP_LIKE(TRIM(COL_VALUE), ''^0$|^0\.'')
                                            )
                                           THEN 1 ELSE 0
                                       END
                                   ), 0) AS NUMERIC_CONVERTIBLE_COUNT,
                                   NVL(SUM(
                                       CASE
                                           WHEN VALIDATE_CONVERSION(TRIM(COL_VALUE) AS NUMBER) = 1
                                            AND NOT (
                                                REGEXP_LIKE(TRIM(COL_VALUE), ''^0[0-9]'')
                                                AND NOT REGEXP_LIKE(TRIM(COL_VALUE), ''^0$|^0\.'')
                                            )
                                            AND TRUNC(TO_NUMBER(TRIM(COL_VALUE))) = TO_NUMBER(TRIM(COL_VALUE))
                                           THEN 1 ELSE 0
                                       END
                                   ), 0) AS INTEGER_CONVERTIBLE_COUNT,
                                   MIN(
                                       CASE
                                           WHEN VALIDATE_CONVERSION(TRIM(COL_VALUE) AS NUMBER) = 1
                                            AND NOT (
                                                REGEXP_LIKE(TRIM(COL_VALUE), ''^0[0-9]'')
                                                AND NOT REGEXP_LIKE(TRIM(COL_VALUE), ''^0$|^0\.'')
                                            )
                                           THEN TO_NUMBER(TRIM(COL_VALUE))
                                       END
                                   ) AS MIN_NUM_VALUE,
                                   MAX(
                                       CASE
                                           WHEN VALIDATE_CONVERSION(TRIM(COL_VALUE) AS NUMBER) = 1
                                            AND NOT (
                                                REGEXP_LIKE(TRIM(COL_VALUE), ''^0[0-9]'')
                                                AND NOT REGEXP_LIKE(TRIM(COL_VALUE), ''^0$|^0\.'')
                                            )
                                           THEN TO_NUMBER(TRIM(COL_VALUE))
                                       END
                                   ) AS MAX_NUM_VALUE
                              FROM S
                        ),
                        ENT AS (
                            SELECT CASE
                                       WHEN NVL(T.TOTAL_CNT, 0) = 0 THEN 0
                                       ELSE -NVL(SUM((F.CNT / T.TOTAL_CNT) * LN(F.CNT / T.TOTAL_CNT)), 0)
                                   END AS ENTROPY,
                                   CASE
                                       WHEN NVL(T.TOTAL_CNT, 0) = 0 OR T.DIST_CNT <= 1 THEN 0
                                       ELSE -NVL(SUM((F.CNT / T.TOTAL_CNT) * LN(F.CNT / T.TOTAL_CNT)), 0) / LN(T.DIST_CNT)
                                   END AS NORM_ENTROPY
                              FROM TOTAL T
                                   LEFT JOIN FREQ F ON 1 = 1
                             GROUP BY T.TOTAL_CNT, T.DIST_CNT
                        )
                        SELECT STAT.SAMPLE_NOT_NULL_COUNT,
                               STAT.NUMERIC_CONVERTIBLE_COUNT,
                               STAT.INTEGER_CONVERTIBLE_COUNT,
                               TOTAL.DIST_CNT,
                               ROUND(NVL(ENT.ENTROPY, 0), 6) AS ENTROPY,
                               ROUND(NVL(ENT.NORM_ENTROPY, 0), 6) AS NORM_ENTROPY,
                               STAT.MIN_NUM_VALUE,
                               STAT.MAX_NUM_VALUE
                          FROM STAT
                               CROSS JOIN TOTAL
                               CROSS JOIN ENT'
                   )
                   COLUMNS
                       SAMPLE_NOT_NULL_COUNT      NUMBER PATH 'SAMPLE_NOT_NULL_COUNT',
                       NUMERIC_CONVERTIBLE_COUNT  NUMBER PATH 'NUMERIC_CONVERTIBLE_COUNT',
                       INTEGER_CONVERTIBLE_COUNT  NUMBER PATH 'INTEGER_CONVERTIBLE_COUNT',
                       DIST_CNT                   NUMBER PATH 'DIST_CNT',
                       ENTROPY                    NUMBER PATH 'ENTROPY',
                       NORM_ENTROPY               NUMBER PATH 'NORM_ENTROPY',
                       MIN_NUM_VALUE              NUMBER PATH 'MIN_NUM_VALUE',
                       MAX_NUM_VALUE              NUMBER PATH 'MAX_NUM_VALUE'
               ) X
    )
    SELECT ~' || sql_literal(v_run_source_type) || q'~ AS "RUN_SOURCE_TYPE",
           ~' || TO_CHAR(v_run_id, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'~ AS "RUN_ID",
           P.OWNER AS "OWNER",
           P.TABLE_NAME AS "TABLE_NAME",
           P.MODEL_NAME AS "MODEL_NAME",
           P.COLUMN_DESC AS "COLUMN_DESC",
           P.COLUMN_ID AS "COLUMN_ID",
           P.COLUMN_NAME AS "COLUMN_NAME",
           P.DATA_TYPE AS "DATA_TYPE",
           P.TOTAL_ROWS AS "TOTAL_ROWS",
           P.NUM_DISTINCT AS "NUM_DISTINCT",
           P.DIST_VAL_RT AS "DIST_VAL_RT",
           P.LOG_DATA_TYPE AS "LOG_DATA_TYPE",
           P.ENTROPY AS "ENTROPY",
           P.NORM_ENTROPY AS "NORM_ENTROPY",
           "INIT$_FN_PREDICT_BASE_TYPE"(
               P.COLUMN_NAME,
               P.LOG_DATA_TYPE,
               P.NUM_DISTINCT,
               P.DIST_VAL_RT,
               P.IS_INTEGER,
               P.NORM_ENTROPY,
               P.MIN_NUM_VALUE,
               P.MAX_NUM_VALUE
           ) AS "BASE_PREDICTED_TYPE",
           "INIT$_FN_PREDICT_BASE_REASON"(
               P.COLUMN_NAME,
               P.LOG_DATA_TYPE,
               P.NUM_DISTINCT,
               P.DIST_VAL_RT,
               P.IS_INTEGER,
               P.NORM_ENTROPY,
               P.MIN_NUM_VALUE,
               P.MAX_NUM_VALUE
           ) AS "BASE_REASON",
           ~' || v_model_prediction_expr || q'~ AS "MODL_PREDICTED_TYPE"
      FROM PROFILE P
) S
ON (
       T."RUN_SOURCE_TYPE" = S."RUN_SOURCE_TYPE"
   AND T."RUN_ID" = S."RUN_ID"
   AND T."OWNER" = S."OWNER"
   AND T."TABLE_NAME" = S."TABLE_NAME"
   AND T."MODEL_NAME" = S."MODEL_NAME"
   AND T."COLUMN_NAME" = S."COLUMN_NAME"
)
WHEN MATCHED THEN UPDATE SET
        T."COLUMN_DESC" = S."COLUMN_DESC",
        T."COLUMN_ID" = S."COLUMN_ID",
        T."DATA_TYPE" = S."DATA_TYPE",
        T."TOTAL_ROWS" = S."TOTAL_ROWS",
        T."NUM_DISTINCT" = S."NUM_DISTINCT",
        T."DIST_VAL_RT" = S."DIST_VAL_RT",
        T."LOG_DATA_TYPE" = S."LOG_DATA_TYPE",
        T."ENTROPY" = S."ENTROPY",
        T."NORM_ENTROPY" = S."NORM_ENTROPY",
~' || v_update_rule_sql || v_update_model_sql || v_update_final_sql || q'~        T."CREATE_DT" = SYSDATE
WHEN NOT MATCHED THEN INSERT (
        "RUN_SOURCE_TYPE",
        "RUN_ID",
        "OWNER",
        "TABLE_NAME",
        "MODEL_NAME",
        "COLUMN_DESC",
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
        "BASE_REASON",
        "MODL_PREDICTED_TYPE",
        "FINAL_PREDICTED_TYPE",
        "FINAL_REASON",
        "FINAL_UPDATE_DT",
        "FINAL_UPDATE_USER",
        "CREATE_DT"
) VALUES (
        S."RUN_SOURCE_TYPE",
        S."RUN_ID",
        S."OWNER",
        S."TABLE_NAME",
        S."MODEL_NAME",
        S."COLUMN_DESC",
        S."COLUMN_ID",
        S."COLUMN_NAME",
        S."DATA_TYPE",
        S."TOTAL_ROWS",
        S."NUM_DISTINCT",
        S."DIST_VAL_RT",
        S."LOG_DATA_TYPE",
        S."ENTROPY",
        S."NORM_ENTROPY",
        ~' || v_insert_base_type_expr || q'~,
        ~' || v_insert_base_reason_expr || q'~,
        ~' || v_insert_model_expr || q'~,
        ~' || v_final_type_expr || q'~,
        ~' || v_final_reason_expr || q'~,
        ~' || v_final_dt_expr || q'~,
        ~' || v_final_user_expr || q'~,
        SYSDATE
)~';

    EXECUTE IMMEDIATE v_sql;
    v_predicted_rowcount := SQL%ROWCOUNT;

    MERGE /*+ NO_PARALLEL */ INTO "INIT$_TB_PREDICTED_TYPE_FINAL" T
    USING (
        SELECT "RUN_SOURCE_TYPE"
             , "RUN_ID"
             , "OWNER"
             , "TABLE_NAME"
             , "MODEL_NAME"
             , "COLUMN_DESC"
             , "COLUMN_ID"
             , "COLUMN_NAME"
             , "DATA_TYPE"
             , "BASE_PREDICTED_TYPE"
             , "MODL_PREDICTED_TYPE"
             , COALESCE("FINAL_PREDICTED_TYPE", "MODL_PREDICTED_TYPE", "BASE_PREDICTED_TYPE") AS "FINAL_PREDICTED_TYPE"
             , "FINAL_REASON"
          FROM "INIT$_TB_PREDICTED_TYPE"
         WHERE "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
           AND "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "MODEL_NAME" = v_model_name
           AND COALESCE("FINAL_PREDICTED_TYPE", "MODL_PREDICTED_TYPE", "BASE_PREDICTED_TYPE") IS NOT NULL
    ) S
       ON (T."OWNER" = S."OWNER"
      AND T."TABLE_NAME" = S."TABLE_NAME"
      AND T."COLUMN_NAME" = S."COLUMN_NAME")
     WHEN MATCHED THEN UPDATE
          SET T."COLUMN_DESC" = S."COLUMN_DESC"
            , T."COLUMN_ID" = S."COLUMN_ID"
            , T."DATA_TYPE" = S."DATA_TYPE"
            , T."SOURCE_RUN_SOURCE_TYPE" = S."RUN_SOURCE_TYPE"
            , T."SOURCE_RUN_ID" = S."RUN_ID"
            , T."SOURCE_MODEL_NAME" = S."MODEL_NAME"
            , T."BASE_PREDICTED_TYPE" = S."BASE_PREDICTED_TYPE"
            , T."MODL_PREDICTED_TYPE" = S."MODL_PREDICTED_TYPE"
     WHEN NOT MATCHED THEN INSERT (
            "OWNER"
          , "TABLE_NAME"
          , "COLUMN_NAME"
          , "COLUMN_DESC"
          , "COLUMN_ID"
          , "DATA_TYPE"
          , "SOURCE_RUN_SOURCE_TYPE"
          , "SOURCE_RUN_ID"
          , "SOURCE_MODEL_NAME"
          , "BASE_PREDICTED_TYPE"
          , "MODL_PREDICTED_TYPE"
          , "FINAL_PREDICTED_TYPE"
          , "FINAL_REASON"
          , "FINAL_UPDATE_DT"
          , "FINAL_UPDATE_USER"
          , "CREATE_DT"
          )
          VALUES (
            S."OWNER"
          , S."TABLE_NAME"
          , S."COLUMN_NAME"
          , S."COLUMN_DESC"
          , S."COLUMN_ID"
          , S."DATA_TYPE"
          , S."RUN_SOURCE_TYPE"
          , S."RUN_ID"
          , S."MODEL_NAME"
          , S."BASE_PREDICTED_TYPE"
          , S."MODL_PREDICTED_TYPE"
          , S."FINAL_PREDICTED_TYPE"
          , S."FINAL_REASON"
          , SYSDATE
          , SYS_CONTEXT('USERENV', 'SESSION_USER')
          , SYSDATE
          );
    v_final_rowcount := SQL%ROWCOUNT;

    DBMS_OUTPUT.PUT_LINE('[OK] INIT$_SP_PREDICTED_TYPE loaded '
        || v_predicted_rowcount || ' column prediction rows and merged '
        || v_final_rowcount || ' final rows for '
        || v_owner || '.' || v_table_name || ' using ' || v_method || ' / ' || v_model_name);
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/
