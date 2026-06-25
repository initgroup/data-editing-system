"""
@file           M04002.py
@description    Integrated editing result analysis API
"""

from datetime import date, datetime
from decimal import Decimal
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.database_helper import SqlLoader, execute_query
from backend.target_database import get_target_db_connection


logger = logging.getLogger(__name__)
router = APIRouter()

IDENTIFIER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")
MODEL_DETAIL_VIEW_TYPES = {
    "VA": "Attribute/detail view",
    "VG": "Global/detail view",
    "VI": "Itemset/detail view",
    "VR": "Rule/detail view",
}


def _read_lob(value: Any) -> Any:
    if hasattr(value, "read"):
        return value.read()
    return value


def _serialize_db_value(value: Any) -> Any:
    value = _read_lob(value)
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except Exception:
            return value.hex()
    return value


def _row_to_dict(columns: list[str], row: Any) -> dict[str, Any]:
    return {columns[index]: _serialize_db_value(value) for index, value in enumerate(row)}


def _parse_json(value: Any, default: Any = None) -> Any:
    text = _read_lob(value)
    if text is None or text == "":
        return default
    if isinstance(text, (dict, list)):
        return text
    try:
        return json.loads(str(text))
    except Exception:
        return default


def _validate_identifier(value: str, label: str) -> str:
    text = str(value or "").strip().upper()
    if not IDENTIFIER_RE.match(text):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return text


def _quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _normalize_page(page: int | None) -> int:
    try:
        value = int(page or 1)
    except (TypeError, ValueError):
        value = 1
    return max(1, value)


def _normalize_page_size(page_size: int | None, default: int = 50, maximum: int = 500) -> int:
    try:
        value = int(page_size or default)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, maximum))


def _page_window(page: int, page_size: int) -> tuple[int, int]:
    offset = (page - 1) * page_size
    return offset, offset + page_size


def _normalize_node_result(row: dict[str, Any]) -> dict[str, Any]:
    payload = _parse_json(row.get("NODE_PAYLOAD_JSON"), {}) or {}
    runtime_params = _parse_json(row.get("RUNTIME_PARAM_JSON"), {}) or {}
    mode = str(payload.get("resultCreateYn") or payload.get("RESULT_CREATE_YN") or "N").strip().upper()
    mode = mode if mode in ("N", "T", "M") else "N"
    owner = payload.get("resultOwner") or payload.get("RESULT_OWNER") or payload.get("ownerName") or ""
    object_name = payload.get("resultTableName") or payload.get("RESULT_TABLE_NAME") or payload.get("tableName") or ""
    menu_code = payload.get("refMenuCode") or payload.get("menuCode") or payload.get("REF_MENU_CODE") or ""
    row["PAYLOAD"] = payload
    row["RUNTIME_PARAMS"] = runtime_params
    row["REF_MENU_CODE"] = str(menu_code or "").strip().upper()
    row["RESULT_CREATE_YN"] = mode
    row["RESULT_OWNER"] = str(owner or "").strip().upper()
    row["RESULT_OBJECT_NAME"] = str(object_name or "").strip().upper()
    row["RESULT_KIND"] = "MODEL" if mode == "M" else ("TABLE" if mode == "T" else "NONE")
    return row


def _fetch_dynamic_page(cursor, base_sql: str, page: int, page_size: int, params: dict[str, Any] | None = None) -> dict[str, Any]:
    offset, end_row = _page_window(page, page_size)
    cursor.execute(f"SELECT COUNT(*) FROM ({base_sql})", params or {})
    total = int(cursor.fetchone()[0] or 0)
    paged_sql = (
        "SELECT * FROM ("
        " SELECT Q.*, ROWNUM AS RN__ FROM ("
        f"  {base_sql}"
        " ) Q WHERE ROWNUM <= :endRow"
        ") WHERE RN__ > :offset"
    )
    cursor.execute(paged_sql, {**(params or {}), "offset": offset, "endRow": end_row})
    columns = [desc[0] for desc in cursor.description]
    rows = [_row_to_dict(columns, row) for row in cursor.fetchall()]
    for row in rows:
        row.pop("RN__", None)
    return {
        "columns": [column for column in columns if column != "RN__"],
        "data": rows,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/runs")
def list_flow_runs(request: Request, page: int = 1, pageSize: int = 20, status: str = "ALL", keyword: str | None = None):
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 20, 100)
    offset, end_row = _page_window(page, page_size)
    normalized_status = str(status or "ALL").strip().upper()
    if normalized_status not in {"ALL", "SUCCESS", "FAILED", "STARTED", "RUNNING", "QUEUED", "SKIPPED", "ERROR"}:
        normalized_status = "ALL"
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M04002_FLOW_RUN_LIST"), {
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
            "status": normalized_status,
            "keyword": str(keyword).strip() if keyword else None,
            "offset": offset,
            "endRow": end_row,
        })
        columns = [desc[0] for desc in cursor.description]
        rows = [_row_to_dict(columns, row) for row in cursor.fetchall()]
        total = int(rows[0].get("TOTAL_COUNT") or 0) if rows else 0
        for row in rows:
            row.pop("RN__", None)
        return {"status": "success", "data": rows, "columns": columns, "total": total, "page": page, "pageSize": page_size}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/runs/{flow_run_id}/nodes")
def list_flow_run_nodes(flow_run_id: int, request: Request):
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_FLOW_RUN_NODES"), {
            "flowRunId": flow_run_id,
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
        })
        columns = [desc[0] for desc in cursor.description]
        rows = [_normalize_node_result(_row_to_dict(columns, row)) for row in cursor.fetchall()]
        return {"status": "success", "data": rows, "columns": columns, "total": len(rows)}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/result-table")
def get_result_table(request: Request, owner: str, objectName: str, menuCode: str | None = None, page: int = 1, pageSize: int = 50):
    owner_name = _validate_identifier(owner, "owner")
    object_name = _validate_identifier(objectName, "object name")
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 50, 500)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        where_sql = ""
        order_sql = ""
        if str(menuCode or "").upper() == "M03002" and object_name == "INIT$_TB_CAT_CORR_PAIR":
            where_sql = " WHERE PASS_YN = 'Y'"
            order_sql = " ORDER BY CRAMERS_V DESC, P_VALUE ASC"
        base_sql = f"SELECT * FROM {_quote_identifier(owner_name)}.{_quote_identifier(object_name)}{where_sql}{order_sql}"
        result = _fetch_dynamic_page(cursor, base_sql, page, page_size)
        return {"status": "success", "owner": owner_name, "objectName": object_name, **result}
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("M04002 result table query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/model-view")
def get_model_view(request: Request, owner: str, modelName: str, viewType: str = "VR", page: int = 1, pageSize: int = 50):
    owner_name = _validate_identifier(owner, "owner")
    model_name = _validate_identifier(modelName, "model name")
    view_type = str(viewType or "VR").strip().upper()
    if view_type not in MODEL_DETAIL_VIEW_TYPES:
        raise HTTPException(status_code=400, detail="Invalid model view type.")
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 50, 500)
    view_name = f"DM${view_type}{model_name}"
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "DATA_WORK_MODEL_DETAIL_VIEW_LIST", {
            "owner": owner_name,
            "viewNameVa": f"DM$VA{model_name}",
            "viewNameVg": f"DM$VG{model_name}",
            "viewNameVi": f"DM$VI{model_name}",
            "viewNameVn": f"DM$VN{model_name}",
            "viewNameVp": f"DM$VP{model_name}",
            "viewNameVr": f"DM$VR{model_name}",
            "viewNameVt": f"DM$VT{model_name}",
        })
        meta = next((row for row in result.get("data", []) if row.get("VIEW_TYPE") == view_type), None)
        if not meta or meta.get("EXISTS_YN") != "Y":
            return {
                "status": "success",
                "owner": owner_name,
                "modelName": model_name,
                "viewType": view_type,
                "viewName": view_name,
                "description": MODEL_DETAIL_VIEW_TYPES[view_type],
                "existsYn": "N",
                "columns": [],
                "data": [],
                "total": 0,
                "page": page,
                "pageSize": page_size,
            }
        cursor = conn.cursor()
        object_sql = f"{_quote_identifier(owner_name)}.{_quote_identifier(view_name)}"
        cursor.execute(f"SELECT * FROM {object_sql} WHERE 1 = 0")
        available_columns = {desc[0].upper() for desc in cursor.description}
        order_columns = [column for column in ("RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT") if column in available_columns]
        order_sql = f" ORDER BY {', '.join(f'{column} DESC' for column in order_columns)}" if order_columns else ""
        base_sql = f"SELECT * FROM {object_sql}{order_sql}"
        result_page = _fetch_dynamic_page(cursor, base_sql, page, page_size)
        return {
            "status": "success",
            "owner": owner_name,
            "modelName": model_name,
            "viewType": view_type,
            "viewName": view_name,
            "description": MODEL_DETAIL_VIEW_TYPES[view_type],
            "existsYn": "Y",
            **result_page,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("M04002 model view query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
