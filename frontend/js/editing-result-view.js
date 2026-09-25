(function(root) {
    "use strict";
    const ko = {
        "Condition rules (IF–THEN)": "조건규칙 (IF–THEN)", "Formula rules": "수식규칙",
        "Result type": "규칙 유형", "Discovery method": "발굴 방법", "All methods": "전체 방법",
        "OML association": "OML 연관규칙", "Symbolic regression": "기존 수식 발굴",
        "Mixed pattern discovery": "혼합형 패턴 발굴", "Loading rules…": "규칙을 불러오는 중입니다…",
        "Loading violations…": "위반 데이터를 불러오는 중입니다…", "Retry": "다시 시도",
        "Previous": "이전", "Next": "다음", "Page {page}": "{page}페이지", "{count} rules": "규칙 {count}개",
        "{count} saved rows": "저장된 행 {count}개", "Rows {start}–{end} of {total}": "전체 {total}개 중 {start}–{end}",
        "No rules in this selection.": "이 조건에 해당하는 규칙이 없습니다.",
        "No saved violation rows for this rule.": "이 규칙에 저장된 위반 행이 없습니다.",
        "Some results are unavailable. Counts describe the available results only.": "일부 결과를 조회하지 못했습니다. 건수는 조회된 결과만 나타냅니다.",
        "Historical anomaly explanations": "과거 이상 후보 설명",
        "{count} stored results have an unrecognized expression type. They are excluded from these two lists; review the original source analysis.": "저장된 결과 {count}개의 표현 유형을 확인할 수 없습니다. 두 목록에 임의로 포함하지 않았으므로 원래 발굴 방법 상세에서 확인하세요.",
        "These explain model anomaly candidates and are separate from actual-value editing rules.": "모델의 이상 후보를 설명하는 과거 결과이며 실제 값의 에디팅 규칙과 구분합니다.",
        "Methods remain attached to each rule. Their scores have different meanings.": "규칙별 발굴 방법과 원래 검증 지표를 유지합니다. 방법별 점수의 의미는 서로 다릅니다.",
        "The same data row may violate several rules; violation counts are not unique error counts.": "동일한 데이터 행이 여러 규칙을 위반할 수 있으므로 위반 건수는 고유 오류 건수와 다릅니다.",
        "Rule details and violations": "규칙 상세·위반 데이터", "Target column": "대상 컬럼",
        "Applies when": "적용 조건", "All applicable rows": "전체 적용 대상 행",
        "Confidence": "신뢰도", "Lift": "향상도", "Support": "지지도", "Score": "점수",
        "Validation confidence": "검증 신뢰도", "Tolerance coverage": "허용오차 충족률",
        "Validation tolerance coverage": "검증 허용오차 충족률", "Validation R²": "검증 R²",
        "Absolute tolerance": "절대 허용오차", "Relative tolerance": "상대 허용오차",
        "Violations (rule × row)": "위반 건수 (규칙×행)", "Selected": "선택", "Not selected": "미선택",
        "Back to rules": "규칙 목록", "Source analysis": "발굴 방법 상세",
        "Formula chart": "수식 그래프", "Export": "내보내기", "Saved violation preview": "저장된 위반 미리보기",
        "Saved rows may be limited by the execution settings; this is not a new scan of the source.": "실행 설정에 따라 저장 행이 제한될 수 있습니다. 원본을 새로 탐지한 결과가 아닙니다.",
        "Details": "상세", "Rule ID": "규칙 ID", "Model": "모델", "Target": "대상",
        "Stored expression is unavailable.": "저장된 규칙 표현을 확인할 수 없습니다.",
        "Stored condition is unavailable.": "저장된 적용 조건을 확인할 수 없습니다.",
        "Original rule scope": "원래 규칙의 적용 범위",
        "Browse conditional and formula rules. Discovery methods and their original metrics remain attached to each rule.": "조건규칙과 수식규칙을 확인합니다. 각 규칙의 발굴 방법과 원래 검증 지표는 유지됩니다.",
        "Load statistics": "기초통계 불러오기", "Load column types": "컬럼 유형 불러오기", "Loading…": "불러오는 중…",
        "Saved preview rows": "저장된 미리보기 행", "Back to editing results": "통합 규칙 목록으로",
        "Load analysis diagnostics": "분석 진단 불러오기", "Discovery diagnostics": "발굴 진단",
        "No legacy formula diagnostics were recorded for this execution.": "이 실행에는 기존 수식 발굴의 상세 진단이 기록되지 않았습니다.",
        "Review the original discovery diagnostics; a zero count alone does not identify the cause.": "원래 발굴 진단을 확인하세요. 규칙 0건만으로 원인을 판단할 수 없습니다.",
        "This preview contains saved rows for the selected source and rule. It is not a unique error count across models.": "선택한 발굴 방법·규칙에 저장된 행입니다. 여러 모델을 합친 고유 오류 건수가 아닙니다."
    };
    Object.assign(ko, {
        "Condition count": "규칙 조건 개수", "All counts": "전체 개수", "Not recorded": "미기록",
        "{count} conditions": "조건 {count}개", "Exclude zero violations": "위반 0건 제외",
        "Review order: violations first, highest count first; zero counts last.": "검토 순서: 위반 있는 규칙 → 위반 많은 순 → 0건 마지막",
        "Counts use detected totals when recorded, otherwise saved rows. Missing detection counts are not zero; confidence is not an error probability.": "건수는 기록된 탐지 총건수를 우선 사용하며, 그 외에는 저장된 행 기준입니다. 탐지 미기록은 0건이 아니며 신뢰도는 오류 확률이 아닙니다.",
        "Rule details": "규칙 상세",
        "Stored detection counts disagree with the rule coverage. Review the detection run before treating this as zero violations.": "저장된 탐지 건수와 규칙 충족 건수가 일치하지 않습니다. 위반 없음으로 판단하지 말고 탐지 실행을 확인하세요.",
        "Condition rows": "조건 적용 행", "Satisfied rows": "규칙 충족 행", "Saved rows": "저장된 행", "Execution information": "실행 식별 정보",
        "Detected violations": "검출된 위반", "Saved violations": "저장된 위반",
        "Violations were detected, but no preview rows were saved for this rule. Check the preview limit and detection execution.": "위반은 검출되었지만 이 규칙의 미리보기 행이 저장되지 않았습니다. 미리보기 저장 한도와 탐지 실행을 확인하세요.",
        "No saved rows does not establish that the source has no violations. Check whether detection ran and its saved-row limits.": "저장된 행이 없다는 뜻이며 원본의 위반이 없다고 확정할 수 없습니다. 탐지 실행 여부와 저장 한도를 확인하세요.",
        "Detection recorded zero violations for this rule.": "이 규칙의 탐지 결과에는 위반 0건이 기록되어 있습니다."
    });
    const sourceLabels = {LEGACY_ASSOC: "OML association", LEGACY_SYMBOLIC: "Symbolic regression", MIXED_PATTERN: "Mixed pattern discovery"};
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
    const present = (...values) => values.find((value) => value !== null && value !== undefined && value !== "");
    const number = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
    function language(options = {}) {
        let value = options.language || root.I18nManager?.getCurrentLanguage?.();
        try { value ||= root.sessionStorage?.getItem("initLanguageCode"); } catch (_) {}
        return String(value || "ko").toLowerCase().startsWith("en") ? "en" : "ko";
    }
    function translate(key, options = {}, params = {}) {
        const custom = options.t?.(key);
        let result = custom && custom !== key ? custom : language(options) === "ko" ? ko[key] || root.RuleResultCommon?.ko?.[key] || key : key;
        Object.entries(params).forEach(([name, value]) => { result = result.replaceAll(`{${name}}`, String(value)); });
        return result;
    }
    function format(value, options = {}) {
        const n = number(value);
        return n === null ? "—" : n.toLocaleString(language(options), {maximumFractionDigits: 6});
    }
    function metricPairs(entry, options = {}) {
        const row = entry.row || {}, metrics = entry.metrics || {};
        const value = (...keys) => present(...keys.map((key) => metrics[key]), ...keys.map((key) => row[key]));
        const pairs = [];
        const add = (label, v, percent = false) => {
            if (number(v) !== null) pairs.push({label: translate(label, options), value: percent ? `${format(Number(v) * 100, options)}%` : String(v)});
        };
        if (entry.source === "LEGACY_SYMBOLIC") {
            add("Score", value("SCORE", "score"));
        } else if (entry.family === "FORMULA") {
            add("Tolerance coverage", value("RULE_CONFIDENCE", "confidence", "trainConfidence"), true);
            add("Validation tolerance coverage", value("VALIDATION_CONFIDENCE", "validationConfidence"), true);
            add("Validation R²", value("VALIDATION_R2", "validationR2", "r2"));
            add("Absolute tolerance", value("ABSOLUTE_TOLERANCE", "absoluteTolerance"));
            add("Relative tolerance", value("RELATIVE_TOLERANCE", "relativeTolerance"));
        } else {
            add("Confidence", value("RULE_CONFIDENCE", "confidence"), true);
            add("Validation confidence", value("VALIDATION_CONFIDENCE", "validationConfidence"), true);
            add("Lift", value("RULE_LIFT", "lift"));
            add("Support", value("RULE_SUPPORT", "support"), true);
        }
        if (entry.review) add(entry.review.countBasis === "DETECTED_ROWS" ? "Detected violations" : "Saved violations", entry.review.violationCount);
        else add("Violations (rule × row)", value("VIOLATION_COUNT", "MATCH_COUNT", "violationCount"));
        return pairs;
    }
    function expression(entry) {
        const row = entry.row || {};
        if (entry.family === "FORMULA") {
            const ast = present(row.FORMULA_EXPRESSION, row.RESULT_AST?.expression);
            return {formula: present(row.EXPRESSION, row.RESULT_TEXT, entry.expression,
                ast ? `${entry.scope?.targetColumn || row.TARGET_COLUMN || row.RESULT_COLUMN || "?"} ≈ ${formulaText(ast)}` : null),
                condition: present(row.CONDITION_TEXT, entry.condition)};
        }
        return {condition: present(row.CONDITION_TEXT, entry.condition),
            result: present(row.RESULT_TEXT, entry.result,
                row.RESULT_COLUMN && row.RESULT_VALUE != null ? `${row.RESULT_COLUMN} = ${row.RESULT_VALUE}` : null)};
    }
    function formulaText(node, depth = 0) {
        if (typeof node === "string" || typeof node === "number") return String(node);
        if (!node || depth > 30) return "?";
        if (Object.hasOwn(node, "column")) return String(node.column);
        if (Object.hasOwn(node, "value")) return String(node.value);
        const operator = {ADD: "+", SUBTRACT: "−", MULTIPLY: "×", DIVIDE: "/"}[node.operator];
        return operator ? `(${formulaText(node.left, depth + 1)} ${operator} ${formulaText(node.right, depth + 1)})` : "?";
    }
    function annotateColumnText(value, comments = {}) {
        const labels = new Map(Object.entries(comments).map(([key, label]) => [key.toUpperCase(), String(label || "").trim()]));
        // One token pass: preserve quoted data values and never reprocess labels.
        return String(value ?? "").replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|[\p{L}_][\p{L}\p{N}_$#]*/gu, (token) => {
            if (token.startsWith("'")) return token;
            const name = token.startsWith('"') ? token.slice(1, -1).replace(/""/g, '"') : token;
            const label = labels.get(name.toUpperCase());
            return label && label.toUpperCase() !== name.toUpperCase() ? `${token}[${label}]` : token;
        });
    }
    function renderExpression(entry, options = {}) {
        const value = expression(entry), t = (key) => translate(key, options);
        const display = (value) => escapeHtml(annotateColumnText(value, entry.columnComments || options.columnComments || {}));
        const fallback = entry.source === "LEGACY_SYMBOLIC" ? t("Original rule scope")
            : entry.row?.CONDITION_COUNT != null && Number(entry.row.CONDITION_COUNT) === 0 ? t("All applicable rows") : t("Stored condition is unavailable.");
        if (entry.family === "FORMULA") {
            return `<div class="editing-result-expression"><code>${display(value.formula ?? t("Stored expression is unavailable."))}</code></div>
                <div class="editing-result-condition"><span>${escapeHtml(t("Applies when"))}</span><code>${display(value.condition || fallback)}</code></div>`;
        }
        return `<div class="editing-result-expression"><strong>IF</strong><code>${display(value.condition ?? fallback)}</code><strong>THEN</strong><code>${display(value.result ?? t("Stored expression is unavailable."))}</code></div>`;
    }
    function renderCard(entry, options = {}) {
        const t = (key) => translate(key, options), row = entry.row || {}, scope = entry.scope || {};
        const method = sourceLabels[entry.source] || entry.source || "Discovery method";
        const selected = row.SELECTED_YN === "N" ? `<span class="editing-result-selection">${escapeHtml(t("Not selected"))}</span>` : "";
        return `<article class="editing-result-card" data-editing-entry="${escapeHtml(entry.key)}">
            <header><strong>${escapeHtml(annotateColumnText(present(scope.targetColumn, row.TARGET_COLUMN, row.RESULT_COLUMN, t("Rule ID") + " " + (scope.ruleId ?? row.RULE_ID ?? "")), entry.columnComments || options.columnComments || {}))}</strong><span>${escapeHtml(t(method))}${row.METHOD ? ` · ${escapeHtml(row.METHOD)}` : ""}</span>${selected}</header>
            ${renderExpression(entry, options)}
            <dl class="editing-result-metrics">${metricPairs(entry, options).map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
            ${options.showOpen === false ? "" : `<button type="button" class="editing-result-button" data-editing-rule-key="${escapeHtml(entry.key)}">${escapeHtml(t("Rule details and violations"))} →</button>`}
        </article>`;
    }
    function pagination(data, options = {}) {
        const page = Math.max(1, Number(data.page) || 1), size = Math.max(1, Number(data.pageSize) || 20);
        const total = number(data.total), count = (data.rules || data.violations || []).length;
        const hasMore = data.hasMore === true || (total !== null && page * size < total);
        const summary = total === null ? translate("Page {page}", options, {page}) : translate("Rows {start}–{end} of {total}", options,
            {start: count ? format((page - 1) * size + 1, options) : "0", end: format((page - 1) * size + count, options), total: format(total, options)});
        return `<nav class="editing-result-pagination" aria-label="${escapeHtml(translate("Page {page}", options, {page}))}"><span>${escapeHtml(summary)}</span>
            <button type="button" data-editing-page="${page - 1}" ${page <= 1 || options.loading ? "disabled" : ""}>${escapeHtml(translate("Previous", options))}</button>
            <span>${escapeHtml(translate("Page {page}", options, {page}))}</span>
            <button type="button" data-editing-page="${page + 1}" ${!hasMore || options.loading ? "disabled" : ""}>${escapeHtml(translate("Next", options))}</button></nav>`;
    }
    function renderDiagnostics(data, options = {}) {
        const family = options.family || data.family, source = options.source || data.source || "ALL";
        if (family !== "FORMULA" || options.loading) return "";
        const summary = data.summary || {}, saved = data.diagnostics?.savedSummary || data.diagnostics?.mixedSummary || {};
        const sources = Array.isArray(summary.sourceCounts) ? summary.sourceCounts : [];
        const countFor = (name) => sources.find((item) => item.family === "FORMULA" && item.source === name);
        const blocks = [], t = (key) => translate(key, options);
        const mixed = countFor("MIXED_PATTERN");
        if (["ALL", "MIXED_PATTERN"].includes(source) && mixed?.status === "available" && Number(mixed.ruleCount) === 0 && root.RuleResultCommon?.continuousDiagnostic) {
            const diagnostic = root.RuleResultCommon.continuousDiagnostic({summary: saved, ruleSummary: {rules: []}}, t);
            blocks.push(`<h4>${escapeHtml(t(sourceLabels.MIXED_PATTERN))}</h4><p>${escapeHtml(diagnostic.message)}</p>
                <dl class="editing-result-metrics">${(diagnostic.metrics || []).map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
                ${(diagnostic.reasons || []).length ? `<ul>${diagnostic.reasons.map((item) => `<li>${escapeHtml(item.label)}: ${escapeHtml(item.count)}</li>`).join("")}</ul>` : ""}`);
        }
        const legacy = countFor("LEGACY_SYMBOLIC");
        if (["ALL", "LEGACY_SYMBOLIC"].includes(source) && legacy?.status === "available" && Number(legacy.ruleCount) === 0) {
            const diagnostic = saved.integratedEditing?.stages?.DISCOVER?.legacyDiagnostics;
            const tasks = (diagnostic?.tasks || []).filter((task) => /LASSO|SYMBOLIC|CONTINUOUS/.test(String(task.task || task.method || "")));
            const parts = Array.isArray(diagnostic?.parts) ? diagnostic.parts.map((part) => String(part).toUpperCase()) : [];
            const failed = tasks.some((task) => ["ERROR", "FAILED"].includes(String(task.status || "").toUpperCase()) || Number(task.failedCount) > 0);
            const notRequested = parts.length && !parts.includes("CONTINUOUS") && !parts.includes("ALL");
            const message = !diagnostic ? "No legacy formula diagnostics were recorded for this execution."
                : failed ? "Continuous discovery did not complete successfully. Review the recorded task errors."
                : notRequested ? "Continuous analysis was not requested in the saved settings for this run."
                : "Review the original discovery diagnostics; a zero count alone does not identify the cause.";
            const messages = tasks.flatMap((task) => [task.message, task.skipReason,
                ...(task.skippedTargets || []).map((target) => [target.targetColumn, target.message || target.skipReason].filter(Boolean).join(": "))]
                .filter(Boolean).map((reason) => `${task.task || task.method}: ${reason}`));
            blocks.push(`<h4>${escapeHtml(t(sourceLabels.LEGACY_SYMBOLIC))}</h4><p>${escapeHtml(t(message))}</p>
                ${messages.length ? `<ul>${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>` : ""}`);
        }
        return blocks.length ? `<details class="editing-result-diagnostics" ${Number(summary.families?.FORMULA?.ruleCount) === 0 ? "open" : ""}><summary>${escapeHtml(t("Discovery diagnostics"))}</summary>${blocks.join("")}</details>` : "";
    }
    function render(payload = {}, options = {}) {
        const data = payload.data || payload, summary = data.summary || {}, t = (key, params) => translate(key, options, params);
        const family = options.family || data.family || "CONDITION", source = options.source || data.source || "ALL";
        const counts = Array.isArray(summary.sourceCounts) ? summary.sourceCounts : [];
        const partial = counts.some((item) => item.status === "unavailable") || (data.diagnostics?.errors || []).length > 0;
        const families = options.showFamilies === false ? "" : `<div class="editing-result-tabs" role="group" aria-label="${escapeHtml(t("Result type"))}">${["CONDITION", "FORMULA"].map((kind) => {
            const count = present(summary.families?.[kind]?.ruleCount, summary.families?.[kind]?.total);
            return `<button type="button" data-editing-family="${kind}" aria-pressed="${family === kind}"><strong>${escapeHtml(t(kind === "CONDITION" ? "Condition rules (IF–THEN)" : "Formula rules"))}</strong>${count !== undefined ? `<span>${escapeHtml(t("{count} rules", {count: format(count, options)}))}</span>` : ""}</button>`;
        }).join("")}</div>`;
        const sourceFilter = options.showSourceFilter === false ? "" : `<label class="editing-result-source">${escapeHtml(t("Discovery method"))}<select data-editing-source aria-label="${escapeHtml(t("Discovery method"))}">${["ALL", ...(family === "FORMULA" ? ["LEGACY_SYMBOLIC", "MIXED_PATTERN"] : ["LEGACY_ASSOC", "MIXED_PATTERN"])].map((key) => `<option value="${key}"${source === key ? " selected" : ""}>${escapeHtml(t(key === "ALL" ? "All methods" : sourceLabels[key]))}</option>`).join("")}</select></label>`;
        const filters = {...data.filters, ...options.filters};
        const selectedCount = String(filters.conditionCount ?? "ALL");
        const choices = [...new Set([...(data.conditionCounts || []).map((item) => String(item.value)), ...(selectedCount !== "ALL" ? [selectedCount] : [])])];
        const filterControls = `<label class="editing-result-source">${escapeHtml(t("Condition count"))}<select data-editing-condition aria-label="${escapeHtml(t("Condition count"))}"><option value="ALL">${escapeHtml(t("All counts"))}</option>${choices.map((value) => `<option value="${escapeHtml(value)}"${selectedCount === value ? " selected" : ""}>${escapeHtml(value === "-1" ? t("Not recorded") : t("{count} conditions", {count: value}))}</option>`).join("")}</select></label>
            <label class="editing-result-checkbox"><input type="checkbox" data-editing-exclude-zero ${filters.excludeZero ? "checked" : ""}>${escapeHtml(t("Exclude zero violations"))}</label>`;
        const historical = Number(summary.historicalExplanationCount) > 0 ? `<aside class="editing-result-notice"><button type="button" data-editing-legacy>${escapeHtml(t("Historical anomaly explanations"))} (${format(summary.historicalExplanationCount, options)})</button><p>${escapeHtml(t("These explain model anomaly candidates and are separate from actual-value editing rules."))}</p></aside>` : "";
        const unclassified = Number(summary.unclassifiedRuleCount) > 0 ? `<p class="editing-result-notice" role="status">${escapeHtml(t("{count} stored results have an unrecognized expression type. They are excluded from these two lists; review the original source analysis.", {count: format(summary.unclassifiedRuleCount, options)}))}</p>` : "";
        const error = options.error ? `<div class="editing-result-error" role="alert">${escapeHtml(options.error)} <button type="button" data-editing-retry>${escapeHtml(t("Retry"))}</button></div>` : "";
        const rows = Array.isArray(data.rules) ? data.rules : [];
        return `<section class="editing-result-view" aria-busy="${Boolean(options.loading)}">${families}
            <div class="editing-result-tools">${sourceFilter}${filterControls}</div><p class="editing-result-note">${escapeHtml(t("Review order: violations first, highest count first; zero counts last."))}<br>${escapeHtml(t("Counts use detected totals when recorded, otherwise saved rows. Missing detection counts are not zero; confidence is not an error probability."))}</p><p class="editing-result-note">${escapeHtml(t("Methods remain attached to each rule. Their scores have different meanings."))}</p>
            ${partial ? `<p class="editing-result-error" role="status">${escapeHtml(t("Some results are unavailable. Counts describe the available results only."))}</p>` : ""}${historical}${unclassified}${error}${renderDiagnostics(data, {...options, family, source})}
            ${options.loading ? `<p class="editing-result-loading" role="status">${escapeHtml(t("Loading rules…"))}</p>` : ""}${pagination(data, options)}
            <div class="editing-result-cards">${rows.map((entry) => renderCard(entry, options)).join("") || (!options.loading && !options.error ? `<p class="editing-result-empty">${escapeHtml(t("No rules in this selection."))}</p>` : "")}</div>
            ${rows.length > 4 ? pagination(data, options) : ""}<p class="editing-result-note">${escapeHtml(t("The same data row may violate several rules; violation counts are not unique error counts."))}</p></section>`;
    }
    function bind(container, handlers = {}) {
        const click = (event) => {
            const button = event.target.closest?.("button");
            if (!button || !container.contains(button) || button.disabled) return;
            const data = button.dataset;
            if (data.editingFamily !== undefined) handlers.onFamily?.(data.editingFamily);
            else if (data.editingPage !== undefined) handlers.onPage?.(Number(data.editingPage));
            else if (data.editingRuleKey !== undefined) handlers.onRule?.(data.editingRuleKey);
            else if (data.editingRetry !== undefined) handlers.onRetry?.();
            else if (data.editingLegacy !== undefined) handlers.onLegacy?.();
            else if (data.editingBack !== undefined) handlers.onBack?.();
            else if (data.editingGraph !== undefined) handlers.onGraph?.();
            else if (data.editingSourceAnalysis !== undefined) handlers.onSourceAnalysis?.();
        };
        const change = (event) => {
            if (event.target.matches?.("[data-editing-source]")) handlers.onSource?.(event.target.value);
            if (event.target.matches?.("[data-editing-condition]")) handlers.onCondition?.(event.target.value);
            if (event.target.matches?.("[data-editing-exclude-zero]")) handlers.onExcludeZero?.(event.target.checked);
        };
        container.addEventListener("click", click);
        container.addEventListener("change", change);
        return () => { container.removeEventListener("click", click); container.removeEventListener("change", change); };
    }
    function detailHeader(entry, options = {}) {
        const t = (key) => translate(key, options), scope = entry.scope || {};
        const meta = [["Rule ID", scope.ruleId], ["Model", scope.modelName || "—"], ["Target", `${scope.targetOwner || ""}.${scope.targetTable || ""}`], ["Flow Run ID", scope.flowRunId]];
        return `<header class="editing-result-detail-header"><nav class="editing-result-detail-nav" aria-label="${escapeHtml(t("Rule details"))}">
            <button type="button" class="editing-result-button" data-editing-back>← ${escapeHtml(t("Back to rules"))}</button>
            <span>${escapeHtml(t(entry.family === "FORMULA" ? "Formula rules" : "Condition rules (IF–THEN)"))} / ${escapeHtml(t("Rule details"))}</span>
            ${options.sourceAnalysis ? `<button type="button" class="editing-result-button" data-editing-source-analysis>${escapeHtml(t("Source analysis"))} →</button>` : ""}</nav>
            <details class="editing-result-metadata"><summary>${escapeHtml(t("Execution information"))}</summary><dl>${meta.map(([label, value]) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details></header>`;
    }
    function violationNotice(data, options = {}) {
        if (data.countConsistency === "INCONSISTENT") return `<p class="editing-result-error" role="alert">${escapeHtml(translate("Stored detection counts disagree with the rule coverage. Review the detection run before treating this as zero violations.", options))}</p>`;
        if (Number(data.total) !== 0) return "";
        const message = Number(data.fullViolationCount) > 0 ? "Violations were detected, but no preview rows were saved for this rule. Check the preview limit and detection execution."
            : data.detectionCountRecorded && Number(data.fullViolationCount) === 0 ? "Detection recorded zero violations for this rule."
            : "No saved rows does not establish that the source has no violations. Check whether detection ran and its saved-row limits.";
        const evidence = data.evidence || {};
        const pairs = [["Condition rows", evidence.conditionRows], ["Satisfied rows", evidence.satisfiedRows], ["Detected violations", evidence.detectedViolations], ["Saved rows", data.total]];
        return `<div class="editing-result-notice" role="status"><p>${escapeHtml(translate(message, options))}</p><dl class="editing-result-metrics">${pairs.filter(([,value]) => value !== null && value !== undefined).map(([label,value]) => `<div><dt>${escapeHtml(translate(label, options))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></div>`;
    }
    function capturePosition(container, key) {
        const parents = [];
        for (let node = container; node; node = node.parentElement) {
            if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) parents.push({node, top: node.scrollTop, left: node.scrollLeft});
        }
        return {key, parents, top: root.scrollY, left: root.scrollX};
    }
    function restorePosition(container, position) {
        if (!position) return;
        root.requestAnimationFrame(() => {
            if (!container?.isConnected) return;
            const button = [...container.querySelectorAll("[data-editing-rule-key]")].find((item) => item.dataset.editingRuleKey === position.key);
            button?.focus({preventScroll: true});
            button?.closest(".editing-result-card")?.classList.add("is-returned");
            position.parents.forEach(({node, top, left}) => { if (node.isConnected) {node.scrollTop = top; node.scrollLeft = left;} });
            root.scrollTo({top: position.top, left: position.left, behavior: "instant"});
        });
    }
    if (root.RuleResultCommon?.ko) Object.assign(root.RuleResultCommon.ko, ko);
    root.EditingResultView = {annotateColumnText, detailHeader, violationNotice, capturePosition, restorePosition, render, renderCard, renderExpression, renderDiagnostics, metricPairs, pagination, bind, escapeHtml, t: translate, sourceLabels, translations: ko};
})(window);
