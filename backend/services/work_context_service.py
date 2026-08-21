"""Shared project/scenario context queries used by individual and bootstrap APIs."""

from typing import Any, Dict

from fastapi import HTTPException

from backend.database_helper import execute_query


def _require_query_success(result: Dict[str, Any], message: str) -> Dict[str, Any]:
    if result.get("status") != "success":
        raise HTTPException(
            status_code=500,
            detail=result.get("message") or result.get("detail") or message,
        )
    return {
        "status": "success",
        "data": result.get("data", []),
        "columns": result.get("columns", []),
        "total": result.get("total", 0),
    }


def list_projects(
    conn,
    *,
    user_id: int,
    include_all_users: bool,
    keyword: str = "",
) -> Dict[str, Any]:
    result = execute_query(conn, "M01002_PROJECT_LIST", {
        "keyword": keyword or "",
        "userId": user_id,
        "includeAllUsers": "Y" if include_all_users else "N",
    })
    return _require_query_success(result, "Project list query failed.")


def list_scenarios(
    conn,
    *,
    project_id: int,
    user_id: int,
    include_all_users: bool,
    keyword: str = "",
) -> Dict[str, Any]:
    result = execute_query(conn, "M01002_SCENARIO_LIST", {
        "projectId": project_id,
        "keyword": keyword or "",
        "userId": user_id,
        "includeAllUsers": "Y" if include_all_users else "N",
    })
    return _require_query_success(result, "Scenario list query failed.")
