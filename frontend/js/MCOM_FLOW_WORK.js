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
        const FLOW_NODE_DEFAULT_WIDTH = 210;
        const FLOW_NODE_DEFAULT_HEIGHT = 164;
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
            flowResultSqlColumnWidths: {},
            flowResultSqlFrozenColumns: 0,
            flowResultSqlResizeState: null,
            flowResultSqlResizeMoveBound: null,
            flowResultSqlResizeUpBound: null,
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
            flowLayoutGrid: null,
            minFlowZoom: 0.45,
            maxFlowZoom: 1.8,
            selectedNodeId: "",
            selectedNodeIds: new Set(),
            selectedEdgeId: "",
            flowNodeSelectionHistory: [],
            flowNodeClickState: null,
            suppressNextFlowNodeClick: false,
            nodeDragState: null,
            canvasPanState: null,
            canvasSelectionState: null,
            flowCanvasSelectionMode: false,
            edgeDragState: null,
            dashedConnectionMode: false,
            flowPaletteDragData: null,
            flowPaletteDragOffset: null,
            flowPaletteDragImage: null,
            flowNodeClipboard: null,
            flowNodeClipboardPasteCount: 0,
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
            flowMenuPointerDownBound: null,
            flowMenuMouseDownBound: null,
            flowMenuContextMenuBound: null,
            suppressNextFlowMenuClick: false,
            flowMenuPressGuard: null,
            flowDocumentClickBound: null,
            flowDocumentKeydownBound: null,
            flowEdgeLayerClickBound: null,
            flowEdges: [],

            async init() {
                if (this.isInit) return;
                this.applyUiLabels();
                this.removeFlowVersionCountLabel();
                this.resetFlowResultSqlPlaceholder();
                await this.loadWorkContext();
                this.switchTab("designer");
                this.setupFlowDesigner();
                this.setFlowInspectorCollapsed(true);
                this.setFlowCanvasSelectionMode(false);
                this.isInit = true;
            },

            destroy() {
                this.closeNodeRunParamsLayer();
                this.endFlowResultSqlColumnResize();
                this.disposePaletteDragImage();
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
                this.flowResultSqlColumnWidths = {};
                this.flowResultSqlFrozenColumns = 0;
                this.flowResultSqlResizeState = null;
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
                this.selectedNodeIds = new Set();
                this.flowNodeSelectionHistory = [];
                this.flowNodeClickState = null;
                this.suppressNextFlowNodeClick = false;
                this.suppressNextFlowMenuClick = false;
                this.flowMenuPressGuard = null;
                this.nodeDragState = null;
                this.canvasPanState = null;
                this.canvasSelectionState = null;
                this.flowCanvasSelectionMode = false;
                this.edgeDragState = null;
                this.dashedConnectionMode = false;
                this.flowPaletteDragData = null;
                this.flowPaletteDragOffset = null;
                this.flowNodeClipboard = null;
                this.flowNodeClipboardPasteCount = 0;
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
                        element.hidden = value === "" && element.classList.contains("env-detail-hint");
                    });
                    container.querySelectorAll(`[data-title-key="${key}"]`).forEach((element) => {
                        element.setAttribute("title", value);
                    });
                    container.querySelectorAll(`[data-placeholder-key="${key}"]`).forEach((element) => {
                        element.setAttribute("placeholder", value);
                    });
                });
                this.removeFlowVersionCountLabel();
            },

            resetFlowResultSqlPlaceholder() {
                const editor = getContainerEl(`#flowResultSqlEditor-${PAGE_CODE}`);
                if (!editor) return;
                const oldPlaceholder = "-- Select a node result from Run History details.";
                if (!editor.value.trim() || editor.value.trim() === oldPlaceholder) {
                    editor.value = `-- ${this.getMessage("resultSqlSelectHint", "Select a node result from Run History details.")}`;
                }
            },

            getMessage(key, fallback = "", values = {}) {
                const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
                const messages = pack.messages || {};
                const labels = window[`${PAGE_CODE}_FLOW_UI_LABELS`] || FLOW_UI_LABELS || {};
                let text = Object.prototype.hasOwnProperty.call(messages, key)
                    ? String(messages[key] ?? "")
                    : (Object.prototype.hasOwnProperty.call(labels, key) ? String(labels[key] ?? "") : String(fallback ?? ""));
                Object.entries(values || {}).forEach(([name, value]) => {
                    text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value ?? ""));
                });
                return text;
            },

            getLabel(key, fallback = "") {
                const labels = window[`${PAGE_CODE}_FLOW_UI_LABELS`]
                    || window[`${PAGE_CODE}_PAGE_I18N`]?.labels
                    || FLOW_UI_LABELS
                    || {};
                if (Object.prototype.hasOwnProperty.call(labels, key)) {
                    return String(labels[key] ?? "");
                }
                if (Object.prototype.hasOwnProperty.call(FLOW_UI_LABELS, key)) {
                    return String(FLOW_UI_LABELS[key] ?? "");
                }
                return String(fallback ?? "");
            },

            removeFlowVersionCountLabel() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                container?.querySelectorAll?.(`#flowVersionCount-${PAGE_CODE}, .flow-version-count`).forEach((element) => {
                    element.remove();
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

            saveStoredContext(options = {}) {
                const optionKeys = options && typeof options === "object" ? Object.keys(options) : [];
                const hasFlowIdOption = optionKeys.includes("flowId");
                const currentFlowId = String(this.getValue(`#flowId-${PAGE_CODE}`) || "").trim();
                const storedFlowId = hasFlowIdOption
                    ? String(options.flowId || "").trim()
                    : (/^\d+$/.test(currentFlowId) ? currentFlowId : "");
                localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({
                    projectId: this.selectedProjectId || "",
                    scenarioId: this.selectedScenarioId || "",
                    flowId: /^\d+$/.test(storedFlowId) ? storedFlowId : ""
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
                await this.loadFlowVersions(true, { refreshHistory: true, preferredFlowId: stored.flowId || "" });
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
                        <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(project))}" value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                            ${this.escapeHtml(CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || "(Untitled project)"))}
                        </option>
                    `).join("")}
                `;

                const exists = this.contextProjects.some((project) => String(project.PROJECT_ID) === String(preferredProjectId));
                this.selectedProjectId = exists ? String(preferredProjectId) : "";
                select.value = this.selectedProjectId;
                CommonUtils.applyOwnerScopeToSelect(select, this.contextProjects, this.selectedProjectId);
            },

            async handleContextProjectChange(projectId) {
                this.selectedProjectId = projectId || "";
                CommonUtils.applyOwnerScopeToSelect(getContainerEl(`#contextProject-${PAGE_CODE}`), this.contextProjects, this.selectedProjectId);
                this.selectedScenarioId = "";
                this.selectedScenarioTableKey = "";
                this.saveStoredContext({ flowId: "" });
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
                        <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(scenario))}" value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                            ${this.escapeHtml(CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "(Untitled scenario)"))}
                        </option>
                    `).join("")}
                `;

                const exists = this.contextScenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
                const firstScenarioId = this.contextScenarios.length ? String(this.contextScenarios[0].SCENARIO_ID ?? "") : "";
                this.selectedScenarioId = exists ? String(preferredScenarioId) : firstScenarioId;
                select.value = this.selectedScenarioId;
                CommonUtils.applyOwnerScopeToSelect(select, this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
                this.saveStoredContext();
            },

            async handleContextScenarioChange(scenarioId) {
                this.selectedScenarioId = scenarioId || "";
                CommonUtils.applyOwnerScopeToSelect(getContainerEl(`#contextScenario-${PAGE_CODE}`), this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
                this.selectedScenarioTableKey = "";
                this.saveStoredContext({ flowId: "" });
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
                    this.loadFlowModelContracts(),
                    this.loadRegisteredJobs(),
                    this.loadDefaultVariables()
                ]);
                this.bindFlowPalette();
            },

            async loadFlowModelContracts() {
                try {
                    const response = await fetch(PageManager.getAssetUrl("./config/flow-model-contracts.json"), {
                        cache: "no-store",
                        credentials: "include"
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    this.flowContractCatalog = await response.json();
                } catch (error) {
                    console.warn("[FLOW] Model contract load failed.", error);
                    this.flowContractCatalog = { artifacts: {}, models: {} };
                }
            },

            getFlowModelName(data = {}, refJob = null) {
                return String(
                    data.execObjectName
                    || data.EXEC_OBJECT_NAME
                    || data.execMethod
                    || data.EXEC_METHOD
                    || refJob?.EXEC_OBJECT_NAME
                    || refJob?.EXEC_METHOD
                    || ""
                ).trim().toUpperCase();
            },

            getFlowModelContract(data = {}, refJob = null) {
                const modelName = this.getFlowModelName(data, refJob);
                return this.flowContractCatalog?.models?.[modelName] || null;
            },

            getFlowArtifactDefinition(artifact) {
                return this.flowContractCatalog?.artifacts?.[String(artifact || "").toUpperCase()] || {};
            },

            getFlowContractParamValue(data = {}, refJob = null, name = "", fallback = "") {
                const targetKey = this.normalizeBindParamKey(name);
                const dataParams = Array.isArray(data.params) ? data.params : [];
                const refParams = this.parseNodeJson(refJob?.PARAM_JSON, []);
                const item = [...dataParams, ...(Array.isArray(refParams) ? refParams : [])].find((candidate) =>
                    this.getNodeParamMatchKeys(candidate).includes(targetKey)
                );
                if (!item) return fallback;
                const value = item.value ?? item.VALUE ?? item.itemDefault ?? item.ITEM_DEFAULT ?? item.defaultValue;
                return value === undefined || value === null || String(value).trim() === "" ? fallback : value;
            },

            isFlowContractPortRequired(item = {}, data = {}, refJob = null) {
                if (item.required !== true) return false;
                const requiredWhen = item.requiredWhen;
                if (!requiredWhen?.param) return true;
                const actual = String(this.getFlowContractParamValue(
                    data,
                    refJob,
                    requiredWhen.param,
                    requiredWhen.default || ""
                ) || "").trim().toUpperCase();
                const included = new Set((requiredWhen.in || []).map((value) => String(value || "").trim().toUpperCase()));
                const excluded = new Set((requiredWhen.notIn || []).map((value) => String(value || "").trim().toUpperCase()));
                if (included.size && !included.has(actual)) return false;
                return !excluded.has(actual);
            },

            isFlowContractPortActive(item = {}, data = {}, refJob = null) {
                const requiredParts = new Set((item.requiredForParts || []).map((value) => String(value || "").trim().toUpperCase()));
                if (!requiredParts.size) return true;
                const rawParts = String(this.getFlowContractParamValue(data, refJob, "P_RULE_PARTS", "ALL") || "ALL").trim().toUpperCase();
                if (!rawParts || ["ALL", "BOTH", "AUTO", "(AUTO)"].includes(rawParts)) return true;
                const activeParts = new Set(rawParts.split(/[,;\s]+/).map((value) => {
                    if (["CAT", "CATEGORY", "ASSOC", "ASSOCIATION", "APRIORI"].includes(value)) return "CATEGORICAL";
                    if (["NUM", "NUMERIC", "CONT", "LASSO", "SYMBOLIC", "REGRESSION"].includes(value)) return "CONTINUOUS";
                    return value;
                }).filter(Boolean));
                return [...requiredParts].some((value) => activeParts.has(value));
            },

            getFlowContractPorts(data = {}, direction = "in", refJob = null) {
                const contract = this.getFlowModelContract(data, refJob);
                const key = direction === "in" ? "inputs" : "outputs";
                return (contract?.[key] || []).filter((item) => (
                    direction !== "in" || this.isFlowContractPortActive(item, data, refJob)
                )).map((item) => {
                    const artifact = String(item.artifact || "").toUpperCase();
                    const definition = this.getFlowArtifactDefinition(artifact);
                    return {
                        ...item,
                        port: item.port || artifact.toLowerCase(),
                        artifact,
                        label: item.label || definition.label || artifact,
                        kind: item.kind || definition.kind || "TABLE",
                        shape: item.shape || definition.shape || "square",
                        required: direction === "in"
                            ? this.isFlowContractPortRequired(item, data, refJob)
                            : item.required === true
                    };
                });
            },

            async loadRegisteredJobs() {
                const container = getContainerEl(`#flowRegisteredJobGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    this.flowRegisteredJobs = [];
                    container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>`;
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
                    container.innerHTML = `<div class="table-empty">No registered jobs for this scenario.</div>`;
                    return;
                }

                const groups = this.groupRegisteredJobs();
                container.innerHTML = `
                    <div class="flow-job-group-list">
                        ${groups.map((group) => this.renderRegisteredJobGroup(group)).join("")}
                    </div>
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
                    M03001: this.getMessage("nodeTypeM03001", "Column Type Analysis"),
                    M03002: this.getMessage("nodeTypeM03002", "Column Correlation Analysis"),
                    M03003: this.getMessage("nodeTypeM03003", "Rule Discovery"),
                    M03004: this.getMessage("nodeTypeM03004", "Rule Violation")
                };
                return knownLabels[type] || match?.NODE_TYPE_NAME || fallbackLabel || type || "JOB";
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
                    execObjectName: source.EXEC_OBJECT_NAME || fallback.execObjectName || "",
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
                const preferredFlowId = /^\d+$/.test(String(options.preferredFlowId || ""))
                    ? String(options.preferredFlowId)
                    : "";
                const currentFlowId = forceDraft ? "" : (preferredFlowId || this.getValue(`#flowId-${PAGE_CODE}`));
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
                    const preferredExists = Boolean(preferredFlowId)
                        && this.flowList.some((flow) => String(flow.FLOW_ID) === String(preferredFlowId));
                    if (loadLatest && preferredExists) {
                        await this.loadFlowVersion(preferredFlowId, { refreshHistory });
                    } else if (loadLatest && this.flowList.length) {
                        await this.loadFlowVersion(this.flowList[0].FLOW_ID, { refreshHistory });
                    } else if (/^\d+$/.test(currentFlowId)) {
                        const exists = this.flowList.some((flow) => String(flow.FLOW_ID) === String(currentFlowId));
                        if (exists) {
                            if (select) select.value = currentFlowId;
                            this.renderFlowVersions();
                        } else {
                            this.saveStoredContext({ flowId: "" });
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
                this.removeFlowVersionCountLabel();
                if (countLabel) {
                    countLabel.remove();
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
                this.removeFlowVersionCountLabel();
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
                    button.title = this.flowSidebarCollapsed
                        ? this.getLabel("expandFlowAssetsTitle", "Expand Scenario Name")
                        : this.getLabel("collapseFlowAssetsTitle", "Collapse Scenario Name");
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
                    alert(this.getMessage("selectSavedFlowBeforeReload", "Select a saved flow before refreshing the canvas."));
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
                const summary = getContainerEl(`#workContextSummary-${PAGE_CODE}`);
                if (!project && !scenario) {
                    if (summary) {
                        summary.dataset.labelKey = "contextSummaryEmpty";
                        summary.textContent = this.getMessage("contextSummaryEmpty", "No context selected.");
                    }
                    this.updateFlowPanelTitles(scenario);
                    return;
                }
                if (summary) delete summary.dataset.labelKey;
                const parts = [
                    project ? `${this.getMessage("contextSummaryProject", "Project")}: ${CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || "-")}` : `${this.getMessage("contextSummaryProject", "Project")}: -`,
                    scenario ? `${this.getMessage("contextSummaryScenario", "Scenario")}: ${CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "-")}` : `${this.getMessage("contextSummaryScenario", "Scenario")}: -`,
                    this.getCurrentFlowSummary()
                ];
                this.setText(`#workContextSummary-${PAGE_CODE}`, parts.join(" / "));
                this.updateFlowPanelTitles(scenario);
            },

            updateFlowPanelTitles(scenario = null) {
                const scenarioName = scenario ? CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "") : "";
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
                    if (label) {
                        const labelKey = this.workContextCollapsed ? "changeContext" : "hideContext";
                        label.dataset.labelKey = labelKey;
                        label.textContent = this.getLabel(labelKey);
                    }
                }
            },

            switchTab(tabName) {
                this.activeTab = tabName || "designer";
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                if (this.activeTab !== "designer" && container.classList.contains("is-flow-canvas-maximized")) {
                    container.classList.remove("is-flow-canvas-maximized");
                    this.restoreSidebarsAfterCanvasMaximize();
                    this.renderCanvasMaximizeToggle(false);
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
                this.flowMenuPointerDownBound = (event) => this.handleFlowMenuPointerDown(event);
                this.flowMenuMouseDownBound = (event) => this.handleFlowMenuPointerDown(event);
                this.flowMenuContextMenuBound = (event) => this.handleFlowMenuContextMenu(event);
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
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                menu?.addEventListener("pointerdown", this.flowMenuPointerDownBound, true);
                menu?.addEventListener("mousedown", this.flowMenuMouseDownBound, true);
                menu?.addEventListener("contextmenu", this.flowMenuContextMenuBound);
                menu?.addEventListener("click", this.flowMenuClickBound);
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
                    label.textContent = this.getMessage("sampleTemplateReady", "This is a job template. Review the nodes and edges, then save it.");
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
                        start.left + index * (FLOW_NODE_DEFAULT_WIDTH + 120),
                        start.top
                    );
                    if (!node) return;
                    node.dataset.sampleNode = "Y";
                    viewport.appendChild(node);
                    this.bindFlowNode(node);
                    createdNodes.push(node);
                });

                let nextLeft = start.left;
                createdNodes.forEach((node) => {
                    const nodeWidth = this.getNodePosition(node).width || FLOW_NODE_DEFAULT_WIDTH;
                    const connectorGap = Math.max(120, Math.round(nodeWidth * 0.65));
                    this.setNodePosition(node, nextLeft, start.top, { update: false });
                    nextLeft += nodeWidth + connectorGap;
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
                const preferredModels = {
                    M03001: "INIT$_SP_PREDICTED_TYPE",
                    M03002: "INTEGRATED_RELATION_CLUSTER",
                    M03003: "INTEGRATED_RULE_DISCOVER",
                    M03004: "INTEGRATED_RULE_VIOLATION_DETECT"
                };
                return this.groupRegisteredJobs()
                    .map((group) => {
                        const preferred = preferredModels[String(group.key || "").toUpperCase()];
                        return group.jobs.find((job) => (
                            String(job.EXEC_OBJECT_NAME || job.EXEC_METHOD || "").toUpperCase() === preferred
                        )) || group.jobs[0];
                    })
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
                const pair = this.findCompatibleFlowPortPair(fromNode, toNode);
                const fromPort = pair.fromPort || this.getDefaultOutputPort(fromNode.dataset.nodeType || "");
                const toPort = pair.toPort || this.getDefaultInputPort(toNode.dataset.nodeType || "");
                if (!fromPort || !toPort) return null;
                return {
                    from: fromNode.dataset.nodeId || "",
                    fromPort: this.normalizeFlowPortName(fromPort, "output"),
                    to: toNode.dataset.nodeId || "",
                    toPort: this.normalizeFlowPortName(toPort, "input"),
                    dashed: false,
                    mode: "SERIAL",
                    params: this.buildDefaultEdgeParams(fromNode, toNode, toPort, false, fromPort)
                };
            },

            clearFlowCanvas() {
                if (!this.getFlowNodes().length && !this.flowEdges.length) {
                    return;
                }
                this.getFlowNodes().forEach((node) => node.remove());
                this.getFlowViewport()?.querySelector(".flow-selection-box")?.remove();
                this.flowEdges = [];
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                this.clearFlowNodeSelection({ store: false, syncBeforeStore: false });
                this.setSampleFlowState(false);
                const label = getContainerEl(`#selectedFlowLabel-${PAGE_CODE}`);
                if (label) label.textContent = this.getMessage("flowCanvasEmpty", "The canvas is empty. Drag jobs from the left or add nodes from the canvas menu to build a flow.");
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
                    stage.classList.remove("is-panning", "is-selection-mode");
                }
                if (this.flowNodePointerMoveBound) document.removeEventListener("pointermove", this.flowNodePointerMoveBound);
                if (this.flowNodePointerUpBound) document.removeEventListener("pointerup", this.flowNodePointerUpBound);
                if (this.flowCanvasPointerMoveBound) document.removeEventListener("pointermove", this.flowCanvasPointerMoveBound);
                if (this.flowCanvasPointerUpBound) document.removeEventListener("pointerup", this.flowCanvasPointerUpBound);
                if (this.flowDocumentClickBound) document.removeEventListener("click", this.flowDocumentClickBound);
                if (this.flowDocumentKeydownBound) document.removeEventListener("keydown", this.flowDocumentKeydownBound);
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                menu?.removeEventListener("pointerdown", this.flowMenuPointerDownBound, true);
                menu?.removeEventListener("mousedown", this.flowMenuMouseDownBound, true);
                menu?.removeEventListener("contextmenu", this.flowMenuContextMenuBound);
                menu?.removeEventListener("click", this.flowMenuClickBound);
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
                this.flowMenuPointerDownBound = null;
                this.flowMenuMouseDownBound = null;
                this.flowMenuContextMenuBound = null;
                this.suppressNextFlowMenuClick = false;
                this.flowMenuPressGuard = null;
                this.flowDocumentClickBound = null;
                this.flowDocumentKeydownBound = null;
                this.flowEdgeLayerClickBound = null;
                this.flowPaletteDragData = null;
                this.flowPaletteDragOffset = null;
                this.disposePaletteDragImage();
                this.flowContextMenuState = null;
                this.canvasSelectionState = null;
                this.flowDesignerBound = false;
            },

            bindFlowNode(node) {
                if (!node || node.dataset.flowBound === "Y") return;
                node.dataset.flowBound = "Y";
                this.ensureNodeConnectors(node);
                node.addEventListener("pointerdown", (event) => this.handleNodePointerDown(event, node));
                node.addEventListener("click", (event) => this.handleFlowNodeClick(event, node));
                node.addEventListener("dblclick", (event) => this.handleFlowNodeDblClick(event, node));
                this.bindFlowPorts(node);
            },

            handleFlowNodeClick(event, node) {
                event.stopPropagation();
                if (this.suppressNextFlowNodeClick) {
                    this.suppressNextFlowNodeClick = false;
                    return;
                }
                const nodeId = node?.dataset.nodeId || "";
                if (!nodeId) return;
                if (event.ctrlKey || event.metaKey) {
                    this.toggleFlowNodeSelection(nodeId);
                    this.flowNodeClickState = null;
                    return;
                }
                const now = Date.now();
                const lastClick = this.flowNodeClickState || {};
                this.selectFlowNode(nodeId);
                if (lastClick.nodeId === nodeId && now - Number(lastClick.at || 0) <= 420) {
                    this.openFlowNodeInspector(nodeId);
                    this.flowNodeClickState = null;
                    return;
                }
                this.flowNodeClickState = { nodeId, at: now };
            },

            handleFlowNodeDblClick(event, node) {
                event.preventDefault();
                event.stopPropagation();
                this.openFlowNodeInspector(node?.dataset.nodeId || "");
                this.flowNodeClickState = null;
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
                const contract = this.getFlowModelContract({
                    execObjectName: node.dataset.execObjectName,
                    execMethod: node.dataset.execMethod
                });
                const stage = Number(contract?.stage || 0);
                const inputShape = this.getDominantNodePortShape(node, "in");
                const outputShape = this.getDominantNodePortShape(node, "out") || inputShape;
                const inputConnector = node.querySelector(".flow-connector-in");
                const outputConnector = node.querySelector(".flow-connector-out");
                if (inputConnector) {
                    inputConnector.dataset.portShape = inputShape;
                    inputConnector.classList.toggle("is-hidden", stage === 1);
                }
                if (outputConnector) {
                    outputConnector.dataset.portShape = outputShape;
                    outputConnector.classList.toggle("is-hidden", stage === 4);
                }
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
                        if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = "copy";
                            const dragImage = this.createPaletteDragImage(this.flowPaletteDragData);
                            if (dragImage) {
                                event.dataTransfer.setDragImage(dragImage.element, dragImage.offsetX, dragImage.offsetY);
                                this.flowPaletteDragOffset = {
                                    x: dragImage.logicalOffsetX,
                                    y: dragImage.logicalOffsetY
                                };
                            }
                        }
                    });
                    item.addEventListener("dragend", () => {
                        this.disposePaletteDragImage();
                        this.flowPaletteDragData = null;
                        this.flowPaletteDragOffset = null;
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

            createPaletteDragImage(data) {
                this.disposePaletteDragImage();
                const nodeType = data?.nodeType || "JOB";
                const nodeTypeLabel = data?.nodeTypeLabel || this.getNodeTypeLabel(nodeType);
                const inputHtml = this.renderNodePortSpans(this.getRenderInputPorts(nodeType, data), "in", "TABLE");
                const outputHtml = this.renderNodePortSpans(
                    this.getRenderOutputPorts(nodeType, data),
                    "out",
                    this.getNodeOutputAssetKind(data)
                );
                const zoom = this.flowZoom || 1;
                const width = FLOW_NODE_DEFAULT_WIDTH;
                const height = FLOW_NODE_DEFAULT_HEIGHT;
                const element = document.createElement("article");
                element.className = "data-param-card flow-node flow-node-step flow-node-drag-image";
                element.style.left = "-10000px";
                element.style.top = "-10000px";
                element.style.width = `${width}px`;
                element.style.minHeight = `${height}px`;
                element.style.position = "fixed";
                element.style.transform = `scale(${zoom})`;
                element.style.transformOrigin = "0 0";
                element.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong title="${this.escapeHtml(nodeTypeLabel)}">${this.escapeHtml(nodeTypeLabel)}</strong>
                        <span class="data-job-order">NEW</span>
                    </header>
                    <div class="flow-node-body">
                        <strong>${this.escapeHtml(data?.title || "New node")}</strong>
                        <small>${this.escapeHtml(data?.subtitle || data?.jobId || "Manual node")}</small>
                    </div>
                    ${this.renderNodeOperationalInfo(data, "NEW")}
                    <footer class="flow-node-ports">
                        ${this.renderNodePortGroups(inputHtml, outputHtml)}
                    </footer>
                `;
                document.body.appendChild(element);
                this.flowPaletteDragImage = element;
                return {
                    element,
                    offsetX: Math.round((width * zoom) / 2),
                    offsetY: Math.round((height * zoom) / 2),
                    logicalOffsetX: width / 2,
                    logicalOffsetY: height / 2
                };
            },

            disposePaletteDragImage() {
                this.flowPaletteDragImage?.remove();
                this.flowPaletteDragImage = null;
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

            getFlowNodeIdPrefix(nodeType) {
                const prefix = String(nodeType || "JOB").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                return prefix || "node";
            },

            createNextFlowNodeId(nodeType) {
                const prefix = this.getFlowNodeIdPrefix(nodeType);
                let nodeId = "";
                do {
                    nodeId = `${prefix}-${this.nodeSequence++}`;
                } while (this.getFlowNode(nodeId) || document.getElementById(`flowNode-${PAGE_CODE}-${nodeId}`));
                return nodeId;
            },

            getNodePosition(node) {
                return {
                    left: Number.parseFloat(node.style.left || "0") || 0,
                    top: Number.parseFloat(node.style.top || "0") || 0,
                    width: node.offsetWidth || FLOW_NODE_DEFAULT_WIDTH,
                    height: node.offsetHeight || FLOW_NODE_DEFAULT_HEIGHT
                };
            },

            getNodeConnectorPoint(node, connectorType) {
                const connector = node?.querySelector(connectorType === "in" ? ".flow-connector-in" : ".flow-connector-out");
                const viewport = this.getFlowViewport();
                if (connector && !connector.classList.contains("is-hidden") && viewport) {
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

            setNodePosition(node, left, top, options = {}) {
                const safeLeft = Math.max(0, Math.round(left));
                const safeTop = Math.max(0, Math.round(top));
                node.style.left = `${safeLeft}px`;
                node.style.top = `${safeTop}px`;
                if (options.update !== false) {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                }
            },

            handleNodePointerDown(event, node) {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                this.hideCanvasContextMenu();

                const nodeId = node.dataset.nodeId || "";
                const position = this.getNodePosition(node);
                const copyMode = Boolean(event.ctrlKey || event.metaKey);
                const selectedIdsBefore = this.reconcileFlowNodeSelectionState();
                if (!copyMode) {
                    if (this.isFlowNodeSelected(nodeId) && selectedIdsBefore.length > 1) {
                        this.setFlowNodeSelection(selectedIdsBefore, nodeId);
                    } else {
                        this.selectFlowNode(nodeId);
                    }
                }
                const dragIds = copyMode
                    ? (this.isFlowNodeSelected(nodeId) ? selectedIdsBefore : [nodeId])
                    : this.getSelectedFlowNodeIds();
                this.nodeDragState = {
                    node,
                    sourceNode: node,
                    sourceIds: dragIds,
                    nodes: dragIds
                        .map((id) => this.getFlowNode(id))
                        .filter(Boolean)
                        .map((item) => ({
                            node: item,
                            startLeft: this.getNodePosition(item).left,
                            startTop: this.getNodePosition(item).top
                        })),
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    copyMode,
                    cloneStarted: false,
                    moved: false,
                    lockAxis: null
                };
                node.classList.add("is-dragging");
                try {
                    node.setPointerCapture?.(event.pointerId);
                } catch {
                    node.setPointerCapture?.(event.pointerId);
                }
            },

            startCtrlNodeCopyDrag(event) {
                if (!this.nodeDragState || this.nodeDragState.cloneStarted) return;
                const sourceItems = (this.nodeDragState.sourceIds || [])
                    .map((nodeId) => this.getFlowNode(nodeId))
                    .filter(Boolean)
                    .map((node) => ({ node, position: this.getNodePosition(node) }));
                if (!sourceItems.length) return;
                const cloneItems = sourceItems
                    .map((item) => {
                        const clone = this.cloneFlowNode(item.node, item.position.left, item.position.top, { select: false });
                        return clone ? { node: clone, startLeft: item.position.left, startTop: item.position.top } : null;
                    })
                    .filter(Boolean);
                if (!cloneItems.length) return;
                this.nodeDragState.nodes = cloneItems;
                this.nodeDragState.node = cloneItems[0].node;
                this.nodeDragState.cloneStarted = true;
                this.setFlowNodeSelection(cloneItems.map((item) => item.node.dataset.nodeId || ""), cloneItems[0].node.dataset.nodeId || "");
                cloneItems.forEach((item) => item.node.classList.add("is-dragging"));
                try {
                    this.nodeDragState.sourceNode?.releasePointerCapture?.(event.pointerId);
                    this.nodeDragState.node.setPointerCapture?.(event.pointerId);
                } catch {
                    // Pointer capture may stay on the original node while dragging the clones.
                }
            },

            handleNodePointerMove(event) {
                if (!this.nodeDragState) return;
                let deltaX = (event.clientX - this.nodeDragState.startX) / this.flowZoom;
                let deltaY = (event.clientY - this.nodeDragState.startY) / this.flowZoom;
                const movedEnough = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
                if (movedEnough) {
                    this.nodeDragState.moved = true;
                }
                if (this.nodeDragState.copyMode && !this.nodeDragState.cloneStarted) {
                    if (Math.abs(deltaX) <= 4 && Math.abs(deltaY) <= 4) return;
                    this.startCtrlNodeCopyDrag(event);
                    if (!this.nodeDragState.cloneStarted) return;
                }
                if (this.nodeDragState.copyMode && event.shiftKey) {
                    if (!this.nodeDragState.lockAxis && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
                        this.nodeDragState.lockAxis = Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y";
                    }
                    if (this.nodeDragState.lockAxis === "x") deltaY = 0;
                    if (this.nodeDragState.lockAxis === "y") deltaX = 0;
                }
                (this.nodeDragState.nodes || []).forEach((item) => {
                    this.setNodePosition(item.node, item.startLeft + deltaX, item.startTop + deltaY, { update: false });
                });
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
            },

            handleNodePointerUp(event) {
                if (!this.nodeDragState) return;
                const dragState = this.nodeDragState;
                const draggedNode = dragState.node;
                (dragState.nodes || [{ node: draggedNode }]).forEach((item) => item.node?.classList.remove("is-dragging"));
                dragState.sourceNode?.classList.remove("is-dragging");
                try {
                    draggedNode.releasePointerCapture?.(event.pointerId);
                } catch {
                    // The cloned node may not own pointer capture in every browser.
                }
                this.nodeDragState = null;
                if (dragState.moved) {
                    this.suppressNextFlowNodeClick = true;
                    setTimeout(() => {
                        this.suppressNextFlowNodeClick = false;
                    }, 0);
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                }
                if (dragState.copyMode && !dragState.cloneStarted && !dragState.moved) {
                    this.toggleFlowNodeSelection(dragState.sourceNode?.dataset.nodeId || "");
                    this.suppressNextFlowNodeClick = true;
                    setTimeout(() => {
                        this.suppressNextFlowNodeClick = false;
                    }, 0);
                    return;
                }
                if (dragState.nodes?.length > 1) {
                    this.setFlowNodeSelection(dragState.nodes.map((item) => item.node.dataset.nodeId || ""), draggedNode.dataset.nodeId || "");
                } else {
                    this.selectFlowNode(draggedNode.dataset.nodeId || "");
                }
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
                    this.startEdgeConnection(nodeId, "output", connector, "click", event.shiftKey);
                    this.updateConnectionPreviewFromPoint(this.getNodeConnectorPoint(node, "out"));
                    return;
                }

                if (connectorType === "in" && this.edgeDragState) {
                    if (nodeId && nodeId !== this.edgeDragState.fromNodeId) {
                        const fromNode = this.getFlowNode(this.edgeDragState.fromNodeId);
                        const pair = this.findCompatibleFlowPortPair(fromNode, node, this.edgeDragState.fromPort);
                        this.addFlowEdge({
                            from: this.edgeDragState.fromNodeId,
                            fromPort: pair.fromPort,
                            to: nodeId,
                            toPort: pair.toPort,
                            dashed: this.edgeDragState.dashed,
                            mode: this.edgeDragState.dashed ? "ON_COMPLETE" : "SERIAL",
                            params: this.buildDefaultEdgeParams(fromNode, node, pair.toPort, this.edgeDragState.dashed, pair.fromPort)
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
                if (toNodeId && toNodeId !== this.edgeDragState.fromNodeId) {
                    const fromNode = this.getFlowNode(this.edgeDragState.fromNodeId);
                    const pair = this.findCompatibleFlowPortPair(fromNode, targetNode, this.edgeDragState.fromPort);
                    this.addFlowEdge({
                        from: this.edgeDragState.fromNodeId,
                        fromPort: pair.fromPort,
                        to: toNodeId,
                        toPort: pair.toPort,
                        dashed: this.edgeDragState.dashed,
                        mode: this.edgeDragState.dashed ? "ON_COMPLETE" : "SERIAL",
                        params: this.buildDefaultEdgeParams(fromNode, targetNode, pair.toPort, this.edgeDragState.dashed, pair.fromPort)
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

            getNodeDefaultPortName(node, direction) {
                const selector = direction === "in" ? ".flow-port-in" : ".flow-port-out";
                return this.getFlowPortName(node?.querySelector(selector)) || (direction === "in" ? "input" : "output");
            },

            getDominantNodePortShape(node, direction) {
                const selector = direction === "in" ? ".flow-port-in" : ".flow-port-out";
                const priority = { square: 1, triangle: 2, circle: 3, diamond: 4 };
                return Array.from(node?.querySelectorAll(selector) || [])
                    .map((port) => String(port.dataset.portShape || "square").toLowerCase())
                    .sort((left, right) => (priority[right] || 0) - (priority[left] || 0))[0] || "square";
            },

            findCompatibleFlowPortPair(fromNode, toNode, preferredFromPort = "") {
                const outputs = Array.from(fromNode?.querySelectorAll(".flow-port-out") || []);
                const inputs = Array.from(toNode?.querySelectorAll(".flow-port-in") || []);
                const preferred = outputs.find((port) => this.getFlowPortName(port) === String(preferredFromPort || ""));
                const orderedOutputs = preferred ? [preferred, ...outputs.filter((port) => port !== preferred)] : outputs;
                for (const output of orderedOutputs) {
                    const artifact = output.dataset.artifact || "";
                    const input = inputs.find((candidate) => artifact && candidate.dataset.artifact === artifact);
                    if (input) {
                        return { fromPort: this.getFlowPortName(output), toPort: this.getFlowPortName(input) };
                    }
                }
                return {
                    fromPort: this.getFlowPortName(preferred || outputs[0]) || "output",
                    toPort: this.getFlowPortName(inputs[0]) || "input"
                };
            },

            isFlowCanvasMenuTarget(event) {
                return Boolean(event?.target?.closest?.(`#flowCanvasMenu-${PAGE_CODE}, .flow-context-menu`));
            },

            toggleFlowCanvasSelectionMode() {
                this.setFlowCanvasSelectionMode(!this.flowCanvasSelectionMode);
            },

            setFlowCanvasSelectionMode(enabled) {
                this.flowCanvasSelectionMode = Boolean(enabled);
                if (!this.flowCanvasSelectionMode) {
                    const box = this.getFlowViewport()?.querySelector(".flow-selection-box");
                    if (box) box.hidden = true;
                    this.canvasSelectionState = null;
                }
                const stage = this.getFlowStage();
                if (stage) {
                    stage.classList.toggle("is-selection-mode", this.flowCanvasSelectionMode);
                }
                const button = getContainerEl(`#flowCanvasSelectionMode-${PAGE_CODE}`);
                if (button) {
                    button.classList.toggle("is-active", this.flowCanvasSelectionMode);
                    button.setAttribute("aria-pressed", String(this.flowCanvasSelectionMode));
                }
            },

            handleCanvasPointerDown(event) {
                if (this.isFlowCanvasMenuTarget(event)) return;
                if (event.button !== 0 || event.target.closest?.(".flow-node")) return;
                if (event.target.closest?.(".flow-edge-path, .flow-edge-hit-path, .flow-edge-delete")) return;
                event.preventDefault();
                this.clearSelectedFlowEdge();
                const stage = this.getFlowStage();
                if (!stage) return;
                if (this.flowCanvasSelectionMode) {
                    const point = this.getCanvasPointFromEvent(event);
                    this.canvasSelectionState = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        startLeft: point.left,
                        startTop: point.top,
                        currentLeft: point.left,
                        currentTop: point.top,
                        moved: false
                    };
                } else {
                    this.canvasPanState = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        startScrollLeft: stage.scrollLeft,
                        startScrollTop: stage.scrollTop,
                        moved: false
                    };
                    stage.classList.add("is-panning");
                }
                stage.setPointerCapture?.(event.pointerId);
            },

            handleCanvasPointerMove(event) {
                if (this.edgeDragState) {
                    this.updateConnectionPreview(event);
                    return;
                }
                if (this.canvasSelectionState) {
                    if (this.canvasSelectionState.pointerId !== event.pointerId) return;
                    this.updateCanvasSelection(event);
                    return;
                }
                if (!this.canvasPanState) return;
                if (this.canvasPanState.pointerId !== event.pointerId) return;
                const stage = this.getFlowStage();
                if (!stage) return;
                const dx = event.clientX - this.canvasPanState.startX;
                const dy = event.clientY - this.canvasPanState.startY;
                this.canvasPanState.moved = this.canvasPanState.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
                stage.scrollLeft = this.canvasPanState.startScrollLeft - dx;
                stage.scrollTop = this.canvasPanState.startScrollTop - dy;
            },

            handleCanvasPointerUp(event) {
                if (this.edgeDragState) {
                    if (this.edgeDragState.mode !== "click") {
                        this.finishEdgeDrag();
                    }
                    return;
                }
                if (this.canvasSelectionState) {
                    if (event && this.canvasSelectionState.pointerId !== event.pointerId) return;
                    this.finishCanvasSelection();
                    this.getFlowStage()?.releasePointerCapture?.(event?.pointerId);
                    return;
                }
                if (!this.canvasPanState) return;
                if (event && this.canvasPanState.pointerId !== event.pointerId) return;
                const wasMoved = Boolean(this.canvasPanState.moved);
                this.canvasPanState = null;
                const stage = this.getFlowStage();
                stage?.releasePointerCapture?.(event?.pointerId);
                stage?.classList.remove("is-panning");
                if (!wasMoved) {
                    this.clearFlowNodeSelection();
                }
            },

            handleCanvasWheel(event) {
                if (this.isFlowCanvasMenuTarget(event)) return;
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

            isTextEditingEventTarget(event) {
                const active = event?.target || document.activeElement;
                const tagName = active?.tagName?.toLowerCase();
                return Boolean(
                    active?.isContentEditable
                    || ["input", "textarea", "select"].includes(tagName)
                );
            },

            handleFlowKeydown(event) {
                const isCopyShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && String(event.key || "").toLowerCase() === "c";
                const isPasteShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && String(event.key || "").toLowerCase() === "v";
                if ((isCopyShortcut || isPasteShortcut) && !this.isTextEditingEventTarget(event)) {
                    event.preventDefault();
                    if (isCopyShortcut) {
                        this.copySelectedFlowNode();
                    } else {
                        this.pasteCopiedFlowNode();
                    }
                    return;
                }
                if (event.key === "Escape" && document.getElementById(`flowNodeRunParamsLayer-${PAGE_CODE}`)?.hidden === false) {
                    this.closeNodeRunParamsLayer();
                    return;
                }
                if (event.key === "Escape" && getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`)?.hidden === false) {
                    event.preventDefault();
                    this.hideCanvasContextMenu();
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
                if (event.key === "Delete" || event.key === "Backspace") {
                    if (this.isTextEditingEventTarget(event)) return;
                    const selectedNodeIds = this.reconcileFlowNodeSelectionState();
                    if (!this.selectedEdgeId && !selectedNodeIds.length) return;
                    event.preventDefault();
                    if (this.selectedEdgeId) {
                        this.removeSelectedEdge();
                    } else {
                        this.removeSelectedNode();
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
                const point = this.getCanvasPointFromEvent(event);
                const dragOffset = this.flowPaletteDragOffset || {
                    x: FLOW_NODE_DEFAULT_WIDTH / 2,
                    y: FLOW_NODE_DEFAULT_HEIGHT / 2
                };
                const left = Math.max(0, point.left - dragOffset.x);
                const top = Math.max(0, point.top - dragOffset.y);
                try {
                    const latestData = await this.resolveLatestFlowNodeData(data);
                    this.appendFlowNode(latestData, left, top);
                } finally {
                    this.disposePaletteDragImage();
                    this.flowPaletteDragData = null;
                    this.flowPaletteDragOffset = null;
                }
            },

            async createPaletteNodeAtCanvasCenter(item) {
                const point = this.getCanvasVisibleCenterPoint();
                const data = this.getFlowPaletteItemData(item);
                const latestData = await this.resolveLatestFlowNodeData(data);
                this.appendFlowNode(latestData, point.left, point.top, { avoidOverlap: true });
            },

            getCanvasVisibleCenterPoint() {
                const stage = this.getFlowStage();
                if (!stage) return { left: 80, top: 80 };
                return {
                    left: Math.max(0, ((stage.scrollLeft + stage.clientWidth / 2) / this.flowZoom) - FLOW_NODE_DEFAULT_WIDTH / 2),
                    top: Math.max(0, ((stage.scrollTop + stage.clientHeight / 2) / this.flowZoom) - FLOW_NODE_DEFAULT_HEIGHT / 2)
                };
            },

            rectsOverlap(a, b, margin = 12) {
                return !(
                    a.left + a.width + margin <= b.left
                    || b.left + b.width + margin <= a.left
                    || a.top + a.height + margin <= b.top
                    || b.top + b.height + margin <= a.top
                );
            },

            getAvailableFlowNodePosition(left, top, width = FLOW_NODE_DEFAULT_WIDTH, height = FLOW_NODE_DEFAULT_HEIGHT) {
                const originLeft = Math.max(0, Math.round(left));
                const originTop = Math.max(0, Math.round(top));
                let candidateLeft = originLeft;
                let candidateTop = originTop;
                const existing = this.getFlowNodes().map((node) => this.getNodePosition(node));
                for (let index = 0; index < 48; index += 1) {
                    const candidate = { left: candidateLeft, top: candidateTop, width, height };
                    if (!existing.some((position) => this.rectsOverlap(candidate, position))) {
                        return { left: candidateLeft, top: candidateTop };
                    }
                    candidateTop = originTop + 42 * (index + 1);
                    if ((index + 1) % 8 === 0) {
                        candidateLeft += 34;
                        candidateTop = originTop + 42;
                    }
                }
                return { left: candidateLeft, top: candidateTop };
            },

            appendFlowNode(data, left, top, options = {}) {
                const position = options.avoidOverlap
                    ? this.getAvailableFlowNodePosition(left, top)
                    : { left, top };
                const node = this.createFlowNode(data, position.left, position.top);
                if (node) {
                    this.markFlowEdited();
                    this.getFlowViewport()?.appendChild(node);
                    this.bindFlowNode(node);
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                    this.selectFlowNode(node.dataset.nodeId || "");
                    requestAnimationFrame(() => this.selectFlowNode(node.dataset.nodeId || ""));
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

            getFlowSelectionBoxEl() {
                const viewport = this.getFlowViewport();
                if (!viewport) return null;
                let box = viewport.querySelector(".flow-selection-box");
                if (!box) {
                    box = document.createElement("div");
                    box.className = "flow-selection-box";
                    viewport.appendChild(box);
                }
                return box;
            },

            getSelectionRectFromState(state = this.canvasSelectionState) {
                if (!state) return null;
                const left = Math.min(state.startLeft, state.currentLeft);
                const top = Math.min(state.startTop, state.currentTop);
                const right = Math.max(state.startLeft, state.currentLeft);
                const bottom = Math.max(state.startTop, state.currentTop);
                return {
                    left,
                    top,
                    right,
                    bottom,
                    width: Math.max(0, right - left),
                    height: Math.max(0, bottom - top)
                };
            },

            updateCanvasSelection(event) {
                if (!this.canvasSelectionState) return;
                const point = this.getCanvasPointFromEvent(event);
                this.canvasSelectionState.currentLeft = point.left;
                this.canvasSelectionState.currentTop = point.top;
                const moved = Math.abs(event.clientX - this.canvasSelectionState.startX) > 4
                    || Math.abs(event.clientY - this.canvasSelectionState.startY) > 4;
                this.canvasSelectionState.moved = this.canvasSelectionState.moved || moved;
                const box = this.getFlowSelectionBoxEl();
                const rect = this.getSelectionRectFromState();
                if (!box || !rect) return;
                box.hidden = !this.canvasSelectionState.moved;
                box.style.left = `${Math.round(rect.left)}px`;
                box.style.top = `${Math.round(rect.top)}px`;
                box.style.width = `${Math.round(rect.width)}px`;
                box.style.height = `${Math.round(rect.height)}px`;
            },

            rectIntersects(a, b) {
                return !(
                    a.right < b.left
                    || b.right < a.left
                    || a.bottom < b.top
                    || b.bottom < a.top
                );
            },

            finishCanvasSelection() {
                const state = this.canvasSelectionState;
                const box = this.getFlowViewport()?.querySelector(".flow-selection-box");
                if (box) box.hidden = true;
                this.canvasSelectionState = null;

                if (!state?.moved) {
                    this.clearFlowNodeSelection();
                    return;
                }

                const rect = this.getSelectionRectFromState(state);
                const selectedIds = this.getFlowNodes()
                    .filter((node) => {
                        const position = this.getNodePosition(node);
                        return this.rectIntersects(rect, {
                            left: position.left,
                            top: position.top,
                            right: position.left + position.width,
                            bottom: position.top + position.height
                        });
                    })
                    .map((node) => node.dataset.nodeId || "")
                    .filter(Boolean);

                if (selectedIds.length) {
                    this.setFlowNodeSelection(selectedIds, selectedIds[selectedIds.length - 1]);
                } else {
                    this.clearFlowNodeSelection();
                }
            },

            handleCanvasContextMenu(event) {
                if (this.isFlowCanvasMenuTarget(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                event.preventDefault();
                const stage = this.getFlowStage();
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (!stage || !menu) return;

                const targetNode = event.target.closest?.(".flow-node");
                const point = this.getCanvasPointFromEvent(event);
                let actionNodeIds = this.reconcileFlowNodeSelectionState();
                let actionNodes = [];
                let contextNodeId = "";
                if (targetNode) {
                    const targetNodeId = targetNode.dataset.nodeId || "";
                    const selectedIds = actionNodeIds;
                    if (selectedIds.includes(targetNodeId)) {
                        this.setFlowNodeSelection(selectedIds, targetNodeId);
                        actionNodeIds = this.getSelectedFlowNodeIds();
                        actionNodes = this.getVisualSelectedFlowNodes();
                    } else {
                        this.selectFlowNode(targetNodeId);
                        actionNodeIds = [targetNodeId];
                        actionNodes = [targetNode];
                    }
                    contextNodeId = targetNodeId;
                } else {
                    actionNodeIds = this.reconcileFlowNodeSelectionState();
                    actionNodes = this.getVisualSelectedFlowNodes();
                }
                this.flowContextMenuState = {
                    nodeId: contextNodeId,
                    nodeIds: actionNodeIds,
                    nodeElements: actionNodes,
                    left: point.left,
                    top: point.top
                };
                this.storeContextMenuActionNodeIds(actionNodeIds, contextNodeId);

                const stageRect = stage.getBoundingClientRect();
                const x = event.clientX - stageRect.left + stage.scrollLeft;
                const y = event.clientY - stageRect.top + stage.scrollTop;
                menu.style.left = `${Math.max(8, x)}px`;
                menu.style.top = `${Math.max(8, y)}px`;
                this.suppressNextFlowMenuClick = false;
                menu.hidden = false;
                this.updateContextMenuState();
            },

            updateContextMenuState() {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (!menu) return;
                const hasNode = this.getContextMenuActionNodes().length > 0 || this.getActionFlowNodeIds().length > 0;
                menu.querySelectorAll('[data-flow-menu-action="runSelectedNode"], [data-flow-menu-action="runFromSelectedNode"], [data-flow-menu-action="duplicateNode"], [data-flow-menu-action="deleteNode"]').forEach((button) => {
                    button.classList.toggle("is-disabled", !hasNode);
                    button.disabled = false;
                    button.setAttribute("aria-disabled", hasNode ? "false" : "true");
                });
                this.renderDashedConnectionMode();
            },

            getContextMenuAction(button) {
                return String(button?.dataset?.flowMenuAction || button?.getAttribute?.("data-flow-menu-action") || "");
            },

            isNodeContextMenuAction(action) {
                return ["runSelectedNode", "runFromSelectedNode", "duplicateNode", "deleteNode"].includes(action);
            },

            hideCanvasContextMenu() {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (menu) {
                    menu.hidden = true;
                    delete menu.dataset.nodeIds;
                    delete menu.dataset.nodeId;
                }
                this.flowContextMenuState = null;
            },

            handleFlowMenuPointerDown(event) {
                event.stopImmediatePropagation?.();
                event.stopPropagation();
                const button = event.target.closest?.("[data-flow-menu-action]");
                if (!button || event.button !== 0) return;
                event.preventDefault();
                const action = this.getContextMenuAction(button);
                if (this.shouldIgnoreFlowMenuPress(action)) return;
                this.suppressNextFlowMenuClick = true;
                if (action === "deleteNode") {
                    this.deleteContextMenuNodesNow(event);
                    return;
                }
                void this.handleContextMenuButtonAction(event, button);
            },

            handleInlineContextMenuAction(event, action = "") {
                const button = event?.currentTarget || event?.target?.closest?.("[data-flow-menu-action]");
                if (!button) return;
                if (action) button.dataset.flowMenuAction = action;
                event.preventDefault();
                event.stopImmediatePropagation?.();
                event.stopPropagation();
                const menuAction = action || this.getContextMenuAction(button);
                if (this.shouldIgnoreFlowMenuPress(menuAction)) return;
                this.suppressNextFlowMenuClick = true;
                if (menuAction === "deleteNode") {
                    this.deleteContextMenuNodesNow(event);
                    return;
                }
                void this.handleContextMenuButtonAction(event, button);
            },

            shouldIgnoreFlowMenuPress(action = "") {
                const key = String(action || "");
                const now = Date.now();
                const guard = this.flowMenuPressGuard || {};
                if (guard.action === key && now - Number(guard.at || 0) < 250) {
                    return true;
                }
                this.flowMenuPressGuard = { action: key, at: now };
                return false;
            },

            // Canvas-only edit. Do not call DB delete APIs from this node action.
            deleteContextMenuNodesNow(event = null) {
                event?.preventDefault?.();
                event?.stopImmediatePropagation?.();
                event?.stopPropagation?.();
                const nodes = this.getContextMenuActionNodes();
                const nodeIds = nodes.length
                    ? nodes.map((node) => node.dataset.nodeId || "").filter(Boolean)
                    : this.getContextMenuActionNodeIds();
                if (!nodes.length && !nodeIds.length) return;
                this.removeSelectedNode(nodes.length ? nodes : nodeIds);
                this.hideCanvasContextMenu();
            },

            handleFlowMenuContextMenu(event) {
                event.preventDefault();
                event.stopPropagation();
            },

            async handleContextMenuClick(event) {
                const button = event.target.closest?.("[data-flow-menu-action]");
                if (!button) return;
                event.preventDefault();
                event.stopImmediatePropagation?.();
                event.stopPropagation();
                if (this.suppressNextFlowMenuClick) {
                    this.suppressNextFlowMenuClick = false;
                    return;
                }
                await this.handleContextMenuButtonAction(event, button);
            },

            async handleContextMenuButtonAction(event, button) {
                const action = this.getContextMenuAction(button);
                if (!button || !action) return;
                event.preventDefault();
                event.stopImmediatePropagation?.();
                event.stopPropagation();
                const actionNodeIds = this.isNodeContextMenuAction(action)
                    ? this.getContextMenuActionNodeIds()
                    : [];
                const actionNodes = this.isNodeContextMenuAction(action)
                    ? this.getContextMenuActionNodes()
                    : [];
                if (this.isNodeContextMenuAction(action)) {
                    if (!actionNodeIds.length && !actionNodes.length) return;
                    const finalNodeIds = actionNodeIds.length
                        ? actionNodeIds
                        : actionNodes.map((node) => node.dataset.nodeId || "").filter(Boolean);
                    this.flowContextMenuState = {
                        ...(this.flowContextMenuState || {}),
                        nodeIds: finalNodeIds,
                        nodeElements: actionNodes
                    };
                    this.storeContextMenuActionNodeIds(finalNodeIds, finalNodeIds[0] || this.flowContextMenuState?.nodeId || "");
                }
                const handled = await this.runContextMenuAction(action, {
                    nodeIds: actionNodeIds,
                    nodes: actionNodes
                });
                if (handled && action !== "toggleDashedConnection") {
                    this.hideCanvasContextMenu();
                }
            },

            async runContextMenuAction(action, context = {}) {
                const menuNodeIds = Array.isArray(context.nodeIds) && context.nodeIds.length
                    ? context.nodeIds
                    : this.getContextMenuActionNodeIds();
                const menuNodes = Array.isArray(context.nodes) && context.nodes.length
                    ? context.nodes
                    : this.getContextMenuActionNodes();
                const actions = {
                    runSelectedNode: () => this.runSelectedNode(),
                    runFromSelectedNode: () => this.runSelectedNode({ downstream: true }),
                    duplicateNode: () => this.duplicateSelectedNode({ nodeIds: menuNodeIds }),
                    deleteNode: () => this.removeSelectedNode(menuNodes.length ? menuNodes : menuNodeIds),
                    toggleDashedConnection: () => this.toggleDashedConnectionMode(),
                    autoLayout: () => this.autoLayoutFlow(),
                    treeLayout: () => this.autoLayoutFlow(),
                    autoConnectByX: () => this.applyAutoConnectionsByX(),
                    fitCanvas: () => this.fitFlowCanvas(),
                    resetZoom: () => this.resetFlowZoom()
                };
                const handler = actions[action];
                if (!handler) return false;
                await handler();
                return true;
            },

            getContextMenuActionNodeIds() {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                const menuNodeIds = String(menu?.dataset?.nodeIds || "")
                    .split("\u001f")
                    .map((nodeId) => nodeId.trim())
                    .filter((nodeId) => nodeId && this.getFlowNode(nodeId));
                if (menuNodeIds.length) return menuNodeIds;
                const contextNodeIds = Array.isArray(this.flowContextMenuState?.nodeIds)
                    ? this.flowContextMenuState.nodeIds.filter((nodeId) => nodeId && this.getFlowNode(nodeId))
                    : [];
                if (contextNodeIds.length) return contextNodeIds;
                const contextElementIds = Array.isArray(this.flowContextMenuState?.nodeElements)
                    ? this.flowContextMenuState.nodeElements
                        .filter((node) => this.isLiveFlowNodeElement(node))
                        .map((node) => node.dataset.nodeId || "")
                        .filter(Boolean)
                    : [];
                if (contextElementIds.length) return contextElementIds;
                const contextNodeId = this.flowContextMenuState?.nodeId || "";
                if (contextNodeId && this.getFlowNode(contextNodeId)) return [contextNodeId];
                return this.getActionFlowNodeIds();
            },

            getContextMenuActionNodes() {
                const contextNodes = Array.isArray(this.flowContextMenuState?.nodeElements)
                    ? this.flowContextMenuState.nodeElements.filter((node) => this.isLiveFlowNodeElement(node))
                    : [];
                if (contextNodes.length) return contextNodes;
                return this.getContextMenuActionNodeIds()
                    .map((nodeId) => this.getFlowNode(nodeId))
                    .filter((node) => this.isLiveFlowNodeElement(node));
            },

            storeContextMenuActionNodeIds(nodeIds = [], primaryNodeId = "") {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (!menu) return;
                const validIds = Array.from(new Set((nodeIds || []).filter((nodeId) => nodeId && this.getFlowNode(nodeId))));
                menu.dataset.nodeIds = validIds.join("\u001f");
                menu.dataset.nodeId = primaryNodeId && validIds.includes(primaryNodeId)
                    ? primaryNodeId
                    : (validIds[0] || "");
            },

            getActionFlowNodeIds(options = {}) {
                const contextNodeId = this.flowContextMenuState?.nodeId || "";
                const selectedIds = this.reconcileFlowNodeSelectionState();
                if (selectedIds.length) return selectedIds;
                const contextNodeIds = Array.isArray(this.flowContextMenuState?.nodeIds)
                    ? this.flowContextMenuState.nodeIds.filter((nodeId) => nodeId && this.getFlowNode(nodeId))
                    : [];
                if (contextNodeIds.length) return contextNodeIds;
                if (contextNodeId && this.isFlowNodeSelected(contextNodeId)) {
                    return [contextNodeId];
                }
                if (contextNodeId && options.contextOnly) {
                    return [contextNodeId];
                }
                return contextNodeId ? [contextNodeId] : [];
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
                const nodeTypeLabel = this.getNodeTypeLabel(nodeType, data.nodeTypeLabel || "");
                const nodeId = this.createNextFlowNodeId(nodeType);
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
                article.dataset.execObjectName = data.execObjectName || "";
                article.dataset.execSpecJson = data.execSpecJson || "";
                article.dataset.execPlsql = data.execPlsql || "";
                article.dataset.nodeParams = this.stringifyNodeJson(data.params || []);
                article.dataset.useYn = String(data.useYn || "Y").toUpperCase() === "N" ? "N" : "Y";
                article.style.position = "absolute";
                article.style.left = `${Math.max(0, Math.round(left))}px`;
                article.style.top = `${Math.max(0, Math.round(top))}px`;
                article.style.width = `${FLOW_NODE_DEFAULT_WIDTH}px`;
                article.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong title="${this.escapeHtml(nodeTypeLabel)}">${this.escapeHtml(nodeTypeLabel)}</strong>
                        <span class="data-job-order">NEW</span>
                    </header>
                    <div class="flow-node-body">
                        <strong>${this.escapeHtml(data.title || "New node")}</strong>
                        <small>${this.escapeHtml(data.subtitle || data.jobId || "Manual node")}</small>
                    </div>
                    ${this.renderNodeOperationalInfo(data, nodeId)}
                    <footer class="flow-node-ports">
                        ${this.renderNodePortGroups(inputHtml, outputHtml)}
                    </footer>
                `;
                this.applyNodeUseState(article);
                return article;
            },

            createSavedFlowNode(data) {
                const nodeType = data.nodeType || "JOB";
                const nodeTypeLabel = this.getNodeTypeLabel(nodeType, data.nodeTypeLabel || "");
                const refJob = this.getRegisteredJobAsset(data.refWorkJobId || "");
                const nodeId = data.nodeKey || this.createNextFlowNodeId(nodeType);
                const inputHtml = this.renderNodePortSpans(this.getRenderInputPorts(nodeType, data, refJob), "in", "TABLE");
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
                article.dataset.execObjectName = data.execObjectName || refJob?.EXEC_OBJECT_NAME || "";
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
                article.style.width = `${Math.max(FLOW_NODE_DEFAULT_WIDTH, Math.round(Number(data.nodeWidth) || FLOW_NODE_DEFAULT_WIDTH))}px`;
                article.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong title="${this.escapeHtml(nodeTypeLabel)}">${this.escapeHtml(nodeTypeLabel)}</strong>
                        <span class="data-job-order">${this.escapeHtml(data.refMenuCode || data.sortOrder || "NODE")}</span>
                    </header>
                    <div class="flow-node-body">
                        <strong>${this.escapeHtml(data.nodeName || nodeId)}</strong>
                        <small>${this.escapeHtml(data.nodeDesc || data.refMenuCode || "Saved node")}</small>
                    </div>
                    ${this.renderNodeOperationalInfo(data, nodeId, refJob)}
                    <footer class="flow-node-ports">
                        ${this.renderNodePortGroups(inputHtml, outputHtml)}
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

            renderNodeOperationalInfo(data = {}, nodeId = "", refJob = null) {
                const execSourceType = String(data.execSourceType || refJob?.EXEC_SOURCE_TYPE || "DB_OBJECT").toUpperCase();
                const execName = data.execObjectName || refJob?.EXEC_OBJECT_NAME || data.jobId || data.refWorkJobId || "-";
                const resultMode = this.normalizeResultCreateMode(data.resultCreateYn || refJob?.RESULT_CREATE_YN || "N");
                const resultName = data.resultTableName || refJob?.RESULT_TABLE_NAME || "-";
                const resultType = resultMode === "M" ? "M" : resultMode === "T" ? "T" : "-";
                return `
                    <div class="flow-node-operational" aria-label="Node information">
                        <span class="flow-node-operational-line" title="Node ID: ${this.escapeHtml(nodeId || "-")}">
                            <b>ID</b><span>${this.escapeHtml(nodeId || "-")}</span><em>${this.escapeHtml(execSourceType)}</em>
                        </span>
                        <span class="flow-node-operational-line" title="Execution object: ${this.escapeHtml(execName)}">
                            <b>EXEC</b><span>${this.escapeHtml(execName)}</span>
                        </span>
                        <span class="flow-node-operational-line" title="Result: ${this.escapeHtml(resultName)}">
                            <b>RESULT ${resultType}</b><span>${this.escapeHtml(resultName)}</span>
                        </span>
                    </div>
                `;
            },

            renderNodePortGroups(inputHtml = "", outputHtml = "") {
                return `
                    <section class="flow-node-port-group is-input" aria-label="Input ports">
                        <div class="flow-node-port-list">${inputHtml || '<span class="flow-port-empty">-</span>'}</div>
                    </section>
                    <section class="flow-node-port-group is-output" aria-label="Output ports">
                        <div class="flow-node-port-list">${outputHtml || '<span class="flow-port-empty">-</span>'}</div>
                    </section>
                `;
            },

            renderNodePortSpans(ports, direction, assetKind = "TABLE") {
                const className = direction === "in" ? "flow-port-in" : "flow-port-out";
                const normalizedKind = this.normalizeFlowAssetKind(assetKind);
                if (direction === "out" && normalizedKind === "NONE") {
                    return this.renderFlowPortInfo("out", "NONE", false);
                }
                return (ports || [])
                    .filter((port) => String(port?.port || port?.name || port || "").trim())
                    .map((port) => {
                        const definition = typeof port === "object" ? port : { port };
                        const portName = String(definition.port || definition.name || port || "").trim();
                        const label = this.escapeHtml(portName);
                        const directionLabel = direction === "in" ? "Input" : "Output";
                        return this.renderFlowPortInfo(
                            direction,
                            definition.kind || normalizedKind,
                            true,
                            className,
                            label,
                            directionLabel,
                            definition
                        );
                    })
                    .join("");
            },

            renderFlowPortInfo(direction, assetKind, connectable = true, className = "", portLabel = "", directionLabel = "", metadata = {}) {
                const kind = this.normalizeFlowAssetKind(assetKind);
                const directionText = direction === "in" ? "IN" : "OUT";
                const kindText = kind === "MODEL" ? "model" : kind === "NONE" ? "none" : "table";
                const kindCode = kind === "MODEL" ? "M" : kind === "NONE" ? "-" : "T";
                const iconClass = kind === "MODEL" ? "fas fa-brain" : kind === "NONE" ? "fas fa-minus" : "fas fa-table";
                const title = `${directionLabel || directionText}: ${kindText}${portLabel ? ` (${portLabel})` : ""}`;
                const classes = [
                    connectable ? "flow-port" : "flow-port-info",
                    className,
                    `is-${kindText}`
                ].filter(Boolean).join(" ");
                const dataPortName = connectable ? ` data-port-name="${this.escapeHtml(portLabel)}"` : "";
                const artifact = String(metadata.artifact || "").toUpperCase();
                const shape = String(metadata.shape || "square").toLowerCase();
                const required = metadata.required === true;
                const runScope = String(metadata.runScope || "").toUpperCase();
                return `
                    <span class="${classes}${required ? " is-required" : " is-optional"}"${dataPortName}
                        data-artifact="${this.escapeHtml(artifact)}" data-port-shape="${this.escapeHtml(shape)}"
                        data-required="${required ? "Y" : "N"}" data-run-scope="${this.escapeHtml(runScope)}"
                        title="${this.escapeHtml(`${title}${artifact ? ` · ${artifact}` : ""}${runScope ? ` · ${runScope}` : ""}`)}"
                        aria-label="${this.escapeHtml(title)}">
                        <em>${directionText} ${kindCode}</em>
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

            getRenderInputPorts(nodeType, data = {}, refJob = null) {
                const explicitPorts = this.normalizePortDefinitions(data.inputs, "input");
                const contractPorts = this.getFlowContractPorts(data, "in", refJob);
                if (contractPorts.length) return contractPorts;
                if (explicitPorts.length) return explicitPorts;
                const defaultPort = this.getDefaultInputPort(nodeType);
                return defaultPort ? [defaultPort] : [];
            },

            getRenderOutputPorts(nodeType, data = {}, refJob = null) {
                const explicitPorts = this.normalizePortDefinitions(data.outputs, "output");
                const contractPorts = this.getFlowContractPorts(data, "out", refJob);
                const resultCreateMode = this.normalizeResultCreateMode(data.resultCreateYn || refJob?.RESULT_CREATE_YN || "N");
                if (resultCreateMode === "N") {
                    return [];
                }
                if (contractPorts.length) return contractPorts;
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

            normalizePortDefinitions(ports, fallback = "") {
                if (!Array.isArray(ports)) return [];
                return ports.map((port) => {
                    if (port && typeof port === "object") {
                        const name = this.normalizeFlowPortName(port.port || port.name || "", fallback);
                        return name ? { ...port, port: name } : null;
                    }
                    const name = this.normalizeFlowPortName(port || "", fallback);
                    return name ? { port: name } : null;
                }).filter(Boolean);
            },

            normalizeFlowPortName(portName, fallback = "input") {
                const value = String(portName || "").trim();
                const normalized = value.toLowerCase();
                if (normalized === "input" || normalized.endsWith("input")) return "input";
                if (normalized === "output" || normalized.endsWith("output")) return "output";
                if (!value) return fallback;
                if (/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(value)) return value;
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

            buildDefaultEdgeParams(fromNode, toNode, toPort = "input", dashed = false, fromPort = "") {
                if (!fromNode || !toNode || dashed) return {};
                const sourcePort = Array.from(fromNode.querySelectorAll(".flow-port-out"))
                    .find((port) => this.getFlowPortName(port) === String(fromPort || ""))
                    || fromNode.querySelector(".flow-port-out");
                const targetPort = Array.from(toNode.querySelectorAll(".flow-port-in"))
                    .find((port) => this.getFlowPortName(port) === String(toPort || ""))
                    || toNode.querySelector(".flow-port-in");
                const artifact = sourcePort?.dataset.artifact || "";
                const targetArtifact = targetPort?.dataset.artifact || "";
                const hasResultTable = this.normalizeResultCreateMode(fromNode.dataset.resultCreateYn || "") === "T"
                    && Boolean(fromNode.dataset.resultOwner && fromNode.dataset.resultTableName);
                const baseParams = {
                    dependencyType: artifact ? "DATA_REQUIRED" : "ORDER_REQUIRED",
                    artifact,
                    runScope: targetPort?.dataset.runScope || sourcePort?.dataset.runScope || ""
                };
                if (targetArtifact && targetArtifact !== "TARGET_TABLE") return baseParams;
                if (!hasResultTable) return baseParams;
                return {
                    ...baseParams,
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
                    Boolean(edge?.dashed),
                    edge?.fromPort || "output"
                );
            },

            createFlowNodeSnapshot(source) {
                if (!source) return null;
                const position = this.getNodePosition(source);
                return {
                    className: source.className || "data-param-card flow-node flow-node-step",
                    dataset: { ...source.dataset },
                    html: source.innerHTML,
                    position,
                    width: source.style.width || `${position.width || FLOW_NODE_DEFAULT_WIDTH}px`
                };
            },

            copySelectedFlowNode() {
                const selectedIds = this.reconcileFlowNodeSelectionState();
                const snapshots = (selectedIds.length ? selectedIds : [this.selectedNodeId])
                    .map((nodeId) => this.createFlowNodeSnapshot(this.getFlowNode(nodeId)))
                    .filter(Boolean);
                if (!snapshots.length) return;
                this.flowNodeClipboard = {
                    items: snapshots,
                    anchor: snapshots[0].position || { left: 80, top: 80 }
                };
                this.flowNodeClipboardPasteCount = 0;
            },

            createCloneNodeId(sourceNodeId = "node") {
                return this.createNextFlowNodeId(`${sourceNodeId || "node"}-copy`);
            },

            appendFlowNodeClone(snapshot, left, top, options = {}) {
                if (!snapshot) return null;
                const clone = document.createElement("article");
                const sourceNodeId = snapshot.dataset?.nodeId || "node";
                const cloneNodeId = this.createCloneNodeId(sourceNodeId);
                this.markFlowEdited();
                clone.id = `flowNode-${PAGE_CODE}-${cloneNodeId}`;
                clone.className = String(snapshot.className || "data-param-card flow-node flow-node-step")
                    .replace(/\bis-selected\b/g, "")
                    .replace(/\bis-dragging\b/g, "")
                    .trim();
                Object.entries(snapshot.dataset || {}).forEach(([key, value]) => {
                    clone.dataset[key] = value;
                });
                clone.dataset.nodeId = cloneNodeId;
                clone.dataset.flowBound = "";
                clone.innerHTML = snapshot.html || "";
                clone.querySelectorAll("[data-flow-connector-bound], [data-flow-port-bound]").forEach((element) => {
                    delete element.dataset.flowConnectorBound;
                    delete element.dataset.flowPortBound;
                });
                clone.classList.remove("is-selected", "is-dragging");
                this.clearFlowNodeRuntimeVisualState(clone);
                clone.style.position = "absolute";
                clone.style.left = `${Math.max(0, Math.round(left))}px`;
                clone.style.top = `${Math.max(0, Math.round(top))}px`;
                clone.style.width = snapshot.width || `${FLOW_NODE_DEFAULT_WIDTH}px`;
                this.getFlowViewport()?.appendChild(clone);
                this.applyNodeUseState(clone);
                this.bindFlowNode(clone);
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
                if (options.select !== false) {
                    this.selectFlowNode(cloneNodeId);
                }
                return clone;
            },

            cloneFlowNode(source, left, top, options = {}) {
                return this.appendFlowNodeClone(this.createFlowNodeSnapshot(source), left, top, options);
            },

            duplicateSelectedNode(options = {}) {
                const sourceIds = Array.isArray(options.nodeIds) && options.nodeIds.length
                    ? options.nodeIds
                    : this.getActionFlowNodeIds();
                const clones = sourceIds
                    .map((nodeId) => {
                        const node = this.getFlowNode(nodeId);
                        if (!node) return null;
                        const position = this.getNodePosition(node);
                        const offsetX = options.offsetX ?? 36;
                        const offsetY = options.offsetY ?? 36;
                        return this.cloneFlowNode(node, options.left ?? position.left + offsetX, options.top ?? position.top + offsetY, { select: false });
                    })
                    .filter(Boolean);
                if (!clones.length) return null;
                this.setFlowNodeSelection(clones.map((node) => node.dataset.nodeId || ""), clones[0].dataset.nodeId || "");
                this.copySelectedFlowNode();
                return clones[0];
            },

            pasteCopiedFlowNode() {
                if (!this.flowNodeClipboard) return null;
                this.flowNodeClipboardPasteCount = Number(this.flowNodeClipboardPasteCount || 0) + 1;
                const offset = 36 * this.flowNodeClipboardPasteCount;
                const items = Array.isArray(this.flowNodeClipboard.items)
                    ? this.flowNodeClipboard.items
                    : [this.flowNodeClipboard];
                const clones = items
                    .map((snapshot) => {
                        const position = snapshot.position || { left: 80, top: 80 };
                        return this.appendFlowNodeClone(snapshot, (position.left || 0) + offset, (position.top || 0) + offset, { select: false });
                    })
                    .filter(Boolean);
                if (!clones.length) return null;
                this.setFlowNodeSelection(clones.map((node) => node.dataset.nodeId || ""), clones[0].dataset.nodeId || "");
                return clones[0];
            },

            isLiveFlowNodeElement(node) {
                return Boolean(
                    node
                    && node.isConnected
                    && node.classList?.contains("flow-node")
                    && node.closest?.(`#flowCanvasViewport-${PAGE_CODE}`)
                );
            },

            getVisualSelectedFlowNodes() {
                return this.getFlowNodes()
                    .filter((node) => node.classList.contains("is-selected"));
            },

            getVisualSelectedFlowNodeIds() {
                return this.getVisualSelectedFlowNodes()
                    .map((node) => node.dataset.nodeId || "")
                    .filter(Boolean);
            },

            getSelectedFlowNodeIds() {
                return this.syncFlowNodeSelectionStateFromVisual(this.selectedNodeId);
            },

            syncFlowNodeSelectionStateFromVisual(primaryNodeId = "") {
                const visualIds = this.getVisualSelectedFlowNodeIds().filter((nodeId) => this.getFlowNode(nodeId));
                this.selectedNodeIds = new Set(visualIds);
                this.selectedNodeId = visualIds.includes(primaryNodeId)
                    ? primaryNodeId
                    : (visualIds[visualIds.length - 1] || "");
                return visualIds;
            },

            areFlowNodeIdListsEqual(leftIds, rightIds) {
                const left = (leftIds || []).filter(Boolean);
                const right = (rightIds || []).filter(Boolean);
                if (left.length !== right.length) return false;
                return left.every((nodeId, index) => nodeId === right[index]);
            },

            reconcileFlowNodeSelectionState() {
                return this.syncFlowNodeSelectionStateFromVisual(this.selectedNodeId);
            },

            isFlowNodeSelected(nodeId) {
                return Boolean(nodeId && this.getSelectedFlowNodeIds().includes(nodeId));
            },

            applyFlowNodeSelectionClasses() {
                const selectedIds = this.selectedNodeIds || new Set();
                const primaryNodeId = this.selectedNodeId || "";
                this.getFlowNodes().forEach((node) => {
                    const nodeId = node.dataset.nodeId || "";
                    const selected = selectedIds.has(nodeId);
                    node.classList.toggle("is-selected", selected);
                    node.style.zIndex = selected ? (nodeId === primaryNodeId ? "7" : "6") : "";
                });
                return this.syncFlowNodeSelectionStateFromVisual(primaryNodeId);
            },

            renderSelectedFlowNodeInspector(node) {
                if (!node) return;
                this.rememberFlowNodeSelection(this.selectedNodeId);
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

            commitFlowNodeSelection(nodeIds = [], primaryNodeId = "", options = {}) {
                if (options.syncBeforeStore !== false) this.reconcileFlowNodeSelectionState();
                if (options.store !== false) this.storeSelectedNodeInspectorState();
                const validIds = Array.from(new Set((nodeIds || []).filter((nodeId) => nodeId && this.getFlowNode(nodeId))));
                this.selectedNodeIds = new Set(validIds);
                this.selectedNodeId = this.selectedNodeIds.has(primaryNodeId)
                    ? primaryNodeId
                    : (validIds[validIds.length - 1] || "");
                if (options.clearEdge !== false) {
                    this.selectedEdgeId = "";
                    this.hideSelectedEdgeDelete();
                }
                const finalIds = this.applyFlowNodeSelectionClasses();

                const node = this.getFlowNode(this.selectedNodeId);
                if (!node) {
                    if (options.clearInspector !== false) this.clearNodeInspector();
                    return finalIds;
                }

                if (options.updateInspector !== false) {
                    this.renderSelectedFlowNodeInspector(node);
                }
                return finalIds;
            },

            clearFlowNodeSelection(options = {}) {
                return this.commitFlowNodeSelection([], "", options);
            },

            setFlowNodeSelection(nodeIds, primaryNodeId = "", options = {}) {
                return this.commitFlowNodeSelection(nodeIds, primaryNodeId, options);
            },

            toggleFlowNodeSelection(nodeId) {
                const id = String(nodeId || "");
                if (!id || !this.getFlowNode(id)) return;
                const selected = new Set(this.getSelectedFlowNodeIds());
                if (selected.has(id)) {
                    selected.delete(id);
                } else {
                    selected.add(id);
                }
                const selectedIds = Array.from(selected);
                this.setFlowNodeSelection(selectedIds, selected.has(id) ? id : selectedIds[selectedIds.length - 1] || "", { clearInspector: selected.size === 0 });
            },

            rememberFlowNodeSelection(nodeId) {
                const id = String(nodeId || "");
                if (!id) return;
                this.flowNodeSelectionHistory = (this.flowNodeSelectionHistory || []).filter((item) => item !== id);
                this.flowNodeSelectionHistory.push(id);
                if (this.flowNodeSelectionHistory.length > 40) {
                    this.flowNodeSelectionHistory = this.flowNodeSelectionHistory.slice(-40);
                }
            },

            removeFlowNodeSelectionHistory(nodeId) {
                const id = String(nodeId || "");
                this.flowNodeSelectionHistory = (this.flowNodeSelectionHistory || []).filter((item) => item !== id);
            },

            openFlowNodeInspector(nodeId) {
                const id = String(nodeId || "");
                if (!id || !this.getFlowNode(id)) return;
                this.selectFlowNode(id);
                this.setFlowInspectorCollapsed(false);
            },

            selectFlowNode(nodeId) {
                const id = String(nodeId || "");
                if (!id || !this.getFlowNode(id)) {
                    this.clearFlowNodeSelection();
                    return;
                }
                this.setFlowNodeSelection([id], id);
            },

            getResultCreateModeLabel(value) {
                const mode = this.normalizeResultCreateMode(value);
                const labels = {
                    N: this.getMessage("resultCreateNone", "N (Not used)"),
                    T: this.getMessage("resultCreateTable", "T (Table)"),
                    M: this.getMessage("resultCreateModel", "M (Model)")
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

            isWebApiFlowNode(node) {
                if (!node) return false;
                if (String(node.dataset.execSourceType || "").toUpperCase() === "WEB_API") return true;
                const refJob = this.getRegisteredJobAsset(node.dataset.refWorkJobId || "");
                if (String(refJob?.EXEC_SOURCE_TYPE || "").toUpperCase() === "WEB_API") return true;
                const script = String(node.dataset.execPlsql || "");
                const spec = String(node.dataset.execSpecJson || "");
                return /"type"\s*:\s*"WEB_API"/i.test(script)
                    || /"type"\s*:\s*"WEB_API"/i.test(spec);
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
                if (this.isWebApiFlowNode(node)) {
                    const entries = [];
                    const seen = new Set();
                    this.getNodeParams(node)
                        .filter((item) => this.isInputNodeParamDefinition(item))
                        .forEach((item) => {
                            const paramName = item?.itemName || item?.ITEM_NAME || item?.name || item?.NAME || item?.key || item?.KEY || "";
                            const systemBindName = this.getNodeParamSystemBindName(item);
                            const name = systemBindName || paramName;
                            const key = this.normalizeBindParamKey(name);
                            if (!name || seen.has(key)) return;
                            seen.add(key);
                            entries.push({ name, label: `:${name}` });
                        });
                    if (entries.length) return entries;
                }
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
                    return this.getMessage("paramDescFlowRunId", "Use (auto) or blank for a new flow run id. Enter an existing flow run id to overwrite that run.");
                }
                if (canonicalName.includes("$Pre") && !this.getPreviousNodeForSystemBind(node)) {
                    return this.getMessage("paramDescNoUpstreamNode", "No upstream node is connected.");
                }
                const commentKeys = {
                    "INIT$TargetOwner": ["paramDescSystemTargetOwner", "Current node target Owner."],
                    "INIT$TargetTable": ["paramDescSystemTargetTable", "Current node target Table."],
                    "INIT$ResultOwner": ["paramDescSystemResultOwner", "Current node result Owner."],
                    "INIT$ResultTable": ["paramDescSystemResultTable", "Current node result Table or Model."],
                    "INIT$ResultModelName": ["paramDescSystemResultModel", "Current node result Model name."],
                    "INIT$PreTargetOwner": ["paramDescSystemPreTargetOwner", "Connected upstream node's target Owner."],
                    "INIT$PreTargetTable": ["paramDescSystemPreTargetTable", "Connected upstream node's target Table."],
                    "INIT$PreResultOwner": ["paramDescSystemPreResultOwner", "Connected upstream result Owner."],
                    "INIT$PreResultTable": ["paramDescSystemPreResultTable", "Connected upstream result Table or Model; REQUIRED SAME_RUN inputs use the current Flow Run result."],
                    "INIT$RunSourceType": ["paramDescSystemRunSourceType", "Execution source type. Flow nodes use FLOW_WORK."]
                };
                const mapped = commentKeys[canonicalName];
                if (mapped) return this.getMessage(mapped[0], mapped[1]);
                return this.getMessage("paramDescSystemBind", "System bind value. It is supplied automatically at run time.");
            },

            getNodeParams(node) {
                const params = this.parseNodeJson(node?.dataset?.nodeParams, []);
                const safeParams = Array.isArray(params) ? params : [];
                const refJob = this.getRegisteredJobAsset(node?.dataset?.refWorkJobId || "");
                const refParams = this.parseNodeJson(refJob?.PARAM_JSON, []);
                if (!Array.isArray(refParams) || !refParams.length) return safeParams;
                const seen = new Set();
                safeParams.forEach((item) => {
                    this.getNodeParamMatchKeys(item).forEach((key) => seen.add(key));
                });
                const missingParams = refParams.filter((item) => {
                    const keys = this.getNodeParamMatchKeys(item);
                    return keys.length && !keys.some((key) => seen.has(key));
                });
                return [...safeParams, ...missingParams];
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
                const comment = String(item?.itemDesc || item?.ITEM_DESC || item?.comment || item?.COMMENT || "");
                const name = String(item?.itemName || item?.ITEM_NAME || item?.name || item?.NAME || item?.key || item?.KEY || "");
                const commentKeys = {
                    ptargetowner: "paramDescTargetOwner",
                    ptargettable: "paramDescTargetTable",
                    pdynamicmodelname: "paramDescDynamicModelName",
                    ppredictionmethod: "paramDescPredictionMethod",
                    ptargetcolumn: "paramDescTargetColumn",
                    pruleparts: "paramDescRuleParts",
                    passocmodelname: "paramDescAssocModelName",
                    pruleownername: "paramDescRuleOwnerName",
                    prulemodelname: "paramDescRuleModelName",
                    psymbolicruletablename: "paramDescSymbolicRuleTableName",
                    pruleid: "paramDescRuleId",
                    pclusterusagemode: "paramDescClusterUsageMode",
                    pcaseidcolumnname: "paramDescCaseIdColumn",
                    pminsupport: "paramDescMinSupport",
                    pminconfidence: "paramDescMinConfidence",
                    pminrulelift: "paramDescMinRuleLift",
                    pminlift: "paramDescMinLift",
                    pmaxfeatures: "paramDescMaxFeatures",
                    psamplerows: "paramDescSampleRows",
                    pminr2score: "paramDescMinR2Score",
                    pmaxautotargets: "paramDescMaxAutoTargets",
                    pcontinueonerror: "paramDescContinueOnError",
                    prunsourcetype: "paramDescRunSourceType",
                    prunid: "paramDescRunId",
                    pmaxrules: "paramDescMaxRules",
                    psymbolicmaxrules: "paramDescSymbolicMaxRules",
                    pmaxviolationsperrule: "paramDescMaxViolationsPerRule",
                    perrorpctthreshold: "paramDescErrorPctThreshold",
                    pabserrorthreshold: "paramDescAbsErrorThreshold",
                    pmaxscanrows: "paramDescMaxScanRows",
                    pclearexistingyn: "paramDescClearExistingYn",
                    pcommityn: "paramDescCommitYn",
                    pcommitinterval: "paramDescCommitInterval"
                };
                const fallbackComments = {
                    ptargetowner: "Target table owner",
                    ptargettable: "Target table name",
                    pdynamicmodelname: "Classification/prediction model name",
                    ppredictionmethod: "Prediction method (ONLY_RULE: BASE columns only, ONLY_MODEL: model columns only, ONLY_BOTH: BASE/MODEL columns, FINAL_RULE/MODEL/BOTH: apply FINAL automatically)",
                    ptargetcolumn: "Dependent variable column; (auto) evaluates eligible targets.",
                    pruleparts: "Execution scope: ALL, CATEGORICAL, or CONTINUOUS.",
                    passocmodelname: "Association model name for categorical rule discovery.",
                    pruleownername: "Owner of the upstream association rule model.",
                    prulemodelname: "Association rule model name produced by the upstream rule-discovery run.",
                    psymbolicruletablename: "Symbolic rule storage table; use INIT$_TB_SYMBOLIC_RULE, not an OML association model name.",
                    pruleid: "Optional symbolic rule ID; (auto) evaluates all eligible rules.",
                    pclusterusagemode: "Cluster usage: NONE, PREFER_SAME_CLUSTER, or WITHIN_CLUSTER_ONLY; non-NONE requires the same run's relationship network.",
                    pcaseidcolumnname: "Case ID column used to identify source rows.",
                    pminsupport: "Apriori minimum support.",
                    pminconfidence: "Minimum confidence for rule discovery or detection.",
                    pminrulelift: "Minimum lift for stored association-rule summaries.",
                    pminlift: "Minimum lift for categorical violation rules.",
                    pmaxfeatures: "Maximum selected feature count.",
                    psamplerows: "Maximum analysis sample rows.",
                    pminr2score: "Minimum LASSO R-squared score for symbolic rule generation.",
                    pmaxautotargets: "Maximum automatic target count.",
                    pcontinueonerror: "Continue remaining subtasks after one subtask fails; review partial-completion details.",
                    prunsourcetype: "Execution source type (DATA_WORK/FLOW_WORK).",
                    prunid: "Run ID that links results from the same Data Work or Flow execution.",
                    pmaxrules: "Maximum categorical rule count to evaluate.",
                    psymbolicmaxrules: "Maximum symbolic rule count to evaluate.",
                    pmaxviolationsperrule: "Maximum violation rows stored per rule.",
                    perrorpctthreshold: "Allowed relative error for symbolic rules; 0.05 means 5%.",
                    pabserrorthreshold: "Allowed absolute error for symbolic rules; blank disables this additional threshold.",
                    pmaxscanrows: "Maximum source rows scanned per symbolic rule.",
                    pclearexistingyn: "Clear existing violation rows for the same run before detection (Y/N).",
                    pcommityn: "Commit inside the subprocedure (Y/N); keep N when the integrated API coordinates the transaction.",
                    pcommitinterval: "Commit interval for large violation inserts; 0 uses one final commit."
                };
                const normalizedName = this.normalizeBindParamKey(name);
                const key = commentKeys[normalizedName];
                return key ? this.getMessage(key, fallbackComments[normalizedName] || comment) : comment;
            },

            getNodeParamDefault(item) {
                return item?.itemDefault ?? item?.ITEM_DEFAULT ?? item?.defaultValue ?? item?.DEFAULT_VALUE ?? "";
            },

            getNodeParamSystemBindName(item) {
                const text = String(this.getNodeParamDefault(item) ?? "").trim();
                const bindMatch = text.match(/^:([A-Za-z][A-Za-z0-9_$#]*)$/);
                if (bindMatch && this.isSystemBindName(bindMatch[1])) {
                    return this.normalizeSystemBindName(bindMatch[1]);
                }
                const tokenMatch = text.match(/^\/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*)\s*--\s*\*\/$/);
                if (tokenMatch && this.isSystemBindName(tokenMatch[1])) {
                    return this.normalizeSystemBindName(tokenMatch[1]);
                }
                return "";
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
                    return this.getMessage("paramDefaultOverrideHint", "Parameter default. You can override it for this node run.");
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
                if (["P_CLUSTER_USAGE_MODE", "P_RULE_PARTS"].some((paramName) => (
                    this.normalizeBindParamKey(name) === this.normalizeBindParamKey(paramName)
                ))) {
                    this.refreshFlowNodeContractPorts(node);
                }
            },

            refreshFlowNodeContractPorts(node) {
                if (!node) return;
                const refJob = this.getRegisteredJobAsset(node.dataset.refWorkJobId || "");
                const data = {
                    nodeType: node.dataset.nodeType || "JOB",
                    execObjectName: node.dataset.execObjectName || "",
                    execMethod: node.dataset.execMethod || "",
                    resultCreateYn: node.dataset.resultCreateYn || "N",
                    params: this.getNodeParams(node)
                };
                const inputHtml = this.renderNodePortSpans(
                    this.getRenderInputPorts(data.nodeType, data, refJob),
                    "in",
                    "TABLE"
                );
                const outputHtml = this.renderNodePortSpans(
                    this.getRenderOutputPorts(data.nodeType, data, refJob),
                    "out",
                    this.getNodeOutputAssetKind(data, refJob)
                );
                const footer = node.querySelector(".flow-node-ports");
                if (footer) footer.innerHTML = this.renderNodePortGroups(inputHtml, outputHtml);
                this.ensureNodeConnectors(node);
                this.updateFlowEdges();
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
                    const isClusterUsageMode = this.normalizeBindParamKey(name) === this.normalizeBindParamKey("P_CLUSTER_USAGE_MODE");
                    const inputControl = isClusterUsageMode
                        ? `<select class="env-field flow-node-bind-input" data-bind-name="${this.escapeHtml(name)}" onchange="${PAGE_CODE}.updateNodeBindValue(this.dataset.bindName, this.value)">
                            ${["PREFER_SAME_CLUSTER", "NONE", "WITHIN_CLUSTER_ONLY"].map((option) => `<option value="${option}" ${String(value || "").toUpperCase() === option ? "selected" : ""}>${option}</option>`).join("")}
                        </select>`
                        : `<input class="env-field flow-node-bind-input" data-bind-name="${this.escapeHtml(name)}" type="text" value="${this.escapeHtml(value)}" oninput="${PAGE_CODE}.updateNodeBindValue(this.dataset.bindName, this.value)">`;
                    return `
                        <label class="data-bind-row">
                            <span class="data-bind-meta">
                                <span class="flow-bind-name">${this.escapeHtml(label)}</span>
                                ${comment ? `<small class="flow-bind-comment">${this.escapeHtml(comment)}</small>` : ""}
                            </span>
                            ${inputControl}
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
                    type: port.dataset.artifact ? (port.classList.contains("is-model") ? "MODEL" : "TABLE") : portType,
                    artifact: port.dataset.artifact || "",
                    shape: port.dataset.portShape || "square",
                    required: port.dataset.required === "Y",
                    runScope: port.dataset.runScope || "",
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
                    this.getMessage("manualFlowRunIdRegenerate", "FLOW_RUN_ID {runId} results will be regenerated.", { runId }),
                    "",
                    this.getMessage("manualFlowRunIdOverwriteWarning", "Existing node run records and result rows for this flow run may be deleted and inserted again."),
                    this.getMessage("continueQuestion", "Continue?")
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
                        execObjectName: node.dataset.execObjectName || "",
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
                const validEdges = this.pruneInvalidFlowEdges();

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
                    edges: validEdges.map((edge, index) => ({
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
                this.flowLayoutGrid = null;
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
                this.saveStoredContext({ flowId: flow.FLOW_ID || "" });
            },

            renderFlowCanvasFromData(nodes, edges) {
                const viewport = this.getFlowViewport();
                if (!viewport) return;
                this.clearCanvasRunStatusOverlay();
                viewport.querySelectorAll(".flow-node").forEach((node) => node.remove());
                viewport.querySelector(".flow-selection-box")?.remove();
                this.setSampleFlowState(false);
                this.clearFlowNodeSelection({ store: false, clearInspector: false, clearEdge: false, syncBeforeStore: false });
                this.flowNodeSelectionHistory = [];
                this.flowNodeClickState = null;
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
                this.pruneInvalidFlowEdges({ render: false });
                const firstNode = this.getFlowNodes()[0];
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
                        ? this.getMessage("dashedConnectionOnHint", "Dashed connection mode is on.")
                        : this.getMessage("dashedConnectionShiftHint", "Hold Shift while connecting to create a one-time dashed on-complete edge.");
                    this.setMultilineText(
                        label,
                        `${this.getMessage("connectorClickHint", "Click the right output connector, then click the left input connector of the node to connect.")}\n${dashedHint}`
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
                this.renderCanvasMaximizeToggle(nextMaximized);
                this.renderFlowInspectorToggle();
                setTimeout(() => {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                    if (
                        nextMaximized
                        && (
                            window.matchMedia?.("(max-width: 1100px)")?.matches
                            || window.matchMedia?.("(max-height: 760px)")?.matches
                        )
                    ) {
                        getContainerEl(".flow-designer-card")?.scrollIntoView?.({
                            block: "start",
                            behavior: "smooth"
                        });
                    }
                }, 0);
            },

            renderCanvasMaximizeToggle(maximized = null) {
                const button = getContainerEl(`#flowCanvasMaximize-${PAGE_CODE}`);
                if (!button) return;
                const isMaximized = maximized === null
                    ? Boolean(document.getElementById(`container-${PAGE_CODE}`)?.classList.contains("is-flow-canvas-maximized"))
                    : Boolean(maximized);
                const titleKey = isMaximized ? "restoreCanvasTitle" : "maximizeCanvasTitle";
                const title = this.getLabel(titleKey, isMaximized ? "Restore canvas" : "Maximize canvas");
                button.dataset.titleKey = titleKey;
                button.title = title;
                button.setAttribute("aria-label", title);

                const icon = button.querySelector("i");
                if (!icon) return;
                icon.classList.remove("fa-compress");
                icon.classList.toggle("fa-expand", !isMaximized);
                icon.classList.toggle("fa-down-left-and-up-right-to-center", isMaximized);
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
                    if (!this.flowInspectorCollapsed && window.matchMedia?.("(max-width: 1100px)")?.matches) {
                        getContainerEl(".flow-inspector-panel")?.scrollIntoView?.({
                            block: "nearest",
                            behavior: "smooth"
                        });
                    }
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

            getCurrentFlowNodeIdSet() {
                return new Set(this.getFlowNodes().map((node) => node.dataset.nodeId || "").filter(Boolean));
            },

            getValidFlowEdges(edges = this.flowEdges, nodeIdSet = this.getCurrentFlowNodeIdSet()) {
                return (edges || []).filter((edge) =>
                    edge?.from
                    && edge?.to
                    && edge.from !== edge.to
                    && nodeIdSet.has(edge.from)
                    && nodeIdSet.has(edge.to)
                );
            },

            pruneInvalidFlowEdges(options = {}) {
                const nextEdges = this.getValidFlowEdges();
                if (nextEdges.length === this.flowEdges.length) return nextEdges;
                this.flowEdges = nextEdges;
                if (this.selectedEdgeId && !this.flowEdges.some((edge, index) => this.getEdgeId(edge, index) === this.selectedEdgeId)) {
                    this.selectedEdgeId = "";
                    this.hideSelectedEdgeDelete();
                }
                if (options.render !== false) {
                    this.updateFlowEdges();
                    this.renderFlowEdgeGrid();
                }
                return nextEdges;
            },

            applyAutoConnectionsByX() {
                this.finishEdgeDrag();
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                const orderedNodes = this.getFlowNodes()
                    .map((node) => ({
                        node,
                        nodeId: node.dataset.nodeId || "",
                        position: this.getNodePosition(node)
                    }))
                    .filter((item) => item.nodeId)
                    .sort((a, b) =>
                        a.position.left - b.position.left
                        || a.position.top - b.position.top
                        || a.nodeId.localeCompare(b.nodeId)
                    );

                if (orderedNodes.length < 2) {
                    CommonMessage.warn(this.getMessage("autoConnectNeedsTwoNodes", "At least two nodes are required to apply automatic connections."), { copyable: false });
                    return;
                }

                const nextEdges = [];
                for (let index = 0; index < orderedNodes.length - 1; index += 1) {
                    const fromItem = orderedNodes[index];
                    const toItem = orderedNodes[index + 1];
                    const edge = this.buildSequentialJobEdge(fromItem.node, toItem.node);
                    if (edge) nextEdges.push(edge);
                }

                if (!nextEdges.length) {
                    CommonMessage.warn(this.getMessage("autoConnectNoPorts", "No IN/OUT ports are available for automatic connections."), { copyable: false });
                    return;
                }

                this.flowEdges = nextEdges;
                this.markFlowEdited();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
                const selectedNode = this.getFlowNode(this.selectedNodeId);
                if (selectedNode) {
                    this.renderNodeBindVariables(selectedNode);
                    this.setValue(`#nodeDependsOn-${PAGE_CODE}`, this.getUpstreamNodeIds(this.selectedNodeId).join(", "));
                }
                CommonMessage.success(this.getMessage("autoConnectAppliedByX", "Automatic connections were applied by x-axis position."), { copyable: false });
            },

            autoLayoutFlow() {
                const nodes = this.getFlowNodes();
                if (!nodes.length) return;

                const nodeItems = nodes
                    .map((node) => ({
                        node,
                        nodeId: node.dataset.nodeId || "",
                        position: this.getNodePosition(node)
                    }))
                    .filter((item) => item.nodeId);
                if (!nodeItems.length) return;

                if (this.hasFlowCycle()) {
                    CommonMessage.warn(this.getMessage("treeLayoutCycleBlocked", "Tree layout cannot be applied because the flow has a cycle. Remove the loop and try again."), { copyable: false });
                    return;
                }

                const median = (values) => {
                    if (!values.length) return null;
                    const sorted = [...values].sort((a, b) => a - b);
                    const middle = Math.floor(sorted.length / 2);
                    return sorted.length % 2 === 0
                        ? (sorted[middle - 1] + sorted[middle]) / 2
                        : sorted[middle];
                };
                const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
                const clusterAxisValues = (values, tolerance) => {
                    const clusters = [];
                    [...values].sort((a, b) => a - b).forEach((value) => {
                        const last = clusters[clusters.length - 1];
                        if (!last || Math.abs(value - last.avg) > tolerance) {
                            clusters.push({ avg: value, sum: value, count: 1 });
                            return;
                        }
                        last.sum += value;
                        last.count += 1;
                        last.avg = last.sum / last.count;
                    });
                    return clusters.map((cluster) => cluster.avg);
                };
                const getGridStep = (values, tolerance, fallback, min, max) => {
                    const clusters = clusterAxisValues(values, tolerance);
                    const diffs = clusters
                        .slice(1)
                        .map((value, index) => value - clusters[index])
                        .filter((diff) => diff >= min * 0.65);
                    const measured = median(diffs);
                    if (!measured) return fallback;
                    return clamp(Math.round(measured / 10) * 10, min, max);
                };
                const maxNodeWidth = Math.max(...nodeItems.map((item) => item.position.width || 0), 150);
                const maxNodeHeight = Math.max(...nodeItems.map((item) => item.position.height || 0), 90);
                const connectorGap = Math.max(120, Math.round(maxNodeWidth * 0.65));
                const rowGap = Math.max(80, Math.round(maxNodeHeight * 0.55));
                const minColumnWidth = Math.round(maxNodeWidth + connectorGap);
                const minRowHeight = Math.round(maxNodeHeight + rowGap);
                const flowKey = this.getCurrentFlowRunKey();
                const cachedGrid = this.flowLayoutGrid?.flowKey === flowKey ? this.flowLayoutGrid : null;
                const columnWidth = Number(cachedGrid?.columnWidth) >= minColumnWidth
                    ? Number(cachedGrid.columnWidth)
                    : getGridStep(
                    nodeItems.map((item) => item.position.left),
                    Math.min(80, Math.max(40, maxNodeWidth * 0.45)),
                    minColumnWidth,
                    minColumnWidth,
                    Math.max(minColumnWidth + 180, Math.round(minColumnWidth * 1.45))
                );
                const rowHeight = Number(cachedGrid?.rowHeight) >= minRowHeight
                    ? Number(cachedGrid.rowHeight)
                    : getGridStep(
                    nodeItems.map((item) => item.position.top),
                    Math.min(70, Math.max(35, maxNodeHeight * 0.5)),
                    minRowHeight,
                    minRowHeight,
                    Math.max(minRowHeight + 140, Math.round(minRowHeight * 1.45))
                );
                const minLeft = Math.min(...nodeItems.map((item) => item.position.left));
                const minTop = Math.min(...nodeItems.map((item) => item.position.top));
                const baseX = Math.max(20, Math.round(minLeft / 20) * 20);
                const baseY = Math.max(20, Math.round(minTop / 20) * 20);
                const occupiedCells = new Set();
                const cellByNode = new Map();
                const cellKey = (col, row) => `${col}:${row}`;
                const getPreferredCell = (item) => ({
                    col: Math.max(0, Math.round((item.position.left - baseX) / columnWidth)),
                    row: Math.max(0, Math.round((item.position.top - baseY) / rowHeight))
                });
                const findNearestFreeCell = (preferredCol, preferredRow) => {
                    const maxRadius = Math.max(8, nodeItems.length + 8);
                    for (let radius = 0; radius <= maxRadius; radius += 1) {
                        let bestCell = null;
                        let bestScore = Number.POSITIVE_INFINITY;
                        for (let dc = -radius; dc <= radius; dc += 1) {
                            for (let dr = -radius; dr <= radius; dr += 1) {
                                if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                                const col = preferredCol + dc;
                                const row = preferredRow + dr;
                                if (col < 0 || row < 0) continue;
                                if (occupiedCells.has(cellKey(col, row))) continue;
                                const score = (Math.abs(dc) * 2.5) + Math.abs(dr);
                                if (
                                    score < bestScore
                                    || (
                                        score === bestScore
                                        && (!bestCell || row < bestCell.row || (row === bestCell.row && col < bestCell.col))
                                    )
                                ) {
                                    bestScore = score;
                                    bestCell = { col, row };
                                }
                            }
                        }
                        if (bestCell) return bestCell;
                    }

                    let row = preferredRow;
                    while (occupiedCells.has(cellKey(preferredCol, row))) {
                        row += 1;
                    }
                    return { col: preferredCol, row };
                };

                [...nodeItems]
                    .sort((a, b) => {
                        const aCell = getPreferredCell(a);
                        const bCell = getPreferredCell(b);
                        return aCell.col - bCell.col
                            || aCell.row - bCell.row
                            || a.position.left - b.position.left
                            || a.position.top - b.position.top
                            || a.nodeId.localeCompare(b.nodeId);
                    })
                    .forEach((item) => {
                        const preferredCell = getPreferredCell(item);
                        const cell = findNearestFreeCell(preferredCell.col, preferredCell.row);
                        occupiedCells.add(cellKey(cell.col, cell.row));
                        cellByNode.set(item.nodeId, cell);
                    });

                nodeItems.forEach((item) => {
                    const cell = cellByNode.get(item.nodeId);
                    if (!cell) return;
                    this.setNodePosition(item.node, baseX + cell.col * columnWidth, baseY + cell.row * rowHeight);
                });

                this.flowLayoutGrid = { flowKey, columnWidth, rowHeight };
                this.markFlowEdited();
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
                    const dependencyType = String(this.getEdgeParams(edge)?.dependencyType || "ORDER_REQUIRED").toUpperCase();
                    const stroke = edge.dashed ? "#94a3b8" : (dependencyType === "DATA_REQUIRED" ? "#2563eb" : "#64748b");
                    const selected = edgeId === this.selectedEdgeId ? " is-selected" : "";
                    return `
                        <path class="flow-edge-hit-path" data-edge-id="${this.escapeHtml(edgeId)}" d="${d}" fill="none" stroke="transparent" stroke-width="18"></path>
                        <path class="flow-edge-path${selected}" data-edge-id="${this.escapeHtml(edgeId)}" data-dependency-type="${this.escapeHtml(dependencyType)}" d="${d}" fill="none" stroke="${stroke}" stroke-width="2"${dash} marker-end="${markerUrl}"></path>
                    `;
                }).join("");
                edgeLayer.innerHTML = `${defs}${paths}`;
                this.updateSelectedEdgeDeleteButton();
            },

            getEdgeId(edge, index = 0) {
                return edge._edgeId || `${edge.from || "from"}:${edge.fromPort || "output"}>${edge.to || "to"}:${edge.toPort || "input"}:${index}`;
            },

            selectFlowEdge(edgeId) {
                this.reconcileFlowNodeSelectionState();
                this.storeSelectedNodeInspectorState();
                this.selectedEdgeId = edgeId || "";
                this.clearFlowNodeSelection({ store: false, clearInspector: false, clearEdge: false, syncBeforeStore: false });
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
            validateFlowEdgeContract(edge) {
                const fromNode = this.getFlowNode(edge?.from || "");
                const toNode = this.getFlowNode(edge?.to || "");
                if (!fromNode || !toNode) return "";
                const fromContract = this.getFlowModelContract({
                    execObjectName: fromNode.dataset.execObjectName,
                    execMethod: fromNode.dataset.execMethod
                });
                const toContract = this.getFlowModelContract({
                    execObjectName: toNode.dataset.execObjectName,
                    execMethod: toNode.dataset.execMethod
                });
                const fromStage = Number(fromContract?.stage || 0);
                const toStage = Number(toContract?.stage || 0);
                if (fromStage && toStage && fromStage > toStage) {
                    return this.getMessage(
                        "flowEdgeStageBlocked",
                        "Stage {fromStage} cannot precede stage {toStage}.",
                        { fromStage, toStage }
                    );
                }
                const sourcePort = Array.from(fromNode.querySelectorAll(".flow-port-out"))
                    .find((port) => this.getFlowPortName(port) === String(edge.fromPort || ""));
                const targetPort = Array.from(toNode.querySelectorAll(".flow-port-in"))
                    .find((port) => this.getFlowPortName(port) === String(edge.toPort || ""));
                const sourceArtifact = sourcePort?.dataset.artifact || "";
                const targetArtifact = targetPort?.dataset.artifact || "";
                if (sourceArtifact && targetArtifact && sourceArtifact !== targetArtifact) {
                    return this.getMessage(
                        "flowEdgeArtifactBlocked",
                        "{sourceArtifact} output cannot connect to {targetArtifact} input.",
                        { sourceArtifact, targetArtifact }
                    );
                }
                return "";
            },

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
                const contractError = this.validateFlowEdgeContract(nextEdge);
                if (contractError) {
                    CommonMessage.warn(contractError, { copyable: false });
                    return;
                }
                if (this.wouldCreateFlowCycle(nextEdge)) {
                    CommonMessage.warn(this.getMessage("cyclicEdgeBlocked", "This connection would create a cycle. A flow must remain a DAG without looping back to an earlier node."), { copyable: false });
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
                                <th>Dependency</th>
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
                                    <td>${this.escapeHtml(this.getEdgeParams(edge)?.dependencyType || "ORDER_REQUIRED")}</td>
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
            setFlowRunHistoryCount(count = 0) {
                const countEl = getContainerEl(`#flowRunHistoryCount-${PAGE_CODE}`);
                if (!countEl) return;
                countEl.innerHTML = this.renderListFooter(count);
            },
            async loadFlowRunHistory(options = {}) {
                const container = getContainerEl(`#flowRunHistoryGrid-${PAGE_CODE}`);
                if (!container) return;
                const showFeedback = Boolean(options.showFeedback);
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    this.setFlowRunHistoryCount(0);
                    container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>`;
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
                    this.setFlowRunHistoryCount(0);
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
                                <th>Job Group</th>
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
                const safeRows = this.flowRunHistoryRows;
                this.setFlowRunHistoryCount(safeRows.length);
                if (!safeRows.length) {
                    container.innerHTML = `<div class="table-empty">No run history.</div>`;
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
                            ${safeRows.map((row) => {
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
                                <th>Job Group</th>
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
                                ${this.escapeHtml(this.getMessage("nodeRunParamsCount", "{count} call option parameter(s)", { count: count.toLocaleString() }))}
                            </button>
                        ` : `<small>${this.escapeHtml(this.getMessage("nodeRunParamsCount", "{count} call option parameter(s)", { count: "0" }))}</small>`}
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
                    const directComment = this.getNodeParamComment(item);
                    if (directComment) return directComment;
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
                    : `<tr><td colspan="3" class="table-empty">${this.escapeHtml(this.getMessage("noNodeRunParams", "No call option parameters."))}</td></tr>`;
                layer.innerHTML = `
                    <div class="flow-node-run-param-backdrop" onclick="${PAGE_CODE}.closeNodeRunParamsLayer()"></div>
                    <section class="flow-node-run-param-dialog" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(this.getMessage("nodeRunParamsTitle", "Call option parameters"))}">
                        <div class="flow-node-run-param-dragbar" title="Drag to move">
                            <span></span>
                        </div>
                        <header>
                            <span>
                                <strong>${this.escapeHtml(nodeName)}</strong>
                                <small>${this.escapeHtml(this.getMessage("nodeRunParamsCount", "{count} call option parameter(s)", { count: entries.length.toLocaleString() }))}</small>
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
                    modeLabel: mode === "M"
                        ? this.getMessage("resultModeModel", "Model")
                        : (mode === "T" ? this.getMessage("resultModeTable", "Table") : this.getMessage("resultModeNone", "None")),
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
                const title = this.getMessage("selectedNodeResultSqlTitle", "{nodeName} Result SQL", {
                    nodeName: info.nodeName || this.getMessage("node", "Node")
                });
                const titleEl = getContainerEl(`#flowResultSqlTitle-${PAGE_CODE}`);
                if (titleEl) delete titleEl.dataset.labelKey;
                this.setText(`#flowResultSqlTitle-${PAGE_CODE}`, title);
                const hintEl = getContainerEl(`#flowResultSqlHint-${PAGE_CODE}`);
                if (hintEl) delete hintEl.dataset.labelKey;
                const targetHint = info.targetOwner && info.targetTable
                    ? ` / ${this.getMessage("target", "Target")} ${info.targetOwner}.${info.targetTable}`
                    : "";
                this.setText(`#flowResultSqlHint-${PAGE_CODE}`, `${info.modeLabel}: ${info.owner}.${info.objectName}${targetHint}`);
                this.flowResultSqlGridData = { rows: [], columns: [] };
                this.flowResultSqlColumnWidths = {};
                this.flowResultSqlFrozenColumns = 0;
                this.setValue(`#flowResultSqlFreezeColumns-${PAGE_CODE}`, "0");
                this.renderFlowResultSqlMessage("", "info");
                const grid = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE}`);
                if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.getMessage("runSqlPreviewHint", "Run SQL to preview result data."))}</div>${this.renderListFooter(0)}`;
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
                    CommonMessage.warning(this.getMessage("resultSqlSelectOnly", "Result SQL must be a SELECT statement."));
                    return;
                }
                const limitValue = Number(this.getValue(`#flowResultSqlLimit-${PAGE_CODE}`) || 100);
                const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? limitValue : 100, 1000));
                const grid = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE}`);
                const startedAt = performance.now();
                this.renderFlowResultSqlMessage(this.getMessage("runningSql", "Running SQL..."), "info");
                if (grid) {
                    grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.getMessage("executingResultSql", "Executing result SQL..."))}</div>`;
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
                    this.renderFlowResultSqlMessage(this.getMessage("resultSqlRowsSelected", "{count} rows selected. ({elapsed} ms)", {
                        count: rows.length.toLocaleString(),
                        elapsed: elapsedMs.toLocaleString()
                    }), "success");
                    this.renderFlowResultSqlGrid(rows, columns);
                    this.restoreFlowResultSqlSelection(selection);
                } catch (error) {
                    const elapsedMs = Math.round(performance.now() - startedAt);
                    this.flowResultSqlGridData = { rows: [], columns: [] };
                    const message = error.message || this.getMessage("resultSqlExecutionFailed", "Result SQL execution failed.");
                    this.renderFlowResultSqlMessage(`${message} (${elapsedMs.toLocaleString()} ms)`, "error");
                    this.renderError(`#flowResultSqlGrid-${PAGE_CODE}`, message);
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
                    CommonMessage.success(this.getMessage("resultSqlCopied", "Result SQL copied."), { copyable: false });
                } catch (error) {
                    CommonMessage.error(error.message || this.getMessage("resultSqlCopyFailed", "Result SQL copy failed."));
                }
            },
            exportFlowResultSqlGrid(format) {
                const grid = this.flowResultSqlGridData || {};
                const rows = grid.rows || [];
                if (!rows.length) {
                    CommonMessage.warning(this.getMessage("noGridDataToExport", "No grid data to export."));
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
                const colGroupHtml = this.renderFlowResultSqlColGroup(columns);
                const headerHtml = this.renderFlowResultSqlHeader(columns);
                if (!dataRows.length) {
                    if (!columns.length) {
                        container.innerHTML = `<div class="table-empty">${this.escapeHtml(this.getMessage("noData", "No data."))}</div>`;
                        return;
                    }
                    container.innerHTML = `
                        <table class="table-grid flow-result-sql-grid">
                            ${colGroupHtml}
                            <thead>
                                <tr>
                                    ${headerHtml}
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    `;
                    this.syncFlowResultSqlTableWidth();
                    this.applyFlowResultSqlFrozenColumns();
                    return;
                }
                container.innerHTML = `
                    <table class="table-grid flow-result-sql-grid">
                        ${colGroupHtml}
                        <thead>
                            <tr>
                                ${headerHtml}
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
                `;
                this.syncFlowResultSqlTableWidth();
                this.applyFlowResultSqlFrozenColumns();
            },
            renderFlowResultSqlColGroup(columns = []) {
                const rowNoWidth = this.getFlowResultSqlColumnWidth("__ROW_NO__", 0);
                return `
                    <colgroup>
                        <col data-flow-result-col-index="0" style="width: ${rowNoWidth}px;">
                        ${columns.map((column, index) => {
                            const colIndex = index + 1;
                            const width = this.getFlowResultSqlColumnWidth(column, colIndex);
                            return `<col data-flow-result-col-index="${colIndex}" style="width: ${width}px;">`;
                        }).join("")}
                    </colgroup>
                `;
            },
            renderFlowResultSqlHeader(columns = []) {
                const rowNoWidth = this.getFlowResultSqlColumnWidth("__ROW_NO__", 0);
                return `
                    <th class="grid-row-no flow-result-sql-resizable" title="No" style="width: ${rowNoWidth}px;">
                        No
                        <span class="flow-result-sql-col-resizer" title="Resize column" onmousedown="${PAGE_CODE}.beginFlowResultSqlColumnResize(event, 0, '__ROW_NO__')"></span>
                    </th>
                    ${columns.map((column, index) => {
                        const colIndex = index + 1;
                        const width = this.getFlowResultSqlColumnWidth(column, colIndex);
                        return `
                            <th class="flow-result-sql-resizable" title="${this.escapeHtml(column)}" style="width: ${width}px;">
                                <span class="flow-result-sql-th-label">${this.escapeHtml(column)}</span>
                                <span class="flow-result-sql-col-resizer" title="Resize column" onmousedown="${PAGE_CODE}.beginFlowResultSqlColumnResize(event, ${colIndex}, '${this.escapeJs(column)}')"></span>
                            </th>
                        `;
                    }).join("")}
                `;
            },
            getFlowResultSqlColumnKey(column, index) {
                return `${index}:${String(column || "")}`;
            },
            getFlowResultSqlColumnWidth(column, index) {
                const key = this.getFlowResultSqlColumnKey(column, index);
                const savedWidth = Number(this.flowResultSqlColumnWidths?.[key] || 0);
                if (savedWidth > 0) return savedWidth;
                const columnName = String(column || "").toUpperCase();
                if (columnName === "__ROW_NO__") return 58;
                if (/(MESSAGE|EXPRESSION|SQL|ERROR|FEATURE|REASON)/.test(columnName)) return 360;
                if (/(CREATE|UPDATE|DATE|TIME|DT)$/.test(columnName)) return 170;
                if (/(OWNER|TABLE|COLUMN|RULE|MODEL)/.test(columnName)) return 190;
                return 150;
            },
            syncFlowResultSqlTableWidth() {
                const table = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE} table.flow-result-sql-grid`);
                if (!table) return;
                const columns = Array.from(table.querySelectorAll("col"));
                const width = columns.reduce((sum, column) => sum + Math.max(48, parseInt(column.style.width || "0", 10) || 0), 0);
                const tableWidth = Math.max(width, table.parentElement?.clientWidth || 0);
                table.style.width = `${tableWidth}px`;
                table.style.minWidth = `${tableWidth}px`;
            },
            getFlowResultSqlFreezeCount() {
                const input = getContainerEl(`#flowResultSqlFreezeColumns-${PAGE_CODE}`);
                const maxDataColumns = Math.max(0, (this.flowResultSqlGridData?.columns || []).length);
                let dataColumnCount = Number.parseInt(input?.value ?? this.flowResultSqlFrozenColumns ?? 0, 10);
                if (!Number.isFinite(dataColumnCount)) dataColumnCount = 0;
                dataColumnCount = Math.max(0, Math.min(maxDataColumns, dataColumnCount));
                this.flowResultSqlFrozenColumns = dataColumnCount;
                if (input && input.value !== String(dataColumnCount)) input.value = String(dataColumnCount);
                return dataColumnCount + 1;
            },
            applyFlowResultSqlFrozenColumns() {
                const table = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE} table.flow-result-sql-grid`);
                if (!table) return;
                table.querySelectorAll(".is-frozen-col, .is-frozen-edge").forEach((cell) => {
                    cell.classList.remove("is-frozen-col", "is-frozen-edge");
                    cell.style.left = "";
                });
                table.classList.remove("has-frozen-cols");
                const headerRow = table.tHead?.rows?.[0] || table.rows?.[0];
                if (!headerRow) return;
                const headerCells = Array.from(headerRow.children || []);
                const visibleFreezeCount = Math.min(this.getFlowResultSqlFreezeCount(), headerCells.length);
                if (visibleFreezeCount <= 0) return;
                table.classList.add("has-frozen-cols");
                const offsets = [];
                let left = 0;
                for (let index = 0; index < visibleFreezeCount; index += 1) {
                    offsets[index] = left;
                    left += headerCells[index].getBoundingClientRect().width || headerCells[index].offsetWidth || 0;
                }
                Array.from(table.rows || []).forEach((row) => {
                    Array.from(row.children || []).forEach((cell, index) => {
                        if (index >= visibleFreezeCount) return;
                        cell.classList.add("is-frozen-col");
                        if (index === visibleFreezeCount - 1) cell.classList.add("is-frozen-edge");
                        cell.style.left = `${offsets[index]}px`;
                    });
                });
            },
            beginFlowResultSqlColumnResize(event, columnIndex, columnName) {
                event.preventDefault();
                event.stopPropagation();
                const header = event.currentTarget?.closest?.("th");
                if (!header) return;
                const key = this.getFlowResultSqlColumnKey(columnName, columnIndex);
                const startWidth = header.getBoundingClientRect().width || this.getFlowResultSqlColumnWidth(columnName, columnIndex);
                this.flowResultSqlResizeState = {
                    columnIndex,
                    key,
                    startX: event.clientX,
                    startWidth
                };
                this.flowResultSqlResizeMoveBound = this.flowResultSqlResizeMoveBound || this.handleFlowResultSqlColumnResizeMove.bind(this);
                this.flowResultSqlResizeUpBound = this.flowResultSqlResizeUpBound || this.endFlowResultSqlColumnResize.bind(this);
                document.addEventListener("mousemove", this.flowResultSqlResizeMoveBound);
                document.addEventListener("mouseup", this.flowResultSqlResizeUpBound, { once: true });
                document.body.classList.add("is-resizing-flow-result-sql");
            },
            handleFlowResultSqlColumnResizeMove(event) {
                const state = this.flowResultSqlResizeState;
                if (!state) return;
                const width = Math.max(58, Math.min(900, Math.round(state.startWidth + event.clientX - state.startX)));
                this.flowResultSqlColumnWidths[state.key] = width;
                const table = getContainerEl(`#flowResultSqlGrid-${PAGE_CODE} table.flow-result-sql-grid`);
                const col = table?.querySelector?.(`col[data-flow-result-col-index="${state.columnIndex}"]`);
                if (col) col.style.width = `${width}px`;
                const header = table?.querySelector?.(`thead th:nth-child(${state.columnIndex + 1})`);
                if (header) header.style.width = `${width}px`;
                this.syncFlowResultSqlTableWidth();
                this.applyFlowResultSqlFrozenColumns();
            },
            endFlowResultSqlColumnResize() {
                if (this.flowResultSqlResizeMoveBound) {
                    document.removeEventListener("mousemove", this.flowResultSqlResizeMoveBound);
                }
                if (this.flowResultSqlResizeUpBound) {
                    document.removeEventListener("mouseup", this.flowResultSqlResizeUpBound);
                }
                document.body.classList.remove("is-resizing-flow-result-sql");
                this.flowResultSqlResizeState = null;
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

            getNextFocusNodeAfterRemoval(removedNodeId, removedPosition) {
                const removedId = String(removedNodeId || "");
                const recentNodeId = [...(this.flowNodeSelectionHistory || [])]
                    .reverse()
                    .find((nodeId) => nodeId !== removedId && this.getFlowNode(nodeId));
                if (recentNodeId) {
                    return this.getFlowNode(recentNodeId);
                }

                const candidates = this.getFlowNodes();
                if (!candidates.length) return null;
                const removedCenterX = (removedPosition?.left || 0) + (removedPosition?.width || FLOW_NODE_DEFAULT_WIDTH) / 2;
                const removedCenterY = (removedPosition?.top || 0) + (removedPosition?.height || FLOW_NODE_DEFAULT_HEIGHT) / 2;
                return candidates
                    .map((node) => {
                        const position = this.getNodePosition(node);
                        const centerX = position.left + position.width / 2;
                        const centerY = position.top + position.height / 2;
                        return {
                            node,
                            xDistance: Math.abs(centerX - removedCenterX),
                            distance: Math.hypot(centerX - removedCenterX, centerY - removedCenterY)
                        };
                    })
                    .sort((a, b) => a.xDistance - b.xDistance || a.distance - b.distance)[0]?.node || null;
            },

            removeSelectedNode(targetNodeId = "") {
                const targetItems = Array.isArray(targetNodeId) ? targetNodeId : [targetNodeId];
                const explicitNodes = targetItems
                    .filter((item) => this.isLiveFlowNodeElement(item));
                const explicitNodeIds = Array.isArray(targetNodeId)
                    ? targetNodeId
                        .filter((item) => !this.isLiveFlowNodeElement(item))
                        .filter(Boolean)
                    : [];
                const explicitNodeId = Array.isArray(targetNodeId) || this.isLiveFlowNodeElement(targetNodeId)
                    ? ""
                    : (targetNodeId || "");
                let nodeIds = [];
                if (explicitNodes.length) {
                    nodeIds = explicitNodes
                        .map((node) => node.dataset.nodeId || "")
                        .filter(Boolean);
                } else if (explicitNodeIds.length) {
                    nodeIds = explicitNodeIds;
                } else if (explicitNodeId) {
                    nodeIds = [explicitNodeId];
                } else {
                    nodeIds = this.getActionFlowNodeIds();
                }
                const existingNodes = explicitNodes.length
                    ? explicitNodes
                    : nodeIds
                        .map((nodeId) => this.getFlowNode(nodeId))
                        .filter(Boolean);
                if (!existingNodes.length) return;
                const removedPosition = this.getNodePosition(existingNodes[0]);
                const removeSet = new Set(existingNodes.map((node) => node.dataset.nodeId || "").filter(Boolean));
                this.flowEdges = this.flowEdges.filter((edge) => !removeSet.has(edge.from) && !removeSet.has(edge.to));
                this.markFlowEdited();
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                existingNodes.forEach((node) => node.remove());
                removeSet.forEach((nodeId) => this.removeFlowNodeSelectionHistory(nodeId));
                const nextNode = this.getNextFocusNodeAfterRemoval(Array.from(removeSet)[0], removedPosition);
                this.clearFlowNodeSelection({ store: false, clearInspector: false, syncBeforeStore: false });
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
                this.flowLayoutGrid = null;
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
                this.getFlowNodes().forEach((node) => this.clearFlowNodeRuntimeVisualState(node));
            },

            clearFlowNodeRuntimeVisualState(node) {
                if (!node) return;
                node.classList.remove(
                    "is-flow-run-pending",
                    "is-flow-run-running",
                    "is-flow-run-success",
                    "is-flow-run-failed",
                    "is-flow-run-skipped"
                );
                node.querySelector(".flow-node-run-badge")?.remove();
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
                    this.getMessage("flowRunFailedAtNode", "Flow run failed at node: {nodeName}{nodeKey}", {
                        nodeName,
                        nodeKey: nodeKey ? ` (${nodeKey})` : ""
                    })
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
                        ? this.getMessage("noAprioriCategoricalFlowRun", "No categorical column was found in the M03001 predicted type results for the current FLOW_RUN_ID.")
                        : this.getMessage("noAprioriCandidateColumns", "Apriori training candidate columns could not be created.");
                    const upstreamHint = (allRows || []).some((row) => String(row.STATUS || "").toUpperCase() === "SUCCESS")
                        ? this.getMessage("noAprioriUpstreamPartial", "Some upstream nodes succeeded, but the M03001 categorical predicted type results required by M03003 are missing or empty in the current run context.")
                        : this.getMessage("noAprioriUpstreamMissing", "Upstream M03001/M03002 results are missing in the current run context.");
                    return [
                        this.getMessage("failureReasonTitle", "Reason:"),
                        runContextHint,
                        upstreamHint,
                        this.getMessage("noAprioriAction", "Action: Run M03001 with RULE or BOTH first using the same FLOW_RUN_ID, or run the full flow from Run now.")
                    ].join("\n");
                }
                if (/upstream results are missing|\uC120\uD589 \uB178\uB4DC \uC2E4\uD589 \uACB0\uACFC/i.test(text)) {
                    return [
                        this.getMessage("failureReasonTitle", "Reason:"),
                        this.getMessage("upstreamMissingReason", "To run from the selected node, successful upstream node results must already exist in the same FLOW_RUN_ID."),
                        this.getMessage("upstreamMissingAction", "Action: Run the upstream nodes first, or run the full flow from Run now.")
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
                const actionName = batch
                    ? this.getMessage("queueBatchAction", "Queue batch")
                    : this.getMessage("runNowAction", "Run now");
                const confirmMessage = [
                    `${actionName}: "${flowName}"`,
                    "",
                    this.getMessage("confirmRunFlowBody", "This will save the current flow, validate the DAG, and create a run history record."),
                    "",
                    this.getMessage("continueQuestion", "Continue?")
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
                            this.saveStoredContext({ flowId: json.data.flowId });
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
                const actionNodeIds = this.getActionFlowNodeIds();
                const nodeId = this.flowContextMenuState?.nodeId || actionNodeIds[0] || this.selectedNodeId || "";
                const node = this.getFlowNode(nodeId);
                if (!node) {
                    alert(this.getMessage("selectNodeFirst", "Select a node first."));
                    return;
                }
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert(this.getMessage("selectProjectScenarioFirst", "Select project and scenario first."));
                    return;
                }
                const nodeName = node.querySelector(".flow-node-body strong")?.textContent?.trim() || nodeId;
                const actionTitle = runDownstream
                    ? this.getMessage("runFromSelectedNodeAction", "Run from selected node")
                    : this.getMessage("runSelectedNodeAction", "Run selected node");
                const confirmMessage = [
                    `${actionTitle}: "${nodeName}"`,
                    "",
                    runDownstream
                        ? this.getMessage("confirmRunDownstreamBody", "This will save the current flow, validate the DAG, and run the selected node plus downstream nodes.")
                        : this.getMessage("confirmRunSelectedNodeBody", "This will save the current flow, validate the DAG, and run only the selected node."),
                    ...(runDownstream ? [
                        "",
                        this.getMessage("confirmRunDownstreamUpstreamHint", "If the selected node has upstream dependencies, the run will continue from a previous FLOW_RUN_ID with successful upstream node results."),
                        this.getMessage("confirmRunDownstreamNoRunHint", "If no compatible run exists, execution stops before running the node.")
                    ] : []),
                    "",
                    this.getMessage("continueQuestion", "Continue?")
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
                            this.saveStoredContext({ flowId: json.data.flowId });
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
