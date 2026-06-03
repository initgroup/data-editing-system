"""
@file           [M01003].py 
@description    [데이터준비_프로파일링]
@author         [인아이티 김진열]
@date           2026-04-18
@version        1.0.0

[수정 이력]:
- 2026-04-18: 최초 생성 및 기본 기능 구현
@Copyright (c) 2026 [init]. All rights reserved.
@vLicense: MIT License
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import Dict, Any, List, Optional
from fastapi import Body
import logging
from backend.database import get_db_connection # 주석 해제하여 사용
from backend.database_helper import execute_query, SqlLoader, get_debug_sql

logger = logging.getLogger(__name__)
router = APIRouter()

# 조회입력파라미터선언
class SearchRequest(BaseModel):
    # 명시적으로 사용할 것들만 선언
    main_combo: Optional[str] = None
    sub_combo: Optional[str] = None
    check_values: Optional[List[str]] = []  # IN 절에 사용될 리스트
    radio_val: Optional[str] = None
    text_val: Optional[str] = None
    date_val: Optional[str] = None
    # [핵심] 선언되지 않은 나머지 필드들을 허용함
    model_config = ConfigDict(extra='allow')

@router.get("/init")
def get_init_data():
    conn = None
    try:
        conn = get_db_connection()
        # 임시 목업 데이터 반환 (실제로는 위 헬퍼 사용)
        result = execute_query(conn, "INIT_COMBO")

        return {"status": "success", "data": result["data"], "total": result["total"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail="초기 데이터 로드 실패")

@router.get("/cascade/{parent_id}")
def get_cascade_data(parent_id: str):
    conn = None
    try:
        conn = get_db_connection()
        result = execute_query(conn, "SUB_COMBO", {"parent_id": parent_id})        
        
        return {"status": "success", "data": result["data"], "total": result["total"]}
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))

# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/search")
def search_data(req: SearchRequest):
    conn = None
    try:
        in_sql = ""
        params = {}
        if req.check_values:
            bind_names = [f":chk{i}" for i in range(len(req.check_values))]
            in_sql = f" AND COL1 IN ({','.join(bind_names)})"
            for i, val in enumerate(req.check_values):
                params[f"chk{i}"] = val
        
        params['in_clause_str'] = in_sql
        params['text_val'] = req.main_combo
        
        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SEARCH_DATA', params)}")

        # [실제 호출 예시]
        conn = get_db_connection()
        # database_helper의 execute_query 내부에서 SqlLoader.get_sql("SEARCH_DATA")를 호출하게 됩니다.
        result = execute_query(conn, "SEARCH_DATA", params)
        
        return {"status": "success", "data": result["data"], "total": result["total"]}
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/procedure")
def call_proc(req: dict):
    """[요구사항 6] 오라클 프로시저 호출 예시"""
    # 실제 구현: result = execute_query(conn, "SP_MY_PROCEDURE", {"input_val": req.get("val")}, is_proc=True)
    return {
        "status": "success", 
        "proc_result": "SUCCESS", # 또는 FAIL
        "message": "프로시저가 정상적으로 실행되었습니다.",
        "affected_rows": 5
    }