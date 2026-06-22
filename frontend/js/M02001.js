(function() {
    const PAGE_CODE = "M02001";
    const CONTEXT_STORAGE_KEY = "DATA_EDITING_WORK_CONTEXT";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const M02001 = {
        
        ...COMMON,
        isInit: false,
        contextProjects: [],
        selectedProjectId: "",
        uploadTables: [],
        displayedUploadTables: [],
        focusedUploadTableKey: "",
        uploadedTableName: "",
        activeUploadView: "file",
        activeTab: "columns",
        gridData: { preview: [], columns: [], data: [], sql: [] },
        sqlKeydownBound: null,
        contextLoadFailed: false,
        isUploading: false,

        async init() {
            if (this.isInit) return;
            this.sqlKeydownBound = this.handleSqlEditorKeydown.bind(this);
            getContainerEl("#sqlEditor-M02001")?.addEventListener("keydown", this.sqlKeydownBound);
            this.handleFileTypeChange();
            await this.loadWorkContext();
            if (!this.contextLoadFailed) {
                this.renderGrid("#previewGrid-M02001", [], "preview");
            }
            this.switchTab("columns");
            this.isInit = true;
        },

        destroy() {
            if (this.sqlKeydownBound) {
                getContainerEl("#sqlEditor-M02001")?.removeEventListener("keydown", this.sqlKeydownBound);
            }
            this.contextProjects = [];
            this.selectedProjectId = "";
            this.uploadTables = [];
            this.displayedUploadTables = [];
            this.focusedUploadTableKey = "";
            this.uploadedTableName = "";
            this.activeUploadView = "file";
            this.activeTab = "columns";
            this.gridData = { preview: [], columns: [], data: [], sql: [] };
            this.sqlKeydownBound = null;
            this.contextLoadFailed = false;
            this.isUploading = false;
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
            const stored = this.getStoredContext();
            localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({
                ...stored,
                projectId: this.selectedProjectId || ""
            }));
        },

        async loadWorkContext() {
            const stored = this.getStoredContext();
            await this.loadContextProjects(stored.projectId || "");
        },

        async refreshWorkContext() {
            const projectId = this.selectedProjectId;
            await this.loadContextProjects(projectId);
        },

        async loadContextProjects(preferredProjectId = "") {
            const select = getContainerEl("#contextProject-M02001");
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
                select.innerHTML = `<option value="">Project load failed</option>`;
                this.setText("#uploadDescription-M02001", message);
                this.renderError("#previewGrid-M02001", message);
            }
        },

        renderContextProjects(preferredProjectId = "") {
            const select = getContainerEl("#contextProject-M02001");
            if (!select) return;
            select.innerHTML = `
                <option value="">-- Select project --</option>
                ${this.contextProjects.map((project) => `
                    <option value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                        ${this.escapeHtml(project.PROJECT_NAME || project.PROJECT_CODE || "(Untitled project)")}
                    </option>
                `).join("")}
            `;
            const exists = this.contextProjects.some((project) => String(project.PROJECT_ID) === String(preferredProjectId));
            this.selectedProjectId = exists ? String(preferredProjectId) : "";
            select.value = this.selectedProjectId;
            this.updateProjectMeta();
        },

        async handleContextProjectChange(projectId) {
            this.selectedProjectId = projectId || "";
            this.saveStoredContext();
            this.updateProjectMeta();
            this.uploadTables = [];
            this.displayedUploadTables = [];
            this.focusedUploadTableKey = "";
            if (this.activeUploadView === "table") {
                await this.loadUploadTableTree();
            }
        },

        ensureWorkContextSelected() {
            if (!this.selectedProjectId) {
                alert("Project is required.");
                getContainerEl("#contextProject-M02001")?.focus();
                return false;
            }
            return true;
        },

        getSelectedProject() {
            return this.contextProjects.find((project) => String(project.PROJECT_ID) === String(this.selectedProjectId)) || null;
        },

        getSelectedProjectCode() {
            return this.getSelectedProject()?.PROJECT_CODE || "";
        },

        updateProjectMeta() {
            const project = this.getSelectedProject();
            this.setValue("#projectCode-M02001", project?.PROJECT_CODE || "");
            this.setValue("#projectType-M02001", project?.PROJECT_TYPE || "");
            this.setUploadTableSearchPrefix();
        },

        getUploadTableSearchPrefix() {
            const code = this.getSelectedProjectCode() || "PROJECT";
            const loginUser = this.getLoginUser();
            const loginToken = this.normalizeIdentifierToken(loginUser.loginId || loginUser.userId || "LOGIN");
            return `INITUP$_${loginToken}_${this.normalizeIdentifierToken(code)}_`;
        },

        getLoginUser() {
            try {
                return JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
            } catch (error) {
                return {};
            }
        },

        setUploadTableSearchPrefix(force = true) {
            const input = getContainerEl("#uploadTableSearch-M02001");
            if (!input) return;
            const prefix = this.getUploadTableSearchPrefix();
            if (force || !input.value.trim()) input.value = prefix;
            input.placeholder = prefix;
        },

        normalizeIdentifierToken(value) {
            return String(value || "").toUpperCase().replace(/[^A-Z0-9_$#]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
        },

        handleFileChange() {
            const file = getContainerEl("#uploadFile-M02001")?.files?.[0];
            const commentInput = getContainerEl("#tableComment-M02001");
            if (file && commentInput) {
                commentInput.value = this.getFileBaseName(file.name);
            }
            if (file) {
                this.applyFileTypeFromName(file.name);
            }
            this.renderGrid("#previewGrid-M02001", [], "preview");
        },

        getFileBaseName(fileName) {
            const name = String(fileName || "").split(/[\\/]/).pop();
            const dotIndex = name.lastIndexOf(".");
            return dotIndex > 0 ? name.slice(0, dotIndex) : name;
        },

        applyFileTypeFromName(fileName) {
            const extension = String(fileName || "").split(/[\\/]/).pop().split(".").pop().toLowerCase();
            const typeMap = {
                csv: "csv",
                tsv: "tsv",
                txt: "delimited",
                xlsx: "excel",
                xlsm: "excel",
                xls: "excel"
            };
            const nextType = typeMap[extension];
            const typeSelect = getContainerEl("#fileType-M02001");
            if (!nextType || !typeSelect) return;
            typeSelect.value = nextType;
            this.handleFileTypeChange();
        },

        handleFileTypeChange() {
            const type = getContainerEl("#fileType-M02001")?.value || "csv";
            const delimiter = getContainerEl("#delimiter-M02001");
            const widths = getContainerEl("#fixedWidths-M02001");
            if (delimiter) delimiter.disabled = !["csv", "delimited"].includes(type);
            if (widths) widths.disabled = type !== "fixed";
            if (type === "tsv" && delimiter) delimiter.value = "\\t";
            if (type === "csv" && delimiter) delimiter.value = ",";
        },

        buildUploadFormData() {
            const file = getContainerEl("#uploadFile-M02001")?.files?.[0];
            if (!file) {
                alert("Select a file first.");
                return null;
            }
            const formData = new FormData();
            formData.append("file", file);
            formData.append("fileType", getContainerEl("#fileType-M02001")?.value || "csv");
            const delimiter = getContainerEl("#delimiter-M02001")?.value || ",";
            formData.append("delimiter", delimiter === "\\t" ? "\t" : delimiter);
            formData.append("fixedWidths", getContainerEl("#fixedWidths-M02001")?.value || "");
            formData.append("hasHeader", getContainerEl("#hasHeader-M02001")?.value || "Y");
            formData.append("encoding", getContainerEl("#encoding-M02001")?.value || "utf-8-sig");
            formData.append("projectCode", this.getSelectedProject()?.PROJECT_CODE || "");
            formData.append("tableComment", getContainerEl("#tableComment-M02001")?.value || "");
            formData.append("tableNameRule", getContainerEl("#tableIdRule-M02001")?.value || "INITUP$_{LOGIN_ID}_{PROJECT_CODE}_{TIME}");
            return formData;
        },

        async requestForm(url, formData) {
            const headers = {};
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId) {
                headers["X-Target-Connection-Id"] = targetConnectionId;
            }
            try {
                const loginUser = JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
                if (loginUser.userId) {
                    headers["X-Login-User-Id"] = String(loginUser.userId);
                }
                if (loginUser.loginId) {
                    headers["X-Login-Id"] = String(loginUser.loginId);
                }
                if (loginUser.email) {
                    headers["X-Login-Email"] = String(loginUser.email);
                }
                if (loginUser.roleCode) {
                    headers["X-Login-Role-Code"] = String(loginUser.roleCode);
                }
            } catch (error) {
                // The backend will return a clear 401 if the login context is missing.
            }
            const response = await fetch(url, { method: "POST", headers, body: formData });
            if (!response.ok) {
                const errorJson = await response.json().catch(() => ({}));
                throw new Error(CommonUtils.formatErrorMessage(errorJson));
            }
            window.PageManager?.extendSession?.();
            return response.json();
        },

        async previewFile() {
            if (!this.ensureWorkContextSelected()) return;
            const grid = getContainerEl("#previewGrid-M02001");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading preview...</div>`;
            try {
                const formData = this.buildUploadFormData();
                if (!formData) return;
                const json = await this.requestForm(`${API_BASE_URL}/${PAGE_CODE}/preview`, formData);
                this.renderGrid("#previewGrid-M02001", json.data || [], "preview", json.columns || []);
            } catch (error) {
                this.renderError("#previewGrid-M02001", error.message);
            }
        },

        async uploadFile() {
            if (!this.ensureWorkContextSelected()) return;
            this.setUploading(true);
            this.showUploadProgress("Preparing upload...", 0);
            try {
                const formData = this.buildUploadFormData();
                if (!formData) {
                    this.setUploading(false);
                    return;
                }
                const json = await this.requestFormWithProgress(`${API_BASE_URL}/${PAGE_CODE}/upload`, formData);
                this.uploadedTableName = json.tableName || "";
                this.setValue("#uploadedTableId-M02001", this.uploadedTableName);
                const statsText = json.statsGathered ? " Statistics gathered." : (json.statsMessage ? ` ${json.statsMessage}` : "");
                this.setText("#uploadDescription-M02001", `${this.uploadedTableName} loaded. Rows: ${json.rowCount ?? 0}.${statsText}`);
                this.showUploadProgress(`Upload completed. Rows: ${json.rowCount ?? 0}.${statsText}`, 100);
                this.setDefaultSql();
                this.switchUploadView("table");
                await this.loadUploadTableTree(this.uploadedTableName);
                await this.selectUploadTable(this.uploadedTableName);
                alert("File uploaded.");
            } catch (error) {
                this.showUploadProgress(error.message || "Upload failed.", 100);
                alert(error.message || "Upload failed.");
            } finally {
                this.setUploading(false);
            }
        },

        requestFormWithProgress(url, formData) {
            const headers = this.buildUploadHeaders();
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", url, true);
                Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
                xhr.upload.onprogress = (event) => {
                    if (!event.lengthComputable) {
                        this.showUploadProgress("Uploading file...", 5);
                        return;
                    }
                    const percent = Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 95)));
                    this.showUploadProgress("Uploading file...", percent);
                };
                xhr.upload.onload = () => {
                    this.showUploadProgress("File transfer completed. Server is inserting rows in batches...", 96, { processing: true });
                };
                xhr.onload = () => {
                    const json = this.parseXhrJson(xhr);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        window.PageManager?.extendSession?.();
                        resolve(json);
                        return;
                    }
                    reject(new Error(CommonUtils.formatErrorMessage(json)));
                };
                xhr.onerror = () => reject(new Error("Upload request failed."));
                xhr.onabort = () => reject(new Error("Upload request was aborted."));
                this.showUploadProgress("Uploading file...", 1);
                xhr.send(formData);
            });
        },

        buildUploadHeaders() {
            const headers = {};
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId) {
                headers["X-Target-Connection-Id"] = targetConnectionId;
            }
            try {
                const loginUser = JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
                if (loginUser.userId) headers["X-Login-User-Id"] = String(loginUser.userId);
                if (loginUser.loginId) headers["X-Login-Id"] = String(loginUser.loginId);
                if (loginUser.email) headers["X-Login-Email"] = String(loginUser.email);
                if (loginUser.roleCode) headers["X-Login-Role-Code"] = String(loginUser.roleCode);
            } catch (error) {
                // Backend validates login context.
            }
            return headers;
        },

        parseXhrJson(xhr) {
            try {
                return JSON.parse(xhr.responseText || "{}");
            } catch (error) {
                return {};
            }
        },

        showUploadProgress(label, percent, options = {}) {
            const box = getContainerEl("#uploadProgress-M02001");
            const labelEl = getContainerEl("#uploadProgressLabel-M02001");
            const percentEl = getContainerEl("#uploadProgressPercent-M02001");
            const bar = getContainerEl("#uploadProgressBar-M02001");
            const value = Math.max(0, Math.min(100, Number(percent) || 0));
            if (box) {
                box.hidden = false;
                box.classList.toggle("is-processing", Boolean(options.processing));
            }
            if (labelEl) labelEl.textContent = label || "";
            if (percentEl) percentEl.textContent = `${value}%`;
            if (bar) bar.style.width = `${value}%`;
        },

        handleTableIdKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.reloadUploadedTable();
        },

        async reloadUploadedTable() {
            this.uploadedTableName = (getContainerEl("#uploadedTableId-M02001")?.value || "").trim().toUpperCase();
            this.setValue("#uploadedTableId-M02001", this.uploadedTableName);
            this.setDefaultSql();
            if (this.activeTab === "data") {
                await this.loadTableData();
                return;
            }
            if (this.activeTab === "sql") return;
            await this.loadColumns();
        },

        async dropUploadedTable() {
            const tableName = (getContainerEl("#uploadedTableId-M02001")?.value || "").trim().toUpperCase();
            if (!tableName) {
                alert("Enter a table ID first.");
                return;
            }
            if (!tableName.startsWith("INITUP$_")) {
                alert("Only upload tables starting with INITUP$_ can be deleted.");
                return;
            }
            if (!(await CommonMessage.confirm(`${tableName} table will be dropped. Continue?`))) return;
            try {
                await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/drop-table`, {
                    method: "POST",
                    body: { tableName }
                });
                this.uploadedTableName = "";
                this.setValue("#uploadedTableId-M02001", "");
                this.setText("#uploadDescription-M02001", "Upload a file to create a temporary table.");
                this.setValue("#sqlEditor-M02001", "");
                this.renderGrid("#columnsGrid-M02001", [], "columns");
                this.renderGrid("#dataGrid-M02001", [], "data");
                this.renderGrid("#sqlGrid-M02001", [], "sql");
                await this.loadUploadTableTree();
                alert("Upload table deleted.");
            } catch (error) {
                alert(error.message || "Delete failed.");
            }
        },

        switchUploadView(viewName) {
            if (this.isUploading && viewName === "table") {
                this.setText("#uploadDescription-M02001", "Upload is still running. The Table tab will open automatically after completion.");
                return;
            }
            this.activeUploadView = viewName || "file";
            getContainerEl(".upload-view-tabs")?.querySelectorAll(".table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.uploadView === this.activeUploadView);
            });
            getContainerEl(".upload-workbench-panel")?.querySelectorAll(".upload-view-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.uploadPanel === this.activeUploadView);
            });
            if (this.activeUploadView === "table") {
                this.loadUploadTableTree(this.uploadedTableName);
            }
            if (this.activeUploadView === "table" && this.uploadedTableName && this.activeTab === "data") {
                this.loadTableData();
            }
        },

        setUploading(isUploading) {
            this.isUploading = Boolean(isUploading);
            const tableTab = getContainerEl('.upload-view-tabs [data-upload-view="table"]');
            if (tableTab) {
                tableTab.disabled = this.isUploading;
                tableTab.classList.toggle("is-disabled", this.isUploading);
                tableTab.title = this.isUploading ? "Upload is running. This tab opens after completion." : "";
            }
        },

        async loadUploadTableTree(preferredTableName = "") {
            const container = getContainerEl("#uploadTableTree-M02001");
            if (!container) return;
            if (!this.selectedProjectId) {
                this.uploadTables = [];
                this.displayedUploadTables = [];
                container.innerHTML = `
                    <div class="table-empty">Select project first.</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `<div class="table-empty">Loading uploaded tables...</div>`;
            try {
                this.setUploadTableSearchPrefix(false);
                const params = new URLSearchParams({
                    projectCode: this.getSelectedProjectCode(),
                    tablePrefix: getContainerEl("#uploadTableSearch-M02001")?.value || this.getUploadTableSearchPrefix()
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/upload-table-tree?${params.toString()}`, { method: "GET", showLoading: false });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || "Upload table list load failed.");
                }
                this.uploadTables = Array.isArray(json.data) ? json.data : [];
                this.displayedUploadTables = this.uploadTables;
                if (preferredTableName) this.focusedUploadTableKey = String(preferredTableName).toUpperCase();
                this.renderUploadTableTree();
                if (this.focusedUploadTableKey) this.scrollToUploadTableRow(this.focusedUploadTableKey);
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Upload table list load failed.")}</div>`;
            }
        },

        renderUploadTableTree() {
            const container = getContainerEl("#uploadTableTree-M02001");
            if (!container) return;

            const keyword = (getContainerEl("#uploadTableSearch-M02001")?.value || "").trim().toLowerCase();
            const rows = this.isUploadTableSearchFilterEnabled() && keyword
                ? this.uploadTables.filter((row) => this.isUploadTableSearchMatch(row, keyword))
                : this.uploadTables;
            this.displayedUploadTables = rows;

            if (!rows.length) {
                container.innerHTML = `
                    <div class="table-empty">No uploaded tables found.</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `
                <div class="table-tree-head">
                    <div>Table</div>
                    <div>Owner</div>
                </div>
                ${rows.map((row) => this.createUploadTableRow(row)).join("")}
                ${this.renderListFooter(rows.length)}
            `;
        },

        createUploadTableRow(row) {
            const tableName = row.TABLE_NAME || "";
            const owner = row.OWNER || "";
            const key = tableName;
            const selectedClass = key === (this.focusedUploadTableKey || this.uploadedTableName) ? "is-selected" : "";
            const comment = row.COMMENTS || "";
            return `
                <button type="button" class="table-tree-row ${selectedClass}" data-table-key="${this.escapeHtml(key)}" onclick="M02001.selectUploadTable('${this.escapeJs(tableName)}')">
                    <span class="table-tree-name" title="${this.escapeHtml(comment || tableName)}">
                        <span class="table-tree-physical">
                            <i class="fas fa-table"></i>
                            <span>${this.escapeHtml(tableName)}</span>
                        </span>
                        <span class="table-tree-comment">${this.escapeHtml(comment || "-")}</span>
                    </span>
                    <span class="table-tree-muted">${this.escapeHtml(owner || "-")}</span>
                </button>
            `;
        },

        async selectUploadTable(tableName) {
            const name = String(tableName || "").trim().toUpperCase();
            if (!name) return;
            this.uploadedTableName = name;
            this.focusedUploadTableKey = name;
            this.setValue("#uploadedTableId-M02001", name);
            const row = this.uploadTables.find((item) => item.TABLE_NAME === name);
            const desc = row
                ? `${row.OWNER || ""}.${row.TABLE_NAME} selected.`
                : `${name} selected.`;
            this.setText("#uploadDescription-M02001", desc);
            this.setDefaultSql();
            this.renderUploadTableTree();
            this.scrollToUploadTableRow(name);
            await this.loadColumns();
            if (this.activeTab === "data") {
                await this.loadTableData();
            }
        },

        handleUploadTableSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.loadUploadTableTree();
        },

        searchUploadTable(direction = "down") {
            const keyword = (getContainerEl("#uploadTableSearch-M02001")?.value || "").trim().toLowerCase();
            if (!keyword) {
                this.renderUploadTableTree();
                return;
            }
            const matches = this.displayedUploadTables.length
                ? this.displayedUploadTables
                : this.uploadTables.filter((row) => this.isUploadTableSearchMatch(row, keyword));
            if (!matches.length) return;
            const currentKey = this.focusedUploadTableKey || this.uploadedTableName || "";
            const currentIndex = matches.findIndex((row) => row.TABLE_NAME === currentKey);
            const nextIndex = direction === "up"
                ? (currentIndex <= 0 ? matches.length - 1 : currentIndex - 1)
                : (currentIndex < 0 || currentIndex >= matches.length - 1 ? 0 : currentIndex + 1);
            const next = matches[nextIndex];
            if (!next) return;
            this.focusedUploadTableKey = next.TABLE_NAME;
            this.renderUploadTableTree();
            this.scrollToUploadTableRow(next.TABLE_NAME);
        },

        isUploadTableSearchMatch(row, keyword) {
            return String(row.TABLE_NAME || "").toLowerCase().includes(keyword)
                || String(row.COMMENTS || "").toLowerCase().includes(keyword);
        },

        isUploadTableSearchFilterEnabled() {
            return Boolean(getContainerEl("#uploadTableSearchFilter-M02001")?.checked);
        },

        handleUploadTableSearchInput() {
            if (this.isUploadTableSearchFilterEnabled()) {
                this.focusedUploadTableKey = "";
                this.renderUploadTableTree();
            }
        },

        handleUploadTableSearchFilterChange() {
            this.focusedUploadTableKey = "";
            this.renderUploadTableTree();
        },

        scrollToUploadTableRow(tableKey) {
            const container = getContainerEl("#uploadTableTree-M02001");
            const target = Array.from(container?.querySelectorAll(".table-tree-row[data-table-key]") || [])
                .find((row) => row.dataset.tableKey === tableKey);
            if (!target) return;
            target.scrollIntoView({ block: "center" });
            target.focus();
        },

        switchTab(tabName) {
            this.activeTab = tabName;
            getContainerEl(".upload-table-tabs")?.querySelectorAll(".table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.tab === tabName);
            });
            getContainerEl('[data-upload-panel="table"]')?.querySelectorAll(".table-tab-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.panel === tabName);
            });
            if (!this.uploadedTableName) return;
            if (tabName === "data") this.loadTableData();
            if (tabName === "sql" && !getContainerEl("#sqlEditor-M02001")?.value.trim()) this.setDefaultSql();
        },

        async loadColumns() {
            if (!this.ensureUploadedTable()) return;
            const grid = getContainerEl("#columnsGrid-M02001");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading columns...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/columns`, {
                    method: "POST",
                    showLoading: false,
                    body: { tableName: this.uploadedTableName }
                });
                this.renderGrid("#columnsGrid-M02001", json.data || [], "columns", json.columns || []);
            } catch (error) {
                this.renderError("#columnsGrid-M02001", error.message);
            }
        },

        async loadTableData() {
            if (!this.ensureUploadedTable()) return;
            const limit = this.getLimit("#dataLimit-M02001");
            const grid = getContainerEl("#dataGrid-M02001");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading data...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data`, {
                    method: "POST",
                    showLoading: false,
                    body: { tableName: this.uploadedTableName, limit }
                });
                this.renderGrid("#dataGrid-M02001", json.data || [], "data", json.columns || []);
            } catch (error) {
                this.renderError("#dataGrid-M02001", error.message);
            }
        },

        async executeSql() {
            const sql = (getContainerEl("#sqlEditor-M02001")?.value || "").trim();
            if (!sql) {
                this.renderError("#sqlGrid-M02001", "No SQL statement found.");
                return;
            }
            const limit = this.getLimit("#sqlLimit-M02001");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql`, {
                    method: "POST",
                    showLoading: false,
                    body: { sql, limit }
                });
                this.renderGrid("#sqlGrid-M02001", json.data || [], "sql", json.columns || []);
            } catch (error) {
                this.renderError("#sqlGrid-M02001", error.message);
            }
        },

        handleSqlEditorKeydown(event) {
            if (!(event.ctrlKey && event.key === "Enter")) return;
            event.preventDefault();
            this.executeSql();
        },

        setDefaultSql() {
            if (!this.uploadedTableName) return;
            const editor = getContainerEl("#sqlEditor-M02001");
            if (editor) editor.value = `SELECT *\n  FROM "${this.uploadedTableName}"`;
        },

        ensureUploadedTable() {
            const inputValue = (getContainerEl("#uploadedTableId-M02001")?.value || "").trim().toUpperCase();
            this.uploadedTableName = inputValue || this.uploadedTableName;
            if (this.uploadedTableName) return true;
            this.renderError(`#${this.activeTab}Grid-M02001`, "Upload a file or enter a table ID first.");
            return false;
        },

        renderGrid(selector, rows, gridKey, explicitColumns = null) {
            const container = getContainerEl(selector);
            if (!container) return;
            this.gridData[gridKey] = Array.isArray(rows) ? rows : [];
            const columns = explicitColumns || Object.keys(rows?.[0] || {});
            if (!columns.length) {
                container.innerHTML = `
                    <div class="table-empty">No data.</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }
            container.innerHTML = `
                <table class="table-grid">
                    <thead>
                        <tr>
                            <th class="grid-row-no" title="No">No</th>
                            ${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${(rows || []).map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${rowIndex + 1}</td>
                                ${columns.map((column, index) => `<td title="${this.escapeHtml(Array.isArray(row) ? row[index] : row[column] ?? "")}">${this.escapeHtml(Array.isArray(row) ? row[index] : row[column] ?? "")}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                ${this.renderListFooter((rows || []).length)}
            `;
        }
    };

    window[PAGE_CODE] = M02001;
})();
