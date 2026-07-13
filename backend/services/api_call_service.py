"""
Common API execution service for registered M90002 API objects.

Internal project APIs can keep service-managed persistence. External JSON APIs
can be called through HTTP and persisted into a result table by OUTPUT rules.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from backend.services import ml_analysis_service


INTERNAL_METHODS = {
    "LASSO_FEATURE_SELECT",
    "RELATION_NETWORK_CLUSTER",
    "INTEGRATED_RELATION_CLUSTER",
    "SYMBOLIC_REGRESSION_RULE",
    "INTEGRATED_RULE_DISCOVER",
    "INTEGRATED_RULE_VIOLATION_DETECT",
}


def execute_api_job(
    conn,
    job: Dict[str, Any],
    runtime_values: Optional[Dict[str, Any]] = None,
    run_id: Optional[int] = None,
    include_result: bool = False,
) -> Any:
    runtime_values = runtime_values or {}
    spec = parse_json_object(job.get("EXEC_SPEC_JSON") or job.get("execSpecJson"))
    method = normalize_method(
        job.get("EXEC_METHOD")
        or job.get("execMethod")
        or spec.get("method")
        or job.get("EXEC_OBJECT_NAME")
    )
    payload = ml_analysis_service.build_payload(job, runtime_values, run_id)
    adapter = str(spec.get("adapter") or "").upper()
    endpoint = str(spec.get("endpoint") or spec.get("serviceUrl") or "").strip()

    if method in INTERNAL_METHODS or adapter == "INTERNAL_PYTHON_API" or endpoint.startswith("/api/mlAnalysis/"):
        result = execute_internal_python_api(conn, method, payload)
        persist_message = apply_output_contract(conn, result, spec, job, runtime_values, run_id, payload)
        base_message = create_internal_success_message(method, result)
        message = f"{base_message}{persist_message}"
        return {"message": message, "result": result} if include_result else message

    result = call_http_json_api(spec, payload, runtime_values)
    persist_message = apply_output_contract(conn, result, spec, job, runtime_values, run_id, payload)
    message = f"External API {method or endpoint} completed.{persist_message}"
    return {"message": message, "result": result} if include_result else message


def execute_internal_python_api(conn, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if method == "LASSO_FEATURE_SELECT":
        return ml_analysis_service.run_lasso_feature_select(conn, payload)
    if method == "RELATION_NETWORK_CLUSTER":
        return ml_analysis_service.run_relation_network_cluster(conn, payload)
    if method == "INTEGRATED_RELATION_CLUSTER":
        return ml_analysis_service.run_integrated_relation_cluster(conn, payload)
    if method == "SYMBOLIC_REGRESSION_RULE":
        return ml_analysis_service.run_symbolic_regression_rule(conn, payload)
    if method == "INTEGRATED_RULE_DISCOVER":
        return ml_analysis_service.run_integrated_rule_discover(conn, payload)
    if method == "INTEGRATED_RULE_VIOLATION_DETECT":
        return ml_analysis_service.run_integrated_rule_violation_detect(conn, payload)
    raise HTTPException(status_code=400, detail=f"Unsupported internal API method: {method}")


def create_internal_success_message(method: str, result: Dict[str, Any]) -> str:
    if method == "LASSO_FEATURE_SELECT":
        return (
            "LASSO feature selection completed. "
            f"{result.get('selectedCount', 0)} selected / {result.get('candidateCount', 0)} candidate feature(s)."
        )
    if method == "SYMBOLIC_REGRESSION_RULE":
        return (
            "Symbolic regression rule discovery completed. "
            f"{result.get('featureCount', 0)} feature(s), method={result.get('method', '')}."
        )
    if method == "RELATION_NETWORK_CLUSTER":
        return (
            "Relation network clustering completed. "
            f"{result.get('nodeCount', 0)} node(s), "
            f"{result.get('edgeCount', 0)} edge(s), "
            f"{result.get('clusterCount', 0)} cluster(s)."
        )
    if method == "INTEGRATED_RELATION_CLUSTER":
        network = result.get("network") if isinstance(result.get("network"), dict) else {}
        return (
            "Integrated relation matrix and network clustering completed. "
            f"{result.get('relationCount', 0)} relation row(s), "
            f"{network.get('clusterCount', 0)} cluster(s)."
        )
    if method == "INTEGRATED_RULE_DISCOVER":
        partial = str(result.get("status") or "").lower() == "partial_success"
        failure_summary = create_partial_failure_summary(result)
        return (
            f"Integrated rule discovery {'partially completed' if partial else 'completed'}. "
            f"{result.get('successCount', 0)}/{result.get('taskCount', 0)} task(s) succeeded."
            f"{failure_summary}"
        )
    if method == "INTEGRATED_RULE_VIOLATION_DETECT":
        partial = str(result.get("status") or "").lower() == "partial_success"
        failure_summary = create_partial_failure_summary(result)
        return (
            f"Integrated rule violation detection {'partially completed' if partial else 'completed'}. "
            f"{result.get('successCount', 0)}/{result.get('taskCount', 0)} task(s) succeeded."
            f"{failure_summary}"
        )
    return f"{method or 'API'} completed."


def create_partial_failure_summary(result: Dict[str, Any]) -> str:
    failures = result.get("failedTasks") or []
    messages = []
    for item in failures:
        if not isinstance(item, dict):
            continue
        task = item.get("task") or "TASK"
        message = item.get("message") or "failed"
        messages.append(f"{task}: {message}")
    if not messages:
        return ""
    summary = "; ".join(messages[:5])
    if len(messages) > 5:
        summary += f"; and {len(messages) - 5} more"
    return f" Failed task(s): {summary}"


def call_http_json_api(spec: Dict[str, Any], payload: Dict[str, Any], runtime_values: Dict[str, Any]) -> Dict[str, Any]:
    endpoint = str(spec.get("endpoint") or spec.get("serviceUrl") or "").strip()
    if not re.match(r"(?i)^https?://", endpoint):
        raise HTTPException(status_code=400, detail="External API endpoint must be an absolute http(s) URL.")

    method = str(spec.get("httpMethod") or "POST").upper()
    timeout = int(spec.get("timeoutSec") or 300)
    headers = {"Accept": "application/json"}
    auth = spec.get("auth") if isinstance(spec.get("auth"), dict) else {}
    apply_auth(headers, auth, runtime_values)

    url = endpoint
    data = None
    if method == "GET":
        query = urllib.parse.urlencode({key: value for key, value in payload.items() if value is not None})
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{query}" if query else url
    else:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"External API call failed: {str(exc)}")

    try:
        parsed = json.loads(body or "{}")
    except Exception:
        raise HTTPException(status_code=502, detail="External API response was not valid JSON.")
    if not isinstance(parsed, dict):
        return {"status": "success", "data": parsed}
    return parsed


def apply_auth(headers: Dict[str, str], auth: Dict[str, Any], runtime_values: Dict[str, Any]) -> None:
    auth_type = str(auth.get("type") or "NONE").upper()
    if auth_type == "NONE":
        return
    key_name = str(auth.get("keyName") or "").strip()
    token = runtime_values.get(key_name) or runtime_values.get(to_camel_key(key_name)) if key_name else None
    if token is None:
        token = auth.get("value")
    if not token:
        raise HTTPException(status_code=400, detail=f"Missing API auth value for {key_name or auth_type}.")

    if auth_type == "BEARER":
        headers["Authorization"] = f"Bearer {token}"
        return
    if auth_type == "BASIC":
        headers["Authorization"] = f"Basic {token}"
        return
    header_name = str(auth.get("headerName") or "X-API-Key").strip() or "X-API-Key"
    headers[header_name] = str(token)


def apply_output_contract(
    conn,
    result: Dict[str, Any],
    spec: Dict[str, Any],
    job: Dict[str, Any],
    runtime_values: Dict[str, Any],
    run_id: Optional[int],
    payload: Optional[Dict[str, Any]] = None,
) -> str:
    output = spec.get("output") if isinstance(spec.get("output"), dict) else {}
    result_create_yn = str(output.get("resultCreateYn") or job.get("RESULT_CREATE_YN") or "N").upper()
    persist_mode = str(output.get("persistMode") or "").upper()
    if result_create_yn == "N" or persist_mode == "SERVICE_MANAGED":
        return ""
    if result_create_yn == "M":
        model_name = resolve_runtime_value(output.get("resultModelName") or job.get("RESULT_TABLE_NAME"), runtime_values, job, run_id)
        return f" Model output resolved as {model_name or 'not set'}."
    if persist_mode in {"GENERIC_JSON", "API_RESULT_JSON"}:
        owner = resolve_runtime_value(output.get("resultOwner") or job.get("RESULT_OWNER"), runtime_values, job, run_id)
        table_name = resolve_runtime_value(
            output.get("resultTableName") or output.get("resultTable") or "INIT$_TB_API_RESULT",
            runtime_values,
            job,
            run_id,
        )
        owner = require_identifier(owner, "resultOwner")
        table_name = require_identifier(table_name, "resultTableName")
        insert_generic_api_result(conn, owner, table_name, result, spec, job, runtime_values, run_id, payload or {})
        return f" API JSON response saved to {owner}.{table_name}."
    if persist_mode not in {"TABLE_ROWS", "TABLE"}:
        return ""

    owner = resolve_runtime_value(output.get("resultOwner") or job.get("RESULT_OWNER"), runtime_values, job, run_id)
    table_name = resolve_runtime_value(
        output.get("resultTableName") or output.get("resultTable") or job.get("RESULT_TABLE_NAME"),
        runtime_values,
        job,
        run_id,
    )
    owner = require_identifier(owner, "resultOwner")
    table_name = require_identifier(table_name, "resultTableName")
    rules = [row for row in output.get("rules") or [] if isinstance(row, dict)]
    row_path = find_row_path(rules)
    rows = extract_json_path(result, row_path)
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        rows = [{"VALUE": rows}]
    if not rows:
        return f" No rows found at {row_path}."

    column_rules = [rule for rule in rules if not is_row_path_rule(rule)]
    inserted = insert_output_rows(conn, owner, table_name, rows, column_rules, result)
    return f" {inserted} output row(s) saved to {owner}.{table_name}."


def insert_generic_api_result(
    conn,
    owner: str,
    table_name: str,
    result: Dict[str, Any],
    spec: Dict[str, Any],
    job: Dict[str, Any],
    runtime_values: Dict[str, Any],
    run_id: Optional[int],
    payload: Dict[str, Any],
) -> None:
    run_source_type = (
        get_payload_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType")
        or runtime_values.get("INIT$RunSourceType")
        or runtime_values.get("runSourceType")
        or "DATA_WORK"
    )
    resolved_run_id = (
        get_payload_value(payload, "P_RUN_ID", "runId")
        or runtime_values.get("INIT$RunId")
        or runtime_values.get("runId")
        or run_id
        or 0
    )
    target_owner = get_payload_value(payload, "P_TARGET_OWNER", "targetOwner") or job.get("OWNER_NAME") or job.get("ownerName")
    target_table = get_payload_value(payload, "P_TARGET_TABLE", "targetTable") or job.get("TABLE_NAME") or job.get("tableName")
    output = spec.get("output") if isinstance(spec.get("output"), dict) else {}
    result_model_name = resolve_runtime_value(output.get("resultModelName") or ":INIT$ResultModelName", runtime_values, job, run_id)
    api_name = job.get("EXEC_METHOD") or spec.get("method") or job.get("EXEC_OBJECT_NAME") or ""
    endpoint = spec.get("endpoint") or spec.get("serviceUrl") or ""
    response_json = json.dumps(result, ensure_ascii=False)
    request_json = json.dumps(payload, ensure_ascii=False)
    result_status = str(result.get("status") or result.get("STATUS") or "success")[:50]
    message = str(result.get("message") or result.get("MESSAGE") or "")[:4000]

    cursor = conn.cursor()
    try:
        sql = f"""
INSERT INTO "{owner}"."{table_name}" (
    "RUN_SOURCE_TYPE"
  , "RUN_ID"
  , "API_OBJECT_NAME"
  , "API_ENDPOINT"
  , "TARGET_OWNER"
  , "TARGET_TABLE"
  , "RESULT_MODEL_NAME"
  , "REQUEST_JSON"
  , "RESPONSE_JSON"
  , "RESULT_STATUS"
  , "MESSAGE"
  , "CREATE_DT"
) VALUES (
    :runSourceType
  , :runId
  , :apiObjectName
  , :apiEndpoint
  , :targetOwner
  , :targetTable
  , :resultModelName
  , :requestJson
  , :responseJson
  , :resultStatus
  , :message
  , SYSDATE
)
"""
        cursor.execute(sql, {
            "runSourceType": run_source_type,
            "runId": resolved_run_id,
            "apiObjectName": api_name,
            "apiEndpoint": endpoint,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "resultModelName": result_model_name,
            "requestJson": request_json,
            "responseJson": response_json,
            "resultStatus": result_status,
            "message": message,
        })
    finally:
        cursor.close()


def insert_output_rows(
    conn,
    owner: str,
    table_name: str,
    rows: List[Any],
    rules: List[Dict[str, Any]],
    root: Dict[str, Any],
) -> int:
    cursor = conn.cursor()
    try:
        count = 0
        for row in rows:
            source_row = row if isinstance(row, dict) else {"VALUE": row}
            values = create_insert_values(source_row, rules, root)
            if not values:
                continue
            columns = list(values.keys())
            bind_names = [f"v{index}" for index in range(len(columns))]
            sql = (
                f'INSERT INTO "{owner}"."{table_name}" ('
                + ", ".join(f'"{column}"' for column in columns)
                + ") VALUES ("
                + ", ".join(f":{bind}" for bind in bind_names)
                + ")"
            )
            cursor.execute(sql, {bind: values[column] for bind, column in zip(bind_names, columns)})
            count += 1
        return count
    finally:
        cursor.close()


def create_insert_values(row: Dict[str, Any], rules: List[Dict[str, Any]], root: Dict[str, Any]) -> Dict[str, Any]:
    values: Dict[str, Any] = {}
    if not rules:
        for key, value in row.items():
            column = normalize_identifier(key)
            if column:
                values[column] = value
        return values

    for rule in rules:
        key = strip_detail_prefix(rule.get("key") or "")
        column = normalize_identifier(key)
        if not column:
            continue
        value_expr = str(rule.get("value") or "").split("->", 1)[0].strip()
        if value_expr.startswith("$."):
            value = extract_json_path(root, value_expr)
        elif value_expr.startswith("."):
            value = extract_json_path(row, f"${value_expr}")
        elif value_expr:
            value = row.get(value_expr)
        else:
            value = row.get(key)
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        values[column] = value
    return values


def find_row_path(rules: List[Dict[str, Any]]) -> str:
    for rule in rules:
        if is_row_path_rule(rule):
            return str(rule.get("value") or "$").split("->", 1)[0].strip() or "$"
    return "$"


def is_row_path_rule(rule: Dict[str, Any]) -> bool:
    key = strip_detail_prefix(rule.get("key") or "").lower()
    value = str(rule.get("value") or "")
    return key in {"rows", "items", "data"} or "[*]" in value


def extract_json_path(data: Any, path: str) -> Any:
    text = str(path or "$").strip()
    if text in {"", "$"}:
        return data
    text = text.split("->", 1)[0].strip()
    if not text.startswith("$."):
        return None
    current = data
    for part in text[2:].split("."):
        if part.endswith("[*]"):
            key = part[:-3]
            current = current.get(key) if isinstance(current, dict) else None
            return current if isinstance(current, list) else []
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def resolve_runtime_value(
    value: Any,
    runtime_values: Dict[str, Any],
    job: Dict[str, Any],
    run_id: Optional[int],
) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text.startswith(":"):
        return value
    key = text[1:]
    if key in runtime_values:
        return runtime_values[key]
    camel_key = to_camel_key(key)
    if camel_key in runtime_values:
        return runtime_values[camel_key]
    defaults = {
        "INIT$TargetOwner": job.get("OWNER_NAME") or job.get("ownerName"),
        "INIT$TargetTable": job.get("TABLE_NAME") or job.get("tableName"),
        "INIT$RunSourceType": runtime_values.get("runSourceType") or "DATA_WORK",
        "INIT$RunId": runtime_values.get("runId") or run_id,
        "INIT$ResultModelName": job.get("RESULT_TABLE_NAME") or job.get("resultTableName"),
    }
    return defaults.get(key, value)


def get_payload_value(payload: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload.get(key) is not None:
            return payload.get(key)
    lowered = {str(key).lower(): value for key, value in payload.items()}
    for key in keys:
        lowered_key = str(key).lower()
        if lowered_key in lowered and lowered.get(lowered_key) is not None:
            return lowered.get(lowered_key)
    return None


def normalize_method(value: Any) -> str:
    return str(value or "").strip().upper()


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


def require_identifier(value: Any, field_name: str) -> str:
    name = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", name):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return name


def normalize_identifier(value: Any) -> str:
    text = str(value or "").strip().upper()
    text = re.sub(r"^OUTPUT\.", "", text)
    text = re.sub(r"[^A-Z0-9_$#]", "_", text).strip("_")
    if not text or not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", text):
        return ""
    return text


def strip_detail_prefix(value: Any) -> str:
    text = str(value or "").strip()
    return text.split(".", 1)[1] if "." in text else text


def to_camel_key(value: Any) -> str:
    text = str(value or "").strip()
    parts = [part for part in re.split(r"[_\W]+", text.lower()) if part]
    if not parts:
        return ""
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
