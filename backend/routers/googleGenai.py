import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from backend.database import get_db_connection
from backend.auth_context import get_request_user_id
from backend.googleGenerativeai.googleGenai import (
    MAX_ATTACHMENT_BASE64_CHARS,
    MAX_ATTACHMENT_COUNT,
    MAX_ATTACHMENT_METADATA_CHARS,
    MAX_ATTACHMENT_TEXT_CHARS,
    MAX_ATTACHMENT_TOTAL_BASE64_CHARS,
    MAX_QUERY_CHARS,
    web_search_ai_assistant,
)
from backend.routers.M91002 import get_cached_gemini_api_key
from backend.target_database import get_target_connection_id

router = APIRouter()


class AiContextAttachment(BaseModel):
    name: str = Field(default="", max_length=512)
    role: str = Field(default="", max_length=128)
    sourceType: str = Field(default="", max_length=128)
    contentKind: str = Field(default="", max_length=128)
    mimeType: str = Field(default="", max_length=128)
    size: int = Field(default=0, ge=0)
    textContent: str = Field(default="", max_length=MAX_ATTACHMENT_TEXT_CHARS)
    base64Data: str = Field(default="", max_length=MAX_ATTACHMENT_BASE64_CHARS)
    metadata: dict[str, Any] = Field(default_factory=dict)
    priority: int = Field(default=50, ge=0, le=1000)


class AiSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_QUERY_CHARS)
    contextAttachments: list[AiContextAttachment] = Field(default_factory=list, max_length=MAX_ATTACHMENT_COUNT)

    @model_validator(mode="after")
    def validate_attachment_totals(self):
        total_base64_chars = sum(len(item.base64Data or "") for item in self.contextAttachments)
        if total_base64_chars > MAX_ATTACHMENT_TOTAL_BASE64_CHARS:
            raise ValueError("The combined attachment size exceeds the server limit.")
        total_metadata_chars = sum(
            len(json.dumps(item.metadata or {}, ensure_ascii=False))
            for item in self.contextAttachments
        )
        if total_metadata_chars > MAX_ATTACHMENT_METADATA_CHARS:
            raise ValueError("The combined attachment metadata exceeds the server limit.")
        return self


@router.post("/search")
def search_with_gemini(req: AiSearchRequest, request: Request) -> dict[str, Any]:
    conn = None
    try:
        user_id = get_request_user_id(request)
        connection_id = get_target_connection_id(request)
        conn = get_db_connection()
        api_key = get_cached_gemini_api_key(conn, user_id, connection_id)
        conn.close()
        conn = None
        attachments = [item.model_dump() for item in req.contextAttachments]
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
