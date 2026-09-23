(function (root) {
    "use strict";

    const ko = {
        "Formula application chart": "수식 적용 그래프",
        "Sample raw data": "표본 로우 데이터", "X input": "X 인자", "Y result": "Y 결과값",
        "Copy formula": "수식 복사", "Copied": "복사됨", "Copy failed": "복사하지 못했습니다",
        "Selected row": "선택 행", "Formula condition": "수식 적용 조건",
        "The tolerance bounds overlap the reference line at this scale. Use the residual plot to inspect small differences.": "현재 축척에서는 허용경계가 기준선과 겹칩니다. 작은 차이는 잔차 그래프에서 확인하세요.",
        "Expected vs actual": "기대값·실제값",
        "Residual plot": "잔차 그래프",
        "Chart type": "그래프 유형",
        "Actual vs predicted": "실제값 vs 예측값", "Residual vs predicted": "잔차 vs 예측값",
        "Predicted value": "예측값", "Graph type": "그래프 유형",
        "Zoom in": "확대", "Zoom out": "축소", "Reset view": "보기 초기화",
        "Disable mouse wheel zoom": "마우스 휠 확대·축소 해제", "Enable mouse wheel zoom": "마우스 휠 확대·축소 사용",
        "Maximize graph": "그래프 최대화", "Restore graph": "그래프 원상복구",
        "Drag to pan. Use the wheel or toolbar to zoom. Select a legend item to show or hide it.": "드래그로 이동하고 휠 또는 도구로 확대·축소합니다. 범례를 누르면 해당 항목을 표시하거나 숨깁니다.",
        "Expected value": "기대값", "Actual value": "실제값", "Residual": "잔차",
        "Within tolerance": "허용범위 이내", "Violation": "규칙 위반",
        "Saved tolerance bounds": "저장된 규칙의 허용경계",
        "Expected reference": "기대 기준선", "Row": "행 식별자", "Status": "판정",
        "Lower bound": "허용 하한", "Upper bound": "허용 상한",
        "Current source sample": "현재 원본 표본",
        "Scanned rows": "조회한 원본 행", "IF matches": "IF 조건 해당 행",
        "Plotted rows": "그래프 표시 행", "Displayed violations": "표시 표본 중 위반",
        "This chart evaluates the saved formula against current source data, not a historical data snapshot.": "저장된 수식을 현재 원본에 적용한 그래프입니다. 과거 실행 당시 데이터의 스냅숏이 아닙니다.",
        "Normal and violation points are sampled separately from a bounded source prefix. Their displayed ratio is not the overall violation rate.": "제한된 원본 앞부분에서 정상·위반을 나누어 표본을 선택합니다. 표시 점의 비율은 전체 위반률이 아닙니다.",
        "The outlines are saved rule tolerances, not 95% confidence or prediction intervals.": "경계선은 저장된 규칙의 허용오차이며, 95% 신뢰구간·예측구간이 아닙니다.",
        "Select a point to inspect its row. Arrow keys move between points.": "점을 선택하면 해당 행을 확인합니다. 방향키로 점 사이를 이동할 수 있습니다.",
        "Source scan limit": "원본 조회 상한", "Point limit": "표시 표본 상한",
        "More source rows may exist outside this bounded scan.": "조회 범위 밖에 추가 원본 행이 있을 수 있습니다.",
        "Only part of the numeric matching rows is displayed.": "조건에 해당하는 숫자 행 중 일부만 표시합니다.",
        "Evaluated at": "조회 시각",
        "Missing actual values": "실제값 결측", "Invalid numeric actual values": "실제값 숫자 변환 불가",
        "Unplottable predictions": "기대값 계산 불가", "Not plotted": "그래프 미표시",
        "Rows without numeric coordinates are excluded from the chart; they are not converted to zero.": "숫자 좌표를 계산할 수 없는 행은 그래프에서 제외하며 0으로 바꾸지 않습니다.",
        "No numeric points are available in this source sample.": "이 원본 표본에는 그래프로 표시할 숫자 좌표가 없습니다.",
        "Sample rows": "표본 행", "Previous": "이전", "Next": "다음", "Selected row inputs": "선택 행의 입력값",
        "Loading current source samples using the saved formula.": "저장된 수식으로 현재 원본 표본을 조회하고 있습니다.",
        "Could not load formula chart samples.": "수식 그래프 표본을 조회하지 못했습니다.",
        "The saved formula is evaluated against current source samples; no model is refitted.": "저장된 수식을 현재 원본 표본에 적용하며 모델을 다시 학습하지 않습니다."
    };
    function t(key, vars = {}) {
        let language = root.I18nManager?.getSessionLanguage?.();
        try { language ||= root.sessionStorage?.getItem("initLanguageCode"); } catch (_) { /* optional display preference */ }
        let value = String(language || "ko").toLowerCase().startsWith("en") ? key : (ko[key] || key);
        Object.entries(vars).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)); });
        return value;
    }
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const numeric = (value) => value != null && typeof value !== "boolean" && String(value).trim() !== "" && Number.isFinite(Number(value));
    function format(value) {
        if (!numeric(value)) return "-";
        const number = Number(value), magnitude = Math.abs(number);
        if (magnitude && (magnitude < .0001 || magnitude >= 1e9)) return number.toExponential(4);
        return number.toLocaleString(undefined, {maximumSignificantDigits: 7});
    }
    function extent(values) {
        let min = Math.min(...values), max = Math.max(...values);
        const span = max - min || Math.max(Math.abs(min) * .1, 1);
        min -= span * .06; max += span * .06;
        return [min, max];
    }
    function buildData(payload = {}, mode = "actual-predicted") {
        const source = Array.isArray(payload.points) ? payload.points : [];
        const points = source.filter((point) => [point.predicted, point.actual, point.lower, point.upper, point.residual].every(numeric)
            && typeof point.violation === "boolean")
            .map((point, index) => ({...point, index, predicted: Number(point.predicted), actual: Number(point.actual),
                lower: Number(point.lower), upper: Number(point.upper), residual: Number(point.residual),
                x: Number(mode === "residual" ? point.predicted : point.actual), y: Number(mode === "residual" ? point.residual : point.predicted)}));
        if (!points.length) return {points, bands: [], invalidPointCount: source.length, mode};
        let xRange = extent(points.map((point) => point.x));
        let yRange = extent(points.flatMap((point) => mode === "residual"
            ? [point.residual, point.lower - point.predicted, point.upper - point.predicted, 0]
            : [point.actual, point.lower, point.upper, point.predicted]));
        if (mode !== "residual") xRange = yRange = [Math.min(xRange[0], yRange[0]), Math.max(xRange[1], yRange[1])];
        const rule = payload.rule || {}, absolute = rule.absoluteTolerance, relative = rule.relativeTolerance;
        let bands;
        if (numeric(absolute) && Number(absolute) >= 0 && numeric(relative) && Number(relative) >= 0) {
            const anchors = [xRange[0], xRange[1], 0];
            if (Number(relative) > 0) anchors.push(Number(absolute) / Number(relative), -Number(absolute) / Number(relative));
            bands = [...new Set(anchors.filter((x) => Number.isFinite(x) && x >= xRange[0] && x <= xRange[1]))].sort((a, b) => a - b)
                .map((x) => { const tolerance = Math.max(Number(absolute), Number(relative) * Math.abs(x)), center = mode === "residual" ? 0 : x;
                    return {x, center, lower: center - tolerance, upper: center + tolerance}; });
        } else {
            bands = points.map((point) => ({x: point.predicted, center: mode === "residual" ? 0 : point.predicted,
                lower: point.lower - (mode === "residual" ? point.predicted : 0), upper: point.upper - (mode === "residual" ? point.predicted : 0)})).sort((a, b) => a.x - b.x);
        }
        if (mode === "residual") yRange = extent([0, ...points.map((point) => point.residual), ...bands.flatMap((band) => [band.lower, band.upper])]);
        if (![...xRange, ...yRange, ...bands.flatMap((b) => [b.x, b.lower, b.upper])].every(Number.isFinite)) {
            return {points: [], bands: [], invalidPointCount: source.length, mode};
        }
        return {points, bands, xRange, yRange, invalidPointCount: source.length - points.length, mode};
    }
    let chartSequence = 0;
    let restoreMaximized = null;
    const icons = {
        "zoom-in": '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
        "zoom-out": '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/>',
        wheel: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7"/>',
        reset: '<path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6"/>',
        maximize: '<path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/>',
        restore: '<path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6"/>'
    };
    function mount(container, initialPayload = {}, options = {}) {
        if (!container) throw new Error("A chart container is required.");
        let payload = initialPayload, mode = "actual-predicted", selected = null, destroyed = false;
        let view = null, zoomPercent = 100, wheelEnabled = true, pan = null, suppressClickUntil = 0;
        let maximized = false, placeholder = null, overflowBefore = "", focusBefore = null;
        let layoutKey = "";
        const visible = {normal: true, violation: true, bounds: true, reference: true};
        const box = {left: 90, right: 774, top: 22, bottom: 298};
        const document = container.ownerDocument;
        const measure = document.createElement("canvas").getContext("2d");
        const clipId = `formula-chart-clip-${++chartSequence}`;
        const translate = (key) => { const result = options.translate?.(key); return result && result !== key ? result : t(key); };
        const label = (key) => escape(translate(key));
        const appearance = root.RegressionDiagnostics?.chartStyle;
        const interaction = root.RegressionDiagnostics?.chartInteraction || {hitRadius: 14, dragThreshold: 6};
        function pointAppearance(point) {
            return root.RegressionDiagnostics?.pointStyle?.(point.violation, selected === point.index)
                || {shape: point.violation ? "triangle" : "circle", radius: selected === point.index ? 6 : point.violation ? 4 : 3,
                    fill: selected === point.index ? "#f59e0b" : point.violation ? "#dc2626" : "#2563eb",
                    stroke: selected === point.index ? "#b45309" : point.violation ? "#b91c1c" : "#2563eb", borderWidth: 1};
        }
        function columnHeader(name, role, comments) {
            return `<th scope="col" title="${escape([name, comments[name]].filter(Boolean).join(" · "))}"><div class="formula-chart__column-header"><span class="formula-chart__role ${role === "Y result" ? "is-result" : ""}">${label(role)}</span><b>${escape(name)}</b>${comments[name] ? `<small>${escape(comments[name])}</small>` : ""}</div></th>`;
        }
        function currentData() {
            const data = buildData(payload, mode);
            if (!data.points.length) return data;
            if (view) { data.xRange = view.xRange; data.yRange = view.yRange; }
            const absolute = payload.rule?.absoluteTolerance, relative = payload.rule?.relativeTolerance;
            if (numeric(absolute) && Number(absolute) >= 0 && numeric(relative) && Number(relative) >= 0) {
                const range = mode === "residual" ? data.xRange : data.yRange;
                const anchors = [range[0], range[1], 0];
                if (Number(relative) > 0) anchors.push(Number(absolute) / Number(relative), -Number(absolute) / Number(relative));
                data.bands = [...new Set(anchors.filter((x) => Number.isFinite(x) && x >= range[0] && x <= range[1]))].sort((a, b) => a - b)
                    .map((x) => { const tolerance = Math.max(Number(absolute), Number(relative) * Math.abs(x)), center = mode === "residual" ? 0 : x;
                        return {x, center, lower: center - tolerance, upper: center + tolerance}; });
            }
            return data;
        }
        function tool(action, key, disabled = false, pressed = null) {
            return `<button type="button" data-chart-action="${action}" title="${label(key)}" aria-label="${label(key)}" ${disabled ? "disabled" : ""} ${pressed == null ? "" : `aria-pressed="${pressed}"`}><svg viewBox="0 0 24 24" aria-hidden="true">${icons[action === "maximize" && maximized ? "restore" : action]}</svg></button>`;
        }
        function render() {
            if (destroyed) return;
            const viewport = document.defaultView;
            const width = Math.max(240, container.clientWidth - (viewport.innerWidth <= 600 ? 18 : 26));
            const height = Math.round(maximized ? Math.max(340, Math.min(850, viewport.innerHeight * .58)) : Math.max(280, Math.min(440, viewport.innerHeight * .38)));
            layoutKey = `${container.clientWidth}:${viewport.innerHeight}`;
            Object.assign(box, {left: width < 600 ? 68 : 90, right: width - 26, top: 22, bottom: height - 60});
            const active = container.contains(document.activeElement) ? document.activeElement : null;
            const focusAttr = ["data-chart-action", "data-mode", "data-legend", "data-point", "data-row", "data-copy-formula", "data-chart-svg"].find((key) => active?.hasAttribute?.(key));
            const focusValue = focusAttr ? active.getAttribute(focusAttr) : null;
            const oldGrid = container.querySelector(".formula-chart__table-wrap");
            const gridScroll = {top: oldGrid?.scrollTop || 0, left: oldGrid?.scrollLeft || 0};
            const data = currentData(), points = data.points;
            const tickCount = width < 600 ? 4 : 6;
            const tickFormat = (value) => {
                const number = Number(value);
                const text = number.toLocaleString(undefined, {maximumSignificantDigits: width < 600 ? 5 : 7});
                return text.length > (width < 600 ? 9 : 12) ? number.toExponential(width < 600 ? 2 : 4) : text;
            };
            if (points.length && measure) {
                measure.font = `${viewport.innerWidth <= 600 ? 13 : 11}px ${viewport.getComputedStyle(container).fontFamily}`;
                const ticks = Array.from({length: tickCount}, (_, index) => data.yRange[0] + index / (tickCount - 1) * (data.yRange[1] - data.yRange[0]));
                box.left = Math.max(box.left, Math.ceil(Math.max(...ticks.map(value => measure.measureText(tickFormat(value)).width))) + 38);
                box.right = width - Math.max(26, Math.ceil(measure.measureText(tickFormat(data.xRange[1])).width / 2) + 3);
            }
            const comments = {...options.columnComments, ...payload.columnComments};
            const targetColumn = String(payload.rule?.resultColumn || "");
            const inputColumns = [...new Set([...(Array.isArray(payload.inputColumns) ? payload.inputColumns : []), ...points.flatMap(point => Object.keys(point.values || {}))])].filter(name => name !== targetColumn);
            const skipped = payload.skipped || {};
            const omitted = [
                ["Missing actual values", skipped.nullActual], ["Invalid numeric actual values", skipped.invalidActual],
                ["Unplottable predictions", Number(skipped.nonFinitePrediction || 0) + data.invalidPointCount]
            ].filter(([, value]) => Number(value) > 0);
            let chart = `<p class="formula-chart__empty">${label("No numeric points are available in this source sample.")}</p>`;
            if (points.length) {
                const mapX = (x) => box.left + (x - data.xRange[0]) / (data.xRange[1] - data.xRange[0]) * (box.right - box.left);
                const mapY = (y) => box.bottom - (y - data.yRange[0]) / (data.yRange[1] - data.yRange[0]) * (box.bottom - box.top);
                const xy = (x, y) => `${mapX(x).toFixed(3)},${mapY(y).toFixed(3)}`;
                // The saved tolerance is parameterized by prediction. Transpose the complete
                // geometry for actual-X / predicted-Y; do not recompute a band around actual.
                const bandXY = (band, key) => mode === "residual" ? xy(band.x, band[key]) : xy(band[key], band.x);
                const line = (key) => data.bands.map((band) => bandXY(band, key)).join(" ");
                const grid = Array.from({length: tickCount}, (_, index) => {
                    const fraction = index / (tickCount - 1), x = data.xRange[0] + fraction * (data.xRange[1] - data.xRange[0]), y = data.yRange[0] + fraction * (data.yRange[1] - data.yRange[0]);
                    return `<line class="formula-chart__grid" x1="${mapX(x)}" y1="${box.top}" x2="${mapX(x)}" y2="${box.bottom}"/><text class="formula-chart__tick" x="${mapX(x)}" y="${box.bottom + 20}" text-anchor="middle">${escape(tickFormat(x))}</text>
                        <line class="formula-chart__grid" x1="${box.left}" y1="${mapY(y)}" x2="${box.right}" y2="${mapY(y)}"/><text class="formula-chart__tick" x="${box.left - 10}" y="${mapY(y) + 4}" text-anchor="end">${escape(tickFormat(y))}</text>`;
                }).join("");
                const shownPoints = points.filter((point) => visible[point.violation ? "violation" : "normal"]);
                const tabPoint = shownPoints.some((point) => point.index === selected) ? selected : shownPoints[0]?.index;
                const marks = shownPoints
                    .sort((a, b) => Number(a.index === selected) - Number(b.index === selected) || Number(a.violation) - Number(b.violation)).map((point) => {
                    const x = mapX(point.x), y = mapY(point.y), title = `${translate("Row")}: ${point.rowId ?? point.index + 1}; ${translate("Expected value")}: ${format(point.predicted)}; ${translate("Actual value")}: ${format(point.actual)}; ${translate("Residual")}: ${format(point.residual)}; ${translate(point.violation ? "Violation" : "Within tolerance")}`;
                    const style = pointAppearance(point), radius = style.radius;
                    const attributes = `data-point="${point.index}" class="formula-chart__point ${point.violation ? "is-violation" : "is-normal"}${selected === point.index ? " is-selected formula-chart__selected" : ""}" style="fill:${style.fill};stroke:${style.stroke};stroke-width:${style.borderWidth}" role="button" tabindex="${tabPoint === point.index ? 0 : -1}" aria-pressed="${selected === point.index}" aria-label="${escape(title)}"`;
                    return style.shape === "triangle" ? `<path ${attributes} d="M ${x} ${y - radius} L ${x + radius * .866} ${y + radius * .5} L ${x - radius * .866} ${y + radius * .5} Z"><title>${escape(title)}</title></path>`
                        : `<circle ${attributes} cx="${x}" cy="${y}" r="${radius}"><title>${escape(title)}</title></circle>`;
                }).join("");
                chart = `<svg data-chart-svg tabindex="0" viewBox="0 0 ${width} ${height}" role="group" aria-label="${label(mode === "residual" ? "Residual vs predicted" : "Actual vs predicted")}">
                    <defs><clipPath id="${clipId}"><rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}"/></clipPath></defs>
                    ${grid}<g clip-path="url(#${clipId})">${visible.bounds ? `<polygon class="formula-chart__band" points="${line("lower")} ${data.bands.slice().reverse().map((b) => bandXY(b, "upper")).join(" ")}"/>
                    <polyline class="formula-chart__boundary" points="${line("lower")}"/><polyline class="formula-chart__boundary" points="${line("upper")}"/>` : ""}
                    ${visible.reference ? `<polyline class="formula-chart__reference" points="${line("center")}"/>` : ""}${marks}</g>
                    <rect data-plot-frame class="formula-chart__frame" x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}"/>
                    <text class="formula-chart__axis" x="${(box.left + box.right) / 2}" y="${height - 12}" text-anchor="middle">${label(mode === "residual" ? "Predicted value" : "Actual value")}</text>
                    <text class="formula-chart__axis" transform="translate(16 ${(box.top + box.bottom) / 2}) rotate(-90)" text-anchor="middle">${label(mode === "residual" ? "Residual" : "Predicted value")}</text></svg>`;
            }
            const chosen = points.find((point) => point.index === selected);
            const rows = points.map((point) => `<tr data-row="${point.index}" tabindex="${(selected ?? 0) === point.index ? 0 : -1}" class="${selected === point.index ? "is-selected" : ""}" ${selected === point.index ? 'aria-current="true"' : ""}>
                <td>${point.index + 1}</td><td>${escape(point.rowId ?? point.index + 1)}</td>
                ${inputColumns.map(name => `<td>${escape(point.values?.[name] ?? "NULL")}</td>`).join("")}
                <td>${escape(point.actualRaw ?? format(point.actual))}</td><td>${escape(format(point.predicted))}</td><td>${escape(format(point.residual))}</td><td>${escape(format(point.lower))}</td><td>${escape(format(point.upper))}</td>
                <td class="${point.violation ? "is-violation" : ""}">${label(point.violation ? "Violation" : "Within tolerance")}</td></tr>`).join("");
            const boundsOverlap = points.length && data.bands.every(band => Math.abs(band.upper - band.lower) / (data.yRange[1] - data.yRange[0]) * (box.bottom - box.top) < 2);
            container.innerHTML = `<section class="formula-chart">
                <header class="formula-chart__header"><div><strong>${label("Formula application chart")}${payload.rule?.resultColumn ? ` · ${escape(payload.rule.resultColumn)}` : ""}</strong><small>${label("Current source sample")}</small></div></header>
                ${payload.rule?.resultText ? `<div class="formula-chart__expression rule-chart-formula-banner"><span class="rule-chart-formula-label">F(X) = Y</span><div class="rule-chart-formula-text"><strong class="rule-chart-formula-expression">${escape(payload.rule.resultText)}</strong></div><button type="button" class="rule-chart-formula-copy" data-copy-formula title="${label("Copy formula")}" aria-label="${label("Copy formula")}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/></svg></button><span class="formula-chart__copy-status rule-chart-formula-copy-status" aria-live="polite"></span></div>` : ""}
                ${payload.rule?.conditionText ? `<div class="formula-chart__condition"><b>IF</b> ${escape(payload.rule.conditionText)}</div>` : ""}
                <div class="formula-chart__metrics">${[["Scanned rows", payload.scannedCount], ["IF matches", payload.applicableCount], ["Plotted rows", points.length], ["Displayed violations", points.filter((p) => p.violation).length]].map(([key, value]) => `<div><span>${label(key)}</span><strong>${escape(format(value))}</strong></div>`).join("")}</div>
                <div class="rule-chart-toolbar" role="group" aria-label="${label("Formula application chart")}">
                    <label><span>${label("Graph type")}</span><select data-mode aria-label="${label("Chart type")}"><option value="actual-predicted" ${mode === "actual-predicted" ? "selected" : ""}>${label("Actual vs predicted")}</option><option value="residual" ${mode === "residual" ? "selected" : ""}>${label("Residual vs predicted")}</option></select></label>
                    <div class="rule-chart-tools">${tool("zoom-in", "Zoom in", !points.length || zoomPercent >= 800)}${tool("zoom-out", "Zoom out", !points.length || zoomPercent <= 50)}${tool("wheel", wheelEnabled ? "Disable mouse wheel zoom" : "Enable mouse wheel zoom", !points.length, wheelEnabled)}${tool("reset", "Reset view", !points.length)}${tool("maximize", maximized ? "Restore graph" : "Maximize graph", false, maximized)}<em data-zoom-level aria-live="polite">${Math.round(zoomPercent)}%</em></div>
                </div>
                <div class="formula-chart__plot">${chart}<div data-chart-tooltip class="formula-chart__tooltip" hidden></div></div>
                <div class="formula-chart__legend">${[["normal", "Within tolerance", '<i class="is-normal">●</i>'], ["violation", "Violation", '<i class="is-violation">▲</i>'], ["bounds", "Saved tolerance bounds", '<i class="formula-chart__key-boundary"></i>'], ["reference", "Expected reference", '<i class="formula-chart__key-reference"></i>']]
                    .map(([key, text, icon]) => `<button type="button" data-legend="${key}" aria-pressed="${visible[key]}">${icon} ${label(text)}${["normal", "violation"].includes(key) ? ` (${points.filter(point => point.violation === (key === "violation")).length})` : ""}</button>`).join("")}</div>
                ${chosen ? `<p class="formula-chart__selection" role="status">${label("Selected row")}: <b>${escape(chosen.rowId ?? chosen.index + 1)}</b> · ${label("Actual value")}: ${escape(chosen.actualRaw ?? format(chosen.actual))} · ${label("Expected value")}: ${escape(format(chosen.predicted))} · ${label("Residual")}: ${escape(format(chosen.residual))}</p>` : ""}
                <p class="formula-chart__hint">${label("Drag to pan. Use the wheel or toolbar to zoom. Select a legend item to show or hide it.")} ${label("Select a point to inspect its row. Arrow keys move between points.")}<br>${label("The outlines are saved rule tolerances, not 95% confidence or prediction intervals.")}</p>
                ${boundsOverlap && visible.bounds ? `<p class="formula-chart__hint">${label("The tolerance bounds overlap the reference line at this scale. Use the residual plot to inspect small differences.")}</p>` : ""}
                ${points.length ? `<div class="formula-chart__table-title"><strong>${label("Sample raw data")}</strong><span>${label("Plotted rows")}: ${points.length}${chosen ? ` · ${label("Selected row")}: ${escape(chosen.rowId ?? chosen.index + 1)}` : ""}</span></div>
                    <div class="formula-chart__table-wrap"><table aria-label="${label("Sample raw data")}"><thead><tr><th scope="col">No</th><th scope="col">${escape(payload.rowIdColumn || translate("Row"))}</th>${inputColumns.map(name => columnHeader(name, "X input", comments)).join("")}${targetColumn ? columnHeader(targetColumn, "Y result", comments) : `<th scope="col">${label("Actual value")}</th>`}${["Expected value", "Residual", "Lower bound", "Upper bound", "Status"].map(key => `<th scope="col">${label(key)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : ""}
                <p class="formula-chart__notice">${label("This chart evaluates the saved formula against current source data, not a historical data snapshot.")} ${label("Normal and violation points are sampled separately from a bounded source prefix. Their displayed ratio is not the overall violation rate.")}</p>
                ${omitted.length ? `<div class="formula-chart__omitted">${label("Not plotted")}: ${omitted.map(([key, count]) => `${label(key)} ${escape(format(count))}`).join(" · ")}<br>${label("Rows without numeric coordinates are excluded from the chart; they are not converted to zero.")}</div>` : ""}
                <p class="formula-chart__limits">${label("Source scan limit")}: ${escape(format(payload.scanLimit))} · ${label("Point limit")}: ${escape(format(payload.sampleLimit))}${Number(payload.plottableCount) > points.length ? ` · ${label("Only part of the numeric matching rows is displayed.")}` : ""}${payload.scanLimitReached ? ` · ${label("More source rows may exist outside this bounded scan.")}` : ""}${payload.evaluatedAt ? ` · ${label("Evaluated at")}: ${escape(payload.evaluatedAt)}` : ""}</p>
            </section>`;
            if (appearance) {
                const section = container.querySelector(".formula-chart");
                for (const [key, value] of Object.entries({"boundary-color": appearance.tolerance.stroke, "boundary-fill": appearance.tolerance.fill,
                    "boundary-width": appearance.tolerance.width, "boundary-dash": appearance.tolerance.dash.join(" "),
                    "reference-color": appearance.reference.stroke, "reference-width": appearance.reference.width, "reference-dash": appearance.reference.dash.join(" "),
                    "frame-color": appearance.plotFrame?.stroke || "#94a3b8", "frame-width": appearance.plotFrame?.width || 1})) {
                    section.style.setProperty(`--formula-${key}`, value);
                }
            }
            const newGrid = container.querySelector(".formula-chart__table-wrap");
            if (newGrid) { newGrid.scrollTop = gridScroll.top; newGrid.scrollLeft = gridScroll.left; }
            if (focusAttr && !pan) [...container.querySelectorAll(`[${focusAttr}]`)].find((element) => element.getAttribute(focusAttr) === focusValue)?.focus?.({preventScroll: true});
        }
        function select(index, focusPoint = false) {
            const data = buildData(payload, mode), point = data.points[index];
            if (!point) return;
            visible[point.violation ? "violation" : "normal"] = true;
            if (view) {
                for (const [axis, value] of [["xRange", point.x], ["yRange", point.y]]) {
                    if (value < view[axis][0] || value > view[axis][1]) {
                        const half = (view[axis][1] - view[axis][0]) / 2;
                        view[axis] = [value - half, value + half];
                    }
                }
            }
            selected = index; render();
            container.querySelector(`[${focusPoint ? "data-point" : "data-row"}="${index}"]`)?.focus?.({preventScroll: true});
            // Scroll only the grid. Scrolling all ancestors would hide the graph
            // that the user just selected in a popup or the Quick Edit page.
            const row = container.querySelector(`[data-row="${index}"]`), grid = row?.closest(".formula-chart__table-wrap");
            if (row && grid) {
                const rowRect = row.getBoundingClientRect(), gridRect = grid.getBoundingClientRect();
                const top = gridRect.top + grid.querySelector("thead").getBoundingClientRect().height;
                if (rowRect.top < top) grid.scrollTop += rowRect.top - top;
                else if (rowRect.bottom > gridRect.top + grid.clientHeight) grid.scrollTop += rowRect.bottom - gridRect.top - grid.clientHeight;
            }
            options.onRowSelect?.(point);
        }
        function zoom(factor, anchor = null) {
            const data = currentData();
            if (!data.points.length || !Number.isFinite(factor) || factor <= 0) return;
            const next = Math.max(50, Math.min(800, zoomPercent * factor)), scale = zoomPercent / next;
            if (next === zoomPercent) return;
            const ranges = {};
            for (const [axis, fraction] of [["xRange", anchor?.x ?? .5], ["yRange", anchor?.y ?? .5]]) {
                const range = data[axis], center = range[0] + fraction * (range[1] - range[0]);
                ranges[axis] = range.map((value) => center + (value - center) * scale);
            }
            if (!Object.values(ranges).every((range) => range.every(Number.isFinite) && range[1] > range[0])) return;
            view = ranges; zoomPercent = next; render();
        }
        function resetView() { view = null; zoomPercent = 100; render(); }
        function position(event) {
            const svg = container.querySelector("[data-chart-svg]"), matrix = svg?.getScreenCTM?.();
            if (!matrix) return null;
            const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
            const local = point.matrixTransform(matrix.inverse());
            return {x: (local.x - box.left) / (box.right - box.left), y: (box.bottom - local.y) / (box.bottom - box.top)};
        }
        function findPoint(event) {
            const svg = container.querySelector("[data-chart-svg]"), matrix = svg?.getScreenCTM?.();
            const anchor = position(event), data = currentData();
            if (!matrix || !data.points.length || !anchor || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) return null;
            let nearest = null, distance = interaction.hitRadius;
            const coordinate = svg.createSVGPoint();
            for (const point of data.points) {
                if (!visible[point.violation ? "violation" : "normal"] || point.x < data.xRange[0] || point.x > data.xRange[1] || point.y < data.yRange[0] || point.y > data.yRange[1]) continue;
                coordinate.x = box.left + (point.x - data.xRange[0]) / (data.xRange[1] - data.xRange[0]) * (box.right - box.left);
                coordinate.y = box.bottom - (point.y - data.yRange[0]) / (data.yRange[1] - data.yRange[0]) * (box.bottom - box.top);
                const screen = coordinate.matrixTransform(matrix);
                const candidate = Math.hypot(screen.x - event.clientX, screen.y - event.clientY);
                if (candidate < distance) { nearest = point; distance = candidate; }
            }
            return nearest;
        }
        function showHover(event = null) {
            const point = event?.target.closest?.("[data-chart-svg]") ? findPoint(event) : null;
            const svg = container.querySelector("[data-chart-svg]"), tooltip = container.querySelector("[data-chart-tooltip]");
            if (svg) svg.style.cursor = point ? "pointer" : "";
            if (!tooltip) return;
            tooltip.hidden = !point;
            if (!point) return;
            tooltip.textContent = container.querySelector(`[data-point="${point.index}"]`)?.getAttribute("aria-label") || "";
            const rect = tooltip.parentElement.getBoundingClientRect();
            tooltip.style.left = `${Math.max(0, Math.min(event.clientX - rect.left + 12, rect.width - tooltip.offsetWidth - 4))}px`;
            tooltip.style.top = `${Math.max(0, Math.min(event.clientY - rect.top + 12, rect.height - tooltip.offsetHeight - 4))}px`;
        }
        function onWheel(event) {
            if (!wheelEnabled || pan || !event.target.closest?.("[data-chart-svg]")) return;
            const anchor = position(event);
            if (!anchor || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1 || !event.deltaY) return;
            event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, anchor);
        }
        function startPan(event) {
            if (event.button !== 0 || pan || !event.target.closest?.("[data-chart-svg]")) return;
            const anchor = position(event), data = currentData();
            if (!anchor || !data.points.length || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) return;
            const point = findPoint(event);
            showHover();
            pan = {pointerId: event.pointerId, anchor, x: event.clientX, y: event.clientY, moved: false,
                ranges: {xRange: [...data.xRange], yRange: [...data.yRange]}, point: point?.index ?? null};
            container.setPointerCapture?.(event.pointerId);
        }
        function movePan(event) {
            if (!pan) { showHover(event); return; }
            if (pan.pointerId !== event.pointerId) return;
            if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < interaction.dragThreshold && !pan.moved) return;
            const anchor = position(event);
            if (!anchor) return;
            event.preventDefault(); pan.moved = true;
            const ranges = {};
            for (const [axis, fraction] of [["xRange", anchor.x - pan.anchor.x], ["yRange", anchor.y - pan.anchor.y]]) {
                const range = pan.ranges[axis], offset = fraction * (range[1] - range[0]);
                ranges[axis] = [range[0] - offset, range[1] - offset];
            }
            if (Object.values(ranges).every((range) => range.every(Number.isFinite) && range[1] > range[0])) view = ranges;
            container.classList.add("is-panning"); render();
        }
        function stopPan(event = null, cancelled = false) {
            if (!pan || event && pan.pointerId !== event.pointerId) return;
            const finished = pan; pan = null;
            if (container.hasPointerCapture?.(finished.pointerId)) container.releasePointerCapture?.(finished.pointerId);
            container.classList.remove("is-panning");
            suppressClickUntil = Date.now() + 180;
            if (!cancelled && !finished.moved && finished.point != null) select(finished.point, true);
        }
        function maximize(force) {
            const next = typeof force === "boolean" ? force : !maximized;
            if (next === maximized || destroyed) return;
            stopPan(null, true);
            if (next) {
                restoreMaximized?.();
                focusBefore = document.activeElement;
                placeholder = document.createComment("formula chart position");
                container.before(placeholder);
                overflowBefore = document.body.style.overflow;
                document.body.style.overflow = "hidden";
                document.body.appendChild(container);
                maximized = true; restoreMaximized = () => maximize(false);
            } else {
                maximized = false; restoreMaximized = null;
                document.body.style.overflow = overflowBefore;
                if (placeholder?.parentNode) placeholder.replaceWith(container);
                placeholder = null;
            }
            container.classList.toggle("is-formula-chart-maximized", maximized);
            render();
            if (maximized) container.querySelector('[data-chart-action="maximize"]')?.focus?.({preventScroll: true});
            else if (focusBefore?.isConnected) focusBefore.focus?.({preventScroll: true});
            else container.querySelector('[data-chart-action="maximize"]')?.focus?.({preventScroll: true});
        }
        function onDocumentKey(event) {
            if (!maximized) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); maximize(false); }
            else if (event.key === "Tab") {
                const items = [...container.querySelectorAll('button:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter((element) => element.getClientRects().length);
                const first = items[0], last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
            }
        }
        function onClick(event) {
            const copy = event.target.closest?.("[data-copy-formula]");
            if (copy) { copyFormula(copy); return; }
            const action = event.target.closest?.("[data-chart-action]"), legend = event.target.closest?.("[data-legend]");
            if (action && !action.disabled) {
                const key = action.getAttribute("data-chart-action");
                if (key === "zoom-in") zoom(1.25);
                else if (key === "zoom-out") zoom(.8);
                else if (key === "reset") resetView();
                else if (key === "wheel") { wheelEnabled = !wheelEnabled; render(); }
                else if (key === "maximize") maximize();
                return;
            }
            if (legend) { const key = legend.getAttribute("data-legend"); if (Object.hasOwn(visible, key)) { visible[key] = !visible[key]; render(); } return; }
            const point = event.target.closest?.("[data-point]"), row = event.target.closest?.("[data-row]");
            const svg = event.target.closest?.("[data-chart-svg]");
            if (svg && Date.now() < suppressClickUntil) return;
            if (point) select(Number(point.getAttribute("data-point")), true);
            else if (row) select(Number(row.getAttribute("data-row")));
            else if (svg) { const nearest = findPoint(event); if (nearest) select(nearest.index, true); }
        }
        async function copyFormula(button) {
            const text = String(payload.rule?.resultText || "");
            let copied = false;
            try { await root.navigator.clipboard.writeText(text); copied = true; } catch (_) {
                const input = document.createElement("textarea");
                input.value = text; input.style.cssText = "position:fixed;left:-9999px;top:0";
                container.appendChild(input); input.select();
                try { copied = document.execCommand("copy"); } catch (_) { /* report copy failure */ }
                input.remove(); button?.focus?.({preventScroll: true});
            }
            if (!destroyed && button.isConnected) container.querySelector(".formula-chart__copy-status").textContent = translate(copied ? "Copied" : "Copy failed");
        }
        function setMode(next) { stopPan(null, true); mode = next === "residual" ? "residual" : "actual-predicted"; view = null; zoomPercent = 100; render(); }
        function onChange(event) { if (event.target.matches?.("[data-mode]")) setMode(event.target.value); }
        function onKey(event) {
            if (event.target.matches?.("[data-chart-svg]")) {
                if (["+", "="].includes(event.key)) { event.preventDefault(); zoom(1.25); }
                else if (event.key === "-") { event.preventDefault(); zoom(.8); }
                else if (event.key === "0") { event.preventDefault(); resetView(); }
                return;
            }
            const row = event.target.closest?.("[data-row]"), point = event.target.closest?.("[data-point]");
            if (!row && !point) return;
            const shownPoints = buildData(payload, mode).points.filter((point) => row || visible[point.violation ? "violation" : "normal"]);
            const current = shownPoints.findIndex((item) => item.index === Number((row || point).getAttribute(row ? "data-row" : "data-point")));
            if (current < 0) return;
            let next = current;
            if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = Math.max(0, current - 1);
            else if (["ArrowRight", "ArrowDown"].includes(event.key)) next = Math.min(shownPoints.length - 1, current + 1);
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = shownPoints.length - 1;
            else if (!["Enter", " "].includes(event.key)) return;
            event.preventDefault(); select(shownPoints[next].index, !row);
        }
        container.addEventListener("click", onClick); container.addEventListener("change", onChange); container.addEventListener("keydown", onKey);
        container.addEventListener("wheel", onWheel, {passive: false});
        container.addEventListener("pointerdown", startPan); container.addEventListener("pointermove", movePan);
        const onPointerLeave = () => showHover();
        container.addEventListener("pointerleave", onPointerLeave);
        const onPointerUp = (event) => stopPan(event), onPointerCancel = (event) => stopPan(event, true);
        container.addEventListener("pointerup", onPointerUp); container.addEventListener("pointercancel", onPointerCancel); container.addEventListener("lostpointercapture", onPointerCancel);
        document.addEventListener("keydown", onDocumentKey, true);
        const onResize = () => {
            if (!destroyed && layoutKey !== `${container.clientWidth}:${document.defaultView.innerHeight}`) {
                stopPan(null, true); render();
            }
        };
        const observer = typeof root.ResizeObserver === "function" ? new root.ResizeObserver(onResize) : null;
        observer?.observe(container);
        document.defaultView.addEventListener("resize", onResize);
        render();
        return {
            destroy() {
                if (destroyed) return;
                stopPan(null, true); if (maximized) maximize(false); destroyed = true;
                container.removeEventListener("click", onClick); container.removeEventListener("change", onChange); container.removeEventListener("keydown", onKey);
                container.removeEventListener("wheel", onWheel); container.removeEventListener("pointerdown", startPan); container.removeEventListener("pointermove", movePan);
                container.removeEventListener("pointerup", onPointerUp); container.removeEventListener("pointercancel", onPointerCancel); container.removeEventListener("lostpointercapture", onPointerCancel);
                container.removeEventListener("pointerleave", onPointerLeave);
                observer?.disconnect(); document.defaultView.removeEventListener("resize", onResize);
                document.removeEventListener("keydown", onDocumentKey, true); container.innerHTML = "";
            },
            update(next) { if (!destroyed) { stopPan(null, true); payload = next || {}; selected = null; view = null; zoomPercent = 100; render(); } },
            setMode
        };
    }
    root.FormulaRuleChart = Object.freeze({mount, buildData, t});
})(typeof window !== "undefined" ? window : globalThis);
