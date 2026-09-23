const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");

function setup(language = "ko") {
    const panel = { innerHTML: "", classList: { remove() {} }, querySelector: () => null,
        insertAdjacentHTML(position, html) { this.innerHTML = position === "afterbegin" ? html + this.innerHTML : this.innerHTML + html; } };
    const sandbox = { URLSearchParams, window: { sessionStorage: { getItem: () => language } },
        PageManager: { createHelper: () => ({ getContainerEl: () => panel }) }, API_BASE_URL: "/api" };
    for (const file of ["frontend/js/rule-result-common.js", "frontend/js/MCOM_ANLY_WORK.js"]) {
        vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
    }
    sandbox.window.M04002_PAGE_I18N = JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/MCOM_ANLY_WORK.${language}.json`), "utf8"));
    const page = sandbox.window.MCOMMON.createAnlyWorkPage({ pageCode: "M04002" });
    const common = sandbox.window.RuleResultCommon;
    const rows = Array.from({ length: 25 }, (_, i) => ({ RULE_ID: `R${i}`, RULE_KIND: "MIXED_XAI", RULE_SOURCE: "MIXED_XAI",
        CONDITION_TEXT: 'VALUE > 10 AND KIND = "<script>"', CONDITION_COUNT: i % 2 + 1, CONDITION_COLUMNS: ["VALUE", "KIND"],
        RESULT_COLUMN: "ANOMALY_CANDIDATE", RESULT_TEXT: "ANOMALY_CANDIDATE = Y", RESULT_HAS_VALUE_YN: "Y",
        CONDITION_AST: {column: "VALUE", operator: ">", value: 10, valueType: "BINARY_FLOAT"}, CONDITION_TOTAL_COUNT: 10, SUPPORT_COUNT: 8, RULE_SUPPORT: .08, RULE_CONFIDENCE: null, RULE_LIFT: null,
        MODEL_AGREEMENT: .8, MATCH_COUNT: i, HOLDOUT_COUNT: 3, HOLDOUT_AGREEMENT: .66, VALIDATION_STATUS: "INSUFFICIENT_HOLDOUT_SUPPORT" }));
    const summary = { overview: { TOTAL_RULES: 25, MAPPED_RULES: 25, MISSING_RESULT_RULES: 0, NON_PERFECT_CONF_RULES: 24, RULE_SOURCE: "MIXED_XAI" },
        rules: rows, conditionDist: [{ CONDITION_COUNT: 1, RULE_COUNT: 13, NON_PERFECT_CONF_RULES: 12 }],
        resultTop: [{ RESULT_COLUMN: "ANOMALY_CANDIDATE", RULE_COUNT: 25 }], resultTopTotal: 1, page: 1, pageSize: 20, total: 25 };
    page.selectedNode = { RESULT_OBJECT_NAME: "INIT$_TB_RULEDISC_XAI", RESULT_OWNER: "OWNER", TARGET_OWNER: "OWNER", TARGET_TABLE: "SOURCE" };
    page.selectedRun = { FLOW_RUN_ID: 41 };
    page.currentModelDetail = { owner: "OWNER", modelName: "INIT$_TB_RULEDISC_XAI", ruleSummary: common.filterSummary(summary),
        mixedXai: { ruleSummary: summary, summary: { trainCount: 100, holdoutCount: 30, holdoutFidelity: .9 },
            violations: [{ RULE_ID: "R1", CASE_ID: "AAA", ROW_DATA_JSON: { VALUE: 11, CASE_ID: "original-id", KIND: "<script>" } }] } };
    page.nodes = [{ FLOW_NODE_RUN_ID: 2, RESULT_KIND: "TABLE", RESULT_OBJECT_NAME: "INIT$_TB_RULEVIOL_XAI", RESULT_OWNER: "OWNER", TARGET_OWNER: "OWNER", TARGET_TABLE: "SOURCE" }];
    page.activateNodeResultObject = async (node) => {
        page.selectedNode = node;
        page.renderMixedXaiViolationResult(page.currentModelDetail.mixedXai);
        return true;
    };
    page.prependNodeResultSwitcher = () => {};
    page.snapshotNodeResultCache = () => {};
    return { page, common, panel, sandbox, summary };
}

test("XAI reuses the readable dashboard and detail grid with honest metrics in both languages", () => {
    for (const language of ["ko", "en"]) {
        const { page, panel } = setup(language);
        page.renderModelAnalysis(page.currentModelDetail);
        assert.match(panel.innerHTML, /anly-work-readable-condition-dist/);
        assert.match(panel.innerHTML, /anly-work-rule-facet-panel/);
        assert.match(panel.innerHTML, /anly-work-readable-rule-card/);
        assert.match(panel.innerHTML, language === "ko" ? /모델 일치율/ : /Model agreement/);
        assert.doesNotMatch(panel.innerHTML, /<script>/);
        assert.doesNotMatch(panel.innerHTML, /DM\$VI|RULE_PURITY|SUMMARY_JSON/);
        assert.match(panel.innerHTML, language === "ko" ? /규칙 요약/ : /Readable Rules/);
        const output = page.buildRuleSummaryExport(page.selectedNode, page.currentModelDetail.ruleSummary);
        assert.equal(output.rows[0].RULE_CONFIDENCE, null);
        assert.equal(output.rows[0].MODEL_AGREEMENT, .8);
    }
});

test("XAI filters and pagination reuse summary controls without querying an Oracle model", async () => {
    const { page } = setup();
    page.ruleSummaryFilters = { ...page.ruleSummaryFilters, conditionCount: "2", conditionColumn: "val", pageSize: 5 };
    await page.loadModelRuleSummary(2);
    assert.equal(page.currentModelDetail.ruleSummary.total, 12);
    assert.equal(page.currentModelDetail.ruleSummary.rules.length, 5);
    assert.equal(page.ruleSummaryFilters.page, 2);
    page.ruleSummaryFilters.conditionColumn = "missing";
    await page.loadModelRuleSummary(9);
    assert.equal(page.currentModelDetail.ruleSummary.total, 0);
    assert.equal(page.ruleSummaryFilters.page, 1);
});

test("candidate details flatten values safely and preserve source/result identifiers", async () => {
    const { page, common, panel } = setup();
    await page.openViolationForRule("R1");
    assert.equal(page.selectedNode.RESULT_OBJECT_NAME, "INIT$_TB_RULEVIOL_XAI");
    assert.match(panel.innerHTML, /anly-work-violation-summary/);
    assert.match(panel.innerHTML, /SOURCE.VALUE/);
    assert.match(panel.innerHTML, /original-id/);
    assert.doesNotMatch(panel.innerHTML, /ROW_DATA_JSON|<script>/);
    assert.equal(common.candidateRows(page.currentModelDetail.mixedXai, "R1")[0].CASE_ID, "AAA");
    assert.equal(common.candidateRows(page.currentModelDetail.mixedXai, "missing").length, 0);
});

test("all XAI table artifacts load the scoped common analysis API", async () => {
    for (const object of ["INIT$_TB_RULEDISC_XAI", "INIT$_TB_XAI_RUN", "INIT$_TB_RULEVIOL_XAI"]) {
        const { page, sandbox, panel } = setup();
        const payload = page.currentModelDetail.mixedXai;
        page.selectedNode.RESULT_OBJECT_NAME = object;
        const calls = [];
        sandbox.CommonUtils = { request: async (url) => { calls.push(url); return { data: payload }; } };
        page.showResultLoading = () => {};
        await page.loadResultTable();
        assert.equal(calls.length, 1);
        const url = new URL(calls[0], "http://test");
        assert.equal(url.pathname, "/api/mlAnalysis/mixed-xai-results");
        assert.equal(url.searchParams.get("targetTable"), "SOURCE");
        assert.equal(url.searchParams.get("flowRunId"), "41");
        assert.match(panel.innerHTML, object === "INIT$_TB_RULEVIOL_XAI" ? /anly-work-violation-summary/ : /anly-work-readable-rule-card/);
    }
});

test("zero-rule XAI results are valid and do not request model recreation", () => {
    const { page, panel } = setup();
    page.currentModelDetail.ruleSummary = { overview: { TOTAL_RULES: 0 }, rules: [], total: 0 };
    page.renderModelAnalysis(page.currentModelDetail);
    assert.doesNotMatch(panel.innerHTML, /create the summary table|모델 작업을 다시/);
});

function patternSetup(language = "ko") {
    const fixture = setup(language);
    const { page, common } = fixture;
    const rule = { RULE_ID: "PATTERN_1", RULE_KIND: "MIXED_PATTERN_TREE", RULE_SOURCE: "MIXED_PATTERN_TREE", MODEL_TYPE: "MIXED_PATTERN_TREE", MODEL_NAME: "XAI_PATTERN_41",
        CONDITION_TEXT: "VALUE > 10", CONDITION_COLUMNS: ["VALUE"], CONDITION_COUNT: 1,
        CONDITION_AST: { column: "VALUE", operator: ">", value: 10 }, RESULT_AST: { column: "CODE", operator: "=", value: 0 },
        RESULT_COLUMN: "CODE", RESULT_VALUE: 0, RESULT_TEXT: "CODE = 0", RESULT_KIND: "VALUE", RESULT_HAS_VALUE_YN: "Y",
        RULE_CONFIDENCE: .99, RULE_LIFT: 1.98, RULE_SUPPORT: .495, CONDITION_TOTAL_COUNT: 1000, SUPPORT_COUNT: 990,
        TRAIN_CONFIDENCE: .995, VALIDATION_CONFIDENCE: .99, VALIDATION_COUNT: 200, VALIDATION_SUPPORT_COUNT: 198,
        VIOLATION_COUNT: 10, MATCH_COUNT: 10, VALIDATION_STATUS: "VALIDATED" };
    const summary = { overview: { TOTAL_RULES: 1, MAPPED_RULES: 1, NON_PERFECT_CONF_RULES: 1, RULE_SOURCE: "MIXED_PATTERN_TREE" }, rules: [rule],
        conditionDist: [{ CONDITION_COUNT: 1, RULE_COUNT: 1, NON_PERFECT_CONF_RULES: 1 }], resultTop: [{ RESULT_COLUMN: "CODE", RULE_COUNT: 1 }],
        columnComments: { CODE: "결과 코드" }, resultTopTotal: 1, total: 1, page: 1, pageSize: 20 };
    const payload = { ruleSummary: summary, summary: { algorithm: "MIXED_PATTERN_TREE", algorithmVersion: 2, ruleCount: 1, trainCount: 3000, validationCount: 1000, metricsCohort: "FULL_TARGET", violationCount: 10 },
        violations: [{ RULE_ID: "PATTERN_1", CASE_ID: "15", CASE_ROWID: "AA123", RESULT_COLUMN: "CODE", EXPECTED_VALUE: "0", ACTUAL_VALUE: null, RULE_CONFIDENCE: .99, RULE_LIFT: 1.98, VIOLATION_REASON: "PATTERN_RESULT_MISSING" }] };
    page.currentModelDetail = { mixedXai: payload, ruleSummary: common.filterSummary(summary) };
    page.selectedNode = { RESULT_KIND: "TABLE", RESULT_OBJECT_NAME: "INIT$_TB_RULEDISC_ASSOC_SUM", RESULT_OWNER: "OWNER", TARGET_OWNER: "OWNER", TARGET_TABLE: "SOURCE", EXEC_METHOD: "MIXED_XAI_RULE_DISCOVER" };
    page.nodes = [{ ...page.selectedNode, RESULT_OBJECT_NAME: "INIT$_TB_RULEVIOL_ASSOC", EXEC_METHOD: "MIXED_XAI_RULE_DETECT" }];
    return { ...fixture, rule, payload };
}

test("actual-pattern results reuse expected-value cards and rule review without synthetic labels", async () => {
    for (const language of ["ko", "en"]) {
        const { page, panel, common, rule } = patternSetup(language);
        assert.equal(common.isPattern(rule), true);
        assert.equal(common.isXai(rule), false);
        page.renderModelAnalysis(page.currentModelDetail);
        assert.match(panel.innerHTML, /CODE.*= 0/);
        assert.match(panel.innerHTML, /99.0%/);
        assert.match(panel.innerHTML, /1.980/);
        assert.match(panel.innerHTML, language === "ko" ? /검증 신뢰도/ : /Validation confidence/);
        assert.match(panel.innerHTML, /openEditingRuleDecision\('M05001'\)/);
        assert.doesNotMatch(panel.innerHTML, /ANOMALY_CANDIDATE|모델 일치율|Model agreement/);
        await page.openViolationForRule("PATTERN_1", 1);
        assert.equal(page.selectedNode.RESULT_OBJECT_NAME, "INIT$_TB_RULEVIOL_ASSOC");
        assert.match(panel.innerHTML, language === "ko" ? /NULL\(결측\)/ : /NULL \(missing\)/);
        assert.doesNotMatch(panel.innerHTML, /PATTERN_RESULT_MISSING/);
        assert.match(panel.innerHTML, /openViolationSqlPopup\('rule', 'PATTERN_1'\)/);
    }
});

test("pattern saved/live queries select actual violations with model scope and NULL-safe THEN", async () => {
    const { page, common } = patternSetup();
    await page.openViolationForRule("PATTERN_1");
    const saved = page.createViolationSql("rule", "PATTERN_1");
    assert.match(saved, /INIT\$_TB_RULEVIOL_ASSOC/);
    assert.match(saved, /V.RUN_ID = 41/);
    assert.match(saved, /V.MODEL_NAME = 'XAI_PATTERN_41'/);
    assert.match(saved, /ROWIDTOCHAR\(T.ROWID\) = V.CASE_ROWID/);
    const live = page.createRealtimeViolationSqlLookup("rule", "PATTERN_1");
    assert.match(live, /T\."VALUE" > 10/);
    assert.match(live, /CASE WHEN \(T\."CODE" = 0\) THEN 0 ELSE 1 END = 1/);
    assert.doesNotMatch(live, /ANOMALY_CANDIDATE|RULE_PURITY/);
    page.currentModelDetail.mixedXai.summary.caseIdColumn = "FILE_ROW_NO";
    assert.match(page.createRealtimeViolationSqlLookup("rule", "PATTERN_1"), /COALESCE\(TO_CHAR\(T\."FILE_ROW_NO"\), ROWIDTOCHAR\(T.ROWID\)\)/);
    page.currentModelDetail.mixedXai.summary.caseIdColumn = "INJECT; DELETE";
    assert.doesNotMatch(page.createRealtimeViolationSqlLookup("rule", "PATTERN_1"), /INJECT/);
    assert.equal(common.predicateSql({column: "AMOUNT", operator: ">=", value: "9007199254740993", valueType: "NUMBER"}), 'T."AMOUNT" >= 9007199254740993');
    assert.throws(() => common.predicateSql({column: "AMOUNT", operator: ">=", value: "0 OR 1=1", valueType: "NUMBER"}));
    assert.equal(common.actualValue(null), "NULL(결측)");
    assert.equal(common.actualValue("-"), "-");
    assert.equal(common.actualValue(0), "0");
});

test("pattern common tables are intercepted by mixed execution method and retain actual result export", async () => {
    const { page, sandbox, payload } = patternSetup();
    const calls = [];
    sandbox.CommonUtils = { request: async (url) => { calls.push(url); return { data: payload }; } };
    page.showResultLoading = () => {};
    for (const name of ["INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEVIOL_ASSOC"]) {
        page.selectedNode.RESULT_OBJECT_NAME = name;
        await page.loadResultTable();
        assert.match(calls.at(-1), /mlAnalysis\/mixed-xai-results/);
    }
    const exported = page.buildRuleSummaryExport(page.selectedNode, payload.ruleSummary);
    assert.equal(exported.rows[0].RESULT_TEXT, "CODE = 0");
    assert.ok(exported.columns.includes("VALIDATION_CONFIDENCE"));
});

test("pattern diagnostics expose limits and unique counts only for the matching full scope", () => {
    const { common, payload } = patternSetup();
    Object.assign(payload.summary, { uniqueViolationCount: 8, warnings: ["TARGET_COLUMN_LIMIT", "RULE_LIMIT"], fittedTargets: ["CODE"],
        encoding: { excludedColumns: [{column: "EXTRA", reason: "COLUMN_LIMIT"}] } });
    assert.equal(common.violationSummary(payload, { confidenceScope: "ALL", conditionCount: "ALL" }).overview.VIOLATED_ROW_COUNT, 8);
    assert.equal(common.violationSummary(payload, { ruleId: "PATTERN_1" }).overview.VIOLATED_ROW_COUNT, null);
    assert.equal(common.violationSummary(payload, { confidenceScope: "NON_PERFECT" }).overview.VIOLATED_ROW_COUNT, null);
    assert.match(common.notes(payload.summary), /결과 컬럼 수 제한/);
    assert.match(common.notes(payload.summary), /입력 컬럼 수 제한으로 제외된 컬럼: EXTRA/);
    assert.doesNotMatch(common.notes(payload.summary), /TARGET_COLUMN_LIMIT|COLUMN_LIMIT|RULE_LIMIT/);
});

test("formula rules show prediction coverage and validation errors and generate safe live arithmetic", async () => {
    for (const language of ["ko", "en"]) {
        const { page, common, rule, panel, payload } = patternSetup(language);
        Object.assign(rule, { RESULT_KIND: "FORMULA", RESULT_VALUE: "(VALUE * 2) + 3", RESULT_TEXT: "CODE ≈ VALUE * 2 + 3",
            RULE_LIFT: null, VALIDATION_R2: -.25, VALIDATION_MAE: 1.25, VALIDATION_RMSE: 2.5, ABSOLUTE_TOLERANCE: 2, RELATIVE_TOLERANCE: .01,
            RESULT_AST: {operator: "WITHIN_TOLERANCE", column: "CODE", expression: {operator: "ADD", left: {operator: "MULTIPLY", left: {column: "VALUE"}, right: {value: 2}}, right: {value: 3}}, absoluteTolerance: 2, relativeTolerance: .01} });
        Object.assign(payload.violations[0], { EXPECTED_VALUE: "23", ACTUAL_VALUE: "30", RESIDUAL: 7, ABS_ERROR: 7, EXPECTED_LOWER: 21, EXPECTED_UPPER: 25, VIOLATION_REASON: "PATTERN_FORMULA_MISMATCH" });
        page.mixedRuleFamily = "FORMULA";
        page.renderModelAnalysis(page.currentModelDetail);
        assert.match(panel.innerHTML, language === "ko" ? /검증 R²/ : /Validation R²/);
        assert.match(panel.innerHTML, language === "ko" ? /허용 오차 충족률/ : /Within-tolerance rate/);
        assert.match(panel.innerHTML, /-0.25/);
        assert.match(panel.innerHTML, /VALUE \* 2 \+ 3/);
        assert.ok(common.metrics(rule).every((metric) => metric.key !== "Lift"));
        await page.openViolationForRule(rule.RULE_ID);
        assert.match(panel.innerHTML, language === "ko" ? /수식 예측값의 허용 오차/ : /outside the formula prediction tolerance/);
        const live = page.createRealtimeViolationSqlLookup("rule", rule.RULE_ID);
        assert.match(live, /TO_CHAR\(\(\(T\."VALUE" \* 2\) \+ 3\)\) AS V_EXPECTED_VALUE/);
        assert.match(live, /GREATEST\(2, 0.01 \* ABS\(/);
        assert.match(live, /CASE WHEN/);
        assert.match(common.expressionSql({operator: "DIVIDE", left: {column: "CODE"}, right: {column: "VALUE"}}), /NULLIF\(T\."VALUE", 0\)/);
        assert.throws(() => common.expressionSql({operator: "EXECUTE", left: {value: 1}, right: {value: 2}}));
        assert.throws(() => common.expressionSql({column: "X;DELETE"}));
        assert.throws(() => common.predicateSql({...rule.RESULT_AST, absoluteTolerance: -1}));
    }
});

test("mixed first stages display stored statistics and relationships without inventing historical nodes", async () => {
    for (const language of ["ko", "en"]) {
        const { page, common, sandbox, panel, payload } = patternSetup(language);
        payload.summary.profile = { sampleCount: 500, columnCount: 2, numericColumnCount: 2, textColumnCount: 0, skippedColumnCount: 0, duplicateRowCount: 2,
            columns: [{ COLUMN_NAME: "VALUE", DATA_TYPE: "NUMBER", ROW_COUNT: 500, NULL_COUNT: 3, NULL_RATE: .006, DISTINCT_COUNT: 300, MEAN: 20, STDDEV: 2, TOP_VALUES: [{ value: "<script>", count: 4 }] }] };
        payload.summary.relationships = { sampleCount: 500, numericColumnCount: 2, pairCount: 1,
            correlationPairs: [{ COLUMN_X: "VALUE", COLUMN_Y: "CODE", PAIR_COUNT: 497, COVERAGE: .994, CORRELATION: .999 }], duplicateColumns: [], missingColumns: [{COLUMN_NAME: "VALUE", NULL_COUNT: 3, NULL_RATE: .006}] };
        sandbox.CommonUtils = { request: async () => ({data: payload}) };
        page.showResultLoading = () => {};
        for (const kind of ["PROFILE", "RELATION"]) {
            page.selectedNode.EXEC_METHOD = `MIXED_XAI_${kind}`;
            page.selectedNode.RESULT_OBJECT_NAME = "INIT$_TB_XAI_RUN";
            await page.loadResultTable();
            assert.match(panel.innerHTML, /500/);
            assert.doesNotMatch(panel.innerHTML, /<script>|ANOMALY_CANDIDATE/);
            assert.match(panel.innerHTML, kind === "PROFILE" ? /300/ : /0.999/);
        }
        const old = common.stageSummary({}, "PROFILE");
        assert.equal(old.available, false);
        assert.equal(old.sections.length, 0);
        assert.match(old.notes, language === "ko" ? /기존 2단계 이력/ : /two-stage history/);
    }
});

test("mixed families keep value, range and formula counts, means and saved violations separate", async () => {
    const {page, common, payload, rule} = patternSetup();
    payload.ruleSummary.rules.push({...rule, RULE_ID: "RANGE_2", RESULT_KIND: "RANGE", RULE_CONFIDENCE: .97, RULE_LIFT: 1.02},
        {...rule, RULE_ID: "FORMULA_3", RESULT_KIND: "FORMULA", RULE_CONFIDENCE: .95, RULE_LIFT: null});
    const value = common.patternSummary(payload.ruleSummary, "VALUE");
    const formulas = common.continuousSummary(payload);
    assert.equal(value.total, 2);
    assert.equal(value.overview.AVG_CONFIDENCE, .98);
    assert.equal(value.overview.AVG_LIFT, 1.5);
    assert.equal(formulas.overview.RULE_COUNT, 1);
    assert.equal(formulas.overview.AVG_LIFT, null);
    assert.equal(formulas.topRules[0].TARGET_COLUMN, "CODE");
    assert.equal(common.patternSummary({...payload.ruleSummary, rules: []}).overview.AVG_CONFIDENCE, null);
    page.selectedNode = page.nodes[0];
    page.mixedRuleFamily = "FORMULA";
    page.renderMixedXaiViolationResult(payload);
    assert.equal(page.lastViolationSummary.topRules.length, 1);
    assert.equal(page.lastViolationSummary.topRules[0].RULE_ID, "FORMULA_3");
    const sql = page.createMixedXaiViolationSql("all", "");
    assert.match(sql, /IN \('FORMULA_3'\)/);
    assert.doesNotMatch(sql, /RANGE_2|PATTERN_1/);
});

test("mixed formula cards reuse symbolic actions and identify actual expression inputs in both stages", async () => {
    for (const language of ["ko", "en"]) {
        const {page, rule, panel, payload} = patternSetup(language);
        const expression = {operator: "ADD", left: {column: "VALUE"}, right: {column: "EXTRA"}};
        Object.assign(rule, {RESULT_KIND: "FORMULA", RESULT_TEXT: "CODE ≈ VALUE + EXTRA", RULE_LIFT: null,
            CONDITION_TEXT: "GROUP = '<script>' AND VALUE IS NOT NULL", CONDITION_COLUMNS: ["GROUP", "VALUE"],
            RESULT_AST: JSON.stringify({operator: "WITHIN_TOLERANCE", column: "CODE", expression, absoluteTolerance: 2, relativeTolerance: 0})});
        page.mixedRuleFamily = "FORMULA";
        assert.deepEqual(Array.from(page.getMixedFormulaFeatureColumns(rule)), ["VALUE", "EXTRA"]);
        page.renderModelAnalysis(page.currentModelDetail);
        assert.match(panel.innerHTML, /anly-work-rule-family-switcher[\s\S]*fa-wave-square/);
        assert.match(panel.innerHTML, /anly-work-symbolic-rule-card/);
        assert.match(panel.innerHTML, /anly-work-symbolic-y-panel[\s\S]*anly-work-symbolic-formula-row[\s\S]*anly-work-symbolic-x-panel/);
        assert.match(panel.innerHTML, /copySymbolicFormula\('CODE ≈ VALUE \+ EXTRA', event\)/);
        assert.match(panel.innerHTML, /openMixedFormulaPopup\('PATTERN_1'\)/);
        assert.doesNotMatch(panel.innerHTML, /<script>/);
        page.selectedNode = page.nodes[0];
        page.renderMixedXaiViolationResult(payload);
        assert.match(panel.innerHTML, language === "ko" ? /값·구간 규칙 위반/ : /Value and range violations/);
        assert.match(panel.innerHTML, /anly-work-violation-rule-actions[\s\S]*fa-chart-line/);
        assert.match(panel.innerHTML, /anly-work-violation-formula-row/);
        assert.match(panel.innerHTML, /anly-work-symbolic-violation-summary/);
        assert.match(panel.innerHTML, /anly-work-rule-facet-panel is-symbolic/);
        assert.match(panel.innerHTML, /openViolationSqlPopup\('rule', 'PATTERN_1'\)/);
        assert.doesNotMatch(panel.innerHTML, /selectViolationResultScope\('MAX_RULES'\)|anly-work-violation-reason-strip/);
        assert.doesNotMatch(panel.innerHTML, /<script>/);
    }
});

test("legacy symbolic points and reference lines consume the shared graph appearance", () => {
    const {page, sandbox} = setup("en");
    vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/js/regression-diagnostics.js"), "utf8"), sandbox);
    const common = sandbox.window.RegressionDiagnostics;
    page.symbolicRuleChartState = {selectedRowIndex: 1};
    for (const isAttention of [false, true]) {
        for (const sampleIndex of [0, 1]) {
            assert.equal(page.getSymbolicDiagnosticPointStyle({raw: {isAttention, sampleIndex}}).fill,
                common.pointStyle(isAttention, sampleIndex === 1).fill);
            assert.equal(page.getSymbolicDiagnosticPointRadius({raw: {isAttention, sampleIndex}}),
                common.pointStyle(isAttention, sampleIndex === 1).radius);
        }
    }
    const built = page.buildSymbolicDiagnosticChartData({evaluatedRows: Array.from({length: 10}, (_, i) => ({actual: i, predicted: i * 2, rowIndex: i})), rule: {TARGET_COLUMN: "Y"}}, false);
    const reference = built.datasets.find((d) => d.label === "y = x");
    assert.equal(reference.borderColor, common.chartStyle.reference.stroke);
    assert.deepEqual(Array.from(reference.borderDash), Array.from(common.chartStyle.reference.dash));
});

test("formula methods preserve backend canonical text and separate method counts without rounding old expressions", () => {
    const {common} = patternSetup("en");
    const texts = ["Y ≈ X + Z (±2)", "Y ≈ 11.999999999 * X - 3.9e-7 (±0.000001)", "Y ≈ X / Z (±0.1)"];
    const rules = ["SUM_DIFFERENCE", "ROBUST_LINEAR", "ROBUST_RATIO"].map((method, i) => ({RULE_ID: String(i), RESULT_KIND: "FORMULA", RESULT_COLUMN: "Y",
        RESULT_TEXT: texts[i], FORMULA_EXPRESSION: {column: "X"}, FORMULA_METHOD: method, COEFFICIENT_POLICY: i ? "FITTED" : "CANONICAL_SIMPLE"}));
    const summary = common.continuousSummary({ruleSummary: {rules}});
    assert.deepEqual(Array.from(summary.topRules, (r) => r.EXPRESSION), texts);
    assert.deepEqual(Array.from(summary.methodGroups, (r) => r.METHOD), ["SUM_DIFFERENCE", "ROBUST_LINEAR", "ROBUST_RATIO"]);
    assert.deepEqual(Array.from(summary.topRules, (r) => common.formulaMethod(r)), ["Sum/difference relation", "Linear regression", "Ratio relation"]);
    assert.ok(common.metrics(rules[0]).some((m) => m.value === "Validated simple coefficients"));
    assert.equal(common.formulaMethod({}), "Mixed numeric formula");
    assert.ok(!common.metrics({RESULT_KIND: "FORMULA"}).some((m) => m.key === "Coefficient policy"));
});

test("Quick and M04002 show complete canonical sum/difference formulas before conditions without clipped cards or detail cells", async () => {
    const {chromium} = require("playwright");
    const formula = "TOTAL_ANNUAL_HOUSEHOLD_EXPENDITURE ≈ BASE_HOUSEHOLD_EXPENDITURE + ADDITIONAL_HOUSEHOLD_EXPENDITURE - REFUNDED_HOUSEHOLD_EXPENDITURE (±2)";
    const browser = await chromium.launch({headless: true});
    try {
        for (const language of ["ko", "en"]) {
            const {rule, sandbox} = patternSetup(language);
            Object.assign(rule, {RESULT_KIND: "FORMULA", RESULT_TEXT: formula, RESULT_COLUMN: "TOTAL_ANNUAL_HOUSEHOLD_EXPENDITURE",
                FORMULA_METHOD: "SUM_DIFFERENCE", COEFFICIENT_POLICY: "CANONICAL_SIMPLE", ABSOLUTE_TOLERANCE: 2,
                RELATIVE_TOLERANCE: 0, VALIDATION_R2: .998, VALIDATION_MAE: .23, VALIDATION_RMSE: .45,
                CONDITION_TEXT: "BASE_HOUSEHOLD_EXPENDITURE IS NOT NULL AND ADDITIONAL_HOUSEHOLD_EXPENDITURE IS NOT NULL AND REFUNDED_HOUSEHOLD_EXPENDITURE IS NOT NULL"});
            const tab = await browser.newPage({viewport: {width: 1100, height: 1200}});
            const errors = [];
            tab.on("pageerror", (error) => errors.push(error.message));
            await tab.route("**/*", (route) => route.abort());
            await tab.setContent('<main style="padding:24px"><section id="quick" style="max-width:520px"></section><div class="page-container table-page anly-work-page" id="container-M04002"><main class="anly-work-detail-panel"><section id="resultPanel-M04002" class="anly-work-result-panel"></section></main></div></main>');
            for (const file of ["frontend/css/styletail.css", "frontend/css/style.css", "frontend/css/styleMenu.css", "frontend/css/pages/MCOM_ANLY_WORK.css", "frontend/css/grid-custom.css", "quick-edit/css/quick-edit.css"]) await tab.addStyleTag({path: path.join(root, file)});
            await tab.evaluate(() => { window.PageManager = {createHelper: () => ({getContainerEl: (s) => document.querySelector(s)})}; window.API_BASE_URL = "/api"; });
            for (const file of ["frontend/js/rule-result-common.js", "quick-edit/js/renderers.js", "frontend/js/MCOM_ANLY_WORK.js"]) await tab.addScriptTag({path: path.join(root, file)});
            await tab.evaluate(({rule, language, pack}) => {
                window.I18nManager = {getSessionLanguage: () => language};
                window.M04002_PAGE_I18N = pack;
                document.querySelector("#quick").innerHTML = window.QuickEditRenderers.renderContinuousRules([rule]);
                const p = window.MCOMMON.createAnlyWorkPage({pageCode: "M04002"});
                p.currentModelDetail = {mixedXai: {summary: {algorithm: "MIXED_PATTERN_TREE", metricsCohort: "FULL_TARGET"}}};
                const card = p.buildSummaryRuleCards([rule], {})[0];
                document.querySelector("#resultPanel-M04002").innerHTML = '<div class="anly-work-readable-rule-grid">' + p.renderReadableRuleCard(card) + '</div>' + p.renderGrid(["RULE_ID", "RESULT_TEXT"], [rule]);
            }, {rule, language, pack: sandbox.window.M04002_PAGE_I18N});
            for (const selector of [".qe-rule-body", ".anly-work-symbolic-formula-row"]) {
                const body = tab.locator(selector);
                assert.equal(await body.locator("b").first().textContent(), "THEN");
                assert.match(await body.textContent(), /REFUNDED_HOUSEHOLD_EXPENDITURE \(±2\)/);
                const expression = body.locator(selector.startsWith(".qe") ? "span" : "code").first();
                assert.equal((await expression.textContent()).replace(/^THEN\s+/, ""), formula);
                assert.ok(await expression.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
                assert.ok(await expression.evaluate((el) => el.clientHeight > parseFloat(getComputedStyle(el).lineHeight)));
            }
            const cell = tab.locator("td.is-rule-expression");
            assert.equal(await cell.textContent(), formula);
            assert.equal(await cell.evaluate((el) => getComputedStyle(el).whiteSpace), "pre-wrap");
            assert.ok(await cell.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
            assert.match(await tab.locator("#quick").textContent(), language === "ko" ? /합·차 관계/ : /Sum\/difference relation/);
            assert.match(await tab.locator("#resultPanel-M04002").textContent(), language === "ko" ? /검증된 단순 계수/ : /Validated simple coefficients/);
            fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
            await tab.screenshot({path: path.join(root, `test-results/mixed-formula-readable-${language}.png`), fullPage: true});
            await tab.setViewportSize({width: 500, height: 1200});
            assert.ok(await tab.locator(".qe-rule-body span").first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
            await tab.locator("#quick").screenshot({path: path.join(root, `test-results/mixed-formula-readable-narrow-${language}.png`)});
            assert.deepEqual(errors, []);
            await tab.close();
        }
    } finally { await browser.close(); }
});

test("continuous zero states distinguish disabled, missing history and recorded eligibility or validation failures", () => {
    const {common} = patternSetup("en");
    assert.match(common.continuousDiagnostic({}).message, /historical execution/);
    assert.match(common.continuousDiagnostic({summary:{continuous:{enabled:false}}}).message, /disabled/);
    const payload = {summary:{continuous:{diagnosticVersion:1, enabled:true, eligibleTargetCount:0, physicalNumericColumnCount:0,
        inferredNumericTextColumnCount:1, eligibilityReasons:{LEADING_ZERO_CODE:2}}}};
    assert.match(common.continuousDiagnostic(payload).message, /No eligible continuous/);
    assert.equal(common.continuousDiagnostic(payload).reasons[0].label, "Leading-zero code");
    payload.summary.continuous.eligibleTargetCount = 3;
    payload.summary.continuous.rejectionReasons = {VALIDATION_COVERAGE_BELOW_MINIMUM:4};
    assert.match(common.continuousDiagnostic(payload).message, /No continuous formulas passed/);
    assert.ok(common.continuousDiagnostic(payload).reasons.some((r) => r.label === "Validation coverage below minimum" && r.count === "4"));
});

test("numeric-text live SQL exactly matches the server conversion and keeps invalid actuals NULL-safe", async () => {
    const {execFileSync} = require("node:child_process");
    const {common, page, payload, rule} = patternSetup();
    const expected = execFileSync(path.join(root, "venv/Scripts/python.exe"), ["-c", 'import runpy; print(runpy.run_path("backend/services/mixed_numeric.py")["numeric_text_sql"](\'T."VALUE"\'))'], {cwd: root, encoding: "utf8"}).trim();
    assert.equal(common.numericTextSql('T."VALUE"'), expected);
    assert.equal(common.expressionSql({column:"VALUE", numericText:true}), expected);
    assert.equal(common.predicateSql({column:"VALUE", operator:"NOT_NULL", numericText:true}), `${expected} IS NOT NULL`);
    Object.assign(rule, {RESULT_KIND:"FORMULA", CONDITION_AST:{column:"VALUE",operator:"NOT_NULL",numericText:true},
        RESULT_AST:{operator:"WITHIN_TOLERANCE",column:"CODE",numericText:true,expression:{column:"VALUE",numericText:true},absoluteTolerance:1,relativeTolerance:0}});
    await page.openViolationForRule(rule.RULE_ID);
    const sql = page.createRealtimeViolationSqlLookup("rule", rule.RULE_ID);
    assert.match(sql, /JSON_VALUE\(/);
    assert.match(sql, /RETURNING NUMBER NULL ON ERROR/);
    assert.match(sql, /AND CASE WHEN[\s\S]*THEN 0 ELSE 1 END = 1/);
    assert.doesNotMatch(sql, /ABS\(T\."CODE" -|TO_NUMBER\(/);
    assert.throws(() => common.numericTextSql('T."X"; DELETE'));
});

test("XAI violation cards, saved SQL and realtime SQL use the existing stage 4 workflow", async () => {
    const { page, common, panel } = setup();
    await page.openViolationForRule("R1");
    assert.match(panel.innerHTML, /openViolationSqlPopup\('rule', 'R1'\)/);
    assert.match(panel.innerHTML, /모델 일치율/);
    const saved = page.createViolationSql("rule", "R1");
    assert.match(saved, /V.RUN_ID = 41/);
    assert.match(saved, /V.TARGET_TABLE = 'SOURCE'/);
    assert.match(saved, /V.RULE_ID IN \('R1'\)/);
    const live = page.createRealtimeViolationSqlLookup("rule", "R1");
    assert.match(live, /CAST\(T\."VALUE" AS BINARY_FLOAT\) > 10/);
    assert.doesNotMatch(live, /RULE_CONFIDENCE|RULE_LIFT/);
    assert.throws(() => common.predicateSql({column: "X; DELETE", operator: "=", value: 1}));
    assert.equal(common.predicateSql({column: "KIND", operator: "=", value: "O'Reilly"}), 'T."KIND" = \'O\'\'Reilly\'');
    const summary = common.violationSummary(page.currentModelDetail.mixedXai, {conditionCount: "2", resultScope: "CANDIDATE", pageSize: 2});
    assert.equal(summary.ruleTotal, 12);
    assert.equal(summary.topRules.length, 2);
    assert.equal(summary.topRules[0].VIOLATION_COUNT, 1);
});

test("translated analysis tabs and candidate links work in a browser", async () => {
    const { chromium } = require("playwright");
    const { page: model, sandbox } = setup();
    const browser = await chromium.launch({ headless: true });
    try {
        const tab = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        const errors = [];
        tab.on("pageerror", (e) => errors.push(e.message));
        await tab.route("**/*", (route) => route.abort());
        await tab.setContent('<main style="padding:24px"><div id="resultPanel-M04002"></div></main>');
        await tab.addStyleTag({ path: path.join(root, "frontend/css/pages/MCOM_ANLY_WORK.css") });
        await tab.evaluate(() => {
            window.PageManager = { createHelper: () => ({ getContainerEl: (s) => document.querySelector(s) }) };
            window.API_BASE_URL = "/api";
        });
        for (const file of ["frontend/js/rule-result-common.js", "frontend/js/MCOM_ANLY_WORK.js"]) {
            await tab.addScriptTag({ path: path.join(root, file) });
        }
        await tab.evaluate(({ detail, node, pack }) => {
            window.M04002_PAGE_I18N = pack;
            const p = window.MCOMMON.createAnlyWorkPage({ pageCode: "M04002" });
            p.selectedNode = node;
            p.selectedRun = { FLOW_RUN_ID: 41 };
            window.sqlRequests = [];
            window.CommonUtils = { request: async (_url, options) => {
                window.sqlRequests.push(options.body.sql);
                return { status: "success", columns: ["V_CASE_ID", "VALUE"], data: [{V_CASE_ID: "AAA", VALUE: 11}], total: 1, page: 1, pageSize: 50 };
            } };
            p.currentModelDetail = detail;
            p.nodes = [{ ...node, RESULT_KIND: "TABLE", RESULT_OBJECT_NAME: "INIT$_TB_RULEVIOL_XAI" }];
            p.activateNodeResultObject = async (selected) => { p.selectedNode = selected; p.renderMixedXaiViolationResult(detail.mixedXai); return true; };
            p.renderModelAnalysis(detail);
        }, { detail: model.currentModelDetail, node: model.selectedNode, pack: sandbox.window.M04002_PAGE_I18N });
        await tab.getByRole("button", { name: "상세 표", exact: true }).click();
        assert.equal(await tab.evaluate(() => window.M04002.getActiveModelAnalysisTab()), "detail");
        await tab.getByRole("button", { name: "규칙 요약", exact: true }).click();
        await tab.locator(".anly-work-rule-open-link").first().click();
        assert.equal(await tab.evaluate(() => window.M04002.violationRuleFilters.ruleId), "R1");
        assert.match(await tab.locator('#resultPanel-M04002').textContent(), /original-id/);
        await tab.locator('button[onclick*="openViolationSqlPopup(\'rule\', \'R1\')"]').click();
        await tab.waitForFunction(() => window.sqlRequests.length === 1);
        assert.match(await tab.evaluate(() => window.sqlRequests[0]), /V.RUN_ID = 41/);
        await tab.locator('button[onclick*="changeViolationSqlMode(\'LIVE\')"]').click();
        await tab.waitForFunction(() => window.sqlRequests.length === 2);
        assert.match(await tab.evaluate(() => window.sqlRequests[1]), /CAST\(T\."VALUE" AS BINARY_FLOAT\)/);
        await tab.evaluate(() => window.M04002.closeViolationSqlPopup());
        await tab.evaluate((node) => { window.M04002.selectedNode = node; window.M04002.renderModelAnalysis(window.M04002.currentModelDetail); }, model.selectedNode);
        await tab.getByRole("button", { name: "규칙 요약", exact: true }).click();
        fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
        await tab.screenshot({ path: path.join(root, "test-results/m04002-xai-common-ko.png"), fullPage: true });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test("M04002 browser selects real profile, relationship and formula nodes in Korean and English", async () => {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({headless: true});
    try {
        for (const language of ["ko", "en"]) {
            const { payload, rule, sandbox } = patternSetup(language);
            payload.summary.profile = {sampleCount: 500, sampling: "FIRST_ROWS", columnCount: 2, numericColumnCount: 2, textColumnCount: 0, skippedColumnCount: 0, duplicateRowCount: 1,
                columns: [{COLUMN_NAME: "VALUE", COLUMN_COMMENT: "Input", DATA_TYPE: "NUMBER", ROW_COUNT: 500, NULL_COUNT: 2, NULL_RATE: .004, DISTINCT_COUNT: 400, MIN: 1, MAX: 200, MEAN: 100, STDDEV: 20, TOP_VALUES: [{value: 10, count: 4}]}]};
            payload.summary.relationships = {sampleCount: 500, numericColumnCount: 2, pairCount: 1, correlationPairs: [{COLUMN_X: "VALUE", COLUMN_Y: "CODE", PAIR_COUNT: 498, COVERAGE: .996, CORRELATION: .985}], duplicateColumns: [], missingColumns: []};
            Object.assign(rule, {RESULT_KIND: "FORMULA", RESULT_TEXT: "CODE ≈ VALUE * 2 + 3 (±2)", RULE_CONFIDENCE: .95, RULE_LIFT: null,
                VALIDATION_R2: .99, VALIDATION_MAE: 1.25, VALIDATION_RMSE: 2, ABSOLUTE_TOLERANCE: 2, RELATIVE_TOLERANCE: 0,
                CONDITION_AST: {column: "VALUE", operator: "NOT_NULL", numericText: true},
                RESULT_AST: {operator: "WITHIN_TOLERANCE", column: "CODE", numericText: true, expression: {operator: "ADD", left: {operator: "MULTIPLY", left: {column: "VALUE", numericText: true}, right: {value: 2}}, right: {value: 3}}, absoluteTolerance: 2, relativeTolerance: 0}});
            payload.ruleSummary.rules.push({...rule, RULE_ID: "VALUE_RULE", RESULT_KIND: "VALUE", RESULT_AST: {column: "CODE", operator: "=", value: 0}, RESULT_TEXT: "CODE = 0", RULE_CONFIDENCE: .99, RULE_LIFT: 1.98});
            payload.summary.continuous = {diagnosticVersion: 1, enabled: true, status: "RULES_AVAILABLE", eligibleTargetCount: 2, targetCount: 2,
                physicalNumericColumnCount: 0, inferredNumericTextColumnCount: 2, testedCandidateCount: 4, fitRows: 2250, calibrationRows: 750, validationRows: 1000};
            const tab = await browser.newPage({viewport: {width: 1500, height: 1300}});
            const errors = [];
            tab.on("pageerror", (error) => errors.push(error.message));
            await tab.route("**/*", (route) => route.abort());
            await tab.setContent('<div style="padding:24px"><div class="page-container table-page anly-work-page" id="container-M04002"><main class="anly-work-detail-panel"><section><div id="nodeList-M04002" class="anly-work-node-grid"></div></section><section id="resultPanel-M04002" class="anly-work-result-panel"></section></main></div></div>');
            for (const file of ["frontend/css/styletail.css", "frontend/css/style.css", "frontend/css/styleMenu.css", "frontend/css/pages/MCOM_ANLY_WORK.css", "frontend/css/grid-custom.css"]) await tab.addStyleTag({path: path.join(root, file)});
            await tab.evaluate(() => {
                window.PageManager = {createHelper: () => ({getContainerEl: (s) => document.querySelector(s)})};
                window.API_BASE_URL = "/api";
            });
            for (const file of ["frontend/js/rule-result-common.js", "frontend/js/MCOM_ANLY_WORK.js"]) await tab.addScriptTag({path: path.join(root, file)});
            await tab.evaluate(({payload, pack, language}) => {
                window.M04002_PAGE_I18N = pack;
                window.I18nManager = {getSessionLanguage: () => language};
                window.CommonUtils = {request: async (url) => { if (!url.includes("mixed-xai-results")) throw Error("Unexpected API " + url); return {data: payload}; }};
                const p = window.MCOMMON.createAnlyWorkPage({pageCode: "M04002"});
                p.selectedRun = {FLOW_RUN_ID: 41};
                p.nodes = ["PROFILE", "RELATION", "RULE_DISCOVER", "RULE_DETECT"].map((method, i) => ({FLOW_NODE_RUN_ID: i + 1, NODE_NAME: method, REF_MENU_CODE: `M0300${i + 1}`, STATUS: "SUCCESS", EXEC_METHOD: `MIXED_XAI_${method}`,
                    RESULT_KIND: "TABLE", RESULT_OBJECT_NAME: i < 2 ? "INIT$_TB_XAI_RUN" : i === 2 ? "INIT$_TB_RULEDISC_ASSOC_SUM" : "INIT$_TB_RULEVIOL_ASSOC", RESULT_OWNER: "OWNER", TARGET_OWNER: "OWNER", TARGET_TABLE: "SOURCE"}));
                p.applyRememberedNodeResult = () => false;
                p.applyDefaultNodeResult = () => {};
                p.snapshotNodeResultCache = () => {};
                p.restoreNodeResultCache = () => false;
                p.renderNodes();
            }, {payload, pack: sandbox.window.M04002_PAGE_I18N, language});
            for (const index of [0, 1, 2]) {
                await tab.locator(".anly-work-node-card").nth(index).click();
                await tab.waitForFunction((index) => window.M04002.currentModelDetail && window.M04002.selectedNode.FLOW_NODE_RUN_ID === index + 1, index);
                if (index === 2) {
                    assert.match(await tab.locator(".anly-work-readable-rule-card").textContent(), /CODE[\s\S]*= 0/);
                    await tab.locator("[data-mixed-rule-family] button").nth(1).click();
                    assert.equal(await tab.locator(".anly-work-symbolic-rule-card").count(), 1);
                }
                const text = await tab.locator("#resultPanel-M04002").textContent();
                assert.match(text, index === 0 ? /400/ : index === 1 ? /0.985/ : /CODE ≈ VALUE \* 2 \+ 3/);
                if (index === 2) assert.match(text, language === "ko" ? /허용 오차 충족률/ : /Within-tolerance rate/);
                if (index === 0) {
                    assert.ok(await tab.locator(".anly-work-grid th").first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft) >= 6));
                    assert.ok(await tab.locator(".anly-work-grid-wrap").first().evaluate((el) => el.scrollWidth > el.clientWidth));
                }
                if (index === 2) {
                    assert.ok(await tab.locator(".anly-work-symbolic-rule-card footer span").first().evaluate((el) => el.getBoundingClientRect().width >= 109));
                }
                fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
                await tab.screenshot({path: path.join(root, `test-results/m04002-mixed-stage-${index + 1}-${language}.png`), fullPage: true});
            }
            await tab.locator(".anly-work-node-card").nth(3).click();
            await tab.waitForFunction(() => window.M04002.selectedNode.FLOW_NODE_RUN_ID === 4 && window.M04002.lastViolationSummary);
            const family = tab.locator(".anly-work-rule-family-switcher");
            assert.match(await family.textContent(), language === "ko" ? /연속형 규칙 위반/ : /Continuous violations/);
            assert.equal(await family.locator("button.is-active").count(), 1);
            assert.ok(await family.locator("button.is-active").evaluate((el) => parseFloat(getComputedStyle(el).borderRadius) > 20));
            await tab.evaluate(() => {
                const p = window.M04002;
                p.openMixedFormulaPopup = (ruleId) => { window.clickedFormula = ruleId; };
                p.copySymbolicFormula = (text) => { window.copiedFormula = text; };
                p.openViolationSqlPopup = (kind, ruleId) => { window.clickedViolation = {kind, ruleId}; };
            });
            const violationCard = tab.locator(".anly-work-violation-rule-grid article");
            assert.equal(await violationCard.count(), 1);
            assert.equal(await tab.locator(".anly-work-symbolic-violation-summary").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 247, 237)");
            assert.equal(await violationCard.evaluate((el) => getComputedStyle(el).borderTopColor), "rgb(253, 186, 116)");
            assert.equal(await tab.locator("[onclick*=\"MAX_RULES\"], .anly-work-violation-reason-strip").count(), 0);
            await violationCard.locator("[onclick*='openMixedFormulaPopup']").click();
            assert.equal(await tab.evaluate(() => window.clickedFormula), "PATTERN_1");
            await violationCard.locator("[onclick*='copySymbolicFormula']").click();
            assert.equal(await tab.evaluate(() => window.copiedFormula), "CODE ≈ VALUE * 2 + 3 (±2)");
            await violationCard.locator("[onclick*='openViolationSqlPopup']").click();
            assert.deepEqual(await tab.evaluate(() => window.clickedViolation), {kind: "rule", ruleId: "PATTERN_1"});
            await tab.screenshot({path: path.join(root, `test-results/m04002-mixed-stage-4-${language}.png`), fullPage: true});
            await family.locator("button").first().click();
            assert.equal(await tab.locator(".anly-work-violation-summary").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 241, 242)");
            assert.equal(await tab.locator(".anly-work-node-card").count(), 4);
            assert.deepEqual(errors, []);
            await tab.close();
        }
    } finally { await browser.close(); }
});
