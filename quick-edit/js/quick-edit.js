(function () {
    "use strict";

    const STORAGE_KEY = "init.quick-edit.pipeline.v1";
    const TARGET_CONTEXT_CHANNEL_NAME = "init.target-context.v1";
    const MODEL_TRAINING_NAVIGATION_KEY = "init.m90003.navigation.v1";
    const STATE_VERSION = 1;
    const STEP_COUNT = 8;
    const STEPS = [
        { key: "upload", title: "파일 업로드", description: "파일을 안전하게 임시 업로드합니다." },
        { key: "project", title: "프로젝트", description: "작업 프로젝트를 준비합니다." },
        { key: "scenario", title: "시나리오", description: "규칙 발굴 시나리오를 준비합니다." },
        { key: "table", title: "대상 테이블", description: "INITUP$ 테이블을 만들고 시나리오에 등록합니다." },
        { key: "models", title: "모델 설정", description: "선택한 시나리오의 모델과 실행 파라미터를 저장합니다." },
        { key: "flow", title: "FLOW 설계", description: "화면에 설계도를 표시하지 않고 내부 FLOW를 저장합니다." },
        { key: "run", title: "규칙 발굴 실행", description: "저장된 FLOW를 실행하고 상세 이력을 조회합니다." },
        { key: "results", title: "결과 분석", description: "선택한 시나리오에서 발견된 규칙을 요약합니다." }
    ];
    const ALLOWED_EXTENSIONS = new Set(["csv", "tsv", "txt", "xlsx", "xlsm"]);
    const COLUMN_TYPE_OPTIONS = [
        ["숫자형식별자", "NUM_IDENTIFIER", "OTHER"],
        ["문자형식별자", "CHAR_IDENTIFIER", "OTHER"],
        ["숫자형범주형", "CAT_NUMERIC", "CATEGORICAL"],
        ["순서형범주형", "CAT_ORDINAL", "CATEGORICAL"],
        ["이산형연속형", "NUM_DISCRETE", "CONTINUOUS"],
        ["문자형범주형", "CAT_CHAR", "CATEGORICAL"],
        ["일반적범주형", "CAT_GENERAL", "CATEGORICAL"],
        ["숫자형연속형", "NUM_CONTINUOUS", "CONTINUOUS"],
        ["단순형텍스트", "FREE_TEXT", "OTHER"],
        ["기타데이터형", "OTHER", "OTHER"],
        ["미상데이터형", "UNKNOWN", "OTHER"]
    ];
    const COLUMN_TYPE_METADATA = new Map(COLUMN_TYPE_OPTIONS.map(([displayType, typeCode, groupCode]) => (
        [displayType, { typeCode, groupCode }]
    )));
    const PIPELINE_ACTION = Object.freeze({
        FULL_AUTO: "FULL_AUTO",
        RETRY: "RETRY",
        HISTORY_FULL_RERUN: "HISTORY_FULL_RERUN",
        HISTORY_FAILED_RERUN: "HISTORY_FAILED_RERUN",
        COLUMN_TYPE_RERUN: "COLUMN_TYPE_RERUN"
    });

    const R = window.QuickEditRenderers;
    const client = new window.QuickEditApiClient();
    let state = loadState();
    let selectedFile = null;
    let projectRows = [];
    let scenarioRows = [];
    let currentSnapshot = null;
    let resultData = {
        categorical: null,
        continuous: null,
        categoricalViolation: null,
        continuousViolation: null,
        descriptiveStatistics: null,
        columnTypeFinal: null
    };
    let columnTypeDirtyChanges = new Map();
    let columnTypeSaveBusy = false;
    let ruleDistributionFilters = createRuleDistributionFilters();
    let categoricalDetail = { ruleId: "", ruleIndex: -1 };
    let continuousDetail = {
        ruleId: "",
        ruleIndex: -1,
        rule: null,
        rows: [],
        evaluatedRows: [],
        metrics: null,
        sampleCount: 0,
        hasMore: false,
        error: "",
        selectedRowIndex: null,
        chartPoints: []
    };
    let continuousDetailRequestId = 0;
    let continuousDetailAbort = null;
    let formulaChartView = null;
    let formulaChartPayload = null;
    let chartResizeTimer = null;
    let chartResizeObserver = null;
    let chartResizeBound = false;
    let pipelineBusy = false;
    let controlBusy = false;
    let activePipelineAction = "";
    let snapshotBusy = false;
    let pollGeneration = 0;
    let toastTimer = null;
    let lastRenderedStep = -1;
    let quickHistoryRows = [];
    let quickHistoryPage = 1;
    let quickHistoryTotal = 0;
    let quickHistoryBusy = false;
    let quickHistoryDetailRunId = null;
    let quickHistoryDetailError = { runId: null, message: "" };
    let quickHistoryError = "";

    function createRuleDistributionFilters() {
        return {
            categorical: { type: "ALL", value: "", label: "전체" },
            continuous: { type: "ALL", value: "", label: "전체" }
        };
    }

    function resetRuleDistributionFilters() {
        ruleDistributionFilters = createRuleDistributionFilters();
        categoricalDetail = { ruleId: "", ruleIndex: -1 };
    }

    function initialState() {
        return {
            version: STATE_VERSION,
            status: "idle",
            currentStep: 0,
            completedSteps: [],
            stepProgress: 0,
            workspaceMode: "new",
            processType: "MIXED_XAI",
            fileMeta: null,
            uploadId: null,
            projectId: null,
            projectCode: "",
            projectName: "",
            projectCreatedAt: null,
            scenarioId: null,
            scenarioCode: "",
            scenarioName: "",
            scenarioCreatedAt: null,
            tableOwner: "",
            tableName: "",
            columnCount: null,
            rowCount: null,
            targetStageTimings: null,
            designTimings: null,
            scenarioTableId: null,
            jobIds: [],
            flowId: null,
            flowName: "",
            flowRunId: null,
            runRequestToken: "",
            previousFlowRunIds: [],
            lastRunStatus: "",
            lastRunMessage: "",
            resultArtifacts: null,
            resultWarning: "",
            columnTypeFilter: "ALL",
            columnTypeRerunRequestToken: "",
            failedStageRerunRequestToken: "",
            error: "",
            historyView: false,
            historyViewedAt: null,
            historySteps: [],
            targetContextId: null,
            updatedAt: null
        };
    }

    function loadState() {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
            if (!parsed || parsed.version !== STATE_VERSION) return initialState();
            return {
                ...initialState(),
                ...parsed,
                processType: normalizeProcessType(parsed.processType),
                completedSteps: Array.isArray(parsed.completedSteps)
                    ? [...new Set(parsed.completedSteps.map(Number).filter((value) => value >= 0 && value < STEP_COUNT))]
                    : [],
                jobIds: Array.isArray(parsed.jobIds) ? parsed.jobIds : [],
                previousFlowRunIds: Array.isArray(parsed.previousFlowRunIds) ? parsed.previousFlowRunIds : [],
                historySteps: Array.isArray(parsed.historySteps) ? parsed.historySteps : []
            };
        } catch (_error) {
            return initialState();
        }
    }

    function persistState() {
        state.updatedAt = new Date().toISOString();
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_error) {
            // The pipeline still works without browser-side recovery state.
        }
    }

    function byId(...ids) {
        for (const id of ids) {
            const element = document.getElementById(id);
            if (element) return element;
        }
        return null;
    }

    function setText(element, text) {
        if (element) element.textContent = text == null ? "" : String(text);
    }

    function setHidden(element, hidden) {
        if (element) element.hidden = Boolean(hidden);
    }

    function valueOf(...ids) {
        return String(byId(...ids)?.value || "").trim();
    }

    function normalizeProcessType(value) {
        return String(value || "").toUpperCase() === "MIXED_XAI" ? "MIXED_XAI" : "LEGACY";
    }

    function isMixedXai() {
        return state.processType === "MIXED_XAI";
    }

    function modelStageCount() {
        if (!isMixedXai()) return 4;
        const executed = currentSnapshot?.nodes?.length;
        if (state.flowRunId && [2, 4].includes(executed)) return executed;
        const saved = state.jobIds?.length;
        return state.flowId && [2, 4].includes(saved) ? saved : 4;
    }

    function processLabel() {
        return isMixedXai() ? "혼합형 XAI" : "기존 유형·관계 분석";
    }

    function renderProcessSelection() {
        const fieldset = byId("qeProcessType");
        if (fieldset) {
            fieldset.disabled = pipelineBusy || state.historyView || Boolean(state.scenarioTableId || state.flowId);
            fieldset.querySelectorAll('input[name="processType"]').forEach((input) => {
                input.checked = input.value === normalizeProcessType(state.processType);
            });
        }
        const oldXai = Boolean(resultData.mixedXai) && !window.RuleResultCommon.isPattern(resultData.mixedXai);
        setText(byId("qeProcessDescription"), isMixedXai()
            ? (oldXai ? "이 실행은 과거 Isolation Forest 이상 후보 설명 규칙입니다. 실제 값 패턴 규칙은 새 실행에서 발굴합니다." : window.RuleResultCommon.t("Rules predict actual column values, ranges and formulas after basic statistics and relationship analysis."))
            : "컬럼 유형과 관계를 분석한 후 범주형·연속형 규칙을 발굴합니다.");
        setHidden(byId("qeCommonResults"), false);
        setHidden(byId("qeMixedXaiResults"), !isMixedXai());
        setHidden(byId("qeMixedEarlyStages"), !isMixedXai());
        setHidden(byId("continuousTab"), false);
        setText(byId("categoryTab")?.querySelector("strong"), window.RuleResultCommon.t(isMixedXai() && !oldXai ? "Value and range rules" : "IF–THEN rules"));
        setText(byId("continuousTab")?.querySelector("strong"), window.RuleResultCommon.t("Continuous formula rules"));
        setText(byId("continuousTab")?.querySelector("small"), window.RuleResultCommon.t("Numeric relationships and formulas"));
        setText(byId("categoryTab")?.querySelector("small"), isMixedXai() ? window.RuleResultCommon.t(oldXai ? "Candidate rule" : "Pattern rules") : "연관성과 값 패턴");
        setText(byId("qeResultsDescription"), isMixedXai()
            ? window.RuleResultCommon.t(oldXai ? "Inspect the rules explaining anomaly candidates and their matching rows." : "Inspect expected values, confidence and rows that violate the IF–THEN patterns.")
            : "오류가 많은 규칙을 우선 표시합니다. 카드를 누르면 상세 규칙을 확인할 수 있습니다.");
    }

    function sqlStringLiteral(value) {
        return `'${String(value ?? "").replaceAll("'", "''")}'`;
    }

    function getColumnTypeWhereClause(owner = state.tableOwner, tableName = state.tableName) {
        return `"OWNER" = ${sqlStringLiteral(String(owner || "").toUpperCase())} AND "TABLE_NAME" = ${sqlStringLiteral(String(tableName || "").toUpperCase())}`;
    }

    function resolveColumnTypeTarget(nodes, artifacts, preferredNode = null) {
        const safeNodes = Array.isArray(nodes) ? nodes : [];
        const node = preferredNode
            || safeNodes.find((item) => String(item.REF_MENU_CODE || "").toUpperCase() === "M03001" && item.TARGET_OWNER && item.TARGET_TABLE)
            || safeNodes.find((item) => item.TARGET_OWNER && item.TARGET_TABLE)
            || null;
        const artifact = artifacts?.categorical
            || artifacts?.continuous
            || artifacts?.categoricalViolation
            || artifacts?.continuousViolation
            || null;
        return {
            owner: String(node?.TARGET_OWNER || artifact?.targetOwner || state.tableOwner || "").trim().toUpperCase(),
            tableName: String(node?.TARGET_TABLE || artifact?.targetTable || state.tableName || "").trim().toUpperCase()
        };
    }

    function delay(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    function getExtension(fileName) {
        const name = String(fileName || "").split(/[\\/]/).pop();
        const index = name.lastIndexOf(".");
        return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
    }

    function getBaseName(fileName) {
        const name = String(fileName || "").split(/[\\/]/).pop();
        const index = name.lastIndexOf(".");
        return (index > 0 ? name.slice(0, index) : name).trim() || "데이터";
    }

    function makeStamp() {
        const now = new Date();
        const datePart = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
            String(now.getSeconds()).padStart(2, "0")
        ].join("");
        const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
        return `${datePart}_${randomPart}`;
    }

    function makeRunRequestToken() {
        if (typeof window.crypto?.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `QERUN_${makeStamp()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function makeCompactProjectCode() {
        const timePart = Date.now().toString(36).toUpperCase();
        const randomPart = Math.random().toString(36).slice(2, 4).toUpperCase().padEnd(2, "0");
        return `QE_${timePart}${randomPart}`;
    }

    function makeWorkspaceNameStamp(date = new Date()) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("") + "-" + [
            String(date.getHours()).padStart(2, "0"),
            String(date.getMinutes()).padStart(2, "0"),
            String(date.getSeconds()).padStart(2, "0")
        ].join("");
    }

    function normalizeCode(value, fallback) {
        const normalized = String(value || "")
            .normalize("NFKD")
            .toUpperCase()
            .replace(/[^A-Z0-9_$#-]+/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 80);
        return normalized || fallback;
    }

    function generateWorkspaceDefaults(fileName) {
        const baseName = getBaseName(fileName);
        const stamp = makeStamp();
        const projectName = `퀵 에디팅 ${makeWorkspaceNameStamp()} · ${baseName}`;
        const scenarioName = `${baseName} 자동 규칙 발굴`;
        const projectCode = makeCompactProjectCode();
        const scenarioCode = `QRULE_${stamp}`;
        const projectNameInput = byId("projectName", "qeProjectName");
        const projectCodeInput = byId("projectCode", "qeProjectCode");
        const scenarioNameInput = byId("scenarioName", "qeScenarioName");
        const scenarioCodeInput = byId("scenarioCode", "qeScenarioCode");
        if (projectNameInput && !projectNameInput.value.trim()) projectNameInput.value = projectName;
        if (projectCodeInput && !projectCodeInput.value.trim()) projectCodeInput.value = projectCode;
        if (scenarioNameInput && !scenarioNameInput.value.trim()) scenarioNameInput.value = scenarioName;
        if (scenarioCodeInput && !scenarioCodeInput.value.trim()) scenarioCodeInput.value = scenarioCode;
    }

    function applyRestoredFormState() {
        const existingMode = state.workspaceMode === "existing";
        const newRadio = byId("projectModeNew");
        const existingRadio = byId("projectModeExisting");
        if (newRadio) newRadio.checked = !existingMode;
        if (existingRadio) existingRadio.checked = existingMode;
        const values = [
            ["projectName", "qeProjectName", state.projectName],
            ["projectCode", "qeProjectCode", state.projectCode],
            ["scenarioName", "qeScenarioName", state.scenarioName],
            ["scenarioCode", "qeScenarioCode", state.scenarioCode]
        ];
        values.forEach(([primaryId, fallbackId, value]) => {
            const input = byId(primaryId, fallbackId);
            if (input && value && !input.value) input.value = value;
        });
        if (!state.projectName && state.fileMeta?.name) generateWorkspaceDefaults(state.fileMeta.name);
    }

    function captureWorkspaceDraft() {
        state.workspaceMode = getWorkspaceMode();
        if (state.workspaceMode === "new") {
            const projectName = valueOf("projectName", "qeProjectName") || state.projectName;
            const scenarioName = valueOf("scenarioName", "qeScenarioName") || state.scenarioName;
            state.projectName = projectName;
            state.scenarioName = scenarioName;
            state.projectCode = normalizeCode(valueOf("projectCode", "qeProjectCode") || state.projectCode, makeCompactProjectCode());
            state.scenarioCode = normalizeCode(valueOf("scenarioCode", "qeScenarioCode") || state.scenarioCode, `QRULE_${makeStamp()}`);
        }
        persistState();
    }

    function getWorkspaceMode() {
        const checked = document.querySelector('input[name="workspaceMode"]:checked, input[name="projectMode"]:checked');
        if (checked) return checked.value === "existing" ? "existing" : "new";
        return byId("projectModeExisting")?.checked ? "existing" : "new";
    }

    function renderWorkspaceMode() {
        const mode = getWorkspaceMode();
        setHidden(byId("qeNewWorkspaceFields", "newWorkspaceFields"), mode !== "new");
        setHidden(byId("qeExistingWorkspaceFields", "existingWorkspaceFields"), mode !== "existing");
        document.querySelectorAll("[data-project-mode-panel]").forEach((panel) => {
            panel.hidden = panel.dataset.projectModePanel !== mode;
        });
        state.workspaceMode = mode;
        persistState();
        updateActionState();
    }

    function selectFile(file) {
        if (!file) return;
        if (pipelineBusy) {
            showToast("실행 중에는 파일을 변경할 수 없습니다.", "warning");
            return;
        }
        const extension = getExtension(file.name);
        if (!ALLOWED_EXTENSIONS.has(extension)) {
            rejectFileSelection("CSV, TSV, TXT, XLSX, XLSM 파일만 사용할 수 있습니다.");
            return;
        }
        if (file.size <= 0) {
            rejectFileSelection("빈 파일은 업로드할 수 없습니다.");
            return;
        }
        if (state.projectId || state.tableName || state.flowRunId) {
            resetPipelineState({ keepForm: false, announce: false });
        }
        selectedFile = file;
        state.fileMeta = {
            name: file.name,
            size: file.size,
            type: file.type || extension,
            lastModified: file.lastModified || null
        };
        state.error = "";
        generateWorkspaceDefaults(file.name);
        persistState();
        renderFile();
        renderState();
    }

    function rejectFileSelection(message) {
        selectedFile = null;
        const fileInput = byId("sourceFile", "qeFileInput");
        if (fileInput) fileInput.value = "";
        if (!state.uploadId && !state.tableName) {
            state.fileMeta = null;
        }
        persistState();
        renderState();
        showToast(message, "error");
    }

    function renderFile() {
        const meta = selectedFile
            ? { name: selectedFile.name, size: selectedFile.size }
            : state.fileMeta;
        setText(byId("fileName", "qeFileName"), meta?.name || "선택된 파일이 없습니다.");
        setText(byId("fileMeta", "qeFileMeta"), meta ? `${R.formatBytes(meta.size)} · ${getExtension(meta.name).toUpperCase()}` : "CSV 또는 Excel 파일을 선택하세요.");
        const dropZone = byId("fileDropZone", "qeDropZone");
        dropZone?.classList.toggle("has-file", Boolean(meta));
        if (dropZone) dropZone.dataset.state = meta ? "selected" : "empty";
        const csvHeaderRequired = getExtension(meta?.name || "") === "csv";
        const headerOption = byId("hasHeader", "qeHasHeader");
        const headerField = headerOption?.closest(".qe-check-field");
        const headerHelp = headerField?.querySelector("[data-header-option-help]");
        if (csvHeaderRequired && headerOption?.type === "checkbox") headerOption.checked = true;
        if (headerField) headerField.dataset.csvHeaderRequired = csvHeaderRequired ? "true" : "false";
        setText(
            headerHelp,
            csvHeaderRequired
                ? "CSV는 첫 행 컬럼명이 필수이므로 자동으로 고정됩니다."
                : "CSV 선택 시 필수로 고정되며, 그 외 형식은 필요하면 변경할 수 있습니다."
        );
    }

    function renderUploadProgress() {
        const container = document.querySelector("[data-upload-progress]");
        if (!container) return;
        const visible = state.status === "running"
            && state.currentStep === 0
            && !state.completedSteps.includes(0);
        container.hidden = !visible;
        if (!visible) return;
        const percent = Math.max(0, Math.min(100, Math.round(state.stepProgress * 100)));
        const progress = container.querySelector("progress");
        if (progress) progress.value = percent;
        setText(container.querySelector("[data-upload-progress-label]"), `서버 업로드 중 · ${percent}%`);
    }

    function getFileOptions() {
        const fileName = selectedFile?.name || state.fileMeta?.name || "";
        const extension = getExtension(fileName);
        const hasHeaderElement = byId("hasHeader", "qeHasHeader");
        const hasHeader = extension === "csv"
            ? "Y"
            : hasHeaderElement?.type === "checkbox"
            ? (hasHeaderElement.checked ? "Y" : "N")
            : (String(hasHeaderElement?.value || "Y").toUpperCase() === "N" ? "N" : "Y");
        const typeMap = { csv: "csv", tsv: "tsv", txt: "delimited", xlsx: "excel", xlsm: "excel" };
        const delimiterValue = valueOf("fileDelimiter", "qeDelimiter");
        const delimiter = extension === "tsv" || delimiterValue === "tab"
            ? "\t"
            : (!delimiterValue || delimiterValue === "auto" ? "," : delimiterValue);
        return {
            fileName,
            tableComment: getBaseName(fileName),
            fileType: typeMap[extension] || "csv",
            delimiter,
            fixedWidths: "",
            hasHeader,
            encoding: valueOf("fileEncoding", "qeEncoding") || "auto"
        };
    }

    async function loadProjects() {
        const response = await client.getProjects();
        projectRows = Array.isArray(response.data) ? response.data : [];
        const select = byId("existingProject", "qeProjectSelect");
        if (!select) return;
        const selectedValue = String(state.workspaceMode === "existing" ? state.projectId || select.value || "" : select.value || "");
        select.innerHTML = '<option value="">프로젝트 선택</option>' + projectRows.map((row) => {
            const id = row.PROJECT_ID;
            const name = row.PROJECT_NAME || row.PROJECT_CODE || id;
            return `<option value="${R.escapeHtml(id)}">${R.escapeHtml(name)} [${R.escapeHtml(row.PROJECT_CODE || "-")}]</option>`;
        }).join("");
        if (selectedValue && projectRows.some((row) => String(row.PROJECT_ID) === selectedValue)) {
            select.value = selectedValue;
            await loadScenarios(selectedValue);
        }
    }

    async function loadScenarios(projectId) {
        const select = byId("existingScenario", "qeScenarioSelect");
        if (select) select.innerHTML = '<option value="">불러오는 중...</option>';
        scenarioRows = [];
        if (!projectId) {
            if (select) {
                select.innerHTML = '<option value="">프로젝트를 먼저 선택하세요</option>';
                select.disabled = true;
            }
            return;
        }
        const response = await client.getScenarios(projectId);
        scenarioRows = Array.isArray(response.data) ? response.data : [];
        if (!select) return;
        select.disabled = false;
        const selectedValue = String(state.workspaceMode === "existing" ? state.scenarioId || "" : "");
        select.innerHTML = '<option value="">시나리오 선택</option>' + scenarioRows.map((row) => {
            const id = row.SCENARIO_ID;
            const name = row.SCENARIO_NAME || row.SCENARIO_CODE || id;
            return `<option value="${R.escapeHtml(id)}">${R.escapeHtml(name)} [${R.escapeHtml(row.SCENARIO_CODE || "-")}]</option>`;
        }).join("");
        if (selectedValue && scenarioRows.some((row) => String(row.SCENARIO_ID) === selectedValue)) {
            select.value = selectedValue;
        }
    }

    function validateStart() {
        if (!state.uploadId && !state.tableName && !selectedFile) {
            throw new Error("먼저 업로드할 파일을 선택해 주세요.");
        }
        if (state.projectId && state.scenarioId) return;
        const mode = getWorkspaceMode();
        if (mode === "new") {
            if (!valueOf("projectName", "qeProjectName") && !state.projectName) throw new Error("프로젝트 이름을 입력해 주세요.");
            if (!valueOf("scenarioName", "qeScenarioName") && !state.scenarioName) throw new Error("시나리오 이름을 입력해 주세요.");
        } else {
            if (!valueOf("existingProject", "qeProjectSelect")) throw new Error("기존 프로젝트를 선택해 주세요.");
            if (!valueOf("existingScenario", "qeScenarioSelect")) throw new Error("기존 시나리오를 선택해 주세요.");
        }
    }

    function setStep(index, message, progress = 0) {
        state.currentStep = Math.max(0, Math.min(STEP_COUNT - 1, Number(index) || 0));
        state.stepProgress = Math.max(0, Math.min(1, Number(progress) || 0));
        state.error = "";
        state.lastRunMessage = message || state.lastRunMessage;
        persistState();
        renderState(message);
    }

    function completeStep(index, message) {
        if (!state.completedSteps.includes(index)) state.completedSteps.push(index);
        state.completedSteps.sort((a, b) => a - b);
        state.currentStep = Math.min(STEP_COUNT - 1, index + 1);
        state.stepProgress = 0;
        if (message) state.lastRunMessage = message;
        persistState();
        renderState(message);
    }

    function updateResultDetailAction() {
        const detailButton = byId("qeOpenDetailedAnalysis");
        const canOpenDetail = Boolean(
            state.completedSteps.includes(7)
            && state.projectId
            && state.scenarioId
            && state.flowRunId
        );
        setHidden(detailButton, !canOpenDetail);
        if (detailButton) detailButton.disabled = !canOpenDetail || pipelineBusy;
    }

    function renderStepper() {
        const stepper = byId("qeStepper");
        const isRunning = state.status === "running";
        if (stepper) {
            stepper.classList.toggle("is-running", isRunning);
            stepper.setAttribute("aria-busy", isRunning ? "true" : "false");
        }
        const stepElements = [...document.querySelectorAll("[data-step], [data-step-key]")];
        let currentElement = null;
        stepElements.forEach((element, fallbackIndex) => {
            const dataIndex = element.dataset.step;
            const keyIndex = STEPS.findIndex((step) => step.key === element.dataset.stepKey);
            const index = dataIndex !== undefined && dataIndex !== "" ? Number(dataIndex) : (keyIndex >= 0 ? keyIndex : fallbackIndex);
            const complete = state.completedSteps.includes(index);
            const active = index === state.currentStep && !complete && state.status !== "success";
            const failed = active && state.status === "failed";
            element.classList.toggle("is-complete", complete);
            element.classList.toggle("is-active", active && !failed);
            element.classList.toggle("is-failed", failed);
            element.dataset.state = complete ? "complete" : (failed ? "failed" : (active ? "current" : "waiting"));
            if (active) element.setAttribute("aria-current", "step");
            else element.removeAttribute("aria-current");
            if (index === state.currentStep) currentElement = element;
        });
        updateResultDetailAction();
        renderProcessSelection();
        if (currentElement && lastRenderedStep !== state.currentStep) {
            lastRenderedStep = state.currentStep;
            const viewport = currentElement.closest(".qe-stepper-wrap");
            if (viewport && viewport.scrollWidth > viewport.clientWidth && typeof viewport.scrollTo === "function") {
                const targetLeft = Math.max(
                    0,
                    currentElement.offsetLeft - ((viewport.clientWidth - currentElement.offsetWidth) / 2)
                );
                const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
                viewport.scrollTo({ left: targetLeft, behavior: reduceMotion ? "auto" : "smooth" });
            }
        }
    }

    function getDatasetMetrics() {
        const metrics = [];
        const columnCount = Number(state.columnCount);
        const rowCount = Number(state.rowCount);
        if (state.columnCount !== null && Number.isFinite(columnCount) && columnCount >= 0) {
            metrics.push(`컬럼 ${R.formatNumber(columnCount, 0)}개`);
        }
        if (state.rowCount !== null && Number.isFinite(rowCount) && rowCount >= 0) {
            metrics.push(`로우 ${R.formatNumber(rowCount, 0)}건`);
        }
        return metrics;
    }

    function renderArtifacts() {
        const target = byId("artifactList", "qeArtifactList");
        if (!target) return;
        const artifacts = {
            project: state.projectId ? `${state.projectName || state.projectCode} · #${state.projectId}` : "대기",
            scenario: state.scenarioId ? `${state.scenarioName || state.scenarioCode} · #${state.scenarioId}` : "대기",
            table: state.tableName ? `${state.tableOwner}.${state.tableName}` : "대기",
            models: state.jobIds.length === modelStageCount() ? `${processLabel()} ${modelStageCount()}단계 완료` : (state.jobIds.length ? `${state.jobIds.length}/${modelStageCount()}단계 확인 필요` : `${modelStageCount()}단계 대기`),
            flow: state.flowId ? `${state.flowName || "자동 설계"} · #${state.flowId}` : "대기",
            run: state.flowRunId ? `#${state.flowRunId}` : "대기"
        };
        const completeKeys = new Set([
            state.projectId && "project",
            state.scenarioId && "scenario",
            state.tableName && "table",
            state.jobIds.length === modelStageCount() && "models",
            state.flowId && "flow",
            state.flowRunId && "run"
        ].filter(Boolean));
        Object.entries(artifacts).forEach(([key, value]) => {
            const item = target.querySelector(`[data-artifact="${key}"]`);
            if (!item) return;
            item.dataset.state = completeKeys.has(key) ? "success" : "waiting";
            item.classList.toggle("is-complete", completeKeys.has(key));
            const valueTarget = item.querySelector("[data-artifact-value]") || item.querySelector("dd");
            setText(valueTarget, value);
        });

        const tableItem = target.querySelector('[data-artifact="table"]');
        const tableMetrics = tableItem?.querySelector("[data-artifact-metrics]");
        if (tableMetrics) {
            const metrics = getDatasetMetrics();
            setText(tableMetrics, metrics.join(" · "));
            tableMetrics.hidden = !state.tableName || metrics.length === 0;
        }

        const designTiming = target.querySelector("[data-design-timing]");
        const designSeconds = Number(state.designTimings?.totalSeconds);
        if (designTiming) {
            setText(designTiming, Number.isFinite(designSeconds) && designSeconds >= 0
                ? `모델·FLOW 설계 ${formatMeasuredSeconds(designSeconds)}`
                : "");
            designTiming.hidden = !Number.isFinite(designSeconds) || designSeconds < 0;
        }
    }

    function formatMeasuredSeconds(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 0) return "-";
        if (seconds < 1) return `${seconds.toFixed(3)}초`;
        return `${seconds.toFixed(1)}초`;
    }

    function renderTargetStageTimings() {
        const details = byId("qeTargetTimingDetails");
        const timings = state.targetStageTimings;
        if (!details || !timings || typeof timings !== "object") {
            setHidden(details, true);
            return;
        }
        const groups = [
            ["XLSX 스키마 확인", Number(timings.schemaInspectionSeconds)],
            ["파일 체크섬", Number(timings.checksumSeconds)],
            ["행 파싱·바인드", Number(timings.parseAndBindSeconds)],
            ["Oracle 적재", Number(timings.oracleLoadSeconds)],
            ["적재 커밋", Number(timings.commitSeconds)],
            ["행수 검증", Number(timings.rowValidationSeconds)],
            ["통계 수집", Number(timings.statisticsSeconds)],
            ["DB 준비", Number(timings.dbSetupSeconds)],
            ["테이블 게시", Number(timings.publishSeconds)],
            ["HTTP·기타 대기", Number(timings.uploadRequestOverheadSeconds)],
            ["테이블 조회", Number(timings.tableLookupSeconds)],
            ["테이블 등록", Number(timings.tableRegistrationSeconds)]
        ].filter(([, seconds]) => Number.isFinite(seconds) && seconds >= 0);
        if (!groups.length) {
            setHidden(details, true);
            return;
        }
        const totalSeconds = Number(timings.totalSeconds);
        const bottleneck = groups.reduce((slowest, current) => current[1] > slowest[1] ? current : slowest, groups[0]);
        setText(details.querySelector("[data-target-timing-total]"), formatMeasuredSeconds(totalSeconds));
        setText(
            details.querySelector("[data-target-timing-bottleneck]"),
            `가장 오래 걸린 구간: ${bottleneck[0]} ${formatMeasuredSeconds(bottleneck[1])}`
        );
        const list = details.querySelector("[data-target-timing-list]");
        if (list) {
            list.innerHTML = groups.map(([label, seconds]) => `
                <div><dt>${R.escapeHtml(label)}</dt><dd>${R.escapeHtml(formatMeasuredSeconds(seconds))}</dd></div>
            `).join("");
        }
        setHidden(details, false);
    }

    function renderResultDatasetSummary() {
        const summary = document.querySelector("[data-result-dataset-summary]");
        const metricsTarget = summary?.querySelector("[data-result-dataset-metrics]");
        if (!summary || !metricsTarget) return;

        const metrics = getDatasetMetrics();
        setText(metricsTarget, metrics.join(" · "));
        summary.hidden = metrics.length === 0;
    }

    function renderWorkspaceSummary() {
        const summary = byId("qeWorkspaceSummary");
        if (!summary) return;
        const completed = ["success", "warning"].includes(state.status)
            && state.completedSteps.includes(7)
            && state.projectId
            && state.scenarioId;
        setHidden(summary, !completed);
        if (!completed) return;

        setText(summary.querySelector("[data-workspace-summary-badge]"), state.historyView
            ? "과거 실행 작업공간"
            : (state.workspaceMode === "new" ? "자동 생성 완료" : "기존 작업 사용"));
        setText(summary.querySelector("[data-workspace-project-code]"), state.projectCode || `#${state.projectId}`);
        setText(summary.querySelector("[data-workspace-project-name]"), state.projectName || "-");
        setText(summary.querySelector("[data-workspace-scenario-code]"), state.scenarioCode || `#${state.scenarioId}`);
        setText(summary.querySelector("[data-workspace-scenario-name]"), state.scenarioName || "-");

        const projectCreated = summary.querySelector("[data-workspace-project-created]");
        const scenarioCreated = summary.querySelector("[data-workspace-scenario-created]");
        setText(projectCreated, state.projectCreatedAt
            ? `생성 ${R.formatFullDateTime(state.projectCreatedAt)}`
            : "생성시간 확인 불가");
        setText(scenarioCreated, state.scenarioCreatedAt
            ? `생성 ${R.formatFullDateTime(state.scenarioCreatedAt)}`
            : "생성시간 확인 불가");
        if (state.projectCreatedAt) projectCreated?.setAttribute("datetime", String(state.projectCreatedAt));
        else projectCreated?.removeAttribute("datetime");
        if (state.scenarioCreatedAt) scenarioCreated?.setAttribute("datetime", String(state.scenarioCreatedAt));
        else scenarioCreated?.removeAttribute("datetime");
    }

    function renderHistoryView() {
        const banner = byId("qeHistoryViewBanner");
        const enabled = Boolean(state.historyView && state.flowRunId);
        setHidden(banner, !enabled);
        document.body.classList.toggle("qe-is-history-view", enabled);
        if (!enabled) return;

        setText(
            banner?.querySelector("[data-history-view-label]"),
            isMixedXai()
                ? `실행 #${state.flowRunId} · 혼합형 XAI · 저장된 독립 시나리오를 재실행할 수 있습니다.`
                : `실행 #${state.flowRunId} · ${state.projectName || state.projectCode || "프로젝트"} · 컬럼 유형은 편집·저장 후 같은 실행 ID로 재실행할 수 있습니다.`
        );
        const target = byId("qeHistoryStepResultList");
        if (!target) return;
        const storedSteps = Array.isArray(state.historySteps) ? state.historySteps : [];
        const steps = STEPS.map((step, index) => {
            const stored = storedSteps.find((item) => Number(item?.index) === index || item?.key === step.key) || {};
            const status = R.normalizeStatus(stored.status || (state.completedSteps.includes(index) ? "SUCCESS" : "PENDING"));
            return {
                title: step.title,
                status,
                message: stored.message || step.description
            };
        });
        target.innerHTML = steps.map((step, index) => `<li class="qe-history-step-result ${R.statusClass(step.status)}">
            <strong>${index + 1}단계 · ${R.escapeHtml(step.title)} · ${R.escapeHtml(R.statusLabel(step.status))}</strong>
            <span title="${R.escapeHtml(step.message)}">${R.escapeHtml(step.message)}</span>
        </li>`).join("");
    }

    function renderState(message) {
        renderProcessSelection();
        renderStepper();
        renderFile();
        renderUploadProgress();
        renderArtifacts();
        renderResultDatasetSummary();
        renderTargetStageTimings();
        renderHistoryView();
        renderWorkspaceSummary();
        const step = STEPS[state.currentStep] || STEPS[0];
        setText(byId("currentStage", "qeCurrentStepTitle"), step.title);
        const controlMessage = state.controlRequest
            ? (state.controlRequest === "STOP" ? window.RuleResultCommon.t("Stop requested. The current task will finish before the pipeline stops.") : window.RuleResultCommon.t("Pause requested. The current task will finish before the pipeline pauses."))
            : (state.status === "paused" ? window.RuleResultCommon.t("Paused. Resume continues from the next unfinished stage.")
                : (state.status === "stopped" ? window.RuleResultCommon.t("Stopped. Restart runs the saved FLOW from the beginning.") : ""));
        const description = state.error || controlMessage || message || state.lastRunMessage || step.description;
        setText(byId("currentStageMessage", "qeCurrentStepDescription"), description);

        const completed = state.completedSteps.length;
        const overall = Math.max(0, Math.min(100, Math.round(((completed + (state.status === "running" ? state.stepProgress : 0)) / STEP_COUNT) * 100)));
        const progressBar = byId("pipelineProgress", "qeProgressBar");
        if (progressBar) {
            if ("value" in progressBar) progressBar.value = overall;
            progressBar.style.setProperty("--qe-progress", `${overall}%`);
            progressBar.setAttribute("aria-valuenow", String(overall));
        }
        setText(byId("qeProgressPercent", "progressPercent") || document.querySelector("[data-progress-percent]"), `${overall}%`);
        const progressLive = byId("qeProgressPanel", "progressPanel")?.querySelector(".qe-live-pill");
        if (progressLive) {
            const liveState = state.status === "failed" ? "failed"
                : (["success", "warning"].includes(state.status) ? "success"
                    : (state.status === "running" ? "running" : "idle"));
            progressLive.dataset.state = liveState;
            setText(progressLive.querySelector("[data-progress-status]"),
                state.status === "failed" ? "확인 필요"
                    : (state.status === "success" ? "완료"
                        : (state.status === "warning" ? "일부 확인 필요"
                            : (state.status === "paused" ? window.RuleResultCommon.t("Paused") : (state.status === "stopped" ? window.RuleResultCommon.t("Stopped")
                                : (state.controlRequest ? "요청 처리 중" : (state.status === "running" ? "자동 진행 중" : "대기")))))));
        }

        const historySection = byId("historySection", "qeHistorySection");
        setHidden(historySection, !state.flowRunId);
        const resultsSection = byId("resultsSection", "qeResultsPanel");
        const hasColumnTypeResult = getColumnTypeFinalRows().length > 0;
        setHidden(resultsSection, !state.flowRunId || (!hasColumnTypeResult && !state.completedSteps.includes(7) && state.currentStep < 7));
        updateActionState();
    }

    function updateActionState() {
        const pauseButton = byId("qePauseButton");
        setText(pauseButton, window.RuleResultCommon.t("Pause"));
        setText(byId("qeStopButton"), window.RuleResultCommon.t("Stop"));
        const resumeButton = byId("qeResumeButton");
        const stopButton = byId("qeStopButton");
        const resumable = ["paused", "stopped"].includes(state.status);
        const activeRun = R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus));
        const controllable = (pipelineBusy && state.status === "running") || activeRun;
        if (pauseButton) {
            pauseButton.hidden = !controllable;
            pauseButton.disabled = controlBusy || Boolean(state.controlRequest);
        }
        if (stopButton) {
            stopButton.hidden = !controllable && state.status !== "paused";
            stopButton.disabled = controlBusy || state.controlRequest === "STOP";
        }
        if (resumeButton) {
            resumeButton.hidden = !resumable;
            resumeButton.disabled = pipelineBusy || controlBusy;
            setText(resumeButton, window.RuleResultCommon.t(state.status === "stopped" ? "Restart" : "Resume"));
        }
        const startButton = byId("runButton", "qeStartButton");
        const retryButton = byId("retryButton", "qeRetryButton");
        const historyFullRerunButton = byId("qeHistoryFullRerunButton");
        const historyFailedRerunButton = byId("qeHistoryFailedRerunButton");
        const resetButton = byId("resetButton", "qeResetButton");
        const historyButton = byId("qeRunHistoryButton");
        const form = byId("qeQuickForm");
        const workspaceFieldset = byId("workspaceFieldset") || form?.querySelector("[data-workspace-fieldset]");
        const readOnlyHistory = Boolean(state.historyView);
        const projectLocked = Boolean(state.projectId);
        const scenarioLocked = Boolean(state.scenarioId);
        const hasInput = Boolean(selectedFile || state.uploadId || state.tableName);
        const setRunningState = (button, action) => {
            if (!button) return;
            const running = pipelineBusy && activePipelineAction === action;
            button.classList.toggle("is-running", running);
            button.setAttribute("aria-busy", running ? "true" : "false");
        };
        if (startButton) {
            startButton.disabled = pipelineBusy || (!readOnlyHistory && (!hasInput || !client.targetConnectionId));
            startButton.hidden = resumable || (readOnlyHistory ? false : ["failed", "warning"].includes(state.status));
            setText(startButton.querySelector("span:first-child") || startButton, readOnlyHistory || state.status === "success" ? "새 작업 시작" : "전체 자동 실행");
            setRunningState(startButton, PIPELINE_ACTION.FULL_AUTO);
        }
        if (retryButton) {
            retryButton.hidden = readOnlyHistory || (
                !["failed", "warning"].includes(state.status)
                && activePipelineAction !== PIPELINE_ACTION.RETRY
            );
            retryButton.disabled = pipelineBusy || !client.targetConnectionId;
            setRunningState(retryButton, PIPELINE_ACTION.RETRY);
        }
        const hasSavedWorkspace = Boolean(state.projectId && state.scenarioId && state.flowId && state.flowRunId);
        const terminalRunStatus = R.normalizeStatus(state.lastRunStatus || currentSnapshot?.run?.STATUS || "");
        const hasFailedNode = (currentSnapshot?.nodes || []).some((node) =>
            ["FAILED", "ERROR", "CANCELLED"].includes(R.normalizeStatus(node.STATUS || node.status))
        );
        if (historyFullRerunButton) {
            historyFullRerunButton.hidden = !readOnlyHistory;
            historyFullRerunButton.disabled = pipelineBusy
                || !client.targetConnectionId
                || !hasSavedWorkspace
                || R.ACTIVE_STATUSES.has(terminalRunStatus);
            setRunningState(historyFullRerunButton, PIPELINE_ACTION.HISTORY_FULL_RERUN);
        }
        if (historyFailedRerunButton) {
            historyFailedRerunButton.hidden = !readOnlyHistory;
            historyFailedRerunButton.disabled = pipelineBusy
                || !client.targetConnectionId
                || !hasSavedWorkspace
                || R.ACTIVE_STATUSES.has(terminalRunStatus)
                || (!hasFailedNode && !["FAILED", "ERROR", "CANCELLED"].includes(terminalRunStatus));
            historyFailedRerunButton.title = historyFailedRerunButton.disabled && !pipelineBusy
                ? "실패한 실행에서만 사용할 수 있습니다."
                : "기존 실행 ID에서 최초 실패 단계와 후속 단계만 다시 실행합니다.";
            setRunningState(historyFailedRerunButton, PIPELINE_ACTION.HISTORY_FAILED_RERUN);
        }
        if (resetButton) resetButton.disabled = pipelineBusy;
        if (historyButton) historyButton.disabled = pipelineBusy;
        if (form) form.setAttribute("aria-busy", pipelineBusy ? "true" : "false");
        document.querySelectorAll("#qeQuickForm input, #qeQuickForm select, #qeQuickForm button").forEach((element) => {
            if ([startButton, retryButton, historyFullRerunButton, historyFailedRerunButton, resetButton, byId("closeButton", "qeCloseButton")].includes(element)) return;
            element.disabled = pipelineBusy || readOnlyHistory;
        });
        if (workspaceFieldset) {
            workspaceFieldset.disabled = pipelineBusy || readOnlyHistory;
            workspaceFieldset.dataset.state = projectLocked || scenarioLocked ? "locked" : "editable";
            workspaceFieldset.dataset.projectLocked = projectLocked ? "true" : "false";
            workspaceFieldset.dataset.scenarioLocked = scenarioLocked ? "true" : "false";
        }
        ["projectModeNew", "projectModeExisting", "projectName", "qeProjectName", "projectCode", "qeProjectCode", "existingProject", "qeProjectSelect"].forEach((id) => {
            const control = byId(id);
            if (control) control.disabled = pipelineBusy || readOnlyHistory || projectLocked;
        });
        ["scenarioName", "qeScenarioName", "scenarioCode", "qeScenarioCode"].forEach((id) => {
            const control = byId(id);
            if (control) control.disabled = pipelineBusy || readOnlyHistory || scenarioLocked;
        });
        const fileOptionsLocked = Boolean(state.tableName);
        ["fileEncoding", "qeEncoding", "fileDelimiter", "qeDelimiter"].forEach((id) => {
            const control = byId(id);
            if (control) control.disabled = pipelineBusy || readOnlyHistory || fileOptionsLocked;
        });
        const hasHeaderControl = byId("hasHeader", "qeHasHeader");
        const csvHeaderRequired = getExtension(selectedFile?.name || state.fileMeta?.name || "") === "csv";
        if (hasHeaderControl) {
            if (csvHeaderRequired && hasHeaderControl.type === "checkbox") hasHeaderControl.checked = true;
            hasHeaderControl.disabled = csvHeaderRequired || pipelineBusy || readOnlyHistory || fileOptionsLocked;
        }
        const fileOptions = byId("fileOptions");
        if (fileOptions) fileOptions.dataset.state = fileOptionsLocked ? "locked" : "editable";
        const workspaceLockNote = byId("workspaceLockNote");
        setHidden(workspaceLockNote, !projectLocked && !scenarioLocked);
        setText(
            workspaceLockNote,
            scenarioLocked
                ? "준비된 프로젝트와 시나리오는 현재 자동 작업에 고정됩니다. 다른 작업공간을 사용하려면 새 작업을 시작해 주세요."
                : "준비된 프로젝트는 현재 자동 작업에 고정됩니다. 시나리오 단계는 입력한 정보로 이어서 다시 시도할 수 있습니다."
        );
        const existingScenario = byId("existingScenario", "qeScenarioSelect");
        if (existingScenario) {
            existingScenario.disabled = pipelineBusy
                || readOnlyHistory
                || scenarioLocked
                || (getWorkspaceMode() === "existing" && !valueOf("existingProject", "qeProjectSelect"));
        }
        updateResultDetailAction();
        renderProcessSelection();
    }

    function haltPipeline(status) {
        state.status = status;
        state.controlRequest = "";
        state.error = "";
        persistState();
        renderState();
        const error = new Error(status);
        error.name = "AbortError";
        throw error;
    }

    function controlCheckpoint() {
        if (state.controlRequest) haltPipeline(state.controlRequest === "STOP" ? "stopped" : "paused");
    }

    async function requestPipelineControl(action) {
        if (controlBusy || (!pipelineBusy && state.status !== "paused" && !R.ACTIVE_STATUSES.has(state.lastRunStatus))) return;
        controlBusy = true;
        state.controlRequest = action;
        persistState();
        renderState();
        try {
            if (state.flowRunId && (R.ACTIVE_STATUSES.has(state.lastRunStatus) || state.lastRunStatus === "PAUSED")) {
                const response = await client.controlQuickEditRun(state.flowRunId, action);
                state.lastRunStatus = response.data?.STATUS || state.lastRunStatus;
                if (["PAUSED", "CANCELLED"].includes(state.lastRunStatus) && !pipelineBusy) {
                    state.status = state.lastRunStatus === "PAUSED" ? "paused" : "stopped";
                    state.controlRequest = "";
                }
                if (["SUCCESS", "FAILED", "ERROR"].includes(state.lastRunStatus)) state.controlRequest = "";
            } else if (!pipelineBusy) {
                state.status = action === "STOP" ? "stopped" : "paused";
                state.controlRequest = "";
            }
        } catch (error) {
            state.controlRequest = "";
            showToast(error.message || "실행 제어 요청을 저장하지 못했습니다.", "error");
        } finally {
            controlBusy = false;
            persistState();
            renderState();
        }
    }

    async function resumePipeline() {
        if (pipelineBusy || controlBusy) return;
        const stopped = state.status === "stopped";
        state.controlRequest = "";
        state.failedStageRerunRequestToken = "";
        if (!stopped && state.flowRunId && state.lastRunStatus === "PAUSED") {
            await rerunHistoryFromFailedStage();
        } else {
            state.historyView = false;
            await runPipeline({ forceNewRun: stopped && Boolean(state.flowRunId) });
        }
    }

    async function runPipeline(options = {}) {
        if (pipelineBusy) return;
        try {
            validateStart();
        } catch (error) {
            showToast(error.message, "error");
            return;
        }

        pipelineBusy = true;
        activePipelineAction = options.pipelineAction || PIPELINE_ACTION.FULL_AUTO;
        captureWorkspaceDraft();
        state.status = "running";
        state.error = "";
        state.resultWarning = "";
        const generation = ++pollGeneration;
        updateActionState();

        try {
            if (!state.uploadId && !state.tableName) {
                setStep(0, "파일을 서버 임시영역에 업로드하고 있습니다.", 0);
                const staged = await client.stageFile(selectedFile, (ratio) => {
                    state.stepProgress = ratio;
                    renderState(`파일 업로드 중 · ${Math.round(ratio * 100)}%`);
                });
                state.uploadId = staged.uploadId;
                state.fileMeta = { ...state.fileMeta, name: staged.fileName, size: staged.fileSize };
                persistState();
            }
            completeStep(0, "파일 임시 업로드가 완료되었습니다.");
            controlCheckpoint();

            await ensureProject();
            completeStep(1, "프로젝트가 준비되었습니다.");
            controlCheckpoint();

            await ensureScenario();
            completeStep(2, "시나리오가 준비되었습니다.");
            controlCheckpoint();

            await ensureTargetAndDesign();
            completeStep(4, `${processLabel()} ${modelStageCount()}단계 모델 저장이 완료되었습니다.`);
            completeStep(5, "샘플 노드 기반 FLOW가 내부에 자동 저장되었습니다.");
            controlCheckpoint();

            await ensureFlowRun(generation, options);
            completeStep(6, "FLOW 실행이 완료되었습니다.");
            controlCheckpoint();

            setStep(7, "실행 결과에서 규칙을 정리하고 있습니다.", 0.25);
            await loadResults();
            controlCheckpoint();
            completeStep(7, "자동 규칙 분석까지 모두 완료되었습니다.");
            state.status = state.resultWarning ? "warning" : "success";
            state.currentStep = 7;
            state.stepProgress = 1;
            persistState();
            renderState(state.resultWarning || "자동 실행과 결과 분석이 완료되었습니다.");
            showToast(state.resultWarning || "퀵 데이터 에디팅이 완료되었습니다.", state.resultWarning ? "warning" : "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            state.status = "failed";
            state.error = error?.message || "자동 작업 중 오류가 발생했습니다.";
            persistState();
            renderState();
            showToast(state.error, "error");
        } finally {
            pipelineBusy = false;
            activePipelineAction = "";
            updateActionState();
            renderColumnTypeFinal();
        }
    }

    async function ensureProject() {
        if (state.projectId && state.projectCode) return;
        setStep(1, "프로젝트 정보를 저장하고 있습니다.", 0.35);
        const mode = getWorkspaceMode();
        state.workspaceMode = mode;
        if (mode === "existing") {
            const projectId = Number(valueOf("existingProject", "qeProjectSelect"));
            const row = projectRows.find((item) => Number(item.PROJECT_ID) === projectId);
            if (!row) throw new Error("선택한 프로젝트 정보를 찾을 수 없습니다.");
            state.projectId = projectId;
            state.projectCode = row.PROJECT_CODE || "";
            state.projectName = row.PROJECT_NAME || row.PROJECT_CODE || `프로젝트 ${projectId}`;
            state.projectCreatedAt = row.CREATED_AT || null;
        } else {
            const fallback = makeCompactProjectCode();
            const projectCode = normalizeCode(valueOf("projectCode", "qeProjectCode") || state.projectCode, fallback);
            const projectName = valueOf("projectName", "qeProjectName") || state.projectName;
            const projectList = await client.getProjects();
            projectRows = Array.isArray(projectList.data) ? projectList.data : [];
            let row = projectRows.find((item) => String(item.PROJECT_CODE || "").toUpperCase() === projectCode.toUpperCase());
            if (!row) {
                const response = await client.saveProject({ projectCode, projectName });
                row = response.data || {};
            }
            state.projectId = Number(row.PROJECT_ID || 0);
            state.projectCode = row.PROJECT_CODE || projectCode;
            state.projectName = row.PROJECT_NAME || projectName;
            state.projectCreatedAt = row.CREATED_AT || null;
            if (!state.projectId) throw new Error("저장된 프로젝트 ID를 확인할 수 없습니다.");
        }
        persistState();
    }

    async function ensureScenario() {
        if (state.scenarioId) return;
        setStep(2, "규칙 발굴 시나리오를 저장하고 있습니다.", 0.35);
        if (state.workspaceMode === "existing") {
            const scenarioId = Number(valueOf("existingScenario", "qeScenarioSelect"));
            const row = scenarioRows.find((item) => Number(item.SCENARIO_ID) === scenarioId);
            if (!row) throw new Error("선택한 시나리오 정보를 찾을 수 없습니다.");
            if (Number(row.PROJECT_ID || state.projectId) !== Number(state.projectId)) {
                throw new Error("선택한 시나리오가 현재 프로젝트에 속하지 않습니다.");
            }
            state.scenarioId = scenarioId;
            state.scenarioCode = row.SCENARIO_CODE || "";
            state.scenarioName = row.SCENARIO_NAME || row.SCENARIO_CODE || `시나리오 ${scenarioId}`;
            state.scenarioCreatedAt = row.CREATED_AT || null;
        } else {
            const fallback = `QRULE_${makeStamp()}`;
            const scenarioCode = normalizeCode(valueOf("scenarioCode", "qeScenarioCode") || state.scenarioCode, fallback);
            const scenarioName = valueOf("scenarioName", "qeScenarioName") || state.scenarioName;
            const scenarioList = await client.getScenarios(state.projectId);
            scenarioRows = Array.isArray(scenarioList.data) ? scenarioList.data : [];
            let row = scenarioRows.find((item) => String(item.SCENARIO_CODE || "").toUpperCase() === scenarioCode.toUpperCase());
            if (!row) {
                const response = await client.saveScenario({
                    projectId: state.projectId,
                    scenarioCode,
                    scenarioName
                });
                row = response.data || {};
            }
            state.scenarioId = Number(row.SCENARIO_ID || 0);
            state.scenarioCode = row.SCENARIO_CODE || scenarioCode;
            state.scenarioName = row.SCENARIO_NAME || scenarioName;
            state.scenarioCreatedAt = row.CREATED_AT || null;
            if (!state.scenarioId) throw new Error("저장된 시나리오 ID를 확인할 수 없습니다.");
        }
        persistState();
    }

    async function ensureTargetAndDesign() {
        const targetStageStartedAt = performance.now();
        let uploadTimings = state.targetStageTimings || {};
        setStep(3, state.tableName ? "대상 테이블 등록 상태를 확인하고 있습니다." : "파일을 INITUP$ 대상 테이블로 적재하고 있습니다.", 0.15);
        const fileOptions = getFileOptions();
        if (!state.tableName) {
            if (!state.uploadId) throw new Error("완료된 파일 업로드 정보를 찾을 수 없습니다. 파일을 다시 선택해 주세요.");
            const uploadRequestStartedAt = performance.now();
            const upload = await client.finalizeStagedUpload(state.uploadId, fileOptions, {
                projectId: state.projectId,
                projectCode: state.projectCode
            });
            const uploadRequestSeconds = (performance.now() - uploadRequestStartedAt) / 1000;
            state.tableName = String(upload.tableName || "").toUpperCase();
            const uploadedColumns = Array.isArray(upload.columns) ? upload.columns : [];
            const responseColumnCount = Number(upload.columnCount);
            state.columnCount = upload.columnCount !== null
                && upload.columnCount !== undefined
                && Number.isFinite(responseColumnCount)
                && responseColumnCount >= 0
                ? responseColumnCount
                : uploadedColumns.filter((column) => String(column || "").toUpperCase() !== "FILE_ROW_NO").length;
            state.rowCount = Number(upload.rowCount || 0);
            uploadTimings = {
                ...(upload.timings || {}),
                uploadRequestSeconds,
                uploadRequestOverheadSeconds: Math.max(
                    0,
                    uploadRequestSeconds - (Number(upload.timings?.totalSeconds) || 0)
                )
            };
            state.targetStageTimings = uploadTimings;
            state.uploadId = null;
            if (!state.tableName.startsWith("INITUP$")) {
                throw new Error("업로드된 INITUP$ 테이블 정보를 확인할 수 없습니다.");
            }
            persistState();
        }

        if (!state.tableOwner) {
            setStep(3, "생성된 대상 테이블의 소유자를 확인하고 있습니다.", 0.45);
            const tableLookupStartedAt = performance.now();
            const tree = await client.getUploadTable(state.projectId, state.projectCode, state.tableName);
            uploadTimings.tableLookupSeconds = (performance.now() - tableLookupStartedAt) / 1000;
            const rows = Array.isArray(tree.data) ? tree.data : [];
            const row = rows.find((item) => String(item.TABLE_NAME || "").toUpperCase() === state.tableName);
            if (!row?.OWNER) throw new Error("생성된 대상 테이블을 현재 프로젝트에서 찾을 수 없습니다.");
            state.tableOwner = String(row.OWNER).toUpperCase();
            persistState();
        }

        const designComplete = Boolean(
            state.scenarioTableId
            && state.flowId
            && Array.isArray(state.jobIds)
            && state.jobIds.length === modelStageCount()
        );
        if (!state.scenarioTableId) {
            setStep(3, "대상 테이블을 현재 시나리오에 등록하고 있습니다.", 0.75);
            const registrationStartedAt = performance.now();
            const registration = await client.saveScenarioTable({
                scenarioTableId: null,
                projectId: state.projectId,
                scenarioId: state.scenarioId,
                ownerName: state.tableOwner,
                tableName: state.tableName,
                tableComment: fileOptions.tableComment,
                processType: state.processType
            });
            const registrationRequestSeconds = (performance.now() - registrationStartedAt) / 1000;
            const saved = registration.data || {};
            state.scenarioTableId = Number(saved.SCENARIO_TABLE_ID || 0);
            if (!state.scenarioTableId) throw new Error("대상 테이블 등록 ID를 확인할 수 없습니다.");
            uploadTimings.tableRegistrationSeconds = registrationRequestSeconds;
            const measuredStageSeconds = [
                uploadTimings.uploadRequestSeconds,
                uploadTimings.tableLookupSeconds,
                uploadTimings.tableRegistrationSeconds
            ].reduce((sum, value) => sum + (Number(value) || 0), 0);
            uploadTimings.totalSeconds = measuredStageSeconds > 0
                ? measuredStageSeconds
                : (performance.now() - targetStageStartedAt) / 1000;
            state.targetStageTimings = uploadTimings;
            persistState();
        }
        completeStep(3, `대상 테이블 등록 완료 · 컬럼 ${R.formatNumber(state.columnCount, 0)}개 · 로우 ${R.formatNumber(state.rowCount, 0)}건`);

        if (!designComplete) {
            setStep(4, `${processLabel()} ${modelStageCount()}단계 모델과 FLOW 설계를 저장하고 있습니다.`, 0.25);
            const design = await client.provisionDefaultDesign({
                projectId: state.projectId,
                scenarioId: state.scenarioId,
                scenarioTableId: state.scenarioTableId,
                processType: state.processType
            });
            const automation = design.automation || {};
            if (automation.status !== "success") {
                throw new Error(automation.message || "대상 테이블은 등록되었지만 선택한 시나리오의 자동 설계에 실패했습니다.");
            }
            state.jobIds = Array.isArray(automation.jobIds)
                ? [...new Set(automation.jobIds.map(Number).filter((jobId) => Number.isInteger(jobId) && jobId > 0))]
                : [];
            state.flowId = Number(automation.flowId || 0);
            state.flowName = automation.flowName || "자동 규칙 발굴 FLOW";
            state.designTimings = automation.timings || design.timings || null;
            if (!state.scenarioTableId || state.jobIds.length !== modelStageCount() || !state.flowId) {
                throw new Error("선택한 시나리오의 모델 또는 FLOW 저장 결과가 완전하지 않습니다.");
            }
            persistState();
        }
    }

    async function ensureFlowRun(generation, options = {}) {
        setStep(6, state.flowRunId ? "기존 실행 상태를 이어서 조회합니다." : "서버에 저장된 FLOW를 자동 실행합니다.", 0.1);
        if (options.forceNewRun) {
            if (state.flowRunId) {
                state.previousFlowRunIds = [...state.previousFlowRunIds, state.flowRunId].slice(-5);
            }
            state.flowRunId = null;
            state.runRequestToken = "";
            state.lastRunStatus = "";
            currentSnapshot = null;
            persistState();
        }
        if (!state.flowRunId) {
            if (!state.runRequestToken) {
                state.runRequestToken = makeRunRequestToken();
                persistState();
            }
            const response = await client.runSavedFlow(
                state.flowId,
                state.projectId,
                state.scenarioId,
                state.runRequestToken,
                buildQuickEditSummary()
            );
            state.flowRunId = Number(response.data?.flowRunId || 0);
            state.lastRunStatus = response.data?.runStatus || "STARTED";
            if (!state.flowRunId) throw new Error("FLOW 실행 ID를 확인할 수 없습니다.");
            persistState();
            renderState("FLOW 실행이 시작되었습니다. 상세 이력을 자동 조회합니다.");
        }
        if (state.controlRequest) await client.controlQuickEditRun(state.flowRunId, state.controlRequest);
        await pollRunUntilTerminal(generation);
    }

    function buildQuickEditSummary() {
        return {
            source: "QUICK_EDIT",
            processType: state.processType,
            flowType: isMixedXai() ? "MIXED_XAI_SCENARIO" : "INTEGRATED_EDITING_SCENARIO",
            projectCode: state.projectCode,
            projectName: state.projectName,
            projectCreatedAt: state.projectCreatedAt,
            scenarioCode: state.scenarioCode,
            scenarioName: state.scenarioName,
            scenarioCreatedAt: state.scenarioCreatedAt,
            scenarioTableId: state.scenarioTableId,
            ownerName: state.tableOwner,
            tableName: state.tableName,
            fileName: state.fileMeta?.name || "",
            fileSize: Number(state.fileMeta?.size || 0),
            estimatedColumnCount: state.columnCount === null ? null : Number(state.columnCount || 0),
            estimatedRowCount: Number(state.rowCount || 0),
            flowName: state.flowName,
            jobCount: state.jobIds.length
        };
    }

    async function monitorActiveRun() {
        pipelineBusy = true;
        state.status = "running";
        const generation = ++pollGeneration;
        updateActionState();
        try {
            await pollRunUntilTerminal(generation);
            if (!state.completedSteps.includes(6)) state.completedSteps.push(6);
            state.currentStep = 7;
            await loadResults();
            controlCheckpoint();
            if (!state.completedSteps.includes(7)) state.completedSteps.push(7);
            state.status = state.resultWarning ? "warning" : "success";
            persistState();
            renderState(state.resultWarning || "자동 실행과 결과 분석이 완료되었습니다.");
        } catch (error) {
            if (error?.name === "AbortError") return;
            state.status = "failed";
            state.error = error.message;
            persistState();
            renderState();
        } finally {
            pipelineBusy = false;
            updateActionState();
            renderColumnTypeFinal();
        }
    }

    async function fetchSnapshot(options = {}) {
        if (!state.flowRunId || snapshotBusy) return currentSnapshot;
        snapshotBusy = true;
        try {
            const response = await client.getRunSnapshot(state.flowRunId, state.projectId, state.scenarioId);
            currentSnapshot = response.data || { run: {}, nodes: [] };
            const run = currentSnapshot.run || {};
            state.lastRunStatus = R.normalizeStatus(run.STATUS || state.lastRunStatus);
            if (state.lastRunStatus === "PAUSED") state.status = "paused";
            if (state.lastRunStatus === "CANCELLED") state.status = "stopped";
            state.lastRunMessage = run.MESSAGE || state.lastRunMessage;
            persistState();
            renderHistory();
            if (!options.silent) showToast("실행 이력을 새로 조회했습니다.", "success");
            return currentSnapshot;
        } finally {
            snapshotBusy = false;
        }
    }

    async function pollRunUntilTerminal(generation) {
        let failures = 0;
        while (generation === pollGeneration && state.flowRunId) {
            try {
                const snapshot = await fetchSnapshot({ silent: true });
                failures = 0;
                const runStatus = R.normalizeStatus(snapshot?.run?.STATUS || state.lastRunStatus);
                const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
                const successCount = nodes.filter((node) => R.normalizeStatus(node.STATUS) === "SUCCESS").length;
                state.stepProgress = Math.min(0.95, nodes.length ? successCount / nodes.length : 0.15);
                renderState(`실행 #${state.flowRunId} · ${R.statusLabel(runStatus)} · ${successCount}/${nodes.length || modelStageCount()} 단계 완료`);
                if (runStatus === "SUCCESS") { state.controlRequest = ""; return snapshot; }
                if (runStatus === "PAUSED") haltPipeline("paused");
                if (runStatus === "CANCELLED") haltPipeline("stopped");
                if (runStatus === "PAUSE_REQUESTED") state.controlRequest = "PAUSE";
                if (runStatus === "STOP_REQUESTED") state.controlRequest = "STOP";
                if (["FAILED", "ERROR", "CANCELLED"].includes(runStatus)) {
                    state.controlRequest = "";
                    throw new Error(snapshot?.run?.MESSAGE || `FLOW 실행이 ${R.statusLabel(runStatus)} 상태로 종료되었습니다.`);
                }
            } catch (error) {
                if (error?.name === "AbortError") throw error;
                if (["FAILED", "ERROR", "CANCELLED"].includes(R.normalizeStatus(state.lastRunStatus))) throw error;
                failures += 1;
                if (failures >= 6) throw new Error(`실행 이력을 계속 조회하지 못했습니다. 실행 #${state.flowRunId}은 서버에서 계속될 수 있습니다. 다시 시도해 주세요.`);
                renderState(`실행은 계속됩니다. 이력 조회를 ${Math.min(60, 5 * 2 ** failures)}초 뒤 다시 시도합니다.`);
                await delay(Math.min(60000, 5000 * 2 ** failures));
                continue;
            }
            await delay(document.hidden ? 10000 : 3000);
        }
        throw new Error("실행 상태 조회가 중단되었습니다.");
    }

    function getNodeResultLabel(node) {
        let output = node?.RUN_OUTPUT_JSON;
        if (typeof output === "string" && output.trim()) {
            try {
                output = JSON.parse(output);
            } catch (_error) {
                output = null;
            }
        }
        const objects = Array.isArray(output?.resultObjects) ? output.resultObjects : [];
        const labels = objects.map((item) => item.label || item.objectName).filter(Boolean);
        if (labels.length) return labels.slice(0, 2).join(", ");
        if (output?.resultObjectName) return output.resultObjectName;
        const status = R.normalizeStatus(node?.STATUS);
        return status === "SUCCESS" ? "생성 완료" : (status === "SKIPPED" ? "건너뜀" : "-");
    }

    function renderNodeMessage(message, status) {
        const text = String(message || "-").replace(/\r\n?/g, "\n").trim() || "-";
        const normalizedStatus = R.normalizeStatus(status);
        const failed = ["FAILED", "ERROR", "CANCELLED"].includes(normalizedStatus);
        if (failed) {
            return `<pre class="qe-history-message__full is-error">${R.escapeHtml(text)}</pre>`;
        }

        const lines = text.split("\n");
        let summaryIndex = lines.findIndex((line) => {
            const value = line.trim();
            return value && !/^DBMS_OUTPUT\s*:?$/i.test(value);
        });
        if (summaryIndex < 0) summaryIndex = 0;
        const summary = String(lines[summaryIndex] || "-").trim() || "-";
        const detail = lines.filter((_line, index) => index !== summaryIndex).join("\n").trim();
        if (!detail) {
            return `<span class="qe-history-message__summary">${R.escapeHtml(summary)}</span>`;
        }

        const warningCount = (text.match(/\[WARN(?:ING)?\]/gi) || []).length;
        const errorCount = (text.match(/\[ERROR\]/gi) || []).length;
        const tone = errorCount ? "is-error" : (warningCount ? "is-warning" : "");
        const detailLabel = errorCount
            ? `상세 로그 · 오류 ${errorCount}건`
            : (warningCount ? `상세 로그 · 경고 ${warningCount}건` : "상세 로그 보기");
        return `<span class="qe-history-message__summary">${R.escapeHtml(summary)}</span>
            <details class="qe-history-log ${tone}"${errorCount ? " open" : ""}>
                <summary>${R.escapeHtml(detailLabel)}</summary>
                <pre>${R.escapeHtml(detail)}</pre>
            </details>`;
    }

    function renderHistory() {
        const historyLive = byId("historyLive", "qeHistoryLive");
        const historyUpdated = byId("historyUpdatedAt", "qeHistoryUpdatedAt");
        const runSummary = byId("runSummary", "qeRunSummary");
        const target = byId("historyRows", "qeHistoryBody");
        const snapshot = currentSnapshot || { run: {}, nodes: [] };
        const run = snapshot.run || {};
        const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
        const runStatus = R.normalizeStatus(run.STATUS || state.lastRunStatus || "PENDING");
        const historyLiveLabel = historyLive?.querySelector("[data-history-live-label]") || historyLive;
        setText(historyLiveLabel, `실행 #${state.flowRunId || "-"} ${R.statusLabel(runStatus)}`);
        if (historyLive) historyLive.dataset.state = R.statusClass(runStatus).replace("is-", "");
        setText(historyUpdated, new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
        setText(byId("qeRunStatus"), R.statusLabel(runStatus));
        setText(byId("qeRunMessage"), run.MESSAGE || state.lastRunMessage || "실행 준비 중");
        setText(byId("qeRunStartedAt"), R.formatDateTime(run.STARTED_AT || run.CREATED_AT));
        setText(byId("qeRunElapsed"), R.formatDuration(run.STARTED_AT || run.CREATED_AT, run.FINISHED_AT, runStatus));
        if (runSummary) {
            runSummary.dataset.state = R.statusClass(runStatus).replace("is-", "");
            setText(runSummary.querySelector("[data-run-message]"), run.MESSAGE || state.lastRunMessage || "실행 준비 중");
            setText(runSummary.querySelector("[data-run-status]"), R.statusLabel(runStatus));
            setText(runSummary.querySelector("[data-run-id]"), `#${state.flowRunId || "-"}`);
            setText(runSummary.querySelector("[data-run-started]"), R.formatDateTime(run.STARTED_AT || run.CREATED_AT));
            setText(runSummary.querySelector("[data-run-elapsed]"), R.formatDuration(run.STARTED_AT || run.CREATED_AT, run.FINISHED_AT, runStatus));
        }
        if (!target) return;
        const rows = nodes.map((node, index) => {
            const status = R.normalizeStatus(node.STATUS);
            const elapsed = R.formatDuration(node.STARTED_AT, node.FINISHED_AT, status);
            const message = node.MESSAGE || (status === "PENDING" ? "앞 단계 완료를 기다리고 있습니다." : "-");
            const messageMarkup = renderNodeMessage(message, status);
            const resultLabel = getNodeResultLabel(node);
            if (target.tagName === "TBODY") {
                return `<tr class="qe-history-row ${R.statusClass(status)}">
                    <td data-label="No">${index + 1}</td>
                    <td data-label="단계"><strong>${R.escapeHtml(node.NODE_NAME || node.NODE_KEY || `단계 ${index + 1}`)}</strong><small>${R.escapeHtml(node.REF_MENU_CODE || node.NODE_TYPE || "")}</small></td>
                    <td data-label="결과">${R.escapeHtml(resultLabel)}</td>
                    <td data-label="상태">${R.renderStatus(status)}</td>
                    <td data-label="시간">${R.escapeHtml(elapsed)}</td>
                    <td data-label="메시지" class="qe-history-message">${messageMarkup}</td>
                </tr>`;
            }
            return `<article class="qe-history-row ${R.statusClass(status)}">
                <span class="qe-history-index">${index + 1}</span>
                <div><strong>${R.escapeHtml(node.NODE_NAME || node.NODE_KEY || `단계 ${index + 1}`)}</strong><small>${R.escapeHtml(node.REF_MENU_CODE || node.NODE_TYPE || "")}</small></div>
                <span>${R.escapeHtml(resultLabel)}</span>
                ${R.renderStatus(status)}
                <span>${R.escapeHtml(elapsed)}</span>
                <div class="qe-history-message">${messageMarkup}</div>
            </article>`;
        });
        target.innerHTML = rows.length
            ? rows.join("")
            : (target.tagName === "TBODY"
                ? '<tr class="qe-empty-row"><td colspan="6" class="qe-empty">실행 노드 이력을 기다리고 있습니다.</td></tr>'
                : '<p class="qe-empty">실행 노드 이력을 기다리고 있습니다.</p>');
        setHidden(byId("qeHistoryEmpty", "historyEmpty"), rows.length > 0);
    }

    function collectResultArtifacts(nodes) {
        const artifacts = [];
        (Array.isArray(nodes) ? nodes : []).forEach((node) => {
            const objects = Array.isArray(node.RESULT_OBJECTS) ? node.RESULT_OBJECTS : [];
            objects.forEach((item) => artifacts.push({
                artifact: String(item.artifact || "").toUpperCase(),
                objectName: String(item.objectName || "").toUpperCase(),
                owner: String(item.owner || node.RESULT_OWNER || state.tableOwner || "").toUpperCase(),
                kind: String(item.kind || "").toUpperCase(),
                targetOwner: String(node.TARGET_OWNER || state.tableOwner || "").toUpperCase(),
                targetTable: String(node.TARGET_TABLE || state.tableName || "").toUpperCase(),
                menuCode: String(node.REF_MENU_CODE || "").toUpperCase()
            }));
        });
        const categorical = artifacts.find((item) => item.artifact === "ASSOCIATION_MODEL")
            || artifacts.find((item) => item.kind === "MODEL" && item.objectName.includes("ASSOCIATION"));
        const continuous = artifacts.find((item) => item.artifact === "SYMBOLIC_RULE")
            || artifacts.find((item) => item.objectName === "INIT$_TB_RULEDISC_SYMBOLIC");
        const categoricalViolation = artifacts.find((item) => item.artifact === "CAT_RULE_VIOLATION")
            || artifacts.find((item) => item.objectName === "INIT$_TB_RULEVIOL_ASSOC");
        const continuousViolation = artifacts.find((item) => item.artifact === "SYMBOLIC_RULE_VIOLATION")
            || artifacts.find((item) => item.objectName === "INIT$_TB_RULEVIOL_SYMBOLIC");
        return {
            categorical: categorical || null,
            continuous: continuous || null,
            categoricalViolation: categoricalViolation || null,
            continuousViolation: continuousViolation || null
        };
    }

    function setResultsLoading(loading, message = "") {
        const panel = byId("resultsSection", "qeResultsPanel");
        const overlay = byId("qeResultsLoadingOverlay");
        if (!panel) return;
        panel.classList.toggle("is-loading", Boolean(loading));
        panel.setAttribute("aria-busy", loading ? "true" : "false");
        if (loading) {
            setHidden(panel, false);
            setText(
                byId("qeResultsLoadingMessage"),
                message || "저장된 컬럼 유형과 규칙 분석 결과를 최신 정보로 교체하고 있습니다."
            );
        }
        setHidden(overlay, !loading);
    }

    async function loadResults(options = {}) {
        const showPanelLoading = options.showPanelLoading === true;
        const panel = byId("resultsSection", "qeResultsPanel");
        if (showPanelLoading) {
            setResultsLoading(true, options.loadingMessage);
        } else {
            panel?.setAttribute("aria-busy", "true");
        }
        try {
            await loadResultsData();
        } finally {
            if (showPanelLoading) {
                setResultsLoading(false);
            } else {
                panel?.setAttribute("aria-busy", "false");
            }
        }
    }

    async function loadResultsData() {
        if (isMixedXai()) {
            const [rulesResult, statsResult] = await Promise.allSettled([
                client.getMixedXaiResults(state.flowRunId, state.tableOwner, state.tableName),
                client.getDescriptiveStatistics(state.flowRunId)
            ]);
            if (rulesResult.status === "rejected") throw rulesResult.reason;
            const response = rulesResult.value;
            const statsError = statsResult.status === "rejected" ? (statsResult.reason?.message || "기초통계 조회 실패") : "";
            const statistics = statsError ? { data: { available: false, notice: statsError } } : statsResult.value;
            const payload = response.data || {};
            if (!payload.ruleSummary) throw new Error(window.RuleResultCommon.t("Rule summary is unavailable. Reload after restarting the backend."));
            const rules = payload.ruleSummary?.rules || [];
            const pattern = window.RuleResultCommon.isPattern(payload);
            const categorical = pattern ? window.RuleResultCommon.patternSummary(payload.ruleSummary, "VALUE") : payload.ruleSummary;
            const continuous = window.RuleResultCommon.continuousSummary(payload);
            resultData = { mixedXai: payload, categorical, continuous: { symbolicRuleSummary: continuous }, descriptiveStatistics: statistics, columnTypeFinal: null,
                categoricalViolation: { violationSummary: { topRules: rules, overview: {
                    VIOLATION_COUNT: payload.summary?.violationCount ?? payload.summary?.ruleMatchCount,
                    VIOLATED_RULE_COUNT: rules.filter((r) => Number(r.MATCH_COUNT) > 0).length
                } } } };
            for (const [kind, familyRules] of [["categorical", categorical.rules || []], ["continuous", continuous.topRules || []]]) {
                const violationSummary = { topRules: familyRules.map((r) => ({ ...r, VIOLATION_COUNT: r.VIOLATION_COUNT ?? r.MATCH_COUNT })), columnComments: payload.ruleSummary.columnComments, overview: {
                    VIOLATION_COUNT: familyRules.reduce((n, r) => n + Number(r.VIOLATION_COUNT ?? r.MATCH_COUNT ?? 0), 0),
                    VIOLATED_RULE_COUNT: familyRules.filter((r) => Number(r.VIOLATION_COUNT ?? r.MATCH_COUNT) > 0).length } };
                resultData[`${kind}Violation`] = { [kind === "categorical" ? "violationSummary" : "symbolicViolationSummary"]: violationSummary };
            }
            if (resultData.categorical && !pattern) resultData.categorical.columnComments = {
                ...resultData.categorical.columnComments, ANOMALY_CANDIDATE: window.RuleResultCommon.t("Anomaly candidate") };
            ruleDistributionFilters.categorical = { type: "ALL", value: "", label: "" };
            ruleDistributionFilters.continuous = { type: "ALL", value: "", label: "" };
            state.resultArtifacts = { mixedXai: !pattern, mixedPattern: pattern, categorical: { objectName: rules[0]?.MODEL_NAME || payload.summary?.modelName }, categoricalViolation: { owner: state.tableOwner, objectName: pattern ? "INIT$_TB_RULEVIOL_ASSOC" : "INIT$_TB_RULEVIOL_XAI", targetOwner: state.tableOwner, targetTable: state.tableName } };
            state.resultArtifacts.continuous = { owner: state.tableOwner, objectName: "INIT$_TB_RULEDISC_ASSOC_SUM" };
            state.resultArtifacts.continuousViolation = { ...state.resultArtifacts.categoricalViolation };
            state.resultWarning = statsError;
            columnTypeDirtyChanges.clear();
            persistState();
            renderResults();
            return;
        }
        const response = await client.getRunNodes(state.flowRunId);
        const nodes = Array.isArray(response.data) ? response.data : [];
        const artifacts = collectResultArtifacts(nodes);
        state.resultArtifacts = artifacts;
        state.resultWarning = "";
        persistState();

        const requests = [];
        const keys = [];
        if (artifacts.categorical?.objectName && artifacts.categorical?.owner) {
            keys.push("categorical");
            requests.push(client.getCategoricalRules({
                owner: artifacts.categorical.owner,
                modelName: artifacts.categorical.objectName,
                targetOwner: artifacts.categorical.targetOwner || state.tableOwner,
                targetTable: artifacts.categorical.targetTable || state.tableName,
                flowRunId: state.flowRunId
            }));
        }
        if (artifacts.continuous?.objectName && artifacts.continuous?.owner) {
            keys.push("continuous");
            requests.push(client.getContinuousRules({
                owner: artifacts.continuous.owner,
                objectName: artifacts.continuous.objectName,
                targetOwner: artifacts.continuous.targetOwner || state.tableOwner,
                targetTable: artifacts.continuous.targetTable || state.tableName,
                flowRunId: state.flowRunId
            }));
        }

        if (artifacts.categoricalViolation?.objectName && artifacts.categoricalViolation?.owner) {
            keys.push("categoricalViolation");
            requests.push(client.getViolationRows({
                owner: artifacts.categoricalViolation.owner,
                objectName: artifacts.categoricalViolation.objectName,
                targetOwner: artifacts.categoricalViolation.targetOwner || state.tableOwner,
                targetTable: artifacts.categoricalViolation.targetTable || state.tableName,
                ruleModelName: artifacts.categorical?.objectName,
                flowRunId: state.flowRunId,
                balancedRuleSummaryYn: true,
                page: 1,
                pageSize: 20
            }));
        }
        if (artifacts.continuousViolation?.objectName && artifacts.continuousViolation?.owner) {
            keys.push("continuousViolation");
            requests.push(client.getViolationRows({
                owner: artifacts.continuousViolation.owner,
                objectName: artifacts.continuousViolation.objectName,
                targetOwner: artifacts.continuousViolation.targetOwner || state.tableOwner,
                targetTable: artifacts.continuousViolation.targetTable || state.tableName,
                flowRunId: state.flowRunId,
                balancedRuleSummaryYn: true,
                page: 1,
                pageSize: 20
            }));
        }

        const statisticsNode = nodes.find((node) => (
            Number(node.FLOW_NODE_RUN_ID || 0) > 0
            && node.TARGET_OWNER
            && node.TARGET_TABLE
            && String(node.REF_MENU_CODE || "").toUpperCase() === "M03001"
        )) || nodes.find((node) => (
            Number(node.FLOW_NODE_RUN_ID || 0) > 0
            && node.TARGET_OWNER
            && node.TARGET_TABLE
        ));
        const columnTypeTarget = resolveColumnTypeTarget(nodes, artifacts, statisticsNode);
        if (columnTypeTarget.owner && columnTypeTarget.tableName) {
            const targetChanged = state.tableOwner !== columnTypeTarget.owner || state.tableName !== columnTypeTarget.tableName;
            state.tableOwner = columnTypeTarget.owner;
            state.tableName = columnTypeTarget.tableName;
            if (targetChanged) persistState();
        }
        if (statisticsNode) {
            keys.push("descriptiveStatistics");
            requests.push(client.getDescriptiveStatistics(
                state.flowRunId,
                Number(statisticsNode.FLOW_NODE_RUN_ID)
            ));
        }

        if (columnTypeTarget.owner && columnTypeTarget.tableName) {
            keys.push("columnTypeFinal");
            requests.push(client.getColumnTypeFinal({
                owner: columnTypeTarget.owner,
                whereClause: getColumnTypeWhereClause(columnTypeTarget.owner, columnTypeTarget.tableName),
                limit: 1000
            }));
        }

        resultData = {
            categorical: null,
            continuous: null,
            categoricalViolation: null,
            continuousViolation: null,
            descriptiveStatistics: null,
            columnTypeFinal: null
        };
        columnTypeDirtyChanges.clear();
        resetRuleDistributionFilters();
        const settled = await Promise.allSettled(requests);
        const errors = [];
        settled.forEach((result, index) => {
            const key = keys[index];
            if (result.status === "fulfilled") resultData[key] = result.value;
            else errors.push(result.reason?.message || `${key} 결과 조회 실패`);
        });
        if (!artifacts.categorical) errors.push("범주형 Association 모델 결과를 찾지 못했습니다.");
        if (!artifacts.continuous) errors.push("연속형 수식 규칙 결과를 찾지 못했습니다.");
        if (!artifacts.categoricalViolation) errors.push("범주형 위반 결과 테이블을 찾지 못했습니다.");
        if (!artifacts.continuousViolation) errors.push("연속형 위반 결과 테이블을 찾지 못했습니다.");
        if (!statisticsNode) errors.push("기초통계량을 계산할 대상 테이블 연결 정보를 찾지 못했습니다.");
        if (!columnTypeTarget.owner || !columnTypeTarget.tableName) errors.push("컬럼 유형 FINAL 결과를 조회할 대상 테이블 정보가 없습니다.");
        state.resultWarning = errors.join(" ");
        persistState();
        renderResults();
    }

    function getResultColumnComments(kind) {
        if (kind === "categorical") {
            return resultData.categorical?.columnComments
                || resultData.categoricalViolation?.columnComments
                || {};
        }
        return resultData.continuous?.symbolicRuleSummary?.columnComments
            || resultData.continuous?.columnComments
            || resultData.continuousViolation?.symbolicViolationSummary?.columnComments
            || resultData.continuousViolation?.columnComments
            || {};
    }

    function getViolationSummary(kind) {
        return kind === "categorical"
            ? (resultData.categoricalViolation?.violationSummary || {})
            : (resultData.continuousViolation?.symbolicViolationSummary || {});
    }

    function getViolationCountMap(kind) {
        const summary = getViolationSummary(kind);
        const rows = [...(summary.balancedTopRules || []), ...(summary.topRules || [])];
        return new Map(rows.map((row) => [String(row.RULE_ID || ""), Number(row.VIOLATION_COUNT || 0)]));
    }

    function getPrioritizedRules(kind, rules, limit = 12) {
        const summary = getViolationSummary(kind);
        const violationRules = [...(summary.balancedTopRules || []), ...(summary.topRules || [])];
        return kind === "categorical"
            ? R.prioritizeCategoricalRules(rules, violationRules, limit)
            : R.prioritizeContinuousRules(rules, violationRules, limit);
    }

    function getDisplayedRules(kind, activeFilter = ruleDistributionFilters[kind]) {
        const rules = kind === "categorical"
            ? (resultData.categorical?.rules || [])
            : (resultData.continuous?.symbolicRuleSummary?.topRules || []);
        const summary = getViolationSummary(kind);
        const violationRules = [...(summary.balancedTopRules || []), ...(summary.topRules || [])];
        const rankedLimit = Math.max(12, rules.length + violationRules.length);
        const rankedRules = getPrioritizedRules(kind, rules, rankedLimit);
        return R.selectBalancedRules(rankedRules, kind, activeFilter, 12);
    }

    function reconcileRuleDistributionFilter(kind, legendRules) {
        const activeFilter = ruleDistributionFilters[kind];
        if (!activeFilter || activeFilter.type === "ALL") return;
        const hasMatchingRule = legendRules.some((rule) => (
            R.filterLegendItems(
                [{ key: activeFilter.value }],
                [rule],
                kind,
                activeFilter.type
            ).length > 0
        ));
        if (!hasMatchingRule) {
            ruleDistributionFilters[kind] = { type: "ALL", value: "", label: "전체" };
        }
    }

    function setRuleDistributionFilter(kind, type, value, label) {
        if (!Object.prototype.hasOwnProperty.call(ruleDistributionFilters, kind)) return;
        const normalizedType = String(type || "ALL").toUpperCase();
        ruleDistributionFilters[kind] = normalizedType === "ALL"
            ? { type: "ALL", value: "", label: "전체" }
            : {
                type: normalizedType,
                value: String(value || "").trim(),
                label: String(label || value || "선택 범례").trim()
            };
        renderResults();
    }

    async function openDetailedAnalysis() {
        const projectId = Number(state.projectId || 0);
        const scenarioId = Number(state.scenarioId || 0);
        const flowRunId = Number(state.flowRunId || 0);
        const appWindow = window.opener;
        if (!projectId || !scenarioId || !flowRunId) {
            showToast("상세 분석으로 이동할 프로젝트·시나리오·실행 번호를 확인할 수 없습니다.", "error");
            return;
        }
        if (!appWindow || appWindow.closed || !appWindow.PageManager) {
            showToast("메인 화면을 찾을 수 없습니다. 메인 화면에서 퀵 에디팅을 다시 열어 주세요.", "error");
            return;
        }
        try {
            appWindow.sessionStorage.setItem("M04002:selectedProjectId", String(projectId));
            appWindow.sessionStorage.setItem("M04002:selectedScenarioId", String(scenarioId));
            appWindow.sessionStorage.setItem("M04002:selectedRunId", String(flowRunId));
            await appWindow.PageManager.load("M04002", "규칙 발굴 분석", true);
            appWindow.focus();
            window.close();
        } catch (error) {
            showToast(error.message || "상세 분석 화면으로 이동하지 못했습니다.", "error");
        }
    }

    async function openColumnTypeModelTraining() {
        const appWindow = window.opener;
        if (!appWindow || appWindow.closed || !appWindow.PageManager) {
            showToast("메인 화면을 찾을 수 없습니다. 메인 화면에서 퀵 에디팅을 다시 열어 주세요.", "error");
            return;
        }
        const navigationIntent = {
            tab: "dataset",
            labelSource: "USER_CONFIRMED",
            status: "ELIGIBLE",
            requestedAt: Date.now()
        };
        try {
            appWindow.sessionStorage.setItem(MODEL_TRAINING_NAVIGATION_KEY, JSON.stringify(navigationIntent));
            await appWindow.PageManager.load("M90003", "모델 학습 관리", true);
            appWindow.focus();
        } catch (error) {
            showToast(error.message || "모델 학습 화면으로 이동하지 못했습니다.", "error");
        }
    }

    function getRuleViolationCount(kind, rule) {
        if (!rule) return null;
        const value = getViolationCountMap(kind).get(String(rule.RULE_ID || ""));
        return Number.isFinite(value) ? value : null;
    }

    function getStatisticsPayload() {
        const response = resultData.descriptiveStatistics;
        const payload = response?.data && typeof response.data === "object" ? response.data : response;
        return payload && typeof payload === "object" ? payload : null;
    }

    function finiteNumber(value) {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatPercent(value, digits = 1) {
        const number = finiteNumber(value);
        return number === null ? "-" : `${(number * 100).toFixed(digits)}%`;
    }

    function formatStatistic(value, digits = 6) {
        const number = finiteNumber(value);
        return number === null ? "-" : R.formatNumber(number, digits);
    }

    function statisticsColumnLabel(column) {
        const name = String(column?.columnName || column?.COLUMN_NAME || "");
        const comment = String(column?.columnComment || column?.COLUMN_COMMENT || "");
        return comment ? `${name} · ${comment}` : name;
    }

    function renderDescriptiveStatistics() {
        const section = byId("qeStatisticsSummary");
        const kpis = byId("qeStatisticsKpis");
        const interpretation = byId("qeStatisticsInterpretation");
        const interpretationText = interpretation?.querySelector("[data-statistics-interpretation]");
        const methodologyPanel = byId("qeStatisticsMethodology");
        const methodologyBody = byId("qeStatisticsMethodologyBody");
        const priority = byId("qeStatisticsPriority");
        const notice = byId("qeStatisticsNotice");
        const payload = getStatisticsPayload();
        if (!section || !kpis || !interpretation || !interpretationText || !methodologyPanel || !methodologyBody || !priority || !notice) return;

        if (!payload || payload.available === false) {
            setHidden(section, false);
            kpis.innerHTML = "";
            interpretation.hidden = true;
            methodologyPanel.hidden = true;
            methodologyBody.innerHTML = "";
            priority.innerHTML = '<div class="qe-empty">등록된 INITUP$ 원본 테이블에서 분석 가능한 컬럼 통계를 계산할 수 없습니다.</div>';
            notice.textContent = payload?.reason || payload?.notice || "대상 테이블 연결 정보를 확인해 주세요.";
            notice.hidden = false;
            byId("qeStatisticsDetailButton").disabled = true;
            return;
        }

        const columns = Array.isArray(payload.columns) ? payload.columns : [];
        const insights = payload.insights && typeof payload.insights === "object" ? payload.insights : {};
        const rankedCandidates = Array.isArray(insights.rankedColumns) ? insights.rankedColumns : [];
        const statisticsColumnNames = new Set(columns.map((column) => String(column.columnName || "").toUpperCase()));
        const includedColumnNames = new Set();
        const ranked = rankedCandidates.filter((row) => {
            const columnName = String(row.columnName || "").toUpperCase();
            if (!statisticsColumnNames.has(columnName) || includedColumnNames.has(columnName)) return false;
            includedColumnNames.add(columnName);
            return true;
        });
        columns.forEach((column) => {
            const columnName = String(column.columnName || "");
            const normalizedName = columnName.toUpperCase();
            if (includedColumnNames.has(normalizedName)) return;
            ranked.push(column.insight || {
                columnName,
                columnComment: column.columnComment || "",
                importanceScore: 0,
                priorityLevel: "LOW",
                priorityReasons: ["큰 변화 없음"],
                violationCount: 0,
                missingRate: 0
            });
            includedColumnNames.add(normalizedName);
        });
        const isHighPriority = (row) => {
            const priorityLevel = String(row.priorityLevel || "").toUpperCase();
            return priorityLevel ? priorityLevel === "HIGH" : Number(row.importanceScore || 0) >= 50;
        };
        const highPriorityColumnCount = ranked.filter(isHighPriority).length;
        const violationColumnCount = ranked.filter((row) => Number(row.violationCount || 0) > 0).length;
        const distribution = payload.summary || {};
        const totalViolations = ranked.reduce((sum, row) => sum + Number(row.violationCount || 0), 0);
        const comparisonAvailable = Boolean(payload.after || insights.summary?.comparisonAvailable);
        const scoreInputs = comparisonAvailable ? "위반·결측·분포 변화" : "위반·결측 상태";
        interpretationText.textContent = `분석 컬럼 ${R.formatNumber(ranked.length, 0)}개 중 ${R.formatNumber(violationColumnCount, 0)}개 컬럼에서 규칙×행 기준 총 ${R.formatNumber(totalViolations, 0)}건의 위반이 발견됐고, ${scoreInputs} 등을 종합해 ${R.formatNumber(highPriorityColumnCount, 0)}개 컬럼이 우선 확인 대상으로 분류됐습니다.`;
        interpretation.hidden = false;

        const weights = insights.methodology && typeof insights.methodology === "object" ? insights.methodology : {};
        const violationWeight = finiteNumber(weights.violationWeight) ?? 55;
        const missingWeight = finiteNumber(weights.missingWeight) ?? 15;
        const varianceWeight = finiteNumber(weights.varianceWeight) ?? 15;
        const meanShiftWeight = finiteNumber(weights.meanShiftWeight) ?? 10;
        const rangeShiftWeight = finiteNumber(weights.rangeShiftWeight) ?? 5;
        methodologyBody.innerHTML = `<div class="qe-statistics-terms">
            <div><strong>우선 확인 컬럼</strong><span>중요도 점수가 <b>50점 이상(HIGH)</b>인 컬럼입니다. 위반이 없어도 결측이나 분포 변화가 크면 포함될 수 있습니다.</span></div>
            <div><strong>위반 발생 컬럼</strong><span>범주형 또는 연속형 규칙 위반 기록이 <b>1건 이상</b> 연결된 서로 다른 컬럼 수입니다.</span></div>
            <div><strong>규칙×행 위반</strong><span>규칙 위반 결과 테이블의 기록 수입니다. 같은 원본 행이 여러 규칙을 위반하면 규칙별로 각각 계산하므로 <b>고유 원본 행 수와 다릅니다.</b></span></div>
        </div>
        <div class="qe-statistics-formula">
            <strong>중요도 점수 = 최대 100점</strong>
            <code>${R.escapeHtml(violationWeight)}×ln(1+V)/ln(1+Vmax) + ${R.escapeHtml(missingWeight)}×min(1, N/20%) + ${R.escapeHtml(varianceWeight)}×min(1, D) + ${R.escapeHtml(meanShiftWeight)}×min(1, M/2) + ${R.escapeHtml(rangeShiftWeight)}×min(1, R)</code>
            <dl>
                <div><dt>V / Vmax</dt><dd>현재 컬럼의 규칙×행 위반 건수 / 분석 컬럼 중 최대 위반 건수</dd></div>
                <div><dt>N</dt><dd>원본·수정 중 더 높은 결측률</dd></div>
                <div><dt>D</dt><dd>분산 변화율이며, 분산 비교가 불가능하면 고유값 비율 변화의 5배</dd></div>
                <div><dt>M</dt><dd>평균 이동 거리 ÷ 원본 표준편차</dd></div>
                <div><dt>R</dt><dd>최솟값·최댓값 이동을 전체 값 범위로 표준화한 비율</dd></div>
            </dl>
            <p>${comparisonAvailable
                ? "원본과 수정 테이블을 비교할 수 있어 결측·분산·평균·범위 변화 항목을 함께 반영합니다."
                : "수정 비교 테이블이 없어 변화 항목은 0점이며, 현재 원본의 규칙 위반과 결측률을 중심으로 계산합니다."}</p>
        </div>`;
        methodologyPanel.hidden = false;
        kpis.innerHTML = R.renderKpis([
            { label: "통계 분석 컬럼", value: R.formatNumber(ranked.length, 0), tone: "primary", help: "기초통계가 계산된 전체 컬럼" },
            { label: "우선 확인 컬럼", value: R.formatNumber(highPriorityColumnCount, 0), help: "중요도 점수 50점 이상" },
            { label: "위반 발생 컬럼", value: R.formatNumber(violationColumnCount, 0), help: "규칙 위반이 1건 이상인 컬럼" },
            { label: "전체 규칙×행 위반", value: R.formatNumber(totalViolations, 0), help: "고유 행 수가 아닌 위반 기록 합계" },
            { label: "분산 감소", value: R.formatNumber(distribution.varianceDecreasedColumnCount || 0, 0), help: "수정 후 분산이 감소한 컬럼" },
            { label: "분산 증가", value: R.formatNumber(distribution.varianceIncreasedColumnCount || 0, 0), help: "수정 후 분산이 증가한 컬럼" }
        ]);

        const legend = `<div class="qe-statistics-card-legend" aria-label="컬럼 카드 표시 기준">
            <strong>전체 ${R.escapeHtml(R.formatNumber(ranked.length, 0))}개 컬럼</strong>
            <span class="is-priority"><i aria-hidden="true"></i>테두리 강조 · 우선 확인 ${R.escapeHtml(R.formatNumber(highPriorityColumnCount, 0))}개</span>
            <span class="is-violation"><b>위반</b>색상 배지 · 위반 발생 ${R.escapeHtml(R.formatNumber(violationColumnCount, 0))}개</span>
        </div>`;
        const cards = ranked.map((row, index) => {
            const reasons = Array.isArray(row.priorityReasons)
                ? row.priorityReasons.join(" · ")
                : String(row.priorityReasons || "분포 변화 확인");
            const isPriority = isHighPriority(row);
            const violationCount = Number(row.violationCount || 0);
            return `<button type="button" class="qe-statistics-priority-card${isPriority ? " is-priority" : ""}"
                    data-statistics-column="${R.escapeHtml(String(row.columnName || ""))}">
                <span class="qe-statistics-rank">${index + 1}</span>
                <span class="qe-statistics-priority-card__body">
                    <strong>${R.escapeHtml(statisticsColumnLabel(row))}</strong>
                    <small>${R.escapeHtml(reasons)}</small>
                    <span>
                        <em>중요도 ${R.escapeHtml(R.formatNumber(row.importanceScore || 0, 1))}</em>
                        <em class="${violationCount > 0 ? "is-violation" : "is-zero"}">위반 ${R.escapeHtml(R.formatNumber(violationCount, 0))}</em>
                        <em>결측 ${R.escapeHtml(formatPercent(row.missingRate || 0))}</em>
                    </span>
                </span>
            </button>`;
        });
        const lastViolationIndex = ranked.reduce((lastIndex, row, index) => (
            Number(row.violationCount || 0) > 0 ? index : lastIndex
        ), -1);
        const initialCardCount = ranked.length
            ? Math.min(ranked.length, Math.max(3, Math.ceil((lastViolationIndex + 1) / 3) * 3))
            : 0;
        const initialCards = cards.slice(0, initialCardCount).join("");
        const remainingCards = cards.slice(initialCardCount);
        const extraCards = remainingCards.length ? `<details class="qe-statistics-extra">
            <summary>
                <span class="qe-statistics-extra__closed">나머지 ${R.escapeHtml(R.formatNumber(remainingCards.length, 0))}개 컬럼 펼쳐보기</span>
                <span class="qe-statistics-extra__open">상세 컬럼 닫기</span>
                <small>위반 발생 컬럼 아래의 전체 통계 컬럼</small>
                <span class="qe-statistics-extra__icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20" focusable="false"><path d="M5.5 10h9"></path><path class="is-vertical" d="M10 5.5v9"></path></svg>
                </span>
            </summary>
            <div class="qe-statistics-extra__grid">${remainingCards.join("")}</div>
        </details>` : "";
        priority.innerHTML = ranked.length
            ? `${legend}${initialCards}${extraCards}`
            : '<div class="qe-empty">표시할 통계 분석 컬럼이 없습니다.</div>';
        notice.textContent = payload.notice || "";
        notice.hidden = !payload.notice;
        byId("qeStatisticsDetailButton").disabled = columns.length === 0;
        setHidden(section, false);
    }

    function getColumnTypeFinalRows() {
        const payload = resultData.columnTypeFinal;
        if (Array.isArray(payload?.data)) return payload.data;
        if (Array.isArray(payload?.rows)) return payload.rows;
        return [];
    }

    function columnTypeGroupLabel(groupCode) {
        return {
            CATEGORICAL: "범주형",
            CONTINUOUS: "연속형",
            OTHER: "기타"
        }[String(groupCode || "OTHER").toUpperCase()] || "기타";
    }

    function columnTypeSourceLabel(source, confirmedYn) {
        const normalized = String(source || "").toUpperCase();
        if (normalized === "USER_CONFIRMED") {
            return String(confirmedYn || "").toUpperCase() === "Y" ? "사용자 확정" : "사용자 검토";
        }
        if (normalized === "IMPORTED_GOLD") return "초기 샘플";
        if (String(confirmedYn || "").toUpperCase() === "Y") return "확정";
        return "자동 판정";
    }

    function hasSuccessfulColumnTypeStage() {
        if (isMixedXai()) return false;
        const nodes = Array.isArray(currentSnapshot?.nodes) ? currentSnapshot.nodes : [];
        return nodes.some((node) => {
            const menuCode = String(node.REF_MENU_CODE || "").trim().toUpperCase();
            const nodeKey = String(node.NODE_KEY || node.nodeKey || "").trim().toUpperCase();
            const nodeName = String(node.NODE_NAME || node.nodeName || "").trim().toUpperCase();
            const isColumnTypeStage = menuCode === "M03001"
                || nodeKey.startsWith("M03001")
                || nodeName.startsWith("M03001");
            return isColumnTypeStage && R.normalizeStatus(node.STATUS || node.status) === "SUCCESS";
        });
    }

    function canEditColumnTypeFinal() {
        if (isMixedXai()) return false;
        const runStatus = R.normalizeStatus(state.lastRunStatus || currentSnapshot?.run?.STATUS || "");
        return Boolean(
            state.projectId
            && state.scenarioId
            && state.flowId
            && state.flowRunId
            && !R.ACTIVE_STATUSES.has(runStatus)
            && hasSuccessfulColumnTypeStage()
        );
    }

    function matchesColumnTypeFilter(row, filterValue = state.columnTypeFilter) {
        const normalized = String(filterValue || "ALL");
        if (normalized === "ALL") return true;
        const [kind, value = ""] = normalized.split(":", 2);
        if (kind === "GROUP") {
            return String(row.TYPE_GROUP_CODE || "OTHER").toUpperCase() === value.toUpperCase();
        }
        if (kind === "TYPE") {
            return String(row.FINAL_PREDICTED_TYPE || "") === value;
        }
        return true;
    }

    function renderColumnTypeFilter(rows, counts) {
        const filter = byId("qeColumnTypeFilter");
        if (!filter) return;
        const detailedCounts = rows.reduce((target, row) => {
            const displayType = String(row.FINAL_PREDICTED_TYPE || "").trim();
            if (displayType) target.set(displayType, (target.get(displayType) || 0) + 1);
            return target;
        }, new Map());
        const validValues = new Set(["ALL"]);
        const groupOptions = [
            ["CATEGORICAL", "범주형"],
            ["CONTINUOUS", "연속형"],
            ["OTHER", "기타"]
        ].map(([groupCode, label]) => {
            const value = `GROUP:${groupCode}`;
            validValues.add(value);
            return `<option value="${value}">${label} (${R.formatNumber(counts[groupCode] || 0, 0)})</option>`;
        }).join("");
        const detailOptions = COLUMN_TYPE_OPTIONS.map(([displayType]) => {
            const value = `TYPE:${displayType}`;
            validValues.add(value);
            return `<option value="${R.escapeHtml(value)}">${R.escapeHtml(displayType)} (${R.formatNumber(detailedCounts.get(displayType) || 0, 0)})</option>`;
        }).join("");
        if (!validValues.has(String(state.columnTypeFilter || "ALL"))) state.columnTypeFilter = "ALL";
        filter.innerHTML = `<option value="ALL">전체 유형 (${R.formatNumber(rows.length, 0)})</option>
            <optgroup label="유형 그룹">${groupOptions}</optgroup>
            <optgroup label="세부 유형">${detailOptions}</optgroup>`;
        filter.value = state.columnTypeFilter || "ALL";
    }

    function renderColumnTypeFinal(options = {}) {
        const section = byId("qeColumnTypeSummary");
        if (isMixedXai()) {
            setHidden(section, true);
            return;
        }
        const kpis = byId("qeColumnTypeKpis");
        const groups = byId("qeColumnTypeGroups");
        const editor = byId("qeColumnTypeEditor");
        const editorToggle = byId("qeColumnTypeEditorToggle");
        const editorPanel = byId("qeColumnTypeEditorPanel");
        const table = byId("qeColumnTypeTable");
        const notice = byId("qeColumnTypeNotice");
        const filter = byId("qeColumnTypeFilter");
        const rerunButton = byId("qeColumnTypeRerunButton");
        const saveButton = byId("qeColumnTypeSaveButton");
        if (!section || !kpis || !groups || !editor || !editorToggle || !editorPanel || !table || !notice || !filter || !rerunButton || !saveButton) return;

        const rows = getColumnTypeFinalRows();
        const payloadLoaded = Boolean(resultData.columnTypeFinal);
        const keepEditorOpen = options.keepEditorOpen || !editorPanel.hidden;
        if (!payloadLoaded || !rows.length) {
            setHidden(section, false);
            kpis.innerHTML = "";
            groups.innerHTML = '<div class="qe-empty">표시할 컬럼 유형 FINAL 결과가 없습니다.</div>';
            table.innerHTML = "";
            editor.hidden = true;
            editor.classList.remove("is-expanded");
            editorPanel.hidden = true;
            editorToggle.setAttribute("aria-expanded", "false");
            filter.disabled = true;
            notice.textContent = payloadLoaded
                ? "M03001 컬럼유형분류 실행의 FINAL 결과가 생성되었는지 확인해 주세요."
                : "컬럼 유형 FINAL 결과를 불러오지 못했습니다.";
            notice.hidden = false;
            rerunButton.disabled = true;
            saveButton.disabled = true;
            byId("qeColumnTypeDirtyCount").textContent = "0";
            return;
        }

        rows.forEach((row) => {
            if (!("__ORIGINAL_FINAL_TYPE" in row)) {
                row.__ORIGINAL_FINAL_TYPE = String(row.FINAL_PREDICTED_TYPE || "");
                row.__ORIGINAL_GROUP_CODE = String(row.TYPE_GROUP_CODE || "OTHER");
                row.__ORIGINAL_TYPE_CODE = String(row.FINAL_TYPE_CODE || "");
                row.__ORIGINAL_CONFIRMED_YN = String(row.CONFIRMED_YN || "N");
                row.__ORIGINAL_LABEL_SOURCE = String(row.LABEL_SOURCE || "");
            }
        });

        const counts = rows.reduce((target, row) => {
            const group = String(row.TYPE_GROUP_CODE || "OTHER").toUpperCase();
            target[group] = (target[group] || 0) + 1;
            if (String(row.CONFIRMED_YN || "").toUpperCase() === "Y") target.confirmed += 1;
            return target;
        }, { CATEGORICAL: 0, CONTINUOUS: 0, OTHER: 0, confirmed: 0 });
        renderColumnTypeFilter(rows, counts);
        filter.disabled = false;
        kpis.innerHTML = R.renderKpis([
            { label: "전체 컬럼", value: R.formatNumber(rows.length, 0), tone: "primary" },
            { label: "범주형", value: R.formatNumber(counts.CATEGORICAL, 0) },
            { label: "연속형", value: R.formatNumber(counts.CONTINUOUS, 0), tone: "mint" },
            { label: "기타", value: R.formatNumber(counts.OTHER, 0) },
            { label: "사용자·샘플 확정", value: R.formatNumber(counts.confirmed, 0), help: "학습 가능한 확정 라벨" },
            { label: "검토 필요", value: R.formatNumber(rows.length - counts.confirmed, 0), help: "자동 판정 상태" }
        ]);

        groups.innerHTML = ["CATEGORICAL", "CONTINUOUS", "OTHER"].map((groupCode) => {
            const groupRows = rows.filter((row) => String(row.TYPE_GROUP_CODE || "OTHER").toUpperCase() === groupCode);
            const tags = groupRows.length
                ? groupRows.map((row) => {
                    const columnName = String(row.COLUMN_NAME || "-");
                    const columnLabel = String(row.COLUMN_DESC || "").trim();
                    const displayLabel = columnLabel ? `${columnName} · ${columnLabel}` : columnName;
                    return `<span class="qe-column-type-tag" title="${R.escapeHtml(displayLabel)}"><b>${R.escapeHtml(columnLabel || columnName)}</b>${columnLabel ? `<em>${R.escapeHtml(columnName)}</em>` : ""}</span>`;
                }).join("")
                : '<span class="qe-column-type-tag">해당 컬럼 없음</span>';
            return `<article class="qe-column-type-group is-${groupCode.toLowerCase()}">
                <header><strong>${columnTypeGroupLabel(groupCode)}</strong><span>${R.formatNumber(groupRows.length, 0)} columns</span></header>
                <div class="qe-column-type-tags">${tags}</div>
            </article>`;
        }).join("");

        const readOnly = !canEditColumnTypeFinal() || pipelineBusy || columnTypeSaveBusy;
        const filteredRows = rows
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => matchesColumnTypeFilter(row));
        table.innerHTML = filteredRows.map(({ row, index }) => {
            const displayType = String(row.FINAL_PREDICTED_TYPE || "");
            const groupCode = String(row.TYPE_GROUP_CODE || "OTHER").toUpperCase();
            const rowId = String(row["INIT$ROWID"] || "");
            const dirty = Array.from(columnTypeDirtyChanges.keys()).some((key) => key.startsWith(`${rowId}:`));
            const sourceLabel = columnTypeSourceLabel(row.LABEL_SOURCE, row.CONFIRMED_YN);
            const confirmed = String(row.CONFIRMED_YN || "").toUpperCase() === "Y";
            const columnName = String(row.COLUMN_NAME || "-");
            const columnLabel = String(row.COLUMN_DESC || "").trim();
            const optionsHtml = `<option value="" disabled${displayType ? "" : " selected"}>유형 선택</option>` + COLUMN_TYPE_OPTIONS.map(([value]) => (
                `<option value="${R.escapeHtml(value)}"${displayType === value ? " selected" : ""}>${R.escapeHtml(value)}</option>`
            )).join("");
            return `<div class="qe-column-type-row${dirty ? " is-dirty" : ""}" role="row">
                <span class="qe-column-type-column" role="cell">
                    <strong class="qe-column-type-column__label${columnLabel ? "" : " is-empty"}" title="${R.escapeHtml(columnLabel || "컬럼 라벨 없음")}">${R.escapeHtml(columnLabel || "컬럼 라벨 없음")}</strong>
                    <small class="qe-column-type-column__id" title="${R.escapeHtml(columnName)}">${R.escapeHtml(columnName)}</small>
                </span>
                <select data-column-type-index="${index}" aria-label="${R.escapeHtml(columnLabel || columnName)} 최종 유형"${readOnly || !rowId ? " disabled" : ""}>${optionsHtml}</select>
                <span class="qe-column-type-pill is-${groupCode.toLowerCase()}" role="cell">${R.escapeHtml(columnTypeGroupLabel(groupCode))}</span>
                <label class="qe-column-type-source${confirmed ? " is-confirmed" : ""}" role="cell" title="${R.escapeHtml(sourceLabel)}">
                    <input type="checkbox" data-column-confirm-index="${index}"${confirmed ? " checked" : ""}${readOnly || !rowId ? " disabled" : ""}>
                    <span>${confirmed ? "학습 확정" : "검토 필요"}</span>
                </label>
            </div>`;
        }).join("") || '<div class="qe-column-type-filter-empty">선택한 유형에 해당하는 컬럼이 없습니다.</div>';
        editor.hidden = false;
        editor.classList.toggle("is-expanded", keepEditorOpen);
        editorPanel.hidden = !keepEditorOpen;
        editorToggle.setAttribute("aria-expanded", keepEditorOpen ? "true" : "false");
        setText(
            byId("qeColumnTypeEditorSummary"),
            state.columnTypeFilter === "ALL"
                ? `${R.formatNumber(rows.length, 0)}개 컬럼`
                : `${R.formatNumber(filteredRows.length, 0)} / ${R.formatNumber(rows.length, 0)}개`
        );
        setText(byId("qeColumnTypeDirtyCount"), R.formatNumber(columnTypeDirtyChanges.size, 0));
        rerunButton.hidden = false;
        rerunButton.disabled = readOnly
            || pipelineBusy
            || columnTypeSaveBusy
            || columnTypeDirtyChanges.size > 0;
        rerunButton.classList.toggle(
            "is-running",
            pipelineBusy && activePipelineAction === PIPELINE_ACTION.COLUMN_TYPE_RERUN
        );
        rerunButton.setAttribute(
            "aria-busy",
            pipelineBusy && activePipelineAction === PIPELINE_ACTION.COLUMN_TYPE_RERUN ? "true" : "false"
        );
        saveButton.hidden = false;
        saveButton.disabled = readOnly || columnTypeSaveBusy || columnTypeDirtyChanges.size === 0;
        notice.textContent = readOnly
            ? "M03001 컬럼 유형 분석이 성공한 종료 실행에서만 FINAL 유형을 편집하고 재실행할 수 있습니다."
            : `${state.historyView ? "선택한 과거 실행을 편집 중입니다. " : ""}저장 내용은 INIT$_TB_COLTYPE_FINAL과 USER_CONFIRMED 학습자료에 반영됩니다. 재실행은 기존 프로젝트·시나리오·실행 ID를 유지하고 M03002~M03004 결과만 갱신합니다.`;
        notice.hidden = false;
        setHidden(section, false);
    }

    function handleColumnTypeChange(event) {
        const select = event.target.closest("select[data-column-type-index]");
        if (!select || !canEditColumnTypeFinal() || columnTypeSaveBusy) return;
        const rows = getColumnTypeFinalRows();
        const row = rows[Number(select.dataset.columnTypeIndex)];
        const rowId = String(row?.["INIT$ROWID"] || "");
        if (!row || !rowId) return;
        const displayType = String(select.value || "");
        const metadata = COLUMN_TYPE_METADATA.get(displayType) || { typeCode: "", groupCode: "OTHER" };
        const changeKey = `${rowId}:FINAL_PREDICTED_TYPE`;
        const confirmChangeKey = `${rowId}:CONFIRMED_YN`;
        if (displayType === String(row.__ORIGINAL_FINAL_TYPE || "")) {
            columnTypeDirtyChanges.delete(changeKey);
            row.FINAL_TYPE_CODE = row.__ORIGINAL_TYPE_CODE;
            row.TYPE_GROUP_CODE = row.__ORIGINAL_GROUP_CODE;
            row.CONFIRMED_YN = row.__ORIGINAL_CONFIRMED_YN;
            row.LABEL_SOURCE = row.__ORIGINAL_LABEL_SOURCE;
        } else {
            columnTypeDirtyChanges.set(changeKey, {
                rowId,
                columnName: "FINAL_PREDICTED_TYPE",
                value: displayType
            });
            row.FINAL_TYPE_CODE = metadata.typeCode;
            row.TYPE_GROUP_CODE = metadata.groupCode;
            row.CONFIRMED_YN = "Y";
            row.LABEL_SOURCE = "USER_CONFIRMED";
            columnTypeDirtyChanges.delete(confirmChangeKey);
        }
        row.FINAL_PREDICTED_TYPE = displayType;
        renderColumnTypeFinal({ keepEditorOpen: true });
    }

    function handleColumnTypeConfirmation(event) {
        const checkbox = event.target.closest("input[data-column-confirm-index]");
        if (!checkbox || !canEditColumnTypeFinal() || columnTypeSaveBusy) return;
        const rows = getColumnTypeFinalRows();
        const row = rows[Number(checkbox.dataset.columnConfirmIndex)];
        const rowId = String(row?.["INIT$ROWID"] || "");
        if (!row || !rowId) return;
        const confirmedYn = checkbox.checked ? "Y" : "N";
        const changeKey = `${rowId}:CONFIRMED_YN`;
        if (confirmedYn === String(row.__ORIGINAL_CONFIRMED_YN || "N")) {
            columnTypeDirtyChanges.delete(changeKey);
            if (!columnTypeDirtyChanges.has(`${rowId}:FINAL_PREDICTED_TYPE`)) {
                row.LABEL_SOURCE = row.__ORIGINAL_LABEL_SOURCE;
            }
        } else {
            columnTypeDirtyChanges.set(changeKey, {
                rowId,
                columnName: "CONFIRMED_YN",
                value: confirmedYn
            });
            row.LABEL_SOURCE = "USER_CONFIRMED";
        }
        row.CONFIRMED_YN = confirmedYn;
        renderColumnTypeFinal({ keepEditorOpen: true });
    }

    async function saveColumnTypeChanges() {
        if (!canEditColumnTypeFinal() || columnTypeSaveBusy || !columnTypeDirtyChanges.size) return;
        const saveButton = byId("qeColumnTypeSaveButton");
        let saved = false;
        columnTypeSaveBusy = true;
        if (saveButton) saveButton.disabled = true;
        try {
            const changes = Array.from(columnTypeDirtyChanges.values()).sort((left, right) => {
                const priority = { FINAL_PREDICTED_TYPE: 1, CONFIRMED_YN: 2 };
                return (priority[left.columnName] || 9) - (priority[right.columnName] || 9);
            });
            await client.saveColumnTypeFinal({
                owner: state.tableOwner,
                whereClause: getColumnTypeWhereClause(),
                changes
            });
            saved = true;
            state.columnTypeRerunRequestToken = "";
            persistState();
            columnTypeDirtyChanges.clear();
            getColumnTypeFinalRows().forEach((row) => {
                delete row.__ORIGINAL_FINAL_TYPE;
                delete row.__ORIGINAL_GROUP_CODE;
                delete row.__ORIGINAL_TYPE_CODE;
                delete row.__ORIGINAL_CONFIRMED_YN;
                delete row.__ORIGINAL_LABEL_SOURCE;
            });
            resultData.columnTypeFinal = await client.getColumnTypeFinal({
                owner: state.tableOwner,
                whereClause: getColumnTypeWhereClause(),
                limit: 1000
            });
            renderColumnTypeFinal({ keepEditorOpen: true });
            showToast("컬럼 유형을 저장했습니다. 이제 기존 작업공간에서 변경 유형으로 재실행할 수 있습니다.", "success");
        } catch (error) {
            showToast(
                saved
                    ? `저장은 완료했지만 최신 결과를 다시 불러오지 못했습니다. ${error.message || ""}`.trim()
                    : (error.message || "컬럼 유형을 저장하지 못했습니다."),
                saved ? "warning" : "error"
            );
        } finally {
            columnTypeSaveBusy = false;
            renderColumnTypeFinal({ keepEditorOpen: true });
        }
    }

    async function rerunWithChangedColumnTypes() {
        if (
            pipelineBusy
            || columnTypeSaveBusy
            || columnTypeDirtyChanges.size
            || !canEditColumnTypeFinal()
        ) return;
        if (!state.projectId || !state.scenarioId || !state.flowId || !state.flowRunId) {
            showToast("재실행할 기존 프로젝트·시나리오·FLOW 실행 정보를 확인할 수 없습니다.", "error");
            return;
        }

        pipelineBusy = true;
        activePipelineAction = PIPELINE_ACTION.COLUMN_TYPE_RERUN;
        state.status = "running";
        state.error = "";
        state.resultWarning = "";
        state.completedSteps = state.completedSteps.filter((stepIndex) => stepIndex < 6);
        state.currentStep = 6;
        state.stepProgress = 0.05;
        if (!state.columnTypeRerunRequestToken) {
            state.columnTypeRerunRequestToken = makeRunRequestToken();
        }
        const generation = ++pollGeneration;
        persistState();
        renderState("저장된 FINAL 유형을 적용해 기존 프로젝트·시나리오의 규칙 발굴 단계를 다시 실행합니다.");
        renderColumnTypeFinal({ keepEditorOpen: false });

        let ruleDiscoveryCompleted = false;
        try {
            const response = await client.rerunSavedFlowFromColumnTypes(
                state.flowId,
                state.projectId,
                state.scenarioId,
                state.flowRunId,
                state.columnTypeRerunRequestToken,
                buildQuickEditSummary()
            );
            const continuedRunId = Number(response.data?.flowRunId || 0);
            if (!continuedRunId || continuedRunId !== Number(state.flowRunId)) {
                throw new Error("기존 FLOW 실행 ID를 재사용하지 못해 재실행을 중단했습니다.");
            }
            state.lastRunStatus = response.data?.runStatus || "STARTED";
            state.lastRunMessage = response.message || "변경 컬럼유형으로 규칙 발굴 재실행을 시작했습니다.";
            currentSnapshot = null;
            persistState();
            renderHistory();

            await pollRunUntilTerminal(generation);
            ruleDiscoveryCompleted = true;
            completeStep(6, "변경된 컬럼 유형 기준 규칙 발굴 실행이 완료되었습니다.");
            setStep(7, "변경된 컬럼 유형으로 생성된 규칙 결과를 다시 불러오고 있습니다.", 0.5);
            await loadResults();
            controlCheckpoint();
            completeStep(7, "변경된 컬럼 유형 기준 결과 분석이 완료되었습니다.");
            state.status = state.resultWarning ? "warning" : "success";
            state.currentStep = 7;
            state.stepProgress = 1;
            state.columnTypeRerunRequestToken = "";
            persistState();
            renderState(state.resultWarning || "변경된 FINAL 컬럼 유형으로 규칙 발굴 결과를 갱신했습니다.");
            showToast(state.resultWarning || "변경 컬럼유형 재실행이 완료되었습니다.", state.resultWarning ? "warning" : "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            state.status = "failed";
            state.error = error?.message || "변경 컬럼유형 재실행 중 오류가 발생했습니다.";
            state.columnTypeRerunRequestToken = "";
            state.currentStep = ruleDiscoveryCompleted ? 7 : 6;
            persistState();
            renderState();
            renderColumnTypeFinal({ keepEditorOpen: false });
            showToast(state.error, "error");
        } finally {
            pipelineBusy = false;
            activePipelineAction = "";
            updateActionState();
            renderColumnTypeFinal({ keepEditorOpen: false });
        }
    }

    function renderStatisticsDetail(columnName) {
        const payload = getStatisticsPayload();
        const columns = Array.isArray(payload?.columns) ? payload.columns : [];
        const select = byId("qeStatisticsColumnSelect");
        const body = byId("qeStatisticsDetailBody");
        const sources = byId("qeStatisticsSources");
        if (!select || !body || !sources) return;
        if (!columns.length) {
            select.innerHTML = '<option value="">선택 가능한 컬럼 없음</option>';
            select.disabled = true;
            body.innerHTML = '<div class="qe-empty">표시할 기초통계량이 없습니다.</div>';
            sources.innerHTML = "";
            return;
        }

        select.disabled = false;
        select.innerHTML = columns.map((column, index) => (
            `<option value="${index}">${R.escapeHtml(statisticsColumnLabel(column))}</option>`
        )).join("");
        let index = columns.findIndex((column) => String(column.columnName || "") === String(columnName || ""));
        if (index < 0) index = Math.max(0, Number(select.value || 0));
        select.value = String(index);
        const column = columns[index];
        const before = column.before || {};
        const after = column.after || null;
        const beforeSource = payload.before || {};
        const afterSource = payload.after || null;
        sources.innerHTML = [
            `<span><i></i><b>${R.escapeHtml(beforeSource.label || (after ? "수정 전" : "현재"))}</b><em>${R.escapeHtml([beforeSource.owner, beforeSource.table].filter(Boolean).join("."))}</em></span>`,
            afterSource ? `<span class="is-after"><i></i><b>${R.escapeHtml(afterSource.label || "수정 후")}</b><em>${R.escapeHtml([afterSource.owner, afterSource.table].filter(Boolean).join("."))}</em></span>` : `<span class="is-after is-missing"><i></i><b>수정</b><em>INITDN$ 비교 대상 없음</em></span>`
        ].join("");
        const profileKind = String(column.profileKind || "NUMERIC").toUpperCase();
        const metricRows = profileKind === "NUMERIC" ? [
            ["건수", "valueCount", "number"], ["합계", "sum", "number"], ["평균", "mean", "number"], ["분산", "variance", "number"],
            ["표준편차", "stddev", "number"], ["왜도", "skewness", "number"], ["첨도", "kurtosis", "number"], ["메디안(중앙값)", "median", "number"],
            ["최소", "min", "number"], ["1사분위(Q1)", "q1", "number"], ["3사분위(Q3)", "q3", "number"], ["최대", "max", "number"]
        ] : [
            ["전체 건수", "totalRowCount", "number"], ["유효값 건수", "valueCount", "number"], ["결측 건수", "nullCount", "number"],
            ["고유값 수", "distinctCount", "number"], ["고유값 비율", "distinctRate", "percent"], ["최빈값", "modeValue", "text"],
            ["최빈값 빈도", "modeCount", "number"], ["최소 길이", "minLength", "number"], ["평균 길이", "avgLength", "number"],
            ["최대 길이", "maxLength", "number"], ["최솟값/최초값", "minValueText", "text"], ["최댓값/최종값", "maxValueText", "text"]
        ];
        const metricText = (metrics, key, format) => {
            const value = metrics?.[key];
            if (format === "text") return value === null || value === undefined || value === "" ? "-" : String(value);
            if (format === "percent") return formatPercent(value, 2);
            return formatStatistic(value, ["totalRowCount", "valueCount", "nullCount", "distinctCount", "modeCount", "minLength", "maxLength"].includes(key) ? 0 : 6);
        };
        const rows = metricRows.map(([label, key, format]) => {
            const beforeValue = format === "text" ? null : finiteNumber(before[key]);
            const afterValue = format === "text" ? null : finiteNumber(after?.[key]);
            const delta = beforeValue !== null && afterValue !== null ? afterValue - beforeValue : null;
            return `<tr><th scope="row">${R.escapeHtml(label)}</th>
                <td>${R.escapeHtml(metricText(before, key, format))}</td>
                <td>${R.escapeHtml(after ? metricText(after, key, format) : "-")}</td>
                <td class="${delta > 0 ? "is-increase" : delta < 0 ? "is-decrease" : ""}">${R.escapeHtml(format === "text" ? "-" : formatStatistic(delta, 6))}</td></tr>`;
        }).join("");
        const insight = column.insight || {};
        const reasons = Array.isArray(insight.priorityReasons) ? insight.priorityReasons.join(" · ") : "";
        const distribution = column.distribution && Array.isArray(column.distribution.bins)
            ? column.distribution
            : null;
        const distributionChart = profileKind === "NUMERIC"
            ? renderQuickStatisticsDistribution(column, distribution, Boolean(after))
            : renderQuickStatisticsTopValues(column, Boolean(after));
        const rankedNames = Array.isArray(payload?.insights?.rankedColumns)
            ? payload.insights.rankedColumns.map((item) => String(item.columnName || ""))
            : [];
        const railColumns = [...columns].sort((left, right) => {
            const leftIndex = rankedNames.indexOf(String(left.columnName || ""));
            const rightIndex = rankedNames.indexOf(String(right.columnName || ""));
            return (leftIndex < 0 ? 9999 : leftIndex) - (rightIndex < 0 ? 9999 : rightIndex);
        });
        const rail = `<aside class="qe-statistics-column-rail"><header><b>컬럼 · 변화 큰 순</b><small>${railColumns.length}개</small></header><div>${railColumns.map((item) => {
            const score = finiteNumber(item.insight?.importanceScore) || 0;
            const level = score >= 70 ? "high" : score >= 30 ? "medium" : "low";
            return `<button type="button" class="is-${level} ${item === column ? "is-active" : ""}" data-qe-statistics-column="${R.escapeHtml(String(item.columnName || ""))}"><i></i><span><b>${R.escapeHtml(String(item.columnName || "-"))}</b><small>${R.escapeHtml(String(item.columnComment || item.dataType || "-"))}</small></span><em>${R.escapeHtml(R.formatNumber(score, 1))}</em></button>`;
        }).join("")}</div></aside>`;
        body.innerHTML = `<div class="qe-statistics-profile-layout">${rail}<main><div class="qe-statistics-detail__heading">
                <div><span>${R.escapeHtml(`${column.typeGroupCode || column.profileKind || "OTHER"} · ${column.dataType || "-"}`)}</span><h3>${R.escapeHtml(column.columnName || "-")}</h3><p>${R.escapeHtml(column.columnComment || "컬럼 설명 없음")}</p></div>
                <div><strong>중요도 ${R.escapeHtml(R.formatNumber(insight.importanceScore || 0, 1))}</strong><small>${R.escapeHtml(reasons || "기초 분포 비교")}</small></div>
            </div>
            ${distributionChart}
            <div class="qe-detail-table-wrap"><table class="qe-detail-table qe-statistics-table">
                <thead><tr><th>측정값</th><th>${R.escapeHtml(beforeSource.label || (after ? "수정 전" : "현재"))}</th><th>${R.escapeHtml(afterSource?.label || "수정 후")}</th><th>증감</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            <p class="qe-statistics-method">컬럼유형 분석 결과를 물리 데이터타입보다 우선합니다. ${profileKind === "NUMERIC" ? "원본과 수정 분포는 공통 최소·최대 범위를 12개 동일 구간으로 비교하며 분산·표준편차는 모집단 기준입니다." : "범주·문자형은 고유값·최빈값·길이·상위 빈도를, 일시형은 최초·최종 시점을 제공합니다."}</p></main></div>`;
        body.querySelectorAll("[data-qe-statistics-column]").forEach((button) => {
            button.addEventListener("click", () => renderStatisticsDetail(button.dataset.qeStatisticsColumn));
        });
    }

    function renderQuickStatisticsTopValues(column, hasAfter) {
        const rows = Array.isArray(column?.topValues) ? column.topValues : [];
        return `<section class="qe-statistics-distribution ${rows.length ? "" : "is-empty"}"><header><div><span>TOP VALUES</span><h3>상위 값 분포</h3></div></header>
            ${rows.length ? `<div class="qe-detail-table-wrap"><table class="qe-detail-table"><thead><tr><th>값</th><th>원본</th><th>수정</th></tr></thead><tbody>${rows.map((row) => `<tr><th>${R.escapeHtml(String(row.value || "(빈 값)"))}</th><td>${R.escapeHtml(R.formatNumber(row.beforeCount || 0, 0))}</td><td>${hasAfter ? R.escapeHtml(R.formatNumber(row.afterCount || 0, 0)) : "-"}</td></tr>`).join("")}</tbody></table></div>` : "<p>집계 가능한 유효값이 없습니다.</p>"}
        </section>`;
    }

    function renderQuickStatisticsDistribution(column, distribution, hasAfter) {
        if (!distribution?.bins?.length) {
            return `<section class="qe-statistics-distribution is-empty"><h3>동일 구간 분포 비교</h3><p>이 실행에는 구간별 분포 집계가 없습니다.</p></section>`;
        }
        const width = 760;
        const height = 220;
        const padding = 30;
        const beforeValues = distribution.bins.map((bin) => bin.beforeCount || 0);
        const afterValues = distribution.bins.map((bin) => bin.afterCount || 0);
        const sharedMaximum = Math.max(...beforeValues, ...afterValues, 1);
        const path = (values) => {
            const maximum = sharedMaximum;
            return values.map((value, index) => {
                const x = padding + index * (width - padding * 2) / Math.max(1, values.length - 1);
                const y = height - padding - (Number(value || 0) / maximum) * (height - padding * 2);
                return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
            }).join(" ");
        };
        const beforePath = path(beforeValues);
        const afterPath = path(afterValues);
        const baseline = height - padding;
        return `<section class="qe-statistics-distribution"><header><div><span>DISTRIBUTION OVERLAY</span><h3>동일 구간 분포 비교</h3></div><div><b class="is-before">원본</b>${hasAfter ? `<b class="is-after">수정</b>` : ""}</div></header>
            <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${R.escapeHtml(String(column.columnName || ""))} 분포 비교">
                <line x1="${padding}" y1="${baseline}" x2="${width - padding}" y2="${baseline}" class="is-axis"></line>
                <path d="${beforePath} L${width - padding},${baseline} L${padding},${baseline} Z" class="is-before-area"></path><path d="${beforePath}" class="is-before-line"></path>
                ${hasAfter ? `<path d="${afterPath} L${width - padding},${baseline} L${padding},${baseline} Z" class="is-after-area"></path><path d="${afterPath}" class="is-after-line"></path>` : ""}
            </svg><div class="qe-statistics-distribution__axis"><span>${R.escapeHtml(formatStatistic(distribution.min))}</span><span>공통 12구간</span><span>${R.escapeHtml(formatStatistic(distribution.max))}</span></div></section>`;
    }

    function openStatisticsDialog(columnName) {
        const dialog = byId("qeStatisticsDialog");
        renderStatisticsDetail(columnName);
        if (typeof dialog?.showModal === "function") dialog.showModal();
    }

    function renderMixedXaiResults() {
        const common = window.RuleResultCommon;
        const summary = resultData.mixedXai?.summary || {};
        setText(byId("qeMixedXaiTitle"), common.t("Validation diagnostics"));
        const kpis = byId("qeMixedXaiKpis");
        if (kpis) kpis.innerHTML = R.renderKpis(common.diagnostics(summary));
        setText(byId("qeMixedXaiSummary"), common.notes(summary));
        let early = byId("qeMixedEarlyStages");
        if (!early && byId("qeMixedXaiResults")) {
            early = document.createElement("section");
            early.id = "qeMixedEarlyStages";
            early.className = "qe-result-block";
            byId("qeMixedXaiResults").insertAdjacentElement("afterend", early);
        }
        if (early) {
            const stages = ["PROFILE", "RELATION"].map((kind) => common.stageSummary(summary, kind));
            early.innerHTML = stages.map((stage) => `<details class="qe-details"><summary><strong>${R.escapeHtml(stage.title)}</strong></summary>
                <div class="qe-result-block"><div class="qe-kpi-grid">${R.renderKpis(stage.metrics)}</div><p class="qe-statistics-notice">${R.escapeHtml(stage.notes)}</p>
                ${stage.sections.map((section) => `<h4>${R.escapeHtml(section.title)}</h4><div class="qe-detail-table-wrap"><table class="qe-detail-table"><thead><tr>${section.columns.map((column) => `<th>${R.escapeHtml(section.columnLabels[column])}</th>`).join("")}</tr></thead>
                    <tbody>${section.rows.map((row) => `<tr>${section.columns.map((column) => `<td>${R.escapeHtml(row[column] ?? "-")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("")}</div></details>`).join("");
        }
    }

    function renderRuleSummaryTable(page = 1, kind = "categorical") {
        const target = byId(kind === "continuous" ? "qeContinuousSummaryTable" : "qeRuleSummaryTable");
        if (!target) return;
        const common = window.RuleResultCommon;
        const active = ruleDistributionFilters[kind];
        const summary = common.filterSummary(kind === "continuous" ? resultData.continuous?.symbolicRuleSummary : resultData.categorical, {
            conditionCount: active.type === "CONDITION_COUNT" ? active.value : "ALL",
            resultColumn: ["RESULT_COLUMN", "TARGET_COLUMN"].includes(active.type) ? active.value : "ALL", pageSize: 20
        }, page);
        const rows = summary.rules || [];
        const pattern = common.isPattern(resultData.mixedXai);
        const columns = pattern ? common.patternColumns : isMixedXai() ? common.columns : ["RULE_ID", "CONDITION_TEXT", "RESULT_TEXT", "CONDITION_COUNT", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT"];
        const labels = pattern ? common.patternColumnLabels() : common.columnLabels();
        if (!isMixedXai()) labels.RULE_SUPPORT = common.t("Support");
        const cell = (row, col) => col === "RESULT_TEXT" && common.isXai(row) ? common.t("Anomaly candidate")
            : col === "VALIDATION_STATUS" ? common.validationStatus(row[col])
            : row[col] ?? "-";
        const totalPages = Math.max(1, Math.ceil(summary.total / summary.pageSize));
        target.innerHTML = `<div class="qe-result-block__title"><h3>${R.escapeHtml(common.t("Rule summary table"))}</h3>
            <button type="button" class="qe-secondary-button" data-summary-export>${R.escapeHtml(common.t("Export"))}</button></div>
            <div class="qe-detail-table-wrap"><table class="qe-detail-table"><thead><tr>${columns.map((c) => `<th>${R.escapeHtml(labels[c] || c)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td${c === "RESULT_TEXT" && common.isFormula(row) ? ' class="is-rule-expression"' : ""}>${R.escapeHtml(cell(row, c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
            <div class="qe-dialog__actions"><span>${summary.total} · ${summary.page}/${totalPages}</span>
            <button type="button" class="qe-secondary-button" data-summary-page="${summary.page - 1}" ${summary.page <= 1 ? "disabled" : ""}>${R.escapeHtml(common.t("Previous"))}</button>
            <button type="button" class="qe-secondary-button" data-summary-page="${summary.page + 1}" ${summary.page >= totalPages ? "disabled" : ""}>${R.escapeHtml(common.t("Next"))}</button></div>`;
        target.querySelectorAll("[data-summary-page]").forEach((button) => {
            button.onclick = () => renderRuleSummaryTable(Number(button.dataset.summaryPage), kind);
        });
        target.querySelector("[data-summary-export]").onclick = () => {
            const escapeCell = (value) => {
                let text = String(value ?? "");
                if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
                return `"${text.replaceAll('"', '""')}"`;
            };
            const csv = [columns, ...rows.map((row) => columns.map((c) => cell(row, c)))].map((values) => values.map(escapeCell).join(",")).join("\r\n");
            const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url; link.download = "rule-summary.csv"; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
    }

    function renderResults() {
        const panel = byId("resultsSection", "qeResultsPanel");
        setHidden(panel, false);
        renderProcessSelection();
        if (isMixedXai()) renderMixedXaiResults();
        const categorical = resultData.categorical;
        const categoricalOverview = categorical?.overview || {};
        const categoryKpis = byId("categoryKpis", "qeCategoricalKpis");
        const categoryCharts = byId("categoryCharts", "qeCategoricalCharts");
        const categoryRules = byId("categoryRules", "qeCategoricalRules");
        const categoricalViolationOverview = getViolationSummary("categorical").overview || {};
        const categoricalComments = getResultColumnComments("categorical");
        const categoricalLegendRules = getDisplayedRules("categorical", { type: "ALL" });
        reconcileRuleDistributionFilter("categorical", categoricalLegendRules);
        const categoricalRules = getDisplayedRules("categorical");
        const categoricalFilter = ruleDistributionFilters.categorical;
        if (categoryKpis) categoryKpis.innerHTML = R.renderKpis(isMixedXai() && !window.RuleResultCommon.isPattern(resultData.mixedXai) ? [
            { label: window.RuleResultCommon.t("Total rules"), value: R.formatNumber(categoricalOverview.TOTAL_RULES, 0), tone: "primary" },
            { label: window.RuleResultCommon.t("Mapped rules"), value: R.formatNumber(categoricalOverview.MAPPED_RULES, 0) },
            { label: window.RuleResultCommon.t("Candidate rows"), value: R.formatNumber(categoricalViolationOverview.VIOLATION_COUNT, 0) },
            { label: window.RuleResultCommon.t("Rules with candidates"), value: R.formatNumber(categoricalViolationOverview.VIOLATED_RULE_COUNT, 0) }
        ] : window.RuleResultCommon.isPattern(resultData.mixedXai) ? [
            { label: window.RuleResultCommon.t("Total rules"), value: R.formatNumber(categoricalOverview.TOTAL_RULES, 0), tone: "primary" },
            { label: window.RuleResultCommon.t("Mapped rules"), value: R.formatNumber(categoricalOverview.MAPPED_RULES, 0) },
            { label: window.RuleResultCommon.t("Average confidence"), value: R.formatRatio(categoricalOverview.AVG_CONFIDENCE) },
            { label: window.RuleResultCommon.t("Average lift"), value: R.formatNumber(categoricalOverview.AVG_LIFT, 2) },
            { label: window.RuleResultCommon.t("Violation rows"), value: R.formatNumber(categoricalViolationOverview.VIOLATION_COUNT, 0) },
            { label: window.RuleResultCommon.t("Rules with violations"), value: R.formatNumber(categoricalViolationOverview.VIOLATED_RULE_COUNT, 0) }
        ] : [
            { label: "전체 규칙", value: R.formatNumber(categoricalOverview.TOTAL_RULES, 0), tone: "primary" },
            { label: "매핑 규칙", value: R.formatNumber(categoricalOverview.MAPPED_RULES, 0) },
            { label: "평균 신뢰도", value: R.formatRatio(categoricalOverview.AVG_CONFIDENCE) },
            { label: "평균 향상도", value: R.formatNumber(categoricalOverview.AVG_LIFT, 2) },
            { label: "위반 데이터", value: R.formatNumber(categoricalViolationOverview.VIOLATION_COUNT, 0), help: "저장된 범주형 위반 행" },
            { label: "위반 규칙", value: R.formatNumber(categoricalViolationOverview.VIOLATED_RULE_COUNT, 0), help: "위반이 발견된 규칙" }
        ]);
        if (categoryCharts) {
            const conditionItems = R.filterLegendItems((categorical?.conditionDist || []).map((row) => ({
                key: String(Number(row.CONDITION_COUNT || 0)),
                label: `${row.CONDITION_COUNT ?? 0} ${window.RuleResultCommon.t("Conditions")}`, value: Number(row.RULE_COUNT || 0)
            })), categoricalLegendRules, "categorical", "CONDITION_COUNT");
            const resultItems = R.filterLegendItems((categorical?.resultTop || []).map((row) => ({
                key: String(row.RESULT_COLUMN || "").trim().toUpperCase(),
                label: R.getColumnLabel(row.RESULT_COLUMN || "결과 미지정", categoricalComments), value: Number(row.RULE_COUNT || 0)
            })), categoricalLegendRules, "categorical", "RESULT_COLUMN");
            const chartBody = categoryCharts.querySelector("[data-chart-body]") || categoryCharts;
            chartBody.innerHTML = `
                <section><h4>${R.escapeHtml(window.RuleResultCommon.t("Rules by condition count"))}</h4>${R.renderBars(conditionItems, {
                    ariaLabel: "조건 개수별 범주형 규칙 수", interactive: true,
                    filterKind: "categorical", filterType: "CONDITION_COUNT", activeFilter: categoricalFilter
                })}</section>
                <section><h4>${R.escapeHtml(window.RuleResultCommon.t("Rules by result column"))}</h4>${R.renderBars(resultItems, {
                    accent: "mint", ariaLabel: "결과 컬럼별 범주형 규칙 수", interactive: true,
                    filterKind: "categorical", filterType: "RESULT_COLUMN", activeFilter: categoricalFilter
                })}</section>`;
            setText(
                categoryCharts.querySelector("[data-chart-caption]"),
                categoricalFilter.type === "ALL" ? window.RuleResultCommon.t("Top rules by group") : `${categoricalFilter.label} · ${window.RuleResultCommon.t("Selected")}`
            );
        }
        if (categoryRules) {
            categoryRules.innerHTML = R.renderCategoricalRules(categoricalRules, {
                columnComments: categoricalComments,
                mixedXai: isMixedXai(),
                mixedPattern: window.RuleResultCommon.isPattern(resultData.mixedXai),
                violationCounts: getViolationCountMap("categorical")
            });
            setText(
                categoryRules.closest(".qe-result-block")?.querySelector("[data-rule-count]"),
                categoricalFilter.type === "ALL"
                    ? `${window.RuleResultCommon.t("Top rules by group")} · ${categoricalRules.length}`
                    : `${categoricalFilter.label} · ${categoricalRules.length}`
            );
            prepareCategoricalDetail(categoricalRules);
        }
        renderRuleSummaryTable();
        setText(byId("categoryChartTitle"), window.RuleResultCommon.t("Rule distribution"));
        setText(byId("categoryRuleTitle"), window.RuleResultCommon.t("Top rules"));
        setText(byId("qeCategoricalDetail")?.querySelector(".qe-continuous-detail__header p"), window.RuleResultCommon.t("Select a rule to inspect its conditions, result and matching rows."));

        const continuous = resultData.continuous?.symbolicRuleSummary || {};
        const continuousOverview = continuous.overview || {};
        const continuousViolationOverview = getViolationSummary("continuous").overview || {};
        const continuousComments = getResultColumnComments("continuous");
        const continuousLegendRules = getDisplayedRules("continuous", { type: "ALL" });
        reconcileRuleDistributionFilter("continuous", continuousLegendRules);
        const displayedContinuousRules = getDisplayedRules("continuous");
        const continuousFilter = ruleDistributionFilters.continuous;
        const continuousKpis = byId("continuousKpis", "qeContinuousKpis");
        const continuousCharts = byId("continuousCharts", "qeContinuousCharts");
        const continuousRules = byId("continuousRules", "qeContinuousRules");
        if (continuousKpis) continuousKpis.innerHTML = R.renderKpis(isMixedXai() ? [
            { label: window.RuleResultCommon.t("Continuous formula rules"), value: R.formatNumber(continuousOverview.RULE_COUNT, 0), tone: "mint" },
            { label: window.RuleResultCommon.t("Target columns"), value: R.formatNumber(continuousOverview.TARGET_COLUMN_COUNT, 0) },
            { label: window.RuleResultCommon.t("Average within-tolerance rate"), value: R.formatRatio(continuousOverview.AVG_CONFIDENCE) },
            { label: window.RuleResultCommon.t("Average validation within-tolerance rate"), value: R.formatRatio(continuousOverview.AVG_VALIDATION_CONFIDENCE) },
            { label: window.RuleResultCommon.t("Average validation R²"), value: R.formatNumber(continuousOverview.AVG_VALIDATION_R2, 3) },
            { label: window.RuleResultCommon.t("Violation rows"), value: R.formatNumber(continuousViolationOverview.VIOLATION_COUNT, 0) }
        ] : [
            { label: "전체 수식 규칙", value: R.formatNumber(continuousOverview.RULE_COUNT, 0), tone: "mint" },
            { label: "대상 컬럼", value: R.formatNumber(continuousOverview.TARGET_COLUMN_COUNT, 0) },
            { label: "선택 규칙", value: R.formatNumber(continuousOverview.SELECTED_RULE_COUNT, 0) },
            { label: "평균 점수", value: R.formatNumber(continuousOverview.AVG_SCORE, 3) },
            { label: "위반 데이터", value: R.formatNumber(continuousViolationOverview.VIOLATION_COUNT, 0), help: "허용 오차를 벗어난 행" },
            { label: "평균 복잡도", value: R.formatNumber(continuousOverview.AVG_COMPLEXITY, 1), help: "수식 평균 항 수" }
        ]);
        if (continuousCharts) {
            const targetItems = R.filterLegendItems((continuous.targetGroups || []).map((row) => ({
                key: String(row.TARGET_COLUMN || "").trim().toUpperCase(),
                label: R.getColumnLabel(row.TARGET_COLUMN || "대상 미지정", continuousComments), value: Number(row.RULE_COUNT || 0)
            })), continuousLegendRules, "continuous", "TARGET_COLUMN");
            const methodItems = R.filterLegendItems((continuous.methodGroups || []).map((row) => ({
                key: String(row.METHOD || "").trim().toUpperCase(),
                label: isMixedXai() ? window.RuleResultCommon.formulaMethod(row) : row.METHOD || "방법 미지정", value: Number(row.RULE_COUNT || 0)
            })), continuousLegendRules, "continuous", "METHOD");
            const chartBody = continuousCharts.querySelector("[data-chart-body]") || continuousCharts;
            chartBody.innerHTML = `
                <section><h4>${R.escapeHtml(window.RuleResultCommon.t("Rules by result column"))}</h4>${R.renderBars(targetItems, {
                    ariaLabel: "대상 컬럼별 연속형 규칙 수", interactive: true,
                    filterKind: "continuous", filterType: "TARGET_COLUMN", activeFilter: continuousFilter
                })}</section>
                <section><h4>${R.escapeHtml(window.RuleResultCommon.t("Rules by discovery method"))}</h4>${R.renderBars(methodItems, {
                    accent: "mint", ariaLabel: "발굴 방법별 연속형 규칙 수", interactive: true,
                    filterKind: "continuous", filterType: "METHOD", activeFilter: continuousFilter
                })}</section>`;
            setText(
                continuousCharts.querySelector("[data-chart-caption]"),
                continuousFilter.type === "ALL" ? window.RuleResultCommon.t("Top rules by group") : `${continuousFilter.label} · ${window.RuleResultCommon.t("Selected")}`
            );
        }
        if (continuousRules) {
            continuousRules.innerHTML = R.renderContinuousRules(displayedContinuousRules, {
                columnComments: continuousComments,
                violationCounts: getViolationCountMap("continuous"),
                mixedPattern: isMixedXai(), emptyMessage: isMixedXai() ? window.RuleResultCommon.continuousDiagnostic(resultData.mixedXai).message : ""
            });
            setText(
                continuousRules.closest(".qe-result-block")?.querySelector("[data-rule-count]"),
                continuousFilter.type === "ALL"
                    ? `${window.RuleResultCommon.t("Top rules by group")} · ${displayedContinuousRules.length}`
                    : `${continuousFilter.label} · 상위 ${displayedContinuousRules.length}개`
            );
            prepareContinuousDetail(displayedContinuousRules);
        }
        setText(byId("continuousRuleTitle"), window.RuleResultCommon.t("Continuous formula rules"));
        setText(byId("continuousChartTitle"), window.RuleResultCommon.t("Rule distribution"));
        let continuousNotice = byId("qeContinuousDiscoveryNotice");
        let continuousTable = byId("qeContinuousSummaryTable");
        if (!continuousNotice && byId("continuousPanel")) {
            continuousNotice = document.createElement("section");
            continuousNotice.id = "qeContinuousDiscoveryNotice";
            continuousNotice.className = "qe-result-block";
            byId("continuousPanel").prepend(continuousNotice);
            continuousTable = document.createElement("section");
            continuousTable.id = "qeContinuousSummaryTable";
            continuousTable.className = "qe-result-block";
            byId("qeContinuousDetail")?.insertAdjacentElement("beforebegin", continuousTable);
        }
        setHidden(continuousNotice, !isMixedXai());
        setHidden(continuousTable, !isMixedXai());
        if (isMixedXai() && continuousNotice) {
            const diagnostic = window.RuleResultCommon.continuousDiagnostic(resultData.mixedXai);
            continuousNotice.innerHTML = `<p>${R.escapeHtml(diagnostic.message)}</p><div class="qe-kpi-grid">${R.renderKpis(diagnostic.metrics)}</div>
                ${diagnostic.reasons.length ? `<details class="qe-details"><summary>${R.escapeHtml(window.RuleResultCommon.t("Continuous discovery reasons"))}</summary><p>${R.escapeHtml(window.RuleResultCommon.t("Reason counts refer to excluded columns or rejected candidates, not source rows."))}</p><ul>${diagnostic.reasons.map((r) => `<li>${R.escapeHtml(r.label)}: ${R.escapeHtml(r.count)}</li>`).join("")}</ul></details>` : ""}`;
            renderRuleSummaryTable(1, "continuous");
        }

        renderDescriptiveStatistics();
        renderColumnTypeFinal();

        const warningTarget = byId("resultsWarning", "qeResultsWarning");
        if (warningTarget) {
            warningTarget.textContent = state.resultWarning || "";
            warningTarget.hidden = !state.resultWarning;
        }
    }

    function prepareCategoricalDetail(rules) {
        const panel = byId("qeCategoricalDetail");
        const safeRules = Array.isArray(rules) ? rules : [];
        if (!panel || !categoricalDetail.ruleId) {
            setHidden(panel, true);
            return;
        }
        const selectedIndex = safeRules.findIndex((rule) => String(rule.RULE_ID || "") === categoricalDetail.ruleId);
        if (selectedIndex < 0) {
            categoricalDetail = { ruleId: "", ruleIndex: -1 };
            setHidden(panel, true);
            return;
        }
        renderCategoricalDetail(selectedIndex, { scroll: false });
    }

    function prepareContinuousDetail(rules) {
        const panel = byId("qeContinuousDetail");
        const select = byId("qeContinuousRuleSelect");
        const safeRules = Array.isArray(rules) ? rules : [];
        setHidden(panel, safeRules.length === 0);
        if (!safeRules.length) {
            cancelContinuousDetailRequest();
            destroyFormulaChart();
            continuousDetail.ruleId = "";
            continuousDetail.rule = null;
            return;
        }
        if (!select) return;
        const selectedRuleId = continuousDetail.ruleId;
        select.innerHTML = safeRules.map((rule, index) => {
            const targetLabel = R.getColumnLabel(rule.TARGET_COLUMN || `규칙 ${index + 1}`, getResultColumnComments("continuous"));
            return `<option value="${index}">${R.escapeHtml(targetLabel)} · ${R.escapeHtml(window.RuleResultCommon.isFormula(rule) ? window.RuleResultCommon.formulaMethod(rule) : rule.METHOD || "수식 규칙")}</option>`;
        }).join("");
        const selectedIndex = safeRules.findIndex((rule) => String(rule.RULE_ID || "") === selectedRuleId);
        const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;
        select.value = String(nextIndex);
        const nextRuleId = String(safeRules[nextIndex]?.RULE_ID || "");
        if (nextRuleId && nextRuleId !== continuousDetail.ruleId) {
            window.setTimeout(() => loadContinuousDetail(nextIndex), 0);
        } else {
            renderContinuousDetail();
        }
    }

    function normalizeContinuousExpression(expression) {
        let normalized = String(expression || "").trim();
        if (!normalized) return { ok: false, message: "수식 정보가 없습니다." };
        if (/[`"';&{}\[\]]/.test(normalized)) {
            return { ok: false, message: "그래프 계산에서 허용하지 않는 문자가 수식에 포함되어 있습니다." };
        }
        const aliases = {
            abs: "abs", ceil: "ceil", ceiling: "ceil", cos: "cos", exp: "exp",
            floor: "floor", greatest: "max", least: "min", ln: "log", log: "log",
            max: "max", min: "min", mod: "mod", nullif: "nullif", nvl: "nvl",
            power: "pow", pow: "pow", round: "round", sign: "sign", sin: "sin",
            sqrt: "sqrt", square: "square", tan: "tan", trunc: "trunc"
        };
        normalized = normalized.replace(/\^/g, "**");
        normalized = normalized.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, (match, name) => {
            const canonical = aliases[String(name || "").toLowerCase()];
            return canonical ? `${canonical}(` : match;
        });
        return { ok: true, expression: normalized };
    }

    function compileContinuousExpression(expression, features) {
        const normalized = normalizeContinuousExpression(expression);
        if (!normalized.ok) return normalized;
        let formula = normalized.expression;
        const functions = {
            ceil: Math.ceil,
            floor: Math.floor,
            mod: (left, right) => Number(right) === 0 ? NaN : left % right,
            nullif: (left, right) => left === right ? NaN : left,
            nvl: (left, right) => Number.isFinite(Number(left)) ? left : right,
            round: (value, digits = 0) => {
                const scale = 10 ** Number(digits || 0);
                return Math.round(value * scale) / scale;
            },
            sign: Math.sign,
            square: (value) => value * value,
            sqrt: Math.sqrt,
            log: (left, right) => typeof right === "undefined" ? Math.log(left) : Math.log(right) / Math.log(left),
            exp: Math.exp,
            sin: Math.sin,
            cos: Math.cos,
            tan: Math.tan,
            abs: Math.abs,
            pow: Math.pow,
            max: Math.max,
            min: Math.min,
            trunc: (value, digits = 0) => {
                const scale = 10 ** Number(digits || 0);
                return Math.trunc(value * scale) / scale;
            }
        };
        const cleanFeatures = (Array.isArray(features) ? features : [])
            .map((item) => String(item || "").trim())
            .filter(Boolean);
        const allowedNames = new Set([...Object.keys(functions), "pi", "e", ...cleanFeatures.map((item) => item.toLowerCase())]);
        const identifiers = formula.match(/\b[A-Za-z_$][A-Za-z0-9_$#]*\b/g) || [];
        const unknown = identifiers.find((name) => !allowedNames.has(name.toLowerCase()));
        if (unknown) return { ok: false, message: `${unknown} 컬럼 또는 함수를 계산할 수 없습니다.` };
        const mapped = cleanFeatures.map((feature, index) => ({ feature, argument: `v${index}` }));
        mapped.forEach(({ feature, argument }) => {
            const escaped = feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            formula = formula.replace(
                new RegExp(`(^|[^A-Za-z0-9_$#])${escaped}(?=$|[^A-Za-z0-9_$#])`, "gi"),
                (_match, prefix) => `${prefix}${argument}`
            );
        });
        let evaluator;
        try {
            evaluator = new Function(
                ...mapped.map((item) => item.argument),
                ...Object.keys(functions),
                "pi",
                "e",
                `"use strict"; return (${formula});`
            );
        } catch (error) {
            return { ok: false, message: `수식을 그래프로 변환하지 못했습니다: ${error.message}` };
        }
        return {
            ok: true,
            evaluate(values) {
                const args = [
                    ...mapped.map(({ feature }) => Number(values[feature])),
                    ...Object.values(functions),
                    Math.PI,
                    Math.E
                ];
                try {
                    const value = Number(evaluator(...args));
                    return Number.isFinite(value) ? value : null;
                } catch (_error) {
                    return null;
                }
            }
        };
    }

    function getCaseInsensitiveValue(row, columnName) {
        const normalized = String(columnName || "").trim().toUpperCase();
        if (!row || !normalized) return undefined;
        const key = Object.keys(row).find((item) => String(item || "").trim().toUpperCase() === normalized);
        return key === undefined ? undefined : row[key];
    }

    function toFiniteNumber(value) {
        if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function evaluateContinuousRows(rule, rows) {
        const features = Array.isArray(rule?.FEATURE_LIST)
            ? rule.FEATURE_LIST
            : String(rule?.FEATURE_COLUMNS || "").split(",").map((item) => item.trim()).filter(Boolean);
        const targetColumn = String(rule?.TARGET_COLUMN || "").trim();
        const compiled = compileContinuousExpression(rule?.EXPRESSION, features);
        if (!compiled.ok) return { rows: [], error: compiled.message };
        const evaluated = (Array.isArray(rows) ? rows : []).map((row, index) => {
            const values = {};
            features.forEach((feature) => {
                values[feature] = toFiniteNumber(getCaseInsensitiveValue(row, feature));
            });
            const actual = toFiniteNumber(getCaseInsensitiveValue(row, targetColumn));
            if (!Number.isFinite(actual) || features.some((feature) => !Number.isFinite(values[feature]))) return null;
            const predicted = compiled.evaluate(values);
            if (!Number.isFinite(predicted)) return null;
            return {
                row,
                rowIndex: index,
                values,
                actual,
                predicted,
                residual: actual - predicted
            };
        }).filter(Boolean);
        return { rows: evaluated, error: evaluated.length ? "" : "계산 가능한 숫자형 샘플이 없습니다." };
    }

    function calculateContinuousMetrics(rows) {
        if (!rows.length) return null;
        const mean = rows.reduce((sum, item) => sum + item.actual, 0) / rows.length;
        const absoluteError = rows.reduce((sum, item) => sum + Math.abs(item.residual), 0);
        const squaredError = rows.reduce((sum, item) => sum + item.residual ** 2, 0);
        const totalSquared = rows.reduce((sum, item) => sum + (item.actual - mean) ** 2, 0);
        return {
            r2: totalSquared > Number.EPSILON ? 1 - (squaredError / totalSquared) : null,
            mae: absoluteError / rows.length,
            rmse: Math.sqrt(squaredError / rows.length),
            bias: rows.reduce((sum, item) => sum + item.residual, 0) / rows.length,
            maxError: Math.max(...rows.map((item) => Math.abs(item.residual)))
        };
    }

    function formatDiagnosticNumber(value, digits = 4) {
        if (value == null || value === "") return "-";
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        const absolute = Math.abs(number);
        if (absolute > 0 && (absolute < 0.000001 || absolute >= 1000000000)) return number.toExponential(4);
        return number.toLocaleString("ko-KR", { maximumFractionDigits: digits });
    }

    function cancelContinuousDetailRequest() {
        continuousDetailRequestId += 1;
        continuousDetailAbort?.abort();
        continuousDetailAbort = null;
    }

    function destroyFormulaChart() {
        formulaChartView?.destroy();
        formulaChartView = null;
        formulaChartPayload = null;
        const target = byId("qeFormulaRuleChart");
        if (target) {
            target.replaceChildren();
            target.hidden = true;
        }
    }

    function renderFormulaChart() {
        const panel = byId("qeContinuousDetail");
        if (!panel) return;
        let target = byId("qeFormulaRuleChart");
        if (!target) {
            target = document.createElement("div");
            target.id = "qeFormulaRuleChart";
            byId("qeContinuousRuleSummary")?.insertAdjacentElement("afterend", target);
        }
        target.hidden = false;
        if (!continuousDetail.chartPayload || continuousDetail.error) {
            formulaChartView?.destroy();
            formulaChartView = null;
            formulaChartPayload = null;
            const message = continuousDetail.error || window.FormulaRuleChart.t("Loading current source samples using the saved formula.");
            target.innerHTML = `<p class="qe-empty" role="status">${R.escapeHtml(message)}</p>`;
            return;
        }
        if (!formulaChartView) {
            formulaChartView = window.FormulaRuleChart.mount(target, continuousDetail.chartPayload, {
                translate: window.RuleResultCommon.t,
                columnComments: getResultColumnComments("continuous")
            });
        } else if (formulaChartPayload !== continuousDetail.chartPayload) {
            formulaChartView.update(continuousDetail.chartPayload);
        }
        formulaChartPayload = continuousDetail.chartPayload;
    }

    async function loadContinuousDetail(ruleIndex, force = false) {
        const rules = getDisplayedRules("continuous");
        const index = Math.max(0, Math.min(rules.length - 1, Number(ruleIndex) || 0));
        const rule = rules[index];
        const artifact = state.resultArtifacts?.continuous;
        if (!rule) return;
        const formula = window.RuleResultCommon.isFormula(rule);
        if (!formula && !artifact?.owner) return;
        const ruleId = String(rule.RULE_ID || "").trim();
        if (!ruleId) return;
        const select = byId("qeContinuousRuleSelect");
        if (select) select.value = String(index);
        const scope = { flowRunId: state.flowRunId, targetOwner: rule.TARGET_OWNER || state.tableOwner,
            targetTable: rule.TARGET_TABLE || state.tableName, modelName: rule.MODEL_NAME, ruleId };
        const detailKey = JSON.stringify([scope.flowRunId, scope.targetOwner, scope.targetTable, scope.modelName, ruleId]);
        if (!force && continuousDetail.detailKey === detailKey && (continuousDetail.chartPayload || continuousDetail.rows.length || continuousDetail.error)) {
            renderContinuousDetail();
            return;
        }
        cancelContinuousDetailRequest();
        destroyFormulaChart();
        const requestId = continuousDetailRequestId;
        const controller = new AbortController();
        continuousDetailAbort = controller;
        continuousDetail = {
            ruleId,
            detailKey,
            ruleIndex: index,
            rule,
            rows: [],
            evaluatedRows: [],
            metrics: null,
            sampleCount: 0,
            hasMore: false,
            error: "",
            selectedRowIndex: null,
            chartPoints: []
        };
        if (formula) renderContinuousDetail();
        setText(byId("qeContinuousDetailMessage"), "규칙 샘플과 수식 계산 결과를 불러오는 중입니다.");
        const metrics = byId("qeContinuousDetailMetrics");
        if (metrics) metrics.innerHTML = '<div><span>상태</span><strong>조회 중</strong><small>샘플 계산</small></div>';
        try {
            const response = formula ? await client.getMixedFormulaSample({ ...scope, sampleLimit: 300 }, { signal: controller.signal })
                : await client.getSymbolicRuleSample({
                owner: artifact.owner,
                ruleId,
                flowRunId: state.flowRunId,
                sampleLimit: 200
            }, { signal: controller.signal });
            if (requestId !== continuousDetailRequestId) return;
            const payload = response.data || {};
            if (formula) {
                const savedRule = payload.rule || {};
                continuousDetail.rule = { ...rule,
                    RESULT_TEXT: savedRule.resultText ?? rule.RESULT_TEXT,
                    CONDITION_TEXT: savedRule.conditionText ?? rule.CONDITION_TEXT,
                    RESULT_COLUMN: savedRule.resultColumn ?? rule.RESULT_COLUMN,
                    ABSOLUTE_TOLERANCE: savedRule.absoluteTolerance ?? rule.ABSOLUTE_TOLERANCE,
                    RELATIVE_TOLERANCE: savedRule.relativeTolerance ?? rule.RELATIVE_TOLERANCE };
                continuousDetail.chartPayload = payload;
                continuousDetail.error = "";
                renderContinuousDetail();
                return;
            }
            const mergedRule = { ...rule, ...(payload.rule || {}) };
            const rows = Array.isArray(payload.rows) ? payload.rows : [];
            const evaluation = evaluateContinuousRows(mergedRule, rows);
            continuousDetail = {
                ruleId,
                detailKey,
                ruleIndex: index,
                rule: mergedRule,
                rows,
                evaluatedRows: evaluation.rows,
                metrics: calculateContinuousMetrics(evaluation.rows),
                sampleCount: Number(payload.sampleCount ?? rows.length) || rows.length,
                hasMore: payload.hasMore === true || payload.isCapped === true,
                error: evaluation.error,
                selectedRowIndex: null,
                chartPoints: []
            };
        } catch (error) {
            if (requestId !== continuousDetailRequestId || error?.name === "AbortError") return;
            continuousDetail.error = error.message || (formula ? window.FormulaRuleChart.t("Could not load formula chart samples.") : "연속형 상세 샘플을 조회하지 못했습니다.");
        } finally {
            if (continuousDetailAbort === controller) continuousDetailAbort = null;
        }
        renderContinuousDetail();
    }

    function renderContinuousDetail() {
        const panel = byId("qeContinuousDetail");
        if (!panel || !continuousDetail.rule) return;
        panel.hidden = false;
        const rule = continuousDetail.rule;
        const formula = window.RuleResultCommon.isFormula(rule);
        setText(byId("qeContinuousDetailTitle"), formula ? window.RuleResultCommon.t("Continuous formula details") : "연속형 상세 그래프");
        setText(panel.querySelector(".qe-continuous-detail__header p"), formula ? window.FormulaRuleChart.t("The saved formula is evaluated against current source samples; no model is refitted.") : "샘플 데이터의 실제값과 수식 예측값을 비교합니다.");
        setHidden(byId("qeContinuousChartMode")?.closest("label"), formula);
        setHidden(panel.querySelector(".qe-continuous-chart-wrap"), formula);
        setHidden(panel.querySelector(".qe-continuous-sample"), formula);
        setHidden(byId("qeContinuousDetailMetrics"), formula);
        if (formula) {
            setText(byId("qeContinuousDetailReload"), window.RuleResultCommon.t("Reload"));
            setText(byId("qeContinuousRuleSelect")?.closest("label")?.querySelector("span"), window.RuleResultCommon.t("Rule"));
            byId("qeContinuousRuleSelect")?.setAttribute("aria-label", window.RuleResultCommon.t("Continuous formula details"));
        }
        const metrics = continuousDetail.metrics;
        const violationCount = getRuleViolationCount("continuous", rule);
        const summaryTarget = byId("qeContinuousRuleSummary");
        if (summaryTarget) {
            summaryTarget.innerHTML = renderInlineRuleContent(
                "continuous",
                continuousDetail.ruleIndex,
                rule
            );
        }
        if (formula) {
            renderFormulaChart();
            return;
        }
        destroyFormulaChart();
        const metricTarget = byId("qeContinuousDetailMetrics");
        if (metricTarget) metricTarget.innerHTML = [
            ["샘플", R.formatNumber(continuousDetail.sampleCount, 0), continuousDetail.hasMore ? "일부 표본" : "조회 행"],
            ["모델 점수", formatDiagnosticNumber(rule.SCORE, 4), "발굴 시 점수"],
            ["표본 R²", formatDiagnosticNumber(metrics?.r2, 4), "설명력"],
            ["MAE", formatDiagnosticNumber(metrics?.mae, 4), "평균 절대 오차"],
            ["RMSE", formatDiagnosticNumber(metrics?.rmse, 4), "큰 오차 가중"],
            ["위반 행", violationCount === null ? "-" : R.formatNumber(violationCount, 0), "허용 범위 초과"]
        ].map(([label, value, help]) => `<div><span>${R.escapeHtml(label)}</span><strong>${R.escapeHtml(value)}</strong><small>${R.escapeHtml(help)}</small></div>`).join("");
        renderContinuousSampleTable();
        window.requestAnimationFrame(drawContinuousDetailChart);
    }

    function renderContinuousSampleTable() {
        const target = byId("qeContinuousSampleTable");
        const summary = byId("qeContinuousSampleSummary");
        if (!target) return;
        const rows = continuousDetail.evaluatedRows || [];
        const rule = continuousDetail.rule || {};
        const comments = getResultColumnComments("continuous");
        const features = (Array.isArray(rule.FEATURE_LIST) ? rule.FEATURE_LIST : []).slice(0, 3);
        setText(summary, continuousDetail.hasMore
            ? `${R.formatNumber(rows.length, 0)}개 표본 표시 · 추가 행 있음`
            : `${R.formatNumber(rows.length, 0)}개 표본`);
        if (!rows.length) {
            target.innerHTML = `<p class="qe-empty">${R.escapeHtml(continuousDetail.error || "표시할 계산 샘플이 없습니다.")}</p>`;
            return;
        }
        const columns = [
            ...features.map((feature) => ({ key: feature, label: R.getColumnLabel(feature, comments), value: (item) => item.values[feature] })),
            { key: "actual", label: `실제 · ${R.getColumnLabel(rule.TARGET_COLUMN, comments)}`, value: (item) => item.actual },
            { key: "predicted", label: "예측값", value: (item) => item.predicted },
            { key: "residual", label: "잔차", value: (item) => item.residual }
        ];
        target.innerHTML = `<table class="qe-detail-table">
            <thead><tr><th>No</th>${columns.map((column) => `<th>${R.escapeHtml(column.label)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((item, index) => `<tr data-continuous-row-index="${item.rowIndex}" tabindex="${continuousDetail.selectedRowIndex === item.rowIndex || continuousDetail.selectedRowIndex == null && index === 0 ? 0 : -1}"
                    class="${continuousDetail.selectedRowIndex === item.rowIndex ? "is-selected" : ""}"
                    aria-selected="${continuousDetail.selectedRowIndex === item.rowIndex ? "true" : "false"}">
                <td class="is-number">${item.rowIndex + 1}</td>
                ${columns.map((column) => `<td class="is-number">${R.escapeHtml(formatDiagnosticNumber(column.value(item), 6))}</td>`).join("")}
            </tr>`).join("")}</tbody>
        </table>`;
    }

    function focusContinuousSampleRow(row, options = {}) {
        const grid = byId("qeContinuousSampleTable");
        if (!row || !grid) return;
        const detail = continuousDetail;
        if (options.scrollPage !== false) grid.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        window.requestAnimationFrame(() => {
            if (!row.isConnected || detail !== continuousDetail) return;
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
                behavior: "smooth"
            });
            if (options.focus !== false) row.focus({ preventScroll: true });
        });
    }

    function selectContinuousSampleRow(rowIndex, options = {}) {
        const normalizedIndex = Number(rowIndex);
        const item = (continuousDetail.evaluatedRows || []).find((row) => row.rowIndex === normalizedIndex);
        if (!item) return;
        continuousDetail.selectedRowIndex = normalizedIndex;
        const tableRows = byId("qeContinuousSampleTable")?.querySelectorAll("tr[data-continuous-row-index]") || [];
        tableRows.forEach((row) => {
            const selected = Number(row.dataset.continuousRowIndex) === normalizedIndex;
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", selected ? "true" : "false");
            row.tabIndex = selected ? 0 : -1;
            if (selected && options.scroll !== false) focusContinuousSampleRow(row, options);
        });
        drawContinuousDetailChart();
    }

    function findContinuousChartPoint(event, maxDistance = 12) {
        const canvas = byId("qeContinuousDetailChart");
        const points = continuousDetail.chartPoints || [];
        if (!canvas || !points.length) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        const scaleX = rect.width / Number(canvas.dataset.chartWidth || rect.width);
        const scaleY = rect.height / Number(canvas.dataset.chartHeight || rect.height);
        let nearest = null;
        let nearestDistance = maxDistance;
        points.forEach((point) => {
            const distance = Math.hypot(point.screenX * scaleX - x, point.screenY * scaleY - y);
            if (distance <= nearestDistance) {
                nearest = point;
                nearestDistance = distance;
            }
        });
        return nearest;
    }

    function handleContinuousChartClick(event) {
        const point = findContinuousChartPoint(event, window.RegressionDiagnostics.chartInteraction.hitRadius);
        if (!point) return;
        selectContinuousSampleRow(point.rowIndex);
    }

    function handleContinuousChartKeydown(event) {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)) return;
        const rows = continuousDetail.chartPoints || [];
        if (!rows.length) return;
        const focusedRow = event.target.closest?.("tr[data-continuous-row-index]");
        const current = rows.findIndex((row) => row.rowIndex === (focusedRow ? Number(focusedRow.dataset.continuousRowIndex) : continuousDetail.selectedRowIndex));
        let next = current >= 0 ? current : 0;
        if (current >= 0 && ["ArrowLeft", "ArrowUp"].includes(event.key)) next = Math.max(0, next - 1);
        else if (current >= 0 && ["ArrowRight", "ArrowDown"].includes(event.key)) next = Math.min(rows.length - 1, next + 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = rows.length - 1;
        event.preventDefault();
        selectContinuousSampleRow(rows[next].rowIndex, {focus: !!focusedRow, scrollPage: false});
    }

    function scheduleContinuousChartDraw() {
        window.clearTimeout(chartResizeTimer);
        chartResizeTimer = window.setTimeout(() => { chartResizeTimer = null; drawContinuousDetailChart(); }, 120);
    }

    function bindContinuousChartResize() {
        if (chartResizeBound) return;
        chartResizeBound = true;
        window.addEventListener("resize", scheduleContinuousChartDraw);
        const canvas = byId("qeContinuousDetailChart");
        if (canvas && typeof ResizeObserver === "function") {
            chartResizeObserver = new ResizeObserver(scheduleContinuousChartDraw);
            chartResizeObserver.observe(canvas);
        }
    }

    function destroyContinuousChartResize() {
        window.clearTimeout(chartResizeTimer); chartResizeTimer = null;
        chartResizeObserver?.disconnect(); chartResizeObserver = null;
        window.removeEventListener("resize", scheduleContinuousChartDraw);
        chartResizeBound = false;
    }

    function drawContinuousDetailChart() {
        if (window.RuleResultCommon.isFormula(continuousDetail.rule)) return;
        const canvas = byId("qeContinuousDetailChart");
        const message = byId("qeContinuousDetailMessage");
        const rows = continuousDetail.evaluatedRows || [];
        if (!canvas || !canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const cssWidth = canvas.clientWidth;
        const cssHeight = canvas.clientHeight;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(cssHeight * ratio);
        canvas.dataset.chartWidth = String(cssWidth);
        canvas.dataset.chartHeight = String(cssHeight);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, cssWidth, cssHeight);
        if (!rows.length) {
            continuousDetail.chartPoints = [];
            setText(message, continuousDetail.error || "그래프로 표시할 계산 샘플이 없습니다.");
            canvas.setAttribute("aria-label", continuousDetail.error || "그래프로 표시할 계산 샘플이 없습니다.");
            canvas.title = "";
            context.fillStyle = "#718096";
            context.font = "12px system-ui, sans-serif";
            context.textAlign = "center";
            context.fillText("표시할 연속형 샘플이 없습니다.", cssWidth / 2, cssHeight / 2);
            return;
        }
        const mode = valueOf("qeContinuousChartMode") || "actual-predicted";
        const diagnostic = R.buildRegressionDiagnostics(rows.map((item) => mode === "residual"
            ? { x: item.predicted, y: item.residual, residual: item.residual, rowIndex: item.rowIndex }
            : { x: item.actual, y: item.predicted, residual: item.residual, rowIndex: item.rowIndex }));
        const points = diagnostic.points;
        if (!points.length) {
            continuousDetail.chartPoints = [];
            setText(message, "그래프로 표시할 유효한 숫자 표본이 없습니다.");
            canvas.setAttribute("aria-label", "그래프로 표시할 유효한 숫자 표본이 없습니다.");
            canvas.title = "";
            return;
        }
        const allX = points.map((item) => item.x);
        const allY = [...points.map((item) => item.y), ...diagnostic.bands.flatMap((band) => [band.piLower, band.piUpper])];
        let minX = Math.min(...allX);
        let maxX = Math.max(...allX);
        let minY = Math.min(...allY);
        let maxY = Math.max(...allY);
        if (mode !== "residual") {
            minX = minY = Math.min(minX, minY);
            maxX = maxY = Math.max(maxX, maxY);
        } else {
            minY = Math.min(minY, 0);
            maxY = Math.max(maxY, 0);
        }
        const padRange = (min, max) => {
            const span = max - min || Math.max(1, Math.abs(min) * 0.1);
            return [min - span * 0.08, max + span * 0.08];
        };
        [minX, maxX] = padRange(minX, maxX);
        [minY, maxY] = padRange(minY, maxY);
        const tickSteps = cssWidth < 480 ? 3 : 5;
        context.font = "11px system-ui, sans-serif";
        const tickWidths = Array.from({length: tickSteps + 1}, (_, index) => ({
            x: context.measureText(formatDiagnosticNumber(minX + (maxX - minX) * index / tickSteps, 3)).width,
            y: context.measureText(formatDiagnosticNumber(minY + (maxY - minY) * index / tickSteps, 3)).width
        }));
        const plot = { left: Math.max(68, Math.ceil(Math.max(...tickWidths.map((item) => item.y))) + 36),
            top: 45, right: cssWidth - Math.max(22, Math.ceil(Math.max(...tickWidths.map((item) => item.x)) / 2) + 4), bottom: cssHeight - 52 };
        plot.top = Math.max(plot.top, R.drawRegressionLegend(context, diagnostic, plot, false) + 12);
        const mapX = (value) => plot.left + ((value - minX) / (maxX - minX)) * (plot.right - plot.left);
        const mapY = (value) => plot.bottom - ((value - minY) / (maxY - minY)) * (plot.bottom - plot.top);
        context.font = "11px system-ui, sans-serif";
        context.textAlign = "right";
        context.textBaseline = "middle";
        for (let index = 0; index <= tickSteps; index += 1) {
            const xValue = minX + ((maxX - minX) * index / tickSteps);
            const yValue = minY + ((maxY - minY) * index / tickSteps);
            const x = mapX(xValue);
            const y = mapY(yValue);
            context.strokeStyle = "#e7edf4";
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(x, plot.top);
            context.lineTo(x, plot.bottom);
            context.moveTo(plot.left, y);
            context.lineTo(plot.right, y);
            context.stroke();
            context.fillStyle = "#718096";
            context.textAlign = "center";
            context.fillText(formatDiagnosticNumber(xValue, 3), x, plot.bottom + 16);
            context.textAlign = "right";
            context.fillText(formatDiagnosticNumber(yValue, 3), plot.left - 9, y);
        }
        R.drawRegressionLegend(context, diagnostic, plot);
        R.drawRegressionBands(context, diagnostic, mapX, mapY);
        const referenceStyle = window.RegressionDiagnostics.chartStyle.reference;
        context.strokeStyle = referenceStyle.stroke;
        context.lineWidth = referenceStyle.width;
        context.setLineDash(referenceStyle.dash);
        context.beginPath();
        if (mode === "residual") {
            context.moveTo(plot.left, mapY(0));
            context.lineTo(plot.right, mapY(0));
        } else {
            const start = Math.max(minX, minY);
            const end = Math.min(maxX, maxY);
            context.moveTo(mapX(start), mapY(start));
            context.lineTo(mapX(end), mapY(end));
        }
        context.stroke();
        context.setLineDash([]);
        continuousDetail.chartPoints = points.map((point) => ({
            ...point,
            screenX: mapX(point.x),
            screenY: mapY(point.y)
        }));
        window.RegressionDiagnostics.drawPlotFrame(context, plot);
        [...continuousDetail.chartPoints].sort((a, b) => Number(a.rowIndex === continuousDetail.selectedRowIndex) - Number(b.rowIndex === continuousDetail.selectedRowIndex)).forEach((point) => {
            const outlier = point.isAttention === true;
            const selected = point.rowIndex === continuousDetail.selectedRowIndex;
            window.RegressionDiagnostics.drawPoint(context, point.screenX, point.screenY, outlier, selected);
        });
        const comments = getResultColumnComments("continuous");
        const targetLabel = R.getColumnLabel(continuousDetail.rule?.TARGET_COLUMN || "Y", comments);
        const xLabel = mode === "residual" ? `예측값 · ${targetLabel}` : `실제값 · ${targetLabel}`;
        const yLabel = mode === "residual" ? "잔차 (실제값 - 예측값)" : `예측값 · ${targetLabel}`;
        context.fillStyle = "#344159";
        context.font = "600 11px system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(xLabel, (plot.left + plot.right) / 2, cssHeight - 10);
        context.save();
        context.translate(13, (plot.top + plot.bottom) / 2);
        context.rotate(-Math.PI / 2);
        context.fillText(yLabel, 0, 0);
        context.restore();
        const referenceMessage = mode === "residual"
            ? "주황 점선은 잔차 0입니다."
            : "주황 점선(y=x)에 가까울수록 예측 오차가 작습니다.";
        const detailMessage = `${referenceMessage} ${R.getRegressionDiagnosticMessage(diagnostic)}`;
        setText(message, detailMessage);
        canvas.setAttribute("aria-label", `${targetLabel} ${mode === "residual" ? "예측값과 잔차" : "실제값과 예측값"} 비교 그래프, ${points.length}개 표본. ${diagnostic.ok ? `95% PI 밖 ${diagnostic.outsideCount}개.` : "경계 산정 불가."} ${detailMessage}`);
    }

    function selectResultTab(tabName) {
        document.querySelectorAll("[data-result-tab]").forEach((button) => {
            const active = button.dataset.resultTab === tabName;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
            button.tabIndex = active ? 0 : -1;
        });
        document.querySelectorAll("[data-result-panel]").forEach((panel) => {
            const active = panel.dataset.resultPanel === tabName;
            panel.hidden = !active;
            panel.tabIndex = active ? 0 : -1;
        });
        if (tabName === "continuous") window.requestAnimationFrame(drawContinuousDetailChart);
    }

    function handleResultTabKeydown(event) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...document.querySelectorAll("[data-result-tab]")].filter((tab) => !tab.hidden);
        if (!tabs.length) return;
        const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
        let nextIndex = currentIndex;
        if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = tabs.length - 1;
        else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        selectResultTab(nextTab.dataset.resultTab);
        nextTab.focus();
    }

    function getQuickMethodLabel(method) {
        const normalized = String(method || "").trim().toUpperCase();
        if (!normalized) return "자동 수식 탐색";
        if (normalized.includes("POLYNOMIAL")) return "다항 회귀";
        if (normalized.includes("LASSO")) return "주요 변수 선형식";
        if (normalized.includes("ROBUST")) return "이상치에 강한 회귀";
        if (normalized.includes("LINEAR")) return "선형 회귀";
        if (normalized.includes("SYMBOLIC")) return "수식 탐색";
        return "자동 수식 탐색";
    }

    function renderInlineRuleContent(kind, index, rule) {
        const comments = getResultColumnComments(kind);
        if (kind === "categorical" || window.RuleResultCommon.isFormula(rule)) {
            const common = window.RuleResultCommon;
            const mixed = common.isXai(rule);
            const resultText = mixed ? common.t("Anomaly candidate") : (rule.RESULT_TEXT
                || [rule.RESULT_COLUMN, rule.RESULT_VALUE].filter((value) => value != null && value !== "").join(" = ") || "-");
            const pattern = common.isPattern(rule);
            const metrics = mixed || pattern ? common.metrics(rule) : [
                { label: common.t("Confidence"), value: R.formatRatio(rule.RULE_CONFIDENCE) },
                { label: common.t("Lift"), value: R.formatNumber(rule.RULE_LIFT, 3) }
            ];
            return `<div class="qe-quick-insight"><strong>${R.escapeHtml(common.t("Details"))}</strong>
                <span>${R.escapeHtml(mixed || pattern ? common.ruleNotes(rule, resultData.mixedXai?.summary) : common.t("IF is satisfied but THEN is not satisfied."))}</span></div>
                <dl class="qe-rule-fields qe-rule-fields--inline">
                    <div class="is-wide"><dt>${R.escapeHtml(common.t("Condition"))} · IF</dt><dd>${R.escapeHtml(R.annotateColumnText(rule.CONDITION_TEXT || rule.CONDITION_COLUMN || "-", comments))}</dd></div>
                    <div class="is-wide"><dt>${R.escapeHtml(common.t("Result"))} · THEN</dt><dd>${R.escapeHtml(R.annotateColumnText(resultText, comments))}</dd></div>
                    <div><dt>${R.escapeHtml(common.t("Result column"))}</dt><dd>${R.escapeHtml(R.getColumnLabel(rule.RESULT_COLUMN || "-", comments))}</dd></div>
                    <div><dt>${R.escapeHtml(common.t("Condition count"))}</dt><dd>${R.escapeHtml(R.formatNumber(rule.CONDITION_COUNT, 0))}</dd></div>
                    ${metrics.map((m) => `<div><dt>${R.escapeHtml(m.label)}</dt><dd>${R.escapeHtml(m.value)}</dd></div>`).join("")}
                    ${mixed || pattern ? `<div><dt>${R.escapeHtml(common.t("Validation status"))}</dt><dd>${R.escapeHtml(common.validationStatus(rule.VALIDATION_STATUS))}</dd></div>` : ""}
                </dl>${renderRuleViolationAction(kind, index, rule)}`;
        }

        const features = Array.isArray(rule.FEATURE_LIST)
                ? rule.FEATURE_LIST
                : String(rule.FEATURE_COLUMNS || "").split(",").map((item) => item.trim()).filter(Boolean);
        const featureText = features.length
            ? features.map((column) => R.getColumnLabel(column, comments)).join(", ")
            : "-";
        const violationCount = getRuleViolationCount("continuous", rule);
        const insight = violationCount === null
            ? "실제값과 수식 예측값의 차이가 큰 데이터를 아래에서 확인할 수 있습니다."
            : `허용 범위를 벗어난 데이터 ${R.formatNumber(violationCount, 0)}건이 발견되었습니다.`;
        return `<div class="qe-quick-insight">
                <strong>핵심 안내</strong>
                <span>${R.escapeHtml(insight)}</span>
            </div>
            <dl class="qe-rule-fields qe-rule-fields--inline">
                <div><dt>대상 컬럼</dt><dd>${R.escapeHtml(R.getColumnLabel(rule.TARGET_COLUMN || "-", comments))}</dd></div>
                <div><dt>분석 방식</dt><dd>${R.escapeHtml(getQuickMethodLabel(rule.METHOD))}</dd></div>
                <div class="is-wide"><dt>예측 수식</dt><dd><code class="qe-rule-expression">${R.escapeHtml(rule.EXPRESSION || "-")}</code></dd></div>
                <div class="is-wide"><dt>사용 컬럼</dt><dd>${R.escapeHtml(featureText)}</dd></div>
                <div><dt>점수</dt><dd>${R.escapeHtml(R.formatNumber(rule.SCORE, 3))}</dd></div>
                <div><dt>수식 항 수</dt><dd>${R.escapeHtml(R.formatNumber(rule.COMPLEXITY, 0))}개</dd></div>
            </dl>
            ${renderRuleViolationAction(kind, index, rule)}`;
    }

    function renderCategoricalDetail(index, options = {}) {
        const rules = getDisplayedRules("categorical");
        const normalizedIndex = Math.max(0, Math.min(rules.length - 1, Number(index) || 0));
        const rule = rules[normalizedIndex];
        const panel = byId("qeCategoricalDetail");
        const body = byId("qeCategoricalDetailBody");
        if (!panel || !body || !rule) return;
        categoricalDetail = { ruleId: String(rule.RULE_ID || ""), ruleIndex: normalizedIndex };
        setText(byId("qeCategoricalDetailTitle"), `${window.RuleResultCommon.t("IF–THEN rule detail")} · ${rule.RULE_ID || normalizedIndex + 1}`);
        body.innerHTML = renderInlineRuleContent("categorical", normalizedIndex, rule);
        panel.hidden = false;
        if (options.scroll !== false) {
            window.setTimeout(() => panel.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
        }
    }

    function openInlineRuleDetail(kind, index) {
        if (kind === "categorical") {
            renderCategoricalDetail(index);
            return;
        }
        loadContinuousDetail(index).catch((error) => showToast(error.message, "error"));
        window.setTimeout(() => byId("qeContinuousDetail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }

    function renderRuleViolationAction(kind, index, rule) {
        const count = getRuleViolationCount(kind, rule);
        const mixed = window.RuleResultCommon.isXai(rule);
        const pattern = window.RuleResultCommon.isPattern(rule);
        const countLabel = mixed || pattern ? `${window.RuleResultCommon.t(pattern ? "Violation rows" : "Candidate rows")} ${R.formatNumber(count, 0)}` : (count === null ? "저장된 위반 데이터를 조회합니다." : `저장된 위반 ${R.formatNumber(count, 0)}건`);
        return `<div class="qe-rule-violation-actions">
            <span>${R.escapeHtml(countLabel)}</span>
            <button type="button" class="qe-secondary-button" data-load-violations="true"
                    data-rule-kind="${R.escapeHtml(kind)}" data-rule-index="${index}">${R.escapeHtml(window.RuleResultCommon.t(mixed ? "View candidates" : "View violations"))}</button>
        </div>
        <div class="qe-rule-violation-result" data-violation-result data-rule-kind="${R.escapeHtml(kind)}" hidden></div>`;
    }

    function getRuleByKind(kind, index) {
        return getDisplayedRules(kind)[index];
    }

    function setRuleViolationPageBusy(target, busy) {
        if (!target) return;
        target.toggleAttribute("aria-busy", busy);
        target.querySelectorAll("[data-violation-page]").forEach((pageButton) => {
            if (busy) {
                pageButton.dataset.wasDisabled = pageButton.disabled ? "true" : "false";
                pageButton.disabled = true;
            } else if (Object.prototype.hasOwnProperty.call(pageButton.dataset, "wasDisabled")) {
                pageButton.disabled = pageButton.dataset.wasDisabled === "true";
                delete pageButton.dataset.wasDisabled;
            }
        });
    }

    async function loadRuleViolations(kind, index, page = 1) {
        const rule = getRuleByKind(kind, index);
        const artifact = kind === "categorical"
            ? state.resultArtifacts?.categoricalViolation
            : state.resultArtifacts?.continuousViolation;
        const detailPanel = kind === "categorical" ? byId("qeCategoricalDetail") : byId("qeContinuousDetail");
        const resultTarget = detailPanel?.querySelector(`[data-violation-result][data-rule-kind="${kind}"]`);
        const button = detailPanel?.querySelector(`[data-load-violations][data-rule-kind="${kind}"]`);
        if (!resultTarget || !rule) return;
        resultTarget.hidden = false;
        const hasRenderedGrid = Boolean(resultTarget.querySelector("[data-violation-grid]"));
        if (!hasRenderedGrid) {
            resultTarget.innerHTML = "<p>위반 데이터를 조회하고 있습니다.</p>";
        }
        setRuleViolationPageBusy(resultTarget, true);
        if (button) button.disabled = true;
        if (!artifact?.owner || !artifact?.objectName) {
            resultTarget.innerHTML = "<p>이 실행에서 저장된 위반 결과 테이블을 찾지 못했습니다.</p>";
            setRuleViolationPageBusy(resultTarget, false);
            if (button) button.disabled = false;
            return;
        }
        try {
            const response = await client.getViolationRows({
                owner: artifact.owner,
                objectName: artifact.objectName,
                targetOwner: artifact.targetOwner || state.tableOwner,
                targetTable: artifact.targetTable || state.tableName,
                ruleModelName: state.resultArtifacts?.categorical?.objectName,
                mixedPattern: state.resultArtifacts?.mixedPattern,
                ruleId: rule.RULE_ID,
                flowRunId: state.flowRunId,
                page,
                pageSize: 20
            });
            renderRuleViolationRows(resultTarget, response, kind, index, page);
        } catch (error) {
            const message = error.message || "위반 데이터를 조회하지 못했습니다.";
            if (hasRenderedGrid) {
                showToast(message, "error");
            } else {
                resultTarget.innerHTML = `<p>${R.escapeHtml(message)}</p>`;
            }
        } finally {
            setRuleViolationPageBusy(resultTarget, false);
            if (button) button.disabled = false;
        }
    }

    function renderRuleViolationRows(target, response, kind, index, page) {
        const rows = Array.isArray(response?.data) ? response.data : [];
        const total = Number(response?.total || 0);
        const pageSize = Number(response?.pageSize || 20);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (!rows.length) {
            target.innerHTML = `<p>${R.escapeHtml(response?.mixedXai ? window.RuleResultCommon.t("No saved candidate rows for this rule.") : window.RuleResultCommon.t("No saved violation rows for this rule."))}</p>`;
            return;
        }
        const formula = rows.every((row) => window.RuleResultCommon.isFormula(row));
        const preferred = kind === "categorical" || formula
            ? ["CASE_ID", "RESULT_COLUMN", "EXPECTED_VALUE", "ACTUAL_VALUE", "EXPECTED_LOWER", "EXPECTED_UPPER", "RESIDUAL", "ABS_ERROR", "VIOLATION_SCORE", "RULE_CONFIDENCE", "RULE_LIFT", "VIOLATION_REASON"]
            : ["CASE_ID", "TARGET_COLUMN", "PREDICTED_VALUE", "ACTUAL_VALUE", "ABS_ERROR", "ERROR_PCT", "TOLERANCE_PCT", "VIOLATION_SCORE", "VIOLATION_REASON"];
        const available = new Set(Object.keys(rows[0] || {}).map((key) => key.toUpperCase()));
        const columns = (response?.mixedXai ? [...preferred, ...new Set(rows.flatMap(Object.keys))].filter((key, i, all) => available.has(key.toUpperCase()) && all.indexOf(key) === i) : preferred.filter((key) => available.has(key))).filter((key) => !formula || key !== "RULE_LIFT");
        const labels = response?.mixedXai || response?.mixedPattern ? window.RuleResultCommon.candidateColumnLabels() : {
            CASE_ID: "행 식별값", RESULT_COLUMN: "결과 컬럼", TARGET_COLUMN: "대상 컬럼",
            EXPECTED_VALUE: "기대값", PREDICTED_VALUE: "예측값", ACTUAL_VALUE: "실제값",
            ABS_ERROR: "절대 오차", ERROR_PCT: "오차율", TOLERANCE_PCT: "허용 오차율",
            VIOLATION_SCORE: "위반 점수", RULE_CONFIDENCE: "신뢰도", RULE_LIFT: "향상도",
            VIOLATION_REASON: "위반 사유"
        };
        const comments = getResultColumnComments(kind);
        const numericColumns = R.getViolationNumericColumns(kind);
        ["EXPECTED_LOWER", "EXPECTED_UPPER", "RESIDUAL", "ABS_ERROR"].forEach((column) => numericColumns.add(column));
        if (rows.some((row) => window.RuleResultCommon.isFormula(row))) labels.RULE_CONFIDENCE = window.RuleResultCommon.t("Within-tolerance rate");
        const renderValue = (row, column) => {
            const value = row[column];
            if (column === "ACTUAL_VALUE") return window.RuleResultCommon.actualValue(value);
            if (column === "VIOLATION_REASON") return window.RuleResultCommon.violationReason(value, row);
            if (value == null || value === "") return "-";
            if (column === "MODEL_AGREEMENT") return formatPercent(value);
            if (["RESULT_COLUMN", "TARGET_COLUMN"].includes(column)) return R.getColumnLabel(value, comments);
            if (["ERROR_PCT", "TOLERANCE_PCT"].includes(column)) return R.formatRatio(value, 2);
            if (numericColumns.has(column)) return formatDiagnosticNumber(value, 5);
            return value == null || value === "" ? "-" : String(value);
        };
        const summaryMarkup = response?.mixedXai
            ? `<strong>${R.escapeHtml(window.RuleResultCommon.t("Candidate preview"))}</strong><span>${R.escapeHtml(R.formatNumber(total, 0))} · ${page}/${totalPages}</span><p>${R.escapeHtml(window.RuleResultCommon.t("Counts are rule-row matches; one row may match several rules. Only a bounded preview is stored."))}</p>`
            : `<strong>${R.escapeHtml(window.RuleResultCommon.t(response?.mixedPattern ? "Violation preview" : "Violation data"))}</strong><span>${R.escapeHtml(R.formatNumber(total, 0))} · ${page}/${totalPages}</span>${response?.mixedPattern ? `<p>${R.escapeHtml(window.RuleResultCommon.t("Counts are rule-row matches; one row may match several rules. Only a bounded preview is stored."))}</p>` : ""}`;
        const gridMarkup = `
            <table class="qe-detail-table">
                <thead><tr><th>No</th>${columns.map((column) => `<th>${R.escapeHtml(labels[column] || column)}</th>`).join("")}</tr></thead>
                <tbody>${rows.map((row, rowIndex) => `<tr>
                        <td class="is-number">${R.escapeHtml(R.formatNumber(((page - 1) * pageSize) + rowIndex + 1, 0))}</td>
                        ${columns.map((column) => `<td class="${numericColumns.has(column) ? "is-number" : ""}" title="${R.escapeHtml(renderValue(row, column))}">${R.escapeHtml(renderValue(row, column))}</td>`).join("")}
                    </tr>`).join("")}</tbody>
            </table>`;
        const paginationMarkup = `
                <button type="button" class="qe-secondary-button" data-violation-page="${Math.max(1, page - 1)}"
                        data-rule-kind="${R.escapeHtml(kind)}" data-rule-index="${index}" ${page <= 1 ? "disabled" : ""}>${R.escapeHtml(window.RuleResultCommon.t("Previous"))}</button>
                <button type="button" class="qe-secondary-button" data-violation-page="${Math.min(totalPages, page + 1)}"
                        data-rule-kind="${R.escapeHtml(kind)}" data-rule-index="${index}" ${page >= totalPages ? "disabled" : ""}>${R.escapeHtml(window.RuleResultCommon.t("Next"))}</button>`;
        const summaryTarget = target.querySelector("[data-violation-summary]");
        const gridTarget = target.querySelector("[data-violation-grid]");
        const paginationTarget = target.querySelector("[data-violation-pagination]");
        if (summaryTarget && gridTarget && paginationTarget) {
            summaryTarget.innerHTML = summaryMarkup;
            gridTarget.innerHTML = gridMarkup;
            paginationTarget.innerHTML = paginationMarkup;
            return;
        }
        target.innerHTML = `
            <div class="qe-continuous-sample__title" data-violation-summary>${summaryMarkup}</div>
            <div class="qe-detail-table-wrap" data-violation-grid>${gridMarkup}</div>
            <div class="qe-dialog__actions" data-violation-pagination>${paginationMarkup}</div>`;
    }

    function renderQuickHistoryList() {
        const target = byId("qeRunHistoryList");
        const count = byId("qeRunHistoryCount");
        const pageInfo = byId("qeRunHistoryPageInfo");
        const moreButton = byId("qeRunHistoryMore");
        if (!target) return;

        setText(count, quickHistoryDetailRunId
            ? `실행 #${quickHistoryDetailRunId} 상세를 불러오는 중입니다.`
            : quickHistoryBusy
            ? "최근 실행을 불러오는 중입니다."
            : `최근 퀵 실행 ${quickHistoryTotal.toLocaleString("ko-KR")}건 중 ${quickHistoryRows.length.toLocaleString("ko-KR")}건`);
        setText(pageInfo, quickHistoryTotal
            ? `${quickHistoryRows.length.toLocaleString("ko-KR")} / ${quickHistoryTotal.toLocaleString("ko-KR")}건 표시`
            : "표시할 실행 없음");
        if (moreButton) {
            moreButton.hidden = quickHistoryRows.length >= quickHistoryTotal || quickHistoryTotal === 0;
            moreButton.disabled = quickHistoryBusy;
        }
        if (quickHistoryBusy && !quickHistoryRows.length) {
            target.innerHTML = `<div class="qe-run-history-empty">
                <span class="qe-run-history-empty__icon" aria-hidden="true">◷</span>
                <strong>실행 이력을 불러오는 중입니다.</strong>
                <span>저장된 퀵 실행만 안전하게 조회합니다.</span>
                <span class="qe-run-history-loading-bar qe-run-history-loading-bar--dialog" aria-hidden="true"><i></i></span>
            </div>`;
            return;
        }
        if (quickHistoryError && !quickHistoryRows.length) {
            target.innerHTML = `<div class="qe-run-history-empty is-error">
                <span class="qe-run-history-empty__icon" aria-hidden="true">!</span>
                <strong>실행 이력을 불러오지 못했습니다.</strong>
                <span>${R.escapeHtml(quickHistoryError)}</span>
            </div>`;
            return;
        }
        if (!quickHistoryRows.length) {
            target.innerHTML = `<div class="qe-run-history-empty">
                <span class="qe-run-history-empty__icon" aria-hidden="true">◷</span>
                <strong>저장된 퀵 실행이 없습니다.</strong>
                <span>퀵 에디팅을 실행하면 이 목록에 자동으로 남습니다.</span>
            </div>`;
            return;
        }

        target.innerHTML = quickHistoryRows.map((row) => {
            const runId = Number(row.FLOW_RUN_ID || 0);
            const status = R.normalizeStatus(row.STATUS);
            const project = row.PROJECT_NAME || row.PROJECT_CODE || "프로젝트";
            const scenario = row.SCENARIO_NAME || row.SCENARIO_CODE || "시나리오";
            const table = [row.OWNER_NAME, row.TABLE_NAME].filter(Boolean).join(".") || "대상 테이블";
            const completed = Number(row.SUCCESS_NODE_COUNT || 0);
            const total = Number(row.NODE_COUNT || row.JOB_COUNT || 4);
            const detailLoading = quickHistoryDetailRunId === runId;
            const detailFailed = Number(quickHistoryDetailError.runId || 0) === runId;
            const action = detailLoading
                ? `<span class="qe-run-history-item__loading" role="status">
                       <span>상세 조회 중</span>
                       <span class="qe-run-history-loading-bar" aria-hidden="true"><i></i></span>
                   </span>`
                : detailFailed
                ? `<span class="qe-run-history-item__error" title="${R.escapeHtml(quickHistoryDetailError.message)}">불러오기 실패 · 다시 시도</span>`
                : `<span>8단계 결과 보기</span><span aria-hidden="true">→</span>`;
            return `<button type="button" class="qe-run-history-item${detailLoading ? " is-loading" : ""}" data-history-run-id="${runId}" aria-busy="${detailLoading ? "true" : "false"}"${quickHistoryBusy ? " disabled" : ""}>
                <span class="qe-run-history-item__main">
                    <small>실행 #${runId} · ${R.escapeHtml(R.formatDateTime(row.STARTED_AT || row.CREATED_AT))}</small>
                    <strong>${R.escapeHtml(project)} · ${R.escapeHtml(scenario)}</strong>
                    <span title="${R.escapeHtml(table)}">${R.escapeHtml(table)}</span>
                </span>
                <span class="qe-run-history-item__meta">
                    ${R.renderStatus(status)}
                    <span>모델 노드 ${completed}/${total || 4} 완료</span>
                    <span>${R.escapeHtml(R.formatDuration(row.STARTED_AT || row.CREATED_AT, row.FINISHED_AT, row.STATUS))}</span>
                </span>
                <span class="qe-run-history-item__action">
                    ${action}
                </span>
            </button>`;
        }).join("");
    }

    async function loadQuickHistory(options = {}) {
        if (quickHistoryBusy) return;
        const reset = options.reset !== false;
        if (reset) {
            quickHistoryPage = 1;
            quickHistoryRows = [];
            quickHistoryTotal = 0;
            quickHistoryError = "";
            quickHistoryDetailError = { runId: null, message: "" };
        }
        quickHistoryBusy = true;
        renderQuickHistoryList();
        try {
            const response = await client.getQuickEditHistory(quickHistoryPage, 20);
            const rows = Array.isArray(response.data) ? response.data : [];
            const existing = new Set(quickHistoryRows.map((row) => Number(row.FLOW_RUN_ID || 0)));
            rows.forEach((row) => {
                const runId = Number(row.FLOW_RUN_ID || 0);
                if (runId && !existing.has(runId)) {
                    existing.add(runId);
                    quickHistoryRows.push(row);
                }
            });
            quickHistoryTotal = Number(response.total || quickHistoryRows.length);
            quickHistoryError = "";
        } catch (error) {
            quickHistoryError = error.message;
            throw error;
        } finally {
            quickHistoryBusy = false;
            renderQuickHistoryList();
        }
    }

    async function openQuickHistoryDialog() {
        const dialog = byId("qeRunHistoryDialog");
        if (!dialog) return;
        if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
        try {
            await loadQuickHistory({ reset: true });
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    async function restoreQuickHistory(flowRunId) {
        const runId = Number(flowRunId || 0);
        if (!runId || quickHistoryBusy || pipelineBusy) return;
        quickHistoryDetailError = { runId: null, message: "" };
        quickHistoryDetailRunId = runId;
        quickHistoryBusy = true;
        renderQuickHistoryList();
        try {
            const response = await client.getQuickEditHistoryDetail(runId);
            const detail = response.data || {};
            const restored = detail.restoreState || {};
            pollGeneration += 1;
            selectedFile = null;
            currentSnapshot = {
                run: detail.run || {},
                nodes: Array.isArray(detail.nodes) ? detail.nodes : []
            };
            resultData = {
                categorical: null,
                continuous: null,
                categoricalViolation: null,
                continuousViolation: null,
                descriptiveStatistics: null,
                columnTypeFinal: null
            };
            columnTypeDirtyChanges.clear();
            cancelContinuousDetailRequest();
            destroyFormulaChart();
            continuousDetail = {
                ruleId: "", ruleIndex: -1, rule: null, rows: [], evaluatedRows: [],
                metrics: null, sampleCount: 0, hasMore: false, error: "",
                selectedRowIndex: null, chartPoints: []
            };
            state = {
                ...initialState(),
                ...restored,
                processType: normalizeProcessType(restored.processType),
                version: STATE_VERSION,
                targetContextId: client.targetConnectionId,
                historyView: true,
                historyViewedAt: new Date().toISOString(),
                historySteps: Array.isArray(detail.steps) ? detail.steps : [],
                completedSteps: Array.isArray(restored.completedSteps) ? restored.completedSteps : [],
                jobIds: Array.isArray(restored.jobIds) ? restored.jobIds : []
            };
            if (state.lastRunStatus === "PAUSED") state.status = "paused";
            if (state.lastRunStatus === "CANCELLED") state.status = "stopped";
            lastRenderedStep = -1;
            persistState();
            renderResultsEmpty();
            renderHistory();
            renderState(`실행 #${runId}의 저장된 8단계 결과를 복원했습니다.`);
            byId("qeRunHistoryDialog")?.close();
            window.scrollTo({ top: 0, behavior: "smooth" });

            if (R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus))) { await monitorActiveRun(); return; }
            if (!R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus))) {
                pipelineBusy = true;
                updateActionState();
                try {
                    await loadResults({
                        showPanelLoading: true,
                        loadingMessage: isMixedXai() ? `실행 #${runId}의 기초통계·관계·규칙 결과를 불러오고 있습니다.` : `실행 #${runId}의 컬럼 유형·기초통계·규칙 결과를 불러오고 있습니다.`
                    });
                    if (R.normalizeStatus(state.lastRunStatus) === "SUCCESS") {
                        state.status = state.resultWarning ? "warning" : "success";
                        state.error = "";
                    }
                    persistState();
                    renderState(
                        R.normalizeStatus(state.lastRunStatus) === "SUCCESS"
                            ? (state.resultWarning || `실행 #${runId}의 저장된 분석 결과를 불러왔습니다.`)
                            : isMixedXai() ? `실행 #${runId}의 저장된 혼합형 분석 결과를 불러왔습니다. 완료되지 않은 단계부터 재실행할 수 있습니다.` : `실행 #${runId}의 컬럼 유형 결과를 불러왔습니다. M03001 성공 시 편집·재실행할 수 있습니다.`
                    );
                } catch (error) {
                    if (R.normalizeStatus(state.lastRunStatus) === "SUCCESS") state.status = "warning";
                    state.resultWarning = error.message;
                    persistState();
                    renderState("실행 단계는 복원했지만 일부 분석 결과를 불러오지 못했습니다.");
                    showToast(error.message, "warning");
                } finally {
                    pipelineBusy = false;
                    updateActionState();
                    renderColumnTypeFinal();
                }
            }
        } catch (error) {
            quickHistoryDetailError = { runId, message: error.message || "상세 결과를 불러오지 못했습니다." };
            showToast(error.message, "error");
        } finally {
            quickHistoryDetailRunId = null;
            quickHistoryBusy = false;
            renderQuickHistoryList();
        }
    }

    function showToast(message, type = "info") {
        const region = byId("toast", "qeToastRegion");
        if (!region || !message) return;
        window.clearTimeout(toastTimer);
        region.dataset.state = type;
        setText(region.querySelector("[data-toast-message]"), message);
        region.hidden = false;
        toastTimer = window.setTimeout(() => {
            region.hidden = true;
        }, type === "error" ? 9000 : 5000);
    }

    function resetWorkspaceForm() {
        const newMode = byId("projectModeNew");
        const existingMode = byId("projectModeExisting");
        if (newMode) newMode.checked = true;
        if (existingMode) existingMode.checked = false;
        state.workspaceMode = "new";
        ["projectName", "qeProjectName", "projectCode", "qeProjectCode", "scenarioName", "qeScenarioName", "scenarioCode", "qeScenarioCode"].forEach((id) => {
            const input = byId(id);
            if (input) input.value = "";
        });
        const projectSelect = byId("existingProject", "qeProjectSelect");
        if (projectSelect) projectSelect.value = "";
        const scenarioSelect = byId("existingScenario", "qeScenarioSelect");
        if (scenarioSelect) {
            scenarioSelect.innerHTML = '<option value="">프로젝트를 먼저 선택하세요</option>';
            scenarioSelect.disabled = true;
        }
        renderWorkspaceMode();
    }

    function resetPipelineState(options = {}) {
        pollGeneration += 1;
        const wasRunning = pipelineBusy || state.status === "running";
        state = initialState();
        pipelineBusy = false;
        activePipelineAction = "";
        state.targetContextId = client.targetConnectionId;
        selectedFile = null;
        currentSnapshot = null;
        resultData = {
            categorical: null,
            continuous: null,
            categoricalViolation: null,
            continuousViolation: null,
            descriptiveStatistics: null,
            columnTypeFinal: null
        };
        columnTypeDirtyChanges.clear();
        resetRuleDistributionFilters();
        cancelContinuousDetailRequest();
        destroyFormulaChart();
        continuousDetail = {
            ruleId: "", ruleIndex: -1, rule: null, rows: [], evaluatedRows: [],
            metrics: null, sampleCount: 0, hasMore: false, error: "",
            selectedRowIndex: null, chartPoints: []
        };
        lastRenderedStep = -1;
        sessionStorage.removeItem(STORAGE_KEY);
        const fileInput = byId("sourceFile", "qeFileInput");
        if (fileInput) fileInput.value = "";
        if (!options.keepForm) resetWorkspaceForm();
        persistState();
        renderHistory();
        renderResultsEmpty();
        renderState();
        if (options.announce !== false) {
            showToast(wasRunning ? "화면 상태를 초기화했습니다. 이미 제출된 서버 실행은 계속됩니다." : "새 작업을 시작할 수 있습니다.", "success");
        }
    }

    function renderResultsEmpty() {
        cancelContinuousDetailRequest();
        destroyFormulaChart();
        ["qeMixedXaiKpis", "qeMixedXaiRules", "qeMixedXaiRows", "qeMixedEarlyStages"].forEach((id) => {
            const target = byId(id);
            if (target) target.innerHTML = "";
        });
        setResultsLoading(false);
        setHidden(byId("resultsSection", "qeResultsPanel"), true);
        setHidden(byId("qeCategoricalDetail"), true);
        setHidden(byId("qeContinuousDetail"), true);
        setHidden(byId("qeStatisticsSummary"), true);
        setHidden(byId("qeColumnTypeSummary"), true);
        byId("qeStatisticsDialog")?.close();
        ["categoryKpis", "qeCategoricalKpis", "categoryRules", "qeCategoricalRules", "continuousKpis", "qeContinuousKpis", "continuousRules", "qeContinuousRules"].forEach((id) => {
            const target = byId(id);
            if (target) target.innerHTML = "";
        });
        [
            ["categoryCharts", "qeCategoricalCharts", false],
            ["continuousCharts", "qeContinuousCharts", true]
        ].forEach(([primaryId, fallbackId, mint]) => {
            const region = byId(primaryId, fallbackId);
            const chartBody = region?.querySelector("[data-chart-body]");
            if (chartBody) {
                chartBody.innerHTML = `<div class="qe-chart-placeholder${mint ? " qe-chart-placeholder--mint" : ""}" data-chart-empty>
                    <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
                </div>`;
            }
            setText(region?.querySelector("[data-chart-caption]"), "상위 항목");
        });
        document.querySelectorAll("[data-rule-count]").forEach((target) => setText(target, "-"));
    }

    async function handleRetry() {
        if (state.historyView) {
            resetPipelineState();
            return;
        }
        const failedRun = state.currentStep === 6 && ["FAILED", "ERROR", "CANCELLED"].includes(R.normalizeStatus(state.lastRunStatus));
        if (state.currentStep === 7 || state.status === "warning") {
            pipelineBusy = true;
            activePipelineAction = PIPELINE_ACTION.RETRY;
            state.status = "running";
            updateActionState();
            try {
                await loadResults();
                controlCheckpoint();
                if (!state.completedSteps.includes(7)) state.completedSteps.push(7);
                state.status = state.resultWarning ? "warning" : "success";
                state.error = "";
                persistState();
                renderState(state.resultWarning || "결과 분석을 다시 불러왔습니다.");
            } catch (error) {
                state.status = "failed";
                state.error = error.message;
                persistState();
                renderState();
            } finally {
                pipelineBusy = false;
                activePipelineAction = "";
                updateActionState();
                renderColumnTypeFinal();
            }
            return;
        }
        await runPipeline({ forceNewRun: failedRun, pipelineAction: PIPELINE_ACTION.RETRY });
    }

    function validateHistoryRerun() {
        if (!state.projectId || !state.scenarioId || !state.flowId || !state.flowRunId) {
            throw new Error("재실행할 과거 프로젝트·시나리오·FLOW 정보를 확인할 수 없습니다.");
        }
        const runStatus = R.normalizeStatus(state.lastRunStatus || currentSnapshot?.run?.STATUS || "");
        if (R.ACTIVE_STATUSES.has(runStatus)) {
            throw new Error("현재 실행이 종료된 후 다시 시도해 주세요.");
        }
        return {
            projectId: Number(state.projectId),
            scenarioId: Number(state.scenarioId),
            flowId: Number(state.flowId),
            flowRunId: Number(state.flowRunId)
        };
    }

    async function rerunEntireHistoryFlow() {
        if (pipelineBusy) return;
        let savedWorkspace;
        try {
            savedWorkspace = validateHistoryRerun();
        } catch (error) {
            showToast(error.message, "error");
            return;
        }
        state.completedSteps = [0, 1, 2, 3, 4, 5];
        state.currentStep = 6;
        state.stepProgress = 0;
        state.status = "idle";
        persistState();
        renderState("기존 프로젝트·시나리오에서 저장된 FLOW 전체를 다시 실행합니다.");
        await runPipeline({
            forceNewRun: true,
            pipelineAction: PIPELINE_ACTION.HISTORY_FULL_RERUN
        });
        if (
            Number(state.projectId) !== savedWorkspace.projectId
            || Number(state.scenarioId) !== savedWorkspace.scenarioId
            || Number(state.flowId) !== savedWorkspace.flowId
        ) {
            state.status = "failed";
            state.error = "기존 프로젝트·시나리오·FLOW ID가 유지되지 않아 재실행 결과를 확인해야 합니다.";
            persistState();
            renderState();
        }
    }

    async function rerunHistoryFromFailedStage() {
        if (pipelineBusy) return;
        let savedWorkspace;
        try {
            savedWorkspace = validateHistoryRerun();
        } catch (error) {
            showToast(error.message, "error");
            return;
        }

        pipelineBusy = true;
        activePipelineAction = PIPELINE_ACTION.HISTORY_FAILED_RERUN;
        state.status = "running";
        state.error = "";
        state.resultWarning = "";
        state.completedSteps = [0, 1, 2, 3, 4, 5];
        state.currentStep = 6;
        state.stepProgress = 0.05;
        if (!state.failedStageRerunRequestToken) {
            state.failedStageRerunRequestToken = makeRunRequestToken();
        }
        const generation = ++pollGeneration;
        persistState();
        renderState("기존 실행 ID에서 최초 실패 단계와 후속 단계를 다시 실행합니다.");

        try {
            const response = await client.rerunSavedFlowFromFailure(
                savedWorkspace.flowId,
                savedWorkspace.projectId,
                savedWorkspace.scenarioId,
                savedWorkspace.flowRunId,
                state.failedStageRerunRequestToken,
                buildQuickEditSummary()
            );
            const continuedRunId = Number(response.data?.flowRunId || 0);
            if (continuedRunId !== savedWorkspace.flowRunId) {
                throw new Error("기존 FLOW 실행 ID를 재사용하지 못해 실패 단계 재실행을 중단했습니다.");
            }
            if (
                Number(state.projectId) !== savedWorkspace.projectId
                || Number(state.scenarioId) !== savedWorkspace.scenarioId
            ) {
                throw new Error("기존 프로젝트·시나리오 ID를 재사용하지 못했습니다.");
            }
            state.lastRunStatus = response.data?.runStatus || "STARTED";
            state.lastRunMessage = response.message || "실패 단계부터 재실행을 시작했습니다.";
            currentSnapshot = null;
            persistState();
            renderHistory();

            await pollRunUntilTerminal(generation);
            completeStep(6, "실패 단계부터 규칙 발굴 재실행이 완료되었습니다.");
            setStep(7, "재실행 결과를 다시 불러오고 있습니다.", 0.5);
            await loadResults();
            controlCheckpoint();
            completeStep(7, "재실행 결과 분석이 완료되었습니다.");
            state.status = state.resultWarning ? "warning" : "success";
            state.currentStep = 7;
            state.stepProgress = 1;
            state.failedStageRerunRequestToken = "";
            persistState();
            renderState(state.resultWarning || "실패 단계부터 재실행이 완료되었습니다.");
            showToast(state.resultWarning || "실패 단계부터 재실행이 완료되었습니다.", state.resultWarning ? "warning" : "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            state.status = "failed";
            state.error = error?.message || "실패 단계부터 재실행 중 오류가 발생했습니다.";
            state.failedStageRerunRequestToken = "";
            state.currentStep = 6;
            persistState();
            renderState();
            showToast(state.error, "error");
        } finally {
            pipelineBusy = false;
            activePipelineAction = "";
            updateActionState();
            renderColumnTypeFinal();
        }
    }

    function bindEvents() {
        byId("qePauseButton")?.addEventListener("click", () => requestPipelineControl("PAUSE"));
        byId("qeStopButton")?.addEventListener("click", () => requestPipelineControl("STOP"));
        byId("qeResumeButton")?.addEventListener("click", resumePipeline);
        byId("qeProcessType")?.addEventListener("change", (event) => {
            if (!event.target.matches('input[name="processType"]')) return;
            if (pipelineBusy || state.historyView || state.scenarioTableId || state.flowId) {
                renderProcessSelection();
                return;
            }
            state.processType = normalizeProcessType(event.target.value);
            persistState();
            renderState();
        });
        const fileInput = byId("sourceFile", "qeFileInput");
        fileInput?.addEventListener("change", () => selectFile(fileInput.files?.[0]));
        const dropZone = byId("fileDropZone", "qeDropZone");
        dropZone?.addEventListener("click", (event) => {
            if (event.target === dropZone) fileInput?.click();
        });
        dropZone?.addEventListener("keydown", (event) => {
            if (["Enter", " "].includes(event.key)) {
                event.preventDefault();
                fileInput?.click();
            }
        });
        ["dragenter", "dragover"].forEach((name) => dropZone?.addEventListener(name, (event) => {
            event.preventDefault();
            if (!pipelineBusy) dropZone.classList.add("is-dragging");
        }));
        ["dragleave", "drop"].forEach((name) => dropZone?.addEventListener(name, (event) => {
            event.preventDefault();
            dropZone.classList.remove("is-dragging");
        }));
        dropZone?.addEventListener("drop", (event) => selectFile(event.dataTransfer?.files?.[0]));

        document.querySelectorAll('input[name="workspaceMode"], input[name="projectMode"]').forEach((radio) => radio.addEventListener("change", renderWorkspaceMode));
        byId("existingProject", "qeProjectSelect")?.addEventListener("change", async (event) => {
            try {
                await loadScenarios(event.target.value);
            } catch (error) {
                showToast(error.message, "error");
            }
            updateActionState();
        });
        byId("existingScenario", "qeScenarioSelect")?.addEventListener("change", updateActionState);
        byId("qeQuickForm")?.addEventListener("submit", (event) => {
            event.preventDefault();
            if (state.historyView || state.status === "success") {
                resetPipelineState();
                return;
            }
            runPipeline();
        });
        byId("retryButton", "qeRetryButton")?.addEventListener("click", handleRetry);
        byId("qeHistoryFullRerunButton")?.addEventListener("click", rerunEntireHistoryFlow);
        byId("qeHistoryFailedRerunButton")?.addEventListener("click", rerunHistoryFromFailedStage);
        byId("qeRunHistoryButton")?.addEventListener("click", openQuickHistoryDialog);
        byId("qeOpenDetailedAnalysis")?.addEventListener("click", openDetailedAnalysis);
        byId("qeHistoryExitButton")?.addEventListener("click", () => resetPipelineState());
        byId("qeRunHistoryRefresh")?.addEventListener("click", async () => {
            try {
                await loadQuickHistory({ reset: true });
            } catch (error) {
                showToast(error.message, "error");
            }
        });
        byId("qeRunHistoryMore")?.addEventListener("click", async () => {
            quickHistoryPage += 1;
            try {
                await loadQuickHistory({ reset: false });
            } catch (error) {
                quickHistoryPage = Math.max(1, quickHistoryPage - 1);
                showToast(error.message, "error");
            }
        });
        byId("qeRunHistoryList")?.addEventListener("click", (event) => {
            const button = event.target.closest("[data-history-run-id]");
            if (button) restoreQuickHistory(button.dataset.historyRunId);
        });
        byId("qeRunHistoryDialog")?.addEventListener("click", (event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
        });
        byId("resetButton", "qeResetButton")?.addEventListener("click", () => {
            const hasRecoveryState = Boolean(selectedFile || state.fileMeta || state.projectId || state.tableName || state.flowRunId);
            const resetDialog = byId("qeResetDialog");
            if (hasRecoveryState && typeof resetDialog?.showModal === "function") {
                resetDialog.returnValue = "";
                resetDialog.showModal();
                return;
            }
            if (!hasRecoveryState || window.confirm("화면의 진행 정보를 초기화할까요? 생성된 서버 데이터는 그대로 남습니다.")) {
                resetPipelineState();
            }
        });
        byId("qeResetDialog")?.addEventListener("close", (event) => {
            if (event.currentTarget.returnValue === "confirm") resetPipelineState();
        });
        byId("closeButton", "qeCloseButton")?.addEventListener("click", () => {
            if (window.opener) window.close();
            else window.location.assign("/");
        });
        byId("historyRefreshButton", "qeHistoryRefreshButton")?.addEventListener("click", async () => {
            try {
                await fetchSnapshot({ silent: false });
            } catch (error) {
                showToast(error.message, "error");
            }
        });
        document.querySelectorAll("[data-result-tab]").forEach((button) => {
            button.addEventListener("click", () => selectResultTab(button.dataset.resultTab));
            button.addEventListener("keydown", handleResultTabKeydown);
        });
        byId("resultsSection", "qeResultsPanel")?.addEventListener("click", (event) => {
            const filterButton = event.target.closest("[data-rule-filter-kind][data-rule-filter-type]");
            if (filterButton) {
                setRuleDistributionFilter(
                    String(filterButton.dataset.ruleFilterKind || "").toLowerCase(),
                    filterButton.dataset.ruleFilterType,
                    filterButton.dataset.ruleFilterValue,
                    filterButton.dataset.ruleFilterLabel
                );
                return;
            }
            const statisticsCard = event.target.closest("[data-statistics-column]");
            if (statisticsCard) {
                openStatisticsDialog(statisticsCard.dataset.statisticsColumn);
                return;
            }
            const violationButton = event.target.closest("[data-load-violations]");
            if (violationButton) {
                loadRuleViolations(
                    violationButton.dataset.ruleKind,
                    Number(violationButton.dataset.ruleIndex),
                    1
                );
                return;
            }
            const pageButton = event.target.closest("[data-violation-page]");
            if (pageButton && !pageButton.disabled) {
                loadRuleViolations(
                    pageButton.dataset.ruleKind,
                    Number(pageButton.dataset.ruleIndex),
                    Number(pageButton.dataset.violationPage)
                );
                return;
            }
            const card = event.target.closest(".qe-rule-card[data-rule-kind][data-rule-index]");
            if (card) openInlineRuleDetail(card.dataset.ruleKind, Number(card.dataset.ruleIndex));
        });
        byId("qeStatisticsDetailButton")?.addEventListener("click", () => openStatisticsDialog());
        byId("qeColumnTypeTable")?.addEventListener("change", handleColumnTypeChange);
        byId("qeColumnTypeTable")?.addEventListener("change", handleColumnTypeConfirmation);
        byId("qeColumnTypeFilter")?.addEventListener("change", (event) => {
            state.columnTypeFilter = String(event.target.value || "ALL");
            persistState();
            renderColumnTypeFinal({ keepEditorOpen: true });
        });
        byId("qeColumnTypeEditorToggle")?.addEventListener("click", (event) => {
            const panel = byId("qeColumnTypeEditorPanel");
            if (!panel) return;
            const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
            panel.hidden = expanded;
            event.currentTarget.setAttribute("aria-expanded", expanded ? "false" : "true");
            byId("qeColumnTypeEditor")?.classList.toggle("is-expanded", !expanded);
        });
        byId("qeColumnTypeRerunButton")?.addEventListener("click", rerunWithChangedColumnTypes);
        byId("qeColumnTypeTrainingButton")?.addEventListener("click", openColumnTypeModelTraining);
        byId("qeColumnTypeSaveButton")?.addEventListener("click", saveColumnTypeChanges);
        byId("qeStatisticsColumnSelect")?.addEventListener("change", (event) => {
            const payload = getStatisticsPayload();
            const column = (payload?.columns || [])[Number(event.target.value || 0)];
            renderStatisticsDetail(column?.columnName);
        });
        byId("qeStatisticsDialogClose")?.addEventListener("click", () => byId("qeStatisticsDialog")?.close());
        byId("qeStatisticsDialog")?.addEventListener("click", (event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
        });
        byId("qeContinuousRuleSelect")?.addEventListener("change", (event) => {
            loadContinuousDetail(Number(event.target.value)).catch((error) => showToast(error.message, "error"));
        });
        byId("qeContinuousChartMode")?.addEventListener("change", drawContinuousDetailChart);
        const continuousCanvas = byId("qeContinuousDetailChart");
        continuousCanvas?.addEventListener("click", handleContinuousChartClick);
        continuousCanvas?.addEventListener("keydown", handleContinuousChartKeydown);
        continuousCanvas?.addEventListener("pointermove", (event) => {
            const point = findContinuousChartPoint(event, 14);
            continuousCanvas.style.cursor = point ? "pointer" : "default";
            continuousCanvas.title = point
                ? `표본 ${point.rowIndex + 1} · 클릭하면 상세 행으로 이동`
                : "관심 점을 클릭하면 하단 상세 행으로 이동합니다.";
        });
        continuousCanvas?.addEventListener("pointerleave", () => {
            continuousCanvas.style.cursor = "default";
        });
        byId("qeContinuousSampleTable")?.addEventListener("click", (event) => {
            const row = event.target.closest("tr[data-continuous-row-index]");
            if (row) selectContinuousSampleRow(Number(row.dataset.continuousRowIndex), { scroll: false });
        });
        byId("qeContinuousSampleTable")?.addEventListener("keydown", handleContinuousChartKeydown);
        byId("qeContinuousDetailReload")?.addEventListener("click", () => {
            const index = Number(valueOf("qeContinuousRuleSelect") || continuousDetail.ruleIndex || 0);
            loadContinuousDetail(index, true).catch((error) => showToast(error.message, "error"));
        });
        byId("toast", "qeToastRegion")?.querySelector("[data-toast-close]")?.addEventListener("click", () => {
            const toast = byId("toast", "qeToastRegion");
            if (toast) toast.hidden = true;
        });
        bindContinuousChartResize();
        window.addEventListener("pagehide", destroyContinuousChartResize);
        window.addEventListener("pageshow", () => { bindContinuousChartResize(); scheduleContinuousChartDraw(); });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && !state.historyView && state.flowRunId && R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus))) {
                fetchSnapshot({ silent: true }).catch(() => {});
            }
        });
    }

    let targetContextChannel = null;

    function bindTargetContextChannel() {
        if (targetContextChannel || typeof BroadcastChannel !== "function") return;
        targetContextChannel = new BroadcastChannel(TARGET_CONTEXT_CHANNEL_NAME);
        targetContextChannel.addEventListener("message", (event) => {
            const message = event?.data || {};
            if (message.type !== "TARGET_DB_CHANGED") return;
            const changedConnectionId = Number(message.targetConnectionId || 0);
            if (!changedConnectionId || changedConnectionId === Number(client.targetConnectionId || 0)) return;
            sessionStorage.removeItem(STORAGE_KEY);
            window.location.reload();
        });
        window.addEventListener("beforeunload", () => {
            cancelContinuousDetailRequest();
            destroyFormulaChart();
            targetContextChannel?.close();
            targetContextChannel = null;
        }, { once: true });
    }

    async function init() {
        bindTargetContextChannel();
        bindEvents();
        applyRestoredFormState();
        renderWorkspaceMode();
        renderFile();
        renderState();
        selectResultTab("category");
        try {
            const session = await client.bootstrapSession();
            if (state.targetContextId && Number(state.targetContextId) !== Number(client.targetConnectionId)) {
                state = initialState();
                selectedFile = null;
                currentSnapshot = null;
                resultData = {
                    categorical: null,
                    continuous: null,
                    categoricalViolation: null,
                    continuousViolation: null,
                    descriptiveStatistics: null,
                    columnTypeFinal: null
                };
                columnTypeDirtyChanges.clear();
                cancelContinuousDetailRequest();
                destroyFormulaChart();
                continuousDetail = {
                    ruleId: "", ruleIndex: -1, rule: null, rows: [], evaluatedRows: [],
                    metrics: null, sampleCount: 0, hasMore: false, error: "",
                    selectedRowIndex: null, chartPoints: []
                };
                sessionStorage.removeItem(STORAGE_KEY);
                resetWorkspaceForm();
            }
            state.targetContextId = client.targetConnectionId;
            persistState();
            const user = session.user || {};
            const sessionTarget = byId("sessionStatus", "qeSessionStatus");
            if (sessionTarget) {
                const sessionLabel = `${user.userName || user.loginId || "사용자"} · 대상 DB #${client.targetConnectionId}`;
                sessionTarget.dataset.state = "connected";
                sessionTarget.setAttribute("aria-label", sessionLabel);
                setText(sessionTarget.querySelector("[data-session-label]") || sessionTarget, sessionLabel);
            }
            await loadProjects();
            renderState();

            if (state.historyView && state.flowRunId) {
                try {
                    await fetchSnapshot({ silent: true });
                    if (R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus))) { await monitorActiveRun(); return; }
                    if (!R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus))) {
                        await loadResults();
                        controlCheckpoint();
                        if (R.normalizeStatus(state.lastRunStatus) === "SUCCESS") {
                            state.status = state.resultWarning ? "warning" : "success";
                        }
                    }
                    persistState();
                    renderState(state.resultWarning || `실행 #${state.flowRunId}의 저장된 결과를 다시 불러왔습니다.`);
                } catch (error) {
                    if (R.normalizeStatus(state.lastRunStatus) === "SUCCESS") state.status = "warning";
                    state.resultWarning = error.message;
                    persistState();
                    renderState("과거 실행의 일부 결과를 불러오지 못했습니다.");
                }
            } else if (state.flowRunId && ["running", "failed", "paused", "stopped"].includes(state.status)) {
                await monitorActiveRun();
            } else if (state.flowRunId && ["success", "warning"].includes(state.status)) {
                try {
                    await fetchSnapshot({ silent: true });
                    await loadResults();
                    controlCheckpoint();
                    state.status = state.resultWarning ? "warning" : "success";
                    state.error = "";
                    persistState();
                    renderState(state.resultWarning || "완료된 실행 결과를 다시 불러왔습니다.");
                } catch (error) {
                    state.status = "warning";
                    state.resultWarning = error.message;
                    persistState();
                    renderState();
                }
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            state.status = "failed";
            state.error = error.message;
            const sessionTarget = byId("sessionStatus", "qeSessionStatus");
            if (sessionTarget) {
                const errorLabel = `연결 필요 · ${error.message}`;
                sessionTarget.dataset.state = "error";
                sessionTarget.setAttribute("aria-label", errorLabel);
                setText(sessionTarget.querySelector("[data-session-label]") || sessionTarget, errorLabel);
            }
            renderState();
        }
    }

    window.addEventListener("DOMContentLoaded", init, { once: true });
})();
