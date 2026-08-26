import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend.routers import home


ROOT_DIR = Path(__file__).resolve().parents[2]
HELP_PAGE_PATH = ROOT_DIR / "frontend" / "help" / "page.html"
SYSTEM_GUIDE_PATH = ROOT_DIR / "frontend" / "help" / "in-deps-system-guide.html"
SYSTEM_GUIDE_PDF_PATH = ROOT_DIR / "frontend" / "help" / "IN-DEPS_Product_Introduction_KR_v1.0.pdf"


class SystemGuideDownloadTests(unittest.TestCase):
    def test_help_download_controls_have_visible_labels(self):
        help_page = HELP_PAGE_PATH.read_text(encoding="utf-8")

        self.assertIn('id="inDepsGuideLabel"', help_page)
        self.assertIn('id="inDepsGuideDescription"', help_page)
        self.assertIn('id="inDepsGuidePreviewLabel"', help_page)
        self.assertIn('id="inDepsGuideDownloadPdfLabel"', help_page)
        self.assertIn('label: "시스템 소개서"', help_page)
        self.assertIn('description: "전체 플랫폼 안내서"', help_page)
        self.assertIn('preview: "미리보기"', help_page)
        self.assertIn('downloadPdf: "PDF 내려받기"', help_page)
        self.assertNotIn('id="inDepsGuideDownloadHtmlLabel"', help_page)
        self.assertNotIn('downloadHtml:', help_page)
        self.assertNotIn('id="inDepsGuideButton"', help_page)
        self.assertNotIn('id="inDepsGuideMenu"', help_page)

    def test_preview_opens_inline_with_embedded_images(self):
        request = Mock()

        with patch.object(home, "get_request_user_id", return_value=7) as require_user:
            response = home.preview_system_guide(request)

        require_user.assert_called_once_with(request)
        self.assertEqual("text/html; charset=utf-8", response.media_type)
        self.assertEqual("inline", response.headers["content-disposition"])
        self.assertEqual(3, response.body.count(b'data:image/png;base64,'))
        self.assertNotIn(b'../assets/indeps_compact_bilingual.png', response.body)
        self.assertNotIn(b'../assets/init-logo.png', response.body)

    def test_preview_source_expands_tabs_for_print_and_keeps_all_menu_cards(self):
        guide = SYSTEM_GUIDE_PATH.read_text(encoding="utf-8")

        self.assertEqual(2, guide.count('src="../assets/indeps_compact_bilingual.png"'))
        self.assertEqual(1, guide.count('src="../assets/init-logo.png"'))
        self.assertIn("white-space: nowrap;", guide)
        self.assertIn(".tab-list { display: none; }", guide)
        self.assertIn(".tab-panel { display: block !important;", guide)
        self.assertEqual(7, guide.count('role="tabpanel"'))
        self.assertEqual(24, guide.count('<article class="menu-card"'))
        self.assertNotIn("const menuItems =", guide)

    def test_pdf_download_returns_the_replaced_product_introduction_file(self):
        request = Mock()

        with patch.object(home, "get_request_user_id", return_value=7) as require_user:
            response = home.download_system_guide(request)

        require_user.assert_called_once_with(request)
        self.assertEqual(SYSTEM_GUIDE_PDF_PATH.read_bytes(), response.body)
        self.assertEqual("application/pdf", response.media_type)
        self.assertIn("IN-DEPS_Product_Introduction_KR_v1.0.pdf", response.headers["content-disposition"])
        self.assertIn("filename*=UTF-8''", response.headers["content-disposition"])
        self.assertEqual("private, no-store", response.headers["cache-control"])


if __name__ == "__main__":
    unittest.main()
