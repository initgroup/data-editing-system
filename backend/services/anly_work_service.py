"""
@file           anly_work_service.py
@description    Reusable analysis result work service
"""

from datetime import date, datetime
from decimal import Decimal
import json
import logging
import re
import time
from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.database_helper import SqlLoader, execute_query
from backend.target_database import get_target_db_connection


logger = logging.getLogger(__name__)

IDENTIFIER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")
MODEL_DETAIL_VIEW_TYPES = {
    "VA": "Attribute/detail view",
    "VG": "Global/detail view",
    "VI": "Itemset/detail view",
    "VR": "Rule/detail view",
}
GENERIC_TABLE_RESULT_LAYOUT = {
    "kind": "TABLE",
    "key": "TABLE:GENERIC",
    "summary": "",
}
TABLE_RESULT_LAYOUTS = {
    "INIT$_TB_PREDICTED_TYPE": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_PREDICTED_TYPE",
        "summary": "predictedTypeSummary",
    },
    "INIT$_TB_PREDICTED_TYPE_FINAL": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_PREDICTED_TYPE",
        "summary": "predictedTypeSummary",
    },
    "INIT$_TB_CAT_CORR_PAIR": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_CAT_CORR_PAIR",
        "summary": "correlationSummary",
    },
    "INIT$_TB_NUM_CORR_PAIR": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_NUM_CORR_PAIR",
        "summary": "correlationSummary",
    },
    "INIT$_TB_LASSO_FEATURE": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_LASSO_FEATURE",
        "summary": "lassoSummary",
    },
    "INIT$_TB_SYMBOLIC_RULE": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_SYMBOLIC_RULE",
        "summary": "symbolicRuleSummary",
    },
    "INIT$_TB_RULE_VIOLATION_RESULT": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_RULE_VIOLATION_RESULT",
        "summary": "violationSummary",
    },
    "INIT$_TB_SYMBOLIC_RULE_VIOLATION": {
        "kind": "TABLE",
        "key": "TABLE:INIT$_TB_SYMBOLIC_RULE_VIOLATION",
        "summary": "symbolicViolationSummary",
    },
}
MODEL_RESULT_LAYOUTS = {
    "ASSOCIATION_RULES": {
        "kind": "MODEL",
        "key": "MODEL:ASSOCIATION_RULES",
        "summary": "associationRules",
    },
    "GENERIC_MODEL": {
        "kind": "MODEL",
        "key": "MODEL:GENERIC",
        "summary": "",
    },
}
READABLE_RULE_SUMMARY_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any] | None]] = {}
READABLE_RULE_SUMMARY_CACHE_TTL_SECONDS = 600
PREDICTED_TYPE_CASE_LABELS = {
    "ALL": ("전체", "모든 예측 결과"),
    "ALL_MATCH": ("FINAL = MODEL = RULE", "세 예측이 모두 같은 높은 추천"),
    "FINAL_MODEL": ("FINAL = MODEL, RULE 다름", "최종 결정이 모델 예측과 일치"),
    "FINAL_BASE": ("FINAL = RULE, MODEL 다름", "최종 결정이 RULE 예측과 일치"),
    "MODEL_BASE": ("MODEL = RULE, FINAL 다름", "모델과 RULE이 같은 예측"),
    "ALL_DIFFERENT": ("셋 다 다름", "세 예측이 모두 달라 확인 필요"),
    "HAS_MISSING": ("값 없음 포함", "FINAL / MODEL / RULE 중 비어 있는 값이 있음"),
}


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


def _get_table_result_layout(object_name: str) -> dict[str, str]:
    normalized_name = str(object_name or "").strip().upper()
    return dict(TABLE_RESULT_LAYOUTS.get(normalized_name) or GENERIC_TABLE_RESULT_LAYOUT)


def _get_model_result_layout(model_name: str, model_metadata: dict[str, Any] | None = None) -> dict[str, str]:
    metadata = model_metadata or {}
    normalized_name = str(model_name or "").strip().upper()
    model_type = str(metadata.get("MODEL_TYPE") or "").upper()
    algorithm = str(metadata.get("ALGORITHM") or metadata.get("MINING_FUNCTION") or "").upper()
    if (
        "ASSOCIATION" in normalized_name
        or "APRIORI" in normalized_name
        or "ASSOCIATION" in model_type
        or "APRIORI" in model_type
        or "ASSOCIATION" in algorithm
        or "APRIORI" in algorithm
    ):
        return dict(MODEL_RESULT_LAYOUTS["ASSOCIATION_RULES"])
    return dict(MODEL_RESULT_LAYOUTS["GENERIC_MODEL"])


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


def _sql_literal(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _normalize_predicted_type_case(value: str | None) -> str:
    normalized = str(value or "ALL").strip().upper()
    return normalized if normalized in PREDICTED_TYPE_CASE_LABELS else "ALL"


def _is_predicted_type_result_table(object_name: str) -> bool:
    return str(object_name or "").strip().upper() in {"INIT$_TB_PREDICTED_TYPE", "INIT$_TB_PREDICTED_TYPE_FINAL"}


def _build_predicted_type_result_sql(
    owner_name: str,
    target_owner: str,
    target_table: str,
    run_source_type: str = "",
    run_id: int | None = None,
    predicted_type_case: str | None = None,
    include_order: bool = True,
) -> tuple[str, dict[str, Any]]:
    predicted_object = f"{_quote_identifier(owner_name)}.\"INIT$_TB_PREDICTED_TYPE\""
    final_object = f"{_quote_identifier(owner_name)}.\"INIT$_TB_PREDICTED_TYPE_FINAL\""
    bind_params: dict[str, Any] = {}
    predicted_filters = []
    final_filters = []
    final_only_filters = []
    if target_owner:
        predicted_filters.append('R."OWNER" = :targetOwner')
        final_filters.append('F0."OWNER" = :targetOwner')
        bind_params["targetOwner"] = target_owner
    if target_table:
        predicted_filters.append('R."TABLE_NAME" = :targetTable')
        final_filters.append('F0."TABLE_NAME" = :targetTable')
        bind_params["targetTable"] = target_table
    if run_source_type and run_id is not None:
        predicted_filters.append('R."RUN_SOURCE_TYPE" = :runSourceType')
        predicted_filters.append('R."RUN_ID" = :runId')
        final_only_filters.append('F."SOURCE_RUN_SOURCE_TYPE" = :runSourceType')
        final_only_filters.append('F."SOURCE_RUN_ID" = :runId')
        bind_params["runSourceType"] = run_source_type
        bind_params["runId"] = run_id
    predicted_where = f" WHERE {' AND '.join(predicted_filters)}" if predicted_filters else ""
    final_where = f" WHERE {' AND '.join(final_filters)}" if final_filters else ""
    final_only_where = ""
    if final_only_filters:
        final_only_where = "   AND (P.\"COLUMN_NAME\" IS NOT NULL OR (" + " AND ".join(final_only_filters) + "))"
    joined_sql = f"""
SELECT COALESCE(P."RUN_SOURCE_TYPE", F."SOURCE_RUN_SOURCE_TYPE") AS "RUN_SOURCE_TYPE"
     , COALESCE(P."RUN_ID", F."SOURCE_RUN_ID") AS "RUN_ID"
     , COALESCE(P."OWNER", F."OWNER") AS "OWNER"
     , COALESCE(P."TABLE_NAME", F."TABLE_NAME") AS "TABLE_NAME"
     , COALESCE(P."MODEL_NAME", F."SOURCE_MODEL_NAME") AS "MODEL_NAME"
     , COALESCE(F."COLUMN_DESC", P."COLUMN_DESC") AS "COLUMN_DESC"
     , COALESCE(F."COLUMN_ID", P."COLUMN_ID") AS "COLUMN_ID"
     , COALESCE(F."COLUMN_NAME", P."COLUMN_NAME") AS "COLUMN_NAME"
     , COALESCE(F."DATA_TYPE", P."DATA_TYPE") AS "DATA_TYPE"
     , P."TOTAL_ROWS" AS "TOTAL_ROWS"
     , P."NUM_DISTINCT" AS "NUM_DISTINCT"
     , P."DIST_VAL_RT" AS "DIST_VAL_RT"
     , P."LOG_DATA_TYPE" AS "LOG_DATA_TYPE"
     , P."ENTROPY" AS "ENTROPY"
     , P."NORM_ENTROPY" AS "NORM_ENTROPY"
     , COALESCE(P."BASE_PREDICTED_TYPE", F."BASE_PREDICTED_TYPE") AS "BASE_PREDICTED_TYPE"
     , P."BASE_REASON" AS "BASE_REASON"
     , COALESCE(P."MODL_PREDICTED_TYPE", F."MODL_PREDICTED_TYPE") AS "MODL_PREDICTED_TYPE"
     , COALESCE(F."FINAL_PREDICTED_TYPE", P."FINAL_PREDICTED_TYPE", P."MODL_PREDICTED_TYPE", P."BASE_PREDICTED_TYPE") AS "FINAL_PREDICTED_TYPE"
     , P."FINAL_PREDICTED_TYPE" AS "RUN_FINAL_PREDICTED_TYPE"
     , F."FINAL_PREDICTED_TYPE" AS "MASTER_FINAL_PREDICTED_TYPE"
     , CASE
           WHEN F."FINAL_PREDICTED_TYPE" IS NOT NULL THEN 'MASTER_FINAL'
           WHEN P."FINAL_PREDICTED_TYPE" IS NOT NULL THEN 'RUN_FINAL'
           WHEN P."MODL_PREDICTED_TYPE" IS NOT NULL THEN 'RUN_MODEL'
           WHEN P."BASE_PREDICTED_TYPE" IS NOT NULL THEN 'RUN_RULE'
           ELSE 'NONE'
       END AS "FINAL_APPLY_SOURCE"
     , COALESCE(F."FINAL_REASON", P."FINAL_REASON") AS "FINAL_REASON"
     , COALESCE(F."FINAL_UPDATE_DT", P."FINAL_UPDATE_DT") AS "FINAL_UPDATE_DT"
     , COALESCE(F."FINAL_UPDATE_USER", P."FINAL_UPDATE_USER") AS "FINAL_UPDATE_USER"
     , F."SOURCE_RUN_SOURCE_TYPE" AS "SOURCE_RUN_SOURCE_TYPE"
     , F."SOURCE_RUN_ID" AS "SOURCE_RUN_ID"
     , F."SOURCE_MODEL_NAME" AS "SOURCE_MODEL_NAME"
     , P."CREATE_DT" AS "RUN_CREATE_DT"
     , F."CREATE_DT" AS "MASTER_CREATE_DT"
  FROM (
        SELECT R.*
          FROM {predicted_object} R
{predicted_where}
       ) P
  FULL OUTER JOIN (
        SELECT F0.*
          FROM {final_object} F0
{final_where}
       ) F
    ON F."OWNER" = P."OWNER"
   AND F."TABLE_NAME" = P."TABLE_NAME"
   AND F."COLUMN_NAME" = P."COLUMN_NAME"
 WHERE 1=1
{final_only_where}
"""
    normalized_case = _normalize_predicted_type_case(predicted_type_case)
    base_sql = f"SELECT * FROM ({joined_sql}) Q"
    if normalized_case != "ALL":
        base_sql += f" WHERE {_predicted_type_case_expr()} = :predictedTypeCase"
        bind_params["predictedTypeCase"] = normalized_case
    if include_order:
        base_sql += ' ORDER BY "COLUMN_ID" NULLS LAST, "COLUMN_NAME", "MODEL_NAME"'
    return base_sql, bind_params


def _predicted_type_value_expr(column_name: str) -> str:
    return f"TRIM({column_name})"


def _predicted_type_compare_expr(column_name: str) -> str:
    value_expr = _predicted_type_value_expr(column_name)
    return (
        "CASE "
        f"WHEN {value_expr} IS NULL THEN NULL "
        f"WHEN {value_expr} LIKE '%범주형' THEN '범주형' "
        f"WHEN {value_expr} LIKE '%연속형' THEN '연속형' "
        f"ELSE {value_expr} END"
    )


def _predicted_type_case_expr() -> str:
    final_value_expr = _predicted_type_value_expr("FINAL_PREDICTED_TYPE")
    model_value_expr = _predicted_type_value_expr("MODL_PREDICTED_TYPE")
    base_value_expr = _predicted_type_value_expr("BASE_PREDICTED_TYPE")
    final_expr = _predicted_type_compare_expr("FINAL_PREDICTED_TYPE")
    model_expr = _predicted_type_compare_expr("MODL_PREDICTED_TYPE")
    base_expr = _predicted_type_compare_expr("BASE_PREDICTED_TYPE")
    return (
        "CASE "
        f"WHEN {final_value_expr} IS NULL OR {model_value_expr} IS NULL OR {base_value_expr} IS NULL THEN 'HAS_MISSING' "
        f"WHEN {final_expr} = {model_expr} AND {model_expr} = {base_expr} THEN 'ALL_MATCH' "
        f"WHEN {final_expr} = {model_expr} AND {final_expr} <> {base_expr} THEN 'FINAL_MODEL' "
        f"WHEN {final_expr} = {base_expr} AND {final_expr} <> {model_expr} THEN 'FINAL_BASE' "
        f"WHEN {model_expr} = {base_expr} AND {final_expr} <> {model_expr} THEN 'MODEL_BASE' "
        "ELSE 'ALL_DIFFERENT' END"
    )


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


def _normalize_run_context(
    run_source_type: str | None = None,
    run_id: int | None = None,
    flow_run_id: int | None = None,
) -> tuple[str, int | None]:
    if flow_run_id is not None:
        try:
            value = int(flow_run_id)
        except (TypeError, ValueError):
            value = 0
        return ("FLOW_WORK", value) if value > 0 else ("", None)

    source = str(run_source_type or "").strip().upper()
    if source not in {"DATA_WORK", "FLOW_WORK"}:
        source = ""
    try:
        value = int(run_id) if run_id is not None else None
    except (TypeError, ValueError):
        value = None
    if not source or value is None or value < 0:
        return "", None
    return source, value


def _normalize_node_result(row: dict[str, Any]) -> dict[str, Any]:
    payload = _json_object(_parse_json(row.get("NODE_PAYLOAD_JSON"), {}) or {})
    runtime_params = _json_object(_parse_json(row.get("RUNTIME_PARAM_JSON"), {}) or {})
    job_params = _parse_json(row.get("JOB_PARAM_JSON"), []) or []
    payload_params = payload.get("params") if isinstance(payload.get("params"), list) else payload.get("PARAMS")
    if isinstance(job_params, list) and len(job_params) > len(payload_params or []):
        payload["params"] = job_params
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
    if mode == "M":
        runtime_model_name = (
            runtime_params.get("P_MODEL_NAME")
            or runtime_params.get("pModelName")
            or runtime_params.get("modelName")
            or runtime_params.get("INIT$ResultModelName")
            or ""
        )
        if runtime_model_name and re.match(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$", str(runtime_model_name).strip()):
            object_name = runtime_model_name
    row["RESULT_OBJECT_NAME"] = str(object_name or "").strip().upper()
    row["TARGET_OWNER"] = str(target_owner or "").strip().upper()
    row["TARGET_TABLE"] = str(target_table or "").strip().upper()
    row["RESULT_KIND"] = "MODEL" if mode == "M" else ("TABLE" if mode == "T" else "NONE")
    return row


def _get_table_columns(cursor, owner_name: str, object_name: str) -> set[str]:
    cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_RESULT_TABLE_COLUMNS"), {"owner": owner_name, "tableName": object_name})
    return {str(row[0]).upper() for row in cursor.fetchall()}


def _fetch_column_comment_map(cursor, owner_name: str, table_name: str) -> dict[str, str]:
    if not owner_name or not table_name:
        return {}
    cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_TARGET_COLUMN_COMMENTS"), {
        "owner": owner_name,
        "tableName": table_name,
    })
    comments: dict[str, str] = {}
    for column_name, column_comment in cursor.fetchall():
        if column_name and column_comment:
            comments[str(column_name).upper()] = str(column_comment)
    return comments


def _fetch_cat_corr_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    run_source_type: str = "",
    run_id: int | None = None,
) -> dict[str, Any] | None:
    if object_name not in {"INIT$_TB_CAT_CORR_PAIR", "INIT$_TB_NUM_CORR_PAIR"} or not target_owner or not target_table:
        return None
    is_numeric = object_name == "INIT$_TB_NUM_CORR_PAIR"
    metric_column = "ABS_PEARSON_R" if is_numeric else "CRAMERS_V"
    signed_metric_column = "PEARSON_R" if is_numeric else "CRAMERS_V"
    cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_TARGET_TABLE_COLUMN_COUNT"), {
        "owner": target_owner,
        "tableName": target_table,
    })
    row = cursor.fetchone()
    total_columns = int(row[0] or 0) if row else 0
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    run_filter_sql = ""
    run_params: dict[str, Any] = {}
    if run_source_type and run_id is not None:
        run_filter_sql = " AND RUN_SOURCE_TYPE = :runSourceType AND RUN_ID = :runId "
        run_params = {"runSourceType": run_source_type, "runId": run_id}
    cursor.execute(
        "SELECT DISTINCT COL1 "
        "  FROM ("
        f"        SELECT COL_A AS COL1 FROM {result_object} "
        f"         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}AND PASS_YN = 'Y' "
        "         UNION ALL "
        f"        SELECT COL_B AS COL1 FROM {result_object} "
        f"         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}AND PASS_YN = 'Y' "
        "       ) "
        " WHERE COL1 IS NOT NULL "
        " ORDER BY COL1",
        {"targetOwner": target_owner, "targetTable": target_table, **run_params},
    )
    associated_columns = [str(item[0]) for item in cursor.fetchall() if item and item[0]]
    cursor.execute(
        "SELECT COUNT(*) AS TOTAL_PAIR_COUNT, "
        "       SUM(CASE WHEN PASS_YN = 'Y' THEN 1 ELSE 0 END) AS PASS_PAIR_COUNT, "
        f"      AVG(CASE WHEN PASS_YN = 'Y' THEN {metric_column} END) AS AVG_METRIC_VALUE, "
        f"      MAX(CASE WHEN PASS_YN = 'Y' THEN {metric_column} END) AS MAX_METRIC_VALUE "
        f"  FROM {result_object} "
        f" WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}",
        {"targetOwner": target_owner, "targetTable": target_table, **run_params},
    )
    pair_row = cursor.fetchone()
    pair_columns = [desc[0] for desc in cursor.description] if cursor.description else []
    pair_metrics = _row_to_dict(pair_columns, pair_row) if pair_row else {}
    cursor.execute(
        "SELECT * "
        "  FROM ("
        f"        SELECT COL_A, COL_B, ROW_COUNT, {signed_metric_column} AS METRIC_VALUE, "
        f"               {metric_column} AS SORT_METRIC_VALUE, P_VALUE, PASS_YN "
        f"          FROM {result_object} "
        f"         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
        "           AND PASS_YN = 'Y' "
        f"         ORDER BY {metric_column} DESC NULLS LAST, P_VALUE ASC NULLS LAST, COL_A, COL_B"
        "       ) "
        " WHERE ROWNUM <= 12",
        {"targetOwner": target_owner, "targetTable": target_table, **run_params},
    )
    top_pair_columns = [desc[0] for desc in cursor.description] if cursor.description else []
    top_pairs = [_row_to_dict(top_pair_columns, row) for row in cursor.fetchall()]
    column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
    return {
        "correlationKind": "NUMERIC" if is_numeric else "CATEGORICAL",
        "metricColumn": metric_column,
        "metricLabel": "|Pearson r|" if is_numeric else "Cramer's V",
        "signedMetricLabel": "Pearson r" if is_numeric else "Cramer's V",
        "targetOwner": target_owner,
        "targetTable": target_table,
        "totalColumnCount": total_columns,
        "associatedColumnCount": len(associated_columns),
        "associatedColumns": associated_columns,
        "columnComments": column_comments,
        "associatedPairCount": int(pair_metrics.get("PASS_PAIR_COUNT") or 0),
        "totalPairCount": int(pair_metrics.get("TOTAL_PAIR_COUNT") or 0),
        "averageMetricValue": pair_metrics.get("AVG_METRIC_VALUE"),
        "maxMetricValue": pair_metrics.get("MAX_METRIC_VALUE"),
        "topPairs": top_pairs,
    }


def _split_column_list(value: Any, limit: int = 20) -> list[str]:
    columns: list[str] = []
    for part in re.split(r"[,;\s]+", str(value or "")):
        column = part.strip().upper()
        if not column or column in columns:
            continue
        if IDENTIFIER_RE.match(column):
            columns.append(column)
        if len(columns) >= limit:
            break
    return columns


def _fetch_numeric_feature_ranges(
    cursor,
    owner_name: str,
    table_name: str,
    column_names: list[str],
) -> dict[str, dict[str, Any]]:
    if not owner_name or not table_name or not column_names:
        return {}
    available_columns = _get_table_columns(cursor, owner_name, table_name)
    safe_columns = [
        column
        for column in column_names
        if column in available_columns and IDENTIFIER_RE.match(column)
    ][:20]
    if not safe_columns:
        return {}
    target_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(table_name)}"
    union_sql = " UNION ALL ".join(
        "SELECT "
        f"       {_sql_literal(column)} AS COLUMN_NAME, "
        f"       MIN(TO_NUMBER({_quote_identifier(column)})) AS MIN_VALUE, "
        f"       MAX(TO_NUMBER({_quote_identifier(column)})) AS MAX_VALUE, "
        f"       AVG(TO_NUMBER({_quote_identifier(column)})) AS AVG_VALUE, "
        f"       COUNT({_quote_identifier(column)}) AS VALUE_COUNT "
        f"  FROM {target_object}"
        for column in safe_columns
    )
    try:
        cursor.execute(union_sql)
        columns = [desc[0] for desc in cursor.description]
        return {
            str(row[0]).upper(): _row_to_dict(columns, row)
            for row in cursor.fetchall()
            if row and row[0]
        }
    except Exception as error:
        logger.info("MCOMMON_ANLY_WORK feature range query skipped: %s", error)
        return {}


def _fetch_lasso_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    run_source_type: str = "",
    run_id: int | None = None,
) -> dict[str, Any] | None:
    if object_name != "INIT$_TB_LASSO_FEATURE" or not target_owner or not target_table:
        return None
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    run_filter_sql = ""
    run_params: dict[str, Any] = {}
    if run_source_type and run_id is not None:
        run_filter_sql = " AND RUN_SOURCE_TYPE = :runSourceType AND RUN_ID = :runId "
        run_params = {"runSourceType": run_source_type, "runId": run_id}
    params = {"targetOwner": target_owner, "targetTable": target_table, **run_params}

    def fetch_one(sql: str) -> dict[str, Any]:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        return _row_to_dict(columns, row) if row else {}

    def fetch_many(sql: str) -> list[dict[str, Any]]:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        return [_row_to_dict(columns, row) for row in cursor.fetchall()]

    overview = fetch_one(
        "SELECT COUNT(*) AS FEATURE_ROW_COUNT, "
        "       COUNT(DISTINCT TARGET_COLUMN) AS TARGET_COLUMN_COUNT, "
        "       COUNT(DISTINCT FEATURE_NAME) AS FEATURE_NAME_COUNT, "
        "       SUM(CASE WHEN SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_FEATURE_COUNT, "
        "       SUM(CASE WHEN SELECTED_YN = 'Y' AND NVL(COEFFICIENT, 0) > 0 THEN 1 ELSE 0 END) AS POSITIVE_FEATURE_COUNT, "
        "       SUM(CASE WHEN SELECTED_YN = 'Y' AND NVL(COEFFICIENT, 0) < 0 THEN 1 ELSE 0 END) AS NEGATIVE_FEATURE_COUNT, "
        "       AVG(R2_SCORE) AS AVG_R2_SCORE, "
        "       MAX(R2_SCORE) AS MAX_R2_SCORE, "
        "       MAX(MODEL_ALPHA) AS MODEL_ALPHA "
        f"  FROM {result_object} "
        f" WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
    )
    top_targets = fetch_many(
        "SELECT * "
        "  FROM ("
        "        SELECT TARGET_COLUMN, "
        "               COUNT(*) AS FEATURE_ROW_COUNT, "
        "               SUM(CASE WHEN SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_FEATURE_COUNT, "
        "               MAX(R2_SCORE) AS R2_SCORE, "
        "               MAX(ABS_COEFFICIENT) AS MAX_ABS_COEFFICIENT, "
        "               MIN(RANK_NO) AS BEST_RANK_NO "
        f"          FROM {result_object} "
        f"         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
        "         GROUP BY TARGET_COLUMN "
        "         ORDER BY R2_SCORE DESC NULLS LAST, SELECTED_FEATURE_COUNT DESC, TARGET_COLUMN"
        "       ) "
        " WHERE ROWNUM <= 12"
    )
    top_features = fetch_many(
        "SELECT * "
        "  FROM ("
        "        SELECT TARGET_COLUMN, FEATURE_NAME, COEFFICIENT, ABS_COEFFICIENT, "
        "               RANK_NO, SELECTED_YN, R2_SCORE "
        f"          FROM {result_object} "
        f"         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
        "           AND SELECTED_YN = 'Y' "
        "         ORDER BY ABS_COEFFICIENT DESC NULLS LAST, RANK_NO NULLS LAST, TARGET_COLUMN, FEATURE_NAME"
        "       ) "
        " WHERE ROWNUM <= 16"
    )
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "overview": overview,
        "topTargets": top_targets,
        "topFeatures": top_features,
        "columnComments": _fetch_column_comment_map(cursor, target_owner, target_table),
        "runSourceType": run_source_type,
        "runId": run_id,
    }


def _fetch_symbolic_rule_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    run_source_type: str = "",
    run_id: int | None = None,
) -> dict[str, Any] | None:
    if object_name != "INIT$_TB_SYMBOLIC_RULE" or not target_owner or not target_table:
        return None
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    run_filter_sql = ""
    run_params: dict[str, Any] = {}
    if run_source_type and run_id is not None:
        run_filter_sql = " AND RUN_SOURCE_TYPE = :runSourceType AND RUN_ID = :runId "
        run_params = {"runSourceType": run_source_type, "runId": run_id}
    params = {"targetOwner": target_owner, "targetTable": target_table, **run_params}

    def fetch_one(sql: str) -> dict[str, Any]:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        return _row_to_dict(columns, row) if row else {}

    def fetch_many(sql: str) -> list[dict[str, Any]]:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        return [_row_to_dict(columns, row) for row in cursor.fetchall()]

    overview = fetch_one(
        "SELECT COUNT(*) AS RULE_COUNT, "
        "       COUNT(DISTINCT TARGET_COLUMN) AS TARGET_COLUMN_COUNT, "
        "       SUM(CASE WHEN SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_RULE_COUNT, "
        "       AVG(SCORE) AS AVG_SCORE, "
        "       MAX(SCORE) AS MAX_SCORE, "
        "       AVG(COMPLEXITY) AS AVG_COMPLEXITY, "
        "       MAX(COMPLEXITY) AS MAX_COMPLEXITY "
        f"  FROM {result_object} "
        f" WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
    )
    method_groups = fetch_many(
        "SELECT NVL(METHOD, '(UNKNOWN)') AS METHOD, "
        "       COUNT(*) AS RULE_COUNT, "
        "       AVG(SCORE) AS AVG_SCORE, "
        "       AVG(COMPLEXITY) AS AVG_COMPLEXITY "
        f"  FROM {result_object} "
        f" WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
        " GROUP BY NVL(METHOD, '(UNKNOWN)') "
        " ORDER BY RULE_COUNT DESC, METHOD"
    )
    target_groups = fetch_many(
        "SELECT TARGET_COLUMN, "
        "       COUNT(*) AS RULE_COUNT, "
        "       SUM(CASE WHEN SELECTED_YN = 'Y' THEN 1 ELSE 0 END) AS SELECTED_RULE_COUNT, "
        "       MAX(SCORE) AS MAX_SCORE, "
        "       MIN(RANK_NO) AS BEST_RANK_NO "
        f"  FROM {result_object} "
        f" WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
        " GROUP BY TARGET_COLUMN "
        " ORDER BY SELECTED_RULE_COUNT DESC, MAX_SCORE DESC NULLS LAST, TARGET_COLUMN"
    )
    top_rules = fetch_many(
        "SELECT * "
        "  FROM ("
        "        SELECT TARGET_COLUMN, RULE_ID, DBMS_LOB.SUBSTR(EXPRESSION, 4000, 1) AS EXPRESSION, "
        "               SCORE, COMPLEXITY, RANK_NO, SELECTED_YN, FEATURE_COLUMNS, METHOD, MESSAGE "
        f"          FROM {result_object} "
        f"         WHERE OWNER = :targetOwner AND TABLE_NAME = :targetTable {run_filter_sql}"
        "         ORDER BY CASE WHEN SELECTED_YN = 'Y' THEN 0 ELSE 1 END, "
        "                  RANK_NO NULLS LAST, SCORE DESC NULLS LAST, TARGET_COLUMN, RULE_ID"
        "       ) "
        " WHERE ROWNUM <= 12"
    )
    range_columns: list[str] = []
    for rule in top_rules:
        range_columns.extend(_split_column_list(rule.get("FEATURE_COLUMNS"), 20))
    range_map = _fetch_numeric_feature_ranges(cursor, target_owner, target_table, range_columns)
    for rule in top_rules:
        features = _split_column_list(rule.get("FEATURE_COLUMNS"), 20)
        rule["FEATURE_LIST"] = features
        rule["FEATURE_RANGES"] = [range_map[column] for column in features if column in range_map]
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "overview": overview,
        "methodGroups": method_groups,
        "targetGroups": target_groups,
        "topRules": top_rules,
        "columnComments": _fetch_column_comment_map(cursor, target_owner, target_table),
        "runSourceType": run_source_type,
        "runId": run_id,
    }


def _fetch_symbolic_violation_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    run_source_type: str = "",
    run_id: int | None = None,
    rule_id_filter: str = "",
) -> dict[str, Any] | None:
    if object_name != "INIT$_TB_SYMBOLIC_RULE_VIOLATION" or not target_owner or not target_table:
        return None
    result_object = f"{_quote_identifier(owner_name)}.{_quote_identifier(object_name)}"
    rule_object = f"{_quote_identifier(owner_name)}.\"INIT$_TB_SYMBOLIC_RULE\""
    run_filter_sql = ""
    rule_run_filter_sql = ""
    run_params: dict[str, Any] = {}
    if run_source_type and run_id is not None:
        run_filter_sql = " AND RUN_SOURCE_TYPE = :runSourceType AND RUN_ID = :runId "
        rule_run_filter_sql = " AND R.RUN_SOURCE_TYPE = :runSourceType AND R.RUN_ID = :runId "
        run_params = {"runSourceType": run_source_type, "runId": run_id}
    rule_filter_sql = ""
    violation_rule_filter_sql = ""
    if rule_id_filter:
        rule_filter_sql = " AND UPPER(R.RULE_ID) LIKE '%' || UPPER(:ruleIdFilter) || '%' "
        violation_rule_filter_sql = " AND UPPER(RULE_ID) LIKE '%' || UPPER(:ruleIdFilter) || '%' "
    params = {"targetOwner": target_owner, "targetTable": target_table, **run_params}
    if rule_id_filter:
        params["ruleIdFilter"] = rule_id_filter

    def fetch_one(sql: str) -> dict[str, Any]:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        return _row_to_dict(columns, row) if row else {}

    def fetch_many(sql: str) -> list[dict[str, Any]]:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        return [_row_to_dict(columns, row) for row in cursor.fetchall()]

    overview = fetch_one(
        "WITH R AS ("
        "        SELECT R.RULE_ID, R.TARGET_COLUMN "
        f"          FROM {rule_object} R "
        f"         WHERE R.OWNER = :targetOwner AND R.TABLE_NAME = :targetTable {rule_run_filter_sql}{rule_filter_sql}"
        "       ), "
        "V AS ("
        "        SELECT RULE_ID, TARGET_COLUMN, COUNT(*) AS VIOLATION_COUNT, "
        "               COUNT(DISTINCT NVL(CASE_ID, CASE_ROWID)) AS VIOLATED_ROW_COUNT, "
        "               AVG(ABS_ERROR) AS AVG_ABS_ERROR, MAX(ABS_ERROR) AS MAX_ABS_ERROR, "
        "               AVG(ERROR_PCT) AS AVG_ERROR_PCT, MAX(ERROR_PCT) AS MAX_ERROR_PCT, "
        "               MAX(TOLERANCE_PCT) AS TOLERANCE_PCT "
        f"          FROM {result_object} "
        f"         WHERE TARGET_OWNER = :targetOwner AND TARGET_TABLE = :targetTable {run_filter_sql}{violation_rule_filter_sql}"
        "         GROUP BY RULE_ID, TARGET_COLUMN "
        "       ) "
        "SELECT COUNT(R.RULE_ID) AS RULE_COUNT, "
        "       COUNT(DISTINCT R.TARGET_COLUMN) AS TARGET_COLUMN_COUNT, "
        "       NVL(SUM(V.VIOLATION_COUNT), 0) AS VIOLATION_COUNT, "
        "       NVL(SUM(V.VIOLATED_ROW_COUNT), 0) AS VIOLATED_ROW_COUNT, "
        "       SUM(CASE WHEN NVL(V.VIOLATION_COUNT, 0) > 0 THEN 1 ELSE 0 END) AS VIOLATED_RULE_COUNT, "
        "       SUM(CASE WHEN NVL(V.VIOLATION_COUNT, 0) = 0 THEN 1 ELSE 0 END) AS NO_VIOLATION_RULE_COUNT, "
        "       AVG(V.AVG_ABS_ERROR) AS AVG_ABS_ERROR, "
        "       MAX(V.MAX_ABS_ERROR) AS MAX_ABS_ERROR, "
        "       AVG(V.AVG_ERROR_PCT) AS AVG_ERROR_PCT, "
        "       MAX(V.MAX_ERROR_PCT) AS MAX_ERROR_PCT, "
        "       MAX(V.TOLERANCE_PCT) AS TOLERANCE_PCT "
        "  FROM R "
        "  LEFT JOIN V "
        "    ON V.RULE_ID = R.RULE_ID "
        "   AND V.TARGET_COLUMN = R.TARGET_COLUMN"
    )
    top_rules = fetch_many(
        "SELECT * "
        "  FROM ("
        "        SELECT R.RULE_ID, R.TARGET_COLUMN, DBMS_LOB.SUBSTR(R.EXPRESSION, 4000, 1) AS EXPRESSION, "
        "               R.FEATURE_COLUMNS, R.SCORE AS RULE_SCORE, R.COMPLEXITY AS RULE_COMPLEXITY, R.METHOD AS RULE_METHOD, "
        "               NVL(V.VIOLATION_COUNT, 0) AS VIOLATION_COUNT, "
        "               NVL(V.VIOLATED_ROW_COUNT, 0) AS VIOLATED_ROW_COUNT, "
        "               V.AVG_ERROR_PCT, V.MAX_ERROR_PCT, V.AVG_ABS_ERROR, V.MAX_VIOLATION_SCORE, V.TOLERANCE_PCT "
        f"          FROM {rule_object} R "
        "          LEFT JOIN ("
        "                SELECT RULE_ID, TARGET_COLUMN, COUNT(*) AS VIOLATION_COUNT, "
        "                       COUNT(DISTINCT NVL(CASE_ID, CASE_ROWID)) AS VIOLATED_ROW_COUNT, "
        "                       AVG(ERROR_PCT) AS AVG_ERROR_PCT, MAX(ERROR_PCT) AS MAX_ERROR_PCT, "
        "                       AVG(ABS_ERROR) AS AVG_ABS_ERROR, MAX(VIOLATION_SCORE) AS MAX_VIOLATION_SCORE, "
        "                       MAX(TOLERANCE_PCT) AS TOLERANCE_PCT "
        f"                  FROM {result_object} "
        f"                 WHERE TARGET_OWNER = :targetOwner AND TARGET_TABLE = :targetTable {run_filter_sql}{violation_rule_filter_sql}"
        "                 GROUP BY RULE_ID, TARGET_COLUMN "
        "               ) V "
        "            ON V.RULE_ID = R.RULE_ID "
        "           AND V.TARGET_COLUMN = R.TARGET_COLUMN "
        f"         WHERE R.OWNER = :targetOwner AND R.TABLE_NAME = :targetTable {rule_run_filter_sql}{rule_filter_sql}"
        "         ORDER BY NVL(V.VIOLATION_COUNT, 0) DESC, V.MAX_ERROR_PCT DESC NULLS LAST, R.RANK_NO NULLS LAST, R.TARGET_COLUMN, R.RULE_ID"
        "       ) "
        " WHERE ROWNUM <= 12"
    )
    top_targets = fetch_many(
        "SELECT * "
        "  FROM ("
        "        SELECT R.TARGET_COLUMN, COUNT(R.RULE_ID) AS RULE_COUNT, "
        "               NVL(SUM(V.VIOLATION_COUNT), 0) AS VIOLATION_COUNT, "
        "               SUM(CASE WHEN NVL(V.VIOLATION_COUNT, 0) > 0 THEN 1 ELSE 0 END) AS VIOLATED_RULE_COUNT, "
        "               AVG(V.AVG_ERROR_PCT) AS AVG_ERROR_PCT "
        f"          FROM {rule_object} R "
        "          LEFT JOIN ("
        "                SELECT RULE_ID, TARGET_COLUMN, COUNT(*) AS VIOLATION_COUNT, AVG(ERROR_PCT) AS AVG_ERROR_PCT "
        f"                  FROM {result_object} "
        f"                 WHERE TARGET_OWNER = :targetOwner AND TARGET_TABLE = :targetTable {run_filter_sql}{violation_rule_filter_sql}"
        "                 GROUP BY RULE_ID, TARGET_COLUMN "
        "               ) V "
        "            ON V.RULE_ID = R.RULE_ID "
        "           AND V.TARGET_COLUMN = R.TARGET_COLUMN "
        f"         WHERE R.OWNER = :targetOwner AND R.TABLE_NAME = :targetTable {rule_run_filter_sql}{rule_filter_sql}"
        "         GROUP BY R.TARGET_COLUMN "
        "         ORDER BY VIOLATION_COUNT DESC, AVG_ERROR_PCT DESC NULLS LAST, R.TARGET_COLUMN"
        "       ) "
        " WHERE ROWNUM <= 12"
    )
    range_columns: list[str] = []
    for rule in top_rules:
        range_columns.extend(_split_column_list(rule.get("FEATURE_COLUMNS"), 20))
    range_map = _fetch_numeric_feature_ranges(cursor, target_owner, target_table, range_columns)
    for rule in top_rules:
        features = _split_column_list(rule.get("FEATURE_COLUMNS"), 20)
        rule["FEATURE_LIST"] = features
        rule["FEATURE_RANGES"] = [range_map[column] for column in features if column in range_map]
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "overview": overview,
        "topRules": top_rules,
        "topTargets": top_targets,
        "ruleIdFilter": rule_id_filter,
        "columnComments": _fetch_column_comment_map(cursor, target_owner, target_table),
        "runSourceType": run_source_type,
        "runId": run_id,
    }


def _fetch_predicted_type_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    run_source_type: str = "",
    run_id: int | None = None,
) -> dict[str, Any] | None:
    if not _is_predicted_type_result_table(object_name) or not target_owner or not target_table:
        return None
    cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_TARGET_TABLE_COLUMN_COUNT"), {
        "owner": target_owner,
        "tableName": target_table,
    })
    row = cursor.fetchone()
    total_columns = int(row[0] or 0) if row else 0
    result_sql, result_params = _build_predicted_type_result_sql(
        owner_name,
        target_owner,
        target_table,
        run_source_type,
        run_id,
        "ALL",
        include_order=False,
    )
    result_object = f"({result_sql})"
    effective_type_expr = "COALESCE(TRIM(FINAL_PREDICTED_TYPE), TRIM(MODL_PREDICTED_TYPE), TRIM(BASE_PREDICTED_TYPE))"
    final_type_expr = "TRIM(MASTER_FINAL_PREDICTED_TYPE)"
    run_type_expr = "COALESCE(TRIM(RUN_FINAL_PREDICTED_TYPE), TRIM(MODL_PREDICTED_TYPE), TRIM(BASE_PREDICTED_TYPE))"
    rule_type_expr = "TRIM(BASE_PREDICTED_TYPE)"
    model_type_expr = "TRIM(MODL_PREDICTED_TYPE)"
    predicted_case_expr = _predicted_type_case_expr()

    def fetch_group_map(type_expr: str) -> dict[str, list[str]]:
        cursor.execute(
            "SELECT TYPE_GROUP, COLUMN_NAME "
            "  FROM ("
            "        SELECT CASE "
            f"                 WHEN {type_expr} LIKE '%범주형' THEN '범주형' "
            f"                 WHEN {type_expr} LIKE '%연속형' THEN '연속형' "
            "                 ELSE '기타' "
            "               END AS TYPE_GROUP, "
            "               COLUMN_NAME, "
            "               MIN(NVL(COLUMN_ID, 999999)) AS COLUMN_ORDER "
            f"          FROM {result_object} "
            "         WHERE COLUMN_NAME IS NOT NULL "
            "         GROUP BY CASE "
            f"                    WHEN {type_expr} LIKE '%범주형' THEN '범주형' "
            f"                    WHEN {type_expr} LIKE '%연속형' THEN '연속형' "
            "                    ELSE '기타' "
            "                  END, COLUMN_NAME "
            "       ) "
            " ORDER BY DECODE(TYPE_GROUP, '범주형', 1, '연속형', 2, 3), COLUMN_ORDER, COLUMN_NAME",
            result_params,
        )
        group_map: dict[str, list[str]] = {"범주형": [], "연속형": [], "기타": []}
        for type_group, column_name in cursor.fetchall():
            key = str(type_group or "기타")
            group_map.setdefault(key, []).append(str(column_name))
        return group_map

    def to_summary_groups(group_map: dict[str, list[str]]) -> list[dict[str, Any]]:
        return [
            {"typeGroup": key, "columnCount": len(columns), "columns": columns}
            for key, columns in group_map.items()
            if columns or key in ("범주형", "연속형")
        ]

    group_map = fetch_group_map(effective_type_expr)
    final_group_map = fetch_group_map(final_type_expr)
    run_group_map = fetch_group_map(run_type_expr)
    prediction_source_groups = [
        {
            "sourceCode": "RULE",
            "sourceLabel": "RULE",
            "sourceColumn": "BASE_PREDICTED_TYPE",
            "description": "규칙 기반 BASE_PREDICTED_TYPE",
            "groups": to_summary_groups(fetch_group_map(rule_type_expr)),
        },
        {
            "sourceCode": "MODEL",
            "sourceLabel": "MODEL",
            "sourceColumn": "MODL_PREDICTED_TYPE",
            "description": "모델 기반 MODL_PREDICTED_TYPE",
            "groups": to_summary_groups(fetch_group_map(model_type_expr)),
        },
        {
            "sourceCode": "FINAL",
            "sourceLabel": "FINAL",
            "sourceColumn": "MASTER_FINAL_PREDICTED_TYPE",
            "description": "후속 노드에 적용되는 INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_PREDICTED_TYPE",
            "groups": to_summary_groups(fetch_group_map(final_type_expr)),
        },
    ]
    cursor.execute(
        f"SELECT NVL({effective_type_expr}, '(값 없음)') AS TYPE_NAME, "
        "       COUNT(DISTINCT COLUMN_NAME) AS COLUMN_COUNT "
        f"  FROM {result_object} "
        " WHERE COLUMN_NAME IS NOT NULL "
        f" GROUP BY NVL({effective_type_expr}, '(값 없음)') "
        " ORDER BY COLUMN_COUNT DESC, TYPE_NAME",
        result_params,
    )
    detail_groups = [
        {"typeName": str(type_name), "columnCount": int(column_count or 0)}
        for type_name, column_count in cursor.fetchall()
    ]
    cursor.execute(
        f"SELECT {predicted_case_expr} AS CASE_CODE, "
        "       COUNT(DISTINCT COLUMN_NAME) AS COLUMN_COUNT "
        f"  FROM {result_object} "
        " WHERE COLUMN_NAME IS NOT NULL "
        f" GROUP BY {predicted_case_expr}",
        result_params,
    )
    match_count_map = {str(case_code or "ALL_DIFFERENT"): int(column_count or 0) for case_code, column_count in cursor.fetchall()}
    prediction_match_groups = []
    denominator = max(1, total_columns)
    for case_code in ("ALL_MATCH", "FINAL_MODEL", "FINAL_BASE", "MODEL_BASE", "ALL_DIFFERENT", "HAS_MISSING"):
        label, description = PREDICTED_TYPE_CASE_LABELS[case_code]
        column_count = int(match_count_map.get(case_code, 0))
        prediction_match_groups.append({
            "caseCode": case_code,
            "label": label,
            "description": description,
            "columnCount": column_count,
            "rate": round((column_count / denominator) * 100, 1),
        })
    column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
    return {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "totalColumnCount": total_columns,
        "columnComments": column_comments,
        "summaryGroups": to_summary_groups(group_map),
        "finalSummaryGroups": to_summary_groups(final_group_map),
        "runSummaryGroups": to_summary_groups(run_group_map),
        "predictionSourceGroups": prediction_source_groups,
        "detailGroups": detail_groups,
        "predictionMatchGroups": prediction_match_groups,
    }


def _fetch_rule_violation_summary(
    cursor,
    owner_name: str,
    object_name: str,
    target_owner: str,
    target_table: str,
    rule_model_name: str = "",
    rule_id_filter: str = "",
    condition_count: int | None = None,
    confidence_scope: str = "NON_PERFECT",
    result_scope: str = "HIT",
    detection_min_confidence: float = 0.8,
    detection_min_lift: float = 1.0,
    detection_max_rules: int = 500,
    rule_page: int = 1,
    rule_page_size: int = 8,
    run_source_type: str = "",
    run_id: int | None = None,
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
    if run_source_type and run_id is not None:
        where_clauses.append("RUN_SOURCE_TYPE = :runSourceType")
        where_clauses.append("RUN_ID = :runId")
        bind_params["runSourceType"] = run_source_type
        bind_params["runId"] = run_id
    if rule_model_name:
        where_clauses.append("MODEL_NAME = :ruleModelName")
        bind_params["ruleModelName"] = rule_model_name
    if condition_count is not None:
        where_clauses.append("CONDITION_COUNT = :conditionCount")
        bind_params["conditionCount"] = condition_count
    normalized_confidence_scope = str(confidence_scope or "").strip().upper()
    if normalized_confidence_scope == "NON_PERFECT":
        where_clauses.append(
            "RULE_CONFIDENCE IS NOT NULL "
            "AND ((RULE_CONFIDENCE <= 1 AND RULE_CONFIDENCE < 0.999999) "
            " OR (RULE_CONFIDENCE > 1 AND RULE_CONFIDENCE < 99.9999))"
        )
    else:
        normalized_confidence_scope = "ALL"
    normalized_result_scope = str(result_scope or "").strip().upper()
    if normalized_result_scope not in {"CANDIDATE", "HIT", "MISS"}:
        normalized_result_scope = "HIT"
    try:
        detection_min_confidence = max(0.0, min(1.0, float(detection_min_confidence)))
    except (TypeError, ValueError):
        detection_min_confidence = 0.8
    try:
        detection_min_lift = max(0.0, float(detection_min_lift))
    except (TypeError, ValueError):
        detection_min_lift = 1.0
    try:
        detection_max_rules = max(1, min(10000, int(detection_max_rules)))
    except (TypeError, ValueError):
        detection_max_rules = 500
    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    rule_where_clauses = list(where_clauses)
    rule_bind_params = dict(bind_params)
    normalized_rule_filter = str(rule_id_filter or "").strip()
    if normalized_rule_filter:
        rule_where_clauses.append("UPPER(RULE_ID) LIKE '%' || UPPER(:ruleIdFilter) || '%'")
        rule_bind_params["ruleIdFilter"] = normalized_rule_filter
    rule_where_sql = f" WHERE {' AND '.join(rule_where_clauses)}" if rule_where_clauses else ""
    rule_page = _normalize_page(rule_page)
    rule_page_size = _normalize_page_size(rule_page_size, 20, 1000)
    rule_offset, rule_end_row = _page_window(rule_page, rule_page_size)
    rule_bind_params.update({"ruleOffset": rule_offset, "ruleEndRow": rule_end_row})

    def fetch_one(sql: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cursor.execute(sql, params or bind_params)
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        return {column: _serialize_db_value(value) for column, value in zip(columns, row)} if row else {}

    def fetch_many(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        cursor.execute(sql, params or bind_params)
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
    candidate_params = {
        "owner": owner_name,
        "targetOwner": target_owner,
        "targetTable": target_table,
        "modelName": rule_model_name,
        "runSourceType": run_source_type or None,
        "runId": run_id,
    }
    candidate_overview = fetch_one(
        SqlLoader.get_sql("MCOMMON_ANLY_WORK_ASSOC_RULE_OVERVIEW"),
        candidate_params,
    ) if rule_model_name else {}
    candidate_condition_dist = fetch_many(
        SqlLoader.get_sql("MCOMMON_ANLY_WORK_ASSOC_RULE_CONDITION_DIST"),
        candidate_params,
    ) if rule_model_name else []

    candidate_filter_clauses = [
        'S."OWNER" = :owner',
        'S."TARGET_OWNER" = :targetOwner',
        'S."TARGET_TABLE" = :targetTable',
        'S."MODEL_NAME" = :modelName',
        'S."RESULT_HAS_VALUE_YN" = \'Y\'',
        'S."RESULT_COLUMN" IS NOT NULL',
        'S."RESULT_VALUE" IS NOT NULL',
        'S."CONDITION_TEXT" IS NOT NULL',
    ]
    candidate_filter_params = {
        "owner": owner_name,
        "targetOwner": target_owner,
        "targetTable": target_table,
        "modelName": rule_model_name,
        "detectMinConfidence": detection_min_confidence,
        "detectMinLift": detection_min_lift,
        "detectMaxRules": detection_max_rules,
    }
    if run_source_type and run_id is not None:
        candidate_filter_clauses.append('S."RUN_SOURCE_TYPE" = :runSourceType')
        candidate_filter_clauses.append('S."RUN_ID" = :runId')
        candidate_filter_params["runSourceType"] = run_source_type
        candidate_filter_params["runId"] = run_id
    candidate_display_clauses = ["1 = 1"]
    if condition_count is not None:
        candidate_display_clauses.append('C."CONDITION_COUNT" = :candidateConditionCount')
        candidate_filter_params["candidateConditionCount"] = condition_count
    if normalized_confidence_scope == "NON_PERFECT":
        candidate_display_clauses.append(
            'C."RULE_CONFIDENCE" IS NOT NULL '
            'AND ((C."RULE_CONFIDENCE" <= 1 AND C."RULE_CONFIDENCE" < 0.999999) '
            ' OR (C."RULE_CONFIDENCE" > 1 AND C."RULE_CONFIDENCE" < 99.9999))'
        )
    if normalized_rule_filter:
        candidate_display_clauses.append('UPPER(C."RULE_ID") LIKE \'%\' || UPPER(:candidateRuleIdFilter) || \'%\'')
        candidate_filter_params["candidateRuleIdFilter"] = normalized_rule_filter
    candidate_filter_sql = " AND ".join(candidate_filter_clauses)
    candidate_display_sql = " AND ".join(candidate_display_clauses)
    detection_overview = fetch_one(
        "WITH BASE_CANDIDATES AS ("
        "        SELECT S.* "
        "          FROM \"INIT$_TB_ASSOC_RULE_SUMMARY\" S "
        f"         WHERE {candidate_filter_sql}"
        "     ), DISPLAY_CANDIDATES AS ("
        "        SELECT C.* "
        "          FROM BASE_CANDIDATES C "
        f"         WHERE {candidate_display_sql}"
        "     ), DETECTABLE_ALL AS ("
        "        SELECT C.*, "
        "               ROW_NUMBER() OVER (ORDER BY C.\"RULE_CONFIDENCE\" DESC NULLS LAST, C.\"RULE_LIFT\" DESC NULLS LAST, C.\"SUPPORT_COUNT\" DESC NULLS LAST, C.\"RULE_ID\") AS DETECTION_RN "
        "          FROM BASE_CANDIDATES C "
        "         WHERE NVL(C.\"RULE_CONFIDENCE\", 0) >= :detectMinConfidence "
        "           AND NVL(C.\"RULE_LIFT\", 0) >= :detectMinLift"
        "     ) "
        "SELECT COUNT(*) AS CANDIDATE_RULE_COUNT, "
        "       SUM(CASE WHEN NVL(C.\"RULE_CONFIDENCE\", 0) < :detectMinConfidence THEN 1 ELSE 0 END) AS CONFIDENCE_CUTOFF_COUNT, "
        "       SUM(CASE WHEN NVL(C.\"RULE_LIFT\", 0) < :detectMinLift THEN 1 ELSE 0 END) AS LIFT_CUTOFF_COUNT, "
        "       SUM(CASE WHEN D.DETECTION_RN <= :detectMaxRules THEN 1 ELSE 0 END) AS DETECTION_ELIGIBLE_RULE_COUNT, "
        "       SUM(CASE WHEN D.DETECTION_RN > :detectMaxRules THEN 1 ELSE 0 END) AS MAX_RULES_CUTOFF_COUNT, "
        "       MIN(D.DETECTION_RN) AS MIN_DETECTION_RN, "
        "       MAX(D.DETECTION_RN) AS MAX_DETECTION_RN "
        "  FROM DISPLAY_CANDIDATES C "
        "  LEFT JOIN DETECTABLE_ALL D "
        "    ON D.\"RULE_ID\" = C.\"RULE_ID\"",
        candidate_filter_params,
    ) if rule_model_name else {}

    candidate_rule_clauses = [
        'S."OWNER" = :candidateOwner',
        'S."TARGET_OWNER" = :candidateTargetOwner',
        'S."TARGET_TABLE" = :candidateTargetTable',
        'S."MODEL_NAME" = :candidateModelName',
        'S."RESULT_HAS_VALUE_YN" = \'Y\'',
        'S."RESULT_COLUMN" IS NOT NULL',
        'S."RESULT_VALUE" IS NOT NULL',
        'S."CONDITION_TEXT" IS NOT NULL',
    ]
    candidate_rule_params: dict[str, Any] = {
        "candidateOwner": owner_name,
        "candidateTargetOwner": target_owner,
        "candidateTargetTable": target_table,
        "candidateModelName": rule_model_name,
        "detectMinConfidence": detection_min_confidence,
        "detectMinLift": detection_min_lift,
        "detectMaxRules": detection_max_rules,
        "ruleOffset": rule_offset,
        "ruleEndRow": rule_end_row,
    }
    if run_source_type and run_id is not None:
        candidate_rule_clauses.append('S."RUN_SOURCE_TYPE" = :candidateRunSourceType')
        candidate_rule_clauses.append('S."RUN_ID" = :candidateRunId')
        candidate_rule_params["candidateRunSourceType"] = run_source_type
        candidate_rule_params["candidateRunId"] = run_id
    if condition_count is not None:
        candidate_rule_clauses.append('S."CONDITION_COUNT" = :candidateConditionCount')
        candidate_rule_params["candidateConditionCount"] = condition_count
    if normalized_confidence_scope == "NON_PERFECT":
        candidate_rule_clauses.append(
            'S."RULE_CONFIDENCE" IS NOT NULL '
            'AND ((S."RULE_CONFIDENCE" <= 1 AND S."RULE_CONFIDENCE" < 0.999999) '
            ' OR (S."RULE_CONFIDENCE" > 1 AND S."RULE_CONFIDENCE" < 99.9999))'
        )
    if normalized_rule_filter:
        candidate_rule_clauses.append('UPPER(S."RULE_ID") LIKE \'%\' || UPPER(:candidateRuleIdFilter) || \'%\'')
        candidate_rule_params["candidateRuleIdFilter"] = normalized_rule_filter
    candidate_rule_where_sql = " AND ".join(candidate_rule_clauses)
    result_scope_predicate = {
        "CANDIDATE": "1 = 1",
        "HIT": "NVL(Q.VIOLATION_COUNT, 0) > 0",
        "MISS": "NVL(Q.VIOLATION_COUNT, 0) = 0 AND Q.DETECTION_SCANNED_YN = 'Y'",
    }[normalized_result_scope]
    top_rules = fetch_many(
        "SELECT * FROM ("
        "        SELECT Q.*, "
        "               ROW_NUMBER() OVER (ORDER BY Q.RULE_CONFIDENCE DESC NULLS LAST, Q.RULE_LIFT DESC NULLS LAST, Q.RULE_SUPPORT DESC NULLS LAST, Q.RULE_ID) AS RN__, "
        "               COUNT(*) OVER () AS TOTAL_COUNT "
        "          FROM ("
        '                SELECT S."RULE_ID" AS RULE_ID, '
        '                       S."CONDITION_COUNT" AS CONDITION_COUNT, '
        '                       DBMS_LOB.SUBSTR(S."CONDITION_TEXT", 4000, 1) AS CONDITION_TEXT, '
        '                       S."RESULT_COLUMN" AS RESULT_COLUMN, '
        '                       DBMS_LOB.SUBSTR(TO_CLOB(S."RESULT_VALUE"), 4000, 1) AS EXPECTED_VALUE, '
        '                       NVL(V.VIOLATION_COUNT, 0) AS VIOLATION_COUNT, '
        '                       NVL(V.VIOLATED_ROW_COUNT, 0) AS VIOLATED_ROW_COUNT, '
        '                       V.AVG_VIOLATION_SCORE AS AVG_VIOLATION_SCORE, '
        '                       D.DETECTION_RN AS DETECTION_RN, '
        "                       CASE WHEN D.DETECTION_RN <= :detectMaxRules THEN 'Y' "
        "                            WHEN D.DETECTION_RN IS NOT NULL THEN 'N' "
        "                            ELSE NULL "
        "                       END AS DETECTION_SCANNED_YN, "
        '                       S."RULE_SUPPORT" AS RULE_SUPPORT, '
        '                       S."RULE_CONFIDENCE" AS RULE_CONFIDENCE, '
        '                       S."RULE_LIFT" AS RULE_LIFT '
        '                  FROM "INIT$_TB_ASSOC_RULE_SUMMARY" S '
        "                  LEFT JOIN ("
        '                        SELECT A."RULE_ID", '
        '                               ROW_NUMBER() OVER (ORDER BY A."RULE_CONFIDENCE" DESC NULLS LAST, A."RULE_LIFT" DESC NULLS LAST, A."SUPPORT_COUNT" DESC NULLS LAST, A."RULE_ID") AS DETECTION_RN '
        '                          FROM "INIT$_TB_ASSOC_RULE_SUMMARY" A '
        '                         WHERE A."OWNER" = :candidateOwner '
        '                           AND A."TARGET_OWNER" = :candidateTargetOwner '
        '                           AND A."TARGET_TABLE" = :candidateTargetTable '
        '                           AND A."MODEL_NAME" = :candidateModelName '
        '                           AND A."RESULT_HAS_VALUE_YN" = \'Y\' '
        '                           AND A."RESULT_COLUMN" IS NOT NULL '
        '                           AND A."RESULT_VALUE" IS NOT NULL '
        '                           AND A."CONDITION_TEXT" IS NOT NULL '
        '                           AND NVL(A."RULE_CONFIDENCE", 0) >= :detectMinConfidence '
        '                           AND NVL(A."RULE_LIFT", 0) >= :detectMinLift '
        + ("                           AND A.\"RUN_SOURCE_TYPE\" = :candidateRunSourceType "
           "                           AND A.\"RUN_ID\" = :candidateRunId " if run_source_type and run_id is not None else "") +
        "                       ) D"
        '                    ON D."RULE_ID" = S."RULE_ID" '
        "                  LEFT JOIN ("
        "                        SELECT RULE_ID, "
        "                               COUNT(*) AS VIOLATION_COUNT, "
        "                               COUNT(DISTINCT NVL(CASE_ID, CASE_ROWID)) AS VIOLATED_ROW_COUNT, "
        "                               AVG(VIOLATION_SCORE) AS AVG_VIOLATION_SCORE "
        f"                          FROM {result_object}{rule_where_sql} "
        "                         GROUP BY RULE_ID"
        "                       ) V"
        '                    ON V.RULE_ID = S."RULE_ID" '
        f"                 WHERE {candidate_rule_where_sql} "
        "               ) Q"
        f"         WHERE {result_scope_predicate}"
        "       ) WHERE RN__ > :ruleOffset "
        "           AND RN__ <= :ruleEndRow "
        " ORDER BY RN__",
        {**rule_bind_params, **candidate_rule_params},
    )
    top_rule_total = int(top_rules[0].get("TOTAL_COUNT") or 0) if top_rules else 0
    for row in top_rules:
        row.pop("RN__", None)
        row.pop("TOTAL_COUNT", None)
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
        "topRuleTotal": top_rule_total,
        "topRulePage": rule_page,
        "topRulePageSize": rule_page_size,
        "ruleIdFilter": normalized_rule_filter,
        "conditionCountFilter": condition_count,
        "confidenceScope": normalized_confidence_scope,
        "resultScope": normalized_result_scope,
        "detectionOverview": detection_overview,
        "detectionCriteria": {
            "minConfidence": detection_min_confidence,
            "minLift": detection_min_lift,
            "maxRules": detection_max_rules,
        },
        "candidateOverview": candidate_overview,
        "candidateConditionDist": candidate_condition_dist,
        "topColumns": top_columns,
        "columnComments": _fetch_column_comment_map(cursor, target_owner, target_table),
        "runSourceType": run_source_type,
        "runId": run_id,
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


def list_flow_runs(
    request: Request,
    page: int = 1,
    pageSize: int = 20,
    status: str = "ALL",
    keyword: str | None = None,
    projectId: int | None = None,
    scenarioId: int | None = None,
    flow_menu_code: str = "M04001",
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
        cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_FLOW_RUN_LIST"), {
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
            "flowMenuCode": flow_menu_code,
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


def get_flow_run_position(
    flow_run_id: int,
    request: Request,
    pageSize: int = 20,
    status: str = "ALL",
    keyword: str | None = None,
    projectId: int | None = None,
    scenarioId: int | None = None,
    flow_menu_code: str = "M04001",
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
        cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_FLOW_RUN_POSITION"), {
            "flowRunId": flow_run_id,
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
            "flowMenuCode": flow_menu_code,
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


def delete_flow_run(flow_run_id: int, request: Request, flow_menu_code: str = "M04001", force: bool = False):
    try:
        normalized_flow_run_id = int(flow_run_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid run id.")
    if normalized_flow_run_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid run id.")

    user_id = get_request_user_id(request)
    is_admin = get_request_role_code(request) == "ADMIN"
    include_all_users = is_admin
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        params = {
            "flowRunId": normalized_flow_run_id,
            "flowMenuCode": flow_menu_code,
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
        }
        cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_FLOW_RUN_DELETE_TARGET"), params)
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Run history was not found or cannot be deleted by this user.")
        status = str(row[1] or "").strip().upper()
        force_delete_running = bool(force) and is_admin
        if status in {"RUNNING", "STARTED", "QUEUED", "PENDING"} and not force_delete_running:
            raise HTTPException(status_code=409, detail="Running or pending run history cannot be deleted.")

        cursor.execute(SqlLoader.get_sql("MCOMMON_ANLY_WORK_FLOW_RUN_DELETE_BLOCK"), {
            "flowRunId": normalized_flow_run_id,
        })
        conn.commit()
        return {
            "status": "success",
            "flowRunId": normalized_flow_run_id,
            "message": f"Run #{normalized_flow_run_id} history was deleted.",
            "force": "Y" if force_delete_running else "N",
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as error:
        if conn:
            conn.rollback()
        logger.warning("MCOMMON_ANLY_WORK run delete failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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
        logger.warning("MCOMMON_ANLY_WORK SQL query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def get_result_table(
    request: Request,
    owner: str,
    objectName: str,
    menuCode: str | None = None,
    targetOwner: str | None = None,
    targetTable: str | None = None,
    ruleModelName: str | None = None,
    violationRuleId: str | None = None,
    violationConditionCount: int | None = None,
    violationConfidenceScope: str | None = "NON_PERFECT",
    violationResultScope: str | None = "HIT",
    violationMinConfidence: float = 0.8,
    violationMinLift: float = 1.0,
    violationMaxRules: int = 500,
    violationRulePage: int = 1,
    violationRulePageSize: int = 20,
    predictedTypeCase: str | None = None,
    runSourceType: str | None = None,
    runId: int | None = None,
    flowRunId: int | None = None,
    page: int = 1,
    pageSize: int = 50,
):
    owner_name = _validate_identifier(owner, "owner")
    object_name = _validate_identifier(objectName, "object name")
    target_owner = _validate_identifier(targetOwner, "target owner") if targetOwner else ""
    target_table = _validate_identifier(targetTable, "target table") if targetTable else ""
    rule_model_name = _validate_identifier(ruleModelName, "rule model name") if ruleModelName else ""
    normalized_violation_rule_id = str(violationRuleId or "").strip()[:160]
    normalized_violation_confidence_scope = str(violationConfidenceScope or "").strip().upper()
    if normalized_violation_confidence_scope != "NON_PERFECT":
        normalized_violation_confidence_scope = "ALL"
    normalized_violation_result_scope = str(violationResultScope or "").strip().upper()
    if normalized_violation_result_scope not in {"CANDIDATE", "HIT", "MISS"}:
        normalized_violation_result_scope = "HIT"
    normalized_predicted_type_case = _normalize_predicted_type_case(predictedTypeCase)
    run_source_type, normalized_run_id = _normalize_run_context(runSourceType, runId, flowRunId)
    result_layout = _get_table_result_layout(object_name)
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 50, 500)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        if _is_predicted_type_result_table(object_name):
            base_sql, bind_params = _build_predicted_type_result_sql(
                owner_name,
                target_owner,
                target_table,
                run_source_type,
                normalized_run_id,
                normalized_predicted_type_case,
                include_order=True,
            )
            result = _fetch_dynamic_page(cursor, base_sql, page, page_size, bind_params)
            predicted_type_summary = _fetch_predicted_type_summary(
                cursor,
                owner_name,
                object_name,
                target_owner,
                target_table,
                run_source_type,
                normalized_run_id,
            )
            column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
            return {
                "status": "success",
                "owner": owner_name,
                "objectName": object_name,
                "resultLayout": result_layout,
                "targetOwner": target_owner,
                "targetTable": target_table,
                "ruleModelName": rule_model_name,
                "runSourceType": run_source_type,
                "runId": normalized_run_id,
                "filteredByTarget": bool(target_owner or target_table or bind_params),
                "correlationSummary": None,
                "predictedTypeSummary": predicted_type_summary,
                "violationSummary": None,
                "lassoSummary": None,
                "symbolicRuleSummary": None,
                "symbolicViolationSummary": None,
                "predictedTypeCase": normalized_predicted_type_case,
                "columnComments": column_comments,
                **result,
            }
        columns = _get_table_columns(cursor, owner_name, object_name)
        where_clauses = []
        bind_params: dict[str, Any] = {}
        order_sql = ""
        if object_name in {"INIT$_TB_CAT_CORR_PAIR", "INIT$_TB_NUM_CORR_PAIR"} and str(menuCode or "").upper() == "M03002":
            where_clauses.append("PASS_YN = 'Y'")
            if object_name == "INIT$_TB_CAT_CORR_PAIR":
                order_sql = " ORDER BY CRAMERS_V DESC, P_VALUE ASC"
        if object_name == "INIT$_TB_NUM_CORR_PAIR":
            order_sql = " ORDER BY PASS_YN DESC, ABS_PEARSON_R DESC NULLS LAST, P_VALUE ASC NULLS LAST, COL_A, COL_B"
        if object_name == "INIT$_TB_LASSO_FEATURE":
            order_sql = " ORDER BY TARGET_COLUMN, SELECTED_YN DESC, RANK_NO NULLS LAST, ABS_COEFFICIENT DESC NULLS LAST, FEATURE_NAME"
        if object_name == "INIT$_TB_SYMBOLIC_RULE":
            order_sql = " ORDER BY TARGET_COLUMN, SELECTED_YN DESC, RANK_NO NULLS LAST, SCORE DESC NULLS LAST, RULE_ID"
        if _is_predicted_type_result_table(object_name) and "COLUMN_ID" in columns:
            order_sql = " ORDER BY COLUMN_ID NULLS LAST, COLUMN_NAME"
        if object_name == "INIT$_TB_RULE_VIOLATION_RESULT":
            order_sql = " ORDER BY VIOLATION_SCORE DESC NULLS LAST, RULE_CONFIDENCE DESC NULLS LAST, VIOLATION_ID"
        if object_name == "INIT$_TB_SYMBOLIC_RULE_VIOLATION":
            order_sql = " ORDER BY VIOLATION_SCORE DESC NULLS LAST, ERROR_PCT DESC NULLS LAST, ABS_ERROR DESC NULLS LAST, VIOLATION_ID"
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
        if object_name == "INIT$_TB_RULE_VIOLATION_RESULT" and violationConditionCount is not None and "CONDITION_COUNT" in columns:
            where_clauses.append("CONDITION_COUNT = :violationConditionCount")
            bind_params["violationConditionCount"] = violationConditionCount
        if object_name == "INIT$_TB_RULE_VIOLATION_RESULT" and normalized_violation_confidence_scope == "NON_PERFECT" and "RULE_CONFIDENCE" in columns:
            where_clauses.append(
                "RULE_CONFIDENCE IS NOT NULL "
                "AND ((RULE_CONFIDENCE <= 1 AND RULE_CONFIDENCE < 0.999999) "
                " OR (RULE_CONFIDENCE > 1 AND RULE_CONFIDENCE < 99.9999))"
            )
        if object_name == "INIT$_TB_RULE_VIOLATION_RESULT" and normalized_violation_rule_id and "RULE_ID" in columns:
            where_clauses.append("UPPER(RULE_ID) LIKE '%' || UPPER(:violationRuleId) || '%'")
            bind_params["violationRuleId"] = normalized_violation_rule_id
        if object_name == "INIT$_TB_SYMBOLIC_RULE_VIOLATION" and normalized_violation_rule_id and "RULE_ID" in columns:
            where_clauses.append("UPPER(RULE_ID) LIKE '%' || UPPER(:violationRuleId) || '%'")
            bind_params["violationRuleId"] = normalized_violation_rule_id
        if (
            _is_predicted_type_result_table(object_name)
            and normalized_predicted_type_case != "ALL"
            and {"FINAL_PREDICTED_TYPE", "MODL_PREDICTED_TYPE", "BASE_PREDICTED_TYPE"}.issubset(columns)
        ):
            where_clauses.append(f"{_predicted_type_case_expr()} = :predictedTypeCase")
            bind_params["predictedTypeCase"] = normalized_predicted_type_case
        if run_source_type and normalized_run_id is not None and {"RUN_SOURCE_TYPE", "RUN_ID"}.issubset(columns):
            where_clauses.append("RUN_SOURCE_TYPE = :runSourceType")
            where_clauses.append("RUN_ID = :runId")
            bind_params["runSourceType"] = run_source_type
            bind_params["runId"] = normalized_run_id
        elif run_source_type and normalized_run_id is not None and {"SOURCE_RUN_SOURCE_TYPE", "SOURCE_RUN_ID"}.issubset(columns):
            where_clauses.append("SOURCE_RUN_SOURCE_TYPE = :runSourceType")
            where_clauses.append("SOURCE_RUN_ID = :runId")
            bind_params["runSourceType"] = run_source_type
            bind_params["runId"] = normalized_run_id
        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        base_sql = f"SELECT * FROM {_quote_identifier(owner_name)}.{_quote_identifier(object_name)}{where_sql}{order_sql}"
        result = _fetch_dynamic_page(cursor, base_sql, page, page_size, bind_params)
        cat_corr_summary = None
        predicted_type_summary = None
        violation_summary = None
        lasso_summary = None
        symbolic_rule_summary = None
        symbolic_violation_summary = None
        if result_layout.get("summary") == "correlationSummary":
            cat_corr_summary = _fetch_cat_corr_summary(cursor, owner_name, object_name, target_owner, target_table, run_source_type, normalized_run_id)
        elif result_layout.get("summary") == "predictedTypeSummary":
            predicted_type_summary = _fetch_predicted_type_summary(cursor, owner_name, object_name, target_owner, target_table, run_source_type, normalized_run_id)
        elif result_layout.get("summary") == "violationSummary":
            violation_summary = _fetch_rule_violation_summary(
                cursor,
                owner_name,
                object_name,
                target_owner,
                target_table,
                rule_model_name,
                normalized_violation_rule_id,
                violationConditionCount,
                normalized_violation_confidence_scope,
                normalized_violation_result_scope,
                violationMinConfidence,
                violationMinLift,
                violationMaxRules,
                violationRulePage,
                violationRulePageSize,
                run_source_type,
                normalized_run_id,
            )
        elif result_layout.get("summary") == "lassoSummary":
            lasso_summary = _fetch_lasso_summary(cursor, owner_name, object_name, target_owner, target_table, run_source_type, normalized_run_id)
        elif result_layout.get("summary") == "symbolicRuleSummary":
            symbolic_rule_summary = _fetch_symbolic_rule_summary(cursor, owner_name, object_name, target_owner, target_table, run_source_type, normalized_run_id)
        elif result_layout.get("summary") == "symbolicViolationSummary":
            symbolic_violation_summary = _fetch_symbolic_violation_summary(
                cursor,
                owner_name,
                object_name,
                target_owner,
                target_table,
                run_source_type,
                normalized_run_id,
                normalized_violation_rule_id,
            )
        column_comments = _fetch_column_comment_map(cursor, target_owner, target_table)
        return {
            "status": "success",
            "owner": owner_name,
            "objectName": object_name,
            "resultLayout": result_layout,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "ruleModelName": rule_model_name,
            "runSourceType": run_source_type,
            "runId": normalized_run_id,
            "filteredByTarget": bool(bind_params),
            "correlationSummary": cat_corr_summary,
            "predictedTypeSummary": predicted_type_summary,
            "violationSummary": violation_summary,
            "lassoSummary": lasso_summary,
            "symbolicRuleSummary": symbolic_rule_summary,
            "symbolicViolationSummary": symbolic_violation_summary,
            "predictedTypeCase": normalized_predicted_type_case,
            "columnComments": column_comments,
            **result,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("MCOMMON_ANLY_WORK result table query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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
        logger.warning("MCOMMON_ANLY_WORK model view query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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
            metadata_result = execute_query(conn, "MCOMMON_ANLY_WORK_MODEL_METADATA", {
                "owner": owner_name,
                "modelName": model_name,
            })
            if metadata_result.get("status") == "success" and metadata_result.get("data"):
                model_metadata = {
                    key: _serialize_db_value(value)
                    for key, value in metadata_result["data"][0].items()
                }
        except Exception as metadata_error:
            logger.info("MCOMMON_ANLY_WORK model metadata query skipped: %s", metadata_error)

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
        model_layout = _get_model_result_layout(model_name, model_metadata)
        return {
            "status": "success",
            "owner": owner_name,
            "modelName": model_name,
            "resultLayout": model_layout,
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
        logger.warning("MCOMMON_ANLY_WORK model detail summary query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def get_model_rule_summary(
    request: Request,
    owner: str,
    modelName: str,
    targetOwner: str | None = None,
    targetTable: str | None = None,
    conditionCount: int | None = None,
    resultColumn: str | None = None,
    conditionColumn: str | None = None,
    resultHasValueYn: str | None = None,
    confidenceScope: str | None = None,
    page: int = 1,
    pageSize: int = 20,
    resultColumnPage: int = 1,
    resultColumnPageSize: int = 12,
    runSourceType: str | None = None,
    runId: int | None = None,
    flowRunId: int | None = None,
):
    owner_name = _validate_identifier(owner, "owner")
    model_name = _validate_identifier(modelName, "model name")
    target_owner = _validate_identifier(targetOwner, "target owner") if targetOwner else ""
    target_table = _validate_identifier(targetTable, "target table") if targetTable else ""
    page = _normalize_page(page)
    page_size = _normalize_page_size(pageSize, 20, 1000)
    offset, end_row = _page_window(page, page_size)
    result_column_page = _normalize_page(resultColumnPage)
    result_column_page_size = _normalize_page_size(resultColumnPageSize, 12, 50)
    result_column_offset, result_column_end_row = _page_window(result_column_page, result_column_page_size)
    normalized_result_has_value = str(resultHasValueYn or "").strip().upper()
    if normalized_result_has_value not in {"Y", "N"}:
        normalized_result_has_value = None
    normalized_confidence_scope = str(confidenceScope or "").strip().upper()
    if normalized_confidence_scope != "NON_PERFECT":
        normalized_confidence_scope = "ALL"
    normalized_result_column = str(resultColumn or "").strip().upper() or None
    if normalized_result_column and normalized_result_column != "__NULL__":
        normalized_result_column = _validate_identifier(normalized_result_column, "result column")
    normalized_condition_column = str(conditionColumn or "").strip().upper() or None
    if normalized_condition_column and normalized_condition_column != "__NULL__":
        normalized_condition_column = _validate_identifier(normalized_condition_column, "condition column")
    run_source_type, normalized_run_id = _normalize_run_context(runSourceType, runId, flowRunId)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor() if target_owner and target_table else None
        column_comments = _fetch_column_comment_map(cursor, target_owner, target_table) if cursor else {}
        overview = execute_query(conn, "MCOMMON_ANLY_WORK_ASSOC_RULE_OVERVIEW", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
            "runSourceType": run_source_type or None,
            "runId": normalized_run_id,
        })
        condition_dist = execute_query(conn, "MCOMMON_ANLY_WORK_ASSOC_RULE_CONDITION_DIST", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
            "runSourceType": run_source_type or None,
            "runId": normalized_run_id,
        })
        result_top = execute_query(conn, "MCOMMON_ANLY_WORK_ASSOC_RULE_RESULT_TOP", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
            "runSourceType": run_source_type or None,
            "runId": normalized_run_id,
            "resultOffset": result_column_offset,
            "resultEndRow": result_column_end_row,
        })
        detail = execute_query(conn, "MCOMMON_ANLY_WORK_ASSOC_RULE_DETAIL_LIST", {
            "owner": owner_name,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "modelName": model_name,
            "runSourceType": run_source_type or None,
            "runId": normalized_run_id,
            "conditionCount": conditionCount,
            "resultColumn": normalized_result_column,
            "conditionColumn": normalized_condition_column,
            "resultHasValueYn": normalized_result_has_value,
            "confidenceScope": normalized_confidence_scope,
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
            "runSourceType": run_source_type,
            "runId": normalized_run_id,
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
                "conditionColumn": normalized_condition_column,
                "resultHasValueYn": normalized_result_has_value,
                "confidenceScope": normalized_confidence_scope,
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("MCOMMON_ANLY_WORK model rule summary query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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
        logger.warning("MCOMMON_ANLY_WORK model readable summary query failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
