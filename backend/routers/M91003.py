"""
@file           M91003.py
@description    Read-only target DB browser API
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Optional
import logging
import re

from backend.target_database import get_target_db_connection

logger = logging.getLogger(__name__)
router = APIRouter()


class ObjectRequest(BaseModel):
    owner: Optional[str] = None
    objectType: Optional[str] = None
    objectName: Optional[str] = None
    model_config = ConfigDict(extra="allow")


class TableRequest(BaseModel):
    owner: Optional[str] = None
    tableName: Optional[str] = None
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


CATEGORY_META = {
    "TABLE": {"label": "Tables", "sort": 10},
    "VIEW": {"label": "Views", "sort": 20},
    "PACKAGE": {"label": "Packages", "sort": 30},
    "PROCEDURE": {"label": "Procedures", "sort": 40},
    "FUNCTION": {"label": "Functions", "sort": 50},
}


@router.get("/object-tree")
def get_object_tree(request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows = fetch_rows(conn, """
            WITH OBJECT_COUNTS AS (
                SELECT OWNER, 'TABLE' AS CATEGORY_CODE, COUNT(*) AS CNT
                  FROM ALL_TABLES
                 WHERE TABLE_NAME NOT LIKE 'BIN$%'
                   AND NESTED = 'NO'
                   AND SECONDARY = 'N'
                 GROUP BY OWNER
                UNION ALL
                SELECT OWNER, 'VIEW' AS CATEGORY_CODE, COUNT(*) AS CNT
                  FROM ALL_VIEWS
                 GROUP BY OWNER
                UNION ALL
                SELECT OWNER, OBJECT_TYPE AS CATEGORY_CODE, COUNT(*) AS CNT
                  FROM ALL_OBJECTS
                 WHERE OBJECT_TYPE IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')
                   AND GENERATED = 'N'
                   AND OBJECT_NAME NOT LIKE 'BIN$%'
                 GROUP BY OWNER, OBJECT_TYPE
            ),
            OWNER_LIST AS (
                SELECT DISTINCT OWNER FROM OBJECT_COUNTS
            )
            SELECT
                OWNER,
                'OWNER' AS OBJECT_TYPE,
                OWNER AS OBJECT_NAME,
                OWNER AS OBJECT_LABEL,
                'OWNER:' || OWNER AS NODE_ID,
                CAST(NULL AS VARCHAR2(4000)) AS PARENT_ID,
                1 AS LEVEL_NO,
                'N' AS IS_SELECTABLE,
                CAST(NULL AS NUMBER) AS CHILD_COUNT,
                CASE
                    WHEN OWNER = SYS_CONTEXT('USERENV', 'SESSION_USER') THEN 0
                    WHEN OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') THEN 1
                    ELSE 2
                END AS OWNER_SORT,
                0 AS SORT_GROUP
              FROM OWNER_LIST
            UNION ALL
            SELECT
                C.OWNER,
                'GROUP' AS OBJECT_TYPE,
                C.CATEGORY_CODE AS OBJECT_NAME,
                CASE C.CATEGORY_CODE
                    WHEN 'TABLE' THEN 'Tables'
                    WHEN 'VIEW' THEN 'Views'
                    WHEN 'PACKAGE' THEN 'Packages'
                    WHEN 'PROCEDURE' THEN 'Procedures'
                    WHEN 'FUNCTION' THEN 'Functions'
                END AS OBJECT_LABEL,
                'GROUP:' || C.OWNER || ':' || C.CATEGORY_CODE AS NODE_ID,
                'OWNER:' || C.OWNER AS PARENT_ID,
                2 AS LEVEL_NO,
                'N' AS IS_SELECTABLE,
                C.CNT AS CHILD_COUNT,
                CASE
                    WHEN C.OWNER = SYS_CONTEXT('USERENV', 'SESSION_USER') THEN 0
                    WHEN C.OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') THEN 1
                    ELSE 2
                END AS OWNER_SORT,
                CASE C.CATEGORY_CODE
                    WHEN 'TABLE' THEN 10
                    WHEN 'VIEW' THEN 20
                    WHEN 'PACKAGE' THEN 30
                    WHEN 'PROCEDURE' THEN 40
                    WHEN 'FUNCTION' THEN 50
                END AS SORT_GROUP
              FROM OBJECT_COUNTS C
             WHERE C.CNT > 0
             ORDER BY OWNER_SORT, OWNER, SORT_GROUP, OBJECT_NAME
        """)
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        if conn:
            conn.close()


@router.get("/object-children")
def get_object_children(
    request: Request,
    owner: str = Query(...),
    category: str = Query(...),
    offset: int = Query(0),
    limit: int = Query(200),
):
    owner = normalize_identifier(owner, "owner")
    category = str(category or "").strip().upper()
    if category not in CATEGORY_META:
        raise HTTPException(status_code=400, detail="Invalid object category.")
    offset = normalize_offset(offset)
    limit = normalize_page_limit(limit)

    conn = None
    try:
        conn = get_target_db_connection(request)
        if category == "TABLE":
            rows, has_more = fetch_paged_rows(conn, """
                SELECT
                    T.OWNER,
                    'TABLE' AS OBJECT_TYPE,
                    T.TABLE_NAME AS OBJECT_NAME,
                    T.TABLE_NAME || NVL2(T.COMMENTS, ' - ' || T.COMMENTS, '') AS OBJECT_LABEL,
                    'TABLE:' || T.OWNER || ':' || T.TABLE_NAME AS NODE_ID,
                    'GROUP:' || T.OWNER || ':TABLE' AS PARENT_ID,
                    3 AS LEVEL_NO,
                    'Y' AS IS_SELECTABLE,
                    CAST(NULL AS NUMBER) AS CHILD_COUNT,
                    T.COMMENTS AS OBJECT_COMMENT,
                    TO_CHAR(O.CREATED, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT
                  FROM ALL_TAB_COMMENTS T
                  LEFT JOIN ALL_OBJECTS O
                    ON O.OWNER = T.OWNER
                   AND O.OBJECT_NAME = T.TABLE_NAME
                   AND O.OBJECT_TYPE = 'TABLE'
                 WHERE T.OWNER = :owner
                   AND T.TABLE_TYPE = 'TABLE'
                   AND T.TABLE_NAME NOT LIKE 'BIN$%'
            """, {"owner": owner}, "OBJECT_NAME", offset, limit)
        elif category == "VIEW":
            rows, has_more = fetch_paged_rows(conn, """
                SELECT
                    OWNER,
                    'VIEW' AS OBJECT_TYPE,
                    VIEW_NAME AS OBJECT_NAME,
                    VIEW_NAME AS OBJECT_LABEL,
                    'VIEW:' || OWNER || ':' || VIEW_NAME AS NODE_ID,
                    'GROUP:' || OWNER || ':VIEW' AS PARENT_ID,
                    3 AS LEVEL_NO,
                    'Y' AS IS_SELECTABLE,
                    CAST(NULL AS NUMBER) AS CHILD_COUNT
                  FROM ALL_VIEWS
                 WHERE OWNER = :owner
            """, {"owner": owner}, "OBJECT_NAME", offset, limit)
        else:
            rows, has_more = fetch_paged_rows(conn, """
                SELECT
                    OWNER,
                    OBJECT_TYPE,
                    OBJECT_NAME,
                    OBJECT_NAME AS OBJECT_LABEL,
                    OBJECT_TYPE || ':' || OWNER || ':' || OBJECT_NAME AS NODE_ID,
                    'GROUP:' || OWNER || ':' || OBJECT_TYPE AS PARENT_ID,
                    3 AS LEVEL_NO,
                    'Y' AS IS_SELECTABLE,
                    CASE
                        WHEN OBJECT_TYPE = 'PACKAGE' THEN (
                            SELECT COUNT(*)
                              FROM ALL_PROCEDURES P
                             WHERE P.OWNER = O.OWNER
                               AND P.OBJECT_NAME = O.OBJECT_NAME
                               AND P.PROCEDURE_NAME IS NOT NULL
                        )
                        ELSE CAST(NULL AS NUMBER)
                    END AS CHILD_COUNT
                  FROM ALL_OBJECTS O
                 WHERE OWNER = :owner
                   AND OBJECT_TYPE = :category
                   AND GENERATED = 'N'
                   AND OBJECT_NAME NOT LIKE 'BIN$%'
            """, {"owner": owner, "category": category}, "OBJECT_NAME", offset, limit)
        return {
            "status": "success",
            "data": rows,
            "total": len(rows),
            "offset": offset,
            "limit": limit,
            "nextOffset": offset + len(rows),
            "hasMore": has_more,
        }
    finally:
        if conn:
            conn.close()


@router.get("/object-search")
def search_objects(
    request: Request,
    keyword: str = Query(...),
    categoryFilter: str = Query("ALL"),
    offset: int = Query(0),
    limit: int = Query(200),
):
    keyword_text = str(keyword or "").strip().upper()
    if not keyword_text:
        return {"status": "success", "data": [], "total": 0}

    categories = parse_category_filter(categoryFilter)
    offset = normalize_offset(offset)
    limit = normalize_page_limit(limit)
    params = {"keyword": f"%{keyword_text}%"}
    sql_parts = []

    if has_category(categories, "TABLE"):
        sql_parts.append("""
            SELECT
                T.OWNER,
                'TABLE' AS OBJECT_TYPE,
                T.TABLE_NAME AS OBJECT_NAME,
                T.TABLE_NAME || NVL2(T.COMMENTS, ' - ' || T.COMMENTS, '') AS OBJECT_LABEL,
                'SEARCH:TABLE:' || T.OWNER || ':' || T.TABLE_NAME AS NODE_ID,
                CAST(NULL AS VARCHAR2(4000)) AS PARENT_ID,
                1 AS LEVEL_NO,
                'Y' AS IS_SELECTABLE,
                CAST(NULL AS NUMBER) AS CHILD_COUNT,
                'TABLE' AS ROOT_CATEGORY,
                T.COMMENTS AS OBJECT_COMMENT,
                TO_CHAR(O.CREATED, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT
             FROM ALL_TAB_COMMENTS T
             LEFT JOIN ALL_OBJECTS O
               ON O.OWNER = T.OWNER
              AND O.OBJECT_NAME = T.TABLE_NAME
              AND O.OBJECT_TYPE = 'TABLE'
             WHERE T.TABLE_TYPE = 'TABLE'
               AND T.TABLE_NAME NOT LIKE 'BIN$%'
               AND (UPPER(T.OWNER) LIKE :keyword OR UPPER(T.TABLE_NAME) LIKE :keyword OR UPPER(NVL(T.COMMENTS, '')) LIKE :keyword)
        """)

    if has_category(categories, "VIEW"):
        sql_parts.append("""
            SELECT
                OWNER,
                'VIEW' AS OBJECT_TYPE,
                VIEW_NAME AS OBJECT_NAME,
                VIEW_NAME AS OBJECT_LABEL,
                'SEARCH:VIEW:' || OWNER || ':' || VIEW_NAME AS NODE_ID,
                CAST(NULL AS VARCHAR2(4000)) AS PARENT_ID,
                1 AS LEVEL_NO,
                'Y' AS IS_SELECTABLE,
                CAST(NULL AS NUMBER) AS CHILD_COUNT,
                'VIEW' AS ROOT_CATEGORY,
                CAST(NULL AS VARCHAR2(4000)) AS OBJECT_COMMENT,
                CAST(NULL AS VARCHAR2(19)) AS CREATED_AT
              FROM ALL_VIEWS
             WHERE UPPER(OWNER) LIKE :keyword OR UPPER(VIEW_NAME) LIKE :keyword
        """)

    plsql_categories = [category for category in ("PACKAGE", "PROCEDURE", "FUNCTION") if has_category(categories, category)]
    if plsql_categories:
        type_list = ", ".join(f"'{category}'" for category in plsql_categories)
        sql_parts.append(f"""
            SELECT
                OWNER,
                OBJECT_TYPE,
                OBJECT_NAME,
                OBJECT_NAME AS OBJECT_LABEL,
                'SEARCH:' || OBJECT_TYPE || ':' || OWNER || ':' || OBJECT_NAME AS NODE_ID,
                CAST(NULL AS VARCHAR2(4000)) AS PARENT_ID,
                1 AS LEVEL_NO,
                'Y' AS IS_SELECTABLE,
                CASE
                    WHEN OBJECT_TYPE = 'PACKAGE' THEN (
                        SELECT COUNT(*)
                          FROM ALL_PROCEDURES P
                         WHERE P.OWNER = O.OWNER
                           AND P.OBJECT_NAME = O.OBJECT_NAME
                           AND P.PROCEDURE_NAME IS NOT NULL
                    )
                    ELSE CAST(NULL AS NUMBER)
                END AS CHILD_COUNT,
                OBJECT_TYPE AS ROOT_CATEGORY,
                CAST(NULL AS VARCHAR2(4000)) AS OBJECT_COMMENT,
                CAST(NULL AS VARCHAR2(19)) AS CREATED_AT
              FROM ALL_OBJECTS O
             WHERE OBJECT_TYPE IN ({type_list})
               AND GENERATED = 'N'
               AND OBJECT_NAME NOT LIKE 'BIN$%'
               AND (UPPER(OWNER) LIKE :keyword OR UPPER(OBJECT_NAME) LIKE :keyword)
        """)

    if has_category(categories, "PACKAGE"):
        sql_parts.append("""
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
                'SEARCH:PACKAGE_MEMBER:' || P.OWNER || ':' || P.OBJECT_NAME || ':' || P.PROCEDURE_NAME AS NODE_ID,
                CAST(NULL AS VARCHAR2(4000)) AS PARENT_ID,
                1 AS LEVEL_NO,
                'Y' AS IS_SELECTABLE,
                CAST(NULL AS NUMBER) AS CHILD_COUNT,
                'PACKAGE' AS ROOT_CATEGORY,
                CAST(NULL AS VARCHAR2(4000)) AS OBJECT_COMMENT,
                CAST(NULL AS VARCHAR2(19)) AS CREATED_AT
              FROM ALL_PROCEDURES P
             WHERE P.PROCEDURE_NAME IS NOT NULL
               AND (
                    UPPER(P.OWNER) LIKE :keyword
                 OR UPPER(P.OBJECT_NAME) LIKE :keyword
                 OR UPPER(P.PROCEDURE_NAME) LIKE :keyword
                 OR UPPER(P.OBJECT_NAME || '.' || P.PROCEDURE_NAME) LIKE :keyword
               )
        """)

    if not sql_parts:
        return {"status": "success", "data": [], "total": 0}

    sql = f"""
        SELECT *
          FROM (
            SELECT R.*, ROW_NUMBER() OVER (ORDER BY OWNER, ROOT_CATEGORY, OBJECT_NAME) AS RN
              FROM (
                {" UNION ALL ".join(sql_parts)}
              ) R
          )
         WHERE RN > :offset
           AND RN <= :endRow
         ORDER BY RN
    """

    conn = None
    try:
        conn = get_target_db_connection(request)
        rows = fetch_rows(conn, sql, {
            **params,
            "offset": offset,
            "endRow": offset + limit + 1,
        })
        has_more = len(rows) > limit
        rows = rows[:limit]
        for row in rows:
            row.pop("RN", None)
        return {
            "status": "success",
            "data": rows,
            "total": len(rows),
            "offset": offset,
            "limit": limit,
            "nextOffset": offset + len(rows),
            "hasMore": has_more,
        }
    finally:
        if conn:
            conn.close()


@router.get("/package-members")
def get_package_members(request: Request, owner: str = Query(...), packageName: str = Query(...)):
    owner = normalize_identifier(owner, "owner")
    package_name = normalize_identifier(packageName, "packageName")
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows = fetch_rows(conn, """
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
                P.PROCEDURE_NAME AS OBJECT_LABEL,
                'PACKAGE_MEMBER:' || P.OWNER || ':' || P.OBJECT_NAME || ':' || P.PROCEDURE_NAME AS NODE_ID,
                'PACKAGE:' || P.OWNER || ':' || P.OBJECT_NAME AS PARENT_ID,
                4 AS LEVEL_NO,
                'Y' AS IS_SELECTABLE,
                CAST(NULL AS NUMBER) AS CHILD_COUNT
              FROM ALL_PROCEDURES P
             WHERE P.OWNER = :owner
               AND P.OBJECT_NAME = :packageName
               AND P.PROCEDURE_NAME IS NOT NULL
             ORDER BY P.PROCEDURE_NAME
        """, {"owner": owner, "packageName": package_name})
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        if conn:
            conn.close()


@router.post("/table/columns")
def get_table_columns(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows, columns = fetch_result(conn, """
            SELECT
                C.COLUMN_ID,
                C.COLUMN_NAME,
                C.DATA_TYPE,
                C.DATA_LENGTH,
                C.DATA_PRECISION,
                C.DATA_SCALE,
                C.NULLABLE,
                C.DATA_DEFAULT,
                CC.COMMENTS
              FROM ALL_TAB_COLUMNS C
              LEFT JOIN ALL_COL_COMMENTS CC
                ON CC.OWNER = C.OWNER
               AND CC.TABLE_NAME = C.TABLE_NAME
               AND CC.COLUMN_NAME = C.COLUMN_NAME
             WHERE C.OWNER = :owner
               AND C.TABLE_NAME = :tableName
             ORDER BY C.COLUMN_ID
        """, {"owner": owner, "tableName": table_name})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


@router.post("/table/data")
def get_table_data(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    limit = normalize_limit(req.limit)
    sql = f"SELECT * FROM {quote_identifier(owner)}.{quote_identifier(table_name)} WHERE ROWNUM <= :limit"
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows, columns = fetch_result(conn, sql, {"limit": limit})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


@router.post("/object/source")
def get_object_source(req: ObjectRequest, request: Request):
    owner = normalize_identifier(req.owner or "", "owner")
    object_type = normalize_object_type(req.objectType or "")
    object_name = normalize_object_name(req.objectName or "")
    ddl_type, ddl_name = resolve_ddl_type_name(object_type, object_name)

    conn = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT DBMS_METADATA.GET_DDL(:objectType, :objectName, :owner) AS SOURCE_TEXT
                  FROM DUAL
                """,
                {"objectType": ddl_type, "objectName": ddl_name, "owner": owner},
            )
            row = cursor.fetchone()
            source = row[0].read() if row and hasattr(row[0], "read") else (row[0] if row else "")
        finally:
            cursor.close()
        return {
            "status": "success",
            "source": source or "",
            "object": {"owner": owner, "objectType": object_type, "objectName": object_name},
        }
    except Exception as e:
        logger.error(f"M91003 source load failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.post("/sql")
def execute_sql(req: SqlRequest, request: Request):
    sql = normalize_select_sql(req.sql)
    limit = normalize_limit(req.limit)
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows, columns = fetch_result(conn, f"SELECT * FROM ({sql}) WHERE ROWNUM <= :limit", {"limit": limit})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


def fetch_rows(conn, sql: str, params: Optional[dict] = None) -> list[dict]:
    rows, _ = fetch_result(conn, sql, params)
    return rows


def fetch_result(conn, sql: str, params: Optional[dict] = None) -> tuple[list[dict], list[str]]:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params or {})
        columns = [col[0] for col in cursor.description] if cursor.description else []
        return [
            {column: normalize_db_value(value) for column, value in zip(columns, row)}
            for row in cursor.fetchall()
        ], columns
    finally:
        if cursor:
            cursor.close()


def normalize_db_value(value):
    if hasattr(value, "read"):
        value = value.read()
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    return value


def fetch_paged_rows(
    conn,
    base_sql: str,
    params: Optional[dict],
    order_by: str,
    offset: int,
    limit: int,
) -> tuple[list[dict], bool]:
    sql = f"""
        SELECT *
          FROM (
            SELECT R.*, ROW_NUMBER() OVER (ORDER BY {order_by}) AS RN
              FROM (
                {base_sql}
              ) R
          )
         WHERE RN > :offset
           AND RN <= :endRow
         ORDER BY RN
    """
    rows = fetch_rows(conn, sql, {
        **(params or {}),
        "offset": offset,
        "endRow": offset + limit + 1,
    })
    has_more = len(rows) > limit
    rows = rows[:limit]
    for row in rows:
        row.pop("RN", None)
    return rows, has_more


def with_columns(rows: list[dict], columns: Optional[list[str]] = None):
    return {
        "status": "success",
        "data": rows,
        "columns": columns if columns is not None else (list(rows[0].keys()) if rows else []),
        "total": len(rows),
    }


def normalize_identifier(value: str, field_name: str) -> str:
    text = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]*", text):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return text


def normalize_object_name(value: str) -> str:
    text = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]*(\.[A-Z][A-Z0-9_$#]*)?", text):
        raise HTTPException(status_code=400, detail="Invalid objectName.")
    return text


def normalize_object_type(value: str) -> str:
    text = str(value or "").strip().upper()
    allowed = {"TABLE", "VIEW", "PACKAGE", "PROCEDURE", "FUNCTION", "PACKAGE_PROCEDURE", "PACKAGE_FUNCTION"}
    if text not in allowed:
        raise HTTPException(status_code=400, detail="Invalid objectType.")
    return text


def resolve_ddl_type_name(object_type: str, object_name: str) -> tuple[str, str]:
    if object_type in {"PACKAGE_PROCEDURE", "PACKAGE_FUNCTION"}:
        return "PACKAGE", object_name.split(".", 1)[0]
    return object_type, object_name


def require_table(req: TableRequest) -> tuple[str, str]:
    return normalize_identifier(req.owner or "", "owner"), normalize_identifier(req.tableName or "", "tableName")


def normalize_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 100)
    except (TypeError, ValueError):
        limit = 100
    return max(1, min(limit, 1000))


def normalize_page_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 200)
    except (TypeError, ValueError):
        limit = 200
    return max(1, min(limit, 500))


def normalize_offset(value: Optional[int]) -> int:
    try:
        offset = int(value or 0)
    except (TypeError, ValueError):
        offset = 0
    return max(0, offset)


def parse_category_filter(value: str) -> set[str]:
    raw = str(value or "ALL").strip().upper()
    if not raw or raw == "ALL":
        return set(CATEGORY_META.keys())
    categories = {item.strip() for item in raw.split(",") if item.strip()}
    invalid = categories - set(CATEGORY_META.keys())
    if invalid:
        raise HTTPException(status_code=400, detail="Invalid categoryFilter.")
    return categories or set(CATEGORY_META.keys())


def has_category(categories: set[str], category: str) -> bool:
    return category in categories


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def normalize_select_sql(sql: str) -> str:
    text = (sql or "").strip()
    text = re.sub(r";+\s*$", "", text)
    if not re.match(r"(?is)^(select|with)\b", text):
        raise HTTPException(status_code=400, detail="Only SELECT statements are allowed.")
    if re.search(r";\s*\S", sql or ""):
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec)\b"
    if re.search(blocked, text, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only read-only SELECT statements are allowed.")
    return text
