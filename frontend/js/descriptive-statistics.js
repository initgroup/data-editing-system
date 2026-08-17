(function() {
    "use strict";

    if (window.DescriptiveStatistics) return;

    const OVERVIEW_VALUE = "__OVERVIEW__";

    const METRIC_ROWS = Object.freeze([
        { key: "totalRowCount", label: "건수" },
        { key: "sum", label: "합계" },
        { key: "mean", label: "평균" },
        { key: "variance", label: "분산" },
        { key: "stddev", label: "표준편차" },
        { key: "skewness", label: "왜도" },
        { key: "kurtosis", label: "첨도" },
        { key: "median", label: "메디안(중앙값)" }
    ]);
    const COMPARE_METRICS = Object.freeze([
        { key: "mean", label: "평균" },
        { key: "variance", label: "분산" },
        { key: "stddev", label: "표준편차" }
    ]);
    const GENERAL_METRIC_ROWS = Object.freeze([
        { key: "totalRowCount", label: "전체 건수", format: "number" },
        { key: "valueCount", label: "유효값 건수", format: "number" },
        { key: "nullCount", label: "결측 건수", format: "number" },
        { key: "distinctCount", label: "고유값 수", format: "number" },
        { key: "distinctRate", label: "고유값 비율", format: "percent" },
        { key: "modeValue", label: "최빈값", format: "text" },
        { key: "modeCount", label: "최빈값 빈도", format: "number" },
        { key: "minLength", label: "최소 길이", format: "number" },
        { key: "avgLength", label: "평균 길이", format: "number" },
        { key: "maxLength", label: "최대 길이", format: "number" },
        { key: "minValueText", label: "최솟값/최초값", format: "text" },
        { key: "maxValueText", label: "최댓값/최종값", format: "text" }
    ]);
    const DISTRIBUTION_ZOOM_LEVELS = Object.freeze([1, 1.25, 1.5, 2, 2.5]);
    const METRIC_KEY_ALIASES = Object.freeze({
        totalRowCount: ["totalRowCount", "TOTAL_ROW_COUNT"],
        valueCount: ["valueCount", "VALUE_COUNT"],
        nullCount: ["nullCount", "NULL_COUNT"],
        sum: ["sum", "SUM"],
        mean: ["mean", "MEAN"],
        variance: ["variance", "VARIANCE"],
        stddev: ["stddev", "STDDEV", "standardDeviation", "STANDARD_DEVIATION"],
        skewness: ["skewness", "SKEWNESS"],
        kurtosis: ["kurtosis", "KURTOSIS"],
        median: ["median", "MEDIAN"],
        min: ["min", "MIN"],
        q1: ["q1", "Q1", "firstQuartile", "FIRST_QUARTILE"],
        q3: ["q3", "Q3", "thirdQuartile", "THIRD_QUARTILE"],
        max: ["max", "MAX"],
        distinctCount: ["distinctCount", "DISTINCT_COUNT"],
        distinctRate: ["distinctRate", "DISTINCT_RATE"],
        minLength: ["minLength", "MIN_LENGTH"],
        maxLength: ["maxLength", "MAX_LENGTH"],
        avgLength: ["avgLength", "AVG_LENGTH"]
    });

    const state = {
        root: null,
        data: null,
        selectedColumnName: "",
        opener: null,
        requestId: 0,
        bodyOverflow: null,
        dialogOffsetX: 0,
        dialogOffsetY: 0,
        drag: null,
        overviewFilter: "ALL",
        detailTypeFilter: "ALL",
        columnSearchQuery: "",
        columnSearchTimer: null,
        distributionView: {
            columnName: "",
            beforeVisible: true,
            afterVisible: true,
            zoom: 1
        }
    };

    function getValue(source, ...keys) {
        if (!source || typeof source !== "object") return undefined;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
        }
        return undefined;
    }

    function asFiniteNumber(value) {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeMetrics(source) {
        const metrics = {};
        Object.entries(METRIC_KEY_ALIASES).forEach(([key, aliases]) => {
            metrics[key] = asFiniteNumber(getValue(source, ...aliases));
        });
        metrics.modeValue = getValue(source, "modeValue", "MODE_VALUE") ?? null;
        metrics.modeCount = asFiniteNumber(getValue(source, "modeCount", "MODE_COUNT"));
        metrics.minValueText = getValue(source, "minValueText", "MIN_VALUE_TEXT") ?? null;
        metrics.maxValueText = getValue(source, "maxValueText", "MAX_VALUE_TEXT") ?? null;
        return metrics;
    }

    function normalizeSource(source, fallbackLabel) {
        if (!source || typeof source !== "object") return null;
        return {
            owner: String(getValue(source, "owner", "OWNER") || ""),
            table: String(getValue(source, "table", "TABLE", "tableName", "TABLE_NAME") || ""),
            label: String(getValue(source, "label", "LABEL") || fallbackLabel || "")
        };
    }

    function normalizeInsight(source, fallback = {}) {
        const value = source && typeof source === "object" ? source : {};
        const reasons = getValue(value, "priorityReasons", "PRIORITY_REASONS");
        const importanceScore = asFiniteNumber(getValue(value, "importanceScore", "IMPORTANCE_SCORE")) || 0;
        return {
            columnName: String(getValue(value, "columnName", "COLUMN_NAME") || fallback.columnName || ""),
            columnComment: String(getValue(value, "columnComment", "COLUMN_COMMENT") || fallback.columnComment || ""),
            dataType: String(getValue(value, "dataType", "DATA_TYPE") || fallback.dataType || ""),
            hasStatistics: getValue(value, "hasStatistics", "HAS_STATISTICS") !== false,
            importanceRank: asFiniteNumber(getValue(value, "importanceRank", "IMPORTANCE_RANK")),
            importanceScore,
            priorityLevel: importanceScore >= 70 ? "HIGH" : (importanceScore >= 30 ? "MEDIUM" : "LOW"),
            priorityReasons: Array.isArray(reasons) ? reasons.map(String) : [],
            violationCount: asFiniteNumber(getValue(value, "violationCount", "VIOLATION_COUNT")) || 0,
            violatedRowCount: asFiniteNumber(getValue(value, "violatedRowCount", "VIOLATED_ROW_COUNT")) || 0,
            ruleCount: asFiniteNumber(getValue(value, "ruleCount", "RULE_COUNT")) || 0,
            categoricalViolationCount: asFiniteNumber(getValue(value, "categoricalViolationCount", "CATEGORICAL_VIOLATION_COUNT")) || 0,
            continuousViolationCount: asFiniteNumber(getValue(value, "continuousViolationCount", "CONTINUOUS_VIOLATION_COUNT")) || 0,
            missingRate: asFiniteNumber(getValue(value, "missingRate", "MISSING_RATE")) || 0,
            varianceChangeRate: asFiniteNumber(getValue(value, "varianceChangeRate", "VARIANCE_CHANGE_RATE")),
            meanShiftStd: asFiniteNumber(getValue(value, "meanShiftStd", "MEAN_SHIFT_STD")),
            rangeShiftRate: asFiniteNumber(getValue(value, "rangeShiftRate", "RANGE_SHIFT_RATE"))
        };
    }

    function normalizeDistribution(source) {
        if (!source || typeof source !== "object") return null;
        const rawBins = getValue(source, "bins", "BINS");
        const minimum = asFiniteNumber(getValue(source, "min", "MIN", "MIN_VALUE"));
        const maximum = asFiniteNumber(getValue(source, "max", "MAX", "MAX_VALUE"));
        if (!Array.isArray(rawBins) || minimum === null || maximum === null) return null;
        const bins = rawBins.map((bin, index) => ({
            index: asFiniteNumber(getValue(bin, "index", "INDEX", "BIN_NO")) || index + 1,
            lower: asFiniteNumber(getValue(bin, "lower", "LOWER", "LOWER_VALUE")),
            upper: asFiniteNumber(getValue(bin, "upper", "UPPER", "UPPER_VALUE")),
            beforeCount: asFiniteNumber(getValue(bin, "beforeCount", "BEFORE_COUNT")) || 0,
            afterCount: asFiniteNumber(getValue(bin, "afterCount", "AFTER_COUNT"))
        }));
        return bins.length ? { minimum, maximum, bins } : null;
    }

    function normalizeColumn(column) {
        const beforeSource = getValue(column, "before", "BEFORE");
        const afterSource = getValue(column, "after", "AFTER");
        const deltaSource = getValue(column, "delta", "DELTA") || {};
        const normalized = {
            columnName: String(getValue(column, "columnName", "COLUMN_NAME") || ""),
            columnComment: String(getValue(column, "columnComment", "COLUMN_COMMENT") || ""),
            dataType: String(getValue(column, "dataType", "DATA_TYPE") || ""),
            profileKind: String(getValue(column, "profileKind", "PROFILE_KIND") || "NUMERIC").toUpperCase(),
            typeGroupCode: String(getValue(column, "typeGroupCode", "TYPE_GROUP_CODE") || "OTHER").toUpperCase(),
            before: beforeSource ? normalizeMetrics(beforeSource) : null,
            after: afterSource ? normalizeMetrics(afterSource) : null,
            delta: {
                mean: asFiniteNumber(getValue(deltaSource, "mean", "MEAN")),
                variance: asFiniteNumber(getValue(deltaSource, "variance", "VARIANCE")),
                stddev: asFiniteNumber(getValue(deltaSource, "stddev", "STDDEV")),
                varianceReductionRate: asFiniteNumber(getValue(deltaSource, "varianceReductionRate", "VARIANCE_REDUCTION_RATE"))
            },
            distribution: normalizeDistribution(getValue(column, "distribution", "DISTRIBUTION")),
            topValues: (getValue(column, "topValues", "TOP_VALUES") || []).map((item) => ({
                value: String(getValue(item, "value", "VALUE") ?? ""),
                beforeCount: asFiniteNumber(getValue(item, "beforeCount", "BEFORE_COUNT")) || 0,
                afterCount: asFiniteNumber(getValue(item, "afterCount", "AFTER_COUNT"))
            }))
        };
        normalized.insight = normalizeInsight(getValue(column, "insight", "INSIGHT"), normalized);
        return normalized;
    }

    function normalizePayload(payload) {
        const source = payload && typeof payload === "object" ? payload : {};
        const columns = getValue(source, "columns", "COLUMNS");
        const afterSource = getValue(source, "after", "AFTER");
        const availableValue = getValue(source, "available", "AVAILABLE");
        const before = normalizeSource(getValue(source, "before", "BEFORE"), afterSource ? "수정 전" : "현재 데이터");
        const after = normalizeSource(afterSource, "수정 후");
        const normalizedColumns = Array.isArray(columns)
            ? columns.map(normalizeColumn).filter((column) => column.columnName)
            : [];
        const insightSource = getValue(source, "insights", "INSIGHTS") || {};
        const rawRankedColumns = getValue(insightSource, "rankedColumns", "RANKED_COLUMNS");
        let rankedColumns = Array.isArray(rawRankedColumns)
            ? rawRankedColumns.map((item) => normalizeInsight(item)).filter((item) => item.columnName)
            : normalizedColumns.map((column) => normalizeInsight(column.insight, column));
        rankedColumns = rankedColumns.sort((left, right) => (
            right.importanceScore - left.importanceScore
            || right.violationCount - left.violationCount
            || left.columnName.localeCompare(right.columnName)
        ));
        rankedColumns.forEach((item, index) => {
            if (!item.importanceRank) item.importanceRank = index + 1;
        });
        const rawInsightSummary = getValue(insightSource, "summary", "SUMMARY") || {};
        return {
            available: availableValue === undefined ? true : Boolean(availableValue),
            reasonCode: String(getValue(source, "reasonCode", "REASON_CODE") || ""),
            reason: String(getValue(source, "reason", "REASON") || ""),
            notice: String(getValue(source, "notice", "NOTICE") || ""),
            basis: String(getValue(source, "basis", "BASIS") || (after ? "BEFORE_AFTER" : "SINGLE")).toUpperCase(),
            before,
            after,
            columns: normalizedColumns,
            insights: {
                rankedColumns,
                summary: {
                    columnCount: asFiniteNumber(getValue(rawInsightSummary, "columnCount", "COLUMN_COUNT")) ?? rankedColumns.length,
                    highPriorityColumnCount: rankedColumns.filter((item) => item.importanceScore >= 70).length,
                    mediumPriorityColumnCount: rankedColumns.filter((item) => item.importanceScore >= 30 && item.importanceScore < 70).length,
                    violationColumnCount: asFiniteNumber(getValue(rawInsightSummary, "violationColumnCount", "VIOLATION_COLUMN_COUNT")) ?? rankedColumns.filter((item) => item.violationCount > 0).length,
                    totalViolationCount: asFiniteNumber(getValue(rawInsightSummary, "totalViolationCount", "TOTAL_VIOLATION_COUNT")) ?? rankedColumns.reduce((sum, item) => sum + item.violationCount, 0),
                    comparisonAvailable: Boolean(getValue(rawInsightSummary, "comparisonAvailable", "COMPARISON_AVAILABLE") ?? after)
                }
            },
            truncated: Boolean(getValue(source, "truncated", "TRUNCATED"))
        };
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatNumber(value) {
        const number = asFiniteNumber(value);
        if (number === null) return "-";
        const absolute = Math.abs(number);
        if ((absolute >= 1e12 || (absolute > 0 && absolute < 0.000001))) {
            return number.toExponential(4);
        }
        return new Intl.NumberFormat("ko-KR", {
            maximumFractionDigits: Number.isInteger(number) ? 0 : 6
        }).format(number);
    }

    function formatDelta(value) {
        const number = asFiniteNumber(value);
        if (number === null) return "-";
        if (number === 0) return "0";
        return `${number > 0 ? "+" : ""}${formatNumber(number)}`;
    }

    function ensureRoot() {
        if (state.root?.isConnected) return state.root;
        const root = document.createElement("div");
        root.id = "descriptiveStatisticsLayer";
        root.className = "descriptive-statistics-layer";
        root.hidden = true;
        root.innerHTML = `
            <div class="descriptive-statistics-backdrop" data-descriptive-close></div>
            <section class="descriptive-statistics-dialog" role="dialog" aria-modal="true" aria-labelledby="descriptiveStatisticsTitle" tabindex="-1">
                <header class="descriptive-statistics-header">
                    <div class="descriptive-statistics-title">
                        <span>DESCRIPTIVE STATISTICS</span>
                        <h2 id="descriptiveStatisticsTitle">기초통계량</h2>
                        <p id="descriptiveStatisticsSubtitle">데이터 분포와 변경 전·후 차이를 비교합니다.</p>
                    </div>
                    <div class="descriptive-statistics-header-actions">
                        <div id="descriptiveStatisticsSources" class="descriptive-statistics-sources"></div>
                        <button type="button" class="descriptive-statistics-close" data-descriptive-close aria-label="기초통계량 닫기" title="닫기">
                            <i class="fas fa-times" aria-hidden="true"></i>
                        </button>
                    </div>
                </header>
                <nav class="descriptive-statistics-tabs" aria-label="기초통계량 분석 보기">
                    <button type="button" data-statistics-view="overview" class="is-active">전체 변화 맵</button>
                    <button type="button" data-statistics-view="detail">컬럼 상세</button>
                </nav>
                <div id="descriptiveStatisticsContent" class="descriptive-statistics-content" aria-live="polite"></div>
            </section>
        `;
        document.body.appendChild(root);
        root.querySelectorAll("[data-descriptive-close]").forEach((element) => {
            element.addEventListener("click", close);
        });
        root.querySelectorAll("[data-statistics-view]").forEach((button) => {
            button.addEventListener("click", () => activateView(button.dataset.statisticsView));
        });
        const header = root.querySelector(".descriptive-statistics-header");
        header?.addEventListener("pointerdown", beginDialogDrag);
        header?.addEventListener("pointermove", moveDialog);
        header?.addEventListener("pointerup", endDialogDrag);
        header?.addEventListener("pointercancel", endDialogDrag);
        header?.setAttribute("title", "상단 영역을 드래그하여 팝업을 이동할 수 있습니다.");
        root.addEventListener("keydown", handleKeydown);
        window.addEventListener("resize", clampDialogPosition);
        state.root = root;
        return root;
    }

    function applyDialogPosition() {
        const dialog = state.root?.querySelector(".descriptive-statistics-dialog");
        if (!dialog) return;
        dialog.style.transform = `translate3d(${state.dialogOffsetX}px, ${state.dialogOffsetY}px, 0)`;
    }

    function resetDialogPosition() {
        state.dialogOffsetX = 0;
        state.dialogOffsetY = 0;
        state.drag = null;
        state.root?.classList.remove("is-dragging");
        applyDialogPosition();
    }

    function beginDialogDrag(event) {
        if (event.button !== 0 || event.target.closest("button, select, input, a")) return;
        const dialog = state.root?.querySelector(".descriptive-statistics-dialog");
        if (!dialog || state.root.hidden) return;
        const rect = dialog.getBoundingClientRect();
        state.drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startRect: rect,
            originX: state.dialogOffsetX,
            originY: state.dialogOffsetY
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        state.root.classList.add("is-dragging");
        event.preventDefault();
    }

    function moveDialog(event) {
        if (!state.drag || state.drag.pointerId !== event.pointerId) return;
        const margin = window.innerWidth <= 840 ? 10 : 16;
        const deltaX = event.clientX - state.drag.startX;
        const deltaY = event.clientY - state.drag.startY;
        const minimumX = margin - state.drag.startRect.left;
        const maximumX = window.innerWidth - margin - state.drag.startRect.right;
        const minimumY = margin - state.drag.startRect.top;
        const maximumY = window.innerHeight - margin - state.drag.startRect.bottom;
        state.dialogOffsetX = state.drag.originX + Math.min(maximumX, Math.max(minimumX, deltaX));
        state.dialogOffsetY = state.drag.originY + Math.min(maximumY, Math.max(minimumY, deltaY));
        applyDialogPosition();
        event.preventDefault();
    }

    function endDialogDrag(event) {
        if (!state.drag || (event?.pointerId !== undefined && state.drag.pointerId !== event.pointerId)) return;
        try {
            event?.currentTarget?.releasePointerCapture?.(state.drag.pointerId);
        } catch (_error) {
            // Pointer capture may already be released by the browser.
        }
        state.drag = null;
        state.root?.classList.remove("is-dragging");
    }

    function clampDialogPosition() {
        const dialog = state.root?.querySelector(".descriptive-statistics-dialog");
        if (!dialog || state.root.hidden) return;
        const margin = window.innerWidth <= 840 ? 10 : 16;
        const rect = dialog.getBoundingClientRect();
        let correctionX = 0;
        let correctionY = 0;
        if (rect.left < margin) correctionX = margin - rect.left;
        else if (rect.right > window.innerWidth - margin) correctionX = window.innerWidth - margin - rect.right;
        if (rect.top < margin) correctionY = margin - rect.top;
        else if (rect.bottom > window.innerHeight - margin) correctionY = window.innerHeight - margin - rect.bottom;
        state.dialogOffsetX += correctionX;
        state.dialogOffsetY += correctionY;
        applyDialogPosition();
    }

    function lockBodyScroll() {
        if (state.bodyOverflow !== null) return;
        state.bodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
    }

    function unlockBodyScroll() {
        if (state.bodyOverflow === null) return;
        document.body.style.overflow = state.bodyOverflow;
        state.bodyOverflow = null;
    }

    function handleKeydown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = [...state.root.querySelectorAll(
            "button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
        )].filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) {
            event.preventDefault();
            state.root.querySelector("[role='dialog']")?.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function setLoading() {
        const root = ensureRoot();
        root.querySelector("[role='dialog']")?.setAttribute("aria-busy", "true");
        const sources = root.querySelector("#descriptiveStatisticsSources");
        if (sources) sources.innerHTML = "";
        const content = root.querySelector("#descriptiveStatisticsContent");
        if (content) {
            content.innerHTML = `
                <div class="descriptive-statistics-state is-loading" role="status">
                    <span class="descriptive-statistics-spinner" aria-hidden="true"></span>
                    <strong>기초통계량을 계산하고 있습니다.</strong>
                    <p>대상 데이터의 수치·범주·문자·일시형 컬럼을 집계하는 동안 잠시 기다려 주세요.</p>
                </div>
            `;
        }
    }

    function setState(kind, title, message) {
        const root = ensureRoot();
        root.querySelector("[role='dialog']")?.setAttribute("aria-busy", "false");
        const content = root.querySelector("#descriptiveStatisticsContent");
        if (content) {
            content.innerHTML = `
                <div class="descriptive-statistics-state is-${escapeHtml(kind)}">
                    <i class="fas ${kind === "error" ? "fa-circle-exclamation" : "fa-chart-simple"}" aria-hidden="true"></i>
                    <strong>${escapeHtml(title)}</strong>
                    <p>${escapeHtml(message)}</p>
                </div>
            `;
        }
    }

    function renderSources() {
        const holder = state.root.querySelector("#descriptiveStatisticsSources");
        if (!holder || !state.data) return;
        const sources = [state.data.before, state.data.after].filter(Boolean);
        const sourceMarkup = sources.map((source, index) => {
            const objectName = [source.owner, source.table].filter(Boolean).join(".") || "-";
            return `
                <span class="descriptive-statistics-source is-${index === 0 ? "before" : "after"}">
                    <i aria-hidden="true"></i>
                    <b>${escapeHtml(source.label || (index === 0 ? "수정 전" : "수정 후"))}</b>
                    <em title="${escapeHtml(objectName)}">${escapeHtml(objectName)}</em>
                </span>
            `;
        }).join(`<span class="descriptive-statistics-source-arrow" aria-hidden="true">→</span>`);
        holder.innerHTML = sourceMarkup + (!state.data.after ? `
            <span class="descriptive-statistics-source-arrow" aria-hidden="true">→</span>
            <span class="descriptive-statistics-source is-after is-missing">
                <i aria-hidden="true"></i><b>수정</b><em>INITDN$ 비교 대상 없음</em>
            </span>
        ` : "");
    }

    function getColumnTypeCategory(column) {
        const analyzedType = String(column?.typeGroupCode || "").toUpperCase();
        const profileKind = String(column?.profileKind || "").toUpperCase();
        if (analyzedType === "CONTINUOUS") return "CONTINUOUS";
        if (analyzedType === "CATEGORICAL") return "CATEGORICAL";
        if (profileKind === "TEMPORAL") return "TEMPORAL";
        if (profileKind === "NUMERIC") return "CONTINUOUS";
        if (profileKind === "CATEGORICAL") return "CATEGORICAL";
        return "OTHER";
    }

    function getDetailColumns() {
        if (!state.data) return [];
        const rankedNames = (state.data.insights?.rankedColumns || []).map((item) => item.columnName);
        return state.data.columns
            .filter((column) => (
                state.detailTypeFilter === "ALL"
                || getColumnTypeCategory(column) === state.detailTypeFilter
            ))
            .filter(columnMatchesSearch)
            .sort((left, right) => {
                const leftIndex = rankedNames.indexOf(left.columnName);
                const rightIndex = rankedNames.indexOf(right.columnName);
                return (leftIndex < 0 ? 9999 : leftIndex) - (rightIndex < 0 ? 9999 : rightIndex)
                    || left.columnName.localeCompare(right.columnName);
            });
    }

    function columnMatchesSearch(column) {
        const tokens = String(state.columnSearchQuery || "")
            .trim()
            .toLocaleLowerCase("ko-KR")
            .split(/\s+/)
            .filter(Boolean);
        if (!tokens.length) return true;
        const haystack = [column?.columnName, column?.columnComment]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("ko-KR");
        return tokens.every((token) => haystack.includes(token));
    }

    function getTypeFilterOptions() {
        if (!state.data) return [];
        const counts = state.data.columns.reduce((result, column) => {
            const category = getColumnTypeCategory(column);
            result[category] = (result[category] || 0) + 1;
            return result;
        }, {});
        return [
            ["ALL", "전체 유형", state.data.columns.length],
            ["CONTINUOUS", "연속형", counts.CONTINUOUS || 0],
            ["CATEGORICAL", "범주형", counts.CATEGORICAL || 0],
            ["TEMPORAL", "일시형", counts.TEMPORAL || 0],
            ["OTHER", "기타", counts.OTHER || 0]
        ];
    }

    function showOverview() {
        if (!state.data) return;
        state.selectedColumnName = OVERVIEW_VALUE;
        renderSelectedColumn();
        state.root?.querySelectorAll("[data-statistics-view]").forEach((button) => {
            const active = button.dataset.statisticsView === "overview";
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-current", active ? "page" : "false");
        });
        const content = state.root?.querySelector("#descriptiveStatisticsContent");
        if (content) content.scrollTop = 0;
    }

    function activateView(view) {
        if (!state.data) return;
        const nextView = view === "detail" ? "detail" : "overview";
        if (nextView === "overview") {
            showOverview();
        } else {
            if (state.selectedColumnName === OVERVIEW_VALUE || !state.selectedColumnName) {
                state.selectedColumnName = getDetailColumns()[0]?.columnName || "";
            }
            renderSelectedColumn();
        }
        state.root?.querySelectorAll("[data-statistics-view]").forEach((button) => {
            const active = button.dataset.statisticsView === nextView;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-current", active ? "page" : "false");
        });
    }

    function metricDelta(column, key) {
        const explicit = asFiniteNumber(column.delta?.[key]);
        if (explicit !== null) return explicit;
        const before = asFiniteNumber(column.before?.[key]);
        const after = asFiniteNumber(column.after?.[key]);
        return before === null || after === null ? null : after - before;
    }

    function renderMetricGrid(column, hasAfter) {
        const sourceHeading = state.data.before?.label || (hasAfter ? "수정 전" : "현재");
        const afterHeading = state.data.after?.label || "수정";
        const isNumeric = column.profileKind === "NUMERIC";
        const metricRows = isNumeric ? METRIC_ROWS : GENERAL_METRIC_ROWS;
        const formatMetric = (metrics, metric) => {
            const value = metrics?.[metric.key];
            if (metric.format === "text") return value === null || value === undefined || value === "" ? "-" : String(value);
            if (metric.format === "percent") {
                const number = asFiniteNumber(value);
                return number === null ? "-" : `${formatNumber(number * 100)}%`;
            }
            return formatNumber(value);
        };
        return `
            <section class="descriptive-statistics-card descriptive-statistics-metrics" aria-labelledby="descriptiveMetricsTitle">
                <div class="descriptive-statistics-card-title">
                    <div>
                        <span>SUMMARY GRID</span>
                        <h3 id="descriptiveMetricsTitle">기초 통계 측정값</h3>
                    </div>
                    <small>${isNumeric ? "수치형 핵심 8개 지표" : "범주·문자·일시형 제공 지표"}</small>
                </div>
                <div class="descriptive-statistics-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">측정값</th>
                                <th scope="col">${escapeHtml(sourceHeading)}</th>
                                <th scope="col">${escapeHtml(afterHeading)}</th><th scope="col">변화량</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${metricRows.map((metric) => `
                                <tr class="${metric.key === "variance" ? "is-variance" : ""}">
                                    <th scope="row">${escapeHtml(metric.label)}</th>
                                    <td>${escapeHtml(formatMetric(column.before, metric))}</td>
                                    <td>${hasAfter ? escapeHtml(formatMetric(column.after, metric)) : "-"}</td>
                                    <td class="${metric.format !== "text" && (metricDelta(column, metric.key) || 0) > 0 ? "is-increase" : (metric.format !== "text" && (metricDelta(column, metric.key) || 0) < 0 ? "is-decrease" : "")}">${hasAfter && metric.format !== "text" ? escapeHtml(formatDelta(metricDelta(column, metric.key))) : "-"}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function renderTopValues(column, hasAfter) {
        const rows = Array.isArray(column.topValues) ? column.topValues : [];
        if (!rows.length) {
            return `<section class="descriptive-statistics-card descriptive-statistics-distribution"><div class="descriptive-statistics-card-title"><div><span>TOP VALUES</span><h3>상위 값 분포</h3></div></div><p class="descriptive-statistics-chart-note">집계 가능한 유효값이 없습니다.</p></section>`;
        }
        return `
            <section class="descriptive-statistics-card descriptive-statistics-distribution">
                <div class="descriptive-statistics-card-title"><div><span>TOP VALUES</span><h3>상위 값 분포</h3></div><small>최대 10개</small></div>
                <div class="descriptive-statistics-table-wrap"><table>
                    <thead><tr><th>값</th><th>${escapeHtml(state.data.before?.label || "현재")}</th><th>${escapeHtml(state.data.after?.label || "수정")}</th></tr></thead>
                    <tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.value || "(빈 값)")}</th><td>${escapeHtml(formatNumber(row.beforeCount))}</td><td>${hasAfter ? escapeHtml(formatNumber(row.afterCount)) : "-"}</td></tr>`).join("")}</tbody>
                </table></div>
            </section>
        `;
    }

    function renderVarianceBadge(column) {
        if (!column.after) return "";
        const before = asFiniteNumber(column.before?.variance);
        const after = asFiniteNumber(column.after?.variance);
        if (before === null || after === null) {
            return `<span class="descriptive-statistics-variance-badge is-neutral">분산 비교 불가</span>`;
        }
        if (before === after) {
            return `<span class="descriptive-statistics-variance-badge is-neutral"><i class="fas fa-minus" aria-hidden="true"></i>분산 변화 없음</span>`;
        }
        let rate = asFiniteNumber(column.delta?.varianceReductionRate);
        if (rate !== null) rate *= 100;
        if (rate === null && before !== 0) rate = ((before - after) / Math.abs(before)) * 100;
        const reduced = after < before;
        const rateText = rate === null ? "" : ` ${formatNumber(Math.abs(rate))}%`;
        return `
            <span class="descriptive-statistics-variance-badge ${reduced ? "is-reduced" : "is-increased"}">
                <i class="fas ${reduced ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}" aria-hidden="true"></i>
                분산${rateText} ${reduced ? "감소" : "증가"}
            </span>
        `;
    }

    function renderComparisonBars(column, hasAfter) {
        const bar = (value, tone, label, maximum) => {
            const number = asFiniteNumber(value);
            const width = number === null ? 0 : Math.max(number === 0 ? 0 : 2, Math.min(100, Math.abs(number) / maximum * 100));
            return `
                <div class="descriptive-statistics-bar-line is-${tone}">
                    <span>${escapeHtml(label)}</span>
                    <div><i style="width:${width.toFixed(3)}%"></i></div>
                    <b>${escapeHtml(formatNumber(number))}</b>
                </div>
            `;
        };
        return `
            <section class="descriptive-statistics-card descriptive-statistics-comparison" aria-labelledby="descriptiveComparisonTitle">
                <div class="descriptive-statistics-card-title">
                    <div>
                        <span>MEAN · VARIANCE · STDDEV</span>
                        <h3 id="descriptiveComparisonTitle">분포 규모 비교</h3>
                    </div>
                    ${renderVarianceBadge(column)}
                </div>
                <div class="descriptive-statistics-bar-chart">
                    ${COMPARE_METRICS.map((metric) => {
                        const beforeValue = asFiniteNumber(column.before?.[metric.key]);
                        const afterValue = hasAfter ? asFiniteNumber(column.after?.[metric.key]) : null;
                        const absoluteMaximum = Math.max(Math.abs(beforeValue || 0), Math.abs(afterValue || 0));
                        const maximum = absoluteMaximum > 0 ? absoluteMaximum : 1;
                        return `
                            <article>
                                <strong>${escapeHtml(metric.label)}</strong>
                                ${bar(beforeValue, "before", state.data.before?.label || (hasAfter ? "수정 전" : "현재"), maximum)}
                                ${hasAfter ? bar(afterValue, "after", state.data.after?.label || "수정 후", maximum) : ""}
                            </article>
                        `;
                    }).join("")}
                </div>
                <p class="descriptive-statistics-chart-note">막대 길이는 각 지표의 수정 전·후 절대값 중 큰 값을 기준으로 비교하며, 정확한 값은 오른쪽에 표시합니다.</p>
            </section>
        `;
    }

    function distributionPosition(value, lower, upper) {
        const number = asFiniteNumber(value);
        if (number === null) return null;
        if (upper === lower) return 50;
        return Math.max(0, Math.min(100, (number - lower) / (upper - lower) * 100));
    }

    function renderBoxRow(metrics, tone, label, lower, upper) {
        if (!metrics || [metrics.min, metrics.q1, metrics.median, metrics.q3, metrics.max].some((value) => asFiniteNumber(value) === null)) {
            return `<div class="descriptive-statistics-box-row is-empty"><strong>${escapeHtml(label)}</strong><span>분포 구간 데이터 없음</span></div>`;
        }
        const min = distributionPosition(metrics.min, lower, upper);
        const q1 = distributionPosition(metrics.q1, lower, upper);
        const median = distributionPosition(metrics.median, lower, upper);
        const q3 = distributionPosition(metrics.q3, lower, upper);
        const max = distributionPosition(metrics.max, lower, upper);
        return `
            <div class="descriptive-statistics-box-row is-${tone}">
                <strong>${escapeHtml(label)}</strong>
                <div class="descriptive-statistics-box-plot" role="img" aria-label="최소 ${escapeHtml(formatNumber(metrics.min))}, 1사분위 ${escapeHtml(formatNumber(metrics.q1))}, 중앙값 ${escapeHtml(formatNumber(metrics.median))}, 3사분위 ${escapeHtml(formatNumber(metrics.q3))}, 최대 ${escapeHtml(formatNumber(metrics.max))}">
                    <i class="is-whisker" style="left:${min.toFixed(3)}%;width:${Math.max(0, max - min).toFixed(3)}%"></i>
                    <i class="is-min" style="left:${min.toFixed(3)}%"></i>
                    <i class="is-box" style="left:${q1.toFixed(3)}%;width:${Math.max(0, q3 - q1).toFixed(3)}%"></i>
                    <i class="is-median" style="left:${median.toFixed(3)}%"></i>
                    <i class="is-max" style="left:${max.toFixed(3)}%"></i>
                </div>
                <small>${escapeHtml(formatNumber(metrics.min))} / ${escapeHtml(formatNumber(metrics.q1))} / ${escapeHtml(formatNumber(metrics.median))} / ${escapeHtml(formatNumber(metrics.q3))} / ${escapeHtml(formatNumber(metrics.max))}</small>
            </div>
        `;
    }

    function renderDistribution(column, hasAfter) {
        const metricsList = [column.before, hasAfter ? column.after : null].filter(Boolean);
        const bounds = metricsList.flatMap((metrics) => [metrics.min, metrics.max]).map(asFiniteNumber).filter((value) => value !== null);
        const lower = bounds.length ? Math.min(...bounds) : 0;
        const upper = bounds.length ? Math.max(...bounds) : 1;
        return `
            <section class="descriptive-statistics-card descriptive-statistics-distribution" aria-labelledby="descriptiveDistributionTitle">
                <div class="descriptive-statistics-card-title">
                    <div>
                        <span>FIVE-NUMBER SUMMARY</span>
                        <h3 id="descriptiveDistributionTitle">분포 범위 비교</h3>
                    </div>
                    <small>최소 / Q1 / 중앙값 / Q3 / 최대</small>
                </div>
                <div class="descriptive-statistics-box-chart">
                    ${renderBoxRow(column.before, "before", state.data.before?.label || (hasAfter ? "수정 전" : "현재"), lower, upper)}
                    ${hasAfter ? renderBoxRow(column.after, "after", state.data.after?.label || "수정 후", lower, upper) : ""}
                    <div class="descriptive-statistics-box-scale"><span>${escapeHtml(formatNumber(lower))}</span><span>${escapeHtml(formatNumber(upper))}</span></div>
                </div>
            </section>
        `;
    }

    function formatPercentRatio(value) {
        const number = asFiniteNumber(value);
        return number === null ? "-" : `${formatNumber(number * 100)}%`;
    }

    function renderInsightVariance(column) {
        if (!column) return `<div class="descriptive-insight-no-chart">범주형 또는 비수치 컬럼</div>`;
        if (column.profileKind !== "NUMERIC") {
            const before = Math.abs(asFiniteNumber(column.before?.distinctCount) || 0);
            const afterValue = asFiniteNumber(column.after?.distinctCount);
            const after = Math.abs(afterValue || 0);
            const maximum = Math.max(before, after, 1);
            return `
                <div class="descriptive-insight-mini-chart" aria-label="고유값 수 비교">
                    <span><b>전</b><i><em style="width:${Math.min(100, before / maximum * 100).toFixed(2)}%"></em></i><small>${escapeHtml(formatNumber(before))}</small></span>
                    ${column.after ? `<span class="is-after"><b>후</b><i><em style="width:${Math.min(100, after / maximum * 100).toFixed(2)}%"></em></i><small>${escapeHtml(formatNumber(afterValue))}</small></span>` : ""}
                </div>
            `;
        }
        const before = Math.abs(asFiniteNumber(column.before?.variance) || 0);
        const afterValue = asFiniteNumber(column.after?.variance);
        const after = Math.abs(afterValue || 0);
        const maximum = Math.max(before, after, 1e-12);
        return `
            <div class="descriptive-insight-mini-chart" aria-label="분산 비교">
                <span><b>전</b><i><em style="width:${Math.min(100, before / maximum * 100).toFixed(2)}%"></em></i><small>${escapeHtml(formatNumber(before))}</small></span>
                ${column.after ? `<span class="is-after"><b>후</b><i><em style="width:${Math.min(100, after / maximum * 100).toFixed(2)}%"></em></i><small>${escapeHtml(formatNumber(afterValue))}</small></span>` : ""}
            </div>
        `;
    }

    function renderInsightRange(column) {
        if (!column?.before) return "";
        const metricList = [column.before, column.after].filter(Boolean);
        const values = metricList
            .flatMap((metrics) => [metrics.min, metrics.max])
            .map(asFiniteNumber)
            .filter((value) => value !== null);
        if (!values.length) return "";
        const lower = Math.min(...values);
        const upper = Math.max(...values);
        const row = (metrics, tone, label) => {
            if (!metrics || [metrics.q1, metrics.median, metrics.q3].some((value) => asFiniteNumber(value) === null)) return "";
            const q1 = distributionPosition(metrics.q1, lower, upper);
            const median = distributionPosition(metrics.median, lower, upper);
            const q3 = distributionPosition(metrics.q3, lower, upper);
            return `
                <span class="is-${tone}" title="${escapeHtml(label)}: ${escapeHtml(formatNumber(metrics.min))} ~ ${escapeHtml(formatNumber(metrics.max))}">
                    <b>${escapeHtml(label)}</b>
                    <i><em style="left:${q1.toFixed(2)}%;width:${Math.max(1, q3 - q1).toFixed(2)}%"></em><u style="left:${median.toFixed(2)}%"></u></i>
                </span>
            `;
        };
        return `
            <div class="descriptive-insight-range" aria-label="사분위 분포 범위">
                ${row(column.before, "before", "전")}
                ${row(column.after, "after", "후")}
            </div>
        `;
    }

    function insightMatchesFilter(insight) {
        const column = state.data?.columns.find((item) => item.columnName === insight.columnName);
        if (!columnMatchesSearch(column || insight)) return false;
        if (state.detailTypeFilter !== "ALL"
            && (!column || getColumnTypeCategory(column) !== state.detailTypeFilter)) return false;
        if (state.overviewFilter === "HIGH") return insight.priorityLevel === "HIGH";
        if (state.overviewFilter === "VIOLATION") return insight.violationCount > 0;
        if (state.overviewFilter === "CHANGE") {
            return (insight.varianceChangeRate || 0) >= 0.1
                || (insight.meanShiftStd || 0) >= 0.25
                || (insight.rangeShiftRate || 0) >= 0.1;
        }
        return true;
    }

    function renderInsightCard(insight) {
        const column = state.data.columns.find((item) => item.columnName === insight.columnName);
        const level = ["HIGH", "MEDIUM"].includes(insight.priorityLevel) ? insight.priorityLevel : "LOW";
        const violationBadges = [
            insight.categoricalViolationCount > 0
                ? `<span class="is-categorical">범주형 ${escapeHtml(formatNumber(insight.categoricalViolationCount))}</span>`
                : "",
            insight.continuousViolationCount > 0
                ? `<span class="is-continuous">연속형 ${escapeHtml(formatNumber(insight.continuousViolationCount))}</span>`
                : ""
        ].filter(Boolean).join("");
        return `
            <article class="descriptive-insight-card is-${level.toLowerCase()} ${column ? "is-selectable" : "is-rule-only"}">
                <button type="button" data-insight-column="${escapeHtml(insight.columnName)}" ${column ? "" : "disabled"} aria-label="${escapeHtml(insight.columnName)} 상세 기초통계량">
                    <header>
                        <div>
                            <span class="descriptive-insight-rank">#${escapeHtml(formatNumber(insight.importanceRank))}</span>
                            <span class="descriptive-insight-priority is-${level.toLowerCase()}">${level === "HIGH" ? "우선 확인" : (level === "MEDIUM" ? "관심" : "안정")}</span>
                        </div>
                        <strong>${escapeHtml(formatNumber(insight.importanceScore))}<small>점</small></strong>
                    </header>
                    <div class="descriptive-insight-name">
                        <span>${escapeHtml(insight.dataType || "RULE")}</span>
                        <h4>${escapeHtml(insight.columnName)}</h4>
                        <p>${escapeHtml(insight.columnComment || (column ? "컬럼 설명 없음" : "규칙 위반 컬럼 · 수치 통계 비대상"))}</p>
                    </div>
                    <div class="descriptive-insight-rule-badges">${violationBadges || "<span class='is-none'>위반 없음</span>"}</div>
                    <dl>
                        <div><dt>위반</dt><dd>${escapeHtml(formatNumber(insight.violationCount))}건</dd></div>
                        <div><dt>위반 행</dt><dd>${escapeHtml(formatNumber(insight.violatedRowCount))}건</dd></div>
                        <div><dt>결측률</dt><dd>${escapeHtml(formatPercentRatio(insight.missingRate))}</dd></div>
                        <div><dt>분산 변화</dt><dd>${escapeHtml(formatPercentRatio(insight.varianceChangeRate))}</dd></div>
                    </dl>
                    ${renderInsightVariance(column)}
                    ${renderInsightRange(column)}
                    <footer>
                        <span>${insight.priorityReasons.slice(0, 2).map(escapeHtml).join(" · ")}</span>
                        <b>${column ? "상세 보기 →" : "규칙 분석에서 확인"}</b>
                    </footer>
                </button>
            </article>
        `;
    }

    function relativeChange(beforeValue, afterValue) {
        const before = asFiniteNumber(beforeValue);
        const after = asFiniteNumber(afterValue);
        if (before === null || after === null || before === 0) return null;
        return (after - before) / Math.abs(before);
    }

    function renderChangeMapRow(insight) {
        const column = state.data.columns.find((item) => item.columnName === insight.columnName);
        const hasAfter = Boolean(column?.after);
        const beforeMissingRate = column?.before?.totalRowCount
            ? (column.before.nullCount || 0) / column.before.totalRowCount
            : 0;
        const afterMissingRate = hasAfter && column.after.totalRowCount
            ? (column.after.nullCount || 0) / column.after.totalRowCount
            : null;
        const missingDelta = afterMissingRate === null ? null : afterMissingRate - beforeMissingRate;
        const meanChange = hasAfter ? relativeChange(column.before?.mean, column.after?.mean) : null;
        const varianceChange = hasAfter ? relativeChange(column.before?.variance, column.after?.variance) : null;
        const rangeChange = hasAfter ? insight.rangeShiftRate : null;
        const level = insight.importanceScore >= 70 ? "HIGH" : (insight.importanceScore >= 30 ? "MEDIUM" : "LOW");
        return `
            <tr class="is-${level.toLowerCase()}" data-change-map-column="${escapeHtml(insight.columnName)}" tabindex="0">
                <th scope="row"><b>${escapeHtml(insight.columnName)}</b><small>${escapeHtml(insight.columnComment || "설명 없음")}</small></th>
                <td><span>${escapeHtml(insight.dataType || column?.dataType || "-")}</span></td>
                <td>${escapeHtml(formatNumber(column?.before?.totalRowCount))}${hasAfter ? ` → ${escapeHtml(formatNumber(column?.after?.totalRowCount))}` : ""}</td>
                <td>${hasAfter ? escapeHtml(formatPercentRatio(missingDelta)) : "비교 없음"}</td>
                <td>${hasAfter ? escapeHtml(formatPercentRatio(meanChange)) : "-"}</td>
                <td>${hasAfter ? escapeHtml(formatPercentRatio(varianceChange)) : "-"}</td>
                <td>${hasAfter ? escapeHtml(formatPercentRatio(rangeChange)) : "-"}</td>
                <td><strong>${escapeHtml(formatNumber(insight.importanceScore))}</strong><em>${level === "HIGH" ? "확인" : (level === "MEDIUM" ? "관찰" : "안정")}</em></td>
            </tr>
        `;
    }

    function renderOverview() {
        const content = state.root?.querySelector("#descriptiveStatisticsContent");
        if (!content || !state.data) return;
        state.root.querySelector("[role='dialog']")?.setAttribute("aria-busy", "false");
        const ranked = state.data.insights?.rankedColumns || [];
        const visible = ranked.filter(insightMatchesFilter);
        const summary = state.data.insights?.summary || {};
        content.innerHTML = `
            <div class="descriptive-profile-layout descriptive-profile-layout--overview">
            ${renderDetailColumnList("")}
            <main class="descriptive-profile-detail">
            <section class="descriptive-insight-overview" aria-labelledby="descriptiveInsightTitle">
                <div class="descriptive-insight-heading">
                    <div>
                        <span>PRIORITY ANALYSIS</span>
                        <h3 id="descriptiveInsightTitle">전체 컬럼 중요도 분석</h3>
                        <p>규칙 위반을 우선 반영하고 결측·분산·평균·분포 범위 변화를 함께 평가했습니다.</p>
                    </div>
                    <div class="descriptive-insight-filters" role="group" aria-label="컬럼 중요도 필터">
                        ${[
                            ["ALL", "전체"],
                            ["HIGH", "우선 확인"],
                            ["VIOLATION", "위반 있음"],
                            ["CHANGE", "분포 변화"]
                        ].map(([value, label]) => `<button type="button" data-insight-filter="${value}" class="${state.overviewFilter === value ? "is-active" : ""}">${label}</button>`).join("")}
                    </div>
                </div>
                ${state.data.notice ? `<div class="descriptive-statistics-notice"><i class="fas fa-circle-info" aria-hidden="true"></i>${escapeHtml(state.data.notice)}</div>` : ""}
                <div class="descriptive-insight-kpis">
                    <article><span>분석 컬럼</span><strong>${escapeHtml(formatNumber(summary.columnCount || ranked.length))}</strong><small>수치·규칙 대상</small></article>
                    <article class="is-alert"><span>우선 확인</span><strong>${escapeHtml(formatNumber(summary.highPriorityColumnCount || 0))}</strong><small>변화 강도 70점 이상</small></article>
                    <article class="is-violation"><span>위반 컬럼</span><strong>${escapeHtml(formatNumber(summary.violationColumnCount || 0))}</strong><small>총 ${escapeHtml(formatNumber(summary.totalViolationCount || 0))}건</small></article>
                    <article class="is-compare"><span>전·후 비교</span><strong>${summary.comparisonAvailable ? "가능" : "현재값"}</strong><small>${summary.comparisonAvailable ? "INITUP$ ↔ INITDN$" : "단일 테이블 기준"}</small></article>
                </div>
                <section class="descriptive-change-map" aria-labelledby="descriptiveChangeMapTitle">
                    <div class="descriptive-insight-list-heading">
                        <div><b id="descriptiveChangeMapTitle">전체 변화 맵</b><span>점수·위반·분포 변화 순</span></div>
                        <p>행을 선택하면 해당 컬럼 상세로 이동합니다.</p>
                    </div>
                    <div class="descriptive-change-map-scroll">
                        <table>
                            <thead><tr><th>컬럼</th><th>타입</th><th>행 수</th><th>결측 변화</th><th>중심 변화</th><th>분산 변화</th><th>범위 변화</th><th>점수·상태</th></tr></thead>
                            <tbody>${visible.length ? visible.map(renderChangeMapRow).join("") : `<tr><td colspan="8" class="descriptive-change-map-empty">선택한 조건에 해당하는 컬럼이 없습니다.</td></tr>`}</tbody>
                        </table>
                    </div>
                </section>
                <p class="descriptive-statistics-methodology descriptive-insight-methodology">
                    <b>중요도 산정</b>
                    규칙 위반 55점 · 결측률 15점 · 분산 변화 15점 · 평균 이동 10점 · 범위 이동 5점입니다.
                    점수는 확인 순서를 돕는 지표이며 데이터 품질의 절대 판정값은 아닙니다.
                </p>
            </section>
            </main>
            </div>
        `;
        bindColumnSidebar(content);
        content.querySelectorAll("[data-insight-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                state.overviewFilter = button.dataset.insightFilter || "ALL";
                renderOverview();
            });
        });
        content.querySelectorAll("[data-change-map-column]").forEach((row) => {
            const openDetail = () => {
                state.selectedColumnName = row.dataset.changeMapColumn || OVERVIEW_VALUE;
                activateView("detail");
                if (content) content.scrollTop = 0;
            };
            row.addEventListener("click", openDetail);
            row.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetail();
                }
            });
        });
    }

    function distributionPath(values, width, height, padding, maximumValue = null) {
        const maximum = maximumValue || Math.max(...values, 1);
        return values.map((value, index) => {
            const x = padding + (values.length === 1 ? 0 : index * (width - padding * 2) / (values.length - 1));
            const y = height - padding - (Number(value || 0) / maximum) * (height - padding * 2);
            return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(" ");
    }

    function renderDistributionOverlay(column, hasAfter) {
        const distribution = column.distribution;
        if (!distribution?.bins?.length) {
            return `<section class="descriptive-statistics-card descriptive-distribution-overlay is-empty"><h3>분포 오버레이</h3><p>이 실행에는 구간별 분포 집계가 없습니다. 기초통계량과 사분위 범위는 아래에서 계속 확인할 수 있습니다.</p></section>`;
        }
        const width = 760;
        const height = 230;
        const padding = 32;
        const view = state.distributionView;
        const zoom = Math.min(2.5, Math.max(1, Number(view.zoom) || 1));
        const beforeVisible = view.beforeVisible !== false;
        const afterVisible = hasAfter && view.afterVisible !== false;
        const beforeValues = distribution.bins.map((bin) => bin.beforeCount || 0);
        const afterValues = distribution.bins.map((bin) => bin.afterCount || 0);
        const sharedMaximum = Math.max(...beforeValues, ...afterValues, 1);
        const beforePath = distributionPath(beforeValues, width, height, padding, sharedMaximum);
        const afterPath = distributionPath(afterValues, width, height, padding, sharedMaximum);
        const baseline = height - padding;
        const beforeArea = `${beforePath} L${width - padding},${baseline} L${padding},${baseline} Z`;
        const afterArea = `${afterPath} L${width - padding},${baseline} L${padding},${baseline} Z`;
        return `
            <section class="descriptive-statistics-card descriptive-distribution-overlay" aria-labelledby="descriptiveDistributionOverlayTitle">
                <div class="descriptive-statistics-card-title">
                    <div><span>DISTRIBUTION OVERLAY</span><h3 id="descriptiveDistributionOverlayTitle">동일 구간 분포 비교</h3></div>
                    <div class="descriptive-distribution-controls">
                        <div class="descriptive-distribution-legend" role="group" aria-label="그래프 시리즈 표시 설정">
                            <button type="button" class="is-before ${beforeVisible ? "is-active" : ""}" data-distribution-series="before" aria-pressed="${beforeVisible}">원본</button>
                            ${hasAfter ? `<button type="button" class="is-after ${afterVisible ? "is-active" : ""}" data-distribution-series="after" aria-pressed="${afterVisible}">수정</button>` : ""}
                        </div>
                        <div class="descriptive-distribution-zoom" role="group" aria-label="그래프 확대 축소">
                            <button type="button" data-distribution-zoom="out" ${zoom <= DISTRIBUTION_ZOOM_LEVELS[0] ? "disabled" : ""} aria-label="그래프 축소" title="축소"><i class="fas fa-minus" aria-hidden="true"></i></button>
                            <span data-distribution-zoom-label aria-live="polite">${Math.round(zoom * 100)}%</span>
                            <button type="button" data-distribution-zoom="in" ${zoom >= DISTRIBUTION_ZOOM_LEVELS[DISTRIBUTION_ZOOM_LEVELS.length - 1] ? "disabled" : ""} aria-label="그래프 확대" title="확대"><i class="fas fa-plus" aria-hidden="true"></i></button>
                            <button type="button" data-distribution-zoom="reset" ${zoom === 1 ? "disabled" : ""} aria-label="그래프 크기 초기화" title="원래 크기"><i class="fas fa-rotate-left" aria-hidden="true"></i></button>
                        </div>
                    </div>
                </div>
                <div class="descriptive-distribution-viewport ${zoom > 1 ? "is-zoomed" : ""}" data-distribution-viewport tabindex="0" aria-label="분포 그래프 확대 및 이동 영역">
                <svg viewBox="0 0 ${width} ${height}" data-base-height="${height}" style="width:${zoom * 100}%;height:${Math.round(height * zoom)}px" role="img" aria-label="${escapeHtml(column.columnName)} ${beforeVisible ? "원본" : ""}${beforeVisible && afterVisible ? "과 " : ""}${afterVisible ? "수정" : ""} 데이터의 12개 동일 구간 분포">
                    <line x1="${padding}" y1="${baseline}" x2="${width - padding}" y2="${baseline}" class="is-axis"></line>
                    ${beforeVisible ? `<path d="${beforeArea}" class="is-before-area"></path><path d="${beforePath}" class="is-before-line"></path>` : ""}
                    ${afterVisible ? `<path d="${afterArea}" class="is-after-area"></path><path d="${afterPath}" class="is-after-line"></path>` : ""}
                </svg>
                </div>
                <div class="descriptive-distribution-axis"><span>${escapeHtml(formatNumber(distribution.minimum))}</span><span>공통 12구간</span><span>${escapeHtml(formatNumber(distribution.maximum))}</span></div>
                <p class="descriptive-statistics-chart-note">범례로 원본·수정을 표시하거나 숨길 수 있습니다. 버튼 또는 마우스 휠로 확대·축소하고, 확대 후 드래그로 이동할 수 있습니다. 모바일은 두 손가락을 벌리거나 오므려 조절합니다.</p>
            </section>
        `;
    }

    function refreshDistributionOverlay(column, hasAfter) {
        const content = state.root?.querySelector("#descriptiveStatisticsContent");
        const current = content?.querySelector(".descriptive-distribution-overlay");
        if (!content || !current) return;
        const currentViewport = current.querySelector("[data-distribution-viewport]");
        const centerX = currentViewport?.scrollWidth
            ? (currentViewport.scrollLeft + currentViewport.clientWidth / 2) / currentViewport.scrollWidth
            : 0.5;
        const centerY = currentViewport?.scrollHeight
            ? (currentViewport.scrollTop + currentViewport.clientHeight / 2) / currentViewport.scrollHeight
            : 0.5;
        current.outerHTML = renderDistributionOverlay(column, hasAfter);
        bindDistributionControls(content, column, hasAfter);
        const nextViewport = content.querySelector("[data-distribution-viewport]");
        if (nextViewport) {
            nextViewport.scrollLeft = Math.max(0, centerX * nextViewport.scrollWidth - nextViewport.clientWidth / 2);
            nextViewport.scrollTop = Math.max(0, centerY * nextViewport.scrollHeight - nextViewport.clientHeight / 2);
        }
    }

    function clampDistributionZoom(value) {
        return Math.round(Math.min(
            DISTRIBUTION_ZOOM_LEVELS[DISTRIBUTION_ZOOM_LEVELS.length - 1],
            Math.max(DISTRIBUTION_ZOOM_LEVELS[0], Number(value) || 1)
        ) * 100) / 100;
    }

    function applyDistributionZoom(viewport, requestedZoom, anchorClientX = null, anchorClientY = null) {
        const svg = viewport?.querySelector("svg");
        if (!viewport || !svg) return;

        const zoom = clampDistributionZoom(requestedZoom);
        const previousZoom = clampDistributionZoom(state.distributionView.zoom);
        const bounds = viewport.getBoundingClientRect();
        const anchorX = Number.isFinite(anchorClientX) ? anchorClientX - bounds.left : viewport.clientWidth / 2;
        const anchorY = Number.isFinite(anchorClientY) ? anchorClientY - bounds.top : viewport.clientHeight / 2;
        const contentX = (viewport.scrollLeft + anchorX) / Math.max(viewport.scrollWidth, 1);
        const contentY = (viewport.scrollTop + anchorY) / Math.max(viewport.scrollHeight, 1);
        const baseHeight = Number(svg.dataset.baseHeight) || 230;

        state.distributionView.zoom = zoom;
        svg.style.width = `${zoom * 100}%`;
        svg.style.height = `${Math.round(baseHeight * zoom)}px`;
        viewport.classList.toggle("is-zoomed", zoom > 1);

        const overlay = viewport.closest(".descriptive-distribution-overlay");
        const label = overlay?.querySelector("[data-distribution-zoom-label]");
        if (label) label.textContent = `${Math.round(zoom * 100)}%`;
        overlay?.querySelectorAll("[data-distribution-zoom]").forEach((button) => {
            const action = button.dataset.distributionZoom;
            button.disabled = (action === "out" && zoom <= 1)
                || (action === "in" && zoom >= DISTRIBUTION_ZOOM_LEVELS[DISTRIBUTION_ZOOM_LEVELS.length - 1])
                || (action === "reset" && zoom === 1);
        });

        if (zoom === previousZoom) return;
        const restoreAnchor = () => {
            viewport.scrollLeft = Math.max(0, contentX * viewport.scrollWidth - anchorX);
            viewport.scrollTop = Math.max(0, contentY * viewport.scrollHeight - anchorY);
        };
        restoreAnchor();
        window.requestAnimationFrame(restoreAnchor);
    }

    function nextDistributionZoom(currentZoom, direction) {
        const current = clampDistributionZoom(currentZoom);
        if (direction > 0) {
            return DISTRIBUTION_ZOOM_LEVELS.find((level) => level > current + 0.01)
                || DISTRIBUTION_ZOOM_LEVELS[DISTRIBUTION_ZOOM_LEVELS.length - 1];
        }
        return [...DISTRIBUTION_ZOOM_LEVELS].reverse().find((level) => level < current - 0.01)
            || DISTRIBUTION_ZOOM_LEVELS[0];
    }

    function bindDistributionControls(content, column, hasAfter) {
        content.querySelectorAll("[data-distribution-series]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.distributionSeries === "after" ? "afterVisible" : "beforeVisible";
                state.distributionView[key] = !state.distributionView[key];
                refreshDistributionOverlay(column, hasAfter);
            });
        });
        content.querySelectorAll("[data-distribution-zoom]").forEach((button) => {
            button.addEventListener("click", () => {
                const action = button.dataset.distributionZoom;
                const viewport = button.closest(".descriptive-distribution-overlay")?.querySelector("[data-distribution-viewport]");
                const zoom = action === "in"
                    ? nextDistributionZoom(state.distributionView.zoom, 1)
                    : (action === "out" ? nextDistributionZoom(state.distributionView.zoom, -1) : 1);
                applyDistributionZoom(viewport, zoom);
            });
        });

        const viewport = content.querySelector("[data-distribution-viewport]");
        if (!viewport) return;

        viewport.addEventListener("wheel", (event) => {
            const current = clampDistributionZoom(state.distributionView.zoom);
            const next = clampDistributionZoom(current * (event.deltaY < 0 ? 1.12 : (1 / 1.12)));
            if (next === current) return;
            event.preventDefault();
            applyDistributionZoom(viewport, next, event.clientX, event.clientY);
        }, { passive: false });

        let mousePan = null;
        viewport.addEventListener("pointerdown", (event) => {
            if ((event.pointerType !== "mouse" && event.pointerType !== "pen")
                || (event.button !== 0 && event.button !== 1)
                || state.distributionView.zoom <= 1) return;
            event.preventDefault();
            viewport.setPointerCapture?.(event.pointerId);
            mousePan = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                scrollLeft: viewport.scrollLeft,
                scrollTop: viewport.scrollTop
            };
            viewport.classList.add("is-panning");
        });
        viewport.addEventListener("pointermove", (event) => {
            if (!mousePan || mousePan.pointerId !== event.pointerId) return;
            event.preventDefault();
            viewport.scrollLeft = mousePan.scrollLeft - (event.clientX - mousePan.x);
            viewport.scrollTop = mousePan.scrollTop - (event.clientY - mousePan.y);
        });
        const stopMousePan = (event) => {
            if (!mousePan || mousePan.pointerId !== event.pointerId) return;
            viewport.releasePointerCapture?.(event.pointerId);
            mousePan = null;
            viewport.classList.remove("is-panning");
        };
        viewport.addEventListener("pointerup", stopMousePan);
        viewport.addEventListener("pointercancel", stopMousePan);

        let touchGesture = null;
        const touchDistance = (touches) => Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
        const touchCenter = (touches) => ({
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        });
        viewport.addEventListener("touchstart", (event) => {
            if (event.touches.length >= 2) {
                event.preventDefault();
                touchGesture = {
                    kind: "pinch",
                    distance: Math.max(touchDistance(event.touches), 1),
                    zoom: clampDistributionZoom(state.distributionView.zoom)
                };
                viewport.classList.add("is-panning");
            } else if (event.touches.length === 1 && state.distributionView.zoom > 1) {
                event.preventDefault();
                touchGesture = {
                    kind: "pan",
                    x: event.touches[0].clientX,
                    y: event.touches[0].clientY,
                    scrollLeft: viewport.scrollLeft,
                    scrollTop: viewport.scrollTop
                };
                viewport.classList.add("is-panning");
            }
        }, { passive: false });
        viewport.addEventListener("touchmove", (event) => {
            if (event.touches.length >= 2) {
                event.preventDefault();
                if (!touchGesture || touchGesture.kind !== "pinch") {
                    touchGesture = {
                        kind: "pinch",
                        distance: Math.max(touchDistance(event.touches), 1),
                        zoom: clampDistributionZoom(state.distributionView.zoom)
                    };
                }
                const center = touchCenter(event.touches);
                applyDistributionZoom(
                    viewport,
                    touchGesture.zoom * touchDistance(event.touches) / touchGesture.distance,
                    center.x,
                    center.y
                );
                viewport.classList.add("is-panning");
            } else if (event.touches.length === 1 && touchGesture?.kind === "pan") {
                event.preventDefault();
                viewport.scrollLeft = touchGesture.scrollLeft - (event.touches[0].clientX - touchGesture.x);
                viewport.scrollTop = touchGesture.scrollTop - (event.touches[0].clientY - touchGesture.y);
            }
        }, { passive: false });
        const stopTouchGesture = (event) => {
            if (event.touches.length >= 2) return;
            if (event.touches.length === 1 && state.distributionView.zoom > 1) {
                touchGesture = {
                    kind: "pan",
                    x: event.touches[0].clientX,
                    y: event.touches[0].clientY,
                    scrollLeft: viewport.scrollLeft,
                    scrollTop: viewport.scrollTop
                };
                return;
            }
            touchGesture = null;
            viewport.classList.remove("is-panning");
        };
        viewport.addEventListener("touchend", stopTouchGesture, { passive: true });
        viewport.addEventListener("touchcancel", stopTouchGesture, { passive: true });

        viewport.addEventListener("keydown", (event) => {
            if (!["+", "=", "-", "0"].includes(event.key)) return;
            event.preventDefault();
            const zoom = (event.key === "+" || event.key === "=")
                ? nextDistributionZoom(state.distributionView.zoom, 1)
                : (event.key === "-" ? nextDistributionZoom(state.distributionView.zoom, -1) : 1);
            applyDistributionZoom(viewport, zoom);
        });
    }

    function columnTypeLabel(column) {
        const category = getColumnTypeCategory(column);
        if (category === "CONTINUOUS") return "연속형";
        if (category === "CATEGORICAL") return "범주형";
        if (category === "TEMPORAL") return "일시형";
        return "기타";
    }

    function renderDetailColumnList(selectedColumnName) {
        const columns = getDetailColumns();
        const filters = getTypeFilterOptions();
        return `<aside class="descriptive-column-rail" aria-label="분석 컬럼 탐색">
            <header><b>컬럼 · 변화 큰 순</b><small>${state.columnSearchQuery ? `${columns.length}/${state.data.columns.length}` : columns.length}개</small></header>
            <div class="descriptive-column-search">
                <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" data-column-search value="${escapeHtml(state.columnSearchQuery)}" placeholder="컬럼 ID 또는 라벨 검색" aria-label="컬럼 ID 또는 컬럼 라벨 검색">
                <button type="button" data-column-search-clear ${state.columnSearchQuery ? "" : "hidden"} aria-label="컬럼 검색어 지우기" title="검색어 지우기"><i class="fas fa-times" aria-hidden="true"></i></button>
            </div>
            <div class="descriptive-column-type-filters" role="group" aria-label="컬럼 분석 유형 필터">
                ${filters.map(([value, label, count]) => `<button type="button" data-column-type-filter="${value}" class="${state.detailTypeFilter === value ? "is-active" : ""}" aria-pressed="${state.detailTypeFilter === value}"><span>${label}</span><em>${count}</em></button>`).join("")}
            </div>
            <div class="descriptive-column-list">${columns.map((item) => {
            const score = item.insight?.importanceScore || 0;
            const level = score >= 70 ? "high" : (score >= 30 ? "medium" : "low");
            return `<button type="button" data-detail-column="${escapeHtml(item.columnName)}" class="is-${level} ${item.columnName === selectedColumnName ? "is-active" : ""}" aria-current="${item.columnName === selectedColumnName}"><i></i><span><b>${escapeHtml(item.columnName)}</b><small>${escapeHtml(item.columnComment || item.dataType || "-")}</small></span><em>${escapeHtml(columnTypeLabel(item))}</em></button>`;
        }).join("") || `<p class="descriptive-column-rail-empty">선택한 유형의 컬럼이 없습니다.</p>`}</div></aside>`;
    }

    function bindColumnSidebar(content) {
        const searchInput = content.querySelector("[data-column-search]");
        const applySearch = (value) => {
            state.columnSearchQuery = String(value || "");
            if (state.selectedColumnName !== OVERVIEW_VALUE) {
                const columns = getDetailColumns();
                if (!columns.some((column) => column.columnName === state.selectedColumnName)) {
                    state.selectedColumnName = columns[0]?.columnName || "";
                }
            }
            renderSelectedColumn();
            const nextInput = state.root?.querySelector("[data-column-search]");
            if (nextInput) {
                nextInput.focus();
                const end = nextInput.value.length;
                nextInput.setSelectionRange?.(end, end);
            }
        };
        if (searchInput) {
            let isComposing = false;
            const scheduleSearch = () => {
                if (isComposing) return;
                if (state.columnSearchTimer) window.clearTimeout(state.columnSearchTimer);
                state.columnSearchTimer = window.setTimeout(() => {
                    state.columnSearchTimer = null;
                    applySearch(searchInput.value);
                }, 140);
            };
            searchInput.addEventListener("compositionstart", () => { isComposing = true; });
            searchInput.addEventListener("compositionend", () => {
                isComposing = false;
                scheduleSearch();
            });
            searchInput.addEventListener("input", scheduleSearch);
            searchInput.addEventListener("keydown", (event) => {
                if (event.key !== "Escape" || !searchInput.value) return;
                event.preventDefault();
                event.stopPropagation();
                if (state.columnSearchTimer) window.clearTimeout(state.columnSearchTimer);
                state.columnSearchTimer = null;
                applySearch("");
            });
        }
        content.querySelector("[data-column-search-clear]")?.addEventListener("click", () => {
            if (state.columnSearchTimer) window.clearTimeout(state.columnSearchTimer);
            state.columnSearchTimer = null;
            applySearch("");
        });
        content.querySelectorAll("[data-column-type-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                state.detailTypeFilter = button.dataset.columnTypeFilter || "ALL";
                if (state.selectedColumnName !== OVERVIEW_VALUE) {
                    const columns = getDetailColumns();
                    if (!columns.some((column) => column.columnName === state.selectedColumnName)) {
                        state.selectedColumnName = columns[0]?.columnName || "";
                    }
                }
                renderSelectedColumn();
            });
        });
        content.querySelectorAll("[data-detail-column]").forEach((button) => {
            button.addEventListener("click", () => {
                state.selectedColumnName = button.dataset.detailColumn || "";
                activateView("detail");
            });
        });
    }

    function renderSelectedColumn() {
        const content = state.root?.querySelector("#descriptiveStatisticsContent");
        if (!content || !state.data) return;
        if (state.selectedColumnName === OVERVIEW_VALUE) {
            renderOverview();
            return;
        }
        if (!state.selectedColumnName) {
            state.root.querySelector("[role='dialog']")?.setAttribute("aria-busy", "false");
            content.innerHTML = `
                <div class="descriptive-profile-layout">
                ${renderDetailColumnList("")}
                <main class="descriptive-profile-detail"><div class="descriptive-statistics-state is-empty">
                    <i class="fas fa-filter-circle-xmark" aria-hidden="true"></i>
                    <strong>선택한 유형의 컬럼이 없습니다.</strong>
                    <p>다른 컬럼 유형을 선택해 주세요.</p>
                </div></main></div>
            `;
            bindColumnSidebar(content);
            return;
        }
        const column = state.data.columns.find((item) => item.columnName === state.selectedColumnName);
        if (!column) {
            setState("empty", "분석 가능한 컬럼이 없습니다.", "컬럼유형 분석 결과와 물리 스키마를 확인하세요.");
            return;
        }
        if (state.distributionView.columnName !== column.columnName) {
            state.distributionView = {
                columnName: column.columnName,
                beforeVisible: true,
                afterVisible: true,
                zoom: 1
            };
        }
        state.root.querySelector("[role='dialog']")?.setAttribute("aria-busy", "false");
        const hasAfter = Boolean(column.after && (state.data.basis === "BEFORE_AFTER" || state.data.after));
        const beforeValid = formatNumber(column.before?.valueCount);
        const beforeNull = formatNumber(column.before?.nullCount);
        const importanceScore = asFiniteNumber(column.insight?.importanceScore) || 0;
        const severityLevel = importanceScore >= 70 ? "high" : (importanceScore >= 30 ? "medium" : "low");
        const severityLabel = severityLevel === "high" ? "확인" : (severityLevel === "medium" ? "관찰" : "안정");
        const afterCounts = hasAfter
            ? `<span>${escapeHtml(state.data.after?.label || "수정 후")} 유효 ${escapeHtml(formatNumber(column.after?.valueCount))} · 결측 ${escapeHtml(formatNumber(column.after?.nullCount))}</span>`
            : "";
        content.innerHTML = `
            <div class="descriptive-profile-layout">
            ${renderDetailColumnList(column.columnName)}
            <main class="descriptive-profile-detail">
            <div class="descriptive-statistics-column-summary">
                <div>
                    <span class="descriptive-statistics-type">${escapeHtml(`${column.typeGroupCode || column.profileKind} · ${column.dataType || "-"}`)}</span>
                    <h3>${escapeHtml(column.columnName)}</h3>
                    <p>${escapeHtml(column.columnComment || "컬럼 설명 없음")}</p>
                </div>
                <div class="descriptive-statistics-counts">
                    <strong class="descriptive-statistics-severity is-${severityLevel}">변화 강도 ${escapeHtml(formatNumber(importanceScore))} · ${severityLabel}</strong>
                    <span>${escapeHtml(state.data.before?.label || (hasAfter ? "수정 전" : "현재"))} 유효 ${escapeHtml(beforeValid)} · 결측 ${escapeHtml(beforeNull)}</span>
                    ${afterCounts}
                </div>
            </div>
            ${state.data.notice ? `<div class="descriptive-statistics-notice"><i class="fas fa-circle-info" aria-hidden="true"></i>${escapeHtml(state.data.notice)}</div>` : ""}
            ${state.data.truncated ? `<div class="descriptive-statistics-notice"><i class="fas fa-circle-info" aria-hidden="true"></i>표시 가능한 기초통계 컬럼 수에 제한이 적용되었습니다.</div>` : ""}
            <div class="descriptive-statistics-grid">
                ${renderMetricGrid(column, hasAfter)}
                ${column.profileKind === "NUMERIC" ? renderComparisonBars(column, hasAfter) : renderTopValues(column, hasAfter)}
                ${column.profileKind === "NUMERIC" ? renderDistributionOverlay(column, hasAfter) : ""}
                ${column.profileKind === "NUMERIC" ? renderDistribution(column, hasAfter) : ""}
            </div>
            <p class="descriptive-statistics-methodology">
                <b>산정 기준</b>
                컬럼유형 분석 결과(CONTINUOUS/CATEGORICAL)를 물리 데이터타입보다 우선합니다.
                ${column.profileKind === "NUMERIC" ? "분산·표준편차는 전체 유효값을 모집단으로 계산하고, 첨도는 정규분포를 0으로 보는 초과첨도입니다. 문자형 숫자의 변환 실패값은 결측으로 집계합니다." : "범주·문자형은 고유값과 최빈값, 값 길이 및 상위 빈도를 제공하고 일시형은 최초·최종 시점을 함께 제공합니다."}
            </p>
            </main></div>
        `;
        bindColumnSidebar(content);
        bindDistributionControls(content, column, hasAfter);
    }

    async function open(options = {}) {
        const root = ensureRoot();
        state.opener = options.opener instanceof HTMLElement ? options.opener : document.activeElement;
        state.data = null;
        state.selectedColumnName = OVERVIEW_VALUE;
        state.overviewFilter = "ALL";
        state.detailTypeFilter = "ALL";
        state.columnSearchQuery = "";
        if (state.columnSearchTimer) window.clearTimeout(state.columnSearchTimer);
        state.columnSearchTimer = null;
        state.distributionView = {
            columnName: "",
            beforeVisible: true,
            afterVisible: true,
            zoom: 1
        };
        root.hidden = false;
        resetDialogPosition();
        lockBodyScroll();
        const title = root.querySelector("#descriptiveStatisticsTitle");
        const subtitle = root.querySelector("#descriptiveStatisticsSubtitle");
        if (title) title.textContent = options.title || "기초통계량";
        if (subtitle) subtitle.textContent = options.subtitle || "데이터 분포와 변경 전·후 차이를 비교합니다.";
        setLoading();
        root.querySelector("[role='dialog']")?.focus();

        const requestId = ++state.requestId;
        try {
            if (!options.url) throw new Error("기초통계량 조회 URL이 지정되지 않았습니다.");
            if (!window.CommonUtils?.request) throw new Error("공통 API 요청 함수를 사용할 수 없습니다.");
            const response = await window.CommonUtils.request(options.url, { method: "GET", showLoading: false });
            if (requestId !== state.requestId || root.hidden) return;
            state.data = normalizePayload(response?.data ?? response);
            if (!state.data.available) {
                setState(
                    "empty",
                    "기초통계량을 사용할 수 없습니다.",
                    state.data.reason || "현재 작업 상태에서는 저장된 기초통계량을 조회할 수 없습니다."
                );
                renderSources();
                return;
            }
            if (!state.data.columns.length) {
                setState("empty", "조회할 수 있는 컬럼이 없습니다.", "컬럼유형 분석 결과와 대상 테이블 스키마를 확인하세요.");
                renderSources();
                return;
            }
            renderSources();
            activateView("overview");
            root.querySelector("[data-statistics-view='overview']")?.focus();
        } catch (error) {
            if (requestId !== state.requestId || root.hidden) return;
            setState("error", "기초통계량을 불러오지 못했습니다.", error?.message || "잠시 후 다시 시도해 주세요.");
        }
    }

    function close() {
        if (!state.root || state.root.hidden) {
            unlockBodyScroll();
            return;
        }
        state.requestId += 1;
        endDialogDrag();
        state.root.hidden = true;
        state.data = null;
        state.selectedColumnName = "";
        state.detailTypeFilter = "ALL";
        state.columnSearchQuery = "";
        if (state.columnSearchTimer) window.clearTimeout(state.columnSearchTimer);
        state.columnSearchTimer = null;
        state.distributionView = {
            columnName: "",
            beforeVisible: true,
            afterVisible: true,
            zoom: 1
        };
        const opener = state.opener;
        state.opener = null;
        unlockBodyScroll();
        if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
    }

    window.DescriptiveStatistics = Object.freeze({ open, close });
})();
