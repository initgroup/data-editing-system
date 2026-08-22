-- [MCOMMON_ANLY_WORK_FLOW_RUN_LIST]
SELECT *
  FROM (
        SELECT Q.*
             , ROW_NUMBER() OVER (ORDER BY Q.FLOW_RUN_ID DESC) AS RN__
          FROM (
                SELECT R.FLOW_RUN_ID
                     , 'FLOW_WORK' AS RUN_SOURCE_TYPE
                     , R.FLOW_RUN_ID AS RUN_ID
                     , R.FLOW_ID
                     , F.FLOW_NAME
                     , F.FLOW_GROUP
                     , F.PROJECT_ID
                     , F.SCENARIO_ID
                     , R.RUN_TYPE
                     , R.STATUS
                     , R.MESSAGE
                     , R.STARTED_AT
                     , R.FINISHED_AT
                     , R.CREATED_AT
                     , COUNT(*) OVER () AS TOTAL_COUNT
                     , (SELECT COUNT(*)
                          FROM "INIT$_TB_FLOW_WORK_NODE_RUN" NR
                         WHERE NR.FLOW_RUN_ID = R.FLOW_RUN_ID) AS NODE_COUNT
                     , (SELECT COUNT(*)
                          FROM "INIT$_TB_FLOW_WORK_NODE_RUN" NR
                         WHERE NR.FLOW_RUN_ID = R.FLOW_RUN_ID
                           AND NR.STATUS = 'SUCCESS') AS SUCCESS_NODE_COUNT
                     , (SELECT COUNT(*)
                          FROM "INIT$_TB_FLOW_WORK_NODE_RUN" NR
                         WHERE NR.FLOW_RUN_ID = R.FLOW_RUN_ID
                           AND NR.STATUS IN ('FAILED', 'SKIPPED', 'ERROR')) AS FAILED_NODE_COUNT
                  FROM "INIT$_TB_FLOW_WORK_RUN" R
                  JOIN "INIT$_TB_FLOW_WORK" F ON F.FLOW_ID = R.FLOW_ID
                  JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = F.PROJECT_ID
                 WHERE F.MENU_CODE = :flowMenuCode
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

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_BALANCED_VIOLATIONS]
WITH RULE_BASE AS
     (
      SELECT S.OWNER AS RULE_OWNER
           , S.MODEL_NAME
           , S.RUN_SOURCE_TYPE
           , S.RUN_ID
           , S.RULE_ID
           , S.CONDITION_COUNT
           , DBMS_LOB.SUBSTR(S.CONDITION_TEXT, 4000, 1) AS CONDITION_TEXT
           , S.RESULT_COLUMN
           , S.RESULT_VALUE
           , DBMS_LOB.SUBSTR(S.RESULT_TEXT, 4000, 1) AS RESULT_TEXT
           , S.RULE_SUPPORT
           , S.RULE_CONFIDENCE
           , S.RULE_LIFT
        FROM "INIT$_TB_RULEDISC_ASSOC_SUM" S
       WHERE 1=1
         AND S.OWNER = :owner
         AND S.TARGET_OWNER = :targetOwner
         AND S.TARGET_TABLE = :targetTable
         AND S.MODEL_NAME = :modelName
         AND S.RESULT_HAS_VALUE_YN = 'Y'
         AND S.RESULT_COLUMN IS NOT NULL
         AND S.RESULT_VALUE IS NOT NULL
         AND S.CONDITION_TEXT IS NOT NULL
         AND (:runSourceType IS NULL OR S.RUN_SOURCE_TYPE = :runSourceType)
         AND (:runId IS NULL OR S.RUN_ID = :runId)
     )
   , VIOLATION_BASE AS
     (
      SELECT V.RULE_ID
           , COUNT(*) AS VIOLATION_COUNT
           , COUNT(DISTINCT NVL(V.CASE_ID, V.CASE_ROWID)) AS VIOLATED_ROW_COUNT
           , AVG(V.VIOLATION_SCORE) AS AVG_VIOLATION_SCORE
        FROM "INIT$_TB_RULEVIOL_ASSOC" V
       WHERE 1=1
         AND V.TARGET_OWNER = :targetOwner
         AND V.TARGET_TABLE = :targetTable
         AND (:runSourceType IS NULL OR V.RUN_SOURCE_TYPE = :runSourceType)
         AND (:runId IS NULL OR V.RUN_ID = :runId)
       GROUP BY V.RULE_ID
     )
   , SCORED_RULE AS
     (
      SELECT R.*
           , NVL(V.VIOLATION_COUNT, 0) AS VIOLATION_COUNT
           , NVL(V.VIOLATED_ROW_COUNT, 0) AS VIOLATED_ROW_COUNT
           , V.AVG_VIOLATION_SCORE
        FROM RULE_BASE R
        JOIN VIOLATION_BASE V
          ON V.RULE_ID = R.RULE_ID
       WHERE 1=1
         AND NVL(V.VIOLATION_COUNT, 0) > 0
     )
   , RANKED_RULE AS
     (
      SELECT S.*
           , ROW_NUMBER() OVER (
                 PARTITION BY S.CONDITION_COUNT
                     ORDER BY S.VIOLATION_COUNT DESC
                            , S.AVG_VIOLATION_SCORE DESC NULLS LAST
                            , S.RULE_CONFIDENCE DESC NULLS LAST
                            , S.RULE_LIFT DESC NULLS LAST
                            , S.RULE_ID
             ) AS CONDITION_RN
           , ROW_NUMBER() OVER (
                 PARTITION BY S.RESULT_COLUMN
                     ORDER BY S.VIOLATION_COUNT DESC
                            , S.CONDITION_COUNT DESC NULLS LAST
                            , S.AVG_VIOLATION_SCORE DESC NULLS LAST
                            , S.RULE_CONFIDENCE DESC NULLS LAST
                            , S.RULE_ID
             ) AS RESULT_RN
        FROM SCORED_RULE S
     )
SELECT RULE_OWNER
     , MODEL_NAME
     , RUN_SOURCE_TYPE
     , RUN_ID
     , RULE_ID
     , CONDITION_COUNT
     , CONDITION_TEXT
     , RESULT_COLUMN
     , RESULT_VALUE
     , RESULT_TEXT
     , RULE_SUPPORT
     , RULE_CONFIDENCE
     , RULE_LIFT
     , VIOLATION_COUNT
     , VIOLATED_ROW_COUNT
     , AVG_VIOLATION_SCORE
  FROM RANKED_RULE
 WHERE 1=1
   AND (CONDITION_RN <= :topPerGroup OR RESULT_RN <= :topPerGroup)
 ORDER BY VIOLATION_COUNT DESC
        , CONDITION_COUNT DESC NULLS LAST
        , AVG_VIOLATION_SCORE DESC NULLS LAST
        , RULE_CONFIDENCE DESC NULLS LAST
        , RULE_ID;

-- [MCOMMON_ANLY_WORK_SYMBOLIC_RULE_BALANCED_VIOLATIONS]
WITH RULE_BASE AS
     (
      SELECT R.OWNER AS RULE_OWNER
           , R.RUN_SOURCE_TYPE
           , R.RUN_ID
           , R.RULE_ID
           , R.TARGET_COLUMN
           , DBMS_LOB.SUBSTR(R.EXPRESSION, 4000, 1) AS EXPRESSION
           , R.FEATURE_COLUMNS
           , R.SCORE
           , R.COMPLEXITY
           , R.METHOD
           , R.SELECTED_YN
           , R.RANK_NO
        FROM "INIT$_TB_RULEDISC_SYMBOLIC" R
       WHERE 1=1
         AND R.OWNER = :targetOwner
         AND R.TABLE_NAME = :targetTable
         AND (:runSourceType IS NULL OR R.RUN_SOURCE_TYPE = :runSourceType)
         AND (:runId IS NULL OR R.RUN_ID = :runId)
     )
   , VIOLATION_BASE AS
     (
      SELECT V.RULE_ID
           , V.TARGET_COLUMN
           , COUNT(*) AS VIOLATION_COUNT
           , COUNT(DISTINCT NVL(V.CASE_ID, V.CASE_ROWID)) AS VIOLATED_ROW_COUNT
           , AVG(V.ERROR_PCT) AS AVG_ERROR_PCT
           , MAX(V.ERROR_PCT) AS MAX_ERROR_PCT
           , AVG(V.ABS_ERROR) AS AVG_ABS_ERROR
           , MAX(V.VIOLATION_SCORE) AS MAX_VIOLATION_SCORE
           , MAX(V.TOLERANCE_PCT) AS TOLERANCE_PCT
        FROM "INIT$_TB_RULEVIOL_SYMBOLIC" V
       WHERE 1=1
         AND V.TARGET_OWNER = :targetOwner
         AND V.TARGET_TABLE = :targetTable
         AND (:runSourceType IS NULL OR V.RUN_SOURCE_TYPE = :runSourceType)
         AND (:runId IS NULL OR V.RUN_ID = :runId)
       GROUP BY V.RULE_ID
              , V.TARGET_COLUMN
     )
   , SCORED_RULE AS
     (
      SELECT R.*
           , V.VIOLATION_COUNT
           , V.VIOLATED_ROW_COUNT
           , V.AVG_ERROR_PCT
           , V.MAX_ERROR_PCT
           , V.AVG_ABS_ERROR
           , V.MAX_VIOLATION_SCORE
           , V.TOLERANCE_PCT
           , CASE
                 WHEN INSTR(UPPER(NVL(R.METHOD, '')), 'LINEAR') > 0
                  AND (
                      NVL(R.COMPLEXITY, 999999) <= 3
                      OR REGEXP_COUNT(NVL(R.FEATURE_COLUMNS, ''), '[^,]+') BETWEEN 1 AND 2
                  )
                 THEN 'Y' ELSE 'N'
             END AS SIMPLE_LINEAR_YN
        FROM RULE_BASE R
        JOIN VIOLATION_BASE V
          ON V.RULE_ID = R.RULE_ID
         AND V.TARGET_COLUMN = R.TARGET_COLUMN
       WHERE 1=1
         AND NVL(V.VIOLATION_COUNT, 0) > 0
     )
   , RANKED_RULE AS
     (
      SELECT S.*
           , ROW_NUMBER() OVER (
                 PARTITION BY S.TARGET_COLUMN
                     ORDER BY S.VIOLATION_COUNT DESC
                            , CASE WHEN S.SIMPLE_LINEAR_YN = 'Y' THEN 0 ELSE 1 END
                            , S.MAX_ERROR_PCT DESC NULLS LAST
                            , S.SCORE DESC NULLS LAST
                            , S.RULE_ID
             ) AS TARGET_RN
           , ROW_NUMBER() OVER (
                 PARTITION BY NVL(S.METHOD, '(UNKNOWN)')
                     ORDER BY S.VIOLATION_COUNT DESC
                            , CASE WHEN S.SIMPLE_LINEAR_YN = 'Y' THEN 0 ELSE 1 END
                            , S.MAX_ERROR_PCT DESC NULLS LAST
                            , S.SCORE DESC NULLS LAST
                            , S.RULE_ID
             ) AS METHOD_RN
           , ROW_NUMBER() OVER (
                 PARTITION BY S.SIMPLE_LINEAR_YN
                     ORDER BY S.VIOLATION_COUNT DESC
                            , S.MAX_ERROR_PCT DESC NULLS LAST
                            , S.SCORE DESC NULLS LAST
                            , S.RULE_ID
             ) AS SIMPLE_LINEAR_RN
        FROM SCORED_RULE S
     )
SELECT RULE_OWNER
     , RUN_SOURCE_TYPE
     , RUN_ID
     , RULE_ID
     , TARGET_COLUMN
     , EXPRESSION
     , FEATURE_COLUMNS
     , SCORE
     , COMPLEXITY
     , METHOD
     , SELECTED_YN
     , RANK_NO
     , VIOLATION_COUNT
     , VIOLATED_ROW_COUNT
     , AVG_ERROR_PCT
     , MAX_ERROR_PCT
     , AVG_ABS_ERROR
     , MAX_VIOLATION_SCORE
     , TOLERANCE_PCT
     , SIMPLE_LINEAR_YN
  FROM RANKED_RULE
 WHERE 1=1
   AND (
       TARGET_RN <= :topPerGroup
       OR METHOD_RN <= :topPerGroup
       OR (SIMPLE_LINEAR_YN = 'Y' AND SIMPLE_LINEAR_RN <= :simpleLinearLimit)
   )
 ORDER BY VIOLATION_COUNT DESC
        , CASE WHEN SIMPLE_LINEAR_YN = 'Y' THEN 0 ELSE 1 END
        , MAX_ERROR_PCT DESC NULLS LAST
        , SCORE DESC NULLS LAST
        , RULE_ID;

-- [MCOMMON_ANLY_WORK_FLOW_RUN_POSITION]
SELECT RN__
  FROM (
        SELECT Q.FLOW_RUN_ID
             , ROW_NUMBER() OVER (ORDER BY Q.FLOW_RUN_ID DESC) AS RN__
          FROM (
                SELECT R.FLOW_RUN_ID
                  FROM "INIT$_TB_FLOW_WORK_RUN" R
                  JOIN "INIT$_TB_FLOW_WORK" F ON F.FLOW_ID = R.FLOW_ID
                  JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = F.PROJECT_ID
                 WHERE F.MENU_CODE = :flowMenuCode
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

-- [MCOMMON_ANLY_WORK_FLOW_RUN_DELETE_TARGET]
SELECT R.FLOW_RUN_ID
     , R.STATUS
     , F.FLOW_NAME
  FROM "INIT$_TB_FLOW_WORK_RUN" R
  JOIN "INIT$_TB_FLOW_WORK" F
    ON F.FLOW_ID = R.FLOW_ID
  JOIN "INIT$_TB_PROJECT" P
    ON P.PROJECT_ID = F.PROJECT_ID
 WHERE R.FLOW_RUN_ID = :flowRunId
   AND F.MENU_CODE = :flowMenuCode
   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId);

-- [MCOMMON_ANLY_WORK_FLOW_RUN_DELETE_BLOCK]
DECLARE
    v_flow_run_id NUMBER := :flowRunId;
    v_exists      NUMBER := 0;
    v_deleted     NUMBER := 0;

    PROCEDURE delete_run_result_table(p_table_name IN VARCHAR2) IS
        v_sql VARCHAR2(1000);
    BEGIN
        SELECT COUNT(DISTINCT COLUMN_NAME)
          INTO v_exists
          FROM USER_TAB_COLUMNS
         WHERE TABLE_NAME = p_table_name
           AND COLUMN_NAME IN ('RUN_SOURCE_TYPE', 'RUN_ID');

        IF v_exists = 2 THEN
            v_sql := 'DELETE FROM "' || p_table_name || '" WHERE "RUN_SOURCE_TYPE" = :1 AND "RUN_ID" = :2';
            EXECUTE IMMEDIATE v_sql USING 'FLOW_WORK', v_flow_run_id;
            v_deleted := v_deleted + SQL%ROWCOUNT;
        END IF;
    END;
BEGIN
    delete_run_result_table('INIT$_TB_RULEVIOL_SYMBOLIC');
    delete_run_result_table('INIT$_TB_RULEVIOL_ASSOC');
    delete_run_result_table('INIT$_TB_RULEDISC_SYMBOLIC');
    delete_run_result_table('INIT$_TB_COLREL_LASSO_FEATURE');
    delete_run_result_table('INIT$_TB_COLREL_NETWORK_EDGE');
    delete_run_result_table('INIT$_TB_COLREL_NETWORK_NODE');
    delete_run_result_table('INIT$_TB_COLREL_SUMMARY');
    delete_run_result_table('INIT$_TB_COLREL_PAIR');
    delete_run_result_table('INIT$_TB_COLREL_NUM_SUMMARY');
    delete_run_result_table('INIT$_TB_COLREL_NUM_PAIR');
    delete_run_result_table('INIT$_TB_COLREL_CAT_SUMMARY');
    delete_run_result_table('INIT$_TB_COLREL_CAT_PAIR');
    delete_run_result_table('INIT$_TB_RULEDISC_ASSOC_SUM');
    delete_run_result_table('INIT$_TB_COLTYPE_RESULT');
    delete_run_result_table('INIT$_TB_API_RESULT');

    DELETE FROM "INIT$_TB_FLOW_WORK_NODE_RUN"
     WHERE FLOW_RUN_ID = v_flow_run_id;

    DELETE FROM "INIT$_TB_FLOW_WORK_RUN"
     WHERE FLOW_RUN_ID = v_flow_run_id;
END;

-- [MCOMMON_ANLY_WORK_RESULT_TABLE_COLUMNS]
SELECT COLUMN_NAME
  FROM ALL_TAB_COLUMNS
 WHERE OWNER = :owner
   AND TABLE_NAME = :tableName;

-- [MCOMMON_ANLY_WORK_TARGET_TABLE_COLUMN_COUNT]
SELECT COUNT(*) AS COLUMN_COUNT
  FROM ALL_TAB_COLUMNS
 WHERE OWNER = :owner
   AND TABLE_NAME = :tableName;

-- [MCOMMON_ANLY_WORK_TARGET_COLUMN_COMMENTS]
SELECT C.COLUMN_NAME
     , CC.COMMENTS AS COLUMN_COMMENT
  FROM ALL_TAB_COLUMNS C
  LEFT OUTER JOIN ALL_COL_COMMENTS CC
    ON CC.OWNER = C.OWNER
   AND CC.TABLE_NAME = C.TABLE_NAME
   AND CC.COLUMN_NAME = C.COLUMN_NAME
 WHERE C.OWNER = :owner
   AND C.TABLE_NAME = :tableName
 ORDER BY C.COLUMN_ID;

-- [MCOMMON_ANLY_WORK_SYMBOLIC_SAMPLE_CONTEXT]
SELECT *
  FROM (
        SELECT R.RUN_SOURCE_TYPE
             , R.RUN_ID
             , R.OWNER
             , R.TABLE_NAME
             , R.TARGET_COLUMN
             , R.RULE_ID
             , R.EXPRESSION
             , R.SCORE
             , R.COMPLEXITY
             , R.RANK_NO
             , R.SELECTED_YN
             , R.FEATURE_COLUMNS
             , R.METHOD
             , R.MESSAGE
          FROM {ruleObject} R
         WHERE R.RUN_SOURCE_TYPE = :runSourceType
           AND R.RUN_ID = :runId
           AND R.RULE_ID = :ruleId
           AND R.RUN_SOURCE_TYPE = 'FLOW_WORK'
           AND EXISTS (
                SELECT 1
                  FROM INIT$_TB_FLOW_WORK_RUN FR
                  JOIN INIT$_TB_FLOW_WORK F
                    ON F.FLOW_ID = FR.FLOW_ID
                  JOIN INIT$_TB_PROJECT P
                    ON P.PROJECT_ID = F.PROJECT_ID
                 WHERE FR.FLOW_RUN_ID = R.RUN_ID
                   AND F.MENU_CODE = :flowMenuCode
                   AND (:includeAllUsers = 'Y' OR P.USER_ID = :userId)
           )
         ORDER BY CASE WHEN R.SELECTED_YN = 'Y' THEN 0 ELSE 1 END
                , R.RANK_NO NULLS LAST
                , R.SCORE DESC NULLS LAST
       )
 WHERE ROWNUM = 1;

-- [MCOMMON_ANLY_WORK_SYMBOLIC_SAMPLE_COLUMN_TYPES]
SELECT COLUMN_NAME
     , DATA_TYPE
  FROM ALL_TAB_COLUMNS
 WHERE OWNER = :owner
   AND TABLE_NAME = :tableName
 ORDER BY COLUMN_ID;

-- [MCOMMON_ANLY_WORK_SYMBOLIC_SAMPLE_ROWS]
SELECT *
  FROM (
        SELECT /*+ NO_PARALLEL(T) */ {selectList}
          FROM {targetObject} T
         WHERE 1=1
{notNullFilter}
       )
 WHERE ROWNUM <= :sampleLimit;

-- [MCOMMON_ANLY_WORK_CONTINUOUS_TARGET_COLUMNS]
SELECT COLUMN_NAME
     , COLUMN_ID
  FROM "INIT$_TB_COLTYPE_FINAL"
 WHERE OWNER = :targetOwner
   AND TABLE_NAME = :targetTable
   AND COLUMN_NAME <> 'FILE_ROW_NO'
   AND TRIM(TYPE_GROUP_CODE) = 'CONTINUOUS'
 ORDER BY COLUMN_ID NULLS LAST
        , COLUMN_NAME;

-- [ML_ANALYSIS_CONTINUOUS_TARGET_COLUMNS]
SELECT COLUMN_NAME
  FROM "INIT$_TB_COLTYPE_FINAL"
 WHERE OWNER = :owner
   AND TABLE_NAME = :tableName
   AND COLUMN_NAME <> 'FILE_ROW_NO'
   AND TRIM(TYPE_GROUP_CODE) = 'CONTINUOUS'
 ORDER BY COLUMN_ID NULLS LAST
        , COLUMN_NAME;

-- [ML_ANALYSIS_RELATION_CLUSTER_NODES]
SELECT COLUMN_NAME
     , COLUMN_TYPE
     , CLUSTER_ID
     , DEGREE_COUNT
     , WEIGHTED_DEGREE
     , CENTRALITY_SCORE
     , SELECTED_YN
  FROM "INIT$_TB_COLREL_NETWORK_NODE"
 WHERE RUN_SOURCE_TYPE = :runSourceType
   AND RUN_ID = :runId
   AND OWNER = :owner
   AND TABLE_NAME = :tableName
 ORDER BY CLUSTER_ID NULLS LAST
        , CENTRALITY_SCORE DESC NULLS LAST
        , WEIGHTED_DEGREE DESC NULLS LAST
        , COLUMN_NAME;

-- [ML_ANALYSIS_INTEGRATED_TASK_SAVEPOINT]
SAVEPOINT INIT_INTEGRATED_TASK;

-- [ML_ANALYSIS_INTEGRATED_TASK_ROLLBACK]
ROLLBACK TO SAVEPOINT INIT_INTEGRATED_TASK;

-- [ML_ANALYSIS_ASSOC_RULE_MODEL_FOR_RUN]
SELECT MODEL_NAME
  FROM (
        SELECT MODEL_NAME
             , COUNT(*) AS RULE_COUNT
             , MAX(CREATE_DT) AS LAST_CREATE_DT
          FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
         WHERE RUN_SOURCE_TYPE = :runSourceType
           AND RUN_ID = :runId
           AND OWNER = :ruleOwner
           AND TARGET_OWNER = :targetOwner
           AND TARGET_TABLE = :targetTable
         GROUP BY MODEL_NAME
         ORDER BY LAST_CREATE_DT DESC NULLS LAST
                , RULE_COUNT DESC
                , MODEL_NAME
       )
 WHERE ROWNUM = 1;

-- [MCOMMON_ANLY_WORK_RELATION_REJECTED_PAIRS]
SELECT *
  FROM (
        SELECT COL_A
             , COL_B
             , COL_A_TYPE
             , COL_B_TYPE
             , RELATION_TYPE
             , METRIC_NAME
             , METRIC_VALUE
             , ABS_METRIC_VALUE
             , P_VALUE
             , ROW_COUNT
             , PASS_YN
             , CLUSTER_ID
          FROM (
                SELECT COL_A
                     , COL_B
                     , COL_A_TYPE
                     , COL_B_TYPE
                     , RELATION_TYPE
                     , METRIC_NAME
                     , METRIC_VALUE
                     , ABS_METRIC_VALUE
                     , P_VALUE
                     , ROW_COUNT
                     , PASS_YN
                     , CLUSTER_ID
                     , ROW_NUMBER() OVER (
                           PARTITION BY RELATION_TYPE, LEAST(COL_A, COL_B), GREATEST(COL_A, COL_B)
                           ORDER BY CASE WHEN PASS_YN = 'Y' THEN 0 ELSE 1 END
                                  , ABS_METRIC_VALUE DESC NULLS LAST
                                  , P_VALUE ASC NULLS LAST
                                  , COL_A
                                  , COL_B
                                  , METRIC_NAME
                       ) AS RN
                  FROM "INIT$_TB_COLREL_PAIR"
                 WHERE OWNER = :targetOwner
                   AND TABLE_NAME = :targetTable
                   AND (:runSourceType IS NULL OR (RUN_SOURCE_TYPE = :runSourceType AND RUN_ID = :runId))
               )
         WHERE RN = 1
           AND PASS_YN = 'N'
         ORDER BY ABS_METRIC_VALUE DESC NULLS LAST
                , P_VALUE ASC NULLS LAST
                , COL_A
                , COL_B
                , METRIC_NAME
       )
 WHERE ROWNUM <= :maxRows;

-- [MCOMMON_ANLY_WORK_MODEL_METADATA]
SELECT OWNER
     , MODEL_NAME
     , MINING_FUNCTION
     , ALGORITHM
     , CREATION_DATE
  FROM ALL_MINING_MODELS
 WHERE OWNER = :owner
   AND MODEL_NAME = :modelName;

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_OVERVIEW]
SELECT COUNT(*) AS TOTAL_RULES
     , SUM(CASE WHEN CONDITION_COUNT > 0 AND RESULT_COLUMN IS NOT NULL THEN 1 ELSE 0 END) AS MAPPED_RULES
     , SUM(CASE WHEN RESULT_HAS_VALUE_YN = 'N' THEN 1 ELSE 0 END) AS MISSING_RESULT_RULES
     , SUM(CASE
               WHEN RULE_CONFIDENCE IS NOT NULL
                AND (
                    (RULE_CONFIDENCE <= 1 AND RULE_CONFIDENCE < 0.999999)
                    OR (RULE_CONFIDENCE > 1 AND RULE_CONFIDENCE < 99.9999)
                )
               THEN 1 ELSE 0
           END) AS NON_PERFECT_CONF_RULES
     , MAX(MODEL_TYPE) AS MODEL_TYPE
     , MAX(RULE_SOURCE) AS RULE_SOURCE
     , AVG(RULE_SUPPORT) AS AVG_SUPPORT
     , AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE
     , AVG(RULE_LIFT) AS AVG_LIFT
     , MAX(RULE_SUPPORT) AS MAX_SUPPORT
     , MAX(RULE_CONFIDENCE) AS MAX_CONFIDENCE
     , MAX(RULE_LIFT) AS MAX_LIFT
  FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
 WHERE OWNER = :owner
   AND TARGET_OWNER = :targetOwner
   AND TARGET_TABLE = :targetTable
   AND MODEL_NAME = :modelName
   AND (:runSourceType IS NULL OR RUN_SOURCE_TYPE = :runSourceType)
   AND (:runId IS NULL OR RUN_ID = :runId);

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_DETECTION_OVERVIEW_FAST]
WITH DISPLAY_CANDIDATES AS
     (
      SELECT S.RULE_CONFIDENCE
           , S.RULE_LIFT
        FROM "INIT$_TB_RULEDISC_ASSOC_SUM" S
       WHERE 1=1
         AND S.RUN_SOURCE_TYPE = :runSourceType
         AND S.RUN_ID = :runId
         AND S.OWNER = :owner
         AND S.TARGET_OWNER = :targetOwner
         AND S.TARGET_TABLE = :targetTable
         AND S.MODEL_NAME = :modelName
         AND S.RESULT_HAS_VALUE_YN = 'Y'
         AND S.RESULT_COLUMN IS NOT NULL
         AND S.RESULT_VALUE IS NOT NULL
         AND S.CONDITION_TEXT IS NOT NULL
         AND (
             :confidenceScope = 'ALL'
             OR (
                 S.RULE_CONFIDENCE IS NOT NULL
                 AND (
                     (S.RULE_CONFIDENCE <= 1 AND S.RULE_CONFIDENCE < 0.999999)
                     OR (S.RULE_CONFIDENCE > 1 AND S.RULE_CONFIDENCE < 99.9999)
                 )
             )
         )
     )
   , COUNTS AS
     (
      SELECT COUNT(*) AS CANDIDATE_RULE_COUNT
           , NVL(SUM(CASE WHEN NVL(RULE_CONFIDENCE, 0) < :detectMinConfidence THEN 1 ELSE 0 END), 0) AS CONFIDENCE_CUTOFF_COUNT
           , NVL(SUM(CASE WHEN NVL(RULE_LIFT, 0) < :detectMinLift THEN 1 ELSE 0 END), 0) AS LIFT_CUTOFF_COUNT
           , NVL(SUM(CASE
                         WHEN NVL(RULE_CONFIDENCE, 0) >= :detectMinConfidence
                          AND NVL(RULE_LIFT, 0) >= :detectMinLift
                         THEN 1 ELSE 0
                     END), 0) AS DETECTABLE_RULE_COUNT
        FROM DISPLAY_CANDIDATES
     )
SELECT CANDIDATE_RULE_COUNT
     , CONFIDENCE_CUTOFF_COUNT
     , LIFT_CUTOFF_COUNT
     , LEAST(DETECTABLE_RULE_COUNT, :detectMaxRules) AS DETECTION_ELIGIBLE_RULE_COUNT
     , GREATEST(DETECTABLE_RULE_COUNT - :detectMaxRules, 0) AS MAX_RULES_CUTOFF_COUNT
     , CASE WHEN DETECTABLE_RULE_COUNT > 0 THEN 1 ELSE NULL END AS MIN_DETECTION_RN
     , CASE
           WHEN DETECTABLE_RULE_COUNT > 0 THEN LEAST(DETECTABLE_RULE_COUNT, :detectMaxRules)
           ELSE NULL
       END AS MAX_DETECTION_RN
  FROM COUNTS;

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_PROFILE_FAST]
SELECT GROUPING(CONDITION_COUNT) AS IS_TOTAL
     , CONDITION_COUNT
     , COUNT(*) AS TOTAL_RULES
     , COUNT(*) AS RULE_COUNT
     , SUM(CASE WHEN CONDITION_COUNT > 0 AND RESULT_COLUMN IS NOT NULL THEN 1 ELSE 0 END) AS MAPPED_RULES
     , SUM(CASE WHEN RESULT_HAS_VALUE_YN = 'N' THEN 1 ELSE 0 END) AS MISSING_RESULT_RULES
     , SUM(CASE
               WHEN RULE_CONFIDENCE IS NOT NULL
                AND (
                    (RULE_CONFIDENCE <= 1 AND RULE_CONFIDENCE < 0.999999)
                    OR (RULE_CONFIDENCE > 1 AND RULE_CONFIDENCE < 99.9999)
                )
               THEN 1 ELSE 0
           END) AS NON_PERFECT_CONF_RULES
     , MAX(MODEL_TYPE) AS MODEL_TYPE
     , MAX(RULE_SOURCE) AS RULE_SOURCE
     , AVG(RULE_SUPPORT) AS AVG_SUPPORT
     , AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE
     , AVG(RULE_LIFT) AS AVG_LIFT
     , MAX(RULE_SUPPORT) AS MAX_SUPPORT
     , MAX(RULE_CONFIDENCE) AS MAX_CONFIDENCE
     , MAX(RULE_LIFT) AS MAX_LIFT
  FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
 WHERE 1=1
   AND RUN_SOURCE_TYPE = :runSourceType
   AND RUN_ID = :runId
   AND OWNER = :owner
   AND TARGET_OWNER = :targetOwner
   AND TARGET_TABLE = :targetTable
   AND MODEL_NAME = :modelName
 GROUP BY GROUPING SETS (
          ()
        , (CONDITION_COUNT)
       )
 ORDER BY IS_TOTAL DESC
        , CONDITION_COUNT;

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_HIT_LIST_FAST]
WITH VIOLATION_BASE AS
     (
      SELECT V.RULE_ID
           , COUNT(*) AS VIOLATION_COUNT
           , COUNT(DISTINCT NVL(V.CASE_ID, V.CASE_ROWID)) AS VIOLATED_ROW_COUNT
           , AVG(V.VIOLATION_SCORE) AS AVG_VIOLATION_SCORE
        FROM "INIT$_TB_RULEVIOL_ASSOC" V
       WHERE 1=1
         AND V.RUN_SOURCE_TYPE = :runSourceType
         AND V.RUN_ID = :runId
         AND V.TARGET_OWNER = :targetOwner
         AND V.TARGET_TABLE = :targetTable
         AND V.MODEL_NAME = :modelName
         AND (:conditionCount IS NULL OR V.CONDITION_COUNT = :conditionCount)
         AND (
             :confidenceScope = 'ALL'
             OR (
                 V.RULE_CONFIDENCE IS NOT NULL
                 AND (
                     (V.RULE_CONFIDENCE <= 1 AND V.RULE_CONFIDENCE < 0.999999)
                     OR (V.RULE_CONFIDENCE > 1 AND V.RULE_CONFIDENCE < 99.9999)
                 )
             )
         )
         AND (:ruleIdFilter IS NULL OR UPPER(V.RULE_ID) LIKE '%' || UPPER(:ruleIdFilter) || '%')
       GROUP BY V.RULE_ID
     )
   , RANKED_RULES AS
     (
      SELECT S.OWNER AS RULE_OWNER
           , S.MODEL_NAME
           , S.RUN_SOURCE_TYPE
           , S.RUN_ID
           , S.RULE_ID
           , S.CONDITION_COUNT
           , DBMS_LOB.SUBSTR(S.CONDITION_TEXT, 4000, 1) AS CONDITION_TEXT
           , S.RESULT_COLUMN
           , DBMS_LOB.SUBSTR(TO_CLOB(S.RESULT_VALUE), 4000, 1) AS EXPECTED_VALUE
           , V.VIOLATION_COUNT
           , V.VIOLATED_ROW_COUNT
           , V.AVG_VIOLATION_SCORE
           , CAST(NULL AS NUMBER) AS DETECTION_RN
           , 'Y' AS DETECTION_SCANNED_YN
           , S.RULE_SUPPORT
           , S.RULE_CONFIDENCE
           , S.RULE_LIFT
           , ROW_NUMBER() OVER (
                 ORDER BY V.VIOLATION_COUNT DESC
                        , S.CONDITION_COUNT DESC NULLS LAST
                        , V.AVG_VIOLATION_SCORE DESC NULLS LAST
                        , S.RULE_CONFIDENCE DESC NULLS LAST
                        , S.RULE_LIFT DESC NULLS LAST
                        , S.RULE_ID
             ) AS RN__
           , COUNT(*) OVER () AS TOTAL_COUNT
        FROM "INIT$_TB_RULEDISC_ASSOC_SUM" S
        JOIN VIOLATION_BASE V
          ON V.RULE_ID = S.RULE_ID
       WHERE 1=1
         AND S.RUN_SOURCE_TYPE = :runSourceType
         AND S.RUN_ID = :runId
         AND S.OWNER = :owner
         AND S.TARGET_OWNER = :targetOwner
         AND S.TARGET_TABLE = :targetTable
         AND S.MODEL_NAME = :modelName
         AND S.RESULT_HAS_VALUE_YN = 'Y'
         AND S.RESULT_COLUMN IS NOT NULL
         AND S.RESULT_VALUE IS NOT NULL
         AND S.CONDITION_TEXT IS NOT NULL
         AND (:conditionCount IS NULL OR S.CONDITION_COUNT = :conditionCount)
         AND (
             :confidenceScope = 'ALL'
             OR (
                 S.RULE_CONFIDENCE IS NOT NULL
                 AND (
                     (S.RULE_CONFIDENCE <= 1 AND S.RULE_CONFIDENCE < 0.999999)
                     OR (S.RULE_CONFIDENCE > 1 AND S.RULE_CONFIDENCE < 99.9999)
                 )
             )
         )
         AND (:ruleIdFilter IS NULL OR UPPER(S.RULE_ID) LIKE '%' || UPPER(:ruleIdFilter) || '%')
     )
SELECT RULE_OWNER
     , MODEL_NAME
     , RUN_SOURCE_TYPE
     , RUN_ID
     , RULE_ID
     , CONDITION_COUNT
     , CONDITION_TEXT
     , RESULT_COLUMN
     , EXPECTED_VALUE
     , VIOLATION_COUNT
     , VIOLATED_ROW_COUNT
     , AVG_VIOLATION_SCORE
     , DETECTION_RN
     , DETECTION_SCANNED_YN
     , RULE_SUPPORT
     , RULE_CONFIDENCE
     , RULE_LIFT
     , RN__
     , TOTAL_COUNT
  FROM RANKED_RULES
 WHERE RN__ > :ruleOffset
   AND RN__ <= :ruleEndRow
 ORDER BY RN__;

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_CONDITION_DIST]
SELECT CONDITION_COUNT
     , COUNT(*) AS RULE_COUNT
     , SUM(CASE
               WHEN RULE_CONFIDENCE IS NOT NULL
                AND (
                    (RULE_CONFIDENCE <= 1 AND RULE_CONFIDENCE < 0.999999)
                    OR (RULE_CONFIDENCE > 1 AND RULE_CONFIDENCE < 99.9999)
                )
               THEN 1 ELSE 0
           END) AS NON_PERFECT_CONF_RULES
     , AVG(RULE_SUPPORT) AS AVG_SUPPORT
     , AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE
     , AVG(RULE_LIFT) AS AVG_LIFT
  FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
 WHERE OWNER = :owner
   AND TARGET_OWNER = :targetOwner
   AND TARGET_TABLE = :targetTable
   AND MODEL_NAME = :modelName
   AND (:runSourceType IS NULL OR RUN_SOURCE_TYPE = :runSourceType)
   AND (:runId IS NULL OR RUN_ID = :runId)
 GROUP BY CONDITION_COUNT
 ORDER BY CONDITION_COUNT;

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_RESULT_TOP]
SELECT *
  FROM (
        SELECT Q.*
             , ROW_NUMBER() OVER (ORDER BY Q.RULE_COUNT DESC, Q.RESULT_COLUMN) AS RN__
             , COUNT(*) OVER () AS TOTAL_COUNT
          FROM (
                SELECT NVL(RESULT_COLUMN, '(RESULT UNKNOWN)') AS RESULT_COLUMN
                     , COUNT(*) AS RULE_COUNT
                     , SUM(CASE WHEN RESULT_HAS_VALUE_YN = 'Y' THEN 1 ELSE 0 END) AS VALUE_RULE_COUNT
                     , SUM(SUPPORT_COUNT) AS SUPPORT_COUNT
                     , AVG(RULE_CONFIDENCE) AS AVG_CONFIDENCE
                     , AVG(RULE_LIFT) AS AVG_LIFT
                 FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
                 WHERE OWNER = :owner
                   AND TARGET_OWNER = :targetOwner
                   AND TARGET_TABLE = :targetTable
                   AND MODEL_NAME = :modelName
                   AND (:runSourceType IS NULL OR RUN_SOURCE_TYPE = :runSourceType)
                   AND (:runId IS NULL OR RUN_ID = :runId)
                 GROUP BY NVL(RESULT_COLUMN, '(RESULT UNKNOWN)')
               ) Q
       )
 WHERE RN__ > :resultOffset
   AND RN__ <= :resultEndRow
 ORDER BY RN__;

-- [MCOMMON_ANLY_WORK_ASSOC_RULE_DETAIL_LIST]
SELECT *
  FROM (
        SELECT Q.*
             , ROW_NUMBER() OVER (ORDER BY Q.RULE_CONFIDENCE DESC NULLS LAST, Q.RULE_LIFT DESC NULLS LAST, Q.RULE_SUPPORT DESC NULLS LAST, Q.RULE_ID) AS RN__
             , COUNT(*) OVER () AS TOTAL_COUNT
          FROM (
                SELECT OWNER
                     , TARGET_OWNER
                     , TARGET_TABLE
                     , MODEL_NAME
                     , RULE_ID
                     , MODEL_TYPE
                     , RULE_SOURCE
                     , CONDITION_COUNT
                     , CONDITION_COLUMN
                     , CONDITION_VALUE
                     , RESULT_COLUMN
                     , RESULT_VALUE
                     , RESULT_HAS_VALUE_YN
                     , RULE_SUPPORT
                     , RULE_CONFIDENCE
                     , RULE_LIFT
                     , SUPPORT_COUNT
                     , CONDITION_TOTAL_COUNT
                     , RESULT_TOTAL_COUNT
                     , TOTAL_COUNT AS RULE_TOTAL_COUNT
                     , CONDITION_TEXT
                     , RESULT_TEXT
                     , CREATE_DT
                 FROM "INIT$_TB_RULEDISC_ASSOC_SUM"
                 WHERE OWNER = :owner
                   AND TARGET_OWNER = :targetOwner
                   AND TARGET_TABLE = :targetTable
                   AND MODEL_NAME = :modelName
                   AND (:runSourceType IS NULL OR RUN_SOURCE_TYPE = :runSourceType)
                   AND (:runId IS NULL OR RUN_ID = :runId)
                   AND (:conditionCount IS NULL OR CONDITION_COUNT = :conditionCount)
                   AND (
                        :resultColumn IS NULL
                        OR (:resultColumn = '__NULL__' AND RESULT_COLUMN IS NULL)
                        OR RESULT_COLUMN = :resultColumn
                   )
                   AND (
                        :conditionColumn IS NULL
                        OR (:conditionColumn = '__NULL__' AND CONDITION_COLUMN IS NULL)
                        OR CONDITION_COLUMN = :conditionColumn
                   )
                   AND (:resultHasValueYn IS NULL OR RESULT_HAS_VALUE_YN = :resultHasValueYn)
                   AND (
                        :confidenceScope <> 'NON_PERFECT'
                        OR (
                            RULE_CONFIDENCE IS NOT NULL
                            AND (
                                (RULE_CONFIDENCE <= 1 AND RULE_CONFIDENCE < 0.999999)
                                OR (RULE_CONFIDENCE > 1 AND RULE_CONFIDENCE < 99.9999)
                            )
                        )
                   )
               ) Q
       )
 WHERE RN__ > :offset
   AND RN__ <= :endRow
 ORDER BY RN__;

