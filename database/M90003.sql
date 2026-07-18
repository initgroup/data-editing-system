-- M90003 Oracle Machine Learning model training and lifecycle management

-- [M90003_MODEL_FAMILY_LIST]
WITH MODEL_KEYS AS
     (
      SELECT 'COLUMN_TYPE' AS MODEL_KEY FROM DUAL
       UNION
      SELECT MODEL_KEY FROM "INIT$_TB_OML_MODEL_REGISTRY"
       UNION
      SELECT MODEL_KEY FROM "INIT$_TB_OML_TRAIN_RUN"
     )
SELECT K.MODEL_KEY
     , (SELECT COUNT(*)
          FROM "INIT$_TB_OML_MODEL_REGISTRY" R
         WHERE R.MODEL_KEY = K.MODEL_KEY) AS MODEL_COUNT
     , (SELECT COUNT(*)
          FROM "INIT$_TB_OML_TRAIN_RUN" T
         WHERE T.MODEL_KEY = K.MODEL_KEY) AS RUN_COUNT
     , (SELECT A.MODEL_VERSION_ID
          FROM "INIT$_TB_OML_ACTIVE_MODEL" A
         WHERE A.MODEL_KEY = K.MODEL_KEY) AS ACTIVE_MODEL_VERSION_ID
     , (SELECT MAX(R.VERSION_NO)
          FROM "INIT$_TB_OML_MODEL_REGISTRY" R
         WHERE R.MODEL_KEY = K.MODEL_KEY) AS LATEST_VERSION_NO
  FROM MODEL_KEYS K
 ORDER BY CASE K.MODEL_KEY WHEN 'COLUMN_TYPE' THEN 0 ELSE 1 END
        , K.MODEL_KEY
;

-- [M90003_MODEL_SUMMARY]
SELECT R.MODEL_VERSION_ID
     , R.VERSION_NO
     , R.PHYSICAL_MODEL_NAME
     , R.ALGORITHM_CODE
     , R.FEATURE_VERSION
     , R.STATUS_CODE AS MODEL_STATUS_CODE
     , R.MACRO_F1
     , R.BALANCED_ACCURACY
     , R.VALID_ROW_COUNT
     , R.TEST_ROW_COUNT
     , R.CREATED_AT AS TRAINED_AT
     , 0 AS CONFIRMED_ELIGIBLE_COUNT
     , 0 AS EXCLUDED_AUTO_COUNT
     , 0 AS EXCLUDED_LEGACY_COUNT
     , 0 AS CONFLICT_COUNT
     , 0 AS DUPLICATE_COUNT
     , 0 AS TOTAL_PROFILE_COUNT
  FROM "INIT$_TB_OML_ACTIVE_MODEL" A
  JOIN "INIT$_TB_OML_MODEL_REGISTRY" R
    ON R.MODEL_VERSION_ID = A.MODEL_VERSION_ID
 WHERE 1=1
   AND A.MODEL_KEY = :modelKey
;

-- [M90003_SUMMARY]
WITH LATEST_PREDICTION AS
     (
      SELECT X.OWNER
           , X.TABLE_NAME
           , X.COLUMN_NAME
           , COALESCE(X.BASE_TYPE_CODE, INIT$_FN_TYPE_CODE(X.BASE_PREDICTED_TYPE)) AS BASE_TYPE_CODE
           , COALESCE(X.MODL_TYPE_CODE, INIT$_FN_TYPE_CODE(X.MODL_PREDICTED_TYPE)) AS MODL_TYPE_CODE
        FROM
           (
            SELECT P.*
                 , ROW_NUMBER() OVER (
                       PARTITION BY P.OWNER, P.TABLE_NAME, P.COLUMN_NAME
                           ORDER BY P.CREATE_DT DESC, P.RUN_ID DESC
                                  , NVL(P.MODEL_VERSION_ID, -1) DESC
                                  , P.MODEL_NAME DESC
                   ) AS PREDICTION_RN
              FROM "INIT$_TB_COLTYPE_RESULT" P
           ) X
       WHERE 1=1
         AND X.PREDICTION_RN = 1
     )
   , LATEST_V2_PROFILE AS
     (
      SELECT X.OWNER
           , X.TABLE_NAME
           , X.COLUMN_NAME
        FROM
           (
            SELECT F.OWNER
                 , F.TABLE_NAME
                 , F.COLUMN_NAME
                 , ROW_NUMBER() OVER (
                       PARTITION BY F.OWNER, F.TABLE_NAME, F.COLUMN_NAME
                           ORDER BY F.CREATED_AT DESC, F.PROFILE_ID DESC
                   ) AS PROFILE_RN
              FROM "INIT$_TB_COLTYPE_PROFILE" F
             WHERE 1=1
               AND F.FEATURE_VERSION = 'V2'
           ) X
       WHERE 1=1
         AND X.PROFILE_RN = 1
     )
   , LABEL_COUNTS AS
     (
      SELECT COUNT(
                 CASE
                     WHEN L.CONFIRMED_YN = 'Y'
                      AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                      AND F.OWNER IS NOT NULL
                     THEN 1
                 END
             ) AS CONFIRMED_ELIGIBLE_COUNT
           , COUNT(
                 CASE
                     WHEN L.LABEL_SOURCE IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH')
                     THEN 1
                 END
             ) AS EXCLUDED_AUTO_COUNT
           , COUNT(
                 CASE
                     WHEN L.LABEL_SOURCE = 'LEGACY_UNKNOWN'
                     THEN 1
                 END
             ) AS EXCLUDED_LEGACY_COUNT
           , COUNT(
                 CASE
                     WHEN L.CONFIRMED_YN = 'Y'
                      AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                      AND (
                             P.BASE_TYPE_CODE IS NOT NULL AND P.BASE_TYPE_CODE <> L.TYPE_CODE
                          OR P.MODL_TYPE_CODE IS NOT NULL AND P.MODL_TYPE_CODE <> L.TYPE_CODE
                      )
                     THEN 1
                 END
             ) AS CONFLICT_COUNT
        FROM "INIT$_TB_COLTYPE_LABEL" L
        LEFT JOIN LATEST_V2_PROFILE F
          ON F.OWNER = L.OWNER
         AND F.TABLE_NAME = L.TABLE_NAME
         AND F.COLUMN_NAME = L.COLUMN_NAME
        LEFT JOIN LATEST_PREDICTION P
          ON P.OWNER = L.OWNER
         AND P.TABLE_NAME = L.TABLE_NAME
         AND P.COLUMN_NAME = L.COLUMN_NAME
     )
   , PROFILE_COUNTS AS
     (
      SELECT NVL(SUM(P.PROFILE_COUNT), 0) AS TOTAL_PROFILE_COUNT
           , NVL(SUM(P.DUPLICATE_COUNT), 0) AS DUPLICATE_COUNT
        FROM
           (
            SELECT F.OWNER
                 , F.TABLE_NAME
                 , F.COLUMN_NAME
                 , SUM(F.HASH_COUNT) AS PROFILE_COUNT
                 , SUM(
                       CASE
                           WHEN F.PROFILE_HASH IS NULL THEN 0
                           ELSE GREATEST(F.HASH_COUNT - 1, 0)
                       END
                   ) AS DUPLICATE_COUNT
              FROM
                 (
                  SELECT F0.OWNER
                       , F0.TABLE_NAME
                       , F0.COLUMN_NAME
                       , F0.PROFILE_HASH
                       , COUNT(*) AS HASH_COUNT
                    FROM "INIT$_TB_COLTYPE_PROFILE" F0
                   WHERE 1=1
                     AND F0.FEATURE_VERSION = 'V2'
                   GROUP BY F0.OWNER
                          , F0.TABLE_NAME
                          , F0.COLUMN_NAME
                          , F0.PROFILE_HASH
                 ) F
             GROUP BY F.OWNER
                    , F.TABLE_NAME
                    , F.COLUMN_NAME
           ) P
     )
   , ACTIVE_MODEL AS
     (
      SELECT R.MODEL_VERSION_ID
           , R.VERSION_NO
           , R.PHYSICAL_MODEL_NAME
           , R.ALGORITHM_CODE
           , R.FEATURE_VERSION
           , R.STATUS_CODE AS MODEL_STATUS_CODE
           , R.MACRO_F1
           , R.BALANCED_ACCURACY
           , R.VALID_ROW_COUNT
           , R.TEST_ROW_COUNT
           , R.CREATED_AT AS TRAINED_AT
        FROM "INIT$_TB_OML_ACTIVE_MODEL" A
        JOIN "INIT$_TB_OML_MODEL_REGISTRY" R
          ON R.MODEL_VERSION_ID = A.MODEL_VERSION_ID
       WHERE 1=1
         AND A.MODEL_KEY = :modelKey
     )
SELECT A.MODEL_VERSION_ID
     , A.VERSION_NO
     , A.PHYSICAL_MODEL_NAME
     , A.ALGORITHM_CODE
     , A.FEATURE_VERSION
     , A.MODEL_STATUS_CODE
     , A.MACRO_F1
     , A.BALANCED_ACCURACY
     , A.VALID_ROW_COUNT
     , A.TEST_ROW_COUNT
     , A.TRAINED_AT
     , L.CONFIRMED_ELIGIBLE_COUNT
     , L.EXCLUDED_AUTO_COUNT
     , L.EXCLUDED_LEGACY_COUNT
     , L.CONFLICT_COUNT
     , P.DUPLICATE_COUNT
     , P.TOTAL_PROFILE_COUNT
  FROM LABEL_COUNTS L
 CROSS JOIN PROFILE_COUNTS P
  LEFT JOIN ACTIVE_MODEL A
    ON 1=1
;

-- [M90003_ACTIVE_MODEL_METRIC_LIST]
SELECT M.SPLIT_CODE
     , M.ACTUAL_CLASS_CODE AS TYPE_CODE
     , M.PREDICTED_CLASS_CODE AS PREDICTED_TYPE_CODE
     , M.CLASS_GROUP_CODE AS TYPE_GROUP_CODE
     , M.METRIC_NAME
     , M.METRIC_VALUE
     , M.SUPPORT_COUNT
  FROM "INIT$_TB_OML_ACTIVE_MODEL" A
  JOIN "INIT$_TB_OML_MODEL_METRIC" M
    ON M.MODEL_VERSION_ID = A.MODEL_VERSION_ID
 WHERE 1=1
   AND A.MODEL_KEY = :modelKey
 ORDER BY M.SPLIT_CODE
        , NVL(M.CLASS_GROUP_CODE, '~')
        , NVL(M.ACTUAL_CLASS_CODE, '~')
        , NVL(M.PREDICTED_CLASS_CODE, '~')
        , M.METRIC_NAME
;

-- [M90003_DATASET_GROUP_DISTRIBUTION]
SELECT L.TYPE_GROUP_CODE
     , COUNT(*) AS LABEL_COUNT
     , ROUND(100 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS PERCENTAGE
  FROM "INIT$_TB_COLTYPE_LABEL" L
 WHERE 1=1
   AND L.CONFIRMED_YN = 'Y'
   AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
   AND EXISTS
       (
        SELECT 1
          FROM "INIT$_TB_COLTYPE_PROFILE" F
         WHERE 1=1
           AND F.OWNER = L.OWNER
           AND F.TABLE_NAME = L.TABLE_NAME
           AND F.COLUMN_NAME = L.COLUMN_NAME
           AND F.FEATURE_VERSION = 'V2'
       )
 GROUP BY L.TYPE_GROUP_CODE
 ORDER BY CASE L.TYPE_GROUP_CODE WHEN 'CATEGORICAL' THEN 1 WHEN 'CONTINUOUS' THEN 2 ELSE 3 END
;

-- [M90003_DATASET_DETAIL_DISTRIBUTION]
SELECT L.TYPE_CODE
     , L.TYPE_GROUP_CODE
     , COUNT(*) AS LABEL_COUNT
     , ROUND(100 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS PERCENTAGE
  FROM "INIT$_TB_COLTYPE_LABEL" L
 WHERE 1=1
   AND L.CONFIRMED_YN = 'Y'
   AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
   AND EXISTS
       (
        SELECT 1
          FROM "INIT$_TB_COLTYPE_PROFILE" F
         WHERE 1=1
           AND F.OWNER = L.OWNER
           AND F.TABLE_NAME = L.TABLE_NAME
           AND F.COLUMN_NAME = L.COLUMN_NAME
           AND F.FEATURE_VERSION = 'V2'
       )
 GROUP BY L.TYPE_CODE
        , L.TYPE_GROUP_CODE
 ORDER BY L.TYPE_GROUP_CODE
        , L.TYPE_CODE
;

-- [M90003_LABEL_LIST]
WITH PROFILE_COUNTS AS
     (
      SELECT F.OWNER
           , F.TABLE_NAME
           , F.COLUMN_NAME
           , SUM(F.HASH_COUNT) AS PROFILE_COUNT
           , SUM(
                 CASE
                     WHEN F.PROFILE_HASH IS NULL THEN 0
                     ELSE GREATEST(F.HASH_COUNT - 1, 0)
                 END
             ) AS DUPLICATE_COUNT
        FROM
           (
            SELECT F0.OWNER
                 , F0.TABLE_NAME
                 , F0.COLUMN_NAME
                 , F0.PROFILE_HASH
                 , COUNT(*) AS HASH_COUNT
              FROM "INIT$_TB_COLTYPE_PROFILE" F0
             WHERE 1=1
               AND F0.FEATURE_VERSION = 'V2'
             GROUP BY F0.OWNER
                    , F0.TABLE_NAME
                    , F0.COLUMN_NAME
                    , F0.PROFILE_HASH
           ) F
       GROUP BY F.OWNER
              , F.TABLE_NAME
              , F.COLUMN_NAME
     )
   , LATEST_PROFILE AS
     (
      SELECT X.*
        FROM
           (
            SELECT F.*
                 , ROW_NUMBER() OVER (
                       PARTITION BY F.OWNER, F.TABLE_NAME, F.COLUMN_NAME
                           ORDER BY F.CREATED_AT DESC, F.PROFILE_ID DESC
                   ) AS PROFILE_RN
              FROM "INIT$_TB_COLTYPE_PROFILE" F
             WHERE 1=1
               AND F.FEATURE_VERSION = 'V2'
           ) X
       WHERE 1=1
         AND X.PROFILE_RN = 1
     )
   , LATEST_PREDICTION AS
     (
      SELECT X.OWNER
           , X.TABLE_NAME
           , X.COLUMN_NAME
           , COALESCE(X.BASE_TYPE_CODE, INIT$_FN_TYPE_CODE(X.BASE_PREDICTED_TYPE)) AS BASE_TYPE_CODE
           , COALESCE(X.MODL_TYPE_CODE, INIT$_FN_TYPE_CODE(X.MODL_PREDICTED_TYPE)) AS MODL_TYPE_CODE
        FROM
           (
            SELECT R.*
                 , ROW_NUMBER() OVER (
                       PARTITION BY R.OWNER, R.TABLE_NAME, R.COLUMN_NAME
                           ORDER BY R.CREATE_DT DESC, R.RUN_ID DESC
                                  , NVL(R.MODEL_VERSION_ID, -1) DESC
                                  , R.MODEL_NAME DESC
                   ) AS PREDICTION_RN
              FROM "INIT$_TB_COLTYPE_RESULT" R
           ) X
       WHERE 1=1
         AND X.PREDICTION_RN = 1
     )
   , FILTERED AS
     (
      SELECT L.LABEL_ID
           , L.OWNER
           , L.TABLE_NAME
           , L.COLUMN_NAME
           , P.COLUMN_DESC
           , P.COLUMN_ID
           , CAST(L.OWNER || '|' || L.TABLE_NAME || '|' || L.COLUMN_NAME AS VARCHAR2(4000)) AS CASE_ID
           , P.PROFILE_ID
           , P.FEATURE_VERSION
           , P.DATA_TYPE
           , P.TOTAL_ROWS
           , P.NON_NULL_ROWS
           , P.SAMPLE_ROWS
           , P.SAMPLE_NOT_NULL_ROWS
           , P.NUM_DISTINCT
           , P.SAMPLE_DISTINCT
           , P.DISTINCT_RATIO AS DIST_VAL_RT
           , P.NULL_RATIO
           , P.LOG_DATA_TYPE
           , P.ENTROPY
           , P.NORM_ENTROPY
           , P.NUMERIC_RATIO
           , P.INTEGER_RATIO
           , P.MIN_NUM_VALUE
           , P.MAX_NUM_VALUE
           , P.AVG_TEXT_LENGTH
           , P.MAX_TEXT_LENGTH
           , L.TYPE_CODE
           , L.TYPE_GROUP_CODE
           , L.DISPLAY_TYPE_VALUE
           , L.LABEL_SOURCE
           , L.CONFIRMED_YN
           , L.LABEL_CONFIDENCE
           , L.LABEL_REASON
           , L.CONFIRMED_BY
           , L.CONFIRMED_AT
           , L.UPDATED_AT
           , NVL(C.PROFILE_COUNT, 0) AS PROFILE_COUNT
           , NVL(C.DUPLICATE_COUNT, 0) AS DUPLICATE_COUNT
           , CASE
                 WHEN L.CONFIRMED_YN = 'Y'
                  AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                  AND P.PROFILE_ID IS NOT NULL
                 THEN 'Y'
                 ELSE 'N'
             END AS TRAINING_ELIGIBLE_YN
           , CASE
                 WHEN L.CONFIRMED_YN = 'Y'
                  AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                  AND (
                         R.BASE_TYPE_CODE IS NOT NULL AND R.BASE_TYPE_CODE <> L.TYPE_CODE
                      OR R.MODL_TYPE_CODE IS NOT NULL AND R.MODL_TYPE_CODE <> L.TYPE_CODE
                  )
                 THEN 'Y'
                 ELSE 'N'
             END AS CONFLICT_YN
        FROM "INIT$_TB_COLTYPE_LABEL" L
        LEFT JOIN LATEST_PROFILE P
          ON P.OWNER = L.OWNER
         AND P.TABLE_NAME = L.TABLE_NAME
         AND P.COLUMN_NAME = L.COLUMN_NAME
        LEFT JOIN PROFILE_COUNTS C
          ON C.OWNER = L.OWNER
         AND C.TABLE_NAME = L.TABLE_NAME
         AND C.COLUMN_NAME = L.COLUMN_NAME
        LEFT JOIN LATEST_PREDICTION R
          ON R.OWNER = L.OWNER
         AND R.TABLE_NAME = L.TABLE_NAME
         AND R.COLUMN_NAME = L.COLUMN_NAME
       WHERE 1=1
         AND (
                :scope = 'ALL'
             OR :scope = 'ELIGIBLE'
                AND L.CONFIRMED_YN = 'Y'
                AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                AND P.PROFILE_ID IS NOT NULL
             OR :scope = 'EXCLUDED'
                AND NOT (
                        L.CONFIRMED_YN = 'Y'
                    AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                    AND P.PROFILE_ID IS NOT NULL
                )
             OR :scope = 'EXCLUDED_AUTO'
                AND L.LABEL_SOURCE IN ('AUTO_RULE', 'AUTO_MODEL', 'AUTO_BOTH')
             OR :scope = 'EXCLUDED_LEGACY'
                AND L.LABEL_SOURCE = 'LEGACY_UNKNOWN'
             OR :scope = 'CONFLICT'
                AND L.CONFIRMED_YN = 'Y'
                AND L.LABEL_SOURCE IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
                AND (
                       R.BASE_TYPE_CODE IS NOT NULL AND R.BASE_TYPE_CODE <> L.TYPE_CODE
                    OR R.MODL_TYPE_CODE IS NOT NULL AND R.MODL_TYPE_CODE <> L.TYPE_CODE
                )
         )
         AND (:typeGroupCode = 'ALL' OR L.TYPE_GROUP_CODE = :typeGroupCode)
         AND (
                :keyword IS NULL
             OR UPPER(L.OWNER) LIKE '%' || :keyword || '%'
             OR UPPER(L.TABLE_NAME) LIKE '%' || :keyword || '%'
             OR UPPER(L.COLUMN_NAME) LIKE '%' || :keyword || '%'
             OR UPPER(NVL(P.COLUMN_DESC, '')) LIKE '%' || :keyword || '%'
         )
     )
SELECT X.LABEL_ID
     , X.OWNER
     , X.TABLE_NAME
     , X.COLUMN_NAME
     , X.COLUMN_DESC
     , X.COLUMN_ID
     , X.CASE_ID
     , X.PROFILE_ID
     , X.FEATURE_VERSION
     , X.DATA_TYPE
     , X.TOTAL_ROWS
     , X.NON_NULL_ROWS
     , X.SAMPLE_ROWS
     , X.SAMPLE_NOT_NULL_ROWS
     , X.NUM_DISTINCT
     , X.SAMPLE_DISTINCT
     , X.DIST_VAL_RT
     , X.NULL_RATIO
     , X.LOG_DATA_TYPE
     , X.ENTROPY
     , X.NORM_ENTROPY
     , X.NUMERIC_RATIO
     , X.INTEGER_RATIO
     , X.MIN_NUM_VALUE
     , X.MAX_NUM_VALUE
     , X.AVG_TEXT_LENGTH
     , X.MAX_TEXT_LENGTH
     , X.TYPE_CODE
     , X.TYPE_GROUP_CODE
     , X.DISPLAY_TYPE_VALUE
     , X.LABEL_SOURCE
     , X.CONFIRMED_YN
     , X.LABEL_CONFIDENCE
     , X.LABEL_REASON
     , X.CONFIRMED_BY
     , X.CONFIRMED_AT
     , X.UPDATED_AT
     , X.PROFILE_COUNT
     , X.DUPLICATE_COUNT
     , X.TRAINING_ELIGIBLE_YN
     , X.CONFLICT_YN
     , X.TOTAL_COUNT
  FROM
     (
      SELECT F.*
           , ROW_NUMBER() OVER (ORDER BY F.UPDATED_AT DESC, F.OWNER, F.TABLE_NAME, F.COLUMN_NAME) AS RN
           , COUNT(*) OVER () AS TOTAL_COUNT
        FROM FILTERED F
     ) X
 WHERE 1=1
   AND X.RN > :offsetRows
   AND X.RN <= :endRow
 ORDER BY X.RN
;

-- [M90003_MODEL_VERSION_LIST]
SELECT X.MODEL_VERSION_ID AS MODEL_ID
     , X.MODEL_KEY
     , X.VERSION_NO AS MODEL_VERSION
     , X.PHYSICAL_MODEL_NAME
     , X.ALGORITHM_CODE
     , X.FEATURE_VERSION
     , X.LABEL_VERSION
     , X.STATUS_CODE AS STATUS
     , X.TRAIN_RUN_ID
     , X.TRAIN_ROW_COUNT AS TRAINED_ROWS
     , X.VALID_ROW_COUNT AS VALIDATION_ROWS
     , X.TEST_ROW_COUNT AS TEST_ROWS
     , X.ACCURACY
     , X.BALANCED_ACCURACY
     , X.MACRO_F1
     , X.CREATED_BY
     , X.CREATED_AT
     , X.ACTIVATED_BY
     , X.ACTIVATED_AT
     , X.ARCHIVED_BY
     , X.ARCHIVED_AT
  FROM
     (
      SELECT R.*
           , ROW_NUMBER() OVER (
                 ORDER BY CASE R.STATUS_CODE WHEN 'ACTIVE' THEN 0 WHEN 'CANDIDATE' THEN 1 ELSE 2 END
                        , R.VERSION_NO DESC
             ) AS RN
        FROM "INIT$_TB_OML_MODEL_REGISTRY" R
       WHERE 1=1
         AND R.MODEL_KEY = :modelKey
         AND (:statusCode = 'ALL' OR R.STATUS_CODE = :statusCode)
     ) X
 WHERE 1=1
   AND X.RN <= :limitRows
 ORDER BY X.RN
;

-- [M90003_TRAIN_RUN_LIST]
SELECT X.TRAIN_RUN_ID AS RUN_ID
     , X.MODEL_KEY
     , X.STATUS_CODE AS STATUS
     , X.ALGORITHM_CODE
     , X.FEATURE_VERSION
     , X.LABEL_VERSION
     , X.TRAIN_SOURCE_FILTER AS LABEL_SOURCE_FILTER
     , X.MIN_TRAIN_ROWS AS MIN_CONFIRMED_ROWS
     , X.HOLDOUT_PERCENT / 100 AS HOLDOUT_RATIO
     , X.MAX_INPUT_ROWS AS MAX_ROWS
     , X.RANDOM_SEED AS SEED
     , X.CANDIDATE_MODEL_NAME
     , X.MODEL_VERSION_ID
     , X.REQUESTED_BY
     , X.REQUESTED_AT
     , X.STARTED_AT
     , X.FINISHED_AT
     , X.TRAIN_ROW_COUNT
     , X.VALID_ROW_COUNT
     , X.TEST_ROW_COUNT
     , NVL(X.TRAIN_ROW_COUNT, 0) + NVL(X.VALID_ROW_COUNT, 0) + NVL(X.TEST_ROW_COUNT, 0) AS ELIGIBLE_ROWS
     , X.MACRO_F1
     , X.BALANCED_ACCURACY
     , X.ERROR_MESSAGE
     , X.TOTAL_COUNT
  FROM
     (
      SELECT Q.*
        FROM
           (
            SELECT R.*
                 , M.MACRO_F1
                 , M.BALANCED_ACCURACY
                 , ROW_NUMBER() OVER (ORDER BY R.TRAIN_RUN_ID DESC) AS RN
                 , COUNT(*) OVER () AS TOTAL_COUNT
              FROM "INIT$_TB_OML_TRAIN_RUN" R
              LEFT JOIN "INIT$_TB_OML_MODEL_REGISTRY" M
                ON M.MODEL_VERSION_ID = R.MODEL_VERSION_ID
             WHERE 1=1
               AND R.MODEL_KEY = :modelKey
               AND (:statusCode = 'ALL' OR R.STATUS_CODE = :statusCode)
           ) Q
       WHERE 1=1
         AND Q.RN > :offsetRows
         AND Q.RN <= :endRow
     ) X
 ORDER BY X.TRAIN_RUN_ID DESC
;

-- [M90003_TRAIN_RUN_DETAIL]
SELECT R.TRAIN_RUN_ID
     , R.MODEL_KEY
     , R.STATUS_CODE
     , R.ALGORITHM_CODE
     , R.FEATURE_VERSION
     , R.LABEL_VERSION
     , R.TRAIN_SOURCE_FILTER AS LABEL_SOURCE_FILTER
     , R.MIN_TRAIN_ROWS AS MIN_CONFIRMED_ROWS
     , R.HOLDOUT_PERCENT
     , R.MAX_INPUT_ROWS
     , R.RANDOM_SEED
     , R.CONFIG_JSON
     , R.CANDIDATE_MODEL_NAME
     , R.MODEL_VERSION_ID
     , R.REQUESTED_BY
     , R.REQUESTED_AT
     , R.STARTED_AT
     , R.FINISHED_AT
     , R.TRAIN_ROW_COUNT
     , R.VALID_ROW_COUNT
     , R.TEST_ROW_COUNT
     , R.ERROR_MESSAGE
  FROM "INIT$_TB_OML_TRAIN_RUN" R
 WHERE 1=1
   AND R.TRAIN_RUN_ID = :trainRunId
;

-- [M90003_TRAIN_RUN_METRIC_LIST]
SELECT M.METRIC_ID
     , M.MODEL_VERSION_ID
     , M.SPLIT_CODE
     , M.ACTUAL_CLASS_CODE AS TYPE_CODE
     , M.PREDICTED_CLASS_CODE AS PREDICTED_TYPE_CODE
     , M.CLASS_GROUP_CODE AS TYPE_GROUP_CODE
     , M.METRIC_NAME
     , M.METRIC_VALUE
     , M.SUPPORT_COUNT
     , M.CREATED_AT
  FROM "INIT$_TB_OML_TRAIN_RUN" R
  JOIN "INIT$_TB_OML_MODEL_METRIC" M
    ON M.MODEL_VERSION_ID = R.MODEL_VERSION_ID
 WHERE 1=1
   AND R.TRAIN_RUN_ID = :trainRunId
 ORDER BY M.SPLIT_CODE
        , NVL(M.CLASS_GROUP_CODE, '~')
        , NVL(M.ACTUAL_CLASS_CODE, '~')
        , NVL(M.PREDICTED_CLASS_CODE, '~')
        , M.METRIC_NAME
;

-- [M90003_TRAIN_RUN_CREATE]
INSERT INTO "INIT$_TB_OML_TRAIN_RUN" (
    MODEL_KEY
  , STATUS_CODE
  , ALGORITHM_CODE
  , FEATURE_VERSION
  , LABEL_VERSION
  , TRAIN_SOURCE_FILTER
  , MIN_TRAIN_ROWS
  , HOLDOUT_PERCENT
  , MAX_INPUT_ROWS
  , RANDOM_SEED
  , CONFIG_JSON
  , REQUESTED_BY
  , REQUESTED_AT
) VALUES (
    :modelKey
  , 'REQUESTED'
  , :algorithmCode
  , :featureVersion
  , :labelVersion
  , 'USER_CONFIRMED,IMPORTED_GOLD'
  , :minConfirmedLabels
  , :holdoutPercent
  , :maxTrainingRows
  , :randomSeed
  , :configJson
  , :requestedBy
  , SYSTIMESTAMP
)
RETURNING TRAIN_RUN_ID INTO :trainRunId
;

-- [M90003_ACTIVE_TRAIN_RUN_COUNT]
SELECT COUNT(*) AS ACTIVE_RUN_COUNT
  FROM "INIT$_TB_OML_TRAIN_RUN"
 WHERE 1=1
   AND MODEL_KEY = :modelKey
   AND STATUS_CODE IN ('REQUESTED', 'RUNNING')
;

-- [M90003_TRAIN_RUN_QUEUE_FAILED]
UPDATE "INIT$_TB_OML_TRAIN_RUN"
   SET STATUS_CODE = 'FAILED'
     , FINISHED_AT = SYSTIMESTAMP
     , ERROR_MESSAGE = :errorMessage
 WHERE 1=1
   AND TRAIN_RUN_ID = :trainRunId
   AND STATUS_CODE = 'REQUESTED'
;

-- [M90003_TRAIN_RUN_EXECUTION_FAILED]
UPDATE "INIT$_TB_OML_TRAIN_RUN"
   SET STATUS_CODE = 'FAILED'
     , FINISHED_AT = SYSTIMESTAMP
     , ERROR_MESSAGE = :errorMessage
 WHERE 1=1
   AND TRAIN_RUN_ID = :trainRunId
   AND STATUS_CODE NOT IN ('SUCCESS', 'CANCELLED')
;

-- [M90003_LABEL_DELETE_SELECTED]
DECLARE
BEGIN
    INSERT INTO "INIT$_TB_COLTYPE_LABEL_HIST" (
        "LABEL_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME", "PREVIOUS_TYPE_CODE", "NEW_TYPE_CODE",
        "PREVIOUS_GROUP_CODE", "NEW_GROUP_CODE", "PREVIOUS_DISPLAY_VALUE", "NEW_DISPLAY_VALUE",
        "LABEL_SOURCE", "CONFIRMED_YN", "CHANGE_REASON", "SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID",
        "SOURCE_MODEL_NAME", "CHANGED_BY", "CHANGED_AT"
    )
    SELECT L."LABEL_ID"
         , L."OWNER"
         , L."TABLE_NAME"
         , L."COLUMN_NAME"
         , L."TYPE_CODE"
         , NULL
         , L."TYPE_GROUP_CODE"
         , NULL
         , L."DISPLAY_TYPE_VALUE"
         , NULL
         , L."LABEL_SOURCE"
         , L."CONFIRMED_YN"
         , 'M90003 selected training label deletion'
         , L."SOURCE_RUN_SOURCE_TYPE"
         , L."SOURCE_RUN_ID"
         , L."SOURCE_MODEL_NAME"
         , :requestedBy
         , SYSTIMESTAMP
      FROM "INIT$_TB_COLTYPE_LABEL" L
     WHERE L."LABEL_ID" IN (
               SELECT TO_NUMBER(REGEXP_SUBSTR(:labelIds, '[^,]+', 1, LEVEL))
                 FROM DUAL
              CONNECT BY REGEXP_SUBSTR(:labelIds, '[^,]+', 1, LEVEL) IS NOT NULL
           );

    DELETE FROM "INIT$_TB_COLTYPE_LABEL" L
     WHERE L."LABEL_ID" IN (
               SELECT TO_NUMBER(REGEXP_SUBSTR(:labelIds, '[^,]+', 1, LEVEL))
                 FROM DUAL
              CONNECT BY REGEXP_SUBSTR(:labelIds, '[^,]+', 1, LEVEL) IS NOT NULL
           );
END;
/

-- [M90003_LABEL_RESET_TRAINING]
DECLARE
BEGIN
    INSERT INTO "INIT$_TB_COLTYPE_LABEL_HIST" (
        "LABEL_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME", "PREVIOUS_TYPE_CODE", "NEW_TYPE_CODE",
        "PREVIOUS_GROUP_CODE", "NEW_GROUP_CODE", "PREVIOUS_DISPLAY_VALUE", "NEW_DISPLAY_VALUE",
        "LABEL_SOURCE", "CONFIRMED_YN", "CHANGE_REASON", "SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID",
        "SOURCE_MODEL_NAME", "CHANGED_BY", "CHANGED_AT"
    )
    SELECT L."LABEL_ID"
         , L."OWNER"
         , L."TABLE_NAME"
         , L."COLUMN_NAME"
         , L."TYPE_CODE"
         , NULL
         , L."TYPE_GROUP_CODE"
         , NULL
         , L."DISPLAY_TYPE_VALUE"
         , NULL
         , L."LABEL_SOURCE"
         , L."CONFIRMED_YN"
         , 'M90003 training label reset'
         , L."SOURCE_RUN_SOURCE_TYPE"
         , L."SOURCE_RUN_ID"
         , L."SOURCE_MODEL_NAME"
         , :requestedBy
         , SYSTIMESTAMP
      FROM "INIT$_TB_COLTYPE_LABEL" L
     WHERE L."CONFIRMED_YN" = 'Y'
       AND L."LABEL_SOURCE" IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
       AND EXISTS (
               SELECT 1
                 FROM "INIT$_TB_COLTYPE_PROFILE" P
                WHERE P."OWNER" = L."OWNER"
                  AND P."TABLE_NAME" = L."TABLE_NAME"
                  AND P."COLUMN_NAME" = L."COLUMN_NAME"
                  AND P."FEATURE_VERSION" = 'V2'
           );

    DELETE FROM "INIT$_TB_COLTYPE_LABEL" L
     WHERE L."CONFIRMED_YN" = 'Y'
       AND L."LABEL_SOURCE" IN ('USER_CONFIRMED', 'IMPORTED_GOLD')
       AND EXISTS (
               SELECT 1
                 FROM "INIT$_TB_COLTYPE_PROFILE" P
                WHERE P."OWNER" = L."OWNER"
                  AND P."TABLE_NAME" = L."TABLE_NAME"
                  AND P."COLUMN_NAME" = L."COLUMN_NAME"
                  AND P."FEATURE_VERSION" = 'V2'
           );
END;
/

-- [M90003_LABEL_CREATE_INITIAL_SAMPLE]
DECLARE
    v_confirmed_count NUMBER;
BEGIN
    SELECT COUNT(*)
      INTO v_confirmed_count
      FROM "INIT$_TB_COLTYPE_LABEL"
     WHERE "CONFIRMED_YN" = 'Y'
       AND "LABEL_SOURCE" IN ('USER_CONFIRMED', 'IMPORTED_GOLD');

    IF v_confirmed_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20726, 'Initial sample labels can only be created when no confirmed training labels exist.');
    END IF;

    MERGE INTO "INIT$_TB_COLTYPE_PROFILE" T
    USING (
        WITH SAMPLE_TABLES AS (
            SELECT LEVEL AS TABLE_SEQ
                 , 'INIT$SAMPLE_COLTYPE_' || TO_CHAR(LEVEL, 'FM00') AS TABLE_NAME
              FROM DUAL
            CONNECT BY LEVEL <= 6
        )
        , SAMPLE_TYPES AS (
            SELECT 1 AS TYPE_SEQ, 'NUM_IDENTIFIER' AS TYPE_CODE, 'OTHER' AS TYPE_GROUP_CODE, 'NUMBER' AS DATA_TYPE FROM DUAL
            UNION ALL SELECT 2, 'CHAR_IDENTIFIER', 'OTHER', 'VARCHAR2' FROM DUAL
            UNION ALL SELECT 3, 'NUM_CONTINUOUS', 'CONTINUOUS', 'NUMBER' FROM DUAL
            UNION ALL SELECT 4, 'NUM_DISCRETE', 'CATEGORICAL', 'NUMBER' FROM DUAL
            UNION ALL SELECT 5, 'CAT_GENERAL', 'CATEGORICAL', 'VARCHAR2' FROM DUAL
            UNION ALL SELECT 6, 'CAT_NUMERIC', 'CATEGORICAL', 'NUMBER' FROM DUAL
            UNION ALL SELECT 7, 'FREE_TEXT', 'OTHER', 'VARCHAR2' FROM DUAL
        )
        SELECT 'DATA_WORK' AS "RUN_SOURCE_TYPE"
             , 0 AS "RUN_ID"
             , 'INIT$SAMPLE' AS "OWNER"
             , TBL.TABLE_NAME AS "TABLE_NAME"
             , 'COL_' || TYP.TYPE_CODE AS "COLUMN_NAME"
             , 'V2' AS "FEATURE_VERSION"
             , 'M90003 initial sample: ' || TYP.TYPE_CODE AS "COLUMN_DESC"
             , TYP.TYPE_SEQ AS "COLUMN_ID"
             , TYP.DATA_TYPE AS "DATA_TYPE"
             , 1000 AS "TOTAL_ROWS"
             , 1000 AS "NON_NULL_ROWS"
             , 1000 AS "SAMPLE_ROWS"
             , 1000 AS "SAMPLE_NOT_NULL_ROWS"
             , CASE TYP.TYPE_CODE
                   WHEN 'NUM_IDENTIFIER' THEN 1000
                   WHEN 'CHAR_IDENTIFIER' THEN 1000
                   WHEN 'NUM_CONTINUOUS' THEN 950
                   WHEN 'NUM_DISCRETE' THEN 12
                   WHEN 'CAT_GENERAL' THEN 8
                   WHEN 'CAT_NUMERIC' THEN 10
                   ELSE 995
               END AS "NUM_DISTINCT"
             , CASE TYP.TYPE_CODE
                   WHEN 'NUM_IDENTIFIER' THEN 1000
                   WHEN 'CHAR_IDENTIFIER' THEN 1000
                   WHEN 'NUM_CONTINUOUS' THEN 950
                   WHEN 'NUM_DISCRETE' THEN 12
                   WHEN 'CAT_GENERAL' THEN 8
                   WHEN 'CAT_NUMERIC' THEN 10
                   ELSE 995
               END AS "SAMPLE_DISTINCT"
             , CASE TYP.TYPE_CODE
                   WHEN 'NUM_IDENTIFIER' THEN 1
                   WHEN 'CHAR_IDENTIFIER' THEN 1
                   WHEN 'NUM_CONTINUOUS' THEN .95
                   WHEN 'NUM_DISCRETE' THEN .012
                   WHEN 'CAT_GENERAL' THEN .008
                   WHEN 'CAT_NUMERIC' THEN .01
                   ELSE .995
               END AS "DISTINCT_RATIO"
             , 0 AS "NULL_RATIO"
             , CASE WHEN TYP.DATA_TYPE = 'NUMBER' THEN 'NUMERIC' ELSE 'TEXT' END AS "LOG_DATA_TYPE"
             , CASE TYP.TYPE_CODE
                   WHEN 'NUM_DISCRETE' THEN 1.5
                   WHEN 'CAT_GENERAL' THEN 1.7
                   WHEN 'CAT_NUMERIC' THEN 1.9
                   ELSE 6.5
               END AS "ENTROPY"
             , CASE TYP.TYPE_CODE
                   WHEN 'NUM_DISCRETE' THEN .22
                   WHEN 'CAT_GENERAL' THEN .26
                   WHEN 'CAT_NUMERIC' THEN .28
                   ELSE .94
               END AS "NORM_ENTROPY"
             , CASE WHEN TYP.DATA_TYPE = 'NUMBER' THEN 1 ELSE 0 END AS "NUMERIC_RATIO"
             , CASE WHEN TYP.TYPE_CODE IN ('NUM_IDENTIFIER', 'NUM_DISCRETE', 'CAT_NUMERIC') THEN 1 ELSE 0 END AS "INTEGER_RATIO"
             , CASE WHEN TYP.DATA_TYPE = 'NUMBER' THEN 1 END AS "MIN_NUM_VALUE"
             , CASE WHEN TYP.DATA_TYPE = 'NUMBER' THEN 1000 END AS "MAX_NUM_VALUE"
             , CASE WHEN TYP.TYPE_CODE = 'FREE_TEXT' THEN 72 ELSE 12 END AS "AVG_TEXT_LENGTH"
             , CASE WHEN TYP.TYPE_CODE = 'FREE_TEXT' THEN 320 ELSE 30 END AS "MAX_TEXT_LENGTH"
             , RAWTOHEX(STANDARD_HASH('M90003|SAMPLE|' || TBL.TABLE_NAME || '|' || TYP.TYPE_CODE, 'SHA256')) AS "PROFILE_HASH"
          FROM SAMPLE_TABLES TBL
         CROSS JOIN SAMPLE_TYPES TYP
    ) S
       ON (
               T."RUN_SOURCE_TYPE" = S."RUN_SOURCE_TYPE"
           AND T."RUN_ID" = S."RUN_ID"
           AND T."OWNER" = S."OWNER"
           AND T."TABLE_NAME" = S."TABLE_NAME"
           AND T."COLUMN_NAME" = S."COLUMN_NAME"
           AND T."FEATURE_VERSION" = S."FEATURE_VERSION"
       )
     WHEN NOT MATCHED THEN
        INSERT (
            "RUN_SOURCE_TYPE", "RUN_ID", "OWNER", "TABLE_NAME", "COLUMN_NAME", "FEATURE_VERSION"
          , "COLUMN_DESC", "COLUMN_ID", "DATA_TYPE", "TOTAL_ROWS", "NON_NULL_ROWS", "SAMPLE_ROWS"
          , "SAMPLE_NOT_NULL_ROWS", "NUM_DISTINCT", "SAMPLE_DISTINCT", "DISTINCT_RATIO", "NULL_RATIO"
          , "LOG_DATA_TYPE", "ENTROPY", "NORM_ENTROPY", "NUMERIC_RATIO", "INTEGER_RATIO", "MIN_NUM_VALUE"
          , "MAX_NUM_VALUE", "AVG_TEXT_LENGTH", "MAX_TEXT_LENGTH", "PROFILE_HASH"
        ) VALUES (
            S."RUN_SOURCE_TYPE", S."RUN_ID", S."OWNER", S."TABLE_NAME", S."COLUMN_NAME", S."FEATURE_VERSION"
          , S."COLUMN_DESC", S."COLUMN_ID", S."DATA_TYPE", S."TOTAL_ROWS", S."NON_NULL_ROWS", S."SAMPLE_ROWS"
          , S."SAMPLE_NOT_NULL_ROWS", S."NUM_DISTINCT", S."SAMPLE_DISTINCT", S."DISTINCT_RATIO", S."NULL_RATIO"
          , S."LOG_DATA_TYPE", S."ENTROPY", S."NORM_ENTROPY", S."NUMERIC_RATIO", S."INTEGER_RATIO", S."MIN_NUM_VALUE"
          , S."MAX_NUM_VALUE", S."AVG_TEXT_LENGTH", S."MAX_TEXT_LENGTH", S."PROFILE_HASH"
        );

    MERGE INTO "INIT$_TB_COLTYPE_LABEL" T
    USING (
        SELECT P."OWNER"
             , P."TABLE_NAME"
             , P."COLUMN_NAME"
             , SUBSTR(P."COLUMN_NAME", 5) AS "TYPE_CODE"
             , CASE SUBSTR(P."COLUMN_NAME", 5)
                   WHEN 'NUM_CONTINUOUS' THEN 'CONTINUOUS'
                   WHEN 'NUM_DISCRETE' THEN 'CATEGORICAL'
                   WHEN 'CAT_GENERAL' THEN 'CATEGORICAL'
                   WHEN 'CAT_NUMERIC' THEN 'CATEGORICAL'
                   ELSE 'OTHER'
               END AS "TYPE_GROUP_CODE"
             , P."PROFILE_ID"
          FROM "INIT$_TB_COLTYPE_PROFILE" P
         WHERE P."OWNER" = 'INIT$SAMPLE'
           AND P."FEATURE_VERSION" = 'V2'
    ) S
       ON (
               T."OWNER" = S."OWNER"
           AND T."TABLE_NAME" = S."TABLE_NAME"
           AND T."COLUMN_NAME" = S."COLUMN_NAME"
       )
     WHEN NOT MATCHED THEN
        INSERT (
            "OWNER", "TABLE_NAME", "COLUMN_NAME", "TYPE_CODE", "TYPE_GROUP_CODE", "DISPLAY_TYPE_VALUE"
          , "LABEL_SOURCE", "CONFIRMED_YN", "LABEL_CONFIDENCE", "SOURCE_PROFILE_ID", "SOURCE_RUN_SOURCE_TYPE"
          , "SOURCE_RUN_ID", "LABEL_REASON", "CONFIRMED_BY", "CONFIRMED_AT"
        ) VALUES (
            S."OWNER", S."TABLE_NAME", S."COLUMN_NAME", S."TYPE_CODE", S."TYPE_GROUP_CODE", S."TYPE_CODE"
          , 'IMPORTED_GOLD', 'Y', 1, S."PROFILE_ID", 'DATA_WORK'
          , 0, 'M90003 initial synthetic sample training data', :requestedBy, SYSTIMESTAMP
        );
END;
/

-- [M90003_TYPE_MODEL_TRAIN_CALL]
BEGIN
    INIT$_SP_TYPE_MODEL_TRAIN(
        P_TRAIN_RUN_ID => :trainRunId
      , P_REQUESTED_BY => :requestedBy
    );
END;
/

-- [M90003_TYPE_MODEL_ACTIVATE_CALL]
BEGIN
    INIT$_SP_TYPE_MODEL_ACTIVATE(
        P_MODEL_VERSION_ID => :modelVersionId
      , P_USER_ID => :userId
    );
END;
/

-- [M90003_TYPE_MODEL_ARCHIVE_CALL]
BEGIN
    INIT$_SP_TYPE_MODEL_ARCHIVE(
        P_MODEL_VERSION_ID => :modelVersionId
      , P_USER_ID => :userId
    );
END;
/

-- [M90003_TYPE_MODEL_ROLLBACK_CALL]
BEGIN
    INIT$_SP_TYPE_MODEL_ROLLBACK(
        P_USER_ID => :userId
      , P_MODEL_KEY => :modelKey
    );
END;
/
