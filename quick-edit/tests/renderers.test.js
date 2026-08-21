const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

global.window = {};
const rendererPath = path.resolve(__dirname, "../js/renderers.js");
vm.runInThisContext(fs.readFileSync(rendererPath, "utf8"), { filename: rendererPath });

const R = global.window.QuickEditRenderers;

test("categorical all selection balances condition and result legend groups", () => {
    const ranked = [
        { RULE_ID: "A1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "A2", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "B1", CONDITION_COUNT: 2, RESULT_COLUMN: "COL_B" },
        { RULE_ID: "C1", CONDITION_COUNT: 3, RESULT_COLUMN: "COL_C" }
    ];

    const selected = R.selectBalancedRules(ranked, "categorical", { type: "ALL" }, 3);

    assert.deepEqual(selected.map((rule) => rule.RULE_ID), ["A1", "B1", "C1"]);
});

test("all selection takes the best rule from every visible legend before filling by rank", () => {
    const ranked = [
        { RULE_ID: "A1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "A2", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "B1", CONDITION_COUNT: 2, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "C1", CONDITION_COUNT: 3, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "D1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_B" },
        { RULE_ID: "E1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_C" }
    ];

    const selected = R.selectBalancedRules(ranked, "categorical", { type: "ALL" }, 5);

    assert.deepEqual(selected.map((rule) => rule.RULE_ID), ["A1", "B1", "C1", "D1", "E1"]);
});

test("selected categorical legend filters then balances the remaining dimension", () => {
    const ranked = [
        { RULE_ID: "A1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "A2", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A" },
        { RULE_ID: "B1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_B" },
        { RULE_ID: "C1", CONDITION_COUNT: 2, RESULT_COLUMN: "COL_C" }
    ];

    const selected = R.selectBalancedRules(
        ranked,
        "categorical",
        { type: "CONDITION_COUNT", value: "1" },
        3
    );

    assert.deepEqual(selected.map((rule) => rule.RULE_ID), ["A1", "A2", "B1"]);
});

test("categorical ranking keeps actual violations ahead of perfect-confidence clean rules", () => {
    const baseRules = [
        { RULE_ID: "CLEAN", CONDITION_COUNT: 3, RESULT_COLUMN: "COL_A", RULE_CONFIDENCE: 1 },
        { RULE_ID: "HIT", CONDITION_COUNT: 3, RESULT_COLUMN: "COL_B", RULE_CONFIDENCE: 0.91 }
    ];
    const violationRules = [
        { RULE_ID: "HIT", CONDITION_COUNT: 3, RESULT_COLUMN: "COL_B", VIOLATION_COUNT: 17 }
    ];

    const ranked = R.prioritizeCategoricalRules(baseRules, violationRules, 12);

    assert.deepEqual(ranked.map((rule) => rule.RULE_ID), ["HIT", "CLEAN"]);
});

test("balanced selection preserves a top violation from every condition-count legend", () => {
    const ranked = [
        { RULE_ID: "A1", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A", VIOLATION_COUNT: 50 },
        { RULE_ID: "A2", CONDITION_COUNT: 1, RESULT_COLUMN: "COL_A", VIOLATION_COUNT: 40 },
        { RULE_ID: "B1", CONDITION_COUNT: 2, RESULT_COLUMN: "COL_A", VIOLATION_COUNT: 20 },
        { RULE_ID: "C1", CONDITION_COUNT: 3, RESULT_COLUMN: "COL_A", VIOLATION_COUNT: 17 }
    ];

    const selected = R.selectBalancedRules(ranked, "categorical", { type: "ALL" }, 3);

    assert.deepEqual(selected.map((rule) => rule.RULE_ID), ["A1", "B1", "C1"]);
});

test("continuous method filter returns only the selected method", () => {
    const ranked = [
        { RULE_ID: "L1", TARGET_COLUMN: "COL_A", METHOD: "LINEAR_REGRESSION" },
        { RULE_ID: "P1", TARGET_COLUMN: "COL_A", METHOD: "POLYNOMIAL_LASSO" },
        { RULE_ID: "L2", TARGET_COLUMN: "COL_B", METHOD: "LINEAR_REGRESSION" }
    ];

    const selected = R.selectBalancedRules(
        ranked,
        "continuous",
        { type: "METHOD", value: "LINEAR_REGRESSION" },
        12
    );

    assert.deepEqual(selected.map((rule) => rule.RULE_ID), ["L1", "L2"]);
});

test("continuous ranking promotes a simple linear example within the same violation count", () => {
    const rules = [
        {
            RULE_ID: "COMPLEX",
            TARGET_COLUMN: "COL_A",
            METHOD: "LINEAR_REGRESSION",
            FEATURE_COLUMNS: "COL_B,COL_C,COL_D,COL_E",
            COMPLEXITY: 8,
            VIOLATION_COUNT: 10
        },
        {
            RULE_ID: "SIMPLE",
            TARGET_COLUMN: "COL_F",
            METHOD: "LINEAR_REGRESSION",
            FEATURE_COLUMNS: "COL_G,COL_H",
            COMPLEXITY: 2,
            VIOLATION_COUNT: 10
        }
    ];

    const ranked = R.prioritizeContinuousRules(rules, [], 12);

    assert.deepEqual(ranked.map((rule) => rule.RULE_ID), ["SIMPLE", "COMPLEX"]);
    assert.equal(R.isSimpleLinearRule(ranked[0]), true);
});

test("continuous balanced selection retains a violated simple linear example", () => {
    const ranked = [
        {
            RULE_ID: "COMPLEX",
            TARGET_COLUMN: "COL_A",
            METHOD: "LINEAR_REGRESSION",
            FEATURE_COLUMNS: "COL_B,COL_C,COL_D",
            COMPLEXITY: 6,
            VIOLATION_COUNT: 30
        },
        {
            RULE_ID: "POLY",
            TARGET_COLUMN: "COL_B",
            METHOD: "POLYNOMIAL_LASSO",
            VIOLATION_COUNT: 20
        },
        {
            RULE_ID: "SIMPLE",
            TARGET_COLUMN: "COL_A",
            METHOD: "LINEAR_REGRESSION",
            FEATURE_COLUMNS: "COL_C,COL_D",
            COMPLEXITY: 2,
            VIOLATION_COUNT: 5
        }
    ];

    const selected = R.selectBalancedRules(ranked, "continuous", { type: "ALL" }, 2);

    assert.deepEqual(selected.map((rule) => rule.RULE_ID), ["POLY", "SIMPLE"]);
});

test("interactive bars expose all reset, selected state, and click affordance", () => {
    const html = R.renderBars(
        [{ key: "COL_A", label: "COL_A · 항목", value: 10 }],
        {
            interactive: true,
            filterKind: "categorical",
            filterType: "RESULT_COLUMN",
            activeFilter: { type: "RESULT_COLUMN", value: "COL_A" }
        }
    );

    assert.match(html, /data-rule-filter-type="ALL"/);
    assert.match(html, /data-rule-filter-value="COL_A"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /qe-bar-click-icon/);
});

test("legend items are limited to groups represented by displayed rules", () => {
    const items = [
        { key: "COL_A", label: "COL_A", value: 10 },
        { key: "COL_B", label: "COL_B", value: 20 },
        { key: "COL_C", label: "COL_C", value: 30 }
    ];
    const displayedRules = [
        { RULE_ID: "A1", RESULT_COLUMN: "COL_A" },
        { RULE_ID: "C1", RESULT_COLUMN: "COL_C" }
    ];

    const filtered = R.filterLegendItems(items, displayedRules, "categorical", "RESULT_COLUMN");

    assert.deepEqual(filtered.map((item) => item.key), ["COL_A", "COL_C"]);
});
