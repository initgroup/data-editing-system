CREATE OR REPLACE PROCEDURE RUN_PROFILING_ML (
    p_table_name IN VARCHAR2,
    p_column_name IN VARCHAR2,
    p_sample_rate IN NUMBER,
    p_result_msg OUT VARCHAR2
)
IS
    v_total_cnt NUMBER;
    v_null_cnt NUMBER;
BEGIN
    -- 실제로는 DBMS_STAT이나 OML4SQL 로직이 들어갑니다.
    -- 여기서는 예시로 동적 SQL을 사용해 통계를 산출하는 시뮬레이션을 구현합니다.
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || p_table_name INTO v_total_cnt;
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || p_table_name || ' WHERE ' || p_column_name || ' IS NULL' INTO v_null_cnt;
    
    -- 프로파일링 결과 메시지 생성
    p_result_msg := '프로파일링 완료: 대상 테이블 ' || p_table_name || 
                    ', 컬럼 ' || p_column_name || 
                    ', 전체 건수 ' || v_total_cnt || 
                    ', NULL 비율 ' || ROUND((v_null_cnt/v_total_cnt)*100, 2) || '%';
EXCEPTION
    WHEN OTHERS THEN
        p_result_msg := '프로파일링 실패: ' || SQLERRM;
END RUN_PROFILING_ML;
/