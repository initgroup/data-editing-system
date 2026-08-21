"""
@file           M01001.py
@description    Project settings API
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Optional
import logging

from backend.database_helper import execute_query, SqlLoader
from backend.target_database import get_target_db_connection
from backend.auth_context import get_request_user_email, get_request_user_id

logger = logging.getLogger(__name__)
router = APIRouter()


class ProjectSaveRequest(BaseModel):
    projectId: Optional[Any] = None
    projectCode: Optional[str] = None
    projectName: Optional[str] = None
    projectType: Optional[str] = "EDITING"
    projectDesc: Optional[str] = None
    useYn: Optional[str] = "Y"
    sortOrder: Optional[Any] = 0
    model_config = ConfigDict(extra='allow')


class ProjectDeleteRequest(BaseModel):
    projectId: int
    model_config = ConfigDict(extra='allow')


def _to_optional_int(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return int(value)


def _to_int(value, default=0):
    if value is None:
        return default
    if isinstance(value, str) and value.strip() == "":
        return default
    return int(value)


@router.get("/projects")
def get_projects(request: Request, keyword: str = Query("")):
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M01001_PROJECT_LIST", {
            "keyword": keyword or "",
            "userId": user_id,
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("message") or result.get("detail") or "Project list query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M01001 project list failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.get("/project")
def get_project(request: Request, projectId: int = Query(...)):
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M01001_PROJECT_DETAIL", {
            "projectId": projectId,
            "userId": user_id,
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("message") or result.get("detail") or "Project detail query failed.")
        if not result.get("data"):
            raise HTTPException(status_code=404, detail="Project not found.")
        return {
            "status": "success",
            "data": result["data"][0],
            "columns": result.get("columns", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M01001 project detail failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.post("/project/save")
def save_project(req: ProjectSaveRequest, request: Request):
    user_id = get_request_user_id(request)
    user_email = get_request_user_email(request)
    project_name = (req.projectName or "").strip()
    project_code = (req.projectCode or "").strip()
    if not project_name:
        raise HTTPException(status_code=400, detail="Project name is required.")
    if not project_code:
        raise HTTPException(status_code=400, detail="Project code is required.")

    params = {
        "projectId": _to_optional_int(req.projectId),
        "projectCode": project_code,
        "projectName": project_name,
        "projectType": (req.projectType or "EDITING").strip(),
        "projectDesc": req.projectDesc or "",
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "sortOrder": _to_int(req.sortOrder),
        "userId": user_id,
        "userEmail": user_email,
    }

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()

        if params["projectId"]:
            cursor.execute(SqlLoader.get_sql("M01001_PROJECT_UPDATE"), params)
            project_id = params["projectId"]
        else:
            insert_params = {key: value for key, value in params.items() if key != "projectId"}
            cursor.execute(SqlLoader.get_sql("M01001_PROJECT_INSERT"), insert_params)
            cursor.execute(SqlLoader.get_sql("M01001_PROJECT_ID_BY_CODE"), {
                "projectCode": project_code,
                "userId": user_id,
            })
            project_id_row = cursor.fetchone()
            if not project_id_row:
                raise HTTPException(status_code=500, detail="Saved project ID could not be found.")
            project_id = project_id_row[0]

        conn.commit()

        result = execute_query(conn, "M01001_PROJECT_DETAIL", {
            "projectId": project_id,
            "userId": user_id,
        })
        data = result.get("data", [{}])[0] if result.get("data") else {}
        return {
            "status": "success",
            "message": "Project saved.",
            "data": data
        }
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M01001 project save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/project/delete")
def delete_project(req: ProjectDeleteRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M01001_PROJECT_DELETE_SCOPE_LOCK"), {
            "projectId": req.projectId,
            "userId": user_id,
        })
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found.")

        child_result = execute_query(conn, "M01001_PROJECT_CHILD_COUNT", {
            "projectId": req.projectId,
            "userId": user_id,
        })
        if child_result.get("status") != "success":
            raise HTTPException(status_code=500, detail=child_result.get("message") or "Project dependency check failed.")

        child = child_result.get("data", [{}])[0] if child_result.get("data") else {}
        dependency_labels = {
            "SCENARIO_COUNT": "시나리오",
            "SCENARIO_TABLE_COUNT": "시나리오 테이블 등록",
            "DATA_WORK_JOB_COUNT": "데이터 작업",
            "FLOW_WORK_COUNT": "FLOW",
            "EDIT_RULE_COUNT": "편집 규칙",
            "EDIT_SESSION_COUNT": "편집 실행",
            "MANAGED_TABLE_PAIR_COUNT": "관리 물리 테이블 쌍",
        }
        dependencies = {
            key: int(child.get(key) or 0)
            for key in dependency_labels
        }
        active_dependencies = [
            f"{dependency_labels[key]} {count}건"
            for key, count in dependencies.items()
            if count > 0
        ]
        if active_dependencies:
            raise HTTPException(
                status_code=409,
                detail=(
                    "프로젝트를 삭제할 수 없습니다. "
                    "먼저 연결된 업무 데이터와 관리 물리 테이블을 정리하세요. "
                    f"({', '.join(active_dependencies)}) "
                    "INITUP$/INITDN$까지 제거하려면 M02002의 '물리 테이블 삭제'를 사용해야 하며, "
                    "'등록 해제'만 하면 실제 DB 테이블은 남습니다."
                )
            )

        cursor.execute(SqlLoader.get_sql("M01001_UPLOAD_META_DELETE_STALE_BY_PROJECT"), {
            "projectId": req.projectId,
        })
        cursor.execute(SqlLoader.get_sql("M01001_PROJECT_DELETE"), {
            "projectId": req.projectId,
            "userId": user_id,
        })
        deleted_count = int(cursor.rowcount or 0)
        if deleted_count <= 0:
            raise HTTPException(status_code=404, detail="Project not found.")
        conn.commit()
        return {
            "status": "success",
            "message": "Project deleted.",
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
        logger.error(f"M01001 project delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
