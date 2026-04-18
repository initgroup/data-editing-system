from fastapi import APIRouter
from database import get_db_connection

router = APIRouter()

@router.get("/")
def get_metadata_list():
    # Oracle DB 연결 및 조회 로직
    return {"menu": "메타정보", "status": "success", "data": []}

@router.post("/save")
def save_metadata(data: dict):
    # CRUD: 저장 로직
    return {"message": "메타정보가 저장되었습니다."}