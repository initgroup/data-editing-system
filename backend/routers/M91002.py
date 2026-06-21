"""
@file           M91002.py
@description    User system settings API
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from typing import Optional
import base64
import logging
import oracledb
from threading import Lock

from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.auth_context import get_request_user_id
from backend.target_database import get_target_connection_id, get_target_db_connection
from backend.routers.M99001 import _hash_password, _verify_password


logger = logging.getLogger(__name__)
router = APIRouter()
GEMINI_SETTING_CATEGORY = "MY_ACCOUNT"
GEMINI_SETTING_KEY = "GEMINI_API_KEY"
_gemini_api_key_cache = {}
_gemini_api_key_cache_lock = Lock()


class SettingSaveRequest(BaseModel):
    categoryCode: str = "GENERAL"
    settingKey: str
    settingValue: Optional[str] = ""
    settingDesc: Optional[str] = ""
    sortOrder: Optional[int] = 0
    useYn: Optional[str] = "Y"
    model_config = ConfigDict(extra="allow")


class SettingDeleteRequest(BaseModel):
    categoryCode: str
    settingKey: str
    model_config = ConfigDict(extra="allow")


class PasswordChangeRequest(BaseModel):
    currentPassword: str
    newPassword: str
    newPasswordConfirm: str
    model_config = ConfigDict(extra="allow")


class EmailChangeRequest(BaseModel):
    currentPassword: str
    newEmail: str
    model_config = ConfigDict(extra="allow")


class UserNameChangeRequest(BaseModel):
    userName: str
    model_config = ConfigDict(extra="allow")


class GeminiApiKeySaveRequest(BaseModel):
    apiKey: str
    model_config = ConfigDict(extra="allow")


SETTING_CATEGORIES = [
    {
        "CATEGORY_CODE": "MY_ACCOUNT",
        "CATEGORY_NAME": "나의 회원정보",
        "CATEGORY_DESC": "내 로그인 정보, 이메일, 비밀번호를 관리합니다.",
        "SORT_ORDER": 0,
        "DEFAULTS": [],
    },
    {
        "CATEGORY_CODE": "GENERAL",
        "CATEGORY_NAME": "System General",
        "CATEGORY_DESC": "Basic system display settings.",
        "SORT_ORDER": 10,
        "DEFAULTS": [
            {
                "SETTING_KEY": "SYSTEM_DISPLAY_NAME",
                "SETTING_VALUE": "Data Editing System",
                "SETTING_DESC": "System display name.",
                "SORT_ORDER": 10,
            }
        ],
    },
    {
        "CATEGORY_CODE": "M02002_TABLE_FILTER",
        "CATEGORY_NAME": "M02002 Table Filter",
        "CATEGORY_DESC": "M02002 Table Explorer include/exclude settings.",
        "SORT_ORDER": 20,
        "DEFAULTS": [
            {
                "SETTING_KEY": "EXCLUDE_TABLE_LIKE",
                "SETTING_VALUE": "INIT$%\nBIN$%\nDM$%",
                "SETTING_DESC": "Exclude table LIKE patterns. Enter one pattern per line.",
                "SORT_ORDER": 10,
            },
            {
                "SETTING_KEY": "INCLUDE_OWNER",
                "SETTING_VALUE": "__CURRENT_OWNER__",
                "SETTING_DESC": "Included owners. Enter one owner per line.",
                "SORT_ORDER": 20,
            },
        ],
    },
    {
        "CATEGORY_CODE": "OTHER",
        "CATEGORY_NAME": "Other Settings",
        "CATEGORY_DESC": "Additional system settings.",
        "SORT_ORDER": 90,
        "DEFAULTS": [
            {
                "SETTING_KEY": "CONSOLE_LOG_MAX_ENTRIES",
                "SETTING_VALUE": "500",
                "SETTING_DESC": "Maximum browser log lines retained in the bottom Network / Run Log panel.",
                "SORT_ORDER": 10,
            }
        ],
    },
]


@router.get("/settings")
def list_settings(request: Request, categoryCode: Optional[str] = None):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    category_code = normalize_category_code(categoryCode) if categoryCode else None
    if category_code == "MY_ACCOUNT":
        return {
            "status": "success",
            "data": [],
            "columns": [],
            "total": 0,
        }
    conn = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        rows, columns = fetch_result(conn, SqlLoader.get_sql("M91002_SETTING_LIST"), {
            "userId": user_id,
            "connectionId": connection_id,
            "categoryCode": category_code,
        })
        return {
            "status": "success",
            "data": rows,
            "columns": columns,
            "total": len(rows),
        }
    finally:
        if conn:
            conn.close()


@router.get("/setting-categories")
def list_setting_categories():
    return {
        "status": "success",
        "data": [
            {key: value for key, value in category.items() if key != "DEFAULTS"}
            for category in SETTING_CATEGORIES
        ],
        "total": len(SETTING_CATEGORIES),
    }


@router.post("/setting/save")
def save_setting(req: SettingSaveRequest, request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    category_code = normalize_category_code(req.categoryCode)
    setting_key = (req.settingKey or "").strip()
    if not setting_key:
        raise HTTPException(status_code=400, detail="Setting key is required.")
    use_yn = "N" if str(req.useYn or "Y").upper() == "N" else "Y"

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        cursor = conn.cursor()
        cursor.setinputsizes(settingValue=oracledb.DB_TYPE_CLOB)
        cursor.execute(SqlLoader.get_sql("M91002_SETTING_MERGE"), {
            "userId": user_id,
            "connectionId": connection_id,
            "categoryCode": category_code,
            "settingKey": setting_key,
            "settingValue": req.settingValue or "",
            "settingDesc": req.settingDesc or "",
            "sortOrder": req.sortOrder if req.sortOrder is not None else 0,
            "useYn": use_yn,
        })
        conn.commit()
        return {"status": "success", "message": "Setting saved."}
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 setting save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/setting/delete")
def delete_setting(req: SettingDeleteRequest, request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    category_code = normalize_category_code(req.categoryCode)
    setting_key = (req.settingKey or "").strip()
    if not setting_key:
        raise HTTPException(status_code=400, detail="Setting key is required.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M91002_SETTING_DELETE"), {
            "userId": user_id,
            "connectionId": connection_id,
            "categoryCode": category_code,
            "settingKey": setting_key,
        })
        conn.commit()
        return {"status": "success", "message": "Setting deleted.", "deletedCount": cursor.rowcount}
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 setting delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/setting/defaults")
def create_default_settings(request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    current_owner = get_current_target_owner(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        cursor = conn.cursor()
        merge_sql = SqlLoader.get_sql("M91002_SETTING_MERGE")
        created = 0
        skipped = 0
        for category in SETTING_CATEGORIES:
            if category["CATEGORY_CODE"] == "MY_ACCOUNT":
                continue
            for item in category.get("DEFAULTS", []):
                cursor.execute(
                    """
                    SELECT COUNT(*)
                     FROM "INIT$_TB_SYSTEM_SETTING"
                     WHERE USER_ID = :userId
                       AND CONNECTION_ID = :connectionId
                       AND CATEGORY_CODE = :categoryCode
                       AND SETTING_KEY = :settingKey
                    """,
                    {
                        "userId": user_id,
                        "connectionId": connection_id,
                        "categoryCode": category["CATEGORY_CODE"],
                        "settingKey": item["SETTING_KEY"],
                    },
                )
                if cursor.fetchone()[0] > 0:
                    skipped += 1
                    continue
                setting_value = item.get("SETTING_VALUE", "")
                if setting_value == "__CURRENT_OWNER__":
                    setting_value = current_owner
                cursor.execute(merge_sql, {
                    "userId": user_id,
                    "connectionId": connection_id,
                    "categoryCode": category["CATEGORY_CODE"],
                    "settingKey": item["SETTING_KEY"],
                    "settingValue": setting_value,
                    "settingDesc": item.get("SETTING_DESC", ""),
                    "sortOrder": item.get("SORT_ORDER", 0),
                    "useYn": "Y",
                })
                created += 1
        conn.commit()
        return {
            "status": "success",
            "message": f"{created} missing default setting(s) saved. {skipped} existing setting(s) skipped.",
            "createdCount": created,
            "skippedCount": skipped,
        }
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 default setting save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/account/me")
def get_my_account(request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT USER_ID,
                   LOGIN_ID,
                   USER_NAME,
                   EMAIL,
                   ROLE_CODE,
                   USE_YN,
                   CREATED_AT,
                   UPDATED_AT
              FROM "INIT$_TB_USER"
             WHERE USER_ID = :userId
            """,
            {"userId": user_id},
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Login user was not found.")
        return {
            "status": "success",
            "data": {
                "userId": row[0],
                "loginId": row[1],
                "userName": row[2],
                "email": row[3],
                "roleCode": row[4] or "USER",
                "useYn": row[5],
                "createdAt": normalize_db_value(row[6]),
                "updatedAt": normalize_db_value(row[7]),
            },
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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


def get_saved_gemini_api_key(conn, user_id: int, connection_id: int) -> str:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT SETTING_VALUE
              FROM "INIT$_TB_SYSTEM_SETTING"
             WHERE USER_ID = :userId
               AND CONNECTION_ID = :connectionId
               AND CATEGORY_CODE = :categoryCode
               AND SETTING_KEY = :settingKey
               AND USE_YN = 'Y'
            """,
            {
                "userId": user_id,
                "connectionId": connection_id,
                "categoryCode": GEMINI_SETTING_CATEGORY,
                "settingKey": GEMINI_SETTING_KEY,
            },
        )
        row = cursor.fetchone()
        if not row:
            return ""
        value = row[0].read() if hasattr(row[0], "read") else row[0]
        return _decode_secret(value)
    finally:
        if cursor:
            cursor.close()


def get_cached_gemini_api_key(conn, user_id: int, connection_id: int) -> str:
    key = (int(user_id), int(connection_id))
    with _gemini_api_key_cache_lock:
        cached = _gemini_api_key_cache.get(key)
    if cached is not None:
        return cached

    api_key = get_saved_gemini_api_key(conn, user_id, connection_id)
    with _gemini_api_key_cache_lock:
        _gemini_api_key_cache[key] = api_key
    return api_key


def clear_gemini_api_key_cache(user_id: int, connection_id: Optional[int] = None) -> None:
    with _gemini_api_key_cache_lock:
        if connection_id is not None:
            _gemini_api_key_cache.pop((int(user_id), int(connection_id)), None)
            return
        target_user_id = int(user_id)
        for key in list(_gemini_api_key_cache):
            if key[0] == target_user_id:
                _gemini_api_key_cache.pop(key, None)


@router.get("/account/gemini-key")
def get_gemini_api_key_status(request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    conn = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        api_key = get_cached_gemini_api_key(conn, user_id, connection_id)
        return {
            "status": "success",
            "data": {
                "registered": bool(api_key),
                "maskedKey": mask_secret(api_key),
            },
        }
    finally:
        if conn:
            conn.close()


@router.post("/account/gemini-key/save")
def save_gemini_api_key(req: GeminiApiKeySaveRequest, request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    api_key = (req.apiKey or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API key is required.")
    if len(api_key) > 4000:
        raise HTTPException(status_code=400, detail="Gemini API key is too long.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M91002_SETTING_MERGE"), {
            "userId": user_id,
            "connectionId": connection_id,
            "categoryCode": GEMINI_SETTING_CATEGORY,
            "settingKey": GEMINI_SETTING_KEY,
            "settingValue": _encode_secret(api_key),
            "settingDesc": "Personal Gemini API key for the right sidebar assistant.",
            "sortOrder": 900,
            "useYn": "Y",
        })
        conn.commit()
        clear_gemini_api_key_cache(user_id, connection_id)
        return {
            "status": "success",
            "message": "Gemini API key saved.",
            "data": {
                "registered": True,
                "maskedKey": mask_secret(api_key),
            },
        }
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 Gemini API key save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/account/gemini-key/delete")
def delete_gemini_api_key(request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M91002_SETTING_DELETE"), {
            "userId": user_id,
            "connectionId": connection_id,
            "categoryCode": GEMINI_SETTING_CATEGORY,
            "settingKey": GEMINI_SETTING_KEY,
        })
        conn.commit()
        clear_gemini_api_key_cache(user_id, connection_id)
        return {"status": "success", "message": "Gemini API key deleted.", "deletedCount": cursor.rowcount}
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 Gemini API key delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/account/name/change")
def change_user_name(req: UserNameChangeRequest, request: Request):
    user_id = get_request_user_id(request)
    user_name = (req.userName or "").strip()
    if not user_name:
        raise HTTPException(status_code=400, detail="User name is required.")
    if len(user_name) > 200:
        raise HTTPException(status_code=400, detail="User name must be 200 characters or less.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE "INIT$_TB_USER"
               SET USER_NAME = :userName,
                   UPDATED_AT = SYSTIMESTAMP
             WHERE USER_ID = :userId
               AND USE_YN = 'Y'
            """,
            {"userName": user_name, "userId": user_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        conn.commit()
        return {"status": "success", "message": "User name changed.", "userName": user_name}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 user name change failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/account/email/change")
def change_email(req: EmailChangeRequest, request: Request):
    user_id = get_request_user_id(request)
    current_password = req.currentPassword or ""
    new_email = (req.newEmail or "").strip()
    if not current_password:
        raise HTTPException(status_code=400, detail="Current password is required.")
    if not new_email:
        raise HTTPException(status_code=400, detail="New email is required.")
    if not re_match_email(new_email):
        raise HTTPException(status_code=400, detail="Invalid email format.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT PASSWORD_HASH
              FROM "INIT$_TB_USER"
             WHERE USER_ID = :userId
               AND USE_YN = 'Y'
            """,
            {"userId": user_id},
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        if not _verify_password(current_password, row[0] or ""):
            raise HTTPException(status_code=400, detail="Current password is not correct.")

        cursor.execute(
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_USER"
             WHERE EMAIL = :email
               AND USER_ID <> :userId
            """,
            {"email": new_email, "userId": user_id},
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(status_code=400, detail="Email is already used by another user.")

        cursor.execute(
            """
            UPDATE "INIT$_TB_USER"
               SET EMAIL = :email,
                   UPDATED_AT = SYSTIMESTAMP
             WHERE USER_ID = :userId
            """,
            {"email": new_email, "userId": user_id},
        )
        conn.commit()
        return {"status": "success", "message": "Email changed.", "email": new_email}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 email change failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/account/password/change")
def change_password(req: PasswordChangeRequest, request: Request):
    user_id = get_request_user_id(request)
    current_password = req.currentPassword or ""
    new_password = req.newPassword or ""
    new_password_confirm = req.newPasswordConfirm or ""

    if not current_password:
        raise HTTPException(status_code=400, detail="Current password is required.")
    if not new_password:
        raise HTTPException(status_code=400, detail="New password is required.")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")
    if new_password != new_password_confirm:
        raise HTTPException(status_code=400, detail="New password confirmation does not match.")
    if current_password == new_password:
        raise HTTPException(status_code=400, detail="New password must be different from current password.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT PASSWORD_HASH
              FROM "INIT$_TB_USER"
             WHERE USER_ID = :userId
               AND USE_YN = 'Y'
            """,
            {"userId": user_id},
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        if not _verify_password(current_password, row[0] or ""):
            raise HTTPException(status_code=400, detail="Current password is not correct.")

        cursor.execute(
            """
            UPDATE "INIT$_TB_USER"
               SET PASSWORD_HASH = :passwordHash,
                   UPDATED_AT = SYSTIMESTAMP
             WHERE USER_ID = :userId
            """,
            {
                "passwordHash": _hash_password(new_password),
                "userId": user_id,
            },
        )
        conn.commit()
        return {"status": "success", "message": "Password changed. Please use the new password from next login."}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91002 password change failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def get_current_target_owner(request: Request) -> str:
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute("SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM DUAL")
        row = cursor.fetchone()
        return str(row[0] if row and row[0] else "").strip().upper()
    except Exception as e:
        logger.warning(f"M91002 current target owner lookup failed: {str(e)}")
        return ""
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def ensure_connection_owner(conn, user_id: int, connection_id: int) -> None:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*)
              FROM "INIT$_TB_DB_CONNECTION" C
              JOIN "INIT$_TB_USER" U
                ON U.USER_ID = C.USER_ID
             WHERE C.CONNECTION_ID = :connectionId
               AND C.USE_YN = 'Y'
               AND (C.USER_ID = :userId OR U.ROLE_CODE = 'ADMIN')
            """,
            {"userId": user_id, "connectionId": connection_id},
        )
        row = cursor.fetchone()
        if not row or int(row[0] or 0) <= 0:
            raise HTTPException(status_code=403, detail="Selected target DB connection is not available for this user.")
    finally:
        if cursor:
            cursor.close()


def fetch_result(conn, sql: str, params: Optional[dict] = None) -> tuple[list[dict], list[str]]:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params or {})
        columns = [col[0] for col in cursor.description] if cursor.description else []
        return [
            {column: normalize_db_value(value) for column, value in zip(columns, row)}
            for row in cursor.fetchall()
        ], columns
    finally:
        if cursor:
            cursor.close()


def normalize_db_value(value):
    if hasattr(value, "read"):
        value = value.read()
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    return value


def mask_secret(value: Optional[str]) -> str:
    text = str(value or "")
    if not text:
        return ""
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}...{text[-4:]}"


def normalize_category_code(value: Optional[str]) -> str:
    text = str(value or "GENERAL").strip().upper()
    allowed = {category["CATEGORY_CODE"] for category in SETTING_CATEGORIES}
    if text not in allowed:
        raise HTTPException(status_code=400, detail="Invalid categoryCode.")
    return text


def re_match_email(value: str) -> bool:
    return bool(__import__("re").match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", value or ""))
