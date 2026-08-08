-- [M06001_PROJECT_PAGE]
SELECT *
  FROM (
        SELECT Q.*
             , ROW_NUMBER() OVER (
                   ORDER BY Q.OWNER_SORT
                          , Q.SORT_ORDER NULLS LAST
                          , Q.PROJECT_NAME
                          , Q.PROJECT_ID
               ) AS RN__
          FROM (
                SELECT P.PROJECT_ID
                     , CASE WHEN P.USER_ID = :userId THEN 'Y' ELSE 'N' END AS IS_OWNER_YN
                     , CASE WHEN P.USER_ID = :userId THEN 'MY' ELSE 'OTHER' END AS OWNER_SCOPE
                     , CASE WHEN P.USER_ID = :userId THEN 0 ELSE 1 END AS OWNER_SORT
                     , P.PROJECT_CODE
                     , P.PROJECT_NAME
                     , P.PROJECT_TYPE
                     , P.PROJECT_DESC
                     , P.SORT_ORDER
                     , P.CREATED_AT
                     , P.UPDATED_AT
                     , COUNT(*) OVER () AS TOTAL_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_SCENARIO S
                         WHERE S.PROJECT_ID = P.PROJECT_ID
                           AND S.USE_YN = 'Y'
                       ) AS SCENARIO_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_TABLES T
                         WHERE T.PROJECT_ID = P.PROJECT_ID
                           AND T.USE_YN = 'Y'
                       ) AS TARGET_TABLE_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_FLOW_WORK F
                         WHERE F.PROJECT_ID = P.PROJECT_ID
                           AND F.MENU_CODE = 'M04001'
                           AND F.USE_YN = 'Y'
                       ) AS FLOW_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_FLOW_WORK_RUN FR
                          JOIN INIT$_TB_FLOW_WORK F
                            ON F.FLOW_ID = FR.FLOW_ID
                         WHERE F.PROJECT_ID = P.PROJECT_ID
                           AND F.MENU_CODE = 'M04001'
                       ) AS FLOW_RUN_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_EDIT_RULE ER
                         WHERE ER.PROJECT_ID = P.PROJECT_ID
                           AND ER.DECISION_STATUS = 'SELECTED'
                           AND ER.RULE_STATUS = 'ACTIVE'
                       ) AS FINAL_RULE_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_EDIT_CHANGE EC
                          JOIN INIT$_TB_EDIT_SESSION ES
                            ON ES.EDIT_SESSION_ID = EC.EDIT_SESSION_ID
                         WHERE ES.PROJECT_ID = P.PROJECT_ID
                           AND EC.CHANGE_STATUS = 'APPLIED'
                       ) AS APPLIED_CHANGE_COUNT
                     , (
                        SELECT COUNT(*)
                          FROM INIT$_TB_EDIT_DML ED
                          JOIN INIT$_TB_EDIT_SESSION ES
                            ON ES.EDIT_SESSION_ID = ED.EDIT_SESSION_ID
                         WHERE ES.PROJECT_ID = P.PROJECT_ID
                           AND ED.DML_STATUS = 'EXECUTED'
                       ) AS EXECUTED_DML_COUNT
                     , (
                        SELECT MAX(NVL(FR.FINISHED_AT, FR.CREATED_AT))
                          FROM INIT$_TB_FLOW_WORK_RUN FR
                          JOIN INIT$_TB_FLOW_WORK F
                            ON F.FLOW_ID = FR.FLOW_ID
                         WHERE F.PROJECT_ID = P.PROJECT_ID
                           AND F.MENU_CODE = 'M04001'
                       ) AS LAST_FLOW_AT
                     , (
                        SELECT MAX(NVL(ES.UPDATED_AT, ES.CREATED_AT))
                          FROM INIT$_TB_EDIT_SESSION ES
                         WHERE ES.PROJECT_ID = P.PROJECT_ID
                       ) AS LAST_EDIT_AT
                  FROM INIT$_TB_PROJECT P
                 WHERE P.USE_YN = 'Y'
                   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
                   AND (
                          TRIM(:keyword) IS NULL
                       OR UPPER(P.PROJECT_NAME) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
                       OR UPPER(P.PROJECT_CODE) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
                       OR UPPER(NVL(P.PROJECT_TYPE, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
                       OR UPPER(NVL(P.PROJECT_DESC, '')) LIKE '%' || UPPER(TRIM(:keyword)) || '%'
                       )
               ) Q
       )
 WHERE RN__ > :offset
   AND RN__ <= :endRow
 ORDER BY RN__
;

-- [M06001_PROJECT_DETAIL]
SELECT P.PROJECT_ID
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
  FROM INIT$_TB_PROJECT P
 WHERE P.PROJECT_ID = :projectId
   AND P.USE_YN = 'Y'
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
;

-- [M06001_SCENARIO_LIST]
SELECT S.SCENARIO_ID
     , S.PROJECT_ID
     , S.SCENARIO_CODE
     , S.SCENARIO_NAME
     , S.SCENARIO_TYPE
     , S.SCENARIO_DESC
     , S.DATA_WORK_RUN_ID
     , S.DATA_WORK_RUN_AT
     , S.CREATED_AT
     , S.UPDATED_AT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_TABLES T
         WHERE T.SCENARIO_ID = S.SCENARIO_ID
           AND T.USE_YN = 'Y'
       ) AS TARGET_TABLE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK F
         WHERE F.SCENARIO_ID = S.SCENARIO_ID
           AND F.MENU_CODE = 'M04001'
           AND F.USE_YN = 'Y'
       ) AS FLOW_COUNT
     , (
        SELECT MAX(FR.FLOW_RUN_ID) KEEP (
                   DENSE_RANK LAST
                   ORDER BY NVL(FR.FINISHED_AT, FR.CREATED_AT)
                          , FR.FLOW_RUN_ID
               )
          FROM INIT$_TB_FLOW_WORK_RUN FR
          JOIN INIT$_TB_FLOW_WORK F
            ON F.FLOW_ID = FR.FLOW_ID
         WHERE F.SCENARIO_ID = S.SCENARIO_ID
           AND F.MENU_CODE = 'M04001'
           AND FR.STATUS IN ('SUCCESS', 'COMPLETED')
       ) AS LATEST_FLOW_RUN_ID
     , (
        SELECT MAX(ES.EDIT_SESSION_ID) KEEP (
                   DENSE_RANK LAST
                   ORDER BY NVL(ES.UPDATED_AT, ES.CREATED_AT)
                          , ES.EDIT_SESSION_ID
               )
          FROM INIT$_TB_EDIT_SESSION ES
         WHERE ES.SCENARIO_ID = S.SCENARIO_ID
       ) AS LATEST_EDIT_SESSION_ID
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_RULE ER
         WHERE ER.SCENARIO_ID = S.SCENARIO_ID
           AND ER.DECISION_STATUS = 'SELECTED'
           AND ER.RULE_STATUS = 'ACTIVE'
       ) AS FINAL_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_CHANGE EC
          JOIN INIT$_TB_EDIT_SESSION ES
            ON ES.EDIT_SESSION_ID = EC.EDIT_SESSION_ID
         WHERE ES.SCENARIO_ID = S.SCENARIO_ID
           AND EC.CHANGE_STATUS = 'APPLIED'
       ) AS APPLIED_CHANGE_COUNT
  FROM INIT$_TB_SCENARIO S
  JOIN INIT$_TB_PROJECT P
    ON P.PROJECT_ID = S.PROJECT_ID
 WHERE S.PROJECT_ID = :projectId
   AND S.USE_YN = 'Y'
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
 ORDER BY S.SORT_ORDER NULLS LAST
        , S.SCENARIO_NAME
        , S.SCENARIO_ID
;

-- [M06001_FLOW_RUN_LIST]
SELECT *
  FROM (
        SELECT FR.FLOW_RUN_ID
             , FR.FLOW_ID
             , F.FLOW_NAME
             , F.FLOW_GROUP
             , F.FLOW_TYPE
             , F.VERSION_NO
             , F.EXECUTION_MODE
             , F.PROJECT_ID
             , F.SCENARIO_ID
             , FR.RUN_TYPE
             , FR.STATUS
             , FR.STARTED_AT
             , FR.FINISHED_AT
             , FR.CREATED_AT
             , (
                SELECT COUNT(*)
                  FROM INIT$_TB_FLOW_WORK_NODE_RUN NR
                 WHERE NR.FLOW_RUN_ID = FR.FLOW_RUN_ID
               ) AS NODE_COUNT
             , (
                SELECT COUNT(*)
                  FROM INIT$_TB_FLOW_WORK_NODE_RUN NR
                 WHERE NR.FLOW_RUN_ID = FR.FLOW_RUN_ID
                   AND NR.STATUS = 'SUCCESS'
               ) AS SUCCESS_NODE_COUNT
          FROM INIT$_TB_FLOW_WORK_RUN FR
          JOIN INIT$_TB_FLOW_WORK F
            ON F.FLOW_ID = FR.FLOW_ID
          JOIN INIT$_TB_PROJECT P
            ON P.PROJECT_ID = F.PROJECT_ID
         WHERE F.MENU_CODE = 'M04001'
           AND F.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
           AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
         ORDER BY NVL(FR.FINISHED_AT, FR.CREATED_AT) DESC
                , FR.FLOW_RUN_ID DESC
       )
 WHERE ROWNUM <= 50
;

-- [M06001_FLOW_RUN_DETAIL]
SELECT FR.FLOW_RUN_ID
     , FR.FLOW_ID
     , F.FLOW_NAME
     , F.FLOW_GROUP
     , F.FLOW_DESC
     , F.FLOW_TYPE
     , F.VERSION_NO
     , F.EXECUTION_MODE
     , F.STATUS AS FLOW_STATUS
     , F.PROJECT_ID
     , F.SCENARIO_ID
     , FR.RUN_TYPE
     , FR.STATUS
     , FR.PLAN_JSON
     , FR.STARTED_AT
     , FR.FINISHED_AT
     , FR.CREATED_AT
  FROM INIT$_TB_FLOW_WORK_RUN FR
  JOIN INIT$_TB_FLOW_WORK F
    ON F.FLOW_ID = FR.FLOW_ID
  JOIN INIT$_TB_PROJECT P
    ON P.PROJECT_ID = F.PROJECT_ID
 WHERE FR.FLOW_RUN_ID = :flowRunId
   AND F.MENU_CODE = 'M04001'
   AND F.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
;

-- [M06001_EDIT_SESSION_LIST]
SELECT *
  FROM (
        SELECT ES.EDIT_SESSION_ID
             , ES.PROJECT_ID
             , ES.SCENARIO_ID
             , ES.SESSION_NAME
             , ES.TARGET_OWNER
             , ES.SOURCE_TABLE
             , ES.EDIT_TABLE
             , ES.SOURCE_RUN_SOURCE_TYPE
             , ES.SOURCE_RUN_ID
             , ES.BASELINE_FLOW_RUN_ID
             , ES.REANALYSIS_FLOW_RUN_ID
             , ES.REANALYSIS_STATUS
             , ES.SESSION_STATUS
             , ES.SOURCE_ROW_COUNT
             , ES.CREATED_BY
             , ES.CREATED_AT
             , ES.PREPARED_AT
             , ES.VALIDATED_AT
             , ES.APPLIED_AT
             , ES.UPDATED_AT
             , (
                SELECT COUNT(*)
                  FROM INIT$_TB_EDIT_CHANGE EC
                 WHERE EC.EDIT_SESSION_ID = ES.EDIT_SESSION_ID
               ) AS CHANGE_COUNT
             , (
                SELECT COUNT(*)
                  FROM INIT$_TB_EDIT_DML ED
                 WHERE ED.EDIT_SESSION_ID = ES.EDIT_SESSION_ID
                   AND ED.DML_STATUS = 'EXECUTED'
               ) AS EXECUTED_DML_COUNT
          FROM INIT$_TB_EDIT_SESSION ES
          JOIN INIT$_TB_PROJECT P
            ON P.PROJECT_ID = ES.PROJECT_ID
         WHERE ES.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR ES.SCENARIO_ID = :scenarioId)
           AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
         ORDER BY NVL(ES.UPDATED_AT, ES.CREATED_AT) DESC
                , ES.EDIT_SESSION_ID DESC
       )
 WHERE ROWNUM <= 50
;

-- [M06001_EDIT_SESSION_DETAIL]
SELECT ES.EDIT_SESSION_ID
     , ES.PROJECT_ID
     , ES.SCENARIO_ID
     , ES.SESSION_NAME
     , ES.TARGET_OWNER
     , ES.SOURCE_TABLE
     , ES.EDIT_TABLE
     , ES.SOURCE_RUN_SOURCE_TYPE
     , ES.SOURCE_RUN_ID
     , ES.BASELINE_FLOW_RUN_ID
     , ES.REANALYSIS_FLOW_RUN_ID
     , ES.REANALYSIS_STATUS
     , ES.SESSION_STATUS
     , ES.SOURCE_ROW_COUNT
     , ES.CREATED_BY
     , ES.CREATED_AT
     , ES.PREPARED_AT
     , ES.VALIDATED_AT
     , ES.APPLIED_AT
     , ES.UPDATED_AT
  FROM INIT$_TB_EDIT_SESSION ES
  JOIN INIT$_TB_PROJECT P
    ON P.PROJECT_ID = ES.PROJECT_ID
 WHERE ES.EDIT_SESSION_ID = :editSessionId
   AND ES.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR ES.SCENARIO_ID = :scenarioId)
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
;

-- [M06001_TARGET_TABLE_LIST]
SELECT T.SCENARIO_TABLE_ID
     , T.PROJECT_ID
     , T.SCENARIO_ID
     , T.OWNER_NAME
     , T.TABLE_NAME
     , T.ORIGINAL_OWNER_NAME
     , T.ORIGINAL_TABLE_NAME
     , T.EDIT_OWNER_NAME
     , T.EDIT_TABLE_NAME
     , T.DATA_ORIGIN_TYPE
     , T.CASE_ID_COLUMN
     , T.TABLE_COMMENT
     , T.IMPORTED_AT
     , T.CREATED_AT
     , T.UPDATED_AT
  FROM INIT$_TB_TABLES T
 WHERE T.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
   AND T.USE_YN = 'Y'
 ORDER BY T.SCENARIO_ID
        , T.SORT_ORDER NULLS LAST
        , T.OWNER_NAME
        , T.TABLE_NAME
;

-- [M06001_AVAILABILITY_COUNTS]
SELECT (
        SELECT COUNT(*)
          FROM INIT$_TB_SCENARIO S
         WHERE S.PROJECT_ID = :projectId
           AND S.USE_YN = 'Y'
       ) AS SCENARIO_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_TABLES T
         WHERE T.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR T.SCENARIO_ID = :scenarioId)
           AND T.USE_YN = 'Y'
       ) AS TARGET_TABLE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK F
         WHERE F.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
           AND F.MENU_CODE = 'M04001'
           AND F.USE_YN = 'Y'
       ) AS FLOW_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK_RUN FR
          JOIN INIT$_TB_FLOW_WORK F
            ON F.FLOW_ID = FR.FLOW_ID
         WHERE F.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
           AND F.MENU_CODE = 'M04001'
       ) AS FLOW_RUN_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK_RUN FR
          JOIN INIT$_TB_FLOW_WORK F
            ON F.FLOW_ID = FR.FLOW_ID
         WHERE F.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
           AND F.MENU_CODE = 'M04001'
           AND FR.STATUS IN ('SUCCESS', 'COMPLETED')
       ) AS SUCCESS_FLOW_RUN_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK_NODE_RUN NR
         WHERE NR.FLOW_RUN_ID = :flowRunId
       ) AS FLOW_NODE_RUN_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_COLTYPE_RESULT R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
       ) AS COLUMN_TYPE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_COLREL_SUMMARY R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
       ) AS RELATION_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_COLREL_NETWORK_NODE N
         WHERE N.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND N.RUN_ID = :flowRunId
       ) AS NETWORK_NODE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_RULEDISC_ASSOC_SUM R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
       ) AS ASSOCIATION_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_COLREL_LASSO_FEATURE L
         WHERE L.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND L.RUN_ID = :flowRunId
       ) AS LASSO_FEATURE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_RULEDISC_SYMBOLIC R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
       ) AS SYMBOLIC_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_RULEVIOL_ASSOC A
         WHERE A.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND A.RUN_ID = :flowRunId
       ) + (
        SELECT COUNT(*)
          FROM INIT$_TB_RULEVIOL_SYMBOLIC S
         WHERE S.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND S.RUN_ID = :flowRunId
       ) AS VIOLATION_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_RULE R
         WHERE R.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
       ) AS EDIT_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_RULE R
         WHERE R.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
           AND R.DECISION_STATUS = 'SELECTED'
           AND R.RULE_STATUS = 'ACTIVE'
       ) AS FINAL_RULE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_SESSION S
         WHERE S.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
       ) AS EDIT_SESSION_COUNT
      , (
         SELECT COUNT(*)
           FROM INIT$_TB_EDIT_CHANGE C
           JOIN INIT$_TB_EDIT_SESSION S
             ON S.EDIT_SESSION_ID = C.EDIT_SESSION_ID
          WHERE S.PROJECT_ID = :projectId
            AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
            AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
        ) AS EDIT_CHANGE_COUNT
      , (
         SELECT COUNT(*)
           FROM INIT$_TB_EDIT_CHANGE C
           JOIN INIT$_TB_EDIT_SESSION S
             ON S.EDIT_SESSION_ID = C.EDIT_SESSION_ID
          WHERE S.PROJECT_ID = :projectId
            AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
        ) AS SCENARIO_EDIT_CHANGE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_SESSION S
         WHERE S.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
           AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
           AND S.VALIDATED_AT IS NOT NULL
       ) AS VALIDATED_SESSION_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_EVENT E
          JOIN INIT$_TB_EDIT_SESSION S
            ON S.EDIT_SESSION_ID = E.EDIT_SESSION_ID
         WHERE S.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
           AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
           AND E.EVENT_TYPE = 'EFFECT_VALIDATED'
           AND E.EVENT_DETAIL_JSON IS NOT NULL
       ) AS VALIDATION_SNAPSHOT_COUNT
      , (
         SELECT COUNT(*)
           FROM INIT$_TB_EDIT_DML D
           JOIN INIT$_TB_EDIT_SESSION S
             ON S.EDIT_SESSION_ID = D.EDIT_SESSION_ID
          WHERE S.PROJECT_ID = :projectId
            AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
            AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
        ) AS DML_COUNT
      , (
         SELECT COUNT(*)
           FROM INIT$_TB_EDIT_DML D
           JOIN INIT$_TB_EDIT_SESSION S
             ON S.EDIT_SESSION_ID = D.EDIT_SESSION_ID
          WHERE S.PROJECT_ID = :projectId
            AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
        ) AS SCENARIO_DML_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_EDIT_EVENT E
          LEFT JOIN INIT$_TB_EDIT_SESSION S
            ON S.EDIT_SESSION_ID = E.EDIT_SESSION_ID
          LEFT JOIN INIT$_TB_EDIT_RULE R
            ON E.ENTITY_TYPE = 'EDIT_RULE'
           AND R.EDIT_RULE_ID = E.ENTITY_ID
          WHERE NVL(S.PROJECT_ID, R.PROJECT_ID) = :projectId
            AND (:scenarioId IS NULL OR NVL(S.SCENARIO_ID, R.SCENARIO_ID) = :scenarioId)
        ) AS AUDIT_EVENT_COUNT
  FROM DUAL
;

-- [M06001_FLOW_LIST]
SELECT F.FLOW_ID
     , F.PROJECT_ID
     , F.SCENARIO_ID
     , F.FLOW_GROUP
     , F.FLOW_NAME
     , F.FLOW_DESC
     , F.FLOW_TYPE
     , F.EXECUTION_MODE
     , F.VERSION_NO
     , F.STATUS
     , F.USE_YN
     , F.CREATED_AT
     , F.UPDATED_AT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK_NODE N
         WHERE N.FLOW_ID = F.FLOW_ID
       ) AS NODE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK_EDGE E
         WHERE E.FLOW_ID = F.FLOW_ID
       ) AS EDGE_COUNT
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_FLOW_WORK_RUN R
         WHERE R.FLOW_ID = F.FLOW_ID
       ) AS RUN_COUNT
  FROM INIT$_TB_FLOW_WORK F
 WHERE F.MENU_CODE = 'M04001'
   AND F.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
   AND F.USE_YN = 'Y'
 ORDER BY F.SCENARIO_ID
        , F.FLOW_GROUP
        , F.FLOW_NAME
        , F.FLOW_ID
;

-- [M06001_FLOW_NODE_LIST]
SELECT F.FLOW_ID
     , F.FLOW_NAME
     , N.FLOW_NODE_ID
     , N.NODE_KEY
     , N.NODE_TYPE
     , N.NODE_NAME
     , N.NODE_DESC
     , N.USE_YN
     , N.REF_MENU_CODE
     , N.REF_WORK_JOB_ID
     , N.REF_OBJECT_ID
     , N.OWNER_NAME
     , N.TABLE_NAME
     , N.PARAM_JSON
     , N.SORT_ORDER
  FROM INIT$_TB_FLOW_WORK_NODE N
  JOIN INIT$_TB_FLOW_WORK F
    ON F.FLOW_ID = N.FLOW_ID
 WHERE F.MENU_CODE = 'M04001'
   AND F.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
   AND F.USE_YN = 'Y'
 ORDER BY F.FLOW_NAME
        , F.FLOW_ID
        , N.SORT_ORDER NULLS LAST
        , N.FLOW_NODE_ID
;

-- [M06001_FLOW_EDGE_LIST]
SELECT F.FLOW_ID
     , F.FLOW_NAME
     , E.FLOW_EDGE_ID
     , E.FROM_NODE_KEY
     , E.FROM_PORT
     , E.TO_NODE_KEY
     , E.TO_PORT
     , E.EDGE_MODE
     , E.DASHED_YN
     , E.SORT_ORDER
  FROM INIT$_TB_FLOW_WORK_EDGE E
  JOIN INIT$_TB_FLOW_WORK F
    ON F.FLOW_ID = E.FLOW_ID
 WHERE F.MENU_CODE = 'M04001'
   AND F.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
   AND F.USE_YN = 'Y'
 ORDER BY F.FLOW_NAME
        , F.FLOW_ID
        , E.SORT_ORDER NULLS LAST
        , E.FLOW_EDGE_ID
;

-- [M06001_FLOW_NODE_RUN_LIST]
SELECT NR.FLOW_NODE_RUN_ID
     , NR.FLOW_RUN_ID
     , NR.NODE_KEY
     , NR.NODE_NAME
     , NR.NODE_TYPE
     , NR.RUN_LEVEL
     , NR.SORT_ORDER
     , NR.STATUS
     , NR.RUNTIME_PARAM_JSON
     , NR.RUN_OUTPUT_JSON
     , NR.STARTED_AT
     , NR.FINISHED_AT
     , NR.CREATED_AT
  FROM INIT$_TB_FLOW_WORK_NODE_RUN NR
 WHERE NR.FLOW_RUN_ID = :flowRunId
 ORDER BY NR.RUN_LEVEL
        , NR.SORT_ORDER NULLS LAST
        , NR.FLOW_NODE_RUN_ID
;

-- [M06001_COLUMN_TYPE_SUMMARY]
SELECT NVL(R.TYPE_GROUP_CODE, 'OTHER') AS TYPE_GROUP_CODE
     , NVL(R.FINAL_TYPE_CODE, NVL(R.BASE_TYPE_CODE, 'UNKNOWN')) AS FINAL_TYPE_CODE
     , COUNT(*) AS COLUMN_COUNT
     , ROUND(AVG(NVL(R.NULL_RATIO, 0)), 6) AS AVG_NULL_RATIO
     , ROUND(AVG(NVL(R.MODEL_CONFIDENCE, 0)), 6) AS AVG_MODEL_CONFIDENCE
  FROM INIT$_TB_COLTYPE_RESULT R
 WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
   AND R.RUN_ID = :flowRunId
 GROUP BY NVL(R.TYPE_GROUP_CODE, 'OTHER')
        , NVL(R.FINAL_TYPE_CODE, NVL(R.BASE_TYPE_CODE, 'UNKNOWN'))
 ORDER BY TYPE_GROUP_CODE
        , COLUMN_COUNT DESC
        , FINAL_TYPE_CODE
;

-- [M06001_COLUMN_TYPE_DETAIL]
SELECT *
  FROM (
        SELECT R.OWNER
             , R.TABLE_NAME
             , R.COLUMN_ID
             , R.COLUMN_NAME
             , R.COLUMN_DESC
             , R.DATA_TYPE
             , R.TOTAL_ROWS
             , R.NUM_DISTINCT
             , R.NULL_RATIO
             , R.BASE_TYPE_CODE
             , R.MODL_TYPE_CODE
             , R.MODEL_CONFIDENCE
             , R.FINAL_TYPE_CODE
             , R.TYPE_GROUP_CODE
             , R.FINAL_REASON
          FROM INIT$_TB_COLTYPE_RESULT R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
         ORDER BY R.OWNER
                , R.TABLE_NAME
                , R.COLUMN_ID
                , R.COLUMN_NAME
       )
 WHERE ROWNUM <= 300
;

-- [M06001_RELATION_SUMMARY]
SELECT *
  FROM (
        SELECT R.OWNER
             , R.TABLE_NAME
             , R.COLUMN_NAME
             , R.COLUMN_TYPE
             , R.PAIR_COUNT
             , R.PASS_PAIR_COUNT
             , R.AVG_ABS_METRIC_VALUE
             , R.MAX_ABS_METRIC_VALUE
             , R.RANK_NO
             , R.SELECTED_YN
          FROM INIT$_TB_COLREL_SUMMARY R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
         ORDER BY R.SELECTED_YN DESC
                , R.RANK_NO NULLS LAST
                , R.MAX_ABS_METRIC_VALUE DESC NULLS LAST
       )
 WHERE ROWNUM <= 300
;

-- [M06001_RELATION_AGGREGATE]
SELECT COUNT(*) AS RELATION_COLUMN_COUNT
     , SUM(CASE WHEN R.SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_COLUMN_COUNT
     , SUM(NVL(R.PAIR_COUNT, 0)) AS PAIR_COUNT
     , SUM(NVL(R.PASS_PAIR_COUNT, 0)) AS PASS_PAIR_COUNT
  FROM INIT$_TB_COLREL_SUMMARY R
 WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
   AND R.RUN_ID = :flowRunId
;

-- [M06001_NETWORK_CLUSTER_SUMMARY]
SELECT N.OWNER
     , N.TABLE_NAME
     , NVL(N.CLUSTER_ID, -1) AS CLUSTER_ID
     , COUNT(*) AS NODE_COUNT
     , SUM(NVL(N.DEGREE_COUNT, 0)) AS TOTAL_DEGREE_COUNT
     , ROUND(AVG(NVL(N.CENTRALITY_SCORE, 0)), 6) AS AVG_CENTRALITY_SCORE
     , MAX(N.CENTRALITY_SCORE) AS MAX_CENTRALITY_SCORE
  FROM INIT$_TB_COLREL_NETWORK_NODE N
 WHERE N.RUN_SOURCE_TYPE = 'FLOW_WORK'
   AND N.RUN_ID = :flowRunId
 GROUP BY N.OWNER
        , N.TABLE_NAME
        , NVL(N.CLUSTER_ID, -1)
 ORDER BY N.OWNER
        , N.TABLE_NAME
        , NODE_COUNT DESC
        , CLUSTER_ID
;

-- [M06001_NETWORK_NODE_DETAIL]
SELECT *
  FROM (
        SELECT N.OWNER
             , N.TABLE_NAME
             , N.COLUMN_NAME
             , N.COLUMN_TYPE
             , N.CLUSTER_ID
             , N.DEGREE_COUNT
             , N.WEIGHTED_DEGREE
             , N.CENTRALITY_SCORE
             , N.SELECTED_YN
          FROM INIT$_TB_COLREL_NETWORK_NODE N
         WHERE N.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND N.RUN_ID = :flowRunId
         ORDER BY N.CENTRALITY_SCORE DESC NULLS LAST
                , N.DEGREE_COUNT DESC NULLS LAST
                , N.COLUMN_NAME
       )
 WHERE ROWNUM <= 300
;

-- [M06001_ASSOC_RULE_SUMMARY]
SELECT *
  FROM (
        SELECT R.TARGET_OWNER
             , R.TARGET_TABLE
             , R.MODEL_NAME
             , R.MODEL_TYPE
             , R.RULE_SOURCE
             , R.RULE_ID
             , R.CONDITION_COUNT
             , R.CONDITION_COLUMN
             , R.CONDITION_VALUE
             , R.RESULT_COLUMN
             , R.RESULT_VALUE
             , R.RULE_SUPPORT AS RULE_SUPPORT_SOURCE
             , CASE
                   WHEN R.RULE_SUPPORT BETWEEN 0 AND 1 THEN R.RULE_SUPPORT
                   WHEN R.RULE_SUPPORT > 1 AND R.RULE_SUPPORT <= 100 THEN R.RULE_SUPPORT / 100
                   ELSE NULL
               END AS RULE_SUPPORT
             , R.RULE_CONFIDENCE AS RULE_CONFIDENCE_SOURCE
             , CASE
                   WHEN R.RULE_CONFIDENCE BETWEEN 0 AND 1 THEN R.RULE_CONFIDENCE
                   WHEN R.RULE_CONFIDENCE > 1 AND R.RULE_CONFIDENCE <= 100 THEN R.RULE_CONFIDENCE / 100
                   ELSE NULL
               END AS RULE_CONFIDENCE
             , R.RULE_LIFT
             , R.SUPPORT_COUNT
             , R.TOTAL_COUNT
             , DBMS_LOB.SUBSTR(R.CONDITION_TEXT, 2000, 1) AS CONDITION_TEXT
             , DBMS_LOB.SUBSTR(R.RESULT_TEXT, 2000, 1) AS RESULT_TEXT
          FROM INIT$_TB_RULEDISC_ASSOC_SUM R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
         ORDER BY R.RULE_CONFIDENCE DESC NULLS LAST
                , R.RULE_LIFT DESC NULLS LAST
                , R.RULE_SUPPORT DESC NULLS LAST
                , R.RULE_ID
       )
 WHERE ROWNUM <= 300
;

-- [M06001_ASSOC_RULE_AGGREGATE]
SELECT COUNT(*) AS ASSOCIATION_RULE_COUNT
     , ROUND(
           AVG(
               CASE
                   WHEN R.RULE_SUPPORT BETWEEN 0 AND 1 THEN R.RULE_SUPPORT
                   WHEN R.RULE_SUPPORT > 1 AND R.RULE_SUPPORT <= 100 THEN R.RULE_SUPPORT / 100
                   ELSE NULL
               END
           )
       , 6) AS AVG_RULE_SUPPORT
     , ROUND(
           AVG(
               CASE
                   WHEN R.RULE_CONFIDENCE BETWEEN 0 AND 1 THEN R.RULE_CONFIDENCE
                   WHEN R.RULE_CONFIDENCE > 1 AND R.RULE_CONFIDENCE <= 100 THEN R.RULE_CONFIDENCE / 100
                   ELSE NULL
               END
           )
       , 6) AS AVG_RULE_CONFIDENCE
     , ROUND(AVG(R.RULE_LIFT), 6) AS AVG_RULE_LIFT
  FROM INIT$_TB_RULEDISC_ASSOC_SUM R
 WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
   AND R.RUN_ID = :flowRunId
;

-- [M06001_LASSO_FEATURE_SUMMARY]
SELECT *
  FROM (
        SELECT L.OWNER
             , L.TABLE_NAME
             , L.TARGET_COLUMN
             , L.FEATURE_NAME
             , L.COEFFICIENT
             , L.ABS_COEFFICIENT
             , L.RANK_NO
             , L.SELECTED_YN
             , L.MODEL_ALPHA
             , L.R2_SCORE
          FROM INIT$_TB_COLREL_LASSO_FEATURE L
         WHERE L.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND L.RUN_ID = :flowRunId
         ORDER BY L.TARGET_COLUMN
                , L.SELECTED_YN DESC
                , L.RANK_NO NULLS LAST
                , L.ABS_COEFFICIENT DESC NULLS LAST
       )
 WHERE ROWNUM <= 300
;

-- [M06001_LASSO_FEATURE_AGGREGATE]
SELECT COUNT(*) AS LASSO_FEATURE_COUNT
     , SUM(CASE WHEN L.SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_FEATURE_COUNT
     , COUNT(DISTINCT L.TARGET_COLUMN) AS TARGET_COUNT
  FROM INIT$_TB_COLREL_LASSO_FEATURE L
 WHERE L.RUN_SOURCE_TYPE = 'FLOW_WORK'
   AND L.RUN_ID = :flowRunId
;

-- [M06001_SYMBOLIC_RULE_SUMMARY]
SELECT *
  FROM (
        SELECT R.OWNER
             , R.TABLE_NAME
             , R.TARGET_COLUMN
             , R.RULE_ID
             , DBMS_LOB.SUBSTR(R.EXPRESSION, 3000, 1) AS EXPRESSION
             , R.SCORE
             , R.COMPLEXITY
             , R.RANK_NO
             , R.SELECTED_YN
             , R.FEATURE_COLUMNS
             , R.METHOD
          FROM INIT$_TB_RULEDISC_SYMBOLIC R
         WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND R.RUN_ID = :flowRunId
         ORDER BY R.TARGET_COLUMN
                , R.SELECTED_YN DESC
                , R.RANK_NO NULLS LAST
                , R.SCORE DESC NULLS LAST
       )
 WHERE ROWNUM <= 300
;

-- [M06001_SYMBOLIC_RULE_AGGREGATE]
SELECT COUNT(*) AS SYMBOLIC_RULE_COUNT
     , SUM(CASE WHEN R.SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_RULE_COUNT
     , COUNT(DISTINCT R.TARGET_COLUMN) AS TARGET_COUNT
  FROM INIT$_TB_RULEDISC_SYMBOLIC R
 WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
   AND R.RUN_ID = :flowRunId
;

-- [M06001_VIOLATION_SUMMARY]
SELECT V.VIOLATION_TYPE
     , V.TARGET_OWNER
     , V.TARGET_TABLE
     , V.TARGET_COLUMN
     , COUNT(*) AS VIOLATION_COUNT
     , ROUND(AVG(NVL(V.VIOLATION_SCORE, 0)), 6) AS AVG_VIOLATION_SCORE
     , MAX(V.VIOLATION_SCORE) AS MAX_VIOLATION_SCORE
  FROM (
        SELECT 'ASSOCIATION' AS VIOLATION_TYPE
             , A.TARGET_OWNER
             , A.TARGET_TABLE
             , A.RESULT_COLUMN AS TARGET_COLUMN
             , A.VIOLATION_SCORE
          FROM INIT$_TB_RULEVIOL_ASSOC A
         WHERE A.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND A.RUN_ID = :flowRunId
        UNION ALL
        SELECT 'SYMBOLIC' AS VIOLATION_TYPE
             , S.TARGET_OWNER
             , S.TARGET_TABLE
             , S.TARGET_COLUMN
             , S.VIOLATION_SCORE
          FROM INIT$_TB_RULEVIOL_SYMBOLIC S
         WHERE S.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND S.RUN_ID = :flowRunId
       ) V
 GROUP BY V.VIOLATION_TYPE
        , V.TARGET_OWNER
        , V.TARGET_TABLE
        , V.TARGET_COLUMN
 ORDER BY VIOLATION_COUNT DESC
        , V.VIOLATION_TYPE
        , V.TARGET_OWNER
        , V.TARGET_TABLE
        , V.TARGET_COLUMN
;

-- [M06001_RULE_DECISION_SUMMARY]
SELECT R.SOURCE_RULE_TYPE
     , R.DECISION_STATUS
     , R.RULE_STATUS
     , R.USER_RULE_YN
     , COUNT(*) AS RULE_COUNT
     , ROUND(AVG(NVL(R.RULE_SUPPORT, 0)), 6) AS AVG_RULE_SUPPORT
     , ROUND(AVG(NVL(R.RULE_CONFIDENCE, 0)), 6) AS AVG_RULE_CONFIDENCE
     , ROUND(AVG(NVL(R.RULE_LIFT, 0)), 6) AS AVG_RULE_LIFT
  FROM INIT$_TB_EDIT_RULE R
 WHERE R.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
 GROUP BY R.SOURCE_RULE_TYPE
        , R.DECISION_STATUS
        , R.RULE_STATUS
        , R.USER_RULE_YN
 ORDER BY R.SOURCE_RULE_TYPE
        , R.DECISION_STATUS
        , R.RULE_STATUS
;

-- [M06001_DISCOVERED_RULE_DECISION_SUMMARY]
WITH SOURCE_RULES AS
(
    SELECT 'ASSOCIATION' AS SOURCE_RULE_TYPE
         , R.RUN_SOURCE_TYPE
         , R.RUN_ID
         , R.OWNER AS SOURCE_OWNER
         , R.MODEL_NAME AS SOURCE_OBJECT_NAME
         , R.RULE_ID AS SOURCE_RULE_ID
         , R.TARGET_OWNER
         , R.TARGET_TABLE
         , R.RESULT_COLUMN AS TARGET_COLUMN
         , R.RULE_SUPPORT
         , R.RULE_CONFIDENCE
         , R.RULE_LIFT
      FROM INIT$_TB_RULEDISC_ASSOC_SUM R
     WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
       AND R.RUN_ID = :flowRunId
    UNION ALL
    SELECT 'SYMBOLIC' AS SOURCE_RULE_TYPE
         , R.RUN_SOURCE_TYPE
         , R.RUN_ID
         , R.OWNER AS SOURCE_OWNER
         , R.TABLE_NAME AS SOURCE_OBJECT_NAME
         , R.RULE_ID AS SOURCE_RULE_ID
         , R.OWNER AS TARGET_OWNER
         , R.TABLE_NAME AS TARGET_TABLE
         , R.TARGET_COLUMN
         , CAST(NULL AS NUMBER) AS RULE_SUPPORT
         , R.SCORE AS RULE_CONFIDENCE
         , CAST(NULL AS NUMBER) AS RULE_LIFT
      FROM INIT$_TB_RULEDISC_SYMBOLIC R
     WHERE R.RUN_SOURCE_TYPE = 'FLOW_WORK'
       AND R.RUN_ID = :flowRunId
)
, EDIT_DECISIONS AS
(
    SELECT D.SOURCE_RULE_TYPE
         , D.SOURCE_RUN_SOURCE_TYPE
         , D.SOURCE_RUN_ID
         , D.SOURCE_OWNER
         , D.SOURCE_OBJECT_NAME
         , D.SOURCE_RULE_ID
         , D.TARGET_OWNER
         , D.TARGET_TABLE
         , D.TARGET_COLUMN
         , D.DECISION_STATUS
         , D.RULE_STATUS
      FROM (
            SELECT E.SOURCE_RULE_TYPE
                 , E.SOURCE_RUN_SOURCE_TYPE
                 , E.SOURCE_RUN_ID
                 , E.SOURCE_OWNER
                 , E.SOURCE_OBJECT_NAME
                 , E.SOURCE_RULE_ID
                 , E.TARGET_OWNER
                 , E.TARGET_TABLE
                 , E.TARGET_COLUMN
                 , E.DECISION_STATUS
                 , E.RULE_STATUS
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
              FROM INIT$_TB_EDIT_RULE E
             WHERE E.PROJECT_ID = :projectId
               AND (:scenarioId IS NULL OR E.SCENARIO_ID = :scenarioId)
               AND E.SOURCE_RUN_SOURCE_TYPE = 'FLOW_WORK'
               AND E.SOURCE_RUN_ID = :flowRunId
               AND E.SOURCE_RULE_TYPE IN ('ASSOCIATION', 'SYMBOLIC')
               AND E.USER_RULE_YN = 'N'
           ) D
     WHERE D.RN__ = 1
)
SELECT U.SOURCE_RULE_TYPE
     , NVL(E.DECISION_STATUS, 'PENDING') AS DECISION_STATUS
     , NVL(E.RULE_STATUS, 'ACTIVE') AS RULE_STATUS
     , COUNT(*) AS RULE_COUNT
     , ROUND(
           AVG(
               CASE
                   WHEN U.SOURCE_RULE_TYPE <> 'ASSOCIATION' THEN NULL
                   WHEN U.RULE_SUPPORT BETWEEN 0 AND 1 THEN U.RULE_SUPPORT
                   WHEN U.RULE_SUPPORT > 1 AND U.RULE_SUPPORT <= 100 THEN U.RULE_SUPPORT / 100
                   ELSE NULL
               END
           )
       , 6) AS AVG_ASSOC_SUPPORT_RATE
     , ROUND(
           AVG(
               CASE
                   WHEN U.SOURCE_RULE_TYPE <> 'ASSOCIATION' THEN NULL
                   WHEN U.RULE_CONFIDENCE BETWEEN 0 AND 1 THEN U.RULE_CONFIDENCE
                   WHEN U.RULE_CONFIDENCE > 1 AND U.RULE_CONFIDENCE <= 100 THEN U.RULE_CONFIDENCE / 100
                   ELSE NULL
               END
           )
       , 6) AS AVG_ASSOC_CONFIDENCE_RATE
     , ROUND(
           AVG(CASE WHEN U.SOURCE_RULE_TYPE = 'SYMBOLIC' THEN U.RULE_CONFIDENCE END)
       , 6) AS AVG_SYMBOLIC_SCORE
     , ROUND(AVG(U.RULE_LIFT), 6) AS AVG_RULE_LIFT
  FROM SOURCE_RULES U
  LEFT JOIN EDIT_DECISIONS E
    ON E.SOURCE_RULE_TYPE = U.SOURCE_RULE_TYPE
   AND E.SOURCE_RUN_SOURCE_TYPE = U.RUN_SOURCE_TYPE
   AND E.SOURCE_RUN_ID = U.RUN_ID
   AND E.SOURCE_OWNER = U.SOURCE_OWNER
   AND E.SOURCE_OBJECT_NAME = U.SOURCE_OBJECT_NAME
   AND E.SOURCE_RULE_ID = U.SOURCE_RULE_ID
   AND E.TARGET_OWNER = U.TARGET_OWNER
   AND E.TARGET_TABLE = U.TARGET_TABLE
   AND E.TARGET_COLUMN = U.TARGET_COLUMN
 GROUP BY U.SOURCE_RULE_TYPE
        , NVL(E.DECISION_STATUS, 'PENDING')
        , NVL(E.RULE_STATUS, 'ACTIVE')
 ORDER BY U.SOURCE_RULE_TYPE
        , DECISION_STATUS
        , RULE_STATUS
;

-- [M06001_RULE_MASTER_DETAIL]
SELECT *
  FROM (
        SELECT R.EDIT_RULE_ID
             , R.SCENARIO_ID
             , R.SOURCE_RULE_TYPE
             , R.SOURCE_RUN_SOURCE_TYPE
             , R.SOURCE_RUN_ID
             , R.SOURCE_RULE_ID
             , R.TARGET_OWNER
             , R.TARGET_TABLE
             , R.TARGET_COLUMN
             , R.RULE_NAME
             , R.RULE_DESCRIPTION
             , DBMS_LOB.SUBSTR(R.RULE_EXPRESSION, 3000, 1) AS RULE_EXPRESSION
             , DBMS_LOB.SUBSTR(R.EXPECTED_VALUE, 1000, 1) AS EXPECTED_VALUE
             , CASE
                   WHEN R.SOURCE_RULE_TYPE <> 'ASSOCIATION' THEN NULL
                   WHEN R.RULE_SUPPORT BETWEEN 0 AND 1 THEN R.RULE_SUPPORT
                   WHEN R.RULE_SUPPORT > 1 AND R.RULE_SUPPORT <= 100 THEN R.RULE_SUPPORT / 100
                   ELSE NULL
               END AS ASSOCIATION_SUPPORT_RATE
             , CASE
                   WHEN R.SOURCE_RULE_TYPE <> 'ASSOCIATION' THEN NULL
                   WHEN R.RULE_CONFIDENCE BETWEEN 0 AND 1 THEN R.RULE_CONFIDENCE
                   WHEN R.RULE_CONFIDENCE > 1 AND R.RULE_CONFIDENCE <= 100 THEN R.RULE_CONFIDENCE / 100
                   ELSE NULL
               END AS ASSOCIATION_CONFIDENCE_RATE
             , CASE WHEN R.SOURCE_RULE_TYPE = 'SYMBOLIC' THEN R.RULE_CONFIDENCE END AS SYMBOLIC_SCORE
             , R.RULE_LIFT
             , R.DECISION_STATUS
             , R.RULE_STATUS
             , R.USER_RULE_YN
             , R.DECISION_NOTE
             , R.DECIDED_BY
             , R.DECIDED_AT
             , R.CREATED_BY
             , R.CREATED_AT
          FROM INIT$_TB_EDIT_RULE R
         WHERE R.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR R.SCENARIO_ID = :scenarioId)
         ORDER BY CASE R.DECISION_STATUS WHEN 'SELECTED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END
                , R.RULE_STATUS
                , R.EDIT_RULE_ID DESC
       )
 WHERE ROWNUM <= 300
;

-- [M06001_CHANGE_SUMMARY]
SELECT C.COLUMN_NAME
     , C.CHANGE_STATUS
     , COUNT(*) AS CHANGE_COUNT
     , COUNT(DISTINCT C.SOURCE_ROWID) AS CHANGED_ROW_COUNT
     , SUM(
           CASE
               WHEN C.NEW_VALUE IS NULL AND C.EXPECTED_VALUE IS NULL
               THEN 1
               WHEN C.NEW_VALUE IS NULL OR C.EXPECTED_VALUE IS NULL
               THEN 0
               WHEN DBMS_LOB.COMPARE(C.NEW_VALUE, C.EXPECTED_VALUE) = 0
               THEN 1
               ELSE 0
           END
       ) AS EXPECTED_MATCH_COUNT
  FROM INIT$_TB_EDIT_CHANGE C
  JOIN INIT$_TB_EDIT_SESSION S
    ON S.EDIT_SESSION_ID = C.EDIT_SESSION_ID
 WHERE S.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
   AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
 GROUP BY C.COLUMN_NAME
        , C.CHANGE_STATUS
 ORDER BY CHANGE_COUNT DESC
        , C.COLUMN_NAME
        , C.CHANGE_STATUS
;

-- [M06001_CHANGE_DETAIL]
SELECT *
  FROM (
        SELECT C.EDIT_CHANGE_ID
             , C.EDIT_SESSION_ID
             , C.EDIT_RULE_ID
             , R.RULE_NAME
             , C.SOURCE_VIOLATION_TYPE
              , C.COLUMN_NAME
              , CASE
                    WHEN C.OLD_VALUE IS NULL AND C.NEW_VALUE IS NULL
                    THEN 'N'
                    WHEN C.OLD_VALUE IS NULL OR C.NEW_VALUE IS NULL
                    THEN 'Y'
                    WHEN DBMS_LOB.COMPARE(C.OLD_VALUE, C.NEW_VALUE) = 0
                    THEN 'N'
                    ELSE 'Y'
                END AS VALUE_CHANGED_YN
              , CASE
                    WHEN C.NEW_VALUE IS NULL AND C.EXPECTED_VALUE IS NULL
                    THEN 'Y'
                    WHEN C.NEW_VALUE IS NULL OR C.EXPECTED_VALUE IS NULL
                    THEN 'N'
                    WHEN DBMS_LOB.COMPARE(C.NEW_VALUE, C.EXPECTED_VALUE) = 0
                    THEN 'Y'
                    ELSE 'N'
                END AS EXPECTED_MATCH_YN
             , C.CHANGE_STATUS
             , C.EDITED_BY
             , C.EDITED_AT
          FROM INIT$_TB_EDIT_CHANGE C
          JOIN INIT$_TB_EDIT_SESSION S
            ON S.EDIT_SESSION_ID = C.EDIT_SESSION_ID
          LEFT JOIN INIT$_TB_EDIT_RULE R
            ON R.EDIT_RULE_ID = C.EDIT_RULE_ID
         WHERE S.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
           AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
         ORDER BY C.EDITED_AT DESC
                , C.EDIT_CHANGE_ID DESC
       )
 WHERE ROWNUM <= 300
;

-- [M06001_VALIDATION_SUMMARY]
SELECT S.EDIT_SESSION_ID
     , S.SESSION_NAME
     , S.SESSION_STATUS
     , S.SOURCE_ROW_COUNT
     , S.BASELINE_FLOW_RUN_ID
     , S.REANALYSIS_FLOW_RUN_ID
     , S.REANALYSIS_STATUS
     , S.VALIDATED_AT
     , COUNT(C.EDIT_CHANGE_ID) AS TOTAL_CHANGE_COUNT
     , COUNT(DISTINCT C.SOURCE_ROWID) AS CHANGED_ROW_COUNT
     , SUM(CASE WHEN C.CHANGE_STATUS = 'APPLIED' THEN 1 ELSE 0 END) AS APPLIED_CHANGE_COUNT
     , SUM(
           CASE
               WHEN C.CHANGE_STATUS = 'APPLIED'
                AND (
                       (C.NEW_VALUE IS NULL AND C.EXPECTED_VALUE IS NULL)
                    OR (
                           C.NEW_VALUE IS NOT NULL
                       AND C.EXPECTED_VALUE IS NOT NULL
                       AND DBMS_LOB.COMPARE(C.NEW_VALUE, C.EXPECTED_VALUE) = 0
                       )
                    )
               THEN 1
               ELSE 0
           END
       ) AS EXPECTED_MATCH_COUNT
  FROM INIT$_TB_EDIT_SESSION S
  LEFT JOIN INIT$_TB_EDIT_CHANGE C
    ON C.EDIT_SESSION_ID = S.EDIT_SESSION_ID
 WHERE S.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
   AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
 GROUP BY S.EDIT_SESSION_ID
        , S.SESSION_NAME
        , S.SESSION_STATUS
        , S.SOURCE_ROW_COUNT
        , S.BASELINE_FLOW_RUN_ID
        , S.REANALYSIS_FLOW_RUN_ID
        , S.REANALYSIS_STATUS
        , S.VALIDATED_AT
ORDER BY S.EDIT_SESSION_ID DESC
;

-- [M06001_VALIDATION_SNAPSHOT]
SELECT *
  FROM (
        SELECT E.EVENT_DETAIL_JSON
             , E.CREATED_AT AS VALIDATION_SNAPSHOT_AT
          FROM INIT$_TB_EDIT_EVENT E
          JOIN INIT$_TB_EDIT_SESSION S
            ON S.EDIT_SESSION_ID = E.EDIT_SESSION_ID
         WHERE E.EDIT_SESSION_ID = :editSessionId
           AND E.EVENT_TYPE = 'EFFECT_VALIDATED'
           AND E.EVENT_DETAIL_JSON IS NOT NULL
           AND S.PROJECT_ID = :projectId
           AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
         ORDER BY E.CREATED_AT DESC
                , E.EDIT_EVENT_ID DESC
       )
 WHERE ROWNUM = 1
;

-- [M06001_DML_SUMMARY]
SELECT D.EDIT_DML_ID
     , D.EDIT_SESSION_ID
     , D.DML_NAME
     , D.DML_STATUS
     , D.APPROVED_BY
     , D.APPROVED_AT
     , D.EXECUTED_BY
     , D.EXECUTED_AT
     , D.AFFECTED_ROW_COUNT
     , D.CREATED_BY
     , D.CREATED_AT
     , D.UPDATED_AT
  FROM INIT$_TB_EDIT_DML D
  JOIN INIT$_TB_EDIT_SESSION S
    ON S.EDIT_SESSION_ID = D.EDIT_SESSION_ID
 WHERE S.PROJECT_ID = :projectId
   AND (:scenarioId IS NULL OR S.SCENARIO_ID = :scenarioId)
   AND (:editSessionId IS NULL OR S.EDIT_SESSION_ID = :editSessionId)
 ORDER BY D.EDIT_DML_ID DESC
;

-- [M06001_AUDIT_EVENT_LIST]
SELECT *
  FROM (
        SELECT E.EDIT_EVENT_ID
             , E.EDIT_SESSION_ID
             , E.EVENT_TYPE
             , E.ENTITY_TYPE
             , E.ENTITY_ID
             , E.EVENT_USER
             , E.CREATED_AT
          FROM INIT$_TB_EDIT_EVENT E
          LEFT JOIN INIT$_TB_EDIT_SESSION S
            ON S.EDIT_SESSION_ID = E.EDIT_SESSION_ID
          LEFT JOIN INIT$_TB_EDIT_RULE R
            ON E.ENTITY_TYPE = 'EDIT_RULE'
           AND R.EDIT_RULE_ID = E.ENTITY_ID
         WHERE NVL(S.PROJECT_ID, R.PROJECT_ID) = :projectId
           AND (:scenarioId IS NULL OR NVL(S.SCENARIO_ID, R.SCENARIO_ID) = :scenarioId)
           AND (:editSessionId IS NULL OR E.EDIT_SESSION_ID = :editSessionId)
         ORDER BY E.CREATED_AT DESC
                , E.EDIT_EVENT_ID DESC
       )
 WHERE ROWNUM <= 300
;

-- [M06001_AUDIT_EVENT_AGGREGATE]
SELECT COUNT(*) AS AUDIT_EVENT_COUNT
     , COUNT(DISTINCT E.EVENT_TYPE) AS EVENT_TYPE_COUNT
     , COUNT(DISTINCT E.EVENT_USER) AS EVENT_USER_COUNT
  FROM INIT$_TB_EDIT_EVENT E
  LEFT JOIN INIT$_TB_EDIT_SESSION S
    ON S.EDIT_SESSION_ID = E.EDIT_SESSION_ID
  LEFT JOIN INIT$_TB_EDIT_RULE R
    ON E.ENTITY_TYPE = 'EDIT_RULE'
   AND R.EDIT_RULE_ID = E.ENTITY_ID
 WHERE NVL(S.PROJECT_ID, R.PROJECT_ID) = :projectId
   AND (:scenarioId IS NULL OR NVL(S.SCENARIO_ID, R.SCENARIO_ID) = :scenarioId)
   AND (:editSessionId IS NULL OR E.EDIT_SESSION_ID = :editSessionId)
;

-- [M06001_SCENARIO_SCORECARD]
WITH SCENARIOS AS
(
    SELECT S.SCENARIO_ID
         , S.SCENARIO_CODE
         , S.SCENARIO_NAME
         , S.SORT_ORDER
      FROM INIT$_TB_SCENARIO S
     WHERE S.PROJECT_ID = :projectId
       AND S.USE_YN = 'Y'
)
, RUN_RANKED AS
(
    SELECT F.SCENARIO_ID
         , FR.FLOW_RUN_ID
         , FR.STATUS
         , NVL(FR.FINISHED_AT, FR.CREATED_AT) AS RUN_AT
         , ROW_NUMBER() OVER (
               PARTITION BY F.SCENARIO_ID
                   ORDER BY NVL(FR.FINISHED_AT, FR.CREATED_AT) DESC
                          , FR.FLOW_RUN_ID DESC
           ) AS RN__
      FROM INIT$_TB_FLOW_WORK_RUN FR
      JOIN INIT$_TB_FLOW_WORK F
        ON F.FLOW_ID = FR.FLOW_ID
      JOIN SCENARIOS S
        ON S.SCENARIO_ID = F.SCENARIO_ID
     WHERE F.MENU_CODE = 'M04001'
       AND FR.STATUS IN ('SUCCESS', 'COMPLETED')
)
, LATEST_RUN AS
(
    SELECT R.SCENARIO_ID
         , R.FLOW_RUN_ID
         , R.STATUS
         , R.RUN_AT
      FROM RUN_RANKED R
     WHERE R.RN__ = 1
)
, DISCOVERED_RULES AS
(
    SELECT LR.SCENARIO_ID
         , LR.FLOW_RUN_ID
         , 'ASSOCIATION' AS SOURCE_RULE_TYPE
         , R.RUN_SOURCE_TYPE
         , R.RUN_ID
         , R.OWNER AS SOURCE_OWNER
         , R.MODEL_NAME AS SOURCE_OBJECT_NAME
         , R.RULE_ID AS SOURCE_RULE_ID
         , R.TARGET_OWNER
         , R.TARGET_TABLE
         , R.RESULT_COLUMN AS TARGET_COLUMN
      FROM LATEST_RUN LR
      JOIN INIT$_TB_RULEDISC_ASSOC_SUM R
        ON R.RUN_SOURCE_TYPE = 'FLOW_WORK'
       AND R.RUN_ID = LR.FLOW_RUN_ID
    UNION ALL
    SELECT LR.SCENARIO_ID
         , LR.FLOW_RUN_ID
         , 'SYMBOLIC' AS SOURCE_RULE_TYPE
         , R.RUN_SOURCE_TYPE
         , R.RUN_ID
         , R.OWNER AS SOURCE_OWNER
         , R.TABLE_NAME AS SOURCE_OBJECT_NAME
         , R.RULE_ID AS SOURCE_RULE_ID
         , R.OWNER AS TARGET_OWNER
         , R.TABLE_NAME AS TARGET_TABLE
         , R.TARGET_COLUMN
      FROM LATEST_RUN LR
      JOIN INIT$_TB_RULEDISC_SYMBOLIC R
        ON R.RUN_SOURCE_TYPE = 'FLOW_WORK'
       AND R.RUN_ID = LR.FLOW_RUN_ID
)
, EDIT_DECISION_RANKED AS
(
    SELECT E.SCENARIO_ID
         , E.SOURCE_RULE_TYPE
         , E.SOURCE_RUN_SOURCE_TYPE
         , E.SOURCE_RUN_ID
         , E.SOURCE_OWNER
         , E.SOURCE_OBJECT_NAME
         , E.SOURCE_RULE_ID
         , E.TARGET_OWNER
         , E.TARGET_TABLE
         , E.TARGET_COLUMN
         , E.DECISION_STATUS
         , E.RULE_STATUS
         , ROW_NUMBER() OVER (
               PARTITION BY E.SCENARIO_ID
                          , E.SOURCE_RULE_TYPE
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
      FROM INIT$_TB_EDIT_RULE E
     WHERE E.PROJECT_ID = :projectId
       AND E.SOURCE_RUN_SOURCE_TYPE = 'FLOW_WORK'
       AND E.SOURCE_RULE_TYPE IN ('ASSOCIATION', 'SYMBOLIC')
       AND E.USER_RULE_YN = 'N'
)
, EDIT_DECISIONS AS
(
    SELECT E.*
      FROM EDIT_DECISION_RANKED E
     WHERE E.RN__ = 1
)
, RULE_SCORE AS
(
    SELECT D.SCENARIO_ID
         , D.FLOW_RUN_ID
         , COUNT(*) AS TOTAL_RULE_COUNT
         , SUM(
               CASE
                   WHEN E.DECISION_STATUS = 'SELECTED' AND E.RULE_STATUS = 'ACTIVE' THEN 1
                   ELSE 0
               END
           ) AS FINAL_RULE_COUNT
      FROM DISCOVERED_RULES D
      LEFT JOIN EDIT_DECISIONS E
        ON E.SCENARIO_ID = D.SCENARIO_ID
       AND E.SOURCE_RULE_TYPE = D.SOURCE_RULE_TYPE
       AND E.SOURCE_RUN_SOURCE_TYPE = D.RUN_SOURCE_TYPE
       AND E.SOURCE_RUN_ID = D.RUN_ID
       AND E.SOURCE_OWNER = D.SOURCE_OWNER
       AND E.SOURCE_OBJECT_NAME = D.SOURCE_OBJECT_NAME
       AND E.SOURCE_RULE_ID = D.SOURCE_RULE_ID
       AND E.TARGET_OWNER = D.TARGET_OWNER
       AND E.TARGET_TABLE = D.TARGET_TABLE
       AND E.TARGET_COLUMN = D.TARGET_COLUMN
     GROUP BY D.SCENARIO_ID
            , D.FLOW_RUN_ID
)
, SESSION_RANKED AS
(
    SELECT ES.SCENARIO_ID
         , ES.EDIT_SESSION_ID
         , ES.SESSION_STATUS
         , ES.SOURCE_ROW_COUNT
         , NVL(
               ES.BASELINE_FLOW_RUN_ID
             , CASE WHEN ES.SOURCE_RUN_SOURCE_TYPE = 'FLOW_WORK' THEN ES.SOURCE_RUN_ID END
           ) AS BASELINE_FLOW_RUN_ID
         , NVL(ES.UPDATED_AT, ES.CREATED_AT) AS SESSION_AT
         , ROW_NUMBER() OVER (
               PARTITION BY ES.SCENARIO_ID
                   ORDER BY NVL(ES.UPDATED_AT, ES.CREATED_AT) DESC
                          , ES.EDIT_SESSION_ID DESC
           ) AS RN__
      FROM INIT$_TB_EDIT_SESSION ES
      JOIN SCENARIOS S
        ON S.SCENARIO_ID = ES.SCENARIO_ID
)
, LATEST_SESSION AS
(
    SELECT ES.SCENARIO_ID
         , ES.EDIT_SESSION_ID
         , ES.SESSION_STATUS
         , ES.SOURCE_ROW_COUNT
         , ES.BASELINE_FLOW_RUN_ID
         , ES.SESSION_AT
      FROM SESSION_RANKED ES
     WHERE ES.RN__ = 1
)
, CHANGE_SCORE AS
(
    SELECT C.EDIT_SESSION_ID
         , COUNT(*) AS CHANGE_COUNT
         , SUM(CASE WHEN C.CHANGE_STATUS = 'APPLIED' THEN 1 ELSE 0 END) AS APPLIED_CHANGE_COUNT
      FROM INIT$_TB_EDIT_CHANGE C
      JOIN LATEST_SESSION ES
        ON ES.EDIT_SESSION_ID = C.EDIT_SESSION_ID
     GROUP BY C.EDIT_SESSION_ID
)
, DML_SCORE AS
(
    SELECT D.EDIT_SESSION_ID
         , SUM(CASE WHEN D.DML_STATUS = 'EXECUTED' THEN 1 ELSE 0 END) AS EXECUTED_DML_COUNT
      FROM INIT$_TB_EDIT_DML D
      JOIN LATEST_SESSION ES
        ON ES.EDIT_SESSION_ID = D.EDIT_SESSION_ID
     GROUP BY D.EDIT_SESSION_ID
)
SELECT S.SCENARIO_ID
     , S.SCENARIO_CODE
     , S.SCENARIO_NAME
     , (
        SELECT COUNT(*)
          FROM INIT$_TB_TABLES T
         WHERE T.SCENARIO_ID = S.SCENARIO_ID
           AND T.USE_YN = 'Y'
       ) AS TARGET_TABLE_COUNT
     , LR.FLOW_RUN_ID AS LATEST_SUCCESS_FLOW_RUN_ID
     , LR.RUN_AT AS LATEST_SUCCESS_FLOW_RUN_AT
     , NVL(RS.TOTAL_RULE_COUNT, 0) AS TOTAL_RULE_COUNT
     , NVL(RS.FINAL_RULE_COUNT, 0) AS FINAL_RULE_COUNT
     , ES.EDIT_SESSION_ID AS LATEST_EDIT_SESSION_ID
     , ES.SESSION_STATUS AS LATEST_EDIT_SESSION_STATUS
      , ES.SESSION_AT AS LATEST_EDIT_SESSION_AT
      , ES.BASELINE_FLOW_RUN_ID AS SESSION_BASELINE_FLOW_RUN_ID
      , CASE
            WHEN LR.FLOW_RUN_ID IS NULL OR ES.BASELINE_FLOW_RUN_ID IS NULL THEN NULL
            WHEN LR.FLOW_RUN_ID = ES.BASELINE_FLOW_RUN_ID THEN 'Y'
            ELSE 'N'
        END AS CONTEXT_MATCH_YN
      , NVL(ES.SOURCE_ROW_COUNT, 0) AS INSPECTED_ROW_COUNT
     , NVL(CS.CHANGE_COUNT, 0) AS CHANGE_COUNT
     , NVL(CS.APPLIED_CHANGE_COUNT, 0) AS APPLIED_CHANGE_COUNT
     , NVL(DS.EXECUTED_DML_COUNT, 0) AS EXECUTED_DML_COUNT
  FROM SCENARIOS S
  LEFT JOIN LATEST_RUN LR
    ON LR.SCENARIO_ID = S.SCENARIO_ID
  LEFT JOIN RULE_SCORE RS
    ON RS.SCENARIO_ID = LR.SCENARIO_ID
   AND RS.FLOW_RUN_ID = LR.FLOW_RUN_ID
  LEFT JOIN LATEST_SESSION ES
    ON ES.SCENARIO_ID = S.SCENARIO_ID
  LEFT JOIN CHANGE_SCORE CS
    ON CS.EDIT_SESSION_ID = ES.EDIT_SESSION_ID
  LEFT JOIN DML_SCORE DS
    ON DS.EDIT_SESSION_ID = ES.EDIT_SESSION_ID
 ORDER BY S.SORT_ORDER NULLS LAST
        , S.SCENARIO_NAME
        , S.SCENARIO_ID
;
