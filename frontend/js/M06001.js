(function() {
    const PAGE_CODE = "M06001";
    const PROJECT_PAGE_SIZE = 20;
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

    const REPORT_ICONS = [
        "fa-chart-pie",
        "fa-diagram-project",
        "fa-list-check",
        "fa-database",
        "fa-table-columns",
        "fa-link",
        "fa-circle-nodes",
        "fa-code-branch",
        "fa-ranking-star",
        "fa-square-root-variable",
        "fa-triangle-exclamation",
        "fa-gavel",
        "fa-clipboard-check",
        "fa-table-list",
        "fa-wand-magic-sparkles",
        "fa-clock-rotate-left",
        "fa-chart-line",
        "fa-database",
        "fa-shield-halved",
        "fa-scale-balanced"
    ];

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

    const M06001 = {
        ...COMMON,
        initialized: false,

        localizedError(error, key, fallback) {
            if (this.getLanguageCode() === "en" && error?.message) return error.message;
            return this.t(key, fallback);
        },
        projectPage: 0,
        projectTotal: 0,
        projects: [],
        hasMoreProjects: true,
        projectLoading: false,
        projectRequestId: 0,
        projectAbortController: null,
        contextAbortController: null,
        catalogAbortController: null,
        searchTimer: null,
        projectObserver: null,
        selectedProject: null,
        scenarios: [],
        flowRuns: [],
        editSessions: [],
        selectedScenarioId: "",
        selectedFlowRunId: "",
        selectedEditSessionId: "",
        catalog: [],
        projectScrollPosition: 0,
        lastProjectTrigger: null,
        activeView: "projects",
        batchOpenLocked: false,
        batchOpenTimer: null,
        boundHandlers: {},

        async init() {
            if (this.initialized) return;
            this.initialized = true;
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
            this.projectAbortController = null;
            this.contextAbortController = null;
            this.catalogAbortController = null;
            if (this.searchTimer) window.clearTimeout(this.searchTimer);
            this.searchTimer = null;
            if (this.batchOpenTimer) window.clearTimeout(this.batchOpenTimer);
            this.batchOpenTimer = null;
            this.batchOpenLocked = false;
            this.unbindEvents();
            this.projects = [];
            this.catalog = [];
            this.scenarios = [];
            this.flowRuns = [];
            this.editSessions = [];
            this.selectedProject = null;
            this.lastProjectTrigger = null;
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
                const input = getContainerEl("#projectSearch-M06001");
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
            handlers.back = () => this.showProjectView();
            handlers.scenarioChange = (event) => this.changeScenario(event.target.value);
            handlers.flowRunChange = (event) => {
                this.selectedFlowRunId = String(event.target.value || "");
                this.loadCatalog();
            };
            handlers.editSessionChange = (event) => {
                this.selectedEditSessionId = String(event.target.value || "");
                this.loadCatalog();
            };
            handlers.reportGridClick = (event) => {
                const card = event.target.closest?.("[data-report-code]");
                if (card) this.openReport(card.dataset.reportCode);
            };
            handlers.openBatchReport = () => this.openBatchReport();
            handlers.retryCatalog = () => this.loadCatalog();

            getContainerEl("#projectSearchForm-M06001")?.addEventListener("submit", handlers.searchSubmit);
            getContainerEl("#projectSearch-M06001")?.addEventListener("input", handlers.searchInput);
            getContainerEl("#projectSearchReset-M06001")?.addEventListener("click", handlers.searchReset);
            getContainerEl("#projectGrid-M06001")?.addEventListener("click", handlers.projectGridClick);
            getContainerEl("#projectLoadMore-M06001")?.addEventListener("click", handlers.loadMore);
            getContainerEl("#backToProjects-M06001")?.addEventListener("click", handlers.back);
            getContainerEl("#scenarioId-M06001")?.addEventListener("change", handlers.scenarioChange);
            getContainerEl("#flowRunId-M06001")?.addEventListener("change", handlers.flowRunChange);
            getContainerEl("#editSessionId-M06001")?.addEventListener("change", handlers.editSessionChange);
            getContainerEl("#reportGrid-M06001")?.addEventListener("click", handlers.reportGridClick);
            getContainerEl("#openBatchReport-M06001")?.addEventListener("click", handlers.openBatchReport);
            getContainerEl("#retryCatalog-M06001")?.addEventListener("click", handlers.retryCatalog);
        },

        unbindEvents() {
            const handlers = this.boundHandlers;
            getContainerEl("#projectSearchForm-M06001")?.removeEventListener("submit", handlers.searchSubmit);
            getContainerEl("#projectSearch-M06001")?.removeEventListener("input", handlers.searchInput);
            getContainerEl("#projectSearchReset-M06001")?.removeEventListener("click", handlers.searchReset);
            getContainerEl("#projectGrid-M06001")?.removeEventListener("click", handlers.projectGridClick);
            getContainerEl("#projectLoadMore-M06001")?.removeEventListener("click", handlers.loadMore);
            getContainerEl("#backToProjects-M06001")?.removeEventListener("click", handlers.back);
            getContainerEl("#scenarioId-M06001")?.removeEventListener("change", handlers.scenarioChange);
            getContainerEl("#flowRunId-M06001")?.removeEventListener("change", handlers.flowRunChange);
            getContainerEl("#editSessionId-M06001")?.removeEventListener("change", handlers.editSessionChange);
            getContainerEl("#reportGrid-M06001")?.removeEventListener("click", handlers.reportGridClick);
            getContainerEl("#openBatchReport-M06001")?.removeEventListener("click", handlers.openBatchReport);
            getContainerEl("#retryCatalog-M06001")?.removeEventListener("click", handlers.retryCatalog);
            this.boundHandlers = {};
        },

        connectProjectObserver() {
            this.disconnectProjectObserver();
            const sentinel = getContainerEl("#projectLoadSentinel-M06001");
            if (!sentinel || typeof IntersectionObserver === "undefined") return;
            this.projectObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting && this.activeView === "projects" && this.hasMoreProjects) {
                    this.loadProjects({ reset: false });
                }
            }, {
                root: null,
                rootMargin: "480px 0px",
                threshold: 0
            });
            this.projectObserver.observe(sentinel);
        },

        disconnectProjectObserver() {
            this.projectObserver?.disconnect();
            this.projectObserver = null;
        },

        getProjectKeyword() {
            return String(getContainerEl("#projectSearch-M06001")?.value || "").trim();
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
                const rows = Array.isArray(payload)
                    ? payload
                    : asArray(payload?.items || payload?.rows || payload?.projects);
                const totalCandidate = json?.total
                    ?? payload?.total
                    ?? payload?.TOTAL_COUNT
                    ?? rows[0]?.TOTAL_COUNT
                    ?? rows[0]?.totalCount;
                const total = Number(totalCandidate);

                if (reset) {
                    this.projects = [];
                    const grid = getContainerEl("#projectGrid-M06001");
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
                this.hasMoreProjects = Number.isFinite(total)
                    ? this.projects.length < total
                    : rows.length === PROJECT_PAGE_SIZE;
                this.appendProjectCards(newRows);
                this.renderProjectListState();
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06001] project load failed", error);
                this.renderProjectLoadError(reset, error);
            } finally {
                if (requestId === this.projectRequestId) this.setProjectLoading(false);
            }
        },

        renderProjectSkeletons() {
            const grid = getContainerEl("#projectGrid-M06001");
            const empty = getContainerEl("#projectEmpty-M06001");
            if (empty) empty.hidden = true;
            if (!grid) return;
            grid.setAttribute("aria-busy", "true");
            grid.innerHTML = Array.from({ length: 10 }, () => `
                <div class="m06001-card-skeleton" aria-hidden="true">
                    <span></span><span></span><span></span><span></span>
                </div>
            `).join("");
        },

        appendProjectCards(rows) {
            const grid = getContainerEl("#projectGrid-M06001");
            if (!grid || !rows.length) return;
            grid.insertAdjacentHTML("beforeend", rows.map((project) => this.projectCardHtml(project)).join(""));
        },

        projectCardHtml(project) {
            const id = firstValue(project, ["PROJECT_ID", "projectId"]);
            const name = firstValue(project, ["PROJECT_NAME", "projectName"], this.t("untitledProject", "Untitled project"));
            const code = firstValue(project, ["PROJECT_CODE", "projectCode"], "-");
            const type = firstValue(project, ["PROJECT_TYPE", "projectType"], "-");
            const description = firstValue(project, ["PROJECT_DESC", "projectDesc"], this.t("noProjectDescription", "No project description."));
            const ownerScope = String(firstValue(project, ["OWNER_SCOPE", "ownerScope"], "MY")).toUpperCase();
            const scenarioCount = this.formatNumber(firstValue(project, ["SCENARIO_COUNT", "scenarioCount"], 0));
            const tableCount = this.formatNumber(firstValue(project, ["TARGET_TABLE_COUNT", "targetTableCount"], 0));
            const ruleCount = this.formatNumber(firstValue(project, ["FINAL_RULE_COUNT", "finalRuleCount"], 0));
            const changeCount = this.formatNumber(firstValue(project, ["APPLIED_CHANGE_COUNT", "appliedChangeCount"], 0));
            const lastFlowAt = firstValue(project, ["LAST_FLOW_AT", "lastFlowAt"]);
            const lastEditAt = firstValue(project, ["LAST_EDIT_AT", "lastEditAt"]);
            const lastActivity = this.latestDate(lastFlowAt, lastEditAt);
            const sharedBadge = ownerScope === "OTHER"
                ? `<span class="m06001-shared-badge">${this.escapeHtml(this.t("sharedProject", "Shared"))}</span>`
                : "";
            const ariaLabel = this.tl("openProjectReports", "Open Basic Reports for {name}", { name });

            return `
                <article class="m06001-project-card" role="listitem">
                    <button type="button" data-project-id="${this.escapeAttr(id)}" aria-label="${this.escapeAttr(ariaLabel)}">
                        <span class="m06001-card-topline">
                            <span class="m06001-project-type">${this.escapeHtml(type)}</span>
                            ${sharedBadge}
                        </span>
                        <span class="m06001-project-name">${this.escapeHtml(name)}</span>
                        <span class="m06001-project-code">${this.escapeHtml(code)}</span>
                        <span class="m06001-project-description">${this.escapeHtml(description)}</span>
                        <span class="m06001-project-metrics">
                            ${this.metricHtml("fa-route", this.t("scenarios", "Scenarios"), scenarioCount)}
                            ${this.metricHtml("fa-table", this.t("targetTables", "Target tables"), tableCount)}
                            ${this.metricHtml("fa-clipboard-check", this.t("finalRules", "Final rules"), ruleCount)}
                            ${this.metricHtml("fa-pen-to-square", this.t("appliedChanges", "Applied edits"), changeCount)}
                        </span>
                        <span class="m06001-project-footer">
                            <span><i class="far fa-clock" aria-hidden="true"></i>${this.escapeHtml(this.t("lastActivity", "Last activity"))}</span>
                            <strong>${this.escapeHtml(lastActivity ? this.formatDate(lastActivity) : this.t("noActivity", "No activity"))}</strong>
                        </span>
                    </button>
                </article>
            `;
        },

        metricHtml(icon, label, value) {
            return `
                <span class="m06001-project-metric">
                    <span><i class="fas ${icon}" aria-hidden="true"></i>${this.escapeHtml(label)}</span>
                    <strong>${this.escapeHtml(value)}</strong>
                </span>
            `;
        },

        renderProjectListState() {
            const grid = getContainerEl("#projectGrid-M06001");
            const empty = getContainerEl("#projectEmpty-M06001");
            const summary = getContainerEl("#projectResultSummary-M06001");
            if (grid) grid.setAttribute("aria-busy", "false");
            if (empty) empty.hidden = this.projects.length > 0;
            if (summary) {
                summary.textContent = this.tl("projectResultSummary", "Showing {shown} of {total} projects", {
                    shown: this.projects.length.toLocaleString(),
                    total: this.projectTotal.toLocaleString()
                });
            }
            this.updateLoadMoreState();
        },

        renderProjectLoadError(reset, error) {
            const grid = getContainerEl("#projectGrid-M06001");
            if (grid) {
                grid.setAttribute("aria-busy", "false");
                if (reset) {
                    grid.innerHTML = `
                        <div class="m06001-grid-error">
                            <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
                            <strong>${this.escapeHtml(this.t("projectLoadFailed", "Project list could not be loaded."))}</strong>
                            <span>${this.escapeHtml(this.localizedError(error, "tryAgainLater", "Please try again later."))}</span>
                            <button type="button" class="m06001-btn m06001-btn-secondary" data-action="retry-projects">
                                <i class="fas fa-rotate" aria-hidden="true"></i>
                                <span>${this.escapeHtml(this.t("retry", "Retry"))}</span>
                            </button>
                        </div>
                    `;
                }
            }
            this.hasMoreProjects = !reset;
            this.updateLoadMoreState();
        },

        setProjectLoading(loading) {
            this.projectLoading = Boolean(loading);
            const spinner = getContainerEl("#projectLoadSpinner-M06001");
            const grid = getContainerEl("#projectGrid-M06001");
            if (spinner) spinner.hidden = !loading || this.projectPage === 0;
            if (grid && loading) grid.setAttribute("aria-busy", "true");
            this.updateLoadMoreState();
        },

        updateLoadMoreState() {
            const button = getContainerEl("#projectLoadMore-M06001");
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
            this.showReportView();
            await this.loadContext(projectId, "");
        },

        showReportView() {
            this.activeView = "reports";
            this.disconnectProjectObserver();
            const projectView = getContainerEl("#projectView-M06001");
            const reportView = getContainerEl("#reportView-M06001");
            if (projectView) projectView.hidden = true;
            if (reportView) reportView.hidden = false;
            this.scrollToTop();
            window.requestAnimationFrame(() => getContainerEl("#backToProjects-M06001")?.focus());
        },

        showProjectView() {
            this.activeView = "projects";
            this.contextAbortController?.abort();
            this.catalogAbortController?.abort();
            const projectView = getContainerEl("#projectView-M06001");
            const reportView = getContainerEl("#reportView-M06001");
            if (reportView) reportView.hidden = true;
            if (projectView) projectView.hidden = false;
            this.connectProjectObserver();
            window.requestAnimationFrame(() => {
                this.restoreScrollPosition(this.projectScrollPosition);
                let trigger = this.lastProjectTrigger;
                if (!trigger?.isConnected) {
                    const selectedId = String(firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]));
                    trigger = Array.from(getContainerEl("#projectGrid-M06001")?.querySelectorAll("[data-project-id]") || [])
                        .find((element) => String(element.dataset.projectId) === selectedId);
                }
                trigger?.focus?.({ preventScroll: true });
            });
        },

        async loadContext(projectId, scenarioId = "") {
            this.contextAbortController?.abort();
            this.contextAbortController = new AbortController();
            const contextGrid = getContainerEl("#contextGrid-M06001");
            if (contextGrid) contextGrid.setAttribute("aria-busy", "true");
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
                console.error("[M06001] report context load failed", error);
                this.renderContextError(error);
            } finally {
                if (contextGrid) contextGrid.setAttribute("aria-busy", "false");
            }
        },

        applyContextData(data, requestedScenarioId = "") {
            const contextProject = data.project && typeof data.project === "object" ? data.project : {};
            this.selectedProject = { ...(this.selectedProject || {}), ...contextProject };
            this.scenarios = asArray(data.scenarios);
            this.flowRuns = asArray(data.flowRuns);
            this.editSessions = asArray(data.editSessions);
            const selection = data.selection && typeof data.selection === "object" ? data.selection : {};

            const scenarioCandidate = firstValue(selection, ["scenarioId", "SCENARIO_ID", "selectedScenarioId", "SELECTED_SCENARIO_ID"], requestedScenarioId);
            const flowCandidate = firstValue(selection, ["flowRunId", "FLOW_RUN_ID", "selectedFlowRunId", "SELECTED_FLOW_RUN_ID"]);
            const editCandidate = firstValue(selection, ["editSessionId", "EDIT_SESSION_ID", "selectedEditSessionId", "SELECTED_EDIT_SESSION_ID"]);
            this.selectedScenarioId = this.resolveSelection(this.scenarios, ["SCENARIO_ID", "scenarioId"], scenarioCandidate);
            this.selectedFlowRunId = this.resolveSelection(this.flowRuns, ["FLOW_RUN_ID", "flowRunId"], flowCandidate);
            this.selectedEditSessionId = this.resolveSelection(this.editSessions, ["EDIT_SESSION_ID", "editSessionId"], editCandidate);
        },

        resolveSelection(rows, idKeys, preferredValue) {
            const preferred = String(preferredValue || "");
            if (preferred && rows.some((row) => String(firstValue(row, idKeys)) === preferred)) return preferred;
            return rows.length ? String(firstValue(rows[0], idKeys)) : "";
        },

        renderContextLoading() {
            const title = getContainerEl("#project-context-title-M06001");
            const description = getContainerEl("#projectContextDescription-M06001");
            const meta = getContainerEl("#projectContextMeta-M06001");
            const hint = getContainerEl("#selectionHint-M06001");
            if (title) title.textContent = this.t("loadingProject", "Loading project...");
            if (description) description.textContent = this.t("loadingReportContext", "Preparing the report context.");
            if (meta) meta.innerHTML = "";
            if (hint) hint.textContent = this.t("loadingSelections", "Loading scenarios, runs, and editing sessions...");
            ["#scenarioId-M06001", "#flowRunId-M06001", "#editSessionId-M06001"].forEach((selector) => {
                const select = getContainerEl(selector);
                if (select) {
                    select.disabled = true;
                    select.innerHTML = `<option>${this.escapeHtml(this.t("loading", "Loading..."))}</option>`;
                }
            });
            this.renderCatalogSkeletons();
        },

        renderContext() {
            const project = this.selectedProject || {};
            const title = getContainerEl("#project-context-title-M06001");
            const description = getContainerEl("#projectContextDescription-M06001");
            const meta = getContainerEl("#projectContextMeta-M06001");
            const name = firstValue(project, ["PROJECT_NAME", "projectName"], this.t("untitledProject", "Untitled project"));
            if (title) title.textContent = String(name);
            if (description) description.textContent = String(firstValue(project, ["PROJECT_DESC", "projectDesc"], this.t("noProjectDescription", "No project description.")));
            if (meta) {
                meta.innerHTML = [
                    [this.t("projectCode", "Project code"), firstValue(project, ["PROJECT_CODE", "projectCode"], "-")],
                    [this.t("projectType", "Project type"), firstValue(project, ["PROJECT_TYPE", "projectType"], "-")],
                    [this.t("scenarios", "Scenarios"), this.formatNumber(firstValue(project, ["SCENARIO_COUNT", "scenarioCount"], this.scenarios.length))],
                    [this.t("targetTables", "Target tables"), this.formatNumber(firstValue(project, ["TARGET_TABLE_COUNT", "targetTableCount"], 0))]
                ].map(([label, value]) => `
                    <div><dt>${this.escapeHtml(label)}</dt><dd>${this.escapeHtml(value)}</dd></div>
                `).join("");
            }

            this.renderSelect(
                "#scenarioId-M06001",
                this.scenarios,
                ["SCENARIO_ID", "scenarioId"],
                (row) => this.contextOptionLabel(row, ["SCENARIO_NAME", "scenarioName"], ["SCENARIO_CODE", "scenarioCode"]),
                this.selectedScenarioId,
                this.t("noScenarios", "No scenarios")
            );
            this.renderSelect(
                "#flowRunId-M06001",
                this.flowRuns,
                ["FLOW_RUN_ID", "flowRunId"],
                (row) => this.runOptionLabel(row),
                this.selectedFlowRunId,
                this.t("noFlowRuns", "No rule discovery runs")
            );
            this.renderSelect(
                "#editSessionId-M06001",
                this.editSessions,
                ["EDIT_SESSION_ID", "editSessionId"],
                (row) => this.editSessionOptionLabel(row),
                this.selectedEditSessionId,
                this.t("noEditSessions", "No edit history"),
                this.t("editHistoryOptional", "Not selected (general reports)")
            );
            this.renderSelectionHint();
        },

        renderSelect(selector, rows, idKeys, labelFactory, selectedValue, emptyLabel, optionalLabel = "") {
            const select = getContainerEl(selector);
            if (!select) return;
            if (!rows.length) {
                select.innerHTML = `<option value="">${this.escapeHtml(emptyLabel)}</option>`;
                select.disabled = true;
                return;
            }
            select.disabled = false;
            const optionalOption = optionalLabel
                ? `<option value=""${selectedValue ? "" : " selected"}>${this.escapeHtml(optionalLabel)}</option>`
                : "";
            select.innerHTML = optionalOption + rows.map((row) => {
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
            const name = firstValue(row, ["FLOW_NAME", "flowName"], this.t("ruleDiscoveryRun", "Rule discovery run"));
            const status = firstValue(row, ["STATUS", "status"], "-");
            const at = firstValue(row, ["FINISHED_AT", "finishedAt", "CREATED_AT", "createdAt"]);
            return `#${id} · ${name} · ${status}${at ? ` · ${this.formatDate(at)}` : ""}`;
        },

        editSessionOptionLabel(row) {
            const id = firstValue(row, ["EDIT_SESSION_ID", "editSessionId"], "-");
            const name = firstValue(row, ["SESSION_NAME", "sessionName"], this.t("editingSession", "Edit operation"));
            const status = firstValue(row, ["SESSION_STATUS", "sessionStatus"], "-");
            const at = firstValue(row, ["UPDATED_AT", "updatedAt", "CREATED_AT", "createdAt"]);
            return `#${id} · ${name} · ${status}${at ? ` · ${this.formatDate(at)}` : ""}`;
        },

        renderSelectionHint() {
            const hint = getContainerEl("#selectionHint-M06001");
            if (!hint) return;
            if (!this.selectedScenarioId) {
                hint.textContent = this.t("scenarioRequiredHint", "No scenario is available. Reports will show project-level availability.");
                return;
            }
            const runText = this.selectedFlowRunId ? `#${this.selectedFlowRunId}` : this.t("notSelected", "not selected");
            const sessionText = this.selectedEditSessionId ? `#${this.selectedEditSessionId}` : this.t("notSelected", "not selected");
            hint.textContent = this.tl("selectionBasisHint", "Report basis: rule discovery run {run} · edit history {session} (not required for discovery or descriptive-statistics reports)", {
                run: runText,
                session: sessionText
            });
        },

        async changeScenario(scenarioId) {
            const projectId = firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]);
            if (!projectId) return;
            this.selectedScenarioId = String(scenarioId || "");
            await this.loadContext(projectId, this.selectedScenarioId);
        },

        getReportParams({ includeLanguage = true } = {}) {
            const params = new URLSearchParams();
            const values = {
                projectId: firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]),
                scenarioId: this.selectedScenarioId,
                flowRunId: this.selectedFlowRunId,
                editSessionId: this.selectedEditSessionId
            };
            Object.entries(values).forEach(([key, value]) => {
                if (value !== undefined && value !== null && String(value).trim() !== "") params.set(key, String(value));
            });
            if (includeLanguage) params.set("lang", this.getLanguageCode());
            return params;
        },

        async loadCatalog() {
            const projectId = firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]);
            if (!projectId) return;
            this.catalogAbortController?.abort();
            this.catalogAbortController = new AbortController();
            const requestController = this.catalogAbortController;
            this.renderSelectionHint();
            this.renderCatalogSkeletons();
            const params = this.getReportParams();

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/catalog?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    signal: requestController.signal
                });
                if (requestController !== this.catalogAbortController) return;
                const data = json?.data;
                this.catalog = Array.isArray(data) ? data : asArray(data?.items || data?.reports || data?.rows);
                this.renderCatalog();
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[M06001] report catalog load failed", error);
                this.catalog = [];
                this.renderCatalogError(error);
            }
        },

        renderCatalogSkeletons() {
            const grid = getContainerEl("#reportGrid-M06001");
            const empty = getContainerEl("#reportEmpty-M06001");
            this.setBatchReportState("loading");
            if (empty) empty.hidden = true;
            if (!grid) return;
            grid.setAttribute("aria-busy", "true");
            grid.innerHTML = Array.from({ length: 10 }, () => `
                <div class="m06001-card-skeleton m06001-report-skeleton" aria-hidden="true">
                    <span></span><span></span><span></span><span></span>
                </div>
            `).join("");
        },

        renderCatalog() {
            const grid = getContainerEl("#reportGrid-M06001");
            const empty = getContainerEl("#reportEmpty-M06001");
            if (!grid) return;
            grid.setAttribute("aria-busy", "false");
            if (!this.catalog.length) {
                grid.innerHTML = "";
                if (empty) empty.hidden = false;
                this.setBatchReportState("empty");
                return;
            }
            if (empty) empty.hidden = true;
            grid.innerHTML = this.catalog.map((report, index) => this.reportCardHtml(report, index)).join("");
            this.setBatchReportState("ready");
        },

        setBatchReportState(status) {
            const button = getContainerEl("#openBatchReport-M06001");
            const statusEl = getContainerEl("#batchReportStatus-M06001");
            const isReady = status === "ready" && this.catalog.length > 0;
            if (button) {
                button.disabled = !isReady || this.batchOpenLocked;
                button.setAttribute("aria-busy", status === "loading" || this.batchOpenLocked ? "true" : "false");
            }
            if (!statusEl) return;
            if (status === "loading") {
                statusEl.textContent = this.t("batchReportLoading", "Preparing the integrated report catalog...");
                return;
            }
            if (!isReady) {
                statusEl.textContent = this.t("batchReportUnavailable", "The integrated report becomes available after the catalog is loaded.");
                return;
            }
            const available = this.catalog.filter((report) => (
                String(firstValue(report, ["AVAILABILITY", "AVAILABILITY_STATUS", "availability", "status"], "NO_DATA")).toUpperCase() === "AVAILABLE"
            )).length;
            statusEl.textContent = this.tl(
                "batchReportReady",
                "{total} reports are ready, including {available} available reports. Reports with no data are also included.",
                { total: this.catalog.length, available }
            );
        },

        reportCardHtml(report, index) {
            const code = firstValue(report, ["REPORT_CODE", "reportCode", "code"], `R${String(index + 1).padStart(2, "0")}`);
            const title = firstValue(report, ["REPORT_TITLE", "REPORT_NAME", "reportTitle", "title", "name"], code);
            const description = firstValue(report, ["REPORT_DESCRIPTION", "reportDescription", "description"], this.t("reportDescriptionFallback", "Review this report using the selected project and scenario basis."));
            const source = firstValue(report, ["SOURCE_MENU", "SOURCE_MENUS", "sourceMenu", "sourceMenus", "category", "CATEGORY", "group", "GROUP"], this.t("integratedReport", "Integrated"));
            const availability = String(firstValue(report, ["AVAILABILITY", "AVAILABILITY_STATUS", "availability", "status"], "NO_DATA")).toUpperCase();
            const count = firstValue(report, ["DATA_COUNT", "RECORD_COUNT", "dataCount", "recordCount"], "");
            const icon = REPORT_ICONS[index % REPORT_ICONS.length];
            const status = this.availabilityInfo(availability);
            const countText = count === "" ? "" : this.tl("reportRowCount", "{count} records", { count: this.formatNumber(count) });
            const ariaLabel = this.tl("openReportDetail", "Open {title} report detail", { title });

            return `
                <article class="m06001-report-card" role="listitem">
                    <button type="button" data-report-code="${this.escapeAttr(code)}" aria-label="${this.escapeAttr(ariaLabel)}">
                        <span class="m06001-report-card-head">
                            <span class="m06001-report-icon"><i class="fas ${icon}" aria-hidden="true"></i></span>
                            <span class="m06001-report-number">${String(index + 1).padStart(2, "0")}</span>
                        </span>
                        <span class="m06001-report-source">${this.escapeHtml(Array.isArray(source) ? source.join(" · ") : source)}</span>
                        <span class="m06001-report-title">${this.escapeHtml(title)}</span>
                        <span class="m06001-report-description">${this.escapeHtml(description)}</span>
                        <span class="m06001-report-card-footer">
                            <span class="m06001-availability is-${this.escapeAttr(status.className)}">
                                <i class="fas ${status.icon}" aria-hidden="true"></i>${this.escapeHtml(status.label)}
                            </span>
                            <span class="m06001-report-count">${this.escapeHtml(countText)}</span>
                            <i class="fas fa-arrow-up-right-from-square m06001-open-icon" aria-hidden="true"></i>
                        </span>
                    </button>
                </article>
            `;
        },

        availabilityInfo(value) {
            const status = String(value || "NO_DATA").toUpperCase();
            const map = {
                AVAILABLE: { className: "available", icon: "fa-circle-check", label: this.t("availabilityAvailable", "Available") },
                PARTIAL: { className: "partial", icon: "fa-circle-half-stroke", label: this.t("availabilityPartial", "Partial") },
                NO_DATA: { className: "no-data", icon: "fa-circle-minus", label: this.t("availabilityNoData", "No data") },
                NOT_APPLICABLE: { className: "not-applicable", icon: "fa-ban", label: this.t("availabilityNotApplicable", "Not applicable") },
                ERROR: { className: "error", icon: "fa-circle-exclamation", label: this.t("availabilityError", "Unavailable") }
            };
            return map[status] || map.NO_DATA;
        },

        renderCatalogError(error) {
            const grid = getContainerEl("#reportGrid-M06001");
            const empty = getContainerEl("#reportEmpty-M06001");
            if (grid) {
                grid.setAttribute("aria-busy", "false");
                grid.innerHTML = "";
            }
            if (empty) {
                empty.hidden = false;
                const detail = empty.querySelector("span");
                if (detail) detail.textContent = this.localizedError(error, "tryAgainLater", "Please try again later.");
            }
            this.setBatchReportState("error");
        },

        renderContextError(error) {
            const title = getContainerEl("#project-context-title-M06001");
            const description = getContainerEl("#projectContextDescription-M06001");
            const hint = getContainerEl("#selectionHint-M06001");
            if (title) title.textContent = this.t("contextLoadFailed", "Report context unavailable");
            if (description) description.textContent = this.localizedError(error, "tryAgainLater", "Please try again later.");
            if (hint) hint.textContent = this.t("contextSelectionUnavailable", "Scenario and run selection could not be loaded.");
            this.catalog = [];
            this.renderCatalogError(error);
        },

        openReport(reportCode) {
            const report = this.catalog.find((item) => String(firstValue(item, ["REPORT_CODE", "reportCode", "code"])) === String(reportCode));
            if (!report || !reportCode) return;
            const reportTitle = firstValue(report, ["REPORT_TITLE", "REPORT_NAME", "reportTitle", "title", "name"], reportCode);
            const viewerPath = PageManager.getAssetUrl?.("./report-viewer.html") || "./report-viewer.html";
            const url = new URL(viewerPath, window.location.href);
            const params = this.getReportParams();
            params.set("reportCode", String(reportCode));
            params.set("reportTitle", String(reportTitle));
            params.forEach((value, key) => url.searchParams.set(key, value));

            this.openViewerWindow(url, String(reportCode));
        },

        openBatchReport() {
            const projectId = firstValue(this.selectedProject, ["PROJECT_ID", "projectId"]);
            const button = getContainerEl("#openBatchReport-M06001");
            if (!projectId || !this.catalog.length || button?.disabled || this.batchOpenLocked) return;
            this.batchOpenLocked = true;
            this.setBatchReportState("ready");
            const viewerPath = PageManager.getAssetUrl?.("./report-viewer.html") || "./report-viewer.html";
            const url = new URL(viewerPath, window.location.href);
            const params = this.getReportParams();
            params.set("mode", "batch");
            params.set("reportTitle", this.t("batchViewerTitle", "All Basic Reports"));
            params.forEach((value, key) => url.searchParams.set(key, value));
            const windowCode = [
                "BATCH",
                params.get("projectId"),
                params.get("scenarioId"),
                params.get("flowRunId"),
                params.get("editSessionId")
            ].filter(Boolean).join("_");
            this.openViewerWindow(url, windowCode, { reuse: true });
            if (this.batchOpenTimer) window.clearTimeout(this.batchOpenTimer);
            this.batchOpenTimer = window.setTimeout(() => {
                this.batchOpenTimer = null;
                this.batchOpenLocked = false;
                this.setBatchReportState(this.catalog.length ? "ready" : "empty");
            }, 1500);
        },

        openViewerWindow(url, windowCode, { reuse = false } = {}) {

            const availableWidth = window.screen?.availWidth || window.innerWidth || 1200;
            const availableHeight = window.screen?.availHeight || window.innerHeight || 800;
            const width = Math.max(360, Math.min(1440, availableWidth - 40));
            const height = Math.max(640, Math.min(1000, availableHeight - 40));
            const left = Math.max(0, Math.round((availableWidth - width) / 2));
            const top = Math.max(0, Math.round((availableHeight - height) / 2));
            const features = [
                `width=${Math.round(width)}`,
                `height=${Math.round(height)}`,
                `left=${left}`,
                `top=${top}`,
                "resizable=yes",
                "scrollbars=yes"
            ].join(",");
            const safeWindowCode = String(windowCode || "REPORT").replace(/[^A-Za-z0-9_-]/g, "_");
            const windowName = reuse
                ? `indepsStructuredReport_${safeWindowCode}`
                : `indepsStructuredReport_${safeWindowCode}_${Date.now()}`;
            const popup = window.open(url.toString(), windowName, features);
            if (!popup) {
                const message = this.t("popupBlocked", "The report window was blocked. Allow pop-ups for this site and try again.");
                if (typeof window.CommonMessage?.warn === "function") {
                    window.CommonMessage.warn(message);
                } else {
                    window.alert(message);
                }
                return;
            }
            popup.focus?.();
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
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
            }).format(date);
        },

        formatNumber(value) {
            const number = Number(value);
            return Number.isFinite(number) ? number.toLocaleString() : "0";
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

    window[PAGE_CODE] = M06001;
})();
