const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const script = fs.readFileSync(path.join(root, "frontend/js/editing-result-view.js"), "utf8");
const css = fs.readFileSync(path.join(root, "frontend/css/editing-result-view.css"), "utf8");

function view() {
    const window = {sessionStorage: {getItem: () => "en"}};
    vm.runInNewContext(script, {window});
    return window.EditingResultView;
}
function entry(source, ruleId, family = "CONDITION", row = {}) {
    return {source, family, key: `${source}:${ruleId}`, scope: {modelName: source, ruleId, targetColumn: "TOTAL"},
        row: {CONDITION_TEXT: "AGE > 20", RESULT_TEXT: "TOTAL = 0", RESULT_COLUMN: "TOTAL", ...row}};
}
function payload(rules) {
    return {family: "CONDITION", page: 1, pageSize: 20, total: 401, hasMore: true, rules,
        summary: {families: {CONDITION: {ruleCount: 401}, FORMULA: {ruleCount: 30}},
            sourceCounts: [{family: "CONDITION", source: "LEGACY_ASSOC", ruleCount: 200, status: "available"},
                {family: "CONDITION", source: "MIXED_PATTERN", ruleCount: 201, status: "available"}], historicalExplanationCount: 3}};
}

test("two result families retain composite identity and exclude historical explanations from rule cards", () => {
    const renderer = view();
    const data = payload([entry("LEGACY_ASSOC", 1), entry("MIXED_PATTERN", 1)]);
    data.summary.unclassifiedRuleCount = 2;
    const before = JSON.stringify(data);
    const html = renderer.render(data);
    assert.match(html, /data-editing-family="CONDITION"/);
    assert.match(html, /data-editing-family="FORMULA"/);
    assert.doesNotMatch(html, /data-editing-family="MIXED/);
    assert.match(html, /data-editing-rule-key="LEGACY_ASSOC:1"/);
    assert.match(html, /data-editing-rule-key="MIXED_PATTERN:1"/);
    assert.match(html, /Historical anomaly explanations/);
    assert.match(html, /2 stored results have an unrecognized expression type/);
    assert.equal((html.match(/<article /g) || []).length, 2);
    assert.equal(JSON.stringify(data), before);
});

test("formula cards preserve canonical expression, application conditions and small tolerances without treating scores as confidence", () => {
    const renderer = view();
    const symbolic = entry("LEGACY_SYMBOLIC", 7, "FORMULA", {EXPRESSION: "TOTAL = LARGE + SMALL", SCORE: 0.95, SELECTED_YN: "N"});
    const mixed = entry("MIXED_PATTERN", 7, "FORMULA", {RESULT_TEXT: "TOTAL ≈ LARGE + SMALL", FORMULA_EXPRESSION: {column: "WRONG_FALLBACK"},
        CONDITION_TEXT: "KIND = 'A'", RULE_CONFIDENCE: .99, RULE_LIFT: 8, VALIDATION_R2: .97, ABSOLUTE_TOLERANCE: "0.000000001"});
    const first = renderer.renderCard(symbolic, {showOpen: false});
    const second = renderer.renderCard(mixed);
    assert.match(first, /TOTAL = LARGE \+ SMALL/);
    assert.match(first, /Not selected/);
    assert.match(first, /Score/);
    assert.doesNotMatch(first, /Confidence|Tolerance coverage|data-editing-rule-key/);
    assert.match(second, /TOTAL ≈ LARGE \+ SMALL/);
    assert.match(second, /KIND = &#39;A&#39;/);
    assert.match(second, /0\.000000001/);
    assert.match(second, /Tolerance coverage/);
    assert.doesNotMatch(second, /Lift|WRONG_FALLBACK|\[object Object\]/);
    assert.match(renderer.renderCard({...mixed, row: {...mixed.row, RESULT_TEXT: null}}), /TOTAL ≈ WRONG_FALLBACK/);
});

test("partial, zero and loading results have distinct status and server totals are not replaced by the current page length", () => {
    const renderer = view();
    const data = payload([entry("LEGACY_ASSOC", 1)]);
    data.summary.sourceCounts[1].status = "unavailable";
    assert.match(renderer.render(data), /available results only/);
    assert.match(renderer.render(data), /Rows 1–1 of 401/);
    assert.match(renderer.render({total: 0, rules: []}), /No rules in this selection/);
    assert.doesNotMatch(renderer.render({rules: []}, {loading: true}), /No rules in this selection/);
    assert.match(renderer.render({rules: []}, {error: "Unavailable"}), /data-editing-retry/);
});

test("empty legacy formulas distinguish missing diagnostics, disabled analysis and a recorded task failure", () => {
    const renderer = view();
    const data = {family: "FORMULA", rules: [], total: 0, summary: {families: {FORMULA: {ruleCount: 0}},
        sourceCounts: [{family: "FORMULA", source: "LEGACY_SYMBOLIC", ruleCount: 0, status: "available"}]}, diagnostics: {}};
    assert.match(renderer.render(data), /No legacy formula diagnostics were recorded/);
    data.diagnostics.savedSummary = {integratedEditing: {stages: {DISCOVER: {legacyDiagnostics: {parts: ["CATEGORICAL"], tasks: []}}}}};
    assert.match(renderer.render(data), /Continuous analysis was not requested/);
    data.diagnostics.savedSummary.integratedEditing.stages.DISCOVER.legacyDiagnostics = {parts: ["ALL"],
        tasks: [{task: "CONTINUOUS_SYMBOLIC", status: "FAILED", message: "<error>"}]};
    const html = renderer.render(data);
    assert.match(html, /Continuous discovery did not complete successfully/);
    assert.match(html, /&lt;error&gt;/);
    assert.doesNotMatch(html, /<error>/);
});

test("browser controls page locally bounded results, escape stored text, and release callbacks on destruction", async () => {
    const browser = await chromium.launch({headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 430, height: 900}});
        await page.setContent(`<style>${css}</style><main id="results"></main>`);
        await page.addScriptTag({content: script});
        const data = payload([entry("LEGACY_ASSOC", "<img src=x onerror=alert(1)>", "CONDITION", {CONDITION_TEXT: "<script>window.attacked=true</script>"}), entry("MIXED_PATTERN", 1)]);
        await page.evaluate((data) => {
            const el = document.getElementById("results");
            el.innerHTML = EditingResultView.render(data, {language: "ko"});
            window.events = [];
            window.cleanup = EditingResultView.bind(el, {onFamily: (v) => events.push(["family", v]), onPage: (v) => events.push(["page", v]),
                onRule: (v) => events.push(["rule", v]), onSource: (v) => events.push(["source", v]), onLegacy: () => events.push(["legacy"])});
        }, data);
        assert.equal(await page.locator("#results script, #results img").count(), 0);
        assert.equal(await page.evaluate(() => window.attacked), undefined);
        await page.locator('[data-editing-family="FORMULA"]').click();
        await page.locator('[data-editing-page="2"]').click();
        await page.locator('[data-editing-rule-key="MIXED_PATTERN:1"]').click();
        await page.locator("[data-editing-source]").selectOption("MIXED_PATTERN");
        await page.locator("[data-editing-legacy]").click();
        assert.deepEqual(await page.evaluate(() => events), [["family", "FORMULA"], ["page", 2], ["rule", "MIXED_PATTERN:1"], ["source", "MIXED_PATTERN"], ["legacy"]]);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.match(await page.locator("#results").innerText(), /조건규칙/);
        await page.evaluate(() => cleanup());
        await page.locator('[data-editing-family="CONDITION"]').click();
        assert.equal(await page.evaluate(() => events.length), 5);
    } finally { await browser.close(); }
});


test("empty previews distinguish undetected rules from unsaved detected violations and inconsistent counts", () => {
    const renderer = view();
    assert.match(renderer.violationNotice({total: 0, fullViolationCount: 3, detectionCountRecorded: true}), /detected, but no preview rows/);
    assert.match(renderer.violationNotice({total: 0, fullViolationCount: null, detectionCountRecorded: false}), /does not establish/);
    assert.match(renderer.violationNotice({total: 0, fullViolationCount: 0, detectionCountRecorded: true}), /recorded zero/);
    assert.match(renderer.violationNotice({total: 0, fullViolationCount: 0, countConsistency: "INCONSISTENT"}), /disagree/);
});

test("rule labels annotate identifiers without changing quoted values, embedded identifiers or saved expressions", () => {
    const renderer = view();
    const rule = entry("LEGACY_ASSOC", "LABEL", "CONDITION", {CONDITION_TEXT: "AGE > 20 AND CODE = 'AGE' AND AGE2 = 1", RESULT_TEXT: "TOTAL = 0"});
    rule.columnComments = {AGE: "연령", TOTAL: "합계 <표시>", CODE: "코드"};
    const original = JSON.stringify(rule);
    const html = renderer.renderCard(rule);
    assert.match(html, /AGE\[연령\]/);
    assert.match(html, /TOTAL\[합계 &lt;표시&gt;\]/);
    assert.match(renderer.annotateColumnText(rule.row.CONDITION_TEXT, rule.columnComments), /CODE\[코드\] = 'AGE' AND AGE2 = 1/);
    assert.equal(JSON.stringify(rule), original);
    rule.family = "FORMULA";
    rule.row.EXPRESSION = "TOTAL = AGE + AGE2";
    assert.match(renderer.renderCard(rule), /TOTAL\[합계 &lt;표시&gt;\] = AGE\[연령\] \+ AGE2/);
});
