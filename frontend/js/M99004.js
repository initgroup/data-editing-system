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
        isSourceMode: false,
        savedEditorRange: null,
        selectedNotice: emptyNotice(),

        async init() {
            if (this.isInit) return;
            this.newNotice(false);
            this.bindEditorEvents();
            await this.loadNotices();
            this.isInit = true;
        },

        destroy() {
            this.notices = [];
            this.isSourceMode = false;
            this.savedEditorRange = null;
            this.selectedNotice = emptyNotice();
            this.isInit = false;
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
                notice.PIN_YN === "Y" ? "PIN" : ""
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
                this.renderNoticeList();
                this.fillForm(this.selectedNotice);
                this.setMessage("Notice loaded.");
            } catch (error) {
                this.setMessage(error.message || "Notice load failed.", "error");
            }
        },

        newNotice(updateMessage = true) {
            this.selectedNotice = emptyNotice();
            this.fillForm(this.selectedNotice);
            this.renderNoticeList();
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
            return {
                noticeId: this.getValue("#noticeId-M99004") || null,
                noticeType: this.getValue("#noticeType-M99004") || "INFO",
                title: this.getValue("#noticeTitle-M99004").trim(),
                content: this.getValue("#noticeContent-M99004"),
                postStartAt: this.getValue("#noticePostStartAt-M99004") || null,
                postEndAt: this.getValue("#noticePostEndAt-M99004") || null,
                popupYn: this.getValue("#noticePopupYn-M99004") || "N",
                popupStartAt: this.getValue("#noticePopupStartAt-M99004") || null,
                popupEndAt: this.getValue("#noticePopupEndAt-M99004") || null,
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
                await this.loadNotices();
                this.newNotice(false);
                this.setMessage(json.message || "Notice saved.");
                await CommonMessage.success(json.message || "Notice saved.");
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

        syncPopupFields() {
            const visible = this.getValue("#noticePopupYn-M99004") === "Y";
            getContainerEl("#container-M99004")?.querySelectorAll("[data-popup-field]").forEach((el) => {
                el.hidden = !visible;
                el.style.display = visible ? "" : "none";
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
