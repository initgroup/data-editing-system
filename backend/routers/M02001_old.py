from fastapi import APIRouter, HTTPException, BackgroundTasks, status
from pydantic import BaseModel
from database import get_db_connection
import datetime
import time
import logging # [추가] 로깅 라이브러리 임포트

# [추가] 로깅 설정: 로그 레벨을 INFO로 설정하여 터미널에 출력되도록 함
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

class DiscoveryRequest(BaseModel):
    target_table: str
    target_column: str
    discovery_type: str

# 비동기로 실행될 실제 로직 함수
def task_logic(h_id, target_column):
    # [추가] 비동기 작업 시작 로그
    logger.info(f" === [TASK START] HIST_ID: {h_id} 에 대한 규칙 발굴 분석을 시작합니다. ===")
    try:
        # 3초간 분석하는 척...
        time.sleep(3)
        
        # 분석 결과 임의 생성
        discovered = [
            ('RANGE', f'{target_column}의 값은 0에서 10억 사이여야 함', 99.5),
            ('FORMAT', f'{target_column}은 숫자형식이어야 함', 100.0)
        ]
        
        conn_task = get_db_connection()
        cur_task = conn_task.cursor()
        
        for r_type, r_desc, r_conf in discovered:
            cur_task.execute(
                "INSERT INTO DISCOVERED_RULES (HIST_ID, RULE_TYPE, RULE_DESC, CONFIDENCE) VALUES (:1, :2, :3, :4)",
                (h_id, r_type, r_desc, r_conf)
            )
            # [추가] 규칙 생성 로그
            logger.info(f" [INSERT RULE] 유형: {r_type}, 설명: {r_desc}")
        
        cur_task.execute("UPDATE RULE_DISCOVERY_HISTORY SET STATUS='COMPLETED', EXEC_END_DT=SYSDATE WHERE HIST_ID=:1", (h_id,))
        conn_task.commit()
        cur_task.close()
        conn_task.close()
        
        # [추가] 비동기 작업 완료 로그
        logger.info(f" === [TASK COMPLETED] HIST_ID: {h_id} 분석 및 저장 완료 ===")
        
    except Exception as e:
        # [추가] 비동기 작업 에러 로그
        logger.error(f" !!! [TASK ERROR] 비동기 작업 중 오류 발생 (HIST_ID: {h_id}): {str(e)} !!!")

# 2. 규칙발굴 실행
@router.post("/run")
def run_discovery(req: DiscoveryRequest, background_tasks: BackgroundTasks):
    # [추가] API 진입 로그 및 파라미터 확인
    logger.info("--------------------------------------------------")
    logger.info(f"[POST /run] 규칙 발굴 요청 수신")
    logger.info(f" - 대상 테이블: {req.target_table}")
    logger.info(f" - 분석 컬럼: {req.target_column}")
    logger.info("--------------------------------------------------")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 이력 생성 및 HIST_ID 받아오기
        cursor.execute(
            "INSERT INTO RULE_DISCOVERY_HISTORY (TARGET_TABLE, TARGET_COLUMN, STATUS) VALUES (:1, :2, 'RUNNING') RETURNING HIST_ID INTO :3",
            (req.target_table, req.target_column, cursor.var(int))
        )
        hist_id = cursor.get_value(0)
        conn.commit()
        cursor.close()
        conn.close()
        
        # [추가] DB 이력 생성 성공 로그
        logger.info(f"[DB SUCCESS] 이력 생성 완료 (HIST_ID: {hist_id})")
        
        # 백그라운드 태스크 등록
        background_tasks.add_task(task_logic, hist_id, req.target_column)
        
        return {"status": "success", "message": "발굴 작업이 시작되었습니다.", "hist_id": hist_id}

    except Exception as e:
        # [추가] 실행 에러 로그 기록
        logger.error(f"[API ERROR] run_discovery 실행 오류: {str(e)}")
        raise HTTPException(status_code=500, detail=f"백엔드 실행 오류: {str(e)}")

# 3. 발굴 결과 조회
@router.get("/results/{hist_id}")
def get_results(hist_id: int):
    # [추가] 결과 조회 요청 로그
    logger.info(f"[GET /results/{hist_id}] 결과 조회 요청")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT RULE_ID, RULE_TYPE, RULE_DESC, CONFIDENCE FROM DISCOVERED_RULES WHERE HIST_ID = :1", (hist_id,))
        
        rows = cursor.fetchall()
        if not rows:
             # [추가] 결과 미생성 상태 로그
             logger.warning(f"[INFO] HIST_ID: {hist_id} 에 대한 분석 결과가 아직 없습니다.")
             return {"status": "empty", "message": "분석 결과가 아직 생성되지 않았습니다.", "data": []}

        columns = [col[0] for col in cursor.description]
        data = [dict(zip(columns, row)) for row in rows]
        
        cursor.close()
        conn.close()
        
        # [추가] 결과 반환 로그
        logger.info(f"[SUCCESS] HIST_ID: {hist_id} 결과 {len(data)}건 반환")
        return {"status": "success", "data": data}
        
    except Exception as e:
        # [추가] 조회 에러 로그
        logger.error(f"[API ERROR] 결과 조회 실패 (HIST_ID: {hist_id}): {str(e)}")
        raise HTTPException(status_code=500, detail=f"결과 조회 실패: {str(e)}")