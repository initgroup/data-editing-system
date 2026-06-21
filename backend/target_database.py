"""
Target database connection helpers.

The .env database is the system DB. Business screens use the target DB profile
selected at login time and stored in INIT$_TB_DB_CONNECTION on the system DB.
"""

import os
from threading import Lock

from fastapi import HTTPException, Request
import oracledb

from backend.database import get_db_connection
from backend.auth_context import get_request_user_id
from backend.routers.M99001 import (
    _build_target_connect_args,
    _connection_row_to_params,
    _get_connection_detail,
)


_target_pools = {}
_target_pool_lock = Lock()


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


def _target_pool_key(connection_id: int, user_id: int) -> tuple[int, int]:
    return int(user_id), int(connection_id)


def _get_target_pool_args(params: dict) -> dict:
    return {
        **_build_target_connect_args(params),
        "min": int(os.getenv("TARGET_DB_POOL_MIN", "1")),
        "max": int(os.getenv("TARGET_DB_POOL_MAX", "3")),
        "increment": int(os.getenv("TARGET_DB_POOL_INCREMENT", "1")),
    }


def close_target_db_pool(connection_id: int, user_id: int) -> None:
    key = _target_pool_key(connection_id, user_id)
    with _target_pool_lock:
        pool = _target_pools.pop(key, None)
    if pool is not None:
        pool.close(force=True)


def close_all_target_db_pools() -> None:
    with _target_pool_lock:
        pools = list(_target_pools.values())
        _target_pools.clear()
    for pool in pools:
        pool.close(force=True)


def get_target_db_pool(connection_id: int, user_id: int, params: dict):
    key = _target_pool_key(connection_id, user_id)
    pool = _target_pools.get(key)
    if pool is not None:
        return pool

    with _target_pool_lock:
        pool = _target_pools.get(key)
        if pool is not None:
            return pool

        pool_args = _get_target_pool_args(params)
        print(
            "[Target DB] Oracle connection pool initializing. "
            f"connection_id={connection_id}, user_id={user_id}, "
            f"min={pool_args['min']}, max={pool_args['max']}"
        )
        pool = oracledb.create_pool(**pool_args)
        _target_pools[key] = pool
        print(f"[Target DB] Oracle connection pool ready. connection_id={connection_id}, user_id={user_id}")
        return pool


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
        return get_target_db_pool(connection_id, user_id, params).acquire()
    finally:
        if system_conn:
            system_conn.close()
