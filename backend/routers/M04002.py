"""
@file           M04002.py
@description    Integrated editing result analysis API
"""

from datetime import date, datetime
from decimal import Decimal
import json
import logging
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
READABLE_RULE_SUMMARY_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any] | None]] = {}
READABLE_RULE_SUMMARY_CACHE_TTL_SECONDS = 600


class SqlRequest(BaseModel):
    sql: str
    page: int = 1
    pageSize: int = 50


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


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, list):
        return {}

    result: dict[str, Any] = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        key = (
            item.get("itemName")
            or item.get("ITEM_NAME")
            or item.get("name")
            or item.get("NAME")
            or item.get("key")
            or item.get("KEY")
            or item.get("bindName")
            or item.get("BIND_NAME")
        )
        if not key:
            continue
        result[str(key)] = (
            item.get("value")
            if "value" in item
            else item.get("VALUE")
            if "VALUE" in item
            else item.get("itemDefault")
            if "itemDefault" in item
            else item.get("ITEM_DEFAULT")
        )
    return result


def _validate_identifier(value: str, label: str) -> str:
    text = str(value or "").strip().upper()
    if not IDENTIFIER_RE.match(text):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return text


def _quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _find_column(columns: set[str], candidates: list[str]) -> str | None:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    for candidate in candidates:
        found = next((column for column in columns if candidate in column), None)
        if found:
            return found
    return None


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
    payload = _json_object(_parse_json(row.get("NODE_PAYLOAD_JSON"), {}) or {})
    runtime_params = _json_object(_parse_json(row.get("RUNTIME_PARAM_JSON"), {}) or {})
    mode = str(payload.get("resultCreateYn") or payload.get("RESULT_CREATE_YN") or "N").strip().upper()
    mode = mode if mode in ("N", "T", "M") else "N"
    owner = payload.get("resultOwner") or payload.get("RESULT_OWNER") or payload.get("ownerName") or ""
    object_name = payload.get("resultTableName") or payload.get("RESULT_TABLE_NAME") or payload.get("tableName") or ""
    menu_code = payload.get("refMenuCode") or payload.get("menuCode") or payload.get("REF_MENU_CODE") or row.get("REF_MENU_CODE") or ""
    target_owner = (
        runtime_params.get("INIT$TargetOwner")
        or runtime_params.get("targetOwner")
        or runtime_params.get("TARGET_OWNER")
        or payload.get("targetOwner")
        or payload.get("ownerName")
        or payload.get("OWNER_NAME")
        or ""
    )
    target_table = (
        runtime_params.get("INIT$TargetTable")
        or runtime_params.get("targetTable")
        or runtime_params.get("TARGET_TABLE")
        or payload.get("targetTable")
        or payload.get("tableName")
        or payload.get("TABLE_NAME")
        or ""
    )
    row["PAYLOAD"] = payload
    row["RUNTIME_PARAMS"] = runtime_params
    row["REF_MENU_CODE"] = str(menu_code or "").strip().upper()
    row["RESULT_CREATE_YN"] = mode
    row["RESULT_OWNER"] = str(owner or "").strip().upper()
    row["RESULT_OBJECT_NAME"] = str(object_name or "").strip().upper()
    row["TARGET_OWNER"] = str(target_owner or "").strip().upper()
    row["TARGET_TABLE"] = str(target_table or "").strip().upper()
    row["RESULT_KIND"] = "MODEL" if mode == "M" else ("TABLE" if mode == "T" else "NONE")
    return row


def _get_table_columns(cursor, owner_name: str, object_name: str) -> set[str]:
    cursor.execute(SqlLoader.get_sql("M04002_RESULT_TABLE_COLUMNS"), {"owner": owner_name, "tableName": object_name})
    return {str(row[0]).upper() for row in cursor.fetchall()}


def _fetch_column_comment_map(cursor, owner_name: str, table_name: str) -> dict[str, str]:
    if not owner_name or not table_name:
        return {}
    cursor.execute(SqlLoader.get_sql("M04002_TARGET_COLUMN_COMMENTS"), {
        "owner": owner_name,
        "tableName": table_name,
    })
    comments: dict[str, str] = {}
    for column_name, column_comment in cursor.fetchall():
        if column_name and column_comment:
            comments[str(column_name).upper()] = str(column_comment)
    return comments


def _fetch_cat_corr_summary(cursor, owner_name: str, object_name: str, target_owner: str, target_table: str) -> dict[str, Any] | None:
    if object_name != "INIT$_TB_CAT_CORR_PAIR" or not target_owner or not target_table:
        return None
    cursor.execute(SqlLoader.get_sql("M04002_TARGET_TABLE_COLUMN_COUNT"), {
        "owner": target_owner,
        "tableName": target_table,
    })
    row = cursor.fetchone()
    total_columns = int(row[0] or 0) if row else 0
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    cursor.execute(
        "SELECT DISTINCT COL1 "
        "  FROM ("
        f"        SELECT COL_A AS COL1 FROM {result_object} "
        "         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable AND PASS_YN = 'Y' "
        "         UNION ALL "
        f"        SELECT COL_B AS COL1 FROM {result_object} "
        "         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable AND PASS_YN = 'Y' "
        "       ) "
        " WHERE COL1 IS NOT NULL "
        " ORDER BY COL1",
        {"targetOwner": target_owner, "targetTable": target_table},
    )
    associated_columns = [str(item[0]) for item in cursor.fetchall() if item and item[0]]
    cursor.execute(
        f"SELECT COUNT(*) FROM {result_object} "
        " WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable AND PASS_YN = 'Y'",
        {"targetOwner": target_owner, "targetTable": target_table},
    )
    pair_row = cursor.fetchone()
    column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "totalColumnCount": total_columns,
        "associatedColumnCount": len(associated_columns),
        "associatedColumns": associated_columns,
        "columnComments": column_comments,
        "associatedPairCount": int(pair_row[0] or 0) if pair_row else 0,
    }


def _fetch_predicted_type_summary(cursor, owner_name: str, object_name: str, target_owner: str, target_table: str) -> dict[str, Any] | None:
    if object_name != "INIT$_TB_PREDICTED_TYPE" or not target_owner or not target_table:
        return None
    cursor.execute(SqlLoader.get_sql("M04002_TARGET_TABLE_COLUMN_COUNT"), {
        "owner": target_owner,
        "tableName": target_table,
    })
    row = cursor.fetchone()
    total_columns = int(row[0] or 0) if row else 0
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    cursor.execute(
        "SELECT TYPE_GROUP, COLUMN_NAME "
        "  FROM ("
        "        SELECT CASE "
        "                 WHEN MODL_PREDICTED_TYPE LIKE '%범주형' THEN '범주형' "
        "                 WHEN MODL_PREDICTED_TYPE LIKE '%연속형' THEN '연속형' "
        "                 ELSE '기타' "
        "               END AS TYPE_GROUP, "
        "               COLUMN_NAME, "
        "               MIN(NVL(COLUMN_ID, 999999)) AS COLUMN_ORDER "
        f"          FROM {result_object} "
        "         WHERE OWNER = :targetOwner "
        "           AND TABLE_NAME = :targetTable "
        "           AND COLUMN_NAME IS NOT NULL "
        "         GROUP BY CASE "
        "                    WHEN MODL_PREDICTED_TYPE LIKE '%범주형' THEN '범주형' "
        "                    WHEN MODL_PREDICTED_TYPE LIKE '%연속형' THEN '연속형' "
        "                    ELSE '기타' "
        "                  END, COLUMN_NAME "
        "       ) "
        " ORDER BY DECODE(TYPE_GROUP, '범주형', 1, '연속형', 2, 3), COLUMN_ORDER, COLUMN_NAME",
        {"targetOwner": target_owner, "targetTable": target_table},
    )
    group_map: dict[str, list[str]] = {"범주형": [], "연속형": [], "기타": []}
    for type_group, column_name in cursor.fetchall():
        key = str(type_group or "기타")
        group_map.setdefault(key, []).append(str(column_name))
    cursor.execute(
        "SELECT NVL(MODL_PREDICTED_TYPE, '(값 없음)') AS TYPE_NAME, "
        "       COUNT(DISTINCT COLUMN_NAME) AS COLUMN_COUNT "
        f"  FROM {result_object} "
        " WHERE OWNER = :targetOwner "
        "   AND TABLE_NAME = :targetTable "
        " GROUP BY NVL(MODL_PREDICTED_TYPE, '(값 없음)') "
        " ORDER BY COLUMN_COUNT DESC, TYPE_NAME",
        {"targetOwner": target_owner, "targetTable": target_table},
    )
    detail_groups = [
        {"typeName": str(type_name), "columnCount": int(column_count or 0)}
        for type_name, column_count in cursor.fetchall()
    ]
    column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "totalColumnCount": total_columns,
        "columnComments": column_comments,
        "summaryGroups": [
            {"typeGroup": key, "columnCount": len(columns), "columns": columns}
            for key, columns in group_map.items()
            if columns or key in ("범주형", "연속형")
        ],
        "detailGroups": detail_groups,
    }


def _fetch_rule_violation_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    rule_model_name: str = "",
) -> dict[str, Any] | None:
    if object_name != "INIT$_TB_RULE_VIOLATION_RESULT":
        return None
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    where_clauses = []
    bind_params: dict[str, Any] = {}
    if target_owner:
        where_clauses.append("TARGET_OWNER = :targetOwner")
        bind_params["targetOwner"] = target_owner
    if target_table:
        where_clauses.append("TARGET_TABLE = :targetTable")
        bind_params["targetTable"] = target_table
    if rule_model_name:
        where_clauses.append("MODEL_NAME = :ruleModelName")
        bind_params["ruleModelName"] = rule_model_name
    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    def fetch_one(sql: str) -> dict[str, Any]:
        cursor.execute(sql, bind_params)
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        return {column: _serialize_db_value(value) for column, value in zip(columns, row)} if row else {}

    def fetch_many(sql: str) -> list[dict[str, Any]]:
        cursor.execute(sql, bind_params)
        columns = [desc[0] for desc in cursor.description]
        return [
            {column: _serialize_db_value(value) for column, value in zip(columns, row)}
            for row in cursor.fetchall()
        ]

    overview = fetch_one(
        "SELECT COUNT(*) AS VIOLATION_COUNT, "
        "       COUNT(DISTINCT NVL(CASE_ID, CASE_ROWID)) AS VIOLATED_ROW_COUNT, "
        "       COUNT(DISTINCT RULE_ID) AS VIOLATED_RULE_COUNT, "
        "       AVG(VIOLATION_SCORE) AS AVG_VIOLATION_SCORE, "
        "       MAX(VIOLATION_SCORE) AS MAX_VIOLATION_SCORE, "
        "       AVG(RULE_CONFIDENCE) AS AVG_RULE_CONFIDENCE, "
        "       MAX(RULE_CONFIDENCE) AS MAX_RULE_CONFIDENCE "
        f"  FROM {result_object}{where_sql}"
    )
    top_rules = fetch_many(
        "SELECT * FROM ("
        "        SELECT RULE_ID, "
        "               MIN(DBMS_LOB.SUBSTR(CONDITION_TEXT, 4000, 1)) AS CONDITION_TEXT, "
        "               RESULT_COLUMN, "
        "               EXPECTED_VALUE, "
        "               COUNT(*) AS VIOLATION_COUNT, "
        "               COUNT(DISTINCT NVL(CASE_ID, CASE_ROWID)) AS VIOLATED_ROW_COUNT, "
        "               AVG(VIOLATION_SCORE) AS AVG_VIOLATION_SCORE, "
        "               MAX(RULE_CONFIDENCE) AS RULE_CONFIDENCE, "
        "               MAX(RULE_LIFT) AS RULE_LIFT "
        f"          FROM {result_object}{where_sql} "
        "         GROUP BY RULE_ID, RESULT_COLUMN, EXPECTED_VALUE "
        "         ORDER BY VIOLATION_COUNT DESC, AVG_VIOLATION_SCORE DESC, RULE_ID"
        "       ) WHERE ROWNUM <= 8"
    )
    top_columns = fetch_many(
        "SELECT * FROM ("
        "        SELECT RESULT_COLUMN, "
        "               COUNT(*) AS VIOLATION_COUNT, "
        "               COUNT(DISTINCT NVL(CASE_ID, CASE_ROWID)) AS VIOLATED_ROW_COUNT, "
        "               AVG(VIOLATION_SCORE) AS AVG_VIOLATION_SCORE "
        f"          FROM {result_object}{where_sql} "
        "         GROUP BY RESULT_COLUMN "
        "         ORDER BY VIOLATION_COUNT DESC, AVG_VIOLATION_SCORE DESC, RESULT_COLUMN"
        "       ) WHERE ROWNUM <= 12"
    )
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "ruleModelName": rule_model_name,
        "overview": overview,
        "topRules": top_rules,
        "topColumns": top_columns,
        "columnComments": _fetch_column_comment_map(cursor, target_owner, target_table),
    }


def _fetch_readable_rule_summary(cursor, owner_name: str, view_name: str) -> dict[str, Any] | None:
    cache_key = (owner_name, view_name)
    cached = READABLE_RULE_SUMMARY_CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < READABLE_RULE_SUMMARY_CACHE_TTL_SECONDS:
        return cached[1]
    object_sql = f"{_quote_identifier(owner_name)}.{_quote_identifier(view_name)}"
    cursor.execute(f"SELECT * FROM {object_sql} WHERE 1 = 0")
    columns = {desc[0].upper() for desc in cursor.description}
    antecedent_column = _find_column(columns, ["ANTECEDENT", "ANTECEDENT_ITEMS", "LHS", "PREMISE", "CONDITION", "IF"])
    consequent_column = _find_column(columns, ["CONSEQUENT", "RHS", "PREDICT", "OUTCOME", "THEN"])
    if not antecedent_column or not consequent_column:
        READABLE_RULE_SUMMARY_CACHE[cache_key] = (now, None)
        return None
    antecedent_sql = _quote_identifier(antecedent_column)
    consequent_sql = _quote_identifier(consequent_column)
    cursor.execute(
        "SELECT CONDITION_COUNT, "
        "       COUNT(*) AS RULE_COUNT, "
        "       SUM(CASE WHEN CONDITION_COUNT > 0 AND RESULT_HAS_ITEM = 1 THEN 1 ELSE 0 END) AS MAPPED_RULES, "
        "       SUM(CASE WHEN RESULT_HAS_ITEM = 0 OR RESULT_HAS_VALUE = 0 THEN 1 ELSE 0 END) AS MISSING_RESULT_RULES "
        "  FROM ("
        "        SELECT CONDITION_COUNT, "
        "               CASE WHEN INSTR(CONSEQUENT_TEXT, '<item') > 0 THEN 1 ELSE 0 END AS RESULT_HAS_ITEM, "
        "               CASE WHEN INSTR(CONSEQUENT_TEXT, '<item_value>') > 0 "
        "                     AND INSTR(CONSEQUENT_TEXT, '<item_value></item_value>') = 0 "
        "                    THEN 1 ELSE 0 END AS RESULT_HAS_VALUE "
        "          FROM ("
        "                SELECT REGEXP_COUNT(NVL(" + antecedent_sql + ", ''), '<item([[:space:]>])', 1, 'i') AS CONDITION_COUNT, "
        "                       LOWER(NVL(" + consequent_sql + ", '')) AS CONSEQUENT_TEXT "
        f"                  FROM {object_sql}"
        "               )"
        "       ) "
        " GROUP BY CONDITION_COUNT "
        " ORDER BY CONDITION_COUNT",
    )
    grouped_rows = cursor.fetchall()
    condition_buckets = [
        {
            "conditionCount": int(condition_count or 0),
            "label": f"조건 {int(condition_count or 0)}개" if int(condition_count or 0) > 0 else "조건 미해석",
            "count": int(rule_count or 0),
        }
        for condition_count, rule_count, _mapped_rules, _missing_result_rules in grouped_rows
    ]
    total = sum(int(row[1] or 0) for row in grouped_rows)
    mapped = sum(int(row[2] or 0) for row in grouped_rows)
    missing = sum(int(row[3] or 0) for row in grouped_rows)
    summary = {
        "basis": "all",
        "total": total,
        "mapped": mapped,
        "missingResult": missing,
        "limited": max(0, total - mapped),
        "conditionBuckets": condition_buckets,
    }
    READABLE_RULE_SUMMARY_CACHE[cache_key] = (now, summary)
    return summary


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


def _normalize_select_sql(sql_text: str) -> str:
    sql = re.sub(r";+\s*$", "", str(sql_text or "").strip())
    if not sql:
        raise HTTPException(status_code=400, detail="SQL is required.")
    if re.search(r";\s*\S", sql):
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    if not re.match(r"(?is)^(select|with)\b", sql):
        raise HTTPException(status_code=400, detail="Only SELECT/WITH SQL can be executed here.")
    blocked = r"(?is)\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|begin|declare|execute|call)\b"
    if re.search(blocked, sql):
        raise HTTPException(status_code=400, detail="DML, DDL, and PL/SQL are not allowed here.")
    return sql


@router.get("/runs")
def list_flow_runs(
    request: Request,
    page: int = 1,
    pageSize: int = 20,
    status: str = "ALL",
    keyword: str | None = None,
    projectId: int | None = None,
    scenarioId: int | None = None,
):
    if not projectId:
        raise HTTPException(status_code=400, detail="Project is required.")
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
            "projectId": projectId,
            "scenarioId": scenarioId,
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


@router.get("/runs/{flow_run_id}/position")
def get_flow_run_position(
    flow_run_id: int,
    request: Request,
    pageSize: int = 20,
    status: str = "ALL",
    keyword: str | None = None,
    projectId: int | None = None,
    scenarioId: int | None = None,
):
    if not projectId:
        raise HTTPException(status_code=400, detail="Project is required.")
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    page_size = _normalize_page_size(pageSize, 20, 100)
    normalized_status = str(status or "ALL").strip().upper()
    if normalized_status not in {"ALL", "SUCCESS", "FAILED", "STARTED", "RUNNING", "QUEUED", "SKIPPED", "ERROR"}:
        normalized_status = "ALL"
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M04002_FLOW_RUN_POSITION"), {
            "flowRunId": flow_run_id,
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
            "projectId": projectId,
            "scenarioId": scenarioId,
            "status": normalized_status,
            "keyword": str(keyword).strip() if keyword else None,
        })
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Run is not included in the current filters.")
        row_no = int(row[0] or 1)
        page = max(1, ((row_no - 1) // page_size) + 1)
        return {"status": "success", "flowRunId": flow_run_id, "rowNumber": row_no, "page": page, "pageSize": page_size}
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


@router.post("/sql")
def execute_select_sql(req: SqlRequest, request: Request):
    sql = _normalize_select_sql(req.sql)
    page = _normalize_page(req.page)
    page_size = _normalize_page_size(req.pageSize, 50, 500)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        result = _fetch_dynamic_page(cursor, sql, page, page_size)
        return {
            "status": "success",
            **result,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("M04002 SQL query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/result-table")
def get_result_table(
    request: Request,
    owner: str,
    objectName: str,
    menuCode: str | None = None,
    targetOwner: str | None = None,
    targetTable: str | None = None,
    ruleModelName: str | None = None,
    page: int = 1,
    pageSize: int = 50,
):
    owner_name = _validate_identifier(owner, "owner")
    object_name = _validate_identifier(objectName, "object name")
    target_owner = _validate_identifier(targetOwner, "target owner") if targetOwner else ""
    target_table = _validate_identifier(targetTable, "target table") if targetTable else ""
    rule_model_name = _validate_identifier(ruleModelName, "rule model name") if ruleModelName else ""
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 50, 500)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        columns = _get_table_columns(cursor, owner_name, object_name)
        where_clauses = []
        bind_params: dict[str, Any] = {}
        order_sql = ""
        if str(menuCode or "").upper() == "M03002" and object_name == "INIT$_TB_CAT_CORR_PAIR":
            where_clauses.append("PASS_YN = 'Y'")
            order_sql = " ORDER BY CRAMERS_V DESC, P_VALUE ASC"
        if object_name == "INIT$_TB_RULE_VIOLATION_RESULT":
            order_sql = " ORDER BY VIOLATION_SCORE DESC NULLS LAST, RULE_CONFIDENCE DESC NULLS LAST, VIOLATION_ID"
        if target_owner and "OWNER" in columns:
            where_clauses.append("OWNER = :targetOwner")
            bind_params["targetOwner"] = target_owner
        elif target_owner and "TARGET_OWNER" in columns:
            where_clauses.append("TARGET_OWNER = :targetOwner")
            bind_params["targetOwner"] = target_owner
        if target_table and "TABLE_NAME" in columns:
            where_clauses.append("TABLE_NAME = :targetTable")
            bind_params["targetTable"] = target_table
        elif target_table and "TARGET_TABLE" in columns:
            where_clauses.append("TARGET_TABLE = :targetTable")
            bind_params["targetTable"] = target_table
        if object_name == "INIT$_TB_RULE_VIOLATION_RESULT" and rule_model_name and "MODEL_NAME" in columns:
            where_clauses.append("MODEL_NAME = :ruleModelName")
            bind_params["ruleModelName"] = rule_model_name
        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        base_sql = f"SELECT * FROM {_quote_identifier(owner_name)}.{_quote_identifier(object_name)}{where_sql}{order_sql}"
        result = _fetch_dynamic_page(cursor, base_sql, page, page_size, bind_params)
        cat_corr_summary = _fetch_cat_corr_summary(cursor, owner_name, object_name, target_owner, target_table)
        predicted_type_summary = _fetch_predicted_type_summary(cursor, owner_name, object_name, target_owner, target_table)
        violation_summary = _fetch_rule_violation_summary(cursor, owner_name, object_name, target_owner, target_table, rule_model_name)
        column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
        return {
            "status": "success",
            "owner": owner_name,
            "objectName": object_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "ruleModelName": rule_model_name,
            "filteredByTarget": bool(bind_params),
            "correlationSummary": cat_corr_summary,
            "predictedTypeSummary": predicted_type_summary,
            "violationSummary": violation_summary,
            "columnComments": column_comments,
            **result,
        }
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


@router.get("/model-detail-summary")
def get_model_detail_summary(
    request: Request,
    owner: str,
    modelName: str,
    targetOwner: str | None = None,
    targetTable: str | None = None,
    limit: int = 120,
    includeSamples: bool = False,
):
    owner_name = _validate_identifier(owner, "owner")
    model_name = _validate_identifier(modelName, "model name")
    target_owner = _validate_identifier(targetOwner, "target owner") if targetOwner else ""
    target_table = _validate_identifier(targetTable, "target table") if targetTable else ""
    row_limit = max(1, min(int(limit or 120), 300))
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        model_metadata: dict[str, Any] = {}
        try:
            metadata_result = execute_query(conn, "M04002_MODEL_METADATA", {
                "owner": owner_name,
                "modelName": model_name,
            })
            if metadata_result.get("status") == "success" and metadata_result.get("data"):
                model_metadata = {
                    key: _serialize_db_value(value)
                    for key, value in metadata_result["data"][0].items()
                }
        except Exception as metadata_error:
            logger.info("M04002 model metadata query skipped: %s", metadata_error)

        view_names = {view_type: f"DM${view_type}{model_name}" for view_type in MODEL_DETAIL_VIEW_TYPES}
        result = execute_query(conn, "DATA_WORK_MODEL_DETAIL_VIEW_LIST", {
            "owner": owner_name,
            "viewNameVa": view_names["VA"],
            "viewNameVg": view_names["VG"],
            "viewNameVi": view_names["VI"],
            "viewNameVn": f"DM$VN{model_name}",
            "viewNameVp": f"DM$VP{model_name}",
            "viewNameVr": view_names["VR"],
            "viewNameVt": f"DM$VT{model_name}",
        })
        existing_views = {
            row.get("VIEW_TYPE"): row
            for row in result.get("data", [])
            if row.get("VIEW_TYPE") in MODEL_DETAIL_VIEW_TYPES
        }
        cursor = conn.cursor() if includeSamples or (target_owner and target_table) else None
        column_comments = _fetch_column_comment_map(cursor, target_owner, target_table) if cursor and target_owner and target_table else {}
        views = []
        for view_type, description in MODEL_DETAIL_VIEW_TYPES.items():
            view_name = view_names[view_type]
            meta = existing_views.get(view_type) or {}
            exists_yn = meta.get("EXISTS_YN") or "N"
            columns = []
            rows = []
            total = 0
            if includeSamples and exists_yn == "Y":
                object_sql = f"{_quote_identifier(owner_name)}.{_quote_identifier(view_name)}"
                cursor.execute(f"SELECT COUNT(*) FROM {object_sql}")
                total = int(cursor.fetchone()[0] or 0)
                select_sql = f"SELECT * FROM {object_sql}"
                sample_sql = (
                    "SELECT * FROM ("
                    f"  {select_sql}"
                    ") WHERE ROWNUM <= :limit"
                )
                cursor.execute(sample_sql, {"limit": row_limit})
                columns = [desc[0] for desc in cursor.description]
                rows = [_row_to_dict(columns, row) for row in cursor.fetchall()]
            views.append({
                "viewType": view_type,
                "viewName": view_name,
                "description": description,
                "existsYn": exists_yn,
                "columns": columns,
                "data": rows,
                "total": total,
                "page": 1,
                "pageSize": row_limit,
                "sampleLoaded": bool(includeSamples and exists_yn == "Y"),
            })
        return {
            "status": "success",
            "owner": owner_name,
            "modelName": model_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "columnComments": column_comments,
            "modelMetadata": model_metadata,
            "views": views,
            "includeSamples": includeSamples,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("M04002 model detail summary query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/model-rule-summary")
def get_model_rule_summary(
    request: Request,
    owner: str,
    modelName: str,
    targetOwner: str | None = None,
    targetTable: str | None = None,
    conditionCount: int | None = None,
    resultColumn: str | None = None,
    resultHasValueYn: str | None = None,
    page: int = 1,
    pageSize: int = 12,
    resultColumnPage: int = 1,
    resultColumnPageSize: int = 12,
):
    owner_name = _validate_identifier(owner, "owner")
    model_name = _validate_identifier(modelName, "model name")
    target_owner = _validate_identifier(targetOwner, "target owner") if targetOwner else ""
    target_table = _validate_identifier(targetTable, "target table") if targetTable else ""
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 12, 100)
    offset, end_row = _page_window(page, page_size)
    result_column_page = _normalize_page(resultColumnPage)
    result_column_page_size = _normalize_page_size(resultColumnPageSize, 12, 50)
    result_column_offset, result_column_end_row = _page_window(result_column_page, result_column_page_size)
    normalized_result_has_value = str(resultHasValueYn or "").strip().upper()
    if normalized_result_has_value not in {"Y", "N"}:
        normalized_result_has_value = None
    normalized_result_column = str(resultColumn or "").strip().upper() or None
    if normalized_result_column and normalized_result_column != "__NULL__":
        normalized_result_column = _validate_identifier(normalized_result_column, "result column")
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor() if target_owner and target_table else None
        column_comments = _fetch_column_comment_map(cursor, target_owner, target_table) if cursor else {}
        overview = execute_query(conn, "M04002_ASSOC_RULE_OVERVIEW", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
        })
        condition_dist = execute_query(conn, "M04002_ASSOC_RULE_CONDITION_DIST", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
        })
        result_top = execute_query(conn, "M04002_ASSOC_RULE_RESULT_TOP", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
            "resultOffset": result_column_offset,
            "resultEndRow": result_column_end_row,
        })
        detail = execute_query(conn, "M04002_ASSOC_RULE_DETAIL_LIST", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
            "conditionCount": conditionCount,
            "resultColumn": normalized_result_column,
            "resultHasValueYn": normalized_result_has_value,
            "offset": offset,
            "endRow": end_row,
        })
        rows = detail.get("data", []) if detail.get("status") == "success" else []
        total = int(rows[0].get("TOTAL_COUNT") or 0) if rows else 0
        for row in rows:
            row.pop("RN__", None)
            row.pop("TOTAL_COUNT", None)
            for key, value in list(row.items()):
                row[key] = _serialize_db_value(value)
        overview_row = (overview.get("data") or [{}])[0] if overview.get("status") == "success" else {}
        overview_row = {key: _serialize_db_value(value) for key, value in overview_row.items()}
        condition_rows = condition_dist.get("data", []) if condition_dist.get("status") == "success" else []
        condition_rows = [
            {key: _serialize_db_value(value) for key, value in row.items()}
            for row in condition_rows
        ]
        result_rows = result_top.get("data", []) if result_top.get("status") == "success" else []
        result_column_total = int(result_rows[0].get("TOTAL_COUNT") or 0) if result_rows else 0
        result_rows = [
            {key: _serialize_db_value(value) for key, value in row.items()}
            for row in result_rows
        ]
        for row in result_rows:
            row.pop("RN__", None)
            row.pop("TOTAL_COUNT", None)
        return {
            "status": "success",
            "owner": owner_name,
            "modelName": model_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "columnComments": column_comments,
            "overview": overview_row,
            "conditionDist": condition_rows,
            "resultTop": result_rows,
            "resultTopTotal": result_column_total,
            "resultTopPage": result_column_page,
            "resultTopPageSize": result_column_page_size,
            "rules": rows,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "filters": {
                "conditionCount": conditionCount,
                "resultColumn": normalized_result_column,
                "resultHasValueYn": normalized_result_has_value,
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("M04002 model rule summary query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/model-readable-summary")
def get_model_readable_summary(request: Request, owner: str, modelName: str):
    owner_name = _validate_identifier(owner, "owner")
    model_name = _validate_identifier(modelName, "model name")
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        view_name = f"DM$VR{model_name}"
        summary = _fetch_readable_rule_summary(cursor, owner_name, view_name)
        return {
            "status": "success",
            "owner": owner_name,
            "modelName": model_name,
            "readableRuleSummary": summary,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("M04002 model readable summary query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
