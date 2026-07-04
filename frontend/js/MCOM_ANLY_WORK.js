(function() {
    if (!window.MCOMMON) {
        window.MCOMMON = {};
    }

    const DEFAULT_ANLY_WORK_CONFIGS = Object.freeze({
        M04002: Object.freeze({
            pageCode: "M04002",
            apiCode: "M04002",
            contextStorageKey: "DATA_EDITING_WORK_CONTEXT"
        })
    });

    window.MCOMMON.createAnlyWorkPage = function(config = {}) {
        const PAGE_CODE = config.pageCode || "M04002";
        const API_PAGE_CODE = config.apiCode || PAGE_CODE;
        const PAGE_ID_PREFIX = PAGE_CODE;
        const CONTEXT_STORAGE_KEY = config.contextStorageKey || "DATA_EDITING_WORK_CONTEXT";
        const DETAIL_PRESET_URL = "./config/M90001.object-detail-presets.json";
        const pageHelper = PageManager.createHelper(PAGE_CODE);
        const resolvePageText = (value) => String(value ?? "").split("${PAGE_CODE}").join(PAGE_CODE);
        const getContainerEl = (selector) => pageHelper.getContainerEl(resolvePageText(selector));
    const GENERIC_TABLE_RESULT_LAYOUT = Object.freeze({
        kind: "TABLE",
        key: "TABLE:GENERIC",
        title: "Result Table",
        summaryRenderer: ""
    });
    const TABLE_RESULT_LAYOUTS = Object.freeze({
        "INIT$_TB_PREDICTED_TYPE": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_PREDICTED_TYPE",
            title: "Result Table",
            summaryKey: "predictedTypeSummary",
            summaryRenderer: "renderPredictedTypeSummary"
        }),
        "INIT$_TB_PREDICTED_TYPE_FINAL": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_PREDICTED_TYPE",
            title: "Result Table",
            summaryKey: "predictedTypeSummary",
            summaryRenderer: "renderPredictedTypeSummary"
        }),
        "INIT$_TB_CAT_CORR_PAIR": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_CAT_CORR_PAIR",
            title: "Result Table",
            summaryKey: "correlationSummary",
            summaryRenderer: "renderCorrelationSummary"
        }),
        "INIT$_TB_NUM_CORR_PAIR": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_NUM_CORR_PAIR",
            title: "Result Table",
            summaryKey: "correlationSummary",
            summaryRenderer: "renderCorrelationSummary"
        }),
        "INIT$_TB_LASSO_FEATURE": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_LASSO_FEATURE",
            title: "Result Table",
            summaryKey: "lassoSummary",
            summaryRenderer: "renderLassoSummary"
        }),
        "INIT$_TB_SYMBOLIC_RULE": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_SYMBOLIC_RULE",
            title: "Result Table",
            summaryKey: "symbolicRuleSummary",
            summaryRenderer: "renderSymbolicRuleSummary"
        }),
        "INIT$_TB_RULE_VIOLATION_RESULT": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_RULE_VIOLATION_RESULT",
            title: "Result Table",
            summaryKey: "violationSummary",
            summaryRenderer: "renderViolationSummary"
        }),
        "INIT$_TB_SYMBOLIC_RULE_VIOLATION": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_SYMBOLIC_RULE_VIOLATION",
            title: "Result Table",
            summaryKey: "symbolicViolationSummary",
            summaryRenderer: "renderSymbolicViolationSummary"
        })
    });
    const MODEL_RESULT_LAYOUTS = Object.freeze({
        ASSOCIATION_RULES: Object.freeze({
            kind: "MODEL",
            key: "MODEL:ASSOCIATION_RULES",
            title: "Association Rules",
            renderer: "renderAssociationModelAnalysis"
        }),
        GENERIC_MODEL: Object.freeze({
            kind: "MODEL",
            key: "MODEL:GENERIC",
            title: "Oracle ML Model View",
            renderer: "renderAssociationModelAnalysis"
        })
    });
    const EMPTY_RESULT_LAYOUT = Object.freeze({
        kind: "NONE",
        key: "NONE",
        title: "No Result"
    });

    const page = {
        runs: [],
        nodes: [],
        projects: [],
        scenarios: [],
        selectedRun: null,
        selectedNode: null,
        runPage: 1,
        runTotal: 0,
        resultPage: 1,
        resultPageSize: 50,
        excludeEmptyConsequent: false,
        readableRuleConditionFilter: "ALL",
        readableRuleConfidenceFilter: "ALL",
        predictedTypeFilter: "ALL",
        predictedTypeViewMode: "TYPE",
        ruleSummaryFilters: { conditionCount: "ALL", confidenceScope: "ALL", resultColumn: "ALL", conditionColumn: "ALL", resultHasValueYn: "ALL", page: 1, pageSize: 20, resultColumnPage: 1 },
        violationRuleFilters: { ruleId: "", conditionCount: "ALL", confidenceScope: "NON_PERFECT", resultScope: "HIT", page: 1, pageSize: 20 },
        symbolicRuleFilters: { method: "ALL", targetColumn: "ALL" },
        symbolicViolationFilters: { method: "ALL", targetColumn: "ALL", resultScope: "ALL" },
        violationSql: { sql: "", page: 1, pageSize: 50, freezeColumns: 2, total: 0, columns: [], rows: [], title: "", columnWidths: {} },
        currentModelDetail: null,
        lastResultTableJson: null,
        lastViolationSummary: null,
        lastSymbolicRuleSummary: null,
        lastSymbolicViolationSummary: null,
        symbolicRuleChart: null,
        pendingRunId: "",
        isRunDeleteInProgress: false,
        currentExport: { filename: "integrated-result.csv", columns: [], rows: [] },
        nodeResultCache: new Map(),
        runtimeParamPresetMap: new Map(),

        async init() {
            const pendingRunId = sessionStorage.getItem(`${PAGE_CODE}:selectedRunId`) || "";
            const pendingProjectId = sessionStorage.getItem(`${PAGE_CODE}:selectedProjectId`) || "";
            const pendingScenarioId = sessionStorage.getItem(`${PAGE_CODE}:selectedScenarioId`) || "";
            const storedContext = this.readWorkContext();
            if (pendingRunId) {
                sessionStorage.removeItem(`${PAGE_CODE}:selectedRunId`);
                this.pendingRunId = pendingRunId;
            }
            sessionStorage.removeItem(`${PAGE_CODE}:selectedProjectId`);
            sessionStorage.removeItem(`${PAGE_CODE}:selectedScenarioId`);
            const preferredProjectId = pendingProjectId || storedContext.projectId || "";
            const preferredScenarioId = pendingScenarioId || (pendingProjectId ? "" : storedContext.scenarioId || "");
            await this.loadRuntimeParamPresetDefinitions();
            await this.loadProjects(preferredProjectId);
            await this.loadScenarios(preferredScenarioId);
            this.persistWorkContext();
            if (this.pendingRunId) {
                await this.openPendingRunPage();
            } else {
                await this.loadRuns(1);
            }
        },

        destroy() {
            this.runs = [];
            this.nodes = [];
            this.projects = [];
            this.scenarios = [];
            this.selectedRun = null;
            this.selectedNode = null;
            this.currentModelDetail = null;
            this.lastResultTableJson = null;
            this.lastViolationSummary = null;
            this.lastSymbolicRuleSummary = null;
            this.lastSymbolicViolationSummary = null;
            this.readableRuleConditionFilter = "ALL";
            this.readableRuleConfidenceFilter = "ALL";
            this.predictedTypeFilter = "ALL";
            this.predictedTypeViewMode = "TYPE";
            this.violationRuleFilters = { ruleId: "", conditionCount: "ALL", confidenceScope: "NON_PERFECT", resultScope: "HIT", page: 1, pageSize: 20 };
            this.symbolicRuleFilters = { method: "ALL", targetColumn: "ALL" };
            this.symbolicViolationFilters = { method: "ALL", targetColumn: "ALL", resultScope: "ALL" };
            this.closeViolationSqlPopup();
            this.closeSymbolicRulePopup();
            this.pendingRunId = "";
            this.currentExport = { filename: "integrated-result.csv", columns: [], rows: [] };
            this.nodeResultCache = new Map();
            this.runtimeParamPresetMap = new Map();
        },

        cloneCacheValue(value) {
            if (value === undefined || value === null) return value;
            try {
                if (typeof structuredClone === "function") return structuredClone(value);
                return JSON.parse(JSON.stringify(value));
            } catch (error) {
                return value;
            }
        },

        getNodeCacheKey(nodeRunId = this.selectedNode?.FLOW_NODE_RUN_ID) {
            if (nodeRunId === undefined || nodeRunId === null || nodeRunId === "") return "";
            return String(nodeRunId);
        },

        snapshotNodeResultCache() {
            const key = this.getNodeCacheKey();
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!key || !panel || !this.selectedNode || panel.classList.contains("is-loading")) return;
            if (!this.nodeResultCache) this.nodeResultCache = new Map();
            this.nodeResultCache.set(key, {
                html: panel.innerHTML,
                resultPage: this.resultPage,
                resultPageSize: this.resultPageSize,
                excludeEmptyConsequent: this.excludeEmptyConsequent,
                readableRuleConditionFilter: this.readableRuleConditionFilter,
                readableRuleConfidenceFilter: this.readableRuleConfidenceFilter,
                predictedTypeFilter: this.predictedTypeFilter,
                predictedTypeViewMode: this.predictedTypeViewMode,
                ruleSummaryFilters: this.cloneCacheValue(this.ruleSummaryFilters),
                violationRuleFilters: this.cloneCacheValue(this.violationRuleFilters),
                symbolicRuleFilters: this.cloneCacheValue(this.symbolicRuleFilters),
                symbolicViolationFilters: this.cloneCacheValue(this.symbolicViolationFilters),
                violationSql: this.cloneCacheValue(this.violationSql),
                currentModelDetail: this.cloneCacheValue(this.currentModelDetail),
                lastResultTableJson: this.cloneCacheValue(this.lastResultTableJson),
                lastViolationSummary: this.cloneCacheValue(this.lastViolationSummary),
                lastSymbolicRuleSummary: this.cloneCacheValue(this.lastSymbolicRuleSummary),
                lastSymbolicViolationSummary: this.cloneCacheValue(this.lastSymbolicViolationSummary),
                currentExport: this.cloneCacheValue(this.currentExport)
            });
        },

        restoreNodeResultCache(nodeRunId) {
            const key = this.getNodeCacheKey(nodeRunId);
            const cached = key ? this.nodeResultCache?.get(key) : null;
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!cached || !panel) return false;
            this.resultPage = Number(cached.resultPage || 1);
            this.resultPageSize = Number(cached.resultPageSize || this.resultPageSize || 50);
            this.excludeEmptyConsequent = Boolean(cached.excludeEmptyConsequent);
            this.readableRuleConditionFilter = cached.readableRuleConditionFilter || "ALL";
            this.readableRuleConfidenceFilter = cached.readableRuleConfidenceFilter || "ALL";
            this.predictedTypeFilter = cached.predictedTypeFilter || "ALL";
            this.predictedTypeViewMode = cached.predictedTypeViewMode === "SOURCE" ? "SOURCE" : "TYPE";
            this.ruleSummaryFilters = {
                conditionCount: "ALL",
                confidenceScope: "ALL",
                resultColumn: "ALL",
                conditionColumn: "ALL",
                resultHasValueYn: "ALL",
                page: 1,
                pageSize: 20,
                resultColumnPage: 1,
                ...(this.cloneCacheValue(cached.ruleSummaryFilters) || {})
            };
            this.violationRuleFilters = {
                ruleId: "",
                conditionCount: "ALL",
                confidenceScope: "NON_PERFECT",
                resultScope: "HIT",
                page: 1,
                pageSize: 20,
                ...(this.cloneCacheValue(cached.violationRuleFilters) || {})
            };
            this.symbolicRuleFilters = {
                method: "ALL",
                targetColumn: "ALL",
                ...(this.cloneCacheValue(cached.symbolicRuleFilters) || {})
            };
            this.symbolicViolationFilters = {
                method: "ALL",
                targetColumn: "ALL",
                resultScope: "ALL",
                ...(this.cloneCacheValue(cached.symbolicViolationFilters) || {})
            };
            this.violationSql = this.cloneCacheValue(cached.violationSql) || { sql: "", page: 1, pageSize: 50, total: 0, columns: [], rows: [], title: "" };
            this.currentModelDetail = this.cloneCacheValue(cached.currentModelDetail);
            this.lastResultTableJson = this.cloneCacheValue(cached.lastResultTableJson);
            this.lastViolationSummary = this.cloneCacheValue(cached.lastViolationSummary);
            this.lastSymbolicRuleSummary = this.cloneCacheValue(cached.lastSymbolicRuleSummary);
            this.lastSymbolicViolationSummary = this.cloneCacheValue(cached.lastSymbolicViolationSummary);
            this.currentExport = this.cloneCacheValue(cached.currentExport) || { filename: "integrated-result.csv", columns: [], rows: [] };
            panel.classList.remove("is-loading");
            panel.innerHTML = cached.html || `<div class="table-empty">노드를 선택하면 결과 상세가 표시됩니다.</div>`;
            return true;
        },

        readWorkContext() {
            try {
                return JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY) || "{}") || {};
            } catch (error) {
                return {};
            }
        },

        persistWorkContext() {
            const projectId = getContainerEl("#projectId-${PAGE_CODE}")?.value || "";
            const scenarioId = getContainerEl("#scenarioId-${PAGE_CODE}")?.value || "";
            try {
                localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ projectId, scenarioId }));
            } catch (error) {
                console.warn(`[${PAGE_CODE}] work context save failed`, error);
            }
        },

        async loadRuns(page = this.runPage, options = {}) {
            if (page === 1 && !options.preservePending) this.pendingRunId = "";
            const projectId = getContainerEl("#projectId-${PAGE_CODE}")?.value || "";
            this.persistWorkContext();
            if (!projectId) {
                this.runs = [];
                this.nodes = [];
                this.runTotal = 0;
                this.selectedRun = null;
                this.selectedNode = null;
            this.currentModelDetail = null;
            this.lastResultTableJson = null;
            this.lastViolationSummary = null;
            this.lastSymbolicRuleSummary = null;
            this.nodeResultCache = new Map();
                this.renderRuns();
                this.renderRunSummary();
                const nodeList = getContainerEl("#nodeList-${PAGE_CODE}");
                if (nodeList) nodeList.innerHTML = "";
                const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
                if (panel) panel.innerHTML = `<div class="table-empty">프로젝트를 선택하면 실행 이력이 표시됩니다.</div>`;
                return;
            }
            this.runPage = Math.max(1, Number(page || 1));
            const pageSize = Number(getContainerEl("#pageSize-${PAGE_CODE}")?.value || 20);
            const params = new URLSearchParams({
                page: String(this.runPage),
                pageSize: String(pageSize),
                projectId,
                status: getContainerEl("#status-${PAGE_CODE}")?.value || "ALL",
                keyword: getContainerEl("#keyword-${PAGE_CODE}")?.value?.trim?.() || ""
            });
            const scenarioId = getContainerEl("#scenarioId-${PAGE_CODE}")?.value || "";
            if (scenarioId) params.set("scenarioId", scenarioId);
            const list = getContainerEl("#runList-${PAGE_CODE}");
            if (list) list.innerHTML = `<div class="table-empty">Loading runs...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/runs?${params.toString()}`, { method: "GET", showLoading: false });
                this.runs = Array.isArray(json.data) ? json.data : [];
                this.runTotal = Number(json.total || 0);
                if (!this.runs.length) {
                    this.selectedRun = null;
                    this.selectedNode = null;
                    this.nodes = [];
                    this.currentModelDetail = null;
                    this.lastResultTableJson = null;
                    this.lastViolationSummary = null;
                    this.lastSymbolicRuleSummary = null;
                    this.nodeResultCache = new Map();
                    this.renderRuns();
                    this.renderRunSummary();
                    const nodeList = getContainerEl("#nodeList-${PAGE_CODE}");
                    const resultPanel = getContainerEl("#resultPanel-${PAGE_CODE}");
                    if (nodeList) nodeList.innerHTML = `<div class="table-empty">실행 이력이 없습니다.</div>`;
                    if (resultPanel) resultPanel.innerHTML = `<div class="table-empty">실행 이력을 선택하면 결과 상세가 표시됩니다.</div>`;
                    return;
                }
                this.renderRuns();
                const targetRunId = this.pendingRunId && this.runs.some((run) => String(run.FLOW_RUN_ID) === String(this.pendingRunId))
                    ? this.pendingRunId
                    : this.runs[0]?.FLOW_RUN_ID;
                if (targetRunId) await this.selectRun(targetRunId);
                if (this.pendingRunId && String(targetRunId) === String(this.pendingRunId)) this.pendingRunId = "";
            } catch (error) {
                if (list) list.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Run load failed.")}</div>`;
            }
        },

        async openPendingRunPage() {
            const flowRunId = this.pendingRunId;
            if (!flowRunId) {
                await this.loadRuns(1);
                return;
            }
            const projectId = getContainerEl("#projectId-${PAGE_CODE}")?.value || "";
            if (!projectId) {
                await this.loadRuns(1);
                return;
            }
            const pageSize = Number(getContainerEl("#pageSize-${PAGE_CODE}")?.value || 20);
            const params = new URLSearchParams({
                projectId,
                pageSize: String(pageSize),
                status: getContainerEl("#status-${PAGE_CODE}")?.value || "ALL",
                keyword: getContainerEl("#keyword-${PAGE_CODE}")?.value?.trim?.() || ""
            });
            const scenarioId = getContainerEl("#scenarioId-${PAGE_CODE}")?.value || "";
            if (scenarioId) params.set("scenarioId", scenarioId);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/runs/${encodeURIComponent(flowRunId)}/position?${params.toString()}`, { method: "GET", showLoading: false });
                await this.loadRuns(Number(json.page || 1), { preservePending: true });
            } catch (error) {
                console.warn(`[${PAGE_CODE}] pending run position failed`, error);
                await this.loadRuns(1);
            }
        },

        async loadProjects(preferredProjectId = "") {
            const select = getContainerEl("#projectId-${PAGE_CODE}");
            if (select) select.innerHTML = `<option value="">Loading projects...</option>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?keyword=`, { method: "GET", showLoading: false });
                this.projects = Array.isArray(json.data) ? json.data : [];
                if (select) {
                    select.innerHTML = `
                        <option value="">-- Select project --</option>
                        ${this.projects.map((project) => `
                            <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(project))}" value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                                ${this.escapeHtml(CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || `Project #${project.PROJECT_ID}`))}
                            </option>
                        `).join("")}
                    `;
                    const exists = this.projects.some((project) => String(project.PROJECT_ID) === String(preferredProjectId));
                    select.value = exists ? String(preferredProjectId) : String(this.projects[0]?.PROJECT_ID || "");
                    CommonUtils.applyOwnerScopeToSelect(select, this.projects, select.value);
                }
            } catch (error) {
                if (select) select.innerHTML = `<option value="">Project load failed</option>`;
                throw error;
            }
        },

        async loadScenarios(preferredScenarioId = "") {
            const projectId = getContainerEl("#projectId-${PAGE_CODE}")?.value || "";
            const select = getContainerEl("#scenarioId-${PAGE_CODE}");
            this.scenarios = [];
            if (select) select.innerHTML = `<option value="">ALL</option>`;
            if (!projectId) return;
            const params = new URLSearchParams({ projectId, keyword: "" });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/scenarios?${params.toString()}`, { method: "GET", showLoading: false });
                this.scenarios = Array.isArray(json.data) ? json.data : [];
                if (select) {
                    select.innerHTML = `
                        <option value="">ALL</option>
                        ${this.scenarios.map((scenario) => `
                            <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(scenario))}" value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                                ${this.escapeHtml(CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || `Scenario #${scenario.SCENARIO_ID}`))}
                            </option>
                        `).join("")}
                    `;
                    const exists = this.scenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
                    select.value = exists ? String(preferredScenarioId) : "";
                    CommonUtils.applyOwnerScopeToSelect(select, this.scenarios, select.value, ["SCENARIO_ID", "scenarioId"]);
                }
            } catch (error) {
                if (select) select.innerHTML = `<option value="">Scenario load failed</option>`;
                throw error;
            }
        },

        async handleProjectChange() {
            const projectSelect = getContainerEl("#projectId-${PAGE_CODE}");
            CommonUtils.applyOwnerScopeToSelect(projectSelect, this.projects, projectSelect?.value || "");
            await this.loadScenarios("");
            this.persistWorkContext();
            await this.loadRuns(1);
        },

        async handleScenarioChange() {
            const scenarioSelect = getContainerEl("#scenarioId-${PAGE_CODE}");
            CommonUtils.applyOwnerScopeToSelect(scenarioSelect, this.scenarios, scenarioSelect?.value || "", ["SCENARIO_ID", "scenarioId"]);
            this.persistWorkContext();
            await this.loadRuns(1);
        },

        renderRuns() {
            const list = getContainerEl("#runList-${PAGE_CODE}");
            const count = getContainerEl("#runCount-${PAGE_CODE}");
            const pageText = getContainerEl("#runPage-${PAGE_CODE}");
            const pageSize = Number(getContainerEl("#pageSize-${PAGE_CODE}")?.value || 20);
            const totalPages = Math.max(1, Math.ceil(this.runTotal / pageSize));
            if (count) count.textContent = `${this.formatNumber(this.runTotal)} rows`;
            if (pageText) pageText.textContent = `${this.runPage} / ${totalPages}`;
            if (!list) return;
            if (!this.runs.length) {
                list.innerHTML = `<div class="table-empty">실행 이력이 없습니다.</div>`;
                return;
            }
            list.innerHTML = this.runs.map((run) => `
                <button type="button" class="M04002-run-card ${this.selectedRun?.FLOW_RUN_ID === run.FLOW_RUN_ID ? "is-selected" : ""}" onclick="${PAGE_CODE}.selectRun(${Number(run.FLOW_RUN_ID)})">
                    <span>
                        <strong>Run #${this.escapeHtml(run.FLOW_RUN_ID)}</strong>
                        <small>${this.escapeHtml(run.FLOW_NAME || "-")}</small>
                        <em>${this.escapeHtml(this.formatDateTime(run.STARTED_AT || run.CREATED_AT))}</em>
                    </span>
                    <b class="${this.getStatusClass(run.STATUS)}">${this.escapeHtml(run.STATUS || "-")}</b>
                </button>
            `).join("");
        },

        changeRunPage(delta) {
            const pageSize = Number(getContainerEl("#pageSize-${PAGE_CODE}")?.value || 20);
            const totalPages = Math.max(1, Math.ceil(this.runTotal / pageSize));
            const next = Math.min(totalPages, Math.max(1, this.runPage + delta));
            if (next !== this.runPage) this.loadRuns(next);
        },

        handleKeywordKeydown(event) {
            if (event.key === "Enter") this.loadRuns(1);
        },

        async selectRun(flowRunId) {
            this.selectedRun = this.runs.find((run) => Number(run.FLOW_RUN_ID) === Number(flowRunId)) || null;
            this.selectedNode = null;
            this.currentModelDetail = null;
            this.lastViolationSummary = null;
            this.currentExport = { filename: "integrated-result.csv", columns: [], rows: [] };
            this.nodeResultCache = new Map();
            this.renderRuns();
            this.renderRunSummary();
            const nodeList = getContainerEl("#nodeList-${PAGE_CODE}");
            const resultPanel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (nodeList) nodeList.innerHTML = `<div class="table-empty">Loading nodes...</div>`;
            if (resultPanel) resultPanel.innerHTML = `<div class="table-empty">노드를 선택하면 결과 상세가 표시됩니다.</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/runs/${flowRunId}/nodes`, { method: "GET", showLoading: false });
                this.nodes = Array.isArray(json.data) ? json.data : [];
                this.renderNodes();
                const firstResultNode = this.nodes.find((node) => node.RESULT_KIND !== "NONE") || this.nodes[0];
                if (firstResultNode) await this.selectNode(firstResultNode.FLOW_NODE_RUN_ID);
            } catch (error) {
                if (nodeList) nodeList.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Node load failed.")}</div>`;
            }
        },

        renderRunSummary() {
            const el = getContainerEl("#runSummary-${PAGE_CODE}");
            const run = this.selectedRun;
            if (!el) return;
            if (!run) {
                el.innerHTML = `<div class="table-empty">실행 이력을 선택하세요.</div>`;
                return;
            }
            const runMessage = String(run.MESSAGE || "").trim();
            el.innerHTML = `
                <article class="is-selected-run">
                    <div>
                        <span>Selected Run</span>
                        <strong>${this.escapeHtml(run.FLOW_NAME || "-")}</strong>
                        <small>Run #${this.escapeHtml(run.FLOW_RUN_ID)} · ${this.escapeHtml(run.STATUS || "-")} · ${this.escapeHtml(this.formatElapsedTime(run.STARTED_AT, run.FINISHED_AT, run.STATUS))}</small>
                    </div>
                    <button type="button" class="M04002-run-delete-btn" title="선택한 Run 이력 삭제" onclick="${PAGE_CODE}.deleteSelectedRun()">
                        <i class="far fa-trash-alt"></i>
                        <span>삭제</span>
                    </button>
                </article>
                <article><span>Nodes</span><strong>${this.formatNumber(run.NODE_COUNT)}</strong><small>${this.formatNumber(run.SUCCESS_NODE_COUNT)} success / ${this.formatNumber(run.FAILED_NODE_COUNT)} failed</small></article>
                <article>
                    <span>Started</span>
                    <strong>${this.escapeHtml(this.formatDateTime(run.STARTED_AT))}</strong>
                    <span class="M04002-summary-message">
                        <small title="${this.escapeHtml(runMessage)}">${this.escapeHtml(runMessage || "-")}</small>
                        ${runMessage ? `
                            <button type="button" class="M04002-summary-copy" title="메시지 복사" onclick="${PAGE_CODE}.copyRunMessage(event)" hidden>
                                <i class="far fa-copy"></i>
                            </button>
                        ` : ""}
                    </span>
                </article>
            `;
            requestAnimationFrame(() => this.updateRunSummaryCopyVisibility());
        },

        async deleteSelectedRun() {
            const run = this.selectedRun;
            if (!run || !run.FLOW_RUN_ID || this.isRunDeleteInProgress) return;
            const flowRunId = run.FLOW_RUN_ID;
            const flowName = run.FLOW_NAME || `Run #${flowRunId}`;
            const confirmMessage = [
                `${flowName}`,
                `Run #${flowRunId} 실행 이력과 노드 이력, RUN ID 기준 분석 결과 이력을 삭제합니다.`,
                "삭제 후에는 되돌릴 수 없습니다. 계속할까요?"
            ].join("\n");
            const confirmed = window.CommonMessage?.confirm
                ? await window.CommonMessage.confirm(confirmMessage, { defaultAction: "cancel" })
                : window.confirm(confirmMessage);
            if (!confirmed) return;

            let forceDelete = false;
            const runStatus = String(run.STATUS || "").trim().toUpperCase();
            const isActiveRun = ["RUNNING", "STARTED", "QUEUED", "PENDING"].includes(runStatus);
            if (CommonUtils.isAdminUser?.() && isActiveRun) {
                const forceMessage = [
                    "Running or pending run history cannot be deleted.",
                    "",
                    "관리자 권한으로 실행 중/대기 중 이력을 강제 삭제할 수 있습니다.",
                    "그래도 삭제하시겠습니까?"
                ].join("\n");
                const forceConfirmed = window.CommonMessage?.confirm
                    ? await window.CommonMessage.confirm(forceMessage, {
                        defaultAction: "cancel",
                        okText: "강제 삭제",
                        cancelText: "취소"
                    })
                    : window.confirm(forceMessage);
                if (!forceConfirmed) return;
                forceDelete = true;
            }

            this.isRunDeleteInProgress = true;
            const buttons = getContainerEl("#runSummary-${PAGE_CODE}")?.querySelectorAll(".M04002-run-delete-btn") || [];
            buttons.forEach((button) => button.setAttribute("disabled", "disabled"));
            try {
                const query = forceDelete ? "?force=true" : "";
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/runs/${encodeURIComponent(flowRunId)}${query}`, {
                    method: "DELETE"
                });
                this.selectedRun = null;
                this.selectedNode = null;
                this.nodes = [];
                this.currentModelDetail = null;
                this.lastResultTableJson = null;
                this.lastViolationSummary = null;
                this.lastSymbolicRuleSummary = null;
                this.nodeResultCache = new Map();
                const nodeList = getContainerEl("#nodeList-${PAGE_CODE}");
                const resultPanel = getContainerEl("#resultPanel-${PAGE_CODE}");
                if (nodeList) nodeList.innerHTML = `<div class="table-empty">Run 이력이 삭제되었습니다.</div>`;
                if (resultPanel) resultPanel.innerHTML = `<div class="table-empty">Run 이력이 삭제되었습니다.</div>`;
                window.CommonMessage?.success?.(json.message || `Run #${flowRunId} 이력이 삭제되었습니다.`, { copyable: false });
                const deletedPage = this.runPage || 1;
                await this.loadRuns(deletedPage);
                if (!this.runs.length && deletedPage > 1) {
                    await this.loadRuns(deletedPage - 1);
                }
            } catch (error) {
                window.CommonMessage?.error?.(error.message || "Run history delete failed.", { copyable: true });
                if (!window.CommonMessage) alert(error.message || "Run history delete failed.");
            } finally {
                this.isRunDeleteInProgress = false;
                getContainerEl("#runSummary-${PAGE_CODE}")?.querySelectorAll(".M04002-run-delete-btn").forEach((button) => {
                    button.removeAttribute("disabled");
                });
            }
        },

        updateRunSummaryCopyVisibility() {
            const box = getContainerEl(".M04002-summary-message");
            if (!box) return;
            const textEl = box.querySelector("small");
            const copyBtn = box.querySelector(".M04002-summary-copy");
            if (!textEl || !copyBtn) return;
            copyBtn.hidden = !(textEl.scrollWidth > textEl.clientWidth + 1);
        },

        renderNodes() {
            const el = getContainerEl("#nodeList-${PAGE_CODE}");
            if (!el) return;
            if (!this.nodes.length) {
                el.innerHTML = `<div class="table-empty">노드 실행 결과가 없습니다.</div>`;
                return;
            }
            const groupDefs = [
                { code: "M03001", label: "M03001" },
                { code: "M03002", label: "M03002" },
                { code: "M03003", label: "M03003" },
                { code: "M03004", label: "M03004" }
            ];
            const grouped = new Map(groupDefs.map((group) => [group.code, []]));
            const extras = [];
            this.nodes.forEach((node, index) => {
                const entry = { node, index };
                const groupCode = this.getNodeGroupCode(node);
                if (grouped.has(groupCode)) grouped.get(groupCode).push(entry);
                else extras.push(entry);
            });
            const renderGroup = (group, entries) => `
                <section class="M04002-node-group">
                    <header class="M04002-node-group-header">
                        <strong>${this.escapeHtml(group.label)}</strong>
                        <small>${this.formatNumber(entries.length)} nodes</small>
                    </header>
                    ${entries.length
                        ? entries.map(({ node, index }) => this.renderNodeCard(node, index)).join("")
                        : `<div class="M04002-node-group-empty">-</div>`}
                </section>
            `;
            el.innerHTML = [
                ...groupDefs.map((group) => renderGroup(group, grouped.get(group.code) || [])),
                ...(extras.length ? [renderGroup({ code: "OTHER", label: "OTHER" }, extras)] : [])
            ].join("");
        },

        renderNodeCard(node, index = 0) {
            return `
                <button type="button" class="M04002-node-card ${this.getNodeTone(node)} ${this.selectedNode?.FLOW_NODE_RUN_ID === node.FLOW_NODE_RUN_ID ? "is-selected" : ""}" onclick="${PAGE_CODE}.selectNode(${Number(node.FLOW_NODE_RUN_ID)})">
                    <span>
                        <i class="fas ${this.getNodeIcon(node)}"></i>
                        <strong>${this.escapeHtml(node.NODE_NAME || node.NODE_KEY || "-")}</strong>
                        ${this.renderNodeExecutionObject(node)}
                        <small>${this.escapeHtml(node.RESULT_KIND || "NONE")} ${node.RESULT_OBJECT_NAME ? `· ${this.escapeHtml(node.RESULT_OBJECT_NAME)}` : ""}</small>
                        ${this.renderNodeJobDesc(node)}
                    </span>
                    <b class="${this.getStatusClass(node.STATUS)}">${this.escapeHtml(node.STATUS || "-")}</b>
                </button>
            `;
        },

        getNodeGroupCode(node) {
            const payload = this.normalizeObject(node?.PAYLOAD);
            const params = this.normalizeObject(node?.RUNTIME_PARAMS);
            const candidates = [
                node?.REF_MENU_CODE,
                node?.NODE_TYPE,
                node?.JOB_GROUP,
                payload.REF_MENU_CODE,
                payload.refMenuCode,
                payload.NODE_TYPE,
                payload.nodeType,
                payload.JOB_GROUP,
                payload.jobGroup,
                params.REF_MENU_CODE,
                params.refMenuCode,
                params.NODE_TYPE,
                params.nodeType,
                params.JOB_GROUP,
                params.jobGroup
            ];
            for (const value of candidates) {
                const code = String(value || "").trim().toUpperCase();
                if (/^M\d{5}$/.test(code)) return code;
            }
            return "";
        },

        getNodeLevelFlowClass(node, index) {
            if (index <= 0) return "";
            const prev = this.nodes[index - 1] || {};
            const currentLevel = String(node?.RUN_LEVEL ?? "");
            const previousLevel = String(prev?.RUN_LEVEL ?? "");
            return currentLevel && previousLevel && currentLevel !== previousLevel ? "has-level-flow-marker" : "";
        },

        getNodeResultLayout(node = this.selectedNode, json = null) {
            const kind = String(node?.RESULT_KIND || "").toUpperCase();
            if (kind === "TABLE") return this.getTableResultLayout(node, json);
            if (kind === "MODEL") return this.getModelResultLayout(node, json);
            return EMPTY_RESULT_LAYOUT;
        },

        getTableResultLayout(node = this.selectedNode, json = null) {
            const layoutKey = String(json?.resultLayout?.key || "").trim().toUpperCase();
            const serverLayout = Object.values(TABLE_RESULT_LAYOUTS).find((layout) => layout.key === layoutKey);
            if (serverLayout) return serverLayout;
            const objectName = String(json?.objectName || node?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            return TABLE_RESULT_LAYOUTS[objectName] || GENERIC_TABLE_RESULT_LAYOUT;
        },

        getModelResultLayout(node = this.selectedNode, json = null) {
            const layoutKey = String(json?.resultLayout?.key || "").trim().toUpperCase();
            const serverLayout = Object.values(MODEL_RESULT_LAYOUTS).find((layout) => layout.key === layoutKey);
            if (serverLayout) return serverLayout;
            const modelName = String(json?.modelName || node?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            const metadata = json?.modelMetadata || {};
            const overview = json?.ruleSummary?.overview || {};
            const modelType = String(metadata.MODEL_TYPE || overview.MODEL_TYPE || "").toUpperCase();
            const algorithm = String(metadata.ALGORITHM || metadata.MINING_FUNCTION || "").toUpperCase();
            const isAssociationModel = (
                this.isAssociationRuleNode(node)
                || modelName.includes("ASSOCIATION")
                || modelType.includes("APRIORI")
                || modelType.includes("ASSOCIATION")
                || algorithm.includes("APRIORI")
                || algorithm.includes("ASSOCIATION")
            );
            return isAssociationModel ? MODEL_RESULT_LAYOUTS.ASSOCIATION_RULES : MODEL_RESULT_LAYOUTS.GENERIC_MODEL;
        },

        async selectNode(nodeRunId, page = 1, options = {}) {
            this.selectedNode = this.nodes.find((node) => Number(node.FLOW_NODE_RUN_ID) === Number(nodeRunId)) || null;
            this.resultPage = Math.max(1, Number(page || 1));
            this.renderNodes();
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel || !this.selectedNode) return;
            if (!options.forceRefresh && this.restoreNodeResultCache(nodeRunId)) return;
            this.currentModelDetail = null;
            this.readableRuleConditionFilter = "ALL";
            this.readableRuleConfidenceFilter = "ALL";
            this.predictedTypeFilter = "ALL";
            this.predictedTypeViewMode = "TYPE";
            this.ruleSummaryFilters = { conditionCount: "ALL", confidenceScope: "ALL", resultColumn: "ALL", conditionColumn: "ALL", resultHasValueYn: "ALL", page: 1, pageSize: 20, resultColumnPage: 1 };
            this.symbolicRuleFilters = { method: "ALL", targetColumn: "ALL" };
            this.symbolicViolationFilters = { method: "ALL", targetColumn: "ALL", resultScope: "ALL" };
            if (!options.preserveViolationRuleFilter) {
                this.violationRuleFilters = { ruleId: "", conditionCount: "ALL", confidenceScope: "NON_PERFECT", resultScope: "HIT", page: 1, pageSize: 20 };
            }
            this.lastViolationSummary = null;
            this.lastSymbolicRuleSummary = null;
            this.lastSymbolicViolationSummary = null;
            this.closeSymbolicRulePopup();
            const resultLayout = this.getNodeResultLayout(this.selectedNode);
            if (resultLayout.kind === "NONE") {
                panel.innerHTML = `<div class="table-empty">이 노드는 저장된 결과 테이블/모델이 없습니다.</div>`;
                this.snapshotNodeResultCache();
                return;
            }
            panel.innerHTML = `<div class="table-empty">Loading result...</div>`;
            if (resultLayout.kind === "MODEL") {
                await this.loadModelDetailSummary();
            } else {
                await this.loadResultTable(this.resultPage);
            }
        },

        async openViolationForRule(ruleId, conditionCount = "ALL") {
            const normalizedRuleId = String(ruleId || "").trim();
            if (!normalizedRuleId) return;
            const violationNode = this.findViolationNode();
            if (!violationNode) {
                alert("현재 Flow에서 규칙 위반 탐지 노드를 찾을 수 없습니다.");
                return;
            }
            const normalizedConditionCount = conditionCount === undefined || conditionCount === null || String(conditionCount).trim() === ""
                ? "ALL"
                : String(conditionCount);
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                ruleId: normalizedRuleId,
                conditionCount: normalizedConditionCount,
                confidenceScope: "NON_PERFECT",
                resultScope: "HIT",
                page: 1,
                pageSize: 20
            };
            if (!this.selectedNode || Number(this.selectedNode.FLOW_NODE_RUN_ID) !== Number(violationNode.FLOW_NODE_RUN_ID)) {
                await this.selectNode(violationNode.FLOW_NODE_RUN_ID, 1, { preserveViolationRuleFilter: true, forceRefresh: true });
                return;
            }
            await this.loadResultTable(1);
        },

        findViolationNode() {
            return (this.nodes || []).find((node) => this.isRuleViolationNode(node)) || null;
        },

        async openSymbolicViolationForRule(ruleId) {
            const normalizedRuleId = String(ruleId || "").trim();
            if (!normalizedRuleId) return;
            const violationNode = this.findSymbolicViolationNode();
            if (!violationNode) {
                alert("현재 Flow에서 연속형 규칙 위반 탐지 노드를 찾을 수 없습니다.");
                return;
            }
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                ruleId: normalizedRuleId,
                conditionCount: "ALL",
                confidenceScope: "ALL",
                resultScope: "CANDIDATE",
                page: 1,
                pageSize: 20
            };
            if (!this.selectedNode || Number(this.selectedNode.FLOW_NODE_RUN_ID) !== Number(violationNode.FLOW_NODE_RUN_ID)) {
                await this.selectNode(violationNode.FLOW_NODE_RUN_ID, 1, { preserveViolationRuleFilter: true, forceRefresh: true });
                return;
            }
            await this.loadResultTable(1);
        },

        findSymbolicViolationNode() {
            return (this.nodes || []).find((node) => this.isSymbolicViolationNode(node)) || null;
        },

        async loadResultTable(page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            this.resultPage = Math.max(1, Number(page || 1));
            this.showResultLoading("결과 테이블 조회 중...");
            const ruleModelName = this.getSelectedNodeRuleModelName(node);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                objectName: node.RESULT_OBJECT_NAME,
                menuCode: node.REF_MENU_CODE || "",
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                flowRunId: String(this.selectedRun?.FLOW_RUN_ID || ""),
                page: String(this.resultPage),
                pageSize: String(this.resultPageSize)
            });
            if (ruleModelName) params.set("ruleModelName", ruleModelName);
            if (this.isPredictedTypeNode(node) && this.predictedTypeFilter !== "ALL") {
                params.set("predictedTypeCase", this.predictedTypeFilter);
            }
            if (this.isViolationNode(node)) {
                const filters = this.violationRuleFilters || {};
                const criteria = this.getViolationDetectionCriteria(node);
                const ruleId = String(filters.ruleId || "").trim();
                if (ruleId) params.set("violationRuleId", ruleId);
                if (filters.conditionCount !== "ALL") params.set("violationConditionCount", String(filters.conditionCount));
                params.set("violationConfidenceScope", filters.confidenceScope === "ALL" ? "ALL" : "NON_PERFECT");
                params.set("violationResultScope", ["CANDIDATE", "MISS", "MAX_RULES"].includes(filters.resultScope) ? filters.resultScope : "HIT");
                params.set("violationMinConfidence", String(criteria.minConfidence));
                params.set("violationMinLift", String(criteria.minLift));
                params.set("violationMaxRules", String(criteria.maxRules));
                params.set("violationRulePage", String(Math.max(1, Number(filters.page || 1))));
                params.set("violationRulePageSize", String(this.normalizeRuleCardPageSize(filters.pageSize || 20)));
            }
            if (this.isSymbolicRuleNode(node)) {
                const filters = this.symbolicRuleFilters || {};
                const method = String(filters.method || "ALL").trim();
                const targetColumn = String(filters.targetColumn || "ALL").trim();
                if (method && method !== "ALL") params.set("symbolicMethod", method);
                if (targetColumn && targetColumn !== "ALL") params.set("symbolicTargetColumn", targetColumn);
            }
            if (this.isSymbolicViolationNode(node)) {
                const filters = this.symbolicViolationFilters || {};
                const method = String(filters.method || "ALL").trim();
                const targetColumn = String(filters.targetColumn || "ALL").trim();
                const resultScope = String(filters.resultScope || "ALL").trim().toUpperCase();
                if (method && method !== "ALL") params.set("symbolicViolationMethod", method);
                if (targetColumn && targetColumn !== "ALL") params.set("symbolicViolationTargetColumn", targetColumn);
                if (["HIT", "CLEAN"].includes(resultScope)) params.set("symbolicViolationResultScope", resultScope);
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/result-table?${params.toString()}`, { method: "GET", showLoading: false });
                if (this.selectedNode !== node) return;
                this.lastResultTableJson = json;
                this.currentExport = { filename: `${node.RESULT_OBJECT_NAME || "result"}.csv`, columns: json.columns || [], rows: json.data || [] };
                const resultLayout = this.getTableResultLayout(node, json);
                this.renderResultTable(json, resultLayout.title, resultLayout.kind);
            } catch (error) {
                this.renderResultError(error.message || "Result table load failed.");
            }
        },

        async loadModelView(viewType = "VR", page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            this.showResultLoading(`${viewType} 뷰 조회 중...`, viewType);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                viewType,
                page: String(page),
                pageSize: String(this.resultPageSize)
            });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/model-view?${params.toString()}`, { method: "GET", showLoading: false });
                if (this.selectedNode !== node) return;
                this.currentExport = { filename: `${json.viewName || node.RESULT_OBJECT_NAME || "model-view"}.csv`, columns: json.columns || [], rows: json.data || [] };
                this.renderModelView(json);
            } catch (error) {
                this.renderResultError(error.message || "Model view load failed.");
            }
        },

        async loadModelDetailSummary() {
            const node = this.selectedNode;
            if (!node) return;
            this.showResultLoading("모델 상세 분석 조회 중...");
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                limit: "12",
                includeSamples: "false"
            });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/model-detail-summary?${params.toString()}`, { method: "GET", showLoading: false });
                if (this.selectedNode !== node) return;
                this.currentModelDetail = json;
                this.currentExport = { filename: `${node.RESULT_OBJECT_NAME || "model-detail"}.csv`, columns: [], rows: [] };
                this.renderModelAnalysis(json, "readable");
                this.loadModelRuleSummary(1);
            } catch (error) {
                this.renderResultError(error.message || "Model detail summary load failed.");
            }
        },

        async loadModelRuleSummary(page = 1) {
            const node = this.selectedNode;
            if (!node || !this.currentModelDetail) return;
            const filters = this.ruleSummaryFilters || {};
            this.currentModelDetail.ruleSummaryLoading = true;
            this.currentModelDetail.ruleSummaryError = "";
            this.renderModelAnalysis(this.currentModelDetail, this.getActiveModelAnalysisTab());
            this.showResultLoading("규칙 요약 조회 중...");
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                flowRunId: String(this.selectedRun?.FLOW_RUN_ID || ""),
                page: String(Math.max(1, Number(page || 1))),
                pageSize: String(this.normalizeRuleCardPageSize(filters.pageSize || 20)),
                resultColumnPage: String(Math.max(1, Number(filters.resultColumnPage || 1))),
                resultColumnPageSize: "12"
            });
            if (filters.conditionCount !== "ALL") params.set("conditionCount", String(filters.conditionCount));
            if (filters.resultColumn !== "ALL") params.set("resultColumn", String(filters.resultColumn));
            if (filters.conditionColumn !== "ALL") params.set("conditionColumn", String(filters.conditionColumn));
            if (filters.resultHasValueYn !== "ALL") params.set("resultHasValueYn", String(filters.resultHasValueYn));
            if (filters.confidenceScope === "NON_PERFECT") params.set("confidenceScope", "NON_PERFECT");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/model-rule-summary?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    timeoutMs: 12000,
                    timeoutMessage: "규칙 요약 조회 시간이 길어져 중단했습니다."
                });
                if (this.selectedNode !== node || !this.currentModelDetail) return;
                this.currentModelDetail.ruleSummary = json;
                this.currentModelDetail.ruleSummaryLoading = false;
                this.ruleSummaryFilters.page = Number(json.page || page || 1);
                this.ruleSummaryFilters.pageSize = Number(json.pageSize || filters.pageSize || 20);
                this.ruleSummaryFilters.resultColumnPage = Number(json.resultTopPage || filters.resultColumnPage || 1);
                this.currentExport = this.buildRuleSummaryExport(node, json);
                this.renderModelAnalysis(this.currentModelDetail, this.getActiveModelAnalysisTab());
                this.snapshotNodeResultCache();
            } catch (error) {
                if (this.selectedNode !== node || !this.currentModelDetail) return;
                this.currentModelDetail.ruleSummaryLoading = false;
                this.currentModelDetail.ruleSummaryError = error.message || "Rule summary load failed.";
                this.renderModelAnalysis(this.currentModelDetail, this.getActiveModelAnalysisTab());
                this.snapshotNodeResultCache();
            }
        },

        showResultLoading(message = "Loading...", activeViewType = "") {
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel) return;
            panel.classList.add("is-loading");
            const activeType = String(activeViewType || "").toUpperCase();
            panel.querySelectorAll(".M04002-result-header nav button").forEach((button) => {
                const type = button.textContent?.trim?.().toUpperCase() || "";
                button.classList.toggle("is-active", Boolean(activeType) && type === activeType);
                button.disabled = true;
            });
            panel.querySelector(".M04002-result-loading-overlay")?.remove();
            const overlay = document.createElement("div");
            overlay.className = "M04002-result-loading-overlay";
            overlay.innerHTML = `
                <span><i class="fas fa-spinner fa-spin"></i></span>
                <strong>${this.escapeHtml(message)}</strong>
            `;
            panel.appendChild(overlay);
        },

        renderModelView(json) {
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel) return;
            panel.classList.remove("is-loading");
            const viewType = json.viewType || "VR";
            const readable = viewType === "VR" ? this.renderReadableRules(json.data || []) : "";
            const executionTitle = this.getNodeExecutionTitle(this.selectedNode, `${json.owner}.${json.modelName}`);
            panel.innerHTML = `
                <header class="M04002-result-header">
                    <div>
                        <span>Oracle ML Model View</span>
                        <strong class="M04002-result-exec-object">${this.escapeHtml(executionTitle)}</strong>
                        <small>Result Model ${this.escapeHtml(json.owner)}.${this.escapeHtml(json.modelName)} · ${this.escapeHtml(json.viewName || "")} · ${this.formatNumber(json.total)} rows</small>
                        ${this.renderSelectedNodeJobDesc()}
                    </div>
                    <nav>
                        ${["VR", "VI", "VG", "VA"].map((type) => `<button type="button" class="${type === viewType ? "is-active" : ""}" onclick="${PAGE_CODE}.loadModelView('${type}', 1)">${type}</button>`).join("")}
                    </nav>
                    ${this.renderSelectedNodeExecutionMeta()}
                </header>
                ${viewType === "VR" ? this.renderRuleFilterBar() : ""}
                ${readable}
                ${this.renderGrid(json.columns || [], json.data || [])}
                ${this.renderResultPager(json.page, json.pageSize, json.total, `${PAGE_CODE}.loadModelView('${viewType}',`)}
            `;
            this.snapshotNodeResultCache();
        },

        renderModelAnalysis(json = this.currentModelDetail, activeTab = "readable") {
            const resultLayout = this.getModelResultLayout(this.selectedNode, json);
            const renderer = typeof this[resultLayout.renderer] === "function" ? resultLayout.renderer : "renderAssociationModelAnalysis";
            this[renderer](json, activeTab, resultLayout);
        },

        renderAssociationModelAnalysis(json = this.currentModelDetail, activeTab = "readable", resultLayout = this.getModelResultLayout(this.selectedNode, json)) {
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel || !json) return;
            panel.classList.remove("is-loading");
            const readableActive = activeTab !== "detail";
            const modelHeaderLabel = this.getModelHeaderLabel(json);
            const modelOwner = json.owner || this.selectedNode?.RESULT_OWNER || "";
            const modelName = json.modelName || this.selectedNode?.RESULT_OBJECT_NAME || "";
            const executionTitle = this.getNodeExecutionTitle(this.selectedNode, `${modelOwner}.${modelName}`);
            panel.innerHTML = `
                <header class="M04002-result-header">
                    <div>
                        <span>${this.escapeHtml(this.selectedNode?.NODE_NAME || "Oracle ML Model View")}</span>
                        <strong class="M04002-result-exec-object">${this.escapeHtml(executionTitle)}</strong>
                        <small>Result Model ${this.escapeHtml(modelOwner)}.${this.escapeHtml(modelName)}</small>
                        ${this.renderSelectedNodeJobDesc()}
                    </div>
                    <em>${this.escapeHtml(modelHeaderLabel)}</em>
                    ${this.renderSelectedNodeExecutionMeta()}
                </header>
                <div class="M04002-model-tabs">
                    <button type="button" class="${readableActive ? "is-active" : ""}" onclick="${PAGE_CODE}.switchModelAnalysisTab('readable')">Readable Rules</button>
                    <button type="button" class="${!readableActive ? "is-active" : ""}" onclick="${PAGE_CODE}.switchModelAnalysisTab('detail')">Detail Views</button>
                </div>
                <div class="M04002-model-tab-panel ${readableActive ? "is-active" : ""}" data-model-tab="readable">
                    ${this.renderReadableRuleSummary(json)}
                </div>
                <div class="M04002-model-tab-panel ${!readableActive ? "is-active" : ""}" data-model-tab="detail">
                    ${this.renderModelDetailViews(json)}
                </div>
            `;
        },

        switchModelAnalysisTab(tabName) {
            this.renderModelAnalysis(this.currentModelDetail, tabName);
            this.snapshotNodeResultCache();
        },

        getActiveModelAnalysisTab() {
            const active = getContainerEl("#resultPanel-${PAGE_CODE} .M04002-model-tabs button.is-active");
            return /Detail/i.test(active?.textContent || "") ? "detail" : "readable";
        },

        getModelDetailView(viewType, json = this.currentModelDetail) {
            const views = Array.isArray(json?.views) ? json.views : [];
            return views.find((view) => view.viewType === viewType) || null;
        },

        replaceModelDetailView(nextView) {
            if (!this.currentModelDetail || !nextView?.viewType) return;
            const views = Array.isArray(this.currentModelDetail.views) ? this.currentModelDetail.views : [];
            const index = views.findIndex((view) => view.viewType === nextView.viewType);
            if (index >= 0) views[index] = { ...views[index], ...nextView };
            else views.push(nextView);
            this.currentModelDetail.views = views;
        },

        async loadReadableRulesPage(page = 1) {
            await this.loadModelAnalysisViewPage("VR", page, 12, "readable");
        },

        async loadDetailViewPage(viewType, page = 1) {
            await this.loadModelAnalysisViewPage(viewType, page, 8, "detail");
        },

        async loadModelAnalysisViewPage(viewType, page = 1, pageSize = 8, activeTab = "detail") {
            const node = this.selectedNode;
            if (!node) return;
            const nextPage = Math.max(1, Number(page || 1));
            this.showResultLoading(`${viewType} 샘플 페이지 조회 중...`);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                viewType,
                page: String(nextPage),
                pageSize: String(pageSize)
            });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/model-view?${params.toString()}`, { method: "GET", showLoading: false });
                if (this.selectedNode !== node || !this.currentModelDetail) return;
                this.replaceModelDetailView({
                    viewType: json.viewType || viewType,
                    viewName: json.viewName || `DM$${viewType}${node.RESULT_OBJECT_NAME || ""}`,
                    description: json.description || "",
                    existsYn: json.existsYn || "Y",
                    columns: json.columns || [],
                    data: json.data || [],
                    total: Number(json.total || 0),
                    page: Number(json.page || nextPage),
                    pageSize: Number(json.pageSize || pageSize)
                });
                this.currentExport = { filename: `${json.viewName || node.RESULT_OBJECT_NAME || "model-view"}.csv`, columns: json.columns || [], rows: json.data || [] };
                if (viewType === "VR") {
                    this.readableRuleConditionFilter = "ALL";
                    this.readableRuleConfidenceFilter = "ALL";
                }
                this.renderModelAnalysis(this.currentModelDetail, activeTab);
                this.snapshotNodeResultCache();
            } catch (error) {
                this.renderResultError(error.message || "Model view page load failed.");
            }
        },

        goReadableRulesPage() {
            const input = getContainerEl("#readableRulePage-${PAGE_CODE}");
            this.loadReadableRulesPage(input?.value || 1);
        },

        goDetailViewPage(viewType) {
            const input = getContainerEl(`#detailViewPage-${viewType}-${PAGE_CODE}`);
            this.loadDetailViewPage(viewType, input?.value || 1);
        },

        renderReadableRuleSummary(json) {
            const vi = this.getModelDetailView("VI", json) || {};
            const va = this.getModelDetailView("VA", json) || {};
            const vr = this.getModelDetailView("VR", json) || {};
            const itemDictionary = this.buildItemDictionary([...(vi.data || []), ...(va.data || [])]);
            const readableRules = this.buildReadableRuleCards(vr.data || [], itemDictionary);
            if (json?.ruleSummary || json?.ruleSummaryLoading || json?.ruleSummaryError) {
                return this.renderModelRuleSummaryDashboard(json, readableRules);
            }
            const conditionFiltered = this.applyReadableConditionFilter(readableRules);
            const filtered = this.excludeEmptyConsequent
                ? conditionFiltered.filter((rule) => !/값 정보 없음/.test(rule.thenText))
                : conditionFiltered;
            const visibleRuleCount = filtered.length;
            const baseRuleCount = readableRules.length;
            return `
                <div class="M04002-readable-rule-intro">
                    <div>
                        <strong>사람이 읽는 규칙 요약</strong>
                        <span>DM$VR 전체 ${this.formatNumber(vr.total || 0)}건 중 현재 ${this.getViewSampleRange(vr)} 샘플을 해석해 표시합니다. 조건 개수 칩을 선택하면 아래 규칙 목록이 바뀝니다.</span>
                    </div>
                    <div class="M04002-sample-controls">
                        <label>
                            <input type="checkbox" ${this.excludeEmptyConsequent ? "checked" : ""} onchange="${PAGE_CODE}.toggleExcludeEmptyConsequent(this.checked)">
                            <span>결과 정보 없음 제외</span>
                        </label>
                        ${this.renderSamplePageJump("readableRulePage-${PAGE_CODE}", vr, "${PAGE_CODE}.goReadableRulesPage()", "${PAGE_CODE}.loadReadableRulesPage")}
                    </div>
                </div>
                ${this.renderReadableRuleStats(readableRules, visibleRuleCount, baseRuleCount)}
                <div class="M04002-readable-rule-grid">
                    ${filtered.length ? filtered.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">표시할 규칙 행이 없습니다. Detail Views에서 원본 모델뷰를 확인하세요.</div>`}
                </div>
            `;
        },

        renderModelRuleSummaryDashboard(json, fallbackRules = []) {
            const summary = json?.ruleSummary;
            const loading = Boolean(json?.ruleSummaryLoading);
            const error = json?.ruleSummaryError || "";
            if (loading && !summary) {
                return `
                    <div class="M04002-readable-rule-intro">
                        <div>
                            <strong>사람이 읽는 규칙 요약</strong>
                            <span>Job 실행 시 저장된 규칙 요약 테이블을 조회하고 있습니다.</span>
                        </div>
                    </div>
                    <section class="M04002-readable-stats"><div class="table-empty">규칙 요약을 불러오는 중입니다...</div></section>
                    ${this.renderFallbackReadableRuleGrid(fallbackRules)}
                `;
            }
            if (!summary || Number(summary.overview?.TOTAL_RULES || 0) <= 0) {
                const message = error || "저장된 규칙 요약이 없습니다. 이 모델 Job을 다시 실행하면 요약 테이블이 생성됩니다.";
                return `
                    <div class="M04002-readable-rule-intro">
                        <div>
                            <strong>사람이 읽는 규칙 요약</strong>
                            <span>${this.escapeHtml(message)}</span>
                        </div>
                    </div>
                    ${this.renderFallbackReadableRuleGrid(fallbackRules)}
                `;
            }
            const overview = summary.overview || {};
            const rules = this.buildSummaryRuleCards(summary.rules || []);
            const totalPages = Math.max(1, Math.ceil(Number(summary.total || 0) / Number(summary.pageSize || 12)));
            const conditionColumnFilter = this.ruleSummaryFilters.conditionColumn === "ALL" ? "" : this.ruleSummaryFilters.conditionColumn;
            const conditionItems = [
                {
                    label: "전체",
                    value: "ALL",
                    total: overview.TOTAL_RULES,
                    nonPerfect: overview.NON_PERFECT_CONF_RULES
                },
                ...(summary.conditionDist || []).map((bucket) => ({
                    label: Number(bucket.CONDITION_COUNT || 0) > 0 ? `조건 ${this.formatNumber(bucket.CONDITION_COUNT)}개` : "조건 미해석",
                    value: String(Number(bucket.CONDITION_COUNT || 0)),
                    total: bucket.RULE_COUNT,
                    nonPerfect: bucket.NON_PERFECT_CONF_RULES
                }))
            ];
            return `
                <div class="M04002-readable-rule-intro">
                    <div>
                        <strong>사람이 읽는 규칙 요약</strong>
                        <span>${this.escapeHtml(this.describeRuleSummaryBasis(overview))} 조건 수나 결과 컬럼을 선택하면 아래 상세 규칙이 바뀝니다.</span>
                    </div>
                    <div class="M04002-sample-controls">
                        <button type="button" class="table-btn" onclick="${PAGE_CODE}.exportCurrent()">
                            <i class="fas fa-file-export"></i>
                            Export
                        </button>
                        ${this.renderSamplePageJump("ruleSummaryPage-${PAGE_CODE}", { page: summary.page, pageSize: summary.pageSize, total: summary.total }, "${PAGE_CODE}.goRuleSummaryPage()", "${PAGE_CODE}.loadModelRuleSummary", {
                            pageSizeId: "ruleSummaryPageSize-${PAGE_CODE}",
                            pageSizes: [20, 40, 100, 500, 1000],
                            onPageSizeChange: "${PAGE_CODE}.changeRuleSummaryPageSize(this.value)"
                        })}
                    </div>
                </div>
                <section class="M04002-readable-stats">
                    <div class="M04002-readable-stat-block">
                        <strong>규칙 요약</strong>
                        <div class="M04002-readable-stat-metrics">
                            <span><b>${this.formatNumber(overview.TOTAL_RULES)}</b><small>전체 규칙</small></span>
                            <span><b>${this.formatNumber(overview.MAPPED_RULES)}</b><small>조건/결과 매핑</small></span>
                            <span><b>${this.formatNumber(overview.MISSING_RESULT_RULES)}</b><small>결과 값 없음</small></span>
                            <span><b>${this.formatNumber(summary.total)}</b><small>필터 결과</small></span>
                        </div>
                    </div>
                    <div class="M04002-readable-condition-dist">
                        <strong>조건 수 선택</strong>
                        ${this.renderRuleConditionMatrix(conditionItems, this.ruleSummaryFilters.conditionCount, this.ruleSummaryFilters.confidenceScope || "ALL", "${PAGE_CODE}.selectRuleSummaryCondition")}
                    </div>
                </section>
                <section class="M04002-rule-facet-panel">
                    <div class="M04002-rule-facet-block">
                        <header>
                            <strong>결과 컬럼 Top 12</strong>
                            <div class="M04002-rule-facet-actions">
                                ${this.renderResultColumnPager(summary)}
                                <button type="button" class="${this.ruleSummaryFilters.resultColumn === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectRuleSummaryResult('ALL')">전체</button>
                            </div>
                        </header>
                        <div class="M04002-rule-facet-list">
                            ${(summary.resultTop || []).map((item) => {
                                const rawColumn = item.RESULT_COLUMN === "(RESULT UNKNOWN)" ? "__NULL__" : item.RESULT_COLUMN;
                                return `
                                    <button type="button" class="${this.ruleSummaryFilters.resultColumn === rawColumn ? "is-active" : ""}" onclick="${PAGE_CODE}.selectRuleSummaryResult('${this.escapeJs(rawColumn)}')">
                                        <span>${this.renderColumnAwareCell(item.RESULT_COLUMN, summary)}</span>
                                        <b>${this.formatNumber(item.RULE_COUNT)}</b>
                                    </button>
                                `;
                            }).join("")}
                        </div>
                    </div>
                    <div class="M04002-rule-facet-block is-condition">
                        <header>
                            <strong>조건 컬럼 ID 검색</strong>
                            <div class="M04002-rule-facet-actions">
                                <button type="button" onclick="${PAGE_CODE}.searchRuleSummaryConditionColumn()">Search</button>
                                <button type="button" class="${this.ruleSummaryFilters.conditionColumn === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.resetRuleSummaryConditionColumn()">Reset</button>
                            </div>
                        </header>
                        <label class="M04002-rule-condition-search">
                            <span>Condition Column</span>
                            <input id="ruleConditionColumnInput-${PAGE_CODE}" type="search" value="${this.escapeHtml(conditionColumnFilter)}" placeholder="예: COL001" onkeydown="${PAGE_CODE}.handleRuleSummaryConditionColumnKeydown(event)">
                        </label>
                    </div>
                </section>
                <div class="M04002-readable-rule-grid">
                    ${rules.length ? rules.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">선택한 조건에 해당하는 규칙이 없습니다.</div>`}
                </div>
                ${this.renderRuleSummaryPager(summary.page, totalPages)}
            `;
        },

        renderFallbackReadableRuleGrid(rules = []) {
            const filtered = this.excludeEmptyConsequent
                ? rules.filter((rule) => !/값 정보 없음/.test(rule.thenText))
                : rules;
            return `<div class="M04002-readable-rule-grid">${filtered.length ? filtered.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">표시할 규칙 행이 없습니다.</div>`}</div>`;
        },

        renderReadableRuleStats(rules = [], visibleRuleCount = 0, baseRuleCount = 0) {
            const stats = this.createReadableRuleStats(rules);
            const conditionItems = [
                { label: "전체", value: "ALL", total: baseRuleCount, nonPerfect: stats.nonPerfect },
                ...stats.conditionBuckets.map((bucket) => ({
                    label: bucket.label,
                    value: String(Number(bucket.conditionCount || 0)),
                    total: bucket.count,
                    nonPerfect: bucket.nonPerfect
                }))
            ];
            return `
                <section class="M04002-readable-stats">
                    <div class="M04002-readable-stat-block">
                        <strong>규칙 요약</strong>
                        <div class="M04002-readable-stat-metrics">
                            <span><b>${this.formatNumber(stats.total)}</b><small>현재 샘플 규칙</small></span>
                            <span><b>${this.formatNumber(stats.mapped)}</b><small>조건/결과 매핑</small></span>
                            <span><b>${this.formatNumber(stats.missingResult)}</b><small>결과 정보 없음</small></span>
                            <span><b>${this.formatNumber(visibleRuleCount)}</b><small>표시 중</small></span>
                        </div>
                    </div>
                    <div class="M04002-readable-condition-dist">
                        <strong>조건 수 선택</strong>
                        ${this.renderRuleConditionMatrix(conditionItems, this.readableRuleConditionFilter, this.readableRuleConfidenceFilter, "${PAGE_CODE}.selectReadableConditionFilter")}
                    </div>
                </section>
            `;
        },

        renderRuleConditionMatrix(items = [], activeValue = "ALL", activeConfidenceScope = "ALL", handlerName = "") {
            handlerName = resolvePageText(handlerName);
            const renderButtons = (countKey, confidenceScope) => items.map((item) => {
                const value = String(item.value ?? "ALL");
                const scope = String(confidenceScope || "ALL");
                const active = String(activeValue ?? "ALL") === value && String(activeConfidenceScope || "ALL") === scope;
                return `
                    <button type="button" class="${active ? "is-active" : ""}" onclick="${handlerName}('${this.escapeJs(value)}', '${this.escapeJs(scope)}')">
                        <small>${this.escapeHtml(item.label)}</small>
                        <b>${this.formatNumber(item[countKey])}</b>
                    </button>
                `;
            }).join("");
            return `
                <div class="M04002-condition-count-matrix">
                    <div class="M04002-condition-count-row">
                        <span>전체 규칙수</span>
                        <div class="M04002-condition-count-buttons">${renderButtons("total", "ALL")}</div>
                    </div>
                    <div class="M04002-condition-count-row">
                        <span>위반 후보 규칙수</span>
                        <div class="M04002-condition-count-buttons">${renderButtons("nonPerfect", "NON_PERFECT")}</div>
                    </div>
                </div>
            `;
        },

        applyReadableConditionFilter(rules = []) {
            const conditionFiltered = this.readableRuleConditionFilter === "ALL"
                ? rules
                : rules.filter((rule) => Number(rule.conditionCount || 0) === Number(this.readableRuleConditionFilter));
            return this.readableRuleConfidenceFilter === "NON_PERFECT"
                ? conditionFiltered.filter((rule) => this.isRuleViolationCandidate(rule.confidenceValue))
                : conditionFiltered;
        },

        selectReadableConditionFilter(value, confidenceScope = "ALL") {
            this.readableRuleConditionFilter = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.readableRuleConfidenceFilter = confidenceScope === "NON_PERFECT" ? "NON_PERFECT" : "ALL";
            this.renderModelAnalysis(this.currentModelDetail, "readable");
            this.snapshotNodeResultCache();
        },

        selectRuleSummaryCondition(value, confidenceScope = "ALL") {
            this.ruleSummaryFilters.conditionCount = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.ruleSummaryFilters.confidenceScope = confidenceScope === "NON_PERFECT" ? "NON_PERFECT" : "ALL";
            this.ruleSummaryFilters.page = 1;
            this.loadModelRuleSummary(1);
        },

        selectRuleSummaryResult(value) {
            this.ruleSummaryFilters.resultColumn = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.ruleSummaryFilters.page = 1;
            this.loadModelRuleSummary(1);
        },

        selectRuleSummaryConditionColumn(value) {
            this.ruleSummaryFilters.conditionColumn = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.ruleSummaryFilters.page = 1;
            this.loadModelRuleSummary(1);
        },

        handleRuleSummaryConditionColumnKeydown(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.searchRuleSummaryConditionColumn();
            }
        },

        searchRuleSummaryConditionColumn() {
            const input = getContainerEl("#ruleConditionColumnInput-${PAGE_CODE}");
            const value = String(input?.value || "").trim().toUpperCase();
            this.selectRuleSummaryConditionColumn(value || "ALL");
        },

        resetRuleSummaryConditionColumn() {
            const input = getContainerEl("#ruleConditionColumnInput-${PAGE_CODE}");
            if (input) input.value = "";
            this.selectRuleSummaryConditionColumn("ALL");
        },

        moveRuleSummaryResultColumns(direction) {
            const current = Math.max(1, Number(this.ruleSummaryFilters.resultColumnPage || 1));
            this.ruleSummaryFilters.resultColumnPage = Math.max(1, current + Number(direction || 0));
            this.loadModelRuleSummary(this.ruleSummaryFilters.page || 1);
        },

        renderResultColumnPager(summary = {}) {
            const page = Math.max(1, Number(summary.resultTopPage || this.ruleSummaryFilters.resultColumnPage || 1));
            const pageSize = Math.max(1, Number(summary.resultTopPageSize || 12));
            const total = Math.max(0, Number(summary.resultTopTotal || 0));
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const start = total ? ((page - 1) * pageSize) + 1 : 0;
            const end = total ? Math.min(total, page * pageSize) : 0;
            if (totalPages <= 1) {
                return `<span class="M04002-result-column-pager is-single"><small>전체 ${this.formatNumber(total)}개</small></span>`;
            }
            return `
                <span class="M04002-result-column-pager">
                    <button type="button" ${page <= 1 ? "disabled" : ""} onclick="${PAGE_CODE}.moveRuleSummaryResultColumns(-1)"><i class="fas fa-chevron-left"></i></button>
                    <small>${this.formatNumber(start)}-${this.formatNumber(end)} / ${this.formatNumber(total)}</small>
                    <button type="button" ${page >= totalPages ? "disabled" : ""} onclick="${PAGE_CODE}.moveRuleSummaryResultColumns(1)"><i class="fas fa-chevron-right"></i></button>
                </span>
            `;
        },

        goRuleSummaryPage() {
            const input = getContainerEl("#ruleSummaryPage-${PAGE_CODE}");
            this.loadModelRuleSummary(input?.value || 1);
        },

        changeRuleSummaryPageSize(value) {
            this.ruleSummaryFilters.pageSize = this.normalizeRuleCardPageSize(value);
            this.ruleSummaryFilters.page = 1;
            this.loadModelRuleSummary(1);
        },

        renderRuleSummaryPager(page, totalPages) {
            const current = Math.max(1, Number(page || 1));
            const total = Math.max(1, Number(totalPages || 1));
            const prev = Math.max(1, current - 1);
            const next = Math.min(total, current + 1);
            return `
                <footer class="M04002-pager">
                    <button type="button" ${current <= 1 ? "disabled" : ""} onclick="${PAGE_CODE}.loadModelRuleSummary(${prev})"><i class="fas fa-chevron-left"></i></button>
                    <span>${this.formatNumber(current)} / ${this.formatNumber(total)}</span>
                    <button type="button" ${current >= total ? "disabled" : ""} onclick="${PAGE_CODE}.loadModelRuleSummary(${next})"><i class="fas fa-chevron-right"></i></button>
                </footer>
            `;
        },

        createReadableRuleStats(rules = []) {
            const buckets = new Map();
            let mapped = 0;
            let missingResult = 0;
            let limited = 0;
            let nonPerfect = 0;
            (rules || []).forEach((rule) => {
                if (rule.mappingLevel === "mapped") mapped += 1;
                else limited += 1;
                if (this.isEmptyRuleText(rule.thenText)) missingResult += 1;
                const count = Number(rule.conditionCount || 0);
                const bucket = buckets.get(count) || { count: 0, nonPerfect: 0 };
                bucket.count += 1;
                if (this.isRuleViolationCandidate(rule.confidenceValue)) {
                    nonPerfect += 1;
                    bucket.nonPerfect += 1;
                }
                buckets.set(count, bucket);
            });
            const conditionBuckets = Array.from(buckets.entries())
                .map(([conditionCount, bucket]) => ({
                    conditionCount,
                    label: conditionCount > 0 ? `조건 ${conditionCount}개` : "조건 미해석",
                    count: bucket.count,
                    nonPerfect: bucket.nonPerfect
                }))
                .sort((a, b) => {
                    const aNumber = a.conditionCount > 0 ? a.conditionCount : 9999;
                    const bNumber = b.conditionCount > 0 ? b.conditionCount : 9999;
                    return aNumber - bNumber || a.label.localeCompare(b.label);
                });
            return {
                basis: "sample",
                total: rules.length,
                mapped,
                missingResult,
                limited,
                nonPerfect,
                conditionBuckets
            };
        },

        buildSummaryRuleCards(rows = []) {
            return (rows || []).map((row, index) => {
                const conditionText = this.resolveRuleSideText(row.CONDITION_TEXT || "");
                const resultText = this.resolveRuleSideText(row.RESULT_TEXT || "");
                const hasResultValue = row.RESULT_HAS_VALUE_YN === "Y";
                const thenText = resultText
                    || (row.RESULT_COLUMN ? `${row.RESULT_COLUMN}${hasResultValue ? "" : " (값 정보 없음)"}` : "결과 정보 없음");
                const mapped = Boolean(conditionText && (resultText || row.RESULT_COLUMN));
                const source = String(row.RULE_SOURCE || "").toUpperCase();
                const modelType = String(row.MODEL_TYPE || "").toUpperCase();
                const isConditional = source.includes("CONDITIONAL");
                const isDecisionTree = modelType.includes("DECISION_TREE");
                const supportCount = Number(row.SUPPORT_COUNT || 0);
                const conditionTotal = Number(row.CONDITION_TOTAL_COUNT || 0);
                const frequencyLabel = supportCount && conditionTotal
                    ? `${this.formatNumber(supportCount)} / ${this.formatNumber(conditionTotal)}`
                    : "-";
                const supportText = row.RULE_SUPPORT === null || row.RULE_SUPPORT === undefined ? "-" : this.formatPercentMetric(row.RULE_SUPPORT);
                const confidenceText = row.RULE_CONFIDENCE === null || row.RULE_CONFIDENCE === undefined ? "-" : this.formatPercentMetric(row.RULE_CONFIDENCE);
                const liftText = row.RULE_LIFT === null || row.RULE_LIFT === undefined ? "-" : this.formatDecimal(row.RULE_LIFT);
                const expectedViolationRate = this.formatExpectedViolationRate(row.RULE_CONFIDENCE);
                const exceptionCount = Math.max(0, conditionTotal - supportCount);
                const rawRuleId = String(row.RULE_ID || index + 1);
                const note = this.describeReadableRuleSentence({
                    conditionText,
                    thenText,
                    supportCount,
                    conditionTotal,
                    supportText,
                    confidenceText,
                    liftText,
                    isConditional
                });
                return {
                    ruleId: `Rule #${rawRuleId}`,
                    rawRuleId,
                    confidenceValue: row.RULE_CONFIDENCE,
                    canOpenViolation: this.isRuleViolationCandidate(row.RULE_CONFIDENCE),
                    mappingLevel: mapped ? "mapped" : "limited",
                    mappingLabel: mapped
                        ? (isDecisionTree ? "Decision Tree 목표 규칙" : (isConditional ? "조건부 확률 규칙" : "조건/결과 매핑됨"))
                        : "ID/지표 중심",
                    ifText: conditionText || "조건 항목 조합을 Detail Views에서 확인해야 합니다",
                    thenText,
                    note,
                    metrics: [
                        { label: "count", value: frequencyLabel },
                        { label: "support", value: supportText },
                        { label: "confidence", value: confidenceText },
                        { label: "예상 위반", value: expectedViolationRate },
                        { label: "예외 수", value: this.formatNumber(exceptionCount) },
                        { label: "lift", value: liftText }
                    ],
                    conditionCount: Number(row.CONDITION_COUNT || 0)
                };
            });
        },

        describeReadableRuleSentence(rule = {}) {
            const condition = String(rule.conditionText || "").trim();
            const result = String(rule.thenText || "").trim();
            if (!condition || !result || result === "결과 정보 없음") {
                return rule.isConditional
                    ? "조건 또는 결과 값을 화면에서 해석하지 못한 조건부 빈도/확률 규칙입니다."
                    : "Job 실행 시 저장된 규칙 요약 테이블에서 가져온 상세 규칙입니다.";
            }
            const supportCount = Number(rule.supportCount || 0);
            const conditionTotal = Number(rule.conditionTotal || 0);
            const confidence = rule.confidenceText || "-";
            const support = rule.supportText || "-";
            const lift = rule.liftText || "-";
            if (supportCount && conditionTotal) {
                return `${condition} 조건을 만족한 ${this.formatNumber(conditionTotal)}건 중 ${result} 결과가 ${this.formatNumber(supportCount)}건입니다. 조건 기준 확률은 ${confidence}, 전체 지지도는 ${support}, lift는 ${lift}입니다.`;
            }
            return `${condition} 조건일 때 ${result} 결과로 이어지는 조건부 규칙입니다. 조건 기준 확률은 ${confidence}, 전체 지지도는 ${support}, lift는 ${lift}입니다.`;
        },

        buildRuleSummaryExport(node = {}, json = {}) {
            const cards = this.buildSummaryRuleCards(json.rules || []);
            const rows = cards.map((card) => {
                const metricMap = {};
                (card.metrics || []).forEach((metric) => {
                    metricMap[String(metric.label || "").toUpperCase()] = metric.value;
                });
                return {
                    RULE_ID: card.ruleId,
                    IF: card.ifText,
                    THEN: card.thenText,
                    DESCRIPTION: card.note,
                    COUNT: metricMap.COUNT || "",
                    SUPPORT: metricMap.SUPPORT || "",
                    CONFIDENCE: metricMap.CONFIDENCE || "",
                    EXPECTED_VIOLATION_RATE: metricMap["예상 위반"] || "",
                    EXCEPTION_COUNT: metricMap["예외 수"] || "",
                    LIFT: metricMap.LIFT || "",
                    CONDITION_COUNT: card.conditionCount,
                    RULE_TYPE: card.mappingLabel
                };
            });
            return {
                filename: `${node.RESULT_OBJECT_NAME || "rule-summary"}_readable.csv`,
                columns: ["RULE_ID", "IF", "THEN", "DESCRIPTION", "COUNT", "SUPPORT", "CONFIDENCE", "EXPECTED_VIOLATION_RATE", "EXCEPTION_COUNT", "LIFT", "CONDITION_COUNT", "RULE_TYPE"],
                rows
            };
        },

        describeRuleSummaryBasis(overview = {}) {
            const modelType = String(overview.MODEL_TYPE || "").toUpperCase();
            const source = String(overview.RULE_SOURCE || "").toUpperCase();
            if (modelType.includes("DECISION_TREE")) {
                return "Decision Tree 분류 모델의 목표 컬럼을 기준으로 저장된 조건부 빈도/확률 규칙 현황을 보여줍니다.";
            }
            if (modelType.includes("APRIORI") && source.includes("CONDITIONAL")) {
                return "Apriori 모델 입력 데이터에서 계산한 조건부 빈도/확률 기반 규칙 현황을 보여줍니다.";
            }
            if (source.includes("ORACLE_DM_VR")) {
                return "Oracle ML 규칙 뷰를 해석해 저장한 규칙 현황을 보여줍니다.";
            }
            return "저장된 요약 테이블 기준으로 전체 규칙 현황을 보여줍니다.";
        },

        getModelHeaderLabel(json = {}) {
            const metadata = json.modelMetadata || {};
            const miningFunction = String(metadata.MINING_FUNCTION || "").trim();
            const algorithm = String(metadata.ALGORITHM || "").trim();
            if (miningFunction && algorithm) return `${miningFunction} · ${algorithm}`;
            if (algorithm) return algorithm;
            if (miningFunction) return miningFunction;
            const overview = json.ruleSummary?.overview || {};
            const modelType = String(overview.MODEL_TYPE || "").trim();
            return modelType || "Oracle ML Model View";
        },

        renderReadableRuleCard(rule) {
            const qualityClass = rule.mappingLevel === "mapped" ? "is-mapped" : "is-limited";
            const plainRuleId = rule.rawRuleId || this.getPlainRuleId(rule.ruleId);
            return `
                <article class="M04002-readable-rule-card ${qualityClass}">
                    <header>
                        <span class="M04002-rule-title">
                            <small>Rule #</small>
                            <code title="${this.escapeHtml(plainRuleId)}">${this.escapeHtml(plainRuleId)}</code>
                            <button type="button" class="M04002-rule-copy-btn" title="RULE ID 복사" onclick="${PAGE_CODE}.copyRuleId('${this.escapeJs(plainRuleId)}', event)">
                                <i class="far fa-copy"></i>
                            </button>
                        </span>
                        <span class="M04002-rule-card-actions">
                            <em>${this.escapeHtml(rule.mappingLabel)}</em>
                            ${rule.canOpenViolation
                                ? `<button type="button" class="M04002-rule-open-link" title="이 RULE ID로 위반탐지 결과 검색" onclick="${PAGE_CODE}.openViolationForRule('${this.escapeJs(plainRuleId)}', '${this.escapeJs(rule.conditionCount)}')">위반 조회</button>`
                                : ""}
                        </span>
                    </header>
                    <div class="M04002-readable-rule-sentence">
                        <b>IF</b>
                        <strong>${this.renderColumnAwareText(rule.ifText)}</strong>
                        <b>THEN</b>
                        <strong>${this.renderColumnAwareText(rule.thenText)}</strong>
                    </div>
                    <p>${this.renderColumnAwareText(rule.note)}</p>
                    <footer>
                        ${rule.metrics.map((metric) => `
                            <span>
                                <small>${this.escapeHtml(metric.label)}</small>
                                <strong>${this.escapeHtml(metric.value)}</strong>
                            </span>
                        `).join("")}
                    </footer>
                </article>
            `;
        },

        getPlainRuleId(ruleId) {
            return String(ruleId || "").replace(/^Rule\s*#?/i, "").trim();
        },

        async copyRuleId(ruleId, event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const text = String(ruleId || "").trim();
            await this.copyTextValue(text, "RULE ID copied.");
        },

        async copyRunMessage(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const text = String(this.selectedRun?.MESSAGE || "").trim();
            await this.copyTextValue(text, "Run message copied.");
        },

        async copyCurrentViolationSql(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const editor = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlEditor`);
            const text = editor ? editor.value : String(this.violationSql?.sql || "");
            await this.copyTextValue(text, "SQL copied.");
        },

        async copyTextValue(text, successMessage = "Copied.") {
            text = String(text || "").trim();
            if (!text) return;
            try {
                if (window.CommonMessage?.copyText) {
                    await CommonMessage.copyText(text);
                    CommonMessage.success?.(successMessage, { copyable: false, autoCloseMs: 1200 });
                    return;
                }
                await navigator.clipboard.writeText(text);
            } catch (error) {
                const textarea = document.createElement("textarea");
                textarea.value = text;
                textarea.setAttribute("readonly", "readonly");
                textarea.style.position = "fixed";
                textarea.style.left = "-9999px";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
            }
        },

        isPerfectConfidence(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return false;
            return number <= 1 ? number >= 0.999999 : number >= 99.9999;
        },

        isRuleViolationCandidate(value) {
            const number = Number(value);
            return Number.isFinite(number) && !this.isPerfectConfidence(number);
        },

        renderModelDetailViews(json) {
            const vi = this.getModelDetailView("VI", json) || {};
            const vr = this.getModelDetailView("VR", json) || {};
            const vg = this.getModelDetailView("VG", json) || {};
            const va = this.getModelDetailView("VA", json) || {};
            const itemTags = this.extractItemsetTags(vi.data || []).slice(0, 28);
            const rules = this.extractRuleRows(vr.data || []).slice(0, 10);
            return `
                <div class="M04002-model-visual-grid">
                    <div class="M04002-model-view-card is-vi">
                        ${this.renderModelViewHeader("VI", "Itemset/detail", vi)}
                        <div class="M04002-model-view-note">
                            <strong>Extracted itemset values</strong>
                            <span>DM$VI 원본 행의 ITEM / ATTRIBUTE / VALUE / NAME 계열 컬럼에서 추출한 값입니다.</span>
                        </div>
                        <div class="M04002-tag-cloud">
                            ${itemTags.length ? itemTags.map((item) => `<span style="--tag-weight:${item.weight}">${this.escapeHtml(item.label)}</span>`).join("") : `<small>DM$VI itemset row가 없습니다.</small>`}
                        </div>
                        ${this.renderSampleTable("DM$VI sample rows", vi.columns || [], vi.data || [], 5)}
                    </div>
                    <div class="M04002-model-view-card is-vr">
                        ${this.renderModelViewHeader("VR", "Top Rules", vr)}
                        ${rules.length ? `
                            <div class="M04002-rule-bars">
                                ${rules.map((rule) => `
                                    <div class="M04002-rule-bar">
                                        <span title="${this.escapeHtml(rule.label)}">${this.escapeHtml(rule.label)}</span>
                                        <em><i style="width:${Math.max(4, rule.score)}%"></i></em>
                                        <small>
                                            <b>${this.escapeHtml(rule.scoreName)}</b>
                                            <strong>${this.escapeHtml(rule.scoreValue)}</strong>
                                        </small>
                                    </div>
                                `).join("")}
                            </div>
                        ` : `<small>DM$VR rule row가 없습니다.</small>`}
                    </div>
                </div>
                <div class="M04002-model-view-card is-vg">
                    ${this.renderModelViewHeader("VG", "Global/detail", vg)}
                    ${this.renderSampleTable("", vg.columns || [], vg.data || [], 4)}
                </div>
                <div class="M04002-model-view-card is-va">
                    ${this.renderModelViewHeader("VA", "Attribute/detail rows", va)}
                    ${this.renderSampleTable("", va.columns || [], va.data || [], 6)}
                </div>
                <div class="M04002-model-view-card is-vr">
                    ${this.renderModelViewHeader("VR", "Rule/detail rows", vr)}
                    ${this.renderSampleTable("", vr.columns || [], vr.data || [], 8)}
                </div>
            `;
        },

        renderModelViewHeader(viewType, title, view = {}) {
            const exists = (view.existsYn || "N") === "Y";
            const hasRows = Array.isArray(view.data) && view.data.length > 0;
            const loadButton = exists && !hasRows
                ? `<button type="button" class="table-btn" onclick="${PAGE_CODE}.loadDetailViewPage('${this.escapeHtml(viewType)}', 1)">샘플 조회</button>`
                : "";
            return `
                <div class="M04002-model-view-header">
                    <span class="M04002-model-view-type">${this.escapeHtml(viewType)}</span>
                    <div>
                        <strong>${this.escapeHtml(title)}</strong>
                        <small>${this.escapeHtml(view.description || "")}</small>
                        <code>${this.escapeHtml(view.viewName || `DM$${viewType}`)}</code>
                        <small>${hasRows ? `샘플 ${this.escapeHtml(this.getViewSampleRange(view))} / 전체 ${this.formatNumber(view.total || 0)} rows` : "초기 로딩 속도를 위해 샘플은 아직 조회하지 않았습니다."}</small>
                    </div>
                    <em>${hasRows ? `${this.formatNumber(view.total || 0)} rows` : (exists ? "ready" : "none")}</em>
                </div>
                <div class="M04002-view-sample-toolbar">
                    <span>${hasRows ? "현재 표는 전체 데이터가 아니라 선택한 페이지의 샘플입니다." : "필요한 상세 뷰만 선택해서 조회합니다."}</span>
                    ${loadButton || this.renderSamplePageJump(`detailViewPage-${viewType}-${PAGE_CODE}`, view, `${PAGE_CODE}.goDetailViewPage('${viewType}')`, `${PAGE_CODE}.loadDetailViewPage('${viewType}', `)}
                </div>
            `;
        },

        renderSampleTable(title, columns, rows, limit = 6) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__").slice(0, 8);
            const safeRows = (rows || []).slice(0, limit);
            if (!safeColumns.length || !safeRows.length) return `<div class="table-empty">표시할 샘플 행이 없습니다.</div>`;
            return `
                <div class="M04002-sample-table-wrap">
                    ${title ? `<strong>${this.escapeHtml(title)} · 화면 표시 ${this.formatNumber(safeRows.length)}건</strong>` : `<strong>화면 표시 ${this.formatNumber(safeRows.length)}건</strong>`}
                    <table class="table-grid M04002-sample-table">
                        <thead><tr>${safeColumns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${safeRows.map((row) => `<tr>${safeColumns.map((column) => `<td title="${this.escapeHtml(row?.[column] ?? "")}">${this.escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        getViewSampleRange(view = {}) {
            const page = Math.max(1, Number(view.page || 1));
            const pageSize = Math.max(1, Number(view.pageSize || view.data?.length || 1));
            const total = Number(view.total || 0);
            const count = Array.isArray(view.data) ? view.data.length : 0;
            if (!total || !count) return "0건";
            const start = ((page - 1) * pageSize) + 1;
            const end = Math.min(total, start + count - 1);
            return `${this.formatNumber(start)}-${this.formatNumber(end)}건`;
        },

        getViewTotalPages(view = {}) {
            const pageSize = Math.max(1, Number(view.pageSize || view.data?.length || 1));
            return Math.max(1, Math.ceil(Number(view.total || 0) / pageSize));
        },

        renderSamplePageJump(inputId, view = {}, goOnclick, pageCall, options = {}) {
            inputId = resolvePageText(inputId);
            goOnclick = resolvePageText(goOnclick);
            pageCall = resolvePageText(pageCall);
            const pageSizeId = resolvePageText(options.pageSizeId || `${inputId}-pageSize`);
            const onPageSizeChange = resolvePageText(options.onPageSizeChange || "");
            const page = Math.max(1, Number(view.page || 1));
            const totalPages = this.getViewTotalPages(view);
            const callPage = (nextPage) => pageCall.endsWith(", ")
                ? `${pageCall}${nextPage})`
                : `${pageCall}(${nextPage})`;
            const selectedPageSize = this.normalizeRuleCardPageSize(view.pageSize || options.defaultPageSize || 20);
            const pageSizeSelect = Array.isArray(options.pageSizes) && options.pageSizes.length
                ? `
                    <select id="${this.escapeHtml(pageSizeId)}" title="Page size" onchange="${this.escapeHtml(onPageSizeChange)}">
                        ${options.pageSizes.map((size) => `<option value="${this.escapeHtml(size)}" ${Number(size) === selectedPageSize ? "selected" : ""}>${this.formatNumber(size)}</option>`).join("")}
                    </select>
                `
                : "";
            return `
                <div class="M04002-page-jump">
                    <button type="button" ${page <= 1 ? "disabled" : ""} onclick="${callPage(page - 1)}"><i class="fas fa-chevron-left"></i></button>
                    <label>
                        <span>Page</span>
                        <input id="${this.escapeHtml(inputId)}" type="number" min="1" max="${this.escapeHtml(totalPages)}" value="${this.escapeHtml(page)}" onkeydown="if(event.key==='Enter'){${goOnclick}}">
                        <small>/ ${this.formatNumber(totalPages)}</small>
                    </label>
                    <button type="button" onclick="${goOnclick}">Go</button>
                    <button type="button" ${page >= totalPages ? "disabled" : ""} onclick="${callPage(page + 1)}"><i class="fas fa-chevron-right"></i></button>
                    ${pageSizeSelect}
                </div>
            `;
        },

        renderTableResultSummary(json = {}) {
            const resultLayout = this.getTableResultLayout(this.selectedNode, json);
            const renderer = resultLayout.summaryRenderer;
            if (!renderer || typeof this[renderer] !== "function") return "";
            return this[renderer](json[resultLayout.summaryKey], json);
        },

        renderTableResultSummaryShell(json = {}) {
            return `<div id="tableResultSummary-${PAGE_CODE}">${this.renderTableResultSummary(json)}</div>`;
        },

        renderResultTable(json, title, type) {
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel) return;
            panel.classList.remove("is-loading");
            const resultObject = `${json.owner}.${json.objectName}`;
            const executionTitle = this.getNodeExecutionTitle(this.selectedNode, resultObject);
            panel.innerHTML = `
                <header class="M04002-result-header">
                    <div>
                        <span>${this.escapeHtml(type)}</span>
                        <strong class="M04002-result-exec-object">${this.escapeHtml(executionTitle)}</strong>
                        <small>Result Table ${this.escapeHtml(resultObject)} · ${this.formatNumber(json.total)} rows</small>
                        ${json.filteredByTarget ? `<small>Target ${this.escapeHtml(json.targetOwner)}.${this.escapeHtml(json.targetTable)}</small>` : ""}
                        ${json.ruleModelName ? `<small>Rule Model ${this.escapeHtml(json.ruleModelName)}</small>` : ""}
                        ${this.renderSelectedNodeJobDesc()}
                    </div>
                    ${this.renderSelectedNodeExecutionMeta()}
                </header>
                ${this.renderTableResultSummaryShell(json)}
                ${this.renderResultTableProfile(json.columns || [], json.data || [])}
                ${this.renderGrid(json.columns || [], json.data || [], json)}
                ${this.renderResultPager(json.page, json.pageSize, json.total, "${PAGE_CODE}.loadResultTable(")}
            `;
            this.snapshotNodeResultCache();
        },

        renderResultError(message) {
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel) return;
            panel.classList.remove("is-loading");
            panel.innerHTML = `<div class="table-error">${this.escapeHtml(message)}</div>`;
        },

        renderResultTableProfile(columns, rows) {
            const numericProfile = this.extractNumericProfile(rows || [], columns || []).slice(0, 8);
            if (!numericProfile.length) return "";
            return `
                <div class="M04002-table-profile-bars">
                    ${numericProfile.map((item) => `
                        <div class="M04002-profile-bar">
                            <span>${this.escapeHtml(item.column)}</span>
                            <em><i style="width:${item.width}%"></i></em>
                            <small>${this.escapeHtml(item.label)}</small>
                        </div>
                    `).join("")}
                </div>
            `;
        },

        renderViolationSummary(summary) {
            if (!summary) return "";
            this.lastViolationSummary = summary;
            const overview = summary.overview || {};
            const candidateOverview = summary.candidateOverview || {};
            const candidateItems = [
                {
                    label: "전체",
                    value: "ALL",
                    total: candidateOverview.TOTAL_RULES,
                    nonPerfect: candidateOverview.NON_PERFECT_CONF_RULES
                },
                ...(summary.candidateConditionDist || []).map((bucket) => ({
                    label: Number(bucket.CONDITION_COUNT || 0) > 0 ? `조건 ${this.formatNumber(bucket.CONDITION_COUNT)}개` : "조건 미해석",
                    value: String(Number(bucket.CONDITION_COUNT || 0)),
                    total: bucket.RULE_COUNT,
                    nonPerfect: bucket.NON_PERFECT_CONF_RULES
                }))
            ];
            const topRules = Array.isArray(summary.topRules) ? summary.topRules : [];
            const topColumns = Array.isArray(summary.topColumns) ? summary.topColumns : [];
            const ruleFilter = summary.ruleIdFilter ?? this.violationRuleFilters?.ruleId ?? "";
            const ruleFilterDisplay = String(ruleFilter || "");
            const candidateCount = this.getViolationCandidateCount(summary);
            const detectionOverview = summary.detectionOverview || {};
            const detectionCriteria = summary.detectionCriteria || this.getViolationDetectionCriteria();
            const scopedCandidateCount = Number(detectionOverview.CANDIDATE_RULE_COUNT ?? candidateCount ?? 0);
            const detectionEligibleCount = Number(detectionOverview.DETECTION_ELIGIBLE_RULE_COUNT || 0);
            const confidenceCutoffCount = Number(detectionOverview.CONFIDENCE_CUTOFF_COUNT || 0);
            const liftCutoffCount = Number(detectionOverview.LIFT_CUTOFF_COUNT || 0);
            const maxRulesCutoffCount = Number(detectionOverview.MAX_RULES_CUTOFF_COUNT || 0);
            const violatedRuleCount = Number(overview.VIOLATED_RULE_COUNT || 0);
            const noViolationRuleCount = Math.max(0, detectionEligibleCount - violatedRuleCount);
            const noViolationAfterDetectionCount = Math.max(0, detectionEligibleCount - violatedRuleCount);
            const activeScopeLabel = this.violationRuleFilters?.confidenceScope === "ALL" ? "전체 규칙" : "100% 아닌 규칙";
            const resultScope = summary.resultScope || this.violationRuleFilters?.resultScope || "HIT";
            const resultScopeMessage = resultScope === "CANDIDATE"
                ? "선택 후보 규칙 전체를 표시합니다."
                : resultScope === "MAX_RULES"
                    ? "전체 후보 기준 탐지 순위가 max rules 범위 밖인 규칙을 표시합니다."
                : resultScope === "MISS"
                    ? "선택 후보 중 실제 위반 Row가 없는 규칙을 표시합니다."
                    : "실제 위반 Row가 발생한 규칙을 표시합니다.";
            return `
                <section class="M04002-violation-summary">
                    <div class="M04002-violation-intro">
                        <div>
                            <strong>규칙 위반 탐지 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner || "-")}.${this.escapeHtml(summary.targetTable || "-")}${summary.ruleModelName ? ` · Rule Model ${this.escapeHtml(summary.ruleModelName)}` : ""} · ${this.escapeHtml(activeScopeLabel)} 기준</span>
                        </div>
                        ${this.renderViolationRulePager(summary)}
                    </div>
                    <section class="M04002-violation-condition-panel">
                        <strong>조건 수 선택</strong>
                        ${this.renderRuleConditionMatrix(candidateItems, this.violationRuleFilters?.conditionCount || "ALL", this.violationRuleFilters?.confidenceScope || "NON_PERFECT", "${PAGE_CODE}.selectViolationCondition")}
                        <div class="M04002-violation-inline-summary">
                            <button type="button" class="${resultScope === "CANDIDATE" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('CANDIDATE')">
                                <small>선택 후보</small>
                                <b>${this.formatNumber(scopedCandidateCount)}</b>
                                <em>${this.escapeHtml(activeScopeLabel)}</em>
                            </button>
                            <button type="button" disabled>
                                <small>탐지 대상</small>
                                <b>${this.formatNumber(detectionEligibleCount)}</b>
                                <em>min/conf/lift/max 적용</em>
                            </button>
                            <button type="button" class="is-hit ${resultScope === "HIT" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('HIT')">
                                <small>위반 발생</small>
                                <b>${this.formatNumber(violatedRuleCount)}</b>
                                <em>아래 목록 표시</em>
                            </button>
                            <button type="button" class="is-muted ${resultScope === "MISS" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('MISS')">
                                <small>위반 없음</small>
                                <b>${this.formatNumber(noViolationRuleCount)}</b>
                                <em>위반 없음 표시</em>
                            </button>
                            <button type="button" class="is-muted ${resultScope === "MAX_RULES" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('MAX_RULES')">
                                <small>max rules 제외</small>
                                <b>${this.formatNumber(maxRulesCutoffCount)}</b>
                                <em>100위 밖 표시</em>
                            </button>
                            <button type="button" disabled>
                                <small>위반 Row / 건수</small>
                                <b>${this.formatNumber(overview.VIOLATED_ROW_COUNT)} / ${this.formatNumber(overview.VIOLATION_COUNT)}</b>
                                <em>실제 탐지 결과</em>
                            </button>
                            ${ruleFilterDisplay ? `<b>RULE ID 검색: ${this.escapeHtml(ruleFilterDisplay)}</b>` : ""}
                        </div>
                        <div class="M04002-violation-reason-strip">
                            <span><small>confidence 미달</small><b>${this.formatNumber(confidenceCutoffCount)}</b></span>
                            <span><small>lift 미달</small><b>${this.formatNumber(liftCutoffCount)}</b></span>
                            <span><small>max rules 제외</small><b>${this.formatNumber(maxRulesCutoffCount)}</b></span>
                            <span><small>탐지 후 위반 없음</small><b>${this.formatNumber(noViolationAfterDetectionCount)}</b></span>
                            <em>탐지 기준: confidence >= ${this.formatPercentMetric(detectionCriteria.minConfidence)}, lift >= ${this.formatDecimal(detectionCriteria.minLift)}, max rules ${this.formatNumber(detectionCriteria.maxRules)}</em>
                        </div>
                        <div class="M04002-violation-scope-note">${this.escapeHtml(resultScopeMessage)}</div>
                    </section>
                    <section class="M04002-rule-facet-panel is-violation">
                        <div class="M04002-rule-facet-block">
                            <header>
                                <strong>위반 결과 컬럼 Top</strong>
                            </header>
                            <div class="M04002-rule-facet-list">
                                ${topColumns.length ? topColumns.map((item) => `
                                    <button type="button" onclick="${PAGE_CODE}.openViolationSqlPopup('column', '${this.escapeJs(item.RESULT_COLUMN)}')">
                                        <span>${this.renderColumnAwareCell(item.RESULT_COLUMN, summary)}</span>
                                        <b>${this.formatNumber(item.VIOLATION_COUNT)}</b>
                                    </button>
                                `).join("") : `<span>표시할 위반 결과 컬럼이 없습니다.</span>`}
                            </div>
                        </div>
                        <div class="M04002-rule-facet-block is-condition">
                            <header>
                                <strong>RULE ID 검색</strong>
                                <div class="M04002-rule-facet-actions">
                                    <button type="button" onclick="${PAGE_CODE}.searchViolationRule()">Search</button>
                                    <button type="button" onclick="${PAGE_CODE}.resetViolationRuleSearch()">Reset</button>
                                </div>
                            </header>
                            <label class="M04002-rule-condition-search">
                                <span>RULE ID</span>
                                <input id="violationRuleSearch-${PAGE_CODE}" type="search" value="${this.escapeHtml(ruleFilterDisplay)}" placeholder="예: COND_..." onkeydown="${PAGE_CODE}.handleViolationRuleSearchKeydown(event)">
                            </label>
                        </div>
                    </section>
                    ${topRules.length ? `
                        <div class="M04002-violation-rule-grid">
                            ${topRules.map((rule) => {
                                const hasViolation = Number(rule.VIOLATION_COUNT || 0) > 0;
                                return `
                                <article class="${hasViolation ? "" : "is-no-violation"}">
                                    <header>
                                        <strong>${this.escapeHtml(rule.RULE_ID)}</strong>
                                        <button type="button" class="${hasViolation ? "" : "is-muted"}" onclick="${PAGE_CODE}.openViolationSqlPopup('rule', '${this.escapeJs(rule.RULE_ID)}')">
                                            ${hasViolation ? `${this.formatNumber(rule.VIOLATION_COUNT)}건` : (rule.DETECTION_SCANNED_YN === "N" ? "max rules 제외" : "위반 없음")}
                                        </button>
                                    </header>
                                    <p>
                                        <b>IF</b>
                                        ${this.renderColumnAwareText(rule.CONDITION_TEXT || "", summary)}
                                        <b>THEN</b>
                                        ${this.renderColumnAwareCell(rule.RESULT_COLUMN, summary)} = ${this.escapeHtml(rule.EXPECTED_VALUE || "")}
                                    </p>
                                    <footer>
                                        <span><small>confidence</small><b>${this.formatPercentMetric(rule.RULE_CONFIDENCE)}</b></span>
                                        <span><small>예상 위반</small><b>${this.formatExpectedViolationRate(rule.RULE_CONFIDENCE)}</b></span>
                                        <span><small>lift</small><b>${this.formatDecimal(rule.RULE_LIFT)}</b></span>
                                        <span><small>support</small><b>${this.formatPercentMetric(rule.RULE_SUPPORT)}</b></span>
                                        <span><small>탐지 순위</small><b>${rule.DETECTION_RN ? this.formatNumber(rule.DETECTION_RN) : "-"}</b></span>
                                        <span><small>score</small><b>${this.formatDecimal(rule.AVG_VIOLATION_SCORE)}</b></span>
                                    </footer>
                                </article>
                            `;
                            }).join("")}
                        </div>
                    ` : `<div class="table-empty">${this.getViolationEmptyMessage(ruleFilter, resultScope, scopedCandidateCount, detectionEligibleCount, maxRulesCutoffCount)}</div>`}
                </section>
            `;
        },

        getViolationEmptyMessage(ruleFilter, resultScope, candidateCount, detectionEligibleCount, maxRulesCutoffCount) {
            if (ruleFilter && Number(candidateCount || 0) === 0) {
                return "검색한 RULE ID에 해당하는 후보 규칙이 없습니다.";
            }
            if (Number(maxRulesCutoffCount || 0) > 0 && Number(detectionEligibleCount || 0) === 0) {
                return "해당 후보 규칙은 이번 실행의 max rules 범위 밖이라 실제 위반 탐지 대상에서 제외되었습니다.";
            }
            if (resultScope === "HIT") {
                return "실제 위반 Row가 발생한 규칙이 없습니다. 후보 전체나 max rules 제외 건수도 함께 확인하세요.";
            }
            if (resultScope === "MAX_RULES") {
                return "max rules 범위 밖으로 제외된 후보 규칙이 없습니다.";
            }
            if (resultScope === "MISS") {
                return "실제 탐지 대상 중 위반 Row가 없는 규칙이 없습니다.";
            }
            return "표시할 규칙이 없습니다.";
        },

        getViolationCandidateCount(summary = {}) {
            const conditionCount = String(this.violationRuleFilters?.conditionCount ?? "ALL");
            const confidenceScope = this.violationRuleFilters?.confidenceScope === "ALL" ? "ALL" : "NON_PERFECT";
            if (conditionCount === "ALL") {
                const overview = summary.candidateOverview || {};
                return confidenceScope === "NON_PERFECT"
                    ? overview.NON_PERFECT_CONF_RULES
                    : overview.TOTAL_RULES;
            }
            const row = (summary.candidateConditionDist || []).find((item) => String(Number(item.CONDITION_COUNT || 0)) === conditionCount);
            if (!row) return 0;
            return confidenceScope === "NON_PERFECT" ? row.NON_PERFECT_CONF_RULES : row.RULE_COUNT;
        },

        renderViolationRulePager(summary = {}) {
            const page = Math.max(1, Number(summary.topRulePage || this.violationRuleFilters?.page || 1));
            const pageSize = this.normalizeRuleCardPageSize(summary.topRulePageSize || this.violationRuleFilters?.pageSize || 20);
            const total = Math.max(0, Number(summary.topRuleTotal || 0));
            return this.renderSamplePageJump(
                "violationRulePage-${PAGE_CODE}",
                { page, pageSize, total },
                "${PAGE_CODE}.goViolationRulePage()",
                "${PAGE_CODE}.loadViolationRulePage",
                {
                    pageSizeId: "violationRulePageSize-${PAGE_CODE}",
                    pageSizes: [20, 40, 100, 500, 1000],
                    onPageSizeChange: "${PAGE_CODE}.changeViolationRulePageSize(this.value)"
                }
            );
        },

        handleViolationRuleSearchKeydown(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.searchViolationRule();
            }
        },

        async searchViolationRule() {
            const input = getContainerEl("#violationRuleSearch-${PAGE_CODE}");
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                ruleId: String(input?.value || "").trim(),
                page: 1,
                pageSize: this.normalizeRuleCardPageSize(this.violationRuleFilters?.pageSize || 20)
            };
            await this.loadResultTable(this.resultPage || 1);
        },

        async resetViolationRuleSearch() {
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                ruleId: "",
                page: 1,
                pageSize: this.normalizeRuleCardPageSize(this.violationRuleFilters?.pageSize || 20)
            };
            await this.loadResultTable(this.resultPage || 1);
        },

        async selectViolationCondition(value, confidenceScope = "NON_PERFECT") {
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                conditionCount: value === undefined || value === null || value === "" ? "ALL" : String(value),
                confidenceScope: confidenceScope === "ALL" ? "ALL" : "NON_PERFECT",
                page: 1,
                pageSize: this.normalizeRuleCardPageSize(this.violationRuleFilters?.pageSize || 20)
            };
            await this.loadResultTable(1);
        },

        async selectViolationResultScope(resultScope = "HIT") {
            const normalizedScope = ["CANDIDATE", "MISS", "MAX_RULES"].includes(resultScope) ? resultScope : "HIT";
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                resultScope: normalizedScope,
                page: 1,
                pageSize: this.normalizeRuleCardPageSize(this.violationRuleFilters?.pageSize || 20)
            };
            await this.loadResultTable(1);
        },

        async selectSymbolicRuleFilter(kind, value = "ALL") {
            const normalizedKind = String(kind || "").trim();
            const normalizedValue = String(value || "ALL").trim() || "ALL";
            this.symbolicRuleFilters = {
                ...(this.symbolicRuleFilters || { method: "ALL", targetColumn: "ALL" }),
                [normalizedKind === "targetColumn" ? "targetColumn" : "method"]: normalizedValue
            };
            await this.loadResultTable(1);
        },

        async resetSymbolicRuleFilters() {
            this.symbolicRuleFilters = { method: "ALL", targetColumn: "ALL" };
            await this.loadResultTable(1);
        },

        async selectSymbolicViolationFilter(kind, value = "ALL") {
            const normalizedKind = String(kind || "").trim();
            let normalizedValue = String(value || "ALL").trim() || "ALL";
            if (normalizedKind === "resultScope") {
                normalizedValue = ["ALL", "HIT", "CLEAN"].includes(normalizedValue.toUpperCase())
                    ? normalizedValue.toUpperCase()
                    : "ALL";
            }
            this.symbolicViolationFilters = {
                ...(this.symbolicViolationFilters || { method: "ALL", targetColumn: "ALL", resultScope: "ALL" }),
                [normalizedKind === "targetColumn" ? "targetColumn" : (normalizedKind === "resultScope" ? "resultScope" : "method")]: normalizedValue
            };
            await this.loadResultTable(1);
        },

        async resetSymbolicViolationFilters() {
            this.symbolicViolationFilters = { method: "ALL", targetColumn: "ALL", resultScope: "ALL" };
            await this.loadResultTable(1);
        },

        async loadViolationRulePage(page = 1) {
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                page: Math.max(1, Number(page || 1)),
                pageSize: this.normalizeRuleCardPageSize(this.violationRuleFilters?.pageSize || 20)
            };
            await this.loadResultTable(this.resultPage || 1);
        },

        async changeViolationRulePageSize(value) {
            this.violationRuleFilters = {
                ...(this.violationRuleFilters || {}),
                page: 1,
                pageSize: this.normalizeRuleCardPageSize(value)
            };
            await this.loadResultTable(this.resultPage || 1);
        },

        async goViolationRulePage() {
            const input = getContainerEl("#violationRulePage-${PAGE_CODE}");
            await this.loadViolationRulePage(input?.value || 1);
        },

        openViolationSqlPopup(kind = "all", value = "") {
            const sql = this.createViolationSql(kind, value);
            if (!sql) return;
            const ruleColumns = this.getViolationRuleColumns(kind, value);
            const ruleDetail = this.getViolationRuleDetail(kind, value);
            const supportsRealtime = Boolean(this.isViolationNode(this.selectedNode) && kind === "rule" && String(value || "").trim());
            const label = kind === "column"
                ? `결과 컬럼 ${value}`
                : (kind === "rule" ? `Rule ${value}` : "전체 위반");
            this.violationSql = {
                sql,
                mode: "SAVED",
                kind,
                value,
                supportsRealtime,
                page: 1,
                pageSize: 50,
                freezeColumns: 2,
                total: 0,
                columns: [],
                rows: [],
                columnWidths: {},
                ruleColumns,
                ruleDetail,
                title: `${label} 위반 Row 조회`
            };
            this.renderViolationSqlPopup();
            window.setTimeout(() => this.executeViolationSql(1), 0);
        },

        getViolationRuleDetail(kind = "all", value = "") {
            if (kind !== "rule" || !value) return null;
            if (this.isSymbolicViolationNode(this.selectedNode)) {
                const summary = this.lastSymbolicViolationSummary || {};
                return (summary.topRules || []).find((item) => String(item.RULE_ID) === String(value)) || null;
            }
            const summary = this.lastViolationSummary || {};
            return (summary.topRules || []).find((item) => String(item.RULE_ID) === String(value)) || null;
        },

        getViolationRuleColumns(kind = "all", value = "") {
            const columns = new Set();
            if (this.isSymbolicViolationNode(this.selectedNode)) {
                const summary = this.lastSymbolicViolationSummary || {};
                if (kind === "column" && value) {
                    columns.add(String(value).trim().toUpperCase());
                }
                if (kind === "rule" && value) {
                    const rule = (summary.topRules || []).find((item) => String(item.RULE_ID) === String(value));
                    this.parseFeatureList(rule?.FEATURE_COLUMNS || "").forEach((column) => columns.add(column.trim().toUpperCase()));
                    if (rule?.TARGET_COLUMN) columns.add(String(rule.TARGET_COLUMN).trim().toUpperCase());
                }
                if (kind === "all") {
                    (summary.topTargets || []).slice(0, 5).forEach((item) => {
                        if (item.TARGET_COLUMN) columns.add(String(item.TARGET_COLUMN).trim().toUpperCase());
                    });
                }
                return [...columns].filter(Boolean);
            }
            const summary = this.lastViolationSummary || {};
            if (kind === "column" && value) {
                columns.add(String(value).trim().toUpperCase());
            }
            if (kind === "rule" && value) {
                const rule = (summary.topRules || []).find((item) => String(item.RULE_ID) === String(value));
                this.extractColumnsFromRuleText(rule?.CONDITION_TEXT || "").forEach((column) => columns.add(column));
                if (rule?.RESULT_COLUMN) columns.add(String(rule.RESULT_COLUMN).trim().toUpperCase());
            }
            if (kind === "all") {
                (summary.topColumns || []).slice(0, 5).forEach((item) => {
                    if (item.RESULT_COLUMN) columns.add(String(item.RESULT_COLUMN).trim().toUpperCase());
                });
            }
            return [...columns].filter(Boolean);
        },

        extractColumnsFromRuleText(text) {
            const matches = String(text || "").match(/\b[A-Za-z][A-Za-z0-9_$#]{0,127}\b(?=\s*=)/g) || [];
            return [...new Set(matches.map((item) => item.trim().toUpperCase()).filter(Boolean))];
        },

        createViolationSql(kind = "all", value = "") {
            const node = this.selectedNode;
            if (!node) {
                alert("선택된 노드가 없습니다.");
                return "";
            }
            if (this.isSymbolicViolationNode(node)) {
                return this.createSymbolicViolationSql(kind, value);
            }
            const resultOwner = this.normalizeIdentifierParam(node.RESULT_OWNER);
            const resultTable = this.normalizeIdentifierParam(node.RESULT_OBJECT_NAME);
            const targetOwner = this.normalizeIdentifierParam(node.TARGET_OWNER);
            const targetTable = this.normalizeIdentifierParam(node.TARGET_TABLE);
            if (!resultOwner || !resultTable || !targetOwner || !targetTable) {
                alert("위반 결과 또는 Target Table 정보가 부족합니다.");
                return "";
            }
            const ruleModelName = this.getSelectedNodeRuleModelName(node);
            const filters = [
                `V.TARGET_OWNER = ${this.sqlLiteral(targetOwner)}`,
                `V.TARGET_TABLE = ${this.sqlLiteral(targetTable)}`
            ];
            const flowRunId = Number(this.selectedRun?.FLOW_RUN_ID || 0);
            if (flowRunId > 0) {
                filters.push("V.RUN_SOURCE_TYPE = 'FLOW_WORK'");
                filters.push(`V.RUN_ID = ${flowRunId}`);
            }
            if (ruleModelName) filters.push(`V.MODEL_NAME = ${this.sqlLiteral(ruleModelName)}`);
            const violationFilters = this.violationRuleFilters || {};
            if (violationFilters.conditionCount !== "ALL") {
                filters.push(`V.CONDITION_COUNT = ${this.sqlLiteral(violationFilters.conditionCount)}`);
            }
            if (violationFilters.confidenceScope !== "ALL") {
                filters.push("V.RULE_CONFIDENCE IS NOT NULL AND ((V.RULE_CONFIDENCE <= 1 AND V.RULE_CONFIDENCE < 0.999999) OR (V.RULE_CONFIDENCE > 1 AND V.RULE_CONFIDENCE < 99.9999))");
            }
            if (kind === "column" && value) filters.push(`V.RESULT_COLUMN = ${this.sqlLiteral(value)}`);
            if (kind === "rule" && value) filters.push(`V.RULE_ID = ${this.sqlLiteral(value)}`);
            return [
                "SELECT V.VIOLATION_ID AS V_VIOLATION_ID",
                "     , V.RULE_ID AS V_RULE_ID",
                "     , V.RESULT_COLUMN AS V_RESULT_COLUMN",
                "     , V.EXPECTED_VALUE AS V_EXPECTED_VALUE",
                "     , V.ACTUAL_VALUE AS V_ACTUAL_VALUE",
                "     , V.VIOLATION_SCORE AS V_VIOLATION_SCORE",
                "     , V.RULE_CONFIDENCE AS V_RULE_CONFIDENCE",
                "     , V.RULE_LIFT AS V_RULE_LIFT",
                "     , V.CASE_ID AS V_CASE_ID",
                "     , T.*",
                `  FROM ${this.quoteSqlName(resultOwner)}.${this.quoteSqlName(resultTable)} V`,
                `  JOIN ${this.quoteSqlName(targetOwner)}.${this.quoteSqlName(targetTable)} T`,
                "    ON ROWIDTOCHAR(T.ROWID) = V.CASE_ROWID",
                " WHERE 1=1",
                `${filters.map((filter) => `   AND ${filter}`).join("\n")}`,
                " ORDER BY V.VIOLATION_SCORE DESC NULLS LAST, V.RULE_CONFIDENCE DESC NULLS LAST, V.VIOLATION_ID"
            ].join("\n");
        },

        createSymbolicViolationSql(kind = "all", value = "") {
            const node = this.selectedNode;
            const resultOwner = this.normalizeIdentifierParam(node.RESULT_OWNER);
            const resultTable = this.normalizeIdentifierParam(node.RESULT_OBJECT_NAME);
            const targetOwner = this.normalizeIdentifierParam(node.TARGET_OWNER);
            const targetTable = this.normalizeIdentifierParam(node.TARGET_TABLE);
            if (!resultOwner || !resultTable || !targetOwner || !targetTable) {
                alert("연속형 위반 결과 또는 Target Table 정보가 부족합니다.");
                return "";
            }
            const filters = [
                `V.TARGET_OWNER = ${this.sqlLiteral(targetOwner)}`,
                `V.TARGET_TABLE = ${this.sqlLiteral(targetTable)}`
            ];
            const flowRunId = Number(this.selectedRun?.FLOW_RUN_ID || 0);
            if (flowRunId > 0) {
                filters.push("V.RUN_SOURCE_TYPE = 'FLOW_WORK'");
                filters.push(`V.RUN_ID = ${flowRunId}`);
            }
            if (kind === "column" && value) filters.push(`V.TARGET_COLUMN = ${this.sqlLiteral(value)}`);
            if (kind === "rule" && value) filters.push(`V.RULE_ID = ${this.sqlLiteral(value)}`);
            return [
                "SELECT V.VIOLATION_ID AS V_VIOLATION_ID",
                "     , V.RULE_ID AS V_RULE_ID",
                "     , V.TARGET_COLUMN AS V_TARGET_COLUMN",
                "     , V.PREDICTED_VALUE AS V_PREDICTED_VALUE",
                "     , V.ACTUAL_VALUE AS V_ACTUAL_VALUE",
                "     , V.LOWER_BOUND AS V_LOWER_BOUND",
                "     , V.UPPER_BOUND AS V_UPPER_BOUND",
                "     , V.ABS_ERROR AS V_ABS_ERROR",
                "     , V.ERROR_PCT AS V_ERROR_PCT",
                "     , V.VIOLATION_SCORE AS V_VIOLATION_SCORE",
                "     , V.CASE_ID AS V_CASE_ID",
                "     , T.*",
                `  FROM ${this.quoteSqlName(resultOwner)}.${this.quoteSqlName(resultTable)} V`,
                `  JOIN ${this.quoteSqlName(targetOwner)}.${this.quoteSqlName(targetTable)} T`,
                "    ON ROWIDTOCHAR(T.ROWID) = V.CASE_ROWID",
                " WHERE 1=1",
                `${filters.map((filter) => `   AND ${filter}`).join("\n")}`,
                " ORDER BY V.VIOLATION_SCORE DESC NULLS LAST, V.ERROR_PCT DESC NULLS LAST, V.ABS_ERROR DESC NULLS LAST, V.VIOLATION_ID"
            ].join("\n");
        },

        getNodeParamValue(node, keys = [], fallback = "") {
            const payload = this.normalizeObject(node?.PAYLOAD);
            const params = this.normalizeObject(node?.RUNTIME_PARAMS);
            for (const key of keys) {
                const value = node?.[key] ?? params[key] ?? payload[key];
                if (value !== undefined && value !== null && String(value).trim() !== "") return value;
            }
            return fallback;
        },

        sqlNumberLiteral(value, fallback = null) {
            const number = Number(value);
            if (Number.isFinite(number)) return String(number);
            const fallbackNumber = Number(fallback);
            return Number.isFinite(fallbackNumber) ? String(fallbackNumber) : "NULL";
        },

        createRealtimeViolationSqlLookup(kind = "all", value = "") {
            if (kind !== "rule" || !String(value || "").trim()) {
                alert("실시간 조회는 RULE ID 기준 조회에서 사용할 수 있습니다.");
                return "";
            }
            if (this.isSymbolicViolationNode(this.selectedNode)) {
                return this.createSymbolicRealtimeViolationSqlLookup(value);
            }
            if (this.isRuleViolationNode(this.selectedNode)) {
                return this.createCategoricalRealtimeViolationSqlLookup(value);
            }
            alert("실시간 위반 조회를 지원하지 않는 노드입니다.");
            return "";
        },

        createCategoricalRealtimeViolationSqlLookup(ruleId = "") {
            const node = this.selectedNode;
            const resultOwner = this.normalizeIdentifierParam(node?.RESULT_OWNER) || this.normalizeIdentifierParam(node?.TARGET_OWNER);
            const targetOwner = this.normalizeIdentifierParam(node?.TARGET_OWNER);
            const targetTable = this.normalizeIdentifierParam(node?.TARGET_TABLE);
            const ruleModelName = this.getSelectedNodeRuleModelName(node);
            const caseIdColumn = this.normalizeIdentifierParam(this.getNodeParamValue(node, [
                "P_CASE_ID_COLUMN_NAME",
                "pCaseIdColumnName",
                "caseIdColumnName"
            ], "FILE_ROW_NO")) || "FILE_ROW_NO";
            const flowRunId = Number(this.selectedRun?.FLOW_RUN_ID || 0);
            if (!resultOwner || !targetOwner || !targetTable || !ruleModelName) {
                alert("실시간 조회에 필요한 Rule Model 또는 Target Table 정보가 부족합니다.");
                return "";
            }
            return [
                "SELECT INIT$_FN_RULE_VIOLATION_SQL(",
                `           p_rule_owner_name     => ${this.sqlLiteral(resultOwner)},`,
                `           p_rule_model_name     => ${this.sqlLiteral(ruleModelName)},`,
                `           p_rule_id             => ${this.sqlLiteral(ruleId)},`,
                `           p_target_owner        => ${this.sqlLiteral(targetOwner)},`,
                `           p_target_table        => ${this.sqlLiteral(targetTable)},`,
                `           p_case_id_column_name => ${this.sqlLiteral(caseIdColumn)},`,
                "           p_run_source_type     => 'FLOW_WORK',",
                `           p_run_id              => ${flowRunId > 0 ? flowRunId : 0}`,
                "       ) AS LIVE_SQL",
                "  FROM DUAL"
            ].join("\n");
        },

        createSymbolicRealtimeViolationSqlLookup(ruleId = "") {
            const node = this.selectedNode;
            const targetOwner = this.normalizeIdentifierParam(node?.TARGET_OWNER);
            const targetTable = this.normalizeIdentifierParam(node?.TARGET_TABLE);
            const ruleOwner = this.normalizeIdentifierParam(this.getNodeParamValue(node, [
                "P_RULE_OWNER_NAME",
                "pRuleOwnerName",
                "ruleOwnerName"
            ], "")) || targetOwner || this.normalizeIdentifierParam(node?.RESULT_OWNER);
            const ruleTable = this.normalizeIdentifierParam(this.getNodeParamValue(node, [
                "P_RULE_TABLE_NAME",
                "pRuleTableName",
                "ruleTableName",
                "INIT$PreResultTable"
            ], "INIT$_TB_SYMBOLIC_RULE")) || "INIT$_TB_SYMBOLIC_RULE";
            const caseIdColumn = this.normalizeIdentifierParam(this.getNodeParamValue(node, [
                "P_CASE_ID_COLUMN_NAME",
                "pCaseIdColumnName",
                "caseIdColumnName"
            ], "FILE_ROW_NO")) || "FILE_ROW_NO";
            const ruleDetail = this.getViolationRuleDetail("rule", ruleId) || {};
            const errorThreshold = this.readNumericParam([
                this.getNodeParamValue(node, ["P_ERROR_PCT_THRESHOLD", "pErrorPctThreshold", "errorPctThreshold"], ""),
                ruleDetail.TOLERANCE_PCT
            ], 0.05);
            const absErrorRaw = this.getNodeParamValue(node, ["P_ABS_ERROR_THRESHOLD", "pAbsErrorThreshold", "absErrorThreshold"], "");
            const absError = String(absErrorRaw ?? "").trim() === "" ? null : Number(absErrorRaw);
            const maxExpressionLength = this.readNumericParam([
                this.getNodeParamValue(node, ["P_MAX_EXPRESSION_LENGTH", "pMaxExpressionLength", "maxExpressionLength"], "")
            ], 8000);
            const flowRunId = Number(this.selectedRun?.FLOW_RUN_ID || 0);
            if (!ruleOwner || !targetOwner || !targetTable || !ruleTable) {
                alert("실시간 조회에 필요한 Symbolic Rule 또는 Target Table 정보가 부족합니다.");
                return "";
            }
            return [
                "SELECT INIT$_FN_SYMBOLIC_RULE_VIOLATION_SQL(",
                `           p_rule_owner_name       => ${this.sqlLiteral(ruleOwner)},`,
                `           p_rule_table_name       => ${this.sqlLiteral(ruleTable)},`,
                `           p_rule_id               => ${this.sqlLiteral(ruleId)},`,
                `           p_target_owner          => ${this.sqlLiteral(targetOwner)},`,
                `           p_target_table          => ${this.sqlLiteral(targetTable)},`,
                `           p_case_id_column_name   => ${this.sqlLiteral(caseIdColumn)},`,
                `           p_error_pct_threshold   => ${this.sqlNumberLiteral(errorThreshold, 0.05)},`,
                `           p_abs_error_threshold   => ${Number.isFinite(absError) ? this.sqlNumberLiteral(absError) : "NULL"},`,
                "           p_run_source_type       => 'FLOW_WORK',",
                `           p_run_id                => ${flowRunId > 0 ? flowRunId : 0},`,
                `           p_max_expression_length => ${this.sqlNumberLiteral(maxExpressionLength, 8000)}`,
                "       ) AS LIVE_SQL",
                "  FROM DUAL"
            ].join("\n");
        },

        async changeViolationSqlMode(mode = "SAVED") {
            const nextMode = String(mode || "").toUpperCase() === "LIVE" ? "LIVE" : "SAVED";
            const state = this.violationSql || {};
            if (!state.sql || state.mode === nextMode) return;
            if (nextMode === "SAVED") {
                const sql = this.createViolationSql(state.kind || "all", state.value || "");
                if (!sql) return;
                this.violationSql = {
                    ...state,
                    mode: "SAVED",
                    sql,
                    page: 1,
                    total: 0,
                    columns: [],
                    rows: []
                };
                this.renderViolationSqlPopup();
                window.setTimeout(() => this.executeViolationSql(1), 0);
                return;
            }
            if (!state.supportsRealtime) {
                alert("실시간 조회는 RULE ID 기준 조회에서 사용할 수 있습니다.");
                return;
            }
            const lookupSql = this.createRealtimeViolationSqlLookup(state.kind || "all", state.value || "");
            if (!lookupSql) return;
            const message = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlMessage`);
            if (message) message.textContent = "실시간 위반 조회 SQL 생성 중...";
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/sql`, {
                    method: "POST",
                    body: {
                        sql: lookupSql,
                        page: 1,
                        pageSize: 1
                    },
                    showLoading: false
                });
                const row = (json.data || [])[0] || {};
                const liveSql = row.LIVE_SQL || row.live_sql || "";
                if (!String(liveSql || "").trim()) {
                    throw new Error("실시간 조회 SQL을 생성하지 못했습니다.");
                }
                this.violationSql = {
                    ...state,
                    mode: "LIVE",
                    sql: String(liveSql),
                    page: 1,
                    total: 0,
                    columns: [],
                    rows: []
                };
                this.renderViolationSqlPopup();
                window.setTimeout(() => this.executeViolationSql(1), 0);
            } catch (error) {
                if (message) message.textContent = error.message || "실시간 조회 SQL 생성에 실패했습니다.";
            }
        },

        renderViolationSqlModeSwitch(state = this.violationSql || {}) {
            if (!state.supportsRealtime) return "";
            const mode = String(state.mode || "SAVED").toUpperCase();
            return `
                <div class="M04002-sql-mode-switch">
                    <span>쿼리 모드</span>
                    <button type="button" class="${mode === "SAVED" ? "is-active" : ""}" onclick="${PAGE_CODE}.changeViolationSqlMode('SAVED')">샘플링</button>
                    <button type="button" class="${mode === "LIVE" ? "is-active" : ""}" onclick="${PAGE_CODE}.changeViolationSqlMode('LIVE')">실시간</button>
                    <em>${mode === "LIVE" ? "대상 테이블을 현재 기준으로 다시 검사합니다." : "탐지 프로시저가 저장한 위반 Row를 조회합니다."}</em>
                </div>
            `;
        },

        renderViolationSqlPopup() {
            let popup = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPopup`);
            if (!popup) {
                popup = document.createElement("div");
                popup.id = `${PAGE_ID_PREFIX}ViolationSqlPopup`;
                document.body.appendChild(popup);
            }
            const state = this.violationSql || {};
            const totalPages = Math.max(1, Math.ceil(Number(state.total || 0) / Number(state.pageSize || 50)));
            popup.className = "M04002-sql-popup";
            popup.innerHTML = `
                <section>
                    <header class="M04002-sql-popup-title" onmousedown="${PAGE_CODE}.startViolationSqlPopupDrag(event)">
                        <div>
                            <strong>${this.escapeHtml(state.title || "위반 Row SQL")}</strong>
                            <span>Ctrl+Enter로 현재 SQL을 실행합니다.</span>
                        </div>
                        <button type="button" onclick="${PAGE_CODE}.closeViolationSqlPopup()"><i class="fas fa-times"></i></button>
                    </header>
                    <div class="M04002-sql-popup-body">
                        ${this.renderViolationSqlRuleContext(state.ruleDetail)}
                        ${this.renderViolationSqlModeSwitch(state)}
                        <div class="M04002-sql-editor-wrap">
                            <button type="button" class="M04002-sql-copy-btn" title="현재 SQL 복사" onclick="${PAGE_CODE}.copyCurrentViolationSql(event)">
                                <i class="far fa-copy"></i>
                            </button>
                            <textarea id="${PAGE_ID_PREFIX}ViolationSqlEditor" class="M04002-sql-editor" spellcheck="false" onkeydown="${PAGE_CODE}.handleViolationSqlKeydown(event)">${this.escapeHtml(state.sql || "")}</textarea>
                        </div>
                        <div class="M04002-sql-popup-toolbar">
                            <button type="button" class="table-btn primary" onclick="${PAGE_CODE}.executeViolationSql(1)"><i class="fas fa-play"></i> Run</button>
                            <button type="button" class="table-btn" ${state.columns?.length ? "" : "disabled"} onclick="${PAGE_CODE}.exportViolationSqlRows()"><i class="fas fa-file-export"></i> Export</button>
                            <label>Rows
                                <select id="${PAGE_ID_PREFIX}ViolationSqlPageSize" onchange="${PAGE_CODE}.executeViolationSql(1)">
                                    ${[20, 50, 100, 200].map((size) => `<option value="${size}" ${Number(state.pageSize || 50) === size ? "selected" : ""}>${size}</option>`).join("")}
                                </select>
                            </label>
                            <label>Freeze
                                <input id="${PAGE_ID_PREFIX}ViolationSqlFreezeColumns" type="number" min="0" max="50" value="${this.escapeHtml(state.freezeColumns ?? 2)}" onchange="${PAGE_CODE}.changeViolationSqlFreezeColumns(this.value)" oninput="${PAGE_CODE}.changeViolationSqlFreezeColumns(this.value)">
                            </label>
                            <span>${this.formatNumber(state.total || 0)} rows</span>
                            <div class="M04002-page-jump">
                                <button type="button" ${Number(state.page || 1) <= 1 ? "disabled" : ""} onclick="${PAGE_CODE}.executeViolationSql(${Math.max(1, Number(state.page || 1) - 1)})"><i class="fas fa-chevron-left"></i></button>
                                <label><span>Page</span><input id="${PAGE_ID_PREFIX}ViolationSqlPage" type="number" min="1" max="${totalPages}" value="${this.escapeHtml(state.page || 1)}" onkeydown="if(event.key==='Enter'){${PAGE_CODE}.goViolationSqlPage()}"><small>/ ${this.formatNumber(totalPages)}</small></label>
                                <button type="button" onclick="${PAGE_CODE}.goViolationSqlPage()">Go</button>
                                <button type="button" ${Number(state.page || 1) >= totalPages ? "disabled" : ""} onclick="${PAGE_CODE}.executeViolationSql(${Number(state.page || 1) + 1})"><i class="fas fa-chevron-right"></i></button>
                            </div>
                        </div>
                        <div id="${PAGE_ID_PREFIX}ViolationSqlMessage" class="table-empty">${state.rows?.length ? "" : "SQL을 확인한 뒤 Run 또는 Ctrl+Enter로 조회하세요."}</div>
                        <div class="M04002-sql-result">
                            ${state.columns?.length ? this.renderViolationSqlGrid(state.columns, state.rows, state.ruleColumns || []) : ""}
                        </div>
                    </div>
                </section>
            `;
        },

        renderViolationSqlRuleContext(rule = null) {
            if (!rule) return "";
            if (rule.EXPRESSION !== undefined || rule.FEATURE_COLUMNS !== undefined || rule.TARGET_COLUMN !== undefined) {
                const features = this.parseFeatureList(rule.FEATURE_COLUMNS || "");
                const featureLabel = features.join(", ") || "x";
                const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
                return `
                    <section class="M04002-violation-rule-context">
                        <header>
                            <strong>${this.escapeHtml(rule.RULE_ID || "")}</strong>
                            <span>${this.formatNumber(rule.VIOLATION_COUNT)}건 · max error ${this.formatPercentMetric(rule.MAX_ERROR_PCT)} · tolerance ${this.formatPercentMetric(rule.TOLERANCE_PCT)}</span>
                        </header>
                        <p>
                            <b>F(X)</b>
                            f(${this.escapeHtml(featureLabel)}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${this.renderColumnAwareCell(targetColumn, this.lastSymbolicViolationSummary || {})}
                        </p>
                    </section>
                `;
            }
            return `
                <section class="M04002-violation-rule-context">
                    <header>
                        <strong>${this.escapeHtml(rule.RULE_ID || "")}</strong>
                        <span>${this.formatNumber(rule.VIOLATION_COUNT)}건 · confidence ${this.formatPercentMetric(rule.RULE_CONFIDENCE)} · lift ${this.formatDecimal(rule.RULE_LIFT)}</span>
                    </header>
                    <p>
                        <b>IF</b>
                        ${this.renderColumnAwareText(rule.CONDITION_TEXT || "", this.lastViolationSummary || {})}
                        <b>THEN</b>
                        ${this.renderColumnAwareCell(rule.RESULT_COLUMN, this.lastViolationSummary || {})} = ${this.escapeHtml(rule.EXPECTED_VALUE || "")}
                    </p>
                </section>
            `;
        },

        renderViolationSqlGrid(columns, rows, ruleColumns = []) {
            const safeColumns = this.orderViolationSqlColumns(columns || [], ruleColumns || []);
            const awareSummary = this.isSymbolicViolationNode(this.selectedNode)
                ? (this.lastSymbolicViolationSummary || {})
                : (this.lastViolationSummary || {});
            const keyColumns = new Set([
                "V_VIOLATION_ID",
                "V_RULE_ID",
                "V_CASE_ID",
                "V_RESULT_COLUMN",
                "V_TARGET_COLUMN",
                "V_EXPECTED_VALUE",
                "V_PREDICTED_VALUE",
                "V_ACTUAL_VALUE",
                "V_LOWER_BOUND",
                "V_UPPER_BOUND",
                "V_ABS_ERROR",
                "V_ERROR_PCT",
                "V_VIOLATION_SCORE"
            ]);
            const ruleColumnSet = new Set((ruleColumns || []).map((column) => String(column).toUpperCase()));
            if (!safeColumns.length) return `<div class="table-empty">조회 결과가 없습니다.</div>`;
            const columnWidths = this.violationSql?.columnWidths || {};
            const freezeColumns = Math.max(0, Math.min(Number(this.violationSql?.freezeColumns ?? 2), safeColumns.length));
            const rowNoWidth = 64;
            let left = rowNoWidth;
            const columnMeta = safeColumns.map((column, index) => {
                const width = this.getViolationSqlColumnWidth(column, columnWidths);
                const frozen = index < freezeColumns;
                const stickyStyle = frozen ? `position: sticky; left: ${left}px;` : "";
                if (frozen) left += width;
                return { column, index, width, frozen, stickyStyle };
            });
            const rowOffset = (Math.max(1, Number(this.violationSql?.page || 1)) - 1) * Math.max(1, Number(this.violationSql?.pageSize || 50));
            return `
                <div class="M04002-violation-sql-grid-wrap">
                    <table class="table-grid M04002-violation-sql-grid">
                        <colgroup>
                            <col style="width: ${rowNoWidth}px;">
                            ${columnMeta.map((meta) => `<col style="width: ${meta.width}px;">`).join("")}
                        </colgroup>
                        <thead><tr>
                            <th class="is-frozen-col is-row-no" style="position: sticky; left: 0;">No</th>
                            ${columnMeta.map((meta) => `
                            <th class="is-resizable ${meta.frozen ? "is-frozen-col" : ""} ${this.getViolationSqlColumnClass(meta.column, keyColumns, ruleColumnSet)}" data-col-index="${meta.index}" style="${meta.stickyStyle}">
                                <span class="table-th-content">${this.renderColumnAwareCell(meta.column, awareSummary)}</span>
                                <span class="column-resizer" onmousedown="${PAGE_CODE}.startViolationSqlColumnResize(event, ${meta.index})"></span>
                            </th>
                        `).join("")}</tr></thead>
                        <tbody>
                            ${(rows || []).map((row, rowIndex) => `
                                <tr>
                                    <td class="is-frozen-col is-row-no" style="position: sticky; left: 0;">${this.formatNumber(rowOffset + rowIndex + 1)}</td>
                                    ${columnMeta.map((meta) => {
                                    const value = row?.[meta.column] ?? "";
                                    return `<td class="${meta.frozen ? "is-frozen-col" : ""} ${this.getViolationSqlColumnClass(meta.column, keyColumns, ruleColumnSet)}" data-col-index="${meta.index}" style="${meta.stickyStyle}" title="${this.escapeHtml(value)}">${this.renderColumnAwareCell(value, awareSummary)}</td>`;
                                }).join("")}</tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        getViolationSqlColumnWidth(column, columnWidths = this.violationSql?.columnWidths || {}) {
            const key = String(column || "");
            const saved = Number(columnWidths[key]);
            if (Number.isFinite(saved) && saved >= 70) return saved;
            const name = key.toUpperCase();
            if (name === "V_RULE_ID") return 260;
            if (name === "V_RESULT_COLUMN" || name === "V_TARGET_COLUMN") return 150;
            if (["V_EXPECTED_VALUE", "V_PREDICTED_VALUE", "V_ACTUAL_VALUE", "V_LOWER_BOUND", "V_UPPER_BOUND", "V_ABS_ERROR", "V_ERROR_PCT"].includes(name)) return 136;
            if (name === "V_VIOLATION_SCORE") return 160;
            if (name === "V_VIOLATION_ID" || name === "V_CASE_ID") return 118;
            return 132;
        },

        orderViolationSqlColumns(columns, ruleColumns = []) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__");
            const keyOrder = [
                "V_VIOLATION_ID",
                "V_RULE_ID",
                "V_CASE_ID",
                "V_RESULT_COLUMN",
                "V_TARGET_COLUMN",
                "V_EXPECTED_VALUE",
                "V_PREDICTED_VALUE",
                "V_ACTUAL_VALUE",
                "V_LOWER_BOUND",
                "V_UPPER_BOUND",
                "V_ABS_ERROR",
                "V_ERROR_PCT",
                "V_VIOLATION_SCORE"
            ];
            const used = new Set();
            const pick = (names) => names
                .map((name) => safeColumns.find((column) => String(column).toUpperCase() === String(name).toUpperCase()))
                .filter((column) => column && !used.has(column) && used.add(column));
            const keys = pick(keyOrder);
            const rules = pick(ruleColumns || []);
            const rest = safeColumns.filter((column) => !used.has(column));
            return [...keys, ...rules, ...rest];
        },

        getViolationSqlColumnClass(column, keyColumns, ruleColumnSet) {
            const name = String(column || "").toUpperCase();
            if (keyColumns.has(name)) return "is-key";
            if (ruleColumnSet.has(name)) return "is-rule";
            return "";
        },

        changeViolationSqlFreezeColumns(value) {
            const maxColumns = Math.max(0, (this.violationSql?.columns || []).filter((column) => column !== "RN__").length);
            let freezeColumns = Number.parseInt(value, 10);
            if (!Number.isFinite(freezeColumns)) freezeColumns = 0;
            freezeColumns = Math.max(0, Math.min(maxColumns, freezeColumns));
            this.violationSql = {
                ...(this.violationSql || {}),
                freezeColumns
            };
            const input = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlFreezeColumns`);
            if (input && input.value !== String(freezeColumns)) input.value = String(freezeColumns);
            this.refreshViolationSqlGrid();
        },

        refreshViolationSqlGrid() {
            const result = document.querySelector(`#${PAGE_ID_PREFIX}ViolationSqlPopup .M04002-sql-result`);
            const state = this.violationSql || {};
            if (!result) return;
            result.innerHTML = state.columns?.length
                ? this.renderViolationSqlGrid(state.columns, state.rows || [], state.ruleColumns || [])
                : "";
        },

        startViolationSqlColumnResize(event, columnIndex) {
            event.preventDefault();
            event.stopPropagation();
            const table = event.currentTarget?.closest?.("table");
            const col = table?.querySelectorAll("col")?.[columnIndex];
            const columns = this.orderViolationSqlColumns(this.violationSql?.columns || [], this.violationSql?.ruleColumns || []);
            const column = columns[columnIndex];
            if (!table || !col || !column) return;
            const startWidth = Number.parseInt(col.style.width, 10) || col.getBoundingClientRect().width || 120;
            const startX = event.clientX;
            document.body.classList.add("is-column-resizing");
            const move = (moveEvent) => {
                const nextWidth = Math.max(70, startWidth + moveEvent.clientX - startX);
                this.violationSql = {
                    ...(this.violationSql || {}),
                    columnWidths: {
                        ...(this.violationSql?.columnWidths || {}),
                        [column]: nextWidth
                    }
                };
                this.refreshViolationSqlGrid();
            };
            const stop = () => {
                document.body.classList.remove("is-column-resizing");
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", stop);
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", stop);
        },

        closeViolationSqlPopup() {
            const popup = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPopup`);
            if (popup) popup.remove();
        },

        handleViolationSqlKeydown(event) {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                this.executeViolationSql(1);
            }
        },

        async executeViolationSql(page = 1) {
            const editor = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlEditor`);
            if (!editor) return;
            const pageSize = Number(document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPageSize`)?.value || this.violationSql.pageSize || 50);
            const message = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlMessage`);
            if (message) message.textContent = "조회 중...";
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/sql`, {
                    method: "POST",
                    body: {
                        sql: editor.value || "",
                        page: Math.max(1, Number(page || 1)),
                        pageSize
                    },
                    showLoading: false
                });
                this.violationSql = {
                    ...(this.violationSql || {}),
                    sql: editor.value || "",
                    page: Number(json.page || page || 1),
                    pageSize: Number(json.pageSize || pageSize),
                    total: Number(json.total || 0),
                    columns: json.columns || [],
                    rows: json.data || []
                };
                this.renderViolationSqlPopup();
            } catch (error) {
                if (message) message.textContent = error.message || "SQL 조회에 실패했습니다.";
            }
        },

        goViolationSqlPage() {
            const page = Number(document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPage`)?.value || 1);
            this.executeViolationSql(page);
        },

        exportViolationSqlRows() {
            const state = this.violationSql || {};
            const columns = (state.columns || []).filter((column) => column !== "RN__");
            const rows = state.rows || [];
            if (!columns.length || !rows.length) {
                alert("Export할 위반 Row 데이터가 없습니다.");
                return;
            }
            const filenameBase = String(state.title || "violation-rows")
                .replace(/[\\/:*?"<>|]+/g, "_")
                .replace(/\s+/g, "_");
            this.downloadCsv(`${filenameBase}.csv`, columns, rows);
        },

        startViolationSqlPopupDrag(event) {
            const popup = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPopup`);
            if (!popup || event.target.closest("button")) return;
            event.preventDefault();
            const rect = popup.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = rect.left;
            const startTop = rect.top;
            const move = (moveEvent) => {
                popup.style.left = `${Math.max(8, startLeft + moveEvent.clientX - startX)}px`;
                popup.style.top = `${Math.max(8, startTop + moveEvent.clientY - startY)}px`;
                popup.style.transform = "none";
            };
            const stop = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", stop);
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", stop);
        },

        renderCorrelationSummary(summary) {
            if (!summary) return "";
            const columns = Array.isArray(summary.associatedColumns) ? summary.associatedColumns : [];
            const visibleColumns = columns.slice(0, 80);
            const hiddenCount = Math.max(0, columns.length - visibleColumns.length);
            const isNumeric = String(summary.correlationKind || "").toUpperCase() === "NUMERIC";
            const topPairs = Array.isArray(summary.topPairs) ? summary.topPairs : [];
            const metricLabel = summary.metricLabel || (isNumeric ? "|Pearson r|" : "Cramer's V");
            const signedMetricLabel = summary.signedMetricLabel || metricLabel;
            return `
                <section class="M04002-corr-summary">
                    <header>
                        <div>
                            <strong>${isNumeric ? "연속형 상관 분석 요약" : "범주형 상관 분석 요약"}</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)} · ${this.escapeHtml(metricLabel)} 기준</span>
                        </div>
                        <div class="M04002-corr-metrics">
                            <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>전체 컬럼</small></span>
                            <span><b>${this.formatNumber(summary.associatedColumnCount)}</b><small>연관 컬럼</small></span>
                            <span><b>${this.formatNumber(summary.associatedPairCount)}</b><small>연관 쌍</small></span>
                            <span><b>${this.formatDecimal(summary.maxMetricValue)}</b><small>최대 지표</small></span>
                        </div>
                    </header>
                    <p>PASS_YN=Y로 저장된 ${isNumeric ? "연속형 상관" : "범주형 상관"} 컬럼은 ${this.formatNumber(summary.associatedColumnCount)}개이고, 통과 쌍은 전체 ${this.formatNumber(summary.totalPairCount)}개 중 ${this.formatNumber(summary.associatedPairCount)}개입니다.</p>
                    <div class="M04002-corr-tags">
                        ${visibleColumns.map((column) => this.renderColumnChip(column, summary)).join("")}
                        ${hiddenCount ? `<em class="M04002-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                    </div>
                    ${topPairs.length ? `
                        <div class="M04002-corr-pair-strip">
                            ${topPairs.map((pair) => `
                                <span>
                                    <b>${this.renderColumnAwareCell(pair.COL_A, summary)} ↔ ${this.renderColumnAwareCell(pair.COL_B, summary)}</b>
                                    <small>${this.escapeHtml(signedMetricLabel)} ${this.formatDecimal(pair.METRIC_VALUE)} · ${this.escapeHtml(metricLabel)} ${this.formatDecimal(pair.SORT_METRIC_VALUE)} · p ${this.formatDecimal(pair.P_VALUE)}</small>
                                </span>
                            `).join("")}
                        </div>
                    ` : ""}
                </section>
            `;
        },

        renderLassoSummary(summary) {
            if (!summary) return "";
            const overview = summary.overview || {};
            const topTargets = Array.isArray(summary.topTargets) ? summary.topTargets : [];
            const topFeatures = Array.isArray(summary.topFeatures) ? summary.topFeatures : [];
            return `
                <section class="M04002-lasso-summary">
                    <header>
                        <div>
                            <strong>LASSO 주요 피처 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)} · 계수 절대값과 R2 기준</span>
                        </div>
                        <div class="M04002-corr-metrics">
                            <span><b>${this.formatNumber(overview.TARGET_COLUMN_COUNT)}</b><small>target</small></span>
                            <span><b>${this.formatNumber(overview.SELECTED_FEATURE_COUNT)}</b><small>selected</small></span>
                            <span><b>${this.formatDecimal(overview.MAX_R2_SCORE)}</b><small>max R2</small></span>
                            <span><b>${this.formatDecimal(overview.MODEL_ALPHA)}</b><small>alpha</small></span>
                        </div>
                    </header>
                    <div class="M04002-lasso-direction-grid">
                        <span><b>${this.formatNumber(overview.POSITIVE_FEATURE_COUNT)}</b><small>양의 영향 계수</small></span>
                        <span><b>${this.formatNumber(overview.NEGATIVE_FEATURE_COUNT)}</b><small>음의 영향 계수</small></span>
                        <span><b>${this.formatNumber(overview.FEATURE_NAME_COUNT)}</b><small>고유 feature</small></span>
                    </div>
                    ${topTargets.length ? `
                        <div class="M04002-type-detail">
                            <strong>Target별 선택 결과</strong>
                            <div class="M04002-type-case-grid">
                                ${topTargets.map((item) => `
                                    <span>
                                        <b>${this.renderColumnAwareCell(item.TARGET_COLUMN, summary)}</b>
                                        <small>${this.formatNumber(item.SELECTED_FEATURE_COUNT)} selected · R2 ${this.formatDecimal(item.R2_SCORE)}</small>
                                        <em>max coef ${this.formatDecimal(item.MAX_ABS_COEFFICIENT)}</em>
                                    </span>
                                `).join("")}
                            </div>
                        </div>
                    ` : ""}
                    ${topFeatures.length ? `
                        <div class="M04002-lasso-feature-list">
                            ${topFeatures.map((item) => {
                                const width = Math.max(6, Math.min(100, Number(item.ABS_COEFFICIENT || 0) * 100));
                                const direction = Number(item.COEFFICIENT || 0) >= 0 ? "is-positive" : "is-negative";
                                return `
                                    <article class="${direction}">
                                        <header>
                                            <strong>${this.renderColumnAwareCell(item.FEATURE_NAME, summary)}</strong>
                                            <small>${this.renderColumnAwareCell(item.TARGET_COLUMN, summary)}</small>
                                        </header>
                                        <em><i style="width:${width}%"></i></em>
                                        <footer>
                                            <span>coef ${this.formatDecimal(item.COEFFICIENT)}</span>
                                            <span>rank ${this.formatNumber(item.RANK_NO)}</span>
                                            <span>R2 ${this.formatDecimal(item.R2_SCORE)}</span>
                                        </footer>
                                    </article>
                                `;
                            }).join("")}
                        </div>
                    ` : ""}
                </section>
            `;
        },

        renderSymbolicRuleSummary(summary) {
            if (!summary) return "";
            this.lastSymbolicRuleSummary = summary;
            const overview = summary.overview || {};
            const methodGroups = Array.isArray(summary.methodGroups) ? summary.methodGroups : [];
            const targetGroups = Array.isArray(summary.targetGroups) ? summary.targetGroups : [];
            const topRules = Array.isArray(summary.topRules) ? summary.topRules : [];
            const filters = this.symbolicRuleFilters || {};
            const methodFilter = String(summary.methodFilter || filters.method || "ALL");
            const targetFilter = String(summary.targetColumnFilter || filters.targetColumn || "ALL");
            return `
                <section class="M04002-symbolic-summary">
                    <header>
                        <div>
                            <strong>Symbolic Rule 수식 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)} · f(x)=y 수식 규칙</span>
                        </div>
                        <div class="M04002-corr-metrics">
                            <span><b>${this.formatNumber(overview.RULE_COUNT)}</b><small>rules</small></span>
                            <span><b>${this.formatNumber(overview.SELECTED_RULE_COUNT)}</b><small>selected</small></span>
                            <span><b>${this.formatDecimal(overview.MAX_SCORE)}</b><small>max score</small></span>
                            <span><b>${this.formatDecimal(overview.AVG_COMPLEXITY)}</b><small>avg complexity</small></span>
                        </div>
                    </header>
                    <section class="M04002-rule-facet-panel is-symbolic">
                        <div class="M04002-rule-facet-block">
                            <header>
                                <strong>Method 유형</strong>
                                <button type="button" onclick="${PAGE_CODE}.resetSymbolicRuleFilters()">Reset</button>
                            </header>
                            <div class="M04002-rule-facet-list">
                                <button type="button" class="${methodFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('method', 'ALL')">
                                    <span>전체</span>
                                    <b>${this.formatNumber(overview.RULE_COUNT)} rules</b>
                                </button>
                                ${methodGroups.map((item) => {
                                    const method = String(item.METHOD || "(UNKNOWN)");
                                    return `
                                        <button type="button" class="${methodFilter === method ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('method', '${this.escapeJs(method)}')">
                                            <span>${this.escapeHtml(method)}</span>
                                            <b>${this.formatNumber(item.RULE_COUNT)} rules · score ${this.formatDecimal(item.AVG_SCORE)}</b>
                                        </button>
                                    `;
                                }).join("")}
                            </div>
                        </div>
                        <div class="M04002-rule-facet-block is-condition">
                            <header><strong>Y 결과 컬럼</strong></header>
                            <div class="M04002-rule-facet-list">
                                <button type="button" class="${targetFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('targetColumn', 'ALL')">
                                    <span>전체</span>
                                    <b>${this.formatNumber(overview.TARGET_COLUMN_COUNT)} columns</b>
                                </button>
                                ${targetGroups.slice(0, 30).map((item) => {
                                    const targetColumn = String(item.TARGET_COLUMN || "");
                                    return `
                                        <button type="button" class="${targetFilter === targetColumn ? "is-active" : ""}" title="${this.escapeHtml(`${targetColumn}: ${this.formatNumber(item.SELECTED_RULE_COUNT)} selected`)}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('targetColumn', '${this.escapeJs(targetColumn)}')">
                                            <span>${this.renderColumnAwareCell(targetColumn, summary)}</span>
                                            <b>${this.formatNumber(item.SELECTED_RULE_COUNT)} rules</b>
                                        </button>
                                    `;
                                }).join("")}
                            </div>
                        </div>
                    </section>
                    ${topRules.length ? `
                        <div class="M04002-symbolic-rule-grid">
                            ${topRules.map((rule, index) => this.renderSymbolicRuleCard(rule, index)).join("")}
                        </div>
                    ` : `<div class="table-empty">표시할 Symbolic Rule이 없습니다.</div>`}
                </section>
            `;
        },

        renderSymbolicRuleCard(rule, index = 0) {
            const key = this.getSymbolicRuleKey(rule, index);
            const features = Array.isArray(rule.FEATURE_LIST) ? rule.FEATURE_LIST : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const displayRuleId = this.getSymbolicRuleDisplayId(rule, index);
            const plainRuleId = String(rule.RULE_ID || displayRuleId || "").trim();
            const featureLabel = features.map((item) => this.escapeHtml(item)).join(", ") || "x";
            const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
            const targetCell = this.renderColumnAwareCell(targetColumn, this.lastSymbolicRuleSummary || {});
            return `
                <article class="M04002-symbolic-rule-card ${String(rule.SELECTED_YN || "").toUpperCase() === "Y" ? "is-selected" : ""}">
                    <header>
                        <span>
                            <span class="M04002-symbolic-rule-id-inline">
                                <small class="M04002-symbolic-rule-id-label">Rule ID</small>
                                <span class="M04002-symbolic-rule-id-row">
                                    <code>${this.escapeHtml(displayRuleId)}</code>
                                    <button type="button" class="M04002-rule-copy-btn" title="RULE ID 복사" onclick="${PAGE_CODE}.copyRuleId('${this.escapeJs(plainRuleId)}', event)">
                                        <i class="far fa-copy"></i>
                                    </button>
                                </span>
                            </span>
                        </span>
                        <span class="M04002-symbolic-rule-actions">
                            <button type="button" title="수식 그래프 보기" onclick="${PAGE_CODE}.openSymbolicRulePopup('${this.escapeJs(key)}')">
                                <i class="fas fa-chart-line"></i>
                            </button>
                            ${plainRuleId ? `<button type="button" title="이 RULE ID로 연속형 위반탐지 결과 검색" onclick="${PAGE_CODE}.openSymbolicViolationForRule('${this.escapeJs(plainRuleId)}')">위반 조회</button>` : ""}
                        </span>
                    </header>
                    <div class="M04002-symbolic-y-panel">
                        <small>Y 결과값</small>
                        <strong>${targetCell}</strong>
                    </div>
                    <code>f(${featureLabel}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${this.escapeHtml(targetColumn)}</code>
                    <div class="M04002-symbolic-x-panel">
                        <small>X 인자</small>
                        <div class="M04002-corr-tags">
                            ${features.length ? features.slice(0, 10).map((column) => this.renderColumnChip(column, this.lastSymbolicRuleSummary || {})).join("") : `<em class="M04002-column-chip"><b>x</b></em>`}
                        </div>
                    </div>
                    <footer>
                        <span><small>score</small><b>${this.formatDecimal(rule.SCORE)}</b></span>
                        <span><small>complexity</small><b>${this.formatNumber(rule.COMPLEXITY)}</b></span>
                        <span><small>rank</small><b>${this.formatNumber(rule.RANK_NO)}</b></span>
                        <span class="M04002-symbolic-rule-method"><small>method</small><b>${this.escapeHtml(rule.METHOD || "-")}</b></span>
                    </footer>
                </article>
            `;
        },

        renderSymbolicViolationSummary(summary) {
            if (!summary) return "";
            this.lastSymbolicViolationSummary = summary;
            const overview = summary.overview || {};
            const topRules = Array.isArray(summary.topRules) ? summary.topRules : [];
            const topTargets = Array.isArray(summary.topTargets) ? summary.topTargets : [];
            const methodGroups = Array.isArray(summary.methodGroups) ? summary.methodGroups : [];
            const ruleFilter = summary.ruleIdFilter ?? this.violationRuleFilters?.ruleId ?? "";
            const ruleFilterDisplay = String(ruleFilter || "");
            const filters = this.symbolicViolationFilters || {};
            const methodFilter = String(summary.methodFilter || filters.method || "ALL");
            const targetFilter = String(summary.targetColumnFilter || filters.targetColumn || "ALL");
            const resultScope = String(summary.resultScope || filters.resultScope || "ALL").toUpperCase();
            return `
                <section class="M04002-symbolic-violation-summary">
                    <header>
                        <div>
                            <strong>Symbolic Rule 오차범위 위반 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)} · 예측값 대비 허용 오차율 기준</span>
                        </div>
                        <div class="M04002-corr-metrics">
                            <span><b>${this.formatNumber(overview.RULE_COUNT)}</b><small>rules</small></span>
                            <span><b>${this.formatNumber(overview.VIOLATION_COUNT)}</b><small>violations</small></span>
                            <span><b>${this.formatNumber(overview.VIOLATED_RULE_COUNT)}</b><small>hit rules</small></span>
                            <span><b>${this.formatNumber(overview.NO_VIOLATION_RULE_COUNT)}</b><small>clean rules</small></span>
                            <span><b>${this.formatPercentMetric(overview.TOLERANCE_PCT)}</b><small>tolerance</small></span>
                        </div>
                    </header>
                    <div class="M04002-violation-reason-strip">
                        <span><small>위반 Row</small><b>${this.formatNumber(overview.VIOLATED_ROW_COUNT)}</b></span>
                        <span><small>평균 오차율</small><b>${this.formatPercentMetric(overview.AVG_ERROR_PCT)}</b></span>
                        <span><small>최대 오차율</small><b>${this.formatPercentMetric(overview.MAX_ERROR_PCT)}</b></span>
                        <span><small>평균 절대오차</small><b>${this.formatDecimal(overview.AVG_ABS_ERROR)}</b></span>
                        <span><small>최대 절대오차</small><b>${this.formatDecimal(overview.MAX_ABS_ERROR)}</b></span>
                        ${ruleFilterDisplay ? `<b>RULE ID 검색: ${this.escapeHtml(ruleFilterDisplay)}</b>` : ""}
                    </div>
                    <section class="M04002-rule-facet-panel is-symbolic">
                        <div class="M04002-rule-facet-block">
                            <header>
                                <strong>Method 유형</strong>
                                <button type="button" onclick="${PAGE_CODE}.resetSymbolicViolationFilters()">Reset</button>
                            </header>
                            <div class="M04002-rule-facet-list">
                                <button type="button" class="${methodFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('method', 'ALL')">
                                    <span>전체</span>
                                    <b>${this.formatNumber(overview.RULE_COUNT)} rules</b>
                                </button>
                                ${methodGroups.length ? methodGroups.map((item) => {
                                    const method = String(item.METHOD || "(UNKNOWN)");
                                    return `
                                        <button type="button" class="${methodFilter === method ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('method', '${this.escapeJs(method)}')">
                                            <span>${this.escapeHtml(method)}</span>
                                            <b>${this.formatNumber(item.VIOLATION_COUNT)} / ${this.formatNumber(item.RULE_COUNT)}</b>
                                        </button>
                                    `;
                                }).join("") : `<span>표시할 Method 요약이 없습니다.</span>`}
                            </div>
                        </div>
                        <div class="M04002-rule-facet-block is-condition">
                            <header><strong>위반 상태</strong></header>
                            <div class="M04002-rule-facet-list">
                                <button type="button" class="${resultScope === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('resultScope', 'ALL')">
                                    <span>전체 규칙</span>
                                    <b>${this.formatNumber(overview.RULE_COUNT)}</b>
                                </button>
                                <button type="button" class="${resultScope === "HIT" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('resultScope', 'HIT')">
                                    <span>위반 있음</span>
                                    <b>${this.formatNumber(overview.VIOLATED_RULE_COUNT)}</b>
                                </button>
                                <button type="button" class="${resultScope === "CLEAN" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('resultScope', 'CLEAN')">
                                    <span>위반 없음</span>
                                    <b>${this.formatNumber(overview.NO_VIOLATION_RULE_COUNT)}</b>
                                </button>
                            </div>
                        </div>
                        <div class="M04002-rule-facet-block">
                            <header><strong>Target별 규칙/위반</strong></header>
                            <div class="M04002-rule-facet-list">
                                <button type="button" class="${targetFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('targetColumn', 'ALL')">
                                    <span>전체</span>
                                    <b>${this.formatNumber(overview.TARGET_COLUMN_COUNT)} columns</b>
                                </button>
                                ${topTargets.length ? topTargets.map((item) => {
                                    const targetColumn = String(item.TARGET_COLUMN || "");
                                    return `
                                    <button type="button" class="${targetFilter === targetColumn ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('targetColumn', '${this.escapeJs(targetColumn)}')">
                                        <span>${this.renderColumnAwareCell(targetColumn, summary)}</span>
                                        <b>${this.formatNumber(item.VIOLATION_COUNT)} / ${this.formatNumber(item.RULE_COUNT)}</b>
                                    </button>
                                    `;
                                }).join("") : `<span>표시할 Target 규칙이 없습니다.</span>`}
                            </div>
                        </div>
                        <div class="M04002-rule-facet-block is-condition">
                            <header>
                                <strong>RULE ID 검색</strong>
                                <div class="M04002-rule-facet-actions">
                                    <button type="button" onclick="${PAGE_CODE}.searchViolationRule()">Search</button>
                                    <button type="button" onclick="${PAGE_CODE}.resetViolationRuleSearch()">Reset</button>
                                </div>
                            </header>
                            <label class="M04002-rule-condition-search">
                                <span>RULE ID</span>
                                <input id="violationRuleSearch-${PAGE_CODE}" type="search" value="${this.escapeHtml(ruleFilterDisplay)}" placeholder="예: RULE_001" onkeydown="${PAGE_CODE}.handleViolationRuleSearchKeydown(event)">
                            </label>
                        </div>
                    </section>
                    ${topRules.length ? `
                        <div class="M04002-violation-rule-grid">
                            ${topRules.map((rule) => {
                                const hasViolation = Number(rule.VIOLATION_COUNT || 0) > 0;
                                const features = this.parseFeatureList(rule.FEATURE_COLUMNS);
                                const featureLabel = features.join(", ") || "x";
                                const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
                                return `
                                <article class="${hasViolation ? "" : "is-no-violation"}">
                                    <header>
                                        <strong>${this.escapeHtml(rule.RULE_ID || "-")}</strong>
                                        <span class="M04002-violation-rule-actions">
                                            <button type="button" title="수식 그래프 보기" onclick="${PAGE_CODE}.openSymbolicViolationRulePopup('${this.escapeJs(rule.RULE_ID)}')">
                                                <i class="fas fa-chart-line"></i>
                                            </button>
                                            <button type="button" class="${hasViolation ? "" : "is-muted"}" onclick="${PAGE_CODE}.openViolationSqlPopup('rule', '${this.escapeJs(rule.RULE_ID)}')">
                                                ${hasViolation ? `${this.formatNumber(rule.VIOLATION_COUNT)}건` : "위반 없음"}
                                            </button>
                                        </span>
                                    </header>
                                    <p>
                                        <b>F(X)</b>
                                        f(${this.escapeHtml(featureLabel)}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${this.renderColumnAwareCell(targetColumn, summary)}
                                    </p>
                                    <footer>
                                        <span><small>위반 Row</small><b>${this.formatNumber(rule.VIOLATED_ROW_COUNT)}</b></span>
                                        <span><small>최대 오차율</small><b>${this.formatPercentMetric(rule.MAX_ERROR_PCT)}</b></span>
                                        <span><small>평균 오차율</small><b>${this.formatPercentMetric(rule.AVG_ERROR_PCT)}</b></span>
                                        <span><small>score</small><b>${this.formatDecimal(rule.RULE_SCORE)}</b></span>
                                        <span><small>method</small><b>${this.escapeHtml(rule.RULE_METHOD || "-")}</b></span>
                                    </footer>
                                </article>
                            `;
                            }).join("")}
                        </div>
                    ` : `<div class="table-empty">${ruleFilterDisplay ? "검색한 RULE ID에 해당하는 Symbolic Rule이 없습니다." : "표시할 Symbolic Rule 위반 요약이 없습니다."}</div>`}
                </section>
            `;
        },

        getSymbolicRuleKey(rule, index = 0) {
            return [
                rule?.TARGET_COLUMN || "",
                rule?.RULE_ID || `Rule ${index + 1}`,
                rule?.RANK_NO || index + 1
            ].map((value) => String(value).replace(/\|/g, "/")).join("|");
        },

        getSymbolicRuleDisplayId(rule, index = 0) {
            const actualRuleId = String(rule?.RULE_ID || "").trim();
            if (actualRuleId) return actualRuleId;
            const raw = [
                this.selectedRun?.FLOW_RUN_ID || "",
                rule?.TARGET_COLUMN || "",
                rule?.RULE_ID || `Rule ${index + 1}`,
                rule?.EXPRESSION || "",
                rule?.FEATURE_COLUMNS || ""
            ].join("|");
            return `SYM_${this.hashStringHex(raw, 32)}`;
        },

        hashStringHex(value, length = 32) {
            let hashA = 0x811c9dc5;
            let hashB = 0x85ebca6b;
            const text = String(value || "");
            for (let index = 0; index < text.length; index += 1) {
                const code = text.charCodeAt(index);
                hashA ^= code;
                hashA = Math.imul(hashA, 0x01000193) >>> 0;
                hashB ^= code + index;
                hashB = Math.imul(hashB, 0x27d4eb2d) >>> 0;
            }
            let hex = "";
            let seedA = hashA;
            let seedB = hashB;
            while (hex.length < length) {
                seedA = Math.imul(seedA ^ (seedA >>> 15), 0x2c1b3c6d) >>> 0;
                seedB = Math.imul(seedB ^ (seedB >>> 13), 0x297a2d39) >>> 0;
                hex += (seedA ^ seedB).toString(16).toUpperCase().padStart(8, "0");
            }
            return hex.slice(0, length);
        },

        findSymbolicRuleByKey(key) {
            const rules = this.lastSymbolicRuleSummary?.topRules || [];
            return rules.find((rule, index) => this.getSymbolicRuleKey(rule, index) === key) || null;
        },

        findSymbolicRuleIndex(targetRule) {
            const rules = this.lastSymbolicRuleSummary?.topRules || [];
            const foundIndex = rules.findIndex((rule, index) =>
                this.getSymbolicRuleKey(rule, index) === this.getSymbolicRuleKey(targetRule, index)
            );
            return foundIndex >= 0 ? foundIndex : 0;
        },

        parseFeatureList(value) {
            return String(value || "")
                .split(/[,;\s]+/)
                .map((item) => item.trim())
                .filter(Boolean);
        },

        openSymbolicRulePopup(key) {
            const rule = this.findSymbolicRuleByKey(String(key || ""));
            if (!rule) {
                alert("선택한 Symbolic Rule 정보를 찾을 수 없습니다.");
                return;
            }
            this.closeSymbolicRulePopup();
            const popup = document.createElement("div");
            popup.id = `${PAGE_ID_PREFIX}SymbolicRulePopup`;
            popup.className = "M04002-symbolic-popup";
            popup.innerHTML = this.renderSymbolicRulePopup(rule, this.lastSymbolicRuleSummary || {});
            document.body.appendChild(popup);
            setTimeout(() => this.drawSymbolicRuleChart(rule), 0);
        },

        openSymbolicViolationRulePopup(ruleId) {
            const normalizedRuleId = String(ruleId || "").trim();
            const summary = this.lastSymbolicViolationSummary || {};
            const rule = (summary.topRules || []).find((item) => String(item.RULE_ID) === normalizedRuleId);
            if (!rule) {
                alert("선택한 Symbolic Rule 위반 요약 정보를 찾을 수 없습니다.");
                return;
            }
            this.closeSymbolicRulePopup();
            const popup = document.createElement("div");
            popup.id = `${PAGE_ID_PREFIX}SymbolicRulePopup`;
            popup.className = "M04002-symbolic-popup";
            popup.innerHTML = this.renderSymbolicRulePopup(rule, summary);
            document.body.appendChild(popup);
            setTimeout(() => this.drawSymbolicRuleChart(rule), 0);
        },

        renderSymbolicRulePopup(rule, sourceSummary = this.lastSymbolicRuleSummary || {}) {
            const features = Array.isArray(rule.FEATURE_LIST) ? rule.FEATURE_LIST : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const ranges = Array.isArray(rule.FEATURE_RANGES) ? rule.FEATURE_RANGES : [];
            const featureLabel = features.length ? features.map((item) => this.escapeHtml(item)).join(", ") : "x";
            const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
            const targetCell = this.renderColumnAwareCell(targetColumn, sourceSummary || {});
            const displayRuleId = this.getSymbolicRuleDisplayId(rule, this.findSymbolicRuleIndex(rule));
            return `
                <section>
                    <header class="M04002-sql-popup-title" onmousedown="${PAGE_CODE}.startSymbolicRulePopupDrag(event)">
                        <div>
                            <span class="M04002-symbolic-rule-id-inline">
                                <small class="M04002-symbolic-rule-id-label">Rule ID</small>
                                <span class="M04002-symbolic-rule-id-row">
                                    <code>${this.escapeHtml(displayRuleId)}</code>
                                    <button type="button" class="M04002-rule-copy-btn" title="RULE ID 복사" onclick="${PAGE_CODE}.copyRuleId('${this.escapeJs(displayRuleId)}', event)">
                                        <i class="far fa-copy"></i>
                                    </button>
                                </span>
                            </span>
                            <span>Symbolic regression rule</span>
                        </div>
                        <button type="button" title="Close" onclick="${PAGE_CODE}.closeSymbolicRulePopup()"><i class="fas fa-times"></i></button>
                    </header>
                    <div class="M04002-symbolic-formula-banner">
                        <span>F(X) = Y</span>
                        <strong>f(${featureLabel}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${targetCell}</strong>
                    </div>
                    <div class="M04002-symbolic-popup-body">
                        <div class="M04002-symbolic-expression-box">
                            <strong>Expression</strong>
                            <code>${this.escapeHtml(rule.EXPRESSION || "")}</code>
                            ${rule.MESSAGE ? `<span>${this.escapeHtml(rule.MESSAGE)}</span>` : ""}
                        </div>
                        <div class="M04002-symbolic-chart-wrap">
                            <canvas id="${PAGE_ID_PREFIX}SymbolicRuleChart" height="260"></canvas>
                            <div id="${PAGE_ID_PREFIX}SymbolicRuleChartMessage" class="table-empty"></div>
                        </div>
                        <div class="M04002-symbolic-range-grid">
                            ${ranges.length ? ranges.map((range) => `
                                <span>
                                    <b>${this.renderColumnAwareCell(range.COLUMN_NAME, sourceSummary || {})}</b>
                                    <small>min ${this.formatDecimal(range.MIN_VALUE)} · avg ${this.formatDecimal(range.AVG_VALUE)} · max ${this.formatDecimal(range.MAX_VALUE)}</small>
                                </span>
                            `).join("") : `<span><b>Feature range</b><small>대상 테이블의 숫자 범위를 계산하지 못했습니다. 기본 -1~1 범위로 그래프를 시도합니다.</small></span>`}
                        </div>
                    </div>
                </section>
            `;
        },

        closeSymbolicRulePopup() {
            if (this.symbolicRuleChart && typeof this.symbolicRuleChart.destroy === "function") {
                this.symbolicRuleChart.destroy();
            }
            this.symbolicRuleChart = null;
            const popup = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRulePopup`);
            if (popup) popup.remove();
        },

        startSymbolicRulePopupDrag(event) {
            const popup = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRulePopup`);
            if (!popup || event.target.closest("button")) return;
            event.preventDefault();
            const rect = popup.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = rect.left;
            const startTop = rect.top;
            const move = (moveEvent) => {
                popup.style.left = `${Math.max(8, startLeft + moveEvent.clientX - startX)}px`;
                popup.style.top = `${Math.max(8, startTop + moveEvent.clientY - startY)}px`;
                popup.style.transform = "none";
            };
            const stop = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", stop);
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", stop);
        },

        drawSymbolicRuleChart(rule) {
            const message = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRuleChartMessage`);
            const canvas = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRuleChart`);
            if (!canvas || !window.Chart) {
                if (message) message.textContent = "Chart.js가 로드되지 않아 그래프를 표시할 수 없습니다.";
                return;
            }
            let chartData;
            try {
                chartData = this.buildSymbolicRuleChartData(rule);
            } catch (error) {
                if (message) message.textContent = `그래프 데이터를 만들지 못했습니다: ${error.message}`;
                canvas.hidden = true;
                return;
            }
            if (!chartData.ok) {
                if (message) message.textContent = chartData.message || "이 수식은 현재 화면에서 그래프로 계산할 수 없습니다.";
                canvas.hidden = true;
                return;
            }
            canvas.hidden = false;
            canvas.removeAttribute("hidden");
            canvas.style.display = "block";
            if (message) message.textContent = chartData.message || "";
            if (this.symbolicRuleChart && typeof this.symbolicRuleChart.destroy === "function") {
                this.symbolicRuleChart.destroy();
            }
            try {
                this.symbolicRuleChart = new Chart(canvas.getContext("2d"), {
                    type: "line",
                    data: {
                        labels: chartData.labels,
                        datasets: chartData.datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: "index", intersect: false },
                        plugins: {
                            legend: { position: "bottom" },
                            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${this.formatDecimal(ctx.parsed.y)}` } }
                        },
                        scales: {
                            x: { title: { display: true, text: chartData.xLabel } },
                            y: { title: { display: true, text: rule.TARGET_COLUMN || "Predicted y" } }
                        }
                    }
                });
                requestAnimationFrame(() => {
                    if (this.symbolicRuleChart && typeof this.symbolicRuleChart.resize === "function") {
                        this.symbolicRuleChart.resize();
                    }
                });
            } catch (error) {
                canvas.hidden = true;
                if (message) message.textContent = `그래프를 렌더링하지 못했습니다: ${error.message}`;
            }
        },

        buildSymbolicRuleChartData(rule) {
            const features = Array.isArray(rule.FEATURE_LIST) && rule.FEATURE_LIST.length
                ? rule.FEATURE_LIST
                : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const expression = String(rule.EXPRESSION || "").trim();
            if (!features.length || !expression) {
                return { ok: false, message: "수식 또는 입력 feature 정보가 없습니다." };
            }
            const compiled = this.compileSymbolicExpression(expression, features);
            if (!compiled.ok) return compiled;
            const rangeMap = new Map((rule.FEATURE_RANGES || []).map((range) => [String(range.COLUMN_NAME || "").toUpperCase(), range]));
            const getRange = (feature) => {
                const found = rangeMap.get(String(feature || "").toUpperCase()) || {};
                let min = Number(found.MIN_VALUE);
                let max = Number(found.MAX_VALUE);
                let avg = Number(found.AVG_VALUE);
                if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
                    min = -1;
                    max = 1;
                }
                if (!Number.isFinite(avg)) avg = (min + max) / 2;
                return { min, max, avg };
            };
            const primary = features[0];
            const primaryRange = getRange(primary);
            const second = features[1] || "";
            const secondRange = second ? getRange(second) : null;
            const variants = secondRange
                ? [
                    { label: `${second} min`, value: secondRange.min, color: "#2563eb" },
                    { label: `${second} avg`, value: secondRange.avg, color: "#059669" },
                    { label: `${second} max`, value: secondRange.max, color: "#dc2626" }
                ]
                : [{ label: "predicted", value: null, color: "#2563eb" }];
            const points = compiled.profile && compiled.profile.isCurved ? 80 : 25;
            const xs = Array.from({ length: points }, (_, index) => primaryRange.min + ((primaryRange.max - primaryRange.min) * index) / Math.max(1, points - 1));
            const labels = xs.map((value) => this.formatDecimal(value));
            const datasets = variants.map((variant) => {
                const data = xs.map((xValue) => {
                    const values = {};
                    features.forEach((feature) => {
                        if (feature === primary) values[feature] = xValue;
                        else if (feature === second && variant.value !== null) values[feature] = variant.value;
                        else values[feature] = getRange(feature).avg;
                    });
                    const yValue = compiled.evaluate(values);
                    return Number.isFinite(yValue) ? yValue : null;
                });
                return {
                    label: variant.label,
                    data,
                    borderColor: variant.color,
                    backgroundColor: variant.color,
                    tension: compiled.profile && compiled.profile.isCurved ? 0.18 : 0.25,
                    pointRadius: compiled.profile && compiled.profile.isCurved ? 1 : 2,
                    spanGaps: true
                };
            }).filter((dataset) => dataset.data.some((value) => value !== null));
            if (!datasets.length) {
                return { ok: false, message: "계산 결과가 모두 비어 있어 그래프를 만들 수 없습니다." };
            }
            return {
                ok: true,
                labels,
                datasets,
                xLabel: primary,
                message: second
                    ? `${primary} 값을 움직이고, ${second}는 min/avg/max 세 기준으로 비교합니다. 나머지 feature는 평균값으로 고정합니다.${compiled.profile && compiled.profile.isCurved ? " POWER/EXP/LOG 등 함수식은 계산용으로 변환해 곡선 그래프로 표시합니다." : ""}`
                    : `${primary} 값을 움직이며 예측 y 변화를 표시합니다.${compiled.profile && compiled.profile.isCurved ? " POWER/EXP/LOG 등 함수식은 계산용으로 변환해 곡선 그래프로 표시합니다." : ""}`
            };
        },

        normalizeSymbolicExpressionForChart(expression) {
            let expr = String(expression || "").trim();
            const usedFunctions = new Set();
            if (!expr) {
                return { ok: false, message: "수식 정보가 없습니다." };
            }
            if (/[`"';&{}\[\]]/.test(expr)) {
                return { ok: false, message: "수식에 그래프 계산에서 허용하지 않는 문자가 포함되어 있습니다." };
            }
            const aliases = {
                abs: "abs",
                ceil: "ceil",
                ceiling: "ceil",
                cos: "cos",
                exp: "exp",
                floor: "floor",
                greatest: "max",
                least: "min",
                ln: "log",
                log: "log",
                max: "max",
                min: "min",
                mod: "mod",
                nullif: "nullif",
                nvl: "nvl",
                power: "pow",
                pow: "pow",
                round: "round",
                sign: "sign",
                sin: "sin",
                sqrt: "sqrt",
                square: "square",
                tan: "tan",
                trunc: "trunc"
            };
            expr = expr.replace(/\^/g, "**");
            expr = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, (match, name) => {
                const canonical = aliases[String(name || "").toLowerCase()];
                if (!canonical) return match;
                usedFunctions.add(canonical);
                return `${canonical}(`;
            });
            const functionNames = [...usedFunctions];
            return {
                ok: true,
                expression: expr,
                usedFunctions: functionNames,
                isCurved: functionNames.some((name) => ["exp", "log", "pow", "sqrt", "square", "sin", "cos", "tan"].includes(name)) || expr.includes("**")
            };
        },

        compileSymbolicExpression(expression, features) {
            const normalized = this.normalizeSymbolicExpressionForChart(expression);
            if (!normalized.ok) return normalized;
            let expr = normalized.expression;
            const allowedFunctions = {
                ceil: Math.ceil,
                floor: Math.floor,
                mod: (a, b) => (Number(b) === 0 ? NaN : a % b),
                nullif: (a, b) => (a === b ? NaN : a),
                nvl: (a, b) => (Number.isFinite(Number(a)) ? a : b),
                round: (a, digits = 0) => {
                    const scale = 10 ** Number(digits || 0);
                    return Math.round(a * scale) / scale;
                },
                sign: Math.sign,
                square: (x) => x * x,
                sqrt: Math.sqrt,
                log: (a, b) => (typeof b === "undefined" ? Math.log(a) : Math.log(b) / Math.log(a)),
                exp: Math.exp,
                sin: Math.sin,
                cos: Math.cos,
                tan: Math.tan,
                abs: Math.abs,
                pow: Math.pow,
                max: Math.max,
                min: Math.min,
                trunc: (a, digits = 0) => {
                    const scale = 10 ** Number(digits || 0);
                    return Math.trunc(a * scale) / scale;
                }
            };
            const featureSet = new Set(features.map((item) => String(item || "").trim()).filter(Boolean));
            const lowerFeatureSet = new Set([...featureSet].map((item) => item.toLowerCase()));
            const allowedNames = new Set([...Object.keys(allowedFunctions), "pi", "e"]);
            const identifiers = expr.match(/\b[A-Za-z_$][A-Za-z0-9_$#]*\b/g) || [];
            const unknown = identifiers.find((name) => !lowerFeatureSet.has(name.toLowerCase()) && !allowedNames.has(name.toLowerCase()));
            if (unknown) {
                return { ok: false, message: `수식의 ${unknown} 항목은 feature 목록에 없어 그래프로 계산하지 않았습니다.` };
            }
            const mappedFeatures = features.map((feature, index) => ({ feature, arg: `v${index}` }));
            mappedFeatures.forEach(({ feature, arg }) => {
                const escapedFeature = String(feature).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const pattern = new RegExp(`(^|[^A-Za-z0-9_$#])${escapedFeature}(?=$|[^A-Za-z0-9_$#])`, "gi");
                expr = expr.replace(pattern, (_match, prefix) => `${prefix}${arg}`);
            });
            const argNames = [
                ...mappedFeatures.map((item) => item.arg),
                ...Object.keys(allowedFunctions),
                "pi",
                "e"
            ];
            let fn;
            try {
                fn = new Function(...argNames, `"use strict"; return (${expr});`);
            } catch (error) {
                return { ok: false, message: `수식을 그래프 함수로 변환하지 못했습니다: ${error.message}` };
            }
            return {
                ok: true,
                profile: {
                    functions: normalized.usedFunctions,
                    isCurved: normalized.isCurved
                },
                evaluate: (values) => {
                    const args = [
                        ...mappedFeatures.map(({ feature }) => Number(values[feature])),
                        ...Object.values(allowedFunctions),
                        Math.PI,
                        Math.E
                    ];
                    try {
                        const result = Number(fn(...args));
                        return Number.isFinite(result) ? result : null;
                    } catch (_error) {
                        return null;
                    }
                }
            };
        },

        renderPredictedTypeSummary(summary, json = {}) {
            if (!summary) return "";
            const groups = Array.isArray(summary.summaryGroups) ? summary.summaryGroups : [];
            const finalGroups = Array.isArray(summary.finalSummaryGroups) ? summary.finalSummaryGroups : groups;
            const sourceGroups = Array.isArray(summary.predictionSourceGroups) ? summary.predictionSourceGroups : [];
            const matchGroups = Array.isArray(summary.predictionMatchGroups) ? summary.predictionMatchGroups : [];
            const activeCase = String(json.predictedTypeCase || this.predictedTypeFilter || "ALL").toUpperCase();
            return `
                <section class="M04002-type-summary">
                    <header>
                        <div>
                            <strong>컬럼 유형 예측 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)}</span>
                        </div>
                        <div class="M04002-type-summary-actions">
                            <div class="M04002-corr-metrics">
                                <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>전체 컬럼</small></span>
                                ${groups.map((group) => `
                                    <span><b>${this.formatNumber(group.columnCount)}</b><small>${this.escapeHtml(group.typeGroup)}</small></span>
                                `).join("")}
                            </div>
                            ${this.renderSamplePageJump("predictedTypePage-${PAGE_CODE}", json, "${PAGE_CODE}.goPredictedTypePage()", "${PAGE_CODE}.loadResultTable", {
                                pageSizeId: "predictedTypePageSize-${PAGE_CODE}",
                                pageSizes: [20, 50, 100, 200, 500],
                                onPageSizeChange: "${PAGE_CODE}.changeResultPageSize(this.value)"
                            })}
                        </div>
                    </header>
                    ${this.renderPredictedTypeUnifiedMode(sourceGroups, finalGroups, summary)}
                    ${matchGroups.length ? `
                        <div class="M04002-type-detail">
                            <strong>적용 FINAL / MODEL / RULE 예측 유형 상세 그룹</strong>
                            <div class="M04002-type-case-grid">
                                <button type="button" class="${activeCase === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectPredictedTypeCase('ALL')" title="모든 예측 결과">
                                    <b>전체</b>
                                    <small>${this.formatNumber(summary.totalColumnCount)} columns</small>
                                </button>
                                ${matchGroups.map((group) => `
                                    <button type="button" class="${activeCase === group.caseCode ? "is-active" : ""}" onclick="${PAGE_CODE}.selectPredictedTypeCase('${this.escapeJs(group.caseCode)}')" title="${this.escapeHtml(group.description || group.label)}">
                                        <b>${this.escapeHtml(group.label)}</b>
                                        <small>${this.formatNumber(group.columnCount)} columns · ${this.formatDecimal(group.rate)}%</small>
                                        <em>${this.escapeHtml(group.description || "")}</em>
                                    </button>
                                `).join("")}
                            </div>
                        </div>
                    ` : ""}
                </section>
            `;
        },

        renderPredictedTypeUnifiedMode(sourceGroups = [], finalGroups = [], summary = null) {
            const safeGroups = this.getUnifiedPredictionSourceGroups(sourceGroups, finalGroups);
            if (!safeGroups.length) {
                return `<div class="table-empty">표시할 RULE / MODEL / FINAL 예측 컬럼 정보가 없습니다.</div>`;
            }
            return `
                <div class="M04002-type-source-grid">
                    ${safeGroups.map((source) => this.renderPredictedTypeSourceGroup(source, summary)).join("")}
                </div>
            `;
        },

        renderPredictedTypeSourceMode(sourceGroups = [], summary = null) {
            return this.renderPredictedTypeUnifiedMode(sourceGroups, [], summary);
        },

        getSelectedPredictionMethod() {
            const payload = this.normalizeObject(this.selectedNode?.PAYLOAD);
            const params = this.normalizeObject(this.selectedNode?.RUNTIME_PARAMS);
            const runtimeParamMap = this.buildRuntimeParamValueMap(params, this.selectedNode, payload);
            const definition = this.getRuntimeParamDefinitions(payload, this.selectedNode)
                .find((item, index) => this.normalizeRuntimeParamKey(this.getRuntimeParamDefinitionName(item, index)) === "ppredictionmethod");
            const candidates = [
                params.P_PREDICTION_METHOD,
                params.pPredictionMethod,
                params.predictionMethod,
                definition
                    ? this.getRuntimeParamValueByName(
                        this.getRuntimeParamDefinitionName(definition),
                        runtimeParamMap,
                        this.getRuntimeParamDefinitionDefault(definition)
                    )
                    : "",
                payload.P_PREDICTION_METHOD,
                payload.pPredictionMethod,
                payload.predictionMethod
            ];
            return String(candidates.find((value) => value !== undefined && value !== null && String(value).trim()) || "").trim().toUpperCase();
        },

        getPredictionMethodSourceCodes(method = this.getSelectedPredictionMethod()) {
            const normalized = String(method || "").trim().toUpperCase();
            if (normalized.includes("BOTH")) return ["RULE", "MODEL"];
            if (normalized.includes("MODEL")) return ["MODEL"];
            if (normalized.includes("RULE")) return ["RULE"];
            return ["RULE", "MODEL"];
        },

        filterPredictionSourceGroups(sourceGroups = [], sourceCodes = []) {
            const allowed = new Set((sourceCodes || []).map((code) => String(code || "").toUpperCase()));
            return (Array.isArray(sourceGroups) ? sourceGroups : [])
                .filter((source) => allowed.has(String(source.sourceCode || "").toUpperCase()));
        },

        getUnifiedPredictionSourceGroups(sourceGroups = [], finalGroups = []) {
            const method = this.getSelectedPredictionMethod();
            const methodLabel = method || "P_PREDICTION_METHOD";
            const sourceMap = new Map((Array.isArray(sourceGroups) ? sourceGroups : [])
                .map((source) => [String(source.sourceCode || "").toUpperCase(), source]));
            const orderedCodes = [...this.getPredictionMethodSourceCodes(method), "FINAL"];
            return orderedCodes.map((code) => {
                const source = sourceMap.get(code);
                if (source) {
                    if (code === "FINAL") {
                        return {
                            ...source,
                            description: "최종 적용 INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_PREDICTED_TYPE"
                        };
                    }
                    return {
                        ...source,
                        description: `${methodLabel} RUN ID 기준 ${source.sourceColumn || ""}`.trim()
                    };
                }
                if (code === "FINAL" && Array.isArray(finalGroups) && finalGroups.length) {
                    return {
                        sourceCode: "FINAL",
                        sourceLabel: "FINAL",
                        sourceColumn: "FINAL_PREDICTED_TYPE",
                        description: "최종 적용 INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_PREDICTED_TYPE",
                        groups: finalGroups
                    };
                }
                return null;
            }).filter(Boolean);
        },

        renderPredictedTypeRunVersion(sourceGroups = [], fallbackGroups = [], summary = null) {
            const method = this.getSelectedPredictionMethod();
            const sourceCodes = this.getPredictionMethodSourceCodes(method);
            const safeSourceGroups = this.filterPredictionSourceGroups(sourceGroups, sourceCodes);
            const methodLabel = method || "P_PREDICTION_METHOD";
            if (!safeSourceGroups.length) {
                return this.renderPredictedTypeVersion("RUN 기준", `${methodLabel} 실행 당시 INIT$_TB_PREDICTED_TYPE 예측값`, fallbackGroups, summary);
            }
            return `
                <section class="M04002-type-version">
                    <header>
                        <strong>RUN 기준</strong>
                        <span>${this.escapeHtml(methodLabel)} 실행 당시 INIT$_TB_PREDICTED_TYPE 예측값</span>
                    </header>
                    <div class="M04002-type-run-source-grid">
                        ${safeSourceGroups.map((source) => this.renderPredictedTypeSourceGroup(source, summary, true)).join("")}
                    </div>
                </section>
            `;
        },

        renderPredictedTypeSourceGroup(source = {}, summary = null, compact = false) {
            const groups = Array.isArray(source.groups) ? source.groups : [];
            const total = groups.reduce((sum, group) => sum + Number(group.columnCount || 0), 0);
            const sourceClass = `is-source-${String(source.sourceCode || "").toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
            return `
                <section class="M04002-type-source ${sourceClass} ${compact ? "is-compact" : ""}">
                    <header>
                        <strong>${this.escapeHtml(source.sourceLabel || source.sourceCode || "-")}</strong>
                        <span>${this.escapeHtml(source.description || source.sourceColumn || "")}</span>
                        <small>${this.formatNumber(total)} columns</small>
                    </header>
                    <div class="M04002-type-source-groups">
                        ${groups.map((group) => this.renderPredictedTypeGroup(group, summary)).join("")}
                    </div>
                </section>
            `;
        },

        renderPredictedTypeVersion(title, note, groups = [], summary = null) {
            const safeGroups = Array.isArray(groups) ? groups : [];
            return `
                <section class="M04002-type-version">
                    <header>
                        <strong>${this.escapeHtml(title)}</strong>
                        <span>${this.escapeHtml(note)}</span>
                    </header>
                    <div class="M04002-type-group-grid">
                        ${safeGroups.map((group) => this.renderPredictedTypeGroup(group, summary)).join("")}
                    </div>
                </section>
            `;
        },

        renderPredictedTypeGroup(group, summary = null) {
            const columns = Array.isArray(group.columns) ? group.columns : [];
            const visibleColumns = columns.slice(0, 80);
            const hiddenCount = Math.max(0, columns.length - visibleColumns.length);
            return `
                <article class="M04002-type-group">
                    <header>
                        <strong>${this.escapeHtml(group.typeGroup)}</strong>
                        <small>${this.formatNumber(group.columnCount)} columns</small>
                    </header>
                    <div class="M04002-corr-tags">
                        ${visibleColumns.map((column) => this.renderColumnChip(column, summary || group)).join("")}
                        ${hiddenCount ? `<em class="M04002-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                    </div>
                </article>
            `;
        },

        async selectPredictedTypeCase(caseCode = "ALL") {
            this.predictedTypeFilter = String(caseCode || "ALL").trim().toUpperCase();
            if (!["ALL", "ALL_MATCH", "FINAL_MODEL", "FINAL_BASE", "MODEL_BASE", "ALL_DIFFERENT", "HAS_MISSING"].includes(this.predictedTypeFilter)) {
                this.predictedTypeFilter = "ALL";
            }
            await this.loadResultTable(1);
        },

        async selectPredictedTypeViewMode(mode = "TYPE") {
            this.predictedTypeViewMode = String(mode || "").toUpperCase() === "SOURCE" ? "SOURCE" : "TYPE";
            const summaryPanel = getContainerEl(`#tableResultSummary-${PAGE_CODE}`);
            if (summaryPanel && this.lastResultTableJson) {
                summaryPanel.innerHTML = this.renderTableResultSummary(this.lastResultTableJson);
                this.snapshotNodeResultCache();
                return;
            }
            await this.loadResultTable(this.resultPage || 1);
        },

        async goPredictedTypePage() {
            const input = getContainerEl("#predictedTypePage-${PAGE_CODE}");
            const page = Math.max(1, Number(input?.value || this.resultPage || 1));
            await this.loadResultTable(page);
        },

        async changeResultPageSize(value) {
            this.resultPageSize = Math.max(1, Math.min(500, Number(value || this.resultPageSize || 50)));
            await this.loadResultTable(1);
        },

        renderReadableRules(rows) {
            const candidates = rows.map((row, index) => {
                const ruleId = row.RULE_ID || `Rule ${index + 1}`;
                const ifText = this.resolveRuleText(row.ANTECEDENT || row.ANTECEDENT_ITEMS || row.LHS || "");
                const thenText = this.resolveRuleText(row.CONSEQUENT || row.RHS || row.ITEM_NAME || "");
                return { row, ruleId, ifText, thenText };
            });
            const filtered = this.excludeEmptyConsequent
                ? candidates.filter((rule) => !this.isEmptyRuleText(rule.thenText))
                : candidates;
            const rules = filtered.slice(0, 12).map((rule) => {
                const row = rule.row;
                return `
                    <article class="M04002-rule-card">
                        <strong>Rule #${this.escapeHtml(rule.ruleId)}</strong>
                        <p><b>IF</b> ${this.escapeHtml(rule.ifText || "조건 정보 없음")}</p>
                        <p><b>THEN</b> ${this.escapeHtml(rule.thenText || "결과 정보 없음")}</p>
                        <small>support ${this.formatPercent(row.RULE_SUPPORT)} · confidence ${this.formatPercent(row.RULE_CONFIDENCE)} · lift ${this.escapeHtml(row.RULE_LIFT ?? "-")}</small>
                    </article>
                `;
            }).join("");
            return `<section class="M04002-rule-grid">${rules || `<div class="table-empty">조건에 맞는 규칙 카드가 없습니다. 원본 행은 아래 테이블에서 확인할 수 있습니다.</div>`}</section>`;
        },

        renderRuleFilterBar() {
            return `
                <div class="M04002-rule-filter-bar">
                    <label>
                        <input type="checkbox" ${this.excludeEmptyConsequent ? "checked" : ""} onchange="${PAGE_CODE}.toggleExcludeEmptyConsequent(this.checked)">
                        <span>결과 정보 없음 제외</span>
                    </label>
                </div>
            `;
        },

        toggleExcludeEmptyConsequent(checked) {
            this.excludeEmptyConsequent = Boolean(checked);
            if (this.currentModelDetail) {
                this.renderModelAnalysis(this.currentModelDetail, "readable");
                this.snapshotNodeResultCache();
                return;
            }
            const viewButton = getContainerEl("#resultPanel-${PAGE_CODE} .M04002-result-header nav button.is-active");
            const viewType = viewButton?.textContent?.trim?.() || "VR";
            this.loadModelView(viewType, 1);
        },

        getNodeJobDesc(node = this.selectedNode) {
            return String(node?.JOB_DESC || node?.NODE_DESC || "").trim();
        },

        renderNodeJobDesc(node) {
            const desc = this.getNodeJobDesc(node);
            return desc ? `<em class="M04002-node-desc" title="${this.escapeHtml(desc)}">Job Desc: ${this.escapeHtml(desc)}</em>` : "";
        },

        getNodeExecutionTitle(node = this.selectedNode, fallback = "") {
            const payload = this.normalizeObject(node?.PAYLOAD);
            const params = this.normalizeObject(node?.RUNTIME_PARAMS);
            const getValue = (...keys) => {
                for (const key of keys) {
                    const value = node?.[key] ?? payload[key] ?? params[key];
                    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
                }
                return "";
            };
            const objectType = getValue("EXEC_OBJECT_TYPE", "execObjectType", "objectType");
            const objectName = getValue("EXEC_OBJECT_NAME", "execObjectName", "objectName");
            const objectLabel = getValue("EXEC_OBJECT_LABEL", "execObjectLabel", "objectLabel");
            const parts = [];
            if (objectType) parts.push(objectType.toUpperCase());
            if (objectName) parts.push(objectName);
            if (objectLabel && objectLabel !== objectName) parts.push(objectLabel);
            return parts.length ? parts.join(" · ") : String(fallback || "").trim();
        },

        renderNodeExecutionObject(node) {
            const title = this.getNodeExecutionTitle(node);
            return title ? `<small class="M04002-node-exec" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</small>` : "";
        },

        renderSelectedNodeJobDesc() {
            const desc = this.getNodeJobDesc();
            return desc ? `<p class="M04002-result-job-desc" title="${this.escapeHtml(desc)}"><b>Job Desc</b> ${this.escapeHtml(desc)}</p>` : "";
        },

        renderSelectedNodeExecutionMeta() {
            const node = this.selectedNode;
            if (!node) return "";
            const payload = this.normalizeObject(node.PAYLOAD);
            const params = this.normalizeObject(node.RUNTIME_PARAMS);
            const getValue = (...keys) => {
                for (const key of keys) {
                    const value = node[key] ?? payload[key] ?? params[key];
                    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
                }
                return "";
            };
            const targetOwner = getValue("TARGET_OWNER", "targetOwner", "INIT$TargetOwner", "ownerName", "OWNER_NAME");
            const targetTable = getValue("TARGET_TABLE", "targetTable", "INIT$TargetTable", "tableName", "TABLE_NAME");
            const resultOwner = getValue("RESULT_OWNER", "resultOwner", "ownerName");
            const resultObject = getValue("RESULT_OBJECT_NAME", "resultTableName", "tableName", "RESULT_TABLE_NAME");
            const resultMode = getValue("RESULT_CREATE_YN", "resultCreateYn");
            const resultModeLabel = String(resultMode || "").toUpperCase() === "M"
                ? "M (모델)"
                : (String(resultMode || "").toUpperCase() === "T" ? "T (테이블)" : resultMode);
            const metaRows = [
                { key: "target-owner", label: "Target Owner", value: targetOwner },
                { key: "target-table", label: "Target Table", value: targetTable },
                { key: "result-mode", label: "Result Mode", value: resultModeLabel },
                { key: "result-owner", label: "Result Owner", value: resultOwner },
                { key: "result-table", label: "Result Table", value: resultObject }
            ].filter(({ value }) => value !== undefined && value !== null && String(value).trim() !== "");
            const paramEntries = this.getDisplayRuntimeParamEntries(params, payload, node);
            if (!metaRows.length && !paramEntries.length) return "";
            return `
                <section class="M04002-execution-meta ${this.getNodeTone(node)}">
                    <div class="M04002-execution-meta-grid">
                        ${metaRows.map(({ key, label, value }) => `
                            <span class="is-${this.escapeHtml(key)}">
                                <small>${this.escapeHtml(label)}</small>
                                <b title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</b>
                            </span>
                        `).join("")}
                    </div>
                    ${paramEntries.length ? `
                        <details class="M04002-param-details">
                            <summary>호출 옵션 파라미터 ${this.formatNumber(paramEntries.length)}개</summary>
                            <div>
                                ${paramEntries.map(([key, value]) => `
                                    <span>
                                        <small>${this.escapeHtml(key)}</small>
                                        <b title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</b>
                                    </span>
                                `).join("")}
                            </div>
                        </details>
                    ` : ""}
                </section>
            `;
        },

        getSelectedNodeRuleModelName(node = this.selectedNode) {
            if (!node) return "";
            const payload = this.normalizeObject(node.PAYLOAD);
            const params = this.normalizeObject(node.RUNTIME_PARAMS);
            const candidates = [
                params.P_RULE_MODEL_NAME,
                params.pRuleModelName,
                params.ruleModelName,
                params["INIT$PreResultTable"],
                payload.P_RULE_MODEL_NAME,
                payload.pRuleModelName,
                payload.ruleModelName
            ];
            for (const value of candidates) {
                const normalized = this.normalizeIdentifierParam(value);
                if (normalized) return normalized;
            }
            return "";
        },

        getViolationDetectionCriteria(node = this.selectedNode) {
            const payload = this.normalizeObject(node?.PAYLOAD);
            const params = this.normalizeObject(node?.RUNTIME_PARAMS);
            const minConfidence = this.readNumericParam(
                [params.P_MIN_CONFIDENCE, params.pMinConfidence, params.minConfidence, payload.P_MIN_CONFIDENCE, payload.pMinConfidence, payload.minConfidence],
                0.8
            );
            const minLift = this.readNumericParam(
                [params.P_MIN_LIFT, params.pMinLift, params.minLift, payload.P_MIN_LIFT, payload.pMinLift, payload.minLift],
                1
            );
            const maxRules = this.readNumericParam(
                [params.P_MAX_RULES, params.pMaxRules, params.maxRules, payload.P_MAX_RULES, payload.pMaxRules, payload.maxRules],
                500
            );
            return {
                minConfidence: Math.max(0, Math.min(1, Number(minConfidence))),
                minLift: Math.max(0, Number(minLift)),
                maxRules: Math.max(1, Math.min(10000, Math.trunc(Number(maxRules))))
            };
        },

        readNumericParam(candidates = [], fallback = 0) {
            for (const value of candidates) {
                if (value === undefined || value === null || String(value).trim() === "") continue;
                const number = Number(String(value).trim());
                if (Number.isFinite(number)) return number;
            }
            return fallback;
        },

        normalizeRuleCardPageSize(value) {
            const allowed = [20, 40, 100, 500, 1000];
            const number = Number(value);
            return allowed.includes(number) ? number : 20;
        },

        normalizeIdentifierParam(value) {
            const text = String(value ?? "").trim().toUpperCase();
            return /^[A-Z][A-Z0-9_$#]{0,127}$/.test(text) ? text : "";
        },

        quoteSqlName(value) {
            return `"${String(value || "").replace(/"/g, "\"\"")}"`;
        },

        sqlLiteral(value) {
            return `'${String(value ?? "").replace(/'/g, "''")}'`;
        },

        normalizeObject(value) {
            if (!value) return {};
            if (typeof value === "object" && !Array.isArray(value)) return value;
            if (typeof value !== "string") return {};
            try {
                const parsed = JSON.parse(value);
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch (_error) {
                return {};
            }
        },

        formatParamValue(value) {
            if (value === undefined || value === null) return "";
            if (typeof value === "object") return JSON.stringify(value);
            return String(value);
        },

        normalizeRuntimeParamKey(key) {
            return String(key || "")
                .replace(/^:/, "")
                .replace(/[^A-Za-z0-9]/g, "")
                .toLowerCase();
        },

        isInternalRuntimeParamKey(key, isDeclaredInputParam = false) {
            const rawKey = String(key || "").trim();
            if (!rawKey) return true;
            if (rawKey.toUpperCase().startsWith("INIT$")) return true;
            if (isDeclaredInputParam) return false;
            const internalKeys = new Set([
                "inputtable",
                "inputowner",
                "targetowner",
                "targettable",
                "runsourcetype",
                "runid",
                "flowrunid"
            ]);
            return internalKeys.has(this.normalizeRuntimeParamKey(rawKey));
        },

        normalizeRuntimeParamDefinitionList(value) {
            if (Array.isArray(value)) return value;
            if (typeof value !== "string") return [];
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_error) {
                return [];
            }
        },

        async loadRuntimeParamPresetDefinitions() {
            this.runtimeParamPresetMap = new Map();
            try {
                const response = await fetch(`${DETAIL_PRESET_URL}?v=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) return;
                const presets = await response.json();
                (Array.isArray(presets) ? presets : []).forEach((preset) => {
                    const keys = [
                        preset?.objectName,
                        preset?.OBJECT_NAME,
                        preset?.label,
                        preset?.LABEL,
                        preset?.resultTableName,
                        preset?.RESULT_TABLE_NAME
                    ].map((value) => this.normalizePresetMatchKey(value)).filter(Boolean);
                    const items = this.normalizeRuntimeParamDefinitionList(preset?.items || preset?.ITEMS || preset?.params || preset?.PARAMS || []);
                    if (items.length) {
                        keys.forEach((key) => {
                            if (!this.runtimeParamPresetMap.has(key)) this.runtimeParamPresetMap.set(key, items);
                        });
                    }
                });
            } catch (error) {
                console.warn(`[${PAGE_CODE}] runtime parameter presets load failed`, error);
            }
        },

        normalizePresetMatchKey(value) {
            return String(value || "")
                .trim()
                .toUpperCase()
                .replace(/\s+/g, " ");
        },

        getNodeExecutableObjectNames(node = this.selectedNode, payload = null) {
            const normalizedPayload = payload || this.normalizeObject(node?.PAYLOAD);
            const candidates = [
                node?.EXEC_OBJECT_NAME,
                node?.EXEC_OBJECT_LABEL,
                node?.JOB_NAME,
                node?.execObjectName,
                node?.execObjectLabel,
                node?.jobName,
                node?.NODE_NAME,
                node?.RESULT_OBJECT_NAME,
                normalizedPayload?.execObjectName,
                normalizedPayload?.EXEC_OBJECT_NAME,
                normalizedPayload?.execObjectLabel,
                normalizedPayload?.EXEC_OBJECT_LABEL,
                normalizedPayload?.jobName,
                normalizedPayload?.JOB_NAME,
                normalizedPayload?.nodeName,
                normalizedPayload?.NODE_NAME,
                normalizedPayload?.objectName,
                normalizedPayload?.OBJECT_NAME,
                normalizedPayload?.resultTableName,
                normalizedPayload?.RESULT_TABLE_NAME,
                normalizedPayload?.tableName,
                normalizedPayload?.TABLE_NAME
            ];
            return [...new Set(candidates.map((value) => this.normalizePresetMatchKey(value)).filter(Boolean))];
        },

        getRuntimeParamPresetDefinitions(node = this.selectedNode, payload = null) {
            if (!this.runtimeParamPresetMap) return [];
            const names = this.getNodeExecutableObjectNames(node, payload);
            for (const name of names) {
                const items = this.runtimeParamPresetMap.get(name);
                if (Array.isArray(items) && items.length) return items;
                const simpleName = name.includes(".") ? name.split(".").pop() : "";
                if (simpleName) {
                    const simpleItems = this.runtimeParamPresetMap.get(simpleName);
                    if (Array.isArray(simpleItems) && simpleItems.length) return simpleItems;
                }
            }
            return [];
        },

        getBuiltInRuntimeParamDefinitions(node = this.selectedNode, payload = null) {
            const names = this.getNodeExecutableObjectNames(node, payload);
            const hasName = (...tokens) => names.some((name) =>
                tokens.some((token) => name === token || name.endsWith(`.${token}`))
            );
            if (!hasName("INIT$_SP_PREDICTED_TYPE", "INIT$_TB_PREDICTED_TYPE", "INIT$_TB_PREDICTED_TYPE_FINAL")) {
                return [];
            }
            return [
                { key: "P_TARGET_OWNER", comment: "분석 대상 테이블 계정", defaultValue: ":INIT$TargetOwner" },
                { key: "P_TARGET_TABLE", comment: "분석 대상 테이블명", defaultValue: ":INIT$TargetTable" },
                { key: "P_DYNAMIC_MODEL_NAME", comment: "분류/예측 모델명", defaultValue: "OML_DECISION_TREE_MODEL_01" },
                { key: "P_PREDICTION_METHOD", comment: "예측 방식 선택(ONLY_RULE: BASE 컬럼만, ONLY_MODEL: MODL 컬럼만, ONLY_BOTH: BASE/MODL 컬럼, FINAL_RULE/MODEL/BOTH: FINAL 자동 반영)", defaultValue: "ONLY_BOTH" },
                { key: "P_RUN_SOURCE_TYPE", comment: "실행 출처 구분(DATA_WORK/FLOW_WORK)", defaultValue: ":INIT$RunSourceType" },
                { key: "P_RUN_ID", comment: "실행 이력 ID", defaultValue: ":INIT$RunId" }
            ];
        },

        countVisibleRuntimeParamDefinitions(definitions = []) {
            return (Array.isArray(definitions) ? definitions : [])
                .filter((item) => this.isInputRuntimeParamDefinition(item))
                .filter((item, index) => !this.isInternalRuntimeParamKey(this.getRuntimeParamDefinitionName(item, index), true))
                .length;
        },

        getRuntimeParamDefinitions(payload = {}, node = null) {
            const normalized = this.normalizeObject(payload);
            const payloadParams = Array.isArray(normalized.params)
                ? normalized.params
                : (Array.isArray(normalized.PARAMS) ? normalized.PARAMS : []);
            const jobParams = this.normalizeRuntimeParamDefinitionList(node?.JOB_PARAM_JSON || node?.jobParamJson || node?.PARAM_JSON || node?.paramJson);
            const presetParams = this.getRuntimeParamPresetDefinitions(node, normalized);
            const builtInParams = this.getBuiltInRuntimeParamDefinitions(node, normalized);
            const candidates = [
                { source: "JOB", params: jobParams, priority: 30 },
                { source: "PRESET", params: presetParams, priority: 20 },
                { source: "BUILTIN", params: builtInParams, priority: 15 },
                { source: "PAYLOAD", params: payloadParams, priority: 10 }
            ].filter((candidate) => Array.isArray(candidate.params) && candidate.params.length);
            if (!candidates.length) return [];
            candidates.sort((left, right) => {
                const visibleDiff = this.countVisibleRuntimeParamDefinitions(right.params) - this.countVisibleRuntimeParamDefinitions(left.params);
                if (visibleDiff) return visibleDiff;
                const lengthDiff = right.params.length - left.params.length;
                if (lengthDiff) return lengthDiff;
                return right.priority - left.priority;
            });
            return candidates[0].params;
        },

        isInputRuntimeParamDefinition(item = {}) {
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

        addRuntimeParamMapEntry(map, name, value) {
            const key = this.normalizeRuntimeParamKey(name);
            if (!key) return;
            map.set(key, value);
            const aliases = {
                targetowner: ["inittargetowner"],
                inittargetowner: ["targetowner"],
                targettable: ["inittargettable"],
                inittargettable: ["targettable"],
                resultowner: ["initresultowner"],
                initresultowner: ["resultowner"],
                resulttable: ["initresulttable", "initresultmodelname"],
                initresulttable: ["resulttable", "initresultmodelname"],
                resultmodelname: ["initresultmodelname"],
                initresultmodelname: ["resultmodelname", "resulttable"],
                runsourcetype: ["initrunsourcetype"],
                initrunsourcetype: ["runsourcetype"],
                runid: ["initrunid", "initflowrunid", "flowrunid"],
                initrunid: ["runid", "flowrunid", "initflowrunid"],
                flowrunid: ["initflowrunid", "initrunid", "runid"],
                initflowrunid: ["flowrunid", "runid", "initrunid"]
            };
            (aliases[key] || []).forEach((alias) => {
                if (!map.has(alias)) map.set(alias, value);
            });
        },

        addRuntimeParamContextValues(map, node = null, payload = {}) {
            const normalizedPayload = this.normalizeObject(payload);
            const getValue = (...keys) => {
                for (const key of keys) {
                    const value = node?.[key] ?? normalizedPayload?.[key];
                    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
                }
                return "";
            };
            const runId = this.selectedRun?.FLOW_RUN_ID || node?.FLOW_RUN_ID || normalizedPayload.flowRunId || normalizedPayload.runId || "";
            [
                ["INIT$TargetOwner", getValue("TARGET_OWNER", "targetOwner", "ownerName", "OWNER_NAME")],
                ["INIT$TargetTable", getValue("TARGET_TABLE", "targetTable", "tableName", "TABLE_NAME")],
                ["INIT$ResultOwner", getValue("RESULT_OWNER", "resultOwner")],
                ["INIT$ResultTable", getValue("RESULT_OBJECT_NAME", "resultTableName", "tableName")],
                ["INIT$ResultModelName", getValue("RESULT_OBJECT_NAME", "resultTableName", "tableName")],
                ["INIT$RunSourceType", "FLOW_WORK"],
                ["INIT$RunId", runId],
                ["INIT$FlowRunId", runId],
                ["runSourceType", "FLOW_WORK"],
                ["runId", runId],
                ["flowRunId", runId]
            ].forEach(([name, value]) => {
                if (value !== undefined && value !== null && String(value).trim() !== "") {
                    this.addRuntimeParamMapEntry(map, name, value);
                }
            });
        },

        buildRuntimeParamValueMap(params = {}, node = null, payload = {}) {
            const map = new Map();
            Object.entries(this.normalizeObject(params)).forEach(([key, value]) => {
                this.addRuntimeParamMapEntry(map, key, value);
            });
            this.addRuntimeParamContextValues(map, node, payload);
            return map;
        },

        getRuntimeParamDefinitionName(item, index = 0) {
            return String(item?.itemName || item?.ITEM_NAME || item?.name || item?.NAME || item?.key || item?.KEY || `PARAM_${index + 1}`);
        },

        getRuntimeParamDefinitionDefault(item) {
            return item?.value
                ?? item?.VALUE
                ?? item?.actualValue
                ?? item?.ACTUAL_VALUE
                ?? item?.defaultValue
                ?? item?.DEFAULT_VALUE
                ?? item?.itemDefault
                ?? item?.ITEM_DEFAULT
                ?? item?.item_default
                ?? "";
        },

        getRuntimeParamValueByName(name, runtimeParamMap, fallback = "") {
            const key = this.normalizeRuntimeParamKey(name);
            return runtimeParamMap.has(key) ? runtimeParamMap.get(key) : fallback;
        },

        resolveRuntimeParamDisplayValue(value, runtimeParamMap) {
            const text = String(value ?? "").trim();
            const bindMatch = text.match(/^:([A-Za-z][A-Za-z0-9_$#]*)$/);
            if (bindMatch) {
                const key = this.normalizeRuntimeParamKey(bindMatch[1]);
                if (runtimeParamMap.has(key)) return runtimeParamMap.get(key);
            }
            const tokenMatch = text.match(/^\/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*)\s*--\s*\*\/$/);
            if (tokenMatch) {
                const key = this.normalizeRuntimeParamKey(tokenMatch[1]);
                if (runtimeParamMap.has(key)) return runtimeParamMap.get(key);
            }
            return value;
        },

        getDisplayRuntimeParamEntries(params = {}, payload = {}, node = null) {
            const runtimeParamMap = this.buildRuntimeParamValueMap(params, node, payload);
            const definitions = this.getRuntimeParamDefinitions(payload, node);
            if (definitions.length) {
                return definitions
                    .filter((item) => this.isInputRuntimeParamDefinition(item))
                    .map((item, index) => {
                        const key = this.getRuntimeParamDefinitionName(item, index);
                        const rawValue = this.getRuntimeParamValueByName(key, runtimeParamMap, this.getRuntimeParamDefinitionDefault(item));
                        return [key, this.formatParamValue(this.resolveRuntimeParamDisplayValue(rawValue, runtimeParamMap))];
                    })
                    .filter(([key]) => !this.isInternalRuntimeParamKey(key, true));
            }
            return Object.entries(this.normalizeObject(params))
                .filter(([key, value]) =>
                    !this.isInternalRuntimeParamKey(key)
                    && value !== undefined
                    && value !== null
                    && String(value).trim() !== ""
                )
                .map(([key, value]) => [key, this.formatParamValue(value)]);
        },

        getColumnComments(source = null) {
            return {
                ...(this.currentModelDetail?.columnComments || {}),
                ...(this.currentModelDetail?.ruleSummary?.columnComments || {}),
                ...(source?.columnComments || {}),
                ...(source?.correlationSummary?.columnComments || {}),
                ...(source?.predictedTypeSummary?.columnComments || {}),
                ...(source?.lassoSummary?.columnComments || {}),
                ...(source?.symbolicRuleSummary?.columnComments || {}),
                ...(source?.symbolicViolationSummary?.columnComments || {})
            };
        },

        getColumnComment(columnName, source = null) {
            const key = String(columnName || "").trim().toUpperCase();
            if (!key) return "";
            const comments = this.getColumnComments(source);
            return String(comments[key] || "").trim();
        },

        renderColumnRef(columnName, source = null) {
            const column = String(columnName || "").trim();
            if (!column) return "";
            const comment = this.getColumnComment(column, source);
            if (!comment) return this.escapeHtml(column);
            return `
                <span class="M04002-column-ref" title="${this.escapeHtml(`${column}: ${comment}`)}">
                    <b>${this.escapeHtml(column)}</b>
                    <small>${this.escapeHtml(comment)}</small>
                </span>
            `;
        },

        renderColumnChip(columnName, source = null) {
            const column = String(columnName || "").trim();
            if (!column) return "";
            const comment = this.getColumnComment(column, source);
            return `
                <em class="M04002-column-chip" title="${this.escapeHtml(comment ? `${column}: ${comment}` : column)}">
                    <b>${this.escapeHtml(column)}</b>
                    ${comment ? `<small>${this.escapeHtml(comment)}</small>` : ""}
                </em>
            `;
        },

        renderColumnAwareText(text, source = null) {
            const raw = String(text ?? "");
            if (!raw) return "";
            const pattern = /\b[A-Za-z][A-Za-z0-9_$#]{0,127}\b/g;
            let result = "";
            let lastIndex = 0;
            let match;
            while ((match = pattern.exec(raw)) !== null) {
                const token = match[0];
                result += this.escapeHtml(raw.slice(lastIndex, match.index));
                result += this.getColumnComment(token, source) ? this.renderColumnRef(token, source) : this.escapeHtml(token);
                lastIndex = match.index + token.length;
            }
            result += this.escapeHtml(raw.slice(lastIndex));
            return result;
        },

        renderColumnAwareCell(value, source = null) {
            const text = String(value ?? "");
            return this.getColumnComment(text, source) ? this.renderColumnRef(text, source) : this.escapeHtml(text);
        },

        extractItemsetTags(rows) {
            const counts = new Map();
            rows.forEach((row) => {
                Object.entries(row || {}).forEach(([key, value]) => {
                    if (!/ITEM|ATTRIBUTE|VALUE|NAME/i.test(key)) return;
                    String(value ?? "").split(/[{},;|]+/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
                        if (part.length > 48) return;
                        counts.set(part, (counts.get(part) || 0) + 1);
                    });
                });
            });
            const max = Math.max(1, ...counts.values());
            return [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => ({ label, weight: (0.75 + (count / max) * 0.65).toFixed(2) }));
        },

        extractRuleRows(rows) {
            return rows.map((row, index) => {
                const entries = Object.entries(row || {});
                const labelEntry = entries.find(([key]) => /RULE|ITEM|ANT|CONSE|PRED/i.test(key));
                const scoreEntry = entries.find(([key, value]) => /LIFT|CONF|SUPPORT|PROB/i.test(key) && !Number.isNaN(Number(value)));
                const rawScore = Number(scoreEntry?.[1] ?? 0);
                const score = rawScore <= 1 ? rawScore * 100 : Math.min(rawScore * 10, 100);
                return {
                    label: String(labelEntry?.[1] || `Rule ${index + 1}`).slice(0, 90),
                    score: Math.min(100, Math.max(0, score || 8)),
                    scoreName: scoreEntry?.[0] || "",
                    scoreValue: scoreEntry ? this.formatDecimal(rawScore) : ""
                };
            });
        },

        buildReadableRuleCards(rows, itemDictionary = new Map()) {
            return (rows || []).map((row, index) => {
                const ruleId = this.findRuleValue(row, [/^RULE_ID$/i, /RULE.*ID/i]) || `Rule ${index + 1}`;
                const antecedent = this.findRuleValue(row, [/ANTECEDENT/i, /\bLHS\b/i, /PREMISE/i, /CONDITION/i, /\bIF\b/i]);
                const consequent = this.findRuleValue(row, [/CONSEQUENT/i, /\bRHS\b/i, /PREDICT/i, /OUTCOME/i, /\bTHEN\b/i]);
                const antecedentText = this.resolveRuleSideText(antecedent, itemDictionary);
                const consequentText = this.resolveRuleSideText(consequent, itemDictionary);
                const thenText = consequentText && !this.ruleTextHasExplicitValue(consequentText) && !/값 정보 없음/.test(consequentText)
                    ? `${consequentText} (값 정보 없음)`
                    : consequentText;
                const support = this.findMetricValue(row, [/RULE_SUPPORT/i, /^SUPPORT$/i]);
                const confidence = this.findMetricValue(row, [/RULE_CONFIDENCE/i, /^CONFIDENCE$/i]);
                const lift = this.findMetricValue(row, [/RULE_LIFT/i, /^LIFT$/i]);
                const mapped = Boolean(antecedentText && consequentText);
                const missingConsequentValue = mapped && thenText !== consequentText;
                const conditionCount = mapped ? this.countRuleConditions(antecedentText) : 0;
                const rawRuleId = String(ruleId || `Rule ${index + 1}`);
                return {
                    ruleId: `Rule #${rawRuleId}`,
                    rawRuleId,
                    confidenceValue: confidence,
                    canOpenViolation: this.isRuleViolationCandidate(confidence),
                    mappingLevel: mapped ? "mapped" : "limited",
                    mappingLabel: mapped ? "조건/결과 매핑됨" : "ID/지표 중심",
                    ifText: mapped ? antecedentText : "조건 항목 조합을 Detail Views에서 확인해야 합니다",
                    thenText: mapped ? thenText : "결과 항목을 Detail Views에서 확인해야 합니다",
                    note: mapped && missingConsequentValue
                        ? "조건은 XML itemset에서 컬럼 = 값으로 해석했습니다. 결과는 모델뷰가 컬럼명만 제공해서 값은 현재 뷰에서 확인되지 않습니다."
                        : (mapped
                            ? "모델 detail view의 XML itemset과 item dictionary 후보를 사용해 사람이 읽는 문장으로 구성했습니다."
                            : "현재 DM$VR/DM$VI/DM$VA 샘플에는 컬럼명과 값으로 복원 가능한 조건/결과 매핑이 보이지 않습니다."),
                    metrics: [
                        { label: "support", value: support === null ? "-" : this.formatPercentMetric(support) },
                        { label: "confidence", value: confidence === null ? "-" : this.formatPercentMetric(confidence) },
                        { label: "예상 위반", value: this.formatExpectedViolationRate(confidence) },
                        { label: "lift", value: lift === null ? "-" : this.formatDecimal(lift) }
                    ],
                    conditionCount,
                    thenText
                };
            });
        },

        countRuleConditions(text) {
            const normalized = String(text || "").trim();
            if (!normalized || /Detail Views에서 확인/.test(normalized)) return 0;
            return normalized
                .split(/\s+AND\s+/i)
                .map((item) => item.trim())
                .filter(Boolean).length || 0;
        },

        findRuleValue(row, patterns = []) {
            const found = Object.entries(row || {}).find(([key, value]) => {
                if (value === null || value === undefined || String(value).trim() === "") return false;
                if (this.isRuleMetricColumn(key)) return false;
                return patterns.some((pattern) => pattern.test(String(key || "")));
            });
            return found ? found[1] : "";
        },

        isRuleMetricColumn(key) {
            return /(SUPPORT|CONFIDENCE|LIFT|COUNT|PROB|P_VALUE|NUMERIC|RANK|PARTITION)/i.test(String(key || ""));
        },

        buildItemDictionary(rows = []) {
            const dictionary = new Map();
            rows.forEach((row) => {
                const entries = Object.entries(row || {});
                const idEntry = entries.find(([key, value]) => /(^|_)(ITEM|ITEMSET|ATTRIBUTE|ATTR).*ID$/i.test(key) && value !== null && value !== undefined);
                if (!idEntry) return;
                const name = this.findDictionaryValue(row, [/ATTRIBUTE.*NAME/i, /ATTR.*NAME/i, /COLUMN.*NAME/i, /^NAME$/i, /ITEM.*NAME/i]);
                const value = this.findDictionaryValue(row, [/ATTRIBUTE.*VALUE/i, /ATTR.*VALUE/i, /^VALUE$/i, /ITEM.*VALUE/i, /STRING.*VALUE/i]);
                const label = [name, value].filter(Boolean).join(" = ");
                if (label) dictionary.set(String(idEntry[1]), label);
            });
            return dictionary;
        },

        findDictionaryValue(row, patterns = []) {
            const found = Object.entries(row || {}).find(([key, value]) => {
                if (value === null || value === undefined || String(value).trim() === "") return false;
                return patterns.some((pattern) => pattern.test(String(key || "")));
            });
            return found ? String(found[1]).trim() : "";
        },

        resolveRuleSideText(value, dictionary = new Map()) {
            const text = String(value ?? "").trim();
            if (!text) return "";
            const itemsetItems = this.parseOracleItemsetText(text);
            if (itemsetItems.length) {
                return itemsetItems
                    .map((item) => this.formatOracleItemsetItem(item, dictionary))
                    .filter(Boolean)
                    .join(" AND ");
            }
            const tokens = text.split(/[{},;|]+/).map((part) => part.trim()).filter(Boolean);
            const resolved = tokens.map((token) => dictionary.get(token) || token);
            const meaningful = resolved.filter((token) => !/^\d+(\.\d+)?$/.test(token));
            if (!meaningful.length) return "";
            return meaningful.map((token) => this.formatRuleExpression(token)).join(" AND ");
        },

        parseOracleItemsetText(value) {
            const text = String(value ?? "").trim();
            if (!/<item\b/i.test(text)) return [];
            const items = [];
            const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
            let match;
            while ((match = itemPattern.exec(text)) !== null) {
                const itemBody = match[1] || "";
                items.push({
                    name: this.readXmlTagValue(itemBody, "item_name"),
                    subname: this.readXmlTagValue(itemBody, "item_subname"),
                    value: this.readXmlTagValue(itemBody, "item_value")
                });
            }
            return items;
        },

        formatOracleItemsetItem(item, dictionary = new Map()) {
            const rawName = String(item?.name || "").trim();
            const rawSubname = String(item?.subname || "").trim();
            const rawValue = String(item?.value || "").trim();
            const dictionaryLabel = dictionary.get(rawName);
            if (dictionaryLabel && !rawValue) return dictionaryLabel;
            const name = dictionaryLabel || rawName;
            if (!name && !rawValue) return "";
            const field = rawSubname ? `${name}.${rawSubname}` : name;
            if (field && rawValue) return `${field} = ${rawValue}`;
            if (field) return `${field} (값 정보 없음)`;
            return rawValue;
        },

        ruleTextHasExplicitValue(value) {
            return /(?:=|>|<|>=|<=|!=|<>|\bIS\b|\bLIKE\b)/i.test(String(value || ""));
        },

        findMetricValue(row, patterns = []) {
            const found = Object.entries(row || {}).find(([key, value]) => {
                if (value === null || value === undefined || String(value).trim() === "") return false;
                if (!patterns.some((pattern) => pattern.test(String(key || "")))) return false;
                return Number.isFinite(Number(value));
            });
            return found ? Number(found[1]) : null;
        },

        formatRuleExpression(value) {
            const text = String(value ?? "").trim();
            if (!text) return "-";
            return text
                .replace(/[{}"]/g, "")
                .replace(/\s*[|;]\s*/g, " AND ")
                .replace(/\s*,\s*/g, " AND ")
                .replace(/\s+/g, " ");
        },

        formatPercentMetric(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return "-";
            const percent = number <= 1 ? number * 100 : number;
            return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
        },

        normalizeProbability(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return null;
            return number <= 1 ? number : number / 100;
        },

        formatExpectedViolationRate(confidence) {
            const probability = this.normalizeProbability(confidence);
            if (probability === null) return "-";
            return this.formatPercentMetric(Math.max(0, 1 - probability));
        },

        extractNumericProfile(rows, columns) {
            return columns.map((column) => {
                const values = rows.map((row) => Number(row?.[column])).filter((value) => Number.isFinite(value));
                if (!values.length) return null;
                const max = Math.max(...values);
                const min = Math.min(...values);
                const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
                const width = max === min ? 100 : Math.max(6, Math.min(100, ((avg - min) / (max - min)) * 100));
                return { column, width, label: `avg ${this.formatDecimal(avg)}` };
            }).filter(Boolean);
        },

        isEmptyRuleText(value) {
            const text = String(value || "").trim();
            return !text || text === "결과 정보 없음" || /값 정보 없음/.test(text);
        },

        renderGrid(columns, rows, source = null) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__");
            if (!safeColumns.length) return `<div class="table-empty">조회 결과가 없습니다.</div>`;
            return `
                <div class="M04002-grid-wrap">
                    <table class="table-grid M04002-grid">
                        <thead><tr>${safeColumns.map((column) => `<th>${this.renderColumnAwareCell(column, source)}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${(rows || []).map((row) => `<tr>${safeColumns.map((column) => {
                                const value = row?.[column] ?? "";
                                return `<td title="${this.escapeHtml(value)}">${this.renderColumnAwareCell(value, source)}</td>`;
                            }).join("")}</tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        renderResultPager(page, pageSize, total, callPrefix) {
            callPrefix = resolvePageText(callPrefix);
            const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 1)));
            const prev = Math.max(1, Number(page || 1) - 1);
            const next = Math.min(totalPages, Number(page || 1) + 1);
            return `
                <footer class="M04002-pager">
                    <button type="button" ${Number(page) <= 1 ? "disabled" : ""} onclick="${callPrefix}${prev})"><i class="fas fa-chevron-left"></i></button>
                    <span>${this.formatNumber(page)} / ${this.formatNumber(totalPages)}</span>
                    <button type="button" ${Number(page) >= totalPages ? "disabled" : ""} onclick="${callPrefix}${next})"><i class="fas fa-chevron-right"></i></button>
                </footer>
            `;
        },

        exportCurrent() {
            const columns = this.currentExport.columns || [];
            const rows = this.currentExport.rows || [];
            if (!columns.length) {
                alert("Export할 데이터가 없습니다.");
                return;
            }
            this.downloadCsv(this.currentExport.filename || "integrated-result.csv", columns, rows);
        },

        downloadCsv(filename, columns = [], rows = []) {
            const csv = [
                columns.map((column) => this.csvCell(column)).join(","),
                ...rows.map((row) => columns.map((column) => this.csvCell(row?.[column] ?? "")).join(","))
            ].join("\r\n");
            const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = filename || "integrated-result.csv";
            link.click();
            URL.revokeObjectURL(link.href);
        },

        csvCell(value) {
            return `"${String(value ?? "").replace(/"/g, '""')}"`;
        },

        resolveRuleText(value) {
            const text = String(value ?? "").trim();
            if (!text) return "";
            if (!/<item\b/i.test(text)) return text;
            const items = [];
            const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
            let match;
            while ((match = itemPattern.exec(text)) !== null) {
                const body = match[1] || "";
                const name = this.readXmlTagValue(body, "item_name");
                const subname = this.readXmlTagValue(body, "item_subname");
                const itemValue = this.readXmlTagValue(body, "item_value");
                const field = subname ? `${name}.${subname}` : name;
                if (field && itemValue) items.push(`${field} = ${itemValue}`);
                else if (field) items.push(`${field} (값 정보 없음)`);
            }
            return items.join(" AND ");
        },

        readXmlTagValue(text, tagName) {
            const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
            const match = pattern.exec(String(text || ""));
            return match ? this.decodeXmlText(match[1]).trim() : "";
        },

        decodeXmlText(value) {
            return String(value ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#39;/g, "'");
        },

        formatNumber(value) {
            const number = Number(value || 0);
            return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
        },

        formatDateTime(value) {
            const date = this.parseDateTime(value);
            if (!date) return String(value || "").trim() || "-";
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
            const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
            return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${milliseconds} KST`;
        },

        parseDateTime(value) {
            if (!value) return null;
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
            const text = String(value).trim();
            const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/);
            if (match) {
                const [, year, month, day, hour, minute, second, fraction] = match;
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
                    Number(second),
                    Number(String(fraction || "0").padEnd(3, "0").slice(0, 3))
                ));
            }
            const parsed = new Date(text);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        },

        formatPercent(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return "-";
            const percent = number <= 1 ? number * 100 : number;
            return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
        },

        formatDecimal(value) {
            const number = Number(value || 0);
            if (!Number.isFinite(number)) return "0";
            return number.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
        },

        formatElapsedTime(startedAt, finishedAt, status = "") {
            if (!startedAt) return "-";
            const start = this.parseDateTime(startedAt);
            const end = finishedAt ? this.parseDateTime(finishedAt) : (String(status).toUpperCase() === "RUNNING" ? new Date() : null);
            if (!end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
            const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
            if (seconds < 60) return `${seconds}s`;
            const minutes = Math.floor(seconds / 60);
            return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        },

        getStatusClass(status) {
            const text = String(status || "").toUpperCase();
            if (text === "SUCCESS") return "is-success";
            if (["FAILED", "SKIPPED", "ERROR"].includes(text)) return "is-failed";
            if (["RUNNING", "STARTED"].includes(text)) return "is-running";
            return "is-neutral";
        },

        getNodeTone(node) {
            const code = String(node?.REF_MENU_CODE || node?.NODE_TYPE || node?.JOB_GROUP || "").toUpperCase();
            if (code === "M03002") return "is-correlation";
            if (this.isAssociationRuleNode(node)) return "is-discovery";
            if (this.isViolationNode(node)) return "is-violation";
            return "is-profile";
        },

        getNodeIcon(node) {
            const code = String(node?.REF_MENU_CODE || node?.NODE_TYPE || node?.JOB_GROUP || "").toUpperCase();
            if (code === "M03002") return "fa-border-all";
            if (this.isAssociationRuleNode(node)) return "fa-wand-magic-sparkles";
            if (this.isViolationNode(node)) return "fa-shield-halved";
            return "fa-table-columns";
        },

        isAssociationRuleNode(node) {
            return this.matchesNodeWork(node, "M03003", "INIT$_SP_APRIORI_ASSOC_MODEL");
        },

        isViolationNode(node) {
            return this.isRuleViolationNode(node) || this.isSymbolicViolationNode(node);
        },

        isRuleViolationNode(node) {
            const resultObject = String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            if (resultObject === "INIT$_TB_RULE_VIOLATION_RESULT") return true;
            if (resultObject === "INIT$_TB_SYMBOLIC_RULE_VIOLATION") return false;
            return this.nodeWorkContains(node, "INIT$_SP_RULE_VIOLATION_DETECT")
                && !this.nodeWorkContains(node, "INIT$_SP_SYMBOLIC_RULE_VIOLATION_DETECT");
        },

        isSymbolicViolationNode(node) {
            const resultObject = String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            if (resultObject === "INIT$_TB_SYMBOLIC_RULE_VIOLATION") return true;
            if (resultObject === "INIT$_TB_RULE_VIOLATION_RESULT") return false;
            return this.nodeWorkContains(node, "INIT$_SP_SYMBOLIC_RULE_VIOLATION_DETECT");
        },

        isSymbolicRuleNode(node) {
            const resultObject = String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            if (resultObject === "INIT$_TB_SYMBOLIC_RULE") return true;
            if (resultObject === "INIT$_TB_SYMBOLIC_RULE_VIOLATION") return false;
            return this.nodeWorkContains(node, "SYMBOLIC_REGRESSION_RULE");
        },

        isPredictedTypeNode(node) {
            return ["INIT$_TB_PREDICTED_TYPE", "INIT$_TB_PREDICTED_TYPE_FINAL"].includes(
                String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase()
            );
        },

        matchesNodeWork(node, menuCode, procedureName) {
            const code = String(menuCode || "").toUpperCase();
            const proc = String(procedureName || "").toUpperCase();
            const payload = this.normalizeObject(node?.PAYLOAD);
            const params = this.normalizeObject(node?.RUNTIME_PARAMS);
            const directCodes = [
                node?.REF_MENU_CODE,
                node?.NODE_TYPE,
                node?.JOB_GROUP,
                payload.refMenuCode,
                payload.menuCode,
                payload.jobGroup,
                payload.JOB_GROUP
            ].map((value) => String(value || "").toUpperCase());
            if (directCodes.includes(code)) return true;
            const haystack = [
                node?.EXEC_OBJECT_NAME,
                node?.EXEC_OBJECT_LABEL,
                node?.JOB_NAME,
                node?.NODE_NAME,
                payload.execObjectName,
                payload.execObjectLabel,
                payload.EXEC_OBJECT_NAME,
                payload.EXEC_OBJECT_LABEL,
                params.execObjectName,
                params.EXEC_OBJECT_NAME
            ].map((value) => String(value || "").toUpperCase()).join(" ");
            return Boolean(proc && haystack.includes(proc));
        },

        nodeWorkContains(node, needle) {
            const text = String(needle || "").trim().toUpperCase();
            if (!text) return false;
            return this.getNodeWorkHaystack(node).includes(text);
        },

        getNodeWorkHaystack(node) {
            const payload = this.normalizeObject(node?.PAYLOAD);
            const params = this.normalizeObject(node?.RUNTIME_PARAMS);
            return [
                node?.EXEC_OBJECT_NAME,
                node?.EXEC_OBJECT_LABEL,
                node?.RESULT_OBJECT_NAME,
                node?.JOB_NAME,
                node?.NODE_NAME,
                payload.execObjectName,
                payload.execObjectLabel,
                payload.EXEC_OBJECT_NAME,
                payload.EXEC_OBJECT_LABEL,
                payload.resultTableName,
                payload.RESULT_TABLE_NAME,
                params.execObjectName,
                params.EXEC_OBJECT_NAME,
                params.resultTableName,
                params.RESULT_TABLE_NAME
            ].map((value) => String(value || "").toUpperCase()).join(" ");
        },

        escapeHtml(value) {
            return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        },

        escapeJs(value) {
            return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n");
        }
    };

        window[PAGE_CODE] = page;
        return page;
    };

    window.MCOMMON.initAnlyWorkPage = function(pageCode, config = {}) {
        const defaults = DEFAULT_ANLY_WORK_CONFIGS[pageCode] || {};
        if (window[pageCode] && typeof window[pageCode].init === "function") {
            return window[pageCode];
        }
        return window.MCOMMON.createAnlyWorkPage({ ...defaults, ...config, pageCode });
    };
})();
