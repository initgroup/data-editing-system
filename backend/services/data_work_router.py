"""
@file           data_work_router.py
@description    Shared data workbench API router factory
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, List, Optional
from datetime import date, datetime
from decimal import Decimal
import logging
import re
import threading
import time
import uuid

from backend.target_database import get_target_connection_id, get_target_db_connection, get_target_db_connection_by_id
from backend.auth_context import get_request_user_id
from backend.database_helper import execute_query, SqlLoader
from backend.services.background_jobs import submit_background_job
from backend.services import data_work_service as data_work
from backend.services import api_call_service
from backend.services.data_work_service import (
    DataWorkJobRequest as ProfileJobRequest,
    DataWorkRunAllJobsRequest as RunAllJobsRequest,
    DataWorkRunJobRequest as RunJobRequest,
)

logger = logging.getLogger(__name__)


class TableRequest(BaseModel):
    owner: Optional[str] = None
    tableName: Optional[str] = None
    limit: Optional[int] = 100
    whereClause: Optional[str] = None
    orderByClause: Optional[str] = None
    model_config = ConfigDict(extra="allow")


class DataCellChange(BaseModel):
    rowId: str
    columnName: str
    value: Any = None
    model_config = ConfigDict(extra="allow")


class DataUpdateRequest(TableRequest):
    changes: List[DataCellChange] = []
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    transactionId: Optional[str] = None
    runtimeBindValues: Optional[Dict[str, Any]] = None
    model_config = ConfigDict(extra="allow")


class SqlTransactionRequest(BaseModel):
    transactionId: Optional[str] = None
    model_config = ConfigDict(extra="allow")


class SaveSqlTableRequest(BaseModel):
    sql: str
    targetTableName: str
    resultOwner: Optional[str] = None
    profileJobId: Optional[int] = None
    model_config = ConfigDict(extra="allow")


class DataWorkRunContextRequest(BaseModel):
    projectId: int
    scenarioId: int
    model_config = ConfigDict(extra="allow")


def parse_manual_run_id(runtime_bind_values: Optional[Dict[str, Any]]) -> Optional[int]:
    values = runtime_bind_values or {}
    run_values = []
    for key in ("INIT$RunId", "runId", "P_RUN_ID"):
        if key not in values:
            continue
        text = str(values.get(key) if values.get(key) is not None else "").strip()
        if not text or text.lower() in {"(auto)", "auto"}:
            continue
        if not re.fullmatch(r"[1-9][0-9]*", text):
            raise HTTPException(status_code=400, detail="DATA_WORK INIT$RunId/P_RUN_ID must be a positive integer or (auto).")
        run_values.append(int(text))
    if not run_values:
        return None
    if len(set(run_values)) > 1:
        raise HTTPException(status_code=400, detail="DATA_WORK INIT$RunId/P_RUN_ID values must match.")
    return run_values[0]


MODEL_DETAIL_VIEW_TYPES = [
    ("VA", "Attribute/detail view"),
    ("VG", "Global/detail view"),
    ("VI", "Itemset/detail view"),
    ("VN", "Node/detail view"),
    ("VP", "Pattern/partition/detail view"),
    ("VR", "Rule/detail view"),
    ("VT", "Transformation/detail view"),
]



def create_data_work_router(
    menu_code: str,
    sql_prefix: str,
    default_job_group: Optional[str] = None,
    messages: Optional[Dict[str, str]] = None
) -> APIRouter:
    router = APIRouter()
    MENU_CODE = menu_code
    SQL_PREFIX = sql_prefix
    DEFAULT_JOB_GROUP = default_job_group or menu_code
    ROUTER_MESSAGES = {
        "job_saved": "Work job saved.",
        "job_queued": "Work job queued.",
        "job_executed": "Work job executed.",
        "job_started": "Work job started.",
        "run_all_empty": "No enabled work jobs to execute.",
        "run_all_done": "work jobs executed.",
        **(messages or {})
    }
    transaction_lock = threading.Lock()
    active_transactions: Dict[str, Dict[str, Any]] = {}
    transaction_timeout_seconds = 30 * 60

    def cleanup_expired_transactions():
        now = time.time()
        expired_ids = []
        with transaction_lock:
            for transaction_id, session in active_transactions.items():
                if now - session.get("lastAccessAt", now) > transaction_timeout_seconds:
                    expired_ids.append(transaction_id)

            for transaction_id in expired_ids:
                session = active_transactions.pop(transaction_id, None)
                conn = session.get("conn") if session else None
                if conn:
                    try:
                        conn.rollback()
                    finally:
                        conn.close()

    def get_transaction_connection(transaction_id: Optional[str]):
        if not transaction_id:
            return None

        cleanup_expired_transactions()
        with transaction_lock:
            session = active_transactions.get(transaction_id)
            if not session:
                raise HTTPException(status_code=404, detail="SQL transaction session was not found or expired.")
            session["lastAccessAt"] = time.time()
            return session["conn"]

    def register_transaction_connection(conn) -> str:
        transaction_id = uuid.uuid4().hex
        now = time.time()

        with transaction_lock:
            active_transactions[transaction_id] = {
                "conn": conn,
                "createdAt": now,
                "lastAccessAt": now
            }

        return transaction_id

    def finish_transaction(transaction_id: str, action: str):
        cleanup_expired_transactions()
        with transaction_lock:
            session = active_transactions.pop(transaction_id, None)

        if not session:
            raise HTTPException(status_code=404, detail="SQL transaction session was not found or expired.")

        conn = session["conn"]
        try:
            if action == "commit":
                conn.commit()
            elif action == "rollback":
                conn.rollback()
            else:
                raise HTTPException(status_code=400, detail="Unsupported transaction action.")
        finally:
            conn.close()

        return {
            "status": "success",
            "transactionId": transaction_id,
            "message": f"Transaction {action} completed."
        }

    @router.get("/scenario-tables")
    def get_scenario_tables(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_SCENARIO_TABLE_LIST", {
                "projectId": projectId,
                "scenarioId": scenarioId
            })
            return data_work.require_success(result, "Scenario table query failed.")
        finally:
            if conn:
                conn.close()
    
    
    @router.get("/executable-objects")
    def get_executable_objects(request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_EXECUTABLE_OBJECT_LIST")
            return data_work.require_success(result, "Executable object query failed.")
        finally:
            if conn:
                conn.close()
    
    
    @router.get("/executable-object/{object_id}/parameters")
    def get_executable_object_parameters(object_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_EXECUTABLE_OBJECT_DETAIL", {"objectId": object_id})
            return data_work.require_success(result, "Object parameter query failed.")
        finally:
            if conn:
                conn.close()


    @router.get("/oml-resources")
    def get_oml_resources(request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, "DATA_WORK_OML_RESOURCE_LIST")
            return data_work.require_success(result, "OML resource query failed.")
        finally:
            if conn:
                conn.close()


    @router.get("/oml-resource/{resource_id}/parameters")
    def get_oml_resource_parameters(resource_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, "DATA_WORK_OML_RESOURCE_DETAIL", {"resourceId": resource_id})
            normalized = data_work.require_success(result, "OML resource parameter query failed.")
            rows = [normalize_lob_row(row) for row in normalized.get("data", [])]
            resource = rows[0] if rows else {}
            params = [
                {
                    "itemName": row.get("PARAM_NAME") or "",
                    "itemValue": row.get("DATA_TYPE") or "",
                    "itemDesc": row.get("PARAM_DESC") or "",
                    "itemDefault": row.get("DEFAULT_VALUE") or "",
                    "itemOrder": row.get("ITEM_ORDER") or index + 1,
                    "bindName": row.get("BIND_NAME") or ""
                }
                for index, row in enumerate(rows)
                if row.get("PARAM_NAME")
            ]
            return {
                "status": "success",
                "data": params,
                "resource": resource,
                "columns": normalized.get("columns", []),
                "total": len(params)
            }
        finally:
            if conn:
                conn.close()


    @router.get("/model-detail-sql")
    def get_model_detail_sql(request: Request, owner: str, modelName: str):
        conn = None
        try:
            model_owner = data_work.require_identifier(owner, "owner")
            model_name = data_work.require_identifier(modelName, "modelName")
            conn = get_target_db_connection(request)
            sql_text, views = build_model_detail_sql(conn, model_owner, model_name)
            return {
                "status": "success",
                "data": {
                    "owner": model_owner,
                    "modelName": model_name,
                    "sql": sql_text,
                    "views": views
                },
                "total": len([row for row in views if row.get("existsYn") == "Y"])
            }
        finally:
            if conn:
                conn.close()


    @router.get("/predicted-type-run-id")
    def get_predicted_type_run_id(
        request: Request,
        owner: str,
        targetOwner: str,
        targetTable: str,
        modelName: Optional[str] = None
    ):
        conn = None
        cursor = None
        try:
            result_owner = data_work.require_identifier(owner, "owner")
            source_owner = data_work.require_identifier(targetOwner, "targetOwner")
            source_table = data_work.require_identifier(targetTable, "targetTable")
            model_name = data_work.normalize_optional_identifier(modelName)
            conn = get_target_db_connection(request)
            cursor = conn.cursor()
            target_object = quote_identifier(result_owner) + "." + quote_identifier("INIT$_TB_PREDICTED_TYPE")
            sql = SqlLoader.get_sql("DATA_WORK_PREDICTED_TYPE_RUN_ID").replace(
                "/* --PREDICTED_TYPE_OBJECT-- */",
                target_object
            )
            params = {
                "sourceOwner": source_owner,
                "sourceTable": source_table
            }
            if model_name:
                sql = sql.replace("/* --MODEL_NAME_FILTER-- */", "   AND MODEL_NAME = :modelName")
                params["modelName"] = model_name
            else:
                sql = sql.replace("/* --MODEL_NAME_FILTER-- */", "")
            cursor.execute(sql, params)
            row = cursor.fetchone()
            run_id = row[0] if row and row[0] is not None else None
            return {
                "status": "success",
                "data": {
                    "runId": int(run_id) if run_id is not None else None
                }
            }
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    

    @router.get("/result-run-id")
    def get_result_table_run_id(
        request: Request,
        owner: str,
        tableName: str,
        targetOwner: str,
        targetTable: str
    ):
        conn = None
        cursor = None
        try:
            result_owner = data_work.require_identifier(owner, "owner")
            result_table = data_work.require_identifier(tableName, "tableName")
            source_owner = data_work.require_identifier(targetOwner, "targetOwner")
            source_table = data_work.require_identifier(targetTable, "targetTable")
            filter_columns = {
                "INIT$_TB_CAT_CORR_PAIR": ("OWNER", "TABLE_NAME"),
                "INIT$_TB_CAT_CORR_SUMMARY": ("OWNER", "TABLE_NAME"),
                "INIT$_TB_NUM_CORR_PAIR": ("OWNER", "TABLE_NAME"),
                "INIT$_TB_NUM_CORR_SUMMARY": ("OWNER", "TABLE_NAME"),
                "INIT$_TB_LASSO_FEATURE": ("OWNER", "TABLE_NAME"),
                "INIT$_TB_SYMBOLIC_RULE": ("OWNER", "TABLE_NAME"),
                "INIT$_TB_ASSOC_RULE_SUMMARY": ("TARGET_OWNER", "TARGET_TABLE"),
                "INIT$_TB_RULE_VIOLATION_RESULT": ("TARGET_OWNER", "TARGET_TABLE"),
                "INIT$_TB_SYMBOLIC_RULE_VIOLATION": ("TARGET_OWNER", "TARGET_TABLE")
            }
            if result_table not in filter_columns:
                raise HTTPException(status_code=400, detail="Unsupported result table for run id lookup.")

            owner_column, table_column = filter_columns[result_table]
            conn = get_target_db_connection(request)
            cursor = conn.cursor()
            target_object = quote_identifier(result_owner) + "." + quote_identifier(result_table)
            sql = (
                SqlLoader.get_sql("DATA_WORK_RESULT_TABLE_RUN_ID")
                .replace("/* --RESULT_TABLE_OBJECT-- */", target_object)
                .replace("/* --OWNER_COLUMN-- */", owner_column)
                .replace("/* --TABLE_COLUMN-- */", table_column)
            )
            cursor.execute(sql, {
                "sourceOwner": source_owner,
                "sourceTable": source_table
            })
            row = cursor.fetchone()
            run_id = row[0] if row and row[0] is not None else None
            return {
                "status": "success",
                "data": {
                    "runId": int(run_id) if run_id is not None else None
                }
            }
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    
    
    @router.get("/jobs")
    def get_profile_jobs(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return data_work.list_jobs(conn, MENU_CODE, projectId, scenarioId)
        finally:
            if conn:
                conn.close()
    
    
    @router.get("/runs")
    def get_profile_runs(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return data_work.list_runs(conn, MENU_CODE, projectId, scenarioId)
        finally:
            if conn:
                conn.close()


    @router.get("/data-run-id")
    def get_data_work_run_id(request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            return {
                "status": "success",
                "data": data_work.get_data_work_run_context(conn, projectId, scenarioId)
            }
        finally:
            if conn:
                conn.close()


    @router.post("/data-run-id/ensure")
    def ensure_data_work_run_id(req: DataWorkRunContextRequest, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            context = data_work.ensure_data_work_run_id(conn, req.projectId, req.scenarioId)
            conn.commit()
            return {
                "status": "success",
                "message": f"DATA_WORK RUN_ID {context.get('DATA_WORK_RUN_ID')} is ready.",
                "data": context
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} data work run id ensure failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()


    @router.post("/data-run-id/new")
    def create_next_data_work_run_id(req: DataWorkRunContextRequest, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            context = data_work.create_next_data_work_run_id(conn, req.projectId, req.scenarioId)
            conn.commit()
            return {
                "status": "success",
                "message": f"DATA_WORK RUN_ID {context.get('DATA_WORK_RUN_ID')} was created.",
                "data": context
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} data work run id create failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
    
    
    @router.get("/job/{profile_job_id}")
    def get_profile_job(profile_job_id: int, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            job = data_work.load_job(conn, MENU_CODE, profile_job_id)
            return {"status": "success", "data": job}
        finally:
            if conn:
                conn.close()
    
    
    @router.post("/job/save")
    def save_profile_job(req: ProfileJobRequest, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            profile_job_id = data_work.save_job(conn, MENU_CODE, req, DEFAULT_JOB_GROUP)
            conn.commit()
            job = data_work.load_job(conn, MENU_CODE, profile_job_id)
            jobs = data_work.list_jobs(conn, MENU_CODE, job["PROJECT_ID"], job["SCENARIO_ID"]).get("data", [])
            return {
                "status": "success",
                "message": ROUTER_MESSAGES["job_saved"],
                "data": job,
                "list": jobs
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} profile job save failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()


    @router.delete("/job/{profile_job_id}")
    def delete_profile_job(profile_job_id: int, request: Request, projectId: int, scenarioId: int):
        conn = None
        try:
            conn = get_target_db_connection(request)
            data_work.delete_job(conn, MENU_CODE, profile_job_id, projectId, scenarioId)
            conn.commit()
            jobs = data_work.list_jobs(conn, MENU_CODE, projectId, scenarioId).get("data", [])
            return {
                "status": "success",
                "message": "Job deleted.",
                "data": {"profileJobId": profile_job_id},
                "list": jobs
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} profile job delete failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()


    def resolve_data_run_id(
        conn,
        job: Dict[str, Any],
        runtime_bind_values: Optional[Dict[str, Any]] = None
    ) -> int:
        manual_run_id = parse_manual_run_id(runtime_bind_values)
        if manual_run_id is not None:
            return int(manual_run_id)
        project_id = data_work.require_int(job.get("PROJECT_ID") or job.get("projectId"), "projectId")
        scenario_id = data_work.require_int(job.get("SCENARIO_ID") or job.get("scenarioId"), "scenarioId")
        context = data_work.ensure_data_work_run_id(conn, project_id, scenario_id)
        return int(context.get("DATA_WORK_RUN_ID") or context.get("dataWorkRunId") or 0)


    def with_data_run_id(runtime_bind_values: Optional[Dict[str, Any]], data_run_id: int) -> Dict[str, Any]:
        values = dict(runtime_bind_values or {})
        effective_run_id = int(data_run_id)
        values["INIT$RunSourceType"] = "DATA_WORK"
        values["INIT$RunId"] = effective_run_id
        values["runSourceType"] = "DATA_WORK"
        values["runId"] = effective_run_id
        values["P_RUN_SOURCE_TYPE"] = "DATA_WORK"
        values["P_RUN_ID"] = effective_run_id
        return values
    
    
    @router.post("/job/run")
    def run_profile_job(req: RunJobRequest, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            profile_job_id = data_work.require_int(req.profileJobId, "profileJobId")
            job = data_work.load_job(conn, MENU_CODE, profile_job_id)
            runtime_bind_values = req.runtimeBindValues or {}
            data_run_id = resolve_data_run_id(conn, job, runtime_bind_values)
            runtime_bind_values = with_data_run_id(runtime_bind_values, data_run_id)
            if req.batch:
                data_work.update_job_status(
                    conn,
                    MENU_CODE,
                    profile_job_id,
                    "QUEUED",
                    "Batch execution was queued.",
                    job.get("RESULT_TABLE_NAME") or "",
                    job.get("RESULT_OWNER") or "",
                    False,
                    False
                )
                conn.commit()
                submit_background_job(
                    f"{MENU_CODE} profile_job_id={profile_job_id}",
                    run_profile_job_background,
                    profile_job_id,
                    get_target_connection_id(request),
                    get_request_user_id(request),
                    runtime_bind_values,
                )
                return {
                    "status": "success",
                    "message": ROUTER_MESSAGES["job_queued"],
                    "profileJobId": profile_job_id
                }
    
            result = execute_profile_job(conn, profile_job_id, runtime_bind_values)
            conn.commit()
            return {
                "status": "success",
                "message": result.get("message", ROUTER_MESSAGES["job_executed"]),
                "profileJobId": profile_job_id,
                "data": result
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} profile job run failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()


    @router.post("/job/test-draft")
    def test_draft_profile_job(req: RunJobRequest, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            profile_job_id = data_work.require_int(req.profileJobId, "profileJobId")
            saved_job = data_work.load_job(conn, MENU_CODE, profile_job_id)
            draft_job = data_work.build_draft_job(conn, MENU_CODE, req, saved_job, DEFAULT_JOB_GROUP)
            runtime_bind_values = req.runtimeBindValues or {}
            data_run_id = resolve_data_run_id(conn, draft_job, runtime_bind_values)
            result = execute_draft_profile_job(conn, profile_job_id, draft_job, with_data_run_id(runtime_bind_values, data_run_id))
            conn.commit()
            return {
                "status": "success",
                "message": result.get("message", "Draft test executed."),
                "profileJobId": profile_job_id,
                "data": result
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} draft profile job test failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
    
    
    @router.post("/jobs/run-all")
    def run_all_profile_jobs(req: RunAllJobsRequest, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            jobs = data_work.list_runnable_jobs(conn, MENU_CODE, req.projectId, req.scenarioId)
            if not jobs:
                return {
                    "status": "success",
                    "message": ROUTER_MESSAGES["run_all_empty"],
                    "executedCount": 0,
                    "failedCount": 0,
                    "data": []
                }
    
            summaries = []
            failed_count = 0
            for job in jobs:
                profile_job_id = int(job["PROFILE_JOB_ID"])
                try:
                    run_result = execute_profile_job(conn, profile_job_id)
                    summaries.append({
                        "profileJobId": profile_job_id,
                        "jobName": job.get("JOB_NAME"),
                        "status": run_result.get("status", "success"),
                        "message": run_result.get("message", "")
                    })
                except Exception as e:
                    failed_count += 1
                    summaries.append({
                        "profileJobId": profile_job_id,
                        "jobName": job.get("JOB_NAME"),
                        "status": "failed",
                        "message": str(e)
                    })
    
            conn.commit()
            return {
                "status": "success",
                "message": f"{len(summaries)} {ROUTER_MESSAGES['run_all_done']} {failed_count} failed.",
                "executedCount": len(summaries),
                "failedCount": failed_count,
                "data": summaries
            }
        except HTTPException:
            if conn:
                conn.rollback()
            raise
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} profile job all execute failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
    
    
    @router.post("/columns")
    def get_columns(req: TableRequest, request: Request):
        owner, table_name = require_table(req)
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_TABLE_COLUMNS", {"owner": owner, "tableName": table_name})
            return data_work.require_success(result, "Column query failed.")
        finally:
            if conn:
                conn.close()
    
    
    @router.post("/data")
    def get_table_data(req: TableRequest, request: Request):
        owner, table_name = require_table(req)
        limit = normalize_limit(req.limit)
        conn = None
        try:
            conn = get_target_db_connection(request)
            result = execute_query(conn, f"{SQL_PREFIX}_TABLE_DATA", {
                "dynamicTable": quote_identifier(owner) + "." + quote_identifier(table_name),
                "limit": limit
            })
            return normalize_sql_result(data_work.require_success(result, "Data query failed."))
        finally:
            if conn:
                conn.close()


    @router.post("/data/editable")
    def get_editable_table_data(req: TableRequest, request: Request):
        owner, table_name = require_table(req)
        limit = normalize_limit(req.limit)
        where_clause = normalize_where_clause(req.whereClause)
        conn = None
        try:
            conn = get_target_db_connection(request)
            column_names = get_table_column_names(conn, owner, table_name)
            order_by_clause = normalize_order_by_clause(req.orderByClause, column_names)
            return fetch_editable_table_data(conn, owner, table_name, limit, where_clause, order_by_clause)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"{MENU_CODE} editable data query failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()


    @router.post("/data/update")
    def update_editable_table_data(req: DataUpdateRequest, request: Request):
        owner, table_name = require_table(req)
        where_clause = normalize_where_clause(req.whereClause)
        changes = req.changes or []
        if not changes:
            return {"status": "success", "updated": 0, "message": "No changes to update."}

        conn = None
        try:
            conn = get_target_db_connection(request)
            column_names = get_table_column_names(conn, owner, table_name)
            if not column_names:
                raise HTTPException(status_code=400, detail="Target table columns were not found.")
            editable_columns = get_editable_data_columns(table_name)
            if not editable_columns:
                raise HTTPException(status_code=400, detail="No editable columns are configured for this table.")

            updated_count = 0
            target_object = quote_identifier(owner) + "." + quote_identifier(table_name)
            where_sql = f" AND ({where_clause})" if where_clause else ""
            cursor = conn.cursor()
            try:
                for change in changes:
                    column_name = data_work.require_identifier(change.columnName, "columnName")
                    if column_name not in column_names:
                        raise HTTPException(status_code=400, detail=f"Column is not updatable for target table: {column_name}")
                    if column_name not in editable_columns:
                        raise HTTPException(status_code=400, detail=f"Column is not configured as editable: {column_name}")
                    row_id = str(change.rowId or "").strip()
                    if not re.match(r"^[A-Za-z0-9+/=._-]+$", row_id):
                        raise HTTPException(status_code=400, detail="Invalid row identifier.")

                    if is_predicted_type_table(table_name):
                        updated_count += merge_predicted_type_final(
                            cursor,
                            owner,
                            table_name,
                            row_id,
                            column_name,
                            normalize_update_value(change.value),
                            get_request_user_id(request),
                            where_clause
                        )
                        continue

                    set_items = [f"{quote_identifier(column_name)} = :value"]
                    params = {"value": normalize_update_value(change.value), "row_id": row_id}
                    if is_predicted_type_final_table(table_name):
                        if "FINAL_UPDATE_DT" in column_names:
                            set_items.append('"FINAL_UPDATE_DT" = SYSDATE')
                        if "FINAL_UPDATE_USER" in column_names:
                            set_items.append('"FINAL_UPDATE_USER" = :final_update_user')
                            params["final_update_user"] = get_request_user_id(request)

                    sql = (
                        f"UPDATE {target_object} "
                        f"SET {', '.join(set_items)} "
                        f"WHERE ROWID = CHARTOROWID(:row_id){where_sql}"
                    )
                    cursor.execute(sql, params)
                    updated_count += max(cursor.rowcount or 0, 0)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                cursor.close()

            return {
                "status": "success",
                "updated": updated_count,
                "message": f"{updated_count} cells updated."
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"{MENU_CODE} editable data update failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn:
                conn.close()
     
     
    @router.post("/sql/transaction/start")
    def start_sql_transaction(request: Request):
        cleanup_expired_transactions()
        conn = get_target_db_connection(request)
        transaction_id = register_transaction_connection(conn)

        return {
            "status": "success",
            "transactionId": transaction_id,
            "message": "Transaction started."
        }


    @router.post("/sql/transaction/commit")
    def commit_sql_transaction(req: SqlTransactionRequest):
        if not req.transactionId:
            raise HTTPException(status_code=400, detail="transactionId is required.")
        return finish_transaction(req.transactionId, "commit")


    @router.post("/sql/transaction/rollback")
    def rollback_sql_transaction(req: SqlTransactionRequest):
        if not req.transactionId:
            raise HTTPException(status_code=400, detail="transactionId is required.")
        return finish_transaction(req.transactionId, "rollback")


    @router.post("/sql")
    def execute_sql(req: SqlRequest, request: Request):
        sql_text = (req.sql or "").strip()
        limit = normalize_limit(req.limit)
        conn = None
        use_transaction = bool(req.transactionId)
        auto_start_transaction = False
        auto_transaction_id = None
        try:
            started_at = time.perf_counter()
            executable_script = normalize_executable_script(sql_text)
            auto_start_transaction = (
                not use_transaction
                and executable_script is not None
                and executable_script["type"] == "DML"
            )
            conn = get_transaction_connection(req.transactionId) if use_transaction else get_target_db_connection(request)
            if executable_script and executable_script["type"] != "SELECT":
                message = execute_worksheet_script(conn, executable_script, req.runtimeBindValues or {})
                if auto_start_transaction:
                    auto_transaction_id = register_transaction_connection(conn)
                    message = f"{message} Transaction started. Commit or rollback is required."
                elif not use_transaction:
                    conn.commit()
                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                return {
                    "status": "success",
                    "message": message,
                    "data": [],
                    "columns": [],
                    "total": 0,
                    "elapsedMs": elapsed_ms,
                    "transactionId": req.transactionId or auto_transaction_id
                }
    
            sql = executable_script["text"] if executable_script else normalize_select_sql(sql_text)
            sql, bind_values = prepare_runtime_script(sql, req.runtimeBindValues or {})
            result = execute_query(conn, f"{SQL_PREFIX}_SQL_WORKSHEET", {
                "dynamicSql": sql,
                "limit": limit,
                **bind_values
            })
            response = normalize_sql_result(data_work.require_success(result, "SQL execution failed."))
            response["message"] = f"{response.get('total', 0)} rows selected."
            response["elapsedMs"] = int((time.perf_counter() - started_at) * 1000)
            response["transactionId"] = req.transactionId
            return response
        except HTTPException:
            if conn and auto_start_transaction and not auto_transaction_id:
                conn.rollback()
                conn.close()
            elif conn and not use_transaction:
                conn.rollback()
            raise
        except Exception as e:
            if conn and auto_start_transaction and not auto_transaction_id:
                conn.rollback()
                conn.close()
            elif conn and not use_transaction:
                conn.rollback()
            logger.error(f"{MENU_CODE} SQL execution failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if conn and not use_transaction and not auto_start_transaction:
                conn.close()
    
    
    @router.post("/sql/save-table")
    def save_sql_result_table(req: SaveSqlTableRequest, request: Request):
        sql = normalize_select_sql(req.sql)
        target_table = data_work.require_identifier(req.targetTableName, "targetTableName")
        result_owner = data_work.normalize_optional_identifier(req.resultOwner)
        target_object = quote_identifier(target_table)
        if result_owner:
            target_object = quote_identifier(result_owner) + "." + target_object
    
        conn = None
        cursor = None
        try:
            conn = get_target_db_connection(request)
            cursor = conn.cursor()
            cursor.execute(f"CREATE TABLE {target_object} AS SELECT * FROM ({sql})")
            if req.profileJobId:
                data_work.update_job_status(
                    conn,
                    MENU_CODE,
                    int(req.profileJobId),
                    "RESULT_SAVED",
                    "SQL result table was created.",
                    target_table,
                    result_owner,
                    False,
                    True
                )
            conn.commit()
            return {
                "status": "success",
                "message": "SQL result table was created.",
                "resultOwner": result_owner,
                "tableName": target_table
            }
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} SQL result save failed: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    
    
    def run_profile_job_background(profile_job_id: int, connection_id: int, user_id: int, runtime_bind_values: Optional[Dict[str, Any]] = None):
        conn = None
        try:
            conn = get_target_db_connection_by_id(connection_id, user_id)
            execute_profile_job(conn, profile_job_id, runtime_bind_values or {})
            conn.commit()
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"{MENU_CODE} background job failed: {str(e)}")
        finally:
            if conn:
                conn.close()
    
    
    def execute_profile_job(conn, profile_job_id: int, runtime_bind_values: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        job = data_work.load_job(conn, MENU_CODE, profile_job_id)
        return execute_job_payload(conn, profile_job_id, job, runtime_bind_values or {}, update_saved_job=True)


    def execute_draft_profile_job(
        conn,
        profile_job_id: int,
        job: Dict[str, Any],
        runtime_bind_values: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        return execute_job_payload(
            conn,
            profile_job_id,
            job,
            runtime_bind_values or {},
            run_type_override="DRAFT_TEST",
            update_saved_job=False
        )


    def execute_job_payload(
        conn,
        profile_job_id: int,
        job: Dict[str, Any],
        runtime_bind_values: Optional[Dict[str, Any]] = None,
        run_type_override: Optional[str] = None,
        update_saved_job: bool = True
    ) -> Dict[str, Any]:
        exec_source_type = str(job.get("EXEC_SOURCE_TYPE") or "").upper()
        run_type = "WEB_API" if exec_source_type == "WEB_API" else ("OML_PYTHON" if exec_source_type == "OML_PYTHON" else "PLSQL")
        if run_type_override:
            run_type = run_type_override
        result_owner = job.get("RESULT_OWNER") or ""
        saved_result_table_name = job.get("RESULT_TABLE_NAME") or ""
        result_table_name = saved_result_table_name
        data_run_id = resolve_data_run_id(conn, job, runtime_bind_values)
        runtime_bind_values = with_data_run_id(runtime_bind_values, data_run_id)
        work_run_id = data_work.create_run(
            conn,
            profile_job_id,
            run_type,
            "STARTED",
            ROUTER_MESSAGES["job_started"],
            result_table_name,
            result_owner,
            data_run_id
        )
        result_table_name = get_effective_result_table_name(job, runtime_bind_values or {}, data_run_id)
        if result_table_name != saved_result_table_name:
            job = {**job, "RESULT_TABLE_NAME": result_table_name}
        if update_saved_job:
            data_work.update_job_status(
                conn,
                MENU_CODE,
                profile_job_id,
                "RUNNING",
                ROUTER_MESSAGES["job_started"],
                saved_result_table_name or result_table_name,
                result_owner,
                True,
                False
            )
        conn.commit()
    
        try:
            if exec_source_type == "WEB_API":
                message = execute_web_api_job(conn, job, runtime_bind_values or {}, data_run_id)
                if not update_saved_job:
                    draft_name = job.get("JOB_NAME") or f"Job #{profile_job_id}"
                    message = f"Draft test: {draft_name}. {message}"
                data_work.update_run(conn, work_run_id, "SUCCESS", message, result_table_name, result_owner)
                if update_saved_job:
                    data_work.update_job_status(
                        conn,
                        MENU_CODE,
                        profile_job_id,
                        "SUCCESS",
                        message,
                        saved_result_table_name or result_table_name,
                        result_owner,
                        False,
                        True
                    )
                return {"status": "success", "message": message, "dataRunId": data_run_id, "workRunId": work_run_id}

            executable_script = normalize_executable_script(job.get("EXEC_PLSQL") or "")
            if not executable_script:
                message = "No executable script was saved."
                data_work.update_run(conn, work_run_id, "SKIPPED", message, result_table_name, result_owner)
                if update_saved_job:
                    data_work.update_job_status(
                        conn,
                        MENU_CODE,
                        profile_job_id,
                        "DRAFT",
                        message,
                        saved_result_table_name or result_table_name,
                        result_owner,
                        False,
                        True
                    )
                return {"status": "skipped", "message": message, "dataRunId": data_run_id, "workRunId": work_run_id}
    
            message = execute_saved_script(conn, executable_script, job, runtime_bind_values or {}, data_run_id)
            if not update_saved_job:
                draft_name = job.get("JOB_NAME") or f"Job #{profile_job_id}"
                message = f"Draft test: {draft_name}. {message}"
            data_work.update_run(conn, work_run_id, "SUCCESS", message, result_table_name, result_owner)
            if update_saved_job:
                data_work.update_job_status(
                    conn,
                    MENU_CODE,
                    profile_job_id,
                    "SUCCESS",
                    message,
                    saved_result_table_name or result_table_name,
                    result_owner,
                    False,
                    True
                )
            return {"status": "success", "message": message, "dataRunId": data_run_id, "workRunId": work_run_id}
        except Exception as e:
            message = str(e)
            conn.rollback()
            data_work.update_run(conn, work_run_id, "FAILED", message, result_table_name, result_owner)
            if update_saved_job:
                data_work.update_job_status(
                    conn,
                    MENU_CODE,
                    profile_job_id,
                    "FAILED",
                    message,
                    saved_result_table_name or result_table_name,
                    result_owner,
                    False,
                    True
                )
            conn.commit()
            raise


    def execute_web_api_job(
        conn,
        job: Dict[str, Any],
        runtime_bind_values: Optional[Dict[str, Any]] = None,
        run_id: Optional[int] = None
    ) -> str:
        system_values = build_system_bind_values(job, run_id)
        runtime_values = {
            **system_values,
            **(runtime_bind_values or {})
        }
        apply_scoped_model_runtime_values(job, runtime_values, run_id)
        for run_key in ("INIT$RunSourceType", "INIT$RunId", "runSourceType", "runId"):
            runtime_values[run_key] = system_values[run_key]
        runtime_values["P_RUN_SOURCE_TYPE"] = system_values["INIT$RunSourceType"]
        runtime_values["P_RUN_ID"] = system_values["INIT$RunId"]
        return api_call_service.execute_api_job(conn, job, runtime_values, run_id)
    
    
    def execute_saved_script(
        conn,
        executable_script: Dict[str, str],
        job: Dict[str, Any],
        runtime_bind_values: Optional[Dict[str, Any]] = None,
        run_id: Optional[int] = None
    ) -> str:
        cursor = conn.cursor()
        try:
            script_text, bind_values = prepare_saved_script(executable_script["text"], job, runtime_bind_values or {}, run_id)
            cursor.execute(script_text, bind_values)
            script_type = executable_script["type"]
            label = job.get("EXEC_OBJECT_LABEL") or job.get("EXEC_OBJECT_NAME") or script_type
            if script_type == "SELECT":
                return f"{label} SELECT statement executed."
            if script_type == "DDL":
                return f"{label} DDL statement executed."
            return f"{label} PL/SQL block executed."
        finally:
            cursor.close()


    def prepare_saved_script(
        script_text: str,
        job: Dict[str, Any],
        runtime_bind_values: Optional[Dict[str, Any]] = None,
        run_id: Optional[int] = None
    ) -> tuple[str, Dict[str, Any]]:
        params = job.get("PARAMS") or []
        param_values = {
            str(param.get("itemName") or param.get("ITEM_NAME") or ""): param.get("itemDefault", param.get("ITEM_DEFAULT"))
            for param in params
            if param.get("itemName") or param.get("ITEM_NAME")
        }

        system_values = build_system_bind_values(job, run_id)
        runtime_values = {
            **system_values,
            **(runtime_bind_values or {})
        }
        apply_scoped_model_runtime_values(job, runtime_values, run_id)
        for run_key in ("INIT$RunSourceType", "INIT$RunId", "runSourceType", "runId"):
            runtime_values[run_key] = system_values[run_key]
        runtime_values["P_RUN_SOURCE_TYPE"] = system_values["INIT$RunSourceType"]
        runtime_values["P_RUN_ID"] = system_values["INIT$RunId"]

        def replace_dynamic_token(match):
            key = match.group(1).strip()
            value = runtime_values.get(key)
            if value is None:
                value = runtime_values.get(to_bind_variable_name(key))
            if value is None:
                value = param_values.get(key)
            return "" if normalize_bind_value(value) is None else str(value)

        prepared_text = re.sub(
            r"/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*(?:_[A-Za-z0-9_$#]+)*)\s*--\s*\*/",
            replace_dynamic_token,
            script_text or "",
        )

        bind_values_by_name = {
            to_bind_variable_name(param_name): value
            for param_name, value in param_values.items()
        }
        for runtime_name, runtime_value in runtime_values.items():
            bind_values_by_name[runtime_name] = runtime_value
            if "_" in str(runtime_name):
                bind_values_by_name[to_bind_variable_name(runtime_name)] = runtime_value
        bind_scan_text = mask_sql_for_bind_scan(prepared_text)
        used_bind_names = set(re.findall(r"(?<!:):([A-Za-z][A-Za-z0-9_$#]*)", bind_scan_text))
        bind_values = {
            bind_name: normalize_bind_value(bind_values_by_name.get(bind_name))
            for bind_name in used_bind_names
        }
        return prepared_text, bind_values


    LEGACY_ASSOCIATION_MODEL_NAMES = {"OML_ASSOCIATION_MODEL_01"}


    def is_apriori_association_job(job: Dict[str, Any]) -> bool:
        object_name = str(job.get("EXEC_OBJECT_NAME") or job.get("execObjectName") or "").strip().upper()
        return object_name == "INIT$_SP_APRIORI_ASSOC_MODEL"


    def create_scoped_model_name(prefix: str, seed: str) -> str:
        safe_prefix = re.sub(r"[^A-Z0-9_$#]", "_", str(prefix or "OML_MODEL").strip().upper())
        safe_prefix = re.sub(r"^[^A-Z]+", "", safe_prefix) or "OML_MODEL"
        safe_seed = re.sub(r"[^A-Z0-9_$#]", "_", str(seed or "MODEL").strip().upper())
        safe_seed = re.sub(r"^[^A-Z]+", "", safe_seed) or "MODEL"
        max_seed_length = max(1, 128 - len(safe_prefix) - 1)
        return f"{safe_prefix}_{safe_seed[-max_seed_length:]}"[:128]


    def resolve_scoped_apriori_model_name(
        job: Dict[str, Any],
        runtime_values: Optional[Dict[str, Any]] = None,
        run_id: Optional[int] = None
    ) -> str:
        runtime_values = runtime_values or {}
        base_name = (
            runtime_values.get("INIT$ResultModelName")
            or runtime_values.get("INIT$ResultTable")
            or job.get("RESULT_TABLE_NAME")
            or job.get("resultTableName")
            or ""
        )
        normalized_base = str(base_name or "").strip().upper()
        if not is_apriori_association_job(job) or normalized_base not in LEGACY_ASSOCIATION_MODEL_NAMES:
            return normalized_base
        target_table = (
            runtime_values.get("INIT$TargetTable")
            or job.get("TABLE_NAME")
            or job.get("tableName")
            or normalized_base
        )
        return create_scoped_model_name("OML_ASSOC", str(target_table or normalized_base))


    def apply_scoped_model_runtime_values(
        job: Dict[str, Any],
        runtime_values: Dict[str, Any],
        run_id: Optional[int] = None
    ) -> None:
        if not is_apriori_association_job(job):
            return
        model_name = resolve_scoped_apriori_model_name(job, runtime_values, run_id)
        if not model_name:
            return
        runtime_values["INIT$ResultModelName"] = model_name
        runtime_values["INIT$ResultTable"] = model_name
        for key in ("P_MODEL_NAME", "pModelName", "modelName"):
            value = str(runtime_values.get(key) or "").strip()
            if not value or value.upper() in LEGACY_ASSOCIATION_MODEL_NAMES or value in {":INIT$ResultModelName", ":INIT$ResultTable"}:
                runtime_values[key] = model_name


    def get_effective_result_table_name(
        job: Dict[str, Any],
        runtime_values: Optional[Dict[str, Any]] = None,
        run_id: Optional[int] = None
    ) -> str:
        result_table = job.get("RESULT_TABLE_NAME") or job.get("resultTableName") or ""
        result_mode = str(job.get("RESULT_CREATE_YN") or job.get("resultCreateYn") or "").strip().upper()
        if result_mode != "M":
            return str(result_table or "")
        return resolve_scoped_apriori_model_name(job, runtime_values or {}, run_id) or str(result_table or "")


    def build_system_bind_values(job: Dict[str, Any], run_id: Optional[int] = None) -> Dict[str, Any]:
        target_owner = job.get("OWNER_NAME") or job.get("ownerName") or ""
        target_table = job.get("TABLE_NAME") or job.get("tableName") or ""
        result_owner = job.get("RESULT_OWNER") or job.get("resultOwner") or ""
        result_table = get_effective_result_table_name(job, {}, run_id)
        effective_run_id = int(run_id or 0)
        return {
            "INIT$TargetOwner": target_owner,
            "INIT$TargetTable": target_table,
            "INIT$ResultOwner": result_owner,
            "INIT$ResultTable": result_table,
            "INIT$ResultModelName": result_table,
            "INIT$RunSourceType": "DATA_WORK",
            "INIT$RunId": effective_run_id,
            "runSourceType": "DATA_WORK",
            "runId": effective_run_id
        }


    def mask_sql_for_bind_scan(sql_text: str) -> str:
        text = sql_text or ""
        text = re.sub(r"(?s)'(?:''|[^'])*'", lambda match: " " * len(match.group(0)), text)
        text = re.sub(r'(?s)"(?:""|[^"])*"', lambda match: " " * len(match.group(0)), text)
        text = re.sub(r"(?s)/\*.*?\*/", lambda match: " " * len(match.group(0)), text)
        text = re.sub(r"(?m)--[^\r\n]*", lambda match: " " * len(match.group(0)), text)
        return text


    def to_bind_variable_name(parameter_name: str) -> str:
        parts = [part for part in str(parameter_name or "").strip().split("_") if part]
        if not parts:
            return "paramValue"
        result = []
        for index, part in enumerate(parts):
            lower = part.lower()
            result.append(lower if index == 0 else lower[:1].upper() + lower[1:])
        return "".join(result)


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
                f"  FROM {owner_prefix}{quote_identifier(view_name)}",
                " WHERE ROWNUM <= 100;",
                ""
            ])

        if not any(row.get("existsYn") == "Y" for row in views):
            lines.extend([
                "-- No DM$ detail views were found for this model yet.",
                "-- Check USER_MINING_MODELS and INIT$_SP_DM_MODEL_VIEW_LIST."
            ])
        return "\n".join(lines).strip(), views


    def normalize_bind_value(value: Any) -> Any:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if text.lower() in {"null", "(null)", "(auto)"}:
            return None
        if re.fullmatch(r"-?\d+", text):
            try:
                return int(text)
            except Exception:
                return text
        if re.fullmatch(r"-?\d+\.\d+", text):
            try:
                return float(text)
            except Exception:
                return text
        return value
    
    
    def execute_worksheet_plsql(conn, sql_text: str) -> str:
        exec_plsql = normalize_plsql_script(sql_text)
        cursor = conn.cursor()
        try:
            cursor.execute(exec_plsql)
            return "PL/SQL block executed."
        finally:
            cursor.close()
    
    
    def execute_worksheet_script(conn, executable_script: Dict[str, str], runtime_bind_values: Optional[Dict[str, Any]] = None) -> str:
        cursor = conn.cursor()
        try:
            script_text, bind_values = prepare_runtime_script(executable_script["text"], runtime_bind_values or {})
            cursor.execute(script_text, bind_values)
            if executable_script["type"] == "DDL":
                return "DDL statement executed."
            if executable_script["type"] == "DML":
                rowcount = cursor.rowcount if cursor.rowcount is not None else 0
                return f"DML statement executed. {rowcount} rows affected."
            return "PL/SQL block executed."
        finally:
            cursor.close()


    def prepare_runtime_script(script_text: str, runtime_bind_values: Optional[Dict[str, Any]] = None) -> tuple[str, Dict[str, Any]]:
        runtime_values = runtime_bind_values or {}

        def replace_dynamic_token(match):
            key = match.group(1).strip()
            value = runtime_values.get(key)
            if value is None:
                value = runtime_values.get(to_bind_variable_name(key))
            return "" if normalize_bind_value(value) is None else str(value)

        prepared_text = re.sub(
            r"/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*(?:_[A-Za-z0-9_$#]+)*)\s*--\s*\*/",
            replace_dynamic_token,
            script_text or "",
        )
        bind_values_by_name = {}
        for runtime_name, runtime_value in runtime_values.items():
            bind_values_by_name[str(runtime_name)] = runtime_value
            if "_" in str(runtime_name):
                bind_values_by_name[to_bind_variable_name(str(runtime_name))] = runtime_value

        bind_scan_text = mask_sql_for_bind_scan(prepared_text)
        used_bind_names = set(re.findall(r"(?<!:):([A-Za-z][A-Za-z0-9_$#]*)", bind_scan_text))
        bind_values = {
            bind_name: normalize_bind_value(bind_values_by_name.get(bind_name))
            for bind_name in used_bind_names
        }
        return prepared_text, bind_values


    def is_plsql_script(sql_text: str) -> bool:
        return bool(re.match(r"(?is)^\s*(declare|begin)\b", sql_text or ""))
    
    
    def require_table(req: TableRequest) -> tuple[str, str]:
        return (
            data_work.require_identifier(req.owner, "owner"),
            data_work.require_identifier(req.tableName, "tableName")
        )
    
    
    def quote_identifier(value: str) -> str:
        return '"' + str(value).replace('"', '""') + '"'
    
    
    def normalize_limit(value: Optional[int]) -> int:
        try:
            limit = int(value or 100)
        except (TypeError, ValueError):
            limit = 100
        return max(1, min(limit, 1000))


    def normalize_where_clause(value: Optional[str]) -> str:
        text = (value or "").strip()
        if not text:
            return ""
        text = re.sub(r";+\s*$", "", text).strip()
        text = re.sub(r"(?is)^\s*where\s+", "", text).strip()
        if len(text) > 2000:
            raise HTTPException(status_code=400, detail="WHERE condition is too long.")
        if re.search(r";\s*\S", value or "") or re.search(r"(--|/\*|\*/)", text):
            raise HTTPException(status_code=400, detail="Only a single WHERE condition is allowed.")
        blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec|commit|rollback)\b"
        if re.search(blocked, text, re.IGNORECASE):
            raise HTTPException(status_code=400, detail="WHERE condition contains a blocked keyword.")
        return text


    def normalize_order_by_clause(value: Optional[str], column_names: set[str]) -> str:
        text = (value or "").strip()
        if not text:
            return ""
        text = re.sub(r";+\s*$", "", text).strip()
        text = re.sub(r"(?is)^\s*order\s+by\s+", "", text).strip()
        if len(text) > 1000:
            raise HTTPException(status_code=400, detail="ORDER BY condition is too long.")
        if re.search(r";\s*\S", value or "") or re.search(r"(--|/\*|\*/)", text):
            raise HTTPException(status_code=400, detail="Only a single ORDER BY condition is allowed.")
        blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec|commit|rollback)\b"
        if re.search(blocked, text, re.IGNORECASE):
            raise HTTPException(status_code=400, detail="ORDER BY condition contains a blocked keyword.")

        column_lookup = {column.upper(): column for column in column_names}
        order_items = []
        for raw_item in [item.strip() for item in text.split(",") if item.strip()]:
            match = re.fullmatch(
                r'"?([A-Za-z][A-Za-z0-9_$#]*)"?(\s+(ASC|DESC))?(\s+NULLS\s+(FIRST|LAST))?',
                raw_item,
                re.IGNORECASE
            )
            if not match:
                raise HTTPException(status_code=400, detail=f"Invalid ORDER BY expression: {raw_item}")
            column_name = match.group(1).upper()
            if column_name not in column_lookup:
                raise HTTPException(status_code=400, detail=f"ORDER BY column was not found: {column_name}")
            direction = (match.group(3) or "").upper()
            nulls = (match.group(5) or "").upper()
            item_sql = quote_identifier(column_lookup[column_name])
            if direction:
                item_sql += f" {direction}"
            if nulls:
                item_sql += f" NULLS {nulls}"
            order_items.append(item_sql)

        return ", ".join(order_items)


    def get_table_column_names(conn, owner: str, table_name: str) -> set[str]:
        return set(get_table_column_list(conn, owner, table_name))


    def get_table_column_list(conn, owner: str, table_name: str) -> List[str]:
        result = execute_query(conn, "DATA_WORK_TABLE_COLUMN_NAMES", {"owner": owner, "tableName": table_name})
        rows = data_work.require_success(result, "Target table column query failed.").get("data", [])
        return [str(row.get("COLUMN_NAME") or "").upper() for row in rows if row.get("COLUMN_NAME")]


    def get_editable_data_columns(table_name: str) -> set[str]:
        if MENU_CODE == "M03001" and (is_predicted_type_table(table_name) or is_predicted_type_final_table(table_name)):
            return {"FINAL_PREDICTED_TYPE", "FINAL_REASON"}
        return set()


    def fetch_editable_table_data(conn, owner: str, table_name: str, limit: int, where_clause: str, order_by_clause: str) -> Dict[str, Any]:
        target_object = quote_identifier(owner) + "." + quote_identifier(table_name)
        where_sql = f" WHERE {where_clause}" if where_clause else ""
        order_sql = f" ORDER BY {order_by_clause}" if order_by_clause else ""
        sql = (
            f"SELECT * FROM ("
            f"SELECT ROWIDTOCHAR(T.ROWID) AS \"INIT$ROWID\", T.* "
            f"FROM {target_object} T{where_sql}{order_sql}"
            f") WHERE ROWNUM <= :limit"
        )
        cursor = conn.cursor()
        try:
            cursor.execute(sql, {"limit": limit})
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            data = [
                {column: serialize_db_value(value) for column, value in zip(columns, row)}
                for row in rows
            ]
            return {
                "status": "success",
                "data": data,
                "columns": columns,
                "total": len(data)
            }
        finally:
            cursor.close()


    def is_predicted_type_table(table_name: str) -> bool:
        return str(table_name or "").upper() == "INIT$_TB_PREDICTED_TYPE"


    def is_predicted_type_final_table(table_name: str) -> bool:
        return str(table_name or "").upper() == "INIT$_TB_PREDICTED_TYPE_FINAL"


    def final_table_object(owner: str) -> str:
        return quote_identifier(owner) + "." + quote_identifier("INIT$_TB_PREDICTED_TYPE_FINAL")


    def merge_predicted_type_final(
        cursor,
        owner: str,
        table_name: str,
        row_id: str,
        column_name: str,
        value: Any,
        user_id: Any,
        where_clause: str = ""
    ) -> int:
        target_object = quote_identifier(owner) + "." + quote_identifier(table_name)
        final_object = final_table_object(owner)
        where_sql = f" AND ({where_clause})" if where_clause else ""
        source_sql = (
            'SELECT R."RUN_SOURCE_TYPE", R."RUN_ID", R."OWNER", R."TABLE_NAME", R."MODEL_NAME", '
            '       COALESCE(R."COLUMN_DESC", TC.COMMENTS) AS "COLUMN_DESC", '
            '       R."COLUMN_ID", R."COLUMN_NAME", R."DATA_TYPE", R."BASE_PREDICTED_TYPE", '
            '       R."MODL_PREDICTED_TYPE", R."FINAL_PREDICTED_TYPE", R."FINAL_REASON", '
            '       F."FINAL_PREDICTED_TYPE" AS "SAVED_FINAL_PREDICTED_TYPE", '
            '       F."FINAL_REASON" AS "SAVED_FINAL_REASON" '
            "  FROM ("
            f"SELECT T.* FROM {target_object} T "
            " WHERE T.ROWID = CHARTOROWID(:row_id)"
            f"{where_sql}"
            ") R "
            f"  LEFT JOIN {final_object} F "
            '    ON F."OWNER" = R."OWNER" '
            '   AND F."TABLE_NAME" = R."TABLE_NAME" '
            '   AND F."COLUMN_NAME" = R."COLUMN_NAME" '
            '  LEFT JOIN ALL_COL_COMMENTS TC '
            '    ON TC.OWNER = R."OWNER" '
            '   AND TC.TABLE_NAME = R."TABLE_NAME" '
            '   AND TC.COLUMN_NAME = R."COLUMN_NAME" '
        )
        cursor.execute(source_sql, {"row_id": row_id})
        row = cursor.fetchone()
        if not row:
            return 0
        columns = [desc[0] for desc in cursor.description]
        source = {col: row[index] for index, col in enumerate(columns)}
        final_type = value if column_name == "FINAL_PREDICTED_TYPE" else (
            source.get("SAVED_FINAL_PREDICTED_TYPE") or source.get("FINAL_PREDICTED_TYPE")
        )
        final_reason = value if column_name == "FINAL_REASON" else (
            source.get("SAVED_FINAL_REASON") or source.get("FINAL_REASON")
        )
        if final_type is None or str(final_type).strip() == "":
            final_type = source.get("MODL_PREDICTED_TYPE") or source.get("BASE_PREDICTED_TYPE")
        if final_type is None or str(final_type).strip() == "":
            raise HTTPException(status_code=400, detail="FINAL_PREDICTED_TYPE is required before saving final reason.")

        merge_sql = f"""
MERGE INTO {final_object} F
USING (
    SELECT :owner AS "OWNER"
         , :table_name AS "TABLE_NAME"
         , :column_name AS "COLUMN_NAME"
         , :column_desc AS "COLUMN_DESC"
         , :column_id AS "COLUMN_ID"
         , :data_type AS "DATA_TYPE"
         , :source_run_source_type AS "SOURCE_RUN_SOURCE_TYPE"
         , :source_run_id AS "SOURCE_RUN_ID"
         , :source_model_name AS "SOURCE_MODEL_NAME"
         , :base_predicted_type AS "BASE_PREDICTED_TYPE"
         , :modl_predicted_type AS "MODL_PREDICTED_TYPE"
         , :final_predicted_type AS "FINAL_PREDICTED_TYPE"
         , :final_reason AS "FINAL_REASON"
         , :final_update_user AS "FINAL_UPDATE_USER"
      FROM DUAL
) S
   ON (F."OWNER" = S."OWNER"
  AND F."TABLE_NAME" = S."TABLE_NAME"
  AND F."COLUMN_NAME" = S."COLUMN_NAME")
 WHEN MATCHED THEN UPDATE
      SET F."COLUMN_DESC" = S."COLUMN_DESC"
        , F."COLUMN_ID" = S."COLUMN_ID"
        , F."DATA_TYPE" = S."DATA_TYPE"
        , F."SOURCE_RUN_SOURCE_TYPE" = S."SOURCE_RUN_SOURCE_TYPE"
        , F."SOURCE_RUN_ID" = S."SOURCE_RUN_ID"
        , F."SOURCE_MODEL_NAME" = S."SOURCE_MODEL_NAME"
        , F."BASE_PREDICTED_TYPE" = S."BASE_PREDICTED_TYPE"
        , F."MODL_PREDICTED_TYPE" = S."MODL_PREDICTED_TYPE"
        , F."FINAL_PREDICTED_TYPE" = S."FINAL_PREDICTED_TYPE"
        , F."FINAL_REASON" = S."FINAL_REASON"
        , F."FINAL_UPDATE_DT" = SYSDATE
        , F."FINAL_UPDATE_USER" = S."FINAL_UPDATE_USER"
 WHEN NOT MATCHED THEN INSERT (
        "OWNER"
      , "TABLE_NAME"
      , "COLUMN_NAME"
      , "COLUMN_DESC"
      , "COLUMN_ID"
      , "DATA_TYPE"
      , "SOURCE_RUN_SOURCE_TYPE"
      , "SOURCE_RUN_ID"
      , "SOURCE_MODEL_NAME"
      , "BASE_PREDICTED_TYPE"
      , "MODL_PREDICTED_TYPE"
      , "FINAL_PREDICTED_TYPE"
      , "FINAL_REASON"
      , "FINAL_UPDATE_DT"
      , "FINAL_UPDATE_USER"
      , "CREATE_DT"
      )
      VALUES (
        S."OWNER"
      , S."TABLE_NAME"
      , S."COLUMN_NAME"
      , S."COLUMN_DESC"
      , S."COLUMN_ID"
      , S."DATA_TYPE"
      , S."SOURCE_RUN_SOURCE_TYPE"
      , S."SOURCE_RUN_ID"
      , S."SOURCE_MODEL_NAME"
      , S."BASE_PREDICTED_TYPE"
      , S."MODL_PREDICTED_TYPE"
      , S."FINAL_PREDICTED_TYPE"
      , S."FINAL_REASON"
      , SYSDATE
      , S."FINAL_UPDATE_USER"
      , SYSDATE
      )
"""
        cursor.execute(merge_sql, {
            "owner": source.get("OWNER"),
            "table_name": source.get("TABLE_NAME"),
            "column_name": source.get("COLUMN_NAME"),
            "column_desc": source.get("COLUMN_DESC"),
            "column_id": source.get("COLUMN_ID"),
            "data_type": source.get("DATA_TYPE"),
            "source_run_source_type": source.get("RUN_SOURCE_TYPE"),
            "source_run_id": source.get("RUN_ID"),
            "source_model_name": source.get("MODEL_NAME"),
            "base_predicted_type": source.get("BASE_PREDICTED_TYPE"),
            "modl_predicted_type": source.get("MODL_PREDICTED_TYPE"),
            "final_predicted_type": final_type,
            "final_reason": final_reason,
            "final_update_user": str(user_id or "")
        })
        return 1


    def normalize_update_value(value: Any) -> Any:
        if isinstance(value, str):
            return value
        return serialize_db_value(value)
     
     
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
    
    
    def normalize_plsql_script(script: str) -> str:
        text = (script or "").strip()
        text = re.sub(r"(?m)^\s*/\s*$", "", text).strip()
        if not text:
            return ""
        if not re.match(r"(?is)^(declare|begin)\b", text):
            raise HTTPException(status_code=400, detail="Executable script must start with DECLARE or BEGIN.")
        if not re.search(r"(?is)\bend\s*;\s*$", text):
            raise HTTPException(status_code=400, detail="Executable PL/SQL script must end with END;.")
        return text
    
    
    def normalize_executable_script(script: str) -> Optional[Dict[str, str]]:
        text = (script or "").strip()
        text = re.sub(r"(?m)^\s*/\s*$", "", text).strip()
        if not text:
            return None
        if re.match(r"(?is)^(declare|begin)\b", text):
            return {"type": "PLSQL", "text": normalize_plsql_script(text)}
    
        sql = re.sub(r";+\s*$", "", text).strip()
        if re.search(r";\s*\S", sql):
            raise HTTPException(status_code=400, detail="Only a single executable statement is allowed.")
        if re.match(r"(?is)^(select|with)\b", sql):
            return {"type": "SELECT", "text": sql}
        if re.match(r"(?is)^create\s+table\b", sql):
            return {"type": "DDL", "text": sql}
        if re.match(r"(?is)^(insert|update|delete|merge)\b", sql):
            return {"type": "DML", "text": sql}
        raise HTTPException(status_code=400, detail="Executable script must be PL/SQL, SELECT, CREATE TABLE, or DML.")


    def normalize_lob_row(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            key: value.read() if hasattr(value, "read") else value
            for key, value in row.items()
        }


    def normalize_sql_result(result: Dict[str, Any]) -> Dict[str, Any]:
        result["data"] = [
            {key: serialize_db_value(value) for key, value in row.items()}
            for row in result.get("data", [])
        ]
        return result


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
            except UnicodeDecodeError:
                return value.hex()
        if isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (list, tuple)):
            return [serialize_db_value(item) for item in value]
        if isinstance(value, dict):
            return {str(key): serialize_db_value(item) for key, item in value.items()}
        if hasattr(value, "aslist"):
            try:
                return [serialize_db_value(item) for item in value.aslist()]
            except Exception:
                pass
        if hasattr(value, "asdict"):
            try:
                return {str(key): serialize_db_value(item) for key, item in value.asdict().items()}
            except Exception:
                pass
        object_type = getattr(value, "type", None)
        attributes = getattr(object_type, "attributes", None)
        if attributes:
            try:
                return {
                    str(attribute.name): serialize_db_value(getattr(value, attribute.name))
                    for attribute in attributes
                }
            except Exception:
                pass
        return str(value)
    

    return router
