import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.routers import M01001, M01002
from backend.services import admin_scope_purge_service as purge_service


class FakeCursor:
    def __init__(self, statements):
        self.statements = statements

    def execute(self, sql, params=None):
        self.statements.append((sql, params or {}))

    def close(self):
        return None


class FakeConnection:
    def __init__(self):
        self.statements = []
        self.commit_count = 0
        self.rollback_count = 0

    def cursor(self):
        return FakeCursor(self.statements)

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1


class AdminScopePurgeServiceTests(unittest.TestCase):
    def test_admin_key_must_be_configured_and_match(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as missing:
                purge_service.verify_admin_key("anything")
        self.assertEqual(missing.exception.status_code, 503)

        with patch.dict(os.environ, {"INIT_ADMIN_KEY": "correct-key"}, clear=True):
            with self.assertRaises(HTTPException) as mismatch:
                purge_service.verify_admin_key("wrong-key")
            purge_service.verify_admin_key("correct-key")
        self.assertEqual(mismatch.exception.status_code, 403)

    def test_preview_blocks_managed_pair_referenced_outside_scope(self):
        conn = MagicMock()
        context = {
            "PROJECT_ID": 10,
            "SCENARIO_ID": 20,
            "PROJECT_CODE": "PROJECT_A",
            "PROJECT_NAME": "Project A",
            "SCENARIO_CODE": "SCENARIO_A",
            "SCENARIO_NAME": "Scenario A",
            "USER_ID": 7,
            "USER_EMAIL": "owner@example.com",
        }
        mapping = {
            "SOURCE_OWNER": "TARGET_OWNER",
            "SOURCE_TABLE": "INITUP$_PROJECT_A",
            "EDIT_OWNER": "TARGET_OWNER",
            "EDIT_TABLE": "INITDN$_PROJECT_A",
            "DATA_ORIGIN_TYPE": "MANAGED_TABLE",
        }

        def fetch_one(_conn, sql_id, _params=None, **_kwargs):
            if sql_id == "ADMIN_PURGE_CURRENT_SCHEMA":
                return {"CURRENT_SCHEMA": "TARGET_OWNER"}
            if sql_id == "ADMIN_PURGE_MANAGED_TABLE_EXTERNAL_REFS":
                return {"REFERENCE_COUNT": 1}
            if sql_id == "ADMIN_PURGE_ACTIVE_RUN_COUNT":
                return {"DATA_WORK_ACTIVE_COUNT": 0, "FLOW_WORK_ACTIVE_COUNT": 0}
            if sql_id == "ADMIN_PURGE_DATA_RUN_EXTERNAL_REFS":
                return {"REFERENCE_COUNT": 0}
            if sql_id == "ADMIN_PURGE_IMPACT_COUNTS":
                return {}
            raise AssertionError(sql_id)

        def fetch_all(_conn, sql_id, _params=None):
            if sql_id == "ADMIN_PURGE_REQUIRED_TABLES_MISSING":
                return []
            if sql_id == "ADMIN_PURGE_SCENARIO_MANAGED_TABLES":
                return [mapping]
            if sql_id == "ADMIN_PURGE_MANAGED_TABLE_PROJECT_OWNERS":
                return [{"PROJECT_ID": 10}]
            raise AssertionError(sql_id)

        with (
            patch.object(purge_service, "_load_context", return_value=context),
            patch.object(purge_service, "_fetch_one", side_effect=fetch_one),
            patch.object(purge_service, "_fetch_all", side_effect=fetch_all),
            patch.object(purge_service, "_physical_table_exists", return_value=True),
        ):
            preview = purge_service.build_purge_preview(
                conn,
                purge_service.SCOPE_SCENARIO,
                20,
            )

        self.assertFalse(preview["canPurge"])
        self.assertTrue(any("삭제 범위 밖" in message for message in preview["blockers"]))

    def test_purge_drops_edit_before_source_then_deletes_metadata(self):
        conn = FakeConnection()
        preview = {
            "scopeType": "SCENARIO",
            "targetId": 20,
            "targetCode": "SCENARIO_A",
            "projectId": 10,
            "managedPairs": [
                {
                    "sourceOwner": "TARGET_OWNER",
                    "sourceTable": "INITUP$_PROJECT_A",
                    "editOwner": "TARGET_OWNER",
                    "editTable": "INITDN$_PROJECT_A",
                    "validationError": "",
                }
            ],
            "blockers": [],
            "counts": {},
            "warnings": [],
        }

        with (
            patch.dict(os.environ, {"INIT_ADMIN_KEY": "correct-key"}, clear=True),
            patch.object(purge_service, "build_purge_preview", return_value=preview),
            patch.object(purge_service, "_physical_table_exists", return_value=True),
            patch.object(purge_service, "_assert_managed_pair_still_exclusive") as exclusive_check,
            patch.object(purge_service, "_context_exists", return_value=False),
            patch.object(purge_service.SqlLoader, "get_sql", side_effect=lambda sql_id: sql_id),
        ):
            result = purge_service.purge_scope(
                conn,
                purge_service.SCOPE_SCENARIO,
                20,
                confirmation_code="SCENARIO_A",
                admin_key="correct-key",
            )

        statements = [item[0] for item in conn.statements]
        self.assertTrue(statements[0].startswith('DROP TABLE "TARGET_OWNER"."INITDN$_PROJECT_A"'))
        self.assertTrue(statements[1].startswith('DROP TABLE "TARGET_OWNER"."INITUP$_PROJECT_A"'))
        self.assertEqual(statements[2], "ADMIN_PURGE_RUN_RESULTS_DELETE")
        self.assertEqual(statements[-1], "ADMIN_PURGE_SCOPE_DATA_DELETE")
        self.assertEqual(exclusive_check.call_count, 2)
        self.assertEqual(conn.commit_count, 1)
        self.assertEqual(result["droppedObjectCount"], 2)

    def test_confirmation_code_is_rechecked_before_drop(self):
        conn = FakeConnection()
        preview = {
            "targetCode": "EXPECTED_CODE",
            "projectId": 10,
            "managedPairs": [],
            "blockers": [],
            "counts": {},
            "warnings": [],
        }
        with (
            patch.dict(os.environ, {"INIT_ADMIN_KEY": "correct-key"}, clear=True),
            patch.object(purge_service, "build_purge_preview", return_value=preview),
        ):
            with self.assertRaises(HTTPException) as error:
                purge_service.purge_scope(
                    conn,
                    purge_service.SCOPE_PROJECT,
                    10,
                    confirmation_code="WRONG_CODE",
                    admin_key="correct-key",
                )

        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(conn.statements, [])


class AdminScopePurgeRouterSecurityTests(unittest.TestCase):
    def test_all_purge_endpoints_reject_non_admin_before_target_connection(self):
        request = MagicMock()
        cases = [
            (
                M01001,
                M01001.preview_project_purge,
                M01001.ProjectDeleteRequest(projectId=10),
            ),
            (
                M01001,
                M01001.purge_project,
                M01001.ProjectPurgeRequest(
                    projectId=10,
                    confirmationCode="PROJECT_A",
                    adminKey="never-used",
                ),
            ),
            (
                M01002,
                M01002.preview_scenario_purge,
                M01002.ScenarioDeleteRequest(scenarioId=20),
            ),
            (
                M01002,
                M01002.purge_scenario,
                M01002.ScenarioPurgeRequest(
                    scenarioId=20,
                    confirmationCode="SCENARIO_A",
                    adminKey="never-used",
                ),
            ),
        ]

        for router_module, endpoint, payload in cases:
            with self.subTest(endpoint=endpoint.__name__):
                with (
                    patch.object(
                        router_module,
                        "require_admin_role",
                        side_effect=HTTPException(status_code=403, detail="Administrator permission is required."),
                    ),
                    patch.object(router_module, "get_target_db_connection") as get_connection,
                ):
                    with self.assertRaises(HTTPException) as error:
                        endpoint(payload, request)
                self.assertEqual(error.exception.status_code, 403)
                get_connection.assert_not_called()


class M01001AdminProjectVisibilityTests(unittest.TestCase):
    def test_project_list_scope_comes_from_server_role(self):
        request = MagicMock()
        for role_code, expected_scope in (("ADMIN", "Y"), ("USER", "N")):
            with self.subTest(role_code=role_code):
                conn = MagicMock()
                with (
                    patch.object(M01001, "get_request_user_id", return_value=7),
                    patch.object(M01001, "get_request_role_code", return_value=role_code),
                    patch.object(M01001, "get_target_db_connection", return_value=conn),
                    patch.object(
                        M01001,
                        "execute_query",
                        return_value={"status": "success", "data": [], "columns": [], "total": 0},
                    ) as execute_query,
                ):
                    M01001.get_projects(request, keyword="")

                params = execute_query.call_args.args[2]
                self.assertEqual(params["userId"], 7)
                self.assertEqual(params["includeAllUsers"], expected_scope)

    def test_admin_can_read_foreign_project_detail_without_expanding_save_scope(self):
        request = MagicMock()
        conn = MagicMock()
        with (
            patch.object(M01001, "get_request_user_id", return_value=7),
            patch.object(M01001, "get_request_role_code", return_value="ADMIN"),
            patch.object(M01001, "get_target_db_connection", return_value=conn),
            patch.object(
                M01001,
                "execute_query",
                return_value={
                    "status": "success",
                    "data": [{"PROJECT_ID": 99, "IS_OWNER_YN": "N"}],
                    "columns": ["PROJECT_ID", "IS_OWNER_YN"],
                },
            ) as execute_query,
        ):
            result = M01001.get_project(request, projectId=99)

        params = execute_query.call_args.args[2]
        self.assertEqual(params["includeAllUsers"], "Y")
        self.assertEqual(result["data"]["IS_OWNER_YN"], "N")
        self.assertIn("AND USER_ID = :userId", SqlLoader.get_sql("M01001_PROJECT_UPDATE"))
        self.assertIn("AND USER_ID = :userId", SqlLoader.get_sql("M01001_PROJECT_DELETE"))


if __name__ == "__main__":
    unittest.main()
