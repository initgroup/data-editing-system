(function() {
    const PAGE_CODE = "M99003";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const M99003 = {
        ...COMMON,
        isInit: false,
        initStatus: [],
        selectedSystemTable: null,
        activeBrowserTab: "columns",
        currentUserRows: [],
        sqlKeydownBound: null,

        async init() {
            if (this.isInit) return;
            this.sqlKeydownBound = this.handleSqlEditorKeydown.bind(this);
            getContainerEl("#systemSqlEditor-M99003")?.addEventListener("keydown", this.sqlKeydownBound);
            await this.loadStatus();
            this.switchBrowserTab("columns");
            this.syncUserApprovalControls();
            this.isInit = true;
        },

        destroy() {
            if (this.sqlKeydownBound) {
                getContainerEl("#systemSqlEditor-M99003")?.removeEventListener("keydown", this.sqlKeydownBound);
            }
            this.initStatus = [];
            this.selectedSystemTable = null;
            this.activeBrowserTab = "columns";
            this.currentUserRows = [];
            this.sqlKeydownBound = null;
            this.syncUserApprovalControls();
            this.isInit = false;
        },

        async loadStatus() {
            const grid = getContainerEl("#initStatusGrid-M99003");
            if (!grid) return;
            grid.innerHTML = `<div class="env-tree-loading project-empty">Checking INIT tables...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/status`, { method: "GET", showLoading: false });
                this.initStatus = Array.isArray(json.data) ? json.data : [];
                if (this.selectedSystemTable) {
                    this.selectedSystemTable = this.initStatus.find((row) => row.TABLE_NAME === this.selectedSystemTable.TABLE_NAME) || null;
                }
                this.renderStatus();
                this.syncUserApprovalControls();
                this.setSystemMessage(`${json.installedCount || 0}/${json.total || 0} INIT system tables exist.`);
            } catch (error) {
                grid.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || "INIT status check failed.")}</div>`;
                this.setSystemMessage(error.message || "INIT status check failed.", "error");
            }
        },

        renderStatus() {
            const grid = getContainerEl("#initStatusGrid-M99003");
            if (!grid) return;
            const missingCount = this.initStatus.filter((row) => row.EXISTS_YN !== "Y").length;
            const createBtn = getContainerEl("#createInitTablesBtn-M99003");
            if (createBtn) createBtn.title = missingCount === 0 ? "All INIT system tables already exist" : "Create missing INIT tables";

            if (!this.initStatus.length) {
                grid.innerHTML = `<div class="project-empty">No INIT table status.</div>${this.renderListFooter(0)}`;
                return;
            }

            grid.innerHTML = `
                <div class="project-list-head">
                    <div>Table</div>
                    <div>Status</div>
                </div>
                <div class="project-list-body">
                    ${this.initStatus.map((row) => this.createStatusRow(row)).join("")}
                </div>
                ${this.renderListFooter(this.initStatus.length)}
            `;
        },

        createStatusRow(row) {
            const tableName = row.TABLE_NAME || "";
            const selectedClass = this.selectedSystemTable?.TABLE_NAME === tableName ? "is-selected" : "";
            return `
                <button type="button" class="project-row ${selectedClass}" onclick="M99003.selectSystemTable('${this.escapeAttr(tableName)}')">
                    <span class="project-row-main">
                        <span class="project-row-title">${this.escapeHtml(tableName)}</span>
                        <span class="project-row-sub">${row.EXISTS_YN === "Y" ? "Installed" : "Missing"}</span>
                    </span>
                    <span class="project-row-meta">
                        <span>${this.escapeHtml(row.EXISTS_YN || "N")}</span>
                    </span>
                </button>
            `;
        },

        async runInitSystem() {
            const missingCount = this.initStatus.filter((row) => row.EXISTS_YN !== "Y").length;
            if (missingCount === 0) {
                const message = "All required INIT system tables already exist.";
                this.renderInitLog(message);
                this.setSystemMessage(message);
                return;
            }
            const missingTables = this.initStatus
                .filter((row) => row.EXISTS_YN !== "Y")
                .map((row) => row.TABLE_NAME)
                .join(", ");
            this.renderInitLog(`Missing INIT system tables: ${missingTables}`);
            if (!(await CommonMessage.confirm("Create missing INIT$_ system tables on the current system database?"))) return;
            this.setSystemMessage("Running INIT_SYSTEM_DDL...");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/init-system/run`, { method: "POST" });
                this.initStatus = Array.isArray(json.data) ? json.data : [];
                this.renderStatus();
                this.renderInitLog((json.logs || [json.message || "INIT system tables are ready."]).join("\n"));
                this.setSystemMessage(`${json.installedCount || 0}/${json.total || 0} INIT system tables exist.`);
            } catch (error) {
                this.renderInitLog(error.message || "INIT system DDL failed.", "error");
                this.setSystemMessage(error.message || "INIT system DDL failed.", "error");
            }
        },

        async truncateSystemData() {
            if (!(await CommonMessage.confirm("Clear all rows from INIT system tables? Notices, users, target DB connections, settings, and setup logs will be truncated. Tables will not be dropped."))) return;
            if (!(await CommonMessage.confirm("This cannot be undone and may require system setup again. Continue clearing INIT system table data?"))) return;
            this.renderInitLog("Clearing INIT system table data...");
            this.setSystemMessage("Running INIT_SYSTEM_TRUNC...");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/init-system/truncate`, { method: "POST" });
                this.initStatus = Array.isArray(json.data) ? json.data : [];
                this.currentUserRows = [];
                this.renderStatus();
                this.renderInitLog((json.logs || [json.message || "INIT system table data cleared."]).join("\n"));
                this.setSystemMessage(`${json.installedCount || 0}/${json.total || 0} INIT system tables exist.`);
                if (this.selectedSystemTable?.EXISTS_YN === "Y") {
                    await this.refreshActiveSystemTableView();
                }
            } catch (error) {
                this.renderInitLog(error.message || "INIT system table data clear failed.", "error");
                this.setSystemMessage(error.message || "INIT system table data clear failed.", "error");
            }
        },

        async selectSystemTable(tableName) {
            const row = this.initStatus.find((item) => item.TABLE_NAME === tableName);
            if (!row) return;
            this.selectedSystemTable = row;
            this.renderStatus();
            this.setText("#selectedSystemTable-M99003", tableName);
            this.setText("#selectedSystemTableStatus-M99003", row.EXISTS_YN === "Y" ? "Installed" : "Missing");
            this.syncUserApprovalControls();
            const editor = getContainerEl("#systemSqlEditor-M99003");
            if (editor) editor.value = `SELECT *\n  FROM "${tableName}";`;
            if (row.EXISTS_YN !== "Y") {
                this.renderError("#systemColumnsGrid-M99003", "Table does not exist.");
                this.renderError("#systemDataGrid-M99003", "Table does not exist.");
                this.renderError("#systemSqlGrid-M99003", "Table does not exist.");
                return;
            }
            await this.refreshActiveSystemTableView();
        },

        switchBrowserTab(tabName) {
            this.activeBrowserTab = tabName;
            const panel = getContainerEl("#systemBrowserPanel-M99003");
            panel?.querySelectorAll(".table-tabs .table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.tab === tabName);
            });
            panel?.querySelectorAll(".table-tab-panel").forEach((tabPanel) => {
                tabPanel.classList.toggle("is-active", tabPanel.dataset.panel === tabName);
            });
            if (tabName === "data" && this.selectedSystemTable?.EXISTS_YN === "Y") this.loadSystemTableData();
        },

        async refreshActiveSystemTableView() {
            if (this.activeBrowserTab === "data") {
                await this.loadSystemTableData();
                return;
            }
            if (this.activeBrowserTab === "sql") {
                await this.executeSystemSql();
                return;
            }
            await this.loadSystemTableColumns();
        },

        async loadSystemTableColumns() {
            if (!this.ensureSystemTable()) return;
            const grid = getContainerEl("#systemColumnsGrid-M99003");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading columns...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/system-table/columns`, {
                    method: "POST",
                    showLoading: false,
                    body: { tableName: this.selectedSystemTable.TABLE_NAME }
                });
                this.renderGrid("#systemColumnsGrid-M99003", json.data || [], json.columns || []);
            } catch (error) {
                this.renderError("#systemColumnsGrid-M99003", error.message);
            }
        },

        async loadSystemTableData() {
            if (!this.ensureSystemTable()) return;
            const grid = getContainerEl("#systemDataGrid-M99003");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading data...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/system-table/data`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        tableName: this.selectedSystemTable.TABLE_NAME,
                        limit: this.getLimit("#systemDataLimit-M99003"),
                        userStatus: this.getUserStatusFilter()
                    }
                });
                this.renderGrid("#systemDataGrid-M99003", json.data || [], json.columns || []);
            } catch (error) {
                this.renderError("#systemDataGrid-M99003", error.message);
            }
        },

        async executeSystemSql() {
            const sql = (getContainerEl("#systemSqlEditor-M99003")?.value || "").trim();
            if (!sql) {
                this.renderError("#systemSqlGrid-M99003", "SQL is required.");
                return;
            }
            const grid = getContainerEl("#systemSqlGrid-M99003");
            if (grid) grid.innerHTML = `<div class="table-empty">Running SQL...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/system-table/sql`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        sql,
                        limit: this.getLimit("#systemSqlLimit-M99003")
                    }
                });
                this.renderGrid("#systemSqlGrid-M99003", json.data || [], json.columns || []);
            } catch (error) {
                this.renderError("#systemSqlGrid-M99003", error.message);
            }
        },

        handleSqlEditorKeydown(event) {
            if (!(event.ctrlKey && event.key === "Enter")) return;
            event.preventDefault();
            this.executeSystemSql();
        },

        async approveUsers(approveAll) {
            if (!this.isUserTableSelected()) return;
            const selectedIds = approveAll ? this.getVisiblePendingUserIds() : this.getSelectedUserIds();
            if (selectedIds.length === 0) {
                this.setSystemMessage(approveAll ? "No pending users in current result." : "Select at least one pending user.", "error");
                return;
            }
            const message = approveAll
                ? "Approve all pending users in the current result?"
                : "Approve selected user(s)?";
            if (!(await CommonMessage.confirm(message))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/system-table/user/approve`, {
                    method: "POST",
                    body: {
                        userIds: selectedIds,
                        userStatus: this.getUserStatusFilter(),
                        approveAll
                    }
                });
                this.setSystemMessage(json.message || "User approval completed.");
                await this.loadSystemTableData();
            } catch (error) {
                this.setSystemMessage(error.message || "User approval failed.", "error");
            }
        },

        async resetSelectedPasswords() {
            if (!this.isUserTableSelected()) return;
            const selectedIds = this.getSelectedUserIds();
            if (selectedIds.length === 0) {
                this.setSystemMessage("Select at least one user to reset password.", "error");
                return;
            }
            if (!(await CommonMessage.confirm("Reset password for selected user(s)? Temporary passwords will be shown only once."))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/system-table/user/reset-password`, {
                    method: "POST",
                    body: { userIds: selectedIds }
                });
                const rows = Array.isArray(json.data) ? json.data : [];
                const lines = [
                    json.message || "Password reset completed.",
                    this.tl("temporaryPasswordNotice", "Temporary passwords are shown only now. After user confirmation, deliver them through a secure channel."),
                    "",
                    ...rows.flatMap((row, index) => [
                        `[${index + 1}] ${row.loginId || "-"}`,
                        `Name: ${row.userName || "-"}`,
                        `Email: ${row.email || "-"}`,
                        `Temporary password: ${row.temporaryPassword || "-"}`,
                        ""
                    ])
                ];
                this.renderInitLog(lines.join("\n"));
                this.setSystemMessage(json.message || "Password reset completed.");
                await this.loadSystemTableData();
            } catch (error) {
                this.setSystemMessage(error.message || "Password reset failed.", "error");
            }
        },

        async deactivateSelectedUsers() {
            if (!this.isUserTableSelected()) return;
            const selectedIds = this.getSelectedUserIds();
            if (selectedIds.length === 0) {
                this.setSystemMessage("Select at least one user to deactivate.", "error");
                return;
            }
            if (!(await CommonMessage.confirm("Deactivate the selected user(s)? USE_YN will be changed to N."))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/system-table/user/deactivate`, {
                    method: "POST",
                    body: { userIds: selectedIds }
                });
                this.setSystemMessage(json.message || "User deactivation completed.");
                await this.loadSystemTableData();
            } catch (error) {
                this.setSystemMessage(error.message || "User deactivation failed.", "error");
            }
        },

        renderGrid(selector, rows, columnNames = []) {
            const container = getContainerEl(selector);
            if (!container) return;
            const columns = Array.isArray(columnNames) && columnNames.length ? columnNames : Object.keys(rows?.[0] || {});
            const isUserDataGrid = selector === "#systemDataGrid-M99003" && this.isUserTableSelected();
            if (isUserDataGrid) this.currentUserRows = Array.isArray(rows) ? rows : [];
            if (!Array.isArray(rows) || rows.length === 0) {
                if (!columns.length) {
                    container.innerHTML = `<div class="table-empty">No data.</div>${this.renderListFooter(0)}`;
                    return;
                }
            }
            container.innerHTML = `
                <table class="table-grid">
                    <thead>
                        <tr>
                            ${isUserDataGrid ? `<th class="grid-row-no">Select</th>` : ""}
                            <th class="grid-row-no">No</th>
                            ${columns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${(rows || []).map((row, index) => `
                            <tr>
                                ${isUserDataGrid ? `
                                    <td class="grid-row-no">
                                        <input type="checkbox" class="user-approve-check-M99003" value="${this.escapeAttr(row.USER_ID ?? "")}">
                                    </td>
                                ` : ""}
                                <td class="grid-row-no">${index + 1}</td>
                                ${columns.map((column) => `<td title="${this.escapeHtml(row[column] ?? "")}">${this.escapeHtml(row[column] ?? "")}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                ${this.renderListFooter((rows || []).length)}
            `;
        },

        isUserTableSelected() {
            return this.selectedSystemTable?.TABLE_NAME === "INIT$_TB_USER";
        },

        getUserStatusFilter() {
            return getContainerEl("#userStatusFilter-M99003")?.value || "ALL";
        },

        getSelectedUserIds() {
            return Array.from(document.querySelectorAll(".user-approve-check-M99003:checked"))
                .map((checkbox) => Number(checkbox.value))
                .filter((value) => Number.isFinite(value) && value > 0);
        },

        getVisiblePendingUserIds() {
            return this.currentUserRows
                .filter((row) => row.USE_YN !== "Y")
                .map((row) => Number(row.USER_ID))
                .filter((value) => Number.isFinite(value) && value > 0);
        },

        syncUserApprovalControls() {
            const visible = this.isUserTableSelected();
            const container = getContainerEl("#systemBrowserPanel-M99003");
            container?.querySelectorAll("[data-user-approval-control]").forEach((el) => {
                el.hidden = !visible;
                el.style.display = visible ? "" : "none";
            });
        },

        ensureSystemTable() {
            if (this.selectedSystemTable?.TABLE_NAME && this.selectedSystemTable.EXISTS_YN === "Y") return true;
            this.renderError("#systemColumnsGrid-M99003", "Select an installed system table first.");
            return false;
        },

        getLimit(selector) {
            const value = Number(getContainerEl(selector)?.value || 100);
            return Math.max(1, Math.min(Number.isFinite(value) ? value : 100, 1000));
        },

        renderInitLog(message, type = "info") {
            const el = getContainerEl("#initRunLog-M99003");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error"
                ? "table-error m99003-init-log"
                : "sql-editor data-script-editor m99003-init-log";
        },

        setSystemMessage(message, type = "info") {
            const el = getContainerEl("#systemMessage-M99003");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error" ? "table-error" : "env-detail-hint";
        },

        renderError(selector, message) {
            const container = getContainerEl(selector);
            if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(message || "Error")}</div>`;
        }
    };

    window[PAGE_CODE] = M99003;
})();
