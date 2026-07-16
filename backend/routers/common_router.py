from fastapi import APIRouter, HTTPException, Body
from typing import Dict, Any, Optional
import base64
import logging
import os
import oracledb
import re
from backend.database import get_db_connection
from backend.database_helper import SqlLoader

logger = logging.getLogger(__name__)
router = APIRouter()


def _positive_env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except Exception:
        return max(minimum, default)


def _bounded_ai_value(value: Any, max_cell_bytes: int) -> tuple[Any, int, bool]:
    if value is None:
        return value, 4, False
    if hasattr(value, "read"):
        try:
            lob_size = int(value.size()) if hasattr(value, "size") else 0
        except Exception:
            lob_size = 0
        if lob_size > max_cell_bytes:
            message = f"[LOB omitted by server: {lob_size} units exceeds the cell limit]"
            return message, len(message), True
        value = value.read()
    if isinstance(value, str):
        candidate = value[:max_cell_bytes]
        encoded = candidate.encode("utf-8", errors="replace")
        if len(encoded) <= max_cell_bytes and len(candidate) == len(value):
            return value, len(encoded), False
        clipped = encoded[:max_cell_bytes].decode("utf-8", errors="ignore")
        suffix = "\n[Truncated by server]"
        result = f"{clipped}{suffix}"
        return result, len(result.encode("utf-8")), True
    if isinstance(value, (bytes, bytearray, memoryview)):
        value_size = len(value)
        if value_size > max_cell_bytes:
            message = f"[Binary value omitted by server: {value_size} bytes]"
            return message, len(message), True
        encoded_value = base64.b64encode(bytes(value)).decode("ascii")
        result = f"base64:{encoded_value}"
        return result, len(result.encode("utf-8")), False
    rendered = str(value)
    return value, len(rendered.encode("utf-8", errors="replace")), False


def normalize_read_only_sql(sql: str) -> str:
    text = (sql or "").strip()
    text = re.sub(r";+\s*$", "", text)
    if not re.match(r"(?is)^(select|with)\b", text):
        raise HTTPException(status_code=400, detail="AI generated SQL must be a read-only SELECT statement.")
    if re.search(r";\s*\S", sql or ""):
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec)\b"
    if re.search(blocked, text, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="AI generated SQL contains a blocked command.")
    return text

@router.post("/ai/ask")
async def ask_ai(payload: Dict[str, Any] = Body(...)):
    """
    Select AI를 사용하여 자연어를 SQL로 변환하거나 결과를 조회합니다.
    payload: { "prompt": "질문내용", "mode": "sql" 또는 "data" }
    """
    prompt = payload.get("question")
    mode = payload.get("mode", "sql") # sql: 문장만, data: 결과까지
    
    if not prompt:
        raise HTTPException(status_code=400, detail="질문 내용을 입력해주세요.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(SqlLoader.get_sql("COMMON_AI_SHOWSQL"), {"prompt": prompt})
        row = cursor.fetchone()
        
        # GENERATE 결과는 CLOB이므로 read() 처리
        generated_sql = ""
        if row and row[0]:
            # LOB 객체일 경우 read() 호출, 문자열일 경우 바로 처리
            if hasattr(row[0], 'read'):
                generated_sql = row[0].read()
            else:
                generated_sql = str(row[0])
        
        # SQL 끝에 세미콜론(;)이 있으면 제거 (파이썬 실행용)
        generated_sql = normalize_read_only_sql(generated_sql)

        # 2. 모드에 따른 처리
        if mode == "sql":
            return {
                "status": "success",
                "generated_sql": generated_sql,
                "data": [],
                "message": "SQL 문장이 생성되었습니다."
            }
        else:
            # 변환된 SQL을 즉시 실행하여 데이터 가져오기
            # database_helper의 로직을 재사용하여 컬럼 정보까지 포함
            configured_max_rows = _positive_env_int("APP_AI_QUERY_MAX_ROWS", 1000)
            max_response_bytes = _positive_env_int("APP_AI_QUERY_MAX_RESPONSE_BYTES", 4 * 1024 * 1024, 1024)
            max_cell_bytes = min(
                max_response_bytes,
                _positive_env_int("APP_AI_QUERY_MAX_CELL_BYTES", 256 * 1024, 1024),
            )
            fetch_batch_rows = _positive_env_int("APP_AI_QUERY_FETCH_BATCH_ROWS", 25)
            requested_max_rows = payload.get("maxRows")
            try:
                effective_max_rows = min(
                    configured_max_rows,
                    max(1, int(requested_max_rows or configured_max_rows)),
                )
            except (TypeError, ValueError):
                effective_max_rows = configured_max_rows
            try:
                cursor.arraysize = fetch_batch_rows
                cursor.prefetchrows = fetch_batch_rows
            except Exception:
                pass
            cursor.execute(generated_sql)
            col_names = [desc[0] for desc in cursor.description] if cursor.description else []
            data = []
            approximate_response_bytes = 0
            truncated = False
            truncated_cells = 0
            while len(data) < effective_max_rows:
                rows = cursor.fetchmany(min(fetch_batch_rows, effective_max_rows - len(data)))
                if not rows:
                    break
                for row in rows:
                    record = {}
                    record_bytes = 0
                    for column_name, value in zip(col_names, row):
                        bounded_value, value_bytes, cell_truncated = _bounded_ai_value(value, max_cell_bytes)
                        record[column_name] = bounded_value
                        record_bytes += len(str(column_name).encode("utf-8")) + value_bytes
                        if cell_truncated:
                            truncated_cells += 1
                    if approximate_response_bytes + record_bytes > max_response_bytes:
                        truncated = True
                        break
                    data.append(record)
                    approximate_response_bytes += record_bytes
                    if len(data) >= effective_max_rows:
                        break
                if truncated:
                    break
            if not truncated and len(data) >= effective_max_rows:
                truncated = cursor.fetchone() is not None
            
            return {
                "status": "success",
                "generated_sql": generated_sql,
                "data": data,
                "columns": col_names,
                "total": len(data),
                "truncated": truncated,
                "maxRows": effective_max_rows,
                "maxResponseBytes": max_response_bytes,
                "truncatedCells": truncated_cells,
            }

    except Exception as e:
        logger.error(f"AI Query Error: {str(e)}")
        return {
            "status": "error",
            "message": f"AI 처리 중 오류가 발생했습니다: {str(e)}",
            "generated_sql": generated_sql if 'generated_sql' in locals() else ""
        }
    finally:
        try:
            if cursor:
                cursor.close()
        finally:
            if conn:
                conn.close()
