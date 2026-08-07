"""Shared editing-rule, cleansing, validation, and final-apply service."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterable

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.database_helper import SqlLoader
from backend.paging import PageWindow, create_page_window, normalize_page_number, normalize_page_size
from backend.target_database import get_target_db_connection


logger = logging.getLogger(__name__)

IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")
TRACKING_COLUMN = "INIT$_SOURCE_ROWID"
SOURCE_TABLE_PREFIX = "INITUP$"
EDIT_TABLE_PREFIX = "INITDN$"
RULE_TYPES = {"ASSOCIATION", "SYMBOLIC", "USER"}
USER_RULE_TYPES = {"ASSOCIATION", "SYMBOLIC"}
DECISION_STATUSES = {"PENDING", "SELECTED", "REJECTED"}
RULE_STATUSES = {"ACTIVE", "INACTIVE"}
SESSION_STATUSES = {"DRAFT", "EDITING", "VALIDATED", "APPLY_READY", "APPLIED", "CANCELLED"}
ACTIVE_EXECUTION_STATUSES = {"DRAFT", "EDITING", "VALIDATED", "APPLY_READY"}
RULE_TOKEN_PATTERN = re.compile(
    r"""
    (?P<SPACE>\s+)
  | (?P<STRING>'(?:''|[^'])*')
  | (?P<NUMBER>(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)
  | (?P<OP><=|>=|<>|!=|=|<|>|\+|-|\*|/)
  | (?P<LPAREN>\()
  | (?P<RPAREN>\))
  | (?P<COMMA>,)
  | (?P<IDENT>[A-Za-z][A-Za-z0-9_$#]*)
  | (?P<MISMATCH>.)
    """,
    re.VERBOSE,
)
SQL_BIND_PATTERN = re.compile(r"(?<!:):([A-Za-z][A-Za-z0-9_]*)")
ASSOCIATION_KEYWORDS = {"AND", "OR", "NOT", "IS", "NULL", "IN", "LIKE", "BETWEEN"}
ASSOCIATION_FUNCTIONS = {"ABS", "LENGTH", "LOWER", "NVL", "ROUND", "TRIM", "TRUNC", "UPPER"}
SYMBOLIC_FUNCTIONS = {"ABS", "EXP", "LN", "NVL", "POWER", "ROUND", "SQRT", "TRUNC"}


class RuleDecisionRequest(BaseModel):
    editRuleId: int | None = None
    projectId: int | None = None
    scenarioId: int | None = None
    sourceRuleType: str
    runSourceType: str | None = None
    runId: int | None = None
    sourceOwner: str | None = None
    sourceObjectName: str | None = None
    sourceRuleId: str | None = None
    targetOwner: str
    targetTable: str
    targetColumn: str
    caseIdColumn: str | None = None
    ruleName: str | None = None
    ruleDescription: str | None = None
    ruleExpression: str | None = None
    expectedValue: str | None = None
    ruleSupport: float | None = None
    ruleConfidence: float | None = None
    ruleLift: float | None = None
    ruleTolerancePct: float | None = None
    userRuleYn: bool = False
    decisionStatus: str = "PENDING"
    ruleStatus: str = "ACTIVE"
    decisionNote: str | None = None
    model_config = ConfigDict(extra="forbid")


class RuleBulkExcludeRequest(BaseModel):
    projectId: int | None = None
    editRuleIds: list[int] = Field(default_factory=list, min_length=1, max_length=500)
    model_config = ConfigDict(extra="forbid")


class UserRuleValidationRequest(BaseModel):
    projectId: int | None = None
    scenarioId: int | None = None
    sourceRuleType: str
    targetOwner: str
    targetTable: str
    targetColumn: str
    caseIdColumn: str | None = None
    ruleExpression: str
    expectedValue: str | None = None
    ruleTolerancePct: float | None = None
    model_config = ConfigDict(extra="forbid")


class EditSessionCreateRequest(BaseModel):
    projectId: int | None = None
    scenarioId: int | None = None
    sessionName: str
    editRuleIds: list[int] = Field(default_factory=list)
    baselineFlowRunId: int | None = None
    model_config = ConfigDict(extra="forbid")


class EditingTableCreateRequest(BaseModel):
    projectId: int | None = None
    scenarioId: int | None = None
    targetOwner: str
    targetTable: str
    editRuleIds: list[int] = Field(default_factory=list)
    model_config = ConfigDict(extra="forbid")


class EditChangeRequest(BaseModel):
    editRuleId: int | None = None
    sourceViolationType: str
    sourceViolationId: int
    sourceRowid: str
    caseId: str | None = None
    columnName: str
    newValue: Any = None
    expectedValue: Any = None
    model_config = ConfigDict(extra="forbid")


class EditChangeBulkRequest(BaseModel):
    changes: list[EditChangeRequest] = Field(min_length=1, max_length=500)
    model_config = ConfigDict(extra="forbid")


class EditDmlRequest(BaseModel):
    editDmlId: int | None = None
    editSessionId: int
    dmlName: str
    dmlSql: str
    model_config = ConfigDict(extra="forbid")


class EditDmlValidateRequest(BaseModel):
    editSessionId: int
    dmlSql: str
    model_config = ConfigDict(extra="forbid")


class ReanalysisLinkRequest(BaseModel):
    flowRunId: int
    reanalysisStatus: str = "QUEUED"
    model_config = ConfigDict(extra="forbid")


def _read_lob(value: Any) -> Any:
    if hasattr(value, "read"):
        return value.read()
    return value


def _row_to_dict(columns: Iterable[str], row: Iterable[Any]) -> dict[str, Any]:
    return {name: _read_lob(value) for name, value in zip(columns, row)}


def _fetch_all(cursor, sql_id: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    cursor.execute(SqlLoader.get_sql(sql_id), params)
    columns = [item[0] for item in cursor.description or []]
    return [_row_to_dict(columns, row) for row in cursor.fetchall()]


def _fetch_limited(
    cursor,
    sql_id: str,
    params: dict[str, Any],
    max_rows: int,
) -> list[dict[str, Any]]:
    cursor.execute(SqlLoader.get_sql(sql_id), params)
    columns = [item[0] for item in cursor.description or []]
    return [_row_to_dict(columns, row) for row in cursor.fetchmany(max(0, int(max_rows)))]


def _fetch_one(cursor, sql_id: str, params: dict[str, Any]) -> dict[str, Any] | None:
    cursor.execute(SqlLoader.get_sql(sql_id), params)
    columns = [item[0] for item in cursor.description or []]
    row = cursor.fetchone()
    return _row_to_dict(columns, row) if row else None


def _attach_column_metadata(
    cursor,
    rows: list[dict[str, Any]],
    *,
    column_keys: tuple[str, ...],
) -> None:
    """Attach column comments once per target table for grid/detail rendering."""
    table_comment_maps: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        owner = str(row.get("TARGET_OWNER") or "").strip().upper()
        table = str(row.get("TARGET_TABLE") or "").strip().upper()
        if not owner or not table:
            continue
        table_key = (owner, table)
        if table_key in table_comment_maps:
            continue
        column_rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_TABLE_COLUMNS",
            {
                "ownerName": owner,
                "tableName": table,
            },
        )
        table_comment_maps[table_key] = {
            str(column.get("COLUMN_NAME") or "").strip().upper(): str(
                column.get("COLUMN_COMMENT") or ""
            )
            for column in column_rows
            if column.get("COLUMN_NAME")
        }

    for row in rows:
        owner = str(row.get("TARGET_OWNER") or "").strip().upper()
        table = str(row.get("TARGET_TABLE") or "").strip().upper()
        comments = dict(table_comment_maps.get((owner, table), {}))
        existing_comments = row.get("COLUMN_COMMENTS")
        if isinstance(existing_comments, dict):
            comments.update(
                {
                    str(column_name).strip().upper(): str(column_comment or "")
                    for column_name, column_comment in existing_comments.items()
                }
            )
        row["COLUMN_COMMENTS"] = comments
        for column_key in column_keys:
            column_name = str(row.get(column_key) or "").strip().upper()
            row[f"{column_key}_COMMENT"] = comments.get(column_name, "")


def _bind_params_for_sql(sql: str, params: dict[str, Any]) -> dict[str, Any]:
    bind_names = list(dict.fromkeys(SQL_BIND_PATTERN.findall(sql)))
    missing_names = [name for name in bind_names if name not in params]
    if missing_names:
        raise RuntimeError(
            f"SQL bind parameter is missing: {', '.join(missing_names)}"
        )
    return {name: params[name] for name in bind_names}


def _edit_rule_tolerance_column_exists(cursor) -> bool:
    row = _fetch_one(cursor, "MCOMMON_EDIT_RULE_TOLERANCE_COLUMN_EXISTS", {})
    return bool(row and int(row.get("COLUMN_COUNT") or 0) > 0)


def _edit_rule_sql(cursor, sql_id: str) -> tuple[str, bool]:
    has_tolerance_column = _edit_rule_tolerance_column_exists(cursor)
    sql = SqlLoader.get_sql(sql_id)
    if has_tolerance_column:
        return sql, True
    if sql_id == "MCOMMON_EDIT_RULE_MASTER_LIST":
        sql = sql.replace(
            "R.RULE_TOLERANCE_PCT",
            "CAST(NULL AS NUMBER) AS RULE_TOLERANCE_PCT",
        )
    elif sql_id == "MCOMMON_EDIT_RULE_INSERT":
        sql = re.sub(r"(?m)^\s*, RULE_TOLERANCE_PCT\s*$\r?\n?", "", sql, count=1)
        sql = re.sub(r"(?m)^\s*, :ruleTolerancePct\s*$\r?\n?", "", sql, count=1)
    elif sql_id in {"MCOMMON_EDIT_RULE_UPDATE", "MCOMMON_EDIT_USER_RULE_UPDATE"}:
        sql = re.sub(r"(?m)^\s*, RULE_TOLERANCE_PCT = :ruleTolerancePct\s*$\r?\n?", "", sql, count=1)
    return sql, False


def _normalize_identifier(value: Any, field_name: str) -> str:
    normalized = str(value or "").strip().upper()
    if not IDENTIFIER_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return normalized


def _normalize_optional_identifier(value: Any, field_name: str) -> str | None:
    if value is None or not str(value).strip():
        return None
    return _normalize_identifier(value, field_name)


def _quote_identifier(value: str) -> str:
    return f'"{_normalize_identifier(value, "identifier")}"'


def _derive_edit_table_name(source_table: Any) -> str:
    normalized_source = _normalize_identifier(source_table, "source table")
    if not normalized_source.startswith(SOURCE_TABLE_PREFIX):
        raise HTTPException(
            status_code=400,
            detail="The editing table name can only be derived from an INITUP$ source table.",
        )
    return EDIT_TABLE_PREFIX + normalized_source[len(SOURCE_TABLE_PREFIX):]


def _normalize_text(value: Any, max_length: int, fallback: str = "") -> str:
    text = str(value or "").strip()
    return (text or fallback)[:max_length]


def _normalize_choice(value: Any, allowed: set[str], field_name: str, fallback: str) -> str:
    normalized = str(value or fallback).strip().upper()
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return normalized


def _render_dynamic_sql(sql_id: str, replacements: dict[str, str]) -> str:
    sql = SqlLoader.get_sql(sql_id)
    for key, value in replacements.items():
        sql = sql.replace(f"{{{key}}}", value)
    if re.search(r"\{[A-Za-z][A-Za-z0-9]*\}", sql):
        raise RuntimeError(f"Unresolved SQL template placeholder in {sql_id}.")
    return sql


def _table_column_map(cursor, target_owner: str, target_table: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("COLUMN_NAME") or "").upper(): row
        for row in _fetch_all(
            cursor,
            "MCOMMON_EDIT_TABLE_COLUMNS",
            {
                "ownerName": target_owner,
                "tableName": target_table,
            },
        )
        if row.get("COLUMN_NAME")
    }


def _compile_user_rule_expression(
    expression: Any,
    *,
    rule_type: str,
    columns: dict[str, dict[str, Any]],
    target_column: str,
) -> tuple[str, list[str]]:
    text = str(expression or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="규칙 표현식 또는 수식을 입력하세요.")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="규칙 표현식은 4,000자 이내로 입력하세요.")

    tokens: list[tuple[str, str]] = []
    for match in RULE_TOKEN_PATTERN.finditer(text):
        kind = match.lastgroup or "MISMATCH"
        value = match.group()
        if kind == "SPACE":
            continue
        if kind == "MISMATCH":
            raise HTTPException(status_code=400, detail=f"규칙 표현식에 허용되지 않는 문자({value})가 있습니다.")
        tokens.append((kind, value))
    if not tokens:
        raise HTTPException(status_code=400, detail="규칙 표현식 또는 수식을 입력하세요.")

    referenced: list[str] = []
    rendered: list[str] = []
    for index, (kind, value) in enumerate(tokens):
        upper_value = value.upper()
        next_kind = tokens[index + 1][0] if index + 1 < len(tokens) else ""
        if kind == "IDENT":
            if upper_value in ASSOCIATION_KEYWORDS:
                if rule_type != "ASSOCIATION":
                    raise HTTPException(status_code=400, detail="수식 규칙에는 비교 조건이나 논리 연산자를 사용할 수 없습니다.")
                rendered.append(upper_value)
                continue
            allowed_functions = ASSOCIATION_FUNCTIONS if rule_type == "ASSOCIATION" else SYMBOLIC_FUNCTIONS
            if next_kind == "LPAREN":
                if upper_value not in allowed_functions:
                    raise HTTPException(status_code=400, detail=f"허용되지 않은 함수입니다: {value}")
                rendered.append(upper_value)
                continue
            if upper_value not in columns:
                raise HTTPException(status_code=400, detail=f"원본 테이블에 없는 컬럼입니다: {value}")
            if rule_type == "SYMBOLIC":
                if upper_value == target_column:
                    raise HTTPException(status_code=400, detail="예측 대상 컬럼은 수식의 입력 피처로 사용할 수 없습니다.")
            if upper_value not in referenced:
                referenced.append(upper_value)
            rendered.append(f'T.{_quote_identifier(upper_value)}')
            continue
        if rule_type == "SYMBOLIC":
            if kind == "STRING" or (kind == "OP" and value in {"=", "<>", "!=", "<", ">", "<=", ">="}):
                raise HTTPException(status_code=400, detail="수식 규칙에는 문자열이나 비교 연산자를 사용할 수 없습니다.")
        rendered.append("<>" if value == "!=" else value)

    if not referenced:
        raise HTTPException(status_code=400, detail="규칙 표현식에 원본 테이블 컬럼을 하나 이상 사용하세요.")
    return " ".join(rendered), referenced


def _compile_discovered_association_expression(
    expression: Any,
    *,
    columns: dict[str, dict[str, Any]],
) -> tuple[str, list[str]]:
    text = str(expression or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="발굴 연관 규칙의 조건식이 비어 있습니다.")

    condition_parts = re.split(
        r"\s+AND\s+(?=[A-Za-z][A-Za-z0-9_$#]{0,127}\s*=)",
        text,
        flags=re.IGNORECASE,
    )
    rendered: list[str] = []
    referenced: list[str] = []
    for condition in condition_parts:
        match = re.fullmatch(
            r"\s*([A-Za-z][A-Za-z0-9_$#]{0,127})\s*=\s*(.*?)\s*",
            condition,
            flags=re.DOTALL,
        )
        if not match:
            raise HTTPException(
                status_code=400,
                detail=f"발굴 연관 규칙의 조건 형식을 해석할 수 없습니다: {condition[:200]}",
            )
        column_name = match.group(1).upper()
        condition_value = match.group(2)
        if column_name not in columns:
            raise HTTPException(
                status_code=400,
                detail=f"원본 테이블에 없는 컬럼입니다: {column_name}",
            )
        if not condition_value:
            raise HTTPException(
                status_code=400,
                detail=f"발굴 연관 규칙의 조건값이 비어 있습니다: {column_name}",
            )
        value_literal = (
            condition_value
            if re.fullmatch(r"'(?:''|[^'])*'", condition_value)
            else "'" + condition_value.replace("'", "''") + "'"
        )
        rendered.append(
            f'TO_CHAR(T.{_quote_identifier(column_name)}) = {value_literal}'
        )
        if column_name not in referenced:
            referenced.append(column_name)

    return " AND ".join(rendered), referenced


def _normalize_tolerance(value: Any) -> float:
    tolerance = 5.0 if value is None else float(value)
    if tolerance < 0 or tolerance > 100:
        raise HTTPException(status_code=400, detail="허용 오차율은 0 이상 100 이하로 입력하세요.")
    return tolerance


def _validate_user_rule_with_cursor(
    cursor,
    *,
    rule_type: str,
    target_owner: str,
    target_table: str,
    target_column: str,
    case_id_column: str | None,
    rule_expression: Any,
    expected_value: Any,
    rule_tolerance_pct: Any,
) -> dict[str, Any]:
    normalized_type = _normalize_choice(rule_type, USER_RULE_TYPES, "user rule type", "ASSOCIATION")
    columns = _table_column_map(cursor, target_owner, target_table)
    if target_column not in columns:
        raise HTTPException(status_code=400, detail="대상 컬럼이 INITUP$ 원본 테이블에 없습니다.")
    if case_id_column and case_id_column not in columns:
        raise HTTPException(status_code=400, detail="행 식별 컬럼이 INITUP$ 원본 테이블에 없습니다.")
    if normalized_type == "ASSOCIATION" and (
        expected_value is None or not str(expected_value).strip()
    ):
        raise HTTPException(status_code=400, detail="연관 규칙의 THEN 결과값을 입력하세요.")

    compiled_expression, referenced_columns = _compile_user_rule_expression(
        rule_expression,
        rule_type=normalized_type,
        columns=columns,
        target_column=target_column,
    )
    target_object = f"{_quote_identifier(target_owner)}.{_quote_identifier(target_table)}"
    tolerance = _normalize_tolerance(rule_tolerance_pct) if normalized_type == "SYMBOLIC" else None
    try:
        if normalized_type == "ASSOCIATION":
            sql = _render_dynamic_sql(
                "MCOMMON_EDIT_USER_RULE_VALIDATE_ASSOC",
                {
                    "conditionExpression": compiled_expression,
                    "targetObject": target_object,
                },
            )
            cursor.execute(sql, {"sampleLimit": 200})
        else:
            not_null_filter = "".join(
                f'\n           AND T.{_quote_identifier(column_name)} IS NOT NULL'
                for column_name in referenced_columns
            )
            sql = _render_dynamic_sql(
                "MCOMMON_EDIT_USER_RULE_VALIDATE_SYMBOLIC",
                {
                    "formulaExpression": compiled_expression,
                    "targetObject": target_object,
                    "targetColumn": _quote_identifier(target_column),
                    "notNullFilter": not_null_filter,
                },
            )
            cursor.execute(sql, {"sampleLimit": 200})
        result_columns = [item[0] for item in cursor.description or []]
        result_row = cursor.fetchone()
        validation_result = _row_to_dict(result_columns, result_row) if result_row else {}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"규칙을 실행할 수 없습니다. 컬럼, 연산자, 데이터 형식을 확인하세요. ({exc})",
        ) from exc
    return {
        "ruleType": normalized_type,
        "compiledExpression": compiled_expression,
        "referencedColumns": referenced_columns,
        "ruleTolerancePct": tolerance,
        "sampleCount": int(validation_result.get("SAMPLE_COUNT") or 0),
        "matchCount": (
            int(validation_result.get("MATCH_COUNT") or 0)
            if normalized_type == "ASSOCIATION"
            else None
        ),
        "minPredictedValue": validation_result.get("MIN_PREDICTED_VALUE"),
        "maxPredictedValue": validation_result.get("MAX_PREDICTED_VALUE"),
    }


def _get_user_text(request: Request) -> str:
    return str(get_request_user_id(request))


def _require_open_execution(session: dict[str, Any], _action: str) -> None:
    status = str(session.get("SESSION_STATUS") or "").upper()
    if status not in ACTIVE_EXECUTION_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="The editing execution is completed or cancelled and is read-only.",
        )


def _require_project_access(cursor, request: Request, project_id: int | None) -> int:
    if not project_id:
        raise HTTPException(status_code=400, detail="Project is required.")
    normalized_project_id = int(project_id)
    row = _fetch_one(
        cursor,
        "MCOMMON_EDIT_PROJECT_ACCESS",
        {
            "projectId": normalized_project_id,
            "includeAllUsers": "Y" if get_request_role_code(request) == "ADMIN" else "N",
            "userId": get_request_user_id(request),
        },
    )
    if not row or int(row.get("ACCESS_COUNT") or 0) <= 0:
        raise HTTPException(status_code=403, detail="You do not have access to this editing project.")
    return normalized_project_id


def _resolve_run_context(
    cursor,
    *,
    run_source_type: str,
    run_id: int,
) -> dict[str, int]:
    contexts = _fetch_all(
        cursor,
        "MCOMMON_EDIT_RUN_CONTEXT",
        {
            "runSourceType": run_source_type,
            "runId": int(run_id),
        },
    )
    if len(contexts) != 1:
        raise HTTPException(
            status_code=409,
            detail="The discovered-rule run does not have one unambiguous project and scenario.",
        )
    resolved_project_id = int(contexts[0].get("PROJECT_ID") or 0)
    resolved_scenario_id = int(contexts[0].get("SCENARIO_ID") or 0)
    if not resolved_project_id or not resolved_scenario_id:
        raise HTTPException(
            status_code=409,
            detail="The discovered-rule run has no project or scenario.",
        )
    return {
        "PROJECT_ID": resolved_project_id,
        "SCENARIO_ID": resolved_scenario_id,
    }


def _require_run_access(
    cursor,
    *,
    project_id: int,
    scenario_id: int | None,
    run_source_type: str,
    run_id: int,
) -> dict[str, Any]:
    context = _resolve_run_context(
        cursor,
        run_source_type=run_source_type,
        run_id=run_id,
    )
    resolved_project_id = context["PROJECT_ID"]
    resolved_scenario_id = context["SCENARIO_ID"]
    if (
        resolved_project_id != int(project_id)
        or not resolved_scenario_id
        or (scenario_id is not None and resolved_scenario_id != int(scenario_id))
    ):
        raise HTTPException(status_code=403, detail="The discovered-rule run does not belong to this project.")
    row = _fetch_one(
        cursor,
        "MCOMMON_EDIT_RUN_ACCESS",
        {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "runSourceType": run_source_type,
            "runId": int(run_id),
        },
    )
    if not row or int(row.get("ACCESS_COUNT") or 0) <= 0:
        raise HTTPException(status_code=403, detail="The discovered-rule run does not belong to this project.")
    return {
        "PROJECT_ID": resolved_project_id,
        "SCENARIO_ID": resolved_scenario_id,
    }


def _resolve_target_table_context(
    cursor,
    *,
    project_id: int,
    scenario_id: int | None,
    target_owner: str,
    target_table: str,
) -> dict[str, int]:
    contexts = _fetch_all(
        cursor,
        "MCOMMON_EDIT_TARGET_TABLE_CONTEXT",
        {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "targetOwner": target_owner,
            "targetTable": target_table,
        },
    )
    if not contexts:
        raise HTTPException(
            status_code=403,
            detail="The INITUP$ source table is not registered in this project and scenario.",
        )
    if len(contexts) != 1:
        raise HTTPException(
            status_code=400,
            detail="원본 테이블이 여러 시나리오에 등록되어 있습니다. 시나리오를 선택하세요.",
        )
    resolved_scenario_id = int(contexts[0].get("SCENARIO_ID") or 0)
    if not resolved_scenario_id:
        raise HTTPException(status_code=409, detail="원본 테이블의 시나리오를 확인할 수 없습니다.")
    return {
        "PROJECT_ID": int(contexts[0].get("PROJECT_ID") or project_id),
        "SCENARIO_ID": resolved_scenario_id,
    }


def _require_target_table_access(
    cursor,
    *,
    project_id: int,
    scenario_id: int | None,
    target_owner: str,
    target_table: str,
) -> dict[str, Any]:
    rows = _fetch_all(
        cursor,
        "MCOMMON_EDIT_TABLE_MAPPING",
        {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "targetOwner": target_owner,
            "targetTable": target_table,
        },
    )
    if not rows:
        raise HTTPException(
            status_code=403,
            detail="The managed source table mapping is not registered in this project.",
        )
    mappings = {
        (
            str(row.get("EDIT_OWNER") or "").upper(),
            str(row.get("EDIT_TABLE") or "").upper(),
        )
        for row in rows
    }
    if len(mappings) != 1:
        raise HTTPException(
            status_code=400,
            detail="The source table has multiple editing-table mappings. Select a scenario.",
        )
    edit_owner, edit_table = next(iter(mappings))
    normalized_source_table = _normalize_identifier(target_table, "source table")
    expected_edit_table = _derive_edit_table_name(normalized_source_table)
    normalized_edit_table = _normalize_identifier(edit_table, "edit table")
    if normalized_edit_table != expected_edit_table:
        raise HTTPException(
            status_code=409,
            detail=(
                "The saved INITUP$/INITDN$ mapping does not follow the required naming rule. "
                f"Expected {expected_edit_table}, but found {normalized_edit_table}."
            ),
        )
    return {
        **rows[0],
        "SOURCE_OWNER": _normalize_identifier(target_owner, "source owner"),
        "SOURCE_TABLE": normalized_source_table,
        "EDIT_OWNER": _normalize_identifier(edit_owner, "edit owner"),
        "EDIT_TABLE": normalized_edit_table,
    }


def _require_session_table_mapping(cursor, session: dict[str, Any]) -> dict[str, Any]:
    mapping = _require_target_table_access(
        cursor,
        project_id=int(session.get("PROJECT_ID") or 0),
        scenario_id=int(session.get("SCENARIO_ID") or 0) or None,
        target_owner=str(session.get("TARGET_OWNER") or ""),
        target_table=str(session.get("SOURCE_TABLE") or ""),
    )
    if (
        str(session.get("TARGET_OWNER") or "").upper() != mapping["EDIT_OWNER"]
        or str(session.get("EDIT_TABLE") or "").upper() != mapping["EDIT_TABLE"]
    ):
        raise HTTPException(
            status_code=409,
            detail="The editing execution does not match the saved source/edit table mapping.",
        )
    return mapping


def list_source_tables(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        normalized_project_id = _require_project_access(cursor, request, project_id)
        rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_SOURCE_TABLE_LIST",
            {
                "projectId": normalized_project_id,
                "scenarioId": scenario_id,
            },
        )
        return {
            "status": "success",
            "data": rows,
            "total": len(rows),
        }
    finally:
        cursor.close()
        conn.close()


def _matching_edit_session(
    sessions: list[dict[str, Any]],
    *,
    owner: str,
    source_table: str,
    edit_table: str,
) -> dict[str, Any] | None:
    matching_sessions = [
        row
        for row in sessions
        if str(row.get("TARGET_OWNER") or "") == owner
        and str(row.get("SOURCE_TABLE") or "") == source_table
        and str(row.get("EDIT_TABLE") or "") == edit_table
    ]
    for allowed_statuses in (
        {"EDITING", "VALIDATED", "APPLY_READY"},
        {"DRAFT"},
    ):
        selected = next(
            (
                row
                for row in matching_sessions
                if str(row.get("SESSION_STATUS") or "").upper() in allowed_statuses
            ),
            None,
        )
        if selected:
            return selected
    return None


def list_editing_tables(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        normalized_project_id = _require_project_access(cursor, request, project_id)
        rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_RULE_TABLE_LIST",
            {
                "projectId": normalized_project_id,
                "scenarioId": scenario_id,
            },
        )
        sessions = _fetch_all(
            cursor,
            "MCOMMON_EDIT_SESSION_LIST",
            {
                "projectId": normalized_project_id,
                "scenarioId": scenario_id,
                "sessionStatus": "ALL",
            },
        )
        result: list[dict[str, Any]] = []
        for row in rows:
            owner = _normalize_identifier(row.get("OWNER_NAME"), "target owner")
            source_table = _normalize_identifier(row.get("TABLE_NAME"), "source table")
            mapping = _require_target_table_access(
                cursor,
                project_id=normalized_project_id,
                scenario_id=scenario_id,
                target_owner=owner,
                target_table=source_table,
            )
            if mapping["EDIT_OWNER"] != owner:
                raise HTTPException(
                    status_code=409,
                    detail="Cross-owner editing table mappings are not supported.",
                )
            edit_table = mapping["EDIT_TABLE"]
            table_status = _editing_table_structure_status(
                cursor,
                owner,
                source_table,
                edit_table,
            )
            session = _matching_edit_session(
                sessions,
                owner=owner,
                source_table=source_table,
                edit_table=edit_table,
            )
            session_status = str(session.get("SESSION_STATUS") or "").upper() if session else None
            editable = bool(
                table_status["structureMatches"]
                and session_status in {"EDITING", "VALIDATED"}
            )
            result.append(
                {
                    **row,
                    "EDIT_TABLE": edit_table,
                    "EDIT_TABLE_EXISTS": table_status["exists"],
                    "TRACKING_COLUMN_EXISTS": table_status["trackingColumnExists"],
                    "STRUCTURE_MATCHES": table_status["structureMatches"],
                    "EDITABLE": editable,
                    "EDIT_SESSION_ID": session.get("EDIT_SESSION_ID") if session else None,
                    "EDIT_EXECUTION_ID": session.get("EDIT_SESSION_ID") if session else None,
                    "EXECUTION_RULE_COUNT": int(session.get("EXECUTION_RULE_COUNT") or 0) if session else 0,
                    "CHANGED_ROW_COUNT": int(session.get("CHANGED_ROW_COUNT") or 0) if session else 0,
                    "DML_COUNT": int(session.get("DML_COUNT") or 0) if session else 0,
                    "EXECUTED_DML_COUNT": int(session.get("EXECUTED_DML_COUNT") or 0) if session else 0,
                    "SESSION_STATUS": session_status,
                    "STATUS_MESSAGE": table_status["message"],
                }
            )
        return {
            "status": "success",
            "data": result,
            "total": len(result),
        }
    finally:
        cursor.close()
        conn.close()


def list_source_columns(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
    target_owner: str,
    target_table: str,
) -> dict[str, Any]:
    normalized_owner = _normalize_identifier(target_owner, "target owner")
    normalized_table = _normalize_identifier(target_table, "target table")
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        normalized_project_id = _require_project_access(cursor, request, project_id)
        _require_target_table_access(
            cursor,
            project_id=normalized_project_id,
            scenario_id=scenario_id,
            target_owner=normalized_owner,
            target_table=normalized_table,
        )
        rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_TABLE_COLUMNS",
            {
                "ownerName": normalized_owner,
                "tableName": normalized_table,
            },
        )
        return {
            "status": "success",
            "data": rows,
            "total": len(rows),
        }
    finally:
        cursor.close()
        conn.close()


def _event(
    cursor,
    *,
    edit_session_id: int | None,
    event_type: str,
    entity_type: str,
    entity_id: int | None,
    summary: str,
    user_id: str,
    detail: dict[str, Any] | None = None,
) -> None:
    cursor.execute(
        SqlLoader.get_sql("MCOMMON_EDIT_EVENT_INSERT"),
        {
            "editSessionId": edit_session_id,
            "eventType": _normalize_text(event_type, 40),
            "entityType": _normalize_text(entity_type, 40),
            "entityId": entity_id,
            "eventSummary": _normalize_text(summary, 1000),
            "eventDetailJson": json.dumps(detail or {}, ensure_ascii=False, default=str),
            "eventUser": user_id,
        },
    )


def _list_master_rules(
    cursor,
    project_id: int | None,
    scenario_id: int | None,
    decision_status: str = "ALL",
    source_rule_type: str = "ALL",
    run_source_type: str | None = None,
    run_id: int | None = None,
) -> list[dict[str, Any]]:
    sql, _ = _edit_rule_sql(cursor, "MCOMMON_EDIT_RULE_MASTER_LIST")
    cursor.execute(
        sql,
        {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "decisionStatus": decision_status,
            "ruleStatus": "ALL",
            "sourceRuleType": source_rule_type,
            "runSourceType": run_source_type,
            "runId": run_id,
        },
    )
    columns = [item[0] for item in cursor.description or []]
    return [_row_to_dict(columns, row) for row in cursor.fetchall()]


def list_rules(
    request: Request,
    *,
    project_id: int | None = None,
    scenario_id: int | None = None,
    run_source_type: str | None = None,
    run_id: int | None = None,
    target_owner: str | None = None,
    target_table: str | None = None,
    rule_group: str = "ALL",
    decision_status: str = "ALL",
    keyword: str | None = None,
    page: int = 1,
    page_size: int = 100,
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, project_id)
        normalized_decision = _normalize_choice(
            decision_status,
            DECISION_STATUSES | {"ALL"},
            "decision status",
            "ALL",
        )
        normalized_rule_group = _normalize_choice(
            rule_group,
            {"ALL", "CATEGORICAL", "CONTINUOUS"},
            "rule group",
            "ALL",
        )
        normalized_run_source = None
        normalized_run_id = None
        latest_run_selected = False
        if bool(run_source_type) != (run_id is not None):
            raise HTTPException(status_code=400, detail="Run source type and run ID must be provided together.")
        if run_source_type and run_id is not None:
            normalized_run_source = _normalize_choice(
                run_source_type,
                {"DATA_WORK", "FLOW_WORK"},
                "run source type",
                "FLOW_WORK",
            )
            normalized_run_id = int(run_id)
            _require_run_access(
                cursor,
                project_id=project_id,
                scenario_id=scenario_id,
                run_source_type=normalized_run_source,
                run_id=normalized_run_id,
            )
        else:
            latest_run = _fetch_one(
                cursor,
                "MCOMMON_EDIT_LATEST_RULE_RUN",
                {
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                },
            )
            if not latest_run:
                page_window = create_page_window(page, page_size, 0)
                return {
                    "status": "success",
                    "data": [],
                    "runSourceType": None,
                    "runId": None,
                    "ruleGroup": normalized_rule_group,
                    "decisionStatus": normalized_decision,
                    "latestRunSelected": False,
                    **page_window.response_metadata(),
                }
            normalized_run_source = str(latest_run.get("RUN_SOURCE_TYPE") or "").upper()
            normalized_run_id = int(latest_run.get("RUN_ID") or 0)
            latest_run_selected = True
        run_context = _require_run_access(
            cursor,
            project_id=project_id,
            scenario_id=scenario_id,
            run_source_type=str(normalized_run_source),
            run_id=int(normalized_run_id),
        )

        normalized_keyword = _normalize_text(keyword, 200) or None
        count_params = {
            "runSourceType": normalized_run_source,
            "runId": normalized_run_id,
            "targetOwner": _normalize_optional_identifier(target_owner, "target owner"),
            "targetTable": _normalize_optional_identifier(target_table, "target table"),
            "ruleGroup": normalized_rule_group,
            "decisionStatus": normalized_decision,
            "projectId": project_id,
            "scenarioId": scenario_id,
            "keyword": normalized_keyword,
        }
        requested_page = normalize_page_number(page)
        requested_page_size = normalize_page_size(page_size)
        requested_offset = (requested_page - 1) * requested_page_size
        source_rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_RULE_SOURCE_PAGE",
            {
                **count_params,
                "resolvedScenarioId": run_context["SCENARIO_ID"],
                "offset": requested_offset,
                "limit": requested_page_size,
            },
        )
        if not source_rows and requested_page > 1:
            requested_page = 1
            requested_offset = 0
            source_rows = _fetch_all(
                cursor,
                "MCOMMON_EDIT_RULE_SOURCE_PAGE",
                {
                    **count_params,
                    "resolvedScenarioId": run_context["SCENARIO_ID"],
                    "offset": requested_offset,
                    "limit": requested_page_size,
                },
            )
        total = int(source_rows[0].get("TOTAL_COUNT") or 0) if source_rows else 0
        page_window = create_page_window(requested_page, requested_page_size, total)
        rows: list[dict[str, Any]] = []
        for source in source_rows:
            column_comments_raw = source.pop("COLUMN_COMMENTS_JSON", None)
            source.pop("TOTAL_COUNT", None)
            try:
                column_comments = (
                    json.loads(column_comments_raw)
                    if isinstance(column_comments_raw, str) and column_comments_raw
                    else {}
                )
            except (TypeError, ValueError, json.JSONDecodeError):
                column_comments = {}
            source["COLUMN_COMMENTS"] = {
                str(column_name).upper(): str(column_comment or "")
                for column_name, column_comment in column_comments.items()
            }
            source["DECISION_STATUS"] = str(source.get("DECISION_STATUS") or "PENDING")
            source["RULE_STATUS"] = str(source.get("RULE_STATUS") or "ACTIVE")
            source["DECISION_NOTE"] = str(source.get("DECISION_NOTE") or "")
            source["CASE_ID_COLUMN"] = str(source.get("CASE_ID_COLUMN") or "")
            source["RULE_NAME"] = source.get("RULE_NAME") or source.get("SOURCE_RULE_ID")
            rows.append(source)
        page_decision_counts = {
            "SELECTED": sum(1 for row in rows if row.get("DECISION_STATUS") == "SELECTED"),
            "PENDING": sum(1 for row in rows if row.get("DECISION_STATUS") == "PENDING"),
            "REJECTED": sum(1 for row in rows if row.get("DECISION_STATUS") == "REJECTED"),
        }
        return {
            "status": "success",
            "data": rows,
            "runSourceType": normalized_run_source,
            "runId": normalized_run_id,
            "ruleGroup": normalized_rule_group,
            "decisionStatus": normalized_decision,
            "latestRunSelected": latest_run_selected,
            "decisionCounts": page_decision_counts,
            **page_window.response_metadata(),
        }
    finally:
        cursor.close()
        conn.close()


def validate_user_rule(request: Request, payload: UserRuleValidationRequest) -> dict[str, Any]:
    target_owner = _normalize_identifier(payload.targetOwner, "target owner")
    target_table = _normalize_identifier(payload.targetTable, "target table")
    target_column = _normalize_identifier(payload.targetColumn, "target column")
    case_id_column = _normalize_optional_identifier(payload.caseIdColumn, "case ID column")
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, payload.projectId)
        _require_target_table_access(
            cursor,
            project_id=project_id,
            scenario_id=payload.scenarioId,
            target_owner=target_owner,
            target_table=target_table,
        )
        result = _validate_user_rule_with_cursor(
            cursor,
            rule_type=payload.sourceRuleType,
            target_owner=target_owner,
            target_table=target_table,
            target_column=target_column,
            case_id_column=case_id_column,
            rule_expression=payload.ruleExpression,
            expected_value=payload.expectedValue,
            rule_tolerance_pct=payload.ruleTolerancePct,
        )
        return {"status": "success", "data": result}
    finally:
        cursor.close()
        conn.close()


def save_rule(request: Request, payload: RuleDecisionRequest) -> dict[str, Any]:
    user_id = _get_user_text(request)
    source_rule_type = _normalize_choice(payload.sourceRuleType, RULE_TYPES, "source rule type", "USER")
    is_user_rule = bool(payload.userRuleYn) or source_rule_type == "USER"
    semantic_rule_type = "ASSOCIATION" if source_rule_type == "USER" else source_rule_type
    if is_user_rule and semantic_rule_type not in USER_RULE_TYPES:
        raise HTTPException(status_code=400, detail="사용자 규칙 유형은 연관 규칙 또는 수식 규칙이어야 합니다.")
    decision_status = _normalize_choice(payload.decisionStatus, DECISION_STATUSES, "decision status", "PENDING")
    rule_status = _normalize_choice(payload.ruleStatus, RULE_STATUSES, "rule status", "ACTIVE")
    target_owner = _normalize_identifier(payload.targetOwner, "target owner")
    target_table = _normalize_identifier(payload.targetTable, "target table")
    target_column = _normalize_identifier(payload.targetColumn, "target column")
    case_id_column = _normalize_optional_identifier(payload.caseIdColumn, "case ID column")
    source_owner = _normalize_optional_identifier(payload.sourceOwner, "source owner")
    source_object_name = _normalize_optional_identifier(payload.sourceObjectName, "source object name")
    source_rule_id = _normalize_text(payload.sourceRuleId, 128) or None
    run_source_type = (
        _normalize_choice(payload.runSourceType, {"DATA_WORK", "FLOW_WORK"}, "run source type", "FLOW_WORK")
        if payload.runSourceType
        else None
    )
    if not is_user_rule and not all(
        [run_source_type, payload.runId, source_owner, source_object_name, source_rule_id]
    ):
        raise HTTPException(status_code=400, detail="Discovered rule source identity is incomplete.")
    rule_expression = payload.ruleExpression
    expected_value = payload.expectedValue
    rule_support = payload.ruleSupport
    rule_confidence = payload.ruleConfidence
    rule_lift = payload.ruleLift
    rule_tolerance_pct = payload.ruleTolerancePct

    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        if is_user_rule:
            project_id = _require_project_access(cursor, request, payload.projectId)
            scenario_id = int(payload.scenarioId) if payload.scenarioId is not None else None
        else:
            run_context = _resolve_run_context(
                cursor,
                run_source_type=str(run_source_type),
                run_id=int(payload.runId),
            )
            project_id = _require_project_access(
                cursor,
                request,
                int(run_context.get("PROJECT_ID") or 0),
            )
            scenario_id = int(run_context.get("SCENARIO_ID") or 0)
            if payload.projectId is not None and int(payload.projectId) != project_id:
                raise HTTPException(status_code=400, detail="The rule project does not match its source run.")
            if payload.scenarioId is not None and int(payload.scenarioId) != scenario_id:
                raise HTTPException(status_code=400, detail="The rule scenario does not match its source run.")
        existing_rule = None
        if payload.editRuleId and is_user_rule:
            existing_rule = _fetch_one(
                cursor,
                "MCOMMON_EDIT_RULE_SELECT",
                {
                    "editRuleId": int(payload.editRuleId),
                    "projectId": project_id,
                },
            )
            if not existing_rule:
                raise HTTPException(status_code=404, detail="수정할 규칙을 찾을 수 없습니다.")
            if (
                str(existing_rule.get("USER_RULE_YN") or "N").upper() != "Y"
                or existing_rule.get("SOURCE_RULE_ID")
            ):
                raise HTTPException(
                    status_code=409,
                    detail="기존 발굴 규칙은 수정할 수 없습니다. 다른 이름으로 사용자 규칙을 등록하세요.",
                )
            scenario_id = int(existing_rule.get("SCENARIO_ID") or 0)
            if not scenario_id:
                raise HTTPException(status_code=409, detail="기존 사용자 규칙의 시나리오를 확인할 수 없습니다.")
        definition_changed = True
        existing_tolerance = None
        if existing_rule:
            existing_source_type = str(existing_rule.get("SOURCE_RULE_TYPE") or "ASSOCIATION").upper()
            if existing_source_type == "USER":
                existing_source_type = "ASSOCIATION"
            existing_tolerance = (
                existing_rule.get("RULE_TOLERANCE_PCT")
                if existing_rule.get("RULE_TOLERANCE_PCT") is not None
                else existing_rule.get("RULE_LIFT")
            )
            definition_changed = any(
                (
                    existing_source_type != semantic_rule_type,
                    str(existing_rule.get("TARGET_OWNER") or "").upper() != target_owner,
                    str(existing_rule.get("TARGET_TABLE") or "").upper() != target_table,
                    str(existing_rule.get("TARGET_COLUMN") or "").upper() != target_column,
                    str(existing_rule.get("CASE_ID_COLUMN") or "").upper() != str(case_id_column or "").upper(),
                    str(existing_rule.get("RULE_EXPRESSION") or "").strip() != str(rule_expression or "").strip(),
                    str(existing_rule.get("EXPECTED_VALUE") or "").strip() != str(expected_value or "").strip(),
                    (
                        semantic_rule_type == "SYMBOLIC"
                        and float(existing_tolerance or 5) != float(rule_tolerance_pct or 5)
                    ),
                )
            )
        if is_user_rule and not existing_rule:
            table_context = _resolve_target_table_context(
                cursor,
                project_id=project_id,
                scenario_id=scenario_id,
                target_owner=target_owner,
                target_table=target_table,
            )
            scenario_id = table_context["SCENARIO_ID"]
        if not (is_user_rule and existing_rule and not definition_changed):
            _require_target_table_access(
                cursor,
                project_id=project_id,
                scenario_id=scenario_id,
                target_owner=target_owner,
                target_table=target_table,
            )
        if is_user_rule:
            if definition_changed:
                validation = _validate_user_rule_with_cursor(
                    cursor,
                    rule_type=semantic_rule_type,
                    target_owner=target_owner,
                    target_table=target_table,
                    target_column=target_column,
                    case_id_column=case_id_column,
                    rule_expression=rule_expression,
                    expected_value=expected_value,
                    rule_tolerance_pct=rule_tolerance_pct,
                )
                rule_tolerance_pct = validation["ruleTolerancePct"]
            elif existing_rule:
                rule_tolerance_pct = existing_tolerance
        else:
            source_detail = _fetch_one(
                cursor,
                (
                    "MCOMMON_EDIT_RULE_SOURCE_ASSOC_DETAIL"
                    if source_rule_type == "ASSOCIATION"
                    else "MCOMMON_EDIT_RULE_SOURCE_SYMBOLIC_DETAIL"
                ),
                {
                    "runSourceType": run_source_type,
                    "runId": payload.runId,
                    "sourceOwner": source_owner,
                    "sourceObjectName": source_object_name,
                    "sourceRuleId": source_rule_id,
                    "targetOwner": target_owner,
                    "targetTable": target_table,
                    "targetColumn": target_column,
                },
            )
            if not source_detail:
                raise HTTPException(status_code=404, detail="The discovered rule source was not found.")
            rule_expression = source_detail.get("RULE_EXPRESSION")
            expected_value = source_detail.get("EXPECTED_VALUE")
            rule_support = source_detail.get("RULE_SUPPORT")
            rule_confidence = source_detail.get("RULE_CONFIDENCE")
            rule_lift = source_detail.get("RULE_LIFT")
        edit_rule_id = payload.editRuleId
        if not edit_rule_id and not is_user_rule:
            matched = _fetch_one(
                cursor,
                "MCOMMON_EDIT_RULE_SOURCE_MATCH",
                {
                    "sourceRuleType": source_rule_type,
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                    "runSourceType": run_source_type,
                    "runId": payload.runId,
                    "sourceOwner": source_owner,
                    "sourceObjectName": source_object_name,
                    "sourceRuleId": source_rule_id,
                    "targetOwner": target_owner,
                    "targetTable": target_table,
                    "targetColumn": target_column,
                },
            )
            edit_rule_id = int(matched["EDIT_RULE_ID"]) if matched else None

        params = {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "sourceRuleType": semantic_rule_type,
            "runSourceType": run_source_type,
            "runId": payload.runId,
            "sourceOwner": source_owner,
            "sourceObjectName": source_object_name,
            "sourceRuleId": source_rule_id,
            "targetOwner": target_owner,
            "targetTable": target_table,
            "targetColumn": target_column,
            "caseIdColumn": case_id_column,
            "ruleName": _normalize_text(payload.ruleName, 300, source_rule_id or f"USER_{target_column}"),
            "ruleDescription": _normalize_text(payload.ruleDescription, 4000),
            "ruleExpression": rule_expression,
            "expectedValue": expected_value,
            "ruleSupport": rule_support,
            "ruleConfidence": rule_confidence,
            "ruleLift": rule_lift,
            "ruleTolerancePct": rule_tolerance_pct,
            "decisionStatus": decision_status,
            "ruleStatus": rule_status,
            "userRuleYn": "Y" if is_user_rule else "N",
            "decisionNote": _normalize_text(payload.decisionNote, 4000),
            "decidedBy": user_id,
            "createdBy": user_id,
        }
        rule_sql_id = (
            "MCOMMON_EDIT_USER_RULE_UPDATE"
            if edit_rule_id and is_user_rule
            else "MCOMMON_EDIT_RULE_UPDATE"
            if edit_rule_id
            else "MCOMMON_EDIT_RULE_INSERT"
        )
        rule_sql, has_tolerance_column = _edit_rule_sql(cursor, rule_sql_id)
        if (
            is_user_rule
            and semantic_rule_type == "SYMBOLIC"
            and not has_tolerance_column
        ):
            params["ruleLift"] = rule_tolerance_pct
        if edit_rule_id:
            params["editRuleId"] = int(edit_rule_id)
            cursor.execute(rule_sql, _bind_params_for_sql(rule_sql, params))
            if cursor.rowcount != 1:
                raise HTTPException(status_code=404, detail="Editing rule was not found in this project.")
        else:
            output_id = cursor.var(int)
            params["editRuleId"] = output_id
            cursor.execute(rule_sql, _bind_params_for_sql(rule_sql, params))
            edit_rule_id = int(output_id.getvalue()[0] if isinstance(output_id.getvalue(), list) else output_id.getvalue())
        saved_rule = _fetch_one(
            cursor,
            "MCOMMON_EDIT_RULE_SELECT",
            {
                "editRuleId": int(edit_rule_id),
                "projectId": project_id,
            },
        )
        if not saved_rule:
            raise HTTPException(status_code=500, detail="저장한 규칙을 다시 조회하지 못했습니다.")
        if is_user_rule:
            saved_tolerance = (
                saved_rule.get("RULE_TOLERANCE_PCT")
                if saved_rule.get("RULE_TOLERANCE_PCT") is not None
                else saved_rule.get("RULE_LIFT")
            )
            expected_fields = {
                "규칙 유형": (
                    str(saved_rule.get("SOURCE_RULE_TYPE") or "").upper(),
                    semantic_rule_type,
                ),
                "Target Owner": (
                    str(saved_rule.get("TARGET_OWNER") or "").upper(),
                    target_owner,
                ),
                "INITUP$ 원본 테이블": (
                    str(saved_rule.get("TARGET_TABLE") or "").upper(),
                    target_table,
                ),
                "대상 컬럼": (
                    str(saved_rule.get("TARGET_COLUMN") or "").upper(),
                    target_column,
                ),
                "행 식별 컬럼": (
                    str(saved_rule.get("CASE_ID_COLUMN") or "").upper(),
                    str(case_id_column or "").upper(),
                ),
                "규칙명": (
                    str(saved_rule.get("RULE_NAME") or ""),
                    str(params["ruleName"] or ""),
                ),
                "규칙 설명": (
                    str(saved_rule.get("RULE_DESCRIPTION") or ""),
                    str(params["ruleDescription"] or ""),
                ),
                "규칙 표현식": (
                    str(saved_rule.get("RULE_EXPRESSION") or "").strip(),
                    str(rule_expression or "").strip(),
                ),
                "THEN 결과값": (
                    str(saved_rule.get("EXPECTED_VALUE") or "").strip(),
                    str(expected_value or "").strip(),
                ),
            }
            if semantic_rule_type == "SYMBOLIC":
                expected_fields["허용 오차율"] = (
                    float(saved_tolerance or 5),
                    float(rule_tolerance_pct or 5),
                )
            mismatched_fields = [
                field_name
                for field_name, (saved_value, expected_value_for_field) in expected_fields.items()
                if saved_value != expected_value_for_field
            ]
            if mismatched_fields:
                raise HTTPException(
                    status_code=500,
                    detail=f"저장 후 값이 일치하지 않는 항목이 있습니다: {', '.join(mismatched_fields)}",
                )
        _event(
            cursor,
            edit_session_id=None,
            event_type=(
                "RULE_UPDATE"
                if is_user_rule and payload.editRuleId
                else "RULE_REGISTER"
                if is_user_rule
                else "RULE_DECISION"
            ),
            entity_type="EDIT_RULE",
            entity_id=int(edit_rule_id),
            summary=(
                f"Rule updated: {params['ruleName']}"
                if is_user_rule and payload.editRuleId
                else f"Rule registered: {params['ruleName']}"
                if is_user_rule
                else f"Rule {decision_status.lower()}: {params['ruleName']}"
            ),
            user_id=user_id,
            detail={"decisionStatus": decision_status, "targetTable": target_table, "targetColumn": target_column},
        )
        conn.commit()
        return {
            "status": "success",
            "editRuleId": int(edit_rule_id),
            "decisionStatus": decision_status,
            "data": saved_rule,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Editing rule save failed.")
        raise HTTPException(
            status_code=500,
            detail=f"규칙 저장 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def delete_user_rule(
    request: Request,
    *,
    edit_rule_id: int,
    project_id: int | None,
) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        normalized_project_id = _require_project_access(cursor, request, project_id)
        rule = _fetch_one(
            cursor,
            "MCOMMON_EDIT_RULE_SELECT",
            {
                "editRuleId": int(edit_rule_id),
                "projectId": normalized_project_id,
            },
        )
        if not rule:
            raise HTTPException(status_code=404, detail="삭제할 규칙을 찾을 수 없습니다.")
        if str(rule.get("USER_RULE_YN") or "N").upper() != "Y":
            raise HTTPException(
                status_code=409,
                detail="발굴 규칙 판단 원본은 삭제할 수 없습니다.",
            )
        if rule.get("SOURCE_RUN_SOURCE_TYPE") and rule.get("SOURCE_RUN_ID") is not None and rule.get("SOURCE_RULE_ID"):
            raise HTTPException(
                status_code=409,
                detail="발굴 규칙에서 승격·수정된 규칙은 삭제할 수 없습니다. 규칙판단 탭에서 제외 처리하세요.",
            )
        reference = _fetch_one(
            cursor,
            "MCOMMON_EDIT_USER_RULE_REFERENCE_COUNT",
            {"editRuleId": int(edit_rule_id)},
        )
        if int((reference or {}).get("REFERENCE_COUNT") or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail="에디팅 실행 이력에서 사용 중인 규칙은 삭제할 수 없습니다. 규칙 상태를 관리하거나 실행 참조를 먼저 확인하세요.",
            )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_USER_RULE_DELETE"),
            {
                "editRuleId": int(edit_rule_id),
                "projectId": normalized_project_id,
            },
        )
        if cursor.rowcount != 1:
            raise HTTPException(status_code=404, detail="삭제할 사용자 규칙을 찾을 수 없습니다.")
        _event(
            cursor,
            edit_session_id=None,
            event_type="RULE_DELETE",
            entity_type="EDIT_RULE",
            entity_id=int(edit_rule_id),
            summary=f"User rule deleted: {rule.get('RULE_NAME') or edit_rule_id}",
            user_id=user_id,
            detail={
                "targetTable": rule.get("TARGET_TABLE"),
                "targetColumn": rule.get("TARGET_COLUMN"),
            },
        )
        conn.commit()
        return {"status": "success", "editRuleId": int(edit_rule_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("User rule delete failed.")
        raise HTTPException(
            status_code=500,
            detail=f"사용자 규칙 삭제 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def exclude_discovered_rule(
    request: Request,
    *,
    edit_rule_id: int,
    project_id: int | None,
) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        normalized_project_id = _require_project_access(cursor, request, project_id)
        rule = _fetch_one(
            cursor,
            "MCOMMON_EDIT_RULE_SELECT",
            {
                "editRuleId": int(edit_rule_id),
                "projectId": normalized_project_id,
            },
        )
        if not rule:
            raise HTTPException(status_code=404, detail="선정 제외할 규칙을 찾을 수 없습니다.")
        if not (
            rule.get("SOURCE_RUN_SOURCE_TYPE")
            and rule.get("SOURCE_RUN_ID") is not None
            and rule.get("SOURCE_RULE_ID")
        ):
            raise HTTPException(
                status_code=409,
                detail="사용자 규칙은 선정 제외할 수 없습니다. 사용자 규칙 삭제를 사용하세요.",
            )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_DISCOVERED_RULE_EXCLUDE"),
            {
                "editRuleId": int(edit_rule_id),
                "projectId": normalized_project_id,
                "decidedBy": user_id,
            },
        )
        if cursor.rowcount != 1:
            raise HTTPException(status_code=409, detail="기존 발굴 규칙을 선정 제외하지 못했습니다.")
        saved_rule = _fetch_one(
            cursor,
            "MCOMMON_EDIT_RULE_SELECT",
            {
                "editRuleId": int(edit_rule_id),
                "projectId": normalized_project_id,
            },
        )
        if (
            not saved_rule
            or str(saved_rule.get("DECISION_STATUS") or "").upper() != "REJECTED"
            or str(saved_rule.get("USER_RULE_YN") or "").upper() != "N"
        ):
            raise HTTPException(status_code=500, detail="선정 제외 상태를 저장 후 확인하지 못했습니다.")
        _event(
            cursor,
            edit_session_id=None,
            event_type="RULE_DECISION",
            entity_type="EDIT_RULE",
            entity_id=int(edit_rule_id),
            summary=f"Rule rejected: {rule.get('RULE_NAME') or rule.get('SOURCE_RULE_ID')}",
            user_id=user_id,
            detail={
                "decisionStatus": "REJECTED",
                "sourceRuleId": rule.get("SOURCE_RULE_ID"),
                "targetTable": rule.get("TARGET_TABLE"),
                "targetColumn": rule.get("TARGET_COLUMN"),
            },
        )
        conn.commit()
        return {
            "status": "success",
            "editRuleId": int(edit_rule_id),
            "decisionStatus": "REJECTED",
            "data": saved_rule,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Discovered rule exclusion failed.")
        raise HTTPException(
            status_code=500,
            detail=f"규칙 선정 제외 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def exclude_discovered_rules(
    request: Request,
    payload: RuleBulkExcludeRequest,
) -> dict[str, Any]:
    rule_ids = sorted({int(value) for value in payload.editRuleIds if int(value) > 0})
    if not rule_ids:
        raise HTTPException(status_code=400, detail="Select at least one discovered rule to exclude.")
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, payload.projectId)
        rules: list[dict[str, Any]] = []
        for edit_rule_id in rule_ids:
            rule = _fetch_one(
                cursor,
                "MCOMMON_EDIT_RULE_SELECT",
                {
                    "editRuleId": edit_rule_id,
                    "projectId": project_id,
                },
            )
            if not rule:
                raise HTTPException(status_code=404, detail=f"Editing rule #{edit_rule_id} was not found.")
            if not (
                rule.get("SOURCE_RUN_SOURCE_TYPE")
                and rule.get("SOURCE_RUN_ID") is not None
                and rule.get("SOURCE_RULE_ID")
                and str(rule.get("USER_RULE_YN") or "N").upper() == "N"
            ):
                raise HTTPException(
                    status_code=409,
                    detail="User rules cannot be excluded in bulk. Delete user rules individually.",
                )
            if str(rule.get("DECISION_STATUS") or "").upper() == "REJECTED":
                raise HTTPException(
                    status_code=409,
                    detail=f"Editing rule #{edit_rule_id} is already excluded.",
                )
            rules.append(rule)
        for rule in rules:
            edit_rule_id = int(rule["EDIT_RULE_ID"])
            cursor.execute(
                SqlLoader.get_sql("MCOMMON_EDIT_DISCOVERED_RULE_EXCLUDE"),
                {
                    "editRuleId": edit_rule_id,
                    "projectId": project_id,
                    "decidedBy": user_id,
                },
            )
            if cursor.rowcount != 1:
                raise HTTPException(
                    status_code=409,
                    detail=f"Editing rule #{edit_rule_id} could not be excluded.",
                )
            _event(
                cursor,
                edit_session_id=None,
                event_type="RULE_DECISION",
                entity_type="EDIT_RULE",
                entity_id=edit_rule_id,
                summary=f"Rule rejected: {rule.get('RULE_NAME') or rule.get('SOURCE_RULE_ID')}",
                user_id=user_id,
                detail={
                    "decisionStatus": "REJECTED",
                    "sourceRuleId": rule.get("SOURCE_RULE_ID"),
                    "targetTable": rule.get("TARGET_TABLE"),
                    "targetColumn": rule.get("TARGET_COLUMN"),
                    "bulk": True,
                },
            )
        conn.commit()
        return {
            "status": "success",
            "decisionStatus": "REJECTED",
            "excludedCount": len(rules),
            "editRuleIds": rule_ids,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Bulk discovered-rule exclusion failed.")
        raise HTTPException(
            status_code=500,
            detail=f"규칙 일괄 선정 제외 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def list_master_rules(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
    decision_status: str = "ALL",
    source_rule_type: str = "ALL",
) -> dict[str, Any]:
    normalized_decision = str(decision_status or "ALL").upper()
    if normalized_decision not in DECISION_STATUSES | {"ALL"}:
        normalized_decision = "ALL"
    normalized_source = str(source_rule_type or "ALL").upper()
    if normalized_source not in RULE_TYPES | {"ALL"}:
        normalized_source = "ALL"
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, project_id)
        rows = _list_master_rules(cursor, project_id, scenario_id, normalized_decision, normalized_source)
        _attach_column_metadata(
            cursor,
            rows,
            column_keys=("TARGET_COLUMN", "CASE_ID_COLUMN"),
        )
        return {"status": "success", "data": rows, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Rule master lookup failed.")
        raise HTTPException(
            status_code=500,
            detail=f"규칙 마스터 조회 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def _build_live_rule_violation_sql(
    cursor,
    rule: dict[str, Any],
    keyword: str | None,
) -> tuple[str, dict[str, Any]]:
    source_type = str(rule.get("SOURCE_RULE_TYPE") or "ASSOCIATION").upper()
    if source_type == "USER":
        source_type = "ASSOCIATION"
    source_type = _normalize_choice(
        source_type,
        USER_RULE_TYPES,
        "rule type",
        "ASSOCIATION",
    )
    target_owner = _normalize_identifier(rule.get("TARGET_OWNER"), "target owner")
    target_table = _normalize_identifier(rule.get("TARGET_TABLE"), "target table")
    target_column = _normalize_identifier(rule.get("TARGET_COLUMN"), "target column")
    case_id_column = _normalize_optional_identifier(rule.get("CASE_ID_COLUMN"), "case ID column")
    columns = _table_column_map(cursor, target_owner, target_table)
    if target_column not in columns:
        raise HTTPException(status_code=409, detail="최종 규칙의 대상 컬럼이 INITUP$ 실제 테이블에 없습니다.")
    if case_id_column and case_id_column not in columns:
        raise HTTPException(status_code=409, detail="최종 규칙의 행 식별 컬럼이 INITUP$ 실제 테이블에 없습니다.")
    expected_value = rule.get("EXPECTED_VALUE")
    if source_type == "ASSOCIATION" and (
        expected_value is None or not str(expected_value).strip()
    ):
        raise HTTPException(status_code=409, detail="최종 연관 규칙에 THEN 결과값이 없습니다.")
    discovered_association = bool(
        source_type == "ASSOCIATION"
        and str(rule.get("USER_RULE_YN") or "N").upper() != "Y"
        and rule.get("SOURCE_RULE_ID")
    )
    if discovered_association:
        compiled_expression, referenced_columns = _compile_discovered_association_expression(
            rule.get("RULE_EXPRESSION"),
            columns=columns,
        )
    else:
        compiled_expression, referenced_columns = _compile_user_rule_expression(
            rule.get("RULE_EXPRESSION"),
            rule_type=source_type,
            columns=columns,
            target_column=target_column,
        )
    target_object = f"{_quote_identifier(target_owner)}.{_quote_identifier(target_table)}"
    case_id_expression = (
        f'TO_CHAR(T.{_quote_identifier(case_id_column)})'
        if case_id_column
        else "ROWIDTOCHAR(T.ROWID)"
    )
    replacements = {
        "targetObject": target_object,
        "targetColumn": _quote_identifier(target_column),
        "caseIdExpression": case_id_expression,
    }
    params: dict[str, Any] = {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "ruleId": str(rule.get("RULE_NAME") or rule.get("SOURCE_RULE_ID") or rule.get("EDIT_RULE_ID") or ""),
        "conditionText": str(rule.get("RULE_EXPRESSION") or ""),
        "targetColumnName": target_column,
        "keyword": _normalize_text(keyword, 200) or None,
    }
    if source_type == "ASSOCIATION":
        replacements["conditionExpression"] = compiled_expression
        params["expectedValue"] = expected_value
        params["violationReason"] = "최종 연관 규칙의 THEN 결과와 실제 값이 다릅니다."
        sql_id = "MCOMMON_EDIT_LIVE_VIOLATION_ASSOC"
    else:
        replacements["formulaExpression"] = compiled_expression
        replacements["notNullFilter"] = "".join(
            f'\n           AND T.{_quote_identifier(column_name)} IS NOT NULL'
            for column_name in referenced_columns
        )
        tolerance_value = (
            rule.get("RULE_TOLERANCE_PCT")
            if rule.get("RULE_TOLERANCE_PCT") is not None
            else rule.get("RULE_LIFT")
        )
        params["tolerancePct"] = _normalize_tolerance(tolerance_value)
        params["violationReason"] = "최종 수식 규칙의 예측값이 허용 오차를 벗어났습니다."
        sql_id = "MCOMMON_EDIT_LIVE_VIOLATION_SYMBOLIC"
    return _render_dynamic_sql(sql_id, replacements).strip().rstrip(";"), params


def _build_live_rule_violation_union_sql(
    cursor,
    rules: list[dict[str, Any]],
    keyword: str | None,
) -> tuple[str, dict[str, Any]]:
    if not rules:
        raise HTTPException(status_code=400, detail="조회할 최종 규칙을 선택하세요.")

    rule_queries: list[str] = []
    union_params: dict[str, Any] = {}
    for index, rule in enumerate(rules):
        base_sql, base_params = _build_live_rule_violation_sql(cursor, rule, keyword)
        suffix = f"_{index}"
        renamed_sql = SQL_BIND_PATTERN.sub(
            lambda match: f":{match.group(1)}{suffix}",
            base_sql,
        )
        union_params.update(
            {
                f"{name}{suffix}": value
                for name, value in base_params.items()
            }
        )
        union_params.update(
            {
                f"editRuleId{suffix}": int(rule.get("EDIT_RULE_ID") or 0),
                f"ruleName{suffix}": str(
                    rule.get("RULE_NAME")
                    or rule.get("SOURCE_RULE_ID")
                    or rule.get("EDIT_RULE_ID")
                    or ""
                ),
                f"sourceRuleType{suffix}": str(
                    rule.get("SOURCE_RULE_TYPE") or "ASSOCIATION"
                ).upper(),
                f"userRuleYn{suffix}": (
                    "Y"
                    if str(rule.get("USER_RULE_YN") or "N").upper() == "Y"
                    else "N"
                ),
            }
        )
        rule_queries.append(
            "SELECT :editRuleId{suffix} AS EDIT_RULE_ID"
            "     , :ruleName{suffix} AS RULE_NAME"
            "     , :sourceRuleType{suffix} AS SOURCE_RULE_TYPE"
            "     , :userRuleYn{suffix} AS USER_RULE_YN"
            "     , V.*"
            "  FROM ("
            "{base_sql}"
            "       ) V".format(
                suffix=suffix,
                base_sql=renamed_sql,
            )
        )
    return "\nUNION ALL\n".join(rule_queries), union_params


def _fetch_live_rule_violation_page(
    cursor,
    rules: list[dict[str, Any]],
    *,
    edit_session_id: int | None = None,
    change_status: str = "ALL",
    keyword: str | None,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], PageWindow, str]:
    base_sql, params = _build_live_rule_violation_union_sql(cursor, rules, keyword)
    scoped_sql = _render_dynamic_sql(
        "MCOMMON_EDIT_LIVE_VIOLATION_CHANGE_SCOPE",
        {"baseSql": base_sql},
    ).strip().rstrip(";")
    params.update(
        {
            "editSessionId": edit_session_id,
            "changeStatus": change_status,
        }
    )
    try:
        cursor.execute(
            f"SELECT COUNT(*) AS TOTAL_COUNT FROM ({scoped_sql}) Q",
            params,
        )
        total_row = cursor.fetchone()
        total = int(total_row[0] or 0) if total_row else 0
        page_window = create_page_window(page, page_size, total)
        paged_sql = (
            "SELECT P.* "
            "  FROM ("
            "        SELECT Q.* "
            "             , ROW_NUMBER() OVER ("
            "                   ORDER BY Q.VIOLATION_SCORE DESC NULLS LAST"
            "                          , Q.EDIT_RULE_ID"
            "                          , Q.CASE_ID"
            "                          , Q.CASE_ROWID"
            "               ) AS RN__ "
            f"          FROM ({scoped_sql}) Q"
            "       ) P "
            " WHERE P.RN__ > :offset "
            "   AND P.RN__ <= :endRow "
            " ORDER BY P.RN__"
        )
        cursor.execute(
            paged_sql,
            {
                **params,
                "offset": page_window.offset,
                "endRow": page_window.offset + page_window.page_size,
            },
        )
        columns = [item[0] for item in cursor.description or []]
        rows = [_row_to_dict(columns, row) for row in cursor.fetchall()]
        for row in rows:
            row.pop("RN__", None)
        return rows, page_window, scoped_sql
    except HTTPException:
        raise
    except Exception as exc:
        rule_names = ", ".join(
            str(rule.get("RULE_NAME") or rule.get("EDIT_RULE_ID") or "-")
            for rule in rules[:5]
        )
        if len(rules) > 5:
            rule_names = f"{rule_names} 외 {len(rules) - 5}개"
        raise HTTPException(
            status_code=409,
            detail=(
                f"선택한 최종 규칙({rule_names})의 실시간 위반 SQL을 "
                f"실행할 수 없습니다. 규칙 표현식과 실제 테이블 컬럼을 확인하세요. ({exc})"
            ),
        ) from exc


def list_violations(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
    target_owner: str | None = None,
    target_table: str | None = None,
    edit_session_id: int | None = None,
    edit_rule_id: int | None = None,
    edit_rule_ids: list[int] | None = None,
    change_status: str = "ALL",
    keyword: str | None = None,
    page: int = 1,
    page_size: int = 100,
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, project_id)
        normalized_owner = (
            _normalize_identifier(target_owner, "target owner")
            if target_owner
            else None
        )
        normalized_table = (
            _normalize_identifier(target_table, "target table")
            if target_table
            else None
        )
        if bool(normalized_owner) != bool(normalized_table):
            raise HTTPException(
                status_code=400,
                detail="원본 테이블 Owner와 테이블명을 함께 입력해 주세요.",
            )
        normalized_change_status = _normalize_choice(
            change_status,
            {"ALL", "UNEDITED", "APPLIED"},
            "change status",
            "ALL",
        )
        if normalized_table:
            _require_target_table_access(
                cursor,
                project_id=project_id,
                scenario_id=scenario_id,
                target_owner=normalized_owner,
                target_table=normalized_table,
            )
        rule_scenario_id = scenario_id
        execution_rule_ids: set[int] | None = None
        if edit_session_id:
            session = _select_session(cursor, edit_session_id, request)
            if int(session.get("PROJECT_ID") or 0) != project_id:
                raise HTTPException(status_code=400, detail="Editing execution does not belong to the selected project.")
            session_scenario_id = session.get("SCENARIO_ID")
            if (
                scenario_id is not None
                and session_scenario_id is not None
                and int(session_scenario_id) != int(scenario_id)
            ):
                raise HTTPException(
                    status_code=400,
                    detail="선택한 수정 작업이 현재 시나리오와 일치하지 않습니다.",
                )
            rule_scenario_id = session_scenario_id
            if normalized_table and (
                str(session.get("TARGET_OWNER") or "") != normalized_owner
                or str(session.get("SOURCE_TABLE") or "") != normalized_table
            ):
                raise HTTPException(
                    status_code=400,
                    detail="선택한 수정 작업이 원본 테이블과 일치하지 않습니다.",
                )
            execution_rule_ids = {
                int(row.get("EDIT_RULE_ID") or 0)
                for row in _fetch_all(
                    cursor,
                    "MCOMMON_EDIT_SESSION_RULE_LIST",
                    {"editSessionId": int(edit_session_id)},
                )
            }
        rules = _fetch_all(
            cursor,
            "MCOMMON_EDIT_RULE_SELECTED_LIST",
            {
                "projectId": project_id,
                "scenarioId": rule_scenario_id,
                "targetOwner": normalized_owner,
                "targetTable": normalized_table,
            },
        )
        if (
            execution_rule_ids is not None
            and str(session.get("SESSION_STATUS") or "").upper() in {"APPLIED", "CANCELLED"}
        ):
            rules = [
                rule
                for rule in rules
                if int(rule.get("EDIT_RULE_ID") or 0) in execution_rule_ids
            ]
        _attach_column_metadata(
            cursor,
            rules,
            column_keys=("TARGET_COLUMN", "CASE_ID_COLUMN"),
        )
        if not rules:
            page_window = create_page_window(page, page_size, 0)
            return {
                "status": "success",
                "data": [],
                "rules": [],
                "selectedRule": None,
                "selectedRules": [],
                "queryMode": "LIVE",
                "generatedSql": "",
                **page_window.response_metadata(),
            }
        requested_rule_ids = {
            int(value)
            for value in (edit_rule_ids or [])
            if int(value) > 0
        }
        has_explicit_rule_scope = edit_rule_ids is not None or edit_rule_id is not None
        if edit_rule_id is not None:
            requested_rule_ids.add(int(edit_rule_id))
        selected_rules = [
            rule
            for rule in rules
            if not has_explicit_rule_scope
            or int(rule.get("EDIT_RULE_ID") or 0) in requested_rule_ids
        ]
        selected_rule_ids = {
            int(rule.get("EDIT_RULE_ID") or 0)
            for rule in selected_rules
        }
        missing_rule_ids = requested_rule_ids - selected_rule_ids
        if missing_rule_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "선택한 규칙 중 현재 프로젝트·시나리오의 최종 활성 규칙이 아닌 항목이 있습니다. "
                    f"규칙 ID: {', '.join(str(value) for value in sorted(missing_rule_ids))}"
                ),
            )
        if not selected_rules:
            page_window = create_page_window(page, page_size, 0)
            return {
                "status": "success",
                "data": [],
                "rules": rules,
                "selectedRule": None,
                "selectedRules": [],
                "queryMode": "LIVE",
                "generatedSql": "",
                **page_window.response_metadata(),
            }
        selected_rule = selected_rules[0] if len(selected_rules) == 1 else None
        rows, page_window, generated_sql = _fetch_live_rule_violation_page(
            cursor,
            selected_rules,
            edit_session_id=edit_session_id,
            change_status=normalized_change_status,
            keyword=keyword,
            page=page,
            page_size=page_size,
        )
        rule_map = {
            int(rule.get("EDIT_RULE_ID") or 0): rule
            for rule in selected_rules
        }
        for violation in rows:
            violation_rule = rule_map.get(int(violation.get("EDIT_RULE_ID") or 0), {})
            source_type = str(
                violation.get("SOURCE_RULE_TYPE")
                or violation_rule.get("SOURCE_RULE_TYPE")
                or "ASSOCIATION"
            ).upper()
            is_user_rule = str(
                violation.get("USER_RULE_YN")
                or violation_rule.get("USER_RULE_YN")
                or "N"
            ).upper() == "Y"
            edit_change_id = violation.get("EDIT_CHANGE_ID")
            edit_new_value = violation.pop("EDIT_NEW_VALUE", None)
            violation.update(
                {
                    "EDIT_RULE_ID": violation_rule.get("EDIT_RULE_ID"),
                    "RULE_NAME": violation_rule.get("RULE_NAME"),
                    "SOURCE_RULE_TYPE": source_type,
                    "USER_RULE_YN": "Y" if is_user_rule else "N",
                    "SOURCE_VIOLATION_TYPE": f"LIVE_{source_type}",
                    "CURRENT_VALUE": (
                        edit_new_value
                        if edit_change_id is not None
                        else violation.get("ACTUAL_VALUE")
                    ),
                    "CHANGE_STATUS": violation.get("CHANGE_STATUS") or "UNEDITED",
                    "TARGET_COLUMN_COMMENT": violation_rule.get("TARGET_COLUMN_COMMENT") or "",
                    "COLUMN_COMMENTS": violation_rule.get("COLUMN_COMMENTS") or {},
                }
            )
        return {
            "status": "success",
            "data": rows,
            "rules": rules,
            "selectedRule": selected_rule,
            "selectedRules": selected_rules,
            "queryMode": "LIVE",
            "generatedSql": generated_sql,
            **page_window.response_metadata(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Live final-rule violation lookup failed.")
        raise HTTPException(
            status_code=500,
            detail=f"최종 규칙 실시간 위반 조회 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def list_sessions(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
    session_status: str = "ALL",
) -> dict[str, Any]:
    normalized_status = str(session_status or "ALL").upper()
    if normalized_status not in SESSION_STATUSES | {"ALL"}:
        normalized_status = "ALL"
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, project_id)
        rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_SESSION_LIST",
            {"projectId": project_id, "scenarioId": scenario_id, "sessionStatus": normalized_status},
        )
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        cursor.close()
        conn.close()


def _select_session(cursor, edit_session_id: int, request: Request | None = None) -> dict[str, Any]:
    session = _fetch_one(
        cursor,
        "MCOMMON_EDIT_SESSION_SELECT",
        {"editSessionId": int(edit_session_id)},
    )
    if not session:
        raise HTTPException(status_code=404, detail="Editing execution was not found.")
    if request is not None:
        _require_project_access(cursor, request, session.get("PROJECT_ID"))
    return session


def validate_flow_runtime_context(
    conn,
    request: Request,
    runtime_overrides: dict[str, Any],
    *,
    project_id: int | None,
    scenario_id: int | None,
) -> dict[str, Any]:
    if not runtime_overrides:
        return {}
    cursor = conn.cursor()
    try:
        edit_session_id = int(runtime_overrides.get("INIT$EditingSessionId") or 0)
        target_owner = _normalize_identifier(runtime_overrides.get("INIT$TargetOwner"), "target owner")
        target_table = _normalize_identifier(runtime_overrides.get("INIT$TargetTable"), "target table")
        project_id = _require_project_access(cursor, request, project_id)
        if not scenario_id:
            raise HTTPException(status_code=400, detail="Scenario is required.")

        if edit_session_id:
            session = _select_session(cursor, edit_session_id, request)
            if int(session.get("PROJECT_ID") or 0) != int(project_id):
                raise HTTPException(status_code=400, detail="Editing execution and Flow project do not match.")
            if session.get("SCENARIO_ID") is not None and int(session["SCENARIO_ID"]) != int(scenario_id):
                raise HTTPException(status_code=400, detail="Editing execution and Flow scenario do not match.")
            if target_owner != str(session.get("TARGET_OWNER") or "").upper():
                raise HTTPException(status_code=400, detail="Editing runtime owner does not match the editing execution.")
            if target_table != str(session.get("EDIT_TABLE") or "").upper():
                raise HTTPException(status_code=400, detail="Editing runtime table does not match the editing execution.")
            if str(session.get("SESSION_STATUS") or "") not in {"EDITING", "VALIDATED", "APPLY_READY"}:
                raise HTTPException(status_code=409, detail="Prepare the INITDN$ editing table before Flow reanalysis.")
        else:
            session = _fetch_one(
                cursor,
                "FLOW_WORK_RUNTIME_TABLE_PAIR",
                {
                    "projectId": project_id,
                    "scenarioId": int(scenario_id),
                    "editOwnerName": target_owner,
                    "editTableName": target_table,
                },
            )
            if not session:
                raise HTTPException(
                    status_code=400,
                    detail="The selected INITDN$ table is not registered to this Flow project and scenario.",
                )
        if not _table_exists(cursor, target_owner, target_table):
            raise HTTPException(status_code=404, detail="The INITDN$ editing table was not found.")
        return session
    finally:
        cursor.close()


def create_session(request: Request, payload: EditSessionCreateRequest) -> dict[str, Any]:
    rule_ids = sorted({int(value) for value in payload.editRuleIds if int(value) > 0})
    if not rule_ids:
        raise HTTPException(status_code=400, detail="Select at least one editing rule.")
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        project_id = _require_project_access(cursor, request, payload.projectId)
        masters = _list_master_rules(cursor, project_id, payload.scenarioId, "SELECTED", "ALL")
        selected = [
            row
            for row in masters
            if int(row.get("EDIT_RULE_ID") or 0) in rule_ids
            and str(row.get("RULE_STATUS") or "") == "ACTIVE"
        ]
        if len(selected) != len(rule_ids):
            raise HTTPException(status_code=400, detail="Only active selected rules can create an editing execution.")
        pairs = {(str(row.get("TARGET_OWNER") or ""), str(row.get("TARGET_TABLE") or "")) for row in selected}
        if len(pairs) != 1:
            raise HTTPException(status_code=400, detail="One editing execution can target only one INITUP$ table.")
        target_owner, source_table = next(iter(pairs))
        target_owner = _normalize_identifier(target_owner, "target owner")
        source_table = _normalize_identifier(source_table, "source table")
        mapping = _require_target_table_access(
            cursor,
            project_id=project_id,
            scenario_id=payload.scenarioId,
            target_owner=target_owner,
            target_table=source_table,
        )
        if mapping["EDIT_OWNER"] != target_owner:
            raise HTTPException(
                status_code=409,
                detail="Cross-owner editing table mappings are not supported.",
            )
        edit_table = mapping["EDIT_TABLE"]
        lock_row = _fetch_one(
            cursor,
            "MCOMMON_EDIT_TARGET_TABLE_LOCK",
            {
                "projectId": project_id,
                "scenarioId": payload.scenarioId,
                "targetOwner": target_owner,
                "targetTable": source_table,
            },
        )
        if not lock_row:
            raise HTTPException(status_code=409, detail="The editing table mapping could not be locked.")
        active_executions = _fetch_all(
            cursor,
            "MCOMMON_EDIT_SESSION_ACTIVE_SELECT",
            {
                "projectId": project_id,
                "scenarioId": payload.scenarioId,
                "targetOwner": target_owner,
                "sourceTable": source_table,
                "editTable": edit_table,
            },
        )
        if active_executions:
            active_id = int(active_executions[0].get("EDIT_SESSION_ID") or 0)
            raise HTTPException(
                status_code=409,
                detail=f"Editing execution #{active_id} is already active for this INITUP$/INITDN$ pair.",
            )
        run_pairs = {
            (str(row.get("SOURCE_RUN_SOURCE_TYPE") or ""), int(row.get("SOURCE_RUN_ID") or 0))
            for row in selected
            if row.get("SOURCE_RUN_ID") is not None
        }
        run_source_type, run_id = next(iter(run_pairs)) if len(run_pairs) == 1 else (None, None)
        output_id = cursor.var(int)
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_INSERT"),
            {
                "projectId": project_id,
                "scenarioId": payload.scenarioId,
                "sessionName": _normalize_text(payload.sessionName, 300, f"{source_table} editing"),
                "targetOwner": target_owner,
                "sourceTable": source_table,
                "editTable": edit_table,
                "runSourceType": run_source_type,
                "runId": run_id,
                "createdBy": user_id,
                "editSessionId": output_id,
            },
        )
        value = output_id.getvalue()
        edit_session_id = int(value[0] if isinstance(value, list) else value)
        for edit_rule_id in rule_ids:
            cursor.execute(
                SqlLoader.get_sql("MCOMMON_EDIT_SESSION_RULE_INSERT"),
                {"editSessionId": edit_session_id, "editRuleId": edit_rule_id},
            )
        if payload.baselineFlowRunId:
            cursor.execute(
                SqlLoader.get_sql("MCOMMON_EDIT_SESSION_BASELINE"),
                {"flowRunId": int(payload.baselineFlowRunId), "editSessionId": edit_session_id},
            )
        _event(
            cursor,
            edit_session_id=edit_session_id,
            event_type="SESSION_CREATED",
            entity_type="EDIT_SESSION",
            entity_id=edit_session_id,
            summary=f"Editing execution created for {target_owner}.{source_table}.",
            user_id=user_id,
            detail={"editRuleIds": rule_ids, "editTable": edit_table},
        )
        conn.commit()
        return {
            "status": "success",
            "editSessionId": edit_session_id,
            "editExecutionId": edit_session_id,
            "sourceTable": source_table,
            "editTable": edit_table,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def _table_exists(cursor, owner: str, table: str) -> bool:
    row = _fetch_one(
        cursor,
        "MCOMMON_EDIT_TABLE_EXISTS",
        {"ownerName": owner, "tableName": table},
    )
    return int(row.get("OBJECT_COUNT") or 0) > 0 if row else False


def _table_columns(cursor, owner: str, table: str) -> list[dict[str, Any]]:
    return _fetch_all(
        cursor,
        "MCOMMON_EDIT_TABLE_COLUMNS",
        {"ownerName": owner, "tableName": table},
    )


def _copy_table_comments(cursor, owner: str, source_table: str, edit_table: str) -> None:
    """Synchronize INITDN$ comments with its INITUP$ source table."""
    edit_table_ref = f"{_quote_identifier(owner)}.{_quote_identifier(edit_table)}"
    params = {"ownerName": owner, "tableName": source_table}
    table_comment_row = _fetch_one(cursor, "MCOMMON_EDIT_TABLE_COMMENT", params)
    table_comment = str((table_comment_row or {}).get("TABLE_COMMENT") or "")
    table_comment_sql = "''" if not table_comment else f"'{table_comment.replace("'", "''")}'"
    cursor.execute(f"COMMENT ON TABLE {edit_table_ref} IS {table_comment_sql}")
    for column in _table_columns(cursor, owner, source_table):
        column_name = str(column.get("COLUMN_NAME") or "").strip()
        column_comment = str(column.get("COLUMN_COMMENT") or "")
        if column_name:
            column_comment_sql = "''" if not column_comment else f"'{column_comment.replace("'", "''")}'"
            cursor.execute(
                f"COMMENT ON COLUMN {edit_table_ref}.{_quote_identifier(column_name)} "
                f"IS {column_comment_sql}"
            )


def _editing_table_structure_status(
    cursor,
    owner: str,
    source_table: str,
    edit_table: str,
) -> dict[str, Any]:
    if not _table_exists(cursor, owner, edit_table):
        return {
            "exists": False,
            "trackingColumnExists": False,
            "structureMatches": False,
            "message": "INITDN$ editing table does not exist.",
        }
    source_columns = _table_columns(cursor, owner, source_table)
    edit_columns = _table_columns(cursor, owner, edit_table)
    edit_column_map = {
        str(row.get("COLUMN_NAME") or ""): row
        for row in edit_columns
    }
    tracking_exists = TRACKING_COLUMN in edit_column_map
    comparable_keys = ("DATA_TYPE", "DATA_LENGTH", "DATA_PRECISION", "DATA_SCALE")
    source_signature = [
        (
            str(row.get("COLUMN_NAME") or ""),
            tuple(row.get(key) for key in comparable_keys),
        )
        for row in source_columns
    ]
    edit_signature = [
        (
            str(row.get("COLUMN_NAME") or ""),
            tuple(row.get(key) for key in comparable_keys),
        )
        for row in edit_columns
        if str(row.get("COLUMN_NAME") or "") != TRACKING_COLUMN
    ]
    structure_matches = tracking_exists and source_signature == edit_signature
    if not tracking_exists:
        message = f"Existing editing table is missing {TRACKING_COLUMN}."
    elif source_signature != edit_signature:
        message = "INITUP$ and INITDN$ column structures do not match one-to-one."
    else:
        message = "INITDN$ editing table is ready."
    return {
        "exists": True,
        "trackingColumnExists": tracking_exists,
        "structureMatches": structure_matches,
        "message": message,
    }


def editing_table_status(
    request: Request,
    *,
    project_id: int | None,
    scenario_id: int | None,
    target_owner: str,
    target_table: str,
) -> dict[str, Any]:
    owner = _normalize_identifier(target_owner, "target owner")
    source_table = _normalize_identifier(target_table, "source table")
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        normalized_project_id = _require_project_access(cursor, request, project_id)
        mapping = _require_target_table_access(
            cursor,
            project_id=normalized_project_id,
            scenario_id=scenario_id,
            target_owner=owner,
            target_table=source_table,
        )
        if mapping["EDIT_OWNER"] != owner:
            raise HTTPException(
                status_code=409,
                detail="Cross-owner editing table mappings are not supported.",
            )
        edit_table = mapping["EDIT_TABLE"]
        table_status = _editing_table_structure_status(
            cursor,
            owner,
            source_table,
            edit_table,
        )
        sessions = _fetch_all(
            cursor,
            "MCOMMON_EDIT_SESSION_LIST",
            {
                "projectId": normalized_project_id,
                "scenarioId": scenario_id,
                "sessionStatus": "ALL",
            },
        )
        matching_session = _matching_edit_session(
            sessions,
            owner=owner,
            source_table=source_table,
            edit_table=edit_table,
        )
        session_status = (
            str(matching_session.get("SESSION_STATUS") or "").upper()
            if matching_session
            else None
        )
        return {
            "status": "success",
            "data": {
                "targetOwner": owner,
                "sourceTable": source_table,
                "editTable": edit_table,
                **table_status,
                "editable": bool(
                    table_status["structureMatches"]
                    and session_status in {"EDITING", "VALIDATED"}
                ),
                "editSessionId": (
                    matching_session.get("EDIT_SESSION_ID")
                    if matching_session
                    else None
                ),
                "editExecutionId": (
                    matching_session.get("EDIT_SESSION_ID")
                    if matching_session
                    else None
                ),
                "sessionStatus": session_status,
            },
        }
    finally:
        cursor.close()
        conn.close()


def create_editing_table(
    request: Request,
    payload: EditingTableCreateRequest,
) -> dict[str, Any]:
    owner = _normalize_identifier(payload.targetOwner, "target owner")
    source_table = _normalize_identifier(payload.targetTable, "source table")
    requested_rule_ids = {
        int(value)
        for value in payload.editRuleIds
        if int(value) > 0
    }
    status_response = editing_table_status(
        request,
        project_id=payload.projectId,
        scenario_id=payload.scenarioId,
        target_owner=owner,
        target_table=source_table,
    )
    current_status = status_response.get("data") or {}
    if current_status.get("exists") and not current_status.get("structureMatches"):
        raise HTTPException(
            status_code=409,
            detail=current_status.get("message")
            or "INITUP$ and INITDN$ column structures do not match one-to-one.",
        )
    edit_session_id = current_status.get("editSessionId")
    session_status = str(current_status.get("sessionStatus") or "").upper()
    if current_status.get("editable") and edit_session_id:
        return {
            "status": "success",
            "editSessionId": int(edit_session_id),
            "editExecutionId": int(edit_session_id),
            "sourceTable": source_table,
            "editTable": current_status.get("editTable"),
            "alreadyPrepared": True,
            "editTableCreated": False,
        }
    if edit_session_id and session_status not in {"DRAFT", "EDITING"}:
        raise HTTPException(
            status_code=409,
            detail="The current editing work status cannot prepare the INITDN$ editing table.",
        )
    if not edit_session_id:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        try:
            project_id = _require_project_access(cursor, request, payload.projectId)
            rules = _list_master_rules(
                cursor,
                project_id,
                payload.scenarioId,
                "SELECTED",
                "ALL",
            )
            selected_rules = [
                row
                for row in rules
                if str(row.get("RULE_STATUS") or "").upper() == "ACTIVE"
                and str(row.get("TARGET_OWNER") or "").upper() == owner
                and str(row.get("TARGET_TABLE") or "").upper() == source_table
                and (
                    not requested_rule_ids
                    or int(row.get("EDIT_RULE_ID") or 0) in requested_rule_ids
                )
            ]
        finally:
            cursor.close()
            conn.close()
        edit_rule_ids = sorted(
            {
                int(row.get("EDIT_RULE_ID") or 0)
                for row in selected_rules
                if int(row.get("EDIT_RULE_ID") or 0) > 0
            }
        )
        if not edit_rule_ids:
            raise HTTPException(
                status_code=400,
                detail="No active final rules are registered for the selected INITUP$ table.",
            )
        if requested_rule_ids != set(edit_rule_ids) and requested_rule_ids:
            raise HTTPException(
                status_code=400,
                detail="One or more selected rules are not active for the selected INITUP$ table.",
            )
        baseline_run_ids = {
            int(row.get("SOURCE_RUN_ID") or 0)
            for row in selected_rules
            if str(row.get("SOURCE_RUN_SOURCE_TYPE") or "").upper() == "FLOW_WORK"
            and int(row.get("SOURCE_RUN_ID") or 0) > 0
        }
        created = create_session(
            request,
            EditSessionCreateRequest(
                projectId=payload.projectId,
                scenarioId=payload.scenarioId,
                sessionName=f"{source_table} 에디팅 실행",
                editRuleIds=edit_rule_ids,
                baselineFlowRunId=(
                    next(iter(baseline_run_ids))
                    if len(baseline_run_ids) == 1
                    else None
                ),
            ),
        )
        edit_session_id = created["editSessionId"]
    return prepare_session(request, int(edit_session_id))


def cancel_session(request: Request, edit_session_id: int) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        session_status = str(session.get("SESSION_STATUS") or "").upper()
        if session_status not in ACTIVE_EXECUTION_STATUSES:
            raise HTTPException(
                status_code=409,
                detail="Only an active editing execution can be cancelled.",
            )
        _require_session_table_mapping(cursor, session)
        dml_rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_DML_LIST",
            {
                "editSessionId": int(edit_session_id),
                "includeAllUsers": "Y",
                "userId": user_id,
            },
        )
        if any(str(row.get("DML_STATUS") or "").upper() == "EXECUTED" for row in dml_rows):
            raise HTTPException(
                status_code=409,
                detail="An editing execution with executed DML cannot be cancelled.",
            )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_CANCEL"),
            {"editSessionId": int(edit_session_id)},
        )
        if cursor.rowcount != 1:
            raise HTTPException(status_code=409, detail="Editing execution could not be cancelled.")
        _event(
            cursor,
            edit_session_id=int(edit_session_id),
            event_type="EXECUTION_CANCELLED",
            entity_type="EDIT_SESSION",
            entity_id=int(edit_session_id),
            summary="Editing execution cancelled; history and INITDN$ table were preserved.",
            user_id=user_id,
        )
        conn.commit()
        return {
            "status": "success",
            "editSessionId": int(edit_session_id),
            "editExecutionId": int(edit_session_id),
            "sessionStatus": "CANCELLED",
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Editing execution cancellation failed.")
        raise HTTPException(
            status_code=500,
            detail=f"에디팅 실행 취소 중 오류가 발생했습니다. 상세: {exc}",
        ) from exc
    finally:
        cursor.close()
        conn.close()


def prepare_session(request: Request, edit_session_id: int) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        session_status = str(session.get("SESSION_STATUS") or "")
        if session_status not in {"DRAFT", "EDITING"}:
            raise HTTPException(status_code=409, detail="Only draft or editing work can prepare its INITDN$ table.")
        owner = _normalize_identifier(session["TARGET_OWNER"], "target owner")
        source_table = _normalize_identifier(session["SOURCE_TABLE"], "source table")
        edit_table = _normalize_identifier(session["EDIT_TABLE"], "edit table")
        _require_session_table_mapping(cursor, session)
        if not _table_exists(cursor, owner, source_table):
            raise HTTPException(status_code=404, detail=f"Source table {owner}.{source_table} was not found.")
        if session_status == "EDITING":
            current_status = _editing_table_structure_status(
                cursor,
                owner,
                source_table,
                edit_table,
            )
            if current_status["structureMatches"]:
                _copy_table_comments(cursor, owner, source_table, edit_table)
                return {
                    "status": "success",
                    "editSessionId": edit_session_id,
                    "editExecutionId": edit_session_id,
                    "sourceTable": source_table,
                    "editTable": edit_table,
                    "sourceRowCount": int(session.get("SOURCE_ROW_COUNT") or 0),
                    "alreadyPrepared": True,
                    "editTableCreated": False,
                }
            if current_status["exists"]:
                raise HTTPException(status_code=409, detail=current_status["message"])
        source_column_rows = _table_columns(cursor, owner, source_table)
        source_columns = {str(row.get("COLUMN_NAME") or "") for row in source_column_rows}
        if TRACKING_COLUMN in source_columns:
            raise HTTPException(status_code=400, detail=f"Source table already contains reserved column {TRACKING_COLUMN}.")
        edit_table_created = not _table_exists(cursor, owner, edit_table)
        if edit_table_created:
            create_sql = (
                f"CREATE TABLE {_quote_identifier(owner)}.{_quote_identifier(edit_table)} "
                f"NOLOGGING AS SELECT ROWIDTOCHAR(T.ROWID) AS {_quote_identifier(TRACKING_COLUMN)}, "
                f"T.* FROM {_quote_identifier(owner)}.{_quote_identifier(source_table)} T"
            )
            cursor.execute(create_sql)
            _copy_table_comments(cursor, owner, source_table, edit_table)
        table_status = _editing_table_structure_status(
            cursor,
            owner,
            source_table,
            edit_table,
        )
        if not table_status["structureMatches"]:
            raise HTTPException(
                status_code=409,
                detail=table_status["message"],
            )
        if not edit_table_created:
            ordered_columns = [
                _normalize_identifier(row.get("COLUMN_NAME"), "source column")
                for row in source_column_rows
            ]
            quoted_columns = ", ".join(_quote_identifier(column) for column in ordered_columns)
            source_columns = ", ".join(f"T.{_quote_identifier(column)}" for column in ordered_columns)
            cursor.execute(
                f"DELETE /*+ NO_PARALLEL */ FROM {_quote_identifier(owner)}.{_quote_identifier(edit_table)}"
            )
            cursor.execute(
                f"INSERT /*+ NO_PARALLEL */ INTO {_quote_identifier(owner)}.{_quote_identifier(edit_table)} "
                f"({_quote_identifier(TRACKING_COLUMN)}, {quoted_columns}) "
                f"SELECT /*+ NO_PARALLEL(T) */ ROWIDTOCHAR(T.ROWID), {source_columns} "
                f"FROM {_quote_identifier(owner)}.{_quote_identifier(source_table)} T"
            )
        cursor.execute(
            f"SELECT COUNT(*) FROM {_quote_identifier(owner)}.{_quote_identifier(edit_table)}"
        )
        source_row_count = int(cursor.fetchone()[0] or 0)
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_PREPARED"),
            {"sourceRowCount": source_row_count, "editSessionId": edit_session_id},
        )
        _event(
            cursor,
            edit_session_id=edit_session_id,
            event_type="EDIT_TABLE_PREPARED",
            entity_type="EDIT_SESSION",
            entity_id=edit_session_id,
            summary=f"{owner}.{edit_table} prepared with {source_row_count} rows.",
            user_id=user_id,
            detail={"sourceTable": source_table, "editTable": edit_table, "rowCount": source_row_count},
        )
        conn.commit()
        return {
            "status": "success",
            "editSessionId": edit_session_id,
            "editExecutionId": edit_session_id,
            "sourceTable": source_table,
            "editTable": edit_table,
            "sourceRowCount": source_row_count,
            "editTableCreated": edit_table_created,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def _apply_edit_change(
    cursor,
    *,
    edit_session_id: int,
    session: dict[str, Any],
    columns: dict[str, dict[str, Any]],
    session_rules: dict[int, dict[str, Any]],
    payload: EditChangeRequest,
    user_id: str,
) -> dict[str, Any]:
    source_rowid = _normalize_text(payload.sourceRowid, 30)
    if not source_rowid:
        raise HTTPException(status_code=400, detail="Source ROWID is required.")
    column_name = _normalize_identifier(payload.columnName, "column name")
    if column_name == TRACKING_COLUMN:
        raise HTTPException(status_code=400, detail="The editing tracking column cannot be changed.")
    edit_rule_id = int(payload.editRuleId or 0)
    session_rule = session_rules.get(edit_rule_id)
    if not session_rule:
        raise HTTPException(status_code=400, detail="Editing rule does not belong to this editing work.")
    if column_name != str(session_rule.get("TARGET_COLUMN") or "").upper():
        raise HTTPException(status_code=400, detail="Editing column does not match the selected rule target.")
    owner = _normalize_identifier(session["TARGET_OWNER"], "target owner")
    edit_table = _normalize_identifier(session["EDIT_TABLE"], "edit table")
    if column_name not in columns:
        raise HTTPException(status_code=400, detail="Column does not exist in the INITDN$ editing table.")
    select_sql = (
        f"SELECT {_quote_identifier(column_name)} "
        f"FROM {_quote_identifier(owner)}.{_quote_identifier(edit_table)} "
        f"WHERE {_quote_identifier(TRACKING_COLUMN)} = :sourceRowid"
    )
    cursor.execute(select_sql, {"sourceRowid": source_rowid})
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Editing row was not found.")
    old_value = _read_lob(row[0])
    update_sql = (
        f"UPDATE {_quote_identifier(owner)}.{_quote_identifier(edit_table)} "
        f"SET {_quote_identifier(column_name)} = :newValue "
        f"WHERE {_quote_identifier(TRACKING_COLUMN)} = :sourceRowid"
    )
    cursor.execute(update_sql, {"newValue": payload.newValue, "sourceRowid": source_rowid})
    cursor.execute(
        SqlLoader.get_sql("MCOMMON_EDIT_CHANGE_MERGE"),
        {
            "editSessionId": edit_session_id,
            "editRuleId": edit_rule_id,
            "sourceViolationType": _normalize_text(payload.sourceViolationType, 30).upper(),
            "sourceViolationId": int(payload.sourceViolationId),
            "sourceRowid": source_rowid,
            "caseId": _normalize_text(payload.caseId, 4000),
            "columnName": column_name,
            "oldValue": None if old_value is None else str(old_value),
            "newValue": None if payload.newValue is None else str(payload.newValue),
            "expectedValue": None if payload.expectedValue is None else str(payload.expectedValue),
            "editedBy": user_id,
        },
    )
    _event(
        cursor,
        edit_session_id=edit_session_id,
        event_type="CELL_EDITED",
        entity_type="EDIT_CHANGE",
        entity_id=None,
        summary=f"{column_name} updated for source ROWID {source_rowid}.",
        user_id=user_id,
        detail={
            "editRuleId": edit_rule_id,
            "caseId": payload.caseId,
            "targetOwner": session.get("TARGET_OWNER"),
            "sourceTable": session.get("SOURCE_TABLE"),
            "editTable": session.get("EDIT_TABLE"),
            "sourceRowid": source_rowid,
            "columnName": column_name,
            "oldValue": old_value,
            "newValue": payload.newValue,
            "expectedValue": payload.expectedValue,
            "violationId": payload.sourceViolationId,
        },
    )
    return {
        "editRuleId": edit_rule_id,
        "sourceRowid": source_rowid,
        "columnName": column_name,
        "oldValue": old_value,
        "newValue": payload.newValue,
    }


def _session_rules_for_changes(
    cursor,
    *,
    session: dict[str, Any],
    edit_session_id: int,
    requested_rule_ids: set[int],
) -> dict[int, dict[str, Any]]:
    linked_rules = {
        int(row.get("EDIT_RULE_ID") or 0): row
        for row in _fetch_all(
            cursor,
            "MCOMMON_EDIT_SESSION_RULE_LIST",
            {"editSessionId": edit_session_id},
        )
    }
    current_rules = {
        int(row.get("EDIT_RULE_ID") or 0): row
        for row in _fetch_all(
            cursor,
            "MCOMMON_EDIT_RULE_SELECTED_LIST",
            {
                "projectId": session.get("PROJECT_ID"),
                "scenarioId": session.get("SCENARIO_ID"),
                "targetOwner": session.get("TARGET_OWNER"),
                "targetTable": session.get("SOURCE_TABLE"),
            },
        )
    }
    normalized_requested_rule_ids = {
        edit_rule_id
        for edit_rule_id in requested_rule_ids
        if edit_rule_id > 0
    }
    unavailable_rule_ids = normalized_requested_rule_ids - set(current_rules)
    if unavailable_rule_ids:
        raise HTTPException(
            status_code=409,
            detail=(
                "The selected rule is no longer active in the current Rule Master. "
                f"Rule IDs: {', '.join(str(value) for value in sorted(unavailable_rule_ids))}"
            ),
        )
    for edit_rule_id in sorted(set(current_rules) - set(linked_rules)):
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_RULE_INSERT"),
            {"editSessionId": edit_session_id, "editRuleId": edit_rule_id},
        )
        linked_rules[edit_rule_id] = current_rules[edit_rule_id]
    return linked_rules


def save_change(request: Request, edit_session_id: int, payload: EditChangeRequest) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        if str(session.get("SESSION_STATUS") or "") not in {"EDITING", "VALIDATED"}:
            raise HTTPException(status_code=409, detail="Editing execution must be prepared before data changes.")
        owner = _normalize_identifier(session["TARGET_OWNER"], "target owner")
        edit_table = _normalize_identifier(session["EDIT_TABLE"], "edit table")
        columns = {str(row.get("COLUMN_NAME") or ""): row for row in _table_columns(cursor, owner, edit_table)}
        session_rules = _session_rules_for_changes(
            cursor,
            session=session,
            edit_session_id=edit_session_id,
            requested_rule_ids={int(payload.editRuleId or 0)},
        )
        result = _apply_edit_change(
            cursor,
            edit_session_id=edit_session_id,
            session=session,
            columns=columns,
            session_rules=session_rules,
            payload=payload,
            user_id=user_id,
        )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_STATUS"),
            {"sessionStatus": "EDITING", "editSessionId": edit_session_id},
        )
        conn.commit()
        return {"status": "success", **result}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def save_changes(
    request: Request,
    edit_session_id: int,
    payload: EditChangeBulkRequest,
) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        if str(session.get("SESSION_STATUS") or "") not in {"EDITING", "VALIDATED"}:
            raise HTTPException(status_code=409, detail="Editing execution must be prepared before data changes.")
        owner = _normalize_identifier(session["TARGET_OWNER"], "target owner")
        edit_table = _normalize_identifier(session["EDIT_TABLE"], "edit table")
        columns = {
            str(row.get("COLUMN_NAME") or ""): row
            for row in _table_columns(cursor, owner, edit_table)
        }
        session_rules = _session_rules_for_changes(
            cursor,
            session=session,
            edit_session_id=edit_session_id,
            requested_rule_ids={
                int(change.editRuleId or 0)
                for change in payload.changes
                if int(change.editRuleId or 0) > 0
            },
        )
        seen_cells: set[tuple[str, str]] = set()
        results: list[dict[str, Any]] = []
        for change in payload.changes:
            source_rowid = _normalize_text(change.sourceRowid, 30)
            column_name = _normalize_identifier(change.columnName, "column name")
            cell_key = (source_rowid, column_name)
            if cell_key in seen_cells:
                raise HTTPException(
                    status_code=400,
                    detail="The same editing cell is included more than once.",
                )
            seen_cells.add(cell_key)
            results.append(
                _apply_edit_change(
                    cursor,
                    edit_session_id=edit_session_id,
                    session=session,
                    columns=columns,
                    session_rules=session_rules,
                    payload=change,
                    user_id=user_id,
                )
            )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_STATUS"),
            {"sessionStatus": "EDITING", "editSessionId": edit_session_id},
        )
        conn.commit()
        return {
            "status": "success",
            "savedCount": len(results),
            "data": results,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def list_changes(request: Request, edit_session_id: int) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_CHANGE_LIST",
            {"editSessionId": edit_session_id, "changeStatus": "ALL"},
        )
        for row in rows:
            row["TARGET_OWNER"] = row.get("TARGET_OWNER") or session.get("TARGET_OWNER")
            row["TARGET_TABLE"] = row.get("TARGET_TABLE") or session.get("SOURCE_TABLE")
        _attach_column_metadata(
            cursor,
            rows,
            column_keys=("COLUMN_NAME",),
        )
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        cursor.close()
        conn.close()


def _count_session_violations(
    cursor,
    edit_session_id: int,
    run_source_type: str | None,
    run_id: int | None,
    target_owner: str | None,
    target_table: str | None,
) -> int | None:
    if not run_source_type or not run_id or not target_owner or not target_table:
        return None
    rules = _fetch_all(
        cursor,
        "MCOMMON_EDIT_SESSION_RULE_LIST",
        {"editSessionId": edit_session_id},
    )
    target_columns = {
        str(rule.get("TARGET_COLUMN") or "").upper()
        for rule in rules
        if str(rule.get("TARGET_COLUMN") or "").strip()
    }
    if not target_columns:
        return None
    scoped_counts = _fetch_all(
        cursor,
        "MCOMMON_EDIT_VIOLATION_SCOPE_LIST",
        {
            "runSourceType": run_source_type,
            "runId": int(run_id),
            "targetOwner": target_owner,
            "targetTable": target_table,
        },
    )
    return sum(
        int(row.get("VIOLATION_COUNT") or 0)
        for row in scoped_counts
        if str(row.get("TARGET_COLUMN") or "").upper() in target_columns
    )


def _build_validation_data(cursor, session: dict[str, Any], edit_session_id: int) -> dict[str, Any]:
    summary = _fetch_one(
        cursor,
        "MCOMMON_EDIT_VALIDATION_SUMMARY",
        {"editSessionId": edit_session_id},
    ) or {}
    baseline_flow_run_id = session.get("BASELINE_FLOW_RUN_ID")
    baseline_run_type = "FLOW_WORK" if baseline_flow_run_id else session.get("SOURCE_RUN_SOURCE_TYPE")
    baseline_run_id = baseline_flow_run_id or session.get("SOURCE_RUN_ID")
    reanalysis_run_id = session.get("REANALYSIS_FLOW_RUN_ID")
    baseline_count = _count_session_violations(
        cursor,
        edit_session_id,
        str(baseline_run_type or "") or None,
        int(baseline_run_id) if baseline_run_id else None,
        session.get("TARGET_OWNER"),
        session.get("SOURCE_TABLE"),
    )
    reanalysis_count = _count_session_violations(
        cursor,
        edit_session_id,
        "FLOW_WORK" if reanalysis_run_id else None,
        int(reanalysis_run_id) if reanalysis_run_id else None,
        session.get("TARGET_OWNER"),
        session.get("EDIT_TABLE"),
    )
    reanalysis_run = (
        _fetch_one(
            cursor,
            "MCOMMON_EDIT_FLOW_RUN_STATUS",
            {"flowRunId": int(reanalysis_run_id)},
        )
        if reanalysis_run_id
        else None
    )
    reduction_count = (
        baseline_count - reanalysis_count
        if baseline_count is not None and reanalysis_count is not None
        else None
    )
    reduction_rate = (
        reduction_count / baseline_count
        if reduction_count is not None and baseline_count
        else None
    )
    return {
        **session,
        **summary,
        "BASELINE_VIOLATION_COUNT": baseline_count,
        "REANALYSIS_VIOLATION_COUNT": reanalysis_count,
        "VIOLATION_REDUCTION_COUNT": reduction_count,
        "VIOLATION_REDUCTION_RATE": reduction_rate,
        "REANALYSIS_RUN_STATUS": (reanalysis_run or {}).get("STATUS"),
        "REANALYSIS_RUN_MESSAGE": (reanalysis_run or {}).get("MESSAGE"),
        "REANALYSIS_RUN_STARTED_AT": (reanalysis_run or {}).get("STARTED_AT"),
        "REANALYSIS_RUN_FINISHED_AT": (reanalysis_run or {}).get("FINISHED_AT"),
    }


def validation_summary(request: Request, edit_session_id: int) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        return {"status": "success", "data": _build_validation_data(cursor, session, edit_session_id)}
    finally:
        cursor.close()
        conn.close()


def mark_validated(request: Request, edit_session_id: int) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        if str(session.get("SESSION_STATUS") or "") not in {"EDITING", "VALIDATED"}:
            raise HTTPException(status_code=409, detail="Editing execution is not ready for effect validation.")
        _session_rules_for_changes(
            cursor,
            session=session,
            edit_session_id=edit_session_id,
            requested_rule_ids=set(),
        )
        summary = _build_validation_data(cursor, session, edit_session_id)
        if int(summary.get("APPLIED_CHANGE_COUNT") or 0) <= 0:
            raise HTTPException(status_code=409, detail="At least one applied editing change is required.")
        if summary.get("REANALYSIS_FLOW_RUN_ID") and str(summary.get("REANALYSIS_RUN_STATUS") or "") != "SUCCESS":
            raise HTTPException(status_code=409, detail="The linked INITDN$ Flow reanalysis must finish successfully.")
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_STATUS"),
            {"sessionStatus": "VALIDATED", "editSessionId": edit_session_id},
        )
        _event(
            cursor,
            edit_session_id=edit_session_id,
            event_type="EFFECT_VALIDATED",
            entity_type="EDIT_SESSION",
            entity_id=edit_session_id,
            summary="Editing effect validation completed.",
            user_id=user_id,
            detail=summary,
        )
        conn.commit()
        return {"status": "success", "sessionStatus": "VALIDATED", "data": summary}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def link_reanalysis(
    request: Request,
    edit_session_id: int,
    payload: ReanalysisLinkRequest,
) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        _require_open_execution(session, "link Flow reanalysis")
        flow_run = _fetch_one(
            cursor,
            "MCOMMON_EDIT_FLOW_RUN_ACCESS",
            {"flowRunId": int(payload.flowRunId)},
        )
        if not flow_run:
            raise HTTPException(status_code=404, detail="Flow reanalysis run was not found.")
        if int(flow_run.get("PROJECT_ID") or 0) != int(session.get("PROJECT_ID") or 0):
            raise HTTPException(status_code=400, detail="Flow reanalysis run and editing project do not match.")
        if session.get("SCENARIO_ID") is not None and int(flow_run.get("SCENARIO_ID") or 0) != int(session["SCENARIO_ID"]):
            raise HTTPException(status_code=400, detail="Flow reanalysis run and editing scenario do not match.")
        try:
            plan = json.loads(str(flow_run.get("PLAN_JSON") or "{}"))
        except (TypeError, ValueError, json.JSONDecodeError):
            plan = {}
        runtime_overrides = plan.get("runtimeOverrides") if isinstance(plan, dict) else {}
        if not isinstance(runtime_overrides, dict):
            runtime_overrides = {}
        if int(runtime_overrides.get("INIT$EditingSessionId") or 0) != edit_session_id:
            raise HTTPException(status_code=400, detail="Flow run was not executed for this editing execution.")
        if str(runtime_overrides.get("INIT$TargetOwner") or "").upper() != str(session.get("TARGET_OWNER") or "").upper():
            raise HTTPException(status_code=400, detail="Flow run owner does not match the editing execution.")
        if str(runtime_overrides.get("INIT$TargetTable") or "").upper() != str(session.get("EDIT_TABLE") or "").upper():
            raise HTTPException(status_code=400, detail="Flow run table does not match the editing execution.")
        status = _normalize_text(flow_run.get("STATUS"), 30, "QUEUED").upper()
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_REANALYSIS"),
            {"flowRunId": payload.flowRunId, "reanalysisStatus": status, "editSessionId": edit_session_id},
        )
        _event(
            cursor,
            edit_session_id=edit_session_id,
            event_type="REANALYSIS_LINKED",
            entity_type="FLOW_RUN",
            entity_id=payload.flowRunId,
            summary=f"INITDN$ reanalysis linked to FLOW_RUN_ID {payload.flowRunId}.",
            user_id=user_id,
            detail={"status": status},
        )
        conn.commit()
        return {"status": "success", "flowRunId": payload.flowRunId, "reanalysisStatus": status}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def _resolve_dml_match_column(
    cursor,
    *,
    changes: list[dict[str, Any]],
    owner: str,
    source_table: str,
    edit_table: str,
    edit_session_id: int,
    expected_rows: int,
    registered_case_column: str | None,
) -> str | None:
    source_column_map = {
        str(row.get("COLUMN_NAME") or ""): row
        for row in _table_columns(cursor, owner, source_table)
    }
    edit_column_map = {
        str(row.get("COLUMN_NAME") or ""): row
        for row in _table_columns(cursor, owner, edit_table)
    }
    rule_case_columns = {
        _normalize_identifier(row.get("CASE_ID_COLUMN"), "case ID column")
        for row in changes
        if str(row.get("CASE_ID_COLUMN") or "").strip()
    }
    all_changes_have_same_case_column = (
        len(rule_case_columns) == 1
        and all(str(row.get("CASE_ID_COLUMN") or "").strip() for row in changes)
    )
    case_columns: list[str] = []
    if str(registered_case_column or "").strip():
        case_columns.append(
            _normalize_identifier(registered_case_column, "registered case ID column")
        )
    if all_changes_have_same_case_column:
        rule_case_column = next(iter(rule_case_columns))
        if rule_case_column not in case_columns:
            case_columns.append(rule_case_column)
    change_scope = (
        "EXISTS (\n"
        "             SELECT 1\n"
        '               FROM "INIT$_TB_EDIT_CHANGE" C\n'
        f"              WHERE C.EDIT_SESSION_ID = {int(edit_session_id)}\n"
        "                AND C.CHANGE_STATUS = 'APPLIED'\n"
        f"                AND C.SOURCE_ROWID = E.{_quote_identifier(TRACKING_COLUMN)}\n"
        "             )"
    )

    case_match_diagnostics: list[str] = []
    for case_column in case_columns:
        source_metadata = source_column_map.get(case_column) or {}
        edit_metadata = edit_column_map.get(case_column) or {}
        source_type = str(source_metadata.get("DATA_TYPE") or "").upper()
        edit_type = str(edit_metadata.get("DATA_TYPE") or "").upper()
        unsupported_type = any(
            marker in source_type or marker in edit_type
            for marker in ("LOB", "LONG", "XMLTYPE")
        )
        if not source_metadata or not edit_metadata:
            case_match_diagnostics.append(f"{case_column}:missing")
            continue
        if unsupported_type:
            case_match_diagnostics.append(f"{case_column}:unsupportedType")
            continue
        quoted_case_column = _quote_identifier(case_column)
        cursor.execute(
            "SELECT COUNT(*) AS EDIT_ROW_COUNT\n"
            f"     , COUNT(E.{quoted_case_column}) AS NON_NULL_KEY_COUNT\n"
            f"     , COUNT(DISTINCT E.{quoted_case_column}) AS DISTINCT_KEY_COUNT\n"
            f"  FROM {_quote_identifier(owner)}.{_quote_identifier(edit_table)} E\n"
            " WHERE " + change_scope
        )
        edit_row_count, non_null_key_count, distinct_key_count = cursor.fetchone()
        edit_row_count = int(edit_row_count or 0)
        non_null_key_count = int(non_null_key_count or 0)
        distinct_key_count = int(distinct_key_count or 0)
        if (
            edit_row_count != expected_rows
            or non_null_key_count != expected_rows
            or distinct_key_count != expected_rows
        ):
            case_match_diagnostics.append(
                f"{case_column}:edit={edit_row_count},nonNull={non_null_key_count},distinct={distinct_key_count}"
            )
            continue
        cursor.execute(
            "SELECT COUNT(*) AS SOURCE_MATCH_COUNT\n"
            f"  FROM {_quote_identifier(owner)}.{_quote_identifier(source_table)} S\n"
            f"  JOIN {_quote_identifier(owner)}.{_quote_identifier(edit_table)} E\n"
            f"    ON S.{quoted_case_column} = E.{quoted_case_column}\n"
            " WHERE " + change_scope
        )
        source_match_count = int(cursor.fetchone()[0] or 0)
        if source_match_count == expected_rows:
            return case_column
        case_match_diagnostics.append(
            f"{case_column}:sourceMatched={source_match_count}"
        )

    cursor.execute(
        "SELECT COUNT(*) AS EDIT_ROW_COUNT\n"
        f"  FROM {_quote_identifier(owner)}.{_quote_identifier(edit_table)} E\n"
        " WHERE " + change_scope
    )
    edit_row_count = int(cursor.fetchone()[0] or 0)
    cursor.execute(
        "SELECT COUNT(*) AS SOURCE_MATCH_COUNT\n"
        f"  FROM {_quote_identifier(owner)}.{_quote_identifier(source_table)} S\n"
        f"  JOIN {_quote_identifier(owner)}.{_quote_identifier(edit_table)} E\n"
        f"    ON ROWIDTOCHAR(S.ROWID) = E.{_quote_identifier(TRACKING_COLUMN)}\n"
        " WHERE " + change_scope
    )
    source_match_count = int(cursor.fetchone()[0] or 0)
    if edit_row_count == expected_rows and source_match_count == expected_rows:
        return None
    raise HTTPException(
        status_code=409,
        detail=(
            "Final DML row mapping is stale or ambiguous. "
            f"expected={expected_rows}, editMatched={edit_row_count}, "
            f"sourceMatched={source_match_count}. "
            f"caseKeyChecks={';'.join(case_match_diagnostics) or 'none'}. "
            "Create a new editing work from the current source table if no registered case key matches."
        ),
    )


def _generate_merge_dml(cursor, session: dict[str, Any], edit_session_id: int) -> str:
    changes = _fetch_all(
        cursor,
        "MCOMMON_EDIT_CHANGE_LIST",
        {"editSessionId": edit_session_id, "changeStatus": "APPLIED"},
    )
    columns = sorted({_normalize_identifier(row.get("COLUMN_NAME"), "column name") for row in changes})
    if not columns:
        raise HTTPException(status_code=409, detail="No applied editing changes are available for DML generation.")
    owner = _normalize_identifier(session["TARGET_OWNER"], "target owner")
    source_table = _normalize_identifier(session["SOURCE_TABLE"], "source table")
    edit_table = _normalize_identifier(session["EDIT_TABLE"], "edit table")
    mapping = _require_session_table_mapping(cursor, session)
    source_columns = {str(row.get("COLUMN_NAME") or "") for row in _table_columns(cursor, owner, source_table)}
    if any(column not in source_columns for column in columns):
        raise HTTPException(status_code=400, detail="A changed column is missing from the INITUP$ source table.")
    expected_rows = len({
        str(row.get("SOURCE_ROWID") or "").strip()
        for row in changes
        if str(row.get("SOURCE_ROWID") or "").strip()
    })
    if expected_rows <= 0:
        raise HTTPException(status_code=409, detail="No applied source rows are available for DML generation.")
    match_column = _resolve_dml_match_column(
        cursor,
        changes=changes,
        owner=owner,
        source_table=source_table,
        edit_table=edit_table,
        edit_session_id=edit_session_id,
        expected_rows=expected_rows,
        registered_case_column=str(mapping.get("CASE_ID_COLUMN") or "") or None,
    )
    assignments = "\n".join(
        (
            "         , " if index else "         SET "
        )
        + f'S.{_quote_identifier(column)} = CASE\n'
        + "             WHEN EXISTS (\n"
        + "                  SELECT 1\n"
        + '                    FROM "INIT$_TB_EDIT_CHANGE" C\n'
        + f"                   WHERE C.EDIT_SESSION_ID = {int(edit_session_id)}\n"
        + "                     AND C.CHANGE_STATUS = 'APPLIED'\n"
        + f"                     AND C.SOURCE_ROWID = E.{_quote_identifier(TRACKING_COLUMN)}\n"
        + f"                     AND C.COLUMN_NAME = '{column}'\n"
        + "                  )\n"
        + f'             THEN E.{_quote_identifier(column)}\n'
        + f'             ELSE S.{_quote_identifier(column)}\n'
        + "         END"
        for index, column in enumerate(columns)
    )
    match_condition = (
        f"   ON (S.{_quote_identifier(match_column)} = E.{_quote_identifier(match_column)})\n"
        if match_column
        else f"   ON (ROWIDTOCHAR(S.ROWID) = E.{_quote_identifier(TRACKING_COLUMN)})\n"
    )
    merge_sql = (
        f"MERGE INTO {_quote_identifier(owner)}.{_quote_identifier(source_table)} S\n"
        "USING (\n"
        f"      SELECT E.*\n"
        f"        FROM {_quote_identifier(owner)}.{_quote_identifier(edit_table)} E\n"
        "       WHERE EXISTS (\n"
        "             SELECT 1\n"
        '               FROM "INIT$_TB_EDIT_CHANGE" C\n'
        f"              WHERE C.EDIT_SESSION_ID = {int(edit_session_id)}\n"
        "                AND C.CHANGE_STATUS = 'APPLIED'\n"
        f"                AND C.SOURCE_ROWID = E.{_quote_identifier(TRACKING_COLUMN)}\n"
        "             )\n"
        "     ) E\n"
        f"{match_condition}"
        " WHEN MATCHED THEN\n"
        "      UPDATE\n"
        f"{assignments}"
    )
    indented_merge_sql = "\n".join(f"    {line}" for line in merge_sql.splitlines())
    return (
        "BEGIN\n"
        f"{indented_merge_sql}\n"
        "    ;\n"
        f"    IF SQL%ROWCOUNT <> {expected_rows} THEN\n"
        "        RAISE_APPLICATION_ERROR(\n"
        "            -20001,\n"
        f"            'Final apply row-count mismatch. expected={expected_rows}'\n"
        "        );\n"
        "    END IF;\n"
        "END;"
    )


def generate_dml(request: Request, edit_session_id: int) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, edit_session_id, request)
        _require_open_execution(session, "generate operational DML")
        dml_sql = _generate_merge_dml(cursor, session, edit_session_id)
        return {
            "status": "success",
            "dmlName": f"{session['SOURCE_TABLE']} final apply",
            "dmlSql": dml_sql,
        }
    finally:
        cursor.close()
        conn.close()


def validate_dml(request: Request, payload: EditDmlValidateRequest) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, payload.editSessionId, request)
        _require_open_execution(session, "validate operational DML")
        message = _validate_registered_dml(
            cursor,
            payload.dmlSql,
            session,
            payload.editSessionId,
            parse_oracle=True,
        )
        return {
            "status": "success",
            "validationMessage": message,
        }
    finally:
        cursor.close()
        conn.close()


def _validate_registered_dml(
    cursor,
    dml_sql: str,
    session: dict[str, Any],
    edit_session_id: int,
    *,
    parse_oracle: bool = False,
) -> str:
    sql = str(dml_sql or "").strip()
    if not sql:
        raise HTTPException(status_code=400, detail="DML SQL is required.")
    if len(sql) > 200_000:
        raise HTTPException(status_code=400, detail="DML SQL is too large.")
    if re.search(r"(?s)(--|/\*)", sql):
        raise HTTPException(status_code=400, detail="Comments are not allowed in final DML.")
    owner = _normalize_identifier(session["TARGET_OWNER"], "target owner")
    source_table = _normalize_identifier(session["SOURCE_TABLE"], "source table")
    edit_table = _normalize_identifier(session["EDIT_TABLE"], "edit table")
    _require_session_table_mapping(cursor, session)
    canonical_sql = _generate_merge_dml(cursor, session, edit_session_id).strip()
    canonical_merge, separator, canonical_tail = canonical_sql.partition(";")
    edited_merge, edited_separator, edited_tail = sql.partition(";")
    if not separator or not edited_separator:
        raise HTTPException(
            status_code=400,
            detail="Final DML must keep the server-generated PL/SQL structure.",
        )

    normalize_space = lambda value: re.sub(r"\s+", " ", str(value or "")).strip().upper()
    if normalize_space(edited_tail) != normalize_space(canonical_tail):
        raise HTTPException(
            status_code=400,
            detail="The row-count validation section of final DML cannot be changed.",
        )

    normalized_merge = normalize_space(edited_merge)
    expected_target = (
        f'MERGE INTO "{owner}"."{source_table}" S'
    )
    expected_edit_source = (
        f'FROM "{owner}"."{edit_table}" E'
    )
    required_fragments = (
        expected_target,
        expected_edit_source,
        'FROM "INIT$_TB_EDIT_CHANGE" C',
        "WHEN MATCHED THEN UPDATE SET",
        "C.CHANGE_STATUS = 'APPLIED'",
        f'C.EDIT_SESSION_ID = {int(edit_session_id)}',
        f'C.SOURCE_ROWID = E."{TRACKING_COLUMN}"',
    )
    if any(normalize_space(fragment) not in normalized_merge for fragment in required_fragments):
        raise HTTPException(
            status_code=400,
            detail="Final DML must keep the current INITUP$/INITDN$ target, editing history, and matched-row update structure.",
        )
    canonical_match = re.search(
        r"\bON\s*\(([^()]*)\)\s*WHEN\s+MATCHED",
        canonical_merge,
        re.IGNORECASE,
    )
    if not canonical_match or normalize_space(canonical_match.group(0)) not in normalized_merge:
        raise HTTPException(
            status_code=400,
            detail="The server-generated final DML row match condition cannot be changed.",
        )

    prohibited_patterns = (
        r"\bEXECUTE\s+IMMEDIATE\b",
        r"\bDBMS_SQL\b",
        r"\bPRAGMA\b",
        r"\bAUTONOMOUS_TRANSACTION\b",
        r"\bCREATE\b",
        r"\bALTER\b",
        r"\bDROP\b",
        r"\bTRUNCATE\b",
        r"\bGRANT\b",
        r"\bREVOKE\b",
        r"\bDELETE\b",
        r"\bINSERT\b",
        r"\bWHEN\s+NOT\s+MATCHED\b",
        r":[A-Z0-9_$#]+",
    )
    if any(re.search(pattern, edited_merge, re.IGNORECASE) for pattern in prohibited_patterns):
        raise HTTPException(
            status_code=400,
            detail="Final DML contains a command that is not allowed for INITDN$ final apply.",
        )
    if len(re.findall(r"\bMERGE\s+INTO\b", edited_merge, re.IGNORECASE)) != 1:
        raise HTTPException(status_code=400, detail="Final DML must contain exactly one MERGE statement.")
    if len(re.findall(r"\bUPDATE\b", edited_merge, re.IGNORECASE)) != 1:
        raise HTTPException(status_code=400, detail="Final DML must contain exactly one matched-row UPDATE.")

    canonical_identifiers = {
        value.upper()
        for value in re.findall(r'"([^"]+)"', canonical_merge)
    }
    edited_identifiers = {
        value.upper()
        for value in re.findall(r'"([^"]+)"', edited_merge)
    }
    if not edited_identifiers.issubset(canonical_identifiers):
        raise HTTPException(
            status_code=400,
            detail="Final DML references an owner, table, or column outside the generated editing scope.",
        )

    canonical_calls = {
        value.upper()
        for value in re.findall(r"\b([A-Z][A-Z0-9_$#]*)\s*\(", canonical_merge, re.IGNORECASE)
    }
    edited_calls = {
        value.upper()
        for value in re.findall(r"\b([A-Z][A-Z0-9_$#]*)\s*\(", edited_merge, re.IGNORECASE)
    }
    if not edited_calls.issubset(canonical_calls):
        raise HTTPException(
            status_code=400,
            detail="Final DML contains a function or callable expression outside the generated editing scope.",
        )

    session_ids = {
        int(value)
        for value in re.findall(r"\bC\.EDIT_SESSION_ID\s*=\s*(\d+)\b", edited_merge, re.IGNORECASE)
    }
    if session_ids != {int(edit_session_id)}:
        raise HTTPException(
            status_code=400,
            detail="Final DML can reference only the selected editing execution.",
        )

    if parse_oracle:
        try:
            # Parse only: validate Oracle grammar and referenced objects without executing the DML.
            cursor.parse(sql)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Generated final DML is not valid Oracle SQL. {exc}",
            ) from exc
    return f'Validated final DML target: "{owner}"."{source_table}".'


def save_dml(request: Request, payload: EditDmlRequest) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        session = _select_session(cursor, payload.editSessionId, request)
        _require_open_execution(session, "save operational DML")
        _session_rules_for_changes(
            cursor,
            session=session,
            edit_session_id=int(payload.editSessionId),
            requested_rule_ids=set(),
        )
        dml_sql = str(payload.dmlSql or "")
        if not dml_sql.strip():
            raise HTTPException(status_code=400, detail="DML SQL is required.")
        if len(dml_sql) > 200_000:
            raise HTTPException(status_code=400, detail="DML SQL is too large.")
        if payload.editDmlId:
            existing_dml = _fetch_one(
                cursor,
                "MCOMMON_EDIT_DML_SELECT_FOR_UPDATE",
                {"editDmlId": payload.editDmlId},
            )
            if (
                not existing_dml
                or int(existing_dml.get("EDIT_SESSION_ID") or 0) != int(payload.editSessionId)
            ):
                raise HTTPException(status_code=404, detail="Registered DML was not found in this editing execution.")
            if (
                get_request_role_code(request) != "ADMIN"
                and str(existing_dml.get("CREATED_BY") or "") != user_id
            ):
                raise HTTPException(status_code=403, detail="Only the DML author can update this DML.")
            if str(existing_dml.get("DML_STATUS") or "").upper() == "EXECUTED":
                raise HTTPException(status_code=409, detail="Executed DML cannot be overwritten.")
            cursor.execute(
                SqlLoader.get_sql("MCOMMON_EDIT_DML_UPDATE"),
                {
                    "editDmlId": payload.editDmlId,
                    "editSessionId": payload.editSessionId,
                    "dmlName": _normalize_text(payload.dmlName, 300, "Final apply DML"),
                    "dmlSql": dml_sql,
                },
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=404, detail="Registered DML was not found in this editing execution.")
            edit_dml_id = int(payload.editDmlId)
        else:
            output_id = cursor.var(int)
            cursor.execute(
                SqlLoader.get_sql("MCOMMON_EDIT_DML_INSERT"),
                {
                    "editSessionId": payload.editSessionId,
                    "dmlName": _normalize_text(payload.dmlName, 300, "Final apply DML"),
                    "dmlSql": dml_sql,
                    "createdBy": user_id,
                    "editDmlId": output_id,
                },
            )
            value = output_id.getvalue()
            edit_dml_id = int(value[0] if isinstance(value, list) else value)
        _event(
            cursor,
            edit_session_id=payload.editSessionId,
            event_type="DML_SAVED",
            entity_type="EDIT_DML",
            entity_id=edit_dml_id,
            summary="Final apply DML saved.",
            user_id=user_id,
        )
        conn.commit()
        return {
            "status": "success",
            "editDmlId": edit_dml_id,
            "dmlStatus": "DRAFT",
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def list_dml(request: Request, edit_session_id: int | None) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        if edit_session_id:
            _select_session(cursor, edit_session_id, request)
        rows = _fetch_all(
            cursor,
            "MCOMMON_EDIT_DML_LIST",
            {
                "editSessionId": edit_session_id,
                "includeAllUsers": (
                    "Y"
                    if edit_session_id or get_request_role_code(request) == "ADMIN"
                    else "N"
                ),
                "userId": _get_user_text(request),
            },
        )
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        cursor.close()
        conn.close()


def delete_dml(request: Request, edit_dml_id: int) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        dml = _fetch_one(
            cursor,
            "MCOMMON_EDIT_DML_SELECT_FOR_UPDATE",
            {"editDmlId": edit_dml_id},
        )
        if not dml:
            raise HTTPException(status_code=404, detail="Registered DML was not found.")
        edit_session_id = int(dml["EDIT_SESSION_ID"])
        session = _select_session(cursor, edit_session_id, request)
        _require_open_execution(session, "delete operational DML")
        if (
            get_request_role_code(request) != "ADMIN"
            and str(dml.get("CREATED_BY") or "") != user_id
        ):
            raise HTTPException(status_code=403, detail="Only the DML author can delete this DML.")
        if str(dml.get("DML_STATUS") or "").upper() == "EXECUTED":
            raise HTTPException(status_code=409, detail="Executed DML cannot be deleted.")
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_DML_DELETE"),
            {"editDmlId": edit_dml_id},
        )
        if cursor.rowcount != 1:
            raise HTTPException(status_code=409, detail="DML could not be deleted in its current status.")
        _event(
            cursor,
            edit_session_id=edit_session_id,
            event_type="DML_DELETED",
            entity_type="EDIT_DML",
            entity_id=edit_dml_id,
            summary=f"DML deleted: {dml.get('DML_NAME') or edit_dml_id}.",
            user_id=user_id,
            detail={
                "dmlName": dml.get("DML_NAME"),
                "dmlStatus": dml.get("DML_STATUS"),
            },
        )
        conn.commit()
        return {"status": "success", "editDmlId": edit_dml_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def approve_dml(request: Request, edit_dml_id: int) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        dml = _fetch_one(cursor, "MCOMMON_EDIT_DML_SELECT_FOR_UPDATE", {"editDmlId": edit_dml_id})
        if not dml:
            raise HTTPException(status_code=404, detail="Registered DML was not found.")
        session = _select_session(cursor, int(dml["EDIT_SESSION_ID"]), request)
        _require_open_execution(session, "approve operational DML")
        if (
            get_request_role_code(request) != "ADMIN"
            and str(dml.get("CREATED_BY") or "") != user_id
        ):
            raise HTTPException(status_code=403, detail="Only the DML author can approve this DML.")
        if str(dml.get("DML_STATUS") or "") != "DRAFT":
            raise HTTPException(status_code=409, detail="Only draft DML can be approved.")
        message = _validate_registered_dml(
            cursor,
            str(dml.get("DML_SQL") or ""),
            session,
            int(dml["EDIT_SESSION_ID"]),
            parse_oracle=True,
        )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_DML_APPROVE"),
            {"editDmlId": edit_dml_id, "validationMessage": message, "approvedBy": user_id},
        )
        _event(
            cursor,
            edit_session_id=int(dml["EDIT_SESSION_ID"]),
            event_type="DML_APPROVED",
            entity_type="EDIT_DML",
            entity_id=edit_dml_id,
            summary=message,
            user_id=user_id,
        )
        conn.commit()
        return {"status": "success", "editDmlId": edit_dml_id, "validationMessage": message}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def execute_dml(request: Request, edit_dml_id: int) -> dict[str, Any]:
    user_id = _get_user_text(request)
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    edit_session_id: int | None = None
    try:
        dml = _fetch_one(cursor, "MCOMMON_EDIT_DML_SELECT_FOR_UPDATE", {"editDmlId": edit_dml_id})
        if not dml:
            raise HTTPException(status_code=404, detail="Registered DML was not found.")
        edit_session_id = int(dml["EDIT_SESSION_ID"])
        session = _select_session(cursor, edit_session_id, request)
        _require_open_execution(session, "execute operational DML")
        if (
            get_request_role_code(request) != "ADMIN"
            and str(dml.get("CREATED_BY") or "") != user_id
        ):
            raise HTTPException(status_code=403, detail="Only the DML author can execute this DML.")
        if str(dml.get("DML_STATUS") or "").upper() == "EXECUTED":
            raise HTTPException(status_code=409, detail="Executed DML cannot be executed again.")
        _validate_registered_dml(
            cursor,
            str(dml.get("DML_SQL") or ""),
            session,
            edit_session_id,
            parse_oracle=True,
        )
        validation = _fetch_one(
            cursor,
            "MCOMMON_EDIT_VALIDATION_SUMMARY",
            {"editSessionId": edit_session_id},
        ) or {}
        affected = int(validation.get("CHANGED_ROW_COUNT") or 0)
        if affected <= 0:
            raise HTTPException(
                status_code=409,
                detail="No applied editing rows are available for operational DML execution.",
            )
        cursor.execute(str(dml["DML_SQL"]))
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_DML_EXECUTION_RESULT"),
            {
                "editDmlId": edit_dml_id,
                "dmlStatus": "EXECUTED",
                "executedBy": user_id,
                "affectedRowCount": affected,
                "executionMessage": f"Operational DML committed for {affected} editing row(s).",
            },
        )
        cursor.execute(
            SqlLoader.get_sql("MCOMMON_EDIT_SESSION_STATUS"),
            {"sessionStatus": "APPLIED", "editSessionId": edit_session_id},
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Editing execution status could not be closed after DML execution.")
        _event(
            cursor,
            edit_session_id=edit_session_id,
            event_type="DML_EXECUTED",
            entity_type="EDIT_DML",
            entity_id=edit_dml_id,
            summary=f"Operational DML committed and editing execution closed: {affected} row(s).",
            user_id=user_id,
            detail={"affectedRowCount": affected},
        )
        conn.commit()
        return {
            "status": "success",
            "editDmlId": edit_dml_id,
            "editExecutionId": edit_session_id,
            "affectedRowCount": affected,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        try:
            cursor.execute(
                SqlLoader.get_sql("MCOMMON_EDIT_DML_EXECUTION_RESULT"),
                {
                    "editDmlId": edit_dml_id,
                    "dmlStatus": "FAILED",
                    "executedBy": user_id,
                    "affectedRowCount": 0,
                    "executionMessage": _normalize_text(str(exc), 4000),
                },
            )
            if edit_session_id:
                _event(
                    cursor,
                    edit_session_id=edit_session_id,
                    event_type="DML_FAILED",
                    entity_type="EDIT_DML",
                    entity_id=edit_dml_id,
                    summary="Final operational apply failed.",
                    user_id=user_id,
                    detail={"error": str(exc)},
                )
            conn.commit()
        except Exception:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Final apply failed: {exc}")
    finally:
        cursor.close()
        conn.close()


def list_history(
    request: Request,
    *,
    edit_session_id: int | None,
    project_id: int | None,
    event_type: str = "ALL",
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    cursor = conn.cursor()
    try:
        if project_id:
            project_id = _require_project_access(cursor, request, project_id)
        if edit_session_id:
            _select_session(cursor, edit_session_id, request)
        rows = _fetch_limited(
            cursor,
            "MCOMMON_EDIT_EVENT_LIST",
            {
                "editSessionId": edit_session_id,
                "projectId": project_id,
                "eventType": _normalize_text(event_type, 40, "ALL").upper(),
                "includeAllUsers": (
                    "Y"
                    if edit_session_id or project_id or get_request_role_code(request) == "ADMIN"
                    else "N"
                ),
                "userId": _get_user_text(request),
            },
            5000,
        )
        return {"status": "success", "data": rows, "total": len(rows), "limited": len(rows) >= 5000}
    finally:
        cursor.close()
        conn.close()
