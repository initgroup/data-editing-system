(function() {
    if (!window.MCOMMON) {
        window.MCOMMON = {};
    }

    window.MCOMMON.createFlowWorkPage = function(config) {
        const PAGE_CODE = config.pageCode;
        const FLOW_UI_LABELS = {
            ...(config.labels || {}),
            ...(window[`${PAGE_CODE}_FLOW_UI_LABELS`] || {})
        };
        const SAMPLE_FLOW_EDGES = [
            { from: "source-customer", to: "profiling-01" },
            { from: "profiling-01", to: "correlation-01" },
            { from: "profiling-01", to: "rule-mining-01" },
            { from: "correlation-01", to: "violation-search-01" },
            { from: "rule-mining-01", to: "violation-search-01" },
            { from: "threshold-01", to: "rule-mining-01", dashed: true, mode: "ON_COMPLETE" }
        ];
        const CONTEXT_STORAGE_KEY = config.contextStorageKey || "DATA_EDITING_WORK_CONTEXT";
        const SCENARIO_TABLE_API = config.scenarioTableApi || "M02002";
        const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
        const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

        const page = {
            ...COMMON,
            isInit: false,
            contextProjects: [],
            contextScenarios: [],
            scenarioTables: [],
            flowList: [],
            flowSwitcherSearch: "",
            flowNodeTypes: [],
            flowRegisteredJobs: [],
            flowJobGroupCollapsed: new Set(),
            flowVariables: [],
            flowRunHistoryRows: [],
            flowNodeRunResultRows: [],
            flowResultSqlGridData: { rows: [], columns: [] },
            activeRunPlanFlowRunId: "",
            activeRunPlanLoadedId: "",
            selectedProjectId: "",
            selectedScenarioId: "",
            selectedScenarioTableKey: "",
            workContextCollapsed: false,
            activeTab: "designer",
            contextLoadFailed: false,
            flowType: config.flowType || PAGE_CODE,
            flowZoom: 1,
            minFlowZoom: 0.45,
            maxFlowZoom: 1.8,
            selectedNodeId: "",
            selectedEdgeId: "",
            nodeDragState: null,
            canvasPanState: null,
            edgeDragState: null,
            dashedConnectionMode: false,
            flowPaletteDragData: null,
            nodeSequence: 100,
            flowContextMenuState: null,
            flowSidebarCollapsed: false,
            flowSidebarCollapsedBeforeMaximize: null,
            appSidebarCollapsedBeforeMaximize: null,
            flowInspectorCollapsed: false,
            flowInspectorCollapsedBeforeMaximize: null,
            flowDesignerBound: false,
            flowLayoutRestoredFromDb: false,
            isSampleFlowVisible: false,
            isFlowSaving: false,
            isFlowRunning: false,
            activeFlowRuns: new Map(),
            activeCanvasRunId: "",
            activeCanvasRunFlowKey: "",
            activeCanvasRunPollTimer: null,
            activeCanvasRunPollFailures: 0,
            flowNodePointerMoveBound: null,
            flowNodePointerUpBound: null,
            flowCanvasPointerMoveBound: null,
            flowCanvasPointerUpBound: null,
            flowCanvasWheelBound: null,
            flowCanvasPointerDownBound: null,
            flowCanvasDragOverBound: null,
            flowCanvasDropBound: null,
            flowCanvasContextMenuBound: null,
            flowMenuClickBound: null,
            flowDocumentClickBound: null,
            flowDocumentKeydownBound: null,
            flowEdgeLayerClickBound: null,
            flowEdges: [],

            async init() {
                if (this.isInit) return;
                this.applyUiLabels();
                await this.loadWorkContext();
                this.switchTab("designer");
                this.setupFlowDesigner();
                this.setFlowInspectorCollapsed(true);
                this.isInit = true;
            },

            destroy() {
                this.closeNodeRunParamsLayer();
                this.restoreSidebarsAfterCanvasMaximize();
                this.teardownFlowDesigner();
                this.contextProjects = [];
                this.contextScenarios = [];
                this.scenarioTables = [];
                this.flowList = [];
                this.flowSwitcherSearch = "";
                this.flowNodeTypes = [];
                this.flowRegisteredJobs = [];
                this.flowJobGroupCollapsed = new Set();
                this.flowVariables = [];
                this.flowRunHistoryRows = [];
                this.flowNodeRunResultRows = [];
                this.flowResultSqlGridData = { rows: [], columns: [] };
                this.activeRunPlanFlowRunId = "";
                this.activeRunPlanLoadedId = "";
                this.selectedProjectId = "";
                this.selectedScenarioId = "";
                this.selectedScenarioTableKey = "";
                this.workContextCollapsed = false;
                this.activeTab = "designer";
                this.contextLoadFailed = false;
                this.flowZoom = 1;
                this.selectedNodeId = "";
                this.nodeDragState = null;
                this.canvasPanState = null;
                this.edgeDragState = null;
                this.dashedConnectionMode = false;
                this.flowPaletteDragData = null;
                this.flowSidebarCollapsed = false;
                this.flowSidebarCollapsedBeforeMaximize = null;
                this.appSidebarCollapsedBeforeMaximize = null;
                this.flowInspectorCollapsed = true;
                this.flowInspectorCollapsedBeforeMaximize = null;
                this.flowLayoutRestoredFromDb = false;
                this.isSampleFlowVisible = false;
                this.isFlowSaving = false;
                this.isFlowRunning = false;
                this.activeFlowRuns = new Map();
                this.stopCanvasRunStatusPolling();
                this.activeCanvasRunId = "";
                this.activeCanvasRunFlowKey = "";
                this.activeCanvasRunPollFailures = 0;
                this.flowEdges = [];
                this.nodeSequence = 100;
                this.isInit = false;
            },

            applyUiLabels() {
                Object.entries(FLOW_UI_LABELS).forEach(([key, value]) => {
                    const selector = `[data-label-key="${key}"]`;
                    const container = document.getElementById(`container-${PAGE_CODE}`);
                    if (!container) return;
                    container.querySelectorAll(selector).forEach((element) => {
                        if (key === "sampleFlowLabel") {
                            this.setMultilineText(element, value);
                            return;
                        }
                        element.textContent = value;
                    });
                    container.querySelectorAll(`[data-title-key="${key}"]`).forEach((element) => {
                        element.setAttribute("title", value);
                    });
                    container.querySelectorAll(`[data-placeholder-key="${key}"]`).forEach((element) => {
                        element.setAttribute("placeholder", value);
                    });
                });
            },

            setMultilineText(element, value = "") {
                if (!element) return;
                element.textContent = "";
                String(value || "").split(/\r?\n/).forEach((line, index) => {
                    if (index > 0) element.appendChild(document.createElement("br"));
                    element.appendChild(document.createTextNode(line));
                });
            },

            getStoredContext() {
                try {
                    return JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY) || "{}");
                } catch (error) {
                    return {};
                }
            },

            saveStoredContext() {
                localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({
                    projectId: this.selectedProjectId || "",
                    scenarioId: this.selectedScenarioId || ""
                }));
            },

            async loadWorkContext() {
                const stored = this.getStoredContext();
                await this.loadContextProjects(stored.projectId || "");
                if (this.contextLoadFailed) return;
                if (this.selectedProjectId) {
                    await this.loadContextScenarios(stored.scenarioId || "");
                } else {
                    this.renderContextScenarios("");
                }
                if (this.contextLoadFailed) return;
                await this.loadScenarioTables();
                await this.loadFlowAssets();
                await this.loadFlowVersions(true, { refreshHistory: true });
                this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId));
            },

            async refreshWorkContext() {
                const currentProjectId = this.selectedProjectId;
                const currentScenarioId = this.selectedScenarioId;
                await this.loadContextProjects(currentProjectId);
                if (this.contextLoadFailed) return;
                if (this.selectedProjectId) {
                    await this.loadContextScenarios(currentScenarioId);
                } else {
                    this.renderContextScenarios("");
                }
                if (this.contextLoadFailed) return;
                await this.loadScenarioTables();
                await this.loadFlowAssets();
                await this.loadFlowVersions(false, { refreshHistory: true });
                this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId));
            },

            async loadContextProjects(preferredProjectId = "") {
                const select = getContainerEl(`#contextProject-${PAGE_CODE}`);
                if (!select) return;
                select.innerHTML = `<option value="">Loading projects...</option>`;

                try {
                    this.contextLoadFailed = false;
                    const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?keyword=`, { method: "GET", showLoading: false });
                    this.contextProjects = Array.isArray(json.data)
                        ? json.data.filter((project) => project.USE_YN === "Y")
                        : [];
                    this.renderContextProjects(preferredProjectId);
                } catch (error) {
                    const message = error.message || "Project load failed.";
                    this.contextLoadFailed = true;
                    this.contextProjects = [];
                    this.selectedProjectId = "";
                    select.innerHTML = `<option value="">Project load failed</option>`;
                    this.renderError(`#scenarioTablesGrid-${PAGE_CODE}`, message);
                }
            },

            renderContextProjects(preferredProjectId = "") {
                const select = getContainerEl(`#contextProject-${PAGE_CODE}`);
                if (!select) return;

                select.innerHTML = `
                    <option value="">-- Select project --</option>
                    ${this.contextProjects.map((project) => `
                        <option value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                            ${this.escapeHtml(project.PROJECT_NAME || project.PROJECT_CODE || "(Untitled project)")}
                        </option>
                    `).join("")}
                `;

                const exists = this.contextProjects.some((project) => String(project.PROJECT_ID) === String(preferredProjectId));
                this.selectedProjectId = exists ? String(preferredProjectId) : "";
                select.value = this.selectedProjectId;
            },

            async handleContextProjectChange(projectId) {
                this.selectedProjectId = projectId || "";
                this.selectedScenarioId = "";
                this.selectedScenarioTableKey = "";
                this.saveStoredContext();
                await this.loadContextScenarios("");
                await this.loadScenarioTables();
                await this.loadFlowAssets();
                await this.loadFlowVersions(true, { refreshHistory: true });
                this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId));
            },

            async loadContextScenarios(preferredScenarioId = "") {
                const select = getContainerEl(`#contextScenario-${PAGE_CODE}`);
                if (!this.selectedProjectId) {
                    this.contextScenarios = [];
                    this.renderContextScenarios("");
                    return;
                }
                if (select) select.innerHTML = `<option value="">Loading scenarios...</option>`;

                try {
                    this.contextLoadFailed = false;
                    const params = new URLSearchParams({ projectId: this.selectedProjectId, keyword: "" });
                    const json = await CommonUtils.request(`${API_BASE_URL}/M01002/scenarios?${params.toString()}`, { method: "GET", showLoading: false });
                    this.contextScenarios = Array.isArray(json.data) ? json.data : [];
                    this.renderContextScenarios(preferredScenarioId);
                } catch (error) {
                    const message = error.message || "Scenario load failed.";
                    this.contextLoadFailed = true;
                    this.contextScenarios = [];
                    this.selectedScenarioId = "";
                    if (select) select.innerHTML = `<option value="">Scenario load failed</option>`;
                    this.renderError(`#scenarioTablesGrid-${PAGE_CODE}`, message);
                }
            },

            renderContextScenarios(preferredScenarioId = "") {
                const select = getContainerEl(`#contextScenario-${PAGE_CODE}`);
                if (!select) return;

                select.innerHTML = `
                    <option value="">-- Select scenario --</option>
                    ${this.contextScenarios.map((scenario) => `
                        <option value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                            ${this.escapeHtml(scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "(Untitled scenario)")}
                        </option>
                    `).join("")}
                `;

                const exists = this.contextScenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
                const firstScenarioId = this.contextScenarios.length ? String(this.contextScenarios[0].SCENARIO_ID ?? "") : "";
                this.selectedScenarioId = exists ? String(preferredScenarioId) : firstScenarioId;
                select.value = this.selectedScenarioId;
                this.saveStoredContext();
            },

            async handleContextScenarioChange(scenarioId) {
                this.selectedScenarioId = scenarioId || "";
                this.selectedScenarioTableKey = "";
                this.saveStoredContext();
                await this.loadScenarioTables();
                await this.loadFlowAssets();
                await this.loadFlowVersions(true, { refreshHistory: true });
                this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId));
            },

            async loadScenarioTables() {
                const container = getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`);
                if (!container) {
                    this.scenarioTables = [];
                    this.selectedScenarioTableKey = "";
                    this.updateWorkContextSummary();
                    return;
                }

                const preferredTableKey = this.selectedScenarioTableKey || "";
                this.selectedScenarioTableKey = "";
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    this.scenarioTables = [];
                    container.innerHTML = `
                        <div class="table-empty">Select project and scenario first.</div>
                        ${this.renderScenarioTableFooter(0)}
                    `;
                    this.updateWorkContextSummary();
                    return;
                }

                container.innerHTML = `<div class="table-empty">Loading scenario tables...</div>`;
                try {
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/${SCENARIO_TABLE_API}/scenario-tables?${params.toString()}`, { method: "GET", showLoading: false });
                    this.scenarioTables = Array.isArray(json.data) ? json.data : [];
                    const exists = this.scenarioTables.some((row) => this.getScenarioTableKey(row) === preferredTableKey);
                    this.selectedScenarioTableKey = exists ? preferredTableKey : "";
                    this.renderScenarioTables();
                } catch (error) {
                    const message = error.message || "Scenario table load failed.";
                    this.scenarioTables = [];
                    container.innerHTML = `<div class="table-error">${this.escapeHtml(message)}</div>`;
                    this.updateWorkContextSummary();
                }
            },

            renderScenarioTables() {
                const container = getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`);
                if (!container) return;

                if (!this.scenarioTables.length) {
                    container.innerHTML = `
                        <div class="table-empty">No tables registered to this scenario.</div>
                        ${this.renderScenarioTableFooter(0)}
                    `;
                    this.updateWorkContextSummary();
                    return;
                }

                container.innerHTML = `
                    <div class="scenario-table-head">
                        <div>Owner</div>
                        <div>Table</div>
                        <div>Comment</div>
                        <div>Status</div>
                    </div>
                    <div class="scenario-table-body">
                        ${this.scenarioTables.map((row) => this.createScenarioTableRow(row)).join("")}
                    </div>
                    ${this.renderScenarioTableFooter(this.scenarioTables.length)}
                `;
                this.updateWorkContextSummary();
            },

            renderScenarioTableFooter(count) {
                return `<div class="list-count-footer">${Number(count || 0).toLocaleString()} scenario tables</div>`;
            },

            async loadFlowAssets() {
                await this.loadFlowNodeTypes();
                await Promise.all([
                    this.loadRegisteredJobs(),
                    this.loadDefaultVariables()
                ]);
                this.bindFlowPalette();
            },

            async loadRegisteredJobs() {
                const container = getContainerEl(`#flowRegisteredJobGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    this.flowRegisteredJobs = [];
                    container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>${this.renderListFooter(0)}`;
                    return;
                }

                container.innerHTML = `<div class="table-empty">Loading registered jobs...</div>`;
                try {
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/assets/jobs?${params.toString()}`, { method: "GET", showLoading: false });
                    this.flowRegisteredJobs = Array.isArray(json.data) ? json.data : [];
                    this.renderRegisteredJobs();
                } catch (error) {
                    this.flowRegisteredJobs = [];
                    container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Registered job load failed.")}</div>`;
                }
            },

            async loadFlowNodeTypes() {
                try {
                    const params = new URLSearchParams();
                    if (this.selectedProjectId) params.set("projectId", this.selectedProjectId);
                    if (this.selectedScenarioId) params.set("scenarioId", this.selectedScenarioId);
                    const suffix = params.toString() ? `?${params.toString()}` : "";
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/node-types${suffix}`, { method: "GET", showLoading: false });
                    this.flowNodeTypes = Array.isArray(json.data) ? json.data : [];
                } catch (error) {
                    this.flowNodeTypes = [];
                }
                this.renderNodeTypeOptions();
            },

            renderNodeTypeOptions() {
                const select = getContainerEl(`#nodeType-${PAGE_CODE}`);
                if (!select || !this.flowNodeTypes.length) return;
                const currentValue = select.value || "";
                select.innerHTML = this.flowNodeTypes.map((item) => `
                    <option value="${this.escapeHtml(item.NODE_TYPE || "")}">${this.escapeHtml(item.NODE_TYPE_NAME || item.NODE_TYPE || "")}</option>
                `).join("");
                if (currentValue && this.flowNodeTypes.some((item) => String(item.NODE_TYPE) === String(currentValue))) {
                    select.value = currentValue;
                } else if (currentValue) {
                    select.insertAdjacentHTML("afterbegin", `<option value="${this.escapeHtml(currentValue)}">${this.escapeHtml(this.getNodeTypeLabel(currentValue, currentValue))}</option>`);
                    select.value = currentValue;
                }
            },

            renderRegisteredJobs() {
                const container = getContainerEl(`#flowRegisteredJobGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.flowRegisteredJobs.length) {
                    container.innerHTML = `<div class="table-empty">No registered jobs for this scenario.</div>${this.renderListFooter(0)}`;
                    return;
                }

                const groups = this.groupRegisteredJobs();
                container.innerHTML = `
                    <div class="flow-job-group-list">
                        ${groups.map((group) => this.renderRegisteredJobGroup(group)).join("")}
                    </div>
                    ${this.renderListFooter(this.flowRegisteredJobs.length)}
                `;
                this.bindRegisteredJobGroupControls();
                this.bindFlowPalette();
            },

            groupRegisteredJobs() {
                const groupMap = new Map();
                this.flowRegisteredJobs.forEach((job) => {
                    const groupKey = String(job.JOB_GROUP || job.MENU_CODE || "UNGROUPED");
                    if (!groupMap.has(groupKey)) {
                        const nodeType = this.getNodeTypeForJob(job);
                        const nodeTypeLabel = this.getNodeTypeLabel(nodeType, groupKey);
                        groupMap.set(groupKey, {
                            key: groupKey,
                            label: this.getNodeDisplayLabel(nodeTypeLabel),
                            code: groupKey,
                            jobs: []
                        });
                    }
                    groupMap.get(groupKey).jobs.push(job);
                });
                return Array.from(groupMap.values());
            },

            renderRegisteredJobGroup(group) {
                const collapsed = this.flowJobGroupCollapsed.has(group.key);
                return `
                    <section class="flow-job-group${collapsed ? " is-collapsed" : ""}" data-job-group="${this.escapeHtml(group.key)}">
                        <button type="button" class="flow-job-group-header" data-flow-job-group-toggle="Y" aria-expanded="${String(!collapsed)}">
                            <span class="flow-job-group-title">
                                <i class="fas ${collapsed ? "fa-chevron-right" : "fa-chevron-down"}"></i>
                                <strong>${this.escapeHtml(group.label)}</strong>
                                <small>${this.escapeHtml(group.code || group.key)}</small>
                            </span>
                            <span class="flow-job-group-count">${group.jobs.length.toLocaleString()} jobs</span>
                        </button>
                        <div class="data-job-list flow-job-group-body">
                            ${group.jobs.map((job, index) => this.renderRegisteredJobRow(job, index)).join("")}
                        </div>
                    </section>
                `;
            },

            renderRegisteredJobRow(job, index) {
                const nodeType = this.getNodeTypeForJob(job);
                const nodeTypeLabel = this.getNodeTypeLabel(nodeType, job.JOB_GROUP || job.MENU_CODE || "JOB");
                const jobId = job.WORK_JOB_ID || job.PROFILE_JOB_ID || "";
                const tableLabel = `${job.OWNER_NAME || "-"}.${job.TABLE_NAME || "-"}`;
                const metaLabel = [job.MENU_CODE, this.getNodeDisplayLabel(nodeTypeLabel)].filter(Boolean).join(" - ");
                const descLabel = job.JOB_DESC || metaLabel || tableLabel;
                return `
                    <button type="button" class="data-job-row flow-palette-job" draggable="true"
                        data-node-type="${this.escapeHtml(nodeType)}"
                        data-node-type-label="${this.escapeHtml(nodeTypeLabel)}"
                        data-job-id="${this.escapeHtml(jobId)}"
                        data-ref-menu-code="${this.escapeHtml(job.MENU_CODE || "")}"
                        data-owner-name="${this.escapeHtml(job.OWNER_NAME || "")}"
                        data-table-name="${this.escapeHtml(job.TABLE_NAME || "")}"
                        data-ref-object-id="${this.escapeHtml(job.EXEC_OBJECT_ID || "")}">
                        <span class="data-job-order">${String(index + 1).padStart(2, "0")}</span>
                        <span class="flow-palette-job-main">
                            <strong title="${this.escapeHtml(job.JOB_NAME || "(Untitled job)")}" class="flow-palette-job-name">${this.escapeHtml(job.JOB_NAME || "(Untitled job)")}</strong>
                            <small class="flow-palette-job-meta">
                                <span class="flow-palette-job-desc" title="${this.escapeHtml(descLabel)}">${this.escapeHtml(descLabel)}</span>
                                <span title="${this.escapeHtml(tableLabel)}">${this.escapeHtml(tableLabel)}</span>
                            </small>
                        </span>
                    </button>
                `;
            },

            bindRegisteredJobGroupControls() {
                const container = getContainerEl(`#flowRegisteredJobGrid-${PAGE_CODE}`);
                if (!container) return;
                container.querySelectorAll("[data-flow-job-group-toggle]").forEach((button) => {
                    if (button.dataset.flowJobGroupBound === "Y") return;
                    button.dataset.flowJobGroupBound = "Y";
                    button.addEventListener("click", () => {
                        const groupEl = button.closest(".flow-job-group");
                        const groupKey = groupEl?.dataset.jobGroup || "";
                        this.toggleJobGroup(groupKey);
                    });
                });
            },

            toggleJobGroup(groupKey) {
                if (!groupKey) return;
                if (this.flowJobGroupCollapsed.has(groupKey)) {
                    this.flowJobGroupCollapsed.delete(groupKey);
                } else {
                    this.flowJobGroupCollapsed.add(groupKey);
                }
                this.renderRegisteredJobs();
            },

            setAllJobGroupsExpanded(expanded) {
                const groups = this.groupRegisteredJobs();
                this.flowJobGroupCollapsed = new Set(expanded ? [] : groups.map((group) => group.key));
                this.renderRegisteredJobs();
            },

            getNodeTypeForJob(job) {
                return String(job?.JOB_GROUP || job?.MENU_CODE || "JOB").trim() || "JOB";
            },

            getNodeTypeLabel(nodeType, fallbackLabel = "") {
                const type = String(nodeType || "").toUpperCase();
                const match = this.flowNodeTypes.find((item) => String(item.NODE_TYPE || "").toUpperCase() === type);
                const knownLabels = {
                    M03001: "데이터 프로파일링",
                    M03002: "컬럼간 상관 분석",
                    M03003: "자동 규칙 발굴",
                    M03004: "규칙 위반 탐지"
                };
                return match?.NODE_TYPE_NAME || knownLabels[type] || fallbackLabel || type || "JOB";
            },

            getNodeTypeConfig(nodeType) {
                const type = String(nodeType || "").toUpperCase();
                return this.flowNodeTypes.find((item) => String(item.NODE_TYPE || "").toUpperCase() === type) || null;
            },

            getNodeDisplayLabel(label) {
                return String(label || "").replace(/^M\d{5}\s*[-/]\s*/, "").trim() || String(label || "");
            },

            getRegisteredJobAsset(jobId) {
                const key = String(jobId || "");
                if (!key) return null;
                return this.flowRegisteredJobs.find((job) => String(job.WORK_JOB_ID || job.PROFILE_JOB_ID || "") === key) || null;
            },

            buildFlowNodeDataFromJob(job, fallback = {}) {
                const source = job || {};
                const nodeType = source.JOB_GROUP || fallback.nodeType || source.MENU_CODE || fallback.refMenuCode || "JOB";
                const nodeTypeLabel = this.getNodeTypeLabel(nodeType, source.JOB_GROUP || source.MENU_CODE || fallback.nodeTypeLabel || "JOB");
                const jobId = source.WORK_JOB_ID || source.PROFILE_JOB_ID || fallback.jobId || "";
                const tableLabel = `${source.OWNER_NAME || fallback.ownerName || "-"}.${source.TABLE_NAME || fallback.tableName || "-"}`;
                const desc = source.JOB_DESC ? ` - ${source.JOB_DESC}` : "";
                return {
                    nodeType,
                    nodeTypeLabel,
                    jobId,
                    refMenuCode: source.MENU_CODE || fallback.refMenuCode || "",
                    execSourceType: source.EXEC_SOURCE_TYPE || fallback.execSourceType || "DB_OBJECT",
                    execResourceId: source.EXEC_RESOURCE_ID || fallback.execResourceId || "",
                    execMethod: source.EXEC_METHOD || fallback.execMethod || "",
                    execSpecJson: source.EXEC_SPEC_JSON || fallback.execSpecJson || "",
                    ownerName: source.OWNER_NAME || fallback.ownerName || "",
                    tableName: source.TABLE_NAME || fallback.tableName || "",
                    refObjectId: source.EXEC_OBJECT_ID || fallback.refObjectId || "",
                    resultCreateYn: this.normalizeResultCreateMode(source.RESULT_CREATE_YN || fallback.resultCreateYn || "N"),
                    resultOwner: source.RESULT_OWNER || fallback.resultOwner || "",
                    resultTableName: source.RESULT_TABLE_NAME || fallback.resultTableName || "",
                    execPlsql: source.EXEC_PLSQL || "",
                    params: this.parseNodeJson(source.PARAM_JSON, []),
                    title: source.JOB_NAME || fallback.title || "New node",
                    subtitle: source.MENU_CODE ? `${source.MENU_CODE} / ${tableLabel}${desc}` : (fallback.subtitle || jobId || "Manual node")
                };
            },

            async loadDefaultVariables() {
                const container = getContainerEl(`#flowVariableGrid-${PAGE_CODE}`);
                if (!container) return;
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/default-variables`, { method: "GET" });
                    this.flowVariables = Array.isArray(json.data) ? json.data : [];
                    this.renderFlowVariables();
                } catch (error) {
                    this.flowVariables = [];
                    container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Variable load failed.")}</div>`;
                }
            },

            renderFlowVariables() {
                const container = getContainerEl(`#flowVariableGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.flowVariables.length) {
                    container.innerHTML = `<div class="table-empty">No variables.</div>${this.renderListFooter(0)}`;
                    return;
                }
                container.innerHTML = `
                    <table class="table-grid">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Default</th>
                                <th>Scope</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.flowVariables.map((item) => `
                                <tr>
                                    <td>${this.escapeHtml(item.VARIABLE_NAME || "")}</td>
                                    <td>${this.escapeHtml(item.VARIABLE_TYPE || "")}</td>
                                    <td>${this.escapeHtml(item.DEFAULT_VALUE || "")}</td>
                                    <td>${this.escapeHtml(item.VARIABLE_SCOPE || "")}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(this.flowVariables.length)}
                `;
            },

            async loadFlowVersions(loadLatest = false, options = {}) {
                const select = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                const grid = getContainerEl(`#flowVersionGrid-${PAGE_CODE}`);
                if (!select && !grid) return;
                const forceDraft = Boolean(options.forceDraft);
                const refreshHistory = Boolean(options.refreshHistory);
                const currentFlowId = forceDraft ? "" : this.getValue(`#flowId-${PAGE_CODE}`);
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    this.flowList = [];
                    if (select) select.innerHTML = `<option value="">Draft</option>`;
                    if (grid) grid.innerHTML = `<div class="table-empty">Select project and scenario first.</div>`;
                    this.updateFlowVersionCount();
                    this.newFlow(false);
                    if (refreshHistory) await this.loadFlowRunHistory();
                    return;
                }

                try {
                    this.setFlowVersionLoading(true);
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flows?${params.toString()}`, { method: "GET" });
                    this.flowList = Array.isArray(json.data) ? json.data : [];
                    if (forceDraft) {
                        this.newFlow(true);
                        if (refreshHistory) await this.loadFlowRunHistory();
                        return;
                    }
                    this.renderFlowVersions();
                    if (loadLatest && this.flowList.length) {
                        await this.loadFlowVersion(this.flowList[0].FLOW_ID, { refreshHistory });
                    } else if (/^\d+$/.test(currentFlowId)) {
                        const exists = this.flowList.some((flow) => String(flow.FLOW_ID) === String(currentFlowId));
                        if (exists) {
                            if (select) select.value = currentFlowId;
                            this.renderFlowVersions();
                        } else {
                            this.newFlow(false);
                            this.renderFlowVersions();
                        }
                    }
                    if (!(loadLatest && this.flowList.length) && refreshHistory) {
                        await this.loadFlowRunHistory();
                    }
                } catch (error) {
                    this.flowList = [];
                    if (select) select.innerHTML = `<option value="">Flow list load failed</option>`;
                    if (grid) grid.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Flow list load failed.")}</div>`;
                    const switcherList = getContainerEl(`#flowSwitcherList-${PAGE_CODE}`);
                    if (switcherList) switcherList.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Flow list load failed.")}</div>`;
                    this.updateFlowVersionCount();
                    this.updateFlowSwitcherSummary();
                } finally {
                    this.setFlowVersionLoading(false);
                }
            },

            setFlowVersionLoading(isLoading) {
                const refreshButton = getContainerEl(`#flowVersionRefresh-${PAGE_CODE}`);
                const copyButton = getContainerEl(`#flowVersionCopy-${PAGE_CODE}`);
                const refreshIcon = refreshButton?.querySelector("i");
                const countLabel = getContainerEl(`#flowVersionCount-${PAGE_CODE}`);
                const grid = getContainerEl(`#flowVersionGrid-${PAGE_CODE}`);
                if (refreshButton) {
                    refreshButton.disabled = Boolean(isLoading);
                    refreshButton.classList.toggle("is-loading", Boolean(isLoading));
                }
                if (copyButton) {
                    copyButton.disabled = Boolean(isLoading) || !/^\d+$/.test(this.getValue(`#flowId-${PAGE_CODE}`));
                }
                if (refreshIcon) {
                    refreshIcon.classList.toggle("fa-spin", Boolean(isLoading));
                }
                if (countLabel) {
                    countLabel.textContent = isLoading ? "loading..." : `${this.flowList.length.toLocaleString()} items`;
                }
                const switcherCount = getContainerEl(`#flowSwitcherCount-${PAGE_CODE}`);
                if (switcherCount) {
                    switcherCount.textContent = isLoading ? "loading..." : `${this.flowList.length.toLocaleString()} items`;
                }
                const switcherList = getContainerEl(`#flowSwitcherList-${PAGE_CODE}`);
                if (isLoading && switcherList) {
                    switcherList.innerHTML = `
                        <div class="table-empty flow-list-loading">
                            <i class="fas fa-sync-alt fa-spin"></i>
                            <span>Loading saved flows...</span>
                        </div>
                    `;
                }
                if (isLoading && grid) {
                    grid.innerHTML = `
                        <div class="table-empty flow-list-loading">
                            <i class="fas fa-sync-alt fa-spin"></i>
                            <span>Loading saved flows...</span>
                        </div>
                    `;
                }
            },

            renderFlowVersions() {
                const select = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                const grid = getContainerEl(`#flowVersionGrid-${PAGE_CODE}`);
                if (!select && !grid) return;
                const currentFlowId = this.getValue(`#flowId-${PAGE_CODE}`);
                const countText = `${this.flowList.length.toLocaleString()} saved`;
                if (select) {
                    select.innerHTML = `
                        <option value="">NEW - Draft (${countText})</option>
                        ${this.flowList.map((flow) => `
                            <option value="${this.escapeHtml(flow.FLOW_ID ?? "")}">
                                ${this.escapeHtml(`#${flow.FLOW_ID} ${flow.FLOW_GROUP || ""} ${flow.FLOW_NAME || "Untitled Flow"}`)}
                            </option>
                        `).join("")}
                    `;
                }
                if (grid) {
                    grid.innerHTML = `
                        ${this.flowList.length
                            ? this.flowList.map((flow, index) => this.renderFlowVersionRow(flow, index, currentFlowId)).join("")
                            : `<div class="table-empty">No saved flows. Use the + button to start a draft.</div>`}
                    `;
                }
                this.updateFlowVersionCount();
                this.updateFlowCopyButton();
                this.updateFlowSwitcherSummary();
                this.renderFlowSwitcherList();
                if (select && this.flowList.some((flow) => String(flow.FLOW_ID) === String(currentFlowId))) {
                    select.value = currentFlowId;
                }
                this.isFlowRunning = this.isFlowRunActive();
                this.updateFlowActionButtons();
                this.scrollSelectedFlowVersionIntoView();
            },

            isFlowSwitcherOpen() {
                const popover = getContainerEl(`#flowSwitcherPopover-${PAGE_CODE}`);
                return Boolean(popover && !popover.hidden);
            },

            openFlowSwitcher(event = null) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                const popover = getContainerEl(`#flowSwitcherPopover-${PAGE_CODE}`);
                const button = getContainerEl(`#flowSwitcherButton-${PAGE_CODE}`);
                if (!popover) return;
                const trigger = event?.currentTarget || event?.target || null;
                const anchor = trigger?.closest?.(`#flowSwitcherButton-${PAGE_CODE}`) ? button : null;
                popover.hidden = false;
                button?.setAttribute("aria-expanded", "true");
                this.renderFlowSwitcherList();
                this.positionFlowSwitcherPopover(anchor);
                window.setTimeout(() => {
                    this.positionFlowSwitcherPopover(anchor);
                    getContainerEl(`#flowSwitcherSearch-${PAGE_CODE}`)?.focus();
                }, 0);
            },

            closeFlowSwitcher() {
                const popover = getContainerEl(`#flowSwitcherPopover-${PAGE_CODE}`);
                const button = getContainerEl(`#flowSwitcherButton-${PAGE_CODE}`);
                if (!popover || popover.hidden) return;
                popover.hidden = true;
                button?.setAttribute("aria-expanded", "false");
            },

            positionFlowSwitcherPopover(anchor = null) {
                const popover = getContainerEl(`#flowSwitcherPopover-${PAGE_CODE}`);
                if (!popover) return;
                popover.classList.toggle("is-anchor-positioned", Boolean(anchor));
                popover.style.left = "";
                popover.style.right = "";
                popover.style.top = "";
                popover.style.width = "";
                popover.style.transform = "";
                if (!anchor) return;

                const margin = 12;
                const gap = 8;
                const rect = anchor.getBoundingClientRect();
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
                const width = Math.min(760, Math.max(320, viewportWidth - margin * 2));
                popover.style.width = `${width}px`;
                popover.style.transform = "none";

                const height = Math.min(popover.offsetHeight || 420, viewportHeight - margin * 2);
                const spaceBelow = viewportHeight - rect.bottom - gap - margin;
                const spaceAbove = rect.top - gap - margin;
                const preferBelow = spaceBelow >= height || spaceBelow >= spaceAbove;
                const top = preferBelow
                    ? Math.min(rect.bottom + gap, viewportHeight - height - margin)
                    : Math.max(margin, rect.top - height - gap);
                const left = Math.min(
                    Math.max(margin, rect.left),
                    viewportWidth - width - margin
                );

                popover.style.left = `${left}px`;
                popover.style.top = `${Math.max(margin, top)}px`;
            },

            toggleFlowSwitcher(event = null) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                if (this.isFlowSwitcherOpen()) {
                    this.closeFlowSwitcher();
                } else {
                    this.openFlowSwitcher(event);
                }
            },

            handleFlowSwitcherSearch(value) {
                this.flowSwitcherSearch = String(value || "").trim();
                this.renderFlowSwitcherList();
            },

            handleFlowSwitcherSearchKeydown(event) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    this.closeFlowSwitcher();
                }
            },

            getCurrentFlowRecord() {
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                return this.flowList.find((flow) => String(flow.FLOW_ID || "") === String(flowId || "")) || null;
            },

            getSortedFlowList() {
                const sortableTime = (flow) => {
                    const text = String(flow.UPDATED_AT || flow.CREATED_AT || "").trim();
                    if (!text) return 0;
                    const parsed = Date.parse(text.replace(/\s+KST$/i, "").replace(" ", "T"));
                    return Number.isFinite(parsed) ? parsed : 0;
                };
                return [...(this.flowList || [])].sort((a, b) => {
                    const aTime = sortableTime(a);
                    const bTime = sortableTime(b);
                    if (aTime !== bTime) return bTime - aTime;
                    return Number(b.FLOW_ID || 0) - Number(a.FLOW_ID || 0);
                });
            },

            getFilteredFlowList() {
                const keyword = this.flowSwitcherSearch.toLowerCase();
                const list = this.getSortedFlowList();
                if (!keyword) return list;
                return list.filter((flow) => [
                    flow.FLOW_ID,
                    flow.FLOW_GROUP,
                    flow.FLOW_NAME,
                    flow.FLOW_DESC,
                    flow.EXECUTION_MODE,
                    flow.USE_YN,
                    flow.UPDATED_AT,
                    flow.CREATED_AT
                ].some((value) => String(value || "").toLowerCase().includes(keyword)));
            },

            getFlowDisplayInfo(flow = null) {
                const currentId = this.getValue(`#flowId-${PAGE_CODE}`);
                const saved = flow || this.getCurrentFlowRecord() || {};
                const flowId = saved.FLOW_ID || currentId || "NEW";
                const flowName = this.getValue(`#flowName-${PAGE_CODE}`).trim() || saved.FLOW_NAME || (/^\d+$/.test(String(flowId)) ? `Flow #${flowId}` : "Draft Flow");
                const flowGroup = this.getValue(`#flowGroup-${PAGE_CODE}`).trim() || saved.FLOW_GROUP || config.defaultFlowGroup || PAGE_CODE;
                const useYn = this.getValue(`#flowUseYn-${PAGE_CODE}`).trim() || saved.USE_YN || "Y";
                const mode = saved.EXECUTION_MODE || "DAG";
                const updatedAt = saved.UPDATED_AT || saved.CREATED_AT || "";
                return {
                    flowId,
                    flowName,
                    flowGroup,
                    useYn,
                    mode,
                    updatedAt,
                    updatedAtLabel: this.formatKstDateTime(updatedAt)
                };
            },

            updateFlowSwitcherSummary() {
                const info = this.getFlowDisplayInfo();
                const idLabel = /^\d+$/.test(String(info.flowId || "")) ? `#${info.flowId}` : "NEW";
                const metaParts = [idLabel, info.flowGroup, info.useYn, info.mode].filter(Boolean);
                if (info.updatedAtLabel) metaParts.push(info.updatedAtLabel);
                this.setText(`#flowSwitcherName-${PAGE_CODE}`, info.flowName);
                this.setText(`#flowSwitcherMeta-${PAGE_CODE}`, metaParts.join(" / "));
                this.setText(`#flowSavedCompactName-${PAGE_CODE}`, info.flowName);
                this.setText(`#flowSavedCompactMeta-${PAGE_CODE}`, `${metaParts.join(" / ")} · ${this.flowList.length.toLocaleString()} saved`);
                this.setText(`#flowSwitcherCount-${PAGE_CODE}`, `${this.flowList.length.toLocaleString()} items`);
            },

            renderFlowSwitcherList() {
                const listEl = getContainerEl(`#flowSwitcherList-${PAGE_CODE}`);
                if (!listEl) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    listEl.innerHTML = `<div class="table-empty">Select project and scenario first.</div>`;
                    this.updateFlowSwitcherSummary();
                    return;
                }
                const rows = this.getFilteredFlowList();
                if (!this.flowList.length) {
                    listEl.innerHTML = `<div class="table-empty">No saved flows. Use the + button to start a draft.</div>`;
                    this.updateFlowSwitcherSummary();
                    return;
                }
                if (!rows.length) {
                    listEl.innerHTML = `<div class="table-empty">No saved flows match the search.</div>`;
                    this.updateFlowSwitcherSummary();
                    return;
                }
                const currentFlowId = this.getValue(`#flowId-${PAGE_CODE}`);
                listEl.innerHTML = rows.map((flow, index) => this.renderFlowSwitcherRow(flow, index, currentFlowId)).join("");
                this.updateFlowSwitcherSummary();
            },

            renderFlowSwitcherRow(flow, index, currentFlowId) {
                const flowId = flow.FLOW_ID ?? "";
                const selectedClass = String(flowId) === String(currentFlowId) ? " is-selected" : "";
                const running = this.activeFlowRuns.get(String(flowId));
                const runningClass = running ? " is-running" : "";
                const flowCode = flow.FLOW_GROUP || config.defaultFlowGroup || PAGE_CODE;
                const flowName = flow.FLOW_NAME || "Untitled Flow";
                const flowDesc = flow.FLOW_DESC || "";
                const updatedAt = flow.UPDATED_AT || flow.CREATED_AT || "";
                const updatedAtLabel = this.formatKstDateTime(updatedAt);
                const mode = flow.EXECUTION_MODE || "DAG";
                const useYn = flow.USE_YN || "Y";
                return `
                    <div class="flow-switcher-row${selectedClass}${runningClass}" data-flow-id="${this.escapeHtml(flowId)}">
                        <button type="button" class="flow-switcher-row-main" onclick="${PAGE_CODE}.selectFlowFromSwitcher('${this.escapeJs(flowId)}')">
                            <span class="data-job-order">${this.escapeHtml(index + 1)}</span>
                            <span class="flow-switcher-row-text">
                                <strong>${this.escapeHtml(flowName)}</strong>
                                <small>#${this.escapeHtml(flowId)} / ${this.escapeHtml(flowCode)}${flowDesc ? ` / ${this.escapeHtml(flowDesc)}` : ""}</small>
                                ${running ? `<em><i class="fas fa-spinner fa-spin"></i>${this.escapeHtml(running.label || "Running...")}</em>` : ""}
                            </span>
                            <span class="flow-switcher-row-meta">
                                <small title="${this.escapeHtml(updatedAt)}">${this.escapeHtml(updatedAtLabel || "-")}</small>
                                <em><span>${this.escapeHtml(useYn)}</span><span>${this.escapeHtml(mode)}</span></em>
                            </span>
                        </button>
                        <span class="flow-switcher-row-actions">
                            <button type="button" class="table-icon-btn" title="Select flow" onclick="${PAGE_CODE}.selectFlowFromSwitcher('${this.escapeJs(flowId)}')">
                                <i class="fas fa-check"></i>
                            </button>
                            <button type="button" class="table-icon-btn" title="Copy flow as draft" onclick="${PAGE_CODE}.copySavedFlowFromSwitcher('${this.escapeJs(flowId)}', event)">
                                <i class="far fa-copy"></i>
                            </button>
                        </span>
                    </div>
                `;
            },

            async selectFlowFromSwitcher(flowId) {
                if (!/^\d+$/.test(String(flowId || ""))) return;
                await this.loadFlowVersion(flowId, { refreshHistory: false });
                this.closeFlowSwitcher();
            },

            async copySavedFlowFromSwitcher(flowId, event = null) {
                await this.copySavedFlowFromList(flowId, event);
                this.closeFlowSwitcher();
            },

            scrollSelectedFlowVersionIntoView() {
                const grid = getContainerEl(`#flowVersionGrid-${PAGE_CODE}`);
                const selectedRow = grid?.querySelector?.(".flow-version-row.is-selected");
                if (!grid || !selectedRow) return;
                const gridRect = grid.getBoundingClientRect();
                const rowRect = selectedRow.getBoundingClientRect();
                const rowTop = grid.scrollTop + rowRect.top - gridRect.top;
                const rowBottom = rowTop + selectedRow.offsetHeight;
                const viewTop = grid.scrollTop;
                const viewBottom = viewTop + grid.clientHeight;
                if (rowTop < viewTop) {
                    grid.scrollTop = rowTop;
                } else if (rowBottom > viewBottom) {
                    grid.scrollTop = rowBottom - grid.clientHeight;
                }
            },

            updateFlowCopyButton() {
                const copyButton = getContainerEl(`#flowVersionCopy-${PAGE_CODE}`);
                if (copyButton) {
                    copyButton.disabled = !/^\d+$/.test(this.getValue(`#flowId-${PAGE_CODE}`));
                }
            },

            renderFlowVersionRow(flow, index, currentFlowId) {
                const flowId = flow.FLOW_ID ?? "";
                const selectedClass = String(flowId) === String(currentFlowId) ? "is-selected" : "";
                const running = this.activeFlowRuns.get(String(flowId));
                const runningClass = running ? " is-running" : "";
                const flowCode = flow.FLOW_GROUP || config.defaultFlowGroup || PAGE_CODE;
                const flowName = flow.FLOW_NAME || "Untitled Flow";
                const flowDesc = flow.FLOW_DESC || flow.FLOW_TYPE || "";
                const updatedAt = flow.UPDATED_AT || flow.CREATED_AT || "";
                const updatedAtLabel = this.formatKstDateTime(updatedAt);
                return `
                    <button type="button" class="data-job-row flow-version-row ${selectedClass}${runningClass}" data-flow-id="${this.escapeHtml(flowId)}" onclick="${PAGE_CODE}.loadFlowVersion('${this.escapeJs(flowId)}')">
                        <span class="data-job-order">${this.escapeHtml(index + 1)}</span>
                        <span class="flow-version-main">
                            <strong>${this.escapeHtml(flowName)}</strong>
                            <small>#${this.escapeHtml(flowId)} / ${this.escapeHtml(flowCode)}</small>
                            ${running ? `
                                <small class="flow-version-progress-label"><i class="fas fa-spinner fa-spin"></i>${this.escapeHtml(running.label || "Running...")}</small>
                                <span class="data-job-progress flow-version-progress"></span>
                            ` : ""}
                        </span>
                        <span class="flow-version-desc" title="${this.escapeHtml(flowDesc)}">${this.escapeHtml(flowDesc || "-")}</span>
                        <span class="flow-version-updated" title="${this.escapeHtml(updatedAt)}">${this.escapeHtml(updatedAtLabel || "-")}</span>
                        <em><span>${this.escapeHtml(flow.USE_YN || "Y")}</span><span>${this.escapeHtml(flow.EXECUTION_MODE || "DAG")}</span></em>
                    </button>
                `;
            },

            updateFlowVersionCount() {
                const countLabel = getContainerEl(`#flowVersionCount-${PAGE_CODE}`);
                if (countLabel) {
                    countLabel.textContent = `${this.flowList.length.toLocaleString()} items`;
                }
            },

            async refreshSavedFlows() {
                await this.loadFlowVersions(false);
            },

            copySelectedSavedFlow() {
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                if (!/^\d+$/.test(flowId)) {
                    alert("Select a saved flow first.");
                    return;
                }
                this.copyFlowAsDraft();
            },

            async copySavedFlowFromList(flowId, event) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                if (!/^\d+$/.test(String(flowId || ""))) return;
                await this.loadFlowVersion(flowId, { refreshHistory: false });
                this.copyFlowAsDraft();
            },

            copyFlowAsDraft() {
                const originalName = this.getValue(`#flowName-${PAGE_CODE}`).trim() || "Untitled Flow";
                this.setValue(`#flowId-${PAGE_CODE}`, "NEW");
                this.setValue(`#flowName-${PAGE_CODE}`, `Copy of ${originalName}`);
                const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (selector) selector.value = "";
                this.isSampleFlowVisible = false;
                this.setSampleFlowState(false);
                this.renderFlowVersions();
                this.updateFlowCopyButton();
                this.updateWorkContextSummary();
                const label = getContainerEl(`#selectedFlowLabel-${PAGE_CODE}`);
                if (label) label.textContent = "Copied as a new draft. Save it to create a new FLOW.";
            },

            async refreshRegisteredJobs() {
                await this.loadRegisteredJobs();
                this.bindFlowPalette();
            },

            toggleFlowSidebar() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                this.flowSidebarCollapsed = !this.flowSidebarCollapsed;
                container.classList.toggle("is-flow-sidebar-collapsed", this.flowSidebarCollapsed);
                this.renderFlowSidebarToggle();
                setTimeout(() => {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                    this.updateSelectedEdgeDeleteButton();
                }, 0);
            },

            renderFlowSidebarToggle() {
                const button = getContainerEl(`#flowSidebarToggle-${PAGE_CODE}`);
                const icon = button?.querySelector("i");
                if (!icon) return;
                icon.classList.toggle("fa-chevron-left", !this.flowSidebarCollapsed);
                icon.classList.toggle("fa-chevron-right", this.flowSidebarCollapsed);
                if (button) {
                    button.title = this.flowSidebarCollapsed ? "Expand Flow Assets" : "Collapse Flow Assets";
                }
            },

            async loadFlowVersion(flowId, options = {}) {
                const refreshHistory = options.refreshHistory !== false;
                if (!flowId) {
                    this.newFlow(false);
                    if (refreshHistory) await this.loadFlowRunHistory();
                    return;
                }
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/${encodeURIComponent(flowId)}`, { method: "GET" });
                    if (json.data) {
                        this.applyFlowData(json.data, { preserveZoom: true });
                        this.renderFlowVersions();
                        if (refreshHistory) await this.loadFlowRunHistory();
                    }
                } catch (error) {
                    alert(error.message || "Flow load failed.");
                }
            },

            async reloadCurrentFlowCanvas() {
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`) || getContainerEl(`#flowVersion-${PAGE_CODE}`)?.value || "";
                if (!/^\d+$/.test(String(flowId))) {
                    alert("Saved FLOW를 선택한 뒤 캔버스를 새로고침할 수 있습니다.");
                    return;
                }
                await this.loadFlowVersion(flowId, { refreshHistory: false });
            },

            createScenarioTableRow(row) {
                const key = this.getScenarioTableKey(row);
                const selectedClass = key === this.selectedScenarioTableKey ? "is-selected" : "";
                return `
                    <div role="button" tabindex="0" class="scenario-table-row ${selectedClass}" data-scenario-table-key="${this.escapeHtml(key)}" onclick="${PAGE_CODE}.selectScenarioTable('${this.escapeJs(key)}')">
                        <span title="${this.escapeHtml(row.OWNER_NAME || "")}">${this.escapeHtml(row.OWNER_NAME || "-")}</span>
                        <span title="${this.escapeHtml(row.TABLE_NAME || "")}">${this.escapeHtml(row.TABLE_NAME || "-")}</span>
                        <span title="${this.escapeHtml(row.TABLE_COMMENT || "")}">${this.escapeHtml(row.TABLE_COMMENT || "-")}</span>
                        <span>${this.escapeHtml(row.USE_YN || "Y")}</span>
                    </div>
                `;
            },

            getScenarioTableKey(row) {
                if (row.SCENARIO_TABLE_ID) return `ID:${row.SCENARIO_TABLE_ID}`;
                return `NEW:${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`;
            },

            getSelectedScenarioTable() {
                return this.scenarioTables.find((row) => this.getScenarioTableKey(row) === this.selectedScenarioTableKey) || null;
            },

            selectScenarioTable(key) {
                this.selectedScenarioTableKey = key || "";
                getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`)?.querySelectorAll(".scenario-table-row").forEach((row) => {
                    row.classList.toggle("is-selected", row.dataset.scenarioTableKey === this.selectedScenarioTableKey);
                });
                this.updateWorkContextSummary();
            },

            updateWorkContextSummary() {
                const project = this.contextProjects.find((row) => String(row.PROJECT_ID) === String(this.selectedProjectId));
                const scenario = this.contextScenarios.find((row) => String(row.SCENARIO_ID) === String(this.selectedScenarioId));
                const parts = [
                    project ? `Project: ${project.PROJECT_NAME || project.PROJECT_CODE || "-"}` : "Project: -",
                    scenario ? `Scenario: ${scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "-"}` : "Scenario: -",
                    this.getCurrentFlowSummary()
                ];
                this.setText(`#workContextSummary-${PAGE_CODE}`, parts.join(" / "));
                this.updateFlowPanelTitles(scenario);
            },

            updateFlowPanelTitles(scenario = null) {
                const scenarioName = scenario ? (scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "") : "";
                const flowName = this.getValue(`#flowName-${PAGE_CODE}`).trim();
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                const saved = this.flowList.find((flow) => String(flow.FLOW_ID) === String(flowId)) || {};
                const displayFlowName = flowName || saved.FLOW_NAME || (flowId && flowId !== "NEW" ? `Flow #${flowId}` : "Draft Flow");
                this.setText(`#flow-assets-scenario-title-${PAGE_CODE}`, scenarioName || "");
                this.setText(`#flow-main-flow-title-${PAGE_CODE}`, displayFlowName);
                this.updateFlowSwitcherSummary();
            },

            getCurrentFlowSummary() {
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                const flowName = this.getValue(`#flowName-${PAGE_CODE}`).trim();
                const flowGroup = this.getValue(`#flowGroup-${PAGE_CODE}`).trim() || config.defaultFlowGroup || PAGE_CODE;
                const flowUseYn = this.getValue(`#flowUseYn-${PAGE_CODE}`).trim() || "Y";
                if (/^\d+$/.test(flowId)) {
                    const saved = this.flowList.find((flow) => String(flow.FLOW_ID) === String(flowId)) || {};
                    const name = flowName || saved.FLOW_NAME || `Flow #${flowId}`;
                    const group = flowGroup || saved.FLOW_GROUP || PAGE_CODE;
                    const mode = saved.EXECUTION_MODE || "DAG";
                    return `Flow: ${name} (#${flowId} / ${group} / ${flowUseYn} / ${mode})`;
                }
                return `Flow: ${flowName || "Draft"} (${flowGroup} / ${flowUseYn})`;
            },

            toggleWorkContext(event) {
                event?.stopPropagation?.();
                this.setWorkContextCollapsed(!this.workContextCollapsed);
            },

            toggleWorkContextFromHeader(event) {
                const target = event?.target;
                if (target?.closest?.("button, select, input, textarea, a, label")) return;
                this.toggleWorkContext(event);
            },

            handleWorkContextHeaderKeydown(event) {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                this.toggleWorkContext(event);
            },

            setWorkContextCollapsed(collapsed) {
                this.workContextCollapsed = Boolean(collapsed);
                const card = getContainerEl(".work-context-card");
                const toggle = getContainerEl(`#workContextToggle-${PAGE_CODE}`);
                if (card) card.classList.toggle("is-collapsed", this.workContextCollapsed);
                if (toggle) {
                    toggle.setAttribute("aria-expanded", String(!this.workContextCollapsed));
                    const icon = toggle.querySelector("i");
                    if (icon) {
                        icon.classList.toggle("fa-chevron-up", !this.workContextCollapsed);
                        icon.classList.toggle("fa-chevron-down", this.workContextCollapsed);
                    }
                    const label = toggle.querySelector("span");
                    if (label) label.textContent = this.workContextCollapsed
                        ? (FLOW_UI_LABELS.showContext || "Show")
                        : (FLOW_UI_LABELS.hideContext || "Hide");
                }
            },

            switchTab(tabName) {
                this.activeTab = tabName || "designer";
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                if (this.activeTab !== "designer" && container.classList.contains("is-flow-canvas-maximized")) {
                    container.classList.remove("is-flow-canvas-maximized");
                    this.restoreSidebarsAfterCanvasMaximize();
                    const icon = getContainerEl(`#flowCanvasMaximize-${PAGE_CODE}`)?.querySelector("i");
                    if (icon) {
                        icon.classList.add("fa-expand");
                        icon.classList.remove("fa-compress");
                    }
                }
                container.querySelectorAll(".table-tab").forEach((tab) => {
                    tab.classList.toggle("is-active", tab.dataset.tab === this.activeTab);
                });
                container.querySelectorAll(".table-tab-panel").forEach((panel) => {
                    panel.classList.toggle("is-active", panel.dataset.panel === this.activeTab);
                });
            },

            setupFlowDesigner() {
                if (this.flowDesignerBound) return;
                const stage = getContainerEl(`#flowCanvas-${PAGE_CODE}`);
                const viewport = getContainerEl(`#flowCanvasViewport-${PAGE_CODE}`);
                if (!stage || !viewport) return;

                this.flowNodePointerMoveBound = (event) => this.handleNodePointerMove(event);
                this.flowNodePointerUpBound = (event) => this.handleNodePointerUp(event);
                this.flowCanvasPointerMoveBound = (event) => this.handleCanvasPointerMove(event);
                this.flowCanvasPointerUpBound = (event) => this.handleCanvasPointerUp(event);
                this.flowCanvasWheelBound = (event) => this.handleCanvasWheel(event);
                this.flowCanvasPointerDownBound = (event) => this.handleCanvasPointerDown(event);
                this.flowCanvasDragOverBound = (event) => this.handleCanvasDragOver(event);
                this.flowCanvasDropBound = (event) => this.handleCanvasDrop(event);
                this.flowCanvasContextMenuBound = (event) => this.handleCanvasContextMenu(event);
                this.flowMenuClickBound = (event) => this.handleContextMenuClick(event);
                this.flowEdgeLayerClickBound = (event) => this.handleEdgeLayerClick(event);
                this.flowDocumentKeydownBound = (event) => this.handleFlowKeydown(event);
                this.flowDocumentClickBound = (event) => {
                    if (!event.target.closest?.(`#flowCanvasMenu-${PAGE_CODE}`)) {
                        this.hideCanvasContextMenu();
                    }
                    if (!event.target.closest?.(`#flowSwitcher-${PAGE_CODE}`)) {
                        this.closeFlowSwitcher();
                    }
                };

                stage.addEventListener("wheel", this.flowCanvasWheelBound, { passive: false });
                stage.addEventListener("pointerdown", this.flowCanvasPointerDownBound);
                stage.addEventListener("dragover", this.flowCanvasDragOverBound);
                stage.addEventListener("drop", this.flowCanvasDropBound);
                stage.addEventListener("contextmenu", this.flowCanvasContextMenuBound);
                document.addEventListener("pointermove", this.flowNodePointerMoveBound);
                document.addEventListener("pointerup", this.flowNodePointerUpBound);
                document.addEventListener("pointermove", this.flowCanvasPointerMoveBound);
                document.addEventListener("pointerup", this.flowCanvasPointerUpBound);
                document.addEventListener("click", this.flowDocumentClickBound);
                document.addEventListener("keydown", this.flowDocumentKeydownBound);
                getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`)?.addEventListener("click", this.flowMenuClickBound);
                viewport.querySelector(".flow-edge-layer")?.addEventListener("click", this.flowEdgeLayerClickBound);

                if (!viewport.querySelector(".flow-node") && this.isSampleFlowVisible) {
                    this.renderSampleFlowCanvas();
                }
                viewport.querySelectorAll(".flow-node").forEach((node) => this.bindFlowNode(node));
                this.bindFlowPalette();
                const hasSampleNodes = Boolean(viewport.querySelector(".flow-node[data-sample-node='Y']"));
                this.setSampleFlowState(this.isSampleFlowVisible || hasSampleNodes);

                const selected = viewport.querySelector(".flow-node.is-selected") || viewport.querySelector(".flow-node");
                if (selected) {
                    this.selectFlowNode(selected.dataset.nodeId || "");
                }
                this.applyFlowZoom();
                if (this.flowLayoutRestoredFromDb) {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                } else if (hasSampleNodes) {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                    this.resetFlowZoom();
                } else {
                    this.autoLayoutFlow();
                }
                this.renderFlowEdgeGrid();
                this.flowDesignerBound = true;
            },

            setSampleFlowState(isSample) {
                this.isSampleFlowVisible = Boolean(isSample);
                const container = document.getElementById(`container-${PAGE_CODE}`);
                const label = getContainerEl(`#selectedFlowLabel-${PAGE_CODE}`);
                container?.classList.toggle("is-sample-flow-visible", this.isSampleFlowVisible);
                this.getFlowNodes().forEach((node) => {
                    node.classList.toggle("is-sample-node", this.isSampleFlowVisible && node.dataset.sampleNode === "Y");
                });
                if (label && this.isSampleFlowVisible) {
                    label.textContent = "작업 템플릿입니다. 필요한 노드와 연결을 확인한 뒤 저장하세요.";
                }
            },

            showSampleFlowCanvas() {
                const viewport = this.getFlowViewport();
                if (!viewport) return;
                const selectedSampleNodeId = this.renderSampleFlowCanvas();
                viewport.querySelectorAll(".flow-node").forEach((node) => this.bindFlowNode(node));
                this.setSampleFlowState(true);
                this.flowLayoutRestoredFromDb = false;

                const selected = selectedSampleNodeId ? this.getFlowNode(selectedSampleNodeId) : viewport.querySelector(".flow-node.is-selected") || viewport.querySelector(".flow-node");
                if (selected) {
                    this.selectFlowNode(selected.dataset.nodeId || "");
                } else {
                    this.clearNodeInspector();
                }
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
                this.resetFlowZoom();
            },

            renderSampleFlowCanvas(options = {}) {
                const showEmptyAlert = options.showEmptyAlert !== false;
                const viewport = this.getFlowViewport();
                if (!viewport) return "";
                const sampleJobs = this.getFirstRegisteredJobsByGroup();
                if (!sampleJobs.length) {
                    if (showEmptyAlert) alert("No registered jobs are available for this scenario.");
                    return "";
                }

                const start = this.getJobTemplateInsertPoint();
                const createdNodes = [];
                sampleJobs.forEach((job, index) => {
                    const node = this.createFlowNode(
                        this.buildFlowNodeDataFromJob(job),
                        start.left + index * 250,
                        start.top
                    );
                    if (!node) return;
                    node.dataset.sampleNode = "Y";
                    viewport.appendChild(node);
                    this.bindFlowNode(node);
                    createdNodes.push(node);
                });

                for (let index = 0; index < createdNodes.length - 1; index += 1) {
                    const edge = this.buildSequentialJobEdge(createdNodes[index], createdNodes[index + 1]);
                    if (edge) this.addFlowEdge(edge);
                }
                this.markFlowEdited();
                return createdNodes[0]?.dataset.nodeId || "";
            },

            applyDefaultDraftTemplate() {
                if (!this.getFirstRegisteredJobsByGroup().length) {
                    this.setSampleFlowState(false);
                    return;
                }
                const selectedSampleNodeId = this.renderSampleFlowCanvas({ showEmptyAlert: false });
                this.setSampleFlowState(Boolean(selectedSampleNodeId));
                if (selectedSampleNodeId) {
                    this.selectFlowNode(selectedSampleNodeId);
                } else {
                    this.clearNodeInspector();
                }
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
                this.resetFlowZoom();
            },

            getFirstRegisteredJobsByGroup() {
                return this.groupRegisteredJobs()
                    .map((group) => group.jobs[0])
                    .filter(Boolean);
            },

            getJobTemplateInsertPoint() {
                const existingBounds = this.getFlowNodeBounds();
                if (existingBounds) {
                    return {
                        left: Math.max(0, existingBounds.right + 80),
                        top: Math.max(0, existingBounds.top)
                    };
                }
                return {
                    left: 72,
                    top: 86
                };
            },

            buildSequentialJobEdge(fromNode, toNode) {
                if (!fromNode || !toNode) return null;
                const fromPort = fromNode.querySelector(".flow-port-out")?.textContent?.trim() || this.getDefaultOutputPort(fromNode.dataset.nodeType || "");
                const toPort = toNode.querySelector(".flow-port-in")?.textContent?.trim() || this.getDefaultInputPort(toNode.dataset.nodeType || "");
                if (!fromPort || !toPort) return null;
                return {
                    from: fromNode.dataset.nodeId || "",
                    fromPort: this.normalizeFlowPortName(fromPort, "output"),
                    to: toNode.dataset.nodeId || "",
                    toPort: this.normalizeFlowPortName(toPort, "input"),
                    dashed: false,
                    mode: "SERIAL",
                    params: this.buildDefaultEdgeParams(fromNode, toNode, toPort, false)
                };
            },

            clearFlowCanvas() {
                if (!this.getFlowNodes().length && !this.flowEdges.length) {
                    return;
                }
                this.getFlowNodes().forEach((node) => node.remove());
                this.flowEdges = [];
                this.selectedNodeId = "";
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                this.clearNodeInspector();
                this.setSampleFlowState(false);
                const label = getContainerEl(`#selectedFlowLabel-${PAGE_CODE}`);
                if (label) label.textContent = "캔버스가 비었습니다. 왼쪽 작업을 끌어오거나 캔버스 메뉴에서 노드를 추가해 Flow를 구성하세요.";
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
            },

            clearNodeInspector() {
                this.setValue(`#nodeId-${PAGE_CODE}`, "");
                this.setValue(`#nodeType-${PAGE_CODE}`, "");
                this.setValue(`#nodeName-${PAGE_CODE}`, "");
                this.setValue(`#nodeUseYn-${PAGE_CODE}`, "Y");
                this.setValue(`#nodeOwnerName-${PAGE_CODE}`, "");
                this.setValue(`#nodeTableName-${PAGE_CODE}`, "");
                this.setResultTableFields("", "", "");
                this.setValue(`#nodeDependsOn-${PAGE_CODE}`, "");
                this.setValue(`#nodeExecPlsqlEditor-${PAGE_CODE}`, "");
                this.renderNodeBindVariables(null);
            },

            markFlowEdited() {
                if (this.isSampleFlowVisible) {
                    this.setSampleFlowState(false);
                }
            },

            teardownFlowDesigner() {
                const stage = getContainerEl(`#flowCanvas-${PAGE_CODE}`);
                if (stage) {
                    if (this.flowCanvasWheelBound) stage.removeEventListener("wheel", this.flowCanvasWheelBound);
                    if (this.flowCanvasPointerDownBound) stage.removeEventListener("pointerdown", this.flowCanvasPointerDownBound);
                    if (this.flowCanvasDragOverBound) stage.removeEventListener("dragover", this.flowCanvasDragOverBound);
                    if (this.flowCanvasDropBound) stage.removeEventListener("drop", this.flowCanvasDropBound);
                    if (this.flowCanvasContextMenuBound) stage.removeEventListener("contextmenu", this.flowCanvasContextMenuBound);
                    stage.classList.remove("is-panning");
                }
                if (this.flowNodePointerMoveBound) document.removeEventListener("pointermove", this.flowNodePointerMoveBound);
                if (this.flowNodePointerUpBound) document.removeEventListener("pointerup", this.flowNodePointerUpBound);
                if (this.flowCanvasPointerMoveBound) document.removeEventListener("pointermove", this.flowCanvasPointerMoveBound);
                if (this.flowCanvasPointerUpBound) document.removeEventListener("pointerup", this.flowCanvasPointerUpBound);
                if (this.flowDocumentClickBound) document.removeEventListener("click", this.flowDocumentClickBound);
                if (this.flowDocumentKeydownBound) document.removeEventListener("keydown", this.flowDocumentKeydownBound);
                getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`)?.removeEventListener("click", this.flowMenuClickBound);
                getContainerEl(`#flowCanvasViewport-${PAGE_CODE}`)?.querySelector(".flow-edge-layer")?.removeEventListener("click", this.flowEdgeLayerClickBound);
                this.flowNodePointerMoveBound = null;
                this.flowNodePointerUpBound = null;
                this.flowCanvasPointerMoveBound = null;
                this.flowCanvasPointerUpBound = null;
                this.flowCanvasWheelBound = null;
                this.flowCanvasPointerDownBound = null;
                this.flowCanvasDragOverBound = null;
                this.flowCanvasDropBound = null;
                this.flowCanvasContextMenuBound = null;
                this.flowMenuClickBound = null;
                this.flowDocumentClickBound = null;
                this.flowDocumentKeydownBound = null;
                this.flowEdgeLayerClickBound = null;
                this.flowPaletteDragData = null;
                this.flowContextMenuState = null;
                this.flowDesignerBound = false;
            },

            bindFlowNode(node) {
                if (!node || node.dataset.flowBound === "Y") return;
                node.dataset.flowBound = "Y";
                this.ensureNodeConnectors(node);
                node.addEventListener("pointerdown", (event) => this.handleNodePointerDown(event, node));
                node.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.selectFlowNode(node.dataset.nodeId || "");
                });
                node.addEventListener("dblclick", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.selectFlowNode(node.dataset.nodeId || "");
                    this.setFlowInspectorCollapsed(false);
                });
                this.bindFlowPorts(node);
            },

            ensureNodeConnectors(node) {
                if (!node.querySelector(".flow-connector-in")) {
                    const input = document.createElement("button");
                    input.type = "button";
                    input.className = "flow-connector flow-connector-in";
                    input.title = "Connect to this node";
                    input.dataset.connectorType = "in";
                    input.setAttribute("aria-label", "Input connector");
                    node.appendChild(input);
                }
                if (!node.querySelector(".flow-connector-out")) {
                    const output = document.createElement("button");
                    output.type = "button";
                    output.className = "flow-connector flow-connector-out";
                    output.title = "Start connection";
                    output.dataset.connectorType = "out";
                    output.setAttribute("aria-label", "Output connector");
                    node.appendChild(output);
                }
                node.querySelector(".flow-connector-in")?.classList.remove("is-hidden");
                node.querySelector(".flow-connector-out")?.classList.remove("is-hidden");
                node.querySelectorAll(".flow-connector").forEach((connector) => {
                    if (connector.dataset.flowConnectorBound === "Y") return;
                    connector.dataset.flowConnectorBound = "Y";
                    connector.addEventListener("click", (event) => this.handleConnectorClick(event, connector));
                    connector.addEventListener("pointerdown", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    });
                    connector.addEventListener("pointerenter", () => {
                        if (this.edgeDragState && connector.dataset.connectorType === "in") {
                            connector.classList.add("is-connect-target");
                        }
                    });
                    connector.addEventListener("pointerleave", () => connector.classList.remove("is-connect-target"));
                });
            },

            bindFlowPorts(node) {
                node.querySelectorAll(".flow-port").forEach((port) => {
                    if (port.dataset.flowPortBound === "Y") return;
                    port.dataset.flowPortBound = "Y";
                    port.addEventListener("pointerdown", (event) => this.handlePortPointerDown(event, port));
                    port.addEventListener("pointerup", (event) => this.handlePortPointerUp(event, port));
                    port.addEventListener("pointerenter", () => {
                        if (this.edgeDragState && port.classList.contains("flow-port-in")) {
                            port.classList.add("is-connect-target");
                        }
                    });
                    port.addEventListener("pointerleave", () => {
                        port.classList.remove("is-connect-target");
                    });
                });
            },

            bindFlowPalette() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                container.querySelectorAll(".flow-palette-job").forEach((item) => {
                    if (item.dataset.flowPaletteBound === "Y") return;
                    item.dataset.flowPaletteBound = "Y";
                    item.addEventListener("dragstart", (event) => {
                        this.flowPaletteDragData = this.getFlowPaletteItemData(item);
                        event.dataTransfer?.setData("text/plain", JSON.stringify(this.flowPaletteDragData));
                        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
                    });
                    item.addEventListener("dblclick", (event) => {
                        event.preventDefault();
                        this.createPaletteNodeAtCanvasCenter(item);
                    });
                });
            },

            getFlowPaletteItemData(item) {
                const title = item.querySelector("strong")?.textContent?.trim() || "New node";
                const subtitle = item.querySelector(".flow-palette-job-meta span:last-child")?.textContent?.trim()
                    || item.querySelector("small")?.textContent?.trim()
                    || "";
                const fallbackData = {
                    nodeType: item.dataset.nodeType || "JOB",
                    nodeTypeLabel: item.dataset.nodeTypeLabel || "",
                    jobId: item.dataset.jobId || "",
                    refMenuCode: item.dataset.refMenuCode || "",
                    ownerName: item.dataset.ownerName || "",
                    tableName: item.dataset.tableName || "",
                    refObjectId: item.dataset.refObjectId || "",
                    title,
                    subtitle
                };
                return this.buildFlowNodeDataFromJob(
                    this.getRegisteredJobAsset(item.dataset.jobId || ""),
                    fallbackData
                );
            },

            async resolveLatestFlowNodeData(data) {
                const jobId = String(data?.jobId || data?.refWorkJobId || "").trim();
                if (!jobId) return data;
                const cachedJob = this.getRegisteredJobAsset(jobId);
                if (cachedJob) {
                    return this.buildFlowNodeDataFromJob(cachedJob, data);
                }
                await this.loadRegisteredJobs();
                const latestJob = this.getRegisteredJobAsset(jobId);
                return latestJob ? this.buildFlowNodeDataFromJob(latestJob, data) : data;
            },

            getFlowStage() {
                return getContainerEl(`#flowCanvas-${PAGE_CODE}`);
            },

            getFlowViewport() {
                return getContainerEl(`#flowCanvasViewport-${PAGE_CODE}`);
            },

            escapeCssIdentifier(value) {
                if (window.CSS && typeof window.CSS.escape === "function") {
                    return window.CSS.escape(String(value || ""));
                }
                return String(value || "").replace(/["\\]/g, "\\$&");
            },

            getFlowNode(nodeId) {
                return this.getFlowViewport()?.querySelector(`.flow-node[data-node-id="${this.escapeCssIdentifier(nodeId)}"]`) || null;
            },

            getFlowNodes() {
                return Array.from(this.getFlowViewport()?.querySelectorAll(".flow-node") || []);
            },

            getNodePosition(node) {
                return {
                    left: Number.parseFloat(node.style.left || "0") || 0,
                    top: Number.parseFloat(node.style.top || "0") || 0,
                    width: node.offsetWidth || 170,
                    height: node.offsetHeight || 112
                };
            },

            getNodeConnectorPoint(node, connectorType) {
                const connector = node?.querySelector(connectorType === "in" ? ".flow-connector-in" : ".flow-connector-out");
                const viewport = this.getFlowViewport();
                if (connector && viewport) {
                    const connectorRect = connector.getBoundingClientRect();
                    const viewportRect = viewport.getBoundingClientRect();
                    const zoom = this.flowZoom || 1;
                    const edgeX = connectorType === "in" ? connectorRect.left : connectorRect.right;
                    return {
                        x: (edgeX - viewportRect.left) / zoom,
                        y: (connectorRect.top + connectorRect.height / 2 - viewportRect.top) / zoom
                    };
                }
                const position = this.getNodePosition(node);
                return {
                    x: connectorType === "in" ? position.left : position.left + position.width,
                    y: position.top + position.height / 2
                };
            },

            setNodePosition(node, left, top) {
                const safeLeft = Math.max(0, Math.round(left));
                const safeTop = Math.max(0, Math.round(top));
                node.style.left = `${safeLeft}px`;
                node.style.top = `${safeTop}px`;
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
            },

            handleNodePointerDown(event, node) {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                this.hideCanvasContextMenu();
                this.selectFlowNode(node.dataset.nodeId || "");

                const position = this.getNodePosition(node);
                this.nodeDragState = {
                    node,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    startLeft: position.left,
                    startTop: position.top
                };
                node.classList.add("is-dragging");
                node.setPointerCapture?.(event.pointerId);
            },

            handleNodePointerMove(event) {
                if (!this.nodeDragState) return;
                const deltaX = (event.clientX - this.nodeDragState.startX) / this.flowZoom;
                const deltaY = (event.clientY - this.nodeDragState.startY) / this.flowZoom;
                this.setNodePosition(
                    this.nodeDragState.node,
                    this.nodeDragState.startLeft + deltaX,
                    this.nodeDragState.startTop + deltaY
                );
            },

            handleNodePointerUp(event) {
                if (!this.nodeDragState) return;
                this.nodeDragState.node.classList.remove("is-dragging");
                this.nodeDragState.node.releasePointerCapture?.(event.pointerId);
                this.nodeDragState = null;
            },

            handleConnectorClick(event, connector) {
                event.preventDefault();
                event.stopPropagation();
                const node = connector.closest(".flow-node");
                if (!node) return;
                const nodeId = node.dataset.nodeId || "";
                const connectorType = connector.dataset.connectorType;

                if (connectorType === "out") {
                    if (this.edgeDragState?.fromNodeId === nodeId) {
                        this.finishEdgeDrag();
                        return;
                    }
                    this.startEdgeConnection(nodeId, this.getDefaultOutputPort(node.dataset.nodeType || ""), connector, "click", event.shiftKey);
                    this.updateConnectionPreviewFromPoint(this.getNodeConnectorPoint(node, "out"));
                    return;
                }

                if (connectorType === "in" && this.edgeDragState) {
                    if (nodeId && nodeId !== this.edgeDragState.fromNodeId) {
                        this.addFlowEdge({
                            from: this.edgeDragState.fromNodeId,
                            fromPort: this.edgeDragState.fromPort,
                            to: nodeId,
                            toPort: this.getDefaultInputPort(node.dataset.nodeType || "") || "input",
                            dashed: this.edgeDragState.dashed,
                            mode: this.edgeDragState.dashed ? "ON_COMPLETE" : "SERIAL",
                            params: this.buildDefaultEdgeParams(this.getFlowNode(this.edgeDragState.fromNodeId), node, this.getDefaultInputPort(node.dataset.nodeType || "") || "input", this.edgeDragState.dashed)
                        });
                        this.selectFlowNode(nodeId);
                    }
                    this.finishEdgeDrag();
                }
            },

            startEdgeConnection(fromNodeId, fromPort, connector = null, mode = "click", forceDashed = false) {
                this.hideCanvasContextMenu();
                this.hideSelectedEdgeDelete();
                this.selectedEdgeId = "";
                this.selectFlowNode(fromNodeId);
                const dashed = Boolean(forceDashed || this.dashedConnectionMode);
                this.edgeDragState = {
                    fromNodeId,
                    fromPort: fromPort || "output",
                    mode,
                    dashed
                };
                connector?.classList.add("is-connecting");
            },

            handlePortPointerDown(event, port) {
                if (event.button !== 0 || !port.classList.contains("flow-port-out")) return;
                event.preventDefault();
                event.stopPropagation();
                const node = port.closest(".flow-node");
                if (!node) return;
                this.startEdgeConnection(node.dataset.nodeId || "", this.getFlowPortName(port), node.querySelector(".flow-connector-out"), "drag", event.shiftKey);
                port.classList.add("is-connecting");
                this.updateConnectionPreview(event);
            },

            handlePortPointerUp(event, port) {
                if (!this.edgeDragState || !port.classList.contains("flow-port-in")) return;
                event.preventDefault();
                event.stopPropagation();
                const targetNode = port.closest(".flow-node");
                if (!targetNode) return;
                const toNodeId = targetNode.dataset.nodeId || "";
                const toPort = this.getFlowPortName(port);
                if (toNodeId && toNodeId !== this.edgeDragState.fromNodeId) {
                    this.addFlowEdge({
                        from: this.edgeDragState.fromNodeId,
                        fromPort: this.edgeDragState.fromPort,
                        to: toNodeId,
                        toPort,
                        dashed: this.edgeDragState.dashed,
                        mode: this.edgeDragState.dashed ? "ON_COMPLETE" : "SERIAL",
                        params: this.buildDefaultEdgeParams(this.getFlowNode(this.edgeDragState.fromNodeId), targetNode, toPort, this.edgeDragState.dashed)
                    });
                    this.selectFlowNode(toNodeId);
                }
                this.finishEdgeDrag();
            },

            updateConnectionPreview(event) {
                if (!this.edgeDragState) return;
                this.updateConnectionPreviewFromPoint(this.getCanvasPointFromEvent(event));
            },

            updateConnectionPreviewFromPoint(point) {
                if (!this.edgeDragState) return;
                const edgeLayer = this.getFlowViewport()?.querySelector(".flow-edge-layer");
                const fromNode = this.getFlowNode(this.edgeDragState.fromNodeId);
                if (!edgeLayer || !fromNode) return;
                const start = this.getNodeConnectorPoint(fromNode, "out");
                const startX = start.x;
                const startY = start.y;
                const endX = point.left;
                const endY = point.top;
                const curve = Math.max(70, Math.abs(endX - startX) / 2);
                const d = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
                let preview = edgeLayer.querySelector(".flow-connection-preview");
                if (!preview) {
                    preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    preview.classList.add("flow-connection-preview");
                    preview.setAttribute("fill", "none");
                    preview.setAttribute("stroke-width", "2");
                    edgeLayer.appendChild(preview);
                }
                preview.setAttribute("stroke", this.edgeDragState.dashed ? "#94a3b8" : "#2563eb");
                preview.setAttribute("stroke-dasharray", this.edgeDragState.dashed ? "6 5" : "");
                preview.setAttribute("d", d);
            },

            finishEdgeDrag() {
                this.getFlowViewport()?.querySelectorAll(".flow-port").forEach((port) => {
                    port.classList.remove("is-connecting", "is-connect-target");
                });
                this.getFlowViewport()?.querySelectorAll(".flow-connector").forEach((connector) => {
                    connector.classList.remove("is-connecting", "is-connect-target");
                });
                this.getFlowViewport()?.querySelector(".flow-connection-preview")?.remove();
                this.edgeDragState = null;
            },

            getFlowPortName(port) {
                return port?.dataset?.portName || port?.querySelector?.(".flow-port-name")?.textContent?.trim() || port?.textContent?.trim() || "";
            },

            handleCanvasPointerDown(event) {
                if (event.button !== 0 || event.target.closest?.(".flow-node")) return;
                if (event.target.closest?.(".flow-edge-path, .flow-edge-hit-path, .flow-edge-delete")) return;
                this.clearSelectedFlowEdge();
                const stage = this.getFlowStage();
                if (!stage) return;
                this.canvasPanState = {
                    startX: event.clientX,
                    startY: event.clientY,
                    startScrollLeft: stage.scrollLeft,
                    startScrollTop: stage.scrollTop
                };
                stage.classList.add("is-panning");
            },

            handleCanvasPointerMove(event) {
                if (this.edgeDragState) {
                    this.updateConnectionPreview(event);
                    return;
                }
                if (!this.canvasPanState) return;
                const stage = this.getFlowStage();
                if (!stage) return;
                stage.scrollLeft = this.canvasPanState.startScrollLeft - (event.clientX - this.canvasPanState.startX);
                stage.scrollTop = this.canvasPanState.startScrollTop - (event.clientY - this.canvasPanState.startY);
            },

            handleCanvasPointerUp() {
                if (this.edgeDragState) {
                    if (this.edgeDragState.mode !== "click") {
                        this.finishEdgeDrag();
                    }
                    return;
                }
                if (!this.canvasPanState) return;
                this.canvasPanState = null;
                this.getFlowStage()?.classList.remove("is-panning");
            },

            handleCanvasWheel(event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                this.zoomFlow(event.deltaY < 0 ? 1 : -1);
            },

            handleEdgeLayerClick(event) {
                const path = event.target.closest?.(".flow-edge-path, .flow-edge-hit-path");
                if (!path) return;
                event.preventDefault();
                event.stopPropagation();
                this.selectFlowEdge(path.dataset.edgeId || "");
            },

            handleFlowKeydown(event) {
                if (event.key === "Escape" && document.getElementById(`flowNodeRunParamsLayer-${PAGE_CODE}`)?.hidden === false) {
                    this.closeNodeRunParamsLayer();
                    return;
                }
                if (event.key === "Escape" && this.isFlowSwitcherOpen()) {
                    this.closeFlowSwitcher();
                    return;
                }
                if (event.key === "Escape" && this.edgeDragState) {
                    this.finishEdgeDrag();
                    return;
                }
                if ((event.key === "Delete" || event.key === "Backspace") && (this.selectedEdgeId || this.selectedNodeId)) {
                    const activeTag = document.activeElement?.tagName?.toLowerCase();
                    if (["input", "textarea", "select"].includes(activeTag)) return;
                    event.preventDefault();
                    if (this.selectedEdgeId) {
                        this.removeSelectedEdge();
                    } else {
                        this.removeSelectedNode(this.selectedNodeId);
                    }
                }
            },

            handleCanvasDragOver(event) {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            },

            async handleCanvasDrop(event) {
                event.preventDefault();
                const stage = this.getFlowStage();
                if (!stage) return;
                let data = this.flowPaletteDragData;
                if (!data && event.dataTransfer?.getData("text/plain")) {
                    try {
                        data = JSON.parse(event.dataTransfer.getData("text/plain"));
                    } catch (error) {
                        data = null;
                    }
                }
                if (!data) return;
                const rect = stage.getBoundingClientRect();
                const left = (event.clientX - rect.left + stage.scrollLeft) / this.flowZoom;
                const top = (event.clientY - rect.top + stage.scrollTop) / this.flowZoom;
                try {
                    const latestData = await this.resolveLatestFlowNodeData(data);
                    this.appendFlowNode(latestData, left, top);
                } finally {
                    this.flowPaletteDragData = null;
                }
            },

            async createPaletteNodeAtCanvasCenter(item) {
                const point = this.getCanvasVisibleCenterPoint();
                const data = this.getFlowPaletteItemData(item);
                const latestData = await this.resolveLatestFlowNodeData(data);
                this.appendFlowNode(latestData, point.left, point.top);
            },

            getCanvasVisibleCenterPoint() {
                const stage = this.getFlowStage();
                if (!stage) return { left: 80, top: 80 };
                const nodeWidth = 170;
                const nodeHeight = 112;
                return {
                    left: Math.max(0, ((stage.scrollLeft + stage.clientWidth / 2) / this.flowZoom) - nodeWidth / 2),
                    top: Math.max(0, ((stage.scrollTop + stage.clientHeight / 2) / this.flowZoom) - nodeHeight / 2)
                };
            },

            appendFlowNode(data, left, top) {
                const node = this.createFlowNode(data, left, top);
                if (node) {
                    this.markFlowEdited();
                    this.getFlowViewport()?.appendChild(node);
                    this.bindFlowNode(node);
                    this.selectFlowNode(node.dataset.nodeId || "");
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                }
            },

            getCanvasPointFromEvent(event) {
                const stage = this.getFlowStage();
                if (!stage) return { left: 80, top: 80 };
                const rect = stage.getBoundingClientRect();
                return {
                    left: (event.clientX - rect.left + stage.scrollLeft) / this.flowZoom,
                    top: (event.clientY - rect.top + stage.scrollTop) / this.flowZoom
                };
            },

            handleCanvasContextMenu(event) {
                event.preventDefault();
                const stage = this.getFlowStage();
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (!stage || !menu) return;

                const targetNode = event.target.closest?.(".flow-node");
                const point = this.getCanvasPointFromEvent(event);
                if (targetNode) {
                    this.selectFlowNode(targetNode.dataset.nodeId || "");
                }
                this.flowContextMenuState = {
                    nodeId: targetNode?.dataset.nodeId || "",
                    left: point.left,
                    top: point.top
                };

                const stageRect = stage.getBoundingClientRect();
                const x = event.clientX - stageRect.left + stage.scrollLeft;
                const y = event.clientY - stageRect.top + stage.scrollTop;
                menu.style.left = `${Math.max(8, x)}px`;
                menu.style.top = `${Math.max(8, y)}px`;
                menu.hidden = false;
                this.updateContextMenuState();
            },

            updateContextMenuState() {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (!menu) return;
                const hasNode = Boolean(this.flowContextMenuState?.nodeId || this.selectedNodeId);
                menu.querySelectorAll('[data-flow-menu-action="runSelectedNode"], [data-flow-menu-action="runFromSelectedNode"], [data-flow-menu-action="duplicateNode"], [data-flow-menu-action="deleteNode"]').forEach((button) => {
                    button.classList.toggle("is-disabled", !hasNode);
                    button.disabled = !hasNode;
                });
                this.renderDashedConnectionMode();
            },

            hideCanvasContextMenu() {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (menu) menu.hidden = true;
            },

            async handleContextMenuClick(event) {
                const button = event.target.closest?.("[data-flow-menu-action]");
                if (!button || button.disabled) return;
                event.preventDefault();
                event.stopPropagation();
                const action = button.dataset.flowMenuAction;
                await this.runContextMenuAction(action);
                if (action !== "toggleDashedConnection") {
                    this.hideCanvasContextMenu();
                }
            },

            async runContextMenuAction(action) {
                const actions = {
                    runSelectedNode: () => this.runSelectedNode(),
                    runFromSelectedNode: () => this.runSelectedNode({ downstream: true }),
                    duplicateNode: () => this.duplicateSelectedNode(),
                    deleteNode: () => this.removeSelectedNode(),
                    toggleDashedConnection: () => this.toggleDashedConnectionMode(),
                    autoLayout: () => this.autoLayoutFlow(),
                    treeLayout: () => this.autoLayoutFlow(),
                    fitCanvas: () => this.fitFlowCanvas(),
                    resetZoom: () => this.resetFlowZoom()
                };
                await actions[action]?.();
            },

            toggleDashedConnectionMode() {
                this.dashedConnectionMode = !this.dashedConnectionMode;
                this.renderDashedConnectionMode();
                this.applyFlowZoom();
            },

            renderDashedConnectionMode() {
                const button = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`)?.querySelector('[data-flow-menu-action="toggleDashedConnection"]');
                if (!button) return;
                button.classList.toggle("is-active", this.dashedConnectionMode);
                const label = button.querySelector("span");
                if (label) {
                    label.textContent = `Dashed on-complete: ${this.dashedConnectionMode ? "ON" : "OFF"}`;
                }
            },

            createContextNode(nodeType, title, subtitle) {
                const point = this.flowContextMenuState || { left: 80, top: 80 };
                const node = this.createFlowNode({ nodeType, title, subtitle }, point.left, point.top);
                if (!node) return;
                this.markFlowEdited();
                this.getFlowViewport()?.appendChild(node);
                this.bindFlowNode(node);
                this.selectFlowNode(node.dataset.nodeId || "");
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
            },

            createFlowNode(data, left, top) {
                const nodeType = data.nodeType || "JOB";
                const nodeTypeLabel = data.nodeTypeLabel || this.getNodeTypeLabel(nodeType);
                const nodeId = `${String(nodeType).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${this.nodeSequence++}`;
                const inputHtml = this.renderNodePortSpans(this.getRenderInputPorts(nodeType, data), "in", "TABLE");
                const outputHtml = this.renderNodePortSpans(
                    this.getRenderOutputPorts(nodeType, data),
                    "out",
                    this.getNodeOutputAssetKind(data)
                );
                const article = document.createElement("article");
                article.id = `flowNode-${PAGE_CODE}-${nodeId}`;
                article.className = "data-param-card flow-node flow-node-step";
                article.dataset.nodeId = nodeId;
                article.dataset.nodeType = nodeType;
                article.dataset.nodeTypeLabel = nodeTypeLabel;
                article.dataset.refWorkJobId = data.jobId || data.refWorkJobId || "";
                article.dataset.refMenuCode = data.refMenuCode || "";
                article.dataset.ownerName = data.ownerName || "";
                article.dataset.tableName = data.tableName || "";
                article.dataset.refObjectId = data.refObjectId || "";
                article.dataset.resultCreateYn = this.normalizeResultCreateMode(data.resultCreateYn || "N");
                article.dataset.resultOwner = data.resultOwner || "";
                article.dataset.resultTableName = data.resultTableName || "";
                article.dataset.execSourceType = data.execSourceType || "DB_OBJECT";
                article.dataset.execResourceId = data.execResourceId || "";
                article.dataset.execMethod = data.execMethod || "";
                article.dataset.execSpecJson = data.execSpecJson || "";
                article.dataset.execPlsql = data.execPlsql || "";
                article.dataset.nodeParams = this.stringifyNodeJson(data.params || []);
                article.dataset.useYn = String(data.useYn || "Y").toUpperCase() === "N" ? "N" : "Y";
                article.style.position = "absolute";
                article.style.left = `${Math.max(0, Math.round(left))}px`;
                article.style.top = `${Math.max(0, Math.round(top))}px`;
                article.style.width = "170px";
                article.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong title="${this.escapeHtml(nodeTypeLabel)}">${this.escapeHtml(nodeTypeLabel)}</strong>
                        <span class="data-job-order">NEW</span>
                    </header>
                    <div class="flow-node-body">
                        <strong>${this.escapeHtml(data.title || "New node")}</strong>
                        <small>${this.escapeHtml(data.subtitle || data.jobId || "Manual node")}</small>
                    </div>
                    <footer class="flow-node-ports">
                        ${inputHtml}
                        ${outputHtml}
                    </footer>
                `;
                this.applyNodeUseState(article);
                return article;
            },

            createSavedFlowNode(data) {
                const nodeType = data.nodeType || "JOB";
                const nodeTypeLabel = data.nodeTypeLabel || this.getNodeTypeLabel(nodeType);
                const refJob = this.getRegisteredJobAsset(data.refWorkJobId || "");
                const nodeId = data.nodeKey || `${String(nodeType).toLowerCase()}-${this.nodeSequence++}`;
                const inputHtml = this.renderNodePortSpans(this.getRenderInputPorts(nodeType, data), "in", "TABLE");
                const outputHtml = this.renderNodePortSpans(
                    this.getRenderOutputPorts(nodeType, data, refJob),
                    "out",
                    this.getNodeOutputAssetKind(data, refJob)
                );
                const article = document.createElement("article");
                article.id = `flowNode-${PAGE_CODE}-${nodeId}`;
                article.className = "data-param-card flow-node flow-node-step";
                article.dataset.nodeId = nodeId;
                article.dataset.nodeType = nodeType;
                article.dataset.nodeTypeLabel = nodeTypeLabel;
                article.dataset.refWorkJobId = data.refWorkJobId || "";
                article.dataset.refMenuCode = data.refMenuCode || "";
                article.dataset.execSourceType = data.execSourceType || refJob?.EXEC_SOURCE_TYPE || "DB_OBJECT";
                article.dataset.execResourceId = data.execResourceId || refJob?.EXEC_RESOURCE_ID || "";
                article.dataset.execMethod = data.execMethod || refJob?.EXEC_METHOD || "";
                article.dataset.execSpecJson = data.execSpecJson || refJob?.EXEC_SPEC_JSON || "";
                article.dataset.ownerName = data.ownerName || "";
                article.dataset.tableName = data.tableName || "";
                article.dataset.refObjectId = data.refObjectId || "";
                article.dataset.resultCreateYn = this.normalizeResultCreateMode(data.resultCreateYn || refJob?.RESULT_CREATE_YN || "N");
                article.dataset.resultOwner = data.resultOwner || refJob?.RESULT_OWNER || "";
                article.dataset.resultTableName = data.resultTableName || refJob?.RESULT_TABLE_NAME || "";
                article.dataset.execPlsql = data.execPlsql || "";
                article.dataset.nodeParams = this.stringifyNodeJson(data.params || []);
                article.dataset.useYn = String(data.useYn || "Y").toUpperCase() === "N" ? "N" : "Y";
                article.style.position = "absolute";
                article.style.left = `${Math.max(0, Math.round(Number(data.positionLeft) || 0))}px`;
                article.style.top = `${Math.max(0, Math.round(Number(data.positionTop) || 0))}px`;
                article.style.width = `${Math.max(150, Math.round(Number(data.nodeWidth) || 170))}px`;
                article.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong title="${this.escapeHtml(nodeTypeLabel)}">${this.escapeHtml(nodeTypeLabel)}</strong>
                        <span class="data-job-order">${this.escapeHtml(data.refMenuCode || data.sortOrder || "NODE")}</span>
                    </header>
                    <div class="flow-node-body">
                        <strong>${this.escapeHtml(data.nodeName || nodeId)}</strong>
                        <small>${this.escapeHtml(data.nodeDesc || data.refMenuCode || "Saved node")}</small>
                    </div>
                    <footer class="flow-node-ports">
                        ${inputHtml}
                        ${outputHtml}
                    </footer>
                `;
                this.applyNodeUseState(article);
                return article;
            },

            applyNodeUseState(node) {
                if (!node) return;
                const disabled = String(node.dataset.useYn || "Y").toUpperCase() === "N";
                node.classList.toggle("is-node-disabled", disabled);
                node.setAttribute("data-node-use-yn", disabled ? "N" : "Y");
            },

            renderNodePortSpans(ports, direction, assetKind = "TABLE") {
                const className = direction === "in" ? "flow-port-in" : "flow-port-out";
                const normalizedKind = this.normalizeFlowAssetKind(assetKind);
                if (direction === "out" && normalizedKind === "NONE") {
                    return this.renderFlowPortInfo("out", "NONE", false);
                }
                return (ports || [])
                    .filter((port) => String(port || "").trim())
                    .map((port) => {
                        const label = this.escapeHtml(port);
                        const directionLabel = direction === "in" ? "Input" : "Output";
                        return this.renderFlowPortInfo(direction, normalizedKind, true, className, label, directionLabel);
                    })
                    .join("");
            },

            renderFlowPortInfo(direction, assetKind, connectable = true, className = "", portLabel = "", directionLabel = "") {
                const kind = this.normalizeFlowAssetKind(assetKind);
                const directionText = direction === "in" ? "IN" : "OUT";
                const kindText = kind === "MODEL" ? "model" : kind === "NONE" ? "none" : "table";
                const iconClass = kind === "MODEL" ? "fas fa-brain" : kind === "NONE" ? "fas fa-minus" : "fas fa-table";
                const title = `${directionLabel || directionText}: ${kindText}${portLabel ? ` (${portLabel})` : ""}`;
                const classes = [
                    connectable ? "flow-port" : "flow-port-info",
                    className,
                    `is-${kindText}`
                ].filter(Boolean).join(" ");
                const dataPortName = connectable ? ` data-port-name="${this.escapeHtml(portLabel)}"` : "";
                return `
                    <span class="${classes}"${dataPortName} title="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">
                        <em>${directionText}</em>
                        <i class="${iconClass}" aria-hidden="true"></i>
                        ${connectable ? `<span class="flow-port-name">${portLabel}</span>` : ""}
                    </span>
                `;
            },

            getNodeOutputAssetKind(data = {}, refJob = null) {
                const mode = this.normalizeResultCreateMode(data.resultCreateYn || refJob?.RESULT_CREATE_YN || "N");
                if (mode === "M") return "MODEL";
                if (mode === "T") return "TABLE";
                return "NONE";
            },

            normalizeFlowAssetKind(value) {
                const kind = String(value || "").trim().toUpperCase();
                if (kind === "M" || kind === "MODEL") return "MODEL";
                if (kind === "N" || kind === "NONE") return "NONE";
                return "TABLE";
            },

            getRenderInputPorts(nodeType, data = {}) {
                const explicitPorts = this.normalizePortNames(data.inputs, "input");
                if (explicitPorts.length) return explicitPorts;
                const defaultPort = this.getDefaultInputPort(nodeType);
                return defaultPort ? [defaultPort] : [];
            },

            getRenderOutputPorts(nodeType, data = {}, refJob = null) {
                const explicitPorts = this.normalizePortNames(data.outputs, "output");
                const resultCreateMode = this.normalizeResultCreateMode(data.resultCreateYn || refJob?.RESULT_CREATE_YN || "N");
                if (resultCreateMode === "N") {
                    return [];
                }
                return explicitPorts.length ? explicitPorts : [this.getDefaultOutputPort(nodeType)];
            },

            normalizeResultCreateMode(value) {
                const mode = String(value || "N").trim().toUpperCase();
                if (mode === "Y") return "T";
                return ["N", "T", "M"].includes(mode) ? mode : "N";
            },

            normalizePortNames(ports, fallback = "") {
                if (!Array.isArray(ports)) return [];
                const names = ports
                    .map((port) => this.normalizeFlowPortName(port?.port || port?.name || port || "", fallback))
                    .filter(Boolean);
                return Array.from(new Set(names));
            },

            normalizeFlowPortName(portName, fallback = "input") {
                const value = String(portName || "").trim();
                const normalized = value.toLowerCase();
                if (normalized === "input" || normalized.endsWith("input")) return "input";
                if (normalized === "output" || normalized.endsWith("output")) return "output";
                if (!value) return fallback;
                return fallback === "input" ? "input" : "output";
            },

            isFlowSourceNodeType(nodeType) {
                return false;
            },

            getDefaultInputPort(nodeType) {
                return "input";
            },

            getDefaultOutputPort(nodeType) {
                return "output";
            },

            buildDefaultEdgeParams(fromNode, toNode, toPort = "input", dashed = false) {
                if (!fromNode || !toNode || dashed) return {};
                const hasResultTable = this.normalizeResultCreateMode(fromNode.dataset.resultCreateYn || "") === "T"
                    && Boolean(fromNode.dataset.resultOwner && fromNode.dataset.resultTableName);
                if (!hasResultTable) return {};
                return {
                    inputSource: "UPSTREAM_RESULT",
                    fromNodeKey: fromNode.dataset.nodeId || "",
                    toNodeKey: toNode.dataset.nodeId || "",
                    toPort: toPort || "input",
                    bindTo: {
                        targetOwner: "$from.resultOwner",
                        targetTable: "$from.resultTableName",
                        inputOwner: "$from.resultOwner",
                        inputTable: "$from.qualifiedTable",
                        INPUT_TABLE: "$from.quotedTable"
                    }
                };
            },

            getEdgeParams(edge) {
                if (edge?.params && Object.keys(edge.params).length) return edge.params;
                return this.buildDefaultEdgeParams(
                    this.getFlowNode(edge?.from || ""),
                    this.getFlowNode(edge?.to || ""),
                    edge?.toPort || "input",
                    Boolean(edge?.dashed)
                );
            },

            duplicateSelectedNode() {
                const source = this.getFlowNode(this.flowContextMenuState?.nodeId || this.selectedNodeId);
                if (!source) return;
                const position = this.getNodePosition(source);
                const clone = source.cloneNode(true);
                const sourceNodeId = source.dataset.nodeId || "node";
                const cloneNodeId = `${sourceNodeId}-copy-${this.nodeSequence++}`;
                this.markFlowEdited();
                clone.id = `flowNode-${PAGE_CODE}-${cloneNodeId}`;
                clone.dataset.nodeId = cloneNodeId;
                clone.dataset.flowBound = "";
                clone.querySelectorAll("[data-flow-connector-bound], [data-flow-port-bound]").forEach((element) => {
                    delete element.dataset.flowConnectorBound;
                    delete element.dataset.flowPortBound;
                });
                clone.classList.remove("is-selected", "is-dragging");
                clone.style.left = `${position.left + 36}px`;
                clone.style.top = `${position.top + 36}px`;
                this.getFlowViewport()?.appendChild(clone);
                this.bindFlowNode(clone);
                this.selectFlowNode(cloneNodeId);
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
            },

            selectFlowNode(nodeId) {
                this.storeSelectedNodeInspectorState();
                this.selectedNodeId = nodeId || "";
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                this.getFlowNodes().forEach((node) => {
                    node.classList.toggle("is-selected", node.dataset.nodeId === this.selectedNodeId);
                });

                const node = this.getFlowNode(this.selectedNodeId);
                if (!node) return;
                this.setValue(`#nodeId-${PAGE_CODE}`, node.dataset.nodeId || "");
                this.setValue(`#nodeType-${PAGE_CODE}`, node.dataset.nodeType || "");
                this.setValue(`#nodeName-${PAGE_CODE}`, node.querySelector(".flow-node-body strong")?.textContent?.trim() || "");
                this.setValue(`#nodeUseYn-${PAGE_CODE}`, String(node.dataset.useYn || "Y").toUpperCase() === "N" ? "N" : "Y");
                this.setValue(`#nodeOwnerName-${PAGE_CODE}`, node.dataset.ownerName || "");
                this.setValue(`#nodeTableName-${PAGE_CODE}`, node.dataset.tableName || "");
                this.setValue(`#nodeResultCreateYn-${PAGE_CODE}`, this.getResultCreateModeLabel(node.dataset.resultCreateYn || "N"));
                this.setResultTableFields(node.dataset.resultCreateYn, node.dataset.resultOwner, node.dataset.resultTableName);
                this.setValue(`#nodeDependsOn-${PAGE_CODE}`, this.getUpstreamNodeIds(this.selectedNodeId).join(", "));
                this.setValue(`#nodeExecPlsqlEditor-${PAGE_CODE}`, node.dataset.execPlsql || "");
                this.renderNodeBindVariables(node);
            },

            getResultCreateModeLabel(value) {
                const mode = this.normalizeResultCreateMode(value);
                const labels = {
                    N: "N (사용안함)",
                    T: "T (테이블사용)",
                    M: "M (모델사용)"
                };
                return labels[mode] || labels.N;
            },

            setResultTableFields(resultCreateYn, resultOwner, resultTableName) {
                const visible = this.normalizeResultCreateMode(resultCreateYn) !== "N";
                const ownerWrap = getContainerEl(`#nodeResultOwnerWrap-${PAGE_CODE}`);
                const tableWrap = getContainerEl(`#nodeResultTableWrap-${PAGE_CODE}`);
                if (ownerWrap) ownerWrap.style.display = visible ? "" : "none";
                if (tableWrap) tableWrap.style.display = visible ? "" : "none";
                this.setValue(`#nodeResultOwner-${PAGE_CODE}`, visible ? resultOwner || "" : "");
                this.setValue(`#nodeResultTableName-${PAGE_CODE}`, visible ? resultTableName || "" : "");
            },

            getUpstreamNodeIds(nodeId) {
                return this.flowEdges
                    .filter((edge) => edge.to === nodeId)
                    .map((edge) => edge.from);
            },

            updateSelectedNodeField(fieldName, value) {
                const node = this.getFlowNode(this.selectedNodeId);
                if (!node) return;
                if (fieldName === "nodeName") {
                    const title = node.querySelector(".flow-node-body strong");
                    if (title) title.textContent = value || "";
                }
                if (fieldName === "nodeType") {
                    node.dataset.nodeType = value || "";
                    node.dataset.nodeTypeLabel = this.getNodeTypeLabel(value);
                    const headerTitle = node.querySelector(".data-param-panel-header strong");
                    if (headerTitle) {
                        const label = this.getNodeTypeLabel(value);
                        headerTitle.textContent = label;
                        headerTitle.title = label;
                    }
                }
                if (fieldName === "ownerName") {
                    node.dataset.ownerName = value || "";
                }
                if (fieldName === "tableName") {
                    node.dataset.tableName = value || "";
                }
                if (fieldName === "useYn") {
                    node.dataset.useYn = String(value || "Y").toUpperCase() === "N" ? "N" : "Y";
                    this.applyNodeUseState(node);
                }
            },

            getValue(selector) {
                return getContainerEl(selector)?.value || "";
            },

            setValue(selector, value) {
                const element = getContainerEl(selector);
                if (element) element.value = value ?? "";
            },

            updateFlowField() {
                this.updateWorkContextSummary();
            },
            handleNodeJobChange() {},

            stringifyNodeJson(value) {
                try {
                    return JSON.stringify(value ?? []);
                } catch {
                    return "[]";
                }
            },

            parseNodeJson(value, fallback = []) {
                try {
                    if (!value) return fallback;
                    const parsed = JSON.parse(value);
                    return parsed ?? fallback;
                } catch {
                    return fallback;
                }
            },

            maskSqlForBindScan(sqlText) {
                return String(sqlText || "")
                    .replace(/'(?:''|[^'])*'/gs, (match) => " ".repeat(match.length))
                    .replace(/"(?:""|[^"])*"/gs, (match) => " ".repeat(match.length))
                    .replace(/\/\*.*?\*\//gs, (match) => " ".repeat(match.length))
                    .replace(/--[^\r\n]*/gm, (match) => " ".repeat(match.length));
            },

            extractBindVariables(sqlText) {
                const masked = this.maskSqlForBindScan(sqlText);
                const names = [];
                const seen = new Set();
                const regex = /(?<!:):([A-Za-z][A-Za-z0-9_$#]*)/g;
                let match;
                while ((match = regex.exec(masked)) !== null) {
                    const name = match[1];
                    const key = name.toLowerCase();
                    if (!seen.has(key)) {
                        seen.add(key);
                        names.push(name);
                    }
                }
                return names;
            },

            getNodePortBindNames(node) {
                return new Set(Array.from(node.querySelectorAll(".flow-port"))
                    .map((port) => port.textContent.trim().toLowerCase())
                    .filter(Boolean));
            },

            getRuntimeBindNamesForNode(node) {
                const portNames = this.getNodePortBindNames(node);
                return this.extractBindVariables(node.dataset.execPlsql || "")
                    .filter((name) => !portNames.has(name.toLowerCase()));
            },

            extractDynamicTokens(sqlText) {
                const names = [];
                const seen = new Set();
                const regex = /\/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*(?:_[A-Za-z0-9_$#]+)*)\s*--\s*\*\//g;
                let match;
                while ((match = regex.exec(String(sqlText || ""))) !== null) {
                    const name = match[1].trim();
                    if (!seen.has(name)) {
                        seen.add(name);
                        names.push(name);
                    }
                }
                return names;
            },

            getRuntimeBindEntriesForNode(node) {
                const portNames = this.getNodePortBindNames(node);
                const script = node?.dataset?.execPlsql || "";
                const entries = [];
                const seen = new Set();
                this.extractBindVariables(script)
                    .filter((name) => !portNames.has(name.toLowerCase()))
                    .forEach((name) => {
                        const key = this.normalizeBindParamKey(name);
                        if (seen.has(key)) return;
                        seen.add(key);
                        entries.push({ name, label: `:${name}` });
                    });
                this.extractDynamicTokens(script).forEach((name) => {
                    const key = this.normalizeBindParamKey(name);
                    if (seen.has(key)) return;
                    seen.add(key);
                    entries.push({ name, label: `/* --${name}-- */` });
                });
                return entries;
            },

            isSystemBindName(name) {
                return Boolean(this.normalizeSystemBindName(name));
            },

            isRunIdSystemBindName(name) {
                const canonicalName = this.normalizeSystemBindName(name);
                return canonicalName === "INIT$RunId" || canonicalName === "INIT$FlowRunId";
            },

            normalizeSystemBindName(name) {
                const aliases = {
                    "INIT$TargetOwner": "INIT$TargetOwner",
                    "INIT$TargetTable": "INIT$TargetTable",
                    "INIT$ResultOwner": "INIT$ResultOwner",
                    "INIT$ResultTable": "INIT$ResultTable",
                    "INIT$ResultModelName": "INIT$ResultModelName",
                    "INIT$PreTargetOwner": "INIT$PreTargetOwner",
                    "INIT$PreTargetTable": "INIT$PreTargetTable",
                    "INIT$PreResultOwner": "INIT$PreResultOwner",
                    "INIT$PreResultTable": "INIT$PreResultTable",
                    "INIT$RunSourceType": "INIT$RunSourceType",
                    "INIT$RunId": "INIT$RunId",
                    "INIT$FlowRunId": "INIT$FlowRunId"
                };
                return aliases[String(name || "")] || "";
            },

            getPreviousNodeForSystemBind(node) {
                const nodeId = node?.dataset?.nodeId || "";
                const incoming = this.flowEdges.find((edge) =>
                    edge.to === nodeId
                    && !edge.dashed
                    && !["REFERENCE", "ON_COMPLETE"].includes(String(edge.mode || "SERIAL").toUpperCase())
                ) || this.flowEdges.find((edge) => edge.to === nodeId);
                return incoming ? this.getFlowNode(incoming.from) : null;
            },

            getSystemBindValue(name, node) {
                const canonicalName = this.normalizeSystemBindName(name);
                const previousNode = this.getPreviousNodeForSystemBind(node);
                const sourceNode = canonicalName.includes("$Pre") ? previousNode : node;
                if (!sourceNode) return "";
                const resultOwner = sourceNode.dataset.resultOwner || "";
                const resultTable = sourceNode.dataset.resultTableName || "";
                const values = {
                    "INIT$TargetOwner": sourceNode.dataset.ownerName || "",
                    "INIT$TargetTable": sourceNode.dataset.tableName || "",
                    "INIT$ResultOwner": resultOwner,
                    "INIT$ResultTable": resultTable,
                    "INIT$ResultModelName": resultTable,
                    "INIT$PreTargetOwner": sourceNode.dataset.ownerName || "",
                    "INIT$PreTargetTable": sourceNode.dataset.tableName || "",
                    "INIT$PreResultOwner": resultOwner,
                    "INIT$PreResultTable": resultTable,
                    "INIT$RunSourceType": "FLOW_WORK",
                    "INIT$RunId": "",
                    "INIT$FlowRunId": ""
                };
                return values[canonicalName] || "";
            },

            getSystemBindComment(name, node) {
                const canonicalName = this.normalizeSystemBindName(name);
                if (canonicalName === "INIT$RunId" || canonicalName === "INIT$FlowRunId") {
                    return "Use (auto) or blank for a new flow run id. Enter an existing flow run id to overwrite that run.";
                }
                if (canonicalName.includes("$Pre") && !this.getPreviousNodeForSystemBind(node)) {
                    return "No upstream node is connected.";
                }
                return "System bind value. It is supplied automatically at run time.";
            },

            getNodeParams(node) {
                const params = this.parseNodeJson(node?.dataset?.nodeParams, []);
                return Array.isArray(params) ? params : [];
            },

            normalizeBindParamKey(value) {
                return String(value || "")
                    .replace(/^:/, "")
                    .replace(/[^A-Za-z0-9]/g, "")
                    .toLowerCase();
            },

            getNodeParamMatchKeys(item) {
                return [
                    item?.name,
                    item?.NAME,
                    item?.label,
                    item?.LABEL,
                    item?.itemName,
                    item?.ITEM_NAME
                ].map((value) => this.normalizeBindParamKey(value)).filter(Boolean);
            },

            buildNodeParamMap(params) {
                const map = new Map();
                (Array.isArray(params) ? params : []).forEach((item) => {
                    this.getNodeParamMatchKeys(item).forEach((key) => {
                        if (!map.has(key)) map.set(key, item);
                    });
                });
                return map;
            },

            getNodeParamComment(item) {
                return String(item?.itemDesc || item?.ITEM_DESC || item?.comment || item?.COMMENT || "");
            },

            getNodeParamDefault(item) {
                return item?.itemDefault ?? item?.ITEM_DEFAULT ?? item?.defaultValue ?? item?.DEFAULT_VALUE ?? "";
            },

            isInputNodeParamDefinition(item = {}) {
                const name = item?.itemName || item?.ITEM_NAME || item?.name || item?.NAME || item?.key || item?.KEY || "";
                if (!String(name || "").trim()) return false;
                const directionText = String(
                    item?.inOut
                    || item?.IN_OUT
                    || item?.direction
                    || item?.DIRECTION
                    || item?.parameterMode
                    || item?.PARAMETER_MODE
                    || item?.itemMode
                    || item?.ITEM_MODE
                    || item?.itemValue
                    || item?.ITEM_VALUE
                    || ""
                ).trim().toUpperCase().replace(/\s+/g, " ");
                if (!directionText) return true;
                return !/^(OUT|OUTPUT|RETURN)\b/.test(directionText);
            },

            hasNodeParamValue(item) {
                return Boolean(item && Object.prototype.hasOwnProperty.call(item, "value"));
            },

            resolveNodeRuntimeDefaultValue(value, node) {
                const text = String(value ?? "").trim();
                const bindMatch = text.match(/^:([A-Za-z][A-Za-z0-9_$#]*)$/);
                if (bindMatch && this.isSystemBindName(bindMatch[1])) {
                    return this.getSystemBindValue(bindMatch[1], node);
                }
                const tokenMatch = text.match(/^\/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*)\s*--\s*\*\/$/);
                if (tokenMatch && this.isSystemBindName(tokenMatch[1])) {
                    return this.getSystemBindValue(tokenMatch[1], node);
                }
                return text;
            },

            getNodeRuntimeBindValue(item, node) {
                if (this.hasNodeParamValue(item)) {
                    return item.value ?? "";
                }
                return this.resolveNodeRuntimeDefaultValue(this.getNodeParamDefault(item), node);
            },

            getNodeRunIdBindValue(item) {
                if (this.hasNodeParamValue(item)) {
                    const value = String(item.value ?? "").trim();
                    return value || "(auto)";
                }
                return "(auto)";
            },

            getNodeRuntimeBindComment(item) {
                const comment = this.getNodeParamComment(item);
                if (comment) return comment;
                if (String(this.getNodeParamDefault(item) ?? "").trim()) {
                    return "Parameter default. You can override it for this node run.";
                }
                return "";
            },

            storeSelectedNodeInspectorState() {
                const node = this.getFlowNode(this.selectedNodeId);
                if (!node) return;
                const editor = getContainerEl(`#nodeExecPlsqlEditor-${PAGE_CODE}`);
                if (editor) node.dataset.execPlsql = editor.value || "";
                const existingParamMap = this.buildNodeParamMap(this.getNodeParams(node));
                const params = [];
                getContainerEl(`#nodeBindGrid-${PAGE_CODE}`)?.querySelectorAll(".flow-node-bind-input").forEach((input) => {
                    const bindName = input.dataset.bindName || "";
                    const existing = existingParamMap.get(this.normalizeBindParamKey(bindName)) || {};
                    params.push({
                        ...existing,
                        name: bindName,
                        label: `:${bindName}`,
                        value: input.value || "",
                        source: existing.source || existing.SOURCE || "RUNTIME"
                    });
                });
                node.dataset.nodeParams = this.stringifyNodeJson(params.filter((item) => item.name));
            },

            updateNodeBindValue(name, value) {
                const node = this.getFlowNode(this.selectedNodeId);
                if (!node || !name) return;
                const params = this.getNodeParams(node);
                const matchKey = this.normalizeBindParamKey(name);
                const existing = params.find((item) => this.getNodeParamMatchKeys(item).includes(matchKey));
                if (existing) {
                    existing.name = existing.name || name;
                    existing.label = existing.label || `:${name}`;
                    existing.value = value || "";
                } else {
                    params.push({ name, label: `:${name}`, value: value || "", source: "RUNTIME" });
                }
                node.dataset.nodeParams = this.stringifyNodeJson(params);
            },

            renderNodeBindVariables(node) {
                const container = getContainerEl(`#nodeBindGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!node) {
                    container.innerHTML = `<div class="table-empty">No runtime bind variables.</div>`;
                    return;
                }
                const entries = this.getRuntimeBindEntriesForNode(node);
                const params = this.getNodeParams(node);
                const paramMap = this.buildNodeParamMap(params);
                if (!entries.length) {
                    container.innerHTML = `<div class="table-empty">No runtime bind variables.</div>`;
                    return;
                }
                container.innerHTML = entries.map(({ name, label }) => {
                    if (this.isSystemBindName(name)) {
                        const value = this.getSystemBindValue(name, node);
                        if (this.isRunIdSystemBindName(name)) {
                            const saved = paramMap.get(this.normalizeBindParamKey(name));
                            return `
                                <label class="data-bind-row flow-system-bind-row">
                                    <span class="data-bind-meta">
                                        <span class="flow-bind-name">${this.escapeHtml(label)}</span>
                                        <small class="flow-bind-comment">${this.escapeHtml(this.getSystemBindComment(name, node))}</small>
                                    </span>
                                    <input class="env-field flow-node-bind-input" data-bind-name="${this.escapeHtml(name)}" type="text" value="${this.escapeHtml(this.getNodeRunIdBindValue(saved))}" oninput="${PAGE_CODE}.updateNodeBindValue(this.dataset.bindName, this.value)">
                                </label>
                            `;
                        }
                        return `
                            <label class="data-bind-row flow-system-bind-row">
                                <span class="data-bind-meta">
                                    <span class="flow-bind-name">${this.escapeHtml(label)}</span>
                                    <small class="flow-bind-comment">${this.escapeHtml(this.getSystemBindComment(name, node))}</small>
                                </span>
                                <input class="env-field" type="text" value="${this.escapeHtml(value || "(auto)")}" readonly>
                            </label>
                        `;
                    }
                    const saved = paramMap.get(this.normalizeBindParamKey(name));
                    const comment = this.getNodeRuntimeBindComment(saved);
                    const value = this.getNodeRuntimeBindValue(saved, node);
                    return `
                        <label class="data-bind-row">
                            <span class="data-bind-meta">
                                <span class="flow-bind-name">${this.escapeHtml(label)}</span>
                                ${comment ? `<small class="flow-bind-comment">${this.escapeHtml(comment)}</small>` : ""}
                            </span>
                            <input class="env-field flow-node-bind-input" data-bind-name="${this.escapeHtml(name)}" type="text" value="${this.escapeHtml(value)}" oninput="${PAGE_CODE}.updateNodeBindValue(this.dataset.bindName, this.value)">
                        </label>
                    `;
                }).join("");
            },

            collectNodePorts(node, direction) {
                const selector = direction === "in" ? ".flow-port-in" : ".flow-port-out";
                const nodeId = node.dataset.nodeId || "";
                const portType = direction === "out"
                    ? this.getNodeOutputAssetKind({ resultCreateYn: node.dataset.resultCreateYn || "N" })
                    : "TABLE";
                return Array.from(node.querySelectorAll(selector)).map((port) => ({
                    port: this.getFlowPortName(port),
                    type: portType,
                    ownerName: node.dataset.ownerName || "",
                    tableName: node.dataset.tableName || "",
                    sourceNodeKey: direction === "in" ? this.findPortSource(nodeId, this.getFlowPortName(port))?.from || "" : "",
                    sourcePort: direction === "in" ? this.findPortSource(nodeId, this.getFlowPortName(port))?.fromPort || "" : "",
                    targetNodeKeys: direction === "out" ? this.findPortTargets(nodeId, this.getFlowPortName(port)).map((edge) => edge.to) : [],
                    targetPorts: direction === "out" ? this.findPortTargets(nodeId, this.getFlowPortName(port)).map((edge) => edge.toPort || "input") : []
                }));
            },

            findPortSource(nodeId, portName) {
                const exact = this.flowEdges.find((edge) =>
                    edge.to === nodeId && String(edge.toPort || "input") === String(portName || "")
                );
                return exact || this.flowEdges.find((edge) => edge.to === nodeId) || null;
            },

            findPortTargets(nodeId, portName) {
                const exact = this.flowEdges.filter((edge) =>
                    edge.from === nodeId && String(edge.fromPort || "output") === String(portName || "")
                );
                return exact.length ? exact : this.flowEdges.filter((edge) => edge.from === nodeId);
            },

            isAutoRunIdValue(value) {
                const text = String(value ?? "").trim().toLowerCase();
                return !text || text === "(auto)" || text === "auto";
            },

            readManualFlowRunIdValue(value) {
                const text = String(value ?? "").trim();
                if (this.isAutoRunIdValue(text)) return "";
                if (!/^[1-9][0-9]*$/.test(text)) {
                    throw new Error("Flow run id must be (auto), blank, or a positive integer.");
                }
                return text;
            },

            getManualFlowRunIdFromPayload(payload, nodeKey = "") {
                const ids = [];
                const runKeys = new Set(["INIT$RunId", "INIT$FlowRunId", "runId", "flowRunId"]);
                (payload?.nodes || []).forEach((node) => {
                    if (nodeKey && String(node.nodeKey || "") !== String(nodeKey)) return;
                    (node.params || []).forEach((item) => {
                        const name = String(item?.name || item?.itemName || item?.key || "");
                        if (!runKeys.has(name)) return;
                        const value = Object.prototype.hasOwnProperty.call(item, "value")
                            ? item.value
                            : (item.itemDefault ?? item.defaultValue ?? "");
                        const runId = this.readManualFlowRunIdValue(value);
                        if (runId) ids.push(runId);
                    });
                });
                if (!ids.length) return "";
                if (new Set(ids).size > 1) {
                    throw new Error("Manual flow run id values must match.");
                }
                return ids[0];
            },

            hasFlowRunIdForCurrentFlow(runId) {
                const flowId = String(this.getValue(`#flowId-${PAGE_CODE}`) || "").trim();
                const targetRunId = String(runId || "").trim();
                if (!flowId || !targetRunId) return false;
                return (this.flowRunHistoryRows || []).some((row) => (
                    String(row.FLOW_ID || "").trim() === flowId
                    && String(row.FLOW_RUN_ID || row.RUN_ID || "").trim() === targetRunId
                ));
            },

            async confirmManualFlowRunIdOverwrite(payload, nodeKey = "") {
                let runId = "";
                try {
                    runId = this.getManualFlowRunIdFromPayload(payload, nodeKey);
                } catch (error) {
                    await CommonMessage.warn(error.message || "Invalid flow run id.");
                    return null;
                }
                if (!runId) return "";
                if (!this.hasFlowRunIdForCurrentFlow(runId)) {
                    await CommonMessage.warn(`FLOW_RUN_ID ${runId} is not an existing run id for the selected flow.`);
                    return null;
                }
                const confirmed = await CommonMessage.confirm([
                    `FLOW_RUN_ID ${runId} will be overwritten.`,
                    `FLOW_RUN_ID ${runId} 결과를 다시 생성합니다.`,
                    "",
                    "Existing node run records and result rows for this flow run may be deleted and inserted again.",
                    "Continue?"
                ].join("\n"));
                return confirmed ? runId : null;
            },

            inferPortType(portName, nodeType) {
                const value = String(portName || "").toLowerCase();
                if (value === "input" || value === "output") return "TABLE";
                return "TABLE";
            },

            buildFlowPayload() {
                this.storeSelectedNodeInspectorState();
                const flowIdValue = this.getValue(`#flowId-${PAGE_CODE}`);
                const flowName = this.getFlowNameForSave();
                if (!this.getValue(`#flowName-${PAGE_CODE}`)) {
                    this.setValue(`#flowName-${PAGE_CODE}`, flowName);
                }
                const flowNodes = this.getFlowNodes();
                const nodes = flowNodes.map((node, index) => {
                    const position = this.getNodePosition(node);
                    return {
                        nodeKey: node.dataset.nodeId || `node-${index + 1}`,
                        nodeType: node.dataset.nodeType || "JOB",
                        nodeTypeLabel: node.dataset.nodeTypeLabel || this.getNodeTypeLabel(node.dataset.nodeType || "JOB"),
                        nodeName: node.querySelector(".flow-node-body strong")?.textContent?.trim() || node.dataset.nodeId || `Node ${index + 1}`,
                        nodeDesc: node.querySelector(".flow-node-body small")?.textContent?.trim() || "",
                        useYn: String(node.dataset.useYn || "Y").toUpperCase() === "N" ? "N" : "Y",
                        refMenuCode: node.dataset.refMenuCode || "",
                        refWorkJobId: node.dataset.refWorkJobId || null,
                        refObjectId: node.dataset.refObjectId || null,
                        execSourceType: node.dataset.execSourceType || "DB_OBJECT",
                        execResourceId: node.dataset.execResourceId || "",
                        execMethod: node.dataset.execMethod || "",
                        execSpecJson: node.dataset.execSpecJson || "",
                        ownerName: node.dataset.ownerName || "",
                        tableName: node.dataset.tableName || "",
                        resultCreateYn: this.normalizeResultCreateMode(node.dataset.resultCreateYn || "N"),
                        resultOwner: node.dataset.resultOwner || "",
                        resultTableName: node.dataset.resultTableName || "",
                        positionLeft: position.left,
                        positionTop: position.top,
                        nodeWidth: position.width,
                        nodeHeight: position.height,
                        inputs: this.collectNodePorts(node, "in"),
                        outputs: this.collectNodePorts(node, "out"),
                        params: this.getNodeParams(node),
                        execPlsql: node.dataset.execPlsql || "",
                        sortOrder: index + 1
                    };
                });

                return {
                    flowId: /^\d+$/.test(flowIdValue) ? Number(flowIdValue) : null,
                    projectId: Number(this.selectedProjectId || 0),
                    scenarioId: Number(this.selectedScenarioId || 0),
                    flowGroup: this.getValue(`#flowGroup-${PAGE_CODE}`),
                    flowName,
                    flowDesc: this.getValue(`#flowDesc-${PAGE_CODE}`),
                    flowType: this.flowType,
                    executionMode: "DAG",
                    useYn: this.getValue(`#flowUseYn-${PAGE_CODE}`) || "Y",
                    status: "DRAFT",
                    nodes,
                    edges: this.flowEdges.map((edge, index) => ({
                        fromNodeKey: edge.from,
                        fromPort: this.normalizeFlowPortName(edge.fromPort, "output"),
                        toNodeKey: edge.to,
                        toPort: this.normalizeFlowPortName(edge.toPort, "input"),
                        edgeMode: edge.mode || (edge.dashed ? "ON_COMPLETE" : "SERIAL"),
                        dashedYn: edge.dashed ? "Y" : "N",
                        dashed: Boolean(edge.dashed),
                        params: this.getEdgeParams(edge),
                        sortOrder: index + 1
                    }))
                };
            },

            getFlowNameForSave() {
                const value = this.getValue(`#flowName-${PAGE_CODE}`).trim();
                if (value) return value;
                const scenario = this.contextScenarios.find((row) => String(row.SCENARIO_ID) === String(this.selectedScenarioId));
                const project = this.contextProjects.find((row) => String(row.PROJECT_ID) === String(this.selectedProjectId));
                const scenarioName = scenario?.SCENARIO_NAME || scenario?.SCENARIO_CODE || "";
                const projectName = project?.PROJECT_NAME || project?.PROJECT_CODE || "";
                const baseName = scenarioName ? `${scenarioName} Flow` : `${projectName || PAGE_CODE} Flow`;
                return this.getUniqueFlowName(baseName, this.getValue(`#flowId-${PAGE_CODE}`));
            },

            getUniqueFlowName(baseName, currentFlowId = "") {
                const normalizedBase = String(baseName || "Flow").trim() || "Flow";
                const currentId = String(currentFlowId || "");
                const usedNames = new Set(
                    (this.flowList || [])
                        .filter((flow) => String(flow.FLOW_ID || "") !== currentId)
                        .map((flow) => String(flow.FLOW_NAME || "").trim().toLowerCase())
                        .filter(Boolean)
                );
                if (!usedNames.has(normalizedBase.toLowerCase())) return normalizedBase;

                let index = 1;
                let nextName = `${normalizedBase} (${index})`;
                while (usedNames.has(nextName.toLowerCase())) {
                    index += 1;
                    nextName = `${normalizedBase} (${index})`;
                }
                return nextName;
            },

            applyFlowData(flow, options = {}) {
                this.setValue(`#flowId-${PAGE_CODE}`, flow.FLOW_ID || "NEW");
                this.setValue(`#flowGroup-${PAGE_CODE}`, flow.FLOW_GROUP || config.defaultFlowGroup || PAGE_CODE);
                this.setValue(`#flowName-${PAGE_CODE}`, flow.FLOW_NAME || "");
                this.setValue(`#flowDesc-${PAGE_CODE}`, flow.FLOW_DESC || "");
                this.setValue(`#flowUseYn-${PAGE_CODE}`, flow.USE_YN || "Y");
                const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (selector) selector.value = flow.FLOW_ID || "";
                this.flowLayoutRestoredFromDb = true;
                this.renderFlowCanvasFromData(flow.NODES || [], flow.EDGES || []);
                if (options.preserveZoom) {
                    this.applyFlowZoom();
                } else {
                    this.scheduleFitFlowCanvas();
                }
                this.updateFlowCopyButton();
                this.isFlowRunning = this.isFlowRunActive();
                this.updateFlowActionButtons();
                this.updateWorkContextSummary();
            },

            renderFlowCanvasFromData(nodes, edges) {
                const viewport = this.getFlowViewport();
                if (!viewport) return;
                this.clearCanvasRunStatusOverlay();
                viewport.querySelectorAll(".flow-node").forEach((node) => node.remove());
                this.setSampleFlowState(false);
                this.flowEdges = (edges || []).map((edge) => ({
                    from: edge.fromNodeKey,
                    fromPort: this.normalizeFlowPortName(edge.fromPort, "output"),
                    to: edge.toNodeKey,
                    toPort: this.normalizeFlowPortName(edge.toPort, "input"),
                    dashed: Boolean(edge.dashed || edge.dashedYn === "Y"),
                    mode: edge.edgeMode || (edge.dashed || edge.dashedYn === "Y" ? "ON_COMPLETE" : "SERIAL"),
                    params: edge.params || {}
                }));
                (nodes || []).forEach((node) => {
                    const element = this.createSavedFlowNode(node);
                    viewport.appendChild(element);
                    this.bindFlowNode(element);
                });
                const firstNode = this.getFlowNodes()[0];
                this.selectedNodeId = "";
                if (firstNode) this.selectFlowNode(firstNode.dataset.nodeId || "");
                if (!firstNode) {
                    this.clearNodeInspector();
                }
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
            },
            handleNodeObjectChange() {},

            zoomFlow(direction) {
                const delta = Number(direction) > 0 ? 0.1 : -0.1;
                this.setFlowZoom(this.flowZoom + delta);
            },

            setFlowZoom(value) {
                const nextZoom = Math.min(this.maxFlowZoom, Math.max(this.minFlowZoom, Number(value) || 1));
                this.flowZoom = Math.round(nextZoom * 100) / 100;
                this.applyFlowZoom();
            },

            applyFlowZoom() {
                const viewport = this.getFlowViewport();
                if (!viewport) return;
                viewport.style.transform = `scale(${this.flowZoom})`;
                this.resizeFlowViewportToNodes();
                this.updateSelectedEdgeDeleteButton();
                this.updateFlowZoomLabel();
                const label = getContainerEl(`#selectedFlowLabel-${PAGE_CODE}`);
                if (label) {
                    if (this.isSampleFlowVisible) {
                        this.setSampleFlowState(true);
                        return;
                    }
                    const dashedHint = this.dashedConnectionMode
                        ? "현재 점선 연결 모드가 켜져 있습니다."
                        : "Shift를 누르고 연결하면 선행 노드 종료 후 실행되는 점선 연결을 한 번 만들 수 있습니다.";
                    this.setMultilineText(
                        label,
                        `오른쪽 출력 커넥터를 클릭한 뒤 연결할 노드의 왼쪽 입력 커넥터를 클릭하세요.\n${dashedHint}`
                    );
                }
            },

            updateFlowZoomLabel() {
                const label = getContainerEl(`#flowZoomLabel-${PAGE_CODE}`);
                if (label) label.textContent = `${Math.round(this.flowZoom * 100)}%`;
            },

            resetFlowZoom() {
                this.setFlowZoom(1);
            },

            scheduleFitFlowCanvas(options = {}) {
                const run = () => this.fitFlowCanvas(options);
                if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(run);
                    });
                    return;
                }
                setTimeout(run, 0);
            },

            fitFlowCanvas(options = {}) {
                const stage = this.getFlowStage();
                const viewport = this.getFlowViewport();
                if (!stage || !viewport) return;
                const bounds = this.getFlowNodeBounds();
                if (!bounds) return;
                const availableWidth = Math.max(stage.clientWidth - 80, 320);
                const availableHeight = Math.max(stage.clientHeight - 80, 240);
                const maxZoom = Number.isFinite(Number(options.maxZoom))
                    ? Math.min(this.maxFlowZoom, Math.max(this.minFlowZoom, Number(options.maxZoom)))
                    : this.maxFlowZoom;
                const zoom = Math.min(
                    maxZoom,
                    Math.max(this.minFlowZoom, Math.min(availableWidth / bounds.width, availableHeight / bounds.height))
                );
                this.setFlowZoom(zoom);
                const scaledWidth = bounds.width * this.flowZoom;
                const scaledHeight = bounds.height * this.flowZoom;
                const centeredLeft = (bounds.left * this.flowZoom) - Math.max(40, (stage.clientWidth - scaledWidth) / 2);
                const centeredTop = (bounds.top * this.flowZoom) - Math.max(40, (stage.clientHeight - scaledHeight) / 2);
                stage.scrollLeft = Math.max(0, centeredLeft);
                stage.scrollTop = Math.max(0, centeredTop);
            },

            toggleCanvasMaximize() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                const nextMaximized = !container.classList.contains("is-flow-canvas-maximized");
                container.classList.toggle("is-flow-canvas-maximized", nextMaximized);
                if (nextMaximized) {
                    this.collapseSidebarsForCanvasMaximize();
                } else {
                    this.restoreSidebarsAfterCanvasMaximize();
                }
                this.renderFlowSidebarToggle();
                const icon = getContainerEl(`#flowCanvasMaximize-${PAGE_CODE}`)?.querySelector("i");
                if (icon) {
                    icon.classList.toggle("fa-expand", !nextMaximized);
                    icon.classList.toggle("fa-compress", nextMaximized);
                }
                this.renderFlowInspectorToggle();
                setTimeout(() => {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                }, 0);
            },

            collapseSidebarsForCanvasMaximize() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                if (this.flowSidebarCollapsedBeforeMaximize === null) {
                    this.flowSidebarCollapsedBeforeMaximize = this.flowSidebarCollapsed;
                }
                if (this.flowInspectorCollapsedBeforeMaximize === null) {
                    this.flowInspectorCollapsedBeforeMaximize = this.flowInspectorCollapsed;
                }
                this.syncAppSidebarForCanvasMaximize(true);
                this.flowSidebarCollapsed = true;
                container.classList.add("is-flow-sidebar-collapsed");
                this.setFlowInspectorCollapsed(true);
            },

            restoreSidebarsAfterCanvasMaximize() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (container && this.flowSidebarCollapsedBeforeMaximize !== null) {
                    this.flowSidebarCollapsed = Boolean(this.flowSidebarCollapsedBeforeMaximize);
                    container.classList.toggle("is-flow-sidebar-collapsed", this.flowSidebarCollapsed);
                    this.flowSidebarCollapsedBeforeMaximize = null;
                }
                if (this.flowInspectorCollapsedBeforeMaximize !== null) {
                    this.setFlowInspectorCollapsed(Boolean(this.flowInspectorCollapsedBeforeMaximize));
                    this.flowInspectorCollapsedBeforeMaximize = null;
                }
                this.restoreAppSidebarAfterCanvasMaximize();
                this.renderFlowSidebarToggle();
                this.renderFlowInspectorToggle();
            },

            syncAppSidebarForCanvasMaximize(maximized) {
                if (!window.LayoutManager?.applySidebarCollapsed) return;
                if (maximized) {
                    if (this.appSidebarCollapsedBeforeMaximize === null) {
                        this.appSidebarCollapsedBeforeMaximize = document.body.classList.contains("sidebar-user-collapsed");
                    }
                    window.LayoutManager.applySidebarCollapsed(true, { persist: false });
                    return;
                }
                this.restoreAppSidebarAfterCanvasMaximize();
            },

            restoreAppSidebarAfterCanvasMaximize() {
                if (this.appSidebarCollapsedBeforeMaximize === null) return;
                if (window.LayoutManager?.applySidebarCollapsed) {
                    window.LayoutManager.applySidebarCollapsed(this.appSidebarCollapsedBeforeMaximize, { persist: false });
                }
                this.appSidebarCollapsedBeforeMaximize = null;
            },

            toggleFlowInspectorOverlay() {
                this.setFlowInspectorCollapsed(!this.flowInspectorCollapsed);
            },

            setFlowInspectorCollapsed(collapsed) {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                this.flowInspectorCollapsed = Boolean(collapsed);
                container.classList.toggle("is-flow-inspector-collapsed", this.flowInspectorCollapsed);
                this.renderFlowInspectorToggle();
                setTimeout(() => {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                    this.updateSelectedEdgeDeleteButton();
                }, 0);
            },

            renderFlowInspectorToggle() {
                const icon = getContainerEl(`#flowInspectorToggle-${PAGE_CODE}`)?.querySelector("i");
                if (!icon) return;
                icon.classList.toggle("fa-chevron-right", !this.flowInspectorCollapsed);
                icon.classList.toggle("fa-chevron-left", this.flowInspectorCollapsed);
            },

            hasFlowCycle(edges = this.flowEdges) {
                const nodeIds = new Set(this.getFlowNodes().map((node) => node.dataset.nodeId || "").filter(Boolean));
                (edges || []).forEach((edge) => {
                    if (edge?.from) nodeIds.add(edge.from);
                    if (edge?.to) nodeIds.add(edge.to);
                });
                const outgoing = new Map(Array.from(nodeIds).map((nodeId) => [nodeId, []]));
                (edges || []).forEach((edge) => {
                    const from = edge?.from;
                    const to = edge?.to;
                    if (!from || !to || from === to || !outgoing.has(from) || !outgoing.has(to)) return;
                    outgoing.get(from).push(to);
                });
                const visiting = new Set();
                const visited = new Set();
                const visit = (nodeId) => {
                    if (visiting.has(nodeId)) return true;
                    if (visited.has(nodeId)) return false;
                    visiting.add(nodeId);
                    for (const next of outgoing.get(nodeId) || []) {
                        if (visit(next)) return true;
                    }
                    visiting.delete(nodeId);
                    visited.add(nodeId);
                    return false;
                };
                return Array.from(nodeIds).some((nodeId) => visit(nodeId));
            },

            wouldCreateFlowCycle(edge) {
                if (!edge?.from || !edge?.to || edge.from === edge.to) return true;
                return this.hasFlowCycle([...this.flowEdges, edge]);
            },

            autoLayoutFlow() {
                const nodes = this.getFlowNodes();
                if (!nodes.length) return;

                const nodeIds = nodes.map((node) => node.dataset.nodeId || "").filter(Boolean);
                if (this.hasFlowCycle()) {
                    CommonMessage.warn("순환 연결이 있어 Tree layout을 적용할 수 없습니다. 순환 루프 연결을 삭제한 뒤 다시 시도해 주세요.", { copyable: false });
                    return;
                }
                const nodeSet = new Set(nodeIds);
                const outgoing = new Map(nodeIds.map((nodeId) => [nodeId, []]));
                const incomingCount = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
                const layoutEdges = [];

                this.flowEdges.forEach((edge) => {
                    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to) || edge.from === edge.to) return;
                    outgoing.get(edge.from)?.push(edge.to);
                    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
                    layoutEdges.push({ from: edge.from, to: edge.to });
                });

                const queue = nodeIds
                    .filter((nodeId) => (incomingCount.get(nodeId) || 0) === 0)
                    .sort();
                const levels = new Map(queue.map((nodeId) => [nodeId, 0]));
                const visited = new Set();

                while (queue.length) {
                    const current = queue.shift();
                    visited.add(current);
                    const currentLevel = levels.get(current) || 0;
                    (outgoing.get(current) || []).forEach((next) => {
                        levels.set(next, Math.max(levels.get(next) || 0, currentLevel + 1));
                        incomingCount.set(next, (incomingCount.get(next) || 0) - 1);
                        if ((incomingCount.get(next) || 0) <= 0 && !visited.has(next) && !queue.includes(next)) {
                            queue.push(next);
                        }
                    });
                    queue.sort();
                }

                const fallbackLevel = Math.max(0, ...Array.from(levels.values()), 0) + 1;
                nodeIds.forEach((nodeId) => {
                    if (!levels.has(nodeId)) levels.set(nodeId, fallbackLevel);
                });

                const canReach = (source, target) => {
                    if (source === target) return true;
                    const stack = [...(outgoing.get(source) || [])];
                    const seen = new Set();
                    while (stack.length) {
                        const current = stack.pop();
                        if (current === target) return true;
                        if (seen.has(current)) continue;
                        seen.add(current);
                        stack.push(...(outgoing.get(current) || []));
                    }
                    return false;
                };
                const laneByNode = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
                layoutEdges
                    .filter((edge) => (levels.get(edge.to) || 0) - (levels.get(edge.from) || 0) > 1)
                    .sort((a, b) => {
                        const aSpan = (levels.get(a.to) || 0) - (levels.get(a.from) || 0);
                        const bSpan = (levels.get(b.to) || 0) - (levels.get(b.from) || 0);
                        return bSpan - aSpan || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
                    })
                    .forEach((edge, edgeIndex) => {
                        const fromLevel = levels.get(edge.from) || 0;
                        const toLevel = levels.get(edge.to) || 0;
                        const lane = edgeIndex % 2 === 0 ? -1 : 1;
                        nodeIds.forEach((candidate) => {
                            const level = levels.get(candidate) || 0;
                            if (candidate === edge.from || candidate === edge.to || level <= fromLevel || level >= toLevel) return;
                            if (!canReach(edge.from, candidate) || !canReach(candidate, edge.to)) return;
                            if ((laneByNode.get(candidate) || 0) === 0) laneByNode.set(candidate, lane);
                        });
                    });

                const levelGroups = new Map();
                nodeIds.forEach((nodeId) => {
                    const level = levels.get(nodeId) || 0;
                    if (!levelGroups.has(level)) levelGroups.set(level, []);
                    levelGroups.get(level).push(nodeId);
                });

                const columnWidth = 280;
                const rowHeight = 170;
                const startX = 80;
                const startY = 90;
                const rowByNode = new Map();
                Array.from(levelGroups.keys()).sort((a, b) => a - b).forEach((level) => {
                    const usedRows = new Set();
                    const group = levelGroups.get(level).sort((a, b) => {
                        const laneDiff = (laneByNode.get(a) || 0) - (laneByNode.get(b) || 0);
                        if (laneDiff) return laneDiff;
                        const aOut = (outgoing.get(a) || []).length;
                        const bOut = (outgoing.get(b) || []).length;
                        return bOut - aOut || a.localeCompare(b);
                    });
                    group.forEach((nodeId) => {
                        const preferredLane = laneByNode.get(nodeId) || 0;
                        let row = preferredLane;
                        let spread = 0;
                        while (usedRows.has(row)) {
                            spread += 1;
                            row = preferredLane <= 0 ? preferredLane - spread : preferredLane + spread;
                            if (usedRows.has(row)) row = preferredLane + spread;
                        }
                        usedRows.add(row);
                        rowByNode.set(nodeId, row);
                    });
                });
                const minRow = Math.min(0, ...Array.from(rowByNode.values()), 0);
                const baseY = startY + Math.abs(minRow) * rowHeight;
                Array.from(levelGroups.keys()).sort((a, b) => a - b).forEach((level) => {
                    levelGroups.get(level).forEach((nodeId) => {
                        const node = this.getFlowNode(nodeId);
                        if (!node) return;
                        this.setNodePosition(node, startX + level * columnWidth, baseY + (rowByNode.get(nodeId) || 0) * rowHeight);
                    });
                });

                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
            },

            resizeFlowViewportToNodes() {
                const viewport = this.getFlowViewport();
                const edgeLayer = viewport?.querySelector(".flow-edge-layer");
                if (!viewport || !edgeLayer) return;
                const bounds = this.getFlowNodeBounds();
                const width = Math.max(1200, Math.ceil((bounds?.right || 1000) + 240));
                const height = Math.max(760, Math.ceil((bounds?.bottom || 600) + 180));
                viewport.style.width = `${width}px`;
                viewport.style.height = `${height}px`;
                viewport.style.minWidth = `${width}px`;
                viewport.style.minHeight = `${height}px`;
                edgeLayer.setAttribute("width", String(width));
                edgeLayer.setAttribute("height", String(height));
                edgeLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
            },

            getFlowNodeBounds() {
                const nodes = this.getFlowNodes();
                if (!nodes.length) return null;
                const positions = nodes.map((node) => this.getNodePosition(node));
                const left = Math.min(...positions.map((item) => item.left));
                const top = Math.min(...positions.map((item) => item.top));
                const right = Math.max(...positions.map((item) => item.left + item.width));
                const bottom = Math.max(...positions.map((item) => item.top + item.height));
                return {
                    left,
                    top,
                    right,
                    bottom,
                    width: Math.max(1, right - left),
                    height: Math.max(1, bottom - top)
                };
            },

            updateFlowEdges() {
                const viewport = this.getFlowViewport();
                const edgeLayer = viewport?.querySelector(".flow-edge-layer");
                if (!edgeLayer) return;
                const defs = edgeLayer.querySelector("defs")?.outerHTML || "";
                const markerUrl = `url(#flow-arrow-${PAGE_CODE})`;
                const paths = this.flowEdges.map((edge, index) => {
                    const edgeId = this.getEdgeId(edge, index);
                    edge._edgeId = edgeId;
                    const fromNode = this.getFlowNode(edge.from);
                    const toNode = this.getFlowNode(edge.to);
                    if (!fromNode || !toNode) return "";
                    const from = this.getNodeConnectorPoint(fromNode, "out");
                    const to = this.getNodeConnectorPoint(toNode, "in");
                    const startX = from.x;
                    const startY = from.y;
                    const endX = to.x;
                    const endY = to.y;
                    const curve = Math.max(70, Math.abs(endX - startX) / 2);
                    const d = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
                    const dash = edge.dashed ? ` stroke-dasharray="6 5"` : "";
                    const selected = edgeId === this.selectedEdgeId ? " is-selected" : "";
                    return `
                        <path class="flow-edge-hit-path" data-edge-id="${this.escapeHtml(edgeId)}" d="${d}" fill="none" stroke="transparent" stroke-width="18"></path>
                        <path class="flow-edge-path${selected}" data-edge-id="${this.escapeHtml(edgeId)}" d="${d}" fill="none" stroke="${edge.dashed ? "#94a3b8" : "#64748b"}" stroke-width="2"${dash} marker-end="${markerUrl}"></path>
                    `;
                }).join("");
                edgeLayer.innerHTML = `${defs}${paths}`;
                this.updateSelectedEdgeDeleteButton();
            },

            getEdgeId(edge, index = 0) {
                return edge._edgeId || `${edge.from || "from"}:${edge.fromPort || "output"}>${edge.to || "to"}:${edge.toPort || "input"}:${index}`;
            },

            selectFlowEdge(edgeId) {
                this.selectedEdgeId = edgeId || "";
                this.selectedNodeId = "";
                this.getFlowNodes().forEach((node) => node.classList.remove("is-selected"));
                this.updateFlowEdges();
            },

            clearSelectedFlowEdge() {
                if (!this.selectedEdgeId) {
                    this.hideSelectedEdgeDelete();
                    return;
                }
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                this.updateFlowEdges();
            },

            updateSelectedEdgeDeleteButton() {
                const button = getContainerEl(`#flowEdgeDelete-${PAGE_CODE}`);
                if (!button) return;
                const edge = this.flowEdges.find((item, index) => this.getEdgeId(item, index) === this.selectedEdgeId);
                if (!edge) {
                    button.hidden = true;
                    return;
                }
                const fromNode = this.getFlowNode(edge.from);
                const toNode = this.getFlowNode(edge.to);
                if (!fromNode || !toNode) {
                    button.hidden = true;
                    return;
                }
                const from = this.getNodeConnectorPoint(fromNode, "out");
                const to = this.getNodeConnectorPoint(toNode, "in");
                button.style.left = `${((from.x + to.x) / 2) * this.flowZoom - 12}px`;
                button.style.top = `${((from.y + to.y) / 2) * this.flowZoom - 12}px`;
                button.hidden = false;
            },

            hideSelectedEdgeDelete() {
                const button = getContainerEl(`#flowEdgeDelete-${PAGE_CODE}`);
                if (button) button.hidden = true;
            },

            removeSelectedEdge() {
                if (!this.selectedEdgeId) return;
                const removedEdge = this.flowEdges.find((edge, index) => this.getEdgeId(edge, index) === this.selectedEdgeId);
                this.flowEdges = this.flowEdges.filter((edge, index) => this.getEdgeId(edge, index) !== this.selectedEdgeId);
                this.markFlowEdited();
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
                if (!this.selectedNodeId && removedEdge?.to) {
                    this.selectFlowNode(removedEdge.to);
                    return;
                }
                this.refreshNodeBindVariablesForEdgeChange(removedEdge);
            },

            addNodePort() {},
            addFlowEdge(edge = null) {
                if (!edge) {
                    alert("Drag from an output port to an input port to connect nodes.");
                    return;
                }
                const nextEdge = {
                    from: edge.from,
                    fromPort: this.normalizeFlowPortName(edge.fromPort, "output"),
                    to: edge.to,
                    toPort: this.normalizeFlowPortName(edge.toPort, "input"),
                    dashed: Boolean(edge.dashed),
                    mode: edge.mode || (edge.dashed ? "ON_COMPLETE" : "SERIAL"),
                    params: edge.params || {}
                };
                if (!nextEdge.from || !nextEdge.to) return;
                if (this.wouldCreateFlowCycle(nextEdge)) {
                    CommonMessage.warn("순환 루프가 되는 연결은 만들 수 없습니다. Flow는 마지막 노드에서 처음 노드로 되돌아가지 않는 DAG 구조여야 합니다.", { copyable: false });
                    return;
                }
                const exists = this.flowEdges.some((item) =>
                    item.from === nextEdge.from
                    && item.to === nextEdge.to
                    && (item.fromPort || "") === nextEdge.fromPort
                    && (item.toPort || "") === nextEdge.toPort
                );
                if (exists) return;
                this.markFlowEdited();
                this.flowEdges.push(nextEdge);
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
                this.refreshNodeBindVariablesForEdgeChange(nextEdge);
            },

            refreshNodeBindVariablesForEdgeChange(edge) {
                if (!edge || !this.selectedNodeId) return;
                if (edge.to !== this.selectedNodeId && edge.from !== this.selectedNodeId) return;
                const selectedNode = this.getFlowNode(this.selectedNodeId);
                if (selectedNode) {
                    this.renderNodeBindVariables(selectedNode);
                    this.setValue(`#nodeDependsOn-${PAGE_CODE}`, this.getUpstreamNodeIds(this.selectedNodeId).join(", "));
                }
            },

            renderFlowEdgeGrid() {
                const container = getContainerEl(`#flowEdgeGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.flowEdges.length) {
                    container.innerHTML = `<div class="table-empty">No edges.</div>${this.renderListFooter(0)}`;
                    return;
                }
                container.innerHTML = `
                    <table class="table-grid">
                        <thead>
                            <tr>
                                <th>From Node</th>
                                <th>Output</th>
                                <th>To Node</th>
                                <th>Input</th>
                                <th>Source</th>
                                <th>Mode</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.flowEdges.map((edge) => `
                                <tr>
                                    <td>${this.escapeHtml(edge.from || "")}</td>
                                    <td>${this.escapeHtml(edge.fromPort || "output")}</td>
                                    <td>${this.escapeHtml(edge.to || "")}</td>
                                    <td>${this.escapeHtml(edge.toPort || "input")}</td>
                                    <td>${this.escapeHtml(this.getEdgeParams(edge)?.inputSource === "UPSTREAM_RESULT" ? "Upstream result table" : "-")}</td>
                                    <td>${this.escapeHtml(edge.mode || (edge.dashed ? "ON_COMPLETE" : "SERIAL"))}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(this.flowEdges.length)}
                `;
            },
            addFlowVariable() {},
            async buildExecutionPlan(options = {}) {
                const payload = this.buildFlowPayload();
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/validate`, {
                        method: "POST",
                        body: payload
                    });
                    return json.data?.plan || [];
                } catch (error) {
                    throw error;
                }
            },
            async refreshFlowRunHistory() {
                await this.loadFlowRunHistory({ showFeedback: true });
            },
            setFlowRunHistoryLoading(isLoading, message = "") {
                const button = getContainerEl(`#flowRunHistoryRefresh-${PAGE_CODE}`);
                const icon = button?.querySelector("i");
                const status = getContainerEl(`#flowRunHistoryRefreshStatus-${PAGE_CODE}`);
                if (button) {
                    button.disabled = Boolean(isLoading);
                    button.classList.toggle("is-loading", Boolean(isLoading));
                }
                if (icon) {
                    icon.classList.toggle("fa-spin", Boolean(isLoading));
                }
                if (status) {
                    status.textContent = message;
                }
            },
            async loadFlowRunHistory(options = {}) {
                const container = getContainerEl(`#flowRunHistoryGrid-${PAGE_CODE}`);
                if (!container) return;
                const showFeedback = Boolean(options.showFeedback);
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>${this.renderListFooter(0)}`;
                    if (showFeedback) this.setFlowRunHistoryLoading(false, "Project and scenario are required.");
                    return;
                }
                try {
                    if (showFeedback) this.setFlowRunHistoryLoading(true, "Refreshing history...");
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs?${params.toString()}`, { method: "GET", showLoading: false });
                    this.renderFlowRunHistory(Array.isArray(json.data) ? json.data : []);
                    if (showFeedback) {
                        const refreshedAt = new Date().toLocaleTimeString("ko-KR", { hour12: false });
                        this.setFlowRunHistoryLoading(false, `Refreshed ${refreshedAt}`);
                    }
                } catch (error) {
                    this.renderError(`#flowRunHistoryGrid-${PAGE_CODE}`, error.message || "Run history load failed.");
                    if (showFeedback) this.setFlowRunHistoryLoading(false, "Refresh failed.");
                }
            },
            renderExecutionPlanTable(container, plan = []) {
                if (!container) return;
                if (!plan.length) {
                    container.innerHTML = `<div class="table-empty">No execution steps.</div>${this.renderListFooter(0)}`;
                    return;
                }
                container.innerHTML = `
                    <table class="table-grid">
                        <thead>
                            <tr>
                                <th>Level</th>
                                <th>Node</th>
                                <th>Type</th>
                                <th>Upstream</th>
                                <th>Downstream</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${plan.map((step) => `
                                <tr>
                                    <td>${this.escapeHtml(step.level ?? "")}</td>
                                    <td>${this.escapeHtml(step.nodeName || step.nodeKey || "")}</td>
                                    <td>${this.escapeHtml(step.nodeType || "")}</td>
                                    <td>${this.escapeHtml((step.upstream || []).join(", "))}</td>
                                    <td>${this.escapeHtml((step.downstream || []).join(", "))}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(plan.length)}
                `;
            },
            renderFlowRunHistory(rows) {
                const container = getContainerEl(`#flowRunHistoryGrid-${PAGE_CODE}`);
                if (!container) return;
                this.flowRunHistoryRows = Array.isArray(rows) ? rows : [];
                if (!rows.length) {
                    container.innerHTML = `<div class="table-empty">No run history.</div>${this.renderListFooter(0)}`;
                    return;
                }
                if (this.activeRunPlanFlowRunId && !this.flowRunHistoryRows.some((row) => String(row.FLOW_RUN_ID || "") === String(this.activeRunPlanFlowRunId))) {
                    this.activeRunPlanFlowRunId = "";
                    this.flowNodeRunResultRows = [];
                }
                container.innerHTML = `
                    <table class="table-grid">
                        <thead>
                            <tr>
                                <th>Detail</th>
                                <th>Run ID</th>
                                <th>Flow</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Message</th>
                                <th>Started</th>
                                <th>Finished</th>
                                <th>Elapsed</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row) => {
                                const flowRunId = String(row.FLOW_RUN_ID || "");
                                const expanded = flowRunId && flowRunId === String(this.activeRunPlanFlowRunId || "");
                                return `
                                <tr class="${expanded ? "is-expanded" : ""}" ondblclick="${PAGE_CODE}.openRunPlanLayer('${this.escapeJs(flowRunId)}')">
                                    <td>
                                        <button type="button" class="table-icon-btn" title="${expanded ? "Close execution details" : "View execution details"}" onclick="event.stopPropagation(); ${PAGE_CODE}.openRunPlanLayer('${this.escapeJs(flowRunId)}')">
                                            <i class="fas ${expanded ? "fa-chevron-up" : "fa-ellipsis"}"></i>
                                        </button>
                                    </td>
                                    <td><button type="button" class="flow-run-id-link" onclick="${PAGE_CODE}.openRunPlanLayer('${this.escapeJs(flowRunId)}')">${this.escapeHtml(flowRunId)}</button></td>
                                    <td>${this.escapeHtml(row.FLOW_NAME || "")}</td>
                                    <td>${this.escapeHtml(row.RUN_TYPE || "")}</td>
                                    <td>${this.escapeHtml(row.STATUS || "")}</td>
                                    <td>${this.renderRunHistoryMessageCell(row)}</td>
                                    <td title="${this.escapeHtml(row.STARTED_AT || "")}">${this.escapeHtml(this.formatKstDateTime(row.STARTED_AT))}</td>
                                    <td title="${this.escapeHtml(row.FINISHED_AT || "")}">${this.escapeHtml(this.formatKstDateTime(row.FINISHED_AT))}</td>
                                    <td>${this.escapeHtml(this.formatElapsedTime(row.STARTED_AT, row.FINISHED_AT, row.STATUS))}</td>
                                </tr>
                                ${expanded ? this.renderRunHistoryDetailRow(row) : ""}
                            `;
                            }).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(rows.length)}
                `;
            },
            renderRunHistoryMessageCell(row) {
                const flowRunId = row?.FLOW_RUN_ID || "";
                const message = String(row?.MESSAGE || "");
                const preview = message.length > 140 ? `${message.slice(0, 140)}...` : message;
                return `
                    <div class="flow-run-history-message">
                        <span class="flow-run-history-message-text" title="${this.escapeHtml(message)}">${this.escapeHtml(preview)}</span>
                        ${message ? `
                            <span class="flow-run-history-message-actions">
                                <button type="button" class="table-icon-btn" title="Copy message" onclick="${PAGE_CODE}.copyRunHistoryMessage('${this.escapeHtml(flowRunId)}', event)">
                                    <i class="far fa-copy"></i>
                                </button>
                            </span>
                        ` : ""}
                    </div>
                `;
            },
            async copyRunHistoryMessage(flowRunId, event) {
                event?.stopPropagation?.();
                const row = this.flowRunHistoryRows.find((item) => String(item.FLOW_RUN_ID || "") === String(flowRunId || ""));
                const message = row?.MESSAGE || "";
                if (!message) return;
                try {
                    await CommonMessage.copyText(message);
                    CommonMessage.success("Run history message copied.", { copyable: false });
                } catch (error) {
                    CommonMessage.error(error.message || "Message copy failed.");
                }
            },
            async openRunPlanLayer(flowRunId, options = {}) {
                const nextFlowRunId = String(flowRunId || "");
                if (!nextFlowRunId) return;
                if (!options.refreshing && this.activeRunPlanFlowRunId === nextFlowRunId) {
                    this.closeRunPlanLayer();
                    return;
                }
                this.activeRunPlanFlowRunId = nextFlowRunId;
                this.flowNodeRunResultRows = [];
                this.activeRunPlanLoadedId = "";
                this.renderFlowRunHistory(this.flowRunHistoryRows);
                await this.loadInlineRunPlan(nextFlowRunId);
            },
            async loadInlineRunPlan(flowRunId) {
                const row = this.flowRunHistoryRows.find((item) => String(item.FLOW_RUN_ID || "") === String(flowRunId || ""));
                if (!row) return;
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/run/${encodeURIComponent(flowRunId)}/nodes`, {
                        method: "GET",
                        showLoading: false
                    });
                    if (String(this.activeRunPlanFlowRunId || "") !== String(flowRunId || "")) return;
                    const nodeRuns = Array.isArray(json.data) ? json.data : [];
                    this.flowNodeRunResultRows = nodeRuns;
                    this.activeRunPlanLoadedId = String(flowRunId || "");
                    this.renderFlowRunHistory(this.flowRunHistoryRows);
                } catch (error) {
                    if (String(this.activeRunPlanFlowRunId || "") !== String(flowRunId || "")) return;
                    this.flowNodeRunResultRows = [];
                    this.activeRunPlanLoadedId = String(flowRunId || "");
                    this.renderFlowRunHistory(this.flowRunHistoryRows);
                    const panel = getContainerEl(`#flowRunInlineDetail-${PAGE_CODE}-${flowRunId}`);
                    if (panel) {
                        panel.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Node run result load failed.")}</div>`;
                    }
                }
            },
            async refreshRunPlanLayer() {
                const flowRunId = this.activeRunPlanFlowRunId;
                if (!flowRunId) return;
                this.flowNodeRunResultRows = [];
                this.activeRunPlanLoadedId = "";
                this.renderFlowRunHistory(this.flowRunHistoryRows);
                await this.loadFlowRunHistory({ silent: true });
                if (this.activeRunPlanFlowRunId) {
                    await this.loadInlineRunPlan(this.activeRunPlanFlowRunId);
                }
            },
            closeRunPlanLayer() {
                this.activeRunPlanFlowRunId = "";
                this.flowNodeRunResultRows = [];
                this.activeRunPlanLoadedId = "";
                this.renderFlowRunHistory(this.flowRunHistoryRows);
            },
            renderRunHistoryDetailRow(row) {
                const flowRunId = String(row?.FLOW_RUN_ID || "");
                const hasLoaded = String(this.activeRunPlanLoadedId || "") === flowRunId;
                const message = String(row?.MESSAGE || "").trim();
                return `
                    <tr class="flow-run-inline-detail-row">
                        <td colspan="9">
                            <section id="flowRunInlineDetail-${PAGE_CODE}-${this.escapeHtml(flowRunId)}" class="flow-run-inline-detail">
                                <header>
                                    <strong>Run #${this.escapeHtml(flowRunId)} details</strong>
                                    <span class="flow-run-plan-tools">
                                        <button type="button" class="table-icon-btn" title="Refresh run details" onclick="${PAGE_CODE}.refreshRunPlanLayer()">
                                            <i class="fas fa-sync-alt"></i>
                                        </button>
                                        <button type="button" class="table-icon-btn" title="Close" onclick="${PAGE_CODE}.closeRunPlanLayer()">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </span>
                                </header>
                                ${message ? `
                                    <div class="flow-run-inline-message">
                                        <strong>Message</strong>
                                        <pre>${this.escapeHtml(message)}</pre>
                                    </div>
                                ` : ""}
                                ${hasLoaded
                                    ? this.renderNodeRunResultContent(this.flowNodeRunResultRows)
                                    : `<div class="table-empty">Loading node execution results...</div>`}
                            </section>
                        </td>
                    </tr>
                `;
            },
            renderNodeRunResultContent(rows = []) {
                if (!rows.length) {
                    return `<div class="table-empty">No node execution results.</div>`;
                }
                return `
                    <table class="table-grid flow-node-run-result-table">
                        <thead>
                            <tr>
                                <th>Level</th>
                                <th>Node</th>
                                <th>Result</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Timing</th>
                                <th>Message / Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row) => {
                                const resultInfo = this.getNodeResultInfo(row);
                                const canOpenResult = resultInfo.mode !== "N" && resultInfo.owner && resultInfo.objectName && resultInfo.status === "SUCCESS";
                                return `
                                <tr class="${this.getRunStatusClass(row.STATUS)}">
                                    <td>${this.escapeHtml(row.RUN_LEVEL ?? "")}</td>
                                    <td>${this.renderNodeRunNodeCell(row)}</td>
                                    <td>${this.renderNodeRunResultCell(resultInfo)}</td>
                                    <td>${this.escapeHtml(row.NODE_TYPE || "")}</td>
                                    <td><span class="flow-run-status-pill">${this.escapeHtml(row.STATUS || "")}</span></td>
                                    <td>${this.renderNodeRunTimingCell(row)}</td>
                                    <td class="flow-run-message-cell">${this.renderNodeRunMessageCell(row)}</td>
                                </tr>
                            `;
                            }).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(rows.length)}
                `;
            },
            renderNodeRunResultCell(info = {}) {
                if (info.mode === "N" || !info.owner || !info.objectName) {
                    return `<span class="flow-node-result-inline is-empty">-</span>`;
                }
                const clickable = info.status === "SUCCESS";
                const content = `
                        <strong>${this.escapeHtml(info.modeLabel)}</strong>
                        <small>${this.escapeHtml(info.owner)}.${this.escapeHtml(info.objectName)}</small>
                `;
                if (!clickable) {
                    return `<span class="flow-node-result-inline is-disabled" title="${this.escapeHtml(`${info.modeLabel}: ${info.owner}.${info.objectName}`)}">${content}</span>`;
                }
                return `
                    <button type="button" class="flow-node-result-inline is-openable" title="${this.escapeHtml(`${info.modeLabel}: ${info.owner}.${info.objectName}`)}" onclick="${PAGE_CODE}.openFlowNodeResultSql('${this.escapeJs(info.flowNodeRunId)}')">
                        ${content}
                    </button>
                `;
            },
            renderNodeRunNodeCell(row) {
                const flowNodeRunId = row?.FLOW_NODE_RUN_ID || "";
                const nodeName = row?.NODE_NAME || row?.NODE_KEY || "";
                const count = this.getNodeRunRuntimeParamEntries(row).length;
                return `
                    <span class="flow-node-run-node-cell">
                        <strong title="${this.escapeHtml(nodeName)}">${this.escapeHtml(nodeName)}</strong>
                        ${count > 0 ? `
                            <button type="button" class="flow-node-run-param-link" onclick="${PAGE_CODE}.openNodeRunParamsLayer('${this.escapeJs(flowNodeRunId)}', event)">
                                호출 옵션 파라미터 ${this.escapeHtml(count.toLocaleString())}개
                            </button>
                        ` : `<small>호출 옵션 파라미터 0개</small>`}
                    </span>
                `;
            },
            renderNodeRunTimingCell(row) {
                const elapsed = this.formatElapsedTime(row.STARTED_AT, row.FINISHED_AT, row.STATUS);
                return `
                    <span class="flow-node-run-timing">
                        <small title="${this.escapeHtml(row.STARTED_AT || "")}"><b>Start</b>${this.escapeHtml(this.formatKstDateTime(row.STARTED_AT) || "-")}</small>
                        <small title="${this.escapeHtml(row.FINISHED_AT || "")}"><b>End</b>${this.escapeHtml(this.formatKstDateTime(row.FINISHED_AT) || "-")}</small>
                        <strong>${this.escapeHtml(elapsed || "-")}</strong>
                    </span>
                `;
            },
            getNodeRunRuntimeParamEntries(row) {
                const params = this.parseNodeJson(row?.RUNTIME_PARAM_JSON, {});
                const payload = this.parseNodeJson(row?.NODE_PAYLOAD_JSON, {});
                const jobParams = this.parseNodeJson(row?.JOB_PARAM_JSON, []);
                const payloadParams = Array.isArray(payload.params) ? payload.params
                    : (Array.isArray(payload.PARAMS) ? payload.PARAMS : []);
                const definitionParams = Array.isArray(jobParams) && jobParams.length > payloadParams.length
                    ? jobParams
                    : payloadParams;
                const paramMap = this.buildNodeParamMap(definitionParams);
                const runtimeParamMap = this.buildRuntimeParamValueMap(params);
                const resolveComment = (name, item = null) => {
                    const directComment = item?.comment || item?.COMMENT || item?.itemDesc || item?.ITEM_DESC || "";
                    if (directComment) return String(directComment);
                    const matched = paramMap.get(this.normalizeBindParamKey(name));
                    const matchedComment = this.getNodeParamComment(matched);
                    if (matchedComment) return matchedComment;
                    if (this.isSystemBindName(name)) return this.getSystemBindComment(name, null);
                    return "";
                };
                if (definitionParams.length) {
                    return definitionParams.filter((item) => this.isInputNodeParamDefinition(item)).map((item, index) => {
                        const name = item?.itemName || item?.ITEM_NAME || item?.name || item?.NAME || item?.key || item?.KEY || `PARAM_${index + 1}`;
                        const rawValue = this.getRuntimeParamValueByName(name, runtimeParamMap, this.getNodeParamDefault(item));
                        return {
                            name: String(name),
                            comment: resolveComment(name, item),
                            value: this.resolveRuntimeParamDisplayValue(rawValue, runtimeParamMap)
                        };
                    }).filter((entry) => !this.isInternalNodeRunRuntimeParamName(entry.name, true));
                }
                if (Array.isArray(params)) {
                    return params.map((item, index) => {
                        if (item && typeof item === "object" && !Array.isArray(item)) {
                            const name = item.name || item.NAME || item.key || item.KEY || item.paramName || item.PARAM_NAME || `PARAM_${index + 1}`;
                            const value = Object.prototype.hasOwnProperty.call(item, "value")
                                ? item.value
                                : (Object.prototype.hasOwnProperty.call(item, "VALUE") ? item.VALUE : item);
                            return { name: String(name), comment: resolveComment(name, item), value };
                        }
                        const name = `PARAM_${index + 1}`;
                        return { name, comment: resolveComment(name), value: item };
                    }).filter((entry) => !this.isInternalNodeRunRuntimeParamName(entry.name));
                }
                if (params && typeof params === "object") {
                    return Object.keys(params).sort((a, b) => a.localeCompare(b)).map((name) => ({
                        name,
                        comment: resolveComment(name),
                        value: params[name]
                    })).filter((entry) => !this.isInternalNodeRunRuntimeParamName(entry.name));
                }
                return [];
            },
            buildRuntimeParamValueMap(params = {}) {
                const map = new Map();
                if (Array.isArray(params)) {
                    params.forEach((item, index) => {
                        if (item && typeof item === "object" && !Array.isArray(item)) {
                            const name = item.name || item.NAME || item.key || item.KEY || item.paramName || item.PARAM_NAME || `PARAM_${index + 1}`;
                            const value = Object.prototype.hasOwnProperty.call(item, "value")
                                ? item.value
                                : (Object.prototype.hasOwnProperty.call(item, "VALUE") ? item.VALUE : item);
                            map.set(this.normalizeBindParamKey(name), value);
                        } else {
                            map.set(this.normalizeBindParamKey(`PARAM_${index + 1}`), item);
                        }
                    });
                    return map;
                }
                if (params && typeof params === "object") {
                    Object.entries(params).forEach(([name, value]) => {
                        map.set(this.normalizeBindParamKey(name), value);
                    });
                }
                return map;
            },
            getRuntimeParamValueByName(name, runtimeParamMap, fallback = "") {
                const key = this.normalizeBindParamKey(name);
                return runtimeParamMap.has(key) ? runtimeParamMap.get(key) : fallback;
            },
            resolveRuntimeParamDisplayValue(value, runtimeParamMap) {
                const text = String(value ?? "").trim();
                const bindMatch = text.match(/^:([A-Za-z][A-Za-z0-9_$#]*)$/);
                if (bindMatch) {
                    const key = this.normalizeBindParamKey(bindMatch[1]);
                    if (runtimeParamMap.has(key)) return runtimeParamMap.get(key);
                }
                const tokenMatch = text.match(/^\/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*)\s*--\s*\*\/$/);
                if (tokenMatch) {
                    const key = this.normalizeBindParamKey(tokenMatch[1]);
                    if (runtimeParamMap.has(key)) return runtimeParamMap.get(key);
                }
                return value;
            },
            isInternalNodeRunRuntimeParamName(name, isDeclaredInputParam = false) {
                const rawName = String(name || "");
                if (!rawName) return true;
                if (isDeclaredInputParam) return false;
                if (this.isSystemBindName(rawName) || rawName.toUpperCase().startsWith("INIT$")) return true;
                const internalKeys = new Set([
                    "inputtable",
                    "inputowner",
                    "targetowner",
                    "targettable",
                    "runsourcetype",
                    "runid",
                    "flowrunid"
                ]);
                return internalKeys.has(this.normalizeBindParamKey(rawName));
            },
            formatNodeRunParamValue(value) {
                if (value === null || value === undefined) return "";
                if (typeof value === "object") {
                    try {
                        return JSON.stringify(value, null, 2);
                    } catch {
                        return String(value);
                    }
                }
                return String(value);
            },
            openNodeRunParamsLayer(flowNodeRunId, event = null) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                const row = this.flowNodeRunResultRows?.find((item) => String(item.FLOW_NODE_RUN_ID || "") === String(flowNodeRunId || ""));
                if (!row) return;
                const entries = this.getNodeRunRuntimeParamEntries(row);
                const nodeName = row.NODE_NAME || row.NODE_KEY || "Flow node";
                let layer = document.getElementById(`flowNodeRunParamsLayer-${PAGE_CODE}`);
                if (!layer) {
                    layer = document.createElement("div");
                    layer.id = `flowNodeRunParamsLayer-${PAGE_CODE}`;
                    layer.className = "flow-node-run-param-layer";
                    document.body.appendChild(layer);
                }
                const rowsHtml = entries.length
                    ? entries.map((entry, index) => `
                        <tr>
                            <td class="grid-row-no">${index + 1}</td>
                            <td title="${this.escapeHtml([entry.name, entry.comment].filter(Boolean).join(" - "))}">
                                <span class="flow-node-run-param-key">
                                    <strong>${this.escapeHtml(entry.name)}</strong>
                                    ${entry.comment ? `<small>${this.escapeHtml(entry.comment)}</small>` : ""}
                                </span>
                            </td>
                            <td><pre>${this.escapeHtml(this.formatNodeRunParamValue(entry.value))}</pre></td>
                        </tr>
                    `).join("")
                    : `<tr><td colspan="3" class="table-empty">호출 옵션 파라미터가 없습니다.</td></tr>`;
                layer.innerHTML = `
                    <div class="flow-node-run-param-backdrop" onclick="${PAGE_CODE}.closeNodeRunParamsLayer()"></div>
                    <section class="flow-node-run-param-dialog" role="dialog" aria-modal="true" aria-label="호출 옵션 파라미터">
                        <div class="flow-node-run-param-dragbar" title="Drag to move">
                            <span></span>
                        </div>
                        <header>
                            <span>
                                <strong>${this.escapeHtml(nodeName)}</strong>
                                <small>호출 옵션 파라미터 ${this.escapeHtml(entries.length.toLocaleString())}개</small>
                            </span>
                            <button type="button" class="table-icon-btn" title="Close" onclick="${PAGE_CODE}.closeNodeRunParamsLayer()">
                                <i class="fas fa-times"></i>
                            </button>
                        </header>
                        <div class="flow-node-run-param-summary">
                            <span><strong>FLOW_RUN_ID</strong>${this.escapeHtml(row.FLOW_RUN_ID || "-")}</span>
                            <span><strong>FLOW_NODE_RUN_ID</strong>${this.escapeHtml(row.FLOW_NODE_RUN_ID || "-")}</span>
                            <span><strong>NODE_TYPE</strong>${this.escapeHtml(row.NODE_TYPE || "-")}</span>
                        </div>
                        <div class="flow-node-run-param-body">
                            <table class="table-grid flow-node-run-param-table">
                                <thead>
                                    <tr>
                                        <th class="grid-row-no">No</th>
                                        <th>Parameter</th>
                                        <th>Actual Value</th>
                                    </tr>
                                </thead>
                                <tbody>${rowsHtml}</tbody>
                            </table>
                        </div>
                    </section>
                `;
                layer.hidden = false;
                this.bindNodeRunParamsLayerDrag(layer);
            },
            closeNodeRunParamsLayer() {
                const layer = document.getElementById(`flowNodeRunParamsLayer-${PAGE_CODE}`);
                if (layer) layer.hidden = true;
            },
            bindNodeRunParamsLayerDrag(layer) {
                const dialog = layer?.querySelector(".flow-node-run-param-dialog");
                const handle = layer?.querySelector(".flow-node-run-param-dragbar");
                if (!dialog || !handle) return;
                let dragState = null;
                const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
                const moveDialog = (clientX, clientY) => {
                    if (!dragState) return;
                    const width = dialog.offsetWidth || dragState.width;
                    const height = dialog.offsetHeight || dragState.height;
                    const margin = 12;
                    const left = clamp(clientX - dragState.offsetX, margin, window.innerWidth - width - margin);
                    const top = clamp(clientY - dragState.offsetY, margin, window.innerHeight - height - margin);
                    dialog.style.left = `${left}px`;
                    dialog.style.top = `${top}px`;
                    dialog.style.transform = "none";
                };
                handle.onpointerdown = (event) => {
                    event.preventDefault();
                    const rect = dialog.getBoundingClientRect();
                    dragState = {
                        offsetX: event.clientX - rect.left,
                        offsetY: event.clientY - rect.top,
                        width: rect.width,
                        height: rect.height
                    };
                    handle.setPointerCapture?.(event.pointerId);
                    dialog.classList.add("is-dragging");
                };
                handle.onpointermove = (event) => moveDialog(event.clientX, event.clientY);
                handle.onpointerup = (event) => {
                    dragState = null;
                    dialog.classList.remove("is-dragging");
                    handle.releasePointerCapture?.(event.pointerId);
                };
                handle.onpointercancel = handle.onpointerup;
            },
            getNodeResultInfo(row) {
                const payload = this.parseNodeJson(row?.NODE_PAYLOAD_JSON, {});
                const runtimeParams = this.parseNodeJson(row?.RUNTIME_PARAM_JSON, {});
                const mode = this.normalizeResultCreateMode(payload.resultCreateYn || payload.RESULT_CREATE_YN || "N");
                const owner = payload.resultOwner || payload.RESULT_OWNER || "";
                const objectName = payload.resultTableName || payload.RESULT_TABLE_NAME || "";
                const targetOwner = runtimeParams["INIT$TargetOwner"] || runtimeParams.targetOwner || payload.targetOwner || payload.ownerName || "";
                const targetTable = runtimeParams["INIT$TargetTable"] || runtimeParams.targetTable || payload.targetTable || payload.tableName || "";
                return {
                    flowNodeRunId: row?.FLOW_NODE_RUN_ID || "",
                    flowRunId: row?.FLOW_RUN_ID || "",
                    nodeName: row?.NODE_NAME || row?.NODE_KEY || "",
                    status: String(row?.STATUS || "").toUpperCase(),
                    mode,
                    modeLabel: mode === "M" ? "Model" : (mode === "T" ? "Table" : "None"),
                    owner,
                    objectName,
                    targetOwner,
                    targetTable
                };
            },
            async openFlowNodeResultSql(flowNodeRunId) {
                const row = this.flowNodeRunResultRows.find((item) => String(item.FLOW_NODE_RUN_ID || "") === String(flowNodeRunId || ""));
                const info = this.getNodeResultInfo(row || {});
                if (!info.owner || !info.objectName || info.mode === "N") return;
                await this.loadFlowResultSql(info);
                this.switchTab("resultSql");
            },
            async loadFlowResultSql(info) {
                const params = new URLSearchParams({
                    resultCreateYn: info.mode,
                    owner: info.owner,
                    objectName: info.objectName,
                    targetOwner: info.targetOwner || "",
                    targetTable: info.targetTable || "",
                    flowRunId: info.flowRunId || ""
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/result-sql?${params.toString()}`, {
                    method: "GET",
                    showLoading: false
                });
                const sql = json.data?.sql || "";
                this.setValue(`#flowResultSqlEditor-${PAGE_CODE}`, sql);
                this.setText(`#flowResultSqlTitle-${PAGE_CODE}`, `${info.nodeName || "Node"} Result SQL`);
                const targetHint = info.targetOwner && info.targetTable ? ` / Target ${info.targetOwner}.${info.targetTable}` : "";
                this.setText(`#flowResultSqlHint-${PAGE_CODE}`, `${info.modeLabel}: ${info.owner}.${info.objectName}${targetHint}`);
                this.flowResultSqlGridData = { rows: [], columns: [] };
                this.renderFlowResultSqlMessage("", "info");
                const grid = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE}`);
                if (grid) grid.innerHTML = `<div class="table-empty">Run SQL to preview result data.</div>${this.renderListFooter(0)}`;
            },
            handleFlowResultSqlKeydown(event) {
                if (event.key === "F5") {
                    event.preventDefault();
                    this.executeFlowResultSql(false);
                    return;
                }
                if (event.ctrlKey && event.key === "Enter") {
                    event.preventDefault();
                    this.executeFlowResultSql(false);
                }
            },
            getFlowResultSqlFromEditor(fullSql = false) {
                const editor = getContainerEl(`#flowResultSqlEditor-${PAGE_CODE}`);
                if (!editor) {
                    return { sql: "", selectionStart: 0, selectionEnd: 0 };
                }
                const value = editor.value || "";
                const selectionStart = editor.selectionStart || 0;
                const selectionEnd = editor.selectionEnd || 0;
                if (!fullSql && selectionStart !== selectionEnd) {
                    return {
                        sql: value.slice(selectionStart, selectionEnd).trim(),
                        selectionStart,
                        selectionEnd
                    };
                }
                if (fullSql) {
                    return { sql: value.trim(), selectionStart: 0, selectionEnd: value.length };
                }
                const range = this.findFlowResultSqlStatementRange(value, selectionStart);
                return {
                    sql: value.slice(range.selectionStart, range.selectionEnd).trim(),
                    selectionStart: range.selectionStart,
                    selectionEnd: range.selectionEnd
                };
            },
            findFlowResultSqlStatementRange(value, cursorIndex) {
                let start = value.lastIndexOf(";", Math.max(0, cursorIndex - 1)) + 1;
                let end = value.indexOf(";", cursorIndex);
                if (end < 0) end = value.length;

                const cursorIsBetweenStatements = start > 0 && !value.slice(start, cursorIndex).trim();
                if ((!value.slice(start, end).trim() && start > 0) || cursorIsBetweenStatements) {
                    end = start - 1;
                    start = value.lastIndexOf(";", Math.max(0, end - 1)) + 1;
                }

                while (start < end && /\s/.test(value[start])) start += 1;
                start = this.skipLeadingFlowResultSqlComments(value, start, end);
                while (end > start && /\s/.test(value[end - 1])) end -= 1;
                return { selectionStart: start, selectionEnd: end };
            },
            skipLeadingFlowResultSqlComments(value, start, end) {
                let nextStart = start;
                while (nextStart < end) {
                    while (nextStart < end && /\s/.test(value[nextStart])) nextStart += 1;
                    if (value.startsWith("--", nextStart)) {
                        const lineEnd = value.indexOf("\n", nextStart + 2);
                        nextStart = lineEnd < 0 || lineEnd > end ? end : lineEnd + 1;
                        continue;
                    }
                    if (value.startsWith("/*", nextStart)) {
                        const commentEnd = value.indexOf("*/", nextStart + 2);
                        nextStart = commentEnd < 0 || commentEnd + 2 > end ? end : commentEnd + 2;
                        continue;
                    }
                    break;
                }
                return nextStart;
            },
            restoreFlowResultSqlSelection(selection) {
                const editor = getContainerEl(`#flowResultSqlEditor-${PAGE_CODE}`);
                if (!editor || !selection) return;
                editor.focus();
                editor.setSelectionRange(selection.selectionStart, selection.selectionEnd);
            },
            async executeFlowResultSql(fullSql = false) {
                const selection = this.getFlowResultSqlFromEditor(fullSql);
                const sql = selection.sql || "";
                if (!/^(select|with)\b/i.test(sql.replace(/;+\s*$/, ""))) {
                    CommonMessage.warning("Result SQL must be a SELECT statement.");
                    return;
                }
                const limitValue = Number(this.getValue(`#flowResultSqlLimit-${PAGE_CODE}`) || 100);
                const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? limitValue : 100, 1000));
                const grid = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE}`);
                const startedAt = performance.now();
                this.renderFlowResultSqlMessage("Running SQL...", "info");
                if (grid) {
                    grid.innerHTML = `<div class="table-empty">Executing result SQL...</div>${this.renderListFooter(0)}`;
                }
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/result-sql`, {
                        method: "POST",
                        body: { sql, limit },
                        showLoading: false
                    });
                    const rows = json.data || [];
                    const columns = json.columns || [];
                    const elapsedMs = Math.round(performance.now() - startedAt);
                    this.flowResultSqlGridData = { rows, columns };
                    this.renderFlowResultSqlMessage(`${rows.length.toLocaleString()} rows selected. (${elapsedMs.toLocaleString()} ms)`, "success");
                    this.renderFlowResultSqlGrid(rows, columns);
                    this.restoreFlowResultSqlSelection(selection);
                } catch (error) {
                    const elapsedMs = Math.round(performance.now() - startedAt);
                    this.flowResultSqlGridData = { rows: [], columns: [] };
                    this.renderFlowResultSqlMessage(`${error.message || "Result SQL execution failed."} (${elapsedMs.toLocaleString()} ms)`, "error");
                    this.renderError(`#flowResultSqlGrid-${PAGE_CODE}`, error.message || "Result SQL execution failed.");
                    this.restoreFlowResultSqlSelection(selection);
                }
            },
            renderFlowResultSqlMessage(message, type = "info") {
                const element = getContainerEl(`#flowResultSqlMessage-${PAGE_CODE}`);
                if (!element) return;
                element.className = type === "error" ? "table-error" : "table-empty";
                element.textContent = message || "";
                element.hidden = !message;
            },
            async copyFlowResultSql() {
                const editor = getContainerEl(`#flowResultSqlEditor-${PAGE_CODE}`);
                const value = editor?.value || "";
                if (!value.trim()) return;
                try {
                    await CommonMessage.copyText(value);
                    CommonMessage.success("Result SQL copied.", { copyable: false });
                } catch (error) {
                    CommonMessage.error(error.message || "Result SQL copy failed.");
                }
            },
            exportFlowResultSqlGrid(format) {
                const grid = this.flowResultSqlGridData || {};
                const rows = grid.rows || [];
                if (!rows.length) {
                    CommonMessage.warning("No grid data to export.");
                    return;
                }
                const baseName = this.createFlowResultSqlExportFileName();
                if (format === "excel") {
                    DataEditingSystem.downloadXLSX(rows, `${baseName}.xlsx`, grid.columns);
                    return;
                }
                if (format === "csv") {
                    this.downloadFlowResultSqlBlob(`${baseName}.csv`, this.createFlowResultDelimitedContent(rows, grid.columns, ","), "text/csv;charset=utf-8");
                    return;
                }
                if (format === "tsv") {
                    this.downloadFlowResultSqlBlob(`${baseName}.tsv`, this.createFlowResultDelimitedContent(rows, grid.columns, "\t"), "text/tab-separated-values;charset=utf-8");
                }
            },
            createFlowResultSqlExportFileName() {
                const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
                return `${PAGE_CODE}_RESULT_SQL_${stamp}`;
            },
            createFlowResultDelimitedContent(rows, columnNames = [], delimiter = ",") {
                const columns = this.getFlowResultExportColumns(rows, columnNames);
                const lines = [
                    columns.map((column) => this.escapeFlowResultDelimitedValue(column, delimiter)).join(delimiter),
                    ...rows.map((row) => columns.map((column) => this.escapeFlowResultDelimitedValue(row[column] ?? "", delimiter)).join(delimiter))
                ];
                return `\uFEFF${lines.join("\r\n")}`;
            },
            getFlowResultExportColumns(rows, columnNames = []) {
                return Array.isArray(columnNames) && columnNames.length
                    ? columnNames
                    : Object.keys(rows?.[0] || {});
            },
            escapeFlowResultDelimitedValue(value, delimiter) {
                const text = String(value ?? "");
                const shouldQuote = text.includes('"') || text.includes("\r") || text.includes("\n") || text.includes(delimiter);
                const escaped = text.replace(/"/g, '""');
                return shouldQuote ? `"${escaped}"` : escaped;
            },
            downloadFlowResultSqlBlob(fileName, content, type) {
                const blob = new Blob([content], { type });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
            },
            renderFlowResultSqlGrid(rows = [], columnNames = []) {
                const container = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE}`);
                if (!container) return;
                const dataRows = Array.isArray(rows) ? rows : [];
                const columns = Array.isArray(columnNames) && columnNames.length
                    ? columnNames
                    : Object.keys(dataRows?.[0] || {});
                if (!dataRows.length) {
                    if (!columns.length) {
                        container.innerHTML = `<div class="table-empty">No data.</div>${this.renderListFooter(0)}`;
                        return;
                    }
                    container.innerHTML = `
                        <table class="table-grid flow-result-sql-grid">
                            <thead>
                                <tr>
                                    <th class="grid-row-no">No</th>
                                    ${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                        ${this.renderListFooter(0)}
                    `;
                    return;
                }
                container.innerHTML = `
                    <table class="table-grid flow-result-sql-grid">
                        <thead>
                            <tr>
                                <th class="grid-row-no">No</th>
                                ${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>
                            ${dataRows.map((row, rowIndex) => `
                                <tr>
                                    <td class="grid-row-no">${rowIndex + 1}</td>
                                    ${columns.map((column) => `<td title="${this.escapeHtml(this.formatFlowResultCell(row[column]))}">${this.escapeHtml(this.formatFlowResultCell(row[column]))}</td>`).join("")}
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(dataRows.length)}
                `;
            },
            formatFlowResultCell(value) {
                if (value === null || value === undefined) return "";
                if (typeof value === "object") {
                    try {
                        return JSON.stringify(value);
                    } catch {
                        return String(value);
                    }
                }
                return String(value);
            },
            renderNodeRunMessageCell(row) {
                const flowNodeRunId = row?.FLOW_NODE_RUN_ID || "";
                const message = String(row?.MESSAGE || "");
                if (!message) return "";
                return `
                    <div class="flow-node-run-message">
                        <textarea readonly>${this.escapeHtml(message)}</textarea>
                        <button type="button" class="table-icon-btn" title="Copy message" onclick="${PAGE_CODE}.copyNodeRunMessage('${this.escapeJs(flowNodeRunId)}', event)">
                            <i class="far fa-copy"></i>
                        </button>
                    </div>
                `;
            },
            async copyNodeRunMessage(flowNodeRunId, event) {
                event?.stopPropagation?.();
                const row = this.flowNodeRunResultRows?.find((item) => String(item.FLOW_NODE_RUN_ID || "") === String(flowNodeRunId || ""));
                const message = row?.MESSAGE || "";
                if (!message) return;
                try {
                    await CommonMessage.copyText(message);
                    CommonMessage.success("Node run message copied.", { copyable: false });
                } catch (error) {
                    CommonMessage.error(error.message || "Message copy failed.");
                }
            },
            getRunStatusClass(status) {
                const value = String(status || "").toUpperCase();
                if (value === "SUCCESS") return "is-success";
                if (value === "FAILED") return "is-failed";
                if (value === "RUNNING" || value === "STARTED") return "is-running";
                if (value === "SKIPPED") return "is-skipped";
                return "";
            },
            formatElapsedTime(startedAt, finishedAt, status = "") {
                if (!startedAt) return "";
                const start = this.parseDateTime(startedAt);
                if (!start) return "";
                const statusText = String(status || "").toUpperCase();
                if (!finishedAt && statusText === "QUEUED") return "Queued";
                const isRunning = !finishedAt && ["RUNNING", "STARTED"].includes(statusText);
                if (isRunning) return "Running";
                const finish = finishedAt ? this.parseDateTime(finishedAt) : null;
                if (!finish || finish < start) return "";

                let totalSeconds = Math.floor((finish.getTime() - start.getTime()) / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                totalSeconds %= 3600;
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                const elapsed = `${hours}h ${minutes}m ${seconds}s`;
                return elapsed;
            },
            formatKstDateTime(value) {
                const date = this.parseDateTime(value);
                if (!date) return value || "";
                const parts = new Intl.DateTimeFormat("ko-KR", {
                    timeZone: "Asia/Seoul",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false
                }).formatToParts(date).reduce((acc, part) => {
                    acc[part.type] = part.value;
                    return acc;
                }, {});
                return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
            },
            parseDateTime(value) {
                if (!value) return null;
                if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
                const text = String(value).trim();
                const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
                if (match) {
                    const [, year, month, day, hour, minute, second] = match;
                    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
                        const parsedWithZone = new Date(text);
                        return Number.isNaN(parsedWithZone.getTime()) ? null : parsedWithZone;
                    }
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
            },
            generateNodePlsql() {},
            removeSelectedNode(targetNodeId = "") {
                const nodeId = targetNodeId || this.flowContextMenuState?.nodeId || this.selectedNodeId;
                const node = this.getFlowNode(nodeId);
                if (!node) return;
                this.flowEdges = this.flowEdges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
                this.markFlowEdited();
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                node.remove();
                const nextNode = this.getFlowNodes()[0] || null;
                this.selectedNodeId = "";
                if (nextNode) {
                    this.selectFlowNode(nextNode.dataset.nodeId || "");
                } else {
                    this.clearNodeInspector();
                }
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
            },

            openPortHelp() {
                const layer = getContainerEl(`#portHelpLayer-${PAGE_CODE}`);
                if (layer) layer.hidden = false;
            },

            closePortHelp() {
                const layer = getContainerEl(`#portHelpLayer-${PAGE_CODE}`);
                if (layer) layer.hidden = true;
            },

            newFlow(clearCanvas = true) {
                this.setValue(`#flowId-${PAGE_CODE}`, "NEW");
                this.setValue(`#flowGroup-${PAGE_CODE}`, config.defaultFlowGroup || PAGE_CODE);
                this.setValue(`#flowName-${PAGE_CODE}`, "");
                this.setValue(`#flowDesc-${PAGE_CODE}`, "");
                this.setValue(`#flowUseYn-${PAGE_CODE}`, "Y");
                const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (selector) selector.value = "";
                if (clearCanvas) {
                    this.renderFlowCanvasFromData([], []);
                    this.applyDefaultDraftTemplate();
                } else {
                    this.setSampleFlowState(false);
                }
                this.flowLayoutRestoredFromDb = false;
                this.renderFlowVersions();
                this.updateFlowCopyButton();
                this.updateWorkContextSummary();
            },

            async saveFlow() {
                if (this.isFlowSaving) return;
                if (this.isFlowRunActive()) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert("Select project and scenario first.");
                    return;
                }
                const payload = this.buildFlowPayload();
                this.setFlowSaving(true);
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/save`, {
                        method: "POST",
                        body: payload
                    });
                    if (json.data) {
                        this.applyFlowData(json.data, { preserveZoom: true });
                    }
                    this.flowList = Array.isArray(json.list) ? json.list : this.flowList;
                    this.renderFlowVersions();
                    const savedFlowId = json.data?.FLOW_ID || this.getValue(`#flowId-${PAGE_CODE}`) || "";
                    alert(`${json.message || "Flow saved."}${savedFlowId ? `\nFlow ID: ${savedFlowId}` : ""}`);
                } catch (error) {
                    alert(error.message || "Flow save failed.");
                } finally {
                    this.setFlowSaving(false);
                }
            },

            setFlowSaving(isSaving) {
                this.isFlowSaving = Boolean(isSaving);
                this.updateFlowActionButtons();
            },

            getCurrentFlowRunKey() {
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                return /^\d+$/.test(flowId) ? String(flowId) : "NEW";
            },

            isFlowRunActive(flowKey = this.getCurrentFlowRunKey()) {
                return this.activeFlowRuns.has(String(flowKey || "NEW"));
            },

            transferFlowRunKey(fromKey, toKey) {
                const sourceKey = String(fromKey || "NEW");
                const targetKey = String(toKey || "NEW");
                if (sourceKey === targetKey || !this.activeFlowRuns.has(sourceKey)) return;
                this.activeFlowRuns.set(targetKey, this.activeFlowRuns.get(sourceKey));
                this.activeFlowRuns.delete(sourceKey);
                this.isFlowRunning = this.isFlowRunActive();
                this.updateFlowActionButtons();
                this.renderFlowVersions();
            },

            setFlowRunning(isRunning, flowKey = this.getCurrentFlowRunKey(), label = "") {
                const key = String(flowKey || "NEW");
                if (isRunning) {
                    this.activeFlowRuns.set(key, {
                        label: label || "Running...",
                        startedAt: Date.now()
                    });
                } else {
                    this.activeFlowRuns.delete(key);
                }
                this.isFlowRunning = this.isFlowRunActive();
                this.updateFlowActionButtons();
                this.renderFlowVersions();
            },

            updateFlowActionButtons() {
                const currentRunning = this.isFlowRunActive();
                [`#saveFlowButton-${PAGE_CODE}`, `#deleteFlowButton-${PAGE_CODE}`, `#runFlowNow-${PAGE_CODE}`, `#queueFlowBatch-${PAGE_CODE}`].forEach((selector) => {
                    const button = getContainerEl(selector);
                    if (!button) return;
                    const isSaveButton = selector.includes("saveFlowButton");
                    button.disabled = currentRunning || (isSaveButton && this.isFlowSaving);
                    button.classList.toggle("is-loading", currentRunning || (isSaveButton && this.isFlowSaving));
                });
                const saveButton = getContainerEl(`#saveFlowButton-${PAGE_CODE}`);
                const saveLabel = saveButton?.querySelector("span");
                if (saveLabel) saveLabel.textContent = this.isFlowSaving ? "Saving..." : (FLOW_UI_LABELS.saveFlow || "Save flow");
            },

            stopCanvasRunStatusPolling() {
                if (this.activeCanvasRunPollTimer) {
                    clearTimeout(this.activeCanvasRunPollTimer);
                    this.activeCanvasRunPollTimer = null;
                }
            },

            clearCanvasRunStatusOverlay() {
                this.stopCanvasRunStatusPolling();
                this.activeCanvasRunId = "";
                this.activeCanvasRunFlowKey = "";
                this.activeCanvasRunPollFailures = 0;
                this.getFlowNodes().forEach((node) => {
                    node.classList.remove(
                        "is-flow-run-pending",
                        "is-flow-run-running",
                        "is-flow-run-success",
                        "is-flow-run-failed",
                        "is-flow-run-skipped"
                    );
                    node.querySelector(".flow-node-run-badge")?.remove();
                });
            },

            setCanvasNodeRunStatus(nodeKey, status = "", message = "") {
                const node = this.getFlowNode(nodeKey);
                if (!node) return;
                const value = String(status || "PENDING").toUpperCase();
                node.classList.remove(
                    "is-flow-run-pending",
                    "is-flow-run-running",
                    "is-flow-run-success",
                    "is-flow-run-failed",
                    "is-flow-run-skipped"
                );
                const statusClass = this.getCanvasNodeRunStatusClass(value);
                if (statusClass) node.classList.add(statusClass);
                let badge = node.querySelector(".flow-node-run-badge");
                if (!badge) {
                    badge = document.createElement("span");
                    badge.className = "flow-node-run-badge";
                    node.appendChild(badge);
                }
                badge.textContent = this.getCanvasNodeRunStatusLabel(value);
                badge.title = message || value;
            },

            getCanvasNodeRunStatusClass(status) {
                const value = String(status || "").toUpperCase();
                if (value === "SUCCESS") return "is-flow-run-success";
                if (value === "FAILED" || value === "ERROR") return "is-flow-run-failed";
                if (value === "SKIPPED") return "is-flow-run-skipped";
                if (value === "RUNNING" || value === "STARTED") return "is-flow-run-running";
                if (value === "PENDING" || value === "QUEUED") return "is-flow-run-pending";
                return "";
            },

            getCanvasNodeRunStatusLabel(status) {
                const value = String(status || "").toUpperCase();
                if (value === "SUCCESS") return "SUCCESS";
                if (value === "FAILED" || value === "ERROR") return "FAILED";
                if (value === "SKIPPED") return "SKIPPED";
                if (value === "RUNNING" || value === "STARTED") return "RUNNING";
                return "PENDING";
            },

            focusCanvasRunNode(nodeKey) {
                const node = this.getFlowNode(nodeKey);
                const stage = this.getFlowStage();
                if (!node || !stage) return;
                this.selectFlowNode(nodeKey);
                const position = this.getNodePosition(node);
                const zoom = this.flowZoom || 1;
                stage.scrollTo({
                    left: Math.max(0, (position.left + position.width / 2) * zoom - stage.clientWidth / 2),
                    top: Math.max(0, (position.top + position.height / 2) * zoom - stage.clientHeight / 2),
                    behavior: "smooth"
                });
            },

            startCanvasRunStatusMonitor(flowRunId, plan = [], flowKey = this.getCurrentFlowRunKey()) {
                if (!flowRunId) return;
                this.clearCanvasRunStatusOverlay();
                this.activeCanvasRunId = String(flowRunId);
                this.activeCanvasRunFlowKey = String(flowKey || this.getCurrentFlowRunKey());
                this.activeCanvasRunPollFailures = 0;
                (plan || []).forEach((step) => {
                    if (step?.nodeKey) this.setCanvasNodeRunStatus(step.nodeKey, "PENDING", "Waiting for execution.");
                });
                this.scheduleCanvasRunStatusPoll(250);
            },

            scheduleCanvasRunStatusPoll(delayMs = 1000) {
                this.stopCanvasRunStatusPolling();
                if (!this.activeCanvasRunId) return;
                this.activeCanvasRunPollTimer = setTimeout(() => {
                    this.pollCanvasRunStatus();
                }, Math.max(150, delayMs));
            },

            async pollCanvasRunStatus() {
                const flowRunId = this.activeCanvasRunId;
                if (!flowRunId) return;
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/run/${encodeURIComponent(flowRunId)}/nodes`, {
                        method: "GET",
                        showLoading: false
                    });
                    const rows = Array.isArray(json.data) ? json.data : [];
                    this.activeCanvasRunPollFailures = 0;
                    rows.forEach((row) => {
                        this.setCanvasNodeRunStatus(row.NODE_KEY, row.STATUS, row.MESSAGE || "");
                    });
                    const runningRow = rows.find((row) => ["RUNNING", "STARTED"].includes(String(row.STATUS || "").toUpperCase()));
                    if (runningRow?.NODE_KEY) this.focusCanvasRunNode(runningRow.NODE_KEY);
                    const hasRows = rows.length > 0;
                    const isDone = hasRows && rows.every((row) => this.isTerminalCanvasRunStatus(row.STATUS));
                    if (isDone) {
                        const failedRows = rows.filter((row) => String(row.STATUS || "").toUpperCase() === "FAILED");
                        const failed = failedRows.length > 0;
                        const skipped = rows.some((row) => String(row.STATUS || "").toUpperCase() === "SKIPPED");
                        await this.finishCanvasRunStatusMonitor(
                            failed ? "FAILED" : (skipped ? "COMPLETED_WITH_SKIPS" : "SUCCESS"),
                            failed ? this.buildCanvasRunFailureMessage(failedRows, rows) : ""
                        );
                        return;
                    }
                    const active = this.activeFlowRuns.get(String(this.activeCanvasRunFlowKey || ""));
                    if (active?.startedAt && Date.now() - active.startedAt > 30 * 60 * 1000) {
                        await this.finishCanvasRunStatusMonitor("TIMEOUT");
                        return;
                    }
                    this.scheduleCanvasRunStatusPoll(1000);
                } catch (error) {
                    this.activeCanvasRunPollFailures += 1;
                    if (this.activeCanvasRunPollFailures >= 5) {
                        await this.finishCanvasRunStatusMonitor("POLL_FAILED", error.message || "Run status polling failed.");
                        return;
                    }
                    this.scheduleCanvasRunStatusPoll(1500);
                }
            },

            isTerminalCanvasRunStatus(status) {
                return ["SUCCESS", "FAILED", "SKIPPED"].includes(String(status || "").toUpperCase());
            },

            buildCanvasRunFailureMessage(failedRows = [], allRows = []) {
                const first = failedRows[0] || {};
                const nodeName = first.NODE_NAME || first.NODE_KEY || "Unknown node";
                const nodeKey = first.NODE_KEY || "";
                const rawMessage = String(first.MESSAGE || "").trim();
                const lines = [
                    `Flow run failed at node: ${nodeName}${nodeKey ? ` (${nodeKey})` : ""}`,
                    `실패 노드: ${nodeName}${nodeKey ? ` (${nodeKey})` : ""}`
                ];
                if (rawMessage) {
                    lines.push("", rawMessage);
                }
                const explanation = this.explainCanvasRunFailure(rawMessage, allRows);
                if (explanation) {
                    lines.push("", explanation);
                }
                return lines.join("\n");
            },

            explainCanvasRunFailure(message, allRows = []) {
                const text = String(message || "");
                if (/No Apriori input columns found/i.test(text)) {
                    const runContextHint = /categorical_cols=0/i.test(text)
                        ? "현재 FLOW_RUN_ID에서 M03001 예측 타입 결과 중 범주형 컬럼을 찾지 못했습니다."
                        : "Apriori 학습 후보 컬럼을 만들 수 없습니다.";
                    const upstreamHint = (allRows || []).some((row) => String(row.STATUS || "").toUpperCase() === "SUCCESS")
                        ? "선행 노드 일부는 성공했지만, M03003이 요구하는 M03001 범주형 예측 결과가 현재 실행 컨텍스트에 없거나 0건입니다."
                        : "선행 M03001/M03002 결과가 현재 실행 컨텍스트에 없습니다.";
                    return [
                        "원인 해석:",
                        runContextHint,
                        upstreamHint,
                        "조치: 같은 FLOW_RUN_ID에서 M03001을 RULE 또는 BOTH 방식으로 먼저 실행하거나, 상단 Run now로 처음부터 실행해 주세요."
                    ].join("\n");
                }
                if (/upstream results are missing|선행 노드 실행 결과/i.test(text)) {
                    return [
                        "원인 해석:",
                        "선택 노드부터 실행하려면 같은 FLOW_RUN_ID에 선행 노드의 성공 결과가 먼저 있어야 합니다.",
                        "조치: 선행 노드를 먼저 실행하거나 상단 Run now로 처음부터 실행해 주세요."
                    ].join("\n");
                }
                return "";
            },

            async finishCanvasRunStatusMonitor(resultStatus = "SUCCESS", message = "") {
                const flowKey = String(this.activeCanvasRunFlowKey || this.getCurrentFlowRunKey());
                this.stopCanvasRunStatusPolling();
                this.activeCanvasRunId = "";
                this.activeCanvasRunFlowKey = "";
                this.activeCanvasRunPollFailures = 0;
                this.setFlowRunning(false, flowKey);
                await this.loadFlowRunHistory();
                if (resultStatus === "SUCCESS") {
                    CommonMessage.success("Flow run completed.", { copyable: false });
                } else if (resultStatus === "COMPLETED_WITH_SKIPS") {
                    CommonMessage.warn("Flow run completed with skipped node(s).", { copyable: false });
                } else if (resultStatus === "FAILED") {
                    CommonMessage.error(message || "Flow run finished with failed node(s).", { copyable: true });
                } else if (resultStatus === "TIMEOUT") {
                    CommonMessage.warn("Flow run is still not finished. Check Run History.", { copyable: false });
                } else if (message) {
                    CommonMessage.warn(message, { copyable: false });
                }
            },

            async deleteFlow() {
                if (this.isFlowRunActive()) return;
                const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                if (!/^\d+$/.test(flowId)) {
                    alert("Select a saved flow first.");
                    return;
                }
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert("Select project and scenario first.");
                    return;
                }
                const flowName = this.getValue(`#flowName-${PAGE_CODE}`) || `Flow #${flowId}`;
                if (!(await CommonMessage.confirm(`Delete ${flowName}?\nNodes, edges, and run history for this flow will also be deleted.`))) return;

                try {
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/${encodeURIComponent(flowId)}?${params.toString()}`, {
                        method: "DELETE"
                    });
                    this.flowList = Array.isArray(json.list) ? json.list : [];
                    this.renderFlowVersions();
                    if (this.flowList.length) {
                        await this.loadFlowVersion(this.flowList[0].FLOW_ID);
                    } else {
                        this.newFlow(true);
                        await this.loadFlowRunHistory();
                    }
                    alert(json.message || "Flow deleted.");
                } catch (error) {
                    alert(error.message || "Flow delete failed.");
                }
            },

            async validateFlow() {
                try {
                    const plan = await this.buildExecutionPlan({ switchToPlan: false });
                    CommonMessage.success(`Flow validation succeeded. ${plan.length.toLocaleString()} execution step(s) found.`);
                } catch (error) {
                    CommonMessage.error(error.message || "Flow validation failed.");
                }
            },

            async runFlow(batch = false) {
                const flowKey = this.getCurrentFlowRunKey();
                if (this.isFlowRunActive(flowKey)) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert("Select project and scenario first.");
                    return;
                }
                const flowName = this.getValue(`#flowName-${PAGE_CODE}`).trim() || this.getFlowNameForSave();
                const actionNameEn = batch ? "Queue batch" : "Run now";
                const actionNameKo = batch ? "배치 대기열 등록" : "지금 실행";
                const confirmMessage = [
                    `${actionNameEn}: "${flowName}"`,
                    `${actionNameKo}: "${flowName}"`,
                    "",
                    "This will save the current flow, validate the DAG, and create a run history record.",
                    "현재 플로우를 저장하고 DAG를 검증한 뒤 실행 이력 기록을 생성합니다.",
                    "",
                    "Continue?"
                ].join("\n");
                this.setFlowRunning(true, flowKey, batch ? "Queue batch running..." : "Run now running...");
                if (!(await CommonMessage.confirm(confirmMessage))) {
                    this.setFlowRunning(false, flowKey);
                    return;
                }
                const payload = {
                    ...this.buildFlowPayload(),
                    batch: Boolean(batch)
                };
                const manualRunId = await this.confirmManualFlowRunIdOverwrite(payload);
                if (manualRunId === null) {
                    this.setFlowRunning(false, flowKey);
                    return;
                }
                if (manualRunId) payload.manualRunId = Number(manualRunId);
                let keepCanvasRunActive = false;
                let activeFlowKey = flowKey;
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/run`, {
                        method: "POST",
                        body: payload,
                        showLoading: false
                    });
                    const stillSelected = this.getCurrentFlowRunKey() === flowKey;
                    if (json.data?.flowId) {
                        if (stillSelected || flowKey === "NEW") {
                            this.setValue(`#flowId-${PAGE_CODE}`, json.data.flowId);
                        }
                        if (flowKey === "NEW") {
                            this.transferFlowRunKey(flowKey, String(json.data.flowId));
                        }
                        activeFlowKey = String(json.data.flowId);
                        await this.loadFlowVersions(false);
                        const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                        if (selector && (stillSelected || flowKey === "NEW")) selector.value = json.data.flowId;
                    }
                    await this.loadFlowRunHistory();
                    if (!batch && json.data?.flowRunId && (stillSelected || flowKey === "NEW")) {
                        keepCanvasRunActive = true;
                        this.switchTab("designer");
                        this.startCanvasRunStatusMonitor(json.data.flowRunId, json.data.plan || [], activeFlowKey);
                        CommonMessage.success(json.message || "Flow execution started.", { copyable: false });
                    } else if (stillSelected || flowKey === "NEW") {
                        this.switchTab("history");
                        alert(json.message || "Flow run recorded.");
                    } else {
                        CommonMessage.success(json.message || "Flow run recorded.", { copyable: false });
                    }
                } catch (error) {
                    alert(error.message || "Flow run failed.");
                } finally {
                    if (!keepCanvasRunActive) this.setFlowRunning(false, activeFlowKey);
                }
            },

            async runSelectedNode(options = {}) {
                const runDownstream = Boolean(options.downstream);
                const flowKey = this.getCurrentFlowRunKey();
                if (this.isFlowRunActive(flowKey)) return;
                const nodeId = this.flowContextMenuState?.nodeId || this.selectedNodeId;
                const node = this.getFlowNode(nodeId);
                if (!node) {
                    alert("Select a node first.\n먼저 실행할 노드를 선택해 주세요.");
                    return;
                }
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert("Select project and scenario first.\n먼저 프로젝트와 시나리오를 선택해 주세요.");
                    return;
                }
                const nodeName = node.querySelector(".flow-node-body strong")?.textContent?.trim() || nodeId;
                const actionTitle = runDownstream ? "Run from selected node" : "Run selected node";
                const actionTitleKo = runDownstream ? "선택 노드부터 이후 실행" : "선택 노드 실행";
                const confirmMessage = [
                    `${actionTitle}: "${nodeName}"`,
                    `${actionTitleKo}: "${nodeName}"`,
                    "",
                    runDownstream
                        ? "This will save the current flow, validate the DAG, and run the selected node plus downstream nodes."
                        : "This will save the current flow, validate the DAG, and run only the selected node.",
                    runDownstream
                        ? "현재 플로우를 저장하고 DAG를 검증한 뒤 선택 노드와 이후 연결 노드를 실행합니다."
                        : "현재 플로우를 저장하고 DAG를 검증한 뒤 선택 노드만 실행합니다.",
                    ...(runDownstream ? [
                        "",
                        "If the selected node has upstream dependencies, the run will continue from a previous FLOW_RUN_ID with successful upstream node results.",
                        "선택 노드에 선행 노드가 있으면, 선행 노드가 성공한 기존 FLOW_RUN_ID를 이어서 실행합니다.",
                        "If no compatible run exists, execution stops before running the node.",
                        "이어 쓸 실행 컨텍스트가 없으면 노드를 실행하기 전에 중단합니다."
                    ] : []),
                    "",
                    "Continue?"
                ].join("\n");
                this.setFlowRunning(true, flowKey, runDownstream ? `Running from node: ${nodeName}` : `Node running: ${nodeName}`);
                if (!(await CommonMessage.confirm(confirmMessage))) {
                    this.setFlowRunning(false, flowKey);
                    return;
                }
                const payload = {
                    ...this.buildFlowPayload(),
                    nodeKey: nodeId,
                    downstream: runDownstream
                };
                const manualRunId = await this.confirmManualFlowRunIdOverwrite(payload, nodeId);
                if (manualRunId === null) {
                    this.setFlowRunning(false, flowKey);
                    return;
                }
                if (manualRunId) payload.manualRunId = Number(manualRunId);
                let keepCanvasRunActive = false;
                let activeFlowKey = flowKey;
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/run-node`, {
                        method: "POST",
                        body: payload,
                        showLoading: false
                    });
                    const stillSelected = this.getCurrentFlowRunKey() === flowKey;
                    if (json.data?.flowId) {
                        if (stillSelected || flowKey === "NEW") {
                            this.setValue(`#flowId-${PAGE_CODE}`, json.data.flowId);
                        }
                        if (flowKey === "NEW") {
                            this.transferFlowRunKey(flowKey, String(json.data.flowId));
                        }
                        activeFlowKey = String(json.data.flowId);
                        await this.loadFlowVersions(false);
                        const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                        if (selector && (stillSelected || flowKey === "NEW")) selector.value = json.data.flowId;
                    }
                    await this.loadFlowRunHistory();
                    if (json.data?.flowRunId && (stillSelected || flowKey === "NEW")) {
                        keepCanvasRunActive = true;
                        this.switchTab("designer");
                        this.startCanvasRunStatusMonitor(json.data.flowRunId, json.data.plan || [], activeFlowKey);
                        CommonMessage.success(json.message || `${actionTitle} started.`, { copyable: false });
                    } else {
                        CommonMessage.success(json.message || `${actionTitle} started.`, { copyable: false });
                    }
                } catch (error) {
                    CommonMessage.error(error.message || `${actionTitle} failed.`, { copyable: true });
                } finally {
                    if (!keepCanvasRunActive) this.setFlowRunning(false, activeFlowKey);
                }
            }
        };

        window[PAGE_CODE] = page;
        return page;
    };
})();
