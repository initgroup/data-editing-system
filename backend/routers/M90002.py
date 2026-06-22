"""
@file           M90002.py
@description    OML4Py resource registry API
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

import oracledb
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.database_helper import execute_query, SqlLoader
from backend.target_database import get_target_db_connection

logger = logging.getLogger(__name__)
router = APIRouter()


class OmlResourceSaveRequest(BaseModel):
    resource: Dict[str, Any] = Field(default_factory=dict)
    params: List[Dict[str, Any]] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


class OmlResourceDeleteRequest(BaseModel):
    resourceId: int
    model_config = ConfigDict(extra="allow")


@router.get("/resources")
def list_resources(
    request: Request,
    keyword: str = Query(""),
    useYn: str = Query("ALL")
):
    conn = None
    try:
        conn = get_target_db_connection(request)
        params = {
            "keyword": f"%{keyword.strip().upper()}%" if keyword.strip() else None,
            "useYn": useYn.upper() if useYn.upper() in {"Y", "N"} else "ALL"
        }
        result = execute_query(conn, "M90002_RESOURCE_LIST", params)
        normalized = require_success(result, "OML resource query failed.")
        normalized["data"] = [normalize_lob_row(row) for row in normalized.get("data", [])]
        return normalized
    finally:
        if conn:
            conn.close()


@router.get("/resource/{resource_id}")
def get_resource(resource_id: int, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        resource_result = execute_query(conn, "M90002_RESOURCE_DETAIL", {"resourceId": resource_id})
        resource_data = [
            normalize_lob_row(row)
            for row in require_success(resource_result, "OML resource detail query failed.").get("data", [])
        ]
        if not resource_data:
            raise HTTPException(status_code=404, detail="OML resource was not found.")

        param_result = execute_query(conn, "M90002_PARAM_LIST", {"resourceId": resource_id})
        params = require_success(param_result, "OML resource parameter query failed.").get("data", [])
        return {
            "status": "success",
            "data": {
                "resource": resource_data[0],
                "params": params
            }
        }
    finally:
        if conn:
            conn.close()


@router.post("/resource/save")
def save_resource(req: OmlResourceSaveRequest, request: Request):
    conn = None
    save_step = "REQUEST"
    try:
        conn = get_target_db_connection(request)
        resource = req.resource or {}
        resource_name = require_code(resource.get("resourceName") or resource.get("RESOURCE_NAME"), "resourceName")
        resource_id = optional_int(resource.get("resourceId") or resource.get("OML_RESOURCE_ID"))

        params = {
            "resourceId": resource_id,
            "resourceName": resource_name,
            "resourceLabel": trim_text(resource.get("resourceLabel") or resource.get("RESOURCE_LABEL"), 200) or resource_name,
            "resourceType": normalize_choice(resource.get("resourceType") or resource.get("RESOURCE_TYPE"), {"SCRIPT", "MODEL", "NOTEBOOK_JOB", "SERVICE"}, "SCRIPT"),
            "language": normalize_choice(resource.get("language") or resource.get("LANGUAGE"), {"PYTHON", "R"}, "PYTHON"),
            "execApi": normalize_choice(resource.get("execApi") or resource.get("EXEC_API"), {"SQL_API", "PYTHON_API", "REST_API"}, "SQL_API"),
            "execMethod": normalize_choice(resource.get("execMethod") or resource.get("EXEC_METHOD"), {
                "PYQ_EVAL",
                "PYQ_TABLE_EVAL",
                "PYQ_ROW_EVAL",
                "PYQ_GROUP_EVAL",
                "PYQ_INDEX_EVAL",
                "DO_EVAL",
                "TABLE_APPLY",
                "ROW_APPLY",
                "GROUP_APPLY",
                "INDEX_APPLY"
            }, "PYQ_TABLE_EVAL"),
            "scriptName": require_code(resource.get("scriptName") or resource.get("SCRIPT_NAME"), "scriptName"),
            "scriptOwner": optional_code(resource.get("scriptOwner") or resource.get("SCRIPT_OWNER")),
            "scriptSource": str(resource.get("scriptSource") or resource.get("SCRIPT_SOURCE") or ""),
            "inputMode": normalize_choice(resource.get("inputMode") or resource.get("INPUT_MODE"), {"NONE", "TABLE", "ROW", "GROUP", "INDEX"}, "TABLE"),
            "outputFormat": trim_text(resource.get("outputFormat") or resource.get("OUTPUT_FORMAT"), 4000),
            "specJson": normalize_json_text(resource.get("specJson") or resource.get("SPEC_JSON")),
            "description": trim_text(resource.get("description") or resource.get("DESCRIPTION"), 4000),
            "timeoutSec": optional_int(resource.get("timeoutSec") or resource.get("TIMEOUT_SEC")) or 300,
            "useYn": "N" if str(resource.get("useYn") or resource.get("USE_YN") or "Y").upper() == "N" else "Y",
            "sortOrder": optional_int(resource.get("sortOrder") or resource.get("SORT_ORDER")) or 0
        }

        cursor = conn.cursor()
        save_step = "RESOURCE_ID_SELECT"
        try:
            if not resource_id:
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_ID_SELECT"), {"resourceName": resource_name})
                row = cursor.fetchone()
                resource_id = int(row[0]) if row and row[0] else None
                params["resourceId"] = resource_id

            if resource_id:
                save_step = "RESOURCE_UPDATE"
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_UPDATE"), params)
            else:
                save_step = "RESOURCE_INSERT"
                insert_params = {key: value for key, value in params.items() if key != "resourceId"}
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_INSERT"), insert_params)

            saved_resource_id = resource_id
            if not saved_resource_id:
                save_step = "RESOURCE_ID_SELECT_AFTER_INSERT"
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_ID_SELECT"), {"resourceName": resource_name})
                row = cursor.fetchone()
                saved_resource_id = int(row[0]) if row and row[0] else None
            if not saved_resource_id:
                raise HTTPException(status_code=500, detail="Saved OML resource ID could not be found.")

            save_step = "RESOURCE_LOCK"
            cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_LOCK"), {"resourceId": saved_resource_id})
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Saved OML resource was not found for locking.")

            sync_resource_params(cursor, saved_resource_id, req.params or [])
            if should_register_pyq_script(params):
                save_step = "PYQ_SCRIPT_CREATE"
                ensure_pyq_script_create_api_available(cursor)
                register_pyq_script(cursor, params["scriptName"], params["scriptSource"])
            conn.commit()
            return {
                "status": "success",
                "message": "OML4Py resource saved and script registered.",
                "resourceId": saved_resource_id
            }
        finally:
            cursor.close()
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M90002 resource save failed: {str(e)}")
        if is_row_lock_error(e):
            raise HTTPException(
                status_code=409,
                detail=f"OML4Py resource save hit a database row lock at {save_step}. This is a DB transaction/lock conflict, not invalid resource data. Please wait a moment and save again.\n{save_step} 단계에서 DB row lock 충돌이 발생했습니다. 리소스 데이터 값 오류가 아니라 DB 트랜잭션/락 충돌입니다. 잠시 후 다시 저장해 주세요."
            )
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.post("/resource/delete")
def delete_resource(req: OmlResourceDeleteRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        try:
            cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_DELETE"), {"resourceId": req.resourceId})
            conn.commit()
            return {"status": "success", "message": "OML4Py resource deleted."}
        finally:
            cursor.close()
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M90002 resource delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


def require_success(result: Dict[str, Any], default_message: str) -> Dict[str, Any]:
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("message") or default_message)
    return result


def sync_resource_params(cursor, resource_id: int, items: List[Dict[str, Any]]) -> None:
    cursor.execute(SqlLoader.get_sql("M90002_PARAM_LIST"), {"resourceId": resource_id})
    existing_names = {str(row[1] or "").upper() for row in cursor.fetchall()}
    incoming_names = set()

    if not items:
        cursor.execute(SqlLoader.get_sql("M90002_PARAM_DELETE"), {"resourceId": resource_id})
        return

    for index, item in enumerate(items):
        param_name = require_code(item.get("paramName") or item.get("PARAM_NAME"), f"params[{index}].paramName")
        if param_name in incoming_names:
            raise HTTPException(status_code=400, detail=f"Duplicate parameter name: {param_name}")
        incoming_names.add(param_name)

        param_values = {
            "resourceId": resource_id,
            "paramName": param_name,
            "bindName": trim_text(item.get("bindName") or item.get("BIND_NAME"), 128),
            "dataType": trim_text(item.get("dataType") or item.get("DATA_TYPE"), 50),
            "requiredYn": "Y" if str(item.get("requiredYn") or item.get("REQUIRED_YN") or "N").upper() == "Y" else "N",
            "paramDesc": trim_text(item.get("paramDesc") or item.get("PARAM_DESC"), 4000),
            "defaultValue": trim_text(item.get("defaultValue") or item.get("DEFAULT_VALUE"), 4000),
            "itemOrder": optional_int(item.get("itemOrder") or item.get("ITEM_ORDER")) or index + 1
        }

        cursor.execute(SqlLoader.get_sql("M90002_PARAM_UPDATE"), param_values)
        if cursor.rowcount == 0:
            cursor.execute(SqlLoader.get_sql("M90002_PARAM_INSERT"), param_values)

    for stale_name in sorted(existing_names - incoming_names):
        cursor.execute(SqlLoader.get_sql("M90002_PARAM_DELETE_ONE"), {
            "resourceId": resource_id,
            "paramName": stale_name
        })


def should_register_pyq_script(params: Dict[str, Any]) -> bool:
    return (
        params.get("language") == "PYTHON"
        and params.get("resourceType") == "SCRIPT"
        and params.get("execApi") == "SQL_API"
        and bool(str(params.get("scriptSource") or "").strip())
    )


def register_pyq_script(cursor, script_name: str, script_source: str) -> None:
    source = str(script_source or "").strip()
    if not source:
        raise HTTPException(
            status_code=400,
            detail="Script Source is required to register an OML4Py script.\nOML4Py 스크립트를 등록하려면 Script Source가 필요합니다."
        )

    cursor.setinputsizes(scriptSource=oracledb.DB_TYPE_CLOB)
    bind_values = {
        "scriptName": script_name,
        "scriptSource": source
    }
    attempts = [
        (
            "SYS.PYQSCRIPTCREATE(v_script_name, v_script, v_overwrite)",
            """
            BEGIN
                SYS.PYQSCRIPTCREATE(
                    v_script_name => :scriptName,
                    v_script => :scriptSource,
                    v_overwrite => TRUE
                );
            END;
            """
        ),
        (
            "SYS.PYQSCRIPTCREATE(script_name, script, overwrite)",
            """
            BEGIN
                SYS.PYQSCRIPTCREATE(
                    script_name => :scriptName,
                    script => :scriptSource,
                    overwrite => TRUE
                );
            END;
            """
        ),
        (
            "SYS.PYQSCRIPTCREATE(name, script, overwrite)",
            """
            BEGIN
                SYS.PYQSCRIPTCREATE(
                    name => :scriptName,
                    script => :scriptSource,
                    overwrite => TRUE
                );
            END;
            """
        ),
        (
            "SYS.PYQSCRIPTCREATE positional name/script/overwrite",
            "BEGIN SYS.PYQSCRIPTCREATE(:scriptName, :scriptSource, TRUE); END;"
        ),
        (
            "SYS.PYQSCRIPTCREATE positional name/script/global/overwrite",
            "BEGIN SYS.PYQSCRIPTCREATE(:scriptName, :scriptSource, FALSE, TRUE); END;"
        ),
        (
            "PYQSCRIPTCREATE positional name/script/overwrite",
            "BEGIN PYQSCRIPTCREATE(:scriptName, :scriptSource, TRUE); END;"
        ),
        (
            "PYQSCRIPTCREATE positional name/script/global/overwrite",
            "BEGIN PYQSCRIPTCREATE(:scriptName, :scriptSource, FALSE, TRUE); END;"
        )
    ]

    errors = []
    if has_oml_script_wrapper(cursor):
        try:
            cursor.execute(
                """
                BEGIN
                    INIT$_PKG_OML_SCRIPT.CREATE_SCRIPT(
                        p_script_name => :scriptName,
                        p_script_source => :scriptSource
                    );
                END;
                """,
                bind_values
            )
            verify_pyq_script_registered(cursor, script_name)
            return
        except Exception as exc:
            errors.append(f"INIT$_PKG_OML_SCRIPT.CREATE_SCRIPT: {str(exc)}")

    for label, block in attempts:
        try:
            cursor.execute(block, bind_values)
            verify_pyq_script_registered(cursor, script_name)
            return
        except Exception as exc:
            errors.append(f"{label}: {str(exc)}")

    detail = errors[0] if errors else "No OML4Py script create API attempt was executed."
    raise HTTPException(
        status_code=500,
        detail=(
            "OML4Py script repository registration failed. "
            "The target DB did not accept the known pyqScriptCreate call signatures. "
            f"First error: {detail}\n"
            "OML4Py 스크립트 저장소 등록에 실패했습니다. "
            "Target DB에서 알려진 pyqScriptCreate 호출 형식을 허용하지 않았습니다. "
            f"첫 번째 오류: {detail}"
        )
    )


def ensure_pyq_script_create_api_available(cursor) -> None:
    if has_oml_script_wrapper(cursor):
        return

    checks = [
        ("ALL_OBJECTS", SqlLoader.get_sql("M90002_PYQ_SCRIPT_CREATE_OBJECTS")),
        ("ALL_PROCEDURES", SqlLoader.get_sql("M90002_PYQ_SCRIPT_CREATE_PROCEDURES")),
        ("ALL_SYNONYMS", SqlLoader.get_sql("M90002_PYQ_SCRIPT_CREATE_SYNONYMS")),
    ]

    errors = []
    for label, sql in checks:
        try:
            cursor.execute(sql)
            if cursor.fetchone():
                return
        except Exception as exc:
            errors.append(f"{label}: {str(exc)}")

    extra = f" Checks failed: {' | '.join(errors)}" if errors else ""
    raise HTTPException(
        status_code=500,
        detail=(
            "OML4Py script create API was not found in this target DB session. "
            "Grant or enable the DB-side PYQSCRIPTCREATE API before saving OML4Py scripts."
            f"{extra}\n"
            "현재 Target DB 세션에서 OML4Py 스크립트 생성 API를 찾지 못했습니다. "
            "OML4Py 스크립트를 저장하려면 DB 안의 PYQSCRIPTCREATE API 권한 또는 기능을 먼저 활성화해야 합니다."
            f"{extra}"
        )
    )


def has_oml_script_wrapper(cursor) -> bool:
    try:
        cursor.execute(SqlLoader.get_sql("M90002_OML_SCRIPT_WRAPPER_EXISTS"))
        row = cursor.fetchone()
        return bool(row and int(row[0] or 0) > 0)
    except Exception:
        return False


def verify_pyq_script_registered(cursor, script_name: str) -> None:
    cursor.execute(SqlLoader.get_sql("M90002_PYQ_SCRIPT_REGISTERED"), {"scriptName": script_name})
    row = cursor.fetchone()
    if row and int(row[0] or 0) > 0:
        return
    raise HTTPException(
        status_code=500,
        detail=(
            f"OML4Py script create call completed, but {script_name} was not found in USER_PYQ_SCRIPTS.\n"
            f"OML4Py 스크립트 생성 호출은 완료됐지만 USER_PYQ_SCRIPTS에서 {script_name}을 찾지 못했습니다."
        )
    )


def require_code(value: Any, field_name: str) -> str:
    text = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", text):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return text


def optional_code(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return require_code(text, "code") if text else None


def optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def trim_text(value: Any, max_length: int) -> str:
    return str(value if value is not None else "").strip()[:max_length]


def normalize_choice(value: Any, allowed: set[str], default: str) -> str:
    text = str(value or default).strip().upper()
    return text if text in allowed else default


def normalize_json_text(value: Any) -> str:
    text = trim_text(value, 4000)
    if not text:
        return ""
    try:
        json.loads(text)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid specJson.")
    return text


def is_row_lock_error(error: Exception) -> bool:
    text = str(error)
    return "ORA-12860" in text or "ORA-00060" in text


def normalize_lob_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: value.read() if hasattr(value, "read") else value
        for key, value in row.items()
    }
