-- [M04002_FLOW_RUN_LIST]
SELECT *
  FROM (
        SELECT Q.*,
               ROW_NUMBER() OVER (ORDER BY Q.FLOW_RUN_ID DESC) AS RN__
          FROM (
                SELECT R.FLOW_RUN_ID,
                       R.FLOW_ID,
                       F.FLOW_NAME,
                       F.FLOW_GROUP,
                       F.PROJECT_ID,
                       F.SCENARIO_ID,
                       R.RUN_TYPE,
                       R.STATUS,
                       R.MESSAGE,
                       R.STARTED_AT,
                       R.FINISHED_AT,
                       R.CREATED_AT,
                       COUNT(*) OVER () AS TOTAL_COUNT,
                       (SELECT COUNT(*)
                          FROM "INIT$_TB_FLOW_WORK_NODE_RUN" NR
                         WHERE NR.FLOW_RUN_ID = R.FLOW_RUN_ID) AS NODE_COUNT,
                       (SELECT COUNT(*)
                          FROM "INIT$_TB_FLOW_WORK_NODE_RUN" NR
                         WHERE NR.FLOW_RUN_ID = R.FLOW_RUN_ID
                           AND NR.STATUS = 'SUCCESS') AS SUCCESS_NODE_COUNT,
                       (SELECT COUNT(*)
                          FROM "INIT$_TB_FLOW_WORK_NODE_RUN" NR
                         WHERE NR.FLOW_RUN_ID = R.FLOW_RUN_ID
                           AND NR.STATUS IN ('FAILED', 'SKIPPED', 'ERROR')) AS FAILED_NODE_COUNT
                  FROM "INIT$_TB_FLOW_WORK_RUN" R
                  JOIN "INIT$_TB_FLOW_WORK" F ON F.FLOW_ID = R.FLOW_ID
                  JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = F.PROJECT_ID
                 WHERE F.MENU_CODE = 'M04001'
                   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
                   AND F.PROJECT_ID = :projectId
                   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
                   AND (:status = 'ALL' OR R.STATUS = :status)
                   AND (
                        :keyword IS NULL
                        OR UPPER(F.FLOW_NAME) LIKE '%' || UPPER(:keyword) || '%'
                        OR TO_CHAR(R.FLOW_RUN_ID) = :keyword
                   )
               ) Q
       )
 WHERE RN__ > :offset
   AND RN__ <= :endRow
 ORDER BY RN__;

-- [M04002_FLOW_RUN_POSITION]
SELECT RN__
  FROM (
        SELECT Q.FLOW_RUN_ID,
               ROW_NUMBER() OVER (ORDER BY Q.FLOW_RUN_ID DESC) AS RN__
          FROM (
                SELECT R.FLOW_RUN_ID
                  FROM "INIT$_TB_FLOW_WORK_RUN" R
                  JOIN "INIT$_TB_FLOW_WORK" F ON F.FLOW_ID = R.FLOW_ID
                  JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = F.PROJECT_ID
                 WHERE F.MENU_CODE = 'M04001'
                   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
                   AND F.PROJECT_ID = :projectId
                   AND (:scenarioId IS NULL OR F.SCENARIO_ID = :scenarioId)
                   AND (:status = 'ALL' OR R.STATUS = :status)
                   AND (
                        :keyword IS NULL
                        OR UPPER(F.FLOW_NAME) LIKE '%' || UPPER(:keyword) || '%'
                   )
               ) Q
       )
 WHERE FLOW_RUN_ID = :flowRunId;

-- [M04002_RESULT_TABLE_COLUMNS]
SELECT COLUMN_NAME
  FROM ALL_TAB_COLUMNS
 WHERE OWNER = :owner
   AND TABLE_NAME = :tableName;

-- [M04002_TARGET_TABLE_COLUMN_COUNT]
SELECT COUNT(*) AS COLUMN_COUNT
  FROM ALL_TAB_COLUMNS
 WHERE OWNER = :owner
   AND TABLE_NAME = :tableName;

-- [M04002_TARGET_COLUMN_COMMENTS]
SELECT C.COLUMN_NAME,
       CC.COMMENTS AS COLUMN_COMMENT
  FROM ALL_TAB_COLUMNS C
  LEFT OUTER JOIN ALL_COL_COMMENTS CC
    ON CC.OWNER = C.OWNER
   AND CC.TABLE_NAME = C.TABLE_NAME
   AND CC.COLUMN_NAME = C.COLUMN_NAME
 WHERE C.OWNER = :owner
   AND C.TABLE_NAME = :tableName
 ORDER BY C.COLUMN_ID;

-- [M04002_MODEL_METADATA]
SELECT OWNER,
       MODEL_NAME,
       MINING_FUNCTION,
       ALGORITHM,
       CREATION_DATE
  FROM ALL_MINING_MODELS
 WHERE OWNER = :owner
   AND MODEL_NAME = :modelName;

-- [M04002_ASSOC_RULE_OVERVIEW]
SELECT COUNT(*) AS TOTAL_RULES,
       SUM(CASE WHEN CONDITION_COUNT > 0 AND RESULT_COLUMN IS NOT NULL THEN 1 ELSE 0 END) AS MAPPED_RULES,
       SUM(CASE WHEN RESULT_HAS_VALUE_YN = 'N' THEN 1 ELSE 0 END) AS MISSING_RESULT_RULES,
       MAX(MODEL_TYPE) AS MODEL_TYPE,
       MAX(RULE_SOURCE) AS RULE_SOURCE,
       AVG(RULE_SUPPORT) AS AVG_SUPPORT,
       AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE,
       AVG(RULE_LIFT) AS AVG_LIFT,
       MAX(RULE_SUPPORT) AS MAX_SUPPORT,
       MAX(RULE_CONFIDENCE) AS MAX_CONFIDENCE,
       MAX(RULE_LIFT) AS MAX_LIFT
  FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
 WHERE OWNER = :owner
   AND TARGET_OWNER = :targetOwner
   AND TARGET_TABLE = :targetTable
   AND MODEL_NAME = :modelName;

-- [M04002_ASSOC_RULE_CONDITION_DIST]
SELECT CONDITION_COUNT,
       COUNT(*) AS RULE_COUNT,
       AVG(RULE_SUPPORT) AS AVG_SUPPORT,
       AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE,
       AVG(RULE_LIFT) AS AVG_LIFT
  FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
 WHERE OWNER = :owner
   AND TARGET_OWNER = :targetOwner
   AND TARGET_TABLE = :targetTable
   AND MODEL_NAME = :modelName
 GROUP BY CONDITION_COUNT
 ORDER BY CONDITION_COUNT;

-- [M04002_ASSOC_RULE_RESULT_TOP]
SELECT *
  FROM (
        SELECT Q.*,
               ROW_NUMBER() OVER (ORDER BY Q.RULE_COUNT DESC, Q.RESULT_COLUMN) AS RN__,
               COUNT(*) OVER () AS TOTAL_COUNT
          FROM (
                SELECT NVL(RESULT_COLUMN, '(RESULT UNKNOWN)') AS RESULT_COLUMN,
                       COUNT(*) AS RULE_COUNT,
                       SUM(CASE WHEN RESULT_HAS_VALUE_YN = 'Y' THEN 1 ELSE 0 END) AS VALUE_RULE_COUNT,
                       SUM(SUPPORT_COUNT) AS SUPPORT_COUNT,
                       AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE,
                       AVG(RULE_LIFT) AS AVG_LIFT
                  FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
                 WHERE OWNER = :owner
                   AND TARGET_OWNER = :targetOwner
                   AND TARGET_TABLE = :targetTable
                   AND MODEL_NAME = :modelName
                 GROUP BY NVL(RESULT_COLUMN, '(RESULT UNKNOWN)')
               ) Q
       )
 WHERE RN__ > :resultOffset
   AND RN__ <= :resultEndRow
 ORDER BY RN__;

-- [M04002_ASSOC_RULE_DETAIL_LIST]
SELECT *
  FROM (
        SELECT Q.*,
               ROW_NUMBER() OVER (ORDER BY Q.RULE_CONFIDENCE DESC NULLS LAST, Q.RULE_LIFT DESC NULLS LAST, Q.RULE_SUPPORT DESC NULLS LAST, Q.RULE_ID) AS RN__,
               COUNT(*) OVER () AS TOTAL_COUNT
          FROM (
                SELECT OWNER,
                       TARGET_OWNER,
                       TARGET_TABLE,
                       MODEL_NAME,
                        RULE_ID,
                        MODEL_TYPE,
                        RULE_SOURCE,
                        CONDITION_COUNT,
                        CONDITION_COLUMN,
                        CONDITION_VALUE,
                        RESULT_COLUMN,
                        RESULT_VALUE,
                        RESULT_HAS_VALUE_YN,
                        RULE_SUPPORT,
                        RULE_CONFIDENCE,
                        RULE_LIFT,
                        SUPPORT_COUNT,
                        CONDITION_TOTAL_COUNT,
                        RESULT_TOTAL_COUNT,
                         TOTAL_COUNT AS RULE_TOTAL_COUNT,
                        CONDITION_TEXT,
                        RESULT_TEXT,
                        CREATE_DT
                  FROM "INIT$_TB_ASSOC_RULE_SUMMARY"
                 WHERE OWNER = :owner
                   AND TARGET_OWNER = :targetOwner
                   AND TARGET_TABLE = :targetTable
                   AND MODEL_NAME = :modelName
                   AND (:conditionCount IS NULL OR CONDITION_COUNT = :conditionCount)
                   AND (
                        :resultColumn IS NULL
                        OR (:resultColumn = '__NULL__' AND RESULT_COLUMN IS NULL)
                        OR RESULT_COLUMN = :resultColumn
                   )
                   AND (:resultHasValueYn IS NULL OR RESULT_HAS_VALUE_YN = :resultHasValueYn)
               ) Q
       )
 WHERE RN__ > :offset
   AND RN__ <= :endRow
 ORDER BY RN__;
