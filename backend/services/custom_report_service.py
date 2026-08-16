from __future__ import annotations

import html
import json
import logging
import re
import threading
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import oracledb
from fastapi import HTTPException, Request

from backend.auth_context import get_request_user_id
from backend.database_helper import SqlLoader
from backend.target_database import get_target_db_connection
from backend.services.report_fonts import REPORT_FONT_FAMILY, embedded_korean_font_css
from backend.services.report_i18n import normalize_report_language
from backend.services.structured_report_service import (
    REPORT_BY_CODE,
    REPORT_CATALOG,
    REPORT_PROVIDER,
    build_batch_report_document,
    get_report_context,
    json_compatible,
    list_projects as list_basic_projects,
)


logger = logging.getLogger(__name__)

_CUSTOM_REPORT_TEXT = {
    "ko": {
        "detail": "상세", "overflowWarning": "배치 높이보다 내용이 많아 레이아웃에는 요약을 표시하고 전체 내용은 다운로드 부록에 제공합니다.",
        "missingWarning": "현재 선택 기준에 생성되지 않은 저장 블록이 있습니다.", "noData": "표시할 데이터가 없습니다.",
        "paragraphCount": "문단 {count:,}개", "tableCount": "데이터 {rows:,}건 · 컬럼 {columns:,}개",
        "appendixProvided": "부록 제공", "appendixNote": "전체 상세 내용은 문서 뒤쪽의 상세 데이터 부록에서 제공합니다.",
        "emptyLayout": "배치된 보고서가 없습니다.", "appendix": "상세 데이터 부록",
        "appendixDescription": "배치 영역에 모두 표시하기 어려운 블록의 전체 내용을 저장된 순서대로 제공합니다.",
        "allScenarios": "전체 시나리오", "customReport": "맞춤형 보고서", "project": "프로젝트", "scenario": "시나리오",
        "flowRunId": "Flow Run ID", "editingSessionId": "에디팅 세션 ID", "paper": "용지", "orientation": "방향", "generatedAt": "생성 시각",
    },
    "en": {
        "detail": "Details", "overflowWarning": "The content exceeds the placed height, so the layout shows a summary and the download includes the full appendix.",
        "missingWarning": "Some saved blocks are unavailable for the current selection.", "noData": "No data to display.",
        "paragraphCount": "{count:,} paragraphs", "tableCount": "{rows:,} rows · {columns:,} columns",
        "appendixProvided": "Appendix included", "appendixNote": "Full details are provided in the data appendix at the end of this document.",
        "emptyLayout": "No reports have been placed.", "appendix": "Detailed data appendix",
        "appendixDescription": "Provides the full content of blocks that do not fit in the layout, in the saved order.",
        "allScenarios": "All scenarios", "customReport": "Custom Report", "project": "Project", "scenario": "Scenario",
        "flowRunId": "Flow Run ID", "editingSessionId": "Editing session ID", "paper": "Paper", "orientation": "Orientation", "generatedAt": "Generated at",
    },
}


def _custom_labels(language: str | None) -> dict[str, str]:
    return _CUSTOM_REPORT_TEXT[normalize_report_language(language)]

_TEMPLATE_TABLE_READY = False
_TEMPLATE_TABLE_LOCK = threading.Lock()

CUSTOM_REPORT_SCHEMA_VERSION = "1.0"
MAX_LAYOUT_BYTES = 128 * 1024
MAX_LAYOUT_DEPTH = 6
MAX_REPORT_ITEMS = len(REPORT_CATALOG)
MAX_BLOCK_KEYS = 64
PAGE_GRID_ROWS = 36
MAX_SECTION_BLOCKS = 32
_REPORT_CODES = frozenset(REPORT_BY_CODE)
_INSTANCE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_HTML_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_PROHIBITED_KEYS = frozenset({"__proto__", "prototype", "constructor"})
_LAYOUT_KEYS = frozenset({"schemaVersion", "items"})
_ITEM_KEYS = frozenset(
    {
        "instanceId",
        "reportCode",
        "order",
        "x",
        "y",
        "w",
        "h",
        "blockOrder",
        "hiddenBlocks",
    }
)


_REPORT_KPI_CODES: dict[str, frozenset[str]] = {
    "R01": frozenset({"TARGET_TABLES", "FLOW_RUNS", "FINAL_RULES", "EDIT_CHANGES"}),
    "R02": frozenset({"FLOW_COUNT", "CURRENT_NODE_COUNT", "SNAPSHOT_NODE_COUNT", "NODE_SUCCESS_RATE"}),
    "R03": frozenset({"FLOW_RUN_COUNT", "FLOW_SUCCESS_RATE", "EDIT_SESSION_COUNT", "ACTIVE_SESSION_COUNT"}),
    "R04": frozenset({"TARGET_TABLE_COUNT", "EDIT_READY_COUNT", "EDIT_READY_RATE"}),
    "R05": frozenset({"COLUMN_COUNT", "CATEGORICAL_COUNT", "CONTINUOUS_COUNT", "AVG_NULL_RATIO"}),
    "R06": frozenset({"RELATION_COLUMN_COUNT", "SELECTED_COLUMN_COUNT", "PASS_PAIR_RATE"}),
    "R07": frozenset({"CLUSTER_COUNT", "NETWORK_NODE_COUNT", "MAX_CENTRALITY"}),
    "R08": frozenset({"ASSOCIATION_RULE_COUNT", "AVG_CONFIDENCE", "AVG_LIFT"}),
    "R09": frozenset({"LASSO_FEATURE_COUNT", "SELECTED_FEATURE_COUNT", "TARGET_COUNT"}),
    "R10": frozenset({"SYMBOLIC_RULE_COUNT", "SELECTED_RULE_COUNT", "TARGET_COUNT"}),
    "R11": frozenset({"VIOLATION_COUNT", "ASSOCIATION_VIOLATION_COUNT", "SYMBOLIC_VIOLATION_COUNT"}),
    "R12": frozenset(
        {"TOTAL_RULE_COUNT", "PENDING_RULE_COUNT", "SELECTED_RULE_COUNT", "REJECTED_RULE_COUNT", "SELECTION_RATE"}
    ),
    "R13": frozenset({"FINAL_RULE_COUNT", "USER_RULE_COUNT", "DISCOVERED_RULE_COUNT"}),
    "R14": frozenset({"EDIT_TABLE_COUNT", "EDIT_SESSION_COUNT", "SOURCE_ROW_COUNT"}),
    "R15": frozenset({"CHANGE_COUNT", "APPLIED_CHANGE_COUNT", "EXPECTED_MATCH_RATE"}),
    "R16": frozenset({"CHANGE_COUNT", "APPLIED_CHANGE_COUNT", "EXPECTED_MATCH_RATE"}),
    "R17": frozenset(
        {
            "SOURCE_VIOLATION_COUNT",
            "EDIT_VIOLATION_COUNT",
            "VIOLATION_REDUCTION_COUNT",
            "VIOLATION_REDUCTION_RATE",
            "EXPECTED_MATCH_RATE",
            "APPLIED_CHANGE_COUNT",
            "CHANGED_ROW_COUNT",
        }
    ),
    "R18": frozenset({"DML_COUNT", "EXECUTED_DML_COUNT", "AFFECTED_ROW_COUNT"}),
    "R19": frozenset({"AUDIT_EVENT_COUNT", "EVENT_TYPE_COUNT", "EVENT_USER_COUNT"}),
    "R20": frozenset(
        {"SCENARIO_COUNT", "MATCHED_CONTEXT_COUNT", "TOTAL_RULE_COUNT", "FINAL_RULE_COUNT", "APPLIED_CHANGE_COUNT"}
    ),
    "R21": frozenset(
        {
            "STATISTICS_COLUMN_COUNT",
            "HIGH_PRIORITY_COLUMN_COUNT",
            "VIOLATION_COLUMN_COUNT",
            "TOTAL_VIOLATION_COUNT",
            "DECREASED_VARIANCE_COLUMN_COUNT",
            "INCREASED_VARIANCE_COLUMN_COUNT",
        }
    ),
}

def _read_lob(value: Any) -> Any:
    return value.read() if hasattr(value, "read") else value


def _db_value(value: Any) -> Any:
    value = _read_lob(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def _row_dict(cursor, row: Any) -> dict[str, Any]:
    columns = [column[0] for column in cursor.description or []]
    return {column: _db_value(value) for column, value in zip(columns, row)}


def _require_plain_dict(value: Any, detail: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail=detail)
    return value


def _check_structure(value: Any, *, depth: int = 0) -> None:
    if depth > MAX_LAYOUT_DEPTH:
        raise HTTPException(status_code=422, detail="Layout nesting is too deep.")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or key in _PROHIBITED_KEYS:
                raise HTTPException(status_code=422, detail="Layout contains a prohibited object key.")
            _check_structure(child, depth=depth + 1)
    elif isinstance(value, list):
        for child in value:
            _check_structure(child, depth=depth + 1)


def _int_field(item: dict[str, Any], key: str, minimum: int, maximum: int, default: int) -> int:
    value = item.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise HTTPException(status_code=422, detail=f"Layout item {key} must be an integer from {minimum} to {maximum}.")
    return value


def _allowed_block_keys(report_code: str) -> frozenset[str]:
    keys = {f"kpi:{code}" for code in _REPORT_KPI_CODES[report_code]}
    # Section order is the stable contract exposed by M06001. Keep a bounded
    # forward-compatible range so a newly added section does not invalidate an
    # already saved reusable template; missing keys are reported by preview.
    keys.update(f"section:{index}" for index in range(MAX_SECTION_BLOCKS))
    return frozenset(keys)


def _normalize_block_keys(value: Any, *, report_code: str, field_name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_BLOCK_KEYS:
        raise HTTPException(status_code=422, detail=f"{field_name} must contain at most {MAX_BLOCK_KEYS} block keys.")
    allowed = _allowed_block_keys(report_code)
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_key in value:
        if not isinstance(raw_key, str):
            raise HTTPException(status_code=422, detail=f"{field_name} contains an invalid block key.")
        key = raw_key.strip()
        if key not in allowed:
            raise HTTPException(status_code=422, detail=f"Block key '{key[:80]}' is not valid for {report_code}.")
        if key in seen:
            raise HTTPException(status_code=422, detail=f"{field_name} contains a duplicate block key.")
        seen.add(key)
        normalized.append(key)
    return normalized


def validate_layout(layout: Any) -> dict[str, Any]:
    """Validate and canonicalize the reusable, Target-scoped project-independent layout JSON."""
    layout = _require_plain_dict(layout, "Layout must be an object.")
    try:
        raw_size = len(json.dumps(layout, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError, RecursionError) as error:
        raise HTTPException(status_code=422, detail="Layout must contain JSON-compatible values.") from error
    if raw_size > MAX_LAYOUT_BYTES:
        raise HTTPException(status_code=413, detail="Custom Reports layout is too large.")
    _check_structure(layout)
    unknown_layout_keys = set(layout) - _LAYOUT_KEYS
    if unknown_layout_keys:
        raise HTTPException(status_code=422, detail="Layout contains unsupported fields.")
    requested_version = str(layout.get("schemaVersion") or CUSTOM_REPORT_SCHEMA_VERSION).strip()
    if requested_version != CUSTOM_REPORT_SCHEMA_VERSION:
        raise HTTPException(status_code=422, detail="Unsupported Custom Reports layout schema version.")

    items = layout.get("items", [])
    if not isinstance(items, list) or len(items) > MAX_REPORT_ITEMS:
        raise HTTPException(status_code=422, detail=f"Layout can contain at most {MAX_REPORT_ITEMS} reports.")

    normalized_items: list[dict[str, Any]] = []
    instance_ids: set[str] = set()
    report_codes: set[str] = set()
    page_rectangles: dict[int, list[tuple[int, int, int, int, str]]] = {}
    for index, raw_item in enumerate(items):
        item = _require_plain_dict(raw_item, "Each layout item must be an object.")
        if set(item) - _ITEM_KEYS:
            raise HTTPException(status_code=422, detail="Layout item contains unsupported fields.")
        instance_id = str(item.get("instanceId") or "").strip()
        if not _INSTANCE_ID_PATTERN.fullmatch(instance_id):
            raise HTTPException(status_code=422, detail="Layout item instanceId is invalid.")
        if instance_id in instance_ids:
            raise HTTPException(status_code=422, detail="Layout item instanceId must be unique.")

        report_code = str(item.get("reportCode") or "").strip().upper()
        if report_code not in _REPORT_CODES:
            raise HTTPException(status_code=422, detail="Layout can only contain report codes R01 through R21.")
        if report_code in report_codes:
            raise HTTPException(status_code=422, detail="Each report code can be placed only once.")

        order = _int_field(item, "order", 0, 9999, index)
        x = _int_field(item, "x", 0, 11, 0)
        y = _int_field(item, "y", 0, 9999, index * 8)
        width = _int_field(item, "w", 1, 12, 12)
        height = _int_field(item, "h", 5, PAGE_GRID_ROWS, 8)
        if x + width > 12:
            raise HTTPException(status_code=422, detail="Layout item x + w must not exceed the 12-column page grid.")
        if (y % PAGE_GRID_ROWS) + height > PAGE_GRID_ROWS:
            raise HTTPException(status_code=422, detail="Layout item must fit within one 36-row report page.")
        page_index = y // PAGE_GRID_ROWS
        local_y = y % PAGE_GRID_ROWS
        for other_x, other_y, other_width, other_height, other_id in page_rectangles.get(page_index, []):
            overlaps = (
                x < other_x + other_width
                and x + width > other_x
                and local_y < other_y + other_height
                and local_y + height > other_y
            )
            if overlaps:
                raise HTTPException(
                    status_code=422,
                    detail=f"Layout items '{other_id}' and '{instance_id}' overlap on the same report page.",
                )

        normalized_items.append(
            {
                "instanceId": instance_id,
                "reportCode": report_code,
                "order": order,
                "x": x,
                "y": y,
                "w": width,
                "h": height,
                "blockOrder": _normalize_block_keys(
                    item.get("blockOrder"), report_code=report_code, field_name="blockOrder"
                ),
                "hiddenBlocks": _normalize_block_keys(
                    item.get("hiddenBlocks"), report_code=report_code, field_name="hiddenBlocks"
                ),
            }
        )
        instance_ids.add(instance_id)
        report_codes.add(report_code)
        page_rectangles.setdefault(page_index, []).append((x, local_y, width, height, instance_id))

    normalized_items.sort(key=lambda item: (item["order"], item["y"], item["x"], item["instanceId"]))
    normalized = {"schemaVersion": CUSTOM_REPORT_SCHEMA_VERSION, "items": normalized_items}
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_LAYOUT_BYTES:
        raise HTTPException(status_code=413, detail="Custom Reports layout is too large.")
    return normalized


def normalize_template_payload(payload: dict[str, Any], *, allow_empty_layout: bool = False) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Template name is required.")
    if len(name) > 200:
        raise HTTPException(status_code=422, detail="Template name must be 200 characters or fewer.")
    description = str(payload.get("description") or "").strip()
    if len(description) > 1000:
        raise HTTPException(status_code=422, detail="Template description must be 1000 characters or fewer.")
    paper_size = str(payload.get("paperSize") or "A4").strip().upper()
    orientation = str(payload.get("orientation") or "PORTRAIT").strip().upper()
    if paper_size not in {"A4", "A3"}:
        raise HTTPException(status_code=422, detail="Paper size must be A4 or A3.")
    if orientation not in {"PORTRAIT", "LANDSCAPE"}:
        raise HTTPException(status_code=422, detail="Orientation must be PORTRAIT or LANDSCAPE.")
    layout = validate_layout(payload.get("layout"))
    if not allow_empty_layout and not layout["items"]:
        raise HTTPException(status_code=422, detail="A saved Custom Reports template must contain at least one report.")
    return {
        "name": name,
        "description": description,
        "paperSize": paper_size,
        "orientation": orientation,
        "layout": layout,
        "schemaVersion": CUSTOM_REPORT_SCHEMA_VERSION,
        "reportCount": len(layout["items"]),
    }


def _template_from_row(row: dict[str, Any], *, include_layout: bool) -> dict[str, Any]:
    result = {
        "templateId": int(row.get("TEMPLATE_ID") or 0),
        "name": str(row.get("TEMPLATE_NAME") or ""),
        "description": str(row.get("TEMPLATE_DESC") or ""),
        "paperSize": str(row.get("PAPER_SIZE") or "A4").upper(),
        "orientation": str(row.get("ORIENTATION") or "PORTRAIT").upper(),
        "reportCount": int(row.get("REPORT_COUNT") or 0),
        "schemaVersion": str(row.get("SCHEMA_VERSION") or CUSTOM_REPORT_SCHEMA_VERSION),
        "version": int(row.get("TEMPLATE_VERSION") or 1),
        "createdAt": row.get("CREATED_AT"),
        "updatedAt": row.get("UPDATED_AT"),
    }
    if include_layout:
        try:
            raw_layout = _read_lob(row.get("LAYOUT_JSON")) or "{}"
            parsed_layout = json.loads(str(raw_layout))
            result["layout"] = validate_layout(parsed_layout)
        except HTTPException:
            logger.error("Stored custom report layout failed validation. template_id=%s", result["templateId"])
            raise HTTPException(status_code=500, detail="The stored Custom Reports layout is invalid.")
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            logger.error("Stored custom report layout is not valid JSON. template_id=%s", result["templateId"])
            raise HTTPException(status_code=500, detail="The stored Custom Reports layout is invalid.") from error
    return result


def _fetch_template(cursor, *, user_id: int, template_id: int) -> dict[str, Any] | None:
    cursor.execute(
        SqlLoader.get_sql("M06002_TEMPLATE_DETAIL"),
        {"userId": user_id, "templateId": template_id},
    )
    row = cursor.fetchone()
    return _row_dict(cursor, row) if row else None


def _ensure_template_table(conn) -> None:
    """Create the M06002-owned template store once when an installation first uses it."""
    global _TEMPLATE_TABLE_READY
    if _TEMPLATE_TABLE_READY:
        return

    cursor = None
    with _TEMPLATE_TABLE_LOCK:
        if _TEMPLATE_TABLE_READY:
            return
        try:
            cursor = conn.cursor()
            cursor.execute(SqlLoader.get_sql("M06002_TEMPLATE_ENSURE_TABLE"))
            _TEMPLATE_TABLE_READY = True
        finally:
            if cursor:
                cursor.close()


def _record_template_usage(
    cursor,
    *,
    user_id: int,
    project_id: int,
    scenario_id: int | None,
    template_id: int,
) -> None:
    cursor.execute(
        SqlLoader.get_sql("M06002_TEMPLATE_USAGE_MERGE"),
        {
            "userId": user_id,
            "projectId": project_id,
            "scenarioId": scenario_id,
            "templateId": template_id,
        },
    )


def _register_template_usage(
    request: Request,
    *,
    template_id: int,
    project_id: int,
    scenario_id: int | None,
) -> None:
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        _ensure_template_table(conn)
        cursor = conn.cursor()
        _record_template_usage(
            cursor,
            user_id=user_id,
            project_id=project_id,
            scenario_id=scenario_id,
            template_id=template_id,
        )
        conn.commit()
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def list_custom_report_projects(
    request: Request,
    *,
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    result = list_basic_projects(
        request,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )
    projects = result.get("data") or []
    if not projects:
        return result

    user_id = get_request_user_id(request)
    project_ids = ",".join(
        str(int(project.get("PROJECT_ID") or project.get("projectId") or 0))
        for project in projects
        if int(project.get("PROJECT_ID") or project.get("projectId") or 0) > 0
    )
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        _ensure_template_table(conn)
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("M06002_PROJECT_REPORT_USAGE_LIST"),
            {
                "userId": user_id,
                "projectIds": project_ids,
            },
        )
        usage_by_project: dict[int, list[dict[str, Any]]] = {}
        for raw_row in cursor.fetchall():
            row = _row_dict(cursor, raw_row)
            project_id = int(row.get("PROJECT_ID") or 0)
            if project_id:
                usage_by_project.setdefault(project_id, []).append(row)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

    for project in projects:
        project_id = int(project.get("PROJECT_ID") or project.get("projectId") or 0)
        usage_rows = usage_by_project.get(project_id, [])
        project["CUSTOM_REPORT_COUNT"] = len(usage_rows)
        project["CUSTOM_REPORT_GENERATION_COUNT"] = sum(int(row.get("USE_COUNT") or 0) for row in usage_rows)
        project["LAST_CUSTOM_REPORT_AT"] = usage_rows[0].get("LAST_USED_AT") if usage_rows else None
        project["CUSTOM_REPORTS"] = [
            {
                "templateId": int(row.get("TEMPLATE_ID") or 0),
                "name": str(row.get("TEMPLATE_NAME") or ""),
                "paperSize": str(row.get("PAPER_SIZE") or "A4"),
                "orientation": str(row.get("ORIENTATION") or "PORTRAIT"),
                "reportCount": int(row.get("REPORT_COUNT") or 0),
                "scenarioId": row.get("LAST_SCENARIO_ID"),
                "generationCount": int(row.get("USE_COUNT") or 0),
                "lastGeneratedAt": row.get("LAST_USED_AT"),
            }
            for row in usage_rows[:3]
        ]
    return result


def list_templates(request: Request) -> dict[str, Any]:
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        _ensure_template_table(conn)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M06002_TEMPLATE_LIST"), {"userId": user_id})
        rows = [_template_from_row(_row_dict(cursor, row), include_layout=False) for row in cursor.fetchall()]
        return {"status": "success", "data": rows, "total": len(rows)}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def get_template(request: Request, template_id: int) -> dict[str, Any]:
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        _ensure_template_table(conn)
        cursor = conn.cursor()
        row = _fetch_template(cursor, user_id=user_id, template_id=template_id)
        if not row:
            raise HTTPException(status_code=404, detail="The Custom Reports template was not found.")
        return _template_from_row(row, include_layout=True)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def save_template(
    request: Request,
    payload: dict[str, Any],
    *,
    template_id: int | None = None,
    expected_version: int | None = None,
    project_id: int | None = None,
    scenario_id: int | None = None,
) -> dict[str, Any]:
    user_id = get_request_user_id(request)
    if project_id is not None:
        get_report_context(request, project_id=project_id, scenario_id=scenario_id)
    normalized = normalize_template_payload(payload)
    layout_json = json.dumps(normalized["layout"], ensure_ascii=False, separators=(",", ":"))
    params = {
        "userId": user_id,
        "templateName": normalized["name"],
        "templateDesc": normalized["description"],
        "paperSize": normalized["paperSize"],
        "orientation": normalized["orientation"],
        "layoutJson": layout_json,
        "reportCount": normalized["reportCount"],
        "schemaVersion": normalized["schemaVersion"],
    }
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        _ensure_template_table(conn)
        cursor = conn.cursor()
        cursor.setinputsizes(layoutJson=oracledb.DB_TYPE_CLOB)
        if template_id is None:
            template_id_out = cursor.var(int)
            cursor.execute(
                SqlLoader.get_sql("M06002_TEMPLATE_INSERT"),
                {**params, "templateIdOut": template_id_out},
            )
            value = template_id_out.getvalue()
            template_id = int(value[0] if isinstance(value, list) else value)
        else:
            cursor.execute(
                SqlLoader.get_sql("M06002_TEMPLATE_UPDATE"),
                {
                    **params,
                    "templateId": template_id,
                    "expectedVersion": expected_version,
                },
            )
            if cursor.rowcount == 0:
                existing = _fetch_template(cursor, user_id=user_id, template_id=template_id)
                if existing and expected_version is not None:
                    raise HTTPException(status_code=409, detail="The Custom Reports template was changed by another request.")
                raise HTTPException(status_code=404, detail="The Custom Reports template was not found.")
        if project_id is not None:
            _record_template_usage(
                cursor,
                user_id=user_id,
                project_id=project_id,
                scenario_id=scenario_id,
                template_id=template_id,
            )
        conn.commit()
        saved = _fetch_template(cursor, user_id=user_id, template_id=template_id)
        if not saved:
            raise HTTPException(status_code=500, detail="The saved Custom Reports template could not be loaded.")
        return _template_from_row(saved, include_layout=True)
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def delete_template(request: Request, template_id: int) -> int:
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        _ensure_template_table(conn)
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("M06002_TEMPLATE_DELETE"),
            {"userId": user_id, "templateId": template_id},
        )
        deleted_count = int(cursor.rowcount or 0)
        if not deleted_count:
            raise HTTPException(status_code=404, detail="The Custom Reports template was not found.")
        conn.commit()
        return deleted_count
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _block_entries(document: dict[str, Any], *, include_data: bool) -> list[dict[str, Any]]:
    labels = _custom_labels(document.get("language"))
    blocks: list[dict[str, Any]] = []
    for index, kpi in enumerate(document.get("kpis") or []):
        key = f"kpi:{str(kpi.get('code') or index).strip().upper()}"
        block = {
            "key": key,
            "type": "kpi",
            "title": str(kpi.get("label") or kpi.get("code") or "KPI"),
            "defaultOrder": index,
        }
        if include_data:
            block["data"] = json_compatible(kpi)
        blocks.append(block)
    kpi_count = len(blocks)
    for index, section in enumerate(document.get("sections") or []):
        block = {
            "key": f"section:{index}",
            "type": "section",
            "title": str(section.get("title") or f'{labels["detail"]} {index + 1}'),
            "defaultOrder": kpi_count + index,
        }
        if include_data:
            block["data"] = json_compatible(section)
        blocks.append(block)
    return blocks


def _estimate_required_grid_rows(blocks: list[dict[str, Any]]) -> int:
    """Conservative layout-height estimate used for UX warnings and safe downloads."""
    required = 3  # report heading
    for block in blocks:
        data = block.get("data") or {}
        if block.get("type") == "kpi":
            required += 3
        elif data.get("type") == "text":
            paragraphs = data.get("paragraphs") or []
            required += 3 + max(1, len(paragraphs)) * 2
        else:
            rows = data.get("rows") or []
            columns = data.get("columns") or []
            # Wrapped cells can consume more than one visual row. This estimate
            # intentionally errs high so a full-data appendix is not omitted.
            required += 4 + len(rows) * (2 if len(columns) > 8 else 1)
    return required


def get_designer_catalog(
    request: Request,
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
    language: str = "ko",
) -> dict[str, Any]:
    bundle = build_batch_report_document(
        request,
        project_id=project_id,
        scenario_id=scenario_id,
        flow_run_id=flow_run_id,
        edit_session_id=edit_session_id,
        language=language,
    )
    reports = []
    for index, document in enumerate(bundle.get("reports") or []):
        report = document.get("report") or {}
        report_code = str(report.get("code") or "").strip().upper()
        availability = json_compatible(document.get("availability") or {})
        reports.append(
            {
                **json_compatible(report),
                "order": index,
                "availability": str(availability.get("status") or "NO_DATA").upper(),
                "availabilityReason": availability.get("reason"),
                "dataCount": availability.get("dataCount"),
                "availabilityDetail": availability,
                "blocks": _block_entries(document, include_data=False),
                "allowedBlockKeys": sorted(_allowed_block_keys(report_code)),
                "defaultPlacement": {
                    "x": 0 if report_code == "R21" else (index % 2) * 6,
                    "y": (index // 2) * 8,
                    "w": 12 if report_code == "R21" else 6,
                    "h": 20 if report_code == "R21" else 8,
                },
            }
        )
    return {
        "status": "success",
        "data": reports,
        "context": json_compatible(bundle.get("context") or {}),
        "total": len(reports),
        "schemaVersion": CUSTOM_REPORT_SCHEMA_VERSION,
    }


def _public_template(template: dict[str, Any]) -> dict[str, Any]:
    return {
        key: json_compatible(value)
        for key, value in template.items()
        if key
        in {
            "templateId",
            "name",
            "description",
            "paperSize",
            "orientation",
            "reportCount",
            "schemaVersion",
            "version",
            "createdAt",
            "updatedAt",
            "layout",
        }
    }


def build_custom_preview(
    request: Request,
    template: dict[str, Any],
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
    allow_empty_layout: bool = False,
    language: str = "ko",
) -> dict[str, Any]:
    labels = _custom_labels(language)
    normalized = normalize_template_payload(template, allow_empty_layout=allow_empty_layout)
    for key in ("templateId", "version", "createdAt", "updatedAt"):
        if template.get(key) is not None:
            normalized[key] = template[key]

    bundle = build_batch_report_document(
        request,
        project_id=project_id,
        scenario_id=scenario_id,
        flow_run_id=flow_run_id,
        edit_session_id=edit_session_id,
        language=language,
    )
    documents = {
        str((document.get("report") or {}).get("code") or "").upper(): document
        for document in bundle.get("reports") or []
    }
    preview_items: list[dict[str, Any]] = []
    preview_warnings: list[dict[str, Any]] = []
    for placement in normalized["layout"]["items"]:
        document = documents.get(placement["reportCode"])
        if not document:
            continue
        blocks = _block_entries(document, include_data=True)
        blocks_by_key = {block["key"]: block for block in blocks}
        requested_order = [key for key in placement["blockOrder"] if key in blocks_by_key]
        requested_order.extend(key for key in blocks_by_key if key not in requested_order)
        hidden = set(placement["hiddenBlocks"])
        ordered_blocks = [blocks_by_key[key] for key in requested_order if key not in hidden]
        missing_blocks = [
            key
            for key in (*placement["blockOrder"], *placement["hiddenBlocks"])
            if key not in blocks_by_key
        ]
        required_grid_rows = _estimate_required_grid_rows(ordered_blocks)
        overflow_risk = required_grid_rows > placement["h"]
        item_warnings: list[str] = []
        if overflow_risk:
            item_warnings.append(labels["overflowWarning"])
        if missing_blocks:
            item_warnings.append(labels["missingWarning"])
        if item_warnings:
            preview_warnings.append(
                {
                    "instanceId": placement["instanceId"],
                    "reportCode": placement["reportCode"],
                    "messages": item_warnings,
                }
            )
        preview_items.append(
            {
                **placement,
                "report": json_compatible(document.get("report") or {}),
                "availability": json_compatible(document.get("availability") or {}),
                "blocks": ordered_blocks,
                "missingBlocks": list(dict.fromkeys(missing_blocks)),
                "requiredGridRows": required_grid_rows,
                "overflowRisk": overflow_risk,
                "warnings": item_warnings,
            }
        )

    width_mm, height_mm = (210, 297) if normalized["paperSize"] == "A4" else (297, 420)
    if normalized["orientation"] == "LANDSCAPE":
        width_mm, height_mm = height_mm, width_mm
    return {
        "template": _public_template(normalized),
        "page": {
            "size": normalized["paperSize"],
            "orientation": normalized["orientation"],
            "widthMm": width_mm,
            "heightMm": height_mm,
            "gridColumns": 12,
        },
        "provider": json_compatible(bundle.get("provider") or REPORT_PROVIDER),
        "context": json_compatible(bundle.get("context") or {}),
        "generatedAt": (bundle.get("bundle") or {}).get("generatedAt"),
        "items": preview_items,
        "warnings": preview_warnings,
        "downloads": ["html", "pdf"],
        "language": bundle.get("language") or language,
    }


def build_saved_custom_preview(
    request: Request,
    template_id: int,
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
    record_usage: bool = False,
    language: str = "ko",
) -> dict[str, Any]:
    template = get_template(request, template_id)
    preview = build_custom_preview(
        request,
        template,
        project_id=project_id,
        scenario_id=scenario_id,
        flow_run_id=flow_run_id,
        edit_session_id=edit_session_id,
        language=language,
    )
    if record_usage:
        _register_template_usage(
            request,
            template_id=template_id,
            project_id=project_id,
            scenario_id=scenario_id,
        )
    return preview


def _text(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


def _escape(value: Any) -> str:
    return html.escape(_HTML_CONTROL_CHARACTERS.sub("", _text(value)), quote=True)


def _render_preview_block(block: dict[str, Any], labels: dict[str, str]) -> str:
    data = block.get("data") or {}
    if block.get("type") == "kpi":
        value = data.get("value")
        if data.get("unit") == "RATE" and value is not None:
            try:
                value = f"{float(value) * 100:,.2f}%"
            except (TypeError, ValueError):
                pass
        return (
            '<section class="block kpi-block">'
            f'<span class="kpi-label">{_escape(data.get("label") or block.get("title"))}</span>'
            f'<strong class="kpi-value">{_escape(value)}</strong>'
            "</section>"
        )

    title = _escape(data.get("title") or block.get("title"))
    description = (
        f'<p class="section-description">{_escape(data.get("description"))}</p>'
        if data.get("description")
        else ""
    )
    if data.get("type") == "text":
        body = "".join(f"<p>{_escape(paragraph)}</p>" for paragraph in data.get("paragraphs") or [])
    else:
        columns = data.get("columns") or []
        rows = data.get("rows") or []
        headers = "".join(
            f'<th scope="col">{_escape(column.get("label") or column.get("key"))}</th>' for column in columns
        )
        rendered_rows = []
        for row in rows:
            cells = "".join(
                f'<td data-label="{_escape(column.get("label") or column.get("key"))}">'
                f'{_escape(row.get(column.get("key")))}</td>'
                for column in columns
            )
            rendered_rows.append(f"<tr>{cells}</tr>")
        body = (
            f'<div class="table-wrap" data-column-count="{len(columns)}"><table><thead><tr>{headers}</tr></thead>'
            f'<tbody>{"".join(rendered_rows)}</tbody></table></div>'
            if rows
            else f'<div class="empty">{_escape(labels["noData"])}</div>'
        )
    note = f'<p class="section-note">{_escape(data.get("note"))}</p>' if data.get("note") else ""
    return f'<section class="block detail-block"><h3>{title}</h3>{description}{body}{note}</section>'


def _render_compact_preview_block(block: dict[str, Any], labels: dict[str, str]) -> str:
    if block.get("type") == "kpi":
        return _render_preview_block(block, labels)
    data = block.get("data") or {}
    title = _escape(data.get("title") or block.get("title"))
    if data.get("type") == "text":
        detail = labels["paragraphCount"].format(count=len(data.get("paragraphs") or []))
    else:
        detail = labels["tableCount"].format(rows=len(data.get("rows") or []), columns=len(data.get("columns") or []))
    return (
        '<section class="block compact-block">'
        f"<h3>{title}</h3><p>{_escape(detail)}</p>"
        "</section>"
    )


def render_custom_preview_html(preview: dict[str, Any], *, embed_fonts: bool = False) -> bytes:
    language = normalize_report_language(preview.get("language"))
    labels = _custom_labels(language)
    font_css = embedded_korean_font_css() if embed_fonts else ""
    template = preview.get("template") or {}
    page = preview.get("page") or {}
    provider = preview.get("provider") or REPORT_PROVIDER
    context = preview.get("context") or {}
    selection = context.get("selection") or {}
    project = context.get("project") or {}
    scenario = context.get("scenario") or {}
    paper_size = str(page.get("size") or "A4").upper()
    orientation = str(page.get("orientation") or "PORTRAIT").lower()
    page_width_mm = int(page.get("widthMm") or (297 if orientation == "landscape" else 210))
    page_height_mm = int(page.get("heightMm") or (210 if orientation == "landscape" else 297))
    cards_by_page: dict[int, list[str]] = {}
    appendix_cards: list[str] = []
    for item in preview.get("items") or []:
        report = item.get("report") or {}
        availability = item.get("availability") or {}
        item_blocks = item.get("blocks") or []
        overflow_risk = bool(item.get("overflowRisk"))
        status_label = str(availability.get("label") or availability.get("status") or "")
        if overflow_risk:
            status_label = f'{status_label} · {labels["appendixProvided"]}' if status_label else labels["appendixProvided"]
        blocks = "".join(
            (_render_compact_preview_block(block, labels) if overflow_risk else _render_preview_block(block, labels))
            for block in item_blocks
        )
        if overflow_risk:
            blocks += f'<p class="overflow-note">{_escape(labels["appendixNote"])}</p>'
            appendix_cards.append(
                '<article class="appendix-card">'
                '<header class="appendix-card-header">'
                f'<span>{_escape(report.get("code"))}</span><h2>{_escape(report.get("title"))}</h2>'
                f'<small>{_escape(availability.get("label") or availability.get("status"))}</small></header>'
                f'{"".join(_render_preview_block(block, labels) for block in item_blocks)}</article>'
            )
        global_y = max(0, int(item.get("y", 0)))
        page_index = global_y // PAGE_GRID_ROWS
        local_y = global_y % PAGE_GRID_ROWS
        card = (
            '<article class="report-card" '
            f'style="grid-column:{int(item.get("x", 0)) + 1} / span {int(item.get("w", 12))}; '
            f'grid-row:{local_y + 1} / span {max(1, int(item.get("h", 8)))}">'
            '<header class="report-card-header">'
            f'<span>{_escape(report.get("code"))}</span><h2>{_escape(report.get("title"))}</h2>'
            f'<small>{_escape(status_label)}</small></header>{blocks}</article>'
        )
        cards_by_page.setdefault(page_index, []).append(card)
    if not cards_by_page:
        cards_by_page[0] = [f'<div class="empty-layout">{_escape(labels["emptyLayout"])}</div>']
    last_page_index = max(cards_by_page)
    report_pages = "".join(
        f'<section class="report-page" data-page="{page_index + 1}">'
        f'{"".join(cards_by_page.get(page_index) or [])}<span class="page-number">{page_index + 1}</span></section>'
        for page_index in range(last_page_index + 1)
    )
    appendix = (
        f'<section class="appendix"><header class="appendix-header"><h2>{_escape(labels["appendix"])}</h2>'
        f'<p>{_escape(labels["appendixDescription"])}</p></header>'
        f'{"".join(appendix_cards)}</section>'
        if appendix_cards
        else ""
    )
    project_name = project.get("PROJECT_NAME") or project.get("PROJECT_CODE") or "-"
    scenario_name = scenario.get("SCENARIO_NAME") or scenario.get("SCENARIO_CODE") or labels["allScenarios"]
    result = f'''<!doctype html>
<html lang="{_escape(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
  <title>{_escape(template.get("name") or labels["customReport"])}</title>
  <style>
    {font_css}
    @page {{ size: {paper_size} {orientation}; margin: 9mm; }}
    :root {{ --ink:#172033; --muted:#64748b; --line:#d8e2ef; --brand:#174a87; --soft:#f4f7fb; }}
    * {{ box-sizing:border-box; min-width:0; }}
    body {{ margin:0; color:var(--ink); background:#edf2f7; font-family:"{REPORT_FONT_FAMILY}","Noto Sans KR","Malgun Gothic",sans-serif; line-height:1.45; overflow-x:hidden; }}
    .document {{ width:min(1480px,calc(100% - 28px)); margin:20px auto; }}
    .cover {{ width:min(100%,{page_width_mm}mm); min-height:min(calc(100vh - 40px),{page_height_mm}mm); margin:0 auto 18px; padding:28px; background:#fff; }}
    .document-header {{ padding-bottom:18px; border-bottom:3px solid var(--brand); }}
    .brand {{ color:var(--brand); font-size:12px; font-weight:900; letter-spacing:.1em; }}
    h1 {{ margin:5px 0 6px; font-size:27px; overflow-wrap:anywhere; }}
    .provider {{ margin:0; color:var(--muted); font-size:11px; }}
    .meta {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:16px 0 22px; }}
    .meta div {{ padding:10px; border-radius:8px; background:var(--soft); font-size:10px; overflow-wrap:anywhere; }}
    .meta span {{ display:block; color:var(--muted); font-weight:700; }}
    .report-pages {{ width:100%; }}
    .report-page {{ position:relative; display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); grid-template-rows:repeat({PAGE_GRID_ROWS},minmax(0,1fr)); gap:2mm; width:min(100%,{page_width_mm}mm); aspect-ratio:{page_width_mm}/{page_height_mm}; margin:0 auto 18px; padding:6mm; overflow:hidden; background:#fff; box-shadow:0 8px 30px rgba(15,23,42,.12); }}
    .report-card {{ padding:14px; border:1px solid var(--line); border-radius:10px; background:#fff; break-inside:avoid; overflow:hidden; }}
    .report-card-header {{ display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:8px; align-items:center; padding-bottom:9px; border-bottom:2px solid #dbeafe; }}
    .report-card-header span,.report-card-header small {{ color:var(--brand); font-size:9px; font-weight:900; }}
    h2 {{ margin:0; font-size:14px; overflow-wrap:anywhere; }}
    .block {{ margin-top:10px; break-inside:avoid; }}
    .kpi-block {{ display:flex; justify-content:space-between; gap:8px; padding:9px; border-radius:8px; background:var(--soft); }}
    .kpi-label {{ color:var(--muted); font-size:9px; font-weight:700; }}
    .kpi-value {{ font-size:14px; overflow-wrap:anywhere; }}
    h3 {{ margin:0 0 7px; padding-left:7px; border-left:3px solid var(--brand); font-size:11px; }}
    .section-description,.section-note,.detail-block p {{ font-size:8px; overflow-wrap:anywhere; }}
    .section-description {{ color:var(--muted); }} .section-note {{ padding:6px; background:#fff7ed; color:#9a3412; }}
    .compact-block {{ padding:6px 8px; border:1px solid var(--line); border-radius:6px; }} .compact-block h3 {{ margin-bottom:3px; }} .compact-block p {{ margin:0; color:var(--muted); font-size:8px; }}
    .overflow-note {{ margin:8px 0 0; padding:7px; border-radius:6px; background:#fff7ed; color:#9a3412; font-size:8px; font-weight:700; }}
    .table-wrap {{ width:100%; overflow:visible; border:1px solid var(--line); border-radius:6px; }}
    table {{ width:100%; border-collapse:collapse; table-layout:fixed; font-size:7px; }}
    th,td {{ padding:4px; border-bottom:1px solid var(--line); vertical-align:top; text-align:left; white-space:normal; overflow-wrap:anywhere; word-break:break-word; }}
    th {{ background:#eff5fb; }} .empty {{ padding:12px; color:var(--muted); text-align:center; font-size:8px; }}
    .page-number {{ position:absolute; right:5mm; bottom:2mm; color:var(--muted); font-size:7px; }}
    .empty-layout {{ grid-column:1 / -1; grid-row:1 / -1; display:grid; place-items:center; color:var(--muted); font-size:12px; }}
    .appendix {{ width:min(100%,{page_width_mm}mm); margin:0 auto; padding:8mm; background:#fff; }}
    .appendix-header {{ padding-bottom:10px; border-bottom:3px solid var(--brand); break-after:avoid; }} .appendix-header h2 {{ font-size:20px; }} .appendix-header p {{ color:var(--muted); font-size:10px; }}
    .appendix-card {{ margin:18px 0 28px; padding-top:8px; border-top:1px solid var(--line); break-before:page; }}
    .appendix-card:first-of-type {{ break-before:auto; }}
    .appendix-card-header {{ display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:8px; align-items:center; }}
    .appendix-card-header span,.appendix-card-header small {{ color:var(--brand); font-size:9px; font-weight:900; }}
    .appendix-card .block {{ break-inside:auto; }} .appendix-card thead {{ display:table-header-group; }} .appendix-card tr {{ break-inside:avoid; }}
    @media (max-width:800px) {{
      .document {{ width:100%; margin:0; padding:0; }} .cover {{ width:100%; min-height:0; margin:0; padding:16px; }} .meta {{ grid-template-columns:1fr 1fr; }}
      .report-page {{ display:block; width:100%; aspect-ratio:auto; margin:0; padding:16px; box-shadow:none; overflow:visible; }} .report-card {{ margin-bottom:12px; min-height:0 !important; }} .appendix {{ width:100%; padding:16px; }}
      .table-wrap[data-column-count] {{ border:0; }}
      .table-wrap[data-column-count] table,.table-wrap[data-column-count] tbody,.table-wrap[data-column-count] tr,.table-wrap[data-column-count] td {{ display:block; width:100%; }}
      .table-wrap[data-column-count] thead {{ position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }}
      .table-wrap[data-column-count] tbody {{ display:grid; gap:6px; }}
      .table-wrap[data-column-count] tr {{ border:1px solid var(--line); border-radius:6px; overflow:hidden; }}
      .table-wrap[data-column-count] td {{ display:grid; grid-template-columns:minmax(90px,34%) minmax(0,1fr); gap:7px; border:0; border-bottom:1px solid var(--line); font-size:8px; }}
      .table-wrap[data-column-count] td::before {{ content:attr(data-label); color:var(--muted); font-weight:800; }}
    }}
    @media (max-width:420px) {{ .meta {{ grid-template-columns:1fr; }} .table-wrap[data-column-count] td {{ grid-template-columns:1fr; }} }}
    @media print {{
      body {{ background:#fff; }} .document {{ width:100%; margin:0; padding:0; }}
      .cover {{ width:100%; height:calc({page_height_mm}mm - 18mm); min-height:0; margin:0; padding:0; break-after:page; page-break-after:always; }}
      .report-page {{ width:100%; height:calc({page_height_mm}mm - 18mm); aspect-ratio:auto; margin:0; padding:0; gap:2mm; box-shadow:none; break-after:page; page-break-after:always; }}
      .report-page:last-child {{ break-after:auto; page-break-after:auto; }} .report-card {{ box-shadow:none; }}
      .appendix {{ width:100%; margin:0; padding:0; break-before:page; page-break-before:always; }}
    }}
  </style>
</head>
<body>
  <main class="document">
    <section class="cover">
      <header class="document-header"><div class="brand">{_escape(provider.get("name") or "IN-DEPS")}</div><h1>{_escape(template.get("name") or labels["customReport"])}</h1><p class="provider">{_escape(provider.get("statement"))}</p></header>
      <section class="meta">
        <div><span>{_escape(labels["project"])}</span>{_escape(project_name)}</div><div><span>{_escape(labels["scenario"])}</span>{_escape(scenario_name)}</div>
        <div><span>{_escape(labels["flowRunId"])}</span>{_escape(selection.get("flowRunId"))}</div><div><span>{_escape(labels["editingSessionId"])}</span>{_escape(selection.get("editSessionId"))}</div>
        <div><span>{_escape(labels["paper"])}</span>{_escape(paper_size)}</div><div><span>{_escape(labels["orientation"])}</span>{_escape(orientation.upper())}</div>
        <div><span>{_escape(labels["generatedAt"])}</span>{_escape(preview.get("generatedAt"))}</div>
      </section>
    </section>
    <section class="report-pages">{report_pages}</section>
    {appendix}
  </main>
</body>
</html>'''
    return result.encode("utf-8")
