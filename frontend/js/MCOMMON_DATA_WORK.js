(function() {
    const MCOMMON = {
        createPageHelper(pageCode) {
            const { getContainerEl } = PageManager.createHelper(pageCode);

            return {
                getLimit(selector, defaultValue = 100, min = 1, max = 1000) {
                    const value = Number(getContainerEl(selector)?.value || defaultValue);
                    return Math.min(Math.max(Number.isFinite(value) ? value : defaultValue, min), max);
                },

                parseOptionalNumber(value) {
                    const text = String(value ?? "").trim();
                    if (!text) return null;
                    const number = Number(text);
                    return Number.isFinite(number) ? number : null;
                },

                quoteName(name) {
                    return `"${String(name || "").replace(/"/g, "\"\"")}"`;
                },

                setText(selector, value) {
                    const element = getContainerEl(selector);
                    if (element) element.textContent = value ?? "";
                },

                setFieldValue(selector, value) {
                    const element = getContainerEl(selector);
                    if (element) element.value = value ?? "";
                },

                setEditorValue(selector, value) {
                    const element = getContainerEl(selector);
                    if (element) element.value = value ?? "";
                },

                setValue(selector, value) {
                    const element = getContainerEl(selector);
                    if (element) element.value = value ?? "";
                },

                renderError(selector, message) {
                    const container = getContainerEl(selector);
                    if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(message || "Request failed.")}</div>`;
                },

                escapeHtml(value) {
                    return String(value ?? "")
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&#039;");
                },

                escapeAttr(value) {
                    return this.escapeHtml(value).replace(/\\/g, "\\\\");
                },

                escapeJs(value) {
                    return String(value ?? "")
                        .replace(/\\/g, "\\\\")
                        .replace(/'/g, "\\'")
                        .replace(/\r?\n/g, "\\n");
                },

                renderListFooter(count) {
                    return `<div class="list-count-footer">${Number(count || 0).toLocaleString()} items</div>`;
                }
            };
        },

        createDataWorkPage(config) {
            const PAGE_CODE = config.pageCode;
            const DEFAULT_WORK_UI_LABELS = config.defaultLabels || {};
            const WORK_UI_LABELS = {
                ...DEFAULT_WORK_UI_LABELS,
                ...(config.labels || {}),
                ...(window[`${PAGE_CODE}_WORK_UI_LABELS`] || {})
            };
            const MENU_NAME = WORK_UI_LABELS.menuName || PAGE_CODE;
            const DEFAULT_JOB_GROUP = config.defaultJobGroup || PAGE_CODE;
            const CONTEXT_STORAGE_KEY = config.contextStorageKey || "DATA_EDITING_WORK_CONTEXT";
            const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
            const COMMON = this.createPageHelper(PAGE_CODE);

            const page = {
        
        ...COMMON,
        isInit: false,
        contextProjects: [],
        contextScenarios: [],
        scenarioTables: [],
        executableObjects: [],
        jobs: [],
        runHistory: [],
        parameters: [],
        selectedProjectId: "",
        selectedScenarioId: "",
        selectedScenarioTableKey: "",
        selectedJobId: "",
        workContextCollapsed: false,
        activeTab: "work",
        currentJob: null,
        sqlKeydownBound: null,
        resultSqlKeydownBound: null,
        userSqlInputBound: null,
        userSqlDirty: false,
        systemUserSqlValue: "",
        sqlTransactionId: "",
        gridData: {},
        contextLoadFailed: false,
        runtimeBindDialog: null,
        runtimeBindValues: {},

        async init() {
            if (this.isInit) return;
            this.currentJob = this.createEmptyJob();
            this.applyUiLabels();
            this.renderSqlTransactionState();
            this.sqlKeydownBound = (event) => this.handleSqlEditorKeydown(event, `#sqlEditor-${PAGE_CODE}`, `#sqlGrid-${PAGE_CODE}`, "sql");
            this.resultSqlKeydownBound = (event) => this.handleSqlEditorKeydown(event, `#resultSqlEditor-${PAGE_CODE}`, `#resultGrid-${PAGE_CODE}`, "result");
            this.userSqlInputBound = () => this.handleUserSqlInput();
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.addEventListener("keydown", this.sqlKeydownBound);
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.addEventListener("input", this.userSqlInputBound);
            getContainerEl(`#resultSqlEditor-${PAGE_CODE}`)?.addEventListener("keydown", this.resultSqlKeydownBound);
            await this.loadExecutableObjects();
            await this.loadWorkContext();
            this.switchTab("work");
            this.renderCurrentJob();
            this.isInit = true;
        },

        destroy() {
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.removeEventListener("keydown", this.sqlKeydownBound);
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.removeEventListener("input", this.userSqlInputBound);
            getContainerEl(`#resultSqlEditor-${PAGE_CODE}`)?.removeEventListener("keydown", this.resultSqlKeydownBound);
            this.contextProjects = [];
            this.contextScenarios = [];
            this.scenarioTables = [];
            this.executableObjects = [];
            this.jobs = [];
            this.runHistory = [];
            this.parameters = [];
            this.selectedProjectId = "";
            this.selectedScenarioId = "";
            this.selectedScenarioTableKey = "";
            this.selectedJobId = "";
            this.workContextCollapsed = false;
            this.activeTab = "work";
            this.currentJob = null;
            this.sqlKeydownBound = null;
            this.resultSqlKeydownBound = null;
            this.userSqlInputBound = null;
            this.userSqlDirty = false;
            this.systemUserSqlValue = "";
            this.sqlTransactionId = "";
            this.contextLoadFailed = false;
            this.runtimeBindDialog = null;
            this.runtimeBindValues = {};
            this.isInit = false;
        },

        createEmptyJob() {
            return {
                profileJobId: "",
                projectId: "",
                scenarioId: "",
                scenarioTableId: "",
                jobGroup: DEFAULT_JOB_GROUP,
                jobName: "",
                jobDesc: "",
                ownerName: "",
                tableName: "",
                execObjectId: "",
                execOwner: "",
                execObjectType: "",
                execObjectName: "",
                execObjectLabel: "",
                useYn: "Y",
                sortOrder: "",
                execPlsql: "",
                resultCreateYn: "N",
                resultOwner: "",
                resultTableName: "",
                status: "DRAFT"
            };
        },

        getNextJobNo() {
            const sortNumbers = (this.jobs || [])
                .map((job) => Number(job.SORT_ORDER))
                .filter((value) => Number.isFinite(value));
            return Math.max(this.jobs.length, ...sortNumbers, 0) + 1;
        },

        formatJobNo(jobNo) {
            return String(Number(jobNo) || 1).padStart(2, "0");
        },

        createDefaultJobName(jobNo = this.getNextJobNo()) {
            return `${PAGE_CODE}_JOB${this.formatJobNo(jobNo)}`;
        },

        createDefaultJobDesc(jobNo = this.getNextJobNo()) {
            return `${MENU_NAME} ${this.formatJobNo(jobNo)}`;
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
            await this.loadJobs();
            if (!this.currentJob?.profileJobId && this.selectedScenarioTableKey) {
                this.newJob();
            }
            await this.loadRunHistory();
            this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId && this.selectedScenarioTableKey));
        },

        async refreshWorkContext() {
            const currentProjectId = this.selectedProjectId;
            const currentScenarioId = this.selectedScenarioId;
            await this.loadContextProjects(currentProjectId);
            if (this.contextLoadFailed) return;
            if (this.selectedProjectId) {
                await this.loadContextScenarios(currentScenarioId);
            }
            if (this.contextLoadFailed) return;
            await this.loadScenarioTables();
            await this.loadJobs();
            if (!this.currentJob?.profileJobId && this.selectedScenarioTableKey) {
                this.newJob();
            }
            await this.loadRunHistory();
            this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId && this.selectedScenarioTableKey));
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
                console.error("[${PAGE_CODE}] project context load failed", error);
                select.innerHTML = `<option value="">Project load failed</option>`;
                this.renderError(`#scenarioTablesGrid-${PAGE_CODE}`, message);
                this.renderError(`#workJobGrid-${PAGE_CODE}`, message);
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
            this.currentJob = this.createEmptyJob();
            this.parameters = [];
            this.saveStoredContext();
            await this.loadContextScenarios("");
            await this.loadScenarioTables();
            await this.loadJobs();
            if (this.selectedScenarioTableKey) {
                this.newJob();
            }
            await this.loadRunHistory();
            this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId && this.selectedScenarioTableKey));
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
                console.error("[${PAGE_CODE}] scenario context load failed", error);
                if (select) select.innerHTML = `<option value="">Scenario load failed</option>`;
                this.renderError(`#scenarioTablesGrid-${PAGE_CODE}`, message);
                this.renderError(`#workJobGrid-${PAGE_CODE}`, message);
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
            this.currentJob = this.createEmptyJob();
            this.parameters = [];
            this.saveStoredContext();
            await this.loadScenarioTables();
            await this.loadJobs();
            if (this.selectedScenarioTableKey) {
                this.newJob();
            }
            await this.loadRunHistory();
            this.setWorkContextCollapsed(Boolean(this.selectedProjectId && this.selectedScenarioId && this.selectedScenarioTableKey));
        },

        ensureWorkContextSelected() {
            if (!this.selectedProjectId) {
                alert("Project is required.");
                getContainerEl(`#contextProject-${PAGE_CODE}`)?.focus();
                return false;
            }
            if (!this.selectedScenarioId) {
                alert("Scenario is required.");
                getContainerEl(`#contextScenario-${PAGE_CODE}`)?.focus();
                return false;
            }
            return true;
        },

        async loadScenarioTables() {
            const container = getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`);
            if (!container) return;

            const preferredTableKey = this.selectedScenarioTableKey || "";
            this.selectedScenarioTableKey = "";
            if (!this.selectedProjectId || !this.selectedScenarioId) {
                this.scenarioTables = [];
                container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>${this.renderListFooter(0)}`;
                this.updateWorkContextSummary();
                return;
            }

            container.innerHTML = `<div class="table-empty">Loading scenario tables...</div>`;
            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-tables?${params.toString()}`, { method: "GET", showLoading: false });
                this.scenarioTables = Array.isArray(json.data) ? json.data : [];
                const preferredExists = this.scenarioTables.some((row) => this.getScenarioTableKey(row) === preferredTableKey);
                this.selectedScenarioTableKey = preferredExists
                    ? preferredTableKey
                    : (this.scenarioTables[0] ? this.getScenarioTableKey(this.scenarioTables[0]) : "");
                this.renderScenarioTables();
                if (this.selectedScenarioTableKey && !this.currentJob?.profileJobId) {
                    this.applySelectedScenarioTableToCurrentJob();
                    this.setDefaultUserSql(false);
                    this.renderCurrentJob();
                }
                this.updateWorkContextSummary();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Scenario table load failed.")}</div>`;
            }
        },

        renderScenarioTables() {
            const container = getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`);
            if (!container) return;

            if (!this.scenarioTables.length) {
                container.innerHTML = `<div class="table-empty">No tables registered to this scenario.</div>${this.renderListFooter(0)}`;
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
                ${this.renderListFooter(this.scenarioTables.length)}
            `;
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
            return row?.SCENARIO_TABLE_ID ? `ID:${row.SCENARIO_TABLE_ID}` : `${row?.OWNER_NAME || ""}.${row?.TABLE_NAME || ""}`;
        },

        selectScenarioTable(key) {
            this.selectedScenarioTableKey = key || "";
            getContainerEl(`#scenarioTablesGrid-${PAGE_CODE}`)?.querySelectorAll(".scenario-table-row").forEach((row) => {
                row.classList.toggle("is-selected", row.dataset.scenarioTableKey === this.selectedScenarioTableKey);
            });

            this.applySelectedScenarioTableToCurrentJob();
            this.setDefaultUserSql(false);
            this.renderCurrentJob();
            this.updateWorkContextSummary();
        },

        applySelectedScenarioTableToCurrentJob() {
            const row = this.getSelectedScenarioTable();
            if (!row) return;
            const jobNo = this.currentJob?.sortOrder || this.getNextJobNo();
            this.currentJob = {
                ...this.currentJob,
                projectId: this.selectedProjectId,
                scenarioId: this.selectedScenarioId,
                scenarioTableId: row.SCENARIO_TABLE_ID || "",
                ownerName: row.OWNER_NAME || "",
                tableName: row.TABLE_NAME || "",
                sortOrder: this.currentJob?.sortOrder || jobNo,
                jobGroup: DEFAULT_JOB_GROUP,
                jobName: this.currentJob?.jobName || this.createDefaultJobName(jobNo),
                jobDesc: this.currentJob?.jobDesc || this.createDefaultJobDesc(jobNo)
            };
        },

        getSelectedScenarioTable() {
            return this.scenarioTables.find((row) => this.getScenarioTableKey(row) === this.selectedScenarioTableKey) || null;
        },

        async loadExecutableObjects() {
            const select = getContainerEl(`#execObject-${PAGE_CODE}`);
            if (select) select.innerHTML = `<option value="">Loading registered objects...</option>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/executable-objects`, { method: "GET", showLoading: false });
                this.executableObjects = Array.isArray(json.data) ? json.data : [];
                this.renderExecutableObjects();
            } catch (error) {
                const message = error.message || "Executable object load failed.";
                console.error("[${PAGE_CODE}] executable object load failed", error);
                if (select) select.innerHTML = `<option value="">Object load failed</option>`;
                this.renderError(`#parameterGrid-${PAGE_CODE}`, message);
                this.renderSqlMessage("sql", message, "error");
            }
        },

        renderExecutableObjects() {
            const select = getContainerEl(`#execObject-${PAGE_CODE}`);
            if (!select) return;

            select.innerHTML = `
                <option value="">Select registered object</option>
                ${this.executableObjects.map((object) => `
                    <option value="${this.escapeHtml(object.OBJECT_ID ?? "")}">
                        ${this.escapeHtml(object.OBJECT_LABEL || object.OBJECT_NAME || "(Unnamed object)")}
                    </option>
                `).join("")}
            `;
            select.value = this.currentJob?.execObjectId || "";
        },

        async handleExecutableObjectChange(objectId) {
            const object = this.executableObjects.find((row) => String(row.OBJECT_ID) === String(objectId));
            if (!object) {
                this.currentJob = {
                    ...this.currentJob,
                    execObjectId: "",
                    execOwner: "",
                    execObjectType: "",
                    execObjectName: "",
                    execObjectLabel: ""
                };
                this.parameters = [];
                this.renderCurrentJob();
                this.renderParameters();
                return;
            }

            this.currentJob = {
                ...this.currentJob,
                execObjectId: object.OBJECT_ID,
                execOwner: object.OWNER,
                execObjectType: object.OBJECT_TYPE,
                execObjectName: object.OBJECT_NAME,
                execObjectLabel: object.OBJECT_LABEL || object.OBJECT_NAME
            };
            this.parameters = [];
            this.renderParameters();
            await this.loadParameters(object.OBJECT_ID);
            this.renderCurrentJob();
        },

        async loadParameters(objectId) {
            const container = getContainerEl(`#parameterGrid-${PAGE_CODE}`);
            if (container) container.innerHTML = `<div class="table-empty">Loading parameters...</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/executable-object/${objectId}/parameters`, { method: "GET", showLoading: false });
                this.parameters = (Array.isArray(json.data) ? json.data : []).map((row) => ({
                    itemName: row.ITEM_NAME || "",
                    itemValue: row.ITEM_VALUE || "",
                    itemDesc: row.ITEM_DESC || "",
                    itemDefault: row.ITEM_DEFAULT || "",
                    itemOrder: row.ITEM_ORDER ?? ""
                }));
                this.renderParameters();
            } catch (error) {
                this.parameters = [];
                if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Parameter load failed.")}</div>`;
            }
        },

        renderParameters() {
            const container = getContainerEl(`#parameterGrid-${PAGE_CODE}`);
            if (!container) return;

            if (!this.parameters.length) {
                container.innerHTML = `<div class="table-empty">No registered parameters. Check M90001 object detail registration.</div>${this.renderListFooter(0)}`;
                return;
            }

            container.innerHTML = `
                <table class="table-grid data-param-table">
                    <thead>
                        <tr>
                            <th class="grid-row-no">No</th>
                            <th>Parameter</th>
                            <th>Type</th>
                            <th>Comment</th>
                            <th>Default</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.parameters.map((row, index) => `
                            <tr>
                                <td class="grid-row-no">${index + 1}</td>
                                <td title="${this.escapeHtml(row.itemName)}">${this.escapeHtml(row.itemName)}</td>
                                <td title="${this.escapeHtml(row.itemValue)}">${this.escapeHtml(row.itemValue)}</td>
                                <td title="${this.escapeHtml(row.itemDesc)}">${this.escapeHtml(row.itemDesc || "-")}</td>
                                <td title="${this.escapeHtml(row.itemDefault)}">${this.escapeHtml(row.itemDefault || "-")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                ${this.renderListFooter(this.parameters.length)}
            `;
        },

        updateParameter(index, value) {
            if (!this.parameters[index]) return;
            this.parameters[index].itemDefault = value;
        },

        async loadJobs(showLoading = false) {
            const container = getContainerEl(`#workJobGrid-${PAGE_CODE}`);
            if (!container) return;

            if (!this.selectedProjectId || !this.selectedScenarioId) {
                this.jobs = [];
                container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>${this.renderListFooter(0)}`;
                return;
            }

            container.innerHTML = `<div class="table-empty">Loading jobs...</div>`;
            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/jobs?${params.toString()}`, {
                    method: "GET",
                    showLoading
                });
                this.jobs = Array.isArray(json.data) ? json.data : [];
                this.renderJobs();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Job load failed.")}</div>`;
            }
        },

        renderJobs() {
            const container = getContainerEl(`#workJobGrid-${PAGE_CODE}`);
            if (!container) return;

            if (!this.jobs.length) {
                container.innerHTML = `<div class="table-empty">No saved jobs.</div>${this.renderListFooter(0)}`;
                return;
            }

            container.innerHTML = `
                <div class="data-job-list">
                    ${this.jobs.map((job) => this.createJobRow(job)).join("")}
                </div>
                ${this.renderListFooter(this.jobs.length)}
            `;
        },

        createJobRow(job) {
            const jobId = String(job.PROFILE_JOB_ID || "");
            const selectedClass = jobId === String(this.selectedJobId) ? "is-selected" : "";
            const disabledClass = job.USE_YN === "N" ? "is-disabled" : "";
            const progressClass = job._RUN_PROGRESS ? "is-running" : "";
            const sortNo = job.SORT_ORDER ?? "-";
            const status = job._RUN_STATUS || job.STATUS || "DRAFT";
            const progressBar = job._RUN_PROGRESS
                ? `<span class="data-job-progress" aria-label="Running"></span>`
                : "";
            return `
                <button type="button" class="data-job-row ${selectedClass} ${disabledClass} ${progressClass}" onclick="${PAGE_CODE}.selectJob('${this.escapeJs(jobId)}')">
                    <b class="data-job-order">${this.escapeHtml(sortNo)}</b>
                    <span>
                        <small>${this.escapeHtml(job.JOB_GROUP || DEFAULT_JOB_GROUP)}</small>
                        <strong>${this.escapeHtml(job.JOB_NAME || "(Untitled job)")}</strong>
                        <small title="${this.escapeHtml(job.JOB_DESC || "")}">${this.escapeHtml(job.JOB_DESC || `${job.OWNER_NAME || "-"}.${job.TABLE_NAME || "-"}`)}</small>
                        ${progressBar}
                    </span>
                    <em>
                        <span>${this.escapeHtml(job.USE_YN || "Y")}</span>
                        <span>${this.escapeHtml(status)}</span>
                    </em>
                </button>
            `;
        },

        async selectJob(jobId, showLoading = true) {
            if (!jobId) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/${jobId}`, {
                    method: "GET",
                    showLoading
                });
                this.applyJob(json.data || {});
            } catch (error) {
                alert(error.message || "Job load failed.");
            }
        },

        applyJob(job) {
            this.selectedJobId = String(job.PROFILE_JOB_ID || "");
            this.currentJob = {
                profileJobId: job.PROFILE_JOB_ID || "",
                projectId: job.PROJECT_ID || this.selectedProjectId,
                scenarioId: job.SCENARIO_ID || this.selectedScenarioId,
                scenarioTableId: job.SCENARIO_TABLE_ID || "",
                jobGroup: job.JOB_GROUP || DEFAULT_JOB_GROUP,
                jobName: job.JOB_NAME || "",
                jobDesc: job.JOB_DESC || "",
                ownerName: job.OWNER_NAME || "",
                tableName: job.TABLE_NAME || "",
                execObjectId: job.EXEC_OBJECT_ID || "",
                execOwner: job.EXEC_OWNER || "",
                execObjectType: job.EXEC_OBJECT_TYPE || "",
                execObjectName: job.EXEC_OBJECT_NAME || "",
                execObjectLabel: job.EXEC_OBJECT_LABEL || "",
                useYn: job.USE_YN || "Y",
                sortOrder: job.SORT_ORDER ?? "",
                execPlsql: job.EXEC_PLSQL || "",
                resultCreateYn: job.RESULT_CREATE_YN || "N",
                resultOwner: job.RESULT_OWNER || "",
                resultTableName: job.RESULT_TABLE_NAME || "",
                status: job.STATUS || "DRAFT"
            };
            this.parameters = Array.isArray(job.PARAMS) ? job.PARAMS.map((row) => ({
                itemName: row.itemName || row.ITEM_NAME || "",
                itemValue: row.itemValue || row.ITEM_VALUE || "",
                itemDesc: row.itemDesc || row.ITEM_DESC || "",
                itemDefault: row.itemDefault || row.ITEM_DEFAULT || "",
                itemOrder: row.itemOrder || row.ITEM_ORDER || ""
            })) : [];
            this.selectedScenarioTableKey = job.SCENARIO_TABLE_ID ? `ID:${job.SCENARIO_TABLE_ID}` : "";
            this.renderScenarioTables();
            this.renderJobs();
            this.renderCurrentJob();
            this.updateWorkContextSummary();
            this.renderParameters();
            this.setEditorValue(`#execPlsqlEditor-${PAGE_CODE}`, job.EXEC_PLSQL || "");
            this.setEditorValue(`#resultSqlEditor-${PAGE_CODE}`, this.createResultSql(job.RESULT_TABLE_NAME || "", job.RESULT_OWNER || ""));
            this.setFieldValue(`#resultQueryTable-${PAGE_CODE}`, job.RESULT_TABLE_NAME || "");
            this.setDefaultUserSql(false);
        },

        newJob() {
            this.selectedJobId = "";
            const selectedTable = this.getSelectedScenarioTable();
            this.currentJob = this.createEmptyJob();
            this.parameters = [];
            if (selectedTable) {
                const jobNo = this.getNextJobNo();
                this.currentJob = {
                    ...this.currentJob,
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId,
                    scenarioTableId: selectedTable.SCENARIO_TABLE_ID || "",
                    ownerName: selectedTable.OWNER_NAME || "",
                    tableName: selectedTable.TABLE_NAME || "",
                    sortOrder: jobNo,
                    jobGroup: DEFAULT_JOB_GROUP,
                    jobName: this.createDefaultJobName(jobNo),
                    jobDesc: this.createDefaultJobDesc(jobNo)
                };
            }
            this.renderJobs();
            this.renderCurrentJob();
            this.renderParameters();
            this.setEditorValue(`#execPlsqlEditor-${PAGE_CODE}`, "");
            this.setDefaultUserSql(true);
            this.setEditorValue(`#resultSqlEditor-${PAGE_CODE}`, "");
        },

        updateCurrentJobField(field, value) {
            if (!this.currentJob) this.currentJob = this.createEmptyJob();
            this.currentJob[field] = value;
        },

        handleResultCreateChange(value) {
            this.updateCurrentJobField("resultCreateYn", value === "Y" ? "Y" : "N");
            this.syncResultFields();
        },

        syncResultFields() {
            const createYn = getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || this.currentJob?.resultCreateYn || "N";
            const disabled = createYn !== "Y";
            [`#resultOwner-${PAGE_CODE}`, `#resultTable-${PAGE_CODE}`].forEach((selector) => {
                const field = getContainerEl(selector);
                if (field) field.disabled = disabled;
            });
        },

        renderCurrentJob() {
            const job = this.currentJob || this.createEmptyJob();
            const titleSuffix = job.profileJobId
                ? (job.jobName || "(Untitled job)")
                : "New Job";
            this.setText(`#work-title-${PAGE_CODE}`, `${this.getLabel("workTitle")} - ${titleSuffix}`);
            this.syncRunButtons();
            this.setFieldValue(`#workJobId-${PAGE_CODE}`, job.profileJobId || "NEW");
            this.setFieldValue(`#workJobGroup-${PAGE_CODE}`, DEFAULT_JOB_GROUP);
            this.setFieldValue(`#workJobName-${PAGE_CODE}`, job.jobName || "");
            this.setFieldValue(`#workJobDesc-${PAGE_CODE}`, job.jobDesc || "");
            this.setFieldValue(`#targetOwner-${PAGE_CODE}`, job.ownerName || "");
            this.setFieldValue(`#targetTable-${PAGE_CODE}`, job.tableName || "");
            this.setFieldValue(`#jobUseYn-${PAGE_CODE}`, job.useYn || "Y");
            this.setFieldValue(`#jobSortOrder-${PAGE_CODE}`, job.sortOrder ?? "");
            this.setFieldValue(`#execObject-${PAGE_CODE}`, job.execObjectId || "");
            this.setFieldValue(`#resultCreateYn-${PAGE_CODE}`, job.resultCreateYn || "N");
            this.setFieldValue(`#resultOwner-${PAGE_CODE}`, job.resultOwner || "");
            this.setFieldValue(`#resultTable-${PAGE_CODE}`, job.resultTableName || "");
            this.setFieldValue(`#resultQueryTable-${PAGE_CODE}`, job.resultTableName || "");
            this.setText(`#selectedExecObjectLabel-${PAGE_CODE}`, job.execObjectLabel || job.execObjectName || this.getLabel("noExecutableObject"));
            this.syncResultFields();
            const desc = job.ownerName && job.tableName
                ? `${job.ownerName}.${job.tableName}`
                : this.getLabel("workDescriptionEmpty");
            this.setText(`#workDescription-${PAGE_CODE}`, desc);
        },

        syncRunButtons() {
            const enabled = Boolean(this.currentJob?.profileJobId);
            [`#runNow-${PAGE_CODE}`, `#queueBatch-${PAGE_CODE}`].forEach((selector) => {
                const button = getContainerEl(selector);
                if (button) button.disabled = !enabled;
            });
        },

        applyUiLabels() {
            const container = document.getElementById(`container-${PAGE_CODE}`);
            if (!container) return;

            container.querySelectorAll("[data-label-key]").forEach((element) => {
                const label = this.getLabel(element.dataset.labelKey);
                if (label) element.textContent = label;
            });

            container.querySelectorAll("[data-title-key]").forEach((element) => {
                const label = this.getLabel(element.dataset.titleKey);
                if (label) element.setAttribute("title", label);
            });

            container.querySelectorAll("[data-placeholder-key]").forEach((element) => {
                const label = this.getLabel(element.dataset.placeholderKey);
                if (label) element.setAttribute("placeholder", label);
            });
        },

        getLabel(key) {
            return WORK_UI_LABELS[key] || "";
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
                const label = toggle.querySelector("span");
                if (icon) icon.className = this.workContextCollapsed ? "fas fa-chevron-down" : "fas fa-chevron-up";
                if (label) label.textContent = this.workContextCollapsed ? this.getLabel("changeContext") : this.getLabel("hideContext");
            }
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
            this.setText(`#workContextSummary-${PAGE_CODE}`, parts.join(" | "));
        },

        async saveJob(showAlert = true) {
            if (showAlert && !(await CommonMessage.confirm("Save this work?"))) return null;
            const saved = await this.saveJobInternal(showAlert);
            return saved;
        },

        async saveJobInternal(showAlert = false) {
            if (!this.ensureJobReady(false)) return null;
            const payload = this.getJobPayload("DRAFT", "");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/save`, {
                    method: "POST",
                    body: payload
                });
                this.jobs = Array.isArray(json.list) ? json.list : this.jobs;
                this.applyJob(json.data || {});
                if (showAlert) alert("Work saved.");
                return json.data || null;
            } catch (error) {
                alert(error.message || "Work save failed.");
                return null;
            }
        },

        async runJob(batch = false) {
            if (!this.currentJob?.profileJobId) {
                alert("Save work first, then run the saved work.");
                return;
            }
            const message = batch
                ? "Queue this work for batch execution?"
                : "Run this work now?";
            if (!(await CommonMessage.confirm(message))) return;
            const runtimeBindValues = await this.collectRuntimeBindValues();
            if (runtimeBindValues === null) return;
            const payload = {
                profileJobId: Number(this.currentJob.profileJobId),
                batch: Boolean(batch),
                runtimeBindValues
            };

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/run`, {
                    method: "POST",
                    body: payload
                });
                alert(json.message || "Job submitted.");
                await this.loadJobs(false);
                await this.loadRunHistory(false);
                if (json.profileJobId) {
                    await this.selectJob(String(json.profileJobId), false);
                }
            } catch (error) {
                alert(error.message || "Job run failed.");
            }
        },

        async runAllQueueJobs() {
            return this.runAllJobs(true);
        },

        async runAllJobs(batch = false) {
            if (!this.ensureWorkContextSelected()) return;
            const runnableJobs = (this.jobs || []).filter((job) => job.USE_YN !== "N" && job.PROFILE_JOB_ID);
            if (!runnableJobs.length) {
                alert("No enabled saved jobs to execute.");
                return;
            }
            const message = batch
                ? "Queue all enabled jobs for batch execution?"
                : "Execute all enabled jobs now in sort order?";
            if (!(await CommonMessage.confirm(message))) return;

            const summaries = [];
            let failedCount = 0;
            this.jobs = this.jobs.map((job) => (
                job.USE_YN !== "N" && job.PROFILE_JOB_ID
                    ? { ...job, _RUN_STATUS: "WAITING", _RUN_PROGRESS: false }
                    : job
            ));
            this.renderJobs();

            for (const job of runnableJobs) {
                const jobId = String(job.PROFILE_JOB_ID);
                this.setJobRunState(jobId, batch ? "QUEUING" : "RUNNING", true);
                try {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/run`, {
                        method: "POST",
                        body: {
                            profileJobId: Number(job.PROFILE_JOB_ID),
                            batch: Boolean(batch)
                        }
                    });
                    const status = batch ? "QUEUED" : "SUCCESS";
                    this.setJobRunState(jobId, status, false);
                    summaries.push({
                        profileJobId: job.PROFILE_JOB_ID,
                        jobName: job.JOB_NAME,
                        status,
                        message: json.message || ""
                    });
                } catch (error) {
                    failedCount += 1;
                    this.setJobRunState(jobId, "FAILED", false);
                    summaries.push({
                        profileJobId: job.PROFILE_JOB_ID,
                        jobName: job.JOB_NAME,
                        status: "FAILED",
                        message: error.message || ""
                    });
                }
                await this.loadRunHistory();
            }

            const actionText = batch ? "queued" : "executed";
            alert(`${summaries.length} jobs ${actionText}. ${failedCount} failed.`);
            await this.loadJobs();
            await this.loadRunHistory();
            if (this.activeTab === "history") {
                this.renderRunHistory();
            }
        },

        setJobRunState(jobId, status, progress) {
            this.jobs = (this.jobs || []).map((job) => (
                String(job.PROFILE_JOB_ID || "") === String(jobId)
                    ? { ...job, _RUN_STATUS: status, _RUN_PROGRESS: Boolean(progress) }
                    : job
            ));
            this.renderJobs();
        },

        async loadRunHistory(showLoading = false) {
            const container = getContainerEl(`#runHistoryGrid-${PAGE_CODE}`);
            if (!container) return;

            if (!this.selectedProjectId || !this.selectedScenarioId) {
                this.runHistory = [];
                container.innerHTML = `<div class="table-empty">Select project and scenario first.</div>${this.renderListFooter(0)}`;
                return;
            }

            container.innerHTML = `<div class="table-empty">Loading run history...</div>`;
            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs?${params.toString()}`, {
                    method: "GET",
                    showLoading
                });
                this.runHistory = Array.isArray(json.data) ? json.data : [];
                this.renderRunHistory();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Run history load failed.")}</div>`;
            }
        },

        renderRunHistory() {
            const rows = (this.runHistory || []).map((row) => ({
                ...row,
                ELAPSED_TIME: this.formatElapsedTime(row.STARTED_AT, row.FINISHED_AT)
            }));
            const columns = this.createRunHistoryColumns(rows);
            this.renderGrid(`#runHistoryGrid-${PAGE_CODE}`, rows, columns);
        },

        createRunHistoryColumns(rows) {
            const baseColumns = Object.keys(rows?.[0] || {});
            if (!baseColumns.length) return [];
            const columns = baseColumns.filter((column) => column !== "ELAPSED_TIME");
            const finishedAtIndex = columns.indexOf("FINISHED_AT");
            if (finishedAtIndex >= 0) {
                columns.splice(finishedAtIndex + 1, 0, "ELAPSED_TIME");
            } else {
                columns.push("ELAPSED_TIME");
            }
            return columns;
        },

        formatElapsedTime(startedAt, finishedAt) {
            if (!startedAt) return "";
            if (!finishedAt) return "Running";
            const start = this.parseDateTime(startedAt);
            const finish = this.parseDateTime(finishedAt);
            if (!start || !finish || finish < start) return "";

            let totalSeconds = Math.floor((finish.getTime() - start.getTime()) / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            totalSeconds %= 3600;
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;

            return `${hours}h ${minutes}m ${seconds}s`;
        },

        parseDateTime(value) {
            if (!value) return null;
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

            const text = String(value).trim();
            const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
            if (match) {
                const [, year, month, day, hour, minute, second] = match;
                return new Date(
                    Number(year),
                    Number(month) - 1,
                    Number(day),
                    Number(hour),
                    Number(minute),
                    Number(second)
                );
            }

            const parsed = new Date(text);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        },

        ensureJobReady(requireObject) {
            if (!this.ensureWorkContextSelected()) return false;
            if (!this.currentJob?.ownerName || !this.currentJob?.tableName) {
                alert("Select a scenario table first.");
                return false;
            }
            if (!getContainerEl(`#workJobName-${PAGE_CODE}`)?.value.trim()) {
                alert("Job Name is required.");
                getContainerEl(`#workJobName-${PAGE_CODE}`)?.focus();
                return false;
            }
            if (!getContainerEl(`#workJobGroup-${PAGE_CODE}`)?.value.trim()) {
                alert("Job Group is required.");
                getContainerEl(`#workJobGroup-${PAGE_CODE}`)?.focus();
                return false;
            }
            const hasExecutableObject = Boolean(
                getContainerEl(`#execObject-${PAGE_CODE}`)?.value
                || this.currentJob?.execObjectId
                || this.currentJob?.execObjectName
                || this.currentJob?.execObjectLabel
            );
            if (requireObject && !hasExecutableObject) {
                alert("Registered Model / Procedure is required.");
                getContainerEl(`#execObject-${PAGE_CODE}`)?.focus();
                return false;
            }
            if (requireObject && !getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.value.trim()) {
                alert("Executable PL/SQL script is required. Generate or enter the script first.");
                getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.focus();
                return false;
            }
            const resultCreateYn = getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || "N";
            if (resultCreateYn === "Y") {
                if (!getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim()) {
                    alert("Result Owner is required when Result Table Create is Y.");
                    getContainerEl(`#resultOwner-${PAGE_CODE}`)?.focus();
                    return false;
                }
                if (!getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim()) {
                    alert("Result Table is required when Result Table Create is Y.");
                    getContainerEl(`#resultTable-${PAGE_CODE}`)?.focus();
                    return false;
                }
            }
            return true;
        },

        getJobPayload(status, message) {
            const execObject = this.executableObjects.find((row) => String(row.OBJECT_ID) === String(getContainerEl(`#execObject-${PAGE_CODE}`)?.value || ""));
            return {
                profileJobId: this.currentJob?.profileJobId || null,
                projectId: Number(this.selectedProjectId),
                scenarioId: Number(this.selectedScenarioId),
                scenarioTableId: this.currentJob?.scenarioTableId ? Number(this.currentJob.scenarioTableId) : null,
                jobGroup: getContainerEl(`#workJobGroup-${PAGE_CODE}`)?.value.trim() || DEFAULT_JOB_GROUP,
                jobName: getContainerEl(`#workJobName-${PAGE_CODE}`)?.value.trim() || "",
                jobDesc: getContainerEl(`#workJobDesc-${PAGE_CODE}`)?.value.trim() || "",
                ownerName: this.currentJob?.ownerName || "",
                tableName: this.currentJob?.tableName || "",
                execObjectId: execObject?.OBJECT_ID || null,
                execOwner: execObject?.OWNER || "",
                execObjectType: execObject?.OBJECT_TYPE || "",
                execObjectName: execObject?.OBJECT_NAME || "",
                execObjectLabel: execObject?.OBJECT_LABEL || execObject?.OBJECT_NAME || "",
                useYn: getContainerEl(`#jobUseYn-${PAGE_CODE}`)?.value || "Y",
                sortOrder: this.parseOptionalNumber(getContainerEl(`#jobSortOrder-${PAGE_CODE}`)?.value),
                params: this.parameters,
                execPlsql: getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.value || "",
                resultCreateYn: getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || "N",
                resultOwner: getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim() || "",
                resultTableName: getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim() || "",
                status
            };
        },

        generateExecutablePlsql(force = false) {
            const editor = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`);
            if (!editor) return;
            if (!force && editor.value.trim()) return;

            const objectName = this.currentJob?.execObjectName || "";
            if (!objectName) {
                editor.value = "";
                return;
            }

            editor.value = this.createPlsqlTemplate(objectName);
            this.currentJob.execPlsql = editor.value;
        },

        openPlsqlHelp() {
            const layer = getContainerEl(`#plsqlHelpLayer-${PAGE_CODE}`);
            if (layer) layer.hidden = false;
        },

        closePlsqlHelp() {
            const layer = getContainerEl(`#plsqlHelpLayer-${PAGE_CODE}`);
            if (layer) layer.hidden = true;
        },

        async collectRuntimeBindValues(scriptText = null, options = {}) {
            const editor = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`);
            const script = scriptText ?? (editor?.value || this.currentJob?.execPlsql || "");
            const bindNames = this.extractBindVariables(script);
            const dynamicTokenNames = this.extractDynamicTokens(script);
            const parameterRows = options.useParameterDefaults === false ? [] : (this.parameters || []);
            const parameterBindMap = new Map(parameterRows
                .map((row) => [this.toBindVariableName(row.itemName || ""), row])
                .filter(([name]) => Boolean(name)));
            const parameterNameMap = new Map(parameterRows
                .map((row) => [String(row.itemName || ""), row])
                .filter(([name]) => Boolean(name)));
            const prompts = [];
            const seen = new Set();

            bindNames.forEach((name) => {
                const row = parameterBindMap.get(name);
                if (!row || !String(row.itemDefault ?? "").trim()) {
                    this.addRuntimeBindPrompt(prompts, seen, name, `:${name}`);
                }
            });

            dynamicTokenNames.forEach((name) => {
                const row = parameterNameMap.get(name);
                if (!row || !String(row.itemDefault ?? "").trim()) {
                    this.addRuntimeBindPrompt(prompts, seen, name, `/* --${name}-- */`);
                }
            });

            if (!prompts.length) return {};
            return this.openRuntimeBindDialog(prompts);
        },

        extractBindVariables(sqlText) {
            const masked = this.maskSqlForBindScan(sqlText);
            const names = [];
            const seen = new Set();
            const regex = /(?<!:):([A-Za-z][A-Za-z0-9_]*)/g;
            let match;
            while ((match = regex.exec(masked)) !== null) {
                const name = match[1];
                if (!seen.has(name)) {
                    seen.add(name);
                    names.push(name);
                }
            }
            return names;
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

        addRuntimeBindPrompt(prompts, seen, name, label) {
            if (!name || seen.has(name)) return;
            seen.add(name);
            prompts.push({ name, label });
        },

        maskSqlForBindScan(sqlText) {
            return String(sqlText || "")
                .replace(/'(?:''|[^'])*'/gs, (match) => " ".repeat(match.length))
                .replace(/"(?:""|[^"])*"/gs, (match) => " ".repeat(match.length))
                .replace(/\/\*.*?\*\//gs, (match) => " ".repeat(match.length))
                .replace(/--[^\r\n]*/gm, (match) => " ".repeat(match.length));
        },

        openRuntimeBindDialog(bindPrompts) {
            const layer = getContainerEl(`#runtimeBindLayer-${PAGE_CODE}`);
            const grid = getContainerEl(`#runtimeBindGrid-${PAGE_CODE}`);
            if (!layer || !grid) return Promise.resolve({});
            grid.innerHTML = bindPrompts.map((item) => `
                <label class="data-bind-row">
                    <span>${this.escapeHtml(item.label || item.name)}</span>
                    <input class="env-field data-runtime-bind-input" data-bind-name="${this.escapeHtml(item.name)}" type="text" value="${this.escapeAttr(this.runtimeBindValues[item.name] ?? "")}">
                </label>
            `).join("");
            layer.hidden = false;
            setTimeout(() => grid.querySelector("input")?.focus(), 0);
            return new Promise((resolve) => {
                this.runtimeBindDialog = { resolve };
            });
        },

        confirmRuntimeBindDialog() {
            const layer = getContainerEl(`#runtimeBindLayer-${PAGE_CODE}`);
            const values = {};
            getContainerEl(`#runtimeBindGrid-${PAGE_CODE}`)?.querySelectorAll(".data-runtime-bind-input").forEach((input) => {
                values[input.dataset.bindName] = input.value;
            });
            this.runtimeBindValues = { ...this.runtimeBindValues, ...values };
            if (layer) layer.hidden = true;
            this.runtimeBindDialog?.resolve(values);
            this.runtimeBindDialog = null;
        },

        cancelRuntimeBindDialog() {
            const layer = getContainerEl(`#runtimeBindLayer-${PAGE_CODE}`);
            if (layer) layer.hidden = true;
            this.runtimeBindDialog?.resolve(null);
            this.runtimeBindDialog = null;
        },

        createPlsqlTemplate(objectName) {
            const rows = this.parameters || [];
            const declarations = [];
            const args = rows.map((row, index) => {
                const paramName = row.itemName || `P${index + 1}`;
                const direction = this.getParamDirection(row.itemValue);
                if (direction.includes("OUT")) {
                    const varName = `v_${paramName.toLowerCase()}`.replace(/[^a-z0-9_$#]/g, "_");
                    const initialValue = direction.includes("IN") ? ` := ${this.createPlsqlArgument(row)}` : "";
                    declarations.push(`  ${varName} ${this.getParamDataType(row.itemValue)}${initialValue};`);
                    return `    ${this.padRight(paramName, 22)} => ${varName}`;
                }
                return `    ${this.padRight(paramName, 22)} => ${this.createPlsqlArgument(row)}`;
            }).join(",\n");

            const declareBlock = declarations.length
                ? `DECLARE\n${declarations.join("\n")}\nBEGIN`
                : "BEGIN";
            const outputLines = declarations.length
                ? `\n\n  -- OUT / IN OUT values are available in the local variables above.`
                : "";
            const callText = args
                ? `  ${objectName}(\n${args}\n  );`
                : `  ${objectName};`;

            return `${declareBlock}
${callText}${outputLines}
END;`;
        },

        createPlsqlArgument(row) {
            const text = String(row?.itemDefault ?? "").trim();
            if (text) return this.createPlsqlLiteral(text);
            return `:${this.toBindVariableName(row?.itemName || "")}`;
        },

        toBindVariableName(parameterName) {
            const parts = String(parameterName || "")
                .trim()
                .split("_")
                .filter(Boolean);
            if (!parts.length) return "paramValue";
            return parts.map((part, index) => {
                const lower = part.toLowerCase();
                return index === 0
                    ? lower
                    : lower.charAt(0).toUpperCase() + lower.slice(1);
            }).join("");
        },

        createPlsqlLiteral(value) {
            const text = String(value ?? "").trim();
            if (!text) return "NULL";
            if (/^(NULL|TRUE|FALSE)$/i.test(text)) return text.toUpperCase();
            if (/^-?\d+(\.\d+)?$/.test(text)) return text;
            return `'${this.escapeSqlLiteral(text)}'`;
        },

        getParamDirection(itemValue) {
            const text = String(itemValue || "").trim().toUpperCase();
            if (text.startsWith("IN OUT")) return "IN OUT";
            if (text.startsWith("OUT")) return "OUT";
            return "IN";
        },

        getParamDataType(itemValue) {
            const text = String(itemValue || "").trim();
            const dataType = text.replace(/^(IN\s+OUT|IN|OUT)\s+/i, "").trim() || "VARCHAR2(4000)";
            if (/^VARCHAR2$/i.test(dataType) || /^CHAR$/i.test(dataType)) return "VARCHAR2(4000)";
            if (/^NVARCHAR2$/i.test(dataType) || /^NCHAR$/i.test(dataType)) return "NVARCHAR2(2000)";
            return dataType;
        },

        escapeSqlLiteral(value) {
            return String(value ?? "").replace(/'/g, "''");
        },

        padRight(value, length) {
            const text = String(value || "");
            return text + " ".repeat(Math.max(1, length - text.length));
        },

        switchTab(tabName) {
            this.activeTab = tabName;
            const container = document.getElementById(`container-${PAGE_CODE}`);
            getContainerEl(".data-work-tabs")?.querySelectorAll(".table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.tab === tabName);
            });
            container?.querySelectorAll(".data-work-panel, .data-tool-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.panel === tabName);
            });
            if (tabName === "history") {
                this.loadRunHistory();
            }
        },

        renderSqlTransactionState() {
            const active = Boolean(this.sqlTransactionId);
            const commitButton = getContainerEl(`#sqlTxCommit-${PAGE_CODE}`);
            const rollbackButton = getContainerEl(`#sqlTxRollback-${PAGE_CODE}`);
            const status = getContainerEl(`#sqlTxStatus-${PAGE_CODE}`);

            if (commitButton) commitButton.disabled = !active;
            if (rollbackButton) rollbackButton.disabled = !active;
            if (status) {
                status.textContent = active ? "Transaction active" : "No active transaction";
                status.className = active ? "table-empty is-active" : "table-empty";
            }
        },

        async finishSqlTransaction(action) {
            if (!this.sqlTransactionId) return;
            const transactionId = this.sqlTransactionId;
            this.renderSqlMessage("sql", `${action === "commit" ? "Committing" : "Rolling back"} transaction...`, "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql/transaction/${action}`, {
                    method: "POST",
                    body: { transactionId }
                });
                this.sqlTransactionId = "";
                this.renderSqlTransactionState();
                this.renderSqlMessage("sql", json.message || `Transaction ${action} completed.`, "success");
            } catch (error) {
                this.renderSqlMessage("sql", error.message || `Transaction ${action} failed.`, "error");
            }
        },

        async commitSqlTransaction() {
            await this.finishSqlTransaction("commit");
        },

        async rollbackSqlTransaction() {
            await this.finishSqlTransaction("rollback");
        },

        async executeSql(editorSelector, gridSelector, gridKey) {
            const executable = this.getExecutableSqlFromEditor(editorSelector);
            if (!executable.sql) {
                this.renderSqlMessage(gridKey, "No SQL statement found at the cursor.", "error");
                return;
            }
            const sql = executable.sql;
            const runtimeBindValues = await this.collectRuntimeBindValues(sql, { useParameterDefaults: false });
            if (runtimeBindValues === null) {
                this.renderSqlMessage(gridKey, "SQL execution canceled.", "info");
                this.restoreSqlSelection(editorSelector, executable);
                return;
            }
            if (!this.validateExecutableSql(sql)) {
                this.renderSqlMessage(gridKey, "Only a single SELECT, PL/SQL block, CREATE TABLE, or DML statement is allowed.", "error");
                this.restoreSqlSelection(editorSelector, executable);
                return;
            }

            this.restoreSqlSelection(editorSelector, executable);
            await this.runWorksheetSql(sql, gridSelector, gridKey, runtimeBindValues);
            this.restoreSqlSelection(editorSelector, executable);
        },

        async executeFullSql(editorSelector, gridSelector, gridKey) {
            const editor = getContainerEl(editorSelector);
            const sql = editor?.value.trim() || "";
            if (!sql) {
                this.renderSqlMessage(gridKey, "No SQL text to execute.", "error");
                return;
            }
            const runtimeBindValues = await this.collectRuntimeBindValues(sql, { useParameterDefaults: false });
            if (runtimeBindValues === null) {
                this.renderSqlMessage(gridKey, "SQL execution canceled.", "info");
                return;
            }
            if (!this.validateExecutableSql(sql)) {
                this.renderSqlMessage(gridKey, "Only a single SELECT, PL/SQL block, CREATE TABLE, or DML statement is allowed.", "error");
                return;
            }
            await this.runWorksheetSql(sql, gridSelector, gridKey, runtimeBindValues);
            editor?.focus();
        },

        async runWorksheetSql(sql, gridSelector, gridKey, runtimeBindValues = null) {
            const limit = this.getLimit(gridKey === "result" ? `#resultLimit-${PAGE_CODE}` : `#sqlLimit-${PAGE_CODE}`);
            const grid = getContainerEl(gridSelector);
            const startedAt = performance.now();
            this.renderSqlMessage(gridKey, "Running SQL...", "info");

            try {
                const bindValues = runtimeBindValues ?? {};
                const body = { sql, limit };
                if (Object.keys(bindValues).length) {
                    body.runtimeBindValues = bindValues;
                }
                if (gridKey === "sql" && this.sqlTransactionId) {
                    body.transactionId = this.sqlTransactionId;
                }
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql`, {
                    method: "POST",
                    body
                });
                const elapsedMs = Number.isFinite(Number(json.elapsedMs))
                    ? Number(json.elapsedMs)
                    : Math.round(performance.now() - startedAt);
                if (gridKey === "sql" && json.transactionId && json.transactionId !== this.sqlTransactionId) {
                    this.sqlTransactionId = json.transactionId;
                    this.renderSqlTransactionState();
                }
                this.renderSqlMessage(gridKey, `${json.message || "SQL executed."} (${elapsedMs.toLocaleString()} ms)`, "success");
                const rows = json.data || [];
                const columns = json.columns || [];
                this.gridData[gridKey] = { rows, columns };
                this.renderGrid(gridSelector, rows, columns);
            } catch (error) {
                const elapsedMs = Math.round(performance.now() - startedAt);
                this.renderSqlMessage(gridKey, `${error.message || "SQL execution failed."} (${elapsedMs.toLocaleString()} ms)`, "error");
                this.gridData[gridKey] = { rows: [], columns: [] };
                if (grid) grid.innerHTML = "";
            }
        },

        exportSqlGrid(format) {
            const grid = this.gridData.sql || {};
            const rows = grid.rows || [];
            if (!rows.length) {
                alert("No grid data to export.");
                return;
            }

            const baseName = this.createSqlExportFileName();
            if (format === "excel") {
                this.downloadBlob(`${baseName}.xls`, this.createExcelContent(rows, grid.columns), "application/vnd.ms-excel;charset=utf-8");
                return;
            }
            if (format === "csv") {
                this.downloadBlob(`${baseName}.csv`, this.createDelimitedContent(rows, grid.columns, ","), "text/csv;charset=utf-8");
                return;
            }
            if (format === "tsv") {
                this.downloadBlob(`${baseName}.tsv`, this.createDelimitedContent(rows, grid.columns, "\t"), "text/tab-separated-values;charset=utf-8");
            }
        },

        createSqlExportFileName() {
            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
            return `${PAGE_CODE}_USER_SQL_${stamp}`;
        },

        createExcelContent(rows, columnNames = []) {
            const columns = this.getExportColumns(rows, columnNames);
            return `
                <html>
                    <head><meta charset="UTF-8"></head>
                    <body>
                        <table>
                            <thead>
                                <tr>${columns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr>
                            </thead>
                            <tbody>
                                ${rows.map((row) => `
                                    <tr>${columns.map((column) => `<td>${this.escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </body>
                </html>
            `;
        },

        createDelimitedContent(rows, columnNames = [], delimiter = ",") {
            const columns = this.getExportColumns(rows, columnNames);
            const lines = [
                columns.map((column) => this.escapeDelimitedValue(column, delimiter)).join(delimiter),
                ...rows.map((row) => columns.map((column) => this.escapeDelimitedValue(row[column] ?? "", delimiter)).join(delimiter))
            ];
            return `\uFEFF${lines.join("\r\n")}`;
        },

        getExportColumns(rows, columnNames = []) {
            return Array.isArray(columnNames) && columnNames.length
                ? columnNames
                : Object.keys(rows?.[0] || {});
        },

        escapeDelimitedValue(value, delimiter) {
            const text = String(value ?? "");
            const shouldQuote = text.includes('"') || text.includes("\r") || text.includes("\n") || text.includes(delimiter);
            const escaped = text.replace(/"/g, '""');
            return shouldQuote ? `"${escaped}"` : escaped;
        },

        downloadBlob(fileName, content, type) {
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

        async saveSqlResultTable() {
            const executable = this.getExecutableSqlFromEditor(`#sqlEditor-${PAGE_CODE}`);
            if (!executable.sql || !this.validateSelectSql(executable.sql)) {
                this.renderError(`#sqlGrid-${PAGE_CODE}`, "Only a single SELECT statement can be saved to a table.");
                return;
            }
            const targetTable = getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim();
            if (!targetTable) {
                alert("Result Table is required.");
                getContainerEl(`#resultTable-${PAGE_CODE}`)?.focus();
                return;
            }
            const resultOwner = getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim();

            const savedJob = this.currentJob?.profileJobId ? this.currentJob : await this.saveJobInternal(false);
            if (!savedJob) return;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql/save-table`, {
                    method: "POST",
                    body: {
                        sql: executable.sql,
                        resultOwner,
                        targetTableName: targetTable,
                        profileJobId: this.currentJob?.profileJobId || null
                    }
                });
                alert(json.message || "SQL result table was created.");
                this.currentJob.resultOwner = json.resultOwner || resultOwner;
                this.currentJob.resultTableName = json.tableName || targetTable;
                this.currentJob.resultCreateYn = "Y";
                this.currentJob.status = "RESULT_SAVED";
                this.renderCurrentJob();
                this.setResultTableSql();
                await this.loadJobs();
            } catch (error) {
                alert(error.message || "SQL result table save failed.");
            }
        },

        setDefaultUserSql(force = false) {
            const editor = getContainerEl(`#sqlEditor-${PAGE_CODE}`);
            if (!editor) return;
            const currentValue = editor.value || "";
            const canReplace = !currentValue.trim()
                || currentValue === this.systemUserSqlValue
                || !this.userSqlDirty
                || (force && !this.userSqlDirty);
            if (!canReplace) return;

            const sql = this.createDefaultUserSql();
            if (!sql) return;
            editor.value = sql;
            this.systemUserSqlValue = sql;
            this.userSqlDirty = false;
        },

        handleUserSqlInput() {
            const editor = getContainerEl(`#sqlEditor-${PAGE_CODE}`);
            const value = editor?.value || "";
            this.userSqlDirty = Boolean(value.trim()) && value !== this.systemUserSqlValue;
        },

        createDefaultUserSql() {
            const job = this.currentJob || {};
            const useResultTable = String(job.resultCreateYn || "").toUpperCase() === "Y"
                && job.resultOwner
                && job.resultTableName;
            const ownerName = useResultTable ? job.resultOwner : job.ownerName;
            const tableName = useResultTable ? job.resultTableName : job.tableName;
            return ownerName && tableName
                ? `SELECT *\n  FROM ${this.quoteName(ownerName)}.${this.quoteName(tableName)};`
                : "";
        },

        setResultTableSql() {
            const tableName = getContainerEl(`#resultQueryTable-${PAGE_CODE}`)?.value.trim() || getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim();
            const ownerName = getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim();
            this.setEditorValue(`#resultSqlEditor-${PAGE_CODE}`, this.createResultSql(tableName, ownerName));
        },

        createResultSql(tableName, ownerName = "") {
            const table = String(tableName || "").trim();
            const owner = String(ownerName || "").trim();
            const objectName = owner ? `${this.quoteName(owner)}.${this.quoteName(table)}` : this.quoteName(table);
            return table ? `SELECT *\n  FROM ${objectName};` : "";
        },

        handleSqlEditorKeydown(event, editorSelector, gridSelector, gridKey) {
            if (event.key === "F5") {
                event.preventDefault();
                this.executeFullSql(editorSelector, gridSelector, gridKey);
                return;
            }
            if (event.ctrlKey && event.key === "Enter") {
                event.preventDefault();
                this.executeSql(editorSelector, gridSelector, gridKey);
            }
        },

        getExecutableSqlFromEditor(selector) {
            const editor = getContainerEl(selector);
            if (!editor) {
                return { sql: "", selectionStart: 0, selectionEnd: 0 };
            }

            const value = editor.value || "";
            const selectionStart = editor.selectionStart || 0;
            const selectionEnd = editor.selectionEnd || 0;
            if (selectionStart !== selectionEnd) {
                return {
                    sql: value.slice(selectionStart, selectionEnd).trim(),
                    selectionStart,
                    selectionEnd
                };
            }

            const range = this.findSqlStatementRange(value, selectionStart);
            return {
                sql: value.slice(range.selectionStart, range.selectionEnd).trim(),
                selectionStart: range.selectionStart,
                selectionEnd: range.selectionEnd
            };
        },

        findSqlStatementRange(value, cursorIndex) {
            let start = value.lastIndexOf(";", Math.max(0, cursorIndex - 1)) + 1;
            let end = value.indexOf(";", cursorIndex);
            if (end < 0) end = value.length;

            const cursorIsBetweenStatements = start > 0 && !value.slice(start, cursorIndex).trim();
            if ((!value.slice(start, end).trim() && start > 0) || cursorIsBetweenStatements) {
                end = start - 1;
                start = value.lastIndexOf(";", Math.max(0, end - 1)) + 1;
            }

            while (start < end && /\s/.test(value[start])) start += 1;
            while (end > start && /\s/.test(value[end - 1])) end -= 1;
            return { selectionStart: start, selectionEnd: end };
        },

        restoreSqlSelection(selector, selection) {
            const editor = getContainerEl(selector);
            if (!editor || !selection) return;
            editor.focus();
            editor.setSelectionRange(selection.selectionStart, selection.selectionEnd);
        },

        validateSelectSql(sql) {
            const text = sql.trim().replace(/;+\s*$/, "");
            if (!/^(select|with)\b/i.test(text)) return false;
            return !/;\s*\S/.test(sql);
        },

        validateExecutableSql(sql) {
            const text = String(sql || "").trim();
            if (/^(declare|begin)\b/i.test(text)) {
                return /\bend\s*;\s*\/?\s*$/i.test(text);
            }
            if (/^create\s+table\b/i.test(text)) {
                return !/;\s*\S/.test(text);
            }
            if (/^(insert|update|delete|merge)\b/i.test(text)) {
                return !/;\s*\S/.test(text);
            }
            return this.validateSelectSql(text);
        },

        renderSqlMessage(gridKey, message, type = "info") {
            const selector = gridKey === "sql" ? `#sqlMessage-${PAGE_CODE}` : "";
            const element = selector ? getContainerEl(selector) : null;
            if (!element) return;
            element.className = type === "error" ? "table-error" : "table-empty";
            element.textContent = message || "";
            element.hidden = !message;
        },

        renderGrid(selector, rows, columnNames = []) {
            const container = getContainerEl(selector);
            if (!container) return;
            const columns = Array.isArray(columnNames) && columnNames.length
                ? columnNames
                : Object.keys(rows?.[0] || {});
            if (!Array.isArray(rows) || !rows.length) {
                if (columns.length) {
                    container.innerHTML = `
                        <table class="table-grid">
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
                container.innerHTML = `<div class="table-empty">No data.</div>${this.renderListFooter(0)}`;
                return;
            }

            container.innerHTML = `
                <table class="table-grid">
                    <thead>
                        <tr>
                            <th class="grid-row-no">No</th>
                            ${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${rowIndex + 1}</td>
                                ${columns.map((column) => `<td title="${this.escapeHtml(row[column] ?? "")}">${this.escapeHtml(row[column] ?? "")}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                ${this.renderListFooter(rows.length)}
            `;
        }
    };;
            window[PAGE_CODE] = page;
            return page;
        }

    };

    window.MCOMMON = MCOMMON;
})();

