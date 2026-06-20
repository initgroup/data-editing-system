from datetime import datetime
import logging
from typing import Any, Dict

from fastapi import APIRouter, Request

from backend.auth_context import get_request_user_id
from backend.database import get_db_connection
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
    cursor.execute(
        """
        SELECT TABLE_NAME
          FROM USER_TABLES
         WHERE TABLE_NAME IN ({})
        """.format(",".join(f":t{i}" for i, _ in enumerate(table_names))),
        {f"t{i}": name for i, name in enumerate(table_names)},
    )
    existing = {row[0] for row in cursor.fetchall()}
    return {name: name in existing for name in table_names}


def _count_if(cursor, existing: dict[str, bool], table_name: str, sql: str, params: Dict[str, Any] | None = None) -> int:
    if not existing.get(table_name):
        return 0
    return int(_scalar(cursor, sql, params, 0) or 0)


def _get_system_summary(user_id: int, connection_id: int | None) -> dict[str, Any]:
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
            'SELECT COUNT(*) FROM "INIT$_TB_DB_CONNECTION" WHERE USER_ID = :userId',
            {"userId": user_id},
        ) or 0)
        summary["userCount"] = int(_scalar(cursor, 'SELECT COUNT(*) FROM "INIT$_TB_USER"') or 0)
        summary["activeUserCount"] = int(_scalar(cursor, 'SELECT COUNT(*) FROM "INIT$_TB_USER" WHERE USE_YN = \'Y\'') or 0)
        if connection_id:
            cursor.execute(
                """
                SELECT CONNECTION_ID,
                       CONNECTION_NAME,
                       DB_TYPE,
                       HOST,
                       PORT,
                       SERVICE_NAME,
                       SID,
                       USERNAME,
                       USE_YN,
                       DEFAULT_YN
                  FROM "INIT$_TB_DB_CONNECTION"
                 WHERE USER_ID = :userId
                   AND CONNECTION_ID = :connectionId
                """,
                {"userId": user_id, "connectionId": connection_id},
            )
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


def _get_target_summary(request: Request, user_id: int, connection_id: int | None) -> dict[str, Any]:
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
    }
    if not connection_id:
        summary["message"] = "Target DB is not selected."
        return summary

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
            'SELECT COUNT(*) FROM "INIT$_TB_PROJECT" WHERE USER_ID = :userId AND USE_YN = \'Y\'',
            {"userId": user_id})
        counts["scenarios"] = _count_if(cursor, existing, "INIT$_TB_SCENARIO",
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_SCENARIO" S
              JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = S.PROJECT_ID
             WHERE P.USER_ID = :userId
               AND S.USE_YN = 'Y'
            """, {"userId": user_id}) if existing.get("INIT$_TB_PROJECT") else 0
        counts["scenarioTables"] = _count_if(cursor, existing, "INIT$_TB_TABLES",
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_TABLES" T
              JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = T.PROJECT_ID
             WHERE P.USER_ID = :userId
               AND T.USE_YN = 'Y'
            """, {"userId": user_id}) if existing.get("INIT$_TB_PROJECT") else 0
        counts["dataJobs"] = _count_if(cursor, existing, "INIT$_TB_DATA_WORK_JOB",
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_DATA_WORK_JOB" J
              JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = J.PROJECT_ID
             WHERE P.USER_ID = :userId
               AND J.USE_YN = 'Y'
            """, {"userId": user_id}) if existing.get("INIT$_TB_PROJECT") else 0
        counts["dataRuns"] = _count_if(cursor, existing, "INIT$_TB_DATA_WORK_RUN",
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_DATA_WORK_RUN" R
              JOIN "INIT$_TB_DATA_WORK_JOB" J ON J.WORK_JOB_ID = R.WORK_JOB_ID
              JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = J.PROJECT_ID
             WHERE P.USER_ID = :userId
            """, {"userId": user_id}) if existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT") else 0
        counts["flows"] = _count_if(cursor, existing, "INIT$_TB_FLOW_WORK",
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_FLOW_WORK" F
              JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = F.PROJECT_ID
             WHERE P.USER_ID = :userId
               AND F.USE_YN = 'Y'
            """, {"userId": user_id}) if existing.get("INIT$_TB_PROJECT") else 0
        counts["flowRuns"] = _count_if(cursor, existing, "INIT$_TB_FLOW_WORK_RUN",
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_FLOW_WORK_RUN" R
              JOIN "INIT$_TB_FLOW_WORK" F ON F.FLOW_ID = R.FLOW_ID
              JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = F.PROJECT_ID
             WHERE P.USER_ID = :userId
            """, {"userId": user_id}) if existing.get("INIT$_TB_FLOW_WORK") and existing.get("INIT$_TB_PROJECT") else 0
        counts["predictedColumns"] = _count_if(cursor, existing, "INIT$_TB_PREDICTED_TYPE",
            'SELECT COUNT(*) FROM "INIT$_TB_PREDICTED_TYPE"')
        counts["correlationPairs"] = _count_if(cursor, existing, "INIT$_TB_CAT_CORR_PAIR",
            'SELECT COUNT(*) FROM "INIT$_TB_CAT_CORR_PAIR"')
        counts["selectedCorrelations"] = _count_if(cursor, existing, "INIT$_TB_CAT_CORR_SUMMARY",
            'SELECT COUNT(*) FROM "INIT$_TB_CAT_CORR_SUMMARY" WHERE SELECTED_YN = \'Y\'')

        if existing.get("INIT$_TB_DATA_WORK_RUN") and existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT"):
            cursor.execute(
                """
                SELECT R.STATUS, COUNT(*) AS CNT
                  FROM "INIT$_TB_DATA_WORK_RUN" R
                  JOIN "INIT$_TB_DATA_WORK_JOB" J ON J.WORK_JOB_ID = R.WORK_JOB_ID
                  JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = J.PROJECT_ID
                 WHERE P.USER_ID = :userId
                 GROUP BY R.STATUS
                 ORDER BY CNT DESC
                """,
                {"userId": user_id},
            )
            summary["runStatus"] = [{"status": row[0] or "UNKNOWN", "count": int(row[1] or 0)} for row in cursor.fetchall()]

        if existing.get("INIT$_TB_DATA_WORK_RUN") and existing.get("INIT$_TB_DATA_WORK_JOB") and existing.get("INIT$_TB_PROJECT"):
            cursor.execute(
                """
                SELECT TO_CHAR(TRUNC(R.CREATED_AT), 'MM-DD') AS RUN_DATE,
                       COUNT(*) AS CNT
                  FROM "INIT$_TB_DATA_WORK_RUN" R
                  JOIN "INIT$_TB_DATA_WORK_JOB" J ON J.WORK_JOB_ID = R.WORK_JOB_ID
                  JOIN "INIT$_TB_PROJECT" P ON P.PROJECT_ID = J.PROJECT_ID
                 WHERE P.USER_ID = :userId
                   AND R.CREATED_AT >= TRUNC(SYSDATE) - 6
                 GROUP BY TRUNC(R.CREATED_AT)
                 ORDER BY TRUNC(R.CREATED_AT)
                """,
                {"userId": user_id},
            )
            summary["trend"] = [{"label": row[0], "count": int(row[1] or 0)} for row in cursor.fetchall()]
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
    try:
        connection_id = get_target_connection_id(request)
    except Exception:
        connection_id = None

    system = _get_system_summary(user_id, connection_id)
    target = _get_target_summary(request, user_id, connection_id)
    counts = target.get("counts", {})
    connected = bool(target.get("connected"))
    schema_installed = bool(target.get("schemaInstalled"))

    data_runs = int(counts.get("dataRuns") or 0)
    flow_runs = int(counts.get("flowRuns") or 0)
    total_runs = data_runs + flow_runs
    prepared = int(counts.get("scenarioTables") or 0)
    review = int(counts.get("dataJobs") or 0)
    pending = max(0, prepared + review - total_runs)

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
        "notices": [
            {
                "tone": "is-good" if connected else "is-warn",
                "title": "Target DB connection",
                "text": "Connection is active for dashboard queries." if connected else target.get("error") or "Target DB is not selected.",
            },
            {
                "tone": "is-good" if schema_installed else "is-warn",
                "title": "Target schema",
                "text": "Required target metadata tables are installed." if schema_installed else "Target metadata tables are missing or partially installed.",
            },
            {
                "tone": "is-info",
                "title": "Dashboard source",
                "text": "Values are read live from existing system and target metadata tables. No table creation is performed.",
            },
        ],
    }
