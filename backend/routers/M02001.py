"""
@file           M02001.py
@description    File upload management API
"""

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict
from typing import Optional
import csv
import io
import logging
import re
import time

from backend.database_helper import execute_query
from backend.auth_context import get_request_login_id, get_request_user_id
from backend.target_database import get_target_db_connection

logger = logging.getLogger(__name__)
router = APIRouter()
UPLOAD_ROW_NO_COLUMN = "FILE_ROW_NO"
UPLOAD_INSERT_BATCH_SIZE = 1000


class UploadTableRequest(BaseModel):
    tableName: Optional[str] = None
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


class DropTableRequest(BaseModel):
    tableName: Optional[str] = None
    model_config = ConfigDict(extra="allow")


@router.post("/preview")
async def preview_upload(
    file: UploadFile = File(...),
    fileType: str = Form("csv"),
    delimiter: str = Form(","),
    fixedWidths: str = Form(""),
    hasHeader: str = Form("Y"),
    encoding: str = Form("utf-8")
):
    content = await file.read()
    columns, rows = parse_upload_content(content, file.filename or "", fileType, delimiter, fixedWidths, hasHeader, encoding, 50)
    preview_columns, preview_rows = add_row_numbers_to_preview(columns, rows)
    return {
        "status": "success",
        "columns": preview_columns,
        "data": preview_rows,
        "total": len(rows)
    }


@router.post("/upload")
async def upload_file_to_table(
    request: Request,
    file: UploadFile = File(...),
    fileType: str = Form("csv"),
    delimiter: str = Form(","),
    fixedWidths: str = Form(""),
    hasHeader: str = Form("Y"),
    encoding: str = Form("utf-8"),
    projectCode: str = Form(""),
    tableComment: str = Form(""),
    tableNameRule: str = Form("INITUP$_{LOGIN_ID}_{PROJECT_CODE}_{TIME}")
):
    user_id = get_request_user_id(request)
    login_id = get_request_login_id(request) or str(user_id)
    content = await file.read()
    columns, rows = parse_upload_content(content, file.filename or "", fileType, delimiter, fixedWidths, hasHeader, encoding, None)
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
        if (tableComment or "").strip():
            cursor.execute(f'COMMENT ON TABLE "{table_name}" IS \'{escape_sql_literal(tableComment.strip())}\'')

        inserted_count = 0
        if rows:
            bind_names = [f"c{index}" for index in range(len(upload_columns))]
            column_sql = ", ".join(f'"{column}"' for column in upload_columns)
            bind_sql = ", ".join(f":{name}" for name in bind_names)
            insert_sql = f'INSERT INTO "{table_name}" ({column_sql}) VALUES ({bind_sql})'
            batch_rows = []
            for row_number, row in enumerate(rows, start=1):
                batch_rows.append({
                    bind_names[0]: row_number,
                    **{
                        bind_names[index + 1]: stringify_cell(row[index] if index < len(row) else "")
                        for index in range(len(safe_columns))
                    }
                })
                if len(batch_rows) >= UPLOAD_INSERT_BATCH_SIZE:
                    cursor.executemany(insert_sql, batch_rows)
                    conn.commit()
                    inserted_count += len(batch_rows)
                    batch_rows = []
            if batch_rows:
                cursor.executemany(insert_sql, batch_rows)
                conn.commit()
                inserted_count += len(batch_rows)

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
def get_upload_table_tree(request: Request, projectCode: str = "", tablePrefix: str = ""):
    user_id = get_request_user_id(request)
    login_id = get_request_login_id(request) or str(user_id)
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
    limit = normalize_limit(req.limit)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02001_UPLOAD_TABLE_DATA", {
            "dynamicTable": f'"{table_name}"',
            "limit": limit
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Data query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/sql")
def execute_sql(req: SqlRequest, request: Request):
    sql = normalize_select_sql(req.sql)
    limit = normalize_limit(req.limit)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02001_SQL_WORKSHEET", {
            "dynamicSql": sql,
            "limit": limit
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "SQL execution failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


def parse_upload_content(content, filename, file_type, delimiter, fixed_widths, has_header, encoding, preview_limit):
    normalized_type = (file_type or "csv").lower()
    use_header = str(has_header or "Y").upper() == "Y"

    if normalized_type == "excel":
        raw_rows = parse_excel(content, preview_limit)
    elif normalized_type == "fixed":
        raw_rows = parse_fixed(content, fixed_widths, encoding, preview_limit)
    else:
        actual_delimiter = "\t" if normalized_type == "tsv" else (delimiter or ",")
        raw_rows = parse_delimited(content, actual_delimiter, encoding, preview_limit)

    raw_rows = [row for row in raw_rows if any(str(cell or "").strip() for cell in row)]
    if not raw_rows:
        return [], []

    if use_header:
        columns = [str(cell or "").strip() or f"COL{index + 1:03d}" for index, cell in enumerate(raw_rows[0])]
        rows = raw_rows[1:]
    else:
        max_len = max(len(row) for row in raw_rows)
        columns = [f"COL{index + 1:03d}" for index in range(max_len)]
        rows = raw_rows

    width = max(len(columns), max((len(row) for row in rows), default=0))
    columns = columns + [f"COL{index + 1:03d}" for index in range(len(columns), width)]
    normalized_rows = [
        [stringify_cell(row[index] if index < len(row) else "") for index in range(width)]
        for row in rows
    ]
    return columns[:width], normalized_rows


def parse_delimited(content, delimiter, encoding, preview_limit):
    text = content.decode(encoding or "utf-8-sig", errors="replace")
    rows = []
    if len(delimiter) == 1:
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        for row in reader:
            rows.append(row)
            if preview_limit and len(rows) > preview_limit:
                break
    else:
        for line in text.splitlines():
            rows.append(line.split(delimiter))
            if preview_limit and len(rows) > preview_limit:
                break
    return rows


def parse_fixed(content, fixed_widths, encoding, preview_limit):
    widths = [int(value.strip()) for value in (fixed_widths or "").split(",") if value.strip()]
    if not widths:
        raise HTTPException(status_code=400, detail="Fixed widths are required.")
    text = content.decode(encoding or "utf-8-sig", errors="replace")
    rows = []
    for line in text.splitlines():
        start = 0
        row = []
        for width in widths:
            row.append(line[start:start + width].strip())
            start += width
        rows.append(row)
        if preview_limit and len(rows) > preview_limit:
            break
    return rows


def parse_excel(content, preview_limit):
    try:
        from openpyxl import load_workbook
    except Exception:
        raise HTTPException(status_code=500, detail="Excel upload requires openpyxl.")

    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    rows = []
    for row in sheet.iter_rows(values_only=True):
        rows.append([stringify_cell(cell) for cell in row])
        if preview_limit and len(rows) > preview_limit:
            break
    workbook.close()
    return rows


def add_row_numbers_to_preview(columns, rows):
    preview_columns = [UPLOAD_ROW_NO_COLUMN, *columns]
    preview_rows = [
        [row_number, *row]
        for row_number, row in enumerate(rows or [], start=1)
    ]
    return preview_columns, preview_rows


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


def escape_sql_literal(value):
    return str(value or "").replace("'", "''")


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
