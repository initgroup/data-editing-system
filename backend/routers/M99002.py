"""
@file           M99002.py
@description    Read-only target DB browser API
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Optional
import logging
import re

from backend.database_helper import SqlLoader
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


def get_router_sql(sql_id: str, replacements: Optional[dict[str, str]] = None) -> str:
    sql = SqlLoader.get_sql(sql_id)
    for key, value in (replacements or {}).items():
        sql = sql.replace(f"/* --{key}-- */", value)
    return sql


@router.get("/object-tree")
def get_object_tree(request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows = fetch_rows(conn, SqlLoader.get_sql("M99002_OBJECT_TREE"))
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
            rows, has_more = fetch_paged_rows(conn, SqlLoader.get_sql("M99002_OBJECT_CHILD_TABLES"), {"owner": owner}, "OBJECT_NAME", offset, limit)
        elif category == "VIEW":
            rows, has_more = fetch_paged_rows(conn, SqlLoader.get_sql("M99002_OBJECT_CHILD_VIEWS"), {"owner": owner}, "OBJECT_NAME", offset, limit)
        else:
            rows, has_more = fetch_paged_rows(conn, SqlLoader.get_sql("M99002_OBJECT_CHILD_PLSQL"), {"owner": owner, "category": category}, "OBJECT_NAME", offset, limit)
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
        sql_parts.append(SqlLoader.get_sql("M99002_SEARCH_TABLES"))

    if has_category(categories, "VIEW"):
        sql_parts.append(SqlLoader.get_sql("M99002_SEARCH_VIEWS"))

    plsql_categories = [category for category in ("PACKAGE", "PROCEDURE", "FUNCTION") if has_category(categories, category)]
    if plsql_categories:
        type_list = ", ".join(f"'{category}'" for category in plsql_categories)
        sql_parts.append(get_router_sql("M99002_SEARCH_PLSQL", {"OBJECT_TYPE_LIST": type_list}))

    if not sql_parts:
        return {"status": "success", "data": [], "total": 0}

    sql = get_router_sql("M99002_SEARCH_WRAPPER", {"SEARCH_SQL": " UNION ALL ".join(sql_parts)})

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
        rows = fetch_rows(conn, SqlLoader.get_sql("M99002_PACKAGE_MEMBERS"), {"owner": owner, "packageName": package_name})
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        if conn:
            conn.close()


@router.post("/object/detail")
def get_object_detail(req: ObjectRequest, request: Request):
    owner = normalize_identifier(req.owner or "", "owner")
    object_type = normalize_object_type(req.objectType or "")
    object_name = normalize_object_name(req.objectName or "")
    base_object_name = object_name.split(".", 1)[0] if object_type in {"PACKAGE_PROCEDURE", "PACKAGE_FUNCTION"} else object_name

    conn = None
    try:
        conn = get_target_db_connection(request)
        if object_type == "TABLE":
            rows = fetch_rows(conn, SqlLoader.get_sql("M99002_OBJECT_DETAIL_TABLE"), {"owner": owner, "objectName": base_object_name})
        elif object_type == "VIEW":
            rows = fetch_rows(conn, SqlLoader.get_sql("M99002_OBJECT_DETAIL_VIEW"), {"owner": owner, "objectName": base_object_name})
        else:
            rows = fetch_rows(conn, SqlLoader.get_sql("M99002_OBJECT_DETAIL_PLSQL"), {
                "owner": owner,
                "objectType": object_type,
                "displayName": object_name,
                "objectName": base_object_name,
                "baseObjectType": "PACKAGE" if object_type in {"PACKAGE_PROCEDURE", "PACKAGE_FUNCTION"} else object_type,
            })
        return {"status": "success", "object": rows[0] if rows else {}}
    finally:
        if conn:
            conn.close()


@router.post("/table/columns")
def get_table_columns(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows, columns = fetch_result(conn, SqlLoader.get_sql("M99002_TABLE_COLUMNS"), {"owner": owner, "tableName": table_name})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


@router.post("/table/data")
def get_table_data(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    limit = normalize_limit(req.limit)
    sql = get_router_sql("M99002_TABLE_DATA", {"OWNER_TABLE": f"{quote_identifier(owner)}.{quote_identifier(table_name)}"})
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
                SqlLoader.get_sql("M99002_OBJECT_SOURCE"),
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
        message = str(e)
        logger.error(f"M99002 source load failed: {message}")
        if is_metadata_permission_error(message):
            fallback_source = fetch_source_lines(conn, owner, ddl_type, ddl_name)
            if fallback_source:
                return {
                    "status": "success",
                    "source": fallback_source,
                    "sourceType": "ALL_SOURCE",
                    "message": "DBMS_METADATA.GET_DDL failed, so ALL_SOURCE text was shown.",
                    "object": {"owner": owner, "objectType": object_type, "objectName": object_name},
                }
            raise HTTPException(
                status_code=403,
                detail=create_metadata_permission_message(owner, ddl_type, ddl_name)
            )
        raise HTTPException(status_code=500, detail=message)
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
        rows, columns = fetch_result(
            conn,
            get_router_sql("M99002_LIMITED_SELECT_WRAPPER", {"READONLY_SQL": sql}),
            {"limit": limit},
        )
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
    sql = get_router_sql("M99002_PAGED_SELECT_WRAPPER", {
        "ORDER_BY": order_by,
        "BASE_SQL": base_sql,
    })
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


def is_metadata_permission_error(message: str) -> bool:
    text = str(message or "").upper()
    return any(code in text for code in ("ORA-31603", "ORA-31608", "ORA-31600", "ORA-01031"))


def create_metadata_permission_message(owner: str, object_type: str, object_name: str) -> str:
    return (
        f'DDL metadata for "{owner}.{object_name}" ({object_type}) could not be loaded.\n'
        "Connect with the object owner or ask a DBA to grant metadata dictionary access to the Target DB account.\n\n"
        "DBA grant examples:\n"
        "GRANT SELECT_CATALOG_ROLE TO <TARGET_DB_USER>;\n"
        "-- or, if your security policy allows it:\n"
        "GRANT SELECT ANY DICTIONARY TO <TARGET_DB_USER>;"
    )


def fetch_source_lines(conn, owner: str, object_type: str, object_name: str) -> str:
    if not conn:
        return ""
    if object_type not in {"PACKAGE", "PROCEDURE", "FUNCTION"}:
        return ""
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("M99002_OBJECT_SOURCE_LINES"),
            {"owner": owner, "objectType": object_type, "objectName": object_name},
        )
        return "".join(str(row[0] or "") for row in cursor.fetchall())
    except Exception as e:
        logger.warning(f"M99002 ALL_SOURCE fallback failed: {str(e)}")
        return ""
    finally:
        if cursor:
            cursor.close()


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
