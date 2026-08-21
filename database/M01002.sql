
-- [M01002_PROJECT_LIST]
SELECT P.PROJECT_ID
     , P.USER_ID
     , P.USER_EMAIL
     , CASE WHEN P.USER_ID = :userId THEN 'Y' ELSE 'N' END AS IS_OWNER_YN
     , CASE WHEN P.USER_ID = :userId THEN 'MY' ELSE 'OTHER' END AS OWNER_SCOPE
     , P.PROJECT_CODE
     , P.PROJECT_NAME
     , P.PROJECT_TYPE
     , P.PROJECT_DESC
     , P.USE_YN
     , P.SORT_ORDER
     , P.CREATED_AT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_SCENARIO S
         WHERE S.PROJECT_ID = P.PROJECT_ID
    ) AS SCENARIO_COUNT
     , CASE
        WHEN EXISTS (
            SELECT 1
              FROM INIT$_TB_SCENARIO S
             WHERE S.PROJECT_ID = P.PROJECT_ID
        ) THEN 'Y'
        ELSE 'N'
    END AS HAS_SCENARIO_YN
  FROM INIT$_TB_PROJECT P
 WHERE P.USE_YN = 'Y'
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
   AND (
          :keyword IS NULL
       OR TRIM(:keyword) IS NULL
       OR UPPER(P.PROJECT_NAME) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(P.PROJECT_CODE) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(NVL(P.PROJECT_TYPE, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(NVL(P.PROJECT_DESC, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       )
 ORDER BY CASE WHEN P.USER_ID = :userId THEN 0 ELSE 1 END
        , P.USER_EMAIL
        , P.SORT_ORDER NULLS LAST
        , P.PROJECT_NAME
        , P.PROJECT_ID
;

-- [M01002_PROJECT_OWNER_CHECK]
SELECT COUNT(*) AS CNT
  FROM INIT$_TB_PROJECT
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
;

-- [M01002_SCENARIO_LIST]
SELECT S.SCENARIO_ID
     , S.PROJECT_ID
     , P.USER_ID AS PROJECT_USER_ID
     , P.USER_EMAIL AS PROJECT_USER_EMAIL
     , CASE WHEN P.USER_ID = :userId THEN 'Y' ELSE 'N' END AS IS_OWNER_YN
     , CASE WHEN P.USER_ID = :userId THEN 'MY' ELSE 'OTHER' END AS OWNER_SCOPE
     , S.SCENARIO_CODE
     , S.SCENARIO_NAME
     , S.SCENARIO_TYPE
     , S.SCENARIO_DESC
     , S.DATA_WORK_RUN_ID
     , S.DATA_WORK_RUN_AT
     , S.USE_YN
     , S.SORT_ORDER
     , S.CREATED_AT
     , S.UPDATED_AT
  FROM INIT$_TB_SCENARIO S
  JOIN INIT$_TB_PROJECT P
    ON P.PROJECT_ID = S.PROJECT_ID
 WHERE S.PROJECT_ID = :projectId
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
   AND (
          :keyword IS NULL
       OR TRIM(:keyword) IS NULL
       OR UPPER(S.SCENARIO_NAME) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(S.SCENARIO_CODE) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(NVL(S.SCENARIO_TYPE, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(NVL(S.SCENARIO_DESC, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       )
 ORDER BY S.SORT_ORDER NULLS LAST
        , S.SCENARIO_NAME
        , S.SCENARIO_ID
;

-- [M01002_SCENARIO_DETAIL]
SELECT S.SCENARIO_ID
     , S.PROJECT_ID
     , P.USER_ID AS PROJECT_USER_ID
     , P.USER_EMAIL AS PROJECT_USER_EMAIL
     , CASE WHEN P.USER_ID = :userId THEN 'Y' ELSE 'N' END AS IS_OWNER_YN
     , CASE WHEN P.USER_ID = :userId THEN 'MY' ELSE 'OTHER' END AS OWNER_SCOPE
     , S.SCENARIO_CODE
     , S.SCENARIO_NAME
     , S.SCENARIO_TYPE
     , S.SCENARIO_DESC
     , S.DATA_WORK_RUN_ID
     , S.DATA_WORK_RUN_AT
     , S.USE_YN
     , S.SORT_ORDER
     , S.CREATED_AT
     , S.UPDATED_AT
  FROM INIT$_TB_SCENARIO S
  JOIN INIT$_TB_PROJECT P
    ON P.PROJECT_ID = S.PROJECT_ID
 WHERE S.SCENARIO_ID = :scenarioId
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
;

-- [M01002_SCENARIO_INSERT]
INSERT INTO INIT$_TB_SCENARIO (
    PROJECT_ID
  , SCENARIO_CODE
  , SCENARIO_NAME
  , SCENARIO_TYPE
  , SCENARIO_DESC
  , USE_YN
  , SORT_ORDER
  , CREATED_AT
) VALUES (
    :projectId
  , :scenarioCode
  , :scenarioName
  , :scenarioType
  , :scenarioDesc
  , :useYn
  , :sortOrder
  , SYSTIMESTAMP
)
;

-- [M01002_SCENARIO_ID_BY_CODE]
SELECT SCENARIO_ID
  FROM INIT$_TB_SCENARIO
 WHERE PROJECT_ID = :projectId
   AND SCENARIO_CODE = :scenarioCode
   AND EXISTS (
        SELECT 1
          FROM INIT$_TB_PROJECT P
         WHERE P.PROJECT_ID = :projectId
           AND P.USER_ID = :userId
   )
;

-- [M01002_SCENARIO_UPDATE]
UPDATE INIT$_TB_SCENARIO
   SET SCENARIO_CODE = :scenarioCode
     , SCENARIO_NAME = :scenarioName
     , SCENARIO_TYPE = :scenarioType
     , SCENARIO_DESC = :scenarioDesc
     , USE_YN = :useYn
     , SORT_ORDER = :sortOrder
     , UPDATED_AT = SYSTIMESTAMP
 WHERE SCENARIO_ID = :scenarioId
   AND PROJECT_ID = :projectId
   AND EXISTS (
        SELECT 1
          FROM INIT$_TB_PROJECT P
         WHERE P.PROJECT_ID = :projectId
           AND P.USER_ID = :userId
   )
;

-- [M01002_SCENARIO_DELETE]
DELETE FROM INIT$_TB_SCENARIO
 WHERE SCENARIO_ID = :scenarioId
   AND EXISTS (
        SELECT 1
          FROM INIT$_TB_PROJECT P
         WHERE P.PROJECT_ID = INIT$_TB_SCENARIO.PROJECT_ID
           AND P.USER_ID = :userId
   )
;

-- [M01002_SCENARIO_DELETE_SCOPE_LOCK]
SELECT S.SCENARIO_ID
  FROM INIT$_TB_SCENARIO S
  JOIN INIT$_TB_PROJECT P
    ON P.PROJECT_ID = S.PROJECT_ID
 WHERE S.SCENARIO_ID = :scenarioId
   AND P.USER_ID = :userId
   FOR UPDATE
;

-- [M01002_SCENARIO_CHILD_COUNT]
SELECT (
        SELECT COUNT(*)
          FROM INIT$_TB_TABLES T
         WHERE T.SCENARIO_ID = :scenarioId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = T.PROJECT_ID
                   AND P.USER_ID = :userId
           )
    ) AS SCENARIO_TABLE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_DATA_WORK_JOB J
         WHERE J.SCENARIO_ID = :scenarioId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = J.PROJECT_ID
                   AND P.USER_ID = :userId
           )
    ) AS DATA_WORK_JOB_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK F
         WHERE F.SCENARIO_ID = :scenarioId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = F.PROJECT_ID
                   AND P.USER_ID = :userId
           )
    ) AS FLOW_WORK_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_RULE R
         WHERE R.SCENARIO_ID = :scenarioId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_SCENARIO S
                  JOIN INIT$_TB_PROJECT P
                    ON P.PROJECT_ID = S.PROJECT_ID
                 WHERE S.SCENARIO_ID = :scenarioId
                   AND P.USER_ID = :userId
           )
    ) AS EDIT_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_SESSION ES
         WHERE ES.SCENARIO_ID = :scenarioId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_SCENARIO S
                  JOIN INIT$_TB_PROJECT P
                    ON P.PROJECT_ID = S.PROJECT_ID
                 WHERE S.SCENARIO_ID = :scenarioId
                   AND P.USER_ID = :userId
           )
    ) AS EDIT_SESSION_COUNT
  FROM DUAL
;

-- [M01002_SCENARIO_CHILD_COUNT_BY_PROJECT]
SELECT (
        SELECT COUNT(*)
          FROM INIT$_TB_TABLES
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS SCENARIO_TABLE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_DATA_WORK_JOB
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS DATA_WORK_JOB_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS FLOW_WORK_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_RULE
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS EDIT_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_SESSION
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS EDIT_SESSION_COUNT
  FROM DUAL
;
