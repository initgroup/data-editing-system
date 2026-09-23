const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "../..");
const action = (name) => `[data-chart-action="${name}"]`;
const sample = () => ({
    rule: {ruleId: "R1", resultColumn: "TOTAL", conditionText: "B IS NOT NULL AND C IS NOT NULL", resultText: "TOTAL ≈ B + C (±2)", absoluteTolerance: 2, relativeTolerance: .01},
    source: "CURRENT_SOURCE", sampling: "FIRST_ROWS_BALANCED", scanLimit: 5000, sampleLimit: 300,
    scannedCount: 6, applicableCount: 6, plottableCount: 6, sampleCount: 6,
    skipped: {conditionFalse: 0, nullActual: 0, invalidActual: 0, nonFinitePrediction: 0},
    points: [10, 20, 30, 40, 50, 60].map((predicted, index) => ({
        rowId: `ROW_${index + 1}`, predicted, actual: predicted + (index === 3 ? 8 : 1), actualRaw: String(predicted + (index === 3 ? 8 : 1)),
        lower: predicted - 2, upper: predicted + 2, residual: index === 3 ? 8 : 1, violation: index === 3,
        values: {B: String(predicted - 4), C: "4"}
    }))
});

function fullSample() {
    const payload = sample();
    payload.rule.resultText = "TOTAL ≈ B + C (±max(2, 1% × expected))";
    payload.columnComments = {B: "Monthly base", C: "Additional amount", TOTAL: "Observed total"};
    payload.points = Array.from({length: 300}, (_, index) => {
        const predicted = 10 + index * 2, violation = index % 11 === 0, actual = predicted + (violation ? 12 : 1);
        const tolerance = Math.max(payload.rule.absoluteTolerance, payload.rule.relativeTolerance * Math.abs(predicted));
        return {rowId: `ROW_${index + 1}`, predicted, actual, actualRaw: String(actual), lower: predicted - tolerance, upper: predicted + tolerance,
            residual: violation ? 12 : 1, violation, values: {B: String(predicted - 4), C: index === 27 ? null : "4"}};
    });
    Object.assign(payload, {scannedCount: 5000, applicableCount: 4200, plottableCount: 4200, sampleCount: 300, scanLimitReached: true});
    return payload;
}

async function openChart(language = "en", width = 1100, options = {}) {
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width, height: 1100}});
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
    await page.route("**/*", (route) => route.abort());
    await page.setContent('<style>body{margin:0;padding:16px;font:14px Arial,sans-serif}#host{min-width:0}*{box-sizing:border-box}</style><div id="host"></div><div style="height:600px"></div>');
    await page.addStyleTag({path: path.join(root, "frontend/css/formula-rule-chart.css")});
    await page.addStyleTag({path: path.join(root, "frontend/css/rule-chart-controls.css")});
    await page.evaluate((language) => {
        window.I18nManager = {getSessionLanguage: () => language};
        window.selectedRows = [];
        window.outerEscapes = 0;
        document.addEventListener("keydown", (event) => {if (event.key === "Escape") window.outerEscapes += 1;});
    }, language);
    await page.addScriptTag({path: path.join(root, "frontend/js/regression-diagnostics.js")});
    await page.addScriptTag({path: path.join(root, "frontend/js/formula-rule-chart.js")});
    await page.evaluate(({payload, chartOptions}) => {
        window.payload = payload;
        window.chart = window.FormulaRuleChart.mount(document.querySelector("#host"), payload, {...chartOptions, onRowSelect: (row) => window.selectedRows.push(row.rowId)});
    }, {payload: options.payload || sample(), chartOptions: options.chartOptions || {}});
    return {browser, page, errors};
    } catch (error) {await browser.close(); throw error;}
}

async function zoom(page) {
    return Number.parseFloat(await page.locator("[data-zoom-level]").textContent());
}
async function center(page, index = 2) {
    return page.locator(`[data-point="${index}"]`).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    });
}
async function wheel(page, location, deltaY = -100) {
    return page.locator("[data-chart-svg]").evaluate((el, {location, deltaY}) => {
        const event = new WheelEvent("wheel", {clientX: location.x, clientY: location.y, deltaY, bubbles: true, cancelable: true});
        el.dispatchEvent(event);
        return event.defaultPrevented;
    }, {location, deltaY});
}
const nearly = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

test("formula toolbar applies bounded zoom and reset while preserving the selected row", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const original = await center(page);
        await page.locator('[data-point="2"]').click();
        assert.equal(await zoom(page), 100);
        await page.locator(action("zoom-in")).click();
        assert.ok(await zoom(page) > 100);
        const enlarged = await center(page);
        assert.notDeepEqual(enlarged, original);
        for (let count = 0; count < 25 && await zoom(page) < 800; count += 1) await page.locator(action("zoom-in")).click();
        assert.equal(await zoom(page), 800);
        for (let count = 0; count < 30 && await zoom(page) > 50; count += 1) await page.locator(action("zoom-out")).click();
        assert.equal(await zoom(page), 50);
        await page.locator(action("reset")).click();
        assert.equal(await zoom(page), 100);
        const reset = await center(page);
        nearly(reset.x, original.x); nearly(reset.y, original.y);
        assert.match(await page.locator('tr[aria-current="true"]').textContent(), /ROW_3/);
        assert.deepEqual(await page.evaluate(() => window.selectedRows), ["ROW_3"]);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula point picking tolerates near misses and small hand movement using displayed pixels", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const location = await center(page, 2);
        await page.mouse.click(location.x + 8, location.y + 2);
        assert.equal(await page.locator('tr[data-row="2"]').getAttribute("aria-current"), "true");
        const next = await center(page, 4);
        await page.mouse.move(next.x + 6, next.y);
        await page.mouse.down();
        await page.mouse.move(next.x + 9, next.y + 1);
        await page.mouse.up();
        assert.equal(await page.locator('tr[data-row="4"]').getAttribute("aria-current"), "true");
        assert.equal(await zoom(page), 100);
        assert.equal(await page.locator('.formula-chart__point[aria-pressed="true"]').count(), 1);
        await page.locator('#host').evaluate(el => {el.style.transform = 'scale(.7)'; el.style.transformOrigin = 'top left';});
        const scaled = await center(page, 1);
        await page.mouse.move(scaled.x + 8, scaled.y);
        assert.equal(await page.locator('[data-chart-tooltip]').isVisible(), true);
        assert.match(await page.locator('[data-chart-tooltip]').textContent(), /ROW_2/);
        await page.mouse.click(scaled.x + 8, scaled.y);
        assert.equal(await page.locator('tr[data-row="1"]').getAttribute("aria-current"), "true");
        assert.match(await page.locator('.formula-chart__selection').textContent(), /ROW_2/);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula plot has a visible four-sided frame and clicking a reference line does not block nearby samples", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const frame = page.locator('[data-plot-frame]');
        assert.equal(await frame.count(), 1);
        assert.equal(await frame.evaluate(el => getComputedStyle(el).fill), "none");
        assert.ok(await frame.evaluate(el => Number(getComputedStyle(el).strokeWidth.replace('px', '')) >= 1));
        const location = await center(page, 2);
        await page.mouse.click(location.x, location.y - 5);
        assert.equal(await page.locator('tr[data-row="2"]').getAttribute("aria-current"), "true");
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula wheel zoom stays anchored and disabled wheel scrolling leaves the view unchanged", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const anchored = await center(page);
        assert.equal(await page.locator(action("wheel")).getAttribute("aria-pressed"), "true");
        assert.equal(await wheel(page, anchored), true);
        assert.ok(await zoom(page) > 100);
        const after = await center(page);
        nearly(after.x, anchored.x); nearly(after.y, anchored.y);
        await page.locator(action("wheel")).click();
        assert.equal(await page.locator(action("wheel")).getAttribute("aria-pressed"), "false");
        const savedZoom = await zoom(page);
        assert.equal(await wheel(page, after), false);
        assert.equal(await zoom(page), savedZoom);
        assert.deepEqual(await center(page), after);
        await page.locator(action("wheel")).click();
        await wheel(page, after);
        assert.ok(await zoom(page) > savedZoom);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula drag pans without selecting a point and mode switching retains selected row details", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await page.locator('[data-point="1"]').click();
        const before = await center(page, 2);
        await page.mouse.move(before.x, before.y);
        await page.mouse.down();
        await page.mouse.move(before.x + 45, before.y + 25, {steps: 6});
        await page.mouse.up();
        const after = await center(page, 2);
        nearly(after.x - before.x, 45, 2); nearly(after.y - before.y, 25, 2);
        assert.deepEqual(await page.evaluate(() => window.selectedRows), ["ROW_2"]);
        await page.locator("[data-mode]").selectOption("residual");
        assert.match(await page.locator('tr[aria-current="true"]').textContent(), /ROW_2/);
        const selectedCells = await page.locator('tr[aria-current="true"] td').allTextContents();
        assert.ok(selectedCells.includes("16"));
        assert.ok(selectedCells.includes("4"));
        assert.equal(await page.locator(".formula-chart__point").count(), 6);
        assert.equal(await page.locator(".formula-chart__point.is-violation").count(), 1);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula legends toggle only their visual group and retain source counts and row selection", async () => {
    const {browser, page, errors} = await openChart();
    try {
        await page.locator('[data-point="1"]').click();
        const metrics = await page.locator(".formula-chart__metrics").textContent();
        let selectedRow = "ROW_2";
        for (const [group, selector] of [["normal", ".formula-chart__point.is-normal"], ["violation", ".formula-chart__point.is-violation"], ["bounds", ".formula-chart__boundary"], ["reference", ".formula-chart__reference"]]) {
            const toggle = page.locator(`[data-legend="${group}"]`);
            assert.equal(await toggle.getAttribute("aria-pressed"), "true");
            await toggle.click();
            assert.equal(await toggle.getAttribute("aria-pressed"), "false");
            assert.equal(await page.locator(selector).evaluateAll((elements) => elements.some((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none")), false);
            assert.equal(await page.locator(".formula-chart__metrics").textContent(), metrics);
            assert.match(await page.locator('tr[aria-current="true"]').textContent(), new RegExp(selectedRow));
            if (group === "normal") {
                assert.equal(await page.locator('[data-point="3"]').getAttribute("tabindex"), "0");
                await page.locator('[data-point="3"]').focus();
                for (const key of ["Home", "End", "ArrowRight"]) {
                    await page.keyboard.press(key);
                    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
                    assert.equal(await page.locator(".formula-chart__point.is-normal").evaluateAll((elements) => elements.some((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none")), false);
                    assert.equal(await page.locator('[data-point="3"]').getAttribute("tabindex"), "0");
                }
                selectedRow = "ROW_4";
                assert.match(await page.locator('tr[aria-current="true"]').textContent(), /ROW_4/);
            }
            await toggle.click();
            assert.equal(await page.locator(selector).first().isVisible(), true);
        }
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula maximize consumes one Escape and destroy restores scrolling and removes global controls", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const initialOverflow = await page.evaluate(() => document.body.style.overflow);
        await page.locator(action("maximize")).click();
        assert.equal(await page.locator(action("maximize")).getAttribute("aria-pressed"), "true");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(action("maximize")).getAttribute("aria-pressed"), "false");
        assert.equal(await page.evaluate(() => window.outerEscapes), 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), initialOverflow);
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => window.outerEscapes), 1);
        await page.locator(action("maximize")).click();
        await page.evaluate(() => {window.chart.destroy(); window.chart.destroy(); window.chart.update(window.payload);});
        assert.equal(await page.locator(".formula-chart").count(), 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), initialOverflow);
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => window.outerEscapes), 2);
        await page.evaluate(() => {window.chart = window.FormulaRuleChart.mount(document.querySelector("#host"), window.payload);});
        await page.locator(action("zoom-in")).click();
        assert.equal(await zoom(page), 125);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula toolbar is translated and remains usable without page overflow on narrow screens", async () => {
    for (const language of ["ko", "en"]) {
        const {browser, page, errors} = await openChart(language, 500);
        try {
            assert.equal(await page.locator(action("zoom-in")).getAttribute("aria-label"), language === "ko" ? "확대" : "Zoom in");
            assert.equal(await page.locator(action("zoom-out")).getAttribute("aria-label"), language === "ko" ? "축소" : "Zoom out");
            assert.equal(await page.locator(action("reset")).getAttribute("aria-label"), language === "ko" ? "보기 초기화" : "Reset view");
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            await page.locator(action("zoom-in")).click();
            assert.equal(await zoom(page), 125);
            await page.locator(action("maximize")).click();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            const tickPixels = await page.locator(".formula-chart__tick").first().evaluate((el) => {
                const matrix = el.getScreenCTM();
                return Number.parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b);
            });
            assert.ok(tickPixels >= 10, `narrow chart tick text is only ${tickPixels}px on screen`);
            fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
            await page.screenshot({path: path.join(root, `test-results/formula-toolbar-narrow-${language}.png`)});
            await page.keyboard.press("Escape");
            await page.locator(action("reset")).click();
            assert.equal(await zoom(page), 100);
            assert.deepEqual(errors, []);
        } finally {await browser.close();}
    }
});

test("formula sample grid shows every plotted row with inputs and links point and row selection in both directions", async () => {
    const {browser, page, errors} = await openChart("en", 1100, {payload: fullSample()});
    try {
        assert.equal(await page.locator(".formula-chart__table-wrap tbody tr").count(), 300);
        assert.equal(await page.locator("[data-page]").count(), 0);
        const heading = await page.locator(".formula-chart__table-wrap thead").textContent();
        assert.match(heading, /Monthly base/);
        assert.match(heading, /Additional amount/);
        assert.match(heading, /Observed total/);
        assert.match(heading, /Residual/);
        await page.locator('[data-point="220"]').click();
        const row = page.locator('tr[data-row="220"]');
        assert.equal(await row.getAttribute("aria-current"), "true");
        assert.match(await row.textContent(), /ROW_221/);
        const position = await row.evaluate((element) => {
            const rect = element.getBoundingClientRect(), wrap = element.closest(".formula-chart__table-wrap"), bounds = wrap.getBoundingClientRect();
            return {scrollTop: wrap.scrollTop, top: rect.top, bottom: rect.bottom, wrapTop: bounds.top, wrapBottom: bounds.bottom};
        });
        assert.ok(position.scrollTop > 0, "Selecting a distant point scrolls to its row without paging");
        assert.ok(position.top >= position.wrapTop && position.bottom <= position.wrapBottom + 1);
        assert.match(await page.locator('[data-point="220"]').getAttribute("class"), /is-selected/);
        assert.equal(await page.locator(".formula-chart__selected").count(), 1);
        await page.locator('tr[data-row="228"] td').last().click();
        assert.equal(await page.locator('tr[data-row="228"]').getAttribute("aria-current"), "true");
        assert.match(await page.locator('[data-point="228"]').getAttribute("class"), /is-selected/);
        assert.deepEqual(await page.evaluate(() => window.selectedRows), ["ROW_221", "ROW_229"]);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula row keyboard selection retains scroll and selection through display controls", async () => {
    const {browser, page, errors} = await openChart("ko", 1100, {payload: fullSample()});
    try {
        await page.locator('tr[data-row="200"]').focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowDown");
        assert.equal(await page.locator('tr[data-row="201"]').getAttribute("aria-current"), "true");
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-row")), "201");
        await page.keyboard.press("End");
        assert.equal(await page.locator('tr[data-row="299"]').getAttribute("aria-current"), "true");
        const scroll = await page.locator(".formula-chart__table-wrap").evaluate((el) => el.scrollTop);
        assert.ok(scroll > 0);
        await page.locator(action("zoom-in")).click();
        assert.equal(await page.locator(".formula-chart__table-wrap").evaluate((el) => el.scrollTop), scroll);
        await page.locator("[data-mode]").selectOption("residual");
        assert.equal(await page.locator('tr[data-row="299"]').getAttribute("aria-current"), "true");
        assert.equal(await page.locator(".formula-chart__table-wrap").evaluate((el) => el.scrollTop), scroll);
        await page.locator(action("maximize")).click();
        assert.equal(await page.locator('tr[data-row="299"]').getAttribute("aria-current"), "true");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator('tr[data-row="299"]').getAttribute("aria-current"), "true");
        await page.locator('tr[data-row="299"]').focus();
        await page.keyboard.press("Home");
        assert.equal(await page.locator('tr[data-row="0"]').getAttribute("aria-current"), "true");
        assert.ok(await page.locator(".formula-chart__table-wrap").evaluate((el) => el.scrollTop) < 50);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula labels and raw inputs remain text and copy preserves the saved expression", async () => {
    const payload = fullSample();
    const expression = 'TOTAL ≈ B + C; <img src=x onerror="window.untrustedRan=true">';
    payload.rule.resultText = expression;
    payload.columnComments.B = '<svg onload="window.untrustedRan=true">Input label</svg>';
    payload.points[0].values.B = '<img src=x onerror="window.untrustedRan=true">';
    const {browser, page, errors} = await openChart("en", 1100, {payload});
    try {
        assert.match(await page.locator(".formula-chart__expression").textContent(), /<img src=x/);
        assert.match(await page.locator(".formula-chart__table-wrap thead").textContent(), /<svg onload=/);
        assert.match(await page.locator('tr[data-row="0"]').textContent(), /<img src=x/);
        assert.equal(await page.locator("#host img, #host [onerror], #host [onload]").count(), 0);
        assert.equal(await page.evaluate(() => window.untrustedRan), undefined);
        await page.evaluate(() => {
            window.copiedExpressions = [];
            Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: async (text) => {window.copiedExpressions.push(text);}}});
        });
        await page.locator("[data-copy-formula]").click();
        assert.deepEqual(await page.evaluate(() => window.copiedExpressions), [expression]);
        await page.evaluate(() => {
            navigator.clipboard.writeText = async () => {throw new Error("Clipboard unavailable on HTTP");};
            document.execCommand = (command) => {if (command !== "copy") return false; window.copiedExpressions.push(document.activeElement.value); return true;};
        });
        await page.locator("[data-copy-formula]").click();
        assert.deepEqual(await page.evaluate(() => window.copiedExpressions), [expression, expression]);
        assert.equal(await page.locator("#host textarea").count(), 0);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula markers and outline appearance share the legacy chart palette while preserving rule classification", async () => {
    const {browser, page, errors} = await openChart();
    try {
        const styles = await page.evaluate(() => {
            const normalize = (value) => {const node = document.createElement("span"); node.style.color = value; document.body.appendChild(node); const color = getComputedStyle(node).color; node.remove(); return color;};
            const pointStyle = (selector) => {const element = document.querySelector(selector), style = getComputedStyle(element); return {fill: normalize(style.fill), stroke: normalize(style.stroke), tag: element.tagName};};
            const expected = window.RegressionDiagnostics.chartStyle;
            return {normal: pointStyle('.formula-chart__point.is-normal'), violation: pointStyle('.formula-chart__point.is-violation'),
                expectedNormal: {fill: normalize(expected.normal.fill), stroke: normalize(expected.normal.stroke), tag: "circle"},
                expectedViolation: {fill: normalize(expected.attention.fill), stroke: normalize(expected.attention.stroke), tag: "path"},
                boundary: normalize(getComputedStyle(document.querySelector('.formula-chart__boundary')).stroke), expectedBoundary: normalize(expected.tolerance.stroke)};
        });
        assert.deepEqual(styles.normal, styles.expectedNormal);
        assert.deepEqual(styles.violation, styles.expectedViolation);
        assert.equal(styles.boundary, styles.expectedBoundary);
        await page.locator('[data-point="3"]').click();
        assert.equal(await page.locator('[data-point="3"]').evaluate((element) => element.tagName), "path");
        assert.equal(await page.locator('[data-point="3"]').getAttribute("class").then((value) => value.includes("is-violation")), true);
        const selectedFill = await page.locator('[data-point="3"]').evaluate((element) => {
            const marker = getComputedStyle(element).fill, node = document.createElement("span");
            node.style.color = window.RegressionDiagnostics.pointStyle(true, true).fill;
            document.body.appendChild(node); const expected = getComputedStyle(node).color; node.remove();
            return {marker, expected};
        });
        assert.equal(selectedFill.marker, selectedFill.expected);
        assert.match(await page.locator('tr[aria-current="true"]').textContent(), /Violation/);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test("formula raw-data grid is localized and confines wide columns to its own scroll area", async () => {
    for (const language of ["ko", "en"]) {
        const {browser, page, errors} = await openChart(language, 1100, {payload: fullSample()});
        try {
            await page.locator('[data-point="220"]').click();
            fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
            await page.locator("#host").screenshot({path: path.join(root, `test-results/formula-grid-parity-${language}.png`)});
            await page.setViewportSize({width: 390, height: 1100});
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            const table = page.locator(".formula-chart__table-wrap");
            assert.equal(await table.evaluate((el) => el.scrollWidth > el.clientWidth), true);
            const headers = await table.locator("thead").textContent();
            assert.match(headers, language === "ko" ? /입력|인자/ : /input/i);
            assert.match(headers, language === "ko" ? /결과/ : /result/i);
            assert.match(headers, language === "ko" ? /잔차/ : /Residual/);
            assert.equal(await table.locator("th").first().evaluate((el) => getComputedStyle(el).position), "sticky");
            assert.equal(await table.locator("tbody td").first().evaluate((el) => getComputedStyle(el).position), "sticky");
            await table.evaluate((el) => {el.scrollLeft = 250;});
            await page.locator("[data-mode]").selectOption("residual");
            assert.equal(await table.evaluate((el) => el.scrollLeft), 250);
            assert.equal(await page.locator('tr[data-row="220"]').getAttribute("aria-current"), "true");
            const clippedTicks = await page.locator(".formula-chart__tick").evaluateAll((elements) => elements.filter((element) => {
                const rect = element.getBoundingClientRect(), bounds = element.ownerSVGElement.getBoundingClientRect();
                return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
            }).map((element) => element.textContent));
            assert.deepEqual(clippedTicks, [], "Numeric tick labels remain inside a narrow chart");
            await page.locator("#host").screenshot({path: path.join(root, `test-results/formula-grid-parity-mobile-${language}.png`)});
            assert.deepEqual(errors, []);
        } finally {await browser.close();}
    }
});

test("older formula samples infer inputs and reuse saved result comments without requiring new metadata", async () => {
    const payload = sample();
    payload.points[0].values.C = null;
    const {browser, page, errors} = await openChart("en", 1100, {payload, chartOptions: {
        columnComments: {B: "Saved input comment", TOTAL: "Saved result comment"}
    }});
    try {
        const heading = await page.locator(".formula-chart__table-wrap thead").textContent();
        assert.match(heading, /Saved input comment/);
        assert.match(heading, /Saved result comment/);
        assert.match(heading, /X input.*B.*X input.*C.*Y result.*TOTAL/);
        assert.match(await page.locator('tr[data-row="0"]').textContent(), /NULL/);
        await page.locator('[data-point="0"]').click();
        assert.equal(await page.locator('tr[data-row="0"]').getAttribute("aria-current"), "true");
        assert.equal(await page.locator(".formula-chart__table-wrap tbody tr").count(), 6);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
