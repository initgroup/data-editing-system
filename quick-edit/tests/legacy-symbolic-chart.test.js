const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");
const {chromium} = require("playwright");
const root = path.resolve(__dirname, "../..");

async function openChart(language = "en", width = 1440) {
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width, height: 1000}});
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
        await page.route("**/*", (route) => route.abort());
        await page.setContent('<button id="opener">Open</button><div id="container-M04002"></div>');
        for (const file of ["frontend/css/styletail.css", "frontend/css/style.css", "frontend/css/styleMenu.css", "frontend/css/pages/MCOM_ANLY_WORK.css", "frontend/css/grid-custom.css", "frontend/css/rule-chart-controls.css"]) await page.addStyleTag({path: path.join(root, file)});
        await page.evaluate(() => {
            window.API_BASE_URL = "/api";
            window.PageManager = {createHelper: () => ({getContainerEl: (selector) => document.querySelector(selector)})};
        });
        for (const file of ["frontend/js/chart.js", "frontend/js/regression-diagnostics.js", "frontend/js/MCOM_ANLY_WORK.js"]) await page.addScriptTag({path: path.join(root, file)});
        const pack = JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/MCOM_ANLY_WORK.${language}.json`), "utf8"));
        await page.evaluate((pack) => {
            window.M04002_PAGE_I18N = pack;
            window.CommonUtils = {applyStandardGridDefaults() {}, applyStandardGridFreeze() {}, request: async () => ({data: {rows: Array.from({length: 24}, (_, i) => ({X: i + 1, Y: (i + 1) * 2 + (i === 12 ? 25 : (i % 3 - 1) / 2)}))}})};
            const p = window.MCOMMON.createAnlyWorkPage({pageCode: "M04002"});
            p.lastSymbolicRuleSummary = {topRules: [{RULE_ID: "R1", RULE_OWNER: "OWNER", RUN_ID: 1, TARGET_COLUMN: "Y", EXPRESSION: "2 * X", FEATURE_COLUMNS: "X", FEATURE_LIST: ["X"], FEATURE_RANGES: [{COLUMN_NAME: "X", MIN_VALUE: 1, MAX_VALUE: 24, AVG_VALUE: 12.5}]}]};
            document.querySelector("#opener").onclick = () => p.openSymbolicRulePopup("Y|R1|1");
        }, pack);
        await page.locator("#opener").click();
        await page.waitForFunction(() => window.M04002.symbolicRuleChart && !window.M04002.symbolicRuleChartState.loading && document.querySelectorAll("[data-symbolic-legend]").length > 0, null, {timeout: 5000});
        return {browser, page, errors};
    } catch (error) {const info = await page.locator("#M04002SymbolicRuleChartMessage").textContent().catch(() => ""); await browser.close(); throw new Error(`${error.message}\n${info}\n${JSON.stringify(errors)}`);}
}

async function chartState(page) {
    return page.evaluate(() => {
        const p = window.M04002, c = p.symbolicRuleChart;
        return {zoom: p.symbolicRuleChartState.zoomPercent, xMin: c.scales.x.min, xMax: c.scales.x.max,
            yMin: c.scales.y.min, yMax: c.scales.y.max, pan: !!p.symbolicRuleChartState.chartPan};
    });
}

async function wheel(page, deltaY, steps = 1, xFraction = .5, yFraction = .5) {
    return page.evaluate(({deltaY, steps, xFraction, yFraction}) => {
        const c = window.M04002.symbolicRuleChart, r = c.canvas.getBoundingClientRect(), a = c.chartArea;
        let prevented = false;
        for (let i = 0; i < steps; i += 1) {
            const event = new WheelEvent("wheel", {clientX: r.left + (a.left + a.width * xFraction) * r.width / c.width,
                clientY: r.top + (a.top + a.height * yFraction) * r.height / c.height, deltaY, bubbles: true, cancelable: true});
            c.canvas.dispatchEvent(event);
            prevented = event.defaultPrevented;
        }
        return prevented;
    }, {deltaY, steps, xFraction, yFraction});
}

test("legacy chart selects nearby samples across reference lines and tolerates small pointer movement", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const samplePosition = async (sampleIndex) => page.evaluate((sampleIndex) => {
            const c = window.M04002.symbolicRuleChart, rect = c.canvas.getBoundingClientRect();
            const dataset = c.data.datasets.findIndex(d => d.data.some(p => p.sampleIndex === sampleIndex));
            const index = c.data.datasets[dataset].data.findIndex(p => p.sampleIndex === sampleIndex);
            const point = c.getDatasetMeta(dataset).data[index];
            return {x: rect.left + point.x * rect.width / c.width, y: rect.top + point.y * rect.height / c.height};
        }, sampleIndex);
        let location = await samplePosition(12);
        await page.mouse.click(location.x + 8, location.y);
        await page.waitForFunction(() => window.M04002.symbolicRuleChartState.selectedRowIndex === 12);
        assert.equal(await page.locator('tr[data-symbolic-sample-index="12"]').getAttribute("aria-selected"), "true");
        await page.locator('#M04002SymbolicRuleChart').scrollIntoViewIfNeeded();
        location = await samplePosition(18);
        await page.mouse.move(location.x + 6, location.y);
        await page.mouse.down();
        await page.mouse.move(location.x + 9, location.y + 1);
        await page.mouse.up();
        await page.waitForFunction(() => window.M04002.symbolicRuleChartState.selectedRowIndex === 18);
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.chartPanEndAt), 0);
        const frame = await page.evaluate(() => {
            const c = window.M04002.symbolicRuleChart, calls = [], original = c.ctx.strokeRect;
            c.ctx.strokeRect = function(...args) {calls.push({args, stroke: this.strokeStyle}); return original.apply(this, args);};
            c.draw(); c.ctx.strokeRect = original;
            return {calls, expected: [c.chartArea.left, c.chartArea.top, c.chartArea.width, c.chartArea.height]};
        });
        assert.ok(frame.calls.some(call => call.stroke === "#94a3b8" && call.args.every((value, index) => Math.abs(value - frame.expected[index]) < .01)));
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Chart.js wheel bounds constrain actual axes and retain the pointer anchor with CSS scaling", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const initial = await chartState(page);
        await wheel(page, -100, 30);
        const atMax = await chartState(page);
        assert.equal(atMax.zoom, 800);
        assert.ok(Math.abs((atMax.xMax - atMax.xMin) / (initial.xMax - initial.xMin) - .125) < 1e-8);
        await wheel(page, -100, 20);
        assert.deepEqual(await chartState(page), atMax);
        await wheel(page, 100, 40);
        const atMin = await chartState(page);
        assert.equal(atMin.zoom, 50);
        await wheel(page, 100, 20);
        assert.deepEqual(await chartState(page), atMin);
        await page.evaluate(() => {
            window.M04002.resetSymbolicRuleChartZoom();
            document.querySelector("#M04002SymbolicRulePopup").style.transform = "translateX(-50%) scale(.7)";
        });
        const anchorBefore = await page.evaluate(() => {
            const c = window.M04002.symbolicRuleChart, a = c.chartArea, r = c.canvas.getBoundingClientRect();
            const event = new WheelEvent("wheel", {clientX: r.left + (a.left + a.width * .3) * r.width / c.width, clientY: r.top + (a.top + a.height * .4) * r.height / c.height});
            window.wheelFractions = {x: ((event.clientX - r.left) * c.width / r.width - a.left) / a.width, y: ((event.clientY - r.top) * c.height / r.height - a.top) / a.height};
            return {x: c.scales.x.getValueForPixel(a.left + a.width * window.wheelFractions.x), y: c.scales.y.getValueForPixel(a.top + a.height * window.wheelFractions.y)};
        });
        await wheel(page, -100, 1, .3, .4);
        const anchorAfter = await page.evaluate(() => {const c = window.M04002.symbolicRuleChart, a = c.chartArea; return {x: c.scales.x.getValueForPixel(a.left + a.width * window.wheelFractions.x), y: c.scales.y.getValueForPixel(a.top + a.height * window.wheelFractions.y)};});
        assert.ok(Math.abs(anchorAfter.x - anchorBefore.x) < 1e-8, JSON.stringify({anchorBefore, anchorAfter}));
        assert.ok(Math.abs(anchorAfter.y - anchorBefore.y) < 1e-8, JSON.stringify({anchorBefore, anchorAfter}));
        await page.evaluate(() => window.M04002.toggleSymbolicRuleWheelZoom());
        const disabled = await chartState(page);
        assert.equal(await wheel(page, -100), false);
        assert.deepEqual(await chartState(page), disabled);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Chart.js pan starts only in the plot and uses displayed coordinates while suppressing drag clicks", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const outside = await page.evaluate(() => {
            const p = window.M04002, c = p.symbolicRuleChart, r = c.canvas.getBoundingClientRect();
            c.canvas.dispatchEvent(new PointerEvent("pointerdown", {clientX: r.left + 1, clientY: r.top + 1, pointerId: 2, button: 0, bubbles: true}));
            return !!p.symbolicRuleChartState.chartPan;
        });
        assert.equal(outside, false);
        await page.evaluate(() => {document.querySelector("#M04002SymbolicRulePopup").style.transform = "translateX(-50%) scale(.7)";});
        const result = await page.evaluate(() => {
            const p = window.M04002, c = p.symbolicRuleChart, a = c.chartArea, r = c.canvas.getBoundingClientRect();
            const initialMin = c.scales.x.min, initialSpan = c.scales.x.max - initialMin;
            const x = r.left + (a.left + a.width * .5) * r.width / c.width, y = r.top + (a.top + a.height * .5) * r.height / c.height;
            c.canvas.dispatchEvent(new PointerEvent("pointerdown", {clientX: x, clientY: y, pointerId: 3, button: 0, bubbles: true}));
            c.canvas.dispatchEvent(new PointerEvent("pointermove", {clientX: x + a.width * .1 * r.width / c.width, clientY: y, pointerId: 3, button: 0, bubbles: true, cancelable: true}));
            c.canvas.dispatchEvent(new PointerEvent("pointerup", {clientX: x + a.width * .1 * r.width / c.width, clientY: y, pointerId: 3, button: 0, bubbles: true}));
            p.handleSymbolicRuleChartClick({}, [{datasetIndex: 0, index: 0}], c);
            return {expectedMin: initialMin - initialSpan * .1, min: c.scales.x.min, pan: p.symbolicRuleChartState.chartPan, selected: p.symbolicRuleChartState.selectedRowIndex};
        });
        assert.ok(Math.abs(result.min - result.expectedMin) < 1e-8);
        assert.equal(result.pan, null);
        assert.equal(result.selected, null);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy legend buttons toggle CI/PI groups and hidden samples stay excluded from keyboard selection", async () => {
    const {browser, page, errors} = await openChart("ko");
    try {
        const piIndex = await page.evaluate(() => window.M04002.symbolicRuleChart.data.datasets.findIndex((d) => d.diagnosticGroup === "pi"));
        const pi = page.locator(`[data-symbolic-legend="${piIndex}"]`);
        await pi.focus();
        await page.keyboard.press("Space");
        assert.equal(await pi.getAttribute("aria-pressed"), "false");
        assert.deepEqual(await page.evaluate(() => {const c = window.M04002.symbolicRuleChart; return c.data.datasets.map((d, i) => d.diagnosticGroup === "pi" ? c.isDatasetVisible(i) : null).filter((x) => x !== null);}), [false, false]);
        await page.locator('[data-symbolic-legend="0"]').click();
        const chart = page.locator("#M04002SymbolicRuleChart");
        await chart.focus();
        await page.keyboard.press("Home");
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.selectedRowIndex), 12);
        assert.equal(await page.evaluate(() => document.activeElement.id), "M04002SymbolicRuleChart");
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChart.isDatasetVisible(0)), false);
        await page.locator('[data-symbolic-sample-index="0"]').click();
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChart.isDatasetVisible(0)), true);
        assert.equal(await page.locator('[data-symbolic-legend="0"]').getAttribute("aria-pressed"), "true");
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.selectedRowIndex), 0);
        await page.evaluate(() => window.M04002.zoomSymbolicRuleChart(8));
        await chart.focus();
        await page.keyboard.press("End");
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.selectedRowIndex), 23);
        assert.equal(await page.evaluate(() => {
            const c = window.M04002.symbolicRuleChart;
            const point = c.data.datasets.flatMap((d) => d.data).find((p) => p.sampleIndex === 23);
            return point.x >= c.scales.x.min && point.x <= c.scales.x.max && point.y >= c.scales.y.min && point.y <= c.scales.y.max;
        }), true);
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.zoomPercent), 800);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy maximum restores with Escape and closing during header drag cleans up handlers and focus", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await page.locator("[data-anly-symbolic-maximize-btn]").click();
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.maximized), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#M04002SymbolicRulePopup").count(), 1);
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.maximized), false);
        await page.evaluate(() => {
            window.oldPopup = document.querySelector("#M04002SymbolicRulePopup");
            window.oldCanvas = window.M04002.symbolicRuleChart.canvas;
            const header = window.oldPopup.querySelector("header"), rect = header.getBoundingClientRect();
            header.dispatchEvent(new MouseEvent("mousedown", {clientX: rect.left + 100, clientY: rect.top + 10, button: 0, bubbles: true, cancelable: true}));
        });
        assert.equal(await page.evaluate(() => typeof window.M04002.symbolicRulePopupDragCleanup), "function");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#M04002SymbolicRulePopup").count(), 0);
        const result = await page.evaluate(() => {
            const position = window.oldPopup.style.cssText;
            document.dispatchEvent(new MouseEvent("mousemove", {clientX: 800, clientY: 600, bubbles: true}));
            return {same: position === window.oldPopup.style.cssText, cleanup: window.M04002.symbolicRulePopupDragCleanup,
                wheel: window.oldCanvas.onwheel, pointer: window.oldCanvas.onpointerdown, focus: document.activeElement.id};
        });
        assert.deepEqual(result, {same: true, cleanup: null, wheel: null, pointer: null, focus: "opener"});
        await page.locator("#opener").click();
        await page.waitForFunction(() => !!window.M04002.symbolicRuleChart);
        assert.equal(await page.evaluate(() => window.M04002.symbolicRuleChartState.zoomPercent), 100);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy plot and keyboard legend fit a narrow viewport and resize after maximize", async () => {
    const {browser, page, errors} = await openChart("en", 500);
    try {
        const canvas = page.locator("#M04002SymbolicRuleChart");
        const popup = page.locator("#M04002SymbolicRulePopup");
        let bounds = await canvas.boundingBox();
        assert.ok(bounds.width > 200 && bounds.width < 500);
        assert.ok(bounds.height > 100);
        assert.ok((await popup.boundingBox()).width <= 500);
        const buttons = await page.locator("[data-symbolic-legend]").all();
        for (const button of buttons) {const b = await button.boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= 500);}
        await page.locator("[data-anly-symbolic-maximize-btn]").click();
        await page.setViewportSize({width: 760, height: 900});
        await page.waitForFunction(() => window.M04002.symbolicRuleChart.width > 600);
        bounds = await canvas.boundingBox();
        assert.ok(bounds.width > 600 && bounds.height > 100);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
