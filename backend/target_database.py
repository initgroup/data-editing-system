"""
Target database connection helpers.

The .env database is the system DB. Business screens use the target DB profile
selected at login time and stored in INIT$_TB_DB_CONNECTION on the system DB.
"""

import os
import time
import logging
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
from backend.oracle_session import disable_parallel_execution
from backend.runtime_settings import (
    TARGET_DB_POOL_WAIT_TIMEOUT_MS,
    load_server_resource_limits,
)


_target_pools = {}
_target_pool_last_used = {}
_target_pool_pending_acquires = {}
_target_pool_lock = Lock()
logger = logging.getLogger(__name__)


def _pool_snapshot(pool) -> str:
    parts = []
    for name in ("opened", "busy", "max", "min", "increment"):
        value = getattr(pool, name, None)
        if value is not None:
            parts.append(f"{name}={value}")
    return ", ".join(parts) or "pool_stats=unavailable"


def get_target_connection_id(request: Request) -> int:
    service_connection_id = ""
    if getattr(request.state, "internal_api_authorized", False):
        service_connection_id = os.getenv("INIT_INTERNAL_API_CONNECTION_ID", "").strip()
    raw_value = (
        request.headers.get("X-Target-Connection-Id")
        or request.headers.get("X-Connection-Id")
        or service_connection_id
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


def _get_target_pool_args(params: dict, wait_timeout_ms: int | None = None) -> dict:
    pool_min = max(0, int(os.getenv("TARGET_DB_POOL_MIN", "0")))
    pool_max = max(1, int(os.getenv("TARGET_DB_POOL_MAX", "3")))
    pool_min = min(pool_min, pool_max)
    return {
        **_build_target_connect_args(params),
        "min": pool_min,
        "max": pool_max,
        "increment": max(1, int(os.getenv("TARGET_DB_POOL_INCREMENT", "1"))),
        "timeout": max(0, int(os.getenv("TARGET_DB_POOL_TIMEOUT_SECONDS", "120"))),
        "getmode": oracledb.POOL_GETMODE_TIMEDWAIT,
        "wait_timeout": max(
            1,
            int(
                wait_timeout_ms
                if wait_timeout_ms is not None
                else os.getenv("TARGET_DB_POOL_WAIT_TIMEOUT_MS", "30000")
            ),
        ),
        "max_lifetime_session": max(
            0,
            int(os.getenv("TARGET_DB_POOL_MAX_LIFETIME_SECONDS", "1800")),
        ),
    }


def close_target_db_pool(connection_id: int, user_id: int) -> None:
    key = _target_pool_key(connection_id, user_id)
    with _target_pool_lock:
        pool = _target_pools.pop(key, None)
        _target_pool_last_used.pop(key, None)
        _target_pool_pending_acquires.pop(key, None)
    if pool is not None:
        pool.close(force=True)


def close_all_target_db_pools() -> None:
    with _target_pool_lock:
        pools = list(_target_pools.values())
        _target_pools.clear()
        _target_pool_last_used.clear()
        _target_pool_pending_acquires.clear()
    for pool in pools:
        try:
            pool.close(force=True)
        except Exception:
            logger.exception("[Target DB] pool shutdown failed; continuing with remaining pools.")


def _target_pool_registry_max() -> int:
    try:
        return max(1, int(os.getenv("TARGET_DB_POOL_REGISTRY_MAX", "16")))
    except Exception:
        return 16


def _evict_idle_target_db_pools_locked(exclude_key: tuple[int, int]) -> None:
    registry_max = _target_pool_registry_max()
    if len(_target_pools) < registry_max:
        return

    candidates = sorted(
        (
            (last_used, key, pool)
            for key, pool in _target_pools.items()
            if key != exclude_key
            for last_used in [_target_pool_last_used.get(key, 0.0)]
        ),
        key=lambda item: item[0],
    )
    for _, key, pool in candidates:
        if len(_target_pools) < registry_max:
            break
        if _target_pool_pending_acquires.get(key, 0) > 0:
            continue
        try:
            busy_count = getattr(pool, "busy", None)
            if busy_count is None or int(busy_count) > 0:
                continue
        except Exception:
            continue

        _target_pools.pop(key, None)
        _target_pool_last_used.pop(key, None)
        _target_pool_pending_acquires.pop(key, None)
        try:
            pool.close(force=False)
            logger.info(
                "[Target DB] idle pool evicted. user_id=%s, connection_id=%s",
                key[0],
                key[1],
            )
        except Exception:
            logger.exception(
                "[Target DB] idle pool eviction failed. user_id=%s, connection_id=%s",
                key[0],
                key[1],
            )
            _target_pools[key] = pool
            _target_pool_last_used[key] = time.monotonic()


def get_target_db_pool(
    connection_id: int,
    user_id: int,
    params: dict,
    *,
    reserve: bool = False,
    wait_timeout_ms: int | None = None,
):
    key = _target_pool_key(connection_id, user_id)
    with _target_pool_lock:
        pool = _target_pools.get(key)
        if pool is None:
            _evict_idle_target_db_pools_locked(key)
            if len(_target_pools) >= _target_pool_registry_max():
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "The Target DB pool registry is at capacity and every pool is currently in use. "
                        "Please try again shortly."
                    ),
                )
            pool_args = _get_target_pool_args(params, wait_timeout_ms)
            print(
                "[Target DB] Oracle connection pool initializing. "
                f"connection_id={connection_id}, user_id={user_id}, "
                f"min={pool_args['min']}, max={pool_args['max']}, "
                f"timeout={pool_args['timeout']}, "
                f"wait_timeout={pool_args['wait_timeout']}, "
                f"max_lifetime_session={pool_args['max_lifetime_session']}"
            )
            pool = oracledb.create_pool(**pool_args)
            _target_pools[key] = pool
            print(f"[Target DB] Oracle connection pool ready. connection_id={connection_id}, user_id={user_id}")
        elif wait_timeout_ms is not None:
            # python-oracledb supports changing this property without closing
            # the pool, so active requests and sessions are not disrupted.
            effective_wait_timeout = max(1, int(wait_timeout_ms))
            if int(getattr(pool, "wait_timeout", effective_wait_timeout)) != effective_wait_timeout:
                pool.wait_timeout = effective_wait_timeout
        _target_pool_last_used[key] = time.monotonic()
        if reserve:
            _target_pool_pending_acquires[key] = _target_pool_pending_acquires.get(key, 0) + 1
        return pool


def _release_target_pool_reservation(connection_id: int, user_id: int) -> None:
    key = _target_pool_key(connection_id, user_id)
    with _target_pool_lock:
        pending_count = _target_pool_pending_acquires.get(key, 0)
        if pending_count <= 1:
            _target_pool_pending_acquires.pop(key, None)
        else:
            _target_pool_pending_acquires[key] = pending_count - 1
        if key in _target_pools:
            _target_pool_last_used[key] = time.monotonic()


def get_target_db_connection(request: Request):
    resource_limits = {}
    connection = get_target_db_connection_by_id(
        get_target_connection_id(request),
        get_request_user_id(request),
        resource_limits_out=resource_limits,
        call_timeout_ms=max(
            0,
            int(os.getenv("TARGET_DB_INTERACTIVE_CALL_TIMEOUT_MS", "120000")),
        ),
    )
    request.state.server_resource_limits = resource_limits
    return connection


def get_target_db_connection_by_id(
    connection_id: int,
    user_id: int,
    resource_limits_out: dict | None = None,
    call_timeout_ms: int | None = None,
):
    system_conn = None
    try:
        system_conn = get_db_connection()
        row = _get_connection_detail(system_conn, connection_id, user_id)
        if row.get("USE_YN") != "Y":
            raise HTTPException(status_code=400, detail="Selected target DB connection is disabled.")
        params = _connection_row_to_params(row)
        resource_limits = load_server_resource_limits(system_conn, user_id, connection_id)
        if resource_limits_out is not None:
            resource_limits_out.clear()
            resource_limits_out.update(resource_limits)
        system_conn.close()
        system_conn = None
        pool = get_target_db_pool(
            connection_id,
            user_id,
            params,
            reserve=True,
            wait_timeout_ms=resource_limits.get(TARGET_DB_POOL_WAIT_TIMEOUT_MS),
        )
        try:
            started_at = time.monotonic()
            logger.info(
                "[Target DB] acquire start. connection_id=%s, user_id=%s, %s",
                connection_id,
                user_id,
                _pool_snapshot(pool),
            )
            try:
                connection = pool.acquire()
                # call_timeout is a connection attribute and therefore may be
                # retained when a pooled session is reused. Interactive screen
                # requests get a finite ceiling, while background DATA/FLOW/ML
                # jobs that call this helper directly keep the default 0 (no
                # client-side call timeout).
                connection.call_timeout = max(0, int(call_timeout_ms or 0))
            except oracledb.Error as error:
                error_detail = error.args[0] if error.args else error
                error_code = getattr(error_detail, "code", None)
                full_code = str(getattr(error_detail, "full_code", "") or "")
                if error_code == 4005 or full_code == "DPY-4005":
                    raise HTTPException(
                        status_code=503,
                        detail="Target DB connection pool is busy. Please try again shortly.",
                    ) from error
                raise
        finally:
            _release_target_pool_reservation(connection_id, user_id)
        try:
            if os.getenv("TARGET_DB_DISABLE_PARALLEL", "Y").strip().upper() == "Y":
                with connection.cursor() as cursor:
                    disable_parallel_execution(
                        cursor,
                        include_query=False,
                        context=f"target_connection_id={connection_id}, user_id={user_id}",
                    )
        except Exception:
            connection.close()
            raise
        elapsed = time.monotonic() - started_at
        warn_seconds = float(os.getenv("TARGET_DB_POOL_ACQUIRE_WARN_SECONDS", "3"))
        log_method = logger.warning if elapsed >= warn_seconds else logger.info
        log_method(
            "[Target DB] acquire done. connection_id=%s, user_id=%s, elapsed=%.3fs, %s",
            connection_id,
            user_id,
            elapsed,
            _pool_snapshot(pool),
        )
        return connection
    finally:
        if system_conn:
            system_conn.close()
