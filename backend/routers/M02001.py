from fastapi import APIRouter, HTTPException, BackgroundTasks, status
from pydantic import BaseModel
from database import get_db_connection
import time
import logging

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

class DiscoveryRequest(BaseModel):
    target_table: str
    target_column: str
    discovery_type: str

def task_logic(h_id, target_column):
    logger.info(f" === [TASK START] HIST_ID: {h_id} 분석 시작 ===")
    conn_task = None
    try:
        time.sleep(3) # 분석 시뮬레이션
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
        cur_task.execute("UPDATE RULE_DISCOVERY_HISTORY SET STATUS='COMPLETED', EXEC_END_DT=SYSDATE WHERE HIST_ID=:1", (h_id,))
        conn_task.commit()
        logger.info(f" === [TASK COMPLETED] HIST_ID: {h_id} 완료 ===")
    except Exception as e:
        logger.error(f" !!! [TASK ERROR] {str(e)} !!!")
    finally:
        if conn_task:
            conn_task.close()

@router.post("/run")
def run_discovery(req: DiscoveryRequest, background_tasks: BackgroundTasks):
    logger.info("--------------------------------------------------")
    logger.info(f"▶ [POST /run] 엔드포인트 진입 성공")
    logger.info(f" - Table: {req.target_table}, Column: {req.target_column}")
    logger.info("--------------------------------------------------")
    
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # [수정] Cursor.get_value 오류 해결을 위한 변수 바인딩 방식
        hist_id_var = cursor.var(int)
        cursor.execute(
            """
            INSERT INTO RULE_DISCOVERY_HISTORY (TARGET_TABLE, TARGET_COLUMN, STATUS) 
            VALUES (:1, :2, 'RUNNING') 
            RETURNING HIST_ID INTO :3
            """,
            (req.target_table, req.target_column, hist_id_var)
        )
        
        # 반환된 ID 값 추출
        hist_id = hist_id_var.values[0][0]
        conn.commit()
        
        logger.info(f"▶ [DB SUCCESS] HIST_ID {hist_id} 생성 완료")
        background_tasks.add_task(task_logic, hist_id, req.target_column)
        
        return {"status": "success", "message": "발굴 작업 시작", "hist_id": hist_id}
    except Exception as e:
        if conn: conn.rollback()
        logger.error(f"▶ [API ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=f"DB 작업 오류: {str(e)}")
    finally:
        if conn: conn.close()

@router.get("/results/{hist_id}")
def get_results(hist_id: int):
    # [추가] 결과 조회 요청 로그
    logger.info(f"[GET /results/{hist_id}] 결과 조회 요청")
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        # 실제 DB에서 조회하는 대신 DUAL 테이블을 사용하여 샘플 데이터 반환
        cursor.execute("""
            SELECT 
                CAST(ROWNUM AS NUMBER) as RULE_ID,
                CASE MOD(ROWNUM, 4)
                    WHEN 0 THEN 'RANGE'
                    WHEN 1 THEN 'FORMAT' 
                    WHEN 2 THEN 'REFERENTIAL'
                    ELSE 'PATTERN'
                END as RULE_TYPE,
                CASE MOD(ROWNUM, 4)
                    WHEN 0 THEN '값은 0에서 10억 사이여야 함'
                    WHEN 1 THEN '숫자형식이어야 함'
                    WHEN 2 THEN '참조 테이블의 ID를 참조해야 함'
                    ELSE '특정 패턴을 따라야 함'
                END as RULE_DESC,
                CASE MOD(ROWNUM, 4)
                    WHEN 0 THEN 99.5
                    WHEN 1 THEN 100.0
                    WHEN 2 THEN 95.2
                    ELSE 89.5
                END as CONFIDENCE
            FROM DUAL 
            CONNECT BY ROWNUM <= 4
        """)
        # cursor.execute("SELECT RULE_ID, RULE_TYPE, RULE_DESC, CONFIDENCE FROM DISCOVERED_RULES WHERE HIST_ID = :1", (hist_id,))
        rows = cursor.fetchall()

        if not rows:
             return {"status": "empty", "message": "결과 생성 중", "data": []}
             
        columns = [col[0] for col in cursor.description]
        data = [dict(zip(columns, row)) for row in rows]
        return {"status": "success", "data": data}
    except Exception as e:
        logger.error(f"[API ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: conn.close()

@router.post("/select")
def select_discovery(req: DiscoveryRequest):
    logger.info(f"▶ [SELECT] Table: {req.target_table}, Col: {req.target_column} 즉시 조회")
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # [방법 1] 실제 DB에 데이터가 있다면 해당 테이블 조회
        # [방법 2] 여기서는 요청하신 대로 가상의 SQL(DUAL 방식)로 즉시 결과 생성
        sql = """
            SELECT 
                CAST(ROWNUM AS NUMBER) as RULE_ID,
                CASE MOD(ROWNUM, 4)
                    WHEN 0 THEN 'RANGE'
                    WHEN 1 THEN 'FORMAT' 
                    WHEN 2 THEN 'REFERENTIAL'
                    ELSE 'PATTERN'
                END as RULE_TYPE,
                :target_col || CASE MOD(ROWNUM, 4)
                    WHEN 0 THEN ' 값은 0에서 10억 사이여야 함'
                    WHEN 1 THEN '은 숫자형식이어야 함'
                    WHEN 2 THEN '은 참조 테이블의 ID를 참조해야 함'
                    ELSE '은 특정 패턴을 따라야 함'
                END as RULE_DESC,
                CASE MOD(ROWNUM, 4)
                    WHEN 0 THEN 99.5
                    WHEN 1 THEN 100.0
                    WHEN 2 THEN 95.2
                    ELSE 89.5
                END as CONFIDENCE
            FROM DUAL 
            CONNECT BY ROWNUM <= 8
        """
        
        cursor.execute(sql, {"target_col": req.target_column})
        rows = cursor.fetchall()
        
        # 컬럼명 추출 및 dict 변환
        columns = [col[0] for col in cursor.description]
        data = [dict(zip(columns, row)) for row in rows]
        
        # JS에서 data.status와 data.data 로 접근하므로 형식을 맞춤
        return {
            "status": "success",
            "data": data
        }

    except Exception as e:
        logger.error(f"▶ [SELECT ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: conn.close()        

@router.get("/tables")
def get_table_list():
    """페이지 로딩 시 첫 번째 콤보박스(테이블 목록) 채우기"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        # 실제로는 USER_TABLES를 조회하거나, 여기서는 예시로 DUAL을 포함한 리스트 반환
        sql = """
            SELECT TABLE_NAME AS TABLE_ID, TABLE_NAME AS TABLE_NM FROM USER_TABLES ORDER BY TABLE_NAME
        """
        cursor.execute(sql)
        rows = cursor.fetchall()

        # [중요] 컬럼명을 추출하여 딕셔너리 리스트로 변환
        columns = [col[0] for col in cursor.description]
        data = [dict(zip(columns, row)) for row in rows]
        
        return {"status": "success", "data": data}
    finally:
        if conn: conn.close()

@router.get("/columns/{table_name}")
def get_column_list(table_name: str):
    """테이블 선택 시 두 번째 콤보박스(컬럼 목록) 채우기"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 테이블명에 따른 동적 컬럼 조회 시뮬레이션
        if table_name == 'DUAL':
            sql = "SELECT 'DUMMY' as COL FROM DUAL"
        else:
            sql = """
                SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :table_id
            """            
            cursor.execute(sql, {"table_id": table_name})
            
        cursor.execute(sql)
        rows = cursor.fetchall()
        return {"status": "success", "data": [row[0] for row in rows]}
    finally:
        if conn: conn.close()       