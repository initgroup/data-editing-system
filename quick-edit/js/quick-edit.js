(function () {
    "use strict";

    const STORAGE_KEY = "init.quick-edit.pipeline.v1";
    const STATE_VERSION = 1;
    const STEP_COUNT = 8;
    const STEPS = [
        { key: "upload", title: "파일 업로드", description: "파일을 안전하게 임시 업로드합니다." },
        { key: "project", title: "프로젝트", description: "작업 프로젝트를 준비합니다." },
        { key: "scenario", title: "시나리오", description: "규칙 발굴 시나리오를 준비합니다." },
        { key: "table", title: "대상 테이블", description: "INITUP$ 테이블을 만들고 시나리오에 등록합니다." },
        { key: "models", title: "모델 4단계", description: "기본 4단계 모델과 실행 파라미터를 저장합니다." },
        { key: "flow", title: "FLOW 자동 저장", description: "화면에 설계도를 표시하지 않고 내부 FLOW를 저장합니다." },
        { key: "run", title: "자동 실행", description: "저장된 FLOW를 실행하고 상세 이력을 조회합니다." },
        { key: "results", title: "결과 분석", description: "발견된 범주형·연속형 규칙을 요약합니다." }
    ];
    const ALLOWED_EXTENSIONS = new Set(["csv", "tsv", "txt", "xlsx", "xlsm"]);

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
        descriptiveStatistics: null
    };
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
    let chartResizeTimer = null;
    let pipelineBusy = false;
    let snapshotBusy = false;
    let pollGeneration = 0;
    let toastTimer = null;
    let lastRenderedStep = -1;
    let quickHistoryRows = [];
    let quickHistoryPage = 1;
    let quickHistoryTotal = 0;
    let quickHistoryBusy = false;
    let quickHistoryDetailRunId = null;
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
            rowCount: null,
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
        const hasHeader = hasHeaderElement?.type === "checkbox"
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

    function renderArtifacts() {
        const target = byId("artifactList", "qeArtifactList");
        if (!target) return;
        const artifacts = {
            project: state.projectId ? `${state.projectName || state.projectCode} · #${state.projectId}` : "대기",
            scenario: state.scenarioId ? `${state.scenarioName || state.scenarioCode} · #${state.scenarioId}` : "대기",
            table: state.tableName ? `${state.tableOwner}.${state.tableName}` : "대기",
            models: state.jobIds.length === 4 ? "기본 4단계 완료" : (state.jobIds.length ? `${state.jobIds.length}/4단계 확인 필요` : "4단계 대기"),
            flow: state.flowId ? `${state.flowName || "자동 설계"} · #${state.flowId}` : "대기",
            run: state.flowRunId ? `#${state.flowRunId}` : "대기"
        };
        const completeKeys = new Set([
            state.projectId && "project",
            state.scenarioId && "scenario",
            state.tableName && "table",
            state.jobIds.length === 4 && "models",
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
            `실행 #${state.flowRunId} · ${state.projectName || state.projectCode || "프로젝트"} · 저장된 결과만 조회합니다.`
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
        renderStepper();
        renderFile();
        renderUploadProgress();
        renderArtifacts();
        renderHistoryView();
        renderWorkspaceSummary();
        const step = STEPS[state.currentStep] || STEPS[0];
        setText(byId("currentStage", "qeCurrentStepTitle"), step.title);
        const description = state.error || message || state.lastRunMessage || step.description;
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
                            : (state.status === "running" ? "자동 진행 중" : "대기"))));
        }

        const historySection = byId("historySection", "qeHistorySection");
        setHidden(historySection, !state.flowRunId);
        const resultsSection = byId("resultsSection", "qeResultsPanel");
        setHidden(resultsSection, !state.flowRunId || (!state.completedSteps.includes(7) && state.currentStep < 7));
        updateActionState();
    }

    function updateActionState() {
        const startButton = byId("runButton", "qeStartButton");
        const retryButton = byId("retryButton", "qeRetryButton");
        const resetButton = byId("resetButton", "qeResetButton");
        const historyButton = byId("qeRunHistoryButton");
        const form = byId("qeQuickForm");
        const workspaceFieldset = byId("workspaceFieldset") || form?.querySelector("[data-workspace-fieldset]");
        const readOnlyHistory = Boolean(state.historyView);
        const projectLocked = Boolean(state.projectId);
        const scenarioLocked = Boolean(state.scenarioId);
        const hasInput = Boolean(selectedFile || state.uploadId || state.tableName);
        if (startButton) {
            startButton.disabled = readOnlyHistory ? false : (pipelineBusy || !hasInput || !client.targetConnectionId);
            startButton.hidden = readOnlyHistory ? false : ["failed", "warning"].includes(state.status);
            setText(startButton.querySelector("span:first-child") || startButton, readOnlyHistory || state.status === "success" ? "새 작업 시작" : "전체 자동 실행");
            startButton.classList.toggle("is-running", pipelineBusy);
        }
        if (retryButton) {
            retryButton.hidden = readOnlyHistory || !["failed", "warning"].includes(state.status);
            retryButton.disabled = pipelineBusy || !client.targetConnectionId;
        }
        if (resetButton) resetButton.disabled = pipelineBusy;
        if (historyButton) historyButton.disabled = pipelineBusy;
        if (form) form.setAttribute("aria-busy", pipelineBusy ? "true" : "false");
        document.querySelectorAll("#qeQuickForm input, #qeQuickForm select, #qeQuickForm button").forEach((element) => {
            if ([startButton, retryButton, resetButton, byId("closeButton", "qeCloseButton")].includes(element)) return;
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
        ["hasHeader", "qeHasHeader", "fileEncoding", "qeEncoding", "fileDelimiter", "qeDelimiter"].forEach((id) => {
            const control = byId(id);
            if (control) control.disabled = pipelineBusy || readOnlyHistory || fileOptionsLocked;
        });
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

            await ensureProject();
            completeStep(1, "프로젝트가 준비되었습니다.");

            await ensureScenario();
            completeStep(2, "시나리오가 준비되었습니다.");

            await ensureTargetAndDesign();
            completeStep(3, "대상 테이블 등록이 완료되었습니다.");
            completeStep(4, "기본 4단계 모델 저장이 완료되었습니다.");
            completeStep(5, "샘플 노드 기반 FLOW가 내부에 자동 저장되었습니다.");

            await ensureFlowRun(generation, options);
            completeStep(6, "FLOW 실행이 완료되었습니다.");

            setStep(7, "실행 결과에서 규칙을 정리하고 있습니다.", 0.25);
            await loadResults();
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
            updateActionState();
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
        setStep(3, state.tableName ? "대상 테이블 등록 상태를 확인하고 있습니다." : "파일을 INITUP$ 대상 테이블로 적재하고 있습니다.", 0.15);
        const fileOptions = getFileOptions();
        if (!state.tableName) {
            if (!state.uploadId) throw new Error("완료된 파일 업로드 정보를 찾을 수 없습니다. 파일을 다시 선택해 주세요.");
            const upload = await client.finalizeStagedUpload(state.uploadId, fileOptions, {
                projectId: state.projectId,
                projectCode: state.projectCode
            });
            state.tableName = String(upload.tableName || "").toUpperCase();
            state.rowCount = Number(upload.rowCount || 0);
            state.uploadId = null;
            if (!state.tableName.startsWith("INITUP$")) {
                throw new Error("업로드된 INITUP$ 테이블 정보를 확인할 수 없습니다.");
            }
            persistState();
        }

        if (!state.tableOwner) {
            setStep(3, "생성된 대상 테이블의 소유자를 확인하고 있습니다.", 0.45);
            const tree = await client.getUploadTable(state.projectId, state.projectCode, state.tableName);
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
            && state.jobIds.length === 4
        );
        if (!designComplete) {
            setStep(3, "대상 테이블 등록과 기본 4단계·FLOW 자동 설계를 저장하고 있습니다.", 0.7);
            const registration = await client.saveScenarioTable({
                scenarioTableId: state.scenarioTableId,
                projectId: state.projectId,
                scenarioId: state.scenarioId,
                ownerName: state.tableOwner,
                tableName: state.tableName,
                tableComment: fileOptions.tableComment
            });
            const saved = registration.data || {};
            state.scenarioTableId = Number(saved.SCENARIO_TABLE_ID || state.scenarioTableId || 0);
            persistState();
            const automation = registration.automation || {};
            if (automation.status !== "success") {
                throw new Error(automation.message || "대상 테이블은 등록되었지만 기본 4단계 자동 설계에 실패했습니다.");
            }
            state.jobIds = Array.isArray(automation.jobIds)
                ? [...new Set(automation.jobIds.map(Number).filter((jobId) => Number.isInteger(jobId) && jobId > 0))]
                : [];
            state.flowId = Number(automation.flowId || 0);
            state.flowName = automation.flowName || "자동 규칙 발굴 FLOW";
            if (!state.scenarioTableId || state.jobIds.length !== 4 || !state.flowId) {
                throw new Error("기본 4단계 모델 또는 FLOW 저장 결과가 완전하지 않습니다.");
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
                {
                    source: "QUICK_EDIT",
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
                    estimatedRowCount: Number(state.rowCount || 0),
                    flowName: state.flowName,
                    jobCount: state.jobIds.length
                }
            );
            state.flowRunId = Number(response.data?.flowRunId || 0);
            state.lastRunStatus = response.data?.runStatus || "STARTED";
            if (!state.flowRunId) throw new Error("FLOW 실행 ID를 확인할 수 없습니다.");
            persistState();
            renderState("FLOW 실행이 시작되었습니다. 상세 이력을 자동 조회합니다.");
        }
        await pollRunUntilTerminal(generation);
    }

    async function fetchSnapshot(options = {}) {
        if (!state.flowRunId || snapshotBusy) return currentSnapshot;
        snapshotBusy = true;
        try {
            const response = await client.getRunSnapshot(state.flowRunId, state.projectId, state.scenarioId);
            currentSnapshot = response.data || { run: {}, nodes: [] };
            const run = currentSnapshot.run || {};
            state.lastRunStatus = R.normalizeStatus(run.STATUS || state.lastRunStatus);
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
                renderState(`실행 #${state.flowRunId} · ${R.statusLabel(runStatus)} · ${successCount}/${nodes.length || 4} 단계 완료`);
                if (runStatus === "SUCCESS") return snapshot;
                if (["FAILED", "ERROR", "CANCELLED"].includes(runStatus)) {
                    throw new Error(snapshot?.run?.MESSAGE || `FLOW 실행이 ${R.statusLabel(runStatus)} 상태로 종료되었습니다.`);
                }
            } catch (error) {
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

    async function loadResults() {
        const panel = byId("resultsSection", "qeResultsPanel");
        panel?.setAttribute("aria-busy", "true");
        try {
            await loadResultsData();
        } finally {
            panel?.setAttribute("aria-busy", "false");
        }
    }

    async function loadResultsData() {
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
        if (statisticsNode) {
            keys.push("descriptiveStatistics");
            requests.push(client.getDescriptiveStatistics(
                state.flowRunId,
                Number(statisticsNode.FLOW_NODE_RUN_ID)
            ));
        }

        resultData = {
            categorical: null,
            continuous: null,
            categoricalViolation: null,
            continuousViolation: null,
            descriptiveStatistics: null
        };
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
        const priority = byId("qeStatisticsPriority");
        const notice = byId("qeStatisticsNotice");
        const payload = getStatisticsPayload();
        if (!section || !kpis || !priority || !notice) return;

        if (!payload || payload.available === false) {
            setHidden(section, false);
            kpis.innerHTML = "";
            priority.innerHTML = '<div class="qe-empty">등록된 INITUP$ 원본 테이블에서 분석 가능한 컬럼 통계를 계산할 수 없습니다.</div>';
            notice.textContent = payload?.reason || payload?.notice || "대상 테이블 연결 정보를 확인해 주세요.";
            notice.hidden = false;
            byId("qeStatisticsDetailButton").disabled = true;
            return;
        }

        const columns = Array.isArray(payload.columns) ? payload.columns : [];
        const insights = payload.insights && typeof payload.insights === "object" ? payload.insights : {};
        const ranked = Array.isArray(insights.rankedColumns)
            ? insights.rankedColumns
            : columns.map((column) => column.insight || { columnName: column.columnName });
        const summary = insights.summary || {};
        const distribution = payload.summary || {};
        const totalViolations = finiteNumber(summary.totalViolationCount)
            ?? ranked.reduce((sum, row) => sum + Number(row.violationCount || 0), 0);
        kpis.innerHTML = R.renderKpis([
            { label: "통계 분석 컬럼", value: R.formatNumber(columns.length, 0), tone: "primary" },
            { label: "우선 확인 컬럼", value: R.formatNumber(summary.highPriorityColumnCount || 0, 0) },
            { label: "위반 발생 컬럼", value: R.formatNumber(summary.violationColumnCount || 0, 0) },
            { label: "전체 규칙 위반", value: R.formatNumber(totalViolations, 0) },
            { label: "분산 감소", value: R.formatNumber(distribution.varianceDecreasedColumnCount || 0, 0), help: "수정 후 분산이 감소한 컬럼" },
            { label: "분산 증가", value: R.formatNumber(distribution.varianceIncreasedColumnCount || 0, 0), help: "수정 후 분산이 증가한 컬럼" }
        ]);

        const topRows = ranked.slice(0, 50);
        priority.innerHTML = topRows.length ? topRows.map((row, index) => {
            const reasons = Array.isArray(row.priorityReasons)
                ? row.priorityReasons.join(" · ")
                : String(row.priorityReasons || "분포 변화 확인");
            const score = finiteNumber(row.importanceScore) || 0;
            const level = score >= 70 ? "high" : score >= 30 ? "medium" : "low";
            return `<button type="button" class="qe-statistics-priority-card is-${R.escapeHtml(level)}"
                    data-statistics-column="${R.escapeHtml(String(row.columnName || ""))}">
                <span class="qe-statistics-rank">${index + 1}</span>
                <span class="qe-statistics-priority-card__body">
                    <strong>${R.escapeHtml(statisticsColumnLabel(row))}</strong>
                    <small>${R.escapeHtml(reasons)}</small>
                    <span>
                        <em>중요도 ${R.escapeHtml(R.formatNumber(row.importanceScore || 0, 1))}</em>
                        <em>위반 ${R.escapeHtml(R.formatNumber(row.violationCount || 0, 0))}</em>
                        <em>결측 ${R.escapeHtml(formatPercent(row.missingRate || 0))}</em>
                    </span>
                </span>
            </button>`;
        }).join("") : '<div class="qe-empty">우선 확인할 컬럼 정보가 없습니다.</div>';
        notice.textContent = payload.notice || "";
        notice.hidden = !payload.notice;
        byId("qeStatisticsDetailButton").disabled = columns.length === 0;
        setHidden(section, false);
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

    function renderResults() {
        const panel = byId("resultsSection", "qeResultsPanel");
        setHidden(panel, false);
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
        if (categoryKpis) categoryKpis.innerHTML = R.renderKpis([
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
                label: `${row.CONDITION_COUNT ?? 0}개 조건`, value: Number(row.RULE_COUNT || 0)
            })), categoricalLegendRules, "categorical", "CONDITION_COUNT");
            const resultItems = R.filterLegendItems((categorical?.resultTop || []).map((row) => ({
                key: String(row.RESULT_COLUMN || "").trim().toUpperCase(),
                label: R.getColumnLabel(row.RESULT_COLUMN || "결과 미지정", categoricalComments), value: Number(row.RULE_COUNT || 0)
            })), categoricalLegendRules, "categorical", "RESULT_COLUMN");
            const chartBody = categoryCharts.querySelector("[data-chart-body]") || categoryCharts;
            chartBody.innerHTML = `
                <section><h4>조건 개수별 규칙</h4>${R.renderBars(conditionItems, {
                    ariaLabel: "조건 개수별 범주형 규칙 수", interactive: true,
                    filterKind: "categorical", filterType: "CONDITION_COUNT", activeFilter: categoricalFilter
                })}</section>
                <section><h4>결과 컬럼별 규칙</h4>${R.renderBars(resultItems, {
                    accent: "mint", ariaLabel: "결과 컬럼별 범주형 규칙 수", interactive: true,
                    filterKind: "categorical", filterType: "RESULT_COLUMN", activeFilter: categoricalFilter
                })}</section>`;
            setText(
                categoryCharts.querySelector("[data-chart-caption]"),
                categoricalFilter.type === "ALL" ? "전체 · 범례별 상위 규칙" : `${categoricalFilter.label} 선택`
            );
        }
        if (categoryRules) {
            categoryRules.innerHTML = R.renderCategoricalRules(categoricalRules, {
                columnComments: categoricalComments,
                violationCounts: getViolationCountMap("categorical")
            });
            setText(
                categoryRules.closest(".qe-result-block")?.querySelector("[data-rule-count]"),
                categoricalFilter.type === "ALL"
                    ? `범례별 상위 ${categoricalRules.length}개`
                    : `${categoricalFilter.label} · 상위 ${categoricalRules.length}개`
            );
            prepareCategoricalDetail(categoricalRules);
        }

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
        if (continuousKpis) continuousKpis.innerHTML = R.renderKpis([
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
                label: row.METHOD || "방법 미지정", value: Number(row.RULE_COUNT || 0)
            })), continuousLegendRules, "continuous", "METHOD");
            const chartBody = continuousCharts.querySelector("[data-chart-body]") || continuousCharts;
            chartBody.innerHTML = `
                <section><h4>대상 컬럼별 규칙</h4>${R.renderBars(targetItems, {
                    ariaLabel: "대상 컬럼별 연속형 규칙 수", interactive: true,
                    filterKind: "continuous", filterType: "TARGET_COLUMN", activeFilter: continuousFilter
                })}</section>
                <section><h4>발굴 방법별 규칙</h4>${R.renderBars(methodItems, {
                    accent: "mint", ariaLabel: "발굴 방법별 연속형 규칙 수", interactive: true,
                    filterKind: "continuous", filterType: "METHOD", activeFilter: continuousFilter
                })}</section>`;
            setText(
                continuousCharts.querySelector("[data-chart-caption]"),
                continuousFilter.type === "ALL" ? "전체 · 범례별 상위 규칙" : `${continuousFilter.label} 선택`
            );
        }
        if (continuousRules) {
            continuousRules.innerHTML = R.renderContinuousRules(displayedContinuousRules, {
                columnComments: continuousComments,
                violationCounts: getViolationCountMap("continuous")
            });
            setText(
                continuousRules.closest(".qe-result-block")?.querySelector("[data-rule-count]"),
                continuousFilter.type === "ALL"
                    ? `범례별 상위 ${displayedContinuousRules.length}개`
                    : `${continuousFilter.label} · 상위 ${displayedContinuousRules.length}개`
            );
            prepareContinuousDetail(displayedContinuousRules);
        }

        renderDescriptiveStatistics();

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
        if (!select || !safeRules.length) return;
        const selectedRuleId = continuousDetail.ruleId;
        select.innerHTML = safeRules.map((rule, index) => {
            const targetLabel = R.getColumnLabel(rule.TARGET_COLUMN || `규칙 ${index + 1}`, getResultColumnComments("continuous"));
            return `<option value="${index}">${R.escapeHtml(targetLabel)} · ${R.escapeHtml(rule.METHOD || "수식 규칙")}</option>`;
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
        if (value === null || value === undefined || String(value).trim() === "") return null;
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
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        const absolute = Math.abs(number);
        if (absolute > 0 && (absolute < 0.000001 || absolute >= 1000000000)) return number.toExponential(4);
        return number.toLocaleString("ko-KR", { maximumFractionDigits: digits });
    }

    async function loadContinuousDetail(ruleIndex, force = false) {
        const rules = getDisplayedRules("continuous");
        const index = Math.max(0, Math.min(rules.length - 1, Number(ruleIndex) || 0));
        const rule = rules[index];
        const artifact = state.resultArtifacts?.continuous;
        if (!rule || !artifact?.owner) return;
        const ruleId = String(rule.RULE_ID || "").trim();
        if (!ruleId) return;
        const select = byId("qeContinuousRuleSelect");
        if (select) select.value = String(index);
        if (!force && continuousDetail.ruleId === ruleId && (continuousDetail.rows.length || continuousDetail.error)) {
            renderContinuousDetail();
            return;
        }
        const requestId = ++continuousDetailRequestId;
        continuousDetail = {
            ruleId,
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
        setText(byId("qeContinuousDetailMessage"), "규칙 샘플과 수식 계산 결과를 불러오는 중입니다.");
        const metrics = byId("qeContinuousDetailMetrics");
        if (metrics) metrics.innerHTML = '<div><span>상태</span><strong>조회 중</strong><small>샘플 계산</small></div>';
        try {
            const response = await client.getSymbolicRuleSample({
                owner: artifact.owner,
                ruleId,
                flowRunId: state.flowRunId,
                sampleLimit: 200
            });
            if (requestId !== continuousDetailRequestId) return;
            const payload = response.data || {};
            const mergedRule = { ...rule, ...(payload.rule || {}) };
            const rows = Array.isArray(payload.rows) ? payload.rows : [];
            const evaluation = evaluateContinuousRows(mergedRule, rows);
            continuousDetail = {
                ruleId,
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
            if (requestId !== continuousDetailRequestId) return;
            continuousDetail.error = error.message || "연속형 상세 샘플을 조회하지 못했습니다.";
        }
        renderContinuousDetail();
    }

    function renderContinuousDetail() {
        const panel = byId("qeContinuousDetail");
        if (!panel || !continuousDetail.rule) return;
        panel.hidden = false;
        const rule = continuousDetail.rule;
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
            <tbody>${rows.map((item) => `<tr data-continuous-row-index="${item.rowIndex}" tabindex="-1"
                    class="${continuousDetail.selectedRowIndex === item.rowIndex ? "is-selected" : ""}"
                    aria-selected="${continuousDetail.selectedRowIndex === item.rowIndex ? "true" : "false"}">
                <td class="is-number">${item.rowIndex + 1}</td>
                ${columns.map((column) => `<td class="is-number">${R.escapeHtml(formatDiagnosticNumber(column.value(item), 6))}</td>`).join("")}
            </tr>`).join("")}</tbody>
        </table>`;
    }

    function focusContinuousSampleRow(row) {
        const grid = byId("qeContinuousSampleTable");
        if (!row || !grid) return;
        grid.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        window.requestAnimationFrame(() => {
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
            row.focus({ preventScroll: true });
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
            if (selected && options.scroll !== false) focusContinuousSampleRow(row);
        });
        drawContinuousDetailChart();
    }

    function findContinuousChartPoint(event, maxDistance = 12) {
        const canvas = byId("qeContinuousDetailChart");
        const points = continuousDetail.chartPoints || [];
        if (!canvas || !points.length) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = (event.clientX - rect.left) * (Number(canvas.dataset.chartWidth || rect.width) / rect.width);
        const y = (event.clientY - rect.top) * (Number(canvas.dataset.chartHeight || rect.height) / rect.height);
        let nearest = null;
        let nearestDistance = maxDistance;
        points.forEach((point) => {
            const distance = Math.hypot(point.screenX - x, point.screenY - y);
            if (distance <= nearestDistance) {
                nearest = point;
                nearestDistance = distance;
            }
        });
        return nearest;
    }

    function handleContinuousChartClick(event) {
        const point = findContinuousChartPoint(event, 14);
        if (!point) return;
        selectContinuousSampleRow(point.rowIndex);
    }

    function handleContinuousChartKeydown(event) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
        const rows = continuousDetail.evaluatedRows || [];
        if (!rows.length) return;
        const current = rows.findIndex((row) => row.rowIndex === continuousDetail.selectedRowIndex);
        let next = current >= 0 ? current : 0;
        if (event.key === "ArrowLeft") next = Math.max(0, next - 1);
        else if (event.key === "ArrowRight") next = Math.min(rows.length - 1, next + 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = rows.length - 1;
        event.preventDefault();
        selectContinuousSampleRow(rows[next].rowIndex);
    }

    function drawContinuousDetailChart() {
        const canvas = byId("qeContinuousDetailChart");
        const message = byId("qeContinuousDetailMessage");
        const rows = continuousDetail.evaluatedRows || [];
        if (!canvas) return;
        const context = canvas.getContext("2d");
        const cssWidth = Math.max(560, canvas.parentElement?.clientWidth - 24 || 900);
        const cssHeight = Math.max(260, canvas.clientHeight || 315);
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
            context.fillStyle = "#718096";
            context.font = "12px system-ui, sans-serif";
            context.textAlign = "center";
            context.fillText("표시할 연속형 샘플이 없습니다.", cssWidth / 2, cssHeight / 2);
            return;
        }
        const mode = valueOf("qeContinuousChartMode") || "actual-predicted";
        const points = rows.map((item) => mode === "residual"
            ? { x: item.predicted, y: item.residual, residual: item.residual, rowIndex: item.rowIndex }
            : { x: item.actual, y: item.predicted, residual: item.residual, rowIndex: item.rowIndex });
        const allX = points.map((item) => item.x);
        const allY = points.map((item) => item.y);
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
        const plot = { left: 68, top: 18, right: cssWidth - 22, bottom: cssHeight - 52 };
        const mapX = (value) => plot.left + ((value - minX) / (maxX - minX)) * (plot.right - plot.left);
        const mapY = (value) => plot.bottom - ((value - minY) / (maxY - minY)) * (plot.bottom - plot.top);
        context.font = "9px system-ui, sans-serif";
        context.textAlign = "right";
        context.textBaseline = "middle";
        for (let index = 0; index <= 5; index += 1) {
            const xValue = minX + ((maxX - minX) * index / 5);
            const yValue = minY + ((maxY - minY) * index / 5);
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
        context.strokeStyle = mode === "residual" ? "#cf3c4f" : "#d07b24";
        context.lineWidth = 1.5;
        context.setLineDash([6, 5]);
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
        const mae = Math.max(Number(continuousDetail.metrics?.mae || 0), Number.EPSILON);
        continuousDetail.chartPoints = points.map((point) => ({
            ...point,
            screenX: mapX(point.x),
            screenY: mapY(point.y)
        }));
        continuousDetail.chartPoints.forEach((point) => {
            const outlier = Math.abs(point.residual) > mae * 2;
            const selected = point.rowIndex === continuousDetail.selectedRowIndex;
            context.beginPath();
            context.arc(point.screenX, point.screenY, selected ? 6 : outlier ? 3.8 : 2.8, 0, Math.PI * 2);
            context.fillStyle = selected ? "rgba(245, 158, 11, 0.92)" : outlier ? "rgba(207, 60, 79, 0.72)" : "rgba(36, 87, 214, 0.58)";
            context.fill();
            context.strokeStyle = selected ? "#b45309" : outlier ? "#b72f43" : "#2457d6";
            context.lineWidth = selected ? 1.4 : 0.7;
            context.stroke();
        });
        const comments = getResultColumnComments("continuous");
        const targetLabel = R.getColumnLabel(continuousDetail.rule?.TARGET_COLUMN || "Y", comments);
        const xLabel = mode === "residual" ? `예측값 · ${targetLabel}` : `실제값 · ${targetLabel}`;
        const yLabel = mode === "residual" ? "잔차 (실제값 - 예측값)" : `예측값 · ${targetLabel}`;
        context.fillStyle = "#344159";
        context.font = "600 10px system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(xLabel, (plot.left + plot.right) / 2, cssHeight - 10);
        context.save();
        context.translate(13, (plot.top + plot.bottom) / 2);
        context.rotate(-Math.PI / 2);
        context.fillText(yLabel, 0, 0);
        context.restore();
        const detailMessage = mode === "residual"
            ? "잔차가 0선을 중심으로 고르게 분포할수록 안정적입니다. 빨간 점은 MAE의 2배를 넘는 표본이며, 점을 누르면 하단 상세 행으로 이동합니다."
            : "점이 기준선(y=x)에 가까울수록 예측 오차가 작습니다. 빨간 점은 MAE의 2배를 넘는 표본이며, 점을 누르면 하단 상세 행으로 이동합니다.";
        setText(message, detailMessage);
        canvas.setAttribute("aria-label", `${targetLabel} ${mode === "residual" ? "예측값과 잔차" : "실제값과 예측값"} 비교 그래프, ${points.length}개 표본. 점을 선택하면 하단 상세 행으로 이동합니다.`);
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
        const tabs = [...document.querySelectorAll("[data-result-tab]")];
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
        if (kind === "categorical") {
            const resultText = rule.RESULT_TEXT
                || [rule.RESULT_COLUMN, rule.RESULT_VALUE].filter((value) => value !== null && value !== undefined && value !== "").join(" = ")
                || "-";
            return `<div class="qe-quick-insight">
                    <strong>핵심 안내</strong>
                    <span>IF 조건을 만족하지만 예상 결과와 다른 데이터를 위반으로 확인합니다.</span>
                </div>
                <dl class="qe-rule-fields qe-rule-fields--inline">
                    <div class="is-wide"><dt>조건</dt><dd>${R.escapeHtml(R.annotateColumnText(rule.CONDITION_TEXT || rule.CONDITION_COLUMN || "-", comments))}</dd></div>
                    <div class="is-wide"><dt>예상 결과</dt><dd>${R.escapeHtml(R.annotateColumnText(resultText, comments))}</dd></div>
                    <div><dt>결과 컬럼</dt><dd>${R.escapeHtml(R.getColumnLabel(rule.RESULT_COLUMN || "-", comments))}</dd></div>
                    <div><dt>신뢰도</dt><dd>${R.escapeHtml(R.formatRatio(rule.RULE_CONFIDENCE))}</dd></div>
                    <div><dt>향상도</dt><dd>${R.escapeHtml(R.formatNumber(rule.RULE_LIFT, 3))}</dd></div>
                    <div><dt>조건 수</dt><dd>${R.escapeHtml(R.formatNumber(rule.CONDITION_COUNT, 0))}개</dd></div>
                </dl>
                ${renderRuleViolationAction(kind, index, rule)}`;
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
        setText(byId("qeCategoricalDetailTitle"), `범주형 규칙 상세 · ${rule.RULE_ID || normalizedIndex + 1}`);
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
        const countLabel = count === null ? "저장된 위반 데이터를 조회합니다." : `저장된 위반 ${R.formatNumber(count, 0)}건`;
        return `<div class="qe-rule-violation-actions">
            <span>${R.escapeHtml(countLabel)}</span>
            <button type="button" class="qe-secondary-button" data-load-violations="true"
                    data-rule-kind="${R.escapeHtml(kind)}" data-rule-index="${index}">위반 데이터 조회</button>
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
            target.innerHTML = "<p>이 규칙에서 저장된 위반 데이터가 없습니다.</p>";
            return;
        }
        const preferred = kind === "categorical"
            ? ["CASE_ID", "RESULT_COLUMN", "EXPECTED_VALUE", "ACTUAL_VALUE", "VIOLATION_SCORE", "RULE_CONFIDENCE", "RULE_LIFT", "VIOLATION_REASON"]
            : ["CASE_ID", "TARGET_COLUMN", "PREDICTED_VALUE", "ACTUAL_VALUE", "ABS_ERROR", "ERROR_PCT", "TOLERANCE_PCT", "VIOLATION_SCORE", "VIOLATION_REASON"];
        const available = new Set(Object.keys(rows[0] || {}).map((key) => key.toUpperCase()));
        const columns = preferred.filter((key) => available.has(key));
        const labels = {
            CASE_ID: "행 식별값", RESULT_COLUMN: "결과 컬럼", TARGET_COLUMN: "대상 컬럼",
            EXPECTED_VALUE: "기대값", PREDICTED_VALUE: "예측값", ACTUAL_VALUE: "실제값",
            ABS_ERROR: "절대 오차", ERROR_PCT: "오차율", TOLERANCE_PCT: "허용 오차율",
            VIOLATION_SCORE: "위반 점수", RULE_CONFIDENCE: "신뢰도", RULE_LIFT: "향상도",
            VIOLATION_REASON: "위반 사유"
        };
        const comments = getResultColumnComments(kind);
        const numericColumns = R.getViolationNumericColumns(kind);
        const renderValue = (row, column) => {
            const value = row[column];
            if (["RESULT_COLUMN", "TARGET_COLUMN"].includes(column)) return R.getColumnLabel(value, comments);
            if (["ERROR_PCT", "TOLERANCE_PCT"].includes(column)) return R.formatRatio(value, 2);
            if (numericColumns.has(column)) return formatDiagnosticNumber(value, 5);
            return value == null || value === "" ? "-" : String(value);
        };
        const summaryMarkup = `<strong>위반 데이터</strong><span>전체 ${R.escapeHtml(R.formatNumber(total, 0))}건 · ${page}/${totalPages} 페이지</span>`;
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
                        data-rule-kind="${R.escapeHtml(kind)}" data-rule-index="${index}" ${page <= 1 ? "disabled" : ""}>이전</button>
                <button type="button" class="qe-secondary-button" data-violation-page="${Math.min(totalPages, page + 1)}"
                        data-rule-kind="${R.escapeHtml(kind)}" data-rule-index="${index}" ${page >= totalPages ? "disabled" : ""}>다음</button>`;
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
            const action = detailLoading
                ? `<span class="qe-run-history-item__loading" role="status">
                       <span>상세 조회 중</span>
                       <span class="qe-run-history-loading-bar" aria-hidden="true"><i></i></span>
                   </span>`
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
                descriptiveStatistics: null
            };
            continuousDetailRequestId += 1;
            continuousDetail = {
                ruleId: "", ruleIndex: -1, rule: null, rows: [], evaluatedRows: [],
                metrics: null, sampleCount: 0, hasMore: false, error: "",
                selectedRowIndex: null, chartPoints: []
            };
            state = {
                ...initialState(),
                ...restored,
                version: STATE_VERSION,
                targetContextId: client.targetConnectionId,
                historyView: true,
                historyViewedAt: new Date().toISOString(),
                historySteps: Array.isArray(detail.steps) ? detail.steps : [],
                completedSteps: Array.isArray(restored.completedSteps) ? restored.completedSteps : [],
                jobIds: Array.isArray(restored.jobIds) ? restored.jobIds : []
            };
            lastRenderedStep = -1;
            persistState();
            renderResultsEmpty();
            renderHistory();
            renderState(`실행 #${runId}의 저장된 8단계 결과를 복원했습니다.`);

            if (R.normalizeStatus(state.lastRunStatus) === "SUCCESS") {
                pipelineBusy = true;
                updateActionState();
                try {
                    await loadResults();
                    state.status = state.resultWarning ? "warning" : "success";
                    state.error = "";
                    persistState();
                    renderState(state.resultWarning || `실행 #${runId}의 저장된 분석 결과를 불러왔습니다.`);
                } catch (error) {
                    state.status = "warning";
                    state.resultWarning = error.message;
                    persistState();
                    renderState("실행 단계는 복원했지만 일부 분석 결과를 불러오지 못했습니다.");
                    showToast(error.message, "warning");
                } finally {
                    pipelineBusy = false;
                    updateActionState();
                }
            }
            byId("qeRunHistoryDialog")?.close();
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (error) {
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
        state.targetContextId = client.targetConnectionId;
        selectedFile = null;
        currentSnapshot = null;
        resultData = {
            categorical: null,
            continuous: null,
            categoricalViolation: null,
            continuousViolation: null,
            descriptiveStatistics: null
        };
        resetRuleDistributionFilters();
        continuousDetailRequestId += 1;
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
        setHidden(byId("resultsSection", "qeResultsPanel"), true);
        setHidden(byId("qeCategoricalDetail"), true);
        setHidden(byId("qeContinuousDetail"), true);
        setHidden(byId("qeStatisticsSummary"), true);
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
            state.status = "running";
            updateActionState();
            try {
                await loadResults();
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
                updateActionState();
            }
            return;
        }
        await runPipeline({ forceNewRun: failedRun });
    }

    function bindEvents() {
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
        byId("qeContinuousSampleTable")?.addEventListener("keydown", (event) => {
            if (!["Enter", " "].includes(event.key)) return;
            const row = event.target.closest("tr[data-continuous-row-index]");
            if (!row) return;
            event.preventDefault();
            selectContinuousSampleRow(Number(row.dataset.continuousRowIndex), { scroll: false });
        });
        byId("qeContinuousDetailReload")?.addEventListener("click", () => {
            const index = Number(valueOf("qeContinuousRuleSelect") || continuousDetail.ruleIndex || 0);
            loadContinuousDetail(index, true).catch((error) => showToast(error.message, "error"));
        });
        byId("toast", "qeToastRegion")?.querySelector("[data-toast-close]")?.addEventListener("click", () => {
            const toast = byId("toast", "qeToastRegion");
            if (toast) toast.hidden = true;
        });
        window.addEventListener("resize", () => {
            window.clearTimeout(chartResizeTimer);
            chartResizeTimer = window.setTimeout(drawContinuousDetailChart, 120);
        });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && !state.historyView && state.flowRunId && R.ACTIVE_STATUSES.has(R.normalizeStatus(state.lastRunStatus))) {
                fetchSnapshot({ silent: true }).catch(() => {});
            }
        });
    }

    async function init() {
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
                    descriptiveStatistics: null
                };
                continuousDetailRequestId += 1;
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
                    if (R.normalizeStatus(state.lastRunStatus) === "SUCCESS") {
                        await loadResults();
                        state.status = state.resultWarning ? "warning" : "success";
                    }
                    persistState();
                    renderState(state.resultWarning || `실행 #${state.flowRunId}의 저장된 결과를 다시 불러왔습니다.`);
                } catch (error) {
                    state.status = "warning";
                    state.resultWarning = error.message;
                    persistState();
                    renderState("과거 실행의 일부 결과를 불러오지 못했습니다.");
                }
            } else if (state.flowRunId && ["running", "failed"].includes(state.status)) {
                pipelineBusy = true;
                state.status = "running";
                const generation = ++pollGeneration;
                updateActionState();
                try {
                    await pollRunUntilTerminal(generation);
                    if (!state.completedSteps.includes(6)) state.completedSteps.push(6);
                    state.currentStep = 7;
                    await loadResults();
                    if (!state.completedSteps.includes(7)) state.completedSteps.push(7);
                    state.status = state.resultWarning ? "warning" : "success";
                    persistState();
                    renderState(state.resultWarning || "자동 실행과 결과 분석이 완료되었습니다.");
                } catch (error) {
                    state.status = "failed";
                    state.error = error.message;
                    persistState();
                    renderState();
                } finally {
                    pipelineBusy = false;
                    updateActionState();
                }
            } else if (state.flowRunId && ["success", "warning"].includes(state.status)) {
                try {
                    await fetchSnapshot({ silent: true });
                    await loadResults();
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
