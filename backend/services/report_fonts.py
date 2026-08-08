from __future__ import annotations

import base64
import logging
import re
from functools import lru_cache
from pathlib import Path


logger = logging.getLogger(__name__)

REPORT_FONT_FAMILY = "IN-DEPS Noto Sans KR"
_ROOT_DIR = Path(__file__).resolve().parents[2]
_FONT_PACKAGE_DIR = _ROOT_DIR / "node_modules" / "@fontsource-variable" / "noto-sans-kr"
_FONT_CSS_FILE = _FONT_PACKAGE_DIR / "index.css"
_FONT_URL_PATTERN = re.compile(r"url\(\./files/([^)]+\.woff2)\)")


@lru_cache(maxsize=1)
def embedded_korean_font_css() -> str:
    """Return the bundled Korean webfont as self-contained data URLs for Chromium PDF output."""
    if not _FONT_CSS_FILE.is_file():
        logger.error("Bundled Korean report font is missing. Run npm ci before starting the service.")
        return ""

    css = _FONT_CSS_FILE.read_text(encoding="utf-8")
    encoded_files: dict[str, str] = {}

    def replace_font_url(match: re.Match[str]) -> str:
        file_name = match.group(1)
        if file_name not in encoded_files:
            font_file = _FONT_PACKAGE_DIR / "files" / file_name
            if not font_file.is_file():
                logger.error("Bundled Korean report font segment is missing: %s", file_name)
                return "url()"
            encoded_files[file_name] = base64.b64encode(font_file.read_bytes()).decode("ascii")
        return f"url(data:font/woff2;base64,{encoded_files[file_name]})"

    css = _FONT_URL_PATTERN.sub(replace_font_url, css)
    css = css.replace("'Noto Sans KR Variable'", f"'{REPORT_FONT_FAMILY}'")
    css = css.replace("font-display: swap", "font-display: block")
    return css
