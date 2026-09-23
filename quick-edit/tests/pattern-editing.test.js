const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");

function setup(language) {
    const sandbox = { window: {}, PageManager: { createHelper: () => ({ getContainerEl: () => null }) }, API_BASE_URL: "/api" };
    vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/js/MCOM_EDIT_WORK.js"), "utf8"), sandbox);
    sandbox.window.M05002_PAGE_I18N = JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/MCOM_EDIT_WORK.${language}.json`), "utf8"));
    sandbox.window.I18nManager = { tPage: (_page, key, fallback) => sandbox.window.M05002_PAGE_I18N.labels[key] || fallback };
    return sandbox.window.MCOMMON.createEditWorkPage({ pageCode: "M05002" });
}

test("range editing keeps actual value instead of copying an interval as a number", () => {
    for (const language of ["ko", "en"]) {
        const page = setup(language);
        const row = { CASE_ROWID: "AAA", EXPECTED_VALUE: "(10, 20]", ACTUAL_VALUE: 30, RESULT_KIND: "RANGE", AUTO_REPLACE_YN: "N" };
        const html = page.renderInlineEditor(row, 0, { SESSION_STATUS: "EDITING" });
        assert.match(html, /value="30"/);
        assert.doesNotMatch(html, /value="\(10, 20\]"/);
        assert.match(html, language === "ko" ? /단일 교정값이 없습니다/ : /no single replacement value/);
        row.EDIT_CHANGE_ID = 1;
        row.CURRENT_VALUE = 15;
        assert.match(page.renderInlineEditor(row, 0, { SESSION_STATUS: "EDITING" }), /value="15"/);
    }
});

test("scalar and legacy rules retain expected-value suggestions including zero", () => {
    const page = setup("en");
    for (const row of [
        { CASE_ROWID: "AAA", EXPECTED_VALUE: 0, ACTUAL_VALUE: 30 },
        { CASE_ROWID: "AAA", EXPECTED_VALUE: 0, ACTUAL_VALUE: 30, RESULT_KIND: "VALUE", AUTO_REPLACE_YN: "Y" }
    ]) {
        assert.match(page.renderInlineEditor(row, 0, { SESSION_STATUS: "EDITING" }), /value="0"/);
    }
});

test("formula editing keeps manual correction and final analysis displays actual formula and absolute tolerance", () => {
    for (const language of ["ko", "en"]) {
        const page = setup(language);
        const row = { CASE_ROWID: "AAA", RESULT_KIND: "FORMULA", AUTO_REPLACE_YN: "N", EXPECTED_VALUE: "Y ≈ X * 2", ACTUAL_VALUE: 30,
            RULE_EXPRESSION: "X IS NOT NULL", RESULT_EXPRESSION: "Y ≈ X * 2", TARGET_COLUMN: "Y", ABSOLUTE_TOLERANCE: 2,
            EFFECTIVE_TOLERANCE_PCT: 0, RULE_CONFIDENCE: .99, SOURCE_RULE_TYPE: "ASSOCIATION" };
        const html = page.renderInlineEditor(row, 0, { SESSION_STATUS: "EDITING" });
        assert.match(html, /value="30"/);
        assert.doesNotMatch(html, /value="Y/);
        assert.equal(page.isContinuousRule(row), true);
        const detail = page.buildContinuousRuleDetailContent(row);
        assert.match(detail, /X IS NOT NULL/);
        assert.match(detail, /Y ≈ X \* 2/);
        const analysis = page.buildContinuousAnalysisDetail({CONTINUOUS: {RULES: [row]}});
        assert.match(analysis, /Y ≈ X \* 2/);
        assert.match(analysis, language === "ko" ? /2 결과 단위/ : /2 target units/);
        assert.doesNotMatch(analysis, />2%/);
    }
});
