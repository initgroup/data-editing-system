from fastapi import APIRouter

# 이 줄이 반드시 있어야 합니다! (main.py에서 찾고 있는 게 바로 이거예요)
router = APIRouter()

@router.get("/")
async def read_home():
    return {"message": "메타 정보 페이지입니다."}