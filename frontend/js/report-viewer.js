(function() {
    const API_BASE = "/api/M06001";
    const query = new URLSearchParams(window.location.search);
    const state = {
        isBatch: String(query.get("mode") || "").trim().toLowerCase() === "batch",
        reportCode: String(query.get("reportCode") || "").trim(),
        reportTitle: String(query.get("reportTitle") || "").trim(),
        projectId: String(query.get("projectId") || "").trim(),
        scenarioId: String(query.get("scenarioId") || "").trim(),
        flowRunId: String(query.get("flowRunId") || "").trim(),
        editSessionId: String(query.get("editSessionId") || "").trim(),
        language: normalizeLanguage(query.get("lang")),
        model: null,
        loading: false,
        abortController: null,
        loadTimeoutId: null,
        downloading: false,
        downloadController: null
    };

    const TEXT = {
        en: {
            eyebrow: "IN-DEPS Editing Report",
            title: "Basic Reports",
            provider: "This report is provided by the IN-DEPS system.",
            footer: "Consistent editing reports for comparable data quality decisions.",
            close: "Close",
            retry: "Retry",
            preparingTitle: "Preparing the report",
            preparingDescription: "Collecting the selected project, scenario, run, and editing results.",
            loadTimeout: "The report took too long to generate. Please try again.",
            errorTitle: "Report unavailable",
            errorDefault: "The report could not be loaded.",
            invalidContext: "The report code and project context are required.",
            downloadFailed: "The {format} download failed.",
            downloadTimeout: "The report download timed out. Please try again.",
            downloading: "Preparing {format}...",
            noDataTitle: "No report data",
            noDataDescription: "There is no data for the selected report basis. The fixed report definition remains available for comparison.",
            reportMetadata: "Report metadata",
            reportActions: "Report actions",
            keyIndicators: "Key indicators",
            reportCode: "Report code",
            project: "Project",
            projectCode: "Project code",
            scenario: "Scenario",
            flowRun: "Rule discovery run",
            editSession: "Editing session",
            generatedAt: "Generated at",
            definitionVersion: "Definition version",
            reportGroup: "Report group",
            availabilityReason: "Availability note",
            status: "Status",
            ratioBasis: "Numerator {numerator} / denominator {denominator}",
            details: "Report details",
            definitionsTitle: "Terms and calculation basis",
            definitionsDescription: "Definitions applied consistently across IN-DEPS Basic Reports.",
            term: "Term",
            definition: "Definition",
            batchEyebrow: "IN-DEPS Integrated Editing Report",
            batchTitle: "All Basic Reports",
            batchProvider: "All 20 IN-DEPS Basic Reports are included in one continuous document.",
            batchPreparingTitle: "Preparing all reports",
            batchPreparingDescription: "Collecting and organizing all 20 reports. This may take a moment.",
            batchLoadTimeout: "Generating all reports took longer than five minutes. Please try again.",
            batchInvalidContext: "Project context is required to create all reports.",
            batchSummaryTitle: "Integrated report summary",
            batchSummaryDescription: "This bundle preserves the fixed report order, including no-data and not-applicable reports.",
            batchTocTitle: "Table of contents",
            batchTocDescription: "Select a report to move directly to its full contents.",
            batchTotal: "Total reports",
            batchAvailable: "Available",
            batchPartial: "Partial",
            batchNoData: "No data",
            batchNotApplicable: "Not applicable",
            batchError: "Unavailable",
            batchComplete: "All reports generated",
            batchGenerationPartial: "Some reports could not be generated",
            batchReports: "All report contents",
            backToContents: "Back to table of contents",
            openReportSection: "Go to {code} {title}",
            reportNumber: "Report {number}",
            noValue: "-"
        },
        ko: {
            eyebrow: "IN-DEPS 에디팅 보고서",
            title: "기본형 보고서",
            provider: "본 보고서는 IN-DEPS 시스템에서 제공합니다.",
            footer: "서로 다른 데이터도 동일한 기준으로 비교할 수 있는 일관된 에디팅 보고서입니다.",
            close: "닫기",
            retry: "다시 시도",
            preparingTitle: "보고서를 준비하고 있습니다",
            preparingDescription: "선택한 프로젝트, 시나리오, 실행 및 에디팅 결과를 집계하고 있습니다.",
            loadTimeout: "보고서 생성 시간이 초과되었습니다. 다시 시도해 주세요.",
            errorTitle: "보고서를 표시할 수 없습니다",
            errorDefault: "보고서를 불러오지 못했습니다.",
            invalidContext: "보고서 코드와 프로젝트 정보가 필요합니다.",
            downloadFailed: "{format} 다운로드에 실패했습니다.",
            downloadTimeout: "보고서 다운로드 시간이 초과되었습니다. 다시 시도해 주세요.",
            downloading: "{format} 파일을 준비하고 있습니다...",
            noDataTitle: "보고서 데이터가 없습니다",
            noDataDescription: "선택한 기준에 해당하는 데이터가 없습니다. 비교를 위해 고정 보고서 정의는 그대로 유지됩니다.",
            reportMetadata: "보고서 기준 정보",
            reportActions: "보고서 작업",
            keyIndicators: "핵심 지표",
            reportCode: "보고서 코드",
            project: "프로젝트",
            projectCode: "프로젝트 코드",
            scenario: "시나리오",
            flowRun: "규칙발굴 Run",
            editSession: "에디팅 세션",
            generatedAt: "생성 시각",
            definitionVersion: "보고서 정의 버전",
            reportGroup: "보고서 그룹",
            availabilityReason: "제공 상태 안내",
            status: "상태",
            ratioBasis: "분자 {numerator} / 분모 {denominator}",
            details: "보고서 상세",
            definitionsTitle: "용어 및 산정 기준",
            definitionsDescription: "IN-DEPS 기본형 보고서에 일관되게 적용되는 기준입니다.",
            term: "용어",
            definition: "정의",
            batchEyebrow: "IN-DEPS 통합 에디팅 보고서",
            batchTitle: "전체 기본형 보고서",
            batchProvider: "IN-DEPS 기본형 보고서 20종을 하나의 연속된 문서로 제공합니다.",
            batchPreparingTitle: "전체 보고서를 준비하고 있습니다",
            batchPreparingDescription: "20종 보고서를 모두 집계하고 순서대로 구성하고 있습니다. 잠시만 기다려 주세요.",
            batchLoadTimeout: "전체 보고서 생성이 5분을 초과했습니다. 다시 시도해 주세요.",
            batchInvalidContext: "전체 보고서를 생성하려면 프로젝트 정보가 필요합니다.",
            batchSummaryTitle: "통합 보고서 요약",
            batchSummaryDescription: "데이터 없음과 적용 대상 아님을 포함하여 고정된 보고서 순서를 그대로 유지합니다.",
            batchTocTitle: "보고서 목차",
            batchTocDescription: "보고서를 선택하면 전체 내용이 표시된 위치로 바로 이동합니다.",
            batchTotal: "전체 보고서",
            batchAvailable: "제공 가능",
            batchPartial: "일부 제공",
            batchNoData: "데이터 없음",
            batchNotApplicable: "적용 대상 아님",
            batchError: "제공 불가",
            batchComplete: "전체 보고서 생성 완료",
            batchGenerationPartial: "일부 보고서 생성 실패",
            batchReports: "전체 보고서 내용",
            backToContents: "목차로 이동",
            openReportSection: "{code} {title} 보고서로 이동",
            reportNumber: "보고서 {number}",
            noValue: "-"
        }
    };

    const ui = {};

    function normalizeLanguage(value) {
        const language = String(value || "en").trim().toLowerCase().replace("_", "-");
        return language === "ko" || language === "ko-kr" || language === "kr" ? "ko" : "en";
    }

    function t(key, values = {}) {
        const template = TEXT[state.language]?.[key] || TEXT.en[key] || key;
        return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : match
        ));
    }

    function localizedError(error, key, values = {}) {
        if (state.language === "en" && error?.message) return error.message;
        return t(key, values);
    }

    function firstValue(source, keys, fallback = "") {
        const object = source && typeof source === "object" ? source : {};
        for (const key of keys) {
            const value = object[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") return value;
        }
        return fallback;
    }

    function providerStatement(model, fallback = t("provider")) {
        const provider = model?.provider ?? model?.PROVIDER;
        if (provider && typeof provider === "object" && !Array.isArray(provider)) {
            return String(firstValue(provider, ["statement", "STATEMENT", "description", "DESCRIPTION"], fallback));
        }
        if (provider !== undefined && provider !== null && String(provider).trim()) {
            return String(provider);
        }
        return fallback;
    }

    function asArray(value) {
        if (Array.isArray(value)) return value;
        if (Array.isArray(value?.items)) return value.items;
        if (Array.isArray(value?.rows)) return value.rows;
        return [];
    }

    function cacheUi() {
        ui.title = document.getElementById("reportViewerTitle");
        ui.eyebrow = document.getElementById("reportViewerEyebrow");
        ui.provider = document.getElementById("reportViewerProvider");
        ui.basis = document.getElementById("reportViewerBasis");
        ui.loading = document.getElementById("reportViewerLoading");
        ui.error = document.getElementById("reportViewerError");
        ui.errorMessage = document.getElementById("reportViewerErrorMessage");
        ui.content = document.getElementById("reportViewerContent");
        ui.meta = document.getElementById("reportViewerMeta");
        ui.kpis = document.getElementById("reportViewerKpis");
        ui.sections = document.getElementById("reportViewerSections");
        ui.singleContent = document.getElementById("reportViewerSingleContent");
        ui.batchContent = document.getElementById("reportViewerBatchContent");
        ui.batchSummary = document.getElementById("reportViewerBatchSummary");
        ui.batchToc = document.getElementById("reportViewerBatchToc");
        ui.batchReports = document.getElementById("reportViewerBatchReports");
        ui.retry = document.getElementById("reportViewerRetry");
        ui.close = document.getElementById("reportViewerClose");
        ui.footer = document.getElementById("reportViewerFooterText");
        ui.toolbar = document.querySelector(".report-viewer-toolbar");
        ui.downloadButtons = Array.from(document.querySelectorAll(".report-download-btn[data-format]"));
    }

    function applyLanguage() {
        document.documentElement.lang = state.language;
        ui.eyebrow.textContent = state.isBatch ? t("batchEyebrow") : t("eyebrow");
        ui.title.textContent = state.reportTitle || t(state.isBatch ? "batchTitle" : "title");
        ui.provider.textContent = t(state.isBatch ? "batchProvider" : "provider");
        ui.footer.textContent = t("footer");
        ui.close.querySelector("span").textContent = t("close");
        ui.retry.querySelector("span").textContent = t("retry");
        ui.loading.querySelector("h2").textContent = t(state.isBatch ? "batchPreparingTitle" : "preparingTitle");
        ui.loading.querySelector("p").textContent = t(state.isBatch ? "batchPreparingDescription" : "preparingDescription");
        ui.error.querySelector("h2").textContent = t("errorTitle");
        ui.errorMessage.textContent = t("errorDefault");
        ui.toolbar?.setAttribute("aria-label", t("reportActions"));
        ui.meta?.setAttribute("aria-label", t("reportMetadata"));
        ui.kpis?.setAttribute("aria-label", t("keyIndicators"));
        document.title = `${state.reportTitle || t(state.isBatch ? "batchTitle" : "title")} | IN-DEPS`;
    }

    function bindEvents() {
        ui.retry.addEventListener("click", loadReport);
        ui.close.addEventListener("click", closeViewer);
        ui.downloadButtons.forEach((button) => {
            button.addEventListener("click", () => downloadReport(button.dataset.format, button));
        });
        window.addEventListener("pagehide", abortPendingRequests, { once: true });
    }

    function closeViewer() {
        abortPendingRequests();
        window.close();
    }

    function abortPendingRequests() {
        state.abortController?.abort();
        state.downloadController?.abort();
        if (state.loadTimeoutId) window.clearTimeout(state.loadTimeoutId);
        state.loadTimeoutId = null;
    }

    function getTargetConnectionId() {
        try {
            const localValue = sessionStorage.getItem("targetConnectionId");
            if (localValue) return String(localValue);
        } catch (_) {
            // Some hardened browser modes can deny storage access in a popup.
        }
        try {
            if (window.opener && !window.opener.closed && window.opener.location.origin === window.location.origin) {
                return String(window.opener.sessionStorage.getItem("targetConnectionId") || "");
            }
        } catch (_) {
            // Cross-origin or closed openers are intentionally ignored.
        }
        return "";
    }

    function requestHeaders() {
        const headers = { Accept: "application/json" };
        const targetConnectionId = getTargetConnectionId();
        if (targetConnectionId) headers["X-Target-Connection-Id"] = targetConnectionId;
        return headers;
    }

    function appendContextParams(params) {
        const values = {
            projectId: state.projectId,
            scenarioId: state.scenarioId,
            flowRunId: state.flowRunId,
            editSessionId: state.editSessionId,
            lang: state.language
        };
        Object.entries(values).forEach(([key, value]) => {
            if (String(value || "").trim()) params.set(key, String(value));
        });
        return params;
    }

    function reportUrl(downloadFormat = "") {
        const params = appendContextParams(new URLSearchParams());
        if (downloadFormat) params.set("format", downloadFormat);
        if (state.isBatch) {
            const suffix = downloadFormat ? "/download" : "";
            return `${API_BASE}/reports/batch${suffix}?${params.toString()}`;
        }
        const safeCode = encodeURIComponent(state.reportCode);
        const suffix = downloadFormat ? `/download` : "";
        return `${API_BASE}/reports/${safeCode}${suffix}?${params.toString()}`;
    }

    async function parseErrorResponse(response) {
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json")) {
            const json = await response.json().catch(() => ({}));
            return String(json.detail || json.message || json.error || `${response.status} ${response.statusText}`);
        }
        const text = await response.text().catch(() => "");
        return text.trim() || `${response.status} ${response.statusText}`;
    }

    async function loadReport() {
        if (!state.projectId || (!state.isBatch && !state.reportCode)) {
            showError(t(state.isBatch ? "batchInvalidContext" : "invalidContext"));
            return;
        }
        state.abortController?.abort();
        const requestController = new AbortController();
        state.abortController = requestController;
        if (state.loadTimeoutId) window.clearTimeout(state.loadTimeoutId);
        const timeoutId = window.setTimeout(() => requestController.abort(), state.isBatch ? 300000 : 180000);
        state.loadTimeoutId = timeoutId;
        state.loading = true;
        showLoading();

        try {
            const response = await fetch(reportUrl(), {
                method: "GET",
                credentials: "include",
                headers: requestHeaders(),
                cache: "no-store",
                signal: requestController.signal
            });
            if (!response.ok) throw new Error(await parseErrorResponse(response));
            const json = await response.json();
            const payload = json?.data ?? json;
            state.model = payload?.document && typeof payload.document === "object" ? payload.document : payload;
            if (state.isBatch) {
                renderBatchReport(state.model || {});
            } else {
                renderReport(state.model || {});
            }
        } catch (error) {
            if (error?.name === "AbortError") {
                if (requestController !== state.abortController || document.hidden) return;
                showError(t(state.isBatch ? "batchLoadTimeout" : "loadTimeout"));
                return;
            }
            showError(localizedError(error, "errorDefault"));
        } finally {
            window.clearTimeout(timeoutId);
            if (requestController === state.abortController) {
                state.loading = false;
                state.loadTimeoutId = null;
            }
        }
    }

    function showLoading() {
        ui.loading.hidden = false;
        ui.error.hidden = true;
        ui.content.hidden = true;
        ui.downloadButtons.forEach((button) => { button.disabled = true; });
        renderBasis();
    }

    function showError(message) {
        ui.loading.hidden = true;
        ui.content.hidden = true;
        ui.error.hidden = false;
        ui.errorMessage.textContent = String(message || t("errorDefault"));
        ui.downloadButtons.forEach((button) => { button.disabled = true; });
        renderBasis();
    }

    function renderReport(model) {
        ui.loading.hidden = true;
        ui.error.hidden = true;
        ui.content.hidden = false;
        ui.singleContent.hidden = false;
        ui.batchContent.hidden = true;
        ui.downloadButtons.forEach((button) => { button.disabled = false; });

        const report = model.report && typeof model.report === "object" ? model.report : {};
        const definition = model.definition && typeof model.definition === "object" ? model.definition : report;
        const title = firstValue(model, ["reportTitle", "REPORT_TITLE", "title", "name"],
            firstValue(definition, ["reportTitle", "REPORT_TITLE", "title", "name"], state.reportTitle || t("title")));
        state.reportTitle = String(title);
        ui.title.textContent = state.reportTitle;
        ui.provider.textContent = providerStatement(model);
        document.title = `${state.reportTitle} | IN-DEPS`;
        renderBasis(model);
        renderMetadata(model, definition);
        renderKpis(model);
        renderSections(model);
    }

    function renderBatchReport(model) {
        ui.loading.hidden = true;
        ui.error.hidden = true;
        ui.content.hidden = false;
        ui.singleContent.hidden = true;
        ui.batchContent.hidden = false;
        ui.downloadButtons.forEach((button) => { button.disabled = false; });

        const bundle = model.bundle && typeof model.bundle === "object" ? model.bundle : {};
        const title = firstValue(bundle, ["title", "TITLE", "reportTitle", "REPORT_TITLE"],
            firstValue(model, ["title", "TITLE", "reportTitle", "REPORT_TITLE"], state.reportTitle || t("batchTitle")));
        state.reportTitle = String(title);
        ui.title.textContent = state.reportTitle;
        ui.eyebrow.textContent = t("batchEyebrow");
        ui.provider.textContent = providerStatement(model, t("batchProvider"));
        document.title = `${state.reportTitle} | IN-DEPS`;
        renderBasis(model);

        const reports = normalizeBatchReports(model);
        renderBatchSummary(model, reports);
        renderBatchToc(reports);
        renderBatchReports(reports);
    }

    function normalizeBatchReports(model) {
        const bundle = model.bundle && typeof model.bundle === "object" ? model.bundle : {};
        const rows = asArray(model.reports ?? model.items ?? model.documents ?? bundle.reports);
        const commonContext = getContext(model);
        return rows.map((entry, index) => {
            const wrapper = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
            const documentModel = wrapper.document && typeof wrapper.document === "object" && !Array.isArray(wrapper.document)
                ? wrapper.document
                : wrapper;
            const normalized = { ...documentModel };
            if (!normalized.context && Object.keys(commonContext).length) normalized.context = commonContext;
            if (!normalized.report && wrapper.report && typeof wrapper.report === "object") normalized.report = wrapper.report;
            if (!normalized.definition && wrapper.definition && typeof wrapper.definition === "object") normalized.definition = wrapper.definition;
            if (!normalized.availability && wrapper.availability !== undefined) normalized.availability = wrapper.availability;
            normalized.__batchIndex = index;
            return normalized;
        });
    }

    function reportIdentity(model, index = 0) {
        const report = model.report && typeof model.report === "object" ? model.report : {};
        const definition = model.definition && typeof model.definition === "object" ? model.definition : report;
        const code = firstValue(model, ["reportCode", "REPORT_CODE", "code"],
            firstValue(definition, ["reportCode", "REPORT_CODE", "code"], `R${String(index + 1).padStart(2, "0")}`));
        const title = firstValue(model, ["reportTitle", "REPORT_TITLE", "title", "name"],
            firstValue(definition, ["reportTitle", "REPORT_TITLE", "title", "name"], String(code)));
        const description = firstValue(definition, ["description", "DESCRIPTION", "reportDescription", "REPORT_DESCRIPTION"],
            firstValue(model, ["description", "DESCRIPTION", "reportDescription", "REPORT_DESCRIPTION"]));
        const group = firstValue(definition, ["group", "GROUP", "category", "CATEGORY", "sourceMenu", "SOURCE_MENU"],
            firstValue(model, ["group", "GROUP", "category", "CATEGORY", "sourceMenu", "SOURCE_MENU"]));
        return { code: String(code), title: String(title), description: String(description || ""), group: String(group || "") };
    }

    function availabilityStatus(model) {
        const availability = model.availability ?? model.AVAILABILITY;
        const report = model.report && typeof model.report === "object" ? model.report : {};
        let value = availability;
        if (availability && typeof availability === "object" && !Array.isArray(availability)) {
            value = firstValue(availability, ["status", "STATUS", "availability", "AVAILABILITY"]);
        }
        value = value || firstValue(model, ["status", "STATUS", "availabilityStatus", "AVAILABILITY_STATUS"],
            firstValue(report, ["status", "STATUS", "availability", "AVAILABILITY", "availabilityStatus", "AVAILABILITY_STATUS"], "NO_DATA"));
        const normalized = String(value || "NO_DATA").trim().toUpperCase().replace(/[\s-]+/g, "_");
        return new Set(["AVAILABLE", "PARTIAL", "NO_DATA", "NOT_APPLICABLE", "ERROR"]).has(normalized)
            ? normalized
            : "NO_DATA";
    }

    function availabilityInfo(status) {
        const map = {
            AVAILABLE: { label: t("batchAvailable"), icon: "fa-circle-check", className: "available" },
            PARTIAL: { label: t("batchPartial"), icon: "fa-circle-half-stroke", className: "partial" },
            NO_DATA: { label: t("batchNoData"), icon: "fa-circle-minus", className: "no-data" },
            NOT_APPLICABLE: { label: t("batchNotApplicable"), icon: "fa-ban", className: "not-applicable" },
            ERROR: { label: t("batchError"), icon: "fa-circle-exclamation", className: "error" }
        };
        return map[status] || map.NO_DATA;
    }

    function renderBatchSummary(model, reports) {
        ui.batchSummary.replaceChildren();
        const heading = element("div", "batch-summary-heading");
        heading.append(element("span", "batch-summary-icon", "i", "fas fa-layer-group"));
        const copy = element("div");
        const headingTitle = element("h2", "", "", "", t("batchSummaryTitle"));
        headingTitle.id = "batchSummaryTitle";
        copy.append(headingTitle, element("p", "", "", "", t("batchSummaryDescription")));
        const summary = model.summary && typeof model.summary === "object" ? model.summary : {};
        const generationStatus = String(firstValue(summary, ["generationStatus", "GENERATION_STATUS"], "COMPLETE")).toUpperCase();
        const generationBadge = element("span", `batch-generation-status is-${generationStatus === "COMPLETE" ? "complete" : "partial"}`);
        const generationIcon = element("i", `fas ${generationStatus === "COMPLETE" ? "fa-circle-check" : "fa-triangle-exclamation"}`);
        generationIcon.setAttribute("aria-hidden", "true");
        generationBadge.append(generationIcon, document.createTextNode(t(generationStatus === "COMPLETE" ? "batchComplete" : "batchGenerationPartial")));
        heading.append(copy, generationBadge);
        ui.batchSummary.append(heading);

        const statuses = reports.reduce((result, report) => {
            const status = availabilityStatus(report);
            result[status] = (result[status] || 0) + 1;
            return result;
        }, {});
        const metrics = [
            ["batchTotal", firstValue(summary, ["totalCount", "TOTAL_COUNT"], reports.length), "total"],
            ["batchAvailable", firstValue(summary, ["availableCount", "AVAILABLE_COUNT"], statuses.AVAILABLE || 0), "available"],
            ["batchPartial", firstValue(summary, ["partialCount", "PARTIAL_COUNT"], statuses.PARTIAL || 0), "partial"],
            ["batchNoData", firstValue(summary, ["noDataCount", "NO_DATA_COUNT"], statuses.NO_DATA || 0), "no-data"],
            ["batchNotApplicable", firstValue(summary, ["notApplicableCount", "NOT_APPLICABLE_COUNT"], statuses.NOT_APPLICABLE || 0), "not-applicable"]
        ];
        const errorCount = firstValue(summary, ["errorCount", "ERROR_COUNT"], statuses.ERROR || 0);
        if (Number(errorCount) > 0) metrics.push(["batchError", errorCount, "error"]);
        const grid = element("div", "batch-summary-grid");
        metrics.forEach(([labelKey, value, tone]) => {
            const card = element("div", `batch-summary-metric is-${tone}`);
            card.append(element("span", "", "", "", t(labelKey)));
            card.append(element("strong", "", "", "", formatValue(value)));
            grid.append(card);
        });
        ui.batchSummary.append(grid);

        const bundle = model.bundle && typeof model.bundle === "object" ? model.bundle : {};
        const context = getContext(model);
        const generatedAt = firstValue(bundle, ["generatedAt", "GENERATED_AT", "createdAt"],
            firstValue(model, ["generatedAt", "GENERATED_AT", "createdAt"], firstValue(context, ["generatedAt", "GENERATED_AT", "createdAt"])));
        const version = firstValue(bundle, ["definitionVersion", "DEFINITION_VERSION", "version"], firstValue(model, ["definitionVersion", "DEFINITION_VERSION", "version"]));
        const details = [[t("generatedAt"), formatDate(generatedAt)], [t("definitionVersion"), version]]
            .filter(([, value]) => value !== undefined && value !== null && String(value).trim());
        if (details.length) {
            const list = element("dl", "batch-summary-meta");
            details.forEach(([label, value]) => {
                const item = element("div");
                item.append(element("dt", "", "", "", label), element("dd", "", "", "", formatValue(value)));
                list.append(item);
            });
            ui.batchSummary.append(list);
        }
    }

    function renderBatchToc(reports) {
        ui.batchToc.replaceChildren();
        ui.batchToc.id = "batch-report-toc";
        const heading = element("div", "batch-toc-heading");
        const title = element("h2", "", "", "", t("batchTocTitle"));
        title.id = "batchTocTitle";
        heading.append(title, element("p", "", "", "", t("batchTocDescription")));
        ui.batchToc.append(heading);
        const list = element("ol", "batch-toc-list");
        reports.forEach((report, index) => {
            const identity = reportIdentity(report, index);
            const status = availabilityInfo(availabilityStatus(report));
            const item = element("li");
            const link = element("a", "batch-toc-link");
            link.href = `#${batchReportId(identity.code, index)}`;
            link.setAttribute("aria-label", t("openReportSection", identity));
            link.append(element("span", "batch-toc-number", "", "", String(index + 1).padStart(2, "0")));
            const copy = element("span", "batch-toc-copy");
            copy.append(element("small", "", "", "", identity.code), element("strong", "", "", "", identity.title));
            link.append(copy);
            const badge = element("span", `batch-status-badge is-${status.className}`);
            const icon = element("i", `fas ${status.icon}`);
            icon.setAttribute("aria-hidden", "true");
            badge.append(icon, document.createTextNode(status.label));
            link.append(badge);
            item.append(link);
            list.append(item);
        });
        ui.batchToc.append(list);
    }

    function renderBatchReports(reports) {
        ui.batchReports.replaceChildren();
        const heading = element("h2", "batch-report-list-title", "", "", t("batchReports"));
        ui.batchReports.append(heading);
        reports.forEach((report, index) => {
            const identity = reportIdentity(report, index);
            const status = availabilityInfo(availabilityStatus(report));
            const availability = report.availability && typeof report.availability === "object" ? report.availability : {};
            const availabilityReason = firstValue(availability, ["reason", "REASON", "availabilityReason", "AVAILABILITY_REASON"]);
            const article = element("article", "batch-report-document");
            article.id = batchReportId(identity.code, index);
            const titleId = `${article.id}-title`;
            article.setAttribute("aria-labelledby", titleId);

            const header = element("header", "batch-report-header");
            header.append(element("span", "batch-report-number", "", "", String(index + 1).padStart(2, "0")));
            const copy = element("div", "batch-report-heading-copy");
            const kicker = element("span", "batch-report-kicker", "", "", identity.group ? `${identity.code} · ${identity.group}` : identity.code);
            const title = element("h2", "", "", "", identity.title);
            title.id = titleId;
            copy.append(kicker, title);
            if (identity.description) copy.append(element("p", "", "", "", identity.description));
            if (availabilityReason) copy.append(element("p", "batch-report-availability-reason", "", "", String(availabilityReason)));
            header.append(copy);
            const badge = element("span", `batch-status-badge is-${status.className}`);
            const icon = element("i", `fas ${status.icon}`);
            icon.setAttribute("aria-hidden", "true");
            badge.append(icon, document.createTextNode(status.label));
            header.append(badge);
            article.append(header);

            const kpis = element("section", "report-kpi-grid batch-report-kpis");
            kpis.setAttribute("aria-label", t("keyIndicators"));
            renderKpis(report, kpis);
            article.append(kpis);

            const sections = element("div", "report-section-list batch-report-sections");
            renderSections(report, sections, "h3");
            article.append(sections);

            const back = element("a", "batch-back-to-toc");
            back.href = "#batch-report-toc";
            const backIcon = element("i", "fas fa-arrow-up");
            backIcon.setAttribute("aria-hidden", "true");
            back.append(backIcon, document.createTextNode(t("backToContents")));
            article.append(back);
            ui.batchReports.append(article);
        });
    }

    function batchReportId(code, index) {
        const safeCode = String(code || "report").replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "report";
        return `batch-report-${String(index + 1).padStart(2, "0")}-${safeCode}`;
    }

    function getContext(model = state.model || {}) {
        const context = model.context && typeof model.context === "object" ? model.context : {};
        const metadata = model.metadata && typeof model.metadata === "object" ? model.metadata : {};
        return { ...metadata, ...context };
    }

    function renderBasis(model = state.model || {}) {
        const context = getContext(model);
        const project = context.project && typeof context.project === "object" ? context.project : {};
        const scenario = context.scenario && typeof context.scenario === "object" ? context.scenario : {};
        const flowRun = context.flowRun && typeof context.flowRun === "object" ? context.flowRun : {};
        const editSession = context.editSession && typeof context.editSession === "object" ? context.editSession : {};
        const selection = context.selection && typeof context.selection === "object" ? context.selection : {};
        const projectName = firstValue(project, ["PROJECT_NAME", "projectName", "name"], firstValue(context, ["projectName", "PROJECT_NAME"]));
        const scenarioName = firstValue(scenario, ["SCENARIO_NAME", "scenarioName", "name"], firstValue(context, ["scenarioName", "SCENARIO_NAME"]));
        const flowRunId = firstValue(selection, ["flowRunId", "FLOW_RUN_ID"], state.flowRunId);
        const editSessionId = firstValue(selection, ["editSessionId", "EDIT_SESSION_ID"], state.editSessionId);
        const flowRunName = firstValue(flowRun, ["FLOW_NAME", "flowName", "name"]);
        const editSessionName = firstValue(editSession, ["SESSION_NAME", "sessionName", "name"]);
        const parts = [
            projectName || (state.projectId ? `${t("project")} #${state.projectId}` : ""),
            scenarioName || (state.scenarioId ? `${t("scenario")} #${state.scenarioId}` : ""),
            flowRunName || (flowRunId ? `${t("flowRun")} #${flowRunId}` : ""),
            editSessionName || (editSessionId ? `${t("editSession")} #${editSessionId}` : "")
        ].filter(Boolean);
        ui.basis.textContent = parts.join(" · ");
    }

    function renderMetadata(model, definition) {
        const context = getContext(model);
        const report = model.report && typeof model.report === "object" ? model.report : definition;
        const availability = model.availability && typeof model.availability === "object" ? model.availability : {};
        const project = context.project && typeof context.project === "object" ? context.project : {};
        const scenario = context.scenario && typeof context.scenario === "object" ? context.scenario : {};
        const flowRun = context.flowRun && typeof context.flowRun === "object" ? context.flowRun : {};
        const editSession = context.editSession && typeof context.editSession === "object" ? context.editSession : {};
        const generatedAt = firstValue(model, ["generatedAt", "GENERATED_AT", "createdAt"], firstValue(context, ["generatedAt", "GENERATED_AT"]));
        const version = firstValue(model, ["definitionVersion", "DEFINITION_VERSION", "version"], firstValue(report, ["version", "definitionVersion", "VERSION"]));
        const status = firstValue(availability, ["status", "STATUS"], firstValue(model, ["status", "STATUS"]));
        const availabilityReason = firstValue(availability, ["reason", "REASON", "availabilityReason"]);
        const fields = [
            [t("reportCode"), firstValue(model, ["reportCode", "REPORT_CODE", "code"], firstValue(report, ["code", "reportCode", "REPORT_CODE"], state.reportCode))],
            [t("reportGroup"), firstValue(report, ["group", "GROUP", "category", "CATEGORY"])],
            [t("project"), firstValue(project, ["PROJECT_NAME", "projectName", "name"], firstValue(context, ["projectName", "PROJECT_NAME"], state.projectId ? `#${state.projectId}` : ""))],
            [t("projectCode"), firstValue(project, ["PROJECT_CODE", "projectCode", "code"], firstValue(context, ["projectCode", "PROJECT_CODE"]))],
            [t("scenario"), firstValue(scenario, ["SCENARIO_NAME", "scenarioName", "name"], firstValue(context, ["scenarioName", "SCENARIO_NAME"], state.scenarioId ? `#${state.scenarioId}` : ""))],
            [t("flowRun"), firstValue(flowRun, ["FLOW_NAME", "flowName", "name"], state.flowRunId ? `#${state.flowRunId}` : "")],
            [t("editSession"), firstValue(editSession, ["SESSION_NAME", "sessionName", "name"], state.editSessionId ? `#${state.editSessionId}` : "")],
            [t("generatedAt"), formatDate(generatedAt)],
            [t("definitionVersion"), version],
            [t("status"), status],
            [t("availabilityReason"), availabilityReason]
        ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

        ui.meta.replaceChildren();
        const heading = element("div", "report-meta-heading");
        heading.append(element("span", "report-meta-icon", "i", "fas fa-file-shield"));
        const headingText = element("div");
        headingText.append(element("h2", "", "", "", t("reportMetadata")));
        const description = firstValue(report, ["description", "DESCRIPTION", "reportDescription"]);
        if (description) headingText.append(element("p", "report-meta-description", "", "", String(description)));
        headingText.append(element("p", "report-meta-provider", "", "", providerStatement(model)));
        heading.append(headingText);
        ui.meta.append(heading);

        const list = element("dl", "report-meta-grid");
        fields.forEach(([label, value]) => {
            const item = element("div");
            item.append(element("dt", "", "", "", String(label)));
            item.append(element("dd", "", "", "", formatValue(value)));
            list.append(item);
        });
        ui.meta.append(list);
    }

    function normalizeKpis(model) {
        const value = model.kpis ?? model.metrics ?? model.summaryMetrics ?? model.summary?.kpis;
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object") {
            return Object.entries(value).map(([label, metric]) => {
                if (metric && typeof metric === "object" && !Array.isArray(metric)) return { label, ...metric };
                return { label: humanizeKey(label), value: metric };
            });
        }
        return [];
    }

    function renderKpis(model, target = ui.kpis) {
        const kpis = normalizeKpis(model);
        target.replaceChildren();
        target.hidden = kpis.length === 0;
        kpis.forEach((metric) => {
            const card = element("article", "report-kpi-card");
            const label = firstValue(metric, ["label", "LABEL", "name", "title"], "-");
            const value = firstValue(metric, ["value", "VALUE", "count", "COUNT"], "-");
            const unit = firstValue(metric, ["unit", "UNIT"]);
            const hint = firstValue(metric, ["hint", "HINT", "description"]);
            const numerator = firstValue(metric, ["numerator", "NUMERATOR"]);
            const denominator = firstValue(metric, ["denominator", "DENOMINATOR"]);
            const tone = String(firstValue(metric, ["tone", "TONE"], "neutral")).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
            if (tone) card.classList.add(`is-${tone}`);
            card.append(element("span", "report-kpi-label", "", "", String(label)));
            const valueEl = element("strong", "report-kpi-value", "", "", formatKpiValue(value, unit));
            if (unit && !["COUNT", "RATE", "SCORE"].includes(String(unit).toUpperCase())) {
                valueEl.append(element("small", "", "", "", String(unit)));
            }
            card.append(valueEl);
            if (numerator !== "" || denominator !== "") {
                card.append(element("p", "report-kpi-basis", "", "", t("ratioBasis", {
                    numerator: formatValue(numerator),
                    denominator: formatValue(denominator)
                })));
            }
            if (hint) card.append(element("p", "", "", "", String(hint)));
            target.append(card);
        });
    }

    function normalizeSections(model) {
        const direct = model.sections ?? model.reportSections ?? model.content?.sections ?? model.report?.sections;
        let sections = [];
        if (Array.isArray(direct)) {
            sections = [...direct];
        } else if (direct && typeof direct === "object") {
            sections = Object.entries(direct).map(([title, value]) => ({ title: humanizeKey(title), data: value }));
        } else {
            ["summary", "details", "data", "rows", "results"].forEach((key) => {
                const value = model[key];
                if (value === undefined || value === null) return;
                if (key === "summary" && (value?.kpis || value?.metrics)) return;
                sections.push({ title: key === "summary" ? t("details") : humanizeKey(key), data: value });
            });
        }

        const definitions = asArray(model.definitions);
        if (definitions.length) {
            sections.push({
                type: "table",
                title: t("definitionsTitle"),
                description: t("definitionsDescription"),
                columns: [
                    { key: "term", label: t("term") },
                    { key: "definition", label: t("definition") }
                ],
                rows: definitions
            });
        }
        return sections;
    }

    function renderSections(model, target = ui.sections, headingTag = "h2") {
        const sections = normalizeSections(model);
        target.replaceChildren();
        if (!sections.length) {
            target.append(createEmptySection(headingTag));
            return;
        }
        sections.forEach((section, index) => target.append(createSection(section, index, headingTag)));
    }

    function createSection(section, index, headingTag = "h2") {
        const card = element("section", "report-section-card");
        const title = firstValue(section, ["title", "TITLE", "name", "label"], `${t("details")} ${index + 1}`);
        const description = firstValue(section, ["description", "DESCRIPTION", "hint"]);
        const header = element("header", "report-section-header");
        const number = element("span", "report-section-number", "", "", String(index + 1).padStart(2, "0"));
        const copy = element("div");
        copy.append(element(headingTag, "", "", "", String(title)));
        if (description) copy.append(element("p", "", "", "", String(description)));
        header.append(number, copy);
        card.append(header);

        const body = element("div", "report-section-body");
        const type = String(firstValue(section, ["type", "TYPE", "renderType"], "")).toLowerCase();
        const rows = asArray(section.rows ?? section.items ?? section.data ?? section.values);
        const paragraphs = asArray(section.paragraphs ?? section.PARAGRAPHS);
        const content = section.content ?? section.text ?? (!rows.length ? section.data : null);

        if ((type === "text" || paragraphs.length) && paragraphs.length) {
            body.append(createParagraphContent(paragraphs));
        } else if ((type.includes("chart") || type.includes("bar")) && rows.length) {
            body.append(createBarChart(section, rows));
        } else if (rows.length) {
            body.append(createRowsContent(section, rows));
        } else if (content && typeof content === "object") {
            body.append(createObjectContent(content));
        } else if (content !== undefined && content !== null && String(content).trim()) {
            const text = String(content);
            body.append(element(text.includes("\n") ? "pre" : "p", text.includes("\n") ? "report-text-block" : "report-paragraph", "", "", text));
        } else {
            body.append(createInlineEmpty());
        }
        const note = firstValue(section, ["note", "NOTE"]);
        if (note) body.append(element("p", "report-section-note", "", "", String(note)));
        card.append(body);
        return card;
    }

    function createParagraphContent(paragraphs) {
        const container = element("div", "report-text-stack");
        paragraphs.forEach((paragraph) => {
            if (paragraph === undefined || paragraph === null || String(paragraph).trim() === "") return;
            container.append(element("p", "report-paragraph", "", "", String(paragraph)));
        });
        return container.children.length ? container : createInlineEmpty();
    }

    function createRowsContent(section, rows) {
        if (!rows.length) return createInlineEmpty();
        if (rows.every((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
            const list = element("ul", "report-value-list");
            rows.forEach((row) => list.append(element("li", "", "", "", formatValue(row))));
            return list;
        }
        return createTable(section, rows);
    }

    function normalizeColumns(section, rows) {
        const provided = section.columns ?? section.COLUMNS;
        if (Array.isArray(provided) && provided.length) {
            return provided.map((column) => {
                if (typeof column === "string") return { key: column, label: humanizeKey(column) };
                return {
                    key: firstValue(column, ["key", "field", "name", "COLUMN_NAME"]),
                    label: firstValue(column, ["label", "title", "header", "COLUMN_LABEL"], humanizeKey(firstValue(column, ["key", "field", "name"], ""))),
                    format: firstValue(column, ["format", "type"])
                };
            }).filter((column) => column.key);
        }
        const keys = [];
        const seen = new Set();
        rows.slice(0, 30).forEach((row) => {
            Object.keys(row || {}).forEach((key) => {
                if (!seen.has(key)) {
                    seen.add(key);
                    keys.push(key);
                }
            });
        });
        return keys.map((key) => ({ key, label: humanizeKey(key), format: "" }));
    }

    function createTable(section, rows) {
        const columns = normalizeColumns(section, rows);
        if (!columns.length) return createObjectContent(rows);
        const wrapper = element("div", "report-table-scroll");
        wrapper.dataset.columnCount = String(columns.length);
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute("aria-label", String(firstValue(section, ["title", "name"], t("details"))));
        const table = element("table", "report-data-table");
        if (columns.length > 10) table.classList.add("is-wide");
        if (columns.length > 14) table.classList.add("is-dense");
        const thead = element("thead");
        const headRow = element("tr");
        columns.forEach((column) => {
            const heading = element("th", "", "", "", String(column.label || humanizeKey(column.key)));
            heading.setAttribute("scope", "col");
            headRow.append(heading);
        });
        thead.append(headRow);
        table.append(thead);
        const tbody = element("tbody");
        rows.forEach((row) => {
            const tr = element("tr");
            columns.forEach((column) => {
                const value = row?.[column.key];
                const td = element("td", statusCellClass(column.key, value), "", "", formatColumnValue(value, column.format));
                td.dataset.label = String(column.label || humanizeKey(column.key));
                td.title = primitiveTitle(value);
                tr.append(td);
            });
            tbody.append(tr);
        });
        table.append(tbody);
        wrapper.append(table);
        return wrapper;
    }

    function createObjectContent(value) {
        if (Array.isArray(value)) return createRowsContent({}, value);
        const list = element("dl", "report-key-value-grid");
        Object.entries(value || {}).forEach(([key, item]) => {
            const row = element("div");
            row.append(element("dt", "", "", "", humanizeKey(key)));
            row.append(element("dd", "", "", "", formatValue(item)));
            list.append(row);
        });
        return list.children.length ? list : createInlineEmpty();
    }

    function createBarChart(section, rows) {
        const columns = normalizeColumns(section, rows);
        const configuredLabel = firstValue(section, ["labelKey", "categoryKey"]);
        const configuredValue = firstValue(section, ["valueKey", "metricKey"]);
        const numericColumn = configuredValue || columns.find((column) => rows.some((row) => Number.isFinite(Number(row?.[column.key]))))?.key;
        const labelColumn = configuredLabel || columns.find((column) => column.key !== numericColumn)?.key;
        if (!numericColumn) return createTable(section, rows);
        const values = rows.map((row) => Number(row?.[numericColumn])).filter(Number.isFinite);
        const max = Math.max(0, ...values);
        const chart = element("div", "report-bar-chart");
        rows.slice(0, 30).forEach((row) => {
            const raw = Number(row?.[numericColumn]);
            if (!Number.isFinite(raw)) return;
            const item = element("div", "report-bar-item");
            const label = element("span", "report-bar-label", "", "", formatValue(row?.[labelColumn] ?? labelColumn ?? "-"));
            const track = element("span", "report-bar-track");
            const bar = element("span", "report-bar-fill");
            bar.style.width = `${max > 0 ? Math.max(1, Math.min(100, raw / max * 100)) : 0}%`;
            track.append(bar);
            const number = element("strong", "report-bar-value", "", "", formatValue(raw));
            item.append(label, track, number);
            chart.append(item);
        });
        return chart.children.length ? chart : createTable(section, rows);
    }

    function createEmptySection(headingTag = "h2") {
        const card = element("section", "report-section-card report-empty-report");
        card.append(element("span", "report-empty-icon", "i", "far fa-file-lines"));
        card.append(element(headingTag, "", "", "", t("noDataTitle")));
        card.append(element("p", "", "", "", t("noDataDescription")));
        return card;
    }

    function createInlineEmpty() {
        return element("div", "report-inline-empty", "", "", t("noDataDescription"));
    }

    function element(tagName, className = "", iconTag = "", iconClass = "", text = "") {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        if (iconTag) {
            const icon = document.createElement(iconTag);
            icon.className = iconClass;
            icon.setAttribute("aria-hidden", "true");
            node.append(icon);
        }
        if (text !== "") node.append(document.createTextNode(String(text)));
        return node;
    }

    function humanizeKey(value) {
        return String(value || "")
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .trim()
            .toLowerCase()
            .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
    }

    function formatDate(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat(state.language === "ko" ? "ko-KR" : "en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function formatColumnValue(value, format) {
        const type = String(format || "").toLowerCase();
        const number = Number(value);
        if (type.includes("percent") && Number.isFinite(number)) return `${(number * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
        if (type.includes("date")) return formatDate(value) || t("noValue");
        return formatValue(value);
    }

    function formatKpiValue(value, unit) {
        const normalizedUnit = String(unit || "").toUpperCase();
        const number = Number(value);
        if (normalizedUnit === "RATE" && Number.isFinite(number)) {
            return `${(number * 100).toLocaleString(state.language === "ko" ? "ko-KR" : "en-US", { maximumFractionDigits: 2 })}%`;
        }
        return formatValue(value);
    }

    function formatValue(value) {
        if (value === null || value === undefined || value === "") return t("noValue");
        if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
        if (typeof value === "boolean") return value ? "Y" : "N";
        if (typeof value === "object") {
            try {
                return JSON.stringify(value, null, 2);
            } catch (_) {
                return String(value);
            }
        }
        return String(value);
    }

    function primitiveTitle(value) {
        return typeof value === "object" && value !== null ? "" : String(value ?? "");
    }

    function statusCellClass(key, value) {
        if (!String(key || "").toUpperCase().includes("STATUS")) return "";
        const status = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return status ? `is-status is-${status}` : "is-status";
    }

    async function downloadReport(format, button) {
        const normalizedFormat = String(format || "").toLowerCase();
        if (!new Set(["html", "xlsx", "pdf"]).has(normalizedFormat) || button.disabled || state.downloading) return;
        const originalBasis = ui.basis.textContent;
        state.downloading = true;
        state.downloadController?.abort();
        state.downloadController = new AbortController();
        const timeoutId = window.setTimeout(() => state.downloadController?.abort(), state.isBatch ? 300000 : 180000);
        ui.downloadButtons.forEach((item) => { item.disabled = true; });
        button.setAttribute("aria-busy", "true");
        ui.basis.textContent = t("downloading", { format: normalizedFormat.toUpperCase() });

        try {
            const headers = requestHeaders();
            headers.Accept = "application/octet-stream, text/html, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            const response = await fetch(reportUrl(normalizedFormat), {
                method: "GET",
                credentials: "include",
                headers,
                cache: "no-store",
                signal: state.downloadController.signal
            });
            if (!response.ok) throw new Error(await parseErrorResponse(response));
            const blob = await response.blob();
            const filename = responseFilename(response.headers.get("content-disposition"), normalizedFormat);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = filename;
            link.style.display = "none";
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } catch (error) {
            ui.basis.textContent = error?.name === "AbortError"
                ? t("downloadTimeout")
                : localizedError(error, "downloadFailed", { format: normalizedFormat.toUpperCase() });
            ui.basis.classList.add("is-error");
            window.setTimeout(() => {
                ui.basis.classList.remove("is-error");
                renderBasis();
            }, 4500);
        } finally {
            window.clearTimeout(timeoutId);
            state.downloading = false;
            state.downloadController = null;
            ui.downloadButtons.forEach((item) => { item.disabled = false; });
            button.removeAttribute("aria-busy");
            if (!ui.basis.classList.contains("is-error")) ui.basis.textContent = originalBasis;
        }
    }

    function responseFilename(disposition, format) {
        const value = String(disposition || "");
        const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
        const basic = value.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
            || value.match(/filename\s*=\s*([^;]+)/i)?.[1];
        let filename = "";
        try {
            filename = encoded ? decodeURIComponent(encoded.trim()) : String(basic || "").trim();
        } catch (_) {
            filename = String(basic || "").trim();
        }
        if (!filename) {
            const extension = format === "xlsx" ? "xlsx" : format;
            const safeTitle = String(state.reportTitle || state.reportCode || "IN-DEPS_Report")
                .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
                .slice(0, 90);
            filename = `${safeTitle}.${extension}`;
        }
        return filename.replace(/[\\/\u0000-\u001f]+/g, "_");
    }

    document.addEventListener("DOMContentLoaded", () => {
        cacheUi();
        applyLanguage();
        bindEvents();
        loadReport();
    }, { once: true });
})();
