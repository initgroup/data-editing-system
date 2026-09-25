"""Execute reporting queries against DDL-derived schemas, without Oracle.

Only Oracle scalar/row-limit syntax is adapted. Real SQL joins, classification,
metadata probing, aggregates and report construction run through execute_query.
This checks result contracts and schema scopes, not Oracle plans or performance.
"""
import re
import sqlite3
import unittest

from backend.database_helper import SqlLoader
from backend.services import structured_report_service as reports
from backend.services.custom_report_service import _REPORT_KPI_CODES, _block_entries
from backend.services.report_i18n import localize_report_document
from backend.tests.test_xai_sql_compatibility import schema_columns


class ReportCursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql, params):
        sql = sql.replace("DBMS_LOB.SUBSTR", "LOB_SUBSTR")
        sql = re.sub(r"WHERE ROWNUM <= 300\s*$", "LIMIT 300", sql)
        self.cursor.execute(sql, params)

    @property
    def description(self):
        return self.cursor.description

    def fetchall(self):
        return self.cursor.fetchall()

    def close(self):
        self.cursor.close()


class ReportConnection:
    def __init__(self, conn):
        self.conn = conn

    def cursor(self):
        return ReportCursor(self.conn.cursor())


class UnifiedReportTests(unittest.TestCase):
    def database(self, modern=True):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.create_function("NVL", 2, lambda value, default: default if value is None else value)
        conn.create_function("LOB_SUBSTR", 3, lambda value, length, start: value[start - 1:start - 1 + length] if value is not None else None)
        schemas = schema_columns()
        sqls = [SqlLoader.get_sql(key) for key in reports._SEMANTIC_RULE_SQL_IDS]
        referenced = set(re.findall(r"\bINIT\$_[A-Z0-9_]+", "\n".join(sqls)))
        for table in sorted(referenced):
            self.assertIn(table, schemas)
            columns = schemas[table]
            if not modern and table == "INIT$_TB_RULEDISC_ASSOC_SUM":
                columns = [key for key in columns if key != "RESULT_KIND"]
            conn.execute(f'CREATE TABLE "{table}" (' + ", ".join(f'"{key}"' for key in columns) + ")")
        conn.executescript("CREATE TABLE DUAL (DUMMY); INSERT INTO DUAL VALUES ('X'); CREATE TABLE USER_TAB_COLUMNS (TABLE_NAME, COLUMN_NAME);")
        if modern:
            conn.execute("INSERT INTO USER_TAB_COLUMNS VALUES ('INIT$_TB_RULEDISC_ASSOC_SUM', 'RESULT_KIND')")
        return conn, ReportConnection(conn)

    @staticmethod
    def insert(conn, table, **row):
        conn.execute(f'INSERT INTO "{table}" (' + ", ".join(row) + ") VALUES (" + ", ".join("?" for _ in row) + ")", tuple(row.values()))

    def seed(self, conn, modern=True):
        for rule_id, source, kind, confidence in (
            ("OML1", "DBMS_DATA_MINING", None, .8),
            ("MIXED_VALUE_1", "MIXED_PATTERN_TREE", "VALUE", .9),
            ("MIXED_FORMULA_1", "MIXED_PATTERN_TREE", "FORMULA", .99),
        ):
            row = dict(RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, OWNER="RULES", MODEL_NAME="MODEL", TARGET_OWNER="DATA", TARGET_TABLE="SOURCE", RULE_ID=rule_id, RULE_SOURCE=source, RESULT_COLUMN="Y", RULE_CONFIDENCE=confidence, RULE_LIFT=1.1, RULE_SUPPORT=.5, RESULT_TEXT="Y = 2 * X" if kind == "FORMULA" else "Y = yes")
            if modern:
                row["RESULT_KIND"] = kind
            self.insert(conn, "INIT$_TB_RULEDISC_ASSOC_SUM", **row)
            self.insert(conn, "INIT$_TB_RULEVIOL_ASSOC", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, RULE_OWNER="RULES", MODEL_NAME="MODEL", TARGET_OWNER="DATA", TARGET_TABLE="SOURCE", RULE_ID=rule_id, RESULT_COLUMN="Y", VIOLATION_SCORE=.7 if source == "DBMS_DATA_MINING" else None)
        self.insert(conn, "INIT$_TB_RULEDISC_SYMBOLIC", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, OWNER="DATA", TABLE_NAME="SOURCE", TARGET_COLUMN="Y", RULE_ID="SYM1", EXPRESSION="Y=3*X", SCORE=.95, SELECTED_YN="Y", METHOD="SYMBOLIC")
        self.insert(conn, "INIT$_TB_RULEVIOL_SYMBOLIC", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, TARGET_OWNER="DATA", TARGET_TABLE="SOURCE", TARGET_COLUMN="Y", VIOLATION_SCORE=.3)

    @staticmethod
    def query(conn, sql_id):
        return reports._query(conn, sql_id, {"projectId": 1, "scenarioId": 1, "flowRunId": 7, "editSessionId": None})

    def test_mixed_oml_symbolic_coexist_in_counts_details_and_actual_report_kpis(self):
        for modern in (True, False):
            with self.subTest(modern=modern):
                db, conn = self.database(modern)
                self.seed(db, modern)
                counts = self.query(conn, "M06001_AVAILABILITY_COUNTS")[0]
                self.assertEqual((counts["ASSOCIATION_RULE_COUNT"], counts["SYMBOLIC_RULE_COUNT"], counts["VIOLATION_COUNT"]), (2, 2, 4))
                categorical = self.query(conn, "M06001_ASSOC_RULE_SUMMARY")
                self.assertEqual({row["RULE_ID"] for row in categorical}, {"OML1", "MIXED_VALUE_1"})
                aggregate = self.query(conn, "M06001_ASSOC_RULE_AGGREGATE")[0]
                self.assertAlmostEqual(aggregate["AVG_RULE_CONFIDENCE"], .85)
                formulas = reports._formula_rule_rows(conn, 7)
                self.assertEqual({row["RULE_ID"] for row in formulas}, {"SYM1", "MIXED_FORMULA_1"})
                mixed = next(row for row in formulas if row["RULE_ID"] == "MIXED_FORMULA_1")
                self.assertEqual(mixed["EXPRESSION"], "Y = 2 * X")
                self.assertEqual(mixed["RULE_CONFIDENCE"], .99)
                self.assertIsNone(mixed["SCORE"])
                self.assertIsNone(mixed["SELECTED_YN"])
                context = {"selection": {"projectId": 1, "scenarioId": 1, "flowRunId": 7, "editSessionId": None}}
                for code, expected in (("R08", {"ASSOCIATION_RULE_COUNT": 2}), ("R10", {"SYMBOLIC_RULE_COUNT": 2, "SELECTED_RULE_COUNT": 1, "MIXED_FORMULA_COUNT": 1, "TARGET_COUNT": 1}), ("R11", {"VIOLATION_COUNT": 4, "ASSOCIATION_VIOLATION_COUNT": 2, "SYMBOLIC_VIOLATION_COUNT": 2})):
                    sections, kpis = reports._build_sections_and_kpis(conn, code, context, counts)
                    values = {row["code"]: row["value"] for row in kpis}
                    self.assertTrue(set(values).issubset(_REPORT_KPI_CODES[code]))
                    for key, value in expected.items():
                        self.assertEqual(values[key], value, (modern, code, key))
                    self.assertTrue(sections)
                violations = self.query(conn, "M06001_VIOLATION_SUMMARY")
                scores = {row["VIOLATION_TYPE"]: row["AVG_VIOLATION_SCORE"] for row in violations}
                self.assertEqual(scores, {"ASSOCIATION": .7, "SYMBOLIC": .3})

    def test_explicit_kind_wins_and_null_kind_uses_saved_legacy_contract(self):
        db, conn = self.database()
        for rule_id, source, kind in (("FORMULA_CUSTOM", "CUSTOM", "FORMULA"), ("MIXED_FORMULA_VALUE", "MIXED_PATTERN_TREE", "VALUE"), ("MIXED_FORMULA_OLD", "MIXED_PATTERN_TREE", None), ("MIXED_FORMULA_OTHER", "DBMS_DATA_MINING", None), ("PLAIN", None, None)):
            self.insert(db, "INIT$_TB_RULEDISC_ASSOC_SUM", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, RULE_ID=rule_id, RULE_SOURCE=source, RESULT_KIND=kind)
        self.assertEqual({r["RULE_ID"] for r in reports._formula_rule_rows(conn, 7)}, {"FORMULA_CUSTOM", "MIXED_FORMULA_OLD"})
        self.assertEqual({r["RULE_ID"] for r in self.query(conn, "M06001_ASSOC_RULE_SUMMARY")}, {"MIXED_FORMULA_VALUE", "MIXED_FORMULA_OTHER", "PLAIN"})

    def test_violation_matching_is_scoped_to_rule_identity_and_source_target(self):
        db, conn = self.database()
        self.seed(db)
        # A repeated rule ID in another model/owner/target/run cannot reclassify
        # this categorical violation; EXISTS also avoids duplicate multiplication.
        for changed in ({"OWNER": "OTHER"}, {"MODEL_NAME": "OTHER"}, {"TARGET_OWNER": "OTHER"}, {"TARGET_TABLE": "OTHER"}, {"RUN_ID": 8}, {"RUN_SOURCE_TYPE": "DATA_WORK"}):
            row = dict(RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, OWNER="RULES", MODEL_NAME="MODEL", TARGET_OWNER="DATA", TARGET_TABLE="SOURCE", RULE_ID="OML1", RULE_SOURCE="MIXED_PATTERN_TREE", RESULT_KIND="FORMULA")
            row.update(changed)
            self.insert(db, "INIT$_TB_RULEDISC_ASSOC_SUM", **row)
        self.insert(db, "INIT$_TB_RULEDISC_ASSOC_SUM", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, OWNER="RULES", MODEL_NAME="MODEL", TARGET_OWNER="DATA", TARGET_TABLE="SOURCE", RULE_ID="MIXED_FORMULA_1", RESULT_KIND="FORMULA")
        rows = self.query(conn, "M06001_VIOLATION_SUMMARY")
        self.assertEqual({r["VIOLATION_TYPE"]: r["VIOLATION_COUNT"] for r in rows}, {"ASSOCIATION": 2, "SYMBOLIC": 2})

    def test_formula_targets_count_separate_owner_table_namespaces(self):
        db, conn = self.database()
        self.seed(db)
        for owner, table in (("DATA", "SECOND"), ("OTHER", "SOURCE")):
            self.insert(db, "INIT$_TB_RULEDISC_ASSOC_SUM", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, TARGET_OWNER=owner, TARGET_TABLE=table, RESULT_COLUMN="Y", RULE_ID="MIXED_FORMULA_2", RESULT_KIND="FORMULA")
        self.assertEqual(self.query(conn, "M06001_SYMBOLIC_RULE_AGGREGATE")[0]["TARGET_COUNT"], 3)

    def test_complete_formula_text_is_preserved_with_a_combined_300_row_cap(self):
        db, conn = self.database()
        expression = "Y = " + " + ".join(f"X{i}" for i in range(1800))
        self.assertGreater(len(expression), 3000)
        for index in range(320):
            self.insert(db, "INIT$_TB_RULEDISC_SYMBOLIC", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, TARGET_COLUMN="Z", RULE_ID=f"S{index:04}", EXPRESSION=expression, SELECTED_YN="Y")
            self.insert(db, "INIT$_TB_RULEDISC_ASSOC_SUM", RUN_SOURCE_TYPE="FLOW_WORK", RUN_ID=7, RESULT_COLUMN="A" if index == 0 else "Z", RULE_ID=f"M{index:04}", RESULT_TEXT=expression, RESULT_KIND="FORMULA")
        rows = reports._formula_rule_rows(conn, 7)
        self.assertEqual(len(rows), 300)
        self.assertEqual(rows[0]["RULE_ID"], "M0000")
        self.assertEqual(rows[-1]["RULE_ID"], "S0298")
        self.assertTrue(all(row["EXPRESSION"] == expression for row in rows))
        self.assertEqual(self.query(conn, "M06001_SYMBOLIC_RULE_AGGREGATE")[0]["SYMBOLIC_RULE_COUNT"], 640)

    def test_localized_basic_and_custom_reports_preserve_codes_and_metric_meanings(self):
        db, conn = self.database()
        self.seed(db)
        counts = self.query(conn, "M06001_AVAILABILITY_COUNTS")[0]
        context = {"selection": {"projectId": 1, "scenarioId": 1, "flowRunId": 7, "editSessionId": None}}
        for code, label_expectations in (
            ("R10", {"SYMBOLIC_RULE_COUNT": "Formula rules", "SELECTED_RULE_COUNT": "Symbolic-selected formulas"}),
            ("R11", {"SYMBOLIC_VIOLATION_COUNT": "Continuous violations"}),
        ):
            sections, kpis = reports._build_sections_and_kpis(conn, code, context, counts)
            source = {"report": {"code": code}, "sections": sections, "kpis": kpis,
                      "definitions": reports._report_definitions(code)}
            english = localize_report_document(source, "en")
            korean = localize_report_document(source, "ko")
            labels = {item["code"]: item["label"] for item in english["kpis"]}
            for key, expected in label_expectations.items():
                self.assertEqual(labels[key], expected)
            blocks = {item["key"]: item for item in _block_entries(english, include_data=True)}
            for item in korean["kpis"]:
                block = blocks[f"kpi:{item['code']}"]
                self.assertEqual(block["data"]["value"], item["value"])
                self.assertEqual(block["title"], labels[item["code"]])
            self.assertEqual(korean["sections"], source["sections"])
            if code == "R10":
                self.assertIn("training sample", english["sections"][0]["note"])
                self.assertIn("full source after detection", english["sections"][0]["note"])
                self.assertIn("탐지 후 전체 원본", korean["sections"][0]["note"])
                definition = next(item for item in english["definitions"] if item["term"] == "Formula Confidence")
                self.assertIn("separately from validation-sample scores", definition["definition"])
                self.assertEqual(english["sections"][0]["rows"], korean["sections"][0]["rows"])

        decision = localize_report_document({"report": {"code": "R12"},
            "kpis": [{"code": "SELECTED_RULE_COUNT", "label": "선정 규칙", "value": 2}]}, "en")
        self.assertNotIn("Symbolic", decision["kpis"][0]["label"])


if __name__ == "__main__":
    unittest.main()
