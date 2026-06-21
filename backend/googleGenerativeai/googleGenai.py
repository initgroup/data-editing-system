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


def web_search_ai_assistant(user_query: str, api_key: str) -> dict[str, Any]:
    if not user_query or not user_query.strip():
        raise ValueError("질문을 입력해 주세요.")

    prompt = f"""
    당신은 데이터 편집 시스템에 포함된 웹 검색 AI 도우미입니다.
    Google Search로 확인한 최신 정보를 바탕으로 한국어로 친절하고 정확하게 답변해 주세요.
    근거가 부족하면 확정적으로 말하지 말고, 확인이 필요한 부분을 알려 주세요.

    사용자 질문: {user_query.strip()}
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
                    contents=prompt,
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
