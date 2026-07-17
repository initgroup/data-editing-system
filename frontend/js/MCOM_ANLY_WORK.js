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
        const escapeHtmlText = (value) => String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        const getLabel = (key, fallback = "") => {
            const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
            const labels = pack && typeof pack.labels === "object" && !Array.isArray(pack.labels) ? pack.labels : {};
            return Object.prototype.hasOwnProperty.call(labels, key) ? String(labels[key] ?? "") : fallback;
        };
        const getMessage = (key, fallback = "", values = {}) => {
            const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
            const messages = pack && typeof pack.messages === "object" && !Array.isArray(pack.messages) ? pack.messages : {};
            let text = Object.prototype.hasOwnProperty.call(messages, key) ? String(messages[key] ?? "") : fallback;
            Object.entries(values || {}).forEach(([name, value]) => {
                text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value ?? ""));
            });
            return text;
        };
        const getText = (fallback = "", values = {}) => getMessage(fallback, fallback, values);
        const emptyState = (key, fallback) => `<div class="table-empty">${escapeHtmlText(getLabel(key, fallback))}</div>`;
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
        "INIT$_TB_RELATION_PAIR": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_RELATION_PAIR",
            title: "Result Table",
            summaryKey: "relationSummary",
            summaryRenderer: "renderRelationSummary"
        }),
        "INIT$_TB_RELATION_NETWORK_NODE": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_RELATION_NETWORK_NODE",
            title: "Result Table",
            summaryKey: "relationNetworkSummary",
            summaryRenderer: "renderRelationNetworkSummary"
        }),
        "INIT$_TB_RELATION_NETWORK_EDGE": Object.freeze({
            kind: "TABLE",
            key: "TABLE:INIT$_TB_RELATION_NETWORK_EDGE",
            title: "Result Table",
            summaryKey: "relationNetworkSummary",
            summaryRenderer: "renderRelationNetworkSummary"
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
    const SYMBOLIC_CHART_MODES = Object.freeze({
        ACTUAL_PREDICTED: "ACTUAL_PREDICTED",
        RESIDUAL: "RESIDUAL",
        FEATURE_RESPONSE: "FEATURE_RESPONSE",
        SENSITIVITY: "SENSITIVITY"
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
        correlationSummaryFilter: { kind: "ALL", colA: "", colB: "" },
        relationSummaryFilter: "ALL",
        relationPairFilter: { colA: "", colB: "" },
        relationNetworkClusterFilter: "ALL",
        relationNetworkPairFilter: { clusterId: "", colA: "", colB: "" },
        relationNetworkGraphClusterIds: [],
        relationNetworkGraphVisibleClusters: null,
        lassoSummaryFilter: { direction: "ALL", targetColumn: "" },
        lassoPairFilter: { targetColumn: "", featureName: "" },
        predictedTypeFilter: "ALL",
        predictedTypeViewMode: "TYPE",
        ruleSummaryFilters: { conditionCount: "ALL", confidenceScope: "ALL", resultColumn: "ALL", conditionColumn: "ALL", resultHasValueYn: "ALL", page: 1, pageSize: 20, resultColumnPage: 1 },
        violationRuleFilters: { ruleId: "", conditionCount: "ALL", confidenceScope: "NON_PERFECT", resultScope: "HIT", page: 1, pageSize: 20 },
        symbolicRuleFilters: { method: "ALL", targetColumn: "ALL" },
        symbolicViolationFilters: { method: "ALL", targetColumn: "ALL", resultScope: "ALL" },
        violationSql: { sql: "", page: 1, pageSize: 50, freezeColumns: 2, total: 0, columns: [], rows: [], title: "", columnWidths: {} },
        violationSqlRequestId: 0,
        currentModelDetail: null,
        lastResultTableJson: null,
        lastViolationSummary: null,
        lastSymbolicRuleSummary: null,
        lastSymbolicViolationSummary: null,
        lastRelationNetworkSummary: null,
        symbolicRuleChart: null,
        symbolicRuleChartState: null,
        symbolicRuleSampleRequestId: 0,
        pendingRunId: "",
        isRunDeleteInProgress: false,
        currentExport: { filename: "integrated-result.csv", columns: [], rows: [] },
        nodeResultCache: new Map(),
        selectedResultObjectNames: new Map(),
        runtimeParamPresetMap: new Map(),

        async init() {
            this.loadSelectedResultObjectNames();
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
            this.lastRelationNetworkSummary = null;
            this.readableRuleConditionFilter = "ALL";
            this.readableRuleConfidenceFilter = "ALL";
            this.correlationSummaryFilter = { kind: "ALL", colA: "", colB: "" };
            this.relationSummaryFilter = "ALL";
            this.relationPairFilter = { colA: "", colB: "" };
            this.relationNetworkClusterFilter = "ALL";
            this.relationNetworkPairFilter = { clusterId: "", colA: "", colB: "" };
            this.lassoSummaryFilter = { direction: "ALL", targetColumn: "" };
            this.lassoPairFilter = { targetColumn: "", featureName: "" };
            this.predictedTypeFilter = "ALL";
            this.predictedTypeViewMode = "TYPE";
            this.violationRuleFilters = { ruleId: "", conditionCount: "ALL", confidenceScope: "NON_PERFECT", resultScope: "HIT", page: 1, pageSize: 20 };
            this.symbolicRuleFilters = { method: "ALL", targetColumn: "ALL" };
            this.symbolicViolationFilters = { method: "ALL", targetColumn: "ALL", resultScope: "ALL" };
            this.closeViolationSqlPopup();
            this.closeSymbolicRulePopup();
            this.closeRelationNetworkPopup();
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

        loadSelectedResultObjectNames() {
            try {
                const saved = JSON.parse(sessionStorage.getItem(`${PAGE_CODE}:selectedResultObjects`) || "{}");
                this.selectedResultObjectNames = new Map(Object.entries(saved || {}));
            } catch (error) {
                this.selectedResultObjectNames = new Map();
            }
        },

        persistSelectedResultObjectNames() {
            try {
                const entries = Array.from(this.selectedResultObjectNames?.entries?.() || []).slice(-200);
                this.selectedResultObjectNames = new Map(entries);
                sessionStorage.setItem(`${PAGE_CODE}:selectedResultObjects`, JSON.stringify(Object.fromEntries(entries)));
            } catch (error) {
                console.warn(`[${PAGE_CODE}] selected result output save failed`, error);
            }
        },

        rememberSelectedNodeResult(node = this.selectedNode) {
            const key = this.getNodeCacheKey(node?.FLOW_NODE_RUN_ID);
            const objectName = String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            if (!key || !objectName) return;
            if (!this.selectedResultObjectNames) this.selectedResultObjectNames = new Map();
            this.selectedResultObjectNames.set(key, objectName);
            this.persistSelectedResultObjectNames();
        },

        applyRememberedNodeResult(node) {
            const key = this.getNodeCacheKey(node?.FLOW_NODE_RUN_ID);
            const objectName = String(this.selectedResultObjectNames?.get(key) || "").trim().toUpperCase();
            const results = Array.isArray(node?.RESULT_OBJECTS) ? node.RESULT_OBJECTS : [];
            let selected = results.find((item) => String(item?.objectName || "").trim().toUpperCase() === objectName);
            if (!selected) return false;
            if (this.isIntegratedRuleDiscoveryNode(node)
                && this.getIntegratedRuleDiscoveryGroup(selected) === "CATEGORICAL") {
                selected = this.getPreferredIntegratedRuleResult(
                    "CATEGORICAL",
                    results.filter((item) => this.getIntegratedRuleDiscoveryGroup(item) === "CATEGORICAL")
                ) || selected;
            }
            node.RESULT_KIND = String(selected.kind || "TABLE").toUpperCase();
            node.RESULT_OWNER = String(selected.owner || node.RESULT_OWNER || "").toUpperCase();
            node.RESULT_OBJECT_NAME = String(selected.objectName || "").toUpperCase();
            if (node.RESULT_OBJECT_NAME !== objectName) this.rememberSelectedNodeResult(node);
            return true;
        },

        applyDefaultNodeResult(node) {
            const results = Array.isArray(node?.RESULT_OBJECTS) ? node.RESULT_OBJECTS : [];
            const runProfile = results.find((item) => (
                String(item?.artifact || "").trim().toUpperCase() === "PREDICTED_TYPE_RUN"
                || String(item?.objectName || "").trim().toUpperCase() === "INIT$_TB_PREDICTED_TYPE"
            ));
            const hasFinalProfile = results.some((item) => (
                String(item?.artifact || "").trim().toUpperCase() === "PREDICTED_TYPE_FINAL"
                || String(item?.objectName || "").trim().toUpperCase() === "INIT$_TB_PREDICTED_TYPE_FINAL"
            ));
            const relationMatrix = results.find((item) => (
                String(item?.artifact || "").trim().toUpperCase() === "RELATION_PAIR"
                || String(item?.objectName || "").trim().toUpperCase() === "INIT$_TB_RELATION_PAIR"
            ));
            const integratedRelationArtifacts = new Set(results.map((item) => String(item?.artifact || "").trim().toUpperCase()));
            const integratedRelationObjects = new Set(results.map((item) => String(item?.objectName || "").trim().toUpperCase()));
            const hasIntegratedRelationResults = (
                (integratedRelationArtifacts.has("RELATION_PAIR") || integratedRelationObjects.has("INIT$_TB_RELATION_PAIR"))
                && (integratedRelationArtifacts.has("CAT_CORR_PAIR") || integratedRelationObjects.has("INIT$_TB_CAT_CORR_PAIR"))
                && (integratedRelationArtifacts.has("NUM_CORR_PAIR") || integratedRelationObjects.has("INIT$_TB_NUM_CORR_PAIR"))
            );
            const integratedCategoricalRule = this.isIntegratedRuleDiscoveryNode(node)
                ? this.getPreferredIntegratedRuleResult(
                    "CATEGORICAL",
                    results.filter((item) => this.getIntegratedRuleDiscoveryGroup(item) === "CATEGORICAL")
                )
                : null;
            const selected = runProfile && hasFinalProfile
                ? runProfile
                : (relationMatrix && hasIntegratedRelationResults ? relationMatrix : integratedCategoricalRule);
            if (!selected) return false;
            node.RESULT_KIND = String(selected.kind || "TABLE").toUpperCase();
            node.RESULT_OWNER = String(selected.owner || node.RESULT_OWNER || "").toUpperCase();
            node.RESULT_OBJECT_NAME = String(selected.objectName || "").toUpperCase();
            return true;
        },

        clearSelectedNodeResults(nodes = []) {
            if (!this.selectedResultObjectNames?.size) return;
            (nodes || []).forEach((node) => {
                const key = this.getNodeCacheKey(node?.FLOW_NODE_RUN_ID);
                if (key) this.selectedResultObjectNames.delete(key);
            });
            this.persistSelectedResultObjectNames();
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
                correlationSummaryFilter: this.cloneCacheValue(this.correlationSummaryFilter),
                relationSummaryFilter: this.relationSummaryFilter,
                relationPairFilter: this.cloneCacheValue(this.relationPairFilter),
                relationNetworkClusterFilter: this.relationNetworkClusterFilter,
                relationNetworkPairFilter: this.cloneCacheValue(this.relationNetworkPairFilter),
                lassoSummaryFilter: this.cloneCacheValue(this.lassoSummaryFilter),
                lassoPairFilter: this.cloneCacheValue(this.lassoPairFilter),
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
                lastRelationNetworkSummary: this.cloneCacheValue(this.lastRelationNetworkSummary),
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
            this.correlationSummaryFilter = cached.correlationSummaryFilter || { kind: "ALL", colA: "", colB: "" };
            this.relationSummaryFilter = cached.relationSummaryFilter || "ALL";
            this.relationPairFilter = cached.relationPairFilter || { colA: "", colB: "" };
            this.relationNetworkClusterFilter = cached.relationNetworkClusterFilter || "ALL";
            this.relationNetworkPairFilter = cached.relationNetworkPairFilter || { clusterId: "", colA: "", colB: "" };
            this.lassoSummaryFilter = cached.lassoSummaryFilter || { direction: "ALL", targetColumn: "" };
            this.lassoPairFilter = cached.lassoPairFilter || { targetColumn: "", featureName: "" };
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
            this.lastRelationNetworkSummary = this.cloneCacheValue(cached.lastRelationNetworkSummary);
            this.currentExport = this.cloneCacheValue(cached.currentExport) || { filename: "integrated-result.csv", columns: [], rows: [] };
            panel.classList.remove("is-loading");
            panel.innerHTML = cached.html || emptyState("selectNodeForResult", "Select a node to view result details.");
            this.prependNodeResultSwitcher();
            this.renderNodes();
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
                if (panel) panel.innerHTML = emptyState("selectProjectForRuns", "Select a project to view run history.");
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
                const responseTotal = Number(json.total || 0);
                const rowTotal = Number(this.runs[0]?.TOTAL_COUNT || 0);
                this.runTotal = Math.max(responseTotal, rowTotal);
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
                    if (nodeList) nodeList.innerHTML = emptyState("noRunHistory", "No run history.");
                    if (resultPanel) resultPanel.innerHTML = emptyState("selectRunForResult", "Select a run history to view result details.");
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
            if (select) select.innerHTML = `<option value="">${escapeHtmlText(getLabel("loadingProjects", "Loading projects..."))}</option>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?keyword=`, { method: "GET", showLoading: false });
                this.projects = Array.isArray(json.data) ? json.data : [];
                if (select) {
                    select.innerHTML = `
                        <option value="">${escapeHtmlText(getLabel("selectProject", "-- Select project --"))}</option>
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
            if (select) select.innerHTML = `<option value="">${escapeHtmlText(getLabel("all", "ALL"))}</option>`;
            if (!projectId) return;
            const params = new URLSearchParams({ projectId, keyword: "" });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/scenarios?${params.toString()}`, { method: "GET", showLoading: false });
                this.scenarios = Array.isArray(json.data) ? json.data : [];
                if (select) {
                    select.innerHTML = `
                        <option value="">${escapeHtmlText(getLabel("all", "ALL"))}</option>
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
            if (count) count.textContent = getLabel("rowCount", "{count} rows").replace("{count}", this.formatNumber(this.runTotal));
            if (pageText) pageText.textContent = `${this.runPage} / ${totalPages}`;
            if (!list) return;
            if (!this.runs.length) {
                list.innerHTML = emptyState("noRunHistory", "No run history.");
                return;
            }
            list.innerHTML = this.runs.map((run) => `
                <button type="button" class="anly-work-run-card ${this.selectedRun?.FLOW_RUN_ID === run.FLOW_RUN_ID ? "is-selected" : ""}" onclick="${PAGE_CODE}.selectRun(${Number(run.FLOW_RUN_ID)})">
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
            this.lastResultTableJson = null;
            this.lastViolationSummary = null;
            this.lastSymbolicRuleSummary = null;
            this.lastSymbolicViolationSummary = null;
            this.lastRelationNetworkSummary = null;
            this.currentExport = { filename: "integrated-result.csv", columns: [], rows: [] };
            this.nodeResultCache = new Map();
            this.nodes = [];
            this.renderRuns();
            this.renderRunSummary();
            const nodeList = getContainerEl("#nodeList-${PAGE_CODE}");
            const resultPanel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (nodeList) nodeList.innerHTML = `<div class="table-empty">Loading nodes...</div>`;
            if (resultPanel) resultPanel.innerHTML = emptyState("selectNodeForResult", "Select a node to view result details.");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/runs/${flowRunId}/nodes`, { method: "GET", showLoading: false });
                this.nodes = Array.isArray(json.data) ? json.data : [];
                this.clearSelectedNodeResults(this.nodes);
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
                el.innerHTML = emptyState("selectRunHistory", "Select a run history.");
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
                    <button type="button" class="anly-work-run-delete-btn" title="${this.escapeHtml(getLabel("deleteSelectedRunTitle", "Delete selected run history"))}" onclick="${PAGE_CODE}.deleteSelectedRun()">
                        <i class="far fa-trash-alt"></i>
                        <span>${this.escapeHtml(getLabel("delete", "Delete"))}</span>
                    </button>
                </article>
                <article><span>Nodes</span><strong>${this.formatNumber(run.NODE_COUNT)}</strong><small>${this.formatNumber(run.SUCCESS_NODE_COUNT)} success / ${this.formatNumber(run.FAILED_NODE_COUNT)} failed</small></article>
                <article>
                    <span>Started</span>
                    <strong>${this.escapeHtml(this.formatDateTime(run.STARTED_AT))}</strong>
                    <span class="anly-work-summary-message">
                        <small title="${this.escapeHtml(runMessage)}">${this.escapeHtml(runMessage || "-")}</small>
                        ${runMessage ? `
                            <button type="button" class="anly-work-summary-copy" title="${this.escapeHtml(getLabel("copyMessageTitle", "Copy message"))}" onclick="${PAGE_CODE}.copyRunMessage(event)" hidden>
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
                getText("Run #{runId} history, node history, and RUN ID based analysis result history will be deleted.", { runId: flowRunId }),
                getText("This action cannot be undone. Continue?")
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
                    getText("Administrators can force delete running or pending histories."),
                    getText("Do you still want to delete it?")
                ].join("\n");
                const forceConfirmed = window.CommonMessage?.confirm
                    ? await window.CommonMessage.confirm(forceMessage, {
                        defaultAction: "cancel",
                        okText: getText("Force delete"),
                        cancelText: getText("Cancel")
                    })
                    : window.confirm(forceMessage);
                if (!forceConfirmed) return;
                forceDelete = true;
            }

            this.isRunDeleteInProgress = true;
            const buttons = getContainerEl("#runSummary-${PAGE_CODE}")?.querySelectorAll(".anly-work-run-delete-btn") || [];
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
                if (nodeList) nodeList.innerHTML = `<div class="table-empty">${this.escapeHtml(getText("Run history has been deleted."))}</div>`;
                if (resultPanel) resultPanel.innerHTML = `<div class="table-empty">${this.escapeHtml(getText("Run history has been deleted."))}</div>`;
                window.CommonMessage?.success?.(json.message || getText("Run #{runId} history has been deleted.", { runId: flowRunId }), { copyable: false });
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
                getContainerEl("#runSummary-${PAGE_CODE}")?.querySelectorAll(".anly-work-run-delete-btn").forEach((button) => {
                    button.removeAttribute("disabled");
                });
            }
        },

        updateRunSummaryCopyVisibility() {
            const box = getContainerEl(".anly-work-summary-message");
            if (!box) return;
            const textEl = box.querySelector("small");
            const copyBtn = box.querySelector(".anly-work-summary-copy");
            if (!textEl || !copyBtn) return;
            copyBtn.hidden = !(textEl.scrollWidth > textEl.clientWidth + 1);
        },

        renderNodes() {
            const el = getContainerEl("#nodeList-${PAGE_CODE}");
            if (!el) return;
            if (!this.nodes.length) {
                el.innerHTML = emptyState("noNodeResults", "No node execution results.");
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
                <section class="anly-work-node-group">
                    <header class="anly-work-node-group-header">
                        <strong>${this.escapeHtml(group.label)}</strong>
                        <small>${this.formatNumber(entries.length)} nodes</small>
                    </header>
                    ${entries.length
                        ? entries.map(({ node, index }) => this.renderNodeCard(node, index)).join("")
                        : `<div class="anly-work-node-group-empty">-</div>`}
                </section>
            `;
            el.innerHTML = [
                ...groupDefs.map((group) => renderGroup(group, grouped.get(group.code) || [])),
                ...(extras.length ? [renderGroup({ code: "OTHER", label: "OTHER" }, extras)] : [])
            ].join("");
        },

        renderNodeCard(node, index = 0) {
            return `
                <button type="button" class="anly-work-node-card ${this.getNodeTone(node)} ${this.selectedNode?.FLOW_NODE_RUN_ID === node.FLOW_NODE_RUN_ID ? "is-selected" : ""}" onclick="${PAGE_CODE}.selectNode(${Number(node.FLOW_NODE_RUN_ID)})">
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
            const restoredResult = this.applyRememberedNodeResult(this.selectedNode);
            if (!restoredResult) this.applyDefaultNodeResult(this.selectedNode);
            this.resultPage = Math.max(1, Number(page || 1));
            this.renderNodes();
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel || !this.selectedNode) return;
            if (!options.forceRefresh && this.restoreNodeResultCache(nodeRunId)) return;
            this.currentModelDetail = null;
            this.readableRuleConditionFilter = "ALL";
            this.readableRuleConfidenceFilter = "ALL";
            this.correlationSummaryFilter = { kind: "ALL", colA: "", colB: "" };
            this.relationSummaryFilter = "ALL";
            this.relationPairFilter = { colA: "", colB: "" };
            this.relationNetworkClusterFilter = "ALL";
            this.relationNetworkPairFilter = { clusterId: "", colA: "", colB: "" };
            this.lassoSummaryFilter = { direction: "ALL", targetColumn: "" };
            this.lassoPairFilter = { targetColumn: "", featureName: "" };
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
                panel.innerHTML = `<div class="table-empty">${this.escapeHtml(getText("This node has no saved result table or model."))}</div>`;
                this.snapshotNodeResultCache();
                return;
            }
            panel.innerHTML = `<div class="table-empty">Loading result...</div>`;
            if (resultLayout.kind === "MODEL") {
                await this.loadModelDetailSummary();
            } else {
                await this.loadResultTable(this.resultPage);
            }
            this.prependNodeResultSwitcher();
            this.snapshotNodeResultCache();
        },

        getSelectedNodeResultObjects() {
            return Array.isArray(this.selectedNode?.RESULT_OBJECTS) ? this.selectedNode.RESULT_OBJECTS : [];
        },

        getNodeResultObject(node, objectName = "") {
            const normalizedObjectName = String(objectName || "").trim().toUpperCase();
            if (!normalizedObjectName) return null;
            return (Array.isArray(node?.RESULT_OBJECTS) ? node.RESULT_OBJECTS : []).find(
                (item) => String(item?.objectName || "").trim().toUpperCase() === normalizedObjectName
            ) || null;
        },

        async activateNodeResultObject(node, objectName, options = {}) {
            const selected = this.getNodeResultObject(node, objectName);
            if (!selected) return false;
            const selectedNodeRunId = Number(this.selectedNode?.FLOW_NODE_RUN_ID || 0);
            const targetNodeRunId = Number(node?.FLOW_NODE_RUN_ID || 0);
            const normalizedObjectName = String(selected.objectName || "").trim().toUpperCase();
            if (selectedNodeRunId !== targetNodeRunId) {
                const key = this.getNodeCacheKey(targetNodeRunId);
                if (key) {
                    if (!this.selectedResultObjectNames) this.selectedResultObjectNames = new Map();
                    this.selectedResultObjectNames.set(key, normalizedObjectName);
                    this.persistSelectedResultObjectNames();
                }
                await this.selectNode(targetNodeRunId, 1, options);
                return true;
            }
            if (String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase() === normalizedObjectName) return false;
            await this.selectNodeResultObject(selected);
            return true;
        },

        isRelationNetworkResultObject(item = {}) {
            return ["INIT$_TB_RELATION_NETWORK_EDGE", "INIT$_TB_RELATION_NETWORK_NODE"].includes(
                String(item?.objectName || "").trim().toUpperCase()
            );
        },

        getRelationNetworkResultObjects() {
            return this.getSelectedNodeResultObjects().filter((item) => this.isRelationNetworkResultObject(item));
        },

        getIntegratedRuleDiscoveryGroup(item = {}) {
            const artifact = String(item?.artifact || "").trim().toUpperCase();
            const objectName = String(item?.objectName || "").trim().toUpperCase();
            if (["ASSOCIATION_MODEL", "ASSOC_RULE_SUMMARY"].includes(artifact)
                || objectName === "INIT$_TB_ASSOC_RULE_SUMMARY") {
                return "CATEGORICAL";
            }
            if (["LASSO_FEATURE", "SYMBOLIC_RULE"].includes(artifact)
                || ["INIT$_TB_LASSO_FEATURE", "INIT$_TB_SYMBOLIC_RULE"].includes(objectName)) {
                return "CONTINUOUS";
            }
            return "";
        },

        isIntegratedRuleDiscoveryNode(node = this.selectedNode) {
            if (this.nodeWorkContains(node, "INTEGRATED_RULE_DISCOVER")) return true;
            const groups = new Set((Array.isArray(node?.RESULT_OBJECTS) ? node.RESULT_OBJECTS : [])
                .map((item) => this.getIntegratedRuleDiscoveryGroup(item))
                .filter(Boolean));
            return groups.has("CATEGORICAL") && groups.has("CONTINUOUS");
        },

        getIntegratedRuleDiscoveryResults(group = "") {
            const normalizedGroup = String(group || "").trim().toUpperCase();
            if (!normalizedGroup || !this.isIntegratedRuleDiscoveryNode()) return [];
            return this.getSelectedNodeResultObjects().filter(
                (item) => this.getIntegratedRuleDiscoveryGroup(item) === normalizedGroup
            );
        },

        getPreferredIntegratedRuleResult(group = "", results = []) {
            const normalizedGroup = String(group || "").trim().toUpperCase();
            const preferredArtifact = normalizedGroup === "CATEGORICAL" ? "ASSOCIATION_MODEL" : "SYMBOLIC_RULE";
            return results.find((item) => String(item?.artifact || "").trim().toUpperCase() === preferredArtifact)
                || (normalizedGroup === "CATEGORICAL"
                    ? results.find((item) => String(item?.kind || "").trim().toUpperCase() === "MODEL")
                    : null)
                || results[results.length - 1]
                || null;
        },

        getNodeResultSwitcherItems() {
            const results = this.getSelectedNodeResultObjects();
            if (this.isIntegratedRuleDiscoveryNode()) {
                const activeName = String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
                const activeResult = results.find((item) => String(item?.objectName || "").trim().toUpperCase() === activeName);
                const activeGroup = this.getIntegratedRuleDiscoveryGroup(activeResult);
                const insertedGroups = new Set();
                return results.reduce((items, item) => {
                    const group = this.getIntegratedRuleDiscoveryGroup(item);
                    if (!group) {
                        items.push(item);
                        return items;
                    }
                    if (insertedGroups.has(group)) return items;
                    const groupResults = results.filter((candidate) => this.getIntegratedRuleDiscoveryGroup(candidate) === group);
                    const representative = group === "CATEGORICAL"
                        ? this.getPreferredIntegratedRuleResult(group, groupResults)
                        : (activeGroup === group
                            ? activeResult
                            : this.getPreferredIntegratedRuleResult(group, groupResults));
                    items.push({ ...(representative || item), integratedRuleGroup: group });
                    insertedGroups.add(group);
                    return items;
                }, []);
            }
            const networkResults = this.getRelationNetworkResultObjects();
            if (networkResults.length < 2) return results;

            const activeName = String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            const activeNetworkResult = networkResults.find((item) => String(item?.objectName || "").trim().toUpperCase() === activeName);
            const integratedNetworkResult = {
                ...(activeNetworkResult || networkResults.find((item) =>
                    String(item?.objectName || "").trim().toUpperCase() === "INIT$_TB_RELATION_NETWORK_NODE"
                ) || networkResults[0]),
                integratedNetwork: true
            };
            let inserted = false;
            return results.reduce((items, item) => {
                if (!this.isRelationNetworkResultObject(item)) {
                    items.push(item);
                } else if (!inserted) {
                    items.push(integratedNetworkResult);
                    inserted = true;
                }
                return items;
            }, []);
        },

        getNodeResultLabel(item = {}) {
            if (item.integratedNetwork) return getText("Relation network");
            if (item.integratedRuleGroup === "CATEGORICAL") return getText("Categorical automatic rules");
            if (item.integratedRuleGroup === "CONTINUOUS") return getText("Continuous automatic rules");
            const objectName = String(item.objectName || "").trim().toUpperCase();
            const objectLabels = {
                "INIT$_TB_RELATION_NETWORK_EDGE": "Relation network edges",
                "INIT$_TB_RELATION_NETWORK_NODE": "Relation network nodes"
            };
            return getText(objectLabels[objectName] || item.label || item.artifact || objectName);
        },

        restoreResultScrollAfterRender(restoreScroll) {
            if (typeof restoreScroll !== "function") return;
            restoreScroll();
            requestAnimationFrame(() => {
                restoreScroll();
                requestAnimationFrame(restoreScroll);
            });
        },

        prependNodeResultSwitcher() {
            const panel = getContainerEl(`#resultPanel-${PAGE_CODE}`);
            const results = this.getNodeResultSwitcherItems();
            if (!panel) return;
            const activeName = String(this.selectedNode?.RESULT_OBJECT_NAME || "").toUpperCase();
            if (results.length > 1 && !panel.querySelector(".anly-work-result-switcher")) {
                const activeResult = this.getSelectedNodeResultObjects().find(
                    (item) => String(item?.objectName || "").trim().toUpperCase() === activeName
                );
                const activeRuleGroup = this.getIntegratedRuleDiscoveryGroup(activeResult);
                panel.insertAdjacentHTML("afterbegin", `
                    <nav class="anly-work-result-switcher" aria-label="${this.escapeHtml(getText("Integrated result outputs"))}">
                        <strong>${this.escapeHtml(getText("Integrated Results"))}</strong>
                        <div>
                            ${results.map((item, index) => {
                                const name = String(item.objectName || "").toUpperCase();
                                const label = this.getNodeResultLabel(item);
                                const active = item.integratedNetwork
                                    ? this.isRelationNetworkResultObject({ objectName: activeName })
                                    : (item.integratedRuleGroup
                                        ? item.integratedRuleGroup === activeRuleGroup
                                        : name === activeName);
                                const icon = item.integratedRuleGroup === "CATEGORICAL"
                                    ? "fa-tags"
                                    : (item.integratedRuleGroup === "CONTINUOUS"
                                        ? "fa-wave-square"
                                        : (String(item.kind).toUpperCase() === "MODEL" ? "fa-brain" : "fa-table"));
                                return `<button type="button" class="${active ? "is-active" : ""}" onclick="${PAGE_CODE}.selectNodeResult(${index})">
                                    <i class="fas ${icon}"></i>
                                    <span>${this.escapeHtml(label)}</span>
                                </button>`;
                            }).join("")}
                        </div>
                    </nav>
                `);
            }
            this.prependIntegratedRuleDetailSwitcher(panel);
        },

        prependIntegratedRuleDetailSwitcher(panel = getContainerEl(`#resultPanel-${PAGE_CODE}`)) {
            if (!panel || panel.querySelector(".anly-work-result-detail-switcher") || !this.isIntegratedRuleDiscoveryNode()) return;
            const activeName = String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            const activeResult = this.getSelectedNodeResultObjects().find(
                (item) => String(item?.objectName || "").trim().toUpperCase() === activeName
            );
            const activeGroup = this.getIntegratedRuleDiscoveryGroup(activeResult);
            const groupResults = this.getIntegratedRuleDiscoveryResults(activeGroup);
            if (activeGroup === "CATEGORICAL") return;
            if (!activeGroup || groupResults.length <= 1) return;
            const html = `
                <nav class="anly-work-result-detail-switcher" aria-label="${this.escapeHtml(getText("Automatic rule details"))}">
                    <strong>${this.escapeHtml(getText("Automatic rule details"))}</strong>
                    <div>
                        ${groupResults.map((item) => {
                            const objectName = String(item?.objectName || "").trim().toUpperCase();
                            return `<button type="button" class="${objectName === activeName ? "is-active" : ""}" onclick="${PAGE_CODE}.selectIntegratedRuleDetail('${this.escapeJs(objectName)}')">
                                <i class="fas ${String(item.kind).toUpperCase() === "MODEL" ? "fa-brain" : "fa-table"}"></i>
                                <span>${this.escapeHtml(this.getNodeResultLabel(item))}</span>
                            </button>`;
                        }).join("")}
                    </div>
                </nav>
            `;
            const resultSwitcher = panel.querySelector(".anly-work-result-switcher");
            if (resultSwitcher) resultSwitcher.insertAdjacentHTML("afterend", html);
            else panel.insertAdjacentHTML("afterbegin", html);
        },

        async selectNodeResult(index) {
            const results = this.getNodeResultSwitcherItems();
            const selected = results[Number(index)];
            if (!selected || !this.selectedNode) return;
            const activeName = String(this.selectedNode.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            let resolved = selected;
            if (selected.integratedNetwork) {
                resolved = this.getRelationNetworkResultObjects().find((item) => String(item?.objectName || "").trim().toUpperCase() === activeName)
                    || this.getRelationNetworkResultObjects().find((item) => String(item?.objectName || "").trim().toUpperCase() === "INIT$_TB_RELATION_NETWORK_NODE")
                    || selected;
            } else if (selected.integratedRuleGroup) {
                const groupResults = this.getIntegratedRuleDiscoveryResults(selected.integratedRuleGroup);
                resolved = selected.integratedRuleGroup === "CATEGORICAL"
                    ? (this.getPreferredIntegratedRuleResult(selected.integratedRuleGroup, groupResults) || selected)
                    : (groupResults.find((item) => String(item?.objectName || "").trim().toUpperCase() === activeName)
                        || this.getPreferredIntegratedRuleResult(selected.integratedRuleGroup, groupResults)
                        || selected);
            }
            await this.selectNodeResultObject(resolved);
        },

        async selectNodeResultObject(selected) {
            if (!selected || !this.selectedNode) return;
            this.selectedNode.RESULT_KIND = String(selected.kind || "TABLE").toUpperCase();
            this.selectedNode.RESULT_OWNER = String(selected.owner || this.selectedNode.RESULT_OWNER || "").toUpperCase();
            this.selectedNode.RESULT_OBJECT_NAME = String(selected.objectName || "").toUpperCase();
            this.rememberSelectedNodeResult();
            this.resultPage = 1;
            this.currentModelDetail = null;
            this.lastResultTableJson = null;
            const restoreScroll = this.preserveResultScroll();
            try {
                if (this.selectedNode.RESULT_KIND === "MODEL") {
                    await this.loadModelDetailSummary();
                } else {
                    await this.loadResultTable(1);
                }
                this.prependNodeResultSwitcher();
                this.snapshotNodeResultCache();
                this.renderNodes();
            } finally {
                this.restoreResultScrollAfterRender(restoreScroll);
            }
        },

        async selectRelationNetworkDetail(objectName = "") {
            const normalizedObjectName = String(objectName || "").trim().toUpperCase();
            const selected = this.getRelationNetworkResultObjects().find(
                (item) => String(item?.objectName || "").trim().toUpperCase() === normalizedObjectName
            );
            if (!selected) return;
            if (String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase() === normalizedObjectName) return;
            await this.selectNodeResultObject(selected);
        },

        async selectIntegratedRuleDetail(objectName = "") {
            const selected = this.getNodeResultObject(this.selectedNode, objectName);
            if (!selected || !this.getIntegratedRuleDiscoveryGroup(selected)) return;
            if (String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase()
                === String(selected.objectName || "").trim().toUpperCase()) return;
            await this.selectNodeResultObject(selected);
        },

        async openViolationForRule(ruleId, conditionCount = "ALL") {
            const normalizedRuleId = String(ruleId || "").trim();
            if (!normalizedRuleId) return;
            const violationNode = this.findViolationNode();
            if (!violationNode) {
                alert(getText("No rule violation detection node was found in the current flow."));
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
                resultScope: "CANDIDATE",
                page: 1,
                pageSize: 20
            };
            const activated = await this.activateNodeResultObject(
                violationNode,
                "INIT$_TB_RULE_VIOLATION_RESULT",
                { preserveViolationRuleFilter: true, forceRefresh: true }
            );
            if (activated) return;
            await this.loadResultTable(1);
        },

        findViolationNode() {
            return (this.nodes || []).find((node) =>
                this.isRuleViolationNode(node) || this.getNodeResultObject(node, "INIT$_TB_RULE_VIOLATION_RESULT")
            ) || null;
        },

        async openSymbolicViolationForRule(ruleId) {
            const normalizedRuleId = String(ruleId || "").trim();
            if (!normalizedRuleId) return;
            const violationNode = this.findSymbolicViolationNode();
            if (!violationNode) {
                alert(getText("No continuous rule violation detection node was found in the current flow."));
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
            const activated = await this.activateNodeResultObject(
                violationNode,
                "INIT$_TB_SYMBOLIC_RULE_VIOLATION",
                { preserveViolationRuleFilter: true, forceRefresh: true }
            );
            if (activated) return;
            await this.loadResultTable(1);
        },

        findSymbolicViolationNode() {
            return (this.nodes || []).find((node) =>
                this.isSymbolicViolationNode(node) || this.getNodeResultObject(node, "INIT$_TB_SYMBOLIC_RULE_VIOLATION")
            ) || null;
        },

        buildResultTableParams(node = this.selectedNode, page = 1) {
            const ruleModelName = this.getSelectedNodeRuleModelName(node);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                objectName: node.RESULT_OBJECT_NAME,
                menuCode: node.REF_MENU_CODE || "",
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                flowRunId: String(this.selectedRun?.FLOW_RUN_ID || ""),
                page: String(Math.max(1, Number(page || 1))),
                pageSize: String(this.resultPageSize)
            });
            if (ruleModelName) params.set("ruleModelName", ruleModelName);
            if (this.isPredictedTypeNode(node) && this.predictedTypeFilter !== "ALL") {
                params.set("predictedTypeCase", this.predictedTypeFilter);
            }
            if (this.isCorrelationPairNode(node)) {
                const filter = this.correlationSummaryFilter || {};
                if (filter.kind === "PAIR" && filter.colA && filter.colB) {
                    params.set("correlationColA", filter.colA);
                    params.set("correlationColB", filter.colB);
                }
            }
            if (this.isRelationPairNode(node)) {
                const relationFilter = this.getActiveRelationGridFilter();
                if (relationFilter.relationType) {
                    params.set("relationType", relationFilter.relationType);
                }
                if (relationFilter.passYn) {
                    params.set("relationPassYn", relationFilter.passYn);
                }
                if (relationFilter.colA && relationFilter.colB) {
                    params.set("relationColA", relationFilter.colA);
                    params.set("relationColB", relationFilter.colB);
                }
            }
            if (this.isRelationNetworkResultNode(node)) {
                const networkFilter = this.getActiveRelationNetworkGridFilter();
                if (networkFilter.clusterId) {
                    params.set("networkClusterId", networkFilter.clusterId);
                }
                if (networkFilter.colA && networkFilter.colB) {
                    params.set("networkColA", networkFilter.colA);
                    params.set("networkColB", networkFilter.colB);
                }
            }
            if (this.isLassoFeatureNode(node)) {
                const lassoFilter = this.getActiveLassoGridFilter();
                const minR2Score = Number(this.getNodeActualAnalysisParamValue("P_MIN_R2_SCORE", 0.7, node));
                const maxAutoTargets = Number(this.getNodeActualAnalysisParamValue("P_MAX_AUTO_TARGETS", 10, node));
                const effectiveTargetDefault = this.isIntegratedRuleDiscoveryNode(node) ? "(auto)" : "";
                const targetColumn = String(this.getNodeActualAnalysisParamValue("P_TARGET_COLUMN", effectiveTargetDefault, node) || "").trim().toLowerCase();
                if (lassoFilter.direction && lassoFilter.direction !== "ALL") {
                    params.set("lassoDirection", lassoFilter.direction);
                }
                if (lassoFilter.targetColumn) {
                    params.set("lassoTargetColumn", lassoFilter.targetColumn);
                }
                if (lassoFilter.featureName) {
                    params.set("lassoFeatureName", lassoFilter.featureName);
                }
                params.set("lassoMinR2Score", String(Number.isFinite(minR2Score) ? minR2Score : 0.7));
                params.set("lassoMaxAutoTargets", String(Number.isFinite(maxAutoTargets) ? Math.max(1, Math.trunc(maxAutoTargets)) : 10));
                params.set("lassoAutoTargetYn", targetColumn === "(auto)" ? "Y" : "N");
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
            return params;
        },

        async loadResultTable(page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            this.resultPage = Math.max(1, Number(page || 1));
            this.showResultLoading(getText("Loading result table..."));
            const params = this.buildResultTableParams(node, this.resultPage);
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

        async refreshResultGridOnly(page = 1) {
            const node = this.selectedNode;
            const body = getContainerEl(`#tableResultBody-${PAGE_CODE}`);
            if (!node || !body) {
                await this.loadResultTable(page);
                return;
            }
            this.resultPage = Math.max(1, Number(page || 1));
            const restoreScroll = this.preserveResultScroll();
            const previousMinHeight = body.style.minHeight;
            const currentHeight = Math.max(120, body.offsetHeight || 0);
            body.style.minHeight = `${currentHeight}px`;
            body.classList.add("is-loading");
            body.innerHTML = `<div class="table-empty">${this.escapeHtml(getText("Loading result table..."))}</div>`;
            restoreScroll();
            const params = this.buildResultTableParams(node, this.resultPage);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/result-table?${params.toString()}`, { method: "GET", showLoading: false });
                if (this.selectedNode !== node) return;
                const restoreAfterLoad = this.preserveResultScroll();
                this.lastResultTableJson = {
                    ...(this.lastResultTableJson || {}),
                    ...json,
                    correlationSummary: this.lastResultTableJson?.correlationSummary || json.correlationSummary,
                    relationSummary: this.lastResultTableJson?.relationSummary || json.relationSummary,
                    relationNetworkSummary: this.lastResultTableJson?.relationNetworkSummary || json.relationNetworkSummary,
                    predictedTypeSummary: this.lastResultTableJson?.predictedTypeSummary || json.predictedTypeSummary,
                    lassoSummary: this.lastResultTableJson?.lassoSummary || json.lassoSummary,
                    violationSummary: this.lastResultTableJson?.violationSummary || json.violationSummary,
                    symbolicRuleSummary: this.lastResultTableJson?.symbolicRuleSummary || json.symbolicRuleSummary,
                    symbolicViolationSummary: this.lastResultTableJson?.symbolicViolationSummary || json.symbolicViolationSummary
                };
                this.currentExport = { filename: `${node.RESULT_OBJECT_NAME || "result"}.csv`, columns: json.columns || [], rows: json.data || [] };
                this.refreshTableResultSummary({ preserveScroll: true });
                body.classList.remove("is-loading");
                body.innerHTML = this.renderResultTableBody(json);
                restoreAfterLoad();
                requestAnimationFrame(() => {
                    body.style.minHeight = previousMinHeight;
                    restoreAfterLoad();
                });
                this.snapshotNodeResultCache();
            } catch (error) {
                body.classList.remove("is-loading");
                body.style.minHeight = previousMinHeight;
                body.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Result table load failed.")}</div>`;
                restoreScroll();
            }
        },

        async loadModelView(viewType = "VR", page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            this.showResultLoading(getText("Loading {viewType} view...", { viewType }), viewType);
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
            this.showResultLoading(getText("Loading model detail analysis..."));
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
            this.showResultLoading(getText("Loading rule summary..."));
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
                    timeoutMs: CommonUtils.getRuntimeSetting("APP_RULE_SUMMARY_TIMEOUT_MS", 60000, 12000, 300000),
                    timeoutMessage: getText("Rule summary lookup took too long and was stopped.")
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
            panel.querySelectorAll(".anly-work-result-header nav button").forEach((button) => {
                const type = button.textContent?.trim?.().toUpperCase() || "";
                button.classList.toggle("is-active", Boolean(activeType) && type === activeType);
                button.disabled = true;
            });
            panel.querySelector(".anly-work-result-loading-overlay")?.remove();
            const overlay = document.createElement("div");
            overlay.className = "anly-work-result-loading-overlay";
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
                <header class="anly-work-result-header">
                    <div>
                        <span>Oracle ML Model View</span>
                        <strong class="anly-work-result-exec-object">${this.escapeHtml(executionTitle)}</strong>
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
                ${this.renderGrid(json.columns || [], json.data || [], json)}
                ${this.renderResultPager(json.page, json.pageSize, json.total, `${PAGE_CODE}.loadModelView('${viewType}',`)}
            `;
            this.prependNodeResultSwitcher();
            this.snapshotNodeResultCache();
        },

        renderModelAnalysis(json = this.currentModelDetail, activeTab = "readable") {
            const resultLayout = this.getModelResultLayout(this.selectedNode, json);
            const renderer = typeof this[resultLayout.renderer] === "function" ? resultLayout.renderer : "renderAssociationModelAnalysis";
            this[renderer](json, activeTab, resultLayout);
            this.prependNodeResultSwitcher();
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
                <header class="anly-work-result-header">
                    <div>
                        <span>${this.escapeHtml(this.selectedNode?.NODE_NAME || "Oracle ML Model View")}</span>
                        <strong class="anly-work-result-exec-object">${this.escapeHtml(executionTitle)}</strong>
                        <small>Result Model ${this.escapeHtml(modelOwner)}.${this.escapeHtml(modelName)}</small>
                        ${this.renderSelectedNodeJobDesc()}
                    </div>
                    <em>${this.escapeHtml(modelHeaderLabel)}</em>
                    ${this.renderSelectedNodeExecutionMeta()}
                </header>
                <div class="anly-work-model-tabs">
                    <button type="button" class="${readableActive ? "is-active" : ""}" onclick="${PAGE_CODE}.switchModelAnalysisTab('readable')">Readable Rules</button>
                    <button type="button" class="${!readableActive ? "is-active" : ""}" onclick="${PAGE_CODE}.switchModelAnalysisTab('detail')">Detail Views</button>
                </div>
                <div class="anly-work-model-tab-panel ${readableActive ? "is-active" : ""}" data-model-tab="readable">
                    ${this.renderReadableRuleSummary(json)}
                </div>
                <div class="anly-work-model-tab-panel ${!readableActive ? "is-active" : ""}" data-model-tab="detail">
                    ${this.renderModelDetailViews(json)}
                </div>
            `;
        },

        switchModelAnalysisTab(tabName) {
            this.renderModelAnalysis(this.currentModelDetail, tabName);
            this.snapshotNodeResultCache();
        },

        getActiveModelAnalysisTab() {
            const active = getContainerEl("#resultPanel-${PAGE_CODE} .anly-work-model-tabs button.is-active");
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
            this.showResultLoading(getText("Loading {viewType} sample page...", { viewType }));
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
                ? conditionFiltered.filter((rule) => !this.isEmptyRuleText(rule.thenText))
                : conditionFiltered;
            const visibleRuleCount = filtered.length;
            const baseRuleCount = readableRules.length;
            return `
                <div class="anly-work-readable-rule-intro">
                    <div>
                        <strong>${this.escapeHtml(getText("Readable Rule Summary"))}</strong>
                        <span>${this.escapeHtml(getText("Interprets and displays the current {range} sample out of {total} DM$VR rows. Select a condition-count chip to update the rule list below.", { range: this.getViewSampleRange(vr), total: this.formatNumber(vr.total || 0) }))}</span>
                    </div>
                    <div class="anly-work-sample-controls">
                        <label>
                            <input type="checkbox" ${this.excludeEmptyConsequent ? "checked" : ""} onchange="${PAGE_CODE}.toggleExcludeEmptyConsequent(this.checked)">
                            <span>${this.escapeHtml(getText("Exclude missing result"))}</span>
                        </label>
                        ${this.renderSamplePageJump("readableRulePage-${PAGE_CODE}", vr, "${PAGE_CODE}.goReadableRulesPage()", "${PAGE_CODE}.loadReadableRulesPage")}
                    </div>
                </div>
                ${this.renderReadableRuleStats(readableRules, visibleRuleCount, baseRuleCount)}
                <div class="anly-work-readable-rule-grid">
                    ${filtered.length ? filtered.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">${this.escapeHtml(getText("No rule rows to display. Check the original model view in Detail Views."))}</div>`}
                </div>
            `;
        },

        renderModelRuleSummaryDashboard(json, fallbackRules = []) {
            const summary = json?.ruleSummary;
            const loading = Boolean(json?.ruleSummaryLoading);
            const error = json?.ruleSummaryError || "";
            if (loading && !summary) {
                return `
                    <div class="anly-work-readable-rule-intro">
                        <div>
                            <strong>${this.escapeHtml(getText("Readable Rule Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Loading the rule summary table saved during job execution."))}</span>
                        </div>
                    </div>
                    <section class="anly-work-readable-stats"><div class="table-empty">${this.escapeHtml(getText("Loading rule summary..."))}</div></section>
                    ${this.renderFallbackReadableRuleGrid(fallbackRules)}
                `;
            }
            if (!summary || Number(summary.overview?.TOTAL_RULES || 0) <= 0) {
                const message = error || getText("No saved rule summary exists. Run this model job again to create the summary table.");
                return `
                    <div class="anly-work-readable-rule-intro">
                        <div>
                            <strong>${this.escapeHtml(getText("Readable Rule Summary"))}</strong>
                            <span>${this.escapeHtml(message)}</span>
                        </div>
                    </div>
                    ${this.renderFallbackReadableRuleGrid(fallbackRules)}
                `;
            }
            const overview = summary.overview || {};
            const rules = this.buildSummaryRuleCards(summary.rules || [], summary);
            const totalPages = Math.max(1, Math.ceil(Number(summary.total || 0) / Number(summary.pageSize || 12)));
            const conditionColumnFilter = this.ruleSummaryFilters.conditionColumn === "ALL" ? "" : this.ruleSummaryFilters.conditionColumn;
            const conditionItems = [
                {
                    label: getText("All"),
                    value: "ALL",
                    total: overview.TOTAL_RULES,
                    nonPerfect: overview.NON_PERFECT_CONF_RULES
                },
                ...(summary.conditionDist || []).map((bucket) => ({
                    label: Number(bucket.CONDITION_COUNT || 0) > 0 ? getText("{count} conditions", { count: this.formatNumber(bucket.CONDITION_COUNT) }) : getText("Unparsed conditions"),
                    value: String(Number(bucket.CONDITION_COUNT || 0)),
                    total: bucket.RULE_COUNT,
                    nonPerfect: bucket.NON_PERFECT_CONF_RULES
                }))
            ];
            return `
                <div class="anly-work-readable-rule-intro">
                    <div>
                        <strong>${this.escapeHtml(getText("Readable Rule Summary"))}</strong>
                        <span>${this.escapeHtml(getText("{basis} Select a condition count or result column to update the detail rules below.", { basis: this.describeRuleSummaryBasis(overview) }))}</span>
                    </div>
                    <div class="anly-work-sample-controls">
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
                <section class="anly-work-readable-stats">
                    <div class="anly-work-readable-stat-block">
                        <strong>${this.escapeHtml(getText("Rule Summary"))}</strong>
                        <div class="anly-work-readable-stat-metrics">
                            <span><b>${this.formatNumber(overview.TOTAL_RULES)}</b><small>${this.escapeHtml(getText("Total rules"))}</small></span>
                            <span><b>${this.formatNumber(overview.MAPPED_RULES)}</b><small>${this.escapeHtml(getText("Condition/result mapping"))}</small></span>
                            <span><b>${this.formatNumber(overview.MISSING_RESULT_RULES)}</b><small>${this.escapeHtml(getText("Missing result values"))}</small></span>
                            <span><b>${this.formatNumber(summary.total)}</b><small>${this.escapeHtml(getText("Filter results"))}</small></span>
                        </div>
                    </div>
                    <div class="anly-work-readable-condition-dist">
                        <strong>${this.escapeHtml(getText("Condition Count"))}</strong>
                        ${this.renderRuleConditionMatrix(conditionItems, this.ruleSummaryFilters.conditionCount, this.ruleSummaryFilters.confidenceScope || "ALL", "${PAGE_CODE}.selectRuleSummaryCondition")}
                    </div>
                </section>
                <section class="anly-work-rule-facet-panel">
                    <div class="anly-work-rule-facet-block">
                        <header>
                            <strong>${this.escapeHtml(getText("Top 12 Result Columns"))}</strong>
                            <div class="anly-work-rule-facet-actions">
                                ${this.renderResultColumnPager(summary)}
                                <button type="button" class="${this.ruleSummaryFilters.resultColumn === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectRuleSummaryResult('ALL')">${this.escapeHtml(getText("All"))}</button>
                            </div>
                        </header>
                        <div class="anly-work-rule-facet-list is-result-column-grid">
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
                    <div class="anly-work-rule-facet-block is-condition">
                        <header>
                            <strong>${this.escapeHtml(getText("Condition Column ID Search"))}</strong>
                            <div class="anly-work-rule-facet-actions">
                                <button type="button" onclick="${PAGE_CODE}.searchRuleSummaryConditionColumn()">Search</button>
                                <button type="button" class="${this.ruleSummaryFilters.conditionColumn === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.resetRuleSummaryConditionColumn()">Reset</button>
                            </div>
                        </header>
                        <label class="anly-work-rule-condition-search">
                            <span>Condition Column</span>
                            <input id="ruleConditionColumnInput-${PAGE_CODE}" type="search" value="${this.escapeHtml(conditionColumnFilter)}" placeholder="${this.escapeHtml(getText("e.g. COL001"))}" onkeydown="${PAGE_CODE}.handleRuleSummaryConditionColumnKeydown(event)">
                        </label>
                    </div>
                </section>
                <div class="anly-work-readable-rule-grid">
                    ${rules.length ? rules.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">${this.escapeHtml(getText("No rules match the selected conditions."))}</div>`}
                </div>
                ${this.renderRuleSummaryPager(summary.page, totalPages)}
            `;
        },

        renderFallbackReadableRuleGrid(rules = []) {
            const filtered = this.excludeEmptyConsequent
                ? rules.filter((rule) => !this.isEmptyRuleText(rule.thenText))
                : rules;
            return `<div class="anly-work-readable-rule-grid">${filtered.length ? filtered.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">${this.escapeHtml(getText("No rule rows to display."))}</div>`}</div>`;
        },

        renderReadableRuleStats(rules = [], visibleRuleCount = 0, baseRuleCount = 0) {
            const stats = this.createReadableRuleStats(rules);
            const conditionItems = [
                { label: getText("All"), value: "ALL", total: baseRuleCount, nonPerfect: stats.nonPerfect },
                ...stats.conditionBuckets.map((bucket) => ({
                    label: bucket.label,
                    value: String(Number(bucket.conditionCount || 0)),
                    total: bucket.count,
                    nonPerfect: bucket.nonPerfect
                }))
            ];
            return `
                <section class="anly-work-readable-stats">
                    <div class="anly-work-readable-stat-block">
                        <strong>${this.escapeHtml(getText("Rule Summary"))}</strong>
                        <div class="anly-work-readable-stat-metrics">
                            <span><b>${this.formatNumber(stats.total)}</b><small>${this.escapeHtml(getText("Current sample rules"))}</small></span>
                            <span><b>${this.formatNumber(stats.mapped)}</b><small>${this.escapeHtml(getText("Condition/result mapping"))}</small></span>
                            <span><b>${this.formatNumber(stats.missingResult)}</b><small>${this.escapeHtml(getText("Missing result information"))}</small></span>
                            <span><b>${this.formatNumber(visibleRuleCount)}</b><small>${this.escapeHtml(getText("Showing"))}</small></span>
                        </div>
                    </div>
                    <div class="anly-work-readable-condition-dist">
                        <strong>${this.escapeHtml(getText("Condition Count"))}</strong>
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
                <div class="anly-work-condition-count-matrix">
                    <div class="anly-work-condition-count-row">
                        <span>${this.escapeHtml(getText("Total rule count"))}</span>
                        <div class="anly-work-condition-count-buttons">${renderButtons("total", "ALL")}</div>
                    </div>
                    <div class="anly-work-condition-count-row">
                        <span>${this.escapeHtml(getText("Violation candidate rule count"))}</span>
                        <div class="anly-work-condition-count-buttons">${renderButtons("nonPerfect", "NON_PERFECT")}</div>
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
                return `<span class="anly-work-result-column-pager is-single"><small>${this.escapeHtml(getText("Total {count}", { count: this.formatNumber(total) }))}</small></span>`;
            }
            return `
                <span class="anly-work-result-column-pager">
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
                <footer class="anly-work-pager">
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
                    label: conditionCount > 0 ? getText("{count} conditions", { count: conditionCount }) : getText("Unparsed conditions"),
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

        buildSummaryRuleCards(rows = [], summary = {}) {
            return (rows || []).map((row, index) => {
                const conditionText = this.resolveRuleSideText(row.CONDITION_TEXT || "");
                const resultText = this.resolveRuleSideText(row.RESULT_TEXT || "");
                const hasResultValue = row.RESULT_HAS_VALUE_YN === "Y";
                const thenText = resultText
                    || (row.RESULT_COLUMN ? `${row.RESULT_COLUMN}${hasResultValue ? "" : ` (${getText("Value unavailable")})`}` : getText("No result information"));
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
                const conditionClusters = Array.isArray(row.CONDITION_CLUSTERS) ? row.CONDITION_CLUSTERS : [];
                const resultClusters = Array.isArray(row.RESULT_CLUSTERS) ? row.RESULT_CLUSTERS : [];
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
                        ? (isDecisionTree ? getText("Decision Tree target rule") : (isConditional ? getText("Conditional probability rule") : getText("Condition/result mapped")))
                        : getText("ID/metric focused"),
                    ifText: conditionText || getText("Review the condition item combination in Detail Views."),
                    thenText,
                    note,
                    metrics: [
                        { label: "count", value: frequencyLabel },
                        { label: "support", value: supportText },
                        { label: "confidence", value: confidenceText },
                        { label: getText("Expected violation"), value: expectedViolationRate },
                        { label: getText("Exception count"), value: this.formatNumber(exceptionCount) },
                        { label: "lift", value: liftText }
                    ],
                    conditionCount: Number(row.CONDITION_COUNT || 0),
                    clusterScope: String(row.CLUSTER_SCOPE || "UNCLUSTERED").toUpperCase(),
                    conditionClusters,
                    resultClusters,
                    clusterContext: summary.clusterContext || {}
                };
            });
        },

        describeReadableRuleSentence(rule = {}) {
            const condition = String(rule.conditionText || "").trim();
            const result = String(rule.thenText || "").trim();
            if (!condition || !result || this.isEmptyRuleText(result)) {
                return rule.isConditional
                    ? getText("This is a conditional frequency/probability rule whose condition or result value could not be interpreted on screen.")
                    : getText("This detail rule comes from the rule summary table saved during job execution.");
            }
            const supportCount = Number(rule.supportCount || 0);
            const conditionTotal = Number(rule.conditionTotal || 0);
            const confidence = rule.confidenceText || "-";
            const support = rule.supportText || "-";
            const lift = rule.liftText || "-";
            if (supportCount && conditionTotal) {
                return getText("Among {conditionTotal} rows that satisfy {condition}, {supportCount} rows produced {result}. Conditional probability is {confidence}, overall support is {support}, and lift is {lift}.", {
                    condition,
                    conditionTotal: this.formatNumber(conditionTotal),
                    result,
                    supportCount: this.formatNumber(supportCount),
                    confidence,
                    support,
                    lift
                });
            }
            return getText("When {condition}, this conditional rule leads to {result}. Conditional probability is {confidence}, overall support is {support}, and lift is {lift}.", {
                condition,
                result,
                confidence,
                support,
                lift
            });
        },

        buildRuleSummaryExport(node = {}, json = {}) {
            const cards = this.buildSummaryRuleCards(json.rules || [], json);
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
                    EXPECTED_VIOLATION_RATE: metricMap["EXPECTED VIOLATION"] || metricMap[String(getText("Expected violation")).toUpperCase()] || "",
                    EXCEPTION_COUNT: metricMap["EXCEPTION COUNT"] || metricMap[String(getText("Exception count")).toUpperCase()] || "",
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
                return getText("Shows conditional frequency/probability rules saved by target column for the Decision Tree classification model.");
            }
            if (modelType.includes("APRIORI") && source.includes("CONDITIONAL")) {
                return getText("Shows conditional frequency/probability rules calculated from Apriori model input data.");
            }
            if (source.includes("ORACLE_DM_VR")) {
                return getText("Shows rules saved by interpreting the Oracle ML rule view.");
            }
            return getText("Shows overall rule status based on the saved summary table.");
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

        renderAprioriClusterReference(rule = {}) {
            const clusterItems = [
                ...(Array.isArray(rule.conditionClusters) ? rule.conditionClusters : []),
                ...(Array.isArray(rule.resultClusters) ? rule.resultClusters : [])
            ];
            if (!clusterItems.length) return "";
            const clusterIds = [...new Set(clusterItems.map((item) => item?.CLUSTER_ID)
                .filter((clusterId) => clusterId !== undefined && clusterId !== null && clusterId !== ""))];
            return this.renderColumnClusterBadge(
                clusterIds.length ? clusterIds.join(", ") : null,
                rule.clusterScope,
                getText("Apriori generation was not hard-filtered by cluster; this is reference lineage.")
            );
        },

        renderReadableRuleCard(rule) {
            const qualityClass = rule.mappingLevel === "mapped" ? "is-mapped" : "is-limited";
            const plainRuleId = rule.rawRuleId || this.getPlainRuleId(rule.ruleId);
            return `
                <article class="anly-work-readable-rule-card ${qualityClass}">
                    <header>
                        <span class="anly-work-rule-title">
                            <small>Rule #</small>
                            <code title="${this.escapeHtml(plainRuleId)}">${this.escapeHtml(plainRuleId)}</code>
                            <button type="button" class="anly-work-rule-copy-btn" title="${this.escapeHtml(getText("Copy RULE ID"))}" onclick="${PAGE_CODE}.copyRuleId('${this.escapeJs(plainRuleId)}', event)">
                                <i class="far fa-copy"></i>
                            </button>
                        </span>
                        <span class="anly-work-rule-card-actions">
                            <em>${this.escapeHtml(rule.mappingLabel)}</em>
                            ${this.renderAprioriClusterReference(rule)}
                            ${rule.canOpenViolation
                                ? `<button type="button" class="anly-work-rule-open-link" title="${this.escapeHtml(getText("Search violation detection results with this RULE ID"))}" onclick="${PAGE_CODE}.openViolationForRule('${this.escapeJs(plainRuleId)}', '${this.escapeJs(rule.conditionCount)}')">${this.escapeHtml(getText("View violations"))}</button>`
                                : ""}
                        </span>
                    </header>
                    <div class="anly-work-readable-rule-sentence">
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

        getSymbolicFormulaText(rule = {}, features = [], targetColumn = "") {
            const safeFeatures = Array.isArray(features) && features.length
                ? features.map((feature) => String(feature || "").trim()).filter(Boolean)
                : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const target = String(targetColumn || rule.TARGET_COLUMN || "Y").trim() || "Y";
            return `f(${safeFeatures.join(", ") || "x"}) = ${String(rule.EXPRESSION || "").trim()} = ${target}`;
        },

        async copySymbolicFormula(formula, event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            await this.copyTextValue(formula, "Formula copied.");
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
                <div class="anly-work-model-visual-grid">
                    <div class="anly-work-model-view-card is-vi">
                        ${this.renderModelViewHeader("VI", "Itemset/detail", vi)}
                        <div class="anly-work-model-view-note">
                            <strong>Extracted itemset values</strong>
                            <span>${this.escapeHtml(getText("Values extracted from ITEM / ATTRIBUTE / VALUE / NAME family columns in the original DM$VI rows."))}</span>
                        </div>
                        <div class="anly-work-tag-cloud">
                            ${itemTags.length ? itemTags.map((item) => `<span style="--tag-weight:${item.weight}">${this.escapeHtml(item.label)}</span>`).join("") : `<small>${this.escapeHtml(getText("No DM$VI itemset rows."))}</small>`}
                        </div>
                        ${this.renderSampleTable("DM$VI sample rows", vi.columns || [], vi.data || [], 5)}
                    </div>
                    <div class="anly-work-model-view-card is-vr">
                        ${this.renderModelViewHeader("VR", "Top Rules", vr)}
                        ${rules.length ? `
                            <div class="anly-work-rule-bars">
                                ${rules.map((rule) => `
                                    <div class="anly-work-rule-bar">
                                        <span title="${this.escapeHtml(rule.label)}">${this.escapeHtml(rule.label)}</span>
                                        <em><i style="width:${Math.max(4, rule.score)}%"></i></em>
                                        <small>
                                            <b>${this.escapeHtml(rule.scoreName)}</b>
                                            <strong>${this.escapeHtml(rule.scoreValue)}</strong>
                                        </small>
                                    </div>
                                `).join("")}
                            </div>
                        ` : `<small>${this.escapeHtml(getText("No DM$VR rule rows."))}</small>`}
                    </div>
                </div>
                <div class="anly-work-model-view-card is-vg">
                    ${this.renderModelViewHeader("VG", "Global/detail", vg)}
                    ${this.renderSampleTable("", vg.columns || [], vg.data || [], 4)}
                </div>
                <div class="anly-work-model-view-card is-va">
                    ${this.renderModelViewHeader("VA", "Attribute/detail rows", va)}
                    ${this.renderSampleTable("", va.columns || [], va.data || [], 6)}
                </div>
                <div class="anly-work-model-view-card is-vr">
                    ${this.renderModelViewHeader("VR", "Rule/detail rows", vr)}
                    ${this.renderSampleTable("", vr.columns || [], vr.data || [], 8)}
                </div>
            `;
        },

        renderModelViewHeader(viewType, title, view = {}) {
            const exists = (view.existsYn || "N") === "Y";
            const hasRows = Array.isArray(view.data) && view.data.length > 0;
            const loadButton = exists && !hasRows
                ? `<button type="button" class="table-btn" onclick="${PAGE_CODE}.loadDetailViewPage('${this.escapeHtml(viewType)}', 1)">${this.escapeHtml(getText("Load sample"))}</button>`
                : "";
            return `
                <div class="anly-work-model-view-header">
                    <span class="anly-work-model-view-type">${this.escapeHtml(viewType)}</span>
                    <div>
                        <strong>${this.escapeHtml(title)}</strong>
                        <small>${this.escapeHtml(view.description || "")}</small>
                        <code>${this.escapeHtml(view.viewName || `DM$${viewType}`)}</code>
                        <small>${hasRows ? this.escapeHtml(getText("Sample {range} / {total} rows", { range: this.getViewSampleRange(view), total: this.formatNumber(view.total || 0) })) : this.escapeHtml(getText("Samples have not been loaded yet to keep the initial load fast."))}</small>
                    </div>
                    <em>${hasRows ? `${this.formatNumber(view.total || 0)} rows` : (exists ? "ready" : "none")}</em>
                </div>
                <div class="anly-work-view-sample-toolbar">
                    <span>${this.escapeHtml(hasRows ? getText("The current table is a sample of the selected page, not the full dataset.") : getText("Load only the detail views you need."))}</span>
                    ${loadButton || this.renderSamplePageJump(`detailViewPage-${viewType}-${PAGE_CODE}`, view, `${PAGE_CODE}.goDetailViewPage('${viewType}')`, `${PAGE_CODE}.loadDetailViewPage('${viewType}', `)}
                </div>
            `;
        },

        renderSampleTable(title, columns, rows, limit = 6) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__").slice(0, 8);
            const safeRows = (rows || []).slice(0, limit);
            if (!safeColumns.length || !safeRows.length) return `<div class="table-empty">${this.escapeHtml(getText("No sample rows to display."))}</div>`;
            return `
                <div class="anly-work-sample-table-wrap">
                    ${title ? `<strong>${this.escapeHtml(getText("{title} · {count} displayed", { title, count: this.formatNumber(safeRows.length) }))}</strong>` : `<strong>${this.escapeHtml(getText("{count} displayed", { count: this.formatNumber(safeRows.length) }))}</strong>`}
                    <table class="table-grid anly-work-sample-table">
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
            if (!total || !count) return getText("0 rows");
            const start = ((page - 1) * pageSize) + 1;
            const end = Math.min(total, start + count - 1);
            return getText("{start}-{end} rows", { start: this.formatNumber(start), end: this.formatNumber(end) });
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
            const optionPageSizes = Array.isArray(options.pageSizes) ? options.pageSizes.map((size) => Number(size)) : [];
            const rawPageSize = Number(view.pageSize || options.defaultPageSize || 20);
            const selectedPageSize = optionPageSizes.includes(rawPageSize)
                ? rawPageSize
                : this.normalizeRuleCardPageSize(rawPageSize);
            const pageSizeSelect = Array.isArray(options.pageSizes) && options.pageSizes.length
                ? `
                    <select id="${this.escapeHtml(pageSizeId)}" title="Page size" onchange="${this.escapeHtml(onPageSizeChange)}">
                        ${options.pageSizes.map((size) => `<option value="${this.escapeHtml(size)}" ${Number(size) === selectedPageSize ? "selected" : ""}>${this.formatNumber(size)}</option>`).join("")}
                    </select>
                `
                : "";
            return `
                <div class="anly-work-page-jump">
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

        renderTableResultPageTools(inputName, json = {}) {
            const inputId = `${inputName}-${PAGE_CODE}`;
            return `
                <div class="anly-work-result-page-tools">
                    <span class="anly-work-result-total">${this.escapeHtml(getText("Grid total {count} rows", { count: this.formatNumber(json.total || 0) }))}</span>
                    ${this.renderSamplePageJump(inputId, json, `${PAGE_CODE}.goTableResultPage('${this.escapeJs(inputId)}')`, `${PAGE_CODE}.loadResultTable`, {
                        pageSizeId: `${inputId}-pageSize`,
                        pageSizes: [20, 50, 100, 200, 500],
                        onPageSizeChange: `${PAGE_CODE}.changeResultPageSize(this.value)`
                    })}
                </div>
            `;
        },

        async goTableResultPage(inputId) {
            const input = document.getElementById(String(inputId || ""));
            const page = Math.max(1, Number(input?.value || this.resultPage || 1));
            await this.loadResultTable(page);
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
                <header class="anly-work-result-header">
                    <div>
                        <span>${this.escapeHtml(type)}</span>
                        <strong class="anly-work-result-exec-object">${this.escapeHtml(executionTitle)}</strong>
                        <small>Result Table ${this.escapeHtml(resultObject)} · ${this.formatNumber(json.total)} rows</small>
                        ${json.filteredByTarget ? `<small>Target ${this.escapeHtml(json.targetOwner)}.${this.escapeHtml(json.targetTable)}</small>` : ""}
                        ${json.ruleModelName ? `<small>Rule Model ${this.escapeHtml(json.ruleModelName)}</small>` : ""}
                        ${this.renderSelectedNodeJobDesc()}
                    </div>
                    ${this.renderSelectedNodeExecutionMeta()}
                </header>
                ${this.renderTableResultSummaryShell(json)}
                <div id="tableResultBody-${PAGE_CODE}" class="anly-work-result-body">
                    ${this.renderResultTableBody(json)}
                </div>
            `;
            this.prependNodeResultSwitcher();
            this.snapshotNodeResultCache();
        },

        renderResultTableBody(json = {}) {
            return `
                ${this.renderResultTableProfile(json.columns || [], json.data || [])}
                ${this.renderGrid(json.columns || [], json.data || [], json)}
                ${this.renderResultPager(json.page, json.pageSize, json.total, "${PAGE_CODE}.refreshResultGridOnly(")}
            `;
        },

        refreshTableResultSummary({ preserveScroll = false } = {}) {
            const summaryPanel = getContainerEl(`#tableResultSummary-${PAGE_CODE}`);
            if (!summaryPanel || !this.lastResultTableJson) return;
            const restoreScroll = preserveScroll ? this.preserveResultScroll() : null;
            summaryPanel.innerHTML = this.renderTableResultSummary(this.lastResultTableJson);
            if (restoreScroll) {
                restoreScroll();
                requestAnimationFrame(restoreScroll);
            }
            this.snapshotNodeResultCache();
        },

        preserveResultScroll() {
            const states = [];
            const addState = (el) => {
                if (!el || states.some((state) => state.el === el)) return;
                states.push({ el, top: el.scrollTop || 0, left: el.scrollLeft || 0 });
            };
            addState(document.scrollingElement || document.documentElement);
            const panel = getContainerEl(`#resultPanel-${PAGE_CODE}`);
            let current = panel;
            while (current && current !== document.body) {
                if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
                    addState(current);
                }
                current = current.parentElement;
            }
            return () => {
                states.forEach((state) => {
                    state.el.scrollTop = state.top;
                    state.el.scrollLeft = state.left;
                });
            };
        },

        updateResultFilterButtonStates() {
            const summaryPanel = getContainerEl(`#tableResultSummary-${PAGE_CODE}`);
            if (!summaryPanel) return;
            summaryPanel.querySelectorAll("[data-anly-filter='correlation-pair']").forEach((button) => {
                button.classList.toggle(
                    "is-active",
                    this.isColumnPairFilterActive(this.correlationSummaryFilter, button.dataset.colA || "", button.dataset.colB || "")
                );
            });
            summaryPanel.querySelectorAll("[data-anly-filter='relation-pair']").forEach((button) => {
                button.classList.toggle(
                    "is-active",
                    this.isColumnPairFilterActive(this.relationPairFilter, button.dataset.colA || "", button.dataset.colB || "")
                );
            });
            summaryPanel.querySelectorAll("[data-anly-filter='relation-no-pair']").forEach((button) => {
                const type = this.normalizeRelationType(button.dataset.relationType || "");
                button.classList.toggle(
                    "is-active",
                    this.relationPairFilter?.relationType === type && this.relationPairFilter?.passYn === "N"
                );
            });
            summaryPanel.querySelectorAll("[data-anly-filter='network-cluster']").forEach((button) => {
                const clusterId = this.getRelationClusterId(button.dataset.clusterId || "");
                button.classList.toggle("is-active", this.getActiveRelationNetworkClusterId() === clusterId);
            });
            summaryPanel.querySelectorAll("[data-anly-filter='network-pair']").forEach((button) => {
                button.classList.toggle(
                    "is-active",
                    this.isRelationNetworkPairFilterActive(
                        button.dataset.colA || "",
                        button.dataset.colB || "",
                        button.dataset.clusterId || ""
                    )
                );
            });
            summaryPanel.querySelectorAll("[data-anly-filter='lasso-pair']").forEach((button) => {
                const filter = this.lassoPairFilter || {};
                button.classList.toggle(
                    "is-active",
                    String(filter.targetColumn || "").trim() === String(button.dataset.targetColumn || "").trim()
                    && String(filter.featureName || "").trim() === String(button.dataset.featureName || "").trim()
                );
            });
        },

        renderResultError(message) {
            const panel = getContainerEl("#resultPanel-${PAGE_CODE}");
            if (!panel) return;
            panel.classList.remove("is-loading");
            panel.innerHTML = `<div class="table-error">${this.escapeHtml(message)}</div>`;
            this.prependNodeResultSwitcher();
        },

        renderResultTableProfile(columns, rows) {
            const numericProfile = this.extractNumericProfile(rows || [], columns || []).slice(0, 8);
            if (!numericProfile.length) return "";
            return `
                <div class="anly-work-table-profile-bars">
                    ${numericProfile.map((item) => `
                        <div class="anly-work-profile-bar">
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
                    label: getText("All"),
                    value: "ALL",
                    total: candidateOverview.TOTAL_RULES,
                    nonPerfect: candidateOverview.NON_PERFECT_CONF_RULES
                },
                ...(summary.candidateConditionDist || []).map((bucket) => ({
                    label: Number(bucket.CONDITION_COUNT || 0) > 0 ? getText("{count} conditions", { count: this.formatNumber(bucket.CONDITION_COUNT) }) : getText("Unparsed conditions"),
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
            const activeScopeLabel = this.violationRuleFilters?.confidenceScope === "ALL" ? getText("All rules") : getText("Rules below 100%");
            const resultScope = summary.resultScope || this.violationRuleFilters?.resultScope || "HIT";
            const resultScopeMessage = resultScope === "CANDIDATE"
                ? getText("Displays all selected candidate rules.")
                : resultScope === "MAX_RULES"
                    ? getText("Displays rules whose detection rank is outside the max rules range among all candidates.")
                : resultScope === "MISS"
                    ? getText("Displays selected candidates with no actual violation rows.")
                    : getText("Displays rules with actual violation rows.");
            return `
                <section class="anly-work-violation-summary">
                    <div class="anly-work-violation-intro">
                        <div>
                            <strong>${this.escapeHtml(getText("Rule Violation Detection Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · {scope} basis", { target: `${summary.targetOwner || "-"}.${summary.targetTable || "-"}`, scope: activeScopeLabel }))}${summary.ruleModelName ? ` · Rule Model ${this.escapeHtml(summary.ruleModelName)}` : ""}</span>
                        </div>
                        ${this.renderViolationRulePager(summary)}
                    </div>
                    <section class="anly-work-violation-condition-panel">
                        <strong>${this.escapeHtml(getText("Condition Count"))}</strong>
                        ${this.renderRuleConditionMatrix(candidateItems, this.violationRuleFilters?.conditionCount || "ALL", this.violationRuleFilters?.confidenceScope || "NON_PERFECT", "${PAGE_CODE}.selectViolationCondition")}
                        <div class="anly-work-violation-inline-summary">
                            <button type="button" class="${resultScope === "CANDIDATE" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('CANDIDATE')">
                                <small>${this.escapeHtml(getText("Selected candidates"))}</small>
                                <b>${this.formatNumber(scopedCandidateCount)}</b>
                                <em>${this.escapeHtml(activeScopeLabel)}</em>
                            </button>
                            <button type="button" disabled>
                                <small>${this.escapeHtml(getText("Detection targets"))}</small>
                                <b>${this.formatNumber(detectionEligibleCount)}</b>
                                <em>${this.escapeHtml(getText("min/conf/lift/max applied"))}</em>
                            </button>
                            <button type="button" class="is-hit ${resultScope === "HIT" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('HIT')">
                                <small>${this.escapeHtml(getText("Violation found"))}</small>
                                <b>${this.formatNumber(violatedRuleCount)}</b>
                                <em>${this.escapeHtml(getText("Shown below"))}</em>
                            </button>
                            <button type="button" class="is-muted ${resultScope === "MISS" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('MISS')">
                                <small>${this.escapeHtml(getText("No violation"))}</small>
                                <b>${this.formatNumber(noViolationRuleCount)}</b>
                                <em>${this.escapeHtml(getText("Show no violation"))}</em>
                            </button>
                            <button type="button" class="is-muted ${resultScope === "MAX_RULES" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectViolationResultScope('MAX_RULES')">
                                <small>${this.escapeHtml(getText("Excluded by max rules"))}</small>
                                <b>${this.formatNumber(maxRulesCutoffCount)}</b>
                                <em>${this.escapeHtml(getText("Outside top 100"))}</em>
                            </button>
                            <button type="button" disabled>
                                <small>${this.escapeHtml(getText("Violation rows / count"))}</small>
                                <b>${this.formatNumber(overview.VIOLATED_ROW_COUNT)} / ${this.formatNumber(overview.VIOLATION_COUNT)}</b>
                                <em>${this.escapeHtml(getText("Actual detection result"))}</em>
                            </button>
                            ${ruleFilterDisplay ? `<b>${this.escapeHtml(getText("RULE ID search: {ruleId}", { ruleId: ruleFilterDisplay }))}</b>` : ""}
                        </div>
                        <div class="anly-work-violation-reason-strip">
                            <span><small>${this.escapeHtml(getText("Below confidence"))}</small><b>${this.formatNumber(confidenceCutoffCount)}</b></span>
                            <span><small>${this.escapeHtml(getText("Below lift"))}</small><b>${this.formatNumber(liftCutoffCount)}</b></span>
                            <span><small>${this.escapeHtml(getText("Excluded by max rules"))}</small><b>${this.formatNumber(maxRulesCutoffCount)}</b></span>
                            <span><small>${this.escapeHtml(getText("No violation after detection"))}</small><b>${this.formatNumber(noViolationAfterDetectionCount)}</b></span>
                            <em>${this.escapeHtml(getText("Detection criteria: confidence >= {confidence}, lift >= {lift}, max rules {maxRules}", { confidence: this.formatPercentMetric(detectionCriteria.minConfidence), lift: this.formatDecimal(detectionCriteria.minLift), maxRules: this.formatNumber(detectionCriteria.maxRules) }))}</em>
                        </div>
                        <div class="anly-work-violation-scope-note">${this.escapeHtml(resultScopeMessage)}</div>
                    </section>
                    <section class="anly-work-rule-facet-panel is-violation">
                        <div class="anly-work-rule-facet-block">
                            <header>
                                <strong>${this.escapeHtml(getText("Top Violation Result Columns"))}</strong>
                            </header>
                            <div class="anly-work-rule-facet-list is-result-column-grid">
                                ${topColumns.length ? topColumns.map((item) => `
                                    <button type="button" onclick="${PAGE_CODE}.openViolationSqlPopup('column', '${this.escapeJs(item.RESULT_COLUMN)}')">
                                        <span>${this.renderColumnAwareCell(item.RESULT_COLUMN, summary)}</span>
                                        <b>${this.formatNumber(item.VIOLATION_COUNT)}</b>
                                    </button>
                                `).join("") : `<span>${this.escapeHtml(getText("No violation result columns to display."))}</span>`}
                            </div>
                        </div>
                        <div class="anly-work-rule-facet-block is-condition">
                            <header>
                                <strong>${this.escapeHtml(getText("RULE ID Search"))}</strong>
                                <div class="anly-work-rule-facet-actions">
                                    <button type="button" onclick="${PAGE_CODE}.searchViolationRule()">Search</button>
                                    <button type="button" onclick="${PAGE_CODE}.resetViolationRuleSearch()">Reset</button>
                                </div>
                            </header>
                            <label class="anly-work-rule-condition-search">
                                <span>RULE ID</span>
                                <input id="violationRuleSearch-${PAGE_CODE}" type="search" value="${this.escapeHtml(ruleFilterDisplay)}" placeholder="${this.escapeHtml(getText("e.g. COND_..."))}" onkeydown="${PAGE_CODE}.handleViolationRuleSearchKeydown(event)">
                            </label>
                        </div>
                    </section>
                    ${topRules.length ? `
                        <div class="anly-work-violation-rule-grid">
                            ${topRules.map((rule) => {
                                const hasViolation = Number(rule.VIOLATION_COUNT || 0) > 0;
                                return `
                                <article class="${hasViolation ? "" : "is-no-violation"}">
                                    <header>
                                        <strong>${this.escapeHtml(rule.RULE_ID)}</strong>
                                        <button type="button" class="${hasViolation ? "" : "is-muted"}" onclick="${PAGE_CODE}.openViolationSqlPopup('rule', '${this.escapeJs(rule.RULE_ID)}')">
                                            ${hasViolation ? this.escapeHtml(getText("{count} rows", { count: this.formatNumber(rule.VIOLATION_COUNT) })) : (rule.DETECTION_SCANNED_YN === "N" ? this.escapeHtml(getText("Excluded by max rules")) : this.escapeHtml(getText("No violation")))}
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
                                        <span><small>${this.escapeHtml(getText("Expected violation"))}</small><b>${this.formatExpectedViolationRate(rule.RULE_CONFIDENCE)}</b></span>
                                        <span><small>lift</small><b>${this.formatDecimal(rule.RULE_LIFT)}</b></span>
                                        <span><small>support</small><b>${this.formatPercentMetric(rule.RULE_SUPPORT)}</b></span>
                                        <span><small>${this.escapeHtml(getText("Detection rank"))}</small><b>${rule.DETECTION_RN ? this.formatNumber(rule.DETECTION_RN) : "-"}</b></span>
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
                return getText("No candidate rules match the searched RULE ID.");
            }
            if (Number(maxRulesCutoffCount || 0) > 0 && Number(detectionEligibleCount || 0) === 0) {
                return getText("The candidate rule is outside the max rules range for this run and was excluded from actual violation detection.");
            }
            if (resultScope === "HIT") {
                return getText("No rules produced actual violation rows. Check all candidates and max rules exclusions as well.");
            }
            if (resultScope === "MAX_RULES") {
                return getText("No candidate rules were excluded outside the max rules range.");
            }
            if (resultScope === "MISS") {
                return getText("No actual detection targets have zero violation rows.");
            }
            return getText("No rules to display.");
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
            const defaultFreezeColumns = window.matchMedia("(max-width: 760px)").matches ? 0 : 2;
            const label = kind === "column"
                ? getText("Result column {value}", { value })
                : (kind === "rule" ? `Rule ${value}` : getText("All violations"));
            this.violationSql = {
                sql,
                mode: "SAVED",
                kind,
                value,
                supportsRealtime,
                page: 1,
                pageSize: 50,
                freezeColumns: defaultFreezeColumns,
                total: 0,
                columns: [],
                rows: [],
                columnWidths: {},
                ruleColumns,
                ruleDetail,
                title: getText("{label} violation row query", { label })
            };
            this.renderViolationSqlPopup();
            const requestId = ++this.violationSqlRequestId;
            window.setTimeout(() => this.executeViolationSql(1, requestId), 0);
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
                alert(getText("No node is selected."));
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
                alert(getText("Violation result or Target Table information is missing."));
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
                alert(getText("Continuous violation result or Target Table information is missing."));
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
                alert(getText("Realtime lookup is available only for RULE ID based queries."));
                return "";
            }
            if (this.isSymbolicViolationNode(this.selectedNode)) {
                return this.createSymbolicRealtimeViolationSqlLookup(value);
            }
            if (this.isRuleViolationNode(this.selectedNode)) {
                return this.createCategoricalRealtimeViolationSqlLookup(value);
            }
            alert(getText("This node does not support realtime violation lookup."));
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
                alert(getText("Rule Model or Target Table information required for realtime lookup is missing."));
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
                "ruleTableName"
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
                alert(getText("Symbolic Rule or Target Table information required for realtime lookup is missing."));
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
            const requestId = ++this.violationSqlRequestId;
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
                window.setTimeout(() => this.executeViolationSql(1, requestId), 0);
                return;
            }
            if (!state.supportsRealtime) {
                alert(getText("Realtime lookup is available only for RULE ID based queries."));
                return;
            }
            const lookupSql = this.createRealtimeViolationSqlLookup(state.kind || "all", state.value || "");
            if (!lookupSql) return;
            this.violationSql = {
                ...state,
                mode: "LIVE",
                page: 1,
                total: 0,
                columns: [],
                rows: []
            };
            this.renderViolationSqlPopup();
            const message = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlMessage`);
            if (message) message.textContent = getText("Generating realtime violation lookup SQL...");
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
                if (requestId !== this.violationSqlRequestId) return;
                const row = (json.data || [])[0] || {};
                const liveSql = row.LIVE_SQL || row.live_sql || "";
                if (!String(liveSql || "").trim()) {
                    throw new Error(getText("Could not generate realtime lookup SQL."));
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
                window.setTimeout(() => this.executeViolationSql(1, requestId), 0);
            } catch (error) {
                if (requestId !== this.violationSqlRequestId) return;
                if (message) message.textContent = error.message || getText("Failed to generate realtime lookup SQL.");
            }
        },

        renderViolationSqlModeSwitch(state = this.violationSql || {}) {
            if (!state.supportsRealtime) return "";
            const mode = String(state.mode || "SAVED").toUpperCase();
            return `
                <div class="anly-work-sql-mode-switch">
                    <span>${this.escapeHtml(getText("Query mode"))}</span>
                    <button type="button" class="${mode === "SAVED" ? "is-active" : ""}" onclick="${PAGE_CODE}.changeViolationSqlMode('SAVED')">${this.escapeHtml(getText("Sampled"))}</button>
                    <button type="button" class="${mode === "LIVE" ? "is-active" : ""}" onclick="${PAGE_CODE}.changeViolationSqlMode('LIVE')">${this.escapeHtml(getText("Realtime"))}</button>
                    <em>${this.escapeHtml(mode === "LIVE" ? getText("Rechecks the target table using the current data.") : getText("Queries violation rows saved by the detection procedure."))}</em>
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
            popup.className = "anly-work-sql-popup";
            popup.innerHTML = `
                <section>
                    <header class="anly-work-sql-popup-title" onmousedown="${PAGE_CODE}.startViolationSqlPopupDrag(event)">
                        <div>
                            <strong>${this.escapeHtml(state.title || getText("Violation Row SQL"))}</strong>
                            <span>${this.escapeHtml(getText("Run the current SQL with Ctrl+Enter."))}</span>
                        </div>
                        <button type="button" onclick="${PAGE_CODE}.closeViolationSqlPopup()"><i class="fas fa-times"></i></button>
                    </header>
                    <div class="anly-work-sql-popup-body">
                        ${this.renderViolationSqlRuleContext(state.ruleDetail)}
                        ${this.renderViolationSqlModeSwitch(state)}
                        <div class="anly-work-sql-editor-wrap">
                            <button type="button" class="anly-work-sql-copy-btn" title="${this.escapeHtml(getText("Copy current SQL"))}" onclick="${PAGE_CODE}.copyCurrentViolationSql(event)">
                                <i class="far fa-copy"></i>
                            </button>
                            <textarea id="${PAGE_ID_PREFIX}ViolationSqlEditor" class="anly-work-sql-editor" spellcheck="false" onkeydown="${PAGE_CODE}.handleViolationSqlKeydown(event)">${this.escapeHtml(state.sql || "")}</textarea>
                        </div>
                        <div class="anly-work-sql-popup-toolbar">
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
                            <div class="anly-work-page-jump">
                                <button type="button" ${Number(state.page || 1) <= 1 ? "disabled" : ""} onclick="${PAGE_CODE}.executeViolationSql(${Math.max(1, Number(state.page || 1) - 1)})"><i class="fas fa-chevron-left"></i></button>
                                <label><span>Page</span><input id="${PAGE_ID_PREFIX}ViolationSqlPage" type="number" min="1" max="${totalPages}" value="${this.escapeHtml(state.page || 1)}" onkeydown="if(event.key==='Enter'){${PAGE_CODE}.goViolationSqlPage()}"><small>/ ${this.formatNumber(totalPages)}</small></label>
                                <button type="button" onclick="${PAGE_CODE}.goViolationSqlPage()">Go</button>
                                <button type="button" ${Number(state.page || 1) >= totalPages ? "disabled" : ""} onclick="${PAGE_CODE}.executeViolationSql(${Number(state.page || 1) + 1})"><i class="fas fa-chevron-right"></i></button>
                            </div>
                        </div>
                        <div id="${PAGE_ID_PREFIX}ViolationSqlMessage" class="table-empty">${state.rows?.length ? "" : this.escapeHtml(getText("Review the SQL, then query with Run or Ctrl+Enter."))}</div>
                        <div class="anly-work-sql-result">
                            ${state.columns?.length ? this.renderViolationSqlGrid(state.columns, state.rows, state.ruleColumns || []) : ""}
                        </div>
                    </div>
                </section>
            `;
            this.applyViolationSqlGridDefaults();
        },

        applyViolationSqlGridDefaults() {
            const table = document.querySelector(`#${PAGE_ID_PREFIX}ViolationSqlPopup .anly-work-violation-sql-grid`);
            const gridUtils = window.CommonUtils;
            if (!table || !gridUtils) return;
            // The popup is rendered outside the page container. Apply the common grid
            // setup synchronously instead of waiting for its MutationObserver.
            gridUtils.applyStandardGridDefaults(table);
            window.requestAnimationFrame(() => {
                if (!table.isConnected) return;
                gridUtils.applyStandardGridFreeze(
                    table,
                    Math.max(0, Number.parseInt(table.dataset.standardGridFreezeColumns || "0", 10) || 0)
                );
                const noHeader = table.tHead?.rows?.[0]?.cells?.[0];
                if (noHeader?.classList?.contains("grid-row-no")) {
                    noHeader.style.position = "sticky";
                    noHeader.style.top = "0px";
                    noHeader.style.left = "0px";
                    noHeader.style.zIndex = "90";
                }
            });
        },

        renderViolationSqlRuleContext(rule = null) {
            if (!rule) return "";
            if (rule.EXPRESSION !== undefined || rule.FEATURE_COLUMNS !== undefined || rule.TARGET_COLUMN !== undefined) {
                const features = this.parseFeatureList(rule.FEATURE_COLUMNS || "");
                const featureLabel = features.join(", ") || "x";
                const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
                return `
                    <section class="anly-work-violation-rule-context">
                        <header>
                            <strong>${this.escapeHtml(rule.RULE_ID || "")}</strong>
                            <span>${this.escapeHtml(getText("{count} rows", { count: this.formatNumber(rule.VIOLATION_COUNT) }))} · max error ${this.formatPercentMetric(rule.MAX_ERROR_PCT)} · tolerance ${this.formatPercentMetric(rule.TOLERANCE_PCT)}</span>
                        </header>
                        <p>
                            <b>F(X)</b>
                            f(${this.escapeHtml(featureLabel)}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${this.renderColumnAwareCell(targetColumn, this.lastSymbolicViolationSummary || {})}
                        </p>
                    </section>
                `;
            }
            return `
                <section class="anly-work-violation-rule-context">
                    <header>
                        <strong>${this.escapeHtml(rule.RULE_ID || "")}</strong>
                        <span>${this.escapeHtml(getText("{count} rows", { count: this.formatNumber(rule.VIOLATION_COUNT) }))} · confidence ${this.formatPercentMetric(rule.RULE_CONFIDENCE)} · lift ${this.formatDecimal(rule.RULE_LIFT)}</span>
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
            if (!safeColumns.length) return `<div class="table-empty">${this.escapeHtml(getText("No query results."))}</div>`;
            const columnWidths = this.violationSql?.columnWidths || {};
            const freezeColumns = Math.max(0, Math.min(Number(this.violationSql?.freezeColumns ?? 2), safeColumns.length));
            let left = 48;
            const columnMeta = safeColumns.map((column, index) => {
                const width = this.getViolationSqlColumnWidth(column, columnWidths);
                const frozen = index < freezeColumns;
                const stickyStyle = frozen ? `position: sticky; left: ${left}px;` : "";
                if (frozen) left += width;
                return { column, index, width, frozen, stickyStyle };
            });
            const rowOffset = (Math.max(1, Number(this.violationSql?.page || 1)) - 1) * Math.max(1, Number(this.violationSql?.pageSize || 50));
            return `
                <div class="anly-work-violation-sql-grid-wrap">
                    <table class="table-grid anly-work-violation-sql-grid" data-grid-row-offset="${rowOffset}" data-standard-grid-freeze-columns="${freezeColumns}">
                        <colgroup data-grid-widths-ready="Y">
                            ${columnMeta.map((meta) => `<col style="width: ${meta.width}px;">`).join("")}
                        </colgroup>
                        <thead><tr>
                            ${columnMeta.map((meta) => `
                            <th class="is-resizable ${meta.frozen ? "is-frozen-col" : ""} ${this.getViolationSqlColumnClass(meta.column, keyColumns, ruleColumnSet)}" data-col-index="${meta.index}" style="${meta.stickyStyle}">
                                <span class="table-th-content">${this.renderColumnAwareCell(meta.column, awareSummary)}</span>
                                <span class="column-resizer" onmousedown="${PAGE_CODE}.startViolationSqlColumnResize(event, ${meta.index})"></span>
                            </th>
                        `).join("")}</tr></thead>
                        <tbody>
                            ${(rows || []).map((row) => `
                                <tr>
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
            const result = document.querySelector(`#${PAGE_ID_PREFIX}ViolationSqlPopup .anly-work-sql-result`);
            const state = this.violationSql || {};
            if (!result) return;
            result.innerHTML = state.columns?.length
                ? this.renderViolationSqlGrid(state.columns, state.rows || [], state.ruleColumns || [])
                : "";
            this.applyViolationSqlGridDefaults();
        },

        startViolationSqlColumnResize(event, columnIndex) {
            event.preventDefault();
            event.stopPropagation();
            const table = event.currentTarget?.closest?.("table");
            const col = table?.querySelectorAll("col")?.[columnIndex + 1];
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
            this.violationSqlRequestId += 1;
            const popup = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPopup`);
            if (popup) popup.remove();
        },

        handleViolationSqlKeydown(event) {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                this.executeViolationSql(1);
            }
        },

        async executeViolationSql(page = 1, requestId = null) {
            const editor = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlEditor`);
            if (!editor) return;
            const activeRequestId = requestId === null ? ++this.violationSqlRequestId : requestId;
            if (activeRequestId !== this.violationSqlRequestId) return;
            const pageSize = Number(document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlPageSize`)?.value || this.violationSql.pageSize || 50);
            const message = document.getElementById(`${PAGE_ID_PREFIX}ViolationSqlMessage`);
            if (message) message.textContent = getText("Querying...");
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
                if (activeRequestId !== this.violationSqlRequestId) return;
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
                if (activeRequestId !== this.violationSqlRequestId) return;
                if (message) message.textContent = error.message || getText("SQL query failed.");
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
                alert(getText("No violation row data to export."));
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

        renderCorrelationSummary(summary, json = {}) {
            if (!summary) return "";
            const columns = Array.isArray(summary.associatedColumns) ? summary.associatedColumns : [];
            const visibleColumns = columns.slice(0, 80);
            const hiddenCount = Math.max(0, columns.length - visibleColumns.length);
            const isNumeric = String(summary.correlationKind || "").toUpperCase() === "NUMERIC";
            const topPairs = this.getRepresentativeColumnPairs(Array.isArray(summary.topPairs) ? summary.topPairs : []);
            const pairFilter = this.correlationSummaryFilter || {};
            const metricLabel = summary.metricLabel || (isNumeric ? "|Pearson r|" : "Cramer's V");
            const signedMetricLabel = summary.signedMetricLabel || metricLabel;
            return `
                <section class="anly-work-corr-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(isNumeric ? getText("Numeric Correlation Summary") : getText("Categorical Correlation Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · {metric} basis", { target: `${summary.targetOwner}.${summary.targetTable}`, metric: metricLabel }))}</span>
                        </div>
                        <div class="anly-work-type-summary-actions">
                            <div class="anly-work-corr-metrics">
                                <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>${this.escapeHtml(getText("Total columns"))}</small></span>
                                <span><b>${this.formatNumber(summary.associatedColumnCount)}</b><small>${this.escapeHtml(getText("Associated columns"))}</small></span>
                                <span><b>${this.formatNumber(summary.associatedPairCount)}</b><small>${this.escapeHtml(getText("Associated pairs"))}</small></span>
                                <span><b>${this.formatDecimal(summary.maxMetricValue)}</b><small>${this.escapeHtml(getText("Max metric"))}</small></span>
                            </div>
                            ${this.renderTableResultPageTools("correlationResultPage", json)}
                        </div>
                    </header>
                    <p>${this.escapeHtml(getText("{kind} columns saved with PASS_YN=Y total {columnCount}, and passed pairs total {pairCount} out of {totalPairCount}.", { kind: isNumeric ? getText("Numeric correlation") : getText("Categorical correlation"), columnCount: this.formatNumber(summary.associatedColumnCount), pairCount: this.formatNumber(summary.associatedPairCount), totalPairCount: this.formatNumber(summary.totalPairCount) }))}</p>
                    <div class="anly-work-relation-detail-panel">
                        <header>
                            <strong>${this.escapeHtml(pairFilter.kind === "PAIR" ? getText("Selected correlation pair") : getText("Passed correlation pairs"))}</strong>
                            ${pairFilter.kind === "PAIR" ? `<button type="button" onclick="${PAGE_CODE}.selectCorrelationPairFilter('', '')">${this.escapeHtml(getText("Show all"))}</button>` : ""}
                        </header>
                        <div>
                            <strong>${this.escapeHtml(getText("Related columns"))}</strong>
                            <div class="anly-work-corr-tags">
                                ${visibleColumns.map((column) => this.renderColumnChip(column, summary)).join("")}
                                ${hiddenCount ? `<em class="anly-work-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                                ${!visibleColumns.length ? `<em class="anly-work-column-chip">${this.escapeHtml(getText("No related columns."))}</em>` : ""}
                            </div>
                        </div>
                        <div>
                            <strong>${this.escapeHtml(getText("Passed correlation pairs"))}</strong>
                            ${topPairs.length ? `
                                <div class="anly-work-relation-pair-list">
                                    ${topPairs.map((pair) => this.renderCorrelationSummaryPairRow(pair, summary, signedMetricLabel, metricLabel)).join("")}
                                </div>
                            ` : `<div class="table-empty">${this.escapeHtml(getText("No passed correlation pairs to display."))}</div>`}
                        </div>
                    </div>
                </section>
            `;
        },

        renderCorrelationSummaryPairRow(pair, summary, signedMetricLabel, metricLabel) {
            const colA = String(pair.COL_A || "").trim();
            const colB = String(pair.COL_B || "").trim();
            const active = this.isColumnPairFilterActive(this.correlationSummaryFilter, colA, colB);
            return `
                <button type="button" class="${active ? "is-active" : ""}" data-anly-filter="correlation-pair" data-col-a="${this.escapeHtml(colA)}" data-col-b="${this.escapeHtml(colB)}" onclick="${PAGE_CODE}.selectCorrelationPairFilter('${this.escapeJs(colA)}', '${this.escapeJs(colB)}')">
                    <span class="anly-work-relation-pair-col is-left">${this.renderColumnAwareCell(colA, summary)}</span>
                    <i aria-hidden="true">↔</i>
                    <span class="anly-work-relation-pair-col is-right">${this.renderColumnAwareCell(colB, summary)}</span>
                    <small>${this.escapeHtml(signedMetricLabel)} ${this.formatDecimal(pair.METRIC_VALUE)} · ${this.escapeHtml(metricLabel)} ${this.formatDecimal(pair.SORT_METRIC_VALUE)} · p ${this.formatDecimal(pair.P_VALUE)}</small>
                </button>
            `;
        },

        async selectCorrelationPairFilter(colA = "", colB = "") {
            const nextA = String(colA || "").trim();
            const nextB = String(colB || "").trim();
            if (!nextA || !nextB || this.isColumnPairFilterActive(this.correlationSummaryFilter, nextA, nextB)) {
                this.correlationSummaryFilter = { kind: "ALL", colA: "", colB: "" };
            } else {
                this.correlationSummaryFilter = { kind: "PAIR", colA: nextA, colB: nextB };
            }
            this.updateResultFilterButtonStates();
            await this.refreshResultGridOnly(1);
        },

        renderRelationSummary(summary, json = {}) {
            if (!summary) return "";
            const relationTypes = this.sortRelationTypes(Array.isArray(summary.relationTypes) ? summary.relationTypes : []);
            const validTypeSet = new Set(relationTypes.map((item) => this.normalizeRelationType(item.RELATION_TYPE)).filter(Boolean));
            const selectedType = validTypeSet.has(this.relationSummaryFilter) ? this.relationSummaryFilter : "ALL";
            const selectedPassYn = ["Y", "N"].includes(String(this.relationPairFilter?.passYn || "").toUpperCase())
                ? String(this.relationPairFilter.passYn).toUpperCase()
                : "ALL";
            const topPairs = this.getRepresentativeColumnPairs(this.sortRelationPairs([
                ...(Array.isArray(summary.topPairs) ? summary.topPairs : []),
                ...(Array.isArray(summary.rejectedPairs) ? summary.rejectedPairs : [])
            ]));
            const filteredPairs = topPairs.filter((pair) =>
                (selectedType === "ALL" || this.normalizeRelationType(pair.RELATION_TYPE) === selectedType)
                && (selectedPassYn === "ALL" || String(pair.PASS_YN || "N").toUpperCase() === selectedPassYn)
            );
            const passCriteria = this.getActualRelationPassCriteria();
            const columns = this.getRelationDetailColumns(summary, selectedType, filteredPairs, selectedPassYn);
            const visibleColumns = columns.slice(0, 80);
            const hiddenCount = Math.max(0, columns.length - visibleColumns.length);
            return `
                <section class="anly-work-corr-summary anly-work-relation-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(getText("Relation Matrix Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · mixed relation metric basis", { target: `${summary.targetOwner}.${summary.targetTable}` }))}</span>
                        </div>
                        <div class="anly-work-type-summary-actions">
                            <div class="anly-work-corr-metrics">
                                <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>${this.escapeHtml(getText("Total columns"))}</small></span>
                                <span><b>${this.formatNumber(summary.associatedColumnCount)}</b><small>${this.escapeHtml(getText("Associated columns"))}</small></span>
                                <span><b>${this.formatNumber(summary.associatedPairCount)}</b><small>${this.escapeHtml(getText("Associated pairs"))}</small></span>
                                <span><b>${this.formatDecimal(summary.maxMetricValue)}</b><small>${this.escapeHtml(getText("Max metric"))}</small></span>
                            </div>
                            ${this.renderTableResultPageTools("relationResultPage", json)}
                        </div>
                    </header>
                    <p>${this.escapeHtml(getText("Passed relation pairs total {pairCount} out of {totalPairCount}.", { pairCount: this.formatNumber(summary.associatedPairCount), totalPairCount: this.formatNumber(summary.totalPairCount) }))}</p>
                    <div class="anly-work-relation-pass-filter" role="group" aria-label="${this.escapeHtml(getText("PASS_YN filter"))}">
                        <button type="button" class="${selectedPassYn === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectRelationPassFilter('ALL')">
                            <b>${this.formatNumber(summary.totalPairCount)}</b><small>${this.escapeHtml(getText("All pairs"))}</small>
                        </button>
                        <button type="button" class="${selectedPassYn === "Y" ? "is-active is-pass" : "is-pass"}" onclick="${PAGE_CODE}.selectRelationPassFilter('Y')">
                            <b>${this.formatNumber(summary.associatedPairCount)}</b><small>${this.escapeHtml(getText("Passed pairs (Y)"))}</small>
                        </button>
                        <button type="button" class="${selectedPassYn === "N" ? "is-active is-rejected" : "is-rejected"}" onclick="${PAGE_CODE}.selectRelationPassFilter('N')">
                            <b>${this.formatNumber(summary.rejectedPairCount)}</b><small>${this.escapeHtml(getText("Below criteria (N)"))}</small>
                        </button>
                    </div>
                    <div class="anly-work-relation-criteria-note">
                        <strong>${this.escapeHtml(getText("Actual run pass criteria"))}</strong>
                        <span>CRAMER &gt; ${this.formatDecimal(passCriteria.minCramer)}</span>
                        <span>PEARSON ≥ ${this.formatDecimal(passCriteria.minAbsCorr)}</span>
                        <span>SPEARMAN ≥ ${this.formatDecimal(passCriteria.minMetric)}</span>
                        <span>ETA ≥ ${this.formatDecimal(passCriteria.minEta)}</span>
                        <span>p &lt; ${this.formatDecimal(passCriteria.minPvalue)}</span>
                        <span>n ≥ ${this.formatNumber(passCriteria.minRows)}</span>
                    </div>
                    ${relationTypes.length ? `
                        <div class="anly-work-relation-type-grid">
                            ${relationTypes.slice(0, 8).map((item) => {
                                const normalizedType = this.normalizeRelationType(item.RELATION_TYPE);
                                const passedPairCount = Number(item.PAIR_COUNT || 0);
                                const totalPairCount = Number(item.TOTAL_PAIR_COUNT ?? item.PAIR_COUNT ?? 0);
                                const rejectedPairCount = Math.max(0, totalPairCount - passedPairCount);
                                const filteredPairCount = selectedPassYn === "Y"
                                    ? passedPairCount
                                    : (selectedPassYn === "N" ? rejectedPairCount : totalPairCount);
                                const filteredCountLabel = selectedPassYn === "Y"
                                    ? getText("Passed pairs (Y)")
                                    : (selectedPassYn === "N" ? getText("Below criteria (N)") : getText("All pairs"));
                                const maxMetricValue = selectedPassYn === "Y"
                                    ? item.MAX_METRIC_VALUE
                                    : item.MAX_ANY_METRIC_VALUE;
                                const maxMetricText = selectedPassYn === "N"
                                    ? ""
                                    : ` · ${this.escapeHtml(getText("max"))} ${this.formatDecimal(maxMetricValue)}`;
                                return `
                                    <button type="button" class="${selectedType === normalizedType ? "is-active" : ""}" onclick="${PAGE_CODE}.selectRelationSummaryType('${this.escapeJs(normalizedType)}')">
                                        <b>${this.formatNumber(filteredPairCount)}</b>
                                        <small>${this.escapeHtml(this.getRelationTypeLabel(item.RELATION_TYPE))}</small>
                                        <em>${this.escapeHtml(filteredCountLabel)}${maxMetricText}</em>
                                    </button>
                                `;
                            }).join("")}
                        </div>
                    ` : ""}
                    <div class="anly-work-relation-detail-panel">
                        <header>
                            <strong>${selectedType === "ALL" ? this.escapeHtml(getText("All relation types")) : this.escapeHtml(this.getRelationTypeLabel(selectedType))}</strong>
                            ${selectedType !== "ALL" ? `<button type="button" onclick="${PAGE_CODE}.selectRelationSummaryType('ALL')">${this.escapeHtml(getText("Show all"))}</button>` : ""}
                        </header>
                        <div>
                            <strong>${this.escapeHtml(getText("Related columns"))}</strong>
                            <div class="anly-work-corr-tags">
                                ${visibleColumns.map((column) => this.renderColumnChip(column, summary)).join("")}
                                ${hiddenCount ? `<em class="anly-work-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                                ${!visibleColumns.length ? `<em class="anly-work-column-chip">${this.escapeHtml(getText("No related columns."))}</em>` : ""}
                            </div>
                        </div>
                        <div>
                            <strong>${this.escapeHtml(selectedPassYn === "Y" ? getText("Passed relation pairs") : (selectedPassYn === "N" ? getText("Pairs below the pass criteria") : getText("All relation pairs")))}</strong>
                            ${filteredPairs.length ? `
                                <div class="anly-work-relation-pair-list">
                                    ${filteredPairs.map((pair) => this.renderRelationSummaryPairRow(pair, summary, passCriteria)).join("")}
                                </div>
                            ` : `<div class="table-empty">${this.escapeHtml(getText("No relation pairs for the selected filter."))}</div>`}
                        </div>
                    </div>
                </section>
            `;
        },

        async selectRelationSummaryType(type) {
            const nextType = this.normalizeRelationType(type);
            this.relationSummaryFilter = this.relationSummaryFilter === nextType ? "ALL" : nextType;
            this.relationPairFilter = { passYn: this.relationPairFilter?.passYn || "" };
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        async selectRelationPassFilter(passYn = "ALL") {
            const normalized = ["Y", "N"].includes(String(passYn || "").toUpperCase())
                ? String(passYn).toUpperCase()
                : "ALL";
            this.relationPairFilter = {
                colA: "",
                colB: "",
                passYn: normalized === "ALL" ? "" : normalized
            };
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        normalizeRelationType(value) {
            const text = String(value || "").trim().toUpperCase();
            if (text === "NUMERIC_CATEGORICAL") return "CATEGORICAL_NUMERIC";
            return text || "ALL";
        },

        getRelationTypeOrder(value) {
            const orderMap = {
                CATEGORICAL_CATEGORICAL: 1,
                NUMERIC_NUMERIC: 2,
                CATEGORICAL_NUMERIC: 3
            };
            return orderMap[this.normalizeRelationType(value)] || 99;
        },

        sortRelationTypes(items = []) {
            return [...items].sort((a, b) =>
                this.getRelationTypeOrder(a.RELATION_TYPE) - this.getRelationTypeOrder(b.RELATION_TYPE)
                || String(a.RELATION_TYPE || "").localeCompare(String(b.RELATION_TYPE || ""), "ko-KR")
            );
        },

        sortRelationPairs(items = []) {
            return [...items].sort((a, b) =>
                this.getRelationTypeOrder(a.RELATION_TYPE) - this.getRelationTypeOrder(b.RELATION_TYPE)
                || Number((b.ABS_METRIC_VALUE ?? b.SORT_METRIC_VALUE) || 0) - Number((a.ABS_METRIC_VALUE ?? a.SORT_METRIC_VALUE) || 0)
                || String(a.COL_A || "").localeCompare(String(b.COL_A || ""), "ko-KR", { numeric: true })
                || String(a.COL_B || "").localeCompare(String(b.COL_B || ""), "ko-KR", { numeric: true })
            );
        },

        getRepresentativeColumnPairs(items = []) {
            const representativeMap = new Map();
            this.sortRelationPairs(items).forEach((pair) => {
                const colA = String(pair.COL_A || "").trim();
                const colB = String(pair.COL_B || "").trim();
                if (!colA || !colB) return;
                const ordered = [colA.toUpperCase(), colB.toUpperCase()].sort();
                const key = `${this.normalizeRelationType(pair.RELATION_TYPE)}|${ordered[0]}|${ordered[1]}`;
                if (!representativeMap.has(key)) representativeMap.set(key, pair);
            });
            return [...representativeMap.values()];
        },

        isColumnPairFilterActive(filter = {}, colA = "", colB = "") {
            const leftA = String(filter?.colA || "").trim().toUpperCase();
            const leftB = String(filter?.colB || "").trim().toUpperCase();
            const rightA = String(colA || "").trim().toUpperCase();
            const rightB = String(colB || "").trim().toUpperCase();
            if (!leftA || !leftB || !rightA || !rightB) return false;
            return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
        },

        hasActiveRelationGridFilter() {
            const filter = this.getActiveRelationGridFilter();
            return Boolean(
                filter.relationType
                || filter.passYn
                || (filter.colA && filter.colB)
            );
        },

        getActiveRelationGridFilter() {
            const filter = this.relationPairFilter || {};
            const summaryType = this.normalizeRelationType(this.relationSummaryFilter || "ALL");
            const activeFilter = {};
            if (summaryType && summaryType !== "ALL") {
                activeFilter.relationType = summaryType;
            }
            if (filter.relationType) {
                activeFilter.relationType = this.normalizeRelationType(filter.relationType);
            }
            if (filter.passYn) {
                activeFilter.passYn = String(filter.passYn).trim().toUpperCase();
            }
            if (filter.colA && filter.colB) {
                activeFilter.colA = filter.colA;
                activeFilter.colB = filter.colB;
            }
            return activeFilter;
        },

        getRelationDetailColumns(summary = {}, selectedType = "ALL", pairs = [], selectedPassYn = "Y") {
            if (selectedPassYn !== "Y") {
                const pairColumns = [];
                pairs.forEach((pair) => {
                    [pair.COL_A, pair.COL_B].forEach((column) => {
                        const text = String(column || "").trim();
                        if (text && !pairColumns.includes(text)) pairColumns.push(text);
                    });
                });
                if (pairColumns.length) return pairColumns.sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true }));
            }
            const relationTypeColumns = Array.isArray(summary.relationTypeColumns) ? summary.relationTypeColumns : [];
            const selectedColumns = [];
            relationTypeColumns.forEach((item) => {
                const type = this.normalizeRelationType(item.RELATION_TYPE);
                const column = String(item.COLUMN_NAME || "").trim();
                if (!column || (selectedType !== "ALL" && type !== selectedType)) return;
                if (!selectedColumns.includes(column)) selectedColumns.push(column);
            });
            if (selectedColumns.length) {
                return selectedColumns.sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true }));
            }
            const fallback = [];
            pairs.forEach((pair) => {
                [pair.COL_A, pair.COL_B].forEach((column) => {
                    const text = String(column || "").trim();
                    if (text && !fallback.includes(text)) fallback.push(text);
                });
            });
            if (fallback.length) {
                return fallback.sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true }));
            }
            return Array.isArray(summary.associatedColumns) ? summary.associatedColumns : [];
        },

        renderRelationSummaryPairRow(pair, summary, criteria = {}) {
            const colA = String(pair.COL_A || "").trim();
            const colB = String(pair.COL_B || "").trim();
            const active = this.isColumnPairFilterActive(this.relationPairFilter, colA, colB);
            const passYn = String(pair.PASS_YN || "N").toUpperCase() === "Y" ? "Y" : "N";
            const failureReasons = passYn === "N" ? this.getRelationFailureReasons(pair, criteria) : [];
            return `
                <button type="button" class="${active ? "is-active" : ""} ${passYn === "N" ? "is-no-relation" : "is-passed-relation"}" data-anly-filter="relation-pair" data-col-a="${this.escapeHtml(colA)}" data-col-b="${this.escapeHtml(colB)}" onclick="${PAGE_CODE}.selectRelationPairFilter('${this.escapeJs(colA)}', '${this.escapeJs(colB)}', '${this.escapeJs(this.normalizeRelationType(pair.RELATION_TYPE))}', '${passYn}')">
                    <span class="anly-work-relation-pair-col is-left">${this.renderColumnAwareCell(colA, summary)}</span>
                    <i aria-hidden="true">↔</i>
                    <span class="anly-work-relation-pair-col is-right">${this.renderColumnAwareCell(colB, summary)}</span>
                    <small><b>PASS_YN=${passYn}</b> · ${this.escapeHtml(this.getRelationTypeLabel(pair.RELATION_TYPE))} · ${this.escapeHtml(pair.METRIC_NAME || "")} ${this.formatDecimal(pair.METRIC_VALUE)} · |metric| ${this.formatDecimal(pair.ABS_METRIC_VALUE)} · p ${pair.P_VALUE === null || pair.P_VALUE === undefined ? "-" : this.formatDecimal(pair.P_VALUE)} · n ${this.formatNumber(pair.ROW_COUNT)}${failureReasons.length ? `<em>${this.escapeHtml(failureReasons.join(" · "))}</em>` : ""}</small>
                </button>
            `;
        },

        getActualRelationPassCriteria(node = this.selectedNode) {
            const readNumber = (name, fallback) => {
                const value = Number(this.getNodeActualAnalysisParamValue(name, fallback, node));
                return Number.isFinite(value) ? value : fallback;
            };
            return {
                minMetric: readNumber("P_MIN_METRIC", 0.65),
                minCramer: readNumber("P_MIN_CRAMER", 0.3),
                minAbsCorr: readNumber("P_MIN_ABS_CORR", 0.6),
                minEta: readNumber("P_MIN_ETA", 0.65),
                minPvalue: readNumber("P_MIN_PVALUE", 0.05),
                minRows: Math.max(4, Math.trunc(readNumber("P_MIN_ROWS", 30)))
            };
        },

        getRelationFailureReasons(pair = {}, criteria = {}) {
            const reasons = [];
            const relationType = this.normalizeRelationType(pair.RELATION_TYPE);
            const metricName = String(pair.METRIC_NAME || "").trim().toUpperCase();
            const metricValue = Number(pair.ABS_METRIC_VALUE);
            const pValue = pair.P_VALUE === null || pair.P_VALUE === undefined ? null : Number(pair.P_VALUE);
            const rowCount = Number(pair.ROW_COUNT || 0);
            let metricThreshold = Number(criteria.minMetric ?? 0.65);
            let strictMetric = false;
            if (relationType === "CATEGORICAL_CATEGORICAL") {
                metricThreshold = Number(criteria.minCramer ?? 0.3);
                strictMetric = true;
            } else if (relationType === "NUMERIC_NUMERIC" && metricName === "PEARSON_R") {
                metricThreshold = Number(criteria.minAbsCorr ?? 0.6);
            } else if (relationType === "CATEGORICAL_NUMERIC") {
                metricThreshold = Number(criteria.minEta ?? 0.65);
            }
            if (!Number.isFinite(metricValue) || (strictMetric ? metricValue <= metricThreshold : metricValue < metricThreshold)) {
                reasons.push(getText("Metric below threshold: {value} {operator} {threshold}", {
                    value: Number.isFinite(metricValue) ? this.formatDecimal(metricValue) : "-",
                    operator: strictMetric ? "≤" : "<",
                    threshold: this.formatDecimal(metricThreshold)
                }));
            }
            if (relationType !== "CATEGORICAL_NUMERIC" && (pValue === null || !Number.isFinite(pValue) || pValue >= Number(criteria.minPvalue ?? 0.05))) {
                reasons.push(getText("P-value threshold not met: {value} >= {threshold}", {
                    value: pValue === null || !Number.isFinite(pValue) ? "-" : this.formatDecimal(pValue),
                    threshold: this.formatDecimal(criteria.minPvalue ?? 0.05)
                }));
            }
            if (relationType !== "CATEGORICAL_CATEGORICAL" && (!Number.isFinite(rowCount) || rowCount < Number(criteria.minRows ?? 30))) {
                reasons.push(getText("Insufficient valid rows: {value} < {threshold}", {
                    value: Number.isFinite(rowCount) ? this.formatNumber(rowCount) : "-",
                    threshold: this.formatNumber(criteria.minRows ?? 30)
                }));
            }
            return reasons.length ? reasons : [getText("Stored as PASS_YN=N by the analysis procedure.")];
        },

        renderRelationNoPairRow(relationType, typeInfo = {}) {
            const normalizedType = this.normalizeRelationType(relationType);
            const active = this.relationPairFilter?.relationType === normalizedType
                && this.relationPairFilter?.passYn === "N";
            return `
                <button type="button" class="${active ? "is-active" : ""} is-no-relation" data-anly-filter="relation-no-pair" data-relation-type="${this.escapeHtml(normalizedType)}" onclick="${PAGE_CODE}.selectRelationNoPairFilter('${this.escapeJs(normalizedType)}')">
                    <span class="anly-work-relation-pair-col is-left">
                        <span class="anly-work-column-ref"><b>${this.escapeHtml(this.getRelationTypeLabel(normalizedType))}</b><small>${this.escapeHtml(getText("No relation"))}</small></span>
                    </span>
                    <i aria-hidden="true">∅</i>
                    <span class="anly-work-relation-pair-col is-right">
                        <span class="anly-work-column-ref"><b>${this.formatNumber(typeInfo.TOTAL_PAIR_COUNT || 0)}</b><small>${this.escapeHtml(getText("candidate pairs"))}</small></span>
                    </span>
                    <small>${this.escapeHtml(getText("Click to show non-passed rows in the grid."))}</small>
                </button>
            `;
        },

        async selectRelationPairFilter(colA = "", colB = "", relationType = "ALL", passYn = "") {
            const nextA = String(colA || "").trim();
            const nextB = String(colB || "").trim();
            if (!nextA || !nextB || this.isColumnPairFilterActive(this.relationPairFilter, nextA, nextB)) {
                this.relationPairFilter = { passYn: this.relationPairFilter?.passYn || "" };
            } else {
                this.relationPairFilter = { colA: nextA, colB: nextB, passYn: ["Y", "N"].includes(passYn) ? passYn : "" };
            }
            this.updateResultFilterButtonStates();
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        async selectRelationNoPairFilter(relationType = "ALL") {
            const normalizedType = this.normalizeRelationType(relationType);
            const active = this.relationPairFilter?.relationType === normalizedType
                && this.relationPairFilter?.passYn === "N";
            this.relationPairFilter = active
                ? { colA: "", colB: "" }
                : { colA: "", colB: "", relationType: normalizedType, passYn: "N", noRelation: true };
            this.updateResultFilterButtonStates();
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        renderRelationNetworkSummary(summary, json = {}) {
            if (!summary) return "";
            this.lastRelationNetworkSummary = summary;
            const clusters = this.buildRelationNetworkClusters(summary);
            const validClusterIds = new Set(clusters.map((cluster) => cluster.id));
            const selectedClusterId = validClusterIds.has(this.getActiveRelationNetworkClusterId())
                ? this.getActiveRelationNetworkClusterId()
                : "ALL";
            const topEdges = this.getRepresentativeColumnPairs(this.sortRelationPairs([
                ...(Array.isArray(summary.edges) ? summary.edges : []),
                ...(Array.isArray(summary.topEdges) ? summary.topEdges : [])
            ]));
            const visibleEdges = selectedClusterId === "ALL"
                ? topEdges
                : topEdges.filter((edge) => this.getRelationClusterId(edge.CLUSTER_ID) === selectedClusterId);
            const detailColumns = this.getRelationNetworkDetailColumns(summary, selectedClusterId, visibleEdges, clusters);
            const visibleColumns = detailColumns.slice(0, 80);
            const hiddenCount = Math.max(0, detailColumns.length - visibleColumns.length);
            return `
                <section class="anly-work-corr-summary anly-work-network-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(getText("Relation Network Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · graph cluster basis", { target: `${summary.targetOwner}.${summary.targetTable}` }))}</span>
                        </div>
                        <div class="anly-work-type-summary-actions">
                            <div class="anly-work-corr-metrics">
                                <span><b>${this.formatNumber(summary.nodeCount)}</b><small>${this.escapeHtml(getText("Nodes"))}</small></span>
                                <span><b>${this.formatNumber(summary.edgeCount)}</b><small>${this.escapeHtml(getText("Edges"))}</small></span>
                                <span><b>${this.formatNumber(summary.clusterCount)}</b><small>${this.escapeHtml(getText("Clusters"))}</small></span>
                                <span><b>${this.formatDecimal(summary.maxMetricValue)}</b><small>${this.escapeHtml(getText("Max metric"))}</small></span>
                            </div>
                            ${this.renderTableResultPageTools("networkResultPage", json)}
                        </div>
                    </header>
                    <div class="anly-work-network-action-row">
                        <p>${this.escapeHtml(getText("Network clusters are grouped by strongly connected relation edges. Use the graph view to inspect the full connection shape."))}</p>
                        <button type="button" class="anly-work-network-graph-button" onclick="${PAGE_CODE}.openRelationNetworkPopup()" title="${this.escapeHtml(getText("View network graph"))}">
                            <i class="fas fa-project-diagram"></i>
                            <span>${this.escapeHtml(getText("Network Graph"))}</span>
                        </button>
                    </div>
                    ${this.renderRelationNetworkDetailSwitcher()}
                    ${clusters.length ? `
                        <div class="anly-work-network-cluster-grid">
                            ${clusters.map((cluster) => {
                                const active = selectedClusterId === cluster.id;
                                return `
                                <button type="button" class="${active ? "is-active" : ""}" data-anly-filter="network-cluster" data-cluster-id="${this.escapeHtml(cluster.id)}" onclick="${PAGE_CODE}.selectRelationNetworkClusterFilter('${this.escapeJs(cluster.id)}')">
                                    <header>
                                        <strong>${this.escapeHtml(getText("Cluster {cluster}", { cluster: cluster.id }))}</strong>
                                        <span>${this.formatNumber(cluster.nodeCount)} ${this.escapeHtml(getText("nodes"))} · ${this.formatNumber(cluster.edgeCount)} ${this.escapeHtml(getText("edges"))}</span>
                                    </header>
                                    <div class="anly-work-corr-tags">
                                        ${cluster.nodes.slice(0, 8).map((node) => this.renderColumnChip(node.COLUMN_NAME, summary)).join("")}
                                        ${cluster.nodes.length > 8 ? `<em class="anly-work-column-chip">+${this.formatNumber(cluster.nodes.length - 8)} more</em>` : ""}
                                    </div>
                                    <footer>
                                        <span>${this.escapeHtml(getText("degree"))} ${this.formatNumber(cluster.degreeCount)}</span>
                                        <span>${this.escapeHtml(getText("centrality"))} ${this.formatDecimal(cluster.maxCentralityScore)}</span>
                                    </footer>
                                </button>
                                `;
                            }).join("")}
                        </div>
                    ` : ""}
                    <div class="anly-work-relation-detail-panel">
                        <header>
                            <strong>${this.escapeHtml(selectedClusterId === "ALL" ? getText("All clusters") : getText("Cluster {cluster}", { cluster: selectedClusterId }))}</strong>
                            ${selectedClusterId !== "ALL" ? `<button type="button" onclick="${PAGE_CODE}.selectRelationNetworkClusterFilter('ALL')">${this.escapeHtml(getText("Show all"))}</button>` : ""}
                        </header>
                        <div>
                            <strong>${this.escapeHtml(getText("Related columns"))}</strong>
                            <div class="anly-work-corr-tags">
                                ${visibleColumns.map((column) => this.renderColumnChip(column, summary)).join("")}
                                ${hiddenCount ? `<em class="anly-work-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                                ${!visibleColumns.length ? `<em class="anly-work-column-chip">${this.escapeHtml(getText("No related columns."))}</em>` : ""}
                            </div>
                        </div>
                        <div>
                            <strong>${this.escapeHtml(getText("Network relation pairs"))}</strong>
                            ${visibleEdges.length ? `
                                <div class="anly-work-relation-pair-list">
                                    ${visibleEdges.map((edge) => this.renderRelationNetworkPairRow(edge, summary)).join("")}
                                </div>
                            ` : `<div class="table-empty">${this.escapeHtml(getText("No network edges to display."))}</div>`}
                        </div>
                    </div>
                </section>
            `;
        },

        renderRelationNetworkDetailSwitcher() {
            const results = this.getRelationNetworkResultObjects();
            if (results.length < 2) return "";
            const activeName = String(this.selectedNode?.RESULT_OBJECT_NAME || "").trim().toUpperCase();
            return `
                <nav class="anly-work-network-detail-switcher" aria-label="${this.escapeHtml(getText("Network detail data"))}">
                    <strong>${this.escapeHtml(getText("Network detail data"))}</strong>
                    <div>
                        ${results.map((item) => {
                            const objectName = String(item?.objectName || "").trim().toUpperCase();
                            const active = objectName === activeName;
                            return `<button type="button" class="${active ? "is-active" : ""}" onclick="${PAGE_CODE}.selectRelationNetworkDetail('${this.escapeJs(objectName)}')">
                                <i class="fas fa-${objectName.endsWith("_NODE") ? "circle" : "link"}"></i>
                                <span>${this.escapeHtml(this.getNodeResultLabel(item))}</span>
                            </button>`;
                        }).join("")}
                    </div>
                </nav>
            `;
        },

        getActiveRelationNetworkClusterId() {
            const clusterId = this.getRelationClusterId(this.relationNetworkClusterFilter);
            return clusterId && clusterId !== "-" ? clusterId : "ALL";
        },

        getActiveRelationNetworkGridFilter() {
            const filter = {};
            const clusterId = this.getActiveRelationNetworkClusterId();
            const pairFilter = this.relationNetworkPairFilter || {};
            if (clusterId && clusterId !== "ALL") {
                filter.clusterId = clusterId;
            }
            if (pairFilter.colA && pairFilter.colB) {
                filter.colA = pairFilter.colA;
                filter.colB = pairFilter.colB;
                if (pairFilter.clusterId && !filter.clusterId) {
                    filter.clusterId = this.getRelationClusterId(pairFilter.clusterId);
                }
            }
            return filter;
        },

        getRelationNetworkDetailColumns(summary = {}, selectedClusterId = "ALL", edges = [], clusters = []) {
            const columns = [];
            const addColumn = (value) => {
                const column = String(value || "").trim();
                if (column && !columns.includes(column)) columns.push(column);
            };
            clusters.forEach((cluster) => {
                if (selectedClusterId !== "ALL" && cluster.id !== selectedClusterId) return;
                (cluster.nodes || []).forEach((node) => addColumn(node.COLUMN_NAME));
            });
            edges.forEach((edge) => {
                addColumn(edge.COL_A);
                addColumn(edge.COL_B);
            });
            if (!columns.length && Array.isArray(summary.nodes)) {
                summary.nodes.forEach((node) => {
                    if (selectedClusterId !== "ALL" && this.getRelationClusterId(node.CLUSTER_ID) !== selectedClusterId) return;
                    addColumn(node.COLUMN_NAME);
                });
            }
            return columns.sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true }));
        },

        renderRelationNetworkPairRow(edge, summary) {
            const colA = String(edge.COL_A || "").trim();
            const colB = String(edge.COL_B || "").trim();
            const clusterId = this.getRelationClusterId(edge.CLUSTER_ID);
            const active = this.isRelationNetworkPairFilterActive(colA, colB, clusterId);
            return `
                <button type="button" class="${active ? "is-active" : ""}" data-anly-filter="network-pair" data-col-a="${this.escapeHtml(colA)}" data-col-b="${this.escapeHtml(colB)}" data-cluster-id="${this.escapeHtml(clusterId)}" onclick="${PAGE_CODE}.selectRelationNetworkPairFilter('${this.escapeJs(colA)}', '${this.escapeJs(colB)}', '${this.escapeJs(clusterId)}')">
                    <span class="anly-work-relation-pair-col is-left">${this.renderColumnAwareCell(colA, summary)}</span>
                    <i aria-hidden="true">↔</i>
                    <span class="anly-work-relation-pair-col is-right">${this.renderColumnAwareCell(colB, summary)}</span>
                    <small>${this.escapeHtml(this.getRelationTypeLabel(edge.RELATION_TYPE))} · ${this.escapeHtml(edge.METRIC_NAME || "")} ${this.formatDecimal(edge.METRIC_VALUE)} · |metric| ${this.formatDecimal(edge.ABS_METRIC_VALUE)} · ${this.escapeHtml(getText("Cluster {cluster}", { cluster: clusterId }))}</small>
                </button>
            `;
        },

        isRelationNetworkPairFilterActive(colA = "", colB = "", clusterId = "") {
            const filter = this.relationNetworkPairFilter || {};
            const filterCluster = this.getRelationClusterId(filter.clusterId);
            const targetCluster = this.getRelationClusterId(clusterId);
            return this.isColumnPairFilterActive(filter, colA, colB)
                && (!filterCluster || filterCluster === "-" || !targetCluster || targetCluster === "-" || filterCluster === targetCluster);
        },

        async selectRelationNetworkClusterFilter(clusterId = "ALL") {
            const nextClusterId = this.getRelationClusterId(clusterId);
            this.relationNetworkClusterFilter = this.getActiveRelationNetworkClusterId() === nextClusterId ? "ALL" : nextClusterId;
            this.relationNetworkPairFilter = { clusterId: "", colA: "", colB: "" };
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        async selectRelationNetworkPairFilter(colA = "", colB = "", clusterId = "") {
            const nextA = String(colA || "").trim();
            const nextB = String(colB || "").trim();
            const nextClusterId = this.getRelationClusterId(clusterId);
            if (!nextA || !nextB || this.isRelationNetworkPairFilterActive(nextA, nextB, nextClusterId)) {
                this.relationNetworkPairFilter = { clusterId: "", colA: "", colB: "" };
            } else {
                this.relationNetworkPairFilter = { clusterId: nextClusterId, colA: nextA, colB: nextB };
            }
            this.updateResultFilterButtonStates();
            await this.refreshResultGridOnly(1);
        },

        getRelationTypeLabel(value) {
            const text = this.normalizeRelationType(value);
            const labels = {
                NUMERIC_NUMERIC: "Numeric-Numeric",
                CATEGORICAL_CATEGORICAL: "Categorical-Categorical",
                CATEGORICAL_NUMERIC: "Categorical-Numeric"
            };
            return getText(labels[text] || text || "-");
        },

        getRelationClusterId(value) {
            const text = String(value ?? "").trim();
            return text || "-";
        },

        buildRelationNetworkClusters(summary = {}) {
            const nodes = Array.isArray(summary.nodes) ? summary.nodes : [];
            const edges = Array.isArray(summary.edges) ? summary.edges : [];
            const topClusters = Array.isArray(summary.topClusters) ? summary.topClusters : [];
            const clusterMap = new Map();
            const ensureCluster = (clusterId) => {
                const id = this.getRelationClusterId(clusterId);
                if (!clusterMap.has(id)) {
                    clusterMap.set(id, {
                        id,
                        nodeCount: 0,
                        edgeCount: 0,
                        degreeCount: 0,
                        maxCentralityScore: 0,
                        nodes: []
                    });
                }
                return clusterMap.get(id);
            };
            topClusters.forEach((item) => {
                const cluster = ensureCluster(item.CLUSTER_ID);
                cluster.nodeCount = Math.max(cluster.nodeCount, Number(item.NODE_COUNT || 0));
                cluster.degreeCount = Math.max(cluster.degreeCount, Number(item.DEGREE_COUNT || 0));
                cluster.maxCentralityScore = Math.max(cluster.maxCentralityScore, Number(item.MAX_CENTRALITY_SCORE || 0));
            });
            nodes.forEach((node) => {
                const cluster = ensureCluster(node.CLUSTER_ID);
                cluster.nodes.push(node);
                cluster.nodeCount = Math.max(cluster.nodeCount, cluster.nodes.length, Number(node.NODE_COUNT || 0));
                cluster.degreeCount += Number(node.DEGREE_COUNT || 0);
                cluster.maxCentralityScore = Math.max(cluster.maxCentralityScore, Number(node.CENTRALITY_SCORE || 0));
            });
            edges.forEach((edge) => {
                ensureCluster(edge.CLUSTER_ID).edgeCount += 1;
            });
            clusterMap.forEach((cluster) => {
                if (cluster.nodes.length) {
                    cluster.nodeCount = Math.max(cluster.nodeCount, cluster.nodes.length);
                    cluster.degreeCount = cluster.nodes.reduce((sum, node) => sum + Number(node.DEGREE_COUNT || 0), 0);
                    cluster.maxCentralityScore = cluster.nodes.reduce((max, node) => Math.max(max, Number(node.CENTRALITY_SCORE || 0)), 0);
                }
            });
            return [...clusterMap.values()]
                .sort((a, b) => (b.nodeCount - a.nodeCount) || String(a.id).localeCompare(String(b.id), "ko-KR", { numeric: true }))
                .slice(0, 12);
        },

        buildRelationNetworkGraphData(summary = {}) {
            const rawNodes = Array.isArray(summary.nodes) ? summary.nodes : [];
            const rawEdges = Array.isArray(summary.edges) ? summary.edges : [];
            const nodeMap = new Map();
            const addNode = (name, clusterId = "-", source = {}) => {
                const nodeName = String(name || "").trim();
                if (!nodeName) return;
                const existing = nodeMap.get(nodeName) || {
                    name: nodeName,
                    clusterId: this.getRelationClusterId(clusterId),
                    columnType: "",
                    comment: this.getColumnComment(nodeName, summary),
                    degree: 0,
                    centrality: 0
                };
                existing.clusterId = this.getRelationClusterId(clusterId ?? existing.clusterId);
                existing.columnType = String(source.COLUMN_TYPE || existing.columnType || "");
                existing.comment = String(source.COLUMN_COMMENT || existing.comment || this.getColumnComment(nodeName, summary) || "").trim();
                existing.degree = Math.max(existing.degree, Number(source.DEGREE_COUNT || 0));
                existing.centrality = Math.max(existing.centrality, Number(source.CENTRALITY_SCORE || 0));
                nodeMap.set(nodeName, existing);
            };
            rawNodes.forEach((node) => addNode(node.COLUMN_NAME, node.CLUSTER_ID, node));
            rawEdges.forEach((edge) => {
                addNode(edge.COL_A, edge.CLUSTER_ID);
                addNode(edge.COL_B, edge.CLUSTER_ID);
            });
            const nodes = [...nodeMap.values()]
                .sort((a, b) => String(a.clusterId).localeCompare(String(b.clusterId), "ko-KR", { numeric: true }) || (b.centrality - a.centrality) || (b.degree - a.degree) || a.name.localeCompare(b.name))
                .slice(0, 120);
            const nodeNames = new Set(nodes.map((node) => node.name));
            const edges = rawEdges
                .map((edge) => ({
                    source: String(edge.COL_A || "").trim(),
                    target: String(edge.COL_B || "").trim(),
                    clusterId: this.getRelationClusterId(edge.CLUSTER_ID),
                    relationType: String(edge.RELATION_TYPE || ""),
                    metricName: String(edge.METRIC_NAME || ""),
                    metricValue: Number(edge.METRIC_VALUE || 0),
                    weight: Number(edge.ABS_METRIC_VALUE || 0)
                }))
                .filter((edge) => edge.source && edge.target && nodeNames.has(edge.source) && nodeNames.has(edge.target))
                .slice(0, 240);
            const clusterIds = [...new Set(nodes.map((node) => node.clusterId))]
                .sort((a, b) => String(a).localeCompare(String(b), "ko-KR", { numeric: true }));
            return {
                nodes,
                edges,
                clusterIds,
                maxMetric: Math.max(0.0001, ...edges.map((edge) => edge.weight || 0))
            };
        },

        calculateRelationNetworkGraphPositions(graph = {}, summary = {}, width = 920, height = 560, clusterCenters = new Map(), clusterNodeMap = new Map()) {
            const palette = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#be123c", "#4f46e5", "#65a30d", "#9333ea", "#0f766e", "#ea580c"];
            const margin = 64;
            const graphNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
            const layoutNodes = graphNodes.map((node, index) => {
                const clusterId = this.getRelationClusterId(node.clusterId);
                const clusterNodes = clusterNodeMap.get(clusterId) || [];
                const clusterIndex = Math.max(0, clusterNodes.findIndex((item) => String(item.name) === String(node.name)));
                const center = clusterCenters.get(clusterId) || { x: width / 2, y: height / 2, color: palette[index % palette.length] };
                const comment = String(node.comment || this.getColumnComment(node.name, summary) || "").trim();
                const labelChars = Math.max(String(node.name || "").length, comment.length);
                const ringRadius = clusterNodes.length <= 1
                    ? 18
                    : Math.min(176, Math.max(86, 52 + (clusterNodes.length * 15) + Math.min(46, labelChars * 1.2)));
                const angle = clusterNodes.length <= 1
                    ? ((index * 2.399963229728653) - Math.PI / 2)
                    : (((Math.PI * 2 * clusterIndex) / Math.max(1, clusterNodes.length)) - Math.PI / 2);
                return {
                    node,
                    name: String(node.name || ""),
                    clusterId,
                    color: center.color,
                    x: center.x + Math.cos(angle) * ringRadius,
                    y: center.y + Math.sin(angle) * ringRadius,
                    vx: 0,
                    vy: 0,
                    labelSize: Math.min(170, Math.max(92, (Math.min(24, labelChars) * 7) + 28))
                };
            });
            const nodeByName = new Map(layoutNodes.map((item) => [item.name, item]));
            const layoutEdges = (Array.isArray(graph.edges) ? graph.edges : [])
                .map((edge) => ({
                    edge,
                    source: nodeByName.get(String(edge.source || "")),
                    target: nodeByName.get(String(edge.target || "")),
                    weight: Math.max(0.05, Number(edge.weight || 0) / Math.max(0.0001, Number(graph.maxMetric || 1)))
                }))
                .filter((item) => item.source && item.target && item.source !== item.target);
            const iterations = Math.min(220, Math.max(100, layoutNodes.length * 12));
            for (let step = 0; step < iterations; step += 1) {
                const alpha = 1 - (step / iterations);
                for (let i = 0; i < layoutNodes.length; i += 1) {
                    for (let j = i + 1; j < layoutNodes.length; j += 1) {
                        const a = layoutNodes[i];
                        const b = layoutNodes[j];
                        let dx = b.x - a.x;
                        let dy = b.y - a.y;
                        let distance = Math.hypot(dx, dy);
                        if (distance < 0.01) {
                            dx = ((i + 1) * 0.37) - ((j + 1) * 0.19);
                            dy = ((j + 1) * 0.29) - ((i + 1) * 0.11);
                            distance = Math.hypot(dx, dy) || 1;
                        }
                        const sameCluster = a.clusterId === b.clusterId;
                        const minDistance = sameCluster
                            ? Math.max(96, (a.labelSize + b.labelSize) * 0.42)
                            : Math.max(122, (a.labelSize + b.labelSize) * 0.48);
                        const repel = (sameCluster ? 8200 : 11800) * alpha / Math.max(distance * distance, 1);
                        const collision = distance < minDistance ? ((minDistance - distance) * 0.035 * alpha) : 0;
                        const force = repel + collision;
                        const fx = (dx / distance) * force;
                        const fy = (dy / distance) * force;
                        a.vx -= fx;
                        a.vy -= fy;
                        b.vx += fx;
                        b.vy += fy;
                    }
                }
                layoutEdges.forEach(({ source, target, weight }) => {
                    const dx = target.x - source.x;
                    const dy = target.y - source.y;
                    const distance = Math.hypot(dx, dy) || 1;
                    const desired = source.clusterId === target.clusterId ? 142 : 188;
                    const force = ((distance - desired) * (0.006 + (weight * 0.006))) * alpha;
                    const fx = (dx / distance) * force;
                    const fy = (dy / distance) * force;
                    source.vx += fx;
                    source.vy += fy;
                    target.vx -= fx;
                    target.vy -= fy;
                });
                layoutNodes.forEach((item) => {
                    const center = clusterCenters.get(item.clusterId) || { x: width / 2, y: height / 2 };
                    item.vx += (center.x - item.x) * 0.010 * alpha;
                    item.vy += (center.y - item.y) * 0.010 * alpha;
                    item.vx *= 0.74;
                    item.vy *= 0.74;
                    item.x = Math.min(width - margin, Math.max(margin, item.x + item.vx));
                    item.y = Math.min(height - margin, Math.max(margin, item.y + item.vy));
                });
            }
            const positions = new Map();
            layoutNodes.forEach((item) => {
                const center = clusterCenters.get(item.clusterId) || { x: width / 2, y: height / 2 };
                positions.set(item.name, {
                    x: item.x,
                    y: item.y,
                    angle: Math.atan2(item.y - center.y, item.x - center.x),
                    color: item.color
                });
            });
            return positions;
        },

        renderRelationNetworkGraphSvg(summary = {}, graphInput = null) {
            const graph = graphInput || this.buildRelationNetworkGraphData(summary);
            if (!graph.nodes.length) {
                return `<div class="table-empty">${this.escapeHtml(getText("No network nodes to display."))}</div>`;
            }
            const width = 920;
            const height = 560;
            const centerX = width / 2;
            const centerY = height / 2;
            const palette = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#be123c", "#4f46e5", "#65a30d", "#9333ea", "#0f766e", "#ea580c"];
            const clusterCenters = new Map();
            const outerRadiusX = Math.max(160, width * 0.33);
            const outerRadiusY = Math.max(110, height * 0.27);
            graph.clusterIds.forEach((clusterId, index) => {
                const angle = graph.clusterIds.length === 1 ? -Math.PI / 2 : ((Math.PI * 2 * index) / graph.clusterIds.length) - Math.PI / 2;
                clusterCenters.set(clusterId, {
                    x: graph.clusterIds.length === 1 ? centerX : centerX + Math.cos(angle) * outerRadiusX,
                    y: graph.clusterIds.length === 1 ? centerY : centerY + Math.sin(angle) * outerRadiusY,
                    color: palette[index % palette.length]
                });
            });
            const clusterNodeMap = new Map();
            graph.nodes.forEach((node) => {
                if (!clusterNodeMap.has(node.clusterId)) clusterNodeMap.set(node.clusterId, []);
                clusterNodeMap.get(node.clusterId).push(node);
            });
            const nodeClusterByName = new Map(graph.nodes.map((node) => [String(node.name), String(node.clusterId)]));
            const positions = this.calculateRelationNetworkGraphPositions(graph, summary, width, height, clusterCenters, clusterNodeMap);
            const edgeLines = graph.edges.map((edge) => {
                const from = positions.get(edge.source);
                const to = positions.get(edge.target);
                if (!from || !to) return "";
                const widthValue = 1 + Math.min(4, ((edge.weight || 0) / graph.maxMetric) * 4);
                const metricText = `${edge.metricName} ${this.formatDecimal(edge.metricValue)} · |metric| ${this.formatDecimal(edge.weight)}`;
                const title = `${edge.source} ↔ ${edge.target} · ${this.getRelationTypeLabel(edge.relationType)} · ${metricText}`;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const distance = Math.max(1, Math.hypot(dx, dy));
                const labelText = `${edge.metricName} ${this.formatDecimal(edge.weight)}`;
                const labelWidth = Math.min(150, Math.max(64, (labelText.length * 5.8) + 16));
                const labelHeight = 18;
                const labelX = ((from.x + to.x) / 2) + ((-dy / distance) * 16);
                const labelY = ((from.y + to.y) / 2) + ((dx / distance) * 16);
                const showEdgeLabel = graph.edges.length <= 10 && distance >= 150;
                const sourceCluster = nodeClusterByName.get(String(edge.source)) || String(edge.clusterId);
                const targetCluster = nodeClusterByName.get(String(edge.target)) || String(edge.clusterId);
                return `
                    <g class="edge-group" data-anly-network-edge-source-cluster="${this.escapeHtml(sourceCluster)}" data-anly-network-edge-target-cluster="${this.escapeHtml(targetCluster)}">
                    <line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="#64748b" stroke-width="${widthValue.toFixed(2)}" stroke-opacity="0.42">
                        <title>${this.escapeHtml(title)}</title>
                    </line>
                    ${showEdgeLabel ? `
                        <g class="edge-label-pill">
                            <rect x="${(labelX - (labelWidth / 2)).toFixed(1)}" y="${(labelY - (labelHeight / 2)).toFixed(1)}" width="${labelWidth.toFixed(1)}" height="${labelHeight}" rx="9"></rect>
                            <text class="edge-label" x="${labelX.toFixed(1)}" y="${(labelY + 3.5).toFixed(1)}">${this.escapeHtml(labelText)}</text>
                        </g>
                    ` : ""}
                    </g>
                `;
            }).join("");
            const clusterBubbles = graph.clusterIds.map((clusterId) => {
                const center = clusterCenters.get(clusterId);
                const nodes = clusterNodeMap.get(clusterId) || [];
                const radius = Math.min(240, Math.max(96, nodes.reduce((max, node) => {
                    const pos = positions.get(node.name);
                    if (!pos) return max;
                    return Math.max(max, Math.hypot(pos.x - center.x, pos.y - center.y) + 58);
                }, 96)));
                return `
                    <g data-anly-network-cluster-group="${this.escapeHtml(clusterId)}">
                        <circle cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" r="${radius}" fill="${center.color}" fill-opacity="0.055" stroke="${center.color}" stroke-opacity="0.2" stroke-width="1.5"></circle>
                        <text x="${center.x.toFixed(1)}" y="${(center.y - radius - 10).toFixed(1)}" class="cluster-label" text-anchor="middle" fill="${center.color}">${this.escapeHtml(getText("Cluster {cluster}", { cluster: clusterId }))}</text>
                    </g>
                `;
            }).join("");
            const nodeLabels = graph.nodes.map((node, index) => {
                const pos = positions.get(node.name);
                if (!pos) return "";
                const radius = Math.max(5, Math.min(13, 5 + Math.sqrt(Number(node.degree || 0))));
                const label = node.name.length > 18 ? `${node.name.slice(0, 17)}...` : node.name;
                const comment = String(node.comment || this.getColumnComment(node.name, summary) || "").trim();
                const commentLabel = comment.length > 18 ? `${comment.slice(0, 17)}...` : comment;
                const showLabel = graph.nodes.length <= 60 || index < 36;
                const angle = Number.isFinite(pos.angle) ? pos.angle : 0;
                const horizontal = Math.cos(angle);
                const vertical = Math.sin(angle);
                const labelWidth = Math.min(142, Math.max(68, (Math.max(label.length, commentLabel.length) * 7) + 18));
                const labelHeight = commentLabel ? 34 : 21;
                let textAnchor = "start";
                let labelX = pos.x + radius + 9;
                let labelY = pos.y + 4;
                let rectX = labelX - 7;
                if (Math.abs(horizontal) < 0.32) {
                    textAnchor = "middle";
                    labelX = pos.x;
                    labelY = pos.y + (vertical >= 0 ? radius + 24 : -radius - 15);
                    rectX = labelX - (labelWidth / 2);
                } else if (horizontal < 0) {
                    textAnchor = "end";
                    labelX = pos.x - radius - 9;
                    labelY = pos.y + 4;
                    rectX = labelX - labelWidth + 7;
                }
                const rectY = labelY - 15;
                const title = [
                    node.name,
                    comment,
                    `${getText("Cluster {cluster}", { cluster: node.clusterId })}`,
                    `${getText("degree")} ${this.formatNumber(node.degree)}`,
                    `${getText("centrality")} ${this.formatDecimal(node.centrality)}`
                ].filter(Boolean).join(" · ");
                return `
                    <g data-anly-network-cluster-node="${this.escapeHtml(node.clusterId)}">
                        <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${pos.color}" stroke="#ffffff" stroke-width="2">
                            <title>${this.escapeHtml(title)}</title>
                        </circle>
                        ${showLabel ? `
                            <g class="node-label">
                                <rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${labelWidth.toFixed(1)}" height="${labelHeight}" rx="4"></rect>
                                <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${textAnchor}">
                                    <tspan>${this.escapeHtml(label)}</tspan>
                                    ${commentLabel ? `<tspan class="node-comment" x="${labelX.toFixed(1)}" dy="13">${this.escapeHtml(commentLabel)}</tspan>` : ""}
                                </text>
                            </g>
                        ` : ""}
                    </g>
                `;
            }).join("");
            return `
                <div class="anly-work-network-graph-shell">
                    ${this.renderRelationNetworkGraphClusterLegend(graph)}
                    <div class="anly-work-network-graph-tools">
                        <button type="button" onclick="${PAGE_CODE}.zoomRelationNetworkGraph(1.16)" title="${this.escapeHtml(getText("Zoom in"))}"><i class="fas fa-search-plus"></i></button>
                        <button type="button" onclick="${PAGE_CODE}.zoomRelationNetworkGraph(0.86)" title="${this.escapeHtml(getText("Zoom out"))}"><i class="fas fa-search-minus"></i></button>
                        <button type="button" onclick="${PAGE_CODE}.resetRelationNetworkGraphView()" title="${this.escapeHtml(getText("Reset view"))}"><i class="fas fa-compress-arrows-alt"></i></button>
                        <button type="button" data-anly-network-maximize-btn onclick="${PAGE_CODE}.toggleRelationNetworkGraphMaximize()" title="${this.escapeHtml(getText("Maximize graph"))}" aria-pressed="false"><i class="fas fa-expand"></i></button>
                        <span data-anly-network-zoom-label>100%</span>
                    </div>
                    <svg class="anly-work-network-svg" data-anly-network-svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escapeHtml(getText("Relation network graph"))}">
                        <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="#f8fafc" stroke="#dbe3ef"></rect>
                        <g data-anly-network-viewport>
                            ${clusterBubbles}
                            ${edgeLines}
                            ${nodeLabels}
                        </g>
                    </svg>
                    <div class="anly-work-network-cluster-empty" data-anly-network-cluster-empty hidden>${this.escapeHtml(getText("Select at least one cluster to display the graph."))}</div>
                </div>
            `;
        },

        renderRelationNetworkGraphClusterLegend(graph = {}) {
            const clusterIds = Array.isArray(graph.clusterIds) ? graph.clusterIds.map((clusterId) => String(clusterId)) : [];
            if (!clusterIds.length) return "";
            const palette = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#be123c", "#4f46e5", "#65a30d", "#9333ea", "#0f766e", "#ea580c"];
            const selected = this.getRelationNetworkGraphVisibleClusters(clusterIds);
            return `
                <div class="anly-work-network-cluster-legend" aria-label="${this.escapeHtml(getText("Cluster visibility"))}">
                    <div class="anly-work-network-cluster-legend-actions">
                        <strong>${this.escapeHtml(getText("Clusters"))}</strong>
                        <button type="button" onclick="${PAGE_CODE}.setAllRelationNetworkGraphClusters(true)" title="${this.escapeHtml(getText("Select all clusters"))}" aria-label="${this.escapeHtml(getText("Select all clusters"))}"><i class="fas fa-check-double"></i></button>
                        <button type="button" onclick="${PAGE_CODE}.setAllRelationNetworkGraphClusters(false)" title="${this.escapeHtml(getText("Clear all clusters"))}" aria-label="${this.escapeHtml(getText("Clear all clusters"))}"><i class="fas fa-square"></i></button>
                        <small data-anly-network-cluster-count>${this.escapeHtml(getText("{selected} / {total} selected", { selected: selected.size, total: clusterIds.length }))}</small>
                    </div>
                    <div class="anly-work-network-cluster-legend-items">
                        ${clusterIds.map((clusterId, index) => `
                            <label class="${selected.has(clusterId) ? "is-active" : ""}" style="--anly-cluster-color: ${palette[index % palette.length]};">
                                <input type="checkbox" data-anly-network-cluster-checkbox value="${this.escapeHtml(clusterId)}" ${selected.has(clusterId) ? "checked" : ""} onchange="${PAGE_CODE}.toggleRelationNetworkGraphCluster('${this.escapeJs(clusterId)}', this.checked)">
                                <i aria-hidden="true"></i>
                                <span>${this.escapeHtml(getText("Cluster {cluster}", { cluster: clusterId }))}</span>
                            </label>
                        `).join("")}
                    </div>
                </div>
            `;
        },

        getRelationNetworkGraphVisibleClusters(clusterIds = this.relationNetworkGraphClusterIds || []) {
            const validIds = [...new Set((clusterIds || []).map((clusterId) => String(clusterId)))];
            const validSet = new Set(validIds);
            if (!(this.relationNetworkGraphVisibleClusters instanceof Set)) {
                this.relationNetworkGraphVisibleClusters = new Set(validIds);
            } else {
                this.relationNetworkGraphVisibleClusters = new Set(
                    [...this.relationNetworkGraphVisibleClusters].map(String).filter((clusterId) => validSet.has(clusterId))
                );
            }
            this.relationNetworkGraphClusterIds = validIds;
            return this.relationNetworkGraphVisibleClusters;
        },

        toggleRelationNetworkGraphCluster(clusterId = "", visible = true) {
            const normalized = String(clusterId);
            const selected = this.getRelationNetworkGraphVisibleClusters();
            if (visible) selected.add(normalized);
            else selected.delete(normalized);
            // Filtering a cluster must not recalculate the viewport. Preserve the
            // user's current wheel/pinch zoom and pan position while elements hide/show.
            this.applyRelationNetworkGraphClusterVisibility({ fit: false });
        },

        setAllRelationNetworkGraphClusters(visible = true) {
            const clusterIds = this.relationNetworkGraphClusterIds || [];
            this.relationNetworkGraphVisibleClusters = new Set(visible ? clusterIds.map(String) : []);
            this.applyRelationNetworkGraphClusterVisibility({ fit: false });
        },

        applyRelationNetworkGraphClusterVisibility({ fit = true } = {}) {
            const { popup } = this.getRelationNetworkGraphElements();
            if (!popup) return;
            const clusterIds = this.relationNetworkGraphClusterIds || [];
            const selected = this.getRelationNetworkGraphVisibleClusters(clusterIds);
            popup.querySelectorAll("[data-anly-network-cluster-checkbox]").forEach((input) => {
                const checked = selected.has(String(input.value));
                input.checked = checked;
                input.closest("label")?.classList.toggle("is-active", checked);
            });
            popup.querySelectorAll("[data-anly-network-cluster-group]").forEach((element) => {
                element.classList.toggle("is-cluster-hidden", !selected.has(String(element.dataset.anlyNetworkClusterGroup)));
            });
            popup.querySelectorAll("[data-anly-network-cluster-node]").forEach((element) => {
                element.classList.toggle("is-cluster-hidden", !selected.has(String(element.dataset.anlyNetworkClusterNode)));
            });
            popup.querySelectorAll("[data-anly-network-edge-source-cluster]").forEach((element) => {
                const sourceVisible = selected.has(String(element.dataset.anlyNetworkEdgeSourceCluster));
                const targetVisible = selected.has(String(element.dataset.anlyNetworkEdgeTargetCluster));
                element.classList.toggle("is-cluster-hidden", !(sourceVisible && targetVisible));
            });
            const count = popup.querySelector("[data-anly-network-cluster-count]");
            if (count) {
                count.textContent = getText("{selected} / {total} selected", { selected: selected.size, total: clusterIds.length });
            }
            const empty = popup.querySelector("[data-anly-network-cluster-empty]");
            if (empty) empty.hidden = selected.size > 0;
            if (fit && selected.size > 0) {
                window.requestAnimationFrame(() => this.fitRelationNetworkGraphToStage());
            }
        },

        renderRelationNetworkPopupOverview(summary = {}, graph = {}) {
            return `
                <div class="anly-work-network-insight-grid" aria-label="${this.escapeHtml(getText("Network overview"))}">
                    <span><b>${this.formatNumber(summary.nodeCount ?? graph.nodes?.length ?? 0)}</b><small>${this.escapeHtml(getText("Nodes"))}</small></span>
                    <span><b>${this.formatNumber(summary.edgeCount ?? graph.edges?.length ?? 0)}</b><small>${this.escapeHtml(getText("Edges"))}</small></span>
                    <span><b>${this.formatNumber(summary.clusterCount ?? graph.clusterIds?.length ?? 0)}</b><small>${this.escapeHtml(getText("Clusters"))}</small></span>
                    <span><b>${this.formatDecimal(summary.maxMetricValue)}</b><small>${this.escapeHtml(getText("Max metric"))}</small></span>
                    <span><b>${this.formatDecimal(summary.averageMetricValue)}</b><small>${this.escapeHtml(getText("Metric average"))}</small></span>
                </div>
            `;
        },

        renderRelationNetworkPopupClusterList(clusters = [], summary = {}) {
            if (!clusters.length) return `<em>${this.escapeHtml(getText("No cluster information."))}</em>`;
            return clusters.map((cluster) => {
                const columns = (cluster.nodes || [])
                    .map((node) => String(node.COLUMN_NAME || "").trim())
                    .filter(Boolean)
                    .slice(0, 6);
                return `
                    <span>
                        <b>${this.escapeHtml(getText("Cluster {cluster}", { cluster: cluster.id }))}</b>
                        <small>${this.formatNumber(cluster.nodeCount)} ${this.escapeHtml(getText("nodes"))} · ${this.formatNumber(cluster.edgeCount)} ${this.escapeHtml(getText("edges"))} · ${this.escapeHtml(getText("centrality"))} ${this.formatDecimal(cluster.maxCentralityScore)}</small>
                        ${columns.length ? `<i>${columns.map((column) => this.renderColumnChip(column, summary)).join("")}</i>` : ""}
                    </span>
                `;
            }).join("");
        },

        renderRelationNetworkPopupNodeCards(summary = {}, graph = {}) {
            const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
            if (!nodes.length) return `<div class="table-empty">${this.escapeHtml(getText("No network nodes to display."))}</div>`;
            return `
                <div class="anly-work-network-node-list">
                    ${nodes.slice(0, 48).map((node) => `
                        <span class="anly-work-network-node-card">
                            ${this.renderColumnAwareCell(node.name, summary)}
                            <small>${this.escapeHtml(this.getRelationTypeLabel(node.columnType || "-"))} · ${this.escapeHtml(getText("Cluster {cluster}", { cluster: node.clusterId }))}</small>
                            <em>${this.escapeHtml(getText("degree"))} ${this.formatNumber(node.degree)} · ${this.escapeHtml(getText("centrality"))} ${this.formatDecimal(node.centrality)}</em>
                        </span>
                    `).join("")}
                </div>
            `;
        },

        renderRelationNetworkPopupEdgeTable(summary = {}, graph = {}) {
            const edges = Array.isArray(graph.edges) ? graph.edges : [];
            if (!edges.length) return `<div class="table-empty">${this.escapeHtml(getText("No network edges to display."))}</div>`;
            return `
                <div class="anly-work-network-edge-table-wrap">
                    <table class="table-grid anly-work-network-edge-table">
                        <thead>
                            <tr>
                                <th>${this.escapeHtml(getText("Cluster"))}</th>
                                <th>${this.escapeHtml(getText("Column A"))}</th>
                                <th>${this.escapeHtml(getText("Column B"))}</th>
                                <th>${this.escapeHtml(getText("Relation type"))}</th>
                                <th>${this.escapeHtml(getText("Metric"))}</th>
                                <th>${this.escapeHtml(getText("Metric value"))}</th>
                                <th>${this.escapeHtml(getText("Abs metric"))}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${edges.slice(0, 120).map((edge) => `
                                <tr>
                                    <td>${this.escapeHtml(edge.clusterId)}</td>
                                    <td>${this.renderColumnAwareCell(edge.source, summary)}</td>
                                    <td>${this.renderColumnAwareCell(edge.target, summary)}</td>
                                    <td>${this.escapeHtml(this.getRelationTypeLabel(edge.relationType))}</td>
                                    <td>${this.escapeHtml(edge.metricName || "")}</td>
                                    <td>${this.formatDecimal(edge.metricValue)}</td>
                                    <td>${this.formatDecimal(edge.weight)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        openRelationNetworkPopup() {
            const summary = this.lastRelationNetworkSummary || this.lastResultTableJson?.relationNetworkSummary;
            if (!summary) {
                alert(getText("Network summary information could not be found."));
                return;
            }
            this.closeRelationNetworkPopup();
            const graph = this.buildRelationNetworkGraphData(summary);
            this.relationNetworkGraphClusterIds = [...graph.clusterIds].map(String);
            this.relationNetworkGraphVisibleClusters = new Set(this.relationNetworkGraphClusterIds);
            const popup = document.createElement("div");
            popup.id = `${PAGE_ID_PREFIX}RelationNetworkPopup`;
            popup.className = "anly-work-symbolic-popup anly-work-relation-network-popup";
            popup.innerHTML = this.renderRelationNetworkPopup(summary, graph);
            document.body.appendChild(popup);
            this.initRelationNetworkGraphInteraction();
            this.applyRelationNetworkGraphClusterVisibility({ fit: false });
        },

        closeRelationNetworkPopup() {
            if (typeof this.relationNetworkGraphCleanup === "function") {
                this.relationNetworkGraphCleanup();
                this.relationNetworkGraphCleanup = null;
            }
            const popup = document.getElementById(`${PAGE_ID_PREFIX}RelationNetworkPopup`);
            if (popup) popup.remove();
            this.relationNetworkGraphClusterIds = [];
            this.relationNetworkGraphVisibleClusters = null;
        },

        getRelationNetworkGraphElements() {
            const popup = document.getElementById(`${PAGE_ID_PREFIX}RelationNetworkPopup`);
            const svg = popup?.querySelector("[data-anly-network-svg]");
            const viewport = popup?.querySelector("[data-anly-network-viewport]");
            const zoomLabel = popup?.querySelector("[data-anly-network-zoom-label]");
            return { popup, svg, viewport, zoomLabel };
        },

        getRelationNetworkGraphPoint(event, svg) {
            const rect = svg.getBoundingClientRect();
            const viewBox = svg.viewBox.baseVal;
            const scaleX = viewBox.width / Math.max(1, rect.width);
            const scaleY = viewBox.height / Math.max(1, rect.height);
            return {
                x: viewBox.x + ((event.clientX - rect.left) * scaleX),
                y: viewBox.y + ((event.clientY - rect.top) * scaleY),
                scaleX,
                scaleY
            };
        },

        clampRelationNetworkGraphView(view = {}, svg = null) {
            const viewBox = svg?.viewBox?.baseVal;
            const width = Number(viewBox?.width || 920);
            const height = Number(viewBox?.height || 560);
            const scale = Math.min(4, Math.max(0.45, Number(view.scale || 1)));
            const maxX = width * Math.max(1, scale);
            const maxY = height * Math.max(1, scale);
            return {
                scale,
                x: Math.min(maxX, Math.max(-maxX, Number(view.x || 0))),
                y: Math.min(maxY, Math.max(-maxY, Number(view.y || 0)))
            };
        },

        applyRelationNetworkGraphTransform() {
            const { svg, viewport, zoomLabel } = this.getRelationNetworkGraphElements();
            if (!svg || !viewport) return;
            this.relationNetworkGraphView = this.clampRelationNetworkGraphView(this.relationNetworkGraphView || {}, svg);
            const view = this.relationNetworkGraphView;
            viewport.setAttribute("transform", `translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.scale.toFixed(4)})`);
            if (zoomLabel) zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
        },

        fitRelationNetworkGraphToStage() {
            const { svg, viewport } = this.getRelationNetworkGraphElements();
            if (!svg || !viewport) return;
            const viewBox = svg.viewBox.baseVal;
            let bbox = null;
            try {
                bbox = viewport.getBBox();
            } catch (error) {
                bbox = null;
            }
            if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
                this.relationNetworkGraphView = { scale: 1, x: 0, y: 0 };
                this.applyRelationNetworkGraphTransform();
                return;
            }
            const padding = 54;
            const availableWidth = Math.max(1, viewBox.width - (padding * 2));
            const availableHeight = Math.max(1, viewBox.height - (padding * 2));
            const scale = Math.min(
                1,
                Math.max(0.45, Math.min(availableWidth / bbox.width, availableHeight / bbox.height))
            );
            this.relationNetworkGraphView = {
                scale,
                x: (viewBox.x + (viewBox.width / 2)) - ((bbox.x + (bbox.width / 2)) * scale),
                y: (viewBox.y + (viewBox.height / 2)) - ((bbox.y + (bbox.height / 2)) * scale)
            };
            this.applyRelationNetworkGraphTransform();
        },

        zoomRelationNetworkGraph(factor = 1, anchor = null) {
            const { svg } = this.getRelationNetworkGraphElements();
            if (!svg) return;
            const view = this.relationNetworkGraphView || { scale: 1, x: 0, y: 0 };
            const oldScale = Number(view.scale || 1);
            const nextScale = Math.min(4, Math.max(0.45, oldScale * Number(factor || 1)));
            const viewBox = svg.viewBox.baseVal;
            const point = anchor || {
                x: viewBox.x + (viewBox.width / 2),
                y: viewBox.y + (viewBox.height / 2)
            };
            this.relationNetworkGraphView = {
                scale: nextScale,
                x: point.x - (((point.x - Number(view.x || 0)) / oldScale) * nextScale),
                y: point.y - (((point.y - Number(view.y || 0)) / oldScale) * nextScale)
            };
            this.applyRelationNetworkGraphTransform();
        },

        resetRelationNetworkGraphView() {
            this.fitRelationNetworkGraphToStage();
        },

        toggleRelationNetworkGraphMaximize(force = null) {
            const { popup } = this.getRelationNetworkGraphElements();
            if (!popup) return;
            const nextMaximized = typeof force === "boolean"
                ? force
                : !popup.classList.contains("is-network-graph-maximized");
            popup.classList.toggle("is-network-graph-maximized", nextMaximized);
            const button = popup.querySelector("[data-anly-network-maximize-btn]");
            if (button) {
                button.setAttribute("aria-pressed", nextMaximized ? "true" : "false");
                button.title = getText(nextMaximized ? "Restore graph" : "Maximize graph");
                const icon = button.querySelector("i");
                if (icon) {
                    icon.className = nextMaximized ? "fas fa-compress" : "fas fa-expand";
                }
            }
            requestAnimationFrame(() => this.fitRelationNetworkGraphToStage());
        },

        initRelationNetworkGraphInteraction() {
            if (typeof this.relationNetworkGraphCleanup === "function") {
                this.relationNetworkGraphCleanup();
                this.relationNetworkGraphCleanup = null;
            }
            const { svg } = this.getRelationNetworkGraphElements();
            if (!svg) return;
            this.relationNetworkGraphView = { scale: 1, x: 0, y: 0 };
            const activePointers = new Map();
            let dragState = null;
            let pinchState = null;
            const getPointerPair = () => [...activePointers.values()].slice(0, 2);
            const getMidpoint = (first, second) => ({
                clientX: (first.clientX + second.clientX) / 2,
                clientY: (first.clientY + second.clientY) / 2
            });
            const beginPan = (pointer) => {
                if (!pointer) {
                    dragState = null;
                    return;
                }
                const point = this.getRelationNetworkGraphPoint(pointer, svg);
                const view = this.relationNetworkGraphView || { scale: 1, x: 0, y: 0 };
                dragState = {
                    pointerId: pointer.pointerId,
                    startClientX: pointer.clientX,
                    startClientY: pointer.clientY,
                    scaleX: point.scaleX,
                    scaleY: point.scaleY,
                    startX: Number(view.x || 0),
                    startY: Number(view.y || 0)
                };
                pinchState = null;
            };
            const beginPinch = () => {
                const [first, second] = getPointerPair();
                if (!first || !second) return;
                const midpoint = getMidpoint(first, second);
                const anchor = this.getRelationNetworkGraphPoint(midpoint, svg);
                const view = this.relationNetworkGraphView || { scale: 1, x: 0, y: 0 };
                pinchState = {
                    pointerIds: [first.pointerId, second.pointerId],
                    startDistance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
                    startMidpoint: midpoint,
                    anchor,
                    startScale: Number(view.scale || 1),
                    startX: Number(view.x || 0),
                    startY: Number(view.y || 0)
                };
                dragState = null;
                svg.classList.add("is-pinching");
            };
            const onWheel = (event) => {
                event.preventDefault();
                const point = this.getRelationNetworkGraphPoint(event, svg);
                this.zoomRelationNetworkGraph(event.deltaY < 0 ? 1.12 : 0.89, point);
            };
            const onPointerDown = (event) => {
                if (event.pointerType === "mouse" && event.button !== 0) return;
                event.preventDefault();
                activePointers.set(event.pointerId, {
                    pointerId: event.pointerId,
                    clientX: event.clientX,
                    clientY: event.clientY
                });
                svg.classList.add("is-dragging");
                svg.setPointerCapture?.(event.pointerId);
                if (activePointers.size >= 2) beginPinch();
                else beginPan(activePointers.get(event.pointerId));
            };
            const onPointerMove = (event) => {
                if (!activePointers.has(event.pointerId)) return;
                event.preventDefault();
                activePointers.set(event.pointerId, {
                    pointerId: event.pointerId,
                    clientX: event.clientX,
                    clientY: event.clientY
                });
                if (activePointers.size >= 2) {
                    const [first, second] = getPointerPair();
                    if (!pinchState || !pinchState.pointerIds.every((pointerId) => activePointers.has(pointerId))) {
                        beginPinch();
                    }
                    const currentMidpoint = getMidpoint(first, second);
                    const currentDistance = Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY));
                    const startScale = Math.max(0.0001, Number(pinchState.startScale || 1));
                    const nextScale = Math.min(4, Math.max(0.45, startScale * (currentDistance / pinchState.startDistance)));
                    this.relationNetworkGraphView = {
                        scale: nextScale,
                        x: pinchState.anchor.x - (((pinchState.anchor.x - pinchState.startX) / startScale) * nextScale)
                            + ((currentMidpoint.clientX - pinchState.startMidpoint.clientX) * pinchState.anchor.scaleX),
                        y: pinchState.anchor.y - (((pinchState.anchor.y - pinchState.startY) / startScale) * nextScale)
                            + ((currentMidpoint.clientY - pinchState.startMidpoint.clientY) * pinchState.anchor.scaleY)
                    };
                    this.applyRelationNetworkGraphTransform();
                    return;
                }
                if (!dragState || dragState.pointerId !== event.pointerId) beginPan(activePointers.get(event.pointerId));
                this.relationNetworkGraphView = {
                    ...(this.relationNetworkGraphView || { scale: 1 }),
                    x: dragState.startX + ((event.clientX - dragState.startClientX) * dragState.scaleX),
                    y: dragState.startY + ((event.clientY - dragState.startClientY) * dragState.scaleY)
                };
                this.applyRelationNetworkGraphTransform();
            };
            const stopPointer = (event) => {
                if (!activePointers.has(event.pointerId)) return;
                activePointers.delete(event.pointerId);
                try {
                    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
                } catch (error) {
                    // Pointer capture may already be released by the browser.
                }
                pinchState = null;
                svg.classList.remove("is-pinching");
                if (activePointers.size === 1) beginPan([...activePointers.values()][0]);
                else if (activePointers.size === 0) {
                    dragState = null;
                    svg.classList.remove("is-dragging");
                } else {
                    beginPinch();
                }
                event.preventDefault();
            };
            svg.addEventListener("wheel", onWheel, { passive: false });
            svg.addEventListener("pointerdown", onPointerDown);
            svg.addEventListener("pointermove", onPointerMove);
            svg.addEventListener("pointerup", stopPointer);
            svg.addEventListener("pointercancel", stopPointer);
            svg.addEventListener("lostpointercapture", stopPointer);
            this.relationNetworkGraphCleanup = () => {
                activePointers.clear();
                svg.removeEventListener("wheel", onWheel);
                svg.removeEventListener("pointerdown", onPointerDown);
                svg.removeEventListener("pointermove", onPointerMove);
                svg.removeEventListener("pointerup", stopPointer);
                svg.removeEventListener("pointercancel", stopPointer);
                svg.removeEventListener("lostpointercapture", stopPointer);
            };
            requestAnimationFrame(() => this.fitRelationNetworkGraphToStage());
        },

        renderRelationNetworkPopup(summary = {}, graphInput = null) {
            const clusters = this.buildRelationNetworkClusters(summary);
            const graph = graphInput || this.buildRelationNetworkGraphData(summary);
            return `
                <section>
                    <header class="anly-work-sql-popup-title" onmousedown="${PAGE_CODE}.startRelationNetworkPopupDrag(event)">
                        <div>
                            <span>${this.escapeHtml(getText("Network Graph"))}</span>
                            <span>${this.escapeHtml(`${summary.targetOwner || ""}.${summary.targetTable || ""}`)}</span>
                        </div>
                        <button type="button" title="Close" onclick="${PAGE_CODE}.closeRelationNetworkPopup()"><i class="fas fa-times"></i></button>
                    </header>
                    <div class="anly-work-relation-network-popup-body">
                        <aside>
                            <strong>${this.escapeHtml(getText("Clusters"))}</strong>
                            ${this.renderRelationNetworkPopupClusterList(clusters, summary)}
                        </aside>
                        <div class="anly-work-relation-network-main">
                            ${this.renderRelationNetworkPopupOverview(summary, graph)}
                            <div class="anly-work-relation-network-graph-stage">
                                ${this.renderRelationNetworkGraphSvg(summary, graph)}
                            </div>
                            <div class="anly-work-network-detail-panels">
                                <section>
                                    <strong>${this.escapeHtml(getText("Column details"))}</strong>
                                    ${this.renderRelationNetworkPopupNodeCards(summary, graph)}
                                </section>
                                <section>
                                    <strong>${this.escapeHtml(getText("Edge raw data"))}</strong>
                                    ${this.renderRelationNetworkPopupEdgeTable(summary, graph)}
                                </section>
                            </div>
                        </div>
                    </div>
                </section>
            `;
        },

        startRelationNetworkPopupDrag(event) {
            const popup = document.getElementById(`${PAGE_ID_PREFIX}RelationNetworkPopup`);
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

        getActualClusterUsage(node = this.selectedNode) {
            const runOutput = this.normalizeObject(node?.RUN_OUTPUT || node?.runOutput);
            const apiResult = this.normalizeObject(runOutput?.apiResult || runOutput?.API_RESULT);
            const direct = this.normalizeObject(apiResult?.clusterUsage);
            if (Object.keys(direct).length) return direct;
            const results = Array.isArray(apiResult?.results) ? apiResult.results : [];
            const nested = results
                .map((item) => this.normalizeObject(item?.clusterUsage))
                .find((item) => Object.keys(item).length);
            return nested || {};
        },

        getClusterNode(summary = {}, columnName = "") {
            const normalized = String(columnName || "").trim().toUpperCase();
            return this.normalizeObject(summary?.clusterContext?.nodes?.[normalized]);
        },

        getClusterScopeLabel(scope = "") {
            const labels = {
                SAME_CLUSTER: getText("Same cluster"),
                CROSS_CLUSTER: getText("Cross cluster"),
                PARTIAL_CLUSTER: getText("Partially clustered"),
                UNCLUSTERED: getText("No cluster")
            };
            return labels[String(scope || "").trim().toUpperCase()] || getText("No cluster");
        },

        renderClusterUsageBadge() {
            const usage = this.getActualClusterUsage();
            if (String(usage.appliedYn || "N").toUpperCase() !== "Y") return "";
            const mode = String(usage.effectiveMode || usage.requestedMode || "").trim().toUpperCase();
            return `<span class="anly-work-cluster-usage-badge"><i class="fas fa-project-diagram"></i>${this.escapeHtml(getText("Cluster-aware rule discovery"))} · ${this.escapeHtml(mode)}</span>`;
        },

        renderColumnClusterBadge(clusterId, scope = "", title = "") {
            const normalizedScope = String(scope || "").trim().toUpperCase();
            const scopeLabel = normalizedScope ? this.getClusterScopeLabel(normalizedScope) : "";
            const clusterLabel = clusterId === undefined || clusterId === null || clusterId === ""
                ? getText("No cluster")
                : getText("Cluster {cluster}", { cluster: clusterId });
            const titleAttribute = title ? ` title="${this.escapeHtml(title)}"` : "";
            return `<span class="anly-work-column-cluster-badge is-${this.escapeHtml(normalizedScope.toLowerCase() || "unclustered")}"${titleAttribute}>${this.escapeHtml(clusterLabel)}${scopeLabel ? ` · ${this.escapeHtml(scopeLabel)}` : ""}</span>`;
        },

        renderLassoSummary(summary, json = {}) {
            if (!summary) return "";
            const overview = summary.overview || {};
            const topTargets = Array.isArray(summary.topTargets) ? summary.topTargets : [];
            const topFeatures = Array.isArray(summary.topFeatures) ? summary.topFeatures : [];
            const targetEligibility = Array.isArray(summary.targetEligibility) && summary.targetEligibility.length
                ? summary.targetEligibility
                : topTargets.map((item) => ({ ...item, ELIGIBILITY_STATUS: "ELIGIBLE" }));
            const symbolicCriteria = summary.symbolicCriteria || {};
            const minR2Score = Number(symbolicCriteria.minR2Score ?? 0.7);
            const maxAutoTargets = Number(symbolicCriteria.maxAutoTargets ?? 10);
            const autoTargetYn = String(symbolicCriteria.autoTargetYn || "N").toUpperCase() === "Y";
            const eligibilityCounts = targetEligibility.reduce((counts, item) => {
                const status = String(item.ELIGIBILITY_STATUS || "LASSO_UNAVAILABLE").toUpperCase();
                counts[status] = (counts[status] || 0) + 1;
                return counts;
            }, {});
            const filter = this.lassoSummaryFilter || {};
            const pairFilter = this.lassoPairFilter || {};
            const direction = String(filter.direction || "ALL").toUpperCase();
            const selectedTarget = String(filter.targetColumn || "").trim();
            const selectedFeature = String(pairFilter.featureName || "").trim();
            const visibleFeatures = topFeatures.filter((item) => {
                const targetColumn = String(item.TARGET_COLUMN || "").trim();
                const coefficient = Number(item.COEFFICIENT || 0);
                if (selectedTarget && targetColumn !== selectedTarget) return false;
                if (direction === "POSITIVE" && coefficient <= 0) return false;
                if (direction === "NEGATIVE" && coefficient >= 0) return false;
                return true;
            });
            return `
                <section class="anly-work-lasso-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(getText("LASSO Key Feature Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · based on coefficient absolute value and R2", { target: `${summary.targetOwner}.${summary.targetTable}` }))}</span>
                            ${this.renderClusterUsageBadge()}
                        </div>
                        <div class="anly-work-type-summary-actions">
                            <div class="anly-work-corr-metrics">
                                <span><b>${this.formatNumber(overview.TARGET_COLUMN_COUNT)}</b><small>target</small></span>
                                <span><b>${this.formatNumber(overview.SELECTED_FEATURE_COUNT)}</b><small>selected</small></span>
                                <span><b>${this.formatDecimal(overview.MAX_R2_SCORE)}</b><small>max R2</small></span>
                                <span><b>${this.formatDecimal(overview.MODEL_ALPHA)}</b><small>alpha</small></span>
                            </div>
                            ${this.renderTableResultPageTools("lassoResultPage", json)}
                        </div>
                    </header>
                    <div class="anly-work-lasso-direction-grid">
                        <button type="button" class="${direction === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectLassoDirectionFilter('ALL')">
                            <b>${this.formatNumber(overview.FEATURE_ROW_COUNT)}</b>
                            <small>${this.escapeHtml(getText("All feature rows"))}</small>
                        </button>
                        <button type="button" class="${direction === "SELECTED" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectLassoDirectionFilter('SELECTED')">
                            <b>${this.formatNumber(overview.SELECTED_FEATURE_COUNT)}</b>
                            <small>${this.escapeHtml(getText("Selected features"))}</small>
                        </button>
                        <button type="button" class="${direction === "POSITIVE" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectLassoDirectionFilter('POSITIVE')">
                            <b>${this.formatNumber(overview.POSITIVE_FEATURE_COUNT)}</b>
                            <small>${this.escapeHtml(getText("Positive coefficients"))}</small>
                        </button>
                        <button type="button" class="${direction === "NEGATIVE" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectLassoDirectionFilter('NEGATIVE')">
                            <b>${this.formatNumber(overview.NEGATIVE_FEATURE_COUNT)}</b>
                            <small>${this.escapeHtml(getText("Negative coefficients"))}</small>
                        </button>
                        <button type="button" disabled>
                            <b>${this.formatNumber(overview.FEATURE_NAME_COUNT)}</b>
                            <small>${this.escapeHtml(getText("Unique features"))}</small>
                        </button>
                    </div>
                    <div class="anly-work-lasso-criteria">
                        <div>
                            <strong>${this.escapeHtml(getText("Symbolic formula eligibility"))}</strong>
                            <span>${this.escapeHtml(autoTargetYn
                                ? getText("Actual run parameters: P_MIN_R2_SCORE={minR2} · P_MAX_AUTO_TARGETS={maxTargets}", {
                                    minR2: this.formatDecimal(minR2Score),
                                    maxTargets: this.formatNumber(maxAutoTargets)
                                })
                                : getText("Actual run parameter: P_MIN_R2_SCORE={minR2}", {
                                    minR2: this.formatDecimal(minR2Score)
                                }))}</span>
                        </div>
                        <div class="anly-work-lasso-criteria-counts">
                            <span class="is-eligible">${this.escapeHtml(getText("Formula target"))} <b>${this.formatNumber(eligibilityCounts.ELIGIBLE || 0)}</b></span>
                            <span class="is-r2-below">${this.escapeHtml(getText("Below R2"))} <b>${this.formatNumber(eligibilityCounts.R2_BELOW_THRESHOLD || 0)}</b></span>
                            ${autoTargetYn ? `<span class="is-auto-limit">${this.escapeHtml(getText("Outside automatic target range"))} <b>${this.formatNumber(eligibilityCounts.AUTO_TARGET_LIMIT || 0)}</b></span>` : ""}
                        </div>
                    </div>
                    <div class="anly-work-relation-detail-panel">
                        <header>
                            <strong>${this.escapeHtml(selectedFeature ? getText("Selected LASSO relation") : getText("LASSO feature relations"))}</strong>
                            ${selectedTarget || selectedFeature || direction !== "ALL" ? `<button type="button" onclick="${PAGE_CODE}.resetLassoSummaryFilters()">${this.escapeHtml(getText("Show all"))}</button>` : ""}
                        </header>
                        ${targetEligibility.length ? `
                            <div>
                                <strong>${this.escapeHtml(getText("Selection Result by Target"))}</strong>
                                <div class="anly-work-type-case-grid">
                                    ${targetEligibility.map((item) => {
                                        const targetColumn = String(item.TARGET_COLUMN || "").trim();
                                        const eligibility = this.getLassoTargetEligibility(item, minR2Score, maxAutoTargets);
                                        const disabled = ["AUTO_TARGET_LIMIT", "LASSO_UNAVAILABLE"].includes(eligibility.status);
                                        return `
                                            <button type="button" class="${selectedTarget === targetColumn ? "is-active" : ""} ${eligibility.className}" ${disabled ? "disabled" : ""} title="${this.escapeHtml(eligibility.description)}" onclick="${PAGE_CODE}.selectLassoTargetFilter('${this.escapeJs(targetColumn)}')">
                                                <b>${this.renderColumnAwareCell(targetColumn, summary)}</b>
                                                ${this.renderColumnClusterBadge(item.TARGET_CLUSTER_ID)}
                                                <span class="anly-work-lasso-eligibility">${this.escapeHtml(eligibility.label)}</span>
                                                <small>${this.formatNumber(item.SELECTED_FEATURE_COUNT || 0)} selected · R2 ${item.R2_SCORE === undefined || item.R2_SCORE === null ? "-" : this.formatDecimal(item.R2_SCORE)}</small>
                                                <em>${eligibility.description}</em>
                                            </button>
                                        `;
                                    }).join("")}
                                </div>
                            </div>
                        ` : ""}
                        <div>
                            <strong>${this.escapeHtml(getText("Selected feature pairs"))}</strong>
                            ${visibleFeatures.length ? `
                                <div class="anly-work-relation-pair-list">
                                    ${visibleFeatures.map((item) => this.renderLassoFeaturePairRow(item, summary)).join("")}
                                </div>
                            ` : `<div class="table-empty">${this.escapeHtml(getText("No LASSO feature rows to display."))}</div>`}
                        </div>
                    </div>
                </section>
            `;
        },

        getLassoTargetEligibility(item = {}, minR2Score = 0.7, maxAutoTargets = 10) {
            const status = String(item.ELIGIBILITY_STATUS || "LASSO_UNAVAILABLE").toUpperCase();
            const r2Score = item.R2_SCORE === undefined || item.R2_SCORE === null ? null : Number(item.R2_SCORE);
            const autoOrder = Number(item.AUTO_ORDER || 0);
            const definitions = {
                ELIGIBLE: {
                    label: getText("Formula generation target"),
                    className: "is-formula-eligible",
                    description: getText("Selected features and R2 satisfy the symbolic formula criteria.")
                },
                R2_BELOW_THRESHOLD: {
                    label: getText("Below R2 threshold"),
                    className: "is-formula-r2-below",
                    description: getText("LASSO R2 {r2} is below the formula threshold {minR2}.", {
                        r2: r2Score === null || !Number.isFinite(r2Score) ? "-" : this.formatDecimal(r2Score),
                        minR2: this.formatDecimal(minR2Score)
                    })
                },
                AUTO_TARGET_LIMIT: {
                    label: getText("Excluded by automatic target range"),
                    className: "is-formula-auto-limit",
                    description: getText("Automatic target order {order} exceeds the maximum {maxTargets}.", {
                        order: this.formatNumber(autoOrder),
                        maxTargets: this.formatNumber(maxAutoTargets)
                    })
                },
                NO_SELECTED_FEATURES: {
                    label: getText("No selected key features"),
                    className: "is-formula-no-feature",
                    description: getText("No non-zero LASSO feature was selected for this target.")
                },
                LASSO_UNAVAILABLE: {
                    label: getText("No LASSO result"),
                    className: "is-formula-unavailable",
                    description: getText("No LASSO target result was generated within the eligible automatic range.")
                }
            };
            return { status, ...(definitions[status] || definitions.LASSO_UNAVAILABLE) };
        },

        renderLassoFeaturePairRow(item, summary) {
            const targetColumn = String(item.TARGET_COLUMN || "").trim();
            const featureName = String(item.FEATURE_NAME || "").trim();
            const filter = this.lassoPairFilter || {};
            const active = String(filter.targetColumn || "").trim() === targetColumn
                && String(filter.featureName || "").trim() === featureName;
            const directionClass = Number(item.COEFFICIENT || 0) >= 0 ? "is-positive" : "is-negative";
            return `
                <button type="button" class="${active ? "is-active" : ""} ${directionClass}" data-anly-filter="lasso-pair" data-target-column="${this.escapeHtml(targetColumn)}" data-feature-name="${this.escapeHtml(featureName)}" onclick="${PAGE_CODE}.selectLassoFeatureFilter('${this.escapeJs(targetColumn)}', '${this.escapeJs(featureName)}')">
                    <span class="anly-work-relation-pair-col is-left">${this.renderColumnAwareCell(targetColumn, summary)}</span>
                    <i aria-hidden="true">↔</i>
                    <span class="anly-work-relation-pair-col is-right">${this.renderColumnAwareCell(featureName, summary)}</span>
                    <span class="anly-work-cluster-pair-info">
                        ${this.renderColumnClusterBadge(item.TARGET_CLUSTER_ID)}
                        ${this.renderColumnClusterBadge(item.FEATURE_CLUSTER_ID, item.CLUSTER_SCOPE)}
                    </span>
                    <small>coef ${this.formatDecimal(item.COEFFICIENT)} · |coef| ${this.formatDecimal(item.ABS_COEFFICIENT)} · rank ${this.formatNumber(item.RANK_NO)} · R2 ${this.formatDecimal(item.R2_SCORE)}</small>
                </button>
            `;
        },

        async selectLassoDirectionFilter(direction = "ALL") {
            const normalized = ["ALL", "SELECTED", "POSITIVE", "NEGATIVE"].includes(String(direction || "").toUpperCase())
                ? String(direction || "").toUpperCase()
                : "ALL";
            this.lassoSummaryFilter = {
                ...(this.lassoSummaryFilter || {}),
                direction: this.lassoSummaryFilter?.direction === normalized ? "ALL" : normalized,
                targetColumn: ""
            };
            this.lassoPairFilter = { targetColumn: "", featureName: "" };
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        async selectLassoTargetFilter(targetColumn = "") {
            const nextTarget = String(targetColumn || "").trim();
            const currentTarget = String(this.lassoSummaryFilter?.targetColumn || "").trim();
            this.lassoSummaryFilter = {
                ...(this.lassoSummaryFilter || {}),
                targetColumn: currentTarget === nextTarget ? "" : nextTarget
            };
            this.lassoPairFilter = { targetColumn: "", featureName: "" };
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        async selectLassoFeatureFilter(targetColumn = "", featureName = "") {
            const nextTarget = String(targetColumn || "").trim();
            const nextFeature = String(featureName || "").trim();
            const filter = this.lassoPairFilter || {};
            const active = String(filter.targetColumn || "").trim() === nextTarget
                && String(filter.featureName || "").trim() === nextFeature;
            this.lassoPairFilter = {
                targetColumn: active ? "" : nextTarget,
                featureName: active ? "" : nextFeature
            };
            this.updateResultFilterButtonStates();
            await this.refreshResultGridOnly(1);
        },

        async resetLassoSummaryFilters() {
            this.lassoSummaryFilter = { direction: "ALL", targetColumn: "" };
            this.lassoPairFilter = { targetColumn: "", featureName: "" };
            this.refreshTableResultSummary({ preserveScroll: true });
            await this.refreshResultGridOnly(1);
        },

        hasActiveLassoGridFilter() {
            const filter = this.getActiveLassoGridFilter();
            return Boolean(
                (filter.direction && filter.direction !== "ALL")
                || filter.targetColumn
                || filter.featureName
            );
        },

        getActiveLassoGridFilter() {
            const summaryFilter = this.lassoSummaryFilter || {};
            const pairFilter = this.lassoPairFilter || {};
            const direction = String(summaryFilter.direction || "ALL").trim().toUpperCase();
            const activeFilter = {
                direction: ["SELECTED", "POSITIVE", "NEGATIVE"].includes(direction) ? direction : "ALL",
                targetColumn: String(summaryFilter.targetColumn || "").trim(),
                featureName: ""
            };
            if (pairFilter.targetColumn) {
                activeFilter.targetColumn = String(pairFilter.targetColumn || "").trim();
            }
            if (pairFilter.featureName) {
                activeFilter.featureName = String(pairFilter.featureName || "").trim();
            }
            return activeFilter;
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
                <section class="anly-work-symbolic-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(getText("Symbolic Rule Formula Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · f(x)=y formula rules", { target: `${summary.targetOwner}.${summary.targetTable}` }))}</span>
                            ${this.renderClusterUsageBadge()}
                        </div>
                        <div class="anly-work-corr-metrics">
                            <span><b>${this.formatNumber(overview.RULE_COUNT)}</b><small>rules</small></span>
                            <span><b>${this.formatNumber(overview.SELECTED_RULE_COUNT)}</b><small>selected</small></span>
                            <span><b>${this.formatDecimal(overview.MAX_SCORE)}</b><small>max score</small></span>
                            <span><b>${this.formatDecimal(overview.AVG_COMPLEXITY)}</b><small>avg complexity</small></span>
                        </div>
                    </header>
                    <section class="anly-work-rule-facet-panel is-symbolic">
                        <div class="anly-work-rule-facet-block">
                            <header>
                                <strong>${this.escapeHtml(getText("Method Type"))}</strong>
                                <button type="button" onclick="${PAGE_CODE}.resetSymbolicRuleFilters()">Reset</button>
                            </header>
                            <div class="anly-work-rule-facet-list">
                                <button type="button" class="${methodFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('method', 'ALL')">
                                    <span>${this.escapeHtml(getText("All"))}</span>
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
                        <div class="anly-work-rule-facet-block is-condition">
                            <header><strong>${this.escapeHtml(getText("Y Result Column"))}</strong></header>
                            <div class="anly-work-rule-facet-list">
                                <button type="button" class="${targetFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('targetColumn', 'ALL')">
                                    <span>${this.escapeHtml(getText("All"))}</span>
                                    <b>${this.formatNumber(overview.TARGET_COLUMN_COUNT)} columns</b>
                                </button>
                                ${targetGroups.slice(0, 30).map((item) => {
                                    const targetColumn = String(item.TARGET_COLUMN || "");
                                    return `
                                        <button type="button" class="${targetFilter === targetColumn ? "is-active" : ""}" title="${this.escapeHtml(`${targetColumn}: ${this.formatNumber(item.SELECTED_RULE_COUNT)} selected`)}" onclick="${PAGE_CODE}.selectSymbolicRuleFilter('targetColumn', '${this.escapeJs(targetColumn)}')">
                                            <span class="anly-work-symbolic-target-column">${this.renderColumnAwareCell(targetColumn, summary)}</span>
                                            ${this.renderColumnClusterBadge(item.TARGET_CLUSTER_ID)}
                                            <b>${this.formatNumber(item.SELECTED_RULE_COUNT)} rules</b>
                                        </button>
                                    `;
                                }).join("")}
                            </div>
                        </div>
                    </section>
                    ${topRules.length ? `
                        <div class="anly-work-symbolic-rule-grid">
                            ${topRules.map((rule, index) => this.renderSymbolicRuleCard(rule, index)).join("")}
                        </div>
                    ` : `<div class="table-empty">${this.escapeHtml(getText("No Symbolic Rules to display."))}</div>`}
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
            const formulaText = this.getSymbolicFormulaText(rule, features, targetColumn);
            const targetCell = this.renderColumnAwareCell(targetColumn, this.lastSymbolicRuleSummary || {});
            const featureClusters = new Map((Array.isArray(rule.FEATURE_CLUSTERS) ? rule.FEATURE_CLUSTERS : []).map((item) => [
                String(item?.COLUMN_NAME || "").trim().toUpperCase(),
                item?.CLUSTER_ID
            ]));
            return `
                <article class="anly-work-symbolic-rule-card ${String(rule.SELECTED_YN || "").toUpperCase() === "Y" ? "is-selected" : ""}">
                    <header>
                        <span>
                            <span class="anly-work-symbolic-rule-id-inline">
                                <small class="anly-work-symbolic-rule-id-label">Rule ID</small>
                                <span class="anly-work-symbolic-rule-id-row">
                                    <code>${this.escapeHtml(displayRuleId)}</code>
                                    <button type="button" class="anly-work-rule-copy-btn" title="${this.escapeHtml(getText("Copy RULE ID"))}" onclick="${PAGE_CODE}.copyRuleId('${this.escapeJs(plainRuleId)}', event)">
                                        <i class="far fa-copy"></i>
                                    </button>
                                </span>
                            </span>
                        </span>
                        <span class="anly-work-symbolic-rule-actions">
                            <button type="button" title="${this.escapeHtml(getText("View formula graph"))}" onclick="${PAGE_CODE}.openSymbolicRulePopup('${this.escapeJs(key)}')">
                                <i class="fas fa-chart-line"></i>
                            </button>
                            ${plainRuleId ? `<button type="button" title="${this.escapeHtml(getText("Search continuous violation detection results with this RULE ID"))}" onclick="${PAGE_CODE}.openSymbolicViolationForRule('${this.escapeJs(plainRuleId)}')">${this.escapeHtml(getText("View violations"))}</button>` : ""}
                        </span>
                    </header>
                    <div class="anly-work-symbolic-y-panel">
                        <small>${this.escapeHtml(getText("Y result value"))}</small>
                        <strong>${targetCell}</strong>
                        ${this.renderColumnClusterBadge(rule.TARGET_CLUSTER_ID, rule.CLUSTER_SCOPE)}
                    </div>
                    <div class="anly-work-symbolic-formula-row">
                        <code>${this.escapeHtml(formulaText)}</code>
                        <button type="button" class="anly-work-rule-copy-btn" title="${this.escapeHtml(getText("Copy formula"))}" onclick="${PAGE_CODE}.copySymbolicFormula('${this.escapeJs(formulaText)}', event)"><i class="far fa-copy"></i></button>
                    </div>
                    <div class="anly-work-symbolic-x-panel">
                        <small>${this.escapeHtml(getText("X arguments"))}</small>
                        <div class="anly-work-corr-tags">
                            ${features.length ? features.slice(0, 10).map((column) => `
                                <span class="anly-work-symbolic-cluster-argument">
                                    ${this.renderColumnChip(column, this.lastSymbolicRuleSummary || {})}
                                    ${this.renderColumnClusterBadge(featureClusters.get(String(column).trim().toUpperCase()))}
                                </span>
                            `).join("") : `<em class="anly-work-column-chip"><b>x</b></em>`}
                        </div>
                    </div>
                    <footer>
                        <span><small>score</small><b>${this.formatDecimal(rule.SCORE)}</b></span>
                        <span><small>complexity</small><b>${this.formatNumber(rule.COMPLEXITY)}</b></span>
                        <span><small>rank</small><b>${this.formatNumber(rule.RANK_NO)}</b></span>
                        <span class="anly-work-symbolic-rule-method"><small>method</small><b>${this.escapeHtml(rule.METHOD || "-")}</b></span>
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
                <section class="anly-work-symbolic-violation-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(getText("Symbolic Rule Error Range Violation Summary"))}</strong>
                            <span>${this.escapeHtml(getText("Target {target} · based on allowed error rate against prediction", { target: `${summary.targetOwner}.${summary.targetTable}` }))}</span>
                        </div>
                        <div class="anly-work-corr-metrics">
                            <span><b>${this.formatNumber(overview.RULE_COUNT)}</b><small>rules</small></span>
                            <span><b>${this.formatNumber(overview.VIOLATION_COUNT)}</b><small>violations</small></span>
                            <span><b>${this.formatNumber(overview.VIOLATED_RULE_COUNT)}</b><small>hit rules</small></span>
                            <span><b>${this.formatNumber(overview.NO_VIOLATION_RULE_COUNT)}</b><small>clean rules</small></span>
                            <span><b>${this.formatPercentMetric(overview.TOLERANCE_PCT)}</b><small>tolerance</small></span>
                        </div>
                    </header>
                    <div class="anly-work-violation-reason-strip">
                        <span><small>${this.escapeHtml(getText("Violation rows"))}</small><b>${this.formatNumber(overview.VIOLATED_ROW_COUNT)}</b></span>
                        <span><small>${this.escapeHtml(getText("Average error rate"))}</small><b>${this.formatPercentMetric(overview.AVG_ERROR_PCT)}</b></span>
                        <span><small>${this.escapeHtml(getText("Max error rate"))}</small><b>${this.formatPercentMetric(overview.MAX_ERROR_PCT)}</b></span>
                        <span><small>${this.escapeHtml(getText("Average absolute error"))}</small><b>${this.formatDecimal(overview.AVG_ABS_ERROR)}</b></span>
                        <span><small>${this.escapeHtml(getText("Max absolute error"))}</small><b>${this.formatDecimal(overview.MAX_ABS_ERROR)}</b></span>
                        ${ruleFilterDisplay ? `<b>${this.escapeHtml(getText("RULE ID search: {ruleId}", { ruleId: ruleFilterDisplay }))}</b>` : ""}
                    </div>
                    <section class="anly-work-rule-facet-panel is-symbolic">
                        <div class="anly-work-rule-facet-block">
                            <header>
                                <strong>${this.escapeHtml(getText("Method Type"))}</strong>
                                <button type="button" onclick="${PAGE_CODE}.resetSymbolicViolationFilters()">Reset</button>
                            </header>
                            <div class="anly-work-rule-facet-list">
                                <button type="button" class="${methodFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('method', 'ALL')">
                                    <span>${this.escapeHtml(getText("All"))}</span>
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
                                }).join("") : `<div class="anly-work-rule-facet-empty">${this.escapeHtml(getText("No Method summary to display."))}</div>`}
                            </div>
                        </div>
                        <div class="anly-work-rule-facet-block is-condition">
                            <header><strong>${this.escapeHtml(getText("Violation Status"))}</strong></header>
                            <div class="anly-work-rule-facet-list">
                                <button type="button" class="${resultScope === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('resultScope', 'ALL')">
                                    <span>${this.escapeHtml(getText("All rules"))}</span>
                                    <b>${this.formatNumber(overview.RULE_COUNT)}</b>
                                </button>
                                <button type="button" class="${resultScope === "HIT" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('resultScope', 'HIT')">
                                    <span>${this.escapeHtml(getText("Violation found"))}</span>
                                    <b>${this.formatNumber(overview.VIOLATED_RULE_COUNT)}</b>
                                </button>
                                <button type="button" class="${resultScope === "CLEAN" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('resultScope', 'CLEAN')">
                                    <span>${this.escapeHtml(getText("No violation"))}</span>
                                    <b>${this.formatNumber(overview.NO_VIOLATION_RULE_COUNT)}</b>
                                </button>
                            </div>
                        </div>
                        <div class="anly-work-rule-facet-block">
                            <header><strong>${this.escapeHtml(getText("Rules/Violations by Target"))}</strong></header>
                            <div class="anly-work-rule-facet-list">
                                <button type="button" class="${targetFilter === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectSymbolicViolationFilter('targetColumn', 'ALL')">
                                    <span>${this.escapeHtml(getText("All"))}</span>
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
                                }).join("") : `<div class="anly-work-rule-facet-empty">${this.escapeHtml(getText("No Target rules to display."))}</div>`}
                            </div>
                        </div>
                        <div class="anly-work-rule-facet-block is-condition">
                            <header>
                                <strong>${this.escapeHtml(getText("RULE ID Search"))}</strong>
                                <div class="anly-work-rule-facet-actions">
                                    <button type="button" onclick="${PAGE_CODE}.searchViolationRule()">Search</button>
                                    <button type="button" onclick="${PAGE_CODE}.resetViolationRuleSearch()">Reset</button>
                                </div>
                            </header>
                            <label class="anly-work-rule-condition-search">
                                <span>RULE ID</span>
                                <input id="violationRuleSearch-${PAGE_CODE}" type="search" value="${this.escapeHtml(ruleFilterDisplay)}" placeholder="${this.escapeHtml(getText("e.g. RULE_001"))}" onkeydown="${PAGE_CODE}.handleViolationRuleSearchKeydown(event)">
                            </label>
                        </div>
                    </section>
                    ${topRules.length ? `
                        <div class="anly-work-violation-rule-grid">
                            ${topRules.map((rule) => {
                                const hasViolation = Number(rule.VIOLATION_COUNT || 0) > 0;
                                const features = this.parseFeatureList(rule.FEATURE_COLUMNS);
                                const featureLabel = features.join(", ") || "x";
                                const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
                                return `
                                <article class="${hasViolation ? "" : "is-no-violation"}">
                                    <header>
                                        <strong>${this.escapeHtml(rule.RULE_ID || "-")}</strong>
                                        <span class="anly-work-violation-rule-actions">
                                            <button type="button" title="${this.escapeHtml(getText("View formula graph"))}" onclick="${PAGE_CODE}.openSymbolicViolationRulePopup('${this.escapeJs(rule.RULE_ID)}')">
                                                <i class="fas fa-chart-line"></i>
                                            </button>
                                            <button type="button" class="${hasViolation ? "" : "is-muted"}" onclick="${PAGE_CODE}.openViolationSqlPopup('rule', '${this.escapeJs(rule.RULE_ID)}')">
                                                ${hasViolation ? this.escapeHtml(getText("{count} rows", { count: this.formatNumber(rule.VIOLATION_COUNT) })) : this.escapeHtml(getText("No violation"))}
                                            </button>
                                        </span>
                                    </header>
                                    <p>
                                        <b>F(X)</b>
                                        f(${this.escapeHtml(featureLabel)}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${this.renderColumnAwareCell(targetColumn, summary)}
                                    </p>
                                    <footer>
                                        <span><small>${this.escapeHtml(getText("Violation rows"))}</small><b>${this.formatNumber(rule.VIOLATED_ROW_COUNT)}</b></span>
                                        <span><small>${this.escapeHtml(getText("Max error rate"))}</small><b>${this.formatPercentMetric(rule.MAX_ERROR_PCT)}</b></span>
                                        <span><small>${this.escapeHtml(getText("Average error rate"))}</small><b>${this.formatPercentMetric(rule.AVG_ERROR_PCT)}</b></span>
                                        <span><small>score</small><b>${this.formatDecimal(rule.RULE_SCORE)}</b></span>
                                        <span><small>method</small><b>${this.escapeHtml(rule.RULE_METHOD || "-")}</b></span>
                                    </footer>
                                </article>
                            `;
                            }).join("")}
                        </div>
                    ` : `<div class="table-empty anly-work-symbolic-violation-empty">${this.escapeHtml(ruleFilterDisplay ? getText("No Symbolic Rule matches the searched RULE ID.") : getText("No Symbolic Rule violation summary to display."))}</div>`}
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
                alert(getText("Selected Symbolic Rule information could not be found."));
                return;
            }
            this.closeSymbolicRulePopup();
            const summary = this.lastSymbolicRuleSummary || {};
            this.symbolicRuleChartState = this.createSymbolicRuleChartState(rule, summary);
            const popup = document.createElement("div");
            popup.id = `${PAGE_ID_PREFIX}SymbolicRulePopup`;
            popup.className = "anly-work-symbolic-popup anly-work-symbolic-visual-popup";
            popup.innerHTML = this.renderSymbolicRulePopup(rule, summary);
            document.body.appendChild(popup);
            setTimeout(() => this.initializeSymbolicRuleVisualization(), 0);
        },

        openSymbolicViolationRulePopup(ruleId) {
            const normalizedRuleId = String(ruleId || "").trim();
            const summary = this.lastSymbolicViolationSummary || {};
            const rule = (summary.topRules || []).find((item) => String(item.RULE_ID) === normalizedRuleId);
            if (!rule) {
                alert(getText("Selected Symbolic Rule violation summary information could not be found."));
                return;
            }
            this.closeSymbolicRulePopup();
            this.symbolicRuleChartState = this.createSymbolicRuleChartState(rule, summary);
            const popup = document.createElement("div");
            popup.id = `${PAGE_ID_PREFIX}SymbolicRulePopup`;
            popup.className = "anly-work-symbolic-popup anly-work-symbolic-visual-popup";
            popup.innerHTML = this.renderSymbolicRulePopup(rule, summary);
            document.body.appendChild(popup);
            setTimeout(() => this.initializeSymbolicRuleVisualization(), 0);
        },

        renderSymbolicRulePopup(rule, sourceSummary = this.lastSymbolicRuleSummary || {}) {
            const features = Array.isArray(rule.FEATURE_LIST) ? rule.FEATURE_LIST : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const ranges = Array.isArray(rule.FEATURE_RANGES) ? rule.FEATURE_RANGES : [];
            const featureLabel = features.length ? features.map((item) => this.escapeHtml(item)).join(", ") : "x";
            const targetColumn = String(rule.TARGET_COLUMN || "Y").trim() || "Y";
            const targetCell = this.renderColumnAwareCell(targetColumn, sourceSummary || {});
            const formulaText = this.getSymbolicFormulaText(rule, features, targetColumn);
            const featureClusters = new Map((Array.isArray(rule.FEATURE_CLUSTERS) ? rule.FEATURE_CLUSTERS : []).map((item) => [
                String(item?.COLUMN_NAME || "").trim().toUpperCase(),
                item?.CLUSTER_ID
            ]));
            const featureRanges = new Map(ranges.map((item) => [String(item?.COLUMN_NAME || "").trim().toUpperCase(), item]));
            const displayRuleId = this.getSymbolicRuleDisplayId(rule, this.findSymbolicRuleIndex(rule));
            const method = String(rule.METHOD || rule.RULE_METHOD || "-").trim() || "-";
            const score = rule.SCORE ?? rule.RULE_SCORE;
            const complexity = rule.COMPLEXITY ?? rule.RULE_COMPLEXITY;
            return `
                <section>
                    <header class="anly-work-sql-popup-title" onmousedown="${PAGE_CODE}.startSymbolicRulePopupDrag(event)">
                        <div>
                            <span class="anly-work-symbolic-rule-id-inline">
                                <small class="anly-work-symbolic-rule-id-label">Rule ID</small>
                                <span class="anly-work-symbolic-rule-id-row">
                                    <code>${this.escapeHtml(displayRuleId)}</code>
                                    <button type="button" class="anly-work-rule-copy-btn" title="${this.escapeHtml(getText("Copy RULE ID"))}" onclick="${PAGE_CODE}.copyRuleId('${this.escapeJs(displayRuleId)}', event)">
                                        <i class="far fa-copy"></i>
                                    </button>
                                </span>
                            </span>
                            <span>Symbolic regression rule</span>
                        </div>
                        <button type="button" title="Close" onclick="${PAGE_CODE}.closeSymbolicRulePopup()"><i class="fas fa-times"></i></button>
                    </header>
                    <div class="anly-work-symbolic-formula-banner">
                        <span>F(X) = Y</span>
                        <div class="anly-work-symbolic-formula-text"><strong>f(${featureLabel}) = ${this.escapeHtml(rule.EXPRESSION || "")} = ${targetCell}</strong></div>
                        <button type="button" class="anly-work-symbolic-formula-copy" title="${this.escapeHtml(getText("Copy formula"))}" onclick="${PAGE_CODE}.copySymbolicFormula('${this.escapeJs(formulaText)}', event)"><i class="far fa-copy"></i></button>
                    </div>
                    <div class="anly-work-symbolic-popup-body">
                        <div class="anly-work-symbolic-diagnostic-metrics">
                            <span><small>method</small><b>${this.escapeHtml(method)}</b></span>
                            <span><small>${this.escapeHtml(getText("Model R²"))}</small><b>${this.formatSymbolicDiagnosticNumber(score)}</b></span>
                            <span><small>${this.escapeHtml(getText("Sample R²"))}</small><b id="${PAGE_ID_PREFIX}SymbolicSampleR2">-</b></span>
                            <span><small>MAE</small><b id="${PAGE_ID_PREFIX}SymbolicSampleMae">-</b></span>
                            <span><small>RMSE</small><b id="${PAGE_ID_PREFIX}SymbolicSampleRmse">-</b></span>
                            <span><small>complexity</small><b>${this.formatNumber(complexity)}</b></span>
                            <span><small>${this.escapeHtml(getText("Sample rows"))}</small><b id="${PAGE_ID_PREFIX}SymbolicSampleCount">${this.escapeHtml(getText("Loading..."))}</b></span>
                        </div>
                        <div class="anly-work-symbolic-expression-box">
                            <strong>${this.escapeHtml(getText("Column details"))}</strong>
                            <div class="anly-work-symbolic-column-details">
                                <section class="is-target">
                                    <small>${this.escapeHtml(getText("Y result value"))}</small>
                                    <b>${targetCell}</b>
                                    ${this.renderColumnClusterBadge(rule.TARGET_CLUSTER_ID, rule.CLUSTER_SCOPE)}
                                </section>
                                <section class="is-features">
                                    <small>${this.escapeHtml(getText("X arguments"))}</small>
                                    <div>
                                        ${features.length ? features.map((feature) => {
                                            const range = featureRanges.get(String(feature).trim().toUpperCase());
                                            return `
                                                <span>
                                                    ${this.renderColumnChip(feature, sourceSummary || {})}
                                                    ${this.renderColumnClusterBadge(featureClusters.get(String(feature).trim().toUpperCase()))}
                                                    <small>${range ? `min ${this.formatDecimal(range.MIN_VALUE)} · avg ${this.formatDecimal(range.AVG_VALUE)} · max ${this.formatDecimal(range.MAX_VALUE)}` : this.escapeHtml(getText("Feature range unavailable"))}</small>
                                                </span>
                                            `;
                                        }).join("") : `<span>${this.escapeHtml(getText("No X arguments are available."))}</span>`}
                                    </div>
                                </section>
                            </div>
                            ${rule.MESSAGE ? `<span class="anly-work-symbolic-expression-note">${this.escapeHtml(rule.MESSAGE)}</span>` : ""}
                            <span class="anly-work-symbolic-expression-note">${this.escapeHtml(getText("{method} formulas may include polynomial fallback and inverse transformation from standardized values. Calculation retains up to 12 significant digits; rounding is applied only to labels and tooltips.", { method }))}</span>
                        </div>
                        <div class="anly-work-symbolic-visual-shell">
                            <div class="anly-work-symbolic-chart-toolbar">
                                <label>
                                    <span>${this.escapeHtml(getText("Graph type"))}</span>
                                    <select id="${PAGE_ID_PREFIX}SymbolicChartMode" onchange="${PAGE_CODE}.changeSymbolicRuleChartMode(this.value)">
                                        <option value="${SYMBOLIC_CHART_MODES.ACTUAL_PREDICTED}">${this.escapeHtml(getText("Actual vs predicted"))}</option>
                                        <option value="${SYMBOLIC_CHART_MODES.RESIDUAL}">${this.escapeHtml(getText("Residual vs predicted"))}</option>
                                        <option value="${SYMBOLIC_CHART_MODES.FEATURE_RESPONSE}">${this.escapeHtml(getText("Observed points and formula curve"))}</option>
                                        <option value="${SYMBOLIC_CHART_MODES.SENSITIVITY}">${this.escapeHtml(getText("Formula sensitivity"))}</option>
                                    </select>
                                </label>
                                <label>
                                    <span>${this.escapeHtml(getText("X feature"))}</span>
                                    <select id="${PAGE_ID_PREFIX}SymbolicPrimaryFeature" onchange="${PAGE_CODE}.changeSymbolicRulePrimaryFeature(this.value)">
                                        ${features.map((feature) => `<option value="${this.escapeHtml(feature)}">${this.escapeHtml(this.getSymbolicFeatureOptionLabel(feature, sourceSummary))}</option>`).join("")}
                                    </select>
                                </label>
                                <div class="anly-work-symbolic-chart-tools">
                                    <button type="button" onclick="${PAGE_CODE}.zoomSymbolicRuleChart(1.25)" title="${this.escapeHtml(getText("Zoom in"))}"><i class="fas fa-search-plus"></i></button>
                                    <button type="button" onclick="${PAGE_CODE}.zoomSymbolicRuleChart(0.8)" title="${this.escapeHtml(getText("Zoom out"))}"><i class="fas fa-search-minus"></i></button>
                                    <button type="button" onclick="${PAGE_CODE}.resetSymbolicRuleChartZoom()" title="${this.escapeHtml(getText("Reset view"))}"><i class="fas fa-compress-arrows-alt"></i></button>
                                    <button type="button" data-anly-symbolic-maximize-btn onclick="${PAGE_CODE}.toggleSymbolicRuleChartMaximize()" title="${this.escapeHtml(getText("Maximize graph"))}" aria-pressed="false"><i class="fas fa-expand"></i></button>
                                    <em id="${PAGE_ID_PREFIX}SymbolicZoomLabel">100%</em>
                                </div>
                            </div>
                            <div class="anly-work-symbolic-chart-wrap">
                                <canvas id="${PAGE_ID_PREFIX}SymbolicRuleChart" height="300" tabindex="0"></canvas>
                                <div id="${PAGE_ID_PREFIX}SymbolicRuleChartMessage" class="table-empty">${this.escapeHtml(getText("Loading sample rows..."))}</div>
                            </div>
                        </div>
                        <section id="${PAGE_ID_PREFIX}SymbolicRawDataPanel" class="anly-work-symbolic-raw-panel">
                            <header>
                                <strong>${this.escapeHtml(getText("Sample raw data"))}</strong>
                                <small id="${PAGE_ID_PREFIX}SymbolicRawDataSummary"></small>
                            </header>
                            <div id="${PAGE_ID_PREFIX}SymbolicRawDataTable" class="anly-work-symbolic-raw-table-wrap"><div class="table-empty">${this.escapeHtml(getText("Loading sample rows..."))}</div></div>
                        </section>
                    </div>
                </section>
            `;
        },

        closeSymbolicRulePopup() {
            this.symbolicRuleSampleRequestId += 1;
            if (this.symbolicRuleChart && typeof this.symbolicRuleChart.destroy === "function") {
                this.symbolicRuleChart.destroy();
            }
            this.symbolicRuleChart = null;
            this.symbolicRuleChartState = null;
            const popup = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRulePopup`);
            if (popup) popup.remove();
        },

        startSymbolicRulePopupDrag(event) {
            const popup = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRulePopup`);
            if (!popup || popup.classList.contains("is-symbolic-chart-maximized") || event.target.closest("button")) return;
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

        createSymbolicRuleChartState(rule = {}, summary = {}) {
            const features = Array.isArray(rule.FEATURE_LIST) && rule.FEATURE_LIST.length
                ? rule.FEATURE_LIST.map((feature) => String(feature || "").trim()).filter(Boolean)
                : this.parseFeatureList(rule.FEATURE_COLUMNS);
            return {
                rule: { ...rule, FEATURE_LIST: features },
                summary,
                rows: [],
                evaluatedRows: [],
                sampleMetrics: { r2: null, mae: null, rmse: null },
                sampleCount: 0,
                hasMore: false,
                sampleLimit: 300,
                mode: SYMBOLIC_CHART_MODES.ACTUAL_PREDICTED,
                primaryFeature: features[0] || "",
                maximized: false,
                selectedRowIndex: null,
                chartPan: null,
                chartPanEndAt: 0,
                popupInlinePosition: null,
                zoomPercent: 100,
                loading: true,
                error: ""
            };
        },

        async initializeSymbolicRuleVisualization() {
            const state = this.symbolicRuleChartState;
            if (!state) return;
            this.updateSymbolicRuleVisualizationControls();
            const ruleId = String(state.rule?.RULE_ID || "").trim();
            const owner = String(
                state.rule?.RULE_OWNER
                || this.selectedNode?.RESULT_OWNER
                || state.summary?.ruleOwner
                || state.rule?.OWNER
                || state.summary?.targetOwner
                || ""
            ).trim();
            const runSourceType = String(state.summary?.runSourceType || state.rule?.RUN_SOURCE_TYPE || "FLOW_WORK").trim();
            const runId = state.summary?.runId ?? state.rule?.RUN_ID ?? this.selectedRun?.FLOW_RUN_ID;
            if (!ruleId || !owner || runId === undefined || runId === null || runId === "") {
                state.loading = false;
                state.mode = SYMBOLIC_CHART_MODES.SENSITIVITY;
                state.error = getText("Sample query context is missing, so the formula sensitivity graph is displayed.");
                this.updateSymbolicRuleVisualizationControls();
                this.drawSymbolicRuleChart();
                return;
            }
            const requestId = ++this.symbolicRuleSampleRequestId;
            const params = new URLSearchParams({ owner, ruleId, sampleLimit: "300" });
            params.set("runSourceType", runSourceType);
            params.set("runId", String(runId));
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_PAGE_CODE}/symbolic-rule-sample?${params.toString()}`, {
                    method: "GET",
                    showLoading: false
                });
                if (requestId !== this.symbolicRuleSampleRequestId || state !== this.symbolicRuleChartState) return;
                const payload = json?.data && typeof json.data === "object" ? json.data : (json || {});
                const sampleRule = payload.rule && typeof payload.rule === "object" ? payload.rule : {};
                const mergedRule = { ...state.rule, ...sampleRule };
                const features = Array.isArray(mergedRule.FEATURE_LIST) && mergedRule.FEATURE_LIST.length
                    ? mergedRule.FEATURE_LIST.map((feature) => String(feature || "").trim()).filter(Boolean)
                    : this.parseFeatureList(mergedRule.FEATURE_COLUMNS);
                state.rule = { ...mergedRule, FEATURE_LIST: features };
                state.rows = Array.isArray(payload.rows) ? payload.rows : [];
                state.sampleCount = Number(payload.sampleCount ?? state.rows.length) || state.rows.length;
                state.sampleLimit = Number(payload.sampleLimit ?? 300) || 300;
                state.hasMore = payload.hasMore === true
                    || payload.isCapped === true
                    || ["Y", "YES", "TRUE", "1"].includes(String(payload.hasMore ?? payload.isCapped ?? "").toUpperCase());
                state.evaluatedRows = this.evaluateSymbolicSampleRows(state.rule, state.rows);
                state.sampleMetrics = this.calculateSymbolicSampleMetrics(state.evaluatedRows);
                state.primaryFeature = features.includes(state.primaryFeature) ? state.primaryFeature : (features[0] || "");
                state.loading = false;
                if (state.evaluatedRows.length) {
                    state.mode = SYMBOLIC_CHART_MODES.ACTUAL_PREDICTED;
                    state.error = "";
                } else {
                    state.mode = SYMBOLIC_CHART_MODES.SENSITIVITY;
                    state.error = state.rows.length
                        ? getText("The sample rows do not contain enough numeric values to compare actual and predicted values. The formula sensitivity graph is displayed instead.")
                        : getText("No sample rows were returned. The formula sensitivity graph is displayed instead.");
                }
            } catch (error) {
                if (requestId !== this.symbolicRuleSampleRequestId || state !== this.symbolicRuleChartState) return;
                state.loading = false;
                state.mode = SYMBOLIC_CHART_MODES.SENSITIVITY;
                state.error = getText("Could not load sample rows: {message}. The formula sensitivity graph is displayed instead.", {
                    message: error?.message || getText("Unknown error")
                });
            }
            this.updateSymbolicRuleFeatureOptions();
            this.updateSymbolicRuleVisualizationControls();
            this.renderSymbolicRuleRawDataTable();
            this.drawSymbolicRuleChart();
        },

        updateSymbolicRuleFeatureOptions() {
            const state = this.symbolicRuleChartState;
            const select = document.getElementById(`${PAGE_ID_PREFIX}SymbolicPrimaryFeature`);
            if (!state || !select) return;
            const features = Array.isArray(state.rule?.FEATURE_LIST) ? state.rule.FEATURE_LIST : [];
            select.innerHTML = features.map((feature) => `
                <option value="${this.escapeHtml(feature)}">${this.escapeHtml(this.getSymbolicFeatureOptionLabel(feature, state.summary))}</option>
            `).join("");
            select.value = state.primaryFeature;
        },

        getSymbolicFeatureOptionLabel(feature, source = null) {
            const column = String(feature || "").trim();
            const comment = this.getColumnComment(column, source);
            return comment ? `${column} · ${comment}` : column;
        },

        getSymbolicAxisColumnLabel(columnName, source = null, prefix = "") {
            const column = String(columnName || "").trim();
            const comment = this.getColumnComment(column, source);
            const firstLine = prefix ? `${prefix} · ${column}` : column;
            return comment ? [firstLine, comment] : firstLine;
        },

        updateSymbolicRuleVisualizationControls() {
            const state = this.symbolicRuleChartState;
            if (!state) return;
            const hasSamples = state.evaluatedRows.length > 0;
            const modeSelect = document.getElementById(`${PAGE_ID_PREFIX}SymbolicChartMode`);
            const featureSelect = document.getElementById(`${PAGE_ID_PREFIX}SymbolicPrimaryFeature`);
            const sampleCount = document.getElementById(`${PAGE_ID_PREFIX}SymbolicSampleCount`);
            const sampleR2 = document.getElementById(`${PAGE_ID_PREFIX}SymbolicSampleR2`);
            const sampleMae = document.getElementById(`${PAGE_ID_PREFIX}SymbolicSampleMae`);
            const sampleRmse = document.getElementById(`${PAGE_ID_PREFIX}SymbolicSampleRmse`);
            if (modeSelect) {
                [
                    SYMBOLIC_CHART_MODES.ACTUAL_PREDICTED,
                    SYMBOLIC_CHART_MODES.RESIDUAL,
                    SYMBOLIC_CHART_MODES.FEATURE_RESPONSE
                ].forEach((mode) => {
                    const option = Array.from(modeSelect.options).find((item) => item.value === mode);
                    if (option) option.disabled = !hasSamples;
                });
                modeSelect.value = state.mode;
                modeSelect.disabled = state.loading;
            }
            if (featureSelect) {
                featureSelect.value = state.primaryFeature;
                featureSelect.disabled = state.loading || !hasSamples || state.mode !== SYMBOLIC_CHART_MODES.FEATURE_RESPONSE;
            }
            if (sampleCount) {
                sampleCount.textContent = state.loading
                    ? getText("Loading...")
                    : (state.hasMore
                        ? getText("{sample} sampled rows (more rows available)", { sample: this.formatNumber(state.sampleCount) })
                        : getText("{sample} sampled rows", { sample: this.formatNumber(state.sampleCount) }));
            }
            if (sampleR2) sampleR2.textContent = Number.isFinite(state.sampleMetrics?.r2) ? this.formatSymbolicDiagnosticNumber(state.sampleMetrics.r2) : "-";
            if (sampleMae) sampleMae.textContent = Number.isFinite(state.sampleMetrics?.mae) ? this.formatSymbolicDiagnosticNumber(state.sampleMetrics.mae) : "-";
            if (sampleRmse) sampleRmse.textContent = Number.isFinite(state.sampleMetrics?.rmse) ? this.formatSymbolicDiagnosticNumber(state.sampleMetrics.rmse) : "-";
        },

        getSymbolicSampleValue(row = {}, columnName = "") {
            const normalized = String(columnName || "").trim().toUpperCase();
            if (!normalized || !row || typeof row !== "object") return undefined;
            const exactKey = Object.keys(row).find((key) => String(key || "").trim().toUpperCase() === normalized);
            return exactKey === undefined ? undefined : row[exactKey];
        },

        toSymbolicFiniteNumber(value) {
            if (value === undefined || value === null || String(value).trim() === "") return null;
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : null;
        },

        formatSymbolicDiagnosticNumber(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "-";
            const absolute = Math.abs(numeric);
            if (absolute > 0 && (absolute < 0.000001 || absolute >= 1000000000)) return numeric.toExponential(6);
            return numeric.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
        },

        evaluateSymbolicSampleRows(rule = {}, rows = []) {
            const features = Array.isArray(rule.FEATURE_LIST) && rule.FEATURE_LIST.length
                ? rule.FEATURE_LIST
                : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const targetColumn = String(rule.TARGET_COLUMN || "").trim();
            const compiled = this.compileSymbolicExpression(String(rule.EXPRESSION || ""), features);
            if (!compiled.ok || !features.length || !targetColumn) return [];
            return (rows || []).map((row, index) => {
                const values = {};
                features.forEach((feature) => {
                    values[feature] = this.toSymbolicFiniteNumber(this.getSymbolicSampleValue(row, feature));
                });
                const actual = this.toSymbolicFiniteNumber(this.getSymbolicSampleValue(row, targetColumn));
                if (features.some((feature) => !Number.isFinite(values[feature]))) return null;
                const predicted = compiled.evaluate(values);
                if (!Number.isFinite(actual) || !Number.isFinite(predicted)) return null;
                return {
                    row,
                    rowIndex: index,
                    sampleNo: this.getSymbolicSampleValue(row, "SAMPLE_NO") ?? index + 1,
                    values,
                    actual,
                    predicted,
                    residual: actual - predicted
                };
            }).filter(Boolean);
        },

        calculateSymbolicSampleMetrics(evaluatedRows = []) {
            if (!evaluatedRows.length) return { r2: null, mae: null, rmse: null };
            const actualAverage = evaluatedRows.reduce((sum, item) => sum + item.actual, 0) / evaluatedRows.length;
            const absoluteErrorSum = evaluatedRows.reduce((sum, item) => sum + Math.abs(item.residual), 0);
            const squaredErrorSum = evaluatedRows.reduce((sum, item) => sum + (item.residual ** 2), 0);
            const totalSquaredSum = evaluatedRows.reduce((sum, item) => sum + ((item.actual - actualAverage) ** 2), 0);
            const actualMagnitude = evaluatedRows.reduce((sum, item) => sum + (item.actual ** 2), 0);
            const varianceTolerance = Number.EPSILON * Math.max(1, actualMagnitude);
            return {
                r2: totalSquaredSum > varianceTolerance ? 1 - (squaredErrorSum / totalSquaredSum) : null,
                mae: absoluteErrorSum / evaluatedRows.length,
                rmse: Math.sqrt(squaredErrorSum / evaluatedRows.length)
            };
        },

        changeSymbolicRuleChartMode(mode) {
            const state = this.symbolicRuleChartState;
            if (!state) return;
            const allowed = new Set(Object.values(SYMBOLIC_CHART_MODES));
            const requestedMode = allowed.has(mode) ? mode : SYMBOLIC_CHART_MODES.SENSITIVITY;
            state.mode = requestedMode !== SYMBOLIC_CHART_MODES.SENSITIVITY && !state.evaluatedRows.length
                ? SYMBOLIC_CHART_MODES.SENSITIVITY
                : requestedMode;
            state.zoomPercent = 100;
            this.updateSymbolicRuleVisualizationControls();
            this.drawSymbolicRuleChart();
        },

        changeSymbolicRulePrimaryFeature(feature) {
            const state = this.symbolicRuleChartState;
            if (!state) return;
            const features = Array.isArray(state.rule?.FEATURE_LIST) ? state.rule.FEATURE_LIST : [];
            const selected = features.find((item) => String(item).toUpperCase() === String(feature || "").toUpperCase());
            if (!selected) return;
            state.primaryFeature = selected;
            state.zoomPercent = 100;
            if (state.mode === SYMBOLIC_CHART_MODES.FEATURE_RESPONSE) this.drawSymbolicRuleChart();
        },

        renderSymbolicRuleRawDataTable() {
            const state = this.symbolicRuleChartState;
            const container = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRawDataTable`);
            const summary = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRawDataSummary`);
            if (!state || !container) return;
            const features = Array.isArray(state.rule?.FEATURE_LIST) ? state.rule.FEATURE_LIST : [];
            const targetColumn = String(state.rule?.TARGET_COLUMN || "Y").trim() || "Y";
            const columns = [...new Set(["SAMPLE_NO", ...features, targetColumn])];
            const evaluatedByRow = new Map(state.evaluatedRows.map((item) => [item.row, item]));
            if (summary) {
                summary.textContent = state.hasMore
                    ? getText("Showing {sample} sampled rows; additional rows are available.", { sample: this.formatNumber(state.sampleCount) })
                    : getText("Showing {sample} sampled rows.", { sample: this.formatNumber(state.sampleCount) });
            }
            if (!state.rows.length) {
                container.innerHTML = `<div class="table-empty">${this.escapeHtml(getText("No sample rows to display."))}</div>`;
                return;
            }
            const formatCell = (value) => {
                if (value === undefined || value === null || value === "") return "-";
                const numeric = Number(value);
                return Number.isFinite(numeric) ? this.formatSymbolicDiagnosticNumber(numeric) : this.escapeHtml(value);
            };
            container.innerHTML = `
                <table class="table-grid anly-work-symbolic-raw-table">
                    <thead>
                        <tr>
                            ${columns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}
                            <th>${this.escapeHtml(getText("Predicted"))}</th>
                            <th>${this.escapeHtml(getText("Residual"))}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.rows.map((row, index) => {
                            const evaluated = evaluatedByRow.get(row);
                            return `
                                <tr data-symbolic-sample-index="${index}" tabindex="-1" class="${Number.isInteger(state.selectedRowIndex) && state.selectedRowIndex === index ? "is-selected" : ""}" aria-selected="${Number.isInteger(state.selectedRowIndex) && state.selectedRowIndex === index ? "true" : "false"}" onclick="${PAGE_CODE}.selectSymbolicSampleRow(${index})">
                                    ${columns.map((column) => `<td>${column === "SAMPLE_NO" ? formatCell(this.getSymbolicSampleValue(row, column) ?? index + 1) : formatCell(this.getSymbolicSampleValue(row, column))}</td>`).join("")}
                                    <td>${evaluated ? formatCell(evaluated.predicted) : "-"}</td>
                                    <td>${evaluated ? formatCell(evaluated.residual) : "-"}</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            `;
        },

        selectSymbolicSampleRow(rowIndex, focusChart = true) {
            const state = this.symbolicRuleChartState;
            const normalizedIndex = Number(rowIndex);
            if (!state || !Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= state.rows.length) return;
            state.selectedRowIndex = normalizedIndex;
            const rows = document.querySelectorAll(`#${PAGE_ID_PREFIX}SymbolicRawDataTable tr[data-symbolic-sample-index]`);
            rows.forEach((row) => {
                const selected = Number(row.dataset.symbolicSampleIndex) === normalizedIndex;
                row.classList.toggle("is-selected", selected);
                row.setAttribute("aria-selected", selected ? "true" : "false");
                if (selected) {
                    this.focusSymbolicRawDataRow(row);
                    if (!focusChart) row.focus({ preventScroll: true });
                }
            });
            if (focusChart) this.focusSymbolicRuleChartSample(normalizedIndex);
            else if (this.symbolicRuleChart) this.symbolicRuleChart.update("none");
        },

        focusSymbolicRawDataRow(row) {
            const grid = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRawDataTable`);
            const panel = row?.closest(`.anly-work-symbolic-raw-panel`);
            if (!row || !grid) return;
            panel?.scrollIntoView({ block: "nearest", inline: "nearest" });
            requestAnimationFrame(() => {
                const rowRect = row.getBoundingClientRect();
                const gridRect = grid.getBoundingClientRect();
                const nextTop = grid.scrollTop
                    + (rowRect.top - gridRect.top)
                    - Math.max(0, (grid.clientHeight - row.offsetHeight) / 2);
                const nextLeft = grid.scrollLeft
                    + (rowRect.left - gridRect.left)
                    - Math.max(0, (grid.clientWidth - row.offsetWidth) / 2);
                grid.scrollTo({
                    top: Math.max(0, nextTop),
                    left: Math.max(0, nextLeft),
                    behavior: "auto"
                });
            });
        },

        focusSymbolicRuleChartSample(rowIndex) {
            const chart = this.symbolicRuleChart;
            if (!chart) return;
            const point = chart.data.datasets
                .flatMap((dataset) => dataset.data || [])
                .find((item) => Number(item?.sampleIndex) === rowIndex);
            if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
                chart.update("none");
                return;
            }
            [["x", Number(point.x)], ["y", Number(point.y)]].forEach(([axis, value]) => {
                const scale = chart.scales?.[axis];
                if (!scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max)) return;
                const span = Math.max(Number.EPSILON, scale.max - scale.min);
                chart.options.scales[axis].min = value - (span / 2);
                chart.options.scales[axis].max = value + (span / 2);
            });
            chart.update("none");
            chart.canvas.focus({ preventScroll: true });
        },

        getSymbolicSamplePointRadius(context, radius = 3) {
            const selectedRowIndex = this.symbolicRuleChartState?.selectedRowIndex;
            return Number.isInteger(selectedRowIndex) && Number(context?.raw?.sampleIndex) === selectedRowIndex
                ? radius + 3
                : radius;
        },

        getSymbolicSamplePointColor(context, color) {
            const selectedRowIndex = this.symbolicRuleChartState?.selectedRowIndex;
            return Number.isInteger(selectedRowIndex) && Number(context?.raw?.sampleIndex) === selectedRowIndex
                ? "#f59e0b"
                : color;
        },

        toggleSymbolicRuleChartMaximize(force = null) {
            const state = this.symbolicRuleChartState;
            const popup = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRulePopup`);
            if (!state || !popup) return;
            const nextMaximized = typeof force === "boolean" ? force : !state.maximized;
            if (nextMaximized && !state.maximized) {
                state.popupInlinePosition = {
                    left: popup.style.left,
                    top: popup.style.top,
                    transform: popup.style.transform
                };
                popup.style.removeProperty("left");
                popup.style.removeProperty("top");
                popup.style.removeProperty("transform");
            }
            state.maximized = nextMaximized;
            popup.classList.toggle("is-symbolic-chart-maximized", state.maximized);
            if (!state.maximized && state.popupInlinePosition) {
                const { left, top, transform } = state.popupInlinePosition;
                if (left) popup.style.left = left;
                else popup.style.removeProperty("left");
                if (top) popup.style.top = top;
                else popup.style.removeProperty("top");
                if (transform) popup.style.transform = transform;
                else popup.style.removeProperty("transform");
                state.popupInlinePosition = null;
            }
            const button = popup.querySelector("[data-anly-symbolic-maximize-btn]");
            if (button) {
                button.setAttribute("aria-pressed", state.maximized ? "true" : "false");
                button.title = getText(state.maximized ? "Restore graph" : "Maximize graph");
                const icon = button.querySelector("i");
                if (icon) icon.className = state.maximized ? "fas fa-compress" : "fas fa-expand";
            }
            requestAnimationFrame(() => this.symbolicRuleChart?.resize?.());
        },

        drawSymbolicRuleChart(rule = this.symbolicRuleChartState?.rule || {}) {
            const state = this.symbolicRuleChartState;
            const message = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRuleChartMessage`);
            const canvas = document.getElementById(`${PAGE_ID_PREFIX}SymbolicRuleChart`);
            if (!canvas || !window.Chart) {
                if (message) message.textContent = getText("Chart.js is not loaded, so the graph cannot be displayed.");
                return;
            }
            if (state?.loading) {
                canvas.hidden = true;
                if (message) message.textContent = getText("Loading sample rows...");
                return;
            }
            let chartData;
            try {
                if (state?.mode === SYMBOLIC_CHART_MODES.ACTUAL_PREDICTED) {
                    chartData = this.buildSymbolicActualPredictedChartData(state);
                } else if (state?.mode === SYMBOLIC_CHART_MODES.RESIDUAL) {
                    chartData = this.buildSymbolicResidualChartData(state);
                } else if (state?.mode === SYMBOLIC_CHART_MODES.FEATURE_RESPONSE) {
                    chartData = this.buildSymbolicFeatureResponseChartData(state);
                } else {
                    chartData = this.buildSymbolicRuleChartData(rule);
                }
            } catch (error) {
                if (message) message.textContent = getText("Could not build graph data: {message}", { message: error.message });
                canvas.hidden = true;
                return;
            }
            if (!chartData.ok && state && state.mode !== SYMBOLIC_CHART_MODES.SENSITIVITY) {
                state.mode = SYMBOLIC_CHART_MODES.SENSITIVITY;
                state.error = chartData.message || state.error;
                this.updateSymbolicRuleVisualizationControls();
                chartData = this.buildSymbolicRuleChartData(rule);
            }
            if (!chartData.ok) {
                if (message) message.textContent = chartData.message || getText("This formula cannot be calculated as a graph on the current screen.");
                canvas.hidden = true;
                return;
            }
            canvas.hidden = false;
            canvas.removeAttribute("hidden");
            canvas.style.display = "block";
            if (message) {
                message.textContent = [state?.error, chartData.message].filter(Boolean).join(" ");
            }
            if (this.symbolicRuleChart && typeof this.symbolicRuleChart.destroy === "function") {
                this.symbolicRuleChart.destroy();
            }
            try {
                this.symbolicRuleChart = new Chart(canvas.getContext("2d"), {
                    type: chartData.type || "scatter",
                    data: {
                        datasets: chartData.datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: false,
                        interaction: { mode: "nearest", intersect: false },
                        onClick: (event, elements, chart) => this.handleSymbolicRuleChartClick(event, elements, chart),
                        plugins: {
                            legend: { position: "bottom" },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${ctx.dataset.label}: (${this.formatSymbolicDiagnosticNumber(ctx.parsed.x)}, ${this.formatSymbolicDiagnosticNumber(ctx.parsed.y)})`
                                }
                            }
                        },
                        scales: {
                            x: {
                                type: "linear",
                                title: { display: true, text: chartData.xLabel }
                            },
                            y: {
                                type: "linear",
                                title: { display: true, text: chartData.yLabel || rule.TARGET_COLUMN || "Predicted y" }
                            }
                        }
                    }
                });
                if (state) state.zoomPercent = 100;
                this.updateSymbolicRuleZoomLabel();
                this.bindSymbolicRuleChartInteractions(canvas);
                requestAnimationFrame(() => {
                    if (this.symbolicRuleChart && typeof this.symbolicRuleChart.resize === "function") {
                        this.symbolicRuleChart.resize();
                    }
                });
            } catch (error) {
                canvas.hidden = true;
                if (message) message.textContent = getText("Could not render the graph: {message}", { message: error.message });
            }
        },

        handleSymbolicRuleChartClick(event, elements, chart) {
            const state = this.symbolicRuleChartState;
            if (!state || Date.now() - Number(state.chartPanEndAt || 0) < 180) return;
            const target = (elements || []).find((item) => Number.isInteger(Number(chart?.data?.datasets?.[item.datasetIndex]?.data?.[item.index]?.sampleIndex)));
            if (!target) return;
            const sampleIndex = chart.data.datasets[target.datasetIndex].data[target.index].sampleIndex;
            this.selectSymbolicSampleRow(sampleIndex, false);
        },

        bindSymbolicRuleChartInteractions(canvas) {
            if (!canvas) return;
            canvas.onwheel = (event) => this.handleSymbolicRuleChartWheel(event);
            canvas.onpointerdown = (event) => this.startSymbolicRuleChartPan(event);
            canvas.onpointermove = (event) => this.moveSymbolicRuleChartPan(event);
            canvas.onpointerup = (event) => this.stopSymbolicRuleChartPan(event);
            canvas.onpointercancel = (event) => this.stopSymbolicRuleChartPan(event);
            canvas.onlostpointercapture = () => this.stopSymbolicRuleChartPan();
        },

        handleSymbolicRuleChartWheel(event) {
            const chart = this.symbolicRuleChart;
            const state = this.symbolicRuleChartState;
            if (!chart || !state || !Number.isFinite(event.deltaY)) return;
            event.preventDefault();
            const factor = event.deltaY < 0 ? 0.82 : 1.22;
            const rect = chart.canvas.getBoundingClientRect();
            const pixelX = event.clientX - rect.left;
            const pixelY = event.clientY - rect.top;
            ["x", "y"].forEach((axis) => {
                const scale = chart.scales?.[axis];
                if (!scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max)) return;
                const center = scale.getValueForPixel(axis === "x" ? pixelX : pixelY);
                if (!Number.isFinite(center)) return;
                chart.options.scales[axis].min = center + ((scale.min - center) * factor);
                chart.options.scales[axis].max = center + ((scale.max - center) * factor);
            });
            state.zoomPercent = Math.min(800, Math.max(50, Number(state.zoomPercent || 100) / factor));
            chart.update("none");
            this.updateSymbolicRuleZoomLabel();
        },

        startSymbolicRuleChartPan(event) {
            const chart = this.symbolicRuleChart;
            const state = this.symbolicRuleChartState;
            if (!chart || !state || event.button !== 0 || !chart.chartArea) return;
            const { x, y, width, height } = chart.chartArea;
            if (event.offsetX < x || event.offsetX > x + width || event.offsetY < y || event.offsetY > y + height) return;
            const xScale = chart.scales?.x;
            const yScale = chart.scales?.y;
            if (!xScale || !yScale || !Number.isFinite(xScale.min) || !Number.isFinite(xScale.max) || !Number.isFinite(yScale.min) || !Number.isFinite(yScale.max)) return;
            state.chartPan = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
                xMin: xScale.min,
                xMax: xScale.max,
                yMin: yScale.min,
                yMax: yScale.max
            };
            chart.canvas.setPointerCapture?.(event.pointerId);
            chart.canvas.classList.add("is-panning");
        },

        moveSymbolicRuleChartPan(event) {
            const chart = this.symbolicRuleChart;
            const state = this.symbolicRuleChartState;
            const pan = state?.chartPan;
            if (!chart || !pan || pan.pointerId !== event.pointerId || !chart.chartArea) return;
            event.preventDefault();
            if (Math.abs(event.clientX - pan.startX) > 2 || Math.abs(event.clientY - pan.startY) > 2) pan.moved = true;
            const { width, height } = chart.chartArea;
            const xOffset = ((event.clientX - pan.startX) / Math.max(1, width)) * (pan.xMax - pan.xMin);
            const yOffset = ((event.clientY - pan.startY) / Math.max(1, height)) * (pan.yMax - pan.yMin);
            chart.options.scales.x.min = pan.xMin - xOffset;
            chart.options.scales.x.max = pan.xMax - xOffset;
            chart.options.scales.y.min = pan.yMin + yOffset;
            chart.options.scales.y.max = pan.yMax + yOffset;
            chart.update("none");
        },

        stopSymbolicRuleChartPan(event = null) {
            const state = this.symbolicRuleChartState;
            const chart = this.symbolicRuleChart;
            const pan = state?.chartPan;
            if (!state || !pan || (event && pan.pointerId !== event.pointerId)) return;
            chart?.canvas?.releasePointerCapture?.(pan.pointerId);
            chart?.canvas?.classList.remove("is-panning");
            state.chartPan = null;
            state.chartPanEndAt = pan.moved ? Date.now() : 0;
        },

        buildSymbolicActualPredictedChartData(state = this.symbolicRuleChartState) {
            const points = (state?.evaluatedRows || []).map((item) => ({ x: item.actual, y: item.predicted, sampleIndex: item.rowIndex }));
            if (!points.length) {
                return { ok: false, message: getText("No numeric actual/predicted sample pairs are available.") };
            }
            const values = points.flatMap((point) => [point.x, point.y]).filter(Number.isFinite);
            let minValue = Math.min(...values);
            let maxValue = Math.max(...values);
            if (minValue === maxValue) {
                const padding = Math.max(1, Math.abs(minValue) * 0.05);
                minValue -= padding;
                maxValue += padding;
            }
            return {
                ok: true,
                type: "scatter",
                xLabel: this.getSymbolicAxisColumnLabel(state?.rule?.TARGET_COLUMN, state?.summary, getText("Actual value")),
                yLabel: this.getSymbolicAxisColumnLabel(state?.rule?.TARGET_COLUMN, state?.summary, getText("Predicted value")),
                datasets: [
                    {
                        label: getText("Sample observations"),
                        data: points,
                        backgroundColor: (context) => this.getSymbolicSamplePointColor(context, "rgba(37, 99, 235, 0.58)"),
                        borderColor: (context) => this.getSymbolicSamplePointColor(context, "#2563eb"),
                        pointRadius: (context) => this.getSymbolicSamplePointRadius(context, 3),
                        pointHoverRadius: 5
                    },
                    {
                        type: "line",
                        label: "y = x",
                        data: [{ x: minValue, y: minValue }, { x: maxValue, y: maxValue }],
                        borderColor: "#dc2626",
                        borderDash: [6, 5],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        showLine: true
                    }
                ],
                message: getText("Points close to the y=x line have smaller prediction errors. Large vertical gaps indicate rows that need review.")
            };
        },

        buildSymbolicResidualChartData(state = this.symbolicRuleChartState) {
            const points = (state?.evaluatedRows || []).map((item) => ({ x: item.predicted, y: item.residual, sampleIndex: item.rowIndex }));
            if (!points.length) {
                return { ok: false, message: getText("No numeric residual sample pairs are available.") };
            }
            const xValues = points.map((point) => point.x).filter(Number.isFinite);
            let minX = Math.min(...xValues);
            let maxX = Math.max(...xValues);
            if (minX === maxX) {
                const padding = Math.max(1, Math.abs(minX) * 0.05);
                minX -= padding;
                maxX += padding;
            }
            return {
                ok: true,
                type: "scatter",
                xLabel: this.getSymbolicAxisColumnLabel(state?.rule?.TARGET_COLUMN, state?.summary, getText("Predicted value")),
                yLabel: this.getSymbolicAxisColumnLabel(state?.rule?.TARGET_COLUMN, state?.summary, getText("Residual (actual - predicted)")),
                datasets: [
                    {
                        label: getText("Residual samples"),
                        data: points,
                        backgroundColor: (context) => this.getSymbolicSamplePointColor(context, "rgba(124, 58, 237, 0.56)"),
                        borderColor: (context) => this.getSymbolicSamplePointColor(context, "#7c3aed"),
                        pointRadius: (context) => this.getSymbolicSamplePointRadius(context, 3),
                        pointHoverRadius: 5
                    },
                    {
                        type: "line",
                        label: "y = 0",
                        data: [{ x: minX, y: 0 }, { x: maxX, y: 0 }],
                        borderColor: "#dc2626",
                        borderDash: [6, 5],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        showLine: true
                    }
                ],
                message: getText("Residuals should be distributed around zero without a clear pattern. Curves or widening bands can indicate model bias or changing variance.")
            };
        },

        buildSymbolicFeatureResponseChartData(state = this.symbolicRuleChartState) {
            const rule = state?.rule || {};
            const features = Array.isArray(rule.FEATURE_LIST) && rule.FEATURE_LIST.length
                ? rule.FEATURE_LIST
                : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const primary = features.includes(state?.primaryFeature) ? state.primaryFeature : features[0];
            if (!primary || !state?.evaluatedRows?.length) {
                return { ok: false, message: getText("No numeric feature samples are available for the response graph.") };
            }
            const observed = state.evaluatedRows
                .map((item) => ({ x: Number(item.values[primary]), y: item.actual, sampleIndex: item.rowIndex }))
                .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
            if (!observed.length) {
                return { ok: false, message: getText("The selected feature does not contain numeric sample values.") };
            }
            const compiled = this.compileSymbolicExpression(String(rule.EXPRESSION || ""), features);
            if (!compiled.ok) return compiled;
            const averages = {};
            features.forEach((feature) => {
                const values = state.evaluatedRows.map((item) => Number(item.values[feature])).filter(Number.isFinite);
                averages[feature] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
            });
            const xValues = observed.map((point) => point.x).sort((left, right) => left - right);
            const quantile = (ratio) => {
                if (xValues.length === 1) return xValues[0];
                const position = (xValues.length - 1) * ratio;
                const lower = Math.floor(position);
                const upper = Math.ceil(position);
                const weight = position - lower;
                return xValues[lower] + ((xValues[upper] - xValues[lower]) * weight);
            };
            let minX = quantile(0.05);
            let maxX = quantile(0.95);
            if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
                const range = (rule.FEATURE_RANGES || []).find((item) => String(item?.COLUMN_NAME || "").toUpperCase() === String(primary).toUpperCase()) || {};
                minX = Number(range.MIN_VALUE);
                maxX = Number(range.MAX_VALUE);
            }
            if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
                minX = Math.min(...xValues);
                maxX = Math.max(...xValues);
            }
            if (minX === maxX) {
                const padding = Math.max(1, Math.abs(minX) * 0.05);
                minX -= padding;
                maxX += padding;
            }
            const curvePoints = Array.from({ length: 80 }, (_, index) => {
                const x = minX + ((maxX - minX) * index) / 79;
                const values = { ...averages, [primary]: x };
                return { x, y: compiled.evaluate(values) };
            }).filter((point) => Number.isFinite(point.y));
            const visibleObserved = observed;
            if (!curvePoints.length) {
                return { ok: false, message: getText("The formula response could not be calculated for the selected feature range.") };
            }
            return {
                ok: true,
                type: "scatter",
                xLabel: this.getSymbolicAxisColumnLabel(primary, state?.summary),
                yLabel: this.getSymbolicAxisColumnLabel(rule.TARGET_COLUMN || "Y", state?.summary),
                datasets: [
                    {
                        label: getText("Observed target values"),
                        data: visibleObserved,
                        backgroundColor: (context) => this.getSymbolicSamplePointColor(context, "rgba(100, 116, 139, 0.42)"),
                        borderColor: (context) => this.getSymbolicSamplePointColor(context, "#64748b"),
                        pointRadius: (context) => this.getSymbolicSamplePointRadius(context, 3),
                        pointHoverRadius: 5
                    },
                    {
                        type: "line",
                        label: getText("Formula response curve"),
                        data: curvePoints,
                        borderColor: "#2563eb",
                        backgroundColor: "#2563eb",
                        borderWidth: 2.2,
                        pointRadius: 0,
                        showLine: true,
                        tension: compiled.profile?.isCurved ? 0.12 : 0
                    }
                ],
                message: getText("Observed target points are compared with the formula response over the sampled P05-P95 range while all other features are fixed at their sampled averages.")
            };
        },

        zoomSymbolicRuleChart(factor = 1) {
            const chart = this.symbolicRuleChart;
            const state = this.symbolicRuleChartState;
            if (!chart || !state) return;
            const currentPercent = Number(state.zoomPercent || 100);
            const nextPercent = Math.min(800, Math.max(50, currentPercent * Number(factor || 1)));
            const scaleFactor = currentPercent / nextPercent;
            ["x", "y"].forEach((axis) => {
                const scale = chart.scales?.[axis];
                if (!scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max)) return;
                const center = (scale.min + scale.max) / 2;
                const halfSpan = Math.max(Number.EPSILON, ((scale.max - scale.min) * scaleFactor) / 2);
                chart.options.scales[axis].min = center - halfSpan;
                chart.options.scales[axis].max = center + halfSpan;
            });
            state.zoomPercent = nextPercent;
            chart.update("none");
            this.updateSymbolicRuleZoomLabel();
        },

        resetSymbolicRuleChartZoom() {
            const chart = this.symbolicRuleChart;
            const state = this.symbolicRuleChartState;
            if (!chart || !state) return;
            ["x", "y"].forEach((axis) => {
                if (!chart.options.scales?.[axis]) return;
                delete chart.options.scales[axis].min;
                delete chart.options.scales[axis].max;
            });
            state.zoomPercent = 100;
            chart.update("none");
            this.updateSymbolicRuleZoomLabel();
        },

        updateSymbolicRuleZoomLabel() {
            const label = document.getElementById(`${PAGE_ID_PREFIX}SymbolicZoomLabel`);
            if (label) label.textContent = `${Math.round(this.symbolicRuleChartState?.zoomPercent || 100)}%`;
        },

        buildSymbolicRuleChartData(rule) {
            const features = Array.isArray(rule.FEATURE_LIST) && rule.FEATURE_LIST.length
                ? rule.FEATURE_LIST
                : this.parseFeatureList(rule.FEATURE_COLUMNS);
            const expression = String(rule.EXPRESSION || "").trim();
            if (!features.length || !expression) {
                return { ok: false, message: getText("Formula or input feature information is missing.") };
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
            const datasets = variants.map((variant) => {
                const data = xs.map((xValue) => {
                    const values = {};
                    features.forEach((feature) => {
                        if (feature === primary) values[feature] = xValue;
                        else if (feature === second && variant.value !== null) values[feature] = variant.value;
                        else values[feature] = getRange(feature).avg;
                    });
                    const yValue = compiled.evaluate(values);
                    return Number.isFinite(yValue) ? { x: xValue, y: yValue } : null;
                }).filter(Boolean);
                return {
                    type: "line",
                    label: variant.label,
                    data,
                    borderColor: variant.color,
                    backgroundColor: variant.color,
                    tension: compiled.profile && compiled.profile.isCurved ? 0.18 : 0.25,
                    pointRadius: compiled.profile && compiled.profile.isCurved ? 1 : 2,
                    showLine: true,
                    spanGaps: true
                };
            }).filter((dataset) => dataset.data.length);
            if (!datasets.length) {
                return { ok: false, message: getText("All calculated results are empty, so the graph cannot be created.") };
            }
            return {
                ok: true,
                type: "scatter",
                datasets,
                xLabel: this.getSymbolicAxisColumnLabel(primary, this.symbolicRuleChartState?.summary),
                yLabel: this.getSymbolicAxisColumnLabel(rule.TARGET_COLUMN || "Predicted y", this.symbolicRuleChartState?.summary),
                message: second
                    ? getText("{primary} is varied, and {second} is compared at min/avg/max. Other features are fixed at their average values.{curveNote}", { primary, second, curveNote: compiled.profile && compiled.profile.isCurved ? getText(" POWER/EXP/LOG style formulas are converted for calculation and displayed as curved graphs.") : "" })
                    : getText("{primary} is varied to display the predicted y change.{curveNote}", { primary, curveNote: compiled.profile && compiled.profile.isCurved ? getText(" POWER/EXP/LOG style formulas are converted for calculation and displayed as curved graphs.") : "" })
            };
        },

        normalizeSymbolicExpressionForChart(expression) {
            let expr = String(expression || "").trim();
            const usedFunctions = new Set();
            if (!expr) {
                return { ok: false, message: getText("Formula information is missing.") };
            }
            if (/[`"';&{}\[\]]/.test(expr)) {
                return { ok: false, message: getText("The formula contains characters that are not allowed for graph calculation.") };
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
                return { ok: false, message: getText("{unknown} in the formula is not in the feature list, so it was not calculated as a graph.", { unknown }) };
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
                return { ok: false, message: getText("Could not convert the formula into a graph function: {message}", { message: error.message }) };
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
                <section class="anly-work-type-summary">
                    <header>
                        <div>
                            <strong>${this.escapeHtml(getMessage("predictedTypeSummaryTitle", "Column Type Prediction Summary"))}</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)}</span>
                        </div>
                        <div class="anly-work-type-summary-actions">
                            <div class="anly-work-corr-metrics">
                                <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>${this.escapeHtml(getMessage("totalColumns", "Total columns"))}</small></span>
                                ${groups.map((group) => `
                                    <span><b>${this.formatNumber(group.columnCount)}</b><small>${this.escapeHtml(this.getPredictedTypeGroupLabel(group.typeGroup))}</small></span>
                                `).join("")}
                            </div>
                            ${this.renderTableResultPageTools("predictedTypePage", json)}
                        </div>
                    </header>
                    ${this.renderPredictedTypeUnifiedMode(sourceGroups, finalGroups, summary)}
                    ${matchGroups.length ? `
                        <div class="anly-work-type-detail">
                            <strong>${this.escapeHtml(getMessage("predictionMatchGroupTitle", "Applied FINAL / MODEL / RULE Prediction Type Detail Groups"))}</strong>
                            <div class="anly-work-type-case-grid">
                                <button type="button" class="${activeCase === "ALL" ? "is-active" : ""}" onclick="${PAGE_CODE}.selectPredictedTypeCase('ALL')" title="${this.escapeHtml(getMessage("allPredictionResultsTitle", "All prediction results"))}">
                                    <b>${this.escapeHtml(getMessage("all", "All"))}</b>
                                    <small>${this.escapeHtml(getMessage("columnsCount", "{count} columns", { count: this.formatNumber(summary.totalColumnCount) }))}</small>
                                </button>
                                ${matchGroups.map((group) => `
                                    <button type="button" class="${activeCase === group.caseCode ? "is-active" : ""}" onclick="${PAGE_CODE}.selectPredictedTypeCase('${this.escapeJs(group.caseCode)}')" title="${this.escapeHtml(this.getPredictionMatchDescription(group))}">
                                        <b>${this.escapeHtml(this.getPredictionMatchLabel(group))}</b>
                                        <small>${this.escapeHtml(getMessage("columnsRate", "{count} columns · {rate}%", { count: this.formatNumber(group.columnCount), rate: this.formatDecimal(group.rate) }))}</small>
                                        <em>${this.escapeHtml(this.getPredictionMatchDescription(group))}</em>
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
                return `<div class="table-empty">${this.escapeHtml(getMessage("noPredictionColumns", "No RULE / MODEL / FINAL prediction column information is available."))}</div>`;
            }
            return `
                <div class="anly-work-type-source-grid">
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
                            description: getMessage("finalAppliedPredictionDescription", "Final applied INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_PREDICTED_TYPE")
                        };
                    }
                    return {
                        ...source,
                        description: getMessage("runIdBasedPredictionDescription", "{method} RUN_ID based {column}", { method: methodLabel, column: source.sourceColumn || "" }).trim()
                    };
                }
                if (code === "FINAL" && Array.isArray(finalGroups) && finalGroups.length) {
                    return {
                        sourceCode: "FINAL",
                        sourceLabel: "FINAL",
                        sourceColumn: "FINAL_PREDICTED_TYPE",
                        description: getMessage("finalAppliedPredictionDescription", "Final applied INIT$_TB_PREDICTED_TYPE_FINAL.FINAL_PREDICTED_TYPE"),
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
                return this.renderPredictedTypeVersion(
                    getMessage("runBasedTitle", "RUN based"),
                    getMessage("runBasedPredictionNote", "INIT$_TB_PREDICTED_TYPE prediction value at {method} execution", { method: methodLabel }),
                    fallbackGroups,
                    summary
                );
            }
            return `
                <section class="anly-work-type-version">
                    <header>
                        <strong>${this.escapeHtml(getMessage("runBasedTitle", "RUN based"))}</strong>
                        <span>${this.escapeHtml(getMessage("runBasedPredictionNote", "INIT$_TB_PREDICTED_TYPE prediction value at {method} execution", { method: methodLabel }))}</span>
                    </header>
                    <div class="anly-work-type-run-source-grid">
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
                <section class="anly-work-type-source ${sourceClass} ${compact ? "is-compact" : ""}">
                    <header>
                        <strong>${this.escapeHtml(source.sourceLabel || source.sourceCode || "-")}</strong>
                        <span>${this.escapeHtml(source.description || source.sourceColumn || "")}</span>
                        <small>${this.escapeHtml(getMessage("columnsCount", "{count} columns", { count: this.formatNumber(total) }))}</small>
                    </header>
                    <div class="anly-work-type-source-groups">
                        ${groups.map((group) => this.renderPredictedTypeGroup(group, summary)).join("")}
                    </div>
                </section>
            `;
        },

        renderPredictedTypeVersion(title, note, groups = [], summary = null) {
            const safeGroups = Array.isArray(groups) ? groups : [];
            return `
                <section class="anly-work-type-version">
                    <header>
                        <strong>${this.escapeHtml(title)}</strong>
                        <span>${this.escapeHtml(note)}</span>
                    </header>
                    <div class="anly-work-type-group-grid">
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
                <article class="anly-work-type-group">
                    <header>
                        <strong>${this.escapeHtml(this.getPredictedTypeGroupLabel(group.typeGroup))}</strong>
                        <small>${this.escapeHtml(getMessage("columnsCount", "{count} columns", { count: this.formatNumber(group.columnCount) }))}</small>
                    </header>
                    <div class="anly-work-corr-tags">
                        ${visibleColumns.map((column) => this.renderColumnChip(column, summary || group)).join("")}
                        ${hiddenCount ? `<em class="anly-work-column-chip">${this.escapeHtml(getMessage("moreColumns", "+{count} more", { count: this.formatNumber(hiddenCount) }))}</em>` : ""}
                    </div>
                </article>
            `;
        },

        getPredictedTypeGroupLabel(value) {
            const text = String(value || "").trim();
            const normalized = text.toUpperCase();
            if (normalized === "\uBC94\uC8FC\uD615" || normalized === "CATEGORICAL" || normalized === "CATEGORY" || normalized === "CAT") {
                return getMessage("predictedGroupCategorical", "Categorical");
            }
            if (normalized === "\uC5F0\uC18D\uD615" || normalized === "NUMERIC" || normalized === "CONTINUOUS" || normalized === "NUMBER") {
                return getMessage("predictedGroupContinuous", "Continuous");
            }
            if (normalized === "\uAE30\uD0C0" || normalized === "OTHER" || normalized === "ETC") {
                return getMessage("predictedGroupOther", "Other");
            }
            return text;
        },

        getPredictionMatchLabel(group = {}) {
            const code = String(group.caseCode || "").toUpperCase();
            const labels = {
                ALL_MATCH: getMessage("predictionCaseAllMatch", "FINAL = MODEL = RULE"),
                FINAL_MODEL: getMessage("predictionCaseFinalModel", "FINAL = MODEL, RULE differs"),
                FINAL_BASE: getMessage("predictionCaseFinalRule", "FINAL = RULE, MODEL differs"),
                MODEL_BASE: getMessage("predictionCaseModelRule", "MODEL = RULE, FINAL differs"),
                ALL_DIFFERENT: getMessage("predictionCaseAllDifferent", "All three differ"),
                HAS_MISSING: getMessage("predictionCaseHasMissing", "Includes missing value")
            };
            return labels[code] || group.label || code || "-";
        },

        getPredictionMatchDescription(group = {}) {
            const code = String(group.caseCode || "").toUpperCase();
            const descriptions = {
                ALL_MATCH: getMessage("predictionCaseAllMatchDesc", "All three predictions match. Strong recommendation."),
                FINAL_MODEL: getMessage("predictionCaseFinalModelDesc", "Final decision matches the model prediction."),
                FINAL_BASE: getMessage("predictionCaseFinalRuleDesc", "Final decision matches the RULE prediction."),
                MODEL_BASE: getMessage("predictionCaseModelRuleDesc", "Model and RULE predictions match."),
                ALL_DIFFERENT: getMessage("predictionCaseAllDifferentDesc", "All three predictions differ. Review is required."),
                HAS_MISSING: getMessage("predictionCaseHasMissingDesc", "FINAL / MODEL / RULE includes an empty value.")
            };
            return descriptions[code] || group.description || "";
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
                    <article class="anly-work-rule-card">
                        <strong>Rule #${this.escapeHtml(rule.ruleId)}</strong>
                        <p><b>IF</b> ${this.escapeHtml(rule.ifText || getText("No condition information"))}</p>
                        <p><b>THEN</b> ${this.escapeHtml(rule.thenText || getText("No result information"))}</p>
                        <small>support ${this.formatPercent(row.RULE_SUPPORT)} · confidence ${this.formatPercent(row.RULE_CONFIDENCE)} · lift ${this.escapeHtml(row.RULE_LIFT ?? "-")}</small>
                    </article>
                `;
            }).join("");
            return `<section class="anly-work-rule-grid">${rules || `<div class="table-empty">${this.escapeHtml(getText("No rule cards match the condition. You can check the original rows in the table below."))}</div>`}</section>`;
        },

        renderRuleFilterBar() {
            return `
                <div class="anly-work-rule-filter-bar">
                    <label>
                        <input type="checkbox" ${this.excludeEmptyConsequent ? "checked" : ""} onchange="${PAGE_CODE}.toggleExcludeEmptyConsequent(this.checked)">
                        <span>${this.escapeHtml(getText("Exclude missing result"))}</span>
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
            const viewButton = getContainerEl("#resultPanel-${PAGE_CODE} .anly-work-result-header nav button.is-active");
            const viewType = viewButton?.textContent?.trim?.() || "VR";
            this.loadModelView(viewType, 1);
        },

        getNodeJobDesc(node = this.selectedNode) {
            return String(node?.JOB_DESC || node?.NODE_DESC || "").trim();
        },

        renderNodeJobDesc(node) {
            const desc = this.getNodeJobDesc(node);
            return desc ? `<em class="anly-work-node-desc" title="${this.escapeHtml(desc)}">Job Desc: ${this.escapeHtml(desc)}</em>` : "";
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
            return title ? `<small class="anly-work-node-exec" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</small>` : "";
        },

        renderSelectedNodeJobDesc() {
            const desc = this.getNodeJobDesc();
            return desc ? `<p class="anly-work-result-job-desc" title="${this.escapeHtml(desc)}"><b>Job Desc</b> ${this.escapeHtml(desc)}</p>` : "";
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
                ? getMessage("resultModeModel", "M (Model)")
                : (String(resultMode || "").toUpperCase() === "T" ? getMessage("resultModeTable", "T (Table)") : resultMode);
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
                <section class="anly-work-execution-meta ${this.getNodeTone(node)}">
                    <div class="anly-work-execution-meta-grid">
                        ${metaRows.map(({ key, label, value }) => `
                            <span class="is-${this.escapeHtml(key)}">
                                <small>${this.escapeHtml(label)}</small>
                                <b title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</b>
                            </span>
                        `).join("")}
                    </div>
                    ${paramEntries.length ? `
                        <details class="anly-work-param-details">
                            <summary>${this.escapeHtml(getMessage("callOptionParamsCount", "{count} call option parameter(s)", { count: this.formatNumber(paramEntries.length) }))}</summary>
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
                { key: "P_TARGET_OWNER", comment: getMessage("paramDescTargetOwner", "Target table owner"), defaultValue: ":INIT$TargetOwner" },
                { key: "P_TARGET_TABLE", comment: getMessage("paramDescTargetTable", "Target table name"), defaultValue: ":INIT$TargetTable" },
                { key: "P_DYNAMIC_MODEL_NAME", comment: getMessage("paramDescDynamicModelName", "Classification/prediction model name"), defaultValue: "OML_DECISION_TREE_MODEL_01" },
                { key: "P_PREDICTION_METHOD", comment: getMessage("paramDescPredictionMethod", "Prediction method (ONLY_RULE: BASE columns only, ONLY_MODEL: model columns only, ONLY_BOTH: BASE/MODEL columns, FINAL_RULE/MODEL/BOTH: apply FINAL automatically)"), defaultValue: "ONLY_BOTH" },
                { key: "P_RUN_SOURCE_TYPE", comment: getMessage("paramDescRunSourceType", "Run source type (DATA_WORK/FLOW_WORK)"), defaultValue: ":INIT$RunSourceType" },
                { key: "P_RUN_ID", comment: getMessage("paramDescRunId", "Execution history ID"), defaultValue: ":INIT$RunId" }
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

        getNodeActualAnalysisParamValue(name, fallback = "", node = this.selectedNode) {
            const payload = this.normalizeObject(node?.PAYLOAD);
            const runtimeParamMap = this.buildRuntimeParamValueMap(this.normalizeObject(node?.RUNTIME_PARAMS), node, payload);
            const normalizedName = this.normalizeRuntimeParamKey(name);
            const matchesAnalysisParam = (candidate) => {
                const normalizedCandidate = this.normalizeRuntimeParamKey(candidate);
                return normalizedCandidate === normalizedName || normalizedCandidate === `input${normalizedName}`;
            };
            const apiResult = this.normalizeObject(node?.RUN_OUTPUT)?.apiResult
                || this.normalizeObject(node?.runOutput)?.apiResult
                || {};
            const executedCriteria = {
                ...this.normalizeObject(apiResult?.continuousCriteria),
                ...this.normalizeObject(apiResult?.relationCriteria)
            };
            const criteriaKeys = {
                pminr2score: "minR2Score",
                pmaxautotargets: "maxAutoTargets",
                pmaxfeatures: "maxFeatures",
                pclusterusagemode: "clusterUsageMode",
                ptargetcolumn: "targetColumn",
                pminmetric: "minMetric",
                pmincramer: "minCramer",
                pminabscorr: "minAbsCorr",
                pmineta: "minEta",
                pminpvalue: "minPvalue",
                pminrows: "minRows"
            };
            const executedKey = criteriaKeys[normalizedName];
            if (executedKey && executedCriteria[executedKey] !== undefined && executedCriteria[executedKey] !== null) {
                return executedCriteria[executedKey];
            }

            const runtimeEntry = [...runtimeParamMap.entries()].find(([key]) => matchesAnalysisParam(key));
            if (runtimeEntry) {
                const runtimeValue = this.resolveRuntimeParamDisplayValue(runtimeEntry[1], runtimeParamMap);
                if (runtimeValue !== undefined && runtimeValue !== null && String(runtimeValue).trim() !== "") return runtimeValue;
            }

            const definitionSources = [
                this.normalizeRuntimeParamDefinitionList(node?.JOB_PARAM_JSON || node?.jobParamJson),
                this.normalizeRuntimeParamDefinitionList(payload?.params || payload?.PARAMS)
            ];
            for (const definitions of definitionSources) {
                const definition = definitions.find((item, index) =>
                    matchesAnalysisParam(this.getRuntimeParamDefinitionName(item, index))
                );
                if (!definition) continue;
                const actualValue = this.resolveRuntimeParamDisplayValue(this.getRuntimeParamDefinitionDefault(definition), runtimeParamMap);
                if (actualValue !== undefined && actualValue !== null && String(actualValue).trim() !== "") return actualValue;
            }
            return fallback;
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
                <span class="anly-work-column-ref" title="${this.escapeHtml(`${column}: ${comment}`)}">
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
                <em class="anly-work-column-chip" title="${this.escapeHtml(comment ? `${column}: ${comment}` : column)}">
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
                const thenText = consequentText && !this.ruleTextHasExplicitValue(consequentText) && !this.isValueUnavailableText(consequentText)
                    ? `${consequentText} (${getText("Value unavailable")})`
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
                    mappingLabel: mapped ? getText("Condition/result mapped") : getText("ID/metric focused"),
                    ifText: mapped ? antecedentText : getText("Review the condition item combination in Detail Views."),
                    thenText: mapped ? thenText : getText("Review the result item in Detail Views."),
                    note: mapped && missingConsequentValue
                        ? getText("Conditions were interpreted as column = value from XML itemsets. The result model view provides only the column name, so the value is not visible in the current view.")
                        : (mapped
                            ? getText("Built a readable sentence using XML itemsets and item dictionary candidates from the model detail view.")
                            : getText("The current DM$VR/DM$VI/DM$VA sample does not show a condition/result mapping that can be restored to column names and values.")),
                    metrics: [
                        { label: "support", value: support === null ? "-" : this.formatPercentMetric(support) },
                        { label: "confidence", value: confidence === null ? "-" : this.formatPercentMetric(confidence) },
                        { label: getText("Expected violation"), value: this.formatExpectedViolationRate(confidence) },
                        { label: "lift", value: lift === null ? "-" : this.formatDecimal(lift) }
                    ],
                    conditionCount,
                    thenText
                };
            });
        },

        countRuleConditions(text) {
            const normalized = String(text || "").trim();
            if (!normalized || normalized === getText("Review the condition item combination in Detail Views.")) return 0;
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
            if (field) return `${field} (${getText("Value unavailable")})`;
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
            return !text || text === getText("No result information") || text === "\uACB0\uACFC \uC815\uBCF4 \uC5C6\uC74C" || this.isValueUnavailableText(text);
        },

        isValueUnavailableText(value) {
            const text = String(value || "");
            return text.includes(getText("Value unavailable")) || text.includes("\uAC12 \uC815\uBCF4 \uC5C6\uC74C");
        },

        renderGrid(columns, rows, source = null) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__");
            if (!safeColumns.length) return `<div class="table-empty">${this.escapeHtml(getText("No query results."))}</div>`;
            const page = Math.max(1, Number(source?.page || 1));
            const pageSize = Math.max(1, Number(source?.pageSize || rows?.length || 1));
            const rowOffset = (page - 1) * pageSize;
            return `
                <div class="anly-work-grid-wrap">
                    <table class="table-grid anly-work-grid" data-grid-row-offset="${rowOffset}">
                        <thead>
                            <tr>
                                ${safeColumns.map((column) => `<th>${this.renderColumnAwareCell(column, source)}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>
                            ${(rows || []).map((row) => `
                                <tr>
                                    ${safeColumns.map((column) => {
                                        const value = row?.[column] ?? "";
                                        return `<td title="${this.escapeHtml(value)}">${this.renderColumnAwareCell(value, source)}</td>`;
                                    }).join("")}
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        renderResultPager(page, pageSize, total, callPrefix) {
            callPrefix = resolvePageText(callPrefix);
            const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 1)));
            const normalizedPage = Math.max(1, Number(page || 1));
            const prev = Math.max(1, normalizedPage - 1);
            const next = Math.min(totalPages, normalizedPage + 1);
            if (!String(callPrefix || "").includes("refreshResultGridOnly")) {
                return `
                    <footer class="anly-work-pager">
                        <span class="anly-work-pager-total">${this.escapeHtml(getText("Grid total {count} rows", { count: this.formatNumber(total || 0) }))}</span>
                        <button type="button" ${normalizedPage <= 1 ? "disabled" : ""} onclick="${callPrefix}${prev})"><i class="fas fa-chevron-left"></i></button>
                        <span class="anly-work-pager-page">${this.formatNumber(normalizedPage)} / ${this.formatNumber(totalPages)}</span>
                        <button type="button" ${normalizedPage >= totalPages ? "disabled" : ""} onclick="${callPrefix}${next})"><i class="fas fa-chevron-right"></i></button>
                    </footer>
                `;
            }
            const pageCall = String(callPrefix || "").replace(/\($/, "");
            const inputId = `resultBottomPage-${PAGE_CODE}`;
            const goOnclick = `${PAGE_CODE}.goTableResultPage('${inputId}')`;
            return `
                <footer class="anly-work-pager">
                    <span class="anly-work-pager-total">${this.escapeHtml(getText("Grid total {count} rows", { count: this.formatNumber(total || 0) }))}</span>
                    ${this.renderSamplePageJump(inputId, { page, pageSize, total }, goOnclick, pageCall, {
                        pageSizeId: `${inputId}-pageSize`,
                        pageSizes: [20, 50, 100, 200, 500],
                        onPageSizeChange: `${PAGE_CODE}.changeResultPageSize(this.value)`
                    })}
                </footer>
            `;
        },

        exportCurrent() {
            const columns = this.currentExport.columns || [];
            const rows = this.currentExport.rows || [];
            if (!columns.length) {
                alert(getText("No data to export."));
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
                else if (field) items.push(`${field} (${getText("Value unavailable")})`);
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

        isCorrelationPairNode(node) {
            return ["INIT$_TB_CAT_CORR_PAIR", "INIT$_TB_NUM_CORR_PAIR"].includes(
                String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase()
            );
        },

        isRelationPairNode(node) {
            return String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase() === "INIT$_TB_RELATION_PAIR";
        },

        isRelationNetworkResultNode(node) {
            return ["INIT$_TB_RELATION_NETWORK_NODE", "INIT$_TB_RELATION_NETWORK_EDGE"].includes(
                String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase()
            );
        },

        isLassoFeatureNode(node) {
            return String(node?.RESULT_OBJECT_NAME || "").trim().toUpperCase() === "INIT$_TB_LASSO_FEATURE";
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
