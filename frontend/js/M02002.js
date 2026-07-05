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
        selectedScenarioTableKey: "",
        tables: [],
        displayedTables: [],
        tableSearchMode: false,
        tableTreeLoading: false,
        tableTreeHasMore: false,
        tableTreeNextOffset: 0,
        selectedTable: null,
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
        gridFrozenColumns: { sql: 0 },
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
            await this.loadTableTree();
            this.switchTab("columns");
            this.isInit = true;
        },

        destroy() {
            this.contextProjects = [];
            this.contextScenarios = [];
            this.selectedProjectId = "";
            this.selectedScenarioId = "";
            this.scenarioTables = [];
            this.selectedScenarioTableKey = "";
            this.tables = [];
            this.displayedTables = [];
            this.tableSearchMode = false;
            this.tableTreeLoading = false;
            this.tableTreeHasMore = false;
            this.tableTreeNextOffset = 0;
            this.selectedTable = null;
            this.focusedTableKey = "";
            this.activeTab = "columns";
            this.gridData = { columns: [], data: [], sql: [] };
            this.columnWidths = { columns: [], data: [], sql: [] };
            this.gridFrozenColumns = { sql: 0 };
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
            await this.loadScenarioTables();
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
                this.renderError("#scenarioTablesGrid-M02002", message);
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
            this.saveStoredContext();
            await this.loadContextScenarios("");
            await this.loadScenarioTables();
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
                this.renderError("#scenarioTablesGrid-M02002", message);
            }
        },

        renderContextScenarios(preferredScenarioId = "") {
            const select = getContainerEl("#contextScenario-M02002");
            if (!select) return;

            select.innerHTML = `
                <option value="">${this.escapeHtml(this.t("selectScenario", "-- Select scenario --"))}</option>
                ${this.contextScenarios.map((scenario) => `
                    <option class="${this.escapeHtml(CommonUtils.getOwnerScopeClass(scenario))}" value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                        ${this.escapeHtml(CommonUtils.formatOwnerScopedName(scenario, scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || this.t("untitledScenario", "(Untitled scenario)")))}
                    </option>
                `).join("")}
            `;

            const exists = this.contextScenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
            const firstScenarioId = this.contextScenarios.length ? String(this.contextScenarios[0].SCENARIO_ID ?? "") : "";
            this.selectedScenarioId = exists ? String(preferredScenarioId) : firstScenarioId;
            select.value = this.selectedScenarioId;
            CommonUtils.applyOwnerScopeToSelect(select, this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
            this.saveStoredContext();
        },

        async handleContextScenarioChange(scenarioId) {
            this.selectedScenarioId = scenarioId || "";
            CommonUtils.applyOwnerScopeToSelect(getContainerEl("#contextScenario-M02002"), this.contextScenarios, this.selectedScenarioId, ["SCENARIO_ID", "scenarioId"]);
            this.saveStoredContext();
            await this.loadScenarioTables();
        },

        ensureWorkContextSelected() {
            if (!this.selectedProjectId) {
                alert("Project is required.");
                getContainerEl("#contextProject-M02002")?.focus();
                return false;
            }
            if (!this.selectedScenarioId) {
                alert("Scenario is required.");
                getContainerEl("#contextScenario-M02002")?.focus();
                return false;
            }
            return true;
        },

        async loadScenarioTables() {
            const container = getContainerEl("#scenarioTablesGrid-M02002");
            if (!container) return;

            this.selectedScenarioTableKey = "";
            if (!this.selectedProjectId || !this.selectedScenarioId) {
                this.scenarioTables = [];
                container.innerHTML = `
                    <div class="table-empty">${this.escapeHtml(this.t("selectProjectScenarioFirst", "Select project and scenario first."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingScenarioTables", "Loading scenario tables..."))}</div>`;
            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    scenarioId: this.selectedScenarioId
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-tables?${params.toString()}`, { method: "GET", showLoading: false });
                this.scenarioTables = Array.isArray(json.data) ? json.data : [];
                this.renderScenarioTables();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Scenario table load failed.")}</div>`;
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
                row.OWNER_NAME === this.selectedTable.OWNER && row.TABLE_NAME === this.selectedTable.TABLE_NAME
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

            const row = this.getSelectedScenarioTable();
            if (!row) {
                alert("Click Add selected first, then select a scenario table to save.");
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
                this.renderScenarioTables();
                alert("Scenario table saved.");
            } catch (error) {
                alert(error.message || "Scenario table save failed.");
            }
        },

        async deleteScenarioTable() {
            if (!this.ensureWorkContextSelected()) return;

            const row = this.getSelectedScenarioTable();
            if (!row) {
                alert("Select a scenario table to delete.");
                return;
            }

            if (row._PENDING || !row.SCENARIO_TABLE_ID) {
                this.scenarioTables = this.scenarioTables.filter((item) => item !== row);
                this.selectedScenarioTableKey = "";
                this.renderScenarioTables();
                return;
            }

            if (!(await CommonMessage.confirm(`Delete table "${row.OWNER_NAME}.${row.TABLE_NAME}" from this scenario?`))) {
                return;
            }

            try {
                await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario-table/delete`, {
                    method: "POST",
                    body: {
                        scenarioTableId: row.SCENARIO_TABLE_ID,
                        projectId: Number(this.selectedProjectId),
                        scenarioId: Number(this.selectedScenarioId)
                    }
                });
                this.scenarioTables = this.scenarioTables.filter((item) => item !== row);
                this.selectedScenarioTableKey = "";
                this.renderScenarioTables();
                alert("Scenario table deleted.");
            } catch (error) {
                alert(error.message || "Scenario table delete failed.");
            }
        },

        async deleteAllScenarioTables() {
            if (!this.ensureWorkContextSelected()) return;

            if (!this.scenarioTables.length) {
                alert("There are no scenario tables to delete.");
                return;
            }

            if (!(await CommonMessage.confirm("Delete all tables registered to this scenario?"))) {
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
                this.renderScenarioTables();
                alert(`${result.deletedCount ?? 0} scenario tables deleted.`);
            } catch (error) {
                alert(error.message || "Scenario table delete failed.");
            }
        },

        async loadTableTree(reset = true) {
            const container = getContainerEl("#tableTree-M02002");
            if (!container) return;
            if (this.tableTreeLoading) return;

            const keyword = this.tableSearchMode ? (getContainerEl("#tableSearch-M02002")?.value || "").trim() : "";
            const offset = reset ? 0 : this.tableTreeNextOffset;
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
                    limit: String(TREE_PAGE_SIZE)
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/table-tree?${params.toString()}`, { method: "GET", showLoading: false });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || this.t("tableListLoadFailed", "Table list load failed."));
                }
                const rows = Array.isArray(json.data) ? json.data : [];
                this.tables = reset ? rows : this.tables.concat(rows);
                this.displayedTables = this.tables;
                this.tableTreeHasMore = Boolean(json.hasMore);
                this.tableTreeNextOffset = Number(json.nextOffset || this.tables.length);
                this.renderTableTree();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message)}</div>`;
            } finally {
                this.tableTreeLoading = false;
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
                <div class="table-tree-head">
                    <div>Table</div>
                    <div>Owner</div>
                </div>
                ${rows.map((row) => this.createTableRow(row)).join("")}
                ${this.tableTreeHasMore ? this.createTableLoadMoreRow() : ""}
                ${this.renderListFooter(rows.length)}
            `;
        },

        createTableRow(row) {
            const key = `${row.OWNER}.${row.TABLE_NAME}`;
            const selectedKey = this.selectedTable ? `${this.selectedTable.OWNER}.${this.selectedTable.TABLE_NAME}` : "";
            const selectedClass = key === (this.focusedTableKey || selectedKey) ? "is-selected" : "";
            const comment = row.COMMENTS || "";
            return `
                <button type="button" class="table-tree-row ${selectedClass}" data-table-key="${this.escapeHtml(key)}" onclick="M02002.selectTable('${this.escapeJs(row.OWNER)}', '${this.escapeJs(row.TABLE_NAME)}')">
                    <span class="table-tree-name" title="${this.escapeHtml(comment || row.TABLE_NAME)}">
                        <span class="table-tree-physical">
                            <i class="fas fa-table"></i>
                            <span>${this.escapeHtml(row.TABLE_NAME)}</span>
                        </span>
                        <span class="table-tree-comment">${this.escapeHtml(comment || "-")}</span>
                    </span>
                    <span class="table-tree-muted">${this.escapeHtml(row.OWNER)}</span>
                </button>
            `;
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
            return getContainerEl("#tableTree-M02002")?.scrollTop || 0;
        },

        restoreTableTreeScroll(scrollTop) {
            window.requestAnimationFrame(() => {
                const container = getContainerEl("#tableTree-M02002");
                if (container) container.scrollTop = scrollTop;
            });
        },

        async selectTable(owner, tableName) {
            const table = this.tables.find((row) => row.OWNER === owner && row.TABLE_NAME === tableName);
            this.selectedTable = table || { OWNER: owner, TABLE_NAME: tableName, COMMENTS: "" };
            this.focusedTableKey = `${owner}.${tableName}`;
            this.renderTableTree();
            this.updateSelectedMeta();
            this.setDefaultSql();
            await Promise.all([
                this.loadTableInfo(),
                this.loadColumns()
            ]);
            if (this.activeTab === "data") {
                await this.loadTableData();
            }
        },

        updateSelectedMeta() {
            this.setText("#selectedOwner-M02002", this.selectedTable?.OWNER || "-");
            this.setText("#selectedTable-M02002", this.selectedTable?.TABLE_NAME || "-");
            this.setText("#selectedCreatedAt-M02002", this.formatKstDateTime(this.selectedTable?.CREATED_AT));
            this.setText("#selectedComment-M02002", this.selectedTable?.COMMENTS || "-");
            const desc = this.selectedTable
                ? `${this.selectedTable.OWNER}.${this.selectedTable.TABLE_NAME}`
                : this.t("selectTableFromExplorer", "Select a table from the explorer.");
            this.setText("#tableDescription-M02002", desc);
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
            if (tabName === "data") {
                this.loadTableData();
            }
            if (tabName === "sql" && !getContainerEl("#sqlEditor-M02002")?.value.trim()) {
                this.setDefaultSql();
            }
        },

        async loadTableInfo() {
            if (!this.ensureSelectedTable()) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/table-info`, {
                    method: "POST",
                    showLoading: false,
                    body: this.getSelectedPayload()
                });
                if (json.data && Object.keys(json.data).length) {
                    this.selectedTable = {
                        ...this.selectedTable,
                        ...json.data
                    };
                    this.updateSelectedMeta();
                }
            } catch (error) {
                console.warn("[M02002] table info load failed", error);
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
            } catch (error) {
                this.renderError("#columnsGrid-M02002", error.message);
            }
        },

        async loadTableData() {
            if (!this.ensureSelectedTable()) return;
            const limit = this.getLimit("#dataLimit-M02002");
            const grid = getContainerEl("#dataGrid-M02002");
            if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingData", "Loading data..."))}</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data`, {
                    method: "POST",
                    showLoading: false,
                    body: { ...this.getSelectedPayload(), limit }
                });
                this.renderGrid("#dataGrid-M02002", json.data || [], "data", json.columns || []);
            } catch (error) {
                this.renderError("#dataGrid-M02002", error.message);
            }
        },

        async executeSql() {
            const executable = this.getExecutableSqlFromEditor();
            if (!executable.sql) {
                this.renderSqlMessage(this.t("noSqlAtCursor", "No SQL statement found at the cursor."), "error");
                this.renderError("#sqlGrid-M02002", this.t("noSqlAtCursor", "No SQL statement found at the cursor."));
                return;
            }
            const sql = executable.sql;
            if (!this.validateSelectSql(sql)) {
                this.renderSqlMessage("Only a single SELECT statement is allowed.", "error");
                this.renderError("#sqlGrid-M02002", "Only a single SELECT statement is allowed.");
                this.restoreSqlSelection(executable);
                return;
            }

            this.restoreSqlSelection(executable);
            const limit = this.getLimit("#sqlLimit-M02002");
            const grid = getContainerEl("#sqlGrid-M02002");
            const startedAt = performance.now();
            this.renderSqlMessage("Running SQL...", "info");
            if (grid) grid.innerHTML = `<div class="table-empty">Running SQL...</div>`;

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql`, {
                    method: "POST",
                    showLoading: false,
                    body: { sql, limit }
                });
                const elapsedMs = Math.round(performance.now() - startedAt);
                const rowCount = Array.isArray(json.data) ? json.data.length : 0;
                this.renderSqlMessage(`${rowCount.toLocaleString()} rows selected. (${elapsedMs.toLocaleString()} ms)`, "success");
                this.renderGrid("#sqlGrid-M02002", json.data || [], "sql", json.columns || []);
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
            if (!this.selectedTable) return;
            const editor = getContainerEl("#sqlEditor-M02002");
            if (!editor) return;
            editor.value = `SELECT *\n  FROM ${this.quoteName(this.selectedTable.OWNER)}.${this.quoteName(this.selectedTable.TABLE_NAME)};`;
        },

        validateSelectSql(sql) {
            const text = sql.trim().replace(/;+\s*$/, "");
            if (!/^(select|with)\b/i.test(text)) return false;
            return !/;\s*\S/.test(sql);
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
                    container.innerHTML = `
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
                                            <span class="column-resizer" onmousedown="M02002.startColumnResize(event, '${gridKey}', ${index})"></span>
                                        </th>
                                    `).join("")}
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                        ${this.renderListFooter(0)}
                    `;
                    this.applyGridFrozenColumns(gridKey);
                    return;
                }
                container.innerHTML = `
                    <div class="table-empty">${this.escapeHtml(this.t("noData", "No data."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `
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
                                    <span class="column-resizer" onmousedown="M02002.startColumnResize(event, '${gridKey}', ${index})"></span>
                                </th>
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${rowIndex + 1}</td>
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
                ${this.renderListFooter(rows.length)}
            `;
            this.applyGridFrozenColumns(gridKey);
        },

        getGridFreezeCount(gridKey) {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            const headerCells = Array.from(table?.tHead?.rows?.[0]?.children || []);
            const maxDataColumns = Math.max(0, headerCells.length - 1);
            const input = gridKey === "sql" ? getContainerEl("#sqlFreezeColumns-M02002") : null;
            let dataColumnCount = Number.parseInt(input?.value ?? this.gridFrozenColumns?.[gridKey] ?? 0, 10);
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
                if (Number.isFinite(existing) && existing >= 80) return existing;
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
                ));
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
            return {
                owner: this.selectedTable?.OWNER || "",
                tableName: this.selectedTable?.TABLE_NAME || ""
            };
        }
    };

    window[PAGE_CODE] = M02002;
})();
