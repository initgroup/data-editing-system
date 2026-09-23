const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({ window: {}, PageManager: { createHelper: () => ({}) } });
for (const relative of ["../../frontend/js/regression-diagnostics.js", "../js/renderers.js", "../../frontend/js/MCOM_ANLY_WORK.js"]) {
    const file = path.resolve(__dirname, relative);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}
const D = context.window.RegressionDiagnostics;
const R = context.window.QuickEditRenderers;
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("OLS CI and PI agree with an independently calculated Student-t fixture", () => {
    const result = D.fit([2, 4, 5, 4, 5].map((y, index) => ({ x: index + 1, y })));
    assert.equal(result.ok, true);
    close(result.slope, 0.6);
    close(result.intercept, 2.2);
    close(result.residualStd, 0.894427190999916);
    close(result.criticalValue, 3.1824463052837078);
    const middle = result.bands[40];
    close(middle.x, 3);
    close(middle.y, 4);
    close(middle.ciUpper - middle.y, 1.272978522113483);
    close(middle.piUpper - middle.y, 3.118147832700266);
    assert.ok(result.bands[0].ciUpper - result.bands[0].y > middle.ciUpper - middle.y);
    result.bands.forEach((band) => {
        assert.ok(band.piLower < band.ciLower);
        assert.ok(band.piUpper > band.ciUpper);
    });
});

test("insufficient, invalid and constant-X observations do not claim to be normal or anomalous", () => {
    for (const points of [[], [{ x: 1, y: 1 }, { x: 2, y: 2 }], Array.from({ length: 4 }, (_, y) => ({ x: 3, y }))]) {
        const result = D.fit(points);
        assert.equal(result.ok, false);
        assert.equal(result.bands.length, 0);
        assert.ok(result.points.every((point) => point.isAttention === null));
        assert.equal(D.chartDatasets(result).length, 0);
    }
    const result = D.fit([{ x: null, y: 4 }, { x: " ", y: 2 }, { x: true, y: 3 }, { x: 4, y: NaN }, { x: "5", y: "6", rowIndex: 9 }]);
    assert.equal(result.count, 1);
    assert.equal(result.points[0].rowIndex, 9);
});

test("exact fits collapse intervals without floating-point false alarms at large offsets", () => {
    const result = D.fit(Array.from({ length: 20 }, (_, index) => ({ x: 1e12 + index / 8, y: 1e12 + index / 4 })));
    assert.equal(result.ok, true);
    assert.equal(result.outsideCount, 0);
    close(result.slope, 2);
    result.bands.forEach((band) => close(band.ciUpper, band.piUpper));
});

test("prediction-boundary candidates preserve row identity and do not mutate source data", () => {
    const points = Array.from({ length: 100 }, (_, index) => ({ x: index, y: 2 * index + index % 3 - 1, rowIndex: index + 7 }));
    points[50].y += 100;
    const result = R.buildRegressionDiagnostics(points);
    assert.equal(result.outsideCount, 1);
    assert.equal(result.points.find((point) => point.isAttention).rowIndex, 57);
    assert.equal(points[50].isAttention, undefined);
    assert.match(R.getRegressionDiagnosticMessage(result), /저장 규칙의 위반 판정과는 별개/);
});

test("large-df Student-t values approach the normal value without the small-sample shortcut", () => {
    close(D.tCritical95(1), 12.70620474);
    close(D.tCritical95(100), 1.983971518, 1e-6);
    close(D.tCritical95(100000), 1.959987707, 1e-7);
});

test("point appearance preserves the classification shape when a row is selected", () => {
    const normal = D.pointStyle(false, false);
    const attention = D.pointStyle(true, false);
    const selectedNormal = D.pointStyle(false, true);
    const selectedAttention = D.pointStyle(true, true);
    assert.equal(normal.shape, "circle");
    assert.equal(attention.shape, "triangle");
    assert.equal(selectedNormal.shape, "circle");
    assert.equal(selectedAttention.shape, "triangle");
    assert.equal(selectedNormal.fill, selectedAttention.fill);
    assert.equal(selectedNormal.stroke, D.chartStyle.selected.stroke);
    assert.notEqual(selectedNormal.fill, selectedNormal.stroke);
    assert.ok(selectedNormal.radius > attention.radius && attention.radius > normal.radius);
    selectedAttention.radius = 99;
    assert.equal(D.pointStyle(true, true).radius, 6);
    assert.ok(Object.isFrozen(D.chartStyle.normal));
    assert.ok(Object.isFrozen(D.chartStyle.reference.dash));
});

test("canvas boundaries and Chart.js datasets use the same line and fill styles", () => {
    const diagnostic = D.fit(Array.from({length: 10}, (_, x) => ({x, y: x * 2 + x % 3})));
    const datasets = D.chartDatasets(diagnostic);
    const strokes = [];
    const fills = [];
    const canvas = {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        setLineDash(dash) {this.dash = [...dash];},
        stroke() {strokes.push({color: this.strokeStyle, width: this.lineWidth, dash: this.dash});},
        fill() {fills.push(this.fillStyle);}
    };
    R.drawRegressionBands(canvas, diagnostic, (x) => x, (y) => y);
    assert.equal(strokes.length, datasets.length);
    datasets.forEach((dataset, index) => {
        assert.equal(strokes[index].color, dataset.borderColor);
        assert.equal(strokes[index].width, dataset.borderWidth);
        assert.deepEqual(strokes[index].dash, Array.from(dataset.borderDash));
    });
    assert.equal(fills[0], datasets.find((dataset) => dataset.fill).backgroundColor);
    assert.notEqual(D.chartStyle.ci.stroke, D.chartStyle.pi.stroke);
    assert.equal(D.chartStyle.ci.dash.length, 0);
    assert.ok(D.chartStyle.tolerance.dash.length > 0);
});

test("analysis chart draws distinct boundary groups and preserves selected sample links", () => {
    const page = context.window.MCOMMON.createAnlyWorkPage();
    const evaluatedRows = Array.from({ length: 100 }, (_, index) => ({
        rowIndex: index + 1, actual: index, predicted: 2 * index + (index === 50 ? 100 : index % 3 - 1), residual: index
    }));
    const state = { evaluatedRows, rule: { TARGET_COLUMN: "AMOUNT" }, summary: {} };
    page.symbolicRuleChartState = state;
    const chart = page.buildSymbolicActualPredictedChartData(state);
    assert.equal(chart.ok, true);
    const samples = chart.datasets.filter((dataset) => ["circle", "triangle"].includes(dataset.pointStyle));
    assert.equal(samples.length, 2);
    assert.equal(samples[0].pointStyle, "circle");
    assert.equal(samples[1].pointStyle, "triangle");
    assert.equal(samples[1].data[0].sampleIndex, 51);
    assert.equal(chart.datasets.filter((dataset) => dataset.diagnosticGroup === "pi").length, 2);
    assert.equal(chart.datasets.filter((dataset) => dataset.diagnosticGroup === "ci").length, 2);
    assert.match(chart.message, /separate from saved-rule violations/);
    let selected = null;
    page.selectSymbolicSampleRow = (index) => { selected = index; };
    const observation = samples[1].data[0];
    page.handleSymbolicRuleChartClick({x: observation.x, y: observation.y}, [], {
        data: {datasets: chart.datasets}, width: 300, height: 300,
        chartArea: {left: 0, top: 0, right: 300, bottom: 300},
        canvas: {getBoundingClientRect: () => ({width: 300, height: 300})},
        isDatasetVisible: () => true,
        getDatasetMeta: index => ({data: chart.datasets[index].data})
    });
    assert.equal(selected, 51);
    const residual = page.buildSymbolicResidualChartData(state);
    assert.equal(residual.datasets.at(-1).label, "y = 0");
});
