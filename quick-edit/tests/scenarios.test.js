const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../..");
const stateKey = "init.quick-edit.pipeline.v1";

function createFlowDesigner() {
    const common = { createPageHelper: () => ({}) };
    const requests = [];
    const alerts = [];
    const sandbox = {
        window: { MCOMMON: common }, MCOMMON: common,
        PageManager: { createHelper: () => ({ getContainerEl: () => null }) },
        API_BASE_URL: "/api", alert: (message) => alerts.push(message),
        CommonUtils: { request: async (url, options) => {
            requests.push({ url, ...options });
            return { automation: { flowId: 73 } };
        } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/js/MCOM_FLOW_WORK.js"), "utf8"), sandbox);
    const designer = common.createFlowWorkPage({ pageCode: "M04001", flowType: "INTEGRATED_EDITING_SCENARIO" });
    return { designer, requests, alerts };
}

test("FLOW default templates select only jobs from their own scenario", () => {
    const { designer } = createFlowDesigner();
    const legacyDiscover = { EXEC_METHOD: "INTEGRATED_RULE_DISCOVER" };
    const xaiDiscover = { EXEC_OBJECT_NAME: "CUSTOM_LABEL", EXEC_METHOD: "MIXED_XAI_RULE_DISCOVER" };
    const legacyDetect = { EXEC_METHOD: "INTEGRATED_RULE_VIOLATION_DETECT" };
    const xaiDetect = { EXEC_METHOD: "MIXED_XAI_RULE_DETECT" };
    designer.groupRegisteredJobs = () => [
        { key: "M03001", jobs: [{ EXEC_OBJECT_NAME: "INIT$_SP_PREDICTED_TYPE" }] },
        { key: "M03002", jobs: [{ EXEC_METHOD: "INTEGRATED_RELATION_CLUSTER" }] },
        { key: "M03003", jobs: [xaiDiscover, legacyDiscover] },
        { key: "M03004", jobs: [xaiDetect, legacyDetect] }
    ];
    assert.equal(designer.getFirstRegisteredJobsByGroup().length, 4);
    assert.equal(designer.getFirstRegisteredJobsByGroup()[2], legacyDiscover);
    designer.flowType = "MIXED_XAI_SCENARIO";
    const jobs = designer.getFirstRegisteredJobsByGroup();
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0], xaiDiscover);
    assert.equal(jobs[1], xaiDetect);
});

test("FLOW custom resource aliases resolve known method contracts without changing labels", () => {
    const { designer } = createFlowDesigner();
    designer.flowContractCatalog = JSON.parse(fs.readFileSync(path.join(root, "frontend/config/flow-model-contracts.json"), "utf8"));
    const job = { EXEC_OBJECT_NAME: "CUSTOM_951", EXEC_OBJECT_LABEL: "Saved custom discovery", EXEC_METHOD: "MIXED_XAI_RULE_DISCOVER" };
    const original = JSON.stringify(job);
    assert.equal(designer.getFlowModelName(job), "MIXED_XAI_RULE_DISCOVER");
    assert.ok(designer.getFlowContractPorts(job, "out").some((port) => port.artifact === "MIXED_XAI_RULES"));
    assert.equal(JSON.stringify(job), original);
    assert.equal(designer.getFlowModelName({ execObjectName: "CUSTOM_951" }, job), "MIXED_XAI_RULE_DISCOVER");
    assert.equal(designer.getFlowModelName({ execObjectName: " mixed_xai_profile ", EXEC_METHOD: "MIXED_XAI_RULE_DISCOVER" }), "MIXED_XAI_PROFILE");
    assert.equal(designer.getFlowModelName({ execObjectName: "CUSTOM_951", EXEC_OBJECT_NAME: "MIXED_XAI_RELATION", execMethod: "MIXED_XAI_RULE_DISCOVER" }), "MIXED_XAI_RELATION");
    assert.equal(designer.getFlowModelName({ execObjectName: "CUSTOM_951", execMethod: "custom_method" }, { EXEC_OBJECT_NAME: "CUSTOM_REF" }), "CUSTOM_951");
    assert.equal(designer.getFlowModelName(), "");
});

test("FLOW template prepares a separate stored scenario before displaying it", async () => {
    const { designer, requests, alerts } = createFlowDesigner();
    const loaded = [];
    designer.isFlowRunActive = () => false;
    designer.selectedProjectId = "10";
    designer.selectedScenarioId = "20";
    designer.scenarioTables = [{ SCENARIO_TABLE_ID: 30 }];
    designer.getValue = () => "MIXED_XAI";
    designer.refreshRegisteredJobs = async () => {};
    designer.loadFlowVersions = async (latest, options) => loaded.push({ latest, options });
    await designer.prepareProcessTemplate();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/M02002/scenario-table/provision-default-design");
    assert.equal(requests[0].body.processType, "MIXED_XAI");
    assert.equal(requests[0].body.scenarioTableId, 30);
    assert.equal(loaded[0].options.preferredFlowId, 73);
    assert.deepEqual(alerts, []);
});

async function openQuickEdit(saved = {}, language = "ko", options = {}) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const requests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ key, savedState, language }) => {
        if (!sessionStorage.getItem("fixture.initialized")) {
            sessionStorage.setItem(key, JSON.stringify(savedState));
            sessionStorage.setItem("fixture.initialized", "1");
        }
        sessionStorage.setItem("initLanguageCode", language);
    }, {
        key: stateKey, language,
        savedState: {
            version: 1, status: "idle", workspaceMode: "new", processType: "LEGACY",
            projectId: 10, projectCode: "TEST", projectName: "Test project",
            scenarioId: 20, scenarioCode: "RULE", scenarioName: "Test scenario",
            tableOwner: "TEST_OWNER", tableName: "INITUP$TEST", columnCount: 3, rowCount: 200,
            targetContextId: 1, ...saved
        }
    });
    await page.route("http://quick-edit.test/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/")) {
            const request = { path: url.pathname, query: Object.fromEntries(url.searchParams), body: route.request().postDataJSON() };
            requests.push(request);
            let payload = { status: "success", data: [] };
            if (request.path.endsWith("/session/me")) payload = { status: "success", targetConnectionId: 1, user: { userName: "Test" } };
            else if (request.path.endsWith("/scenario-table/save")) payload = { status: "success", data: { SCENARIO_TABLE_ID: 30 } };
            else if (request.path.endsWith("/provision-default-design")) payload = { status: "success", automation: { status: "success", processType: "MIXED_XAI", jobIds: [31, 32], flowId: 40, flowName: "Mixed XAI" } };
            else if (request.path.endsWith("/flow/run-saved")) payload = { status: "success", data: { flowRunId: 50, runStatus: "STARTED" } };
            else if (request.path.endsWith("/descriptive-statistics")) payload = { status: "success", data: {
                available: true, context: { processType: "MIXED_XAI" }, basis: "SINGLE",
                before: { owner: "TEST_OWNER", table: "INITUP$TEST" },
                columns: [{ columnName: "VALUE", dataType: "NUMBER", before: { totalRowCount: 200, nullCount: 0, mean: 10, variance: 4, stddev: 2, min: 1, max: 20 } }]
            } };
            else if (request.path.endsWith("/snapshot")) payload = { status: "success", data: { run: { STATUS: "SUCCESS" }, nodes: [
                { NODE_NAME: "Discover", REF_MENU_CODE: "M03003", STATUS: "SUCCESS" },
                { NODE_NAME: "Detect", REF_MENU_CODE: "M03004", STATUS: "SUCCESS" }
            ] } };
            else if (request.path.endsWith("/mixed-formula-sample")) payload = { status: "success", data: {
                rule: {ruleId: request.query.ruleId, modelName: request.query.modelName, resultColumn: "Y", conditionText: "X IS NOT NULL",
                    resultText: "Y ≈ X * 2 + 3 (±2)", absoluteTolerance: 2, relativeTolerance: 0},
                columnComments: {X: "Input value", Y: "Observed result"},
                points: [{rowId: "1", predicted: 23, actual: 23, lower: 21, upper: 25, residual: 0, violation: false, actualRaw: "23", values: {X: "10"}},
                         {rowId: "7", predicted: 23, actual: 30, lower: 21, upper: 25, residual: 7, violation: true, actualRaw: "30", values: {X: "10"}}],
                source: "CURRENT_SOURCE", sampling: "FIRST_ROWS_BALANCED", scanLimit: 5000, sampleLimit: 300,
                scannedCount: 4, applicableCount: 4, normalCount: 1, violationCount: 3,
                skipped: {conditionFalse: 0, nullActual: 1, invalidActual: 1, nonFinitePrediction: 0}, sampleCount: 2, isCapped: false, hasMore: false
            } };
            else if (request.path.endsWith("/mixed-xai-results")) payload = { status: "success", data: {
                ruleSummary: { overview: { TOTAL_RULES: 1, MAPPED_RULES: 1, RULE_SOURCE: "MIXED_XAI" },
                    total: 1, page: 1, pageSize: 20, columnComments: {},
                    conditionDist: [{ CONDITION_COUNT: 1, RULE_COUNT: 1 }], resultTop: [{ RESULT_COLUMN: "ANOMALY_CANDIDATE", RULE_COUNT: 1 }],
                    rules: [{ RULE_ID: "R1", RULE_KIND: "MIXED_XAI", CONDITION_TEXT: '<img src=x onerror="alert(1)">', CONDITION_COUNT: 1, CONDITION_COLUMNS: ["field"],
                        RESULT_COLUMN: "ANOMALY_CANDIDATE", RESULT_TEXT: "ANOMALY_CANDIDATE = Y", RESULT_HAS_VALUE_YN: "Y",
                        CONDITION_TOTAL_COUNT: 20, SUPPORT_COUNT: 19, MODEL_AGREEMENT: .95, HOLDOUT_COUNT: 5, HOLDOUT_AGREEMENT: .8,
                        MATCH_COUNT: 1, VIOLATION_COUNT: 1, VALIDATION_STATUS: "HOLDOUT_OBSERVED" }] },
                rules: [{ RULE_ID: "R1", RULE_TEXT: '<img src=x onerror="alert(1)">', SUPPORT_COUNT: 20, ANOMALY_COUNT: 19, RULE_PURITY: 0.95 }],
                violations: [{ CASE_ID: "AA123", RULE_ID: "R1", ANOMALY_SCORE: null, ROW_DATA_JSON: '{"field":"<script>test</script>"}' }],
                summary: { ruleCount: 1, ruleMatchCount: 1, sampleCount: 200, holdoutFidelity: 0.98, holdoutPrecision: 0.8, holdoutRecall: 0.6, warnings: [] }
            } };
            if (options.api) payload = await options.api(request, payload);
            await route.fulfill({ json: payload });
            return;
        }
        const allowed = new Map([
            ["/quick-edit/", "quick-edit/index.html"],
            ["/quick-edit/css/quick-edit.css", "quick-edit/css/quick-edit.css"],
            ["/quick-edit/js/api-client.js", "quick-edit/js/api-client.js"],
            ["/quick-edit/js/renderers.js", "quick-edit/js/renderers.js"],
            ["/quick-edit/js/quick-edit.js", "quick-edit/js/quick-edit.js"],
            ["/js/rule-result-common.js", "frontend/js/rule-result-common.js"],
            ["/js/formula-rule-chart.js", "frontend/js/formula-rule-chart.js"],
            ["/css/formula-rule-chart.css", "frontend/css/formula-rule-chart.css"],
            ["/css/rule-chart-controls.css", "frontend/css/rule-chart-controls.css"],
            ["/js/regression-diagnostics.js", "frontend/js/regression-diagnostics.js"]
        ]);
        const local = allowed.get(url.pathname);
        if (!local) return route.fulfill({ status: 404, body: "" });
        const type = local.endsWith(".js") ? "application/javascript" : local.endsWith(".css") ? "text/css" : "text/html";
        await route.fulfill({ contentType: `${type}; charset=utf-8`, body: fs.readFileSync(path.join(root, local)) });
    });
    await page.goto("http://quick-edit.test/quick-edit/");
    await page.waitForFunction(() => document.querySelector("#sessionStatus")?.getAttribute("data-state") === "connected");
    return { browser, page, requests, errors };
}

test("a new workspace selects Mixed XAI first while old saved choices are preserved", async () => {
    const { browser, page, errors } = await openQuickEdit();
    try {
        assert.equal(await page.isChecked("#qeProcessLegacy"), true);
        await page.evaluate((key) => sessionStorage.removeItem(key), stateKey);
        await page.reload();
        await page.waitForFunction(() => document.querySelector("#sessionStatus")?.dataset.state === "connected");
        assert.equal(await page.isChecked("#qeProcessMixedXai"), true);
        assert.equal(await page.locator('#qeProcessType input[type="radio"]').first().getAttribute("value"), "MIXED_XAI");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("new Mixed FLOW drafts include statistics and relationships while keeping legacy jobs separate", () => {
    const { designer } = createFlowDesigner();
    const methods = ["MIXED_XAI_PROFILE", "MIXED_XAI_RELATION", "MIXED_XAI_RULE_DISCOVER", "MIXED_XAI_RULE_DETECT"];
    designer.flowType = "MIXED_XAI_SCENARIO";
    designer.groupRegisteredJobs = () => methods.map((EXEC_METHOD, index) => ({ key: `M0300${index + 1}`, jobs: [{EXEC_METHOD: "OLD_MODEL"}, {EXEC_METHOD}] }));
    assert.deepEqual(Array.from(designer.getFirstRegisteredJobsByGroup(), (job) => job.EXEC_METHOD), methods);
});

test("statistics failure preserves discovered rules and exposes a retry warning", async () => {
    const { browser, page, errors } = await openQuickEdit({ processType: "MIXED_XAI" }, "ko", {
        api: async (request, payload) => request.path.endsWith("/descriptive-statistics")
            ? {status: "error", message: "statistics unavailable"} : payload
    });
    try {
        await page.click("#runButton");
        await page.waitForFunction((key) => ["warning", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
        const state = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
        assert.equal(state.status, "warning");
        assert.match(state.resultWarning, /statistics unavailable/);
        assert.equal(await page.locator("#categoryRules .qe-rule-card").count(), 1);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("pause during preparation finishes the current request and resumes without repeating design", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { browser, page, requests, errors } = await openQuickEdit({ processType: "MIXED_XAI" }, "ko", {
        api: async (request, payload) => {
            if (request.path.endsWith("/provision-default-design")) await gate;
            return payload;
        }
    });
    try {
        await page.click("#runButton");
        await page.waitForFunction(() => document.querySelector("#qeCurrentStepTitle, #currentStage")?.textContent.includes("모델"));
        await page.click("#qePauseButton");
        assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).status, stateKey), "running");
        release();
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "paused", stateKey);
        assert.equal(requests.some((r) => r.path.endsWith("/flow/run-saved")), false);
        await page.click("#qeResumeButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "success", stateKey);
        assert.equal(requests.filter((r) => r.path.endsWith("/provision-default-design")).length, 1);
        assert.deepEqual(errors, []);
    } finally { release(); await browser.close(); }
});

test("server pause survives reload and resumes the same run; stop restarts a new run", async () => {
    let status = "STARTED", runId = 50;
    const { browser, page, requests, errors } = await openQuickEdit({ processType: "MIXED_XAI" }, "ko", {
        api: async (request, payload) => {
            if (request.path.endsWith("/snapshot")) payload.data.run.STATUS = status;
            if (request.path.endsWith("/control")) {
                status = request.body.action === "PAUSE" ? "PAUSED" : "CANCELLED";
                return { status: "success", data: { STATUS: status } };
            }
            if (request.path.endsWith("/rerun-saved-failed-stage")) {
                status = "STARTED";
                return { status: "success", data: { flowRunId: runId, runStatus: status } };
            }
            if (request.path.endsWith("/flow/run-saved")) {
                runId += 1;
                return { status: "success", data: { flowRunId: runId, runStatus: "STARTED" } };
            }
            return payload;
        }
    });
    try {
        await page.click("#runButton");
        await page.waitForFunction((key) => Boolean(JSON.parse(sessionStorage.getItem(key)).flowRunId), stateKey);
        await page.click("#qePauseButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "paused", stateKey);
        await page.reload();
        await page.waitForFunction(() => !document.querySelector("#qeResumeButton").disabled && !document.querySelector("#qeResumeButton").hidden);
        await page.click("#qeResumeButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).lastRunStatus === "STARTED", stateKey);
        assert.equal(requests.find((r) => r.path.endsWith("/rerun-saved-failed-stage")).body.flowRunId, 51);
        await page.click("#qeStopButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "stopped", stateKey);
        assert.match(await page.locator("#qeResumeButton").textContent(), /재시작/);
        status = "SUCCESS";
        await page.click("#qeResumeButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "success", stateKey);
        assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).flowRunId, stateKey), 52);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("Quick Edit creates the independent XAI scenario and never requests column classification results", async () => {
    const { browser, page, requests, errors } = await openQuickEdit();
    try {
        assert.equal(await page.isVisible("#qeProcessLegacy"), true);
        assert.equal(await page.isVisible("#qeProcessMixedXai"), true);
        assert.equal(await page.locator("#fileDropZone + #qeProcessType").count(), 1);
        await page.check("#qeProcessMixedXai");
        assert.equal(await page.isChecked("#qeProcessLegacy"), false);
        await page.click("#runButton");
        await page.waitForFunction((key) => ["success", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
        const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
        assert.equal(saved.status, "success", saved.error);
        assert.equal(saved.processType, "MIXED_XAI");
        assert.deepEqual(saved.jobIds, [31, 32]);
        assert.equal(requests.find((row) => row.path.endsWith("/provision-default-design")).body.processType, "MIXED_XAI");
        assert.equal(requests.find((row) => row.path.endsWith("/flow/run-saved")).body.quickEditSummary.processType, "MIXED_XAI");
        assert.equal(requests.some((row) => /column-type|column-type-final/.test(row.path)), false);
        assert.equal(requests.some((row) => /descriptive-statistics/.test(row.path)), true);
        assert.equal(await page.isVisible("#qeCommonResults"), true);
        assert.equal(await page.isVisible("#qeStatisticsSummary"), true);
        assert.equal(await page.isDisabled("#qeStatisticsDetailButton"), false);
        assert.equal(await page.isVisible("#categoryPanel"), true);
        assert.equal(await page.isVisible("#continuousTab"), true);
        await page.locator("#categoryTab").press("ArrowRight");
        assert.equal(await page.isVisible("#continuousPanel"), true);
        assert.match(await page.locator("#qeContinuousDiscoveryNotice").textContent(), /과거 실행/);
        await page.click("#categoryTab");
        assert.equal(await page.isVisible("#categoryPanel"), true);
        assert.equal(await page.isVisible("#qeMixedXaiResults"), true);
        assert.equal(await page.isDisabled("#qeProcessMixedXai"), true);
        assert.equal(await page.locator("#categoryRules img").count(), 0);
        assert.match(await page.locator("#categoryRules").textContent(), /<img src=x/);
        assert.match(await page.locator("#qeMixedXaiKpis").textContent(), /98.0%/);
        await page.click('#categoryRules .qe-rule-card');
        assert.match(await page.locator('#qeCategoricalDetailBody').textContent(), /모델 일치율/);
        await page.click('#qeCategoricalDetail [data-load-violations]');
        assert.match(await page.locator('[data-violation-grid]').textContent(), /<script>test<\/script>/);
        assert.equal(await page.locator('[data-violation-grid] script').count(), 0);
        assert.equal(await page.locator('#qeRuleSummaryTable tbody tr').count(), 1);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

test("restored XAI history loads its own results and keeps classification editing hidden", async () => {
    const { browser, page, requests, errors } = await openQuickEdit({
        processType: "MIXED_XAI", status: "success", historyView: true,
        flowId: 40, flowRunId: 50, jobIds: [31, 32], scenarioTableId: 30,
        currentStep: 7, completedSteps: [0, 1, 2, 3, 4, 5, 6, 7]
    });
    try {
        await page.waitForSelector("#categoryRules .qe-rule-card");
        assert.equal(await page.isChecked("#qeProcessMixedXai"), true);
        assert.equal(await page.isVisible("#qeColumnTypeRerunButton"), false);
        assert.equal(await page.isVisible("#qeHistoryFullRerunButton"), true);
        assert.equal(requests.some((row) => row.path.endsWith("/mixed-xai-results")), true);
        assert.equal(requests.some((row) => row.path.includes("column-type")), false);
        await page.click('#categoryRules .qe-rule-card');
        assert.match(await page.locator('#qeCategoricalDetailBody').textContent(), /모델 일치율/);
        await page.click('#qeCategoricalDetail [data-load-violations]');
        assert.match(await page.locator('[data-violation-grid]').textContent(), /<script>test<\/script>/);
        assert.equal(await page.locator('[data-violation-grid] script').count(), 0);
        assert.equal(await page.locator('#qeRuleSummaryTable tbody tr').count(), 1);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});


test("Quick Edit common XAI results use the selected English language", async () => {
    const { browser, page, errors } = await openQuickEdit({
        processType: "MIXED_XAI", status: "success", historyView: true,
        flowId: 40, flowRunId: 50, jobIds: [31, 32], scenarioTableId: 30,
        currentStep: 7, completedSteps: [0, 1, 2, 3, 4, 5, 6, 7]
    }, "en");
    try {
        await page.waitForSelector("#categoryRules .qe-rule-card");
        assert.match(await page.locator("#categoryRules").textContent(), /Model agreement/);
        assert.doesNotMatch(await page.locator("#categoryRules").textContent(), /신뢰도|모델 일치율/);
        await page.click("#categoryRules .qe-rule-card");
        assert.match(await page.locator("#qeCategoricalDetailTitle").textContent(), /IF–THEN rule detail/);
        await page.click("#qeCategoricalDetail [data-load-violations]");
        assert.match(await page.locator("[data-violation-summary]").textContent(), /Candidate preview/);
        assert.match(await page.locator("#qeRuleSummaryTable").textContent(), /Holdout agreement/);
        fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
        await page.locator("#categoryPanel").screenshot({ path: path.join(root, "test-results/quick-edit-xai-common-en.png") });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("Quick Edit v2 renders actual THEN values, confidence and NULL-safe violation previews", async () => {
    for (const language of ["ko", "en"]) {
        const { browser, page, errors } = await openQuickEdit({ processType: "MIXED_XAI", status: "success", historyView: true,
            flowId: 40, flowRunId: 50, jobIds: [31, 32], scenarioTableId: 30, currentStep: 7, completedSteps: [0, 1, 2, 3, 4, 5, 6, 7]
        }, language, { api: async (request, response) => {
            if (!request.path.endsWith("/mixed-xai-results")) return response;
            const data = response.data;
            data.summary = { algorithm: "MIXED_PATTERN_TREE", algorithmVersion: 2, ruleCount: 1, trainCount: 150, validationCount: 50, violationCount: 2, metricsCohort: "FULL_TARGET" };
            const rules = data.ruleSummary.rules;
            Object.assign(data.ruleSummary.overview, { RULE_SOURCE: "MIXED_PATTERN_TREE", AVG_CONFIDENCE: .99, AVG_LIFT: 1.98 });
            Object.assign(rules[0], { RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", MODEL_NAME: "XAI_PATTERN_50",
                CONDITION_TEXT: "VALUE > 10", RESULT_COLUMN: "CODE", RESULT_VALUE: "0", RESULT_TEXT: "CODE = 0",
                RULE_CONFIDENCE: .99, RULE_LIFT: 1.98, RULE_SUPPORT: .495, TRAIN_CONFIDENCE: .995, VALIDATION_CONFIDENCE: .98, VALIDATION_COUNT: 25,
                VALIDATION_STATUS: "VALIDATED", MATCH_COUNT: 2, VIOLATION_COUNT: 2 });
            data.ruleSummary.resultTop = [{ RESULT_COLUMN: "CODE", RULE_COUNT: 1 }];
            data.violations = [{ RULE_ID: "R1", CASE_ID: "7", RESULT_COLUMN: "CODE", EXPECTED_VALUE: "0", ACTUAL_VALUE: null,
                RULE_CONFIDENCE: .99, RULE_LIFT: 1.98, VIOLATION_REASON: "PATTERN_RESULT_MISSING" }];
            return response;
        } });
        try {
            await page.waitForSelector("#categoryRules .qe-rule-card");
            assert.match(await page.locator("#categoryRules").textContent(), /THEN CODE = 0/);
            assert.doesNotMatch(await page.locator("#categoryPanel").textContent(), /ANOMALY_CANDIDATE|모델 일치율|Model agreement/);
            await page.click("#categoryRules .qe-rule-card");
            const detail = await page.locator("#qeCategoricalDetailBody").textContent();
            assert.match(detail, /99.0%/);
            assert.match(detail, /1.980/);
            assert.match(detail, language === "ko" ? /검증 신뢰도/ : /Validation confidence/);
            await page.click("#qeCategoricalDetail [data-load-violations]");
            await page.waitForSelector("[data-violation-grid] tbody tr");
            const rows = await page.locator("[data-violation-grid]").textContent();
            assert.match(rows, language === "ko" ? /NULL\(결측\)/ : /NULL \(missing\)/);
            assert.doesNotMatch(rows, /PATTERN_RESULT_MISSING/);
            assert.match(rows, language === "ko" ? /결측/ : /missing/);
            assert.match(await page.locator("#qeRuleSummaryTable").textContent(), language === "ko" ? /검증 신뢰도/ : /Validation confidence/);
            fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
            await page.setViewportSize({ width: 1500, height: 1800 });
            await page.locator("#qeCategoricalDetail").screenshot({ path: path.join(root, `test-results/quick-edit-pattern-${language}.png`) });
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});

test("new four-stage Quick runs expose statistics, relationships and continuous formula results in both languages", async () => {
    for (const language of ["ko", "en"]) {
        const { browser, page, errors } = await openQuickEdit({processType: "MIXED_XAI"}, language, {api: async (request, response) => {
            if (request.path.endsWith("/provision-default-design")) response.automation.jobIds = [29, 30, 31, 32];
            if (request.path.endsWith("/snapshot")) response.data.nodes = ["Profile", "Relations", "Discover", "Detect"].map((NODE_NAME, i) => ({NODE_NAME, REF_MENU_CODE: `M0300${i + 1}`, STATUS: "SUCCESS"}));
            if (!request.path.endsWith("/mixed-xai-results")) return response;
            const data = response.data;
            data.summary = { algorithm: "MIXED_PATTERN_TREE", ruleCount: 1, trainCount: 300, validationCount: 100, violationCount: 2, metricsCohort: "FULL_TARGET",
                profile: {sampleCount: 400, sampling: "FIRST_ROWS", columnCount: 2, numericColumnCount: 2, textColumnCount: 0, skippedColumnCount: 0, duplicateRowCount: 0,
                    columns: [{COLUMN_NAME: "X", COLUMN_COMMENT: "Input", DATA_TYPE: "NUMBER", ROW_COUNT: 400, NULL_COUNT: 0, NULL_RATE: 0, DISTINCT_COUNT: 390, MIN: 1, MAX: 200, MEAN: 100, STDDEV: 20, TOP_VALUES: [{value: 1, count: 2}]}]},
                relationships: {sampleCount: 400, numericColumnCount: 2, pairCount: 1, correlationPairs: [{COLUMN_X: "X", COLUMN_Y: "Y", PAIR_COUNT: 400, COVERAGE: 1, CORRELATION: .985}], duplicateColumns: [], missingColumns: []} };
            Object.assign(data.ruleSummary.overview, {RULE_SOURCE: "MIXED_PATTERN_TREE", AVG_CONFIDENCE: .95, AVG_LIFT: null});
            Object.assign(data.ruleSummary.rules[0], { RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", MODEL_NAME: "XAI_PATTERN_50", RESULT_KIND: "FORMULA",
                FORMULA_METHOD: "ROBUST_LINEAR", COEFFICIENT_POLICY: "CANONICAL_SIMPLE",
                CONDITION_TEXT: "X IS NOT NULL", RESULT_COLUMN: "Y", RESULT_VALUE: "X * 2 + 3", RESULT_TEXT: "Y ≈ X * 2 + 3 (±2)",
                CONDITION_AST: {column: "X", operator: "NOT_NULL", numericText: true},
                RESULT_AST: {operator: "WITHIN_TOLERANCE", column: "Y", numericText: true, expression: {operator: "ADD", left: {operator: "MULTIPLY", left: {column: "X", numericText: true}, right: {value: 2}}, right: {value: 3}}, absoluteTolerance: 2, relativeTolerance: 0},
                RULE_CONFIDENCE: .95, RULE_LIFT: null, VALIDATION_R2: .99, VALIDATION_MAE: 1.25, VALIDATION_RMSE: 2,
                ABSOLUTE_TOLERANCE: 2, RELATIVE_TOLERANCE: 0, VALIDATION_CONFIDENCE: .95, VALIDATION_COUNT: 100, VALIDATION_STATUS: "VALIDATED", MATCH_COUNT: 2, VIOLATION_COUNT: 2 });
            data.ruleSummary.rules.push({...data.ruleSummary.rules[0], RULE_ID: "R_SUM", FORMULA_METHOD: "SUM_DIFFERENCE",
                CONDITION_TEXT: "X IS NOT NULL AND Z IS NOT NULL", RESULT_TEXT: "Y ≈ X + Z (±2)", RESULT_VALUE: "X + Z",
                CONDITION_AST: {operator: "AND", conditions: [{column: "X", operator: "NOT_NULL", numericText: true}, {column: "Z", operator: "NOT_NULL", numericText: true}]},
                RESULT_AST: {operator: "WITHIN_TOLERANCE", column: "Y", numericText: true, expression: {operator: "ADD", left: {column: "X", numericText: true}, right: {column: "Z", numericText: true}}, absoluteTolerance: 2, relativeTolerance: 0}});
            data.summary.ruleCount = 2;
            data.ruleSummary.resultTop = [{RESULT_COLUMN: "Y", RULE_COUNT: 2}];
            data.violations = [{RULE_ID: "R1", CASE_ID: "7", RESULT_COLUMN: "Y", EXPECTED_VALUE: "23", ACTUAL_VALUE: "30", EXPECTED_LOWER: 21, EXPECTED_UPPER: 25, RESIDUAL: 7, ABS_ERROR: 7, RULE_CONFIDENCE: .95, RULE_LIFT: null, VIOLATION_REASON: "PATTERN_FORMULA_MISMATCH"}];
            return response;
        }});
        try {
            await page.click("#runButton");
            await page.waitForFunction((key) => ["success", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
            const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
            assert.equal(saved.status, "success");
            assert.equal(saved.jobIds.length, 4);
            assert.equal(await page.locator("#qeMixedEarlyStages details").count(), 2);
            for (const details of await page.locator("#qeMixedEarlyStages details").all()) await details.locator("summary").click();
            assert.match(await page.locator("#qeMixedEarlyStages").textContent(), /390/);
            assert.match(await page.locator("#qeMixedEarlyStages").textContent(), /0.985/);
            assert.match(await page.locator("#qeMixedEarlyStages").textContent(), language === "ko" ? /기초통계·결측 분석/ : /Basic statistics and missing values/);
            assert.equal(await page.locator("#categoryRules .qe-rule-card").count(), 0);
            await page.locator("#qeMixedEarlyStages").screenshot({path: path.join(root, `test-results/quick-edit-early-stages-${language}.png`)});
            await page.click("#continuousTab");
            assert.equal(await page.locator("#continuousRules .qe-rule-card").count(), 2);
            await page.click('[data-rule-filter-kind="continuous"][data-rule-filter-type="METHOD"][data-rule-filter-value="SUM_DIFFERENCE"]');
            assert.equal(await page.locator("#continuousRules .qe-rule-card").count(), 1);
            assert.match(await page.locator("#continuousRules").textContent(), /Y ≈ X \+ Z \(±2\)/);
            assert.match(await page.locator("#continuousRules").textContent(), language === "ko" ? /합·차 관계/ : /Sum\/difference relation/);
            await page.click('[data-rule-filter-kind="continuous"][data-rule-filter-type="METHOD"][data-rule-filter-value="ROBUST_LINEAR"]');
            await page.click("#continuousRules .qe-rule-card");
            assert.match(await page.locator("#qeContinuousRuleSummary").textContent(), /95.0%/);
            assert.match(await page.locator("#qeContinuousRuleSummary").textContent(), /Y ≈ X \* 2 \+ 3/);
            assert.match(await page.locator("#qeContinuousRuleSummary").textContent(), language === "ko" ? /검증 평균 절대 오차/ : /Validation MAE/);
            assert.equal(await page.isVisible("#qeContinuousDetailChart"), false);
            await page.waitForSelector("#qeFormulaRuleChart svg");
            assert.equal(await page.isVisible("#qeFormulaRuleChart"), true);
            assert.match(await page.locator("#qeFormulaRuleChart").textContent(), language === "ko" ? /현재/ : /Current|current/);
            assert.match(await page.locator("#qeFormulaRuleChart thead").textContent(), /Input value/);
            assert.match(await page.locator("#qeFormulaRuleChart thead").textContent(), /Observed result/);
            await page.locator('#qeFormulaRuleChart [data-point="1"]').click();
            assert.equal(await page.locator('#qeFormulaRuleChart tr[data-row="1"]').getAttribute("aria-current"), "true");
            await page.locator('#qeFormulaRuleChart tr[data-row="0"] td').last().click();
            assert.equal(await page.locator('#qeFormulaRuleChart tr[data-row="0"]').getAttribute("aria-current"), "true");
            assert.match(await page.locator('#qeFormulaRuleChart [data-point="0"]').getAttribute("class"), /is-selected/);
            await page.click("#qeContinuousDetail [data-load-violations]");
            await page.waitForSelector("[data-violation-grid] tbody tr");
            assert.match(await page.locator("[data-violation-grid]").textContent(), language === "ko" ? /잔차\(실제값 - 예측값\)/ : /Residual \(actual - expected\)/);
            assert.doesNotMatch(await page.locator("[data-violation-grid]").textContent(), /PATTERN_FORMULA_MISMATCH/);
            await page.setViewportSize({width: 1500, height: 1800});
            fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
            await page.locator("#qeContinuousDetail").screenshot({path: path.join(root, `test-results/quick-edit-formula-${language}.png`),
                style: ".qe-topbar, .qe-stepper-wrap, .qe-toast { visibility: hidden; }"});
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});

function formulaResults(response) {
    response.data.summary = {algorithm: "MIXED_PATTERN_TREE", ruleCount: 2, violationCount: 2};
    response.data.ruleSummary.overview = {TOTAL_RULES: 2, RULE_SOURCE: "MIXED_PATTERN_TREE"};
    response.data.ruleSummary.rules = ["R1", "R2"].map((RULE_ID) => ({
        RULE_ID, MODEL_NAME: "XAI_PATTERN_50", RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE",
        RESULT_KIND: "FORMULA", FORMULA_METHOD: "ROBUST_LINEAR", COEFFICIENT_POLICY: "CANONICAL_SIMPLE",
        RESULT_COLUMN: "Y", RESULT_TEXT: `${RULE_ID} Y = 2*X+3`, CONDITION_TEXT: "X IS NOT NULL", RESULT_HAS_VALUE_YN: "Y",
        RULE_CONFIDENCE: .95, CONDITION_COUNT: 1, CONDITION_TOTAL_COUNT: 100, SUPPORT_COUNT: 95, VIOLATION_COUNT: 5,
        ABSOLUTE_TOLERANCE: 2, RELATIVE_TOLERANCE: 0
    }));
    response.data.violations = [];
    return response;
}

test("Quick formula samples use stored-rule scope and ignore a delayed previous selection", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let firstStarted = false;
    const {browser, page, requests, errors} = await openQuickEdit({processType: "MIXED_XAI"}, "en", {api: async (request, response) => {
        if (request.path.endsWith("/mixed-xai-results")) return formulaResults(response);
        if (request.path.endsWith("/mixed-formula-sample")) {
            if (request.query.ruleId === "R1") { firstStarted = true; await gate; }
            response.data.rule.resultText = request.query.ruleId === "R1" ? "STALE_FORMULA" : "CURRENT_FORMULA";
        }
        return response;
    }});
    try {
        await page.click("#runButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "success", stateKey);
        await page.click("#continuousTab");
        await page.selectOption("#qeContinuousRuleSelect", "1");
        await page.waitForSelector("#qeFormulaRuleChart svg");
        assert.equal(firstStarted, true);
        assert.match(await page.locator("#qeContinuousRuleSummary").textContent(), /CURRENT_FORMULA/);
        release();
        await page.waitForTimeout(100);
        assert.doesNotMatch(await page.locator("#qeContinuousRuleSummary").textContent(), /STALE_FORMULA/);
        const request = requests.find((item) => item.path.endsWith("/mixed-formula-sample") && item.query.ruleId === "R2");
        assert.deepEqual(request.query, {flowRunId: "50", targetOwner: "TEST_OWNER", targetTable: "INITUP$TEST", modelName: "XAI_PATTERN_50", ruleId: "R2", sampleLimit: "300"});
        assert.equal(requests.some((item) => item.path.endsWith("/symbolic-rule-sample")), false);
        assert.deepEqual(errors, []);
    } finally { release(); await browser.close(); }
});

test("Quick formula chart errors can be retried and reset discards in-flight charts", async () => {
    let attempts = 0, release;
    const gate = new Promise((resolve) => { release = resolve; });
    const {browser, page, errors} = await openQuickEdit({processType: "MIXED_XAI"}, "en", {api: async (request, response) => {
        if (request.path.endsWith("/mixed-xai-results")) return formulaResults(response);
        if (request.path.endsWith("/mixed-formula-sample")) {
            attempts += 1;
            if (attempts === 1) return {status: "error", message: "sample unavailable"};
            if (attempts === 3) await gate;
        }
        return response;
    }});
    try {
        await page.click("#runButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "success", stateKey);
        await page.click("#continuousTab");
        await page.waitForFunction(() => document.querySelector("#qeFormulaRuleChart")?.textContent.includes("sample unavailable"));
        assert.equal(await page.locator("#qeFormulaRuleChart svg").count(), 0);
        await page.click("#qeContinuousDetailReload");
        await page.waitForSelector("#qeFormulaRuleChart svg");
        await page.click("#qeContinuousDetailReload");
        await page.waitForFunction(() => document.querySelector("#qeFormulaRuleChart")?.textContent.includes("Loading current source"));
        await page.click("#resetButton");
        await page.click('#qeResetDialog button[value="confirm"]');
        release();
        await page.waitForTimeout(100);
        assert.equal(await page.isVisible("#qeContinuousDetail"), false);
        assert.equal(await page.locator("#qeFormulaRuleChart svg").count(), 0);
        assert.equal(attempts, 3);
        assert.deepEqual(errors, []);
    } finally { release(); await browser.close(); }
});

test("Mixed Quick keeps a visible zero-formula tab and computes value-rule means when old overview metrics are absent", async () => {
    for (const language of ["ko", "en"]) {
        const {browser, page, requests, errors} = await openQuickEdit({processType:"MIXED_XAI"}, language, {api: async (request, response) => {
            if (!request.path.endsWith("/mixed-xai-results")) return response;
            const data = response.data, base = data.ruleSummary.rules[0];
            data.summary = {algorithm:"MIXED_PATTERN_TREE", algorithmVersion:2, ruleCount:24, trainCount:750, validationCount:250, violationCount:24,
                continuous:{diagnosticVersion:1, enabled:true, status:"NO_ELIGIBLE_TARGETS", physicalNumericColumnCount:0, inferredNumericTextColumnCount:2,
                    eligibleTargetCount:0, targetCount:0, testedCandidateCount:0, fitRows:562, calibrationRows:188, validationRows:250, eligibilityReasons:{LOW_CARDINALITY_TARGET:2,LEADING_ZERO_CODE:1}}};
            data.ruleSummary.rules = Array.from({length:24}, (_, i) => ({...base, RULE_ID:`VALUE_${i}`, RULE_KIND:"MIXED_PATTERN_TREE", RULE_SOURCE:"MIXED_PATTERN_TREE",
                RESULT_KIND:"VALUE", RESULT_COLUMN:"CODE", RESULT_TEXT:"CODE = 1", RESULT_VALUE:1, CONDITION_TEXT:"X > 0", RULE_CONFIDENCE:.995, RULE_LIFT:1.25,
                RESULT_HAS_VALUE_YN:"Y", MATCH_COUNT:1, VIOLATION_COUNT:1}));
            data.ruleSummary.overview = {TOTAL_RULES:24,RULE_SOURCE:"MIXED_PATTERN_TREE"};
            data.violations = [];
            return response;
        }});
        try {
            await page.click("#runButton");
            await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "success", stateKey);
            assert.equal(await page.isVisible("#continuousTab"), true);
            assert.match(await page.locator("#categoryKpis").textContent(), /99.5%/);
            assert.match(await page.locator("#categoryKpis").textContent(), /1.25/);
            assert.equal(await page.locator("#categoryRules .qe-rule-card").count(), 12);
            await page.click("#continuousTab");
            assert.equal(await page.locator("#continuousRules .qe-rule-card").count(), 0);
            assert.doesNotMatch(await page.locator("#continuousKpis").textContent(), /0%/);
            assert.equal(await page.isVisible("#qeContinuousDetail"), false);
            assert.match(await page.locator("#qeContinuousDiscoveryNotice").textContent(), language === "ko" ? /대상에 해당하는 컬럼을 찾지 못/ : /No eligible continuous target/);
            await page.locator("#qeContinuousDiscoveryNotice summary").click();
            assert.match(await page.locator("#qeContinuousDiscoveryNotice").textContent(), language === "ko" ? /앞자리 0/ : /Leading-zero code/);
            assert.doesNotMatch(await page.locator("#qeContinuousDiscoveryNotice").textContent(), /LOW_CARDINALITY_TARGET|LEADING_ZERO_CODE/);
            assert.equal(requests.some((r) => /symbolic.*sample/.test(r.path)), false);
            fs.mkdirSync(path.join(root, "test-results"), {recursive:true});
            await page.locator("#continuousPanel").screenshot({path:path.join(root,`test-results/quick-edit-continuous-zero-${language}.png`), style:".qe-topbar, .qe-stepper-wrap, .qe-toast { visibility: hidden; }"});
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});
