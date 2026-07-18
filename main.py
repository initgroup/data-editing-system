from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import os
from pathlib import Path
import logging
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.database import close_db_pool
from backend.target_database import close_all_target_db_pools
from backend.services.data_work_router import (
    shutdown_data_work_transactions,
    start_data_work_transaction_cleanup,
)
from backend.services.background_jobs import shutdown_background_jobs
from backend.auth_context import (
    authenticate_internal_api_request,
    authenticate_request,
    get_session_ttl_seconds,
    refresh_session_cookie,
    require_admin_role,
)
from backend.routers import common_router, googleGenai, home, M01001, M01002, M02001, M02002, M03001, M03002, M03003, M03004, M04001, M90001, M90002, M90003, M91001, M91002, M91003, M99001, M99002, M99003, M99004, metadata, ml_analysis, population_api
from backend.services.anly_work_router import create_anly_work_router

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Data Editing System API")


class _GeminiRequestBodyLimitMiddleware:
    """Bound the Gemini request body even when Content-Length is omitted."""

    def __init__(self, wrapped_app):
        self.app = wrapped_app

    @staticmethod
    def _max_request_bytes() -> int:
        try:
            return max(1, int(os.getenv("APP_GEMINI_MAX_REQUEST_BYTES", str(20 * 1024 * 1024))))
        except Exception:
            return 20 * 1024 * 1024

    @staticmethod
    async def _send_error(scope, receive, send, status_code: int, detail: str) -> None:
        response = JSONResponse(status_code=status_code, content={"detail": detail})
        await response(scope, receive, send)

    async def __call__(self, scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method", "").upper() != "POST"
            or scope.get("path") != "/api/googleGenai/search"
        ):
            await self.app(scope, receive, send)
            return

        max_request_bytes = self._max_request_bytes()
        headers = dict(scope.get("headers") or [])
        content_length = headers.get(b"content-length", b"").strip()
        if content_length:
            try:
                parsed_content_length = int(content_length)
                if parsed_content_length < 0:
                    raise ValueError
            except (TypeError, ValueError):
                await self._send_error(scope, receive, send, 400, "Invalid Content-Length header.")
                return
            if parsed_content_length > max_request_bytes:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    413,
                    "AI attachment request exceeds the server size limit.",
                )
                return

        received_bytes = 0
        limit_exceeded = False
        response_start = None
        response_committed = False
        replacement_sent = False

        async def limited_receive():
            nonlocal received_bytes, limit_exceeded
            if limit_exceeded:
                return {"type": "http.request", "body": b"", "more_body": False}
            message = await receive()
            if message.get("type") == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > max_request_bytes:
                    limit_exceeded = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def send_limit_response() -> None:
            nonlocal response_committed, replacement_sent
            if replacement_sent or response_committed:
                return
            replacement_sent = True
            response_committed = True
            await self._send_error(
                scope,
                limited_receive,
                send,
                413,
                "AI attachment request exceeds the server size limit.",
            )

        async def limited_send(message):
            nonlocal response_start, response_committed
            if replacement_sent:
                return
            if message.get("type") == "http.response.start":
                response_start = message
                return
            if message.get("type") == "http.response.body":
                if limit_exceeded:
                    await send_limit_response()
                    return
                if response_start is not None and not response_committed:
                    await send(response_start)
                    response_committed = True
                await send(message)
                return
            await send(message)

        await self.app(scope, limited_receive, limited_send)
        if limit_exceeded and not response_committed:
            await send_limit_response()
        elif response_start is not None and not response_committed:
            await send(response_start)
            await send({"type": "http.response.body", "body": b"", "more_body": False})

# CORS 설정
def _get_allowed_origins() -> list[str]:
    configured = os.getenv("INIT_ALLOWED_ORIGINS", "")
    origins = [item.strip() for item in configured.split(",") if item.strip()]
    if origins:
        return origins
    return [
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Target-Connection-Id",
        "X-Connection-Id",
        "X-Bootstrap-Token",
        "X-INIT-API-Key",
    ],
    expose_headers=["X-INIT-Session-TTL-Seconds"],
)


PUBLIC_API_PATHS = {
    "/api/health",
    "/api/M91001/admin-contact",
    "/api/M91001/signup/save",
    "/api/M91001/login",
    "/api/M91001/logout",
    "/api/M99001/bootstrap/init-system",
    "/api/M99001/connection/test",
}

ADMIN_API_PREFIXES = (
    "/api/M90003",
    "/api/M99001",
    "/api/M99002",
    "/api/M99003",
    "/api/M99004",
)

AUTHENTICATED_USER_API_PATHS = {
    "/api/M99001/connections",
}

SENSITIVE_DIRECT_PATH_PREFIXES = (
    "/.env",
    "/backend",
    "/database",
    "/instantclient",
    "/secreats",
    "/secrets",
    "/Wallet",
)


def _is_public_api_path(path: str) -> bool:
    return path in PUBLIC_API_PATHS


def _is_admin_api_path(path: str) -> bool:
    if path in PUBLIC_API_PATHS:
        return False
    if path in AUTHENTICATED_USER_API_PATHS:
        return False
    return path.startswith(ADMIN_API_PREFIXES)


@app.middleware("http")
async def enforce_api_authentication(request, call_next):
    path = request.url.path
    if path == "/.env" or path.startswith(SENSITIVE_DIRECT_PATH_PREFIXES):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    browser_session_authenticated = False
    if path.startswith("/api/") and request.method.upper() != "OPTIONS":
        if not _is_public_api_path(path):
            try:
                if path.startswith("/api/mlAnalysis/") and authenticate_internal_api_request(request):
                    pass
                else:
                    authenticate_request(request)
                    browser_session_authenticated = True
                if _is_admin_api_path(path):
                    require_admin_role(request)
            except Exception as exc:
                status_code = getattr(exc, "status_code", 401)
                detail = getattr(exc, "detail", "Login session is required.")
                return JSONResponse(status_code=status_code, content={"detail": detail})
    response = await call_next(request)
    if browser_session_authenticated:
        refresh_session_cookie(request, response)
        response.headers["X-INIT-Session-TTL-Seconds"] = str(get_session_ttl_seconds())
    return response


@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    no_cache_paths = (
        path in ("/", "/index.html")
        or path.startswith(("/js/", "/css/", "/pages/", "/config/", "/i18n/"))
        or path.endswith((".html", ".js", ".css"))
    )
    if no_cache_paths:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.add_middleware(_GeminiRequestBodyLimitMiddleware)

# [수정] 1. API 라우터 등록을 정적 파일 마운트보다 먼저 수행합니다.
routers = [
    (common_router.router, "common"), 
    (home.router, "home"),
    (M01001.router, "M01001"),
    (M01002.router, "M01002"),
    (M02001.router, "M02001"),
    (M02002.router, "M02002"),
    (M03001.router, "M03001"),
    (M03002.router, "M03002"),
    (M03003.router, "M03003"),
    (M03004.router, "M03004"),
    (M04001.router, "M04001"),
    (create_anly_work_router(menu_code="M04002", flow_menu_code="M04001"), "M04002"),
    (M90001.router, "M90001"),
    (M90002.router, "M90002"),
    (M90003.router, "M90003"),
    (M91001.router, "M91001"),
    (M91002.router, "M91002"),
    (M91003.router, "M91003"),
    (M99001.router, "M99001"),
    (M99002.router, "M99002"),
    (M99003.router, "M99003"),
    (M99004.router, "M99004"),
    (metadata.router, "metadata"),
    (ml_analysis.router, "mlAnalysis"),
    (population_api.router, "populationApi"),
    (googleGenai.router, "googleGenai"),
]

for router, tag in routers:
    # f"/api/{tag}" prefix 사용 (예: /api/M02001)
    app.include_router(router, prefix=f"/api/{tag}", tags=[tag])


# [추가] 서버 시작 시 등록된 경로 확인 로그
@app.on_event("startup")
async def startup_event():
    start_data_work_transaction_cleanup()
    logger.info("==================================================")

    logger.info("등록된 API 경로 목록:")
    for route in app.routes:
        if hasattr(route, "methods"):
            logger.info(f"URL: {route.path} | Methods: {route.methods}")
    logger.info("==================================================")

@app.on_event("shutdown")
async def shutdown_event():
    cleanup_steps = (
        ("background jobs", shutdown_background_jobs),
        ("data work transactions", shutdown_data_work_transactions),
        ("target DB pools", close_all_target_db_pools),
        ("system DB pool", close_db_pool),
    )
    for label, cleanup in cleanup_steps:
        try:
            cleanup()
        except Exception:
            logger.exception("Shutdown cleanup failed for %s; continuing.", label)

@app.get("/api/health") # 헬스체크용
def read_root():
    return {"message": "API 서버가 가동 중입니다."}


# [수정] 2. 정적 파일 마운트는 맨 마지막에 위치시킵니다.
script_dir = os.path.dirname(__file__)
# 수정 후 (현재 파일 위치 기준으로 frontend 폴더 지정)
base_path = Path(__file__).resolve().parent
frontend_path = base_path / "frontend"
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
