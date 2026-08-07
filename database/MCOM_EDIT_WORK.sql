-- [MCOMMON_EDIT_PROJECT_ACCESS]
SELECT COUNT(*) AS ACCESS_COUNT
  FROM "INIT$_TB_PROJECT" P
 WHERE P.PROJECT_ID = :projectId
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
;

-- [MCOMMON_EDIT_RULE_TOLERANCE_COLUMN_EXISTS]
SELECT COUNT(*) AS COLUMN_COUNT
  FROM USER_TAB_COLUMNS
 WHERE TABLE_NAME = 'INIT$_TB_EDIT_RULE'
   AND COLUMN_NAME = 'RULE_TOLERANCE_PCT'
;

-- [MCOMMON_EDIT_RUN_ACCESS]
SELECT COUNT(*) AS ACCESS_COUNT
  FROM DUAL
 WHERE (
           :runSourceType = 'FLOW_WORK'
       AND EXISTS (
           SELECT 1
             FROM "INIT$_TB_FLOW_WORK_RUN" FR
             JOIN "INIT$_TB_FLOW_WORK" F
               ON F.FLOW_ID = FR.FLOW_ID
            WHERE FR.FLOW_RUN_ID = :runId
              AND F.PROJECT_ID = :projectId
              AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
       )
       )
    OR (
           :runSourceType = 'DATA_WORK'
       AND EXISTS (
           SELECT 1
             FROM "INIT$_TB_DATA_WORK_RUN" DR
             JOIN "INIT$_TB_DATA_WORK_JOB" J
               ON J.WORK_JOB_ID = DR.WORK_JOB_ID
            WHERE DR.DATA_RUN_ID = :runId
              AND J.PROJECT_ID = :projectId
              AND (:scenarioId IS NULL OR J.SCENARIO_ID = :scenarioId)
       )
       )
;

-- [MCOMMON_EDIT_RUN_CONTEXT]
SELECT C.PROJECT_ID
     , C.SCENARIO_ID
  FROM (
        SELECT F.PROJECT_ID
             , F.SCENARIO_ID
          FROM "INIT$_TB_FLOW_WORK_RUN" FR
          JOIN "INIT$_TB_FLOW_WORK" F
            ON F.FLOW_ID = FR.FLOW_ID
         WHERE :runSourceType = 'FLOW_WORK'
           AND FR.FLOW_RUN_ID = :runId
        UNION
        SELECT J.PROJECT_ID
             , J.SCENARIO_ID
          FROM "INIT$_TB_DATA_WORK_RUN" DR
          JOIN "INIT$_TB_DATA_WORK_JOB" J
            ON J.WORK_JOB_ID = DR.WORK_JOB_ID
         WHERE :runSourceType = 'DATA_WORK'
           AND DR.DATA_RUN_ID = :runId
       ) C
;

-- [MCOMMON_EDIT_LATEST_RULE_RUN]
SELECT RUN_SOURCE_TYPE
     , RUN_ID
     , RUN_AT
  FROM (
        SELECT C.RUN_SOURCE_TYPE
             , C.RUN_ID
             , C.RUN_AT
          FROM (
                SELECT 'FLOW_WORK' AS RUN_SOURCE_TYPE
                     , FR.FLOW_RUN_ID AS RUN_ID
                     , COALESCE(FR.FINISHED_AT, FR.STARTED_AT, FR.CREATED_AT) AS RUN_AT
                  FROM "INIT$_TB_FLOW_WORK_RUN" FR
                  JOIN "INIT$_TB_FLOW_WORK" F
                    ON F.FLOW_ID = FR.FLOW_ID
                 WHERE F.MENU_CODE = 'M04001'
                   AND F.PROJECT_ID = :projectId
                   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
                   AND FR.STATUS IN ('SUCCESS', 'COMPLETED')
                   AND (
                          EXISTS (
                              SELECT 1
                                FROM "INIT$_TB_RULEDISC_ASSOC_SUM" A
                               WHERE A.RUN_SOURCE_TYPE = 'FLOW_WORK'
                                 AND A.RUN_ID = FR.FLOW_RUN_ID
                          )
                       OR EXISTS (
                              SELECT 1
                                FROM "INIT$_TB_RULEDISC_SYMBOLIC" S
                               WHERE S.RUN_SOURCE_TYPE = 'FLOW_WORK'
                                 AND S.RUN_ID = FR.FLOW_RUN_ID
                          )
                       )
                UNION ALL
                SELECT 'DATA_WORK' AS RUN_SOURCE_TYPE
                     , DR.DATA_RUN_ID AS RUN_ID
                     , MAX(COALESCE(DR.FINISHED_AT, DR.STARTED_AT, DR.CREATED_AT)) AS RUN_AT
                  FROM "INIT$_TB_DATA_WORK_RUN" DR
                  JOIN "INIT$_TB_DATA_WORK_JOB" J
                    ON J.WORK_JOB_ID = DR.WORK_JOB_ID
                 WHERE J.PROJECT_ID = :projectId
                   AND (:scenarioId IS NULL OR J.SCENARIO_ID = :scenarioId)
                   AND DR.DATA_RUN_ID > 0
                   AND DR.STATUS IN ('SUCCESS', 'COMPLETED')
                   AND (
                          EXISTS (
                              SELECT 1
                                FROM "INIT$_TB_RULEDISC_ASSOC_SUM" A
                               WHERE A.RUN_SOURCE_TYPE = 'DATA_WORK'
                                 AND A.RUN_ID = DR.DATA_RUN_ID
                          )
                       OR EXISTS (
                              SELECT 1
                                FROM "INIT$_TB_RULEDISC_SYMBOLIC" S
                               WHERE S.RUN_SOURCE_TYPE = 'DATA_WORK'
                                 AND S.RUN_ID = DR.DATA_RUN_ID
                          )
                       )
                 GROUP BY DR.DATA_RUN_ID
               ) C
         ORDER BY C.RUN_AT DESC NULLS LAST
                , C.RUN_ID DESC
       )
 WHERE ROWNUM = 1
;

-- [MCOMMON_EDIT_TARGET_TABLE_ACCESS]
SELECT COUNT(*) AS ACCESS_COUNT
  FROM "INIT$_TB_TABLES" T
 WHERE T.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
   AND T.OWNER_NAME = :targetOwner
   AND T.TABLE_NAME = :targetTable
;

-- [MCOMMON_EDIT_TARGET_TABLE_LOCK]
SELECT T.SCENARIO_TABLE_ID
  FROM "INIT$_TB_TABLES" T
 WHERE T.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
   AND T.OWNER_NAME = :targetOwner
   AND T.TABLE_NAME = :targetTable
   AND ROWNUM = 1
   FOR UPDATE
;

-- [MCOMMON_EDIT_TARGET_TABLE_CONTEXT]
SELECT DISTINCT T.PROJECT_ID
     , T.SCENARIO_ID
  FROM "INIT$_TB_TABLES" T
 WHERE T.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
   AND T.OWNER_NAME = :targetOwner
   AND T.TABLE_NAME = :targetTable
   AND T.USE_YN = 'Y'
;

-- [MCOMMON_EDIT_TABLE_MAPPING]
SELECT T.SCENARIO_TABLE_ID
     , T.PROJECT_ID
     , T.SCENARIO_ID
     , T.OWNER_NAME AS SOURCE_OWNER
     , T.TABLE_NAME AS SOURCE_TABLE
     , T.EDIT_OWNER_NAME AS EDIT_OWNER
     , T.EDIT_TABLE_NAME AS EDIT_TABLE
     , T.ORIGINAL_OWNER_NAME
     , T.ORIGINAL_TABLE_NAME
     , NVL(T.CASE_ID_COLUMN, 'FILE_ROW_NO') AS CASE_ID_COLUMN
     , NVL(T.DATA_ORIGIN_TYPE, 'MANAGED_TABLE') AS DATA_ORIGIN_TYPE
  FROM "INIT$_TB_TABLES" T
 WHERE T.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
   AND T.OWNER_NAME = :targetOwner
   AND T.TABLE_NAME = :targetTable
   AND T.USE_YN = 'Y'
   AND T.EDIT_OWNER_NAME IS NOT NULL
   AND T.EDIT_TABLE_NAME IS NOT NULL
 ORDER BY T.SCENARIO_ID
;

-- [MCOMMON_EDIT_SOURCE_TABLE_LIST]
SELECT T.OWNER_NAME
     , T.TABLE_NAME
     , MAX(T.TABLE_COMMENT) AS TABLE_COMMENT
  FROM "INIT$_TB_TABLES" T
  JOIN ALL_TABLES A
    ON A.OWNER = T.OWNER_NAME
   AND A.TABLE_NAME = T.TABLE_NAME
 WHERE T.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
   AND T.USE_YN = 'Y'
   AND T.EDIT_OWNER_NAME IS NOT NULL
   AND T.EDIT_TABLE_NAME IS NOT NULL
 GROUP BY T.OWNER_NAME
        , T.TABLE_NAME
 ORDER BY T.OWNER_NAME
        , T.TABLE_NAME
;

-- [MCOMMON_EDIT_RULE_TABLE_LIST]
SELECT R.TARGET_OWNER AS OWNER_NAME
     , R.TARGET_TABLE AS TABLE_NAME
     , MAX(T.TABLE_COMMENT) AS TABLE_COMMENT
     , COUNT(DISTINCT R.EDIT_RULE_ID) AS FINAL_RULE_COUNT
  FROM "INIT$_TB_EDIT_RULE" R
  JOIN ALL_TABLES A
    ON A.OWNER = R.TARGET_OWNER
   AND A.TABLE_NAME = R.TARGET_TABLE
  LEFT JOIN "INIT$_TB_TABLES" T
    ON T.PROJECT_ID = R.PROJECT_ID
   AND (
          T.SCENARIO_ID = R.SCENARIO_ID
       OR (T.SCENARIO_ID IS NULL AND R.SCENARIO_ID IS NULL)
       )
   AND T.OWNER_NAME = R.TARGET_OWNER
   AND T.TABLE_NAME = R.TARGET_TABLE
 WHERE 1=1
   AND R.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
   AND R.DECISION_STATUS = 'SELECTED'
   AND R.RULE_STATUS = 'ACTIVE'
   AND EXISTS (
        SELECT 1
          FROM "INIT$_TB_TABLES" MT
         WHERE MT.PROJECT_ID = R.PROJECT_ID
           AND MT.SCENARIO_ID = R.SCENARIO_ID
           AND MT.OWNER_NAME = R.TARGET_OWNER
           AND MT.TABLE_NAME = R.TARGET_TABLE
           AND MT.USE_YN = 'Y'
           AND MT.EDIT_OWNER_NAME IS NOT NULL
           AND MT.EDIT_TABLE_NAME IS NOT NULL
   )
 GROUP BY R.TARGET_OWNER
        , R.TARGET_TABLE
 ORDER BY R.TARGET_OWNER
        , R.TARGET_TABLE
;

-- [MCOMMON_EDIT_RULE_SOURCE_PAGE]
WITH SOURCE_RULES AS
(
    SELECT 'ASSOCIATION' AS SOURCE_RULE_TYPE
         , 'CATEGORICAL' AS RULE_GROUP_CODE
         , R.RUN_SOURCE_TYPE
         , R.RUN_ID
         , R.OWNER AS SOURCE_OWNER
         , R.MODEL_NAME AS SOURCE_OBJECT_NAME
         , R.RULE_ID AS SOURCE_RULE_ID
         , R.TARGET_OWNER
         , R.TARGET_TABLE
         , R.RESULT_COLUMN AS TARGET_COLUMN
         , DBMS_LOB.SUBSTR(R.CONDITION_TEXT, 4000, 1) AS RULE_EXPRESSION
         , DBMS_LOB.SUBSTR(R.RESULT_TEXT, 4000, 1) AS RESULT_EXPRESSION
         , R.RESULT_VALUE AS EXPECTED_VALUE
         , R.RULE_SUPPORT
         , R.RULE_CONFIDENCE
         , R.RULE_LIFT
         , R.CONDITION_COUNT
         , R.MODEL_TYPE
         , R.RULE_SOURCE
         , R.SUPPORT_COUNT
         , R.CONDITION_TOTAL_COUNT
         , R.RESULT_TOTAL_COUNT
         , R.TOTAL_COUNT AS SOURCE_TOTAL_COUNT
         , CAST(NULL AS VARCHAR2(4000)) AS FEATURE_COLUMNS
         , CAST(NULL AS VARCHAR2(80)) AS METHOD
         , CAST(NULL AS NUMBER) AS RANK_NO
         , R.CREATE_DT
      FROM "INIT$_TB_RULEDISC_ASSOC_SUM" R
     WHERE 1=1
       AND :ruleGroup IN ('ALL', 'CATEGORICAL')
       AND R.RUN_SOURCE_TYPE = :runSourceType
       AND R.RUN_ID = :runId
       AND (:targetOwner IS NULL OR R.TARGET_OWNER = :targetOwner)
       AND (:targetTable IS NULL OR R.TARGET_TABLE = :targetTable)
       AND (
              :keyword IS NULL
           OR UPPER(R.RULE_ID) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.MODEL_NAME) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.TARGET_TABLE) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.RESULT_COLUMN) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(DBMS_LOB.SUBSTR(R.CONDITION_TEXT, 4000, 1)) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(DBMS_LOB.SUBSTR(R.RESULT_TEXT, 4000, 1)) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.RESULT_VALUE) LIKE '%' || UPPER(:keyword) || '%'
           )
    UNION ALL
    SELECT 'SYMBOLIC' AS SOURCE_RULE_TYPE
         , 'CONTINUOUS' AS RULE_GROUP_CODE
         , R.RUN_SOURCE_TYPE
         , R.RUN_ID
         , R.OWNER AS SOURCE_OWNER
         , R.TABLE_NAME AS SOURCE_OBJECT_NAME
         , R.RULE_ID AS SOURCE_RULE_ID
         , R.OWNER AS TARGET_OWNER
         , R.TABLE_NAME AS TARGET_TABLE
         , R.TARGET_COLUMN
         , DBMS_LOB.SUBSTR(R.EXPRESSION, 4000, 1) AS RULE_EXPRESSION
         , CAST(NULL AS VARCHAR2(4000)) AS RESULT_EXPRESSION
         , CAST(NULL AS VARCHAR2(4000)) AS EXPECTED_VALUE
         , CAST(NULL AS NUMBER) AS RULE_SUPPORT
         , R.SCORE AS RULE_CONFIDENCE
         , CAST(NULL AS NUMBER) AS RULE_LIFT
         , R.COMPLEXITY AS CONDITION_COUNT
         , R.METHOD AS MODEL_TYPE
         , 'SYMBOLIC_REGRESSION' AS RULE_SOURCE
         , CAST(NULL AS NUMBER) AS SUPPORT_COUNT
         , CAST(NULL AS NUMBER) AS CONDITION_TOTAL_COUNT
         , CAST(NULL AS NUMBER) AS RESULT_TOTAL_COUNT
         , CAST(NULL AS NUMBER) AS SOURCE_TOTAL_COUNT
         , R.FEATURE_COLUMNS
         , R.METHOD
         , R.RANK_NO
         , R.CREATE_DT
      FROM "INIT$_TB_RULEDISC_SYMBOLIC" R
     WHERE 1=1
       AND :ruleGroup IN ('ALL', 'CONTINUOUS')
       AND R.RUN_SOURCE_TYPE = :runSourceType
       AND R.RUN_ID = :runId
       AND (:targetOwner IS NULL OR R.OWNER = :targetOwner)
       AND (:targetTable IS NULL OR R.TABLE_NAME = :targetTable)
       AND (
              :keyword IS NULL
           OR UPPER(R.RULE_ID) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.TABLE_NAME) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.TARGET_COLUMN) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.METHOD) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(R.FEATURE_COLUMNS) LIKE '%' || UPPER(:keyword) || '%'
           OR UPPER(DBMS_LOB.SUBSTR(R.EXPRESSION, 4000, 1)) LIKE '%' || UPPER(:keyword) || '%'
           )
)
, EDIT_DECISIONS AS
(
    SELECT D.EDIT_RULE_ID
         , D.SOURCE_RULE_TYPE
         , D.SOURCE_RUN_SOURCE_TYPE
         , D.SOURCE_RUN_ID
         , D.SOURCE_OWNER
         , D.SOURCE_OBJECT_NAME
         , D.SOURCE_RULE_ID
         , D.TARGET_OWNER
         , D.TARGET_TABLE
         , D.TARGET_COLUMN
         , D.CASE_ID_COLUMN
         , D.DECISION_STATUS
         , D.RULE_STATUS
         , D.DECISION_NOTE
      FROM (
            SELECT E.EDIT_RULE_ID
                 , E.SOURCE_RULE_TYPE
                 , E.SOURCE_RUN_SOURCE_TYPE
                 , E.SOURCE_RUN_ID
                 , E.SOURCE_OWNER
                 , E.SOURCE_OBJECT_NAME
                 , E.SOURCE_RULE_ID
                 , E.TARGET_OWNER
                 , E.TARGET_TABLE
                 , E.TARGET_COLUMN
                 , E.CASE_ID_COLUMN
                 , E.DECISION_STATUS
                 , E.RULE_STATUS
                 , E.DECISION_NOTE
                 , ROW_NUMBER() OVER (
                       PARTITION BY E.SOURCE_RULE_TYPE
                                  , E.SOURCE_RUN_SOURCE_TYPE
                                  , E.SOURCE_RUN_ID
                                  , E.SOURCE_OWNER
                                  , E.SOURCE_OBJECT_NAME
                                  , E.SOURCE_RULE_ID
                                  , E.TARGET_OWNER
                                  , E.TARGET_TABLE
                                  , E.TARGET_COLUMN
                           ORDER BY E.EDIT_RULE_ID DESC
                   ) AS RN__
              FROM "INIT$_TB_EDIT_RULE" E
             WHERE 1=1
               AND E.PROJECT_ID = :projectId
               AND (:scenarioId IS NULL OR E.SCENARIO_ID = :scenarioId)
               AND E.SOURCE_RUN_SOURCE_TYPE = :runSourceType
               AND E.SOURCE_RUN_ID = :runId
               AND E.SOURCE_RULE_TYPE IN ('ASSOCIATION', 'SYMBOLIC')
               AND E.USER_RULE_YN = 'N'
           ) D
     WHERE D.RN__ = 1
)
, JOINED_RULES AS
(
    SELECT U.SOURCE_RULE_TYPE
         , U.RULE_GROUP_CODE
         , U.RUN_SOURCE_TYPE
         , U.RUN_ID
         , U.SOURCE_OWNER
         , U.SOURCE_OBJECT_NAME
         , U.SOURCE_RULE_ID
         , U.TARGET_OWNER
         , U.TARGET_TABLE
         , U.TARGET_COLUMN
         , U.RULE_EXPRESSION
         , U.RESULT_EXPRESSION
         , U.EXPECTED_VALUE
         , U.RULE_SUPPORT
         , U.RULE_CONFIDENCE
         , U.RULE_LIFT
         , U.CONDITION_COUNT
         , U.MODEL_TYPE
         , U.RULE_SOURCE
         , U.SUPPORT_COUNT
         , U.CONDITION_TOTAL_COUNT
         , U.RESULT_TOTAL_COUNT
         , U.SOURCE_TOTAL_COUNT
         , U.FEATURE_COLUMNS
         , U.METHOD
         , U.RANK_NO
         , U.CREATE_DT
         , E.EDIT_RULE_ID
         , NVL(E.DECISION_STATUS, 'PENDING') AS DECISION_STATUS
         , NVL(E.RULE_STATUS, 'ACTIVE') AS RULE_STATUS
         , NVL(E.DECISION_NOTE, '') AS DECISION_NOTE
         , NVL(E.CASE_ID_COLUMN, '') AS CASE_ID_COLUMN
         , U.SOURCE_RULE_ID AS RULE_NAME
      FROM SOURCE_RULES U
      LEFT OUTER JOIN EDIT_DECISIONS E
        ON E.SOURCE_RULE_TYPE = U.SOURCE_RULE_TYPE
       AND E.SOURCE_RUN_SOURCE_TYPE = U.RUN_SOURCE_TYPE
       AND E.SOURCE_RUN_ID = U.RUN_ID
       AND E.SOURCE_OWNER = U.SOURCE_OWNER
       AND E.SOURCE_OBJECT_NAME = U.SOURCE_OBJECT_NAME
       AND E.SOURCE_RULE_ID = U.SOURCE_RULE_ID
       AND E.TARGET_OWNER = U.TARGET_OWNER
       AND E.TARGET_TABLE = U.TARGET_TABLE
       AND E.TARGET_COLUMN = U.TARGET_COLUMN
     WHERE 1=1
       AND (
              :decisionStatus = 'ALL'
           OR NVL(E.DECISION_STATUS, 'PENDING') = :decisionStatus
           )
)
, PAGED_RULES AS
(
    SELECT /*+ MATERIALIZE */ J.*
         , COUNT(*) OVER () AS TOTAL_COUNT
      FROM JOINED_RULES J
     ORDER BY J.RUN_ID DESC
            , J.RULE_CONFIDENCE DESC NULLS LAST
            , J.RULE_LIFT DESC NULLS LAST
            , J.SOURCE_RULE_TYPE
            , J.SOURCE_RULE_ID
    OFFSET :offset ROWS
     FETCH NEXT :limit ROWS ONLY
)
, TARGET_TABLES AS
(
    SELECT DISTINCT P.TARGET_OWNER
         , P.TARGET_TABLE
      FROM PAGED_RULES P
)
, COLUMN_COMMENT_MAP AS
(
    SELECT T.TARGET_OWNER
         , T.TARGET_TABLE
         , JSON_OBJECTAGG(
               C.COLUMN_NAME VALUE NVL(C.COMMENTS, '')
               RETURNING CLOB
           ) AS COLUMN_COMMENTS_JSON
      FROM TARGET_TABLES T
      JOIN ALL_COL_COMMENTS C
        ON C.OWNER = T.TARGET_OWNER
       AND C.TABLE_NAME = T.TARGET_TABLE
     GROUP BY T.TARGET_OWNER
            , T.TARGET_TABLE
)
SELECT P.SOURCE_RULE_TYPE
     , P.RULE_GROUP_CODE
     , :projectId AS PROJECT_ID
     , :resolvedScenarioId AS SCENARIO_ID
     , P.RUN_SOURCE_TYPE
     , P.RUN_ID
     , P.SOURCE_OWNER
     , P.SOURCE_OBJECT_NAME
     , P.SOURCE_RULE_ID
     , P.TARGET_OWNER
     , P.TARGET_TABLE
     , P.TARGET_COLUMN
     , P.RULE_EXPRESSION
     , P.RESULT_EXPRESSION
     , P.EXPECTED_VALUE
     , P.RULE_SUPPORT
     , P.RULE_CONFIDENCE
     , P.RULE_LIFT
     , P.CONDITION_COUNT
     , P.MODEL_TYPE
     , P.RULE_SOURCE
     , P.SUPPORT_COUNT
     , P.CONDITION_TOTAL_COUNT
     , P.RESULT_TOTAL_COUNT
     , P.SOURCE_TOTAL_COUNT
     , P.FEATURE_COLUMNS
     , P.METHOD
     , P.RANK_NO
     , P.CREATE_DT
     , P.EDIT_RULE_ID
     , P.DECISION_STATUS
     , P.RULE_STATUS
     , P.DECISION_NOTE
     , P.CASE_ID_COLUMN
     , P.RULE_NAME
     , P.TOTAL_COUNT
     , TC.COLUMN_ID AS TARGET_COLUMN_ID
     , CC.COMMENTS AS TARGET_COLUMN_COMMENT
     , CM.COLUMN_COMMENTS_JSON
  FROM PAGED_RULES P
  LEFT OUTER JOIN ALL_TAB_COLUMNS TC
    ON TC.OWNER = P.TARGET_OWNER
   AND TC.TABLE_NAME = P.TARGET_TABLE
   AND TC.COLUMN_NAME = P.TARGET_COLUMN
  LEFT OUTER JOIN ALL_COL_COMMENTS CC
    ON CC.OWNER = TC.OWNER
   AND CC.TABLE_NAME = TC.TABLE_NAME
   AND CC.COLUMN_NAME = TC.COLUMN_NAME
  LEFT OUTER JOIN COLUMN_COMMENT_MAP CM
    ON CM.TARGET_OWNER = P.TARGET_OWNER
   AND CM.TARGET_TABLE = P.TARGET_TABLE
 ORDER BY P.RUN_ID DESC
        , P.RULE_CONFIDENCE DESC NULLS LAST
        , P.RULE_LIFT DESC NULLS LAST
        , P.SOURCE_RULE_TYPE
        , P.SOURCE_RULE_ID
;

-- [MCOMMON_EDIT_RULE_SOURCE_ASSOC_LIST]
SELECT *
  FROM (
        SELECT 'ASSOCIATION' AS SOURCE_RULE_TYPE
             , R.RUN_SOURCE_TYPE
             , R.RUN_ID
             , R.OWNER AS SOURCE_OWNER
             , R.MODEL_NAME AS SOURCE_OBJECT_NAME
             , R.RULE_ID AS SOURCE_RULE_ID
             , R.TARGET_OWNER
             , R.TARGET_TABLE
             , R.RESULT_COLUMN AS TARGET_COLUMN
             , DBMS_LOB.SUBSTR(R.CONDITION_TEXT, 4000, 1) AS RULE_EXPRESSION
             , DBMS_LOB.SUBSTR(R.RESULT_TEXT, 4000, 1) AS RESULT_EXPRESSION
             , R.RESULT_VALUE AS EXPECTED_VALUE
             , R.RULE_SUPPORT
             , R.RULE_CONFIDENCE
             , R.RULE_LIFT
             , R.CONDITION_COUNT
             , R.CREATE_DT
             , ROW_NUMBER() OVER (
                   ORDER BY R.RUN_ID DESC
                          , R.RULE_CONFIDENCE DESC NULLS LAST
                          , R.RULE_LIFT DESC NULLS LAST
                          , R.RULE_ID
               ) AS RN__
         FROM "INIT$_TB_RULEDISC_ASSOC_SUM" R
         WHERE 1=1
           AND R.RUN_SOURCE_TYPE = :runSourceType
           AND R.RUN_ID = :runId
           AND (:targetOwner IS NULL OR R.TARGET_OWNER = :targetOwner)
           AND (:targetTable IS NULL OR R.TARGET_TABLE = :targetTable)
           AND (
                  :keyword IS NULL
               OR UPPER(R.RULE_ID) LIKE '%' || UPPER(:keyword) || '%'
               OR UPPER(R.MODEL_NAME) LIKE '%' || UPPER(:keyword) || '%'
               OR UPPER(R.TARGET_TABLE) LIKE '%' || UPPER(:keyword) || '%'
               OR UPPER(R.RESULT_COLUMN) LIKE '%' || UPPER(:keyword) || '%'
               )
       )
 WHERE RN__ <= :maxRows
 ORDER BY RN__
;

-- [MCOMMON_EDIT_RULE_SOURCE_SYMBOLIC_LIST]
SELECT *
  FROM (
        SELECT 'SYMBOLIC' AS SOURCE_RULE_TYPE
             , R.RUN_SOURCE_TYPE
             , R.RUN_ID
             , R.OWNER AS SOURCE_OWNER
             , R.TABLE_NAME AS SOURCE_OBJECT_NAME
             , R.RULE_ID AS SOURCE_RULE_ID
             , R.OWNER AS TARGET_OWNER
             , R.TABLE_NAME AS TARGET_TABLE
             , R.TARGET_COLUMN
             , DBMS_LOB.SUBSTR(R.EXPRESSION, 4000, 1) AS RULE_EXPRESSION
             , CAST(NULL AS VARCHAR2(4000)) AS RESULT_EXPRESSION
             , CAST(NULL AS VARCHAR2(4000)) AS EXPECTED_VALUE
             , CAST(NULL AS NUMBER) AS RULE_SUPPORT
             , R.SCORE AS RULE_CONFIDENCE
             , CAST(NULL AS NUMBER) AS RULE_LIFT
             , R.COMPLEXITY AS CONDITION_COUNT
             , R.CREATE_DT
             , ROW_NUMBER() OVER (
                   ORDER BY R.RUN_ID DESC
                          , R.SCORE DESC NULLS LAST
                          , R.RANK_NO NULLS LAST
                          , R.RULE_ID
               ) AS RN__
          FROM "INIT$_TB_RULEDISC_SYMBOLIC" R
         WHERE 1=1
           AND R.RUN_SOURCE_TYPE = :runSourceType
           AND R.RUN_ID = :runId
           AND (:targetOwner IS NULL OR R.OWNER = :targetOwner)
           AND (:targetTable IS NULL OR R.TABLE_NAME = :targetTable)
           AND (
                  :keyword IS NULL
               OR UPPER(R.RULE_ID) LIKE '%' || UPPER(:keyword) || '%'
               OR UPPER(R.TABLE_NAME) LIKE '%' || UPPER(:keyword) || '%'
               OR UPPER(R.TARGET_COLUMN) LIKE '%' || UPPER(:keyword) || '%'
               OR UPPER(R.METHOD) LIKE '%' || UPPER(:keyword) || '%'
               )
       ) Q
 WHERE Q.RN__ <= :maxRows
 ORDER BY Q.RN__
;

-- [MCOMMON_EDIT_RULE_SOURCE_COUNTS]
SELECT (
           SELECT COUNT(*)
             FROM "INIT$_TB_RULEDISC_ASSOC_SUM" R
            WHERE :ruleGroup IN ('ALL', 'CATEGORICAL')
              AND R.RUN_SOURCE_TYPE = :runSourceType
              AND R.RUN_ID = :runId
              AND (:targetOwner IS NULL OR R.TARGET_OWNER = :targetOwner)
              AND (:targetTable IS NULL OR R.TARGET_TABLE = :targetTable)
              AND (
                     :keyword IS NULL
                  OR UPPER(R.RULE_ID) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.MODEL_NAME) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.TARGET_TABLE) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.RESULT_COLUMN) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(DBMS_LOB.SUBSTR(R.CONDITION_TEXT, 4000, 1)) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(DBMS_LOB.SUBSTR(R.RESULT_TEXT, 4000, 1)) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.RESULT_VALUE) LIKE '%' || UPPER(:keyword) || '%'
                  )
              AND (
                     :decisionStatus = 'ALL'
                  OR (
                         :decisionStatus = 'PENDING'
                     AND NOT EXISTS (
                             SELECT 1
                               FROM "INIT$_TB_EDIT_RULE" E
                              WHERE E.PROJECT_ID = :projectId
                                AND (:scenarioId IS NULL OR E.SCENARIO_ID = :scenarioId)
                                AND E.SOURCE_RULE_TYPE = 'ASSOCIATION'
                                AND E.SOURCE_RUN_SOURCE_TYPE = R.RUN_SOURCE_TYPE
                                AND E.SOURCE_RUN_ID = R.RUN_ID
                                AND E.SOURCE_OWNER = R.OWNER
                                AND E.SOURCE_OBJECT_NAME = R.MODEL_NAME
                                AND E.SOURCE_RULE_ID = R.RULE_ID
                                AND E.TARGET_OWNER = R.TARGET_OWNER
                                AND E.TARGET_TABLE = R.TARGET_TABLE
                                AND E.TARGET_COLUMN = R.RESULT_COLUMN
                                AND E.DECISION_STATUS IN ('SELECTED', 'REJECTED')
                         )
                     )
                  OR (
                         :decisionStatus IN ('SELECTED', 'REJECTED')
                     AND EXISTS (
                             SELECT 1
                               FROM "INIT$_TB_EDIT_RULE" E
                              WHERE E.PROJECT_ID = :projectId
                                AND (:scenarioId IS NULL OR E.SCENARIO_ID = :scenarioId)
                                AND E.SOURCE_RULE_TYPE = 'ASSOCIATION'
                                AND E.SOURCE_RUN_SOURCE_TYPE = R.RUN_SOURCE_TYPE
                                AND E.SOURCE_RUN_ID = R.RUN_ID
                                AND E.SOURCE_OWNER = R.OWNER
                                AND E.SOURCE_OBJECT_NAME = R.MODEL_NAME
                                AND E.SOURCE_RULE_ID = R.RULE_ID
                                AND E.TARGET_OWNER = R.TARGET_OWNER
                                AND E.TARGET_TABLE = R.TARGET_TABLE
                                AND E.TARGET_COLUMN = R.RESULT_COLUMN
                                AND E.DECISION_STATUS = :decisionStatus
                         )
                     )
                  )
       ) AS ASSOCIATION_COUNT
     , (
           SELECT COUNT(*)
             FROM "INIT$_TB_RULEDISC_SYMBOLIC" R
            WHERE :ruleGroup IN ('ALL', 'CONTINUOUS')
              AND R.RUN_SOURCE_TYPE = :runSourceType
              AND R.RUN_ID = :runId
              AND (:targetOwner IS NULL OR R.OWNER = :targetOwner)
              AND (:targetTable IS NULL OR R.TABLE_NAME = :targetTable)
              AND (
                     :keyword IS NULL
                  OR UPPER(R.RULE_ID) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.TABLE_NAME) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.TARGET_COLUMN) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.METHOD) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(R.FEATURE_COLUMNS) LIKE '%' || UPPER(:keyword) || '%'
                  OR UPPER(DBMS_LOB.SUBSTR(R.EXPRESSION, 4000, 1)) LIKE '%' || UPPER(:keyword) || '%'
                  )
              AND (
                     :decisionStatus = 'ALL'
                  OR (
                         :decisionStatus = 'PENDING'
                     AND NOT EXISTS (
                             SELECT 1
                               FROM "INIT$_TB_EDIT_RULE" E
                              WHERE E.PROJECT_ID = :projectId
                                AND (:scenarioId IS NULL OR E.SCENARIO_ID = :scenarioId)
                                AND E.SOURCE_RULE_TYPE = 'SYMBOLIC'
                                AND E.SOURCE_RUN_SOURCE_TYPE = R.RUN_SOURCE_TYPE
                                AND E.SOURCE_RUN_ID = R.RUN_ID
                                AND E.SOURCE_OWNER = R.OWNER
                                AND E.SOURCE_OBJECT_NAME = R.TABLE_NAME
                                AND E.SOURCE_RULE_ID = R.RULE_ID
                                AND E.TARGET_OWNER = R.OWNER
                                AND E.TARGET_TABLE = R.TABLE_NAME
                                AND E.TARGET_COLUMN = R.TARGET_COLUMN
                                AND E.DECISION_STATUS IN ('SELECTED', 'REJECTED')
                         )
                     )
                  OR (
                         :decisionStatus IN ('SELECTED', 'REJECTED')
                     AND EXISTS (
                             SELECT 1
                               FROM "INIT$_TB_EDIT_RULE" E
                              WHERE E.PROJECT_ID = :projectId
                                AND (:scenarioId IS NULL OR E.SCENARIO_ID = :scenarioId)
                                AND E.SOURCE_RULE_TYPE = 'SYMBOLIC'
                                AND E.SOURCE_RUN_SOURCE_TYPE = R.RUN_SOURCE_TYPE
                                AND E.SOURCE_RUN_ID = R.RUN_ID
                                AND E.SOURCE_OWNER = R.OWNER
                                AND E.SOURCE_OBJECT_NAME = R.TABLE_NAME
                                AND E.SOURCE_RULE_ID = R.RULE_ID
                                AND E.TARGET_OWNER = R.OWNER
                                AND E.TARGET_TABLE = R.TABLE_NAME
                                AND E.TARGET_COLUMN = R.TARGET_COLUMN
                                AND E.DECISION_STATUS = :decisionStatus
                         )
                     )
                  )
       ) AS SYMBOLIC_COUNT
  FROM DUAL
;

-- [MCOMMON_EDIT_RULE_MASTER_LIST]
SELECT R.EDIT_RULE_ID
     , R.PROJECT_ID
     , R.SCENARIO_ID
     , R.SOURCE_RULE_TYPE
     , R.SOURCE_RUN_SOURCE_TYPE
     , R.SOURCE_RUN_ID
     , R.SOURCE_OWNER
     , R.SOURCE_OBJECT_NAME
     , R.SOURCE_RULE_ID
     , R.TARGET_OWNER
     , R.TARGET_TABLE
     , R.TARGET_COLUMN
     , R.CASE_ID_COLUMN
     , R.RULE_NAME
     , R.RULE_DESCRIPTION
     , R.RULE_EXPRESSION
     , R.EXPECTED_VALUE
     , R.RULE_SUPPORT
     , R.RULE_CONFIDENCE
     , R.RULE_LIFT
     , R.RULE_TOLERANCE_PCT
     , R.DECISION_STATUS
     , R.RULE_STATUS
     , R.USER_RULE_YN
     , R.DECISION_NOTE
     , R.DECIDED_BY
     , R.DECIDED_AT
     , R.CREATED_BY
     , R.CREATED_AT
     , R.UPDATED_AT
     , S.FEATURE_COLUMNS
     , S.METHOD
     , S.COMPLEXITY
     , S.RANK_NO
  FROM "INIT$_TB_EDIT_RULE" R
  LEFT JOIN "INIT$_TB_RULEDISC_SYMBOLIC" S
    ON R.SOURCE_RULE_TYPE = 'SYMBOLIC'
   AND S.RUN_SOURCE_TYPE = R.SOURCE_RUN_SOURCE_TYPE
   AND S.RUN_ID = R.SOURCE_RUN_ID
   AND S.OWNER = R.SOURCE_OWNER
   AND S.TABLE_NAME = R.SOURCE_OBJECT_NAME
   AND S.RULE_ID = R.SOURCE_RULE_ID
   AND S.OWNER = R.TARGET_OWNER
   AND S.TABLE_NAME = R.TARGET_TABLE
   AND S.TARGET_COLUMN = R.TARGET_COLUMN
 WHERE 1=1
   AND (:projectId IS NULL OR R.PROJECT_ID = :projectId)
   AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
   AND (
          R.DECISION_STATUS = 'SELECTED'
       OR (
              R.USER_RULE_YN = 'Y'
          AND R.SOURCE_RULE_ID IS NULL
          )
       )
   AND (:decisionStatus = 'ALL' OR R.DECISION_STATUS = :decisionStatus)
   AND (:ruleStatus = 'ALL' OR R.RULE_STATUS = :ruleStatus)
   AND (
          :sourceRuleType = 'ALL'
       OR (:sourceRuleType = 'USER' AND R.USER_RULE_YN = 'Y')
       OR (
              :sourceRuleType IN ('ASSOCIATION', 'SYMBOLIC')
          AND R.SOURCE_RULE_TYPE = :sourceRuleType
          )
       )
   AND (:runSourceType IS NULL OR R.SOURCE_RUN_SOURCE_TYPE = :runSourceType)
   AND (:runId IS NULL OR R.SOURCE_RUN_ID = :runId)
 ORDER BY R.UPDATED_AT DESC NULLS LAST
        , R.CREATED_AT DESC
        , R.EDIT_RULE_ID DESC
;

-- [MCOMMON_EDIT_RULE_DECISION_LIST]
SELECT R.EDIT_RULE_ID
     , R.SOURCE_RULE_TYPE
     , R.SOURCE_RUN_SOURCE_TYPE
     , R.SOURCE_RUN_ID
     , R.SOURCE_OWNER
     , R.SOURCE_OBJECT_NAME
     , R.SOURCE_RULE_ID
     , R.TARGET_OWNER
     , R.TARGET_TABLE
     , R.TARGET_COLUMN
     , R.DECISION_STATUS
     , R.RULE_STATUS
     , R.DECISION_NOTE
     , R.CASE_ID_COLUMN
     , R.RULE_NAME
  FROM "INIT$_TB_EDIT_RULE" R
 WHERE R.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
   AND R.SOURCE_RULE_TYPE IN ('ASSOCIATION', 'SYMBOLIC')
   AND R.SOURCE_RUN_SOURCE_TYPE = :runSourceType
   AND R.SOURCE_RUN_ID = :runId
;

-- [MCOMMON_EDIT_RULE_SOURCE_ASSOC_DETAIL]
SELECT R.CONDITION_TEXT AS RULE_EXPRESSION
     , R.RESULT_VALUE AS EXPECTED_VALUE
     , R.RULE_SUPPORT
     , R.RULE_CONFIDENCE
     , R.RULE_LIFT
  FROM "INIT$_TB_RULEDISC_ASSOC_SUM" R
 WHERE R.RUN_SOURCE_TYPE = :runSourceType
   AND R.RUN_ID = :runId
   AND R.OWNER = :sourceOwner
   AND R.MODEL_NAME = :sourceObjectName
   AND R.RULE_ID = :sourceRuleId
   AND R.TARGET_OWNER = :targetOwner
   AND R.TARGET_TABLE = :targetTable
   AND R.RESULT_COLUMN = :targetColumn
;

-- [MCOMMON_EDIT_RULE_SOURCE_SYMBOLIC_DETAIL]
SELECT R.EXPRESSION AS RULE_EXPRESSION
     , CAST(NULL AS VARCHAR2(4000)) AS EXPECTED_VALUE
     , CAST(NULL AS NUMBER) AS RULE_SUPPORT
     , R.SCORE AS RULE_CONFIDENCE
     , CAST(NULL AS NUMBER) AS RULE_LIFT
  FROM "INIT$_TB_RULEDISC_SYMBOLIC" R
 WHERE R.RUN_SOURCE_TYPE = :runSourceType
   AND R.RUN_ID = :runId
   AND R.OWNER = :sourceOwner
   AND R.TABLE_NAME = :sourceObjectName
   AND R.RULE_ID = :sourceRuleId
   AND R.OWNER = :targetOwner
   AND R.TABLE_NAME = :targetTable
   AND R.TARGET_COLUMN = :targetColumn
;

-- [MCOMMON_EDIT_RULE_SOURCE_MATCH]
SELECT R.EDIT_RULE_ID
     , R.DECISION_STATUS
     , R.RULE_STATUS
     , R.DECISION_NOTE
     , R.CASE_ID_COLUMN
 FROM "INIT$_TB_EDIT_RULE" R
 WHERE R.SOURCE_RULE_TYPE = :sourceRuleType
   AND R.PROJECT_ID = :projectId
   AND (
          R.SCENARIO_ID = :scenarioId
       OR (R.SCENARIO_ID IS NULL AND :scenarioId IS NULL)
       )
   AND R.SOURCE_RUN_SOURCE_TYPE = :runSourceType
   AND R.SOURCE_RUN_ID = :runId
   AND R.SOURCE_OWNER = :sourceOwner
   AND R.SOURCE_OBJECT_NAME = :sourceObjectName
   AND R.SOURCE_RULE_ID = :sourceRuleId
   AND R.TARGET_OWNER = :targetOwner
   AND R.TARGET_TABLE = :targetTable
   AND R.TARGET_COLUMN = :targetColumn
;

-- [MCOMMON_EDIT_RULE_SELECT]
SELECT R.*
  FROM "INIT$_TB_EDIT_RULE" R
 WHERE R.EDIT_RULE_ID = :editRuleId
   AND R.PROJECT_ID = :projectId
;

-- [MCOMMON_EDIT_RULE_INSERT]
INSERT INTO "INIT$_TB_EDIT_RULE" (
    PROJECT_ID
  , SCENARIO_ID
  , SOURCE_RULE_TYPE
  , SOURCE_RUN_SOURCE_TYPE
  , SOURCE_RUN_ID
  , SOURCE_OWNER
  , SOURCE_OBJECT_NAME
  , SOURCE_RULE_ID
  , TARGET_OWNER
  , TARGET_TABLE
  , TARGET_COLUMN
  , CASE_ID_COLUMN
  , RULE_NAME
  , RULE_DESCRIPTION
  , RULE_EXPRESSION
  , EXPECTED_VALUE
  , RULE_SUPPORT
  , RULE_CONFIDENCE
  , RULE_LIFT
  , RULE_TOLERANCE_PCT
  , DECISION_STATUS
  , RULE_STATUS
  , USER_RULE_YN
  , DECISION_NOTE
  , DECIDED_BY
  , DECIDED_AT
  , CREATED_BY
) VALUES (
    :projectId
  , :scenarioId
  , :sourceRuleType
  , :runSourceType
  , :runId
  , :sourceOwner
  , :sourceObjectName
  , :sourceRuleId
  , :targetOwner
  , :targetTable
  , :targetColumn
  , :caseIdColumn
  , :ruleName
  , :ruleDescription
  , :ruleExpression
  , :expectedValue
  , :ruleSupport
  , :ruleConfidence
  , :ruleLift
  , :ruleTolerancePct
  , :decisionStatus
  , :ruleStatus
  , :userRuleYn
  , :decisionNote
  , :decidedBy
  , CASE WHEN :decisionStatus = 'PENDING' THEN NULL ELSE SYSTIMESTAMP END
  , :createdBy
)
RETURNING EDIT_RULE_ID INTO :editRuleId
;

-- [MCOMMON_EDIT_RULE_UPDATE]
UPDATE "INIT$_TB_EDIT_RULE"
   SET DECISION_STATUS = :decisionStatus
     , RULE_STATUS = :ruleStatus
     , USER_RULE_YN = 'N'
     , CASE_ID_COLUMN = :caseIdColumn
     , RULE_NAME = :ruleName
     , RULE_DESCRIPTION = :ruleDescription
     , RULE_EXPRESSION = :ruleExpression
     , EXPECTED_VALUE = :expectedValue
     , RULE_TOLERANCE_PCT = :ruleTolerancePct
     , DECISION_NOTE = :decisionNote
     , DECIDED_BY = :decidedBy
     , DECIDED_AT = CASE WHEN :decisionStatus = 'PENDING' THEN NULL ELSE SYSTIMESTAMP END
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_RULE_ID = :editRuleId
   AND PROJECT_ID = :projectId
   AND TARGET_OWNER = :targetOwner
   AND TARGET_TABLE = :targetTable
   AND TARGET_COLUMN = :targetColumn
;

-- [MCOMMON_EDIT_USER_RULE_UPDATE]
UPDATE "INIT$_TB_EDIT_RULE"
   SET SOURCE_RULE_TYPE = :sourceRuleType
     , TARGET_OWNER = :targetOwner
     , TARGET_TABLE = :targetTable
     , TARGET_COLUMN = :targetColumn
     , CASE_ID_COLUMN = :caseIdColumn
     , RULE_NAME = :ruleName
     , RULE_DESCRIPTION = :ruleDescription
     , RULE_EXPRESSION = :ruleExpression
     , EXPECTED_VALUE = :expectedValue
     , RULE_SUPPORT = NULL
     , RULE_CONFIDENCE = NULL
     , RULE_LIFT = :ruleLift
     , RULE_TOLERANCE_PCT = :ruleTolerancePct
     , DECISION_STATUS = 'SELECTED'
     , RULE_STATUS = 'ACTIVE'
     , USER_RULE_YN = 'Y'
     , DECISION_NOTE = :decisionNote
     , DECIDED_BY = :decidedBy
     , DECIDED_AT = SYSTIMESTAMP
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_RULE_ID = :editRuleId
   AND PROJECT_ID = :projectId
   AND USER_RULE_YN = 'Y'
;

-- [MCOMMON_EDIT_USER_RULE_REFERENCE_COUNT]
SELECT COUNT(*) AS REFERENCE_COUNT
  FROM "INIT$_TB_EDIT_SESSION_RULE" SR
 WHERE SR.EDIT_RULE_ID = :editRuleId
;

-- [MCOMMON_EDIT_USER_RULE_DELETE]
DELETE FROM "INIT$_TB_EDIT_RULE"
 WHERE EDIT_RULE_ID = :editRuleId
   AND PROJECT_ID = :projectId
   AND USER_RULE_YN = 'Y'
;

-- [MCOMMON_EDIT_DISCOVERED_RULE_EXCLUDE]
UPDATE "INIT$_TB_EDIT_RULE"
   SET DECISION_STATUS = 'REJECTED'
     , RULE_STATUS = 'ACTIVE'
     , USER_RULE_YN = 'N'
     , DECIDED_BY = :decidedBy
     , DECIDED_AT = SYSTIMESTAMP
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_RULE_ID = :editRuleId
   AND PROJECT_ID = :projectId
   AND SOURCE_RUN_SOURCE_TYPE IS NOT NULL
   AND SOURCE_RUN_ID IS NOT NULL
   AND SOURCE_RULE_ID IS NOT NULL
;

-- [MCOMMON_EDIT_RULE_SELECTED_LIST]
SELECT R.*
     , S.FEATURE_COLUMNS
     , S.METHOD
     , S.COMPLEXITY
     , S.RANK_NO
     , A.MODEL_TYPE
     , A.RULE_SOURCE
     , A.SUPPORT_COUNT
     , A.CONDITION_TOTAL_COUNT
     , A.RESULT_TOTAL_COUNT
     , A.TOTAL_COUNT AS SOURCE_TOTAL_COUNT
  FROM "INIT$_TB_EDIT_RULE" R
  LEFT JOIN "INIT$_TB_RULEDISC_SYMBOLIC" S
    ON R.SOURCE_RULE_TYPE = 'SYMBOLIC'
   AND S.RUN_SOURCE_TYPE = R.SOURCE_RUN_SOURCE_TYPE
   AND S.RUN_ID = R.SOURCE_RUN_ID
   AND S.OWNER = R.SOURCE_OWNER
   AND S.TABLE_NAME = R.SOURCE_OBJECT_NAME
   AND S.OWNER = R.TARGET_OWNER
   AND S.TABLE_NAME = R.TARGET_TABLE
   AND S.TARGET_COLUMN = R.TARGET_COLUMN
  LEFT JOIN "INIT$_TB_RULEDISC_ASSOC_SUM" A
    ON R.SOURCE_RULE_TYPE = 'ASSOCIATION'
   AND A.RUN_SOURCE_TYPE = R.SOURCE_RUN_SOURCE_TYPE
   AND A.RUN_ID = R.SOURCE_RUN_ID
   AND A.OWNER = R.SOURCE_OWNER
   AND A.MODEL_NAME = R.SOURCE_OBJECT_NAME
   AND A.RULE_ID = R.SOURCE_RULE_ID
   AND A.TARGET_OWNER = R.TARGET_OWNER
   AND A.TARGET_TABLE = R.TARGET_TABLE
   AND A.RESULT_COLUMN = R.TARGET_COLUMN
 WHERE 1=1
   AND R.DECISION_STATUS = 'SELECTED'
   AND R.RULE_STATUS = 'ACTIVE'
   AND (:projectId IS NULL OR R.PROJECT_ID = :projectId)
   AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
   AND (:targetOwner IS NULL OR R.TARGET_OWNER = :targetOwner)
   AND (:targetTable IS NULL OR R.TARGET_TABLE = :targetTable)
 ORDER BY R.TARGET_OWNER
        , R.TARGET_TABLE
        , R.SOURCE_RULE_TYPE
        , R.EDIT_RULE_ID
;

-- [MCOMMON_EDIT_USER_RULE_VALIDATE_ASSOC]
SELECT COUNT(*) AS SAMPLE_COUNT
     , SUM(CASE WHEN ({conditionExpression}) THEN 1 ELSE 0 END) AS MATCH_COUNT
  FROM {targetObject} T
 WHERE ROWNUM <= :sampleLimit
;

-- [MCOMMON_EDIT_USER_RULE_VALIDATE_SYMBOLIC]
SELECT COUNT(*) AS SAMPLE_COUNT
     , MIN(Q.PREDICTED_VALUE) AS MIN_PREDICTED_VALUE
     , MAX(Q.PREDICTED_VALUE) AS MAX_PREDICTED_VALUE
     , MIN(ABS(Q.ACTUAL_VALUE - Q.PREDICTED_VALUE)) AS MIN_ABS_ERROR
  FROM (
        SELECT T.{targetColumn} AS ACTUAL_VALUE
             , {formulaExpression} AS PREDICTED_VALUE
          FROM {targetObject} T
         WHERE T.{targetColumn} IS NOT NULL
               {notNullFilter}
           AND ROWNUM <= :sampleLimit
       ) Q
;

-- [MCOMMON_EDIT_LIVE_VIOLATION_ASSOC]
SELECT ORA_HASH(ROWIDTOCHAR(T.ROWID), 4294967295) AS VIOLATION_ID
     , CAST(NULL AS VARCHAR2(30)) AS RUN_SOURCE_TYPE
     , CAST(NULL AS NUMBER) AS RUN_ID
     , :targetOwner AS TARGET_OWNER
     , :targetTable AS TARGET_TABLE
     , :targetOwner AS RULE_OWNER
     , :targetTable AS SOURCE_OBJECT_NAME
     , :ruleId AS RULE_ID
     , {caseIdExpression} AS CASE_ID
     , ROWIDTOCHAR(T.ROWID) AS CASE_ROWID
     , :conditionText AS CONDITION_TEXT
     , :targetColumnName AS TARGET_COLUMN
     , :expectedValue AS EXPECTED_VALUE
     , CAST(NULL AS NUMBER) AS PREDICTED_VALUE
     , TO_CHAR(T.{targetColumn}) AS ACTUAL_VALUE
     , CAST(NULL AS NUMBER) AS ABS_ERROR
     , CAST(NULL AS NUMBER) AS ERROR_PCT
     , 1 AS VIOLATION_SCORE
     , :violationReason AS VIOLATION_REASON
     , SYSTIMESTAMP AS CREATE_DT
  FROM {targetObject} T
 WHERE ({conditionExpression})
   AND NVL(TO_CHAR(T.{targetColumn}), CHR(0)) <> NVL(:expectedValue, CHR(0))
   AND (
          :keyword IS NULL
       OR UPPER({caseIdExpression}) LIKE '%' || UPPER(:keyword) || '%'
       OR UPPER(TO_CHAR(T.{targetColumn})) LIKE '%' || UPPER(:keyword) || '%'
       OR UPPER(TO_CHAR(:expectedValue)) LIKE '%' || UPPER(:keyword) || '%'
       )
;

-- [MCOMMON_EDIT_LIVE_VIOLATION_SYMBOLIC]
SELECT ORA_HASH(Q.CASE_ROWID, 4294967295) AS VIOLATION_ID
     , CAST(NULL AS VARCHAR2(30)) AS RUN_SOURCE_TYPE
     , CAST(NULL AS NUMBER) AS RUN_ID
     , :targetOwner AS TARGET_OWNER
     , :targetTable AS TARGET_TABLE
     , :targetOwner AS RULE_OWNER
     , :targetTable AS SOURCE_OBJECT_NAME
     , :ruleId AS RULE_ID
     , Q.CASE_ID
     , Q.CASE_ROWID
     , :conditionText AS CONDITION_TEXT
     , :targetColumnName AS TARGET_COLUMN
     , TO_CHAR(Q.PREDICTED_VALUE) AS EXPECTED_VALUE
     , Q.PREDICTED_VALUE
     , TO_CHAR(Q.ACTUAL_VALUE) AS ACTUAL_VALUE
     , ABS(Q.ACTUAL_VALUE - Q.PREDICTED_VALUE) AS ABS_ERROR
     , ABS(Q.ACTUAL_VALUE - Q.PREDICTED_VALUE)
       / GREATEST(ABS(Q.ACTUAL_VALUE), 0.000000000001) AS ERROR_PCT
     , ABS(Q.ACTUAL_VALUE - Q.PREDICTED_VALUE)
       / GREATEST(ABS(Q.ACTUAL_VALUE), 0.000000000001) AS VIOLATION_SCORE
     , :violationReason AS VIOLATION_REASON
     , SYSTIMESTAMP AS CREATE_DT
  FROM (
        SELECT {caseIdExpression} AS CASE_ID
             , ROWIDTOCHAR(T.ROWID) AS CASE_ROWID
             , T.{targetColumn} AS ACTUAL_VALUE
             , {formulaExpression} AS PREDICTED_VALUE
          FROM {targetObject} T
         WHERE T.{targetColumn} IS NOT NULL
               {notNullFilter}
       ) Q
 WHERE Q.PREDICTED_VALUE IS NOT NULL
   AND ABS(Q.ACTUAL_VALUE - Q.PREDICTED_VALUE)
       > GREATEST(
             ABS(Q.ACTUAL_VALUE) * (:tolerancePct / 100)
           , 0.000000001
         )
   AND (
          :keyword IS NULL
       OR UPPER(Q.CASE_ID) LIKE '%' || UPPER(:keyword) || '%'
       OR UPPER(TO_CHAR(Q.ACTUAL_VALUE)) LIKE '%' || UPPER(:keyword) || '%'
       OR UPPER(TO_CHAR(Q.PREDICTED_VALUE)) LIKE '%' || UPPER(:keyword) || '%'
       )
;

-- [MCOMMON_EDIT_LIVE_VIOLATION_CHANGE_SCOPE]
SELECT Q.*
     , C.EDIT_CHANGE_ID
     , C.NEW_VALUE AS EDIT_NEW_VALUE
     , NVL(C.CHANGE_STATUS, 'UNEDITED') AS CHANGE_STATUS
  FROM (
        {baseSql}
       ) Q
  LEFT JOIN "INIT$_TB_EDIT_CHANGE" C
    ON C.EDIT_SESSION_ID = :editSessionId
   AND C.SOURCE_ROWID = Q.CASE_ROWID
   AND C.COLUMN_NAME = Q.TARGET_COLUMN
 WHERE 1=1
   AND (
          :changeStatus = 'ALL'
       OR (:changeStatus = 'UNEDITED' AND C.EDIT_CHANGE_ID IS NULL)
       OR C.CHANGE_STATUS = :changeStatus
       )
;

-- [MCOMMON_EDIT_SESSION_LIST]
SELECT S.*
     , S.EDIT_SESSION_ID AS EDIT_EXECUTION_ID
     , (SELECT COUNT(*)
          FROM "INIT$_TB_EDIT_CHANGE" C
         WHERE C.EDIT_SESSION_ID = S.EDIT_SESSION_ID
           AND C.CHANGE_STATUS = 'APPLIED') AS CHANGED_CELL_COUNT
     , (SELECT COUNT(DISTINCT C.SOURCE_ROWID)
          FROM "INIT$_TB_EDIT_CHANGE" C
         WHERE C.EDIT_SESSION_ID = S.EDIT_SESSION_ID
           AND C.CHANGE_STATUS = 'APPLIED') AS CHANGED_ROW_COUNT
     , (SELECT COUNT(*)
          FROM "INIT$_TB_EDIT_SESSION_RULE" SR
         WHERE SR.EDIT_SESSION_ID = S.EDIT_SESSION_ID) AS EXECUTION_RULE_COUNT
     , (SELECT COUNT(*)
          FROM "INIT$_TB_EDIT_DML" D
         WHERE D.EDIT_SESSION_ID = S.EDIT_SESSION_ID) AS DML_COUNT
     , (SELECT COUNT(*)
          FROM "INIT$_TB_EDIT_DML" D
         WHERE D.EDIT_SESSION_ID = S.EDIT_SESSION_ID
           AND D.DML_STATUS = 'EXECUTED') AS EXECUTED_DML_COUNT
     , (SELECT MAX(D.EXECUTED_AT)
          FROM "INIT$_TB_EDIT_DML" D
         WHERE D.EDIT_SESSION_ID = S.EDIT_SESSION_ID
           AND D.DML_STATUS = 'EXECUTED') AS LAST_EXECUTED_AT
  FROM "INIT$_TB_EDIT_SESSION" S
 WHERE 1=1
   AND (:projectId IS NULL OR S.PROJECT_ID = :projectId)
   AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
   AND (:sessionStatus = 'ALL' OR S.SESSION_STATUS = :sessionStatus)
 ORDER BY S.UPDATED_AT DESC NULLS LAST
        , S.CREATED_AT DESC
        , S.EDIT_SESSION_ID DESC
;

-- [MCOMMON_EDIT_SESSION_SELECT]
SELECT S.*
     , S.EDIT_SESSION_ID AS EDIT_EXECUTION_ID
  FROM "INIT$_TB_EDIT_SESSION" S
 WHERE S.EDIT_SESSION_ID = :editSessionId
;

-- [MCOMMON_EDIT_SESSION_ACTIVE_SELECT]
SELECT S.*
  FROM "INIT$_TB_EDIT_SESSION" S
 WHERE S.PROJECT_ID = :projectId
   AND (
          S.SCENARIO_ID = :scenarioId
       OR (S.SCENARIO_ID IS NULL AND :scenarioId IS NULL)
       )
   AND S.TARGET_OWNER = :targetOwner
   AND S.SOURCE_TABLE = :sourceTable
   AND S.EDIT_TABLE = :editTable
   AND S.SESSION_STATUS IN ('DRAFT', 'EDITING', 'VALIDATED', 'APPLY_READY')
 ORDER BY S.UPDATED_AT DESC NULLS LAST
        , S.CREATED_AT DESC
        , S.EDIT_SESSION_ID DESC
;

-- [MCOMMON_EDIT_SESSION_CANCEL]
UPDATE "INIT$_TB_EDIT_SESSION"
   SET SESSION_STATUS = 'CANCELLED'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_SESSION_ID = :editSessionId
   AND SESSION_STATUS IN ('DRAFT', 'EDITING', 'VALIDATED', 'APPLY_READY')
;

-- [MCOMMON_EDIT_SESSION_INSERT]
INSERT INTO "INIT$_TB_EDIT_SESSION" (
    PROJECT_ID
  , SCENARIO_ID
  , SESSION_NAME
  , TARGET_OWNER
  , SOURCE_TABLE
  , EDIT_TABLE
  , SOURCE_RUN_SOURCE_TYPE
  , SOURCE_RUN_ID
  , SESSION_STATUS
  , CREATED_BY
) VALUES (
    :projectId
  , :scenarioId
  , :sessionName
  , :targetOwner
  , :sourceTable
  , :editTable
  , :runSourceType
  , :runId
  , 'DRAFT'
  , :createdBy
)
RETURNING EDIT_SESSION_ID INTO :editSessionId
;

-- [MCOMMON_EDIT_SESSION_RULE_INSERT]
INSERT INTO "INIT$_TB_EDIT_SESSION_RULE" (
    EDIT_SESSION_ID
  , EDIT_RULE_ID
) VALUES (
    :editSessionId
  , :editRuleId
)
;

-- [MCOMMON_EDIT_SESSION_RULE_LIST]
SELECT SR.EDIT_SESSION_ID
     , SR.EDIT_RULE_ID
     , R.RULE_NAME
     , R.SOURCE_RULE_TYPE
     , R.SOURCE_RUN_SOURCE_TYPE
     , R.SOURCE_RUN_ID
     , R.SOURCE_OWNER
     , R.SOURCE_OBJECT_NAME
     , R.SOURCE_RULE_ID
     , R.TARGET_OWNER
     , R.TARGET_TABLE
     , R.TARGET_COLUMN
  FROM "INIT$_TB_EDIT_SESSION_RULE" SR
  JOIN "INIT$_TB_EDIT_RULE" R
    ON R.EDIT_RULE_ID = SR.EDIT_RULE_ID
 WHERE SR.EDIT_SESSION_ID = :editSessionId
 ORDER BY SR.EDIT_RULE_ID
;

-- [MCOMMON_EDIT_VIOLATION_SCOPE_LIST]
SELECT 'ASSOCIATION' AS SOURCE_RULE_TYPE
     , V.RESULT_COLUMN AS TARGET_COLUMN
     , COUNT(*) AS VIOLATION_COUNT
  FROM "INIT$_TB_RULEVIOL_ASSOC" V
 WHERE V.RUN_SOURCE_TYPE = :runSourceType
   AND V.RUN_ID = :runId
   AND V.TARGET_OWNER = :targetOwner
   AND V.TARGET_TABLE = :targetTable
 GROUP BY V.RESULT_COLUMN
 UNION ALL
SELECT 'SYMBOLIC' AS SOURCE_RULE_TYPE
     , V.TARGET_COLUMN
     , COUNT(*) AS VIOLATION_COUNT
  FROM "INIT$_TB_RULEVIOL_SYMBOLIC" V
 WHERE V.RUN_SOURCE_TYPE = :runSourceType
   AND V.RUN_ID = :runId
   AND V.TARGET_OWNER = :targetOwner
   AND V.TARGET_TABLE = :targetTable
 GROUP BY V.TARGET_COLUMN
;

-- [MCOMMON_EDIT_FLOW_RUN_STATUS]
SELECT R.FLOW_RUN_ID
     , R.STATUS
     , R.MESSAGE
     , R.STARTED_AT
     , R.FINISHED_AT
  FROM "INIT$_TB_FLOW_WORK_RUN" R
 WHERE R.FLOW_RUN_ID = :flowRunId
;

-- [MCOMMON_EDIT_FLOW_RUN_ACCESS]
SELECT R.FLOW_RUN_ID
     , R.STATUS
     , R.MESSAGE
     , R.PLAN_JSON
     , F.PROJECT_ID
     , F.SCENARIO_ID
  FROM "INIT$_TB_FLOW_WORK_RUN" R
  JOIN "INIT$_TB_FLOW_WORK" F
    ON F.FLOW_ID = R.FLOW_ID
 WHERE R.FLOW_RUN_ID = :flowRunId
;

-- [MCOMMON_EDIT_SESSION_PREPARED]
UPDATE "INIT$_TB_EDIT_SESSION"
   SET SESSION_STATUS = 'EDITING'
     , SOURCE_ROW_COUNT = :sourceRowCount
     , PREPARED_AT = SYSTIMESTAMP
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_SESSION_ID = :editSessionId
;

-- [MCOMMON_EDIT_SESSION_BASELINE]
UPDATE "INIT$_TB_EDIT_SESSION"
   SET BASELINE_FLOW_RUN_ID = :flowRunId
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_SESSION_ID = :editSessionId
;

-- [MCOMMON_EDIT_SESSION_STATUS]
UPDATE "INIT$_TB_EDIT_SESSION"
   SET SESSION_STATUS = :sessionStatus
     , VALIDATED_AT = CASE WHEN :sessionStatus IN ('VALIDATED', 'APPLY_READY') THEN SYSTIMESTAMP ELSE VALIDATED_AT END
     , APPLIED_AT = CASE WHEN :sessionStatus = 'APPLIED' THEN SYSTIMESTAMP ELSE APPLIED_AT END
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_SESSION_ID = :editSessionId
;

-- [MCOMMON_EDIT_SESSION_REANALYSIS]
UPDATE "INIT$_TB_EDIT_SESSION"
   SET REANALYSIS_FLOW_RUN_ID = :flowRunId
     , REANALYSIS_STATUS = :reanalysisStatus
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_SESSION_ID = :editSessionId
;

-- [MCOMMON_EDIT_CHANGE_MERGE]
MERGE INTO "INIT$_TB_EDIT_CHANGE" T
USING (
      SELECT :editSessionId AS EDIT_SESSION_ID
           , :editRuleId AS EDIT_RULE_ID
           , :sourceViolationType AS SOURCE_VIOLATION_TYPE
           , :sourceViolationId AS SOURCE_VIOLATION_ID
           , :sourceRowid AS SOURCE_ROWID
           , :caseId AS CASE_ID
           , :columnName AS COLUMN_NAME
           , :oldValue AS OLD_VALUE
           , :newValue AS NEW_VALUE
           , :expectedValue AS EXPECTED_VALUE
           , :editedBy AS EDITED_BY
        FROM DUAL
     ) S
   ON (
          T.EDIT_SESSION_ID = S.EDIT_SESSION_ID
      AND T.SOURCE_ROWID = S.SOURCE_ROWID
      AND T.COLUMN_NAME = S.COLUMN_NAME
      )
 WHEN MATCHED THEN
      UPDATE
         SET T.EDIT_RULE_ID = S.EDIT_RULE_ID
           , T.SOURCE_VIOLATION_TYPE = S.SOURCE_VIOLATION_TYPE
           , T.SOURCE_VIOLATION_ID = S.SOURCE_VIOLATION_ID
           , T.CASE_ID = S.CASE_ID
           , T.NEW_VALUE = S.NEW_VALUE
           , T.EXPECTED_VALUE = S.EXPECTED_VALUE
           , T.CHANGE_STATUS = 'APPLIED'
           , T.EDITED_BY = S.EDITED_BY
           , T.EDITED_AT = SYSTIMESTAMP
 WHEN NOT MATCHED THEN
      INSERT (
          EDIT_SESSION_ID
        , EDIT_RULE_ID
        , SOURCE_VIOLATION_TYPE
        , SOURCE_VIOLATION_ID
        , SOURCE_ROWID
        , CASE_ID
        , COLUMN_NAME
        , OLD_VALUE
        , NEW_VALUE
        , EXPECTED_VALUE
        , CHANGE_STATUS
        , EDITED_BY
        , EDITED_AT
      ) VALUES (
          S.EDIT_SESSION_ID
        , S.EDIT_RULE_ID
        , S.SOURCE_VIOLATION_TYPE
        , S.SOURCE_VIOLATION_ID
        , S.SOURCE_ROWID
        , S.CASE_ID
        , S.COLUMN_NAME
        , S.OLD_VALUE
        , S.NEW_VALUE
        , S.EXPECTED_VALUE
        , 'APPLIED'
        , S.EDITED_BY
        , SYSTIMESTAMP
      )
;

-- [MCOMMON_EDIT_CHANGE_LIST]
SELECT C.*
     , R.RULE_NAME
     , R.SOURCE_RULE_TYPE
     , R.SOURCE_RULE_ID
     , R.TARGET_OWNER
     , R.TARGET_TABLE
     , R.CASE_ID_COLUMN
  FROM "INIT$_TB_EDIT_CHANGE" C
  LEFT JOIN "INIT$_TB_EDIT_RULE" R
    ON R.EDIT_RULE_ID = C.EDIT_RULE_ID
 WHERE C.EDIT_SESSION_ID = :editSessionId
   AND (:changeStatus = 'ALL' OR C.CHANGE_STATUS = :changeStatus)
 ORDER BY C.EDITED_AT DESC
        , C.EDIT_CHANGE_ID DESC
;

-- [MCOMMON_EDIT_VALIDATION_SUMMARY]
SELECT S.EDIT_SESSION_ID
     , S.SESSION_STATUS
     , S.SOURCE_ROW_COUNT
     , COUNT(C.EDIT_CHANGE_ID) AS TOTAL_CHANGE_COUNT
     , COUNT(DISTINCT C.SOURCE_ROWID) AS CHANGED_ROW_COUNT
     , SUM(CASE WHEN C.CHANGE_STATUS = 'APPLIED' THEN 1 ELSE 0 END) AS APPLIED_CHANGE_COUNT
     , SUM(
           CASE
               WHEN C.CHANGE_STATUS = 'APPLIED'
                AND NVL(DBMS_LOB.SUBSTR(C.NEW_VALUE, 4000, 1), CHR(0))
                    = NVL(DBMS_LOB.SUBSTR(C.EXPECTED_VALUE, 4000, 1), CHR(0))
               THEN 1
               ELSE 0
           END
       ) AS EXPECTED_MATCH_COUNT
     , SUM(CASE WHEN C.CHANGE_STATUS = 'REVERTED' THEN 1 ELSE 0 END) AS REVERTED_CHANGE_COUNT
  FROM "INIT$_TB_EDIT_SESSION" S
  LEFT JOIN "INIT$_TB_EDIT_CHANGE" C
    ON C.EDIT_SESSION_ID = S.EDIT_SESSION_ID
 WHERE S.EDIT_SESSION_ID = :editSessionId
 GROUP BY S.EDIT_SESSION_ID
        , S.SESSION_STATUS
        , S.SOURCE_ROW_COUNT
;

-- [MCOMMON_EDIT_DML_LIST]
SELECT D.*
  FROM "INIT$_TB_EDIT_DML" D
 WHERE (:editSessionId IS NULL OR D.EDIT_SESSION_ID = :editSessionId)
   AND (:includeAllUsers = 'Y' OR D.CREATED_BY = :userId)
 ORDER BY D.EDIT_DML_ID DESC
;

-- [MCOMMON_EDIT_DML_INSERT]
INSERT INTO "INIT$_TB_EDIT_DML" (
    EDIT_SESSION_ID
  , DML_NAME
  , DML_SQL
  , DML_STATUS
  , CREATED_BY
) VALUES (
    :editSessionId
  , :dmlName
  , :dmlSql
  , 'DRAFT'
  , :createdBy
)
RETURNING EDIT_DML_ID INTO :editDmlId
;

-- [MCOMMON_EDIT_DML_UPDATE]
UPDATE "INIT$_TB_EDIT_DML"
   SET DML_NAME = :dmlName
     , DML_SQL = :dmlSql
     , DML_STATUS = 'DRAFT'
     , VALIDATION_MESSAGE = NULL
     , APPROVED_BY = NULL
     , APPROVED_AT = NULL
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_DML_ID = :editDmlId
   AND EDIT_SESSION_ID = :editSessionId
   AND DML_STATUS IN ('DRAFT', 'APPROVED', 'FAILED')
;

-- [MCOMMON_EDIT_DML_SELECT]
SELECT D.*
  FROM "INIT$_TB_EDIT_DML" D
 WHERE D.EDIT_DML_ID = :editDmlId
;

-- [MCOMMON_EDIT_DML_SELECT_FOR_UPDATE]
SELECT D.*
  FROM "INIT$_TB_EDIT_DML" D
 WHERE D.EDIT_DML_ID = :editDmlId
   FOR UPDATE
;

-- [MCOMMON_EDIT_DML_APPROVE]
UPDATE "INIT$_TB_EDIT_DML"
   SET DML_STATUS = 'APPROVED'
     , VALIDATION_MESSAGE = :validationMessage
     , APPROVED_BY = :approvedBy
     , APPROVED_AT = SYSTIMESTAMP
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_DML_ID = :editDmlId
;

-- [MCOMMON_EDIT_DML_EXECUTION_RESULT]
UPDATE "INIT$_TB_EDIT_DML"
   SET DML_STATUS = :dmlStatus
     , EXECUTED_BY = :executedBy
     , EXECUTED_AT = SYSTIMESTAMP
     , AFFECTED_ROW_COUNT = :affectedRowCount
     , EXECUTION_MESSAGE = :executionMessage
     , UPDATED_AT = SYSTIMESTAMP
 WHERE EDIT_DML_ID = :editDmlId
;

-- [MCOMMON_EDIT_DML_DELETE]
DELETE FROM "INIT$_TB_EDIT_DML"
 WHERE EDIT_DML_ID = :editDmlId
   AND DML_STATUS <> 'EXECUTED'
;

-- [MCOMMON_EDIT_EVENT_INSERT]
INSERT INTO "INIT$_TB_EDIT_EVENT" (
    EDIT_SESSION_ID
  , EVENT_TYPE
  , ENTITY_TYPE
  , ENTITY_ID
  , EVENT_SUMMARY
  , EVENT_DETAIL_JSON
  , EVENT_USER
) VALUES (
    :editSessionId
  , :eventType
  , :entityType
  , :entityId
  , :eventSummary
  , :eventDetailJson
  , :eventUser
)
;

-- [MCOMMON_EDIT_EVENT_LIST]
SELECT E.*
     , D.DML_NAME
     , D.DML_SQL
     , D.DML_STATUS
     , D.VALIDATION_MESSAGE AS DML_VALIDATION_MESSAGE
     , D.EXECUTION_MESSAGE AS DML_EXECUTION_MESSAGE
     , D.AFFECTED_ROW_COUNT
     , D.EXECUTED_BY
     , D.EXECUTED_AT
  FROM "INIT$_TB_EDIT_EVENT" E
  LEFT JOIN "INIT$_TB_EDIT_SESSION" S
    ON S.EDIT_SESSION_ID = E.EDIT_SESSION_ID
  LEFT JOIN "INIT$_TB_EDIT_RULE" R
    ON E.ENTITY_TYPE = 'EDIT_RULE'
   AND R.EDIT_RULE_ID = E.ENTITY_ID
  LEFT JOIN "INIT$_TB_EDIT_DML" D
    ON E.ENTITY_TYPE = 'EDIT_DML'
   AND D.EDIT_DML_ID = E.ENTITY_ID
 WHERE (:editSessionId IS NULL OR E.EDIT_SESSION_ID = :editSessionId)
   AND (:projectId IS NULL OR NVL(S.PROJECT_ID, R.PROJECT_ID) = :projectId)
   AND (:eventType = 'ALL' OR E.EVENT_TYPE = :eventType)
   AND (:includeAllUsers = 'Y' OR E.EVENT_USER = :userId)
 ORDER BY E.CREATED_AT DESC
        , E.EDIT_EVENT_ID DESC
;

-- [MCOMMON_EDIT_TABLE_EXISTS]
SELECT COUNT(*) AS OBJECT_COUNT
  FROM ALL_TABLES
 WHERE OWNER = :ownerName
   AND TABLE_NAME = :tableName
;

-- [MCOMMON_EDIT_TABLE_COMMENT]
SELECT COMMENTS AS TABLE_COMMENT
  FROM ALL_TAB_COMMENTS
 WHERE OWNER = :ownerName
   AND TABLE_NAME = :tableName
;

-- [MCOMMON_EDIT_TABLE_COLUMNS]
SELECT C.COLUMN_NAME
     , C.DATA_TYPE
     , C.DATA_LENGTH
     , C.DATA_PRECISION
     , C.DATA_SCALE
     , C.NULLABLE
     , C.COLUMN_ID
     , CC.COMMENTS AS COLUMN_COMMENT
  FROM ALL_TAB_COLUMNS C
  LEFT JOIN ALL_COL_COMMENTS CC
    ON CC.OWNER = C.OWNER
   AND CC.TABLE_NAME = C.TABLE_NAME
   AND CC.COLUMN_NAME = C.COLUMN_NAME
 WHERE C.OWNER = :ownerName
   AND C.TABLE_NAME = :tableName
 ORDER BY C.COLUMN_ID
;
