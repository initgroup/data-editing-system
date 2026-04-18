from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import os
import logging
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import (home, M00000, M01001, M01002, M01003, M02001, M02002, M02003, M03001, M03002, M03003, M04001, M05001)

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Data Editing System API")

# CORS 설정
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# [수정] 1. API 라우터 등록을 정적 파일 마운트보다 먼저 수행합니다.
routers = [
    (home.router, "home"), 
    (M00000.router, "M00000"),(M01001.router, "M01001"),
    (M01002.router, "M01002"), (M01003.router, "M01003"),
    (M02001.router, "M02001"), (M02002.router, "M02002"),
    (M02003.router, "M02003"), (M03001.router, "M03001"),
    (M03002.router, "M03002"), (M03003.router, "M03003"),
    (M04001.router, "M04001"), (M05001.router, "M05001")
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

@app.get("/api/health") # 헬스체크용
def read_root():
    return {"message": "API 서버가 가동 중입니다."}


# [수정] 2. 정적 파일 마운트는 맨 마지막에 위치시킵니다.
script_dir = os.path.dirname(__file__)
frontend_path = os.path.join(script_dir, "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
