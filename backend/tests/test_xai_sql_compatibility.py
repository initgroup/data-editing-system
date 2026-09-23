"""Resolve changed SQL against DDL-derived schemas without connecting to Oracle.

SQLite checks actual query scopes/columns and executes history predicates. Only
Oracle JSON_TABLE/scalar syntax is adapted; FROM/JOIN/CTE scopes stay unchanged.
This does not replace Oracle execution-plan or PL/SQL compilation checks.
"""
import json
import re
import sqlite3
import unittest
from pathlib import Path

from backend.database_helper import SqlLoader


ROOT = Path(__file__).resolve().parents[2]
HISTORY_IDS = ("FLOW_WORK_QUICK_EDIT_HISTORY_LIST", "FLOW_WORK_QUICK_EDIT_HISTORY")
FLOW_IDS = ("FLOW_WORK_LIST", "FLOW_WORK_DETAIL", "FLOW_WORK_INSERT", "FLOW_WORK_UPDATE", "FLOW_WORK_NODE_RUN_HISTORY_LIST")


def schema_columns():
    ddl = (ROOT / "database/INIT_TARGET_DDL.sql").read_text(encoding="utf-8")
    tables = {}
    for match in re.finditer(r'CREATE TABLE\s+"?(INIT\$_\w+)"?\s*\((.*?)^\)', ddl, re.S | re.M):
        columns = re.findall(
            r'^\s*,?\s*"?([A-Z][A-Z0-9_$]*)"?\s+(?:NUMBER|VARCHAR2|NVARCHAR2|CHAR|NCHAR|CLOB|BLOB|TIMESTAMP|DATE|FLOAT)\b',
            match[2], re.M,
        )
        tables[match[1]] = columns
    return tables


def sqlite_statement(sql):
    # JSON_TABLE produces one quickEditSummary row. Preserve its field paths
    # using json_extract while leaving all surrounding query scopes intact.
    match = re.search(r"LEFT JOIN JSON_TABLE\((.*?)\) QS\s+ON 1=1", sql, re.S)
    if match:
        source = match[1].split(",", 1)[0].strip()
        fields = re.findall(r"(\w+)\s+(?:VARCHAR2\(\d+\)|NUMBER)\s+PATH '\$\.(\w+)'", match[1])
        sql = sql[:match.start()] + sql[match.end():]
        for column, field in fields:
            expression = f"CASE WHEN json_valid({source}) THEN json_extract({source}, '$.quickEditSummary.{field}') END"
            # Bare selected JSON_TABLE columns must retain their output names.
            sql = re.sub(rf"(?m)^(\s*, )QS\.{column}\s*$", rf"\g<1>{expression} AS {column}", sql)
            sql = re.sub(rf"\bQS\.{column}\b", expression, sql)
    sql = sql.replace("DBMS_LOB.INSTR", "INSTR").replace("SYSTIMESTAMP", "CURRENT_TIMESTAMP")
    sql = re.sub(r"FETCH FIRST (\d+) ROWS ONLY", r"LIMIT \1", sql)
    return sql


class XaiSqlCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.row_factory = sqlite3.Row
        self.conn.create_function("NVL", 2, lambda value, default: default if value is None else value)
        tables = schema_columns()
        sqls = [SqlLoader.get_sql(key) for key in HISTORY_IDS]
        sqls += [sql for key, sql in SqlLoader._query_map.items() if key.startswith(("XAI_", "PATTERN_"))]
        sqls += [SqlLoader.get_sql(key) for key in FLOW_IDS]
        referenced = set(re.findall(r"\bINIT\$_[A-Z0-9_]+", "\n".join(sqls)))
        # Result-table names inside schema-check literals are included as well.
        for table in sorted(referenced):
            self.assertIn(table, tables, f"Referenced table missing from INIT_TARGET_DDL: {table}")
            columns = ", ".join(f'"{column}"' for column in tables[table])
            self.conn.execute(f'CREATE TABLE "{table}" ({columns})')
        self.conn.executescript("""
            CREATE TABLE ALL_TABLES (OWNER, TABLE_NAME, NUM_ROWS);
            CREATE TABLE ALL_TAB_COLS (OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, HIDDEN_COLUMN, COLUMN_ID);
            CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS);
            CREATE VIEW USER_TABLES AS SELECT name AS TABLE_NAME FROM sqlite_master WHERE type = 'table';
            CREATE TABLE USER_TAB_COLUMNS (TABLE_NAME, COLUMN_NAME);
            CREATE TABLE SOURCE_TEST (VALUE, KIND);
        """)
        self.conn.create_function("ROWIDTOCHAR", 1, lambda value: str(value))

    def insert(self, table, **row):
        columns = ", ".join(row)
        binds = ", ".join("?" for _ in row)
        self.conn.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({binds})', tuple(row.values()))

    def seed_history(self):
        for project, user, code in [(10, 7, "QE_NEW"), (11, 8, "QE_OTHER"), (12, 7, "QEDIT_OLD")]:
            self.insert("INIT$_TB_PROJECT", PROJECT_ID=project, USER_ID=user, PROJECT_CODE=code, PROJECT_NAME=code)
            self.insert("INIT$_TB_SCENARIO", PROJECT_ID=project, SCENARIO_ID=project, SCENARIO_CODE="RULE", SCENARIO_NAME="Test")
            self.insert("INIT$_TB_TABLES", PROJECT_ID=project, SCENARIO_ID=project, SCENARIO_TABLE_ID=project,
                        OWNER_NAME="OWNER", TABLE_NAME=f"SOURCE_{project}")
        for run, project, flow_type, run_type in [(100, 10, "INTEGRATED_EDITING_SCENARIO", "QUICK_EDIT"),
                                                 (101, 10, "MIXED_XAI_SCENARIO", "QUICK_EDIT"),
                                                 (102, 11, "MIXED_XAI_SCENARIO", "QUICK_EDIT"),
                                                 (103, 12, None, "MANUAL")]:
            self.insert("INIT$_TB_FLOW_WORK", FLOW_ID=run, PROJECT_ID=project, SCENARIO_ID=project,
                        MENU_CODE="M04001", FLOW_TYPE=flow_type, FLOW_NAME=f"FLOW {run}")
            plan = {"quickEditSummary": {"ownerName": "OWNER", "tableName": f"SOURCE_{project}", "jobCount": 2,
                                          "fileName": "sample.csv", "flowName": f"SAVED FLOW {run}"}}
            if run_type == "MANUAL":
                plan = {"runRequestToken": "old-token"}
            self.insert("INIT$_TB_FLOW_WORK_RUN", FLOW_RUN_ID=run, FLOW_ID=run, RUN_TYPE=run_type,
                        STATUS="SUCCESS", PLAN_JSON=json.dumps(plan), STARTED_AT=f"2026-09-23 00:00:{run - 100:02}")
            for node in range(2):
                self.insert("INIT$_TB_FLOW_WORK_NODE_RUN", FLOW_RUN_ID=run, STATUS="SUCCESS", NODE_KEY=str(node))
            self.insert("INIT$_TB_FLOW_WORK_NODE", FLOW_ID=run, REF_WORK_JOB_ID=run)
            self.insert("INIT$_TB_DATA_WORK_JOB", WORK_JOB_ID=run, SCENARIO_TABLE_ID=project)

    def history(self, sql_id, **overrides):
        params = dict(menuCode="M04001", flowRunId=None, userId=7, includeAllUsers="N", offset=0, endRow=20)
        params.update(overrides)
        return [dict(row) for row in self.conn.execute(sqlite_statement(SqlLoader.get_sql(sql_id)), params)]

    def test_both_history_queries_resolve_flow_type_and_preserve_counts(self):
        self.seed_history()
        for sql_id in HISTORY_IDS:
            with self.subTest(sql_id=sql_id):
                rows = self.history(sql_id)
                self.assertEqual([r["FLOW_RUN_ID"] for r in rows], [103, 101, 100])
                self.assertEqual([r["FLOW_TYPE"] for r in rows], [None, "MIXED_XAI_SCENARIO", "INTEGRATED_EDITING_SCENARIO"])
                self.assertTrue(all(r["TOTAL_COUNT"] == 3 and r["NODE_COUNT"] == 2 and r["SUCCESS_NODE_COUNT"] == 2 for r in rows))
                self.assertEqual(rows[1]["FILE_NAME"], "sample.csv")
                self.assertEqual(rows[1]["FLOW_NAME"], "SAVED FLOW 101")
                self.assertEqual(rows[0]["TABLE_NAME"], "SOURCE_12")

    def test_history_pagination_and_owner_admin_filters_apply_to_both_scenarios(self):
        self.seed_history()
        for sql_id in HISTORY_IDS:
            with self.subTest(sql_id=sql_id):
                self.assertEqual([r["FLOW_RUN_ID"] for r in self.history(sql_id, offset=1, endRow=2)], [101])
                self.assertEqual(self.history(sql_id, flowRunId=102), [])
                admin = self.history(sql_id, flowRunId=102, includeAllUsers="Y")
                self.assertEqual(len(admin), 1)
                self.assertEqual(admin[0]["FLOW_TYPE"], "MIXED_XAI_SCENARIO")
                self.assertEqual(len(self.history(sql_id, includeAllUsers="Y")), 4)

    def test_xai_and_flow_queries_resolve_columns_against_installation_ddl(self):
        queries = {key: sql for key, sql in SqlLoader._query_map.items() if key.startswith(("XAI_", "PATTERN_"))}
        queries.update({key: SqlLoader.get_sql(key) for key in FLOW_IDS})
        self.assertGreaterEqual(len(queries), 36)
        for sql_id, sql in queries.items():
            with self.subTest(sql_id=sql_id):
                sql = sqlite_statement(sql).replace("/*TARGET*/", "SOURCE_TEST")
                sql = sql.replace("/*COLUMNS*/", 'T."VALUE", T."KIND"')
                sql = sql.replace("/*EXPECTED*/", 'T."VALUE" * 2')
                sql = sql.replace("/*COUNTS*/", "SUM(CASE WHEN T.VALUE > :threshold THEN 1 ELSE 0 END)")
                sql = sql.replace("/*PREDICATE*/", "T.VALUE > :threshold").replace("/*CASE_ID*/", "T.ROWID")
                for placeholder, expression in {
                    "caseIdExpression": "T.SAMPLE_ROWID", "rowAlias": "SAMPLE_ROWID",
                    "sourceColumns": "Q.VALUE, Q.KIND", "targetObject": "SOURCE_TEST",
                    "actualRawExpression": "T.VALUE", "actualNumericExpression": "T.VALUE",
                    "formulaExpression": "T.VALUE * 2", "conditionExpression": "T.VALUE IS NOT NULL",
                    "resultExpression": "T.VALUE = 1", "inputProjection": "",
                }.items():
                    sql = sql.replace("{" + placeholder + "}", expression)
                sql = sql.replace("WHERE ROWNUM <= :scanLimit", "LIMIT :scanLimit")
                if "ROWNUM <= :rowLimit" in sql:
                    sql = sql.replace("ROWNUM <= :rowLimit", "1=1") + " LIMIT :rowLimit"
                binds = {key: 1 for key in re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql)}
                self.conn.execute("EXPLAIN " + sql, binds).fetchall()


if __name__ == "__main__":
    unittest.main()
