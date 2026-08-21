import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import anly_work_service
from backend.services import flow_work_router


class FakeConnection:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


def _route_endpoint(router, path: str, method: str = "GET"):
    for route in router.routes:
        if route.path == path and method in route.methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


class WorkBootstrapEquivalenceTests(unittest.TestCase):
    def test_m04002_bootstrap_uses_same_run_query_helper_as_individual_api(self):
        connections = []

        def get_connection(_request):
            conn = FakeConnection()
            connections.append(conn)
            return conn

        projects = {
            "status": "success",
            "data": [{"PROJECT_ID": 10, "PROJECT_NAME": "P"}],
            "columns": ["PROJECT_ID", "PROJECT_NAME"],
            "total": 1,
        }
        scenarios = {
            "status": "success",
            "data": [{"SCENARIO_ID": 20, "SCENARIO_NAME": "S"}],
            "columns": ["SCENARIO_ID", "SCENARIO_NAME"],
            "total": 1,
        }
        runs = {
            "status": "success",
            "data": [{"FLOW_RUN_ID": 30, "TOTAL_COUNT": 1}],
            "columns": ["FLOW_RUN_ID", "TOTAL_COUNT"],
            "total": 1,
            "page": 1,
            "pageSize": 20,
        }
        nodes = {
            "status": "success",
            "data": [{"FLOW_NODE_RUN_ID": 40, "RESULT_KIND": "TABLE"}],
            "columns": ["FLOW_NODE_RUN_ID", "RESULT_KIND"],
            "total": 1,
        }
        run_calls = []

        def fetch_runs(_conn, **kwargs):
            run_calls.append(kwargs)
            return runs

        with ExitStack() as stack:
            stack.enter_context(patch.object(anly_work_service, "get_target_db_connection", get_connection))
            stack.enter_context(patch.object(anly_work_service, "get_request_user_id", lambda _request: 7))
            stack.enter_context(patch.object(anly_work_service, "get_request_role_code", lambda _request: "USER"))
            stack.enter_context(patch.object(anly_work_service.work_context_service, "list_projects", lambda *_args, **_kwargs: projects))
            stack.enter_context(patch.object(anly_work_service.work_context_service, "list_scenarios", lambda *_args, **_kwargs: scenarios))
            stack.enter_context(patch.object(anly_work_service, "fetch_flow_runs", fetch_runs))
            stack.enter_context(patch.object(anly_work_service, "fetch_flow_run_nodes", lambda *_args, **_kwargs: nodes))

            request = SimpleNamespace()
            individual = anly_work_service.list_flow_runs(
                request=request,
                projectId=10,
                scenarioId=20,
            )
            bootstrap = anly_work_service.get_analysis_bootstrap(
                request=request,
                preferred_project_id=10,
                preferred_scenario_id=20,
            )

        self.assertEqual(bootstrap["runs"], individual)
        self.assertEqual(bootstrap["nodes"], nodes)
        self.assertEqual(bootstrap["selection"], {
            "projectId": 10,
            "scenarioId": 20,
            "flowRunId": 30,
            "runPage": 1,
        })
        self.assertEqual(len(run_calls), 2)
        self.assertEqual(run_calls[0], run_calls[1])
        self.assertTrue(all(conn.closed for conn in connections))

    def test_model_result_summary_returns_unchanged_individual_sections(self):
        conn = FakeConnection()
        detail = {"status": "success", "modelName": "MODEL_1", "views": []}
        rules = {"status": "success", "modelName": "MODEL_1", "rules": [], "page": 1}
        seen_connections = []

        def get_detail(**kwargs):
            seen_connections.append(kwargs.get("_connection"))
            return detail

        def get_rules(**kwargs):
            seen_connections.append(kwargs.get("_connection"))
            return rules

        with ExitStack() as stack:
            stack.enter_context(patch.object(anly_work_service, "get_target_db_connection", lambda _request: conn))
            stack.enter_context(patch.object(anly_work_service, "get_model_detail_summary", get_detail))
            stack.enter_context(patch.object(anly_work_service, "get_model_rule_summary", get_rules))
            combined = anly_work_service.get_model_result_summary(
                request=SimpleNamespace(),
                owner="OWNER1",
                model_name="MODEL_1",
                flow_run_id=30,
            )

        self.assertIs(combined["detail"], detail)
        self.assertIs(combined["rules"], rules)
        self.assertEqual(combined["rulesError"], "")
        self.assertEqual(seen_connections, [conn, conn])
        self.assertTrue(conn.closed)

    def test_model_result_summary_keeps_detail_when_optional_rules_fail(self):
        conn = FakeConnection()
        detail = {"status": "success", "modelName": "MODEL_1", "views": []}

        with ExitStack() as stack:
            stack.enter_context(patch.object(anly_work_service, "get_target_db_connection", lambda _request: conn))
            stack.enter_context(patch.object(anly_work_service, "get_model_detail_summary", lambda **_kwargs: detail))
            stack.enter_context(patch.object(
                anly_work_service,
                "get_model_rule_summary",
                lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("rule query failed")),
            ))
            combined = anly_work_service.get_model_result_summary(
                request=SimpleNamespace(),
                owner="OWNER1",
                model_name="MODEL_1",
            )

        self.assertIs(combined["detail"], detail)
        self.assertIsNone(combined["rules"])
        self.assertEqual(combined["rulesError"], "rule query failed")
        self.assertTrue(conn.closed)

    def test_m04001_bootstrap_section_matches_individual_scenario_table_api(self):
        router = flow_work_router.create_flow_work_router(
            menu_code="M04001",
            sql_prefix="M04001",
        )
        connections = []

        def get_connection(_request):
            conn = FakeConnection()
            connections.append(conn)
            return conn

        query_results = {
            "M04001_FLOW_NODE_TYPE_LIST": {"status": "success", "data": [{"NODE_TYPE": "JOB"}]},
            "M04001_FLOW_DEFAULT_VARIABLE_LIST": {"status": "success", "data": [{"VARIABLE_NAME": "V1"}]},
            "FLOW_WORK_SCENARIO_TABLE_LIST": {"status": "success", "data": [{"SCENARIO_TABLE_ID": 99}]},
            "FLOW_WORK_DATA_JOB_ASSET_LIST": {"status": "success", "data": [{"WORK_JOB_ID": 88}]},
            "M01002_PROJECT_OWNER_CHECK": {"status": "success", "data": [{"CNT": 1}]},
        }

        with ExitStack() as stack:
            stack.enter_context(patch.object(flow_work_router, "get_target_db_connection", get_connection))
            stack.enter_context(patch.object(flow_work_router, "get_request_user_id", lambda _request: 7))
            stack.enter_context(patch.object(flow_work_router, "get_request_role_code", lambda _request: "USER"))
            stack.enter_context(patch.object(
                flow_work_router,
                "execute_query",
                lambda _conn, sql_id, _params=None: query_results[sql_id],
            ))
            stack.enter_context(patch.object(
                flow_work_router.work_context_service,
                "list_projects",
                lambda *_args, **_kwargs: {
                    "status": "success",
                    "data": [{"PROJECT_ID": 10, "USE_YN": "Y"}],
                    "columns": ["PROJECT_ID", "USE_YN"],
                    "total": 1,
                },
            ))
            stack.enter_context(patch.object(
                flow_work_router.work_context_service,
                "list_scenarios",
                lambda *_args, **_kwargs: {
                    "status": "success",
                    "data": [{"SCENARIO_ID": 20}],
                    "columns": ["SCENARIO_ID"],
                    "total": 1,
                },
            ))
            stack.enter_context(patch.object(
                flow_work_router.flow_work,
                "list_flows",
                lambda *_args, **_kwargs: {"status": "success", "data": [{"FLOW_ID": 30}]},
            ))
            stack.enter_context(patch.object(
                flow_work_router.flow_work,
                "load_flow",
                lambda *_args, **_kwargs: {
                    "FLOW_ID": 30,
                    "PROJECT_ID": 10,
                    "SCENARIO_ID": 20,
                    "NODES": [],
                    "EDGES": [],
                },
            ))

            request = SimpleNamespace()
            bootstrap_endpoint = _route_endpoint(router, "/bootstrap")
            scenario_endpoint = _route_endpoint(router, "/scenario-tables")
            bootstrap = bootstrap_endpoint(
                request=request,
                preferredProjectId=10,
                preferredScenarioId=20,
                preferredFlowId=30,
                includeHistory=False,
            )
            individual = scenario_endpoint(request=request, projectId=10, scenarioId=20)

        self.assertEqual(bootstrap["scenarioTables"], individual)
        self.assertEqual(bootstrap["selection"], {"projectId": 10, "scenarioId": 20, "flowId": 30})
        self.assertIsNone(bootstrap["history"])
        self.assertTrue(all(conn.closed for conn in connections))

    def test_new_composite_routes_are_registered(self):
        analysis_router = __import__(
            "backend.services.anly_work_router",
            fromlist=["create_anly_work_router"],
        ).create_anly_work_router("M04002")
        analysis_paths = {route.path for route in analysis_router.routes}
        flow_paths = {
            route.path
            for route in flow_work_router.create_flow_work_router("M04001", "M04001").routes
        }

        self.assertIn("/bootstrap", analysis_paths)
        self.assertIn("/model-result-summary", analysis_paths)
        self.assertIn("/bootstrap", flow_paths)

    def test_m04001_snapshot_skips_node_query_when_version_is_unchanged(self):
        router = flow_work_router.create_flow_work_router("M04001", "M04001")
        endpoint = _route_endpoint(router, "/run/{flow_run_id}/snapshot")
        run_row = {
            "FLOW_RUN_ID": 30,
            "STATUS": "RUNNING",
            "MESSAGE": "working",
            "STARTED_AT": "2026-08-21T10:00:00",
            "FINISHED_AT": None,
            "NODE_UPDATED_AT": "2026-08-21T10:00:01",
        }
        node_query_count = 0

        def list_nodes(*_args, **_kwargs):
            nonlocal node_query_count
            node_query_count += 1
            return {"status": "success", "data": [{"FLOW_NODE_RUN_ID": 40}]}

        with ExitStack() as stack:
            stack.enter_context(patch.object(flow_work_router, "get_target_db_connection", lambda _request: FakeConnection()))
            stack.enter_context(patch.object(flow_work_router, "get_request_role_code", lambda _request: "ADMIN"))
            stack.enter_context(patch.object(flow_work_router.flow_work, "get_run", lambda *_args, **_kwargs: dict(run_row)))
            stack.enter_context(patch.object(flow_work_router.flow_work, "list_node_runs", list_nodes))

            first = endpoint(
                flow_run_id=30,
                request=SimpleNamespace(),
                projectId=10,
                scenarioId=20,
                ifVersion=None,
            )
            second = endpoint(
                flow_run_id=30,
                request=SimpleNamespace(),
                projectId=10,
                scenarioId=20,
                ifVersion=first["version"],
            )

        self.assertTrue(first["changed"])
        self.assertFalse(second["changed"])
        self.assertIsNone(second["data"])
        self.assertEqual(node_query_count, 1)


if __name__ == "__main__":
    unittest.main()
