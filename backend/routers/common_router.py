from fastapi import APIRouter, HTTPException, Body
from typing import Dict, Any, Optional
import logging
import oracledb
from backend.database import get_db_connection
from backend.database_helper import SqlLoader

logger = logging.getLogger(__name__)
router = APIRouter()

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
        generated_sql = generated_sql.strip().rstrip(';')

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
            cursor.execute(generated_sql)
            col_names = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            data = [dict(zip(col_names, row)) for row in rows]
            
            return {
                "status": "success",
                "generated_sql": generated_sql,
                "data": data,
                "columns": col_names,
                "total": len(data)
            }

    except Exception as e:
        logger.error(f"AI Query Error: {str(e)}")
        return {
            "status": "error",
            "message": f"AI 처리 중 오류가 발생했습니다: {str(e)}",
            "generated_sql": generated_sql if 'generated_sql' in locals() else ""
        }
    finally:
        if conn:
            conn.close()
