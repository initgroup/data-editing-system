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
    try:
        conn = get_target_db_connection(request)
        child_result = execute_query(conn, "M01001_PROJECT_CHILD_COUNT", {
            "projectId": req.projectId,
            "userId": user_id,
        })
        if child_result.get("status") != "success":
            raise HTTPException(status_code=500, detail=child_result.get("message") or "Project dependency check failed.")

        child = child_result.get("data", [{}])[0] if child_result.get("data") else {}
        scenario_count = int(child.get("SCENARIO_COUNT") or 0)
        scenario_table_count = int(child.get("SCENARIO_TABLE_COUNT") or 0)
        if scenario_count > 0 or scenario_table_count > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    "프로젝트를 삭제할 수 없습니다. "
                    f"먼저 연결된 시나리오와 시나리오 테이블 데이터를 삭제하세요. "
                    f"(시나리오 {scenario_count}건, 시나리오 테이블 {scenario_table_count}건)"
                )
            )

        result = execute_query(conn, "M01001_PROJECT_DELETE", {
            "projectId": req.projectId,
            "userId": user_id,
        }, is_dml=True)
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("message") or "Project delete failed.")
        return {
            "status": "success",
            "message": "Project deleted.",
            "deletedCount": result.get("rowcount", 0)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M01001 project delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()
