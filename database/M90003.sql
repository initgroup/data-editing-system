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
           , P.DATA_TYPE
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
     , X.DATA_TYPE
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
