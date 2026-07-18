(function() {
    const PAGE_CODE = "M02001";
    const CONTEXT_STORAGE_KEY = "DATA_EDITING_WORK_CONTEXT";
    const LARGE_UPLOAD_THRESHOLD = 8 * 1024 * 1024;
    const DEFAULT_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
    const LARGE_TEXT_PREVIEW_SIZE = 4 * 1024 * 1024;
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
        uploadTableTreeLoaded: false,
        uploadTableTreeKey: "",
        activeUploadView: "file",
        activeTab: "columns",
        gridData: { preview: [], columns: [], data: [], sql: [] },
        gridState: { columns: "", data: "", sql: "" },
        gridFrozenColumns: { preview: 0, columns: 0, data: 0, sql: 0 },
        gridPages: { data: 1, sql: 1 },
        gridPageSizes: { data: 100, sql: 100 },
        gridTotals: { data: 0, sql: 0 },
        gridTotalPages: { data: 1, sql: 1 },
        sqlGridText: "",
        sqlKeydownBound: null,
        contextLoadFailed: false,
        isUploading: false,
        stagedUpload: null,

        async init() {
            if (this.isInit) return;
            this.sqlKeydownBound = this.handleSqlEditorKeydown.bind(this);
            getContainerEl("#sqlEditor-M02001")?.addEventListener("keydown", this.sqlKeydownBound);
            this.handleFileTypeChange();
            this.updateSelectedFileDisplay();
            await this.loadWorkContext();
            if (!this.contextLoadFailed) {
                this.renderGrid("#previewGrid-M02001", [], "preview");
                this.renderPreviewGridToolbar(0);
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
            this.uploadTableTreeLoaded = false;
            this.uploadTableTreeKey = "";
            this.activeUploadView = "file";
            this.activeTab = "columns";
            this.gridData = { preview: [], columns: [], data: [], sql: [] };
            this.gridState = { columns: "", data: "", sql: "" };
            this.gridFrozenColumns = { preview: 0, columns: 0, data: 0, sql: 0 };
            this.gridPages = { data: 1, sql: 1 };
            this.gridPageSizes = { data: 100, sql: 100 };
            this.gridTotals = { data: 0, sql: 0 };
            this.gridTotalPages = { data: 1, sql: 1 };
            this.sqlGridText = "";
            this.sqlKeydownBound = null;
            this.contextLoadFailed = false;
            this.isUploading = false;
            this.stagedUpload = null;
            this.updateSelectedMeta();
            this.isInit = false;
        },

        t(key, fallback = "") {
            return window.I18nManager?.tPage?.(PAGE_CODE, key, fallback) || fallback;
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
            select.innerHTML = `<option value="">${this.escapeHtml(this.t("loadingProjects", "Loading projects..."))}</option>`;
            try {
                this.contextLoadFailed = false;
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?keyword=`, { method: "GET", showLoading: false });
                this.contextProjects = Array.isArray(json.data)
                    ? json.data.filter((project) => project.USE_YN === "Y")
                    : [];
                this.renderContextProjects(preferredProjectId);
            } catch (error) {
                const message = error.message || this.t("projectLoadFailed", "Project load failed.");
                this.contextLoadFailed = true;
                this.contextProjects = [];
                this.selectedProjectId = "";
                select.innerHTML = `<option value="">${this.escapeHtml(this.t("projectLoadFailed", "Project load failed"))}</option>`;
                this.renderError("#previewGrid-M02001", message);
            }
        },

        renderContextProjects(preferredProjectId = "") {
            const select = getContainerEl("#contextProject-M02001");
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
            this.updateProjectMeta();
        },

        async handleContextProjectChange(projectId) {
            this.selectedProjectId = projectId || "";
            CommonUtils.applyOwnerScopeToSelect(getContainerEl("#contextProject-M02001"), this.contextProjects, this.selectedProjectId);
            this.saveStoredContext();
            this.updateProjectMeta();
            this.uploadTables = [];
            this.displayedUploadTables = [];
            this.focusedUploadTableKey = "";
            this.uploadedTableName = "";
            this.uploadTableTreeLoaded = false;
            this.uploadTableTreeKey = "";
            this.gridState = { columns: "", data: "", sql: "" };
            this.setValue("#uploadedTableId-M02001", "");
            this.setValue("#sqlEditor-M02001", "");
            this.renderGrid("#columnsGrid-M02001", [], "columns");
            this.renderGrid("#dataGrid-M02001", [], "data");
            this.renderGrid("#sqlGrid-M02001", [], "sql");
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

        openFilePicker() {
            getContainerEl("#uploadFile-M02001")?.click();
        },

        updateSelectedFileDisplay(fileName = "") {
            const nameEl = getContainerEl("#uploadFileName-M02001");
            if (!nameEl) return;
            const displayName = fileName || this.t("noFileSelected", "No file selected");
            nameEl.textContent = displayName;
            nameEl.title = displayName;
        },

        handleFileChange() {
            const file = getContainerEl("#uploadFile-M02001")?.files?.[0];
            this.updateSelectedFileDisplay(file?.name || "");
            this.applyDetectedEncoding(null);
            this.stagedUpload = null;
            this.resetUploadProgress();
            const commentInput = getContainerEl("#tableComment-M02001");
            if (file && commentInput) {
                commentInput.value = this.getFileBaseName(file.name);
            }
            if (file) {
                this.applyFileTypeFromName(file.name);
            }
            this.renderGrid("#previewGrid-M02001", [], "preview");
            this.renderPreviewGridToolbar(0);
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

        buildUploadFormData(options = {}) {
            const file = getContainerEl("#uploadFile-M02001")?.files?.[0];
            if (!file) {
                alert("Select a file first.");
                return null;
            }
            const formData = new FormData();
            if (options.includeFile !== false) formData.append("file", file);
            formData.append("fileType", getContainerEl("#fileType-M02001")?.value || "csv");
            const delimiter = getContainerEl("#delimiter-M02001")?.value || ",";
            formData.append("delimiter", delimiter === "\\t" ? "\t" : delimiter);
            formData.append("fixedWidths", getContainerEl("#fixedWidths-M02001")?.value || "");
            formData.append("hasHeader", getContainerEl("#hasHeader-M02001")?.value || "Y");
            formData.append("encoding", getContainerEl("#encoding-M02001")?.value || "auto");
            formData.append("projectId", this.selectedProjectId || "");
            formData.append("projectCode", this.getSelectedProject()?.PROJECT_CODE || "");
            formData.append("tableComment", getContainerEl("#tableComment-M02001")?.value || "");
            formData.append("tableNameRule", getContainerEl("#tableIdRule-M02001")?.value || "INITUP$_{LOGIN_ID}_{PROJECT_CODE}_{TIME}");
            return formData;
        },

        getSelectedUploadFile() {
            return getContainerEl("#uploadFile-M02001")?.files?.[0] || null;
        },

        isLargeUpload(file) {
            return Number(file?.size || 0) > LARGE_UPLOAD_THRESHOLD;
        },

        getSelectedFileType() {
            return getContainerEl("#fileType-M02001")?.value || "csv";
        },

        getUploadFileKey(file) {
            return [file?.name || "", file?.size || 0, file?.lastModified || 0].join(":");
        },

        async ensureStagedUpload(file) {
            const fileKey = this.getUploadFileKey(file);
            if (this.stagedUpload?.fileKey === fileKey && this.stagedUpload?.uploadId) {
                return this.stagedUpload.uploadId;
            }

            this.stagedUpload = null;
            this.showUploadProgress(this.t("preparingUpload", "Preparing upload..."), 1);
            const session = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/upload-session`, {
                method: "POST",
                body: { fileName: file.name, fileSize: file.size },
                showLoading: false
            });
            const uploadId = session.uploadId;
            const chunkSize = Math.max(256 * 1024, Number(session.chunkSize) || DEFAULT_UPLOAD_CHUNK_SIZE);
            if (!uploadId) throw new Error(this.t("uploadSessionFailed", "Could not create an upload session."));

            try {
                if (file.size === 0) {
                    this.showUploadProgress(this.t("fileTransferCompleted", "File transfer completed. Server is inserting rows in batches..."), 95);
                }
                for (let offset = 0; offset < file.size; offset += chunkSize) {
                    const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
                    await this.sendUploadChunk(uploadId, chunk, offset, file.size);
                }
            } catch (error) {
                this.stagedUpload = null;
                throw error;
            }

            this.stagedUpload = { uploadId, fileKey };
            return uploadId;
        },

        sendUploadChunk(uploadId, chunk, offset, totalSize) {
            const headers = this.buildUploadHeaders();
            const formData = new FormData();
            formData.append("uploadId", uploadId);
            formData.append("offset", String(offset));
            formData.append("chunk", chunk, "upload.chunk");
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", `${API_BASE_URL}/${PAGE_CODE}/upload-chunk`, true);
                xhr.withCredentials = true;
                Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
                xhr.upload.onprogress = (event) => {
                    const chunkLoaded = event.lengthComputable ? event.loaded : 0;
                    const transferred = Math.min(totalSize, offset + chunkLoaded);
                    const percent = totalSize > 0 ? Math.max(1, Math.min(95, Math.round((transferred / totalSize) * 95))) : 95;
                    this.showUploadProgress(this.tl(
                        "uploadingFileProgress",
                        "Uploading file... {loaded} / {total}",
                        { loaded: this.formatUploadSize(transferred), total: this.formatUploadSize(totalSize) }
                    ), percent);
                };
                xhr.onload = () => {
                    const json = this.parseXhrJson(xhr);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(json);
                        return;
                    }
                    reject(new Error(this.formatUploadRequestError(json, xhr.status, xhr.statusText)));
                };
                xhr.onerror = () => reject(new Error(this.t("uploadRequestFailed", "Upload request failed.")));
                xhr.onabort = () => reject(new Error(this.t("uploadRequestAborted", "Upload request was aborted.")));
                xhr.send(formData);
            });
        },

        async requestForm(url, formData) {
            const headers = {};
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId) {
                headers["X-Target-Connection-Id"] = targetConnectionId;
            }
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: formData,
                credentials: "include"
            });
            const responseText = await response.text();
            const responseData = this.parseResponseJson(responseText);
            if (!response.ok) throw new Error(this.formatUploadRequestError(responseData, response.status, response.statusText));
            window.PageManager?.extendSessionFromResponse?.(response);
            return responseData;
        },

        async previewFile() {
            if (!this.ensureWorkContextSelected()) return;
            const grid = getContainerEl("#previewGrid-M02001");
            if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingPreview", "Loading preview..."))}</div>`;
            this.renderPreviewGridToolbar(null, this.t("loadingPreview", "Loading preview..."));
            this.revealPreviewGrid();
            try {
                const file = this.getSelectedUploadFile();
                if (!file) {
                    this.buildUploadFormData();
                    return;
                }
                const isLargeFile = this.isLargeUpload(file);
                const useStagedUpload = isLargeFile && this.getSelectedFileType() === "excel";
                const formData = this.buildUploadFormData({ includeFile: !isLargeFile });
                if (!formData) return;
                let previewUrl = `${API_BASE_URL}/${PAGE_CODE}/preview`;
                if (useStagedUpload) {
                    const uploadId = await this.ensureStagedUpload(file);
                    formData.append("uploadId", uploadId);
                    previewUrl = `${API_BASE_URL}/${PAGE_CODE}/preview-staged`;
                } else if (isLargeFile) {
                    formData.append("file", file.slice(0, LARGE_TEXT_PREVIEW_SIZE), file.name);
                }
                const json = await this.requestForm(previewUrl, formData);
                this.applyDetectedEncoding(json?.detectedEncoding);
                this.renderGrid("#previewGrid-M02001", json.data || [], "preview", json.columns || []);
                this.renderPreviewGridToolbar((json.data || []).length);
                this.revealPreviewGrid();
            } catch (error) {
                this.renderError("#previewGrid-M02001", error.message);
                this.renderPreviewGridToolbar(null, error.message || this.t("uploadFailed", "Upload failed."));
                this.revealPreviewGrid();
            }
        },

        revealPreviewGrid() {
            const grid = getContainerEl("#previewGrid-M02001");
            if (!grid) return;
            requestAnimationFrame(() => {
                grid.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
            });
        },

        async uploadFile() {
            if (!this.ensureWorkContextSelected()) return;
            this.setUploading(true);
            this.showUploadProgress(this.t("preparingUpload", "Preparing upload..."), 0);
            try {
                const file = this.getSelectedUploadFile();
                if (!file) {
                    this.buildUploadFormData();
                    this.setUploading(false);
                    return;
                }
                const useStagedUpload = this.isLargeUpload(file);
                const formData = this.buildUploadFormData({ includeFile: !useStagedUpload });
                if (!formData) {
                    this.setUploading(false);
                    return;
                }
                let uploadUrl = `${API_BASE_URL}/${PAGE_CODE}/upload`;
                if (useStagedUpload) {
                    const uploadId = await this.ensureStagedUpload(file);
                    formData.append("uploadId", uploadId);
                    uploadUrl = `${API_BASE_URL}/${PAGE_CODE}/upload-staged`;
                }
                const json = await this.requestFormWithProgress(uploadUrl, formData);
                this.applyDetectedEncoding(json?.detectedEncoding);
                if (useStagedUpload) this.stagedUpload = null;
                this.uploadedTableName = json.tableName || "";
                this.setValue("#uploadedTableId-M02001", this.uploadedTableName);
                const statsText = json.statsGathered ? this.t("statisticsGathered", " Statistics gathered.") : (json.statsMessage ? ` ${json.statsMessage}` : "");
                this.showUploadProgress(this.tl("uploadCompleted", "Upload completed. Rows: {count}.{suffix}", { count: json.rowCount ?? 0, suffix: statsText }), 100);
                this.markGridStale();
                this.setDefaultSql(true);
                this.switchUploadView("table", { skipAutoLoad: true });
                await this.loadUploadTableTree(this.uploadedTableName);
                await this.selectUploadTable(this.uploadedTableName);
                alert("File uploaded.");
            } catch (error) {
                this.showUploadProgress(error.message || this.t("uploadFailed", "Upload failed."), 100);
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
                xhr.withCredentials = true;
                Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
                xhr.upload.onprogress = (event) => {
                    if (!event.lengthComputable) {
                        this.showUploadProgress(this.t("uploadingFile", "Uploading file..."), 5);
                        return;
                    }
                    const percent = Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 95)));
                    this.showUploadProgress(this.t("uploadingFile", "Uploading file..."), percent);
                };
                xhr.upload.onload = () => {
                    this.showUploadProgress(this.t("fileTransferCompleted", "File transfer completed. Server is inserting rows in batches..."), 96, { processing: true });
                };
                xhr.onload = () => {
                    const json = this.parseXhrJson(xhr);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        window.PageManager?.extendSession?.();
                        resolve(json);
                        return;
                    }
                    reject(new Error(this.formatUploadRequestError(json, xhr.status, xhr.statusText)));
                };
                xhr.onerror = () => reject(new Error(this.t("uploadRequestFailed", "Upload request failed.")));
                xhr.onabort = () => reject(new Error(this.t("uploadRequestAborted", "Upload request was aborted.")));
                this.showUploadProgress(this.t("uploadingFile", "Uploading file..."), 1);
                xhr.send(formData);
            });
        },

        buildUploadHeaders() {
            const headers = {};
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId) {
                headers["X-Target-Connection-Id"] = targetConnectionId;
            }
            return headers;
        },

        parseXhrJson(xhr) {
            return this.parseResponseJson(xhr.responseText || "");
        },

        parseResponseJson(responseText) {
            try {
                return JSON.parse(responseText || "{}");
            } catch (error) {
                return { rawMessage: String(responseText || "").trim() };
            }
        },

        formatUploadRequestError(responseData, status, statusText) {
            if (Number(status) === 413) {
                return this.t("uploadTooLarge", "The upload was rejected because it exceeds the server or proxy size limit.");
            }
            const formatted = CommonUtils.formatErrorMessage(responseData || {}, { status });
            if (formatted && formatted !== "Request failed.") return formatted;
            const rawMessage = String(responseData?.rawMessage || "").trim();
            if (rawMessage && !/^\s*</.test(rawMessage)) return rawMessage.slice(0, 500);
            const statusLabel = [status, statusText].filter(Boolean).join(" ");
            return statusLabel
                ? this.tl("uploadHttpError", "Upload request failed ({status}).", { status: statusLabel })
                : this.t("uploadRequestFailed", "Upload request failed.");
        },

        applyDetectedEncoding(detectedEncoding) {
            const input = getContainerEl("#encoding-M02001");
            if (!input) return;
            const detected = String(detectedEncoding || "").trim();
            input.dataset.detectedEncoding = detected;
            input.title = detected
                ? this.tl("detectedEncodingTitle", "Detected encoding: {encoding}", { encoding: detected })
                : "";
        },

        formatUploadSize(bytes) {
            const value = Math.max(0, Number(bytes) || 0);
            if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
            if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
            return `${value} B`;
        },

        resetUploadProgress() {
            const box = getContainerEl("#uploadProgress-M02001");
            const labelEl = getContainerEl("#uploadProgressLabel-M02001");
            const percentEl = getContainerEl("#uploadProgressPercent-M02001");
            const bar = getContainerEl("#uploadProgressBar-M02001");
            if (box) {
                box.hidden = true;
                box.classList.remove("is-processing");
                box.setAttribute("aria-valuenow", "0");
                box.setAttribute("aria-busy", "false");
            }
            if (labelEl) labelEl.textContent = this.t("ready", "Ready");
            if (percentEl) percentEl.textContent = "0%";
            if (bar) bar.style.width = "0%";
        },

        showUploadProgress(label, percent, options = {}) {
            const box = getContainerEl("#uploadProgress-M02001");
            const labelEl = getContainerEl("#uploadProgressLabel-M02001");
            const percentEl = getContainerEl("#uploadProgressPercent-M02001");
            const bar = getContainerEl("#uploadProgressBar-M02001");
            const value = Math.max(0, Math.min(100, Number(percent) || 0));
            if (box) {
                const wasHidden = box.hidden;
                box.hidden = false;
                box.classList.toggle("is-processing", Boolean(options.processing));
                box.setAttribute("aria-valuenow", String(value));
                box.setAttribute("aria-busy", value < 100 ? "true" : "false");
                if (wasHidden) {
                    requestAnimationFrame(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }));
                }
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
            const previousTableName = this.uploadedTableName;
            this.uploadedTableName = (getContainerEl("#uploadedTableId-M02001")?.value || "").trim().toUpperCase();
            this.setValue("#uploadedTableId-M02001", this.uploadedTableName);
            if (previousTableName !== this.uploadedTableName) {
                this.focusedUploadTableKey = this.uploadedTableName;
                this.markGridStale();
                this.setDefaultSql(true);
            } else {
                this.setDefaultSql();
            }
            if (this.activeTab === "data") {
                await this.loadTableData({ force: true });
                return;
            }
            if (this.activeTab === "sql") return;
            await this.loadColumns({ force: true });
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
                this.setValue("#sqlEditor-M02001", "");
                this.markGridStale();
                this.renderGrid("#columnsGrid-M02001", [], "columns");
                this.renderGrid("#dataGrid-M02001", [], "data");
                this.renderGrid("#sqlGrid-M02001", [], "sql");
                await this.loadUploadTableTree();
                alert("Upload table deleted.");
            } catch (error) {
                alert(error.message || "Delete failed.");
            }
        },

        switchUploadView(viewName, options = {}) {
            if (this.isUploading && viewName === "table") {
                return;
            }
            this.activeUploadView = viewName || "file";
            getContainerEl(".upload-view-tabs")?.querySelectorAll(".table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.uploadView === this.activeUploadView);
            });
            getContainerEl(".upload-view-tabs")?.parentElement?.querySelectorAll(".upload-view-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.uploadPanel === this.activeUploadView);
            });
            if (this.activeUploadView === "table" && !options.skipAutoLoad && !this.isUploadTableTreeCurrent()) {
                this.loadUploadTableTree(this.uploadedTableName);
            }
            if (this.activeUploadView === "table" && this.uploadedTableName && this.activeTab === "data" && !this.isGridCurrent("data", this.getDataGridKey())) {
                this.loadTableData();
            }
        },

        setUploading(isUploading) {
            this.isUploading = Boolean(isUploading);
            const tableTab = getContainerEl('.upload-view-tabs [data-upload-view="table"]');
            if (tableTab) {
                tableTab.disabled = this.isUploading;
                tableTab.classList.toggle("is-disabled", this.isUploading);
                tableTab.title = this.isUploading ? this.t("uploadRunningTabTitle", "Upload is running. This tab opens after completion.") : "";
            }
        },

        async loadUploadTableTree(preferredTableName = "") {
            const container = getContainerEl("#uploadTableTree-M02001");
            if (!container) return;
            if (!this.selectedProjectId) {
                this.uploadTables = [];
                this.displayedUploadTables = [];
                this.uploadTableTreeLoaded = false;
                this.uploadTableTreeKey = "";
                container.innerHTML = `
                    <div class="table-empty">${this.escapeHtml(this.t("selectProjectFirstShort", "Select project first."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingUploadTables", "Loading uploaded tables..."))}</div>`;
            try {
                this.setUploadTableSearchPrefix(false);
                const params = new URLSearchParams({
                    projectId: this.selectedProjectId,
                    projectCode: this.getSelectedProjectCode(),
                    tablePrefix: getContainerEl("#uploadTableSearch-M02001")?.value || this.getUploadTableSearchPrefix()
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/upload-table-tree?${params.toString()}`, { method: "GET", showLoading: false });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || this.t("uploadTableListLoadFailed", "Upload table list load failed."));
                }
                this.uploadTables = Array.isArray(json.data) ? json.data : [];
                if (json.tablePrefix) {
                    const searchInput = getContainerEl("#uploadTableSearch-M02001");
                    if (searchInput) {
                        searchInput.value = json.tablePrefix;
                        searchInput.placeholder = json.tablePrefix;
                    }
                }
                this.displayedUploadTables = this.uploadTables;
                this.uploadTableTreeLoaded = true;
                this.uploadTableTreeKey = this.getUploadTableTreeKey();
                if (preferredTableName) this.focusedUploadTableKey = String(preferredTableName).toUpperCase();
                this.renderUploadTableTree();
                if (this.focusedUploadTableKey) this.scrollToUploadTableRow(this.focusedUploadTableKey);
            } catch (error) {
                this.uploadTableTreeLoaded = false;
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || this.t("uploadTableListLoadFailed", "Upload table list load failed."))}</div>`;
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
                    <div class="table-empty">${this.escapeHtml(this.t("noUploadedTablesFound", "No uploaded tables found."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            container.innerHTML = `
                <div class="table-tree-scroll-body">
                    <div class="table-tree-head">
                        <div>${this.escapeHtml(this.t("table", "Table"))}</div>
                        <div>${this.escapeHtml(this.t("owner", "Owner"))}</div>
                    </div>
                    ${rows.map((row) => this.createUploadTableRow(row)).join("")}
                </div>
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
            const previousTableName = this.uploadedTableName;
            const isSameTable = previousTableName === name;
            this.uploadedTableName = name;
            this.focusedUploadTableKey = name;
            this.setValue("#uploadedTableId-M02001", name);
            const row = this.uploadTables.find((item) => item.TABLE_NAME === name);
            if (!isSameTable) {
                this.markGridStale();
                this.setDefaultSql(true);
            } else {
                this.setDefaultSql();
            }
            this.updateSelectedMeta(row);
            this.renderUploadTableTree();
            this.scrollToUploadTableRow(name);
            if (!this.isGridCurrent("columns", this.getColumnsGridKey())) {
                await this.loadColumns();
            }
            if (this.activeTab === "data" && !this.isGridCurrent("data", this.getDataGridKey())) {
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

        updateSelectedMeta(row = null) {
            const selected = row || this.uploadTables.find((item) => item.TABLE_NAME === this.uploadedTableName) || null;
            this.setText("#selectedOwner-M02001", selected?.OWNER || "-");
            this.setText("#selectedTable-M02001", selected?.TABLE_NAME || this.uploadedTableName || "-");
            this.setText("#selectedCreatedAt-M02001", this.formatKstDateTime(selected?.CREATED_AT));
            this.setText("#selectedComment-M02001", selected?.COMMENTS || "-");
            const desc = selected
                ? `${selected.OWNER || "-"}.${selected.TABLE_NAME || this.uploadedTableName || "-"}`
                : this.t("selectUploadTableFromExplorer", "Select a table from the explorer.");
            this.setText("#tableDescription-M02001", desc);
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
            if (tabName === "data" && !this.isGridCurrent("data", this.getDataGridKey())) this.loadTableData();
            if (tabName === "sql") {
                if (!getContainerEl("#sqlEditor-M02001")?.value.trim()) this.setDefaultSql();
            }
        },

        async loadColumns(options = {}) {
            if (!this.ensureUploadedTable()) return;
            const gridKey = this.getColumnsGridKey();
            if (!options.force && this.isGridCurrent("columns", gridKey)) return;
            const grid = getContainerEl("#columnsGrid-M02001");
            if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingColumns", "Loading columns..."))}</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/columns`, {
                    method: "POST",
                    showLoading: false,
                    body: { tableName: this.uploadedTableName }
                });
                this.renderGrid("#columnsGrid-M02001", json.data || [], "columns", json.columns || []);
                this.renderColumnsGridToolbar(json.total || (json.data || []).length);
                this.gridState.columns = gridKey;
            } catch (error) {
                this.gridState.columns = "";
                this.renderError("#columnsGrid-M02001", error.message);
            }
        },

        async loadTableData(options = {}) {
            if (!this.ensureUploadedTable()) return;
            const limit = this.gridPageSizes.data || 100;
            const page = Math.max(1, Number(options.page || 1));
            const gridKey = this.getDataGridKey(limit);
            if (!options.force && this.isGridCurrent("data", gridKey)) return;
            const grid = getContainerEl("#dataGrid-M02001");
            if (grid) grid.innerHTML = `<div class="table-empty">${this.escapeHtml(this.t("loadingData", "Loading data..."))}</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/data`, {
                    method: "POST",
                    showLoading: false,
                    body: { tableName: this.uploadedTableName, limit, page }
                });
                this.gridPages.data = Number(json.page || page); this.gridPageSizes.data = Number(json.pageSize || limit); this.gridTotals.data = Number(json.total || 0); this.gridTotalPages.data = Number(json.totalPages || 1);
                this.renderGrid("#dataGrid-M02001", json.data || [], "data", json.columns || []);
                this.renderGridPager("data");
                const message = getContainerEl("#dataGridMessage-M02001");
                if (message) message.textContent = `${(json.data || []).length.toLocaleString()} rows selected.`;
                this.gridState.data = gridKey;
            } catch (error) {
                this.gridState.data = "";
                this.renderError("#dataGrid-M02001", error.message);
            }
        },

        async executeSql(page = 1) {
            const executable = this.getExecutableSqlFromEditor();
            if (!executable.sql) {
                this.renderSqlMessage(this.t("noSqlAtCursor", "No SQL statement found at the cursor."), "error");
                this.renderError("#sqlGrid-M02001", this.t("noSqlAtCursor", "No SQL statement found at the cursor."));
                return;
            }
            const sql = executable.sql;
            if (!this.validateSelectSql(sql)) {
                this.renderSqlMessage("Only a single SELECT statement is allowed.", "error");
                this.renderError("#sqlGrid-M02001", "Only a single SELECT statement is allowed.");
                this.restoreSqlSelection(executable);
                return;
            }

            this.restoreSqlSelection(executable);
            const limit = this.gridPageSizes.sql || 100;
            const gridKey = this.getSqlGridKey(sql, limit);
            const grid = getContainerEl("#sqlGrid-M02001");
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
                this.sqlGridText = sql; this.gridPages.sql = Number(json.page || page); this.gridPageSizes.sql = Number(json.pageSize || limit); this.gridTotals.sql = Number(json.total || 0); this.gridTotalPages.sql = Number(json.totalPages || 1);
                this.renderGrid("#sqlGrid-M02001", json.data || [], "sql", json.columns || []);
                this.renderGridPager("sql");
                this.gridState.sql = gridKey;
            } catch (error) {
                const elapsedMs = Math.round(performance.now() - startedAt);
                this.gridState.sql = "";
                this.renderSqlMessage(`${error.message || "SQL execution failed."} (${elapsedMs.toLocaleString()} ms)`, "error");
                this.renderError("#sqlGrid-M02001", error.message);
            } finally {
                this.restoreSqlSelection(executable);
            }
        },

        renderSqlMessage(message, type = "info") {
            const element = getContainerEl("#sqlMessage-M02001");
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
            const editor = getContainerEl("#sqlEditor-M02001");
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
            const editor = getContainerEl("#sqlEditor-M02001");
            if (!editor || !selection) return;
            editor.focus();
            editor.setSelectionRange(selection.selectionStart, selection.selectionEnd);
        },

        setDefaultSql(force = false) {
            if (!this.uploadedTableName) return;
            const editor = getContainerEl("#sqlEditor-M02001");
            if (editor && (force || !editor.value.trim())) {
                const row = this.uploadTables.find((item) => item.TABLE_NAME === this.uploadedTableName) || null;
                const tableRef = row?.OWNER
                    ? `${this.quoteName(row.OWNER)}.${this.quoteName(this.uploadedTableName)}`
                    : this.quoteName(this.uploadedTableName);
                editor.value = `SELECT *\n  FROM ${tableRef};`;
            }
        },

        validateSelectSql(sql) {
            const text = sql.trim().replace(/;+\s*$/, "");
            if (!/^(select|with)\b/i.test(text)) return false;
            return !/;\s*\S/.test(sql);
        },

        quoteName(name) {
            return `"${String(name || "").replace(/"/g, "\"\"")}"`;
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
                const [, year, month, day, hour, minute, second] = match;
                if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
                    const parsedWithZone = new Date(text);
                    return Number.isNaN(parsedWithZone.getTime()) ? null : parsedWithZone;
                }
                return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
            }
            const parsed = new Date(text);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        },

        getUploadTableTreeKey() {
            return [
                this.selectedProjectId || "",
                this.getSelectedProjectCode() || "",
                getContainerEl("#uploadTableSearch-M02001")?.value || this.getUploadTableSearchPrefix()
            ].join("|");
        },

        isUploadTableTreeCurrent() {
            return this.uploadTableTreeLoaded && this.uploadTableTreeKey === this.getUploadTableTreeKey();
        },

        getColumnsGridKey() {
            return this.uploadedTableName || "";
        },

        getDataGridKey(limit = this.gridPageSizes.data || 100) {
            return `${this.uploadedTableName || ""}|${limit}`;
        },

        getSqlGridKey(sql = getContainerEl("#sqlEditor-M02001")?.value || "", limit = this.gridPageSizes.sql || 100) {
            return `${String(sql || "").trim()}|${limit}`;
        },

        isGridCurrent(gridKey, stateKey) {
            return Boolean(stateKey) && this.gridState?.[gridKey] === stateKey;
        },

        markGridStale(keys = ["columns", "data", "sql"]) {
            keys.forEach((key) => {
                if (this.gridState[key] !== undefined) this.gridState[key] = "";
            });
        },

        renderGridPager(gridKey) {
            const host = getContainerEl(`#${gridKey}GridPager-M02001`);
            if (!host) return;
            CommonUtils.renderServerPager(host, {
                visible: true, page: this.gridPages[gridKey], pageSize: this.gridPageSizes[gridKey], totalPages: this.gridTotalPages[gridKey],
                totalLabel: this.formatGridTotal(this.gridTotals[gridKey]),
                labels: { page: "Page", go: "Go", previousPage: "Previous page", nextPage: "Next page", rowsPerPage: "Rows per page" },
                onMove: (delta) => this.loadGridPage(gridKey, this.gridPages[gridKey] + delta),
                onGo: (page) => this.loadGridPage(gridKey, page),
                onPageSize: (size) => { this.gridPageSizes[gridKey] = Number(size || 100); this.loadGridPage(gridKey, 1); },
                trailingNumberControl: { label: this.t("freeze", "Freeze"), title: this.t("freezeColumnsTitle", "Freeze columns"), value: this.gridFrozenColumns[gridKey] || 0, min: 0, max: 50, onInput: (value) => { this.gridFrozenColumns[gridKey] = Number(value || 0); this.applyGridFrozenColumns(gridKey); } }
            });
        },

        renderColumnsGridToolbar(total) {
            const message = getContainerEl("#columnsGridMessage-M02001");
            if (message) message.textContent = this.formatGridTotal(total);
            const controls = getContainerEl("#columnsGridControls-M02001");
            if (controls) controls.innerHTML = `<label class="table-limit-control grid-pager-number-control" title="${this.escapeHtml(this.t("freezeColumnsTitle", "Freeze No and selected data columns while scrolling horizontally."))}"><span>${this.escapeHtml(this.t("freeze", "Freeze"))}</span><input type="number" min="0" max="50" value="${this.gridFrozenColumns.columns || 0}" oninput="M02001.setGridFreeze('columns', this.value)"></label>`;
        },

        renderPreviewGridToolbar(total, statusText = "") {
            const message = getContainerEl("#previewGridMessage-M02001");
            if (message) {
                message.textContent = statusText || this.tl("previewRows", "Preview: {count} rows", {
                    count: Number(total || 0).toLocaleString()
                });
            }
            const controls = getContainerEl("#previewGridControls-M02001");
            if (controls) {
                controls.innerHTML = `<label class="table-limit-control grid-pager-number-control" title="${this.escapeHtml(this.t("freezeColumnsTitle", "Freeze columns"))}"><span>${this.escapeHtml(this.t("freeze", "Freeze"))}</span><input id="previewGridFreeze-M02001" type="number" min="0" max="50" value="${this.gridFrozenColumns.preview || 0}" oninput="M02001.setGridFreeze('preview', this.value)"></label>`;
            }
        },

        formatGridTotal(total) {
            return this.t("gridTotal", "Total {count}").replace("{count}", Number(total || 0).toLocaleString());
        },

        setGridFreeze(gridKey, value) {
            this.gridFrozenColumns[gridKey] = Math.max(0, Number.parseInt(value || 0, 10) || 0);
            this.applyGridFrozenColumns(gridKey);
        },

        loadGridPage(gridKey, page) {
            const next = Math.max(1, Math.min(Number(this.gridTotalPages[gridKey] || 1), Number(page || 1)));
            if (gridKey === "data") return this.loadTableData({ force: true, page: next });
            const editor = getContainerEl("#sqlEditor-M02001");
            if (editor && this.sqlGridText) editor.value = this.sqlGridText;
            return this.executeSql(next);
        },

        ensureUploadedTable() {
            const inputValue = (getContainerEl("#uploadedTableId-M02001")?.value || "").trim().toUpperCase();
            this.uploadedTableName = inputValue || this.uploadedTableName;
            if (this.uploadedTableName) return true;
            this.renderError(`#${this.activeTab}Grid-M02001`, this.t("uploadTableRequired", "Upload a file or enter a table ID first."));
            return false;
        },

        renderGrid(selector, rows, gridKey, explicitColumns = null) {
            const container = getContainerEl(selector);
            if (!container) return;
            this.gridData[gridKey] = Array.isArray(rows) ? rows : [];
            const rawColumns = explicitColumns || Object.keys(rows?.[0] || {});
            const columns = gridKey === "columns"
                ? rawColumns.filter((column) => !new Set(["OWNER", "TABLE_ID", "TABLE_COMMENT"]).has(String(column).toUpperCase()))
                : rawColumns;
            if (!columns.length) {
                const emptyMarkup = `<div class="table-empty">${this.escapeHtml(this.t("noData", "No data."))}</div>`;
                container.innerHTML = `<div class="table-grid-scroll">${emptyMarkup}</div>`;
                return;
            }
            const tableMarkup = `
                <table class="table-grid" data-grid-key="${this.escapeHtml(gridKey)}">
                    <thead>
                        <tr>
                            <th class="grid-row-no" title="No">No</th>
                            ${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${(rows || []).map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${(gridKey === "data" || gridKey === "sql") ? ((Number(this.gridPages[gridKey] || 1) - 1) * Number(this.gridPageSizes[gridKey] || 100)) + rowIndex + 1 : rowIndex + 1}</td>
                                ${columns.map((column, index) => `<td title="${this.escapeHtml(Array.isArray(row) ? row[index] : row[column] ?? "")}">${this.escapeHtml(Array.isArray(row) ? row[index] : row[column] ?? "")}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
            container.innerHTML = `<div class="table-grid-scroll">${tableMarkup}</div>`;
            const table = container.querySelector(".table-grid");
            CommonUtils.enableGridColumnResize(table, () => this.applyGridFrozenColumns(gridKey));
            this.applyGridFrozenColumns(gridKey);
        },

        getGridFreezeCount(gridKey) {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            const headerCells = Array.from(table?.tHead?.rows?.[0]?.children || []);
            const maxDataColumns = Math.max(0, headerCells.length - 1);
            const input = getContainerEl(`#${gridKey}GridFreeze-M02001`);
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

        exportActiveGrid(format) {
            const gridKey = this.activeTab;
            const rows = this.gridData[gridKey] || [];
            if (!rows.length) {
                alert(this.t("noGridDataToExport", "No grid data to export."));
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
                return;
            }
            if (format === "json") {
                this.downloadBlob(`${baseName}.json`, JSON.stringify(rows, null, 2), "application/json;charset=utf-8");
            }
        },

        createExportFileName(gridKey) {
            const tableName = this.uploadedTableName || "SQL_RESULT";
            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
            return `M02001_${tableName}_${gridKey}_${stamp}`;
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
        }
    };

    window[PAGE_CODE] = M02001;
})();
