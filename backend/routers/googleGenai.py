from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.googleGenerativeai.googleGenai import web_search_ai_assistant

router = APIRouter()


class AiSearchRequest(BaseModel):
    query: str


@router.post("/search")
def search_with_gemini(req: AiSearchRequest) -> dict[str, Any]:
    try:
        result = web_search_ai_assistant(req.query)
        return {
            "status": "success",
            "data": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 검색 API 호출 중 오류가 발생했습니다: {e}")
