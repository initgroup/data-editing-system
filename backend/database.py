import oracledb
import os
from dotenv import load_dotenv

# .env 파일의 내용을 환경 변수로 로드합니다.
load_dotenv()

def get_db_connection():
    try:
        # os.getenv()를 사용하여 .env에 정의된 값을 가져와야 합니다.
        connection = oracledb.connect(
            user=os.getenv("DB_USER"), 
            password=os.getenv("DB_PASSWORD"), 
            dsn=os.getenv("DB_DSN")
        )
        return connection
    except Exception as e:
        print(f"DB 연결 오류: {e}")
        return None