"""
@file           [M01001].py 
@description    [데이터준비_데이터탐색]
@author         [인아이티 김진열]
@date           2026-04-18
@version        1.0.0

[수정 이력]:
- 2026-04-18: 최초 생성 및 기본 기능 구현
@Copyright (c) 2026 [init]. All rights reserved.
@vLicense: MIT License
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, ConfigDict
from typing import Dict, Any, List, Optional
from fastapi import Body
import logging
from backend.database import get_db_connection # 주석 해제하여 사용
from backend.database_helper import execute_query, SqlLoader, get_debug_sql
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)
router = APIRouter()

# 조회입력파라미터선언
class SearchRequest(BaseModel):
    # 명시적으로 사용할 것들만 선언
    mainCombo: Optional[str] = None
    subCombo: Optional[str] = None
    checkValues: Optional[List[str]] = []  # IN 절에 사용될 리스트
    radioVal: Optional[str] = None
    textVal: Optional[str] = None
    dateVal: Optional[str] = None
    userName: Optional[str] = None
    tableName: Optional[str] = None
    # [핵심] 선언되지 않은 나머지 필드들을 허용함
    model_config = ConfigDict(extra='allow')

@router.get("/init")
def get_init_data():
    conn = None
    try:
        conn = get_db_connection()
        # 첫번째 데이터셋
        result1 = execute_query(conn, "INIT_COMBO")
        # 두번째 데이터셋
        result2 = execute_query(conn, "INIT_COMBO")

        return {
            "status": "success", 
            "data": {
                "data1" : result1["data"],
                "data2" : result2["data"]
            },
            "total": {
                "total1" : result1["total"],
                "total2" : result2["total"]
            }
        }
    except Exception as e:
        # DB 접속 실패나 쿼리 에러 발생 시 사용자에게 500 에러 반환
        raise HTTPException(
            status_code=500,
            detail=f"데이터베이스 연결 중 오류가 발생했습니다: {str(e)}"
        )
    finally:
        # 에러가 나든 안 나든 연결이 있다면 닫아줍니다.
        if conn:
            conn.close()
    
# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/searchCombo")
def search_combo(req: SearchRequest):
    conn = None
    try:        
        params = {}

        params['parentId'] = req.mainCombo or 'XXX'

        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SUB_COMBO', params)}")

        # [실제 호출 예시]
        conn = get_db_connection()
        result = execute_query(conn, "SUB_COMBO", params)

        return {
            "status": "success", 
            "data": result["data"], 
            "columns": result.get("columns", []), # [추가]
            "total": result["total"]
        }    
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))
        


# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/search2Combo")
def search2_combo(req: SearchRequest):
    conn = None
    try:        
        params = {}

        params['parentId'] = req.mainCombo or 'XXX'
        params['secondId'] = req.subCombo or 'XXXX'

        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SUB2_COMBO', params)}")

        # [실제 호출 예시]
        conn = get_db_connection()
        result = execute_query(conn, "SUB2_COMBO", params)

        return {
            "status": "success", 
            "data": result["data"], 
            "columns": result.get("columns", []), # [추가]
            "total": result["total"]
        }
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))

# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/search")
def search_data(req: SearchRequest):
    conn = None
    try:
        params = {}        
        params['dynamicTable'] = req.subCombo or 'DUAL'
        
        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SEARCH_DATA', params)}")

        # [실제 호출 예시]
        conn = get_db_connection()
        # database_helper의 execute_query 내부에서 SqlLoader.get_sql("SEARCH_DATA")를 호출하게 됩니다.
        result = execute_query(conn, "SEARCH_DATA", params)

        # [수정] result에 담긴 columns 정보를 함께 리턴합니다.
        return {
            "status": "success", 
            "data": result["data"], 
            "columns": result.get("columns", []), # [추가]
            "total": result["total"]
        }
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/procedure")
def call_proc(req: SearchRequest, background_tasks: BackgroundTasks):
    """
    [개선안] 오라클 피처 분석 프로시저 비동기 호출
    - NoneType 에러 방지 (Safe Upper)
    - BackgroundTasks를 이용한 비동기 실행
    """
    # 1. 고유한 작업 ID 생성 (이것이 jobId가 됩니다)
    job_id = str(uuid.uuid4())

    conn = None

    # 1. 입력값 유효성 검사 및 안전한 변환 (NoneType 에러 방지)
    user_name = (req.userName or "").upper()
    table_name = (req.tableName or "").upper()

    if not user_name or not table_name:
        raise HTTPException(
            status_code=400, 
            detail="userName과 tableName은 필수 입력 항목입니다."
        )
    try:
        
        # 2. 비동기 처리를 위한 함수 정의 (Background로 실행될 로직)
        def run_analysis(u_name, t_name, job_id):
            try:
                conn = get_db_connection()

                # [수정 포인트] 리스트가 아닌 딕셔너리 형태로 전달
                # execute_query 내부에서 params.items()를 호출해도 에러가 나지 않습니다.
                analysis_params = {
                    "userName": u_name,
                    "tableName": t_name,
                    "jobId": job_id
                }
                execute_query(conn, "SP_ANALYZE_FEATURE_TYPES", analysis_params, is_proc=True)
                logger.info(f"[분석완료] {u_name}.{t_name}")
            except Exception as ex:
                logger.error(f"[분석실패] {u_name}.{t_name} : {str(ex)}")
            finally:
                if conn:
                    conn.close()

        # 3. 백그라운드 작업 등록 (오래 걸리는 작업을 뒤로 보냄)
        background_tasks.add_task(run_analysis, user_name, table_name, job_id)

        # 4. 클라이언트에게 즉시 응답 (비동기 호출의 핵심)
        return {
            "status": "PROCESSING",
            "jobId": job_id,
            "message": "AI 분석 프로시저가 백그라운드에서 시작되었습니다. 결과는 잠시 후 탭에서 확인하세요.",
            "proc_result": "SUCCESS",
            "data": {
                "targetUser": user_name,
                "targetTable": table_name
            }
        }
    except Exception as e:
        logger.error(f"프로시저 호출 중 오류 발생: {str(e)}")
        # 브라우저가 에러를 인지할 수 있도록 500 에러와 상세 내용을 전달합니다.
        raise HTTPException(status_code=500, detail=f"AI 분석 프로시저 실행 실패: {str(e)}")
    
    finally:
        # DB 연결 해제는 필수! (get_db_connection에서 context manager를 사용하지 않을 경우)
        if conn:
            conn.close()

@router.get("/status/{job_id}")
async def get_job_status(job_id: str):
    """
    [요구사항] AI 분석 프로시저 작업 상태 조회
    - DB에서 해당 jobId의 현재 상태(STATUS)를 조회하여 반환
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # 1. 작업 상태 조회를 위한 SQL (준비된 테이블 조회)
        sql = """
            SELECT STATUS, MESSAGE 
            FROM TB_ANALYSIS_JOB_STATUS 
            WHERE JOB_ID = :jobId
        """
        cursor.execute(sql, {"jobId": job_id})
        row = cursor.fetchone()

        if not row:
            # 작업 ID를 찾을 수 없는 경우
            return {
                "status": "NOT_FOUND",
                "message": "해당 작업 정보를 찾을 수 없습니다.",
                "jobId": job_id
            }

        status, message = row
        
        # 2. 상태별 응답 구성
        # 클라이언트(JS)의 checkStatus 함수에서 이 status를 보고 분기 처리를 합니다.
        return {
            "status": status,      # 'JOB_STR', 'JOB_END', 'JOB_ERR'
            "message": message or "작업이 진행 중입니다.",
            "jobId": job_id,
            "pageCode": "M01001"
        }

    except Exception as e:
        logger.error(f"상태 조회 중 오류 발생 (JobId: {job_id}): {str(e)}")
        raise HTTPException(status_code=500, detail="상태 조회 실패")
        
    finally:
        if conn:
            conn.close()            