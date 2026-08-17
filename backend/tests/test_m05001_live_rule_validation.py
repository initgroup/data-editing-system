import unittest
from unittest.mock import patch

from backend.services import edit_work_service


class _Connection:
    def __init__(self, cursor):
        self.cursor_instance = cursor

    def cursor(self):
        return self.cursor_instance

    def close(self):
        return None


class _Cursor:
    def __init__(self):
        self.executions = []
        self.description = []
        self._count_query = False

    def execute(self, sql, params):
        self.executions.append((sql, params))
        self._count_query = "COUNT(*) AS TOTAL_COUNT" in sql
        if not self._count_query:
            self.description = [
                ("CASE_ID",),
                ("TARGET_COLUMN",),
                ("EXPECTED_VALUE",),
                ("ACTUAL_VALUE",),
                ("VIOLATION_SCORE",),
                ("RN__",),
            ]

    def fetchone(self):
        return (3,) if self._count_query else None

    def fetchall(self):
        return [("CASE-1", "COL002", "A", "B", 1, 1)]

    def close(self):
        return None


class M05001LiveRuleValidationTests(unittest.TestCase):
    @patch.object(
        edit_work_service,
        "_build_live_rule_violation_sql",
        return_value=(
            "SELECT CASE_ID, TARGET_COLUMN, EXPECTED_VALUE, ACTUAL_VALUE, "
            "VIOLATION_SCORE, CASE_ROWID FROM INIT$EDIT01.INITUP$_DATA",
            {"keyword": None},
        ),
    )
    def test_live_validation_counts_full_query_and_returns_current_rows(self, _build_sql):
        cursor = _Cursor()

        result = edit_work_service._fetch_live_rule_validation_page(
            cursor,
            {"RULE_NAME": "COND_1"},
            page=1,
            page_size=20,
        )

        self.assertEqual("LIVE", result["queryMode"])
        self.assertEqual(3, result["violationCount"])
        self.assertEqual("CASE-1", result["data"][0]["CASE_ID"])
        self.assertEqual(2, len(cursor.executions))
        self.assertIn("SELECT COUNT(*)", cursor.executions[0][0])
        self.assertNotIn("ROWNUM <=", cursor.executions[0][0].upper())

    @patch.object(edit_work_service, "_fetch_live_rule_validation_page")
    @patch.object(edit_work_service, "_table_column_map")
    def test_user_rule_validation_uses_live_violation_query(
        self,
        table_column_map,
        fetch_live_validation,
    ):
        table_column_map.return_value = {
            "COL001": {"DATA_TYPE": "VARCHAR2"},
            "COL002": {"DATA_TYPE": "VARCHAR2"},
        }
        fetch_live_validation.return_value = {
            "queryMode": "LIVE",
            "violationCount": 7,
            "generatedSql": "SELECT ... FROM INITUP$_DATA",
            "data": [{"CASE_ID": "CASE-1"}],
        }

        result = edit_work_service._validate_user_rule_with_cursor(
            object(),
            rule_type="ASSOCIATION",
            target_owner="INIT$EDIT01",
            target_table="INITUP$_DATA",
            target_column="COL002",
            case_id_column=None,
            rule_expression="COL001 = 'A'",
            expected_value="B",
            rule_tolerance_pct=None,
            include_rows=True,
        )

        self.assertEqual("LIVE", result["queryMode"])
        self.assertEqual(7, result["violationCount"])
        self.assertNotIn("sampleCount", result)
        self.assertTrue(fetch_live_validation.call_args.kwargs["include_rows"])

    @patch.object(edit_work_service, "_fetch_live_rule_validation_page")
    @patch.object(edit_work_service, "_fetch_one")
    @patch.object(edit_work_service, "_require_rule_target_table_access")
    @patch.object(edit_work_service, "_require_project_access", return_value=10)
    @patch.object(
        edit_work_service,
        "_resolve_run_context",
        return_value={"PROJECT_ID": 10, "SCENARIO_ID": 20},
    )
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_discovered_rule_validation_resolves_to_current_initup_table(
        self,
        get_connection,
        _resolve_run_context,
        _require_project_access,
        require_rule_mapping,
        fetch_one,
        fetch_live_validation,
    ):
        cursor = _Cursor()
        get_connection.return_value = _Connection(cursor)
        require_rule_mapping.return_value = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$_DATA",
            "DISCOVERY_TABLE_ROLE": "SOURCE",
        }
        fetch_one.return_value = {
            "RULE_EXPRESSION": "COL001 = 'A'",
            "EXPECTED_VALUE": "B",
            "RULE_SUPPORT": 0.2,
            "RULE_CONFIDENCE": 0.9,
            "RULE_LIFT": 1.4,
        }
        fetch_live_validation.return_value = {
            "queryMode": "LIVE",
            "violationCount": 4,
            "generatedSql": "SELECT ... FROM INIT$EDIT01.INITUP$_DATA",
            "data": [],
            "page": 1,
            "pageSize": 20,
            "total": 4,
            "totalPages": 1,
        }
        payload = edit_work_service.RuleDecisionRequest(
            projectId=10,
            scenarioId=20,
            sourceRuleType="ASSOCIATION",
            runSourceType="FLOW_WORK",
            runId=1001,
            sourceOwner="INIT$EDIT01",
            sourceObjectName="MODEL_1",
            sourceRuleId="COND_1",
            targetOwner="INIT$EDIT01",
            targetTable="INITUP$_DATA",
            targetColumn="COL002",
        )

        result = edit_work_service.validate_discovered_rule_live(object(), payload)

        live_rule = fetch_live_validation.call_args.args[1]
        self.assertEqual("INITUP$_DATA", live_rule["TARGET_TABLE"])
        self.assertEqual("COL001 = 'A'", live_rule["RULE_EXPRESSION"])
        self.assertEqual(4, result["violationCount"])
        self.assertEqual("LIVE", result["queryMode"])


if __name__ == "__main__":
    unittest.main()
