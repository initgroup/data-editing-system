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

                escapeSqlLiteral(value) {
                    return String(value ?? "").replace(/'/g, "''");
                },

                shouldApplyTargetResultFilter(tableName) {
                    return new Set([
                        "INIT$_TB_PREDICTED_TYPE",
                        "INIT$_TB_PREDICTED_TYPE_FINAL",
                        "INIT$_TB_CAT_CORR_PAIR",
                        "INIT$_TB_CAT_CORR_SUMMARY",
                        "INIT$_TB_NUM_CORR_PAIR",
                        "INIT$_TB_NUM_CORR_SUMMARY",
                        "INIT$_TB_LASSO_FEATURE",
                        "INIT$_TB_SYMBOLIC_RULE",
                        "INIT$_TB_ASSOC_RULE_SUMMARY",
                        "INIT$_TB_RULE_VIOLATION_RESULT",
                        "INIT$_TB_SYMBOLIC_RULE_VIOLATION"
                    ])
                        .has(String(tableName || "").trim().toUpperCase());
                },

                getLatestDataWorkRunId() {
                    const contextRunId = this.getCurrentDataWorkRunId?.();
                    if (contextRunId) return contextRunId;
                    const jobId = String(this.currentJob?.profileJobId || this.currentJob?.workJobId || "").trim();
                    if (!jobId) return "";
                    const row = (this.runHistory || []).find((item) => (
                        String(item.PROFILE_JOB_ID || item.WORK_JOB_ID || "").trim() === jobId
                        && (item.DATA_RUN_ID || item.RUN_ID || item.PROFILE_RUN_ID || item.WORK_RUN_ID)
                    ));
                    return row ? String(row.DATA_RUN_ID || row.RUN_ID || row.PROFILE_RUN_ID || row.WORK_RUN_ID || "").trim() : "";
                },

                createTargetResultWhereClause(tableName, targetOwner = "", targetTable = "", runIdOverride = null) {
                    const table = String(tableName || "").trim().toUpperCase();
                    const owner = String(targetOwner || "").trim();
                    const target = String(targetTable || "").trim();
                    if (!this.shouldApplyTargetResultFilter(table) || !owner || !target) return "";
                    const clauses = table === "INIT$_TB_ASSOC_RULE_SUMMARY"
                        || table === "INIT$_TB_RULE_VIOLATION_RESULT"
                        || table === "INIT$_TB_SYMBOLIC_RULE_VIOLATION"
                        ? [
                            `TARGET_OWNER = '${this.escapeSqlLiteral(owner.toUpperCase())}'`,
                            ` AND TARGET_TABLE = '${this.escapeSqlLiteral(target.toUpperCase())}'`
                        ]
                        : [
                            `OWNER = '${this.escapeSqlLiteral(owner.toUpperCase())}'`,
                            ` AND TABLE_NAME = '${this.escapeSqlLiteral(target.toUpperCase())}'`
                        ];
                    if (table === "INIT$_TB_PREDICTED_TYPE_FINAL") {
                        return clauses.join("\n");
                    }
                    const runId = runIdOverride !== null
                        ? String(runIdOverride || "")
                        : this.getLatestDataWorkRunId?.();
                    if (runId && /^\d+$/.test(runId)) {
                        clauses.push(" AND RUN_SOURCE_TYPE = 'DATA_WORK'");
                        clauses.push(` AND RUN_ID = ${runId}`);
                    }
                    return clauses.join("\n");
                },

                isPredictedTypeResultTable(tableName) {
                    const table = String(tableName || "").trim().toUpperCase();
                    return table === "INIT$_TB_PREDICTED_TYPE" || table === "INIT$_TB_PREDICTED_TYPE_FINAL";
                },

                shouldLookupExistingResultRunId(tableName) {
                    const table = String(tableName || "").trim().toUpperCase();
                    return new Set([
                        "INIT$_TB_CAT_CORR_PAIR",
                        "INIT$_TB_CAT_CORR_SUMMARY",
                        "INIT$_TB_NUM_CORR_PAIR",
                        "INIT$_TB_NUM_CORR_SUMMARY",
                        "INIT$_TB_LASSO_FEATURE",
                        "INIT$_TB_SYMBOLIC_RULE",
                        "INIT$_TB_ASSOC_RULE_SUMMARY",
                        "INIT$_TB_RULE_VIOLATION_RESULT",
                        "INIT$_TB_SYMBOLIC_RULE_VIOLATION"
                    ]).has(table);
                },

                getPredictedTypeFinalTableName(tableName) {
                    return this.isPredictedTypeResultTable(tableName)
                        ? "INIT$_TB_PREDICTED_TYPE_FINAL"
                        : String(tableName || "").trim();
                },

                createTargetFilteredSelectSql(ownerName, tableName, targetOwner = "", targetTable = "", runIdOverride = null) {
                    const owner = String(ownerName || "").trim();
                    const requestedTable = String(tableName || "").trim();
                    const table = pageCode === "M03001"
                        ? this.getPredictedTypeFinalTableName(requestedTable)
                        : requestedTable;
                    if (!table) return "";
                    const objectName = owner ? `${this.quoteName(owner)}.${this.quoteName(table)}` : this.quoteName(table);
                    const whereClause = this.createTargetResultWhereClause(table, targetOwner, targetTable, runIdOverride);
                    const mainSql = !whereClause ? `SELECT *\n  FROM ${objectName};` : [
                        "SELECT *",
                        `  FROM ${objectName}`,
                        ` WHERE ${whereClause.replace(/\n\s*AND /g, "\n   AND ")};`
                    ].join("\n");
                    if (pageCode !== "M03001" || !this.isPredictedTypeResultTable(requestedTable)) {
                        return mainSql;
                    }

                    const historyObjectName = owner
                        ? `${this.quoteName(owner)}.${this.quoteName("INIT$_TB_PREDICTED_TYPE")}`
                        : this.quoteName("INIT$_TB_PREDICTED_TYPE");
                    const historyWhereClause = this.createTargetResultWhereClause("INIT$_TB_PREDICTED_TYPE", targetOwner, targetTable, runIdOverride);
                    const historySql = !historyWhereClause ? `SELECT *\n  FROM ${historyObjectName};` : [
                        "SELECT *",
                        `  FROM ${historyObjectName}`,
                        ` WHERE ${historyWhereClause.replace(/\n\s*AND /g, "\n   AND ")};`
                    ].join("\n");
                    return `${mainSql}\n\n${historySql}`;
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
        omlResources: [],
        jobs: [],
        runHistory: [],
        parameters: [],
        selectedProjectId: "",
        selectedScenarioId: "",
        selectedScenarioTableKey: "",
        selectedJobId: "",
        dataWorkRunId: "",
        dataWorkRunAt: "",
        workContextCollapsed: false,
        activeTab: "work",
        currentJob: null,
        sqlKeydownBound: null,
        resultSqlKeydownBound: null,
        userSqlInputBound: null,
        dataWhereInputBound: null,
        userSqlDirty: false,
        systemUserSqlValue: "",
        dataWhereDirty: false,
        systemDataWhereValue: "",
        expandedRunHistoryKey: "",
        sqlTransactionId: "",
        gridData: {},
        gridColumnWidths: {},
        gridResizeState: null,
        gridResizeMoveBound: null,
        gridResizeUpBound: null,
        sqlGridFrozenColumns: { sql: 0 },
        dataGridRows: [],
        dataGridColumns: [],
        dataGridDirtyCells: new Map(),
        dataGridTargetKey: "",
        dataGridActiveCell: null,
        dataGridFrozenColumns: 0,
        contextLoadFailed: false,
        runtimeBindDialog: null,
        runtimeBindValues: {},
        savedJobSnapshot: null,
        scriptWrapMode: false,

        async init() {
            if (this.isInit) return;
            this.currentJob = this.createEmptyJob();
            this.applyUiLabels();
            this.syncScriptWrapMode();
            this.syncDataEditTabVisibility();
            this.renderSqlTransactionState();
            this.sqlKeydownBound = (event) => this.handleSqlEditorKeydown(event, `#sqlEditor-${PAGE_CODE}`, `#sqlGrid-${PAGE_CODE}`, "sql");
            this.resultSqlKeydownBound = (event) => this.handleSqlEditorKeydown(event, `#resultSqlEditor-${PAGE_CODE}`, `#resultGrid-${PAGE_CODE}`, "result");
            this.userSqlInputBound = () => this.handleUserSqlInput();
            this.dataWhereInputBound = () => this.handleDataWhereInput();
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.addEventListener("keydown", this.sqlKeydownBound);
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.addEventListener("input", this.userSqlInputBound);
            getContainerEl(`#dataWhere-${PAGE_CODE}`)?.addEventListener("input", this.dataWhereInputBound);
            getContainerEl(`#resultSqlEditor-${PAGE_CODE}`)?.addEventListener("keydown", this.resultSqlKeydownBound);
            await Promise.all([
                this.loadExecutableObjects(),
                this.loadOmlResources()
            ]);
            await this.loadWorkContext();
            this.switchTab("work");
            this.renderCurrentJob();
            this.isInit = true;
        },

        destroy() {
            this.endSqlGridColumnResize?.();
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.removeEventListener("keydown", this.sqlKeydownBound);
            getContainerEl(`#sqlEditor-${PAGE_CODE}`)?.removeEventListener("input", this.userSqlInputBound);
            getContainerEl(`#dataWhere-${PAGE_CODE}`)?.removeEventListener("input", this.dataWhereInputBound);
            getContainerEl(`#resultSqlEditor-${PAGE_CODE}`)?.removeEventListener("keydown", this.resultSqlKeydownBound);
            this.contextProjects = [];
            this.contextScenarios = [];
            this.scenarioTables = [];
            this.executableObjects = [];
            this.omlResources = [];
            this.jobs = [];
            this.runHistory = [];
            this.parameters = [];
            this.selectedProjectId = "";
            this.selectedScenarioId = "";
            this.selectedScenarioTableKey = "";
            this.selectedJobId = "";
            this.dataWorkRunId = "";
            this.dataWorkRunAt = "";
            this.workContextCollapsed = false;
            this.activeTab = "work";
            this.currentJob = null;
            this.sqlKeydownBound = null;
            this.resultSqlKeydownBound = null;
            this.userSqlInputBound = null;
            this.dataWhereInputBound = null;
            this.userSqlDirty = false;
            this.systemUserSqlValue = "";
            this.dataWhereDirty = false;
            this.systemDataWhereValue = "";
            this.sqlTransactionId = "";
            this.gridData = {};
            this.gridColumnWidths = {};
            this.gridResizeState = null;
            this.sqlGridFrozenColumns = { sql: 0 };
            this.dataGridRows = [];
            this.dataGridColumns = [];
            this.dataGridDirtyCells = new Map();
            this.dataGridTargetKey = "";
            this.dataGridActiveCell = null;
            this.dataGridFrozenColumns = 0;
            this.contextLoadFailed = false;
            this.runtimeBindDialog = null;
            this.runtimeBindValues = {};
            this.savedJobSnapshot = null;
            this.scriptWrapMode = false;
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
                execSourceType: "DB_OBJECT",
                execResourceId: "",
                execMethod: "",
                execSpecJson: "",
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
            await this.loadDataWorkRunId(false);
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
            await this.loadDataWorkRunId(false);
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
            this.currentJob = this.createEmptyJob();
            this.parameters = [];
            this.saveStoredContext();
            await this.loadContextScenarios("");
            await this.loadDataWorkRunId(false);
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
            this.syncDataWorkRunIdFromSelectedScenario();
            this.saveStoredContext();
        },

        async handleContextScenarioChange(scenarioId) {
            this.selectedScenarioId = scenarioId || "";
            CommonUtils.applyOwnerScopeToSelect(getContainerEl(`#contextScenario-${PAGE_CODE}`), this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
            this.selectedScenarioTableKey = "";
            this.currentJob = this.createEmptyJob();
            this.parameters = [];
            this.saveStoredContext();
            await this.loadDataWorkRunId(false);
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

        getSelectedScenario() {
            return (this.contextScenarios || []).find((row) => (
                String(row.SCENARIO_ID ?? row.scenarioId ?? "") === String(this.selectedScenarioId || "")
            )) || null;
        },

        syncDataWorkRunIdFromSelectedScenario() {
            const scenario = this.getSelectedScenario();
            this.dataWorkRunId = String(scenario?.DATA_WORK_RUN_ID ?? scenario?.dataWorkRunId ?? this.dataWorkRunId ?? "").trim();
            this.dataWorkRunAt = String(scenario?.DATA_WORK_RUN_AT ?? scenario?.dataWorkRunAt ?? this.dataWorkRunAt ?? "").trim();
            this.renderDataWorkRunId();
        },

        getCurrentDataWorkRunId() {
            const text = String(this.dataWorkRunId ?? "").trim();
            return /^\d+$/.test(text) && Number(text) > 0 ? text : "";
        },

        setDataWorkRunContext(context = {}) {
            const runId = context.DATA_WORK_RUN_ID ?? context.dataWorkRunId ?? "";
            const runAt = context.DATA_WORK_RUN_AT ?? context.dataWorkRunAt ?? "";
            this.dataWorkRunId = String(runId ?? "").trim();
            this.dataWorkRunAt = String(runAt ?? "").trim();
            this.contextScenarios = (this.contextScenarios || []).map((scenario) => (
                String(scenario.SCENARIO_ID ?? scenario.scenarioId ?? "") === String(this.selectedScenarioId || "")
                    ? { ...scenario, DATA_WORK_RUN_ID: this.dataWorkRunId, DATA_WORK_RUN_AT: this.dataWorkRunAt }
                    : scenario
            ));
            this.renderDataWorkRunId();
        },

        renderDataWorkRunId() {
            const valueEl = getContainerEl(`#dataWorkRunId-${PAGE_CODE}`);
            const box = getContainerEl(`#dataWorkRunBox-${PAGE_CODE}`);
            const runId = this.getCurrentDataWorkRunId();
            if (valueEl) valueEl.textContent = runId || "Not set";
            if (box) {
                box.classList.toggle("is-empty", !runId);
                box.title = runId
                    ? `DATA_WORK RUN_ID ${runId}`
                    : "No DATA_WORK RUN_ID yet. It will be created before run, or use New.";
            }
        },

        async loadDataWorkRunId(showLoading = false) {
            if (!this.selectedProjectId || !this.selectedScenarioId) {
                this.dataWorkRunId = "";
                this.dataWorkRunAt = "";
                this.renderDataWorkRunId();
                return null;
            }
            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data-run-id?${params.toString()}`, {
                    method: "GET",
                    showLoading
                });
                this.setDataWorkRunContext(json.data || {});
                return json.data || null;
            } catch (error) {
                this.dataWorkRunId = "";
                this.dataWorkRunAt = "";
                this.renderDataWorkRunId();
                console.warn(`[${PAGE_CODE}] DATA_WORK RUN_ID load failed`, error);
                return null;
            }
        },

        async ensureDataWorkRunId() {
            if (!this.ensureWorkContextSelected()) return "";
            const current = this.getCurrentDataWorkRunId();
            if (current) return current;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data-run-id/ensure`, {
                    method: "POST",
                    body: {
                        projectId: Number(this.selectedProjectId),
                        scenarioId: Number(this.selectedScenarioId)
                    },
                    showLoading: false
                });
                this.setDataWorkRunContext(json.data || {});
                return this.getCurrentDataWorkRunId();
            } catch (error) {
                alert(error.message || "DATA_WORK RUN_ID is not ready. Run INIT_TARGET_ALTER.sql on the target DB.");
                return "";
            }
        },

        async createNewDataWorkRunId() {
            if (!this.ensureWorkContextSelected()) return;
            const current = this.getCurrentDataWorkRunId();
            const message = current
                ? `Create a new DATA_WORK RUN_ID after ${current}?\n새 DATA_WORK RUN_ID를 생성할까요?`
                : "Create the first DATA_WORK RUN_ID?\n첫 DATA_WORK RUN_ID를 생성할까요?";
            if (!(await CommonMessage.confirm(message))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data-run-id/new`, {
                    method: "POST",
                    body: {
                        projectId: Number(this.selectedProjectId),
                        scenarioId: Number(this.selectedScenarioId)
                    }
                });
                this.setDataWorkRunContext(json.data || {});
                CommonMessage.success(json.message || `DATA_WORK RUN_ID ${this.getCurrentDataWorkRunId()} was created.`, { copyable: false });
            } catch (error) {
                alert(error.message || "DATA_WORK RUN_ID create failed.");
            }
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
                    await this.setDefaultUserSql(false);
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
            this.resetEditableDataGrid();
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
                <option value="">-- Select registered object --</option>
                ${this.executableObjects.map((object) => `
                    <option value="${this.escapeHtml(object.OBJECT_ID ?? "")}">
                        ${this.escapeHtml(object.OBJECT_LABEL || object.OBJECT_NAME || "(Unnamed object)")}
                    </option>
                `).join("")}
            `;
            select.value = this.currentJob?.execObjectId || "";
            if (this.currentJob?.execObjectId) {
                this.syncRegisteredResultInfo();
            }
        },

        getSelectedExecutableObject() {
            const objectId = this.currentJob?.execObjectId || getContainerEl(`#execObject-${PAGE_CODE}`)?.value || "";
            return this.executableObjects.find((row) => String(row.OBJECT_ID || "") === String(objectId)) || null;
        },

        getRegisteredResultInfo(object = this.getSelectedExecutableObject()) {
            if (!object) return null;
            const createMode = this.normalizeResultCreateMode(object.RESULT_CREATE_YN || "N");
            const owner = String(object.RESULT_OWNER || "").trim();
            const tableName = this.getScopedResultObjectName(object, String(object.RESULT_TABLE_NAME || "").trim());
            if (createMode === "N" && !owner && !tableName) return null;
            return {
                resultCreateYn: createMode,
                resultOwner: owner,
                resultTableName: tableName
            };
        },

        getScopedResultObjectName(object = {}, registeredName = "") {
            const baseName = String(registeredName || "").trim().toUpperCase();
            const objectName = String(object.OBJECT_NAME || object.objectName || "").trim().toUpperCase();
            if (objectName !== "INIT$_SP_APRIORI_ASSOC_MODEL") return registeredName;
            if (baseName && baseName !== "OML_ASSOCIATION_MODEL_01") return registeredName;
            const targetTable = String(this.currentJob?.tableName || getContainerEl(`#targetTable-${PAGE_CODE}`)?.value || "").trim().toUpperCase();
            return this.createScopedModelName("OML_ASSOC", targetTable || baseName || "MODEL");
        },

        createScopedModelName(prefix, seed) {
            const safePrefix = String(prefix || "OML_MODEL").toUpperCase().replace(/[^A-Z0-9_$#]/g, "_").replace(/^[^A-Z]+/, "") || "OML_MODEL";
            const safeSeed = String(seed || "MODEL").toUpperCase().replace(/[^A-Z0-9_$#]/g, "_").replace(/^[^A-Z]+/, "") || "MODEL";
            const maxSeedLength = Math.max(1, 128 - safePrefix.length - 1);
            return `${safePrefix}_${safeSeed.slice(-maxSeedLength)}`.slice(0, 128);
        },

        applyRegisteredResultInfo(object = this.getSelectedExecutableObject()) {
            const info = this.getRegisteredResultInfo(object);
            if (!info) return false;
            const changed = this.currentJob?.resultCreateYn !== info.resultCreateYn
                || this.currentJob?.resultOwner !== info.resultOwner
                || this.currentJob?.resultTableName !== info.resultTableName;
            this.currentJob = {
                ...this.currentJob,
                ...info
            };
            this.setFieldValue(`#resultCreateYn-${PAGE_CODE}`, info.resultCreateYn);
            this.setFieldValue(`#resultOwner-${PAGE_CODE}`, info.resultOwner);
            this.setFieldValue(`#resultTable-${PAGE_CODE}`, info.resultTableName);
            this.setFieldValue(`#resultQueryTable-${PAGE_CODE}`, info.resultTableName);
            if (changed) this.resetEditableDataGrid();
            this.updateResultModeLabels();
            return true;
        },

        syncRegisteredResultInfo() {
            const applied = this.applyRegisteredResultInfo();
            this.syncResultFields();
            this.updateResultModeLabels();
            this.renderUserSqlJobContext();
            return applied;
        },

        async loadOmlResources() {
            const select = getContainerEl(`#omlResource-${PAGE_CODE}`);
            if (select) select.innerHTML = `<option value="">Loading OML4Py resources...</option>`;
            const webSelect = getContainerEl(`#webApiMethod-${PAGE_CODE}`);
            if (webSelect) webSelect.innerHTML = `<option value="">Loading Python API resources...</option>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/oml-resources`, { method: "GET", showLoading: false });
                this.omlResources = Array.isArray(json.data) ? json.data : [];
                this.renderOmlResources();
                this.renderWebApiResources();
            } catch (error) {
                const message = error.message || "OML4Py resource load failed.";
                console.error("[${PAGE_CODE}] OML resource load failed", error);
                if (select) select.innerHTML = `<option value="">OML resource load failed</option>`;
                if (webSelect) webSelect.innerHTML = `<option value="">Python API resource load failed</option>`;
                this.renderSqlMessage("sql", message, "error");
            }
        },

        renderOmlResources() {
            const select = getContainerEl(`#omlResource-${PAGE_CODE}`);
            if (!select) return;
            const resources = this.omlResources.filter((resource) => this.isOmlResource(resource));
            select.innerHTML = `
                <option value="">-- Select OML4Py resource --</option>
                ${resources.map((resource) => `
                    <option value="${this.escapeHtml(resource.OML_RESOURCE_ID ?? "")}">
                        ${this.escapeHtml(resource.RESOURCE_LABEL || resource.RESOURCE_NAME || "(Unnamed OML resource)")}
                    </option>
                `).join("")}
            `;
            select.value = this.currentJob?.execResourceId || "";
        },

        renderWebApiResources() {
            const select = getContainerEl(`#webApiMethod-${PAGE_CODE}`);
            if (!select) return;
            const resources = this.omlResources.filter((resource) => this.isWebApiResource(resource));
            select.innerHTML = `
                <option value="">-- Select Python API resource --</option>
                ${resources.map((resource) => {
                    const method = resource.EXEC_METHOD || resource.RESOURCE_NAME || "";
                    const label = resource.RESOURCE_LABEL || resource.RESOURCE_NAME || method || "(Unnamed Python API)";
                    return `
                        <option value="${this.escapeHtml(resource.OML_RESOURCE_ID ?? "")}">
                            ${this.escapeHtml(label)}${method ? ` / ${this.escapeHtml(method)}` : ""}
                        </option>
                    `;
                }).join("")}
            `;
            const current = String(this.currentJob?.execSourceType || "").toUpperCase() === "WEB_API"
                ? (this.currentJob?.execResourceId || this.findWebApiResource(this.currentJob?.execMethod)?.OML_RESOURCE_ID || "")
                : "";
            select.value = current;
        },

        isWebApiResource(resource) {
            const execApi = String(resource?.EXEC_API || "").toUpperCase();
            return ["WEB_API", "PYTHON_API", "REST_API"].includes(execApi);
        },

        isOmlResource(resource) {
            const execApi = String(resource?.EXEC_API || "SQL_API").toUpperCase();
            return !this.isWebApiResource(resource) && execApi === "SQL_API";
        },

        parseSpecJson(value) {
            try {
                const parsed = JSON.parse(String(value || "").trim() || "{}");
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch (error) {
                return {};
            }
        },

        findWebApiResource(value) {
            const key = String(value || "").trim().toUpperCase();
            if (!key) return null;
            return this.omlResources.find((resource) => {
                if (!this.isWebApiResource(resource)) return false;
                return [
                    resource.OML_RESOURCE_ID,
                    resource.EXEC_METHOD,
                    resource.RESOURCE_NAME,
                    resource.SCRIPT_NAME
                ].some((item) => String(item || "").trim().toUpperCase() === key);
            }) || null;
        },

        createWebApiDefinitionFromResource(resource) {
            if (!resource) return null;
            const spec = this.parseSpecJson(resource.SPEC_JSON);
            const method = resource.EXEC_METHOD || spec.method || resource.RESOURCE_NAME || resource.SCRIPT_NAME || "";
            const builtin = this.getBuiltinWebApiDefinition(method);
            const endpoint = spec.serviceUrl || spec.endpoint || builtin?.endpoint || "";
            const output = spec.output && typeof spec.output === "object" ? spec.output : {};
            const resultTable = output.resultTableName || output.resultTable || spec.resultTableName || spec.resultTable || builtin?.resultTable || "";
            return {
                resourceId: resource.OML_RESOURCE_ID || "",
                method,
                label: resource.RESOURCE_LABEL || resource.RESOURCE_NAME || builtin?.label || method,
                endpoint,
                resultTable,
                specJson: resource.SPEC_JSON || "",
                outputFormat: resource.OUTPUT_FORMAT || builtin?.outputFormat || "",
                params: builtin?.params || []
            };
        },

        handleExecutionSourceChange(value) {
            const source = String(value || "DB_OBJECT").toUpperCase();
            const nextSource = source === "WEB_API" ? "WEB_API" : (source === "OML_PYTHON" ? "OML_PYTHON" : "DB_OBJECT");
            this.currentJob = {
                ...this.currentJob,
                execSourceType: nextSource
            };
            if (nextSource === "DB_OBJECT") {
                this.currentJob.execResourceId = "";
                this.currentJob.execMethod = "";
                this.currentJob.execSpecJson = "";
                this.setFieldValue(`#omlResource-${PAGE_CODE}`, "");
                this.setFieldValue(`#webApiMethod-${PAGE_CODE}`, "");
            } else {
                this.currentJob.execObjectId = "";
                this.currentJob.execOwner = "";
                this.currentJob.execObjectType = nextSource;
                this.currentJob.execObjectName = "";
                this.currentJob.execObjectLabel = "";
                this.setFieldValue(`#execObject-${PAGE_CODE}`, "");
                if (nextSource === "WEB_API") {
                    this.currentJob.execResourceId = "";
                    this.setFieldValue(`#omlResource-${PAGE_CODE}`, "");
                } else {
                    this.setFieldValue(`#webApiMethod-${PAGE_CODE}`, "");
                }
            }
            this.parameters = [];
            this.renderParameters();
            this.renderCurrentJob();
            this.generateExecutablePlsql(true);
        },

        async handleWebApiMethodChange(value) {
            const resource = this.findWebApiResource(value);
            const api = this.getWebApiDefinition(value);
            if (!api) {
                this.currentJob = {
                    ...this.currentJob,
                    execSourceType: "WEB_API",
                    execResourceId: "",
                    execMethod: "",
                    execSpecJson: "",
                    execObjectType: "WEB_API",
                    execObjectName: "",
                    execObjectLabel: ""
                };
                this.parameters = [];
                this.renderParameters();
                this.renderCurrentJob();
                this.generateExecutablePlsql(true);
                return;
            }

            this.currentJob = {
                ...this.currentJob,
                execSourceType: "WEB_API",
                execResourceId: api.resourceId || resource?.OML_RESOURCE_ID || "",
                execMethod: api.method,
                execSpecJson: api.specJson || JSON.stringify({ endpoint: api.endpoint || "" }),
                execObjectId: "",
                execOwner: "",
                execObjectType: "WEB_API",
                execObjectName: api.method,
                execObjectLabel: api.label,
                resultCreateYn: "T",
                resultOwner: this.currentJob?.resultOwner || this.getDefaultResultOwner(),
                resultTableName: api.resultTable || this.currentJob?.resultTableName || ""
            };
            this.parameters = api.params.map((row, index) => ({ ...row, itemOrder: index + 1 }));
            this.renderParameters();
            this.renderCurrentJob();
            if (api.resourceId || resource?.OML_RESOURCE_ID) {
                await this.loadWebApiParameters(api.resourceId || resource.OML_RESOURCE_ID);
            }
            this.generateExecutablePlsql(true);
        },

        getWebApiDefinition(method) {
            const resource = this.findWebApiResource(method);
            if (resource) return this.createWebApiDefinitionFromResource(resource);
            return this.getBuiltinWebApiDefinition(method);
        },

        getBuiltinWebApiDefinition(method) {
            const targetOwner = ":INIT$TargetOwner";
            const targetTable = ":INIT$TargetTable";
            const runSourceType = ":INIT$RunSourceType";
            const runId = ":INIT$RunId";
            const definitions = {
                LASSO_FEATURE_SELECT: {
                    method: "LASSO_FEATURE_SELECT",
                    label: "LASSO Feature Select",
                    endpoint: "/api/mlAnalysis/lasso-feature-select",
                    resultTable: "INIT$_TB_LASSO_FEATURE",
                    params: [
                        { itemName: "P_TARGET_OWNER", itemValue: "VARCHAR2", itemDesc: "분석 대상 테이블 계정", itemDefault: targetOwner },
                        { itemName: "P_TARGET_TABLE", itemValue: "VARCHAR2", itemDesc: "분석 대상 테이블명", itemDefault: targetTable },
                        { itemName: "P_TARGET_COLUMN", itemValue: "VARCHAR2", itemDesc: "종속변수 컬럼명", itemDefault: "(auto)" },
                        { itemName: "P_MAX_FEATURES", itemValue: "NUMBER", itemDesc: "선택할 최대 독립변수 수", itemDefault: "10" },
                        { itemName: "P_SAMPLE_ROWS", itemValue: "NUMBER", itemDesc: "분석 샘플 최대 행 수", itemDefault: "100000" },
                        { itemName: "P_ALPHA", itemValue: "NUMBER", itemDesc: "LASSO alpha. 비우면 교차검증 자동 선택", itemDefault: "" },
                        { itemName: "P_MAX_AUTO_TARGETS", itemValue: "NUMBER", itemDesc: "자동 target 최대 개수", itemDefault: "10" },
                        { itemName: "P_CONTINUE_ON_ERROR", itemValue: "VARCHAR2", itemDesc: "자동 target 일부 실패 시 계속 실행 여부", itemDefault: "Y" },
                        { itemName: "P_RUN_SOURCE_TYPE", itemValue: "VARCHAR2", itemDesc: "실행 출처 구분(DATA_WORK/FLOW_WORK)", itemDefault: runSourceType },
                        { itemName: "P_RUN_ID", itemValue: "NUMBER", itemDesc: "시나리오 공용 DATA_WORK 실행 ID", itemDefault: runId }
                    ]
                },
                SYMBOLIC_REGRESSION_RULE: {
                    method: "SYMBOLIC_REGRESSION_RULE",
                    label: "Symbolic Regression Rule",
                    endpoint: "/api/mlAnalysis/symbolic-regression-rule",
                    resultTable: "INIT$_TB_SYMBOLIC_RULE",
                    params: [
                        { itemName: "P_TARGET_OWNER", itemValue: "VARCHAR2", itemDesc: "분석 대상 테이블 계정", itemDefault: targetOwner },
                        { itemName: "P_TARGET_TABLE", itemValue: "VARCHAR2", itemDesc: "분석 대상 테이블명", itemDefault: targetTable },
                        { itemName: "P_TARGET_COLUMN", itemValue: "VARCHAR2", itemDesc: "종속변수 컬럼명", itemDefault: "(auto)" },
                        { itemName: "P_MAX_FEATURES", itemValue: "NUMBER", itemDesc: "Symbolic Regression 입력 독립변수 최대 수", itemDefault: "10" },
                        { itemName: "P_SAMPLE_ROWS", itemValue: "NUMBER", itemDesc: "분석 샘플 최대 행 수", itemDefault: "50000" },
                        { itemName: "P_MAX_ITERATIONS", itemValue: "NUMBER", itemDesc: "Symbolic 탐색 최대 반복 수", itemDefault: "10000" },
                        { itemName: "P_USE_PYSR", itemValue: "VARCHAR2", itemDesc: "PySR 사용 여부(Y/N). N이면 polynomial LASSO fallback 사용", itemDefault: "N" },
                        { itemName: "P_MIN_R2_SCORE", itemValue: "NUMBER", itemDesc: "Symbolic Regression에 사용할 LASSO 최소 R2 점수", itemDefault: "0.7" },
                        { itemName: "P_MAX_AUTO_TARGETS", itemValue: "NUMBER", itemDesc: "자동 target 최대 개수", itemDefault: "10" },
                        { itemName: "P_CONTINUE_ON_ERROR", itemValue: "VARCHAR2", itemDesc: "자동 target 일부 실패 시 계속 실행 여부", itemDefault: "Y" },
                        { itemName: "P_RUN_SOURCE_TYPE", itemValue: "VARCHAR2", itemDesc: "실행 출처 구분(DATA_WORK/FLOW_WORK)", itemDefault: runSourceType },
                        { itemName: "P_RUN_ID", itemValue: "NUMBER", itemDesc: "시나리오 공용 DATA_WORK 실행 ID", itemDefault: runId }
                    ]
                }
            };
            return definitions[String(method || "").toUpperCase()] || null;
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
            this.syncRegisteredResultInfo();
            this.parameters = [];
            this.renderParameters();
            await this.loadParameters(object.OBJECT_ID);
            this.renderCurrentJob();
        },

        async handleOmlResourceChange(resourceId) {
            const resource = this.omlResources.find((row) => String(row.OML_RESOURCE_ID) === String(resourceId));
            if (!resource) {
                this.currentJob = {
                    ...this.currentJob,
                    execSourceType: "OML_PYTHON",
                    execResourceId: "",
                    execMethod: "",
                    execSpecJson: "",
                    execObjectType: "OML_PYTHON",
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
                execSourceType: "OML_PYTHON",
                execResourceId: resource.OML_RESOURCE_ID,
                execMethod: resource.EXEC_METHOD || "",
                execSpecJson: resource.SPEC_JSON || "",
                execObjectId: "",
                execOwner: resource.SCRIPT_OWNER || "",
                execObjectType: "OML_PYTHON",
                execObjectName: resource.RESOURCE_NAME || resource.SCRIPT_NAME || "",
                execObjectLabel: resource.RESOURCE_LABEL || resource.RESOURCE_NAME || resource.SCRIPT_NAME || ""
            };
            this.parameters = [];
            this.renderParameters();
            await this.loadOmlParameters(resource.OML_RESOURCE_ID);
            this.renderCurrentJob();
            this.generateExecutablePlsql(true);
        },

        async loadParameters(objectId, options = {}) {
            const generateAfterLoad = options.generateAfterLoad !== false;
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
                if (generateAfterLoad) this.generateExecutablePlsql(true);
            } catch (error) {
                this.parameters = [];
                if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Parameter load failed.")}</div>`;
            }
        },

        async loadOmlParameters(resourceId) {
            const container = getContainerEl(`#parameterGrid-${PAGE_CODE}`);
            if (container) container.innerHTML = `<div class="table-empty">Loading OML4Py parameters...</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/oml-resource/${resourceId}/parameters`, { method: "GET", showLoading: false });
                const resource = json.resource || {};
                if (resource.OML_RESOURCE_ID) {
                    const cachedResource = this.omlResources.find((row) => String(row.OML_RESOURCE_ID) === String(resource.OML_RESOURCE_ID));
                    if (cachedResource) Object.assign(cachedResource, resource);
                    this.currentJob = {
                        ...this.currentJob,
                        execResourceId: resource.OML_RESOURCE_ID,
                        execMethod: resource.EXEC_METHOD || this.currentJob?.execMethod || "",
                        execSpecJson: resource.SPEC_JSON || "",
                        execObjectName: resource.RESOURCE_NAME || resource.SCRIPT_NAME || this.currentJob?.execObjectName || "",
                        execObjectLabel: resource.RESOURCE_LABEL || resource.RESOURCE_NAME || resource.SCRIPT_NAME || this.currentJob?.execObjectLabel || ""
                    };
                }
                this.parameters = (Array.isArray(json.data) ? json.data : []).map((row) => ({
                    itemName: row.itemName || "",
                    itemValue: row.itemValue || "",
                    itemDesc: row.itemDesc || "",
                    itemDefault: row.itemDefault || "",
                    itemOrder: row.itemOrder ?? "",
                    bindName: row.bindName || ""
                }));
                this.renderParameters();
            } catch (error) {
                this.parameters = [];
                if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "OML4Py parameter load failed.")}</div>`;
            }
        },

        async loadWebApiParameters(resourceId) {
            const container = getContainerEl(`#parameterGrid-${PAGE_CODE}`);
            if (container) container.innerHTML = `<div class="table-empty">Loading Python API parameters...</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/oml-resource/${resourceId}/parameters`, { method: "GET", showLoading: false });
                const resource = json.resource || {};
                const api = this.createWebApiDefinitionFromResource(resource);
                if (api?.resourceId) {
                    const cachedResource = this.omlResources.find((row) => String(row.OML_RESOURCE_ID) === String(api.resourceId));
                    if (cachedResource) Object.assign(cachedResource, resource);
                    this.currentJob = {
                        ...this.currentJob,
                        execSourceType: "WEB_API",
                        execResourceId: api.resourceId,
                        execMethod: api.method || this.currentJob?.execMethod || "",
                        execSpecJson: api.specJson || "",
                        execObjectId: "",
                        execOwner: "",
                        execObjectType: "WEB_API",
                        execObjectName: resource.RESOURCE_NAME || api.method || this.currentJob?.execObjectName || "",
                        execObjectLabel: api.label || resource.RESOURCE_NAME || this.currentJob?.execObjectLabel || "",
                        resultCreateYn: "T",
                        resultOwner: this.currentJob?.resultOwner || this.getDefaultResultOwner(),
                        resultTableName: api.resultTable || this.currentJob?.resultTableName || ""
                    };
                }
                this.parameters = (Array.isArray(json.data) ? json.data : []).map((row) => ({
                    itemName: row.itemName || "",
                    itemValue: row.itemValue || "",
                    itemDesc: row.itemDesc || "",
                    itemDefault: row.itemDefault || "",
                    itemOrder: row.itemOrder ?? "",
                    bindName: row.bindName || ""
                }));
                this.renderParameters();
                this.renderCurrentJob();
            } catch (error) {
                this.parameters = [];
                if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Python API parameter load failed.")}</div>`;
            }
        },

        async refreshParameters() {
            const selectedSourceType = getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || "";
            const sourceType = String(this.currentJob?.execSourceType || selectedSourceType || "DB_OBJECT").toUpperCase();
            const button = getContainerEl(`#refreshParametersButton-${PAGE_CODE}`);
            const icon = button?.querySelector("i");
            button?.setAttribute("disabled", "disabled");
            icon?.classList.add("fa-spin");
            try {
                if (sourceType === "WEB_API") {
                    const resourceId = this.currentJob?.execResourceId || getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value || "";
                    if (!resourceId) {
                        this.parameters = [];
                        this.renderParameters();
                        CommonMessage.warning?.("Select a Python API resource first.");
                        return;
                    }
                    const api = this.getWebApiDefinition(resourceId);
                    if (api?.resourceId) {
                        await this.loadWebApiParameters(api.resourceId);
                    } else if (api) {
                        this.parameters = api.params.map((row, index) => ({ ...row, itemOrder: index + 1 }));
                        this.renderParameters();
                    } else {
                        this.parameters = [];
                        this.renderParameters();
                        CommonMessage.warning?.("Select a Python API resource first.");
                    }
                } else if (sourceType === "OML_PYTHON") {
                    const resourceId = this.currentJob?.execResourceId || getContainerEl(`#omlResource-${PAGE_CODE}`)?.value || "";
                    if (!resourceId) {
                        this.parameters = [];
                        this.renderParameters();
                        CommonMessage.warning?.("Select an OML4Py resource first.");
                        return;
                    }
                    await this.loadOmlParameters(resourceId);
                } else {
                    const objectId = this.currentJob?.execObjectId || getContainerEl(`#execObject-${PAGE_CODE}`)?.value || "";
                    if (!objectId) {
                        this.parameters = [];
                        this.renderParameters();
                        CommonMessage.warning?.("Select a DB object first.");
                        return;
                    }
                    await this.loadExecutableObjects();
                    this.syncRegisteredResultInfo();
                    await this.loadParameters(objectId, { generateAfterLoad: false });
                }
                CommonMessage.success?.("Parameters refreshed.", { copyable: false });
            } catch (error) {
                CommonMessage.error(error.message || "Parameter refresh failed.");
            } finally {
                button?.removeAttribute("disabled");
                icon?.classList.remove("fa-spin");
            }
        },

        renderParameters() {
            const container = getContainerEl(`#parameterGrid-${PAGE_CODE}`);
            if (!container) return;
            this.renderUserSqlJobContext();
            this.renderSelectedResourceMeta();

            if (!this.parameters.length) {
                const sourceType = String(this.currentJob?.execSourceType || "DB_OBJECT").toUpperCase();
                const emptyMessage = sourceType === "WEB_API"
                    ? "No registered parameters. Check M90002 Python API resource registration."
                    : sourceType === "OML_PYTHON"
                    ? "No registered parameters. Check M90002 OML4Py resource registration."
                    : "No registered parameters. Check M90001 object detail registration.";
                container.innerHTML = `<div class="table-empty">${this.escapeHtml(emptyMessage)}</div>${this.renderListFooter(0)}`;
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

        getSelectedResourceMeta() {
            const job = this.currentJob || {};
            const sourceType = String(job.execSourceType || getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || "DB_OBJECT").toUpperCase();
            if (sourceType === "OML_PYTHON") {
                const selectedResourceId = job.execResourceId || getContainerEl(`#omlResource-${PAGE_CODE}`)?.value || "";
                const resource = this.omlResources.find((row) => String(row.OML_RESOURCE_ID || "") === String(selectedResourceId)) || {};
                return {
                    objectType: job.execObjectType || "OML_PYTHON",
                    objectName: job.execObjectName || resource.RESOURCE_NAME || resource.SCRIPT_NAME || job.execObjectLabel || ""
                };
            }

            if (sourceType === "WEB_API") {
                const selectedResourceId = job.execResourceId || getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value || "";
                const resource = this.findWebApiResource(selectedResourceId || job.execMethod) || {};
                return {
                    objectType: job.execObjectType || "WEB_API",
                    objectName: job.execObjectName || resource.RESOURCE_NAME || resource.EXEC_METHOD || job.execObjectLabel || ""
                };
            }

            const selectedObjectId = job.execObjectId || getContainerEl(`#execObject-${PAGE_CODE}`)?.value || "";
            const object = this.executableObjects.find((row) => String(row.OBJECT_ID || "") === String(selectedObjectId)) || {};
            return {
                objectType: job.execObjectType || object.OBJECT_TYPE || "",
                objectName: job.execObjectName || object.OBJECT_NAME || job.execObjectLabel || ""
            };
        },

        renderSelectedResourceMeta() {
            const container = getContainerEl(`#selectedResourceMeta-${PAGE_CODE}`);
            if (!container) return;
            const meta = this.getSelectedResourceMeta();
            const objectType = String(meta.objectType || "").trim();
            const objectName = String(meta.objectName || "").trim();
            if (!objectType && !objectName) {
                container.hidden = true;
                container.innerHTML = "";
                return;
            }
            container.hidden = false;
            const metaText = `${objectType || "-"} · ${objectName || "-"}`;
            container.innerHTML = `
                <b title="${this.escapeHtml(metaText)}">
                    <span class="data-object-meta-type">${this.escapeHtml(objectType || "-")}</span>
                    <input
                        class="data-object-meta-name"
                        type="text"
                        value="${this.escapeAttr(objectName || "-")}"
                        readonly
                        ondblclick="this.select()"
                        aria-label="Selected object name"
                    >
                </b>
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
                await this.selectFirstJobAfterLoad();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Job load failed.")}</div>`;
            }
        },

        async selectFirstJobAfterLoad() {
            if (!Array.isArray(this.jobs) || !this.jobs.length) return false;
            const selectedExists = this.selectedJobId
                && this.jobs.some((job) => String(job.PROFILE_JOB_ID || "") === String(this.selectedJobId));
            if (selectedExists) return false;
            const firstJob = this.jobs.find((job) => job.PROFILE_JOB_ID);
            if (!firstJob) return false;
            await this.selectJob(String(firstJob.PROFILE_JOB_ID), false);
            return true;
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
                await this.applyJob(json.data || {});
            } catch (error) {
                alert(error.message || "Job load failed.");
            }
        },

        async applyJob(job) {
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
                execSourceType: job.EXEC_SOURCE_TYPE || "DB_OBJECT",
                execResourceId: job.EXEC_RESOURCE_ID || "",
                execMethod: job.EXEC_METHOD || "",
                execSpecJson: job.EXEC_SPEC_JSON || "",
                execObjectId: job.EXEC_OBJECT_ID || "",
                execOwner: job.EXEC_OWNER || "",
                execObjectType: job.EXEC_OBJECT_TYPE || "",
                execObjectName: job.EXEC_OBJECT_NAME || "",
                execObjectLabel: job.EXEC_OBJECT_LABEL || "",
                useYn: job.USE_YN || "Y",
                sortOrder: job.SORT_ORDER ?? "",
                execPlsql: job.EXEC_PLSQL || "",
                resultCreateYn: this.normalizeResultCreateMode(job.RESULT_CREATE_YN || "N"),
                resultOwner: job.RESULT_OWNER || "",
                resultTableName: job.RESULT_TABLE_NAME || "",
                status: job.STATUS || "DRAFT"
            };
            this.parameters = Array.isArray(job.PARAMS) ? job.PARAMS.map((row) => ({
                itemName: row.itemName || row.ITEM_NAME || "",
                itemValue: row.itemValue || row.ITEM_VALUE || "",
                itemDesc: row.itemDesc || row.ITEM_DESC || "",
                itemDefault: row.itemDefault || row.ITEM_DEFAULT || "",
                itemOrder: row.itemOrder || row.ITEM_ORDER || "",
                bindName: row.bindName || row.BIND_NAME || ""
            })) : [];
            this.savedJobSnapshot = {
                ...this.currentJob,
                parameters: this.cloneParameterRows(this.parameters)
            };
            this.selectedScenarioTableKey = job.SCENARIO_TABLE_ID ? `ID:${job.SCENARIO_TABLE_ID}` : "";
            this.renderScenarioTables();
            this.renderJobs();
            this.renderCurrentJob();
            this.updateWorkContextSummary();
            this.renderParameters();
            this.resetEditableDataGrid();
            this.setEditorValue(`#execPlsqlEditor-${PAGE_CODE}`, job.EXEC_PLSQL || "");
            this.setFieldValue(`#resultQueryTable-${PAGE_CODE}`, job.RESULT_TABLE_NAME || "");
            await this.setResultTableSql(job.RESULT_TABLE_NAME || "", job.RESULT_OWNER || "", this.currentJob.resultCreateYn || "N");
            await this.setDefaultUserSql(false);
        },

        newJob() {
            this.selectedJobId = "";
            const selectedTable = this.getSelectedScenarioTable();
            this.currentJob = this.createEmptyJob();
            this.savedJobSnapshot = null;
            this.parameters = [];
            this.resetEditableDataGrid();
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
            if (["ownerName", "tableName", "resultOwner", "resultTableName", "resultCreateYn"].includes(field)) {
                this.resetEditableDataGrid();
            }
            this.renderUserSqlJobContext();
        },

        cloneParameterRows(rows = []) {
            return (rows || []).map((row) => ({ ...row }));
        },

        getSavedJobSnapshot() {
            return this.savedJobSnapshot?.profileJobId ? this.savedJobSnapshot : null;
        },

        handleResultCreateChange(value) {
            if (this.syncRegisteredResultInfo()) {
                return;
            }
            const createMode = this.normalizeResultCreateMode(value);
            this.updateCurrentJobField("resultCreateYn", createMode);
            if (createMode !== "N") {
                this.applyDefaultResultOwner();
            }
            this.syncResultFields();
            this.updateResultModeLabels();
            if (createMode !== "N") {
                getContainerEl(`#resultTable-${PAGE_CODE}`)?.focus();
            }
        },

        normalizeResultCreateMode(value) {
            const mode = String(value || "N").trim().toUpperCase();
            if (mode === "Y") return "T";
            return ["N", "T", "M"].includes(mode) ? mode : "N";
        },

        isResultObjectMode(value) {
            return this.normalizeResultCreateMode(value) !== "N";
        },

        isResultTableMode(value) {
            return this.normalizeResultCreateMode(value) === "T";
        },

        isResultModelMode(value) {
            return this.normalizeResultCreateMode(value) === "M";
        },

        applyDefaultResultOwner() {
            const resultOwnerField = getContainerEl(`#resultOwner-${PAGE_CODE}`);
            const currentValue = resultOwnerField?.value.trim() || this.currentJob?.resultOwner || "";
            if (currentValue) return;
            const targetOwner = getContainerEl(`#targetOwner-${PAGE_CODE}`)?.value.trim() || this.currentJob?.ownerName || "";
            if (!targetOwner) return;
            this.updateCurrentJobField("resultOwner", targetOwner);
            this.setFieldValue(`#resultOwner-${PAGE_CODE}`, targetOwner);
        },

        getDefaultResultOwner() {
            return getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim()
                || getContainerEl(`#targetOwner-${PAGE_CODE}`)?.value.trim()
                || this.currentJob?.resultOwner
                || this.currentJob?.ownerName
                || "";
        },

        syncResultFields() {
            const createMode = this.normalizeResultCreateMode(getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || this.currentJob?.resultCreateYn || "N");
            const registeredResult = this.getRegisteredResultInfo();
            const disabled = createMode === "N" || (Boolean(registeredResult) && createMode !== "M");
            const createField = getContainerEl(`#resultCreateYn-${PAGE_CODE}`);
            if (createField) createField.disabled = Boolean(registeredResult);
            [`#resultOwner-${PAGE_CODE}`, `#resultTable-${PAGE_CODE}`].forEach((selector) => {
                const field = getContainerEl(selector);
                if (field) field.disabled = disabled;
            });
        },

        updateResultModeLabels() {
            const createMode = this.normalizeResultCreateMode(getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || this.currentJob?.resultCreateYn || "N");
            const createTitle = getContainerEl(`#resultCreateTitle-${PAGE_CODE}`);
            const tableTitle = getContainerEl(`#resultTableTitle-${PAGE_CODE}`);
            const tableField = getContainerEl(`#resultTable-${PAGE_CODE}`);
            const labels = {
                N: {
                    createTitle: "Result Use",
                    tableTitle: "Result Table",
                    placeholder: "RESULT_TABLE"
                },
                T: {
                    createTitle: "Result Table Create",
                    tableTitle: "Result Table",
                    placeholder: "RESULT_TABLE"
                },
                M: {
                    createTitle: "Result Model Create",
                    tableTitle: "Result Model",
                    placeholder: "MODEL_NAME"
                }
            };
            const label = labels[createMode] || labels.N;
            if (createTitle) createTitle.textContent = label.createTitle;
            if (tableTitle) tableTitle.textContent = label.tableTitle;
            if (tableField) tableField.setAttribute("placeholder", label.placeholder);
        },

        renderCurrentJob() {
            const job = this.currentJob || this.createEmptyJob();
            const titleSuffix = job.profileJobId
                ? (job.jobName || "(Untitled job)")
                : "New Job";
            this.setText(`#work-title-${PAGE_CODE}`, titleSuffix);
            this.syncRunButtons();
            this.setFieldValue(`#workJobId-${PAGE_CODE}`, job.profileJobId || "NEW");
            this.setFieldValue(`#workJobGroup-${PAGE_CODE}`, DEFAULT_JOB_GROUP);
            this.setFieldValue(`#workJobName-${PAGE_CODE}`, job.jobName || "");
            this.setFieldValue(`#workJobDesc-${PAGE_CODE}`, job.jobDesc || "");
            this.setFieldValue(`#targetOwner-${PAGE_CODE}`, job.ownerName || "");
            this.setFieldValue(`#targetTable-${PAGE_CODE}`, job.tableName || "");
            this.setFieldValue(`#jobUseYn-${PAGE_CODE}`, job.useYn || "Y");
            this.setFieldValue(`#jobSortOrder-${PAGE_CODE}`, job.sortOrder ?? "");
            this.setFieldValue(`#execSourceType-${PAGE_CODE}`, job.execSourceType || "DB_OBJECT");
            this.setFieldValue(`#execObject-${PAGE_CODE}`, job.execObjectId || "");
            this.setFieldValue(`#omlResource-${PAGE_CODE}`, job.execResourceId || "");
            this.setFieldValue(
                `#webApiMethod-${PAGE_CODE}`,
                String(job.execSourceType || "").toUpperCase() === "WEB_API"
                    ? (job.execResourceId || this.findWebApiResource(job.execMethod || job.execObjectName)?.OML_RESOURCE_ID || "")
                    : ""
            );
            this.setFieldValue(`#resultCreateYn-${PAGE_CODE}`, this.normalizeResultCreateMode(job.resultCreateYn || "N"));
            this.setFieldValue(`#resultOwner-${PAGE_CODE}`, job.resultOwner || "");
            this.setFieldValue(`#resultTable-${PAGE_CODE}`, job.resultTableName || "");
            this.setFieldValue(`#resultQueryTable-${PAGE_CODE}`, job.resultTableName || "");
            if (this.isResultObjectMode(job.resultCreateYn || "N")) {
                this.applyDefaultResultOwner();
            }
            this.setText(`#selectedExecObjectLabel-${PAGE_CODE}`, job.execObjectLabel || job.execObjectName || this.getLabel("noExecutableObject"));
            this.syncExecutionSourceFields();
            this.syncResultFields();
            this.updateResultModeLabels();
            const desc = job.ownerName && job.tableName
                ? `${job.ownerName}.${job.tableName}`
                : this.getLabel("workDescriptionEmpty");
            this.setText(`#workDescription-${PAGE_CODE}`, desc);
            this.renderDataEditTarget();
            this.renderUserSqlJobContext();
        },

        hasUserSqlJobContext() {
            const job = this.currentJob || {};
            return Boolean(
                job.profileJobId
                || job.ownerName
                || job.tableName
                || job.execObjectId
                || job.execResourceId
                || (this.parameters || []).length
            );
        },

        renderUserSqlJobContext() {
            const container = getContainerEl(`#userSqlJobContext-${PAGE_CODE}`);
            if (!container) return;
            const job = this.currentJob || {};
            if (!this.hasUserSqlJobContext()) {
                container.className = "data-user-sql-context is-empty";
                container.innerHTML = `
                    <strong>No Data Work job context</strong>
                    <span>User SQL runtime binds will not use Data Work parameter defaults or system job values.</span>
                `;
                return;
            }
            const target = job.ownerName && job.tableName ? `${job.ownerName}.${job.tableName}` : "-";
            const resultMode = this.normalizeResultCreateMode(job.resultCreateYn || "N");
            const resultObject = this.isResultObjectMode(resultMode) && job.resultOwner && job.resultTableName
                ? `${job.resultOwner}.${job.resultTableName}`
                : "N/A";
            container.className = "data-user-sql-context";
            container.innerHTML = `
                <strong>${this.escapeHtml(job.jobName || `Job #${job.profileJobId}`)}</strong>
                <span>${job.profileJobId ? `Job ID: ${this.escapeHtml(job.profileJobId)}` : "Draft job context"}</span>
                <span>Target: ${this.escapeHtml(target)}</span>
                <span>Result: ${this.escapeHtml(resultMode)} / ${this.escapeHtml(resultObject)}</span>
            `;
        },

        syncRunButtons() {
            const enabled = Boolean(this.currentJob?.profileJobId);
            const running = this.isJobExecutionActive();
            const saveButton = getContainerEl(`#saveJob-${PAGE_CODE}`);
            if (saveButton) saveButton.disabled = running;
            [`#runNow-${PAGE_CODE}`, `#queueBatch-${PAGE_CODE}`, `#testDraft-${PAGE_CODE}`, `#deleteJob-${PAGE_CODE}`].forEach((selector) => {
                const button = getContainerEl(selector);
                if (button) button.disabled = !enabled || running;
            });
        },

        isJobExecutionActive() {
            return (this.jobs || []).some((job) => Boolean(job._RUN_PROGRESS));
        },

        syncExecutionSourceFields() {
            const sourceType = getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || this.currentJob?.execSourceType || "DB_OBJECT";
            const normalizedSource = String(sourceType).toUpperCase();
            const isOml = normalizedSource === "OML_PYTHON";
            const isWebApi = normalizedSource === "WEB_API";
            const execObject = getContainerEl(`#execObject-${PAGE_CODE}`);
            const omlWrap = getContainerEl(`#omlResourceWrap-${PAGE_CODE}`);
            const omlResource = getContainerEl(`#omlResource-${PAGE_CODE}`);
            const webApiWrap = getContainerEl(`#webApiWrap-${PAGE_CODE}`);
            const webApiMethod = getContainerEl(`#webApiMethod-${PAGE_CODE}`);
            if (execObject) execObject.closest("label").hidden = isOml || isWebApi;
            if (omlWrap) omlWrap.hidden = !isOml;
            if (omlResource) omlResource.disabled = !isOml;
            if (webApiWrap) webApiWrap.hidden = !isWebApi;
            if (webApiMethod) webApiMethod.disabled = !isWebApi;
            this.syncExecutableScriptUi(isOml, isWebApi);
        },

        syncExecutableScriptUi(isOml = false, isWebApi = false) {
            const title = getContainerEl(`#generatedScriptTitle-${PAGE_CODE}`);
            const generateLabel = getContainerEl(`#generateScriptLabel-${PAGE_CODE}`);
            const helpButton = getContainerEl(`#scriptHelpButton-${PAGE_CODE}`);
            const helpTitle = getContainerEl(`#plsqlHelpTitle-${PAGE_CODE}`);
            const helpContent = getContainerEl(`#scriptHelpContent-${PAGE_CODE}`);

            if (title) title.textContent = isWebApi ? "Generated Web API spec" : (isOml ? "Generated OML SQL" : (this.getLabel("generatedScript") || "Generated PL/SQL"));
            if (generateLabel) generateLabel.textContent = isWebApi ? "Generate API spec" : (isOml ? "Generate OML SQL" : (this.getLabel("generateScript") || "Generate PL/SQL"));
            if (helpButton) helpButton.setAttribute("title", isWebApi ? "WAS Python API rules" : (isOml ? "OML4Py SQL API rules" : "PL/SQL bind variable rules"));
            if (helpTitle) helpTitle.textContent = isWebApi ? "WAS Python API 실행 규칙" : (isOml ? "OML4Py SQL API 실행 규칙" : "PL/SQL 바인드 변수 규칙");
            if (!helpContent) return;

            helpContent.innerHTML = isWebApi
                ? `
                    <p>Web API 선택 시 실행은 Oracle PL/SQL이 아니라 WAS 서버의 Python 분석 API로 위임됩니다.</p>
                    <ul>
                        <li><strong>LASSO Feature Select</strong>: 연속형 상관분석 결과를 후보로 사용하고, 종속변수에 영향이 큰 독립변수를 <code>INIT$_TB_LASSO_FEATURE</code>에 적재합니다.</li>
                        <li><strong>Symbolic Regression Rule</strong>: LASSO에서 선택된 상위 5~10개 변수만 사용해 수식 규칙을 탐색하고 <code>INIT$_TB_SYMBOLIC_RULE</code>에 적재합니다.</li>
                        <li><strong>Symbolic Rule Violation</strong>: 수식 규칙의 예측값 대비 허용 오차율을 벗어난 행은 <code>INIT$_TB_SYMBOLIC_RULE_VIOLATION</code>에서 확인합니다.</li>
                        <li><strong>주의</strong>: Symbolic Regression은 계산량이 크므로 <code>P_MAX_FEATURES</code>는 10 이하로 제한됩니다.</li>
                    </ul>
                `
                : isOml
                ? `
                    <p>OML Python 선택 시 생성되는 스크립트는 PL/SQL 블록이 아니라 Autonomous Database Embedded Python Execution SQL API 호출 SQL입니다.</p>
                    <ul>
                        <li><strong>실행 함수</strong>: 등록된 OML4Py Resource의 Exec Method에 따라 <code>pyqEval</code>, <code>pyqTableEval</code>, <code>pyqRowEval</code> 같은 SQL API를 사용합니다.</li>
                        <li><strong>입력 데이터</strong>: 테이블 입력 방식은 현재 Owner/Table을 <code>CURSOR(SELECT * FROM OWNER.TABLE)</code> 형태로 전달합니다.</li>
                        <li><strong>Parameter List</strong>: 파라미터는 <code>par_lst =&gt; JSON_OBJECT(... RETURNING CLOB)</code>로 생성됩니다. 기본값이 있으면 값이 직접 들어가고, 기본값이 없으면 <code>:abcDef</code> 형식의 런타임 바인드 변수로 생성됩니다.</li>
                        <li><strong>Result Table Create</strong>: T이면 생성 SQL이 <code>CREATE TABLE OWNER.TABLE AS SELECT ...</code> 형태로 바뀌고, M이면 결과명을 모델명으로 사용합니다.</li>
                        <li><strong>Run saved work / Queue saved work</strong>: 저장된 Parameter List와 저장된 Job 설정을 실행합니다. <strong>Test current draft</strong>는 현재 화면값을 저장하지 않고 1회 실행합니다.</li>
                    </ul>
                `
                : `
                    <p class="data-help-summary">Generate PL/SQL은 Parameter List의 Default 값을 먼저 확인한 뒤, 필요한 바인드 변수를 자동으로 만듭니다.</p>
                    <div class="data-help-flow">
                        <section class="data-help-step">
                            <strong>1. Default에 <code>:</code>가 있으면 그대로 사용</strong>
                            <span><code>:INIT$TargetOwner</code> -> <code>P_TARGET_OWNER =&gt; :INIT$TargetOwner</code></span>
                        </section>
                        <section class="data-help-step">
                            <strong>2. Default에 <code>:</code>가 없으면 Parameter명을 camelCase로 변환</strong>
                            <span><code>P_DYNAMIC_MODEL_NAME</code> -> <code>:pDynamicModelName</code></span>
                        </section>
                        <section class="data-help-step">
                            <strong>3. 실행 시 실제 값으로 바인딩</strong>
                            <span>Run saved work / Queue saved work는 저장된 Work를 실행하고, Test current draft는 현재 화면값을 저장하지 않고 1회 실행합니다.</span>
                        </section>
                        <section class="data-help-step">
                            <strong>4. Result 정보는 선택된 등록 오브젝트 기준으로 동기화</strong>
                            <span><code>T</code>는 M90001에 등록된 Result Table을 사용하고, <code>M</code>은 화면의 Result Model 입력값을 사용합니다.</span>
                        </section>
                    </div>
                    <h3>자동 예약 변수</h3>
                    <div class="data-help-token-grid">
                        <span><code>:INIT$TargetOwner</code><small>현재 Target Owner</small></span>
                        <span><code>:INIT$TargetTable</code><small>현재 Target Table</small></span>
                        <span><code>:INIT$ResultOwner</code><small>현재 Result Owner</small></span>
                        <span><code>:INIT$ResultTable</code><small>현재 Result Table 또는 Result Model 입력값</small></span>
                        <span><code>:INIT$ResultModelName</code><small>Result Model 입력값을 기본값으로 사용</small></span>
                        <span><code>:INIT$RunSourceType</code><small>DATA_WORK/FLOW_WORK</small></span>
                        <span><code>:INIT$RunId</code><small><code>(auto)</code>면 자동 발급, 숫자면 수동 실행 ID</small></span>
                    </div>
                    <p class="data-help-summary">Result Table Create가 <code>T</code>이면 Result Owner/Table은 등록값으로 고정됩니다. <code>M</code>이면 Result Owner와 Result Model을 사용자가 수정할 수 있고, <code>:INIT$ResultModelName</code>은 그 Result Model 값을 기본값으로 표시합니다.</p>
                    <h3>생성 예시</h3>
                    <pre class="data-help-code"><code>P_TARGET_OWNER       =&gt; :INIT$TargetOwner
P_TARGET_TABLE       =&gt; :INIT$TargetTable
P_MODEL_NAME         =&gt; :INIT$ResultModelName
P_RUN_SOURCE_TYPE    =&gt; :INIT$RunSourceType
P_RUN_ID             =&gt; :INIT$RunId
P_DYNAMIC_MODEL_NAME =&gt; :pDynamicModelName
P_PREDICTION_METHOD  =&gt; :pPredictionMethod</code></pre>
                `;
        },

        toggleScriptWrapMode() {
            this.scriptWrapMode = !this.scriptWrapMode;
            this.syncScriptWrapMode();
        },

        syncScriptWrapMode() {
            const editor = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`);
            const button = getContainerEl(`#scriptWrapToggle-${PAGE_CODE}`);
            const enabled = Boolean(this.scriptWrapMode);
            if (editor) {
                editor.classList.toggle("is-wrap-mode", enabled);
                editor.setAttribute("wrap", enabled ? "soft" : "off");
            }
            if (button) {
                button.classList.toggle("is-active", enabled);
                button.setAttribute("aria-pressed", String(enabled));
                button.setAttribute("title", enabled ? "표시 모드: 자동 줄바꿈" : "표시 모드: 한 줄 표시");
                const icon = button.querySelector("i");
                if (icon) icon.className = enabled ? "fas fa-align-justify" : "fas fa-align-left";
            }
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
                project ? `Project: ${CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || "-")}` : "Project: -",
                scenario ? `Scenario: ${CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "-")}` : "Scenario: -",
                table ? `Table: ${table.OWNER_NAME || "-"}.${table.TABLE_NAME || "-"}` : "Table: -"
            ];
            this.setText(`#workContextSummary-${PAGE_CODE}`, parts.join(" | "));
            this.updateJobsTitle(scenario);
        },

        updateJobsTitle(scenario = null) {
            const scenarioName = scenario ? CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "") : "";
            this.setText(`#jobs-title-${PAGE_CODE}`, scenarioName || "");
        },

        async saveJob(showAlert = true) {
            if (this.isJobExecutionActive()) {
                alert("A job is running. Please wait until execution finishes.");
                return null;
            }
            if (!this.ensureJobReady(false)) return null;
            if (!this.ensureExecutableScriptReady()) return null;
            if (showAlert && !(await CommonMessage.confirm("Save this work?"))) return null;
            const saved = await this.saveJobInternal(showAlert);
            return saved;
        },

        async saveJobInternal(showAlert = false) {
            if (!this.ensureJobReady(false)) return null;
            if (!this.ensureExecutableScriptReady()) return null;
            const payload = this.getJobPayload("DRAFT", "");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/save`, {
                    method: "POST",
                    body: payload
                });
                this.jobs = Array.isArray(json.list) ? json.list : this.jobs;
                await this.applyJob(json.data || {});
                if (showAlert) alert("Work saved.");
                return json.data || null;
            } catch (error) {
                alert(error.message || "Work save failed.");
                return null;
            }
        },

        async deleteJob() {
            if (this.isJobExecutionActive()) {
                alert("A job is running. Please wait until execution finishes.");
                return;
            }
            const jobId = this.currentJob?.profileJobId || this.selectedJobId;
            if (!jobId) {
                alert("Select a saved job first.\n저장된 작업을 먼저 선택하세요.");
                return;
            }
            if (!this.selectedProjectId || !this.selectedScenarioId) {
                alert("Select project and scenario first.\n프로젝트와 시나리오를 먼저 선택하세요.");
                return;
            }
            const jobName = this.currentJob?.jobName || `Job #${jobId}`;
            if (!(await CommonMessage.confirm(`Delete ${jobName}?\nRun history for this job will also be deleted.\n${jobName} 작업을 삭제할까요?\n이 작업의 실행 이력도 함께 삭제됩니다.`))) return;

            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/${encodeURIComponent(jobId)}?${params.toString()}`, {
                    method: "DELETE"
                });
                this.jobs = Array.isArray(json.list) ? json.list : [];
                const nextJob = this.jobs[0];
                if (nextJob?.PROFILE_JOB_ID) {
                    this.renderJobs();
                    await this.selectJob(nextJob.PROFILE_JOB_ID, false);
                } else {
                    this.newJob();
                }
                await this.loadRunHistory(false);
                alert(json.message || "Job deleted.");
            } catch (error) {
                alert(error.message || "Job delete failed.");
            }
        },

        async runJob(batch = false) {
            if (this.isJobExecutionActive()) {
                alert("A job is already running. Please wait until execution finishes.");
                return;
            }
            const savedJob = this.getSavedJobSnapshot();
            if (!savedJob?.profileJobId) {
                alert("Save work first, then run the saved work.");
                return;
            }
            const message = batch
                ? "Queue the saved work for batch execution?"
                : "Run the saved work now?";
            if (!(await CommonMessage.confirm(message))) return;
            const dataRunId = await this.ensureDataWorkRunId();
            if (!dataRunId) return;
            const isWebApi = String(savedJob.execSourceType || "").toUpperCase() === "WEB_API";
            const runtimeBindValues = await this.collectRuntimeBindValues(savedJob.execPlsql || "", {
                sourceType: savedJob.execSourceType || "DB_OBJECT",
                parameterRows: savedJob.parameters || [],
                systemBindJob: savedJob,
                dataRunId,
                dialogIntro: isWebApi
                    ? "저장된 API Parameter List 기준으로 이번 실행에 사용할 값을 확인합니다. 변경한 값만 이번 실행에 임시 적용됩니다."
                    : "저장된 PL/SQL과 저장된 Job 설정을 실행합니다. 아래 Runtime Bind 값만 이번 실행에 임시 적용됩니다."
            });
            if (runtimeBindValues === null) return;
            const payload = {
                profileJobId: Number(savedJob.profileJobId),
                batch: Boolean(batch),
                runtimeBindValues
            };

            const jobId = String(savedJob.profileJobId);
            this.setJobRunState(jobId, batch ? "QUEUING" : "RUNNING", true);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/run`, {
                    method: "POST",
                    body: payload,
                    showLoading: false
                });
                this.setJobRunState(jobId, batch ? "QUEUED" : "SUCCESS", false);
                alert(json.message || "Job submitted.");
                await this.loadJobs(false);
                await this.loadRunHistory(false);
                if (json.profileJobId) {
                    await this.selectJob(String(json.profileJobId), false);
                }
            } catch (error) {
                this.setJobRunState(jobId, "FAILED", false);
                alert(error.message || "Job run failed.");
            }
        },

        async testCurrentDraft() {
            if (this.isJobExecutionActive()) {
                alert("A job is already running. Please wait until execution finishes.");
                return;
            }
            if (!this.currentJob?.profileJobId) {
                alert("Save work once to create a job, then test draft changes without saving them.");
                return;
            }
            if (!this.ensureJobReady(false)) return;
            if (!this.ensureExecutableScriptReady()) return;
            if (!(await CommonMessage.confirm("Test the current draft without saving it?"))) return;

            const dataRunId = await this.ensureDataWorkRunId();
            if (!dataRunId) return;
            const isWebApi = String(this.currentJob?.execSourceType || "").toUpperCase() === "WEB_API";
            const runtimeBindValues = await this.collectRuntimeBindValues(null, {
                sourceType: this.currentJob?.execSourceType || "DB_OBJECT",
                parameterRows: this.parameters || [],
                systemBindJob: null,
                dataRunId,
                dialogIntro: isWebApi
                    ? "현재 화면의 API Parameter List 기준으로 1회 테스트 실행할 값을 확인합니다. 변경한 값만 이번 테스트에 적용됩니다."
                    : "현재 화면의 Job 설정과 PL/SQL을 저장하지 않고 1회 테스트 실행합니다. Runtime Bind 값은 이번 테스트에만 적용됩니다."
            });
            if (runtimeBindValues === null) return;

            const payload = {
                ...this.getJobPayload("DRAFT_TEST", ""),
                profileJobId: Number(this.currentJob.profileJobId),
                batch: false,
                runtimeBindValues
            };
            const jobId = String(this.currentJob.profileJobId);
            this.setJobRunState(jobId, "DRAFT_TEST", true);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/job/test-draft`, {
                    method: "POST",
                    body: payload,
                    showLoading: false
                });
                this.setJobRunState(jobId, "DRAFT_TEST", false);
                alert(json.message || "Draft test executed.");
                await this.loadJobs(false);
                await this.loadRunHistory(false);
            } catch (error) {
                this.setJobRunState(jobId, "FAILED", false);
                alert(error.message || "Draft test failed.");
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
            const dataRunId = await this.ensureDataWorkRunId();
            if (!dataRunId) return;

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
            this.syncRunButtons();
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
            this.renderRunHistoryGrid(rows, columns);
        },

        createRunHistoryColumns(rows) {
            const baseColumns = Object.keys(rows?.[0] || {});
            if (!baseColumns.length) return [];
            const preferredColumns = [
                "STATUS",
                "MESSAGE",
                "JOB_NAME",
                "RUN_TYPE",
                "STARTED_AT",
                "FINISHED_AT",
                "ELAPSED_TIME",
                "RUN_SOURCE_TYPE",
                "RUN_ID",
                "DATA_RUN_ID",
                "RESULT_OWNER",
                "RESULT_TABLE_NAME",
                "CREATED_AT",
                "PROFILE_RUN_ID",
                "WORK_RUN_ID",
                "PROFILE_JOB_ID",
                "WORK_JOB_ID",
                "SORT_ORDER",
                "MENU_CODE",
                "JOB_GROUP"
            ];
            const availableColumns = new Set([...baseColumns, "ELAPSED_TIME"]);
            const orderedColumns = preferredColumns.filter((column) => availableColumns.has(column));
            const remainingColumns = baseColumns
                .filter((column) => column !== "ELAPSED_TIME")
                .filter((column) => !orderedColumns.includes(column));
            return [...orderedColumns, ...remainingColumns];
        },

        getRunHistoryKey(row, rowIndex) {
            return String(
                row?.PROFILE_RUN_ID
                || row?.WORK_RUN_ID
                || row?.RUN_ID
                || `${row?.JOB_NAME || ""}:${row?.STARTED_AT || ""}:${rowIndex}`
            );
        },

        renderRunHistoryGrid(rows, columns) {
            const container = getContainerEl(`#runHistoryGrid-${PAGE_CODE}`);
            if (!container) return;
            if (!Array.isArray(rows) || !rows.length || !columns.length) {
                this.renderGrid(`#runHistoryGrid-${PAGE_CODE}`, rows, columns);
                return;
            }

            container.innerHTML = `
                <table class="table-grid data-history-table">
                    <thead>
                        <tr>
                            <th class="grid-row-no">No</th>
                            ${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, rowIndex) => this.renderRunHistoryRow(row, rowIndex, columns)).join("")}
                    </tbody>
                </table>
                ${this.renderListFooter(rows.length)}
            `;
        },

        renderRunHistoryRow(row, rowIndex, columns) {
            const rowKey = this.getRunHistoryKey(row, rowIndex);
            const message = String(row.MESSAGE ?? "");
            const isExpanded = rowKey === this.expandedRunHistoryKey;
            const detailRow = isExpanded ? `
                <tr class="data-history-message-row">
                    <td class="grid-row-no"></td>
                    <td colspan="${columns.length}">
                        <div class="data-history-message-detail">
                            <div class="data-history-message-toolbar">
                                <strong>MESSAGE</strong>
                                <button type="button" class="table-icon-btn data-history-copy-btn" title="Copy message" onclick="${PAGE_CODE}.copyRunHistoryMessage(${rowIndex})">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                            <pre>${this.escapeHtml(message || "(empty)")}</pre>
                        </div>
                    </td>
                </tr>
            ` : "";
            return `
                <tr class="${isExpanded ? "is-expanded" : ""}">
                    <td class="grid-row-no">${rowIndex + 1}</td>
                    ${columns.map((column) => this.renderRunHistoryCell(row, rowIndex, column, isExpanded)).join("")}
                </tr>
                ${detailRow}
            `;
        },

        renderRunHistoryCell(row, rowIndex, column, isExpanded) {
            const value = row[column] ?? "";
            if (column !== "MESSAGE") {
                const displayValue = /_AT$/i.test(column) ? this.formatKstDateTime(value) : value;
                return `<td title="${this.escapeHtml(value)}">${this.escapeHtml(displayValue)}</td>`;
            }
            const message = String(value ?? "");
            if (!message) {
                return `<td class="data-history-message-cell"></td>`;
            }
            return `
                <td class="data-history-message-cell" title="${this.escapeHtml(message)}">
                    <span>${this.escapeHtml(message)}</span>
                    <button type="button" class="table-icon-btn data-history-message-btn" title="${isExpanded ? "Hide full message" : "Show full message"}" onclick="${PAGE_CODE}.toggleRunHistoryMessage(${rowIndex})">
                        <i class="fas ${isExpanded ? "fa-chevron-up" : "fa-ellipsis-h"}"></i>
                    </button>
                </td>
            `;
        },

        toggleRunHistoryMessage(rowIndex) {
            const rows = this.runHistory || [];
            const row = rows[rowIndex];
            if (!row) return;
            const rowKey = this.getRunHistoryKey(row, rowIndex);
            this.expandedRunHistoryKey = this.expandedRunHistoryKey === rowKey ? "" : rowKey;
            this.renderRunHistory();
        },

        async copyRunHistoryMessage(rowIndex) {
            const message = String((this.runHistory || [])[rowIndex]?.MESSAGE ?? "");
            if (!message) return;
            try {
                if (window.CommonMessage?.copyText) {
                    await CommonMessage.copyText(message);
                } else {
                    await navigator.clipboard.writeText(message);
                }
                CommonMessage.success?.("Run history message copied.", { copyable: false, autoCloseMs: 1200 });
            } catch (error) {
                CommonMessage.error?.(error.message || "Message copy failed.");
            }
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
            const execSourceType = getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || this.currentJob?.execSourceType || "DB_OBJECT";
            const isOml = String(execSourceType).toUpperCase() === "OML_PYTHON";
            const isWebApi = String(execSourceType).toUpperCase() === "WEB_API";
            const hasExecutableObject = isWebApi
                ? Boolean(getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value || this.currentJob?.execMethod)
                : isOml
                ? Boolean(getContainerEl(`#omlResource-${PAGE_CODE}`)?.value || this.currentJob?.execResourceId)
                : Boolean(
                    getContainerEl(`#execObject-${PAGE_CODE}`)?.value
                    || this.currentJob?.execObjectId
                    || this.currentJob?.execObjectName
                    || this.currentJob?.execObjectLabel
                );
            if (requireObject && !hasExecutableObject) {
                alert(isWebApi
                    ? "Web API method is required.\nWeb API 실행 방법은 필수입니다."
                    : isOml
                    ? "OML4Py Resource is required.\nOML4Py 리소스는 필수입니다."
                    : "Registered Model / Procedure is required.\n등록된 모델/프로시저는 필수입니다.");
                getContainerEl(isWebApi ? `#webApiMethod-${PAGE_CODE}` : (isOml ? `#omlResource-${PAGE_CODE}` : `#execObject-${PAGE_CODE}`))?.focus();
                return false;
            }
            if (requireObject && !isWebApi && !getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.value.trim()) {
                alert(isOml
                    ? "Executable OML SQL is required. Generate or enter the SQL first.\n실행할 OML SQL이 필요합니다. SQL을 생성하거나 직접 입력해 주세요."
                    : "Executable PL/SQL script is required. Generate or enter the script first.\n실행할 PL/SQL 스크립트가 필요합니다. 스크립트를 생성하거나 직접 입력해 주세요.");
                getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.focus();
                return false;
            }
            const resultCreateYn = this.normalizeResultCreateMode(getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || "N");
            if (this.isResultObjectMode(resultCreateYn)) {
                if (!getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim()) {
                    alert("Result Owner is required when Result Table Create is T or M.");
                    getContainerEl(`#resultOwner-${PAGE_CODE}`)?.focus();
                    return false;
                }
                if (!getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim()) {
                    alert("Result Table is required when Result Table Create is T or M.");
                    getContainerEl(`#resultTable-${PAGE_CODE}`)?.focus();
                    return false;
                }
            }
            return true;
        },

        ensureExecutableScriptReady() {
            const editor = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`);
            const execSourceType = getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || this.currentJob?.execSourceType || "DB_OBJECT";
            const isOml = String(execSourceType).toUpperCase() === "OML_PYTHON";
            const isWebApi = String(execSourceType).toUpperCase() === "WEB_API";
            if (isWebApi) return true;
            if (!editor?.value.trim()) {
                alert(isOml
                    ? "Executable OML SQL is required. Generate or enter the SQL first.\n실행할 OML SQL이 필요합니다. SQL을 생성하거나 직접 입력해 주세요."
                    : "Executable PL/SQL script is required. Generate or enter the script first.\n실행할 PL/SQL 스크립트가 필요합니다. 스크립트를 생성하거나 직접 입력해 주세요.");
                editor?.focus();
                return false;
            }
            return true;
        },

        getJobPayload(status, message) {
            const execSourceType = getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || this.currentJob?.execSourceType || "DB_OBJECT";
            const isOml = String(execSourceType).toUpperCase() === "OML_PYTHON";
            const isWebApi = String(execSourceType).toUpperCase() === "WEB_API";
            const execObject = this.executableObjects.find((row) => String(row.OBJECT_ID) === String(getContainerEl(`#execObject-${PAGE_CODE}`)?.value || ""));
            const omlResource = this.omlResources.find((row) => String(row.OML_RESOURCE_ID) === String(getContainerEl(`#omlResource-${PAGE_CODE}`)?.value || ""));
            const webApiResource = this.findWebApiResource(
                getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value
                || this.currentJob?.execResourceId
                || this.currentJob?.execMethod
                || ""
            );
            const webApi = this.getWebApiDefinition(
                webApiResource?.OML_RESOURCE_ID
                || getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value
                || this.currentJob?.execMethod
                || ""
            );
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
                execSourceType: isWebApi ? "WEB_API" : (isOml ? "OML_PYTHON" : "DB_OBJECT"),
                execResourceId: isWebApi ? (webApi?.resourceId || webApiResource?.OML_RESOURCE_ID || null) : (isOml ? (omlResource?.OML_RESOURCE_ID || null) : null),
                execMethod: isWebApi ? (webApi?.method || this.currentJob?.execMethod || "") : (isOml ? (omlResource?.EXEC_METHOD || this.currentJob?.execMethod || "") : ""),
                execSpecJson: isWebApi ? (webApi?.specJson || this.currentJob?.execSpecJson || JSON.stringify({ endpoint: webApi?.endpoint || "" })) : (isOml ? (omlResource?.SPEC_JSON || this.currentJob?.execSpecJson || "") : ""),
                execObjectId: (isOml || isWebApi) ? null : (execObject?.OBJECT_ID || null),
                execOwner: isOml ? (omlResource?.SCRIPT_OWNER || "") : "",
                execObjectType: isWebApi ? "WEB_API" : (isOml ? "OML_PYTHON" : (execObject?.OBJECT_TYPE || "")),
                execObjectName: isWebApi ? (webApiResource?.RESOURCE_NAME || webApi?.method || "") : (isOml ? (omlResource?.RESOURCE_NAME || omlResource?.SCRIPT_NAME || "") : (execObject?.OBJECT_NAME || "")),
                execObjectLabel: isWebApi ? (webApi?.label || "") : (isOml ? (omlResource?.RESOURCE_LABEL || omlResource?.RESOURCE_NAME || omlResource?.SCRIPT_NAME || "") : (execObject?.OBJECT_LABEL || execObject?.OBJECT_NAME || "")),
                useYn: getContainerEl(`#jobUseYn-${PAGE_CODE}`)?.value || "Y",
                sortOrder: this.parseOptionalNumber(getContainerEl(`#jobSortOrder-${PAGE_CODE}`)?.value),
                params: this.parameters,
                execPlsql: getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.value || "",
                resultCreateYn: this.normalizeResultCreateMode(getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || "N"),
                resultOwner: getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim() || "",
                resultTableName: getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim() || (isWebApi ? (webApi?.resultTable || this.currentJob?.resultTableName || "") : ""),
                status
            };
        },

        generateExecutablePlsql(force = false) {
            const editor = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`);
            if (!editor) return;
            if (!force && editor.value.trim()) return;

            const sourceType = String(this.currentJob?.execSourceType || "DB_OBJECT").toUpperCase();
            if (sourceType === "WEB_API") {
                const api = this.getWebApiDefinition(
                    this.currentJob?.execResourceId
                    || getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value
                    || this.currentJob?.execMethod
                    || ""
                );
                if (api) {
                    this.currentJob = {
                        ...this.currentJob,
                        execSourceType: "WEB_API",
                        execResourceId: api.resourceId || this.currentJob?.execResourceId || getContainerEl(`#webApiMethod-${PAGE_CODE}`)?.value || "",
                        execMethod: api.method || this.currentJob?.execMethod || "",
                        execSpecJson: api.specJson || this.currentJob?.execSpecJson || "",
                        execObjectType: "WEB_API",
                        execObjectName: this.currentJob?.execObjectName || api.method || "",
                        execObjectLabel: this.currentJob?.execObjectLabel || api.label || api.method || "",
                        resultCreateYn: "T",
                        resultOwner: this.currentJob?.resultOwner || this.getDefaultResultOwner(),
                        resultTableName: this.currentJob?.resultTableName || api.resultTable || ""
                    };
                    if (!getContainerEl(`#resultTable-${PAGE_CODE}`)?.value && api.resultTable) {
                        this.setFieldValue(`#resultCreateYn-${PAGE_CODE}`, "T");
                        this.setFieldValue(`#resultOwner-${PAGE_CODE}`, this.currentJob.resultOwner || this.getDefaultResultOwner());
                        this.setFieldValue(`#resultTable-${PAGE_CODE}`, api.resultTable);
                        this.setFieldValue(`#resultQueryTable-${PAGE_CODE}`, api.resultTable);
                        this.updateResultModeLabels();
                    }
                }
                editor.value = api ? this.createWebApiSpecTemplate(api) : "";
                this.currentJob.execPlsql = editor.value;
                return;
            }

            if (sourceType === "OML_PYTHON") {
                const resource = this.omlResources.find((row) => String(row.OML_RESOURCE_ID) === String(this.currentJob?.execResourceId || getContainerEl(`#omlResource-${PAGE_CODE}`)?.value || ""));
                if (!resource) {
                    editor.value = "";
                    return;
                }
                editor.value = this.createOmlSqlTemplate(resource);
                this.currentJob.execPlsql = editor.value;
                return;
            }

            const objectName = this.currentJob?.execObjectName || "";
            if (!objectName) {
                editor.value = "";
                return;
            }

            editor.value = this.createPlsqlTemplate(objectName);
            this.currentJob.execPlsql = editor.value;
        },

        createWebApiSpecTemplate(api) {
            return JSON.stringify({
                type: "WEB_API",
                method: api.method,
                endpoint: api.endpoint,
                resultTable: api.resultTable,
                output: api.outputFormat || null,
                note: "Executed by WAS Python API. Parameters are supplied from Parameter List."
            }, null, 2);
        },

        createOmlSqlTemplate(resource) {
            const method = String(resource?.EXEC_METHOD || this.currentJob?.execMethod || "PYQ_TABLE_EVAL").toUpperCase();
            const scriptName = resource?.SCRIPT_NAME || this.currentJob?.execObjectName || "";
            const scriptOwner = resource?.SCRIPT_OWNER || "";
            const targetOwner = this.currentJob?.ownerName || "";
            const targetTable = this.currentJob?.tableName || "";
            const resultCreateYn = this.normalizeResultCreateMode(getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value || this.currentJob?.resultCreateYn || "N");
            const resultOwner = getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value || this.currentJob?.resultOwner || "";
            const resultTable = getContainerEl(`#resultTable-${PAGE_CODE}`)?.value || this.currentJob?.resultTableName || "";
            const parList = this.createOmlParListExpression();
            const outFmt = String(resource?.OUTPUT_FORMAT || "").trim() || "NULL";
            const scriptOwnerArg = scriptOwner ? `,\n        scr_owner => '${this.escapeSqlLiteral(scriptOwner)}'` : "";
            const tableCursor = targetOwner && targetTable
                ? `CURSOR(SELECT * FROM ${this.quoteName(targetOwner)}.${this.quoteName(targetTable)})`
                : "CURSOR(SELECT * FROM /* --INPUT_TABLE-- */)";
            const functionName = {
                PYQ_EVAL: "pyqEval",
                PYQ_TABLE_EVAL: "pyqTableEval",
                PYQ_ROW_EVAL: "pyqRowEval",
                PYQ_GROUP_EVAL: "pyqGroupEval",
                PYQ_INDEX_EVAL: "pyqIndexEval"
            }[method] || "pyqTableEval";
            const inputArg = method === "PYQ_EVAL"
                ? ""
                : `\n        inp_cur => ${tableCursor},`;
            const selectSql = `SELECT *\n  FROM TABLE(${functionName}(${inputArg}\n        par_lst => ${parList},\n        out_fmt => ${outFmt},\n        scr_name => '${this.escapeSqlLiteral(scriptName)}'${scriptOwnerArg}\n  ))`;
            if (this.isResultTableMode(resultCreateYn) && resultOwner && resultTable) {
                return `CREATE TABLE ${this.quoteName(resultOwner)}.${this.quoteName(resultTable)} AS\n${selectSql}`;
            }
            return selectSql;
        },

        createOmlParListExpression() {
            const pairs = (this.parameters || [])
                .filter((row) => row.itemName)
                .map((row) => {
                    const key = row.bindName || row.itemName;
                    return `'${this.escapeSqlLiteral(key)}' VALUE :${this.toBindVariableName(row.itemName)}`;
                });
            return pairs.length ? `JSON_OBJECT(${pairs.join(", ")} RETURNING CLOB)` : "NULL";
        },

        openPlsqlHelp() {
            const sourceType = getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value || this.currentJob?.execSourceType || "DB_OBJECT";
            this.syncExecutableScriptUi(String(sourceType).toUpperCase() === "OML_PYTHON", String(sourceType).toUpperCase() === "WEB_API");
            const layer = getContainerEl(`#plsqlHelpLayer-${PAGE_CODE}`);
            if (layer) {
                layer.hidden = false;
                this.enableHelpLayerDrag(layer);
            }
        },

        closePlsqlHelp() {
            const layer = getContainerEl(`#plsqlHelpLayer-${PAGE_CODE}`);
            if (layer) layer.hidden = true;
        },

        enableHelpLayerDrag(layer) {
            const dialog = layer?.querySelector(".data-help-dialog");
            const header = dialog?.querySelector("header");
            if (!dialog || !header || dialog.dataset.dragBound === "Y") return;
            dialog.dataset.dragBound = "Y";
            header.classList.add("is-draggable");
            header.addEventListener("pointerdown", (event) => {
                if (event.target.closest("button")) return;
                event.preventDefault();
                const rect = dialog.getBoundingClientRect();
                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = rect.left;
                const startTop = rect.top;
                dialog.style.position = "fixed";
                dialog.style.margin = "0";
                dialog.style.left = `${startLeft}px`;
                dialog.style.top = `${startTop}px`;
                header.setPointerCapture?.(event.pointerId);
                const move = (moveEvent) => {
                    const nextLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, startLeft + moveEvent.clientX - startX));
                    const nextTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, startTop + moveEvent.clientY - startY));
                    dialog.style.left = `${nextLeft}px`;
                    dialog.style.top = `${nextTop}px`;
                };
                const up = () => {
                    header.removeEventListener("pointermove", move);
                    header.removeEventListener("pointerup", up);
                    header.removeEventListener("pointercancel", up);
                };
                header.addEventListener("pointermove", move);
                header.addEventListener("pointerup", up);
                header.addEventListener("pointercancel", up);
            });
        },

        async collectRuntimeBindValues(scriptText = null, options = {}) {
            const editor = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`);
            const script = scriptText ?? (editor?.value || this.currentJob?.execPlsql || "");
            const bindOptions = {
                useParameterDefaults: options.useParameterDefaults !== false,
                useSystemBindContext: options.useSystemBindContext !== false,
                systemBindJob: options.systemBindJob || null,
                dataRunId: options.dataRunId || this.getCurrentDataWorkRunId()
            };
            const parameterRows = options.useParameterDefaults === false
                ? []
                : (options.parameterRows || this.parameters || []);
            const sourceType = String(
                options.sourceType
                || this.currentJob?.execSourceType
                || getContainerEl(`#execSourceType-${PAGE_CODE}`)?.value
                || "DB_OBJECT"
            ).toUpperCase();
            if (sourceType === "WEB_API" && options.scriptBindOnly !== true) {
                return this.collectWebApiRuntimeValues(parameterRows, bindOptions, options);
            }
            if (options.scriptBindOnly !== true) {
                const parameterListValues = this.collectParameterListRuntimeValues(parameterRows, bindOptions, options);
                if (parameterListValues) return parameterListValues;
            }

            const bindNames = this.extractBindVariables(script);
            const dynamicTokenNames = this.extractDynamicTokens(script);
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
                this.addRuntimeBindPrompt(
                    prompts,
                    seen,
                    name,
                    `:${name}`,
                    this.getRuntimeBindDefaultValue(name, row, bindOptions),
                    this.getRuntimeBindComment(name, row, bindOptions)
                );
            });

            dynamicTokenNames.forEach((name) => {
                const row = parameterNameMap.get(name);
                this.addRuntimeBindPrompt(
                    prompts,
                    seen,
                    name,
                    `/* --${name}-- */`,
                    this.getRuntimeBindDefaultValue(name, row, bindOptions),
                    this.getRuntimeBindComment(name, row, bindOptions)
                );
            });

            if (!prompts.length) return {};
            return this.openRuntimeBindDialog(prompts, options);
        },

        collectParameterListRuntimeValues(parameterRows = [], bindOptions = {}, options = {}) {
            const rows = [...(parameterRows || [])]
                .filter((row) => this.isInputParameterRow(row))
                .sort((a, b) => {
                    const orderA = Number(a?.itemOrder ?? a?.ITEM_ORDER ?? 0) || 0;
                    const orderB = Number(b?.itemOrder ?? b?.ITEM_ORDER ?? 0) || 0;
                    return orderA - orderB;
                });
            if (!rows.length) return null;
            const prompts = [];
            const seen = new Set();
            rows.forEach((row) => {
                const name = String(row?.itemName || row?.ITEM_NAME || "").trim();
                if (!name) return;
                this.addRuntimeBindPrompt(
                    prompts,
                    seen,
                    name,
                    name,
                    this.getRuntimeBindDefaultValue(name, row, bindOptions),
                    this.getRuntimeBindComment(name, row, bindOptions)
                );
            });
            if (!prompts.length) return {};
            return this.openRuntimeBindDialog(prompts, {
                ...options,
                includeUnchangedRuntimeValues: false
            });
        },

        collectWebApiRuntimeValues(parameterRows = [], bindOptions = {}, options = {}) {
            const prompts = [];
            const seen = new Set();
            const rows = [...(parameterRows || [])].sort((a, b) => {
                const orderA = Number(a?.itemOrder ?? a?.ITEM_ORDER ?? 0) || 0;
                const orderB = Number(b?.itemOrder ?? b?.ITEM_ORDER ?? 0) || 0;
                return orderA - orderB;
            });

            rows.filter((row) => this.isInputParameterRow(row)).forEach((row) => {
                const name = String(row?.itemName || row?.ITEM_NAME || "").trim();
                if (!name) return;
                const rawDefault = this.getParameterDefaultText(row);
                const resolvedDefault = this.resolveRuntimeDefaultValue(rawDefault, bindOptions);
                const savedValue = this.runtimeBindValues?.[name];
                const value = !this.isRuntimeRunIdPrompt(name) && savedValue !== undefined
                    ? savedValue
                    : resolvedDefault;
                this.addRuntimeBindPrompt(
                    prompts,
                    seen,
                    name,
                    name,
                    value,
                    this.createWebApiRuntimeComment(row, rawDefault, resolvedDefault),
                    { defaultValue: resolvedDefault }
                );
            });

            this.addWebApiAuthRuntimePrompts(prompts, seen, options);

            if (!prompts.length) return {};
            return this.openRuntimeBindDialog(prompts, {
                ...options,
                dialogTitle: "API Runtime Parameters",
                includeUnchangedRuntimeValues: false
            });
        },

        getParameterDefaultText(row) {
            if (!row) return "";
            return String(row.itemDefault ?? row.ITEM_DEFAULT ?? row.value ?? row.VALUE ?? "").trim();
        },

        createWebApiRuntimeComment(row, rawDefault, resolvedDefault) {
            const parts = [];
            const comment = String(row?.itemDesc || row?.ITEM_DESC || "").trim();
            const type = String(row?.itemValue || row?.ITEM_VALUE || "").trim();
            if (comment) parts.push(comment);
            if (type) parts.push(`Type: ${type}`);
            const rawText = String(rawDefault ?? "").trim();
            const resolvedText = String(resolvedDefault ?? "").trim();
            if (rawText && rawText !== resolvedText) {
                parts.push(`Default: ${rawText}`);
            }
            return parts.join(" / ");
        },

        isInputParameterRow(row = {}) {
            const name = String(row?.itemName || row?.ITEM_NAME || row?.name || row?.NAME || "").trim();
            if (!name) return false;
            const directionText = String(
                row?.inOut
                || row?.IN_OUT
                || row?.direction
                || row?.DIRECTION
                || row?.parameterMode
                || row?.PARAMETER_MODE
                || row?.itemMode
                || row?.ITEM_MODE
                || row?.itemValue
                || row?.ITEM_VALUE
                || ""
            ).trim().toUpperCase().replace(/\s+/g, " ");
            if (!directionText) return true;
            return !/^(OUT|OUTPUT|RETURN)\b/.test(directionText);
        },

        addWebApiAuthRuntimePrompts(prompts, seen, options = {}) {
            const spec = this.getCurrentWebApiSpec(options);
            const auth = spec.auth && typeof spec.auth === "object" ? spec.auth : {};
            const authType = String(auth.type || "NONE").toUpperCase();
            const keyName = String(auth.keyName || auth.key || "").trim();
            if (!keyName || authType === "NONE") return;
            const savedValue = this.runtimeBindValues?.[keyName];
            const defaultValue = auth.value ?? "";
            this.addRuntimeBindPrompt(
                prompts,
                seen,
                keyName,
                keyName,
                savedValue !== undefined ? savedValue : defaultValue,
                `API authentication value. Type: ${authType}`,
                { defaultValue }
            );
        },

        getCurrentWebApiSpec(options = {}) {
            const job = options.systemBindJob || this.currentJob || {};
            const specText = job.execSpecJson || job.EXEC_SPEC_JSON || "";
            const spec = this.parseSpecJson(specText);
            if (Object.keys(spec).length) return spec;
            const editorText = getContainerEl(`#execPlsqlEditor-${PAGE_CODE}`)?.value || "";
            return this.parseSpecJson(editorText);
        },

        extractBindVariables(sqlText) {
            const masked = this.maskSqlForBindScan(sqlText);
            const names = [];
            const seen = new Set();
            const regex = /(?<!:):([A-Za-z][A-Za-z0-9_$#]*)/g;
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

        isSystemBindName(name) {
            return Boolean(this.normalizeSystemBindName(name));
        },

        normalizeSystemBindName(name) {
            const key = String(name || "");
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
                "INIT$RunId": "INIT$RunId"
            };
            return aliases[key] || "";
        },

        getRuntimeBindDefaultValue(name, row = null, options = {}) {
            if (this.isSystemBindName(name)) return this.getSystemBindValue(name, options);
            if (this.isRuntimeRunIdPrompt(name)) {
                return row
                    ? this.resolveRuntimeDefaultValue(row.itemDefault, options)
                    : this.getSystemBindValue("INIT$RunId", options);
            }
            const savedValue = this.runtimeBindValues?.[name];
            if (savedValue !== undefined) return savedValue;
            return row ? this.resolveRuntimeDefaultValue(row.itemDefault, options) : "";
        },

        resolveRuntimeDefaultValue(value, options = {}) {
            const text = String(value ?? "").trim();
            const bindMatch = text.match(/^:([A-Za-z][A-Za-z0-9_$#]*)$/);
            if (bindMatch && this.isSystemBindName(bindMatch[1])) {
                return this.getSystemBindValue(bindMatch[1], options);
            }
            const tokenMatch = text.match(/^\/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*)\s*--\s*\*\/$/);
            if (tokenMatch && this.isSystemBindName(tokenMatch[1])) {
                return this.getSystemBindValue(tokenMatch[1], options);
            }
            return text;
        },

        getRuntimeBindComment(name, row = null, options = {}) {
            if (this.isSystemBindName(name)) {
                if (options.useSystemBindContext === false) {
                    return "System bind. Select a saved Data Work job to fill this automatically.";
                }
                if (this.normalizeSystemBindName(name) === "INIT$RunId") {
                    return "DATA_WORK shared RUN_ID for the selected project/scenario. Use New to create the next validation run.";
                }
                return "System bind default. You can override it for this run.";
            }
            if (row) {
                return String(row.itemDesc ?? "").trim();
            }
            return "";
        },

        getSystemBindValue(name, options = {}) {
            if (options.useSystemBindContext === false) return "";
            const job = options.systemBindJob || this.currentJob || {};
            const useDomValues = !options.systemBindJob;
            const canonicalName = this.normalizeSystemBindName(name);
            const values = {
                "INIT$TargetOwner": (useDomValues ? getContainerEl(`#targetOwner-${PAGE_CODE}`)?.value : "") || job.ownerName || "",
                "INIT$TargetTable": (useDomValues ? getContainerEl(`#targetTable-${PAGE_CODE}`)?.value : "") || job.tableName || "",
                "INIT$ResultOwner": (useDomValues ? getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value : "") || job.resultOwner || "",
                "INIT$ResultTable": (useDomValues ? getContainerEl(`#resultTable-${PAGE_CODE}`)?.value : "") || job.resultTableName || "",
                "INIT$ResultModelName": (useDomValues ? getContainerEl(`#resultTable-${PAGE_CODE}`)?.value : "") || job.resultTableName || "",
                "INIT$PreTargetOwner": "",
                "INIT$PreTargetTable": "",
                "INIT$PreResultOwner": "",
                "INIT$PreResultTable": "",
                "INIT$RunSourceType": "DATA_WORK",
                "INIT$RunId": options.dataRunId || this.getCurrentDataWorkRunId() || "(auto)"
            };
            return values[canonicalName] ?? "";
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

        addRuntimeBindPrompt(prompts, seen, name, label, value = "", comment = "", meta = {}) {
            if (!name || seen.has(name)) return;
            seen.add(name);
            prompts.push({
                name,
                label,
                value,
                comment,
                defaultValue: meta.defaultValue ?? value
            });
        },

        isAutoRunIdValue(value) {
            const text = String(value ?? "").trim().toLowerCase();
            return !text || text === "(auto)" || text === "auto";
        },

        isRuntimeRunIdPrompt(name) {
            return new Set(["INIT$RunId", "runId", "P_RUN_ID"]).has(String(name || ""));
        },

        readManualRunIdValue(values = {}) {
            const ids = [];
            ["INIT$RunId", "runId", "P_RUN_ID"].forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(values, key)) return;
                const text = String(values[key] ?? "").trim();
                if (this.isAutoRunIdValue(text)) return;
                if (!/^[1-9][0-9]*$/.test(text)) {
                    throw new Error(":INIT$RunId/P_RUN_ID must be (auto), blank, or a positive integer.");
                }
                ids.push(text);
            });
            if (!ids.length) return "";
            if (new Set(ids).size > 1) {
                throw new Error(":INIT$RunId/P_RUN_ID values must match.");
            }
            return ids[0];
        },

        async confirmManualRunIdOverwrite(values = {}) {
            let runId = "";
            try {
                runId = this.readManualRunIdValue(values);
            } catch (error) {
                await CommonMessage.warn(error.message || "Invalid run id.");
                return false;
            }
            if (!runId) return true;
            const currentRunId = this.getCurrentDataWorkRunId();
            if (!currentRunId || runId === currentRunId) return true;
            return CommonMessage.confirm([
                `Use DATA_WORK RUN_ID ${runId} for this execution?`,
                `현재 시나리오 RUN_ID ${currentRunId} 대신 ${runId}로 실행합니다.`,
                "",
                "Result rows may be written to the entered DATA_WORK RUN_ID.",
                "Continue?"
            ].join("\n"));
        },

        maskSqlForBindScan(sqlText) {
            return String(sqlText || "")
                .replace(/'(?:''|[^'])*'/gs, (match) => " ".repeat(match.length))
                .replace(/"(?:""|[^"])*"/gs, (match) => " ".repeat(match.length))
                .replace(/\/\*.*?\*\//gs, (match) => " ".repeat(match.length))
                .replace(/--[^\r\n]*/gm, (match) => " ".repeat(match.length));
        },

        openRuntimeBindDialog(bindPrompts, options = {}) {
            const layer = getContainerEl(`#runtimeBindLayer-${PAGE_CODE}`);
            const grid = getContainerEl(`#runtimeBindGrid-${PAGE_CODE}`);
            if (!layer || !grid) return Promise.resolve({});
            const title = getContainerEl(`#runtimeBindTitle-${PAGE_CODE}`);
            const dataRunId = String(options.dataRunId || this.getCurrentDataWorkRunId() || "").trim();
            if (title) {
                const baseTitle = options.dialogTitle || "Runtime Bind Variables";
                title.innerHTML = dataRunId
                    ? `${this.escapeHtml(baseTitle)} <span class="data-run-title-badge">DATA RUN #${this.escapeHtml(dataRunId)}</span>`
                    : this.escapeHtml(baseTitle);
            }
            const intro = getContainerEl(`#runtimeBindIntro-${PAGE_CODE}`);
            if (intro) {
                intro.textContent = options.dialogIntro
                    || "실행에 사용할 런타임 바인드 값을 확인하세요. 기본값과 예약 변수 값은 미리 채워지며 필요하면 수정할 수 있습니다.";
            }
            grid.innerHTML = bindPrompts.map((item) => `
                <label class="data-bind-row ${this.isRuntimeRunIdPrompt(item.name) ? "data-run-bind-row" : ""}">
                    <span class="data-bind-meta">
                        <span class="flow-bind-name">${this.escapeHtml(item.label || item.name)}</span>
                        ${item.comment ? `<small class="flow-bind-comment">${this.escapeHtml(item.comment)}</small>` : ""}
                    </span>
                    <input class="env-field data-runtime-bind-input" data-bind-name="${this.escapeHtml(item.name)}" data-default-value="${this.escapeAttr(item.defaultValue ?? item.value ?? "")}" type="text" value="${this.escapeAttr(item.value ?? "")}">
                </label>
            `).join("");
            layer.hidden = false;
            this.enableHelpLayerDrag(layer);
            setTimeout(() => grid.querySelector("input")?.focus(), 0);
            return new Promise((resolve) => {
                this.runtimeBindDialog = {
                    resolve,
                    promptNames: bindPrompts.map((item) => item.name),
                    includeUnchangedRuntimeValues: options.includeUnchangedRuntimeValues !== false
                };
            });
        },

        async confirmRuntimeBindDialog() {
            const layer = getContainerEl(`#runtimeBindLayer-${PAGE_CODE}`);
            const values = {};
            const includeUnchanged = this.runtimeBindDialog?.includeUnchangedRuntimeValues !== false;
            getContainerEl(`#runtimeBindGrid-${PAGE_CODE}`)?.querySelectorAll(".data-runtime-bind-input").forEach((input) => {
                if (!includeUnchanged && input.value === (input.dataset.defaultValue ?? "")) return;
                values[input.dataset.bindName] = input.value;
            });
            if (!(await this.confirmManualRunIdOverwrite(values))) return;
            if (includeUnchanged) {
                this.runtimeBindValues = { ...this.runtimeBindValues, ...values };
            } else {
                const nextRuntimeValues = { ...this.runtimeBindValues };
                (this.runtimeBindDialog?.promptNames || []).forEach((name) => {
                    delete nextRuntimeValues[name];
                });
                this.runtimeBindValues = { ...nextRuntimeValues, ...values };
            }
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
                const comment = this.createPlsqlParameterComment(row);
                if (direction.includes("OUT")) {
                    const varName = `v_${paramName.toLowerCase()}`.replace(/[^a-z0-9_$#]/g, "_");
                    const initialValue = direction.includes("IN") ? ` := ${this.createPlsqlArgument(row)}` : "";
                    declarations.push(`  ${varName} ${this.getParamDataType(row.itemValue)}${initialValue};`);
                    return `    ${this.padRight(paramName, 22)} => ${varName}${comment}`;
                }
                return `    ${this.padRight(paramName, 22)} => ${this.createPlsqlArgument(row)}${comment}`;
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
            const defaultValue = String(row?.itemDefault || "").trim();
            if (defaultValue.includes(":")) return defaultValue;
            return `:${this.toBindVariableName(row?.itemName || "")}`;
        },

        createPlsqlParameterComment(row) {
            const comment = String(row?.itemDesc || "").replace(/\s+/g, " ").trim();
            if (!comment) return "";
            return ` /* ${comment.replace(/\*\//g, "* /")} */`;
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
            if (tabName === "data" && !this.isDataEditTabEnabled()) {
                tabName = "work";
            }
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

        isDataEditTabEnabled() {
            return config.enableDataEditTab === true || PAGE_CODE === "M03001";
        },

        syncDataEditTabVisibility() {
            const enabled = this.isDataEditTabEnabled();
            const container = document.getElementById(`container-${PAGE_CODE}`);
            const tab = getContainerEl(`.data-work-tabs .table-tab[data-tab="data"]`);
            const panel = container?.querySelector(`.data-tool-panel[data-panel="data"]`);
            if (tab) {
                tab.hidden = !enabled;
                tab.style.display = enabled ? "" : "none";
            }
            if (panel) {
                panel.hidden = !enabled;
                panel.style.display = enabled ? "" : "none";
            }
            if (!enabled && this.activeTab === "data") {
                this.switchTab("work");
            }
            if (enabled) {
                this.renderDataEditTarget();
            }
        },

        resetEditableDataGrid(message = "") {
            this.dataGridRows = [];
            this.dataGridColumns = [];
            this.dataGridDirtyCells = new Map();
            this.dataGridTargetKey = "";
            this.dataGridActiveCell = null;
            this.renderDataEditTarget();
            this.syncEditableDataSaveButton();
            this.syncEditableDataFillButton();
            this.applyEditableDataFrozenColumns();
            const grid = getContainerEl(`#dataEditGrid-${PAGE_CODE}`);
            if (grid) grid.innerHTML = "";
            if (message) {
                this.renderDataEditMessage(message, "info");
            } else {
                this.renderDataEditMessage("", "info");
            }
        },

        getDataEditTarget() {
            const job = this.currentJob || {};
            const useResultObject = this.isResultObjectMode(job.resultCreateYn)
                && job.resultOwner
                && job.resultTableName
                && !this.isResultModelMode(job.resultCreateYn);
            const owner = String(useResultObject ? job.resultOwner : job.ownerName || "").trim();
            const tableName = String(useResultObject ? job.resultTableName : job.tableName || "").trim();
            return { owner, tableName };
        },

        renderDataEditTarget(target = this.getDataEditTarget()) {
            const owner = target?.owner || "-";
            const tableName = target?.tableName || "-";
            this.setText(`#dataEditOwner-${PAGE_CODE}`, owner);
            this.setText(`#dataEditTable-${PAGE_CODE}`, tableName);
            const container = getContainerEl(`#dataEditTarget-${PAGE_CODE}`);
            if (container) {
                container.title = owner !== "-" && tableName !== "-" ? `${owner}.${tableName}` : "No target table selected.";
            }
        },

        getDataEditWhereClause() {
            return getContainerEl(`#dataWhere-${PAGE_CODE}`)?.value.trim() || "";
        },

        getDataEditOrderByClause() {
            return getContainerEl(`#dataOrderBy-${PAGE_CODE}`)?.value.trim() || "";
        },

        getEditableDataColumns(target = this.getDataEditTarget()) {
            const configColumns = config.editableDataColumns || {};
            const tableKey = String(target?.tableName || "").trim().toUpperCase();
            const configured = Array.isArray(configColumns[tableKey]) ? configColumns[tableKey] : null;
            if (configured?.length) {
                return new Set(configured.map((column) => String(column).trim().toUpperCase()).filter(Boolean));
            }
            if (PAGE_CODE === "M03001" && (tableKey === "INIT$_TB_PREDICTED_TYPE" || tableKey === "INIT$_TB_PREDICTED_TYPE_FINAL")) {
                return new Set(["FINAL_PREDICTED_TYPE", "FINAL_REASON"]);
            }
            return new Set();
        },

        async loadEditableTableData() {
            if (!this.isDataEditTabEnabled()) return;
            const target = this.getDataEditTarget();
            this.renderDataEditTarget(target);
            if (!target.owner || !target.tableName) {
                this.renderDataEditMessage("No target table selected.", "error");
                return;
            }

            const grid = getContainerEl(`#dataEditGrid-${PAGE_CODE}`);
            if (grid) grid.innerHTML = `<div class="table-empty">Loading data...</div>`;
            this.dataGridDirtyCells = new Map();
            this.syncEditableDataSaveButton();
            this.renderDataEditMessage("Loading data...", "info");

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data/editable`, {
                    method: "POST",
                    body: {
                        owner: target.owner,
                        tableName: target.tableName,
                        limit: this.getLimit(`#dataLimit-${PAGE_CODE}`),
                        whereClause: this.getDataEditWhereClause(),
                        orderByClause: this.getDataEditOrderByClause()
                    }
                });
                const rows = json.data || [];
                const columns = (json.columns || []).filter((column) => column !== "INIT$ROWID");
                this.dataGridRows = rows;
                this.dataGridColumns = columns;
                this.dataGridTargetKey = `${target.owner}.${target.tableName}`;
                this.dataGridActiveCell = null;
                this.renderEditableDataGrid(rows, columns, target);
                this.renderDataEditMessage(`${rows.length.toLocaleString()} rows selected.`, "success");
            } catch (error) {
                this.dataGridRows = [];
                this.dataGridColumns = [];
                if (grid) grid.innerHTML = "";
                this.renderDataEditMessage(error.message || "Data query failed.", "error");
            }
        },

        renderEditableDataGrid(rows, columns, target) {
            const container = getContainerEl(`#dataEditGrid-${PAGE_CODE}`);
            if (!container) return;
            const editableColumns = this.getEditableDataColumns(target);
            const hasEditableColumns = columns.some((column) => editableColumns.has(String(column).toUpperCase()));
            if (!Array.isArray(rows) || !rows.length) {
                container.innerHTML = columns.length
                    ? `<table class="table-grid data-edit-table"><thead><tr><th class="grid-row-no">No</th>${columns.map((column) => {
                        const editable = editableColumns.has(String(column).toUpperCase());
                        return `<th class="${editable ? "is-editable-column" : ""}" title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`;
                    }).join("")}</tr></thead><tbody></tbody></table>${this.renderListFooter(0)}`
                    : `<div class="table-empty">No data.</div>${this.renderListFooter(0)}`;
                this.syncEditableDataSaveButton();
                this.syncEditableDataFillButton();
                this.applyEditableDataFrozenColumns();
                return;
            }

            container.innerHTML = `
                <table class="table-grid data-edit-table">
                    <thead>
                        <tr>
                            <th class="grid-row-no">No</th>
                            ${columns.map((column) => {
                                const editable = editableColumns.has(String(column).toUpperCase());
                                return `<th class="${editable ? "is-editable-column" : ""}" title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`;
                            }).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${rowIndex + 1}</td>
                                ${columns.map((column) => this.renderEditableDataCell(row, rowIndex, column, editableColumns)).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                ${this.renderListFooter(rows.length)}
            `;

            if (!hasEditableColumns) {
                this.renderDataEditMessage("No editable columns are configured for this table.", "info");
            }
            this.syncEditableDataSaveButton();
            this.syncEditableDataFillButton();
            this.applyEditableDataFrozenColumns();
        },

        getEditableDataFreezeCount() {
            const input = getContainerEl(`#dataFreezeColumns-${PAGE_CODE}`);
            const maxDataColumns = Math.max(0, (this.dataGridColumns || []).length);
            let dataColumnCount = Number.parseInt(input?.value ?? this.dataGridFrozenColumns ?? 0, 10);
            if (!Number.isFinite(dataColumnCount)) dataColumnCount = 0;
            dataColumnCount = Math.max(0, Math.min(maxDataColumns, dataColumnCount));
            this.dataGridFrozenColumns = dataColumnCount;
            if (input && input.value !== String(dataColumnCount)) input.value = String(dataColumnCount);
            return dataColumnCount + 1;
        },

        applyEditableDataFrozenColumns() {
            const grid = getContainerEl(`#dataEditGrid-${PAGE_CODE}`);
            const table = grid?.querySelector?.(".data-edit-table");
            if (!table) return;

            table.querySelectorAll(".is-frozen-col, .is-frozen-edge").forEach((cell) => {
                cell.classList.remove("is-frozen-col", "is-frozen-edge");
                cell.style.left = "";
            });

            const headerRow = table.tHead?.rows?.[0] || table.rows?.[0];
            if (!headerRow) return;

            const freezeCount = this.getEditableDataFreezeCount();
            const headerCells = Array.from(headerRow.children);
            const visibleFreezeCount = Math.min(freezeCount, headerCells.length);
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

        renderEditableDataCell(row, rowIndex, column, editableColumns) {
            const columnName = String(column);
            const value = row[columnName] ?? "";
            const editable = editableColumns.has(columnName.toUpperCase());
            if (!editable) {
                return `<td title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</td>`;
            }
            if (this.isPredictedTypeEditColumn(columnName)) {
                return `
                    <td
                        class="data-edit-cell is-editable is-select-edit"
                        data-row-index="${rowIndex}"
                        data-column-name="${this.escapeHtml(columnName)}"
                        title="${this.escapeHtml(value)}"
                        tabindex="0"
                        onfocus="${PAGE_CODE}.handleEditableDataCellFocus(event)"
                        onkeydown="${PAGE_CODE}.handleEditableDataCellKeydown(event)"
                        oncopy="${PAGE_CODE}.handleEditableDataCellCopy(event)"
                        onpaste="${PAGE_CODE}.handleEditableDataCellPaste(event)"
                    >
                        <select class="data-edit-select"
                            onfocus="${PAGE_CODE}.handleEditableDataCellFocus(event)"
                            onchange="${PAGE_CODE}.handleEditableDataCellInput(event)"
                            onkeydown="${PAGE_CODE}.handleEditableDataCellKeydown(event)"
                            oncopy="${PAGE_CODE}.handleEditableDataCellCopy(event)"
                            onpaste="${PAGE_CODE}.handleEditableDataCellPaste(event)"
                        >
                            ${this.getPredictedTypeOptions().map((option) => `
                                <option value="${this.escapeHtml(option)}"${String(value) === option ? " selected" : ""}>${this.escapeHtml(option)}</option>
                            `).join("")}
                        </select>
                    </td>
                `;
            }
            return `
                <td
                    class="data-edit-cell is-editable"
                    contenteditable="true"
                    spellcheck="false"
                    tabindex="0"
                    data-row-index="${rowIndex}"
                    data-column-name="${this.escapeHtml(columnName)}"
                    title="${this.escapeHtml(value)}"
                    onfocus="${PAGE_CODE}.handleEditableDataCellFocus(event)"
                    oninput="${PAGE_CODE}.handleEditableDataCellInput(event)"
                    onkeydown="${PAGE_CODE}.handleEditableDataCellKeydown(event)"
                    oncopy="${PAGE_CODE}.handleEditableDataCellCopy(event)"
                    onpaste="${PAGE_CODE}.handleEditableDataCellPaste(event)"
                >${this.escapeHtml(value)}</td>
            `;
        },

        isPredictedTypeEditColumn(columnName) {
            return PAGE_CODE === "M03001" && String(columnName || "").toUpperCase() === "FINAL_PREDICTED_TYPE";
        },

        getPredictedTypeOptions() {
            return [
                "",
                "숫자형식별자",
                "문자형식별자",
                "숫자형범주형",
                "순서형범주형",
                "이산형연속형",
                "문자형범주형",
                "일반적범주형",
                "숫자형연속형",
                "단순형텍스트",
                "기타데이터형"
            ];
        },

        handleEditableDataCellInput(event) {
            const source = event.currentTarget;
            const cell = source?.closest?.(".data-edit-cell") || source;
            const rowIndex = Number(cell?.dataset?.rowIndex);
            const columnName = cell?.dataset?.columnName || "";
            const newValue = source?.tagName === "SELECT" ? source.value : (cell.textContent ?? "");
            this.markEditableDataCellValue(rowIndex, columnName, newValue, cell);
        },

        handleEditableDataCellFocus(event) {
            const cell = event.currentTarget?.closest?.(".data-edit-cell") || event.currentTarget;
            if (!cell?.classList?.contains("data-edit-cell")) return;
            this.setActiveEditableDataCell(Number(cell.dataset.rowIndex), cell.dataset.columnName || "", cell);
        },

        handleEditableDataCellCopy(event) {
            const source = event.currentTarget;
            const cell = source?.closest?.(".data-edit-cell") || source;
            const value = this.getEditableDataCellDomValue(cell);
            event.preventDefault();
            event.clipboardData?.setData("text/plain", value);
        },

        handleEditableDataCellPaste(event) {
            const source = event.currentTarget;
            const cell = source?.closest?.(".data-edit-cell") || source;
            const text = event.clipboardData?.getData("text/plain") ?? "";
            if (!cell?.classList?.contains("data-edit-cell") || !text) return;
            event.preventDefault();
            this.pasteEditableDataMatrix(Number(cell.dataset.rowIndex), cell.dataset.columnName || "", text);
        },

        setActiveEditableDataCell(rowIndex, columnName, cell = null) {
            if (!Number.isInteger(rowIndex) || !columnName) return;
            getContainerEl(`#dataEditGrid-${PAGE_CODE}`)?.querySelectorAll(".data-edit-cell.is-active-cell").forEach((item) => {
                item.classList.remove("is-active-cell");
            });
            const targetCell = cell || this.getEditableDataCellElement(rowIndex, columnName);
            targetCell?.classList?.add("is-active-cell");
            this.dataGridActiveCell = { rowIndex, columnName };
            this.syncEditableDataFillButton();
        },

        getEditableColumnNames(target = this.getDataEditTarget()) {
            const editableColumns = this.getEditableDataColumns(target);
            return (this.dataGridColumns || []).filter((column) => editableColumns.has(String(column || "").toUpperCase()));
        },

        getEditableDataCellElement(rowIndex, columnName) {
            const escapedColumn = this.escapeCssIdentifier(columnName);
            return getContainerEl(`#dataEditGrid-${PAGE_CODE}`)?.querySelector(`.data-edit-cell[data-row-index="${rowIndex}"][data-column-name="${escapedColumn}"]`) || null;
        },

        escapeCssIdentifier(value) {
            if (window.CSS && typeof window.CSS.escape === "function") {
                return window.CSS.escape(String(value || ""));
            }
            return String(value || "").replace(/["\\]/g, "\\$&");
        },

        getEditableDataCellDomValue(cell) {
            if (!cell) return "";
            const select = cell.querySelector?.(".data-edit-select");
            return select ? select.value : (cell.textContent ?? "");
        },

        focusEditableDataCell(rowIndex, columnName) {
            const cell = this.getEditableDataCellElement(rowIndex, columnName);
            if (!cell) return;
            this.setActiveEditableDataCell(rowIndex, columnName, cell);
            const select = cell.querySelector?.(".data-edit-select");
            (select || cell).focus();
        },

        setEditableDataCellDomValue(cell, value) {
            if (!cell) return;
            const textValue = String(value ?? "");
            const select = cell.querySelector?.(".data-edit-select");
            if (select) {
                if (![...select.options].some((option) => option.value === textValue)) {
                    select.appendChild(new Option(textValue, textValue));
                }
                select.value = textValue;
            } else {
                cell.textContent = textValue;
            }
            cell.title = textValue;
        },

        markEditableDataCellValue(rowIndex, columnName, newValue, cell = null) {
            const row = this.dataGridRows[rowIndex];
            if (!row || !columnName) return;
            const targetCell = cell || this.getEditableDataCellElement(rowIndex, columnName);
            const originalValue = row[columnName] ?? "";
            const key = `${row.INIT$ROWID || ""}::${columnName}`;
            const normalizedValue = String(newValue ?? "");
            if (String(originalValue) === normalizedValue) {
                this.dataGridDirtyCells.delete(key);
                targetCell?.classList?.remove("is-dirty");
            } else {
                this.dataGridDirtyCells.set(key, {
                    rowId: row.INIT$ROWID,
                    columnName,
                    value: normalizedValue
                });
                targetCell?.classList?.add("is-dirty");
            }
            this.syncEditableDataSaveButton();
        },

        handleEditableDataCellKeydown(event) {
            const source = event.currentTarget;
            const cell = source?.closest?.(".data-edit-cell") || source;
            if (!cell?.classList?.contains("data-edit-cell")) return;

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
                return;
            }

            const editableColumns = this.getEditableColumnNames();
            const rowIndex = Number(cell.dataset.rowIndex);
            const columnName = cell.dataset.columnName || "";
            const colIndex = editableColumns.findIndex((column) => String(column).toUpperCase() === String(columnName).toUpperCase());
            if (!Number.isInteger(rowIndex) || colIndex < 0) return;

            let nextRow = rowIndex;
            let nextCol = colIndex;
            if (event.key === "Enter") {
                nextRow += event.shiftKey ? -1 : 1;
            } else if (event.key === "Tab") {
                nextCol += event.shiftKey ? -1 : 1;
                if (nextCol < 0) {
                    nextCol = editableColumns.length - 1;
                    nextRow -= 1;
                } else if (nextCol >= editableColumns.length) {
                    nextCol = 0;
                    nextRow += 1;
                }
            } else if (event.key === "ArrowUp") {
                nextRow -= 1;
            } else if (event.key === "ArrowDown") {
                nextRow += 1;
            } else if (event.key === "ArrowLeft") {
                nextCol -= 1;
            } else if (event.key === "ArrowRight") {
                nextCol += 1;
            } else {
                return;
            }

            nextRow = Math.max(0, Math.min((this.dataGridRows || []).length - 1, nextRow));
            nextCol = Math.max(0, Math.min(editableColumns.length - 1, nextCol));
            if (nextRow === rowIndex && nextCol === colIndex && event.key !== "Enter") {
                return;
            }
            event.preventDefault();
            this.focusEditableDataCell(nextRow, editableColumns[nextCol]);
        },

        parseEditableDataClipboardText(text) {
            const normalized = String(text ?? "").replace(/\r/g, "");
            const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
            return trimmed.split("\n").map((line) => line.split("\t"));
        },

        pasteEditableDataMatrix(startRowIndex, startColumnName, text) {
            const editableColumns = this.getEditableColumnNames();
            const startColIndex = editableColumns.findIndex((column) => String(column).toUpperCase() === String(startColumnName).toUpperCase());
            if (startColIndex < 0 || !Number.isInteger(startRowIndex)) return;

            const matrix = this.parseEditableDataClipboardText(text);
            let changed = 0;
            matrix.forEach((line, rowOffset) => {
                const rowIndex = startRowIndex + rowOffset;
                if (rowIndex >= (this.dataGridRows || []).length) return;
                line.forEach((value, colOffset) => {
                    const columnName = editableColumns[startColIndex + colOffset];
                    if (!columnName) return;
                    const cell = this.getEditableDataCellElement(rowIndex, columnName);
                    this.setEditableDataCellDomValue(cell, value);
                    this.markEditableDataCellValue(rowIndex, columnName, value, cell);
                    changed += 1;
                });
            });

            this.focusEditableDataCell(startRowIndex, startColumnName);
            if (changed) {
                this.renderDataEditMessage(`${changed.toLocaleString()} cell(s) pasted.`, "success");
            }
        },

        applyActiveEditableValueToAllRows() {
            const active = this.dataGridActiveCell;
            if (!active) {
                this.renderDataEditMessage("Select an editable cell first.", "error");
                return;
            }
            const editableColumns = this.getEditableColumnNames();
            if (!editableColumns.some((column) => String(column).toUpperCase() === String(active.columnName).toUpperCase())) {
                this.renderDataEditMessage("Selected cell is not editable.", "error");
                return;
            }
            const sourceCell = this.getEditableDataCellElement(active.rowIndex, active.columnName);
            const value = this.getEditableDataCellDomValue(sourceCell);
            let changed = 0;
            (this.dataGridRows || []).forEach((row, rowIndex) => {
                if (rowIndex <= active.rowIndex) return;
                if (!row?.INIT$ROWID) return;
                const cell = this.getEditableDataCellElement(rowIndex, active.columnName);
                this.setEditableDataCellDomValue(cell, value);
                this.markEditableDataCellValue(rowIndex, active.columnName, value, cell);
                changed += 1;
            });
            this.focusEditableDataCell(active.rowIndex, active.columnName);
            this.renderDataEditMessage(`${this.escapeHtml(active.columnName)} value pasted downward to ${changed.toLocaleString()} row(s).`, "success");
        },

        syncEditableDataFillButton() {
            const button = getContainerEl(`#dataFillColumn-${PAGE_CODE}`);
            if (button) {
                button.disabled = !this.dataGridActiveCell || !(this.dataGridRows || []).length;
            }
        },

        syncEditableDataSaveButton() {
            const button = getContainerEl(`#dataSaveUpdates-${PAGE_CODE}`);
            if (button) button.disabled = !this.dataGridDirtyCells?.size;
        },

        async saveEditableTableData() {
            if (!this.dataGridDirtyCells?.size) {
                this.renderDataEditMessage("No changes to save.", "info");
                return;
            }
            const target = this.getDataEditTarget();
            if (!target.owner || !target.tableName) {
                this.renderDataEditMessage("No target table selected.", "error");
                return;
            }

            const changes = Array.from(this.dataGridDirtyCells.values()).filter((change) => change.rowId && change.columnName);
            if (!changes.length) {
                this.renderDataEditMessage("No valid changes to save.", "error");
                return;
            }

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data/update`, {
                    method: "POST",
                    body: {
                        owner: target.owner,
                        tableName: target.tableName,
                        whereClause: this.getDataEditWhereClause(),
                        changes
                    }
                });
                this.dataGridDirtyCells = new Map();
                this.syncEditableDataSaveButton();
                this.renderDataEditMessage(json.message || "Changes saved.", "success");
                await this.loadEditableTableData();
            } catch (error) {
                this.renderDataEditMessage(error.message || "Update failed.", "error");
            }
        },

        renderDataEditMessage(message, type = "info") {
            const element = getContainerEl(`#dataEditMessage-${PAGE_CODE}`);
            if (!element) return;
            element.className = type === "error" ? "table-error" : "table-empty";
            element.textContent = message || "";
            element.hidden = !message;
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
            const runtimeBindValues = await this.collectRuntimeBindValues(sql, this.getWorksheetRuntimeBindOptions(gridKey));
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
            const runtimeBindValues = await this.collectRuntimeBindValues(sql, this.getWorksheetRuntimeBindOptions(gridKey));
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

        getWorksheetRuntimeBindOptions(gridKey) {
            if (gridKey !== "sql") {
                return { useParameterDefaults: false, useSystemBindContext: false };
            }
            const hasJob = this.hasUserSqlJobContext();
            return {
                useParameterDefaults: hasJob,
                useSystemBindContext: hasJob,
                scriptBindOnly: true,
                sourceType: "DB_OBJECT"
            };
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
                DataEditingSystem.downloadXLSX(rows, `${baseName}.xlsx`, grid.columns);
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
                this.currentJob.resultCreateYn = "T";
                this.currentJob.status = "RESULT_SAVED";
                this.renderCurrentJob();
                await this.setResultTableSql();
                await this.loadJobs();
            } catch (error) {
                alert(error.message || "SQL result table save failed.");
            }
        },

        async setDefaultUserSql(force = false) {
            this.setDefaultDataWhere(force);
            const editor = getContainerEl(`#sqlEditor-${PAGE_CODE}`);
            if (!editor) return;
            const currentValue = editor.value || "";
            const canReplace = !currentValue.trim()
                || currentValue === this.systemUserSqlValue
                || !this.userSqlDirty
                || (force && !this.userSqlDirty);
            if (!canReplace) return;

            const sql = await this.createDefaultUserSql();
            if (!sql) return;
            editor.value = sql;
            this.systemUserSqlValue = sql;
            this.userSqlDirty = false;
        },

        setDefaultDataWhere(force = false) {
            const field = getContainerEl(`#dataWhere-${PAGE_CODE}`);
            if (!field) return;
            const currentValue = field.value || "";
            const canReplace = !currentValue.trim()
                || currentValue === this.systemDataWhereValue
                || !this.dataWhereDirty
                || (force && !this.dataWhereDirty);
            if (!canReplace) return;

            const whereClause = this.createDefaultDataWhereClause();
            field.value = whereClause;
            this.systemDataWhereValue = whereClause;
            this.dataWhereDirty = false;
        },

        createDefaultDataWhereClause() {
            const job = this.currentJob || {};
            const useResultObject = this.isResultObjectMode(job.resultCreateYn)
                && job.resultOwner
                && job.resultTableName
                && !this.isResultModelMode(job.resultCreateYn);
            if (!useResultObject) return "";
            return this.createTargetResultWhereClause(job.resultTableName, job.ownerName, job.tableName);
        },

        handleDataWhereInput() {
            const field = getContainerEl(`#dataWhere-${PAGE_CODE}`);
            const value = field?.value || "";
            this.dataWhereDirty = Boolean(value.trim()) && value !== this.systemDataWhereValue;
        },

        handleUserSqlInput() {
            const editor = getContainerEl(`#sqlEditor-${PAGE_CODE}`);
            const value = editor?.value || "";
            this.userSqlDirty = Boolean(value.trim()) && value !== this.systemUserSqlValue;
        },

        async createDefaultUserSql() {
            const job = this.currentJob || {};
            const useResultObject = this.isResultObjectMode(job.resultCreateYn)
                && job.resultOwner
                && job.resultTableName;
            if (useResultObject && this.isResultModelMode(job.resultCreateYn)) {
                const modelDetailSql = await this.fetchModelDetailSql(job.resultTableName, job.resultOwner);
                if (this.isAssociationModelJob(job, job.resultTableName)) {
                    return modelDetailSql;
                }
                const sourceTable = this.getModelPredictionSourceTable(job);
                const predictionSql = await this.createModelPredictionTargetSql(
                    job.resultTableName,
                    job.resultOwner,
                    job.ownerName,
                    job.tableName,
                    sourceTable.ownerName,
                    sourceTable.tableName
                );
                return [modelDetailSql, predictionSql].filter(Boolean).join("\n\n");
            }
            const ownerName = useResultObject ? job.resultOwner : job.ownerName;
            const tableName = useResultObject ? job.resultTableName : job.tableName;
            let runId = "";
            if (useResultObject && PAGE_CODE === "M03001" && this.isPredictedTypeResultTable(tableName)) {
                runId = await this.fetchExistingPredictedTypeRunId(ownerName, job.ownerName, job.tableName);
            } else if (useResultObject && this.shouldLookupExistingResultRunId(tableName)) {
                runId = await this.fetchExistingResultTableRunId(ownerName, tableName, job.ownerName, job.tableName);
            }
            return ownerName && tableName
                ? this.createTargetFilteredSelectSql(
                    ownerName,
                    tableName,
                    useResultObject ? job.ownerName : "",
                    useResultObject ? job.tableName : "",
                    runId
                )
                : "";
        },

        async fetchModelDetailSql(modelName, ownerName = "") {
            const model = String(modelName || "").trim().toUpperCase();
            const owner = String(ownerName || "").trim().toUpperCase();
            if (!model || !owner) return "";
            try {
                const params = new URLSearchParams({ owner, modelName: model });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/model-detail-sql?${params.toString()}`, {
                    method: "GET",
                    showLoading: false
                });
                return json?.data?.sql || this.createModelDetailSql(model, owner);
            } catch (error) {
                return this.createModelDetailSql(model, owner);
            }
        },

        getModelPredictionSourceTable(job = this.currentJob || {}) {
            const scenarioTable = (this.scenarioTables || []).find((row) => (
                String(row.SCENARIO_TABLE_ID || "") === String(job.scenarioTableId || "")
            ));
            return {
                ownerName: scenarioTable?.OWNER_NAME || job.ownerName || "",
                tableName: scenarioTable?.TABLE_NAME || job.tableName || ""
            };
        },

        isAssociationModelJob(job = this.currentJob || {}, modelName = "") {
            const tokens = [
                modelName,
                job.resultTableName,
                job.execObjectName,
                job.execObjectLabel,
                job.execMethod,
                job.execPlsql
            ]
                .map((value) => String(value || "").toUpperCase())
                .join(" ");
            return tokens.includes("APRIORI") || tokens.includes("ASSOCIATION");
        },

        async fetchExistingPredictedTypeRunId(resultOwner = "", targetOwner = "", targetTable = "", modelName = "") {
            const owner = String(resultOwner || "").trim().toUpperCase();
            const sourceOwner = String(targetOwner || "").trim().toUpperCase();
            const sourceTable = String(targetTable || "").trim().toUpperCase();
            if (PAGE_CODE !== "M03001" || !owner || !sourceOwner || !sourceTable) {
                return this.getLatestDataWorkRunId?.() || "";
            }
            try {
                const params = new URLSearchParams({
                    owner,
                    targetOwner: sourceOwner,
                    targetTable: sourceTable
                });
                const model = String(modelName || "").trim().toUpperCase();
                if (model) params.set("modelName", model);
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/predicted-type-run-id?${params.toString()}`, {
                    method: "GET",
                    showLoading: false
                });
                return json?.data?.runId ? String(json.data.runId) : "";
            } catch (error) {
                return this.getLatestDataWorkRunId?.() || "";
            }
        },

        async fetchExistingResultTableRunId(resultOwner = "", resultTable = "", targetOwner = "", targetTable = "") {
            const owner = String(resultOwner || "").trim().toUpperCase();
            const table = String(resultTable || "").trim().toUpperCase();
            const sourceOwner = String(targetOwner || "").trim().toUpperCase();
            const sourceTable = String(targetTable || "").trim().toUpperCase();
            if (!this.shouldLookupExistingResultRunId(table) || !owner || !sourceOwner || !sourceTable) {
                return "";
            }
            try {
                const params = new URLSearchParams({
                    owner,
                    tableName: table,
                    targetOwner: sourceOwner,
                    targetTable: sourceTable
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/result-run-id?${params.toString()}`, {
                    method: "GET",
                    showLoading: false
                });
                return json?.data?.runId || json?.data?.runId === 0 ? String(json.data.runId) : "";
            } catch (error) {
                return this.getLatestDataWorkRunId?.() || "";
            }
        },

        async createModelPredictionTargetSql(modelName, modelOwner = "", targetOwner = "", targetTable = "", filterOwner = "", filterTable = "") {
            const model = String(modelName || "").trim().toUpperCase();
            const owner = String(modelOwner || "").trim().toUpperCase();
            const tableOwner = String(targetOwner || "").trim().toUpperCase();
            const table = String(targetTable || "").trim().toUpperCase();
            if (!model || !tableOwner || !table) return "";

            if (this.isAssociationModelJob(this.currentJob || {}, model)) {
                return "";
            }

            const modelObject = owner ? `${this.quoteName(owner)}.${this.quoteName(model)}` : this.quoteName(model);
            const existingRunId = await this.fetchExistingPredictedTypeRunId(tableOwner, filterOwner || tableOwner, filterTable || table, model);
            const whereClause = this.createTargetResultWhereClause(table, tableOwner, table, existingRunId);
            const buildPredictionSql = (targetTableName, includeRunId = false) => {
                const targetObject = `${this.quoteName(tableOwner)}.${this.quoteName(targetTableName)}`;
                const lines = [
                    "-- Target table prediction by model",
                    "SELECT T.*",
                    `     , PREDICTION(${modelObject} USING *) AS PREDICTED_MODEL`,
                    `  FROM ${targetObject} T`
                ];
                const sourceOwner = String(filterOwner || tableOwner).trim().toUpperCase();
                const sourceTable = String(filterTable || "").trim().toUpperCase();
                if (sourceOwner && sourceTable) {
                    lines.push(` WHERE OWNER = '${this.escapeSqlLiteral(sourceOwner)}'`);
                    lines.push(`   AND TABLE_NAME = '${this.escapeSqlLiteral(sourceTable)}'`);
                    const runId = existingRunId || this.getLatestDataWorkRunId?.();
                    if (includeRunId && runId && /^\d+$/.test(runId)) {
                        lines.push(`   AND RUN_ID = ${runId}`);
                    }
                } else {
                    const targetWhereClause = this.createTargetResultWhereClause(targetTableName, tableOwner, table, existingRunId);
                    if (targetWhereClause) {
                        lines.push(` WHERE ${targetWhereClause.replace(/\n\s*AND /g, "\n   AND ")}`);
                    }
                }
                lines.push(" ORDER BY T.COLUMN_ID");
                lines[lines.length - 1] = `${lines[lines.length - 1]};`;
                return lines.join("\n");
            };
            if (table === "INIT$_TB_PREDICTED_TYPE" || table === "INIT$_TB_PREDICTED_TYPE_FINAL") {
                return [
                    buildPredictionSql("INIT$_TB_PREDICTED_TYPE", true),
                    buildPredictionSql("INIT$_TB_PREDICTED_TYPE_FINAL", false)
                ].join("\n\n");
            }
            const targetObject = `${this.quoteName(tableOwner)}.${this.quoteName(table)}`;
            const lines = [
                "-- Target table prediction by model",
                "SELECT T.*",
                `     , PREDICTION(${modelObject} USING *) AS PREDICTED_MODEL`,
                `  FROM ${targetObject} T`
            ];
            if (whereClause) {
                lines.push(` WHERE ${whereClause.replace(/\n\s*AND /g, "\n   AND ")}`);
            }
            lines[lines.length - 1] = `${lines[lines.length - 1]};`;
            return lines.join("\n");
        },

        createModelDetailSql(modelName, ownerName = "") {
            const model = String(modelName || "").trim().toUpperCase();
            if (!model) return "";
            const owner = String(ownerName || "").trim().toUpperCase();
            return [
                "-- Model detail views depend on the Oracle ML mining function and generated objects.",
                `-- Model: ${owner ? `${owner}.` : ""}${model}`,
                "-- Existing DM$ detail view SELECT statements could not be loaded yet.",
                "-- Open the model in M90001 or reload this job after model creation."
            ].join("\n");
        },

        async setResultTableSql(tableNameValue = "", ownerNameValue = "", resultCreateYnValue = "") {
            const tableName = String(tableNameValue || "").trim()
                || getContainerEl(`#resultQueryTable-${PAGE_CODE}`)?.value.trim()
                || getContainerEl(`#resultTable-${PAGE_CODE}`)?.value.trim();
            const ownerName = String(ownerNameValue || "").trim()
                || getContainerEl(`#resultOwner-${PAGE_CODE}`)?.value.trim();
            const createMode = this.normalizeResultCreateMode(
                resultCreateYnValue
                || getContainerEl(`#resultCreateYn-${PAGE_CODE}`)?.value
                || this.currentJob?.resultCreateYn
                || "N"
            );
            this.setEditorValue(`#resultSqlEditor-${PAGE_CODE}`, await this.createResultSql(tableName, ownerName, createMode));
        },

        async createResultSql(tableName, ownerName = "", resultCreateYn = "N") {
            const table = String(tableName || "").trim();
            const owner = String(ownerName || "").trim();
            if (this.isResultModelMode(resultCreateYn)) {
                return this.fetchModelDetailSql(table, owner);
            }
            const targetOwner = getContainerEl(`#targetOwner-${PAGE_CODE}`)?.value.trim() || this.currentJob?.ownerName || "";
            const targetTable = getContainerEl(`#targetTable-${PAGE_CODE}`)?.value.trim() || this.currentJob?.tableName || "";
            let runId = "";
            if (PAGE_CODE === "M03001" && this.isPredictedTypeResultTable(table)) {
                runId = await this.fetchExistingPredictedTypeRunId(owner, targetOwner, targetTable);
            } else if (this.shouldLookupExistingResultRunId(table)) {
                runId = await this.fetchExistingResultTableRunId(owner, table, targetOwner, targetTable);
            }
            return this.createTargetFilteredSelectSql(owner, table, targetOwner, targetTable, runId);
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
            start = this.skipLeadingSqlComments(value, start, end);
            while (end > start && /\s/.test(value[end - 1])) end -= 1;
            return { selectionStart: start, selectionEnd: end };
        },

        skipLeadingSqlComments(value, start, end) {
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

        getSqlGridColumnKey(gridKey, column, index) {
            return `${gridKey}:${index}:${String(column || "")}`;
        },

        getSqlGridColumnWidth(gridKey, column, index) {
            const key = this.getSqlGridColumnKey(gridKey, column, index);
            const savedWidth = Number(this.gridColumnWidths?.[key] || 0);
            if (savedWidth > 0) return savedWidth;
            const columnName = String(column || "").toUpperCase();
            if (columnName === "__ROW_NO__") return 58;
            if (/(MESSAGE|EXPRESSION|SQL|ERROR|FEATURE|REASON)/.test(columnName)) return 360;
            if (/(CREATE|UPDATE|DATE|TIME|DT)$/.test(columnName)) return 170;
            if (/(OWNER|TABLE|COLUMN|RULE|MODEL|RESULT)/.test(columnName)) return 190;
            return Math.min(Math.max(String(column || "").length * 9 + 44, 120), 260);
        },

        renderSqlGridColGroup(gridKey, columns = []) {
            return `
                <colgroup>
                    <col data-sql-grid-col-index="0" style="width: ${this.getSqlGridColumnWidth(gridKey, "__ROW_NO__", 0)}px;">
                    ${columns.map((column, index) => {
                        const colIndex = index + 1;
                        return `<col data-sql-grid-col-index="${colIndex}" style="width: ${this.getSqlGridColumnWidth(gridKey, column, colIndex)}px;">`;
                    }).join("")}
                </colgroup>
            `;
        },

        renderSqlGridHeader(gridKey, columns = []) {
            const rowNoWidth = this.getSqlGridColumnWidth(gridKey, "__ROW_NO__", 0);
            return `
                <th class="grid-row-no data-sql-grid-resizable" title="No" style="width: ${rowNoWidth}px;">
                    No
                    <span class="data-sql-grid-col-resizer" title="Resize column" onmousedown="${PAGE_CODE}.beginSqlGridColumnResize(event, '${this.escapeJs(gridKey)}', 0, '__ROW_NO__')"></span>
                </th>
                ${columns.map((column, index) => {
                    const colIndex = index + 1;
                    const width = this.getSqlGridColumnWidth(gridKey, column, colIndex);
                    return `
                        <th class="data-sql-grid-resizable" title="${this.escapeHtml(column)}" style="width: ${width}px;">
                            <span class="table-th-content">${this.escapeHtml(column)}</span>
                            <span class="data-sql-grid-col-resizer" title="Resize column" onmousedown="${PAGE_CODE}.beginSqlGridColumnResize(event, '${this.escapeJs(gridKey)}', ${colIndex}, '${this.escapeJs(column)}')"></span>
                        </th>
                    `;
                }).join("")}
            `;
        },

        syncSqlGridTableWidth(gridKey = "sql") {
            const table = getContainerEl(`[data-sql-grid-key="${this.escapeCssIdentifier(gridKey)}"]`);
            if (!table) return;
            const columns = Array.from(table.querySelectorAll("col"));
            const width = columns.reduce((sum, column) => sum + Math.max(48, parseInt(column.style.width || "0", 10) || 0), 0);
            const tableWidth = Math.max(width, table.parentElement?.clientWidth || 0);
            table.style.width = `${tableWidth}px`;
            table.style.minWidth = `${tableWidth}px`;
        },

        getSqlGridFreezeCount(gridKey = "sql") {
            const input = gridKey === "sql" ? getContainerEl(`#sqlFreezeColumns-${PAGE_CODE}`) : null;
            const columns = this.gridData?.[gridKey]?.columns || [];
            const maxDataColumns = Math.max(0, columns.length);
            let dataColumnCount = Number.parseInt(input?.value ?? this.sqlGridFrozenColumns?.[gridKey] ?? 0, 10);
            if (!Number.isFinite(dataColumnCount)) dataColumnCount = 0;
            dataColumnCount = Math.max(0, Math.min(maxDataColumns, dataColumnCount));
            this.sqlGridFrozenColumns = { ...(this.sqlGridFrozenColumns || {}), [gridKey]: dataColumnCount };
            if (input && input.value !== String(dataColumnCount)) input.value = String(dataColumnCount);
            return dataColumnCount + 1;
        },

        applySqlGridFrozenColumns(gridKey = "sql") {
            const table = getContainerEl(`[data-sql-grid-key="${this.escapeCssIdentifier(gridKey)}"]`);
            if (!table) return;
            table.querySelectorAll(".is-frozen-col, .is-frozen-edge").forEach((cell) => {
                cell.classList.remove("is-frozen-col", "is-frozen-edge");
                cell.style.left = "";
            });
            table.classList.remove("has-frozen-cols");
            const headerRow = table.tHead?.rows?.[0] || table.rows?.[0];
            if (!headerRow) return;
            const headerCells = Array.from(headerRow.children || []);
            const visibleFreezeCount = Math.min(this.getSqlGridFreezeCount(gridKey), headerCells.length);
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

        beginSqlGridColumnResize(event, gridKey, columnIndex, columnName) {
            event.preventDefault();
            event.stopPropagation();
            const header = event.currentTarget?.closest?.("th");
            if (!header) return;
            const key = this.getSqlGridColumnKey(gridKey, columnName, columnIndex);
            const startWidth = header.getBoundingClientRect().width || this.getSqlGridColumnWidth(gridKey, columnName, columnIndex);
            this.gridResizeState = {
                gridKey,
                columnIndex,
                key,
                startX: event.clientX,
                startWidth
            };
            this.gridResizeMoveBound = this.gridResizeMoveBound || this.handleSqlGridColumnResizeMove.bind(this);
            this.gridResizeUpBound = this.gridResizeUpBound || this.endSqlGridColumnResize.bind(this);
            document.addEventListener("mousemove", this.gridResizeMoveBound);
            document.addEventListener("mouseup", this.gridResizeUpBound, { once: true });
            document.body.classList.add("is-column-resizing");
        },

        handleSqlGridColumnResizeMove(event) {
            const state = this.gridResizeState;
            if (!state) return;
            const width = Math.max(58, Math.min(900, Math.round(state.startWidth + event.clientX - state.startX)));
            this.gridColumnWidths[state.key] = width;
            const table = getContainerEl(`[data-sql-grid-key="${this.escapeCssIdentifier(state.gridKey)}"]`);
            const col = table?.querySelector?.(`col[data-sql-grid-col-index="${state.columnIndex}"]`);
            if (col) col.style.width = `${width}px`;
            const header = table?.querySelector?.(`thead th:nth-child(${state.columnIndex + 1})`);
            if (header) header.style.width = `${width}px`;
            this.syncSqlGridTableWidth(state.gridKey);
            this.applySqlGridFrozenColumns(state.gridKey);
        },

        endSqlGridColumnResize() {
            if (this.gridResizeMoveBound) document.removeEventListener("mousemove", this.gridResizeMoveBound);
            if (this.gridResizeUpBound) document.removeEventListener("mouseup", this.gridResizeUpBound);
            document.body.classList.remove("is-column-resizing");
            this.gridResizeState = null;
        },

        renderGrid(selector, rows, columnNames = []) {
            const container = getContainerEl(selector);
            if (!container) return;
            const gridKey = selector.includes("sqlGrid") ? "sql" : (selector.includes("runHistoryGrid") ? "history" : "result");
            const columns = Array.isArray(columnNames) && columnNames.length
                ? columnNames
                : Object.keys(rows?.[0] || {});
            const colGroupHtml = this.renderSqlGridColGroup(gridKey, columns);
            const headerHtml = this.renderSqlGridHeader(gridKey, columns);
            if (!Array.isArray(rows) || !rows.length) {
                if (columns.length) {
                    container.innerHTML = `
                        <table class="table-grid data-sql-result-table" data-sql-grid-key="${this.escapeHtml(gridKey)}">
                            ${colGroupHtml}
                            <thead>
                                <tr>
                                    ${headerHtml}
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                        ${this.renderListFooter(0)}
                    `;
                    this.syncSqlGridTableWidth(gridKey);
                    this.applySqlGridFrozenColumns(gridKey);
                    return;
                }
                container.innerHTML = `<div class="table-empty">No data.</div>${this.renderListFooter(0)}`;
                return;
            }

            container.innerHTML = `
                <table class="table-grid data-sql-result-table" data-sql-grid-key="${this.escapeHtml(gridKey)}">
                    ${colGroupHtml}
                    <thead>
                        <tr>
                            ${headerHtml}
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
            this.syncSqlGridTableWidth(gridKey);
            this.applySqlGridFrozenColumns(gridKey);
        }
    };;
            window[PAGE_CODE] = page;
            return page;
        }

    };

    window.MCOMMON = MCOMMON;
})();
