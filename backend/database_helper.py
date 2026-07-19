import os
import logging
import re  # 정규표현식 추가 (바인드 변수 추출용)
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class SqlLoader:
    """[요구사항 12] SQL 파일을 읽어 ID별로 관리하는 클래스"""
    _query_map: Dict[str, str] = {}

    # 상위 폴더의 database 디렉토리 내 SQL 파일 지정
    _current_file_dir = os.path.dirname(os.path.abspath(__file__))
    _sql_dir = os.path.normpath(os.path.join(_current_file_dir, "..", "database"))
    _file_path = os.path.normpath(os.path.join(_sql_dir, "queries.sql"))

    @classmethod
    def normalize_loaded_sql(cls, query: str) -> str:
        text = (query or "").strip()
        if re.match(r"(?is)^\s*(declare|begin)\b", text):
            return re.sub(r"(?m)^\s*/\s*$", "", text).strip()
        return text.rstrip(';')

    @classmethod
    def reload_queries(cls):
        """database 디렉토리의 SQL 파일을 읽어 '-- [ID]' 기준으로 파싱하여 메모리에 로드합니다."""
        if not os.path.isdir(cls._sql_dir):
            logger.error(f"SQL 디렉토리를 찾을 수 없습니다: {cls._sql_dir}")
            return

        try:
            new_map = {}
            sql_files = sorted(
                os.path.join(cls._sql_dir, file_name)
                for file_name in os.listdir(cls._sql_dir)
                if file_name.lower().endswith(".sql")
            )

            for file_path in sql_files:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # -- [ID] 패턴으로 쿼리 분리
                sections = content.split('-- [')
                for section in sections:
                    if ']' in section:
                        sql_id, query = section.split(']', 1)
                        # [수정] strip() 후 맨 마지막에 세미콜론이 있다면 제거
                        clean_query = cls.normalize_loaded_sql(query)
                        new_map[sql_id.strip()] = clean_query
            
            cls._query_map = new_map
            logger.info(f"SQL 로드 완료: {len(cls._query_map)} 개의 쿼리, {len(sql_files)} 개의 파일")
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
def execute_query(conn, sql_id: str, params: dict = None, is_dml: bool = False, is_proc: bool = False) -> Dict[str, Any]:
    """
    DB 커넥션과 SQL ID를 받아 쿼리를 실행하고 결과를 반환합니다.
    """
    # 1. 커넥션 자체가 None인 경우 (연결 실패 상황) 처리
    if conn is None:
        logger.error("Database connection is None.")
        return {
            "status": "error_db",
            "message": "데이터베이스 연결에 실패하였습니다. 관리자에게 문의하세요.",
            "data": [],
            "total": 0
        }
    
    cursor = None
    try:
        # [요구사항 12] 파일에서 ID로 SQL 추출
        sql = SqlLoader.get_sql(sql_id)
        if not sql:
            # SQL 파일이 hot reload된 뒤에도 현재 프로세스가 새 SQL ID를 찾을 수 있게 한 번 재로드합니다.
            SqlLoader.reload_queries()
            sql = SqlLoader.get_sql(sql_id)
        if not sql:
            # SQL을 못 찾으면 에러 메시지 반환
            return {"data": [], "total": 0, "status": "error", "detail": f"SQL ID '{sql_id}'를 찾을 수 없습니다. (경로: {SqlLoader._sql_dir})"}
        
        cursor = conn.cursor()

        filtered_params = {}
        if params:
            # 동적SQL문 치환
            if 'dynamicTable' in params:
                sql = sql.replace("/* --DYNAMIC_TABLE-- */", params['dynamicTable'])
            if 'dynamicSql' in params:
                sql = sql.replace("/* --DYNAMIC_SQL-- */", params['dynamicSql'])
            if 'dynamicColumns' in params:
                sql = sql.replace("/* --DYNAMIC_COLUMNS-- */", params['dynamicColumns'])

            # [DPY-4008 방지] 실제 SQL에 존재하는 바인드 변수만 필터링
            used_bind_vars = re.findall(r":([a-zA-Z0-9_]+)", sql)
            filtered_params = {k: v for k, v in params.items() if k in used_bind_vars}

        if is_dml:
            cursor.execute(sql, filtered_params)
            conn.commit()
            return {"status": "success", "rowcount": cursor.rowcount}
        elif is_proc:
            cursor.execute(sql, filtered_params)
            conn.commit()
            return {"status": "success", "rowcount": cursor.rowcount}
        else:
            try:
                # 조회 실행
                cursor.execute(sql, filtered_params)

                # [중요] fetchall() 하기 전에 description을 먼저 확실하게 리스트로 변환합니다.
                # 26ai/Thick 모드에서는 실행 직후에 메타데이터를 잡아두는 것이 안전합니다.
                if cursor.description:
                    col_names = [desc[0] for desc in cursor.description]
                else:
                    col_names = []

                # 3. 결과 데이터 처리
                rows = cursor.fetchall()

                # 3. 데이터 변환 (데이터가 없을 때도 columns는 반환됨)
                data = []
                if rows:
                    data = [dict(zip(col_names, row)) for row in rows]
                    
                # 4. 일관된 반환 구조 유지
                return {
                    "status": "success",
                    "data": data,
                    "columns": col_names, # 컬럼명 리스트를 별도로 전달
                    "total": len(data)
                }
            except Exception as db_err:
                logger.error(f"Execution Error: {str(db_err)}")
                # 에러 발생 시에도 JS가 인식 가능한 구조를 반환하거나 명확한 HTTP 에러를 던져야 함
                return {"data": [], "total": 0, "status": "error", "detail": str(db_err)}
    except Exception as e:
        # Both DML and procedure execution are committed by this helper.
        # Keep the matching rollback responsibility here as well so a failed
        # procedure cannot leave an unfinished transaction on a pooled session.
        if conn and (is_dml or is_proc):
            conn.rollback()
        logger.error(f"[DB ERROR] ID: {sql_id} | MSG: {str(e)}")
        # 에러 발생 시 공통 구조 반환
        return {
            "status": "error_db",
            "message": f"데이터 조회 중 오류가 발생했습니다: {str(e)}",
            "data": [],
            "total": 0
        }
    finally:
        if cursor:
            cursor.close()

def get_debug_sql(sql_id: str, params: dict) -> str:
    """바인드 변수와 플레이스홀더가 치환된 디버깅용 SQL 반환"""
    try:
        sql = SqlLoader.get_sql(sql_id)
        if not sql:
            return f"SQL ID({sql_id})를 찾을 수 없습니다."

        # [수정] 모든 replace 대상에 'or ''' 추가
        sql = sql.replace("/* --DYNAMIC_WHERE-- */", params.get('in_clause_str') or '')
        sql = sql.replace("/* --DYNAMIC_TABLE-- */", params.get('tableName') or '')
        
        # 2. 바인드 변수 처리
        for k, v in params.items():
            if k in ['in_clause_str', 'tableName']: continue
            target = f":{k}"
            if target in sql:
                if v is None:
                    val = "NULL"
                else:
                    val = f"'{v}'" if isinstance(v, str) else str(v)
                sql = sql.replace(target, val)
        return sql.strip()
    except Exception as e:
        return f"Debug SQL 생성 중 에러: {str(e)}"
