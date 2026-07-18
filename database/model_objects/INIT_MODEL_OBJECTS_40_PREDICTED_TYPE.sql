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

CREATE OR REPLACE PROCEDURE "INIT$_SP_TYPE_MODEL_TRAIN" (
    p_train_run_id IN NUMBER,
    p_requested_by IN VARCHAR2
) AUTHID CURRENT_USER IS
    v_setlist              DBMS_DATA_MINING.SETTING_LIST;
    v_model_key            VARCHAR2(100);
    v_algorithm_code       VARCHAR2(50);
    v_feature_version      VARCHAR2(30);
    v_label_version        VARCHAR2(30);
    v_min_rows             NUMBER;
    v_holdout_percent      NUMBER;
    v_max_input_rows       NUMBER;
    v_random_seed          NUMBER;
    v_requested_by         VARCHAR2(128);
    v_candidate_model_name VARCHAR2(128);
    v_model_version_id     NUMBER;
    v_version_no           NUMBER;
    v_total_rows           NUMBER;
    v_train_rows           NUMBER;
    v_holdout_rows         NUMBER;
    v_source_group_count   NUMBER;
    v_holdout_group_count  NUMBER;
    v_running_count        NUMBER;
    v_train_class_count    NUMBER;
    v_min_class_count      NUMBER;
    v_unseen_class_count   NUMBER;
    v_eligible_query       VARCHAR2(32767);
    v_feature_projection   VARCHAR2(32767);
    v_data_query           VARCHAR2(32767);
    v_holdout_query        VARCHAR2(32767);
    v_score_expr           VARCHAR2(32767);
    v_sql                  VARCHAR2(32767);
    v_error_message        VARCHAR2(4000);
    v_model_created        BOOLEAN := FALSE;
    v_run_loaded           BOOLEAN := FALSE;

    FUNCTION number_literal(p_value IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN TO_CHAR(p_value, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,');
    END;
BEGIN
    IF p_train_run_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20710, 'train_run_id is required.');
    END IF;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL QUERY';

    LOCK TABLE "INIT$_TB_OML_TRAIN_RUN" IN EXCLUSIVE MODE NOWAIT;

    BEGIN
        SELECT "MODEL_KEY"
             , UPPER("ALGORITHM_CODE")
             , "FEATURE_VERSION"
             , "LABEL_VERSION"
             , GREATEST(20, "MIN_TRAIN_ROWS")
             , LEAST(40, GREATEST(5, "HOLDOUT_PERCENT"))
             , LEAST(1000000, GREATEST(100, "MAX_INPUT_ROWS"))
             , NVL("RANDOM_SEED", 42)
             , SUBSTR(COALESCE(NULLIF(TRIM(p_requested_by), ''), "REQUESTED_BY", SYS_CONTEXT('USERENV', 'SESSION_USER')), 1, 128)
          INTO v_model_key
             , v_algorithm_code
             , v_feature_version
             , v_label_version
             , v_min_rows
             , v_holdout_percent
             , v_max_input_rows
             , v_random_seed
             , v_requested_by
          FROM "INIT$_TB_OML_TRAIN_RUN"
         WHERE "TRAIN_RUN_ID" = p_train_run_id
           AND "STATUS_CODE" = 'REQUESTED'
         FOR UPDATE;
        v_run_loaded := TRUE;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20716, 'Requested training run was not found or is not REQUESTED.');
    END;

    SELECT COUNT(*)
      INTO v_running_count
      FROM "INIT$_TB_OML_TRAIN_RUN"
     WHERE "MODEL_KEY" = v_model_key
       AND "STATUS_CODE" = 'RUNNING'
       AND "TRAIN_RUN_ID" <> p_train_run_id;

    IF v_running_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20711, 'Another training run is already running for ' || v_model_key || '.');
    END IF;
    IF v_algorithm_code NOT IN ('DECISION_TREE', 'RANDOM_FOREST') THEN
        RAISE_APPLICATION_ERROR(-20712, 'Unsupported algorithm. Use DECISION_TREE or RANDOM_FOREST.');
    END IF;
    IF v_feature_version <> 'V2' THEN
        RAISE_APPLICATION_ERROR(-20713, 'Unsupported feature version. Use V2.');
    END IF;

    UPDATE "INIT$_TB_OML_TRAIN_RUN"
       SET "STATUS_CODE" = 'RUNNING'
         , "REQUESTED_BY" = v_requested_by
         , "STARTED_AT" = SYSTIMESTAMP
         , "FINISHED_AT" = NULL
         , "ERROR_MESSAGE" = NULL
     WHERE "TRAIN_RUN_ID" = p_train_run_id;
    COMMIT;

    SELECT NVL(MAX("VERSION_NO"), 0) + 1
      INTO v_version_no
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_KEY" = v_model_key;

    v_candidate_model_name := SUBSTR('INIT$CT_V' || TO_CHAR(v_version_no) || '_R' || TO_CHAR(p_train_run_id), 1, 128);

    v_feature_projection :=
          '"CASE_ID", "DATA_TYPE", "TOTAL_ROWS", "NON_NULL_ROWS", "SAMPLE_ROWS", "SAMPLE_NOT_NULL_ROWS", '
        || '"NUM_DISTINCT", "SAMPLE_DISTINCT", "DIST_VAL_RT", "NULL_RATIO", "LOG_DATA_TYPE", "ENTROPY", '
        || '"NORM_ENTROPY", "NUMERIC_RATIO", "INTEGER_RATIO", "MIN_NUM_VALUE", "MAX_NUM_VALUE", '
        || '"AVG_TEXT_LENGTH", "MAX_TEXT_LENGTH", "TARGET_TYPE_CODE"';

    -- First select one immutable profile snapshot per confirmed label, then cap
    -- that deterministic eligible population. Train and holdout are split only
    -- after the cap, so both memory use and evaluation size remain bounded.
    v_eligible_query :=
        'SELECT * FROM (
             SELECT CAST(P."OWNER" || ''|'' || P."TABLE_NAME" || ''|'' || P."COLUMN_NAME" AS VARCHAR2(4000)) AS "CASE_ID"
                  , P."OWNER" AS "SOURCE_OWNER"
                  , P."TABLE_NAME" AS "SOURCE_TABLE"
                  , P."DATA_TYPE"
                  , P."TOTAL_ROWS"
                  , P."NON_NULL_ROWS"
                  , P."SAMPLE_ROWS"
                  , P."SAMPLE_NOT_NULL_ROWS"
                  , P."NUM_DISTINCT"
                  , P."SAMPLE_DISTINCT"
                  , P."DISTINCT_RATIO" AS "DIST_VAL_RT"
                  , P."NULL_RATIO"
                  , P."LOG_DATA_TYPE"
                  , P."ENTROPY"
                  , P."NORM_ENTROPY"
                  , P."NUMERIC_RATIO"
                  , P."INTEGER_RATIO"
                  , P."MIN_NUM_VALUE"
                  , P."MAX_NUM_VALUE"
                  , P."AVG_TEXT_LENGTH"
                  , P."MAX_TEXT_LENGTH"
                  , L."TYPE_CODE" AS "TARGET_TYPE_CODE"
               FROM "INIT$_TB_COLTYPE_LABEL" L
               JOIN "INIT$_TB_COLTYPE_PROFILE" P
                 ON P."PROFILE_ID" = NVL(
                        L."SOURCE_PROFILE_ID",
                        (
                         SELECT MAX(P0."PROFILE_ID") KEEP (DENSE_RANK LAST ORDER BY P0."CREATED_AT", P0."PROFILE_ID")
                           FROM "INIT$_TB_COLTYPE_PROFILE" P0
                          WHERE P0."OWNER" = L."OWNER"
                            AND P0."TABLE_NAME" = L."TABLE_NAME"
                            AND P0."COLUMN_NAME" = L."COLUMN_NAME"
                            AND P0."FEATURE_VERSION" = ''' || REPLACE(v_feature_version, '''', '''''') || '''
                        )
                    )
                AND P."OWNER" = L."OWNER"
                AND P."TABLE_NAME" = L."TABLE_NAME"
                AND P."COLUMN_NAME" = L."COLUMN_NAME"
                AND P."FEATURE_VERSION" = ''' || REPLACE(v_feature_version, '''', '''''') || '''
              WHERE L."CONFIRMED_YN" = ''Y''
                AND L."LABEL_SOURCE" IN (''USER_CONFIRMED'', ''IMPORTED_GOLD'')
              ORDER BY ORA_HASH(P."OWNER" || ''|'' || P."TABLE_NAME" || ''|'' || P."COLUMN_NAME", 4294967295, ' || number_literal(v_random_seed) || ')
                     , P."PROFILE_ID"
         ) WHERE ROWNUM <= ' || number_literal(v_max_input_rows);

    EXECUTE IMMEDIATE
        'SELECT COUNT(*) FROM ('
        || 'SELECT DISTINCT E."SOURCE_OWNER", E."SOURCE_TABLE" FROM (' || v_eligible_query || ') E)'
        INTO v_source_group_count;

    /*
       A hash-threshold split can put every small source-table population on one
       side of the holdout.  Keep the no-leakage table grouping, but rank the
       groups deterministically and reserve at least one group for validation.
    */
    IF v_source_group_count >= 2 THEN
        v_holdout_group_count := LEAST(
            v_source_group_count - 1,
            GREATEST(1, ROUND(v_source_group_count * v_holdout_percent / 100))
        );

        v_data_query :=
              'WITH E AS (' || v_eligible_query || ') '
            || ', G AS ('
            || 'SELECT "SOURCE_OWNER", "SOURCE_TABLE"'
            || '     , ROW_NUMBER() OVER ('
            || '           ORDER BY ORA_HASH("SOURCE_OWNER" || ''|'' || "SOURCE_TABLE", 4294967295, ' || number_literal(v_random_seed) || ')'
            || '                  , "SOURCE_OWNER", "SOURCE_TABLE") AS "GROUP_RN"'
            || '  FROM (SELECT DISTINCT "SOURCE_OWNER", "SOURCE_TABLE" FROM E)'
            || ') '
            || 'SELECT ' || v_feature_projection
            || '  FROM E JOIN G'
            || '    ON G."SOURCE_OWNER" = E."SOURCE_OWNER"'
            || '   AND G."SOURCE_TABLE" = E."SOURCE_TABLE"'
            || ' WHERE G."GROUP_RN" > ' || number_literal(v_holdout_group_count);

        v_holdout_query :=
              'WITH E AS (' || v_eligible_query || ') '
            || ', G AS ('
            || 'SELECT "SOURCE_OWNER", "SOURCE_TABLE"'
            || '     , ROW_NUMBER() OVER ('
            || '           ORDER BY ORA_HASH("SOURCE_OWNER" || ''|'' || "SOURCE_TABLE", 4294967295, ' || number_literal(v_random_seed) || ')'
            || '                  , "SOURCE_OWNER", "SOURCE_TABLE") AS "GROUP_RN"'
            || '  FROM (SELECT DISTINCT "SOURCE_OWNER", "SOURCE_TABLE" FROM E)'
            || ') '
            || 'SELECT ' || v_feature_projection
            || '  FROM E JOIN G'
            || '    ON G."SOURCE_OWNER" = E."SOURCE_OWNER"'
            || '   AND G."SOURCE_TABLE" = E."SOURCE_TABLE"'
            || ' WHERE G."GROUP_RN" <= ' || number_literal(v_holdout_group_count);
    ELSE
        v_data_query := 'SELECT ' || v_feature_projection || ' FROM (' || v_eligible_query || ') E';
        v_holdout_query := 'SELECT ' || v_feature_projection || ' FROM (' || v_eligible_query || ') E WHERE 1 = 0';
    END IF;

    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM (' || v_data_query || ')' INTO v_train_rows;
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM (' || v_holdout_query || ')' INTO v_holdout_rows;
    v_total_rows := v_train_rows + v_holdout_rows;

    IF v_total_rows < v_min_rows THEN
        RAISE_APPLICATION_ERROR(-20714, 'Confirmed gold labels are insufficient: ' || v_total_rows || ' < ' || v_min_rows);
    END IF;
    IF v_source_group_count < 2 THEN
        RAISE_APPLICATION_ERROR(-20715, 'Grouped holdout requires confirmed labels from at least two source tables. Eligible tables: ' || v_source_group_count || '.');
    END IF;
    IF v_train_rows = 0 OR v_holdout_rows = 0 THEN
        RAISE_APPLICATION_ERROR(-20715, 'Grouped holdout split produced an empty train or holdout set after deterministic group allocation.');
    END IF;

    EXECUTE IMMEDIATE
        'SELECT COUNT(*), MIN(CLASS_ROWS) FROM ('
        || 'SELECT "TARGET_TYPE_CODE", COUNT(*) CLASS_ROWS FROM (' || v_data_query || ') GROUP BY "TARGET_TYPE_CODE")'
        INTO v_train_class_count, v_min_class_count;
    IF v_train_class_count < 2 THEN
        RAISE_APPLICATION_ERROR(-20717, 'Training requires at least two confirmed type classes.');
    END IF;
    IF NVL(v_min_class_count, 0) < 2 THEN
        RAISE_APPLICATION_ERROR(-20718, 'Each training type class requires at least two confirmed columns.');
    END IF;

    EXECUTE IMMEDIATE
        'SELECT COUNT(*) FROM ('
        || 'SELECT DISTINCT "TARGET_TYPE_CODE" FROM (' || v_holdout_query || ') '
        || 'MINUS SELECT DISTINCT "TARGET_TYPE_CODE" FROM (' || v_data_query || '))'
        INTO v_unseen_class_count;
    IF v_unseen_class_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20725, 'Holdout contains a type class that is absent from training. Add labels from more tables.');
    END IF;

    v_setlist(DBMS_DATA_MINING.ALGO_NAME) := CASE
        WHEN v_algorithm_code = 'RANDOM_FOREST' THEN 'ALGO_RANDOM_FOREST'
        ELSE 'ALGO_DECISION_TREE'
    END;
    v_setlist('PREP_AUTO') := 'ON';

    DBMS_DATA_MINING.CREATE_MODEL2(
        MODEL_NAME          => v_candidate_model_name,
        MINING_FUNCTION     => DBMS_DATA_MINING.CLASSIFICATION,
        DATA_QUERY          => v_data_query,
        SET_LIST            => v_setlist,
        CASE_ID_COLUMN_NAME => 'CASE_ID',
        TARGET_COLUMN_NAME  => 'TARGET_TYPE_CODE'
    );
    v_model_created := TRUE;

    INSERT INTO "INIT$_TB_OML_MODEL_REGISTRY" (
        "MODEL_KEY", "VERSION_NO", "PHYSICAL_MODEL_NAME", "ALGORITHM_CODE", "FEATURE_VERSION",
        "LABEL_VERSION", "STATUS_CODE", "TRAIN_RUN_ID", "TRAIN_ROW_COUNT", "VALID_ROW_COUNT",
        "TEST_ROW_COUNT", "CREATED_BY", "CREATED_AT"
    ) VALUES (
        v_model_key, v_version_no, v_candidate_model_name, v_algorithm_code, v_feature_version,
        v_label_version, 'CANDIDATE', p_train_run_id, v_train_rows, v_holdout_rows,
        0, v_requested_by, SYSTIMESTAMP
    ) RETURNING "MODEL_VERSION_ID" INTO v_model_version_id;

    v_score_expr := 'PREDICTION(' || v_candidate_model_name || ' USING '
        || '"DATA_TYPE" AS "DATA_TYPE", "TOTAL_ROWS" AS "TOTAL_ROWS", "NON_NULL_ROWS" AS "NON_NULL_ROWS", '
        || '"SAMPLE_ROWS" AS "SAMPLE_ROWS", "SAMPLE_NOT_NULL_ROWS" AS "SAMPLE_NOT_NULL_ROWS", '
        || '"NUM_DISTINCT" AS "NUM_DISTINCT", "SAMPLE_DISTINCT" AS "SAMPLE_DISTINCT", "DIST_VAL_RT" AS "DIST_VAL_RT", '
        || '"NULL_RATIO" AS "NULL_RATIO", "LOG_DATA_TYPE" AS "LOG_DATA_TYPE", "ENTROPY" AS "ENTROPY", '
        || '"NORM_ENTROPY" AS "NORM_ENTROPY", "NUMERIC_RATIO" AS "NUMERIC_RATIO", "INTEGER_RATIO" AS "INTEGER_RATIO", '
        || '"MIN_NUM_VALUE" AS "MIN_NUM_VALUE", "MAX_NUM_VALUE" AS "MAX_NUM_VALUE", '
        || '"AVG_TEXT_LENGTH" AS "AVG_TEXT_LENGTH", "MAX_TEXT_LENGTH" AS "MAX_TEXT_LENGTH")';

    v_sql := 'INSERT INTO "INIT$_TB_OML_MODEL_METRIC" '
        || '("MODEL_VERSION_ID", "SPLIT_CODE", "METRIC_NAME", "METRIC_VALUE", "SUPPORT_COUNT") '
        || 'SELECT ' || number_literal(v_model_version_id) || ', ''HOLDOUT'', ''ACCURACY'', '
        || 'AVG(CASE WHEN ACTUAL_TYPE = PREDICTED_TYPE THEN 1 ELSE 0 END), COUNT(*) '
        || 'FROM (SELECT "TARGET_TYPE_CODE" ACTUAL_TYPE, ' || v_score_expr || ' PREDICTED_TYPE FROM (' || v_holdout_query || '))';
    EXECUTE IMMEDIATE v_sql;

    v_sql := 'INSERT INTO "INIT$_TB_OML_MODEL_METRIC" '
        || '("MODEL_VERSION_ID", "SPLIT_CODE", "ACTUAL_CLASS_CODE", "CLASS_GROUP_CODE", "METRIC_NAME", "METRIC_VALUE", "SUPPORT_COUNT") '
        || 'WITH E AS (SELECT "TARGET_TYPE_CODE" A, ' || v_score_expr || ' P FROM (' || v_holdout_query || ')), '
        || 'C AS (SELECT A TYPE_CODE FROM E UNION SELECT P FROM E), M AS ('
        || 'SELECT C.TYPE_CODE, SUM(CASE WHEN E.A=C.TYPE_CODE AND E.P=C.TYPE_CODE THEN 1 ELSE 0 END) TP, '
        || 'SUM(CASE WHEN E.A<>C.TYPE_CODE AND E.P=C.TYPE_CODE THEN 1 ELSE 0 END) FP, '
        || 'SUM(CASE WHEN E.A=C.TYPE_CODE AND E.P<>C.TYPE_CODE THEN 1 ELSE 0 END) FN, '
        || 'SUM(CASE WHEN E.A=C.TYPE_CODE THEN 1 ELSE 0 END) SUPPORT FROM C CROSS JOIN E GROUP BY C.TYPE_CODE) '
        || 'SELECT ' || number_literal(v_model_version_id) || ', ''HOLDOUT'', TYPE_CODE, "INIT$_FN_TYPE_GROUP_CODE"(TYPE_CODE), ''PRECISION'', '
        || 'CASE WHEN (TP+FP)=0 THEN 0 ELSE TP/(TP+FP) END, SUPPORT FROM M UNION ALL '
        || 'SELECT ' || number_literal(v_model_version_id) || ', ''HOLDOUT'', TYPE_CODE, "INIT$_FN_TYPE_GROUP_CODE"(TYPE_CODE), ''RECALL'', '
        || 'CASE WHEN (TP+FN)=0 THEN 0 ELSE TP/(TP+FN) END, SUPPORT FROM M UNION ALL '
        || 'SELECT ' || number_literal(v_model_version_id) || ', ''HOLDOUT'', TYPE_CODE, "INIT$_FN_TYPE_GROUP_CODE"(TYPE_CODE), ''F1'', '
        || 'CASE WHEN (2*TP+FP+FN)=0 THEN 0 ELSE (2*TP)/(2*TP+FP+FN) END, SUPPORT FROM M';
    EXECUTE IMMEDIATE v_sql;

    v_sql := 'INSERT INTO "INIT$_TB_OML_MODEL_METRIC" '
        || '("MODEL_VERSION_ID", "SPLIT_CODE", "ACTUAL_CLASS_CODE", "PREDICTED_CLASS_CODE", "CLASS_GROUP_CODE", "METRIC_NAME", "METRIC_VALUE", "SUPPORT_COUNT") '
        || 'WITH E AS (SELECT "TARGET_TYPE_CODE" A, ' || v_score_expr || ' P FROM (' || v_holdout_query || ')) '
        || 'SELECT ' || number_literal(v_model_version_id) || ', ''HOLDOUT'', A, P, "INIT$_FN_TYPE_GROUP_CODE"(A), ''CONFUSION'', '
        || 'COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY A) FROM E GROUP BY A, P';
    EXECUTE IMMEDIATE v_sql;

    UPDATE "INIT$_TB_OML_MODEL_REGISTRY"
       SET "ACCURACY" = (
               SELECT MAX("METRIC_VALUE") FROM "INIT$_TB_OML_MODEL_METRIC"
                WHERE "MODEL_VERSION_ID" = v_model_version_id AND "METRIC_NAME" = 'ACCURACY'
           )
         , "MACRO_F1" = (
               SELECT AVG("METRIC_VALUE") FROM "INIT$_TB_OML_MODEL_METRIC"
                WHERE "MODEL_VERSION_ID" = v_model_version_id AND "METRIC_NAME" = 'F1'
           )
         , "BALANCED_ACCURACY" = (
               SELECT AVG("METRIC_VALUE") FROM "INIT$_TB_OML_MODEL_METRIC"
                WHERE "MODEL_VERSION_ID" = v_model_version_id
                  AND "METRIC_NAME" = 'RECALL'
                  AND NVL("SUPPORT_COUNT", 0) > 0
           )
     WHERE "MODEL_VERSION_ID" = v_model_version_id;

    INSERT INTO "INIT$_TB_OML_MODEL_METRIC" (
        "MODEL_VERSION_ID", "SPLIT_CODE", "METRIC_NAME", "METRIC_VALUE", "SUPPORT_COUNT"
    )
    SELECT "MODEL_VERSION_ID", 'HOLDOUT', 'BALANCED_ACCURACY', "BALANCED_ACCURACY", v_holdout_rows
      FROM "INIT$_TB_OML_MODEL_REGISTRY" WHERE "MODEL_VERSION_ID" = v_model_version_id
    UNION ALL
    SELECT "MODEL_VERSION_ID", 'HOLDOUT', 'MACRO_F1', "MACRO_F1", v_holdout_rows
      FROM "INIT$_TB_OML_MODEL_REGISTRY" WHERE "MODEL_VERSION_ID" = v_model_version_id;

    v_sql := 'INSERT INTO "INIT$_TB_OML_MODEL_METRIC" '
        || '("MODEL_VERSION_ID", "SPLIT_CODE", "CLASS_GROUP_CODE", "METRIC_NAME", "METRIC_VALUE", "SUPPORT_COUNT") '
        || 'SELECT ' || number_literal(v_model_version_id) || ', ''HOLDOUT'', ACTUAL_GROUP, ''GROUP_ACCURACY'', '
        || 'AVG(CASE WHEN ACTUAL_GROUP=PREDICTED_GROUP THEN 1 ELSE 0 END), COUNT(*) FROM ('
        || 'SELECT "INIT$_FN_TYPE_GROUP_CODE"("TARGET_TYPE_CODE") ACTUAL_GROUP, '
        || '"INIT$_FN_TYPE_GROUP_CODE"(' || v_score_expr || ') PREDICTED_GROUP FROM (' || v_holdout_query || ')) '
        || 'GROUP BY ACTUAL_GROUP';
    EXECUTE IMMEDIATE v_sql;

    UPDATE "INIT$_TB_OML_TRAIN_RUN"
       SET "STATUS_CODE" = 'SUCCESS'
         , "CANDIDATE_MODEL_NAME" = v_candidate_model_name
         , "MODEL_VERSION_ID" = v_model_version_id
         , "TRAIN_ROW_COUNT" = v_train_rows
         , "VALID_ROW_COUNT" = v_holdout_rows
         , "TEST_ROW_COUNT" = 0
         , "FINISHED_AT" = SYSTIMESTAMP
     WHERE "TRAIN_RUN_ID" = p_train_run_id;
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        v_error_message := SUBSTR(SQLERRM || CHR(10) || DBMS_UTILITY.FORMAT_ERROR_BACKTRACE, 1, 4000);
        ROLLBACK;
        IF v_model_created THEN
            BEGIN
                DBMS_DATA_MINING.DROP_MODEL(v_candidate_model_name);
            EXCEPTION
                WHEN OTHERS THEN NULL;
            END;
        END IF;
        IF v_run_loaded THEN
            UPDATE "INIT$_TB_OML_TRAIN_RUN"
               SET "STATUS_CODE" = 'FAILED'
                 , "CANDIDATE_MODEL_NAME" = v_candidate_model_name
                 , "ERROR_MESSAGE" = v_error_message
                 , "FINISHED_AT" = SYSTIMESTAMP
             WHERE "TRAIN_RUN_ID" = p_train_run_id;
            COMMIT;
        END IF;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_TYPE_MODEL_ACTIVATE" (
    p_model_version_id IN NUMBER,
    p_user_id          IN VARCHAR2
) AUTHID CURRENT_USER IS
    v_model_key        VARCHAR2(100);
    v_status_code      VARCHAR2(20);
    v_model_name       VARCHAR2(128);
    v_previous_id      NUMBER;
    v_previous_count   NUMBER;
    v_model_count      NUMBER;
    v_user_id          VARCHAR2(128) := SUBSTR(COALESCE(NULLIF(TRIM(p_user_id), ''), SYS_CONTEXT('USERENV', 'SESSION_USER')), 1, 128);
BEGIN
    SELECT "MODEL_KEY"
      INTO v_model_key
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_VERSION_ID" = p_model_version_id;

    -- All activation/rollback/archive operations for the same logical model
    -- acquire registry rows in the same order before touching the active pointer.
    FOR R IN (
        SELECT "MODEL_VERSION_ID"
          FROM "INIT$_TB_OML_MODEL_REGISTRY"
         WHERE "MODEL_KEY" = v_model_key
         ORDER BY "MODEL_VERSION_ID"
         FOR UPDATE
    ) LOOP
        NULL;
    END LOOP;

    SELECT "STATUS_CODE", "PHYSICAL_MODEL_NAME"
      INTO v_status_code, v_model_name
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_VERSION_ID" = p_model_version_id
       AND "MODEL_KEY" = v_model_key;
    IF v_status_code NOT IN ('CANDIDATE', 'ARCHIVED', 'ACTIVE') THEN
        RAISE_APPLICATION_ERROR(-20719, 'Only CANDIDATE, ARCHIVED, or ACTIVE models can be activated.');
    END IF;

    SELECT COUNT(*) INTO v_model_count FROM USER_MINING_MODELS WHERE MODEL_NAME = UPPER(v_model_name);
    IF v_model_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20720, 'Physical model does not exist: ' || v_model_name);
    END IF;

    BEGIN
        SELECT "MODEL_VERSION_ID" INTO v_previous_id
          FROM "INIT$_TB_OML_ACTIVE_MODEL"
         WHERE "MODEL_KEY" = v_model_key
         FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN v_previous_id := NULL;
    END;

    IF v_previous_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_previous_count
          FROM "INIT$_TB_OML_MODEL_REGISTRY"
         WHERE "MODEL_VERSION_ID" = v_previous_id
           AND "MODEL_KEY" = v_model_key;
        IF v_previous_count <> 1 THEN
            RAISE_APPLICATION_ERROR(-20720, 'Active model pointer does not match the model registry.');
        END IF;
    END IF;

    UPDATE "INIT$_TB_OML_MODEL_REGISTRY"
       SET "STATUS_CODE" = 'ARCHIVED'
         , "ARCHIVED_BY" = v_user_id
         , "ARCHIVED_AT" = SYSTIMESTAMP
     WHERE "MODEL_KEY" = v_model_key
       AND "STATUS_CODE" = 'ACTIVE'
       AND "MODEL_VERSION_ID" <> p_model_version_id;

    UPDATE "INIT$_TB_OML_MODEL_REGISTRY"
       SET "STATUS_CODE" = 'ACTIVE'
         , "ACTIVATED_BY" = v_user_id
         , "ACTIVATED_AT" = SYSTIMESTAMP
         , "ARCHIVED_BY" = NULL
         , "ARCHIVED_AT" = NULL
     WHERE "MODEL_VERSION_ID" = p_model_version_id;

    MERGE INTO "INIT$_TB_OML_ACTIVE_MODEL" T
    USING (SELECT v_model_key "MODEL_KEY" FROM DUAL) S
       ON (T."MODEL_KEY" = S."MODEL_KEY")
     WHEN MATCHED THEN UPDATE SET
          T."PREVIOUS_MODEL_VERSION_ID" = CASE WHEN T."MODEL_VERSION_ID" <> p_model_version_id THEN T."MODEL_VERSION_ID" ELSE T."PREVIOUS_MODEL_VERSION_ID" END
        , T."MODEL_VERSION_ID" = p_model_version_id
        , T."UPDATED_BY" = v_user_id
        , T."UPDATED_AT" = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT ("MODEL_KEY", "MODEL_VERSION_ID", "PREVIOUS_MODEL_VERSION_ID", "UPDATED_BY", "UPDATED_AT")
          VALUES (v_model_key, p_model_version_id, NULL, v_user_id, SYSTIMESTAMP);

    INSERT INTO "INIT$_TB_OML_MODEL_DEPLOY_HIST" (
        "MODEL_KEY", "MODEL_VERSION_ID", "PREVIOUS_MODEL_VERSION_ID", "ACTION_CODE", "ACTION_BY", "ACTION_AT"
    ) VALUES (v_model_key, p_model_version_id, v_previous_id, 'ACTIVATE', v_user_id, SYSTIMESTAMP);
    COMMIT;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_TYPE_MODEL_ARCHIVE" (
    p_model_version_id IN NUMBER,
    p_user_id          IN VARCHAR2
) AUTHID CURRENT_USER IS
    v_model_key VARCHAR2(100);
    v_status    VARCHAR2(20);
    v_active_count NUMBER;
    v_user_id   VARCHAR2(128) := SUBSTR(COALESCE(NULLIF(TRIM(p_user_id), ''), SYS_CONTEXT('USERENV', 'SESSION_USER')), 1, 128);
BEGIN
    SELECT "MODEL_KEY" INTO v_model_key
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_VERSION_ID" = p_model_version_id;

    FOR R IN (
        SELECT "MODEL_VERSION_ID"
          FROM "INIT$_TB_OML_MODEL_REGISTRY"
         WHERE "MODEL_KEY" = v_model_key
         ORDER BY "MODEL_VERSION_ID"
         FOR UPDATE
    ) LOOP
        NULL;
    END LOOP;

    SELECT "STATUS_CODE" INTO v_status
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_VERSION_ID" = p_model_version_id
       AND "MODEL_KEY" = v_model_key;
    SELECT COUNT(*) INTO v_active_count
      FROM "INIT$_TB_OML_ACTIVE_MODEL"
     WHERE "MODEL_KEY" = v_model_key
       AND "MODEL_VERSION_ID" = p_model_version_id;
    IF v_status = 'ACTIVE' OR v_active_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20721, 'Active model cannot be archived. Activate another model first.');
    END IF;
    IF v_status NOT IN ('CANDIDATE', 'ARCHIVED') THEN
        RAISE_APPLICATION_ERROR(-20721, 'Only candidate or archived models can be archived.');
    END IF;
    UPDATE "INIT$_TB_OML_MODEL_REGISTRY"
       SET "STATUS_CODE" = 'ARCHIVED', "ARCHIVED_BY" = v_user_id, "ARCHIVED_AT" = SYSTIMESTAMP
     WHERE "MODEL_VERSION_ID" = p_model_version_id;
    INSERT INTO "INIT$_TB_OML_MODEL_DEPLOY_HIST" (
        "MODEL_KEY", "MODEL_VERSION_ID", "ACTION_CODE", "ACTION_BY", "ACTION_AT"
    ) VALUES (v_model_key, p_model_version_id, 'ARCHIVE', v_user_id, SYSTIMESTAMP);
    COMMIT;
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_TYPE_MODEL_ROLLBACK" (
    p_user_id   IN VARCHAR2,
    p_model_key IN VARCHAR2 DEFAULT 'COLUMN_TYPE'
) AUTHID CURRENT_USER IS
    v_model_key   VARCHAR2(100) := UPPER(TRIM(NVL(p_model_key, 'COLUMN_TYPE')));
    v_current_id  NUMBER;
    v_previous_id NUMBER;
    v_previous_status VARCHAR2(20);
    v_previous_model_name VARCHAR2(128);
    v_model_count NUMBER;
    v_current_count NUMBER;
    v_user_id     VARCHAR2(128) := SUBSTR(COALESCE(NULLIF(TRIM(p_user_id), ''), SYS_CONTEXT('USERENV', 'SESSION_USER')), 1, 128);
BEGIN
    FOR R IN (
        SELECT "MODEL_VERSION_ID"
          FROM "INIT$_TB_OML_MODEL_REGISTRY"
         WHERE "MODEL_KEY" = v_model_key
         ORDER BY "MODEL_VERSION_ID"
         FOR UPDATE
    ) LOOP
        NULL;
    END LOOP;

    SELECT "MODEL_VERSION_ID", "PREVIOUS_MODEL_VERSION_ID"
      INTO v_current_id, v_previous_id
      FROM "INIT$_TB_OML_ACTIVE_MODEL"
     WHERE "MODEL_KEY" = v_model_key
     FOR UPDATE;
    IF v_previous_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20722, 'No previous model version is available for rollback.');
    END IF;
    IF v_previous_id = v_current_id THEN
        RAISE_APPLICATION_ERROR(-20722, 'Previous model version must differ from the active model.');
    END IF;

    SELECT COUNT(*) INTO v_current_count
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_VERSION_ID" = v_current_id
       AND "MODEL_KEY" = v_model_key;
    IF v_current_count <> 1 THEN
        RAISE_APPLICATION_ERROR(-20723, 'Active model pointer does not match the model registry.');
    END IF;

    SELECT "STATUS_CODE", "PHYSICAL_MODEL_NAME"
      INTO v_previous_status, v_previous_model_name
      FROM "INIT$_TB_OML_MODEL_REGISTRY"
     WHERE "MODEL_VERSION_ID" = v_previous_id
       AND "MODEL_KEY" = v_model_key;
    IF v_previous_status NOT IN ('CANDIDATE', 'ARCHIVED', 'ACTIVE') THEN
        RAISE_APPLICATION_ERROR(-20723, 'Previous model version is not deployable.');
    END IF;
    SELECT COUNT(*) INTO v_model_count
      FROM USER_MINING_MODELS
     WHERE MODEL_NAME = UPPER(v_previous_model_name);
    IF v_model_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20724, 'Previous physical model does not exist: ' || v_previous_model_name);
    END IF;

    UPDATE "INIT$_TB_OML_MODEL_REGISTRY"
       SET "STATUS_CODE" = 'ARCHIVED', "ARCHIVED_BY" = v_user_id, "ARCHIVED_AT" = SYSTIMESTAMP
     WHERE "MODEL_KEY" = v_model_key
       AND "STATUS_CODE" = 'ACTIVE'
       AND "MODEL_VERSION_ID" <> v_previous_id;
    UPDATE "INIT$_TB_OML_MODEL_REGISTRY"
       SET "STATUS_CODE" = 'ACTIVE', "ACTIVATED_BY" = v_user_id, "ACTIVATED_AT" = SYSTIMESTAMP,
           "ARCHIVED_BY" = NULL, "ARCHIVED_AT" = NULL
     WHERE "MODEL_VERSION_ID" = v_previous_id;
    UPDATE "INIT$_TB_OML_ACTIVE_MODEL"
       SET "MODEL_VERSION_ID" = v_previous_id
         , "PREVIOUS_MODEL_VERSION_ID" = v_current_id
         , "UPDATED_BY" = v_user_id
         , "UPDATED_AT" = SYSTIMESTAMP
     WHERE "MODEL_KEY" = v_model_key;
    INSERT INTO "INIT$_TB_OML_MODEL_DEPLOY_HIST" (
        "MODEL_KEY", "MODEL_VERSION_ID", "PREVIOUS_MODEL_VERSION_ID", "ACTION_CODE", "ACTION_BY", "ACTION_AT"
    ) VALUES (v_model_key, v_previous_id, v_current_id, 'ROLLBACK', v_user_id, SYSTIMESTAMP);
    COMMIT;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TYPE_CODE" (
    p_type_value IN VARCHAR2
) RETURN VARCHAR2
AUTHID CURRENT_USER
DETERMINISTIC
IS
    v_value VARCHAR2(4000) := UPPER(TRIM(p_type_value));
BEGIN
    RETURN CASE v_value
        WHEN '숫자형식별자' THEN 'NUM_IDENTIFIER'
        WHEN 'NUM_IDENTIFIER' THEN 'NUM_IDENTIFIER'
        WHEN 'NUMERIC IDENTIFIER' THEN 'NUM_IDENTIFIER'
        WHEN '문자형식별자' THEN 'CHAR_IDENTIFIER'
        WHEN 'CHAR_IDENTIFIER' THEN 'CHAR_IDENTIFIER'
        WHEN 'CHARACTER IDENTIFIER' THEN 'CHAR_IDENTIFIER'
        WHEN '숫자형연속형' THEN 'NUM_CONTINUOUS'
        WHEN 'NUM_CONTINUOUS' THEN 'NUM_CONTINUOUS'
        WHEN 'NUMERIC CONTINUOUS' THEN 'NUM_CONTINUOUS'
        WHEN '이산형연속형' THEN 'NUM_DISCRETE'
        WHEN 'NUM_DISCRETE' THEN 'NUM_DISCRETE'
        WHEN 'NUMERIC DISCRETE' THEN 'NUM_DISCRETE'
        WHEN '일반적범주형' THEN 'CAT_GENERAL'
        WHEN 'CAT_GENERAL' THEN 'CAT_GENERAL'
        WHEN 'GENERAL CATEGORICAL' THEN 'CAT_GENERAL'
        WHEN '문자형범주형' THEN 'CAT_CHAR'
        WHEN 'CAT_CHAR' THEN 'CAT_CHAR'
        WHEN 'CHARACTER CATEGORICAL' THEN 'CAT_CHAR'
        WHEN '순서형범주형' THEN 'CAT_ORDINAL'
        WHEN 'CAT_ORDINAL' THEN 'CAT_ORDINAL'
        WHEN 'ORDINAL CATEGORICAL' THEN 'CAT_ORDINAL'
        WHEN '숫자형범주형' THEN 'CAT_NUMERIC'
        WHEN 'CAT_NUMERIC' THEN 'CAT_NUMERIC'
        WHEN 'NUMERIC CATEGORICAL' THEN 'CAT_NUMERIC'
        WHEN '단순형텍스트' THEN 'FREE_TEXT'
        WHEN 'FREE_TEXT' THEN 'FREE_TEXT'
        WHEN 'FREE TEXT' THEN 'FREE_TEXT'
        WHEN '기타데이터형' THEN 'OTHER'
        WHEN 'OTHER' THEN 'OTHER'
        WHEN '미상데이터형' THEN 'UNKNOWN'
        WHEN 'UNKNOWN' THEN 'UNKNOWN'
        ELSE 'UNKNOWN'
    END;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TYPE_LABEL" (
    p_type_code IN VARCHAR2,
    p_language  IN VARCHAR2 DEFAULT 'KOR'
) RETURN VARCHAR2
AUTHID CURRENT_USER
DETERMINISTIC
IS
    v_code VARCHAR2(40) := "INIT$_FN_TYPE_CODE"(p_type_code);
    v_lang VARCHAR2(10) := UPPER(TRIM(NVL(p_language, 'KOR')));
BEGIN
    IF v_lang IN ('ENG', 'EN', 'ENGLISH') THEN
        RETURN CASE v_code
            WHEN 'NUM_IDENTIFIER' THEN 'Numeric identifier'
            WHEN 'CHAR_IDENTIFIER' THEN 'Character identifier'
            WHEN 'NUM_CONTINUOUS' THEN 'Numeric continuous'
            WHEN 'NUM_DISCRETE' THEN 'Numeric discrete'
            WHEN 'CAT_GENERAL' THEN 'General categorical'
            WHEN 'CAT_CHAR' THEN 'Character categorical'
            WHEN 'CAT_ORDINAL' THEN 'Ordinal categorical'
            WHEN 'CAT_NUMERIC' THEN 'Numeric categorical'
            WHEN 'FREE_TEXT' THEN 'Free text'
            WHEN 'OTHER' THEN 'Other'
            ELSE 'Unknown'
        END;
    END IF;

    RETURN CASE v_code
        WHEN 'NUM_IDENTIFIER' THEN '숫자형식별자'
        WHEN 'CHAR_IDENTIFIER' THEN '문자형식별자'
        WHEN 'NUM_CONTINUOUS' THEN '숫자형연속형'
        WHEN 'NUM_DISCRETE' THEN '이산형연속형'
        WHEN 'CAT_GENERAL' THEN '일반적범주형'
        WHEN 'CAT_CHAR' THEN '문자형범주형'
        WHEN 'CAT_ORDINAL' THEN '순서형범주형'
        WHEN 'CAT_NUMERIC' THEN '숫자형범주형'
        WHEN 'FREE_TEXT' THEN '단순형텍스트'
        WHEN 'OTHER' THEN '기타데이터형'
        ELSE '미상데이터형'
    END;
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TYPE_GROUP_CODE" (
    p_type_value IN VARCHAR2
) RETURN VARCHAR2
AUTHID CURRENT_USER
DETERMINISTIC
IS
    v_code VARCHAR2(40) := "INIT$_FN_TYPE_CODE"(p_type_value);
BEGIN
    IF v_code IN ('NUM_CONTINUOUS', 'NUM_DISCRETE') THEN
        RETURN 'CONTINUOUS';
    ELSIF v_code IN ('CAT_GENERAL', 'CAT_CHAR', 'CAT_ORDINAL', 'CAT_NUMERIC') THEN
        RETURN 'CATEGORICAL';
    END IF;
    RETURN 'OTHER';
END;
/

CREATE OR REPLACE FUNCTION "INIT$_FN_TYPE_GROUP_LABEL" (
    p_group_code IN VARCHAR2,
    p_language   IN VARCHAR2 DEFAULT 'KOR'
) RETURN VARCHAR2
AUTHID CURRENT_USER
DETERMINISTIC
IS
    v_group VARCHAR2(20) := UPPER(TRIM(NVL(p_group_code, 'OTHER')));
    v_lang  VARCHAR2(10) := UPPER(TRIM(NVL(p_language, 'KOR')));
BEGIN
    IF v_lang IN ('ENG', 'EN', 'ENGLISH') THEN
        RETURN CASE v_group
            WHEN 'CATEGORICAL' THEN 'Categorical'
            WHEN 'CONTINUOUS' THEN 'Continuous'
            ELSE 'Other'
        END;
    END IF;
    RETURN CASE v_group
        WHEN 'CATEGORICAL' THEN '범주형'
        WHEN 'CONTINUOUS' THEN '연속형'
        ELSE '기타'
    END;
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
    v_numeric_ratio_threshold NUMBER;
BEGIN
    v_data_type := UPPER(TRIM(p_data_type));
    v_numeric_types := "INIT$_FN_TARGET_SETTING_VALUE"('DATA_PROFILING', 'NUMERIC_TYPES', 'NUMBER,FLOAT');
    v_numeric_ratio_threshold := "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'NUMERIC_CONVERT_RATIO', 0.98);

    IF "INIT$_FN_TOKEN_LIST_CONTAINS"(v_numeric_types, v_data_type) = 'Y' THEN
        RETURN 'NUM';
    END IF;

    IF NVL(p_sample_not_null_count, 0) = 0 THEN
        RETURN 'ETC';
    END IF;

    IF NVL(p_numeric_convertible_count, 0) / NULLIF(p_sample_not_null_count, 0)
       >= LEAST(1, GREATEST(0.5, v_numeric_ratio_threshold)) THEN
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

CREATE OR REPLACE PROCEDURE "INIT$_SP_COLUMN_TYPE_CONFIRM" (
    p_owner            IN VARCHAR2,
    p_table_name       IN VARCHAR2,
    p_column_name      IN VARCHAR2,
    p_display_type     IN VARCHAR2,
    p_reason           IN VARCHAR2 DEFAULT NULL,
    p_run_source_type  IN VARCHAR2 DEFAULT NULL,
    p_run_id           IN NUMBER   DEFAULT NULL,
    p_model_name       IN VARCHAR2 DEFAULT NULL,
    p_user_id          IN VARCHAR2 DEFAULT NULL,
    p_label_source     IN VARCHAR2 DEFAULT 'USER_CONFIRMED'
) AUTHID CURRENT_USER IS
    v_owner              VARCHAR2(128);
    v_table_name         VARCHAR2(128);
    v_column_name        VARCHAR2(128);
    v_type_code          VARCHAR2(40);
    v_group_code         VARCHAR2(20);
    v_display_type       VARCHAR2(4000);
    v_label_source       VARCHAR2(30);
    v_confirmed_by       VARCHAR2(128);
    v_run_source_type    VARCHAR2(30);
    v_label_id           NUMBER;
    v_profile_id         NUMBER;
    v_column_desc        VARCHAR2(4000);
    v_column_id          NUMBER;
    v_data_type          VARCHAR2(128);
    v_prev_type_code     VARCHAR2(40);
    v_prev_group_code    VARCHAR2(20);
    v_prev_display_value VARCHAR2(4000);

    FUNCTION normalize_identifier(p_value IN VARCHAR2, p_label IN VARCHAR2) RETURN VARCHAR2 IS
        v_value VARCHAR2(128) := UPPER(TRIM(BOTH '"' FROM TRIM(p_value)));
    BEGIN
        IF v_value IS NULL OR NOT REGEXP_LIKE(v_value, '^[A-Z][A-Z0-9_$#]{0,127}$') THEN
            RAISE_APPLICATION_ERROR(-20701, 'Invalid ' || p_label || '.');
        END IF;
        RETURN v_value;
    END;
BEGIN
    v_owner := normalize_identifier(p_owner, 'owner');
    v_table_name := normalize_identifier(p_table_name, 'table_name');
    v_column_name := normalize_identifier(p_column_name, 'column_name');
    v_type_code := "INIT$_FN_TYPE_CODE"(p_display_type);
    v_group_code := "INIT$_FN_TYPE_GROUP_CODE"(v_type_code);
    v_display_type := COALESCE(NULLIF(TRIM(p_display_type), ''), "INIT$_FN_TYPE_LABEL"(v_type_code, 'KOR'));
    v_label_source := UPPER(TRIM(NVL(p_label_source, 'USER_CONFIRMED')));
    v_confirmed_by := SUBSTR(COALESCE(NULLIF(TRIM(p_user_id), ''), SYS_CONTEXT('USERENV', 'SESSION_USER')), 1, 128);
    v_run_source_type := CASE
        WHEN UPPER(TRIM(p_run_source_type)) IN ('DATA_WORK', 'FLOW_WORK') THEN UPPER(TRIM(p_run_source_type))
        ELSE NULL
    END;

    IF NULLIF(TRIM(p_run_source_type), '') IS NOT NULL AND v_run_source_type IS NULL THEN
        RAISE_APPLICATION_ERROR(-20704, 'run_source_type must be DATA_WORK or FLOW_WORK.');
    END IF;

    BEGIN
        SELECT C."COLUMN_ID"
             , C."DATA_TYPE"
             , M."COMMENTS"
          INTO v_column_id
             , v_data_type
             , v_column_desc
          FROM ALL_TAB_COLUMNS C
          LEFT JOIN ALL_COL_COMMENTS M
            ON M."OWNER" = C."OWNER"
           AND M."TABLE_NAME" = C."TABLE_NAME"
           AND M."COLUMN_NAME" = C."COLUMN_NAME"
         WHERE C."OWNER" = v_owner
           AND C."TABLE_NAME" = v_table_name
           AND C."COLUMN_NAME" = v_column_name;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20705, 'Target column was not found.');
    END;

    IF v_label_source NOT IN ('USER_CONFIRMED', 'IMPORTED_GOLD') THEN
        RAISE_APPLICATION_ERROR(-20702, 'Explicit confirmation source must be USER_CONFIRMED or IMPORTED_GOLD.');
    END IF;

    -- An empty final type is an explicit user action to remove a prior
    -- confirmation.  Do not substitute the latest rule/model prediction:
    -- doing so makes a cleared value appear to have been saved while it is
    -- still a training label.  The final master remains as an unconfirmed
    -- record for provenance, while the trusted-label corpus entry is removed.
    IF NULLIF(TRIM(p_display_type), '') IS NULL THEN
        UPDATE "INIT$_TB_COLTYPE_FINAL"
           SET "FINAL_PREDICTED_TYPE" = NULL
             , "FINAL_TYPE_CODE" = NULL
             , "TYPE_GROUP_CODE" = NULL
             , "LABEL_SOURCE" = 'LEGACY_UNKNOWN'
             , "CONFIRMED_YN" = 'N'
             , "FINAL_REASON" = SUBSTR(p_reason, 1, 1000)
             , "FINAL_UPDATE_DT" = SYSDATE
             , "FINAL_UPDATE_USER" = v_confirmed_by
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "COLUMN_NAME" = v_column_name;

        DELETE FROM "INIT$_TB_COLTYPE_LABEL"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "COLUMN_NAME" = v_column_name;
        RETURN;
    END IF;

    IF v_type_code = 'UNKNOWN' AND UPPER(TRIM(NVL(p_display_type, ''))) NOT IN ('UNKNOWN', '미상데이터형') THEN
        RAISE_APPLICATION_ERROR(-20703, 'Unsupported column type value.');
    END IF;

    BEGIN
        SELECT "LABEL_ID"
             , "TYPE_CODE"
             , "TYPE_GROUP_CODE"
             , "DISPLAY_TYPE_VALUE"
          INTO v_label_id
             , v_prev_type_code
             , v_prev_group_code
             , v_prev_display_value
          FROM "INIT$_TB_COLTYPE_LABEL"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "COLUMN_NAME" = v_column_name
         FOR UPDATE;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_label_id := NULL;
    END;

    BEGIN
        SELECT MAX("PROFILE_ID") KEEP (DENSE_RANK LAST ORDER BY "CREATED_AT", "PROFILE_ID")
          INTO v_profile_id
          FROM "INIT$_TB_COLTYPE_PROFILE"
         WHERE "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "COLUMN_NAME" = v_column_name
           AND "FEATURE_VERSION" = 'V2'
           AND (v_run_source_type IS NULL OR "RUN_SOURCE_TYPE" = v_run_source_type)
           AND (p_run_id IS NULL OR "RUN_ID" = p_run_id);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_profile_id := NULL;
    END;

    MERGE INTO "INIT$_TB_COLTYPE_FINAL" T
    USING (
        SELECT v_owner AS "OWNER"
             , v_table_name AS "TABLE_NAME"
             , v_column_name AS "COLUMN_NAME"
          FROM DUAL
    ) S
       ON (T."OWNER" = S."OWNER" AND T."TABLE_NAME" = S."TABLE_NAME" AND T."COLUMN_NAME" = S."COLUMN_NAME")
     WHEN MATCHED THEN UPDATE
          SET T."COLUMN_DESC" = v_column_desc
            , T."COLUMN_ID" = v_column_id
            , T."DATA_TYPE" = v_data_type
            , T."FINAL_PREDICTED_TYPE" = v_display_type
            , T."FINAL_TYPE_CODE" = v_type_code
            , T."TYPE_GROUP_CODE" = v_group_code
            , T."LABEL_SOURCE" = v_label_source
            , T."CONFIRMED_YN" = 'Y'
            , T."FINAL_REASON" = SUBSTR(p_reason, 1, 1000)
            , T."FINAL_UPDATE_DT" = SYSDATE
            , T."FINAL_UPDATE_USER" = v_confirmed_by
            , T."SOURCE_RUN_SOURCE_TYPE" = COALESCE(v_run_source_type, T."SOURCE_RUN_SOURCE_TYPE")
            , T."SOURCE_RUN_ID" = COALESCE(p_run_id, T."SOURCE_RUN_ID")
            , T."SOURCE_MODEL_NAME" = COALESCE(p_model_name, T."SOURCE_MODEL_NAME")
     WHEN NOT MATCHED THEN INSERT (
            "OWNER", "TABLE_NAME", "COLUMN_NAME", "COLUMN_DESC", "COLUMN_ID", "DATA_TYPE",
            "FINAL_PREDICTED_TYPE", "FINAL_TYPE_CODE", "TYPE_GROUP_CODE",
            "LABEL_SOURCE", "CONFIRMED_YN", "FINAL_REASON", "FINAL_UPDATE_DT", "FINAL_UPDATE_USER",
            "SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID", "SOURCE_MODEL_NAME", "CREATE_DT"
          ) VALUES (
            v_owner, v_table_name, v_column_name, v_column_desc, v_column_id, v_data_type,
            v_display_type, v_type_code, v_group_code,
            v_label_source, 'Y', SUBSTR(p_reason, 1, 1000), SYSDATE, v_confirmed_by,
            v_run_source_type, p_run_id, p_model_name, SYSDATE
          );

    MERGE INTO "INIT$_TB_COLTYPE_LABEL" T
    USING (
        SELECT v_owner AS "OWNER"
             , v_table_name AS "TABLE_NAME"
             , v_column_name AS "COLUMN_NAME"
          FROM DUAL
    ) S
       ON (T."OWNER" = S."OWNER" AND T."TABLE_NAME" = S."TABLE_NAME" AND T."COLUMN_NAME" = S."COLUMN_NAME")
     WHEN MATCHED THEN UPDATE
          SET T."TYPE_CODE" = v_type_code
            , T."TYPE_GROUP_CODE" = v_group_code
            , T."DISPLAY_TYPE_VALUE" = v_display_type
            , T."LABEL_SOURCE" = v_label_source
            , T."CONFIRMED_YN" = 'Y'
            , T."LABEL_CONFIDENCE" = 1
            , T."SOURCE_PROFILE_ID" = v_profile_id
            , T."SOURCE_RUN_SOURCE_TYPE" = v_run_source_type
            , T."SOURCE_RUN_ID" = p_run_id
            , T."SOURCE_MODEL_NAME" = p_model_name
            , T."LABEL_REASON" = SUBSTR(p_reason, 1, 1000)
            , T."CONFIRMED_BY" = v_confirmed_by
            , T."CONFIRMED_AT" = SYSTIMESTAMP
            , T."UPDATED_AT" = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT (
            "OWNER", "TABLE_NAME", "COLUMN_NAME", "TYPE_CODE", "TYPE_GROUP_CODE", "DISPLAY_TYPE_VALUE",
            "LABEL_SOURCE", "CONFIRMED_YN", "LABEL_CONFIDENCE", "SOURCE_PROFILE_ID", "SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID",
            "SOURCE_MODEL_NAME", "LABEL_REASON", "CONFIRMED_BY", "CONFIRMED_AT", "CREATED_AT", "UPDATED_AT"
          ) VALUES (
            v_owner, v_table_name, v_column_name, v_type_code, v_group_code, v_display_type,
            v_label_source, 'Y', 1, v_profile_id, v_run_source_type, p_run_id,
            p_model_name, SUBSTR(p_reason, 1, 1000), v_confirmed_by, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP
          );

    SELECT "LABEL_ID"
      INTO v_label_id
      FROM "INIT$_TB_COLTYPE_LABEL"
     WHERE "OWNER" = v_owner
       AND "TABLE_NAME" = v_table_name
       AND "COLUMN_NAME" = v_column_name;

    INSERT INTO "INIT$_TB_COLTYPE_LABEL_HIST" (
        "LABEL_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME", "PREVIOUS_TYPE_CODE", "NEW_TYPE_CODE",
        "PREVIOUS_GROUP_CODE", "NEW_GROUP_CODE", "PREVIOUS_DISPLAY_VALUE", "NEW_DISPLAY_VALUE",
        "LABEL_SOURCE", "CONFIRMED_YN", "CHANGE_REASON", "SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID",
        "SOURCE_MODEL_NAME", "CHANGED_BY", "CHANGED_AT"
    ) VALUES (
        v_label_id, v_owner, v_table_name, v_column_name, v_prev_type_code, v_type_code,
        v_prev_group_code, v_group_code, v_prev_display_value, v_display_type,
        v_label_source, 'Y', SUBSTR(p_reason, 1, 1000), v_run_source_type, p_run_id,
        p_model_name, v_confirmed_by, SYSTIMESTAMP
    );
END;
/

CREATE OR REPLACE PROCEDURE "INIT$_SP_PREDICTED_TYPE" (
    p_target_owner       IN VARCHAR2,
    p_target_table       IN VARCHAR2,
    p_prediction_method  IN VARCHAR2 DEFAULT 'AUTO',
    p_run_source_type    IN VARCHAR2 DEFAULT 'DATA_WORK',
    p_run_id             IN NUMBER   DEFAULT 0
) AUTHID CURRENT_USER IS
    v_owner                   VARCHAR2(128);
    v_table_name              VARCHAR2(128);
    v_model_name              VARCHAR2(261);
    v_scoring_model_name      VARCHAR2(261);
    v_method                  VARCHAR2(20);
    v_use_rule                BOOLEAN;
    v_use_model               BOOLEAN;
    v_auto_mode               BOOLEAN := FALSE;
    v_sql                     CLOB;
    v_update_rule_sql         CLOB := '';
    v_update_model_sql        CLOB := '';
    v_update_final_sql        CLOB := '';
    v_model_prediction_expr   VARCHAR2(1000);
    v_model_confidence_expr   VARCHAR2(1000);
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
    v_model_version_id        NUMBER;
    v_model_version           NUMBER;
    v_model_auto_confidence   NUMBER;
    v_integer_tolerance       NUMBER;
    v_auto_label_source       VARCHAR2(30) := 'LEGACY_UNKNOWN';

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
    v_model_name := 'COLUMN_TYPE_RULE';
    v_scoring_model_name := NULL;
    v_method := UPPER(TRIM(NVL(p_prediction_method, 'AUTO')));
    v_run_source_type := normalize_run_source_type(p_run_source_type);
    v_run_id := NVL(p_run_id, 0);
    v_model_auto_confidence := LEAST(1, GREATEST(0, "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'MODEL_AUTO_CONFIDENCE', 0.85)));
    v_integer_tolerance := LEAST(0.1, GREATEST(0, "INIT$_FN_TARGET_SETTING_NUMBER"('DATA_PROFILING', 'INTEGER_TOLERANCE', 0.000000001)));

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

    IF v_method NOT IN ('AUTO', 'ONLY_RULE', 'ONLY_MODEL', 'ONLY_BOTH', 'FINAL_RULE', 'FINAL_MODEL', 'FINAL_BOTH') THEN
        RAISE_APPLICATION_ERROR(-20003, 'Invalid prediction_method parameter. Use AUTO, ONLY_RULE, ONLY_MODEL, ONLY_BOTH, FINAL_RULE, FINAL_MODEL, or FINAL_BOTH.');
    END IF;

    -- AUTO is the unattended four-stage default. It applies both rule and
    -- model evidence when an active COLUMN_TYPE model exists. A fresh
    -- installation can still complete the first run with rule evidence only;
    -- after M90003 activates a model, the same option automatically includes it.
    v_auto_mode := v_method = 'AUTO';
    IF v_auto_mode THEN
        v_method := 'FINAL_BOTH';
    END IF;

    v_use_rule := v_method IN ('ONLY_RULE', 'ONLY_BOTH', 'FINAL_RULE', 'FINAL_BOTH');
    v_use_model := v_method IN ('ONLY_MODEL', 'ONLY_BOTH', 'FINAL_MODEL', 'FINAL_BOTH');

    IF v_use_model THEN
        BEGIN
            SELECT R."PHYSICAL_MODEL_NAME"
                 , R."MODEL_VERSION_ID"
                 , R."VERSION_NO"
              INTO v_scoring_model_name
                 , v_model_version_id
                 , v_model_version
              FROM "INIT$_TB_OML_ACTIVE_MODEL" A
              JOIN "INIT$_TB_OML_MODEL_REGISTRY" R
                ON R."MODEL_VERSION_ID" = A."MODEL_VERSION_ID"
             WHERE A."MODEL_KEY" = 'COLUMN_TYPE'
               AND R."STATUS_CODE" = 'ACTIVE'
               AND ROWNUM = 1;

            v_scoring_model_name := DBMS_ASSERT.SIMPLE_SQL_NAME(UPPER(v_scoring_model_name));
            v_model_name := v_scoring_model_name;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                IF v_auto_mode THEN
                    v_method := 'FINAL_RULE';
                    v_use_model := FALSE;
                    v_model_name := 'COLUMN_TYPE_RULE';
                    v_model_version_id := NULL;
                    v_model_version := NULL;
                ELSE
                    RAISE_APPLICATION_ERROR(
                        -20004,
                        'No active COLUMN_TYPE model. Train, validate, and activate a model in M90003 first.'
                    );
                END IF;
        END;
    END IF;

    IF v_use_rule THEN
        v_update_rule_sql := q'[
        T."BASE_PREDICTED_TYPE" = S."BASE_PREDICTED_TYPE",
        T."BASE_TYPE_CODE" = S."BASE_TYPE_CODE",
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
        T."MODL_TYPE_CODE" = S."MODL_TYPE_CODE",
        T."MODEL_VERSION_ID" = S."MODEL_VERSION_ID",
        T."MODEL_VERSION" = S."MODEL_VERSION",
        T."MODEL_CONFIDENCE" = S."MODEL_CONFIDENCE",
]';
        v_model_prediction_expr := 'PREDICTION(' || v_scoring_model_name || ' USING *)';
        v_model_confidence_expr := 'PREDICTION_PROBABILITY(' || v_scoring_model_name || ' USING *)';
        v_insert_model_expr := 'S."MODL_PREDICTED_TYPE"';
    ELSE
        v_model_prediction_expr := 'CAST(NULL AS VARCHAR2(4000))';
        v_model_confidence_expr := 'CAST(NULL AS NUMBER)';
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
                 WHEN "INIT$_FN_TYPE_CODE"(S."BASE_PREDICTED_TYPE") = "INIT$_FN_TYPE_CODE"(S."MODL_PREDICTED_TYPE")
                 THEN S."BASE_PREDICTED_TYPE"
                 WHEN NVL(S."MODEL_CONFIDENCE", 0) >= ' || TO_CHAR(v_model_auto_confidence, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || '
                 THEN S."MODL_PREDICTED_TYPE"
                 ELSE S."BASE_PREDICTED_TYPE"
             END';
        v_final_reason_expr := sql_literal('[자동결정] FINAL_BOTH: 규칙/모델 일치 또는 모델 확률 기준으로 최종값 반영');
    END IF;

    IF v_method IN ('FINAL_RULE', 'FINAL_MODEL', 'FINAL_BOTH') THEN
        v_final_dt_expr := 'SYSDATE';
        v_final_user_expr := 'SYS_CONTEXT(''USERENV'', ''SESSION_USER'')';
        v_update_final_sql := '
        T."FINAL_PREDICTED_TYPE" = ' || v_final_type_expr || ',
        T."FINAL_TYPE_CODE" = "INIT$_FN_TYPE_CODE"(' || v_final_type_expr || '),
        T."TYPE_GROUP_CODE" = "INIT$_FN_TYPE_GROUP_CODE"(' || v_final_type_expr || '),
        T."FINAL_REASON" = ' || v_final_reason_expr || ',
        T."FINAL_UPDATE_DT" = ' || v_final_dt_expr || ',
        T."FINAL_UPDATE_USER" = ' || v_final_user_expr || ',
';
    END IF;

    v_auto_label_source := CASE
        WHEN v_method IN ('ONLY_RULE', 'FINAL_RULE') THEN 'AUTO_RULE'
        WHEN v_method IN ('ONLY_MODEL', 'FINAL_MODEL') THEN 'AUTO_MODEL'
        WHEN v_method IN ('ONLY_BOTH', 'FINAL_BOTH') THEN 'AUTO_BOTH'
        ELSE 'LEGACY_UNKNOWN'
    END;

    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL DML';
    EXECUTE IMMEDIATE 'ALTER SESSION DISABLE PARALLEL QUERY';

    v_sql := q'~
MERGE /*+ NO_PARALLEL */ INTO "INIT$_TB_COLTYPE_RESULT" T
USING (
    WITH BASE_COL AS (
        SELECT C.OWNER,
               C.TABLE_NAME,
               CM.COMMENTS AS COLUMN_DESC,
               C.COLUMN_ID,
               C.COLUMN_NAME,
               C.DATA_TYPE,
               C.NUM_DISTINCT,
               C.NUM_NULLS,
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
               CASE
                   WHEN B.NUM_NULLS IS NOT NULL THEN GREATEST(B.TOTAL_ROWS - B.NUM_NULLS, 0)
                   WHEN X.SAMPLE_ROWS > 0 THEN ROUND(B.TOTAL_ROWS * X.SAMPLE_NOT_NULL_COUNT / X.SAMPLE_ROWS)
                   ELSE 0
               END AS NON_NULL_ROWS,
               X.SAMPLE_ROWS,
               X.SAMPLE_NOT_NULL_COUNT,
               X.DIST_CNT AS SAMPLE_DISTINCT,
               NVL(B.NUM_DISTINCT, X.DIST_CNT) AS NUM_DISTINCT,
               ROUND(
                   CASE
                       WHEN B.NUM_DISTINCT IS NOT NULL THEN B.NUM_DISTINCT / NULLIF(
                           CASE
                               WHEN B.NUM_NULLS IS NOT NULL THEN GREATEST(B.TOTAL_ROWS - B.NUM_NULLS, 0)
                               WHEN X.SAMPLE_ROWS > 0 THEN ROUND(B.TOTAL_ROWS * X.SAMPLE_NOT_NULL_COUNT / X.SAMPLE_ROWS)
                               ELSE 0
                           END, 0)
                       ELSE X.DIST_CNT / NULLIF(X.SAMPLE_NOT_NULL_COUNT, 0)
                   END,
                   6
               ) AS DIST_VAL_RT,
               ROUND(1 - X.SAMPLE_NOT_NULL_COUNT / NULLIF(X.SAMPLE_ROWS, 0), 6) AS NULL_RATIO,
               "INIT$_FN_PREDICT_LOG_DATA_TYPE"(
                   B.DATA_TYPE,
                   X.SAMPLE_NOT_NULL_COUNT,
                   X.NUMERIC_CONVERTIBLE_COUNT
               ) AS LOG_DATA_TYPE,
               X.ENTROPY,
               X.NORM_ENTROPY,
               ROUND(X.NUMERIC_CONVERTIBLE_COUNT / NULLIF(X.SAMPLE_NOT_NULL_COUNT, 0), 6) AS NUMERIC_RATIO,
               ROUND(X.INTEGER_CONVERTIBLE_COUNT / NULLIF(X.NUMERIC_CONVERTIBLE_COUNT, 0), 6) AS INTEGER_RATIO,
               X.MIN_NUM_VALUE,
               X.MAX_NUM_VALUE,
               X.AVG_TEXT_LENGTH,
               X.MAX_TEXT_LENGTH,
               CASE
                   WHEN X.SAMPLE_NOT_NULL_COUNT > 0
                    AND X.INTEGER_CONVERTIBLE_COUNT / NULLIF(X.NUMERIC_CONVERTIBLE_COUNT, 0) >= 0.98
                   THEN 1 ELSE 0
               END AS IS_INTEGER
          FROM BASE_COL B
               CROSS APPLY XMLTABLE(
                   '/ROWSET/ROW'
                   PASSING DBMS_XMLGEN.GETXMLTYPE(
                        'WITH S AS (
                             SELECT ' ||
                                 CASE
                                     WHEN B.DATA_TYPE IN ('CHAR', 'VARCHAR2', 'NCHAR', 'NVARCHAR2') THEN
                                         'SUBSTR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '", 1, 4000)'
                                     WHEN B.DATA_TYPE IN ('NUMBER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE') THEN
                                         'TO_CHAR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '", ''TM9'', ''NLS_NUMERIC_CHARACTERS=.,'')'
                                     WHEN B.DATA_TYPE = 'DATE' THEN
                                         'TO_CHAR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '", ''YYYY-MM-DD"T"HH24:MI:SS'')'
                                     WHEN B.DATA_TYPE LIKE 'TIMESTAMP%WITH TIME ZONE' THEN
                                         'TO_CHAR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '", ''YYYY-MM-DD"T"HH24:MI:SS.FF9 TZH:TZM'')'
                                     WHEN B.DATA_TYPE LIKE 'TIMESTAMP%' THEN
                                         'TO_CHAR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '", ''YYYY-MM-DD"T"HH24:MI:SS.FF9'')'
                                     WHEN B.DATA_TYPE = 'RAW' THEN
                                         'RAWTOHEX(SUBSTR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '", 1, 2000))'
                                     WHEN B.DATA_TYPE IN ('ROWID', 'UROWID') THEN
                                         'ROWIDTOCHAR("' || REPLACE(B.COLUMN_NAME, '"', '""') || '")'
                                     ELSE
                                         'CAST(NULL AS VARCHAR2(4000))'
                                 END || ' AS COL_VALUE
                               FROM "' || REPLACE(B.OWNER, '"', '""') || '"."' || REPLACE(B.TABLE_NAME, '"', '""') || '"
                              WHERE ' ||
                                  CASE
                                      WHEN B.DATA_TYPE IN (
                                          'CHAR', 'VARCHAR2', 'NCHAR', 'NVARCHAR2',
                                          'NUMBER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE',
                                          'DATE',
                                          'RAW', 'ROWID', 'UROWID'
                                      ) OR B.DATA_TYPE LIKE 'TIMESTAMP%' THEN
                                          'ORA_HASH(ROWID, 4294967295, 42) <= ' ||
                                          TO_CHAR(
                                              CASE
                                                  WHEN NVL(B.TOTAL_ROWS, 0) <= 10000 THEN 4294967295
                                                  ELSE CEIL(4294967295 * 10000 / NULLIF(B.TOTAL_ROWS, 0))
                                              END,
                                              'TM9',
                                              'NLS_NUMERIC_CHARACTERS=.,'
                                          ) || ' AND ROWNUM <= 10000'
                                      ELSE
                                          '1 = 0'
                                  END || '
                         ),
                        FREQ AS (
                            SELECT COL_VALUE,
                                   COUNT(*) AS CNT
                              FROM S
                             WHERE COL_VALUE IS NOT NULL
                             GROUP BY COL_VALUE
                        ),
                        TOTAL AS (
                            SELECT SUM(CNT) AS TOTAL_CNT,
                                   COUNT(*) AS DIST_CNT
                              FROM FREQ
                        ),
                        STAT AS (
                            SELECT COUNT(*) AS SAMPLE_ROWS,
                                   COUNT(COL_VALUE) AS SAMPLE_NOT_NULL_COUNT,
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
                                             AND ABS(
                                                     TO_NUMBER(TRIM(COL_VALUE))
                                                   - ROUND(TO_NUMBER(TRIM(COL_VALUE)))
                                                 ) <= ~' || TO_CHAR(v_integer_tolerance, 'TM9', 'NLS_NUMERIC_CHARACTERS=.,') || q'~
                                                     * GREATEST(1, ABS(TO_NUMBER(TRIM(COL_VALUE))))
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
                                    ) AS MAX_NUM_VALUE,
                                   AVG(LENGTH(COL_VALUE)) AS AVG_TEXT_LENGTH,
                                   MAX(LENGTH(COL_VALUE)) AS MAX_TEXT_LENGTH
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
                        SELECT STAT.SAMPLE_ROWS,
                               STAT.SAMPLE_NOT_NULL_COUNT,
                               STAT.NUMERIC_CONVERTIBLE_COUNT,
                               STAT.INTEGER_CONVERTIBLE_COUNT,
                               TOTAL.DIST_CNT,
                               ROUND(NVL(ENT.ENTROPY, 0), 6) AS ENTROPY,
                               ROUND(NVL(ENT.NORM_ENTROPY, 0), 6) AS NORM_ENTROPY,
                               STAT.MIN_NUM_VALUE,
                               STAT.MAX_NUM_VALUE,
                               ROUND(STAT.AVG_TEXT_LENGTH, 6) AS AVG_TEXT_LENGTH,
                               STAT.MAX_TEXT_LENGTH
                          FROM STAT
                               CROSS JOIN TOTAL
                               CROSS JOIN ENT'
                   )
                   COLUMNS
                       SAMPLE_ROWS                NUMBER PATH 'SAMPLE_ROWS',
                       SAMPLE_NOT_NULL_COUNT      NUMBER PATH 'SAMPLE_NOT_NULL_COUNT',
                       NUMERIC_CONVERTIBLE_COUNT  NUMBER PATH 'NUMERIC_CONVERTIBLE_COUNT',
                       INTEGER_CONVERTIBLE_COUNT  NUMBER PATH 'INTEGER_CONVERTIBLE_COUNT',
                       DIST_CNT                   NUMBER PATH 'DIST_CNT',
                       ENTROPY                    NUMBER PATH 'ENTROPY',
                       NORM_ENTROPY               NUMBER PATH 'NORM_ENTROPY',
                       MIN_NUM_VALUE              NUMBER PATH 'MIN_NUM_VALUE',
                       MAX_NUM_VALUE              NUMBER PATH 'MAX_NUM_VALUE',
                       AVG_TEXT_LENGTH            NUMBER PATH 'AVG_TEXT_LENGTH',
                       MAX_TEXT_LENGTH            NUMBER PATH 'MAX_TEXT_LENGTH'
               ) X
    ),
    SCORE AS (
        SELECT /*+ NO_MERGE */ P.*,
               ~' || v_model_prediction_expr || q'~ AS MODEL_PREDICTION_VALUE,
               ~' || v_model_confidence_expr || q'~ AS MODEL_CONFIDENCE
          FROM PROFILE P
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
           'V2' AS "PROFILE_VERSION",
           P.SAMPLE_ROWS AS "SAMPLE_ROWS",
           P.SAMPLE_NOT_NULL_COUNT AS "SAMPLE_NOT_NULL_ROWS",
           P.SAMPLE_DISTINCT AS "SAMPLE_DISTINCT",
           P.NON_NULL_ROWS AS "NON_NULL_ROWS",
           P.NULL_RATIO AS "NULL_RATIO",
           P.NUMERIC_RATIO AS "NUMERIC_RATIO",
           P.INTEGER_RATIO AS "INTEGER_RATIO",
           P.MIN_NUM_VALUE AS "MIN_NUM_VALUE",
           P.MAX_NUM_VALUE AS "MAX_NUM_VALUE",
           P.AVG_TEXT_LENGTH AS "AVG_TEXT_LENGTH",
           P.MAX_TEXT_LENGTH AS "MAX_TEXT_LENGTH",
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
           "INIT$_FN_TYPE_CODE"(
               "INIT$_FN_PREDICT_BASE_TYPE"(
                   P.COLUMN_NAME, P.LOG_DATA_TYPE, P.NUM_DISTINCT, P.DIST_VAL_RT,
                   P.IS_INTEGER, P.NORM_ENTROPY, P.MIN_NUM_VALUE, P.MAX_NUM_VALUE
               )
           ) AS "BASE_TYPE_CODE",
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
           CASE
               WHEN P.MODEL_PREDICTION_VALUE IS NULL THEN NULL
               ELSE "INIT$_FN_TYPE_LABEL"(P.MODEL_PREDICTION_VALUE, 'KOR')
           END AS "MODL_PREDICTED_TYPE",
           CASE
               WHEN P.MODEL_PREDICTION_VALUE IS NULL THEN NULL
               ELSE "INIT$_FN_TYPE_CODE"(P.MODEL_PREDICTION_VALUE)
           END AS "MODL_TYPE_CODE",
           ~' || NVL(TO_CHAR(v_model_version_id, 'TM9'), 'NULL') || q'~ AS "MODEL_VERSION_ID",
           ~' || NVL(TO_CHAR(v_model_version, 'TM9'), 'NULL') || q'~ AS "MODEL_VERSION",
           P.MODEL_CONFIDENCE AS "MODEL_CONFIDENCE"
      FROM SCORE P
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
        T."PROFILE_VERSION" = S."PROFILE_VERSION",
        T."SAMPLE_ROWS" = S."SAMPLE_ROWS",
        T."SAMPLE_NOT_NULL_ROWS" = S."SAMPLE_NOT_NULL_ROWS",
        T."SAMPLE_DISTINCT" = S."SAMPLE_DISTINCT",
        T."NON_NULL_ROWS" = S."NON_NULL_ROWS",
        T."NULL_RATIO" = S."NULL_RATIO",
        T."NUMERIC_RATIO" = S."NUMERIC_RATIO",
        T."INTEGER_RATIO" = S."INTEGER_RATIO",
        T."MIN_NUM_VALUE" = S."MIN_NUM_VALUE",
        T."MAX_NUM_VALUE" = S."MAX_NUM_VALUE",
        T."AVG_TEXT_LENGTH" = S."AVG_TEXT_LENGTH",
        T."MAX_TEXT_LENGTH" = S."MAX_TEXT_LENGTH",
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
        "PROFILE_VERSION",
        "SAMPLE_ROWS",
        "SAMPLE_NOT_NULL_ROWS",
        "SAMPLE_DISTINCT",
        "NON_NULL_ROWS",
        "NULL_RATIO",
        "NUMERIC_RATIO",
        "INTEGER_RATIO",
        "MIN_NUM_VALUE",
        "MAX_NUM_VALUE",
        "AVG_TEXT_LENGTH",
        "MAX_TEXT_LENGTH",
        "BASE_PREDICTED_TYPE",
        "BASE_TYPE_CODE",
        "BASE_REASON",
        "MODL_PREDICTED_TYPE",
        "MODL_TYPE_CODE",
        "MODEL_VERSION_ID",
        "MODEL_VERSION",
        "MODEL_CONFIDENCE",
        "FINAL_PREDICTED_TYPE",
        "FINAL_TYPE_CODE",
        "TYPE_GROUP_CODE",
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
        S."PROFILE_VERSION",
        S."SAMPLE_ROWS",
        S."SAMPLE_NOT_NULL_ROWS",
        S."SAMPLE_DISTINCT",
        S."NON_NULL_ROWS",
        S."NULL_RATIO",
        S."NUMERIC_RATIO",
        S."INTEGER_RATIO",
        S."MIN_NUM_VALUE",
        S."MAX_NUM_VALUE",
        S."AVG_TEXT_LENGTH",
        S."MAX_TEXT_LENGTH",
        ~' || v_insert_base_type_expr || q'~,
        CASE WHEN ~' || v_insert_base_type_expr || q'~ IS NULL THEN NULL ELSE S."BASE_TYPE_CODE" END,
        ~' || v_insert_base_reason_expr || q'~,
        ~' || v_insert_model_expr || q'~,
        CASE WHEN ~' || v_insert_model_expr || q'~ IS NULL THEN NULL ELSE S."MODL_TYPE_CODE" END,
        S."MODEL_VERSION_ID",
        S."MODEL_VERSION",
        S."MODEL_CONFIDENCE",
        ~' || v_final_type_expr || q'~,
        CASE WHEN ~' || v_final_type_expr || q'~ IS NULL THEN NULL ELSE "INIT$_FN_TYPE_CODE"(~' || v_final_type_expr || q'~) END,
        CASE WHEN ~' || v_final_type_expr || q'~ IS NULL THEN NULL ELSE "INIT$_FN_TYPE_GROUP_CODE"(~' || v_final_type_expr || q'~) END,
        ~' || v_final_reason_expr || q'~,
        ~' || v_final_dt_expr || q'~,
        ~' || v_final_user_expr || q'~,
        SYSDATE
)~';

    EXECUTE IMMEDIATE v_sql;
    v_predicted_rowcount := SQL%ROWCOUNT;

    MERGE /*+ NO_PARALLEL */ INTO "INIT$_TB_COLTYPE_PROFILE" T
    USING (
        SELECT "RUN_SOURCE_TYPE"
             , "RUN_ID"
             , "OWNER"
             , "TABLE_NAME"
             , "COLUMN_NAME"
             , "PROFILE_VERSION" AS "FEATURE_VERSION"
             , "COLUMN_DESC"
             , "COLUMN_ID"
             , "DATA_TYPE"
             , "TOTAL_ROWS"
             , "NON_NULL_ROWS"
             , "SAMPLE_ROWS"
             , "SAMPLE_NOT_NULL_ROWS"
             , "NUM_DISTINCT"
             , "SAMPLE_DISTINCT"
             , "DIST_VAL_RT" AS "DISTINCT_RATIO"
             , "NULL_RATIO"
             , "LOG_DATA_TYPE"
             , "ENTROPY"
             , "NORM_ENTROPY"
             , "NUMERIC_RATIO"
             , "INTEGER_RATIO"
             , "MIN_NUM_VALUE"
             , "MAX_NUM_VALUE"
             , "AVG_TEXT_LENGTH"
             , "MAX_TEXT_LENGTH"
             , RAWTOHEX(STANDARD_HASH(
                   "OWNER" || '|' || "TABLE_NAME" || '|' || "COLUMN_NAME" || '|'
                   || NVL(TO_CHAR("TOTAL_ROWS"), '') || '|' || NVL(TO_CHAR("NUM_DISTINCT"), '') || '|'
                   || NVL(TO_CHAR("DIST_VAL_RT"), '') || '|' || NVL(TO_CHAR("NORM_ENTROPY"), '') || '|'
                   || NVL(TO_CHAR("NUMERIC_RATIO"), '') || '|' || NVL(TO_CHAR("INTEGER_RATIO"), ''),
                   'SHA256'
               )) AS "PROFILE_HASH"
          FROM "INIT$_TB_COLTYPE_RESULT"
         WHERE "RUN_SOURCE_TYPE" = v_run_source_type
           AND "RUN_ID" = v_run_id
           AND "OWNER" = v_owner
           AND "TABLE_NAME" = v_table_name
           AND "MODEL_NAME" = v_model_name
    ) S
       ON (T."RUN_SOURCE_TYPE" = S."RUN_SOURCE_TYPE"
      AND T."RUN_ID" = S."RUN_ID"
      AND T."OWNER" = S."OWNER"
      AND T."TABLE_NAME" = S."TABLE_NAME"
      AND T."COLUMN_NAME" = S."COLUMN_NAME"
      AND T."FEATURE_VERSION" = S."FEATURE_VERSION")
     WHEN MATCHED THEN UPDATE SET
          T."COLUMN_DESC" = S."COLUMN_DESC"
        , T."COLUMN_ID" = S."COLUMN_ID"
        , T."DATA_TYPE" = S."DATA_TYPE"
        , T."TOTAL_ROWS" = S."TOTAL_ROWS"
        , T."NON_NULL_ROWS" = S."NON_NULL_ROWS"
        , T."SAMPLE_ROWS" = S."SAMPLE_ROWS"
        , T."SAMPLE_NOT_NULL_ROWS" = S."SAMPLE_NOT_NULL_ROWS"
        , T."NUM_DISTINCT" = S."NUM_DISTINCT"
        , T."SAMPLE_DISTINCT" = S."SAMPLE_DISTINCT"
        , T."DISTINCT_RATIO" = S."DISTINCT_RATIO"
        , T."NULL_RATIO" = S."NULL_RATIO"
        , T."LOG_DATA_TYPE" = S."LOG_DATA_TYPE"
        , T."ENTROPY" = S."ENTROPY"
        , T."NORM_ENTROPY" = S."NORM_ENTROPY"
        , T."NUMERIC_RATIO" = S."NUMERIC_RATIO"
        , T."INTEGER_RATIO" = S."INTEGER_RATIO"
        , T."MIN_NUM_VALUE" = S."MIN_NUM_VALUE"
        , T."MAX_NUM_VALUE" = S."MAX_NUM_VALUE"
        , T."AVG_TEXT_LENGTH" = S."AVG_TEXT_LENGTH"
        , T."MAX_TEXT_LENGTH" = S."MAX_TEXT_LENGTH"
        , T."PROFILE_HASH" = S."PROFILE_HASH"
        , T."CREATED_AT" = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT (
          "RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME", "FEATURE_VERSION",
          "COLUMN_DESC", "COLUMN_ID", "DATA_TYPE", "TOTAL_ROWS", "NON_NULL_ROWS", "SAMPLE_ROWS",
          "SAMPLE_NOT_NULL_ROWS", "NUM_DISTINCT", "SAMPLE_DISTINCT", "DISTINCT_RATIO", "NULL_RATIO",
          "LOG_DATA_TYPE", "ENTROPY", "NORM_ENTROPY", "NUMERIC_RATIO", "INTEGER_RATIO", "MIN_NUM_VALUE",
          "MAX_NUM_VALUE", "AVG_TEXT_LENGTH", "MAX_TEXT_LENGTH", "PROFILE_HASH", "CREATED_AT"
     ) VALUES (
          S."RUN_SOURCE_TYPE", S."RUN_ID", S."OWNER", S."TABLE_NAME", S."COLUMN_NAME", S."FEATURE_VERSION",
          S."COLUMN_DESC", S."COLUMN_ID", S."DATA_TYPE", S."TOTAL_ROWS", S."NON_NULL_ROWS", S."SAMPLE_ROWS",
          S."SAMPLE_NOT_NULL_ROWS", S."NUM_DISTINCT", S."SAMPLE_DISTINCT", S."DISTINCT_RATIO", S."NULL_RATIO",
          S."LOG_DATA_TYPE", S."ENTROPY", S."NORM_ENTROPY", S."NUMERIC_RATIO", S."INTEGER_RATIO", S."MIN_NUM_VALUE",
          S."MAX_NUM_VALUE", S."AVG_TEXT_LENGTH", S."MAX_TEXT_LENGTH", S."PROFILE_HASH", SYSTIMESTAMP
     );

    MERGE /*+ NO_PARALLEL */ INTO "INIT$_TB_COLTYPE_FINAL" T
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
             , "INIT$_FN_TYPE_CODE"(COALESCE("FINAL_PREDICTED_TYPE", "MODL_PREDICTED_TYPE", "BASE_PREDICTED_TYPE")) AS "FINAL_TYPE_CODE"
             , "INIT$_FN_TYPE_GROUP_CODE"(COALESCE("FINAL_PREDICTED_TYPE", "MODL_PREDICTED_TYPE", "BASE_PREDICTED_TYPE")) AS "TYPE_GROUP_CODE"
             , "MODEL_VERSION_ID"
             , "MODEL_VERSION"
             , "MODEL_CONFIDENCE"
             , "FINAL_REASON"
          FROM "INIT$_TB_COLTYPE_RESULT"
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
            , T."FINAL_PREDICTED_TYPE" = S."FINAL_PREDICTED_TYPE"
            , T."FINAL_TYPE_CODE" = S."FINAL_TYPE_CODE"
            , T."TYPE_GROUP_CODE" = S."TYPE_GROUP_CODE"
            , T."LABEL_SOURCE" = v_auto_label_source
            , T."CONFIRMED_YN" = 'N'
            , T."MODEL_VERSION_ID" = S."MODEL_VERSION_ID"
            , T."MODEL_VERSION" = S."MODEL_VERSION"
            , T."MODEL_CONFIDENCE" = S."MODEL_CONFIDENCE"
            , T."FINAL_REASON" = S."FINAL_REASON"
            , T."FINAL_UPDATE_DT" = SYSDATE
            , T."FINAL_UPDATE_USER" = SYS_CONTEXT('USERENV', 'SESSION_USER')
        WHERE NVL(T."CONFIRMED_YN", 'N') = 'N'
          AND T."LABEL_SOURCE" IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH', 'LEGACY_UNKNOWN')
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
          , "FINAL_TYPE_CODE"
          , "TYPE_GROUP_CODE"
          , "LABEL_SOURCE"
          , "CONFIRMED_YN"
          , "MODEL_VERSION_ID"
          , "MODEL_VERSION"
          , "MODEL_CONFIDENCE"
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
          , S."FINAL_TYPE_CODE"
          , S."TYPE_GROUP_CODE"
          , v_auto_label_source
          , 'N'
          , S."MODEL_VERSION_ID"
          , S."MODEL_VERSION"
          , S."MODEL_CONFIDENCE"
          , S."FINAL_REASON"
          , SYSDATE
          , SYS_CONTEXT('USERENV', 'SESSION_USER')
          , SYSDATE
          );
    v_final_rowcount := SQL%ROWCOUNT;

    MERGE INTO "INIT$_TB_COLTYPE_LABEL" T
    USING (
        SELECT F."OWNER"
             , F."TABLE_NAME"
             , F."COLUMN_NAME"
             , F."FINAL_TYPE_CODE" AS "TYPE_CODE"
             , F."TYPE_GROUP_CODE"
             , F."FINAL_PREDICTED_TYPE" AS "DISPLAY_TYPE_VALUE"
             , F."LABEL_SOURCE"
             , F."CONFIRMED_YN"
             , F."MODEL_CONFIDENCE" AS "LABEL_CONFIDENCE"
             , P."PROFILE_ID" AS "SOURCE_PROFILE_ID"
             , F."SOURCE_RUN_SOURCE_TYPE"
             , F."SOURCE_RUN_ID"
             , F."SOURCE_MODEL_NAME"
             , F."FINAL_REASON" AS "LABEL_REASON"
          FROM "INIT$_TB_COLTYPE_FINAL" F
          LEFT JOIN "INIT$_TB_COLTYPE_PROFILE" P
            ON P."RUN_SOURCE_TYPE" = F."SOURCE_RUN_SOURCE_TYPE"
           AND P."RUN_ID" = F."SOURCE_RUN_ID"
           AND P."OWNER" = F."OWNER"
           AND P."TABLE_NAME" = F."TABLE_NAME"
           AND P."COLUMN_NAME" = F."COLUMN_NAME"
           AND P."FEATURE_VERSION" = 'V2'
         WHERE F."OWNER" = v_owner
           AND F."TABLE_NAME" = v_table_name
           AND F."FINAL_TYPE_CODE" IS NOT NULL
    ) S
       ON (T."OWNER" = S."OWNER" AND T."TABLE_NAME" = S."TABLE_NAME" AND T."COLUMN_NAME" = S."COLUMN_NAME")
     WHEN MATCHED THEN UPDATE SET
          T."TYPE_CODE" = S."TYPE_CODE"
        , T."TYPE_GROUP_CODE" = S."TYPE_GROUP_CODE"
        , T."DISPLAY_TYPE_VALUE" = S."DISPLAY_TYPE_VALUE"
        , T."LABEL_SOURCE" = S."LABEL_SOURCE"
        , T."CONFIRMED_YN" = S."CONFIRMED_YN"
        , T."LABEL_CONFIDENCE" = S."LABEL_CONFIDENCE"
        , T."SOURCE_PROFILE_ID" = S."SOURCE_PROFILE_ID"
        , T."SOURCE_RUN_SOURCE_TYPE" = S."SOURCE_RUN_SOURCE_TYPE"
        , T."SOURCE_RUN_ID" = S."SOURCE_RUN_ID"
        , T."SOURCE_MODEL_NAME" = S."SOURCE_MODEL_NAME"
        , T."LABEL_REASON" = S."LABEL_REASON"
        , T."UPDATED_AT" = SYSTIMESTAMP
        WHERE T."CONFIRMED_YN" = 'N'
     WHEN NOT MATCHED THEN INSERT (
          "OWNER", "TABLE_NAME", "COLUMN_NAME", "TYPE_CODE", "TYPE_GROUP_CODE", "DISPLAY_TYPE_VALUE",
          "LABEL_SOURCE", "CONFIRMED_YN", "LABEL_CONFIDENCE", "SOURCE_PROFILE_ID", "SOURCE_RUN_SOURCE_TYPE",
          "SOURCE_RUN_ID", "SOURCE_MODEL_NAME", "LABEL_REASON", "CREATED_AT", "UPDATED_AT"
     ) VALUES (
          S."OWNER", S."TABLE_NAME", S."COLUMN_NAME", S."TYPE_CODE", S."TYPE_GROUP_CODE", S."DISPLAY_TYPE_VALUE",
          S."LABEL_SOURCE", S."CONFIRMED_YN", S."LABEL_CONFIDENCE", S."SOURCE_PROFILE_ID", S."SOURCE_RUN_SOURCE_TYPE",
          S."SOURCE_RUN_ID", S."SOURCE_MODEL_NAME", S."LABEL_REASON", SYSTIMESTAMP, SYSTIMESTAMP
     );

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
