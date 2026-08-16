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

    function formatDateTime(value) {
        if (!value) return "-";
        const raw = String(value);
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return raw.replace("T", " ");
        return new Intl.DateTimeFormat("ko-KR", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(parsed);
    }

    function formatDuration(startValue, endValue = null) {
        if (!startValue) return "-";
        const start = new Date(startValue).getTime();
        const end = endValue ? new Date(endValue).getTime() : Date.now();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
        const totalSeconds = Math.floor((end - start) / 1000);
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
        return `<div class="qe-bar-chart ${accentClass}" role="img" aria-label="${escapeHtml(options.ariaLabel || "분포 그래프")}">${safeItems.map((item) => {
            const number = Number(item.value);
            const width = Math.max(number === 0 ? 0 : 3, Math.min(100, Math.abs(number) / maxValue * 100));
            return `<div class="qe-bar-row">
                <span class="qe-bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
                <span class="qe-bar-track"><span class="qe-bar-fill" style="width:${width.toFixed(2)}%"></span></span>
                <strong class="qe-bar-value">${escapeHtml(item.display ?? formatNumber(number))}</strong>
            </div>`;
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
        const value = counts instanceof Map ? counts.get(key) : counts?.[key];
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
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
        formatDuration,
        formatNumber,
        formatRatio,
        getColumnLabel,
        annotateColumnText,
        normalizeStatus,
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
