"""
@file           M91003.py
@description    Target database settings API
"""

from typing import Dict, List, Optional, Tuple
import logging
import oracledb

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from backend.auth_context import get_request_user_id
from backend.database_helper import SqlLoader
from backend.setting_defaults import get_target_setting_categories
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
    categories = get_target_setting_categories()
    return {
        "status": "success",
        "data": [
            {key: value for key, value in category.items() if key != "DEFAULTS"}
            for category in categories
        ],
        "total": len(categories),
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
def create_default_settings(request: Request):
    get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        merge_sql = SqlLoader.get_sql("M91003_SETTING_MERGE")
        created = 0
        skipped = 0
        for category in get_target_setting_categories():
            for item in category.get("DEFAULTS", []):
                cursor.execute(SqlLoader.get_sql("M91003_SETTING_EXISTS"), {
                    "categoryCode": category["CATEGORY_CODE"],
                    "settingKey": item["SETTING_KEY"],
                })
                if cursor.fetchone()[0] > 0:
                    skipped += 1
                    continue
                cursor.setinputsizes(settingValue=oracledb.DB_TYPE_CLOB)
                cursor.execute(merge_sql, {
                    "categoryCode": category["CATEGORY_CODE"],
                    "settingKey": item["SETTING_KEY"],
                    "settingValue": item.get("SETTING_VALUE", ""),
                    "settingDesc": item.get("SETTING_DESC", ""),
                    "sortOrder": item.get("SORT_ORDER", 0),
                    "useYn": "Y",
                })
                created += 1
        conn.commit()
        return {
            "status": "success",
            "message": f"{created} missing target default setting(s) saved. {skipped} existing setting(s) skipped.",
            "createdCount": created,
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
    allowed = {category["CATEGORY_CODE"] for category in get_target_setting_categories()}
    if text not in allowed:
        raise HTTPException(status_code=400, detail="Invalid categoryCode.")
    return text
