from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import os
from pathlib import Path
import logging
from fastapi.middleware.cors import CORSMiddleware
from backend.database import close_db_pool
from backend.target_database import close_all_target_db_pools
from backend.routers import common_router, googleGenai, home, M01001, M01002, M02001, M02002, M03001, M03002, M03003, M03004, M04001, M04002, M90001, M90002, M91001, M91002, M91003, M99001, M99002, M99003, M99004, metadata, population_api

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Data Editing System API")

# CORS 설정
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    no_cache_paths = (
        path in ("/", "/index.html")
        or path.startswith(("/js/", "/css/", "/pages/", "/config/"))
        or path.endswith((".html", ".js", ".css"))
    )
    if no_cache_paths:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

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
    (M04002.router, "M04002"),
    (M90001.router, "M90001"),
    (M90002.router, "M90002"),
    (M91001.router, "M91001"),
    (M91002.router, "M91002"),
    (M91003.router, "M91003"),
    (M99001.router, "M99001"),
    (M99002.router, "M99002"),
    (M99003.router, "M99003"),
    (M99004.router, "M99004"),
    (metadata.router, "metadata"),
    (population_api.router, "populationApi"),
    (googleGenai.router, "googleGenai"),
]

for router, tag in routers:
    # f"/api/{tag}" prefix 사용 (예: /api/M02001)
    app.include_router(router, prefix=f"/api/{tag}", tags=[tag])


# [추가] 서버 시작 시 등록된 경로 확인 로그
@app.on_event("startup")
async def startup_event():
    logger.info("==================================================")

    logger.info("등록된 API 경로 목록:")
    for route in app.routes:
        if hasattr(route, "methods"):
            logger.info(f"URL: {route.path} | Methods: {route.methods}")
    logger.info("==================================================")

@app.on_event("shutdown")
async def shutdown_event():
    close_all_target_db_pools()
    close_db_pool()

@app.get("/api/health") # 헬스체크용
def read_root():
    return {"message": "API 서버가 가동 중입니다."}


# [수정] 2. 정적 파일 마운트는 맨 마지막에 위치시킵니다.
script_dir = os.path.dirname(__file__)
# 수정 후 (현재 파일 위치 기준으로 frontend 폴더 지정)
base_path = Path(__file__).resolve().parent
frontend_path = base_path / "frontend"
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
