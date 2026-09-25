"""Execute production result filters/counts/pages using an offline SQL adapter."""
import json
import re
import sqlite3
import unittest

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import editing_result_service as service
from backend.services import mixed_xai_service as mixed
from backend.tests.test_xai_sql_compatibility import schema_columns


class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.cursor = conn.db.cursor()
        self.description = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()

    def execute(self, sql, params=None):
        self.conn.queries.append(sql)
        expected = set(re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql))
        if expected != set(params or {}):
            raise AssertionError(f"Oracle bind mismatch: expected {expected}; got {set(params or {})}")
        sql = sql.replace("SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')", "'APP_OWNER'")
        sql = sql.replace("CAST(NULL AS VARCHAR2(261))", "NULL")
        sql = re.sub(r"JSON_QUERY\(([^,]+), ('[^']+') RETURNING CLOB\)", r"JSON_EXTRACT(\1, \2)", sql)
        sql = sql.replace("JSON_VALUE(", "JSON_EXTRACT(")
        sql = re.sub(r"OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY", "LIMIT :pageSize OFFSET :offset", sql)
        sql = re.sub(r"FETCH FIRST (\d+) ROWS ONLY", r"LIMIT \1", sql)
        sql = re.sub(r"WHERE ROWNUM = 1\s*;?\s*$", "LIMIT 1", sql)
        self.cursor.execute(sql, params or {})
        self.description = self.cursor.description

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        rows = self.cursor.fetchall()
        names = {item[0] for item in self.description or []}
        if "CONDITION_JSON" in names or "EXPRESSION" in names:
            self.conn.rule_rows += len(rows)
        if "VIOLATION_ID" in names:
            self.conn.violation_rows += len(rows)
        return rows


class Connection:
    def __init__(self, db):
        self.db = db
        self.queries = []
        self.rule_rows = 0
        self.violation_rows = 0

    def cursor(self):
        return Cursor(self)


class EditingResultPagingTests(unittest.TestCase):
    def setUp(self):
        SqlLoader.reload_queries()
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.create_function("NVL", 2, lambda value, default: default if value is None else value)
        self.db.execute("CREATE TABLE DUAL (DUMMY TEXT)")
        self.db.execute("INSERT INTO DUAL VALUES ('X')")
        self.db.execute("CREATE TABLE USER_TABLES (TABLE_NAME TEXT)")
        self.db.execute("CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS)")
        tables = {"INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEDISC_SYMBOLIC", "INIT$_TB_RULEDISC_XAI",
                  "INIT$_TB_RULEVIOL_ASSOC", "INIT$_TB_RULEVIOL_SYMBOLIC", "INIT$_TB_RULEVIOL_XAI", "INIT$_TB_XAI_RUN",
                  "INIT$_TB_FLOW_WORK_RUN", "INIT$_TB_FLOW_WORK", "INIT$_TB_PROJECT"}
        for table, columns in schema_columns().items():
            if table not in tables:
                continue
            numeric = {"RUN_ID", "FLOW_RUN_ID", "FLOW_ID", "USER_ID", "PROJECT_ID", "VIOLATION_ID", "CONDITION_COUNT",
                       "RULE_CONFIDENCE", "RULE_SUPPORT", "RULE_LIFT", "VIOLATION_COUNT", "SCORE", "COMPLEXITY",
                       "MATCH_COUNT", "SUPPORT_COUNT", "ANOMALY_COUNT", "RULE_PURITY"}
            declarations = [f'"{name}" ' + ("NUMERIC" if name in numeric else "TEXT") for name in columns]
            self.db.execute(f'CREATE TABLE "{table}" ({", ".join(declarations)})')
            self.db.execute("INSERT INTO USER_TABLES VALUES (?)", (table,))
        self.insert("INIT$_TB_PROJECT", USER_ID=7, PROJECT_ID=1)
        self.insert("INIT$_TB_FLOW_WORK", FLOW_ID=3, PROJECT_ID=1, MENU_CODE="M04001")
        self.insert("INIT$_TB_FLOW_WORK_RUN", FLOW_RUN_ID=41, FLOW_ID=3)
        self.conn = Connection(self.db)

    def insert(self, table, **row):
        self.db.execute(f'INSERT INTO "{table}" ({",".join(row)}) VALUES ({",".join("?" for _ in row)})', list(row.values()))

    def assoc(self, rule_id, source="MIXED_PATTERN_TREE", kind="VALUE", model="MIXED", table="SOURCE_DATA", **extra):
        condition = {"operator": "AND", "conditions": []}
        result = {"kind": kind, "column": "Y", "value": "1"}
        if kind == "FORMULA":
            result.update(expression="X + Z", absoluteTolerance=0.01, relativeTolerance=0, numericText=True)
        row = dict(RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, OWNER="APP_OWNER", TARGET_OWNER="APP_OWNER",
                   TARGET_TABLE=table, MODEL_NAME=model, MODEL_TYPE=source, RULE_SOURCE=source,
                   RULE_ID=str(rule_id), RESULT_KIND=kind, RESULT_COLUMN="Y", RESULT_VALUE="1",
                   CONDITION_COUNT=0, CONDITION_TEXT="IF TRUE", RESULT_TEXT="THEN Y = 1", RESULT_HAS_VALUE_YN="Y",
                   CONDITION_JSON=json.dumps(condition), RESULT_JSON=json.dumps(result), VALIDATION_JSON="{}",
                   RULE_CONFIDENCE="0.9", RULE_SUPPORT="0.3", RULE_LIFT="1.5", VIOLATION_COUNT=None)
        row.update(extra)
        self.insert("INIT$_TB_RULEDISC_ASSOC_SUM", **row)

    def symbolic(self, rule_id="1", column="Y", **extra):
        row = dict(RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, OWNER="APP_OWNER", TABLE_NAME="SOURCE_DATA",
                   TARGET_COLUMN=column, RULE_ID=rule_id, EXPRESSION="X + Z", SCORE="0.95", METHOD="SYMBOLIC",
                   SELECTED_YN="Y", FEATURE_COLUMNS="X,Z")
        row.update(extra)
        self.insert("INIT$_TB_RULEDISC_SYMBOLIC", **row)

    def read(self, **kwargs):
        return service.read_results(self.conn, 41, 7, target_owner="APP_OWNER", target_table="SOURCE_DATA", **kwargs)["data"]

    def test_large_rules_page_counts_all_rows_but_fetches_only_twenty_and_no_violations(self):
        for index in range(1005):
            self.assoc(index)
        for index in range(5):
            self.assoc(index, source="OML_ASSOCIATION", model="OML")
        for index in range(30):
            self.symbolic(str(index))
        for index in range(100):
            self.insert("INIT$_TB_RULEVIOL_ASSOC", VIOLATION_ID=index, RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41)
        result = self.read(page=1, page_size=20)
        self.assertEqual(1010, result["total"])
        self.assertEqual(30, result["summary"]["families"]["FORMULA"]["ruleCount"])
        self.assertEqual(20, len(result["rules"]))
        self.assertEqual(20, self.conn.rule_rows)
        self.assertEqual(0, self.conn.violation_rows)
        self.assertEqual(["MIXED_PATTERN"] * 20, [row["source"] for row in result["rules"]])
        self.assertTrue(all(row["review"]["violationCount"] is None for row in result["rules"]))
        self.assertTrue(all("OFFSET :offset ROWS FETCH NEXT :pageSize" in sql for sql in self.conn.queries if "G.SOURCE_FAMILY = :source" in sql))
        page2 = self.read(page=2, page_size=20)
        self.assertFalse({row["key"] for row in result["rules"]} & {row["key"] for row in page2["rules"]})
        self.assertEqual([], self.read(page=999, page_size=20)["rules"])

    def test_summary_does_not_load_any_rule_or_violation_rows_and_keeps_historical_separate(self):
        self.assoc("1")
        self.assoc("2", kind="FORMULA")
        self.assoc("3", kind="FUTURE_KIND")
        self.symbolic()
        self.insert("INIT$_TB_RULEDISC_XAI", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER", TARGET_TABLE="SOURCE_DATA", RULE_ID="old")
        result = self.read(view="summary")
        self.assertEqual(1, result["summary"]["families"]["CONDITION"]["ruleCount"])
        self.assertEqual(2, result["summary"]["families"]["FORMULA"]["ruleCount"])
        self.assertEqual(1, result["summary"]["historicalExplanationCount"])
        self.assertEqual(1, result["summary"]["unclassifiedRuleCount"])
        self.assertEqual(0, self.conn.rule_rows)
        self.assertEqual(0, self.conn.violation_rows)

    def test_composite_key_and_detail_keep_models_targets_columns_sources_and_null_counts(self):
        self.assoc("1", kind="FORMULA")
        self.assoc("1", kind="FORMULA", model="SECOND")
        self.assoc("1", kind="FORMULA", table="OTHER_TABLE")
        self.symbolic("1", "Y")
        self.symbolic("1", "Z")
        result = self.read(family="FORMULA")
        self.assertEqual(4, result["total"])
        self.assertEqual(4, len({row["key"] for row in result["rules"]}))
        rule = next(row for row in result["rules"] if row["source"] == "MIXED_PATTERN" and row["scope"]["modelName"] == "MIXED")
        self.assertIsNone(rule["metrics"]["violationCount"])
        self.assertEqual("X + Z", rule["row"]["FORMULA_EXPRESSION"])
        for index in range(27):
            self.insert("INIT$_TB_RULEVIOL_ASSOC", VIOLATION_ID=index, RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41,
                        RULE_OWNER="APP_OWNER", TARGET_OWNER="APP_OWNER", TARGET_TABLE="SOURCE_DATA", MODEL_NAME="MIXED", RULE_ID="1")
        self.insert("INIT$_TB_RULEVIOL_ASSOC", VIOLATION_ID=99, RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41,
                    RULE_OWNER="APP_OWNER", TARGET_OWNER="APP_OWNER", TARGET_TABLE="SOURCE_DATA", MODEL_NAME="SECOND", RULE_ID="1")
        detail = self.read(view="violations", rule_key=rule["key"], page=2, page_size=20)
        self.assertEqual(27, detail["total"])
        self.assertEqual(7, len(detail["violations"]))
        self.assertIsNone(detail["fullViolationCount"])
        self.assertTrue(detail["previewOnly"])
        self.assertNotIn(99, [row["VIOLATION_ID"] for row in detail["violations"]])
        with self.assertRaises(HTTPException):
            service.read_results(self.conn, 41, 7, target_table="OTHER_TABLE", view="violations", rule_key=rule["key"])

    def test_authorization_precedes_result_queries_and_no_oversized_pages(self):
        with self.assertRaises(HTTPException) as raised:
            service.read_results(self.conn, 41, 99)
        self.assertEqual(404, raised.exception.status_code)
        self.assertEqual(1, len(self.conn.queries))
        for page_size in (0, 101, True):
            with self.assertRaises(HTTPException):
                self.read(page_size=page_size)

    def test_statistics_use_column_aggregates_without_loading_rules_or_previews(self):
        self.assoc("1", VIOLATION_COUNT=7)
        self.assoc("2", VIOLATION_COUNT=11)
        self.insert("INIT$_TB_XAI_RUN", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                    TARGET_TABLE="SOURCE_DATA", SUMMARY_JSON=json.dumps({"algorithm": "MIXED_PATTERN_TREE"}))
        rows, real = mixed.read_column_insights(self.conn, 41, 7, target_owner="APP_OWNER", target_table="SOURCE_DATA")
        self.assertTrue(real)
        self.assertEqual(18, rows[0]["VIOLATION_COUNT"])
        self.assertEqual(2, rows[0]["RULE_COUNT"])
        self.assertEqual(0, self.conn.rule_rows)
        self.assertEqual(0, self.conn.violation_rows)

    def test_zero_result_diagnostics_keep_eligibility_limits_and_load_stage_payload_only_on_demand(self):
        saved = {"algorithm": "MIXED_PATTERN_TREE", "continuous": {"enabled": False, "ruleCount": 0},
                 "sampleCount": 4254, "sampleLimit": 25000, "sourceColumnCount": 84,
                 "sampleColumnCount": 50, "featureLimit": 50, "featureScreening": {"probeRowLimit": 512},
                 "featureLimitExcludedColumns": ["COL001"], "warnings": ["SAMPLE_LIMIT"],
                 "nullPolicy": "MISSING_RESULT_IS_VIOLATION", "metricsCohort": "TRAIN_SAMPLE",
                 "integratedEditing": {"stages": {"DISCOVER": {"legacyDiagnostics": {"skipReason": "NO_QUALIFIED_LASSO_TARGET"}}}},
                 "profile": {"large": "P" * 30000}, "relationships": {"large": "R" * 30000}}
        self.insert("INIT$_TB_XAI_RUN", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                    TARGET_TABLE="SOURCE_DATA", SUMMARY_JSON=json.dumps(saved))
        result = self.read()
        diagnostic = result["diagnostics"]["savedSummary"]
        self.assertEqual(False, diagnostic["continuous"]["enabled"])
        self.assertEqual(0, diagnostic["continuous"]["ruleCount"])
        self.assertEqual(84, diagnostic["sourceColumnCount"])
        self.assertEqual(saved["integratedEditing"], diagnostic["integratedEditing"])
        self.assertNotIn("profile", diagnostic)
        self.assertNotIn("relationships", diagnostic)
        full = self.read(view="diagnostics")
        self.assertEqual(saved, full["summary"])
        self.assertEqual(0, self.conn.rule_rows)
        self.assertEqual(0, self.conn.violation_rows)

    def test_summary_target_bound_and_full_stored_expression_are_explicit(self):
        for index in range(26):
            self.insert("INIT$_TB_XAI_RUN", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                        TARGET_TABLE=f"TARGET_{index:02d}", SUMMARY_JSON=json.dumps({"algorithm": "MIXED_PATTERN_TREE"}))
        diagnostics = service.read_results(self.conn, 41, 7, view="summary")["data"]["diagnostics"]
        self.assertEqual(20, len(diagnostics["runs"]))
        self.assertTrue(diagnostics["hasMore"])
        long_expression = "LONG_ORIGINAL_EXPRESSION_" * 700
        self.symbolic(EXPRESSION=long_expression)
        rules = self.read(family="FORMULA")["rules"]
        self.assertEqual(long_expression, rules[0]["row"]["EXPRESSION"])

    def test_formula_violation_evidence_preserves_invalid_numeric_text(self):
        self.assoc("F", kind="FORMULA")
        self.insert("INIT$_TB_RULEVIOL_ASSOC", VIOLATION_ID=1, RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41,
                    RULE_OWNER="APP_OWNER", TARGET_OWNER="APP_OWNER", TARGET_TABLE="SOURCE_DATA", MODEL_NAME="MIXED", RULE_ID="F",
                    EXPECTED_VALUE="10", ACTUAL_VALUE="invalid")
        key = self.read(family="FORMULA")["rules"][0]["key"]
        row = self.read(view="violations", rule_key=key)["violations"][0]
        self.assertEqual("invalid", row["ACTUAL_VALUE"])
        self.assertEqual("9.99", row["EXPECTED_LOWER"])
        self.assertEqual("10.01", row["EXPECTED_UPPER"])
        self.assertIsNone(row["RESIDUAL"])
        self.assertEqual("N", row["ACTUAL_NUMERIC_VALID_YN"])

    def test_symbolic_sample_context_scopes_duplicate_rule_ids_to_exact_target_and_column(self):
        self.symbolic("SAME", "Y", SCORE=0.1)
        self.symbolic("SAME", "Z", SCORE=0.2)
        self.symbolic("SAME", "Y", TABLE_NAME="OTHER_TABLE", SCORE=0.99)
        sql = SqlLoader.get_sql("MCOMMON_ANLY_WORK_SYMBOLIC_SAMPLE_CONTEXT").replace("{ruleObject}", "INIT$_TB_RULEDISC_SYMBOLIC")
        params = {"runSourceType": "FLOW_WORK", "runId": 41, "ruleId": "SAME", "flowMenuCode": "M04001",
                  "includeAllUsers": "N", "userId": 7, "targetOwner": "APP_OWNER", "targetTable": "SOURCE_DATA", "targetColumn": "Z"}
        with self.conn.cursor() as cursor:
            cursor.execute(sql, params)
            row = mixed._rows(cursor)[0]
            self.assertEqual(("SOURCE_DATA", "Z"), (row["TABLE_NAME"], row["TARGET_COLUMN"]))
            cursor.execute(sql, {**params, "targetColumn": "MISSING"})
            self.assertEqual([], mixed._rows(cursor))
            cursor.execute(sql, {**params, "targetOwner": None, "targetTable": None, "targetColumn": None})
            self.assertEqual("OTHER_TABLE", mixed._rows(cursor)[0]["TABLE_NAME"])
            cursor.execute(sql, {**params, "userId": 99})
            self.assertEqual([], mixed._rows(cursor))

    def test_historical_candidates_page_the_selected_rule_even_when_it_is_not_on_rule_page_one(self):
        self.insert("INIT$_TB_XAI_RUN", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                    TARGET_TABLE="SOURCE_DATA", SUMMARY_JSON=json.dumps({"algorithm": "ISOLATION_FOREST_SURROGATE", "trainCount": 100}))
        for index in range(31):
            self.insert("INIT$_TB_RULEDISC_XAI", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                        TARGET_TABLE="SOURCE_DATA", RULE_ID=f"R{index:02d}", RULE_TEXT="IF X > 1 THEN ANOMALY_CANDIDATE",
                        CONDITION_JSON=json.dumps({"column": "X", "operator": ">", "value": 1}), SUPPORT_COUNT=10,
                        ANOMALY_COUNT=8, RULE_PURITY=0.8, MATCH_COUNT=3 if index in {0, 30} else 0, VALIDATION_JSON="{}")
        for index in range(27):
            self.insert("INIT$_TB_RULEVIOL_XAI", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                        TARGET_TABLE="SOURCE_DATA", RULE_ID="R30", CASE_ID=f"CASE{index:03d}", ROW_DATA_JSON=json.dumps({"X": index}))
        self.insert("INIT$_TB_RULEVIOL_XAI", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41, TARGET_OWNER="APP_OWNER",
                    TARGET_TABLE="OTHER_TABLE", RULE_ID="R30", CASE_ID="FOREIGN", ROW_DATA_JSON="{}")
        listing = mixed.read_results(self.conn, 41, 7, target_owner="APP_OWNER", target_table="SOURCE_DATA", include_violations=False)["data"]
        self.assertEqual(31, listing["total"])
        self.assertEqual(2, listing["ruleSummary"]["overview"]["NON_PERFECT_CONF_RULES"])
        self.assertEqual(20, len(listing["rules"]))
        self.assertEqual([], listing["violations"])
        detail = mixed.read_results(self.conn, 41, 7, target_owner="APP_OWNER", target_table="SOURCE_DATA",
                                    view="violations", rule_id="R30", page=2, page_size=20)["data"]
        self.assertEqual(27, detail["total"])
        self.assertEqual(7, len(detail["violations"]))
        self.assertEqual("R30", detail["ruleSummary"]["rules"][0]["RULE_ID"])
        self.assertEqual({"X": 20}, detail["violations"][0]["ROW_DATA_JSON"])
        self.assertNotIn("FOREIGN", [row["CASE_ID"] for row in detail["violations"]])
        with self.assertRaises(HTTPException):
            mixed.read_results(self.conn, 41, 7, view="violations", rule_id="R30")

    def test_global_order_and_filters_cross_sources_before_paging(self):
        for i in range(26):
            self.assoc(f"ZERO_{i}", VIOLATION_COUNT=0, CONDITION_COUNT=1)
        self.assoc("HIGH", VIOLATION_COUNT=30, CONDITION_COUNT=2)
        self.assoc("UNKNOWN", VIOLATION_COUNT=None, CONDITION_COUNT=2)
        self.assoc("OML", source="OML_ASSOCIATION", model="OML", CONDITION_COUNT=2)
        for i in range(3):
            self.insert("INIT$_TB_RULEVIOL_ASSOC", VIOLATION_ID=i, RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=41,
                        TARGET_OWNER="APP_OWNER", TARGET_TABLE="SOURCE_DATA", RULE_OWNER="APP_OWNER", MODEL_NAME="OML", RULE_ID="OML")
        first = self.read(page_size=2)
        self.assertEqual(["HIGH", "OML"], [r["scope"]["ruleId"] for r in first["rules"]])
        self.assertEqual([30, 3], [r["review"]["violationCount"] for r in first["rules"]])
        self.assertEqual("UNKNOWN", self.read(page=2, page_size=2)["rules"][0]["scope"]["ruleId"])
        filtered = self.read(condition_count="2", exclude_zero=True)
        self.assertEqual(3, filtered["total"])
        self.assertEqual({"HIGH", "OML", "UNKNOWN"}, {r["scope"]["ruleId"] for r in filtered["rules"]})
        self.assertEqual(0, self.read(condition_count="1", exclude_zero=True)["total"])
        self.symbolic("SYMBOLIC")
        self.assertEqual(1, self.read(family="FORMULA", condition_count="-1")["total"])
        with self.assertRaises(HTTPException):
            self.read(condition_count="1 OR 1=1")

    def test_column_labels_are_scoped_to_original_targets_for_lists_and_details(self):
        self.assoc("LABEL", RESULT_COLUMN="COL024")
        self.assoc("OTHER", TARGET_TABLE="OTHER_TABLE", RESULT_COLUMN="COL024")
        for table, label in (("SOURCE_DATA", "응답 결과"), ("OTHER_TABLE", "다른 결과")):
            self.insert("ALL_COL_COMMENTS", OWNER="APP_OWNER", TABLE_NAME=table, COLUMN_NAME="COL024", COMMENTS=label)
        self.insert("ALL_COL_COMMENTS", OWNER="APP_OWNER", TABLE_NAME="SOURCE_DATA", COLUMN_NAME="COL001", COMMENTS="조사 연도")
        rules = service.read_results(self.conn, 41, 7)["data"]["rules"]
        self.assertEqual(2, len(rules))
        by_target = {rule["scope"]["targetTable"]: rule for rule in rules}
        self.assertEqual("응답 결과", by_target["SOURCE_DATA"]["columnComments"]["COL024"])
        self.assertEqual("다른 결과", by_target["OTHER_TABLE"]["columnComments"]["COL024"])
        detail = self.read(view="violations", rule_key=by_target["SOURCE_DATA"]["key"])
        self.assertEqual("조사 연도", detail["rule"]["columnComments"]["COL001"])

    def test_seventy_percent_confidence_distinguishes_detected_unsaved_missing_and_inconsistent_counts(self):
        self.assoc("SEVENTY", RULE_CONFIDENCE=.7, CONDITION_TOTAL_COUNT=10, SUPPORT_COUNT=7, VIOLATION_COUNT=3)
        key = self.read()["rules"][0]["key"]
        result = self.read(view="violations", rule_key=key)
        self.assertEqual("DETECTED_NOT_SAVED", result["violationStatus"])
        self.assertEqual(3, result["fullViolationCount"])
        self.assertEqual(0, result["total"])
        self.assertEqual("RECORDED", result["countConsistency"])
        self.db.execute("UPDATE INIT$_TB_RULEDISC_ASSOC_SUM SET VIOLATION_COUNT = NULL")
        missing = self.read(view="violations", rule_key=key)
        self.assertFalse(missing["detectionCountRecorded"])
        self.assertEqual("NOT_CHECKED", missing["countConsistency"])
        self.db.execute("UPDATE INIT$_TB_RULEDISC_ASSOC_SUM SET VIOLATION_COUNT = 0")
        self.assertEqual("INCONSISTENT", self.read(view="violations", rule_key=key)["countConsistency"])


if __name__ == "__main__":
    unittest.main()
