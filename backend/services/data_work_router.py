"""
@file           data_work_router.py
@description    Shared data workbench API router factory
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, Optional
import logging
import re
import threading
import time
import uuid

from backend.target_database import get_target_connection_id, get_target_db_connection, get_target_db_connection_by_id
from backend.auth_context import get_request_user_id
from backend.database_helper import execute_query
from backend.services import data_work_service as data_work
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
    
    
    @router.post("/job/run")
    def run_profile_job(req: RunJobRequest, background_tasks: BackgroundTasks, request: Request):
        conn = None
        try:
            conn = get_target_db_connection(request)
            profile_job_id = data_work.require_int(req.profileJobId, "profileJobId")
            job = data_work.load_job(conn, MENU_CODE, profile_job_id)
            runtime_bind_values = req.runtimeBindValues or {}
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
                background_tasks.add_task(
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
            return data_work.require_success(result, "Data query failed.")
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
            response = data_work.require_success(result, "SQL execution failed.")
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
        run_type = "OML_PYTHON" if str(job.get("EXEC_SOURCE_TYPE") or "").upper() == "OML_PYTHON" else "PLSQL"
        result_owner = job.get("RESULT_OWNER") or ""
        result_table_name = job.get("RESULT_TABLE_NAME") or ""
        run_id = data_work.create_run(
            conn,
            profile_job_id,
            run_type,
            "STARTED",
            ROUTER_MESSAGES["job_started"],
            result_table_name,
            result_owner
        )
        data_work.update_job_status(
            conn,
            MENU_CODE,
            profile_job_id,
            "RUNNING",
            ROUTER_MESSAGES["job_started"],
            result_table_name,
            result_owner,
            True,
            False
        )
        conn.commit()
    
        try:
            executable_script = normalize_executable_script(job.get("EXEC_PLSQL") or "")
            if not executable_script:
                message = "No executable script was saved."
                data_work.update_run(conn, run_id, "SKIPPED", message, result_table_name, result_owner)
                data_work.update_job_status(
                    conn,
                    MENU_CODE,
                    profile_job_id,
                    "DRAFT",
                    message,
                    result_table_name,
                    result_owner,
                    False,
                    True
                )
                return {"status": "skipped", "message": message}
    
            message = execute_saved_script(conn, executable_script, job, runtime_bind_values or {})
            data_work.update_run(conn, run_id, "SUCCESS", message, result_table_name, result_owner)
            data_work.update_job_status(
                conn,
                MENU_CODE,
                profile_job_id,
                "SUCCESS",
                message,
                result_table_name,
                result_owner,
                False,
                True
            )
            return {"status": "success", "message": message}
        except Exception as e:
            message = str(e)
            conn.rollback()
            data_work.update_run(conn, run_id, "FAILED", message, result_table_name, result_owner)
            data_work.update_job_status(
                conn,
                MENU_CODE,
                profile_job_id,
                "FAILED",
                message,
                result_table_name,
                result_owner,
                False,
                True
            )
            conn.commit()
            raise
    
    
    def execute_saved_script(conn, executable_script: Dict[str, str], job: Dict[str, Any], runtime_bind_values: Optional[Dict[str, Any]] = None) -> str:
        cursor = conn.cursor()
        try:
            script_text, bind_values = prepare_saved_script(executable_script["text"], job, runtime_bind_values or {})
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


    def prepare_saved_script(script_text: str, job: Dict[str, Any], runtime_bind_values: Optional[Dict[str, Any]] = None) -> tuple[str, Dict[str, Any]]:
        params = job.get("PARAMS") or []
        param_values = {
            str(param.get("itemName") or param.get("ITEM_NAME") or ""): param.get("itemDefault", param.get("ITEM_DEFAULT"))
            for param in params
            if param.get("itemName") or param.get("ITEM_NAME")
        }

        runtime_values = {
            **(runtime_bind_values or {}),
            **build_system_bind_values(job)
        }

        def replace_dynamic_token(match):
            key = match.group(1).strip()
            value = runtime_values.get(key)
            if value is None:
                value = runtime_values.get(to_bind_variable_name(key))
            if value is None:
                value = param_values.get(key)
            return "" if value is None else str(value)

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
        used_bind_names = set(re.findall(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)", bind_scan_text))
        bind_values = {
            bind_name: normalize_bind_value(bind_values_by_name.get(bind_name))
            for bind_name in used_bind_names
        }
        return prepared_text, bind_values


    def build_system_bind_values(job: Dict[str, Any]) -> Dict[str, Any]:
        target_owner = job.get("OWNER_NAME") or job.get("ownerName") or ""
        target_table = job.get("TABLE_NAME") or job.get("tableName") or ""
        result_owner = job.get("RESULT_OWNER") or job.get("resultOwner") or ""
        result_table = job.get("RESULT_TABLE_NAME") or job.get("resultTableName") or ""
        return {
            "_TargetOwner": target_owner,
            "_TargetTable": target_table,
            "_ResultOwner": result_owner,
            "_ResultTable": result_table
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


    def normalize_bind_value(value: Any) -> Any:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if re.fullmatch(r"(?i)null", text):
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
            return "" if value is None else str(value)

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
        used_bind_names = set(re.findall(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)", bind_scan_text))
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
    

    return router
