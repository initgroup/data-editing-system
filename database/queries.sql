-- [INIT_COMBO]
-- 초기 로딩 시 사용하는 콤보박스 데이터 조회
SELECT USERNAME AS CODE, USERNAME AS NAME FROM ALL_USERS WHERE USERNAME IN ('C##INITAI','INIT$EDIT01') ORDER BY CREATED DESC
;

-- [SUB_COMBO]
-- 메인 콤보 변경 시 서브 콤보 조회 (바인드 변수 parentId 사용)
SELECT TABLE_NAME AS CODE, TABLE_NAME AS NAME FROM ALL_TABLES WHERE OWNER = :parentId ORDER BY TABLE_NAME
;

-- [SUB2_COMBO]
-- 서브 콤보 변경 시 서브2 콤보 조회 (바인드 변수 secondId 사용)
SELECT COLUMN_NAME AS CODE, COLUMN_NAME AS NAME FROM ALL_TAB_COLUMNS WHERE OWNER = :parentId AND TABLE_NAME = :secondId ORDER BY COLUMN_ID
;

-- [SEARCH_DATA]
-- 메인 그리드 조회용 쿼리 (인젝션 방지를 위해 DYNAMIC_WHERE는 파이썬에서 동적 생성)
SELECT ROWNUM AS RNUM, T.* FROM (SELECT * FROM /* --DYNAMIC_TABLE-- */) T WHERE ROWNUM <= 1000
;


-- [설명]
-- /* --DYNAMIC_WHERE-- */ 쿼리에서 이 부분은 동적 SQL 부분으로 주석이 아님. (database_helper.py 에서 파싱에 사용함)
SELECT * FROM DUAL;

-- [SP_ANALYZE_FEATURE_TYPES]
BEGIN
SP_ANALYZE_FEATURE_TYPES(:jobId, :userName,:tableName);
END;
;
