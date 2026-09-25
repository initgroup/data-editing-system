const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../..");

function fixture() {
    const contract = JSON.parse(fs.readFileSync(path.join(root, "frontend/config/flow-model-contracts.json"), "utf8"));
    const nodes = ["DISCOVER", "DETECT"].map((method, index) => ({
        FLOW_NODE_RUN_ID: index + 3, NODE_NAME: method, STATUS: "SUCCESS", REF_MENU_CODE: `M0300${index + 3}`,
        EXEC_METHOD: `UNIFIED_EDITING_${method}`, RESULT_KIND: "TABLE", RESULT_OWNER: "OWNER",
        RESULT_OBJECT_NAME: index ? "INIT$_TB_RULEVIOL_ASSOC" : "INIT$_TB_RULEDISC_ASSOC_SUM",
        TARGET_OWNER: "OWNER", TARGET_TABLE: "SOURCE",
        RESULT_OBJECTS: contract.models[`UNIFIED_EDITING_${method}`].outputs.map((item) => ({
            ...item, owner: "OWNER", kind: contract.artifacts[item.artifact].kind,
            label: item.label || contract.artifacts[item.artifact].label,
            objectName: item.objectName === ":INIT$ResultModelName" ? "INIT_UA_F_41" : item.objectName
        })),
        RUN_OUTPUT: { apiResult: { legacy: { results: [{ task: "CATEGORICAL_RULE_VIOLATION", modelName: "INIT_UA_F_41" }] } } }
    }));
    const value = {
        RULE_ID: "MIXED_VALUE_RULE", RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE",
        MODEL_TYPE: "MIXED_PATTERN_TREE", MODEL_NAME: "XAI_PATTERN_41", RESULT_KIND: "VALUE",
        CONDITION_TEXT: "INPUT > 10", CONDITION_COLUMNS: ["INPUT"], CONDITION_COUNT: 1,
        CONDITION_AST: { column: "INPUT", operator: ">", value: 10 },
        RESULT_COLUMN: "MIXED_VALUE_RESULT", RESULT_TEXT: "MIXED_VALUE_RESULT = 7", RESULT_VALUE: 7,
        RESULT_AST: { column: "MIXED_VALUE_RESULT", operator: "=", value: 7 }, RESULT_HAS_VALUE_YN: "Y",
        CONDITION_TOTAL_COUNT: 100, SUPPORT_COUNT: 99, RULE_CONFIDENCE: .99, RULE_LIFT: 1.98, RULE_SUPPORT: .495,
        VALIDATION_CONFIDENCE: .98, VALIDATION_COUNT: 50, VALIDATION_SUPPORT_COUNT: 49,
        VIOLATION_COUNT: 1, MATCH_COUNT: 1, VALIDATION_STATUS: "VALIDATED"
    };
    const formula = {
        ...value, RULE_ID: "MIXED_FORMULA_RULE", RESULT_KIND: "FORMULA", RESULT_COLUMN: "MIXED_FORMULA_RESULT",
        RESULT_TEXT: "MIXED_FORMULA_RESULT ≈ INPUT * 2 + 3", RESULT_VALUE: null, RULE_LIFT: null,
        RESULT_AST: { operator: "WITHIN_TOLERANCE", column: "MIXED_FORMULA_RESULT", expression: {
            operator: "ADD", left: { operator: "MULTIPLY", left: { column: "INPUT" }, right: { value: 2 } }, right: { value: 3 }
        }, absoluteTolerance: 1, relativeTolerance: 0 },
        VALIDATION_R2: .97, VALIDATION_MAE: .3, VALIDATION_RMSE: .4, ABSOLUTE_TOLERANCE: 1, RELATIVE_TOLERANCE: 0
    };
    const summary = (rules, source) => ({
        overview: { TOTAL_RULES: rules.length, MAPPED_RULES: rules.length, NON_PERFECT_CONF_RULES: rules.length, RULE_SOURCE: source },
        rules, total: rules.length, page: 1, pageSize: 20, conditionDist: [{ CONDITION_COUNT: 1, RULE_COUNT: rules.length }],
        resultTop: rules.map((rule) => ({ RESULT_COLUMN: rule.RESULT_COLUMN, RULE_COUNT: 1 })), resultTopTotal: rules.length,
        columnComments: {}
    });
    const categorical = { ...value, RULE_ID: "OML_RULE", RULE_KIND: "ASSOCIATION", RULE_SOURCE: "ASSOCIATION",
        MODEL_TYPE: "ASSOCIATION_RULES", MODEL_NAME: "INIT_UA_F_41", RESULT_COLUMN: "OML_RESULT",
        RESULT_TEXT: "OML_RESULT = 7", RESULT_AST: { column: "OML_RESULT", operator: "=", value: 7 } };
    return {
        nodes, categorical: { detail: { owner: "OWNER", modelName: "INIT_UA_F_41", metadata: { ALGORITHM: "APRIORI" } },
            rules: summary([categorical], "ASSOCIATION") },
        mixed: { summary: { algorithm: "MIXED_PATTERN_TREE", algorithmVersion: 2, trainCount: 100, validationCount: 50,
            ruleCount: 2, violationCount: 2, integratedEditing: { processType: "UNIFIED" },
            continuous: { enabled: true, status: "RULES_AVAILABLE", targetCount: 1, eligibleTargetCount: 1 } },
            ruleSummary: summary([value, formula], "MIXED_PATTERN_TREE"),
            violations: [value, formula].map((rule, index) => ({ RULE_ID: rule.RULE_ID, CASE_ID: `CASE_${index}`,
                CASE_ROWID: `ROW_${index}`, RESULT_COLUMN: rule.RESULT_COLUMN, EXPECTED_VALUE: "7", ACTUAL_VALUE: "8" })) }
    };
}

async function openAnalysis(language = "en", width = 1500, sourceView = true) {
    const browser = await chromium.launch({ headless: true });
    const tab = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    try {
        await tab.route("**/*", (route) => route.fulfill({ contentType: "text/html", body:
            '<div style="padding:16px"><div class="page-container table-page anly-work-page" id="container-M04002"><main class="anly-work-detail-panel"><section><div id="nodeList-M04002" class="anly-work-node-grid"></div></section><section id="resultPanel-M04002" class="anly-work-result-panel"></section></main></div></div>' }));
        await tab.goto("http://unified-result-views.test/");
        const shell = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");
        const pageStyles = JSON.parse(shell.match(/window\.APP_PAGE_CSS_FILES\s*=\s*(\[[\s\S]*?\]);/)[1]);
        for (const file of ["css/styletail.css", "css/style.css", "css/styleMenu.css", ...pageStyles, "css/editing-result-view.css", "css/grid-custom.css"]) {
            await tab.addStyleTag({ path: path.join(root, "frontend", file) });
        }
        await tab.evaluate((language) => {
            window.PageManager = { createHelper: () => ({ getContainerEl: (selector) => document.querySelector(selector) }) };
            window.API_BASE_URL = "/api";
            window.I18nManager = { getSessionLanguage: () => language };
            sessionStorage.setItem("initLanguageCode", language);
        }, language);
        for (const file of ["frontend/js/rule-result-common.js", "frontend/js/editing-result-view.js", "frontend/js/MCOM_ANLY_WORK.js"]) {
            await tab.addScriptTag({ path: path.join(root, file) });
        }
        const data = fixture();
        const pack = JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/MCOM_ANLY_WORK.${language}.json`), "utf8"));
        await tab.evaluate(async ({ data, pack, sourceView }) => {
            window.M04002_PAGE_I18N = pack;
            window.fixture = data;
            window.editingEntries = [
                ...data.categorical.rules.rules.map((row) => ({ source: "LEGACY_ASSOC", family: "CONDITION", row })),
                ...data.mixed.ruleSummary.rules.map((row) => ({ source: "MIXED_PATTERN", family: row.RESULT_KIND === "FORMULA" ? "FORMULA" : "CONDITION", row })),
                { source: "LEGACY_SYMBOLIC", family: "FORMULA", row: { RULE_ID: "SYMBOLIC_RULE", TARGET_COLUMN: "SYMBOLIC_TARGET", EXPRESSION: "INPUT * 3", FEATURE_COLUMNS: "INPUT", SCORE: .96, SELECTED_YN: "Y", METHOD: "SYMBOLIC", RUN_ID: 41 } }
            ].map((entry, index) => ({ ...entry, key: `rule-key-${index}`, scope: { flowRunId: 41, targetOwner: "OWNER", targetTable: "SOURCE",
                modelName: entry.row.MODEL_NAME || "SYMBOLIC_41", ruleId: entry.row.RULE_ID, targetColumn: entry.row.RESULT_COLUMN || entry.row.TARGET_COLUMN, ruleOwner: "OWNER" },
                artifact: { owner: "OWNER", objectName: entry.source === "LEGACY_SYMBOLIC" ? "INIT$_TB_RULEDISC_SYMBOLIC" : "INIT$_TB_RULEDISC_ASSOC_SUM" } }));
            window.calls = [];
            window.CommonUtils = { getRuntimeSetting: (_key, fallback) => fallback, request: async (url) => {
                window.calls.push(url);
                if (window.deferPath && url.includes(window.deferPath)) await new Promise((resolve, reject) => {
                    window.releaseResponse = resolve;
                    window.rejectResponse = () => reject(new Error("STALE_OUTPUT_ERROR"));
                });
                if (url.includes("/editing-results?")) {
                    const params = new URL(url, location.href).searchParams;
                    const family = params.get("family"), source = params.get("source"), page = Number(params.get("page")), pageSize = Number(params.get("pageSize"));
                    if (params.get("view") === "violations") {
                        const rule = window.editingEntries.find((entry) => entry.key === params.get("ruleKey"));
                        return { data: { rule, violations: [{ RULE_ID: rule.scope.ruleId, MODEL_NAME: rule.scope.modelName, ACTUAL_VALUE: rule.source + "_PREVIEW" }],
                            columns: ["RULE_ID", "MODEL_NAME", "ACTUAL_VALUE"], page, pageSize, total: 1, hasMore: false, previewOnly: true } };
                    }
                    const conditionCount = params.get("conditionCount") || "ALL", excludeZero = params.get("excludeZero") === "true";
                    const all = window.editingEntries.filter((item) => item.family === family && (source === "ALL" || source === item.source));
                    const entries = all.filter((item) => (conditionCount === "ALL" || String(item.row.CONDITION_COUNT ?? -1) === conditionCount) && (!excludeZero || item.row.VIOLATION_COUNT !== 0));
                    return { data: { family, source, filters: {conditionCount, excludeZero}, conditionCounts: [...new Set(all.map((item) => String(item.row.CONDITION_COUNT ?? -1)))].map((value) => ({value})), rules: structuredClone(entries.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total: entries.length, hasMore: page * pageSize < entries.length,
                        summary: { families: { CONDITION: { total: window.editingEntries.filter((item) => item.family === "CONDITION").length }, FORMULA: { total: window.editingEntries.filter((item) => item.family === "FORMULA").length } },
                            sourceCounts: ["CONDITION", "FORMULA"].flatMap((family) => ["LEGACY_ASSOC", "LEGACY_SYMBOLIC", "MIXED_PATTERN"].map((source) => ({
                                family, source, ruleCount: window.editingEntries.filter((item) => item.family === family && item.source === source).length }))), historicalExplanationCount: window.historicalCount || 0 } } };
                }
                if (url.includes("model-rule-summary")) {
                    if (window.deferRuleSummary) return new Promise((resolve, reject) => {
                        window.finishRuleSummary = () => resolve(structuredClone(data.categorical.rules));
                        window.failRuleSummary = () => reject(new Error("STALE_SUMMARY_ERROR"));
                    });
                    return structuredClone(data.categorical.rules);
                }
                if (url.includes("model-result-summary")) return structuredClone(data.categorical);
                if (url.includes("model-view")) return { status: "success", viewType: "VR", viewName: "OLD_OML_VIEW",
                    columns: ["OLD_COLUMN"], data: [{ OLD_COLUMN: "STALE_OML_VIEW" }], total: 1, page: 2, pageSize: 8 };
                if (url.includes("mixed-xai-results")) {
                    const params = new URL(url, location.href).searchParams;
                    const page = Number(params.get("page") || 1), pageSize = Number(params.get("pageSize") || 20);
                    const all = data.mixed.ruleSummary.rules;
                    if (params.get("view") === "violations") {
                        const ruleId = params.get("ruleId"), rows = data.mixed.violations.filter((row) => row.RULE_ID === ruleId);
                        return { data: { summary: data.mixed.summary, ruleSummary: { ...data.mixed.ruleSummary, rules: all.filter((row) => row.RULE_ID === ruleId) },
                            violations: structuredClone(rows.slice((page - 1) * pageSize, page * pageSize)), total: rows.length, page, pageSize,
                            hasMore: page * pageSize < rows.length, previewOnly: true, countBasis: "STORED_EXPLANATION_MATCHES" } };
                    }
                    return { data: { ...structuredClone(data.mixed), violations: [], violationsIncluded: false,
                        ruleSummary: { ...structuredClone(data.mixed.ruleSummary), rules: structuredClone(all.slice((page - 1) * pageSize, page * pageSize)), total: all.length, distributionScope: "PAGE" },
                        total: all.length, page, pageSize, hasMore: page * pageSize < all.length } };
                }
                if (url.includes("symbolic-rule-sample")) {
                    const params = new URL(url, location.href).searchParams;
                    return { status: "success", data: { rule: { RULE_ID: params.get("ruleId"), TARGET_COLUMN: params.get("targetColumn"), EXPRESSION: "INPUT * 3", FEATURE_COLUMNS: "INPUT" }, rows: [], sampleCount: 0 } };
                }
                if (url.includes("result-table")) {
                    const objectName = new URL(url, location.href).searchParams.get("objectName");
                    const result = { status: "success", owner: "OWNER", objectName, columns: ["RESULT_FAMILY"],
                        data: [{ RESULT_FAMILY: objectName.endsWith("SYMBOLIC") ? "SYMBOLIC_ONLY" : "OML_DETECT_ONLY" }], total: 1, page: 1, pageSize: 20 };
                    if (objectName === "INIT$_TB_RULEDISC_SYMBOLIC") result.symbolicRuleSummary = window.customSymbolicSummary || {
                        targetOwner: "OWNER", targetTable: "SOURCE", overview: { RULE_COUNT: 1, SELECTED_RULE_COUNT: 1 },
                        topRules: [{ RULE_ID: "SYMBOLIC_RULE", TARGET_COLUMN: "SYMBOLIC_TARGET", EXPRESSION: "INPUT * 3",
                            FEATURE_COLUMNS: "INPUT", SCORE: .96, SELECTED_YN: "Y", METHOD: "SYMBOLIC", RUN_ID: 41 }]
                    };
                    return result;
                }
                throw new Error(`Unexpected result API: ${url}`);
            } };
            const p = window.MCOMMON.createAnlyWorkPage({ pageCode: "M04002" });
            p.selectedRun = { FLOW_RUN_ID: 41 };
            p.nodes = structuredClone(data.nodes);
            await p.selectNode(3);
            if (sourceView) await p.openEditingSourceAnalysis(p.editingResultData.rules[0].key);
        }, { data, pack, sourceView });
        return { browser, tab, errors };
    } catch (error) {
        await browser.close();
        throw error;
    }
}

async function selectOutput(tab, family, duringPendingRequest = false) {
    await tab.evaluate(async () => {
        if (window.M04002.editingResultsMode !== "SOURCE") await window.M04002.openEditingSourceAnalysis(window.M04002.editingResultData.rules[0].key);
    });
    const index = await tab.evaluate((family) => window.M04002.getNodeResultSwitcherItems().findIndex((item) => {
        if (family === "MIXED") return String(item.artifact).startsWith("MIXED_XAI_");
        if (family === "CATEGORICAL") return item.integratedRuleGroup === family || item.artifact === "CAT_RULE_VIOLATION";
        return item.integratedRuleGroup === family || item.artifact === "SYMBOLIC_RULE_VIOLATION";
    }), family);
    assert.ok(index >= 0, `${family} output must be available`);
    if (duringPendingRequest) await tab.evaluate((index) => window.M04002.selectNodeResult(index), index);
    else await tab.locator(`.anly-work-result-switcher button[onclick="M04002.selectNodeResult(${index})"]`).click();
    await tab.waitForFunction((index) => {
        const button = document.querySelector(`.anly-work-result-switcher button[onclick="M04002.selectNodeResult(${index})"]`);
        return button?.getAttribute("aria-pressed") === "true" && !document.querySelector("#resultPanel-M04002.is-loading");
    }, index);
    assert.equal(await tab.locator(".anly-work-result-switcher button[aria-pressed=true]").count(), 1);
}

async function expectMixedOrder(tab) {
    assert.equal(await tab.evaluate(() => {
        const outer = document.querySelector(".anly-work-result-switcher");
        const inner = document.querySelector("[data-mixed-rule-family]");
        return Boolean(outer && inner && (outer.compareDocumentPosition(inner) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true, "main output navigation must precede the selected output's family navigation");
}

test("source analysis discovery transitions keep selected family, detail mode, metrics and export consistent", async () => {
    const { browser, tab, errors } = await openAnalysis();
    try {
        assert.match(await tab.locator(".anly-work-readable-rule-card").textContent(), /OML_RESULT/);
        const nodeLabels = await tab.locator(".anly-work-node-card").allTextContents();
        await selectOutput(tab, "CONTINUOUS");
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /SYMBOLIC_ONLY/);
        assert.equal(await tab.locator(".anly-work-symbolic-rule-card").count(), 1);
        assert.equal(await tab.locator("[data-mixed-rule-family]").count(), 0);
        await selectOutput(tab, "MIXED");
        assert.deepEqual(await tab.locator(".anly-work-node-card").allTextContents(), nodeLabels, "choosing a result view must preserve the executed node labels");
        assert.match(await tab.locator(".anly-work-readable-rule-card").textContent(), /MIXED_VALUE_RESULT/);
        assert.doesNotMatch(await tab.locator(".anly-work-readable-rule-card").textContent(), /MIXED_FORMULA_RESULT|OML_RESULT/);
        assert.doesNotMatch(await tab.evaluate(() => window.M04002.getModelHeaderLabel(window.M04002.currentModelDetail)), /formulas/i);
        assert.match(await tab.locator(".anly-work-result-header small").first().textContent(), /INIT\$_TB_RULEDISC_ASSOC_SUM/);
        assert.equal(await tab.locator(".anly-work-result-header").evaluate((header) => [...header.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).join("")), "", "execution metadata must render inside its element, not as a bare model name");
        await expectMixedOrder(tab);
        await tab.locator('button[onclick="M04002.switchModelAnalysisTab(\'detail\')"]').click();
        assert.equal(await tab.evaluate(() => window.M04002.getActiveModelAnalysisTab()), "detail");
        await tab.locator('[data-mixed-rule-family] button[onclick*="FORMULA"]').click();
        assert.equal(await tab.evaluate(() => window.M04002.getActiveModelAnalysisTab()), "detail", "changing rule family must preserve the chosen detail view");
        assert.match(await tab.locator('.anly-work-model-tab-panel.is-active').textContent(), /MIXED_FORMULA_RESULT/);
        assert.doesNotMatch(await tab.locator('.anly-work-model-tab-panel.is-active').textContent(), /MIXED_VALUE_RESULT|OML_RESULT/);
        assert.deepEqual(await tab.evaluate(() => window.M04002.currentExport.rows.map((row) => row.RULE_ID)), ["MIXED_FORMULA_RULE"]);
        await selectOutput(tab, "CATEGORICAL");
        assert.equal(await tab.locator("[data-mixed-rule-family]").count(), 0);
        assert.match(await tab.locator(".anly-work-readable-rule-card").textContent(), /OML_RESULT/);
        assert.equal(await tab.evaluate(() => Boolean(window.M04002.currentModelDetail.mixedXai)), false);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("source analysis detection keeps source navigation above mixed families and loads violations only after selecting a rule", async () => {
    const { browser, tab, errors } = await openAnalysis();
    try {
        await tab.evaluate(() => window.M04002.selectNode(4));
        const nodeLabels = await tab.locator(".anly-work-node-card").allTextContents();
        await selectOutput(tab, "CONTINUOUS");
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /SYMBOLIC_ONLY/);
        await selectOutput(tab, "MIXED");
        assert.deepEqual(await tab.locator(".anly-work-node-card").allTextContents(), nodeLabels);
        assert.match(await tab.locator(".anly-work-result-header small").first().textContent(), /INIT\$_TB_RULEVIOL_ASSOC/);
        assert.equal(await tab.locator(".anly-work-violation-summary").count(), 1, "unified mixed alias must resolve the violation renderer");
        assert.equal(await tab.locator(".anly-work-violation-rule-grid article").count(), 1);
        await expectMixedOrder(tab);
        await tab.locator('[data-mixed-rule-family] button[onclick*="FORMULA"]').click();
        await expectMixedOrder(tab);
        assert.match(await tab.locator(".anly-work-violation-rule-grid").textContent(), /MIXED_FORMULA_RESULT/);
        assert.doesNotMatch(await tab.locator(".anly-work-violation-rule-grid").textContent(), /MIXED_VALUE_RESULT/);
        assert.equal(await tab.locator('button[onclick*="selectViolationResultScope"]').count() > 0, true);
        assert.deepEqual(await tab.evaluate(() => window.M04002.currentExport.rows), []);
        assert.equal(await tab.locator(".anly-work-table-profile-bars").count(), 0, "bounded violation previews must not be presented as dataset statistics");
        assert.equal(await tab.evaluate(() => window.M04002.currentExport.columns.includes("RULE_LIFT")), false, "formula exports must not advertise an inapplicable lift metric");
        assert.match(await tab.locator("#tableResultBody-M04002").textContent(), /Rule details and violations/);
        assert.equal(await tab.evaluate(() => calls.some((url) => url.includes("view=violations"))), false);
        await tab.locator('.anly-work-violation-rule-grid [onclick*="openViolationSqlPopup"]').click();
        await tab.waitForFunction(() => M04002.editingDetailData?.rule?.scope?.ruleId === "MIXED_FORMULA_RULE");
        assert.deepEqual(await tab.evaluate(() => M04002.currentExport.rows.map((row) => row.RULE_ID)), ["MIXED_FORMULA_RULE"]);
        await tab.locator('[data-editing-source-analysis]').click();
        await selectOutput(tab, "CATEGORICAL");
        assert.equal(await tab.locator("[data-mixed-rule-family]").count(), 0);
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /OML_DETECT_ONLY/);
        assert.doesNotMatch(await tab.locator("#resultPanel-M04002").textContent(), /MIXED_FORMULA_RESULT|MIXED_VALUE_RESULT/);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

for (const outcome of ["success", "error"]) {
    test(`late categorical rule-summary ${outcome} cannot alter an active mixed result on the same node`, async () => {
        const { browser, tab, errors } = await openAnalysis();
        try {
            await tab.evaluate(() => {
                window.deferRuleSummary = true;
                window.pendingRuleSummary = window.M04002.loadModelRuleSummary(2);
            });
            await tab.waitForFunction(() => Boolean(window.finishRuleSummary));
            await selectOutput(tab, "MIXED", true);
            const before = await tab.evaluate(() => ({
                html: document.querySelector("#resultPanel-M04002").innerHTML,
                export: JSON.stringify(window.M04002.currentExport),
                detail: JSON.stringify(window.M04002.currentModelDetail)
            }));
            await tab.evaluate(async (outcome) => {
                outcome === "success" ? window.finishRuleSummary() : window.failRuleSummary();
                await window.pendingRuleSummary;
            }, outcome);
            const after = await tab.evaluate(() => ({
                html: document.querySelector("#resultPanel-M04002").innerHTML,
                export: JSON.stringify(window.M04002.currentExport),
                detail: JSON.stringify(window.M04002.currentModelDetail)
            }));
            for (const key of Object.keys(before)) {
                assert.equal(createHash("sha256").update(after[key]).digest("hex"), createHash("sha256").update(before[key]).digest("hex"),
                    `the older output's response must not mutate the current ${key}`);
            }
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    });

    test(`late rule violation detail ${outcome} cannot replace another execution node`, async () => {
        const { browser, tab, errors } = await openAnalysis("en", 1500, false);
        try {
            await tab.evaluate(() => { window.deferPath = "view=violations"; window.pendingDetail = M04002.openEditingRule("rule-key-1"); });
            await tab.waitForFunction(() => Boolean(window.releaseResponse));
            await tab.evaluate(() => M04002.selectNode(4));
            const before = await tab.locator("#resultPanel-M04002").innerHTML();
            await tab.evaluate(async (outcome) => { outcome === "success" ? releaseResponse() : rejectResponse(); await pendingDetail; }, outcome);
            assert.equal(await tab.locator("#resultPanel-M04002").innerHTML(), before);
            assert.equal(await tab.evaluate(() => M04002.selectedNode.FLOW_NODE_RUN_ID), 4);
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    });
}

for (const loader of ["loadModelView", "loadModelAnalysisViewPage", "refreshResultGridOnly"]) {
    for (const outcome of ["success", "error"]) {
        test(`late ${loader} ${outcome} cannot replace the mixed output on the same node`, async () => {
            const { browser, tab, errors } = await openAnalysis();
            try {
                if (loader === "refreshResultGridOnly") await selectOutput(tab, "CONTINUOUS");
                await tab.evaluate((loader) => {
                    window.deferPath = loader === "refreshResultGridOnly" ? "/result-table?" : "/model-view?";
                    window.pendingOutput = loader === "refreshResultGridOnly" ? window.M04002[loader](2)
                        : window.M04002[loader]("VR", 2);
                }, loader);
                await tab.waitForFunction(() => Boolean(window.releaseResponse));
                await selectOutput(tab, "MIXED", true);
                const getState = () => tab.evaluate(() => ({
                    html: document.querySelector("#resultPanel-M04002").innerHTML,
                    export: JSON.stringify(window.M04002.currentExport),
                    detail: JSON.stringify(window.M04002.currentModelDetail),
                    table: JSON.stringify(window.M04002.lastResultTableJson)
                }));
                const before = await getState();
                await tab.evaluate(async (outcome) => {
                    outcome === "success" ? window.releaseResponse() : window.rejectResponse();
                    await window.pendingOutput;
                }, outcome);
                const after = await getState();
                for (const key of Object.keys(before)) assert.equal(createHash("sha256").update(after[key]).digest("hex"),
                    createHash("sha256").update(before[key]).digest("hex"), `${loader} must preserve active ${key}`);
                assert.deepEqual(errors, []);
            } finally { await browser.close(); }
        });
    }
}

test("advanced source views render in both languages at desktop and narrow widths", async () => {
    for (const language of ["en", "ko"]) {
        for (const width of [1500, 780]) {
            const { browser, tab, errors } = await openAnalysis(language, width);
            try {
                await tab.evaluate(() => window.M04002.selectNode(4));
                await selectOutput(tab, "MIXED");
                await tab.locator('[data-mixed-rule-family] button[onclick*="FORMULA"]').click();
                await expectMixedOrder(tab);
                assert.equal(await tab.locator(".anly-work-violation-rule-grid article").count(), 1);
                assert.equal(await tab.locator(".anly-work-result-switcher button[aria-pressed=true]").count(), 1);
                assert.equal(await tab.locator("[data-mixed-rule-family] button[aria-pressed=true]").count(), 1);
                const panelText = await tab.locator("#resultPanel-M04002").textContent();
                assert.match(panelText, language === "ko" ? /허용 오차 충족률/ : /Within-tolerance rate/);
                assert.equal(await tab.evaluate(() => document.querySelector(".anly-work-result-switcher").scrollWidth
                    <= document.querySelector(".anly-work-result-switcher").clientWidth + 1), true);
                fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
                const bounds = await tab.locator("#resultPanel-M04002").boundingBox();
                await tab.setViewportSize({ width, height: Math.ceil(bounds.y + bounds.height + 40) });
                await tab.locator("#resultPanel-M04002").screenshot({ path: path.join(root, `test-results/m04002-source-view-${language}-${width}.png`) });
                assert.deepEqual(errors, []);
            } finally { await browser.close(); }
        }
    }
});

test("final rules combine compatible sources into two semantic types without eager source or violation queries", async () => {
    const { browser, tab, errors } = await openAnalysis("en", 1500, false);
    try {
        assert.equal(await tab.locator("[data-editing-family]").count(), 2);
        assert.equal(await tab.locator(".anly-work-result-switcher").count(), 0);
        assert.equal(await tab.locator(".editing-result-card").count(), 2);
        assert.match(await tab.locator(".editing-result-cards").textContent(), /OML_RESULT[\s\S]*MIXED_VALUE_RESULT/);
        assert.doesNotMatch(await tab.locator(".editing-result-cards").textContent(), /MIXED_FORMULA_RESULT|SYMBOLIC_TARGET/);
        assert.deepEqual(await tab.evaluate(() => calls.map((url) => new URL(url, location.href).pathname)), ["/api/mlAnalysis/editing-results"]);
        await tab.locator('[data-editing-family="FORMULA"]').click();
        await tab.waitForFunction(() => M04002.editingResultData?.family === "FORMULA");
        assert.match(await tab.locator(".editing-result-cards").textContent(), /MIXED_FORMULA_RESULT[\s\S]*SYMBOLIC_TARGET/);
        assert.doesNotMatch(await tab.locator(".editing-result-cards").textContent(), /OML_RESULT|MIXED_VALUE_RESULT/);
        assert.deepEqual(await tab.evaluate(() => M04002.currentExport.rows.map((row) => row.SOURCE).sort()), ["LEGACY_SYMBOLIC", "MIXED_PATTERN"]);
        assert.equal(await tab.evaluate(() => calls.some((url) => /mixed-xai-results|result-table|model-result-summary|view=violations/.test(url))), false);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("same rule IDs from different methods keep distinct keys through lazy details, exports and source analysis", async () => {
    const { browser, tab, errors } = await openAnalysis("en", 1500, false);
    try {
        await tab.evaluate(async () => {
            editingEntries.filter((entry) => entry.family === "CONDITION").forEach((entry) => { entry.row.RULE_ID = "SAME_ID"; entry.scope.ruleId = "SAME_ID"; });
            await M04002.loadEditingResults(1);
        });
        await tab.locator('[data-editing-rule-key="rule-key-1"]').click();
        await tab.waitForFunction(() => M04002.editingDetailData?.rule?.key === "rule-key-1");
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /MIXED_PATTERN_PREVIEW/);
        assert.doesNotMatch(await tab.locator("#resultPanel-M04002").textContent(), /LEGACY_ASSOC_PREVIEW/);
        assert.equal(await tab.evaluate(() => M04002.currentExport.rows[0].RULE_KEY), "rule-key-1");
        assert.equal(await tab.evaluate(() => M04002.currentExport.rows[0].SOURCE), "MIXED_PATTERN");
        assert.equal(await tab.locator("[data-editing-rule-key]").count(), 0, "the selected detail must not contain a redundant open-details button");
        await tab.locator('[data-editing-source-analysis]').click();
        assert.equal(await tab.evaluate(() => M04002.editingResultsMode), "SOURCE");
        assert.match(await tab.locator(".anly-work-readable-rule-card").textContent(), /MIXED_VALUE_RESULT/);
        await tab.locator("[data-editing-back]").click();
        assert.equal(await tab.locator("[data-editing-family]").count(), 2);
        assert.equal(await tab.locator(".editing-result-card").count(), 2);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("symbolic graphs carry the selected table and column when the same rule ID exists in multiple targets", async () => {
    const { browser, tab, errors } = await openAnalysis();
    try {
        for (const [targetOwner, targetTable] of [["FIRST_OWNER", "FIRST_TABLE"], ["SECOND_OWNER", "SECOND_TABLE"]]) {
            await tab.evaluate(({ targetOwner, targetTable }) => {
                window.customSymbolicSummary = { targetOwner, targetTable, runSourceType: "FLOW_WORK", runId: 41,
                    overview: { RULE_COUNT: 2, SELECTED_RULE_COUNT: 2 },
                    topRules: ["FIRST_COLUMN", "SECOND_COLUMN"].map((column, index) => ({ RULE_ID: "REUSED_ID", TARGET_COLUMN: column,
                        EXPRESSION: `INPUT * ${index + 2}`, FEATURE_COLUMNS: "INPUT", SCORE: .9, SELECTED_YN: "Y", METHOD: "SYMBOLIC", RANK_NO: index + 1 })) };
            }, { targetOwner, targetTable });
            await selectOutput(tab, "CONTINUOUS");
            await tab.locator('.anly-work-symbolic-rule-card button[title="View formula graph"]').nth(1).click();
            await tab.waitForFunction(({ targetOwner, targetTable }) => calls.some((url) => {
                const parsed = new URL(url, location.href);
                return parsed.pathname.endsWith("/symbolic-rule-sample") && parsed.searchParams.get("targetOwner") === targetOwner
                    && parsed.searchParams.get("targetTable") === targetTable && parsed.searchParams.get("targetColumn") === "SECOND_COLUMN";
            }), { targetOwner, targetTable });
            assert.equal(await tab.evaluate(() => M04002.symbolicRuleChartState.rule.TARGET_COLUMN), "SECOND_COLUMN");
            await tab.evaluate(() => M04002.closeSymbolicRulePopup());
        }
        await tab.evaluate(() => {
            M04002.lastSymbolicViolationSummary = customSymbolicSummary;
            M04002.openSymbolicViolationRulePopup("REUSED_ID", "SECOND_COLUMN");
        });
        assert.equal(await tab.evaluate(() => M04002.symbolicRuleChartState.rule.TARGET_COLUMN), "SECOND_COLUMN", "violation graph lookup must also disambiguate the clicked column before querying");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("advanced mixed source pages reach rules beyond twenty and preserve the selected composite key", async () => {
    const { browser, tab, errors } = await openAnalysis();
    try {
        await tab.evaluate(() => {
            const condition = editingEntries.find((entry) => entry.source === "MIXED_PATTERN" && entry.family === "CONDITION");
            const formula = editingEntries.find((entry) => entry.source === "MIXED_PATTERN" && entry.family === "FORMULA");
            window.editingEntries = [...Array.from({ length: 43 }, (_, i) => ({ ...structuredClone(condition), key: `mixed-page-${i}`,
                scope: { ...condition.scope, ruleId: i === 31 ? "RULE_30" : `RULE_${i}`, modelName: `MODEL_${i}` },
                row: { ...condition.row, RULE_ID: i === 31 ? "RULE_30" : `RULE_${i}`, MODEL_NAME: `MODEL_${i}`, RESULT_TEXT: `SOURCE_PAGE_${i}` } })), formula];
        });
        await selectOutput(tab, "MIXED");
        assert.equal(await tab.locator(".anly-work-readable-rule-card").count(), 20);
        assert.match(await tab.locator("[data-mixed-source-page]").textContent(), /current rule page[\s\S]*43/);
        assert.match(await tab.locator("[data-mixed-rule-family]").textContent(), /43[\s\S]*1/);
        await tab.locator('[data-mixed-source-page] button').last().click();
        await tab.waitForFunction(() => M04002.currentModelDetail?.mixedXai?.sourcePage?.page === 2);
        assert.equal(await tab.locator(".anly-work-readable-rule-card").count(), 20);
        const selected = tab.locator(".anly-work-readable-rule-card").filter({ hasText: "SOURCE_PAGE_31" });
        await selected.locator('[onclick*="openViolationForRule"]').click();
        await tab.waitForFunction(() => M04002.editingDetailData?.rule?.key === "mixed-page-31");
        assert.equal(await tab.evaluate(() => M04002.editingDetailData.rule.scope.modelName), "MODEL_31");
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /MIXED_PATTERN_PREVIEW/);
        assert.equal(await tab.evaluate(() => calls.filter((url) => url.includes("view=violations")).length), 1);
        await tab.evaluate(() => M04002.returnToEditingResults());
        await tab.locator('[data-editing-family="FORMULA"]').click();
        await tab.waitForFunction(() => M04002.editingResultData?.family === "FORMULA");
        await tab.locator('[data-editing-rule-key="rule-key-2"]').click();
        await tab.waitForFunction(() => M04002.editingDetailData?.rule?.key === "rule-key-2");
        await tab.locator('[data-editing-source-analysis]').click();
        await tab.waitForFunction(() => M04002.currentModelDetail?.mixedXai?.catalogData?.family === "FORMULA");
        assert.equal(await tab.locator(".anly-work-symbolic-rule-card").count(), 1);
        assert.ok((await tab.evaluate(() => calls.filter((url) => /mixed-xai-results|editing-results/.test(url)))).every((url) => new URL(url, "http://test").searchParams.get("pageSize") === "20"));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("historical explanations page beyond twenty and fetch only the selected rule's saved candidates", async () => {
    const { browser, tab, errors } = await openAnalysis("ko", 1500, false);
    try {
        await tab.evaluate(async () => {
            const rules = Array.from({ length: 43 }, (_, i) => ({ RULE_ID: `OLD_${i}`, RULE_KIND: "MIXED_XAI", RULE_SOURCE: "MIXED_XAI",
                CONDITION_TEXT: `INPUT > ${i}`, CONDITION_COUNT: 1, CONDITION_COLUMNS: ["INPUT"], RESULT_COLUMN: "ANOMALY_CANDIDATE", RESULT_TEXT: "ANOMALY_CANDIDATE = Y",
                RESULT_HAS_VALUE_YN: "Y", MODEL_AGREEMENT: .8, MATCH_COUNT: 41, RULE_CONFIDENCE: null, RULE_LIFT: null }));
            fixture.mixed = { summary: { algorithm: "ISOLATION_FOREST_SURROGATE", trainCount: 100 },
                ruleSummary: { rules, total: 43, overview: { RULE_SOURCE: "MIXED_XAI", TOTAL_RULES: 43 }, conditionDist: [], resultTop: [], columnComments: {} },
                violations: Array.from({ length: 41 }, (_, i) => ({ RULE_ID: "OLD_30", CASE_ID: `OLD_CASE_${i}`, ROW_DATA_JSON: { VALUE: `SAVED_CANDIDATE_${i}` } })) };
            await M04002.openEditingHistoricalExplanation();
        });
        assert.equal(await tab.locator(".anly-work-readable-rule-card").count(), 20);
        assert.match(await tab.locator("[data-mixed-source-page]").textContent(), /현재 규칙 페이지[\s\S]*43/);
        await tab.locator('[data-mixed-source-page] button').last().click();
        await tab.waitForFunction(() => M04002.currentModelDetail?.mixedXai?.sourcePage?.page === 2);
        await tab.locator('.anly-work-readable-rule-card [onclick*="openViolationForRule(\'OLD_30\'"]').click();
        await tab.waitForFunction(() => M04002.currentExport.filename === "historical-explanation-preview.csv");
        assert.equal(await tab.evaluate(() => M04002.currentExport.rows.length), 20);
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /과거 이상 후보 설명[\s\S]*SAVED_CANDIDATE_0/);
        assert.doesNotMatch(await tab.locator("#resultPanel-M04002").textContent(), /SAVED_CANDIDATE_20/);
        await tab.locator('[onclick="M04002.loadHistoricalRuleViolations(\'OLD_30\', 2)"]').click();
        await tab.waitForFunction(() => M04002.currentExport.rows[0]?.CASE_ID === "OLD_CASE_20");
        assert.equal(await tab.evaluate(() => M04002.currentExport.rows.length), 20);
        assert.match(await tab.locator("#resultPanel-M04002").textContent(), /SAVED_CANDIDATE_20/);
        const requests = await tab.evaluate(() => calls.filter((url) => url.includes("mixed-xai-results")).map((url) => Object.fromEntries(new URL(url, location.href).searchParams)));
        assert.deepEqual(requests.filter((p) => p.view === "violations").map((p) => [p.ruleId, p.targetOwner, p.targetTable, p.page, p.pageSize]),
            [["OLD_30", "OWNER", "SOURCE", "1", "20"], ["OLD_30", "OWNER", "SOURCE", "2", "20"]]);
        assert.ok(requests.filter((p) => !p.view).every((p) => p.includeViolations === "false"));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("server pages remain bounded and method filters do not merge scores or fetch all rules", async () => {
    const { browser, tab, errors } = await openAnalysis("en", 1500, false);
    try {
        await tab.evaluate(async () => {
            const entry = editingEntries[0];
            window.editingEntries = Array.from({ length: 43 }, (_, i) => ({ ...structuredClone(entry), key: `page-rule-${i}`, row: { ...entry.row, RESULT_TEXT: `PAGE_RULE_${i}` } }));
            await M04002.loadEditingResults(1);
        });
        assert.equal(await tab.locator(".editing-result-card").count(), 20);
        await tab.locator('[data-editing-page="2"]').first().click();
        await tab.waitForFunction(() => M04002.editingResultData?.page === 2);
        assert.equal(await tab.locator(".editing-result-card").count(), 20);
        assert.match(await tab.locator(".editing-result-cards").textContent(), /PAGE_RULE_20/);
        await tab.locator("[data-editing-source]").selectOption("MIXED_PATTERN");
        await tab.waitForFunction(() => M04002.editingResultData?.source === "MIXED_PATTERN");
        assert.equal(await tab.locator(".editing-result-card").count(), 0);
        assert.equal(await tab.evaluate(() => M04002.editingResultData.page), 1);
        assert.ok((await tab.evaluate(() => calls)).every((url) => new URL(url, "http://unified-result-views.test/").searchParams.get("pageSize") === "20"));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

for (const outcome of ["success", "error"]) {
    test(`late final-rule page ${outcome} cannot replace a different semantic family`, async () => {
        const { browser, tab, errors } = await openAnalysis("en", 1500, false);
        try {
            await tab.evaluate(() => { window.deferPath = "family=CONDITION"; window.pendingEditing = M04002.loadEditingResults(2); });
            await tab.waitForFunction(() => Boolean(window.releaseResponse));
            await tab.locator('[data-editing-family="FORMULA"]').click();
            await tab.waitForFunction(() => M04002.editingResultData?.family === "FORMULA");
            const before = await tab.locator("#resultPanel-M04002").innerHTML();
            await tab.evaluate(async (outcome) => { outcome === "success" ? releaseResponse() : rejectResponse(); await pendingEditing; }, outcome);
            assert.equal(await tab.locator("#resultPanel-M04002").innerHTML(), before);
            assert.deepEqual(errors, []);
        } finally { await browser.close(); }
    });
}

test("historical anomaly explanations stay separate and cache restoration preserves the chosen semantic family", async () => {
    const { browser, tab, errors } = await openAnalysis("ko", 1500, false);
    try {
        await tab.evaluate(async () => { window.historicalCount = 3; await M04002.loadEditingResults(1); });
        assert.equal(await tab.locator("[data-editing-family]").count(), 2);
        assert.match(await tab.locator("[data-editing-legacy]").textContent(), /과거.*3/);
        await tab.locator('[data-editing-family="FORMULA"]').click();
        await tab.waitForFunction(() => M04002.editingResultData?.family === "FORMULA");
        const before = await tab.evaluate(() => calls.length);
        await tab.evaluate(async () => { await M04002.selectNode(4); await M04002.selectNode(3); });
        assert.equal(await tab.locator('[data-editing-family="FORMULA"]').getAttribute("aria-pressed"), "true");
        assert.equal(await tab.evaluate(() => calls.length), before + 1, "returning to the discovery cache must not re-fetch its results");
        await tab.locator('[data-editing-family="CONDITION"]').click();
        await tab.waitForFunction(() => M04002.editingResultData?.family === "CONDITION");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("semantic editing results render with actual CSS in both languages and narrow layouts", async () => {
    for (const language of ["en", "ko"]) {
        for (const width of [1500, 780]) {
            const { browser, tab, errors } = await openAnalysis(language, width, false);
            try {
                await tab.locator('[data-editing-family="FORMULA"]').click();
                await tab.waitForFunction(() => M04002.editingResultData?.family === "FORMULA");
                assert.equal(await tab.locator('[data-editing-family][aria-pressed="true"]').count(), 1);
                assert.equal(await tab.locator(".editing-result-card").count(), 2);
                assert.match(await tab.locator(".editing-result-tabs").textContent(), language === "ko" ? /조건규칙.*수식규칙/ : /Condition rules.*Formula rules/s);
                assert.equal(await tab.locator(".editing-result-view").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
                fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
                await tab.locator("#resultPanel-M04002").screenshot({ path: path.join(root, `test-results/m04002-unified-view-${language}-${width}.png`) });
                assert.deepEqual(errors, []);
            } finally { await browser.close(); }
        }
    }
});


test("detail navigation restores filtered server page and focus and wraps long metadata in both languages", async () => {
    for (const [language, width] of [["ko", 1500], ["en", 430]]) {
        const {browser, tab, errors} = await openAnalysis(language, width, false);
        try {
            await tab.evaluate(async () => {
                const original = editingEntries.find((item) => item.family === "CONDITION");
                editingEntries = Array.from({length: 46}, (_, i) => ({...structuredClone(original), key: `long-${i}`,
                    scope: {...original.scope, ruleId: "RULE_".repeat(25) + i, modelName: "MODEL_".repeat(20), targetTable: "TARGET_".repeat(17)},
                    row: {...original.row, CONDITION_COUNT: 2, VIOLATION_COUNT: i === 0 ? 0 : 3}}));
                await M04002.loadEditingResults(1);
            });
            await tab.selectOption("[data-editing-condition]", "2");
            await tab.check("[data-editing-exclude-zero]");
            await tab.locator('[data-editing-page="2"]').first().click();
            await tab.waitForFunction(() => M04002.editingResultData?.page === 2);
            const chosen = tab.locator("[data-editing-rule-key]").nth(5);
            const key = await chosen.getAttribute("data-editing-rule-key");
            await chosen.scrollIntoViewIfNeeded();
            const position = await tab.evaluate(() => scrollY);
            await chosen.click();
            await tab.waitForFunction(() => !!M04002.editingDetailData);
            await tab.locator(".editing-result-metadata summary").click();
            assert.equal(await tab.locator(".editing-result-metadata dl dt").count(), 4);
            assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            assert.ok(await tab.locator(".editing-result-metadata dd").evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1)));
            await tab.screenshot({path: `test-results/editing-detail-layout-${language}-${width}.png`, fullPage: true});
            const callsBefore = await tab.evaluate(() => calls.length);
            await tab.locator("[data-editing-back]").click();
            await tab.waitForTimeout(80);
            assert.equal(await tab.locator("[data-editing-condition]").inputValue(), "2");
            assert.equal(await tab.locator("[data-editing-exclude-zero]").isChecked(), true);
            assert.equal(await tab.evaluate(() => M04002.editingResultData.page), 2);
            assert.equal(await tab.evaluate(() => document.activeElement.dataset.editingRuleKey), key);
            assert.ok(Math.abs((await tab.evaluate(() => scrollY)) - position) < 3);
            assert.equal(await tab.evaluate(() => calls.length), callsBefore);
            assert.deepEqual(errors, []);
        } finally {await browser.close();}
    }
});
