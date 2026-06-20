-- [M01001_PROJECT_LIST]
SELECT
    PROJECT_ID,
    USER_ID,
    USER_EMAIL,
    PROJECT_CODE,
    PROJECT_NAME,
    PROJECT_TYPE,
    PROJECT_DESC,
    USE_YN,
    SORT_ORDER,
    CREATED_AT,
    UPDATED_AT
  FROM INIT$_TB_PROJECT
 WHERE USER_ID = :userId
   AND (
          :keyword IS NULL
       OR TRIM(:keyword) IS NULL
       OR UPPER(PROJECT_NAME) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(PROJECT_CODE) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(NVL(PROJECT_TYPE, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       OR UPPER(NVL(PROJECT_DESC, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
       )
 ORDER BY SORT_ORDER, PROJECT_NAME, PROJECT_ID
;

-- [M01001_PROJECT_DETAIL]
SELECT
    PROJECT_ID,
    USER_ID,
    USER_EMAIL,
    PROJECT_CODE,
    PROJECT_NAME,
    PROJECT_TYPE,
    PROJECT_DESC,
    USE_YN,
    SORT_ORDER,
    CREATED_AT,
    UPDATED_AT
  FROM INIT$_TB_PROJECT
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
;

-- [M01001_PROJECT_INSERT]
INSERT INTO INIT$_TB_PROJECT (
    USER_ID,
    USER_EMAIL,
    PROJECT_CODE,
    PROJECT_NAME,
    PROJECT_TYPE,
    PROJECT_DESC,
    USE_YN,
    SORT_ORDER,
    CREATED_AT
) VALUES (
    :userId,
    :userEmail,
    :projectCode,
    :projectName,
    :projectType,
    :projectDesc,
    :useYn,
    :sortOrder,
    SYSTIMESTAMP
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
   SET PROJECT_CODE = :projectCode,
       USER_EMAIL = :userEmail,
       PROJECT_NAME = :projectName,
       PROJECT_TYPE = :projectType,
       PROJECT_DESC = :projectDesc,
       USE_YN = :useYn,
       SORT_ORDER = :sortOrder,
       UPDATED_AT = SYSTIMESTAMP
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
;

-- [M01001_PROJECT_DELETE]
DELETE FROM INIT$_TB_PROJECT
 WHERE PROJECT_ID = :projectId
   AND USER_ID = :userId
;

-- [M01001_PROJECT_CHILD_COUNT]
SELECT
    (
        SELECT COUNT(*)
          FROM INIT$_TB_SCENARIO
         WHERE PROJECT_ID = :projectId
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_PROJECT P
                 WHERE P.PROJECT_ID = :projectId
                   AND P.USER_ID = :userId
           )
    ) AS SCENARIO_COUNT,
    (
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
  FROM DUAL
;
