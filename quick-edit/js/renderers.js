(function () {
    "use strict";

    const STATUS_LABELS = {
        PENDING: "대기",
        QUEUED: "대기열",
        SUBMITTED: "제출됨",
        STARTED: "시작",
        RUNNING: "실행 중",
        IN_PROGRESS: "진행 중",
        SUCCESS: "완료",
        FAILED: "실패",
        ERROR: "오류",
        SKIPPED: "건너뜀",
        CANCELLED: "취소"
    };

    const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "SUBMITTED", "STARTED", "RUNNING", "IN_PROGRESS"]);
    const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "ERROR", "CANCELLED"]);

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function asNumber(value, fallback = 0) {
        if (value === null || value === undefined || value === "") return fallback;
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function formatNumber(value, maximumFractionDigits = 2) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(number);
    }

    function formatRatio(value, maximumFractionDigits = 1) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        const percent = Math.abs(number) <= 1 ? number * 100 : number;
        return `${formatNumber(percent, maximumFractionDigits)}%`;
    }

    function getViolationNumericColumns(kind) {
        const columns = [
            "PREDICTED_VALUE",
            "ABS_ERROR",
            "ERROR_PCT",
            "TOLERANCE_PCT",
            "VIOLATION_SCORE",
            "RULE_CONFIDENCE",
            "RULE_LIFT"
        ];
        if (String(kind || "").trim().toLowerCase() === "continuous") {
            columns.push("ACTUAL_VALUE");
        }
        return new Set(columns);
    }

    function formatBytes(value) {
        let size = asNumber(value, 0);
        if (size <= 0) return "0 B";
        const units = ["B", "KB", "MB", "GB"];
        let index = 0;
        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index += 1;
        }
        return `${formatNumber(size, index === 0 ? 0 : 1)} ${units[index]}`;
    }

    function parseDateTime(value) {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        const text = String(value).trim();
        const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
                const parsedWithZone = new Date(text);
                return Number.isNaN(parsedWithZone.getTime()) ? null : parsedWithZone;
            }
            const [, year, month, day, hour, minute, second] = match;
            return new Date(Date.UTC(
                Number(year),
                Number(month) - 1,
                Number(day),
                Number(hour),
                Number(minute),
                Number(second)
            ));
        }
        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatDateTime(value) {
        if (!value) return "-";
        const raw = String(value);
        const parsed = parseDateTime(value);
        if (!parsed) return raw.replace("T", " ");
        return new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(parsed);
    }

    function formatFullDateTime(value) {
        if (!value) return "생성시간 확인 불가";
        const parsed = parseDateTime(value);
        if (!parsed) return String(value).replace("T", " ");
        const parts = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).formatToParts(parsed).map((part) => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
    }

    function formatDuration(startValue, endValue = null, status = "") {
        const normalizedStatus = normalizeStatus(status);
        if (!endValue && ["PENDING", "QUEUED", "SUBMITTED"].includes(normalizedStatus)) return "-";
        if (!startValue) return "-";
        const start = parseDateTime(startValue);
        const end = endValue ? parseDateTime(endValue) : new Date();
        if (!start || !end || end < start) return "-";
        const totalSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours) return `${hours}시간 ${minutes}분 ${seconds}초`;
        if (minutes) return `${minutes}분 ${seconds}초`;
        return `${seconds}초`;
    }

    function normalizeStatus(value) {
        return String(value || "PENDING").trim().toUpperCase();
    }

    function statusClass(value) {
        const status = normalizeStatus(value);
        if (status === "SUCCESS") return "is-success";
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) return "is-failed";
        if (status === "SKIPPED") return "is-skipped";
        if (ACTIVE_STATUSES.has(status) && status !== "PENDING") return "is-running";
        return "is-pending";
    }

    function statusLabel(value) {
        const status = normalizeStatus(value);
        return STATUS_LABELS[status] || status;
    }

    function renderStatus(value) {
        const status = normalizeStatus(value);
        return `<span class="qe-status ${statusClass(status)}"><span aria-hidden="true"></span>${escapeHtml(statusLabel(status))}</span>`;
    }

    function renderKpis(items) {
        const safeItems = Array.isArray(items) ? items : [];
        if (!safeItems.length) return '<p class="qe-empty">표시할 요약 지표가 없습니다.</p>';
        return safeItems.map((item) => {
            const toneClass = item.tone === "primary"
                ? " is-primary"
                : (item.tone === "mint" ? " is-mint" : "");
            return `
            <article class="qe-kpi-card${toneClass}">
                <span class="qe-kpi-label">${escapeHtml(item.label)}</span>
                <strong class="qe-kpi-value">${escapeHtml(item.value)}</strong>
                ${item.help ? `<small>${escapeHtml(item.help)}</small>` : ""}
            </article>`;
        }).join("");
    }

    function renderBars(items, options = {}) {
        const safeItems = (Array.isArray(items) ? items : []).filter((item) => Number.isFinite(Number(item.value)));
        if (!safeItems.length) return '<p class="qe-empty">그래프로 표시할 데이터가 없습니다.</p>';
        const maxValue = Math.max(...safeItems.map((item) => Math.abs(Number(item.value))), 1);
        const accentClass = options.accent === "mint" ? "is-mint" : "";
        const interactive = Boolean(options.interactive && options.filterKind && options.filterType);
        const activeFilter = options.activeFilter || {};
        const selectedType = String(activeFilter.type || "ALL").toUpperCase();
        const selectedValue = String(activeFilter.value || "").toUpperCase();
        const filterKind = String(options.filterKind || "").toLowerCase();
        const filterType = String(options.filterType || "").toUpperCase();
        const clickIcon = `<svg class="qe-bar-click-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-8 8M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></svg>`;
        const allControl = interactive ? `<div class="qe-bar-filter-tools">
            <button type="button" class="qe-bar-filter-all${selectedType === "ALL" ? " is-selected" : ""}"
                    data-rule-filter-kind="${escapeHtml(filterKind)}" data-rule-filter-type="ALL" data-rule-filter-value=""
                    data-rule-filter-label="전체" aria-pressed="${selectedType === "ALL" ? "true" : "false"}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
                <span>전체</span>
            </button>
            <span>${clickIcon} 범례를 눌러 상위 규칙 필터</span>
        </div>` : "";
        return `${allControl}<div class="qe-bar-chart ${accentClass}${interactive ? " is-interactive" : ""}" role="${interactive ? "group" : "img"}" aria-label="${escapeHtml(options.ariaLabel || "분포 그래프")}">${safeItems.map((item) => {
            const number = Number(item.value);
            const width = Math.max(number === 0 ? 0 : 3, Math.min(100, Math.abs(number) / maxValue * 100));
            const filterValue = String(item.key ?? item.label ?? "");
            const selected = interactive && selectedType === filterType && selectedValue === filterValue.toUpperCase();
            const rowContent = `
                <span class="qe-bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
                <span class="qe-bar-track"><span class="qe-bar-fill" style="width:${width.toFixed(2)}%"></span></span>
                <strong class="qe-bar-value">${escapeHtml(item.display ?? formatNumber(number))}</strong>
                ${interactive ? clickIcon : ""}`;
            return interactive
                ? `<button type="button" class="qe-bar-row is-filterable${selected ? " is-selected" : ""}"
                           data-rule-filter-kind="${escapeHtml(filterKind)}" data-rule-filter-type="${escapeHtml(filterType)}"
                           data-rule-filter-value="${escapeHtml(filterValue)}" data-rule-filter-label="${escapeHtml(item.label)}"
                           aria-pressed="${selected ? "true" : "false"}" title="${escapeHtml(item.label)} 상위 규칙 보기">${rowContent}</button>`
                : `<div class="qe-bar-row">${rowContent}</div>`;
        }).join("")}</div>`;
    }

    function getColumnLabel(columnName, columnComments = {}) {
        const column = String(columnName || "").trim();
        if (!column) return "-";
        const comment = String(columnComments?.[column] || columnComments?.[column.toUpperCase()] || "").trim();
        return comment && comment.toUpperCase() !== column.toUpperCase()
            ? `${column} · ${comment}`
            : column;
    }

    function annotateColumnText(value, columnComments = {}) {
        let text = String(value || "");
        const columns = Object.keys(columnComments || {})
            .filter(Boolean)
            .sort((left, right) => right.length - left.length);
        columns.forEach((column) => {
            const comment = String(columnComments[column] || "").trim();
            if (!comment || comment.toUpperCase() === column.toUpperCase()) return;
            const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            text = text.replace(
                new RegExp(`(^|[^A-Za-z0-9_$#])${escaped}(?=$|[^A-Za-z0-9_$#])`, "gi"),
                (_match, prefix) => `${prefix}${column}[${comment}]`
            );
        });
        return text;
    }

    function getViolationCount(rule, options = {}) {
        const key = String(rule?.RULE_ID || "");
        const counts = options.violationCounts;
        const mappedValue = counts instanceof Map ? counts.get(key) : counts?.[key];
        const value = mappedValue ?? rule?.VIOLATION_COUNT;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function getRuleKey(rule) {
        return [rule?.RULE_ID, rule?.TARGET_COLUMN || rule?.RESULT_COLUMN]
            .map((value) => String(value ?? "").trim().toUpperCase())
            .join("|");
    }

    function compareText(left, right) {
        return String(left ?? "").localeCompare(String(right ?? ""), "ko");
    }

    function isSimpleLinearRule(rule) {
        if (String(rule?.SIMPLE_LINEAR_YN || "").toUpperCase() === "Y") return true;
        const method = String(rule?.METHOD || rule?.RULE_METHOD || "").trim().toUpperCase();
        if (!/(^|_)LINEAR($|_)/.test(method)) return false;
        const complexity = asNumber(rule?.COMPLEXITY ?? rule?.RULE_COMPLEXITY, Number.POSITIVE_INFINITY);
        const features = Array.isArray(rule?.FEATURE_LIST)
            ? rule.FEATURE_LIST.filter(Boolean)
            : String(rule?.FEATURE_COLUMNS || "").split(",").map((item) => item.trim()).filter(Boolean);
        return complexity <= 3 || (features.length >= 1 && features.length <= 2);
    }

    function prioritizeCategoricalRules(rules, violationRules, limit = 12) {
        const baseRules = Array.isArray(rules) ? rules : [];
        const priorityRules = Array.isArray(violationRules) ? violationRules : [];
        const baseMap = new Map(baseRules.map((rule) => [getRuleKey(rule), rule]));
        const merged = [];
        const seen = new Set();
        [...priorityRules, ...baseRules].forEach((rule) => {
            const key = getRuleKey(rule);
            if (!key || seen.has(key)) return;
            seen.add(key);
            const base = baseMap.get(key) || {};
            merged.push({
                ...base,
                ...rule,
                RESULT_VALUE: rule.RESULT_VALUE ?? rule.EXPECTED_VALUE ?? base.RESULT_VALUE,
                RESULT_TEXT: rule.RESULT_TEXT ?? base.RESULT_TEXT
            });
        });
        merged.sort((left, right) => (
            asNumber(right.VIOLATION_COUNT) - asNumber(left.VIOLATION_COUNT)
            || asNumber(right.CONDITION_COUNT) - asNumber(left.CONDITION_COUNT)
            || asNumber(right.AVG_VIOLATION_SCORE) - asNumber(left.AVG_VIOLATION_SCORE)
            || asNumber(right.RULE_CONFIDENCE) - asNumber(left.RULE_CONFIDENCE)
            || compareText(left.RULE_ID, right.RULE_ID)
        ));
        return merged.slice(0, Math.max(1, asNumber(limit, 12)));
    }

    function prioritizeContinuousRules(rules, violationRules, limit = 12) {
        const baseRules = Array.isArray(rules) ? rules : [];
        const priorityRules = Array.isArray(violationRules) ? violationRules : [];
        const baseMap = new Map(baseRules.map((rule) => [getRuleKey(rule), rule]));
        const merged = [];
        const seen = new Set();
        [...priorityRules, ...baseRules].forEach((rule) => {
            const key = getRuleKey(rule);
            if (!key || seen.has(key)) return;
            seen.add(key);
            const base = baseMap.get(key) || {};
            const featureColumns = rule.FEATURE_COLUMNS ?? base.FEATURE_COLUMNS ?? "";
            merged.push({
                ...base,
                ...rule,
                SCORE: rule.SCORE ?? rule.RULE_SCORE ?? base.SCORE,
                COMPLEXITY: rule.COMPLEXITY ?? rule.RULE_COMPLEXITY ?? base.COMPLEXITY,
                METHOD: rule.METHOD ?? rule.RULE_METHOD ?? base.METHOD,
                FEATURE_COLUMNS: featureColumns,
                FEATURE_LIST: rule.FEATURE_LIST ?? base.FEATURE_LIST
                    ?? String(featureColumns).split(",").map((item) => item.trim()).filter(Boolean)
            });
        });
        const isLinear = (rule) => /(^|_)LINEAR($|_)/.test(String(rule.METHOD || "").toUpperCase());
        merged.sort((left, right) => (
            asNumber(right.VIOLATION_COUNT) - asNumber(left.VIOLATION_COUNT)
            || Number(isSimpleLinearRule(right)) - Number(isSimpleLinearRule(left))
            || Number(isLinear(right)) - Number(isLinear(left))
            || asNumber(right.MAX_ERROR_PCT) - asNumber(left.MAX_ERROR_PCT)
            || asNumber(right.SCORE) - asNumber(left.SCORE)
            || compareText(left.RULE_ID, right.RULE_ID)
        ));
        return merged.slice(0, Math.max(1, asNumber(limit, 12)));
    }

    function getRuleGroupValue(rule, kind, filterType) {
        const normalizedKind = String(kind || "").toLowerCase();
        const normalizedType = String(filterType || "").toUpperCase();
        if (normalizedKind === "categorical") {
            if (normalizedType === "CONDITION_COUNT") return String(Math.max(0, asNumber(rule?.CONDITION_COUNT, 0)));
            if (normalizedType === "RESULT_COLUMN") return String(rule?.RESULT_COLUMN || "").trim().toUpperCase();
        }
        if (normalizedKind === "continuous") {
            if (normalizedType === "TARGET_COLUMN") return String(rule?.TARGET_COLUMN || "").trim().toUpperCase();
            if (normalizedType === "METHOD") return String(rule?.METHOD || "").trim().toUpperCase();
        }
        return "";
    }

    function selectBalancedRules(rules, kind, activeFilter = {}, limit = 12) {
        const rankedRules = Array.isArray(rules) ? rules : [];
        const normalizedKind = String(kind || "").toLowerCase();
        const dimensions = normalizedKind === "categorical"
            ? ["CONDITION_COUNT", "RESULT_COLUMN"]
            : (normalizedKind === "continuous" ? ["TARGET_COLUMN", "METHOD"] : []);
        const filterType = String(activeFilter?.type || "ALL").toUpperCase();
        const filterValue = String(activeFilter?.value || "").trim().toUpperCase();
        const filtered = dimensions.includes(filterType) && filterValue
            ? rankedRules.filter((rule) => getRuleGroupValue(rule, normalizedKind, filterType) === filterValue)
            : rankedRules;
        const boundedLimit = Math.max(1, asNumber(limit, 12));
        if (!dimensions.length || filtered.length <= 1) return filtered.slice(0, boundedLimit);

        const balanceDimensions = filterType === "ALL"
            ? dimensions
            : dimensions.filter((dimension) => dimension !== filterType);
        const selected = [];
        const selectedKeys = new Set();
        const coveredValues = new Map(balanceDimensions.map((dimension) => [dimension, new Set()]));
        const addRule = (rule) => {
            const ruleKey = getRuleKey(rule);
            if (!ruleKey || selectedKeys.has(ruleKey) || selected.length >= boundedLimit) return;
            selected.push(rule);
            selectedKeys.add(ruleKey);
            balanceDimensions.forEach((dimension) => {
                const value = getRuleGroupValue(rule, normalizedKind, dimension);
                if (value) coveredValues.get(dimension).add(value);
            });
        };

        if (normalizedKind === "continuous") {
            const hasViolatedRule = filtered.some((rule) => asNumber(rule?.VIOLATION_COUNT) > 0);
            const simpleLinearRule = filtered.find((rule) => (
                isSimpleLinearRule(rule)
                && (!hasViolatedRule || asNumber(rule?.VIOLATION_COUNT) > 0)
            ));
            if (simpleLinearRule) addRule(simpleLinearRule);
        }

        balanceDimensions.forEach((dimension) => {
            filtered.forEach((rule) => {
                const value = getRuleGroupValue(rule, normalizedKind, dimension);
                if (!value || coveredValues.get(dimension).has(value)) return;
                addRule(rule);
            });
        });
        filtered.forEach((rule) => {
            addRule(rule);
        });
        const rankByKey = new Map(filtered.map((rule, index) => [getRuleKey(rule), index]));
        return selected.sort((left, right) => (
            asNumber(rankByKey.get(getRuleKey(left)), Number.MAX_SAFE_INTEGER)
            - asNumber(rankByKey.get(getRuleKey(right)), Number.MAX_SAFE_INTEGER)
        ));
    }

    function filterLegendItems(items, rules, kind, filterType) {
        const availableValues = new Set(
            (Array.isArray(rules) ? rules : [])
                .map((rule) => getRuleGroupValue(rule, kind, filterType))
                .filter(Boolean)
        );
        return (Array.isArray(items) ? items : []).filter((item) => {
            const itemValue = String(item?.key ?? "").trim().toUpperCase();
            return itemValue && availableValues.has(itemValue);
        });
    }

    function renderCategoricalRules(rules, options = {}) {
        const safeRules = Array.isArray(rules) ? rules : [];
        if (!safeRules.length) return '<p class="qe-empty">발견된 범주형 규칙이 없습니다.</p>';
        return safeRules.map((rule, index) => {
            const condition = annotateColumnText(rule.CONDITION_TEXT || rule.CONDITION_COLUMN || "조건 정보 없음", options.columnComments);
            const result = annotateColumnText(rule.RESULT_TEXT || [rule.RESULT_COLUMN, rule.RESULT_VALUE].filter(Boolean).join(" = ") || "결과 정보 없음", options.columnComments);
            const violationCount = getViolationCount(rule, options);
            return `<button type="button" class="qe-rule-card" data-rule-kind="categorical" data-rule-index="${index}">
                <span class="qe-rule-head"><strong>규칙 ${escapeHtml(rule.RULE_ID || index + 1)}</strong><span>${escapeHtml(getColumnLabel(rule.RESULT_COLUMN || "범주형", options.columnComments))}</span></span>
                <span class="qe-rule-body"><span>${escapeHtml(condition)}</span><b aria-hidden="true">→</b><span>${escapeHtml(result)}</span></span>
                <span class="qe-rule-metrics">
                    <span class="qe-metric">신뢰도 <strong>${escapeHtml(formatRatio(rule.RULE_CONFIDENCE))}</strong></span>
                    <span class="qe-metric">지지도 <strong>${escapeHtml(formatRatio(rule.RULE_SUPPORT))}</strong></span>
                    <span class="qe-metric">향상도 <strong>${escapeHtml(formatNumber(rule.RULE_LIFT, 2))}</strong></span>
                    ${violationCount === null ? "" : `<span class="qe-metric is-warning">위반 <strong>${escapeHtml(formatNumber(violationCount, 0))}건</strong></span>`}
                </span>
            </button>`;
        }).join("");
    }

    function renderContinuousRules(rules, options = {}) {
        const safeRules = Array.isArray(rules) ? rules : [];
        if (!safeRules.length) return '<p class="qe-empty">발견된 연속형 규칙이 없습니다.</p>';
        return safeRules.map((rule, index) => {
            const features = Array.isArray(rule.FEATURE_LIST)
                ? rule.FEATURE_LIST
                : String(rule.FEATURE_COLUMNS || "").split(",").map((item) => item.trim()).filter(Boolean);
            const violationCount = getViolationCount(rule, options);
            return `
            <button type="button" class="qe-rule-card" data-rule-kind="continuous" data-rule-index="${index}">
                <span class="qe-rule-head"><strong>${escapeHtml(getColumnLabel(rule.TARGET_COLUMN || `규칙 ${rule.RULE_ID || index + 1}`, options.columnComments))}</strong><span>${escapeHtml(rule.METHOD || "수식 규칙")}</span></span>
                <code class="qe-rule-expression">${escapeHtml(rule.EXPRESSION || "수식 정보 없음")}</code>
                ${features.length ? `<span class="qe-rule-columns">${features.slice(0, 6).map((column) => `<span>${escapeHtml(getColumnLabel(column, options.columnComments))}</span>`).join("")}</span>` : ""}
                <span class="qe-rule-metrics">
                    <span class="qe-metric">점수 <strong>${escapeHtml(formatNumber(rule.SCORE, 3))}</strong></span>
                    <span class="qe-metric">복잡도 <strong>${escapeHtml(formatNumber(rule.COMPLEXITY, 0))}</strong></span>
                    <span class="qe-metric">선택 <strong>${rule.SELECTED_YN === "Y" ? "예" : "아니오"}</strong></span>
                    ${violationCount === null ? "" : `<span class="qe-metric is-warning">위반 <strong>${escapeHtml(formatNumber(violationCount, 0))}건</strong></span>`}
                </span>
            </button>`;
        }).join("");
    }

    function stringify(value) {
        if (value === null || value === undefined || value === "") return "-";
        if (typeof value === "object") {
            try {
                return JSON.stringify(value, null, 2);
            } catch (_error) {
                return String(value);
            }
        }
        return String(value);
    }

    window.QuickEditRenderers = {
        ACTIVE_STATUSES,
        TERMINAL_STATUSES,
        asNumber,
        escapeHtml,
        formatBytes,
        formatDateTime,
        formatFullDateTime,
        formatDuration,
        formatNumber,
        formatRatio,
        getViolationNumericColumns,
        getColumnLabel,
        annotateColumnText,
        isSimpleLinearRule,
        prioritizeCategoricalRules,
        prioritizeContinuousRules,
        selectBalancedRules,
        filterLegendItems,
        normalizeStatus,
        parseDateTime,
        renderBars,
        renderCategoricalRules,
        renderContinuousRules,
        renderKpis,
        renderStatus,
        statusClass,
        statusLabel,
        stringify
    };
})();
