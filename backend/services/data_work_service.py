"""
Shared data-work job/run service.

Menus such as M02003, M02004, and later data editing workbenches can reuse
these functions by passing their menu code.
"""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Dict, List, Optional
import json
import re

from backend.database_helper import execute_query, SqlLoader


class DataWorkJobRequest(BaseModel):
    profileJobId: Optional[int] = None
    projectId: Optional[int] = None
    scenarioId: Optional[int] = None
    scenarioTableId: Optional[int] = None
    jobGroup: Optional[str] = None
    jobName: Optional[str] = None
    jobDesc: Optional[str] = None
    ownerName: Optional[str] = None
    tableName: Optional[str] = None
    execObjectId: Optional[int] = None
    execOwner: Optional[str] = None
    execObjectType: Optional[str] = None
    execObjectName: Optional[str] = None
    execObjectLabel: Optional[str] = None
    useYn: Optional[str] = "Y"
    sortOrder: Optional[int] = None
    params: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    execPlsql: Optional[str] = None
    resultCreateYn: Optional[str] = "N"
    resultOwner: Optional[str] = None
    resultTableName: Optional[str] = None
    status: Optional[str] = "DRAFT"
    model_config = ConfigDict(extra="allow")


class DataWorkRunJobRequest(DataWorkJobRequest):
    batch: Optional[bool] = False
    runtimeBindValues: Optional[Dict[str, Any]] = Field(default_factory=dict)


class DataWorkRunAllJobsRequest(BaseModel):
    projectId: int
    scenarioId: int
    model_config = ConfigDict(extra="allow")


def list_jobs(conn, menu_code: str, project_id: int, scenario_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "DATA_WORK_JOB_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return require_success(result, "Data work job query failed.")


def list_runs(conn, menu_code: str, project_id: int, scenario_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "DATA_WORK_RUN_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return require_success(result, "Data work run history query failed.")


def list_runnable_jobs(conn, menu_code: str, project_id: int, scenario_id: int) -> List[Dict[str, Any]]:
    result = execute_query(conn, "DATA_WORK_JOB_RUN_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return require_success(result, "Data work job query failed.").get("data", [])


def save_job(
    conn,
    menu_code: str,
    req: DataWorkJobRequest,
    default_job_group: Optional[str] = None
) -> int:
    menu_code = normalize_menu_code(menu_code)
    project_id = require_int(req.projectId, "projectId")
    scenario_id = require_int(req.scenarioId, "scenarioId")
    owner_name = require_identifier(req.ownerName, "ownerName")
    table_name = require_identifier(req.tableName, "tableName")
    job_group = normalize_text(req.jobGroup, default_job_group or menu_code, 100) or menu_code
    job_name = normalize_text(req.jobName, "", 200)
    if not job_name:
        raise HTTPException(status_code=400, detail="jobName is required.")
    job_desc = normalize_text(req.jobDesc, "", 1000)

    result_create_yn = "Y" if str(req.resultCreateYn or "N").upper() == "Y" else "N"
    result_owner = normalize_optional_identifier(req.resultOwner)
    result_table_name = normalize_optional_identifier(req.resultTableName)
    if result_create_yn == "Y" and (not result_owner or not result_table_name):
        raise HTTPException(
            status_code=400,
            detail="resultOwner and resultTableName are required when resultCreateYn is Y."
        )

    params = {
        "menuCode": menu_code,
        "profileJobId": req.profileJobId,
        "projectId": project_id,
        "scenarioId": scenario_id,
        "scenarioTableId": req.scenarioTableId,
        "jobGroup": job_group,
        "jobName": job_name,
        "jobDesc": job_desc,
        "ownerName": owner_name,
        "tableName": table_name,
        "execObjectId": req.execObjectId,
        "execOwner": normalize_optional_identifier(req.execOwner),
        "execObjectType": normalize_optional_token(req.execObjectType),
        "execObjectName": normalize_optional_object_name(req.execObjectName),
        "execObjectLabel": normalize_text(req.execObjectLabel, "", 300),
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "sortOrder": req.sortOrder,
        "paramJson": json.dumps(req.params or [], ensure_ascii=False),
        "execPlsql": req.execPlsql or "",
        "resultCreateYn": result_create_yn,
        "resultOwner": result_owner,
        "resultTableName": result_table_name,
        "status": normalize_status(req.status or "DRAFT")
    }

    cursor = conn.cursor()
    try:
        if req.profileJobId:
            cursor.execute(SqlLoader.get_sql("DATA_WORK_JOB_UPDATE"), params)
            return int(req.profileJobId)

        insert_params = {key: value for key, value in params.items() if key != "profileJobId"}
        cursor.execute(SqlLoader.get_sql("DATA_WORK_JOB_INSERT"), insert_params)
        cursor.execute(SqlLoader.get_sql("DATA_WORK_JOB_ID_LATEST"), {
            "menuCode": menu_code,
            "projectId": project_id,
            "scenarioId": scenario_id,
            "jobGroup": job_group,
            "jobName": job_name,
            "ownerName": owner_name,
            "tableName": table_name
        })
        row = cursor.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=500, detail="Saved data work job ID could not be found.")
        return int(row[0])
    finally:
        cursor.close()


def load_job(conn, menu_code: str, profile_job_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "DATA_WORK_JOB_DETAIL", {
        "menuCode": normalize_menu_code(menu_code),
        "profileJobId": profile_job_id
    })
    data = result.get("data", [])
    if not data:
        raise HTTPException(status_code=404, detail="Data work job was not found.")

    job = data[0]
    param_json = read_lob(job.get("PARAM_JSON"))
    exec_plsql = read_lob(job.get("EXEC_PLSQL"))
    job["PARAM_JSON"] = param_json
    job["EXEC_PLSQL"] = exec_plsql
    try:
        job["PARAMS"] = json.loads(param_json or "[]")
    except Exception:
        job["PARAMS"] = []
    return job


def create_run(
    conn,
    profile_job_id: int,
    run_type: str,
    status: str,
    message: str,
    result_table_name: Optional[str],
    result_owner: Optional[str]
) -> int:
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("DATA_WORK_RUN_INSERT"), {
            "profileJobId": profile_job_id,
            "runType": normalize_status(run_type),
            "status": normalize_status(status),
            "message": normalize_text(message, "", 4000),
            "resultOwner": normalize_optional_identifier(result_owner),
            "resultTableName": normalize_optional_identifier(result_table_name)
        })
        cursor.execute(SqlLoader.get_sql("DATA_WORK_RUN_ID_LATEST"), {"profileJobId": profile_job_id})
        row = cursor.fetchone()
        return int(row[0]) if row and row[0] else 0
    finally:
        cursor.close()


def update_run(
    conn,
    run_id: int,
    status: str,
    message: str,
    result_table_name: Optional[str],
    result_owner: Optional[str]
):
    if not run_id:
        return

    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("DATA_WORK_RUN_UPDATE"), {
            "profileRunId": run_id,
            "status": normalize_status(status),
            "message": normalize_text(message, "", 4000),
            "resultOwner": normalize_optional_identifier(result_owner),
            "resultTableName": normalize_optional_identifier(result_table_name)
        })
    finally:
        cursor.close()


def update_job_status(
    conn,
    menu_code: str,
    profile_job_id: int,
    status: str,
    message: str,
    result_table_name: Optional[str],
    result_owner: Optional[str],
    started: bool,
    finished: bool
):
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("DATA_WORK_JOB_STATUS_UPDATE"), {
            "menuCode": normalize_menu_code(menu_code),
            "profileJobId": profile_job_id,
            "status": normalize_status(status),
            "resultOwner": normalize_optional_identifier(result_owner),
            "resultTableName": normalize_optional_identifier(result_table_name),
            "startedYn": "Y" if started else "N",
            "finishedYn": "Y" if finished else "N"
        })
    finally:
        cursor.close()


def require_success(result: Dict[str, Any], default_message: str) -> Dict[str, Any]:
    if result.get("status") != "success":
        raise HTTPException(
            status_code=500,
            detail=result.get("detail") or result.get("message") or default_message
        )
    return {
        "status": "success",
        "data": result.get("data", []),
        "columns": result.get("columns", []),
        "total": result.get("total", 0)
    }


def require_int(value: Optional[int], field_name: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    if result <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    return result


def require_identifier(value: Any, field_name: str) -> str:
    name = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", name):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return name


def normalize_optional_identifier(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return require_identifier(text, "identifier") if text else None


def normalize_optional_token(value: Any) -> Optional[str]:
    text = str(value or "").strip().upper()
    return text if text else None


def normalize_optional_object_name(value: Any) -> Optional[str]:
    text = str(value or "").strip().upper()
    if not text:
        return None
    parts = text.split(".")
    if len(parts) > 2 or any(not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", part) for part in parts):
        raise HTTPException(status_code=400, detail="Invalid executable object name.")
    return ".".join(parts)


def normalize_text(value: Any, default: str = "", max_length: int = 4000) -> str:
    text = str(value if value is not None else default).strip()
    return text[:max_length]


def normalize_status(value: Any) -> str:
    text = str(value or "DRAFT").strip().upper()
    return re.sub(r"[^A-Z0-9_]", "_", text)[:30] or "DRAFT"


def normalize_menu_code(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not re.fullmatch(r"M[0-9]{5}", text):
        raise HTTPException(status_code=400, detail="Invalid menuCode.")
    return text


def read_lob(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "read"):
        return value.read()
    return str(value)
