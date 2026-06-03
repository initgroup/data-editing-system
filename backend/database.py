import oracledb
import os
from dotenv import load_dotenv

# .env 파일의 내용을 환경 변수로 로드합니다.
load_dotenv()

def get_db_connection():
    """
    DB_MODE 환경 변수에 따라 로컬(19c) 또는 클라우드(26ai) DB에 연결합니다.
    """
    # 기본값은 'local'로 설정하여 안전하게 동작하도록 합니다.
    db_mode = os.getenv("DB_MODE", "local").lower()

    # 변수 초기화 (에러 방지용)
    user = None
    password = None
    dsn = None

    # .env 로드 확인 (디버깅용)    
    if db_mode == "cloud":
        # 여기서 변수명을 CLD로 정확히 매칭합니다.
        user = os.getenv("DB_USER_CLD")
        password = os.getenv("DB_PASSWORD_CLD")
        dsn = os.getenv("DB_DSN_CLD")  # <--- 이 부분이 핵심!
        base_dir = os.path.dirname(os.path.abspath(__file__))
        wallet_path = os.getenv("DB_WALLET_PATH", os.path.join(base_dir, "wallet"))
        #client_path = os.getenv("DB_CLIENT_PATH")
    else:
        user = os.getenv("DB_USER_LOC")
        password = os.getenv("DB_PASSWORD_LOC")
        # 로컬 주소 조합
        host = os.getenv("DB_HOST", "127.0.0.1")
        port = os.getenv("DB_PORT", "1521")
        service = os.getenv("DB_SERVICE", "ORCLCDB")
        dsn = f"{host}:{port}/{service}"        
    
    if not all([user, password, dsn]):
        raise ValueError("DB 설정 정보가 .env 파일에 누락되었습니다.")

    try:
        if db_mode == "cloud":
            # 여기서 변수명을 CLD로 정확히 매칭합니다.            
            print("☁️ [운영 환경] Oracle Cloud 26ai 데이터베이스에 접속 시도 중...")
            
            # 클라우드 DB 연결 (Wallet이 있으면 mTLS, 없으면 일반 TLS로 알아서 동작)
            #connection = oracledb.connect(user=user, password=password, dsn=dsn)       
            connection = oracledb.connect(
                user=user,
                password=password,
                dsn=dsn,
                config_dir=wallet_path,
                wallet_location=wallet_path,
            )

            # --- [추가 코드 시작] AI 프로필 설정 ---
            # 커넥션 생성 직후, 해당 세션에 사용할 AI 프로필을 지정합니다.
            with connection.cursor() as cursor:
                try:
                    # EXEC 대신 PL/SQL 문을 사용하여 실행합니다.
                    cursor.execute("BEGIN DBMS_CLOUD_AI.set_profile('INITAI_PROFILE'); END;")
                    print("   - ✨ Select AI 프로필('INITAI_PROFILE') 활성화 완료")
                except oracledb.Error as ai_err:
                    print(f"   - ⚠️ AI 프로필 설정 중 오류 발생: {ai_err}")
                    # 필요에 따라 raise를 할 수도 있지만, 일반 DB 접속은 성공했으므로 로그만 남깁니다.
            # --- [추가 코드 끝] ---     
        else:
            print("💻 [개발 환경] 로컬 Oracle 19c 데이터베이스에 접속 시도 중...")
            connection = oracledb.connect(user=user, password=password, dsn=dsn)
            
        print("✅ 데이터베이스 연결 성공!")
        return connection
    except oracledb.Error as e:
        # 로그를 남기고 에러를 다시 던집니다.
        # 1521 포트 접속 실패 시 네트워크/방화벽 문제일 가능성이 높음
        print(f"Oracle TLS 연결 실패 (Port 1521): {e}")
        raise e