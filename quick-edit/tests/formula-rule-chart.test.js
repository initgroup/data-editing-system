const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function chart(language = "en") {
    const context = {window: {sessionStorage: {getItem: () => language}}};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../frontend/js/formula-rule-chart.js"), "utf8"), context);
    return context.window.FormulaRuleChart;
}
function point(values = {}) {
    return {rowId: "R1", predicted: 10, actual: 11, lower: 8, upper: 12, residual: 1, violation: false, ...values};
}

test("formula plots preserve server classification and omit invalid coordinates without zero coercion", () => {
    const api = chart();
    const result = api.buildData({rule: {absoluteTolerance: 2, relativeTolerance: 0}, points: [
        point({violation: true}), // SQL status wins even if display precision rounds onto the bound.
        point({rowId: "NULL", actual: null}), point({rowId: "EMPTY", predicted: ""}),
        point({rowId: "BAD", actual: "invalid"}), point({rowId: "NAN", residual: Infinity}),
        point({rowId: "UNKNOWN_STATUS", violation: undefined}), point({rowId: "BOOL", actual: false})
    ]});
    assert.equal(result.points.length, 1);
    assert.equal(result.points[0].violation, true);
    assert.equal(result.points[0].x, 11);
    assert.equal(result.points[0].y, 10);
    assert.equal(result.invalidPointCount, 6);
    assert.equal(result.bands[0].upper - result.bands[0].center, 2);
});

test("formula boundaries use the saved maximum of absolute and relative tolerance without fitting points", () => {
    const api = chart(), payload = {rule: {absoluteTolerance: 2, relativeTolerance: .1}, points: [
        point({predicted: -40, actual: -39, lower: -44, upper: -36}),
        point({predicted: 40, actual: 80, lower: 36, upper: 44, residual: 40, violation: true})
    ]};
    const data = api.buildData(payload);
    for (const band of data.bands) {
        assert.equal(band.center, band.x);
        assert.ok(Math.abs((band.upper - band.center) - Math.max(2, .1 * Math.abs(band.x))) < 1e-10);
    }
    assert.ok(data.bands.some((band) => band.x === 20 && band.upper === 22));
    assert.ok(data.bands.some((band) => band.x === -20 && band.lower === -22));
    const residual = api.buildData(payload, "residual");
    assert.equal(residual.points[1].y, 40);
    assert.ok(residual.bands.every((band) => band.center === 0));
    assert.ok(residual.yRange[1] > 40);
});

test("residual chart keeps server Decimal residual and small tolerance when large coordinates round together", () => {
    const result = chart().buildData({rule: {absoluteTolerance: .2, relativeTolerance: 0}, points: [
        point({predicted: 1e20, actual: 1e20, lower: 1e20, upper: 1e20, residual: .1})
    ]}, "residual");
    assert.equal(result.points[0].y, .1);
    assert.ok(result.yRange[0] < -.2);
    assert.ok(result.yRange[1] > .2);
    assert.ok(result.bands.every((band) => band.lower === -.2 && band.upper === .2));
    assert.equal(chart().buildData({points: []}).points.length, 0);
});

test("shared chart describes current source sampling and distinguishes rule tolerance from CI/PI in both languages", () => {
    assert.equal(chart("ko").t("Residual plot"), "잔차 그래프");
    assert.equal(chart("en").t("Residual plot"), "Residual plot");
    assert.match(chart("ko").t("This chart evaluates the saved formula against current source data, not a historical data snapshot."), /현재 원본/);
    assert.match(chart("ko").t("The outlines are saved rule tolerances, not 95% confidence or prediction intervals."), /신뢰구간·예측구간이 아닙니다/);
});
