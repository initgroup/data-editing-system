import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class SqlLoader:
    """[요구사항 12] SQL 파일을 읽어 ID별로 관리하는 클래스"""
    _query_map: Dict[str, str] = {}

    # 상위 폴더의 database 디렉토리 내 queries.sql 지정
    _current_file_dir = os.path.dirname(os.path.abspath(__file__))
    _file_path = os.path.normpath(os.path.join(_current_file_dir, "..", "database", "queries.sql"))

    @classmethod
    def reload_queries(cls):
        """queries.sql 파일을 읽어 '-- [ID]' 기준으로 파싱하여 메모리에 로드합니다."""
        if not os.path.exists(cls._file_path):
            logger.error(f"SQL 파일을 찾을 수 없습니다: {cls._file_path}")
            return

        try:
            with open(cls._file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            new_map = {}
            # -- [ID] 패턴으로 쿼리 분리
            sections = content.split('-- [')
            for section in sections:
                if ']' in section:
                    sql_id, query = section.split(']', 1)
                    # [수정] strip() 후 맨 마지막에 세미콜론이 있다면 제거
                    clean_query = query.strip().rstrip(';')                    
                    new_map[sql_id.strip()] = clean_query
            
            cls._query_map = new_map
            logger.info(f"SQL 로드 완료: {len(cls._query_map)} 개의 쿼리")
        except Exception as e:
            logger.error(f"SQL 로딩 중 오류 발생: {str(e)}")

    @classmethod
    def get_sql(cls, sql_id: str) -> str:
        """
        주어진 ID에 해당하는 SQL 문자열을 반환합니다.
        
        Args:
            sql_id (str): 찾고자 하는 SQL의 ID (예: 'SEARCH_DATA')
            
        Raises:
            ValueError: 매핑된 SQL ID가 없을 경우 발생
        """
        # [요구사항 10] 최적의 예외 처리: 쿼리가 없을 경우 에러 발생
        sql = cls._query_map.get(sql_id)
        if not sql:
            raise ValueError(f"정의되지 않은 SQL ID입니다: {sql_id}")
        return sql

# 서버 시작 시 최초 1회 로드
SqlLoader.reload_queries()

# [요구사항 11] DML 실행 모듈 (재사용 용이)
def execute_query(conn, sql_id: str, params: Optional[Dict[str, Any]] = None, is_dml: bool = False, is_proc: bool = False) -> Dict[str, Any]:
    """
    DB 커넥션과 SQL ID를 받아 쿼리를 실행하고 결과를 반환합니다.
    """
    cursor = None
    try:
        cursor = conn.cursor()
        
        # [요구사항 12] 파일에서 ID로 SQL 추출
        sql = SqlLoader.get_sql(sql_id)
        safe_params = params or {}

        if is_proc:
            # 프로시저 호출 (sql 변수에는 프로시저명이 담김)
            out_status = cursor.var(str)
            out_msg = cursor.var(str)
            cursor.callproc(sql, [safe_params.get('input_val', ''), out_status, out_msg])
            conn.commit()
            return {"status": out_status.getvalue(), "message": out_msg.getvalue()}

        elif is_dml:
            cursor.execute(sql, safe_params)
            conn.commit()
            return {"rowcount": cursor.rowcount}

        else:
            # [전문가 수정] SQL 주석 플레이스홀더 치환 방식
            # VS Code에서 에러가 나지 않는 /* --DYNAMIC_WHERE-- */ 형식을 찾아 치환합니다.

            # 1. 안전한 인자 추출
            in_sql = safe_params.pop('in_clause_str', "")

            # 2. SQL 치환 (format 대신 replace 사용 권장)
            # 동적 WHERE 절 안전 치환 로직 (유지)
            if "/* --DYNAMIC_WHERE-- */" in sql:
                sql = sql.replace("/* --DYNAMIC_WHERE-- */", in_sql)
            elif "{in_clause}" in sql:
                # format()은 SQL 내에 다른 중괄호가 있을 때 에러가 나므로 replace가 안전합니다.
                sql = sql.replace("{in_clause}", in_sql)

            try:
                cursor.execute(sql, safe_params)
                
                # 3. 결과 데이터 처리
                if cursor.description:
                    columns = [col[0] for col in cursor.description]
                    rows = cursor.fetchall()
                    # 확실하게 리스트 객체로 생성
                    data = [dict(zip(columns, row)) for row in rows]
                else:
                    data = [] # 결과셋이 없는 경우 명시적 빈 리스트
                    
                # 4. 일관된 반환 구조 유지
                return {
                    "data": data, 
                    "total": len(data),
                    "status": "success"
                }
            except Exception as db_err:
                logger.error(f"Execution Error: {str(db_err)}")
                # 에러 발생 시에도 JS가 인식 가능한 구조를 반환하거나 명확한 HTTP 에러를 던져야 함
                return {"data": [], "total": 0, "status": "error", "detail": str(db_err)}
    except Exception as e:
        if conn and is_dml:
            conn.rollback()
        logger.error(f"[DB ERROR] ID: {sql_id} | MSG: {str(e)}")
        raise e
    finally:
        if cursor:
            cursor.close()

def get_debug_sql(sql_id: str, params: dict) -> str:
    """바인드 변수와 플레이스홀더가 치환된 디버깅용 SQL 반환"""
    try:
        sql = SqlLoader.get_sql(sql_id)
        
        # 1. 동적 IN 절 주석 처리
        in_sql = params.get('in_clause_str', '')
        sql = sql.replace("/* --DYNAMIC_WHERE-- */", in_sql)
        
        # 2. 바인드 변수 처리
        for k, v in params.items():
            if k == 'in_clause_str': continue # IN절은 이미 처리함
            target = f":{k}"
            val = f"'{v}'" if isinstance(v, str) else str(v)
            sql = sql.replace(target, val)
            
        return sql.strip()
    except:
        return f"SQL ID({sql_id})를 찾을 수 없습니다."            