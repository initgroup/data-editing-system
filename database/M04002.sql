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
