"""
@file           M01002.py
@description    Scenario definition API
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Optional
import logging

from backend.database_helper import execute_query, SqlLoader
from backend.target_database import get_target_db_connection
from backend.auth_context import get_request_role_code, get_request_user_id, require_admin_role
from backend.services import work_context_service
from backend.services import admin_scope_purge_service

logger = logging.getLogger(__name__)
router = APIRouter()

SCENARIO_DEPENDENCY_LABELS = {
    "SCENARIO_TABLE_COUNT": "시나리오 테이블 등록",
    "DATA_WORK_JOB_COUNT": "데이터 작업",
    "FLOW_WORK_COUNT": "FLOW",
    "EDIT_RULE_COUNT": "편집 규칙",
    "EDIT_SESSION_COUNT": "편집 실행",
}


class ScenarioSaveRequest(BaseModel):
    scenarioId: Optional[Any] = None
    projectId: Optional[Any] = None
    scenarioCode: Optional[str] = None
    scenarioName: Optional[str] = None
    scenarioType: Optional[str] = "RULE"
    scenarioDesc: Optional[str] = None
    useYn: Optional[str] = "Y"
    sortOrder: Optional[Any] = None
    model_config = ConfigDict(extra='allow')


class ScenarioDeleteRequest(BaseModel):
    scenarioId: int
    model_config = ConfigDict(extra='allow')


class ScenarioPurgeRequest(BaseModel):
    scenarioId: int
    confirmationCode: Optional[str] = ""
    adminKey: Optional[str] = ""
    model_config = ConfigDict(extra='allow')


def _to_optional_int(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return int(value)


def _to_required_int(value, field_name):
    converted = _to_optional_int(value)
    if converted is None:
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    return converted


def _ensure_project_owner(conn, project_id: int, user_id: int):
    result = execute_query(conn, "M01002_PROJECT_OWNER_CHECK", {
        "projectId": project_id,
        "userId": user_id,
    })
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("message") or "Project owner check failed.")
    row = result.get("data", [{}])[0] if result.get("data") else {}
    if int(row.get("CNT") or 0) <= 0:
        raise HTTPException(status_code=404, detail="Project not found.")


def _active_dependency_text(child: dict) -> str:
    return ", ".join(
        f"{label} {int(child.get(key) or 0)}건"
        for key, label in SCENARIO_DEPENDENCY_LABELS.items()
        if int(child.get(key) or 0) > 0
    )


@router.get("/projects")
def get_projects(request: Request, keyword: str = Query("")):
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    conn = None
    try:
        conn = get_target_db_connection(request)
        return work_context_service.list_projects(
            conn,
            user_id=user_id,
            include_all_users=include_all_users,
            keyword=keyword,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M01002 project list failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.get("/scenarios")
def get_scenarios(request: Request, projectId: int = Query(...), keyword: str = Query("")):
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    conn = None
    try:
        conn = get_target_db_connection(request)
        return work_context_service.list_scenarios(
            conn,
            project_id=projectId,
            user_id=user_id,
            include_all_users=include_all_users,
            keyword=keyword,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M01002 scenario list failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.get("/scenario")
def get_scenario(request: Request, scenarioId: int = Query(...)):
    user_id = get_request_user_id(request)
    include_all_users = get_request_role_code(request) == "ADMIN"
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M01002_SCENARIO_DETAIL", {
            "scenarioId": scenarioId,
            "userId": user_id,
            "includeAllUsers": "Y" if include_all_users else "N",
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("message") or result.get("detail") or "Scenario detail query failed.")
        if not result.get("data"):
            raise HTTPException(status_code=404, detail="Scenario not found.")
        return {
            "status": "success",
            "data": result["data"][0],
            "columns": result.get("columns", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M01002 scenario detail failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.post("/scenario/save")
def save_scenario(req: ScenarioSaveRequest, request: Request):
    user_id = get_request_user_id(request)
    project_id = _to_required_int(req.projectId, "Project")
    scenario_name = (req.scenarioName or "").strip()
    scenario_code = (req.scenarioCode or "").strip()
    if not scenario_name:
        raise HTTPException(status_code=400, detail="Scenario name is required.")
    if not scenario_code:
        raise HTTPException(status_code=400, detail="Scenario code is required.")

    scenario_id = _to_optional_int(req.scenarioId)
    params = {
        "scenarioId": scenario_id,
        "projectId": project_id,
        "scenarioCode": scenario_code,
        "scenarioName": scenario_name,
        "scenarioType": (req.scenarioType or "RULE").strip(),
        "scenarioDesc": req.scenarioDesc or "",
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "sortOrder": _to_optional_int(req.sortOrder),
        "userId": user_id,
    }

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        _ensure_project_owner(conn, project_id, user_id)

        if scenario_id:
            cursor.execute(SqlLoader.get_sql("M01002_SCENARIO_UPDATE"), params)
            saved_id = scenario_id
        else:
            insert_params = {key: value for key, value in params.items() if key not in {"scenarioId", "userId"}}
            cursor.execute(SqlLoader.get_sql("M01002_SCENARIO_INSERT"), insert_params)
            cursor.execute(SqlLoader.get_sql("M01002_SCENARIO_ID_BY_CODE"), {
                "projectId": project_id,
                "scenarioCode": scenario_code,
                "userId": user_id,
            })
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Saved scenario ID could not be found.")
            saved_id = row[0]

        conn.commit()

        result = execute_query(conn, "M01002_SCENARIO_DETAIL", {
            "scenarioId": saved_id,
            "userId": user_id,
            "includeAllUsers": "N",
        })
        data = result.get("data", [{}])[0] if result.get("data") else {}
        return {
            "status": "success",
            "message": "Scenario saved.",
            "data": data
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M01002 scenario save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/scenario/delete")
def delete_scenario(req: ScenarioDeleteRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M01002_SCENARIO_DELETE_SCOPE_LOCK"), {
            "scenarioId": req.scenarioId,
            "userId": user_id,
        })
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Scenario not found.")

        child_result = execute_query(conn, "M01002_SCENARIO_CHILD_COUNT", {
            "scenarioId": req.scenarioId,
            "userId": user_id,
        })
        if child_result.get("status") != "success":
            raise HTTPException(status_code=500, detail=child_result.get("message") or "Scenario dependency check failed.")

        child = child_result.get("data", [{}])[0] if child_result.get("data") else {}
        dependency_text = _active_dependency_text(child)
        if dependency_text:
            raise HTTPException(
                status_code=409,
                detail=(
                    "시나리오를 삭제할 수 없습니다. "
                    "먼저 연결된 업무 데이터를 정리하세요. "
                    f"({dependency_text}) "
                    "INITUP$/INITDN$까지 제거하려면 M02002의 '물리 테이블 삭제'를 사용해야 하며, "
                    "'등록 해제'만 하면 실제 DB 테이블은 남습니다."
                )
            )

        cursor.execute(SqlLoader.get_sql("M01002_SCENARIO_DELETE"), {
            "scenarioId": req.scenarioId,
            "userId": user_id,
        })
        deleted_count = int(cursor.rowcount or 0)
        if deleted_count <= 0:
            raise HTTPException(status_code=404, detail="Scenario not found.")
        conn.commit()
        return {
            "status": "success",
            "message": "Scenario deleted.",
            "deletedCount": deleted_count,
            "physicalTableAction": "NONE",
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M01002 scenario delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/scenario/purge-preview")
def preview_scenario_purge(req: ScenarioDeleteRequest, request: Request):
    require_admin_role(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        return {
            "status": "success",
            "data": admin_scope_purge_service.build_purge_preview(
                conn,
                admin_scope_purge_service.SCOPE_SCENARIO,
                req.scenarioId,
            ),
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M01002 scenario purge preview failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.post("/scenario/purge")
def purge_scenario(req: ScenarioPurgeRequest, request: Request):
    require_admin_role(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        return admin_scope_purge_service.purge_scope(
            conn,
            admin_scope_purge_service.SCOPE_SCENARIO,
            req.scenarioId,
            confirmation_code=req.confirmationCode or "",
            admin_key=req.adminKey or "",
        )
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as error:
        if conn:
            conn.rollback()
        logger.exception("M01002 scenario purge failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()
