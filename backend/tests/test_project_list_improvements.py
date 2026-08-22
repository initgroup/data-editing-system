from pathlib import Path
import unittest

from backend.database_helper import SqlLoader
from backend.routers import M01001


ROOT_DIR = Path(__file__).resolve().parents[2]


class _ProjectNameCursor:
    def __init__(self, project_names):
        self.project_names = project_names
        self.executed = None

    def execute(self, sql, params):
        self.executed = (sql, params)

    def fetchall(self):
        return [(name,) for name in self.project_names]


class ProjectListImprovementTests(unittest.TestCase):
    def test_quick_project_name_uses_first_available_sequence(self):
        cursor = _ProjectNameCursor([
            "퀵 에디팅 · 경제활동인구조사",
            "퀵 에디팅 · 경제활동인구조사 (1)",
            "퀵 에디팅 · 경제활동인구조사 (3)",
        ])

        name = M01001._resolve_unique_project_name(
            cursor,
            7,
            "퀵 에디팅 · 경제활동인구조사",
        )

        self.assertEqual("퀵 에디팅 · 경제활동인구조사 (2)", name)
        self.assertEqual(7, cursor.executed[1]["userId"])

    def test_quick_project_name_suffix_stays_within_column_byte_limit(self):
        base_name = "가" * 66
        cursor = _ProjectNameCursor([base_name, f"{'가' * 65} (1)"])

        name = M01001._resolve_unique_project_name(cursor, 7, base_name)

        self.assertTrue(name.endswith(" (2)"))
        self.assertLessEqual(len(name.encode("utf-8")), 200)

    def test_uniqueness_query_is_user_scoped_and_escapes_like_patterns(self):
        sql = SqlLoader.get_sql("M01001_PROJECT_NAMES_FOR_UNIQUENESS")
        cursor = _ProjectNameCursor([])

        M01001._resolve_unique_project_name(cursor, 7, "이름_100%")

        self.assertIn("USER_ID = :userId", sql)
        self.assertIn("ESCAPE '\\'", sql)
        self.assertEqual("이름\\_100\\%%", cursor.executed[1]["projectNamePattern"])

    def test_quick_edit_enables_server_side_unique_project_names(self):
        api_client_js = (ROOT_DIR / "quick-edit" / "js" / "api-client.js").read_text(encoding="utf-8")
        self.assertIn("autoUniqueName: true", api_client_js)

    def test_project_menus_use_wider_lists_and_korean_time(self):
        css = (ROOT_DIR / "frontend" / "css" / "styleMenu.css").read_text(encoding="utf-8")
        common_js = (ROOT_DIR / "frontend" / "js" / "MCOM_DATA_WORK.js").read_text(encoding="utf-8")
        project_js = (ROOT_DIR / "frontend" / "js" / "M01001.js").read_text(encoding="utf-8")
        scenario_js = (ROOT_DIR / "frontend" / "js" / "M01002.js").read_text(encoding="utf-8")

        self.assertIn("#container-M01001 .env-workspace", css)
        self.assertIn("#container-M01002 .env-workspace", css)
        self.assertIn("grid-template-columns: minmax(420px, 38%) minmax(0, 1fr);", css)
        self.assertIn('timeZone: "Asia/Seoul"', common_js)
        self.assertEqual(1, project_js.count("this.formatKstDateTime(project.CREATED_AT)"))
        self.assertEqual(1, scenario_js.count("this.formatKstDateTime(project.CREATED_AT)"))
        self.assertEqual(1, scenario_js.count("this.formatKstDateTime(scenario.CREATED_AT)"))


if __name__ == "__main__":
    unittest.main()
