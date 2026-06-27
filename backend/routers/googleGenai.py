from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.database import get_db_connection
from backend.auth_context import get_request_user_id
from backend.googleGenerativeai.googleGenai import web_search_ai_assistant
from backend.routers.M91002 import get_cached_gemini_api_key
from backend.target_database import get_target_connection_id

router = APIRouter()


class AiContextAttachment(BaseModel):
    name: str = ""
    role: str = ""
    sourceType: str = ""
    contentKind: str = ""
    mimeType: str = ""
    size: int = 0
    textContent: str = ""
    base64Data: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    priority: int = 50


class AiSearchRequest(BaseModel):
    query: str
    contextAttachments: list[AiContextAttachment] = Field(default_factory=list)


@router.post("/search")
def search_with_gemini(req: AiSearchRequest, request: Request) -> dict[str, Any]:
    conn = None
    try:
        user_id = get_request_user_id(request)
        connection_id = get_target_connection_id(request)
        conn = get_db_connection()
        api_key = get_cached_gemini_api_key(conn, user_id, connection_id)
        attachments = [item.dict() for item in req.contextAttachments]
        result = web_search_ai_assistant(req.query, api_key, attachments)
        return {
            "status": "success",
            "data": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 검색 API 호출 중 오류가 발생했습니다: {e}")
    finally:
        if conn:
            conn.close()
