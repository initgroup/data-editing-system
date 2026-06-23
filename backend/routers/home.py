from datetime import datetime
import logging
import re
from typing import Any, Dict

from fastapi import APIRouter, Request

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.database import get_db_connection
from backend.database_helper import SqlLoader
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
    "INIT$_TB_PREDICTED_TYPE",
    "INIT$_TB_CAT_CORR_PAIR",
    "INIT$_TB_CAT_CORR_SUMMARY",
]


def _scalar(cursor, sql: str, params: Dict[str, Any] | None = None, default: Any = 0) -> Any:
    cursor.execute(sql, params or {})
    row = cursor.fetchone()
    return row[0] if row and row[0] is not None else default


def _count_existing_tables(cursor, table_names: list[str]) -> dict[str, bool]:
    table_binds = ",".join(f":t{i}" for i, _ in enumerate(table_names))
    sql = SqlLoader.get_sql("HOME_EXISTING_TABLES").replace("/* --TABLE_BINDS-- */", table_binds)
    cursor.execute(sql, {f"t{i}": name for i, name in enumerate(table_names)})
    existing = {row[0] for row in cursor.fetchall()}
    return {name: name in existing for name in table_names}


def _count_if(cursor, existing: dict[str, bool], table_name: str, sql: str, params: Dict[str, Any] | None = None) -> int:
    if not existing.get(table_name):
        return 0
    return int(_scalar(cursor, sql, params, 0) or 0)


def _plain_notice_text(value: str) -> str:
    text = re.sub(r"(?is)<(br|/p|/div|/li|/h[1-6])\b[^>]*>", "\n", value or "")
    text = re.sub(r"(?is)<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


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
            text = _plain_notice_text(full_text) or "공지 내용이 없습니다."
            if len(text) > 180:
                text = f"{text[:177]}..."
            notice_type = str(row[1] or "INFO").upper()
            notices.append({
                "noticeId": row[0],
                "noticeType": notice_type,
                "tone": tone_map.get(notice_type, "is-info"),
                "title": row[2] or "Notice",
                "text": text,
                "fullText": full_text,
                "popupYn": row[4] or "N",
                "pinYn": row[5] or "N",
                "postStartAt": row[6].isoformat(timespec="minutes") if isinstance(row[6], datetime) else row[6],
                "postEndAt": row[7].isoformat(timespec="minutes") if isinstance(row[7], datetime) else row[7],
                "createdAt": row[8].isoformat(timespec="minutes") if isinstance(row[8], datetime) else row[8],
            })
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
    }
    if not connection_id:
        summary["message"] = "Target DB is not selected."
        return summary
    scope_params = {"userId": user_id, "includeAllUsers": "Y" if include_all_users else "N"}

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
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
            SqlLoader.get_sql("HOME_PROJECT_COUNT"),
            scope_params)
        counts["scenarios"] = _count_if(cursor, existing, "INIT$_TB_SCENARIO",
            SqlLoader.get_sql("HOME_SCENARIO_COUNT"), scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["scenarioTables"] = _count_if(cursor, existing, "INIT$_TB_TABLES",
            SqlLoader.get_sql("HOME_SCENARIO_TABLE_COUNT"), scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["dataJobs"] = _count_if(cursor, existing, "INIT$_TB_DATA_WORK_JOB",
            SqlLoader.get_sql("HOME_DATA_JOB_COUNT"), scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["dataRuns"] = _count_if(cursor, existing, "INIT$_TB_DATA_WORK_RUN",
            SqlLoader.get_sql("HOME_DATA_RUN_COUNT"), scope_params) if existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT") else 0
        counts["flows"] = _count_if(cursor, existing, "INIT$_TB_FLOW_WORK",
            SqlLoader.get_sql("HOME_FLOW_COUNT"), scope_params) if existing.get("INIT$_TB_PROJECT") else 0
        counts["flowRuns"] = _count_if(cursor, existing, "INIT$_TB_FLOW_WORK_RUN",
            SqlLoader.get_sql("HOME_FLOW_RUN_COUNT"), scope_params) if existing.get("INIT$_TB_FLOW_WORK") and existing.get("INIT$_TB_PROJECT") else 0
        counts["predictedColumns"] = _count_if(cursor, existing, "INIT$_TB_PREDICTED_TYPE",
            SqlLoader.get_sql("HOME_PREDICTED_COLUMN_COUNT"))
        counts["correlationPairs"] = _count_if(cursor, existing, "INIT$_TB_CAT_CORR_PAIR",
            SqlLoader.get_sql("HOME_CORRELATION_PAIR_COUNT"))
        counts["selectedCorrelations"] = _count_if(cursor, existing, "INIT$_TB_CAT_CORR_SUMMARY",
            SqlLoader.get_sql("HOME_SELECTED_CORRELATION_COUNT"))

        if existing.get("INIT$_TB_DATA_WORK_RUN") and existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT"):
            cursor.execute(SqlLoader.get_sql("HOME_RUN_STATUS"), scope_params)
            summary["runStatus"] = [{"status": row[0] or "UNKNOWN", "count": int(row[1] or 0)} for row in cursor.fetchall()]

        if (
            existing.get("INIT$_TB_DATA_WORK_RUN")
            and existing.get("INIT$_TB_DATA_WORK_JOB")
            and existing.get("INIT$_TB_FLOW_WORK_RUN")
            and existing.get("INIT$_TB_FLOW_WORK")
            and existing.get("INIT$_TB_PROJECT")
        ):
            cursor.execute(SqlLoader.get_sql("HOME_DATA_RUN_TREND"), scope_params)
            summary["trend"] = [{"label": row[0], "count": int(row[1] or 0)} for row in cursor.fetchall()]

            cursor.execute(SqlLoader.get_sql("HOME_RULE_RUN_TREND"), scope_params)
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
    except Exception as error:
        logger.warning("Home target dashboard summary failed: %s", error)
        summary["connected"] = False
        summary["error"] = str(error)
    finally:
        if cursor:
            cursor.close()
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
