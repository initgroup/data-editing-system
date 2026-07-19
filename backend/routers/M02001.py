"""
@file           M02001.py
@description    File upload management API
"""

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict
from typing import BinaryIO, Iterator, Optional
import codecs
import csv
import io
import json
import logging
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

from backend.database import get_db_connection
from backend.database_helper import execute_query
from backend.auth_context import get_request_login_id, get_request_role_code, get_request_user_id
from backend.target_database import get_target_db_connection
from backend.paging import create_page_window, normalize_page_number, normalize_page_size

logger = logging.getLogger(__name__)
router = APIRouter()
UPLOAD_ROW_NO_COLUMN = "FILE_ROW_NO"
UPLOAD_INSERT_BATCH_SIZE = 1000
UPLOAD_INSERT_BATCH_CELL_LIMIT = 25_000
ORACLE_COMMENT_SAFE_BYTE_LIMIT = 3_900
UPLOAD_ENCODING_SAMPLE_SIZE = 128 * 1024
UPLOAD_PREVIEW_ROW_LIMIT = 50
UPLOAD_HTTP_CHUNK_SIZE = 4 * 1024 * 1024
UPLOAD_HTTP_CHUNK_LIMIT = 8 * 1024 * 1024
UPLOAD_STAGING_MAX_AGE_SECONDS = 6 * 60 * 60
UPLOAD_STAGING_DIRECTORY = Path(tempfile.gettempdir()) / "init-data-editing-uploads"
AUTO_ENCODING_NAMES = {"", "auto", "detect", "auto-detect", "automatic"}


class UploadTableRequest(BaseModel):
    tableName: Optional[str] = None
    limit: Optional[int] = 100
    page: Optional[int] = 1
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    page: Optional[int] = 1
    model_config = ConfigDict(extra="allow")


class DropTableRequest(BaseModel):
    tableName: Optional[str] = None
    model_config = ConfigDict(extra="allow")


class UploadSessionRequest(BaseModel):
    fileName: Optional[str] = None
    fileSize: int
    model_config = ConfigDict(extra="forbid")


@router.post("/upload-session")
def create_upload_session(req: UploadSessionRequest, request: Request):
    user_id = str(get_request_user_id(request))
    expected_size = max(0, int(req.fileSize or 0))
    cleanup_stale_uploads()
    UPLOAD_STAGING_DIRECTORY.mkdir(parents=True, exist_ok=True)
    upload_id = uuid.uuid4().hex
    data_path, _ = get_staging_paths(upload_id)
    data_path.touch(exist_ok=False)
    write_staged_upload_metadata(upload_id, {
        "uploadId": upload_id,
        "userId": user_id,
        "fileName": re.split(r"[\\/]", req.fileName or "uploaded-file")[-1][:255],
        "expectedSize": expected_size,
        "receivedSize": 0,
        "createdAt": time.time(),
    })
    return {
        "status": "success",
        "uploadId": upload_id,
        "chunkSize": UPLOAD_HTTP_CHUNK_SIZE,
        "receivedSize": 0,
    }


@router.post("/upload-chunk")
async def upload_file_chunk(
    request: Request,
    chunk: UploadFile = File(...),
    uploadId: str = Form(...),
    offset: int = Form(...),
):
    metadata, data_path = require_staged_upload(request, uploadId)
    expected_size = int(metadata.get("expectedSize") or 0)
    requested_offset = max(0, int(offset or 0))
    current_size = data_path.stat().st_size
    if requested_offset != current_size:
        raise HTTPException(
            status_code=409,
            detail=f"Upload offset mismatch. Expected {current_size}, received {requested_offset}.",
        )

    received = 0
    with data_path.open("r+b") as output:
        output.seek(requested_offset)
        try:
            while True:
                block = await chunk.read(256 * 1024)
                if not block:
                    break
                received += len(block)
                if received > UPLOAD_HTTP_CHUNK_LIMIT:
                    raise HTTPException(status_code=413, detail="Upload chunk is too large.")
                if requested_offset + received > expected_size:
                    raise HTTPException(status_code=400, detail="Upload exceeds the declared file size.")
                output.write(block)
        except Exception:
            output.truncate(requested_offset)
            raise

    metadata["receivedSize"] = requested_offset + received
    metadata["updatedAt"] = time.time()
    write_staged_upload_metadata(uploadId, metadata)
    return {
        "status": "success",
        "uploadId": uploadId,
        "receivedSize": metadata["receivedSize"],
        "expectedSize": expected_size,
    }


@router.post("/preview-staged")
def preview_staged_upload(
    request: Request,
    uploadId: str = Form(...),
    fileType: str = Form("csv"),
    delimiter: str = Form(","),
    fixedWidths: str = Form(""),
    hasHeader: str = Form("Y"),
    encoding: str = Form("auto"),
):
    metadata, data_path = require_completed_staged_upload(request, uploadId)
    with data_path.open("rb") as staged_file:
        staged_upload = UploadFile(file=staged_file, filename=metadata.get("fileName") or "uploaded-file")
        return preview_upload(staged_upload, fileType, delimiter, fixedWidths, hasHeader, encoding)


@router.post("/upload-staged")
def upload_staged_file_to_table(
    request: Request,
    uploadId: str = Form(...),
    fileType: str = Form("csv"),
    delimiter: str = Form(","),
    fixedWidths: str = Form(""),
    hasHeader: str = Form("Y"),
    encoding: str = Form("auto"),
    projectId: str = Form(""),
    projectCode: str = Form(""),
    tableComment: str = Form(""),
    tableNameRule: str = Form("INITUP$_{LOGIN_ID}_{PROJECT_CODE}_{TIME}"),
):
    metadata, data_path = require_completed_staged_upload(request, uploadId)
    with data_path.open("rb") as staged_file:
        staged_upload = UploadFile(file=staged_file, filename=metadata.get("fileName") or "uploaded-file")
        result = upload_file_to_table(
            request,
            staged_upload,
            fileType,
            delimiter,
            fixedWidths,
            hasHeader,
            encoding,
            projectId,
            projectCode,
            tableComment,
            tableNameRule,
        )
    discard_staged_upload(uploadId)
    return result


@router.post("/preview")
def preview_upload(
    file: UploadFile = File(...),
    fileType: str = Form("csv"),
    delimiter: str = Form(","),
    fixedWidths: str = Form(""),
    hasHeader: str = Form("Y"),
    encoding: str = Form("auto")
):
    columns, rows, resolved_encoding = read_upload_preview(
        file.file,
        file.filename or "",
        fileType,
        delimiter,
        fixedWidths,
        hasHeader,
        encoding,
        UPLOAD_PREVIEW_ROW_LIMIT,
    )
    preview_columns, preview_rows = add_row_numbers_to_preview(columns, rows)
    return {
        "status": "success",
        "columns": preview_columns,
        "data": preview_rows,
        "total": len(rows),
        "detectedEncoding": resolved_encoding,
    }


@router.post("/upload")
def upload_file_to_table(
    request: Request,
    file: UploadFile = File(...),
    fileType: str = Form("csv"),
    delimiter: str = Form(","),
    fixedWidths: str = Form(""),
    hasHeader: str = Form("Y"),
    encoding: str = Form("auto"),
    projectId: str = Form(""),
    projectCode: str = Form(""),
    tableComment: str = Form(""),
    tableNameRule: str = Form("INITUP$_{LOGIN_ID}_{PROJECT_CODE}_{TIME}")
):
    user_id = get_request_user_id(request)
    login_id = resolve_project_owner_login_id(request, projectId, projectCode)
    stream = file.file
    filename = file.filename or ""
    resolved_encoding = resolve_upload_encoding(stream, fileType, encoding)
    columns, row_width = inspect_upload_stream(
        stream,
        filename,
        fileType,
        delimiter,
        fixedWidths,
        hasHeader,
        resolved_encoding,
    )
    if not columns:
        raise HTTPException(status_code=400, detail="No columns were detected.")

    table_name = create_upload_table_name(projectCode, tableNameRule, login_id, user_id)
    safe_columns = normalize_column_names(columns, reserved={UPLOAD_ROW_NO_COLUMN})
    upload_columns = [UPLOAD_ROW_NO_COLUMN, *safe_columns]

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        column_ddl = ", ".join([
            f'"{UPLOAD_ROW_NO_COLUMN}" NUMBER',
            *[f'"{column}" VARCHAR2(4000)' for column in safe_columns]
        ])
        cursor.execute(f'CREATE TABLE "{table_name}" ({column_ddl})')
        cursor.execute(f'COMMENT ON COLUMN "{table_name}"."{UPLOAD_ROW_NO_COLUMN}" IS \'File row number\'')
        for safe_column, original_column in zip(safe_columns, columns):
            comment = str(original_column or "").strip()
            if comment and comment.upper() != safe_column:
                safe_comment = escape_and_truncate_oracle_comment(comment)
                cursor.execute(
                    f'COMMENT ON COLUMN "{table_name}"."{safe_column}" IS \'{safe_comment}\''
                )
        if (tableComment or "").strip():
            safe_table_comment = escape_and_truncate_oracle_comment(tableComment.strip())
            cursor.execute(f'COMMENT ON TABLE "{table_name}" IS \'{safe_table_comment}\'')

        inserted_count = 0
        column_sql = ", ".join(f'"{column}"' for column in upload_columns)
        bind_sql = ", ".join(f":{index + 1}" for index in range(len(upload_columns)))
        insert_sql = f'INSERT INTO "{table_name}" ({column_sql}) VALUES ({bind_sql})'
        insert_batch_size = max(
            1,
            min(UPLOAD_INSERT_BATCH_SIZE, UPLOAD_INSERT_BATCH_CELL_LIMIT // max(len(upload_columns), 1)),
        )
        batch_rows = []
        rows = iter_upload_data_rows(
            stream,
            filename,
            fileType,
            delimiter,
            fixedWidths,
            hasHeader,
            resolved_encoding,
            row_width,
        )
        try:
            for row_number, row in enumerate(rows, start=1):
                batch_rows.append((row_number, *row))
                if len(batch_rows) >= insert_batch_size:
                    cursor.executemany(insert_sql, batch_rows)
                    conn.commit()
                    inserted_count += len(batch_rows)
                    batch_rows.clear()
            if batch_rows:
                cursor.executemany(insert_sql, batch_rows)
                conn.commit()
                inserted_count += len(batch_rows)
        finally:
            close_row_iterator(rows)

        conn.commit()
        stats_gathered = False
        stats_message = ""
        try:
            gather_upload_table_stats(cursor, table_name)
            conn.commit()
            stats_gathered = True
            stats_message = "Table statistics gathered."
        except Exception as stats_error:
            stats_message = f"Table uploaded, but statistics gather failed: {stats_error}"
            logger.warning("M02001 statistics gather failed for %s: %s", table_name, stats_error)
        return {
            "status": "success",
            "message": "File uploaded.",
            "tableName": table_name,
            "columns": upload_columns,
            "rowCount": inserted_count,
            "detectedEncoding": resolved_encoding,
            "statsGathered": stats_gathered,
            "statsMessage": stats_message
        }
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M02001 upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/drop-table")
def drop_upload_table(req: DropTableRequest, request: Request):
    table_name = require_upload_table(req.tableName)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        cursor.execute(f'DROP TABLE "{table_name}" PURGE')
        conn.commit()
        return {
            "status": "success",
            "message": "Upload table dropped.",
            "tableName": table_name
        }
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M02001 drop table failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/upload-table-tree")
def get_upload_table_tree(
    request: Request,
    projectId: str = "",
    projectCode: str = "",
    tablePrefix: str = "",
):
    login_id = resolve_project_owner_login_id(request, projectId, projectCode)
    base_prefix = create_upload_table_prefix(projectCode, login_id)
    table_prefix = normalize_upload_table_search_prefix(tablePrefix, base_prefix)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02001_UPLOAD_TABLE_TREE", {"tablePrefix": table_prefix})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Upload table tree query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0),
            "tablePrefix": table_prefix
        }
    finally:
        if conn:
            conn.close()


@router.post("/columns")
def get_upload_columns(req: UploadTableRequest, request: Request):
    table_name = require_read_table(req.tableName)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02001_UPLOAD_TABLE_COLUMNS", {"tableName": table_name})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Column query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/data")
def get_upload_data(req: UploadTableRequest, request: Request):
    table_name = require_read_table(req.tableName)
    limit = normalize_page_size(req.limit)
    page = normalize_page_number(req.page)
    conn = None
    try:
        conn = get_target_db_connection(request)
        table_object = f'"{table_name}"'
        count_result = execute_query(conn, "M02001_UPLOAD_TABLE_DATA_COUNT", {"dynamicTable": table_object})
        total_rows = count_result.get("data", [])
        total = int(total_rows[0].get("TOTAL_COUNT") or 0) if total_rows else 0
        page_window = create_page_window(page, limit, total)
        result = execute_query(conn, "M02001_UPLOAD_TABLE_DATA_PAGE", {"dynamicTable": table_object, "offset": page_window.offset, "limit": page_window.page_size})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Data query failed.")
        response = {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": total
        }
        response.update(page_window.response_metadata())
        return response
    finally:
        if conn:
            conn.close()


@router.post("/sql")
def execute_sql(req: SqlRequest, request: Request):
    sql = normalize_select_sql(req.sql)
    limit = normalize_page_size(req.limit)
    page = normalize_page_number(req.page)
    conn = None
    try:
        conn = get_target_db_connection(request)
        count_result = execute_query(conn, "M02001_SQL_WORKSHEET_COUNT", {"dynamicSql": sql})
        total_rows = count_result.get("data", [])
        total = int(total_rows[0].get("TOTAL_COUNT") or 0) if total_rows else 0
        page_window = create_page_window(page, limit, total)
        result = execute_query(conn, "M02001_SQL_WORKSHEET_PAGE", {"dynamicSql": sql, "offset": page_window.offset, "limit": page_window.page_size})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "SQL execution failed.")
        response = {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": total
        }
        response.update(page_window.response_metadata())
        return response
    finally:
        if conn:
            conn.close()


def get_staging_paths(upload_id: str):
    normalized_id = str(upload_id or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{32}", normalized_id):
        raise HTTPException(status_code=400, detail="Invalid upload session ID.")
    return (
        UPLOAD_STAGING_DIRECTORY / f"{normalized_id}.upload",
        UPLOAD_STAGING_DIRECTORY / f"{normalized_id}.json",
    )


def write_staged_upload_metadata(upload_id: str, metadata: dict):
    UPLOAD_STAGING_DIRECTORY.mkdir(parents=True, exist_ok=True)
    _, metadata_path = get_staging_paths(upload_id)
    temporary_path = metadata_path.with_suffix(".json.tmp")
    with temporary_path.open("w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, ensure_ascii=False)
    os.replace(temporary_path, metadata_path)


def require_staged_upload(request: Request, upload_id: str):
    data_path, metadata_path = get_staging_paths(upload_id)
    try:
        with metadata_path.open("r", encoding="utf-8") as metadata_file:
            metadata = json.load(metadata_file)
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=404, detail="Upload session was not found or has expired.") from error
    if float(metadata.get("createdAt") or 0) < time.time() - UPLOAD_STAGING_MAX_AGE_SECONDS:
        discard_staged_upload(upload_id)
        raise HTTPException(status_code=404, detail="Upload session was not found or has expired.")
    if str(metadata.get("userId") or "") != str(get_request_user_id(request)):
        raise HTTPException(status_code=404, detail="Upload session was not found or has expired.")
    if not data_path.is_file():
        raise HTTPException(status_code=404, detail="Upload session data was not found.")
    return metadata, data_path


def require_completed_staged_upload(request: Request, upload_id: str):
    metadata, data_path = require_staged_upload(request, upload_id)
    expected_size = int(metadata.get("expectedSize") or 0)
    received_size = data_path.stat().st_size
    if received_size != expected_size:
        raise HTTPException(
            status_code=409,
            detail=f"Upload is incomplete. Expected {expected_size} bytes, received {received_size} bytes.",
        )
    return metadata, data_path


def discard_staged_upload(upload_id: str):
    data_path, metadata_path = get_staging_paths(upload_id)
    for path in (data_path, metadata_path, metadata_path.with_suffix(".json.tmp")):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("M02001 staged upload cleanup failed for %s", path.name)


def cleanup_stale_uploads():
    if not UPLOAD_STAGING_DIRECTORY.is_dir():
        return
    expiration_time = time.time() - UPLOAD_STAGING_MAX_AGE_SECONDS
    for path in UPLOAD_STAGING_DIRECTORY.iterdir():
        try:
            if path.is_file() and path.stat().st_mtime < expiration_time:
                path.unlink(missing_ok=True)
        except OSError:
            logger.warning("M02001 stale upload cleanup failed for %s", path.name)


def resolve_upload_encoding(stream: BinaryIO, file_type: str, requested_encoding: str) -> Optional[str]:
    if (file_type or "").strip().lower() == "excel":
        return None

    requested = (requested_encoding or "").strip()
    if requested.lower() not in AUTO_ENCODING_NAMES:
        try:
            return codecs.lookup(requested).name
        except LookupError as error:
            raise HTTPException(status_code=400, detail=f"Unsupported encoding: {requested}") from error

    stream.seek(0)
    sample = stream.read(UPLOAD_ENCODING_SAMPLE_SIZE)
    stream.seek(0)
    if not sample:
        return "utf-8-sig"

    bom_encodings = (
        (codecs.BOM_UTF32_LE, "utf-32"),
        (codecs.BOM_UTF32_BE, "utf-32"),
        (codecs.BOM_UTF8, "utf-8-sig"),
        (codecs.BOM_UTF16_LE, "utf-16"),
        (codecs.BOM_UTF16_BE, "utf-16"),
    )
    for bom, encoding_name in bom_encodings:
        if sample.startswith(bom):
            return encoding_name

    utf16_encoding = detect_utf16_without_bom(sample)
    if utf16_encoding:
        return utf16_encoding

    for encoding_name in ("utf-8", "cp949", "shift_jis", "big5", "windows-1252"):
        if can_decode_sample(sample, encoding_name):
            return encoding_name
    return "latin-1"


def detect_utf16_without_bom(sample: bytes) -> Optional[str]:
    if len(sample) < 4:
        return None
    even_bytes = sample[0::2]
    odd_bytes = sample[1::2]
    even_null_ratio = even_bytes.count(0) / max(len(even_bytes), 1)
    odd_null_ratio = odd_bytes.count(0) / max(len(odd_bytes), 1)
    if odd_null_ratio >= 0.3 and even_null_ratio <= 0.05:
        return "utf-16-le"
    if even_null_ratio >= 0.3 and odd_null_ratio <= 0.05:
        return "utf-16-be"
    return None


def can_decode_sample(sample: bytes, encoding: str) -> bool:
    try:
        decoder = codecs.getincrementaldecoder(encoding)(errors="strict")
        decoder.decode(sample, final=False)
        return True
    except UnicodeDecodeError:
        return False


def read_upload_preview(
    stream: BinaryIO,
    filename: str,
    file_type: str,
    delimiter: str,
    fixed_widths: str,
    has_header: str,
    encoding: str,
    preview_limit: int,
):
    resolved_encoding = resolve_upload_encoding(stream, file_type, encoding)
    use_header = str(has_header or "Y").upper() == "Y"
    columns = []
    rows = []
    width = 0
    raw_rows = iter_upload_raw_rows(
        stream,
        filename,
        file_type,
        delimiter,
        fixed_widths,
        resolved_encoding,
    )
    try:
        for raw_row in raw_rows:
            if not is_non_empty_row(raw_row):
                continue
            width = max(width, len(raw_row))
            if use_header and not columns:
                columns = build_header_columns(raw_row)
                continue
            rows.append(raw_row)
            if len(rows) >= preview_limit:
                break
    finally:
        close_row_iterator(raw_rows)

    if not columns and not rows:
        return [], [], resolved_encoding
    if not use_header:
        columns = build_default_columns(width)
    width = max(width, len(columns))
    columns = extend_columns(columns, width)
    normalized_rows = [normalize_upload_row(row, width) for row in rows]
    return columns, normalized_rows, resolved_encoding


def inspect_upload_stream(
    stream: BinaryIO,
    filename: str,
    file_type: str,
    delimiter: str,
    fixed_widths: str,
    has_header: str,
    resolved_encoding: Optional[str],
):
    use_header = str(has_header or "Y").upper() == "Y"
    columns = []
    width = 0
    has_data = False
    raw_rows = iter_upload_raw_rows(
        stream,
        filename,
        file_type,
        delimiter,
        fixed_widths,
        resolved_encoding,
    )
    try:
        for raw_row in raw_rows:
            if not is_non_empty_row(raw_row):
                continue
            width = max(width, len(raw_row))
            if use_header and not columns:
                columns = build_header_columns(raw_row)
                continue
            has_data = True
    finally:
        close_row_iterator(raw_rows)

    if not columns and not has_data:
        return [], 0
    if not use_header:
        columns = build_default_columns(width)
    width = max(width, len(columns))
    return extend_columns(columns, width), width


def iter_upload_data_rows(
    stream: BinaryIO,
    filename: str,
    file_type: str,
    delimiter: str,
    fixed_widths: str,
    has_header: str,
    resolved_encoding: Optional[str],
    width: int,
) -> Iterator[list[str]]:
    use_header = str(has_header or "Y").upper() == "Y"
    header_skipped = False
    raw_rows = iter_upload_raw_rows(
        stream,
        filename,
        file_type,
        delimiter,
        fixed_widths,
        resolved_encoding,
    )
    try:
        for raw_row in raw_rows:
            if not is_non_empty_row(raw_row):
                continue
            if use_header and not header_skipped:
                header_skipped = True
                continue
            yield normalize_upload_row(raw_row, width)
    finally:
        close_row_iterator(raw_rows)


def iter_upload_raw_rows(
    stream: BinaryIO,
    filename: str,
    file_type: str,
    delimiter: str,
    fixed_widths: str,
    resolved_encoding: Optional[str],
) -> Iterator[list]:
    normalized_type = (file_type or "csv").strip().lower()
    if normalized_type == "excel":
        yield from iter_excel_rows(stream, filename)
        return
    if normalized_type == "fixed":
        yield from iter_fixed_rows(stream, fixed_widths, resolved_encoding or "utf-8-sig")
        return
    actual_delimiter = "\t" if normalized_type == "tsv" else (delimiter or ",")
    yield from iter_delimited_rows(stream, actual_delimiter, resolved_encoding or "utf-8-sig")


def iter_delimited_rows(stream: BinaryIO, delimiter: str, encoding: str) -> Iterator[list[str]]:
    stream.seek(0)
    text_stream = io.TextIOWrapper(stream, encoding=encoding, errors="replace", newline="")
    try:
        if len(delimiter) == 1:
            yield from csv.reader(text_stream, delimiter=delimiter)
            return
        for line in text_stream:
            yield line.rstrip("\r\n").split(delimiter)
    finally:
        detach_text_stream(text_stream)


def iter_fixed_rows(stream: BinaryIO, fixed_widths: str, encoding: str) -> Iterator[list[str]]:
    try:
        widths = [int(value.strip()) for value in (fixed_widths or "").split(",") if value.strip()]
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Fixed widths must be comma-separated integers.") from error
    if not widths or any(width <= 0 for width in widths):
        raise HTTPException(status_code=400, detail="Fixed widths are required and must be positive integers.")

    stream.seek(0)
    text_stream = io.TextIOWrapper(stream, encoding=encoding, errors="replace", newline="")
    try:
        for line in text_stream:
            line = line.rstrip("\r\n")
            start = 0
            row = []
            for width in widths:
                row.append(line[start:start + width].strip())
                start += width
            yield row
    finally:
        detach_text_stream(text_stream)


def iter_excel_rows(stream: BinaryIO, filename: str) -> Iterator[list[str]]:
    try:
        from openpyxl import load_workbook
    except Exception as error:
        raise HTTPException(status_code=500, detail="Excel upload requires openpyxl.") from error

    stream.seek(0)
    try:
        workbook = load_workbook(stream, read_only=True, data_only=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Excel file could not be read: {filename or 'uploaded file'}") from error
    try:
        for row in workbook.active.iter_rows(values_only=True):
            yield [stringify_cell(cell) for cell in row]
    finally:
        workbook.close()
        stream.seek(0)


def detach_text_stream(text_stream: io.TextIOWrapper):
    try:
        text_stream.detach()
    except (ValueError, OSError):
        pass


def close_row_iterator(rows):
    close = getattr(rows, "close", None)
    if callable(close):
        close()


def is_non_empty_row(row) -> bool:
    return any(stringify_cell(cell).strip() for cell in row)


def build_header_columns(row):
    return [stringify_cell(cell).strip() or f"COL{index + 1:03d}" for index, cell in enumerate(row)]


def build_default_columns(width):
    return [f"COL{index + 1:03d}" for index in range(width)]


def extend_columns(columns, width):
    return [*columns, *build_default_columns(width)[len(columns):width]]


def normalize_upload_row(row, width):
    return [stringify_cell(row[index] if index < len(row) else "") for index in range(width)]


def add_row_numbers_to_preview(columns, rows):
    preview_columns = [UPLOAD_ROW_NO_COLUMN, *columns]
    preview_rows = [
        [row_number, *row]
        for row_number, row in enumerate(rows or [], start=1)
    ]
    return preview_columns, preview_rows


def resolve_project_owner_login_id(request, project_id="", project_code=""):
    """Resolve the selected project's owner without trusting browser identity fields."""
    request_user_id = get_request_user_id(request)
    current_login_id = get_request_login_id(request) or str(request_user_id)
    normalized_project_id = str(project_id or "").strip()
    normalized_project_code = str(project_code or "").strip()
    if not normalized_project_id:
        return current_login_id

    target_conn = None
    system_conn = None
    try:
        target_conn = get_target_db_connection(request)
        project_result = execute_query(target_conn, "M02001_PROJECT_OWNER_CONTEXT", {
            "projectId": normalized_project_id,
            "projectCode": normalized_project_code,
        })
        project_rows = project_result.get("data", []) if project_result.get("status") == "success" else []
        if not project_rows:
            raise HTTPException(status_code=404, detail="Project not found.")

        project_owner_user_id = int(project_rows[0].get("USER_ID") or 0)
        if project_owner_user_id <= 0:
            raise HTTPException(status_code=409, detail="Project owner is not configured.")
        if project_owner_user_id != int(request_user_id) and get_request_role_code(request) != "ADMIN":
            raise HTTPException(status_code=403, detail="Project access denied.")

        # Do not hold a Target DB connection while waiting for a system DB
        # connection. Cross-pool nesting can deadlock otherwise independent
        # menu requests when either pool is busy.
        target_conn.close()
        target_conn = None

        system_conn = get_db_connection()
        user_result = execute_query(system_conn, "M02001_PROJECT_OWNER_LOGIN", {
            "userId": project_owner_user_id,
        })
        user_rows = user_result.get("data", []) if user_result.get("status") == "success" else []
        owner_login_id = str(user_rows[0].get("LOGIN_ID") or "").strip() if user_rows else ""
        if not owner_login_id:
            raise HTTPException(status_code=409, detail="Project owner login ID was not found.")
        return owner_login_id
    finally:
        if target_conn:
            target_conn.close()
        if system_conn:
            system_conn.close()


def create_upload_table_name(project_code="", table_name_rule="", login_id="", user_id=""):
    timestamp = str(int(time.time() * 1000))
    project_token = normalize_identifier_token(project_code or "PROJECT")[:40] or "PROJECT"
    login_token = normalize_identifier_token(login_id or user_id or "LOGIN")[:30] or "LOGIN"
    user_token = normalize_identifier_token(user_id or "USER")[:30] or "USER"
    rule = (table_name_rule or "INITUP$_{LOGIN_ID}_{PROJECT_CODE}_{TIME}").strip()
    if "{TIME}" not in rule.upper():
        rule = f"{rule}_{{TIME}}"
    name = rule.replace("{LOGIN_ID}", login_token)
    name = name.replace("{login_id}", login_token)
    name = name.replace("{USER_ID}", user_token)
    name = name.replace("{user_id}", user_token)
    name = name.replace("{LOGIN_USER}", login_token)
    name = name.replace("{login_user}", login_token)
    name = name.replace("{PROJECT_CODE}", project_token)
    name = name.replace("{project_code}", project_token)
    name = name.replace("{TIME}", timestamp)
    name = name.replace("{time}", timestamp)
    name = normalize_identifier_token(name)
    if not name.startswith("INITUP$_"):
        name = f"INITUP$_{name}"
    if not re.search(r"[0-9]{13}$", name):
        name = f"{name}_{timestamp}"
    if len(name) > 120:
        name = f"{name[:106].rstrip('_')}_{timestamp}"
    return name


def create_upload_table_prefix(project_code="", login_id=""):
    login_token = normalize_identifier_token(login_id or "LOGIN")[:30] or "LOGIN"
    project_token = normalize_identifier_token(project_code or "PROJECT")[:40] or "PROJECT"
    return f"INITUP$_{login_token}_{project_token}_"


def normalize_upload_table_search_prefix(table_prefix="", base_prefix=""):
    requested = normalize_upload_prefix_token(table_prefix or "")
    base = normalize_identifier_token(base_prefix or "INITUP$_LOGIN_PROJECT_")
    if not requested:
        return base
    if not requested.startswith(base):
        return base
    return requested


def normalize_upload_prefix_token(value):
    name = re.sub(r"[^A-Za-z0-9_$#]", "_", str(value or "").upper())
    return re.sub(r"_+", "_", name).lstrip("_")


def normalize_identifier_token(value):
    name = re.sub(r"[^A-Za-z0-9_$#]", "_", str(value or "").upper())
    name = re.sub(r"_+", "_", name).strip("_")
    return name


def normalize_column_names(columns, reserved=None):
    used = set(reserved or [])
    result = []
    for index, column in enumerate(columns):
        name = re.sub(r"[^A-Za-z0-9_$#]", "_", str(column or "").upper()).strip("_")
        if not name or not re.match(r"^[A-Z]", name):
            name = f"COL{index + 1:03d}"
        name = name[:26]
        base = name
        suffix = 1
        while name in used:
            suffix += 1
            name = f"{base[:24]}_{suffix}"
        used.add(name)
        result.append(name)
    return result


def stringify_cell(value):
    if value is None:
        return ""
    return str(value)


def gather_upload_table_stats(cursor, table_name):
    cursor.execute(
        """
        BEGIN
            DBMS_STATS.GATHER_TABLE_STATS(
                ownname => USER,
                tabname => :tableName,
                estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE,
                method_opt => 'FOR ALL COLUMNS SIZE AUTO',
                cascade => TRUE,
                no_invalidate => FALSE
            );
        END;
        """,
        {"tableName": table_name},
    )


def require_upload_table(table_name):
    name = (table_name or "").strip().upper()
    if not name.startswith("INITUP$_"):
        raise HTTPException(status_code=400, detail="Only INITUP$_ tables can be used here.")
    if not re.fullmatch(r"INITUP\$_[A-Z0-9_$#_]*[0-9]{13}", name):
        raise HTTPException(status_code=400, detail="Invalid upload table ID.")
    return name


def require_read_table(table_name):
    name = (table_name or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", name):
        raise HTTPException(status_code=400, detail="Invalid table ID.")
    return name


def escape_and_truncate_oracle_comment(value, max_bytes=ORACLE_COMMENT_SAFE_BYTE_LIMIT):
    result = []
    used_bytes = 0
    for character in str(value or ""):
        escaped_character = "''" if character == "'" else character
        character_bytes = len(escaped_character.encode("utf-8"))
        if used_bytes + character_bytes > max_bytes:
            break
        result.append(escaped_character)
        used_bytes += character_bytes
    return "".join(result)


def normalize_limit(value):
    try:
        limit = int(value or 100)
    except (TypeError, ValueError):
        limit = 100
    return max(1, min(limit, 1000))


def normalize_select_sql(sql):
    text = (sql or "").strip()
    text = re.sub(r";+\s*$", "", text)
    if not re.match(r"(?is)^(select|with)\b", text):
        raise HTTPException(status_code=400, detail="Only SELECT statements are allowed.")
    if re.search(r";\s*\S", sql or ""):
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec)\b"
    if re.search(blocked, text, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only read-only SELECT statements are allowed.")
    return text
