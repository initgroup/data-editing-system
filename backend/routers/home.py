from datetime import date, datetime
from decimal import Decimal
import json
import logging
import os
import re
import time
from typing import Any, Dict
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, Response

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.database import get_db_connection
from backend.database_helper import SqlLoader, execute_query
from backend.target_database import get_target_connection_id, get_target_db_connection


logger = logging.getLogger(__name__)
router = APIRouter()


TARGET_TABLES = [
    "INIT$_TB_PROJECT",
    "INIT$_TB_SCENARIO",
    "INIT$_TB_TABLES",
    "INIT$_TB_DATA_WORK_JOB",
    "INIT$_TB_DATA_WORK_RUN",
    "INIT$_TB_FLOW_WORK",
    "INIT$_TB_FLOW_WORK_RUN",
    "INIT$_TB_FLOW_WORK_NODE_RUN",
    "INIT$_TB_PREDICTED_TYPE",
    "INIT$_TB_PREDICTED_TYPE_FINAL",
    "INIT$_TB_CAT_CORR_PAIR",
    "INIT$_TB_CAT_CORR_SUMMARY",
]

MODEL_DETAIL_VIEW_TYPES = [
    ("VA", "Attribute/detail view"),
    ("VG", "Global/detail view"),
    ("VI", "Itemset/detail view"),
    ("VR", "Rule/detail view"),
]

IDENTIFIER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")


def _scalar(cursor, sql: str, params: Dict[str, Any] | None = None, default: Any = 0) -> Any:
    cursor.execute(sql, params or {})
    row = cursor.fetchone()
    return row[0] if row and row[0] is not None else default


def _target_execute(cursor, sql_id: str, params: Dict[str, Any] | None = None):
    started_at = time.monotonic()
    logger.info("[Home Target] SQL start %s", sql_id)
    cursor.execute(SqlLoader.get_sql(sql_id), params or {})
    elapsed = time.monotonic() - started_at
    warn_seconds = float(os.getenv("HOME_TARGET_SQL_WARN_SECONDS", "1.5"))
    log_method = logger.warning if elapsed >= warn_seconds else logger.info
    log_method("[Home Target] SQL done %s elapsed=%.3fs", sql_id, elapsed)
    return cursor


def _target_scalar(cursor, sql_id: str, params: Dict[str, Any] | None = None, default: Any = 0) -> Any:
    _target_execute(cursor, sql_id, params)
    row = cursor.fetchone()
    return row[0] if row and row[0] is not None else default


def _count_existing_tables(cursor, table_names: list[str]) -> dict[str, bool]:
    table_binds = ",".join(f":t{i}" for i, _ in enumerate(table_names))
    sql = SqlLoader.get_sql("HOME_EXISTING_TABLES").replace("/* --TABLE_BINDS-- */", table_binds)
    started_at = time.monotonic()
    logger.info("[Home Target] SQL start HOME_EXISTING_TABLES")
    cursor.execute(sql, {f"t{i}": name for i, name in enumerate(table_names)})
    elapsed = time.monotonic() - started_at
    warn_seconds = float(os.getenv("HOME_TARGET_SQL_WARN_SECONDS", "1.5"))
    log_method = logger.warning if elapsed >= warn_seconds else logger.info
    log_method("[Home Target] SQL done HOME_EXISTING_TABLES elapsed=%.3fs", elapsed)
    existing = {row[0] for row in cursor.fetchall()}
    return {name: name in existing for name in table_names}


def _count_if(cursor, existing: dict[str, bool], table_name: str, sql_id: str, params: Dict[str, Any] | None = None) -> int:
    if not existing.get(table_name):
        return 0
    return int(_target_scalar(cursor, sql_id, params, 0) or 0)


def _plain_notice_text(value: str) -> str:
    text = re.sub(r"(?is)<(br|/p|/div|/li|/h[1-6])\b[^>]*>", "\n", value or "")
    text = re.sub(r"(?is)<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _read_lob(value: Any) -> Any:
    if hasattr(value, "read"):
        return value.read()
    return value


def _safe_file_name(value: Any) -> str:
    text = str(value or "").replace("\\", "/").split("/")[-1].strip()
    text = text.replace("\r", "").replace("\n", "")
    return (text or "attachment")[:500]


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
    return {
        columns[index]: _serialize_db_value(value)
        for index, value in enumerate(row)
    }


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


def _normalize_limit(value: int | None, default: int = 100, maximum: int = 500) -> int:
    try:
        limit = int(value or default)
    except (TypeError, ValueError):
        limit = default
    return max(1, min(limit, maximum))


def _get_system_summary(user_id: int, connection_id: int | None, include_all_users: bool = False) -> dict[str, Any]:
    conn = None
    cursor = None
    summary = {
        "connection": None,
        "connectionCount": 0,
        "userCount": 0,
        "activeUserCount": 0,
    }
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        summary["connectionCount"] = int(_scalar(
            cursor,
            SqlLoader.get_sql("HOME_CONNECTION_COUNT"),
            {"userId": user_id, "includeAllUsers": "Y" if include_all_users else "N"},
        ) or 0)
        summary["userCount"] = int(_scalar(cursor, SqlLoader.get_sql("HOME_USER_COUNT")) or 0)
        summary["activeUserCount"] = int(_scalar(cursor, SqlLoader.get_sql("HOME_ACTIVE_USER_COUNT")) or 0)
        if connection_id:
            cursor.execute(SqlLoader.get_sql("HOME_CONNECTION_DETAIL"), {
                "userId": user_id,
                "connectionId": connection_id,
                "includeAllUsers": "Y" if include_all_users else "N",
            })
            row = cursor.fetchone()
            if row:
                summary["connection"] = {
                    "connectionId": row[0],
                    "connectionName": row[1],
                    "dbType": row[2],
                    "host": row[3],
                    "port": row[4],
                    "serviceName": row[5],
                    "sid": row[6],
                    "username": row[7],
                    "useYn": row[8],
                    "defaultYn": row[9],
                }
    except Exception as error:
        logger.warning("Home system dashboard summary failed: %s", error)
        summary["error"] = str(error)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    return summary


def _get_active_system_notices(limit: int = 5) -> list[dict[str, Any]]:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_NOTICE_TABLE_EXISTS"))
        row = cursor.fetchone()
        if not row or int(row[0] or 0) == 0:
            return []

        cursor.execute(SqlLoader.get_sql("HOME_ACTIVE_NOTICES"), {"limit": max(1, min(int(limit or 5), 20))})
        tone_map = {
            "INFO": "is-info",
            "IMPORTANT": "is-good",
            "MAINTENANCE": "is-warn",
            "WARNING": "is-warn",
        }
        notices = []
        for row in cursor.fetchall():
            content = row[3].read() if hasattr(row[3], "read") else (row[3] or "")
            full_text = str(content or "").strip() or "공지 내용이 없습니다."
            popup_text = _plain_notice_text(full_text) or "공지 내용이 없습니다."
            text = popup_text
            if len(text) > 180:
                text = f"{text[:177]}..."
            notice_type = str(row[1] or "INFO").upper()
            created_by_display = row[10] or row[11] or row[8]
            notices.append({
                "noticeId": row[0],
                "noticeType": notice_type,
                "tone": tone_map.get(notice_type, "is-info"),
                "title": row[2] or "Notice",
                "text": text,
                "popupText": popup_text,
                "fullText": full_text,
                "popupYn": row[4] or "N",
                "pinYn": row[5] or "N",
                "postStartAt": row[6].isoformat(timespec="minutes") if isinstance(row[6], datetime) else row[6],
                "postEndAt": row[7].isoformat(timespec="minutes") if isinstance(row[7], datetime) else row[7],
                "createdBy": row[8],
                "createdByName": row[10],
                "createdByLoginId": row[11],
                "createdByDisplay": str(created_by_display) if created_by_display else "",
                "createdAt": row[9].isoformat(timespec="minutes") if isinstance(row[9], datetime) else row[9],
                "attachments": [],
            })
        cursor.execute(SqlLoader.get_sql("HOME_NOTICE_FILE_TABLE_EXISTS"))
        file_table_row = cursor.fetchone()
        if file_table_row and int(file_table_row[0] or 0) > 0:
            for notice in notices:
                cursor.execute(SqlLoader.get_sql("HOME_NOTICE_FILES_FOR_NOTICE"), {"noticeId": notice.get("noticeId")})
                columns = [desc[0] for desc in cursor.description]
                notice["attachments"] = [
                    _row_to_dict(columns, file_row)
                    for file_row in cursor.fetchall()
                ]
        return notices
    except Exception as error:
        logger.warning("Home active notice query failed: %s", error)
        return []
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _get_target_summary(request: Request, user_id: int, connection_id: int | None, include_all_users: bool = False) -> dict[str, Any]:
    summary = {
        "connected": False,
        "schemaInstalled": False,
        "existingTables": {},
        "counts": {
            "projects": 0,
            "scenarios": 0,
            "scenarioTables": 0,
            "dataJobs": 0,
            "dataRuns": 0,
            "flows": 0,
            "flowRuns": 0,
            "predictedColumns": 0,
            "correlationPairs": 0,
            "selectedCorrelations": 0,
        },
        "runStatus": [],
        "trend": [],
        "ruleTrend": [],
        "flowTrend": [],
        "recentFlowRuns": [],
    }
    if not connection_id:
        summary["message"] = "Target DB is not selected."
        return summary
    scope_params = {"userId": user_id, "includeAllUsers": "Y" if include_all_users else "N"}

    conn = None
    cursor = None
    previous_call_timeout = None
    try:
        conn = get_target_db_connection(request)
        previous_call_timeout = getattr(conn, "call_timeout", None)
        if hasattr(conn, "call_timeout"):
            conn.call_timeout = int(os.getenv("HOME_TARGET_QUERY_TIMEOUT_MS", "30000"))
        cursor = conn.cursor()
        existing = _count_existing_tables(cursor, TARGET_TABLES)
        summary["connected"] = True
        summary["existingTables"] = existing
        summary["schemaInstalled"] = all(existing.get(name) for name in [
            "INIT$_TB_PROJECT",
            "INIT$_TB_SCENARIO",
            "INIT$_TB_TABLES",
            "INIT$_TB_DATA_WORK_JOB",
            "INIT$_TB_FLOW_WORK",
        ])

        counts = summary["counts"]
        counts["projects"] = _count_if(cursor, existing, "INIT$_TB_PROJECT",
            "HOME_PROJECT_COUNT",
            scope_params)
        counts["scenarios"] = _count_if(cursor, existing, "INIT$_TB_SCENARIO",
            "HOME_SCENARIO_COUNT", scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["scenarioTables"] = _count_if(cursor, existing, "INIT$_TB_TABLES",
            "HOME_SCENARIO_TABLE_COUNT", scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["dataJobs"] = _count_if(cursor, existing, "INIT$_TB_DATA_WORK_JOB",
            "HOME_DATA_JOB_COUNT", scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["dataRuns"] = _count_if(cursor, existing, "INIT$_TB_DATA_WORK_RUN",
            "HOME_DATA_RUN_COUNT", scope_params) if existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT") else 0
        counts["flows"] = _count_if(cursor, existing, "INIT$_TB_FLOW_WORK",
            "HOME_FLOW_COUNT", scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["flowRuns"] = _count_if(cursor, existing, "INIT$_TB_FLOW_WORK_RUN",
            "HOME_FLOW_RUN_COUNT", scope_params) if existing.get("INIT$_TB_FLOW_WORK") and existing.get("INIT$_TB_PROJECT") else 0
        counts["predictedColumns"] = _count_if(cursor, existing, "INIT$_TB_PREDICTED_TYPE",
            "HOME_PREDICTED_COLUMN_COUNT")
        counts["correlationPairs"] = _count_if(cursor, existing, "INIT$_TB_CAT_CORR_PAIR",
            "HOME_CORRELATION_PAIR_COUNT")
        counts["selectedCorrelations"] = _count_if(cursor, existing, "INIT$_TB_CAT_CORR_SUMMARY",
            "HOME_SELECTED_CORRELATION_COUNT")

        if existing.get("INIT$_TB_DATA_WORK_RUN") and existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT"):
            _target_execute(cursor, "HOME_RUN_STATUS", scope_params)
            summary["runStatus"] = [{"status": row[0] or "UNKNOWN", "count": int(row[1] or 0)} for row in cursor.fetchall()]

        if (
            existing.get("INIT$_TB_DATA_WORK_RUN")
            and existing.get("INIT$_TB_DATA_WORK_JOB")
            and existing.get("INIT$_TB_FLOW_WORK_RUN")
            and existing.get("INIT$_TB_FLOW_WORK")
            and existing.get("INIT$_TB_PROJECT")
        ):
            _target_execute(cursor, "HOME_DATA_RUN_TREND", scope_params)
            summary["trend"] = [{"label": row[0], "count": int(row[1] or 0)} for row in cursor.fetchall()]

            _target_execute(cursor, "HOME_RULE_RUN_TREND", scope_params)
            summary["ruleTrend"] = [
                {
                    "label": row[0],
                    "menuCode": row[1],
                    "menuLabel": row[2],
                    "statusGroup": row[3] or "SUCCESS",
                    "count": int(row[4] or 0),
                }
                for row in cursor.fetchall()
            ]

        if (
            existing.get("INIT$_TB_FLOW_WORK_RUN")
            and existing.get("INIT$_TB_FLOW_WORK")
            and existing.get("INIT$_TB_PROJECT")
        ):
            _target_execute(cursor, "HOME_FLOW_RUN_TREND", scope_params)
            summary["flowTrend"] = [
                {
                    "label": row[0],
                    "statusGroup": row[1] or "SUCCESS",
                    "count": int(row[2] or 0),
                }
                for row in cursor.fetchall()
            ]
            if existing.get("INIT$_TB_FLOW_WORK_NODE_RUN"):
                _target_execute(cursor, "HOME_RECENT_FLOW_RUNS", {
                    **scope_params,
                    "limit": 40,
                })
                columns = [desc[0] for desc in cursor.description]
                summary["recentFlowRuns"] = [
                    _row_to_dict(columns, row)
                    for row in cursor.fetchall()
                ]
    except Exception as error:
        logger.warning("Home target dashboard summary failed: %s", error)
        summary["connected"] = False
        summary["error"] = str(error)
    finally:
        if cursor:
            cursor.close()
        if conn and previous_call_timeout is not None and hasattr(conn, "call_timeout"):
            conn.call_timeout = previous_call_timeout
        if conn:
            conn.close()
    return summary


@router.get("/")
async def read_home():
    return {"message": "Home API is available."}


@router.get("/dashboard")
def dashboard(request: Request):
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    try:
        connection_id = get_target_connection_id(request)
    except Exception:
        connection_id = None

    system = _get_system_summary(user_id, connection_id, include_all_users)
    target = _get_target_summary(request, user_id, connection_id, include_all_users)
    counts = target.get("counts", {})
    connected = bool(target.get("connected"))
    schema_installed = bool(target.get("schemaInstalled"))

    data_runs = int(counts.get("dataRuns") or 0)
    flow_runs = int(counts.get("flowRuns") or 0)
    total_runs = data_runs + flow_runs
    prepared = int(counts.get("scenarioTables") or 0)
    review = int(counts.get("dataJobs") or 0)
    pending = max(0, prepared + review - total_runs)
    active_notices = _get_active_system_notices(50)

    return {
        "status": "success",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "system": system,
        "target": target,
        "kpis": [
            {
                "key": "targetReadiness",
                "label": "Target Readiness",
                "value": "Ready" if connected and schema_installed else ("Connected" if connected else "Required"),
                "trend": "Schema installed" if schema_installed else ("Target connected, schema incomplete" if connected else "Select or fix Target DB"),
                "tone": "is-good" if connected and schema_installed else "is-warn",
                "icon": "fa-database",
            },
            {
                "key": "projects",
                "label": "Projects",
                "value": counts.get("projects", 0),
                "trend": f"{counts.get('scenarios', 0)} scenarios",
                "tone": "is-info",
                "icon": "fa-folder-tree",
            },
            {
                "key": "flowStage",
                "label": "Flows",
                "value": counts.get("flows", 0),
                "trend": f"{counts.get('flowRuns', 0)} flow runs",
                "tone": "is-primary",
                "icon": "fa-diagram-project",
            },
            {
                "key": "dataWork",
                "label": "Data Work",
                "value": counts.get("dataJobs", 0),
                "trend": f"{counts.get('dataRuns', 0)} job runs",
                "tone": "is-neutral",
                "icon": "fa-gears",
            },
        ],
        "stages": [
            {"code": "M02002", "name": "Target Data", "state": f"{counts.get('scenarioTables', 0)} tables", "value": counts.get("scenarioTables", 0), "icon": "fa-table"},
            {"code": "M03003", "name": "Rule Discovery", "state": f"{counts.get('selectedCorrelations', 0)} selected", "value": counts.get("selectedCorrelations", 0), "icon": "fa-wand-magic-sparkles"},
            {"code": "M04001", "name": "Integrated Flow", "state": f"{counts.get('flows', 0)} flows", "value": counts.get("flows", 0), "icon": "fa-diagram-project"},
            {"code": "M07002", "name": "Final Apply", "state": f"{total_runs} runs", "value": total_runs, "icon": "fa-circle-check"},
        ],
        "quality": [
            {"label": "Prepared", "value": prepared},
            {"label": "Review", "value": review},
            {"label": "Pending", "value": pending},
        ],
        "trend": target.get("trend", []),
        "notices": active_notices,
        "popupNotices": [notice for notice in active_notices if notice.get("popupYn") == "Y"],
    }


@router.get("/notice-files/{file_id}/download")
def download_notice_file(file_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_NOTICE_FILE_DOWNLOAD"), {"fileId": file_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attachment was not found.")
        file_name = _safe_file_name(row[2])
        content_type = row[3] or "application/octet-stream"
        file_data = _read_lob(row[5]) or b""
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        return Response(
            content=file_data,
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename=\"attachment\"; filename*=UTF-8''{quote(file_name)}",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Home notice file download failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _normalize_node_result(row: dict[str, Any]) -> dict[str, Any]:
    payload = _parse_json(row.get("NODE_PAYLOAD_JSON"), {}) or {}
    runtime_params = _parse_json(row.get("RUNTIME_PARAM_JSON"), {}) or {}
    job_params = _parse_json(row.get("JOB_PARAM_JSON"), []) or []
    payload_params = payload.get("params") if isinstance(payload.get("params"), list) else payload.get("PARAMS")
    if isinstance(job_params, list) and len(job_params) > len(payload_params or []):
        payload["params"] = job_params
    mode = str(payload.get("resultCreateYn") or payload.get("RESULT_CREATE_YN") or "N").strip().upper()
    mode = mode if mode in ("N", "T", "M") else "N"
    menu_code = payload.get("refMenuCode") or payload.get("menuCode") or payload.get("REF_MENU_CODE") or row.get("REF_MENU_CODE") or ""
    owner = payload.get("resultOwner") or payload.get("RESULT_OWNER") or payload.get("ownerName") or ""
    object_name = payload.get("resultTableName") or payload.get("RESULT_TABLE_NAME") or payload.get("tableName") or ""
    row["PAYLOAD"] = payload
    row["RUNTIME_PARAMS"] = runtime_params
    row["REF_MENU_CODE"] = menu_code
    row["RESULT_CREATE_YN"] = mode
    row["RESULT_OWNER"] = str(owner or "").strip().upper()
    row["RESULT_OBJECT_NAME"] = str(object_name or "").strip().upper()
    row["RESULT_KIND"] = "MODEL" if mode == "M" else ("TABLE" if mode == "T" else "NONE")
    return row


@router.get("/flow-run/{flow_run_id}/nodes")
def get_flow_run_nodes(flow_run_id: int, request: Request):
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
        return {
            "status": "success",
            "data": rows,
            "total": len(rows),
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/result-sample")
def get_result_sample(request: Request, owner: str, objectName: str, limit: int = 80, menuCode: str | None = None):
    owner_name = _validate_identifier(owner, "owner")
    object_name = _validate_identifier(objectName, "object name")
    row_limit = _normalize_limit(limit, 80, 200)
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
        select_sql = f"SELECT * FROM {_quote_identifier(owner_name)}.{_quote_identifier(object_name)}{where_sql}{order_sql}"
        sql = SqlLoader.get_sql("HOME_MODEL_VIEW_SAMPLE").replace("/* --DYNAMIC_SQL-- */", select_sql)
        cursor.execute(sql, {"limit": row_limit})
        columns = [desc[0] for desc in cursor.description]
        rows = [_row_to_dict(columns, row) for row in cursor.fetchall()]
        return {
            "status": "success",
            "columns": columns,
            "data": rows,
            "total": len(rows),
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Home result sample query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/model-detail")
def get_model_detail(request: Request, owner: str, modelName: str, limit: int = 120):
    owner_name = _validate_identifier(owner, "owner")
    model_name = _validate_identifier(modelName, "model name")
    row_limit = _normalize_limit(limit, 120, 300)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        view_names = {view_type: f"DM${view_type}{model_name}" for view_type, _ in MODEL_DETAIL_VIEW_TYPES}
        view_lookup = {view_type: description for view_type, description in MODEL_DETAIL_VIEW_TYPES}
        result = execute_query(conn, "DATA_WORK_MODEL_DETAIL_VIEW_LIST", {
            "owner": owner_name,
            "viewNameVa": f"DM$VA{model_name}",
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
            if row.get("VIEW_TYPE") in view_lookup
        }
        cursor = conn.cursor()
        views = []
        for view_type, description in MODEL_DETAIL_VIEW_TYPES:
            view_name = view_names[view_type]
            meta = existing_views.get(view_type) or {}
            exists_yn = meta.get("EXISTS_YN") or "N"
            columns = []
            rows = []
            if exists_yn == "Y":
                select_sql = f"SELECT * FROM {_quote_identifier(owner_name)}.{_quote_identifier(view_name)}"
                sql = SqlLoader.get_sql("HOME_MODEL_VIEW_SAMPLE").replace("/* --DYNAMIC_SQL-- */", select_sql)
                cursor.execute(sql, {"limit": row_limit})
                columns = [desc[0] for desc in cursor.description]
                rows = [_row_to_dict(columns, row) for row in cursor.fetchall()]
            views.append({
                "viewType": view_type,
                "viewName": view_name,
                "description": description,
                "existsYn": exists_yn,
                "columns": columns,
                "data": rows,
                "total": len(rows),
            })
        return {
            "status": "success",
            "owner": owner_name,
            "modelName": model_name,
            "views": views,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Home model detail query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
