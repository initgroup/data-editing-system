"""
@file           M91003.py
@description    Target database settings API
"""

from typing import Any, Dict, List, Optional, Tuple
import logging
import oracledb
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from backend.auth_context import get_request_user_id
from backend.database_helper import SqlLoader
from backend.target_database import get_target_db_connection


logger = logging.getLogger(__name__)
router = APIRouter()


class TargetSettingSaveRequest(BaseModel):
    categoryCode: str = "DATA_PROFILING"
    settingKey: str
    settingValue: Optional[str] = ""
    settingDesc: Optional[str] = ""
    sortOrder: Optional[int] = 0
    useYn: Optional[str] = "Y"
    model_config = ConfigDict(extra="allow")


class TargetSettingDeleteRequest(BaseModel):
    categoryCode: str
    settingKey: str
    model_config = ConfigDict(extra="allow")


class TargetSettingDefaultsRequest(BaseModel):
    categories: List[Dict[str, Any]] = []
    model_config = ConfigDict(extra="allow")


@router.get("/settings")
def list_settings(request: Request, categoryCode: Optional[str] = None):
    get_request_user_id(request)
    category_code = normalize_category_code(categoryCode) if categoryCode else None
    conn = None
    try:
        conn = get_target_db_connection(request)
        rows, columns = fetch_result(conn, SqlLoader.get_sql("M91003_SETTING_LIST"), {
            "categoryCode": category_code,
        })
        return {
            "status": "success",
            "data": rows,
            "columns": columns,
            "total": len(rows),
        }
    except Exception as e:
        logger.error(f"M91003 target setting list failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
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
def save_setting(req: TargetSettingSaveRequest, request: Request):
    get_request_user_id(request)
    category_code = normalize_category_code(req.categoryCode)
    setting_key = (req.settingKey or "").strip().upper()
    if not setting_key:
        raise HTTPException(status_code=400, detail="Setting key is required.")
    use_yn = "N" if str(req.useYn or "Y").upper() == "N" else "Y"

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.setinputsizes(settingValue=oracledb.DB_TYPE_CLOB)
        cursor.execute(SqlLoader.get_sql("M91003_SETTING_MERGE"), {
            "categoryCode": category_code,
            "settingKey": setting_key,
            "settingValue": req.settingValue or "",
            "settingDesc": req.settingDesc or "",
            "sortOrder": req.sortOrder if req.sortOrder is not None else 0,
            "useYn": use_yn,
        })
        conn.commit()
        return {"status": "success", "message": "Target setting saved."}
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91003 target setting save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/setting/delete")
def delete_setting(req: TargetSettingDeleteRequest, request: Request):
    get_request_user_id(request)
    category_code = normalize_category_code(req.categoryCode)
    setting_key = (req.settingKey or "").strip().upper()
    if not setting_key:
        raise HTTPException(status_code=400, detail="Setting key is required.")

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M91003_SETTING_DELETE"), {
            "categoryCode": category_code,
            "settingKey": setting_key,
        })
        conn.commit()
        return {"status": "success", "message": "Target setting deleted.", "deletedCount": cursor.rowcount}
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91003 target setting delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/setting/defaults")
def create_default_settings(req: TargetSettingDefaultsRequest, request: Request):
    get_request_user_id(request)
    categories = normalize_default_categories(req.categories)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        merge_sql = SqlLoader.get_sql("M91003_SETTING_MERGE")
        created = 0
        updated = 0
        skipped = 0
        for category in categories:
            for item in category.get("DEFAULTS", []):
                cursor.execute(SqlLoader.get_sql("M91003_SETTING_EXISTS"), {
                    "categoryCode": category["CATEGORY_CODE"],
                    "settingKey": item["SETTING_KEY"],
                })
                exists = cursor.fetchone()[0] > 0
                cursor.setinputsizes(settingValue=oracledb.DB_TYPE_CLOB)
                cursor.execute(merge_sql, {
                    "categoryCode": category["CATEGORY_CODE"],
                    "settingKey": item["SETTING_KEY"],
                    "settingValue": item.get("SETTING_VALUE", ""),
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
            "message": f"{created} target default setting(s) created. {updated} existing setting(s) updated. {skipped} skipped.",
            "createdCount": created,
            "updatedCount": updated,
            "skippedCount": skipped,
        }
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M91003 target default setting save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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


def normalize_category_code(value: Optional[str]) -> str:
    text = str(value or "DATA_PROFILING").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", text):
        raise HTTPException(status_code=400, detail="Invalid categoryCode.")
    return text


def normalize_default_categories(categories: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(categories, list) or not categories:
        raise HTTPException(status_code=400, detail="Target default setting categories are required.")

    normalized = []
    for category in categories:
        if not isinstance(category, dict):
            raise HTTPException(status_code=400, detail="Invalid target default setting category.")
        category_code = normalize_category_code(category.get("CATEGORY_CODE"))
        defaults = category.get("DEFAULTS") or []
        if not isinstance(defaults, list):
            raise HTTPException(status_code=400, detail="Invalid target default setting item list.")
        normalized.append({
            "CATEGORY_CODE": category_code,
            "DEFAULTS": [normalize_default_item(item) for item in defaults]
        })
    return normalized


def normalize_default_item(item: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(item, dict):
        raise HTTPException(status_code=400, detail="Invalid target default setting item.")
    setting_key = str(item.get("SETTING_KEY") or "").strip().upper()
    if not setting_key:
        raise HTTPException(status_code=400, detail="Target default setting key is required.")
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
