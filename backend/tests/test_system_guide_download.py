import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend.routers import home


ROOT_DIR = Path(__file__).resolve().parents[2]
HELP_PAGE_PATH = ROOT_DIR / "frontend" / "help" / "page.html"
SYSTEM_GUIDE_PATH = ROOT_DIR / "frontend" / "help" / "in-deps-system-guide.html"


class SystemGuideDownloadTests(unittest.TestCase):
    def test_help_download_controls_have_visible_labels(self):
        help_page = HELP_PAGE_PATH.read_text(encoding="utf-8")

        self.assertIn('id="inDepsGuideLabel"', help_page)
        self.assertIn('id="inDepsGuideDownloadHtmlLabel"', help_page)
        self.assertIn('id="inDepsGuideDownloadPdfLabel"', help_page)
        self.assertIn('label: "시스템 소개서 파일 다운로드"', help_page)
        self.assertIn('downloadHtml: "내려받기(HTML)"', help_page)
        self.assertIn('downloadPdf: "내려받기(PDF)"', help_page)
        self.assertNotIn('id="inDepsGuideButton"', help_page)
        self.assertNotIn('id="inDepsGuideMenu"', help_page)

    def test_pdf_layout_expands_tabs_and_keeps_all_menu_cards_without_javascript(self):
        guide = SYSTEM_GUIDE_PATH.read_text(encoding="utf-8")

        self.assertIn(".tab-list { display: none; }", guide)
        self.assertIn(".tab-panel { display: block !important;", guide)
        self.assertEqual(7, guide.count('role="tabpanel"'))
        self.assertEqual(24, guide.count('<article class="menu-card"'))
        self.assertNotIn("const menuItems =", guide)

    def test_html_download_returns_the_exact_system_guide_source(self):
        request = Mock()

        with patch.object(home, "get_request_user_id", return_value=7) as require_user:
            response = home.download_system_guide(request, "html")

        require_user.assert_called_once_with(request)
        self.assertEqual(SYSTEM_GUIDE_PATH.read_bytes(), response.body)
        self.assertEqual("text/html; charset=utf-8", response.media_type)
        self.assertIn("IN-DEPS_System_Introduction.html", response.headers["content-disposition"])
        self.assertIn("filename*=UTF-8''", response.headers["content-disposition"])
        self.assertEqual("private, no-store", response.headers["cache-control"])

    def test_pdf_download_uses_the_existing_report_renderer_and_embedded_font(self):
        request = Mock()
        pdf_bytes = b"%PDF-1.7\nqa"

        with (
            patch.object(home, "get_request_user_id", return_value=7),
            patch.object(home, "embedded_korean_font_css", return_value="@font-face { font-family: 'QA'; }"),
            patch.object(home, "render_report_pdf", return_value=pdf_bytes) as render_pdf,
        ):
            response = home.download_system_guide(request, "pdf")

        self.assertEqual(pdf_bytes, response.body)
        self.assertEqual("application/pdf", response.media_type)
        self.assertIn("IN-DEPS_System_Introduction.pdf", response.headers["content-disposition"])
        render_pdf.assert_called_once()
        rendered_html = render_pdf.call_args.args[0].decode("utf-8")
        self.assertIn("@font-face { font-family: 'QA'; }", rendered_html)
        self.assertIn(".tab-panel { display: block !important;", rendered_html)
        self.assertEqual(24, rendered_html.count('<article class="menu-card"'))
        self.assertTrue(render_pdf.call_args.kwargs["batch"])


if __name__ == "__main__":
    unittest.main()
