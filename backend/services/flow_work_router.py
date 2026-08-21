"""
Factory for reusable flow-work routers.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Any, Dict, Optional
from datetime import date, datetime
from decimal import Decimal
import hashlib
import logging
import re
import threading
import time

from backend.database_helper import execute_query
from backend.auth_context import get_request_role_code, get_request_user_id
from backend.target_database import get_target_connection_id, get_target_db_connection, get_target_db_connection_by_id
from backend.services import data_work_service as data_work
from backend.services import edit_work_service as edit_work
from backend.services import flow_work_service as flow_work
from backend.services import work_context_service
from backend.services.background_jobs import BackgroundJobQueueFull, submit_background_job
from backend.services.flow_work_service import FlowNodeRunRequest, FlowRunRequest, FlowWorkRequest
from backend.paging import create_page_window, normalize_page_number, normalize_page_size
from backend.runtime_settings import apply_server_resource_limits

logger = logging.getLogger(__name__)


class FlowResultSqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    page: Optional[int] = 1


class SavedFlowRunRequest(BaseModel):
    flowId: int
    projectId: int
    scenarioId: int
    batch: Optional[bool] = False
    requestToken: Optional[str] = None
    quickEditSummary: Optional[Dict[str, Any]] = None


def normalize_quick_edit_summary(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict) or str(value.get("source") or "").strip().upper() != "QUICK_EDIT":
        return {}

    def text_value(key: str, maximum: int) -> str:
        return str(value.get(key) or "").strip()[:maximum]

    def int_value(key: str) -> Optional[int]:
        try:
            normalized = int(value.get(key))
            return normalized if normalized >= 0 else None
        except (TypeError, ValueError):
            return None

    return {
        "version": 1,
        "source": "QUICK_EDIT",
        "projectCode": text_value("projectCode", 100),
        "projectName": text_value("projectName", 200),
        "scenarioCode": text_value("scenarioCode", 100),
        "scenarioName": text_value("scenarioName", 200),
        "scenarioTableId": int_value("scenarioTableId"),
        "ownerName": text_value("ownerName", 128).upper(),
        "tableName": text_value("tableName", 128).upper(),
        "editOwnerName": text_value("editOwnerName", 128).upper(),
        "editTableName": text_value("editTableName", 128).upper(),
        "fileName": text_value("fileName", 255),
        "fileSize": int_value("fileSize"),
        "estimatedRowCount": int_value("estimatedRowCount"),
        "flowName": text_value("flowName", 200),
        "jobCount": int_value("jobCount"),
    }


MODEL_DETAIL_VIEW_TYPES = [
    ("VA", "Attribute/detail view"),
    ("VG", "Global/detail view"),
    ("VI", "Itemset/detail view"),
    ("VN", "Node/detail view"),
    ("VP", "Pattern/partition/detail view"),
    ("VR", "Rule/detail view"),
    ("VT", "Transformation/detail view")
]
def quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def quote_sql_literal(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def normalize_select_sql(sql: str) -> str:
    text = (sql or "").strip()
    text = re.sub(r";+\s*$", "", text)
    if not re.match(r"(?is)^(select|with)\b", text):
        raise HTTPException(status_code=400, detail="Only SELECT statements are allowed.")
    if re.search(r";\s*\S", sql or ""):
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec)\b"
    if re.search(blocked, text, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only read-only SELECT statements are allowed.")
    return text


def build_table_result_sql(
    owner: str,
    table_name: str,
    available_columns: set[str] | None = None,
    target_owner: str = "",
    target_table: str = "",
    run_source_type: str = "",
    run_id: Optional[int] = None,
    flow_node_run_id: Optional[int] = None,
    edit_session_id: Optional[int] = None,
    node_key: str = "",
    model_name: str = "",
    api_object_name: str = "",
) -> str:
    sql = f"SELECT *\n  FROM {quote_identifier(owner)}.{quote_identifier(table_name)}"
    columns = {str(column or "").strip().upper() for column in (available_columns or set())}
    clauses: list[str] = []

    def add_text(column: str, value: str, uppercase: bool = True) -> None:
        text_value = str(value or "").strip()
        is_unresolved_runtime_value = bool(
            re.fullmatch(r":[A-Za-z][A-Za-z0-9_$#]*", text_value)
            or re.fullmatch(r"/\*\s*--\s*[A-Za-z][A-Za-z0-9_$#]*\s*--\s*\*/", text_value)
            or re.fullmatch(r"\$\{[^{}]+\}", text_value)
            or re.fullmatch(r"\{\{[^{}]+\}\}", text_value)
        )
        if column in columns and text_value and not is_unresolved_runtime_value:
            normalized_value = text_value.upper() if uppercase else text_value
            clauses.append(
                f"{quote_identifier(column)} = {quote_sql_literal(normalized_value)}"
            )

    def add_number(column: str, value: Optional[int]) -> None:
        if column in columns and value is not None:
            clauses.append(f"{quote_identifier(column)} = {int(value)}")

    if "TARGET_OWNER" in columns:
        add_text("TARGET_OWNER", target_owner)
    else:
        add_text("OWNER", target_owner)
        add_text("OWNER_NAME", target_owner)
    if "TARGET_TABLE" in columns:
        add_text("TARGET_TABLE", target_table)
    else:
        add_text("TABLE_NAME", target_table)
    add_text("RUN_SOURCE_TYPE", run_source_type)
    add_text("SOURCE_RUN_SOURCE_TYPE", run_source_type)
    add_number("RUN_ID", run_id)
    add_number("SOURCE_RUN_ID", run_id)
    add_number("FLOW_RUN_ID", run_id)
    add_number("FLOW_NODE_RUN_ID", flow_node_run_id)
    add_number("EDIT_SESSION_ID", edit_session_id)
    add_text("NODE_KEY", node_key, uppercase=False)
    add_text("MODEL_NAME", model_name)
    add_text("API_OBJECT_NAME", api_object_name)
    add_text("RESULT_OWNER", owner)
    add_text("RESULT_TABLE", table_name)
    add_text("RESULT_TABLE_NAME", table_name)
    if clauses:
        sql += "\n WHERE " + "\n   AND ".join(clauses)
    return sql


def build_model_detail_sql(conn, owner: str, model_name: str) -> tuple[str, list[Dict[str, Any]]]:
    view_names = [f"DM${view_type}{model_name}" for view_type, _ in MODEL_DETAIL_VIEW_TYPES]
    result = execute_query(conn, "DATA_WORK_MODEL_DETAIL_VIEW_LIST", {
        "owner": owner,
        "viewNameVa": view_names[0],
        "viewNameVg": view_names[1],
        "viewNameVi": view_names[2],
        "viewNameVn": view_names[3],
        "viewNameVp": view_names[4],
        "viewNameVr": view_names[5],
        "viewNameVt": view_names[6]
    })
    rows = data_work.require_success(result, "Model detail view query failed.").get("data", [])
    owner_prefix = quote_identifier(owner) + "."
    views = []
    lines = [
        "-- Existing Oracle ML model detail views only.",
        f"-- Model: {owner}.{model_name}",
        ""
    ]
    for row in rows:
        view_type = row.get("VIEW_TYPE") or ""
        view_name = row.get("VIEW_NAME") or ""
        description = row.get("DESCRIPTION") or ""
        object_type = row.get("OBJECT_TYPE")
        exists_yn = row.get("EXISTS_YN") or ("Y" if object_type else "N")
        views.append({
            "viewType": view_type,
            "viewName": view_name,
            "description": description,
            "objectType": object_type,
            "existsYn": exists_yn
        })
        if not object_type:
            continue
        lines.extend([
            f"-- {view_type} - {description}",
            "SELECT *",
            f"  FROM {owner_prefix}{quote_identifier(view_name)};",
            ""
        ])
    if not any(row.get("existsYn") == "Y" for row in views):
        lines.extend([
            "-- No DM$ detail views were found for this model yet.",
            "-- Check USER_MINING_MODELS and INIT$_SP_DM_MODEL_VIEW_LIST."
        ])
    return "\n".join(lines).strip(), views


def serialize_db_value(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "read"):
        return serialize_db_value(value.read())
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except Exception:
            return value.hex()
    if isinstance(value, (list, tuple)):
        return [serialize_db_value(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize_db_value(item) for key, item in value.items()}
    if hasattr(value, "aslist"):
        try:
            return serialize_db_value(value.aslist())
        except Exception:
            pass
    if hasattr(value, "asdict"):
        try:
            return serialize_db_value(value.asdict())
        except Exception:
            pass
    if hasattr(value, "__dict__") and not isinstance(value, (str, int, float, bool)):
        public_items = {
            key: item for key, item in vars(value).items()
            if not key.startswith("_")
        }
        if public_items:
            return serialize_db_value(public_items)
        return str(value)
    return value


def normalize_sql_result(result: Dict[str, Any]) -> Dict[str, Any]:
    result["data"] = [
        {key: serialize_db_value(value) for key, value in row.items()}
        for row in result.get("data", [])
    ]
    return result


def is_missing_flow_table_error(error: Exception) -> bool:
    text = str(error)
    return "ORA-00942" in text or "INIT$_TB_FLOW_WORK" in text and "does not exist" in text.lower()


def is_flow_lock_error(error: Exception) -> bool:
    text = str(error)
    if any(code in text for code in ("ORA-00054", "ORA-00060", "ORA-12860", "ORA-30006")):
        return True
    original = getattr(error, "original", None)
    return bool(original and is_flow_lock_error(original))


def get_flow_error_step(error: Exception) -> str:
    current = error
    while current:
        step = getattr(current, "step", "")
        if step:
            return step
        current = getattr(current, "__cause__", None) or getattr(current, "original", None)
    return "UNKNOWN_STEP"


def build_node_downstream_plan(plan: list[dict], selected_node_key: str) -> list[dict]:
    downstream_by_node: dict[str, set[str]] = {}
    for step in plan or []:
        node_key = str(step.get("nodeKey") or "")
        downstream_by_node.setdefault(node_key, set())
        for next_key in step.get("downstream") or []:
            downstream_by_node[node_key].add(str(next_key))

    selected = str(selected_node_key or "")
    reachable = set()
    stack = [selected] if selected else []
    while stack:
        node_key = stack.pop()
        if node_key in reachable:
            continue
        reachable.add(node_key)
        stack.extend(sorted(downstream_by_node.get(node_key, set()), reverse=True))
    return [step for step in plan or [] if str(step.get("nodeKey") or "") in reachable]


def create_flow_work_router(
    menu_code: str,
    sql_prefix: str,
    default_flow_group: Optional[str] = None,
    default_flow_type: Optional[str] = None,
    messages: Optional[Dict[str, str]] = None
) -> APIRouter:
    router = APIRouter()
    MENU_CODE = menu_code
    SQL_PREFIX = sql_prefix
    DEFAULT_FLOW_GROUP = default_flow_group or menu_code
    DEFAULT_FLOW_TYPE = default_flow_type or menu_code
    ROUTER_MESSAGES = {
        "flow_saved": "Flow saved.",
        "flow_valid": "Flow validation succeeded.",
        "run_done": "Flow queued for DAG execution.",
        "run_queued": "Flow queued for DAG execution.",
        **(messages or {})
    }
    save_locks: Dict[str, threading.Lock] = {}
    save_locks_guard = threading.Lock()
    save_lock_wait_seconds = 15

    def require_project_access_for_request(conn, request: Request, project_id: int) -> None:
        if get_request_role_code(request) == "ADMIN":
            return
        access = execute_query(conn, "M01002_PROJECT_OWNER_CHECK", {
            "projectId": project_id,
            "userId": get_request_user_id(request),
        })
        access_rows = access.get("data") or []
        if access.get("status") != "success" or not access_rows or int(access_rows[0].get("CNT") or 0) <= 0:
            raise HTTPException(status_code=404, detail="Project was not found.")

    def query_scenario_tables(conn, project_id: int, scenario_id: int) -> Dict[str, Any]:
        result = execute_query(conn, "FLOW_WORK_SCENARIO_TABLE_LIST", {
            "projectId": project_id,
            "scenarioId": scenario_id,
        })
        return data_work.require_success(result, "Scenario table query failed.")

    def query_flow_jobs(
        conn,
        project_id: int,
        scenario_id: int,
        menu_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        result = execute_query(conn, "FLOW_WORK_DATA_JOB_ASSET_LIST", {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "menuCode": menu_code,
        })
        for row in result.get("data") or []:
            row["PARAM_JSON"] = data_work.read_lob(row.get("PARAM_JSON"))
            row["EXEC_PLSQL"] = data_work.read_lob(row.get("EXEC_PLSQL"))
            row["EXEC_SPEC_JSON"] = data_work.read_lob(row.get("EXEC_SPEC_JSON"))
        return data_work.require_success(result, "Flow job asset query failed.")

    def query_node_types(
        conn,
        project_id: Optional[int] = None,
        scenario_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        result = execute_query(conn, f"{SQL_PREFIX}_FLOW_NODE_TYPE_LIST", {
            "projectId": project_id,
            "scenarioId": scenario_id,
        })
        return data_work.require_success(result, "Flow node type query failed.")

    def query_default_variables(conn) -> Dict[str, Any]:
        result = execute_query(conn, f"{SQL_PREFIX}_FLOW_DEFAULT_VARIABLE_LIST")
        return data_work.require_success(result, "Flow variable query failed.")

    def query_flows(conn, request: Request, project_id: int, scenario_id: int) -> Dict[str, Any]:
        require_project_access_for_request(conn, request, project_id)
        return flow_work.list_flows(conn, MENU_CODE, project_id, scenario_id)

    def query_flow(conn, request: Request, flow_id: int) -> Dict[str, Any]:
        flow = flow_work.load_flow(conn, MENU_CODE, flow_id)
        require_project_access_for_request(conn, request, int(flow.get("PROJECT_ID") or 0))
        return {"status": "success", "data": flow}

    def query_runs(
        conn,
        request: Request,
        project_id: int,
        scenario_id: int,
        flow_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        require_project_access_for_request(conn, request, project_id)
        return flow_work.list_runs(conn, MENU_CODE, project_id, scenario_id, flow_id)

    def build_run_snapshot_version(run_row: Dict[str, Any]) -> str:
        source = "|".join(
            str(run_row.get(key) or "")
            for key in (
                "FLOW_RUN_ID",
                "STATUS",
                "MESSAGE",
                "STARTED_AT",
                "FINISHED_AT",
                "NODE_UPDATED_AT",
            )
        )
        return hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]

    def normalize_run_request_token(value: Optional[str]) -> str:
        token = str(value or "").strip()
        if not token:
            return ""
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}", token):
            raise HTTPException(
                status_code=400,
                detail="requestToken must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen.",
            )
        return token

    def lock_flow_run_request_scope(
        conn,
        flow_id: int,
        project_id: int,
        scenario_id: int,
    ) -> None:
        result = execute_query(conn, "FLOW_WORK_RUN_SCOPE_LOCK", {
            "menuCode": MENU_CODE,
            "flowId": flow_id,
            "projectId": project_id,
            "scenarioId": scenario_id,
        })
        if result.get("status") != "success":
            detail = result.get("detail") or result.get("message") or "Flow run request lock failed."
            if is_flow_lock_error(Exception(detail)):
                raise HTTPException(
                    status_code=409,
                    detail="This flow is already being submitted. Retry with the same requestToken.",
                )
        rows = data_work.require_success(result, "Flow run request lock failed.").get("data") or []
        if not rows:
            raise HTTPException(status_code=404, detail="Flow was not found in the selected project and scenario.")

    def find_flow_run_by_request_token(conn, flow_id: int, request_token: str) -> Optional[Dict[str, Any]]:
        if not request_token:
            return None
        marker = f'"runRequestToken": "{request_token}"'
        result = execute_query(conn, "FLOW_WORK_RUN_BY_REQUEST_TOKEN", {
            "flowId": flow_id,
            "requestTokenMarker": marker,
        })
        rows = data_work.require_success(result, "Flow run request lookup failed.").get("data") or []
        if not rows:
            return None
        row = dict(rows[0])
        row["MESSAGE"] = data_work.read_lob(row.get("MESSAGE"))
        row["PLAN_JSON"] = data_work.read_lob(row.get("PLAN_JSON"))
        return row

    def build_idempotent_run_response(existing_run: Dict[str, Any], req: SavedFlowRunRequest) -> Dict[str, Any]:
        existing_run_type = str(existing_run.get("RUN_TYPE") or "MANUAL").upper()
        requested_run_type = "QUICK_EDIT" if normalize_quick_edit_summary(req.quickEditSummary) else ("BATCH" if req.batch else "MANUAL")
        if requested_run_type == "QUICK_EDIT" and existing_run_type == "MANUAL":
            requested_run_type = existing_run_type
        if existing_run_type != requested_run_type:
            raise HTTPException(
                status_code=409,
                detail="requestToken was already used with a different run mode.",
            )
        plan_data = flow_work.parse_json(existing_run.get("PLAN_JSON"), {})
        plan = plan_data.get("plan") if isinstance(plan_data, dict) else []
        runtime_overrides = plan_data.get("runtimeOverrides") if isinstance(plan_data, dict) else {}
        return {
            "status": "success",
            "message": "The existing flow execution was returned for this request token.",
            "data": {
                "flowId": int(existing_run.get("FLOW_ID") or req.flowId),
                "flowRunId": int(existing_run.get("FLOW_RUN_ID") or 0),
                "runType": existing_run_type,
                "runStatus": str(existing_run.get("STATUS") or "STARTED").upper(),
                "plan": plan if isinstance(plan, list) else [],
                "runtimeOverrides": runtime_overrides if isinstance(runtime_overrides, dict) else {},
                "idempotentReplay": True,
            },
        }

    def get_save_lock(req: FlowWorkRequest | SavedFlowRunRequest) -> threading.Lock:
        flow_key = f"FLOW:{req.flowId}" if req.flowId else "NEW"
        key = "|".join([
            MENU_CODE,
            str(req.projectId or ""),
            str(req.scenarioId or ""),
            flow_key
        ])
        with save_locks_guard:
            if key not in save_locks:
                save_locks[key] = threading.Lock()
            return save_locks[key]

    def save_flow_with_retry(conn, req: FlowWorkRequest) -> int:
        for attempt in range(3):
            try:
                return flow_work.save_flow(conn, MENU_CODE, req, DEFAULT_FLOW_GROUP, DEFAULT_FLOW_TYPE)
            except Exception as e:
                if attempt < 2 and is_flow_lock_error(e):
                    conn.rollback()
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise

    def mark_flow_submission_failed(
        conn,
        flow_run_id: int,
        selected_plan: list[dict],
        run_plan: Dict[str, Any],
        message: str,
    ) -> None:
        flow_work.update_run(conn, flow_run_id, "FAILED", message, run_plan)
        for step in selected_plan or []:
            node_key = str(step.get("nodeKey") or "").strip()
            if not node_key:
                continue
            flow_work.update_node_run_by_key(
                conn,
                flow_run_id,
                node_key,
                "FAILED",
                message,
                False,
                True,
            )
        conn.commit()

    @router.get("/bootstrap")
    def get_bootstrap(
        request: Request,
        preferredProjectId: Optional[int] = None,
        preferredScenarioId: Optional[int] = None,
        preferredFlowId: Optional[int] = None,
        includeHistory: bool = False,
    ):
        """Load the designer context through the same helpers as individual APIs."""
        conn = None
        try:
            conn = get_target_db_connection(request)
            user_id = get_request_user_id(request)
            include_all_users = get_request_role_code(request) == "ADMIN"
            projects = work_context_service.list_projects(
                conn,
                user_id=user_id,
                include_all_users=include_all_users,
            )
            active_projects = [
                row for row in projects.get("data") or []
                if str(row.get("USE_YN") or "") == "Y"
            ]
            selected_project_id = next(
                (
                    int(row.get("PROJECT_ID"))
                    for row in active_projects
                    if preferredProjectId is not None
                    and str(row.get("PROJECT_ID")) == str(preferredProjectId)
                ),
                None,
            )

            empty = {"status": "success", "data": [], "columns": [], "total": 0}
            scenarios = dict(empty)
            selected_scenario_id = None
            if selected_project_id is not None:
                scenarios = work_context_service.list_scenarios(
                    conn,
                    project_id=selected_project_id,
                    user_id=user_id,
                    include_all_users=include_all_users,
                )
                scenario_rows = scenarios.get("data") or []
                selected_scenario_id = next(
                    (
                        int(row.get("SCENARIO_ID"))
                        for row in scenario_rows
                        if preferredScenarioId is not None
                        and str(row.get("SCENARIO_ID")) == str(preferredScenarioId)
                    ),
                    int(scenario_rows[0].get("SCENARIO_ID")) if scenario_rows else None,
                )

            scenario_tables = dict(empty)
            jobs = dict(empty)
            flows = dict(empty)
            selected_flow = None
            history = None
            node_types = query_node_types(conn, selected_project_id, selected_scenario_id)
            default_variables = query_default_variables(conn)
            if selected_project_id is not None and selected_scenario_id is not None:
                scenario_tables = query_scenario_tables(conn, selected_project_id, selected_scenario_id)
                jobs = query_flow_jobs(conn, selected_project_id, selected_scenario_id)
                flows = query_flows(conn, request, selected_project_id, selected_scenario_id)
                flow_rows = flows.get("data") or []
                selected_flow_id = next(
                    (
                        int(row.get("FLOW_ID"))
                        for row in flow_rows
                        if preferredFlowId is not None
                        and str(row.get("FLOW_ID")) == str(preferredFlowId)
                    ),
                    int(flow_rows[0].get("FLOW_ID")) if flow_rows else None,
                )
                if selected_flow_id is not None:
                    selected_flow = query_flow(conn, request, selected_flow_id).get("data")
                if includeHistory:
                    history = query_runs(conn, request, selected_project_id, selected_scenario_id)

            return {
                "status": "success",
                "projects": projects,
                "scenarios": scenarios,
                "scenarioTables": scenario_tables,
                "nodeTypes": node_types,
                "jobs": jobs,
                "defaultVariables": default_variables,
                "flows": flows,
                "selectedFlow": selected_flow,
                "history": history,
                "selection": {
                    "projectId": selected_project_id,
                    "scenarioId": selected_scenario_id,
                    "flowId": selected_flow.get("FLOW_ID") if selected_flow else None,
                },
            }
        finally:
            if conn:
                conn.close()

    @router.get("/scenario-tables")
    def get_scenario_tables(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_scenario_tables(conn, projectId, scenarioId)
        finally:
            if conn:
                conn.close()

    @router.get("/assets/jobs")
    def get_flow_jobs(request: Request, projectId: int, scenarioId: int, menuCode: Optional[str] = None):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_flow_jobs(conn, projectId, scenarioId, menuCode)
        finally:
            if conn:
                conn.close()

    @router.get("/node-types")
    def get_node_types(request: Request, projectId: Optional[int] = None, scenarioId: Optional[int] = None):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_node_types(conn, projectId, scenarioId)
        finally:
            if conn:
                conn.close()

    @router.get("/default-variables")
    def get_default_variables(request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_default_variables(conn)
        finally:
            if conn:
                conn.close()

    @router.get("/executable-objects")
    def get_executable_objects(request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, "FLOW_WORK_EXECUTABLE_OBJECT_LIST")
            return data_work.require_success(result, "Executable object query failed.")
        finally:
            if conn:
                conn.close()

    @router.get("/executable-object/{object_id}/parameters")
    def get_executable_object_parameters(object_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, "FLOW_WORK_EXECUTABLE_OBJECT_DETAIL", {"objectId": object_id})
            return data_work.require_success(result, "Object parameter query failed.")
        finally:
            if conn:
                conn.close()

    @router.get("/flows")
    def get_flows(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_flows(conn, request, projectId, scenarioId)
        finally:
            if conn:
                conn.close()

    @router.get("/import-flows")
    def get_importable_flows(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return flow_work.list_importable_flows(
                conn,
                MENU_CODE,
                projectId,
                scenarioId,
                get_request_user_id(request),
                get_request_role_code(request) == "ADMIN",
            )
        finally:
            if conn:
                conn.close()

    @router.get("/import-flows/{flow_id}")
    def get_importable_flow(flow_id: int, request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            flow = flow_work.load_importable_flow(
                conn,
                MENU_CODE,
                flow_id,
                projectId,
                scenarioId,
                get_request_user_id(request),
                get_request_role_code(request) == "ADMIN",
            )
            return {"status": "success", "data": flow}
        finally:
            if conn:
                conn.close()

    @router.get("/flow/{flow_id}")
    def get_flow(flow_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_flow(conn, request, flow_id)
        finally:
            if conn:
                conn.close()

    @router.post("/flow/save")
    def save_flow(req: FlowWorkRequest, request: Request):
        conn = None
        save_lock = get_save_lock(req)
        if not save_lock.acquire(timeout=save_lock_wait_seconds):
            raise HTTPException(
                status_code=409,
                detail="This flow is still being saved. Please wait a moment and try again.\n이 Flow 저장이 아직 진행 중입니다. 잠시 후 다시 저장해 주세요."
            )
        try:
            conn = get_target_db_connection(request)
            require_project_access_for_request(conn, request, data_work.require_int(req.projectId, "projectId"))
            flow_id = save_flow_with_retry(conn, req)
            conn.commit()
            save_lock.release()
            save_lock = None
            flow = flow_work.load_flow(conn, MENU_CODE, flow_id)
            flows = flow_work.list_flows(conn, MENU_CODE, flow["PROJECT_ID"], flow["SCENARIO_ID"]).get("data", [])
            return {
                "status": "success",
                "message": ROUTER_MESSAGES["flow_saved"],
                "data": flow,
                "list": flows
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            if is_missing_flow_table_error(e):
                raise HTTPException(
                    status_code=500,
                    detail="Flow storage tables are not installed in the target DB. Run database/INIT_TARGET_DDL.sql first."
                )
            if is_flow_lock_error(e):
                step = get_flow_error_step(e)
                logger.warning(f"{MENU_CODE} flow save lock conflict at {step}: {str(e)}")
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Flow save hit a database row lock at {step}. This is a DB transaction/lock conflict, not invalid flow data. Please wait a moment and save again.\n"
                        f"{step} 단계에서 DB row lock 충돌이 발생했습니다. Flow 데이터 값 오류가 아니라 DB 트랜잭션/락 충돌입니다. 잠시 후 다시 저장해 주세요."
                    )
                )
            logger.error(f"{MENU_CODE} flow save failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
            if save_lock:
                save_lock.release()

    @router.delete("/flow/{flow_id}")
    def delete_flow(flow_id: int, request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            require_project_access_for_request(conn, request, projectId)
            flow_work.delete_flow(conn, MENU_CODE, flow_id, projectId, scenarioId)
            conn.commit()
            flows = flow_work.list_flows(conn, MENU_CODE, projectId, scenarioId).get("data", [])
            return {
                "status": "success",
                "message": "Flow deleted.",
                "data": {"flowId": flow_id},
                "list": flows
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            if is_missing_flow_table_error(e):
                raise HTTPException(
                    status_code=500,
                    detail="Flow storage tables are not installed in the target DB. Run database/INIT_TARGET_DDL.sql first."
                )
            logger.error(f"{MENU_CODE} flow delete failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()

    @router.post("/flow/validate")
    def validate_flow(req: FlowWorkRequest):
        nodes, edges = flow_work.normalize_graph(req.nodes, req.edges)
        result = flow_work.validate_graph(nodes, edges)
        if result["status"] != "success":
            raise HTTPException(status_code=400, detail=result["message"])
        return {
            "status": "success",
            "message": ROUTER_MESSAGES["flow_valid"],
            "data": result
        }

    def queue_flow_run(
        conn,
        req: FlowRunRequest,
        request: Request,
        flow_id: int,
        nodes: list[dict],
        edges: list[dict],
        request_token: str = "",
        quick_edit_summary: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        validation = flow_work.validate_graph(nodes, edges)
        if validation["status"] != "success":
            raise HTTPException(status_code=400, detail=validation["message"])
        if request_token:
            validation["runRequestToken"] = request_token
            for step in validation.get("plan") or []:
                if isinstance(step, dict):
                    step["runRequestToken"] = request_token
        runtime_overrides = flow_work.normalize_editing_runtime_overrides(req.runtimeOverrides)
        if runtime_overrides:
            edit_work.validate_flow_runtime_context(
                conn,
                request,
                runtime_overrides,
                project_id=req.projectId,
                scenario_id=req.scenarioId,
            )
            validation["runtimeOverrides"] = runtime_overrides

        if quick_edit_summary:
            validation["quickEditSummary"] = quick_edit_summary
        run_type = "QUICK_EDIT" if quick_edit_summary else ("BATCH" if req.batch else "MANUAL")
        run_status = "QUEUED" if req.batch else "STARTED"
        message = ROUTER_MESSAGES["run_queued"] if req.batch else "Flow execution started."
        payload_manual_run_id = flow_work.parse_manual_run_id(req.manualRunId)
        plan_manual_run_id = flow_work.extract_manual_run_id_from_plan(validation.get("plan", []))
        if payload_manual_run_id and plan_manual_run_id and payload_manual_run_id != plan_manual_run_id:
            raise HTTPException(status_code=400, detail="Manual flow run id values must match.")
        manual_run_id = payload_manual_run_id or plan_manual_run_id
        run_id = flow_work.create_run(conn, flow_id, run_type, run_status, message, validation, manual_run_id)
        flow_work.create_node_run_records(conn, run_id, flow_id, validation.get("plan", []))
        target_connection_id = get_target_connection_id(request)
        user_id = get_request_user_id(request)
        persisted_run_context = {
            "plan": validation.get("plan", []),
            **({"quickEditSummary": quick_edit_summary} if quick_edit_summary else {}),
        }
        conn.commit()
        try:
            submit_background_job(
                f"{MENU_CODE} flow_run_id={run_id}",
                run_flow_background,
                run_id,
                target_connection_id,
                user_id,
                validation.get("plan", []),
                runtime_overrides,
                "Flow batch execution started." if req.batch else "Flow execution started.",
                quick_edit_summary,
            )
        except BackgroundJobQueueFull as queue_error:
            mark_flow_submission_failed(
                conn,
                run_id,
                validation.get("plan", []),
                persisted_run_context,
                str(queue_error),
            )
            raise HTTPException(status_code=503, detail=str(queue_error))
        except Exception as submit_error:
            mark_flow_submission_failed(
                conn,
                run_id,
                validation.get("plan", []),
                persisted_run_context,
                f"Background flow submission failed: {submit_error}",
            )
            logger.exception("%s background flow submission failed.", MENU_CODE)
            raise HTTPException(status_code=500, detail="Background flow submission failed.")
        return {
            "status": "success",
            "message": message,
            "data": {
                "flowId": flow_id,
                "flowRunId": run_id,
                "runType": run_type,
                "runStatus": run_status,
                "plan": validation.get("plan", []),
                "runtimeOverrides": runtime_overrides,
                "idempotentReplay": False,
            },
        }

    @router.post("/flow/run")
    def run_flow(req: FlowRunRequest, request: Request):
        conn = None
        save_lock = get_save_lock(req)
        if not save_lock.acquire(timeout=save_lock_wait_seconds):
            raise HTTPException(
                status_code=409,
                detail="This flow is still being saved or queued. Please wait a moment and try again.\n이 Flow 저장 또는 실행 대기열 등록이 아직 진행 중입니다. 잠시 후 다시 시도해 주세요."
            )
        try:
            conn = get_target_db_connection(request)
            require_project_access_for_request(conn, request, data_work.require_int(req.projectId, "projectId"))
            flow_id = save_flow_with_retry(conn, req)

            nodes, edges = flow_work.normalize_graph(req.nodes, req.edges)
            response = queue_flow_run(conn, req, request, flow_id, nodes, edges)
            save_lock.release()
            save_lock = None
            return response
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            if is_missing_flow_table_error(e):
                raise HTTPException(
                    status_code=500,
                    detail="Flow storage tables are not installed in the target DB. Run database/INIT_TARGET_DDL.sql first."
                )
            if is_flow_lock_error(e):
                step = get_flow_error_step(e)
                logger.warning(f"{MENU_CODE} flow run lock conflict at {step}: {str(e)}")
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Flow run hit a database row lock at {step}. This is a DB transaction/lock conflict, not invalid flow data. Please wait a moment and run again.\n"
                        f"{step} 단계에서 DB row lock 충돌이 발생했습니다. Flow 데이터 값 오류가 아니라 DB 트랜잭션/락 충돌입니다. 잠시 후 다시 실행해 주세요."
                    )
                )
            logger.error(f"{MENU_CODE} flow run failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
            if save_lock:
                save_lock.release()

    @router.post("/flow/run-saved")
    def run_saved_flow(req: SavedFlowRunRequest, request: Request):
        """Execute the server-side saved graph after verifying project ownership."""
        conn = None
        saved_lock = None
        request_token = normalize_run_request_token(req.requestToken)
        try:
            conn = get_target_db_connection(request)
            require_project_access_for_request(conn, request, req.projectId)
            saved_lock = get_save_lock(req)
            if not saved_lock.acquire(timeout=save_lock_wait_seconds):
                raise HTTPException(
                    status_code=409,
                    detail="This flow is still being saved or queued. Please wait a moment and try again.",
                )

            if request_token:
                lock_flow_run_request_scope(conn, req.flowId, req.projectId, req.scenarioId)
                existing_run = find_flow_run_by_request_token(conn, req.flowId, request_token)
                if existing_run:
                    response = build_idempotent_run_response(existing_run, req)
                    conn.rollback()
                    saved_lock.release()
                    saved_lock = None
                    return response

            saved_flow = flow_work.load_flow(conn, MENU_CODE, req.flowId)
            if (
                int(saved_flow.get("PROJECT_ID") or 0) != int(req.projectId)
                or int(saved_flow.get("SCENARIO_ID") or 0) != int(req.scenarioId)
            ):
                raise HTTPException(status_code=404, detail="Flow was not found in the selected project and scenario.")

            graph = saved_flow.get("GRAPH") if isinstance(saved_flow.get("GRAPH"), dict) else {}
            if isinstance(graph.get("nodes"), list) and isinstance(graph.get("edges"), list):
                nodes = graph["nodes"]
                edges = graph["edges"]
            else:
                nodes = saved_flow.get("NODES") or []
                edges = saved_flow.get("EDGES") or []
            saved_request = FlowRunRequest(
                flowId=int(saved_flow.get("FLOW_ID") or req.flowId),
                projectId=int(saved_flow.get("PROJECT_ID") or req.projectId),
                scenarioId=int(saved_flow.get("SCENARIO_ID") or req.scenarioId),
                flowGroup=saved_flow.get("FLOW_GROUP") or DEFAULT_FLOW_GROUP,
                flowName=saved_flow.get("FLOW_NAME") or "Saved flow",
                flowDesc=saved_flow.get("FLOW_DESC") or "",
                flowType=saved_flow.get("FLOW_TYPE") or DEFAULT_FLOW_TYPE,
                executionMode="DAG",
                useYn=saved_flow.get("USE_YN") or "Y",
                status=saved_flow.get("STATUS") or "DRAFT",
                nodes=nodes,
                edges=edges,
                batch=bool(req.batch),
                runtimeOverrides={},
            )
            normalized_nodes, normalized_edges = flow_work.normalize_graph(saved_request.nodes, saved_request.edges)
            quick_edit_summary = normalize_quick_edit_summary(req.quickEditSummary)
            if quick_edit_summary:
                quick_edit_summary.update({
                    "projectId": int(saved_flow.get("PROJECT_ID") or req.projectId),
                    "scenarioId": int(saved_flow.get("SCENARIO_ID") or req.scenarioId),
                    "flowId": int(saved_flow.get("FLOW_ID") or req.flowId),
                    "flowName": str(saved_flow.get("FLOW_NAME") or quick_edit_summary.get("flowName") or "")[:200],
                    "nodeCount": len(normalized_nodes),
                })
            response = queue_flow_run(
                conn,
                saved_request,
                request,
                int(saved_flow.get("FLOW_ID") or req.flowId),
                normalized_nodes,
                normalized_edges,
                request_token,
                quick_edit_summary,
            )
            saved_lock.release()
            saved_lock = None
            return response
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as error:
            if conn:
                conn.rollback()
            if is_missing_flow_table_error(error):
                raise HTTPException(
                    status_code=500,
                    detail="Flow storage tables are not installed in the target DB. Run database/INIT_TARGET_DDL.sql first.",
                )
            if is_flow_lock_error(error):
                step = get_flow_error_step(error)
                logger.warning("%s saved flow run lock conflict at %s: %s", MENU_CODE, step, error)
                raise HTTPException(
                    status_code=409,
                    detail=f"Flow run hit a database row lock at {step}. Please wait a moment and run again.",
                )
            logger.error("%s saved flow run failed: %s", MENU_CODE, error)
            raise HTTPException(status_code=500, detail=str(error))
        finally:
            if conn:
                conn.close()
            if saved_lock:
                saved_lock.release()

    def run_flow_background(
        flow_run_id: int,
        connection_id: int,
        user_id: int,
        plan: list[dict],
        runtime_overrides: dict | None = None,
        start_message: str = "Flow execution started.",
        quick_edit_summary: dict | None = None,
    ):
        conn = None
        try:
            resource_limits = {}
            conn = get_target_db_connection_by_id(
                connection_id,
                user_id,
                resource_limits_out=resource_limits,
            )
            flow_work.start_run(conn, flow_run_id, start_message)
            conn.commit()
            runtime_defaults = apply_server_resource_limits(None, resource_limits)
            runtime_defaults.update(runtime_overrides or {})
            flow_work.execute_flow_plan(
                conn,
                flow_run_id,
                plan or [],
                runtime_defaults=runtime_defaults,
                run_context={"quickEditSummary": quick_edit_summary} if quick_edit_summary else None,
            )
        except Exception as e:
            if conn:
                conn.rollback()
                try:
                    failed_plan = {"plan": plan or []}
                    if runtime_overrides:
                        failed_plan["runtimeOverrides"] = {
                            "targetOwner": runtime_overrides.get("INIT$TargetOwner") or "",
                            "targetTable": runtime_overrides.get("INIT$TargetTable") or "",
                            "editSessionId": runtime_overrides.get("INIT$EditingSessionId"),
                        }
                    if quick_edit_summary:
                        failed_plan["quickEditSummary"] = quick_edit_summary
                    flow_work.update_run(
                        conn,
                        flow_run_id,
                        "FAILED",
                        f"Flow execution failed: {str(e)}",
                        failed_plan,
                    )
                    conn.commit()
                except Exception:
                    conn.rollback()
            logger.error(f"{MENU_CODE} background flow run failed: {str(e)}")
        finally:
            if conn:
                conn.close()

    @router.post("/flow/run-node")
    def run_flow_node(req: FlowNodeRunRequest, request: Request):
        conn = None
        save_lock = get_save_lock(req)
        if not save_lock.acquire(timeout=save_lock_wait_seconds):
            raise HTTPException(
                status_code=409,
                detail="This flow is still being saved or queued. Please wait a moment and try again.\n이 Flow 저장 또는 실행 대기열 등록이 아직 진행 중입니다. 잠시 후 다시 시도해 주세요."
            )
        try:
            conn = get_target_db_connection(request)
            require_project_access_for_request(conn, request, data_work.require_int(req.projectId, "projectId"))
            flow_id = save_flow_with_retry(conn, req)

            nodes, edges = flow_work.normalize_graph(req.nodes, req.edges)
            validation = flow_work.validate_graph(nodes, edges)
            if validation["status"] != "success":
                raise HTTPException(status_code=400, detail=validation["message"])
            runtime_overrides = flow_work.normalize_editing_runtime_overrides(req.runtimeOverrides)
            if runtime_overrides:
                edit_work.validate_flow_runtime_context(
                    conn,
                    request,
                    runtime_overrides,
                    project_id=req.projectId,
                    scenario_id=req.scenarioId,
                )

            selected_node_key = str(req.nodeKey or "")
            selected_step = next(
                (step for step in validation.get("plan", []) if str(step.get("nodeKey") or "") == selected_node_key),
                None
            )
            if not selected_step:
                raise HTTPException(status_code=400, detail="Selected node was not found in the current flow.")

            selected_plan = build_node_downstream_plan(validation.get("plan", []), selected_node_key) if req.downstream else [selected_step]
            if not selected_plan:
                raise HTTPException(status_code=400, detail="Selected node execution plan could not be built.")

            run_type = "MANUAL_FROM_NODE" if req.downstream else "MANUAL_NODE"
            message = (
                f"Node and downstream execution started: {selected_step.get('nodeName') or selected_node_key}"
                if req.downstream
                else f"Node execution started: {selected_step.get('nodeName') or selected_node_key}"
            )
            run_plan = {**validation, "selectedNodeKey": selected_node_key, "downstream": bool(req.downstream), "plan": selected_plan}
            if runtime_overrides:
                run_plan["runtimeOverrides"] = runtime_overrides
            payload_manual_run_id = flow_work.parse_manual_run_id(req.manualRunId)
            plan_manual_run_id = flow_work.extract_manual_run_id_from_plan(selected_plan)
            if payload_manual_run_id and plan_manual_run_id and payload_manual_run_id != plan_manual_run_id:
                raise HTTPException(status_code=400, detail="Manual flow run id values must match.")
            manual_run_id = payload_manual_run_id or plan_manual_run_id
            continue_run_id = flow_work.parse_manual_run_id(req.continueRunId)
            if continue_run_id and manual_run_id and continue_run_id != manual_run_id:
                raise HTTPException(status_code=400, detail="Continue flow run id and manual flow run id values must match.")

            external_requirements = flow_work.get_external_dependency_requirements(validation.get("plan", []), selected_plan)
            if runtime_overrides and req.downstream and external_requirements:
                raise HTTPException(
                    status_code=400,
                    detail="INITDN$ reanalysis cannot reuse upstream results from another run. Use Run now from the beginning.",
                )
            continuing = False
            if req.downstream and external_requirements:
                run_id = continue_run_id or manual_run_id or flow_work.find_latest_compatible_run_id(
                    conn,
                    flow_id,
                    validation.get("plan", []),
                    selected_plan
                )
                if not run_id:
                    required_nodes = ", ".join(
                        f"{item.get('nodeName') or item.get('nodeKey')}({item.get('nodeKey')})"
                        for item in external_requirements
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Run from selected node requires a previous flow run where upstream node(s) already completed successfully. "
                            f"Required upstream node(s): {required_nodes}. "
                            "Run the upstream node first, or use the top Run now button to execute from the beginning.\n"
                            "선택 노드부터 실행하려면 같은 FLOW_RUN_ID 안에 선행 노드 실행 결과가 먼저 있어야 합니다. "
                            f"필요한 선행 노드: {required_nodes}. "
                            "선행 노드를 먼저 실행하거나 상단 Run now로 처음부터 실행해 주세요."
                        )
                    )
                flow_work.require_compatible_continue_run(conn, flow_id, run_id, validation.get("plan", []), selected_plan)
                continuing = True
                message = f"{message} Continuing FLOW_RUN_ID {run_id} with existing upstream results."
                run_plan = {**run_plan, "continueRunId": run_id, "continuedFromExistingRun": True}
                flow_work.resume_run(conn, flow_id, run_id, run_type, "STARTED", message, run_plan)
                flow_work.create_node_run_records(conn, run_id, flow_id, selected_plan, replace_existing=True)
            else:
                run_id = flow_work.create_run(conn, flow_id, run_type, "STARTED", message, run_plan, manual_run_id)
                flow_work.create_node_run_records(conn, run_id, flow_id, selected_plan)
            target_connection_id = get_target_connection_id(request)
            user_id = get_request_user_id(request)
            conn.commit()
            try:
                submit_background_job(
                    f"{MENU_CODE} flow_node_run_id={run_id}",
                    run_flow_background,
                    run_id,
                    target_connection_id,
                    user_id,
                    selected_plan,
                    runtime_overrides,
                    message,
                )
            except BackgroundJobQueueFull as queue_error:
                mark_flow_submission_failed(
                    conn,
                    run_id,
                    selected_plan,
                    run_plan,
                    str(queue_error),
                )
                raise HTTPException(status_code=503, detail=str(queue_error))
            except Exception as submit_error:
                mark_flow_submission_failed(
                    conn,
                    run_id,
                    selected_plan,
                    run_plan,
                    f"Background flow submission failed: {submit_error}",
                )
                logger.exception("%s background node submission failed.", MENU_CODE)
                raise HTTPException(status_code=500, detail="Background flow submission failed.")
            return {
                "status": "success",
                "message": message,
                "data": {
                    "flowId": flow_id,
                    "flowRunId": run_id,
                    "runType": run_type,
                    "runStatus": "STARTED",
                    "continuedFromExistingRun": continuing,
                    "plan": selected_plan,
                    "runtimeOverrides": runtime_overrides
                }
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            if is_missing_flow_table_error(e):
                raise HTTPException(
                    status_code=500,
                    detail="Flow storage tables are not installed in the target DB. Run database/INIT_TARGET_DDL.sql first."
                )
            if is_flow_lock_error(e):
                step = get_flow_error_step(e)
                logger.warning(f"{MENU_CODE} flow node run lock conflict at {step}: {str(e)}")
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Flow node run hit a database row lock at {step}. Please wait a moment and run again.\n"
                        f"{step} 단계에서 DB row lock 충돌이 발생했습니다. 잠시 후 다시 실행해 주세요."
                    )
                )
            logger.error(f"{MENU_CODE} flow node run failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
            if save_lock:
                save_lock.release()

    @router.get("/runs")
    def get_runs(request: Request, projectId: int, scenarioId: int, flowId: Optional[int] = None):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return query_runs(conn, request, projectId, scenarioId, flowId)
        finally:
            if conn:
                conn.close()

    @router.get("/quick-edit/history")
    def get_quick_edit_history(
        request: Request,
        page: int = 1,
        pageSize: int = 20,
    ):
        """Return recent Quick Editing executions visible to the signed-in user."""
        conn = None
        try:
            normalized_page = normalize_page_number(page)
            normalized_page_size = normalize_page_size(pageSize, default=20, maximum=100)
            conn = get_target_db_connection(request)
            return flow_work.list_quick_edit_history(
                conn,
                MENU_CODE,
                get_request_user_id(request),
                get_request_role_code(request) == "ADMIN",
                normalized_page,
                normalized_page_size,
            )
        finally:
            if conn:
                conn.close()

    @router.get("/quick-edit/history/{flow_run_id}")
    def get_quick_edit_history_detail(flow_run_id: int, request: Request):
        """Restore one Quick Editing execution from persisted run and node results."""
        conn = None
        try:
            conn = get_target_db_connection(request)
            history = flow_work.list_quick_edit_history(
                conn,
                MENU_CODE,
                get_request_user_id(request),
                get_request_role_code(request) == "ADMIN",
                1,
                1,
                flow_run_id=flow_run_id,
            )
            rows = history.get("data") or []
            if not rows:
                raise HTTPException(status_code=404, detail="Quick Editing execution history was not found.")
            run_row = dict(rows[0])
            stored_run = flow_work.get_run(
                conn,
                MENU_CODE,
                int(run_row.get("PROJECT_ID") or 0),
                int(run_row.get("SCENARIO_ID") or 0),
                flow_run_id,
            )
            if stored_run:
                run_row["PLAN_JSON"] = stored_run.get("PLAN_JSON")
            node_rows = flow_work.list_node_runs(conn, flow_run_id).get("data") or []
            return {
                "status": "success",
                "data": flow_work.build_quick_edit_history_detail(run_row, node_rows),
            }
        finally:
            if conn:
                conn.close()

    @router.get("/run/{flow_run_id}/nodes")
    def get_run_nodes(flow_run_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = flow_work.list_node_runs(conn, flow_run_id)
            rows = result.get("data") or []
            if rows:
                flow = flow_work.load_flow(conn, MENU_CODE, int(rows[0].get("FLOW_ID") or 0))
                require_project_access_for_request(conn, request, int(flow.get("PROJECT_ID") or 0))
            return result
        finally:
            if conn:
                conn.close()

    @router.get("/run/{flow_run_id}/snapshot")
    def get_run_snapshot(
        flow_run_id: int,
        request: Request,
        projectId: int,
        scenarioId: int,
        ifVersion: Optional[str] = None,
    ):
        """Return one run and its node results with a single pooled connection."""
        conn = None
        try:
            conn = get_target_db_connection(request)
            require_project_access_for_request(conn, request, projectId)
            run_row = flow_work.get_run(conn, MENU_CODE, projectId, scenarioId, flow_run_id)
            if run_row is None:
                raise HTTPException(status_code=404, detail="Flow run was not found in the selected project and scenario.")
            snapshot_version = build_run_snapshot_version(run_row)
            if str(ifVersion or "") == snapshot_version:
                return {
                    "status": "success",
                    "changed": False,
                    "version": snapshot_version,
                    "data": None,
                }
            node_rows = flow_work.list_node_runs(conn, flow_run_id).get("data") or []
            return {
                "status": "success",
                "changed": True,
                "version": snapshot_version,
                "data": {
                    "run": run_row,
                    "nodes": node_rows,
                },
            }
        finally:
            if conn:
                conn.close()

    @router.get("/result-sql")
    def get_result_sql(
        request: Request,
        resultCreateYn: str,
        owner: str,
        objectName: str,
        targetOwner: Optional[str] = None,
        targetTable: Optional[str] = None,
        flowRunId: Optional[int] = None,
        flowNodeRunId: Optional[int] = None,
        editSessionId: Optional[str] = None,
        nodeKey: Optional[str] = None,
        modelName: Optional[str] = None,
        apiObjectName: Optional[str] = None,
    ):
        conn = None
        try:
            mode = data_work.normalize_result_create_mode(resultCreateYn)
            result_owner = data_work.require_identifier(owner, "owner")
            result_object = data_work.require_identifier(objectName, "objectName")
            target_owner = data_work.require_identifier(targetOwner, "targetOwner") if targetOwner else ""
            target_table = data_work.require_identifier(targetTable, "targetTable") if targetTable else ""
            edit_session_text = str(editSessionId or "").strip()
            if edit_session_text and not edit_session_text.isdigit():
                raise HTTPException(status_code=400, detail="editSessionId must be an integer.")
            edit_session_id = int(edit_session_text) if edit_session_text else None
            if mode == "T":
                conn = get_target_db_connection(request)
                column_result = execute_query(
                    conn,
                    "FLOW_WORK_RESULT_COLUMN_LIST",
                    {
                        "owner": result_owner,
                        "tableName": result_object,
                    },
                )
                column_rows = data_work.require_success(
                    column_result,
                    "Result table column query failed.",
                ).get("data", [])
                available_columns = {
                    str(row.get("COLUMN_NAME") or "").strip().upper()
                    for row in column_rows
                    if row.get("COLUMN_NAME")
                }
                return {
                    "status": "success",
                    "data": {
                        "mode": mode,
                        "sql": build_table_result_sql(
                            result_owner,
                            result_object,
                            available_columns,
                            target_owner,
                            target_table,
                            "FLOW_WORK" if flowRunId else "",
                            flowRunId,
                            flowNodeRunId,
                            edit_session_id,
                            nodeKey or "",
                            modelName or "",
                            apiObjectName or "",
                        ),
                        "filterColumns": sorted(available_columns),
                        "views": []
                    }
                }
            if mode == "M":
                conn = get_target_db_connection(request)
                sql_text, views = build_model_detail_sql(conn, result_owner, result_object)
                return {
                    "status": "success",
                    "data": {
                        "mode": mode,
                        "sql": sql_text,
                        "views": views
                    }
                }
            return {
                "status": "success",
                "data": {
                    "mode": "N",
                    "sql": "-- This node does not create a result table or model.",
                    "views": []
                }
            }
        finally:
            if conn:
                conn.close()

    @router.post("/result-sql")
    def execute_result_sql(req: FlowResultSqlRequest, request: Request):
        page = normalize_page_number(req.page)
        limit = normalize_page_size(req.limit)
        conn = None
        try:
            sql = normalize_select_sql(req.sql)
            conn = get_target_db_connection(request)
            count_result = execute_query(conn, "FLOW_WORK_RESULT_SQL_COUNT", {
                "dynamicSql": sql
            })
            count_result = data_work.require_success(count_result, "Result SQL count query failed.")
            count_rows = count_result.get("data") or []
            total = int(count_rows[0].get("TOTAL_COUNT") or 0) if count_rows else 0
            page_window = create_page_window(page, limit, total)
            result = execute_query(conn, "FLOW_WORK_RESULT_SQL_PAGE", {
                "dynamicSql": sql,
                "offset": page_window.offset,
                "limit": page_window.page_size
            })
            response = normalize_sql_result(data_work.require_success(result, "Result SQL execution failed."))
            response["total"] = total
            response.update(page_window.response_metadata())
            return response
        finally:
            if conn:
                conn.close()

    return router
