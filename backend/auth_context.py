import hashlib
import hmac
import logging
import os
import secrets
from threading import Lock
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, Response

from backend.database import get_db_connection
from backend.database_helper import SqlLoader


SESSION_COOKIE_NAME = os.getenv("INIT_SESSION_COOKIE_NAME", "init_session_v2")
LEGACY_SESSION_COOKIE_NAMES = ("init_session",)
logger = logging.getLogger(__name__)
_auth_session_table_ready = False
_auth_session_table_lock = Lock()


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
    try:
        conn = get_db_connection()
        ensure_auth_session_table(conn)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_SESSION_SELECT"), {
            "sessionTokenHash": token_hash
        })
        row = cursor.fetchone()
        if not row:
            cookie_names = sorted(request.cookies.keys())
            logger.info(
                "Login session token was not found or expired. path=%s token_hash_prefix=%s cookie_names=%s",
                request.url.path,
                token_hash[:8],
                cookie_names,
            )
            raise HTTPException(status_code=401, detail="Login session is invalid or expired.")

        user = _row_to_user(row)
        if touch:
            cursor.execute(SqlLoader.get_sql("AUTH_SESSION_TOUCH"), {
                "sessionTokenHash": token_hash,
                "ttlSeconds": get_session_ttl_seconds(),
            })
            conn.commit()

        request.state.auth_user = user
        return user
    except HTTPException:
        raise
    except Exception:
        logger.exception("Login session verification failed. path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="Login session could not be verified.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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
