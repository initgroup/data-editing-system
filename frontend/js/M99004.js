(function() {
    const PAGE_CODE = "M99004";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const emptyNotice = () => ({
        NOTICE_ID: "",
        NOTICE_TYPE: "INFO",
        TITLE: "",
        CONTENT: "",
        POST_START_AT: "",
        POST_END_AT: "",
        POPUP_YN: "N",
        POPUP_START_AT: "",
        POPUP_END_AT: "",
        PIN_YN: "N",
        USE_YN: "Y",
        SORT_ORDER: 0
    });

    const M99004 = {
        ...COMMON,
        isInit: false,
        notices: [],
        selectedFiles: [],
        pendingFiles: [],
        isSourceMode: false,
        savedEditorRange: null,
        selectedNotice: emptyNotice(),

        async init() {
            if (this.isInit) return;
            this.newNotice(false);
            this.bindEditorEvents();
            this.bindAttachmentEvents();
            this.bindPopupEvents();
            await this.loadNotices();
            this.isInit = true;
        },

        destroy() {
            this.notices = [];
            this.selectedFiles = [];
            this.pendingFiles = [];
            this.isSourceMode = false;
            this.savedEditorRange = null;
            this.selectedNotice = emptyNotice();
            this.isInit = false;
        },

        async onShow() {
            this.syncPopupFields();
        },

        handleSearchKey(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.loadNotices();
            }
        },

        async loadNotices() {
            const list = getContainerEl("#noticeList-M99004");
            if (!list) return;
            list.innerHTML = `<div class="env-tree-loading project-empty">Loading notices...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/notices`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        keyword: this.getValue("#noticeSearch-M99004"),
                        useYn: this.getValue("#noticeUseFilter-M99004") || "ALL",
                        limit: 200
                    }
                });
                this.notices = Array.isArray(json.data) ? json.data : [];
                this.renderNoticeList();
            } catch (error) {
                list.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || "Notice list load failed.")}</div>`;
            }
        },

        renderNoticeList() {
            const list = getContainerEl("#noticeList-M99004");
            if (!list) return;
            if (!this.notices.length) {
                list.innerHTML = `<div class="project-empty">No notices found.</div>${this.renderListFooter(0)}`;
                return;
            }
            list.innerHTML = `
                <div class="project-list-head">
                    <div>Notice</div>
                    <div>Status</div>
                </div>
                <div class="project-list-body">
                    ${this.notices.map((notice) => this.createNoticeRow(notice)).join("")}
                </div>
                ${this.renderListFooter(this.notices.length)}
            `;
        },

        createNoticeRow(notice) {
            const id = notice.NOTICE_ID ?? "";
            const selectedClass = String(id) === String(this.selectedNotice.NOTICE_ID || "") ? "is-selected" : "";
            const title = notice.TITLE || "(Untitled notice)";
            const period = this.formatPeriod(notice.POST_START_AT, notice.POST_END_AT);
            const meta = [
                notice.USE_YN === "Y" ? "Y" : "N",
                notice.POPUP_YN === "Y" ? "POPUP" : "",
                notice.PIN_YN === "Y" ? "PIN" : "",
                Number(notice.FILE_COUNT || 0) > 0 ? `${this.formatNumber(notice.FILE_COUNT)} FILE` : ""
            ].filter(Boolean).join(" / ");
            return `
                <button type="button" class="project-row ${selectedClass}" onclick="M99004.selectNotice('${this.escapeAttr(id)}')">
                    <span class="project-row-main">
                        <span class="project-row-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</span>
                        <span class="project-row-sub">${this.escapeHtml(notice.NOTICE_TYPE || "INFO")} / ${this.escapeHtml(period)}</span>
                    </span>
                    <span class="project-row-meta">
                        <span>${this.escapeHtml(meta || "-")}</span>
                    </span>
                </button>
            `;
        },

        async selectNotice(noticeId) {
            if (!noticeId) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/notices/${encodeURIComponent(noticeId)}`, {
                    method: "GET",
                    showLoading: false
                });
                this.selectedNotice = json.data || emptyNotice();
                this.pendingFiles = [];
                this.renderNoticeList();
                this.fillForm(this.selectedNotice);
                await this.loadNoticeFiles();
                this.setMessage("Notice loaded.");
            } catch (error) {
                this.setMessage(error.message || "Notice load failed.", "error");
            }
        },

        newNotice(updateMessage = true) {
            this.selectedNotice = emptyNotice();
            this.selectedFiles = [];
            this.pendingFiles = [];
            this.fillForm(this.selectedNotice);
            this.renderNoticeList();
            this.renderNoticeFiles();
            if (updateMessage) this.setMessage("New notice draft.");
        },

        fillForm(notice) {
            this.setValue("#noticeId-M99004", notice.NOTICE_ID || "");
            this.setValue("#noticeType-M99004", notice.NOTICE_TYPE || "INFO");
            this.setValue("#noticeTitle-M99004", notice.TITLE || "");
            this.setEditorHtml(notice.CONTENT || "");
            this.setValue("#noticePostStartAt-M99004", this.toInputDateTime(notice.POST_START_AT));
            this.setValue("#noticePostEndAt-M99004", this.toInputDateTime(notice.POST_END_AT));
            this.setValue("#noticePopupYn-M99004", notice.POPUP_YN || "N");
            this.setValue("#noticePopupStartAt-M99004", this.toInputDateTime(notice.POPUP_START_AT));
            this.setValue("#noticePopupEndAt-M99004", this.toInputDateTime(notice.POPUP_END_AT));
            this.setValue("#noticePinYn-M99004", notice.PIN_YN || "N");
            this.setValue("#noticeUseYn-M99004", notice.USE_YN || "Y");
            this.setValue("#noticeSortOrder-M99004", notice.SORT_ORDER ?? 0);
            this.syncPopupFields();
        },

        getPayload() {
            if (this.isSourceMode) {
                this.setEditorHtml(this.getValue("#noticeContent-M99004"));
            } else {
                this.syncEditorToSource();
            }
            const popupYn = this.getValue("#noticePopupYn-M99004") || "N";
            return {
                noticeId: this.getValue("#noticeId-M99004") || null,
                noticeType: this.getValue("#noticeType-M99004") || "INFO",
                title: this.getValue("#noticeTitle-M99004").trim(),
                content: this.getValue("#noticeContent-M99004"),
                postStartAt: this.getValue("#noticePostStartAt-M99004") || null,
                postEndAt: this.getValue("#noticePostEndAt-M99004") || null,
                popupYn,
                popupStartAt: popupYn === "Y" ? (this.getValue("#noticePopupStartAt-M99004") || null) : null,
                popupEndAt: popupYn === "Y" ? (this.getValue("#noticePopupEndAt-M99004") || null) : null,
                pinYn: this.getValue("#noticePinYn-M99004") || "N",
                useYn: this.getValue("#noticeUseYn-M99004") || "Y",
                sortOrder: Number(this.getValue("#noticeSortOrder-M99004") || 0)
            };
        },

        execEditorCommand(command, value = null) {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            if (!editor) return;
            if (this.isSourceMode) this.toggleEditorSourceMode(false);
            editor.focus();
            document.execCommand(command, false, value);
            this.syncEditorToSource();
        },

        applyEditorInlineStyle(property, value) {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            if (!editor || !property || !value) return;
            if (this.isSourceMode) this.toggleEditorSourceMode(false);
            this.restoreEditorSelection();
            editor.focus();

            const selection = window.getSelection?.();
            if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) return;
            const range = selection.getRangeAt(0);
            const span = document.createElement("span");
            span.style[property] = value;

            if (range.collapsed) {
                span.appendChild(document.createTextNode("\u200b"));
                range.insertNode(span);
                const nextRange = document.createRange();
                nextRange.setStart(span.firstChild, 1);
                nextRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(nextRange);
            } else {
                span.appendChild(range.extractContents());
                range.insertNode(span);
                const nextRange = document.createRange();
                nextRange.selectNodeContents(span);
                selection.removeAllRanges();
                selection.addRange(nextRange);
            }
            this.saveEditorSelection();
            this.syncEditorToSource();
        },

        createEditorLink() {
            const url = window.prompt("Link URL");
            if (!url) return;
            const safeUrl = String(url).trim();
            if (!/^https?:\/\//i.test(safeUrl) && !safeUrl.startsWith("/")) {
                CommonMessage.warn("Link URL must start with http://, https://, or /");
                return;
            }
            this.execEditorCommand("createLink", safeUrl);
        },

        toggleEditorSourceMode(forceVisual = null) {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            const source = getContainerEl("#noticeContent-M99004");
            const toggle = getContainerEl("#noticeSourceToggle-M99004");
            if (!editor || !source) return;

            const nextSourceMode = forceVisual === false ? false : !this.isSourceMode;
            if (nextSourceMode) {
                this.syncEditorToSource();
                editor.hidden = true;
                source.hidden = false;
                source.value = this.formatHtmlSource(source.value);
                source.focus();
            } else {
                const html = this.sanitizeNoticeHtml(source.value || "");
                editor.innerHTML = html;
                source.value = html;
                source.hidden = true;
                editor.hidden = false;
                editor.focus();
            }
            this.isSourceMode = nextSourceMode;
            toggle?.classList.toggle("is-active", this.isSourceMode);
        },

        bindEditorEvents() {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            if (!editor || editor.dataset.bound === "Y") return;
            editor.dataset.bound = "Y";
            editor.addEventListener("mousedown", (event) => {
                if (event.detail !== 1 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
                const selection = window.getSelection?.();
                if (!selection || selection.isCollapsed || !editor.contains(selection.anchorNode)) return;
                event.preventDefault();
                this.collapseEditorSelectionAtPoint(event.clientX, event.clientY);
            });
            editor.addEventListener("keyup", (event) => {
                if (event.key === "Escape") {
                    const selection = window.getSelection?.();
                    if (selection && !selection.isCollapsed) selection.collapseToEnd();
                }
                this.syncEditorToSource();
                this.saveEditorSelection();
            });
            editor.addEventListener("mouseup", () => this.saveEditorSelection());
            editor.addEventListener("input", () => this.syncEditorToSource());
        },

        bindAttachmentEvents() {
            const input = getContainerEl("#noticeFileInput-M99004");
            if (!input || input.dataset.bound === "Y") return;
            input.dataset.bound = "Y";
            input.addEventListener("change", (event) => this.addPendingFiles(event));
        },

        bindPopupEvents() {
            const popupSelect = getContainerEl("#noticePopupYn-M99004");
            if (!popupSelect || popupSelect.dataset.bound === "Y") return;
            popupSelect.dataset.bound = "Y";
            popupSelect.addEventListener("change", () => this.syncPopupFields());
            popupSelect.addEventListener("input", () => this.syncPopupFields());
        },

        addPendingFiles(event) {
            const input = event?.target || getContainerEl("#noticeFileInput-M99004");
            const files = Array.from(input?.files || []);
            if (!files.length) return;
            const baseSortOrder = Number(this.getValue("#noticeFileSortOrder-M99004") || 0);
            const startedAt = Date.now();
            const existingKeys = new Set(this.pendingFiles.map((item) => item.fingerprint));
            const nextFiles = files
                .map((file, index) => ({
                    key: `pending-${startedAt}-${index}`,
                    fingerprint: `${file.name}:${file.size}:${file.lastModified}`,
                    file,
                    sortOrder: Number.isFinite(baseSortOrder) ? baseSortOrder + this.pendingFiles.length + index : 0
                }))
                .filter((item) => !existingKeys.has(item.fingerprint));
            if (nextFiles.length) {
                this.pendingFiles = [...this.pendingFiles, ...nextFiles];
                this.renderNoticeFiles();
                this.setMessage(`${this.formatNumber(this.pendingFiles.length)} attachment${this.pendingFiles.length === 1 ? "" : "s"} ready. Save to upload.`);
            }
            if (input) input.value = "";
        },

        removePendingFile(key) {
            this.pendingFiles = this.pendingFiles.filter((item) => item.key !== key);
            this.renderNoticeFiles();
            this.setMessage(this.pendingFiles.length ? `${this.formatNumber(this.pendingFiles.length)} attachment${this.pendingFiles.length === 1 ? "" : "s"} ready. Save to upload.` : "Pending attachment removed.");
        },

        saveEditorSelection() {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            const selection = window.getSelection?.();
            if (!editor || !selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            if (!editor.contains(range.commonAncestorContainer)) return;
            this.savedEditorRange = range.cloneRange();
        },

        restoreEditorSelection() {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            const selection = window.getSelection?.();
            if (!editor || !selection || !this.savedEditorRange) return false;
            if (!editor.contains(this.savedEditorRange.commonAncestorContainer)) return false;
            selection.removeAllRanges();
            selection.addRange(this.savedEditorRange);
            return true;
        },

        collapseEditorSelectionAtPoint(clientX, clientY) {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            const selection = window.getSelection?.();
            if (!editor || !selection) return;
            let range = null;
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(clientX, clientY);
            } else if (document.caretPositionFromPoint) {
                const position = document.caretPositionFromPoint(clientX, clientY);
                if (position) {
                    range = document.createRange();
                    range.setStart(position.offsetNode, position.offset);
                }
            }
            if (!range || !editor.contains(range.startContainer)) {
                range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
            } else {
                range.collapse(true);
            }
            selection.removeAllRanges();
            selection.addRange(range);
            editor.focus();
        },

        setEditorHtml(value) {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            const source = getContainerEl("#noticeContent-M99004");
            const html = this.sanitizeNoticeHtml(value || "");
            if (editor) editor.innerHTML = html;
            if (source) source.value = html;
            if (editor) editor.hidden = false;
            if (source) source.hidden = true;
            this.isSourceMode = false;
            getContainerEl("#noticeSourceToggle-M99004")?.classList.remove("is-active");
        },

        syncEditorToSource() {
            const editor = getContainerEl("#noticeContentEditor-M99004");
            const source = getContainerEl("#noticeContent-M99004");
            if (!editor || !source) return;
            const html = this.sanitizeNoticeHtml(editor.innerHTML || "");
            source.value = html;
        },

        async saveNotice() {
            const payload = this.getPayload();
            if (!payload.title) {
                this.setMessage("Notice title is required.", "error");
                await CommonMessage.warn("Notice title is required.");
                return;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/notices/save`, {
                    method: "POST",
                    body: payload
                });
                this.selectedNotice = json.data || emptyNotice();
                this.fillForm(this.selectedNotice);
                const pendingCount = this.pendingFiles.length;
                if (pendingCount) {
                    await this.uploadPendingNoticeFiles(this.selectedNotice.NOTICE_ID);
                }
                await this.loadNotices();
                this.renderNoticeList();
                await this.loadNoticeFiles();
                const message = pendingCount
                    ? `Notice saved. ${this.formatNumber(pendingCount)} attachment${pendingCount === 1 ? "" : "s"} uploaded.`
                    : (json.message || "Notice saved.");
                this.setMessage(message);
                await CommonMessage.success(message);
            } catch (error) {
                this.setMessage(error.message || "Notice save failed.", "error");
                await CommonMessage.error(error.message || "Notice save failed.");
            }
        },

        async deleteNotice() {
            const noticeId = this.getValue("#noticeId-M99004");
            if (!noticeId) {
                this.setMessage("Select a saved notice before deleting.", "error");
                await CommonMessage.warn("Select a saved notice before deleting.");
                return;
            }
            const title = this.getValue("#noticeTitle-M99004") || `#${noticeId}`;
            if (!(await CommonMessage.confirm(`Delete notice "${title}"?`))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/notices/delete`, {
                    method: "POST",
                    body: { noticeId }
                });
                this.newNotice(false);
                await this.loadNotices();
                this.setMessage(json.message || "Notice deleted.");
                await CommonMessage.success(json.message || "Notice deleted.");
            } catch (error) {
                this.setMessage(error.message || "Notice delete failed.", "error");
                await CommonMessage.error(error.message || "Notice delete failed.");
            }
        },

        async loadNoticeFiles() {
            const noticeId = this.getValue("#noticeId-M99004");
            if (!noticeId) {
                this.selectedFiles = [];
                this.renderNoticeFiles();
                return;
            }
            const list = getContainerEl("#noticeFileList-M99004");
            if (list) list.innerHTML = `<div class="notice-attachment-empty">Loading attachments...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/notices/${encodeURIComponent(noticeId)}/files`, {
                    method: "GET",
                    showLoading: false
                });
                this.selectedFiles = Array.isArray(json.data) ? json.data : [];
                this.renderNoticeFiles();
            } catch (error) {
                this.selectedFiles = [];
                if (list) list.innerHTML = `<div class="notice-attachment-error">${this.escapeHtml(error.message || "Attachment list load failed.")}</div>`;
                this.updateFileSummary();
            }
        },

        renderNoticeFiles() {
            const list = getContainerEl("#noticeFileList-M99004");
            if (!list) return;
            const noticeId = this.getValue("#noticeId-M99004");
            const savedItems = (noticeId ? this.selectedFiles : []).map((file) => {
                const fileId = file.FILE_ID || "";
                return `
                    <article class="notice-attachment-item">
                        <span class="notice-attachment-icon"><i class="fas fa-paperclip"></i></span>
                        <div>
                            <strong title="${this.escapeHtml(file.FILE_NAME || "")}">${this.escapeHtml(file.FILE_NAME || "attachment")}</strong>
                            <small>${this.escapeHtml(file.CONTENT_TYPE || "application/octet-stream")} · ${this.escapeHtml(this.formatFileSize(file.FILE_SIZE))}</small>
                        </div>
                        <button type="button" class="env-icon-btn" title="Download attachment" onclick="M99004.downloadNoticeFile('${this.escapeAttr(fileId)}')">
                            <i class="fas fa-download"></i>
                        </button>
                        <button type="button" class="env-icon-btn env-danger" title="Delete attachment" onclick="M99004.deleteNoticeFile('${this.escapeAttr(fileId)}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </article>
                `;
            });
            const pendingItems = this.pendingFiles.map((item) => `
                <article class="notice-attachment-item is-pending">
                    <span class="notice-attachment-icon"><i class="fas fa-clock"></i></span>
                    <div>
                        <strong title="${this.escapeHtml(item.file?.name || "")}">${this.escapeHtml(item.file?.name || "attachment")}</strong>
                        <small>Ready for Save · ${this.escapeHtml(this.formatFileSize(item.file?.size))}</small>
                    </div>
                    <span class="notice-attachment-status">Pending</span>
                    <button type="button" class="env-icon-btn env-danger" title="Remove pending attachment" onclick="M99004.removePendingFile('${this.escapeAttr(item.key)}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </article>
            `);
            const items = [...savedItems, ...pendingItems];
            if (!items.length) {
                list.innerHTML = `<div class="notice-attachment-empty">No attachments selected.</div>`;
                this.updateFileSummary();
                return;
            }
            list.innerHTML = items.join("");
            this.updateFileSummary();
        },

        updateFileSummary() {
            const summary = getContainerEl("#noticeFileSummary-M99004");
            if (!summary) return;
            const noticeId = this.getValue("#noticeId-M99004");
            const savedCount = noticeId ? this.selectedFiles.length : 0;
            const pendingCount = this.pendingFiles.length;
            if (pendingCount > 0 && savedCount > 0) {
                summary.textContent = `${this.formatNumber(savedCount)} saved / ${this.formatNumber(pendingCount)} ready for Save`;
                return;
            }
            if (pendingCount > 0) {
                summary.textContent = `${this.formatNumber(pendingCount)} ready for Save`;
                return;
            }
            summary.textContent = `${this.formatNumber(savedCount)} attachment${savedCount === 1 ? "" : "s"}`;
        },

        buildRequestHeaders() {
            const headers = {};
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId) headers["X-Target-Connection-Id"] = targetConnectionId;
            try {
                const loginUser = JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
                if (loginUser.userId) headers["X-Login-User-Id"] = String(loginUser.userId);
                if (loginUser.loginId) headers["X-Login-Id"] = String(loginUser.loginId);
                if (loginUser.email) headers["X-Login-Email"] = String(loginUser.email);
                if (loginUser.roleCode) headers["X-Login-Role-Code"] = String(loginUser.roleCode);
            } catch (error) {
                // Backend auth will report missing context if needed.
            }
            const bootstrapToken = sessionStorage.getItem("initBootstrapToken") || "";
            if (bootstrapToken) headers["X-Bootstrap-Token"] = bootstrapToken;
            return headers;
        },

        async uploadPendingNoticeFiles(noticeId) {
            if (!noticeId || !this.pendingFiles.length) return;
            const pending = [...this.pendingFiles];
            for (const item of pending) {
                const formData = new FormData();
                formData.append("file", item.file);
                formData.append("sortOrder", String(item.sortOrder ?? 0));
                const response = await fetch(`${API_BASE_URL}/${PAGE_CODE}/notices/${encodeURIComponent(noticeId)}/files`, {
                    method: "POST",
                    headers: this.buildRequestHeaders(),
                    body: formData
                });
                if (!response.ok) {
                    const errorJson = await response.json().catch(() => ({}));
                    throw new Error(`${item.file?.name || "Attachment"}: ${CommonUtils.formatErrorMessage(errorJson)}`);
                }
                const json = await response.json();
                window.PageManager?.extendSession?.();
                this.selectedFiles = Array.isArray(json.data) ? json.data : this.selectedFiles;
                this.pendingFiles = this.pendingFiles.filter((pendingItem) => pendingItem.key !== item.key);
                this.renderNoticeFiles();
            }
        },

        async uploadNoticeFile() {
            const noticeId = this.getValue("#noticeId-M99004");
            if (!noticeId || this.pendingFiles.length) {
                await this.saveNotice();
                return;
            }
            await CommonMessage.warn("Select attachment files first, then click Save.");
        },

        async downloadNoticeFile(fileId) {
            if (!fileId) return;
            const file = this.selectedFiles.find((item) => String(item.FILE_ID || "") === String(fileId)) || {};
            try {
                const response = await fetch(`${API_BASE_URL}/${PAGE_CODE}/files/${encodeURIComponent(fileId)}/download`, {
                    method: "GET",
                    headers: this.buildRequestHeaders()
                });
                if (!response.ok) {
                    const errorJson = await response.json().catch(() => ({}));
                    throw new Error(CommonUtils.formatErrorMessage(errorJson));
                }
                const blob = await response.blob();
                const fileName = this.getDownloadFileName(response.headers.get("Content-Disposition")) || file.FILE_NAME || "attachment";
                if (window.DataEditingSystem?.downloadBlob) {
                    window.DataEditingSystem.downloadBlob(blob, fileName);
                } else {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }
                window.PageManager?.extendSession?.();
            } catch (error) {
                this.setMessage(error.message || "Attachment download failed.", "error");
                await CommonMessage.error(error.message || "Attachment download failed.");
            }
        },

        async deleteNoticeFile(fileId) {
            if (!fileId) return;
            const file = this.selectedFiles.find((item) => String(item.FILE_ID || "") === String(fileId));
            const fileName = file?.FILE_NAME || `#${fileId}`;
            if (!(await CommonMessage.confirm(`Delete attachment "${fileName}"?`))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/files/delete`, {
                    method: "POST",
                    body: { fileId }
                });
                await this.loadNoticeFiles();
                await this.loadNotices();
                this.renderNoticeList();
                this.setMessage(json.message || "Attachment deleted.");
                await CommonMessage.success(json.message || "Attachment deleted.");
            } catch (error) {
                this.setMessage(error.message || "Attachment delete failed.", "error");
                await CommonMessage.error(error.message || "Attachment delete failed.");
            }
        },

        syncPopupFields() {
            const enabled = this.getValue("#noticePopupYn-M99004") === "Y";
            const container = getContainerEl("#container-M99004");
            container?.classList.toggle("is-popup-enabled", enabled);
            container?.classList.toggle("is-popup-disabled", !enabled);
            container?.querySelectorAll("[data-popup-field]").forEach((el) => {
                el.classList.toggle("is-disabled", !enabled);
                el.setAttribute("aria-disabled", String(!enabled));
                const range = el.querySelector("[data-popup-period-range]");
                const message = el.querySelector("[data-popup-disabled-message]");
                if (range) range.hidden = !enabled;
                if (message) message.hidden = enabled;
                el.querySelectorAll("input, select, textarea, button").forEach((field) => {
                    field.disabled = !enabled;
                });
            });
        },

        getValue(selector) {
            return getContainerEl(selector)?.value ?? "";
        },

        toInputDateTime(value) {
            const text = String(value || "").trim();
            if (!text) return "";
            return text.slice(0, 16);
        },

        formatPeriod(startAt, endAt) {
            const start = this.toInputDateTime(startAt).replace("T", " ") || "always";
            const end = this.toInputDateTime(endAt).replace("T", " ") || "open";
            return `${start} ~ ${end}`;
        },

        formatNumber(value) {
            const number = Number(value || 0);
            return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
        },

        formatFileSize(value) {
            const size = Number(value || 0);
            if (!Number.isFinite(size) || size <= 0) return "0 B";
            const units = ["B", "KB", "MB", "GB"];
            let next = size;
            let unitIndex = 0;
            while (next >= 1024 && unitIndex < units.length - 1) {
                next /= 1024;
                unitIndex += 1;
            }
            const digits = unitIndex === 0 ? 0 : (next >= 10 ? 1 : 2);
            return `${next.toFixed(digits)} ${units[unitIndex]}`;
        },

        getDownloadFileName(disposition) {
            const header = String(disposition || "");
            const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
            if (encoded) {
                try {
                    return decodeURIComponent(encoded[1].trim());
                } catch (error) {
                    return encoded[1].trim();
                }
            }
            const quoted = header.match(/filename="([^"]+)"/i);
            if (quoted) return quoted[1].trim();
            return "";
        },

        setMessage(message, type = "info") {
            const el = getContainerEl("#noticeMessage-M99004");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error" ? "table-error" : "env-detail-hint";
        },

        sanitizeNoticeHtml(value) {
            const template = document.createElement("template");
            template.innerHTML = String(value || "");
            const allowedTags = new Set(["A", "B", "BR", "DIV", "EM", "H3", "I", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL"]);
            const allowedAttrs = {
                A: new Set(["href", "target", "rel"]),
                SPAN: new Set(["style"]),
                P: new Set(["style"]),
                DIV: new Set(["style"])
            };
            const sanitizeNode = (node) => {
                [...node.childNodes].forEach((child) => {
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(child.tagName)) {
                            child.remove();
                            return;
                        }
                        if (!allowedTags.has(child.tagName)) {
                            child.replaceWith(...child.childNodes);
                            return;
                        }
                        [...child.attributes].forEach((attr) => {
                            const allowed = allowedAttrs[child.tagName]?.has(attr.name);
                            if (!allowed) child.removeAttribute(attr.name);
                        });
                        if (child.tagName === "A") {
                            const href = child.getAttribute("href") || "";
                            if (!/^https?:\/\//i.test(href) && !href.startsWith("/")) {
                                child.removeAttribute("href");
                            } else {
                                child.setAttribute("target", "_blank");
                                child.setAttribute("rel", "noopener noreferrer");
                            }
                        }
                        if (child.hasAttribute("style")) {
                            child.setAttribute("style", this.sanitizeInlineStyle(child.getAttribute("style")));
                            if (!child.getAttribute("style")) child.removeAttribute("style");
                        }
                        sanitizeNode(child);
                    } else if (child.nodeType !== Node.TEXT_NODE) {
                        child.remove();
                    }
                });
            };
            sanitizeNode(template.content);
            return template.innerHTML.trim();
        },

        sanitizeInlineStyle(value) {
            return String(value || "")
                .split(";")
                .map((part) => part.trim())
                .filter((part) => /^(color|background-color|font-size|text-align)\s*:/i.test(part))
                .join("; ");
        },

        formatHtmlSource(value) {
            return String(value || "")
                .replace(/></g, ">\n<")
                .trim();
        }
    };

    window[PAGE_CODE] = M99004;
})();
