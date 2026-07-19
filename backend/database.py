import os
import time
import logging
from pathlib import Path
from threading import Lock
from typing import Optional

import oracledb
from dotenv import load_dotenv


load_dotenv()


PROJECT_ROOT = Path(__file__).resolve().parent.parent
_pool = None
_pool_lock = Lock()
logger = logging.getLogger(__name__)


def _pool_snapshot(pool) -> str:
    parts = []
    for name in ("opened", "busy", "max", "min", "increment"):
        value = getattr(pool, name, None)
        if value is not None:
            parts.append(f"{name}={value}")
    return ", ".join(parts) or "pool_stats=unavailable"


def _resolve_project_path(path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None

    normalized_value = str(path_value).strip()
    if not normalized_value:
        return None

    project_path = (PROJECT_ROOT / normalized_value.lstrip("/\\")).resolve()
    path = Path(path_value)
    if path.is_absolute():
        if path.exists() or not project_path.exists():
            return str(path)
        return str(project_path)

    return str(project_path)


def _get_cloud_connect_args(user: str, password: str, dsn: str) -> dict:
    wallet_path = _resolve_project_path(
        os.getenv("DB_WALLET_PATH", "secreats/Wallet_INITGROUPEDITING")
    )
    oracle_mode = os.getenv("DB_ORACLE_MODE", "thin").lower()

    if oracle_mode == "thick":
        client_path = _resolve_project_path(os.getenv("DB_CLIENT_PATH"))
        if not client_path:
            raise ValueError("DB_ORACLE_MODE=thick requires DB_CLIENT_PATH.")

        try:
            oracledb.init_oracle_client(lib_dir=client_path, config_dir=wallet_path)
        except oracledb.ProgrammingError:
            pass

        return {"user": user, "password": password, "dsn": dsn}

    connect_args = {
        "user": user,
        "password": password,
        "dsn": dsn,
        "tcp_connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
        "retry_count": int(os.getenv("DB_RETRY_COUNT", "1")),
        "retry_delay": int(os.getenv("DB_RETRY_DELAY", "1")),
    }

    if wallet_path and Path(wallet_path).exists():
        connect_args["config_dir"] = wallet_path
        connect_args["wallet_location"] = wallet_path
        wallet_password = os.getenv("DB_WALLET_PASSWORD")
        if wallet_password:
            connect_args["wallet_password"] = wallet_password
    elif dsn and "/" not in dsn and ":" not in dsn:
        raise ValueError(
            f"DB_WALLET_PATH directory not found or inaccessible: {wallet_path}. "
            "A TNS alias such as DB_DSN_CLD requires tnsnames.ora in this directory."
        )

    return connect_args


def _get_connect_args() -> tuple[str, dict]:
    db_mode = os.getenv("DB_MODE", "local").lower()

    if db_mode == "cloud":
        user = os.getenv("DB_USER_CLD")
        password = os.getenv("DB_PASSWORD_CLD")
        dsn = os.getenv("DB_DSN_CLD")
    else:
        user = os.getenv("DB_USER_LOC")
        password = os.getenv("DB_PASSWORD_LOC")
        host = os.getenv("DB_HOST", "127.0.0.1")
        port = os.getenv("DB_PORT", "1521")
        service = os.getenv("DB_SERVICE", "ORCLCDB")
        dsn = f"{host}:{port}/{service}"

    if not all([user, password, dsn]):
        raise ValueError("Database connection environment variables are missing.")

    if db_mode == "cloud":
        return db_mode, _get_cloud_connect_args(user, password, dsn)

    return db_mode, {"user": user, "password": password, "dsn": dsn}


def get_db_pool():
    global _pool

    if _pool is not None:
        return _pool

    with _pool_lock:
        if _pool is not None:
            return _pool

        db_mode, connect_args = _get_connect_args()
        wait_timeout_ms = max(
            1000,
            min(30000, int(os.getenv("DB_POOL_WAIT_TIMEOUT_MS", "30000"))),
        )
        pool_args = {
            **connect_args,
            "min": int(os.getenv("DB_POOL_MIN", "1")),
            "max": int(os.getenv("DB_POOL_MAX", "6")),
            "increment": int(os.getenv("DB_POOL_INCREMENT", "1")),
            "getmode": oracledb.POOL_GETMODE_TIMEDWAIT,
            "wait_timeout": wait_timeout_ms,
        }

        print(
            "[DB] Oracle connection pool initializing. "
            f"mode={db_mode}, min={pool_args['min']}, max={pool_args['max']}, "
            f"wait_timeout_ms={wait_timeout_ms}"
        )
        _pool = oracledb.create_pool(**pool_args)
        print("[DB] Oracle connection pool ready.")
        return _pool


def close_db_pool():
    global _pool

    with _pool_lock:
        if _pool is not None:
            # A leaked/unfinished checkout must not block process shutdown or
            # leave the reload parent waiting indefinitely.
            _pool.close(force=True)
            _pool = None


def get_db_connection():
    """
    Acquire a connection from the Oracle pool.

    Existing callers can keep using conn.close(); python-oracledb returns pooled
    connections to the pool on close.
    """
    try:
        pool = get_db_pool()
        started_at = time.monotonic()
        logger.info("[DB] acquire start. %s", _pool_snapshot(pool))
        connection = pool.acquire()
        # A pooled connection keeps session attributes between checkouts. Reset
        # the call timeout on every acquire so one stalled system-DB request
        # cannot occupy a pool slot indefinitely.
        connection.call_timeout = max(
            0,
            int(os.getenv("DB_CALL_TIMEOUT_MS", "60000")),
        )
        elapsed = time.monotonic() - started_at
        warn_seconds = float(os.getenv("DB_POOL_ACQUIRE_WARN_SECONDS", "3"))
        log_method = logger.warning if elapsed >= warn_seconds else logger.info
        log_method("[DB] acquire done. elapsed=%.3fs, %s", elapsed, _pool_snapshot(pool))

        return connection
    except oracledb.Error as e:
        print(f"Oracle database connection failed: {e}")
        raise
