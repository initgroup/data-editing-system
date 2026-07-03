"""
@file           M90002.py
@description    API object registry API
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.database_helper import execute_query, SqlLoader
from backend.target_database import get_target_db_connection

logger = logging.getLogger(__name__)
router = APIRouter()


RESERVED_VARIABLES = [
    ":INIT$TargetOwner",
    ":INIT$TargetTable",
    ":INIT$RunSourceType",
    ":INIT$RunId",
    ":INIT$ResultModelName",
]


class ApiObjectSaveRequest(BaseModel):
    apiObject: Dict[str, Any] = Field(default_factory=dict)
    details: List[Dict[str, Any]] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


class ApiObjectDeleteRequest(BaseModel):
    objectId: int
    model_config = ConfigDict(extra="allow")


@router.get("/api-objects")
def list_api_objects(request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M90002_RESOURCE_LIST", {
            "keyword": None,
            "useYn": "ALL"
        })
        rows = [
            normalize_lob_row(row)
            for row in require_success(result, "API object query failed.").get("data", [])
        ]
        api_objects = [normalize_api_row(row) for row in rows if is_api_registry_row(row)]
        return {
            "status": "success",
            "data": api_objects,
            "total": len(api_objects)
        }
    finally:
        if conn:
            conn.close()


@router.get("/api-object/{object_id}")
def get_api_object(object_id: int, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        resource_result = execute_query(conn, "M90002_RESOURCE_DETAIL", {"resourceId": object_id})
        resource_rows = [
            normalize_lob_row(row)
            for row in require_success(resource_result, "API object detail query failed.").get("data", [])
        ]
        if not resource_rows:
            raise HTTPException(status_code=404, detail="API object was not found.")
        resource = resource_rows[0]
        if not is_api_registry_row(resource):
            raise HTTPException(status_code=404, detail="API object was not found.")

        param_result = execute_query(conn, "M90002_PARAM_LIST", {"resourceId": object_id})
        param_rows = [
            normalize_lob_row(row)
            for row in require_success(param_result, "API object parameter query failed.").get("data", [])
        ]
        api_object = normalize_api_row(resource)
        details = normalize_detail_rows(resource, param_rows)
        return {
            "status": "success",
            "data": {
                "apiObject": api_object,
                "details": details,
                "source": "SAVED"
            }
        }
    finally:
        if conn:
            conn.close()


@router.post("/api-object/save")
def save_api_object(req: ApiObjectSaveRequest, request: Request):
    conn = None
    save_step = "REQUEST"
    try:
        conn = get_target_db_connection(request)
        api_object = normalize_api_object_payload(req.apiObject or {})
        details = normalize_detail_payload(req.details or [])
        spec = build_api_spec(api_object, details)
        output = spec.get("output") or {}
        output_text = json.dumps(output, ensure_ascii=False, indent=2)
        spec_text = json.dumps(spec, ensure_ascii=False, indent=2)
        object_id = optional_int(api_object.get("objectId"))
        object_name = api_object["objectName"]

        params = {
            "resourceId": object_id,
            "resourceName": object_name,
            "resourceLabel": trim_text(api_object.get("label"), 200) or object_name,
            "resourceType": "SERVICE",
            "language": "PYTHON",
            "execApi": "REST_API" if api_object["objectType"] == "EXTERNAL_API" else "WEB_API",
            "execMethod": object_name,
            "scriptName": object_name,
            "scriptOwner": None,
            "scriptSource": "",
            "inputMode": "TABLE",
            "outputFormat": output_text,
            "specJson": spec_text,
            "description": trim_text(api_object.get("description"), 4000),
            "timeoutSec": optional_int(api_object.get("timeoutSec")) or 300,
            "useYn": "N" if str(api_object.get("useYn") or "Y").upper() == "N" else "Y",
            "sortOrder": optional_int(api_object.get("sortOrder")) or 0
        }

        cursor = conn.cursor()
        try:
            save_step = "API_OBJECT_ID_SELECT"
            if not object_id:
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_ID_SELECT"), {"resourceName": object_name})
                row = cursor.fetchone()
                object_id = int(row[0]) if row and row[0] else None
                params["resourceId"] = object_id

            if object_id:
                save_step = "API_OBJECT_UPDATE"
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_UPDATE"), params)
            else:
                save_step = "API_OBJECT_INSERT"
                insert_params = {key: value for key, value in params.items() if key != "resourceId"}
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_INSERT"), insert_params)

            saved_object_id = object_id
            if not saved_object_id:
                save_step = "API_OBJECT_ID_SELECT_AFTER_INSERT"
                cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_ID_SELECT"), {"resourceName": object_name})
                row = cursor.fetchone()
                saved_object_id = int(row[0]) if row and row[0] else None
            if not saved_object_id:
                raise HTTPException(status_code=500, detail="Saved API object ID could not be found.")

            save_step = "API_OBJECT_LOCK"
            cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_LOCK"), {"resourceId": saved_object_id})
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Saved API object was not found for locking.")

            sync_input_params(cursor, saved_object_id, details)
            conn.commit()
            return {
                "status": "success",
                "message": "API object saved.",
                "objectId": saved_object_id
            }
        finally:
            cursor.close()
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("M90002 API object save failed: %s", str(exc))
        if is_row_lock_error(exc):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"API object save hit a database row lock at {save_step}. "
                    "Please wait a moment and save again."
                )
            )
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if conn:
            conn.close()


@router.post("/api-object/delete")
def delete_api_object(req: ApiObjectDeleteRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        try:
            cursor.execute(SqlLoader.get_sql("M90002_RESOURCE_DELETE"), {"resourceId": req.objectId})
            conn.commit()
            return {"status": "success", "message": "API object deleted."}
        finally:
            cursor.close()
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("M90002 API object delete failed: %s", str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if conn:
            conn.close()


@router.get("/resources")
def list_resources_compat(request: Request):
    return list_api_objects(request)


@router.get("/resource/{resource_id}")
def get_resource_compat(resource_id: int, request: Request):
    data = get_api_object(resource_id, request)
    detail = data.get("data") or {}
    return {
        "status": "success",
        "data": {
            "resource": detail.get("apiObject") or {},
            "params": detail.get("details") or []
        }
    }


def require_success(result: Dict[str, Any], default_message: str) -> Dict[str, Any]:
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("message") or default_message)
    return result


def normalize_api_object_payload(value: Dict[str, Any]) -> Dict[str, Any]:
    object_type = normalize_choice(value.get("objectType") or value.get("apiType"), {"INTERNAL_API", "EXTERNAL_API"}, "INTERNAL_API")
    object_name = require_api_code(value.get("objectName") or value.get("resourceName"), "objectName")
    endpoint = trim_text(value.get("endpoint") or value.get("serviceUrl"), 500)
    if not endpoint:
        raise HTTPException(status_code=400, detail="endpoint is required.")
    if object_type == "INTERNAL_API":
        if not endpoint.startswith("/") or endpoint.startswith("//") or re.match(r"(?i)^https?://", endpoint):
            raise HTTPException(status_code=400, detail="Internal API endpoint must be a relative URL starting with '/'.")
    if object_type == "EXTERNAL_API":
        if not re.match(r"(?i)^https?://", endpoint):
            raise HTTPException(status_code=400, detail="External API endpoint must be an absolute http(s) URL.")

    result_create_yn = normalize_choice(value.get("resultCreateYn"), {"N", "T", "M"}, "N")
    result_owner = trim_text(value.get("resultOwner"), 128)
    result_name = trim_text(value.get("resultName"), 128)
    if object_type == "EXTERNAL_API":
        result_create_yn = "T"
        result_owner = result_owner or ":INIT$TargetOwner"
        result_name = "INIT$_TB_API_RESULT"

    return {
        "objectId": optional_int(value.get("objectId")),
        "objectType": object_type,
        "objectName": object_name,
        "label": trim_text(value.get("label") or value.get("objectLabel"), 200) or object_name,
        "apiGroup": trim_text(value.get("apiGroup"), 100) or ("Additional APIs" if object_type == "EXTERNAL_API" else "Python API 기본 JSON"),
        "endpoint": endpoint,
        "httpMethod": normalize_choice(value.get("httpMethod"), {"GET", "POST", "PUT", "PATCH", "DELETE"}, "POST"),
        "authType": normalize_choice(value.get("authType"), {"NONE", "API_KEY", "BEARER", "BASIC"}, "NONE"),
        "authKeyName": trim_text(value.get("authKeyName"), 128),
        "timeoutSec": optional_int(value.get("timeoutSec")) or 300,
        "resultCreateYn": result_create_yn,
        "resultOwner": result_owner,
        "resultName": result_name,
        "useYn": "N" if str(value.get("useYn") or "Y").upper() == "N" else "Y",
        "sortOrder": optional_int(value.get("sortOrder")) or 0,
        "description": trim_text(value.get("description"), 4000)
    }


def build_api_spec(api_object: Dict[str, Any], details: List[Dict[str, Any]]) -> Dict[str, Any]:
    input_rows = [row for row in details if get_detail_section(row.get("key")) == "INPUT"]
    auth_rows = [row for row in details if get_detail_section(row.get("key")) == "AUTH"]
    output_rows = [row for row in details if get_detail_section(row.get("key")) == "OUTPUT"]
    result_key = "resultModelName" if api_object.get("resultCreateYn") == "M" else "resultTableName"
    return {
        "apiRegistryVersion": 2,
        "apiGroup": api_object.get("apiGroup") or "",
        "apiType": api_object.get("objectType") or "INTERNAL_API",
        "method": api_object.get("objectName") or "",
        "httpMethod": api_object.get("httpMethod") or "POST",
        "endpoint": api_object.get("endpoint") or "",
        "serviceUrl": api_object.get("endpoint") or "",
        "timeoutSec": api_object.get("timeoutSec") or 300,
        "adapter": "INTERNAL_PYTHON_API" if api_object.get("objectType") == "INTERNAL_API" else "HTTP_JSON_API",
        "auth": {
            "type": api_object.get("authType") or "NONE",
            "keyName": api_object.get("authKeyName") or "",
            "rules": auth_rows
        },
        "input": input_rows,
        "output": {
            "resultCreateYn": api_object.get("resultCreateYn") or "N",
            "resultOwner": api_object.get("resultOwner") or "",
            result_key: api_object.get("resultName") or "",
            "persistMode": "SERVICE_MANAGED" if api_object.get("objectType") == "INTERNAL_API" else "GENERIC_JSON",
            "rules": output_rows
        },
        "reservedVariables": RESERVED_VARIABLES,
        "details": details
    }


def sync_input_params(cursor, object_id: int, details: List[Dict[str, Any]]) -> None:
    cursor.execute(SqlLoader.get_sql("M90002_PARAM_LIST"), {"resourceId": object_id})
    existing_names = {str(row[1] or "").upper() for row in cursor.fetchall()}
    input_rows = [row for row in details if get_detail_section(row.get("key")) == "INPUT"]
    incoming_names = set()

    if not input_rows:
        cursor.execute(SqlLoader.get_sql("M90002_PARAM_DELETE"), {"resourceId": object_id})
        return

    for index, row in enumerate(input_rows):
        key = strip_detail_prefix(row.get("key"))
        param_name = normalize_param_name(key, index)
        if param_name in incoming_names:
            raise HTTPException(status_code=400, detail=f"Duplicate input parameter name: {param_name}")
        incoming_names.add(param_name)
        value_text = str(row.get("value") or "")
        param_values = {
            "resourceId": object_id,
            "paramName": param_name,
            "bindName": extract_bind_name(value_text, param_name),
            "dataType": extract_data_type(value_text),
            "requiredYn": "Y" if " REQUIRED" in f" {value_text.upper()} " else "N",
            "paramDesc": trim_text(row.get("comment") or row.get("desc"), 4000),
            "defaultValue": trim_text(row.get("defaultValue"), 4000),
            "itemOrder": optional_int(row.get("order")) or index + 1
        }
        cursor.execute(SqlLoader.get_sql("M90002_PARAM_UPDATE"), param_values)
        if cursor.rowcount == 0:
            cursor.execute(SqlLoader.get_sql("M90002_PARAM_INSERT"), param_values)

    for stale_name in sorted(existing_names - incoming_names):
        cursor.execute(SqlLoader.get_sql("M90002_PARAM_DELETE_ONE"), {
            "resourceId": object_id,
            "paramName": stale_name
        })


def normalize_detail_payload(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for index, row in enumerate(rows):
        key = trim_text(row.get("key") or row.get("KEY"), 200)
        if not key:
            continue
        normalized.append({
            "order": optional_int(row.get("order") or row.get("ORDER")) or index + 1,
            "key": key,
            "value": trim_text(row.get("value") or row.get("VALUE"), 4000),
            "comment": trim_text(row.get("comment") or row.get("desc") or row.get("COMMENT"), 4000),
            "defaultValue": trim_text(row.get("defaultValue") or row.get("DEFAULT_VALUE"), 4000)
        })
    return sorted(normalized, key=lambda item: item["order"])


def normalize_api_row(row: Dict[str, Any]) -> Dict[str, Any]:
    spec = parse_json_object(row.get("SPEC_JSON"))
    output = parse_json_object(row.get("OUTPUT_FORMAT")) or spec.get("output") or {}
    api_type = spec.get("apiType") or ("EXTERNAL_API" if row.get("EXEC_API") == "REST_API" else "INTERNAL_API")
    result_name = (
        output.get("resultModelName")
        or output.get("resultTableName")
        or output.get("resultTable")
        or spec.get("resultModelName")
        or spec.get("resultTableName")
        or spec.get("resultTable")
        or ""
    )
    return {
        "objectId": row.get("OML_RESOURCE_ID"),
        "objectType": api_type,
        "objectName": row.get("RESOURCE_NAME") or spec.get("method") or "",
        "label": row.get("RESOURCE_LABEL") or row.get("RESOURCE_NAME") or "",
        "apiGroup": spec.get("apiGroup") or ("Additional APIs" if api_type == "EXTERNAL_API" else "Python API 기본 JSON"),
        "endpoint": spec.get("endpoint") or spec.get("serviceUrl") or "",
        "httpMethod": spec.get("httpMethod") or "POST",
        "authType": (spec.get("auth") or {}).get("type") or "NONE",
        "authKeyName": (spec.get("auth") or {}).get("keyName") or "",
        "timeoutSec": row.get("TIMEOUT_SEC") or spec.get("timeoutSec") or 300,
        "resultCreateYn": output.get("resultCreateYn") or "N",
        "resultOwner": output.get("resultOwner") or "",
        "resultName": result_name,
        "useYn": row.get("USE_YN") or "Y",
        "sortOrder": row.get("SORT_ORDER") or 0,
        "description": row.get("DESCRIPTION") or ""
    }


def normalize_detail_rows(resource: Dict[str, Any], params: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    spec = parse_json_object(resource.get("SPEC_JSON"))
    details = spec.get("details")
    if isinstance(details, list):
        return normalize_detail_payload(details)

    rows = []
    for index, param in enumerate(params):
        param_name = param.get("PARAM_NAME") or ""
        bind_name = param.get("BIND_NAME") or to_camel_name(param_name)
        data_type = param.get("DATA_TYPE") or "VARCHAR2"
        rows.append({
            "order": param.get("ITEM_ORDER") or index + 1,
            "key": f"INPUT.{param_name}",
            "value": f"{bind_name} IN {data_type}",
            "comment": param.get("PARAM_DESC") or "",
            "defaultValue": param.get("DEFAULT_VALUE") or ""
        })
    output = spec.get("output") or parse_json_object(resource.get("OUTPUT_FORMAT"))
    for rule in output.get("rules") or []:
        if isinstance(rule, dict):
            rows.append({
                "order": rule.get("order") or len(rows) + 1,
                "key": rule.get("key") or "",
                "value": rule.get("value") or "",
                "comment": rule.get("comment") or "",
                "defaultValue": rule.get("defaultValue") or ""
            })
    return normalize_detail_payload(rows)


def is_api_registry_row(row: Dict[str, Any]) -> bool:
    spec = parse_json_object(row.get("SPEC_JSON"))
    exec_api = str(row.get("EXEC_API") or "").upper()
    return bool(spec.get("apiRegistryVersion") or spec.get("apiType") or exec_api in {"WEB_API", "REST_API", "PYTHON_API"})


def parse_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def get_detail_section(key: Any) -> str:
    return str(key or "INPUT").split(".", 1)[0].strip().upper() or "INPUT"


def strip_detail_prefix(key: Any) -> str:
    text = str(key or "").strip()
    return text.split(".", 1)[1] if "." in text else text


def normalize_param_name(value: Any, index: int) -> str:
    text = str(value or "").strip()
    text = re.sub(r"[^A-Za-z0-9_$#]", "_", text).strip("_").upper()
    return (text or f"PARAM_{index + 1}")[:128]


def extract_bind_name(value: str, param_name: str) -> str:
    token = str(value or "").strip().split()[0] if str(value or "").strip() else ""
    token = token.split(".")[-1]
    token = re.sub(r"[^A-Za-z0-9_$#]", "_", token).strip("_")
    return token[:128] or to_camel_name(param_name)


def extract_data_type(value: str) -> str:
    text = str(value or "").upper()
    for data_type in ("VARCHAR2", "NUMBER", "DATE", "TIMESTAMP", "BOOLEAN", "JSON", "CLOB"):
        if re.search(rf"\b{data_type}\b", text):
            return data_type
    return "VARCHAR2"


def to_camel_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"^p_", "", text)
    parts = [part for part in re.split(r"[_\W]+", text) if part]
    if not parts:
        return ""
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def require_api_code(value: Any, field_name: str) -> str:
    text = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,49}", text):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return text


def normalize_choice(value: Any, allowed: set[str], default: str) -> str:
    text = str(value or default).strip().upper()
    return text if text in allowed else default


def optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def trim_text(value: Any, max_length: int) -> str:
    return str(value if value is not None else "").strip()[:max_length]


def is_row_lock_error(error: Exception) -> bool:
    text = str(error)
    return "ORA-12860" in text or "ORA-00060" in text


def normalize_lob_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: value.read() if hasattr(value, "read") else value
        for key, value in row.items()
    }
