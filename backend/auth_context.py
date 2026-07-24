import hashlib
import hmac
import logging
import os
import secrets
import time
from threading import BoundedSemaphore, Lock
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, Response

from backend.database import get_db_connection
from backend.database_helper import SqlLoader


SESSION_COOKIE_NAME = os.getenv("INIT_SESSION_COOKIE_NAME", "init_session_v2")
LEGACY_SESSION_COOKIE_NAMES = ("init_session",)
logger = logging.getLogger(__name__)
_auth_session_table_ready = False
_auth_session_table_lock = Lock()
_auth_session_touch_lock = Lock()
_auth_session_touch_deadlines: Dict[str, float] = {}
_auth_session_cache_lock = Lock()
_auth_session_verify_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
_system_pool_max = max(1, int(os.getenv("DB_POOL_MAX", "6")))
_auth_db_gate = BoundedSemaphore(max(1, min(2, _system_pool_max - 1)))


def get_session_verify_cache_seconds() -> int:
    """Return the short lifetime of a DB-verified server-side session cache."""
    try:
        configured = int(os.getenv("INIT_SESSION_VERIFY_CACHE_SECONDS", "30"))
    except Exception:
        configured = 30
    return max(0, min(configured, 30))


def get_auth_query_timeout_ms() -> int:
    """Bound login verification so a polling request cannot hold an auth slot for a minute."""
    try:
        configured = int(os.getenv("INIT_AUTH_QUERY_TIMEOUT_MS", "5000"))
    except Exception:
        configured = 5000
    return max(1000, min(configured, 15000))


def _get_cached_verified_user(token_hash: str) -> Optional[Dict[str, Any]]:
    cache_seconds = get_session_verify_cache_seconds()
    if cache_seconds <= 0:
        return None

    now = time.monotonic()
    with _auth_session_cache_lock:
        cached = _auth_session_verify_cache.get(token_hash)
        if not cached:
            return None
        deadline, user = cached
        if deadline <= now:
            _auth_session_verify_cache.pop(token_hash, None)
            return None
        return dict(user)


def _cache_verified_user(token_hash: str, user: Dict[str, Any]) -> None:
    cache_seconds = get_session_verify_cache_seconds()
    if cache_seconds <= 0:
        return

    now = time.monotonic()
    with _auth_session_cache_lock:
        if len(_auth_session_verify_cache) >= 2048:
            expired = [key for key, value in _auth_session_verify_cache.items() if value[0] <= now]
            for key in expired:
                _auth_session_verify_cache.pop(key, None)
        if len(_auth_session_verify_cache) >= 4096:
            oldest = min(_auth_session_verify_cache, key=lambda key: _auth_session_verify_cache[key][0])
            _auth_session_verify_cache.pop(oldest, None)
        _auth_session_verify_cache[token_hash] = (now + cache_seconds, dict(user))


def _invalidate_verified_session(token_hash: str) -> None:
    with _auth_session_cache_lock:
        _auth_session_verify_cache.pop(token_hash, None)


def _is_pool_timeout_error(error: Exception) -> bool:
    detail = error.args[0] if getattr(error, "args", None) else error
    full_code = str(getattr(detail, "full_code", "") or "").upper()
    error_text = str(error).upper()
    return (
        getattr(detail, "code", None) in {4005, 4024}
        or full_code in {"DPY-4005", "DPY-4024"}
        or "DPY-4005" in error_text
        or "DPY-4024" in error_text
    )


def get_session_touch_interval_seconds() -> int:
    """Limit writes to the shared login-session row during parallel API calls."""
    try:
        configured = int(os.getenv("INIT_SESSION_TOUCH_INTERVAL_SECONDS", "60"))
    except Exception:
        configured = 60
    return max(5, min(configured, max(5, get_session_ttl_seconds() // 2)))


def _reserve_session_touch(token_hash: str) -> bool:
    """Reserve at most one session touch per token and interval in this worker."""
    now = time.monotonic()
    interval = get_session_touch_interval_seconds()
    with _auth_session_touch_lock:
        deadline = _auth_session_touch_deadlines.get(token_hash, 0.0)
        if deadline > now:
            return False

        # Keep the process-local throttle bounded even when many users log in.
        if len(_auth_session_touch_deadlines) >= 2048:
            expired = [key for key, value in _auth_session_touch_deadlines.items() if value <= now]
            for key in expired:
                _auth_session_touch_deadlines.pop(key, None)
        if len(_auth_session_touch_deadlines) >= 4096:
            oldest = min(_auth_session_touch_deadlines, key=_auth_session_touch_deadlines.get)
            _auth_session_touch_deadlines.pop(oldest, None)

        _auth_session_touch_deadlines[token_hash] = now + interval
        return True


def _release_session_touch_reservation(token_hash: str) -> None:
    with _auth_session_touch_lock:
        _auth_session_touch_deadlines.pop(token_hash, None)


def get_session_ttl_seconds() -> int:
    try:
        return max(300, int(os.getenv("INIT_SESSION_TTL_SECONDS", "3600")))
    except Exception:
        return 3600


def _is_local_request(request: Optional[Request]) -> bool:
    if request is None:
        return False
    host = (request.url.hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _session_cookie_secure(request: Optional[Request] = None) -> bool:
    if _is_local_request(request):
        return False
    default_value = "Y" if os.getenv("RENDER") else "N"
    return str(os.getenv("INIT_COOKIE_SECURE", default_value)).strip().upper() == "Y"


def _session_cookie_samesite(request: Optional[Request] = None) -> str:
    if _is_local_request(request):
        return "lax"
    value = str(os.getenv("INIT_COOKIE_SAMESITE", "lax")).strip().lower()
    return value if value in {"lax", "strict", "none"} else "lax"


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def _get_session_token(request: Request) -> str:
    return request.cookies.get(SESSION_COOKIE_NAME) or ""


def _get_internal_api_key(request: Request) -> str:
    auth_header = request.headers.get("Authorization") or ""
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return (request.headers.get("X-INIT-API-Key") or request.headers.get("X-API-Key") or "").strip()


def authenticate_internal_api_request(request: Request) -> bool:
    provided_key = _get_internal_api_key(request)
    if not provided_key:
        return False

    configured_key = (os.getenv("INIT_INTERNAL_API_KEY") or "").strip()
    if not configured_key or not hmac.compare_digest(provided_key, configured_key):
        raise HTTPException(status_code=401, detail="Invalid internal API key.")

    service_user_id = os.getenv("INIT_INTERNAL_API_USER_ID", "").strip()
    if not service_user_id:
        raise HTTPException(status_code=500, detail="Internal API service user is not configured.")
    try:
        user_id = int(service_user_id)
    except Exception:
        raise HTTPException(status_code=500, detail="Internal API service user is invalid.")

    request.state.internal_api_authorized = True
    request.state.internal_api_user_id = user_id
    return True


def ensure_auth_session_table(conn) -> None:
    global _auth_session_table_ready
    if _auth_session_table_ready:
        return

    cursor = None
    with _auth_session_table_lock:
        if _auth_session_table_ready:
            return
        try:
            cursor = conn.cursor()
            cursor.execute(SqlLoader.get_sql("AUTH_SESSION_ENSURE_TABLE"))
            _auth_session_table_ready = True
        finally:
            if cursor:
                cursor.close()


def create_login_session(conn, user_id: int, target_connection_id: Optional[int] = None) -> str:
    ensure_auth_session_table(conn)
    token = secrets.token_urlsafe(48)
    token_hash = _hash_session_token(token)
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_SESSION_DELETE_EXPIRED"))
        cursor.execute(SqlLoader.get_sql("AUTH_SESSION_INSERT"), {
            "sessionTokenHash": token_hash,
            "userId": int(user_id),
            "targetConnectionId": target_connection_id,
            "ttlSeconds": get_session_ttl_seconds(),
        })
        logger.info(
            "Login session created. user_id=%s target_connection_id=%s token_hash_prefix=%s",
            user_id,
            target_connection_id,
            token_hash[:8],
        )
        return token
    finally:
        if cursor:
            cursor.close()


def set_session_cookie(response: Response, token: str, request: Optional[Request] = None) -> None:
    for cookie_name in LEGACY_SESSION_COOKIE_NAMES:
        if cookie_name != SESSION_COOKIE_NAME:
            response.delete_cookie(
                key=cookie_name,
                path="/",
                secure=_session_cookie_secure(request),
                samesite=_session_cookie_samesite(request),
            )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=get_session_ttl_seconds(),
        httponly=True,
        secure=_session_cookie_secure(request),
        samesite=_session_cookie_samesite(request),
        path="/",
    )


def refresh_session_cookie(request: Request, response: Response) -> None:
    token = _get_session_token(request)
    if token:
        set_session_cookie(response, token, request)


def clear_session_cookie(response: Response, request: Optional[Request] = None) -> None:
    cookie_names = (SESSION_COOKIE_NAME, *LEGACY_SESSION_COOKIE_NAMES)
    for cookie_name in dict.fromkeys(cookie_names):
        response.delete_cookie(
            key=cookie_name,
            path="/",
            secure=_session_cookie_secure(request),
            samesite=_session_cookie_samesite(request),
        )


def revoke_current_session(request: Request, response: Optional[Response] = None) -> None:
    token = _get_session_token(request)
    if response:
        clear_session_cookie(response, request)
    if not token:
        return

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        if hasattr(conn, "call_timeout"):
            conn.call_timeout = get_auth_query_timeout_ms()
        ensure_auth_session_table(conn)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_SESSION_REVOKE"), {
            "sessionTokenHash": _hash_session_token(token)
        })
        conn.commit()
    except Exception:
        if conn:
            conn.rollback()
    finally:
        token_hash = _hash_session_token(token)
        _release_session_touch_reservation(token_hash)
        _invalidate_verified_session(token_hash)
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _row_to_user(row) -> Dict[str, Any]:
    return {
        "userId": int(row[0]),
        "loginId": row[1],
        "userName": row[2],
        "email": row[3],
        "roleCode": str(row[4] or "USER").strip().upper(),
        "targetConnectionId": int(row[5]) if row[5] is not None else None,
    }


def authenticate_request(request: Request, *, touch: bool = True) -> Dict[str, Any]:
    cached = getattr(request.state, "auth_user", None)
    if cached:
        return cached

    token = _get_session_token(request)
    if not token:
        logger.info("Login session cookie is missing. path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="Login session is required.")

    conn = None
    cursor = None
    token_hash = _hash_session_token(token)
    verified_user = _get_cached_verified_user(token_hash)
    if verified_user:
        request.state.auth_user = verified_user
        return verified_user

    gate_acquired = _auth_db_gate.acquire(timeout=10)
    if not gate_acquired:
        logger.warning("Login session verification gate timed out. path=%s", request.url.path)
        raise HTTPException(status_code=503, detail="Login session verification is temporarily busy.")
    try:
        # Another request for this session may have completed verification
        # while this request was waiting. Collapse an initial SPA request burst
        # into one system-DB lookup instead of draining the connection pool.
        verified_user = _get_cached_verified_user(token_hash)
        if verified_user:
            request.state.auth_user = verified_user
            return verified_user

        conn = get_db_connection()
        if hasattr(conn, "call_timeout"):
            conn.call_timeout = get_auth_query_timeout_ms()
        ensure_auth_session_table(conn)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_SESSION_SELECT"), {
            "sessionTokenHash": token_hash
        })
        row = cursor.fetchone()
        if not row:
            _invalidate_verified_session(token_hash)
            cookie_names = sorted(request.cookies.keys())
            logger.info(
                "Login session token was not found or expired. path=%s token_hash_prefix=%s cookie_names=%s",
                request.url.path,
                token_hash[:8],
                cookie_names,
            )
            raise HTTPException(status_code=401, detail="Login session is invalid or expired.")

        user = _row_to_user(row)
        should_touch = bool(touch and _reserve_session_touch(token_hash))
        if should_touch:
            try:
                cursor.execute(SqlLoader.get_sql("AUTH_SESSION_TOUCH"), {
                    "sessionTokenHash": token_hash,
                    "ttlSeconds": get_session_ttl_seconds(),
                    "touchIntervalSeconds": get_session_touch_interval_seconds(),
                })
                conn.commit()
            except Exception:
                # Authentication has already succeeded. A best-effort expiry refresh
                # must not occupy/fail every API request when the session row is busy.
                conn.rollback()
                _release_session_touch_reservation(token_hash)
                logger.warning(
                    "Login session touch failed; verification remains valid. path=%s token_hash_prefix=%s",
                    request.url.path,
                    token_hash[:8],
                    exc_info=True,
                )

        request.state.auth_user = user
        _cache_verified_user(token_hash, user)
        return user
    except HTTPException:
        raise
    except Exception as error:
        if _is_pool_timeout_error(error):
            logger.warning(
                "Login session verification temporarily unavailable. path=%s error=%s",
                request.url.path,
                str(error),
            )
            raise HTTPException(
                status_code=503,
                detail="Login session verification is temporarily unavailable. Please try again shortly.",
            ) from error
        logger.exception("Login session verification failed. path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="Login session could not be verified.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        _auth_db_gate.release()


def get_request_user_id(request: Request) -> int:
    service_user_id = getattr(request.state, "internal_api_user_id", None)
    if service_user_id:
        return int(service_user_id)
    return int(authenticate_request(request)["userId"])


def get_request_user_email(request: Request) -> str:
    return str(authenticate_request(request).get("email") or "").strip()


def get_request_login_id(request: Request) -> str:
    return str(authenticate_request(request).get("loginId") or "").strip()


def get_request_role_code(request: Request) -> str:
    return str(authenticate_request(request).get("roleCode") or "").strip().upper()


def require_admin_role(request: Request) -> None:
    role_code = get_request_role_code(request)
    if role_code != "ADMIN":
        raise HTTPException(status_code=403, detail="Administrator permission is required.")
