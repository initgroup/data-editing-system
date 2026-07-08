(function() {
    const PAGE_CODE = "M99002";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const CATEGORY_LABELS = {
        TABLE: "Tables",
        VIEW: "Views",
        PACKAGE: "Packages",
        PROCEDURE: "Procedures",
        FUNCTION: "Functions"
    };
    const TREE_PAGE_SIZE = 200;

    const M99002 = {
        ...COMMON,
        isInit: false,
        objectRows: [],
        baseObjectRows: [],
        visibleObjectRows: [],
        searchMode: false,
        treeSearchRunning: false,
        collapsedNodes: new Set(),
        loadedGroups: new Set(),
        loadedPackages: new Set(),
        selectedObject: null,
        activeTab: "columns",
        gridData: { columns: [], data: [], sql: [] },
        columnWidths: { columns: [], data: [], sql: [] },
        gridFrozenColumns: { sql: 0 },
        selectedCell: null,
        resizing: null,
        handleResizeMoveBound: null,
        stopColumnResizeBound: null,
        sqlKeydownBound: null,

        async init() {
            if (this.isInit) return;
            this.handleResizeMoveBound = this.handleColumnResizeMove.bind(this);
            this.stopColumnResizeBound = this.stopColumnResize.bind(this);
            this.sqlKeydownBound = this.handleSqlEditorKeydown.bind(this);
            document.addEventListener("mousemove", this.handleResizeMoveBound);
            document.addEventListener("mouseup", this.stopColumnResizeBound);
            getContainerEl("#sqlEditor-M99002")?.addEventListener("keydown", this.sqlKeydownBound);
            await this.loadObjectTree();
            this.showObjectTabs();
            this.isInit = true;
        },

        destroy() {
            if (this.handleResizeMoveBound) document.removeEventListener("mousemove", this.handleResizeMoveBound);
            if (this.stopColumnResizeBound) document.removeEventListener("mouseup", this.stopColumnResizeBound);
            if (this.sqlKeydownBound) getContainerEl("#sqlEditor-M99002")?.removeEventListener("keydown", this.sqlKeydownBound);
            this.objectRows = [];
            this.baseObjectRows = [];
            this.visibleObjectRows = [];
            this.searchMode = false;
            this.treeSearchRunning = false;
            this.collapsedNodes = new Set();
            this.loadedGroups = new Set();
            this.loadedPackages = new Set();
            this.selectedObject = null;
            this.activeTab = "columns";
            this.gridData = { columns: [], data: [], sql: [] };
            this.columnWidths = { columns: [], data: [], sql: [] };
            this.gridFrozenColumns = { sql: 0 };
            this.selectedCell = null;
            this.resizing = null;
            this.handleResizeMoveBound = null;
            this.stopColumnResizeBound = null;
            this.sqlKeydownBound = null;
            this.isInit = false;
        },

        async loadObjectTree() {
            const container = getContainerEl("#objectTree-M99002");
            if (!container) return;
            container.innerHTML = `<div class="table-empty">Loading database objects...</div>`;
            this.objectRows = [];
            this.baseObjectRows = [];
            this.visibleObjectRows = [];
            this.searchMode = false;
            this.collapsedNodes = new Set();
            this.loadedGroups = new Set();
            this.loadedPackages = new Set();
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-tree`, { method: "GET", showLoading: false });
                this.objectRows = Array.isArray(json.data) ? json.data : [];
                this.baseObjectRows = this.objectRows.slice();
                this.objectRows.forEach((row) => {
                    if (this.getObjectType(row) === "OWNER") this.collapsedNodes.add(this.getNodeId(row));
                    if (this.getObjectType(row) === "GROUP") this.collapsedNodes.add(this.getNodeId(row));
                });
                this.renderObjectTree();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Object load failed.")}</div>`;
            }
        },

        renderObjectTree() {
            const container = getContainerEl("#objectTree-M99002");
            if (!container) return;
            this.visibleObjectRows = this.getVisibleObjectRows();
            if (!this.visibleObjectRows.length) {
                container.innerHTML = `<div class="table-empty">No objects found.</div>`;
                return;
            }
            container.innerHTML = `
                <div class="env-tree-head">
                    <div>Object</div>
                    <div>Type</div>
                </div>
                <div class="env-tree-viewport">
                    <div class="env-tree-window m99002-tree-window">
                        ${this.visibleObjectRows.map((row, index) => this.createTreeRowTemplate(row, index)).join("")}
                    </div>
                </div>
            `;
        },

        createTreeRowTemplate(row, index) {
            const nodeId = this.getNodeId(row);
            const selectedClass = this.selectedObject && this.getNodeId(this.selectedObject) === nodeId ? "is-selected" : "";
            const childCount = Number(row.CHILD_COUNT);
            const count = Number.isFinite(childCount) && childCount > 0 ? `<span class="env-tree-count">${childCount}</span>` : "";
            return `
                <button type="button" class="env-tree-row ${selectedClass}" data-node-id="${this.escapeHtml(nodeId)}" onclick="M99002.handleTreeRowClick(${index})">
                    <span class="env-tree-node level-${Number(row.LEVEL_NO || 1)} ${this.isExpandable(row) ? "is-expandable" : ""}">
                        ${this.getExpandIcon(row)}
                        <i class="${this.getTreeIcon(row.OBJECT_TYPE)}"></i>
                        <span class="env-tree-label" title="${this.escapeHtml(row.OBJECT_LABEL || row.OBJECT_NAME)}">${this.escapeHtml(row.OBJECT_LABEL || row.OBJECT_NAME)}</span>
                        ${count}
                    </span>
                    <span class="env-tree-muted">${this.escapeHtml(row.OBJECT_TYPE || "")}</span>
                </button>
            `;
        },

        async handleTreeRowClick(index) {
            const row = this.visibleObjectRows[index];
            if (!row) return;
            const type = this.getObjectType(row);
            const scrollState = this.captureTreeScroll(row);
            if (type === "LOAD_MORE") {
                await this.loadMoreObjects(row);
                return;
            }
            if (type === "OWNER") {
                this.toggleNode(this.getNodeId(row), true, scrollState);
                return;
            }
            if (type === "GROUP") {
                const nodeId = this.getNodeId(row);
                if (this.loadedGroups.has(nodeId)) {
                    this.toggleNode(nodeId, true, scrollState);
                } else {
                    this.collapsedNodes.delete(nodeId);
                    await this.ensureGroupChildren(row, scrollState);
                }
                return;
            }
            if (type === "PACKAGE") {
                await this.selectObject(row, scrollState);
                const nodeId = this.getNodeId(row);
                if (!this.loadedPackages.has(nodeId)) {
                    this.collapsedNodes.delete(nodeId);
                    await this.ensurePackageMembers(row, scrollState);
                } else {
                    this.toggleNode(nodeId, true, scrollState);
                }
                return;
            }
            if (row.IS_SELECTABLE === "Y") {
                await this.selectObject(row, scrollState);
            }
        },

        async ensureGroupChildren(row, scrollState = this.captureTreeScroll(row)) {
            const nodeId = this.getNodeId(row);
            if (this.loadedGroups.has(nodeId)) return;
            this.insertLoadingRow(row);
            this.renderObjectTree();
            this.restoreTreeScroll(scrollState);
            try {
                const params = new URLSearchParams({
                    owner: row.OWNER || "",
                    category: row.OBJECT_NAME || "",
                    offset: "0",
                    limit: String(TREE_PAGE_SIZE)
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-children?${params.toString()}`, { method: "GET", showLoading: false });
                const rows = Array.isArray(json.data) ? json.data : [];
                this.replaceChildren(nodeId, this.withLoadMoreRow(row, rows, json));
                this.loadedGroups.add(nodeId);
            } catch (error) {
                this.replaceChildren(nodeId, []);
                this.updateDescription(error.message || "Object children load failed.");
            }
            this.renderObjectTree();
            this.restoreTreeScroll(scrollState);
        },

        async loadMoreObjects(row) {
            if (row.SEARCH_MODE === "Y") {
                await this.loadMoreSearchResults(row);
                return;
            }
            await this.loadMoreGroupChildren(row);
        },

        async loadMoreGroupChildren(row) {
            const parentId = row.PARENT_ID;
            const parent = this.objectRows.find((item) => this.getNodeId(item) === parentId);
            if (!parent) return;
            const scrollTop = this.getTreeScrollTop();
            this.replaceLoadMoreRow(row, { ...row, OBJECT_LABEL: "Loading more..." });
            this.renderObjectTree();
            this.restoreTreeScroll(scrollTop);
            try {
                const params = new URLSearchParams({
                    owner: row.OWNER || "",
                    category: row.CATEGORY || "",
                    offset: String(row.NEXT_OFFSET || 0),
                    limit: String(TREE_PAGE_SIZE)
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-children?${params.toString()}`, { method: "GET", showLoading: false });
                const rows = Array.isArray(json.data) ? json.data : [];
                this.removeNode(row.NODE_ID);
                this.appendChildren(parentId, this.withLoadMoreRow(parent, rows, json));
            } catch (error) {
                this.removeNode(row.NODE_ID);
                this.appendChildren(parentId, [this.createLoadMoreRow(parent, Number(row.NEXT_OFFSET || 0), true, error.message || "Load more failed.")]);
                this.updateDescription(error.message || "Object children load failed.");
            }
            this.renderObjectTree();
            this.restoreTreeScroll(scrollTop);
        },

        async ensurePackageMembers(row, scrollState = this.captureTreeScroll(row)) {
            const nodeId = this.getNodeId(row);
            if (this.loadedPackages.has(nodeId)) return;
            this.insertLoadingRow(row);
            this.renderObjectTree();
            this.restoreTreeScroll(scrollState);
            try {
                const params = new URLSearchParams({ owner: row.OWNER || "", packageName: row.OBJECT_NAME || "" });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/package-members?${params.toString()}`, { method: "GET", showLoading: false });
                this.replaceChildren(nodeId, Array.isArray(json.data) ? json.data : []);
                this.loadedPackages.add(nodeId);
            } catch (error) {
                this.replaceChildren(nodeId, []);
                this.updateDescription(error.message || "Package members load failed.");
            }
            this.renderObjectTree();
            this.restoreTreeScroll(scrollState);
        },

        insertLoadingRow(parent) {
            const nodeId = this.getNodeId(parent);
            this.replaceChildren(nodeId, [{
                OWNER: parent.OWNER,
                OBJECT_TYPE: "LOADING",
                OBJECT_NAME: "Loading...",
                OBJECT_LABEL: "Loading...",
                NODE_ID: `LOADING:${nodeId}`,
                PARENT_ID: nodeId,
                LEVEL_NO: Number(parent.LEVEL_NO || 1) + 1,
                IS_SELECTABLE: "N"
            }]);
        },

        replaceChildren(parentId, children) {
            this.objectRows = this.objectRows.filter((row) => this.getParentId(row) !== parentId);
            const index = this.objectRows.findIndex((row) => this.getNodeId(row) === parentId);
            if (index < 0) return;
            this.objectRows.splice(index + 1, 0, ...children);
            if (!this.searchMode) this.baseObjectRows = this.objectRows.slice();
        },

        appendChildren(parentId, children) {
            const sameParentRows = this.objectRows
                .map((row, index) => ({ row, index }))
                .filter((item) => this.getParentId(item.row) === parentId);
            const insertIndex = sameParentRows.length
                ? sameParentRows[sameParentRows.length - 1].index + 1
                : this.objectRows.findIndex((row) => this.getNodeId(row) === parentId) + 1;
            if (insertIndex < 0) return;
            this.objectRows.splice(insertIndex, 0, ...children);
            if (!this.searchMode) this.baseObjectRows = this.objectRows.slice();
        },

        replaceLoadMoreRow(oldRow, nextRow) {
            const index = this.objectRows.findIndex((row) => this.getNodeId(row) === this.getNodeId(oldRow));
            if (index >= 0) this.objectRows.splice(index, 1, nextRow);
        },

        removeNode(nodeId) {
            this.objectRows = this.objectRows.filter((row) => this.getNodeId(row) !== nodeId);
        },

        withLoadMoreRow(parent, rows, response) {
            const nextRows = rows.slice();
            if (response?.hasMore) {
                nextRows.push(this.createLoadMoreRow(parent, Number(response.nextOffset || nextRows.length)));
            }
            return nextRows;
        },

        createLoadMoreRow(parent, nextOffset, isRetry = false, label = "Load more...") {
            const parentId = this.getNodeId(parent);
            const category = parent.CATEGORY || parent.OBJECT_NAME || parent.ROOT_CATEGORY || "";
            return {
                OWNER: parent.OWNER || "",
                OBJECT_TYPE: "LOAD_MORE",
                OBJECT_NAME: label,
                OBJECT_LABEL: label,
                NODE_ID: `LOAD_MORE:${parentId}:${nextOffset}`,
                PARENT_ID: parentId,
                LEVEL_NO: Number(parent.LEVEL_NO || 1) + 1,
                IS_SELECTABLE: "N",
                CHILD_COUNT: null,
                CATEGORY: category,
                NEXT_OFFSET: nextOffset,
                SEARCH_MODE: parent.SEARCH_MODE || "N",
                RETRY: isRetry ? "Y" : "N"
            };
        },

        getVisibleObjectRows() {
            const categories = this.getSelectedCategories();
            const hiddenParents = new Set();
            if (this.searchMode) {
                return this.objectRows.filter((row) => {
                    const type = this.getObjectType(row);
                    return type !== "OWNER" && type !== "GROUP" && this.isCategoryVisible(type, row);
                });
            }
            return this.objectRows.filter((row) => {
                const nodeId = this.getNodeId(row);
                const parentId = this.getParentId(row);
                const type = this.getObjectType(row);
                if (parentId && hiddenParents.has(parentId)) {
                    hiddenParents.add(nodeId);
                    return false;
                }
                if (parentId && this.collapsedNodes.has(parentId)) {
                    hiddenParents.add(nodeId);
                    return false;
                }
                if (type === "GROUP" && categories.length && !categories.includes(String(row.OBJECT_NAME || "").toUpperCase())) {
                    hiddenParents.add(nodeId);
                    return false;
                }
                if (type !== "OWNER" && type !== "GROUP" && !this.isCategoryVisible(type, row)) return false;
                return true;
            });
        },

        isCategoryVisible(type, row) {
            if (type === "LOAD_MORE") return true;
            const categories = this.getSelectedCategories();
            if (!categories.length) return true;
            const category = type.startsWith("PACKAGE_") ? "PACKAGE" : (row.ROOT_CATEGORY || type);
            return categories.includes(String(category || "").toUpperCase());
        },

        async selectObject(row, scrollState = this.captureTreeScroll(row)) {
            this.selectedObject = { ...row, OBJECT_COMMENT: "", CREATED_AT: "" };
            this.renderObjectTree();
            this.restoreTreeScroll(scrollState);
            this.updateSelectedMeta();
            this.setDefaultSql();
            if (this.isTableOrView(row)) {
                this.showTableTabs();
                await Promise.all([this.loadObjectDetail(row), this.loadColumns()]);
            } else {
                this.showObjectTabs();
                await this.loadObjectDetail(row);
            }
        },

        async loadObjectDetail(row) {
            if (!row) return;
            const selectedNodeId = this.getNodeId(row);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object/detail`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        owner: row.OWNER,
                        objectType: row.OBJECT_TYPE,
                        objectName: row.OBJECT_NAME
                    }
                });
                if (!this.selectedObject || this.getNodeId(this.selectedObject) !== selectedNodeId) return;
                const scrollState = this.captureTreeScroll(this.selectedObject);
                this.selectedObject = { ...this.selectedObject, ...(json.object || {}) };
                this.updateSelectedMeta();
                this.renderObjectTree();
                this.restoreTreeScroll(scrollState);
            } catch (error) {
                if (this.selectedObject && this.getNodeId(this.selectedObject) === selectedNodeId) {
                    this.setText("#selectedObjectComment-M99002", error.message || "Detail load failed.");
                }
            }
        },

        showTableTabs() {
            this.setTabVisible("columns", true);
            this.setTabVisible("data", true);
            this.setTabVisible("script", true);
            const viewer = getContainerEl("#scriptViewer-M99002");
            if (viewer) viewer.value = "";
            this.switchTab(["columns", "data", "script", "sql"].includes(this.activeTab) ? this.activeTab : "columns");
        },

        showObjectTabs() {
            this.setTabVisible("columns", false);
            this.setTabVisible("data", false);
            this.setTabVisible("script", true);
            this.switchTab(this.activeTab === "sql" ? "sql" : "script");
        },

        setTabVisible(tabName, visible) {
            const tab = getContainerEl(`.table-tab[data-tab="${tabName}"]`);
            const panel = getContainerEl(`.table-tab-panel[data-panel="${tabName}"]`);
            [tab, panel].filter(Boolean).forEach((el) => {
                el.hidden = !visible;
                el.style.display = visible ? "" : "none";
                el.setAttribute("aria-hidden", String(!visible));
            });
        },

        updateSelectedMeta() {
            this.setText("#selectedOwner-M99002", this.selectedObject?.OWNER || "-");
            this.setText("#selectedObject-M99002", this.selectedObject?.OBJECT_NAME || "-");
            this.setText("#selectedObjectComment-M99002", this.selectedObject?.OBJECT_COMMENT || "-");
            this.setText("#selectedType-M99002", this.selectedObject?.OBJECT_TYPE || "-");
            this.setText("#selectedCreatedAt-M99002", this.formatKstDateTime(this.selectedObject?.CREATED_AT));
            const desc = this.selectedObject
                ? `${this.selectedObject.OWNER}.${this.selectedObject.OBJECT_NAME}`
                : "Select an object from the schema tree.";
            this.updateDescription(desc);
        },

        switchTab(tabName) {
            this.activeTab = tabName;
            getContainerEl(".table-tabs")?.querySelectorAll(".table-tab").forEach((tab) => {
                tab.classList.toggle("is-active", tab.dataset.tab === tabName);
            });
            getContainerEl(".table-panel")?.querySelectorAll(".table-tab-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.panel === tabName);
            });
            if (tabName === "data" && this.isTableOrView(this.selectedObject)) this.loadTableData();
            if (tabName === "script" && this.selectedObject) this.loadSource();
        },

        async loadColumns() {
            if (!this.ensureTableSelected()) return;
            const grid = getContainerEl("#columnsGrid-M99002");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading columns...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/table/columns`, {
                    method: "POST",
                    showLoading: false,
                    body: this.getTablePayload()
                });
                this.renderGrid("#columnsGrid-M99002", json.data || [], "columns", json.columns || []);
            } catch (error) {
                this.renderError("#columnsGrid-M99002", error.message);
            }
        },

        async loadTableData() {
            if (!this.ensureTableSelected()) return;
            const grid = getContainerEl("#dataGrid-M99002");
            if (grid) grid.innerHTML = `<div class="table-empty">Loading data...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/table/data`, {
                    method: "POST",
                    showLoading: false,
                    body: { ...this.getTablePayload(), limit: this.getLimit("#dataLimit-M99002") }
                });
                this.renderGrid("#dataGrid-M99002", json.data || [], "data", json.columns || []);
            } catch (error) {
                this.renderError("#dataGrid-M99002", error.message);
            }
        },

        async loadSource() {
            const viewer = getContainerEl("#scriptViewer-M99002");
            if (!viewer || !this.selectedObject) return;
            viewer.value = "Loading script...";
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object/source`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        owner: this.selectedObject.OWNER,
                        objectType: this.selectedObject.OBJECT_TYPE,
                        objectName: this.selectedObject.OBJECT_NAME
                    }
                });
                viewer.value = this.formatSourceForDisplay(json.source || "", this.selectedObject);
            } catch (error) {
                viewer.value = error.message || "Script load failed.";
            }
        },

        formatSourceForDisplay(source, object = this.selectedObject) {
            const text = String(source || "").trim();
            if (!text || this.getObjectType(object) !== "VIEW") return text;
            return text
                .replace(/\s+/g, " ")
                .replace(/\s+(AS\s+SELECT)\s+/i, "\n$1\n    ")
                .replace(/\s+(SELECT)\s+/i, "\n$1\n    ")
                .replace(/\s+(FROM)\s+/i, "\n$1\n    ")
                .replace(/\s+(WHERE)\s+/i, "\n$1\n    ")
                .replace(/\s+(GROUP\s+BY|ORDER\s+BY|HAVING)\s+/ig, "\n$1\n    ")
                .replace(/\s+(AND|OR)\s+/ig, "\n    $1 ")
                .replace(/\s+(LEFT|RIGHT|FULL|INNER|CROSS)?\s*(JOIN)\s+/ig, "\n    $1 $2 ")
                .replace(/\s+(ON)\s+/ig, "\n        $1 ")
                .replace(/\s*,\s*/g, ",\n    ")
                .replace(/\n\s+\n/g, "\n")
                .trim();
        },

        async executeSql() {
            const executable = this.getExecutableSqlFromEditor();
            if (!executable.sql) {
                this.renderSqlMessage("No SQL statement found at the cursor.", "error");
                this.renderError("#sqlGrid-M99002", "No SQL statement found at the cursor.");
                return;
            }
            if (!this.validateSelectSql(executable.sql)) {
                this.renderSqlMessage("Only a single SELECT statement is allowed.", "error");
                this.renderError("#sqlGrid-M99002", "Only a single SELECT statement is allowed.");
                this.restoreSqlSelection(executable);
                return;
            }
            this.restoreSqlSelection(executable);
            const grid = getContainerEl("#sqlGrid-M99002");
            const startedAt = performance.now();
            this.renderSqlMessage("Running SQL...", "info");
            if (grid) grid.innerHTML = `<div class="table-empty">Running SQL...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql`, {
                    method: "POST",
                    showLoading: false,
                    body: { sql: executable.sql, limit: this.getLimit("#sqlLimit-M99002") }
                });
                const elapsedMs = Math.round(performance.now() - startedAt);
                const rowCount = Array.isArray(json.data) ? json.data.length : 0;
                this.renderSqlMessage(`${rowCount.toLocaleString()} rows selected. (${elapsedMs.toLocaleString()} ms)`, "success");
                this.renderGrid("#sqlGrid-M99002", json.data || [], "sql", json.columns || []);
            } catch (error) {
                const elapsedMs = Math.round(performance.now() - startedAt);
                this.renderSqlMessage(`${error.message || "SQL execution failed."} (${elapsedMs.toLocaleString()} ms)`, "error");
                this.renderError("#sqlGrid-M99002", error.message);
            } finally {
                this.restoreSqlSelection(executable);
            }
        },

        renderSqlMessage(message, type = "info") {
            const element = getContainerEl("#sqlMessage-M99002");
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

        handleObjectSearchInput() {
            const keyword = (getContainerEl("#objectSearch-M99002")?.value || "").trim();
            if (!keyword && this.searchMode) {
                this.searchMode = false;
                this.objectRows = this.baseObjectRows.slice();
                this.updateDescription("Select an object from the schema tree.");
                this.renderObjectTree();
                return;
            }
        },

        handleObjectSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.filterObjectSearch();
        },

        async filterObjectSearch() {
            const input = getContainerEl("#objectSearch-M99002");
            const keyword = (input?.value || "").trim();
            if (!keyword || this.treeSearchRunning) {
                if (!keyword) this.handleObjectSearchInput();
                return;
            }

            const container = getContainerEl("#objectTree-M99002");
            this.treeSearchRunning = true;
            if (container) container.innerHTML = `<div class="table-empty">Searching database objects...</div>`;
            try {
                const params = new URLSearchParams({
                    keyword,
                    categoryFilter: this.getObjectCategoryFilter(),
                    offset: "0",
                    limit: String(TREE_PAGE_SIZE)
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-search?${params.toString()}`, { method: "GET", showLoading: false });
                const rows = Array.isArray(json.data) ? json.data : [];
                this.objectRows = this.withSearchLoadMoreRow(rows, json, keyword);
                this.searchMode = true;
                this.collapsedNodes.clear();
                this.renderObjectTree();
                this.updateDescription(`${rows.length}${json.hasMore ? "+" : ""} object(s) matched "${keyword}".`);
            } catch (error) {
                if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Object search failed.")}</div>`;
            } finally {
                this.treeSearchRunning = false;
                input?.focus();
            }
        },

        async loadMoreSearchResults(row) {
            const keyword = (getContainerEl("#objectSearch-M99002")?.value || "").trim();
            if (!keyword) return;
            const scrollTop = this.getTreeScrollTop();
            this.replaceLoadMoreRow(row, { ...row, OBJECT_LABEL: "Loading more..." });
            this.renderObjectTree();
            this.restoreTreeScroll(scrollTop);
            try {
                const params = new URLSearchParams({
                    keyword,
                    categoryFilter: this.getObjectCategoryFilter(),
                    offset: String(row.NEXT_OFFSET || 0),
                    limit: String(TREE_PAGE_SIZE)
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-search?${params.toString()}`, { method: "GET", showLoading: false });
                const rows = Array.isArray(json.data) ? json.data : [];
                this.removeNode(row.NODE_ID);
                this.objectRows.push(...this.withSearchLoadMoreRow(rows, json, keyword));
                const loadedCount = this.objectRows.filter((item) => this.getObjectType(item) !== "LOAD_MORE").length;
                this.updateDescription(`${loadedCount}${json.hasMore ? "+" : ""} object(s) matched "${keyword}".`);
            } catch (error) {
                this.removeNode(row.NODE_ID);
                this.objectRows.push(this.createSearchLoadMoreRow(keyword, Number(row.NEXT_OFFSET || 0), true, error.message || "Load more failed."));
                this.updateDescription(error.message || "Object search failed.");
            }
            this.renderObjectTree();
            this.restoreTreeScroll(scrollTop);
        },

        getTreeScrollTop() {
            return this.getTreeScrollElement()?.scrollTop || 0;
        },

        getTreeScrollElement() {
            const container = getContainerEl("#objectTree-M99002");
            const candidates = [
                container?.querySelector(".env-tree-viewport"),
                container,
                container?.closest(".table-object-panel"),
                container?.closest(".table-workspace")
            ].filter(Boolean);
            return candidates.find((el) => el.scrollHeight > el.clientHeight) || candidates[0] || null;
        },

        captureTreeScroll(row = null) {
            const scrollEl = this.getTreeScrollElement();
            const nodeId = row ? this.getNodeId(row) : "";
            const anchor = nodeId ? this.findTreeRowElement(nodeId) : null;
            const scrollRect = scrollEl?.getBoundingClientRect();
            const anchorRect = anchor?.getBoundingClientRect();
            return {
                scrollTop: scrollEl?.scrollTop || 0,
                nodeId,
                anchorOffset: scrollRect && anchorRect ? anchorRect.top - scrollRect.top : null
            };
        },

        restoreTreeScroll(scrollState) {
            const state = typeof scrollState === "number" ? { scrollTop: scrollState } : (scrollState || { scrollTop: 0 });
            const apply = () => {
                const scrollEl = this.getTreeScrollElement();
                if (!scrollEl) return;
                scrollEl.scrollTop = Number(state.scrollTop || 0);
                if (!state.nodeId || !Number.isFinite(state.anchorOffset)) return;
                const anchor = this.findTreeRowElement(state.nodeId);
                if (!anchor) return;
                const scrollRect = scrollEl.getBoundingClientRect();
                const anchorRect = anchor.getBoundingClientRect();
                const delta = (anchorRect.top - scrollRect.top) - state.anchorOffset;
                if (Math.abs(delta) > 1) {
                    scrollEl.scrollTop += delta;
                }
            };
            window.requestAnimationFrame(() => {
                apply();
                window.requestAnimationFrame(apply);
                window.setTimeout(apply, 50);
            });
        },

        findTreeRowElement(nodeId) {
            const rows = getContainerEl("#objectTree-M99002")?.querySelectorAll(".env-tree-row[data-node-id]") || [];
            return Array.from(rows).find((row) => row.dataset.nodeId === nodeId) || null;
        },

        withSearchLoadMoreRow(rows, response, keyword) {
            const nextRows = rows.slice();
            if (response?.hasMore) {
                nextRows.push(this.createSearchLoadMoreRow(keyword, Number(response.nextOffset || nextRows.length)));
            }
            return nextRows;
        },

        createSearchLoadMoreRow(keyword, nextOffset, isRetry = false, label = "Load more...") {
            return {
                OWNER: "",
                OBJECT_TYPE: "LOAD_MORE",
                OBJECT_NAME: label,
                OBJECT_LABEL: label,
                NODE_ID: `LOAD_MORE:SEARCH:${nextOffset}`,
                PARENT_ID: "",
                LEVEL_NO: 1,
                IS_SELECTABLE: "N",
                CHILD_COUNT: null,
                CATEGORY: "SEARCH",
                NEXT_OFFSET: nextOffset,
                SEARCH_MODE: "Y",
                KEYWORD: keyword,
                RETRY: isRetry ? "Y" : "N"
            };
        },

        setDefaultSql() {
            const editor = getContainerEl("#sqlEditor-M99002");
            if (!editor || !this.selectedObject) return;
            const owner = this.quoteName(this.selectedObject.OWNER);
            const objectName = this.quoteName(this.getObjectType(this.selectedObject).startsWith("PACKAGE_")
                ? this.selectedObject.OBJECT_NAME.split(".")[0]
                : this.selectedObject.OBJECT_NAME);
            if (this.isTableOrView(this.selectedObject)) {
                editor.value = `SELECT *\n  FROM ${owner}.${objectName};`;
            } else {
                editor.value = `SELECT *\n  FROM ALL_OBJECTS\n WHERE OWNER = '${this.selectedObject.OWNER}'\n   AND OBJECT_NAME = '${this.selectedObject.OBJECT_NAME.split(".")[0]}';`;
            }
        },

        renderGrid(selector, rows, gridKey, columnNames = []) {
            const container = getContainerEl(selector);
            if (!container) return;
            this.gridData[gridKey] = Array.isArray(rows) ? rows : [];
            this.selectedCell = null;
            const columns = Array.isArray(columnNames) && columnNames.length ? columnNames : Object.keys(rows?.[0] || {});
            this.columnWidths[gridKey] = this.normalizeColumnWidths(gridKey, columns);
            if (!Array.isArray(rows) || rows.length === 0) {
                if (columns.length) {
                    container.innerHTML = this.createGridTable([], columns, gridKey);
                    this.applyGridFrozenColumns(gridKey);
                    return;
                }
                container.innerHTML = `<div class="table-empty">No data.</div>`;
                return;
            }
            container.innerHTML = this.createGridTable(rows, columns, gridKey);
            this.applyGridFrozenColumns(gridKey);
        },

        getGridFreezeCount(gridKey) {
            const table = getContainerEl(`[data-grid-key="${gridKey}"]`);
            const headerCells = Array.from(table?.tHead?.rows?.[0]?.children || []);
            const maxDataColumns = Math.max(0, headerCells.length - 1);
            const input = gridKey === "sql" ? getContainerEl("#sqlFreezeColumns-M99002") : null;
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

        createGridTable(rows, columns, gridKey) {
            return `
                <table class="table-grid" data-grid-key="${gridKey}">
                    <colgroup>
                        <col class="grid-row-no-col">
                        ${columns.map((_, index) => `<col style="width: ${this.columnWidths[gridKey][index]}px">`).join("")}
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="grid-row-no" title="No">No</th>
                            ${columns.map((column, index) => `
                                <th class="is-resizable" title="${this.escapeHtml(column)}">
                                    <span class="table-th-content">${this.escapeHtml(column)}</span>
                                    <span class="column-resizer" onmousedown="M99002.startColumnResize(event, '${gridKey}', ${index})"></span>
                                </th>
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, rowIndex) => `
                            <tr>
                                <td class="grid-row-no">${rowIndex + 1}</td>
                                ${columns.map((column, columnIndex) => {
                                    const rawValue = row[column] ?? "";
                                    const displayValue = this.isDateTimeColumn(column) ? this.formatKstDateTime(rawValue) : rawValue;
                                    return `
                                    <td title="${this.escapeHtml(rawValue)}" onclick="M99002.selectGridCell('${gridKey}', ${rowIndex}, ${columnIndex + 1})">${this.escapeHtml(displayValue)}</td>
                                `;
                                }).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        },

        normalizeColumnWidths(gridKey, columns) {
            const current = this.columnWidths[gridKey] || [];
            return columns.map((column, index) => {
                const existing = Number(current[index]);
                if (Number.isFinite(existing) && existing >= 80) return existing;
                return Math.min(Math.max(String(column).length * 9 + 42, 120), 280);
            });
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
            this.resizing = {
                gridKey,
                columnIndex,
                startX: event.clientX,
                startWidth: Number.parseInt(col.style.width, 10) || 120
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
            const gridKey = this.activeTab === "script" ? "" : this.activeTab;
            const rows = this.gridData[gridKey] || [];
            if (!rows.length) {
                alert("No grid data to export.");
                return;
            }
            const baseName = this.createExportFileName(gridKey);
            if (format === "excel") return DataEditingSystem.downloadXLSX(rows, `${baseName}.xlsx`);
            if (format === "csv") return this.downloadBlob(`${baseName}.csv`, this.createDelimitedContent(rows, ","), "text/csv;charset=utf-8");
            if (format === "tsv") this.downloadBlob(`${baseName}.tsv`, this.createDelimitedContent(rows, "\t"), "text/tab-separated-values;charset=utf-8");
        },

        createExportFileName(gridKey) {
            const objectName = this.selectedObject?.OBJECT_NAME || "SQL_RESULT";
            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
            return `M99002_${objectName}_${gridKey}_${stamp}`;
        },

        createExcelContent(rows) {
            const columns = Object.keys(rows[0] || {});
            return `<html><head><meta charset="UTF-8"></head><body><table><thead><tr>${columns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${this.escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
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

        getExecutableSqlFromEditor() {
            const editor = getContainerEl("#sqlEditor-M99002");
            if (!editor) return { sql: "", selectionStart: 0, selectionEnd: 0 };
            const value = editor.value || "";
            const selectionStart = editor.selectionStart || 0;
            const selectionEnd = editor.selectionEnd || 0;
            if (selectionStart !== selectionEnd) {
                return { sql: value.slice(selectionStart, selectionEnd).trim(), selectionStart, selectionEnd };
            }
            const range = this.findSqlStatementRange(value, selectionStart);
            return { sql: value.slice(range.selectionStart, range.selectionEnd).trim(), ...range };
        },

        findSqlStatementRange(value, cursorIndex) {
            let cursor = Math.max(0, Math.min(cursorIndex, value.length));
            while (cursor > 0 && /\s/.test(value[cursor - 1])) cursor -= 1;
            if (cursor > 0 && value[cursor - 1] === ";") cursor -= 1;
            let start = value.lastIndexOf(";", Math.max(0, cursor - 1)) + 1;
            let end = value.indexOf(";", cursor);
            if (end < 0) end = value.length;
            while (start < end && /\s/.test(value[start])) start += 1;
            while (end > start && /\s/.test(value[end - 1])) end -= 1;
            return { selectionStart: start, selectionEnd: end };
        },

        restoreSqlSelection(selection) {
            const editor = getContainerEl("#sqlEditor-M99002");
            if (!editor || !selection) return;
            editor.focus();
            editor.setSelectionRange(selection.selectionStart, selection.selectionEnd);
        },

        validateSelectSql(sql) {
            const text = sql.trim().replace(/;+\s*$/, "");
            return /^(select|with)\b/i.test(text) && !/;\s*\S/.test(sql);
        },

        getLimit(selector) {
            const value = Number(getContainerEl(selector)?.value || 100);
            return Math.max(1, Math.min(Number.isFinite(value) ? value : 100, 1000));
        },

        ensureTableSelected() {
            if (this.isTableOrView(this.selectedObject)) return true;
            this.renderError("#columnsGrid-M99002", "Select a table or view first.");
            return false;
        },

        isTableOrView(row) {
            return ["TABLE", "VIEW"].includes(this.getObjectType(row));
        },

        getTablePayload() {
            return {
                owner: this.selectedObject?.OWNER || "",
                tableName: this.selectedObject?.OBJECT_NAME || ""
            };
        },

        toggleNode(nodeId, render = true, scrollTop = this.getTreeScrollTop()) {
            if (this.collapsedNodes.has(nodeId)) this.collapsedNodes.delete(nodeId);
            else this.collapsedNodes.add(nodeId);
            if (render) {
                this.renderObjectTree();
                this.restoreTreeScroll(scrollTop);
            }
        },

        expandAllGroups() {
            this.collapsedNodes.clear();
            this.renderObjectTree();
        },

        collapseAllGroups() {
            this.collapsedNodes = new Set(this.objectRows.filter((row) => this.isExpandable(row)).map((row) => this.getNodeId(row)));
            this.renderObjectTree();
        },

        handleCategoryAllChange(checkbox) {
            getContainerEl(".env-category-filter")?.querySelectorAll(".object-category-M99002").forEach((item) => {
                item.checked = false;
            });
            checkbox.checked = true;
            if (this.searchMode && (getContainerEl("#objectSearch-M99002")?.value || "").trim()) {
                this.filterObjectSearch();
                return;
            }
            this.renderObjectTree();
        },

        handleCategoryChange() {
            const selected = getContainerEl(".env-category-filter")?.querySelectorAll(".object-category-M99002:checked") || [];
            const all = getContainerEl("#objectCategoryAll-M99002");
            if (all) all.checked = selected.length === 0;
            if (this.searchMode && (getContainerEl("#objectSearch-M99002")?.value || "").trim()) {
                this.filterObjectSearch();
                return;
            }
            this.renderObjectTree();
        },

        getSelectedCategories() {
            const all = getContainerEl("#objectCategoryAll-M99002");
            if (all?.checked) return [];
            return Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".object-category-M99002:checked") || [])
                .map((item) => item.value);
        },

        getObjectCategoryFilter() {
            const categories = this.getSelectedCategories();
            return categories.length ? categories.join(",") : "ALL";
        },

        isExpandable(row) {
            const type = this.getObjectType(row);
            return type === "OWNER" || type === "GROUP" || type === "PACKAGE";
        },

        getExpandIcon(row) {
            if (!this.isExpandable(row)) return '<span class="env-tree-spacer"></span>';
            const icon = this.collapsedNodes.has(this.getNodeId(row)) ? "fa-chevron-right" : "fa-chevron-down";
            return `<i class="fas ${icon} env-tree-toggle"></i>`;
        },

        getTreeIcon(type) {
            const value = String(type || "").toUpperCase();
            if (value === "OWNER") return "fas fa-database";
            if (value === "GROUP") return "fas fa-folder";
            if (value === "TABLE") return "fas fa-table";
            if (value === "VIEW") return "far fa-eye";
            if (value === "PACKAGE") return "fas fa-box-archive";
            if (value === "PROCEDURE" || value === "PACKAGE_PROCEDURE") return "fas fa-code";
            if (value === "FUNCTION" || value === "PACKAGE_FUNCTION") return "fas fa-code-branch";
            if (value === "LOADING") return "fas fa-circle-notch fa-spin";
            if (value === "LOAD_MORE") return "fas fa-ellipsis-h";
            return "far fa-file";
        },

        getNodeId(row) {
            return String(row?.NODE_ID ?? "").trim();
        },

        getParentId(row) {
            return String(row?.PARENT_ID ?? "").trim();
        },

        getObjectType(row) {
            return String(row?.OBJECT_TYPE ?? "").trim().toUpperCase();
        },

        quoteName(value) {
            return `"${String(value || "").replace(/"/g, '""')}"`;
        },

        updateDescription(text) {
            this.setText("#objectDescription-M99002", text || "");
        },

        renderError(selector, message) {
            const container = getContainerEl(selector);
            if (container) container.innerHTML = `<div class="table-error">${this.escapeHtml(message || "Error")}</div>`;
        }
    };

    window[PAGE_CODE] = M99002;
})();
