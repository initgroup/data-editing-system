-- [M90001_OBJECT_TREE]
-- M90001 DB object tree from Oracle dictionary views.
WITH
USER_OWNERS AS (
    SELECT USERNAME AS OWNER
      FROM ALL_USERS
     WHERE ORACLE_MAINTAINED = 'N'
       AND USERNAME NOT IN ('SYS', 'SYSTEM', 'XDB', 'CTXSYS', 'MDSYS', 'ORDSYS', 'OUTLN')
),
ML_PACKAGE_ALLOWLIST AS (
    SELECT 'DBMS_DATA_MINING' AS OBJECT_NAME FROM DUAL
    UNION ALL SELECT 'DBMS_DATA_MINING_TRANSFORM' FROM DUAL
    UNION ALL SELECT 'DBMS_PREDICTIVE_ANALYTICS' FROM DUAL
),
PLSQL_OBJECTS AS (
    SELECT
        O.OWNER,
        O.OBJECT_TYPE,
        O.OBJECT_NAME,
        CASE
            WHEN ML.OBJECT_NAME IS NOT NULL
              OR UPPER(O.OBJECT_NAME) LIKE '%ML%'
              OR UPPER(O.OBJECT_NAME) LIKE '%MINING%'
              OR UPPER(O.OBJECT_NAME) LIKE '%MACHINE_LEARNING%' THEN 'Y'
            ELSE 'N'
        END AS IS_ML_PACKAGE
      FROM ALL_OBJECTS O
      LEFT JOIN USER_OWNERS U
        ON U.OWNER = O.OWNER
      LEFT JOIN ML_PACKAGE_ALLOWLIST ML
        ON ML.OBJECT_NAME = O.OBJECT_NAME
     WHERE O.OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION', 'PACKAGE')
       AND O.GENERATED = 'N'
       AND O.OBJECT_NAME NOT LIKE 'BIN$%'
       AND (
              U.OWNER IS NOT NULL
           OR (O.OWNER = 'SYS' AND ML.OBJECT_NAME IS NOT NULL)
       )
),
MINING_MODELS AS (
    SELECT
        M.OWNER,
        M.MODEL_NAME,
        M.MINING_FUNCTION,
        M.ALGORITHM
      FROM ALL_MINING_MODELS M
      JOIN USER_OWNERS U
        ON U.OWNER = M.OWNER
),
OWNER_LIST AS (
    SELECT OWNER
      FROM ALL_TABLES
     WHERE OWNER IN (SELECT OWNER FROM USER_OWNERS)
       AND TABLE_NAME NOT LIKE 'BIN$%'
       AND NESTED = 'NO'
       AND SECONDARY = 'N'
    UNION
    SELECT OWNER
      FROM PLSQL_OBJECTS
    UNION
    SELECT OWNER
      FROM MINING_MODELS
),
TREE_ROWS AS (
    SELECT
        OWNER,
        'OWNER' AS OBJECT_TYPE,
        OWNER AS OBJECT_NAME,
        OWNER AS OBJECT_LABEL,
        'OWNER:' || OWNER AS NODE_ID,
        CAST(NULL AS VARCHAR2(4000)) AS PARENT_ID,
        1 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'ALL' AS CATEGORY_CODE,
        OWNER AS SORT_OWNER,
        10 AS SORT_GROUP,
        OWNER AS SORT_NAME
      FROM OWNER_LIST
    UNION ALL
    SELECT
        OWNER,
        'GROUP' AS OBJECT_TYPE,
        'Procedures / Functions' AS OBJECT_NAME,
        'Procedures / Functions' AS OBJECT_LABEL,
        'GROUP:' || OWNER || ':PROCEDURES' AS NODE_ID,
        'OWNER:' || OWNER AS PARENT_ID,
        2 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'PLSQL' AS CATEGORY_CODE,
        OWNER AS SORT_OWNER,
        30 AS SORT_GROUP,
        'Procedures / Functions' AS SORT_NAME
      FROM OWNER_LIST
     WHERE EXISTS (
        SELECT 1
          FROM PLSQL_OBJECTS O
         WHERE O.OWNER = OWNER_LIST.OWNER
           AND O.OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
           AND O.IS_ML_PACKAGE = 'N'
     )
    UNION ALL
    SELECT
        O.OWNER,
        O.OBJECT_TYPE AS OBJECT_TYPE,
        O.OBJECT_NAME AS OBJECT_NAME,
        O.OBJECT_NAME AS OBJECT_LABEL,
        O.OBJECT_TYPE || ':' || O.OWNER || ':' || O.OBJECT_NAME AS NODE_ID,
        'GROUP:' || O.OWNER || ':PROCEDURES' AS PARENT_ID,
        3 AS LEVEL_NO,
        'Y' AS IS_SELECTABLE,
        'PLSQL' AS CATEGORY_CODE,
        O.OWNER AS SORT_OWNER,
        31 AS SORT_GROUP,
        O.OBJECT_NAME AS SORT_NAME
      FROM PLSQL_OBJECTS O
     WHERE O.OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
       AND O.IS_ML_PACKAGE = 'N'
    UNION ALL
    SELECT
        OWNER,
        'GROUP' AS OBJECT_TYPE,
        'Packages' AS OBJECT_NAME,
        'Packages' AS OBJECT_LABEL,
        'GROUP:' || OWNER || ':PACKAGES' AS NODE_ID,
        'OWNER:' || OWNER AS PARENT_ID,
        2 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'PACKAGE' AS CATEGORY_CODE,
        OWNER AS SORT_OWNER,
        40 AS SORT_GROUP,
        'Packages' AS SORT_NAME
      FROM OWNER_LIST
     WHERE EXISTS (
        SELECT 1
         FROM PLSQL_OBJECTS O
         WHERE O.OWNER = OWNER_LIST.OWNER
           AND O.OBJECT_TYPE = 'PACKAGE'
           AND O.IS_ML_PACKAGE = 'N'
           AND EXISTS (
                SELECT 1
                  FROM ALL_PROCEDURES P
                 WHERE P.OWNER = O.OWNER
                   AND P.OBJECT_NAME = O.OBJECT_NAME
                   AND P.PROCEDURE_NAME IS NOT NULL
           )
     )
    UNION ALL
    SELECT
        O.OWNER,
        'PACKAGE' AS OBJECT_TYPE,
        O.OBJECT_NAME AS OBJECT_NAME,
        O.OBJECT_NAME AS OBJECT_LABEL,
        'PACKAGE:' || O.OWNER || ':' || O.OBJECT_NAME AS NODE_ID,
        'GROUP:' || O.OWNER || ':PACKAGES' AS PARENT_ID,
        3 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'PACKAGE' AS CATEGORY_CODE,
        O.OWNER AS SORT_OWNER,
        41 AS SORT_GROUP,
        O.OBJECT_NAME AS SORT_NAME
      FROM PLSQL_OBJECTS O
     WHERE O.OBJECT_TYPE = 'PACKAGE'
       AND O.IS_ML_PACKAGE = 'N'
       AND EXISTS (
            SELECT 1
              FROM ALL_PROCEDURES P
             WHERE P.OWNER = O.OWNER
               AND P.OBJECT_NAME = O.OBJECT_NAME
               AND P.PROCEDURE_NAME IS NOT NULL
       )
    UNION ALL
    SELECT
        P.OWNER,
        CASE
            WHEN EXISTS (
                SELECT 1
                  FROM ALL_ARGUMENTS A
                 WHERE A.OWNER = P.OWNER
                   AND A.PACKAGE_NAME = P.OBJECT_NAME
                   AND A.OBJECT_NAME = P.PROCEDURE_NAME
                   AND A.POSITION = 0
            ) THEN 'PACKAGE_FUNCTION'
            ELSE 'PACKAGE_PROCEDURE'
        END AS OBJECT_TYPE,
        P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS OBJECT_NAME,
        P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS OBJECT_LABEL,
        'PACKAGE_MEMBER:' || P.OWNER || ':' || P.OBJECT_NAME || ':' || P.PROCEDURE_NAME AS NODE_ID,
        'PACKAGE:' || P.OWNER || ':' || P.OBJECT_NAME AS PARENT_ID,
        4 AS LEVEL_NO,
        'Y' AS IS_SELECTABLE,
        'PACKAGE' AS CATEGORY_CODE,
        P.OWNER AS SORT_OWNER,
        41 AS SORT_GROUP,
        P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS SORT_NAME
      FROM ALL_PROCEDURES P
      JOIN PLSQL_OBJECTS O
        ON O.OWNER = P.OWNER
       AND O.OBJECT_NAME = P.OBJECT_NAME
       AND O.OBJECT_TYPE = 'PACKAGE'
       AND O.IS_ML_PACKAGE = 'N'
     WHERE P.PROCEDURE_NAME IS NOT NULL
       AND (
              :includePackageMembers = 'Y'
           OR EXISTS (
                SELECT 1
                  FROM INIT$_TB_OBJECT M
                 WHERE M.OWNER = P.OWNER
                   AND M.OBJECT_NAME = P.OBJECT_NAME || '.' || P.PROCEDURE_NAME
                   AND M.OBJECT_TYPE IN ('PACKAGE_PROCEDURE', 'PACKAGE_FUNCTION')
           )
       )
    UNION ALL
    SELECT
        OWNER,
        'GROUP' AS OBJECT_TYPE,
        'Machine Learning Packages' AS OBJECT_NAME,
        'Machine Learning Packages' AS OBJECT_LABEL,
        'GROUP:' || OWNER || ':ML_PACKAGES' AS NODE_ID,
        'OWNER:' || OWNER AS PARENT_ID,
        2 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'ML_PACKAGE' AS CATEGORY_CODE,
        OWNER AS SORT_OWNER,
        50 AS SORT_GROUP,
        'Machine Learning Packages' AS SORT_NAME
      FROM OWNER_LIST
     WHERE EXISTS (
        SELECT 1
         FROM PLSQL_OBJECTS O
         WHERE O.OWNER = OWNER_LIST.OWNER
           AND O.OBJECT_TYPE = 'PACKAGE'
           AND O.IS_ML_PACKAGE = 'Y'
           AND EXISTS (
                SELECT 1
                  FROM ALL_PROCEDURES P
                 WHERE P.OWNER = O.OWNER
                   AND P.OBJECT_NAME = O.OBJECT_NAME
                   AND P.PROCEDURE_NAME IS NOT NULL
           )
     )
    UNION ALL
    SELECT
        O.OWNER,
        'PACKAGE' AS OBJECT_TYPE,
        O.OBJECT_NAME AS OBJECT_NAME,
        O.OBJECT_NAME AS OBJECT_LABEL,
        'PACKAGE:' || O.OWNER || ':' || O.OBJECT_NAME AS NODE_ID,
        'GROUP:' || O.OWNER || ':ML_PACKAGES' AS PARENT_ID,
        3 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'ML_PACKAGE' AS CATEGORY_CODE,
        O.OWNER AS SORT_OWNER,
        51 AS SORT_GROUP,
        O.OBJECT_NAME AS SORT_NAME
      FROM PLSQL_OBJECTS O
     WHERE O.OBJECT_TYPE = 'PACKAGE'
       AND O.IS_ML_PACKAGE = 'Y'
       AND EXISTS (
            SELECT 1
              FROM ALL_PROCEDURES P
             WHERE P.OWNER = O.OWNER
               AND P.OBJECT_NAME = O.OBJECT_NAME
               AND P.PROCEDURE_NAME IS NOT NULL
       )
    UNION ALL
    SELECT
        P.OWNER,
        CASE
            WHEN EXISTS (
                SELECT 1
                  FROM ALL_ARGUMENTS A
                 WHERE A.OWNER = P.OWNER
                   AND A.PACKAGE_NAME = P.OBJECT_NAME
                   AND A.OBJECT_NAME = P.PROCEDURE_NAME
                   AND A.POSITION = 0
            ) THEN 'PACKAGE_FUNCTION'
            ELSE 'PACKAGE_PROCEDURE'
        END AS OBJECT_TYPE,
        P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS OBJECT_NAME,
        P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS OBJECT_LABEL,
        'PACKAGE_MEMBER:' || P.OWNER || ':' || P.OBJECT_NAME || ':' || P.PROCEDURE_NAME AS NODE_ID,
        'PACKAGE:' || P.OWNER || ':' || P.OBJECT_NAME AS PARENT_ID,
        4 AS LEVEL_NO,
        'Y' AS IS_SELECTABLE,
        'ML_PACKAGE' AS CATEGORY_CODE,
        P.OWNER AS SORT_OWNER,
        51 AS SORT_GROUP,
        P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS SORT_NAME
      FROM ALL_PROCEDURES P
      JOIN PLSQL_OBJECTS O
        ON O.OWNER = P.OWNER
       AND O.OBJECT_NAME = P.OBJECT_NAME
       AND O.OBJECT_TYPE = 'PACKAGE'
       AND O.IS_ML_PACKAGE = 'Y'
     WHERE P.PROCEDURE_NAME IS NOT NULL
       AND (
              :includePackageMembers = 'Y'
           OR EXISTS (
                SELECT 1
                  FROM INIT$_TB_OBJECT M
                 WHERE M.OWNER = P.OWNER
                   AND M.OBJECT_NAME = P.OBJECT_NAME || '.' || P.PROCEDURE_NAME
                   AND M.OBJECT_TYPE IN ('PACKAGE_PROCEDURE', 'PACKAGE_FUNCTION')
           )
       )
    UNION ALL
    SELECT
        OWNER,
        'GROUP' AS OBJECT_TYPE,
        'Models' AS OBJECT_NAME,
        'Models' AS OBJECT_LABEL,
        'GROUP:' || OWNER || ':MODELS' AS NODE_ID,
        'OWNER:' || OWNER AS PARENT_ID,
        2 AS LEVEL_NO,
        'N' AS IS_SELECTABLE,
        'MODEL' AS CATEGORY_CODE,
        OWNER AS SORT_OWNER,
        60 AS SORT_GROUP,
        'Models' AS SORT_NAME
      FROM OWNER_LIST
     WHERE EXISTS (
        SELECT 1
          FROM MINING_MODELS M
         WHERE M.OWNER = OWNER_LIST.OWNER
     )
    UNION ALL
    SELECT
        M.OWNER,
        'MINING_MODEL' AS OBJECT_TYPE,
        M.MODEL_NAME AS OBJECT_NAME,
        M.MODEL_NAME || NVL2(M.MINING_FUNCTION, ' (' || M.MINING_FUNCTION || ')', '') AS OBJECT_LABEL,
        'MINING_MODEL:' || M.OWNER || ':' || M.MODEL_NAME AS NODE_ID,
        'GROUP:' || M.OWNER || ':MODELS' AS PARENT_ID,
        3 AS LEVEL_NO,
        'Y' AS IS_SELECTABLE,
        'MODEL' AS CATEGORY_CODE,
        M.OWNER AS SORT_OWNER,
        61 AS SORT_GROUP,
        M.MODEL_NAME AS SORT_NAME
      FROM MINING_MODELS M
),
JOINED_ROWS AS (
    SELECT
        R.OWNER,
        R.OBJECT_TYPE,
        R.OBJECT_NAME,
        R.OBJECT_LABEL,
        R.NODE_ID,
        R.PARENT_ID,
        R.LEVEL_NO,
        R.IS_SELECTABLE,
        R.CATEGORY_CODE,
        CASE
            WHEN M.OBJECT_ID IS NOT NULL THEN 'Y'
            ELSE 'N'
        END AS IS_REGISTERED,
        R.SORT_OWNER,
        R.SORT_GROUP,
        R.SORT_NAME
      FROM TREE_ROWS R
      LEFT JOIN INIT$_TB_OBJECT M
        ON M.OWNER = R.OWNER
       AND M.OBJECT_TYPE = R.OBJECT_TYPE
       AND M.OBJECT_NAME = R.OBJECT_NAME
),
CHILD_COUNTS AS (
    SELECT
        PARENT_ID,
        COUNT(*) AS CHILD_COUNT
      FROM JOINED_ROWS
     WHERE PARENT_ID IS NOT NULL
       AND (
              :registeredOnly = 'N'
           OR IS_REGISTERED = 'Y'
       )
     GROUP BY PARENT_ID
),
FILTERED_ROWS AS (
    SELECT
        J.*,
        CASE
            WHEN J.OBJECT_TYPE = 'GROUP' THEN NVL(CC.CHILD_COUNT, 0)
            ELSE NULL
        END AS CHILD_COUNT
      FROM JOINED_ROWS J
      LEFT JOIN CHILD_COUNTS CC
        ON CC.PARENT_ID = J.NODE_ID
     WHERE (
              :registeredOnly = 'N'
           OR J.IS_REGISTERED = 'Y'
           OR (
                J.OBJECT_TYPE = 'OWNER'
                AND EXISTS (
                    SELECT 1
                      FROM JOINED_ROWS C
                     WHERE C.OWNER = J.OWNER
                       AND C.IS_REGISTERED = 'Y'
                       AND (
                              :categoryFilter = 'ALL'
                           OR INSTR(',' || :categoryFilter || ',', ',' || C.CATEGORY_CODE || ',') > 0
                       )
                )
            )
           OR (
                J.OBJECT_TYPE = 'GROUP'
                AND EXISTS (
                    SELECT 1
                      FROM JOINED_ROWS C
                     WHERE C.PARENT_ID = J.NODE_ID
                       AND C.IS_REGISTERED = 'Y'
                       AND (
                              :categoryFilter = 'ALL'
                           OR INSTR(',' || :categoryFilter || ',', ',' || C.CATEGORY_CODE || ',') > 0
                       )
                )
            )
           OR (
                J.OBJECT_TYPE = 'PACKAGE'
                AND J.IS_SELECTABLE = 'N'
                AND EXISTS (
                    SELECT 1
                      FROM JOINED_ROWS C
                     WHERE C.PARENT_ID = J.NODE_ID
                       AND C.IS_REGISTERED = 'Y'
                       AND (
                              :categoryFilter = 'ALL'
                           OR INSTR(',' || :categoryFilter || ',', ',' || C.CATEGORY_CODE || ',') > 0
                       )
                )
            )
          )
       AND (
              :categoryFilter = 'ALL'
           OR INSTR(',' || :categoryFilter || ',', ',' || J.CATEGORY_CODE || ',') > 0
           OR (
                J.OBJECT_TYPE = 'OWNER'
                AND EXISTS (
                    SELECT 1
                      FROM JOINED_ROWS C
                     WHERE C.OWNER = J.OWNER
                      AND INSTR(',' || :categoryFilter || ',', ',' || C.CATEGORY_CODE || ',') > 0
                )
            )
          )
       AND (
              :keyword IS NULL
           OR (
                J.IS_SELECTABLE = 'Y'
                AND (
                       UPPER(J.OWNER) LIKE :keyword
                    OR UPPER(J.OBJECT_TYPE) LIKE :keyword
                    OR UPPER(J.OBJECT_NAME) LIKE :keyword
                    OR UPPER(J.OBJECT_LABEL) LIKE :keyword
                )
            )
          )
),
ORDERED_ROWS AS (
    SELECT
        OWNER,
        OBJECT_TYPE,
        OBJECT_NAME,
        OBJECT_LABEL,
        NODE_ID,
        PARENT_ID,
        LEVEL_NO,
        IS_SELECTABLE,
        IS_REGISTERED,
        CHILD_COUNT,
        ROW_NUMBER() OVER (ORDER BY SORT_OWNER, SORT_GROUP, SORT_NAME) AS RN
      FROM FILTERED_ROWS
)
SELECT OWNER, OBJECT_TYPE, OBJECT_NAME, OBJECT_LABEL, NODE_ID, PARENT_ID, LEVEL_NO, IS_SELECTABLE, IS_REGISTERED, CHILD_COUNT
  FROM ORDERED_ROWS
 WHERE RN > :offset
   AND RN <= :endRow
 ORDER BY RN
;

-- [M90001_PACKAGE_MEMBERS]
-- Lazy-loaded package procedures/functions for a selected package node.
SELECT
    P.OWNER,
    CASE
        WHEN EXISTS (
            SELECT 1
              FROM ALL_ARGUMENTS A
             WHERE A.OWNER = P.OWNER
               AND A.PACKAGE_NAME = P.OBJECT_NAME
               AND A.OBJECT_NAME = P.PROCEDURE_NAME
               AND A.POSITION = 0
        ) THEN 'PACKAGE_FUNCTION'
        ELSE 'PACKAGE_PROCEDURE'
    END AS OBJECT_TYPE,
    P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS OBJECT_NAME,
    P.OBJECT_NAME || '.' || P.PROCEDURE_NAME AS OBJECT_LABEL,
    'PACKAGE_MEMBER:' || P.OWNER || ':' || P.OBJECT_NAME || ':' || P.PROCEDURE_NAME AS NODE_ID,
    'PACKAGE:' || P.OWNER || ':' || P.OBJECT_NAME AS PARENT_ID,
    4 AS LEVEL_NO,
    'Y' AS IS_SELECTABLE,
    CASE
        WHEN M.OBJECT_ID IS NOT NULL THEN 'Y'
        ELSE 'N'
    END AS IS_REGISTERED,
    CAST(NULL AS NUMBER) AS CHILD_COUNT
  FROM ALL_PROCEDURES P
  LEFT JOIN INIT$_TB_OBJECT M
    ON M.OWNER = P.OWNER
   AND M.OBJECT_NAME = P.OBJECT_NAME || '.' || P.PROCEDURE_NAME
   AND M.OBJECT_TYPE IN ('PACKAGE_PROCEDURE', 'PACKAGE_FUNCTION')
 WHERE P.OWNER = :owner
   AND P.OBJECT_NAME = :packageName
   AND P.PROCEDURE_NAME IS NOT NULL
   AND (
          :registeredOnly = 'N'
       OR M.OBJECT_ID IS NOT NULL
   )
 ORDER BY P.PROCEDURE_NAME
;

-- [M90001_OBJECT_META]
-- Object master metadata. Saved values are preferred; dictionary comments are used as editable defaults.
WITH DICT_META AS (
    SELECT
        :owner AS OWNER,
        :objectType AS OBJECT_TYPE,
        :objectName AS OBJECT_NAME,
        CASE
            WHEN :objectType = 'TABLE' THEN (
                SELECT COMMENTS
                  FROM ALL_TAB_COMMENTS
                 WHERE OWNER = :owner
                   AND TABLE_NAME = :objectName
            )
            WHEN :objectType IN ('PACKAGE_PROCEDURE', 'PACKAGE_FUNCTION') THEN (
                SELECT 'PACKAGE=' || REGEXP_SUBSTR(:objectName, '^[^.]+')
                    || ', MEMBER=' || REGEXP_SUBSTR(:objectName, '[^.]+$', 1, 1)
                  FROM DUAL
            )
            WHEN :objectType = 'MINING_MODEL' THEN (
                SELECT 'MINING_FUNCTION=' || MINING_FUNCTION
                    || NVL2(ALGORITHM, ', ALGORITHM=' || ALGORITHM, '')
                  FROM ALL_MINING_MODELS
                 WHERE OWNER = :owner
                   AND MODEL_NAME = :objectName
                   AND ROWNUM = 1
            )
            ELSE (
                SELECT 'STATUS=' || STATUS || ', CREATED=' || TO_CHAR(CREATED, 'YYYY-MM-DD HH24:MI:SS')
                  FROM ALL_OBJECTS
                 WHERE OWNER = :owner
                   AND OBJECT_NAME = :objectName
                   AND OBJECT_TYPE = :objectType
                   AND ROWNUM = 1
            )
        END AS DICTIONARY_COMMENT
      FROM DUAL
)
SELECT
    M.OBJECT_ID,
    D.OWNER,
    COALESCE(M.OBJECT_TYPE, D.OBJECT_TYPE) AS OBJECT_TYPE,
    COALESCE(M.OBJECT_NAME, D.OBJECT_NAME) AS OBJECT_NAME,
    COALESCE(M.OBJECT_LABEL, D.OBJECT_NAME) AS OBJECT_LABEL,
    COALESCE(M.DESCRIPTION, D.DICTIONARY_COMMENT, D.OBJECT_NAME) AS DESCRIPTION,
    COALESCE(M.USE_YN, 'Y') AS USE_YN,
    COALESCE(M.SORT_ORDER, 0) AS SORT_ORDER,
    D.DICTIONARY_COMMENT
  FROM DICT_META D
  LEFT JOIN INIT$_TB_OBJECT M
    ON M.OWNER = D.OWNER
   AND M.OBJECT_TYPE = D.OBJECT_TYPE
   AND M.OBJECT_NAME = D.OBJECT_NAME
;

-- [M90001_OBJECT_UPSERT]
-- Insert or update object master metadata before saving detail rows.
MERGE INTO INIT$_TB_OBJECT T
USING (
    SELECT
        :owner AS OWNER,
        :objectType AS OBJECT_TYPE,
        :objectName AS OBJECT_NAME,
        :objectLabel AS OBJECT_LABEL,
        :description AS DESCRIPTION,
        :useYn AS USE_YN,
        :sortOrder AS SORT_ORDER
      FROM DUAL
) S
ON (
       T.OWNER = S.OWNER
   AND T.OBJECT_TYPE = S.OBJECT_TYPE
   AND T.OBJECT_NAME = S.OBJECT_NAME
)
WHEN MATCHED THEN
    UPDATE SET
        T.OBJECT_LABEL = S.OBJECT_LABEL,
        T.DESCRIPTION = S.DESCRIPTION,
        T.USE_YN = S.USE_YN,
        T.SORT_ORDER = S.SORT_ORDER,
        T.UPDATED_AT = SYSTIMESTAMP
WHEN NOT MATCHED THEN
    INSERT (
        OWNER,
        OBJECT_TYPE,
        OBJECT_NAME,
        OBJECT_LABEL,
        DESCRIPTION,
        USE_YN,
        SORT_ORDER,
        CREATED_AT
    ) VALUES (
        S.OWNER,
        S.OBJECT_TYPE,
        S.OBJECT_NAME,
        S.OBJECT_LABEL,
        S.DESCRIPTION,
        S.USE_YN,
        S.SORT_ORDER,
        SYSTIMESTAMP
    )
;

-- [M90001_OBJECT_ID_SELECT]
-- Select the object master key after upsert.
SELECT OBJECT_ID
  FROM INIT$_TB_OBJECT
 WHERE OWNER = :owner
   AND OBJECT_TYPE = :objectType
   AND OBJECT_NAME = :objectName
;

-- [M90001_OBJECT_DETAIL_COUNT]
-- Count saved child detail rows before deleting the object master.
SELECT COUNT(*) AS DETAIL_COUNT
  FROM INIT$_TB_OBJECT_DETAIL
 WHERE OBJECT_ID = :objectId
;

-- [M90001_OBJECT_DELETE_SCOPE]
-- Select object master rows that must be removed together.
-- PACKAGE deletes include registered package member objects.
SELECT OBJECT_ID
  FROM INIT$_TB_OBJECT
 WHERE (
          (:objectId IS NOT NULL AND OBJECT_ID = :objectId)
       OR (
              OWNER = :owner
          AND OBJECT_TYPE = :objectType
          AND OBJECT_NAME = :objectName
          )
       OR (
              :objectType = 'PACKAGE'
          AND OWNER = :owner
          AND OBJECT_TYPE IN ('PACKAGE_PROCEDURE', 'PACKAGE_FUNCTION')
          AND OBJECT_NAME LIKE :objectName || '.%'
          )
       )
 ORDER BY CASE WHEN OBJECT_ID = :objectId THEN 0 ELSE 1 END,
          OBJECT_ID
;

-- [M90001_OBJECT_REFERENCE_COUNT]
-- Count saved data work jobs that reference the registered object.
SELECT COUNT(*) AS REF_COUNT
  FROM INIT$_TB_DATA_WORK_JOB
 WHERE EXEC_OBJECT_ID = :objectId
;

-- [M90001_OBJECT_REFERENCE_CLEAR]
-- Keep saved job text metadata, but detach the FK before deleting object master.
UPDATE INIT$_TB_DATA_WORK_JOB
   SET EXEC_OBJECT_ID = NULL,
       UPDATED_AT = SYSTIMESTAMP
 WHERE EXEC_OBJECT_ID = :objectId
;

-- [M90001_OBJECT_DETAIL]
-- DB dictionary rows are the base; saved detail rows are left-joined for editable descriptions/defaults.
WITH SAVED AS (
    SELECT
        OBJECT_ID,
        OWNER,
        OBJECT_TYPE,
        OBJECT_NAME,
        ITEM_NAME,
        ITEM_VALUE,
        ITEM_DESC,
        ITEM_DEFAULT,
        ITEM_ORDER,
        'SAVED' AS DETAIL_SOURCE
      FROM INIT$_TB_OBJECT_DETAIL
     WHERE (
              (:objectId IS NOT NULL AND OBJECT_ID = :objectId)
           OR (:objectId IS NULL AND OWNER = :owner AND OBJECT_TYPE = :objectType AND OBJECT_NAME = :objectName)
           )
),
DICTIONARY_ROWS AS (
    SELECT
        CAST(:objectId AS NUMBER) AS OBJECT_ID,
        C.COLUMN_NAME AS ITEM_NAME,
        C.DATA_TYPE
            || CASE
                WHEN C.DATA_TYPE IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN '(' || C.CHAR_LENGTH || ')'
                WHEN C.DATA_TYPE = 'NUMBER' AND C.DATA_PRECISION IS NOT NULL THEN '(' || C.DATA_PRECISION || NVL2(C.DATA_SCALE, ',' || C.DATA_SCALE, '') || ')'
                ELSE ''
               END
            || CASE WHEN C.NULLABLE = 'N' THEN ' NOT NULL' ELSE '' END AS ITEM_VALUE,
        CC.COMMENTS AS ITEM_DESC,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
        C.COLUMN_ID AS ITEM_ORDER,
        'DICTIONARY' AS DETAIL_SOURCE
      FROM ALL_TAB_COLUMNS C
      LEFT JOIN ALL_COL_COMMENTS CC
        ON CC.OWNER = C.OWNER
       AND CC.TABLE_NAME = C.TABLE_NAME
       AND CC.COLUMN_NAME = C.COLUMN_NAME
     WHERE :objectType = 'TABLE'
       AND C.OWNER = :owner
       AND C.TABLE_NAME = :objectName
    UNION ALL
    SELECT
        CAST(:objectId AS NUMBER) AS OBJECT_ID,
        A.ARGUMENT_NAME AS ITEM_NAME,
        A.IN_OUT || ' ' || A.DATA_TYPE AS ITEM_VALUE,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
        A.POSITION AS ITEM_ORDER,
        'DICTIONARY' AS DETAIL_SOURCE
      FROM ALL_ARGUMENTS A
     WHERE :objectType IN ('PROCEDURE', 'FUNCTION')
       AND A.OWNER = :owner
       AND A.OBJECT_NAME = :objectName
       AND A.ARGUMENT_NAME IS NOT NULL
    UNION ALL
    SELECT
        CAST(:objectId AS NUMBER) AS OBJECT_ID,
        P.PROCEDURE_NAME AS ITEM_NAME,
        CASE
            WHEN EXISTS (
                SELECT 1
                  FROM ALL_ARGUMENTS A
                 WHERE A.OWNER = P.OWNER
                   AND A.PACKAGE_NAME = P.OBJECT_NAME
                   AND A.OBJECT_NAME = P.PROCEDURE_NAME
                   AND A.POSITION = 0
            ) THEN 'FUNCTION'
            ELSE 'PROCEDURE'
        END AS ITEM_VALUE,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
        ROW_NUMBER() OVER (ORDER BY P.PROCEDURE_NAME) AS ITEM_ORDER,
        'DICTIONARY' AS DETAIL_SOURCE
      FROM ALL_PROCEDURES P
     WHERE :objectType = 'PACKAGE'
       AND P.OWNER = :owner
       AND P.OBJECT_NAME = :objectName
       AND P.PROCEDURE_NAME IS NOT NULL
    UNION ALL
    SELECT
        CAST(:objectId AS NUMBER) AS OBJECT_ID,
        A.ARGUMENT_NAME AS ITEM_NAME,
        A.IN_OUT || ' ' || A.DATA_TYPE AS ITEM_VALUE,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
        A.POSITION AS ITEM_ORDER,
        'DICTIONARY' AS DETAIL_SOURCE
      FROM ALL_ARGUMENTS A
     WHERE :objectType IN ('PACKAGE_PROCEDURE', 'PACKAGE_FUNCTION')
       AND A.OWNER = :owner
       AND A.PACKAGE_NAME = REGEXP_SUBSTR(:objectName, '^[^.]+')
       AND A.OBJECT_NAME = REGEXP_SUBSTR(:objectName, '[^.]+$', 1, 1)
       AND A.ARGUMENT_NAME IS NOT NULL
    UNION ALL
    SELECT
        CAST(:objectId AS NUMBER) AS OBJECT_ID,
        A.ATTRIBUTE_NAME AS ITEM_NAME,
        A.ATTRIBUTE_TYPE || NVL2(A.DATA_TYPE, ' ' || A.DATA_TYPE, '') AS ITEM_VALUE,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
        CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
        ROW_NUMBER() OVER (ORDER BY A.ATTRIBUTE_NAME) AS ITEM_ORDER,
        'DICTIONARY' AS DETAIL_SOURCE
      FROM ALL_MINING_MODEL_ATTRIBUTES A
     WHERE :objectType = 'MINING_MODEL'
       AND A.OWNER = :owner
       AND A.MODEL_NAME = :objectName
)
SELECT
    COALESCE(S.OBJECT_ID, D.OBJECT_ID) AS OBJECT_ID,
    D.ITEM_NAME,
    D.ITEM_VALUE,
    COALESCE(S.ITEM_DESC, D.ITEM_DESC) AS ITEM_DESC,
    S.ITEM_DEFAULT,
    D.ITEM_ORDER,
    CASE WHEN S.OBJECT_ID IS NOT NULL THEN 'SAVED' ELSE D.DETAIL_SOURCE END AS DETAIL_SOURCE
  FROM DICTIONARY_ROWS D
  LEFT JOIN SAVED S
    ON S.ITEM_NAME = D.ITEM_NAME
   AND (
           (:objectId IS NOT NULL AND S.OBJECT_ID = :objectId)
        OR (:objectId IS NULL AND S.OWNER = :owner AND S.OBJECT_TYPE = :objectType AND S.OBJECT_NAME = :objectName)
       )
 ORDER BY D.ITEM_ORDER
;

-- [M90001_OBJECT_DETAIL_DELETE]
-- Delete previous saved metadata for the selected object before inserting the edited list.
DELETE FROM INIT$_TB_OBJECT_DETAIL
 WHERE OBJECT_ID = :objectId
;

-- [M90001_OBJECT_DELETE]
-- Delete the selected object master after its child detail rows have been deleted.
DELETE FROM INIT$_TB_OBJECT
 WHERE OBJECT_ID = :objectId
;

-- [M90001_OBJECT_DETAIL_INSERT]
-- Sample insert target table:
-- INIT$_TB_OBJECT_DETAIL(OBJECT_ID, OWNER, OBJECT_TYPE, OBJECT_NAME, ITEM_NAME, ITEM_VALUE, ITEM_DESC, ITEM_DEFAULT, ITEM_ORDER, CREATED_AT)
INSERT INTO INIT$_TB_OBJECT_DETAIL (
    OBJECT_ID,
    OWNER,
    OBJECT_TYPE,
    OBJECT_NAME,
    ITEM_NAME,
    ITEM_VALUE,
    ITEM_DESC,
    ITEM_DEFAULT,
    ITEM_ORDER,
    CREATED_AT
) VALUES (
    :objectId,
    :owner,
    :objectType,
    :objectName,
    :itemName,
    :itemValue,
    :itemDesc,
    :itemDefault,
    :itemOrder,
    SYSTIMESTAMP
)
;
