(function() {
    if (!window.MCOMMON) window.MCOMMON = {};

    const EDIT_CONTEXT_KEY = "INIT_EDIT_WORK_CONTEXT";
    const STAGES = Object.freeze([
        { pageCode: "M05001", step: "01", title: "발굴 규칙 판단", shortTitle: "규칙 판단", icon: "fa-list-check", mode: "DISCOVERED_RULES", description: "발굴된 규칙을 검토하고 편집 규칙으로 최종 선정하거나 제외합니다." },
        { pageCode: "M05001_RULE_MASTER", step: "02", title: "편집 규칙 마스터", shortTitle: "규칙 마스터", icon: "fa-clipboard-check", mode: "RULE_MASTER", description: "선정 규칙과 사용자 정의 규칙을 통합 관리합니다." },
        { pageCode: "M05002", step: "03", title: "오류 수정", shortTitle: "오류 수정", icon: "fa-eraser", mode: "VIOLATIONS", description: "최종 규칙의 위반 행을 조회하고 INITDN$ 편집본에서 바로 수정합니다." },
        { pageCode: "M05002_CLEANSING", step: "04", title: "오류 수정 이력", shortTitle: "수정 이력", icon: "fa-clock-rotate-left", mode: "CHANGE_HISTORY", description: "작업 이력별 오류 수정값과 처리 결과를 조회합니다." },
        { pageCode: "M05003", step: "05", title: "에디팅 효과 검증", shortTitle: "효과 검증", icon: "fa-chart-column", mode: "VALIDATION", description: "변경 효과를 확인하고 INITDN$ 기준 Flow 재분석 결과를 연결합니다." },
        { pageCode: "M05003_FINAL_APPLY", step: "06", title: "운영 반영 DML", shortTitle: "운영 반영", icon: "fa-database", mode: "FINAL_APPLY", description: "DML을 생성하고 필요하면 별도로 검증한 뒤, 저장된 SQL을 실행하여 운영 데이터에 반영합니다." },
        { pageCode: "M05003_HISTORY", step: "07", title: "에디팅 감사 이력", shortTitle: "전체 이력", icon: "fa-clock-rotate-left", mode: "HISTORY", description: "규칙 판단부터 최종 반영까지 모든 에디팅 이벤트를 조회합니다." }
    ]);
    const STAGE_MAP = Object.freeze({
        ...Object.fromEntries(STAGES.map((stage) => [stage.pageCode, stage])),
        M07001: STAGES[4],
        M07002: STAGES[5],
        M07003: STAGES[6]
    });
    const WORKSPACE_TABS = Object.freeze({
        M05001: Object.freeze([
            { stageCode: "M05001", labelKey: "ruleDecisionTab", label: "규칙 판단", icon: "fa-list-check" },
            { stageCode: "M05001_RULE_MASTER", labelKey: "ruleMasterTab", label: "규칙 마스터", icon: "fa-clipboard-check" }
        ]),
        M05002: Object.freeze([
            { stageCode: "M05002", labelKey: "violationEditTab", label: "오류 수정", icon: "fa-eraser" },
            { stageCode: "M05002_CLEANSING", labelKey: "changeHistoryTab", label: "수정 이력", icon: "fa-clock-rotate-left" }
        ]),
        M05003: Object.freeze([
            { stageCode: "M05003", labelKey: "effectValidationTab", label: "효과 검증", icon: "fa-chart-column" },
            { stageCode: "M05003_FINAL_APPLY", labelKey: "finalApplyTab", label: "운영 반영", icon: "fa-database" },
            { stageCode: "M05003_HISTORY", labelKey: "editingHistoryTab", label: "전체 이력", icon: "fa-clock-rotate-left" }
        ])
    });
    const TABLE_SELECTION_MODES = Object.freeze([
        "VIOLATIONS",
        "CHANGE_HISTORY",
        "VALIDATION",
        "FINAL_APPLY",
        "HISTORY"
    ]);

    window.MCOMMON.createEditWorkPage = function(config = {}) {
        const PAGE_CODE = config.pageCode || "M05001";
        const INITIAL_STAGE = STAGE_MAP[PAGE_CODE] || STAGES[0];
        const pageHelper = PageManager.createHelper(PAGE_CODE);
        const getContainerEl = (selector) => pageHelper.getContainerEl(selector);
        const apiUrl = (path) => `${API_BASE_URL}/${PAGE_CODE}${path}`;

        const page = {
            pageCode: PAGE_CODE,
            activeStagePageCode: PAGE_CODE,
            stage: INITIAL_STAGE,
            projects: [],
            scenarios: [],
            sessions: [],
            rows: [],
            gridColumns: [],
            selectedRuleIds: new Set(),
            selectedViolationRowKeys: new Set(),
            selectedSessionId: "",
            selectedDmlId: "",
            selectedDml: null,
            dmlSavedName: "",
            dmlSavedSql: "",
            dmlValidatedSql: "",
            currentValidation: null,
            page: 1,
            pageSize: 100,
            keyword: "",
            freezeColumns: 0,
            freezeColumnsInitialized: false,
            ruleRunSource: "",
            ruleRunId: "",
            ruleGroup: "ALL",
            ruleDecisionStatus: "ALL",
            stageFilters: {},
            serverPaging: false,
            serverTotalRows: 0,
            keywordTimer: null,
            ruleRequestId: 0,
            ruleDecisionSaving: false,
            refreshPromise: null,
            workspaceSwitching: false,
            editWorkspaceCache: new Map(),
            currentExport: { filename: "editing-data.csv", columns: [], rows: [] },
            pendingContext: {},
            initialized: false,
            contextSyncing: false,
            workContextCollapsed: false,
            userRuleTables: [],
            userRuleColumns: [],
            userRuleValidation: null,
            selectedMasterRule: null,
            selectedMasterRuleId: "",
            editingUserRuleId: null,
            userRuleCopyMode: false,
            masterSelectionRequestId: 0,
            detailDrag: null,
            detailLayerOpener: null,
            violationRules: [],
            violationSourceTables: [],
            violationSourceTablesLoaded: false,
            editingTableStatus: null,
            selectedViolationRuleId: "ALL",
            selectedViolationRule: null,
            selectedViolationRules: [],
            violationRuleScopeIds: new Set(),
            generatedViolationSql: "",
            editingWorkStarting: false,

            async init() {
                this.initialized = false;
                this.resetTransientState();
                this.pendingContext = this.readPendingContext();
                const stored = this.readContext();
                const hasPendingContext = Object.keys(this.pendingContext || {}).length > 0;
                const legacyRuleMasterTab = PAGE_CODE === "M05001" && stored.ruleWorkspaceTab === "M05002"
                    ? "M05001_RULE_MASTER"
                    : "";
                const storedWorkspaceTab = stored.editWorkspaceTabs?.[PAGE_CODE]
                    || legacyRuleMasterTab
                    || PAGE_CODE;
                this.setEditWorkspaceStage(hasPendingContext ? PAGE_CODE : storedWorkspaceTab);
                this.ruleRunSource = String(this.pendingContext.runSourceType || stored.ruleRunSource || "").toUpperCase();
                this.ruleRunId = String(this.pendingContext.runId || stored.ruleRunId || "");
                this.ruleGroup = String(stored.ruleGroup || "ALL").toUpperCase();
                this.ruleDecisionStatus = String(stored.ruleDecisionStatus || "ALL").toUpperCase();
                this.renderShell();
                await this.loadProjects(this.pendingContext.projectId || stored.projectId || "");
                if (!getContainerEl(`#projectId-${PAGE_CODE}`)?.value) {
                    this.setKpis([{ value: "-", label: "프로젝트", hint: "조회 가능한 프로젝트가 없습니다." }]);
                    this.renderEmpty("먼저 작업할 프로젝트를 등록하거나 접근 권한을 확인하세요.");
                    this.initialized = true;
                    return;
                }
                await this.loadScenarios(this.pendingContext.scenarioId || stored.scenarioId || "");
                if (this.usesEditSession()) {
                    await this.loadSessions(this.pendingContext.editSessionId || stored.editSessionId || "");
                }
                this.persistContext();
                this.setWorkContextCollapsed(true);
                await this.refresh();
                this.initialized = true;
            },

            async onShow() {
                if (!this.initialized || this.contextSyncing) return;
                const stored = this.readContext();
                const currentProjectId = getContainerEl(`#projectId-${PAGE_CODE}`)?.value || "";
                const currentScenarioId = getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value || "";
                const nextProjectId = String(stored.projectId || "");
                const nextScenarioId = String(stored.scenarioId || "");
                if (currentProjectId === nextProjectId && currentScenarioId === nextScenarioId) {
                    if (this.usesEditSession()) {
                        this.invalidateEditWorkspaceCache();
                        this.violationSourceTablesLoaded = false;
                        await this.loadSessions(stored.editSessionId || this.selectedSessionId || "");
                        await this.refresh();
                    }
                    return;
                }

                this.contextSyncing = true;
                try {
                    this.invalidateEditWorkspaceCache();
                    this.page = 1;
                    this.keyword = "";
                    this.selectedRuleIds.clear();
                    this.clearViolationContext();
                    this.ruleRunSource = String(stored.ruleRunSource || "").toUpperCase();
                    this.ruleRunId = String(stored.ruleRunId || "");
                    this.ruleGroup = String(stored.ruleGroup || "ALL").toUpperCase();
                    this.ruleDecisionStatus = String(stored.ruleDecisionStatus || "ALL").toUpperCase();
                    this.renderShell();
                    await this.loadProjects(nextProjectId);
                    if (!getContainerEl(`#projectId-${PAGE_CODE}`)?.value) {
                        this.setKpis([{ value: "-", label: "프로젝트", hint: "조회 가능한 프로젝트가 없습니다." }]);
                        this.renderEmpty("먼저 작업할 프로젝트를 등록하거나 접근 권한을 확인하세요.");
                        return;
                    }
                    await this.loadScenarios(nextScenarioId);
                    if (this.usesEditSession()) await this.loadSessions(stored.editSessionId || "");
                    this.persistContext();
                    this.setWorkContextCollapsed(true);
                    await this.refresh();
                } finally {
                    this.contextSyncing = false;
                }
            },

            destroy() {
                window.DescriptiveStatistics?.close?.();
                this.initialized = false;
                this.closeDetailLayer();
                this.rows = [];
                this.sessions = [];
                this.selectedRuleIds = new Set();
                this.selectedViolationRowKeys = new Set();
                this.violationRules = [];
                this.violationSourceTables = [];
                this.violationSourceTablesLoaded = false;
                this.editingTableStatus = null;
                this.selectedViolationRuleId = "ALL";
                this.selectedViolationRule = null;
                this.selectedViolationRules = [];
                this.violationRuleScopeIds = new Set();
                this.generatedViolationSql = "";
                this.editingWorkStarting = false;
                this.currentValidation = null;
                this.detailLayerOpener = null;
                if (this.keywordTimer) clearTimeout(this.keywordTimer);
                this.keywordTimer = null;
                this.ruleRequestId += 1;
                this.refreshPromise = null;
                this.workspaceSwitching = false;
                this.editWorkspaceCache.clear();
            },

            resetTransientState() {
                this.page = 1;
                this.pageSize = 100;
                this.keyword = "";
                this.freezeColumns = 0;
                this.freezeColumnsInitialized = false;
                this.ruleRunSource = "";
                this.ruleRunId = "";
                this.ruleGroup = "ALL";
                this.ruleDecisionStatus = "ALL";
                this.stageFilters = {};
                this.serverPaging = false;
                this.serverTotalRows = 0;
                this.selectedRuleIds = new Set();
                this.selectedViolationRowKeys = new Set();
                this.selectedDml = null;
                this.selectedDmlId = "";
                this.dmlSavedName = "";
                this.dmlSavedSql = "";
                this.dmlValidatedSql = "";
                this.userRuleValidation = null;
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                this.violationRules = [];
                this.violationSourceTables = [];
                this.violationSourceTablesLoaded = false;
                this.editingTableStatus = null;
                this.selectedViolationRuleId = "ALL";
                this.selectedViolationRule = null;
                this.selectedViolationRules = [];
                this.violationRuleScopeIds = new Set();
                this.generatedViolationSql = "";
                this.editingWorkStarting = false;
                this.detailLayerOpener = null;
                this.masterSelectionRequestId += 1;
                this.refreshPromise = null;
                this.workspaceSwitching = false;
                this.editWorkspaceCache = new Map();
            },

            readPendingContext() {
                const legacyContextKeys = {
                    M05003: ["M07001:editContext", "M07002:editContext", "M07003:editContext"]
                };
                const keys = [`${PAGE_CODE}:editContext`, ...(legacyContextKeys[PAGE_CODE] || [])];
                for (const key of keys) {
                    try {
                        const raw = sessionStorage.getItem(key);
                        if (!raw) continue;
                        sessionStorage.removeItem(key);
                        return JSON.parse(raw) || {};
                    } catch (error) {
                        sessionStorage.removeItem(key);
                    }
                }
                return {};
            },

            readContext() {
                try {
                    return JSON.parse(localStorage.getItem(EDIT_CONTEXT_KEY) || "{}") || {};
                } catch (error) {
                    return {};
                }
            },

            persistContext() {
                const stored = this.readContext();
                const context = {
                    projectId: getContainerEl(`#projectId-${PAGE_CODE}`)?.value || "",
                    scenarioId: getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value || "",
                    editSessionId: getContainerEl(`#editSessionId-${PAGE_CODE}`)?.value || "",
                    runSourceType: this.pendingContext.runSourceType || "",
                    runId: this.pendingContext.runId || "",
                    ruleRunSource: this.ruleRunSource || "",
                    ruleRunId: this.ruleRunId || "",
                    ruleGroup: this.ruleGroup || "ALL",
                    ruleDecisionStatus: this.ruleDecisionStatus || "ALL",
                    targetOwner: this.pendingContext.targetOwner || "",
                    targetTable: this.pendingContext.targetTable || "",
                    editWorkspaceTabs: {
                        ...(stored.editWorkspaceTabs || {}),
                        ...(WORKSPACE_TABS[PAGE_CODE] ? { [PAGE_CODE]: this.activeStagePageCode } : {})
                    }
                };
                localStorage.setItem(EDIT_CONTEXT_KEY, JSON.stringify(context));
            },

            renderShell() {
                const container = document.getElementById(`container-${PAGE_CODE}`);
                container?.classList.toggle("is-discovered-rules", this.stage.mode === "DISCOVERED_RULES");
                container?.classList.toggle("is-rule-master", this.stage.mode === "RULE_MASTER");
                container?.classList.toggle("is-final-apply", this.stage.mode === "FINAL_APPLY");
                container?.classList.toggle("is-error-editing-page", ["M05002", "M05003"].includes(PAGE_CODE));
                const workspaceTabs = getContainerEl(`#editWorkspaceTabs-${PAGE_CODE}`);
                if (workspaceTabs) {
                    const tabs = WORKSPACE_TABS[PAGE_CODE] || [];
                    workspaceTabs.hidden = !tabs.length;
                    workspaceTabs.innerHTML = tabs.map((tab) => {
                        const active = tab.stageCode === this.activeStagePageCode;
                        return `
                            <button type="button"
                                    class="table-tab ${active ? "is-active" : ""}"
                                    data-edit-workspace-tab="${this.escapeHtml(tab.stageCode)}"
                                    aria-selected="${String(active)}"
                                    onclick="${PAGE_CODE}.switchEditWorkspaceTab('${this.escapeHtml(tab.stageCode)}')">
                                <i class="fas ${this.escapeHtml(tab.icon)}"></i>
                                <span>${this.escapeHtml(this.pageLabel(tab.labelKey, tab.label))}</span>
                            </button>
                        `;
                    }).join("");
                }
                const modeForm = getContainerEl(`#modeForm-${PAGE_CODE}`);
                const workContent = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (modeForm && workContent) {
                    if (this.stage.mode === "RULE_MASTER") {
                        workContent.insertAdjacentElement("afterend", modeForm);
                    } else {
                        workContent.insertAdjacentElement("beforebegin", modeForm);
                    }
                }
                const keyword = getContainerEl(`#gridKeyword-${PAGE_CODE}`);
                if (keyword) {
                    keyword.value = "";
                    const liveViolationMode = this.stage.mode === "VIOLATIONS";
                    keyword.placeholder = this.stage.mode === "DISCOVERED_RULES"
                        ? "컬럼 ID·규칙 ID·IF·THEN 검색"
                        : (liveViolationMode
                            ? "행 식별값·실제값 검색"
                            : (this.stage.mode === "CHANGE_HISTORY" ? "규칙명·행 식별값·변경값 검색" : "현재 목록 검색"));
                    keyword.title = this.stage.mode === "DISCOVERED_RULES"
                        ? "전체 발굴 규칙을 서버 SQL로 검색합니다."
                        : (liveViolationMode
                            ? "선택한 최종 규칙의 실제 테이블 위반 행을 서버 SQL로 검색합니다."
                            : "현재 조회된 목록에서 검색합니다.");
                }
                const sessionContext = getContainerEl(".edit-work-session-context");
                if (sessionContext) {
                    sessionContext.hidden = !this.showsExecutionHistorySelector();
                }
                const sourceContext = getContainerEl(`#sourceContext-${PAGE_CODE}`);
                const sourceContextField = sourceContext?.closest?.(".edit-work-source-context-field");
                if (sourceContextField) {
                    sourceContextField.hidden = !this.usesEditSession();
                }
                const editingTableGrid = getContainerEl(`#editingTableGrid-${PAGE_CODE}`);
                if (editingTableGrid) {
                    editingTableGrid.hidden = !this.usesEditingTableSelection();
                    if (this.usesEditingTableSelection()) {
                        this.renderEditingTableGrid();
                    }
                }
                const stageContext = getContainerEl(`#stageContext-${PAGE_CODE}`);
                if (stageContext) stageContext.hidden = this.stage.mode === "DISCOVERED_RULES";
                const ruleQueryBar = getContainerEl(`#ruleQueryBar-${PAGE_CODE}`);
                if (ruleQueryBar) ruleQueryBar.hidden = this.stage.mode !== "DISCOVERED_RULES";
                const runSource = getContainerEl(`#ruleRunSource-${PAGE_CODE}`);
                const runId = getContainerEl(`#ruleRunId-${PAGE_CODE}`);
                const ruleGroup = getContainerEl(`#ruleGroup-${PAGE_CODE}`);
                const decisionStatus = getContainerEl(`#ruleDecisionStatus-${PAGE_CODE}`);
                if (runSource) runSource.value = ["FLOW_WORK", "DATA_WORK"].includes(this.ruleRunSource) ? this.ruleRunSource : "";
                if (runId) {
                    runId.value = this.ruleRunId;
                    runId.disabled = !runSource?.value;
                }
                if (ruleGroup) ruleGroup.value = ["ALL", "CATEGORICAL", "CONTINUOUS"].includes(this.ruleGroup) ? this.ruleGroup : "ALL";
                if (decisionStatus) {
                    decisionStatus.value = ["ALL", "PENDING", "SELECTED", "REJECTED"].includes(this.ruleDecisionStatus)
                        ? this.ruleDecisionStatus
                        : "ALL";
                }
                this.updateGridMeta([]);
                this.updateWorkContextSummary();
            },

            setEditWorkspaceStage(pageCode) {
                const tabs = WORKSPACE_TABS[PAGE_CODE] || [];
                const nextPageCode = tabs.some((tab) => tab.stageCode === pageCode) ? pageCode : PAGE_CODE;
                this.activeStagePageCode = nextPageCode;
                this.stage = STAGE_MAP[nextPageCode] || INITIAL_STAGE;
            },

            captureControlState(root) {
                if (!root) return [];
                return Array.from(root.querySelectorAll("input, select, textarea")).map((element, index) => ({
                    index,
                    id: element.id || "",
                    value: element.value,
                    checked: Boolean(element.checked),
                    disabled: Boolean(element.disabled)
                }));
            },

            restoreControlState(root, controls = []) {
                if (!root) return;
                const elements = Array.from(root.querySelectorAll("input, select, textarea"));
                controls.forEach((state) => {
                    const element = state.id
                        ? elements.find((item) => item.id === state.id)
                        : elements[state.index];
                    if (!element) return;
                    element.value = state.value ?? "";
                    if ("checked" in element) element.checked = Boolean(state.checked);
                    element.disabled = Boolean(state.disabled);
                });
            },

            captureWorkspaceHtml(root) {
                if (!root) return "";
                const clone = root.cloneNode(true);
                clone.querySelectorAll(".grid-column-resizer, .data-sql-grid-col-resizer, .column-resizer")
                    .forEach((element) => element.remove());
                clone.querySelectorAll("table.table-grid").forEach((table) => {
                    delete table.dataset.standardGridReady;
                    delete table.dataset.standardGridLayoutPending;
                });
                return clone.innerHTML;
            },

            captureEditWorkspaceState() {
                if (!WORKSPACE_TABS[PAGE_CODE]) return null;
                const modeForm = getContainerEl(`#modeForm-${PAGE_CODE}`);
                const workContent = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (workContent?.querySelector(".edit-work-error, .edit-work-loading")) return null;
                const panelTitle = getContainerEl(`#panelTitle-${PAGE_CODE}`);
                const modeActions = getContainerEl(`#modeActions-${PAGE_CODE}`);
                return {
                    rows: this.rows,
                    gridColumns: this.gridColumns,
                    page: this.page,
                    pageSize: this.pageSize,
                    keyword: this.keyword,
                    freezeColumns: this.freezeColumns,
                    freezeColumnsInitialized: this.freezeColumnsInitialized,
                    ruleRunSource: this.ruleRunSource,
                    ruleRunId: this.ruleRunId,
                    ruleGroup: this.ruleGroup,
                    ruleDecisionStatus: this.ruleDecisionStatus,
                    stageFilters: { ...this.stageFilters },
                    serverPaging: this.serverPaging,
                    serverTotalRows: this.serverTotalRows,
                    selectedRuleIds: new Set(this.selectedRuleIds),
                    selectedViolationRowKeys: new Set(this.selectedViolationRowKeys),
                    violationRules: this.violationRules,
                    violationSourceTables: this.violationSourceTables,
                    violationSourceTablesLoaded: this.violationSourceTablesLoaded,
                    editingTableStatus: this.editingTableStatus,
                    selectedViolationRuleId: this.selectedViolationRuleId,
                    selectedViolationRule: this.selectedViolationRule,
                    selectedViolationRules: this.selectedViolationRules,
                    violationRuleScopeIds: new Set(this.violationRuleScopeIds),
                    generatedViolationSql: this.generatedViolationSql,
                    currentExport: this.currentExport,
                    userRuleTables: this.userRuleTables,
                    userRuleColumns: this.userRuleColumns,
                    userRuleValidation: this.userRuleValidation,
                    selectedMasterRule: this.selectedMasterRule,
                    selectedMasterRuleId: this.selectedMasterRuleId,
                    editingUserRuleId: this.editingUserRuleId,
                    userRuleCopyMode: this.userRuleCopyMode,
                    currentValidation: this.currentValidation,
                    selectedDmlId: this.selectedDmlId,
                    selectedDml: this.selectedDml,
                    dmlSavedName: this.dmlSavedName,
                    dmlSavedSql: this.dmlSavedSql,
                    dmlValidatedSql: this.dmlValidatedSql,
                    panelTitle: panelTitle?.textContent || "",
                    modeActionsHtml: modeActions?.innerHTML || "",
                    modeFormClassName: modeForm?.className || "edit-work-mode-form",
                    modeFormHtml: this.captureWorkspaceHtml(modeForm),
                    modeFormControls: this.captureControlState(modeForm),
                    workContentHtml: this.captureWorkspaceHtml(workContent),
                    workContentControls: this.captureControlState(workContent),
                    workContentScrollTop: workContent?.scrollTop || 0,
                    workContentScrollLeft: workContent?.scrollLeft || 0
                };
            },

            rememberCurrentEditWorkspace() {
                if (!WORKSPACE_TABS[PAGE_CODE]) return;
                const snapshot = this.captureEditWorkspaceState();
                if (snapshot) this.editWorkspaceCache.set(this.activeStagePageCode, snapshot);
            },

            invalidateEditWorkspaceCache(pageCode = "") {
                if (!WORKSPACE_TABS[PAGE_CODE]) return;
                if (pageCode) this.editWorkspaceCache.delete(pageCode);
                else this.editWorkspaceCache.clear();
            },

            restoreEditWorkspaceState(snapshot) {
                if (!snapshot) return false;
                this.rows = snapshot.rows || [];
                this.gridColumns = snapshot.gridColumns || [];
                this.page = snapshot.page || 1;
                this.pageSize = snapshot.pageSize || 100;
                this.keyword = snapshot.keyword || "";
                this.freezeColumns = snapshot.freezeColumns || 0;
                this.freezeColumnsInitialized = Boolean(snapshot.freezeColumnsInitialized);
                this.ruleRunSource = snapshot.ruleRunSource || "";
                this.ruleRunId = snapshot.ruleRunId || "";
                this.ruleGroup = snapshot.ruleGroup || "ALL";
                this.ruleDecisionStatus = snapshot.ruleDecisionStatus || "ALL";
                this.stageFilters = { ...(snapshot.stageFilters || {}) };
                this.serverPaging = Boolean(snapshot.serverPaging);
                this.serverTotalRows = Number(snapshot.serverTotalRows || 0);
                this.selectedRuleIds = new Set(snapshot.selectedRuleIds || []);
                this.selectedViolationRowKeys = new Set(snapshot.selectedViolationRowKeys || []);
                this.violationRules = snapshot.violationRules || [];
                this.violationSourceTables = snapshot.violationSourceTables || [];
                this.violationSourceTablesLoaded = Boolean(snapshot.violationSourceTablesLoaded);
                this.editingTableStatus = snapshot.editingTableStatus || null;
                this.selectedViolationRuleId = snapshot.selectedViolationRuleId || "ALL";
                this.selectedViolationRule = snapshot.selectedViolationRule || null;
                this.selectedViolationRules = snapshot.selectedViolationRules || [];
                this.violationRuleScopeIds = new Set(snapshot.violationRuleScopeIds || []);
                this.generatedViolationSql = snapshot.generatedViolationSql || "";
                this.currentExport = snapshot.currentExport || { filename: "editing-data.csv", columns: [], rows: [] };
                this.userRuleTables = snapshot.userRuleTables || [];
                this.userRuleColumns = snapshot.userRuleColumns || [];
                this.userRuleValidation = snapshot.userRuleValidation || null;
                this.selectedMasterRule = snapshot.selectedMasterRule || null;
                this.selectedMasterRuleId = snapshot.selectedMasterRuleId || "";
                this.editingUserRuleId = snapshot.editingUserRuleId || null;
                this.userRuleCopyMode = Boolean(snapshot.userRuleCopyMode);
                this.currentValidation = snapshot.currentValidation || null;
                this.selectedDmlId = snapshot.selectedDmlId || "";
                this.selectedDml = snapshot.selectedDml || null;
                this.dmlSavedName = snapshot.dmlSavedName || "";
                this.dmlSavedSql = snapshot.dmlSavedSql || "";
                this.dmlValidatedSql = snapshot.dmlValidatedSql || "";

                this.renderShell();
                const keyword = getContainerEl(`#gridKeyword-${PAGE_CODE}`);
                if (keyword) keyword.value = this.keyword;
                const modeForm = getContainerEl(`#modeForm-${PAGE_CODE}`);
                if (modeForm) {
                    modeForm.className = snapshot.modeFormClassName || "edit-work-mode-form";
                    modeForm.innerHTML = snapshot.modeFormHtml || "";
                    this.restoreControlState(modeForm, snapshot.modeFormControls);
                }
                const workContent = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (workContent) {
                    workContent.innerHTML = snapshot.workContentHtml || "";
                    this.restoreControlState(workContent, snapshot.workContentControls);
                }
                const panelTitle = getContainerEl(`#panelTitle-${PAGE_CODE}`);
                if (panelTitle) panelTitle.textContent = snapshot.panelTitle || this.stage.title;
                const modeActions = getContainerEl(`#modeActions-${PAGE_CODE}`);
                if (modeActions) modeActions.innerHTML = snapshot.modeActionsHtml || "";
                this.renderStageFilters();
                this.renderPanelSourceContext();
                this.updateGridMeta(this.serverPaging ? this.rows : this.getFilteredRows(this.rows));
                window.requestAnimationFrame?.(() => {
                    if (!workContent) return;
                    workContent.scrollTop = snapshot.workContentScrollTop || 0;
                    workContent.scrollLeft = snapshot.workContentScrollLeft || 0;
                    workContent.querySelectorAll("table.table-grid").forEach((table) => {
                        CommonUtils.applyStandardGridDefaults?.(table);
                    });
                });
                return true;
            },

            async switchEditWorkspaceTab(pageCode) {
                const tabs = WORKSPACE_TABS[PAGE_CODE] || [];
                if (!tabs.some((tab) => tab.stageCode === pageCode)) return;
                if (this.activeStagePageCode === pageCode || this.workspaceSwitching) return;

                this.workspaceSwitching = true;
                const tabButtons = getContainerEl(`#editWorkspaceTabs-${PAGE_CODE}`)
                    ?.querySelectorAll("[data-edit-workspace-tab]");
                tabButtons?.forEach((button) => {
                    button.disabled = true;
                });
                try {
                    const activeRefresh = this.refreshPromise;
                    if (activeRefresh) {
                        await activeRefresh;
                        if (this.refreshPromise === activeRefresh) this.refreshPromise = null;
                    }
                    this.ruleRequestId += 1;
                    this.closeDetailLayer();
                    this.rememberCurrentEditWorkspace();
                    this.setEditWorkspaceStage(pageCode);
                    const cached = this.editWorkspaceCache.get(pageCode);
                    if (cached) {
                        this.restoreEditWorkspaceState(cached);
                        this.persistContext();
                        return;
                    }
                    this.page = 1;
                    this.keyword = "";
                    this.freezeColumns = 0;
                    this.freezeColumnsInitialized = false;
                    this.stageFilters = {};
                    this.serverPaging = false;
                    this.serverTotalRows = 0;
                    this.rows = [];
                    this.gridColumns = [];
                    this.selectedRuleIds.clear();
                    this.selectedViolationRowKeys.clear();
                    this.violationRules = [];
                    this.violationSourceTables = [];
                    this.violationSourceTablesLoaded = false;
                    this.editingTableStatus = null;
                    this.selectedViolationRuleId = "ALL";
                    this.selectedViolationRule = null;
                    this.selectedViolationRules = [];
                    this.violationRuleScopeIds = new Set();
                    this.generatedViolationSql = "";
                    this.selectedMasterRule = null;
                    this.selectedMasterRuleId = "";
                    this.editingUserRuleId = null;
                    this.userRuleCopyMode = false;
                    this.currentValidation = null;
                    this.selectedDmlId = "";
                    this.selectedDml = null;
                    this.dmlSavedName = "";
                    this.dmlSavedSql = "";
                    this.dmlValidatedSql = "";
                    this.masterSelectionRequestId += 1;
                    this.renderShell();
                    this.persistContext();
                    await this.refresh();
                    this.rememberCurrentEditWorkspace();
                } finally {
                    this.workspaceSwitching = false;
                    tabButtons?.forEach((button) => {
                        button.disabled = false;
                    });
                }
            },

            navigateStage(pageCode) {
                this.persistContext();
                const menu = window.MENU_PAGE_MAP?.[pageCode];
                PageManager.load(pageCode, menu?.title || menu?.label || STAGE_MAP[pageCode]?.title || pageCode);
            },

            async loadProjects(preferredProjectId = "") {
                const select = getContainerEl(`#projectId-${PAGE_CODE}`);
                if (!select) return;
                select.innerHTML = `<option value="">프로젝트 로딩 중...</option>`;
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?keyword=`, { method: "GET", showLoading: false });
                this.projects = Array.isArray(json.data) ? json.data : [];
                select.innerHTML = `
                    <option value="" disabled>프로젝트 선택</option>
                    ${this.projects.map((project) => `
                        <option value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                            ${this.escapeHtml(CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || `Project #${project.PROJECT_ID}`))}
                        </option>
                    `).join("")}
                `;
                const exists = this.projects.some((project) => String(project.PROJECT_ID) === String(preferredProjectId));
                select.value = exists ? String(preferredProjectId) : String(this.projects[0]?.PROJECT_ID || "");
                CommonUtils.applyOwnerScopeToSelect(select, this.projects, select.value);
            },

            async loadScenarios(preferredScenarioId = "") {
                const projectId = getContainerEl(`#projectId-${PAGE_CODE}`)?.value || "";
                const select = getContainerEl(`#scenarioId-${PAGE_CODE}`);
                if (!select) return;
                this.scenarios = [];
                select.innerHTML = `<option value="">전체 시나리오</option>`;
                if (!projectId) return;
                const params = new URLSearchParams({ projectId, keyword: "" });
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/scenarios?${params}`, { method: "GET", showLoading: false });
                this.scenarios = Array.isArray(json.data) ? json.data : [];
                select.innerHTML = `
                    <option value="">전체 시나리오</option>
                    ${this.scenarios.map((scenario) => `
                        <option value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                            ${this.escapeHtml(CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || `Scenario #${scenario.SCENARIO_ID}`))}
                        </option>
                    `).join("")}
                `;
                const exists = this.scenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
                select.value = exists ? String(preferredScenarioId) : "";
                CommonUtils.applyOwnerScopeToSelect(select, this.scenarios, select.value, ["SCENARIO_ID", "scenarioId"]);
            },

            async loadSessions(preferredSessionId = "") {
                const select = getContainerEl(`#editSessionId-${PAGE_CODE}`);
                if (!select) return;
                const params = this.contextParams();
                params.set("sessionStatus", "ALL");
                try {
                    const json = await CommonUtils.request(apiUrl(`/sessions?${params}`), { method: "GET", showLoading: false });
                    this.sessions = Array.isArray(json.data) ? json.data : [];
                } catch (error) {
                    this.sessions = [];
                    if (!/does not exist|not found|ORA-00942/i.test(String(error.message || ""))) throw error;
                }
                select.innerHTML = `
                    <option value="">작업 이력 선택</option>
                    ${this.sessions.map((session) => `
                        <option value="${this.escapeHtml(session.EDIT_SESSION_ID)}">
                            #${this.escapeHtml(session.EDIT_SESSION_ID)} · [${this.escapeHtml(this.executionStatusLabel(session.SESSION_STATUS || "-"))}] 규칙 ${Number(session.EXECUTION_RULE_COUNT || 0).toLocaleString()} · 변경 ${Number(session.CHANGED_ROW_COUNT || 0).toLocaleString()}행${Number(session.EXECUTED_DML_COUNT || 0) > 1 ? " · 기존 통합 실행" : ""} · 작업자 ${this.escapeHtml(session.CREATED_BY || "-")} · ${this.escapeHtml(session.SESSION_NAME || session.EDIT_TABLE)}
                        </option>
                    `).join("")}
                `;
                const exists = this.sessions.some((session) => String(session.EDIT_SESSION_ID) === String(preferredSessionId));
                select.value = exists ? String(preferredSessionId) : "";
                this.selectedSessionId = select.value;
                this.renderSourceContext();
            },

            contextParams() {
                const params = new URLSearchParams();
                const projectId = getContainerEl(`#projectId-${PAGE_CODE}`)?.value || "";
                const scenarioId = getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value || "";
                if (projectId) params.set("projectId", projectId);
                if (scenarioId) params.set("scenarioId", scenarioId);
                return params;
            },

            getSelectedSession() {
                const id = getContainerEl(`#editSessionId-${PAGE_CODE}`)?.value || this.selectedSessionId;
                return this.sessions.find((item) => String(item.EDIT_SESSION_ID) === String(id)) || null;
            },

            sessionMatchesSource(session, source) {
                if (!session || !source) return false;
                const owner = String(source.OWNER_NAME ?? source.TARGET_OWNER ?? "").toUpperCase();
                const table = String(source.TABLE_NAME ?? source.SOURCE_TABLE ?? "").toUpperCase();
                return String(session.TARGET_OWNER || "").toUpperCase() === owner
                    && String(session.SOURCE_TABLE || "").toUpperCase() === table;
            },

            preferredExecutionForSource(source, includeClosed = this.stage.mode !== "VIOLATIONS") {
                if (!source) return null;
                const selected = this.getSelectedSession();
                const selectedStatus = String(selected?.SESSION_STATUS || "").toUpperCase();
                const candidates = this.sessions.filter((session) => this.sessionMatchesSource(session, source));
                if (this.showsExecutionHistorySelector() && this.sessionMatchesSource(selected, source)) {
                    return selected;
                }
                const active = candidates.find((session) =>
                    ["DRAFT", "EDITING", "VALIDATED", "APPLY_READY"].includes(
                        String(session.SESSION_STATUS || "").toUpperCase()
                    )
                );
                if (
                    this.sessionMatchesSource(selected, source)
                    && ["DRAFT", "EDITING", "VALIDATED", "APPLY_READY"].includes(selectedStatus)
                ) return selected;
                if (active) return active;
                if (includeClosed && this.sessionMatchesSource(selected, source)) return selected;
                return (includeClosed ? candidates[0] : null) || null;
            },

            latestAppliedExecutionForSource(source) {
                if (!source) return null;
                return this.sessions.find((session) =>
                    this.sessionMatchesSource(session, source)
                    && String(session.SESSION_STATUS || "").toUpperCase() === "APPLIED"
                ) || null;
            },

            selectExecution(session) {
                const id = String(session?.EDIT_SESSION_ID || "");
                const select = getContainerEl(`#editSessionId-${PAGE_CODE}`);
                if (select) select.value = id;
                this.selectedSessionId = id;
                return session || null;
            },

            renderSourceContext() {
                const el = getContainerEl(`#sourceContext-${PAGE_CODE}`);
                if (!el) return;
                const session = this.getSelectedSession();
                if (session) {
                    el.innerHTML = `<b>${this.escapeHtml(session.TARGET_OWNER)}.${this.escapeHtml(session.SOURCE_TABLE)}</b> → <b>${this.escapeHtml(session.TARGET_OWNER)}.${this.escapeHtml(session.EDIT_TABLE)}</b>`;
                    return;
                }
                if (PAGE_CODE === "M05002") {
                    const source = this.getSelectedViolationSource();
                    if (source) {
                        const editTable = String(source.TABLE_NAME || "").replace(/^INITUP\$/, "INITDN$");
                        el.innerHTML = `
                            <b>${this.escapeHtml(source.OWNER_NAME)}.${this.escapeHtml(source.TABLE_NAME)}</b>
                            →
                            <b>${this.escapeHtml(source.OWNER_NAME)}.${this.escapeHtml(editTable)}</b>
                            <span>(${this.escapeHtml(this.pageLabel("readOnlyUntilEditingTable", "수정테이블 생성 전 조회 전용"))})</span>
                        `;
                        return;
                    }
                }
                const owner = this.pendingContext.targetOwner || "";
                const table = this.pendingContext.targetTable || "";
                const runId = this.pendingContext.runId || "";
                el.textContent = owner && table ? `${owner}.${table}${runId ? ` · Run #${runId}` : ""}` : "규칙 또는 작업 테이블을 선택하세요.";
            },

            async handleProjectChange() {
                this.invalidateEditWorkspaceCache();
                this.clearRunContext();
                this.stageFilters = {};
                await this.loadScenarios("");
                if (this.usesEditSession()) await this.loadSessions("");
                this.persistContext();
                this.updateWorkContextSummary();
                await this.refresh();
            },

            async handleScenarioChange() {
                this.invalidateEditWorkspaceCache();
                this.clearRunContext();
                this.stageFilters = {};
                if (this.usesEditSession()) await this.loadSessions("");
                this.persistContext();
                this.updateWorkContextSummary();
                this.setWorkContextCollapsed(true);
                await this.refresh();
            },

            async handleSessionChange() {
                this.invalidateEditWorkspaceCache();
                this.selectedSessionId = getContainerEl(`#editSessionId-${PAGE_CODE}`)?.value || "";
                const selectedSession = this.getSelectedSession();
                this.stageFilters = this.stage.mode === "VIOLATIONS"
                    ? {
                        VIOLATION_TARGET_TABLE: selectedSession
                            ? `${selectedSession.TARGET_OWNER}.${selectedSession.SOURCE_TABLE}`.toUpperCase()
                            : String(this.stageFilters.VIOLATION_TARGET_TABLE || "")
                    }
                    : {};
                this.violationRules = [];
                this.editingTableStatus = null;
                this.selectedViolationRules = [];
                this.selectedViolationRule = null;
                this.selectedViolationRuleId = "ALL";
                this.violationRuleScopeIds.clear();
                this.selectedViolationRowKeys.clear();
                this.page = 1;
                this.renderSourceContext();
                this.persistContext();
                await this.refresh();
            },

            clearRunContext() {
                this.pendingContext = {
                    ...this.pendingContext,
                    runSourceType: "",
                    runId: "",
                    targetOwner: "",
                    targetTable: ""
                };
                this.ruleRunSource = "";
                this.ruleRunId = "";
                const runSource = getContainerEl(`#ruleRunSource-${PAGE_CODE}`);
                const runId = getContainerEl(`#ruleRunId-${PAGE_CODE}`);
                if (runSource) runSource.value = "";
                if (runId) {
                    runId.value = "";
                    runId.disabled = true;
                }
                this.clearViolationContext();
            },

            clearViolationContext() {
                this.violationRules = [];
                this.violationSourceTables = [];
                this.violationSourceTablesLoaded = false;
                this.editingTableStatus = null;
                this.selectedViolationRuleId = "ALL";
                this.selectedViolationRule = null;
                this.selectedViolationRules = [];
                this.violationRuleScopeIds = new Set();
                this.generatedViolationSql = "";
                this.selectedRuleIds.clear();
                this.selectedViolationRowKeys.clear();
                this.page = 1;
            },

            usesEditSession() {
                return !["DISCOVERED_RULES", "RULE_MASTER"].includes(this.stage.mode);
            },

            showsExecutionHistorySelector() {
                return ["CHANGE_HISTORY", "HISTORY"].includes(this.stage.mode);
            },

            usesEditingTableSelection() {
                return TABLE_SELECTION_MODES.includes(this.stage.mode);
            },

            toggleWorkContext(event) {
                event?.stopPropagation?.();
                this.setWorkContextCollapsed(!this.workContextCollapsed);
            },

            toggleWorkContextFromHeader(event) {
                if (event?.target?.closest?.("button, select, input, textarea, a, label")) return;
                this.toggleWorkContext(event);
            },

            handleWorkContextHeaderKeydown(event) {
                if (event?.key !== "Enter" && event?.key !== " ") return;
                event.preventDefault();
                this.toggleWorkContext(event);
            },

            setWorkContextCollapsed(collapsed) {
                this.workContextCollapsed = Boolean(collapsed);
                const card = getContainerEl(".work-context-card");
                const toggle = getContainerEl(`#workContextToggle-${PAGE_CODE}`);
                card?.classList.toggle("is-collapsed", this.workContextCollapsed);
                if (toggle) {
                    toggle.setAttribute("aria-expanded", String(!this.workContextCollapsed));
                    const icon = toggle.querySelector("i");
                    const label = toggle.querySelector("span");
                    if (icon) icon.className = this.workContextCollapsed ? "fas fa-chevron-down" : "fas fa-chevron-up";
                    if (label) label.textContent = this.workContextCollapsed ? "펼치기" : "접기";
                }
                this.updateWorkContextSummary();
            },

            updateWorkContextSummary() {
                const projectId = getContainerEl(`#projectId-${PAGE_CODE}`)?.value || "";
                const scenarioId = getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value || "";
                const project = this.projects.find((row) => String(row.PROJECT_ID) === String(projectId));
                const scenario = this.scenarios.find((row) => String(row.SCENARIO_ID) === String(scenarioId));
                const summary = getContainerEl(`#workContextSummary-${PAGE_CODE}`);
                if (!summary) return;
                const projectName = project
                    ? CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || "-")
                    : "-";
                const scenarioName = scenario
                    ? CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || "-")
                    : "전체 시나리오";
                summary.textContent = `프로젝트: ${projectName} | 시나리오: ${scenarioName}`;
            },

            async refreshWorkContext(event) {
                event?.stopPropagation?.();
                this.invalidateEditWorkspaceCache();
                const projectId = getContainerEl(`#projectId-${PAGE_CODE}`)?.value || "";
                const scenarioId = getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value || "";
                await this.loadProjects(projectId);
                await this.loadScenarios(scenarioId);
                if (this.usesEditSession()) {
                    await this.loadSessions(getContainerEl(`#editSessionId-${PAGE_CODE}`)?.value || "");
                }
                this.persistContext();
                this.updateWorkContextSummary();
                await this.refresh();
            },

            handleRuleRunSourceChange() {
                const runSource = getContainerEl(`#ruleRunSource-${PAGE_CODE}`)?.value || "";
                const runId = getContainerEl(`#ruleRunId-${PAGE_CODE}`);
                if (!runId) return;
                runId.disabled = !runSource;
                if (!runSource) runId.value = "";
                else runId.focus();
            },

            handleRuleFilterKeydown(event) {
                if (event?.key !== "Enter") return;
                event.preventDefault();
                this.applyDiscoveredRuleFilters();
            },

            applyDiscoveredRuleFilters() {
                const runSource = getContainerEl(`#ruleRunSource-${PAGE_CODE}`)?.value || "";
                const runId = String(getContainerEl(`#ruleRunId-${PAGE_CODE}`)?.value || "").trim();
                if (runSource && (!runId || Number(runId) <= 0)) {
                    CommonMessage.warn("조회할 RUN ID를 입력하세요.");
                    return;
                }
                this.ruleRunSource = runSource;
                this.ruleRunId = runSource ? runId : "";
                this.ruleGroup = getContainerEl(`#ruleGroup-${PAGE_CODE}`)?.value || "ALL";
                this.ruleDecisionStatus = getContainerEl(`#ruleDecisionStatus-${PAGE_CODE}`)?.value || "ALL";
                this.page = 1;
                this.selectedRuleIds.clear();
                this.persistContext();
                this.loadDiscoveredRules().catch((error) => this.renderError(error));
            },

            refreshGrid() {
                if (this.keywordTimer) clearTimeout(this.keywordTimer);
                this.keywordTimer = null;
                this.refresh();
            },

            async refresh() {
                if (this.refreshPromise) return this.refreshPromise;
                const refreshTask = (async () => {
                    const usesCommonQueryProgress = ["RULE_MASTER", "CHANGE_HISTORY", "VALIDATION", "FINAL_APPLY", "HISTORY"].includes(this.stage.mode);
                    if (usesCommonQueryProgress) this.setRuleQueryLoading(true);
                    if (this.stage.mode !== "VIOLATIONS") {
                        this.setLoading();
                    }
                    try {
                        switch (this.stage.mode) {
                            case "DISCOVERED_RULES":
                                await this.loadDiscoveredRules();
                                break;
                            case "RULE_MASTER":
                                await this.loadRuleMaster();
                                break;
                            case "VIOLATIONS":
                                await this.loadViolations();
                                break;
                            case "CHANGE_HISTORY":
                                await this.loadChangeHistory();
                                break;
                            case "VALIDATION":
                                await this.loadValidation();
                                break;
                            case "FINAL_APPLY":
                                await this.loadDml();
                                break;
                            case "HISTORY":
                                await this.loadHistory();
                                break;
                        }
                    } catch (error) {
                        this.renderError(error);
                    } finally {
                        if (usesCommonQueryProgress) this.setRuleQueryLoading(false);
                    }
                })();
                this.refreshPromise = refreshTask;
                try {
                    return await refreshTask;
                } finally {
                    if (this.refreshPromise === refreshTask) this.refreshPromise = null;
                }
            },

            setLoading() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (content) content.innerHTML = `<div class="edit-work-loading"><i class="fas fa-spinner fa-spin"></i>&nbsp; 데이터를 조회하고 있습니다.</div>`;
            },

            renderError(error) {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                this.rows = [];
                this.renderPanelSourceContext();
                const rawMessage = error?.message || "조회 중 오류가 발생했습니다.";
                const message = window.CommonMessage?.buildDisplayText?.(rawMessage)
                    || window.I18nManager?.translateMessage?.(rawMessage)
                    || rawMessage;
                if (content) content.innerHTML = `<div class="edit-work-error">${this.escapeHtml(message)}</div>`;
                this.setKpis([{ value: "!", label: "조회 실패", hint: "설치 SQL과 Target DB 상태를 확인하세요." }]);
            },

            setRuleQueryLoading(loading) {
                [
                    getContainerEl(`#ruleQueryProgress-${PAGE_CODE}`),
                    getContainerEl(`#stageQueryProgress-${PAGE_CODE}`)
                ].filter(Boolean).forEach((progress) => {
                    progress.hidden = !loading;
                });
            },

            setWorkActionLoading(loading, message = "", showStatus = true) {
                this.setRuleQueryLoading(loading);
                [
                    getContainerEl(`#ruleQueryProgress-${PAGE_CODE}`),
                    getContainerEl(`#stageQueryProgress-${PAGE_CODE}`)
                ].filter(Boolean).forEach((progress) => {
                    progress.title = loading ? message : "";
                    progress.setAttribute("aria-label", loading ? message : "");
                    progress.classList.toggle("is-work-action", Boolean(loading));
                });
                const actions = getContainerEl(`#modeActions-${PAGE_CODE}`);
                actions?.querySelector(".edit-work-action-status")?.remove();
                if (loading && showStatus && actions) {
                    actions.insertAdjacentHTML(
                        "afterbegin",
                        `<span class="edit-work-action-status"><i class="fas fa-spinner fa-spin"></i>${this.escapeHtml(message)}</span>`
                    );
                }
                actions?.querySelectorAll("button").forEach((button) => {
                        button.disabled = Boolean(loading);
                });
                const queryButton = getContainerEl(`#stageQueryButton-${PAGE_CODE}`);
                if (queryButton) queryButton.disabled = Boolean(loading);
            },

            async loadDiscoveredRules() {
                const requestId = ++this.ruleRequestId;
                this.setRuleQueryLoading(true);
                const params = this.contextParams();
                const stored = this.readContext();
                const runSourceType = this.ruleRunSource || "";
                const runId = this.ruleRunId || "";
                const targetOwner = this.pendingContext.targetOwner || stored.targetOwner || "";
                const targetTable = this.pendingContext.targetTable || stored.targetTable || "";
                if (runSourceType) params.set("runSourceType", runSourceType);
                if (runId) params.set("runId", runId);
                if (targetOwner) params.set("targetOwner", targetOwner);
                if (targetTable) params.set("targetTable", targetTable);
                params.set("ruleGroup", this.ruleGroup || "ALL");
                params.set("decisionStatus", this.ruleDecisionStatus || "ALL");
                params.set("page", String(this.page));
                params.set("pageSize", String(this.pageSize));
                if (this.keyword) params.set("keyword", this.keyword);
                const json = await CommonUtils.request(
                    apiUrl(`/rules/discovered?${params}`),
                    { method: "GET", showLoading: false }
                ).finally(() => {
                    if (requestId === this.ruleRequestId) this.setRuleQueryLoading(false);
                });
                if (requestId !== this.ruleRequestId) return;
                this.rows = Array.isArray(json.data) ? json.data : [];
                this.serverPaging = true;
                this.serverTotalRows = Number(json.total || 0);
                this.page = Math.max(1, Number(json.page || this.page));
                this.pageSize = Math.max(1, Number(json.pageSize || this.pageSize));
                this.ruleGroup = String(json.ruleGroup || this.ruleGroup || "ALL").toUpperCase();
                this.ruleDecisionStatus = String(json.decisionStatus || this.ruleDecisionStatus || "ALL").toUpperCase();
                this.pendingContext = {
                    ...this.pendingContext,
                    runSourceType: json.runSourceType || runSourceType || "",
                    runId: json.runId ?? runId ?? "",
                    targetOwner,
                    targetTable
                };
                this.persistContext();
                this.renderSourceContext();
                const counts = json.decisionCounts || this.countBy(this.rows, "DECISION_STATUS");
                const runHint = json.runId
                    ? `${json.latestRunSelected ? "최신 " : ""}${json.runSourceType || "RUN"} #${json.runId}`
                    : "발굴 결과 없음";
                this.setKpis([
                    { value: this.serverTotalRows, label: "발굴 규칙", hint: runHint },
                    { value: counts.SELECTED || 0, label: "현재 페이지 선정", hint: "위반 편집에 사용할 규칙" },
                    { value: counts.PENDING || 0, label: "현재 페이지 대기", hint: "사용자 검토 필요" },
                    { value: counts.REJECTED || 0, label: "현재 페이지 제외", hint: "편집 대상에서 제외" }
                ]);
                this.setPanel("발굴 규칙 판단", `
                    <button type="button" class="is-primary" onclick="${PAGE_CODE}.saveCheckedDecision('SELECTED')"><i class="fas fa-check"></i>선정</button>
                    <button type="button" class="is-danger" onclick="${PAGE_CODE}.saveCheckedDecision('REJECTED')"><i class="fas fa-xmark"></i>제외</button>
                `);
                this.hideModeForm();
                const selectionColumn = { key: "_SELECT", label: "", headerHtml: `<input type="checkbox" title="현재 페이지 전체 선택" onchange="${PAGE_CODE}.toggleVisibleRules(this.checked)">`, width: 34, className: "is-select-column", headerClassName: "is-select-column", render: (_value, row, index) => `<input type="checkbox" ${this.selectedRuleIds.has(this.ruleRowKey(row)) ? "checked" : ""} onchange="${PAGE_CODE}.toggleRuleRow(${index}, this.checked)">` };
                const typeColumn = { key: "RULE_GROUP_CODE", label: "유형", width: 62, render: (value) => this.badge(value === "CATEGORICAL" ? "범주형" : (value === "CONTINUOUS" ? "연속형" : value)) };
                const runColumn = { key: "RUN_ID", label: "Run", width: 54, className: "is-number", render: (value) => `#${this.escapeHtml(value)}` };
                const targetColumnLabel = this.ruleGroup === "CONTINUOUS"
                    ? "예측 대상"
                    : (this.ruleGroup === "CATEGORICAL" ? "결과 컬럼" : "대상 컬럼");
                const targetColumn = { key: "TARGET_COLUMN", label: targetColumnLabel, width: 132, className: "is-code", render: (value, row) => this.renderColumnSummary(value, row.TARGET_COLUMN_COMMENT) };
                const ruleIdColumn = { key: "SOURCE_RULE_ID", label: "규칙 ID", width: 122, className: "is-code is-compact-ellipsis" };
                const decisionColumn = { key: "DECISION_STATUS", label: "판단", width: 76, render: (value) => this.badge(value) };
                const actionColumn = { key: "_ACTION", label: "처리", width: 100, className: "is-action-column", headerClassName: "is-action-column", render: (_value, _row, index) => `
                    <span class="edit-work-row-actions">
                        <button class="is-primary" onclick="${PAGE_CODE}.saveRuleDecision(${index}, 'SELECTED')">선정</button>
                        <button class="is-danger" onclick="${PAGE_CODE}.saveRuleDecision(${index}, 'REJECTED')">제외</button>
                    </span>
                ` };
                const commonStartColumns = [selectionColumn, typeColumn, runColumn, targetColumn, ruleIdColumn];
                if (this.ruleGroup === "CONTINUOUS") {
                    this.gridColumns = [
                        ...commonStartColumns,
                        { key: "RULE_EXPRESSION", label: "f(X) 수식", width: 340, className: "is-rule-detail is-symbolic-formula", render: (value, row, index) => this.renderSymbolicFormulaPreview(value, row, index) },
                        { key: "FEATURE_COLUMNS", label: "입력 피처", width: 220, className: "is-rule-detail", render: (_value, row, index) => this.renderFeaturePreview(row, index) },
                        { key: "METHOD", label: "방법", width: 92, className: "is-code", render: (value, row) => this.escapeHtml(value || row.MODEL_TYPE || "-") },
                        { key: "RULE_CONFIDENCE", label: "Score", width: 68, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "CONDITION_COUNT", label: "복잡도", width: 58, className: "is-number", render: (value) => this.escapeHtml(value ?? "-") },
                        { key: "RANK_NO", label: "순위", width: 50, className: "is-number", render: (value) => this.escapeHtml(value ?? "-") },
                        decisionColumn,
                        actionColumn
                    ];
                } else {
                    this.gridColumns = [
                        ...commonStartColumns,
                        { key: "RULE_EXPRESSION", label: this.ruleGroup === "ALL" ? "규칙 표현 (IF / f(X))" : "IF 조건", width: 300, className: "is-rule-detail", render: (value, row, index) => this.renderRulePreview(value, row, index, "IF") },
                        { key: "RESULT_EXPRESSION", label: this.ruleGroup === "ALL" ? "결과 / 예측 대상" : "THEN 결과", width: 210, className: "is-rule-detail", render: (value, row, index) => this.renderRulePreview(value || (row.EXPECTED_VALUE !== null && row.EXPECTED_VALUE !== undefined ? `${row.TARGET_COLUMN} = ${row.EXPECTED_VALUE}` : "-"), row, index, "THEN") },
                        { key: "SUPPORT_COUNT", label: "근거 건수", width: 104, className: "is-number", render: (value, row) => this.isContinuousRule(row) ? "-" : `${Number(value || 0).toLocaleString()} / ${Number(row.SOURCE_TOTAL_COUNT || 0).toLocaleString()}` },
                        { key: "RULE_CONFIDENCE", label: "신뢰도 / Score", width: 76, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "RULE_LIFT", label: "Lift", width: 58, className: "is-number", render: (value, row) => this.isContinuousRule(row) ? "-" : this.formatMetric(value) },
                        decisionColumn,
                        actionColumn
                    ];
                }
                this.renderGrid();
            },

            async loadRuleMaster() {
                this.masterSelectionRequestId += 1;
                this.selectedRuleIds.clear();
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                const params = this.contextParams();
                params.set("decisionStatus", this.stageFilters.DECISION_STATUS || "ALL");
                params.set("sourceRuleType", this.stageFilters.SOURCE_RULE_TYPE || "ALL");
                const json = await CommonUtils.request(apiUrl(`/rules?${params}`), { method: "GET", showLoading: false });
                this.rows = (Array.isArray(json.data) ? json.data : []).map((row) => ({
                    ...row,
                    RUN_ID: row.RUN_ID ?? row.SOURCE_RUN_ID,
                    RUN_SOURCE_TYPE: row.RUN_SOURCE_TYPE ?? row.SOURCE_RUN_SOURCE_TYPE,
                    RULE_GROUP_CODE: row.SOURCE_RULE_TYPE === "SYMBOLIC" ? "CONTINUOUS" : "CATEGORICAL",
                    CONDITION_COUNT: row.CONDITION_COUNT ?? row.COMPLEXITY,
                    TARGET_COLUMN_COMMENT: row.TARGET_COLUMN_COMMENT
                        || row.COLUMN_COMMENTS?.[row.TARGET_COLUMN]
                        || ""
                }));
                const counts = this.countBy(this.rows, "SOURCE_RULE_TYPE");
                const userRuleCount = this.rows.filter((row) => (
                    String(row.USER_RULE_YN || "N").toUpperCase() === "Y"
                    && !row.SOURCE_RULE_ID
                )).length;
                this.setKpis([
                    { value: this.rows.length, label: "규칙 마스터", hint: "선정·사용자 규칙 전체" },
                    { value: counts.ASSOCIATION || 0, label: "연관 규칙", hint: "조건-결과 규칙" },
                    { value: counts.SYMBOLIC || 0, label: "수식 규칙", hint: "연속형 수식 규칙" },
                    { value: userRuleCount, label: "사용자 규칙", hint: "직접 등록 규칙" }
                ]);
                this.setPanel("편집 규칙 마스터", `
                    <button type="button" class="is-danger" onclick="${PAGE_CODE}.excludeCheckedMasterRules()"><i class="fas fa-ban"></i>${this.escapeHtml(this.pageLabel("buttonBulkExcludeRules", "선정 제외"))}</button>
                    <button type="button" class="is-primary" onclick="${PAGE_CODE}.startNewUserRule()"><i class="fas fa-plus"></i>사용자 규칙 등록</button>
                `);
                this.renderUserRuleForm();
                const sourceType = String(this.stageFilters.SOURCE_RULE_TYPE || "ALL").toUpperCase();
                const selectionColumn = {
                    key: "_SELECT",
                    label: "",
                    headerHtml: `<input type="checkbox" title="${this.escapeHtml(this.pageLabel("selectVisibleMasterRules", "현재 페이지의 기존 발굴 규칙 전체 선택"))}" onclick="event.stopPropagation()" onchange="${PAGE_CODE}.toggleVisibleMasterRules(this.checked)">`,
                    width: 34,
                    className: "is-select-column",
                    headerClassName: "is-select-column",
                    render: (_value, row, index) => {
                        const eligible = this.isMasterRuleBulkExcludable(row);
                        return `<input type="checkbox" ${this.selectedRuleIds.has(this.ruleRowKey(row)) ? "checked" : ""} ${eligible ? "" : "disabled"} onclick="event.stopPropagation()" onchange="${PAGE_CODE}.toggleMasterRuleRow(${index}, this.checked)">`;
                    }
                };
                const commonColumns = [
                    selectionColumn,
                    { key: "EDIT_RULE_ID", label: "ID", width: 60, className: "is-number" },
                    { key: "SOURCE_RULE_TYPE", label: "유형", width: 82, render: (value) => this.renderRuleTypeBadge(value) },
                    {
                        key: "USER_RULE_YN",
                        label: "출처",
                        width: 64,
                        render: (value, row) => this.badge(
                            row.SOURCE_RULE_ID
                                ? "발굴"
                                : String(value || "N").toUpperCase() === "Y" ? "사용자" : "발굴"
                        )
                    },
                    { key: "RULE_NAME", label: "규칙명", width: 185 },
                    { key: "TARGET_TABLE", label: "INITUP$ 테이블", width: 190, className: "is-code" },
                    { key: "TARGET_COLUMN", label: sourceType === "SYMBOLIC" ? "예측 대상" : "대상 컬럼", width: 135, className: "is-code", render: (value, row) => this.renderColumnSummary(value, row.TARGET_COLUMN_COMMENT) }
                ];
                const decisionColumns = [
                    { key: "DECISION_STATUS", label: "판단", width: 78, render: (value) => this.badge(value) },
                    { key: "RULE_STATUS", label: "상태", width: 72, render: (value) => this.badge(value) },
                    { key: "DECIDED_AT", label: "최종 판단일", width: 145, render: (value) => this.formatDate(value) }
                ];
                if (sourceType === "SYMBOLIC") {
                    this.gridColumns = [
                        ...commonColumns,
                        { key: "RULE_EXPRESSION", label: "f(X) 수식", width: 340, className: "is-rule-detail", render: (value, row, index) => this.renderSymbolicFormulaPreview(value, row, index) },
                        { key: "FEATURE_COLUMNS", label: "입력 피처", width: 210, className: "is-rule-detail", render: (_value, row, index) => this.renderFeaturePreview(row, index) },
                        { key: "METHOD", label: "방법", width: 90 },
                        { key: "RULE_CONFIDENCE", label: "Score", width: 70, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "COMPLEXITY", label: "복잡도", width: 58, className: "is-number" },
                        { key: "RANK_NO", label: "순위", width: 50, className: "is-number" },
                        ...decisionColumns
                    ];
                } else if (sourceType === "ASSOCIATION") {
                    this.gridColumns = [
                        ...commonColumns,
                        { key: "RULE_EXPRESSION", label: "IF 조건", width: 320, className: "is-rule-detail", render: (value, row, index) => this.renderRulePreview(value, row, index, "IF") },
                        { key: "EXPECTED_VALUE", label: "THEN 결과", width: 175, className: "is-rule-detail", render: (value, row, index) => this.renderRulePreview(`${row.TARGET_COLUMN} = ${value ?? "-"}`, row, index, "THEN") },
                        { key: "RULE_SUPPORT", label: "Support", width: 70, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "RULE_CONFIDENCE", label: "신뢰도", width: 66, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "RULE_LIFT", label: "Lift", width: 58, className: "is-number", render: (value) => this.formatMetric(value) },
                        ...decisionColumns
                    ];
                } else {
                    this.gridColumns = [
                        ...commonColumns,
                        { key: "RULE_EXPRESSION", label: "규칙 표현 (IF / f(X))", width: 330, className: "is-rule-detail", render: (value, row, index) => this.renderRulePreview(value, row, index, "IF") },
                        { key: "EXPECTED_VALUE", label: "결과 / 예측 대상", width: 180, className: "is-rule-detail", render: (value, row, index) => this.renderRulePreview(`${row.TARGET_COLUMN} = ${value ?? "-"}`, row, index, "THEN") },
                        { key: "RULE_CONFIDENCE", label: "신뢰도 / Score", width: 82, className: "is-number", render: (value) => this.formatMetric(value) },
                        ...decisionColumns
                    ];
                }
                this.renderGrid();
            },

            renderUserRuleForm() {
                const form = getContainerEl(`#modeForm-${PAGE_CODE}`);
                if (!form) return;
                this.userRuleTables = [];
                this.userRuleColumns = [];
                this.userRuleValidation = null;
                form.innerHTML = `
                    <div class="edit-work-form-grid">
                        <label class="edit-work-field">
                            <span class="required-title">${this.escapeHtml(this.pageLabel("userRuleType", "사용자 규칙 유형"))}</span>
                            <select id="userRuleType-${PAGE_CODE}" onchange="${PAGE_CODE}.handleUserRuleTypeChange()">
                                <option value="ASSOCIATION">${this.escapeHtml(this.pageLabel("filterOptionAssociation", "연관 규칙"))}</option>
                                <option value="SYMBOLIC">${this.escapeHtml(this.pageLabel("filterOptionSymbolic", "수식 규칙"))}</option>
                            </select>
                        </label>
                        <label class="edit-work-field">
                            <span class="required-title">${this.escapeHtml(this.pageLabel("userRuleName", "규칙명"))}</span>
                            <input id="userRuleName-${PAGE_CODE}" type="text" oninput="${PAGE_CODE}.markUserRuleDirty()">
                        </label>
                        <label class="edit-work-field">
                            <span class="required-title">Target Owner</span>
                            <input id="userTargetOwner-${PAGE_CODE}" type="text" readonly placeholder="원본 테이블 선택 시 자동 설정">
                        </label>
                        <label class="edit-work-field">
                            <span class="required-title">INITUP$ 원본 테이블</span>
                            <select id="userTargetTable-${PAGE_CODE}" onchange="${PAGE_CODE}.handleUserTargetTableChange()" disabled>
                                <option value="">등록 테이블 로딩 중...</option>
                            </select>
                        </label>
                        <label class="edit-work-field">
                            <span class="required-title">대상 컬럼</span>
                            <select id="userTargetColumn-${PAGE_CODE}" onchange="${PAGE_CODE}.markUserRuleDirty()" disabled>
                                <option value="">원본 테이블을 먼저 선택하세요.</option>
                            </select>
                        </label>
                        <label class="edit-work-field">
                            <span>행 식별 컬럼</span>
                            <select id="userCaseIdColumn-${PAGE_CODE}" onchange="${PAGE_CODE}.markUserRuleDirty()" disabled>
                                <option value="">사용 안 함</option>
                            </select>
                        </label>
                        <label id="userExpectedValueField-${PAGE_CODE}" class="edit-work-field">
                            <span class="required-title">${this.escapeHtml(this.pageLabel("userExpectedValue", "THEN 결과값"))}</span>
                            <input id="userExpectedValue-${PAGE_CODE}" type="text" oninput="${PAGE_CODE}.markUserRuleDirty()">
                        </label>
                        <label id="userToleranceField-${PAGE_CODE}" class="edit-work-field" hidden>
                            <span class="required-title">${this.escapeHtml(this.pageLabel("userTolerance", "허용 오차율(%)"))}</span>
                            <input id="userRuleTolerance-${PAGE_CODE}" type="number" min="0" max="100" step="0.1" value="5" oninput="${PAGE_CODE}.markUserRuleDirty()">
                        </label>
                        <label class="edit-work-field is-wide"><span>규칙 설명</span><input id="userRuleDescription-${PAGE_CODE}" type="text" oninput="${PAGE_CODE}.markUserRuleDirty()"></label>
                        <label class="edit-work-field is-full">
                            <span id="userExpressionLabel-${PAGE_CODE}" class="required-title">${this.escapeHtml(this.pageLabel("userAssociationExpression", "IF 조건"))}</span>
                            <textarea id="userRuleExpression-${PAGE_CODE}" oninput="${PAGE_CODE}.markUserRuleDirty()"></textarea>
                        </label>
                    </div>
                    <div id="userRuleHelp-${PAGE_CODE}" class="edit-work-rule-help"></div>
                    <div id="userRuleValidation-${PAGE_CODE}" class="edit-work-rule-validation" aria-live="polite"></div>
                    <div id="userRuleActions-${PAGE_CODE}" class="edit-work-form-actions"></div>
                `;
                this.handleUserRuleTypeChange();
                this.renderUserRuleActions();
            },

            field(id, label, value = "", type = "text") {
                return `<label class="edit-work-field"><span>${this.escapeHtml(label)}</span><input id="${id}-${PAGE_CODE}" type="${type}" value="${this.escapeHtml(value)}"></label>`;
            },

            toggleUserRuleForm(force) {
                const form = getContainerEl(`#modeForm-${PAGE_CODE}`);
                if (!form) return;
                const show = force === undefined ? !form.classList.contains("is-visible") : Boolean(force);
                form.classList.toggle("is-visible", show);
                if (show) {
                    this.loadUserRuleTables().catch((error) => {
                        CommonMessage.error(error?.message || "등록된 원본 테이블을 조회하지 못했습니다.");
                    });
                }
            },

            async startNewUserRule() {
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                this.renderUserRuleForm();
                this.toggleUserRuleForm(true);
            },

            setUserRuleFormEditable(editable) {
                const form = getContainerEl(`#modeForm-${PAGE_CODE}`);
                if (!form) return;
                const allowEdit = Boolean(editable);
                form.classList.toggle("is-readonly-rule", !allowEdit);
                form.querySelectorAll(".edit-work-form-grid input, .edit-work-form-grid select, .edit-work-form-grid textarea")
                    .forEach((element) => {
                        if (element.id === `userTargetOwner-${PAGE_CODE}`) {
                            element.disabled = !allowEdit;
                            element.readOnly = true;
                            return;
                        }
                        if (!allowEdit) {
                            element.disabled = true;
                            return;
                        }
                        if (element.id === `userTargetTable-${PAGE_CODE}`) {
                            element.disabled = !this.userRuleTables.length;
                            return;
                        }
                        if (
                            element.id === `userTargetColumn-${PAGE_CODE}`
                            || element.id === `userCaseIdColumn-${PAGE_CODE}`
                        ) {
                            element.disabled = element.options.length <= 1;
                            return;
                        }
                        element.disabled = false;
                    });
            },

            renderUserRuleActions() {
                const actions = getContainerEl(`#userRuleActions-${PAGE_CODE}`);
                if (!actions) return;
                const selected = this.selectedMasterRule;
                const isUserRule = String(selected?.USER_RULE_YN || "N").toUpperCase() === "Y";
                const isStandaloneUserRule = isUserRule && !selected?.SOURCE_RULE_ID;
                const isCopyMode = Boolean(selected && this.userRuleCopyMode);
                const closeButton = `<button type="button" onclick="${PAGE_CODE}.toggleUserRuleForm(false)">${this.escapeHtml(this.pageLabel("buttonClose", "닫기"))}</button>`;
                const validateButton = `<button type="button" onclick="${PAGE_CODE}.validateUserRule()"><i class="fas fa-check-circle"></i>${this.escapeHtml(this.pageLabel("buttonValidateRule", "규칙 검증"))}</button>`;
                if (isCopyMode) {
                    actions.innerHTML = `
                        ${closeButton}
                        <button type="button" onclick="${PAGE_CODE}.cancelUserRuleCopy()"><i class="fas fa-rotate-left"></i>${this.escapeHtml(this.pageLabel("buttonCancelRuleCopy", "복제 취소"))}</button>
                        ${validateButton}
                        <button type="button" class="is-primary" onclick="${PAGE_CODE}.saveUserRule('COPY')"><i class="fas fa-plus"></i>${this.escapeHtml(this.pageLabel("buttonRegisterRule", "규칙 등록"))}</button>
                    `;
                    return;
                }
                if (!selected) {
                    actions.innerHTML = `${closeButton}${validateButton}<button type="button" class="is-primary" onclick="${PAGE_CODE}.saveUserRule('CREATE')"><i class="fas fa-plus"></i>${this.escapeHtml(this.pageLabel("buttonRegisterRule", "규칙 등록"))}</button>`;
                    return;
                }
                const copyButton = `<button type="button" onclick="${PAGE_CODE}.beginUserRuleCopy()"><i class="fas fa-copy"></i>${this.escapeHtml(this.pageLabel("buttonRegisterRuleAs", "다른 이름으로 규칙 등록"))}</button>`;
                if (!isStandaloneUserRule) {
                    actions.innerHTML = `
                        ${closeButton}
                        <button type="button" class="is-danger" onclick="${PAGE_CODE}.excludeSelectedDiscoveredRule()"><i class="fas fa-ban"></i>${this.escapeHtml(this.pageLabel("buttonExcludeSelection", "선정 제외"))}</button>
                        ${copyButton}
                    `;
                    return;
                }
                actions.innerHTML = `
                    ${closeButton}
                    ${validateButton}
                    ${isStandaloneUserRule ? `<button type="button" class="is-danger" onclick="${PAGE_CODE}.deleteSelectedUserRule()"><i class="fas fa-trash"></i>${this.escapeHtml(this.pageLabel("buttonDeleteRule", "규칙 삭제"))}</button>` : ""}
                    ${copyButton}
                    <button type="button" class="is-primary" onclick="${PAGE_CODE}.saveUserRule('UPDATE')"><i class="fas fa-save"></i>${this.escapeHtml(this.pageLabel("buttonUpdateRule", "규칙 수정"))}</button>
                `;
            },

            beginUserRuleCopy() {
                const row = this.selectedMasterRule;
                if (!row?.EDIT_RULE_ID) {
                    CommonMessage.warn("복제할 규칙을 선택하세요.");
                    return;
                }
                this.userRuleCopyMode = true;
                this.editingUserRuleId = null;
                const name = getContainerEl(`#userRuleName-${PAGE_CODE}`);
                if (name) name.value = `${row.RULE_NAME || row.SOURCE_RULE_ID || "RULE"}_COPY`;
                this.setUserRuleFormEditable(true);
                this.markUserRuleDirty();
                this.renderUserRuleActions();
                name?.focus();
                name?.select();
                const status = getContainerEl(`#userRuleValidation-${PAGE_CODE}`);
                if (status) {
                    status.className = "edit-work-rule-validation is-context";
                    status.textContent = this.pageLabel(
                        "userRuleCopyModeMessage",
                        "복제할 사용자 규칙 정보를 확인한 후 규칙 등록을 실행하세요."
                    );
                }
            },

            async cancelUserRuleCopy() {
                const editRuleId = this.selectedMasterRule?.EDIT_RULE_ID;
                this.userRuleCopyMode = false;
                if (editRuleId) await this.selectMasterRule(editRuleId);
            },

            hideModeForm() {
                getContainerEl(`#modeForm-${PAGE_CODE}`)?.classList.remove("is-visible");
            },

            async loadUserRuleTables() {
                const select = getContainerEl(`#userTargetTable-${PAGE_CODE}`);
                const owner = getContainerEl(`#userTargetOwner-${PAGE_CODE}`);
                if (!select || !owner) return;
                const params = this.contextParams();
                select.disabled = true;
                select.innerHTML = `<option value="">등록 테이블 로딩 중...</option>`;
                owner.value = "";
                this.renderUserRuleColumns([]);
                const json = await CommonUtils.request(apiUrl(`/source-tables?${params}`), {
                    method: "GET",
                    showLoading: false
                });
                this.userRuleTables = Array.isArray(json.data) ? json.data : [];
                select.innerHTML = this.userRuleTables.length
                    ? `
                        <option value="">INITUP$ 원본 테이블 선택</option>
                        ${this.userRuleTables.map((row) => `
                            <option value="${this.escapeHtml(row.TABLE_NAME)}" data-owner="${this.escapeHtml(row.OWNER_NAME)}">
                                ${this.escapeHtml(row.OWNER_NAME)}.${this.escapeHtml(row.TABLE_NAME)}
                                ${row.TABLE_COMMENT ? ` · ${this.escapeHtml(row.TABLE_COMMENT)}` : ""}
                            </option>
                        `).join("")}
                    `
                    : `<option value="">등록된 INITUP$ 원본 테이블이 없습니다.</option>`;
                select.disabled = !this.userRuleTables.length;
            },

            async handleUserTargetTableChange() {
                const select = getContainerEl(`#userTargetTable-${PAGE_CODE}`);
                const owner = getContainerEl(`#userTargetOwner-${PAGE_CODE}`);
                const option = select?.selectedOptions?.[0];
                const targetOwner = option?.dataset?.owner || "";
                const targetTable = select?.value || "";
                if (owner) owner.value = targetOwner;
                this.renderUserRuleColumns([]);
                if (!targetOwner || !targetTable) return;

                const params = this.contextParams();
                params.set("targetOwner", targetOwner);
                params.set("targetTable", targetTable);
                const json = await CommonUtils.request(apiUrl(`/source-columns?${params}`), {
                    method: "GET",
                    showLoading: false
                });
                this.userRuleColumns = Array.isArray(json.data) ? json.data : [];
                this.renderUserRuleColumns(this.userRuleColumns);
                this.markUserRuleDirty();
            },

            async selectMasterRule(editRuleId) {
                if (this.stage.mode !== "RULE_MASTER") return;
                const row = this.rows.find((item) => Number(item.EDIT_RULE_ID) === Number(editRuleId));
                if (!row?.EDIT_RULE_ID) return;
                const requestId = ++this.masterSelectionRequestId;
                this.selectedMasterRule = row;
                this.selectedMasterRuleId = String(row.EDIT_RULE_ID);
                this.userRuleCopyMode = false;
                const isUserRule = String(row.USER_RULE_YN || "N").toUpperCase() === "Y";
                const isStandaloneUserRule = isUserRule && !row.SOURCE_RULE_ID;
                this.editingUserRuleId = isStandaloneUserRule ? Number(row.EDIT_RULE_ID) : null;
                getContainerEl(`#workContent-${PAGE_CODE}`)
                    ?.querySelectorAll("tbody tr.is-master-selectable")
                    .forEach((element) => {
                        element.classList.toggle(
                            "is-selected-row",
                            String(element.dataset.editRuleId || "") === this.selectedMasterRuleId
                        );
                    });

                const form = getContainerEl(`#modeForm-${PAGE_CODE}`);
                form?.classList.add("is-visible");
                this.setUserRuleFormEditable(false);
                const ruleType = String(row.SOURCE_RULE_TYPE || "ASSOCIATION").toUpperCase() === "SYMBOLIC"
                    ? "SYMBOLIC"
                    : "ASSOCIATION";
                const setValue = (id, value) => {
                    const element = getContainerEl(`#${id}-${PAGE_CODE}`);
                    if (element) element.value = value ?? "";
                };
                setValue("userRuleType", ruleType);
                this.handleUserRuleTypeChange();
                setValue("userRuleName", row.RULE_NAME || row.SOURCE_RULE_ID || "RULE");
                setValue("userRuleDescription", row.RULE_DESCRIPTION || "");
                setValue("userRuleExpression", row.RULE_EXPRESSION || "");
                setValue("userExpectedValue", row.EXPECTED_VALUE ?? "");
                setValue("userRuleTolerance", row.RULE_TOLERANCE_PCT ?? row.RULE_LIFT ?? 5);

                await this.loadUserRuleTables();
                if (requestId !== this.masterSelectionRequestId) return;
                const tableSelect = getContainerEl(`#userTargetTable-${PAGE_CODE}`);
                if (tableSelect) {
                    const matchedOption = Array.from(tableSelect.options).find((option) => (
                        option.value === row.TARGET_TABLE
                        && String(option.dataset.owner || "") === String(row.TARGET_OWNER || "")
                    ));
                    if (matchedOption) matchedOption.selected = true;
                }
                setValue("userTargetOwner", row.TARGET_OWNER || "");
                await this.handleUserTargetTableChange();
                if (requestId !== this.masterSelectionRequestId) return;
                this.ensureUserRuleColumnOption(
                    "userTargetColumn",
                    row.TARGET_COLUMN,
                    row.TARGET_COLUMN_COMMENT
                );
                setValue("userTargetColumn", row.TARGET_COLUMN || "");
                setValue("userCaseIdColumn", row.CASE_ID_COLUMN || "");
                this.userRuleValidation = null;
                this.markUserRuleDirty();
                this.setUserRuleFormEditable(isStandaloneUserRule);
                this.renderUserRuleActions();
                const status = getContainerEl(`#userRuleValidation-${PAGE_CODE}`);
                if (status) {
                    status.className = isStandaloneUserRule
                        ? "edit-work-rule-validation"
                        : "edit-work-rule-validation is-context";
                    status.textContent = isStandaloneUserRule
                        ? ""
                        : `기존 발굴 규칙 ID #${row.EDIT_RULE_ID} · 수정할 수 없으며 다른 이름으로 사용자 규칙을 등록할 수 있습니다.`;
                }
            },

            ensureUserRuleColumnOption(selectId, columnName, columnComment = "") {
                const normalizedColumn = String(columnName || "").trim();
                const select = getContainerEl(`#${selectId}-${PAGE_CODE}`);
                if (!select || !normalizedColumn) return;
                const exists = Array.from(select.options).some(
                    (option) => String(option.value || "").toUpperCase() === normalizedColumn.toUpperCase()
                );
                if (exists) return;
                const option = document.createElement("option");
                option.value = normalizedColumn;
                option.textContent = columnComment
                    ? `${normalizedColumn} ${columnComment}`
                    : normalizedColumn;
                select.appendChild(option);
            },

            renderUserRuleColumns(columns) {
                const target = getContainerEl(`#userTargetColumn-${PAGE_CODE}`);
                const caseId = getContainerEl(`#userCaseIdColumn-${PAGE_CODE}`);
                const rows = Array.isArray(columns) ? columns : [];
                const previousTarget = target?.value || "";
                const optionHtml = (optionRows) => optionRows.map((row) => `
                    <option value="${this.escapeHtml(row.COLUMN_NAME)}">
                        ${this.escapeHtml(row.COLUMN_NAME)}
                        ${row.COLUMN_COMMENT ? ` ${this.escapeHtml(row.COLUMN_COMMENT)}` : ""}
                        · ${this.escapeHtml(row.DATA_TYPE || "")}
                    </option>
                `).join("");
                if (target) {
                    target.innerHTML = rows.length
                        ? `<option value="">대상 컬럼 선택</option>${optionHtml(rows)}`
                        : `<option value="">원본 테이블을 먼저 선택하세요.</option>`;
                    target.disabled = !rows.length;
                    if (rows.some((row) => row.COLUMN_NAME === previousTarget)) target.value = previousTarget;
                }
                if (caseId) {
                    const previousCaseId = caseId.value || "";
                    caseId.innerHTML = `<option value="">사용 안 함</option>${optionHtml(rows)}`;
                    caseId.disabled = !rows.length;
                    if (rows.some((row) => row.COLUMN_NAME === previousCaseId)) caseId.value = previousCaseId;
                }
            },

            handleUserRuleTypeChange() {
                const ruleType = getContainerEl(`#userRuleType-${PAGE_CODE}`)?.value || "ASSOCIATION";
                const symbolic = ruleType === "SYMBOLIC";
                const expectedField = getContainerEl(`#userExpectedValueField-${PAGE_CODE}`);
                const toleranceField = getContainerEl(`#userToleranceField-${PAGE_CODE}`);
                const expressionLabel = getContainerEl(`#userExpressionLabel-${PAGE_CODE}`);
                const expression = getContainerEl(`#userRuleExpression-${PAGE_CODE}`);
                const help = getContainerEl(`#userRuleHelp-${PAGE_CODE}`);
                if (expectedField) expectedField.hidden = symbolic;
                if (toleranceField) toleranceField.hidden = !symbolic;
                if (expressionLabel) {
                    expressionLabel.textContent = `${this.pageLabel(symbolic ? "userSymbolicExpression" : "userAssociationExpression", symbolic ? "f(X) 수식" : "IF 조건")} *`;
                }
                if (expression) {
                    expression.placeholder = symbolic
                        ? this.pageLabel("userSymbolicPlaceholder", "(COL005 + COL006) / 2")
                        : this.pageLabel("userAssociationPlaceholder", "COL001 = '11' AND COL007 IN ('1', '2')");
                }
                if (help) {
                    help.innerHTML = symbolic
                        ? `<strong>${this.escapeHtml(this.pageLabel("userSymbolicFormatTitle", "수식 규칙 입력 형식"))}</strong><span>${this.escapeHtml(this.pageLabel("userSymbolicFormatHelp", "숫자형 피처로 예측 수식 f(X)를 작성합니다. 실제값과 예측값의 차이가 허용 오차율을 넘으면 위반입니다."))}</span><code>(COL005 + COL006) / 2</code>`
                        : `<strong>${this.escapeHtml(this.pageLabel("userAssociationFormatTitle", "연관 규칙 입력 형식"))}</strong><span>${this.escapeHtml(this.pageLabel("userAssociationFormatHelp", "IF 조건을 만족하지만 대상 컬럼이 THEN 결과값과 다른 행을 위반으로 조회합니다."))}</span><code>COL001 = '11' AND COL007 IN ('1', '2')</code>`;
                }
                this.renderUserRuleColumns(this.userRuleColumns);
                this.markUserRuleDirty();
            },

            markUserRuleDirty() {
                this.userRuleValidation = null;
                const status = getContainerEl(`#userRuleValidation-${PAGE_CODE}`);
                if (status) {
                    status.className = "edit-work-rule-validation";
                    status.textContent = "";
                }
            },

            collectUserRulePayload() {
                const value = (id) => getContainerEl(`#${id}-${PAGE_CODE}`)?.value?.trim?.() || "";
                const ruleType = value("userRuleType") || "ASSOCIATION";
                return {
                    projectId: this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value),
                    scenarioId: this.optionalNumber(getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value),
                    sourceRuleType: ruleType,
                    userRuleYn: true,
                    targetOwner: value("userTargetOwner"),
                    targetTable: value("userTargetTable"),
                    targetColumn: value("userTargetColumn"),
                    caseIdColumn: value("userCaseIdColumn") || null,
                    ruleName: value("userRuleName"),
                    ruleDescription: value("userRuleDescription"),
                    ruleExpression: value("userRuleExpression"),
                    expectedValue: ruleType === "ASSOCIATION" ? value("userExpectedValue") : null,
                    ruleTolerancePct: ruleType === "SYMBOLIC" ? Number(value("userRuleTolerance") || 5) : null,
                    decisionStatus: "SELECTED",
                    ruleStatus: "ACTIVE"
                };
            },

            validateUserRuleInput(payload) {
                const required = [
                    ["userRuleName", payload.ruleName, "규칙명을 입력하세요."],
                    ["userTargetTable", payload.targetTable, "프로젝트·시나리오에 등록된 INITUP$ 원본 테이블을 선택하세요."],
                    ["userTargetColumn", payload.targetColumn, "대상 컬럼을 선택하세요."],
                    ["userRuleExpression", payload.ruleExpression, "규칙 표현식/조건을 입력하세요."]
                ];
                if (payload.sourceRuleType === "ASSOCIATION") {
                    required.push(["userExpectedValue", payload.expectedValue, "연관 규칙의 THEN 결과값을 입력하세요."]);
                }
                const missing = required.find(([, fieldValue]) => !fieldValue);
                if (missing) {
                    CommonMessage.warn(missing[2]);
                    getContainerEl(`#${missing[0]}-${PAGE_CODE}`)?.focus();
                    return false;
                }
                if (!payload.targetOwner) {
                    CommonMessage.warn("원본 테이블의 Target Owner를 확인할 수 없습니다. 테이블을 다시 선택하세요.");
                    return false;
                }
                if (payload.sourceRuleType === "SYMBOLIC" && (!Number.isFinite(payload.ruleTolerancePct) || payload.ruleTolerancePct < 0 || payload.ruleTolerancePct > 100)) {
                    CommonMessage.warn("허용 오차율은 0 이상 100 이하로 입력하세요.");
                    getContainerEl(`#userRuleTolerance-${PAGE_CODE}`)?.focus();
                    return false;
                }
                return true;
            },

            async validateUserRule(showSuccess = true) {
                const payload = this.collectUserRulePayload();
                if (!this.validateUserRuleInput(payload)) return null;
                const status = getContainerEl(`#userRuleValidation-${PAGE_CODE}`);
                if (status) {
                    status.className = "edit-work-rule-validation is-loading";
                    status.textContent = this.pageLabel("userRuleValidating", "규칙을 검증하고 있습니다.");
                }
                const validationPayload = {
                    projectId: payload.projectId,
                    scenarioId: payload.scenarioId,
                    sourceRuleType: payload.sourceRuleType,
                    targetOwner: payload.targetOwner,
                    targetTable: payload.targetTable,
                    targetColumn: payload.targetColumn,
                    caseIdColumn: payload.caseIdColumn,
                    ruleExpression: payload.ruleExpression,
                    expectedValue: payload.expectedValue,
                    ruleTolerancePct: payload.ruleTolerancePct
                };
                try {
                    const json = await CommonUtils.request(apiUrl("/rules/validate"), {
                        method: "POST",
                        body: validationPayload,
                        showLoading: false
                    });
                    this.userRuleValidation = json.data || {};
                    const sampleCount = Number(this.userRuleValidation.sampleCount || 0).toLocaleString();
                    const matchText = payload.sourceRuleType === "ASSOCIATION"
                        ? ` · ${this.pageLabel("userRuleMatched", "조건 일치")} ${Number(this.userRuleValidation.matchCount || 0).toLocaleString()}`
                        : ` · ${this.pageLabel("userRuleToleranceResult", "허용 오차")} ${this.formatMetric(this.userRuleValidation.ruleTolerancePct)}%`;
                    if (status) {
                        status.className = showSuccess
                            ? "edit-work-rule-validation is-success"
                            : "edit-work-rule-validation";
                        status.textContent = showSuccess
                            ? `${this.pageLabel("userRuleValidationPassed", "검증 완료")} · ${this.pageLabel("userRuleSample", "샘플")} ${sampleCount}${matchText}`
                            : "";
                    }
                    if (showSuccess) CommonMessage.success(this.pageLabel("userRuleValidationPassedMessage", "규칙 검증을 완료했습니다."));
                    return this.userRuleValidation;
                } catch (error) {
                    this.userRuleValidation = null;
                    if (status) {
                        status.className = "edit-work-rule-validation is-error";
                        status.textContent = error?.message || this.pageLabel("userRuleValidationFailed", "규칙 검증에 실패했습니다.");
                    }
                    throw error;
                }
            },

            isUserRuleDefinitionChanged(payload) {
                const row = this.selectedMasterRule;
                if (!row) return true;
                const normalizedRowType = String(row.SOURCE_RULE_TYPE || "ASSOCIATION").toUpperCase() === "SYMBOLIC"
                    ? "SYMBOLIC"
                    : "ASSOCIATION";
                const rowTolerance = Number(row.RULE_TOLERANCE_PCT ?? row.RULE_LIFT ?? 5);
                return [
                    normalizedRowType !== payload.sourceRuleType,
                    String(row.TARGET_OWNER || "").toUpperCase() !== String(payload.targetOwner || "").toUpperCase(),
                    String(row.TARGET_TABLE || "").toUpperCase() !== String(payload.targetTable || "").toUpperCase(),
                    String(row.TARGET_COLUMN || "").toUpperCase() !== String(payload.targetColumn || "").toUpperCase(),
                    String(row.CASE_ID_COLUMN || "").toUpperCase() !== String(payload.caseIdColumn || "").toUpperCase(),
                    String(row.RULE_EXPRESSION || "").trim() !== String(payload.ruleExpression || "").trim(),
                    String(row.EXPECTED_VALUE ?? "").trim() !== String(payload.expectedValue ?? "").trim(),
                    payload.sourceRuleType === "SYMBOLIC" && rowTolerance !== Number(payload.ruleTolerancePct ?? 5)
                ].some(Boolean);
            },

            reportRuleActionError(error, fallback = "규칙을 저장하지 못했습니다.") {
                const message = String(error?.message || fallback);
                const status = getContainerEl(`#userRuleValidation-${PAGE_CODE}`);
                if (status) {
                    status.className = "edit-work-rule-validation is-error";
                    status.textContent = message;
                }
                CommonMessage.error(message);
            },

            async saveUserRule(action = "CREATE") {
                try {
                    return await this.persistUserRule(action);
                } catch (error) {
                    this.reportRuleActionError(error);
                    return null;
                }
            },

            async persistUserRule(action = "CREATE") {
                const payload = this.collectUserRulePayload();
                if (!this.validateUserRuleInput(payload)) return;
                const normalizedAction = String(action || "CREATE").toUpperCase();
                if (normalizedAction === "UPDATE") {
                    if (!this.editingUserRuleId) {
                        CommonMessage.warn("수정할 사용자 규칙을 선택하세요.");
                        return;
                    }
                    payload.editRuleId = this.editingUserRuleId;
                } else if (normalizedAction === "COPY" && this.selectedMasterRule) {
                    if (String(payload.ruleName || "").trim() === String(this.selectedMasterRule.RULE_NAME || "").trim()) {
                        CommonMessage.warn("다른 이름으로 등록하려면 기존 규칙명과 다른 규칙명을 입력하세요.");
                        getContainerEl(`#userRuleName-${PAGE_CODE}`)?.focus();
                        return;
                    }
                    payload.editRuleId = null;
                }
                const requiresValidation = normalizedAction !== "UPDATE" || this.isUserRuleDefinitionChanged(payload);
                if (requiresValidation) {
                    const validation = await this.validateUserRule(false);
                    if (!validation) return;
                }
                const saved = await CommonUtils.request(apiUrl("/rules"), {
                    method: "POST",
                    body: payload,
                    showLoading: false
                });
                if (!saved?.editRuleId || !saved?.data) {
                    throw new Error("저장 후 규칙 정보를 확인하지 못했습니다.");
                }
                const completionMessage = normalizedAction === "UPDATE"
                    ? this.pageLabel("userRuleUpdated", "사용자 규칙을 수정했습니다.")
                    : this.pageLabel("userRuleRegistered", "사용자 규칙을 등록했습니다.");
                CommonMessage.success(completionMessage);
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                await this.refresh();
                if (this.rows.some((row) => Number(row.EDIT_RULE_ID) === Number(saved.editRuleId))) {
                    await this.selectMasterRule(saved.editRuleId);
                    const status = getContainerEl(`#userRuleValidation-${PAGE_CODE}`);
                    if (status) {
                        status.className = "edit-work-rule-validation is-success";
                        status.textContent = completionMessage;
                    }
                }
            },

            async deleteSelectedUserRule() {
                const row = this.selectedMasterRule;
                if (!row || String(row.USER_RULE_YN || "N").toUpperCase() !== "Y") {
                    CommonMessage.warn("삭제할 사용자 규칙을 선택하세요.");
                    return;
                }
                if (!(await CommonMessage.confirm(`사용자 규칙 '${row.RULE_NAME || row.EDIT_RULE_ID}'을(를) 삭제할까요?`))) return;
                const projectId = this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value);
                const params = new URLSearchParams();
                if (projectId) params.set("projectId", projectId);
                await CommonUtils.request(apiUrl(`/rules/${row.EDIT_RULE_ID}?${params}`), {
                    method: "DELETE",
                    showLoading: false
                });
                CommonMessage.success(this.pageLabel("userRuleDeleted", "사용자 규칙을 삭제했습니다."));
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                await this.refresh();
            },

            async excludeSelectedDiscoveredRule() {
                const row = this.selectedMasterRule;
                if (!row?.EDIT_RULE_ID || !row.SOURCE_RULE_ID) {
                    CommonMessage.warn("선정 제외할 기존 발굴 규칙을 선택하세요.");
                    return;
                }
                if (!(await CommonMessage.confirm(`기존 규칙 '${row.RULE_NAME || row.SOURCE_RULE_ID}'을(를) 선정 제외할까요?`))) return;
                await this.excludeDiscoveredRule(row);
                this.invalidateEditWorkspaceCache("M05001");
                CommonMessage.success("기존 규칙을 선정 제외했습니다.");
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                await this.refresh();
            },

            isMasterRuleBulkExcludable(row) {
                return Boolean(
                    row?.EDIT_RULE_ID
                    && row?.SOURCE_RULE_ID
                    && row?.SOURCE_RUN_SOURCE_TYPE
                    && row?.SOURCE_RUN_ID !== null
                    && row?.SOURCE_RUN_ID !== undefined
                    && String(row.USER_RULE_YN || "N").toUpperCase() === "N"
                    && String(row.DECISION_STATUS || "").toUpperCase() !== "REJECTED"
                );
            },

            toggleMasterRuleRow(index, checked) {
                const row = this.getVisibleRows()[index];
                if (!this.isMasterRuleBulkExcludable(row)) return;
                const key = this.ruleRowKey(row);
                if (checked) this.selectedRuleIds.add(key);
                else this.selectedRuleIds.delete(key);
            },

            toggleVisibleMasterRules(checked) {
                const visible = this.getVisibleRows().filter((row) => this.isMasterRuleBulkExcludable(row));
                visible.forEach((row) => {
                    const key = this.ruleRowKey(row);
                    if (checked) this.selectedRuleIds.add(key);
                    else this.selectedRuleIds.delete(key);
                });
                getContainerEl(`#workContent-${PAGE_CODE}`)
                    ?.querySelectorAll("tbody .is-select-column input[type='checkbox']:not(:disabled)")
                    .forEach((input) => {
                        input.checked = Boolean(checked);
                    });
            },

            async excludeCheckedMasterRules() {
                const selected = this.rows.filter((row) => (
                    this.selectedRuleIds.has(this.ruleRowKey(row))
                    && this.isMasterRuleBulkExcludable(row)
                ));
                if (!selected.length) {
                    CommonMessage.warn(this.pageLabel("bulkExcludeNoSelection", "선정 제외할 기존 발굴 규칙을 체크하세요."));
                    return;
                }
                const template = this.pageLabel(
                    "bulkExcludeConfirm",
                    "선택한 기존 발굴 규칙 {count}개를 선정 제외할까요?\n규칙판단 탭에서도 제외 상태로 표시됩니다."
                );
                if (!(await CommonMessage.confirm(template.replaceAll("{count}", String(selected.length))))) return;
                const projectId = this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value);
                this.setWorkActionLoading(true, this.pageLabel("bulkExcludeLoading", "선택한 규칙을 선정 제외하고 있습니다."));
                let result;
                try {
                    result = await CommonUtils.request(apiUrl("/rules/exclude"), {
                        method: "POST",
                        body: {
                            projectId,
                            editRuleIds: selected.map((row) => Number(row.EDIT_RULE_ID))
                        },
                        showLoading: false
                    });
                } finally {
                    this.setWorkActionLoading(false);
                }
                const excludedCount = Number(result.excludedCount || selected.length);
                CommonMessage.success(
                    this.pageLabel("bulkExcludeSuccess", "기존 발굴 규칙 {count}개를 선정 제외했습니다.")
                        .replaceAll("{count}", excludedCount.toLocaleString())
                );
                this.selectedRuleIds.clear();
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                this.invalidateEditWorkspaceCache("M05001");
                await this.refresh();
            },

            async excludeDiscoveredRule(row) {
                if (!row?.EDIT_RULE_ID || !row.SOURCE_RULE_ID) {
                    throw new Error("선정 제외할 기존 발굴 규칙 정보가 올바르지 않습니다.");
                }
                const projectId = this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value);
                const params = new URLSearchParams();
                if (projectId) params.set("projectId", projectId);
                const result = await CommonUtils.request(
                    apiUrl(`/rules/${row.EDIT_RULE_ID}/exclude?${params}`),
                    {
                        method: "POST",
                        showLoading: false
                    }
                );
                if (String(result?.decisionStatus || "").toUpperCase() !== "REJECTED") {
                    throw new Error("선정 제외 상태를 저장 후 확인하지 못했습니다.");
                }
                return result;
            },

            ruleRowKey(row) {
                return String(row.EDIT_RULE_ID || [
                    row.SOURCE_RULE_TYPE,
                    row.RUN_SOURCE_TYPE,
                    row.RUN_ID,
                    row.SOURCE_OWNER,
                    row.SOURCE_OBJECT_NAME,
                    row.SOURCE_RULE_ID
                ].join("|"));
            },

            toggleRuleRow(index, checked) {
                const row = this.getVisibleRows()[index];
                if (!row) return;
                const key = this.ruleRowKey(row);
                if (checked) this.selectedRuleIds.add(key);
                else this.selectedRuleIds.delete(key);
            },

            toggleVisibleRules(checked) {
                this.rows.forEach((row) => {
                    const key = this.ruleRowKey(row);
                    if (checked) this.selectedRuleIds.add(key);
                    else this.selectedRuleIds.delete(key);
                });
                getContainerEl(`#workContent-${PAGE_CODE}`)
                    ?.querySelectorAll("tbody .is-select-column input[type='checkbox']")
                    .forEach((input) => {
                        input.checked = Boolean(checked);
                    });
            },

            async saveCheckedDecision(status) {
                if (this.ruleDecisionSaving) return;
                const selected = this.rows.filter((row) => this.selectedRuleIds.has(this.ruleRowKey(row)));
                if (!selected.length) {
                    CommonMessage.warn("처리할 규칙을 선택하세요.");
                    return;
                }
                if (!(await CommonMessage.confirm(`${selected.length}개 규칙을 ${status === "SELECTED" ? "선정" : "제외"} 처리할까요?`))) return;
                const selecting = String(status || "").toUpperCase() === "SELECTED";
                const loadingMessage = this.pageLabel(
                    selecting ? "bulkRuleSelecting" : "bulkRuleRejecting",
                    selecting ? "선택한 규칙을 일괄 선정하고 있습니다." : "선택한 규칙을 일괄 제외하고 있습니다."
                );
                this.ruleDecisionSaving = true;
                this.setWorkActionLoading(true, loadingMessage, false);
                const workContent = getContainerEl(`#workContent-${PAGE_CODE}`);
                workContent?.setAttribute("aria-busy", "true");
                workContent?.classList.add("is-rule-decision-saving");
                try {
                    for (const row of selected) {
                        await this.submitRuleDecision(row, status);
                    }
                    this.invalidateEditWorkspaceCache("M05001_RULE_MASTER");
                    this.selectedRuleIds.clear();
                    CommonMessage.success(`${selected.length}개 규칙을 ${selecting ? "선정" : "제외"} 처리했습니다.`);
                    await this.refresh();
                } catch (error) {
                    await this.refresh();
                    throw error;
                } finally {
                    this.ruleDecisionSaving = false;
                    this.setWorkActionLoading(false);
                    workContent?.removeAttribute("aria-busy");
                    workContent?.classList.remove("is-rule-decision-saving");
                }
            },

            async saveRuleDecision(index, status) {
                if (this.ruleDecisionSaving) return;
                const row = this.getVisibleRows()[index];
                if (!row) return;
                await this.submitRuleDecision(row, status);
                this.invalidateEditWorkspaceCache("M05001_RULE_MASTER");
                CommonMessage.success(`규칙을 ${status === "SELECTED" ? "선정" : "제외"} 처리했습니다.`);
                await this.refresh();
            },

            async submitRuleDecision(row, decisionStatus) {
                if (
                    String(decisionStatus || "").toUpperCase() === "REJECTED"
                    && this.optionalNumber(row?.EDIT_RULE_ID)
                    && row?.SOURCE_RULE_ID
                ) {
                    return this.excludeDiscoveredRule(row);
                }
                const payload = {
                    editRuleId: this.optionalNumber(row.EDIT_RULE_ID),
                    projectId: this.optionalNumber(row.PROJECT_ID),
                    scenarioId: this.optionalNumber(row.SCENARIO_ID),
                    sourceRuleType: row.SOURCE_RULE_TYPE,
                    runSourceType: row.RUN_SOURCE_TYPE,
                    runId: this.optionalNumber(row.RUN_ID),
                    sourceOwner: row.SOURCE_OWNER,
                    sourceObjectName: row.SOURCE_OBJECT_NAME,
                    sourceRuleId: row.SOURCE_RULE_ID,
                    targetOwner: row.TARGET_OWNER,
                    targetTable: row.TARGET_TABLE,
                    targetColumn: row.TARGET_COLUMN,
                    caseIdColumn: row.CASE_ID_COLUMN || null,
                    ruleName: row.SOURCE_RULE_ID || row.RULE_NAME,
                    ruleDescription: row.RESULT_EXPRESSION || "",
                    ruleExpression: row.RULE_EXPRESSION || "",
                    expectedValue: row.EXPECTED_VALUE ?? null,
                    ruleSupport: this.optionalNumber(row.RULE_SUPPORT),
                    ruleConfidence: this.optionalNumber(row.RULE_CONFIDENCE),
                    ruleLift: this.optionalNumber(row.RULE_LIFT),
                    decisionStatus,
                    ruleStatus: "ACTIVE"
                };
                if (!payload.projectId || !payload.scenarioId) {
                    throw new Error(this.pageLabel(
                        "ruleContextMissing",
                        "규칙 원본 행의 프로젝트 또는 시나리오를 확인할 수 없습니다. 다시 조회하세요."
                    ));
                }
                await CommonUtils.request(apiUrl("/rules"), { method: "POST", body: payload, showLoading: false });
            },

            async loadViolationSourceTables(force = false) {
                if (this.violationSourceTablesLoaded && !force) {
                    this.renderEditingTableGrid();
                    return;
                }
                const params = this.contextParams();
                const json = await CommonUtils.request(
                    apiUrl(`/editing-tables?${params}`),
                    { method: "GET", showLoading: false }
                );
                this.violationSourceTables = Array.isArray(json.data) ? json.data : [];
                this.violationSourceTablesLoaded = true;
                const selected = this.getSelectedViolationSource();
                if (!selected && this.stageFilters.VIOLATION_TARGET_TABLE) {
                    this.stageFilters.VIOLATION_TARGET_TABLE = "";
                    this.editingTableStatus = null;
                }
                this.renderEditingTableGrid();
            },

            getSelectedViolationSource() {
                const selected = String(this.stageFilters.VIOLATION_TARGET_TABLE || "");
                if (!selected || selected === "ALL") return null;
                return this.violationSourceTables.find(
                    (row) => `${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`.toUpperCase() === selected.toUpperCase()
                ) || null;
            },

            resolveEditingTableSelection() {
                let source = this.getSelectedViolationSource();
                let session = this.getSelectedSession();
                if (!source && session) {
                    const sourceValue = `${session.TARGET_OWNER || ""}.${session.SOURCE_TABLE || ""}`.toUpperCase();
                    if (this.violationSourceTables.some(
                        (row) => `${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`.toUpperCase() === sourceValue
                    )) {
                        this.stageFilters.VIOLATION_TARGET_TABLE = sourceValue;
                        source = this.getSelectedViolationSource();
                    }
                }
                if (source) {
                    session = this.preferredExecutionForSource(source);
                    this.selectExecution(session);
                }
                this.renderEditingTableGrid();
                this.renderSourceContext();
                return { source, session };
            },

            editingTableRowStatus(row) {
                if (row?.EDIT_TABLE_EXISTS && !row?.STRUCTURE_MATCHES) {
                    return {
                        className: "is-invalid",
                        label: this.pageLabel("editingTableStatusMismatch", "구조 불일치")
                    };
                }
                if (row?.EDITABLE) {
                    return {
                        className: "is-ready",
                        label: this.pageLabel("editingTableStatusReady", "수정 가능")
                    };
                }
                if (row?.EDIT_TABLE_EXISTS) {
                    return {
                        className: "is-pending",
                        label: this.pageLabel("editingTableStatusPending", "오류 수정 시작 필요")
                    };
                }
                return {
                    className: "is-missing",
                    label: this.pageLabel("editingTableStatusMissing", "미생성")
                };
            },

            renderEditingTableGrid() {
                const host = getContainerEl(`#editingTableGrid-${PAGE_CODE}`);
                if (!host || !this.usesEditingTableSelection()) return;
                host.hidden = false;
                const correctionMode = this.stage.mode === "VIOLATIONS";
                const historyMode = this.stage.mode === "CHANGE_HISTORY";
                const workflowMode = ["VALIDATION", "FINAL_APPLY", "HISTORY"].includes(this.stage.mode);
                const executionHistoryMode = ["CHANGE_HISTORY", "HISTORY"].includes(this.stage.mode);
                const selectedValue = String(this.stageFilters.VIOLATION_TARGET_TABLE || "").toUpperCase();
                host.innerHTML = `
                    <div class="edit-work-table-map-heading">
                        <strong>${this.escapeHtml(this.pageLabel("editingTableMapTitle", "오류 수정 작업 테이블"))}</strong>
                        <span>${this.escapeHtml(workflowMode
                            ? this.pageLabel("editingWorkflowTableMapHelp", "효과 검증·운영 반영·전체 이력을 조회할 INITUP$/INITDN$ 작업 테이블 한 행을 선택합니다.")
                            : (historyMode
                                ? this.pageLabel("editingHistoryTableMapHelp", "수정 이력을 조회할 INITUP$/INITDN$ 테이블 한 행을 선택합니다.")
                                : this.pageLabel("editingTableMapHelp", "규칙 마스터의 최종 규칙이 등록된 INITUP$를 한 행만 선택합니다.")))}</span>
                    </div>
                    <div class="edit-work-table-map-scroll">
                        <table class="table-grid edit-work-table-map-grid">
                            <colgroup>
                                <col style="width:42px">
                                <col style="width:140px">
                                <col style="width:360px">
                                <col style="width:360px">
                                <col style="width:90px">
                                <col style="width:110px">
                                <col style="width:210px">
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>${this.escapeHtml(this.pageLabel("editingTableColumnSelect", "선택"))}</th>
                                    <th>OWNER</th>
                                    <th>${this.escapeHtml(this.pageLabel("editingTableColumnSource", "INITUP$ 원본 테이블"))}</th>
                                    <th>${this.escapeHtml(this.pageLabel("editingTableColumnEdit", "INITDN$ 수정 테이블"))}</th>
                                    <th>${this.escapeHtml(this.pageLabel("editingTableColumnRules", "최종 규칙"))}</th>
                                    <th>${this.escapeHtml(this.pageLabel("editingTableColumnStatus", "상태"))}</th>
                                    <th>${this.escapeHtml(correctionMode
                                        ? this.pageLabel("editingTableColumnAction", "현재 작업")
                                        : (executionHistoryMode
                                            ? this.pageLabel("editingTableColumnSession", "반영 이력 ID")
                                            : this.pageLabel("editingTableColumnCurrentWork", "현재 작업")))}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.violationSourceTables.length ? this.violationSourceTables.map((row) => {
                                    const value = `${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`.toUpperCase();
                                    const selected = value === selectedValue;
                                    const tableStatus = this.editingTableRowStatus(row);
                                    const displayExecution = this.preferredExecutionForSource(row);
                                    const latestAppliedExecution = correctionMode
                                        ? this.latestAppliedExecutionForSource(row)
                                        : null;
                                    const displayExecutionStatus = String(displayExecution?.SESSION_STATUS || "").toUpperCase();
                                    const status = correctionMode && !displayExecution && latestAppliedExecution
                                        ? {
                                            className: "is-ready",
                                            label: this.pageLabel("editingTableStatusApplied", "운영 반영 완료")
                                        }
                                        : !correctionMode && displayExecutionStatus
                                        ? {
                                            className: ["VALIDATED", "APPLY_READY", "APPLIED"].includes(displayExecutionStatus)
                                                ? "is-ready"
                                                : ["FAILED", "CANCELLED"].includes(displayExecutionStatus)
                                                    ? "is-invalid"
                                                    : "is-pending",
                                            label: this.executionStatusLabel(displayExecutionStatus)
                                        }
                                        : tableStatus;
                                    const actionDisabled = Boolean(row.EDIT_TABLE_EXISTS && !row.STRUCTURE_MATCHES);
                                    const displayedSessionId = correctionMode
                                        ? row.EDIT_SESSION_ID
                                        : displayExecution?.EDIT_SESSION_ID;
                                    const masterRuleCount = Number(row.FINAL_RULE_COUNT || 0);
                                    const hasActiveExecution = correctionMode && Boolean(displayedSessionId);
                                    return `
                                        <tr class="${selected ? "is-selected-row" : ""}"
                                            onclick="${PAGE_CODE}.selectEditingTableRow('${this.escapeHtml(value)}')">
                                            <td class="is-select-column">
                                                <input type="radio"
                                                       name="editingTable-${PAGE_CODE}"
                                                       aria-label="${this.escapeHtml(this.pageLabel("editingTableColumnSelect", "선택"))}"
                                                       ${selected ? "checked" : ""}
                                                       onclick="event.stopPropagation()"
                                                       onchange="${PAGE_CODE}.selectEditingTableRow('${this.escapeHtml(value)}')">
                                            </td>
                                            <td class="is-code">${this.escapeHtml(row.OWNER_NAME || "-")}</td>
                                            <td class="is-code">
                                                <b>${this.escapeHtml(row.TABLE_NAME || "-")}</b>
                                                ${row.TABLE_COMMENT ? `<small>${this.escapeHtml(row.TABLE_COMMENT)}</small>` : ""}
                                            </td>
                                            <td class="is-code">${this.escapeHtml(row.EDIT_TABLE || "-")}</td>
                                            <td class="is-number">
                                                ${masterRuleCount.toLocaleString()}
                                            </td>
                                            <td>
                                                <span class="edit-work-table-status ${status.className}">${this.escapeHtml(status.label)}</span>
                                            </td>
                                            <td>
                                                ${!correctionMode ? `
                                                    <span class="edit-work-table-session">${executionHistoryMode
                                                        ? (displayedSessionId
                                                            ? `#${this.escapeHtml(displayedSessionId)}`
                                                            : this.escapeHtml(this.pageLabel("noEditingHistory", "이력 없음")))
                                                        : this.escapeHtml(displayExecution
                                                            ? this.executionStatusLabel(displayExecutionStatus)
                                                            : this.pageLabel("noCurrentEditingWork", "현재 작업 없음"))}</span>
                                                ` : hasActiveExecution ? `
                                                    <button type="button"
                                                            class="table-btn"
                                                            title="${this.escapeHtml(this.pageLabel("buttonResetCurrentEditingHelp", "현재 수정값과 미실행 DML을 초기화하고 INITUP$ 기준으로 다시 시작합니다."))}"
                                                            onclick="event.stopPropagation(); ${PAGE_CODE}.resetCurrentEditingWork('${this.escapeHtml(displayedSessionId || "")}', '${this.escapeHtml(value)}')">
                                                        ${this.escapeHtml(this.pageLabel("buttonResetCurrentEditing", "현재 수정 초기화"))}
                                                    </button>
                                                ` : `
                                                    <button type="button"
                                                            class="table-btn is-primary"
                                                            ${actionDisabled ? "disabled" : ""}
                                                            title="${this.escapeHtml(actionDisabled
                                                                ? this.pageLabel("editingTableStructureMismatch", "INITUP$와 INITDN$ 컬럼 구조가 일치하지 않아 수정테이블을 사용할 수 없습니다.")
                                                                : (latestAppliedExecution
                                                                    ? this.pageLabel("buttonStartNextCorrectionHelp", "현재 운영 반영된 INITUP$ 데이터와 활성 규칙으로 새 오류 수정 작업을 시작합니다.")
                                                                    : this.pageLabel("buttonCreateEditingTableHelp", "선택한 INITUP$와 1:1인 INITDN$ 수정테이블을 생성하고 자동 선택합니다.")))}"
                                                            onclick="event.stopPropagation(); ${PAGE_CODE}.createEditingTableForSelectedSource('${this.escapeHtml(value)}')">
                                                        ${this.escapeHtml(latestAppliedExecution
                                                            ? this.pageLabel("buttonStartNextCorrection", "새 오류 수정 시작")
                                                            : (row.EDIT_TABLE_EXISTS
                                                                ? this.pageLabel("buttonConnectEditingTable", "오류 수정 시작")
                                                                : this.pageLabel("buttonCreateEditingTable", "수정테이블 준비·오류 수정 시작")))}
                                                    </button>
                                                `}
                                            </td>
                                        </tr>
                                    `;
                                }).join("") : `
                                    <tr>
                                        <td colspan="7" class="edit-work-table-map-empty">
                                            ${this.escapeHtml(this.pageLabel("noEditingRuleTables", "규칙 마스터에 등록된 최종 규칙의 INITUP$ 테이블이 없습니다."))}
                                        </td>
                                    </tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                `;
            },

            async loadEditingTableStatus(source = this.getSelectedViolationSource(), force = false) {
                if (!source) return null;
                if (
                    !force
                    && this.editingTableStatus
                    && String(this.editingTableStatus.targetOwner || "") === String(source.OWNER_NAME || "")
                    && String(this.editingTableStatus.sourceTable || "") === String(source.TABLE_NAME || "")
                ) {
                    return this.editingTableStatus;
                }
                this.editingTableStatus = null;
                const params = this.contextParams();
                params.set("targetOwner", source.OWNER_NAME);
                params.set("targetTable", source.TABLE_NAME);
                const json = await CommonUtils.request(
                    apiUrl(`/editing-table-status?${params}`),
                    { method: "GET", showLoading: false }
                );
                this.editingTableStatus = json.data || null;
                const selected = this.getSelectedSession();
                if (!this.sessionMatchesSource(selected, source)) {
                    const activeSessionId = String(this.editingTableStatus?.editSessionId || "");
                    const activeSession = this.sessions.find(
                        (row) => String(row.EDIT_SESSION_ID) === activeSessionId
                    ) || this.preferredExecutionForSource(source);
                    this.selectExecution(activeSession);
                }
                this.renderSourceContext();
                return this.editingTableStatus;
            },

            isViolationEditingEnabled() {
                const session = this.getSelectedSession();
                const status = String(session?.SESSION_STATUS || "").toUpperCase();
                return Boolean(
                    this.editingTableStatus?.exists
                    && this.editingTableStatus?.structureMatches
                    && this.editingTableStatus?.editable
                    && session
                    && ["EDITING", "VALIDATED"].includes(status)
                    && String(session.EDIT_SESSION_ID) === String(this.editingTableStatus.editSessionId)
                );
            },

            async loadViolations() {
                await this.loadViolationSourceTables();
                let source = this.getSelectedViolationSource();
                const preselectedSession = this.getSelectedSession();
                if (!source && preselectedSession) {
                    const sourceValue = `${preselectedSession.TARGET_OWNER || ""}.${preselectedSession.SOURCE_TABLE || ""}`.toUpperCase();
                    const sourceExists = this.violationSourceTables.some(
                        (row) => `${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`.toUpperCase() === sourceValue
                    );
                    if (sourceExists) {
                        this.stageFilters.VIOLATION_TARGET_TABLE = sourceValue;
                        source = this.getSelectedViolationSource();
                    }
                }
                if (!source) {
                    this.editingTableStatus = null;
                    this.serverPaging = false;
                    this.serverTotalRows = 0;
                    this.rows = [];
                    this.violationRules = [];
                    this.selectedViolationRules = [];
                    this.gridColumns = [];
                    this.setPanel(this.pageLabel("violationEditPanel", "최종 규칙 실시간 위반 조회 및 수정"), "");
                    this.setKpis([
                        {
                            value: "-",
                            label: this.pageLabel("filterSourceTable", "원본 테이블"),
                            hint: this.pageLabel("sourceTableRequired", "조회할 INITUP$ 원본 테이블을 반드시 선택하세요.")
                        }
                    ]);
                    this.hideModeForm();
                    this.renderEmpty(this.pageLabel("sourceTableRequired", "조회할 INITUP$ 원본 테이블을 반드시 선택하세요."));
                    return;
                }
                await this.loadEditingTableStatus(source);
                const params = this.contextParams();
                params.set("targetOwner", source.OWNER_NAME);
                params.set("targetTable", source.TABLE_NAME);
                const session = this.getSelectedSession();
                if (session) params.set("editSessionId", session.EDIT_SESSION_ID);
                params.set(
                    "changeStatus",
                    String(this.stageFilters.VIOLATION_CHANGE_STATUS || "ALL").toUpperCase()
                );
                const scopedRules = this.getViolationRuleOptions();
                const availableRuleIds = new Set(
                    scopedRules.map((rule) => String(rule.EDIT_RULE_ID))
                );
                const explicitlySelectedIds = [...this.violationRuleScopeIds]
                    .filter((value) => availableRuleIds.has(String(value)));
                const hasRuleOptionFilter = [
                    this.stageFilters.VIOLATION_RULE_TYPE,
                    this.stageFilters.VIOLATION_TARGET_COLUMN
                ].some((value) => value && String(value).toUpperCase() !== "ALL");
                const scopedRuleIds = explicitlySelectedIds.length
                    ? explicitlySelectedIds
                    : (hasRuleOptionFilter
                        ? scopedRules
                            .map((rule) => String(rule.EDIT_RULE_ID))
                            .filter(Boolean)
                        : []);
                if (scopedRuleIds.length) params.set("editRuleIds", scopedRuleIds.join(","));
                else if (hasRuleOptionFilter && this.violationRules.length) params.set("editRuleIds", "0");
                if (this.keyword) params.set("keyword", this.keyword);
                params.set("page", String(this.page));
                params.set("pageSize", String(this.pageSize));
                this.setWorkActionLoading(
                    true,
                    this.pageLabel("liveViolationLoading", "실시간 위반 데이터를 조회하고 있습니다."),
                    false
                );
                let json;
                try {
                    json = await CommonUtils.request(
                        apiUrl(`/violations?${params}`),
                        { method: "GET", showLoading: false }
                    );
                } finally {
                    this.setWorkActionLoading(false);
                }
                this.serverPaging = true;
                this.serverTotalRows = Number(json.total || 0);
                this.page = Math.max(1, Number(json.page || this.page));
                this.pageSize = Math.max(1, Number(json.pageSize || this.pageSize));
                this.violationRules = Array.isArray(json.rules) ? json.rules : [];
                this.selectedViolationRule = json.selectedRule || null;
                this.selectedViolationRules = Array.isArray(json.selectedRules)
                    ? json.selectedRules
                    : (this.selectedViolationRule ? [this.selectedViolationRule] : []);
                this.selectedViolationRuleId = this.selectedViolationRules.length === 1
                    ? String(this.selectedViolationRules[0].EDIT_RULE_ID)
                    : "ALL";
                this.generatedViolationSql = String(json.generatedSql || "");
                this.selectedRuleIds.clear();
                this.selectedViolationRules.forEach((rule) => {
                    if (rule?.EDIT_RULE_ID) this.selectedRuleIds.add(String(rule.EDIT_RULE_ID));
                });
                const violationRuleMap = new Map(
                    this.violationRules.map((rule) => [Number(rule.EDIT_RULE_ID), rule])
                );
                this.rows = (Array.isArray(json.data) ? json.data : []).map((row) => {
                    const rule = violationRuleMap.get(Number(row.EDIT_RULE_ID)) || {};
                    return {
                        ...row,
                        RULE_DESCRIPTION: rule.RULE_DESCRIPTION || "",
                        SOURCE_RUN_ID: rule.SOURCE_RUN_ID,
                        FEATURE_COLUMNS: rule.FEATURE_COLUMNS,
                        METHOD: rule.METHOD,
                        RULE_SUPPORT: rule.RULE_SUPPORT,
                        RULE_CONFIDENCE: rule.RULE_CONFIDENCE,
                        RULE_LIFT: rule.RULE_LIFT,
                        RULE_TOLERANCE_PCT: rule.RULE_TOLERANCE_PCT,
                        TARGET_COLUMN_COMMENT: row.TARGET_COLUMN_COMMENT
                            || row.COLUMN_COMMENTS?.[row.TARGET_COLUMN]
                            || ""
                    };
                });
                this.selectedViolationRowKeys.clear();
                const selectedRuleTypes = new Set(
                    this.selectedViolationRules.map(
                        (rule) => String(rule.SOURCE_RULE_TYPE || "").toUpperCase()
                    )
                );
                const hasSymbolicRule = selectedRuleTypes.has("SYMBOLIC");
                const editingEnabled = this.isViolationEditingEnabled();
                const changedRowCount = Number(session?.CHANGED_ROW_COUNT || 0);
                const changedCellCount = Number(session?.CHANGED_CELL_COUNT || 0);
                const dmlCount = Number(session?.DML_COUNT || 0);
                this.setKpis([
                    { value: this.serverTotalRows, label: "실시간 위반 행", hint: "INITUP$ 실제 테이블 DB 페이징" },
                    { value: this.violationRules.length, label: "현재 적용 규칙", hint: "규칙 마스터의 활성 규칙을 자동 반영" },
                    { value: changedRowCount, label: "수정한 행", hint: `${changedCellCount.toLocaleString()}개 셀 변경` },
                    { value: dmlCount, label: "저장 DML", hint: dmlCount ? "운영 반영 전 저장된 DML" : "저장된 DML 없음" },
                    {
                        value: editingEnabled ? "수정 가능" : "조회 전용",
                        label: "작업 모드",
                        hint: editingEnabled
                            ? `${session.TARGET_OWNER}.${session.EDIT_TABLE}`
                            : `${source.OWNER_NAME}.${this.editingTableStatus?.editTable || "-"}`
                    }
                ]);
                this.setPanel(this.pageLabel("violationEditPanel", "최종 규칙 실시간 위반 조회 및 수정"), `
                    <button type="button" title="${this.escapeHtml(this.pageLabel("liveSqlHelp", "조회에 사용되는 서버 생성 SQL을 확인합니다. 이 버튼은 SQL을 다시 실행하지 않습니다."))}" onclick="${PAGE_CODE}.openGeneratedViolationSql()" ${this.generatedViolationSql ? "" : "disabled"}><i class="fas fa-code"></i>실시간 SQL</button>
                    ${editingEnabled ? `<button type="button" class="is-primary" onclick="${PAGE_CODE}.saveSelectedViolationChanges()"><i class="fas fa-floppy-disk"></i>${this.escapeHtml(this.pageLabel("buttonSaveSelectedChanges", "선택 수정 저장"))}</button>` : ""}
                `);
                this.hideModeForm();
                const expectedValueLabel = selectedRuleTypes.size === 1
                    ? (hasSymbolicRule ? "예측값" : "THEN 결과")
                    : "결과 / 예측값";
                const previouslyEditableGrid = this.gridColumns.some((column) => column.key === "_SELECT");
                if (editingEnabled !== previouslyEditableGrid) {
                    this.freezeColumns = editingEnabled ? 1 : 0;
                    this.freezeColumnsInitialized = true;
                }
                this.gridColumns = [
                    ...(editingEnabled ? [{
                        key: "_SELECT",
                        label: "",
                        headerHtml: `<input type="checkbox" title="${this.escapeHtml(this.pageLabel("selectVisibleViolations", "현재 페이지 위반 행 전체 선택"))}" onchange="${PAGE_CODE}.toggleVisibleViolationRows(this.checked)">`,
                        width: 34,
                        className: "is-select-column",
                        headerClassName: "is-select-column",
                        render: (_value, row, index) => `<input type="checkbox" ${this.selectedViolationRowKeys.has(this.violationRowKey(row)) ? "checked" : ""} onchange="${PAGE_CODE}.toggleViolationRow(${index}, this.checked)">`
                    }] : []),
                    { key: "EDIT_RULE_ID", label: "규칙 ID", width: 66, className: "is-number", render: (value) => `#${this.escapeHtml(value || "-")}` },
                    { key: "SOURCE_RULE_TYPE", label: "규칙 유형", width: 82, render: (value) => this.renderRuleTypeBadge(value) },
                    { key: "USER_RULE_YN", label: "출처", width: 62, render: (value) => this.badge(String(value || "N").toUpperCase() === "Y" ? "사용자" : "발굴") },
                    { key: "RULE_NAME", label: "최종 규칙명", width: 180, render: (value, row, index) => this.renderViolationRulePreview(value, row, index) },
                    { key: "RULE_DESCRIPTION", label: "규칙 설명", width: 180, className: "is-rule-detail", render: (value, row, index) => this.renderViolationRulePreview(value || "-", row, index) },
                    { key: "TARGET_OWNER", label: "Owner", width: 110, className: "is-code" },
                    { key: "TARGET_TABLE", label: "원본 테이블", width: 160, className: "is-code", render: (value, _row, index) => this.renderTextPreview(value, index, "TARGET_TABLE", "원본 테이블") },
                    { key: "CASE_ID", label: "행 식별값", width: 130, className: "is-code" },
                    { key: "TARGET_COLUMN", label: "오류 컬럼", width: 135, className: "is-code", render: (value, row) => this.renderColumnSummary(value, row.TARGET_COLUMN_COMMENT) },
                    { key: "CONDITION_TEXT", label: "최종 규칙 (IF / f(X))", width: 300, className: "is-rule-detail", render: (value, row, index) => this.renderViolationRulePreview(value, row, index) },
                    { key: "EXPECTED_VALUE", label: expectedValueLabel, width: 120 },
                    { key: "ACTUAL_VALUE", label: "실제값", width: 120 },
                    ...(hasSymbolicRule ? [
                        { key: "ABS_ERROR", label: "절대 오차", width: 105, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "ERROR_PCT", label: "오차율", width: 92, className: "is-number", render: (value) => this.formatPercent(value) }
                    ] : []),
                    { key: "VIOLATION_SCORE", label: "위반 점수", width: 88, className: "is-number", render: (value) => this.formatMetric(value) },
                    { key: "VIOLATION_REASON", label: "위반 사유", width: 280, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "VIOLATION_REASON", "위반 사유") },
                    { key: "CURRENT_VALUE", label: "현재 편집값", width: 120 },
                    { key: "CHANGE_STATUS", label: "수정 상태", width: 90, render: (value) => this.badge(value || "UNEDITED") },
                    ...(editingEnabled ? [{
                        key: "_EDITOR",
                        label: "INITDN$ 수정값",
                        width: 240,
                        className: "is-action-column",
                        headerClassName: "is-action-column",
                        render: (_value, row, index) => this.renderInlineEditor(row, index, session)
                    }] : [])
                ];
                this.renderGrid();
            },

            getViolationRuleOptions() {
                const targetTable = String(this.stageFilters.VIOLATION_TARGET_TABLE || "ALL").toUpperCase();
                const ruleType = String(this.stageFilters.VIOLATION_RULE_TYPE || "ALL").toUpperCase();
                const targetColumn = String(this.stageFilters.VIOLATION_TARGET_COLUMN || "ALL").toUpperCase();
                return this.violationRules.filter((rule) => {
                    const qualifiedTable = `${rule.TARGET_OWNER || ""}.${rule.TARGET_TABLE || ""}`.toUpperCase();
                    if (targetTable !== "ALL" && qualifiedTable !== targetTable) return false;
                    if (ruleType !== "ALL" && String(rule.SOURCE_RULE_TYPE || "").toUpperCase() !== ruleType) return false;
                    if (targetColumn !== "ALL" && String(rule.TARGET_COLUMN || "").toUpperCase() !== targetColumn) return false;
                    return true;
                });
            },

            violationRuleOptionLabel(rule) {
                const type = String(rule?.SOURCE_RULE_TYPE || "").toUpperCase() === "SYMBOLIC" ? "수식" : "연관";
                const source = String(rule?.USER_RULE_YN || "N").toUpperCase() === "Y" ? "사용자" : "발굴";
                const target = rule?.TARGET_COLUMN_COMMENT
                    ? `${rule.TARGET_COLUMN} ${rule.TARGET_COLUMN_COMMENT}`
                    : (rule?.TARGET_COLUMN || "-");
                return `[${type}/${source}] ${rule?.RULE_NAME || `#${rule?.EDIT_RULE_ID || "-"}`} · ${target}`;
            },

            async handleViolationSourceTableChange(value, autoQuery = false) {
                this.stageFilters.VIOLATION_TARGET_TABLE = String(value || "");
                this.stageFilters.VIOLATION_RULE_TYPE = "ALL";
                this.stageFilters.VIOLATION_TARGET_COLUMN = "ALL";
                this.editingTableStatus = null;
                this.violationRules = [];
                this.selectedViolationRules = [];
                this.violationRuleScopeIds.clear();
                this.selectedViolationRowKeys.clear();
                this.rows = [];
                this.gridColumns = [];
                this.serverPaging = false;
                this.serverTotalRows = 0;
                this.page = 1;
                const selectedSource = this.getSelectedViolationSource();
                const selectedExecution = this.preferredExecutionForSource(selectedSource);
                this.selectExecution(selectedExecution);
                if (selectedSource && this.stage.mode === "VIOLATIONS") {
                    this.editingTableStatus = {
                        targetOwner: selectedSource.OWNER_NAME,
                        sourceTable: selectedSource.TABLE_NAME,
                        editTable: selectedSource.EDIT_TABLE,
                        exists: Boolean(selectedSource.EDIT_TABLE_EXISTS),
                        structureMatches: Boolean(selectedSource.STRUCTURE_MATCHES),
                        editable: Boolean(selectedSource.EDITABLE),
                        editSessionId: selectedSource.EDIT_SESSION_ID,
                        sessionStatus: selectedSource.SESSION_STATUS
                    };
                }
                this.renderSourceContext();
                this.renderEditingTableGrid();
                this.persistContext();
                this.setPanel(this.pageLabel("violationEditPanel", "최종 규칙 실시간 위반 조회 및 수정"), "");
                this.setKpis([
                    {
                        value: value ? "선택 완료" : "-",
                        label: this.pageLabel("filterSourceTable", "원본 테이블"),
                        hint: value
                            ? this.pageLabel("queryAfterSourceSelection", "조회 버튼을 눌러 위반 데이터와 수정테이블 상태를 확인하세요.")
                            : this.pageLabel("sourceTableRequired", "조회할 INITUP$ 원본 테이블을 반드시 선택하세요.")
                    }
                ]);
                this.renderEmpty(
                    value
                        ? this.pageLabel("queryAfterSourceSelection", "조회 버튼을 눌러 위반 데이터와 수정테이블 상태를 확인하세요.")
                        : this.pageLabel("sourceTableRequired", "조회할 INITUP$ 원본 테이블을 반드시 선택하세요.")
                );
                if (autoQuery && selectedSource) {
                    if (this.stage.mode === "VIOLATIONS") await this.loadViolations();
                    else await this.refresh();
                }
            },

            selectEditingTableRow(value) {
                if (String(this.stageFilters.VIOLATION_TARGET_TABLE || "").toUpperCase() === String(value || "").toUpperCase()) {
                    this.renderEditingTableGrid();
                    const query = this.stage.mode === "VIOLATIONS"
                        ? this.loadViolations()
                        : this.refresh();
                    query.catch((error) => this.renderError(error));
                    return;
                }
                this.handleViolationSourceTableChange(value, true)
                    .catch((error) => this.renderError(error));
            },

            handleViolationScopeFilter(key, value) {
                this.stageFilters[key] = String(value || "ALL");
                const options = this.getViolationRuleOptions();
                const availableIds = new Set(options.map((rule) => String(rule.EDIT_RULE_ID)));
                this.violationRuleScopeIds = new Set(
                    [...this.violationRuleScopeIds].filter((id) => availableIds.has(String(id)))
                );
                this.selectedViolationRuleId = this.violationRuleScopeIds.size === 1
                    ? [...this.violationRuleScopeIds][0]
                    : "ALL";
                this.renderStageFilters();
            },

            selectViolationRule(value) {
                this.violationRuleScopeIds = String(value || "ALL") === "ALL"
                    ? new Set()
                    : new Set([String(value)]);
                this.selectedViolationRuleId = this.violationRuleScopeIds.size === 1
                    ? [...this.violationRuleScopeIds][0]
                    : "ALL";
                this.page = 1;
            },

            toggleViolationRuleScope(value, checked, input = null) {
                const normalized = String(value || "ALL");
                if (normalized === "ALL") {
                    if (checked) this.violationRuleScopeIds.clear();
                } else if (checked) {
                    this.violationRuleScopeIds.add(normalized);
                } else {
                    this.violationRuleScopeIds.delete(normalized);
                }
                this.selectedViolationRuleId = this.violationRuleScopeIds.size === 1
                    ? [...this.violationRuleScopeIds][0]
                    : "ALL";
                this.page = 1;
                const details = input?.closest?.(".edit-work-rule-multi-select");
                if (!details) {
                    this.renderStageFilters();
                    return;
                }
                const allInput = details.querySelector("input[data-rule-scope='ALL']");
                if (allInput) allInput.checked = this.violationRuleScopeIds.size === 0;
                if (normalized === "ALL" && checked) {
                    details.querySelectorAll("input[data-rule-scope]:not([data-rule-scope='ALL'])")
                        .forEach((element) => {
                            element.checked = false;
                        });
                }
                const summary = details.querySelector("summary");
                if (summary) {
                    summary.textContent = this.violationRuleScopeIds.size
                        ? this.pageLabel("selectedFinalRules", "최종 규칙 {count}개 선택")
                            .replaceAll("{count}", this.violationRuleScopeIds.size.toLocaleString())
                        : `${this.pageLabel("allFinalRules", "전체 최종 규칙")} (${this.getViolationRuleOptions().length.toLocaleString()}개)`;
                }
            },

            openGeneratedViolationSql() {
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const title = getContainerEl(`#detailLayerTitle-${PAGE_CODE}`);
                const eyebrow = getContainerEl(`#detailLayerEyebrow-${PAGE_CODE}`);
                const body = getContainerEl(`#detailLayerBody-${PAGE_CODE}`);
                if (!layer || !body || !this.generatedViolationSql) return;
                this.resetDetailDialogPosition();
                if (eyebrow) eyebrow.textContent = "FINAL RULE · LIVE SQL";
                const selectedRules = this.selectedViolationRules || [];
                const singleRule = selectedRules.length === 1 ? selectedRules[0] : null;
                if (title) {
                    title.textContent = singleRule?.RULE_NAME
                        || `${selectedRules.length.toLocaleString()}개 최종 규칙 실시간 위반 조회 SQL`;
                }
                const selectedType = String(singleRule?.SOURCE_RULE_TYPE || "").toUpperCase();
                const ruleResult = selectedType === "SYMBOLIC"
                    ? `예측 대상 ${singleRule?.TARGET_COLUMN || "-"}`
                    : `${singleRule?.TARGET_COLUMN || "-"} = ${singleRule?.EXPECTED_VALUE ?? "-"}`;
                const tableNames = [...new Set(
                    selectedRules.map(
                        (rule) => `${rule.TARGET_OWNER || "-"}.${rule.TARGET_TABLE || "-"}`
                    )
                )];
                body.innerHTML = `
                    <dl class="edit-work-detail-meta">
                        <div><dt>조회 방식</dt><dd>실제 INITUP$ 테이블 실시간 조회</dd></div>
                        <div><dt>최종 규칙</dt><dd>${selectedRules.length.toLocaleString()}개</dd></div>
                        <div><dt>대상 테이블</dt><dd>${this.escapeHtml(tableNames.join(", ") || "-")}</dd></div>
                        <div><dt>통합 방식</dt><dd>규칙별 실시간 SQL UNION ALL · 전체 DB 페이징</dd></div>
                    </dl>
                    ${singleRule ? `<section class="edit-work-detail-rule">
                        <strong>${selectedType === "SYMBOLIC" ? "f(X) 수식" : "IF 조건"}</strong>
                        <pre>${this.renderColumnAwareText(singleRule.RULE_EXPRESSION || "-", singleRule.COLUMN_COMMENTS || {})}</pre>
                    </section>
                    <section class="edit-work-detail-rule">
                        <strong>${selectedType === "SYMBOLIC" ? "예측 대상" : "THEN 결과"}</strong>
                        <pre>${this.renderColumnAwareText(ruleResult, singleRule.COLUMN_COMMENTS || {})}</pre>
                    </section>` : ""}
                    <section class="edit-work-detail-rule is-focus">
                        <strong>서버 자동 생성 읽기 전용 SQL</strong>
                        <pre>${this.escapeHtml(this.generatedViolationSql)}</pre>
                    </section>
                    <p class="edit-work-detail-note">SQL의 바인드 값과 식별자는 서버에서 최종 규칙 및 허용된 실제 테이블 기준으로 검증합니다.</p>
                `;
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog > header button")?.focus();
            },

            violationRowKey(row) {
                return [
                    row?.EDIT_RULE_ID || "",
                    row?.CASE_ROWID || "",
                    row?.TARGET_COLUMN || "",
                    row?.VIOLATION_ID || ""
                ].join("|");
            },

            toggleVisibleViolationRows(checked) {
                this.getVisibleRows().forEach((row) => {
                    const key = this.violationRowKey(row);
                    if (checked) this.selectedViolationRowKeys.add(key);
                    else this.selectedViolationRowKeys.delete(key);
                });
                getContainerEl(`#workContent-${PAGE_CODE}`)
                    ?.querySelectorAll("tbody .is-select-column input[type='checkbox']")
                    .forEach((input) => {
                        input.checked = Boolean(checked);
                    });
            },

            toggleViolationRow(index, checked) {
                const row = this.getVisibleRows()[index];
                if (!row) return;
                const key = this.violationRowKey(row);
                if (checked) this.selectedViolationRowKeys.add(key);
                else this.selectedViolationRowKeys.delete(key);
            },

            currentEditingCreatePayload(source) {
                return {
                    projectId: this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value),
                    scenarioId: this.optionalNumber(getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value),
                    targetOwner: source.OWNER_NAME,
                    targetTable: source.TABLE_NAME,
                    editRuleIds: []
                };
            },

            async selectPreparedEditingWork(prepared, source) {
                const editSessionId = prepared.editSessionId;
                const context = { ...this.readContext(), editSessionId };
                localStorage.setItem(EDIT_CONTEXT_KEY, JSON.stringify(context));
                this.selectedSessionId = String(editSessionId || "");
                this.stageFilters.VIOLATION_TARGET_TABLE = `${source.OWNER_NAME || ""}.${source.TABLE_NAME || ""}`.toUpperCase();
                this.invalidateEditWorkspaceCache("M05002_CLEANSING");
                await this.loadSessions(String(editSessionId));
                this.violationSourceTablesLoaded = false;
                await this.loadViolationSourceTables(true);
                await this.loadEditingTableStatus(this.getSelectedViolationSource(), true);
                this.persistContext();
            },

            async createEditingTableForSelectedSource(selectedValue = "") {
                if (this.editingWorkStarting) return;
                if (
                    selectedValue
                    && String(this.stageFilters.VIOLATION_TARGET_TABLE || "").toUpperCase() !== String(selectedValue).toUpperCase()
                ) {
                    await this.handleViolationSourceTableChange(selectedValue, false);
                }
                const source = this.getSelectedViolationSource();
                if (!source) {
                    CommonMessage.warn(
                        this.pageLabel("sourceTableRequired", "조회할 INITUP$ 원본 테이블을 반드시 선택하세요.")
                    );
                    return;
                }
                if (source?.EDIT_TABLE_EXISTS && !source?.STRUCTURE_MATCHES) {
                    CommonMessage.error(
                        this.pageLabel(
                            "editingTableStructureMismatch",
                            "INITUP$와 INITDN$ 컬럼 구조가 일치하지 않아 수정테이블을 사용할 수 없습니다."
                        )
                    );
                    return;
                }
                const editTable = source.EDIT_TABLE
                    || String(source.TABLE_NAME || "").replace(/^INITUP\$/, "INITDN$");
                const restartingAfterApply = Boolean(this.latestAppliedExecutionForSource(source));
                const confirmed = await CommonMessage.confirm(
                    this.pageLabel(
                        restartingAfterApply ? "nextCorrectionConfirm" : "editingTableCreateConfirm",
                        restartingAfterApply
                            ? "이전 운영 반영이 완료된 테이블입니다.\n현재 {source} 데이터로 {edit}을 다시 준비하고 새 오류 수정을 시작할까요?\n이전 작업의 수정 이력과 실행 DML은 전체 이력에 그대로 보존됩니다."
                            : "{source}의 현재 활성 규칙으로 오류 수정을 시작할까요?\n{edit} 수정테이블을 준비하며 INITUP$ 원본 데이터는 변경하지 않습니다."
                    )
                        .replaceAll("{source}", `${source.OWNER_NAME}.${source.TABLE_NAME}`)
                        .replaceAll("{edit}", `${source.OWNER_NAME}.${editTable}`)
                );
                if (!confirmed) return;
                this.editingWorkStarting = true;
                this.setWorkActionLoading(
                    true,
                    this.pageLabel("editingTableCreating", "INITDN$ 수정테이블을 생성하고 있습니다.")
                );
                try {
                    const prepared = await CommonUtils.request(
                        apiUrl("/editing-tables"),
                        {
                            method: "POST",
                            body: this.currentEditingCreatePayload(source),
                            showLoading: false
                        }
                    );
                    await this.selectPreparedEditingWork(prepared, source);
                    const tableAction = prepared.editTableCreated
                        ? "새로 생성"
                        : (restartingAfterApply ? "현재 INITUP$ 기준 재준비" : "기존 테이블 확인");
                    CommonMessage.success(
                        this.pageLabel(
                            "editingTableCreated",
                            "수정테이블 준비를 완료했습니다. {edit} · {action} · {count}행"
                        )
                            .replaceAll("{edit}", `${source.OWNER_NAME}.${prepared.editTable}`)
                            .replaceAll("{action}", tableAction)
                            .replaceAll("{count}", Number(prepared.sourceRowCount || 0).toLocaleString())
                    );
                    await this.loadViolations();
                } finally {
                    this.editingWorkStarting = false;
                    this.setWorkActionLoading(false);
                }
            },

            async resetCurrentEditingWork(editExecutionId = "", selectedValue = "") {
                if (this.editingWorkStarting) return;
                const session = this.sessions.find(
                    (row) => String(row.EDIT_SESSION_ID) === String(editExecutionId || "")
                );
                const normalizedValue = String(selectedValue || "").toUpperCase();
                const source = this.violationSourceTables.find(
                    (row) => `${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`.toUpperCase() === normalizedValue
                ) || this.getSelectedViolationSource();
                if (!session || !source) {
                    CommonMessage.warn(this.pageLabel("selectCurrentEditingWorkToReset", "초기화할 현재 작업 테이블을 선택하세요."));
                    return;
                }
                const changedRowCount = Number(source.CHANGED_ROW_COUNT || 0);
                const dmlCount = Number(source.DML_COUNT || 0);
                const currentRuleCount = Number(source.FINAL_RULE_COUNT || 0);
                const confirmed = await CommonMessage.confirm(
                    this.pageLabel(
                        "resetCurrentEditingConfirm",
                        "현재 수정 작업을 초기화할까요?\n수정 행 {changes}건과 미실행 DML {dml}건은 현재 작업에서 제외되고, 현재 규칙 {rules}개와 INITUP$ 데이터로 다시 시작합니다."
                    )
                        .replaceAll("{changes}", changedRowCount.toLocaleString())
                        .replaceAll("{dml}", dmlCount.toLocaleString())
                        .replaceAll("{rules}", currentRuleCount.toLocaleString())
                );
                if (!confirmed) return;

                let previousExecutionCancelled = false;
                this.editingWorkStarting = true;
                this.setWorkActionLoading(
                    true,
                    this.pageLabel("resettingCurrentEditingWork", "현재 수정 작업을 초기화하고 있습니다.")
                );
                try {
                    await CommonUtils.request(
                        apiUrl(`/sessions/${session.EDIT_SESSION_ID}/cancel`),
                        { method: "POST", showLoading: false }
                    );
                    previousExecutionCancelled = true;
                    this.selectedSessionId = "";
                    this.violationRuleScopeIds.clear();
                    const prepared = await CommonUtils.request(
                        apiUrl("/editing-tables"),
                        {
                            method: "POST",
                            body: this.currentEditingCreatePayload(source),
                            showLoading: false
                        }
                    );
                    await this.selectPreparedEditingWork(prepared, source);
                    CommonMessage.success(
                        this.pageLabel(
                            "currentEditingWorkReset",
                            "현재 수정을 초기화하고 활성 규칙 {count}개로 다시 시작했습니다."
                        )
                            .replaceAll("{count}", currentRuleCount.toLocaleString())
                    );
                    await this.loadViolations();
                } catch (error) {
                    if (previousExecutionCancelled) {
                        const context = { ...this.readContext(), editSessionId: "" };
                        localStorage.setItem(EDIT_CONTEXT_KEY, JSON.stringify(context));
                        this.selectedSessionId = "";
                        this.editingTableStatus = null;
                        this.violationSourceTablesLoaded = false;
                        this.invalidateEditWorkspaceCache();
                        await this.loadSessions("");
                        await this.loadViolationSourceTables(true);
                        this.persistContext();
                        this.renderEditingTableGrid();
                        CommonMessage.error(
                            `${this.pageLabel(
                                "currentEditingResetPartialFailure",
                                "기존 수정 작업은 초기화했지만 새 작업 준비에 실패했습니다. 오류 수정 시작을 다시 눌러 주세요."
                            )}\n${String(error?.message || "")}`,
                            { copyable: true }
                        );
                        return;
                    }
                    throw error;
                } finally {
                    this.editingWorkStarting = false;
                    this.setWorkActionLoading(false);
                }
            },

            renderInlineEditor(row, index, session) {
                const sessionStatus = String(session?.SESSION_STATUS || "").toUpperCase();
                const disabled = !row.CASE_ROWID
                    || (session && !["DRAFT", "EDITING", "VALIDATED"].includes(sessionStatus));
                const hasSavedChange = Boolean(row.EDIT_CHANGE_ID)
                    || !["", "UNEDITED"].includes(String(row.CHANGE_STATUS || "").toUpperCase());
                const suggestedValue = hasSavedChange
                    ? row.CURRENT_VALUE
                    : (row.EXPECTED_VALUE ?? row.CURRENT_VALUE ?? row.ACTUAL_VALUE ?? "");
                return `
                    <span class="edit-work-inline-editor">
                        <input id="editValue-${PAGE_CODE}-${index}" value="${this.escapeHtml(suggestedValue ?? "")}" ${disabled ? "disabled" : ""} title="${row.CASE_ROWID ? "INITDN$에 저장할 수정값" : "원본 ROWID가 없어 수정할 수 없습니다."}">
                        <button type="button" class="is-primary" onclick="${PAGE_CODE}.saveViolationChange(${index})" ${disabled ? "disabled" : ""}>수정 저장</button>
                    </span>
                `;
            },

            async retryPrepareCurrentSession() {
                const session = this.getSelectedSession();
                if (!session) {
                    CommonMessage.warn("현재 오류 수정 작업을 선택하세요.");
                    return;
                }
                if (!(await CommonMessage.confirm("현재 작업의 INITDN$ 준비를 다시 시도할까요?\n기존 INITUP$ 원본은 변경하지 않습니다."))) return;
                this.setWorkActionLoading(true, this.pageLabel("editingWorkStarting", "현재 오류 수정 작업과 INITDN$ 수정테이블을 준비하고 있습니다."));
                try {
                    const json = await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/prepare`), { method: "POST", showLoading: false });
                    const tableAction = json.editTableCreated ? "새로 생성" : "기존 테이블 확인";
                    CommonMessage.success(`현재 오류 수정 작업 준비를 완료했습니다. ${json.editTable} · ${tableAction} · ${Number(json.sourceRowCount || 0).toLocaleString()}행`);
                    this.invalidateEditWorkspaceCache("M05002");
                    await this.loadSessions(session.EDIT_SESSION_ID);
                    await this.refresh();
                } finally {
                    this.setWorkActionLoading(false);
                }
            },

            async saveViolationChange(index) {
                const row = this.getVisibleRows()[index];
                if (!row) return;
                await this.saveViolationEntries([{ row, index }], false);
            },

            async saveSelectedViolationChanges() {
                const entries = this.getVisibleRows()
                    .map((row, index) => ({ row, index }))
                    .filter(({ row }) => this.selectedViolationRowKeys.has(this.violationRowKey(row)));
                if (!entries.length) {
                    CommonMessage.warn(this.pageLabel("selectViolationsToSave", "수정 저장할 위반 행을 체크하세요."));
                    return;
                }
                if (this.getSelectedSession()) {
                    const confirmed = await CommonMessage.confirm(
                        this.pageLabel("bulkChangeConfirm", "선택한 위반 행 {count}건의 수정값을 INITDN$에 저장할까요?")
                            .replaceAll("{count}", entries.length.toLocaleString())
                    );
                    if (!confirmed) return;
                }
                await this.saveViolationEntries(entries, true);
            },

            buildViolationChangePayload(row, index) {
                return {
                    editRuleId: this.optionalNumber(row.EDIT_RULE_ID),
                    sourceViolationType: row.SOURCE_VIOLATION_TYPE,
                    sourceViolationId: Number(row.VIOLATION_ID),
                    sourceRowid: row.CASE_ROWID,
                    caseId: row.CASE_ID || null,
                    columnName: row.TARGET_COLUMN,
                    newValue: getContainerEl(`#editValue-${PAGE_CODE}-${index}`)?.value ?? "",
                    expectedValue: row.EXPECTED_VALUE ?? null
                };
            },

            async saveViolationEntries(entries, bulk) {
                const uniqueChanges = new Map();
                for (const entry of entries) {
                    const payload = this.buildViolationChangePayload(entry.row, entry.index);
                    const cellKey = `${payload.sourceRowid || ""}|${payload.columnName || ""}`;
                    const existing = uniqueChanges.get(cellKey);
                    if (existing && String(existing.newValue ?? "") !== String(payload.newValue ?? "")) {
                        CommonMessage.warn(
                            `동일한 행·컬럼(${payload.caseId || payload.sourceRowid} / ${payload.columnName})에 서로 다른 수정값이 입력되었습니다.`
                        );
                        return;
                    }
                    if (!existing) uniqueChanges.set(cellKey, payload);
                }
                const changes = [...uniqueChanges.values()];
                const session = this.getSelectedSession();
                if (!session || !this.isViolationEditingEnabled()) {
                    CommonMessage.warn(
                        this.pageLabel(
                            "editingTableRequiredForSave",
                            "수정값을 저장하려면 먼저 INITDN$ 수정테이블을 생성하세요."
                        )
                    );
                    return;
                }
                this.setWorkActionLoading(
                    true,
                    this.pageLabel("savingViolationChanges", "선택한 오류 수정값을 INITDN$에 저장하고 있습니다.")
                );
                try {
                    const result = await CommonUtils.request(
                        apiUrl(`/sessions/${session.EDIT_SESSION_ID}/changes/bulk`),
                        {
                            method: "POST",
                            body: { changes },
                            showLoading: false
                        }
                    );
                    this.selectedViolationRowKeys.clear();
                    this.invalidateEditWorkspaceCache();
                    await this.loadSessions(String(session.EDIT_SESSION_ID));
                    this.persistContext();
                    await this.refresh();
                    const savedCount = Number(result.savedCount || changes.length);
                    CommonMessage.success(
                        bulk
                            ? this.pageLabel("bulkChangeSaved", "선택한 오류 수정값 {count}건을 저장했습니다.")
                                .replaceAll("{count}", savedCount.toLocaleString())
                            : this.pageLabel("singleChangeSaved", "INITDN$ 편집본에 수정값을 저장했습니다.")
                    );
                } finally {
                    this.setWorkActionLoading(false);
                }
            },

            parseChangeEventDetail(row, changeMap = new Map()) {
                let detail = row?.EVENT_DETAIL_JSON;
                if (detail && typeof detail === "string") {
                    try {
                        detail = JSON.parse(detail);
                    } catch (_error) {
                        detail = {};
                    }
                }
                detail = detail && typeof detail === "object" ? detail : {};
                const summary = String(row?.EVENT_SUMMARY || "");
                const summaryMatch = summary.match(/^([A-Z][A-Z0-9_$#]*) updated for source ROWID (.+)\.$/i);
                const sourceRowid = detail.sourceRowid ?? summaryMatch?.[2] ?? "";
                const columnName = detail.columnName ?? summaryMatch?.[1] ?? "";
                const currentChange = changeMap.get(`${sourceRowid}|${columnName}`) || {};
                const session = this.getSelectedSession() || {};
                return {
                    ...row,
                    EDIT_RULE_ID: detail.editRuleId ?? "",
                    TARGET_OWNER: detail.targetOwner ?? session.TARGET_OWNER ?? "",
                    SOURCE_TABLE: detail.sourceTable ?? session.SOURCE_TABLE ?? "",
                    EDIT_TABLE: detail.editTable ?? session.EDIT_TABLE ?? "",
                    CASE_ID: detail.caseId ?? currentChange.CASE_ID ?? "",
                    SOURCE_ROWID: sourceRowid,
                    COLUMN_NAME: columnName,
                    ORIGINAL_VALUE: currentChange.OLD_VALUE ?? detail.oldValue ?? "",
                    OLD_VALUE: detail.oldValue ?? "",
                    NEW_VALUE: detail.newValue ?? "",
                    EXPECTED_VALUE: detail.expectedValue ?? "",
                    SOURCE_VIOLATION_ID: detail.violationId ?? "",
                    EDITED_BY: row?.EVENT_USER || "",
                    EDITED_AT: row?.CREATED_AT || ""
                };
            },

            async loadChangeHistory() {
                await this.loadViolationSourceTables();
                let source = this.getSelectedViolationSource();
                let session = this.getSelectedSession();
                if (!source && session) {
                    const sourceValue = `${session.TARGET_OWNER || ""}.${session.SOURCE_TABLE || ""}`.toUpperCase();
                    if (this.violationSourceTables.some(
                        (row) => `${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`.toUpperCase() === sourceValue
                    )) {
                        this.stageFilters.VIOLATION_TARGET_TABLE = sourceValue;
                        source = this.getSelectedViolationSource();
                    }
                }
                if (source) {
                    session = this.preferredExecutionForSource(source);
                    this.selectExecution(session);
                }
                this.renderEditingTableGrid();
                this.setPanel(this.pageLabel("changeHistoryPanel", "오류 수정 이력"), "");
                this.hideModeForm();
                this.serverPaging = false;
                if (!session) {
                    this.rows = [];
                    this.setKpis([
                        {
                            value: "-",
                            label: this.pageLabel("editingWork", "작업 이력"),
                            hint: this.pageLabel("selectEditingTableForHistory", "수정 이력을 조회할 테이블을 선택하세요.")
                        }
                    ]);
                    this.renderChangeHistoryContent();
                    return;
                }
                const params = this.contextParams();
                params.set("editSessionId", session.EDIT_SESSION_ID);
                params.set("eventType", "CELL_EDITED");
                const [json, changesJson] = await Promise.all([
                    CommonUtils.request(apiUrl(`/history?${params}`), { method: "GET", showLoading: false }),
                    CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/changes`), { method: "GET", showLoading: false })
                ]);
                const changeMap = new Map(
                    (Array.isArray(changesJson.data) ? changesJson.data : []).map(
                        (change) => [`${change.SOURCE_ROWID || ""}|${change.COLUMN_NAME || ""}`, change]
                    )
                );
                this.rows = (Array.isArray(json.data) ? json.data : []).map(
                    (row) => this.parseChangeEventDetail(row, changeMap)
                );
                const changedRows = new Set(this.rows.map((row) => row.SOURCE_ROWID).filter(Boolean)).size;
                const changedColumns = new Set(this.rows.map((row) => row.COLUMN_NAME).filter(Boolean)).size;
                this.setKpis([
                    { value: this.rows.length, label: this.pageLabel("changeHistoryCount", "수정 이력"), hint: json.limited ? "최근 5,000건 표시" : `작업 이력 #${session.EDIT_SESSION_ID}` },
                    { value: changedRows, label: this.pageLabel("changedRows", "수정 행"), hint: this.pageLabel("distinctSourceRows", "중복 제외 원본 행") },
                    { value: changedColumns, label: this.pageLabel("changedColumns", "수정 컬럼"), hint: this.pageLabel("distinctChangedColumns", "중복 제외 컬럼") },
                    { value: session.SESSION_STATUS || "-", label: this.pageLabel("editingWorkStatus", "편집 상태"), hint: session.EDIT_TABLE || "" }
                ]);
                this.renderChangeHistoryContent();
            },

            renderChangeHistoryContent() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const { filtered, visible } = this.getPagedRows(this.rows);
                const historyColumns = [
                    { key: "EDIT_EVENT_ID", label: "이력 ID", width: 72, className: "is-number" },
                    { key: "EDIT_SESSION_ID", label: "작업 이력 ID", width: 96, className: "is-number", render: (value) => value ? `#${this.escapeHtml(value)}` : "-" },
                    { key: "EDIT_RULE_ID", label: "규칙 ID", width: 72, className: "is-number", render: (value) => value ? `#${this.escapeHtml(value)}` : "-" },
                    { key: "SOURCE_TABLE", label: "INITUP$ 원본 테이블", width: 210, className: "is-code", render: (value, row) => this.escapeHtml(`${row.TARGET_OWNER || "-"}.${value || "-"}`) },
                    { key: "EDIT_TABLE", label: "INITDN$ 편집 테이블", width: 210, className: "is-code", render: (value, row) => this.escapeHtml(`${row.TARGET_OWNER || "-"}.${value || "-"}`) },
                    { key: "SOURCE_ROWID", label: "원본 ROWID", width: 145, className: "is-code" },
                    { key: "CASE_ID", label: "업무 행키", width: 130, className: "is-code" },
                    { key: "COLUMN_NAME", label: "수정 컬럼", width: 130, className: "is-code" },
                    { key: "ORIGINAL_VALUE", label: "INITUP$ 원본값", width: 170, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "ORIGINAL_VALUE", "INITUP$ 원본값") },
                    { key: "OLD_VALUE", label: "INITDN$ 수정 전", width: 170, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "OLD_VALUE", "INITDN$ 수정 전 값") },
                    { key: "NEW_VALUE", label: "INITDN$ 수정 후", width: 170, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "NEW_VALUE", "INITDN$ 수정 후 값") },
                    { key: "EXPECTED_VALUE", label: "기대값 / 예측값", width: 150, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "EXPECTED_VALUE", "기대값 / 예측값") },
                    { key: "SOURCE_VIOLATION_ID", label: "위반 ID", width: 82, className: "is-number" },
                    { key: "EVENT_SUMMARY", label: "수정 내용", width: 300, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "EVENT_SUMMARY", "수정 내용") },
                    { key: "EDITED_BY", label: "작업자", width: 110 },
                    { key: "EDITED_AT", label: "수정 일시", width: 155, render: (value) => this.formatDate(value) }
                ];
                content.innerHTML = `
                    ${this.buildGridHtml(visible, historyColumns, true)}
                    ${visible.length ? "" : `<div class="edit-work-empty is-grid-empty">${this.escapeHtml(this.pageLabel("noChangeHistory", "조회할 오류 수정 이력이 없습니다."))}</div>`}
                `;
                this.updateGridMeta(filtered);
                this.currentExport = {
                    filename: "editing-change-history.csv",
                    columns: historyColumns.map((column) => column.key),
                    rows: filtered
                };
                this.renderStageFilters();
                this.renderPanelSourceContext();
            },

            async loadValidation() {
                await this.loadViolationSourceTables();
                const { session } = this.resolveEditingTableSelection();
                const executionOpen = ["DRAFT", "EDITING", "VALIDATED", "APPLY_READY"].includes(
                    String(session?.SESSION_STATUS || "").toUpperCase()
                );
                const reanalysisAvailable = ["DRAFT", "EDITING", "VALIDATED", "APPLY_READY", "APPLIED"].includes(
                    String(session?.SESSION_STATUS || "").toUpperCase()
                );
                this.setPanel("에디팅 효과 검증", `
                    <button type="button" onclick="${PAGE_CODE}.openDescriptiveStatistics(event)" ${session ? "" : "disabled"} title="INITUP$ 원본과 INITDN$ 수정본의 분포를 비교합니다."><i class="fas fa-chart-simple"></i>기초통계량</button>
                    ${session ? `
                        <button type="button" title="${this.escapeHtml(this.pageLabel("buttonRerunRuleDiscoveryHelp", "INITDN$ 수정테이블을 대상으로 저장된 Flow의 규칙 발굴을 다시 실행합니다."))}" onclick="${PAGE_CODE}.openReanalysisFlow()" ${reanalysisAvailable ? "" : "disabled"}><i class="fas fa-wave-square"></i>${this.escapeHtml(this.pageLabel("buttonRerunRuleDiscovery", "규칙발굴재실행"))}</button>
                        <button type="button" class="is-primary" onclick="${PAGE_CODE}.markValidated()" ${executionOpen ? "" : "disabled"}><i class="fas fa-check-double"></i>${this.escapeHtml(this.pageLabel("buttonCompleteEffectValidation", "효과 검증 완료"))}</button>
                    ` : ""}
                `);
                this.hideModeForm();
                if (!session) {
                    this.rows = [];
                    this.setKpis([{ value: "-", label: "작업 테이블", hint: this.pageLabel("selectEditingTableForValidation", "효과를 검증할 INITUP$/INITDN$ 작업 테이블을 선택하세요.") }]);
                    this.renderEmpty(this.pageLabel("selectEditingTableForValidation", "효과를 검증할 INITUP$/INITDN$ 작업 테이블을 선택하세요."));
                    return;
                }
                const validation = await CommonUtils.request(
                    apiUrl(`/sessions/${session.EDIT_SESSION_ID}/validation`),
                    { method: "GET", showLoading: false }
                );
                this.currentValidation = validation.data || {};
                this.rows = Array.isArray(this.currentValidation.CHANGE_ROWS)
                    ? this.currentValidation.CHANGE_ROWS
                    : [];
                const data = this.currentValidation;
                this.setKpis([
                    { value: Number(data.CHANGED_ROW_COUNT || 0).toLocaleString(), label: "변경 행", hint: `${Number(data.TOTAL_CHANGE_COUNT || 0).toLocaleString()}개 셀 변경` },
                    { value: Number(data.APPLIED_CHANGE_COUNT || 0).toLocaleString(), label: "적용 변경", hint: "INITDN$ 저장 완료" },
                    { value: Number(data.EXPECTED_MATCH_COUNT || 0).toLocaleString(), label: "기대/예측값 일치", hint: "규칙 기대값 또는 수식 예측값과 수정값 일치" },
                    { value: data.REANALYSIS_FLOW_RUN_ID ? `#${data.REANALYSIS_FLOW_RUN_ID}` : "-", label: "재분석 Run", hint: data.REANALYSIS_RUN_STATUS || data.REANALYSIS_STATUS || "INITDN$ 재분석 전" },
                    {
                        value: data.VIOLATION_REDUCTION_COUNT === null || data.VIOLATION_REDUCTION_COUNT === undefined
                            ? "-"
                            : Number(data.VIOLATION_REDUCTION_COUNT).toLocaleString(),
                        label: "위반 감소",
                        hint: data.VIOLATION_REDUCTION_RATE === null || data.VIOLATION_REDUCTION_RATE === undefined
                            ? "재분석 결과 대기"
                            : `${(Number(data.VIOLATION_REDUCTION_RATE) * 100).toFixed(1)}% 개선`
                    }
                ]);
                this.renderValidationContent(data);
            },

            async openDescriptiveStatistics(event) {
                const session = this.getSelectedSession();
                if (!session || !window.DescriptiveStatistics?.open) return;
                await window.DescriptiveStatistics.open({
                    opener: event?.currentTarget,
                    title: "에디팅 전·후 기초통계량",
                    subtitle: `작업 이력 #${session.EDIT_SESSION_ID} · INITUP$ 원본과 INITDN$ 수정본의 분포 변화를 비교합니다.`,
                    url: `${API_BASE_URL}/M05003/sessions/${encodeURIComponent(session.EDIT_SESSION_ID)}/descriptive-statistics`
                });
            },

            renderValidationContent(data) {
                const total = Math.max(1, Number(data.TOTAL_CHANGE_COUNT || 0));
                const applied = Number(data.APPLIED_CHANGE_COUNT || 0);
                const matched = Number(data.EXPECTED_MATCH_COUNT || 0);
                const changedRows = Number(data.CHANGED_ROW_COUNT || 0);
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const { filtered, visible } = this.getPagedRows(this.rows);
                const changeColumns = [
                    { key: "EDIT_CHANGE_ID", label: "변경 ID", width: 72, className: "is-number" },
                    { key: "SOURCE_RULE_TYPE", label: "규칙 유형", width: 82, render: (value) => this.renderRuleTypeBadge(value) },
                    { key: "RULE_NAME", label: "규칙명", width: 160 },
                    { key: "CASE_ID", label: "행 식별값", width: 120, className: "is-code" },
                    { key: "COLUMN_NAME", label: "변경 컬럼", width: 135, className: "is-code", render: (value, row) => this.renderColumnSummary(value, row.COLUMN_NAME_COMMENT) },
                    { key: "OLD_VALUE", label: "수정 전", width: 150 },
                    { key: "NEW_VALUE", label: "수정 후", width: 150 },
                    { key: "EXPECTED_VALUE", label: "기대값 / 예측값", width: 150 },
                    { key: "CHANGE_STATUS", label: "상태", width: 86, render: (value) => this.badge(value) },
                    { key: "EDITED_AT", label: "수정 일시", width: 150, render: (value) => this.formatDate(value) }
                ];
                content.innerHTML = `
                    ${this.buildGridHtml(visible, changeColumns, true)}
                    <div class="edit-work-validation">
                        <section class="edit-work-validation-card">
                            <strong>검증 요약</strong>
                            <div class="edit-work-validation-bars">
                                ${this.validationBar("변경 저장", applied, total)}
                                ${this.validationBar("기대/예측값 일치", matched, total)}
                                ${this.validationBar("변경 행", changedRows, Math.max(1, Number(data.SOURCE_ROW_COUNT || 0)))}
                            </div>
                        </section>
                        <section class="edit-work-validation-card">
                            <strong>원본/편집본 실행 컨텍스트</strong>
                            <p><b>원본</b> ${this.escapeHtml(data.TARGET_OWNER)}.${this.escapeHtml(data.SOURCE_TABLE)} · Baseline Run ${data.BASELINE_FLOW_RUN_ID ? `#${data.BASELINE_FLOW_RUN_ID}` : "-"}</p>
                            <p><b>편집본</b> ${this.escapeHtml(data.TARGET_OWNER)}.${this.escapeHtml(data.EDIT_TABLE)} · Reanalysis Run ${data.REANALYSIS_FLOW_RUN_ID ? `#${data.REANALYSIS_FLOW_RUN_ID}` : "-"}</p>
                            <p><b>선정 컬럼 위반</b> ${this.escapeHtml(data.BASELINE_VIOLATION_COUNT ?? "-")} → ${this.escapeHtml(data.REANALYSIS_VIOLATION_COUNT ?? "-")} · Run 상태 ${this.escapeHtml(data.REANALYSIS_RUN_STATUS || data.REANALYSIS_STATUS || "-")}</p>
                            <p>Flow 재분석은 저장된 노드 정의를 변경하지 않고 실행 시점의 P_TARGET_OWNER/P_TARGET_TABLE만 INITDN$로 오버라이드합니다.</p>
                        </section>
                        ${this.renderEditAnalysisSummary(data.EDIT_ANALYSIS || {}, data)}
                    </div>
                `;
                this.updateGridMeta(filtered);
                this.currentExport = {
                    filename: "editing-validation-changes.csv",
                    columns: ["EDIT_CHANGE_ID", "SOURCE_RULE_TYPE", "RULE_NAME", "CASE_ID", "COLUMN_NAME", "OLD_VALUE", "NEW_VALUE", "EXPECTED_VALUE", "CHANGE_STATUS", "EDITED_AT"],
                    rows: filtered
                };
            },

            validationBar(label, value, total) {
                const percent = Math.max(0, Math.min(100, (Number(value || 0) / Math.max(1, Number(total || 0))) * 100));
                const currentValue = Math.max(0, Number(value || 0));
                const maximumValue = Math.max(1, Number(total || 0));
                return `
                    <div class="edit-work-validation-bar">
                        <span>${this.escapeHtml(label)}</span>
                        <span class="edit-work-validation-track"
                              role="progressbar"
                              aria-label="${this.escapeHtml(label)}"
                              aria-valuemin="0"
                              aria-valuemax="${maximumValue}"
                              aria-valuenow="${Math.min(currentValue, maximumValue)}"
                              aria-valuetext="${currentValue.toLocaleString()} / ${maximumValue.toLocaleString()}">
                            <i style="width:${percent.toFixed(1)}%"></i>
                        </span>
                        <b>${Number(value || 0).toLocaleString()}</b>
                    </div>
                `;
            },

            analysisStatusMeta(status) {
                const normalized = String(status || "PENDING").toUpperCase();
                const labels = {
                    READY: ["analysisStatusReady", "반영 검토 가능"],
                    GOOD: ["analysisStatusGood", "양호"],
                    REVIEW: ["analysisStatusReview", "확인 필요"],
                    PENDING: ["analysisStatusPending", "대기"],
                    UNAVAILABLE: ["analysisStatusUnavailable", "계산 불가"],
                    NOT_APPLICABLE: ["analysisStatusNotApplicable", "대상 없음"]
                };
                const [key, fallback] = labels[normalized] || labels.PENDING;
                return {
                    code: normalized,
                    className: ["READY", "GOOD"].includes(normalized)
                        ? "is-good"
                        : (normalized === "REVIEW" ? "is-review" : (["UNAVAILABLE"].includes(normalized) ? "is-unavailable" : "is-pending")),
                    label: this.pageLabel(key, fallback)
                };
            },

            analysisNumber(value, maximumFractionDigits = 2) {
                if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
                return Number(value).toLocaleString(undefined, { maximumFractionDigits });
            },

            analysisPercent(value, digits = 1) {
                if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
                return `${(Number(value) * 100).toFixed(digits)}%`;
            },

            analysisCount(value) {
                return this.pageLabel("analysisCountValue", "{count}건")
                    .replaceAll("{count}", this.analysisNumber(value, 0));
            },

            analysisRunStatus(value) {
                const normalized = String(value || "").toUpperCase();
                const labels = {
                    SUCCESS: ["analysisRunStatusSuccess", "성공"],
                    COMPLETED: ["analysisRunStatusSuccess", "성공"],
                    RUNNING: ["analysisRunStatusRunning", "실행 중"],
                    STARTED: ["analysisRunStatusRunning", "실행 중"],
                    QUEUED: ["analysisRunStatusQueued", "대기열"],
                    REQUESTED: ["analysisRunStatusQueued", "대기열"],
                    PENDING: ["analysisRunStatusPending", "대기"],
                    FAILED: ["analysisRunStatusFailed", "실패"],
                    ERROR: ["analysisRunStatusFailed", "실패"],
                    CANCELLED: ["analysisRunStatusCancelled", "취소"]
                };
                const [key, fallback] = labels[normalized] || ["analysisRunStatusUnknown", "-"];
                return this.pageLabel(key, fallback);
            },

            analysisDirection(value) {
                const normalized = String(value || "").toUpperCase();
                const labels = {
                    IMPROVED: ["analysisDirectionImproved", "개선"],
                    WORSENED: ["analysisDirectionWorsened", "악화"],
                    UNCHANGED: ["analysisDirectionUnchanged", "동일"]
                };
                const [key, fallback] = labels[normalized] || ["analysisDirectionUnknown", "-"];
                return this.pageLabel(key, fallback);
            },

            analysisYesNo(value) {
                return String(value || "N").toUpperCase() === "Y"
                    ? this.pageLabel("analysisYes", "예")
                    : this.pageLabel("analysisNo", "아니요");
            },

            analysisRuleIdentifier(row) {
                if (row?.SOURCE_RULE_ID) return String(row.SOURCE_RULE_ID);
                if (row?.EDIT_RULE_ID !== null && row?.EDIT_RULE_ID !== undefined && row?.EDIT_RULE_ID !== "") {
                    return `#${row.EDIT_RULE_ID}`;
                }
                return "-";
            },

            renderAnalysisMetric(label, value, hint = "") {
                return `
                    <span>
                        <small>${this.escapeHtml(label)}</small>
                        <b>${this.escapeHtml(value)}</b>
                        ${hint ? `<em>${this.escapeHtml(hint)}</em>` : ""}
                    </span>
                `;
            },

            renderAnalysisCard(kind, title, status, metrics, description) {
                const statusMeta = this.analysisStatusMeta(status);
                const detailLabel = this.pageLabel("analysisDetailButton", `${title} 상세 보기`)
                    .replaceAll("{title}", title);
                return `
                    <article class="edit-work-analysis-card ${statusMeta.className}">
                        <header>
                            <div>
                                <h4>${this.escapeHtml(title)}</h4>
                                <span class="edit-work-analysis-status ${statusMeta.className}">${this.escapeHtml(statusMeta.label)}</span>
                            </div>
                            <button type="button"
                                    class="edit-work-analysis-detail-button"
                                    title="${this.escapeHtml(detailLabel)}"
                                    aria-label="${this.escapeHtml(detailLabel)}"
                                    aria-haspopup="dialog"
                                    aria-controls="detailDialog-${PAGE_CODE}"
                                    onclick="${PAGE_CODE}.openValidationAnalysisDetail('${this.escapeHtml(kind)}', event)">
                                <i class="fas fa-ellipsis" aria-hidden="true"></i>
                            </button>
                        </header>
                        <div class="edit-work-analysis-metrics">${metrics.join("")}</div>
                        <p>${this.escapeHtml(description)}</p>
                    </article>
                `;
            },

            renderEditAnalysisSummary(analysis, validation = {}) {
                const overall = analysis?.OVERALL || {};
                const categorical = analysis?.CATEGORICAL || {};
                const continuous = analysis?.CONTINUOUS || {};
                const reanalysis = analysis?.REANALYSIS || {};
                const sourceToEdit = (sourceValue, editValue) => `${this.analysisNumber(sourceValue, 0)} → ${this.analysisNumber(editValue, 0)}`;
                const snapshotNotice = validation.ANALYSIS_SOURCE === "VALIDATION_SNAPSHOT"
                    ? this.pageLabel("analysisSnapshotNotice", "검증 완료 시점 결과 · {date}")
                        .replaceAll("{date}", this.formatDate(validation.VALIDATION_SNAPSHOT_AT) || "-")
                    : "";
                return `
                    <section class="edit-work-validation-analysis" aria-labelledby="validationAnalysisTitle-${PAGE_CODE}">
                        <header class="edit-work-validation-analysis-heading">
                            <div>
                                <h3 id="validationAnalysisTitle-${PAGE_CODE}">${this.escapeHtml(this.pageLabel("validationAnalysisTitle", "운영 반영 전 에디팅 분석"))}</h3>
                                <span>${this.escapeHtml(this.pageLabel("validationAnalysisHelp", "수정에 사용한 동일 최종 규칙을 INITUP$과 INITDN$에 적용해 변경 영향과 규칙 적합도를 비교합니다."))}${snapshotNotice ? ` · ${this.escapeHtml(snapshotNotice)}` : ""}</span>
                            </div>
                        </header>
                        <div class="edit-work-validation-analysis-grid">
                            ${this.renderAnalysisCard(
                                "IMPACT",
                                this.pageLabel("analysisImpactTitle", "변경 영향·최소 수정"),
                                overall.STATUS,
                                [
                                    this.renderAnalysisMetric(this.pageLabel("analysisChangedRows", "변경 행"), this.analysisNumber(overall.CHANGED_ROW_COUNT, 0), this.analysisPercent(overall.CHANGED_ROW_RATE)),
                                    this.renderAnalysisMetric(this.pageLabel("analysisChangedColumns", "변경 컬럼"), this.analysisNumber(overall.DISTINCT_COLUMN_COUNT, 0)),
                                    this.renderAnalysisMetric(this.pageLabel("analysisExpectedAgreement", "기대값 일치"), this.analysisPercent(overall.EXPECTED_MATCH_RATE), this.analysisCount(overall.EXPECTED_MATCH_COUNT))
                                ],
                                this.pageLabel("analysisImpactDescription", "원본 데이터 보존 관점에서 변경 범위와 기대값 일치를 확인합니다.")
                            )}
                            ${this.renderAnalysisCard(
                                "CATEGORICAL",
                                this.pageLabel("analysisCategoricalTitle", "범주형 규칙 효과"),
                                categorical.STATUS,
                                [
                                    this.renderAnalysisMetric(this.pageLabel("analysisRuleCount", "규칙"), this.analysisNumber(categorical.RULE_COUNT, 0)),
                                    this.renderAnalysisMetric(this.pageLabel("analysisRuleViolations", "동일 규칙 위반"), sourceToEdit(categorical.SOURCE_VIOLATION_COUNT, categorical.EDIT_VIOLATION_COUNT)),
                                    this.renderAnalysisMetric(this.pageLabel("analysisExpectedAgreement", "기대값 일치"), this.analysisPercent(categorical.EXPECTED_MATCH_RATE))
                                ],
                                this.pageLabel("analysisCategoricalDescription", "정답 라벨이 없으므로 분류 정확도 대신 규칙 위반 감소와 기대값 일치를 평가합니다.")
                            )}
                            ${this.renderAnalysisCard(
                                "CONTINUOUS",
                                this.pageLabel("analysisContinuousTitle", "연속형 규칙 효과"),
                                continuous.STATUS,
                                [
                                    this.renderAnalysisMetric(this.pageLabel("analysisEvaluatedRows", "숫자 평가"), this.analysisNumber(continuous.EVALUATED_COUNT, 0)),
                                    this.renderAnalysisMetric("RMSE", `${this.analysisNumber(continuous.BEFORE_RMSE)} → ${this.analysisNumber(continuous.AFTER_RMSE)}`),
                                    this.renderAnalysisMetric(this.pageLabel("analysisTolerancePass", "허용오차 충족"), this.analysisPercent(continuous.WITHIN_TOLERANCE_RATE))
                                ],
                                this.pageLabel("analysisContinuousDescription", "수정 전·후 값과 수식 예측값의 잔차를 비교해 MAE/RMSE와 허용오차 충족을 평가합니다.")
                            )}
                            ${this.renderAnalysisCard(
                                "REANALYSIS",
                                this.pageLabel("analysisReanalysisTitle", "재분석·운영 준비"),
                                reanalysis.STATUS,
                                [
                                    this.renderAnalysisMetric("Flow Run", reanalysis.FLOW_RUN_ID ? `#${reanalysis.FLOW_RUN_ID}` : "-"),
                                    this.renderAnalysisMetric(this.pageLabel("analysisRunStatus", "Run 상태"), this.analysisRunStatus(reanalysis.RUN_STATUS)),
                                    this.renderAnalysisMetric(this.pageLabel("analysisSavedViolations", "저장 위반 결과"), sourceToEdit(reanalysis.BASELINE_VIOLATION_COUNT, reanalysis.REANALYSIS_VIOLATION_COUNT))
                                ],
                                this.pageLabel("analysisReanalysisDescription", "동일 규칙 직접 비교와 별도로 INITDN$ Flow 재분석 완료 여부를 확인합니다.")
                            )}
                        </div>
                    </section>
                `;
            },

            renderAnalysisDetailMetrics(items) {
                return `
                    <dl class="edit-work-analysis-detail-metrics">
                        ${items.map((item) => `
                            <div>
                                <dt>${this.escapeHtml(item.label)}</dt>
                                <dd>
                                    ${this.escapeHtml(item.value)}
                                    ${item.hint ? `<small>${this.escapeHtml(item.hint)}</small>` : ""}
                                </dd>
                            </div>
                        `).join("")}
                    </dl>
                `;
            },

            renderAnalysisDetailTable(title, columns, rows, emptyMessage = "") {
                const resolvedEmptyMessage = emptyMessage || this.pageLabel("analysisNoData", "표시할 데이터가 없습니다.");
                return `
                    <section class="edit-work-analysis-detail-section">
                        <h4>${this.escapeHtml(title)}</h4>
                        ${rows.length ? `
                            <div class="edit-work-analysis-table-wrap" role="region" aria-label="${this.escapeHtml(title)}" tabindex="0">
                                <table>
                                    <thead><tr>${columns.map((column) => `<th scope="col">${this.escapeHtml(column.label)}</th>`).join("")}</tr></thead>
                                    <tbody>
                                        ${rows.map((row) => `
                                            <tr>${columns.map((column) => `<td>${this.escapeHtml(column.value(row))}</td>`).join("")}</tr>
                                        `).join("")}
                                    </tbody>
                                </table>
                            </div>
                        ` : `<p class="edit-work-analysis-empty">${this.escapeHtml(resolvedEmptyMessage)}</p>`}
                    </section>
                `;
            },

            buildImpactAnalysisDetail(analysis) {
                const overall = analysis?.OVERALL || {};
                return `
                    ${this.renderAnalysisDetailMetrics([
                        { label: this.pageLabel("analysisSourceRows", "원본 전체 행"), value: this.analysisNumber(overall.SOURCE_ROW_COUNT, 0) },
                        { label: this.pageLabel("analysisAppliedCells", "적용 변경 셀"), value: this.analysisNumber(overall.APPLIED_CHANGE_COUNT, 0) },
                        { label: this.pageLabel("analysisChangedRows", "변경 행"), value: this.analysisNumber(overall.CHANGED_ROW_COUNT, 0), hint: this.analysisPercent(overall.CHANGED_ROW_RATE) },
                        { label: this.pageLabel("analysisChangedColumns", "변경 컬럼"), value: this.analysisNumber(overall.DISTINCT_COLUMN_COUNT, 0) },
                        { label: this.pageLabel("analysisChangedRules", "변경 관련 규칙"), value: this.analysisNumber(overall.DISTINCT_RULE_COUNT, 0) },
                        { label: this.pageLabel("analysisExpectedAgreement", "기대값 일치"), value: this.analysisPercent(overall.EXPECTED_MATCH_RATE), hint: this.analysisCount(overall.EXPECTED_MATCH_COUNT) }
                    ])}
                    <section class="edit-work-analysis-method-note">
                        <strong>${this.escapeHtml(this.pageLabel("analysisInterpretationTitle", "해석 기준"))}</strong>
                        <p>${this.escapeHtml(this.pageLabel("analysisImpactMethod", "통계 데이터 편집에서는 오류를 해소하면서 원본 변경 범위를 최소화했는지 함께 확인합니다. 변경률은 변경 행 수를 원본 전체 행 수로 나눈 값입니다."))}</p>
                    </section>
                    ${overall.EVALUATION_ERROR ? `
                        <section class="edit-work-analysis-method-note is-warning">
                            <strong>${this.escapeHtml(this.pageLabel("analysisCalculationUnavailable", "동일 규칙 비교 계산 불가"))}</strong>
                            <p>${this.escapeHtml(
                                overall.EVALUATION_ERROR === "VALIDATION_SNAPSHOT_UNAVAILABLE"
                                    ? this.pageLabel("analysisSnapshotUnavailable", "이 작업은 검증 결과 저장 기능 적용 전에 운영 반영되어 당시 동일 규칙 비교 결과를 복원할 수 없습니다. 변경 이력 지표만 확인할 수 있습니다.")
                                    : this.pageLabel("analysisSameRuleEvaluationUnavailable", "현재 테이블에 동일 규칙을 다시 적용하지 못했습니다. 규칙 식과 INITDN$ 구조를 확인한 후 다시 조회하세요.")
                            )}</p>
                        </section>
                    ` : ""}
                    <section class="edit-work-analysis-method-note is-info">
                        <strong>${this.escapeHtml(this.pageLabel("analysisLimitationsTitle", "평가 범위"))}</strong>
                        <p>${this.escapeHtml(this.pageLabel("analysisGroundTruthLimitation", "독립적인 정답 라벨이 없으므로 Accuracy, Precision, Recall, F1, AUC는 계산하지 않습니다."))}</p>
                        <p>${this.escapeHtml(this.pageLabel("analysisFullModelLimitation", "이 지표는 변경 행의 에디팅 효과이며 전체 데이터 모델의 R² 또는 교차검증 성능을 의미하지 않습니다."))}</p>
                    </section>
                `;
            },

            buildCategoricalAnalysisDetail(analysis) {
                const data = analysis?.CATEGORICAL || {};
                const rules = Array.isArray(data.RULES) ? data.RULES : [];
                const transitions = Array.isArray(data.TRANSITIONS) ? data.TRANSITIONS : [];
                const samples = Array.isArray(data.SAMPLES) ? data.SAMPLES : [];
                return `
                    ${this.renderAnalysisDetailMetrics([
                        { label: this.pageLabel("analysisRuleCount", "규칙"), value: this.analysisNumber(data.RULE_COUNT, 0) },
                        { label: this.pageLabel("analysisAppliedCells", "적용 변경 셀"), value: this.analysisNumber(data.CHANGE_COUNT, 0) },
                        { label: this.pageLabel("analysisChangedRows", "변경 행"), value: this.analysisNumber(data.CHANGED_ROW_COUNT, 0) },
                        { label: this.pageLabel("analysisExpectedAgreement", "기대값 일치"), value: this.analysisPercent(data.EXPECTED_MATCH_RATE), hint: this.analysisCount(data.EXPECTED_MATCH_COUNT) },
                        { label: this.pageLabel("analysisSourceViolations", "INITUP$ 동일 규칙 위반"), value: this.analysisNumber(data.SOURCE_VIOLATION_COUNT, 0) },
                        { label: this.pageLabel("analysisEditViolations", "INITDN$ 동일 규칙 위반"), value: this.analysisNumber(data.EDIT_VIOLATION_COUNT, 0), hint: `${this.analysisNumber(data.VIOLATION_REDUCTION_COUNT, 0)} · ${this.analysisPercent(data.VIOLATION_REDUCTION_RATE)}` }
                    ])}
                    <section class="edit-work-analysis-method-note">
                        <strong>${this.escapeHtml(this.pageLabel("analysisInterpretationTitle", "해석 기준"))}</strong>
                        <p>${this.escapeHtml(this.pageLabel("analysisCategoricalMethod", "수정에 사용한 동일 범주형 규칙을 INITUP$과 INITDN$에 다시 적용해 위반 발생 건수를 비교합니다. 기대값 일치율은 수정값이 THEN 기대값과 일치한 비율이며 분류 정확도가 아닙니다."))}</p>
                    </section>
                    ${this.renderAnalysisDetailTable(
                        this.pageLabel("analysisRuleBreakdown", "규칙별 평가"),
                        [
                            { label: this.pageLabel("analysisRuleId", "규칙 ID"), value: (row) => this.analysisRuleIdentifier(row) },
                            { label: this.pageLabel("analysisRuleName", "규칙명"), value: (row) => row.RULE_NAME || "-" },
                            { label: this.pageLabel("analysisTargetColumn", "대상 컬럼"), value: (row) => row.TARGET_COLUMN || "-" },
                            { label: this.pageLabel("analysisRuleExpression", "IF 조건"), value: (row) => row.RULE_EXPRESSION || "-" },
                            { label: this.pageLabel("analysisExpected", "기대값"), value: (row) => row.EXPECTED_VALUE ?? "-" },
                            { label: this.pageLabel("analysisChanges", "변경"), value: (row) => this.analysisNumber(row.CHANGE_COUNT, 0) },
                            { label: this.pageLabel("analysisExpectedAgreement", "기대값 일치"), value: (row) => this.analysisPercent(row.EXPECTED_MATCH_RATE) },
                            { label: "INITUP$", value: (row) => this.analysisNumber(row.SOURCE_VIOLATION_COUNT, 0) },
                            { label: "INITDN$", value: (row) => this.analysisNumber(row.EDIT_VIOLATION_COUNT, 0) },
                            { label: this.pageLabel("analysisReduction", "감소"), value: (row) => this.analysisNumber(row.VIOLATION_REDUCTION_COUNT, 0) }
                        ],
                        rules,
                        this.pageLabel("analysisNoCategoricalRules", "적용된 범주형 규칙이 없습니다.")
                    )}
                    ${this.renderAnalysisDetailTable(
                        this.pageLabel("analysisTopTransitions", "주요 값 변경"),
                        [
                            { label: this.pageLabel("analysisBefore", "수정 전"), value: (row) => row.OLD_VALUE ?? "-" },
                            { label: this.pageLabel("analysisAfter", "수정 후"), value: (row) => row.NEW_VALUE ?? "-" },
                            { label: this.pageLabel("analysisCount", "건수"), value: (row) => this.analysisNumber(row.CHANGE_COUNT, 0) },
                            { label: this.pageLabel("analysisShare", "비중"), value: (row) => this.analysisPercent(row.CHANGE_RATE) }
                        ],
                        transitions
                    )}
                    ${this.renderAnalysisDetailTable(
                        this.pageLabel("analysisChangeSamples", "변경 행 표본"),
                        [
                            { label: this.pageLabel("analysisCaseId", "행 식별값"), value: (row) => row.CASE_ID || "-" },
                            { label: this.pageLabel("analysisTargetColumn", "대상 컬럼"), value: (row) => row.COLUMN_NAME || "-" },
                            { label: this.pageLabel("analysisBefore", "수정 전"), value: (row) => row.OLD_VALUE ?? "-" },
                            { label: this.pageLabel("analysisAfter", "수정 후"), value: (row) => row.NEW_VALUE ?? "-" },
                            { label: this.pageLabel("analysisExpected", "기대값"), value: (row) => row.EXPECTED_VALUE ?? "-" },
                            { label: this.pageLabel("analysisMatch", "일치"), value: (row) => this.analysisYesNo(row.EXPECTED_MATCH_YN) }
                        ],
                        samples
                    )}
                `;
            },

            buildContinuousAnalysisDetail(analysis) {
                const data = analysis?.CONTINUOUS || {};
                const rules = Array.isArray(data.RULES) ? data.RULES : [];
                const samples = Array.isArray(data.SAMPLES) ? data.SAMPLES : [];
                return `
                    ${this.renderAnalysisDetailMetrics([
                        { label: this.pageLabel("analysisRuleCount", "규칙"), value: this.analysisNumber(data.RULE_COUNT, 0) },
                        { label: this.pageLabel("analysisEvaluatedRows", "숫자 평가"), value: this.analysisNumber(data.EVALUATED_COUNT, 0), hint: `${this.pageLabel("analysisNonNumeric", "비숫자")} ${this.analysisNumber(data.NON_NUMERIC_COUNT, 0)}` },
                        { label: "MAE", value: `${this.analysisNumber(data.BEFORE_MAE)} → ${this.analysisNumber(data.AFTER_MAE)}`, hint: this.analysisPercent(data.MAE_REDUCTION_RATE) },
                        { label: "RMSE", value: `${this.analysisNumber(data.BEFORE_RMSE)} → ${this.analysisNumber(data.AFTER_RMSE)}`, hint: this.analysisPercent(data.RMSE_REDUCTION_RATE) },
                        { label: this.pageLabel("analysisTolerancePass", "허용오차 충족"), value: this.analysisPercent(data.WITHIN_TOLERANCE_RATE), hint: this.analysisCount(data.WITHIN_TOLERANCE_COUNT) },
                        { label: this.pageLabel("analysisImprovedWorsened", "개선 / 악화"), value: `${this.analysisNumber(data.IMPROVED_COUNT, 0)} / ${this.analysisNumber(data.WORSENED_COUNT, 0)}` },
                        { label: this.pageLabel("analysisP95Error", "수정 후 P95 절대오차"), value: this.analysisNumber(data.AFTER_P95_ABS_ERROR) },
                        { label: this.pageLabel("analysisCvError", "수정 후 정규화 RMSE"), value: data.AFTER_NRMSE_PCT === null || data.AFTER_NRMSE_PCT === undefined ? "-" : `${this.analysisNumber(data.AFTER_NRMSE_PCT)}%` },
                        { label: this.pageLabel("analysisResidualMean", "수정 후 잔차 평균"), value: this.analysisNumber(data.AFTER_RESIDUAL_MEAN) },
                        { label: this.pageLabel("analysisResidualStddev", "수정 후 잔차 표준편차"), value: this.analysisNumber(data.AFTER_RESIDUAL_STDDEV) },
                        { label: this.pageLabel("analysisThreeSigmaOutliers", "3σ 초과"), value: this.analysisNumber(data.AFTER_3SIGMA_COUNT, 0) }
                    ])}
                    <section class="edit-work-analysis-method-note">
                        <strong>${this.escapeHtml(this.pageLabel("analysisInterpretationTitle", "해석 기준"))}</strong>
                        <p>${this.escapeHtml(this.pageLabel("analysisContinuousMethod", "변경된 숫자 행에서 수식 예측값에 대한 수정 전·후 잔차를 비교합니다. MAE/RMSE가 작아지고 허용오차 충족률이 높을수록 규칙 적합도가 개선된 것입니다."))}</p>
                        <p>${this.escapeHtml(this.pageLabel("analysisNrmseDefinition", "정규화 RMSE는 수정 후 RMSE를 수정 당시 예측값 절대값의 평균으로 나눈 비율입니다."))}</p>
                        <p>${this.escapeHtml(this.pageLabel("analysisFullModelLimitation", "이 지표는 변경 행의 에디팅 효과이며 전체 데이터 모델의 R² 또는 교차검증 성능을 의미하지 않습니다."))}</p>
                    </section>
                    ${this.renderAnalysisDetailTable(
                        this.pageLabel("analysisRuleBreakdown", "규칙별 평가"),
                        [
                            { label: this.pageLabel("analysisRuleId", "규칙 ID"), value: (row) => this.analysisRuleIdentifier(row) },
                            { label: this.pageLabel("analysisTargetColumn", "대상 컬럼"), value: (row) => row.TARGET_COLUMN || "-" },
                            { label: this.pageLabel("analysisRuleExpression", "수식"), value: (row) => row.RULE_EXPRESSION || "-" },
                            { label: this.pageLabel("analysisTolerance", "허용오차"), value: (row) => {
                                const value = row.EFFECTIVE_TOLERANCE_PCT ?? row.RULE_TOLERANCE_PCT;
                                const suffix = row.TOLERANCE_DEFAULTED
                                    ? ` (${this.pageLabel("analysisDefaultTolerance", "기본값")})`
                                    : "";
                                return value === null || value === undefined ? "-" : `${this.analysisNumber(value)}%${suffix}`;
                            } },
                            { label: "n", value: (row) => this.analysisNumber(row.EVALUATED_COUNT, 0) },
                            { label: "MAE", value: (row) => `${this.analysisNumber(row.BEFORE_MAE)} → ${this.analysisNumber(row.AFTER_MAE)}` },
                            { label: "RMSE", value: (row) => `${this.analysisNumber(row.BEFORE_RMSE)} → ${this.analysisNumber(row.AFTER_RMSE)}` },
                            { label: this.pageLabel("analysisTolerancePass", "허용오차 충족"), value: (row) => this.analysisPercent(row.WITHIN_TOLERANCE_RATE) },
                            { label: this.pageLabel("analysisRuleViolations", "동일 규칙 위반"), value: (row) => `${this.analysisNumber(row.SOURCE_VIOLATION_COUNT, 0)} → ${this.analysisNumber(row.EDIT_VIOLATION_COUNT, 0)}` }
                        ],
                        rules,
                        this.pageLabel("analysisNoContinuousRules", "적용된 연속형 규칙이 없습니다.")
                    )}
                    ${this.renderAnalysisDetailTable(
                        this.pageLabel("analysisLargestResiduals", "수정 후 잔차 상위 행"),
                        [
                            { label: this.pageLabel("analysisCaseId", "행 식별값"), value: (row) => row.CASE_ID || "-" },
                            { label: this.pageLabel("analysisTargetColumn", "대상 컬럼"), value: (row) => row.COLUMN_NAME || "-" },
                            { label: this.pageLabel("analysisBefore", "수정 전"), value: (row) => this.analysisNumber(row.OLD_VALUE_NUMERIC) },
                            { label: this.pageLabel("analysisAfter", "수정 후"), value: (row) => this.analysisNumber(row.NEW_VALUE_NUMERIC) },
                            { label: this.pageLabel("analysisPrediction", "예측값"), value: (row) => this.analysisNumber(row.EXPECTED_VALUE_NUMERIC) },
                            { label: this.pageLabel("analysisBeforeError", "수정 전 오차"), value: (row) => this.analysisNumber(row.BEFORE_ABS_ERROR) },
                            { label: this.pageLabel("analysisAfterError", "수정 후 오차"), value: (row) => this.analysisNumber(row.AFTER_ABS_ERROR) },
                            { label: this.pageLabel("analysisDirection", "방향"), value: (row) => this.analysisDirection(row.ERROR_DIRECTION) }
                        ],
                        samples
                    )}
                `;
            },

            buildReanalysisAnalysisDetail(analysis) {
                const data = analysis?.REANALYSIS || {};
                return `
                    ${this.renderAnalysisDetailMetrics([
                        { label: "Flow Run", value: data.FLOW_RUN_ID ? `#${data.FLOW_RUN_ID}` : "-" },
                        { label: this.pageLabel("analysisRunStatus", "Run 상태"), value: this.analysisRunStatus(data.RUN_STATUS) },
                        { label: this.pageLabel("analysisBaselineViolations", "Baseline 저장 위반"), value: this.analysisNumber(data.BASELINE_VIOLATION_COUNT, 0) },
                        { label: this.pageLabel("analysisReanalysisViolations", "재분석 저장 위반"), value: this.analysisNumber(data.REANALYSIS_VIOLATION_COUNT, 0) },
                        { label: this.pageLabel("analysisReduction", "감소"), value: this.analysisNumber(data.VIOLATION_REDUCTION_COUNT, 0), hint: this.analysisPercent(data.VIOLATION_REDUCTION_RATE) }
                    ])}
                    <section class="edit-work-analysis-method-note">
                        <strong>${this.escapeHtml(this.pageLabel("analysisInterpretationTitle", "해석 기준"))}</strong>
                        <p>${this.escapeHtml(this.pageLabel("analysisReanalysisMethod", "Flow 재분석 결과는 저장된 Run의 선정 대상 컬럼 위반 건수를 비교합니다. 규칙 ID나 수식이 재발굴 과정에서 달라질 수 있으므로 동일 규칙 직접 비교 카드와 함께 판단하세요."))}</p>
                    </section>
                `;
            },

            openValidationAnalysisDetail(kind, event = null) {
                const analysis = this.currentValidation?.EDIT_ANALYSIS || {};
                const normalized = String(kind || "IMPACT").toUpperCase();
                const titles = {
                    IMPACT: this.pageLabel("analysisImpactTitle", "변경 영향·최소 수정"),
                    CATEGORICAL: this.pageLabel("analysisCategoricalTitle", "범주형 규칙 효과"),
                    CONTINUOUS: this.pageLabel("analysisContinuousTitle", "연속형 규칙 효과"),
                    REANALYSIS: this.pageLabel("analysisReanalysisTitle", "재분석·운영 준비")
                };
                const builders = {
                    IMPACT: () => this.buildImpactAnalysisDetail(analysis),
                    CATEGORICAL: () => this.buildCategoricalAnalysisDetail(analysis),
                    CONTINUOUS: () => this.buildContinuousAnalysisDetail(analysis),
                    REANALYSIS: () => this.buildReanalysisAnalysisDetail(analysis)
                };
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const title = getContainerEl(`#detailLayerTitle-${PAGE_CODE}`);
                const eyebrow = getContainerEl(`#detailLayerEyebrow-${PAGE_CODE}`);
                const body = getContainerEl(`#detailLayerBody-${PAGE_CODE}`);
                if (!layer || !body || !builders[normalized]) return;
                this.detailLayerOpener = event?.currentTarget || document.activeElement;
                this.resetDetailDialogPosition();
                if (eyebrow) eyebrow.textContent = this.pageLabel("validationAnalysisEyebrow", "PRE-APPLY EDIT ANALYSIS");
                if (title) title.textContent = titles[normalized];
                body.innerHTML = builders[normalized]();
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog > header button")?.focus();
            },

            async markValidated() {
                const session = this.getSelectedSession();
                if (!session) return;
                const overall = this.currentValidation?.EDIT_ANALYSIS?.OVERALL || {};
                const reviewRequired = (
                    String(overall.STATUS || "").toUpperCase() === "REVIEW"
                    && !overall.EVALUATION_ERROR
                );
                if (reviewRequired) {
                    const confirmed = await CommonMessage.confirm(
                        this.pageLabel(
                            "analysisReviewConfirm",
                            "일부 검증 지표가 검토 필요 상태입니다. 상세 결과를 확인했으며 이 상태로 효과 검증을 완료할까요?"
                        )
                    );
                    if (!confirmed) return;
                }
                await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/validate`), {
                    method: "POST",
                    body: { acknowledgeReview: reviewRequired },
                    showLoading: false
                });
                CommonMessage.success(
                    this.pageLabel("effectValidationCompleted", "에디팅 효과 검증을 완료했습니다.")
                );
                this.invalidateEditWorkspaceCache("M05003_FINAL_APPLY");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.loadSessions(session.EDIT_SESSION_ID);
                await this.refresh();
            },

            async openReanalysisFlow() {
                const session = this.getSelectedSession();
                if (!session) {
                    CommonMessage.warn("현재 오류 수정 작업을 선택하세요.");
                    return;
                }
                const sessionStatus = String(session.SESSION_STATUS || "").toUpperCase();
                if (!["DRAFT", "EDITING", "VALIDATED", "APPLY_READY", "APPLIED"].includes(sessionStatus)) {
                    CommonMessage.warn("초기화된 작업은 규칙 발굴을 다시 실행할 수 없습니다.");
                    return;
                }
                if (!session.PROJECT_ID || !session.SCENARIO_ID || !session.TARGET_OWNER || !session.EDIT_TABLE) {
                    CommonMessage.error("재실행에 필요한 프로젝트·시나리오·INITDN$ 수정테이블 정보를 확인할 수 없습니다.");
                    return;
                }
                const runtimeContext = {
                    editSessionId: Number(session.EDIT_SESSION_ID),
                    projectId: session.PROJECT_ID,
                    scenarioId: session.SCENARIO_ID,
                    targetOwner: session.TARGET_OWNER,
                    targetTable: session.EDIT_TABLE,
                    sourceTable: session.SOURCE_TABLE,
                    preferredTargetMode: "EDIT"
                };
                sessionStorage.setItem("M04001:editingRuntimeContext", JSON.stringify(runtimeContext));
                localStorage.setItem("DATA_EDITING_WORK_CONTEXT", JSON.stringify({
                    projectId: session.PROJECT_ID || "",
                    scenarioId: session.SCENARIO_ID || ""
                }));
                const menu = window.MENU_PAGE_MAP?.M04001;
                try {
                    const result = await PageManager.load(
                        "M04001",
                        menu?.title || menu?.label || "Rule Discovery Execution",
                        false
                    );
                    if (PageManager.activePageCode !== "M04001" || result?.committed === false) {
                        throw new Error("규칙 발굴 실행 화면으로 이동하지 못했습니다.");
                    }
                } catch (error) {
                    sessionStorage.removeItem("M04001:editingRuntimeContext");
                    CommonMessage.error(error?.message || "규칙 발굴 재실행 화면을 열지 못했습니다.");
                }
            },

            async loadDml() {
                await this.loadViolationSourceTables();
                const { session } = this.resolveEditingTableSelection();
                this.setPanel("운영 반영 DML", "");
                this.hideModeForm();
                if (!session) {
                    this.rows = [];
                    this.setKpis([{ value: "-", label: "작업 테이블", hint: this.pageLabel("selectEditingTableForApply", "운영 반영할 INITUP$/INITDN$ 작업 테이블을 선택하세요.") }]);
                    this.renderEmpty(this.pageLabel("selectEditingTableForApply", "운영 반영할 INITUP$/INITDN$ 작업 테이블을 선택하세요."));
                    return;
                }
                const params = new URLSearchParams({ editSessionId: session.EDIT_SESSION_ID });
                const json = await CommonUtils.request(apiUrl(`/dml?${params}`), { method: "GET", showLoading: false });
                this.rows = (Array.isArray(json.data) ? json.data : [])
                    .map((item) => ({
                        ...item,
                        VALIDATION_MESSAGE_DISPLAY: this.localizeDmlValidationMessage(item.VALIDATION_MESSAGE)
                    }))
                    .sort((left, right) => Number(right.EDIT_DML_ID || 0) - Number(left.EDIT_DML_ID || 0));
                if (!this.selectedDmlId || !this.rows.some((item) => String(item.EDIT_DML_ID) === String(this.selectedDmlId))) {
                    this.selectedDmlId = String(this.rows[0]?.EDIT_DML_ID || "");
                }
                this.selectedDml = this.rows.find((item) => String(item.EDIT_DML_ID) === String(this.selectedDmlId)) || null;
                this.dmlSavedName = String(this.selectedDml?.DML_NAME || "");
                this.dmlSavedSql = String(this.selectedDml?.DML_SQL || "");
                this.dmlValidatedSql = ["APPROVED", "EXECUTED"].includes(String(this.selectedDml?.DML_STATUS || ""))
                    ? this.dmlSavedSql
                    : "";
                const counts = this.countBy(this.rows, "DML_STATUS");
                this.setKpis([
                    { value: this.rows.length, label: "등록 DML", hint: `${session.TARGET_OWNER}.${session.EDIT_TABLE} 현재 작업` },
                    { value: counts.DRAFT || 0, label: "저장", hint: "DML 실행 가능" },
                    { value: counts.APPROVED || 0, label: "검증 완료", hint: "기존 검증 DML" },
                    { value: counts.EXECUTED || 0, label: "실행 완료", hint: "커밋된 DML" }
                ]);
                this.renderDmlContent();
            },

            isDmlWorkspaceAvailable(session = this.getSelectedSession()) {
                return ["DRAFT", "EDITING", "VALIDATED", "APPLY_READY", "APPLIED"].includes(
                    String(session?.SESSION_STATUS || "").toUpperCase()
                );
            },

            renderDmlContent() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const dml = this.selectedDml || {};
                const session = this.getSelectedSession();
                const executionOpen = this.isDmlWorkspaceAvailable(session);
                const selectedDmlExecuted = String(dml.DML_STATUS || "").toUpperCase() === "EXECUTED";
                const selectedDmlEditable = executionOpen && !selectedDmlExecuted;
                this.renderDmlPanelActions();
                const { filtered, visible } = this.getPagedRows(this.getDmlDisplayRows());
                const dmlColumns = [
                    { key: "EDIT_DML_ID", label: "DML ID", width: 70, className: "is-number" },
                    { key: "DML_NAME", label: "DML 명", width: 220 },
                    { key: "DML_STATUS", label: "상태", width: 90, render: (value) => this.dmlStatusBadge(value) },
                    { key: "VALIDATION_MESSAGE_DISPLAY", label: "검증 결과", width: 300, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "VALIDATION_MESSAGE_DISPLAY", "DML 검증 결과") },
                    { key: "AFFECTED_ROW_COUNT", label: "영향 행", width: 80, className: "is-number" },
                    { key: "EXECUTED_AT", label: "실행 일시", width: 150, render: (value) => this.formatDate(value) },
                    {
                        key: "_ACTION",
                        label: executionOpen
                            ? this.pageLabel("columnEditDml", "편집")
                            : this.pageLabel("columnViewDml", "보기"),
                        width: 124,
                        className: "is-action-column",
                        headerClassName: "is-action-column",
                        render: (_value, row, index) => {
                            const dmlStatus = String(row.DML_STATUS || "").toUpperCase();
                            const rowEditable = executionOpen && dmlStatus !== "EXECUTED";
                            const deleteTitle = dmlStatus === "EXECUTED"
                                ? this.pageLabel("executedDmlDeleteBlocked", "실행 완료 DML은 감사 이력 보존을 위해 삭제할 수 없습니다.")
                                : executionOpen
                                    ? this.pageLabel("buttonDeleteDmlHelp", "선택한 저장 DML을 삭제합니다.")
                                    : this.pageLabel("closedExecutionReadOnly", "운영 반영 완료 또는 초기화된 작업은 이력 조회만 할 수 있습니다.");
                            return `
                                <span class="edit-work-row-actions">
                                    <button title="${this.escapeHtml(this.pageLabel("buttonEditDmlHelp", "선택한 DML을 하단 편집창에 불러옵니다."))}"
                                            onclick="event.stopPropagation(); ${PAGE_CODE}.selectDml(${index})">
                                        ${this.escapeHtml(
                                            rowEditable
                                                ? this.pageLabel("buttonEditDml", "편집")
                                                : this.pageLabel("buttonViewDml", "보기")
                                        )}
                                    </button>
                                    <button class="is-danger"
                                            title="${this.escapeHtml(deleteTitle)}"
                                            onclick="event.stopPropagation(); ${PAGE_CODE}.deleteDml(${index})">
                                        ${this.escapeHtml(this.pageLabel("buttonDeleteDml", "삭제"))}
                                    </button>
                                </span>
                            `;
                        }
                    }
                ];
                content.innerHTML = `
                    <div class="edit-work-dml-history-grid">
                        ${this.buildGridHtml(visible, dmlColumns, true)}
                    </div>
                    <section class="edit-work-dml-panel">
                        <details class="edit-work-dml-algorithm-guide">
                            <summary><i class="fas fa-circle-info" aria-hidden="true"></i>자동 생성 DML 동작 방식</summary>
                            <div>
                                <p>회귀식을 운영 원본에서 다시 계산하지 않고, 오류 수정에서 사용자가 확정하여 INITDN$와 <b>APPLIED</b> 변경 이력에 저장된 값만 INITUP$에 반영합니다.</p>
                                <ol>
                                    <li>행 연결은 검증된 업무키를 우선 사용하고, 업무키를 사용할 수 없으면 원본 ROWID 추적값을 사용합니다.</li>
                                    <li>변경이 확정된 컬럼만 CASE 식으로 갱신하여 다른 컬럼 값은 유지합니다.</li>
                                    <li>예상 변경 행수와 실제 MERGE 반영 행수가 다르면 실행 전체를 실패 처리하고 rollback 합니다.</li>
                                </ol>
                            </div>
                        </details>
                        <div class="edit-work-form-grid">
                            <label class="edit-work-field is-wide">
                                <span class="edit-work-dml-name-label">
                                    <span>DML 명</span>
                                    <em>${this.escapeHtml(
                                        dml.EDIT_DML_ID
                                            ? `DML ID #${dml.EDIT_DML_ID}`
                                            : this.pageLabel("dmlIdUnsaved", "신규 · 미저장")
                                    )}</em>
                                </span>
                                <input id="dmlName-${PAGE_CODE}" value="${this.escapeHtml(dml.DML_NAME || "")}" oninput="${PAGE_CODE}.handleDmlNameInput()" ${selectedDmlEditable ? "" : "disabled"}>
                            </label>
                            <label class="edit-work-field"><span>상태</span><input value="${this.escapeHtml(this.dmlStatusLabel(dml.DML_STATUS))}" disabled></label>
                            <label class="edit-work-field"><span>영향 행</span><input value="${this.escapeHtml(dml.AFFECTED_ROW_COUNT ?? "-")}" disabled></label>
                        </div>
                        <p class="edit-work-dml-notice">${this.escapeHtml(this.pageLabel("dmlEditNotice", "DML 저장은 현재 SQL을 그대로 보관합니다. DML 검증은 필요할 때 별도로 실행할 수 있습니다."))}</p>
                        <textarea id="dmlSql-${PAGE_CODE}" class="edit-work-dml-editor" spellcheck="false" oninput="${PAGE_CODE}.handleDmlSqlInput()" ${selectedDmlEditable ? "" : "disabled"}>${this.escapeHtml(dml.DML_SQL || "")}</textarea>
                    </section>
                `;
                this.updateGridMeta(filtered);
                this.currentExport = {
                    filename: "editing-apply-dml.csv",
                    columns: ["EDIT_DML_ID", "DML_NAME", "DML_STATUS", "VALIDATION_MESSAGE_DISPLAY", "AFFECTED_ROW_COUNT", "EXECUTED_AT"],
                    rows: filtered
                };
            },

            getDmlDisplayRows() {
                const unsaved = this.selectedDml
                    && !this.selectedDml.EDIT_DML_ID
                    && String(this.selectedDml.DML_STATUS || "").toUpperCase() === "UNSAVED"
                    ? [{ ...this.selectedDml }]
                    : [];
                return [...unsaved, ...this.rows];
            },

            getVisibleDmlRows() {
                const filtered = this.getFilteredRows(this.getDmlDisplayRows());
                const start = (this.page - 1) * this.pageSize;
                return filtered.slice(start, start + this.pageSize);
            },

            renderDmlPanelActions() {
                const actions = getContainerEl(`#modeActions-${PAGE_CODE}`);
                if (!actions) return;
                const session = this.getSelectedSession();
                if (!session) {
                    actions.innerHTML = "";
                    return;
                }
                const dml = this.selectedDml || {};
                const currentSql = String(dml.DML_SQL || "");
                const currentName = String(dml.DML_NAME || "");
                const isSaved = Boolean(dml.EDIT_DML_ID)
                    && currentSql === this.dmlSavedSql
                    && currentName === this.dmlSavedName;
                const dmlStatus = String(dml.DML_STATUS || "").toUpperCase();
                const executionOpen = this.isDmlWorkspaceAvailable(session);
                const dmlEditable = executionOpen && dmlStatus !== "EXECUTED";
                const canValidate = dmlEditable && Boolean(currentSql);
                const canSave = dmlEditable && Boolean(currentSql);
                const canExecute = executionOpen && isSaved && ["DRAFT", "APPROVED", "FAILED"].includes(dmlStatus);
                actions.innerHTML = `
                    <button type="button" onclick="${PAGE_CODE}.addDml()" ${executionOpen ? "" : "disabled"}><i class="fas fa-plus"></i>${this.escapeHtml(this.pageLabel("buttonAddDml", "빈 DML 추가"))}</button>
                    <button type="button" onclick="${PAGE_CODE}.generateDml()" ${executionOpen ? "" : "disabled"}><i class="fas fa-wand-magic-sparkles"></i>${this.escapeHtml(this.pageLabel("buttonGenerateDml", "규칙 DML 자동 생성"))}</button>
                    <button type="button" onclick="${PAGE_CODE}.regenerateDml()" ${dmlEditable && currentSql ? "" : "disabled"}><i class="fas fa-rotate"></i>${this.escapeHtml(this.pageLabel("buttonRegenerateDml", "초기구문 재생성"))}</button>
                    <button type="button" onclick="${PAGE_CODE}.validateDml()" ${canValidate ? "" : "disabled"}><i class="fas fa-check-double"></i>${this.escapeHtml(this.pageLabel("buttonValidateDml", "DML 검증"))}</button>
                    <button type="button" class="is-primary" onclick="${PAGE_CODE}.saveDmlDraft()" ${canSave ? "" : "disabled"}><i class="fas fa-floppy-disk"></i>${this.escapeHtml(this.pageLabel("buttonSaveDml", "DML 저장"))}</button>
                    <button type="button" class="is-primary" onclick="${PAGE_CODE}.executeDml()" ${canExecute ? "" : "disabled"}><i class="fas fa-play"></i>${this.escapeHtml(this.pageLabel("buttonExecuteDml", "DML 실행"))}</button>
                `;
            },

            selectDml(index) {
                const row = this.getVisibleDmlRows()[index];
                if (!row) return;
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                const historyGrid = content?.querySelector(".edit-work-dml-history-grid");
                const scrollPosition = {
                    contentTop: content?.scrollTop || 0,
                    contentLeft: content?.scrollLeft || 0,
                    gridTop: historyGrid?.scrollTop || 0,
                    gridLeft: historyGrid?.scrollLeft || 0
                };
                this.selectedDmlId = row.EDIT_DML_ID ? String(row.EDIT_DML_ID) : "";
                this.selectedDml = { ...row };
                this.dmlSavedName = String(row.DML_NAME || "");
                this.dmlSavedSql = String(row.DML_SQL || "");
                this.dmlValidatedSql = ["APPROVED", "EXECUTED"].includes(String(row.DML_STATUS || ""))
                    ? this.dmlSavedSql
                    : "";
                this.renderDmlContent();
                window.requestAnimationFrame?.(() => {
                    const nextContent = getContainerEl(`#workContent-${PAGE_CODE}`);
                    const nextHistoryGrid = nextContent?.querySelector(".edit-work-dml-history-grid");
                    if (nextContent) {
                        nextContent.scrollTop = scrollPosition.contentTop;
                        nextContent.scrollLeft = scrollPosition.contentLeft;
                    }
                    if (nextHistoryGrid) {
                        nextHistoryGrid.scrollTop = scrollPosition.gridTop;
                        nextHistoryGrid.scrollLeft = scrollPosition.gridLeft;
                    }
                });
            },

            async deleteDml(index) {
                const row = this.getVisibleDmlRows()[index];
                if (!row) {
                    CommonMessage.warn(
                        this.pageLabel("dmlDeleteTargetMissing", "삭제할 DML을 찾을 수 없습니다. 목록을 새로고침한 후 다시 시도하세요.")
                    );
                    return;
                }
                if (!row.EDIT_DML_ID) {
                    this.selectedDmlId = "";
                    this.selectedDml = null;
                    this.dmlSavedName = "";
                    this.dmlSavedSql = "";
                    this.dmlValidatedSql = "";
                    this.renderDmlContent();
                    CommonMessage.success(
                        this.pageLabel("unsavedDmlRemoved", "미저장 DML을 목록에서 제거했습니다.")
                    );
                    return;
                }
                if (String(row.DML_STATUS || "").toUpperCase() === "EXECUTED") {
                    CommonMessage.warn(
                        this.pageLabel("executedDmlDeleteBlocked", "실행 완료 DML은 감사 이력 보존을 위해 삭제할 수 없습니다.")
                    );
                    return;
                }
                const session = this.getSelectedSession();
                if (!this.isDmlWorkspaceAvailable(session)) {
                    CommonMessage.warn(
                        this.pageLabel("closedExecutionReadOnly", "운영 반영 완료 또는 초기화된 작업은 이력 조회만 할 수 있습니다.")
                    );
                    return;
                }
                const message = this.pageLabel(
                    "confirmDeleteDml",
                    "DML #{id} · {name}을 삭제하시겠습니까?\n삭제한 저장 DML은 복구할 수 없습니다."
                )
                    .replaceAll("{id}", String(row.EDIT_DML_ID))
                    .replaceAll("{name}", String(row.DML_NAME || "-"));
                if (!(await CommonMessage.confirm(message))) return;
                try {
                    await CommonUtils.request(apiUrl(`/dml/${row.EDIT_DML_ID}`), {
                        method: "DELETE",
                        showLoading: true
                    });
                    if (String(this.selectedDmlId) === String(row.EDIT_DML_ID)) {
                        this.selectedDmlId = "";
                        this.selectedDml = null;
                        this.dmlSavedName = "";
                        this.dmlSavedSql = "";
                        this.dmlValidatedSql = "";
                    }
                    CommonMessage.success(this.pageLabel("dmlDeleted", "DML을 삭제했습니다."));
                    this.invalidateEditWorkspaceCache("M05003_HISTORY");
                    await this.refresh();
                } catch (error) {
                    CommonMessage.error(
                        error?.message || this.pageLabel("dmlDeleteFailed", "DML 삭제에 실패했습니다."),
                        { copyable: true }
                    );
                }
            },

            handleDmlNameInput() {
                const name = getContainerEl(`#dmlName-${PAGE_CODE}`)?.value || "";
                if (!this.selectedDml) this.selectedDml = {};
                this.selectedDml.DML_NAME = name;
                this.renderDmlPanelActions();
            },

            handleDmlSqlInput() {
                const sql = getContainerEl(`#dmlSql-${PAGE_CODE}`)?.value || "";
                if (!this.selectedDml) this.selectedDml = {};
                this.selectedDml.DML_SQL = sql;
                if (sql !== this.dmlValidatedSql) this.dmlValidatedSql = "";
                this.renderDmlPanelActions();
            },

            prepareUnsavedDml(session, dmlName, dmlSql = "") {
                this.selectedDmlId = "";
                this.selectedDml = {
                    EDIT_DML_ID: null,
                    DML_NAME: dmlName,
                    DML_SQL: dmlSql,
                    DML_STATUS: "UNSAVED",
                    AFFECTED_ROW_COUNT: null
                };
                this.dmlSavedName = "";
                this.dmlSavedSql = "";
                this.dmlValidatedSql = "";
                this.page = 1;
                this.keyword = "";
                const keywordInput = getContainerEl(`#gridKeyword-${PAGE_CODE}`);
                if (keywordInput) keywordInput.value = "";
                this.renderDmlContent();
            },

            addDml() {
                const session = this.getSelectedSession();
                if (!session || !this.isDmlWorkspaceAvailable(session)) return;
                const dmlName = this.pageLabel("defaultCustomDmlName", "{table} 사용자 DML")
                    .replaceAll("{table}", String(session.SOURCE_TABLE || "INITUP$"));
                this.prepareUnsavedDml(session, dmlName, "");
                CommonMessage.success(
                    this.pageLabel("dmlBlankAdded", "빈 DML을 추가했습니다. 현재 INITUP$ 대상 UPDATE 문을 입력한 후 저장하세요.")
                );
            },

            async generateDml() {
                const session = this.getSelectedSession();
                if (!session) return;
                const json = await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/dml/generate`), { method: "POST", showLoading: false });
                this.prepareUnsavedDml(
                    session,
                    json.dmlName || `${session.SOURCE_TABLE} final apply`,
                    json.dmlSql || ""
                );
                CommonMessage.success(this.pageLabel("dmlGeneratedPreview", "신규 운영 반영 DML을 생성했습니다. 미저장 행을 확인한 후 검증하거나 바로 저장할 수 있습니다."));
            },

            async regenerateDml() {
                const session = this.getSelectedSession();
                if (!session || !this.selectedDml) return;
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                const historyGrid = content?.querySelector(".edit-work-dml-history-grid");
                const scrollPosition = {
                    contentTop: content?.scrollTop || 0,
                    contentLeft: content?.scrollLeft || 0,
                    gridTop: historyGrid?.scrollTop || 0,
                    gridLeft: historyGrid?.scrollLeft || 0
                };
                const json = await CommonUtils.request(
                    apiUrl(`/sessions/${session.EDIT_SESSION_ID}/dml/generate`),
                    { method: "POST", showLoading: false }
                );
                this.selectedDml = {
                    ...this.selectedDml,
                    DML_SQL: json.dmlSql || ""
                };
                this.dmlValidatedSql = "";
                this.renderDmlContent();
                window.requestAnimationFrame?.(() => {
                    const nextContent = getContainerEl(`#workContent-${PAGE_CODE}`);
                    const nextHistoryGrid = nextContent?.querySelector(".edit-work-dml-history-grid");
                    if (nextContent) {
                        nextContent.scrollTop = scrollPosition.contentTop;
                        nextContent.scrollLeft = scrollPosition.contentLeft;
                    }
                    if (nextHistoryGrid) {
                        nextHistoryGrid.scrollTop = scrollPosition.gridTop;
                        nextHistoryGrid.scrollLeft = scrollPosition.gridLeft;
                    }
                });
                CommonMessage.success(
                    this.pageLabel(
                        "dmlRegenerated",
                        "선택한 DML을 현재 편집 변경 내역의 초기 생성 구문으로 다시 만들었습니다. 검증하거나 바로 저장할 수 있습니다."
                    )
                );
            },

            async saveDmlDraft() {
                const session = this.getSelectedSession();
                if (!session) return;
                if (!this.isDmlWorkspaceAvailable(session)) {
                    CommonMessage.warn(this.pageLabel("closedExecutionReadOnly", "운영 반영 완료 또는 초기화된 작업은 이력 조회만 할 수 있습니다."));
                    return;
                }
                const currentSql = getContainerEl(`#dmlSql-${PAGE_CODE}`)?.value || "";
                if (!currentSql.trim()) {
                    CommonMessage.warn(this.pageLabel("dmlSqlRequired", "저장할 DML SQL을 입력하세요."));
                    return;
                }
                const currentStatus = String(this.selectedDml?.DML_STATUS || "");
                const currentName = getContainerEl(`#dmlName-${PAGE_CODE}`)?.value?.trim?.()
                    || `${session.SOURCE_TABLE} final apply`;
                const hasChanges = (
                    currentSql !== this.dmlSavedSql
                    || currentName !== this.dmlSavedName
                );
                if (
                    this.selectedDml?.EDIT_DML_ID
                    && !hasChanges
                ) {
                    CommonMessage.info(
                        this.pageLabel("dmlNoChanges", "저장할 변경사항이 없습니다.")
                    );
                    return;
                }
                const payload = {
                    editDmlId: ["DRAFT", "APPROVED", "FAILED"].includes(currentStatus)
                        ? this.optionalNumber(this.selectedDml?.EDIT_DML_ID)
                        : null,
                    editSessionId: Number(session.EDIT_SESSION_ID),
                    dmlName: currentName,
                    dmlSql: currentSql
                };
                try {
                    const json = await CommonUtils.request(apiUrl("/dml"), {
                        method: "POST",
                        body: payload,
                        showLoading: true
                    });
                    this.selectedDmlId = String(json.editDmlId);
                    this.dmlValidatedSql = "";
                    CommonMessage.success(this.pageLabel("dmlSaved", "DML 명과 SQL을 저장했습니다."));
                    this.invalidateEditWorkspaceCache("M05003_HISTORY");
                    await this.loadSessions(session.EDIT_SESSION_ID);
                    await this.refresh();
                } catch (error) {
                    this.renderDmlPanelActions();
                    CommonMessage.error(
                        `${this.pageLabel("dmlSaveFailed", "DML 저장에 실패했습니다.")}\n${String(error?.message || "")}`,
                        { copyable: true }
                    );
                }
            },

            async validateDml() {
                const session = this.getSelectedSession();
                if (!session) return;
                const sql = getContainerEl(`#dmlSql-${PAGE_CODE}`)?.value || "";
                if (!sql.trim()) return;
                try {
                    const json = await CommonUtils.request(apiUrl("/dml/validate"), {
                        method: "POST",
                        body: {
                            editSessionId: Number(session.EDIT_SESSION_ID),
                            dmlSql: sql
                        },
                        showLoading: true
                    });
                    if (!this.selectedDml) this.selectedDml = {};
                    this.selectedDml.DML_SQL = sql;
                    this.dmlValidatedSql = sql;
                    this.renderDmlPanelActions();
                    CommonMessage.success(
                        this.localizeDmlValidationMessage(json.validationMessage, session)
                        || this.pageLabel("dmlValidationSuccess", "DML 검증이 완료되었습니다.")
                    );
                } catch (error) {
                    this.dmlValidatedSql = "";
                    this.renderDmlPanelActions();
                    this.showDmlValidationFailure(error);
                }
            },

            localizeDmlValidationMessage(value, session = null) {
                const message = String(value || "").trim();
                if (!message) return "";
                const validatedTarget = message.match(/^Validated final DML target:\s*"([^"]+)"\."([^"]+)"\.$/i);
                if (validatedTarget) {
                    const target = `${validatedTarget[1]}.${validatedTarget[2]}`;
                    return this.pageLabel(
                        "dmlValidationTargetSuccess",
                        "운영 반영 DML 대상을 검증했습니다: {target}"
                    ).replaceAll("{target}", target);
                }
                const customTarget = message.match(/^Validated custom UPDATE target:\s*"([^"]+)"\."([^"]+)"\.$/i);
                if (customTarget) {
                    const target = `${customTarget[1]}.${customTarget[2]}`;
                    return this.pageLabel(
                        "dmlValidationCustomTargetSuccess",
                        "사용자 UPDATE 대상을 검증했습니다: {target}"
                    ).replaceAll("{target}", target);
                }
                if (/^Validated final DML target:/i.test(message) && session) {
                    const target = `${session.TARGET_OWNER || "-"}.${session.SOURCE_TABLE || "-"}`;
                    return this.pageLabel(
                        "dmlValidationTargetSuccess",
                        "운영 반영 DML 대상을 검증했습니다: {target}"
                    ).replaceAll("{target}", target);
                }
                const rules = [
                    [/DML SQL is required\./i, "dmlValidationSqlRequired", "검증할 DML SQL을 입력하세요."],
                    [/DML SQL is too large\./i, "dmlValidationSqlTooLarge", "DML SQL이 검증 가능한 최대 크기를 초과했습니다."],
                    [/Comments are not allowed in final DML\./i, "dmlValidationCommentsNotAllowed", "운영 반영 DML에는 주석을 사용할 수 없습니다."],
                    [/Final DML must keep the server-generated PL\/SQL structure\./i, "dmlValidationStructureRequired", "서버가 생성한 운영 반영 PL/SQL 구조를 유지해야 합니다."],
                    [/The row-count validation section of final DML cannot be changed\./i, "dmlValidationRowCountLocked", "운영 반영 DML의 변경 건수 검증 구문은 수정할 수 없습니다."],
                    [/Final DML must keep the current INITUP\$\/INITDN\$ target, editing history, and matched-row update structure\./i, "dmlValidationScopeRequired", "현재 INITUP$/INITDN$ 대상, 수정 이력 및 일치 행 갱신 구조를 유지해야 합니다."],
                    [/The server-generated final DML row match condition cannot be changed\./i, "dmlValidationMatchLocked", "서버가 생성한 행 연결 조건은 수정할 수 없습니다."],
                    [/Final DML contains a command that is not allowed for INITDN\$ final apply\./i, "dmlValidationCommandNotAllowed", "INITDN$ 운영 반영에서 허용되지 않는 명령이 포함되어 있습니다."],
                    [/Final DML must contain exactly one MERGE statement\./i, "dmlValidationSingleMerge", "운영 반영 DML에는 MERGE 문이 정확히 하나만 있어야 합니다."],
                    [/Final DML must contain exactly one matched-row UPDATE\./i, "dmlValidationSingleUpdate", "운영 반영 DML에는 일치 행 UPDATE가 정확히 하나만 있어야 합니다."],
                    [/Final DML references an owner, table, or column outside the generated editing scope\./i, "dmlValidationIdentifierScope", "생성된 편집 범위 밖의 Owner, 테이블 또는 컬럼을 참조할 수 없습니다."],
                    [/Final DML contains a function or callable expression outside the generated editing scope\./i, "dmlValidationFunctionScope", "생성된 편집 범위 밖의 함수 또는 호출식을 사용할 수 없습니다."],
                    [/Final DML can reference only the selected editing execution\./i, "dmlValidationExecutionScope", "선택한 에디팅 작업 이력만 참조할 수 있습니다."],
                    [/Generated final DML is not valid Oracle SQL/i, "dmlOracleSyntaxInvalid", "생성된 운영 반영 DML의 Oracle 문법이 올바르지 않습니다."]
                ];
                const translated = rules.find(([pattern]) => pattern.test(message));
                return translated ? this.pageLabel(translated[1], translated[2]) : message;
            },

            showDmlValidationFailure(error) {
                const rawMessage = String(error?.message || "");
                let detail = this.localizeDmlValidationMessage(rawMessage);
                if (/Final DML row mapping is stale or ambiguous/i.test(rawMessage)) {
                    const diagnostics = rawMessage.match(
                        /expected=\d+.*?caseKeyChecks=[^.]+/i
                    )?.[0];
                    detail = this.pageLabel(
                        "dmlRowMappingStale",
                        "편집 행과 현재 원본 행을 안전하게 연결할 수 없습니다. 현재 수정을 초기화하거나 업무 키 설정을 확인하세요."
                    );
                    if (diagnostics) detail += `\n${diagnostics}`;
                } else if (/must match the server-generated INITDN\\$ apply statement/i.test(rawMessage)) {
                    detail = this.pageLabel("dmlRegenerateRequired", "저장된 DML이 최신 서버 생성 SQL과 다릅니다. DML을 다시 생성하세요.");
                } else if (/not valid Oracle SQL/i.test(rawMessage)) {
                    detail = /Custom UPDATE DML/i.test(rawMessage)
                        ? this.pageLabel("dmlCustomOracleSyntaxInvalid", "사용자 UPDATE DML의 Oracle 문법이 올바르지 않습니다.")
                        : this.pageLabel("dmlOracleSyntaxInvalid", "생성된 운영 반영 DML의 Oracle 문법이 올바르지 않습니다.");
                }
                const title = this.pageLabel("dmlValidationFailed", "DML 검증에 실패했습니다.");
                CommonMessage.error(detail ? `${title}\n${detail}` : title, { copyable: true });
            },

            async executeDml() {
                if (!this.selectedDml?.EDIT_DML_ID) return;
                const dmlStatus = String(this.selectedDml.DML_STATUS || "").toUpperCase();
                if (!["DRAFT", "APPROVED", "FAILED"].includes(dmlStatus)) return;
                const session = this.getSelectedSession();
                const message = [
                    `저장된 DML #${this.selectedDml.EDIT_DML_ID}의 SQL을 실행합니다.`,
                    `${session.TARGET_OWNER}.${session.SOURCE_TABLE} 운영 원본이 변경되고 커밋됩니다.`,
                    "계속할까요?"
                ].join("\n\n");
                if (!(await CommonMessage.confirm(message))) return;
                const json = await CommonUtils.request(apiUrl(`/dml/${this.selectedDml.EDIT_DML_ID}/execute`), { method: "POST", showLoading: true });
                CommonMessage.success(
                    `운영 반영을 완료했습니다. 작업 이력 #${session.EDIT_SESSION_ID} · ${Number(json.affectedRowCount || 0).toLocaleString()}행 반영`
                );
                this.invalidateEditWorkspaceCache("M05002");
                this.invalidateEditWorkspaceCache("M05003");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.loadSessions(session.EDIT_SESSION_ID);
                await this.refresh();
            },

            async loadHistory() {
                await this.loadViolationSourceTables();
                const { session } = this.resolveEditingTableSelection();
                this.setPanel("에디팅 감사 이력", "");
                this.hideModeForm();
                if (!session) {
                    this.rows = [];
                    this.setKpis([{
                        value: "-",
                        label: "작업 테이블",
                        hint: this.pageLabel("selectEditingTableForAudit", "전체 이력을 조회할 INITUP$/INITDN$ 작업 테이블을 선택하세요.")
                    }]);
                    this.renderEmpty(this.pageLabel("selectEditingTableForAudit", "전체 이력을 조회할 INITUP$/INITDN$ 작업 테이블을 선택하세요."));
                    return;
                }
                const params = this.contextParams();
                params.set("eventType", this.stageFilters.EVENT_TYPE || "ALL");
                params.set("editSessionId", session.EDIT_SESSION_ID);
                const json = await CommonUtils.request(apiUrl(`/history?${params}`), { method: "GET", showLoading: false });
                this.rows = Array.isArray(json.data) ? json.data : [];
                const counts = this.countBy(this.rows, "EVENT_TYPE");
                this.setKpis([
                    { value: this.rows.length, label: "감사 이벤트", hint: json.limited ? "최근 5,000건 표시" : (session ? `작업 이력 #${session.EDIT_SESSION_ID}` : "전체 이력") },
                    { value: counts.RULE_DECISION || 0, label: "규칙 판단", hint: "선정·제외·등록" },
                    { value: counts.CELL_EDITED || 0, label: "데이터 수정", hint: "INITDN$ 셀 변경" },
                    { value: counts.DML_EXECUTED || 0, label: "운영 반영", hint: "커밋 완료 이벤트" }
                ]);
                this.renderHistoryContent();
            },

            renderHistoryContent() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const { filtered, visible } = this.getPagedRows(this.rows);
                const historyColumns = [
                    { key: "EDIT_EVENT_ID", label: "이력 ID", width: 72, className: "is-number" },
                    { key: "EVENT_TYPE", label: "이벤트", width: 120, render: (value) => this.badge(value) },
                    { key: "EDIT_SESSION_ID", label: "작업 이력 ID", width: 96, className: "is-number", render: (value) => value ? `#${this.escapeHtml(value)}` : "-" },
                    { key: "ENTITY_TYPE", label: "대상 유형", width: 105 },
                    { key: "ENTITY_ID", label: "대상 ID", width: 86, className: "is-number" },
                    { key: "EVENT_SUMMARY", label: "이력 내용", width: 330, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "EVENT_SUMMARY", "이력 내용") },
                    { key: "EVENT_DETAIL_JSON", label: "상세", width: 260, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "EVENT_DETAIL_JSON", "이력 상세") },
                    { key: "DML_NAME", label: "DML 명", width: 180 },
                    { key: "DML_STATUS", label: "DML 상태", width: 105, render: (value) => value ? this.badge(value) : "-" },
                    { key: "DML_SQL", label: "저장·실행 DML SQL", width: 420, className: "is-rule-detail is-code", render: (value, _row, index) => this.renderTextPreview(value, index, "DML_SQL", "저장·실행 DML SQL") },
                    { key: "AFFECTED_ROW_COUNT", label: "반영 행", width: 90, className: "is-number", render: (value) => value === null || value === undefined ? "-" : Number(value).toLocaleString() },
                    { key: "DML_EXECUTION_MESSAGE", label: "DML 실행 결과", width: 260, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "DML_EXECUTION_MESSAGE", "DML 실행 결과") },
                    { key: "EXECUTED_BY", label: "반영 작업자", width: 110 },
                    { key: "EXECUTED_AT", label: "반영 일시", width: 155, render: (value) => this.formatDate(value) },
                    { key: "EVENT_USER", label: "작업자", width: 110 },
                    { key: "CREATED_AT", label: "작업 일시", width: 155, render: (value) => this.formatDate(value) }
                ];
                content.innerHTML = `
                    ${this.buildGridHtml(visible, historyColumns, true)}
                    ${visible.length ? "" : `<div class="edit-work-empty is-grid-empty">조회할 에디팅 이력이 없습니다.</div>`}
                `;
                this.updateGridMeta(filtered);
                this.currentExport = {
                    filename: "editing-history.csv",
                    columns: historyColumns.map((column) => column.key),
                    rows: filtered
                };
            },

            setPanel(title, actionsHtml = "") {
                const titleEl = getContainerEl(`#panelTitle-${PAGE_CODE}`);
                const actions = getContainerEl(`#modeActions-${PAGE_CODE}`);
                if (titleEl) titleEl.textContent = title;
                if (actions) actions.innerHTML = actionsHtml;
                this.renderStageFilters();
                this.renderPanelSourceContext();
            },

            renderPanelSourceContext() {
                const context = getContainerEl(`#panelSourceContext-${PAGE_CODE}`);
                if (!context) return;
                const session = this.getSelectedSession();
                if (session) {
                    const source = `${session.TARGET_OWNER || "-"}.${session.SOURCE_TABLE || "-"}`;
                    const edit = `${session.TARGET_OWNER || "-"}.${session.EDIT_TABLE || "-"}`;
                    context.textContent = `SOURCE ${source} → EDIT ${edit}`;
                    context.title = this.showsExecutionHistorySelector()
                        ? `반영 이력 #${session.EDIT_SESSION_ID} · ${source} → ${edit}`
                        : `현재 작업 · ${source} → ${edit}`;
                    context.hidden = false;
                    return;
                }
                if (
                    this.stage.mode === "VIOLATIONS"
                    && this.selectedViolationRules.length
                ) {
                    const objects = [...new Set(
                        this.selectedViolationRules.map(
                            (rule) => `${rule.TARGET_OWNER || "-"}.${rule.TARGET_TABLE || "-"}`
                        )
                    )];
                    context.textContent = objects.length === 1
                        ? `OWNER · TABLE ${objects[0]} · RULE ${this.selectedViolationRules.length.toLocaleString()}개`
                        : `OWNER · TABLE ${objects.length.toLocaleString()}개 · RULE ${this.selectedViolationRules.length.toLocaleString()}개`;
                    context.title = objects.join(", ");
                    context.hidden = false;
                    return;
                }
                const sources = [...new Map(
                    this.rows
                        .filter((row) => row?.TARGET_OWNER && row?.TARGET_TABLE)
                        .map((row) => [
                            `${row.TARGET_OWNER}.${row.TARGET_TABLE}`,
                            { owner: row.TARGET_OWNER, table: row.TARGET_TABLE }
                        ])
                ).values()];
                if (!sources.length) {
                    context.hidden = true;
                    context.textContent = "";
                    return;
                }
                const fullText = sources.map((source) => `${source.owner}.${source.table}`).join(", ");
                context.textContent = sources.length === 1
                    ? `OWNER ${sources[0].owner} · TABLE ${sources[0].table}`
                    : `OWNER · TABLE ${sources.length}개`;
                context.title = fullText;
                context.hidden = false;
            },

            getStageFilterDefinitions() {
                const values = (key) => [...new Set(
                    this.rows
                        .map((row) => String(row?.[key] ?? "").trim())
                        .filter(Boolean)
                )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
                const definition = (key, labelKey, label, options) => ({ key, labelKey, label, options });
                switch (this.stage.mode) {
                    case "RULE_MASTER":
                        return [
                            definition("SOURCE_RULE_TYPE", "filterRuleType", "규칙 유형", ["ASSOCIATION", "SYMBOLIC", "USER"]),
                            definition("DECISION_STATUS", "filterDecisionStatus", "판단 상태", ["PENDING", "SELECTED", "REJECTED"])
                        ];
                    case "VIOLATIONS":
                        return [
                            definition("SOURCE_RULE_TYPE", "filterRuleType", "규칙 유형", ["ASSOCIATION", "SYMBOLIC"]),
                            definition("TARGET_COLUMN", "filterErrorColumn", "오류 컬럼", values("TARGET_COLUMN"))
                        ];
                    case "CHANGE_HISTORY":
                        return [
                            definition("COLUMN_NAME", "filterChangedColumn", "수정 컬럼", values("COLUMN_NAME")),
                            definition("EDITED_BY", "filterEditedBy", "작업자", values("EDITED_BY"))
                        ];
                    case "VALIDATION":
                        return [
                            definition("COLUMN_NAME", "filterChangedColumn", "변경 컬럼", values("COLUMN_NAME")),
                            definition("CHANGE_STATUS", "filterChangeStatus", "변경 상태", ["EDITED", "APPLIED", "FAILED", "CANCELLED"])
                        ];
                    case "FINAL_APPLY":
                        return [definition("DML_STATUS", "filterDmlStatus", "DML 상태", ["DRAFT", "APPROVED", "EXECUTED", "FAILED"])];
                    case "HISTORY":
                        return [
                            definition("EVENT_TYPE", "filterEventType", "이벤트", [
                                "RULE_DECISION",
                                "SESSION_CREATED",
                                "EDIT_TABLE_PREPARED",
                                "CELL_EDITED",
                                "EFFECT_VALIDATED",
                                "REANALYSIS_LINKED",
                                "DML_GENERATED",
                                "DML_SAVED",
                                "DML_APPROVED",
                                "DML_EXECUTED",
                                "DML_FAILED",
                                "DML_DELETED",
                                "EXECUTION_CANCELLED"
                            ]),
                            definition("ENTITY_TYPE", "filterEntityType", "대상 유형", ["EDIT_RULE", "EDIT_SESSION", "EDIT_CHANGE", "EDIT_DML"])
                        ];
                    default:
                        return [];
                }
            },

            renderStageFilters() {
                const host = getContainerEl(`#stageFilterTools-${PAGE_CODE}`);
                if (!host) return;
                if (this.stage.mode === "VIOLATIONS") {
                    this.renderEditingTableGrid();
                    const targetColumns = [...new Set(
                        this.violationRules
                            .map((rule) => String(rule.TARGET_COLUMN || "").trim().toUpperCase())
                            .filter(Boolean)
                    )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
                    const ruleOptions = this.getViolationRuleOptions();
                    const availableRuleIds = new Set(
                        ruleOptions.map((rule) => String(rule.EDIT_RULE_ID))
                    );
                    this.violationRuleScopeIds = new Set(
                        [...this.violationRuleScopeIds].filter((id) => availableRuleIds.has(String(id)))
                    );
                    const selectedScopeCount = this.violationRuleScopeIds.size;
                    const finalRuleSummary = selectedScopeCount
                        ? this.pageLabel("selectedFinalRules", "최종 규칙 {count}개 선택")
                            .replaceAll("{count}", selectedScopeCount.toLocaleString())
                        : `${this.pageLabel("allFinalRules", "전체 최종 규칙")} (${ruleOptions.length.toLocaleString()}개)`;
                    host.innerHTML = `
                        <label>
                            <span>${this.escapeHtml(this.pageLabel("filterRuleType", "규칙 유형"))}</span>
                            <select onchange="${PAGE_CODE}.handleViolationScopeFilter('VIOLATION_RULE_TYPE', this.value)">
                                <option value="ALL">${this.escapeHtml(this.pageLabel("filterAll", "전체"))}</option>
                                <option value="ASSOCIATION" ${this.stageFilters.VIOLATION_RULE_TYPE === "ASSOCIATION" ? "selected" : ""}>${this.escapeHtml(this.stageFilterOptionLabel("ASSOCIATION"))}</option>
                                <option value="SYMBOLIC" ${this.stageFilters.VIOLATION_RULE_TYPE === "SYMBOLIC" ? "selected" : ""}>${this.escapeHtml(this.stageFilterOptionLabel("SYMBOLIC"))}</option>
                            </select>
                        </label>
                        <label>
                            <span>${this.escapeHtml(this.pageLabel("filterErrorColumn", "오류 컬럼"))}</span>
                            <select onchange="${PAGE_CODE}.handleViolationScopeFilter('VIOLATION_TARGET_COLUMN', this.value)">
                                <option value="ALL">${this.escapeHtml(this.pageLabel("filterAll", "전체"))}</option>
                                ${targetColumns.map((column) => `
                                    <option value="${this.escapeHtml(column)}" ${this.stageFilters.VIOLATION_TARGET_COLUMN === column ? "selected" : ""}>
                                        ${this.escapeHtml(column)}
                                    </option>
                                `).join("")}
                            </select>
                        </label>
                        <label>
                            <span>${this.escapeHtml(this.pageLabel("filterEditStatus", "수정 상태"))}</span>
                            <select onchange="${PAGE_CODE}.handleViolationScopeFilter('VIOLATION_CHANGE_STATUS', this.value)">
                                <option value="ALL" ${String(this.stageFilters.VIOLATION_CHANGE_STATUS || "ALL") === "ALL" ? "selected" : ""}>${this.escapeHtml(this.pageLabel("filterAll", "전체"))}</option>
                                <option value="UNEDITED" ${this.stageFilters.VIOLATION_CHANGE_STATUS === "UNEDITED" ? "selected" : ""}>${this.escapeHtml(this.stageFilterOptionLabel("UNEDITED"))}</option>
                                <option value="APPLIED" ${this.stageFilters.VIOLATION_CHANGE_STATUS === "APPLIED" ? "selected" : ""}>${this.escapeHtml(this.stageFilterOptionLabel("APPLIED"))}</option>
                            </select>
                        </label>
                        <div class="edit-work-final-rule-filter">
                            <span>${this.escapeHtml(this.pageLabel("filterFinalRule", "최종 규칙"))}</span>
                            ${ruleOptions.length ? `
                                <details class="edit-work-rule-multi-select">
                                    <summary>${this.escapeHtml(finalRuleSummary)}</summary>
                                    <div class="edit-work-rule-multi-options">
                                        <label class="is-all-option">
                                            <input type="checkbox"
                                                   data-rule-scope="ALL"
                                                   ${selectedScopeCount ? "" : "checked"}
                                                   onchange="${PAGE_CODE}.toggleViolationRuleScope('ALL', this.checked, this)">
                                            <span>${this.escapeHtml(this.pageLabel("allFinalRules", "전체 최종 규칙"))} (${ruleOptions.length.toLocaleString()}개)</span>
                                        </label>
                                        ${ruleOptions.map((rule) => `
                                            <label>
                                                <input type="checkbox"
                                                       data-rule-scope="${this.escapeHtml(rule.EDIT_RULE_ID)}"
                                                       ${this.violationRuleScopeIds.has(String(rule.EDIT_RULE_ID)) ? "checked" : ""}
                                                       onchange="${PAGE_CODE}.toggleViolationRuleScope('${this.escapeHtml(rule.EDIT_RULE_ID)}', this.checked, this)">
                                                <span>${this.escapeHtml(this.violationRuleOptionLabel(rule))}</span>
                                            </label>
                                        `).join("")}
                                    </div>
                                </details>
                            ` : `
                                <div class="edit-work-final-rule-empty">
                                    ${this.escapeHtml(this.pageLabel("noFinalRules", "조회 가능한 최종 규칙이 없습니다."))}
                                </div>
                            `}
                        </div>
                    `;
                    host.hidden = false;
                    return;
                }
                if (this.usesEditingTableSelection()) {
                    this.renderEditingTableGrid();
                }
                const definitions = this.getStageFilterDefinitions();
                host.innerHTML = definitions.map((item) => `
                    <label>
                        <span>${this.escapeHtml(this.pageLabel(item.labelKey, item.label))}</span>
                        <select onchange="${PAGE_CODE}.handleStageFilter('${this.escapeHtml(item.key)}', this.value)">
                            <option value="ALL">${this.escapeHtml(this.pageLabel("filterAll", "전체"))}</option>
                            ${item.options.map((value) => `
                                <option value="${this.escapeHtml(value)}" ${String(this.stageFilters[item.key] || "ALL") === value ? "selected" : ""}>
                                    ${this.escapeHtml(this.stageFilterOptionLabel(value, item.key))}
                                </option>
                            `).join("")}
                        </select>
                    </label>
                `).join("");
                host.hidden = !definitions.length;
            },

            pageLabel(key, fallback) {
                return window.I18nManager?.tPage?.(PAGE_CODE, key, fallback) || fallback;
            },

            executionStatusLabel(value) {
                const labels = {
                    DRAFT: "준비 중",
                    EDITING: "오류 수정 중",
                    VALIDATED: "효과 검증 완료",
                    APPLY_READY: "운영 반영 준비",
                    APPLIED: "운영 반영 완료",
                    CANCELLED: "실행 취소"
                };
                const normalized = String(value || "").toUpperCase();
                return labels[normalized] || value || "-";
            },

            stageFilterOptionLabel(value, filterKey = "") {
                const normalized = String(value || "").toUpperCase();
                if (filterKey === "DML_STATUS") return this.dmlStatusLabel(normalized);
                const labels = {
                    ASSOCIATION: ["filterOptionAssociation", "연관 규칙"],
                    SYMBOLIC: ["filterOptionSymbolic", "수식 규칙"],
                    USER: ["filterOptionUser", "사용자 규칙"],
                    PENDING: ["filterOptionPending", "대기"],
                    SELECTED: ["filterOptionSelected", "선정"],
                    REJECTED: ["filterOptionRejected", "제외"],
                    UNEDITED: ["filterOptionUnedited", "미수정"],
                    EDITED: ["filterOptionEdited", "수정"],
                    APPLIED: ["filterOptionApplied", "적용"],
                    VALIDATED: ["filterOptionValidated", "검증 완료"],
                    APPLY_READY: ["filterOptionApplyReady", "운영 반영 준비"],
                    FAILED: ["filterOptionFailed", "실패"],
                    CANCELLED: ["filterOptionCancelled", "취소"],
                    DRAFT: ["filterOptionDraft", "작성 중"],
                    APPROVED: ["filterOptionApproved", "승인"],
                    EXECUTED: ["filterOptionExecuted", "실행 완료"]
                };
                const entry = labels[normalized];
                return entry ? this.pageLabel(entry[0], entry[1]) : String(value || "");
            },

            handleStageFilter(key, value) {
                this.stageFilters[key] = String(value || "ALL");
            },

            applyStageFilters() {
                this.page = 1;
                if (this.usesEditingTableSelection() && !this.getSelectedViolationSource()) {
                    CommonMessage.warn(
                        this.pageLabel("sourceTableRequired", "조회할 INITUP$ 원본 테이블을 반드시 선택하세요.")
                    );
                    return;
                }
                if (["RULE_MASTER", "CHANGE_HISTORY", "VALIDATION", "FINAL_APPLY", "HISTORY"].includes(this.stage.mode)) {
                    this.refresh();
                } else if (this.stage.mode === "VIOLATIONS") {
                    this.loadViolations().catch((error) => this.renderError(error));
                } else {
                    this.renderGrid();
                }
            },

            setKpis(items) {
                const panel = getContainerEl(`#kpiPanel-${PAGE_CODE}`);
                if (!panel) return;
                panel.innerHTML = items.map((item) => `
                    <article class="edit-work-kpi">
                        <b>${this.escapeHtml(item.value ?? 0)}</b>
                        <span>${this.escapeHtml(item.label || "")}</span>
                        <small>${this.escapeHtml(item.hint || "")}</small>
                    </article>
                `).join("");
            },

            renderGrid() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const { filtered, visible } = this.serverPaging
                    ? { filtered: [...this.rows], visible: [...this.rows] }
                    : this.getPagedRows(this.rows);
                content.innerHTML = `
                    ${this.gridColumns.length ? this.buildGridHtml(visible, this.gridColumns, true) : ""}
                    ${visible.length ? "" : `<div class="edit-work-empty is-grid-empty">조건에 맞는 데이터가 없습니다.</div>`}
                `;
                this.updateGridMeta(filtered);
                this.currentExport = {
                    filename: `${PAGE_CODE.toLowerCase()}-${this.stage.mode.toLowerCase()}.csv`,
                    columns: this.gridColumns.filter((column) => !String(column.key).startsWith("_")).map((column) => column.key),
                    rows: filtered
                };
                this.renderStageFilters();
                this.renderPanelSourceContext();
            },

            buildGridHtml(rows, columns, paged = true) {
                if (!this.freezeColumnsInitialized) {
                    this.freezeColumns = columns.some((column) => column.key === "_SELECT") ? 1 : 0;
                    this.freezeColumnsInitialized = true;
                }
                const freezeCount = Math.max(0, Math.min(Number(this.freezeColumns || 0), columns.length));
                const rowOffset = paged ? Math.max(0, (this.page - 1) * this.pageSize) : 0;
                const masterSelectable = this.stage.mode === "RULE_MASTER";
                const dmlSelectable = this.stage.mode === "FINAL_APPLY";
                return `
                    <table class="table-grid edit-work-grid"
                           data-grid-row-offset="${rowOffset}"
                           data-standard-grid-freeze-columns="${freezeCount}">
                        <colgroup>${columns.map((column) => `<col style="width:${Number(column.width || 120)}px">`).join("")}</colgroup>
                        <thead><tr>
                            ${columns.map((column) => `<th class="${column.headerClassName || ""}">${column.headerHtml || this.escapeHtml(column.label || "")}</th>`).join("")}
                        </tr></thead>
                        <tbody>
                            ${rows.map((row, rowIndex) => `
                                <tr class="${masterSelectable ? "is-master-selectable" : ""} ${dmlSelectable ? "is-dml-selectable" : ""} ${dmlSelectable && !row.EDIT_DML_ID ? "is-unsaved-dml-row" : ""} ${masterSelectable && String(row.USER_RULE_YN || "N").toUpperCase() === "Y" ? "is-user-rule-row" : ""} ${masterSelectable && String(row.EDIT_RULE_ID || "") === this.selectedMasterRuleId ? "is-selected-row" : ""} ${dmlSelectable && String(row.EDIT_DML_ID || "") === String(this.selectedDmlId || "") ? "is-selected-row" : ""} ${this.stage.mode === "DISCOVERED_RULES" && String(row.DECISION_STATUS || "").toUpperCase() === "SELECTED" ? "is-decision-selected-row" : ""} ${this.stage.mode === "VIOLATIONS" && String(row.CHANGE_STATUS || "").toUpperCase() === "APPLIED" ? "is-applied-row" : ""}"
                                    ${masterSelectable
                                        ? `data-edit-rule-id="${this.escapeHtml(row.EDIT_RULE_ID || "")}" onclick="${PAGE_CODE}.selectMasterRule(${Number(row.EDIT_RULE_ID || 0)})"`
                                        : (dmlSelectable ? `onclick="${PAGE_CODE}.selectDml(${rowIndex})"` : "")}>
                                    ${columns.map((column) => {
                                        const value = row[column.key];
                                        const html = typeof column.render === "function"
                                            ? column.render(value, row, paged ? rowIndex : rowIndex)
                                            : this.escapeHtml(value ?? "");
                                        return `<td class="${column.className || ""}" title="${this.escapeHtml(this.stripHtml(value ?? ""))}">${html}</td>`;
                                    }).join("")}
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                `;
            },

            getFilteredRows(rows = this.rows) {
                const keyword = String(this.keyword || "").trim().toUpperCase();
                const gridFilterKeys = new Set(
                    this.getStageFilterDefinitions().map((definition) => definition.key)
                );
                const filters = Object.entries(this.stageFilters || {})
                    .filter(([key, value]) => (
                        gridFilterKeys.has(key)
                        &&
                        value
                        && value !== "ALL"
                    ));
                return rows.filter((row) => {
                    if (filters.some(([key, value]) => String(row?.[key] ?? "") !== String(value))) return false;
                    if (!keyword) return true;
                    return Object.values(row || {}).some((value) => String(value ?? "").toUpperCase().includes(keyword));
                });
            },

            getPagedRows(rows = this.rows) {
                const filtered = this.getFilteredRows(rows);
                const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
                this.page = Math.min(Math.max(1, this.page), totalPages);
                const start = (this.page - 1) * this.pageSize;
                return { filtered, visible: filtered.slice(start, start + this.pageSize) };
            },

            getVisibleRows() {
                if (this.serverPaging) return [...this.rows];
                const filtered = this.getFilteredRows(this.rows);
                const start = (this.page - 1) * this.pageSize;
                return filtered.slice(start, start + this.pageSize);
            },

            updateGridMeta(filteredRows) {
                this.renderStageFilters();
                const total = this.serverPaging ? this.serverTotalRows : filteredRows.length;
                const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
                const safePage = Math.min(this.page, totalPages);
                const visibleCount = this.serverPaging
                    ? this.rows.length
                    : Math.min(this.pageSize, Math.max(0, filteredRows.length - ((safePage - 1) * this.pageSize)));
                const message = getContainerEl(`#gridMessage-${PAGE_CODE}`);
                if (message) {
                    message.textContent = total
                        ? `${safePage}페이지에서 ${visibleCount.toLocaleString()}건을 조회했습니다.`
                        : "조회된 데이터가 없습니다.";
                }
                CommonUtils.renderServerPager?.(getContainerEl(`#gridPager-${PAGE_CODE}`), {
                    visible: true,
                    page: safePage,
                    pageSize: this.pageSize,
                    totalPages,
                    totalLabel: `전체 ${total.toLocaleString()}건`,
                    pageSizes: [50, 100, 200, 500],
                    labels: {
                        ariaLabel: "그리드 페이징",
                        previousPage: "이전 페이지",
                        nextPage: "다음 페이지",
                        page: "Page",
                        go: "Go",
                        rowsPerPage: "페이지당 표시 건수"
                    },
                    onMove: (delta) => this.changePage(delta),
                    onGo: (page) => this.goToPage(page),
                    onPageSize: (pageSize) => this.handlePageSizeChange(pageSize),
                    trailingNumberControl: {
                        label: "틀 고정",
                        title: "No 열과 선택한 개수의 데이터 열을 가로 스크롤 중 고정합니다.",
                        value: this.freezeColumns,
                        min: 0,
                        max: 50,
                        onInput: (value) => this.handleFreezeChange(value)
                    }
                });
                getContainerEl(`#workContent-${PAGE_CODE}`)
                    ?.querySelectorAll("table.table-grid")
                    .forEach((table) => CommonUtils.applyStandardGridDefaults?.(table));
            },

            renderEmpty(message) {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (content) content.innerHTML = `<div class="edit-work-empty">${this.escapeHtml(message)}</div>`;
                this.updateGridMeta([]);
            },

            handleGridKeyword() {
                this.keyword = getContainerEl(`#gridKeyword-${PAGE_CODE}`)?.value || "";
                this.page = 1;
                if (this.stage.mode === "DISCOVERED_RULES") {
                    if (this.keywordTimer) clearTimeout(this.keywordTimer);
                    this.keywordTimer = setTimeout(() => {
                        this.loadDiscoveredRules().catch((error) => this.renderError(error));
                    }, 250);
                    return;
                }
                if (this.stage.mode === "VIOLATIONS") {
                    if (this.keywordTimer) clearTimeout(this.keywordTimer);
                    this.keywordTimer = setTimeout(() => {
                        this.loadViolations().catch((error) => this.renderError(error));
                    }, 250);
                    return;
                }
                if (this.stage.mode === "CHANGE_HISTORY") this.renderChangeHistoryContent();
                else if (this.stage.mode === "HISTORY") this.renderHistoryContent();
                else if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
                else if (this.stage.mode === "FINAL_APPLY") this.renderDmlContent();
                else this.renderGrid();
            },

            handleFreezeChange(value) {
                const parsed = Number.parseInt(value, 10);
                this.freezeColumns = Math.max(0, Math.min(50, Number.isFinite(parsed) ? parsed : 0));
                this.freezeColumnsInitialized = true;
                getContainerEl(`#workContent-${PAGE_CODE}`)
                    ?.querySelectorAll("table.table-grid")
                    .forEach((table) => {
                        table.dataset.standardGridFreezeColumns = String(this.freezeColumns);
                        CommonUtils.applyStandardGridFreeze?.(table, this.freezeColumns);
                    });
            },

            handlePageSizeChange(value) {
                this.pageSize = Math.max(1, Number(value || 100));
                this.page = 1;
                if (this.stage.mode === "DISCOVERED_RULES") {
                    this.loadDiscoveredRules().catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "VIOLATIONS") {
                    this.loadViolations().catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "CHANGE_HISTORY") this.renderChangeHistoryContent();
                else if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
                else if (this.stage.mode === "FINAL_APPLY") this.renderDmlContent();
                else if (this.stage.mode === "HISTORY") this.renderHistoryContent();
                else this.renderGrid();
            },

            goToPage(value) {
                const total = this.serverPaging ? this.serverTotalRows : this.getFilteredRows().length;
                const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
                const requestedPage = Number.parseInt(value, 10);
                this.page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));
                if (this.stage.mode === "DISCOVERED_RULES") {
                    this.loadDiscoveredRules().catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "VIOLATIONS") {
                    this.loadViolations().catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "CHANGE_HISTORY") this.renderChangeHistoryContent();
                else if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
                else if (this.stage.mode === "FINAL_APPLY") this.renderDmlContent();
                else if (this.stage.mode === "HISTORY") this.renderHistoryContent();
                else this.renderGrid();
            },

            changePage(delta) {
                const total = this.serverPaging ? this.serverTotalRows : this.getFilteredRows().length;
                const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
                this.page = Math.min(totalPages, Math.max(1, this.page + Number(delta || 0)));
                if (this.stage.mode === "DISCOVERED_RULES") {
                    this.loadDiscoveredRules().catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "VIOLATIONS") {
                    this.loadViolations().catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "CHANGE_HISTORY") this.renderChangeHistoryContent();
                else if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
                else if (this.stage.mode === "FINAL_APPLY") this.renderDmlContent();
                else if (this.stage.mode === "HISTORY") this.renderHistoryContent();
                else this.renderGrid();
            },

            exportCurrentGrid(format = "csv") {
                const columns = this.currentExport.columns || [];
                const rows = this.currentExport.rows || [];
                if (!columns.length || !rows.length) {
                    CommonMessage.warn("내보낼 데이터가 없습니다.");
                    return;
                }
                const exportRows = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])));
                const filename = String(this.currentExport.filename || "editing-data.csv").replace(/\.[^.]+$/, "");
                const timestamp = Date.now();
                if (String(format).toLowerCase() === "excel") {
                    CommonUtils.exportExcel(exportRows, filename, PAGE_CODE);
                    return;
                }
                if (String(format).toLowerCase() === "json") {
                    window.DataEditingSystem?.downloadBlob?.(
                        new Blob([JSON.stringify(exportRows, null, 2)], { type: "application/json;charset=utf-8" }),
                        `${filename}_${timestamp}.json`
                    );
                    return;
                }
                window.DataEditingSystem?.downloadCSV?.(exportRows, `${filename}_${timestamp}.csv`);
            },

            countBy(rows, key) {
                return rows.reduce((result, row) => {
                    const value = String(row?.[key] || "UNKNOWN").toUpperCase();
                    result[value] = (result[value] || 0) + 1;
                    return result;
                }, {});
            },

            renderColumnSummary(columnName, columnComment) {
                return `
                    <span class="edit-work-column-summary">
                        ${this.renderColumnRef(columnName, columnComment)}
                    </span>
                `;
            },

            getColumnComment(columnName, comments = {}) {
                const key = String(columnName || "").trim().toUpperCase();
                if (!key || !comments || typeof comments !== "object") return "";
                return String(comments[key] || "").trim();
            },

            renderColumnRef(columnName, comment = "") {
                const column = String(columnName || "").trim();
                const label = String(comment || "").trim();
                if (!column) return "-";
                if (!label) return `<b class="edit-work-column-id">${this.escapeHtml(column)}</b>`;
                return `<span class="edit-work-column-ref" title="${this.escapeHtml(`${column}: ${label}`)}"><b>${this.escapeHtml(column)}</b><small>${this.escapeHtml(label)}</small></span>`;
            },

            formatAssociationExpression(value) {
                return String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .replace(/\s+AND\s+/gi, " AND\n");
            },

            renderColumnAwareText(value, comments = {}) {
                const raw = String(value ?? "");
                if (!raw) return "";
                const pattern = /\b[A-Za-z][A-Za-z0-9_$#]{0,127}\b/g;
                let html = "";
                let lastIndex = 0;
                let match;
                while ((match = pattern.exec(raw)) !== null) {
                    const token = match[0];
                    const comment = this.getColumnComment(token, comments);
                    html += this.escapeHtml(raw.slice(lastIndex, match.index));
                    html += comment ? this.renderColumnRef(token, comment) : this.escapeHtml(token);
                    lastIndex = match.index + token.length;
                }
                html += this.escapeHtml(raw.slice(lastIndex));
                return html;
            },

            isContinuousRule(row) {
                const group = String(row?.RULE_GROUP_CODE || "").toUpperCase();
                const sourceType = String(row?.SOURCE_RULE_TYPE || "").toUpperCase();
                return group === "CONTINUOUS" || sourceType === "SYMBOLIC";
            },

            parseFeatureColumns(row) {
                const raw = row?.FEATURE_COLUMNS;
                let values = [];
                if (Array.isArray(raw)) {
                    values = raw;
                } else {
                    const text = String(raw || "").trim();
                    if (text.startsWith("[")) {
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed)) values = parsed;
                        } catch (_error) {
                            values = [];
                        }
                    }
                    if (!values.length && text) values = text.split(/[,;|\s]+/);
                }
                if (!values.length) {
                    const expressionTokens = String(row?.RULE_EXPRESSION || "").match(/\b[A-Za-z][A-Za-z0-9_$#]{0,127}\b/g) || [];
                    values = expressionTokens.filter((token) => this.getColumnComment(token, row?.COLUMN_COMMENTS || {}));
                }
                const target = String(row?.TARGET_COLUMN || "").toUpperCase();
                return [...new Set(values
                    .map((value) => String(value || "").trim().replace(/^["'\[\]\s]+|["'\[\]\s]+$/g, ""))
                    .filter((value) => value && value.toUpperCase() !== target)
                )];
            },

            renderFeatureColumns(row) {
                const features = this.parseFeatureColumns(row);
                if (!features.length) return `<span class="edit-work-muted">피처 정보 없음</span>`;
                return features.map((column) => `
                    <span class="edit-work-feature-chip">
                        ${this.renderColumnRef(column, this.getColumnComment(column, row?.COLUMN_COMMENTS || {}))}
                    </span>
                `).join("");
            },

            renderSymbolicFormulaPreview(value, row, index) {
                const expression = String(value || "-");
                return `
                    <button type="button" class="edit-work-rule-preview edit-work-symbolic-preview" title="클릭하여 수식 상세 보기" onclick="event.stopPropagation(); ${PAGE_CODE}.openRuleDetail(${index}, 'FORMULA')">
                        <span class="edit-work-formula-mark">f(X) =</span>
                        <span>${this.renderColumnAwareText(expression, row?.COLUMN_COMMENTS || {})}</span>
                    </button>
                `;
            },

            renderFeaturePreview(row, index) {
                return `
                    <button type="button" class="edit-work-rule-preview edit-work-feature-preview" title="클릭하여 입력 피처 상세 보기" onclick="event.stopPropagation(); ${PAGE_CODE}.openRuleDetail(${index}, 'FEATURES')">
                        ${this.renderFeatureColumns(row)}
                    </button>
                `;
            },

            renderTextPreview(value, index, key, title) {
                const text = value && typeof value === "object"
                    ? JSON.stringify(value)
                    : (String(value ?? "").trim() || "-");
                return `
                    <button type="button" class="edit-work-rule-preview" title="클릭하여 전체 내용 보기" onclick="${PAGE_CODE}.openRowTextDetail(${index}, '${key}', '${title}')">
                        ${this.escapeHtml(text)}
                    </button>
                `;
            },

            renderColumnAwarePreview(value, row, index, key, title) {
                const text = String(value ?? "").trim() || "-";
                return `
                    <button type="button" class="edit-work-rule-preview" title="클릭하여 전체 내용 보기" onclick="${PAGE_CODE}.openRowTextDetail(${index}, '${key}', '${title}', true)">
                        ${this.renderColumnAwareText(text, row?.COLUMN_COMMENTS || {})}
                    </button>
                `;
            },

            renderViolationRulePreview(value, row, index) {
                const text = String(value ?? "").trim() || "-";
                const comments = this.getViolationRuleDetailRow(row)?.COLUMN_COMMENTS || row?.COLUMN_COMMENTS || {};
                return `
                    <button type="button" class="edit-work-rule-preview" title="클릭하여 규칙 및 위반 결과 상세 보기" onclick="event.stopPropagation(); ${PAGE_CODE}.openViolationRuleDetail(${index})">
                        ${this.renderColumnAwareText(text, comments)}
                    </button>
                `;
            },

            getViolationRuleDetailRow(violation) {
                const masterRule = this.violationRules.find(
                    (rule) => Number(rule.EDIT_RULE_ID) === Number(violation?.EDIT_RULE_ID)
                ) || {};
                const sourceType = String(
                    masterRule.SOURCE_RULE_TYPE
                    || violation?.SOURCE_RULE_TYPE
                    || "ASSOCIATION"
                ).toUpperCase();
                return {
                    ...masterRule,
                    EDIT_RULE_ID: masterRule.EDIT_RULE_ID || violation?.EDIT_RULE_ID,
                    RULE_NAME: masterRule.RULE_NAME || violation?.RULE_NAME,
                    SOURCE_RULE_TYPE: sourceType,
                    RULE_GROUP_CODE: sourceType === "SYMBOLIC" ? "CONTINUOUS" : "CATEGORICAL",
                    RUN_ID: masterRule.SOURCE_RUN_ID ?? violation?.RUN_ID,
                    RULE_EXPRESSION: masterRule.RULE_EXPRESSION || violation?.CONDITION_TEXT || "",
                    TARGET_OWNER: masterRule.TARGET_OWNER || violation?.TARGET_OWNER,
                    TARGET_TABLE: masterRule.TARGET_TABLE || violation?.TARGET_TABLE,
                    TARGET_COLUMN: masterRule.TARGET_COLUMN || violation?.TARGET_COLUMN,
                    TARGET_COLUMN_COMMENT: masterRule.TARGET_COLUMN_COMMENT
                        || violation?.TARGET_COLUMN_COMMENT
                        || "",
                    COLUMN_COMMENTS: masterRule.COLUMN_COMMENTS || violation?.COLUMN_COMMENTS || {},
                    EXPECTED_VALUE: masterRule.EXPECTED_VALUE ?? violation?.EXPECTED_VALUE,
                    CONDITION_COUNT: masterRule.CONDITION_COUNT ?? masterRule.COMPLEXITY,
                    SOURCE_OBJECT_NAME: masterRule.SOURCE_OBJECT_NAME
                        || violation?.SOURCE_OBJECT_NAME
                        || ""
                };
            },

            openRowTextDetail(index, key, detailTitle, columnAware = false) {
                const row = (
                    this.stage.mode === "FINAL_APPLY"
                        ? this.getVisibleDmlRows()
                        : this.getVisibleRows()
                )[index];
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const title = getContainerEl(`#detailLayerTitle-${PAGE_CODE}`);
                const eyebrow = getContainerEl(`#detailLayerEyebrow-${PAGE_CODE}`);
                const body = getContainerEl(`#detailLayerBody-${PAGE_CODE}`);
                if (!row || !layer || !body) return;
                this.resetDetailDialogPosition();
                const rawValue = row?.[key];
                const value = rawValue && typeof rawValue === "object"
                    ? JSON.stringify(rawValue, null, 2)
                    : (String(rawValue ?? "").trim() || "-");
                const detailValue = columnAware && !this.isContinuousRule(row)
                    ? this.formatAssociationExpression(value)
                    : value;
                if (eyebrow) eyebrow.textContent = `${this.stage.shortTitle || this.stage.title} · DETAIL`;
                if (title) title.textContent = detailTitle || "상세 내용";
                body.innerHTML = `
                    <dl class="edit-work-detail-meta">
                        <div><dt>프로젝트</dt><dd>${this.escapeHtml(getContainerEl(`#projectId-${PAGE_CODE}`)?.selectedOptions?.[0]?.textContent?.trim?.() || "-")}</dd></div>
                        <div><dt>작업 이력 ID</dt><dd>${this.escapeHtml(row.EDIT_SESSION_ID ? `#${row.EDIT_SESSION_ID}` : (this.selectedSessionId ? `#${this.selectedSessionId}` : "-"))}</dd></div>
                        <div><dt>대상</dt><dd>${this.escapeHtml(row.RULE_NAME || row.DML_NAME || row.EVENT_TYPE || row.TARGET_COLUMN || "-")}</dd></div>
                        <div><dt>ID</dt><dd>${this.escapeHtml(row.EDIT_RULE_ID || row.EDIT_DML_ID || row.EDIT_EVENT_ID || row.VIOLATION_ID || "-")}</dd></div>
                    </dl>
                    <section class="edit-work-detail-rule is-focus">
                        <strong>${this.escapeHtml(detailTitle || "상세 내용")}</strong>
                        <pre>${columnAware ? this.renderColumnAwareText(detailValue, row.COLUMN_COMMENTS || {}) : this.escapeHtml(detailValue)}</pre>
                    </section>
                `;
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog > header button")?.focus();
            },

            renderRulePreview(value, row, index, section) {
                if (this.isContinuousRule(row)) {
                    if (section === "IF") return this.renderSymbolicFormulaPreview(row?.RULE_EXPRESSION, row, index);
                    return `
                        <button type="button" class="edit-work-rule-preview edit-work-target-preview" title="클릭하여 수식 상세 보기" onclick="event.stopPropagation(); ${PAGE_CODE}.openRuleDetail(${index}, 'TARGET')">
                            <span class="edit-work-formula-mark">예측 대상</span>
                            ${this.renderColumnRef(row?.TARGET_COLUMN || "-", row?.TARGET_COLUMN_COMMENT || "")}
                        </button>
                    `;
                }
                const text = String(value ?? "-");
                return `
                    <button type="button" class="edit-work-rule-preview" title="클릭하여 규칙 전체 보기" onclick="event.stopPropagation(); ${PAGE_CODE}.openRuleDetail(${index}, '${section}')">
                        ${this.renderColumnAwareText(text, row?.COLUMN_COMMENTS || {})}
                    </button>
                `;
            },

            buildAssociationRuleDetailContent(row, focusSection = "IF") {
                const thenText = row.RESULT_EXPRESSION
                    || (row.EXPECTED_VALUE !== null && row.EXPECTED_VALUE !== undefined
                        ? `${row.TARGET_COLUMN} = ${row.EXPECTED_VALUE}`
                        : "-");
                return `
                    <dl class="edit-work-detail-meta">
                        <div><dt>원본 테이블</dt><dd>${this.escapeHtml(row.TARGET_OWNER || "-")}.${this.escapeHtml(row.TARGET_TABLE || "-")}</dd></div>
                        <div><dt>결과 컬럼</dt><dd>${this.renderColumnRef(row.TARGET_COLUMN || "-", row.TARGET_COLUMN_COMMENT || "")}</dd></div>
                        <div><dt>모델/소스</dt><dd>${this.escapeHtml(row.SOURCE_OBJECT_NAME || "-")}</dd></div>
                        <div><dt>모델 유형</dt><dd>${this.escapeHtml(row.MODEL_TYPE || row.METHOD || "-")}</dd></div>
                    </dl>
                    <section class="edit-work-detail-rule ${focusSection === "IF" ? "is-focus" : ""}">
                        <strong>IF 조건 / 수식</strong>
                        <pre>${this.renderColumnAwareText(this.formatAssociationExpression(row.RULE_EXPRESSION || "-"), row.COLUMN_COMMENTS || {})}</pre>
                    </section>
                    <section class="edit-work-detail-rule ${focusSection === "THEN" ? "is-focus" : ""}">
                        <strong>THEN 결과</strong>
                        <pre>${this.renderColumnAwareText(thenText, row.COLUMN_COMMENTS || {})}</pre>
                    </section>
                    <dl class="edit-work-detail-metrics">
                        <div><dt>근거 건수</dt><dd>${Number(row.SUPPORT_COUNT || 0).toLocaleString()} / ${Number(row.SOURCE_TOTAL_COUNT || 0).toLocaleString()}</dd></div>
                        <div><dt>Support</dt><dd>${this.escapeHtml(this.formatMetric(row.RULE_SUPPORT))}</dd></div>
                        <div><dt>신뢰도</dt><dd>${this.escapeHtml(this.formatMetric(row.RULE_CONFIDENCE))}</dd></div>
                        <div><dt>Lift</dt><dd>${this.escapeHtml(this.formatMetric(row.RULE_LIFT))}</dd></div>
                        <div><dt>판단</dt><dd>${this.badge(row.DECISION_STATUS)}</dd></div>
                    </dl>
                `;
            },

            buildContinuousRuleDetailContent(row, focusSection = "FORMULA") {
                const comments = row.COLUMN_COMMENTS || {};
                const features = this.parseFeatureColumns(row);
                return `
                    <dl class="edit-work-detail-meta">
                        <div><dt>원본 테이블</dt><dd>${this.escapeHtml(row.TARGET_OWNER || "-")}.${this.escapeHtml(row.TARGET_TABLE || "-")}</dd></div>
                        <div><dt>예측 대상</dt><dd>${this.renderColumnRef(row.TARGET_COLUMN || "-", row.TARGET_COLUMN_COMMENT || "")}</dd></div>
                        <div><dt>방법</dt><dd>${this.escapeHtml(row.METHOD || row.MODEL_TYPE || "-")}</dd></div>
                        <div><dt>모델/소스</dt><dd>${this.escapeHtml(row.SOURCE_OBJECT_NAME || "-")}</dd></div>
                    </dl>
                    <section class="edit-work-symbolic-flow" aria-label="연속형 규칙 수식 흐름">
                        <div class="edit-work-symbolic-node is-features ${focusSection === "FEATURES" ? "is-focus" : ""}">
                            <small>INPUT FEATURES</small>
                            <strong>입력 피처 ${features.length}개</strong>
                            <div class="edit-work-feature-list">${this.renderFeatureColumns(row)}</div>
                        </div>
                        <i class="fas fa-arrow-right" aria-hidden="true"></i>
                        <div class="edit-work-symbolic-node is-formula ${focusSection === "FORMULA" || focusSection === "IF" ? "is-focus" : ""}">
                            <small>SYMBOLIC FORMULA</small>
                            <strong>f(X)</strong>
                            <pre>${this.renderColumnAwareText(row.RULE_EXPRESSION || "-", comments)}</pre>
                        </div>
                        <i class="fas fa-arrow-right" aria-hidden="true"></i>
                        <div class="edit-work-symbolic-node is-target ${focusSection === "TARGET" || focusSection === "THEN" ? "is-focus" : ""}">
                            <small>PREDICTION TARGET</small>
                            <strong>예측 대상</strong>
                            <div>${this.renderColumnRef(row.TARGET_COLUMN || "-", row.TARGET_COLUMN_COMMENT || "")}</div>
                        </div>
                    </section>
                    <section class="edit-work-detail-rule ${focusSection === "FORMULA" || focusSection === "IF" ? "is-focus" : ""}">
                        <strong>전체 수식</strong>
                        <pre><span class="edit-work-formula-mark">f(X) = </span>${this.renderColumnAwareText(row.RULE_EXPRESSION || "-", comments)}</pre>
                    </section>
                    <dl class="edit-work-detail-metrics is-symbolic">
                        <div><dt>Score</dt><dd>${this.escapeHtml(this.formatMetric(row.RULE_CONFIDENCE))}</dd></div>
                        <div><dt>복잡도</dt><dd>${this.escapeHtml(row.CONDITION_COUNT ?? "-")}</dd></div>
                        <div><dt>순위</dt><dd>${this.escapeHtml(row.RANK_NO ?? "-")}</dd></div>
                        <div><dt>입력 피처</dt><dd>${features.length.toLocaleString()}개</dd></div>
                        <div><dt>판단</dt><dd>${this.badge(row.DECISION_STATUS)}</dd></div>
                    </dl>
                    <p class="edit-work-detail-note">연속형 규칙은 IF/THEN 연관 규칙이 아니라 입력 피처를 수식 f(X)에 적용해 대상 컬럼을 예측하는 규칙입니다.</p>
                `;
            },

            openRuleDetail(index, focusSection = "IF") {
                const row = this.getVisibleRows()[index];
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const title = getContainerEl(`#detailLayerTitle-${PAGE_CODE}`);
                const eyebrow = getContainerEl(`#detailLayerEyebrow-${PAGE_CODE}`);
                const body = getContainerEl(`#detailLayerBody-${PAGE_CODE}`);
                if (!row || !layer || !body) return;
                this.resetDetailDialogPosition();
                if (this.isContinuousRule(row)) {
                    this.openContinuousRuleDetail(row, focusSection, { layer, title, eyebrow, body });
                    return;
                }
                if (eyebrow) eyebrow.textContent = `${row.RULE_GROUP_CODE || row.SOURCE_RULE_TYPE || "RULE"} · RUN #${row.RUN_ID || "-"}`;
                if (title) title.textContent = row.SOURCE_RULE_ID || row.RULE_NAME || "규칙 상세";
                body.innerHTML = this.buildAssociationRuleDetailContent(row, focusSection);
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog > header button")?.focus();
            },

            openContinuousRuleDetail(row, focusSection, elements) {
                const { layer, title, eyebrow, body } = elements;
                if (eyebrow) eyebrow.textContent = `연속형 수식 규칙 · RUN #${row.RUN_ID || "-"}`;
                if (title) title.textContent = row.SOURCE_RULE_ID || row.RULE_NAME || "수식 규칙 상세";
                body.innerHTML = this.buildContinuousRuleDetailContent(row, focusSection);
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog > header button")?.focus();
            },

            buildViolationResultDetailContent(violation, rule) {
                const isSymbolic = this.isContinuousRule(rule);
                const expectedLabel = isSymbolic ? "예측값" : "THEN 기대값";
                const expectedValue = isSymbolic
                    ? (violation.PREDICTED_VALUE ?? violation.EXPECTED_VALUE)
                    : violation.EXPECTED_VALUE;
                const currentValue = violation.CURRENT_VALUE ?? violation.ACTUAL_VALUE;
                return `
                    <section class="edit-work-violation-detail">
                        <header>
                            <div>
                                <small>LIVE VIOLATION RESULT</small>
                                <strong>위반 조회 결과</strong>
                            </div>
                            ${this.badge(violation.CHANGE_STATUS || "UNEDITED")}
                        </header>
                        <dl class="edit-work-detail-meta">
                            <div><dt>행 식별값</dt><dd>${this.escapeHtml(violation.CASE_ID || "-")}</dd></div>
                            <div><dt>오류 컬럼</dt><dd>${this.renderColumnRef(violation.TARGET_COLUMN || "-", violation.TARGET_COLUMN_COMMENT || "")}</dd></div>
                            <div><dt>${expectedLabel}</dt><dd>${this.escapeHtml(expectedValue ?? "-")}</dd></div>
                            <div><dt>실제값</dt><dd class="is-violation-value">${this.escapeHtml(violation.ACTUAL_VALUE ?? "-")}</dd></div>
                        </dl>
                        <dl class="edit-work-detail-metrics is-violation">
                            <div><dt>위반 점수</dt><dd>${this.escapeHtml(this.formatMetric(violation.VIOLATION_SCORE))}</dd></div>
                            <div><dt>절대 오차</dt><dd>${isSymbolic ? this.escapeHtml(this.formatMetric(violation.ABS_ERROR)) : "-"}</dd></div>
                            <div><dt>오차율</dt><dd>${isSymbolic ? this.escapeHtml(this.formatPercent(violation.ERROR_PCT)) : "-"}</dd></div>
                            <div><dt>INITDN$ 수정값</dt><dd>${this.escapeHtml(currentValue ?? "-")}</dd></div>
                            <div><dt>수정 상태</dt><dd>${this.badge(violation.CHANGE_STATUS || "UNEDITED")}</dd></div>
                        </dl>
                        <section class="edit-work-detail-rule is-violation-reason">
                            <strong>위반 사유</strong>
                            <pre>${this.escapeHtml(violation.VIOLATION_REASON || "-")}</pre>
                        </section>
                    </section>
                `;
            },

            openViolationRuleDetail(index) {
                const violation = this.getVisibleRows()[index];
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const title = getContainerEl(`#detailLayerTitle-${PAGE_CODE}`);
                const eyebrow = getContainerEl(`#detailLayerEyebrow-${PAGE_CODE}`);
                const body = getContainerEl(`#detailLayerBody-${PAGE_CODE}`);
                if (!violation || !layer || !body) return;
                const rule = this.getViolationRuleDetailRow(violation);
                const isSymbolic = this.isContinuousRule(rule);
                this.resetDetailDialogPosition();
                if (eyebrow) {
                    eyebrow.textContent = `${isSymbolic ? "연속형 수식 규칙" : "범주형 연관 규칙"} · LIVE VIOLATION`;
                }
                if (title) title.textContent = rule.SOURCE_RULE_ID || rule.RULE_NAME || "규칙 및 위반 결과 상세";
                body.innerHTML = `
                    ${isSymbolic
                        ? this.buildContinuousRuleDetailContent(rule, "FORMULA")
                        : this.buildAssociationRuleDetailContent(rule, "IF")}
                    ${this.buildViolationResultDetailContent(violation, rule)}
                `;
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog > header button")?.focus();
            },

            closeDetailLayer(event) {
                if (event && event.target !== event.currentTarget) return;
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const opener = this.detailLayerOpener;
                this.detailLayerOpener = null;
                this.endDetailLayerDrag();
                if (layer) layer.hidden = true;
                this.resetDetailDialogPosition();
                if (this.initialized && opener?.isConnected) {
                    window.requestAnimationFrame(() => opener.focus());
                }
            },

            handleDetailLayerKeydown(event) {
                if (event?.key !== "Escape") return;
                event.preventDefault();
                this.closeDetailLayer();
            },

            startDetailLayerDrag(event) {
                if (!event || event.button !== 0 || event.target?.closest("button")) return;
                if (window.matchMedia?.("(max-width: 720px)")?.matches) return;
                const dialog = event.currentTarget?.closest(".edit-work-detail-dialog");
                if (!dialog) return;
                const rect = dialog.getBoundingClientRect();
                dialog.style.position = "fixed";
                dialog.style.left = `${rect.left}px`;
                dialog.style.top = `${rect.top}px`;
                dialog.style.margin = "0";
                dialog.style.transform = "none";
                const drag = {
                    dialog,
                    startX: event.clientX,
                    startY: event.clientY,
                    left: rect.left,
                    top: rect.top
                };
                drag.move = (moveEvent) => this.moveDetailLayerDrag(moveEvent);
                drag.end = () => this.endDetailLayerDrag();
                this.detailDrag = drag;
                window.addEventListener("pointermove", drag.move);
                window.addEventListener("pointerup", drag.end, { once: true });
                window.addEventListener("pointercancel", drag.end, { once: true });
                event.preventDefault();
            },

            moveDetailLayerDrag(event) {
                const drag = this.detailDrag;
                if (!drag?.dialog || !event) return;
                const rect = drag.dialog.getBoundingClientRect();
                const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
                const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
                const left = Math.min(maxLeft, Math.max(8, drag.left + event.clientX - drag.startX));
                const top = Math.min(maxTop, Math.max(8, drag.top + event.clientY - drag.startY));
                drag.dialog.style.left = `${left}px`;
                drag.dialog.style.top = `${top}px`;
            },

            endDetailLayerDrag() {
                const drag = this.detailDrag;
                if (!drag) return;
                window.removeEventListener("pointermove", drag.move);
                window.removeEventListener("pointerup", drag.end);
                window.removeEventListener("pointercancel", drag.end);
                this.detailDrag = null;
            },

            resetDetailDialogPosition() {
                const dialog = getContainerEl(`#detailLayer-${PAGE_CODE} .edit-work-detail-dialog`);
                if (!dialog) return;
                ["position", "left", "top", "margin", "transform"].forEach((property) => dialog.style.removeProperty(property));
            },

            badge(value) {
                const text = String(value ?? "-");
                const className = text.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
                return `<span class="edit-work-badge is-${className}">${this.escapeHtml(text)}</span>`;
            },

            dmlStatusLabel(value) {
                const status = String(value || "").toUpperCase();
                const labels = {
                    UNSAVED: this.pageLabel("dmlStatusUnsaved", "미저장"),
                    DRAFT: this.pageLabel("dmlStatusDraft", "저장"),
                    APPROVED: this.pageLabel("dmlStatusValidatedSaved", "검증·저장"),
                    EXECUTED: this.pageLabel("dmlStatusExecuted", "실행 완료"),
                    FAILED: this.pageLabel("dmlStatusFailed", "실행 실패")
                };
                return labels[status] || value || "-";
            },

            dmlStatusBadge(value) {
                const status = String(value || "").toUpperCase();
                const className = status.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
                return `<span class="edit-work-badge is-${className}">${this.escapeHtml(this.dmlStatusLabel(status))}</span>`;
            },

            renderRuleTypeBadge(value) {
                const normalized = String(value || "").toUpperCase();
                const labels = {
                    ASSOCIATION: this.pageLabel("filterOptionAssociation", "연관 규칙"),
                    SYMBOLIC: this.pageLabel("filterOptionSymbolic", "수식 규칙"),
                    USER: this.pageLabel("filterOptionUser", "사용자 규칙")
                };
                return this.badge(labels[normalized] || value);
            },

            formatMetric(value) {
                const number = Number(value);
                return Number.isFinite(number) ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "-";
            },

            formatPercent(value) {
                const number = Number(value);
                return Number.isFinite(number)
                    ? `${(number * 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`
                    : "-";
            },

            formatDate(value) {
                if (!value) return "-";
                const date = new Date(value);
                return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
            },

            optionalNumber(value) {
                if (value === null || value === undefined || String(value).trim() === "") return null;
                const number = Number(value);
                return Number.isFinite(number) ? number : null;
            },

            stripHtml(value) {
                return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            },

            escapeHtml(value) {
                return String(value ?? "")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            }
        };

        window[PAGE_CODE] = page;
        return page;
    };

    window.MCOMMON.initEditWorkPage = function(pageCode, config = {}) {
        if (window[pageCode] && typeof window[pageCode].init === "function") return window[pageCode];
        return window.MCOMMON.createEditWorkPage({ ...config, pageCode });
    };
})();
