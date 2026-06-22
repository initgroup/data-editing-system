"""
@file           [M02002].py 
@description    [대상 데이터 선정]
@author         [인아이티 김진열]
@date           2026-06-12
@version        1.0.0

[수정 이력]:
- 2026-06-12: 최초 생성 및 기본 기능 구현
@Copyright (c) 2026 [init]. All rights reserved.
@vLicense: MIT License
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Optional
import logging
import re

from backend.database_helper import execute_query, SqlLoader
from backend.database import get_db_connection
from backend.target_database import get_target_connection_id, get_target_db_connection
from backend.auth_context import get_request_user_id

logger = logging.getLogger(__name__)
router = APIRouter()


class TableRequest(BaseModel):
    owner: Optional[str] = None
    tableName: Optional[str] = None
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


class ScenarioTableRequest(BaseModel):
    scenarioTableId: Optional[int] = None
    projectId: Optional[int] = None
    scenarioId: Optional[int] = None
    ownerName: Optional[str] = None
    tableName: Optional[str] = None
    tableComment: Optional[str] = None
    useYn: Optional[str] = "Y"
    sortOrder: Optional[int] = None
    model_config = ConfigDict(extra="allow")


class ScenarioTableDeleteRequest(BaseModel):
    scenarioTableId: int
    projectId: int
    scenarioId: int
    model_config = ConfigDict(extra="allow")


class ScenarioTableDeleteAllRequest(BaseModel):
    projectId: int
    scenarioId: int
    model_config = ConfigDict(extra="allow")


@router.get("/table-tree")
def get_table_tree(
    request: Request,
    keyword: str = Query(""),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
):
    conn = None
    try:
        conn = get_target_db_connection(request)
        exclude_patterns = get_table_exclude_patterns(request)
        include_owner_patterns = get_table_include_owner_patterns(request, conn)
        safe_offset = max(0, int(offset or 0))
        safe_limit = max(1, min(int(limit or 200), 500))
        keyword_text = str(keyword or "").strip().upper()
        padded_excludes = (exclude_patterns + [None] * 5)[:5]
        result = execute_query(conn, "M02002_TABLE_TREE", {
            "keyword": f"%{keyword_text}%" if keyword_text else None,
            "ownerPattern": include_owner_patterns[0] if include_owner_patterns else None,
            "excludePattern1": padded_excludes[0],
            "excludePattern2": padded_excludes[1],
            "excludePattern3": padded_excludes[2],
            "excludePattern4": padded_excludes[3],
            "excludePattern5": padded_excludes[4],
            "offset": safe_offset,
            "endRow": safe_offset + safe_limit + 1,
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Table tree query failed.")
        raw_data = result.get("data", [])
        has_more = len(raw_data) > safe_limit
        data = raw_data[:safe_limit]
        return {
            "status": "success",
            "data": data,
            "columns": result.get("columns", []),
            "total": len(data),
            "offset": safe_offset,
            "limit": safe_limit,
            "nextOffset": safe_offset + len(data),
            "hasMore": has_more
        }
    finally:
        if conn:
            conn.close()


@router.post("/table-info")
def get_table_info(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_TABLE_INFO", {"owner": owner, "tableName": table_name})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Table info query failed.")
        data = result.get("data", [])
        return {
            "status": "success",
            "data": data[0] if data else {},
            "columns": result.get("columns", []),
            "total": len(data)
        }
    finally:
        if conn:
            conn.close()


@router.post("/columns")
def get_columns(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_TABLE_COLUMNS", {"owner": owner, "tableName": table_name})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Column query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/data")
def get_table_data(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    limit = normalize_limit(req.limit)
    qualified_table = quote_identifier(owner) + "." + quote_identifier(table_name)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(
            conn,
            "M02002_TABLE_DATA",
            {
                "dynamicTable": qualified_table,
                "limit": limit
            }
        )
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Data query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
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
        result = execute_query(
            conn,
            "M02002_SQL_WORKSHEET",
            {
                "dynamicSql": sql,
                "limit": limit
            }
        )
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "SQL execution failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


@router.get("/scenario-tables")
def get_scenario_tables(request: Request, projectId: int, scenarioId: int):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_SCENARIO_TABLE_LIST", {
            "projectId": projectId,
            "scenarioId": scenarioId
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Scenario table query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/scenario-table/save")
def save_scenario_table(req: ScenarioTableRequest, request: Request):
    project_id = require_int(req.projectId, "projectId")
    scenario_id = require_int(req.scenarioId, "scenarioId")
    owner_name = (req.ownerName or "").strip().upper()
    table_name = (req.tableName or "").strip().upper()
    if not owner_name or not table_name:
        raise HTTPException(status_code=400, detail="ownerName and tableName are required.")
    if not is_identifier(owner_name) or not is_identifier(table_name):
        raise HTTPException(status_code=400, detail="Invalid owner or table name.")

    params = {
        "scenarioTableId": req.scenarioTableId,
        "projectId": project_id,
        "scenarioId": scenario_id,
        "ownerName": owner_name,
        "tableName": table_name,
        "tableComment": req.tableComment or "",
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "sortOrder": req.sortOrder
    }

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        if req.scenarioTableId:
            update_params = {
                "scenarioTableId": req.scenarioTableId,
                "projectId": project_id,
                "scenarioId": scenario_id,
                "tableComment": params["tableComment"],
                "useYn": params["useYn"],
                "sortOrder": params["sortOrder"]
            }
            cursor.execute(SqlLoader.get_sql("M02002_SCENARIO_TABLE_UPDATE"), update_params)
            scenario_table_id = req.scenarioTableId
        else:
            insert_params = {key: value for key, value in params.items() if key != "scenarioTableId"}
            cursor.execute(SqlLoader.get_sql("M02002_SCENARIO_TABLE_INSERT"), insert_params)
            cursor.execute(SqlLoader.get_sql("M02002_SCENARIO_TABLE_ID_BY_KEY"), {
                "projectId": project_id,
                "scenarioId": scenario_id,
                "ownerName": owner_name,
                "tableName": table_name
            })
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Saved scenario table ID could not be found.")
            scenario_table_id = row[0]
        conn.commit()

        result = execute_query(conn, "M02002_SCENARIO_TABLE_LIST", {
            "projectId": project_id,
            "scenarioId": scenario_id
        })
        data = result.get("data", [])
        saved = next((row for row in data if row.get("SCENARIO_TABLE_ID") == scenario_table_id), None)
        return {
            "status": "success",
            "message": "Scenario table saved.",
            "data": saved or {},
            "list": data
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M02002 scenario table save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/scenario-table/delete")
def delete_scenario_table(req: ScenarioTableDeleteRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_SCENARIO_TABLE_DELETE", {
            "scenarioTableId": req.scenarioTableId,
            "projectId": req.projectId,
            "scenarioId": req.scenarioId
        }, is_dml=True)
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Scenario table delete failed.")
        return {
            "status": "success",
            "message": "Scenario table deleted.",
            "deletedCount": result.get("rowcount", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/scenario-table/delete-all")
def delete_all_scenario_tables(req: ScenarioTableDeleteAllRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_SCENARIO_TABLE_DELETE_ALL", {
            "projectId": req.projectId,
            "scenarioId": req.scenarioId
        }, is_dml=True)
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Scenario table delete failed.")
        return {
            "status": "success",
            "message": "Scenario tables deleted.",
            "deletedCount": result.get("rowcount", 0)
        }
    finally:
        if conn:
            conn.close()


def require_table(req: TableRequest) -> tuple[str, str]:
    owner = (req.owner or "").strip().upper()
    table_name = (req.tableName or "").strip().upper()
    if not owner or not table_name:
        raise HTTPException(status_code=400, detail="owner and tableName are required.")
    if not is_identifier(owner) or not is_identifier(table_name):
        raise HTTPException(status_code=400, detail="Invalid owner or table name.")
    return owner, table_name


def require_int(value: Optional[int], field_name: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    if result <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    return result


def normalize_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 100)
    except (TypeError, ValueError):
        limit = 100
    return max(1, min(limit, 1000))


def get_table_exclude_patterns(request: Request) -> list[str]:
    patterns = ["BIN$%", "DM$%", "INIT$%"]
    conn = None
    cursor = None
    try:
        user_id = get_request_user_id(request)
        connection_id = get_target_connection_id(request)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M02002_EXCLUDE_TABLE_FILTER_SETTING"), {"userId": user_id, "connectionId": connection_id})
        row = cursor.fetchone()
        if row and row[0]:
            raw_value = row[0].read() if hasattr(row[0], "read") else row[0]
            custom_patterns = parse_setting_lines(raw_value)
            if custom_patterns:
                patterns = custom_patterns
    except Exception as e:
        logger.warning(f"M02002 setting pattern load failed, using defaults: {str(e)}")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    return patterns


def get_table_include_owner_patterns(request: Request, target_conn) -> list[str]:
    patterns = [get_current_target_owner(target_conn)]
    conn = None
    cursor = None
    try:
        user_id = get_request_user_id(request)
        connection_id = get_target_connection_id(request)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M02002_INCLUDE_OWNER_FILTER_SETTING"), {"userId": user_id, "connectionId": connection_id})
        row = cursor.fetchone()
        if row and row[0]:
            raw_value = row[0].read() if hasattr(row[0], "read") else row[0]
            custom_patterns = parse_setting_lines(raw_value)
            if custom_patterns:
                patterns = custom_patterns
    except Exception as e:
        logger.warning(f"M02002 include owner setting load failed, using current owner: {str(e)}")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    return [pattern for pattern in patterns if pattern]


def get_current_target_owner(conn) -> str:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M02002_CURRENT_SCHEMA"))
        row = cursor.fetchone()
        return str(row[0] if row and row[0] else "").strip().upper()
    finally:
        if cursor:
            cursor.close()


def parse_setting_lines(value) -> list[str]:
    return [
        line.strip().upper()
        for line in str(value or "").replace(",", "\n").splitlines()
        if line.strip()
    ]


def is_identifier(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Z][A-Z0-9_$#]*", value))


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
