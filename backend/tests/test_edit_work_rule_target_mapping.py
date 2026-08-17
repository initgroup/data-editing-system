import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import edit_work_service


class _OutputVar:
    def __init__(self, value):
        self.value = value

    def getvalue(self):
        return self.value


class _Cursor:
    def __init__(self):
        self.executions = []
        self.rowcount = 1

    def var(self, _type):
        return _OutputVar(501)

    def execute(self, sql, params):
        self.executions.append((sql, params))

    def close(self):
        return None


class _Connection:
    def __init__(self):
        self.cursor_instance = _Cursor()
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        return None


class EditWorkRuleTargetMappingTests(unittest.TestCase):
    @patch.object(edit_work_service, "_fetch_all")
    def test_edit_table_discovery_target_resolves_to_source_mapping(self, fetch_all):
        fetch_all.return_value = [
            {
                "SCENARIO_TABLE_ID": 31,
                "PROJECT_ID": 10,
                "SCENARIO_ID": 20,
                "SOURCE_OWNER": "INIT$EDIT01",
                "SOURCE_TABLE": "INITUP$_DATA",
                "EDIT_OWNER": "INIT$EDIT01",
                "EDIT_TABLE": "INITDN$_DATA",
            }
        ]

        mapping = edit_work_service._require_rule_target_table_access(
            object(),
            project_id=10,
            scenario_id=20,
            target_owner="INIT$EDIT01",
            target_table="INITDN$_DATA",
        )

        self.assertEqual("INITUP$_DATA", mapping["SOURCE_TABLE"])
        self.assertEqual("INITDN$_DATA", mapping["EDIT_TABLE"])
        self.assertEqual("EDIT", mapping["DISCOVERY_TABLE_ROLE"])
        self.assertEqual("MCOMMON_EDIT_RULE_TARGET_MAPPING", fetch_all.call_args.args[1])

    @patch.object(edit_work_service, "_fetch_all", return_value=[])
    def test_unregistered_discovery_target_is_rejected(self, _fetch_all):
        with self.assertRaises(HTTPException) as raised:
            edit_work_service._require_rule_target_table_access(
                object(),
                project_id=10,
                scenario_id=20,
                target_owner="INIT$EDIT01",
                target_table="INITDN$_OTHER_PROJECT",
            )

        self.assertEqual(403, raised.exception.status_code)

    def test_mapping_sql_accepts_only_registered_source_or_edit_pair(self):
        mapping_sql = SqlLoader.get_sql("MCOMMON_EDIT_RULE_TARGET_MAPPING").upper()
        page_sql = SqlLoader.get_sql("MCOMMON_EDIT_RULE_SOURCE_PAGE").upper()
        latest_sql = SqlLoader.get_sql("MCOMMON_EDIT_LATEST_RULE_RUN").upper()
        master_sql = SqlLoader.get_sql("MCOMMON_EDIT_RULE_MASTER_LIST").upper()
        selected_sql = SqlLoader.get_sql("MCOMMON_EDIT_RULE_SELECTED_LIST").upper()

        self.assertIn("T.OWNER_NAME = :TARGETOWNER", mapping_sql)
        self.assertIn("T.TABLE_NAME = :TARGETTABLE", mapping_sql)
        self.assertIn("T.EDIT_OWNER_NAME = :TARGETOWNER", mapping_sql)
        self.assertIn("T.EDIT_TABLE_NAME = :TARGETTABLE", mapping_sql)
        self.assertIn("T.PROJECT_ID = :PROJECTID", mapping_sql)
        self.assertIn("T.SCENARIO_ID = :SCENARIOID", mapping_sql)
        self.assertNotIn("E.TARGET_TABLE = U.TARGET_TABLE", page_sql)
        self.assertIn(":VIOLATIONSCOPE = 'ERROR_ONLY'", page_sql)
        self.assertIn('FROM "INIT$_TB_RULEVIOL_ASSOC" V', page_sql)
        self.assertIn('FROM "INIT$_TB_RULEVIOL_SYMBOLIC" V', page_sql)
        self.assertIn("WITH TARGET_RUNS AS", latest_sql)
        self.assertEqual(1, latest_sql.count("R.TARGET_TABLE = :TARGETTABLE"))
        self.assertEqual(1, latest_sql.count("R.TABLE_NAME = :TARGETTABLE"))
        self.assertNotIn("EXISTS (", latest_sql)
        self.assertIn("PROJECT_ID", latest_sql)
        self.assertIn("SCENARIO_ID", latest_sql)
        self.assertIn(":RESTRICTRUNYN", master_sql)
        self.assertIn(":DISCOVERYTARGETTABLE", master_sql)
        self.assertNotIn("S.TABLE_NAME = R.TARGET_TABLE", master_sql)
        self.assertNotIn("A.TARGET_TABLE = R.TARGET_TABLE", master_sql)
        self.assertIn(":RESTRICTRUNYN", selected_sql)
        self.assertNotIn("S.TABLE_NAME = R.TARGET_TABLE", selected_sql)
        self.assertNotIn("A.TARGET_TABLE = R.TARGET_TABLE", selected_sql)

    @patch.object(edit_work_service, "_require_project_access", return_value=10)
    @patch.object(edit_work_service, "_require_rule_target_table_access")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_m05001_rejects_edit_table_as_rule_management_target(
        self,
        get_connection,
        require_rule_mapping,
        _require_project_access,
    ):
        get_connection.return_value = _Connection()
        require_rule_mapping.return_value = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$_DATA",
            "DISCOVERY_TABLE_ROLE": "EDIT",
        }

        with self.assertRaises(HTTPException) as raised:
            edit_work_service.list_rules(
                object(),
                project_id=10,
                scenario_id=20,
                target_owner="INIT$EDIT01",
                target_table="INITDN$_DATA",
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("INITUP$", raised.exception.detail)

    @patch.object(edit_work_service, "_fetch_one")
    def test_latest_run_lookup_keeps_source_and_edit_tracks_separate(self, fetch_one):
        fetch_one.side_effect = [
            {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 1001},
            {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": 1008},
        ]

        source_run = edit_work_service._latest_rule_run_for_target(
            object(),
            project_id=10,
            scenario_id=20,
            target_owner="INIT$EDIT01",
            target_table="INITUP$_DATA",
        )
        edit_run = edit_work_service._latest_rule_run_for_target(
            object(),
            project_id=10,
            scenario_id=20,
            target_owner="INIT$EDIT01",
            target_table="INITDN$_DATA",
        )

        self.assertEqual(1001, source_run["RUN_ID"])
        self.assertEqual(1008, edit_run["RUN_ID"])
        self.assertEqual(
            "INITUP$_DATA",
            fetch_one.call_args_list[0].args[2]["targetTable"],
        )
        self.assertEqual(
            "INITDN$_DATA",
            fetch_one.call_args_list[1].args[2]["targetTable"],
        )

    @patch.object(edit_work_service, "_fetch_one")
    @patch.object(edit_work_service, "_select_session")
    @patch.object(edit_work_service, "_get_user_text", return_value="tester")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_reanalysis_link_rejects_source_table_run_for_edit_track(
        self,
        get_connection,
        _get_user_text,
        select_session,
        fetch_one,
    ):
        connection = _Connection()
        get_connection.return_value = connection
        select_session.return_value = {
            "EDIT_SESSION_ID": 41,
            "PROJECT_ID": 10,
            "SCENARIO_ID": 20,
            "SESSION_STATUS": "EDITING",
            "TARGET_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_TABLE": "INITDN$_DATA",
        }
        fetch_one.return_value = {
            "FLOW_RUN_ID": 1009,
            "PROJECT_ID": 10,
            "SCENARIO_ID": 20,
            "STATUS": "SUCCESS",
            "PLAN_JSON": (
                '{"runtimeOverrides":{'
                '"INIT$EditingSessionId":41,'
                '"INIT$TargetOwner":"INIT$EDIT01",'
                '"INIT$TargetTable":"INITUP$_DATA"}}'
            ),
        }

        with self.assertRaises(HTTPException) as raised:
            edit_work_service.link_reanalysis(
                object(),
                41,
                edit_work_service.ReanalysisLinkRequest(flowRunId=1009),
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("table does not match", raised.exception.detail)
        self.assertTrue(connection.rolled_back)
        self.assertFalse(connection.committed)

    @patch.object(edit_work_service, "_event")
    @patch.object(edit_work_service, "_edit_rule_sql")
    @patch.object(edit_work_service, "_fetch_one")
    @patch.object(edit_work_service, "_require_rule_target_table_access")
    @patch.object(edit_work_service, "_require_project_access", return_value=10)
    @patch.object(
        edit_work_service,
        "_resolve_run_context",
        return_value={"PROJECT_ID": 10, "SCENARIO_ID": 20},
    )
    @patch.object(edit_work_service, "_get_user_text", return_value="tester")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_save_rule_keeps_edit_table_provenance_and_stores_source_target(
        self,
        get_connection,
        _get_user_text,
        _resolve_run_context,
        _require_project_access,
        require_rule_mapping,
        fetch_one,
        edit_rule_sql,
        _event,
    ):
        connection = _Connection()
        get_connection.return_value = connection
        require_rule_mapping.return_value = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$_DATA",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$_DATA",
            "DISCOVERY_TABLE_ROLE": "EDIT",
        }

        def fetch_one_side_effect(_cursor, sql_id, params):
            if sql_id == "MCOMMON_EDIT_RULE_SOURCE_SYMBOLIC_DETAIL":
                self.assertEqual("INITDN$_DATA", params["targetTable"])
                return {
                    "RULE_EXPRESSION": "COL001 * 2",
                    "EXPECTED_VALUE": None,
                    "RULE_SUPPORT": None,
                    "RULE_CONFIDENCE": 0.91,
                    "RULE_LIFT": None,
                }
            if sql_id == "MCOMMON_EDIT_RULE_SOURCE_MATCH":
                self.assertEqual("INITUP$_DATA", params["targetTable"])
                return None
            if sql_id == "MCOMMON_EDIT_RULE_SELECT":
                return {
                    "EDIT_RULE_ID": 501,
                    "PROJECT_ID": 10,
                    "SCENARIO_ID": 20,
                    "TARGET_OWNER": "INIT$EDIT01",
                    "TARGET_TABLE": "INITUP$_DATA",
                    "TARGET_COLUMN": "COL002",
                    "DECISION_STATUS": "SELECTED",
                }
            self.fail(f"Unexpected SQL lookup: {sql_id}")

        fetch_one.side_effect = fetch_one_side_effect
        edit_rule_sql.return_value = (
            SqlLoader.get_sql("MCOMMON_EDIT_RULE_INSERT"),
            True,
        )
        payload = edit_work_service.RuleDecisionRequest(
            projectId=10,
            scenarioId=20,
            sourceRuleType="SYMBOLIC",
            runSourceType="FLOW_WORK",
            runId=1081,
            sourceOwner="INIT$EDIT01",
            sourceObjectName="INITDN$_DATA",
            sourceRuleId="FORMULA_1",
            targetOwner="INIT$EDIT01",
            targetTable="INITDN$_DATA",
            targetColumn="COL002",
            decisionStatus="SELECTED",
            ruleStatus="ACTIVE",
        )

        result = edit_work_service.save_rule(object(), payload)

        inserted_params = connection.cursor_instance.executions[0][1]
        self.assertEqual("INITUP$_DATA", inserted_params["targetTable"])
        self.assertEqual("INIT$EDIT01", inserted_params["targetOwner"])
        self.assertEqual("INITUP$_DATA", result["data"]["TARGET_TABLE"])
        self.assertTrue(connection.committed)
        self.assertFalse(connection.rolled_back)


if __name__ == "__main__":
    unittest.main()
