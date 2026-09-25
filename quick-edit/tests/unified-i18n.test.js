const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function analysis(language) {
    const panel = { innerHTML: "", classList: { remove() {} }, querySelector: () => null };
    const window = { sessionStorage: { getItem: () => language },
        M04002_PAGE_I18N: JSON.parse(read(`frontend/i18n/pages/MCOM_ANLY_WORK.${language}.json`)) };
    const sandbox = { window, URLSearchParams, API_BASE_URL: "/api",
        PageManager: { createHelper: () => ({ getContainerEl: () => panel }) } };
    for (const file of ["frontend/js/rule-result-common.js", "frontend/js/MCOM_ANLY_WORK.js"]) vm.runInNewContext(read(file), sandbox);
    const page = window.MCOMMON.createAnlyWorkPage({ pageCode: "M04002" });
    page.prependNodeResultSwitcher = () => {};
    page.snapshotNodeResultCache = () => {};
    return { page, panel, common: window.RuleResultCommon, pack: window.M04002_PAGE_I18N };
}

test("wide-source diagnostics disclose unevaluated columns, targets and bounded probe limits in both views", () => {
    for (const language of ["ko", "en"]) {
        const { common, pack } = analysis(language);
        const summary = { sourceColumnCount: 84, sampleColumnCount: 50, featureLimit: 50, sampleCount: 6000,
            featureLimitExcludedColumns: ["COL051", "COL052"],
            continuous: { enabled: true, diagnosticVersion: 2, eligibleTargetCount: 20, targetCount: 16,
                excludedTargets: ["COL060"], rejectionReasons: { TOLERANCE_TOO_WIDE: 10 } },
            featureScreening: { policy: "BOUNDED_PREFIX_NUMERIC_VARIATION_THEN_SOURCE_ORDER",
                warnings: ["PREFIX_FEATURE_PROBE_MAY_MISS_LATE_OR_RARE_VALUES", "FEATURE_PROBE_SOURCE_NOT_SNAPSHOT_PINNED"] } };
        for (const tr of [common.t, (key) => pack.messages[key] || key]) {
            const diagnostic = common.continuousDiagnostic({ summary, ruleSummary: { rules: [] } }, tr);
            assert.equal(diagnostic.count, 0);
            assert.equal(diagnostic.metrics.find((item) => item.label === tr("Source columns")).value, "84");
            assert.equal(diagnostic.metrics.find((item) => item.label === tr("Sampled source columns")).value, "50");
            assert.ok(diagnostic.message.includes(tr("Some source columns were not evaluated because of the input limit.")));
            assert.ok(diagnostic.message.includes(tr("Some eligible continuous targets were not evaluated because of the target limit.")));
            const notes = common.notes(summary, tr);
            assert.ok(notes.includes(tr("The column probe uses an early source sample and may miss later or rare values.")));
            assert.ok(notes.includes(tr("Column probes do not pin a source snapshot across batches.")));
            if (language === "ko") assert.match(diagnostic.message, /입력 한도/);
        }
    }
});

test("unified profile translates semantic values, numeric warnings and sampling limits through both translation paths", () => {
    for (const language of ["ko", "en"]) {
        const { page, panel, common, pack } = analysis(language);
        const summary = { profile: { sampleCount: 100, sampling: "HASH", sampleByteLimitReached: true,
            samplingWarnings: ["HASH_SAMPLE_BYTE_TRUNCATED_NOT_REPRESENTATIVE", "HASH_SAMPLE_UNDERFILLED", "SOURCE_COUNT_CHANGED_DURING_SAMPLING"],
            columns: [{ COLUMN_NAME: "CONTINUOUS", DATA_TYPE: "VARCHAR2", SEMANTIC_TYPE: "CONTINUOUS", NUMERIC_SOURCE: "NUMERIC_TEXT",
                NUMERIC_WARNINGS: ["NUMERIC_TEXT_INFERRED", "INVALID_NUMERIC_TEXT_EXCLUDED"], TOP_VALUES: [{ value: "CATEGORICAL <raw>", count: 1 }] }] } };
        const original = JSON.stringify(summary);
        for (const tr of [common.t, (key) => pack.messages[key] || key]) {
            const stage = common.stageSummary(summary, "PROFILE", tr);
            const row = stage.sections[0].rows[0];
            assert.equal(row.SEMANTIC_TYPE, language === "ko" ? "연속형" : "Continuous");
            assert.equal(row.COLUMN_NAME, "CONTINUOUS");
            assert.equal(row.DATA_TYPE, "VARCHAR2");
            assert.match(row.TOP_VALUES, /CATEGORICAL <raw>/);
            assert.doesNotMatch(row.NUMERIC_WARNINGS, /INVALID_NUMERIC_TEXT_EXCLUDED/);
            assert.match(row.NUMERIC_WARNINGS, language === "ko" ? /원본 값은 보존/ : /original values are preserved/);
            assert.match(stage.notes, language === "ko" ? /표본 용량 제한/ : /sample byte limit/);
            assert.match(stage.notes, language === "ko" ? /원본 행 수가 달라/ : /source row count changed/);
        }
        page.renderMixedEarlyStage({summary}, "PROFILE");
        assert.match(panel.innerHTML, language === "ko" ? /분석 의미 유형/ : /Semantic type/);
        assert.match(panel.innerHTML, /CATEGORICAL &lt;raw&gt;/);
        assert.doesNotMatch(panel.innerHTML, /INVALID_NUMERIC_TEXT_EXCLUDED|<raw>/);
        assert.equal(JSON.stringify(summary), original);
        const rules = common.notes({ algorithm: "MIXED_PATTERN_TREE", sampling: "HASH", samplingWarnings: ["HASH_SAMPLE_UNDERFILLED"], ruleCount: 1 });
        assert.match(rules, language === "ko" ? /해시 필터/ : /Hash filtering/);
    }
});

test("unified relationship labels are translated by the actual analysis page without translating column identifiers", () => {
    for (const language of ["ko", "en"]) {
        const { page, panel } = analysis(language);
        page.renderMixedEarlyStage({summary: { relationships: { sampleCount: 100,
            categoricalPairs: [{COLUMN_X: "KIND", COLUMN_Y: "REGION", CRAMERS_V: .8}],
            categoricalNumericPairs: [{COLUMN_X: "KIND", COLUMN_Y: "AMOUNT", ETA_SQUARED: .7, GROUP_COUNT: 2}]
        }}}, "RELATION");
        assert.match(panel.innerHTML, language === "ko" ? /범주형·연속형 관계/ : /Categorical and numeric relationships/);
        assert.match(panel.innerHTML, language === "ko" ? /크래머 V/ : /Cramér’s V/);
        assert.match(panel.innerHTML, language === "ko" ? /상관비 제곱/ : /Correlation ratio squared/);
        assert.match(panel.innerHTML, /KIND/);
        assert.match(panel.innerHTML, /AMOUNT/);
    }
});

test("unified result headers translate system labels while preserving user labels, identifiers and raw run messages", () => {
    for (const language of ["ko", "en"]) {
        const { page, panel } = analysis(language);
        page.renderTableResultSummaryShell = page.renderResultTableBody = page.renderSelectedNodeJobDesc = page.renderSelectedNodeExecutionMeta = () => "";
        for (const stage of ["Profile", "Relation", "Discover", "Detect"]) {
            page.selectedNode = {EXEC_OBJECT_TYPE: "WEB_API", EXEC_OBJECT_NAME: `UNIFIED_EDITING_${stage.toUpperCase()}`, EXEC_OBJECT_LABEL: `Unified Editing ${stage}`};
            assert.match(page.getNodeExecutionTitle(), language === "ko" ? /통합 에디팅/ : /Unified Editing/);
            assert.match(page.getNodeExecutionTitle(), /WEB_API · UNIFIED_EDITING_/);
        }
        page.selectedNode.EXEC_OBJECT_LABEL = "My custom 분석 label";
        assert.match(page.getNodeExecutionTitle(), /My custom 분석 label/);
        page.renderResultTable({owner: "OWNER", objectName: "INIT$_TB_RULEVIOL_ASSOC", total: 4,
            filteredByTarget: true, targetOwner: "OWNER", targetTable: "SOURCE", ruleModelName: "INIT_UA_F_42"}, "Result Table", "TABLE");
        assert.match(panel.innerHTML, language === "ko" ? /결과 테이블/ : /Result Table/);
        assert.match(panel.innerHTML, language === "ko" ? /규칙 모델/ : /Rule Model/);
        assert.match(panel.innerHTML, language === "ko" ? /4건/ : /4 rows/);
        assert.match(panel.innerHTML, /OWNER\.SOURCE|INIT_UA_F_42/);
        const run = { MESSAGE: "Flow execution completed. 4 node(s) executed, 0 skipped." };
        const original = run.MESSAGE;
        assert.match(page.getRunDisplayMessage(run), language === "ko" ? /4개 노드 실행, 0개 건너뜀/ : /4 node\(s\) executed, 0 skipped/);
        assert.equal(run.MESSAGE, original);
        const partial = { MESSAGE: "Flow execution completed with failures. 3 node(s) succeeded, 1 failed, 0 skipped. First failed node: custom_node. original error detail" };
        const text = page.getRunDisplayMessage(partial);
        assert.match(text, language === "ko" ? /3개 노드 성공, 1개 실패/ : /3 node\(s\) succeeded, 1 failed/);
        assert.match(text, /custom_node/);
        assert.match(text, /original error detail$/);
        assert.equal(page.getRunDisplayMessage({MESSAGE: "Custom raw message"}), "Custom raw message");
    }
});

test("FLOW template options, accessible labels and selection errors use Korean and English packs", async () => {
    const template = read("frontend/pages/MCOM_FLOW_WORK.html");
    for (const language of ["ko", "en"]) {
        const pack = JSON.parse(read(`frontend/i18n/pages/MCOM_FLOW_WORK.${language}.json`));
        const elements = {};
        const labels = ["flowProcessTemplate", "flowProcessUnified", "flowProcessLegacy", "flowProcessMixed", "prepareProcessTemplate", "prepareProcessTemplateTitle"];
        for (const key of labels) {
            assert.match(template, new RegExp(`data-(?:label|title)-key="${key}"`));
            elements[key] = {textContent: "", attributes: {}, classList: {contains: () => false}, hasAttribute: () => true,
                setAttribute(key, value) { this.attributes[key] = value; }};
        }
        const alerts = [];
        const common = {createPageHelper: () => ({})};
        const window = {MCOMMON: common, M04001_FLOW_UI_LABELS: pack.labels, M04001_PAGE_I18N: pack};
        const sandbox = {window, MCOMMON: common, alert: (text) => alerts.push(text),
            PageManager: {createHelper: () => ({getContainerEl: () => null})},
            document: {getElementById: () => ({querySelectorAll: (selector) => {
                const key = selector.match(/="([^"]+)"/)[1];
                return elements[key] ? [elements[key]] : [];
            }})}};
        vm.runInNewContext(read("frontend/js/MCOM_FLOW_WORK.js"), sandbox);
        const page = common.createFlowWorkPage({pageCode: "M04001"});
        page.removeFlowVersionCountLabel = () => {};
        page.applyUiLabels();
        assert.equal(elements.flowProcessUnified.textContent, pack.labels.flowProcessUnified);
        assert.equal(elements.flowProcessTemplate.attributes["aria-label"], pack.labels.flowProcessTemplate);
        assert.match(elements.flowProcessUnified.textContent, language === "ko" ? /통합 에디팅/ : /Unified editing/);
        page.isFlowRunActive = () => false;
        await page.prepareProcessTemplate();
        assert.equal(alerts.pop(), pack.messages.selectProjectScenarioFirst);
        page.selectedProjectId = page.selectedScenarioId = 1;
        page.getSelectedScenarioTable = () => null;
        page.scenarioTables = [];
        await page.prepareProcessTemplate();
        assert.equal(alerts.pop(), pack.messages.processTemplateSelectTarget);
    }
});
