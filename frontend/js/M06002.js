(function() {
    const PAGE_CODE = "M06002";
    const PROJECT_PAGE_SIZE = 20;
    const GRID_COLUMNS = 12;
    const PAPER_ROWS = {
        "A4:PORTRAIT": 36,
        "A4:LANDSCAPE": 36,
        "A3:PORTRAIT": 36,
        "A3:LANDSCAPE": 36
    };
    const DEFAULT_BLOCKS = [
        { key: "section:0", type: "SECTION", titleKey: "defaultSummaryBlock", fallback: "Summary analysis" },
        { key: "section:1", type: "SECTION", titleKey: "defaultDetailBlock", fallback: "Detailed data" },
        { key: "section:2", type: "SECTION", titleKey: "defaultBasisBlock", fallback: "Interpretation and basis" }
    ];
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = window.MCOMMON?.createPageHelper?.(PAGE_CODE) || {
        t(key, fallback = "") {
            return window.I18nManager?.tPage?.(PAGE_CODE, key, fallback) || fallback;
        },
        tl(key, fallback = "", values = {}) {
            const template = window.I18nManager?.tPage?.(PAGE_CODE, key, fallback) || fallback;
            return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
                Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : match
            ));
        }
    };

    function firstValue(source, keys, fallback = "") {
        const object = source && typeof source === "object" ? source : {};
        for (const key of keys) {
            const value = object[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") return value;
        }
        return fallback;
    }

    function asArray(value) {
        if (Array.isArray(value)) return value;
        if (Array.isArray(value?.items)) return value.items;
        if (Array.isArray(value?.rows)) return value.rows;
        return [];
    }

    function parseArray(value) {
        if (Array.isArray(value)) return value;
        if (typeof value !== "string" || !value.trim()) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function parseObject(value) {
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
        if (typeof value !== "string" || !value.trim()) return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    const M06002 = {
        ...COMMON,
        initialized: false,

        localizedError(error, key, fallback) {
            if (this.getLanguageCode() === "en" && error?.message) return error.message;
            return this.t(key, fallback);
        },
        activeView: "projects",
        projects: [],
        projectPage: 0,
        projectTotal: 0,
        projectLoading: false,
        hasMoreProjects: true,
        projectRequestId: 0,
        projectAbortController: null,
        contextAbortController: null,
        catalogAbortController: null,
        templateAbortController: null,
        previewAbortController: null,
        downloadAbortController: null,
        projectObserver: null,
        searchTimer: null,
        selectedProject: null,
        selectedScenarioId: "",
        selectedFlowRunId: "",
        selectedEditSessionId: "",
        scenarios: [],
        flowRuns: [],
        editSessions: [],
        catalog: [],
        templates: [],
        currentTemplate: null,
        selectedInstanceId: "",
        dragPayload: null,
        previewDocuments: new Map(),
        previewDownloads: [],
        projectScrollPosition: 0,
        lastProjectTrigger: null,
        projectUsageDirty: false,
        saving: false,
        downloading: false,
        boundHandlers: {},

        async init() {
            if (this.initialized) return;
            this.initialized = true;
            this.currentTemplate = this.createEmptyTemplate();
            this.bindEvents();
            this.connectProjectObserver();
            await this.loadProjects({ reset: true });
        },

        onShow() {
            if (this.activeView === "projects") this.connectProjectObserver();
        },

        onHide() {
            this.disconnectProjectObserver();
        },

        destroy() {
            this.disconnectProjectObserver();
            this.projectAbortController?.abort();
            this.contextAbortController?.abort();
            this.catalogAbortController?.abort();
            this.templateAbortController?.abort();
            this.previewAbortController?.abort();
            this.downloadAbortController?.abort();
            if (this.searchTimer) window.clearTimeout(this.searchTimer);
            this.unbindEvents();
            this.closePreview();
            this.projects = [];
            this.catalog = [];
            this.templates = [];
            this.scenarios = [];
            this.flowRuns = [];
            this.editSessions = [];
            this.previewDocuments.clear();
            this.selectedProject = null;
            this.projectUsageDirty = false;
            this.currentTemplate = null;
            this.dragPayload = null;
            this.initialized = false;
        },

        bindEvents() {
            const handlers = this.boundHandlers;
            handlers.searchSubmit = (event) => {
                event.preventDefault();
                if (this.searchTimer) window.clearTimeout(this.searchTimer);
                this.searchTimer = null;
                this.loadProjects({ reset: true });
            };
            handlers.searchInput = () => {
                if (this.searchTimer) window.clearTimeout(this.searchTimer);
                this.searchTimer = window.setTimeout(() => this.loadProjects({ reset: true }), 320);
            };
            handlers.searchReset = () => {
                const input = getContainerEl("#projectSearch-M06002");
                if (input) input.value = "";
                this.loadProjects({ reset: true });
                input?.focus();
            };
            handlers.projectGridClick = (event) => {
                const retry = event.target.closest?.("[data-action='retry-projects']");
                if (retry) {
                    this.loadProjects({ reset: true });
                    return;
                }
                const card = event.target.closest?.("[data-project-id]");
                if (card) this.openProject(card.dataset.projectId, card);
            };
            handlers.loadMore = () => this.loadProjects({ reset: false });
            handlers.back = () => this.requestProjectView();
            handlers.scenarioChange = (event) => this.changeScenario(event.target.value);
            handlers.flowRunChange = (event) => {
                this.selectedFlowRunId = String(event.target.value || "");
                this.renderSelectionHint();
                this.loadCatalog();
            };
            handlers.editSessionChange = (event) => {
                this.selectedEditSessionId = String(event.target.value || "");
                this.renderSelectionHint();
                this.loadCatalog();
            };
            handlers.templateChange = (event) => this.requestTemplateChange(event.target.value);
            handlers.newTemplate = () => this.requestNewTemplate();
            handlers.nameInput = (event) => {
                this.currentTemplate.name = String(event.target.value || "");
                this.markDirty();
            };
            handlers.paperChange = (event) => {
                this.currentTemplate.paperSize = String(event.target.value || "A4").toUpperCase() === "A3" ? "A3" : "A4";
                this.markDirty();
                this.reflowItems({ preserve: true });
                this.renderLayout();
            };
            handlers.orientationChange = (event) => {
                if (!event.target.matches("input[name='orientation-M06002']")) return;
                this.currentTemplate.orientation = event.target.value === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT";
                this.markDirty();
                this.reflowItems({ preserve: true });
                this.renderLayout();
            };
            handlers.paletteInput = () => this.renderPalette();
            handlers.paletteClick = (event) => {
                const add = event.target.closest?.("[data-action='add-report']");
                if (add) this.addReport(add.dataset.reportCode);
            };
            handlers.paletteDragStart = (event) => this.onPaletteDragStart(event);
            handlers.canvasClick = (event) => this.onCanvasClick(event);
            handlers.canvasKeydown = (event) => this.onCanvasKeydown(event);
            handlers.canvasDragStart = (event) => this.onCanvasDragStart(event);
            handlers.canvasDragOver = (event) => this.onCanvasDragOver(event);
            handlers.canvasDrop = (event) => this.onCanvasDrop(event);
            handlers.canvasDragEnd = () => this.clearDragState();
            handlers.inspectorClick = (event) => this.onInspectorClick(event);
            handlers.inspectorChange = (event) => this.onInspectorChange(event);
            handlers.inspectorDragStart = (event) => this.onInspectorDragStart(event);
            handlers.inspectorDragOver = (event) => this.onInspectorDragOver(event);
            handlers.inspectorDrop = (event) => this.onInspectorDrop(event);
            handlers.inspectorDragEnd = () => this.clearDragState();
            handlers.closeInspector = () => this.closeInspector();
            handlers.save = () => this.saveTemplate();
            handlers.removeTemplate = () => this.deleteTemplate();
            handlers.apply = () => this.applyTemplateToContext();
            handlers.preview = () => this.openPreview({ useSavedTemplate: false });
            handlers.closePreview = () => this.closePreview();
            handlers.previewCancel = (event) => {
                event.preventDefault();
                this.closePreview();
            };
            handlers.download = (event) => this.downloadTemplate(event.currentTarget.dataset.format, event.currentTarget);
            handlers.pageHide = () => {
                this.previewAbortController?.abort();
                this.downloadAbortController?.abort();
            };

            getContainerEl("#projectSearchForm-M06002")?.addEventListener("submit", handlers.searchSubmit);
            getContainerEl("#projectSearch-M06002")?.addEventListener("input", handlers.searchInput);
            getContainerEl("#projectSearchReset-M06002")?.addEventListener("click", handlers.searchReset);
            getContainerEl("#projectGrid-M06002")?.addEventListener("click", handlers.projectGridClick);
            getContainerEl("#projectLoadMore-M06002")?.addEventListener("click", handlers.loadMore);
            getContainerEl("#backToProjects-M06002")?.addEventListener("click", handlers.back);
            getContainerEl("#scenarioId-M06002")?.addEventListener("change", handlers.scenarioChange);
            getContainerEl("#flowRunId-M06002")?.addEventListener("change", handlers.flowRunChange);
            getContainerEl("#editSessionId-M06002")?.addEventListener("change", handlers.editSessionChange);
            getContainerEl("#templateId-M06002")?.addEventListener("change", handlers.templateChange);
            getContainerEl("#newTemplate-M06002")?.addEventListener("click", handlers.newTemplate);
            getContainerEl("#templateName-M06002")?.addEventListener("input", handlers.nameInput);
            getContainerEl("#paperSize-M06002")?.addEventListener("change", handlers.paperChange);
            getContainerEl(".m06002-segments")?.addEventListener("change", handlers.orientationChange);
            getContainerEl("#paletteSearch-M06002")?.addEventListener("input", handlers.paletteInput);
            getContainerEl("#reportPalette-M06002")?.addEventListener("click", handlers.paletteClick);
            getContainerEl("#reportPalette-M06002")?.addEventListener("dragstart", handlers.paletteDragStart);
            getContainerEl("#layoutCanvas-M06002")?.addEventListener("click", handlers.canvasClick);
            getContainerEl("#layoutCanvas-M06002")?.addEventListener("keydown", handlers.canvasKeydown);
            getContainerEl("#layoutCanvas-M06002")?.addEventListener("dragstart", handlers.canvasDragStart);
            getContainerEl("#layoutCanvas-M06002")?.addEventListener("dragover", handlers.canvasDragOver);
            getContainerEl("#layoutCanvas-M06002")?.addEventListener("drop", handlers.canvasDrop);
            getContainerEl("#layoutCanvas-M06002")?.addEventListener("dragend", handlers.canvasDragEnd);
            getContainerEl("#blockInspector-M06002")?.addEventListener("click", handlers.inspectorClick);
            getContainerEl("#blockInspector-M06002")?.addEventListener("change", handlers.inspectorChange);
            getContainerEl("#blockInspector-M06002")?.addEventListener("dragstart", handlers.inspectorDragStart);
            getContainerEl("#blockInspector-M06002")?.addEventListener("dragover", handlers.inspectorDragOver);
            getContainerEl("#blockInspector-M06002")?.addEventListener("drop", handlers.inspectorDrop);
            getContainerEl("#blockInspector-M06002")?.addEventListener("dragend", handlers.inspectorDragEnd);
            getContainerEl("#closeInspector-M06002")?.addEventListener("click", handlers.closeInspector);
            getContainerEl("#saveTemplate-M06002")?.addEventListener("click", handlers.save);
            getContainerEl("#deleteTemplate-M06002")?.addEventListener("click", handlers.removeTemplate);
            getContainerEl("#applyTemplate-M06002")?.addEventListener("click", handlers.apply);
            getContainerEl("#previewTemplate-M06002")?.addEventListener("click", handlers.preview);
            getContainerEl("#closePreview-M06002")?.addEventListener("click", handlers.closePreview);
            getContainerEl("#previewDialog-M06002")?.addEventListener("cancel", handlers.previewCancel);
            getContainerEl("#downloadHtml-M06002")?.addEventListener("click", handlers.download);
            getContainerEl("#downloadPdf-M06002")?.addEventListener("click", handlers.download);
            window.addEventListener("pagehide", handlers.pageHide);
        },

        unbindEvents() {
            const handlers = this.boundHandlers;
            getContainerEl("#projectSearchForm-M06002")?.removeEventListener("submit", handlers.searchSubmit);
            getContainerEl("#projectSearch-M06002")?.removeEventListener("input", handlers.searchInput);
            getContainerEl("#projectSearchReset-M06002")?.removeEventListener("click", handlers.searchReset);
            getContainerEl("#projectGrid-M06002")?.removeEventListener("click", handlers.projectGridClick);
            getContainerEl("#projectLoadMore-M06002")?.removeEventListener("click", handlers.loadMore);
            getContainerEl("#backToProjects-M06002")?.removeEventListener("click", handlers.back);
            getContainerEl("#scenarioId-M06002")?.removeEventListener("change", handlers.scenarioChange);
            getContainerEl("#flowRunId-M06002")?.removeEventListener("change", handlers.flowRunChange);
            getContainerEl("#editSessionId-M06002")?.removeEventListener("change", handlers.editSessionChange);
            getContainerEl("#templateId-M06002")?.removeEventListener("change", handlers.templateChange);
            getContainerEl("#newTemplate-M06002")?.removeEventListener("click", handlers.newTemplate);
            getContainerEl("#templateName-M06002")?.removeEventListener("input", handlers.nameInput);
            getContainerEl("#paperSize-M06002")?.removeEventListener("change", handlers.paperChange);
            getContainerEl(".m06002-segments")?.removeEventListener("change", handlers.orientationChange);
            getContainerEl("#paletteSearch-M06002")?.removeEventListener("input", handlers.paletteInput);
            getContainerEl("#reportPalette-M06002")?.removeEventListener("click", handlers.paletteClick);
            getContainerEl("#reportPalette-M06002")?.removeEventListener("dragstart", handlers.paletteDragStart);
            getContainerEl("#layoutCanvas-M06002")?.removeEventListener("click", handlers.canvasClick);
            getContainerEl("#layoutCanvas-M06002")?.removeEventListener("keydown", handlers.canvasKeydown);
            getContainerEl("#layoutCanvas-M06002")?.removeEventListener("dragstart", handlers.canvasDragStart);
            getContainerEl("#layoutCanvas-M06002")?.removeEventListener("dragover", handlers.canvasDragOver);
            getContainerEl("#layoutCanvas-M06002")?.removeEventListener("drop", handlers.canvasDrop);
            getContainerEl("#layoutCanvas-M06002")?.removeEventListener("dragend", handlers.canvasDragEnd);
            getContainerEl("#blockInspector-M06002")?.removeEventListener("click", handlers.inspectorClick);
            getContainerEl("#blockInspector-M06002")?.removeEventListener("change", handlers.inspectorChange);
            getContainerEl("#blockInspector-M06002")?.removeEventListener("dragstart", handlers.inspectorDragStart);
            getContainerEl("#blockInspector-M06002")?.removeEventListener("dragover", handlers.inspectorDragOver);
            getContainerEl("#blockInspector-M06002")?.removeEventListener("drop", handlers.inspectorDrop);
            getContainerEl("#blockInspector-M06002")?.removeEventListener("dragend", handlers.inspectorDragEnd);
            getContainerEl("#closeInspector-M06002")?.removeEventListener("click", handlers.closeInspector);
            getContainerEl("#saveTemplate-M06002")?.removeEventListener("click", handlers.save);
            getContainerEl("#deleteTemplate-M06002")?.removeEventListener("click", handlers.removeTemplate);
            getContainerEl("#applyTemplate-M06002")?.removeEventListener("click", handlers.apply);
            getContainerEl("#previewTemplate-M06002")?.removeEventListener("click", handlers.preview);
            getContainerEl("#closePreview-M06002")?.removeEventListener("click", handlers.closePreview);
            getContainerEl("#previewDialog-M06002")?.removeEventListener("cancel", handlers.previewCancel);
            getContainerEl("#downloadHtml-M06002")?.removeEventListener("click", handlers.download);
            getContainerEl("#downloadPdf-M06002")?.removeEventListener("click", handlers.download);
            window.removeEventListener("pagehide", handlers.pageHide);
            this.boundHandlers = {};
        },

        connectProjectObserver() {
            this.disconnectProjectObserver();
            const sentinel = getContainerEl("#projectLoadSentinel-M06002");
            if (!sentinel || typeof IntersectionObserver === "undefined") return;
            this.projectObserver = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting && this.activeView === "projects" && this.hasMoreProjects) {
                    this.loadProjects({ reset: false });
                }
            }, { root: null, rootMargin: "480px 0px", threshold: 0 });
            this.projectObserver.observe(sentinel);
        },

        disconnectProjectObserver() {
            this.projectObserver?.disconnect();
            this.projectObserver = null;
        },

        getProjectKeyword() {
            return String(getContainerEl("#projectSearch-M06002")?.value || "").trim();
        },

        async loadProjects({ reset = false } = {}) {
            if (this.projectLoading && !reset) return;
            if (!reset && !this.hasMoreProjects) return;
            if (reset) {
                this.projectAbortController?.abort();
                this.projectAbortController = new AbortController();
                this.projectPage = 0;
                this.projectTotal = 0;
                this.projects = [];
                this.hasMoreProjects = true;
                this.renderProjectSkeletons();
            } else if (!this.projectAbortController || this.projectAbortController.signal.aborted) {
                this.projectAbortController = new AbortController();
            }
            const requestId = ++this.projectRequestId;
            const nextPage = this.projectPage + 1;
            const params = new URLSearchParams({
                keyword: this.getProjectKeyword(),
                page: String(nextPage),
                pageSize: String(PROJECT_PAGE_SIZE)
            });
            this.setProjectLoading(true);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/projects?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    signal: this.projectAbortController.signal
                });
                if (requestId !== this.projectRequestId) return;
                const payload = json?.data;
                const rows = Array.isArray(payload) ? payload : asArray(payload?.items || payload?.rows || payload?.projects);
                const totalCandidate = json?.total ?? payload?.total ?? payload?.TOTAL_COUNT ?? rows[0]?.TOTAL_COUNT ?? rows[0]?.totalCount;
                const total = Number(totalCandidate);
                if (reset) {
                    this.projects = [];
                    const grid = getContainerEl("#projectGrid-M06002");
                    if (grid) grid.innerHTML = "";
                }
                const knownIds = new Set(this.projects.map((row) => String(firstValue(row, ["PROJECT_ID", "projectId"]))));
                const newRows = rows.filter((row) => {
                    const id = String(firstValue(row, ["PROJECT_ID", "projectId"]));
                    return id && !knownIds.has(id) && knownIds.add(id);
                });
                this.projects.push(...newRows);
                this.projectPage = nextPage;
                this.projectTotal = Number.isFinite(total) ? total : this.projects.length;
                this.hasMoreProjects = Number.isFinite(total) ? this.projects.length < total : rows.length === PROJECT_PAGE_SIZE;
                this.appendProjectCards(newRows);
                this.renderProjectListState();
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06002] project load failed", error);
                this.renderProjectLoadError(reset, error);
            } finally {
                if (requestId === this.projectRequestId) this.setProjectLoading(false);
            }
        },

        renderProjectSkeletons() {
            const grid = getContainerEl("#projectGrid-M06002");
            const empty = getContainerEl("#projectEmpty-M06002");
            if (empty) empty.hidden = true;
            if (!grid) return;
            grid.setAttribute("aria-busy", "true");
            grid.innerHTML = Array.from({ length: 10 }, () => `
                <div class="m06002-card-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
            `).join("");
        },

        appendProjectCards(rows) {
            const grid = getContainerEl("#projectGrid-M06002");
            if (!grid || !rows.length) return;
            grid.insertAdjacentHTML("beforeend", rows.map((project) => this.projectCardHtml(project)).join(""));
        },

        projectCardHtml(project) {
            const id = firstValue(project, ["PROJECT_ID", "projectId"]);
            const name = firstValue(project, ["PROJECT_NAME", "projectName"], this.t("untitledProject", "이름 없는 프로젝트"));
            const code = firstValue(project, ["PROJECT_CODE", "projectCode"], "-");
            const type = firstValue(project, ["PROJECT_TYPE", "projectType"], "-");
            const description = firstValue(project, ["PROJECT_DESC", "projectDesc"], this.t("noProjectDescription", "프로젝트 설명이 없습니다."));
            const ownerScope = String(firstValue(project, ["OWNER_SCOPE", "ownerScope"], "MY")).toUpperCase();
            const customReports = asArray(firstValue(project, ["CUSTOM_REPORTS", "customReports"], []));
            const reportCount = this.formatNumber(firstValue(project, ["CUSTOM_REPORT_COUNT", "customReportCount"], customReports.length));
            const generationCount = this.formatNumber(firstValue(project, ["CUSTOM_REPORT_GENERATION_COUNT", "customReportGenerationCount"], 0));
            const lastGeneratedAt = firstValue(project, ["LAST_CUSTOM_REPORT_AT", "lastCustomReportAt"]);
            const recentReportsHtml = customReports.length
                ? customReports.map((report) => {
                    const reportName = firstValue(report, ["name", "TEMPLATE_NAME"], this.t("untitledCustomReport", "이름 없는 맞춤형 보고서"));
                    const paperSize = firstValue(report, ["paperSize", "PAPER_SIZE"], "A4");
                    const orientation = String(firstValue(report, ["orientation", "ORIENTATION"], "PORTRAIT")).toUpperCase();
                    const includedCount = this.formatNumber(firstValue(report, ["reportCount", "REPORT_COUNT"], 0));
                    return `<span class="m06002-custom-report-item">
                        <span class="m06002-custom-report-name">${this.escapeHtml(reportName)}</span>
                        <span class="m06002-custom-report-meta">${this.escapeHtml(`${paperSize} · ${this.orientationLabel(orientation)} · ${this.tl("reportsIncluded", "기본형 {count}종", { count: includedCount })}`)}</span>
                    </span>`;
                }).join("")
                : `<span class="m06002-custom-report-empty">
                    <i class="far fa-file-lines" aria-hidden="true"></i>
                    <span><strong>${this.escapeHtml(this.t("noCustomReports", "생성된 맞춤형 보고서가 없습니다."))}</strong><small>${this.escapeHtml(this.t("noCustomReportsHint", "프로젝트를 열어 첫 보고서를 설계해 보세요."))}</small></span>
                </span>`;
            const sharedBadge = ownerScope === "OTHER"
                ? `<span class="m06002-shared-badge">${this.escapeHtml(this.t("sharedProject", "공유"))}</span>`
                : "";
            const ariaLabel = this.tl("openProjectBuilder", "{name} 프로젝트의 맞춤형 보고서 설계 열기", { name });
            return `
                <article class="m06002-project-card" role="listitem">
                    <button type="button" data-project-id="${this.escapeAttr(id)}" aria-label="${this.escapeAttr(ariaLabel)}">
                        <span class="m06002-card-topline"><span class="m06002-project-type">${this.escapeHtml(type)}</span>${sharedBadge}</span>
                        <span class="m06002-project-name">${this.escapeHtml(name)}</span>
                        <span class="m06002-project-code">${this.escapeHtml(code)}</span>
                        <span class="m06002-project-description">${this.escapeHtml(description)}</span>
                        <span class="m06002-project-metrics">
                            ${this.metricHtml("fa-file-circle-check", this.t("createdCustomReports", "맞춤형 보고서"), reportCount)}
                            ${this.metricHtml("fa-wand-magic-sparkles", this.t("totalGenerations", "생성 횟수"), generationCount)}
                        </span>
                        <span class="m06002-custom-report-section">
                            <span class="m06002-custom-report-heading">${this.escapeHtml(this.t("recentCustomReports", "최근 생성 보고서"))}</span>
                            <span class="m06002-custom-report-list">${recentReportsHtml}</span>
                        </span>
                        <span class="m06002-project-footer">
                            <span><i class="far fa-clock" aria-hidden="true"></i>${this.escapeHtml(this.t("lastGenerated", "최근 생성"))}</span>
                            <strong>${this.escapeHtml(lastGeneratedAt ? this.formatDate(lastGeneratedAt) : this.t("neverGenerated", "생성 이력 없음"))}</strong>
                        </span>
                    </button>
                </article>
            `;
        },

        metricHtml(icon, label, value) {
            return `<span class="m06002-project-metric"><span><i class="fas ${icon}" aria-hidden="true"></i>${this.escapeHtml(label)}</span><strong>${this.escapeHtml(value)}</strong></span>`;
        },

        renderProjectListState() {
            const grid = getContainerEl("#projectGrid-M06002");
            const empty = getContainerEl("#projectEmpty-M06002");
            const summary = getContainerEl("#projectResultSummary-M06002");
            if (grid) grid.setAttribute("aria-busy", "false");
            if (empty) empty.hidden = this.projects.length > 0;
            if (summary) {
                summary.textContent = this.tl("projectResultSummary", "전체 {total}개 중 {shown}개 표시", {
                    shown: this.projects.length.toLocaleString(),
                    total: this.projectTotal.toLocaleString()
                });
            }
            this.updateLoadMoreState();
        },

        renderProjectLoadError(reset, error) {
            const grid = getContainerEl("#projectGrid-M06002");
            if (grid) {
                grid.setAttribute("aria-busy", "false");
                if (reset) {
                    grid.innerHTML = `
                        <div class="m06002-grid-error">
                            <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
                            <strong>${this.escapeHtml(this.t("projectLoadFailed", "프로젝트 목록을 불러오지 못했습니다."))}</strong>
                            <span>${this.escapeHtml(this.localizedError(error, "tryAgainLater", "잠시 후 다시 시도해 주세요."))}</span>
                            <button type="button" class="m06002-btn m06002-btn-secondary" data-action="retry-projects">
                                <i class="fas fa-rotate" aria-hidden="true"></i>${this.escapeHtml(this.t("retry", "다시 시도"))}
                            </button>
                        </div>`;
                }
            }
            this.hasMoreProjects = !reset;
            this.updateLoadMoreState();
        },

        setProjectLoading(loading) {
            this.projectLoading = Boolean(loading);
            const spinner = getContainerEl("#projectLoadSpinner-M06002");
            const grid = getContainerEl("#projectGrid-M06002");
            if (spinner) spinner.hidden = !loading || this.projectPage === 0;
            if (grid && loading) grid.setAttribute("aria-busy", "true");
            this.updateLoadMoreState();
        },

        updateLoadMoreState() {
            const button = getContainerEl("#projectLoadMore-M06002");
            if (!button) return;
            button.hidden = !this.hasMoreProjects || this.projectLoading || this.projects.length === 0;
            button.disabled = this.projectLoading;
        },

        async openProject(projectId, triggerElement = null) {
            const project = this.projects.find((row) => String(firstValue(row, ["PROJECT_ID", "projectId"])) === String(projectId));
            if (!project) return;
            this.selectedProject = project;
            this.lastProjectTrigger = triggerElement;
            this.projectScrollPosition = this.getCurrentScrollPosition();
            this.showBuilderView();
            await Promise.all([
                this.loadContext(projectId, ""),
                this.loadTemplates()
            ]);
        },

        showBuilderView() {
            this.activeView = "builder";
            this.disconnectProjectObserver();
            const projectView = getContainerEl("#projectView-M06002");
            const builderView = getContainerEl("#builderView-M06002");
            if (projectView) projectView.hidden = true;
            if (builderView) builderView.hidden = false;
            this.scrollToTop();
            window.requestAnimationFrame(() => getContainerEl("#backToProjects-M06002")?.focus());
            this.renderTemplateEditor();
        },

        async requestProjectView() {
            if (!(await this.confirmDiscardIfNeeded())) return;
            this.showProjectView();
            if (this.projectUsageDirty) {
                this.projectUsageDirty = false;
                await this.loadProjects({ reset: true });
            }
        },

        showProjectView() {
            this.activeView = "projects";
            this.contextAbortController?.abort();
            this.catalogAbortController?.abort();
            this.previewAbortController?.abort();
            this.closePreview();
            const projectView = getContainerEl("#projectView-M06002");
            const builderView = getContainerEl("#builderView-M06002");
            if (builderView) builderView.hidden = true;
            if (projectView) projectView.hidden = false;
            this.connectProjectObserver();
            window.requestAnimationFrame(() => {
                this.restoreScrollPosition(this.projectScrollPosition);
                let trigger = this.lastProjectTrigger;
                if (!trigger?.isConnected) {
                    const selectedId = String(firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]));
                    trigger = Array.from(getContainerEl("#projectGrid-M06002")?.querySelectorAll("[data-project-id]") || [])
                        .find((element) => String(element.dataset.projectId) === selectedId);
                }
                trigger?.focus?.({ preventScroll: true });
            });
        },

        async loadContext(projectId, scenarioId = "") {
            this.contextAbortController?.abort();
            this.contextAbortController = new AbortController();
            const panel = getContainerEl("#contextPanel-M06002");
            if (panel) panel.setAttribute("aria-busy", "true");
            this.renderContextLoading();
            const params = new URLSearchParams({ projectId: String(projectId) });
            if (scenarioId) params.set("scenarioId", String(scenarioId));
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/context?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    signal: this.contextAbortController.signal
                });
                const data = json?.data && typeof json.data === "object" ? json.data : {};
                this.applyContextData(data, scenarioId);
                this.renderContext();
                await this.loadCatalog();
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06002] context load failed", error);
                this.renderContextError(error);
            } finally {
                if (panel) panel.setAttribute("aria-busy", "false");
            }
        },

        applyContextData(data, requestedScenarioId = "") {
            const contextProject = data.project && typeof data.project === "object" ? data.project : {};
            this.selectedProject = { ...(this.selectedProject || {}), ...contextProject };
            this.scenarios = asArray(data.scenarios);
            this.flowRuns = asArray(data.flowRuns);
            this.editSessions = asArray(data.editSessions);
            const selection = data.selection && typeof data.selection === "object" ? data.selection : {};
            this.selectedScenarioId = this.resolveSelection(
                this.scenarios,
                ["SCENARIO_ID", "scenarioId"],
                firstValue(selection, ["scenarioId", "SCENARIO_ID", "selectedScenarioId", "SELECTED_SCENARIO_ID"], requestedScenarioId)
            );
            this.selectedFlowRunId = this.resolveSelection(
                this.flowRuns,
                ["FLOW_RUN_ID", "flowRunId"],
                firstValue(selection, ["flowRunId", "FLOW_RUN_ID", "selectedFlowRunId", "SELECTED_FLOW_RUN_ID"])
            );
            this.selectedEditSessionId = this.resolveSelection(
                this.editSessions,
                ["EDIT_SESSION_ID", "editSessionId"],
                firstValue(selection, ["editSessionId", "EDIT_SESSION_ID", "selectedEditSessionId", "SELECTED_EDIT_SESSION_ID"])
            );
        },

        resolveSelection(rows, idKeys, preferredValue) {
            const preferred = String(preferredValue || "");
            if (preferred && rows.some((row) => String(firstValue(row, idKeys)) === preferred)) return preferred;
            return rows.length ? String(firstValue(rows[0], idKeys)) : "";
        },

        renderContextLoading() {
            const title = getContainerEl("#context-title-M06002");
            const description = getContainerEl("#projectContextDescription-M06002");
            const hint = getContainerEl("#selectionHint-M06002");
            if (title) title.textContent = this.t("loadingProject", "프로젝트를 불러오는 중...");
            if (description) description.textContent = this.t("loadingContext", "보고서 적용 기준을 준비하고 있습니다.");
            if (hint) hint.textContent = this.t("loadingSelections", "시나리오, Run과 에디팅 세션을 불러오는 중입니다...");
            ["#scenarioId-M06002", "#flowRunId-M06002", "#editSessionId-M06002"].forEach((selector) => {
                const select = getContainerEl(selector);
                if (select) {
                    select.disabled = true;
                    select.innerHTML = `<option>${this.escapeHtml(this.t("loading", "불러오는 중..."))}</option>`;
                }
            });
            this.renderPaletteLoading();
        },

        renderContext() {
            const project = this.selectedProject || {};
            const title = getContainerEl("#context-title-M06002");
            const description = getContainerEl("#projectContextDescription-M06002");
            if (title) title.textContent = String(firstValue(project, ["PROJECT_NAME", "projectName"], this.t("untitledProject", "이름 없는 프로젝트")));
            if (description) description.textContent = String(firstValue(project, ["PROJECT_DESC", "projectDesc"], this.t("noProjectDescription", "프로젝트 설명이 없습니다.")));
            this.renderSelect(
                "#scenarioId-M06002", this.scenarios, ["SCENARIO_ID", "scenarioId"],
                (row) => this.contextOptionLabel(row, ["SCENARIO_NAME", "scenarioName"], ["SCENARIO_CODE", "scenarioCode"]),
                this.selectedScenarioId, this.t("noScenarios", "시나리오 없음")
            );
            this.renderSelect(
                "#flowRunId-M06002", this.flowRuns, ["FLOW_RUN_ID", "flowRunId"],
                (row) => this.runOptionLabel(row), this.selectedFlowRunId, this.t("noFlowRuns", "규칙발굴 Run 없음")
            );
            this.renderSelect(
                "#editSessionId-M06002", this.editSessions, ["EDIT_SESSION_ID", "editSessionId"],
                (row) => this.editSessionOptionLabel(row), this.selectedEditSessionId, this.t("noEditSessions", "에디팅 세션 없음")
            );
            this.renderSelectionHint();
        },

        renderSelect(selector, rows, idKeys, labelFactory, selectedValue, emptyLabel) {
            const select = getContainerEl(selector);
            if (!select) return;
            if (!rows.length) {
                select.innerHTML = `<option value="">${this.escapeHtml(emptyLabel)}</option>`;
                select.disabled = true;
                return;
            }
            select.disabled = false;
            select.innerHTML = rows.map((row) => {
                const id = String(firstValue(row, idKeys));
                const selected = id === String(selectedValue || "") ? " selected" : "";
                return `<option value="${this.escapeAttr(id)}"${selected}>${this.escapeHtml(labelFactory(row))}</option>`;
            }).join("");
        },

        contextOptionLabel(row, nameKeys, codeKeys) {
            const name = firstValue(row, nameKeys, "-");
            const code = firstValue(row, codeKeys);
            return code ? `${name} · ${code}` : String(name);
        },

        runOptionLabel(row) {
            const id = firstValue(row, ["FLOW_RUN_ID", "flowRunId"], "-");
            const name = firstValue(row, ["FLOW_NAME", "flowName"], this.t("ruleDiscoveryRun", "규칙발굴 Run"));
            const status = firstValue(row, ["STATUS", "status"], "-");
            return `#${id} · ${name} · ${status}`;
        },

        editSessionOptionLabel(row) {
            const id = firstValue(row, ["EDIT_SESSION_ID", "editSessionId"], "-");
            const name = firstValue(row, ["SESSION_NAME", "sessionName"], this.t("editingSession", "에디팅 세션"));
            const status = firstValue(row, ["SESSION_STATUS", "sessionStatus"], "-");
            return `#${id} · ${name} · ${status}`;
        },

        renderSelectionHint() {
            const hint = getContainerEl("#selectionHint-M06002");
            if (!hint) return;
            if (!this.selectedScenarioId) {
                hint.textContent = this.t("scenarioRequiredHint", "선택 가능한 시나리오가 없어 프로젝트 기준으로 미리보기를 생성합니다.");
                return;
            }
            hint.textContent = this.tl("selectionBasisHint", "미리보기 데이터 기준: 시나리오 {scenario}, 규칙발굴 Run {run}, 에디팅 세션 {session}", {
                scenario: `#${this.selectedScenarioId}`,
                run: this.selectedFlowRunId ? `#${this.selectedFlowRunId}` : this.t("notSelected", "미선택"),
                session: this.selectedEditSessionId ? `#${this.selectedEditSessionId}` : this.t("notSelected", "미선택")
            });
        },

        renderContextError(error) {
            const title = getContainerEl("#context-title-M06002");
            const description = getContainerEl("#projectContextDescription-M06002");
            const hint = getContainerEl("#selectionHint-M06002");
            if (title) title.textContent = this.t("contextLoadFailed", "보고서 적용 기준을 불러오지 못했습니다");
            if (description) description.textContent = this.localizedError(error, "tryAgainLater", "잠시 후 다시 시도해 주세요.");
            if (hint) hint.textContent = this.t("contextSelectionUnavailable", "시나리오 및 실행 기준을 선택할 수 없습니다.");
            this.catalog = [];
            this.renderPalette();
        },

        async changeScenario(scenarioId) {
            const projectId = firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]);
            if (!projectId) return;
            this.selectedScenarioId = String(scenarioId || "");
            await this.loadContext(projectId, this.selectedScenarioId);
        },

        getContextValues() {
            return {
                projectId: this.numericOrNull(firstValue(this.selectedProject, ["PROJECT_ID", "projectId"])),
                scenarioId: this.numericOrNull(this.selectedScenarioId),
                flowRunId: this.numericOrNull(this.selectedFlowRunId),
                editSessionId: this.numericOrNull(this.selectedEditSessionId),
                lang: this.getLanguageCode()
            };
        },

        getContextParams() {
            const params = new URLSearchParams();
            Object.entries(this.getContextValues()).forEach(([key, value]) => {
                if (value !== null) params.set(key, String(value));
            });
            return params;
        },

        async loadCatalog() {
            const projectId = firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]);
            if (!projectId) return;
            this.catalogAbortController?.abort();
            this.catalogAbortController = new AbortController();
            const requestController = this.catalogAbortController;
            this.renderPaletteLoading();
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/catalog?${this.getContextParams().toString()}`, {
                    method: "GET",
                    showLoading: false,
                    signal: requestController.signal
                });
                if (requestController !== this.catalogAbortController) return;
                const data = json?.data;
                const rows = Array.isArray(data) ? data : asArray(data?.items || data?.reports || data?.rows);
                this.catalog = rows.map((row, index) => this.normalizeCatalogReport(row, index));
                this.reconcileItemDefinitions();
                this.renderPalette();
                this.renderLayout();
                this.renderInspector();
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06002] catalog load failed", error);
                this.catalog = [];
                this.renderPaletteError(error);
            }
        },

        normalizeCatalogReport(report, index) {
            const code = String(firstValue(report, ["reportCode", "REPORT_CODE", "code"], `R${String(index + 1).padStart(2, "0")}`));
            const availabilitySource = firstValue(report, ["availability", "AVAILABILITY", "AVAILABILITY_STATUS", "status"], "AVAILABLE");
            const availability = availabilitySource && typeof availabilitySource === "object"
                ? firstValue(availabilitySource, ["status", "STATUS"], "AVAILABLE")
                : availabilitySource;
            return {
                ...report,
                code,
                title: String(firstValue(report, ["reportTitle", "REPORT_TITLE", "REPORT_NAME", "title", "name"], code)),
                description: String(firstValue(report, ["reportDescription", "REPORT_DESCRIPTION", "description"], this.t("reportDescriptionFallback", "선택한 기준으로 생성되는 기본형 보고서입니다."))),
                source: firstValue(report, ["sourceMenu", "SOURCE_MENU", "sourceMenus", "SOURCE_MENUS", "category", "CATEGORY"], "IN-DEPS"),
                availability: String(availability).toUpperCase(),
                blocks: this.normalizeBlocks(report)
            };
        },

        normalizeBlocks(source) {
            let rows = asArray(source?.blocks || source?.BLOCKS || source?.blockDefinitions || source?.BLOCK_DEFINITIONS);
            if (!rows.length) {
                rows = DEFAULT_BLOCKS.map((block) => ({
                    ...block,
                    title: this.t(block.titleKey, block.fallback)
                }));
            }
            const known = new Set();
            return rows.map((block, index) => {
                const type = String(firstValue(block, ["type", "TYPE", "blockType", "BLOCK_TYPE"], "SECTION")).toUpperCase();
                const fallbackKey = type === "KPI" ? `kpi:${index}` : `section:${index}`;
                let key = String(firstValue(block, ["key", "KEY", "blockKey", "BLOCK_KEY", "code", "CODE"], fallbackKey));
                if (known.has(key)) key = `${key}:${index}`;
                known.add(key);
                return {
                    key,
                    type,
                    title: String(firstValue(block, ["title", "TITLE", "label", "LABEL", "name", "NAME"], `${this.t("detailBlock", "세부 블록")} ${index + 1}`))
                };
            });
        },

        renderPaletteLoading() {
            const palette = getContainerEl("#reportPalette-M06002");
            const empty = getContainerEl("#paletteEmpty-M06002");
            if (empty) empty.hidden = true;
            if (!palette) return;
            palette.setAttribute("aria-busy", "true");
            palette.innerHTML = Array.from({ length: 8 }, () => `
                <div class="m06002-palette-card m06002-card-skeleton" aria-hidden="true"><span></span><span></span></div>
            `).join("");
        },

        renderPalette() {
            const palette = getContainerEl("#reportPalette-M06002");
            const empty = getContainerEl("#paletteEmpty-M06002");
            const count = getContainerEl("#paletteCount-M06002");
            if (!palette) return;
            const keyword = String(getContainerEl("#paletteSearch-M06002")?.value || "").trim().toLowerCase();
            const placed = new Set((this.currentTemplate?.items || []).map((item) => item.reportCode));
            const filtered = this.catalog.filter((report) => {
                if (!keyword) return true;
                return `${report.code} ${report.title} ${report.description}`.toLowerCase().includes(keyword);
            });
            palette.setAttribute("aria-busy", "false");
            palette.innerHTML = filtered.map((report, index) => {
                const used = placed.has(report.code);
                const source = Array.isArray(report.source) ? report.source.join(" · ") : report.source;
                const actionLabel = used
                    ? this.tl("reportAlreadyPlaced", "{title} 보고서는 이미 배치되었습니다", { title: report.title })
                    : this.tl("addReportToLayout", "{title} 보고서를 레이아웃에 추가", { title: report.title });
                return `
                    <article class="m06002-palette-card${used ? " is-used" : ""}" role="listitem" draggable="${used ? "false" : "true"}" data-palette-code="${this.escapeAttr(report.code)}" aria-disabled="${used ? "true" : "false"}">
                        <span class="m06002-palette-number">${String(index + 1).padStart(2, "0")}</span>
                        <span class="m06002-palette-copy"><strong>${this.escapeHtml(report.title)}</strong><span>${this.escapeHtml(report.code)} · ${this.escapeHtml(source)}</span></span>
                        <button class="m06002-palette-add" type="button" data-action="add-report" data-report-code="${this.escapeAttr(report.code)}" aria-label="${this.escapeAttr(actionLabel)}" ${used ? "disabled" : ""}>
                            <i class="fas ${used ? "fa-check" : "fa-plus"}" aria-hidden="true"></i>
                        </button>
                    </article>`;
            }).join("");
            if (empty) empty.hidden = filtered.length > 0;
            if (count) count.textContent = `${placed.size} / ${this.catalog.length || 20}`;
        },

        renderPaletteError(error) {
            const palette = getContainerEl("#reportPalette-M06002");
            const empty = getContainerEl("#paletteEmpty-M06002");
            if (palette) {
                palette.setAttribute("aria-busy", "false");
                palette.innerHTML = `
                    <div class="m06002-grid-error">
                        <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
                        <strong>${this.escapeHtml(this.t("catalogLoadFailed", "기본형 보고서 20종을 불러오지 못했습니다."))}</strong>
                        <span>${this.escapeHtml(this.localizedError(error, "tryAgainLater", "잠시 후 다시 시도해 주세요."))}</span>
                    </div>`;
            }
            if (empty) empty.hidden = true;
        },

        createEmptyTemplate() {
            return {
                templateId: null,
                name: this.t("newCustomReportName", "새 맞춤형 보고서"),
                description: "",
                paperSize: "A4",
                orientation: "PORTRAIT",
                version: null,
                items: [],
                dirty: false
            };
        },

        normalizeTemplate(source) {
            const layout = parseObject(firstValue(source, ["layout", "LAYOUT", "layoutJson", "LAYOUT_JSON"], {}));
            const sourceItems = asArray(layout.items || source?.items || source?.ITEMS);
            const template = {
                templateId: this.numericOrNull(firstValue(source, ["templateId", "TEMPLATE_ID", "id", "ID"])),
                name: String(firstValue(source, ["name", "NAME", "templateName", "TEMPLATE_NAME"], this.t("newCustomReportName", "새 맞춤형 보고서"))),
                description: String(firstValue(source, ["description", "DESCRIPTION", "templateDescription", "TEMPLATE_DESCRIPTION"], "")),
                paperSize: String(firstValue(source, ["paperSize", "PAPER_SIZE"], "A4")).toUpperCase() === "A3" ? "A3" : "A4",
                orientation: String(firstValue(source, ["orientation", "ORIENTATION"], "PORTRAIT")).toUpperCase() === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
                version: this.numericOrNull(firstValue(source, ["version", "VERSION", "versionNo", "VERSION_NO"])),
                items: [],
                dirty: false
            };
            template.items = sourceItems.map((item, index) => this.normalizeLayoutItem(item, index)).filter(Boolean);
            template.items.sort((left, right) => left.order - right.order);
            return template;
        },

        normalizeLayoutItem(source, index) {
            const reportCode = String(firstValue(source, ["reportCode", "REPORT_CODE", "code"], ""));
            if (!reportCode) return null;
            const report = this.catalog.find((entry) => entry.code === reportCode);
            const definitions = report?.blocks?.length
                ? report.blocks.map((block) => ({ ...block }))
                : DEFAULT_BLOCKS.map((block) => ({
                    ...block,
                    title: this.t(block.titleKey, block.fallback)
                }));
            const savedOrder = parseArray(firstValue(source, ["blockOrder", "BLOCK_ORDER"], []));
            const allowedFromCatalog = asArray(report?.allowedBlockKeys || report?.ALLOWED_BLOCK_KEYS).map(String);
            const allowedKeys = new Set(allowedFromCatalog);
            const isAllowedKey = (key) => allowedKeys.size
                ? allowedKeys.has(key)
                : /^(?:kpi:[A-Za-z0-9_]+|section:(?:[0-9]|[12][0-9]|3[01]))$/.test(key);
            const validSavedOrder = savedOrder.map(String).filter((key, position, array) => isAllowedKey(key) && array.indexOf(key) === position);
            const savedHidden = parseArray(firstValue(source, ["hiddenBlocks", "HIDDEN_BLOCKS"], [])).map(String)
                .filter((key, position, array) => isAllowedKey(key) && array.indexOf(key) === position);
            [...validSavedOrder, ...savedHidden].forEach((key) => {
                if (definitions.some((block) => block.key === key)) return;
                definitions.push({
                    key,
                    type: key.startsWith("kpi:") ? "KPI" : "SECTION",
                    title: `${this.t("missingSavedBlock", "저장된 블록(현재 기준 없음)")} · ${key}`,
                    missing: true
                });
            });
            const blockOrder = [...validSavedOrder];
            definitions.forEach((block) => {
                if (!blockOrder.includes(block.key) && !block.missing) blockOrder.push(block.key);
            });
            const instanceId = String(firstValue(source, ["instanceId", "INSTANCE_ID"], this.createInstanceId(reportCode)));
            return {
                instanceId,
                reportCode,
                title: report?.title || String(firstValue(source, ["title", "TITLE", "reportTitle", "REPORT_TITLE"], reportCode)),
                order: Number(firstValue(source, ["order", "ORDER", "sortOrder", "SORT_ORDER"], index)),
                x: this.clampInt(firstValue(source, ["x", "X"], 0), 0, GRID_COLUMNS - 1),
                y: Math.max(0, this.clampInt(firstValue(source, ["y", "Y"], 0), 0, 100000)),
                w: this.clampInt(firstValue(source, ["w", "W", "width", "WIDTH"], GRID_COLUMNS), 1, GRID_COLUMNS),
                h: this.clampInt(firstValue(source, ["h", "H", "height", "HEIGHT"], 7), 5, 36),
                blockOrder,
                hiddenBlocks: savedHidden,
                blocks: definitions
            };
        },

        async loadTemplates() {
            this.templateAbortController?.abort();
            this.templateAbortController = new AbortController();
            const requestController = this.templateAbortController;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/templates`, {
                    method: "GET",
                    showLoading: false,
                    signal: requestController.signal
                });
                if (requestController !== this.templateAbortController) return;
                const payload = json?.data;
                const rows = Array.isArray(payload) ? payload : asArray(payload?.items || payload?.templates || payload?.rows);
                this.templates = rows.map((row) => this.normalizeTemplate(row));
                this.renderTemplateOptions();
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06002] template list load failed", error);
                this.templates = [];
                this.renderTemplateOptions();
                this.setBuilderStatus(this.localizedError(error, "templateListLoadFailed", "저장된 템플릿 목록을 불러오지 못했습니다."), "error");
            }
        },

        renderTemplateOptions() {
            const select = getContainerEl("#templateId-M06002");
            if (!select) return;
            const currentId = String(this.currentTemplate?.templateId || "");
            select.innerHTML = [
                `<option value="">${this.escapeHtml(this.t("newCustomReportName", "새 맞춤형 보고서"))}</option>`,
                ...this.templates.map((template) => {
                    const selected = String(template.templateId) === currentId ? " selected" : "";
                    return `<option value="${this.escapeAttr(template.templateId)}"${selected}>${this.escapeHtml(template.name)} · ${template.paperSize} ${this.escapeHtml(this.orientationLabel(template.orientation))}</option>`;
                })
            ].join("");
            select.value = currentId;
        },

        async requestTemplateChange(templateId) {
            const previousId = String(this.currentTemplate?.templateId || "");
            if (!(await this.confirmDiscardIfNeeded())) {
                const select = getContainerEl("#templateId-M06002");
                if (select) select.value = previousId;
                return;
            }
            if (!templateId) {
                this.useNewTemplate();
                return;
            }
            await this.loadTemplate(templateId);
        },

        async loadTemplate(templateId) {
            const id = this.numericOrNull(templateId);
            if (!id) return;
            this.setBuilderStatus(this.t("loadingTemplate", "템플릿을 불러오는 중입니다..."));
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/templates/${encodeURIComponent(id)}`, {
                    method: "GET",
                    showLoading: false
                });
                const source = json?.data?.template || json?.data || this.templates.find((template) => template.templateId === id);
                this.currentTemplate = this.normalizeTemplate(source || {});
                this.selectedInstanceId = this.currentTemplate.items[0]?.instanceId || "";
                this.reflowItems({ preserve: true });
                this.renderTemplateEditor();
                this.setBuilderStatus(this.tl("templateLoaded", "'{name}' 템플릿을 불러왔습니다. 현재 프로젝트 기준으로 미리볼 수 있습니다.", { name: this.currentTemplate.name }), "success");
            } catch (error) {
                console.error("[M06002] template load failed", error);
                this.setBuilderStatus(this.localizedError(error, "templateLoadFailed", "템플릿을 불러오지 못했습니다."), "error");
                this.renderTemplateOptions();
            }
        },

        async requestNewTemplate() {
            if (!(await this.confirmDiscardIfNeeded())) return;
            this.useNewTemplate();
        },

        useNewTemplate() {
            this.currentTemplate = this.createEmptyTemplate();
            this.selectedInstanceId = "";
            this.previewDocuments.clear();
            this.renderTemplateEditor();
            getContainerEl("#templateName-M06002")?.focus();
            this.setBuilderStatus(this.t("newTemplateReady", "새 맞춤형 보고서를 설계할 수 있습니다."));
        },

        renderTemplateEditor() {
            if (!this.currentTemplate) this.currentTemplate = this.createEmptyTemplate();
            const name = getContainerEl("#templateName-M06002");
            const paperSize = getContainerEl("#paperSize-M06002");
            const orientation = getContainerEl(`input[name='orientation-M06002'][value='${this.currentTemplate.orientation}']`);
            if (name) name.value = this.currentTemplate.name;
            if (paperSize) paperSize.value = this.currentTemplate.paperSize;
            if (orientation) orientation.checked = true;
            this.renderTemplateOptions();
            this.reflowItems({ preserve: true });
            this.renderPalette();
            this.renderLayout();
            this.renderInspector();
            this.updateActionState();
        },

        reconcileItemDefinitions() {
            if (!this.currentTemplate) return;
            this.currentTemplate.items = this.currentTemplate.items.map((item, index) => this.normalizeLayoutItem(item, index)).filter(Boolean);
            if (this.selectedInstanceId && !this.currentTemplate.items.some((item) => item.instanceId === this.selectedInstanceId)) {
                this.selectedInstanceId = "";
            }
            this.reflowItems({ preserve: true });
        },

        addReport(reportCode, targetIndex = null) {
            const code = String(reportCode || "");
            if (!code || this.currentTemplate.items.some((item) => item.reportCode === code)) {
                this.setBuilderStatus(this.t("duplicateReport", "같은 기본형 보고서는 한 번만 배치할 수 있습니다."), "error");
                return;
            }
            const report = this.catalog.find((entry) => entry.code === code);
            if (!report) return;
            const defaultPlacement = report.defaultPlacement && typeof report.defaultPlacement === "object"
                ? report.defaultPlacement
                : {};
            const item = this.normalizeLayoutItem({
                instanceId: this.createInstanceId(code),
                reportCode: code,
                title: report.title,
                order: this.currentTemplate.items.length,
                w: firstValue(defaultPlacement, ["w", "W"], 6),
                h: firstValue(defaultPlacement, ["h", "H"], 8),
                blockOrder: report.blocks.map((block) => block.key),
                hiddenBlocks: []
            }, this.currentTemplate.items.length);
            const insertionIndex = Number.isInteger(targetIndex)
                ? Math.max(0, Math.min(targetIndex, this.currentTemplate.items.length))
                : this.currentTemplate.items.length;
            this.currentTemplate.items.splice(insertionIndex, 0, item);
            this.selectedInstanceId = item.instanceId;
            this.markDirty();
            this.reflowItems();
            this.renderPalette();
            this.renderLayout();
            this.renderInspector();
            this.setBuilderStatus(this.tl("reportAdded", "'{title}' 보고서를 레이아웃에 추가했습니다.", { title: report.title }), "success");
            window.requestAnimationFrame(() => getContainerEl("#blockInspector-M06002")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
        },

        removeReport(instanceId) {
            const index = this.currentTemplate.items.findIndex((item) => item.instanceId === instanceId);
            if (index < 0) return;
            const [removed] = this.currentTemplate.items.splice(index, 1);
            if (this.selectedInstanceId === instanceId) {
                this.selectedInstanceId = this.currentTemplate.items[Math.min(index, this.currentTemplate.items.length - 1)]?.instanceId || "";
            }
            this.markDirty();
            this.reflowItems();
            this.renderPalette();
            this.renderLayout();
            this.renderInspector();
            this.setBuilderStatus(this.tl("reportRemoved", "'{title}' 보고서를 레이아웃에서 제거했습니다.", { title: removed.title }), "success");
        },

        moveReport(instanceId, direction) {
            const index = this.currentTemplate.items.findIndex((item) => item.instanceId === instanceId);
            const target = index + Number(direction || 0);
            if (index < 0 || target < 0 || target >= this.currentTemplate.items.length) return;
            const [item] = this.currentTemplate.items.splice(index, 1);
            this.currentTemplate.items.splice(target, 0, item);
            this.markDirty();
            this.reflowItems();
            this.renderLayout();
            this.renderInspector();
        },

        moveReportTo(instanceId, targetIndex) {
            const sourceIndex = this.currentTemplate.items.findIndex((item) => item.instanceId === instanceId);
            if (sourceIndex < 0) return;
            let target = Math.max(0, Math.min(Number(targetIndex), this.currentTemplate.items.length));
            const [item] = this.currentTemplate.items.splice(sourceIndex, 1);
            if (sourceIndex < target) target -= 1;
            this.currentTemplate.items.splice(target, 0, item);
            this.selectedInstanceId = instanceId;
            this.markDirty();
            this.reflowItems();
            this.renderLayout();
            this.renderInspector();
        },

        cycleReportWidth(instanceId) {
            const item = this.findItem(instanceId);
            if (!item) return;
            const sizes = [12, 6, 4];
            const currentIndex = sizes.indexOf(item.w);
            item.w = sizes[(currentIndex + 1) % sizes.length];
            item.h = item.w === 12 ? 7 : item.w === 6 ? 9 : 11;
            this.markDirty();
            this.reflowItems();
            this.renderLayout();
            this.renderInspector();
        },

        resizeReportHeight(instanceId, delta) {
            const item = this.findItem(instanceId);
            if (!item) return;
            const nextHeight = this.clampInt(Number(item.h || 7) + Number(delta || 0), 5, this.getPageRows());
            if (nextHeight === item.h) return;
            item.h = nextHeight;
            this.markDirty();
            this.reflowItems();
            this.renderLayout();
            this.renderInspector();
        },

        findItem(instanceId) {
            return this.currentTemplate?.items?.find((item) => item.instanceId === String(instanceId || "")) || null;
        },

        reflowItems({ preserve = false } = {}) {
            if (!this.currentTemplate) return;
            const pageRows = this.getPageRows();
            if (preserve && this.assignSavedPositions(pageRows)) return;
            let page = 0;
            let localY = 0;
            let x = 0;
            let rowHeight = 0;
            this.currentTemplate.items.forEach((item, index) => {
                item.order = index;
                item.w = this.clampInt(item.w, 1, GRID_COLUMNS);
                item.h = this.clampInt(item.h, 5, pageRows);
                if (x + item.w > GRID_COLUMNS) {
                    localY += rowHeight;
                    x = 0;
                    rowHeight = 0;
                }
                if (localY + item.h > pageRows) {
                    page += 1;
                    localY = 0;
                    x = 0;
                    rowHeight = 0;
                }
                item.page = page;
                item.localY = localY;
                item.x = x;
                item.y = page * pageRows + localY;
                x += item.w;
                rowHeight = Math.max(rowHeight, item.h);
                if (x >= GRID_COLUMNS) {
                    localY += rowHeight;
                    x = 0;
                    rowHeight = 0;
                }
            });
        },

        assignSavedPositions(pageRows) {
            const occupied = new Set();
            for (let index = 0; index < this.currentTemplate.items.length; index += 1) {
                const item = this.currentTemplate.items[index];
                const x = Number(item.x);
                const y = Number(item.y);
                const width = Number(item.w);
                const height = Number(item.h);
                if (![x, y, width, height].every(Number.isInteger)) return false;
                if (x < 0 || x >= GRID_COLUMNS || y < 0 || width < 1 || x + width > GRID_COLUMNS || height < 5 || height > pageRows) return false;
                const page = Math.floor(y / pageRows);
                const localY = y % pageRows;
                if (localY + height > pageRows) return false;
                for (let row = localY; row < localY + height; row += 1) {
                    for (let column = x; column < x + width; column += 1) {
                        const cell = `${page}:${column}:${row}`;
                        if (occupied.has(cell)) return false;
                        occupied.add(cell);
                    }
                }
                item.order = index;
                item.page = page;
                item.localY = localY;
                item.x = x;
                item.y = y;
                item.w = width;
                item.h = height;
            }
            return true;
        },

        getPageRows() {
            return PAPER_ROWS[`${this.currentTemplate?.paperSize || "A4"}:${this.currentTemplate?.orientation || "PORTRAIT"}`] || 36;
        },

        getPageCount() {
            if (!this.currentTemplate?.items?.length) return 1;
            return Math.max(...this.currentTemplate.items.map((item) => Number(item.page || 0))) + 1;
        },

        renderLayout() {
            const canvas = getContainerEl("#layoutCanvas-M06002");
            const empty = getContainerEl("#layoutEmpty-M06002");
            if (!canvas || !this.currentTemplate) return;
            this.applyPaperClasses(canvas);
            const pageCount = this.getPageCount();
            canvas.innerHTML = Array.from({ length: pageCount }, (_, pageIndex) => this.paperPageHtml(pageIndex, { preview: false })).join("");
            if (empty) empty.hidden = this.currentTemplate.items.length > 0;
            const placedCount = getContainerEl("#placedReportCount-M06002");
            const pageCountEl = getContainerEl("#pageCount-M06002");
            if (placedCount) placedCount.textContent = String(this.currentTemplate.items.length);
            if (pageCountEl) pageCountEl.textContent = String(pageCount);
            this.updateActionState();
        },

        applyPaperClasses(element) {
            element.classList.toggle("is-a3", this.currentTemplate?.paperSize === "A3");
            element.classList.toggle("is-landscape", this.currentTemplate?.orientation === "LANDSCAPE");
        },

        paperPageHtml(pageIndex, { preview = false } = {}) {
            const items = this.currentTemplate.items.filter((item) => Number(item.page || 0) === pageIndex);
            const label = `${this.currentTemplate.paperSize} · ${this.orientationLabel(this.currentTemplate.orientation)} · ${this.tl("pageNumber", "{page}페이지", { page: pageIndex + 1 })}`;
            return `
                <section class="m06002-paper-wrap" data-page-index="${pageIndex}">
                    <div class="m06002-paper-label"><span>${this.escapeHtml(label)}</span><span>${this.escapeHtml(this.currentTemplate.name || this.t("newCustomReportName", "새 맞춤형 보고서"))}</span></div>
                    <div class="m06002-paper-page" style="--page-rows:${this.getPageRows()}" aria-label="${this.escapeAttr(label)}">
                        ${items.map((item) => this.reportInstanceHtml(item, { preview })).join("")}
                    </div>
                </section>`;
        },

        reportInstanceHtml(item, { preview = false } = {}) {
            const selected = !preview && item.instanceId === this.selectedInstanceId;
            const visibleBlocks = item.blockOrder
                .filter((key) => !item.hiddenBlocks.includes(key))
                .map((key) => item.blocks.find((block) => block.key === key))
                .filter(Boolean);
            const document = preview ? this.previewDocuments.get(item.instanceId) || this.previewDocuments.get(item.reportCode) : null;
            const serverOverflowRisk = preview && Boolean(firstValue(document, ["overflowRisk", "OVERFLOW_RISK"], false));
            const requiredRows = Number(firstValue(document, ["requiredGridRows", "REQUIRED_GRID_ROWS"], 0));
            const blocksHtml = visibleBlocks.length
                ? visibleBlocks.map((block) => `
                    <span class="m06002-instance-block" title="${this.escapeAttr(block.title)}">
                        ${this.escapeHtml(block.title)}${document ? this.previewBlockValue(document, block.key) : ""}
                    </span>`).join("")
                : `<span class="m06002-instance-empty">${this.escapeHtml(this.t("allBlocksHidden", "모든 세부 블록이 숨겨졌습니다."))}</span>`;
            const style = `grid-column:${item.x + 1} / span ${item.w};grid-row:${Number(item.localY || 0) + 1} / span ${item.h}`;
            const draggable = preview ? "" : ` draggable="true" tabindex="0" role="listitem"`;
            const controls = preview ? "" : `
                <span class="m06002-instance-actions">
                    <button class="m06002-mini-btn" type="button" data-action="select-instance" aria-label="${this.escapeAttr(this.t("editReportBlocks", "세부 블록 편집"))}"><i class="fas fa-sliders" aria-hidden="true"></i></button>
                    <button class="m06002-mini-btn" type="button" data-action="move-up" aria-label="${this.escapeAttr(this.t("moveReportUp", "보고서 앞으로 이동"))}"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
                    <button class="m06002-mini-btn" type="button" data-action="move-down" aria-label="${this.escapeAttr(this.t("moveReportDown", "보고서 뒤로 이동"))}"><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                    <button class="m06002-mini-btn" type="button" data-action="cycle-width" aria-label="${this.escapeAttr(this.t("changeReportWidth", "보고서 너비 변경"))}"><i class="fas fa-arrows-left-right" aria-hidden="true"></i></button>
                    <button class="m06002-mini-btn" type="button" data-action="height-down" aria-label="${this.escapeAttr(this.t("decreaseReportHeight", "보고서 높이 줄이기"))}"><i class="fas fa-compress" aria-hidden="true"></i></button>
                    <button class="m06002-mini-btn" type="button" data-action="height-up" aria-label="${this.escapeAttr(this.t("increaseReportHeight", "보고서 높이 늘리기"))}"><i class="fas fa-expand" aria-hidden="true"></i></button>
                    <button class="m06002-mini-btn is-danger" type="button" data-action="remove-instance" aria-label="${this.escapeAttr(this.t("removeReport", "보고서 제거"))}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
                </span>`;
            const availabilitySource = document ? firstValue(document, ["availability", "AVAILABILITY"], {}) : {};
            const availability = document
                ? String(firstValue(availabilitySource, ["status", "STATUS"], firstValue(document, ["status", "STATUS"], "")))
                : "";
            const overflowWarningText = requiredRows > item.h
                ? this.tl("previewOverflowRowsWarning", "내용이 잘림 — 높이 {rows}칸이 필요합니다. 전체 데이터는 다운로드 부록에 포함됩니다.", { rows: requiredRows })
                : this.t("previewOverflowWarning", "내용이 잘림 — 높이를 늘리거나 블록을 숨겨 주세요. 전체 데이터는 다운로드 부록에 포함됩니다.");
            const overflowWarning = preview
                ? `<span class="m06002-overflow-warning"${serverOverflowRisk ? "" : " hidden"}>${this.escapeHtml(overflowWarningText)}</span>`
                : "";
            return `
                <article class="m06002-report-instance${selected ? " is-selected" : ""}${serverOverflowRisk ? " is-overflowing" : ""}" data-instance-id="${this.escapeAttr(item.instanceId)}" style="${style}"${draggable} aria-label="${this.escapeAttr(item.title)}">
                    <div class="m06002-instance-head">
                        <span class="m06002-instance-title"><span class="m06002-instance-code">${this.escapeHtml(item.reportCode)}${availability ? ` · ${this.escapeHtml(availability)}` : ""}</span><br>${this.escapeHtml(item.title)}</span>
                        ${controls}
                    </div>
                    <div class="m06002-instance-blocks">${blocksHtml}</div>
                    ${overflowWarning}
                </article>`;
        },

        previewBlockValue(document, blockKey) {
            const blocks = asArray(document?.blocks || document?.report?.blocks);
            const block = blocks.find((entry) => String(firstValue(entry, ["key", "KEY", "blockKey", "BLOCK_KEY"])) === String(blockKey));
            if (!block) return "";
            const data = block?.data;
            const value = firstValue(block, ["value", "VALUE", "displayValue", "DISPLAY_VALUE"], firstValue(data, ["value", "VALUE", "displayValue", "DISPLAY_VALUE"], ""));
            if (value !== "") return ` · ${this.escapeHtml(this.truncate(value, 28))}`;
            const rows = Array.isArray(data)
                ? data
                : asArray(block.rows || data?.rows || data?.items || block.items);
            if (rows.length) return ` · ${this.escapeHtml(this.tl("previewRows", "{count}건", { count: rows.length }))}`;
            return "";
        },

        renderInspector() {
            const panel = getContainerEl("#blockInspector-M06002");
            const list = getContainerEl("#blockList-M06002");
            const hint = getContainerEl("#blockInspectorHint-M06002");
            const item = this.findItem(this.selectedInstanceId);
            if (!panel || !list) return;
            panel.hidden = !item;
            if (!item) {
                list.innerHTML = "";
                return;
            }
            if (hint) hint.textContent = this.tl("blockInspectorSelected", "{code} {title}의 표시할 블록과 순서를 조정합니다.", {
                code: item.reportCode,
                title: item.title
            });
            const index = this.currentTemplate.items.findIndex((entry) => entry.instanceId === item.instanceId);
            const widthLabel = item.w === 12
                ? this.t("fullWidth", "전체 너비")
                : item.w === 6
                    ? this.t("halfWidth", "절반 너비")
                    : item.w === 4
                        ? this.t("thirdWidth", "1/3 너비")
                        : `${item.w}/12`;
            const itemToolbar = `
                <div class="m06002-block-row m06002-instance-inspector-toolbar">
                    <span class="m06002-block-copy"><strong>${this.escapeHtml(item.title)}</strong><span>${this.escapeHtml(widthLabel)} · ${this.tl("reportHeightRows", "높이 {height}칸", { height: item.h })} · ${this.tl("visibleBlockCount", "{visible}/{total}개 블록 표시", { visible: item.blockOrder.filter((key) => !item.hiddenBlocks.includes(key)).length, total: item.blockOrder.length })}</span></span>
                    <span class="m06002-block-actions">
                        <button class="m06002-mini-btn" type="button" data-instance-action="move-up" aria-label="${this.escapeAttr(this.t("moveReportUp", "보고서 앞으로 이동"))}" ${index === 0 ? "disabled" : ""}><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
                        <button class="m06002-mini-btn" type="button" data-instance-action="move-down" aria-label="${this.escapeAttr(this.t("moveReportDown", "보고서 뒤로 이동"))}" ${index === this.currentTemplate.items.length - 1 ? "disabled" : ""}><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                        <button class="m06002-mini-btn" type="button" data-instance-action="cycle-width" aria-label="${this.escapeAttr(this.t("changeReportWidth", "보고서 너비 변경"))}"><i class="fas fa-arrows-left-right" aria-hidden="true"></i></button>
                        <button class="m06002-mini-btn" type="button" data-instance-action="height-down" aria-label="${this.escapeAttr(this.t("decreaseReportHeight", "보고서 높이 줄이기"))}" ${item.h <= 5 ? "disabled" : ""}><i class="fas fa-compress" aria-hidden="true"></i></button>
                        <button class="m06002-mini-btn" type="button" data-instance-action="height-up" aria-label="${this.escapeAttr(this.t("increaseReportHeight", "보고서 높이 늘리기"))}" ${item.h >= this.getPageRows() ? "disabled" : ""}><i class="fas fa-expand" aria-hidden="true"></i></button>
                        <button class="m06002-mini-btn is-danger" type="button" data-instance-action="remove-instance" aria-label="${this.escapeAttr(this.t("removeReport", "보고서 제거"))}"><i class="far fa-trash-can" aria-hidden="true"></i></button>
                    </span>
                </div>`;
            const blocks = item.blockOrder.map((key, blockIndex) => item.blocks.find((block) => block.key === key)).filter(Boolean);
            list.innerHTML = itemToolbar + blocks.map((block, blockIndex) => {
                const visible = !item.hiddenBlocks.includes(block.key);
                return `
                    <div class="m06002-block-row${visible ? "" : " is-hidden"}${block.missing ? " is-missing" : ""}" role="listitem" draggable="true" data-block-key="${this.escapeAttr(block.key)}">
                        <span class="m06002-drag-handle" aria-hidden="true"><i class="fas fa-grip-vertical"></i></span>
                        <label class="m06002-block-toggle">
                            <input type="checkbox" data-action="toggle-block" data-block-key="${this.escapeAttr(block.key)}" ${visible ? "checked" : ""}>
                            <span class="m06002-block-copy"><strong>${this.escapeHtml(block.title)}</strong><span>${this.escapeHtml(block.type)} · ${this.escapeHtml(block.key)}</span></span>
                        </label>
                        <span class="m06002-block-actions">
                            <button class="m06002-mini-btn" type="button" data-action="move-block-up" data-block-key="${this.escapeAttr(block.key)}" aria-label="${this.escapeAttr(this.t("moveBlockUp", "블록 위로 이동"))}" ${blockIndex === 0 ? "disabled" : ""}><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
                            <button class="m06002-mini-btn" type="button" data-action="move-block-down" data-block-key="${this.escapeAttr(block.key)}" aria-label="${this.escapeAttr(this.t("moveBlockDown", "블록 아래로 이동"))}" ${blockIndex === blocks.length - 1 ? "disabled" : ""}><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                        </span>
                    </div>`;
            }).join("");
        },

        closeInspector() {
            this.selectedInstanceId = "";
            this.renderLayout();
            this.renderInspector();
        },

        onCanvasClick(event) {
            const instance = event.target.closest?.("[data-instance-id]");
            if (!instance) return;
            const action = event.target.closest?.("[data-action]")?.dataset.action;
            const instanceId = instance.dataset.instanceId;
            if (action === "move-up") this.moveReport(instanceId, -1);
            else if (action === "move-down") this.moveReport(instanceId, 1);
            else if (action === "cycle-width") this.cycleReportWidth(instanceId);
            else if (action === "height-down") this.resizeReportHeight(instanceId, -1);
            else if (action === "height-up") this.resizeReportHeight(instanceId, 1);
            else if (action === "remove-instance") this.removeReport(instanceId);
            else {
                this.selectedInstanceId = instanceId;
                this.renderLayout();
                this.renderInspector();
            }
        },

        onCanvasKeydown(event) {
            if (!new Set(["Enter", " "]).has(event.key)) return;
            const instance = event.target.closest?.("[data-instance-id]");
            if (!instance || event.target.closest("button")) return;
            event.preventDefault();
            this.selectedInstanceId = instance.dataset.instanceId;
            this.renderLayout();
            this.renderInspector();
            getContainerEl("#blockInspector-M06002")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        },

        onInspectorClick(event) {
            const instanceAction = event.target.closest?.("[data-instance-action]")?.dataset.instanceAction;
            if (instanceAction === "move-up") this.moveReport(this.selectedInstanceId, -1);
            else if (instanceAction === "move-down") this.moveReport(this.selectedInstanceId, 1);
            else if (instanceAction === "cycle-width") this.cycleReportWidth(this.selectedInstanceId);
            else if (instanceAction === "height-down") this.resizeReportHeight(this.selectedInstanceId, -1);
            else if (instanceAction === "height-up") this.resizeReportHeight(this.selectedInstanceId, 1);
            else if (instanceAction === "remove-instance") this.removeReport(this.selectedInstanceId);
            const actionElement = event.target.closest?.("[data-action]");
            if (!actionElement) return;
            if (actionElement.dataset.action === "move-block-up") this.moveBlock(actionElement.dataset.blockKey, -1);
            if (actionElement.dataset.action === "move-block-down") this.moveBlock(actionElement.dataset.blockKey, 1);
        },

        onInspectorChange(event) {
            const checkbox = event.target.closest?.("[data-action='toggle-block']");
            if (!checkbox) return;
            const item = this.findItem(this.selectedInstanceId);
            if (!item) return;
            const key = String(checkbox.dataset.blockKey || "");
            const hidden = new Set(item.hiddenBlocks);
            if (checkbox.checked) hidden.delete(key);
            else hidden.add(key);
            item.hiddenBlocks = Array.from(hidden);
            this.markDirty();
            this.renderLayout();
            this.renderInspector();
        },

        moveBlock(blockKey, direction) {
            const item = this.findItem(this.selectedInstanceId);
            if (!item) return;
            const index = item.blockOrder.indexOf(String(blockKey));
            const target = index + Number(direction || 0);
            if (index < 0 || target < 0 || target >= item.blockOrder.length) return;
            const [key] = item.blockOrder.splice(index, 1);
            item.blockOrder.splice(target, 0, key);
            this.markDirty();
            this.renderLayout();
            this.renderInspector();
        },

        moveBlockTo(blockKey, targetKey) {
            const item = this.findItem(this.selectedInstanceId);
            if (!item || blockKey === targetKey) return;
            const sourceIndex = item.blockOrder.indexOf(String(blockKey));
            let targetIndex = item.blockOrder.indexOf(String(targetKey));
            if (sourceIndex < 0 || targetIndex < 0) return;
            const [key] = item.blockOrder.splice(sourceIndex, 1);
            if (sourceIndex < targetIndex) targetIndex -= 1;
            item.blockOrder.splice(targetIndex, 0, key);
            this.markDirty();
            this.renderLayout();
            this.renderInspector();
        },

        onPaletteDragStart(event) {
            const card = event.target.closest?.("[data-palette-code]");
            if (!card || card.getAttribute("aria-disabled") === "true") {
                event.preventDefault();
                return;
            }
            this.setDragPayload(event, { type: "palette", reportCode: card.dataset.paletteCode });
        },

        onCanvasDragStart(event) {
            const item = event.target.closest?.("[data-instance-id]");
            if (!item) return;
            item.classList.add("is-dragging");
            this.setDragPayload(event, { type: "instance", instanceId: item.dataset.instanceId });
        },

        onCanvasDragOver(event) {
            if (!this.dragPayload || !new Set(["palette", "instance"]).has(this.dragPayload.type)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = this.dragPayload.type === "palette" ? "copy" : "move";
            getContainerEl("#layoutCanvas-M06002")?.classList.add("is-dragover");
        },

        onCanvasDrop(event) {
            if (!this.dragPayload || !new Set(["palette", "instance"]).has(this.dragPayload.type)) return;
            event.preventDefault();
            const targetElement = event.target.closest?.("[data-instance-id]");
            const targetIndex = targetElement
                ? this.currentTemplate.items.findIndex((item) => item.instanceId === targetElement.dataset.instanceId)
                : this.currentTemplate.items.length;
            if (this.dragPayload.type === "palette") this.addReport(this.dragPayload.reportCode, targetIndex);
            if (this.dragPayload.type === "instance") this.moveReportTo(this.dragPayload.instanceId, targetIndex);
            this.clearDragState();
        },

        onInspectorDragStart(event) {
            const row = event.target.closest?.("[data-block-key]");
            if (!row) return;
            row.classList.add("is-dragging");
            this.setDragPayload(event, { type: "block", blockKey: row.dataset.blockKey, instanceId: this.selectedInstanceId });
        },

        onInspectorDragOver(event) {
            if (this.dragPayload?.type !== "block") return;
            const target = event.target.closest?.("[data-block-key]");
            if (!target) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        },

        onInspectorDrop(event) {
            if (this.dragPayload?.type !== "block" || this.dragPayload.instanceId !== this.selectedInstanceId) return;
            const target = event.target.closest?.("[data-block-key]");
            if (!target) return;
            event.preventDefault();
            this.moveBlockTo(this.dragPayload.blockKey, target.dataset.blockKey);
            this.clearDragState();
        },

        setDragPayload(event, payload) {
            this.dragPayload = payload;
            if (!event.dataTransfer) return;
            const serialized = JSON.stringify(payload);
            event.dataTransfer.effectAllowed = payload.type === "palette" ? "copy" : "move";
            event.dataTransfer.setData("application/x-indeps-m06002", serialized);
            event.dataTransfer.setData("text/plain", serialized);
        },

        clearDragState() {
            this.dragPayload = null;
            getContainerEl("#layoutCanvas-M06002")?.classList.remove("is-dragover");
            getContainerEl("#container-M06002")?.querySelectorAll(".is-dragging").forEach((element) => element.classList.remove("is-dragging"));
        },

        markDirty() {
            if (!this.currentTemplate) return;
            this.currentTemplate.dirty = true;
            this.previewDocuments.clear();
            this.previewDownloads = [];
            this.updateActionState();
            this.setBuilderStatus(this.t("unsavedChanges", "저장하지 않은 변경사항이 있습니다."));
        },

        buildTemplatePayload() {
            this.reflowItems({ preserve: true });
            const payload = {
                name: String(this.currentTemplate.name || "").trim(),
                description: String(this.currentTemplate.description || ""),
                paperSize: this.currentTemplate.paperSize,
                orientation: this.currentTemplate.orientation,
                layout: {
                    schemaVersion: "1.0",
                    items: this.currentTemplate.items.map((item, index) => ({
                        instanceId: item.instanceId,
                        reportCode: item.reportCode,
                        order: index,
                        x: item.x,
                        y: item.y,
                        w: item.w,
                        h: item.h,
                        blockOrder: [...item.blockOrder],
                        hiddenBlocks: [...item.hiddenBlocks]
                    }))
                }
            };
            if (this.currentTemplate.version !== null) payload.expectedVersion = this.currentTemplate.version;
            return payload;
        },

        validateTemplate() {
            const name = String(this.currentTemplate?.name || "").trim();
            if (!name) {
                this.setBuilderStatus(this.t("templateNameRequired", "템플릿 이름을 입력해 주세요."), "error");
                getContainerEl("#templateName-M06002")?.focus();
                return false;
            }
            if (!this.currentTemplate.items.length) {
                this.setBuilderStatus(this.t("reportRequired", "기본형 보고서를 한 개 이상 배치해 주세요."), "error");
                getContainerEl("#reportPalette-M06002")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
                return false;
            }
            if (!this.catalog.length || this.currentTemplate.items.some((item) => !this.catalog.some((report) => report.code === item.reportCode))) {
                this.setBuilderStatus(this.t("catalogRequired", "기본형 보고서 정의를 먼저 불러와야 저장하거나 미리볼 수 있습니다."), "error");
                return false;
            }
            return true;
        },

        async saveTemplate({ quiet = false } = {}) {
            if (this.saving || !this.validateTemplate()) return false;
            this.saving = true;
            this.updateActionState();
            const id = this.currentTemplate.templateId;
            const method = id ? "PUT" : "POST";
            const usageParams = new URLSearchParams();
            const context = this.getContextValues();
            if (context.projectId !== null) usageParams.set("projectId", String(context.projectId));
            if (context.scenarioId !== null) usageParams.set("scenarioId", String(context.scenarioId));
            const usageQuery = usageParams.toString() ? `?${usageParams.toString()}` : "";
            const url = id
                ? `${API_BASE_URL}/${PAGE_CODE}/templates/${encodeURIComponent(id)}${usageQuery}`
                : `${API_BASE_URL}/${PAGE_CODE}/templates${usageQuery}`;
            this.setBuilderStatus(this.t("savingTemplate", "템플릿을 저장하는 중입니다..."));
            try {
                const json = await CommonUtils.request(url, { method, body: this.buildTemplatePayload(), showLoading: !quiet });
                const source = json?.data?.template || json?.data || {};
                const saved = this.normalizeTemplate({ ...this.buildTemplatePayload(), ...source });
                if (!saved.templateId && id) saved.templateId = id;
                saved.dirty = false;
                this.currentTemplate = saved;
                this.selectedInstanceId = saved.items.some((item) => item.instanceId === this.selectedInstanceId)
                    ? this.selectedInstanceId
                    : saved.items[0]?.instanceId || "";
                const existingIndex = this.templates.findIndex((template) => template.templateId === saved.templateId);
                if (existingIndex >= 0) this.templates.splice(existingIndex, 1, this.normalizeTemplate(saved));
                else this.templates.unshift(this.normalizeTemplate(saved));
                this.renderTemplateEditor();
                this.projectUsageDirty = true;
                this.setBuilderStatus(this.tl("templateSaved", "'{name}' 템플릿을 저장했습니다. 현재 Target DB의 다른 프로젝트와 시나리오에서도 사용할 수 있습니다.", { name: saved.name }), "success");
                return true;
            } catch (error) {
                console.error("[M06002] template save failed", error);
                this.setBuilderStatus(this.localizedError(error, "templateSaveFailed", "템플릿을 저장하지 못했습니다."), "error");
                return false;
            } finally {
                this.saving = false;
                this.updateActionState();
            }
        },

        async deleteTemplate() {
            const id = this.currentTemplate?.templateId;
            if (!id || this.saving) return;
            const confirmed = await this.confirm(this.tl("confirmDeleteTemplate", "'{name}' 템플릿을 삭제할까요? 이 작업은 되돌릴 수 없습니다.", { name: this.currentTemplate.name }));
            if (!confirmed) return;
            try {
                await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/templates/${encodeURIComponent(id)}`, {
                    method: "DELETE",
                    showLoading: true
                });
                this.templates = this.templates.filter((template) => template.templateId !== id);
                this.projectUsageDirty = true;
                this.useNewTemplate();
                this.setBuilderStatus(this.t("templateDeleted", "템플릿을 삭제했습니다."), "success");
            } catch (error) {
                console.error("[M06002] template delete failed", error);
                this.setBuilderStatus(this.localizedError(error, "templateDeleteFailed", "템플릿을 삭제하지 못했습니다."), "error");
            }
        },

        async applyTemplateToContext() {
            if (!this.currentTemplate?.templateId) return;
            if (this.currentTemplate.dirty && !(await this.saveTemplate({ quiet: true }))) return;
            this.setBuilderStatus(this.t("applyingTemplate", "저장된 템플릿을 현재 프로젝트와 시나리오 데이터에 적용합니다..."));
            await this.openPreview({ useSavedTemplate: true });
        },

        async openPreview({ useSavedTemplate = false } = {}) {
            if (!this.validateTemplate()) return;
            const dialog = getContainerEl("#previewDialog-M06002");
            const pages = getContainerEl("#previewPages-M06002");
            if (!dialog || !pages) return;
            this.previewAbortController?.abort();
            this.previewAbortController = new AbortController();
            this.previewDocuments.clear();
            this.previewDownloads = [];
            this.renderPreviewPages();
            this.renderPreviewBasis();
            this.setPreviewLoading(true);
            if (typeof dialog.showModal === "function") {
                if (!dialog.open) dialog.showModal();
            } else {
                dialog.setAttribute("open", "");
            }
            try {
                const context = this.getContextValues();
                const canUseSaved = useSavedTemplate && this.currentTemplate.templateId && !this.currentTemplate.dirty;
                const url = canUseSaved
                    ? `${API_BASE_URL}/${PAGE_CODE}/templates/${encodeURIComponent(this.currentTemplate.templateId)}/preview`
                    : `${API_BASE_URL}/${PAGE_CODE}/preview`;
                const body = canUseSaved ? context : { ...this.buildTemplatePayload(), ...context };
                const json = await CommonUtils.request(url, {
                    method: "POST",
                    body,
                    showLoading: false,
                    timeoutMs: 180000,
                    signal: this.previewAbortController.signal
                });
                const data = json?.data && typeof json.data === "object" ? json.data : {};
                asArray(data.items || data.reports).forEach((entry) => {
                    const instanceId = String(firstValue(entry, ["instanceId", "INSTANCE_ID"], ""));
                    const reportCode = String(firstValue(entry, ["reportCode", "REPORT_CODE"], firstValue(entry.report, ["reportCode", "REPORT_CODE", "code"], "")));
                    if (instanceId) this.previewDocuments.set(instanceId, entry);
                    if (reportCode) this.previewDocuments.set(reportCode, entry);
                });
                this.previewDownloads = asArray(data.downloads).map((value) => String(value).toLowerCase());
                this.renderPreviewPages();
                this.renderPreviewBasis(data);
                this.updatePreviewDownloadState();
                if (canUseSaved) this.projectUsageDirty = true;
                this.setBuilderStatus(this.t("previewReady", "현재 프로젝트와 시나리오 데이터로 미리보기를 생성했습니다."), "success");
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06002] preview load failed", error);
                const message = this.localizedError(error, "previewDataUnavailable", "실제 데이터를 불러오지 못해 레이아웃 미리보기만 표시합니다.");
                this.renderPreviewBasis({}, message);
                this.setBuilderStatus(message, "error");
            } finally {
                this.setPreviewLoading(false);
            }
        },

        renderPreviewPages() {
            const pages = getContainerEl("#previewPages-M06002");
            if (!pages) return;
            this.applyPaperClasses(pages);
            pages.innerHTML = Array.from({ length: this.getPageCount() }, (_, pageIndex) => this.paperPageHtml(pageIndex, { preview: true })).join("");
            this.updatePreviewDownloadState();
            window.requestAnimationFrame(() => this.detectPreviewOverflow());
        },

        detectPreviewOverflow() {
            const pages = getContainerEl("#previewPages-M06002");
            if (!pages) return;
            pages.querySelectorAll(".m06002-report-instance[data-instance-id]").forEach((card) => {
                const instanceId = String(card.dataset.instanceId || "");
                const item = this.findItem(instanceId);
                const content = card.querySelector(".m06002-instance-blocks");
                const document = this.previewDocuments.get(instanceId) || this.previewDocuments.get(item?.reportCode);
                const serverRisk = Boolean(firstValue(document, ["overflowRisk", "OVERFLOW_RISK"], false));
                const hasServerRisk = Boolean(document && (
                    Object.prototype.hasOwnProperty.call(document, "overflowRisk")
                    || Object.prototype.hasOwnProperty.call(document, "OVERFLOW_RISK")
                ));
                const denseData = !hasServerRisk
                    && this.previewDataWeight(document) > Math.max(4, Number(item?.h || 0) * Math.max(1, Number(item?.w || 12) / 6));
                const clipped = Boolean(content && content.scrollHeight > content.clientHeight + 1);
                const overflowing = serverRisk || clipped || denseData;
                card.classList.toggle("is-overflowing", overflowing);
                const warning = card.querySelector(".m06002-overflow-warning");
                if (warning) warning.hidden = !overflowing;
            });
        },

        previewDataWeight(document) {
            if (!document) return 0;
            return asArray(document.blocks || document.report?.blocks).reduce((total, block) => {
                const data = block?.data;
                if (Array.isArray(data)) return total + Math.min(data.length, 20);
                if (data && typeof data === "object") {
                    const rows = asArray(data.rows || data.items || data.data);
                    if (rows.length) return total + Math.min(rows.length, 20);
                    try { return total + Math.min(12, Math.ceil(JSON.stringify(data).length / 180)); } catch (_) { return total + 2; }
                }
                return total + 1;
            }, 0);
        },

        renderPreviewBasis(data = {}, errorMessage = "") {
            const basis = getContainerEl("#previewBasis-M06002");
            if (!basis) return;
            const projectName = firstValue(data?.context?.project || data?.context, ["projectName", "PROJECT_NAME"], firstValue(this.selectedProject, ["PROJECT_NAME", "projectName"], "-"));
            const base = this.tl("previewBasis", "{name} · {paper} {orientation} · {pages}페이지 · {reports}개 보고서", {
                name: projectName,
                paper: this.currentTemplate.paperSize,
                orientation: this.orientationLabel(this.currentTemplate.orientation),
                pages: this.getPageCount(),
                reports: this.currentTemplate.items.length
            });
            basis.textContent = errorMessage ? `${base} · ${errorMessage}` : base;
        },

        setPreviewLoading(loading) {
            const indicator = getContainerEl("#previewLoading-M06002");
            if (indicator) indicator.hidden = !loading;
        },

        closePreview() {
            this.previewAbortController?.abort();
            this.previewAbortController = null;
            const dialog = getContainerEl("#previewDialog-M06002");
            if (!dialog) return;
            if (typeof dialog.close === "function" && dialog.open) dialog.close();
            else dialog.removeAttribute("open");
        },

        updatePreviewDownloadState() {
            const savedAndCurrent = Boolean(this.currentTemplate?.templateId && !this.currentTemplate.dirty);
            ["html", "pdf"].forEach((format) => {
                const button = getContainerEl(`#download${format === "html" ? "Html" : "Pdf"}-M06002`);
                if (!button) return;
                const allowed = !this.previewDownloads.length || this.previewDownloads.includes(format);
                button.disabled = !savedAndCurrent || !allowed || this.downloading;
                button.title = savedAndCurrent ? "" : this.t("saveBeforeDownload", "다운로드하려면 템플릿을 먼저 저장해 주세요.");
            });
        },

        async downloadTemplate(format, button) {
            const normalized = String(format || "").toLowerCase();
            if (!new Set(["html", "pdf"]).has(normalized) || button?.disabled || this.downloading || !this.currentTemplate?.templateId) return;
            this.downloading = true;
            this.downloadAbortController?.abort();
            this.downloadAbortController = new AbortController();
            this.updatePreviewDownloadState();
            button.setAttribute("aria-busy", "true");
            const params = this.getContextParams();
            params.set("format", normalized);
            const timeoutId = window.setTimeout(() => this.downloadAbortController?.abort(), 300000);
            try {
                const headers = { Accept: normalized === "pdf" ? "application/pdf" : "text/html" };
                const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
                if (targetConnectionId) headers["X-Target-Connection-Id"] = targetConnectionId;
                const response = await fetch(`${API_BASE_URL}/${PAGE_CODE}/templates/${encodeURIComponent(this.currentTemplate.templateId)}/download?${params.toString()}`, {
                    method: "GET",
                    credentials: "include",
                    headers,
                    cache: "no-store",
                    signal: this.downloadAbortController.signal
                });
                if (!response.ok) throw new Error(await this.parseDownloadError(response));
                const blob = await response.blob();
                const disposition = response.headers.get("content-disposition") || "";
                const filename = this.responseFilename(disposition, normalized);
                const objectUrl = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = objectUrl;
                link.download = filename;
                link.hidden = true;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            } catch (error) {
                console.error("[M06002] template download failed", error);
                const message = error?.name === "AbortError"
                    ? this.t("downloadTimeout", "다운로드 준비 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.")
                    : this.localizedError(error, "downloadFailed", "맞춤형 보고서를 다운로드하지 못했습니다.");
                this.setBuilderStatus(message, "error");
            } finally {
                window.clearTimeout(timeoutId);
                this.downloading = false;
                this.downloadAbortController = null;
                button.removeAttribute("aria-busy");
                this.updatePreviewDownloadState();
            }
        },

        async parseDownloadError(response) {
            const text = await response.text().catch(() => "");
            if (!text) return this.t("downloadFailed", "맞춤형 보고서를 다운로드하지 못했습니다.");
            try {
                const data = JSON.parse(text);
                return String(data?.detail || data?.message || text);
            } catch (_) {
                return text.slice(0, 300);
            }
        },

        responseFilename(disposition, format) {
            const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
            const plain = /filename="?([^";]+)"?/i.exec(disposition);
            const encoded = utf8?.[1];
            if (encoded) {
                try { return decodeURIComponent(encoded); } catch (_) { return encoded; }
            }
            if (plain?.[1]) return plain[1];
            const safeName = String(this.currentTemplate?.name || "custom-report").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
            return `${safeName}.${format}`;
        },

        updateActionState() {
            const hasItems = Boolean(this.currentTemplate?.items?.length);
            const saved = Boolean(this.currentTemplate?.templateId);
            const save = getContainerEl("#saveTemplate-M06002");
            const remove = getContainerEl("#deleteTemplate-M06002");
            const apply = getContainerEl("#applyTemplate-M06002");
            const preview = getContainerEl("#previewTemplate-M06002");
            if (save) {
                save.disabled = this.saving || !hasItems || !this.catalog.length;
                save.setAttribute("aria-busy", this.saving ? "true" : "false");
                save.title = hasItems ? "" : this.t("reportRequired", "기본형 보고서를 한 개 이상 배치해 주세요.");
            }
            if (remove) remove.disabled = !saved || this.saving;
            if (apply) apply.disabled = !saved || !hasItems || this.saving;
            if (preview) preview.disabled = !hasItems || this.saving;
            this.updatePreviewDownloadState();
        },

        setBuilderStatus(message, type = "info") {
            const status = getContainerEl("#builderStatus-M06002");
            if (!status) return;
            status.classList.toggle("is-error", type === "error");
            status.classList.toggle("is-success", type === "success");
            const icon = status.querySelector("i");
            const copy = status.querySelector("span");
            if (icon) icon.className = `fas ${type === "error" ? "fa-circle-exclamation" : type === "success" ? "fa-circle-check" : "fa-circle-info"}`;
            if (copy) copy.textContent = String(message || "");
        },

        async confirmDiscardIfNeeded() {
            if (!this.currentTemplate?.dirty) return true;
            return this.confirm(this.t("confirmDiscard", "저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동할까요?"));
        },

        async confirm(message) {
            if (typeof window.CommonMessage?.confirm === "function") return Boolean(await window.CommonMessage.confirm(message));
            return window.confirm(message);
        },

        orientationLabel(value) {
            return value === "LANDSCAPE" ? this.t("landscape", "가로") : this.t("portrait", "세로");
        },

        createInstanceId(reportCode) {
            if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
            return `${String(reportCode || "report")}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        },

        clampInt(value, minimum, maximum) {
            const number = Math.round(Number(value));
            if (!Number.isFinite(number)) return minimum;
            return Math.max(minimum, Math.min(maximum, number));
        },

        numericOrNull(value) {
            if (value === "" || value === null || value === undefined) return null;
            const number = Number(value);
            return Number.isFinite(number) && number > 0 ? number : null;
        },

        latestDate(...values) {
            return values
                .map((value) => ({ value, time: value ? new Date(value).getTime() : Number.NaN }))
                .filter((item) => Number.isFinite(item.time))
                .sort((left, right) => right.time - left.time)[0]?.value || "";
        },

        formatDate(value) {
            if (!value) return "-";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return new Intl.DateTimeFormat(this.getLanguageCode() === "ko" ? "ko-KR" : "en-US", {
                year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
            }).format(date);
        },

        formatNumber(value) {
            const number = Number(value);
            return Number.isFinite(number) ? number.toLocaleString() : "0";
        },

        getLanguageCode() {
            return window.I18nManager?.getCurrentLanguage?.() || "en";
        },

        getCurrentScrollPosition() {
            if (window.matchMedia?.("(max-width: 1024px)")?.matches) return window.scrollY || 0;
            return document.getElementById("pageContainerHolder")?.scrollTop || 0;
        },

        restoreScrollPosition(value) {
            const top = Math.max(0, Number(value || 0));
            if (window.matchMedia?.("(max-width: 1024px)")?.matches) {
                window.scrollTo({ top, behavior: "auto" });
                return;
            }
            document.getElementById("pageContainerHolder")?.scrollTo({ top, behavior: "auto" });
        },

        scrollToTop() {
            window.scrollTo({ top: 0, behavior: "auto" });
            document.getElementById("pageContainerHolder")?.scrollTo({ top: 0, behavior: "auto" });
        },

        truncate(value, maximum) {
            const text = String(value ?? "");
            return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },

        escapeAttr(value) {
            return this.escapeHtml(value);
        }
    };

    window[PAGE_CODE] = M06002;
})();
