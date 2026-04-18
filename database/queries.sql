-- [INIT_COMBO]
-- 초기 로딩 시 사용하는 콤보박스 데이터 조회
SELECT 'C01' AS CODE, '개발팀' AS NAME FROM DUAL 
UNION ALL SELECT 'C02', '영업팀' FROM DUAL
UNION ALL SELECT 'C03', '유지팀' FROM DUAL
;

-- [SUB_COMBO]
-- 메인 콤보 변경 시 서브 콤보 조회 (바인드 변수 :parent_id 사용)
SELECT 'S01' AS CODE, '서브 ' || :parent_id AS NAME FROM DUAL
;

-- [SEARCH_DATA]
-- 메인 그리드 조회용 쿼리 (인젝션 방지를 위해 DYNAMIC_WHERE는 파이썬에서 동적 생성)
SELECT 
    ROW_NUMBER() OVER(ORDER BY 1) AS RNUM, 
    A.* FROM (
    -- 따옴표 빼기! 드라이버가 알아서 문자열로 치환해줍니다.
    SELECT :text_val AS COL1, 'data' AS COL2 FROM DUAL CONNECT BY LEVEL <=20
) A 
WHERE 1=1
/* --DYNAMIC_WHERE-- */
;

-- [설명]
-- /* --DYNAMIC_WHERE-- */ 쿼리에서 이 부분은 동적 SQL 부분으로 주석이 아님. (database_helper.py 에서 파싱에 사용함)
SELECT * FROM DUAL;

-- [SP_MY_PROCEDURE]
-- 테스트 프로시저
--RUN_PROFILING_ML