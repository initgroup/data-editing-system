const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {chromium} = require("playwright");
const root = path.resolve(__dirname, "../..");

function formulaButton(tab, ruleId) {
    return tab.locator(`[onclick^="M04002.openMixedFormulaPopup('${ruleId}'"]`);
}

async function openPage(language = "ko", realRenderer = false) {
    const browser = await chromium.launch({headless: true});
    const tab = await browser.newPage({viewport: {width: 1440, height: 1100}});
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.route("**/*", (route) => route.abort());
    await tab.setContent('<div class="page-container table-page anly-work-page" id="container-M04002"><main class="anly-work-detail-panel"><div id="resultPanel-M04002"></div></main></div>');
    for (const file of ["frontend/css/styletail.css", "frontend/css/style.css", "frontend/css/styleMenu.css", "frontend/css/pages/MCOM_ANLY_WORK.css", "frontend/css/editing-result-view.css", "frontend/css/grid-custom.css"]) await tab.addStyleTag({path: path.join(root, file)});
    await tab.evaluate(() => {window.API_BASE_URL = "/api"; window.PageManager = {createHelper: () => ({getContainerEl: (selector) => document.querySelector(selector)})};});
    for (const file of ["frontend/js/rule-result-common.js", "frontend/js/editing-result-view.js", "frontend/js/MCOM_ANLY_WORK.js"]) await tab.addScriptTag({path: path.join(root, file)});
    if (realRenderer) {
        await tab.addStyleTag({path: path.join(root, "frontend/css/rule-chart-controls.css")});
        await tab.addStyleTag({path: path.join(root, "frontend/css/formula-rule-chart.css")});
        await tab.addScriptTag({path: path.join(root, "frontend/js/formula-rule-chart.js")});
    }
    const pack = JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/MCOM_ANLY_WORK.${language}.json`), "utf8"));
    await tab.evaluate(({pack, language, realRenderer}) => {
        window.M04002_PAGE_I18N = pack;
        window.I18nManager = {getSessionLanguage: () => language};
        window.requests = [];
        window.pending = [];
        window.mounted = [];
        window.destroyed = 0;
        window.CommonUtils = {request: (url, options) => {window.requests.push({url, options}); return new Promise((resolve, reject) => window.pending.push({resolve, reject}));}};
        if (!realRenderer) window.FormulaRuleChart = {mount: (el, data) => {window.mounted.push(data); el.textContent = "chart:" + data.rule.ruleId; return {destroy: () => {window.destroyed += 1;}};}};
        const p = window.MCOMMON.createAnlyWorkPage({pageCode: "M04002"});
        p.editingResultsMode = "SOURCE";
        const base = {RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", MODEL_NAME: "XAI_PATTERN_41", RESULT_KIND: "FORMULA", CONDITION_TEXT: "B IS NOT NULL AND C IS NOT NULL", CONDITION_COUNT: 2,
            RESULT_TEXT: "A ≈ B + C (±2)", RESULT_COLUMN: "A", RESULT_HAS_VALUE_YN: "Y", RULE_CONFIDENCE: .99, RULE_LIFT: null, VIOLATION_COUNT: 1, FORMULA_METHOD: "SUM_DIFFERENCE"};
        const rules = ["R1", "R2"].map((RULE_ID) => ({...base, RULE_ID, EDITING_RULE_KEY: `saved-key-${RULE_ID}`}));
        p.currentModelDetail = {mixedXai: {summary: {algorithm: "MIXED_PATTERN_TREE"}, ruleSummary: {rules}}};
        p.selectedRun = {FLOW_RUN_ID: 41};
        p.selectedNode = {FLOW_NODE_RUN_ID: 3, TARGET_OWNER: "OWNER", TARGET_TABLE: "SOURCE", RESULT_OWNER: "OWNER", RESULT_OBJECT_NAME: "INIT$_TB_RULEDISC_ASSOC_SUM"};
        p.nodes = [p.selectedNode];
        document.querySelector("#resultPanel-M04002").innerHTML = p.buildSummaryRuleCards(rules).map((rule) => p.renderReadableRuleCard(rule)).join("");
    }, {pack, language, realRenderer});
    return {browser, tab, errors};
}

function sample(ruleId = "R1") {
    return {rule: {ruleId, modelName: "XAI_PATTERN_41", resultColumn: "A", conditionText: "B IS NOT NULL AND C IS NOT NULL", resultText: "A ≈ B + C (±2)", absoluteTolerance: 2, relativeTolerance: 0},
        source: "CURRENT_SOURCE", sampling: "FIRST_ROWS_BALANCED", scanLimit: 5000, sampleLimit: 300, scannedCount: 5, applicableCount: 4, normalCount: 2, violationCount: 2,
        skipped: {conditionFalse: 1, nullActual: 1, invalidActual: 0, nonFinitePrediction: 0}, sampleCount: 3, isCapped: false, hasMore: false,
        points: [{rowId: "7", predicted: 10, actual: 11, lower: 8, upper: 12, residual: 1, violation: false, actualRaw: "11", values: {B: 4, C: 6}},
            {rowId: "8", predicted: 20, actual: 25, lower: 18, upper: 22, residual: 5, violation: true, actualRaw: "25", values: {B: 8, C: 12}},
            {rowId: "9", predicted: 30, actual: 30, lower: 28, upper: 32, residual: 0, violation: false, actualRaw: "30", values: {B: 14, C: 16}}]};
}

test("M04002 mixed formula popup scopes the current-source API and ignores replaced, closed and destroyed responses", async () => {
    const {browser, tab, errors} = await openPage();
    try {
        await formulaButton(tab, "R1").click();
        assert.match(await tab.locator("#M04002MixedFormulaChart").textContent(), /현재 원본 표본/);
        const request = await tab.evaluate(() => window.requests[0]);
        const url = new URL(request.url, "http://localhost");
        assert.equal(url.pathname, "/api/M04002/mixed-formula-sample");
        assert.deepEqual(Object.fromEntries(url.searchParams), {flowRunId: "41", targetOwner: "OWNER", targetTable: "SOURCE", modelName: "XAI_PATTERN_41", ruleId: "R1", sampleLimit: "300"});
        assert.equal(request.options.method, "GET");
        await tab.evaluate(() => {void window.M04002.openMixedFormulaPopup("R2");});
        await tab.evaluate((data) => window.pending[1].resolve({status: "success", data}), sample("R2"));
        await tab.waitForFunction(() => window.mounted.length === 1);
        await tab.evaluate((data) => window.pending[0].resolve({status: "success", data}), sample("R1"));
        assert.equal(await tab.locator("#M04002MixedFormulaChart").textContent(), "chart:R2");
        await tab.keyboard.press("Escape");
        assert.equal(await tab.locator("#M04002SymbolicRulePopup").count(), 0);
        assert.equal(await tab.evaluate(() => window.destroyed), 1);
        await tab.evaluate(() => {void window.M04002.openMixedFormulaPopup("R1"); window.M04002.closeSymbolicRulePopup();});
        await tab.evaluate((data) => window.pending[2].resolve({status: "success", data}), sample());
        assert.equal(await tab.evaluate(() => window.mounted.length), 1);
        await tab.evaluate(() => {void window.M04002.openMixedFormulaPopup("R1"); window.M04002.destroy();});
        await tab.evaluate((data) => window.pending[3].resolve({status: "success", data}), sample());
        assert.equal(await tab.evaluate(() => window.mounted.length), 1);
        assert.equal(await tab.locator("#M04002SymbolicRulePopup").count(), 0);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("M04002 mixed formula sample errors are escaped and retry the same rule without a legacy sample request", async () => {
    const {browser, tab, errors} = await openPage("en");
    try {
        await formulaButton(tab, "R1").click();
        await tab.evaluate(() => window.pending[0].reject(new Error("<script>bad source</script>")));
        await tab.waitForSelector("#M04002MixedFormulaChart .table-error");
        assert.equal(await tab.locator("#M04002MixedFormulaChart script").count(), 0);
        await tab.getByRole("button", {name: "Retry", exact: true}).click();
        await tab.evaluate((data) => window.pending[1].resolve({status: "success", data}), sample());
        await tab.waitForFunction(() => window.mounted.length === 1);
        assert.equal(await tab.evaluate(() => window.requests.length), 2);
        assert.equal(await tab.evaluate(() => window.requests.every((r) => r.url.includes("mixed-formula-sample") && r.url.includes("ruleId=R1"))), true);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("M04002 source graph keeps the clicked saved key when two models reuse a rule ID", async () => {
    const {browser, tab, errors} = await openPage("en");
    try {
        await tab.evaluate(() => {
            const p = window.M04002, rules = p.currentModelDetail.mixedXai.ruleSummary.rules;
            rules.push({...rules[0], MODEL_NAME: "SECOND_MODEL", EDITING_RULE_KEY: "second-model-key", RESULT_TEXT: "A ≈ B - C (±2)"});
            document.querySelector("#resultPanel-M04002").innerHTML = p.buildSummaryRuleCards(rules).map((rule) => p.renderReadableRuleCard(rule)).join("");
        });
        await formulaButton(tab, "R1").last().click();
        const request = await tab.evaluate(() => window.requests[0]);
        const params = new URL(request.url, "http://localhost").searchParams;
        assert.equal(params.get("ruleId"), "R1");
        assert.equal(params.get("modelName"), "SECOND_MODEL");
        assert.equal(await tab.evaluate(() => M04002.mixedFormulaPopupState.rule.EDITING_RULE_KEY), "second-model-key");
        await tab.evaluate((data) => window.pending[0].resolve({status: "success", data}), sample());
        await tab.waitForFunction(() => window.mounted.length === 1);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("M04002 stage 4 formula graph uses the same saved model and closes before a cached node result replaces it", async () => {
    const {browser, tab, errors} = await openPage();
    try {
        await tab.evaluate(() => {
            const p = window.M04002, rules = p.currentModelDetail.mixedXai.ruleSummary.rules;
            document.querySelector("#resultPanel-M04002").innerHTML = p.renderViolationSummary({mixedPattern: true, topRules: rules, overview: {}, topColumns: []});
        });
        await formulaButton(tab, "R1").click();
        await tab.evaluate(() => {
            const p = window.M04002;
            p.applyRememberedNodeResult = () => true;
            p.updateDescriptiveStatisticsButton = () => {};
            p.renderNodes = () => {};
            p.restoreNodeResultCache = () => true;
            void p.selectNode(3);
        });
        await tab.evaluate((data) => window.pending[0].resolve({status: "success", data}), sample());
        assert.equal(await tab.locator("#M04002SymbolicRulePopup").count(), 0);
        assert.equal(await tab.evaluate(() => window.mounted.length), 0);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("M04002 detailed rule table exposes the same formula graph action without turning ordinary values into formulas", async () => {
    const {browser, tab, errors} = await openPage("en");
    try {
        await tab.evaluate(() => {
            const p = window.M04002, payload = p.currentModelDetail.mixedXai;
            payload.ruleSummary.rules.push({RULE_ID: "VALUE_1", RULE_KIND: "MIXED_PATTERN_TREE", RESULT_KIND: "VALUE", RESULT_TEXT: "A = 1"});
            document.querySelector("#resultPanel-M04002").innerHTML = p.renderMixedXaiDetail({mixedXai: payload, ruleSummary: payload.ruleSummary});
        });
        assert.equal(await tab.locator("#resultPanel-M04002 [onclick*=openMixedFormulaPopup]").count(), 2);
        await formulaButton(tab, "R2").click();
        await tab.evaluate((data) => window.pending[0].resolve({status: "success", data}), sample("R2"));
        await tab.waitForFunction(() => window.mounted.length === 1);
        assert.equal(await tab.locator("#M04002MixedFormulaChart").textContent(), "chart:R2");
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("M04002 actual formula chart renders current samples, saved boundaries and row-linked residuals in both languages", async () => {
    for (const language of ["ko", "en"]) {
        const {browser, tab, errors} = await openPage(language, true);
        try {
            await formulaButton(tab, "R1").click();
            await tab.evaluate((data) => window.pending[0].resolve({status: "success", data}), sample());
            await tab.waitForSelector("#M04002MixedFormulaChart .formula-chart__point");
            assert.equal(await tab.locator(".formula-chart__point").count(), 3);
            assert.equal(await tab.locator(".formula-chart__boundary").count(), 2);
            assert.equal(await tab.locator(".formula-chart__point.is-violation").count(), 1);
            const chartText = await tab.locator(".formula-chart").textContent();
            assert.match(chartText, language === "ko" ? /현재 원본에 적용한/ : /current source data/);
            assert.match(chartText, language === "ko" ? /95% 신뢰구간·예측구간이 아닙니다/ : /not 95% confidence or prediction intervals/);
            assert.match(chartText, language === "ko" ? /실제값 결측 1/ : /Missing actual values 1/);
            assert.ok(await tab.locator("#M04002SymbolicRulePopup .formula-chart__expression").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
            fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
            await tab.locator("#M04002SymbolicRulePopup").screenshot({path: path.join(root, `test-results/m04002-formula-graph-${language}.png`)});
            assert.equal(await tab.locator(".formula-chart [data-chart-action]").evaluateAll((buttons) => buttons.every((button) => Math.abs(button.getBoundingClientRect().height - 32) < 1)), true);
            await tab.locator('.formula-chart [data-chart-action="maximize"]').click();
            assert.equal(await tab.locator('.formula-chart [data-chart-action="maximize"]').getAttribute("aria-pressed"), "true");
            assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            await tab.screenshot({path: path.join(root, `test-results/m04002-formula-maximized-${language}.png`)});
            await tab.keyboard.press("Escape");
            assert.equal(await tab.locator("#M04002SymbolicRulePopup").count(), 1);
            assert.equal(await tab.locator('.formula-chart [data-chart-action="maximize"]').getAttribute("aria-pressed"), "false");
            await tab.locator('.formula-chart__point[data-point="1"]').click();
            assert.deepEqual(await tab.locator('.formula-chart__table-wrap tr[aria-current="true"] td').allTextContents(), ["2", "8", "8", "12", "25", "20", "5", "18", "22", language === "ko" ? "규칙 위반" : "Violation"]);
            assert.match(await tab.locator(".formula-chart__table-wrap thead").textContent(), /B[\s\S]*C/);
            await tab.locator(".formula-chart__table-wrap").scrollIntoViewIfNeeded();
            await tab.locator("#M04002SymbolicRulePopup").screenshot({path: path.join(root, `test-results/m04002-formula-selected-row-${language}.png`)});
            await tab.locator(".formula-chart [data-mode]").selectOption("residual");
            assert.equal(await tab.locator(".formula-chart [data-chart-svg]").getAttribute("aria-label"), language === "ko" ? "잔차 vs 예측값" : "Residual vs predicted");
            assert.equal(await tab.locator(".formula-chart__point").count(), 3);
            assert.equal(await tab.locator('.formula-chart__table-wrap tr[aria-current="true"]').count(), 1);
            await tab.locator(".anly-work-symbolic-popup-body").evaluate((el) => {el.scrollTop = 0;});
            await tab.locator("#M04002SymbolicRulePopup").screenshot({path: path.join(root, `test-results/m04002-formula-residual-${language}.png`)});
            await tab.evaluate(() => window.M04002.closeSymbolicRulePopup());
            await tab.evaluate(() => {void window.M04002.openMixedFormulaPopup("R2");});
            const empty = sample("R2");
            empty.points = []; empty.sampleCount = 0; empty.skipped = {conditionFalse: 1, nullActual: 4, invalidActual: 0, nonFinitePrediction: 0};
            await tab.evaluate((data) => window.pending[1].resolve({status: "success", data}), empty);
            await tab.waitForSelector(".formula-chart__empty");
            assert.equal(await tab.locator(".formula-chart__point").count(), 0);
            assert.match(await tab.locator(".formula-chart__empty").textContent(), language === "ko" ? /숫자 좌표가 없습니다/ : /No numeric points/);
            assert.deepEqual(errors, []);
        } finally {await browser.close();}
    }
});
