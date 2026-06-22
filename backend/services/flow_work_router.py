"""
Factory for reusable flow-work routers.
"""

from fastapi import APIRouter, HTTPException, Request
from typing import Dict, Optional
import logging
import threading
import time

from backend.database_helper import execute_query
from backend.target_database import get_target_db_connection
from backend.services import data_work_service as data_work
from backend.services import flow_work_service as flow_work
from backend.services.flow_work_service import FlowNodeRunRequest, FlowRunRequest, FlowWorkRequest

logger = logging.getLogger(__name__)


def is_missing_flow_table_error(error: Exception) -> bool:
    text = str(error)
    return "ORA-00942" in text or "INIT$_TB_FLOW_WORK" in text and "does not exist" in text.lower()


def is_flow_lock_error(error: Exception) -> bool:
    return "ORA-12860" in str(error)


def get_flow_error_step(error: Exception) -> str:
    return getattr(error, "step", "") or "UNKNOWN_STEP"


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
    save_lock_wait_seconds = 10

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
        for attempt in range(2):
            try:
                return flow_work.save_flow(conn, MENU_CODE, req, DEFAULT_FLOW_GROUP, DEFAULT_FLOW_TYPE)
            except Exception as e:
                if attempt == 0 and is_flow_lock_error(e):
                    conn.rollback()
                    time.sleep(0.5)
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
            run_id = flow_work.create_run(conn, flow_id, run_type, run_status, message, validation)
            flow_work.create_node_run_records(conn, run_id, flow_id, validation.get("plan", []))
            conn.commit()
            if not req.batch:
                run_result = flow_work.execute_flow_plan(conn, run_id, validation.get("plan", []))
                run_status = run_result.get("status") or run_status
                message = run_result.get("message") or message
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

            run_type = "MANUAL_NODE"
            message = f"Node execution started: {selected_step.get('nodeName') or selected_node_key}"
            run_plan = {**validation, "selectedNodeKey": selected_node_key, "plan": [selected_step]}
            run_id = flow_work.create_run(conn, flow_id, run_type, "STARTED", message, run_plan)
            flow_work.create_node_run_records(conn, run_id, flow_id, [selected_step])
            conn.commit()

            run_result = flow_work.execute_flow_plan(conn, run_id, [selected_step])
            run_status = run_result.get("status") or "STARTED"
            message = run_result.get("message") or message
            return {
                "status": "success",
                "message": message,
                "data": {
                    "flowId": flow_id,
                    "flowRunId": run_id,
                    "runType": run_type,
                    "runStatus": run_status,
                    "plan": [selected_step]
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

    return router
