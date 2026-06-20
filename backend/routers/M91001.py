"""
@file           M91001.py
@description    Target DB connection profile setup API
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Optional
from pathlib import Path
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time

import oracledb

from backend.database import get_db_connection, get_db_pool
from backend.database_helper import execute_query, SqlLoader
from backend.auth_context import get_request_user_id


logger = logging.getLogger(__name__)
router = APIRouter()
PROJECT_ROOT = Path(__file__).resolve().parents[2]

REQUIRED_APP_TABLES = [
    "INIT$_TB_PROJECT",
    "INIT$_TB_SCENARIO",
    "INIT$_TB_TABLES",
    "INIT$_TB_OBJECT",
    "INIT$_TB_OBJECT_DETAIL",
    "INIT$_TB_PREDICTED_TYPE",
    "INIT$_TB_CAT_CORR_PAIR",
    "INIT$_TB_CAT_CORR_SUMMARY",
    "INIT$_TB_DATA_WORK_JOB",
    "INIT$_TB_DATA_WORK_RUN",
    "INIT$_TB_OBJECT_DEPLOY",
]


class ConnectionRequest(BaseModel):
    connectionId: Optional[Any] = None
    connectionName: Optional[str] = None
    dbType: Optional[str] = "ORACLE"
    host: Optional[str] = None
    port: Optional[Any] = 1521
    serviceName: Optional[str] = None
    sid: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    passwordEnc: Optional[str] = None
    walletPath: Optional[str] = None
    walletPassword: Optional[str] = None
    walletPasswordEnc: Optional[str] = None
    connectOptions: Optional[str] = None
    defaultYn: Optional[str] = "N"
    useYn: Optional[str] = "Y"
    sortOrder: Optional[Any] = 0
    model_config = ConfigDict(extra="allow")


class ConnectionIdRequest(BaseModel):
    connectionId: int
    model_config = ConfigDict(extra="allow")


class SignupRequest(ConnectionRequest):
    loginId: str
    userName: str
    email: Optional[str] = ""
    loginPassword: str
    signupRole: Optional[str] = "USER"
    adminKey: Optional[str] = ""
    model_config = ConfigDict(extra="allow")


class LoginRequest(ConnectionRequest):
    loginId: str
    loginPassword: str
    model_config = ConfigDict(extra="allow")


class SessionCleanupRequest(BaseModel):
    connectionId: Optional[Any] = None
    reason: Optional[str] = ""
    model_config = ConfigDict(extra="allow")


BOOTSTRAP_TOKEN_TTL_SECONDS = 30 * 60


def _to_optional_int(value):
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return int(value)


def _normalize_yn(value, default="N"):
    return "Y" if str(value or default).upper() == "Y" else "N"


def _encode_secret(value: Optional[str]) -> str:
    if not value:
        return ""
    return "b64:" + base64.b64encode(value.encode("utf-8")).decode("ascii")


def _decode_secret(value: Optional[str]) -> str:
    text = value or ""
    if text.startswith("b64:"):
        try:
            return base64.b64decode(text[4:].encode("ascii")).decode("utf-8")
        except Exception:
            return ""
    return text


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    iterations = 120000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${digest.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        method, iterations, salt, expected = stored_hash.split("$", 3)
        if method != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except Exception:
        return False


def _system_user_table_exists(conn) -> bool:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COUNT(*)
              FROM USER_TABLES
             WHERE TABLE_NAME = 'INIT$_TB_USER'
            """
        )
        row = cursor.fetchone()
        return bool(row and row[0] > 0)
    finally:
        cursor.close()


def _get_bootstrap_secret() -> str:
    secret = os.getenv("INIT_BOOTSTRAP_SECRET") or os.getenv("INIT_ADMIN_KEY") or ""
    if not secret:
        raise HTTPException(status_code=500, detail="Bootstrap secret is not configured.")
    return secret


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _sign_bootstrap_payload(payload: dict) -> str:
    body = _b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = hmac.new(_get_bootstrap_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(signature)}"


def _verify_bootstrap_token(token: str) -> dict:
    token = (token or "").strip()
    if "." not in token:
        raise HTTPException(status_code=401, detail="Bootstrap authorization is required.")
    body, signature = token.rsplit(".", 1)
    expected = hmac.new(_get_bootstrap_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    try:
        actual = _b64url_decode(signature)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid bootstrap authorization.")
    if not hmac.compare_digest(actual, expected):
        raise HTTPException(status_code=401, detail="Invalid bootstrap authorization.")
    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid bootstrap authorization.")
    if payload.get("purpose") != "INIT_SYSTEM_BOOTSTRAP":
        raise HTTPException(status_code=401, detail="Invalid bootstrap authorization.")
    if int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(status_code=401, detail="Bootstrap authorization expired.")
    return payload


def _get_bootstrap_token_from_request(request: Request, req: Optional[ConnectionRequest] = None) -> str:
    body_token = getattr(req, "bootstrapToken", "") if req else ""
    return str(body_token or request.headers.get("X-Bootstrap-Token") or "")


def _create_bootstrap_token(req: SignupRequest) -> str:
    now = int(time.time())
    payload = {
        "purpose": "INIT_SYSTEM_BOOTSTRAP",
        "iat": now,
        "exp": now + BOOTSTRAP_TOKEN_TTL_SECONDS,
        "loginId": (req.loginId or "").strip(),
        "userName": (req.userName or "").strip(),
        "email": (req.email or "").strip(),
        "passwordHash": _hash_password(req.loginPassword),
    }
    return _sign_bootstrap_payload(payload)


def _insert_bootstrap_admin(conn, payload: dict) -> int:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_USER"
             WHERE LOGIN_ID = :loginId
                OR EMAIL = :email
            """,
            {"loginId": payload["loginId"], "email": payload["email"]},
        )
        row = cursor.fetchone()
        if row and row[0] > 0:
            raise HTTPException(status_code=400, detail="Bootstrap admin account already exists.")
        cursor.execute(
            """
            INSERT INTO "INIT$_TB_USER" (
                LOGIN_ID,
                USER_NAME,
                EMAIL,
                PASSWORD_HASH,
                ROLE_CODE,
                USE_YN,
                CREATED_AT
            ) VALUES (
                :loginId,
                :userName,
                :email,
                :passwordHash,
                'ADMIN',
                'Y',
                SYSTIMESTAMP
            )
            """,
            {
                "loginId": payload["loginId"],
                "userName": payload["userName"],
                "email": payload["email"],
                "passwordHash": payload["passwordHash"],
            },
        )
        cursor.execute(
            """
            SELECT USER_ID
              FROM "INIT$_TB_USER"
             WHERE LOGIN_ID = :loginId
            """,
            {"loginId": payload["loginId"]},
        )
        user_row = cursor.fetchone()
        if not user_row:
            raise HTTPException(status_code=500, detail="Bootstrap admin account was not created.")
        return int(user_row[0])
    finally:
        cursor.close()


def _validate_connection_params(params: dict, require_password: bool = False) -> None:
    if not params.get("connectionName"):
        raise HTTPException(status_code=400, detail="Connection name is required.")
    if not params.get("username"):
        raise HTTPException(status_code=400, detail="DB username is required.")
    if require_password and not params.get("passwordEnc"):
        raise HTTPException(status_code=400, detail="DB password is required.")


def _insert_bootstrap_connection(conn, req: ConnectionRequest, user_id: int) -> Optional[int]:
    params = _normalize_connection(req, {}, user_id)
    if not params["connectionName"]:
        params["connectionName"] = "SYSTEM_DB"
    params["defaultYn"] = "Y"
    params["useYn"] = "Y"
    params["sortOrder"] = params["sortOrder"] or 0
    _validate_connection_params(params, require_password=True)

    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_CLEAR_DEFAULT"), {
            "userId": user_id,
        })
        insert_params = {key: value for key, value in params.items() if key != "connectionId"}
        cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_INSERT"), insert_params)
        cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_ID_BY_NAME"), {
            "connectionName": params["connectionName"],
            "userId": user_id,
        })
        row = cursor.fetchone()
        return int(row[0]) if row else None
    finally:
        cursor.close()


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


def _parse_connect_options(value: Optional[Any]) -> dict:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    if hasattr(value, "read"):
        value = value.read()
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _get_connection_method(data: dict, options: Optional[dict] = None) -> str:
    options = options or _parse_connect_options(data.get("connectOptions") or data.get("CONNECT_OPTIONS"))
    method = (options.get("connectionMethod") or "").strip()
    if method:
        return method

    wallet_path = (
        data.get("walletPath")
        or data.get("WALLET_PATH")
        or options.get("walletPath")
        or ""
    )
    if str(wallet_path).strip():
        return "cloudWallet"

    host = (data.get("host") or data.get("HOST") or "").strip()
    alias = (
        options.get("dsnAlias")
        or options.get("jdbcUrl")
        or data.get("serviceName")
        or data.get("SERVICE_NAME")
        or data.get("sid")
        or data.get("SID")
        or ""
    )
    if not host and str(alias).strip():
        return "tnsAlias"

    return "basic"


def _build_dsn(data: dict) -> str:
    options = _parse_connect_options(data.get("connectOptions") or data.get("CONNECT_OPTIONS"))
    method = _get_connection_method(data, options)
    if method in {"tnsAlias", "cloudWallet"}:
        dsn_alias = (
            options.get("dsnAlias")
            or data.get("serviceName")
            or data.get("SERVICE_NAME")
            or data.get("sid")
            or data.get("SID")
            or ""
        ).strip()
        if not dsn_alias:
            raise HTTPException(status_code=400, detail="TNS alias is required.")
        return dsn_alias

    jdbc_url = (options.get("jdbcUrl") or "").strip()
    if method == "customJdbc" and jdbc_url:
        prefix = "jdbc:oracle:thin:@"
        if jdbc_url.startswith(prefix):
            return jdbc_url[len(prefix):]
        return jdbc_url

    host = (data.get("host") or data.get("HOST") or "").strip()
    port = str(data.get("port") or data.get("PORT") or "1521").strip()
    service_name = (data.get("serviceName") or data.get("SERVICE_NAME") or "").strip()
    sid = (data.get("sid") or data.get("SID") or "").strip()
    if not host:
        raise HTTPException(status_code=400, detail="Host is required.")
    if service_name:
        return f"{host}:{port}/{service_name}"
    if sid:
        return oracledb.makedsn(host, int(port), sid=sid)
    raise HTTPException(status_code=400, detail="Service name or SID is required.")


def _connect_target(data: dict):
    db_type = (data.get("dbType") or data.get("DB_TYPE") or "ORACLE").upper()
    if db_type != "ORACLE":
        raise HTTPException(status_code=400, detail="Only ORACLE target connections are supported now.")

    username = (data.get("username") or data.get("USERNAME") or "").strip()
    password = data.get("password") or _decode_secret(data.get("passwordEnc") or data.get("PASSWORD_ENC"))
    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required.")

    options = _parse_connect_options(data.get("connectOptions") or data.get("CONNECT_OPTIONS"))
    method = _get_connection_method(data, options)
    connect_args = {
        "user": username,
        "password": password,
        "dsn": _build_dsn(data),
    }

    if method == "cloudWallet":
        wallet_path = _resolve_project_path(
            data.get("walletPath")
            or data.get("WALLET_PATH")
            or options.get("walletPath")
        )
        if not wallet_path or not Path(wallet_path).exists():
            raise HTTPException(status_code=400, detail=f"Wallet path was not found: {wallet_path or ''}")
        connect_args["config_dir"] = wallet_path
        connect_args["wallet_location"] = wallet_path
        wallet_password = data.get("walletPassword") or _decode_secret(data.get("walletPasswordEnc") or data.get("WALLET_PASSWORD_ENC"))
        if wallet_password:
            connect_args["wallet_password"] = wallet_password

    return oracledb.connect(**connect_args)


def _normalize_connection(req: ConnectionRequest, existing: Optional[dict] = None, user_id: Optional[int] = None) -> dict:
    existing = existing or {}
    connection_id = _to_optional_int(req.connectionId)
    password_enc = _encode_secret(req.password) if req.password else (req.passwordEnc or existing.get("PASSWORD_ENC") or "")
    wallet_password_enc = _encode_secret(req.walletPassword) if req.walletPassword else (req.walletPasswordEnc or existing.get("WALLET_PASSWORD_ENC") or "")
    params = {
        "connectionId": connection_id,
        "userId": user_id or existing.get("USER_ID"),
        "connectionName": (req.connectionName or existing.get("CONNECTION_NAME") or "").strip(),
        "dbType": (req.dbType or existing.get("DB_TYPE") or "ORACLE").upper(),
        "host": (req.host or existing.get("HOST") or "").strip(),
        "port": _to_optional_int(req.port if req.port is not None else existing.get("PORT")),
        "serviceName": (req.serviceName or existing.get("SERVICE_NAME") or "").strip(),
        "sid": (req.sid or existing.get("SID") or "").strip(),
        "username": (req.username or existing.get("USERNAME") or "").strip(),
        "passwordEnc": password_enc,
        "walletPath": (req.walletPath or existing.get("WALLET_PATH") or "").strip(),
        "walletPasswordEnc": wallet_password_enc,
        "connectOptions": req.connectOptions if req.connectOptions is not None else (existing.get("CONNECT_OPTIONS") or ""),
        "defaultYn": _normalize_yn(req.defaultYn if req.defaultYn is not None else existing.get("DEFAULT_YN"), "N"),
        "useYn": _normalize_yn(req.useYn if req.useYn is not None else existing.get("USE_YN"), "Y"),
        "sortOrder": _to_optional_int(req.sortOrder if req.sortOrder is not None else existing.get("SORT_ORDER")) or 0,
    }
    return params


def _get_connection_detail(conn, connection_id: int, user_id: Optional[int] = None) -> dict:
    params = {"connectionId": connection_id}
    if user_id is not None:
        params["userId"] = user_id
    result = execute_query(conn, "M91001_CONNECTION_DETAIL", params)
    if result.get("status") != "success" or not result.get("data"):
        raise HTTPException(status_code=404, detail="Connection profile not found.")
    return result["data"][0]


def _get_default_connection_detail(conn, user_id: int) -> dict:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT CONNECTION_ID
              FROM "INIT$_TB_DB_CONNECTION"
             WHERE USER_ID = :userId
               AND USE_YN = 'Y'
             ORDER BY DEFAULT_YN DESC, SORT_ORDER NULLS LAST, CONNECTION_NAME, CONNECTION_ID
             FETCH FIRST 1 ROW ONLY
            """,
            {"userId": user_id},
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Saved DB connection profile was not found.")
        return _get_connection_detail(conn, int(row[0]), user_id)
    finally:
        cursor.close()


def _list_enabled_connections(conn, user_id: int) -> list:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT
                CONNECTION_ID,
                CONNECTION_NAME,
                DB_TYPE,
                DEFAULT_YN,
                SORT_ORDER
              FROM "INIT$_TB_DB_CONNECTION"
             WHERE USER_ID = :userId
               AND USE_YN = 'Y'
             ORDER BY DEFAULT_YN DESC, SORT_ORDER NULLS LAST, CONNECTION_NAME, CONNECTION_ID
            """,
            {"userId": user_id},
        )
        return [
            {
                "connectionId": row[0],
                "connectionName": row[1],
                "dbType": row[2],
                "defaultYn": row[3],
                "sortOrder": row[4],
            }
            for row in cursor.fetchall()
        ]
    finally:
        cursor.close()


def _connection_row_to_params(row: dict) -> dict:
    return {
        "connectionId": row.get("CONNECTION_ID"),
        "userId": row.get("USER_ID"),
        "connectionName": row.get("CONNECTION_NAME"),
        "dbType": row.get("DB_TYPE"),
        "host": row.get("HOST"),
        "port": row.get("PORT"),
        "serviceName": row.get("SERVICE_NAME"),
        "sid": row.get("SID"),
        "username": row.get("USERNAME"),
        "passwordEnc": row.get("PASSWORD_ENC"),
        "walletPath": row.get("WALLET_PATH"),
        "walletPasswordEnc": row.get("WALLET_PASSWORD_ENC"),
        "connectOptions": row.get("CONNECT_OPTIONS") or "",
        "defaultYn": row.get("DEFAULT_YN"),
        "useYn": row.get("USE_YN"),
        "sortOrder": row.get("SORT_ORDER") or 0,
    }


def _safe_connection_payload(row: dict) -> dict:
    connect_options = row.get("CONNECT_OPTIONS")
    if hasattr(connect_options, "read"):
        connect_options = connect_options.read()
    return {
        "connectionId": row.get("CONNECTION_ID"),
        "userId": row.get("USER_ID"),
        "connectionName": row.get("CONNECTION_NAME"),
        "dbType": row.get("DB_TYPE"),
        "host": row.get("HOST"),
        "port": row.get("PORT"),
        "serviceName": row.get("SERVICE_NAME"),
        "sid": row.get("SID"),
        "username": row.get("USERNAME"),
        "walletPath": row.get("WALLET_PATH"),
        "connectOptions": connect_options or "",
        "defaultYn": row.get("DEFAULT_YN"),
        "useYn": row.get("USE_YN"),
        "sortOrder": row.get("SORT_ORDER") or 0,
        "lastTestStatus": row.get("LAST_TEST_STATUS"),
        "lastTestMessage": row.get("LAST_TEST_MESSAGE"),
        "lastTestAt": row.get("LAST_TEST_AT"),
    }


def _strip_sqlcl_commands(script: str) -> str:
    lines = []
    for line in script.splitlines():
        stripped = line.strip()
        if not stripped:
            lines.append(line)
            continue
        if stripped.upper().startswith("SET SERVEROUTPUT"):
            continue
        if stripped == "/":
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _read_init_ddl_block() -> str:
    path = Path(__file__).resolve().parents[2] / "database" / "INIT_TARGET_DDL.sql"
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"INIT_TARGET_DDL.sql was not found: {path}")
    return _strip_sqlcl_commands(path.read_text(encoding="utf-8"))


def _read_model_objects_script() -> str:
    return _read_database_script("INIT_MODEL_OBJECTS.sql")


def _read_init_target_truncate_block() -> str:
    return _strip_sqlcl_commands(_read_database_script("INIT_TARGET_TRUC.sql"))


def _read_database_script(filename: str) -> str:
    path = Path(__file__).resolve().parents[2] / "database" / filename
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"{filename} was not found: {path}")
    return path.read_text(encoding="utf-8")


def _split_sqlcl_script(script: str) -> list[str]:
    statements = []
    buffer = []
    create_pattern = re.compile(r"(?is)^\s*CREATE\s+OR\s+REPLACE\s+(PACKAGE\s+BODY|PACKAGE|PROCEDURE|FUNCTION)\b")
    for line in script.splitlines():
        stripped = line.strip()
        if not stripped:
            if buffer:
                buffer.append(line)
            continue
        if stripped.upper().startswith("SET SERVEROUTPUT"):
            continue
        if stripped == "/":
            statement = "\n".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            continue
        if create_pattern.match(line) and _buffer_has_executable_sql(buffer):
            statement = "\n".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
        buffer.append(line)
    statement = "\n".join(buffer).strip()
    if statement:
        statements.append(statement)
    return [_strip_trailing_sqlcl_slash(statement) for statement in statements if _strip_trailing_sqlcl_slash(statement)]


def _buffer_has_executable_sql(lines: list[str]) -> bool:
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        return True
    return False


def _strip_trailing_sqlcl_slash(statement: str) -> str:
    lines = statement.strip().splitlines()
    while lines and lines[-1].strip() == "/":
        lines.pop()
    return "\n".join(lines).strip()


def _extract_created_objects(script: str) -> list[dict]:
    results = []
    pattern = re.compile(
        r"(?is)\bCREATE\s+OR\s+REPLACE\s+(PACKAGE\s+BODY|PACKAGE|PROCEDURE|FUNCTION)\s+\"?([A-Z0-9_$#]+)\"?"
    )
    for statement in _split_sqlcl_script(script):
        lines = []
        for line in statement.splitlines():
            stripped = line.strip()
            if not lines and (not stripped or stripped.startswith("--")):
                continue
            lines.append(line)
        executable = "\n".join(lines).lstrip().upper()
        match = pattern.match(executable)
        if not match:
            continue
        object_type = "PACKAGE BODY" if "BODY" in match.group(1) else match.group(1).strip()
        results.append({
            "objectType": object_type,
            "objectName": match.group(2).strip('"').upper(),
        })
    return results


def _extract_model_bundle_version(script: str) -> str:
    match = re.search(r"(?is)\bv_version\s+CONSTANT\s+VARCHAR2\s*\([^)]*\)\s*:=\s*'([^']+)'", script)
    return match.group(1).strip() if match else "1.0.0"


def _fetch_compile_errors(conn, created_objects: list[dict]) -> list[str]:
    if not created_objects:
        return []
    cursor = conn.cursor()
    try:
        errors = []
        for item in created_objects:
            cursor.execute(
                """
                SELECT NAME, TYPE, LINE, POSITION, TEXT
                  FROM USER_ERRORS
                 WHERE NAME = :objectName
                   AND TYPE = :objectType
                 ORDER BY SEQUENCE
                """,
                {
                    "objectName": item["objectName"],
                    "objectType": item["objectType"],
                },
            )
            for row in cursor.fetchall():
                errors.append(f"{row[1]} {row[0]} line {row[2]}, pos {row[3]}: {row[4]}")
        return errors
    finally:
        cursor.close()


def _record_model_deploy_status(conn, status: str, checksum: str, message: str = "", object_version: str = "1.0.0") -> None:
    _record_deploy_status(
        conn=conn,
        object_group="INIT_MODEL_OBJECTS",
        object_name="INIT_MODEL_OBJECTS",
        object_type="BUNDLE",
        object_version=object_version,
        status=status,
        checksum=checksum,
        message=message,
    )


def _record_deploy_status(
    conn,
    object_group: str,
    object_name: str,
    object_type: str,
    object_version: str,
    status: str,
    checksum: str,
    message: str = "",
) -> None:
    cursor = conn.cursor()
    params = {
        "objectGroup": object_group,
        "objectName": object_name,
        "objectType": object_type,
        "objectVersion": object_version,
        "checksum": checksum,
        "status": status,
        "message": message or None,
    }
    try:
        cursor.setinputsizes(message=oracledb.DB_TYPE_CLOB)
        cursor.execute(
            """
            UPDATE "INIT$_TB_OBJECT_DEPLOY"
               SET OBJECT_VERSION = :objectVersion,
                   CHECKSUM = :checksum,
                   DEPLOY_STATUS = :status,
                   DEPLOYED_AT = SYSTIMESTAMP,
                   ERROR_MESSAGE = :message
             WHERE OBJECT_GROUP = :objectGroup
               AND OBJECT_NAME = :objectName
               AND OBJECT_TYPE = :objectType
            """,
            params,
        )
        if cursor.rowcount:
            return
        try:
            cursor.execute(
                """
                INSERT INTO "INIT$_TB_OBJECT_DEPLOY" (
                    OBJECT_GROUP,
                    OBJECT_NAME,
                    OBJECT_TYPE,
                    OBJECT_VERSION,
                    CHECKSUM,
                    DEPLOY_STATUS,
                    DEPLOYED_AT,
                    ERROR_MESSAGE
                ) VALUES (
                    :objectGroup,
                    :objectName,
                    :objectType,
                    :objectVersion,
                    :checksum,
                    :status,
                    SYSTIMESTAMP,
                    :message
                )
                """,
                params,
            )
        except oracledb.DatabaseError as exc:
            error = exc.args[0] if exc.args else None
            if getattr(error, "code", None) != 1:
                raise
            cursor.execute(
                """
                UPDATE "INIT$_TB_OBJECT_DEPLOY"
                   SET OBJECT_VERSION = :objectVersion,
                       CHECKSUM = :checksum,
                       DEPLOY_STATUS = :status,
                       DEPLOYED_AT = SYSTIMESTAMP,
                       ERROR_MESSAGE = :message
                 WHERE OBJECT_GROUP = :objectGroup
                   AND OBJECT_NAME = :objectName
                   AND OBJECT_TYPE = :objectType
                """,
                params,
            )
    finally:
        cursor.close()


def _run_target_sqlcl_script(
    req: ConnectionRequest,
    request: Request,
    script_filename: str,
    action_code: str,
    deploy_group: str,
    deploy_name: str,
    deploy_type: str,
    deploy_version: str,
    start_message: str,
    success_message: str,
    check_compile_errors: bool = False,
):
    user_id = get_request_user_id(request)
    target_conn = None
    system_conn = None
    target_cursor = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}
        script = _read_database_script(script_filename)
        checksum = hashlib.sha256(script.encode("utf-8")).hexdigest()
        statements = _split_sqlcl_script(script)
        created_objects = _extract_created_objects(script) if check_compile_errors else []

        target_conn = _connect_target(target_payload)
        target_cursor = target_conn.cursor()
        target_cursor.execute("ALTER SESSION DISABLE PARALLEL DML")
        target_cursor.callproc("DBMS_OUTPUT.ENABLE")
        logs = [start_message]
        for index, statement in enumerate(statements, start=1):
            target_cursor.execute(statement)
            logs.append(f"[OK] Statement {index}/{len(statements)} executed.")
        logs.extend(_collect_dbms_output(target_cursor))

        compile_errors = _fetch_compile_errors(target_conn, created_objects) if check_compile_errors else []
        if compile_errors:
            message = "\n".join(compile_errors)
            try:
                _record_deploy_status(target_conn, deploy_group, deploy_name, deploy_type, deploy_version, "FAILED", checksum, message)
                target_conn.commit()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=message)

        _record_deploy_status(target_conn, deploy_group, deploy_name, deploy_type, deploy_version, "SUCCESS", checksum, "")
        target_conn.commit()

        if params.get("connectionId"):
            execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                "connectionId": params["connectionId"],
                "actionCode": action_code,
                "status": "SUCCESS",
                "message": "\n".join(logs),
            }, is_dml=True)
        return {
            "status": "success",
            "message": success_message,
            "logs": logs,
            "checksum": checksum,
            "createdObjects": created_objects,
        }
    except HTTPException as e:
        message = str(e.detail)
        if target_conn:
            target_conn.rollback()
        if system_conn and req.connectionId:
            try:
                execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                    "connectionId": int(req.connectionId),
                    "actionCode": action_code,
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise
    except Exception as e:
        if target_conn:
            target_conn.rollback()
        message = str(e)
        if system_conn and req.connectionId:
            try:
                execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                    "connectionId": int(req.connectionId),
                    "actionCode": action_code,
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=message)
    finally:
        if target_cursor:
            target_cursor.close()
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


def _run_target_admin_block(
    req: ConnectionRequest,
    request: Request,
    sql_block: str,
    action_code: str,
    success_message: str,
):
    user_id = get_request_user_id(request)
    target_conn = None
    system_conn = None
    target_cursor = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}

        target_conn = _connect_target(target_payload)
        target_cursor = target_conn.cursor()
        target_cursor.callproc("DBMS_OUTPUT.ENABLE")
        target_cursor.execute(sql_block)
        logs = _collect_dbms_output(target_cursor)
        target_conn.commit()

        if params.get("connectionId"):
            execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                "connectionId": params["connectionId"],
                "actionCode": action_code,
                "status": "SUCCESS",
                "message": "\n".join(logs),
            }, is_dml=True)
        return {"status": "success", "message": success_message, "logs": logs}
    except Exception as e:
        if target_conn:
            target_conn.rollback()
        message = str(e)
        if system_conn and req.connectionId:
            try:
                execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                    "connectionId": int(req.connectionId),
                    "actionCode": action_code,
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=message)
    finally:
        if target_cursor:
            target_cursor.close()
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


def _collect_dbms_output(cursor):
    lines = []
    line_var = cursor.var(str)
    status_var = cursor.var(int)
    while True:
        cursor.callproc("DBMS_OUTPUT.GET_LINE", [line_var, status_var])
        if status_var.getvalue() != 0:
            break
        lines.append(line_var.getvalue())
    return lines


def _check_required_tables(target_conn):
    cursor = target_conn.cursor()
    try:
        placeholders = ",".join(f":t{i}" for i, _ in enumerate(REQUIRED_APP_TABLES))
        params = {f"t{i}": table for i, table in enumerate(REQUIRED_APP_TABLES)}
        cursor.execute(
            f"""
            SELECT
                OBJECT_NAME,
                TO_CHAR(CREATED, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT,
                TO_CHAR(LAST_DDL_TIME, 'YYYY-MM-DD HH24:MI:SS') AS LAST_DDL_TIME
              FROM USER_OBJECTS
             WHERE OBJECT_TYPE = 'TABLE'
               AND OBJECT_NAME IN ({placeholders})
            """,
            params,
        )
        existing = {
            row[0]: {
                "CREATED_AT": row[1],
                "LAST_DDL_TIME": row[2],
            }
            for row in cursor.fetchall()
        }
        return [
            {
                "TABLE_NAME": table,
                "EXISTS_YN": "Y" if table in existing else "N",
                "CREATED_AT": existing.get(table, {}).get("CREATED_AT"),
                "LAST_DDL_TIME": existing.get(table, {}).get("LAST_DDL_TIME"),
            }
            for table in REQUIRED_APP_TABLES
        ]
    finally:
        cursor.close()


def _fetch_model_deploy_status(target_conn):
    cursor = target_conn.cursor()
    try:
        rows = []
        existing_keys = set()
        cursor.execute(
            """
            SELECT COUNT(*)
              FROM USER_TABLES
             WHERE TABLE_NAME = 'INIT$_TB_OBJECT_DEPLOY'
            """
        )
        columns = [
            "OBJECT_GROUP",
            "OBJECT_NAME",
            "OBJECT_TYPE",
            "OBJECT_VERSION",
            "CHECKSUM",
            "DEPLOY_STATUS",
            "DEPLOYED_AT",
            "ERROR_MESSAGE",
        ]
        if cursor.fetchone()[0]:
            cursor.execute(
                """
                SELECT
                    OBJECT_GROUP,
                    OBJECT_NAME,
                    OBJECT_TYPE,
                    OBJECT_VERSION,
                    CHECKSUM,
                    DEPLOY_STATUS,
                    TO_CHAR(DEPLOYED_AT, 'YYYY-MM-DD HH24:MI:SS') AS DEPLOYED_AT,
                    ERROR_MESSAGE
                  FROM "INIT$_TB_OBJECT_DEPLOY"
                 ORDER BY DEPLOYED_AT DESC NULLS LAST,
                          OBJECT_GROUP,
                          OBJECT_NAME,
                          OBJECT_TYPE
                """
            )
            for row in cursor.fetchall():
                item = {}
                for index, column in enumerate(columns):
                    value = row[index]
                    if hasattr(value, "read"):
                        value = value.read()
                    item[column] = value
                existing_keys.add((
                    str(item.get("OBJECT_GROUP") or "").upper(),
                    str(item.get("OBJECT_NAME") or "").upper(),
                    str(item.get("OBJECT_TYPE") or "").upper(),
                ))
                rows.append(item)

        rows.extend(_fetch_model_object_status_rows(target_conn, existing_keys))
        return rows
    finally:
        cursor.close()


def _fetch_model_object_status_rows(target_conn, existing_keys=None):
    script = _read_model_objects_script()
    object_version = _extract_model_bundle_version(script)
    created_objects = _extract_created_objects(script)
    if not created_objects:
        return []

    existing_keys = existing_keys or set()
    cursor = target_conn.cursor()
    try:
        rows = []
        for item in created_objects:
            key = ("INIT_MODEL_OBJECTS", item["objectName"].upper(), item["objectType"].upper())
            if key in existing_keys:
                continue
            cursor.execute(
                """
                SELECT STATUS,
                       TO_CHAR(CREATED, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT,
                       TO_CHAR(LAST_DDL_TIME, 'YYYY-MM-DD HH24:MI:SS') AS LAST_DDL_TIME
                  FROM USER_OBJECTS
                 WHERE OBJECT_NAME = :objectName
                   AND OBJECT_TYPE = :objectType
                """,
                item,
            )
            object_row = cursor.fetchone()
            if not object_row:
                rows.append({
                    "OBJECT_GROUP": "INIT_MODEL_OBJECTS",
                    "OBJECT_NAME": item["objectName"],
                    "OBJECT_TYPE": item["objectType"],
                    "OBJECT_VERSION": object_version,
                    "CHECKSUM": "",
                    "DEPLOY_STATUS": "MISSING",
                    "DEPLOYED_AT": "",
                    "ERROR_MESSAGE": "Object was not found in USER_OBJECTS.",
                })
                continue

            status = object_row[0] or ""
            error_message = ""
            if status != "VALID":
                error_message = "\n".join(_fetch_compile_errors(target_conn, [item]))
            rows.append({
                "OBJECT_GROUP": "INIT_MODEL_OBJECTS",
                "OBJECT_NAME": item["objectName"],
                "OBJECT_TYPE": item["objectType"],
                "OBJECT_VERSION": object_version,
                "CHECKSUM": "",
                "DEPLOY_STATUS": "SUCCESS" if status == "VALID" else "INVALID",
                "DEPLOYED_AT": object_row[2] or object_row[1] or "",
                "ERROR_MESSAGE": error_message,
            })
        return rows
    finally:
        cursor.close()


def _record_created_object_deploy_statuses(conn, created_objects: list[dict], object_version: str, checksum: str) -> list[str]:
    errors = []
    cursor = conn.cursor()
    try:
        for item in created_objects:
            cursor.execute(
                """
                SELECT STATUS
                  FROM USER_OBJECTS
                 WHERE OBJECT_NAME = :objectName
                   AND OBJECT_TYPE = :objectType
                """,
                item,
            )
            row = cursor.fetchone()
            if not row:
                message = "Object was not found in USER_OBJECTS."
                _record_deploy_status(
                    conn,
                    "INIT_MODEL_OBJECTS",
                    item["objectName"],
                    item["objectType"],
                    object_version,
                    "FAILED",
                    checksum,
                    message,
                )
                errors.append(f"{item['objectType']} {item['objectName']}: {message}")
                continue

            status = row[0] or ""
            compile_errors = _fetch_compile_errors(conn, [item]) if status != "VALID" else []
            if compile_errors:
                message = "\n".join(compile_errors)
                _record_deploy_status(
                    conn,
                    "INIT_MODEL_OBJECTS",
                    item["objectName"],
                    item["objectType"],
                    object_version,
                    "FAILED",
                    checksum,
                    message,
                )
                errors.extend(compile_errors)
            else:
                _record_deploy_status(
                    conn,
                    "INIT_MODEL_OBJECTS",
                    item["objectName"],
                    item["objectType"],
                    object_version,
                    "SUCCESS",
                    checksum,
                    "",
                )
        return errors
    finally:
        cursor.close()


@router.get("/connections")
def list_connections(request: Request, keyword: str = Query("")):
    user_id_header = request.headers.get("X-Login-User-Id")
    if not user_id_header:
        return {"status": "success", "data": [], "total": 0}
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_db_connection()
        result = execute_query(conn, "M91001_CONNECTION_LIST", {"keyword": keyword or "", "userId": user_id})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("message") or result.get("detail") or "Connection list query failed.")
        return {"status": "success", "data": result.get("data", []), "total": result.get("total", 0)}
    finally:
        if conn:
            conn.close()


@router.get("/env-defaults")
def get_env_defaults():
    db_mode = os.getenv("DB_MODE", "local").lower()
    return {
        "status": "success",
        "dbMode": db_mode,
        "local": {
            "connectionMethod": "basic",
            "connectionName": "LOCAL_TARGET",
            "host": os.getenv("DB_HOST", "127.0.0.1"),
            "port": os.getenv("DB_PORT", "1521"),
            "serviceName": os.getenv("DB_SERVICE", ""),
            "sid": "",
            "username": os.getenv("DB_USER_LOC", ""),
            "dsnAlias": os.getenv("DB_DSN_LOC", ""),
            "walletPath": "",
        },
        "cloud": {
            "connectionMethod": "cloudWallet",
            "connectionName": "INITGROUPEDITING_CLOUD",
            "host": "adb.ap-chuncheon-1.oraclecloud.com",
            "port": "1522",
            "serviceName": os.getenv("DB_DSN_CLD", ""),
            "sid": "",
            "username": os.getenv("DB_USER_CLD", ""),
            "dsnAlias": os.getenv("DB_DSN_CLD", ""),
            "walletPath": os.getenv("DB_WALLET_PATH", ""),
        },
    }


@router.get("/connection")
def get_connection(request: Request, connectionId: int = Query(...)):
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_db_connection()
        row = _get_connection_detail(conn, connectionId, user_id)
        return {"status": "success", "data": _safe_connection_payload(row)}
    finally:
        if conn:
            conn.close()


@router.post("/connection/save")
def save_connection(req: ConnectionRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        existing = _get_connection_detail(conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        _validate_connection_params(params, require_password=not bool(existing.get("PASSWORD_ENC")))
        if not params["connectionId"]:
            cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_ID_BY_NAME"), {
                "connectionName": params["connectionName"],
                "userId": user_id,
            })
            existing_row = cursor.fetchone()
            if existing_row:
                params["connectionId"] = existing_row[0]
        if params["defaultYn"] == "Y":
            cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_CLEAR_DEFAULT_EXCEPT"), {
                "connectionId": params["connectionId"],
                "userId": user_id,
            })
        if params["connectionId"]:
            cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_UPDATE"), params)
            connection_id = params["connectionId"]
        else:
            insert_params = {key: value for key, value in params.items() if key != "connectionId"}
            cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_INSERT"), insert_params)
            cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_ID_BY_NAME"), {
                "connectionName": params["connectionName"],
                "userId": user_id,
            })
            row = cursor.fetchone()
            connection_id = row[0] if row else None
        conn.commit()
        return {"status": "success", "message": "Connection profile saved.", "connectionId": connection_id}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91001 connection save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/connection/delete")
def delete_connection(req: ConnectionIdRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    drop_conn = False
    try:
        conn = get_db_connection()
        params = {
            "connectionId": req.connectionId,
            "userId": user_id,
        }
        cursor = conn.cursor()
        cursor.execute("ALTER SESSION DISABLE PARALLEL DML")
        drop_conn = True
        cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_SETTINGS_DELETE"), params)
        settings_deleted = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("M91001_CONNECTION_DELETE"), params)
        deleted_count = cursor.rowcount
        if deleted_count < 1:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Connection profile was not found or already deleted.")
        conn.commit()
        return {
            "status": "success",
            "message": "Connection profile deleted.",
            "deletedCount": deleted_count,
            "settingsDeletedCount": settings_deleted,
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91001 connection delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            if drop_conn:
                get_db_pool().drop(conn)
            else:
                conn.close()


@router.post("/connection/test")
def test_connection(req: ConnectionRequest, request: Request):
    bootstrap_payload = None
    try:
        bootstrap_payload = _verify_bootstrap_token(_get_bootstrap_token_from_request(request, req))
    except HTTPException:
        bootstrap_payload = None
    user_id = 0 if bootstrap_payload else get_request_user_id(request)
    conn = None
    system_conn = None
    cursor = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId and user_id else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}
        conn = _connect_target(target_payload)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 AS OK FROM DUAL")
        cursor.fetchone()
        message = "Connection succeeded."
        if params.get("connectionId") and user_id:
            execute_query(system_conn, "M91001_CONNECTION_TEST_UPDATE", {
                "connectionId": params["connectionId"],
                "userId": user_id,
                "status": "SUCCESS",
                "message": message,
            }, is_dml=True)
        return {"status": "success", "message": message}
    except HTTPException:
        raise
    except Exception as e:
        message = str(e)
        if system_conn and req.connectionId and user_id:
            try:
                execute_query(system_conn, "M91001_CONNECTION_TEST_UPDATE", {
                    "connectionId": int(req.connectionId),
                    "userId": user_id,
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=message)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        if system_conn:
            system_conn.close()


@router.post("/schema/check")
def check_schema(req: ConnectionRequest, request: Request):
    user_id = get_request_user_id(request)
    target_conn = None
    system_conn = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}
        target_conn = _connect_target(target_payload)
        rows = _check_required_tables(target_conn)
        return {
            "status": "success",
            "data": rows,
            "installedCount": sum(1 for row in rows if row["EXISTS_YN"] == "Y"),
            "total": len(rows),
        }
    finally:
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


@router.post("/schema/model-status")
def get_model_deploy_status(req: ConnectionRequest, request: Request):
    user_id = get_request_user_id(request)
    target_conn = None
    system_conn = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}
        target_conn = _connect_target(target_payload)
        rows = _fetch_model_deploy_status(target_conn)
        return {
            "status": "success",
            "data": rows,
            "total": len(rows),
        }
    finally:
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


@router.post("/schema/init")
def init_schema(req: ConnectionRequest, request: Request):
    user_id = get_request_user_id(request)
    target_conn = None
    system_conn = None
    target_cursor = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}
        target_conn = _connect_target(target_payload)
        target_cursor = target_conn.cursor()
        target_cursor.callproc("DBMS_OUTPUT.ENABLE")
        target_cursor.execute(_read_init_ddl_block())
        logs = _collect_dbms_output(target_cursor)
        target_conn.commit()

        if params.get("connectionId"):
            execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                "connectionId": params["connectionId"],
                "actionCode": "INIT_SCHEMA",
                "status": "SUCCESS",
                "message": "\n".join(logs),
            }, is_dml=True)
        return {"status": "success", "message": "Schema initialization completed.", "logs": logs}
    except Exception as e:
        if target_conn:
            target_conn.rollback()
        message = str(e)
        if system_conn and req.connectionId:
            try:
                execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                    "connectionId": int(req.connectionId),
                    "actionCode": "INIT_SCHEMA",
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=message)
    finally:
        if target_cursor:
            target_cursor.close()
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


@router.post("/schema/truncate-target")
def truncate_target_data(req: ConnectionRequest, request: Request):
    return _run_target_admin_block(
        req=req,
        request=request,
        sql_block=_read_init_target_truncate_block(),
        action_code="INIT_TARGET_TRUNCATE",
        success_message="Target data reset completed.",
    )


@router.post("/bootstrap/init-system")
def bootstrap_init_system(req: ConnectionRequest, request: Request):
    payload = _verify_bootstrap_token(_get_bootstrap_token_from_request(request, req))
    system_conn = None
    system_cursor = None
    try:
        system_conn = get_db_connection()
        system_cursor = system_conn.cursor()
        system_cursor.callproc("DBMS_OUTPUT.ENABLE")
        sql = SqlLoader.get_sql("INIT_SYSTEM_DDL")
        if not sql:
            raise HTTPException(status_code=500, detail="SQL ID INIT_SYSTEM_DDL was not found.")
        system_cursor.execute(sql)
        logs = _collect_dbms_output(system_cursor)
        admin_user_id = _insert_bootstrap_admin(system_conn, payload)
        connection_id = _insert_bootstrap_connection(system_conn, req, admin_user_id)
        system_conn.commit()
        return {
            "status": "success",
            "message": "System tables installed, bootstrap administrator created, and default DB connection saved.",
            "logs": logs,
            "adminLoginId": payload.get("loginId"),
            "connectionId": connection_id,
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
        if system_cursor:
            system_cursor.close()
        if system_conn:
            system_conn.close()


@router.post("/schema/model-objects")
def deploy_model_objects(req: ConnectionRequest, request: Request):
    user_id = get_request_user_id(request)
    target_conn = None
    system_conn = None
    target_cursor = None
    try:
        system_conn = get_db_connection()
        existing = _get_connection_detail(system_conn, int(req.connectionId), user_id) if req.connectionId else {}
        params = _normalize_connection(req, existing, user_id)
        target_payload = {**params, "password": _decode_secret(params["passwordEnc"])}
        script = _read_model_objects_script()
        checksum = hashlib.sha256(script.encode("utf-8")).hexdigest()
        object_version = _extract_model_bundle_version(script)
        statements = _split_sqlcl_script(script)
        created_objects = _extract_created_objects(script)

        target_conn = _connect_target(target_payload)
        target_cursor = target_conn.cursor()
        target_cursor.execute("ALTER SESSION DISABLE PARALLEL DML")
        target_cursor.callproc("DBMS_OUTPUT.ENABLE")
        logs = ["Running INIT_MODEL_OBJECTS.sql..."]
        for index, statement in enumerate(statements, start=1):
            target_cursor.execute(statement)
            logs.append(f"[OK] Statement {index}/{len(statements)} executed.")
        logs.extend(_collect_dbms_output(target_cursor))

        compile_errors = _record_created_object_deploy_statuses(target_conn, created_objects, object_version, checksum)
        if compile_errors:
            message = "\n".join(compile_errors)
            try:
                _record_model_deploy_status(target_conn, "FAILED", checksum, message, object_version)
                target_conn.commit()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=message)

        _record_model_deploy_status(target_conn, "SUCCESS", checksum, "", object_version)
        target_conn.commit()

        if params.get("connectionId"):
            execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                "connectionId": params["connectionId"],
                "actionCode": "INIT_MODEL_OBJECTS",
                "status": "SUCCESS",
                "message": "\n".join(logs),
            }, is_dml=True)
        return {
            "status": "success",
            "message": "Model object deployment completed.",
            "logs": logs,
            "checksum": checksum,
            "createdObjects": created_objects,
        }
    except HTTPException as e:
        message = str(e.detail)
        if target_conn:
            target_conn.rollback()
        if system_conn and req.connectionId:
            try:
                execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                    "connectionId": int(req.connectionId),
                    "actionCode": "INIT_MODEL_OBJECTS",
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise
    except Exception as e:
        if target_conn:
            target_conn.rollback()
        message = str(e)
        if system_conn and req.connectionId:
            try:
                execute_query(system_conn, "INIT_SETUP_LOG_INSERT", {
                    "connectionId": int(req.connectionId),
                    "actionCode": "INIT_MODEL_OBJECTS",
                    "status": "FAILED",
                    "message": message,
                }, is_dml=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=message)
    finally:
        if target_cursor:
            target_cursor.close()
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


@router.post("/schema/ml-seed")
def prepare_ml_seed(req: ConnectionRequest, request: Request):
    return _run_target_sqlcl_script(
        req=req,
        request=request,
        script_filename="INIT_MODEL_SEED.sql",
        action_code="INIT_MODEL_SEED",
        deploy_group="INIT_MODEL_SEED",
        deploy_name="INIT_MODEL_SEED",
        deploy_type="MODEL_SEED",
        deploy_version="1.0.0",
        start_message="Running INIT_MODEL_SEED.sql...",
        success_message="ML seed data preparation completed.",
    )


@router.post("/schema/ml-train")
def train_ml_models(req: ConnectionRequest, request: Request):
    return _run_target_sqlcl_script(
        req=req,
        request=request,
        script_filename="INIT_MODEL_TRAIN.sql",
        action_code="INIT_MODEL_TRAIN",
        deploy_group="INIT_MODEL_TRAIN",
        deploy_name="INIT_MODEL_TRAIN",
        deploy_type="ML_MODEL",
        deploy_version="1.0.0",
        start_message="Running INIT_MODEL_TRAIN.sql...",
        success_message="ML model training completed.",
    )


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
        cursor.execute(
            """
            SELECT USE_YN
              FROM "INIT$_TB_USER"
             WHERE LOGIN_ID = :loginId
            """,
            {"loginId": login_id},
        )
        existing_user = cursor.fetchone()
        if existing_user:
            if existing_user[0] == "Y":
                raise HTTPException(status_code=400, detail="이미 등록된 로그인 ID입니다.")
            raise HTTPException(status_code=400, detail="이미 승인 대기 중인 로그인 ID입니다.")
        cursor.execute(
            """
            INSERT INTO "INIT$_TB_USER" (
                LOGIN_ID,
                USER_NAME,
                EMAIL,
                PASSWORD_HASH,
                ROLE_CODE,
                USE_YN,
                CREATED_AT
            ) VALUES (
                :loginId,
                :userName,
                :email,
                :passwordHash,
                :roleCode,
                :useYn,
                SYSTIMESTAMP
            )
            """,
            {
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "passwordHash": _hash_password(req.loginPassword),
                "roleCode": role_code,
                "useYn": use_yn,
            },
        )
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
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if system_conn:
            system_conn.close()


@router.post("/login")
def login(req: LoginRequest):
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
        cursor.execute(
            """
            SELECT USER_ID, LOGIN_ID, USER_NAME, EMAIL, PASSWORD_HASH, USE_YN, ROLE_CODE
              FROM "INIT$_TB_USER"
             WHERE LOGIN_ID = :loginId
            """,
            {"loginId": login_id},
        )
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
            if len(target_connections) > 1:
                return {
                    "status": "success",
                    "message": "Select a target DB.",
                    "targetSelectionRequired": True,
                    "user": {
                        "userId": row[0],
                        "loginId": row[1],
                        "userName": row[2],
                        "email": row[3],
                        "roleCode": row[6] or "USER",
                    },
                    "connections": target_connections,
                    "connection": None,
                }
            if len(target_connections) == 1:
                connection_row = _get_connection_detail(system_conn, int(target_connections[0]["connectionId"]), user_id)
        return {
            "status": "success",
            "message": "Login succeeded.",
            "setupRequired": connection_row is None,
            "user": {
                "userId": row[0],
                "loginId": row[1],
                "userName": row[2],
                "email": row[3],
                "roleCode": row[6] or "USER",
            },
            "connection": {
                "connectionId": connection_row.get("CONNECTION_ID"),
                "connectionName": connection_row.get("CONNECTION_NAME"),
                "dbType": connection_row.get("DB_TYPE"),
            } if connection_row else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if system_conn:
            system_conn.close()


@router.post("/session/cleanup")
def cleanup_target_session(req: SessionCleanupRequest, request: Request):
    user_id = get_request_user_id(request)
    connection_id = _to_optional_int(req.connectionId) or _to_optional_int(request.headers.get("X-Target-Connection-Id"))
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
