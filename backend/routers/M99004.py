"""
@file           M99004.py
@description    Notice management API for administrators
"""

from datetime import datetime
import logging
import os
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
import oracledb
from pydantic import BaseModel, ConfigDict

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])


class NoticeListRequest(BaseModel):
    keyword: Optional[str] = ""
    useYn: Optional[str] = "ALL"
    activeOnly: Optional[bool] = False
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


class NoticeSaveRequest(BaseModel):
    noticeId: Optional[int] = None
    noticeType: Optional[str] = "INFO"
    title: str
    content: Optional[str] = ""
    postStartAt: Optional[str] = None
    postEndAt: Optional[str] = None
    popupYn: Optional[str] = "N"
    popupStartAt: Optional[str] = None
    popupEndAt: Optional[str] = None
    pinYn: Optional[str] = "N"
    useYn: Optional[str] = "Y"
    sortOrder: Optional[int] = 0
    model_config = ConfigDict(extra="allow")


class NoticeDeleteRequest(BaseModel):
    noticeId: int
    model_config = ConfigDict(extra="allow")


class NoticeFileDeleteRequest(BaseModel):
    fileId: int
    model_config = ConfigDict(extra="allow")


def _normalize_yn(value: Optional[str], default: str = "N") -> str:
    text = str(value or default).strip().upper()
    if text not in {"Y", "N"}:
        raise HTTPException(status_code=400, detail="Y/N value is invalid.")
    return text


def _normalize_notice_type(value: Optional[str]) -> str:
    text = str(value or "INFO").strip().upper()
    if text not in {"INFO", "IMPORTANT", "MAINTENANCE", "WARNING"}:
        raise HTTPException(status_code=400, detail="Notice type is invalid.")
    return text


def _normalize_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 100)
    except (TypeError, ValueError):
        limit = 100
    return max(1, min(limit, 500))


def _parse_datetime(value: Optional[str]):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid datetime value: {text}")


def _read_lob(value):
    if hasattr(value, "read"):
        return value.read()
    return value


def _format_value(value):
    value = _read_lob(value)
    if isinstance(value, datetime):
        return value.isoformat(timespec="minutes")
    return value


def _row_to_notice(columns, row):
    return {column: _format_value(value) for column, value in zip(columns, row)}


def _row_to_file(columns, row):
    return {column: _format_value(value) for column, value in zip(columns, row)}


def _fetch_notice(cursor, notice_id: int):
    cursor.execute(SqlLoader.get_sql("M99004_NOTICE_DETAIL"), {"noticeId": notice_id})
    row = cursor.fetchone()
    if not row:
        return None
    columns = [col[0] for col in cursor.description]
    return _row_to_notice(columns, row)


def _fetch_notice_files(cursor, notice_id: int, include_inactive: bool = False):
    cursor.execute(SqlLoader.get_sql("M99004_NOTICE_FILE_LIST"), {
        "noticeId": notice_id,
        "includeInactive": "Y" if include_inactive else "N",
    })
    columns = [col[0] for col in cursor.description]
    return [_row_to_file(columns, row) for row in cursor.fetchall()], columns


def _safe_file_name(value: Optional[str]) -> str:
    text = str(value or "").replace("\\", "/").split("/")[-1].strip()
    text = text.replace("\r", "").replace("\n", "")
    return (text or "attachment")[:500]


def _max_notice_file_bytes() -> int:
    try:
        megabytes = int(os.getenv("NOTICE_FILE_MAX_MB", "10"))
    except (TypeError, ValueError):
        megabytes = 10
    return max(1, min(megabytes, 100)) * 1024 * 1024


@router.post("/notices")
def list_notices(req: NoticeListRequest):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        params = {"limit": _normalize_limit(req.limit)}

        keyword = str(req.keyword or "").strip()
        params["keyword"] = f"%{keyword.upper()}%" if keyword else None
        params["keywordText"] = keyword.upper() if keyword else None

        use_yn = str(req.useYn or "ALL").strip().upper()
        if use_yn not in {"Y", "N", "ALL"}:
            raise HTTPException(status_code=400, detail="useYn is invalid.")
        params["useYn"] = use_yn

        params["activeOnly"] = "Y" if req.activeOnly else "N"
        cursor.execute(SqlLoader.get_sql("M99004_NOTICE_LIST"), params)
        columns = [col[0] for col in cursor.description]
        rows = [_row_to_notice(columns, row) for row in cursor.fetchall()]
        return {"status": "success", "data": rows, "columns": columns, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("M99004 notice list failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/notices/{notice_id}")
def get_notice(notice_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        notice = _fetch_notice(cursor, notice_id)
        if not notice:
            raise HTTPException(status_code=404, detail="Notice was not found.")
        return {"status": "success", "data": notice}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("M99004 notice detail failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/notices/{notice_id}/files")
def list_notice_files(notice_id: int, includeInactive: str = "N"):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if not _fetch_notice(cursor, notice_id):
            raise HTTPException(status_code=404, detail="Notice was not found.")
        rows, columns = _fetch_notice_files(cursor, notice_id, str(includeInactive).upper() == "Y")
        return {"status": "success", "data": rows, "columns": columns, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("M99004 notice file list failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/notices/save")
def save_notice(req: NoticeSaveRequest, user_id: int = Depends(get_request_user_id)):
    title = str(req.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Notice title is required.")

    params = {
        "noticeType": _normalize_notice_type(req.noticeType),
        "title": title,
        "content": req.content or "",
        "postStartAt": _parse_datetime(req.postStartAt),
        "postEndAt": _parse_datetime(req.postEndAt),
        "popupYn": _normalize_yn(req.popupYn),
        "popupStartAt": _parse_datetime(req.popupStartAt),
        "popupEndAt": _parse_datetime(req.popupEndAt),
        "pinYn": _normalize_yn(req.pinYn),
        "useYn": _normalize_yn(req.useYn, "Y"),
        "sortOrder": int(req.sortOrder or 0),
        "userId": user_id,
    }
    if params["postStartAt"] and params["postEndAt"] and params["postStartAt"] > params["postEndAt"]:
        raise HTTPException(status_code=400, detail="Post start date must be before post end date.")
    if params["popupStartAt"] and params["popupEndAt"] and params["popupStartAt"] > params["popupEndAt"]:
        raise HTTPException(status_code=400, detail="Popup start date must be before popup end date.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        notice_id = int(req.noticeId or 0)
        if notice_id > 0:
            cursor.execute(SqlLoader.get_sql("M99004_NOTICE_UPDATE"), {**params, "noticeId": notice_id})
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Notice was not found.")
        else:
            notice_id_var = cursor.var(int)
            cursor.execute(SqlLoader.get_sql("M99004_NOTICE_INSERT"), {**params, "noticeIdOut": notice_id_var})
            value = notice_id_var.getvalue()
            notice_id = int(value[0] if isinstance(value, list) else value)

        conn.commit()
        notice = _fetch_notice(cursor, notice_id)
        return {"status": "success", "message": "Notice saved.", "data": notice}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error("M99004 notice save failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/notices/{notice_id}/files")
async def upload_notice_file(
    notice_id: int,
    file: UploadFile = File(...),
    sortOrder: int = Form(0),
    user_id: int = Depends(get_request_user_id),
):
    file_name = _safe_file_name(file.filename)
    content_type = str(file.content_type or "application/octet-stream")[:200]
    content = await file.read()
    max_bytes = _max_notice_file_bytes()
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Attachment is too large. Max size is {max_bytes // 1024 // 1024} MB.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if not _fetch_notice(cursor, notice_id):
            raise HTTPException(status_code=404, detail="Notice was not found.")

        file_id_var = cursor.var(int)
        cursor.setinputsizes(fileData=oracledb.DB_TYPE_BLOB)
        cursor.execute(SqlLoader.get_sql("M99004_NOTICE_FILE_INSERT"), {
            "noticeId": notice_id,
            "fileName": file_name,
            "contentType": content_type,
            "fileSize": len(content),
            "fileData": content,
            "sortOrder": int(sortOrder or 0),
            "userId": user_id,
            "fileIdOut": file_id_var,
        })
        value = file_id_var.getvalue()
        file_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        rows, columns = _fetch_notice_files(cursor, notice_id)
        return {
            "status": "success",
            "message": "Attachment uploaded.",
            "fileId": file_id,
            "data": rows,
            "columns": columns,
            "total": len(rows),
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error("M99004 notice file upload failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await file.close()
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/files/{file_id}/download")
def download_notice_file(file_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M99004_NOTICE_FILE_DOWNLOAD"), {"fileId": file_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attachment was not found.")
        file_name = _safe_file_name(row[2])
        content_type = row[3] or "application/octet-stream"
        file_data = _read_lob(row[5]) or b""
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        quoted_name = quote(file_name)
        return Response(
            content=file_data,
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename=\"attachment\"; filename*=UTF-8''{quoted_name}",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("M99004 notice file download failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/files/delete")
def delete_notice_file(req: NoticeFileDeleteRequest):
    file_id = int(req.fileId or 0)
    if file_id <= 0:
        raise HTTPException(status_code=400, detail="Select an attachment before deleting.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M99004_NOTICE_FILE_DELETE"), {"fileId": file_id})
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Attachment was not found.")
        conn.commit()
        return {"status": "success", "message": "Attachment deleted.", "deletedCount": cursor.rowcount}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error("M99004 notice file delete failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/notices/delete")
def delete_notice(req: NoticeDeleteRequest):
    notice_id = int(req.noticeId or 0)
    if notice_id <= 0:
        raise HTTPException(status_code=400, detail="Select a saved notice before deleting.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M99004_NOTICE_DELETE"), {"noticeId": notice_id})
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notice was not found.")
        conn.commit()
        return {"status": "success", "message": "Notice deleted.", "deletedCount": cursor.rowcount}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error("M99004 notice delete failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
