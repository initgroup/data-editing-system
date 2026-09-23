const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "../..");
const canvasSelector = "#qeContinuousDetailChart";
const samples = Array.from({length: 8}, (_, rowIndex) => ({
    rowIndex, actual: 10 * (rowIndex + 1),
    predicted: 10 * (rowIndex + 1) + [1, -2, 2, -1, 0, 3, -1, 8][rowIndex],
    residual: -[1, -2, 2, -1, 0, 3, -1, 8][rowIndex]
}));

async function openChart({width = 360, ratio = 1} = {}) {
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1100, height: 1000}, deviceScaleFactor: ratio});
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
        // A local origin supplies ordinary sessionStorage without loading the app or any network API.
        await page.route("**/*", (route) => route.fulfill({contentType: "text/html", body: "<!doctype html><html><body></body></html>"}));
        await page.goto("http://legacy-quick-chart.test/");
        await page.addStyleTag({path: path.join(root, "quick-edit/css/quick-edit.css")});
        await page.addStyleTag({content: "body{margin:0;padding:16px}#fixture{max-width:100%}"});
        await page.evaluate(({width, samples}) => {
            document.body.innerHTML = `<div id="fixture" style="width:${width}px">
                <section id="qeContinuousDetail">
                    <select id="qeContinuousChartMode"><option value="actual-predicted">Actual</option><option value="residual">Residual</option></select>
                    <div class="qe-continuous-chart-wrap"><canvas id="qeContinuousDetailChart" width="1100" height="380" tabindex="0"></canvas><p id="qeContinuousDetailMessage"></p></div>
                    <div id="qeContinuousSampleTable" class="qe-detail-table-wrap"><table><tbody>${samples.map((row) => `<tr tabindex="-1" data-continuous-row-index="${row.rowIndex}"><td>Row ${row.rowIndex}</td></tr>`).join("")}</tbody></table></div>
                </section></div>`;
            window.QuickEditApiClient = class {};
            window.I18nManager = {getSessionLanguage: () => "ko"};
            window.drawRecords = [];
            const context = document.querySelector("#qeContinuousDetailChart").getContext("2d");
            for (const method of ["clearRect", "fillText", "moveTo"]) {
                const original = context[method].bind(context);
                context[method] = function (...args) {
                    let bounds = null;
                    if (method === "fillText") {
                        const metrics = this.measureText(args[0]);
                        const transform = this.getTransform();
                        const left = args[1] - metrics.actualBoundingBoxLeft;
                        const right = args[1] + metrics.actualBoundingBoxRight;
                        const top = args[2] - metrics.actualBoundingBoxAscent;
                        const bottom = args[2] + metrics.actualBoundingBoxDescent;
                        const corners = [[left, top], [right, top], [left, bottom], [right, bottom]]
                            .map(([x, y]) => ({x: transform.a * x + transform.c * y + transform.e, y: transform.b * x + transform.d * y + transform.f}));
                        bounds = {left: Math.min(...corners.map((point) => point.x)), right: Math.max(...corners.map((point) => point.x)),
                            top: Math.min(...corners.map((point) => point.y)), bottom: Math.max(...corners.map((point) => point.y))};
                    }
                    window.drawRecords.push({method, args, font: this.font, textAlign: this.textAlign, strokeStyle: this.strokeStyle, bounds});
                    return original(...args);
                };
            }
        }, {width, samples});
        for (const file of ["frontend/js/rule-result-common.js", "frontend/js/regression-diagnostics.js", "quick-edit/js/renderers.js"]) {
            await page.addScriptTag({path: path.join(root, file)});
        }
        const source = fs.readFileSync(path.join(root, "quick-edit/js/quick-edit.js"), "utf8");
        const bootstrap = 'window.addEventListener("DOMContentLoaded", init, { once: true });';
        assert.equal(source.split(bootstrap).length, 2, "the test only replaces the application bootstrap");
        await page.addScriptTag({content: source.replace(bootstrap, `window.legacyChartTest = {
            draw: drawContinuousDetailChart,
            bind: bindEvents,
            get: () => continuousDetail,
            set: (rows) => { continuousDetail = {...continuousDetail, rule: {TARGET_COLUMN: "VALUE"}, evaluatedRows: rows}; }
        };`)});
        await page.evaluate((rows) => {
            window.legacyChartTest.set(rows);
            window.legacyChartTest.bind();
            window.legacyChartTest.draw();
        }, samples);
        return {browser, page, errors};
    } catch (error) {await browser.close(); throw error;}
}

async function geometry(page) {
    return page.locator(canvasSelector).evaluate((canvas) => ({
        displayedWidth: canvas.getBoundingClientRect().width,
        drawingWidth: Number(canvas.dataset.chartWidth),
        pixels: canvas.width,
        ratio: Math.min(2, window.devicePixelRatio || 1)
    }));
}

async function nextPaint(page) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("legacy Quick chart uses its real CSS width at narrow sizes and high device pixel ratios", async () => {
    const {browser, page, errors} = await openChart({ratio: 2});
    try {
        const size = await geometry(page);
        assert.ok(Math.abs(size.drawingWidth - size.displayedWidth) <= 1, JSON.stringify(size));
        assert.ok(Math.abs(size.pixels - size.displayedWidth * size.ratio) <= 2, JSON.stringify(size));
        fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
        await page.locator("#fixture").screenshot({path: path.join(root, "test-results/legacy-quick-chart-narrow.png")});
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick keyboard selection keeps focus on the chart for consecutive arrow presses", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await page.locator(canvasSelector).focus();
        await page.keyboard.press("Home");
        await nextPaint(page);
        assert.equal(await page.evaluate(() => document.activeElement?.id), "qeContinuousDetailChart");
        await page.keyboard.press("ArrowRight");
        await nextPaint(page);
        await page.keyboard.press("ArrowRight");
        await nextPaint(page);
        assert.equal(await page.evaluate(() => window.legacyChartTest.get().selectedRowIndex), 2);
        assert.equal(await page.locator('tr[aria-selected="true"]').getAttribute("data-continuous-row-index"), "2");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "qeContinuousDetailChart");
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick chart redraws when only its container changes width", async () => {
    const {browser, page, errors} = await openChart({width: 850});
    try {
        const before = await geometry(page);
        fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
        await page.locator("#fixture").screenshot({path: path.join(root, "test-results/legacy-quick-chart-desktop.png")});
        await page.locator("#fixture").evaluate((element) => {element.style.width = "440px";});
        await page.waitForFunction((previousWidth) => Number(document.querySelector("#qeContinuousDetailChart").dataset.chartWidth) < previousWidth, before.drawingWidth);
        const after = await geometry(page);
        assert.ok(Math.abs(after.drawingWidth - after.displayedWidth) <= 1, JSON.stringify(after));
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick chart does not draw at zero width and resumes with restored container dimensions", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await nextPaint(page);
        const records = await page.evaluate(() => {
            const fixture = document.querySelector("#fixture");
            fixture.style.display = "none";
            window.drawRecords.length = 0;
            window.legacyChartTest.draw();
            return window.drawRecords;
        });
        assert.equal(records.filter((entry) => entry.method === "clearRect").length, 0);
        await page.locator("#fixture").evaluate((element) => {element.style.width = "640px"; element.style.display = "block";});
        await page.waitForFunction(() => {
            const canvas = document.querySelector("#qeContinuousDetailChart");
            return Math.abs(Number(canvas.dataset.chartWidth) - canvas.getBoundingClientRect().width) <= 1;
        });
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick narrow chart reserves all wrapped legend rows above the plot", async () => {
    const {browser, page, errors} = await openChart({width: 290});
    try {
        const drawn = await page.evaluate(() => {
            window.drawRecords.length = 0;
            window.legacyChartTest.draw();
            return window.drawRecords;
        });
        const labels = drawn.filter((entry) => entry.method === "fillText" && /^[●▲━┄]/u.test(entry.args[0]));
        assert.equal(labels.length, 5);
        const legendBottom = Math.max(...labels.map((entry) => entry.args[2] + Number.parseFloat(entry.font) / 2));
        const gridTop = Math.min(...drawn.filter((entry) => entry.method === "moveTo" && entry.strokeStyle === "#e7edf4").map((entry) => entry.args[1]));
        assert.ok(Number.isFinite(gridTop));
        assert.ok(legendBottom + 4 <= gridTop, `legend bottom ${legendBottom} overlaps plot top ${gridTop}`);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick point hit targets remain measured in visible CSS pixels", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const location = await page.evaluate(() => {
            const canvas = document.querySelector("#qeContinuousDetailChart");
            const rect = canvas.getBoundingClientRect();
            const point = window.legacyChartTest.get().chartPoints[3];
            return {x: rect.x + point.screenX * rect.width / Number(canvas.dataset.chartWidth), y: rect.y + point.screenY * rect.height / Number(canvas.dataset.chartHeight)};
        });
        await page.mouse.click(location.x + 11, location.y);
        await nextPaint(page);
        assert.equal(await page.evaluate(() => window.legacyChartTest.get().selectedRowIndex), 3);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick chart disconnects resize work on page hide and rebinds when restored", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await nextPaint(page);
        await page.evaluate(() => {
            window.drawRecords.length = 0;
            window.dispatchEvent(new Event("resize"));
            window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: true}));
            document.querySelector("#fixture").style.width = "620px";
        });
        // Exceed the production debounce: neither the queued timer nor the disconnected observer may draw.
        await page.waitForTimeout(240);
        assert.equal(await page.evaluate(() => window.drawRecords.filter((entry) => entry.method === "clearRect").length), 0);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true})));
        await page.waitForFunction(() => {
            const canvas = document.querySelector("#qeContinuousDetailChart");
            return Math.abs(Number(canvas.dataset.chartWidth) - canvas.getBoundingClientRect().width) <= 1;
        });
        await page.locator("#fixture").evaluate((element) => {element.style.width = "460px";});
        await page.waitForFunction(() => {
            const canvas = document.querySelector("#qeContinuousDetailChart");
            return Math.abs(Number(canvas.dataset.chartWidth) - canvas.getBoundingClientRect().width) <= 1;
        });
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick selected table rows support keyboard navigation without returning focus to the canvas", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await page.locator('tr[data-continuous-row-index="3"]').focus();
        await page.keyboard.press("Enter");
        await nextPaint(page);
        await page.keyboard.press("ArrowDown");
        await nextPaint(page);
        assert.equal(await page.evaluate(() => window.legacyChartTest.get().selectedRowIndex), 4);
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.continuousRowIndex), "4");
        await page.keyboard.press("End");
        await nextPaint(page);
        assert.equal(await page.evaluate(() => window.legacyChartTest.get().selectedRowIndex), 7);
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.continuousRowIndex), "7");
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick narrow chart keeps measured Y tick glyphs separate from its rotated axis title", async () => {
    const {browser, page, errors} = await openChart({ratio: 2});
    try {
        const drawn = await page.evaluate(() => {
            window.drawRecords.length = 0;
            window.legacyChartTest.draw();
            return window.drawRecords;
        });
        const title = drawn.find((entry) => entry.method === "fillText" && String(entry.args[0]).startsWith("예측값 ·"));
        assert.ok(title?.bounds);
        const ticks = drawn.filter((entry) => entry.method === "fillText" && entry.textAlign === "right" && /^-?\d/.test(entry.args[0]));
        assert.ok(ticks.length > 1);
        const nearestTickLeft = Math.min(...ticks.map((entry) => entry.bounds.left));
        assert.ok(nearestTickLeft >= title.bounds.right + 8, `Y tick text needs 4 CSS pixels of clearance from the axis title: ${nearestTickLeft - title.bounds.right} device pixels`);
        for (const tick of ticks) {
            const overlapX = Math.min(tick.bounds.right, title.bounds.right) - Math.max(tick.bounds.left, title.bounds.left);
            const overlapY = Math.min(tick.bounds.bottom, title.bounds.bottom) - Math.max(tick.bounds.top, title.bounds.top);
            assert.ok(overlapX <= 0 || overlapY <= 0, `Y tick ${tick.args[0]} overlaps its axis title by ${overlapX} × ${overlapY} device pixels`);
        }
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("legacy Quick empty and invalid samples clear stale accessible descriptions and point targets", async () => {
    const {browser, page, errors} = await openChart();
    try {
        for (const emptyRows of [[], [{rowIndex: 0, actual: "not-a-number", predicted: "invalid", residual: "invalid"}]]) {
            const oldPoint = await page.evaluate((rows) => {
                window.legacyChartTest.set(rows);
                window.legacyChartTest.draw();
                const canvas = document.querySelector("#qeContinuousDetailChart");
                const rect = canvas.getBoundingClientRect();
                const point = window.legacyChartTest.get().chartPoints[3];
                return {x: rect.x + point.screenX, y: rect.y + point.screenY};
            }, samples);
            assert.match(await page.locator(canvasSelector).getAttribute("aria-label"), /8개 표본/);
            await page.mouse.move(oldPoint.x, oldPoint.y);
            assert.match(await page.locator(canvasSelector).getAttribute("title"), /표본 4/);
            await page.evaluate((rows) => {
                window.legacyChartTest.set(rows);
                window.legacyChartTest.draw();
            }, emptyRows);
            assert.equal(await page.evaluate(() => window.legacyChartTest.get().chartPoints.length), 0);
            const label = await page.locator(canvasSelector).getAttribute("aria-label");
            assert.match(label, /샘플이 없습니다|표본이 없습니다/);
            assert.doesNotMatch(label, /8개 표본/);
            assert.equal(await page.locator(canvasSelector).getAttribute("title"), "");
            await page.mouse.click(oldPoint.x, oldPoint.y);
            await page.locator(canvasSelector).focus();
            await page.keyboard.press("End");
            await page.keyboard.press("ArrowRight");
            await nextPaint(page);
            assert.equal(await page.evaluate(() => window.legacyChartTest.get().selectedRowIndex), null);
            assert.equal(await page.locator('tr[aria-selected="true"]').count(), 0);
        }
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
