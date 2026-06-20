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
            flowRegisteredJobs: [],
            flowVariables: [],
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
            flowInspectorCollapsed: false,
            flowDesignerBound: false,
            flowLayoutRestoredFromDb: false,
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
            flowEdges: [
                { from: "source-customer", to: "profiling-01" },
                { from: "profiling-01", to: "correlation-01" },
                { from: "profiling-01", to: "rule-mining-01" },
                { from: "correlation-01", to: "violation-search-01" },
                { from: "rule-mining-01", to: "violation-search-01" },
                { from: "threshold-01", to: "rule-mining-01", dashed: true }
            ],

            async init() {
                if (this.isInit) return;
                this.applyUiLabels();
                await this.loadWorkContext();
                this.switchTab("designer");
                this.setupFlowDesigner();
                this.isInit = true;
            },

            destroy() {
                this.teardownFlowDesigner();
                this.contextProjects = [];
                this.contextScenarios = [];
                this.scenarioTables = [];
                this.flowList = [];
                this.flowRegisteredJobs = [];
                this.flowVariables = [];
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
                this.flowInspectorCollapsed = false;
                this.flowLayoutRestoredFromDb = false;
                this.nodeSequence = 100;
                this.isInit = false;
            },

            applyUiLabels() {
                Object.entries(FLOW_UI_LABELS).forEach(([key, value]) => {
                    const selector = `[data-label-key="${key}"]`;
                    const container = document.getElementById(`container-${PAGE_CODE}`);
                    if (!container) return;
                    container.querySelectorAll(selector).forEach((element) => {
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
                await this.loadFlowVersions(true);
                await this.loadFlowRunHistory();
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
                await this.loadFlowVersions(false);
                await this.loadFlowRunHistory();
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
                    <option value="">Select project</option>
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
                await this.loadFlowVersions(true);
                await this.loadFlowRunHistory();
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
                    <option value="">Select scenario</option>
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
                await this.loadFlowVersions(true);
                await this.loadFlowRunHistory();
                this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId));
            },

            async loadScenarioTables() {
                const container = getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`);
                if (!container) return;

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

            renderRegisteredJobs() {
                const container = getContainerEl(`#flowRegisteredJobGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.flowRegisteredJobs.length) {
                    container.innerHTML = `<div class="table-empty">No registered jobs for this scenario.</div>${this.renderListFooter(0)}`;
                    return;
                }

                container.innerHTML = `
                    <div class="data-job-list">
                        ${this.flowRegisteredJobs.map((job, index) => {
                            const nodeType = this.getNodeTypeForMenu(job.MENU_CODE);
                            const jobId = job.WORK_JOB_ID || job.PROFILE_JOB_ID || "";
                            const subtitle = `${job.MENU_CODE || "-"} / ${job.OWNER_NAME || "-"}.${job.TABLE_NAME || "-"}`;
                            return `
                                <button type="button" class="data-job-row flow-palette-job" draggable="true"
                                    data-node-type="${this.escapeHtml(nodeType)}"
                                    data-job-id="${this.escapeHtml(jobId)}"
                                    data-ref-menu-code="${this.escapeHtml(job.MENU_CODE || "")}"
                                    data-owner-name="${this.escapeHtml(job.OWNER_NAME || "")}"
                                    data-table-name="${this.escapeHtml(job.TABLE_NAME || "")}"
                                    data-ref-object-id="${this.escapeHtml(job.EXEC_OBJECT_ID || "")}">
                                    <span class="data-job-order">${String(index + 1).padStart(2, "0")}</span>
                                    <span>
                                        <strong>${this.escapeHtml(job.JOB_NAME || "(Untitled job)")}</strong>
                                        <small>${this.escapeHtml(subtitle)}</small>
                                    </span>
                                    <em><span>JOB</span><span>${this.escapeHtml(job.MENU_CODE || "")}</span></em>
                                </button>
                            `;
                        }).join("")}
                    </div>
                    ${this.renderListFooter(this.flowRegisteredJobs.length)}
                `;
            },

            getNodeTypeForMenu(menuCode) {
                const code = String(menuCode || "").toUpperCase();
                if (code === "M02003") return "PROFILING";
                if (code === "M02004") return "CORRELATION";
                if (code === "M03001") return "RULE_MINING";
                if (code === "M06001") return "VIOLATION_SEARCH";
                return "JOB";
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

            async loadFlowVersions(loadLatest = false) {
                const select = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (!select) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    this.flowList = [];
                    select.innerHTML = `<option value="">Draft</option>`;
                    this.updateFlowVersionCount();
                    this.newFlow(false);
                    return;
                }

                try {
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flows?${params.toString()}`, { method: "GET" });
                    this.flowList = Array.isArray(json.data) ? json.data : [];
                    this.renderFlowVersions();
                    if (loadLatest && this.flowList.length) {
                        await this.loadFlowVersion(this.flowList[0].FLOW_ID);
                    }
                } catch (error) {
                    this.flowList = [];
                    select.innerHTML = `<option value="">Flow list load failed</option>`;
                    this.updateFlowVersionCount();
                }
            },

            renderFlowVersions() {
                const select = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (!select) return;
                const currentFlowId = this.getValue(`#flowId-${PAGE_CODE}`);
                const countText = `${this.flowList.length.toLocaleString()} saved`;
                select.innerHTML = `
                    <option value="">Draft (${countText})</option>
                    ${this.flowList.map((flow) => `
                        <option value="${this.escapeHtml(flow.FLOW_ID ?? "")}">
                            ${this.escapeHtml(`#${flow.FLOW_ID} ${flow.FLOW_NAME || "Untitled Flow"}`)}
                        </option>
                    `).join("")}
                `;
                this.updateFlowVersionCount();
                if (this.flowList.some((flow) => String(flow.FLOW_ID) === String(currentFlowId))) {
                    select.value = currentFlowId;
                }
            },

            updateFlowVersionCount() {
                const countLabel = getContainerEl(`#flowVersionCount-${PAGE_CODE}`);
                if (countLabel) {
                    countLabel.textContent = `${this.flowList.length.toLocaleString()} items`;
                }
            },

            async loadFlowVersion(flowId) {
                if (!flowId) {
                    this.newFlow(false);
                    return;
                }
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/${encodeURIComponent(flowId)}`, { method: "GET" });
                    if (json.data) {
                        this.applyFlowData(json.data);
                    }
                } catch (error) {
                    alert(error.message || "Flow load failed.");
                }
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
                const table = this.getSelectedScenarioTable();
                const parts = [
                    project ? `Project: ${project.PROJECT_NAME || project.PROJECT_CODE || "-"}` : "Project: -",
                    scenario ? `Scenario: ${scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "-"}` : "Scenario: -",
                    table ? `Table: ${table.OWNER_NAME || "-"}.${table.TABLE_NAME || "-"}` : "Table: -"
                ];
                this.setText(`#workContextSummary-${PAGE_CODE}`, parts.join(" / "));
            },

            toggleWorkContext() {
                this.setWorkContextCollapsed(!this.workContextCollapsed);
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
                }
            },

            switchTab(tabName) {
                this.activeTab = tabName || "designer";
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
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

                viewport.querySelectorAll(".flow-node").forEach((node) => this.bindFlowNode(node));
                this.bindFlowPalette();

                const selected = viewport.querySelector(".flow-node.is-selected") || viewport.querySelector(".flow-node");
                if (selected) {
                    this.selectFlowNode(selected.dataset.nodeId || "");
                }
                this.applyFlowZoom();
                if (this.flowLayoutRestoredFromDb) {
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                } else {
                    this.autoLayoutFlow();
                }
                this.renderFlowEdgeGrid();
                this.flowDesignerBound = true;
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
                container.querySelectorAll(".flow-palette-node, .flow-palette-job, .flow-palette-io").forEach((item) => {
                    if (item.dataset.flowPaletteBound === "Y") return;
                    item.dataset.flowPaletteBound = "Y";
                    item.addEventListener("dragstart", (event) => {
                        const title = item.querySelector("strong")?.textContent?.trim() || "New node";
                        const subtitle = item.querySelector("small")?.textContent?.trim() || "";
                        this.flowPaletteDragData = {
                            nodeType: item.dataset.nodeType || "JOB",
                            jobId: item.dataset.jobId || "",
                            refMenuCode: item.dataset.refMenuCode || "",
                            ownerName: item.dataset.ownerName || "",
                            tableName: item.dataset.tableName || "",
                            refObjectId: item.dataset.refObjectId || "",
                            title,
                            subtitle
                        };
                        event.dataTransfer?.setData("text/plain", JSON.stringify(this.flowPaletteDragData));
                        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
                    });
                });
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
                            mode: this.edgeDragState.dashed ? "REFERENCE" : "SERIAL"
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
                this.startEdgeConnection(node.dataset.nodeId || "", port.textContent.trim(), node.querySelector(".flow-connector-out"), "drag", event.shiftKey);
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
                    this.addFlowEdge({
                        from: this.edgeDragState.fromNodeId,
                        fromPort: this.edgeDragState.fromPort,
                        to: toNodeId,
                        toPort: port.textContent.trim(),
                        dashed: this.edgeDragState.dashed,
                        mode: this.edgeDragState.dashed ? "REFERENCE" : "SERIAL"
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

            handleCanvasPointerDown(event) {
                if (event.button !== 0 || event.target.closest?.(".flow-node")) return;
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
                if (event.key === "Escape" && this.edgeDragState) {
                    this.finishEdgeDrag();
                    return;
                }
                if ((event.key === "Delete" || event.key === "Backspace") && this.selectedEdgeId) {
                    const activeTag = document.activeElement?.tagName?.toLowerCase();
                    if (["input", "textarea", "select"].includes(activeTag)) return;
                    event.preventDefault();
                    this.removeSelectedEdge();
                }
            },

            handleCanvasDragOver(event) {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            },

            handleCanvasDrop(event) {
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
                const node = this.createFlowNode(data, left, top);
                if (node) {
                    this.getFlowViewport()?.appendChild(node);
                    this.bindFlowNode(node);
                    this.selectFlowNode(node.dataset.nodeId || "");
                    this.resizeFlowViewportToNodes();
                    this.updateFlowEdges();
                }
                this.flowPaletteDragData = null;
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
                menu.querySelectorAll('[data-flow-menu-action="duplicateNode"], [data-flow-menu-action="deleteNode"]').forEach((button) => {
                    button.classList.toggle("is-disabled", !hasNode);
                    button.disabled = !hasNode;
                });
                this.renderDashedConnectionMode();
            },

            hideCanvasContextMenu() {
                const menu = getContainerEl(`#flowCanvasMenu-${PAGE_CODE}`);
                if (menu) menu.hidden = true;
            },

            handleContextMenuClick(event) {
                const button = event.target.closest?.("[data-flow-menu-action]");
                if (!button || button.disabled) return;
                event.preventDefault();
                event.stopPropagation();
                const action = button.dataset.flowMenuAction;
                this.runContextMenuAction(action);
                if (action !== "toggleDashedConnection") {
                    this.hideCanvasContextMenu();
                }
            },

            runContextMenuAction(action) {
                const actions = {
                    addTableInput: () => this.createContextNode("TABLE_INPUT", "Table Input", "Owner/table or temporary result table"),
                    addValueInput: () => this.createContextNode("VALUE_INPUT", "Value Input", "Scalar threshold, date, owner, or option"),
                    addArrayInput: () => this.createContextNode("ARRAY_INPUT", "Array Input", "Column list, rule list, or option array"),
                    addOutput: () => this.createContextNode("TABLE_OUTPUT", "Table Output", "Persisted result table or downstream target"),
                    duplicateNode: () => this.duplicateSelectedNode(),
                    deleteNode: () => this.removeSelectedNode(),
                    toggleDashedConnection: () => this.toggleDashedConnectionMode(),
                    autoLayout: () => this.autoLayoutFlow(),
                    treeLayout: () => this.autoLayoutFlow(),
                    fitCanvas: () => this.fitFlowCanvas(),
                    resetZoom: () => this.resetFlowZoom()
                };
                actions[action]?.();
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
                    label.textContent = `Dashed connection: ${this.dashedConnectionMode ? "ON" : "OFF"}`;
                }
            },

            createContextNode(nodeType, title, subtitle) {
                const point = this.flowContextMenuState || { left: 80, top: 80 };
                const node = this.createFlowNode({ nodeType, title, subtitle }, point.left, point.top);
                if (!node) return;
                this.getFlowViewport()?.appendChild(node);
                this.bindFlowNode(node);
                this.selectFlowNode(node.dataset.nodeId || "");
                this.resizeFlowViewportToNodes();
                this.updateFlowEdges();
            },

            createFlowNode(data, left, top) {
                const nodeType = data.nodeType || "JOB";
                const nodeId = `${String(nodeType).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${this.nodeSequence++}`;
                const outputLabel = this.getDefaultOutputPort(nodeType);
                const inputHtml = this.getDefaultInputPort(nodeType)
                    ? `<span class="flow-port flow-port-in">${this.escapeHtml(this.getDefaultInputPort(nodeType))}</span>`
                    : "";
                const article = document.createElement("article");
                article.id = `flowNode-${PAGE_CODE}-${nodeId}`;
                article.className = "data-param-card flow-node flow-node-step";
                article.dataset.nodeId = nodeId;
                article.dataset.nodeType = nodeType;
                article.dataset.refWorkJobId = data.jobId || data.refWorkJobId || "";
                article.dataset.refMenuCode = data.refMenuCode || "";
                article.dataset.ownerName = data.ownerName || "";
                article.dataset.tableName = data.tableName || "";
                article.dataset.refObjectId = data.refObjectId || "";
                article.style.position = "absolute";
                article.style.left = `${Math.max(0, Math.round(left))}px`;
                article.style.top = `${Math.max(0, Math.round(top))}px`;
                article.style.width = "170px";
                article.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong>${this.escapeHtml(nodeType)}</strong>
                        <span class="data-job-order">NEW</span>
                    </header>
                    <div class="flow-node-body">
                        <strong>${this.escapeHtml(data.title || "New node")}</strong>
                        <small>${this.escapeHtml(data.subtitle || data.jobId || "Manual node")}</small>
                    </div>
                    <footer class="flow-node-ports">
                        ${inputHtml}
                        <span class="flow-port flow-port-out">${this.escapeHtml(outputLabel)}</span>
                    </footer>
                `;
                return article;
            },

            createSavedFlowNode(data) {
                const nodeType = data.nodeType || "JOB";
                const nodeId = data.nodeKey || `${String(nodeType).toLowerCase()}-${this.nodeSequence++}`;
                const inputs = Array.isArray(data.inputs) ? data.inputs : [];
                const outputs = Array.isArray(data.outputs) ? data.outputs : [];
                const inputHtml = inputs.map((port) => `<span class="flow-port flow-port-in">${this.escapeHtml(port.port || port.name || "input")}</span>`).join("");
                const outputHtml = outputs.length
                    ? outputs.map((port) => `<span class="flow-port flow-port-out">${this.escapeHtml(port.port || port.name || "output")}</span>`).join("")
                    : `<span class="flow-port flow-port-out">${this.escapeHtml(this.getDefaultOutputPort(nodeType))}</span>`;
                const article = document.createElement("article");
                article.id = `flowNode-${PAGE_CODE}-${nodeId}`;
                article.className = "data-param-card flow-node flow-node-step";
                article.dataset.nodeId = nodeId;
                article.dataset.nodeType = nodeType;
                article.dataset.refWorkJobId = data.refWorkJobId || "";
                article.dataset.refMenuCode = data.refMenuCode || "";
                article.dataset.ownerName = data.ownerName || "";
                article.dataset.tableName = data.tableName || "";
                article.dataset.refObjectId = data.refObjectId || "";
                article.style.position = "absolute";
                article.style.left = `${Math.max(0, Math.round(Number(data.positionLeft) || 0))}px`;
                article.style.top = `${Math.max(0, Math.round(Number(data.positionTop) || 0))}px`;
                article.style.width = `${Math.max(150, Math.round(Number(data.nodeWidth) || 170))}px`;
                article.innerHTML = `
                    <header class="data-param-panel-header">
                        <strong>${this.escapeHtml(nodeType)}</strong>
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
                return article;
            },

            getDefaultInputPort(nodeType) {
                if (nodeType === "TABLE_INPUT" || nodeType === "VALUE_INPUT" || nodeType === "ARRAY_INPUT") return "";
                if (nodeType === "TABLE_OUTPUT") return "inputTable";
                return "input";
            },

            getDefaultOutputPort(nodeType) {
                if (nodeType === "VALUE_INPUT") return "value";
                if (nodeType === "ARRAY_INPUT") return "items[]";
                if (nodeType === "TABLE_INPUT") return "tableRows";
                if (nodeType === "TABLE_OUTPUT") return "targetTable";
                return "output";
            },

            duplicateSelectedNode() {
                const source = this.getFlowNode(this.flowContextMenuState?.nodeId || this.selectedNodeId);
                if (!source) return;
                const position = this.getNodePosition(source);
                const clone = source.cloneNode(true);
                const sourceNodeId = source.dataset.nodeId || "node";
                const cloneNodeId = `${sourceNodeId}-copy-${this.nodeSequence++}`;
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
                this.setValue(`#nodeOwnerName-${PAGE_CODE}`, node.dataset.ownerName || "");
                this.setValue(`#nodeTableName-${PAGE_CODE}`, node.dataset.tableName || "");
                this.setValue(`#nodeDependsOn-${PAGE_CODE}`, this.getUpstreamNodeIds(this.selectedNodeId).join(", "));
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
                }
                if (fieldName === "ownerName") {
                    node.dataset.ownerName = value || "";
                }
                if (fieldName === "tableName") {
                    node.dataset.tableName = value || "";
                }
            },

            getValue(selector) {
                return getContainerEl(selector)?.value || "";
            },

            updateFlowField() {},
            handleNodeJobChange() {},

            collectNodePorts(node, direction) {
                const selector = direction === "in" ? ".flow-port-in" : ".flow-port-out";
                const nodeId = node.dataset.nodeId || "";
                return Array.from(node.querySelectorAll(selector)).map((port) => ({
                    port: port.textContent.trim(),
                    type: this.inferPortType(port.textContent.trim(), node.dataset.nodeType || ""),
                    ownerName: node.dataset.ownerName || "",
                    tableName: node.dataset.tableName || "",
                    sourceNodeKey: direction === "in" ? this.findPortSource(nodeId, port.textContent.trim())?.from || "" : "",
                    sourcePort: direction === "in" ? this.findPortSource(nodeId, port.textContent.trim())?.fromPort || "" : "",
                    targetNodeKeys: direction === "out" ? this.findPortTargets(nodeId, port.textContent.trim()).map((edge) => edge.to) : [],
                    targetPorts: direction === "out" ? this.findPortTargets(nodeId, port.textContent.trim()).map((edge) => edge.toPort || "input") : []
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

            inferPortType(portName, nodeType) {
                const value = String(portName || "").toLowerCase();
                if (value.includes("[]") || value.includes("array") || nodeType === "ARRAY_INPUT") return "ARRAY";
                if (value.includes("table") || value.includes("rows") || nodeType === "TABLE_INPUT" || nodeType === "TABLE_OUTPUT") return "TABLE";
                if (nodeType === "VALUE_INPUT") return "VALUE";
                return "ANY";
            },

            buildFlowPayload() {
                const flowIdValue = this.getValue(`#flowId-${PAGE_CODE}`);
                const flowName = this.getFlowNameForSave();
                if (!this.getValue(`#flowName-${PAGE_CODE}`)) {
                    this.setValue(`#flowName-${PAGE_CODE}`, flowName);
                }
                const nodes = this.getFlowNodes().map((node, index) => {
                    const position = this.getNodePosition(node);
                    return {
                        nodeKey: node.dataset.nodeId || `node-${index + 1}`,
                        nodeType: node.dataset.nodeType || "JOB",
                        nodeName: node.querySelector(".flow-node-body strong")?.textContent?.trim() || node.dataset.nodeId || `Node ${index + 1}`,
                        nodeDesc: node.querySelector(".flow-node-body small")?.textContent?.trim() || "",
                        refMenuCode: node.dataset.refMenuCode || "",
                        refWorkJobId: node.dataset.refWorkJobId || null,
                        refObjectId: node.dataset.refObjectId || null,
                        ownerName: node.dataset.ownerName || "",
                        tableName: node.dataset.tableName || "",
                        positionLeft: position.left,
                        positionTop: position.top,
                        nodeWidth: position.width,
                        nodeHeight: position.height,
                        inputs: this.collectNodePorts(node, "in"),
                        outputs: this.collectNodePorts(node, "out"),
                        params: [],
                        execPlsql: this.selectedNodeId === node.dataset.nodeId ? this.getValue(`#nodeExecPlsqlEditor-${PAGE_CODE}`) : "",
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
                    executionMode: this.getValue(`#flowExecutionMode-${PAGE_CODE}`) || "DAG",
                    useYn: this.getValue(`#flowUseYn-${PAGE_CODE}`) || "Y",
                    status: "DRAFT",
                    nodes,
                    edges: this.flowEdges.map((edge, index) => ({
                        fromNodeKey: edge.from,
                        fromPort: edge.fromPort || "output",
                        toNodeKey: edge.to,
                        toPort: edge.toPort || "input",
                        edgeMode: edge.mode || (edge.dashed ? "REFERENCE" : "SERIAL"),
                        dashedYn: edge.dashed ? "Y" : "N",
                        dashed: Boolean(edge.dashed),
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
                return scenarioName ? `${scenarioName} Flow` : `${projectName || PAGE_CODE} Flow`;
            },

            applyFlowData(flow) {
                this.setValue(`#flowId-${PAGE_CODE}`, flow.FLOW_ID || "NEW");
                this.setValue(`#flowGroup-${PAGE_CODE}`, flow.FLOW_GROUP || config.defaultFlowGroup || PAGE_CODE);
                this.setValue(`#flowName-${PAGE_CODE}`, flow.FLOW_NAME || "");
                this.setValue(`#flowDesc-${PAGE_CODE}`, flow.FLOW_DESC || "");
                this.setValue(`#flowExecutionMode-${PAGE_CODE}`, flow.EXECUTION_MODE || "DAG");
                this.setValue(`#flowUseYn-${PAGE_CODE}`, flow.USE_YN || "Y");
                const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (selector) selector.value = flow.FLOW_ID || "";
                this.flowLayoutRestoredFromDb = true;
                this.renderFlowCanvasFromData(flow.NODES || [], flow.EDGES || []);
            },

            renderFlowCanvasFromData(nodes, edges) {
                const viewport = this.getFlowViewport();
                if (!viewport) return;
                viewport.querySelectorAll(".flow-node").forEach((node) => node.remove());
                this.flowEdges = (edges || []).map((edge) => ({
                    from: edge.fromNodeKey,
                    fromPort: edge.fromPort || "output",
                    to: edge.toNodeKey,
                    toPort: edge.toPort || "input",
                    dashed: Boolean(edge.dashed || edge.dashedYn === "Y"),
                    mode: edge.edgeMode || (edge.dashed || edge.dashedYn === "Y" ? "REFERENCE" : "SERIAL")
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
                    this.setValue(`#nodeId-${PAGE_CODE}`, "");
                    this.setValue(`#nodeType-${PAGE_CODE}`, "");
                    this.setValue(`#nodeName-${PAGE_CODE}`, "");
                    this.setValue(`#nodeOwnerName-${PAGE_CODE}`, "");
                    this.setValue(`#nodeTableName-${PAGE_CODE}`, "");
                    this.setValue(`#nodeDependsOn-${PAGE_CODE}`, "");
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
                const label = getContainerEl(`#selectedFlowLabel-${PAGE_CODE}`);
                if (label) {
                    const dashedHint = this.dashedConnectionMode ? " Dashed connection mode is ON." : " Hold Shift while connecting for one dashed edge.";
                    label.textContent = `Canvas zoom: ${Math.round(this.flowZoom * 100)}% / Click a right connector, move the mouse, then click a left connector to connect.${dashedHint}`;
                }
            },

            resetFlowZoom() {
                this.setFlowZoom(1);
            },

            fitFlowCanvas() {
                const stage = this.getFlowStage();
                const viewport = this.getFlowViewport();
                if (!stage || !viewport) return;
                const bounds = this.getFlowNodeBounds();
                if (!bounds) return;
                const availableWidth = Math.max(stage.clientWidth - 80, 320);
                const availableHeight = Math.max(stage.clientHeight - 80, 240);
                const zoom = Math.min(
                    this.maxFlowZoom,
                    Math.max(this.minFlowZoom, Math.min(availableWidth / bounds.width, availableHeight / bounds.height))
                );
                this.setFlowZoom(zoom);
                stage.scrollLeft = Math.max(0, (bounds.left - 40) * this.flowZoom);
                stage.scrollTop = Math.max(0, (bounds.top - 40) * this.flowZoom);
            },

            toggleCanvasMaximize() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container) return;
                const nextMaximized = !container.classList.contains("is-flow-canvas-maximized");
                container.classList.toggle("is-flow-canvas-maximized", nextMaximized);
                if (!nextMaximized) {
                    this.flowInspectorCollapsed = false;
                    container.classList.remove("is-flow-inspector-collapsed");
                }
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

            toggleFlowInspectorOverlay() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                if (!container?.classList.contains("is-flow-canvas-maximized")) return;
                this.flowInspectorCollapsed = !this.flowInspectorCollapsed;
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

            autoLayoutFlow() {
                const nodes = this.getFlowNodes();
                if (!nodes.length) return;

                const nodeIds = nodes.map((node) => node.dataset.nodeId || "").filter(Boolean);
                const nodeSet = new Set(nodeIds);
                const outgoing = new Map(nodeIds.map((nodeId) => [nodeId, []]));
                const incomingCount = new Map(nodeIds.map((nodeId) => [nodeId, 0]));

                this.flowEdges.forEach((edge) => {
                    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to) || edge.from === edge.to) return;
                    outgoing.get(edge.from)?.push(edge.to);
                    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
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
                Array.from(levelGroups.keys()).sort((a, b) => a - b).forEach((level) => {
                    const group = levelGroups.get(level).sort((a, b) => {
                        const aOut = (outgoing.get(a) || []).length;
                        const bOut = (outgoing.get(b) || []).length;
                        return bOut - aOut || a.localeCompare(b);
                    });
                    group.forEach((nodeId, rowIndex) => {
                        const node = this.getFlowNode(nodeId);
                        if (!node) return;
                        this.setNodePosition(node, startX + level * columnWidth, startY + rowIndex * rowHeight);
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
                this.flowEdges = this.flowEdges.filter((edge, index) => this.getEdgeId(edge, index) !== this.selectedEdgeId);
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
            },

            addNodePort() {},
            addFlowEdge(edge = null) {
                if (!edge) {
                    alert("Drag from an output port to an input port to connect nodes.");
                    return;
                }
                const nextEdge = {
                    from: edge.from,
                    fromPort: edge.fromPort || "output",
                    to: edge.to,
                    toPort: edge.toPort || "input",
                    dashed: Boolean(edge.dashed),
                    mode: edge.mode || (edge.dashed ? "REFERENCE" : "SERIAL")
                };
                if (!nextEdge.from || !nextEdge.to || nextEdge.from === nextEdge.to) return;
                const exists = this.flowEdges.some((item) =>
                    item.from === nextEdge.from
                    && item.to === nextEdge.to
                    && (item.fromPort || "") === nextEdge.fromPort
                    && (item.toPort || "") === nextEdge.toPort
                );
                if (exists) return;
                this.flowEdges.push(nextEdge);
                this.updateFlowEdges();
                this.renderFlowEdgeGrid();
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
                                    <td>${this.escapeHtml(edge.mode || (edge.dashed ? "REFERENCE" : "SERIAL"))}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(this.flowEdges.length)}
                `;
            },
            addFlowVariable() {},
            async buildExecutionPlan() {
                const payload = this.buildFlowPayload();
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/validate`, {
                        method: "POST",
                        body: payload
                    });
                    this.renderExecutionPlan(json.data?.plan || []);
                    this.switchTab("plan");
                    return json.data?.plan || [];
                } catch (error) {
                    this.renderError(`#flowPlanGrid-${PAGE_CODE}`, error.message || "Flow validation failed.");
                    this.switchTab("plan");
                    throw error;
                }
            },
            async loadFlowRunHistory() {
                const container = getContainerEl(`#flowRunHistoryGrid-${PAGE_CODE}`);
                if (!container) return;
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>${this.renderListFooter(0)}`;
                    return;
                }
                try {
                    const params = new URLSearchParams({
                        projectId: this.selectedProjectId,
                        scenarioId: this.selectedScenarioId
                    });
                    const flowId = this.getValue(`#flowId-${PAGE_CODE}`);
                    if (/^\d+$/.test(flowId)) params.set("flowId", flowId);
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs?${params.toString()}`, { method: "GET", showLoading: false });
                    this.renderFlowRunHistory(Array.isArray(json.data) ? json.data : []);
                } catch (error) {
                    this.renderError(`#flowRunHistoryGrid-${PAGE_CODE}`, error.message || "Run history load failed.");
                }
            },
            renderExecutionPlan(plan) {
                const container = getContainerEl(`#flowPlanGrid-${PAGE_CODE}`);
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
                if (!rows.length) {
                    container.innerHTML = `<div class="table-empty">No run history.</div>${this.renderListFooter(0)}`;
                    return;
                }
                container.innerHTML = `
                    <table class="table-grid">
                        <thead>
                            <tr>
                                <th>Run ID</th>
                                <th>Flow</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Message</th>
                                <th>Started</th>
                                <th>Finished</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row) => `
                                <tr>
                                    <td>${this.escapeHtml(row.FLOW_RUN_ID || "")}</td>
                                    <td>${this.escapeHtml(row.FLOW_NAME || "")}</td>
                                    <td>${this.escapeHtml(row.RUN_TYPE || "")}</td>
                                    <td>${this.escapeHtml(row.STATUS || "")}</td>
                                    <td>${this.escapeHtml(row.MESSAGE || "")}</td>
                                    <td>${this.escapeHtml(row.STARTED_AT || "")}</td>
                                    <td>${this.escapeHtml(row.FINISHED_AT || "")}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                    ${this.renderListFooter(rows.length)}
                `;
            },
            generateNodePlsql() {},
            removeSelectedNode() {
                const nodeId = this.flowContextMenuState?.nodeId || this.selectedNodeId;
                const node = this.getFlowNode(nodeId);
                if (!node) return;
                this.flowEdges = this.flowEdges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
                this.selectedEdgeId = "";
                this.hideSelectedEdgeDelete();
                node.remove();
                const nextNode = this.getFlowNodes()[0] || null;
                this.selectedNodeId = "";
                if (nextNode) {
                    this.selectFlowNode(nextNode.dataset.nodeId || "");
                } else {
                    this.setValue(`#nodeId-${PAGE_CODE}`, "");
                    this.setValue(`#nodeType-${PAGE_CODE}`, "");
                    this.setValue(`#nodeName-${PAGE_CODE}`, "");
                    this.setValue(`#nodeOwnerName-${PAGE_CODE}`, "");
                    this.setValue(`#nodeTableName-${PAGE_CODE}`, "");
                    this.setValue(`#nodeDependsOn-${PAGE_CODE}`, "");
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
                this.setValue(`#flowExecutionMode-${PAGE_CODE}`, "DAG");
                this.setValue(`#flowUseYn-${PAGE_CODE}`, "Y");
                const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                if (selector) selector.value = "";
                if (clearCanvas) {
                    this.renderFlowCanvasFromData([], []);
                }
                this.flowLayoutRestoredFromDb = false;
            },

            async saveFlow() {
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert("Select project and scenario first.");
                    return;
                }
                const payload = this.buildFlowPayload();
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/save`, {
                        method: "POST",
                        body: payload
                    });
                    if (json.data) {
                        this.applyFlowData(json.data);
                    }
                    this.flowList = Array.isArray(json.list) ? json.list : this.flowList;
                    this.renderFlowVersions();
                    const savedFlowId = json.data?.FLOW_ID || this.getValue(`#flowId-${PAGE_CODE}`) || "";
                    alert(`${json.message || "Flow saved."}${savedFlowId ? `\nFlow ID: ${savedFlowId}` : ""}`);
                } catch (error) {
                    alert(error.message || "Flow save failed.");
                }
            },

            async deleteFlow() {
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
                if (!confirm(`Delete ${flowName}?\nNodes, edges, and run history for this flow will also be deleted.`)) return;

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
                    }
                    await this.loadFlowRunHistory();
                    alert(json.message || "Flow deleted.");
                } catch (error) {
                    alert(error.message || "Flow delete failed.");
                }
            },

            async validateFlow() {
                try {
                    await this.buildExecutionPlan();
                    alert("Flow validation succeeded.");
                } catch (error) {
                    alert(error.message || "Flow validation failed.");
                }
            },

            async runFlow(batch = false) {
                if (!this.selectedProjectId || !this.selectedScenarioId) {
                    alert("Select project and scenario first.");
                    return;
                }
                const payload = {
                    ...this.buildFlowPayload(),
                    batch: Boolean(batch)
                };
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/flow/run`, {
                        method: "POST",
                        body: payload
                    });
                    if (json.data?.flowId) {
                        this.setValue(`#flowId-${PAGE_CODE}`, json.data.flowId);
                        await this.loadFlowVersions(false);
                        const selector = getContainerEl(`#flowVersion-${PAGE_CODE}`);
                        if (selector) selector.value = json.data.flowId;
                    }
                    this.renderExecutionPlan(json.data?.plan || []);
                    await this.loadFlowRunHistory();
                    this.switchTab("history");
                    alert(json.message || "Flow run recorded.");
                } catch (error) {
                    alert(error.message || "Flow run failed.");
                }
            }
        };

        window[PAGE_CODE] = page;
        return page;
    };
})();
