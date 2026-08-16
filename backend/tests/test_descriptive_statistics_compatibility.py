import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import anly_work_service
from backend.services import descriptive_statistics_service as statistics
from backend.services import edit_work_service


class DescriptiveStatisticsCompatibilityTests(unittest.TestCase):
    def test_violation_column_insight_sql_is_read_only_and_run_scoped(self):
        sql = SqlLoader.get_sql("MCOMMON_STATS_VIOLATION_COLUMNS").upper()

        self.assertTrue(sql.lstrip().startswith("WITH"))
        self.assertIn("RUN_SOURCE_TYPE = :RUNSOURCETYPE", sql)
        self.assertIn("RUN_ID = :RUNID", sql)
        self.assertIn("TARGET_OWNER = :TARGETOWNER", sql)
        self.assertNotIn("DELETE FROM", sql)
        self.assertNotIn("UPDATE ", sql)

    @patch.object(statistics, "_table_columns", return_value=[{"COLUMN_NAME": "COL001"}])
    def test_physical_initup_initdn_pair_is_resolved_without_registration(self, table_columns):
        pair = statistics.resolve_physical_pair(
            object(),
            target_owner="INIT$EDIT01",
            target_table="INITDN$_SAMPLE",
        )

        self.assertEqual("INITUP$_SAMPLE", pair["SOURCE_TABLE"])
        self.assertEqual("INITDN$_SAMPLE", pair["EDIT_TABLE"])
        self.assertEqual("PHYSICAL_NAME_PAIR", pair["PAIR_SOURCE"])
        self.assertEqual(2, table_columns.call_count)

    def test_column_insights_rank_rule_violations_before_small_distribution_changes(self):
        payload = {
            "before": {"owner": "INIT$EDIT01", "table": "INITUP$_T1"},
            "after": {"owner": "INIT$EDIT01", "table": "INITDN$_T1"},
            "columns": [
                {
                    "columnName": "COL001",
                    "columnComment": "첫 번째",
                    "dataType": "NUMBER",
                    "before": {
                        "totalRowCount": 100,
                        "nullCount": 0,
                        "mean": 10,
                        "variance": 4,
                        "stddev": 2,
                        "min": 1,
                        "max": 20,
                    },
                    "after": {
                        "totalRowCount": 100,
                        "nullCount": 0,
                        "mean": 10.1,
                        "variance": 4.1,
                        "stddev": 2.02,
                        "min": 1,
                        "max": 20,
                    },
                },
                {
                    "columnName": "COL002",
                    "columnComment": "두 번째",
                    "dataType": "NUMBER",
                    "before": {"totalRowCount": 100, "nullCount": 0},
                    "after": {"totalRowCount": 100, "nullCount": 0},
                },
            ],
        }
        violation_rows = [
            {
                "COLUMN_NAME": "COL002",
                "VIOLATION_COUNT": 50,
                "VIOLATED_ROW_COUNT": 30,
                "RULE_COUNT": 4,
                "CATEGORICAL_VIOLATION_COUNT": 50,
                "CONTINUOUS_VIOLATION_COUNT": 0,
            }
        ]

        result = statistics.attach_column_insights(payload, violation_rows)

        ranked = result["insights"]["rankedColumns"]
        self.assertEqual("COL002", ranked[0]["columnName"])
        self.assertEqual(50, ranked[0]["violationCount"])
        self.assertEqual("HIGH", ranked[0]["priorityLevel"])
        self.assertEqual(1, result["insights"]["summary"]["violationColumnCount"])

    @patch.object(anly_work_service.descriptive_statistics, "build_statistics")
    @patch.object(anly_work_service.descriptive_statistics, "resolve_registered_pair")
    @patch.object(anly_work_service, "get_request_role_code", return_value="USER")
    @patch.object(anly_work_service, "get_request_user_id", return_value=7)
    @patch.object(anly_work_service, "get_target_db_connection")
    def test_analysis_falls_back_to_source_when_registered_edit_table_is_missing(
        self,
        get_connection,
        _get_user,
        _get_role,
        resolve_pair,
        build_statistics,
    ):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        get_connection.return_value = connection
        descriptions = [
            [
                ("FLOW_NODE_RUN_ID",),
                ("FLOW_RUN_ID",),
                ("RUNTIME_PARAM_JSON",),
                ("NODE_PAYLOAD_JSON",),
            ],
            [("PROJECT_ID",), ("SCENARIO_ID",)],
        ]

        def execute_side_effect(_sql, _params):
            cursor.description = descriptions.pop(0)

        cursor.execute.side_effect = execute_side_effect
        cursor.fetchall.return_value = [
            (
                1101,
                1041,
                '{"INIT$TargetOwner":"INIT$EDIT01","INIT$TargetTable":"INITUP$T1"}',
                "{}",
            )
        ]
        cursor.fetchone.return_value = (1, 2)
        resolve_pair.return_value = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$T1",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$T1",
        }
        build_statistics.side_effect = [
            HTTPException(status_code=404, detail="The managed comparison table was not found."),
            {"available": True, "basis": "SINGLE", "columns": []},
        ]

        result = anly_work_service.get_descriptive_statistics(
            1041,
            object(),
            node_run_id=1101,
        )

        self.assertEqual("success", result["status"])
        self.assertEqual(2, build_statistics.call_count)
        fallback = build_statistics.call_args_list[1].kwargs
        self.assertEqual("INITUP$T1", fallback["before_table"])
        self.assertNotIn("after_table", fallback)
        self.assertEqual("LIVE_REGISTERED_SOURCE_ONLY", fallback["context"]["statisticsSource"])
        self.assertIn("현재 INITUP$ 원본 데이터", result["data"]["notice"])

    @patch.object(statistics, "preferred_edit_session_columns", return_value=["AMOUNT"])
    @patch.object(statistics, "build_statistics")
    def test_old_applied_session_compares_current_physical_pair(
        self,
        build_statistics,
        _preferred_columns,
    ):
        build_statistics.return_value = {
            "available": True,
            "basis": "LIVE_CURRENT_PHYSICAL_PAIR",
            "after": {"owner": "INIT$EDIT01", "table": "INITDN$T1"},
            "columns": [],
        }
        session = {
            "EDIT_SESSION_ID": 3,
            "PROJECT_ID": 1,
            "SCENARIO_ID": 2,
            "SESSION_STATUS": "APPLIED",
        }
        mapping = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$T1",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$T1",
        }

        result = statistics.build_applied_session_current_statistics(
            object(),
            session,
            mapping=mapping,
        )

        self.assertEqual("LIVE_CURRENT_PHYSICAL_PAIR", result["basis"])
        self.assertIn("현재 물리적으로 존재하는 INITUP$ 원본과 INITDN$ 수정 테이블", result["notice"])
        call = build_statistics.call_args.kwargs
        self.assertEqual("INIT$EDIT01", call["before_owner"])
        self.assertEqual("INITUP$T1", call["before_table"])
        self.assertEqual("INIT$EDIT01", call["after_owner"])
        self.assertEqual("INITDN$T1", call["after_table"])
        self.assertFalse(call["context"]["historicalComparisonAvailable"])
        self.assertTrue(call["context"]["comparisonAvailable"])

    @patch.object(edit_work_service.descriptive_statistics, "build_applied_session_current_statistics")
    @patch.object(edit_work_service, "_require_session_table_mapping")
    @patch.object(edit_work_service, "_load_effect_validation_snapshot", return_value=None)
    @patch.object(edit_work_service, "_select_session")
    @patch.object(edit_work_service, "get_target_db_connection")
    def test_applied_session_without_snapshot_uses_safe_registered_mapping(
        self,
        get_connection,
        select_session,
        _load_snapshot,
        require_mapping,
        build_current_statistics,
    ):
        connection = MagicMock()
        get_connection.return_value = connection
        session = {
            "EDIT_SESSION_ID": 3,
            "PROJECT_ID": 1,
            "SCENARIO_ID": 2,
            "SESSION_STATUS": "APPLIED",
        }
        mapping = {
            "SOURCE_OWNER": "INIT$EDIT01",
            "SOURCE_TABLE": "INITUP$T1",
            "EDIT_OWNER": "INIT$EDIT01",
            "EDIT_TABLE": "INITDN$T1",
        }
        select_session.return_value = session
        require_mapping.return_value = mapping
        build_current_statistics.return_value = {
            "available": True,
            "basis": "LIVE_CURRENT_PHYSICAL_PAIR",
            "columns": [],
        }

        result = edit_work_service.descriptive_statistics_summary(object(), 3)

        self.assertEqual("LIVE_CURRENT_PHYSICAL_PAIR", result["data"]["basis"])
        require_mapping.assert_called_once_with(connection.cursor.return_value, session)
        build_current_statistics.assert_called_once_with(
            connection.cursor.return_value,
            session,
            mapping=mapping,
            requested_columns=None,
        )


if __name__ == "__main__":
    unittest.main()
