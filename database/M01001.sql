-- [M01001_PROJECT_LIST]
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
     , P.UPDATED_AT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_SCENARIO S
         WHERE S.PROJECT_ID = P.PROJECT_ID
    ) AS SCENARIO_COUNT
  FROM INIT$_TB_PROJECT P
 WHERE (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
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

-- [M01001_PROJECT_DETAIL]
SELECT PROJECT_ID
     , USER_ID
     , USER_EMAIL
     , CASE WHEN USER_ID = :userId THEN 'Y' ELSE 'N' END AS IS_OWNER_YN
     , CASE WHEN USER_ID = :userId THEN 'MY' ELSE 'OTHER' END AS OWNER_SCOPE
     , PROJECT_CODE
     , PROJECT_NAME
     , PROJECT_TYPE
     , PROJECT_DESC
     , USE_YN
     , SORT_ORDER
     , CREATED_AT
     , UPDATED_AT
  FROM INIT$_TB_PROJECT
 WHERE PROJECT_ID = :projectId
   AND (:includeAllUsers = 'Y' OR USER_ID = :userId)
;

-- [M01001_PROJECT_INSERT]
INSERT INTO INIT$_TB_PROJECT (
    USER_ID
  , USER_EMAIL
  , PROJECT_CODE
  , PROJECT_NAME
  , PROJECT_TYPE
  , PROJECT_DESC
  , USE_YN
  , SORT_ORDER
  , CREATED_AT
) VALUES (
    :userId
  , :userEmail
  , :projectCode
  , :projectName
  , :projectType
  , :projectDesc
  , :useYn
  , :sortOrder
  , SYSTIMESTAMP
)
;

-- [M01001_PROJECT_NAMES_FOR_UNIQUENESS]
SELECT PROJECT_NAME
  FROM INIT$_TB_PROJECT
 WHERE USER_ID = :userId
   AND (
          UPPER(PROJECT_NAME) = UPPER(:projectName)
       OR UPPER(PROJECT_NAME) LIKE UPPER(:projectNamePattern) ESCAPE '\'
       )
;

-- [M01001_PROJECT_ID_BY_CODE]
SELECT PROJECT_ID
  FROM INIT$_TB_PROJECT
 WHERE USER_ID = :userId
   AND PROJECT_CODE = :projectCode
;

-- [M01001_PROJECT_UPDATE]
UPDATE INIT$_TB_PROJECT
   SET PROJECT_CODE = :projectCode
     , USER_EMAIL = :userEmail
     , PROJECT_NAME = :projectName
     , PROJECT_TYPE = :projectType
     , PROJECT_DESC = :projectDesc
     , USE_YN = :useYn
     , SORT_ORDER = :sortOrder
     , UPDATED_AT = SYSTIMESTAMP
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
;

-- [M01001_PROJECT_DELETE]
DELETE FROM INIT$_TB_PROJECT
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
;

-- [M01001_PROJECT_DELETE_SCOPE_LOCK]
SELECT PROJECT_ID
  FROM INIT$_TB_PROJECT
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
   FOR UPDATE
;

-- [M01001_PROJECT_CHILD_COUNT]
SELECT (
        SELECT COUNT(*)
          FROM INIT$_TB_SCENARIO
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS SCENARIO_COUNT
     , (
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
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_UPLOAD_TABLE_META UM
         WHERE UM.PROJECT_ID = :projectId
           AND UM.TABLE_NAME LIKE 'INITUP$%'
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
           AND (
                  EXISTS (
                       SELECT 1
                         FROM ALL_TABLES AT
                        WHERE AT.OWNER = UM.OWNER_NAME
                          AND AT.TABLE_NAME = UM.TABLE_NAME
                  )
               OR EXISTS (
                       SELECT 1
                         FROM ALL_TABLES AT
                        WHERE AT.OWNER = UM.OWNER_NAME
                          AND AT.TABLE_NAME = 'INITDN$' || SUBSTR(UM.TABLE_NAME, LENGTH('INITUP$') + 1)
                  )
               )
    ) AS MANAGED_TABLE_PAIR_COUNT
  FROM DUAL
;

-- [M01001_UPLOAD_META_DELETE_STALE_BY_PROJECT]
DELETE FROM INIT$_TB_UPLOAD_TABLE_META UM
 WHERE UM.PROJECT_ID = :projectId
   AND NOT EXISTS (
        SELECT 1
          FROM ALL_TABLES AT
         WHERE AT.OWNER = UM.OWNER_NAME
           AND AT.TABLE_NAME = UM.TABLE_NAME
   )
   AND NOT EXISTS (
        SELECT 1
          FROM ALL_TABLES AT
         WHERE AT.OWNER = UM.OWNER_NAME
           AND AT.TABLE_NAME = 'INITDN$' || SUBSTR(UM.TABLE_NAME, LENGTH('INITUP$') + 1)
   )
;
