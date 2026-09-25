"""SQL-backed result-family regressions, without Oracle or network access.

Only Oracle pagination/scalar/GROUPING SETS syntax is adapted. The production
node lookup, family predicates, joins, list queries and summary queries execute.
"""
import json
import re
import sqlite3
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import anly_work_service as service
from backend.tests.test_xai_sql_compatibility import schema_columns


class ResultCursor:
    def __init__(self, connection):
        self.connection = connection
        self.cursor = connection.db.cursor()
        self.rows = []
        self.description = []

    def execute(self, sql, params=None):
        self.connection.executed.append(sql)
        sql = sql.replace("DBMS_LOB.SUBSTR", "LOB_SUBSTR")
        sql = sql.replace("ROWNUM AS RN__", "ROW_NUMBER() OVER () AS RN__")
        sql = sql.replace("WHERE ROWNUM <= :endRow", "")
        sql = sql.replace("WHERE RN__ > :offset", "WHERE RN__ > :offset AND RN__ <= :endRow")
        sql = re.sub(r"WHERE ROWNUM = 1\s*;?\s*$", "LIMIT 1", sql)
        sql = re.sub(r"WHERE ROWNUM <= 12\s*;?\s*$", "LIMIT 12", sql)
        grouping = re.search(r"\s+GROUP BY GROUPING SETS[\s\S]*", sql)
        if grouping:
            base = sql[:grouping.start()]
            total = base.replace("GROUPING(CONDITION_COUNT)", "1")
            total = re.sub(r"(?m)^(\s*, )CONDITION_COUNT\s*$", r"\1NULL AS CONDITION_COUNT", total)
            self.cursor.execute(total, params or {})
            self.description = self.cursor.description
            self.rows = self.cursor.fetchall()
            self.cursor.execute(base.replace("GROUPING(CONDITION_COUNT)", "0") + " GROUP BY CONDITION_COUNT", params or {})
            self.rows += self.cursor.fetchall()
            return
        self.cursor.execute(sql, params or {})
        self.description = self.cursor.description
        self.rows = self.cursor.fetchall()

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows

    def close(self):
        self.cursor.close()


class ResultConnection:
    def __init__(self, db):
        self.db = db
        self.executed = []
        self.closed = False

    def cursor(self):
        return ResultCursor(self)

    def close(self):
        self.closed = True


class UnifiedResultScopeTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.create_function("NVL", 2, lambda value, default: default if value is None else value)
        self.db.create_function("LEAST", 2, min)
        self.db.create_function("GREATEST", 2, max)
        self.db.create_function("TO_CLOB", 1, lambda value: value)
        self.db.create_function("LOB_SUBSTR", 3, lambda value, length, start: str(value)[start - 1:start - 1 + length] if value is not None else None)
        schemas = schema_columns()
        tables = {"INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEVIOL_ASSOC", "INIT$_TB_PROJECT",
                  "INIT$_TB_FLOW_WORK_NODE_RUN", "INIT$_TB_FLOW_WORK_RUN", "INIT$_TB_FLOW_WORK",
                  "INIT$_TB_FLOW_WORK_NODE", "INIT$_TB_DATA_WORK_JOB"}
        self.db.executescript("CREATE TABLE ALL_TAB_COLUMNS (OWNER, TABLE_NAME, COLUMN_NAME, COLUMN_ID); CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS);")
        for table in tables:
            self.db.execute(f'CREATE TABLE "{table}" (' + ", ".join(f'"{name}"' for name in schemas[table]) + ")")
            self.db.executemany("INSERT INTO ALL_TAB_COLUMNS VALUES ('MAIN', ?, ?, ?)",
                                [(table, name, index) for index, name in enumerate(schemas[table])])
        self.insert("INIT$_TB_PROJECT", PROJECT_ID=1, USER_ID=7)
        self.insert("INIT$_TB_FLOW_WORK", FLOW_ID=1, PROJECT_ID=1, MENU_CODE="M04001")
        self.insert("INIT$_TB_FLOW_WORK_RUN", FLOW_RUN_ID=41, FLOW_ID=1)
        self.insert("INIT$_TB_FLOW_WORK_NODE", FLOW_ID=1, NODE_KEY="detect", REF_WORK_JOB_ID=1, REF_MENU_CODE="M03004")
        self.insert("INIT$_TB_DATA_WORK_JOB", WORK_JOB_ID=1, EXEC_OBJECT_NAME="CUSTOM_UNIFIED_ALIAS")
        self.insert("INIT$_TB_FLOW_WORK_NODE_RUN", FLOW_NODE_RUN_ID=1, FLOW_RUN_ID=41, FLOW_ID=1, NODE_KEY="detect",
                    NODE_PAYLOAD_JSON=json.dumps({"execMethod": "UNIFIED_EDITING_DETECT", "targetOwner": "DATA", "targetTable": "SOURCE"}),
                    RUNTIME_PARAM_JSON="{}", RUN_OUTPUT_JSON="{}")
        self.connection = ResultConnection(self.db)

    def insert(self, table, **values):
        self.db.execute(f'INSERT INTO "{table}" (' + ",".join(values) + ") VALUES (" + ",".join("?" for _ in values) + ")", tuple(values.values()))

    def seed_rule(self, rule_id, source="MIXED_PATTERN_TREE", kind="VALUE", model="SHARED_MODEL", **scope):
        values = dict(RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, OWNER="MAIN", TARGET_OWNER="DATA", TARGET_TABLE="SOURCE",
                      MODEL_NAME=model, RULE_ID=rule_id, RULE_SOURCE=source, MODEL_TYPE=source, RESULT_KIND=kind,
                      CONDITION_COUNT=1, CONDITION_TEXT="X=A", RESULT_COLUMN="Y", RESULT_VALUE="B", RESULT_HAS_VALUE_YN="Y",
                      RULE_CONFIDENCE=.9, RULE_SUPPORT=.4, RULE_LIFT=1.5)
        values.update(scope)
        self.insert("INIT$_TB_RULEDISC_ASSOC_SUM", **values)
        self.insert("INIT$_TB_RULEVIOL_ASSOC", **{key: values[key] for key in ("RUN_SOURCE_TYPE", "RUN_ID", "TARGET_OWNER", "TARGET_TABLE", "MODEL_NAME", "RULE_ID", "CONDITION_COUNT", "RESULT_COLUMN", "RULE_CONFIDENCE")},
                    RULE_OWNER=values["OWNER"], CASE_ID=rule_id, VIOLATION_ID=self.db.total_changes, VIOLATION_SCORE=.5)

    def result(self, table, **options):
        with patch.object(service, "get_target_db_connection", return_value=self.connection), \
             patch.object(service, "get_request_user_id", return_value=7), \
             patch.object(service, "get_request_role_code", return_value="USER"):
            result = service.get_result_table(object(), owner="MAIN", objectName=table,
                                             targetOwner="DATA", targetTable="SOURCE", flowRunId=41, **options)
        self.assertTrue(self.connection.closed)
        return result

    def test_no_oml_rules_means_empty_categorical_list_and_summary(self):
        self.seed_rule("MIXED_VALUE")
        self.seed_rule("MIXED_FORMULA", kind="FORMULA")
        result = self.result("INIT$_TB_RULEVIOL_ASSOC")
        self.assertEqual(result["data"], [])
        self.assertEqual(result["violationSummary"]["overview"]["VIOLATION_COUNT"], 0)
        self.assertEqual(result["violationSummary"]["topRules"], [])
        self.assertEqual(self.result("INIT$_TB_RULEDISC_ASSOC_SUM")["data"], [])

    def test_same_model_name_keeps_lists_and_all_summary_counts_separate(self):
        self.seed_rule("OML", source="DBMS_DATA_MINING", kind=None)
        self.seed_rule("MIXED_VALUE")
        self.seed_rule("MIXED_FORMULA", kind="FORMULA")
        self.seed_rule("OTHER_FORMULA", source="OTHER", kind="FORMULA")
        self.seed_rule("OTHER_TARGET", source="DBMS_DATA_MINING", kind=None, TARGET_TABLE="OTHER")
        self.seed_rule("OTHER_RUN", source="DBMS_DATA_MINING", kind=None, RUN_ID=42)
        result = self.result("INIT$_TB_RULEVIOL_ASSOC", ruleModelName="SHARED_MODEL", balancedRuleSummaryYn="Y")
        self.assertEqual({row["RULE_ID"] for row in result["data"]}, {"OML"})
        summary = result["violationSummary"]
        self.assertEqual(summary["overview"]["VIOLATION_COUNT"], 1)
        self.assertEqual(summary["candidateOverview"]["TOTAL_RULES"], 1)
        self.assertEqual(summary["detectionOverview"]["CANDIDATE_RULE_COUNT"], 1)
        self.assertEqual({row["RULE_ID"] for row in summary["topRules"]}, {"OML"})
        self.assertEqual({row["RULE_ID"] for row in summary["balancedTopRules"]}, {"OML"})
        self.assertEqual({row["RULE_ID"] for row in self.result("INIT$_TB_RULEDISC_ASSOC_SUM", ruleModelName="SHARED_MODEL")["data"]}, {"OML"})

    def test_selected_model_and_wrong_owner_do_not_broaden_violation_join(self):
        self.seed_rule("OML1", source="DBMS_DATA_MINING", kind=None, model="MODEL_1")
        self.seed_rule("OML2", source="DBMS_DATA_MINING", kind=None, model="MODEL_2")
        self.db.execute('UPDATE "INIT$_TB_RULEVIOL_ASSOC" SET RULE_OWNER = ? WHERE RULE_ID = ?', ("OTHER", "OML1"))
        self.assertEqual(self.result("INIT$_TB_RULEVIOL_ASSOC", ruleModelName="MODEL_1")["data"], [])
        self.assertEqual({row["RULE_ID"] for row in self.result("INIT$_TB_RULEDISC_ASSOC_SUM", ruleModelName="MODEL_2")["data"]}, {"OML2"})

    def test_standalone_mixed_and_legacy_models_keep_existing_table_behavior(self):
        self.seed_rule("MIXED_VALUE")
        for method in ("MIXED_XAI_RULE_DETECT", "INTEGRATED_RULE_VIOLATION_DETECT"):
            with self.subTest(method=method):
                self.db.execute('UPDATE "INIT$_TB_FLOW_WORK_NODE_RUN" SET NODE_PAYLOAD_JSON = ?',
                                (json.dumps({"execMethod": method, "targetOwner": "DATA", "targetTable": "SOURCE"}),))
                result = self.result("INIT$_TB_RULEVIOL_ASSOC", ruleModelName="SHARED_MODEL")
                self.assertEqual({row["RULE_ID"] for row in result["data"]}, {"MIXED_VALUE"})

    def test_other_target_unified_node_does_not_change_current_target(self):
        self.seed_rule("MIXED_VALUE")
        self.db.execute('UPDATE "INIT$_TB_FLOW_WORK_NODE_RUN" SET NODE_PAYLOAD_JSON = ?',
                        (json.dumps({"execMethod": "UNIFIED_EDITING_DETECT", "targetOwner": "DATA", "targetTable": "OTHER"}),))
        result = self.result("INIT$_TB_RULEVIOL_ASSOC", ruleModelName="SHARED_MODEL")
        self.assertEqual({row["RULE_ID"] for row in result["data"]}, {"MIXED_VALUE"})

    def test_inaccessible_run_does_not_fall_back_to_unscoped_shared_tables(self):
        self.seed_rule("MIXED_VALUE")
        self.db.execute('UPDATE "INIT$_TB_PROJECT" SET USER_ID = 8')
        with self.assertRaises(HTTPException) as error:
            self.result("INIT$_TB_RULEVIOL_ASSOC")
        self.assertEqual(error.exception.status_code, 404)
        self.assertFalse(any('SELECT * FROM "MAIN"."INIT$_TB_RULEVIOL_ASSOC"' in sql for sql in self.connection.executed))

    def test_dedicated_mixed_query_keeps_both_value_and_formula(self):
        self.seed_rule("OML", source="DBMS_DATA_MINING", kind=None)
        self.seed_rule("MIXED_VALUE")
        self.seed_rule("MIXED_FORMULA", kind="FORMULA")
        cursor = self.db.execute(SqlLoader.get_sql("PATTERN_FLOW_RULES"), {"runId": 41, "owner": "DATA", "tableName": "SOURCE"})
        names = [column[0] for column in cursor.description]
        self.assertEqual({dict(zip(names, row))["RULE_ID"] for row in cursor.fetchall()}, {"MIXED_VALUE", "MIXED_FORMULA"})
