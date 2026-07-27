(function() {
    const PAGE_CODE = "M02002";
    const CONTEXT_STORAGE_KEY = "DATA_EDITING_WORK_CONTEXT";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);
    const TREE_PAGE_SIZE = 200;

    const M02002 = {

        ...COMMON,
        isInit: false,
        contextProjects: [],
        contextScenarios: [],
        selectedProjectId: "",
        selectedScenarioId: "",
        scenarioTables: [],
        scenarioTableRequestVersion: 0,
        selectedScenarioTableKey: "",
        tables: [],
        displayedTables: [],
        tableSearchMode: false,
        tableTreeLoading: false,
        tableTreeHasMore: false,
        tableTreeNextOffset: 0,
        tableTreeRequestVersion: 0,
        selectedTable: null,
        analysisTable: null,
        focusedTableKey: "",
        activeTab: "columns",
        gridData: {
            columns: [],
            data: [],
            sql: []
        },
        columnWidths: {
            columns: [],
            data: [],
            sql: []
        },
        gridFrozenColumns: { columns: 0, data: 0, sql: 0 },
        gridPages: { data: 1, sql: 1 },
        gridPageSizes: { data: 100, sql: 100 },
        gridTotals: { data: 0, sql: 0 },
        gridTotalPages: { data: 1, sql: 1 },
        dataGridStateKey: "",
        sqlGridText: "",
        selectedCell: null,
        resizing: null,
        handleResizeMoveBound: null,
        stopColumnResizeBound: null,
        sqlKeydownBound: null,
        contextLoadFailed: false,

        async init() {
            if (this.isInit) return;
            this.handleResizeMoveBound = this.handleColumnResizeMove.bind(this);
            this.stopColumnResizeBound = this.stopColumnResize.bind(this);
            this.sqlKeydownBound = this.handleSqlEditorKeydown.bind(this);
            document.addEventListener("mousemove", this.handleResizeMoveBound);
            document.addEventListener("mouseup", this.stopColumnResizeBound);
            getContainerEl("#sqlEditor-M02002")?.addEventListener("keydown", this.sqlKeydownBound);
            await this.loadWorkContext();
            this.switchTab("columns");
            this.isInit = true;
            Promise.all([this.loadScenarioTables(), this.loadTableTree()])
                .catch((error) => console.error("[M02002] deferred initial data load failed", error));
        },

        destroy() {
            this.contextProjects = [];
            this.contextScenarios = [];
            this.selectedProjectId = "";
            this.selectedScenarioId = "";
            this.scenarioTables = [];
            this.scenarioTableRequestVersion = 0;
            this.selectedScenarioTableKey = "";
            this.tables = [];
            this.displayedTables = [];
            this.tableSearchMode = false;
            this.tableTreeLoading = false;
            this.tableTreeHasMore = false;
            this.tableTreeNextOffset = 0;
            this.tableTreeRequestVersion = 0;
            this.selectedTable = null;
            this.analysisTable = null;
            this.focusedTableKey = "";
            this.activeTab = "columns";
            this.gridData = { columns: [], data: [], sql: [] };
            this.columnWidths = { columns: [], data: [], sql: [] };
            this.gridFrozenColumns = { columns: 0, data: 0, sql: 0 };
            this.gridPages = { data: 1, sql: 1 };
            this.gridPageSizes = { data: 100, sql: 100 };
            this.gridTotals = { data: 0, sql: 0 };
            this.gridTotalPages = { data: 1, sql: 1 };
            this.dataGridStateKey = "";
            this.sqlGridText = "";
            this.selectedCell = null;
            this.resizing = null;
            this.contextLoadFailed = false;
            if (this.handleResizeMoveBound) {
                document.removeEventListener("mousemove", this.handleResizeMoveBound);
            }
            if (this.stopColumnResizeBound) {
                document.removeEventListener("mouseup", this.stopColumnResizeBound);
            }
            if (this.sqlKeydownBound) {
                getContainerEl("#sqlEditor-M02002")?.removeEventListener("keydown", this.sqlKeydownBound);
            }
            this.handleResizeMoveBound = null;
            this.stopColumnResizeBound = null;
            this.sqlKeydownBound = null;
            this.isInit = false;
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
                this.renderContextScenarios([]);
            }
            if (this.contextLoadFailed) return;
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
        },

        async loadContextProjects(preferredProjectId = "") {
            const select = getContainerEl("#contextProject-M02002");
            if (!select) return;

            select.innerHTML = `<option value="">${this.escapeHtml(this.t("loadingProjects", "Loading projects..."))}</option>`;
            try {
                this.contextLoadFailed = false;
                const params = new URLSearchParams({ keyword: "" });
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?${params.toString()}`, { method: "GET", showLoading: false });
                this.contextProjects = Array.isArray(json.data)
                    ? json.data.filter((project) => project.USE_YN === "Y")
                    : [];
                this.renderContextProjects(preferredProjectId);
            } catch (error) {
                const message = error.message || this.t("projectLoadFailed", "Project load failed.");
                this.contextLoadFailed = true;
                this.contextProjects = [];
                this.selectedProjectId = "";
                console.error("[M02002] project context load failed", error);
                select.innerHTML = `<option value="">${this.escapeHtml(this.t("projectLoadFailed", "Project load failed"))}</option>`;
                console.error("[M02002] work context load failed", message);
            }
        },

        renderContextProjects(preferredProjectId = "") {
            const select = getContainerEl("#contextProject-M02002");
            if (!select) return;

            select.innerHTML = `
                <option value="">${this.escapeHtml(this.t("selectProject", "-- Select project --"))}</option>
                ${this.contextProjects.map((project) => `
                    <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(project))}" value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                        ${this.escapeHtml(CommonUtils.formatOwnerScopedName(project, project.PROJECT_NAME || project.PROJECT_CODE || this.t("untitledProject", "(Untitled project)")))}
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
            CommonUtils.applyOwnerScopeToSelect(getContainerEl("#contextProject-M02002"), this.contextProjects, this.selectedProjectId);
            this.selectedScenarioId = "";
            this.resetTableAnalysis();
            this.saveStoredContext();
            await this.loadContextScenarios("");
            await Promise.all([this.loadScenarioTables(), this.loadTableTree()]);
        },

        async loadContextScenarios(preferredScenarioId = "") {
            if (!this.selectedProjectId) {
                this.contextScenarios = [];
                this.renderContextScenarios("");
                return;
            }

            const select = getContainerEl("#contextScenario-M02002");
            if (select) select.innerHTML = `<option value="">${this.escapeHtml(this.t("loadingScenarios", "Loading scenarios..."))}</option>`;

            try {
                this.contextLoadFailed = false;
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    keyword: ""
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/scenarios?${params.toString()}`, { method: "GET", showLoading: false });
                this.contextScenarios = Array.isArray(json.data) ? json.data : [];
                this.renderContextScenarios(preferredScenarioId);
            } catch (error) {
                const message = error.message || this.t("scenarioLoadFailed", "Scenario load failed.");
                this.contextLoadFailed = true;
                this.contextScenarios = [];
                this.selectedScenarioId = "";
                console.error("[M02002] scenario context load failed", error);
                if (select) select.innerHTML = `<option value="">${this.escapeHtml(this.t("scenarioLoadFailed", "Scenario load failed"))}</option>`;
                console.error("[M02002] work context load failed", message);
            }
        },

        renderContextScenarios(preferredScenarioId = "") {
            const select = getContainerEl("#contextScenario-M02002");
            if (!select) return;

            select.innerHTML = `
                <option value="">${this.escapeHtml(this.t("selectScenario", "ALL"))}</option>
                ${this.contextScenarios.map((scenario) => `
                    <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(scenario))}" value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                        ${this.escapeHtml(CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || this.t("untitledScenario", "(Untitled scenario)")))}
                    </option>
                `).join("")}
            `;

            const exists = this.contextScenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
            this.selectedScenarioId = exists ? String(preferredScenarioId) : "";
            select.value = this.selectedScenarioId;
            CommonUtils.applyOwnerScopeToSelect(select, this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
            this.saveStoredContext();
        },

        async handleContextScenarioChange(scenarioId) {
            this.selectedScenarioId = scenarioId || "";
            CommonUtils.applyOwnerScopeToSelect(getContainerEl("#contextScenario-M02002"), this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
            this.resetTableAnalysis();
            this.saveStoredContext();
            await Promise.all([this.loadScenarioTables(), this.loadTableTree()]);
        },

        ensureWorkContextSelected() {
            if (!this.ensureProjectSelected()) return false;
            if (!this.selectedScenarioId) {
                alert("Scenario is required.");
                getContainerEl("#contextScenario-M02002")?.focus();
                return false;
            }
            return true;
        },

        async loadScenarioTables() {
            const requestVersion = ++this.scenarioTableRequestVersion;
            this.selectedScenarioTableKey = "";
            this.scenarioTables = [];
            if (!this.selectedProjectId) {
                this.updateActionButtons();
                return;
            }

            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId
                });
                if (this.selectedScenarioId) params.set("scenarioId", this.selectedScenarioId);
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-tables?${params.toString()}`, { method: "GET", showLoading: false });
                if (requestVersion !== this.scenarioTableRequestVersion) return;
                this.scenarioTables = Array.isArray(json.data) ? json.data : [];
            } catch (error) {
                if (requestVersion !== this.scenarioTableRequestVersion) return;
                this.scenarioTables = [];
                console.error("[M02002] scenario table load failed", error);
            } finally {
                if (requestVersion !== this.scenarioTableRequestVersion) return;
                this.updateActionButtons();
                if (this.selectedTable) this.updateSelectedMeta();
            }
        },

        renderScenarioTables() {
            const container = getContainerEl("#scenarioTablesGrid-M02002");
            if (!container) return;

            if (!this.scenarioTables.length) {
                container.innerHTML = `
                    <div class="table-empty">${this.escapeHtml(this.t("noScenarioTables", "No tables registered to this scenario."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `
                <div class="scenario-table-scroll-body">
                    <div class="scenario-table-head">
                        <div>Owner</div>
                        <div>Table</div>
                        <div>Comment</div>
                        <div>Status</div>
                    </div>
                    <div class="scenario-table-body">
                        ${this.scenarioTables.map((row) => this.createScenarioTableRow(row)).join("")}
                    </div>
                </div>
                ${this.renderListFooter(this.scenarioTables.length)}
            `;
        },

        createScenarioTableRow(row) {
            const key = this.getScenarioTableKey(row);
            const selectedClass = key === this.selectedScenarioTableKey ? "is-selected" : "";
            const status = row._PENDING ? "Pending" : (row.USE_YN || "Y");
            return `
                <div role="button" tabindex="0" class="scenario-table-row ${selectedClass}" data-scenario-table-key="${this.escapeHtml(key)}" onclick="M02002.selectScenarioTable('${this.escapeJs(key)}')">
                    <span title="${this.escapeHtml(row.OWNER_NAME || "")}">${this.escapeHtml(row.OWNER_NAME || "-")}</span>
                    <span title="${this.escapeHtml(row.TABLE_NAME || "")}">${this.escapeHtml(row.TABLE_NAME || "-")}</span>
                    <span>
                        <input
                            class="scenario-table-comment-input"
                            type="text"
                            value="${this.escapeAttr(row.TABLE_COMMENT || "")}"
                            title="${this.escapeHtml(row.TABLE_COMMENT || "")}"
                            onclick="event.stopPropagation()"
                            onfocus="M02002.selectScenarioTable('${this.escapeJs(key)}')"
                            oninput="M02002.updateScenarioTableComment('${this.escapeJs(key)}', this.value)"
                        >
                    </span>
                    <span>${this.escapeHtml(status)}</span>
                </div>
            `;
        },

        getScenarioTableKey(row) {
            if (row.SCENARIO_TABLE_ID) return `ID:${row.SCENARIO_TABLE_ID}`;
            return `NEW:${row.OWNER_NAME || ""}.${row.TABLE_NAME || ""}`;
        },

        selectScenarioTable(key) {
            this.selectedScenarioTableKey = key || "";
            getContainerEl("#scenarioTablesGrid-M02002")?.querySelectorAll(".scenario-table-row").forEach((row) => {
                row.classList.toggle("is-selected", row.dataset.scenarioTableKey === this.selectedScenarioTableKey);
            });
        },

        getSelectedScenarioTable() {
            return this.scenarioTables.find((row) => this.getScenarioTableKey(row) === this.selectedScenarioTableKey) || null;
        },

        scenarioRowMatchesTable(row, table) {
            if (!row || !table) return false;
            return row.OWNER_NAME === table.OWNER && row.TABLE_NAME === table.TABLE_NAME;
        },

        getSelectedOriginalTableImport() {
            if (!this.selectedTable) return null;
            return this.scenarioTables.find((row) =>
                row.ORIGINAL_OWNER_NAME === this.selectedTable.OWNER
                && row.ORIGINAL_TABLE_NAME === this.selectedTable.TABLE_NAME
                && !this.scenarioRowMatchesTable(row, this.selectedTable)
            ) || null;
        },

        getSelectedRegistration() {
            const registrations = this.getSelectedTableRegistrations();
            if (this.selectedScenarioId) {
                return registrations.find((row) =>
                    String(row.SCENARIO_ID || "") === String(this.selectedScenarioId)
                ) || null;
            }
            return registrations.length === 1 ? registrations[0] : null;
        },

        getSelectedTableRegistrations() {
            if (!this.selectedTable) return [];
            return this.scenarioTables.filter((row) => this.scenarioRowMatchesTable(row, this.selectedTable));
        },

        getScenarioDisplayName(scenarioId) {
            const scenario = this.contextScenarios.find((row) => String(row.SCENARIO_ID || "") === String(scenarioId || ""));
            return scenario?.SCENARIO_NAME || scenario?.SCENARIO_CODE || `시나리오 ID ${scenarioId}`;
        },

        async getSelectedRegistrationFromServer() {
            if (!this.selectedTable || !this.selectedProjectId || !this.selectedScenarioId) return null;
            const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-table/registration`, {
                method: "POST",
                showLoading: false,
                body: {
                    projectId: Number(this.selectedProjectId),
                    scenarioId: Number(this.selectedScenarioId),
                    owner: this.selectedTable.OWNER,
                    tableName: this.selectedTable.TABLE_NAME
                }
            });
            return json?.data ? { ...json.data, SCENARIO_ID: Number(this.selectedScenarioId) } : null;
        },

        isSelectedManagedTable() {
            const tableName = String(this.selectedTable?.TABLE_NAME || "").toUpperCase();
            return tableName.startsWith("INITUP$") || tableName.startsWith("INITDN$");
        },

        getSelectedManagedTableRegistration() {
            if (!this.selectedTable) return null;
            const matches = this.scenarioTables.filter((row) =>
                (row.OWNER_NAME === this.selectedTable.OWNER && row.TABLE_NAME === this.selectedTable.TABLE_NAME)
                || (row.EDIT_OWNER_NAME === this.selectedTable.OWNER && row.EDIT_TABLE_NAME === this.selectedTable.TABLE_NAME)
            );
            if (this.selectedScenarioId) {
                return matches.find((row) => String(row.SCENARIO_ID || "") === String(this.selectedScenarioId)) || null;
            }
            // 전체 시나리오에서는 등록 해제 대상은 특정할 수 없지만, 동일 INITUP$의
            // 원본/수정 테이블 페어 정보는 첫 유효 매핑으로 표시할 수 있습니다.
            return matches[0] || null;
        },

        getSelectedTablePair() {
            const registration = this.getSelectedManagedTableRegistration();
            const selectedName = String(this.selectedTable?.TABLE_NAME || "").toUpperCase();
            const selected = this.selectedTable
                ? { owner: this.selectedTable.OWNER || "", tableName: this.selectedTable.TABLE_NAME || "" }
                : null;
            const source = registration
                ? { owner: registration.OWNER_NAME || "", tableName: registration.TABLE_NAME || "" }
                : (selectedName.startsWith("INITDN$") ? null : selected);
            const edit = registration
                ? { owner: registration.EDIT_OWNER_NAME || "", tableName: registration.EDIT_TABLE_NAME || "" }
                : (selectedName.startsWith("INITDN$") ? selected : null);
            const originalOwner = registration?.ORIGINAL_OWNER_NAME || this.selectedTable?.ORIGINAL_OWNER_NAME || "";
            const originalTable = registration?.ORIGINAL_TABLE_NAME || this.selectedTable?.ORIGINAL_TABLE_NAME || "";
            const originTableId = (registration?.DATA_ORIGIN_TYPE === "DB_TABLE_IMPORT" || originalTable) && originalTable
                ? `${originalOwner ? `${originalOwner}.` : ""}${originalTable}`
                : "";
            const sourceComment = registration?.TABLE_COMMENT || this.selectedTable?.COMMENTS || "";
            const sourceMeta = {
                comment: registration?.SOURCE_TABLE_COMMENT || sourceComment,
                createdAt: registration?.SOURCE_CREATED_AT || this.selectedTable?.CREATED_AT || ""
            };
            const editMeta = {
                comment: registration?.EDIT_TABLE_COMMENT || "",
                createdAt: registration?.EDIT_CREATED_AT || ""
            };
            const originalMeta = {
                comment: registration?.ORIGINAL_TABLE_COMMENT || "",
                createdAt: registration?.ORIGINAL_CREATED_AT || ""
            };
            const originalFile = {
                extension: registration?.ORIGINAL_FILE_EXTENSION || "-",
                name: registration?.ORIGINAL_FILE_NAME || sourceComment || "-",
                size: registration?.ORIGINAL_FILE_SIZE
            };
            return {
                source,
                edit,
                registration,
                originalTarget: originTableId
                    ? { owner: originalOwner, tableName: originalTable }
                    : null,
                isManagedSource: String(source?.tableName || "").toUpperCase().startsWith("INITUP$"),
                sourceMeta,
                editMeta,
                originalMeta,
                originalFile,
                sourceOrigin: originTableId
                    ? `원본 테이블: ${originTableId}`
                    : `원본 파일: ${sourceComment || "-"}`
            };
        },

        selectPairTable(role) {
            const pair = this.getSelectedTablePair();
            const target = role === "edit" ? pair.edit : pair.source;
            if (!target?.owner || !target?.tableName) return;
            this.selectAnalysisTable(target);
        },

        selectOriginalTable() {
            const target = this.getSelectedTablePair().originalTarget;
            if (!target?.owner || !target?.tableName) return;
            this.selectAnalysisTable(target);
        },

        async selectAnalysisTable(target) {
            const current = this.getAnalysisTable();
            if (current?.OWNER === target.owner && current?.TABLE_NAME === target.tableName) return;
            this.analysisTable = { OWNER: target.owner, TABLE_NAME: target.tableName, COMMENTS: "" };
            this.dataGridStateKey = "";
            this.setDefaultSql();
            const exists = await this.loadTableInfo();
            if (!exists) {
                this.analysisTable = null;
                this.setDefaultSql();
                this.renderError(`#${this.activeTab}Grid-M02002`, "선택한 테이블은 아직 생성되지 않았습니다.");
                return;
            }
            await this.loadColumns();
            if (this.activeTab === "data") await this.loadTableData(1, { force: true });
        },

        renderTablePairMeta() {
            const pair = this.getSelectedTablePair();
            ["columns", "data"].forEach((panel) => {
                const container = getContainerEl(`#tablePairMeta-${panel}-M02002`);
                if (!container) return;
                const sourceRow = this.createTablePairMetaRow("source", pair.source, pair.sourceMeta, true, pair.isManagedSource);
                const editRow = this.createTablePairMetaRow("edit", pair.edit, pair.editMeta, false);
                container.innerHTML = panel === "columns"
                    ? [
                        this.createOriginalTableMetaRow(pair.originalTarget, pair.sourceOrigin, pair.originalMeta, pair.originalFile),
                        sourceRow,
                        editRow
                    ].join("")
                    : [sourceRow, editRow].join("");
            });
        },

        createOriginalTableMetaRow(originalTarget, sourceOrigin, originalMeta = {}, originalFile = {}) {
            const isOriginalTable = Boolean(originalTarget?.owner && originalTarget?.tableName);
            const tableButton = isOriginalTable
                ? `<button type="button" class="table-pair-table-button" title="${this.escapeHtml(`${originalTarget.owner}.${originalTarget.tableName}`)}" onclick="M02002.selectOriginalTable()">${this.escapeHtml(originalTarget.tableName)}</button>`
                : `<strong>-</strong>`;
            if (isOriginalTable) return `
                <div class="table-pair-row is-origin">
                    <div class="table-pair-cell"><span>구분</span><strong class="table-pair-role">원본 테이블</strong></div>
                    <div class="table-pair-cell"><span>Owner</span><strong>${this.escapeHtml(originalTarget.owner)}</strong></div>
                    <div class="table-pair-cell"><span>테이블 ID</span>${tableButton}</div>
                    <div class="table-pair-cell table-pair-origin">${this.createTableDetailMarkup(originalMeta)}</div>
                </div>
            `;
            const fileName = String(sourceOrigin || "-").replace(/^원본 파일:\s*/, "") || "-";
            return `
                <div class="table-pair-row is-origin">
                    <div class="table-pair-cell"><span>구분</span><strong class="table-pair-role">원본 파일</strong></div>
                    <div class="table-pair-cell"><span>파일 타입</span><strong>${this.escapeHtml(originalFile.extension || "-")}</strong></div>
                    <div class="table-pair-cell table-pair-origin"><span>파일명</span><strong>${this.escapeHtml(originalFile.name || fileName)}</strong></div>
                    <div class="table-pair-cell"><span>파일 크기</span><strong>${this.escapeHtml(this.formatFileSize(originalFile.size))}</strong></div>
                </div>
            `;
        },

        createTablePairMetaRow(role, target, metadata = {}, isSource, isManagedSource = true) {
            const owner = target?.owner || "-";
            const tableName = target?.tableName || "-";
            const clickable = Boolean(target?.owner && target?.tableName);
            const button = clickable
                ? `<button type="button" class="table-pair-table-button" title="${this.escapeHtml(`${owner}.${tableName}`)}" onclick="M02002.selectPairTable('${role}')">${this.escapeHtml(tableName)}</button>`
                : `<button type="button" class="table-pair-table-button" disabled>-</button>`;
            return `
                <div class="table-pair-row ${isSource ? "is-source" : "is-edit"}">
                    <div class="table-pair-cell"><span>구분</span><strong class="table-pair-role">${isSource ? (isManagedSource ? "기준 테이블 (INITUP$)" : "선택 테이블") : "수정 테이블 (INITDN$)"}</strong></div>
                    <div class="table-pair-cell"><span>Owner</span><strong>${this.escapeHtml(owner)}</strong></div>
                    <div class="table-pair-cell"><span>테이블 ID</span>${button}</div>
                    <div class="table-pair-cell table-pair-origin">${this.createTableDetailMarkup(metadata)}</div>
                </div>
            `;
        },

        createTableDetailMarkup(metadata = {}) {
            return `<strong>테이블명: ${this.escapeHtml(metadata.comment || "-")}<br>생성일시: ${this.escapeHtml(this.formatKstDateTime(metadata.createdAt))}</strong>`;
        },

        formatFileSize(value) {
            const bytes = Number(value);
            if (!Number.isFinite(bytes) || bytes < 0) return "-";
            if (bytes < 1024) return `${bytes} B`;
            const units = ["KB", "MB", "GB", "TB"];
            let size = bytes / 1024;
            let unitIndex = 0;
            while (size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024;
                unitIndex += 1;
            }
            return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
        },

        updateActionButtons() {
            const saveButton = getContainerEl("#saveTableAction-M02002");
            const deleteButton = getContainerEl("#deleteTableAction-M02002");
            const dropManagedButton = getContainerEl("#dropManagedTableAction-M02002");
            const deleteAllButton = getContainerEl("#deleteAllTableAction-M02002");
            const saveIcon = saveButton?.querySelector("i");
            const saveLabel = saveButton?.querySelector("span");
            const deleteLabel = deleteButton?.querySelector("span");
            const dropManagedLabel = dropManagedButton?.querySelector("span");
            const deleteAllLabel = deleteAllButton?.querySelector("span");
            const hasProject = Boolean(this.selectedProjectId);
            const registration = this.getSelectedRegistration();
            const registrationCount = this.getSelectedTableRegistrations().length;
            const isRegistered = registrationCount > 0 || String(this.selectedTable?.IS_REGISTERED || "").toUpperCase() === "Y";
            const originalTableImport = this.getSelectedOriginalTableImport();
            const hasMapping = Boolean(registration?.EDIT_OWNER_NAME && registration?.EDIT_TABLE_NAME);
            const isSelectedManagedTable = this.isSelectedManagedTable();
            const isManagedSource = String(this.selectedTable?.IS_MANAGED_SOURCE || "").toUpperCase() === "Y";

            let primaryLabel = this.t("saveOrImport", "Save / Import");
            let primaryIconClass = "fas fa-save";
            let primaryTitle = this.t("selectTableAndScenario", "Select a table and scenario.");
            let primaryEnabled = false;
            if (this.selectedTable && hasProject) {
                if (!this.selectedScenarioId) {
                    primaryTitle = "저장할 시나리오를 선택하세요.";
                    primaryEnabled = true;
                } else if (registration && hasMapping) {
                    primaryLabel = this.t("alreadySaved", "Saved");
                    primaryIconClass = "fas fa-check";
                    primaryTitle = this.t("alreadySavedTitle", "This table is already saved.");
                } else if (registration) {
                    primaryLabel = this.t("createSnapshotAndConvert", "Create snapshot and convert");
                    primaryIconClass = "fas fa-arrows-rotate";
                    primaryTitle = this.t("createSnapshotAndConvertTitle", "Convert the direct registration to a managed snapshot.");
                    primaryEnabled = true;
                } else if (originalTableImport) {
                    primaryLabel = "가져오기 완료";
                    primaryIconClass = "fas fa-check";
                    primaryTitle = `이 원본 테이블은 ${originalTableImport.OWNER_NAME}.${originalTableImport.TABLE_NAME} 관리 테이블로 이미 가져왔습니다.`;
                } else if (isManagedSource) {
                    primaryLabel = this.t("saveTable", "Save");
                    primaryTitle = this.t("saveManagedTableTitle", "Save this managed INITUP$ table to the scenario.");
                    primaryEnabled = true;
                } else {
                    primaryLabel = this.t("createAndSave", "Create and save");
                    primaryIconClass = "fas fa-database";
                    primaryTitle = this.t("createAndSaveTitle", "Create an INITUP$ snapshot and save it to the scenario.");
                    primaryEnabled = true;
                }
            }

            if (saveLabel) saveLabel.textContent = primaryLabel;
            if (saveIcon) saveIcon.className = primaryIconClass;
            if (saveButton) {
                saveButton.disabled = !primaryEnabled;
                saveButton.title = primaryTitle;
            }
            if (deleteLabel) deleteLabel.textContent = this.t("unregister", "Unregister");
            if (deleteButton) {
                deleteButton.disabled = !(hasProject && isRegistered);
                deleteButton.title = registration
                    ? this.t("unregisterTitle", "Remove only the scenario registration. The DB table is not dropped.")
                    : (originalTableImport
                        ? "원본 테이블은 등록 대상이 아닙니다. 복제된 INITUP$ 관리 테이블을 선택하세요."
                        : (!this.selectedScenarioId && registrationCount > 1
                        ? "여러 시나리오에 등록되어 있습니다. 해제할 시나리오를 선택하세요."
                        : this.t("unregisterTitle", "Remove only the scenario registration. The DB table is not dropped.")));
            }
            if (dropManagedLabel) dropManagedLabel.textContent = this.t("dropManagedTables", "Delete physical table");
            if (dropManagedButton) {
                dropManagedButton.hidden = !isSelectedManagedTable;
                dropManagedButton.disabled = !hasProject;
                dropManagedButton.title = "선택한 INITUP$ 또는 INITDN$ 물리 테이블만 영구 삭제합니다.";
            }
            if (deleteAllLabel) deleteAllLabel.textContent = this.t("unregisterAll", "Unregister all");
            if (deleteAllButton) {
                deleteAllButton.title = this.selectedScenarioId
                    ? this.t("unregisterAllTitle", "Remove all table registrations from the scenario. DB tables are not dropped.")
                    : "등록을 해제할 시나리오를 선택하세요.";
                deleteAllButton.disabled = !hasProject;
            }
        },

        updateScenarioTableComment(key, value) {
            const row = this.scenarioTables.find((item) => this.getScenarioTableKey(item) === key);
            if (!row) return;
            row.TABLE_COMMENT = value;
            this.selectScenarioTable(key);
        },

        moveSelectedTableToScenario() {
            if (!this.ensureWorkContextSelected()) return;
            if (!this.selectedTable) {
                alert("Select a table from Table Explorer first.");
                return;
            }

            const exists = this.scenarioTables.find((row) =>
                this.scenarioRowMatchesTable(row, this.selectedTable)
            );
            if (exists) {
                this.selectedScenarioTableKey = this.getScenarioTableKey(exists);
                this.renderScenarioTables();
                return;
            }

            const pending = {
                SCENARIO_TABLE_ID: null,
                PROJECT_ID: Number(this.selectedProjectId),
                SCENARIO_ID: Number(this.selectedScenarioId),
                OWNER_NAME: this.selectedTable.OWNER,
                TABLE_NAME: this.selectedTable.TABLE_NAME,
                TABLE_COMMENT: this.selectedTable.COMMENTS || "",
                USE_YN: "Y",
                SORT_ORDER: this.scenarioTables.length + 1,
                _PENDING: true
            };
            this.scenarioTables = [...this.scenarioTables, pending];
            this.selectedScenarioTableKey = this.getScenarioTableKey(pending);
            this.renderScenarioTables();
        },

        async saveScenarioTable() {
            if (!this.ensureWorkContextSelected()) return;

            const selectedTable = this.selectedTable;
            const row = this.getSelectedRegistration()
                || (selectedTable ? {
                    PROJECT_ID: Number(this.selectedProjectId),
                    SCENARIO_ID: Number(this.selectedScenarioId),
                    OWNER_NAME: selectedTable.OWNER,
                    TABLE_NAME: selectedTable.TABLE_NAME,
                    TABLE_COMMENT: selectedTable.COMMENTS || "",
                    USE_YN: "Y",
                    SORT_ORDER: this.scenarioTables.length + 1
                } : null);
            if (!row) {
                alert("Select a table from Table Explorer first.");
                return;
            }
            if (
                (!row.SCENARIO_TABLE_ID || !row.EDIT_TABLE_NAME)
                && !(await CommonMessage.confirm(
                    `"${row.OWNER_NAME}.${row.TABLE_NAME}" 테이블을 대상 데이터로 저장하시겠습니까?\n`
                    + "일반 DB 테이블은 FILE_ROW_NO가 추가된 관리 스냅샷으로 가져옵니다.\n"
                    + "스냅샷 ID 규칙: INITUP$_{PROJECT_CODE}_DB_{TIME}"
                ))
            ) {
                return;
            }

            const payload = {
                scenarioTableId: row.SCENARIO_TABLE_ID || null,
                projectId: Number(this.selectedProjectId),
                scenarioId: Number(this.selectedScenarioId),
                ownerName: row.OWNER_NAME,
                tableName: row.TABLE_NAME,
                tableComment: row.TABLE_COMMENT || "",
                useYn: row.USE_YN || "Y",
                sortOrder: row.SORT_ORDER ?? null
            };

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-table/save`, {
                    method: "POST",
                    body: payload
                });
                this.scenarioTables = Array.isArray(json.list) ? json.list : [];
                const saved = json.data || {};
                this.selectedScenarioTableKey = saved.SCENARIO_TABLE_ID ? `ID:${saved.SCENARIO_TABLE_ID}` : "";
                await this.loadTableTree();
                alert(json.message || "Scenario table saved.");
            } catch (error) {
                alert(error.message || "Scenario table save failed.");
            }
        },

        async deleteScenarioTable() {
            if (!this.ensureProjectSelected()) return;

            let row = this.getSelectedRegistration()
                || (!this.selectedScenarioId ? this.getSelectedManagedTableRegistration() : null);
            if (!row && String(this.selectedTable?.IS_REGISTERED || "").toUpperCase() === "Y") {
                await this.loadScenarioTables();
                row = this.getSelectedRegistration()
                    || (!this.selectedScenarioId ? this.getSelectedManagedTableRegistration() : null);
            }
            if (!row && this.selectedScenarioId && String(this.selectedTable?.IS_REGISTERED || "").toUpperCase() === "Y") {
                try {
                    row = await this.getSelectedRegistrationFromServer();
                } catch (error) {
                    console.warn("[M02002] registration lookup failed", error);
                }
            }
            if (!row) {
                const registrationCount = this.getSelectedTableRegistrations().length;
                if (!this.selectedTable) {
                    alert("테이블 탐색에서 테이블을 먼저 선택하세요.");
                } else if (!this.selectedScenarioId && registrationCount > 1) {
                    alert("여러 시나리오에 등록되어 있습니다. 해제할 시나리오를 선택하세요.");
                    getContainerEl("#contextScenario-M02002")?.focus();
                } else if (!this.selectedScenarioId) {
                    alert("등록 해제할 시나리오를 선택하세요.");
                    getContainerEl("#contextScenario-M02002")?.focus();
                } else {
                    alert("선택한 테이블은 현재 시나리오에 등록되어 있지 않습니다.");
                }
                return;
            }

            if (row._PENDING || !row.SCENARIO_TABLE_ID) {
                this.scenarioTables = this.scenarioTables.filter((item) => item !== row);
                this.selectedScenarioTableKey = "";
                return;
            }

            const selectedTableName = `${this.selectedTable?.OWNER || row.OWNER_NAME}.${this.selectedTable?.TABLE_NAME || row.TABLE_NAME}`;
            if (!(await CommonMessage.confirm(
                `"${selectedTableName}" 테이블의 시나리오 등록을 해제하시겠습니까?\n`
                + `대상 시나리오: ${this.getScenarioDisplayName(row.SCENARIO_ID)}\n`
                + "실제 DB 테이블은 삭제되지 않습니다."
            ))) {
                return;
            }

            try {
                await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-table/delete`, {
                    method: "POST",
                    body: {
                        scenarioTableId: row.SCENARIO_TABLE_ID,
                        projectId: Number(this.selectedProjectId),
                        scenarioId: Number(row.SCENARIO_ID)
                    }
                });
                this.scenarioTables = this.scenarioTables.filter((item) => item !== row);
                this.selectedScenarioTableKey = "";
                await this.loadTableTree();
                alert("테이블 등록을 해제했습니다.");
            } catch (error) {
                alert(error.message || "테이블 등록 해제에 실패했습니다.");
            }
        },

        async deleteAllScenarioTables() {
            if (!this.ensureProjectSelected()) return;
            if (!this.selectedScenarioId) {
                alert("등록을 해제할 시나리오를 선택하세요.");
                getContainerEl("#contextScenario-M02002")?.focus();
                return;
            }

            if (!this.scenarioTables.length) {
                alert("등록 해제할 테이블이 없습니다.");
                return;
            }

            if (!(await CommonMessage.confirm(
                "이 시나리오에 등록된 모든 테이블을 등록 해제하시겠습니까?\n"
                + "실제 DB 테이블은 삭제되지 않습니다."
            ))) {
                return;
            }

            try {
                const result = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-table/delete-all`, {
                    method: "POST",
                    body: {
                        projectId: Number(this.selectedProjectId),
                        scenarioId: Number(this.selectedScenarioId)
                    }
                });
                this.scenarioTables = [];
                this.selectedScenarioTableKey = "";
                await this.loadTableTree();
                alert(`${result.deletedCount ?? 0}건의 테이블 등록을 해제했습니다.`);
            } catch (error) {
                alert(error.message || "테이블 전체 등록 해제에 실패했습니다.");
            }
        },

        async dropManagedScenarioTable() {
            if (!this.ensureProjectSelected()) return;
            if (!this.selectedScenarioId) {
                alert("물리 테이블을 삭제할 시나리오를 선택하세요.");
                getContainerEl("#contextScenario-M02002")?.focus();
                return;
            }
            if (!this.isSelectedManagedTable()) {
                alert("물리 테이블 삭제는 테이블 탐색에서 INITUP$ 또는 INITDN$ 테이블을 선택했을 때만 사용할 수 있습니다.");
                return;
            }

            const pair = this.getSelectedTablePair();
            const selectedName = `${this.selectedTable.OWNER}.${this.selectedTable.TABLE_NAME}`;
            const hasManagedPair = Boolean(pair.registration && pair.source?.tableName && pair.edit?.tableName);

            if (!(await CommonMessage.confirm(
                hasManagedPair
                    ? `물리 테이블 쌍을 완전히 삭제하시겠습니까?\n\nINITUP$: ${pair.source.owner}.${pair.source.tableName}\nINITDN$: ${pair.edit.owner}.${pair.edit.tableName}\n\n등록 정보도 함께 해제되며 복구할 수 없습니다.`
                    : `물리 테이블을 완전히 삭제하시겠습니까?\n\n대상: ${selectedName}\n\n연결된 INITDN$ 정보를 찾을 수 없어 선택한 테이블만 삭제됩니다. 복구할 수 없습니다.`
            ))) {
                return;
            }
            const confirmationTableName = hasManagedPair ? pair.source.tableName : this.selectedTable.TABLE_NAME;
            const confirmation = await CommonMessage.prompt(
                `삭제하려면 물리 테이블 ID를 입력하세요.\n${confirmationTableName}`,
                {
                    title: this.t("dropManagedTables", "Delete physical table"),
                    input: {
                        ariaLabel: "물리 테이블 ID",
                        placeholder: confirmationTableName
                    }
                }
            );
            if (String(confirmation || "").trim().toUpperCase() !== String(confirmationTableName || "").toUpperCase()) {
                alert("테이블 ID가 일치하지 않아 삭제를 취소했습니다.");
                return;
            }

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-table/drop-managed`, {
                    method: "POST",
                    body: {
                        projectId: Number(this.selectedProjectId),
                        scenarioId: Number(this.selectedScenarioId),
                        ownerName: this.selectedTable.OWNER,
                        tableName: this.selectedTable.TABLE_NAME
                    }
                });
                this.applyDroppedTableResult(json);
                this.resetTableAnalysis();
                alert(this.t("physicalTableDeleted", "Physical table deleted."));
            } catch (error) {
                alert(error.message || "물리 테이블 삭제에 실패했습니다.");
            }
        },

        applyDroppedTableResult(result = {}) {
            const droppedKeys = new Set(
                (Array.isArray(result.droppedTables) ? result.droppedTables : [])
                    .map((value) => String(value || "").trim().toUpperCase())
                    .filter(Boolean)
            );
            if (!droppedKeys.size) return;

            const tableKey = (owner, tableName) => `${owner || ""}.${tableName || ""}`.toUpperCase();
            this.tables = this.tables.filter((row) => !droppedKeys.has(tableKey(row.OWNER, row.TABLE_NAME)));
            this.displayedTables = this.tables;
            this.scenarioTables = this.scenarioTables.filter((row) =>
                !droppedKeys.has(tableKey(row.OWNER_NAME, row.TABLE_NAME))
                && !droppedKeys.has(tableKey(row.EDIT_OWNER_NAME, row.EDIT_TABLE_NAME))
            );
            this.selectedScenarioTableKey = "";
            this.focusedTableKey = "";
            this.renderTableTree();
            this.updateActionButtons();
        },

        async loadTableTree(reset = true) {
            const container = getContainerEl("#tableTree-M02002");
            if (!container) return;
            if (this.tableTreeLoading && !reset) return;

            const keyword = this.tableSearchMode ? (getContainerEl("#tableSearch-M02002")?.value || "").trim() : "";
            const registeredOnly = this.isRegisteredOnly();
            const offset = reset ? 0 : this.tableTreeNextOffset;
            const requestVersion = ++this.tableTreeRequestVersion;
            this.tableTreeLoading = true;
            if (reset) {
                container.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingTables", "Loading tables..."))}</div>`;
                this.tables = [];
                this.displayedTables = [];
                this.tableTreeHasMore = false;
                this.tableTreeNextOffset = 0;
            }
            try {
                const params = new URLSearchParams({
                    keyword,
                    offset: String(offset),
                    limit: String(TREE_PAGE_SIZE),
                    registeredOnly: registeredOnly ? "Y" : "N"
                });
                if (this.selectedProjectId) {
                    params.set("projectId", this.selectedProjectId);
                    if (this.selectedScenarioId) params.set("scenarioId", this.selectedScenarioId);
                }
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/table-tree?${params.toString()}`, { method: "GET", showLoading: false });
                if (requestVersion !== this.tableTreeRequestVersion) return;
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || this.t("tableListLoadFailed", "Table list load failed."));
                }
                const rows = Array.isArray(json.data) ? json.data : [];
                this.tables = reset ? rows : this.tables.concat(rows);
                this.displayedTables = this.tables;
                if (this.selectedTable) {
                    const selectedKey = this.getSelectedTableKey();
                    this.selectedTable = this.tables.find((row) =>
                        `${row.OWNER}.${row.TABLE_NAME}` === selectedKey
                    ) || this.selectedTable;
                }
                this.tableTreeHasMore = Boolean(json.hasMore);
                this.tableTreeNextOffset = Number(json.nextOffset || this.tables.length);
                this.renderTableTree();
                this.updateActionButtons();
            } catch (error) {
                if (requestVersion !== this.tableTreeRequestVersion) return;
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message)}</div>`;
            } finally {
                if (requestVersion === this.tableTreeRequestVersion) this.tableTreeLoading = false;
            }
        },

        renderTableTree() {
            const container = getContainerEl("#tableTree-M02002");
            if (!container) return;

            const rows = this.tables;
            this.displayedTables = rows;

            if (rows.length === 0) {
                container.innerHTML = `
                    <div class="table-empty">${this.escapeHtml(this.t("noTablesFound", "No tables found."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `
                <div class="table-tree-scroll-body">
                    <div class="table-tree-head">
                        <div>Table</div>
                        <div>Owner</div>
                    </div>
                    ${rows.map((row) => this.createTableRow(row)).join("")}
                    ${this.tableTreeHasMore ? this.createTableLoadMoreRow() : ""}
                </div>
                ${this.renderListFooter(rows.length)}
            `;
        },

        createTableRow(row) {
            const key = `${row.OWNER}.${row.TABLE_NAME}`;
            const selectedKey = this.selectedTable ? `${this.selectedTable.OWNER}.${this.selectedTable.TABLE_NAME}` : "";
            const selectedClass = key === (this.focusedTableKey || selectedKey) ? "is-selected" : "";
            const comment = row.COMMENTS || "";
            const registeredIcon = this.getRegisteredTableIcon(row);
            return `
                <button type="button" class="table-tree-row ${selectedClass}" data-table-key="${this.escapeHtml(key)}" onclick="M02002.selectTable('${this.escapeJs(row.OWNER)}', '${this.escapeJs(row.TABLE_NAME)}')">
                    <span class="table-tree-name" title="${this.escapeHtml(comment || row.TABLE_NAME)}">
                        <span class="table-tree-physical">
                            <i class="fas fa-table"></i>
                            ${registeredIcon}
                            <span>${this.escapeHtml(row.TABLE_NAME)}</span>
                        </span>
                        <span class="table-tree-comment">${this.escapeHtml(comment || "-")}</span>
                    </span>
                    <span class="table-tree-muted">${this.escapeHtml(row.OWNER)}</span>
                </button>
            `;
        },

        getRegisteredTableIcon(row) {
            if (String(row?.IS_REGISTERED || "").toUpperCase() !== "Y") return "";
            return `<i class="fas fa-circle-check table-tree-registered-icon" title="${this.escapeHtml(this.t("registeredTable", "Registered table"))}"></i>`;
        },

        createTableLoadMoreRow() {
            return `
                <button type="button" class="table-tree-row" onclick="M02002.loadMoreTables()">
                    <span class="table-tree-name">
                        <span class="table-tree-physical">
                            <i class="fas fa-ellipsis-h"></i>
                            <span>${this.escapeHtml(this.tableTreeLoading ? this.t("loadingMore", "Loading more...") : this.t("loadMore", "Load more..."))}</span>
                        </span>
                        <span class="table-tree-comment">Next ${TREE_PAGE_SIZE} tables</span>
                    </span>
                    <span class="table-tree-muted">MORE</span>
                </button>
            `;
        },

        async loadMoreTables() {
            const scrollTop = this.getTableTreeScrollTop();
            await this.loadTableTree(false);
            this.restoreTableTreeScroll(scrollTop);
        },

        handleTableSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.tableSearchMode = true;
            this.focusedTableKey = "";
            this.loadTableTree(true);
        },

        searchTable(direction = "down") {
            const input = getContainerEl("#tableSearch-M02002");
            const keyword = (input?.value || "").trim().toLowerCase();
            if (!keyword) {
                this.renderTableTree();
                return;
            }

            if (this.isTableSearchFilterEnabled()) {
                this.renderTableTree();
            }

            const matches = this.isTableSearchFilterEnabled()
                ? this.displayedTables
                : this.tables.filter((row) => this.isTableSearchMatch(row, keyword));
            const next = this.findNextTableMatch(matches, direction);
            if (!next) {
                input?.focus();
                return;
            }

            this.focusedTableKey = `${next.OWNER}.${next.TABLE_NAME}`;
            this.renderTableTree();
            this.scrollToTableRow(this.focusedTableKey);
        },

        findNextTableMatch(matches, direction = "down") {
            if (!matches.length) return null;
            const isUp = direction === "up";
            const currentKey = this.focusedTableKey || (this.selectedTable ? `${this.selectedTable.OWNER}.${this.selectedTable.TABLE_NAME}` : "");
            const currentIndex = matches.findIndex((row) => `${row.OWNER}.${row.TABLE_NAME}` === currentKey);
            let nextIndex = isUp ? currentIndex - 1 : currentIndex + 1;
            if (currentIndex < 0) {
                nextIndex = isUp ? matches.length - 1 : 0;
            }
            if (nextIndex < 0) nextIndex = matches.length - 1;
            if (nextIndex >= matches.length) nextIndex = 0;
            return matches[nextIndex] || null;
        },

        isTableSearchMatch(row, keyword) {
            const tableName = String(row.TABLE_NAME || "").toLowerCase();
            const owner = String(row.OWNER || "").toLowerCase();
            return tableName.includes(keyword) || owner.includes(keyword);
        },

        isTableSearchFilterEnabled() {
            return Boolean(getContainerEl("#tableSearchFilter-M02002")?.checked);
        },

        handleTableSearchInput() {
            const keyword = (getContainerEl("#tableSearch-M02002")?.value || "").trim();
            if (!keyword && this.tableSearchMode) {
                this.tableSearchMode = false;
                this.focusedTableKey = "";
                this.loadTableTree(true);
            }
        },

        isRegisteredOnly() {
            return Boolean(getContainerEl("#registeredOnly-M02002")?.checked);
        },

        ensureProjectSelected() {
            if (this.selectedProjectId) return true;
            alert("Project is required.");
            getContainerEl("#contextProject-M02002")?.focus();
            return false;
        },

        handleRegisteredOnlyChange() {
            const checkbox = getContainerEl("#registeredOnly-M02002");
            if (checkbox?.checked && !this.ensureProjectSelected()) {
                checkbox.checked = false;
                return;
            }
            this.focusedTableKey = "";
            this.loadTableTree(true);
        },

        handleTableSearchFilterChange() {
            this.focusedTableKey = "";
            this.renderTableTree();
        },

        scrollToTableRow(tableKey) {
            const container = getContainerEl("#tableTree-M02002");
            const target = Array.from(container?.querySelectorAll(".table-tree-row[data-table-key]") || [])
                .find((row) => row.dataset.tableKey === tableKey);
            if (!target) return;
            target.scrollIntoView({ block: "center" });
            target.focus();
        },

        getTableTreeScrollTop() {
            return getContainerEl("#tableTree-M02002 .table-tree-scroll-body")?.scrollTop || 0;
        },

        restoreTableTreeScroll(scrollTop) {
            window.requestAnimationFrame(() => {
                const container = getContainerEl("#tableTree-M02002 .table-tree-scroll-body");
                if (container) container.scrollTop = scrollTop;
            });
        },

        async selectTable(owner, tableName) {
            const previousTableKey = this.getSelectedTableKey();
            const table = this.tables.find((row) => row.OWNER === owner && row.TABLE_NAME === tableName);
            this.selectedTable = table || { OWNER: owner, TABLE_NAME: tableName, COMMENTS: "" };
            this.analysisTable = null;
            if (previousTableKey !== this.getSelectedTableKey()) this.dataGridStateKey = "";
            this.focusedTableKey = `${owner}.${tableName}`;
            this.renderTableTree();
            this.updateSelectedMeta();
            this.updateActionButtons();
            this.setDefaultSql();
            await Promise.all([
                this.loadTableInfo(),
                this.loadColumns()
            ]);
            if (this.activeTab === "data") {
                await this.loadTableData(1, { force: true });
            }
        },

        updateSelectedMeta() {
            const pair = this.getSelectedTablePair();
            this.renderTablePairMeta();
            const desc = pair.source?.owner && pair.source?.tableName
                ? `${pair.source.owner}.${pair.source.tableName}${pair.edit?.tableName ? ` ↔ ${pair.edit.owner}.${pair.edit.tableName}` : ""}`
                : this.t("selectTableFromExplorer", "Select a table from the explorer.");
            this.setText("#tableDescription-M02002", desc);
        },

        resetTableAnalysis() {
            this.selectedTable = null;
            this.analysisTable = null;
            this.focusedTableKey = "";
            this.selectedCell = null;
            this.gridData = { columns: [], data: [], sql: [] };
            this.gridPages = { data: 1, sql: 1 };
            this.gridTotals = { data: 0, sql: 0 };
            this.gridTotalPages = { data: 1, sql: 1 };
            this.dataGridStateKey = "";
            this.sqlGridText = "";
            this.updateSelectedMeta();
            this.updateActionButtons();
            const emptyMessage = this.escapeHtml(this.t("selectTableFirst", "Select a table first."));
            ["columns", "data", "sql"].forEach((gridKey) => {
                const grid = getContainerEl(`#${gridKey}Grid-M02002`);
                if (grid) grid.innerHTML = `<div class="table-empty">${emptyMessage}</div>`;
                const pager = getContainerEl(`#${gridKey}GridPager-M02002`);
                if (pager) {
                    pager.innerHTML = "";
                    pager.hidden = true;
                }
            });
            this.renderColumnsGridToolbar(0);
            this.renderDataGridMessage("");
            this.renderSqlMessage("");
            const editor = getContainerEl("#sqlEditor-M02002");
            if (editor) editor.value = "";
        },

        switchTab(tabName) {
            this.activeTab = tabName;
            getContainerEl(".table-tabs")?.querySelectorAll(".table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.tab === tabName);
            });
            getContainerEl(".table-panel")?.querySelectorAll(".table-tab-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.panel === tabName);
            });

            if (!this.selectedTable) return;
            if (tabName === "data" && !this.isDataGridCurrent()) {
                this.loadTableData();
            }
            if (tabName === "sql" && !getContainerEl("#sqlEditor-M02002")?.value.trim()) {
                this.setDefaultSql();
            }
        },

        async loadTableInfo() {
            if (!this.ensureSelectedTable()) return false;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/table-info`, {
                    method: "POST",
                    showLoading: false,
                    body: this.getSelectedPayload()
                });
                if (json.data && Object.keys(json.data).length) {
                    this.analysisTable = {
                        ...this.getAnalysisTable(),
                        ...json.data
                    };
                    return true;
                }
                return false;
            } catch (error) {
                console.warn("[M02002] table info load failed", error);
                return false;
            }
        },

        async loadColumns() {
            if (!this.ensureSelectedTable()) return;
            const grid = getContainerEl("#columnsGrid-M02002");
            if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingColumns", "Loading columns..."))}</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/columns`, {
                    method: "POST",
                    showLoading: false,
                    body: this.getSelectedPayload()
                });
                this.renderGrid("#columnsGrid-M02002", json.data || [], "columns", json.columns || []);
                this.renderColumnsGridToolbar(json.total || (json.data || []).length);
            } catch (error) {
                this.renderError("#columnsGrid-M02002", error.message);
            }
        },

        async loadTableData(page = 1, options = {}) {
            if (!this.ensureSelectedTable()) return;
            const limit = this.gridPageSizes.data || 100;
            const gridStateKey = this.getDataGridStateKey(limit);
            if (!options.force && this.dataGridStateKey === gridStateKey) return;
            const grid = getContainerEl("#dataGrid-M02002");
            if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingData", "Loading data..."))}</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data`, {
                    method: "POST",
                    showLoading: false,
                body: { ...this.getSelectedPayload(), limit, page }
                });
                this.gridPages.data = Number(json.page || page);
                this.gridPageSizes.data = Number(json.pageSize || limit);
                this.gridTotals.data = Number(json.total || 0);
                this.gridTotalPages.data = Number(json.totalPages || 1);
                this.renderGrid("#dataGrid-M02002", json.data || [], "data", json.columns || []);
                this.renderGridPager("data");
                this.renderDataGridMessage(`${(json.data || []).length.toLocaleString()} rows selected.`);
                this.dataGridStateKey = gridStateKey;
            } catch (error) {
                this.dataGridStateKey = "";
                this.renderError("#dataGrid-M02002", error.message);
            }
        },

        async executeSql(page = 1, sqlOverride = "") {
            const executable = this.getExecutableSqlFromEditor();
            if (!executable.sql) {
                this.renderSqlMessage(this.t("noSqlAtCursor", "No SQL statement found at the cursor."), "error");
                this.renderError("#sqlGrid-M02002", this.t("noSqlAtCursor", "No SQL statement found at the cursor."));
                return;
            }
            const sql = sqlOverride || executable.sql;
            if (!this.validateSelectSql(sql)) {
                this.renderSqlMessage("Only a single SELECT statement is allowed.", "error");
                this.renderError("#sqlGrid-M02002", "Only a single SELECT statement is allowed.");
                this.restoreSqlSelection(executable);
                return;
            }

            this.restoreSqlSelection(executable);
            const limit = this.gridPageSizes.sql || 100;
            const grid = getContainerEl("#sqlGrid-M02002");
            const startedAt = performance.now();
            this.renderSqlMessage("Running SQL...", "info");
            if (grid) grid.innerHTML = `<div class="table-empty">Running SQL...</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql`, {
                    method: "POST",
                    showLoading: false,
                body: { sql, limit, page }
                });
                const elapsedMs = Math.round(performance.now() - startedAt);
                const rowCount = Array.isArray(json.data) ? json.data.length : 0;
                this.renderSqlMessage(`${rowCount.toLocaleString()} rows selected. (${elapsedMs.toLocaleString()} ms)`, "success");
                this.sqlGridText = sql;
                this.gridPages.sql = Number(json.page || page);
                this.gridPageSizes.sql = Number(json.pageSize || limit);
                this.gridTotals.sql = Number(json.total || 0);
                this.gridTotalPages.sql = Number(json.totalPages || 1);
                this.renderGrid("#sqlGrid-M02002", json.data || [], "sql", json.columns || []);
                this.renderGridPager("sql");
            } catch (error) {
                const elapsedMs = Math.round(performance.now() - startedAt);
                this.renderSqlMessage(`${error.message || "SQL execution failed."} (${elapsedMs.toLocaleString()} ms)`, "error");
                this.renderError("#sqlGrid-M02002", error.message);
            } finally {
                this.restoreSqlSelection(executable);
            }
        },

        renderSqlMessage(message, type = "info") {
            const element = getContainerEl("#sqlMessage-M02002");
            if (!element) return;
            element.className = type === "error" ? "table-error" : "table-empty";
            element.textContent = message || "";
            element.hidden = !message;
        },

        renderDataGridMessage(message) {
            const element = getContainerEl("#dataGridMessage-M02002");
            if (element) element.textContent = message || "";
        },

        renderColumnsGridToolbar(total) {
            const message = getContainerEl("#columnsGridMessage-M02002");
            if (message) message.textContent = this.formatGridTotal(total);
            const controls = getContainerEl("#columnsGridControls-M02002");
            if (controls) controls.innerHTML = `<label class="table-limit-control grid-pager-number-control" title="${this.escapeHtml(this.t("freezeColumnsTitle", "Freeze No and selected data columns while scrolling horizontally."))}"><span>${this.escapeHtml(this.t("freezeColumns", "Freeze"))}</span><input type="number" min="0" max="50" value="${this.gridFrozenColumns.columns || 0}" oninput="M02002.setGridFreeze('columns', this.value)"></label>`;
        },

        renderGridPager(gridKey) {
            const host = getContainerEl(`#${gridKey}GridPager-M02002`);
            if (!host) return;
            CommonUtils.renderServerPager(host, {
                visible: true, page: this.gridPages[gridKey], pageSize: this.gridPageSizes[gridKey], totalPages: this.gridTotalPages[gridKey],
                totalLabel: this.formatGridTotal(this.gridTotals[gridKey]),
                labels: { page: "Page", go: "Go", previousPage: "Previous page", nextPage: "Next page", rowsPerPage: "Rows per page" },
                onMove: (delta) => this.loadGridPage(gridKey, this.gridPages[gridKey] + delta),
                onGo: (value) => this.loadGridPage(gridKey, value),
                onPageSize: (value) => { this.gridPageSizes[gridKey] = Number(value || 100); this.loadGridPage(gridKey, 1); },
                trailingNumberControl: { label: this.t("freezeColumns", "Freeze"), title: this.t("freezeColumnsTitle", "Freeze No and selected data columns while scrolling horizontally."), value: this.gridFrozenColumns[gridKey] || 0, min: 0, max: 50, onInput: (value) => this.setGridFreeze(gridKey, value) }
            });
        },

        formatGridTotal(total) {
            return this.t("gridTotal", "Total {count}").replace("{count}", Number(total || 0).toLocaleString());
        },

        loadGridPage(gridKey, page) {
            const next = Math.max(1, Math.min(Number(this.gridTotalPages[gridKey] || 1), Number(page || 1)));
            if (gridKey === "data") return this.loadTableData(next, { force: true });
            return this.executeSql(next, this.sqlGridText);
        },

        setGridFreeze(gridKey, value) {
            this.gridFrozenColumns[gridKey] = Math.max(0, Number.parseInt(value || 0, 10) || 0);
            this.applyGridFrozenColumns(gridKey);
        },

        handleSqlEditorKeydown(event) {
            if (!(event.ctrlKey && event.key === "Enter")) return;
            event.preventDefault();
            this.executeSql();
        },

        getExecutableSqlFromEditor() {
            const editor = getContainerEl("#sqlEditor-M02002");
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

        restoreSqlSelection(selection) {
            const editor = getContainerEl("#sqlEditor-M02002");
            if (!editor || !selection) return;
            editor.focus();
            editor.setSelectionRange(selection.selectionStart, selection.selectionEnd);
        },

        setDefaultSql() {
            const editor = getContainerEl("#sqlEditor-M02002");
            if (!editor) return;
            const pair = this.getSelectedTablePair();
            const targets = [pair.originalTarget, pair.source, pair.edit]
                .filter((target) => target?.owner && target?.tableName)
                .filter((target, index, items) => items.findIndex((item) =>
                    item.owner === target.owner && item.tableName === target.tableName
                ) === index);
            const statements = targets
                .map((target) => `SELECT *\n  FROM ${this.quoteName(target.owner)}.${this.quoteName(target.tableName)};`);
            editor.value = statements.join("\n\n");
        },

        validateSelectSql(sql) {
            const text = sql.trim().replace(/;+\s*$/, "");
            if (!/^(select|with)\b/i.test(text)) return false;
            return !/;\s*\S/.test(sql);
        },

        quoteName(name) {
            return `"${String(name || "").replace(/"/g, "\"\"")}"`;
        },

        renderGrid(selector, rows, gridKey, columnNames = []) {
            const container = getContainerEl(selector);
            if (!container) return;
            this.gridData[gridKey] = Array.isArray(rows) ? rows : [];
            this.selectedCell = null;
            const columns = Array.isArray(columnNames) && columnNames.length
                ? columnNames
                : Object.keys(rows?.[0] || {});
            const visibleColumns = this.getVisibleGridColumns(gridKey, columns);
            this.columnWidths[gridKey] = this.normalizeColumnWidths(gridKey, visibleColumns);
            if (!Array.isArray(rows) || rows.length === 0) {
                if (visibleColumns.length) {
                    const tableMarkup = `
                        <table class="table-grid" data-grid-key="${gridKey}">
                            <colgroup>
                                <col class="grid-row-no-col">
                                ${visibleColumns.map((_, index) => `<col style="width: ${this.columnWidths[gridKey][index]}px">`).join("")}
                            </colgroup>
                            <thead>
                                <tr>
                                    <th class="grid-row-no" title="No">No</th>
                                    ${visibleColumns.map((column, index) => `
                                        <th class="is-resizable" title="${this.escapeHtml(column)}">
                                            <span class="table-th-content">${this.escapeHtml(column)}</span>
                                        </th>
                                    `).join("")}
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    `;
                    const footerMarkup = "";
                    container.innerHTML = `<div class="table-grid-scroll">${tableMarkup}</div>${footerMarkup}`;
                    this.enableSharedGridResize(gridKey);
                    this.applyGridFrozenColumns(gridKey);
                    return;
                }
                const footerMarkup = "";
                container.innerHTML = `
                    <div class="table-grid-scroll">
                        <div class="table-empty">${this.escapeHtml(this.t("noData", "No data."))}</div>
                    </div>
                    ${footerMarkup}
                `;
                return;
            }

            const tableMarkup = `
                <table class="table-grid" data-grid-key="${gridKey}">
                    <colgroup>
                        <col class="grid-row-no-col">
                        ${visibleColumns.map((_, index) => `<col style="width: ${this.columnWidths[gridKey][index]}px">`).join("")}
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="grid-row-no" title="No">No</th>
                            ${visibleColumns.map((column, index) => `
                                <th class="is-resizable" title="${this.escapeHtml(column)}">
                                    <span class="table-th-content">${this.escapeHtml(column)}</span>
                                </th>
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${this.getGridRowNumber(gridKey, rowIndex)}</td>
                                ${visibleColumns.map((column, columnIndex) => `
                                    <td
                                        class="${this.getGridCellClass(gridKey, column)}"
                                        title="${this.escapeHtml(row[column] ?? "")}"
                                        onclick="M02002.selectGridCell('${gridKey}', ${rowIndex}, ${columnIndex + 1})"
                                    >${this.renderGridCellValue(gridKey, column, row[column])}</td>
                                `).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
            const footerMarkup = "";
            container.innerHTML = `<div class="table-grid-scroll">${tableMarkup}</div>${footerMarkup}`;
            this.enableSharedGridResize(gridKey);
            this.applyGridFrozenColumns(gridKey);
        },

        getGridRowNumber(gridKey, rowIndex) {
            return (gridKey === "data" || gridKey === "sql")
                ? ((Number(this.gridPages[gridKey] || 1) - 1) * Number(this.gridPageSizes[gridKey] || 100)) + rowIndex + 1
                : rowIndex + 1;
        },

        enableSharedGridResize(gridKey) {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            const colgroup = table?.querySelector("colgroup");
            // renderGrid already assigns the page's initial widths.  Preserve
            // them before the shared resizer measures the newly inserted table:
            // on the first layout pass its headers can still report 48px.
            if (colgroup) colgroup.dataset.gridWidthsReady = "Y";
            CommonUtils.enableGridColumnResize(table, (width, header) => {
                const index = Array.from(header.parentElement?.children || []).indexOf(header) - 1;
                if (index >= 0) this.columnWidths[gridKey][index] = width;
                this.applyGridFrozenColumns(gridKey);
            });
        },

        getGridFreezeCount(gridKey) {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            const headerCells = Array.from(table?.tHead?.rows?.[0]?.children || []);
            const maxDataColumns = Math.max(0, headerCells.length - 1);
            const input = null;
            let dataColumnCount = Number.parseInt(this.gridFrozenColumns?.[gridKey] ?? 0, 10);
            if (!Number.isFinite(dataColumnCount)) dataColumnCount = 0;
            dataColumnCount = Math.max(0, Math.min(maxDataColumns, dataColumnCount));
            this.gridFrozenColumns = { ...(this.gridFrozenColumns || {}), [gridKey]: dataColumnCount };
            if (input && input.value !== String(dataColumnCount)) input.value = String(dataColumnCount);
            return dataColumnCount + 1;
        },

        applyGridFrozenColumns(gridKey = "sql") {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            if (!table) return;
            table.querySelectorAll(".is-frozen-col, .is-frozen-edge").forEach((cell) => {
                cell.classList.remove("is-frozen-col", "is-frozen-edge");
                cell.style.left = "";
            });
            table.classList.remove("has-frozen-cols");
            const headerCells = Array.from(table.tHead?.rows?.[0]?.children || []);
            const visibleFreezeCount = Math.min(this.getGridFreezeCount(gridKey), headerCells.length);
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

        getVisibleGridColumns(gridKey, columns) {
            if (gridKey !== "columns") return columns;
            const hiddenColumns = new Set(["OWNER", "TABLE_ID", "TABLE_COMMENT"]);
            return columns.filter((column) => !hiddenColumns.has(String(column).toUpperCase()));
        },

        normalizeColumnWidths(gridKey, columns) {
            const current = this.columnWidths[gridKey] || [];
            return columns.map((column, index) => {
                const existing = Number(current[index]);
                if (Number.isFinite(existing) && existing >= 48) return existing;
                if (gridKey === "columns" && column === "TABLE_ID") return 360;
                return Math.min(Math.max(String(column).length * 9 + 38, 120), 260);
            });
        },

        renderGridCellValue(gridKey, column, value) {
            const displayValue = this.isDateTimeColumn(column) ? this.formatKstDateTime(value) : value;
            const text = this.escapeHtml(displayValue ?? "");
            if (gridKey === "columns" && column === "TABLE_ID") {
                return `<span class="table-copy-cell" ondblclick="M02002.selectCopyCellText(event)" title="${text}">${text}</span>`;
            }
            return text;
        },

        isDateTimeColumn(column) {
            return /(^|_)(CREATED|UPDATED|STARTED|FINISHED|DEPLOYED|MODIFIED)_AT$/i.test(String(column || ""))
                || /(^|_)(CREATE|UPDATE|START|END|DDL)_DT$/i.test(String(column || ""))
                || /TIME$/i.test(String(column || ""));
        },

        formatKstDateTime(value) {
            const date = this.parseDateTime(value);
            if (!date) return value || "-";
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
                ) - (9 * 60 * 60 * 1000));
            }
            const parsed = new Date(text);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        },

        getGridCellClass(gridKey, column) {
            return gridKey === "columns" && column === "TABLE_ID" ? "table-id-copy-cell" : "";
        },

        selectCopyCellText(event) {
            event.stopPropagation();
            const target = event.currentTarget;
            const selection = window.getSelection();
            if (!target || !selection) return;
            const range = document.createRange();
            range.selectNodeContents(target);
            selection.removeAllRanges();
            selection.addRange(range);
        },

        selectGridCell(gridKey, rowIndex, columnIndex) {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            if (!table) return;
            table.querySelectorAll("td.is-selected").forEach((cell) => cell.classList.remove("is-selected"));
            const row = table.tBodies[0]?.rows[rowIndex];
            const cell = row?.cells[columnIndex];
            if (!cell) return;
            cell.classList.add("is-selected");
            this.selectedCell = { gridKey, rowIndex, columnIndex };
        },

        startColumnResize(event, gridKey, columnIndex) {
            event.preventDefault();
            event.stopPropagation();
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            const col = table?.querySelectorAll("col")[columnIndex + 1];
            if (!table || !col) return;
            const startWidth = Number.parseInt(col.style.width, 10) || col.getBoundingClientRect().width || 120;
            this.resizing = {
                gridKey,
                columnIndex,
                startX: event.clientX,
                startWidth
            };
            document.body.classList.add("is-column-resizing");
        },

        handleColumnResizeMove(event) {
            if (!this.resizing) return;
            const nextWidth = Math.max(80, this.resizing.startWidth + event.clientX - this.resizing.startX);
            this.columnWidths[this.resizing.gridKey][this.resizing.columnIndex] = nextWidth;
            const table = getContainerEl(`[data-grid-key="${this.resizing.gridKey}"]`);
            const col = table?.querySelectorAll("col")[this.resizing.columnIndex + 1];
            if (col) col.style.width = `${nextWidth}px`;
            this.applyGridFrozenColumns(this.resizing.gridKey);
        },

        stopColumnResize() {
            if (!this.resizing) return;
            this.resizing = null;
            document.body.classList.remove("is-column-resizing");
        },

        exportActiveGrid(format) {
            const gridKey = this.activeTab;
            const rows = this.gridData[gridKey] || [];
            if (!rows.length) {
                alert("No grid data to export.");
                return;
            }
            const baseName = this.createExportFileName(gridKey);
            if (format === "excel") {
                DataEditingSystem.downloadXLSX(rows, `${baseName}.xlsx`);
                return;
            }
            if (format === "csv") {
                this.downloadBlob(`${baseName}.csv`, this.createDelimitedContent(rows, ","), "text/csv;charset=utf-8");
                return;
            }
            if (format === "tsv") {
                this.downloadBlob(`${baseName}.tsv`, this.createDelimitedContent(rows, "\t"), "text/tab-separated-values;charset=utf-8");
            }
        },

        exportGrid(gridKey, format) {
            const previousTab = this.activeTab;
            this.activeTab = gridKey;
            const normalized = format === "json" ? "tsv" : format;
            if (format === "json") {
                const rows = this.gridData[gridKey] || [];
                if (rows.length) this.downloadBlob(`${this.createExportFileName(gridKey)}.json`, JSON.stringify(rows, null, 2), "application/json;charset=utf-8");
            } else {
                this.exportActiveGrid(normalized);
            }
            this.activeTab = previousTab;
        },

        createExportFileName(gridKey) {
            const tableName = this.selectedTable?.TABLE_NAME || "SQL_RESULT";
            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
            return `M02002_${tableName}_${gridKey}_${stamp}`;
        },

        createExcelContent(rows) {
            const columns = Object.keys(rows[0] || {});
            return `
                <html>
                    <head><meta charset="UTF-8"></head>
                    <body>
                        <table>
                            <thead><tr>${columns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr></thead>
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

        createDelimitedContent(rows, delimiter) {
            const columns = Object.keys(rows[0] || {});
            const lines = [
                columns.map((column) => this.escapeDelimitedValue(column, delimiter)).join(delimiter),
                ...rows.map((row) => columns.map((column) => this.escapeDelimitedValue(row[column] ?? "", delimiter)).join(delimiter))
            ];
            return `\uFEFF${lines.join("\r\n")}`;
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

        ensureSelectedTable() {
            if (this.selectedTable) return true;
            this.renderError(`#${this.activeTab}Grid-M02002`, this.t("selectTableFirst", "Select a table first."));
            return false;
        },

        getSelectedPayload() {
            const table = this.getAnalysisTable();
            return {
                owner: table?.OWNER || "",
                tableName: table?.TABLE_NAME || "",
                projectId: this.selectedProjectId || null,
                scenarioId: this.selectedScenarioId || null
            };
        },

        getSelectedTableKey() {
            return `${this.selectedTable?.OWNER || ""}.${this.selectedTable?.TABLE_NAME || ""}`;
        },

        getAnalysisTable() {
            return this.analysisTable || this.selectedTable;
        },

        getDataGridStateKey(limit = this.gridPageSizes.data || 100) {
            const table = this.getAnalysisTable();
            return `${table?.OWNER || ""}.${table?.TABLE_NAME || ""}|${Number(limit || 100)}`;
        },

        isDataGridCurrent() {
            return Boolean(this.dataGridStateKey)
                && this.dataGridStateKey === this.getDataGridStateKey();
        }
    };

    window[PAGE_CODE] = M02002;
})();
