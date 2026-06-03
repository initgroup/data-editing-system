import os
from pathlib import Path
from typing import Optional

import oracledb
from dotenv import load_dotenv


load_dotenv()


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _resolve_project_path(path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None

    path = Path(path_value)
    if path.is_absolute():
        return str(path)

    return str((PROJECT_ROOT / path).resolve())


def _connect_cloud_db(user: str, password: str, dsn: str):
    wallet_path = _resolve_project_path(
        os.getenv("DB_WALLET_PATH", "secreats/Wallet_INITGROUPEDITING")
    )
    oracle_mode = os.getenv("DB_ORACLE_MODE", "thin").lower()

    if oracle_mode == "thick":
        client_path = _resolve_project_path(os.getenv("DB_CLIENT_PATH"))
        if not client_path:
            raise ValueError("DB_ORACLE_MODE=thick 인 경우 DB_CLIENT_PATH 환경변수가 필요합니다.")

        try:
            oracledb.init_oracle_client(lib_dir=client_path, config_dir=wallet_path)
        except oracledb.ProgrammingError:
            pass

        return oracledb.connect(user=user, password=password, dsn=dsn)

    connect_args = {
        "user": user,
        "password": password,
        "dsn": dsn,
        "tcp_connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
        "retry_count": int(os.getenv("DB_RETRY_COUNT", "1")),
        "retry_delay": int(os.getenv("DB_RETRY_DELAY", "1")),
    }

    if wallet_path and Path(wallet_path).exists():
        connect_args["config_dir"] = wallet_path
        connect_args["wallet_location"] = wallet_path
        wallet_password = os.getenv("DB_WALLET_PASSWORD")
        if wallet_password:
            connect_args["wallet_password"] = wallet_password
    elif dsn and "/" not in dsn and ":" not in dsn:
        raise ValueError(
            f"DB_WALLET_PATH directory not found or inaccessible: {wallet_path}. "
            "A TNS alias such as DB_DSN_CLD requires tnsnames.ora in this directory."
        )

    return oracledb.connect(**connect_args)


def get_db_connection():
    """
    DB_MODE=local 이면 로컬 Oracle DB에, DB_MODE=cloud 이면 Oracle Cloud DB에 연결합니다.
    Cloud 연결은 기본적으로 python-oracledb Thin Mode를 사용해 Render에서도
    Oracle Instant Client 없이 동작하도록 합니다.
    """
    db_mode = os.getenv("DB_MODE", "local").lower()

    if db_mode == "cloud":
        user = os.getenv("DB_USER_CLD")
        password = os.getenv("DB_PASSWORD_CLD")
        dsn = os.getenv("DB_DSN_CLD")
    else:
        user = os.getenv("DB_USER_LOC")
        password = os.getenv("DB_PASSWORD_LOC")
        host = os.getenv("DB_HOST", "127.0.0.1")
        port = os.getenv("DB_PORT", "1521")
        service = os.getenv("DB_SERVICE", "ORCLCDB")
        dsn = f"{host}:{port}/{service}"

    if not all([user, password, dsn]):
        raise ValueError("DB 접속 환경변수가 누락되었습니다.")

    try:
        if db_mode == "cloud":
            print("[운영 환경] Oracle Cloud DB 접속 시도 중...")
            connection = _connect_cloud_db(user=user, password=password, dsn=dsn)

            with connection.cursor() as cursor:
                try:
                    cursor.execute("BEGIN DBMS_CLOUD_AI.set_profile('INITAI_PROFILE'); END;")
                    print("   - Select AI 프로필 'INITAI_PROFILE' 설정 완료")
                except oracledb.Error as ai_err:
                    print(f"   - AI 프로필 설정 중 오류 발생: {ai_err}")
        else:
            print("[개발 환경] 로컬 Oracle DB 접속 시도 중...")
            connection = oracledb.connect(user=user, password=password, dsn=dsn)

        print("데이터베이스 연결 성공!")
        return connection
    except oracledb.Error as e:
        print(f"Oracle 데이터베이스 연결 실패: {e}")
        raise
