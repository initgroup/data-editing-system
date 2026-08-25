from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from backend.database_helper import SqlLoader
from backend.routers import M90001


ROOT_DIR = Path(__file__).resolve().parents[2]


class M90001DetailOptimizationTests(unittest.TestCase):
    def test_saved_detail_queries_use_existing_owner_object_index_prefix(self):
        metadata_sql = SqlLoader.get_sql("M90001_OBJECT_META").upper()
        detail_sql = SqlLoader.get_sql("M90001_OBJECT_DETAIL").upper()

        for sql in (metadata_sql, detail_sql):
            self.assertIn("OWNER = :OWNER", sql)
            self.assertIn("OBJECT_TYPE = :OBJECTTYPE", sql)
            self.assertIn("OBJECT_NAME = :OBJECTNAME", sql)
        saved_cte = detail_sql.split("WITH SAVED AS (", 1)[1].split("),\nDICTIONARY_ROWS", 1)[0]
        self.assertNotIn(":OBJECTID IS NOT NULL", saved_cte)
        self.assertNotIn(" OR ", saved_cte)

    def test_source_used_for_default_parsing_is_returned_for_ui_reuse(self):
        rows = [{
            "ITEM_NAME": "P_LIMIT",
            "ITEM_DEFAULT": None,
            "DETAIL_SOURCE": "DICTIONARY",
        }]
        source = "CREATE OR REPLACE PROCEDURE P_TEST(P_LIMIT IN NUMBER DEFAULT 10) IS BEGIN NULL; END;"
        params = {
            "owner": "INIT$EDIT01",
            "objectType": "PROCEDURE",
            "objectName": "P_TEST",
        }

        with patch.object(M90001, "fetch_argument_defaults", return_value={}) as fetch_defaults, \
                patch.object(M90001, "fetch_object_source", return_value=source) as fetch_source:
            source_included, returned_source = M90001.enrich_argument_defaults(Mock(), rows, params)

        self.assertTrue(source_included)
        self.assertEqual(source, returned_source)
        self.assertEqual("10", rows[0]["ITEM_DEFAULT"])
        fetch_defaults.assert_called_once()
        fetch_source.assert_called_once()

    def test_dictionary_default_query_skips_source_query_when_defaults_exist(self):
        rows = [{
            "ITEM_NAME": "P_LIMIT",
            "ITEM_DEFAULT": None,
            "DETAIL_SOURCE": "DICTIONARY",
        }]
        params = {
            "owner": "INIT$EDIT01",
            "objectType": "PROCEDURE",
            "objectName": "P_TEST",
        }

        with patch.object(M90001, "fetch_argument_defaults", return_value={"P_LIMIT": "20"}) as fetch_defaults, \
                patch.object(M90001, "fetch_object_source") as fetch_source:
            source_included, returned_source = M90001.enrich_argument_defaults(Mock(), rows, params)

        self.assertFalse(source_included)
        self.assertEqual("", returned_source)
        self.assertEqual("20", rows[0]["ITEM_DEFAULT"])
        fetch_defaults.assert_called_once()
        fetch_source.assert_not_called()

    def test_detail_panel_has_loading_bar_and_stale_response_guard(self):
        page = (ROOT_DIR / "frontend" / "pages" / "M90001.html").read_text(encoding="utf-8")
        script = (ROOT_DIR / "frontend" / "js" / "M90001.js").read_text(encoding="utf-8")
        styles = (ROOT_DIR / "frontend" / "css" / "pages" / "M90001.css").read_text(encoding="utf-8")

        self.assertIn('id="objectDetailLoading-M90001"', page)
        self.assertIn('class="env-detail-loading-bar"', page)
        self.assertIn("if (this.objectDetailLoadingKey === loadingKey) return;", script)
        self.assertIn("if (detailRequestSeq !== this.objectDetailRequestSeq) return;", script)
        self.assertIn("if (json.sourceIncluded)", script)
        self.assertIn(".env-detail-loading-bar i", styles)
        self.assertIn(".env-panel.is-detail-loading", styles)


if __name__ == "__main__":
    unittest.main()
