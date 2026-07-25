(function() {
    if (!window.MCOMMON) window.MCOMMON = {};

    const EDIT_CONTEXT_KEY = "INIT_EDIT_WORK_CONTEXT";
    const STAGES = Object.freeze([
        { pageCode: "M05001", step: "01", title: "발굴 규칙 판단", shortTitle: "규칙 판단", icon: "fa-list-check", mode: "DISCOVERED_RULES", description: "발굴된 규칙을 검토하고 편집 규칙으로 최종 선정하거나 제외합니다." },
        { pageCode: "M05001_RULE_MASTER", step: "02", title: "편집 규칙 마스터", shortTitle: "규칙 마스터", icon: "fa-clipboard-check", mode: "RULE_MASTER", description: "선정 규칙과 사용자 정의 규칙을 통합 관리합니다." },
        { pageCode: "M05002", step: "03", title: "위반 데이터 워크벤치", shortTitle: "위반 조회", icon: "fa-triangle-exclamation", mode: "VIOLATIONS", description: "선정된 규칙의 위반 행을 조회하고 편집 대상으로 묶습니다." },
        { pageCode: "M05002_CLEANSING", step: "04", title: "INITDN 편집 배치", shortTitle: "오류 수정", icon: "fa-eraser", mode: "CLEANSING", description: "INITUP$ 원본을 보존하고 INITDN$ 편집본에서 오류 값을 수정합니다." },
        { pageCode: "M05003", step: "05", title: "에디팅 효과 검증", shortTitle: "효과 검증", icon: "fa-chart-column", mode: "VALIDATION", description: "변경 효과를 확인하고 INITDN$ 기준 Flow 재분석 결과를 연결합니다." },
        { pageCode: "M05003_FINAL_APPLY", step: "06", title: "운영 반영 DML", shortTitle: "운영 반영", icon: "fa-database", mode: "FINAL_APPLY", description: "검증된 변경으로 DML을 생성·승인하고 최종 운영 데이터에 반영합니다." },
        { pageCode: "M05003_HISTORY", step: "07", title: "에디팅 감사 이력", shortTitle: "전체 이력", icon: "fa-clock-rotate-left", mode: "HISTORY", description: "규칙 판단부터 최종 반영까지 모든 에디팅 이벤트를 조회합니다." }
    ]);
    const STAGE_MAP = Object.freeze({
        ...Object.fromEntries(STAGES.map((stage) => [stage.pageCode, stage])),
        M06001: STAGES[2],
        M06002: STAGES[3],
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
            { stageCode: "M05002", labelKey: "violationQueryTab", label: "위반 조회", icon: "fa-triangle-exclamation" },
            { stageCode: "M05002_CLEANSING", labelKey: "dataCleansingTab", label: "오류 수정", icon: "fa-eraser" }
        ]),
        M05003: Object.freeze([
            { stageCode: "M05003", labelKey: "effectValidationTab", label: "효과 검증", icon: "fa-chart-column" },
            { stageCode: "M05003_FINAL_APPLY", labelKey: "finalApplyTab", label: "운영 반영", icon: "fa-database" },
            { stageCode: "M05003_HISTORY", labelKey: "editingHistoryTab", label: "전체 이력", icon: "fa-clock-rotate-left" }
        ])
    });

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
            selectedSessionId: "",
            selectedDmlId: "",
            selectedDml: null,
            currentValidation: null,
            page: 1,
            pageSize: 100,
            keyword: "",
            freezeColumns: 0,
            ruleRunSource: "",
            ruleRunId: "",
            ruleGroup: "ALL",
            ruleDecisionStatus: "ALL",
            stageFilters: {},
            serverPaging: false,
            serverTotalRows: 0,
            keywordTimer: null,
            ruleRequestId: 0,
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
            violationRules: [],
            selectedViolationRuleId: "",
            selectedViolationRule: null,
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
                if (currentProjectId === nextProjectId && currentScenarioId === nextScenarioId) return;

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
                this.initialized = false;
                this.closeDetailLayer();
                this.rows = [];
                this.sessions = [];
                this.selectedRuleIds = new Set();
                this.violationRules = [];
                this.selectedViolationRuleId = "";
                this.selectedViolationRule = null;
                this.generatedViolationSql = "";
                this.editingWorkStarting = false;
                this.currentValidation = null;
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
                this.ruleRunSource = "";
                this.ruleRunId = "";
                this.ruleGroup = "ALL";
                this.ruleDecisionStatus = "ALL";
                this.stageFilters = {};
                this.serverPaging = false;
                this.serverTotalRows = 0;
                this.selectedRuleIds = new Set();
                this.selectedDml = null;
                this.selectedDmlId = "";
                this.userRuleValidation = null;
                this.selectedMasterRule = null;
                this.selectedMasterRuleId = "";
                this.editingUserRuleId = null;
                this.userRuleCopyMode = false;
                this.violationRules = [];
                this.selectedViolationRuleId = "";
                this.selectedViolationRule = null;
                this.generatedViolationSql = "";
                this.editingWorkStarting = false;
                this.masterSelectionRequestId += 1;
                this.refreshPromise = null;
                this.workspaceSwitching = false;
                this.editWorkspaceCache = new Map();
            },

            readPendingContext() {
                const legacyContextKeys = {
                    M05002: ["M06001:editContext", "M06002:editContext"],
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
                    const liveViolationMode = ["VIOLATIONS", "CLEANSING"].includes(this.stage.mode);
                    keyword.placeholder = this.stage.mode === "DISCOVERED_RULES"
                        ? "컬럼 ID·규칙 ID·IF·THEN 검색"
                        : (liveViolationMode ? "행 식별값·실제값 검색" : "현재 목록 검색");
                    keyword.title = this.stage.mode === "DISCOVERED_RULES"
                        ? "전체 발굴 규칙을 서버 SQL로 검색합니다."
                        : (liveViolationMode
                            ? "선택한 최종 규칙의 실제 테이블 위반 행을 서버 SQL로 검색합니다."
                            : "현재 조회된 목록에서 검색합니다.");
                }
                const sessionContext = getContainerEl(".edit-work-session-context");
                if (sessionContext) {
                    sessionContext.hidden = !this.usesEditSession();
                }
                const sourceContext = getContainerEl(`#sourceContext-${PAGE_CODE}`);
                if (sourceContext) sourceContext.hidden = !this.usesEditSession();
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
                    ruleRunSource: this.ruleRunSource,
                    ruleRunId: this.ruleRunId,
                    ruleGroup: this.ruleGroup,
                    ruleDecisionStatus: this.ruleDecisionStatus,
                    stageFilters: { ...this.stageFilters },
                    serverPaging: this.serverPaging,
                    serverTotalRows: this.serverTotalRows,
                    selectedRuleIds: new Set(this.selectedRuleIds),
                    violationRules: this.violationRules,
                    selectedViolationRuleId: this.selectedViolationRuleId,
                    selectedViolationRule: this.selectedViolationRule,
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
                this.ruleRunSource = snapshot.ruleRunSource || "";
                this.ruleRunId = snapshot.ruleRunId || "";
                this.ruleGroup = snapshot.ruleGroup || "ALL";
                this.ruleDecisionStatus = snapshot.ruleDecisionStatus || "ALL";
                this.stageFilters = { ...(snapshot.stageFilters || {}) };
                this.serverPaging = Boolean(snapshot.serverPaging);
                this.serverTotalRows = Number(snapshot.serverTotalRows || 0);
                this.selectedRuleIds = new Set(snapshot.selectedRuleIds || []);
                this.violationRules = snapshot.violationRules || [];
                this.selectedViolationRuleId = snapshot.selectedViolationRuleId || "";
                this.selectedViolationRule = snapshot.selectedViolationRule || null;
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
                    this.stageFilters = {};
                    this.serverPaging = false;
                    this.serverTotalRows = 0;
                    this.rows = [];
                    this.gridColumns = [];
                    this.selectedRuleIds.clear();
                    this.violationRules = [];
                    this.selectedViolationRuleId = "";
                    this.selectedViolationRule = null;
                    this.generatedViolationSql = "";
                    this.selectedMasterRule = null;
                    this.selectedMasterRuleId = "";
                    this.editingUserRuleId = null;
                    this.userRuleCopyMode = false;
                    this.currentValidation = null;
                    this.selectedDmlId = "";
                    this.selectedDml = null;
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
                    <option value="">편집 세션 선택</option>
                    ${this.sessions.map((session) => `
                        <option value="${this.escapeHtml(session.EDIT_SESSION_ID)}">
                            #${this.escapeHtml(session.EDIT_SESSION_ID)} · [${this.escapeHtml(session.SESSION_STATUS || "-")}] ${this.escapeHtml(session.SESSION_NAME || session.EDIT_TABLE)}
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

            renderSourceContext() {
                const el = getContainerEl(`#sourceContext-${PAGE_CODE}`);
                if (!el) return;
                const session = this.getSelectedSession();
                if (session) {
                    el.innerHTML = `<b>${this.escapeHtml(session.TARGET_OWNER)}.${this.escapeHtml(session.SOURCE_TABLE)}</b> → <b>${this.escapeHtml(session.TARGET_OWNER)}.${this.escapeHtml(session.EDIT_TABLE)}</b>`;
                    return;
                }
                const owner = this.pendingContext.targetOwner || "";
                const table = this.pendingContext.targetTable || "";
                const runId = this.pendingContext.runId || "";
                el.textContent = owner && table ? `${owner}.${table}${runId ? ` · Run #${runId}` : ""}` : "규칙 또는 편집 세션을 선택하세요.";
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
                this.stageFilters = {};
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
                this.selectedViolationRuleId = "";
                this.selectedViolationRule = null;
                this.generatedViolationSql = "";
                this.selectedRuleIds.clear();
                this.page = 1;
            },

            usesEditSession() {
                return !["DISCOVERED_RULES", "RULE_MASTER"].includes(this.stage.mode);
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
                    this.setLoading();
                    try {
                        switch (this.stage.mode) {
                            case "DISCOVERED_RULES":
                                await this.loadDiscoveredRules();
                                break;
                            case "RULE_MASTER":
                                await this.loadRuleMaster();
                                break;
                            case "VIOLATIONS":
                                await this.loadViolations(false);
                                break;
                            case "CLEANSING":
                                await this.loadViolations(true);
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
                const progress = getContainerEl(`#ruleQueryProgress-${PAGE_CODE}`);
                if (!progress) return;
                progress.hidden = !loading;
            },

            setWorkActionLoading(loading, message = "") {
                this.setRuleQueryLoading(loading);
                const progress = getContainerEl(`#ruleQueryProgress-${PAGE_CODE}`);
                if (progress) {
                    progress.title = loading ? message : "";
                    progress.setAttribute("aria-label", loading ? message : "");
                    progress.classList.toggle("is-work-action", Boolean(loading));
                }
                const actions = getContainerEl(`#modeActions-${PAGE_CODE}`);
                actions?.querySelector(".edit-work-action-status")?.remove();
                if (loading && actions) {
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
                this.setPanel("편집 규칙 마스터", `<button type="button" class="is-primary" onclick="${PAGE_CODE}.startNewUserRule()"><i class="fas fa-plus"></i>사용자 규칙 등록</button>`);
                this.renderUserRuleForm();
                const sourceType = String(this.stageFilters.SOURCE_RULE_TYPE || "ALL").toUpperCase();
                const commonColumns = [
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
                const selected = this.rows.filter((row) => this.selectedRuleIds.has(this.ruleRowKey(row)));
                if (!selected.length) {
                    CommonMessage.warn("처리할 규칙을 선택하세요.");
                    return;
                }
                if (!(await CommonMessage.confirm(`${selected.length}개 규칙을 ${status === "SELECTED" ? "선정" : "제외"} 처리할까요?`))) return;
                for (const row of selected) {
                    await this.submitRuleDecision(row, status);
                }
                this.invalidateEditWorkspaceCache("M05001_RULE_MASTER");
                this.selectedRuleIds.clear();
                CommonMessage.success(`${selected.length}개 규칙을 ${status === "SELECTED" ? "선정" : "제외"} 처리했습니다.`);
                await this.refresh();
            },

            async saveRuleDecision(index, status) {
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
                    projectId: this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value),
                    scenarioId: this.optionalNumber(getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value),
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
                await CommonUtils.request(apiUrl("/rules"), { method: "POST", body: payload, showLoading: false });
            },

            async loadViolations(forEditing) {
                const params = this.contextParams();
                const session = this.getSelectedSession();
                if (forEditing && session) params.set("editSessionId", session.EDIT_SESSION_ID);
                if (this.selectedViolationRuleId) params.set("editRuleId", this.selectedViolationRuleId);
                if (this.keyword) params.set("keyword", this.keyword);
                params.set("page", String(this.page));
                params.set("pageSize", String(this.pageSize));
                this.setWorkActionLoading(
                    true,
                    this.pageLabel("liveViolationLoading", "실시간 위반 데이터를 조회하고 있습니다.")
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
                this.selectedViolationRuleId = String(this.selectedViolationRule?.EDIT_RULE_ID || "");
                this.generatedViolationSql = String(json.generatedSql || "");
                this.selectedRuleIds.clear();
                if (this.selectedViolationRuleId) this.selectedRuleIds.add(this.selectedViolationRuleId);
                this.rows = (Array.isArray(json.data) ? json.data : []).map((row) => ({
                    ...(this.selectedViolationRule || {}),
                    ...row,
                    TARGET_COLUMN_COMMENT: row.TARGET_COLUMN_COMMENT
                        || row.COLUMN_COMMENTS?.[row.TARGET_COLUMN]
                        || ""
                }));
                const changed = this.rows.filter((row) => row.CHANGE_STATUS && row.CHANGE_STATUS !== "UNEDITED").length;
                const selectedRuleType = String(this.selectedViolationRule?.SOURCE_RULE_TYPE || "").toUpperCase();
                const selectedRuleLabel = selectedRuleType === "SYMBOLIC" ? "수식 규칙" : "연관 규칙";
                this.setKpis([
                    { value: this.serverTotalRows, label: "실시간 위반 행", hint: "INITUP$ 실제 테이블 DB 페이징" },
                    { value: this.violationRules.length, label: "최종 활성 규칙", hint: "M05001 규칙 마스터 SELECTED · ACTIVE" },
                    { value: this.selectedViolationRule ? selectedRuleLabel : "-", label: "조회 규칙", hint: this.selectedViolationRule?.RULE_NAME || "최종 규칙을 선택하세요." },
                    { value: changed, label: "수정된 행", hint: session ? `Session #${session.EDIT_SESSION_ID}` : "편집 세션 미선택" },
                    { value: session?.SESSION_STATUS || "LIVE", label: "조회 상태", hint: session ? `${session.EDIT_TABLE}` : "실제 원본 테이블 실시간 조회" }
                ]);
                if (forEditing) {
                    const retryAction = session?.SESSION_STATUS === "DRAFT"
                        ? `<button type="button" onclick="${PAGE_CODE}.retryPrepareCurrentSession()"><i class="fas fa-rotate"></i>${this.escapeHtml(this.pageLabel("buttonRetryEditingWork", "편집 작업 준비 재시도"))}</button>`
                        : "";
                    const deleteAction = session && ["DRAFT", "EDITING"].includes(String(session.SESSION_STATUS || "").toUpperCase())
                        ? `<button type="button" class="is-danger" onclick="${PAGE_CODE}.deleteCurrentEditingWork()"><i class="fas fa-trash"></i>${this.escapeHtml(this.pageLabel("buttonDeleteEditingWork", "편집 작업 삭제"))}</button>`
                        : "";
                    this.setPanel("최종 규칙 실시간 위반 데이터 · INITDN$ 오류 수정", `
                        <button type="button" title="${this.escapeHtml(this.pageLabel("liveSqlHelp", "조회에 사용되는 서버 생성 SQL을 확인합니다. 이 버튼은 SQL을 다시 실행하지 않습니다."))}" onclick="${PAGE_CODE}.openGeneratedViolationSql()" ${this.generatedViolationSql ? "" : "disabled"}><i class="fas fa-code"></i>실시간 SQL</button>
                        ${retryAction}
                        ${deleteAction}
                        <button type="button" class="is-primary" onclick="${PAGE_CODE}.navigateStage('M05003')"><i class="fas fa-chart-column"></i>효과 검증</button>
                    `);
                } else {
                    this.setPanel("최종 규칙 실시간 위반 데이터", `
                        <button type="button" title="${this.escapeHtml(this.pageLabel("liveSqlHelp", "조회에 사용되는 서버 생성 SQL을 확인합니다. 이 버튼은 SQL을 다시 실행하지 않습니다."))}" onclick="${PAGE_CODE}.openGeneratedViolationSql()" ${this.generatedViolationSql ? "" : "disabled"}><i class="fas fa-code"></i>실시간 SQL</button>
                        <button type="button" class="is-primary" onclick="${PAGE_CODE}.createSessionFromSelectedRules()"><i class="fas fa-layer-group"></i>${this.escapeHtml(this.pageLabel("buttonStartEditingWork", "편집 작업 시작"))}</button>
                    `);
                }
                this.hideModeForm();
                const expectedValueLabel = selectedRuleType === "SYMBOLIC"
                    ? "예측값"
                    : "THEN 결과";
                this.gridColumns = [
                    { key: "SOURCE_RULE_TYPE", label: "규칙 유형", width: 82, render: (value) => this.renderRuleTypeBadge(value) },
                    { key: "RULE_NAME", label: "최종 규칙명", width: 180, render: (value, _row, index) => this.renderTextPreview(value, index, "RULE_NAME", "최종 규칙") },
                    { key: "CASE_ID", label: "행 식별값", width: 130, className: "is-code" },
                    { key: "TARGET_COLUMN", label: "오류 컬럼", width: 135, className: "is-code", render: (value, row) => this.renderColumnSummary(value, row.TARGET_COLUMN_COMMENT) },
                    { key: "CONDITION_TEXT", label: "최종 규칙 (IF / f(X))", width: 300, className: "is-rule-detail", render: (value, row, index) => this.renderColumnAwarePreview(value, row, index, "CONDITION_TEXT", "최종 규칙") },
                    { key: "EXPECTED_VALUE", label: expectedValueLabel, width: 120 },
                    { key: "ACTUAL_VALUE", label: "실제값", width: 120 },
                    ...(selectedRuleType === "SYMBOLIC" ? [
                        { key: "ABS_ERROR", label: "절대 오차", width: 105, className: "is-number", render: (value) => this.formatMetric(value) },
                        { key: "ERROR_PCT", label: "오차율", width: 92, className: "is-number", render: (value) => this.formatPercent(value) }
                    ] : []),
                    { key: "VIOLATION_SCORE", label: "위반 점수", width: 88, className: "is-number", render: (value) => this.formatMetric(value) },
                    { key: "VIOLATION_REASON", label: "위반 사유", width: 280, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "VIOLATION_REASON", "위반 사유") },
                    { key: "CHANGE_STATUS", label: "수정 상태", width: 90, render: (value) => this.badge(value || "UNEDITED") },
                    ...(forEditing ? [{
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
                const ruleType = String(this.stageFilters.VIOLATION_RULE_TYPE || "ALL").toUpperCase();
                const targetColumn = String(this.stageFilters.VIOLATION_TARGET_COLUMN || "ALL").toUpperCase();
                return this.violationRules.filter((rule) => {
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

            handleViolationScopeFilter(key, value) {
                this.stageFilters[key] = String(value || "ALL");
                const options = this.getViolationRuleOptions();
                if (!options.some((rule) => String(rule.EDIT_RULE_ID) === this.selectedViolationRuleId)) {
                    this.selectedViolationRuleId = String(options[0]?.EDIT_RULE_ID || "");
                }
                this.renderStageFilters();
            },

            selectViolationRule(value) {
                this.selectedViolationRuleId = String(value || "");
                this.page = 1;
            },

            openGeneratedViolationSql() {
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                const title = getContainerEl(`#detailLayerTitle-${PAGE_CODE}`);
                const eyebrow = getContainerEl(`#detailLayerEyebrow-${PAGE_CODE}`);
                const body = getContainerEl(`#detailLayerBody-${PAGE_CODE}`);
                if (!layer || !body || !this.generatedViolationSql) return;
                this.resetDetailDialogPosition();
                if (eyebrow) eyebrow.textContent = "FINAL RULE · LIVE SQL";
                if (title) title.textContent = this.selectedViolationRule?.RULE_NAME || "실시간 위반 조회 SQL";
                const selectedType = String(this.selectedViolationRule?.SOURCE_RULE_TYPE || "").toUpperCase();
                const ruleResult = selectedType === "SYMBOLIC"
                    ? `예측 대상 ${this.selectedViolationRule?.TARGET_COLUMN || "-"}`
                    : `${this.selectedViolationRule?.TARGET_COLUMN || "-"} = ${this.selectedViolationRule?.EXPECTED_VALUE ?? "-"}`;
                body.innerHTML = `
                    <dl class="edit-work-detail-meta">
                        <div><dt>조회 방식</dt><dd>실제 INITUP$ 테이블 실시간 조회</dd></div>
                        <div><dt>최종 규칙 ID</dt><dd>#${this.escapeHtml(this.selectedViolationRuleId || "-")}</dd></div>
                        <div><dt>대상 테이블</dt><dd>${this.escapeHtml(this.selectedViolationRule?.TARGET_OWNER || "-")}.${this.escapeHtml(this.selectedViolationRule?.TARGET_TABLE || "-")}</dd></div>
                        <div><dt>규칙 유형</dt><dd>${this.escapeHtml(this.stageFilterOptionLabel(this.selectedViolationRule?.SOURCE_RULE_TYPE || "-"))}</dd></div>
                    </dl>
                    <section class="edit-work-detail-rule">
                        <strong>${selectedType === "SYMBOLIC" ? "f(X) 수식" : "IF 조건"}</strong>
                        <pre>${this.renderColumnAwareText(this.selectedViolationRule?.RULE_EXPRESSION || "-", this.selectedViolationRule?.COLUMN_COMMENTS || {})}</pre>
                    </section>
                    <section class="edit-work-detail-rule">
                        <strong>${selectedType === "SYMBOLIC" ? "예측 대상" : "THEN 결과"}</strong>
                        <pre>${this.renderColumnAwareText(ruleResult, this.selectedViolationRule?.COLUMN_COMMENTS || {})}</pre>
                    </section>
                    <section class="edit-work-detail-rule is-focus">
                        <strong>서버 자동 생성 읽기 전용 SQL</strong>
                        <pre>${this.escapeHtml(this.generatedViolationSql)}</pre>
                    </section>
                    <p class="edit-work-detail-note">SQL의 바인드 값과 식별자는 서버에서 최종 규칙 및 허용된 실제 테이블 기준으로 검증합니다.</p>
                `;
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog")?.focus();
            },

            toggleVisibleViolationRules(checked) {
                this.getVisibleRows().forEach((row) => {
                    if (!row?.EDIT_RULE_ID) return;
                    const id = String(row.EDIT_RULE_ID);
                    if (checked) this.selectedRuleIds.add(id);
                    else this.selectedRuleIds.delete(id);
                });
                this.renderGrid();
            },

            toggleViolationRule(index, checked) {
                const row = this.getVisibleRows()[index];
                if (!row?.EDIT_RULE_ID) return;
                const id = String(row.EDIT_RULE_ID);
                if (checked) this.selectedRuleIds.add(id);
                else this.selectedRuleIds.delete(id);
                this.renderGrid();
            },

            async createSessionFromSelectedRules() {
                if (this.editingWorkStarting) return;
                const ids = [
                    ...new Set([
                        ...this.selectedRuleIds,
                        this.selectedViolationRuleId
                    ].filter(Boolean))
                ].map(Number).filter((value) => Number.isFinite(value));
                if (!ids.length) {
                    CommonMessage.warn("위반 목록에서 편집할 규칙을 선택하세요.");
                    return;
                }
                const first = this.selectedViolationRule
                    || this.rows.find((row) => ids.includes(Number(row.EDIT_RULE_ID)))
                    || {};
                const sourceTable = String(first.TARGET_TABLE || "INITUP$");
                const editTable = sourceTable.startsWith("INITUP$")
                    ? `INITDN$${sourceTable.slice("INITUP$".length)}`
                    : "INITDN$ 편집 테이블";
                const confirmed = await CommonMessage.confirm(
                    `편집 작업을 시작하면 선택한 최종 규칙을 작업 범위로 등록하고 ` +
                    `${first.TARGET_OWNER || "-"}.${editTable}을 준비합니다.\n` +
                    `편집 테이블이 없으면 INITUP$ 원본으로 생성하며, 이미 있으면 삭제하지 않고 기존 테이블을 검증해 사용합니다.\n` +
                    `기존 INITUP$ 원본 데이터는 변경하지 않습니다.`
                );
                if (!confirmed) return;
                this.editingWorkStarting = true;
                this.setWorkActionLoading(true, this.pageLabel("editingWorkStarting", "편집 작업과 INITDN$ 편집 테이블을 준비하고 있습니다."));
                try {
                    const payload = {
                        projectId: this.optionalNumber(getContainerEl(`#projectId-${PAGE_CODE}`)?.value),
                        scenarioId: this.optionalNumber(getContainerEl(`#scenarioId-${PAGE_CODE}`)?.value),
                        sessionName: `${first.TARGET_TABLE || "INITUP"} 편집 ${new Date().toLocaleString()}`,
                        editRuleIds: ids,
                        baselineFlowRunId: this.optionalNumber(
                            first.SOURCE_RUN_SOURCE_TYPE === "FLOW_WORK"
                                ? first.SOURCE_RUN_ID
                                : null
                        )
                    };
                    const created = await CommonUtils.request(apiUrl("/sessions"), { method: "POST", body: payload, showLoading: false });
                    const context = { ...this.readContext(), editSessionId: created.editSessionId };
                    localStorage.setItem(EDIT_CONTEXT_KEY, JSON.stringify(context));
                    let prepared = null;
                    let prepareError = null;
                    try {
                        prepared = await CommonUtils.request(
                            apiUrl(`/sessions/${created.editSessionId}/prepare`),
                            { method: "POST", showLoading: false }
                        );
                    } catch (error) {
                        prepareError = error;
                    }
                    if (PAGE_CODE === "M05002") {
                        this.invalidateEditWorkspaceCache("M05002_CLEANSING");
                        await this.loadSessions(String(created.editSessionId));
                        this.persistContext();
                        await this.switchEditWorkspaceTab("M05002_CLEANSING");
                    } else {
                        sessionStorage.setItem("M06002:editContext", JSON.stringify(context));
                        this.navigateStage("M06002");
                    }
                    if (prepareError) {
                        CommonMessage.error(
                            `편집 작업 #${created.editSessionId}은 등록했지만 편집 테이블을 준비하지 못했습니다. ` +
                            `오류 수정 화면의 ‘${this.pageLabel("buttonRetryEditingWork", "편집 작업 준비 재시도")}’를 실행해 주세요.\n` +
                            `${prepareError.message || ""}`
                        );
                        return;
                    }
                    const tableAction = prepared.editTableCreated ? "새로 생성" : "기존 테이블 확인";
                    CommonMessage.success(
                        `편집 작업 #${created.editSessionId}을 시작했습니다.\n` +
                        `${created.sourceTable} → ${prepared.editTable} · ${tableAction} · ` +
                        `${Number(prepared.sourceRowCount || 0).toLocaleString()}행`
                    );
                } finally {
                    this.editingWorkStarting = false;
                    this.setWorkActionLoading(false);
                }
            },

            renderInlineEditor(row, index, session) {
                const disabled = !session
                    || !row.CASE_ROWID
                    || !["EDITING", "VALIDATED"].includes(String(session.SESSION_STATUS || ""));
                return `
                    <span class="edit-work-inline-editor">
                        <input id="editValue-${PAGE_CODE}-${index}" value="${this.escapeHtml(row.CURRENT_VALUE ?? row.EXPECTED_VALUE ?? "")}" ${disabled ? "disabled" : ""} title="${row.CASE_ROWID ? "" : "원본 ROWID가 없어 수정할 수 없습니다."}">
                        <button type="button" class="is-primary" onclick="${PAGE_CODE}.saveViolationChange(${index})" ${disabled ? "disabled" : ""}>저장</button>
                    </span>
                `;
            },

            async retryPrepareCurrentSession() {
                const session = this.getSelectedSession();
                if (!session) {
                    CommonMessage.warn("편집 작업을 선택하세요.");
                    return;
                }
                if (!(await CommonMessage.confirm(`편집 작업 #${session.EDIT_SESSION_ID}의 편집 테이블 준비를 다시 시도할까요?\n기존 INITUP$ 원본은 변경하지 않습니다.`))) return;
                this.setWorkActionLoading(true, this.pageLabel("editingWorkStarting", "편집 작업과 INITDN$ 편집 테이블을 준비하고 있습니다."));
                try {
                    const json = await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/prepare`), { method: "POST", showLoading: false });
                    const tableAction = json.editTableCreated ? "새로 생성" : "기존 테이블 확인";
                    CommonMessage.success(`편집 작업 #${session.EDIT_SESSION_ID} 준비를 완료했습니다. ${json.editTable} · ${tableAction} · ${Number(json.sourceRowCount || 0).toLocaleString()}행`);
                    this.invalidateEditWorkspaceCache("M05002");
                    await this.loadSessions(session.EDIT_SESSION_ID);
                    await this.refresh();
                } finally {
                    this.setWorkActionLoading(false);
                }
            },

            async deleteCurrentEditingWork() {
                const session = this.getSelectedSession();
                if (!session || this.editingWorkStarting) {
                    if (!session) CommonMessage.warn(this.pageLabel("selectEditingWork", "삭제할 편집 작업을 선택하세요."));
                    return;
                }
                const confirmTemplate = this.pageLabel(
                    "editingWorkDeleteConfirm",
                    "편집 작업 #{id}을 삭제할까요?\n{owner}.{table} 테이블과 이 작업의 수정·DML·이력이 함께 삭제됩니다.\n삭제 후 되돌릴 수 없습니다."
                );
                const confirmed = await CommonMessage.confirm(
                    confirmTemplate
                        .replaceAll("{id}", String(session.EDIT_SESSION_ID))
                        .replaceAll("{owner}", String(session.TARGET_OWNER || "-"))
                        .replaceAll("{table}", String(session.EDIT_TABLE || "-"))
                );
                if (!confirmed) return;
                this.editingWorkStarting = true;
                this.setWorkActionLoading(true, this.pageLabel("editingWorkDeleting", "편집 작업과 INITDN$ 편집 테이블을 삭제하고 있습니다."));
                try {
                    const json = await CommonUtils.request(
                        apiUrl(`/sessions/${session.EDIT_SESSION_ID}`),
                        { method: "DELETE", showLoading: false }
                    );
                    const context = { ...this.readContext(), editSessionId: "" };
                    localStorage.setItem(EDIT_CONTEXT_KEY, JSON.stringify(context));
                    this.selectedSessionId = "";
                    this.invalidateEditWorkspaceCache();
                    await this.loadSessions("");
                    this.persistContext();
                    await this.refresh();
                    CommonMessage.success(
                        this.pageLabel("editingWorkDeleted", "편집 작업과 INITDN$ 편집 테이블을 삭제했습니다.") +
                        (json.editTableDropped ? ` ${json.editTable}` : "")
                    );
                } finally {
                    this.editingWorkStarting = false;
                    this.setWorkActionLoading(false);
                }
            },

            async saveViolationChange(index) {
                const row = this.getVisibleRows()[index];
                const session = this.getSelectedSession();
                if (!row || !session) return;
                const newValue = getContainerEl(`#editValue-${PAGE_CODE}-${index}`)?.value ?? "";
                await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/changes`), {
                    method: "POST",
                    body: {
                        editRuleId: this.optionalNumber(row.EDIT_RULE_ID),
                        sourceViolationType: row.SOURCE_VIOLATION_TYPE,
                        sourceViolationId: Number(row.VIOLATION_ID),
                        sourceRowid: row.CASE_ROWID,
                        caseId: row.CASE_ID || null,
                        columnName: row.TARGET_COLUMN,
                        newValue,
                        expectedValue: row.EXPECTED_VALUE ?? null
                    },
                    showLoading: false
                });
                CommonMessage.success("INITDN$ 편집본에 수정값을 저장했습니다.");
                this.invalidateEditWorkspaceCache("M05002");
                await this.refresh();
            },

            async loadValidation() {
                const session = this.getSelectedSession();
                this.setPanel("에디팅 효과 검증", session ? `
                    <button type="button" onclick="${PAGE_CODE}.openReanalysisFlow()"><i class="fas fa-wave-square"></i>INITDN$ Flow 재분석</button>
                    <button type="button" class="is-primary" onclick="${PAGE_CODE}.markValidated()"><i class="fas fa-check-double"></i>효과 검증 완료</button>
                ` : "");
                this.hideModeForm();
                if (!session) {
                    this.rows = [];
                    this.setKpis([{ value: "-", label: "편집 세션", hint: "검증할 세션을 선택하세요." }]);
                    this.renderEmpty("효과를 검증할 편집 세션을 선택하세요.");
                    return;
                }
                const [validation, changes] = await Promise.all([
                    CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/validation`), { method: "GET", showLoading: false }),
                    CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/changes`), { method: "GET", showLoading: false })
                ]);
                this.currentValidation = validation.data || {};
                this.rows = Array.isArray(changes.data) ? changes.data : [];
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
                return `
                    <div class="edit-work-validation-bar">
                        <span>${this.escapeHtml(label)}</span>
                        <span class="edit-work-validation-track"><i style="width:${percent.toFixed(1)}%"></i></span>
                        <b>${Number(value || 0).toLocaleString()}</b>
                    </div>
                `;
            },

            async markValidated() {
                const session = this.getSelectedSession();
                if (!session) return;
                await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/validate`), { method: "POST", showLoading: false });
                CommonMessage.success("에디팅 효과 검증을 완료했습니다.");
                this.invalidateEditWorkspaceCache("M05003_FINAL_APPLY");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.loadSessions(session.EDIT_SESSION_ID);
                await this.refresh();
            },

            openReanalysisFlow() {
                const session = this.getSelectedSession();
                if (!session) {
                    CommonMessage.warn("편집 세션을 선택하세요.");
                    return;
                }
                const runtimeContext = {
                    editSessionId: Number(session.EDIT_SESSION_ID),
                    projectId: session.PROJECT_ID,
                    scenarioId: session.SCENARIO_ID,
                    targetOwner: session.TARGET_OWNER,
                    targetTable: session.EDIT_TABLE,
                    sourceTable: session.SOURCE_TABLE
                };
                sessionStorage.setItem("M04001:editingRuntimeContext", JSON.stringify(runtimeContext));
                localStorage.setItem("DATA_EDITING_WORK_CONTEXT", JSON.stringify({
                    projectId: session.PROJECT_ID || "",
                    scenarioId: session.SCENARIO_ID || ""
                }));
                const menu = window.MENU_PAGE_MAP?.M04001;
                PageManager.load("M04001", menu?.title || menu?.label || "Rule Discovery Execution", true);
            },

            async loadDml() {
                const session = this.getSelectedSession();
                this.setPanel("운영 반영 DML", session ? `<button type="button" class="is-primary" onclick="${PAGE_CODE}.generateDml()"><i class="fas fa-wand-magic-sparkles"></i>DML 생성</button>` : "");
                this.hideModeForm();
                if (!session) {
                    this.rows = [];
                    this.setKpis([{ value: "-", label: "편집 세션", hint: "운영 반영할 세션을 선택하세요." }]);
                    this.renderEmpty("운영 반영 DML을 관리할 편집 세션을 선택하세요.");
                    return;
                }
                const params = new URLSearchParams({ editSessionId: session.EDIT_SESSION_ID });
                const json = await CommonUtils.request(apiUrl(`/dml?${params}`), { method: "GET", showLoading: false });
                this.rows = Array.isArray(json.data) ? json.data : [];
                if (!this.selectedDmlId || !this.rows.some((item) => String(item.EDIT_DML_ID) === String(this.selectedDmlId))) {
                    this.selectedDmlId = String(this.rows[0]?.EDIT_DML_ID || "");
                }
                this.selectedDml = this.rows.find((item) => String(item.EDIT_DML_ID) === String(this.selectedDmlId)) || null;
                const counts = this.countBy(this.rows, "DML_STATUS");
                this.setKpis([
                    { value: this.rows.length, label: "등록 DML", hint: `Session #${session.EDIT_SESSION_ID}` },
                    { value: counts.DRAFT || 0, label: "작성 중", hint: "검증·승인 전" },
                    { value: counts.APPROVED || 0, label: "승인", hint: "운영 반영 가능" },
                    { value: counts.EXECUTED || 0, label: "실행 완료", hint: "커밋된 DML" }
                ]);
                this.renderDmlContent();
            },

            renderDmlContent() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const dml = this.selectedDml || {};
                const { filtered, visible } = this.getPagedRows(this.rows);
                const dmlColumns = [
                    { key: "EDIT_DML_ID", label: "DML ID", width: 70, className: "is-number" },
                    { key: "DML_NAME", label: "DML 명", width: 220 },
                    { key: "DML_STATUS", label: "상태", width: 90, render: (value) => this.badge(value) },
                    { key: "VALIDATION_MESSAGE", label: "검증 결과", width: 300, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "VALIDATION_MESSAGE", "DML 검증 결과") },
                    { key: "AFFECTED_ROW_COUNT", label: "영향 행", width: 80, className: "is-number" },
                    { key: "EXECUTED_AT", label: "실행 일시", width: 150, render: (value) => this.formatDate(value) },
                    { key: "_ACTION", label: "선택", width: 70, className: "is-action-column", headerClassName: "is-action-column", render: (_value, _row, index) => `<span class="edit-work-row-actions"><button onclick="${PAGE_CODE}.selectDml(${index})">열기</button></span>` }
                ];
                content.innerHTML = `
                    ${this.buildGridHtml(visible, dmlColumns, true)}
                    <section class="edit-work-dml-panel">
                        <div class="edit-work-form-grid">
                            <label class="edit-work-field is-wide"><span>DML 명</span><input id="dmlName-${PAGE_CODE}" value="${this.escapeHtml(dml.DML_NAME || "")}" ${dml.DML_STATUS === "DRAFT" ? "" : "disabled"}></label>
                            <label class="edit-work-field"><span>상태</span><input value="${this.escapeHtml(dml.DML_STATUS || "DRAFT")}" disabled></label>
                            <label class="edit-work-field"><span>영향 행</span><input value="${this.escapeHtml(dml.AFFECTED_ROW_COUNT ?? "-")}" disabled></label>
                        </div>
                        <p class="edit-work-dml-notice">운영 반영 SQL은 현재 편집 세션의 INITDN$ 변경 이력으로 서버가 생성합니다. 생성된 SQL이 달라지면 승인과 실행이 차단됩니다.</p>
                        <textarea id="dmlSql-${PAGE_CODE}" class="edit-work-dml-editor" spellcheck="false" readonly>${this.escapeHtml(dml.DML_SQL || "")}</textarea>
                        <div class="edit-work-form-actions">
                            <button type="button" onclick="${PAGE_CODE}.saveDmlDraft()" ${dml.DML_STATUS === "DRAFT" ? "" : "disabled"}>명칭 저장</button>
                            <button type="button" class="is-primary" onclick="${PAGE_CODE}.approveDml()" ${dml.DML_STATUS === "DRAFT" ? "" : "disabled"}>검증·승인</button>
                            <button type="button" class="is-primary" onclick="${PAGE_CODE}.executeDml()" ${dml.DML_STATUS === "APPROVED" ? "" : "disabled"}>최종 실행</button>
                        </div>
                    </section>
                `;
                this.updateGridMeta(filtered);
                this.currentExport = {
                    filename: "editing-apply-dml.csv",
                    columns: ["EDIT_DML_ID", "DML_NAME", "DML_STATUS", "VALIDATION_MESSAGE", "AFFECTED_ROW_COUNT", "EXECUTED_AT"],
                    rows: filtered
                };
            },

            selectDml(index) {
                const row = this.getVisibleRows()[index];
                if (!row) return;
                this.selectedDmlId = String(row.EDIT_DML_ID);
                this.selectedDml = row;
                this.renderDmlContent();
            },

            async generateDml() {
                const session = this.getSelectedSession();
                if (!session) return;
                const json = await CommonUtils.request(apiUrl(`/sessions/${session.EDIT_SESSION_ID}/dml/generate`), { method: "POST", showLoading: false });
                this.selectedDmlId = String(json.editDmlId);
                CommonMessage.success("검증된 변경으로 운영 반영 DML을 생성했습니다.");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.loadSessions(session.EDIT_SESSION_ID);
                await this.refresh();
            },

            async saveDmlDraft() {
                const session = this.getSelectedSession();
                if (!session) return;
                const payload = {
                    editDmlId: this.optionalNumber(this.selectedDml?.EDIT_DML_ID),
                    editSessionId: Number(session.EDIT_SESSION_ID),
                    dmlName: getContainerEl(`#dmlName-${PAGE_CODE}`)?.value?.trim?.() || `${session.SOURCE_TABLE} final apply`,
                    dmlSql: getContainerEl(`#dmlSql-${PAGE_CODE}`)?.value || ""
                };
                const json = await CommonUtils.request(apiUrl("/dml"), { method: "POST", body: payload, showLoading: false });
                this.selectedDmlId = String(json.editDmlId);
                CommonMessage.success("DML을 임시 저장했습니다.");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.refresh();
            },

            async approveDml() {
                if (!this.selectedDml?.EDIT_DML_ID) return;
                await this.saveDmlDraft();
                const dmlId = Number(this.selectedDmlId);
                const json = await CommonUtils.request(apiUrl(`/dml/${dmlId}/approve`), { method: "POST", showLoading: false });
                CommonMessage.success(json.validationMessage || "DML 검증과 승인이 완료되었습니다.");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.refresh();
            },

            async executeDml() {
                if (!this.selectedDml?.EDIT_DML_ID || this.selectedDml.DML_STATUS !== "APPROVED") return;
                const session = this.getSelectedSession();
                const message = [
                    `승인된 DML #${this.selectedDml.EDIT_DML_ID}을 최종 실행합니다.`,
                    `${session.TARGET_OWNER}.${session.SOURCE_TABLE} 운영 원본이 변경되고 커밋됩니다.`,
                    "계속할까요?"
                ].join("\n\n");
                if (!(await CommonMessage.confirm(message))) return;
                const json = await CommonUtils.request(apiUrl(`/dml/${this.selectedDml.EDIT_DML_ID}/execute`), { method: "POST", showLoading: true });
                CommonMessage.success(`최종 반영 완료: ${Number(json.affectedRowCount || 0).toLocaleString()}행`);
                this.invalidateEditWorkspaceCache("M05003");
                this.invalidateEditWorkspaceCache("M05003_HISTORY");
                await this.loadSessions(session.EDIT_SESSION_ID);
                await this.refresh();
            },

            async loadHistory() {
                const session = this.getSelectedSession();
                const params = this.contextParams();
                params.set("eventType", this.stageFilters.EVENT_TYPE || "ALL");
                if (session) params.set("editSessionId", session.EDIT_SESSION_ID);
                const json = await CommonUtils.request(apiUrl(`/history?${params}`), { method: "GET", showLoading: false });
                this.rows = Array.isArray(json.data) ? json.data : [];
                const counts = this.countBy(this.rows, "EVENT_TYPE");
                this.setKpis([
                    { value: this.rows.length, label: "감사 이벤트", hint: json.limited ? "최근 5,000건 표시" : (session ? `Session #${session.EDIT_SESSION_ID}` : "전체 세션") },
                    { value: counts.RULE_DECISION || 0, label: "규칙 판단", hint: "선정·제외·등록" },
                    { value: counts.CELL_EDITED || 0, label: "데이터 수정", hint: "INITDN$ 셀 변경" },
                    { value: counts.DML_EXECUTED || 0, label: "운영 반영", hint: "커밋 완료 이벤트" }
                ]);
                this.setPanel("에디팅 감사 이력", "");
                this.hideModeForm();
                this.renderHistoryContent();
            },

            renderHistoryContent() {
                const content = getContainerEl(`#workContent-${PAGE_CODE}`);
                if (!content) return;
                const { filtered, visible } = this.getPagedRows(this.rows);
                const historyColumns = [
                    { key: "EDIT_EVENT_ID", label: "이력 ID", width: 72, className: "is-number" },
                    { key: "EVENT_TYPE", label: "이벤트", width: 120, render: (value) => this.badge(value) },
                    { key: "EDIT_SESSION_ID", label: "세션", width: 72, className: "is-number", render: (value) => value ? `#${this.escapeHtml(value)}` : "-" },
                    { key: "ENTITY_TYPE", label: "대상 유형", width: 105 },
                    { key: "ENTITY_ID", label: "대상 ID", width: 86, className: "is-number" },
                    { key: "EVENT_SUMMARY", label: "이력 내용", width: 330, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "EVENT_SUMMARY", "이력 내용") },
                    { key: "EVENT_DETAIL_JSON", label: "상세", width: 260, className: "is-rule-detail", render: (value, _row, index) => this.renderTextPreview(value, index, "EVENT_DETAIL_JSON", "이력 상세") },
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
                    context.title = `편집 세션 #${session.EDIT_SESSION_ID} · ${source} → ${edit}`;
                    context.hidden = false;
                    return;
                }
                if (
                    ["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)
                    && this.selectedViolationRule?.TARGET_OWNER
                    && this.selectedViolationRule?.TARGET_TABLE
                ) {
                    context.textContent = `OWNER ${this.selectedViolationRule.TARGET_OWNER} · TABLE ${this.selectedViolationRule.TARGET_TABLE}`;
                    context.title = `최종 규칙 #${this.selectedViolationRule.EDIT_RULE_ID || "-"} · ${this.selectedViolationRule.TARGET_OWNER}.${this.selectedViolationRule.TARGET_TABLE}`;
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
                    case "CLEANSING":
                        return [
                            definition("SOURCE_RULE_TYPE", "filterRuleType", "규칙 유형", ["ASSOCIATION", "SYMBOLIC"]),
                            definition("TARGET_COLUMN", "filterErrorColumn", "오류 컬럼", values("TARGET_COLUMN")),
                            definition("CHANGE_STATUS", "filterEditStatus", "수정 상태", ["UNEDITED", "EDITED", "APPLIED", "FAILED"])
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
                                "DML_FAILED"
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
                if (["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)) {
                    const targetColumns = [...new Set(
                        this.violationRules
                            .map((rule) => String(rule.TARGET_COLUMN || "").trim().toUpperCase())
                            .filter(Boolean)
                    )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
                    const ruleOptions = this.getViolationRuleOptions();
                    if (!ruleOptions.some((rule) => String(rule.EDIT_RULE_ID) === this.selectedViolationRuleId)) {
                        this.selectedViolationRuleId = String(ruleOptions[0]?.EDIT_RULE_ID || "");
                    }
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
                        <label class="edit-work-final-rule-filter">
                            <span>${this.escapeHtml(this.pageLabel("filterFinalRule", "최종 규칙"))}</span>
                            <select onchange="${PAGE_CODE}.selectViolationRule(this.value)">
                                ${ruleOptions.length
                                    ? ruleOptions.map((rule) => `
                                        <option value="${this.escapeHtml(rule.EDIT_RULE_ID)}" ${String(rule.EDIT_RULE_ID) === this.selectedViolationRuleId ? "selected" : ""}>
                                            ${this.escapeHtml(this.violationRuleOptionLabel(rule))}
                                        </option>
                                    `).join("")
                                    : `<option value="">${this.escapeHtml(this.pageLabel("noFinalRules", "조회 가능한 최종 규칙이 없습니다."))}</option>`}
                            </select>
                        </label>
                    `;
                    host.hidden = false;
                    return;
                }
                const definitions = this.getStageFilterDefinitions();
                host.innerHTML = definitions.map((item) => `
                    <label>
                        <span>${this.escapeHtml(this.pageLabel(item.labelKey, item.label))}</span>
                        <select onchange="${PAGE_CODE}.handleStageFilter('${this.escapeHtml(item.key)}', this.value)">
                            <option value="ALL">${this.escapeHtml(this.pageLabel("filterAll", "전체"))}</option>
                            ${item.options.map((value) => `
                                <option value="${this.escapeHtml(value)}" ${String(this.stageFilters[item.key] || "ALL") === value ? "selected" : ""}>
                                    ${this.escapeHtml(this.stageFilterOptionLabel(value))}
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

            stageFilterOptionLabel(value) {
                const normalized = String(value || "").toUpperCase();
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
                if (["RULE_MASTER", "HISTORY"].includes(this.stage.mode)) {
                    this.refresh();
                } else if (["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)) {
                    this.loadViolations(this.stage.mode === "CLEANSING").catch((error) => this.renderError(error));
                } else if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
                else if (this.stage.mode === "FINAL_APPLY") this.renderDmlContent();
                else this.renderGrid();
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
                const freezeCount = Math.max(0, Math.min(Number(this.freezeColumns || 0), columns.length));
                const rowOffset = paged ? Math.max(0, (this.page - 1) * this.pageSize) : 0;
                const masterSelectable = this.stage.mode === "RULE_MASTER";
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
                                <tr class="${masterSelectable ? "is-master-selectable" : ""} ${masterSelectable && String(row.USER_RULE_YN || "N").toUpperCase() === "Y" ? "is-user-rule-row" : ""} ${masterSelectable && String(row.EDIT_RULE_ID || "") === this.selectedMasterRuleId ? "is-selected-row" : ""}"
                                    ${masterSelectable ? `data-edit-rule-id="${this.escapeHtml(row.EDIT_RULE_ID || "")}" onclick="${PAGE_CODE}.selectMasterRule(${Number(row.EDIT_RULE_ID || 0)})"` : ""}>
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
                const filters = Object.entries(this.stageFilters || {})
                    .filter(([, value]) => value && value !== "ALL");
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
                const visibleCount = this.serverPaging ? this.rows.length : this.getVisibleRows().length;
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
                if (["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)) {
                    if (this.keywordTimer) clearTimeout(this.keywordTimer);
                    this.keywordTimer = setTimeout(() => {
                        this.loadViolations(this.stage.mode === "CLEANSING").catch((error) => this.renderError(error));
                    }, 250);
                    return;
                }
                if (this.stage.mode === "HISTORY") this.renderHistoryContent();
                else if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
                else if (this.stage.mode === "FINAL_APPLY") this.renderDmlContent();
                else this.renderGrid();
            },

            handleFreezeChange(value) {
                const parsed = Number.parseInt(value, 10);
                this.freezeColumns = Math.max(0, Math.min(50, Number.isFinite(parsed) ? parsed : 0));
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
                if (["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)) {
                    this.loadViolations(this.stage.mode === "CLEANSING").catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
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
                if (["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)) {
                    this.loadViolations(this.stage.mode === "CLEANSING").catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
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
                if (["VIOLATIONS", "CLEANSING"].includes(this.stage.mode)) {
                    this.loadViolations(this.stage.mode === "CLEANSING").catch((error) => this.renderError(error));
                    return;
                }
                if (this.stage.mode === "VALIDATION") this.renderValidationContent(this.currentValidation || {});
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

            openRowTextDetail(index, key, detailTitle, columnAware = false) {
                const row = this.getVisibleRows()[index];
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
                        <div><dt>편집 세션</dt><dd>${this.escapeHtml(row.EDIT_SESSION_ID ? `#${row.EDIT_SESSION_ID}` : (this.selectedSessionId ? `#${this.selectedSessionId}` : "-"))}</dd></div>
                        <div><dt>대상</dt><dd>${this.escapeHtml(row.RULE_NAME || row.DML_NAME || row.EVENT_TYPE || row.TARGET_COLUMN || "-")}</dd></div>
                        <div><dt>ID</dt><dd>${this.escapeHtml(row.EDIT_RULE_ID || row.EDIT_DML_ID || row.EDIT_EVENT_ID || row.VIOLATION_ID || "-")}</dd></div>
                    </dl>
                    <section class="edit-work-detail-rule is-focus">
                        <strong>${this.escapeHtml(detailTitle || "상세 내용")}</strong>
                        <pre>${columnAware ? this.renderColumnAwareText(detailValue, row.COLUMN_COMMENTS || {}) : this.escapeHtml(detailValue)}</pre>
                    </section>
                `;
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog")?.focus();
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
                const thenText = row.RESULT_EXPRESSION
                    || (row.EXPECTED_VALUE !== null && row.EXPECTED_VALUE !== undefined
                        ? `${row.TARGET_COLUMN} = ${row.EXPECTED_VALUE}`
                        : "-");
                if (eyebrow) eyebrow.textContent = `${row.RULE_GROUP_CODE || row.SOURCE_RULE_TYPE || "RULE"} · RUN #${row.RUN_ID || "-"}`;
                if (title) title.textContent = row.SOURCE_RULE_ID || row.RULE_NAME || "규칙 상세";
                body.innerHTML = `
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
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog")?.focus();
            },

            openContinuousRuleDetail(row, focusSection, elements) {
                const { layer, title, eyebrow, body } = elements;
                const comments = row.COLUMN_COMMENTS || {};
                const features = this.parseFeatureColumns(row);
                if (eyebrow) eyebrow.textContent = `연속형 수식 규칙 · RUN #${row.RUN_ID || "-"}`;
                if (title) title.textContent = row.SOURCE_RULE_ID || row.RULE_NAME || "수식 규칙 상세";
                body.innerHTML = `
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
                layer.hidden = false;
                layer.querySelector(".edit-work-detail-dialog")?.focus();
            },

            closeDetailLayer(event) {
                if (event && event.target !== event.currentTarget) return;
                const layer = getContainerEl(`#detailLayer-${PAGE_CODE}`);
                this.endDetailLayerDrag();
                if (layer) layer.hidden = true;
                this.resetDetailDialogPosition();
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
