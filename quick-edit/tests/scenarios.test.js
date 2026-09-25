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

function mixedResultFixture() {
    return { status: "success", data: {
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
}

// Existing scenario fixtures describe original stored rows. Expose those rows through
// the bounded catalog contract without issuing the superseded full-result requests.
async function editingResultFixture(request, options, page) {
    const adapt = async (path, payload, query = {}) => options.api ? options.api({path, query, body: null}, payload, page) : payload;
    const mixed = await adapt("/api/mlAnalysis/mixed-xai-results", mixedResultFixture());
    const association = await adapt("/api/M04002/model-rule-summary", {status: "success", rules: []});
    const symbolic = await adapt("/api/M04002/result-table", {status: "success", data: [], symbolicRuleSummary: {topRules: []}}, {objectName: "INIT$_TB_RULEDISC_SYMBOLIC"});
    const pattern = mixed.data?.summary?.algorithm === "MIXED_PATTERN_TREE";
    const entries = [];
    for (const [source, rows] of [["LEGACY_ASSOC", association.rules || []], ["MIXED_PATTERN", pattern ? mixed.data.ruleSummary.rules : []], ["LEGACY_SYMBOLIC", symbolic.symbolicRuleSummary?.topRules || []]]) {
        for (const row of rows) {
            const family = source === "LEGACY_SYMBOLIC" || row.RESULT_KIND === "FORMULA" ? "FORMULA" : "CONDITION";
            const scope = {flowRunId: Number(request.query.flowRunId), targetOwner: request.query.targetOwner, targetTable: request.query.targetTable,
                modelName: row.MODEL_NAME || (source === "LEGACY_ASSOC" ? "OML_MODEL" : ""), ruleId: String(row.RULE_ID), targetColumn: row.TARGET_COLUMN || row.RESULT_COLUMN || "", ruleOwner: request.query.targetOwner};
            entries.push({key: JSON.stringify([source, ...Object.values(scope)]), family, source, scope,
                artifact: {owner: request.query.targetOwner, objectName: source === "LEGACY_SYMBOLIC" ? "INIT$_TB_RULEDISC_SYMBOLIC" : "INIT$_TB_RULEDISC_ASSOC_SUM", violationObjectName: "INIT$_TB_RULEVIOL_ASSOC"}, row});
        }
    }
    const family = request.query.family || "CONDITION", source = request.query.source || "ALL", pageNumber = Number(request.query.page || 1), size = 20;
    const rules = entries.filter((entry) => entry.family === family && (source === "ALL" || source === entry.source));
    const summary = {families: Object.fromEntries(["CONDITION", "FORMULA"].map((name) => [name, {total: entries.filter((entry) => entry.family === name).length}])), sourceCounts: [["CONDITION", "LEGACY_ASSOC"], ["CONDITION", "MIXED_PATTERN"], ["FORMULA", "LEGACY_SYMBOLIC"], ["FORMULA", "MIXED_PATTERN"]].map(([family, source]) => ({family, source, status: "available", ruleCount: entries.filter((entry) => entry.family === family && entry.source === source).length})), historicalExplanationCount: pattern ? 0 : mixed.data?.ruleSummary?.rules?.length || 0};
    if (request.query.view === "violations") {
        const rule = entries.find((entry) => entry.key === request.query.ruleKey);
        const violations = (mixed.data?.violations || []).filter((row) => String(row.RULE_ID) === rule?.scope.ruleId);
        return {status: "success", data: {rule, violations: violations.slice((pageNumber - 1) * size, pageNumber * size), total: violations.length, page: pageNumber, pageSize: size, hasMore: pageNumber * size < violations.length, previewOnly: true}};
    }
    return {status: "success", data: {family, source, rules: rules.slice((pageNumber - 1) * size, pageNumber * size), total: rules.length, page: pageNumber, pageSize: size, hasMore: pageNumber * size < rules.length,
        summary, diagnostics: {savedSummary: mixed.data?.summary || {}, errors: []}}};
}

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
            targetContextId: 1, sessionUserId: "100", ...saved
        }
    });
    await page.route("http://quick-edit.test/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/")) {
            const request = { path: url.pathname, query: Object.fromEntries(url.searchParams), body: route.request().postDataJSON() };
            requests.push(request);
            let payload = { status: "success", data: [] };
            if (request.path.endsWith("/session/me")) payload = { status: "success", targetConnectionId: 1, user: {userId: 100, userName: "Test" } };
            else if (request.path.endsWith("/scenario-table/save")) payload = { status: "success", data: { SCENARIO_TABLE_ID: 30 } };
            else if (request.path.endsWith("/provision-default-design")) payload = { status: "success", automation: { status: "success", processType: request.body?.processType || "MIXED_XAI", jobIds: request.body?.processType === "UNIFIED" ? [29, 30, 31, 32] : [31, 32], flowId: 40, flowName: "Saved execution" } };
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
            else if (request.path.endsWith("/mixed-xai-results")) payload = mixedResultFixture();
            else if (request.path.endsWith("/editing-results")) payload = await editingResultFixture(request, options, page);
            if (options.api) payload = await options.api(request, payload, page);
            await route.fulfill({ json: payload, status: options.apiStatus?.(request, payload) || 200, headers: options.apiHeaders || {} });
            return;
        }
        const allowed = new Map([
            ["/quick-edit/", "quick-edit/index.html"],
            ["/quick-edit/css/quick-edit.css", "quick-edit/css/quick-edit.css"],
            ["/quick-edit/js/api-client.js", "quick-edit/js/api-client.js"],
            ["/quick-edit/js/renderers.js", "quick-edit/js/renderers.js"],
            ["/quick-edit/js/quick-edit.js", "quick-edit/js/quick-edit.js"],
            ["/js/rule-result-common.js", "frontend/js/rule-result-common.js"],
            ["/js/editing-result-view.js", "frontend/js/editing-result-view.js"],
            ["/css/editing-result-view.css", "frontend/css/editing-result-view.css"],
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

test("Quick Edit uses only unified editing for new work and stale browser choices", async () => {
    for (const processType of ["LEGACY", "MIXED_XAI"]) {
        const { browser, page, errors } = await openQuickEdit({ processType });
        try {
            assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).processType, stateKey), "UNIFIED");
            assert.equal(await page.locator('input[name="processType"]').count(), 0);
            assert.equal(await page.locator("#qeProcessType").count(), 0);
            assert.match(await page.locator("#qeProcessName").textContent(), /통합 에디팅/);
            await page.evaluate((key) => sessionStorage.removeItem(key), stateKey);
            await page.reload();
            await page.waitForFunction(() => document.querySelector("#sessionStatus")?.dataset.state === "connected");
            assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).processType, stateKey), "UNIFIED");
            assert.equal(await page.locator('input[name="processType"]').count(), 0);
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});

test("Quick Edit preserves saved process contracts once registration or design exists", async () => {
    const drafts = [
        { processType: "MIXED_XAI", scenarioTableId: 30 },
        { processType: "MIXED_XAI", flowId: 40 },
        { processType: "MIXED_XAI", jobIds: [31, 32] },
        { processType: "LEGACY", historyView: true },
        { processType: null, scenarioTableId: 30 }
    ];
    for (const saved of drafts) {
        const { browser, page, requests, errors } = await openQuickEdit(saved);
        try {
            const state = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
            assert.equal(state.processType, saved.processType || "LEGACY");
            assert.equal(await page.locator('input[name="processType"]').count(), 0);
            assert.match(await page.locator("#qeProcessName").textContent(), saved.processType === "MIXED_XAI" ? /혼합형 XAI/ : /기존/);
            assert.equal(requests.some((request) => /provision-default-design|flow\/run-saved/.test(request.path)), false);
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});

test("new Mixed FLOW drafts include statistics and relationships while keeping legacy jobs separate", () => {
    const { designer } = createFlowDesigner();
    const methods = ["MIXED_XAI_PROFILE", "MIXED_XAI_RELATION", "MIXED_XAI_RULE_DISCOVER", "MIXED_XAI_RULE_DETECT"];
    designer.flowType = "MIXED_XAI_SCENARIO";
    designer.groupRegisteredJobs = () => methods.map((EXEC_METHOD, index) => ({ key: `M0300${index + 1}`, jobs: [{EXEC_METHOD: "OLD_MODEL"}, {EXEC_METHOD}] }));
    assert.deepEqual(Array.from(designer.getFirstRegisteredJobsByGroup(), (job) => job.EXEC_METHOD), methods);
});

test("statistics failure preserves discovered rules and exposes a retry warning", async () => {
    const { browser, page, errors } = await openQuickEdit({ processType: "MIXED_XAI", scenarioTableId: 30 }, "ko", {
        api: async (request, payload) => request.path.endsWith("/descriptive-statistics")
            ? {status: "error", message: "statistics unavailable"} : payload
    });
    try {
        await page.click("#runButton");
        await page.waitForFunction((key) => ["success", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
        const state = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
        assert.equal(state.status, "success");
        await page.click("#qeLoadStatistics");
        await page.waitForFunction(() => document.querySelector("#qeAuxiliaryStatus-statistics").textContent.includes("statistics unavailable"));
        assert.equal(await page.locator("[data-editing-family]").count(), 2);
        assert.equal(await page.locator(".editing-result-error").count(), 0);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("pause during preparation finishes the current request and resumes without repeating design", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { browser, page, requests, errors } = await openQuickEdit({ processType: "MIXED_XAI", scenarioTableId: 30 }, "ko", {
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
    const { browser, page, requests, errors } = await openQuickEdit({ processType: "MIXED_XAI", scenarioTableId: 30 }, "ko", {
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
        assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).processType, stateKey), "MIXED_XAI");
        await page.click("#qeStopButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "stopped", stateKey);
        assert.match(await page.locator("#qeResumeButton").textContent(), /재시작/);
        status = "SUCCESS";
        await page.click("#qeResumeButton");
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).status === "success", stateKey);
        assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).flowRunId, stateKey), 52);
        assert.ok(requests.filter((r) => /flow\/run-saved|rerun-saved-failed-stage/.test(r.path)).every((r) => r.body.quickEditSummary.processType === "MIXED_XAI"));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("Quick Edit resumes a previously registered XAI draft without changing its analysis contract", async () => {
    const { browser, page, requests, errors } = await openQuickEdit({ processType: "MIXED_XAI", scenarioTableId: 30 });
    try {
        assert.equal(await page.locator('input[name="processType"]').count(), 0);
        assert.equal(await page.locator("#fileDropZone + #qeProcessInfo").count(), 1);
        assert.match(await page.locator("#qeProcessName").textContent(), /혼합형 XAI/);
        await page.click("#runButton");
        await page.waitForFunction((key) => ["success", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
        const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
        assert.equal(saved.status, "success", saved.error);
        assert.equal(saved.processType, "MIXED_XAI");
        assert.deepEqual(saved.jobIds, [31, 32]);
        assert.equal(requests.find((row) => row.path.endsWith("/provision-default-design")).body.processType, "MIXED_XAI");
        assert.equal(requests.find((row) => row.path.endsWith("/flow/run-saved")).body.quickEditSummary.processType, "MIXED_XAI");
        assert.equal(requests.some((row) => /column-type|column-type-final/.test(row.path)), false);
        assert.equal(requests.some((row) => /descriptive-statistics/.test(row.path)), false);
        assert.equal(requests.some((row) => /mixed-xai-results/.test(row.path)), false);
        await page.click("#qeLoadStatistics");
        await page.waitForSelector("#qeStatisticsSummary:not([hidden])");
        assert.equal(await page.isDisabled("#qeStatisticsDetailButton"), false);
        await page.click("[data-editing-legacy]");
        await page.waitForSelector("#categoryRules .qe-rule-card");
        assert.equal(await page.isVisible("#qeRuleTypeTabs"), false);
        assert.equal(await page.isVisible("#qeMixedXaiResults"), true);
        assert.equal(await page.locator('input[name="processType"]').count(), 0);
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
        await page.waitForSelector("[data-editing-legacy]");
        await page.click("[data-editing-legacy]");
        await page.waitForSelector("#categoryRules .qe-rule-card");
        assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).processType, stateKey), "MIXED_XAI");
        assert.match(await page.locator("#qeProcessName").textContent(), /혼합형 XAI/);
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
        await page.waitForSelector("[data-editing-legacy]");
        await page.click("[data-editing-legacy]");
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
            await page.waitForSelector("[data-editing-rule-key]");
            assert.match(await page.locator(".editing-result-cards").textContent(), /THEN.*CODE = 0/s);
            assert.doesNotMatch(await page.locator("#qeEditingResults").textContent(), /ANOMALY_CANDIDATE|모델 일치율|Model agreement/);
            await page.click("[data-editing-rule-key]");
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
            assert.match(await page.locator("#qeEditingResults").textContent(), language === "ko" ? /검증 신뢰도/ : /Validation confidence/);
            fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
            await page.setViewportSize({ width: 1500, height: 1800 });
            await page.locator("#qeCategoricalDetail").screenshot({ path: path.join(root, `test-results/quick-edit-pattern-${language}.png`) });
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});

test("saved four-stage XAI drafts expose statistics, relationships and continuous formula results in both languages", async () => {
    for (const language of ["ko", "en"]) {
        const { browser, page, errors } = await openQuickEdit({processType: "MIXED_XAI", scenarioTableId: 30}, language, {api: async (request, response) => {
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
            await page.click("#qeLoadDiagnostics");
            await page.waitForSelector("#qeMixedEarlyStages details");
            assert.equal(await page.locator("#qeMixedEarlyStages details").count(), 2);
            for (const details of await page.locator("#qeMixedEarlyStages details").all()) await details.locator("summary").click();
            assert.match(await page.locator("#qeMixedEarlyStages").textContent(), /390/);
            assert.match(await page.locator("#qeMixedEarlyStages").textContent(), /0.985/);
            assert.match(await page.locator("#qeMixedEarlyStages").textContent(), language === "ko" ? /기초통계·결측 분석/ : /Basic statistics and missing values/);
            assert.equal(await page.locator("#categoryRules .qe-rule-card").count(), 0);
            await page.locator("#qeMixedEarlyStages").screenshot({path: path.join(root, `test-results/quick-edit-early-stages-${language}.png`)});
            await page.click('[data-editing-family="FORMULA"]');
            await page.waitForSelector("[data-editing-rule-key]");
            assert.equal(await page.locator("[data-editing-rule-key]").count(), 2);
            assert.match(await page.locator(".editing-result-cards").textContent(), /Y ≈ X \+ Z \(±2\)/);
            await page.locator("[data-editing-rule-key]").first().click();
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
    const {browser, page, requests, errors} = await openQuickEdit({processType: "MIXED_XAI", scenarioTableId: 30}, "en", {api: async (request, response) => {
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
        await page.click('[data-editing-family="FORMULA"]');
        await page.locator("[data-editing-rule-key]").first().click();
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
    const {browser, page, errors} = await openQuickEdit({processType: "MIXED_XAI", scenarioTableId: 30}, "en", {api: async (request, response) => {
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
        await page.click('[data-editing-family="FORMULA"]');
        await page.locator("[data-editing-rule-key]").first().click();
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

test("Mixed Quick keeps a visible zero-formula tab and shows 20 rules without averaging source metrics", async () => {
    for (const language of ["ko", "en"]) {
        const {browser, page, requests, errors} = await openQuickEdit({processType:"MIXED_XAI", scenarioTableId: 30}, language, {api: async (request, response) => {
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
            assert.equal(await page.isVisible('[data-editing-family="FORMULA"]'), true);
            assert.match(await page.locator(".editing-result-card").first().textContent(), /99.5%/);
            assert.match(await page.locator(".editing-result-card").first().textContent(), /1.25/);
            assert.equal(await page.locator(".editing-result-card").count(), 20);
            await page.click('[data-editing-family="FORMULA"]');
            await page.waitForSelector(".editing-result-empty");
            assert.equal(await page.locator(".editing-result-card").count(), 0);
            assert.doesNotMatch(await page.locator("#qeEditingResults").textContent(), /Average confidence/);
            assert.equal(await page.isVisible("#qeContinuousDetail"), false);
            assert.match(await page.locator("#qeEditingResults").textContent(), language === "ko" ? /대상에 해당하는 컬럼을 찾지 못/ : /No eligible continuous target/);
            const reasons = page.locator("#qeEditingResults details summary");
            if (await reasons.count()) await reasons.first().click();
            assert.match(await page.locator("#qeEditingResults").textContent(), language === "ko" ? /앞자리 0/ : /Leading-zero code/);
            assert.doesNotMatch(await page.locator("#qeEditingResults").textContent(), /LOW_CARDINALITY_TARGET|LEADING_ZERO_CODE/);
            assert.equal(requests.some((r) => /symbolic.*sample/.test(r.path)), false);
            fs.mkdirSync(path.join(root, "test-results"), {recursive:true});
            await page.locator("#qeEditingResults").screenshot({path:path.join(root,`test-results/quick-edit-continuous-zero-${language}.png`), style:".qe-topbar, .qe-stepper-wrap, .qe-toast { visibility: hidden; }"});
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});


test("Unified FLOW uses its four jobs even when old mixed and OML jobs coexist", () => {
    const { designer } = createFlowDesigner();
    const methods = ["UNIFIED_EDITING_PROFILE", "UNIFIED_EDITING_RELATION", "UNIFIED_EDITING_DISCOVER", "UNIFIED_EDITING_DETECT"];
    designer.flowType = "UNIFIED_EDITING_SCENARIO";
    designer.groupRegisteredJobs = () => methods.map((EXEC_METHOD, index) => ({ key: `M0300${index + 1}`,
        jobs: [{ EXEC_METHOD: "MIXED_XAI_PROFILE" }, { EXEC_METHOD: "OLD_MODEL" }, { EXEC_METHOD, EXEC_OBJECT_NAME: "CUSTOM_SAVED_NAME" }] }));
    assert.deepEqual(Array.from(designer.getFirstRegisteredJobsByGroup(), (job) => job.EXEC_METHOD), methods);
});

test("Unified Quick merges conditional and formula results while preserving source metadata", async () => {
    let failMixed = false;
    const methods = ["PROFILE", "RELATION", "DISCOVER", "DETECT"];
    const outputs = [
        [{ artifact: "COLUMN_TYPE_FINAL", objectName: "INIT$_TB_COLTYPE_FINAL" }], [],
        [{ artifact: "ASSOCIATION_MODEL", objectName: "UA_F_50_12345678", kind: "MODEL" },
         { artifact: "SYMBOLIC_RULE", objectName: "INIT$_TB_RULEDISC_SYMBOLIC" }],
        [{ artifact: "CAT_RULE_VIOLATION", objectName: "INIT$_TB_RULEVIOL_ASSOC" },
         { artifact: "SYMBOLIC_RULE_VIOLATION", objectName: "INIT$_TB_RULEVIOL_SYMBOLIC" }]
    ];
    const nodes = methods.map((method, i) => ({ FLOW_NODE_RUN_ID: i + 1, NODE_NAME: method, REF_MENU_CODE: `M0300${i + 1}`,
        EXEC_METHOD: `UNIFIED_EDITING_${method}`, STATUS: "SUCCESS", TARGET_OWNER: "TEST_OWNER", TARGET_TABLE: "INITUP$TEST",
        RESULT_OWNER: "TEST_OWNER", RESULT_OBJECTS: outputs[i] }));
    const { browser, page, requests, errors } = await openQuickEdit({}, "ko", { api: async (request, payload) => {
        if (request.path.endsWith("/provision-default-design")) return {status: "success", automation: {status: "success", processType: "UNIFIED", jobIds: [31,32,33,34], flowId: 40, flowName: "Unified"}};
        if (request.path.endsWith("/snapshot")) return {status: "success", data: {run: {STATUS: "SUCCESS"}, nodes}};
        if (request.path.endsWith("/nodes")) return {status: "success", data: nodes};
        if (request.path.endsWith("/model-rule-summary")) return {status: "success", overview: {TOTAL_RULES: 0}, rules: [], conditionDist: [], resultTop: []};
        if (request.path.endsWith("/result-table")) return {status: "success", data: [], columns: [], symbolicRuleSummary: {overview: {RULE_COUNT: 1}, topRules: [{RULE_ID: "OML_FORMULA", TARGET_COLUMN: "VALUE", EXPRESSION: "X * 3", METHOD: "SYMBOLIC", SCORE: .97}]}, violationSummary: {overview: {}, topRules: []}, symbolicViolationSummary: {overview: {}, topRules: []}};
        if (request.path.endsWith("/data/editable")) return {status: "success", data: [{"INIT$ROWID": "ROW1", COLUMN_NAME: "VALUE", DATA_TYPE: "VARCHAR2", FINAL_PREDICTED_TYPE: "숫자형연속형", TYPE_GROUP_CODE: "CONTINUOUS"}], columns: ["COLUMN_NAME", "FINAL_TYPE"], total: 1};
        if (request.path.endsWith("/mixed-xai-results")) {
            if (failMixed) return {status: "error", message: "Temporary mixed results failure"};
            Object.assign(payload.data.summary, {algorithm: "MIXED_PATTERN_TREE", integratedEditing: {processType: "UNIFIED"}});
            Object.assign(payload.data.ruleSummary.overview, {RULE_SOURCE: "MIXED_PATTERN_TREE"});
            Object.assign(payload.data.ruleSummary.rules[0], {RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", MODEL_NAME: "XAI_PATTERN_50", RESULT_COLUMN: "CODE", RESULT_TEXT: "CODE = A", RULE_CONFIDENCE: .99});
            payload.data.ruleSummary.rules.push({RULE_ID: "MIXED_FORMULA", RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", RESULT_KIND: "FORMULA", RESULT_COLUMN: "VALUE", RESULT_TEXT: "VALUE ≈ X + 2", RULE_CONFIDENCE: .98, VALIDATION_R2: .97, MODEL_NAME: "XAI_PATTERN_50"});
        }
        return payload;
    }});
    try {
        await page.click("#runButton");
        await page.waitForFunction((key) => ["success", "warning", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
        const state = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
        assert.equal(state.status, "success", state.error || state.resultWarning);
        assert.equal(state.processType, "UNIFIED");
        assert.equal(state.jobIds.length, 4);
        assert.equal(requests.find((r) => r.path.endsWith("/flow/run-saved")).body.quickEditSummary.flowType, "UNIFIED_EDITING_SCENARIO");
        assert.equal(await page.locator("[data-result-source]").count(), 0);
        assert.deepEqual(await page.locator("[data-editing-family]").evaluateAll((buttons) => buttons.map((b) => b.dataset.editingFamily)), ["CONDITION", "FORMULA"]);
        assert.match(await page.locator(".editing-result-cards").textContent(), /CODE = A/);
        assert.equal(requests.filter((r) => r.path.endsWith("/editing-results")).length, 1);
        assert.equal(requests.some((r) => /mixed-xai-results|model-rule-summary|result-table|descriptive-statistics/.test(r.path)), false);
        await page.click('[data-editing-family="FORMULA"]');
        await page.waitForFunction(() => document.querySelectorAll(".editing-result-card").length === 2);
        assert.match(await page.locator(".editing-result-cards").textContent(), /X \* 3/);
        assert.match(await page.locator(".editing-result-cards").textContent(), /VALUE ≈ X \+ 2/);
        assert.doesNotMatch(await page.locator("#qeEditingResults").textContent(), /평균 신뢰도|Average confidence|향상도|Lift/);
        const count = requests.length;
        await page.click('[data-editing-family="CONDITION"]');
        await page.click('[data-editing-family="FORMULA"]');
        assert.equal(requests.length, count);
        for (const [width, language] of [[1440, "ko"], [680, "en"]]) {
            await page.setViewportSize({width, height: 1100});
            await page.evaluate((language) => {sessionStorage.setItem("initLanguageCode", language); window.QuickEditWorkspace.onShow();}, language);
            if (await page.locator("[data-toast-close]").isVisible()) await page.locator("[data-toast-close]").click();
            await page.locator("#qeEditingResults").evaluate((element) => {
                const steps = document.querySelector(".qe-stepper-wrap");
                const offset = (parseFloat(getComputedStyle(steps).top) || 0) + steps.offsetHeight + 16;
                window.scrollTo({top: element.getBoundingClientRect().top + window.scrollY - offset, behavior: "instant"});
            });
            fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
            await page.screenshot({path: path.join(root, `test-results/quick-two-families-${language}-${width}.png`)});
            assert.equal(await page.locator('[data-editing-family][aria-pressed="true"]').count(), 1);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
        }
        await page.click("#qeLoadColumnTypes");
        await page.waitForSelector("#qeColumnTypeSummary:not([hidden])");
        assert.equal(requests.filter((r) => r.path.endsWith("/data/editable")).length, 1);
        await page.click("#qeColumnTypeEditorToggle");
        await page.selectOption('[data-column-type-index="0"]', "문자형범주형");
        await page.click('[data-editing-family="CONDITION"]');
        assert.equal(await page.inputValue('[data-column-type-index="0"]'), "문자형범주형");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});


test("Quick unified guidance and result view controls follow Korean and English without changing identifiers", async () => {
    for (const language of ["ko", "en"]) {
        const {browser, page, errors} = await openQuickEdit({}, language);
        try {
            assert.equal(await page.locator('input[name="processType"]').count(), 0);
            const title = await page.locator("#qeProcessName").textContent();
            const description = await page.locator("#qeProcessDescription").textContent();
            await page.click("#runButton");
            await page.waitForSelector("[data-editing-family]");
            const controls = await page.locator(".editing-result-tabs").textContent();
            assert.equal(await page.isVisible("#qePauseButton"), false);
            assert.equal(await page.isVisible("#qeStopButton"), false);
            if (language === "en") {
                assert.match(title, /Unified editing: four automatic stages/);
                assert.match(description, /column profiling/);
                assert.match(controls, /Condition rules.*Formula rules/s);
                assert.doesNotMatch(title + description + controls, /[가-힣]/);
                assert.match(await page.locator("#quickEditTitle").textContent(), /From one file/);
                assert.match(await page.locator("#runButton").textContent(), /Run all automatically|Start new work/);
                assert.doesNotMatch(await page.locator("#qeStepper").textContent(), /[가-힣]/);
                assert.match(await page.locator("#setupTitle").textContent(), /Choose a file/);
            } else {
                assert.match(title, /통합 에디팅 4단계 자동 실행/);
                assert.match(description, /컬럼 유형·기초통계/);
                assert.match(controls, /조건규칙.*수식규칙/s);
                assert.doesNotMatch(controls, /Unified run results|Both analyses/);
            }
            assert.deepEqual(await page.locator("[data-editing-family]").evaluateAll((buttons) => buttons.map((button) => button.dataset.editingFamily)), ["CONDITION", "FORMULA"]);
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});

test("Quick continuous zero states retain unavailable, failed and recorded diagnostic distinctions", async () => {
    const cases = [
        {name: "unrecorded", message: /No legacy formula diagnostics/},
        {name: "missing", message: /Some results are unavailable/},
        {name: "error", message: /Symbolic result request failed/},
        {name: "disabled", diagnostic: {parts: ["CATEGORICAL"], tasks: []}, message: /not requested/i},
        {name: "empty", diagnostic: {parts: ["CATEGORICAL", "CONTINUOUS"], tasks: [{task: "CONTINUOUS_SYMBOLIC", status: "success", skippedYn: "Y", skipReason: "NO_USABLE_CONTINUOUS_DATA", message: "No eligible target"}]}, message: /No eligible target/}
    ];
    for (const item of cases) {
        const {browser, page, errors} = await openQuickEdit({}, "en", {api: async (request, payload) => {
            if (request.path.endsWith("/editing-results")) {
                if (item.name === "error" && request.query.family === "FORMULA") return {status: "error", message: "Symbolic result request failed"};
                payload.data.rules = [];
                payload.data.total = 0;
                payload.data.summary.historicalExplanationCount = 0;
                payload.data.summary.sourceCounts = [{family: "FORMULA", source: "LEGACY_SYMBOLIC", status: item.name === "missing" ? "unavailable" : "available", ruleCount: item.name === "missing" ? null : 0}];
                payload.data.diagnostics.savedSummary = {integratedEditing: {stages: {DISCOVER: item.diagnostic ? {legacyDiagnostics: item.diagnostic} : {}}}};
            }
            return payload;
        }});
        try {
            await page.click("#runButton");
            await page.waitForFunction((key) => ["success", "warning", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
            await page.click('[data-editing-family="FORMULA"]');
            await page.waitForFunction(() => document.querySelector('.editing-result-view')?.getAttribute("aria-busy") === "false");
            assert.match(await page.locator("#qeEditingResults").textContent(), item.message);
            assert.equal(await page.locator("[data-editing-rule-key]").count(), 0);
            if (item.name === "error") {
                assert.equal(await page.locator("[data-editing-retry]").count(), 1);
                assert.equal(await page.locator(".editing-result-empty").count(), 0);
            }
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    }
});


test("Embedded Quick keeps the workspace alive for parent navigation and exposes safe lifecycle and server TTL hooks", async () => {
    let releaseProvision;
    let enteredProvision = false;
    const gate = new Promise((resolve) => {releaseProvision = resolve;});
    const {browser, page, requests, errors} = await openQuickEdit({processType: "MIXED_XAI", scenarioTableId: 30}, "en", {
        apiHeaders: {"X-INIT-Session-TTL-Seconds": "3600"},
        api: async (request, payload) => {
            if (request.path.endsWith("/provision-default-design")) {enteredProvision = true; await gate;}
            return payload;
        }
    });
    try {
        await page.route("http://quick-edit.test/workspace", (route) => route.fulfill({contentType: "text/html", body: `<!doctype html><html><body><script>
            window.navigation = []; window.sessionTtls = [];
            window.PageManager = {load: async (code) => window.navigation.push(code), extendSessionFromResponse: (response) => window.sessionTtls.push(response.headers.get('X-INIT-Session-TTL-Seconds'))};
            </script><iframe title="Quick Editing" style="width:100%;height:900px" src="/quick-edit/?embedded=1"></iframe></body></html>`}));
        await page.goto("http://quick-edit.test/workspace");
        const frame = page.frames().find((item) => item.url().includes("embedded=1"));
        await frame.waitForFunction(() => document.querySelector("#sessionStatus")?.dataset.state === "connected");
        assert.equal(await frame.locator("body").evaluate((body) => body.classList.contains("qe-embedded")), true);
        assert.equal(await frame.isVisible(".qe-brand"), false);
        assert.equal(await frame.isVisible("#qeRunHistoryButton"), true);
        const requestCount = requests.length;
        await page.evaluate(() => sessionStorage.setItem("initLanguageCode", "ko"));
        await frame.evaluate(() => window.QuickEditWorkspace.onShow());
        assert.match(await frame.locator("#quickEditTitle").textContent(), /파일 하나/);
        await page.evaluate(() => sessionStorage.setItem("initLanguageCode", "en"));
        await frame.evaluate(() => window.QuickEditWorkspace.onShow());
        assert.match(await frame.locator("#quickEditTitle").textContent(), /From one file/);
        assert.match(await frame.locator("#runButton").textContent(), /Run all automatically/);
        assert.equal(requests.length, requestCount);
        assert.equal(await frame.evaluate(() => window.QuickEditWorkspace.canClose()), true);
        assert.ok((await page.evaluate(() => window.sessionTtls)).every((ttl) => ttl === "3600"));
        assert.ok((await page.evaluate(() => window.sessionTtls)).length > 0);
        await frame.click("#closeButton");
        assert.deepEqual(await page.evaluate(() => window.navigation), ["home"]);
        assert.equal(frame.isDetached(), false);
        await frame.click("#runButton");
        await frame.waitForFunction(() => window.QuickEditWorkspace.getLifecycleState().busy);
        assert.equal(await frame.evaluate(() => window.QuickEditWorkspace.canClose()), false);
        while (!enteredProvision) await new Promise((resolve) => setTimeout(resolve, 10));
        await frame.click("#closeButton");
        assert.equal(frame.isDetached(), false);
        releaseProvision();
        await frame.waitForFunction((key) => ["success", "warning", "failed"].includes(JSON.parse(sessionStorage.getItem(key)).status), stateKey);
        assert.equal(await frame.evaluate(() => window.QuickEditWorkspace.canClose()), true);
        await frame.click("#qeOpenDetailedAnalysis");
        assert.equal((await page.evaluate(() => window.navigation)).at(-1), "M04002");
        assert.equal(frame.isDetached(), false);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("M04002:selectedRunId")), "50");
        assert.deepEqual(errors, []);
    } finally { releaseProvision(); await browser.close(); }
});

test("Quick restores browser drafts only after the server confirms the same user and Target DB", async () => {
    for (const sessionUserId of ["99", ""]) {
        let bootstrapUi;
        const {browser, page, requests, errors} = await openQuickEdit({sessionUserId, projectName: "PRIVATE_OTHER_USER_PROJECT", scenarioName: "PRIVATE_OTHER_USER_SCENARIO", fileMeta: {name: "PRIVATE_OTHER_USER_FILE.csv"}, flowRunId: 777, status: "success", completedSteps: [0,1,2,3,4,5,6,7]}, "en", {api: async (request, payload, currentPage) => {
            if (request.path.endsWith("/session/me")) bootstrapUi = await currentPage.evaluate(() => ({text: document.body.innerText, values: [...document.querySelectorAll("input")].map((input) => input.value).join(" ")}));
            return payload;
        }});
        try {
            assert.doesNotMatch(bootstrapUi.text + bootstrapUi.values, /PRIVATE_OTHER_USER/);
            assert.doesNotMatch(await page.locator("body").textContent(), /PRIVATE_OTHER_USER/);
            const state = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), stateKey);
            assert.equal(state.sessionUserId, "100");
            assert.equal(state.flowRunId, null);
            assert.equal(state.projectName, "");
            assert.equal(requests.some((request) => /777/.test(request.path + JSON.stringify(request.query))), false);
            assert.deepEqual(errors, []);
        } finally {await browser.close();}
    }
});

test("Target DB change waits for an in-flight preparation request then stops the old automatic chain", async () => {
    let entered = false;
    let currentTarget = 1;
    let release;
    const gate = new Promise((resolve) => {release = resolve;});
    const {browser, page, requests, errors} = await openQuickEdit({processType: "MIXED_XAI", scenarioTableId: 30}, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/session/me")) payload.targetConnectionId = currentTarget;
        if (request.path.endsWith("/provision-default-design")) {entered = true; await gate;}
        return payload;
    }});
    try {
        await page.click("#runButton");
        while (!entered) await new Promise((resolve) => setTimeout(resolve, 10));
        currentTarget = 2;
        await page.evaluate(() => {const channel = new BroadcastChannel("init.target-context.v1"); channel.postMessage({type: "TARGET_DB_CHANGED", targetConnectionId: 2}); channel.close();});
        await page.waitForSelector("#qeContextRecovery:not([hidden])");
        assert.equal(await page.evaluate(() => window.QuickEditWorkspace.canClose()), false);
        assert.equal(requests.filter((request) => request.path.endsWith("/session/me")).length, 1);
        release();
        await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key) || "null")?.targetContextId === 2, stateKey);
        assert.equal(await page.evaluate(() => window.QuickEditWorkspace.canClose()), true);
        assert.equal(requests.filter((request) => request.path.endsWith("/provision-default-design")).length, 1);
        assert.equal(requests.some((request) => request.path.endsWith("/flow/run-saved")), false);
        assert.match(await page.locator("#toast").textContent(), /server run was not cancelled/);
        assert.deepEqual(errors, []);
    } finally {release(); await browser.close();}
});

test("Target mismatch and session expiry stop polling without marking the server run cancelled or locking the workspace", async () => {
    for (const status of [409, 401]) {
        let contextChanged = false;
        const {browser, page, requests, errors} = await openQuickEdit({processType: "MIXED_XAI", scenarioTableId: 30}, "en", {
            apiStatus: (request) => request.path.endsWith("/snapshot") ? status : request.path.endsWith("/session/me") && contextChanged && status === 401 ? 401 : 200,
            api: async (request, payload) => {
                if (request.path.endsWith("/snapshot")) {contextChanged = true; return {status: "error", detail: status === 409 ? "Target DB context changed. Reload the page and try again." : "Session expired"};}
                if (request.path.endsWith("/session/me") && contextChanged) return status === 401 ? {status: "error", detail: "Session expired"} : {...payload, targetConnectionId: 2};
                return payload;
            }
        });
        try {
            await page.click("#runButton");
            if (status === 401) await page.waitForFunction(() => document.querySelector("#sessionStatus")?.dataset.state === "error");
            else await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key) || "null")?.targetContextId === 2, stateKey);
            assert.equal(await page.evaluate(() => window.QuickEditWorkspace.canClose()), true);
            assert.equal(requests.filter((request) => request.path.endsWith("/snapshot")).length, 1);
            assert.equal(requests.some((request) => request.path.includes("/control")), false);
            assert.equal(await page.isVisible("#resultsSection"), false);
            assert.deepEqual(errors, []);
        } finally {await browser.close();}
    }
});

function catalogEntry(source, family, id, overrides = {}) {
    const modelName = source === "MIXED_PATTERN" ? "PATTERN_50" : "OML_50";
    const scope = {flowRunId: 50, targetOwner: "TEST_OWNER", targetTable: "INITUP$TEST", modelName, ruleId: id, targetColumn: "Y", ruleOwner: "TEST_OWNER"};
    return {key: `${source}|50|TEST_OWNER|INITUP$TEST|${modelName}|${id}`, source, family, scope,
        artifact: {owner: "TEST_OWNER", objectName: source === "LEGACY_SYMBOLIC" ? "INIT$_TB_RULEDISC_SYMBOLIC" : "INIT$_TB_RULEDISC_ASSOC_SUM"},
        row: {RULE_ID: id, MODEL_NAME: modelName, CONDITION_TEXT: `X > ${id.replace(/\D/g, "") || 0}`, RESULT_COLUMN: "Y", RESULT_TEXT: `${source} result ${id}`,
            ...(source === "MIXED_PATTERN" ? {RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", RESULT_KIND: family === "FORMULA" ? "FORMULA" : "VALUE"} : {}),
            RULE_CONFIDENCE: .95, VIOLATION_COUNT: 22, ...overrides}};
}
function catalogPage(request, entries) {
    const family = request.query.family || "CONDITION", source = request.query.source || "ALL", page = Number(request.query.page || 1), pageSize = Number(request.query.pageSize || 20);
    const conditionCount = request.query.conditionCount || "ALL", excludeZero = request.query.excludeZero === "true";
    const all = entries.filter((entry) => entry.family === family && (source === "ALL" || entry.source === source));
    const selected = all.filter((entry) => (conditionCount === "ALL" || String(entry.row.CONDITION_COUNT ?? -1) === conditionCount)
        && (!excludeZero || entry.row.VIOLATION_COUNT !== 0));
    return {status: "success", data: {family, source, page, pageSize, filters: {conditionCount, excludeZero}, conditionCounts: [...new Set(all.map((entry) => String(entry.row.CONDITION_COUNT ?? -1)))].map((value) => ({value})), total: selected.length, hasMore: page * pageSize < selected.length,
        rules: selected.slice((page - 1) * pageSize, page * pageSize), summary: {
            families: Object.fromEntries(["CONDITION", "FORMULA"].map((name) => [name, {ruleCount: entries.filter((entry) => entry.family === name).length}])),
            sourceCounts: [], historicalExplanationCount: 0}, diagnostics: {errors: []}}};
}
const completedQuick = {processType: "UNIFIED", scenarioTableId: 30, flowId: 40, flowRunId: 50, status: "success", historyView: true, currentStep: 7, completedSteps: [0,1,2,3,4,5,6,7]};

test("Quick catalogs page 20 on the server and loads independent statistics and rule previews only on demand", async () => {
    const entries = [...Array.from({length: 20}, (_, i) => catalogEntry("LEGACY_ASSOC", "CONDITION", `R${i + 1}`)), catalogEntry("MIXED_PATTERN", "CONDITION", "R1"), catalogEntry("MIXED_PATTERN", "CONDITION", "R2")];
    let releaseStats, statsStarted = false;
    const statsGate = new Promise((resolve) => {releaseStats = resolve;});
    const {browser, page, requests, errors} = await openQuickEdit(completedQuick, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/descriptive-statistics")) {statsStarted = true; await statsGate;}
        if (request.path.endsWith("/editing-results")) {
            if (request.query.view === "violations") return {status: "success", data: {violations: [{CASE_ID: "PREVIEW", RESULT_COLUMN: "Y", ACTUAL_VALUE: "wrong"}], total: 1, page: 1, pageSize: 20, previewOnly: true}};
            return catalogPage(request, entries);
        }
        return payload;
    }});
    try {
        await page.waitForSelector(".editing-result-card");
        assert.equal(await page.locator(".editing-result-card").count(), 20);
        const resultCalls = () => requests.filter((r) => r.path.endsWith("/editing-results"));
        assert.equal(resultCalls().length, 1);
        assert.equal(resultCalls()[0].query.pageSize, "20");
        assert.equal(requests.some((r) => /descriptive-statistics|result-table|mixed-xai-results|model-rule-summary|sample/.test(r.path)), false);
        await page.locator('[data-editing-page="2"]').first().click();
        await page.waitForFunction(() => document.querySelectorAll(".editing-result-card").length === 2);
        assert.equal(resultCalls()[1].query.page, "2");
        await page.locator('[data-editing-page="1"]').first().click();
        assert.equal(await page.locator(".editing-result-card").count(), 20);
        assert.equal(resultCalls().length, 2);
        await page.click("#qeLoadStatistics");
        await page.waitForFunction(() => document.querySelector("#qeLoadStatistics").disabled);
        assert.equal(statsStarted, true);
        await page.selectOption("[data-editing-source]", "MIXED_PATTERN");
        await page.waitForFunction(() => document.querySelectorAll(".editing-result-card").length === 2);
        assert.equal(await page.isDisabled("#qeLoadColumnTypes"), false);
        await page.locator("[data-editing-rule-key]").first().click();
        assert.match(await page.locator("#qeCategoricalDetailBody").textContent(), /Mixed pattern discovery/);
        await page.click("#qeCategoricalDetail [data-load-violations]");
        await page.waitForSelector("[data-violation-grid]");
        const preview = resultCalls().find((r) => r.query.view === "violations");
        assert.equal(preview.query.ruleKey, entries[20].key);
        assert.equal(preview.query.pageSize, "20");
        assert.match(await page.locator("[data-violation-result]").first().textContent(), /Saved preview rows.*1/s);
        releaseStats();
        await page.waitForSelector("#qeStatisticsSummary:not([hidden])");
        assert.deepEqual(errors, []);
    } finally {releaseStats(); await browser.close();}
});

test("Quick ignores delayed family and violation responses after selection changes, including duplicate rule IDs", async () => {
    const entries = [catalogEntry("LEGACY_ASSOC", "CONDITION", "R1"), catalogEntry("MIXED_PATTERN", "CONDITION", "R1"), catalogEntry("MIXED_PATTERN", "FORMULA", "F1")];
    let releaseFamily, releaseViolation, familyStarted = false, violationStarted = false;
    const familyGate = new Promise((resolve) => {releaseFamily = resolve;});
    const violationGate = new Promise((resolve) => {releaseViolation = resolve;});
    const {browser, page, errors} = await openQuickEdit(completedQuick, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/editing-results")) {
            if (request.query.view === "violations") {violationStarted = true; await violationGate; return {status: "success", data: {violations: [{CASE_ID: "STALE_PREVIEW"}], total: 1, page: 1, pageSize: 20}};}
            if (request.query.family === "FORMULA") {familyStarted = true; await familyGate;}
            return catalogPage(request, entries);
        }
        return payload;
    }});
    try {
        await page.waitForSelector(".editing-result-card");
        await page.click('[data-editing-family="FORMULA"]');
        while (!familyStarted) await new Promise((resolve) => setTimeout(resolve, 5));
        await page.click('[data-editing-family="CONDITION"]');
        releaseFamily();
        await page.waitForTimeout(80);
        assert.equal(await page.locator('[data-editing-family="CONDITION"]').getAttribute("aria-pressed"), "true");
        assert.doesNotMatch(await page.locator(".editing-result-cards").textContent(), /F1/);
        await page.locator("[data-editing-rule-key]").first().click();
        await page.click("#qeCategoricalDetail [data-load-violations]");
        while (!violationStarted) await new Promise((resolve) => setTimeout(resolve, 5));
        await page.click("#qeEditingDetail [data-editing-back]");
        await page.locator("[data-editing-rule-key]").nth(1).click();
        releaseViolation();
        await page.waitForTimeout(80);
        assert.match(await page.locator("#qeCategoricalDetailBody").textContent(), /MIXED_PATTERN result R1/);
        assert.doesNotMatch(await page.locator("#qeCategoricalDetailBody").textContent(), /STALE_PREVIEW/);
        assert.deepEqual(errors, []);
    } finally {releaseFamily(); releaseViolation(); await browser.close();}
});

test("Quick family failures remain retryable without turning unavailable results into zero rules", async () => {
    let fail = true;
    const entries = [catalogEntry("LEGACY_ASSOC", "CONDITION", "R1"), catalogEntry("MIXED_PATTERN", "FORMULA", "F1")];
    const {browser, page, requests, errors} = await openQuickEdit(completedQuick, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/editing-results")) return request.query.family === "FORMULA" && fail ? {status: "error", message: "Formula catalog unavailable"} : catalogPage(request, entries);
        return payload;
    }});
    try {
        await page.waitForSelector(".editing-result-card");
        await page.click('[data-editing-family="FORMULA"]');
        await page.waitForSelector("[data-editing-retry]");
        assert.equal(await page.locator(".editing-result-card").count(), 0);
        assert.equal(await page.locator(".editing-result-empty").count(), 0);
        fail = false;
        await page.click("[data-editing-retry]");
        await page.waitForSelector(".editing-result-card");
        assert.match(await page.locator(".editing-result-cards").textContent(), /F1/);
        assert.equal(requests.filter((r) => r.path.endsWith("/editing-results") && r.query.family === "FORMULA").length, 2);
        await page.click('[data-editing-family="CONDITION"]');
        assert.match(await page.locator(".editing-result-cards").textContent(), /LEGACY_ASSOC result R1/);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("Quick formula details preserve source and target scope when both methods use the same rule ID", async () => {
    const legacy = catalogEntry("LEGACY_SYMBOLIC", "FORMULA", "R1", {TARGET_COLUMN: "Y", EXPRESSION: "X * 3", FEATURE_LIST: ["X"], METHOD: "SYMBOLIC", SCORE: .9});
    const mixed = catalogEntry("MIXED_PATTERN", "FORMULA", "R1", {RESULT_COLUMN: "Y", RESULT_TEXT: "Y ≈ X + 2", FORMULA_METHOD: "ROBUST_LINEAR"});
    const {browser, page, requests, errors} = await openQuickEdit(completedQuick, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/editing-results")) return catalogPage(request, [legacy, mixed]);
        if (request.path.endsWith("/symbolic-rule-sample")) return {status: "success", data: {rule: legacy.row, rows: [{X: 2, Y: 6}, {X: 4, Y: 12}], sampleCount: 2}};
        return payload;
    }});
    try {
        await page.waitForSelector("[data-editing-family]");
        await page.click('[data-editing-family="FORMULA"]');
        await page.locator("[data-editing-rule-key]").first().click();
        await page.waitForFunction(() => document.querySelector("#qeContinuousSampleTable")?.textContent.includes("12"));
        const query = requests.find((r) => r.path.endsWith("/symbolic-rule-sample")).query;
        assert.deepEqual([query.targetOwner, query.targetTable, query.targetColumn, query.ruleId, query.runId], ["TEST_OWNER", "INITUP$TEST", "Y", "R1", "50"]);
        await page.click("#qeEditingDetail [data-editing-back]");
        await page.locator("[data-editing-rule-key]").nth(1).click();
        await page.waitForSelector("#qeFormulaRuleChart svg");
        assert.equal(requests.filter((r) => r.path.endsWith("/mixed-formula-sample")).length, 1);
        assert.equal(requests.find((r) => r.path.endsWith("/mixed-formula-sample")).query.modelName, "PATTERN_50");
        assert.match(await page.locator("#qeContinuousRuleSummary").textContent(), /Mixed pattern discovery/);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("Quick historical target recovery scopes the catalog and lazy column types to the original M03001 target", async () => {
    const {browser, page, requests, errors} = await openQuickEdit({...completedQuick, tableOwner: "", tableName: ""}, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/snapshot")) payload.data.nodes = [{REF_MENU_CODE: "M03001", TARGET_OWNER: "RECOVERED_OWNER", TARGET_TABLE: "INITUP$RECOVERED", FLOW_NODE_RUN_ID: 9, STATUS: "SUCCESS"}];
        if (request.path.endsWith("/editing-results")) return catalogPage(request, []);
        return payload;
    }});
    try {
        await page.waitForFunction(() => document.querySelector(".editing-result-view")?.getAttribute("aria-busy") === "false");
        const catalog = requests.find((r) => r.path.endsWith("/editing-results"));
        assert.equal(catalog.query.targetOwner, "RECOVERED_OWNER");
        assert.equal(catalog.query.targetTable, "INITUP$RECOVERED");
        assert.equal(requests.some((r) => r.path.endsWith("/data/editable")), false);
        await page.click("#qeLoadColumnTypes");
        await page.waitForFunction(() => !document.querySelector("#qeLoadColumnTypes").disabled);
        const columns = requests.find((r) => r.path.endsWith("/data/editable"));
        assert.equal(columns.body.owner, "RECOVERED_OWNER");
        assert.match(columns.body.whereClause, /RECOVERED_OWNER.*INITUP\$RECOVERED/);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("Quick historical explanations and selected-rule candidates use independent server pages", async () => {
    const allRules = Array.from({length: 24}, (_, i) => ({...mixedResultFixture().data.ruleSummary.rules[0], RULE_ID: `OLD_${i + 1}`, CONDITION_TEXT: `OLD_CONDITION_${i + 1}`}));
    const {browser, page, requests, errors} = await openQuickEdit(completedQuick, "en", {api: async (request, payload) => {
        if (request.path.endsWith("/mixed-xai-results")) {
            const number = Number(request.query.page || 1);
            if (request.query.view === "violations") {
                payload.data.rules = allRules.filter((rule) => rule.RULE_ID === request.query.ruleId);
                payload.data.ruleSummary.rules = payload.data.rules;
                payload.data.violations = [{CASE_ID: `PREVIEW_PAGE_${number}`, RULE_ID: request.query.ruleId, ROW_DATA_JSON: {field: "saved candidate"}}];
                Object.assign(payload.data, {total: 24, page: number, pageSize: 20, hasMore: number === 1});
            } else {
                payload.data.ruleSummary.rules = allRules.slice((number - 1) * 20, number * 20);
                Object.assign(payload.data.ruleSummary, {total: 24, page: number, pageSize: 20});
                Object.assign(payload.data, {rules: payload.data.ruleSummary.rules, total: 24, page: number, pageSize: 20, hasMore: number === 1, violations: []});
            }
        }
        return payload;
    }});
    try {
        await page.waitForSelector("[data-editing-legacy]");
        await page.click("[data-editing-legacy]");
        await page.waitForFunction(() => document.querySelectorAll("#qeRuleSummaryTable tbody tr").length === 20);
        assert.equal(await page.locator("#categoryRules .qe-rule-card").count(), 20);
        await page.click('#qeRuleSummaryTable [data-summary-page="2"]');
        await page.waitForFunction(() => document.querySelectorAll("#qeRuleSummaryTable tbody tr").length === 4);
        assert.match(await page.locator("#qeRuleSummaryTable").textContent(), /OLD_21/);
        assert.equal(await page.locator("#categoryPanel #qeCategoricalDetail").count(), 1);
        await page.locator("#categoryRules .qe-rule-card").first().click();
        await page.click("#qeCategoricalDetail [data-load-violations]");
        await page.waitForSelector("[data-violation-grid]");
        assert.match(await page.locator("[data-violation-grid]").textContent(), /PREVIEW_PAGE_1/);
        await page.click('[data-violation-page="2"]');
        await page.waitForFunction(() => document.querySelector("[data-violation-grid]")?.textContent.includes("PREVIEW_PAGE_2"));
        const calls = requests.filter((r) => r.path.endsWith("/mixed-xai-results"));
        assert.deepEqual(calls.map((r) => [r.query.view || "rules", r.query.page, r.query.ruleId || ""]), [["rules", "1", ""], ["rules", "2", ""], ["violations", "1", "OLD_21"], ["violations", "2", "OLD_21"]]);
        assert.ok(calls.every((r) => r.query.pageSize === "20" && r.query.includeViolations === "false"));
        await page.click('[data-editing-family="CONDITION"]');
        assert.equal(await page.isVisible("#qeLegacyResultViews"), false);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});


test("Quick filters stay server scoped and back restores the same rule page and focus", async () => {
    const entries = Array.from({length: 44}, (_, i) => catalogEntry("MIXED_PATTERN", "CONDITION", `R${i}`, {CONDITION_COUNT: 2, VIOLATION_COUNT: i === 0 ? 0 : 3}));
    const {browser, page, requests, errors} = await openQuickEdit(completedQuick, "en", {api: async (request, payload) => request.path.endsWith("/editing-results") ? catalogPage(request, entries) : payload});
    try {
        await page.waitForSelector("[data-editing-condition]");
        await page.selectOption("[data-editing-condition]", "2");
        await page.check("[data-editing-exclude-zero]");
        await page.locator('[data-editing-page="2"]').first().click();
        await page.waitForFunction(() => document.querySelector(".editing-result-pagination").textContent.includes("Page 2"));
        const chosen = page.locator("[data-editing-rule-key]").nth(4);
        const key = await chosen.getAttribute("data-editing-rule-key");
        await chosen.scrollIntoViewIfNeeded();
        const position = await page.evaluate(() => scrollY);
        await chosen.click();
        assert.equal(await page.isVisible("#qeEditingResults"), false);
        assert.equal(await page.isVisible("#qeEditingDetail [data-editing-back]"), true);
        const count = requests.length;
        await page.click("#qeEditingDetail [data-editing-back]");
        await page.waitForTimeout(80);
        assert.equal(await page.locator("[data-editing-condition]").inputValue(), "2");
        assert.equal(await page.locator("[data-editing-exclude-zero]").isChecked(), true);
        assert.match(await page.locator(".editing-result-pagination").first().textContent(), /Page 2/);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.editingRuleKey), key);
        assert.ok(Math.abs((await page.evaluate(() => scrollY)) - position) < 3);
        assert.equal(requests.length, count);
        assert.ok(requests.some((r) => r.query.page === "2" && r.query.conditionCount === "2" && r.query.excludeZero === "true"));
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("Quick condition and result labels survive catalog to inline detail without auxiliary loading", async () => {
    const rule = catalogEntry("LEGACY_ASSOC", "CONDITION", "LABEL", {CONDITION_TEXT: "X > 20", RESULT_TEXT: "Y = 1"});
    rule.columnComments = {X: "조사 연도", Y: "응답 결과"};
    const {browser, page, requests, errors} = await openQuickEdit(completedQuick, "ko", {api: async (request, payload) => request.path.endsWith("/editing-results") ? catalogPage(request, [rule]) : payload});
    try {
        await page.waitForSelector("[data-editing-rule-key]");
        assert.match(await page.locator(".editing-result-card").textContent(), /X\[조사 연도\]/);
        await page.click("[data-editing-rule-key]");
        const text = await page.locator("#qeCategoricalDetail").textContent();
        assert.match(text, /X\[조사 연도\] > 20/);
        assert.match(text, /Y\[응답 결과\] = 1/);
        assert.match(text, /Y · 응답 결과/);
        assert.ok(!requests.some((r) => r.path.endsWith("/quick-edit-statistics")));
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
