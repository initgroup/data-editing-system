"""
@file           M99098.py
@description    Administrator system management API
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import Optional
from pathlib import Path
import logging
import secrets
import string

from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.auth_context import require_admin_role
from backend.routers.M91001 import _hash_password


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])

INIT_SYSTEM_TABLES = [
    "INIT$_TB_USER",
    "INIT$_TB_DB_CONNECTION",
    "INIT$_TB_SYSTEM_SETTING",
    "INIT$_TB_SETUP_LOG",
]


class SystemTableRequest(BaseModel):
    tableName: str
    limit: Optional[int] = 100
    userStatus: Optional[str] = "ALL"
    model_config = ConfigDict(extra="allow")


class UserApproveRequest(BaseModel):
    userIds: Optional[list[int]] = None
    userStatus: Optional[str] = "PENDING"
    approveAll: Optional[bool] = False
    model_config = ConfigDict(extra="allow")


class UserPasswordResetRequest(BaseModel):
    userIds: Optional[list[int]] = None
    model_config = ConfigDict(extra="allow")


class UserDeactivateRequest(BaseModel):
    userIds: Optional[list[int]] = None
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    model_config = ConfigDict(extra="allow")


def _check_init_tables(conn):
    cursor = conn.cursor()
    try:
        placeholders = ",".join(f":t{i}" for i, _ in enumerate(INIT_SYSTEM_TABLES))
        params = {f"t{i}": table for i, table in enumerate(INIT_SYSTEM_TABLES)}
        cursor.execute(
            f"""
            SELECT TABLE_NAME
              FROM USER_TABLES
             WHERE TABLE_NAME IN ({placeholders})
            """,
            params,
        )
        existing = {row[0] for row in cursor.fetchall()}
        return [
            {
                "TABLE_NAME": table,
                "EXISTS_YN": "Y" if table in existing else "N",
            }
            for table in INIT_SYSTEM_TABLES
        ]
    finally:
        cursor.close()


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


def _read_database_script(filename: str) -> str:
    path = Path(__file__).resolve().parents[2] / "database" / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} was not found.")
    return path.read_text(encoding="utf-8")


@router.get("/status")
def get_system_status():
    conn = None
    try:
        conn = get_db_connection()
        rows = _check_init_tables(conn)
        return {
            "status": "success",
            "data": rows,
            "installedCount": sum(1 for row in rows if row["EXISTS_YN"] == "Y"),
            "total": len(rows),
        }
    except Exception as e:
        logger.error(f"M99098 status failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@router.post("/init-system/run")
def run_init_system():
    conn = None
    cursor = None
    try:
        sql = SqlLoader.get_sql("INIT_SYSTEM_DDL")
        if not sql:
            raise HTTPException(status_code=404, detail="SQL ID INIT_SYSTEM_DDL was not found.")
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.callproc("DBMS_OUTPUT.ENABLE")
        cursor.execute(sql)
        logs = _collect_dbms_output(cursor)
        conn.commit()
        rows = _check_init_tables(conn)
        return {
            "status": "success",
            "message": "INIT system tables are ready.",
            "logs": logs,
            "data": rows,
            "installedCount": sum(1 for row in rows if row["EXISTS_YN"] == "Y"),
            "total": len(rows),
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M99098 init system run failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/init-system/truncate")
def truncate_init_system():
    conn = None
    cursor = None
    try:
        sql = _strip_sqlcl_commands(_read_database_script("INIT_SYSTEM_TRUNC.sql"))
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.callproc("DBMS_OUTPUT.ENABLE")
        cursor.execute(sql)
        logs = _collect_dbms_output(cursor)
        conn.commit()
        rows = _check_init_tables(conn)
        return {
            "status": "success",
            "message": "INIT system table data cleared.",
            "logs": logs,
            "data": rows,
            "installedCount": sum(1 for row in rows if row["EXISTS_YN"] == "Y"),
            "total": len(rows),
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M99098 init system truncate failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/init-system-ddl")
def get_init_system_ddl():
    path = Path(__file__).resolve().parents[2] / "database" / "INIT_SYSTEM_DDL.sql"
    if not path.exists():
        raise HTTPException(status_code=404, detail="INIT_SYSTEM_DDL.sql was not found.")
    return {
        "status": "success",
        "fileName": "INIT_SYSTEM_DDL.sql",
        "sql": path.read_text(encoding="utf-8"),
    }


@router.post("/system-table/columns")
def get_system_table_columns(req: SystemTableRequest):
    table_name = normalize_system_table(req.tableName)
    conn = None
    try:
        conn = get_db_connection()
        rows, columns = fetch_result(conn, """
            SELECT
                C.COLUMN_ID,
                C.COLUMN_NAME,
                C.DATA_TYPE,
                C.DATA_LENGTH,
                C.DATA_PRECISION,
                C.DATA_SCALE,
                C.NULLABLE,
                CC.COMMENTS
              FROM USER_TAB_COLUMNS C
              LEFT JOIN USER_COL_COMMENTS CC
                ON CC.TABLE_NAME = C.TABLE_NAME
               AND CC.COLUMN_NAME = C.COLUMN_NAME
             WHERE C.TABLE_NAME = :tableName
             ORDER BY C.COLUMN_ID
        """, {"tableName": table_name})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


@router.post("/system-table/data")
def get_system_table_data(req: SystemTableRequest):
    table_name = normalize_system_table(req.tableName)
    limit = normalize_limit(req.limit)
    conn = None
    try:
        conn = get_db_connection()
        if table_name == "INIT$_TB_USER":
            user_status = normalize_user_status(req.userStatus)
            status_clause = ""
            params = {"limit": limit}
            if user_status == "PENDING":
                status_clause = " WHERE USE_YN = :useYn"
                params["useYn"] = "N"
            elif user_status == "APPROVED":
                status_clause = " WHERE USE_YN = :useYn"
                params["useYn"] = "Y"
            rows, columns = fetch_result(
                conn,
                f"""
                SELECT *
                  FROM (
                    SELECT *
                      FROM "{table_name}"
                      {status_clause}
                     ORDER BY USER_ID
                  )
                 WHERE ROWNUM <= :limit
                """,
                params,
            )
        else:
            rows, columns = fetch_result(conn, f'SELECT * FROM "{table_name}" WHERE ROWNUM <= :limit', {"limit": limit})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


@router.post("/system-table/user/approve")
def approve_users(req: UserApproveRequest):
    normalize_user_status(req.userStatus)
    user_ids = [int(user_id) for user_id in (req.userIds or []) if int(user_id) > 0]
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if not user_ids:
            detail = "No pending users in current result." if req.approveAll else "Select at least one user to approve."
            raise HTTPException(status_code=400, detail=detail)
        bind_names = ", ".join(f":u{i}" for i, _ in enumerate(user_ids))
        cursor.execute(
            f"""
            UPDATE "INIT$_TB_USER"
               SET USE_YN = 'Y',
                   UPDATED_AT = SYSTIMESTAMP
             WHERE USE_YN = 'N'
               AND USER_ID IN ({bind_names})
            """,
            {f"u{i}": user_id for i, user_id in enumerate(user_ids)},
        )
        affected = cursor.rowcount
        conn.commit()
        return {"status": "success", "message": f"{affected} user(s) approved.", "approvedCount": affected}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M99098 user approval failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/system-table/user/reset-password")
def reset_user_passwords(req: UserPasswordResetRequest):
    user_ids = [int(user_id) for user_id in (req.userIds or []) if int(user_id) > 0]
    if not user_ids:
        raise HTTPException(status_code=400, detail="Select at least one user to reset password.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        bind_names = ", ".join(f":u{i}" for i, _ in enumerate(user_ids))
        cursor.execute(
            f"""
            SELECT USER_ID, LOGIN_ID, USER_NAME, EMAIL
              FROM "INIT$_TB_USER"
             WHERE USER_ID IN ({bind_names})
             ORDER BY USER_ID
            """,
            {f"u{i}": user_id for i, user_id in enumerate(user_ids)},
        )
        users = cursor.fetchall()
        if not users:
            raise HTTPException(status_code=404, detail="Selected users were not found.")

        results = []
        for row in users:
            temp_password = generate_temporary_password()
            cursor.execute(
                """
                UPDATE "INIT$_TB_USER"
                   SET PASSWORD_HASH = :passwordHash,
                       UPDATED_AT = SYSTIMESTAMP
                 WHERE USER_ID = :userId
                """,
                {
                    "passwordHash": _hash_password(temp_password),
                    "userId": int(row[0]),
                },
            )
            results.append({
                "userId": row[0],
                "loginId": row[1],
                "userName": row[2],
                "email": row[3],
                "temporaryPassword": temp_password,
            })

        conn.commit()
        return {
            "status": "success",
            "message": f"{len(results)} user password(s) reset. Temporary passwords are shown once.",
            "data": results,
            "total": len(results),
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M99098 password reset failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/system-table/user/deactivate")
def deactivate_users(req: UserDeactivateRequest):
    user_ids = [int(user_id) for user_id in (req.userIds or []) if int(user_id) > 0]
    if not user_ids:
        raise HTTPException(status_code=400, detail="Select at least one user to deactivate.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        bind_names = ", ".join(f":u{i}" for i, _ in enumerate(user_ids))
        cursor.execute(
            f"""
            UPDATE "INIT$_TB_USER"
               SET USE_YN = 'N',
                   UPDATED_AT = SYSTIMESTAMP
             WHERE USER_ID IN ({bind_names})
            """,
            {f"u{i}": user_id for i, user_id in enumerate(user_ids)},
        )
        affected = cursor.rowcount
        conn.commit()
        return {"status": "success", "message": f"{affected} user(s) deactivated.", "deactivatedCount": affected}
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M99098 user deactivation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/system-table/sql")
def execute_system_sql(req: SqlRequest):
    sql = normalize_select_sql(req.sql)
    limit = normalize_limit(req.limit)
    conn = None
    try:
        conn = get_db_connection()
        rows, columns = fetch_result(conn, f"SELECT * FROM ({sql}) WHERE ROWNUM <= :limit", {"limit": limit})
        return with_columns(rows, columns)
    finally:
        if conn:
            conn.close()


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


def with_columns(rows: list[dict], columns: Optional[list[str]] = None):
    return {
        "status": "success",
        "data": rows,
        "columns": columns if columns is not None else (list(rows[0].keys()) if rows else []),
        "total": len(rows),
    }


def normalize_system_table(value: str) -> str:
    table_name = str(value or "").strip().upper()
    if table_name not in INIT_SYSTEM_TABLES:
        raise HTTPException(status_code=400, detail="Invalid system table.")
    return table_name


def normalize_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 100)
    except (TypeError, ValueError):
        limit = 100
    return max(1, min(limit, 1000))


def generate_temporary_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    password = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
    ]
    password.extend(secrets.choice(alphabet) for _ in range(max(0, length - len(password))))
    secrets.SystemRandom().shuffle(password)
    return "".join(password)


def normalize_user_status(value: Optional[str]) -> str:
    status = str(value or "ALL").strip().upper()
    if status not in {"ALL", "PENDING", "APPROVED"}:
        raise HTTPException(status_code=400, detail="Invalid userStatus.")
    return status


def normalize_select_sql(sql: str) -> str:
    text = (sql or "").strip()
    text = text.rstrip(";").strip()
    if not __import__("re").match(r"(?is)^(select|with)\b", text):
        raise HTTPException(status_code=400, detail="Only SELECT statements are allowed.")
    if ";" in text:
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec)\b"
    if __import__("re").search(blocked, text, __import__("re").IGNORECASE):
        raise HTTPException(status_code=400, detail="Only read-only SELECT statements are allowed.")
    return text
