from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.routers import M04001
from backend.database_helper import SqlLoader
from backend.services.flow_work_router import build_failed_stage_rerun_plan, normalize_quick_edit_summary
from backend.services import flow_work_service
from backend.services.flow_work_service import FlowRunRequest


ROOT_DIR = Path(__file__).resolve().parents[2]


def get_route_endpoint(path: str, method: str):
    for route in M04001.router.routes:
        if route.path == path and method.upper() in route.methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


class QuickEditHistoryTests(unittest.TestCase):
    def test_primary_actions_are_above_stepper_and_sample_download_matches_m02001(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        upload_html = (ROOT_DIR / "frontend" / "pages" / "M02001.html").read_text(encoding="utf-8")
        sample_href = 'href="/samples/national_household_living_survey_sample.csv"'

        intro_start = quick_html.index('<section class="qe-intro"')
        stepper_start = quick_html.index('<nav class="qe-stepper-wrap"')
        intro_markup = quick_html[intro_start:stepper_start]
        self.assertIn('class="qe-intro__actions"', intro_markup)
        self.assertIn('id="runButton"', intro_markup)
        self.assertIn('form="qeQuickForm"', intro_markup)
        self.assertLess(intro_markup.index('id="runButton"'), intro_markup.index('class="qe-intro__badge"'))
        self.assertEqual(1, quick_html.count('id="runButton"'))
        self.assertIn(sample_href, quick_html)
        self.assertIn(sample_href, upload_html)

    def test_history_editing_exposes_workspace_reuse_rerun_actions(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        api_client_js = (ROOT_DIR / "quick-edit" / "js" / "api-client.js").read_text(encoding="utf-8")

        new_start = quick_html.index('id="runButton"')
        full_rerun = quick_html.index('id="qeHistoryFullRerunButton"')
        failed_rerun = quick_html.index('id="qeHistoryFailedRerunButton"')
        self.assertLess(new_start, full_rerun)
        self.assertLess(full_rerun, failed_rerun)
        self.assertIn("전체 자동 재실행", quick_html[full_rerun:failed_rerun])
        self.assertIn("실패단계부터 재실행", quick_html[failed_rerun:failed_rerun + 400])
        self.assertIn("pipelineAction: PIPELINE_ACTION.HISTORY_FULL_RERUN", quick_js)
        self.assertIn("client.rerunSavedFlowFromFailure(", quick_js)
        self.assertIn("Number(state.projectId) !== savedWorkspace.projectId", quick_js)
        failed_handler = quick_js.split("async function rerunHistoryFromFailedStage", 1)[1].split(
            "\n    function bindEvents", 1
        )[0]
        self.assertNotIn("state.historyView = false", failed_handler)
        full_handler = quick_js.split("async function rerunEntireHistoryFlow", 1)[1].split(
            "\n    async function rerunHistoryFromFailedStage", 1
        )[0]
        self.assertNotIn("state.historyView = false", full_handler)
        action_state = quick_js.split("function updateActionState()", 1)[1].split(
            "\n    async function runPipeline", 1
        )[0]
        self.assertIn("setRunningState(startButton, PIPELINE_ACTION.FULL_AUTO);", action_state)
        self.assertIn(
            "setRunningState(historyFullRerunButton, PIPELINE_ACTION.HISTORY_FULL_RERUN);",
            action_state,
        )
        self.assertIn(
            "setRunningState(historyFailedRerunButton, PIPELINE_ACTION.HISTORY_FAILED_RERUN);",
            action_state,
        )
        self.assertNotIn('startButton.classList.toggle("is-running", pipelineBusy)', action_state)
        self.assertIn("activePipelineAction = PIPELINE_ACTION.HISTORY_FAILED_RERUN;", failed_handler)
        self.assertIn('this.request("/M04001/flow/rerun-saved-failed-stage"', api_client_js)
        get_route_endpoint("/flow/rerun-saved-failed-stage", "POST")

        flow_router = (ROOT_DIR / "backend" / "services" / "flow_work_router.py").read_text(encoding="utf-8")
        failed_route = flow_router.split("def rerun_saved_flow_from_failed_stage", 1)[1].split(
            "\n    def run_flow_background", 1
        )[0]
        self.assertIn("saved_request = FlowRunRequest(", failed_route)
        self.assertIn("saved_request.nodes", failed_route)
        self.assertIn("saved_request.edges", failed_route)
        self.assertNotIn("flow_work.normalize_graph(nodes, edges)", failed_route)

        saved_request = FlowRunRequest(
            flowId=88,
            projectId=10,
            scenarioId=20,
            flowName="Saved Quick Editing flow",
            nodes=[{"nodeKey": "N1", "nodeType": "JOB", "nodeName": "M03001"}],
            edges=[],
        )
        normalized_nodes, _ = flow_work_service.normalize_graph(saved_request.nodes, saved_request.edges)
        self.assertEqual("N1", normalized_nodes[0]["nodeKey"])

    def test_failed_stage_rerun_starts_at_first_failed_node_and_keeps_downstream(self):
        plan = [
            {"nodeKey": "N1", "downstream": ["N2"]},
            {"nodeKey": "N2", "downstream": ["N3"]},
            {"nodeKey": "N3", "downstream": ["N4"]},
            {"nodeKey": "N4", "downstream": []},
        ]
        selected, rerun_plan = build_failed_stage_rerun_plan(
            plan,
            [
                {"NODE_KEY": "N1", "STATUS": "SUCCESS"},
                {"NODE_KEY": "N2", "STATUS": "FAILED"},
                {"NODE_KEY": "N3", "STATUS": "SKIPPED"},
                {"NODE_KEY": "N4", "STATUS": "PENDING"},
            ],
        )

        self.assertEqual("N2", selected["nodeKey"])
        self.assertEqual(["N2", "N3", "N4"], [step["nodeKey"] for step in rerun_plan])

    def test_node_run_reexecution_resets_rows_without_deleting_referenced_ids(self):
        reset_sql = SqlLoader.get_sql("FLOW_WORK_NODE_RUN_RESET_BY_RUN_KEY")
        service_source = (ROOT_DIR / "backend" / "services" / "flow_work_service.py").read_text(encoding="utf-8")
        replace_section = service_source.split("def create_node_run_records", 1)[1].split(
            "\n\ndef update_node_run_runtime_params", 1
        )[0]

        self.assertIn("UPDATE", reset_sql.upper())
        self.assertNotIn("DELETE", reset_sql.upper())
        self.assertNotIn("JOB_PARAM_JSON", reset_sql.upper())
        self.assertIn("RUNTIME_PARAM_JSON", reset_sql.upper())
        self.assertIn("NODE_PAYLOAD_JSON", reset_sql.upper())
        self.assertIn("RUN_OUTPUT_JSON", reset_sql.upper())
        self.assertIn('"FLOW_WORK_NODE_RUN_RESET_BY_RUN_KEY"', replace_section)
        self.assertNotIn('"FLOW_WORK_NODE_RUN_DELETE_BY_RUN_KEY"', replace_section)

        conn = Mock()
        cursor = Mock()
        cursor.rowcount = 1
        conn.cursor.return_value = cursor
        with patch("backend.services.flow_work_service.execute_flow_dml") as execute_dml:
            flow_work_service.create_node_run_records(
                conn,
                1241,
                88,
                [
                    {"nodeKey": "M03003-3", "nodeName": "M03003", "nodeType": "JOB", "level": 2},
                    {"nodeKey": "M03004-4", "nodeName": "M03004", "nodeType": "JOB", "level": 3},
                ],
                replace_existing=True,
            )

        self.assertEqual(2, execute_dml.call_count)
        self.assertTrue(all(call.args[2] == "FLOW_WORK_NODE_RUN_RESET_BY_RUN_KEY" for call in execute_dml.call_args_list))
        cursor.close.assert_called_once()

    def test_statistics_summary_cards_match_kpi_populations_and_markers(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")
        render_statistics = quick_js.split("function renderDescriptiveStatistics()", 1)[1].split(
            "function getColumnTypeFinalRows()", 1
        )[0]

        self.assertIn("columns.forEach((column) =>", render_statistics)
        self.assertNotIn("ranked.slice(0, 50)", render_statistics)
        self.assertIn("const highPriorityColumnCount = ranked.filter(isHighPriority).length;", render_statistics)
        self.assertIn("const violationColumnCount = ranked.filter", render_statistics)
        self.assertIn("규칙×행 기준 총 ${R.formatNumber(totalViolations, 0)}건", render_statistics)
        self.assertIn('label: "전체 규칙×행 위반"', render_statistics)
        self.assertIn("50점 이상(HIGH)", render_statistics)
        self.assertIn('id="qeStatisticsInterpretation"', quick_html)
        self.assertIn('id="qeStatisticsMethodology"', quick_html)
        self.assertIn("전체 ${R.escapeHtml(R.formatNumber(ranked.length, 0))}개 컬럼", render_statistics)
        self.assertIn('isPriority ? " is-priority" : ""', render_statistics)
        self.assertIn('violationCount > 0 ? "is-violation" : "is-zero"', render_statistics)
        self.assertIn("const lastViolationIndex = ranked.reduce", render_statistics)
        self.assertIn("Math.ceil((lastViolationIndex + 1) / 3) * 3", render_statistics)
        self.assertIn('class="qe-statistics-extra"', render_statistics)
        self.assertIn("나머지 ${R.escapeHtml(R.formatNumber(remainingCards.length, 0))}개 컬럼 펼쳐보기", render_statistics)
        self.assertIn('aria-label="통계 분석 컬럼 목록"', quick_html)
        self.assertIn(".qe-statistics-priority-card.is-priority", quick_css)
        self.assertIn("em.is-violation", quick_css)
        self.assertIn(".qe-statistics-extra__grid", quick_css)
        self.assertIn(".qe-statistics-interpretation", quick_css)
        self.assertIn(".qe-statistics-methodology__body", quick_css)

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

    def test_csv_upload_requires_and_announces_first_row_header(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")

        self.assertIn('id="qeCsvHeaderRequirement"', quick_html)
        self.assertIn("첫 행에 컬럼명(타이틀)이 포함된 파일만 사용할 수 있습니다.", quick_html)
        self.assertIn('aria-describedby="fileDropHelp qeCsvHeaderRequirement fileMeta"', quick_html)
        self.assertIn('const csvHeaderRequired = getExtension(meta?.name || "") === "csv";', quick_js)
        self.assertIn('const hasHeader = extension === "csv"', quick_js)
        self.assertIn('hasHeaderControl.disabled = csvHeaderRequired || pipelineBusy', quick_js)
        self.assertIn('.qe-csv-header-requirement', quick_css)
        self.assertIn('.qe-check-field[data-csv-header-required="true"]', quick_css)
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
            "estimatedColumnCount": "56",
            "estimatedRowCount": -1,
        })

        self.assertEqual("QUICK_EDIT", summary["source"])
        self.assertEqual(1, summary["version"])
        self.assertEqual("INIT$EDIT01", summary["ownerName"])
        self.assertEqual("INITUP$QEDIT", summary["tableName"])
        self.assertEqual(2048, summary["fileSize"])
        self.assertEqual(56, summary["estimatedColumnCount"])
        self.assertIsNone(summary["estimatedRowCount"])
        self.assertEqual("2026-08-21T05:30:00", summary["projectCreatedAt"])
        self.assertEqual("2026-08-21T05:30:01", summary["scenarioCreatedAt"])

    def test_target_table_progress_keeps_uploaded_column_and_row_counts(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")

        self.assertIn('data-artifact-metrics', quick_html)
        self.assertIn('data-result-dataset-summary', quick_html)
        self.assertIn('data-result-dataset-metrics', quick_html)
        self.assertIn('state.columnCount = upload.columnCount !== null', quick_js)
        self.assertIn('metrics.push(`컬럼 ${R.formatNumber(columnCount, 0)}개`)', quick_js)
        self.assertIn('metrics.push(`로우 ${R.formatNumber(rowCount, 0)}건`)', quick_js)
        self.assertIn('function renderResultDatasetSummary()', quick_js)
        self.assertIn('renderResultDatasetSummary();', quick_js)
        self.assertIn('estimatedColumnCount: state.columnCount === null ? null', quick_js)
        self.assertIn('.qe-artifact-metrics', quick_css)
        self.assertIn('.qe-result-dataset-summary', quick_css)

    def test_target_table_stage_is_separated_and_shows_timing_breakdown(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        api_client_js = (ROOT_DIR / "quick-edit" / "js" / "api-client.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")

        self.assertIn('id="qeTargetTimingDetails"', quick_html)
        self.assertIn('data-target-timing-bottleneck', quick_html)
        self.assertIn('function renderTargetStageTimings()', quick_js)
        self.assertIn('["Oracle 적재", Number(timings.oracleLoadSeconds)]', quick_js)
        self.assertIn('["통계 수집", Number(timings.statisticsSeconds)]', quick_js)
        self.assertIn('completeStep(3, `대상 테이블 등록 완료', quick_js)
        self.assertIn('setStep(4, "기본 4단계 모델과 FLOW 자동 설계를 저장하고 있습니다."', quick_js)
        self.assertIn('provisionDefaultDesign(payload)', api_client_js)
        self.assertIn('autoDesignYn: "N"', api_client_js)
        self.assertIn('.qe-target-timing', quick_css)

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
        self.assertIn("ESTIMATED_COLUMN_COUNT NUMBER PATH '$.estimatedColumnCount'", sql)
        self.assertIn("PR.SUMMARY_YN = 'Y'", sql)
        self.assertIn("LEGACY_RUN_SCOPE", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QEDIT\\_%'", sql)
        self.assertIn("DBMS_LOB.INSTR", sql)

    def test_history_list_sql_uses_only_saved_summary_rows(self):
        sql = SqlLoader.get_sql("FLOW_WORK_QUICK_EDIT_HISTORY_LIST")

        self.assertIn("R.RUN_TYPE = 'QUICK_EDIT'", sql)
        self.assertIn("'$.quickEditSummary' NULL ON ERROR", sql)
        self.assertIn("ESTIMATED_COLUMN_COUNT NUMBER PATH '$.estimatedColumnCount'", sql)
        self.assertIn("PAGED_RUNS", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QE\\_%'", sql)
        self.assertIn("P.PROJECT_CODE LIKE 'QEDIT\\_%'", sql)
        self.assertNotIn("LEGACY_RUN_SCOPE", sql)
        self.assertNotIn("DBMS_LOB.INSTR", sql)
        self.assertNotIn("ALL_TABLES", sql)
        self.assertNotIn("INIT$_TB_DATA_WORK_JOB", sql)
        self.assertIn("R.MESSAGE", sql)
        self.assertIn("PR.MESSAGE", sql)
        self.assertLess(sql.index("R.MESSAGE"), sql.index("PR.MESSAGE"))

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

    def test_modern_history_detail_uses_fast_summary_query_without_legacy_fallback(self):
        conn = Mock()
        query_result = {
            "status": "success",
            "data": [{
                "FLOW_RUN_ID": 1041,
                "RUN_TYPE": "QUICK_EDIT",
                "OWNER_NAME": "INIT$EDIT01",
                "TABLE_NAME": "INITUP$QEDIT",
                "TOTAL_COUNT": 1,
            }],
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
                1,
                flow_run_id=1041,
            )

        self.assertEqual(1, response["total"])
        self.assertEqual(1, execute_query.call_count)
        self.assertEqual("FLOW_WORK_QUICK_EDIT_HISTORY_LIST", execute_query.call_args.args[1])

    def test_history_detail_endpoint_uses_compact_node_history(self):
        endpoint = get_route_endpoint("/quick-edit/history/{flow_run_id}", "GET")
        conn = Mock()
        request = Mock()
        run_row = {
            "FLOW_RUN_ID": 1041,
            "FLOW_ID": 88,
            "PROJECT_ID": 10,
            "SCENARIO_ID": 20,
            "OWNER_NAME": "INIT$EDIT01",
            "TABLE_NAME": "INITUP$QEDIT",
            "ESTIMATED_COLUMN_COUNT": 56,
            "ESTIMATED_ROW_COUNT": 300,
            "STATUS": "SUCCESS",
        }

        with (
            patch("backend.services.flow_work_router.get_target_db_connection", return_value=conn),
            patch("backend.services.flow_work_router.get_request_user_id", return_value=7),
            patch("backend.services.flow_work_router.get_request_role_code", return_value="USER"),
            patch(
                "backend.services.flow_work_router.flow_work.list_quick_edit_history",
                return_value={"status": "success", "data": [run_row], "total": 1},
            ),
            patch(
                "backend.services.flow_work_router.flow_work.list_node_run_history",
                return_value={"status": "success", "data": []},
            ) as list_history,
            patch("backend.services.flow_work_router.flow_work.list_node_runs") as list_full_nodes,
            patch("backend.services.flow_work_router.flow_work.get_run") as get_run,
        ):
            response = endpoint(1041, request)

        self.assertEqual("success", response["status"])
        self.assertEqual(56, response["data"]["restoreState"]["columnCount"])
        self.assertEqual(300, response["data"]["restoreState"]["rowCount"])
        list_history.assert_called_once_with(conn, 1041)
        list_full_nodes.assert_not_called()
        get_run.assert_not_called()

    def test_history_restore_closes_dialog_before_loading_analysis_results(self):
        quick_html = (ROOT_DIR / "quick-edit" / "index.html").read_text(encoding="utf-8")
        quick_js = (ROOT_DIR / "quick-edit" / "js" / "quick-edit.js").read_text(encoding="utf-8")
        quick_css = (ROOT_DIR / "quick-edit" / "css" / "quick-edit.css").read_text(encoding="utf-8")
        restore_section = quick_js.split("async function restoreQuickHistory", 1)[1].split(
            "\n    function showToast", 1
        )[0]

        self.assertLess(
            restore_section.index('byId("qeRunHistoryDialog")?.close();'),
            restore_section.index("await loadResults({"),
        )
        self.assertIn("quickHistoryDetailError = { runId", restore_section)
        self.assertIn("불러오기 실패 · 다시 시도", quick_js)
        self.assertIn('id="qeResultsLoadingOverlay"', quick_html)
        self.assertIn("showPanelLoading: true", restore_section)
        self.assertIn("function setResultsLoading", quick_js)
        self.assertIn(".qe-results-loading[hidden]", quick_css)
        self.assertIn("@keyframes qe-results-loading-spin", quick_css)

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
