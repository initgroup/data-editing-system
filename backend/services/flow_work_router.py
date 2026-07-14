"""
Factory for reusable flow-work routers.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Any, Dict, Optional
from datetime import date, datetime
from decimal import Decimal
import logging
import re
import threading
import time

from backend.database_helper import execute_query
from backend.auth_context import get_request_role_code, get_request_user_id
from backend.target_database import get_target_connection_id, get_target_db_connection, get_target_db_connection_by_id
from backend.services import data_work_service as data_work
from backend.services import flow_work_service as flow_work
from backend.services.background_jobs import submit_background_job
from backend.services.flow_work_service import FlowNodeRunRequest, FlowRunRequest, FlowWorkRequest

logger = logging.getLogger(__name__)


class FlowResultSqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 200


MODEL_DETAIL_VIEW_TYPES = [
    ("VA", "Attribute/detail view"),
    ("VG", "Global/detail view"),
    ("VI", "Itemset/detail view"),
    ("VN", "Node/detail view"),
    ("VP", "Pattern/partition/detail view"),
    ("VR", "Rule/detail view"),
    ("VT", "Transformation/detail view")
]
TARGET_FILTER_RESULT_COLUMNS = {
    "INIT$_TB_PREDICTED_TYPE": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_CAT_CORR_PAIR": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_CAT_CORR_SUMMARY": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_NUM_CORR_PAIR": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_NUM_CORR_SUMMARY": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_LASSO_FEATURE": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_SYMBOLIC_RULE": ("OWNER", "TABLE_NAME"),
    "INIT$_TB_ASSOC_RULE_SUMMARY": ("TARGET_OWNER", "TARGET_TABLE"),
    "INIT$_TB_RULE_VIOLATION_RESULT": ("TARGET_OWNER", "TARGET_TABLE"),
    "INIT$_TB_SYMBOLIC_RULE_VIOLATION": ("TARGET_OWNER", "TARGET_TABLE"),
}


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


def normalize_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 200)
    except (TypeError, ValueError):
        limit = 200
    return max(1, min(limit, 1000))


def build_table_result_sql(
    owner: str,
    table_name: str,
    target_owner: str = "",
    target_table: str = "",
    run_source_type: str = "",
    run_id: Optional[int] = None
) -> str:
    sql = f"SELECT *\n  FROM {quote_identifier(owner)}.{quote_identifier(table_name)}"
    clauses = []
    target_columns = TARGET_FILTER_RESULT_COLUMNS.get(table_name.upper())
    if target_columns and target_owner and target_table:
        owner_column, table_column = target_columns
        clauses.extend([
            f"{owner_column} = {quote_sql_literal(target_owner.upper())}",
            f"{table_column} = {quote_sql_literal(target_table.upper())}"
        ])
    if target_columns and run_source_type and run_id is not None:
        clauses.extend([
            f"RUN_SOURCE_TYPE = {quote_sql_literal(run_source_type.upper())}",
            f"RUN_ID = {int(run_id)}"
        ])
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
    if any(code in text for code in ("ORA-00054", "ORA-00060", "ORA-12860")):
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

    def get_save_lock(req: FlowWorkRequest) -> threading.Lock:
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

    @router.get("/scenario-tables")
    def get_scenario_tables(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, "FLOW_WORK_SCENARIO_TABLE_LIST", {
                "projectId": projectId,
                "scenarioId": scenarioId
            })
            return data_work.require_success(result, "Scenario table query failed.")
        finally:
            if conn:
                conn.close()

    @router.get("/assets/jobs")
    def get_flow_jobs(request: Request, projectId: int, scenarioId: int, menuCode: Optional[str] = None):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, "FLOW_WORK_DATA_JOB_ASSET_LIST", {
                "projectId": projectId,
                "scenarioId": scenarioId,
                "menuCode": menuCode
            })
            for row in result.get("data") or []:
                row["PARAM_JSON"] = data_work.read_lob(row.get("PARAM_JSON"))
                row["EXEC_PLSQL"] = data_work.read_lob(row.get("EXEC_PLSQL"))
                row["EXEC_SPEC_JSON"] = data_work.read_lob(row.get("EXEC_SPEC_JSON"))
            return data_work.require_success(result, "Flow job asset query failed.")
        finally:
            if conn:
                conn.close()

    @router.get("/node-types")
    def get_node_types(request: Request, projectId: Optional[int] = None, scenarioId: Optional[int] = None):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_FLOW_NODE_TYPE_LIST", {
                "projectId": projectId,
                "scenarioId": scenarioId
            })
            return data_work.require_success(result, "Flow node type query failed.")
        finally:
            if conn:
                conn.close()

    @router.get("/default-variables")
    def get_default_variables(request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_FLOW_DEFAULT_VARIABLE_LIST")
            return data_work.require_success(result, "Flow variable query failed.")
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
            return flow_work.list_flows(conn, MENU_CODE, projectId, scenarioId)
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
            return {"status": "success", "data": flow_work.load_flow(conn, MENU_CODE, flow_id)}
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
            flow_id = save_flow_with_retry(conn, req)

            nodes, edges = flow_work.normalize_graph(req.nodes, req.edges)
            validation = flow_work.validate_graph(nodes, edges)
            if validation["status"] != "success":
                raise HTTPException(status_code=400, detail=validation["message"])

            run_type = "BATCH" if req.batch else "MANUAL"
            run_status = "QUEUED" if req.batch else "STARTED"
            message = ROUTER_MESSAGES["run_queued"] if req.batch else "Flow execution started."
            payload_manual_run_id = flow_work.parse_manual_run_id(req.manualRunId)
            plan_manual_run_id = flow_work.extract_manual_run_id_from_plan(validation.get("plan", []))
            if payload_manual_run_id and plan_manual_run_id and payload_manual_run_id != plan_manual_run_id:
                raise HTTPException(status_code=400, detail="Manual flow run id values must match.")
            manual_run_id = payload_manual_run_id or plan_manual_run_id
            run_id = flow_work.create_run(conn, flow_id, run_type, run_status, message, validation, manual_run_id)
            flow_work.create_node_run_records(conn, run_id, flow_id, validation.get("plan", []))
            conn.commit()
            submit_background_job(
                f"{MENU_CODE} flow_run_id={run_id}",
                run_flow_background,
                run_id,
                get_target_connection_id(request),
                get_request_user_id(request),
                validation.get("plan", []),
                "Flow batch execution started." if req.batch else "Flow execution started.",
            )
            save_lock.release()
            save_lock = None
            return {
                "status": "success",
                "message": message,
                "data": {
                    "flowId": flow_id,
                    "flowRunId": run_id,
                    "runType": run_type,
                    "runStatus": run_status,
                    "plan": validation.get("plan", [])
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

    def run_flow_background(flow_run_id: int, connection_id: int, user_id: int, plan: list[dict], start_message: str = "Flow execution started."):
        conn = None
        try:
            conn = get_target_db_connection_by_id(connection_id, user_id)
            flow_work.start_run(conn, flow_run_id, start_message)
            conn.commit()
            flow_work.execute_flow_plan(conn, flow_run_id, plan or [])
        except Exception as e:
            if conn:
                conn.rollback()
                try:
                    flow_work.update_run(
                        conn,
                        flow_run_id,
                        "FAILED",
                        f"Flow execution failed: {str(e)}",
                        {"plan": plan or []}
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
            flow_id = save_flow_with_retry(conn, req)

            nodes, edges = flow_work.normalize_graph(req.nodes, req.edges)
            validation = flow_work.validate_graph(nodes, edges)
            if validation["status"] != "success":
                raise HTTPException(status_code=400, detail=validation["message"])

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
            payload_manual_run_id = flow_work.parse_manual_run_id(req.manualRunId)
            plan_manual_run_id = flow_work.extract_manual_run_id_from_plan(selected_plan)
            if payload_manual_run_id and plan_manual_run_id and payload_manual_run_id != plan_manual_run_id:
                raise HTTPException(status_code=400, detail="Manual flow run id values must match.")
            manual_run_id = payload_manual_run_id or plan_manual_run_id
            continue_run_id = flow_work.parse_manual_run_id(req.continueRunId)
            if continue_run_id and manual_run_id and continue_run_id != manual_run_id:
                raise HTTPException(status_code=400, detail="Continue flow run id and manual flow run id values must match.")

            external_requirements = flow_work.get_external_dependency_requirements(validation.get("plan", []), selected_plan)
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
            conn.commit()
            submit_background_job(
                f"{MENU_CODE} flow_node_run_id={run_id}",
                run_flow_background,
                run_id,
                get_target_connection_id(request),
                get_request_user_id(request),
                selected_plan,
                message,
            )
            return {
                "status": "success",
                "message": message,
                "data": {
                    "flowId": flow_id,
                    "flowRunId": run_id,
                    "runType": run_type,
                    "runStatus": "STARTED",
                    "continuedFromExistingRun": continuing,
                    "plan": selected_plan
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
            return flow_work.list_runs(conn, MENU_CODE, projectId, scenarioId, flowId)
        finally:
            if conn:
                conn.close()

    @router.get("/run/{flow_run_id}/nodes")
    def get_run_nodes(flow_run_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return flow_work.list_node_runs(conn, flow_run_id)
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
    ):
        conn = None
        try:
            mode = data_work.normalize_result_create_mode(resultCreateYn)
            result_owner = data_work.require_identifier(owner, "owner")
            result_object = data_work.require_identifier(objectName, "objectName")
            target_owner = data_work.require_identifier(targetOwner, "targetOwner") if targetOwner else ""
            target_table = data_work.require_identifier(targetTable, "targetTable") if targetTable else ""
            if mode == "T":
                return {
                    "status": "success",
                    "data": {
                        "mode": mode,
                        "sql": build_table_result_sql(result_owner, result_object, target_owner, target_table, "FLOW_WORK" if flowRunId else "", flowRunId),
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
        conn = None
        try:
            sql = normalize_select_sql(req.sql)
            conn = get_target_db_connection(request)
            result = execute_query(conn, "FLOW_WORK_RESULT_SQL_SELECT", {
                "dynamicSql": sql,
                "limit": normalize_limit(req.limit)
            })
            return normalize_sql_result(data_work.require_success(result, "Result SQL execution failed."))
        finally:
            if conn:
                conn.close()

    return router
