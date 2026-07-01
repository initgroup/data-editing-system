"""
@file           M91002.py
@description    User system settings API
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, List, Optional, Tuple
import base64
import logging
import oracledb
import re
from threading import Lock

from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.auth_context import get_request_user_id
from backend.target_database import get_target_connection_id, get_target_db_connection
from backend.routers.M99001 import _hash_password, _verify_password


logger = logging.getLogger(__name__)
router = APIRouter()
_gemini_api_key_cache = {}
_gemini_api_key_cache_lock = Lock()
GEMINI_SETTING_CATEGORY = "MY_ACCOUNT"
GEMINI_SETTING_KEY = "GEMINI_API_KEY"


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


class SettingDefaultsRequest(BaseModel):
    categories: List[Dict[str, Any]] = []
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
        "data": [],
        "total": 0,
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
def create_default_settings(req: SettingDefaultsRequest, request: Request):
    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    current_owner = get_current_target_owner(request)
    categories = normalize_default_categories(req.categories)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        ensure_connection_owner(conn, user_id, connection_id)
        cursor = conn.cursor()
        merge_sql = SqlLoader.get_sql("M91002_SETTING_MERGE")
        created = 0
        updated = 0
        skipped = 0
        for category in categories:
            if category["CATEGORY_CODE"] == "MY_ACCOUNT":
                continue
            for item in category.get("DEFAULTS", []):
                cursor.execute(SqlLoader.get_sql("M91002_SETTING_EXISTS"), {
                    "userId": user_id,
                    "connectionId": connection_id,
                    "categoryCode": category["CATEGORY_CODE"],
                    "settingKey": item["SETTING_KEY"],
                })
                exists = cursor.fetchone()[0] > 0
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
                if exists:
                    updated += 1
                else:
                    created += 1
        conn.commit()
        return {
            "status": "success",
            "message": f"{created} default setting(s) created. {updated} existing setting(s) updated. {skipped} skipped.",
            "createdCount": created,
            "updatedCount": updated,
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
        cursor.execute(SqlLoader.get_sql("M91002_ACCOUNT_ME"), {"userId": user_id})
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
        cursor.execute(SqlLoader.get_sql("M91002_ACTIVE_SETTING_VALUE"), {
            "userId": user_id,
            "connectionId": connection_id,
            "categoryCode": get_gemini_setting_category(),
            "settingKey": get_gemini_setting_key(),
        })
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
            "categoryCode": get_gemini_setting_category(),
            "settingKey": get_gemini_setting_key(),
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
            "categoryCode": get_gemini_setting_category(),
            "settingKey": get_gemini_setting_key(),
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
        cursor.execute(SqlLoader.get_sql("M91002_USER_NAME_UPDATE"), {"userName": user_name, "userId": user_id})
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
        cursor.execute(SqlLoader.get_sql("M91002_ACTIVE_USER_PASSWORD"), {"userId": user_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        if not _verify_password(current_password, row[0] or ""):
            raise HTTPException(status_code=400, detail="Current password is not correct.")

        cursor.execute(SqlLoader.get_sql("M91002_EMAIL_DUPLICATE_COUNT"), {"email": new_email, "userId": user_id})
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(status_code=400, detail="Email is already used by another user.")

        cursor.execute(SqlLoader.get_sql("M91002_EMAIL_UPDATE"), {"email": new_email, "userId": user_id})
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
        cursor.execute(SqlLoader.get_sql("M91002_ACTIVE_USER_PASSWORD"), {"userId": user_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        if not _verify_password(current_password, row[0] or ""):
            raise HTTPException(status_code=400, detail="Current password is not correct.")

        cursor.execute(SqlLoader.get_sql("M91002_PASSWORD_UPDATE"), {
            "passwordHash": _hash_password(new_password),
            "userId": user_id,
        })
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
        cursor.execute(SqlLoader.get_sql("M91002_CURRENT_SCHEMA"))
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
        cursor.execute(SqlLoader.get_sql("M91002_CONNECTION_OWNER_COUNT"), {"userId": user_id, "connectionId": connection_id})
        row = cursor.fetchone()
        if not row or int(row[0] or 0) <= 0:
            raise HTTPException(status_code=403, detail="Selected target DB connection is not available for this user.")
    finally:
        if cursor:
            cursor.close()


def fetch_result(conn, sql: str, params: Optional[Dict] = None) -> Tuple[List[Dict], List[str]]:
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
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", text):
        raise HTTPException(status_code=400, detail="Invalid categoryCode.")
    return text


def get_gemini_setting_category() -> str:
    return GEMINI_SETTING_CATEGORY


def get_gemini_setting_key() -> str:
    return GEMINI_SETTING_KEY


def normalize_default_categories(categories: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(categories, list) or not categories:
        raise HTTPException(status_code=400, detail="Default setting categories are required.")

    normalized = []
    for category in categories:
        if not isinstance(category, dict):
            raise HTTPException(status_code=400, detail="Invalid default setting category.")
        category_code = normalize_category_code(category.get("CATEGORY_CODE"))
        defaults = category.get("DEFAULTS") or []
        if not isinstance(defaults, list):
            raise HTTPException(status_code=400, detail="Invalid default setting item list.")
        normalized.append({
            "CATEGORY_CODE": category_code,
            "DEFAULTS": [normalize_default_item(item) for item in defaults]
        })
    return normalized


def normalize_default_item(item: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(item, dict):
        raise HTTPException(status_code=400, detail="Invalid default setting item.")
    setting_key = str(item.get("SETTING_KEY") or "").strip()
    if not setting_key:
        raise HTTPException(status_code=400, detail="Default setting key is required.")
    try:
        sort_order = int(item.get("SORT_ORDER") or 0)
    except (TypeError, ValueError):
        sort_order = 0
    return {
        "SETTING_KEY": setting_key[:200],
        "SETTING_VALUE": str(item.get("SETTING_VALUE") or ""),
        "SETTING_DESC": str(item.get("SETTING_DESC") or "")[:1000],
        "SORT_ORDER": sort_order
    }


def re_match_email(value: str) -> bool:
    return bool(__import__("re").match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", value or ""))
