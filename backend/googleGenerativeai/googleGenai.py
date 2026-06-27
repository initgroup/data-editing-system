import base64
import json
import time
from typing import Any

from google import genai
from google.genai import types

# 가장 성능이 좋은 2.5-flash를 1순위로 두고, 혹시 모를 에러나 한도 초과 시 2.0으로 우회하도록 배치
GEMINI_MODELS = (
    "gemini-2.5-flash", 
    "gemini-2.5-flash-thinking",  # 복잡한 검색 요약용으로 추가 추천
    "gemini-2.0-flash"
)

MAX_RETRIES_PER_MODEL = 3
RETRY_DELAY_SECONDS = 2
MAX_ATTACHMENT_TEXT_CHARS = 180000
MAX_ATTACHMENT_BINARY_BYTES = 4 * 1024 * 1024


def _get_client(api_key: str) -> genai.Client:
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("M91002 나의 회원정보에서 Gemini API 개인 인증키를 등록해 주세요.")

    # 이전 방식: 서버 .env의 공용 GEMINI_API_KEY 사용
    # api_key = os.getenv("GEMINI_API_KEY")

    return genai.Client(api_key=api_key)


def _is_retryable_error(error: Exception) -> bool:
    message = str(error).lower()
    retryable_signals = (
        "503",
        "unavailable",
        "high demand",
        "temporarily",
        "timeout",
        "deadline",
        "429",
        "resource_exhausted",
    )

    return any(signal in message for signal in retryable_signals)


def _extract_sources(response: Any) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        metadata = getattr(candidate, "grounding_metadata", None)
        chunks = getattr(metadata, "grounding_chunks", None) if metadata else None

        for chunk in chunks or []:
            web = getattr(chunk, "web", None)
            uri = getattr(web, "uri", "") if web else ""
            title = getattr(web, "title", "") if web else ""

            if uri and uri not in seen_urls:
                seen_urls.add(uri)
                sources.append({"title": title or uri, "url": uri})

    return sources


def _truncate_text(value: str, max_chars: int) -> str:
    text = str(value or "")
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}\n\n[Truncated by server: {len(text) - max_chars} more characters]"


def _build_attachment_text_context(context_attachments: list[dict[str, Any]] | None) -> str:
    attachments = sorted(context_attachments or [], key=lambda item: int(item.get("priority") or 50))
    if not attachments:
        return ""

    sections: list[str] = [
        "첨부 context가 있습니다. 아래 순서를 우선순위로 사용해 답변하세요.",
        "1. 메뉴 도움말(menu-help)은 사용자 질문 해석의 최우선 기준입니다.",
        "2. runtime-elements-snapshot.html은 F12 Elements처럼 동적으로 렌더링된 현재 화면 상태입니다.",
        "3. 사용자 첨부 파일과 캡처 이미지는 질문의 직접 근거입니다.",
        ""
    ]
    used_chars = 0

    for index, item in enumerate(attachments, start=1):
        name = item.get("name") or f"attachment-{index}"
        role = item.get("role") or ""
        source_type = item.get("sourceType") or ""
        content_kind = item.get("contentKind") or ""
        mime_type = item.get("mimeType") or ""
        size = item.get("size") or 0
        metadata = item.get("metadata") or {}
        text_content = item.get("textContent") or ""

        header = [
            f"[첨부 {index}]",
            f"- name: {name}",
            f"- role: {role}",
            f"- sourceType: {source_type}",
            f"- contentKind: {content_kind}",
            f"- mimeType: {mime_type}",
            f"- size: {size}",
            f"- metadata: {json.dumps(metadata, ensure_ascii=False)}",
        ]
        body = ""
        if text_content:
            remaining = MAX_ATTACHMENT_TEXT_CHARS - used_chars
            if remaining <= 0:
                body = "[Text content omitted because attachment context limit was reached.]"
            else:
                body = _truncate_text(text_content, remaining)
                used_chars += len(body)
        elif item.get("base64Data"):
            body = "[Binary content is attached as a Gemini file part when supported.]"
        else:
            body = "[No text content.]"

        sections.append("\n".join(header))
        sections.append("```")
        sections.append(body)
        sections.append("```")
        sections.append("")

    return "\n".join(sections).strip()


def _build_attachment_parts(context_attachments: list[dict[str, Any]] | None) -> list[types.Part]:
    parts: list[types.Part] = []

    for item in sorted(context_attachments or [], key=lambda value: int(value.get("priority") or 50)):
        mime_type = str(item.get("mimeType") or "")
        base64_data = str(item.get("base64Data") or "")
        if not base64_data:
            continue
        if not (mime_type.startswith("image/") or mime_type == "application/pdf"):
            continue

        try:
            data = base64.b64decode(base64_data, validate=True)
        except Exception:
            continue
        if not data or len(data) > MAX_ATTACHMENT_BINARY_BYTES:
            continue

        parts.append(types.Part.from_bytes(data=data, mime_type=mime_type))

    return parts


def web_search_ai_assistant(user_query: str, api_key: str, context_attachments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if not user_query or not user_query.strip():
        raise ValueError("질문을 입력해 주세요.")

    attachment_context = _build_attachment_text_context(context_attachments)
    attachment_parts = _build_attachment_parts(context_attachments)
    prompt = f"""
    당신은 데이터 편집 시스템에 포함된 웹 검색 AI 도우미입니다.
    Google Search로 확인한 최신 정보를 바탕으로 한국어로 친절하고 정확하게 답변해 주세요.
    근거가 부족하면 확정적으로 말하지 말고, 확인이 필요한 부분을 알려 주세요.
    첨부 context가 있으면 웹 검색 결과보다 먼저 첨부 context를 읽고, 특히 메뉴 도움말과 현재 화면 DOM 스냅샷을 우선 기준으로 삼으세요.

    사용자 질문: {user_query.strip()}

    {attachment_context}
    """

    grounding_tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(tools=[grounding_tool])

    client = _get_client(api_key)
    last_error: Exception | None = None

    for model in GEMINI_MODELS:
        for attempt in range(1, MAX_RETRIES_PER_MODEL + 1):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=[types.Part.from_text(text=prompt), *attachment_parts] if attachment_parts else prompt,
                    config=config,
                )

                return {
                    "answer": response.text or "",
                    "sources": _extract_sources(response),
                    "model": model,
                }
            except Exception as e:
                last_error = e

                if not _is_retryable_error(e) or attempt == MAX_RETRIES_PER_MODEL:
                    break

                time.sleep(RETRY_DELAY_SECONDS * attempt)

    raise RuntimeError(f"Gemini 모델 호출에 실패했습니다. 잠시 후 다시 시도해 주세요. 마지막 오류: {last_error}")


# 직접 실행 테스트가 필요하면 개인 API 키를 명시적으로 전달해서 호출하세요.
# 예전 방식처럼 서버 공용 GEMINI_API_KEY를 자동으로 읽지 않습니다.
# if __name__ == "__main__":
#     user_input = "오늘 주요 AI 뉴스 알려줘"
#     result = web_search_ai_assistant(user_input, "YOUR_PERSONAL_GEMINI_API_KEY")
#     print(result["answer"])
