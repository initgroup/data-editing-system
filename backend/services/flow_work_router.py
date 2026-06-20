"""
Factory for reusable flow-work routers.
"""

from fastapi import APIRouter, HTTPException, Request
from typing import Dict, Optional
import logging

from backend.database_helper import execute_query
from backend.target_database import get_target_db_connection
from backend.services import data_work_service as data_work
from backend.services import flow_work_service as flow_work
from backend.services.flow_work_service import FlowRunRequest, FlowWorkRequest

logger = logging.getLogger(__name__)


def is_missing_flow_table_error(error: Exception) -> bool:
    text = str(error)
    return "ORA-00942" in text or "INIT$_TB_FLOW_WORK" in text and "does not exist" in text.lower()


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
        "run_done": "Flow execution plan created.",
        "run_queued": "Flow queued.",
        **(messages or {})
    }

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
            return data_work.require_success(result, "Flow job asset query failed.")
        finally:
            if conn:
                conn.close()

    @router.get("/node-types")
    def get_node_types(request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_FLOW_NODE_TYPE_LIST")
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
        try:
            conn = get_target_db_connection(request)
            flow_id = flow_work.save_flow(conn, MENU_CODE, req, DEFAULT_FLOW_GROUP, DEFAULT_FLOW_TYPE)
            conn.commit()
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
            logger.error(f"{MENU_CODE} flow save failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()

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
        try:
            conn = get_target_db_connection(request)
            flow_id = flow_work.save_flow(conn, MENU_CODE, req, DEFAULT_FLOW_GROUP, DEFAULT_FLOW_TYPE)

            nodes, edges = flow_work.normalize_graph(req.nodes, req.edges)
            validation = flow_work.validate_graph(nodes, edges)
            if validation["status"] != "success":
                raise HTTPException(status_code=400, detail=validation["message"])

            run_type = "BATCH" if req.batch else "MANUAL"
            run_status = "QUEUED" if req.batch else "SUCCESS"
            message = ROUTER_MESSAGES["run_queued"] if req.batch else ROUTER_MESSAGES["run_done"]
            run_id = flow_work.create_run(conn, flow_id, run_type, "STARTED", "Flow run requested.", validation)
            flow_work.update_run(conn, run_id, run_status, message, validation)
            conn.commit()
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
            logger.error(f"{MENU_CODE} flow run failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()

    @router.get("/runs")
    def get_runs(request: Request, projectId: int, scenarioId: int, flowId: Optional[int] = None):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return flow_work.list_runs(conn, MENU_CODE, projectId, scenarioId, flowId)
        finally:
            if conn:
                conn.close()

    return router
