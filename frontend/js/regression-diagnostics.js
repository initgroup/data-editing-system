(function (root) {
    "use strict";

    // Appearance is shared by Chart.js, canvas and SVG. The caller supplies the
    // classification: a PI review candidate is not a saved-rule violation.
    const chartStyle = Object.freeze({
        normal: Object.freeze({ fill: "rgba(37, 99, 235, 0.58)", stroke: "#2563eb", radius: 3, borderWidth: 1 }),
        attention: Object.freeze({ fill: "rgba(220, 38, 38, 0.68)", stroke: "#b91c1c", radius: 4, borderWidth: 1 }),
        selected: Object.freeze({ fill: "rgba(245, 158, 11, 0.92)", stroke: "#b45309", radius: 6, borderWidth: 1.4 }),
        plotFrame: Object.freeze({ stroke: "#94a3b8", width: 1 }),
        reference: Object.freeze({ stroke: "#d97706", dash: Object.freeze([6, 5]), width: 1.5 }),
        ci: Object.freeze({ stroke: "#059669", fill: "rgba(5, 150, 105, 0.13)", dash: Object.freeze([]), width: 1.4 }),
        pi: Object.freeze({ stroke: "#7c3aed", dash: Object.freeze([6, 4]), width: 1.4 }),
        tolerance: Object.freeze({ stroke: "#059669", fill: "rgba(5, 150, 105, 0.13)", dash: Object.freeze([6, 4]), width: 1.4 }),
        trend: Object.freeze({ stroke: "#475569", dash: Object.freeze([]), width: 1.5 })
    });
    const chartInteraction = Object.freeze({ hitRadius: 14, dragThreshold: 6 });

    function drawPlotFrame(context, area) {
        if (!context || !area) return;
        context.save();
        context.strokeStyle = chartStyle.plotFrame.stroke;
        context.lineWidth = chartStyle.plotFrame.width;
        context.setLineDash([]);
        context.strokeRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
        context.restore();
    }

    function pointStyle(attention = false, selected = false) {
        return { shape: attention ? "triangle" : "circle", ...chartStyle[selected ? "selected" : attention ? "attention" : "normal"] };
    }

    function drawPoint(context, x, y, attention = false, selected = false) {
        const style = pointStyle(attention, selected), radius = style.radius;
        context.save();
        context.beginPath();
        if (attention) {
            context.moveTo(x, y - radius);
            context.lineTo(x + radius * .866, y + radius * .5);
            context.lineTo(x - radius * .866, y + radius * .5);
            context.closePath();
        } else context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = style.fill;
        context.fill();
        context.strokeStyle = style.stroke;
        context.lineWidth = style.borderWidth;
        context.stroke();
        context.restore();
    }

    // Two-sided 95% Student-t critical values; use the large-df expansion above 30.
    const T_975 = [null, 12.70620474, 4.30265273, 3.18244631, 2.77644511, 2.57058184,
        2.44691185, 2.36462425, 2.30600414, 2.26215716, 2.22813885, 2.20098516,
        2.17881283, 2.16036866, 2.14478669, 2.13144955, 2.11990530, 2.10981558,
        2.10092204, 2.09302405, 2.08596345, 2.07961384, 2.07387307, 2.06865761,
        2.06389856, 2.05953855, 2.05552944, 2.05183052, 2.04840714, 2.04522964, 2.04227246];

    function tCritical95(df) {
        if (!Number.isInteger(df) || df < 1) return NaN;
        if (df < T_975.length) return T_975[df];
        const z = 1.959963984540054;
        return z + (z ** 3 + z) / (4 * df)
            + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
            + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
    }

    function numeric(value) {
        return value !== null && value !== undefined && typeof value !== "boolean"
            && String(value).trim() !== "" && Number.isFinite(Number(value));
    }

    function fit(points = []) {
        const valid = (Array.isArray(points) ? points : []).filter((point) => numeric(point?.x) && numeric(point?.y))
            .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y), isAttention: null }));
        const unavailable = (reason) => ({ ok: false, reason, points: valid, bands: [], count: valid.length, outsideCount: 0 });
        const n = valid.length;
        if (n < 3) return unavailable("TOO_FEW_POINTS");
        const xOrigin = valid[0].x;
        const yOrigin = valid[0].y;
        const meanXOffset = valid.reduce((sum, point) => sum + (point.x - xOrigin), 0) / n;
        const meanYOffset = valid.reduce((sum, point) => sum + (point.y - yOrigin), 0) / n;
        const dx = (point) => (point.x - xOrigin) - meanXOffset;
        const dy = (point) => (point.y - yOrigin) - meanYOffset;
        const sxx = valid.reduce((sum, point) => sum + dx(point) ** 2, 0);
        if (!(sxx > 0) || !Number.isFinite(sxx)) return unavailable("NO_X_VARIATION");
        const slope = valid.reduce((sum, point) => sum + dx(point) * dy(point), 0) / sxx;
        const sse = valid.reduce((sum, point) => sum + (dy(point) - slope * dx(point)) ** 2, 0);
        const residualStd = Math.sqrt(sse / (n - 2));
        const t = tCritical95(n - 2);
        if (!Number.isFinite(slope) || !Number.isFinite(residualStd)) return unavailable("NUMERIC_RANGE");

        // These are intervals for a separate OLS fit of the displayed sample pairs,
        // not confidence estimates of the saved (possibly nonlinear) model.
        // https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd511.htm
        // https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm
        const intervalAt = (x) => {
            const offset = (x - xOrigin) - meanXOffset;
            const y = yOrigin + meanYOffset + slope * offset;
            const leverage = 1 / n + offset ** 2 / sxx;
            const ci = t * residualStd * Math.sqrt(leverage);
            const pi = t * residualStd * Math.sqrt(1 + leverage);
            return { x, y, ciLower: y - ci, ciUpper: y + ci, piLower: y - pi, piUpper: y + pi };
        };
        const classified = valid.map((point) => {
            const bounds = intervalAt(point.x);
            const rounding = Number.EPSILON * Math.max(1, Math.abs(point.y), Math.abs(bounds.y)) * 16;
            return { ...point, isAttention: point.y < bounds.piLower - rounding || point.y > bounds.piUpper + rounding };
        });
        const minX = Math.min(...valid.map((point) => point.x));
        const maxX = Math.max(...valid.map((point) => point.x));
        const bands = Array.from({ length: 81 }, (_, index) => intervalAt(minX + (maxX - minX) * index / 80));
        if (bands.some((band) => Object.values(band).some((value) => !Number.isFinite(value)))) {
            return unavailable("NUMERIC_RANGE");
        }
        return {
            ok: true, points: classified, bands, count: n, df: n - 2, slope,
            intercept: yOrigin + meanYOffset - slope * (xOrigin + meanXOffset),
            residualStd, criticalValue: t, outsideCount: classified.filter((point) => point.isAttention).length
        };
    }

    function chartDatasets(diagnostic, labels = {}) {
        if (!diagnostic?.ok) return [];
        const line = (key, label, style, extra = {}) => ({
            type: "line", label, data: diagnostic.bands.map((band) => ({ x: band.x, y: band[key] })),
            borderColor: style.stroke, backgroundColor: style.stroke, borderWidth: style.width, borderDash: [...style.dash],
            pointRadius: 0, pointHitRadius: 0, pointStyle: "line", showLine: true, tension: 0, order: 2, ...extra
        });
        return [
            line("piLower", labels.pi || "95% PI", chartStyle.pi, { diagnosticGroup: "pi" }),
            line("piUpper", labels.pi || "95% PI", chartStyle.pi, { diagnosticGroup: "pi", diagnosticAuxiliary: true }),
            line("ciLower", labels.ci || "95% CI", chartStyle.ci, { diagnosticGroup: "ci" }),
            line("ciUpper", labels.ci || "95% CI", chartStyle.ci, {
                fill: "-1", backgroundColor: chartStyle.ci.fill, diagnosticGroup: "ci", diagnosticAuxiliary: true
            }),
            line("y", labels.fit || "Sample trend", chartStyle.trend)
        ];
    }

    root.RegressionDiagnostics = Object.freeze({ fit, chartDatasets, tCritical95, chartStyle, pointStyle, chartInteraction, drawPlotFrame, drawPoint });
})(typeof window !== "undefined" ? window : globalThis);
