"""Exercise new deletion predicates against an in-memory database; never connect to Oracle."""
import re
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TABLES = ("INIT$_TB_RULEVIOL_XAI", "INIT$_TB_RULEDISC_XAI", "INIT$_TB_XAI_RUN")
SQL = (ROOT / "database/admin_scope_purge.sql").read_text(encoding="utf-8")


def section(sql_id):
    return SQL.split(f"-- [{sql_id}]", 1)[1].split("-- [", 1)[0]


def execute_optional_xai_cleanup(conn, sql_id, binds):
    block = section(sql_id)
    catalog_query = re.search(r"FOR xai_table IN\s*\((.*?)\) LOOP", block, re.S).group(1)
    template = re.search(r"v_xai_sql := q'~(.*?)~';", block, re.S).group(1)
    visited = []
    for (table_name,) in conn.execute(catalog_query).fetchall():
        # Oracle's DELETE alias syntax differs from SQLite. Predicates and binds are unchanged.
        statement = template.replace("/*XAI_TABLE*/ T", f'"{table_name}"').replace("T.", "")
        conn.execute(statement, {str(index): value for index, value in enumerate(binds, start=1)})
        visited.append(table_name)
    return visited


class MixedXaiLifecycleSqlTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE VIEW USER_TABLES AS SELECT name AS TABLE_NAME FROM sqlite_master WHERE type = 'table';
            CREATE TABLE INIT$_TB_DATA_WORK_JOB (WORK_JOB_ID, PROJECT_ID, SCENARIO_ID);
            CREATE TABLE INIT$_TB_DATA_WORK_RUN (DATA_RUN_ID, WORK_JOB_ID);
            CREATE TABLE INIT$_TB_FLOW_WORK (FLOW_ID, PROJECT_ID, SCENARIO_ID);
            CREATE TABLE INIT$_TB_FLOW_WORK_RUN (FLOW_RUN_ID, FLOW_ID);
            INSERT INTO INIT$_TB_DATA_WORK_JOB VALUES (1, 10, 20), (2, 10, 21), (3, 11, 20);
            INSERT INTO INIT$_TB_DATA_WORK_RUN VALUES (100, 1), (101, 2), (200, 3);
            INSERT INTO INIT$_TB_FLOW_WORK VALUES (1, 10, 20), (2, 10, 21), (3, 11, 20);
            INSERT INTO INIT$_TB_FLOW_WORK_RUN VALUES (100, 1), (101, 2), (200, 3);
        """)

    def install(self, tables=TABLES):
        for table in tables:
            self.conn.execute(f'CREATE TABLE "{table}" (RUN_SOURCE_TYPE, RUN_ID, TARGET_OWNER, TARGET_TABLE)')
            self.conn.executemany(f'INSERT INTO "{table}" VALUES (?, ?, ?, ?)', [
                (source, run_id, "OWNER_A", "SOURCE_A")
                for source in ("DATA_WORK", "FLOW_WORK", "OTHER")
                for run_id in (100, 101, 200)
            ])

    def test_missing_optional_schema_does_not_block_legacy_purge(self):
        self.assertEqual(execute_optional_xai_cleanup(self.conn, "ADMIN_PURGE_RUN_RESULTS_DELETE", (10, 20, 20, 10, 20, 20)), [])
        self.assertEqual(execute_optional_xai_cleanup(self.conn, "ADMIN_PURGE_MANAGED_OBJECT_DATA_DELETE", ("OWNER_A", "SOURCE_A")), [])

    def test_scenario_purge_retains_other_scenarios_projects_and_run_sources(self):
        self.install()
        visited = execute_optional_xai_cleanup(self.conn, "ADMIN_PURGE_RUN_RESULTS_DELETE", (10, 20, 20, 10, 20, 20))
        self.assertEqual(tuple(visited), TABLES)
        for table in TABLES:
            remaining = set(self.conn.execute(f'SELECT RUN_SOURCE_TYPE, RUN_ID FROM "{table}"'))
            self.assertNotIn(("DATA_WORK", 100), remaining)
            self.assertNotIn(("FLOW_WORK", 100), remaining)
            self.assertIn(("DATA_WORK", 101), remaining)
            self.assertIn(("FLOW_WORK", 200), remaining)
            self.assertIn(("OTHER", 100), remaining)
            self.assertEqual(len(remaining), 7)

    def test_project_purge_removes_all_its_scenarios_from_partially_installed_schema(self):
        self.install(TABLES[:1])
        self.assertEqual(execute_optional_xai_cleanup(self.conn, "ADMIN_PURGE_RUN_RESULTS_DELETE", (10, None, None, 10, None, None)), [TABLES[0]])
        remaining = set(self.conn.execute(f'SELECT RUN_SOURCE_TYPE, RUN_ID FROM "{TABLES[0]}"'))
        self.assertEqual(remaining, {("DATA_WORK", 200), ("FLOW_WORK", 200), ("OTHER", 100), ("OTHER", 101), ("OTHER", 200)})

    def test_managed_object_cleanup_matches_both_owner_and_table(self):
        self.install()
        for table in TABLES:
            self.conn.execute(f'INSERT INTO "{table}" VALUES (\'FLOW_WORK\', 900, \'OWNER_B\', \'SOURCE_A\')')
            self.conn.execute(f'INSERT INTO "{table}" VALUES (\'FLOW_WORK\', 901, \'OWNER_A\', \'SOURCE_B\')')
        execute_optional_xai_cleanup(self.conn, "ADMIN_PURGE_MANAGED_OBJECT_DATA_DELETE", ("OWNER_A", "SOURCE_A"))
        for table in TABLES:
            self.assertEqual(set(self.conn.execute(f'SELECT RUN_ID FROM "{table}"')), {(900,), (901,)})

    def test_single_flow_run_cleanup_includes_xai_before_run_metadata(self):
        sql = (ROOT / "database/MCOM_ANLY_WORK.sql").read_text(encoding="utf-8")
        block = sql.split("-- [MCOMMON_ANLY_WORK_FLOW_RUN_DELETE_BLOCK]", 1)[1].split("-- [", 1)[0]
        positions = [block.index(f"delete_run_result_table('{table}')") for table in TABLES]
        self.assertEqual(positions, sorted(positions))
        self.assertLess(positions[-1], block.index('DELETE FROM "INIT$_TB_FLOW_WORK_NODE_RUN"'))
        self.assertIn("IF v_exists = 2 THEN", block)
        self.assertIn("USING 'FLOW_WORK', v_flow_run_id", block)


if __name__ == "__main__":
    unittest.main()
