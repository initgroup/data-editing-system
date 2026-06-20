from fastapi import HTTPException, Request


def get_request_user_id(request: Request) -> int:
    value = request.headers.get("X-Login-User-Id") or ""
    try:
        user_id = int(value)
    except Exception:
        user_id = 0
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="Login user context is required.")
    return user_id


def get_request_user_email(request: Request) -> str:
    return (request.headers.get("X-Login-Email") or "").strip()


def get_request_login_id(request: Request) -> str:
    return (request.headers.get("X-Login-Id") or "").strip()


def get_request_role_code(request: Request) -> str:
    return (request.headers.get("X-Login-Role-Code") or "").strip().upper()


def require_admin_role(request: Request) -> None:
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        from backend.database import get_db_connection

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ROLE_CODE, USE_YN
              FROM "INIT$_TB_USER"
             WHERE USER_ID = :userId
            """,
            {"userId": user_id},
        )
        row = cursor.fetchone()
        role_code = str(row[0] if row and row[0] else "").strip().upper()
        use_yn = str(row[1] if row and row[1] else "").strip().upper()
        if role_code != "ADMIN" or use_yn != "Y":
            raise HTTPException(status_code=403, detail="Administrator permission is required.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
