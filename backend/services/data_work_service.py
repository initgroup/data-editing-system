"""
Shared data-work job/run service.

Menus such as M03001, M03002, M03003, and later data editing workbenches can reuse
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
    execSourceType: Optional[str] = "DB_OBJECT"
    execResourceId: Optional[int] = None
    execMethod: Optional[str] = None
    execSpecJson: Optional[str] = None
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
    return normalize_lob_result(require_success(result, "Data work job query failed."))


def list_runs(conn, menu_code: str, project_id: int, scenario_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "DATA_WORK_RUN_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return normalize_lob_result(require_success(result, "Data work run history query failed."))


def list_runnable_jobs(conn, menu_code: str, project_id: int, scenario_id: int) -> List[Dict[str, Any]]:
    result = execute_query(conn, "DATA_WORK_JOB_RUN_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return normalize_lob_rows(require_success(result, "Data work job query failed.").get("data", []))


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

    result_create_yn = normalize_result_create_mode(req.resultCreateYn)
    result_owner = normalize_optional_identifier(req.resultOwner)
    result_table_name = normalize_optional_identifier(req.resultTableName)
    if result_create_yn != "N" and (not result_owner or not result_table_name):
        raise HTTPException(
            status_code=400,
            detail="resultOwner and resultTableName are required when resultCreateYn is T or M."
        )

    exec_source_type = normalize_exec_source_type(req.execSourceType)
    exec_resource_id = require_positive_optional_int(req.execResourceId, "execResourceId")
    exec_plsql = normalize_required_executable_script(req.execPlsql)
    validation_plsql = prepare_executable_script_for_validation(exec_plsql, req.params or [])
    validate_executable_script_syntax(conn, validation_plsql)

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
        "execSourceType": exec_source_type,
        "execResourceId": exec_resource_id,
        "execMethod": normalize_optional_token(req.execMethod),
        "execSpecJson": normalize_text(req.execSpecJson, "", 4000),
        "execObjectId": req.execObjectId if exec_source_type == "DB_OBJECT" else None,
        "execOwner": normalize_optional_identifier(req.execOwner) if exec_source_type == "DB_OBJECT" else None,
        "execObjectType": normalize_optional_token(req.execObjectType),
        "execObjectName": normalize_optional_object_name(req.execObjectName) if exec_source_type == "DB_OBJECT" else normalize_text(req.execObjectName, "", 300),
        "execObjectLabel": normalize_text(req.execObjectLabel, "", 300),
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "sortOrder": req.sortOrder,
        "paramJson": json.dumps(req.params or [], ensure_ascii=False),
        "execPlsql": exec_plsql,
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


def normalize_required_executable_script(script: Optional[str]) -> str:
    text = (script or "").strip()
    text = re.sub(r"(?m)^\s*/\s*$", "", text).strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="Executable PL/SQL script is required. Generate or enter the script first."
        )
    if re.match(r"(?is)^(declare|begin)\b", text):
        if not re.search(r"(?is)\bend\s*;\s*$", text):
            raise HTTPException(status_code=400, detail="Executable PL/SQL script must end with END;.")
        return text

    sql = re.sub(r";+\s*$", "", text).strip()
    if re.search(r";\s*\S", sql):
        raise HTTPException(status_code=400, detail="Only a single executable statement is allowed.")
    if re.match(r"(?is)^(select|with|create\s+table|insert|update|delete|merge)\b", sql):
        return sql
    raise HTTPException(status_code=400, detail="Executable script must be PL/SQL, SELECT, CREATE TABLE, or DML.")


def prepare_executable_script_for_validation(script_text: str, params: List[Dict[str, Any]]) -> str:
    param_values = {
        str(param.get("itemName") or param.get("ITEM_NAME") or ""): param.get("itemDefault", param.get("ITEM_DEFAULT"))
        for param in params
        if param.get("itemName") or param.get("ITEM_NAME")
    }

    def replace_dynamic_token(match):
        key = match.group(1).strip()
        value = param_values.get(key)
        return "" if value is None else str(value)

    return re.sub(
        r"/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*(?:_[A-Za-z0-9_$#]+)*)\s*--\s*\*/",
        replace_dynamic_token,
        script_text or "",
    )


def validate_executable_script_syntax(conn, script_text: str) -> None:
    cursor = conn.cursor()
    try:
        cursor.prepare(script_text)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Executable PL/SQL syntax validation failed. {str(exc)}"
        ) from exc
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
    exec_spec_json = read_lob(job.get("EXEC_SPEC_JSON"))
    job["PARAM_JSON"] = param_json
    job["EXEC_PLSQL"] = exec_plsql
    job["EXEC_SPEC_JSON"] = exec_spec_json
    try:
        job["PARAMS"] = json.loads(param_json or "[]")
    except Exception:
        job["PARAMS"] = []
    return job


def delete_job(conn, menu_code: str, profile_job_id: int, project_id: int, scenario_id: int) -> int:
    cursor = conn.cursor()
    try:
        params = {
            "menuCode": normalize_menu_code(menu_code),
            "profileJobId": require_int(profile_job_id, "profileJobId"),
            "projectId": require_int(project_id, "projectId"),
            "scenarioId": require_int(scenario_id, "scenarioId")
        }
        flow_refs = get_job_flow_references(conn, params["profileJobId"])
        if flow_refs:
            raise HTTPException(status_code=409, detail=create_job_flow_reference_message(flow_refs))
        # Free-tier/Autonomous DB can raise ORA-12839 when parent/child delete DML
        # touches parallel-enabled objects in one transaction. Keep this delete path
        # serial; revisit separately for production DB parallel DML policy.
        cursor.execute("ALTER SESSION DISABLE PARALLEL DML")
        cursor.execute(SqlLoader.get_sql("DATA_WORK_RUN_DELETE_BY_JOB"), {
            "profileJobId": params["profileJobId"]
        })
        cursor.execute(SqlLoader.get_sql("DATA_WORK_JOB_DELETE"), params)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Data work job was not found or does not belong to this context.")
        return cursor.rowcount
    finally:
        cursor.close()


def get_job_flow_references(conn, profile_job_id: int) -> List[Dict[str, Any]]:
    result = execute_query(conn, "DATA_WORK_JOB_FLOW_REF_LIST", {"profileJobId": profile_job_id})
    return require_success(result, "Data work job flow reference query failed.").get("data", [])


def create_job_flow_reference_message(flow_refs: List[Dict[str, Any]]) -> str:
    display_items = []
    for row in flow_refs[:5]:
        menu_code = row.get("FLOW_MENU_CODE") or "M04001"
        flow_name = row.get("FLOW_NAME") or f"Flow #{row.get('FLOW_ID') or '-'}"
        node_name = row.get("NODE_NAME") or row.get("NODE_KEY") or "-"
        display_items.append(f"- {menu_code} / {flow_name} / {node_name}")

    more_count = max(0, len(flow_refs) - len(display_items))
    if more_count:
        display_items.append(f"- ... and {more_count} more")

    ref_text = "\n".join(display_items)
    return (
        "This job is used by saved Flow nodes. Remove it from M04001 Flow first, then delete the job.\n"
        f"{ref_text}\n"
        "이 Job은 저장된 Flow 노드에서 사용 중입니다. M04001 Flow에서 먼저 해당 노드를 삭제한 뒤 Job을 삭제해 주세요."
    )


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


def require_positive_optional_int(value: Optional[int], field_name: str) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    if result <= 0:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return result


def normalize_exec_source_type(value: Any) -> str:
    text = str(value or "DB_OBJECT").strip().upper()
    if text not in {"DB_OBJECT", "OML_PYTHON"}:
        raise HTTPException(status_code=400, detail="Invalid execSourceType.")
    return text


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


def normalize_result_create_mode(value: Any) -> str:
    text = str(value or "N").strip().upper()
    if text == "Y":
        return "T"
    return text if text in {"N", "T", "M"} else "N"


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


def normalize_lob_result(result: Dict[str, Any]) -> Dict[str, Any]:
    result["data"] = normalize_lob_rows(result.get("data", []))
    return result


def normalize_lob_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    lob_fields = {"PARAM_JSON", "EXEC_PLSQL", "EXEC_SPEC_JSON", "MESSAGE", "RESULT_SQL"}
    for row in rows:
        for field in lob_fields:
            if field in row:
                row[field] = read_lob(row.get(field))
    return rows
