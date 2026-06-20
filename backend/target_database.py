"""
Target database connection helpers.

The .env database is the system DB. Business screens use the target DB profile
selected at login time and stored in INIT$_TB_DB_CONNECTION on the system DB.
"""

from fastapi import HTTPException, Request

from backend.database import get_db_connection
from backend.auth_context import get_request_user_id
from backend.routers.M91001 import (
    _connect_target,
    _connection_row_to_params,
    _get_connection_detail,
)


def get_target_connection_id(request: Request) -> int:
    raw_value = (
        request.headers.get("X-Target-Connection-Id")
        or request.headers.get("X-Connection-Id")
        or ""
    ).strip()
    if not raw_value:
        raise HTTPException(status_code=400, detail="Target DB connection is required. Please login again.")
    try:
        return int(raw_value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid target DB connection ID.")


def get_target_db_connection(request: Request):
    return get_target_db_connection_by_id(
        get_target_connection_id(request),
        get_request_user_id(request),
    )


def get_target_db_connection_by_id(connection_id: int, user_id: int):
    system_conn = None
    try:
        system_conn = get_db_connection()
        row = _get_connection_detail(system_conn, connection_id, user_id)
        if row.get("USE_YN") != "Y":
            raise HTTPException(status_code=400, detail="Selected target DB connection is disabled.")
        params = _connection_row_to_params(row)
        return _connect_target(params)
    finally:
        if system_conn:
            system_conn.close()
