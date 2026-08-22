from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.routers import M04001
from backend.database_helper import SqlLoader
from backend.services.flow_work_router import normalize_quick_edit_summary
from backend.services import flow_work_service


ROOT_DIR = Path(__file__).resolve().parents[2]


def get_route_endpoint(path: str, method: str):
    for route in M04001.router.routes:
        if route.path == path and method.upper() in route.methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


class QuickEditHistoryTests(unittest.TestCase):
    def test_quick_edit_elapsed_time_matches_m04001_timezone_and_waiting_rules(self):
        renderers_js = (ROOT_DIR / "quick-edit" / "js" / "renderers.js").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        flow_js = (ROOT_DIR / "frontend" / "js" / "MCOM_FLOW_WORK.js").read_text(encoding="utf-8")

        self.assertIn("return new Date(Date.UTC(", renderers_js)
        self.assertIn('timeZone: "Asia/Seoul"', renderers_js)
        self.assertIn('["PENDING", "QUEUED", "SUBMITTED"]', renderers_js)
        self.assertIn("R.formatDuration(node.STARTED_AT, node.FINISHED_AT, status)", quick_js)
        self.assertIn('if (!finishedAt && statusText === "QUEUED") return "Queued";', flow_js)
        self.assertIn('const isRunning = !finishedAt && ["RUNNING", "STARTED"].includes(statusText);', flow_js)

    def test_new_workspace_is_the_default_quick_edit_mode(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")

        self.assertIn('id="projectModeNew" type="radio" name="projectMode" value="new" checked', quick_html)
        self.assertIn('data-project-mode-panel="new">', quick_html)
        self.assertIn('data-project-mode-panel="existing" hidden>', quick_html)
        self.assertIn('workspaceMode: "new"', quick_js)
        self.assertIn('state.workspaceMode = "new";', quick_js)

    def test_quick_edit_summary_is_compact_and_normalized(self):
        summary = normalize_quick_edit_summary({
            "source": "quick_edit",
            "projectCode": "QE_20260821",
            "projectName": "퀵 에디팅 20260821-143000",
            "projectCreatedAt": "2026-08-21T05:30:00",
            "scenarioCreatedAt": "2026-08-21T05:30:01",
            "ownerName": "init$edit01",
            "tableName": "initup$qedit",
            "fileSize": "2048",
            "estimatedRowCount": -1,
        })

        self.assertEqual("QUICK_EDIT", summary["source"])
        self.assertEqual(1, summary["version"])
        self.assertEqual("INIT$EDIT01", summary["ownerName"])
        self.assertEqual("INITUP$QEDIT", summary["tableName"])
        self.assertEqual(2048, summary["fileSize"])
        self.assertIsNone(summary["estimatedRowCount"])
        self.assertEqual("2026-08-21T05:30:00", summary["projectCreatedAt"])
        self.assertEqual("2026-08-21T05:30:01", summary["scenarioCreatedAt"])

    def test_completed_workspace_summary_shows_menu_keys_and_kst_created_times(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        renderers_js = (ROOT_DIR / "quick-edit" / "js" / "renderers.js").read_text(encoding="utf-8")

        self.assertIn('id="qeWorkspaceSummary"', quick_html)
        self.assertIn("프로젝트 설정 [M01001]", quick_html)
        self.assertIn("시나리오 정의 [M01002]", quick_html)
        self.assertIn("function renderWorkspaceSummary()", quick_js)
        self.assertIn('state.completedSteps.includes(7)', quick_js)
        self.assertIn("projectCreatedAt: state.projectCreatedAt", quick_js)
        self.assertIn("scenarioCreatedAt: state.scenarioCreatedAt", quick_js)
        self.assertIn("function formatFullDateTime(value)", renderers_js)
        self.assertIn('timeZone: "Asia/Seoul"', renderers_js)
        self.assertIn(" KST`;", renderers_js)

    def test_completed_run_keeps_quick_edit_summary(self):
        conn = Mock()
        summary = {"source": "QUICK_EDIT", "projectName": "Quick project"}

        with (
            patch("backend.services.flow_work_service.prepare_flow_run_session"),
            patch("backend.services.flow_work_service.update_run") as update_run,
        ):
            flow_work_service.execute_flow_plan(
                conn,
                1044,
                [],
                run_context={"quickEditSummary": summary},
            )

        persisted_plan = update_run.call_args.args[4]
        self.assertEqual(summary, persisted_plan["quickEditSummary"])

    def test_history_sql_uses_summary_path_and_legacy_fallback(self):
        sql = SqlLoader.get_sql("FLOW_WORK_QUICK_EDIT_HISTORY")

        self.assertIn("STORED_QUICK_RUNS", sql)
        self.assertIn("R.RUN_TYPE = 'QUICK_EDIT'", sql)
        self.assertIn("'$.quickEditSummary' NULL ON ERROR", sql)
        self.assertIn("PROJECT_NAME VARCHAR2(200) PATH '$.projectName'", sql)
        self.assertIn("PROJECT_CREATED_AT VARCHAR2(64) PATH '$.projectCreatedAt'", sql)
        self.assertIn("SCENARIO_CREATED_AT VARCHAR2(64) PATH '$.scenarioCreatedAt'", sql)
        self.assertIn("PR.SUMMARY_YN = 'Y'", sql)
        self.assertIn("LEGACY_RUN_SCOPE", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QEDIT\\_%'", sql)
        self.assertIn("DBMS_LOB.INSTR", sql)

    def test_history_list_sql_uses_only_saved_summary_rows(self):
        sql = SqlLoader.get_sql("FLOW_WORK_QUICK_EDIT_HISTORY_LIST")

        self.assertIn("R.RUN_TYPE = 'QUICK_EDIT'", sql)
        self.assertIn("'$.quickEditSummary' NULL ON ERROR", sql)
        self.assertIn("PAGED_RUNS", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QE\\_%'", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QEDIT\\_%'", sql)
        self.assertNotIn("LEGACY_RUN_SCOPE", sql)
        self.assertNotIn("DBMS_LOB.INSTR", sql)
        self.assertNotIn("ALL_TABLES", sql)
        self.assertNotIn("INIT$_TB_DATA_WORK_JOB", sql)

    def test_history_list_uses_fast_query_without_loading_detail(self):
        conn = Mock()
        query_result = {
            "status": "success",
            "data": [{"FLOW_RUN_ID": 1041, "TOTAL_COUNT": 1}],
        }

        with patch(
            "backend.services.flow_work_service.execute_query",
            return_value=query_result,
        ) as execute_query:
            response = flow_work_service.list_quick_edit_history(
                conn,
                "M04001",
                7,
                False,
                1,
                20,
            )

        self.assertEqual(1, response["total"])
        self.assertEqual(1, execute_query.call_count)
        self.assertEqual("FLOW_WORK_QUICK_EDIT_HISTORY_LIST", execute_query.call_args.args[1])

    def test_empty_history_list_does_not_trigger_expensive_fallback(self):
        conn = Mock()

        with patch(
            "backend.services.flow_work_service.execute_query",
            return_value={"status": "success", "data": []},
        ) as execute_query:
            response = flow_work_service.list_quick_edit_history(
                conn,
                "M04001",
                7,
                False,
                1,
                20,
            )

        self.assertEqual(0, response["total"])
        self.assertEqual(1, execute_query.call_count)
        self.assertEqual("FLOW_WORK_QUICK_EDIT_HISTORY_LIST", execute_query.call_args.args[1])

    def test_history_dialog_has_animated_initial_loading_bar(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")

        loading_class = "qe-run-history-loading-bar--dialog"
        self.assertIn(loading_class, quick_html)
        self.assertIn(loading_class, quick_js)
        self.assertIn(f".{loading_class}", quick_css)
        self.assertIn("@keyframes qe-history-loading", quick_css)

    def test_rule_details_render_inline_with_readable_quick_messages(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")

        self.assertIn('id="qeCategoricalDetail"', quick_html)
        self.assertIn('id="qeContinuousRuleSummary"', quick_html)
        self.assertNotIn('id="qeRuleDialog"', quick_html)
        self.assertIn("function openInlineRuleDetail", quick_js)
        self.assertIn('byId("qeCategoricalDetail")', quick_js)
        self.assertIn('byId("qeContinuousDetail")', quick_js)
        self.assertIn("핵심 안내", quick_js)
        self.assertNotIn("rule.MESSAGE", quick_js)
        self.assertIn(".qe-rule-fields--inline dd", quick_css)
        self.assertIn("font-size: 14px", quick_css)

    def test_success_detail_restores_all_eight_steps_without_run_request(self):
        detail = flow_work_service.build_quick_edit_history_detail(
            {
                "FLOW_RUN_ID": 1041,
                "FLOW_ID": 88,
                "PROJECT_ID": 10,
                "PROJECT_CODE": "P10",
                "PROJECT_NAME": "Quick project",
                "PROJECT_CREATED_AT": "2026-08-21T05:30:00",
                "SCENARIO_ID": 20,
                "SCENARIO_CODE": "S20",
                "SCENARIO_NAME": "Quick scenario",
                "SCENARIO_CREATED_AT": "2026-08-21T05:30:01",
                "SCENARIO_TABLE_ID": 30,
                "OWNER_NAME": "INIT$EDIT01",
                "TABLE_NAME": "INITUP$QEDIT",
                "FLOW_NAME": "Quick flow",
                "STATUS": "SUCCESS",
                "MESSAGE": "Completed",
                "NODE_COUNT": 4,
                "SUCCESS_NODE_COUNT": 4,
            },
            [
                {"REF_WORK_JOB_ID": 101, "STATUS": "SUCCESS"},
                {"REF_WORK_JOB_ID": 102, "STATUS": "SUCCESS"},
                {"REF_WORK_JOB_ID": 103, "STATUS": "SUCCESS"},
                {"REF_WORK_JOB_ID": 104, "STATUS": "SUCCESS"},
            ],
        )

        self.assertEqual(list(range(8)), detail["restoreState"]["completedSteps"])
        self.assertEqual("success", detail["restoreState"]["status"])
        self.assertTrue(detail["restoreState"]["historyView"])
        self.assertEqual([101, 102, 103, 104], detail["restoreState"]["jobIds"])
        self.assertEqual("2026-08-21T05:30:00", detail["restoreState"]["projectCreatedAt"])
        self.assertEqual("2026-08-21T05:30:01", detail["restoreState"]["scenarioCreatedAt"])
        self.assertEqual(8, len(detail["steps"]))

    def test_failed_detail_stops_at_saved_execution_step(self):
        detail = flow_work_service.build_quick_edit_history_detail(
            {
                "FLOW_RUN_ID": 1042,
                "FLOW_ID": 89,
                "PROJECT_ID": 10,
                "SCENARIO_ID": 20,
                "SCENARIO_TABLE_ID": 31,
                "OWNER_NAME": "INIT$EDIT01",
                "TABLE_NAME": "INITUP$FAILED",
                "STATUS": "FAILED",
                "MESSAGE": "Node failed",
            },
            [{"REF_WORK_JOB_ID": 201, "STATUS": "FAILED"}],
        )

        self.assertEqual(list(range(6)), detail["restoreState"]["completedSteps"])
        self.assertEqual(6, detail["restoreState"]["currentStep"])
        self.assertEqual("failed", detail["restoreState"]["status"])
        self.assertEqual("FAILED", detail["steps"][6]["status"])
        self.assertEqual("PENDING", detail["steps"][7]["status"])

    def test_history_detail_returns_404_when_run_is_not_visible(self):
        endpoint = get_route_endpoint("/quick-edit/history/{flow_run_id}", "GET")
        conn = Mock()
        request = Mock()

        with (
            patch("backend.services.flow_work_router.get_target_db_connection", return_value=conn),
            patch("backend.services.flow_work_router.get_request_user_id", return_value=7),
            patch("backend.services.flow_work_router.get_request_role_code", return_value="USER"),
            patch(
                "backend.services.flow_work_router.flow_work.list_quick_edit_history",
                return_value={"status": "success", "data": [], "total": 0},
            ),
            patch("backend.services.flow_work_router.flow_work.list_node_runs") as list_nodes,
        ):
            with self.assertRaises(HTTPException) as raised:
                endpoint(9999, request)

        self.assertEqual(404, raised.exception.status_code)
        list_nodes.assert_not_called()
        conn.close.assert_called_once()

    def test_completed_step_exposes_m04002_result_detail_handoff(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        analysis_js = (ROOT_DIR / "frontend" / "js" / "MCOM_ANLY_WORK.js").read_text(encoding="utf-8")
        analysis_css = (ROOT_DIR / "frontend" / "css" / "pages" / "MCOM_ANLY_WORK.css").read_text(encoding="utf-8")

        analysis_step = quick_html.index('data-step="7" data-step-key="analysis"')
        detail_button = quick_html.index('id="qeOpenDetailedAnalysis"')
        self.assertGreater(detail_button, analysis_step)
        self.assertEqual(1, quick_html.count('id="qeOpenDetailedAnalysis"'))
        self.assertIn("결과상세", quick_html[detail_button:detail_button + 1000])
        self.assertIn("state.completedSteps.includes(7)", quick_js)
        action_state_section = quick_js.split("function updateActionState()", 1)[1].split("async function runPipeline", 1)[0]
        self.assertIn("updateResultDetailAction();", action_state_section)
        self.assertIn('sessionStorage.setItem("M04002:selectedProjectId"', quick_js)
        self.assertIn('sessionStorage.setItem("M04002:selectedScenarioId"', quick_js)
        self.assertIn('sessionStorage.setItem("M04002:selectedRunId"', quick_js)
        self.assertIn('await appWindow.PageManager.load("M04002"', quick_js)
        self.assertIn('sessionStorage.getItem(`${PAGE_CODE}:selectedRunId`)', analysis_js)
        self.assertIn('params.set("preferredFlowRunId"', analysis_js)
        bootstrap_section = analysis_js.split("async loadBootstrap", 1)[1].split("\n        applyProjectsResponse(", 1)[0]
        self.assertLess(
            bootstrap_section.index("this.selectedRun = this.runs.find"),
            bootstrap_section.index("this.renderRuns();"),
        )
        self.assertIn('String(this.selectedRun?.FLOW_RUN_ID ?? "") === String(run.FLOW_RUN_ID ?? "")', analysis_js)
        self.assertIn('aria-current="${isSelected ? "true" : "false"}"', analysis_js)
        self.assertIn(".anly-work-run-card.is-selected", analysis_css)
        self.assertIn("box-shadow: inset 0 0 0 1px #2563eb", analysis_css)

    def test_quick_edit_uses_the_same_m04001_saved_flow_executor(self):
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        api_client_js = (ROOT_DIR / "quick-edit" / "js" / "api-client.js").read_text(encoding="utf-8")
        flow_router = (ROOT_DIR / "backend" / "services" / "flow_work_router.py").read_text(encoding="utf-8")

        self.assertIn("client.runSavedFlow(", quick_js)
        self.assertIn('this.request("/M04001/flow/run-saved"', api_client_js)
        saved_run_section = flow_router.split('@router.post("/flow/run-saved")', 1)[1].split("    @router.", 1)[0]
        standard_run_section = flow_router.split('@router.post("/flow/run")', 1)[1].split("    @router.", 1)[0]
        self.assertIn("response = queue_flow_run(", saved_run_section)
        self.assertIn("response = queue_flow_run(", standard_run_section)
        self.assertIn('run_status = "QUEUED" if req.batch else "STARTED"', flow_router)
        self.assertIn("run_flow_background,", flow_router)
        self.assertIn("flow_work.execute_flow_plan(", flow_router)

    def test_quick_edit_requests_per_legend_violation_candidates(self):
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        api_client_js = (ROOT_DIR / "quick-edit" / "js" / "api-client.js").read_text(encoding="utf-8")
        analysis_sql = (ROOT_DIR / "database" / "MCOM_ANLY_WORK.sql").read_text(encoding="utf-8")
        analysis_service = (ROOT_DIR / "backend" / "services" / "anly_work_service.py").read_text(encoding="utf-8")

        self.assertIn("balancedRuleSummaryYn: true", quick_js)
        self.assertIn('balancedRuleSummaryYn: params.balancedRuleSummaryYn ? "Y" : undefined', api_client_js)
        self.assertIn("summary.balancedTopRules", quick_js)
        self.assertIn("PARTITION BY S.CONDITION_COUNT", analysis_sql)
        self.assertIn("PARTITION BY S.RESULT_COLUMN", analysis_sql)
        self.assertIn("PARTITION BY S.TARGET_COLUMN", analysis_sql)
        self.assertIn("PARTITION BY NVL(S.METHOD, '(UNKNOWN)')", analysis_sql)
        self.assertIn("MCOMMON_ANLY_WORK_ASSOC_RULE_BALANCED_VIOLATIONS", analysis_service)
        self.assertIn("MCOMMON_ANLY_WORK_SYMBOLIC_RULE_BALANCED_VIOLATIONS", analysis_service)

    def test_violation_paging_updates_only_the_existing_grid_regions(self):
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        paging_section = quick_js.split("function renderRuleViolationRows", 1)[1].split(
            "function renderQuickHistoryList", 1
        )[0]

        self.assertIn('target.querySelector("[data-violation-grid]")', paging_section)
        self.assertIn("gridTarget.innerHTML = gridMarkup", paging_section)
        self.assertIn("paginationTarget.innerHTML = paginationMarkup", paging_section)
        self.assertIn("data-violation-summary", paging_section)
        self.assertIn("data-violation-pagination", paging_section)


if __name__ == "__main__":
    unittest.main()
