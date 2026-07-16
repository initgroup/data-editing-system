import hmac
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response

from backend.auth_context import (
    authenticate_request,
    create_login_session,
    get_session_ttl_seconds,
    get_request_user_id,
    revoke_current_session,
    set_session_cookie,
)
from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.runtime_settings import load_server_resource_limits
from backend.routers.M99001 import (
    LoginRequest,
    SessionCleanupRequest,
    SignupRequest,
    _connect_target,
    _connection_row_to_params,
    _create_bootstrap_token,
    _get_connection_detail,
    _hash_password,
    _list_enabled_connections,
    _system_user_table_exists,
    _to_optional_int,
    _verify_password,
)


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/admin-contact")
def get_admin_contact():
    return {
        "status": "success",
        "data": {
            "name": os.getenv("INIT_ADMIN_CONTACT_NAME", "시스템 운영팀"),
            "email": os.getenv("INIT_ADMIN_CONTACT_EMAIL", "admin@example.com"),
            "phone": os.getenv("INIT_ADMIN_CONTACT_PHONE", "02-0000-0000"),
        },
    }


@router.post("/signup/save")
def save_signup(req: SignupRequest):
    system_conn = None
    cursor = None
    login_id = (req.loginId or "").strip()
    user_name = (req.userName or "").strip()
    email = (req.email or "").strip()
    signup_role = (req.signupRole or "USER").strip().upper()
    role_code = "USER"
    use_yn = "N"
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required.")
    if not user_name:
        raise HTTPException(status_code=400, detail="User name is required.")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    if not req.loginPassword:
        raise HTTPException(status_code=400, detail="Login password is required.")
    if signup_role not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="Invalid signup role.")
    if signup_role == "ADMIN":
        admin_key = os.getenv("INIT_ADMIN_KEY") or ""
        if not admin_key:
            raise HTTPException(status_code=500, detail="Admin signup key is not configured.")
        if not hmac.compare_digest(str(req.adminKey or ""), admin_key):
            raise HTTPException(status_code=400, detail="관리자 인증키가 일치하지 않습니다.")
        role_code = "ADMIN"
        use_yn = "Y"

    try:
        system_conn = get_db_connection()
        if not _system_user_table_exists(system_conn):
            if signup_role != "ADMIN":
                raise HTTPException(status_code=409, detail="System tables are not installed. Ask the first administrator to run initial setup.")
            token = _create_bootstrap_token(req)
            return {
                "status": "success",
                "bootstrapRequired": True,
                "message": "Admin key verified. Continue initial system setup.",
                "bootstrapToken": token,
                "loginId": login_id,
            }

        cursor = system_conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_SIGNUP_EXISTING_USER"), {"loginId": login_id})
        existing_user = cursor.fetchone()
        if existing_user:
            if existing_user[0] == "Y":
                raise HTTPException(status_code=400, detail="이미 등록된 로그인 ID입니다.")
            raise HTTPException(status_code=400, detail="이미 승인 대기 중인 로그인 ID입니다.")
        cursor.execute(SqlLoader.get_sql("AUTH_SIGNUP_INSERT_USER"), {
            "loginId": login_id,
            "userName": user_name,
            "email": email,
            "passwordHash": _hash_password(req.loginPassword),
            "roleCode": role_code,
            "useYn": use_yn,
        })
        system_conn.commit()
        message = (
            "관리자 회원가입이 완료되었습니다. 바로 로그인할 수 있습니다."
            if role_code == "ADMIN"
            else "회원가입 신청이 접수되었습니다. 관리자 승인 후 시스템을 사용할 수 있습니다."
        )
        return {
            "status": "success",
            "message": message,
            "loginId": login_id,
            "roleCode": role_code,
            "useYn": use_yn,
        }
    except HTTPException:
        if system_conn:
            system_conn.rollback()
        raise
    except Exception as e:
        if system_conn:
            system_conn.rollback()
        logger.exception("Login failed while creating authenticated session.")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if system_conn:
            system_conn.close()


def _public_user_payload(row) -> dict:
    return {
        "userId": row[0],
        "loginId": row[1],
        "userName": row[2],
        "email": row[3],
        "roleCode": row[6] or "USER",
    }


def _issue_login_session(
    response: Response,
    request: Request,
    system_conn,
    user_id: int,
    connection_id: Optional[int] = None
) -> None:
    token = create_login_session(system_conn, user_id, connection_id)
    system_conn.commit()
    set_session_cookie(response, token, request)


@router.post("/login")
def login(req: LoginRequest, response: Response, request: Request):
    system_conn = None
    cursor = None
    login_id = (req.loginId or "").strip()
    if not login_id or not req.loginPassword:
        raise HTTPException(status_code=400, detail="Login ID and password are required.")

    try:
        system_conn = get_db_connection()
        if not _system_user_table_exists(system_conn):
            raise HTTPException(status_code=409, detail="System tables are not installed. Sign up as the first administrator to start initial setup.")
        cursor = system_conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_LOGIN_USER"), {"loginId": login_id})
        row = cursor.fetchone()
        if not row or not _verify_password(req.loginPassword, row[4] or ""):
            raise HTTPException(status_code=401, detail="Invalid login ID or password.")
        if row[5] != "Y":
            raise HTTPException(status_code=403, detail="회원가입 신청이 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다.")
        user_id = int(row[0])
        connection_id = _to_optional_int(req.connectionId)
        connection_row = None
        if connection_id is not None:
            connection_row = _get_connection_detail(system_conn, connection_id, user_id)
            if connection_row.get("USE_YN") != "Y":
                raise HTTPException(status_code=400, detail="Selected target DB connection is disabled.")
        else:
            target_connections = _list_enabled_connections(system_conn, user_id)
            default_connections = [
                item for item in target_connections
                if str(item.get("defaultYn") or "").upper() == "Y"
            ]
            if len(default_connections) == 1:
                connection_row = _get_connection_detail(system_conn, int(default_connections[0]["connectionId"]), user_id)
            elif len(target_connections) > 1:
                _issue_login_session(response, request, system_conn, user_id, None)
                return {
                    "status": "success",
                    "message": "Select a target DB.",
                    "targetSelectionRequired": True,
                    "sessionTtlSeconds": get_session_ttl_seconds(),
                    "user": _public_user_payload(row),
                    "connections": target_connections,
                    "connection": None,
                }
            elif len(target_connections) == 1:
                connection_row = _get_connection_detail(system_conn, int(target_connections[0]["connectionId"]), user_id)
        selected_connection_id = int(connection_row.get("CONNECTION_ID")) if connection_row else None
        if selected_connection_id is not None:
            # Load resource settings once at login. Target DB acquisitions and
            # background jobs reuse this bounded server-side snapshot until a
            # M91002 change explicitly invalidates it.
            load_server_resource_limits(
                system_conn,
                user_id,
                selected_connection_id,
                force_refresh=True,
            )
        _issue_login_session(
            response,
            request,
            system_conn,
            user_id,
            selected_connection_id,
        )
        return {
            "status": "success",
            "message": "Login succeeded.",
            "setupRequired": connection_row is None,
            "sessionTtlSeconds": get_session_ttl_seconds(),
            "user": _public_user_payload(row),
            "connection": {
                "connectionId": connection_row.get("CONNECTION_ID"),
                "connectionName": connection_row.get("CONNECTION_NAME"),
                "dbType": connection_row.get("DB_TYPE"),
                "connectionScope": connection_row.get("CONNECTION_SCOPE") or "PRIVATE",
            } if connection_row else None,
        }
    except HTTPException:
        if system_conn:
            system_conn.rollback()
        raise
    except Exception as e:
        if system_conn:
            system_conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if system_conn:
            system_conn.close()


@router.get("/session/me")
def get_current_session(request: Request):
    user = authenticate_request(request)
    return {
        "status": "success",
        "sessionTtlSeconds": get_session_ttl_seconds(),
        "user": {
            "userId": user.get("userId"),
            "loginId": user.get("loginId"),
            "userName": user.get("userName"),
            "email": user.get("email"),
            "roleCode": user.get("roleCode") or "USER",
        },
        "targetConnectionId": user.get("targetConnectionId"),
    }


@router.post("/logout")
def logout(request: Request, response: Response):
    revoke_current_session(request, response)
    return {"status": "success", "message": "Logged out."}


@router.post("/session/cleanup")
def cleanup_target_session(req: SessionCleanupRequest, request: Request):
    user_id = get_request_user_id(request)
    connection_id = _to_optional_int(req.connectionId) or _to_optional_int(request.headers.get("X-Target-Connection-Id"))
    from backend.routers.M91002 import clear_gemini_api_key_cache

    if connection_id:
        clear_gemini_api_key_cache(user_id, connection_id)
    else:
        clear_gemini_api_key_cache(user_id)
    if not connection_id:
        return {"status": "success", "message": "No target DB connection selected."}

    system_conn = None
    target_conn = None
    try:
        system_conn = get_db_connection()
        row = _get_connection_detail(system_conn, connection_id, user_id)
        if row.get("USE_YN") != "Y":
            raise HTTPException(status_code=400, detail="Selected target DB connection is disabled.")
        target_conn = _connect_target(_connection_row_to_params(row))
        try:
            target_conn.rollback()
        except Exception as rollback_error:
            logger.warning(f"M91001 cleanup rollback failed: {str(rollback_error)}")
        return {
            "status": "success",
            "message": "Target DB cleanup completed.",
            "connectionId": connection_id,
            "reason": req.reason or "",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M91001 target cleanup failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()
