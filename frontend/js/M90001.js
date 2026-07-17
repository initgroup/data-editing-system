(function() {
    const PAGE_CODE = "M90001";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);
    const DETAIL_PRESET_URL = "./config/M90001.object-detail-presets.json";
    const CLASSIFICATION_PRESET_URL = "./config/M91003.object-detail-presets.json";
    const CLASSIFICATION_API_CODE = "M91003";
    const CLASSIFICATION_CATEGORY = "DATA_PROFILING";
    const CLASSIFICATION_OBJECT_NAME = "INIT$_SP_PREDICTED_TYPE";
    const getPageMessage = (key, fallback = "", values = {}) => {
        const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
        const messages = pack && typeof pack.messages === "object" && !Array.isArray(pack.messages) ? pack.messages : {};
        let text = Object.prototype.hasOwnProperty.call(messages, key) ? String(messages[key] ?? "") : fallback;
        Object.entries(values || {}).forEach(([name, value]) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value ?? ""));
        });
        return text;
    };

    const M90001 = {
        
        ...COMMON,
        isInit: false,
        selectedObject: null,
        objectMeta: null,
        detailSource: "",
        detailPresets: null,
        classificationDefaults: [],
        classificationSettings: [],
        selectedClassificationKey: "",
        objectSourceRequestSeq: 0,
        rows: [],
        originalRows: [],
        selectedRowIndex: null,
        objectRows: [],
        visibleObjectRows: [],
        collapsedNodes: new Set(),
        loadedGroupNodes: new Set(),
        loadingGroupNodes: new Set(),
        loadedPackageNodes: new Set(),
        loadingPackageNodes: new Set(),
        treeRowHeight: 36,
        treeBuffer: 8,
        treeFetchLimit: 200,
        treeLoading: false,
        treeHasMore: false,
        treeNextOffset: 0,
        treeSearchMode: false,
        treeRequestSeq: 0,
        treeSearchRunning: false,
        lastSearchKeyword: "",
        lastSearchNodeId: null,
        selectedTreeNodeId: null,
        gridManagers: {
            objectTree: CommonUtils.createGridModel(100)
        },

        async init() {
            if (this.isInit) return;

            this.rows = [];
            this.originalRows = [];
            this.selectedRowIndex = null;
            this.renderRows();
            this.renderObjectSource("", "Select an object to load source.");
            await this.loadObjectTree();
            this.isInit = true;
        },

        destroy() {
            const manager = this.gridManagers.objectTree;
            if (manager.gridInstance && typeof manager.gridInstance.destroy === "function") {
                manager.gridInstance.destroy();
            }
            manager.gridInstance = null;
            manager.currentData = [];
            this.rows = [];
            this.originalRows = [];
            this.selectedRowIndex = null;
            this.objectRows = [];
            this.visibleObjectRows = [];
            this.collapsedNodes = new Set();
            this.loadedGroupNodes = new Set();
            this.loadingGroupNodes = new Set();
            this.loadedPackageNodes = new Set();
            this.loadingPackageNodes = new Set();
            this.treeLoading = false;
            this.treeHasMore = false;
            this.treeNextOffset = 0;
            this.treeSearchMode = false;
            this.treeRequestSeq += 1;
            this.treeSearchRunning = false;
            this.lastSearchKeyword = "";
            this.lastSearchNodeId = null;
            this.selectedTreeNodeId = null;
            this.selectedObject = null;
            this.objectMeta = null;
            this.detailSource = "";
            this.detailPresets = null;
            this.classificationDefaults = [];
            this.classificationSettings = [];
            this.selectedClassificationKey = "";
            this.objectSourceRequestSeq += 1;
            this.setDetailPresetButtonVisible(false);
            this.updateClassificationSettingsButton();
            this.closeClassificationSettings();
            this.renderObjectSource("", "Select an object to load source.");
            this.isInit = false;
        },

        async loadObjectTree(reset = true) {
            const container = getContainerEl("#gridContainer");
            if (!container) return;
            if (this.treeLoading) return 0;

            const requestSeq = reset ? this.treeRequestSeq + 1 : this.treeRequestSeq;
            if (reset) {
                this.treeRequestSeq = requestSeq;
            }

            try {
                if (reset) {
                    this.objectRows = [];
                    this.visibleObjectRows = [];
                    this.collapsedNodes = new Set();
                    this.loadedGroupNodes = new Set();
                    this.loadingGroupNodes = new Set();
                    this.loadedPackageNodes = new Set();
                    this.loadingPackageNodes = new Set();
                    this.selectedTreeNodeId = null;
                    this.lastSearchKeyword = "";
                    this.lastSearchNodeId = null;
                    this.treeHasMore = false;
                    this.treeNextOffset = 0;
                    this.renderObjectTree();
                }

                this.treeLoading = true;
                if (reset) {
                    this.showObjectTreeLoading();
                } else {
                    this.refreshTreeRows();
                }
                const keyword = this.treeSearchMode ? (getContainerEl("#objectSearch-M90001")?.value || "").trim() : "";
                const params = new URLSearchParams({
                    offset: String(reset ? 0 : this.treeNextOffset),
                    limit: String(this.treeFetchLimit),
                    keyword,
                    registeredOnly: this.isRegisteredOnlyTree() ? "Y" : "N",
                    categoryFilter: this.getObjectCategoryFilter()
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-tree?${params.toString()}`, { method: "GET", showLoading: false });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || "Object tree response failed.");
                }
                if (requestSeq !== this.treeRequestSeq) return 0;

                const nextRows = Array.isArray(json.data) ? json.data : [];
                this.objectRows = reset ? nextRows : this.objectRows.concat(nextRows);
                this.treeHasMore = Boolean(json.hasMore);
                this.treeNextOffset = Number(json.nextOffset || this.objectRows.length);
                if (json.fullTree) {
                    this.markLoadedTreeNodes();
                    this.collapsedNodes.clear();
                }
                this.renderObjectTree();
                return nextRows.length;
            } catch (error) {
                if (requestSeq !== this.treeRequestSeq) return 0;
                console.error("[M90001] object tree load failed", error);
                if (reset) {
                    this.objectRows = [];
                    this.renderObjectTree();
                    container.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || "Object tree load failed.")}</div>`;
                }
                return 0;
            } finally {
                if (requestSeq === this.treeRequestSeq) {
                    this.treeLoading = false;
                    this.refreshTreeRows();
                }
            }
        },

        showObjectTreeLoading() {
            const container = getContainerEl("#gridContainer");
            if (!container) return;
            container.innerHTML = `
                <div class="env-tree-head">
                    <div>Object</div>
                    <div>Type</div>
                </div>
                <div class="env-tree-viewport">
                    <div class="env-tree-window" style="transform: translateY(0)">
                        <div class="env-tree-row env-tree-loading" style="height: ${this.treeRowHeight}px">
                            <span class="env-tree-node level-2">
                                <span class="env-tree-spacer"></span>
                                <i class="fas fa-circle-notch fa-spin"></i>
                                <span class="env-tree-label">Loading DB object schema...</span>
                            </span>
                            <span class="env-tree-muted">LOAD</span>
                        </div>
                    </div>
                </div>
            `;
        },

        renderObjectTree() {
            const container = getContainerEl("#gridContainer");
            if (!container) return;

            this.visibleObjectRows = this.getVisibleObjectRows();
            container.innerHTML = `
                <div class="env-tree-head">
                    <div>Object</div>
                    <div>Type</div>
                </div>
                <div class="env-tree-viewport">
                    <div class="env-tree-spacer-y"></div>
                    <div class="env-tree-window"></div>
                </div>
            `;

            const viewport = container.querySelector(".env-tree-viewport");
            viewport.addEventListener("scroll", () => this.handleTreeScroll());
            this.renderTreeWindow();
        },

        refreshTreeRows() {
            this.visibleObjectRows = this.getVisibleObjectRows();
            this.renderTreeWindow();
        },

        handleTreeScroll() {
            this.renderTreeWindow();
        },

        renderTreeWindow() {
            const container = getContainerEl("#gridContainer");
            if (!container) return;

            const viewport = container.querySelector(".env-tree-viewport");
            const spacer = container.querySelector(".env-tree-spacer-y");
            const windowEl = container.querySelector(".env-tree-window");
            if (!viewport || !spacer || !windowEl) return;

            const total = this.visibleObjectRows.length;
            const viewportHeight = viewport.clientHeight || 360;
            const fullHeight = total * this.treeRowHeight;
            const maxScrollTop = Math.max(0, fullHeight - viewportHeight);
            const scrollTop = Math.min(viewport.scrollTop, maxScrollTop);
            if (viewport.scrollTop !== scrollTop) {
                viewport.scrollTop = scrollTop;
            }
            const first = Math.max(0, Math.floor(scrollTop / this.treeRowHeight) - this.treeBuffer);
            const visibleCount = Math.ceil(viewportHeight / this.treeRowHeight) + (this.treeBuffer * 2);
            const last = Math.min(total, first + visibleCount);
            const offsetY = first * this.treeRowHeight;

            spacer.style.height = `${fullHeight}px`;
            windowEl.style.transform = `translateY(${offsetY}px)`;
            const rows = [];
            for (let index = first; index < last; index += 1) {
                const row = this.visibleObjectRows[index];
                if (row) rows.push(this.createTreeRowTemplate(row, index));
            }
            windowEl.innerHTML = rows.join("");
        },

        createTreeLoadingTemplate() {
            const label = this.treeLoading ? "Loading more objects..." : "Scroll to load more objects";
            return `
                <div class="env-tree-row env-tree-loading" style="height: ${this.treeRowHeight}px">
                    <span class="env-tree-node level-2">
                        <span class="env-tree-spacer"></span>
                        <i class="fas fa-circle-notch ${this.treeLoading ? "fa-spin" : ""}"></i>
                        <span class="env-tree-label">${label}</span>
                    </span>
                    <span class="env-tree-muted">FETCH</span>
                </div>
            `;
        },

        createTreeRowTemplate(row, index) {
            if (this.getObjectType(row) === "LOAD_MORE") {
                return this.createLoadMoreRowTemplate(index);
            }
            const nodeId = this.getNodeId(row);
            const selectedClass = nodeId === this.selectedTreeNodeId ? "is-selected" : "";
            const expandableClass = this.isExpandable(row) ? "is-expandable" : "";
            const childCount = this.getGroupChildCount(row);
            const treeLabel = this.getTreeDisplayLabel(row);

            return `
                <button type="button" class="env-tree-row ${selectedClass}" data-node-id="${this.escapeHtml(nodeId)}" style="height: ${this.treeRowHeight}px" onclick="M90001.handleTreeRowClick(${index})">
                    <span class="env-tree-node level-${Number(row.LEVEL_NO || 1)} ${expandableClass}">
                        ${this.getExpandIcon(row)}
                        <i class="${this.getTreeIcon(row.OBJECT_TYPE)}"></i>
                        ${this.getRegisteredIcon(row)}
                        ${this.getObjectStatusIcon(row)}
                        <span class="env-tree-label" title="${this.escapeHtml(row.OBJECT_LABEL)}">${this.escapeHtml(treeLabel)}</span>
                        ${childCount !== null ? `<span class="env-tree-count">${this.escapeHtml(childCount)}</span>` : ""}
                    </span>
                    <span class="env-tree-muted">
                        <span>${this.escapeHtml(row.OBJECT_TYPE)}</span>
                    </span>
                </button>
            `;
        },

        createLoadMoreRowTemplate(index) {
            return `
                <button type="button" class="env-tree-row" style="height: ${this.treeRowHeight}px" onclick="M90001.handleTreeRowClick(${index})">
                    <span class="env-tree-node level-2">
                        <span class="env-tree-spacer"></span>
                        <i class="fas fa-ellipsis-h"></i>
                        <span class="env-tree-label">${this.treeLoading ? "Loading more..." : "Load more..."}</span>
                    </span>
                    <span class="env-tree-muted">MORE</span>
                </button>
            `;
        },

        getTreeDisplayLabel(row) {
            const label = String(row?.OBJECT_LABEL ?? row?.OBJECT_NAME ?? "");
            const objectType = this.getObjectType(row);
            if (objectType === "PACKAGE_PROCEDURE" || objectType === "PACKAGE_FUNCTION") {
                return label.split(".").pop() || label;
            }
            return label;
        },

        getGroupChildCount(row) {
            if (!this.isExpandable(row)) return null;
            const objectType = this.getObjectType(row);
            const count = Number(row.CHILD_COUNT ?? row.childCount);
            if (objectType === "GROUP") {
                return Number.isFinite(count) ? count : "?";
            }
            if (objectType === "PACKAGE" && !this.loadedPackageNodes.has(this.getNodeId(row))) return null;
            const nodeId = this.getNodeId(row);
            return this.objectRows.filter((child) => this.getParentId(child) === nodeId).length;
        },

        async handleTreeRowClick(index) {
            const selected = this.visibleObjectRows[index];
            if (!selected) return;

            this.selectedTreeNodeId = this.getNodeId(selected);

            if (this.getObjectType(selected) === "LOAD_MORE") {
                if (selected.GROUP_LOAD_MORE === "Y") {
                    await this.loadMoreGroupChildren(selected);
                } else {
                    await this.loadMoreObjects();
                }
                return;
            }

            if (this.getObjectType(selected) === "PACKAGE") {
                await this.handlePackageNodeClick(selected);
                return;
            }

            if (this.getObjectType(selected) === "GROUP") {
                await this.handleGroupNodeClick(selected);
                return;
            }

            if (this.isExpandable(selected)) {
                this.toggleNode(this.getNodeId(selected));
                return;
            }

            this.renderTreeWindow();

            if (selected.IS_SELECTABLE === "Y") {
                this.selectObject(selected);
            }
        },

        async handleGroupNodeClick(row) {
            const nodeId = this.getNodeId(row);
            if (!nodeId) return;

            if (!this.loadedGroupNodes.has(nodeId)) {
                this.collapsedNodes.delete(nodeId);
                await this.loadGroupChildren(row);
                return;
            }

            this.toggleNode(nodeId);
        },

        async loadGroupChildren(row) {
            const nodeId = this.getNodeId(row);
            if (!nodeId || this.loadingGroupNodes.has(nodeId)) return;

            this.loadingGroupNodes.add(nodeId);
            this.insertGroupLoadingRow(row);
            this.refreshTreeRows();

            try {
                const params = new URLSearchParams({
                    owner: row.OWNER || "",
                    groupType: this.getGroupType(row),
                    offset: "0",
                    limit: String(this.treeFetchLimit),
                    registeredOnly: this.isRegisteredOnlyTree() ? "Y" : "N"
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-children?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    timeoutMs: 15000,
                    timeoutMessage: "Object load is taking too long. Click to retry."
                });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || "Object children response failed.");
                }

                const children = Array.isArray(json.data) ? json.data : [];
                this.replaceGroupChildren(row, this.withGroupLoadMoreRow(row, children, json), json);
                this.loadedGroupNodes.add(nodeId);
            } catch (error) {
                console.error("[M90001] object children load failed", error);
                this.removeGroupChildren(nodeId);
                this.appendGroupChildren(row, [this.createGroupLoadMoreRow(row, 0, error.message || "Load failed. Click to retry.")]);
                this.updateDescription(error.message || "Object children load failed.");
            } finally {
                this.loadingGroupNodes.delete(nodeId);
                this.refreshTreeRows();
            }
        },

        async loadMoreGroupChildren(row) {
            const parentNodeId = this.getParentId(row);
            const parent = this.objectRows.find((item) => this.getNodeId(item) === parentNodeId);
            if (!parent) return;

            const scrollTop = this.getTreeScrollTop();
            this.replaceTreeRow(row, { ...row, OBJECT_LABEL: "Loading more...", OBJECT_NAME: "Loading more..." });
            this.refreshTreeRows();
            this.restoreTreeScroll(scrollTop);

            try {
                const params = new URLSearchParams({
                    owner: parent.OWNER || "",
                    groupType: row.GROUP_TYPE || this.getGroupType(parent),
                    offset: String(row.NEXT_OFFSET || 0),
                    limit: String(this.treeFetchLimit),
                    registeredOnly: this.isRegisteredOnlyTree() ? "Y" : "N"
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-children?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    timeoutMs: 15000,
                    timeoutMessage: "Object load is taking too long. Click to retry."
                });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || "Object children response failed.");
                }
                const children = Array.isArray(json.data) ? json.data : [];
                this.removeTreeRow(this.getNodeId(row));
                this.appendGroupChildren(parent, this.withGroupLoadMoreRow(parent, children, json), json);
            } catch (error) {
                console.error("[M90001] object children load more failed", error);
                this.removeTreeRow(this.getNodeId(row));
                this.appendGroupChildren(parent, [this.createGroupLoadMoreRow(parent, Number(row.NEXT_OFFSET || 0), error.message || "Load more failed.")]);
                this.updateDescription(error.message || "Object children load failed.");
            }
            this.refreshTreeRows();
            this.restoreTreeScroll(scrollTop);
        },

        insertGroupLoadingRow(row) {
            const nodeId = this.getNodeId(row);
            if (!nodeId) return;
            this.removeGroupChildren(nodeId);
            const index = this.objectRows.findIndex((item) => this.getNodeId(item) === nodeId);
            if (index < 0) return;
            this.objectRows.splice(index + 1, 0, {
                OWNER: row.OWNER,
                OBJECT_TYPE: "LOADING",
                OBJECT_NAME: "Loading objects...",
                OBJECT_LABEL: "Loading objects...",
                NODE_ID: `LOADING:${nodeId}`,
                PARENT_ID: nodeId,
                LEVEL_NO: Number(row.LEVEL_NO || 2) + 1,
                IS_SELECTABLE: "N",
                IS_REGISTERED: "N",
                CHILD_COUNT: null
            });
        },

        replaceGroupChildren(row, children, response = null) {
            const nodeId = this.getNodeId(row);
            if (!nodeId) return;
            this.removeGroupChildren(nodeId);
            const index = this.objectRows.findIndex((item) => this.getNodeId(item) === nodeId);
            if (index < 0) return;

            const normalizedChildren = children.map((child) => ({
                ...child,
                PARENT_ID: nodeId,
                LEVEL_NO: Number(row.LEVEL_NO || 2) + 1
            }));
            this.objectRows.splice(index + 1, 0, ...normalizedChildren);
            row.CHILD_COUNT = this.getResponseChildTotal(response, normalizedChildren.filter((child) => this.getObjectType(child) !== "LOAD_MORE").length);
        },

        removeGroupChildren(parentNodeId) {
            this.objectRows = this.objectRows.filter((item) => this.getParentId(item) !== parentNodeId);
        },

        appendGroupChildren(parent, children, response = null) {
            const parentNodeId = this.getNodeId(parent);
            if (!parentNodeId) return;
            const sameParentRows = this.objectRows
                .map((row, index) => ({ row, index }))
                .filter((item) => this.getParentId(item.row) === parentNodeId);
            const insertIndex = sameParentRows.length
                ? sameParentRows[sameParentRows.length - 1].index + 1
                : this.objectRows.findIndex((row) => this.getNodeId(row) === parentNodeId) + 1;
            if (insertIndex < 0) return;
            const normalizedChildren = children.map((child) => ({
                ...child,
                PARENT_ID: parentNodeId,
                LEVEL_NO: Number(parent.LEVEL_NO || 2) + 1
            }));
            this.objectRows.splice(insertIndex, 0, ...normalizedChildren);
            const loadedCount = this.objectRows.filter((child) =>
                this.getParentId(child) === parentNodeId && this.getObjectType(child) !== "LOAD_MORE"
            ).length;
            parent.CHILD_COUNT = this.getResponseChildTotal(response, loadedCount);
        },

        getResponseChildTotal(response, fallbackCount) {
            const total = Number(response?.childTotal ?? response?.total);
            if (Number.isFinite(total)) return total;
            return fallbackCount;
        },

        withGroupLoadMoreRow(parent, rows, response) {
            const nextRows = rows.slice();
            if (response?.hasMore) {
                nextRows.push(this.createGroupLoadMoreRow(parent, Number(response.nextOffset || nextRows.length)));
            }
            return nextRows;
        },

        createGroupLoadMoreRow(parent, nextOffset, label = "Load more...") {
            const parentNodeId = this.getNodeId(parent);
            return {
                OWNER: parent.OWNER || "",
                OBJECT_TYPE: "LOAD_MORE",
                OBJECT_NAME: label,
                OBJECT_LABEL: label,
                NODE_ID: `LOAD_MORE:${parentNodeId}:${nextOffset}`,
                PARENT_ID: parentNodeId,
                LEVEL_NO: Number(parent.LEVEL_NO || 2) + 1,
                IS_SELECTABLE: "N",
                IS_REGISTERED: "N",
                CHILD_COUNT: null,
                GROUP_LOAD_MORE: "Y",
                GROUP_TYPE: this.getGroupType(parent),
                NEXT_OFFSET: nextOffset
            };
        },

        replaceTreeRow(oldRow, nextRow) {
            const index = this.objectRows.findIndex((row) => this.getNodeId(row) === this.getNodeId(oldRow));
            if (index >= 0) this.objectRows.splice(index, 1, nextRow);
        },

        removeTreeRow(nodeId) {
            this.objectRows = this.objectRows.filter((row) => this.getNodeId(row) !== nodeId);
        },

        async handlePackageNodeClick(row) {
            const nodeId = this.getNodeId(row);
            if (!nodeId) return;

            if (!this.loadedPackageNodes.has(nodeId)) {
                await this.loadPackageMembers(row);
                this.collapsedNodes.delete(nodeId);
                this.refreshTreeRows();
                window.requestAnimationFrame(() => this.handleTreeScroll());
                return;
            }

            this.toggleNode(nodeId);
        },

        async loadPackageMembers(row) {
            const nodeId = this.getNodeId(row);
            if (!nodeId || this.loadingPackageNodes.has(nodeId)) return;

            this.loadingPackageNodes.add(nodeId);
            this.insertPackageLoadingRow(row);
            this.refreshTreeRows();

            try {
                const params = new URLSearchParams({
                    owner: row.OWNER || "",
                    packageName: row.OBJECT_NAME || "",
                    registeredOnly: this.isRegisteredOnlyTree() ? "Y" : "N"
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/package-members?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    timeoutMs: 15000,
                    timeoutMessage: "Package member load is taking too long. Click to retry."
                });
                if (json.status && json.status !== "success") {
                    throw new Error(json.message || json.detail || "Package member response failed.");
                }

                const children = Array.isArray(json.data) ? json.data : [];
                this.replacePackageChildren(row, children);
                this.loadedPackageNodes.add(nodeId);
            } catch (error) {
                console.error("[M90001] package members load failed", error);
                this.removePackageChildren(nodeId);
                this.updateDescription(error.message || "Package member load failed.");
            } finally {
                this.loadingPackageNodes.delete(nodeId);
                this.refreshTreeRows();
            }
        },

        insertPackageLoadingRow(row) {
            const nodeId = this.getNodeId(row);
            if (!nodeId) return;
            this.removePackageChildren(nodeId);
            const index = this.objectRows.findIndex((item) => this.getNodeId(item) === nodeId);
            if (index < 0) return;
            this.objectRows.splice(index + 1, 0, {
                OWNER: row.OWNER,
                OBJECT_TYPE: "LOADING",
                OBJECT_NAME: "Loading package members...",
                OBJECT_LABEL: "Loading package members...",
                NODE_ID: `LOADING:${nodeId}`,
                PARENT_ID: nodeId,
                LEVEL_NO: 4,
                IS_SELECTABLE: "N",
                IS_REGISTERED: "N",
                CHILD_COUNT: null
            });
        },

        replacePackageChildren(row, children) {
            const nodeId = this.getNodeId(row);
            if (!nodeId) return;
            this.removePackageChildren(nodeId);
            const index = this.objectRows.findIndex((item) => this.getNodeId(item) === nodeId);
            if (index < 0) return;

            const normalizedChildren = children.map((child) => ({
                ...child,
                PARENT_ID: nodeId,
                LEVEL_NO: 4
            }));
            this.objectRows.splice(index + 1, 0, ...normalizedChildren);
            row.CHILD_COUNT = normalizedChildren.length;
        },

        removePackageChildren(parentNodeId) {
            this.objectRows = this.objectRows.filter((item) => this.getParentId(item) !== parentNodeId);
        },

        getVisibleObjectRows() {
            const hiddenParents = new Set();

            const rows = this.objectRows.filter((row) => {
                const nodeId = this.getNodeId(row);
                const parentId = this.getParentId(row);
                if (parentId && hiddenParents.has(parentId)) {
                    hiddenParents.add(nodeId);
                    return false;
                }

                if (parentId && this.collapsedNodes.has(parentId)) {
                    hiddenParents.add(nodeId);
                    return false;
                }

                return true;
            });
            if (this.treeHasMore) rows.push(this.createLoadMoreRow());
            return rows;
        },

        createLoadMoreRow() {
            return {
                OWNER: "",
                OBJECT_TYPE: "LOAD_MORE",
                OBJECT_NAME: "Load more...",
                OBJECT_LABEL: "Load more...",
                NODE_ID: `LOAD_MORE:${this.treeNextOffset}`,
                PARENT_ID: "",
                LEVEL_NO: 1,
                IS_SELECTABLE: "N",
                IS_REGISTERED: "N",
                CHILD_COUNT: null
            };
        },

        async loadMoreObjects() {
            const scrollTop = this.getTreeScrollTop();
            await this.loadObjectTree(false);
            this.restoreTreeScroll(scrollTop);
        },

        getTreeScrollTop() {
            return getContainerEl("#gridContainer")?.querySelector(".env-tree-viewport")?.scrollTop || 0;
        },

        restoreTreeScroll(scrollTop) {
            window.requestAnimationFrame(() => {
                const viewport = getContainerEl("#gridContainer")?.querySelector(".env-tree-viewport");
                if (viewport) {
                    viewport.scrollTop = scrollTop;
                    this.renderTreeWindow();
                }
            });
        },

        isExpandable(row) {
            const objectType = this.getObjectType(row);
            if (!row || (objectType !== "GROUP" && objectType !== "PACKAGE")) return false;
            const nodeId = this.getNodeId(row);
            if (objectType === "PACKAGE") return Boolean(nodeId);
            return Boolean(nodeId);
        },

        getGroupType(row) {
            const nodeId = this.getNodeId(row);
            const parts = nodeId.split(":");
            return String(parts[2] || row.OBJECT_NAME || "").trim().toUpperCase();
        },

        toggleNode(nodeId) {
            if (this.collapsedNodes.has(nodeId)) {
                this.collapsedNodes.delete(nodeId);
            } else {
                this.collapsedNodes.add(nodeId);
            }
            this.refreshTreeRows();
            window.requestAnimationFrame(() => this.handleTreeScroll());
        },

        expandAllGroups() {
            this.collapsedNodes.clear();
            this.refreshTreeRows();
        },

        collapseAllGroups() {
            this.collapsedNodes = new Set(
                this.objectRows
                    .filter((row) => this.isExpandable(row))
                    .map((row) => this.getNodeId(row))
                    .filter(Boolean)
            );
            this.refreshTreeRows();
        },

        handleObjectSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.treeSearchMode = true;
            this.loadObjectTree(true);
        },

        async searchObject(direction = "down") {
            const input = getContainerEl("#objectSearch-M90001");
            const keyword = (input?.value || "").trim();
            if (!keyword || this.treeSearchRunning) return;

            if (this.isObjectSearchFilterEnabled()) {
                await this.searchFilteredObject(direction);
                return;
            }

            this.treeSearchRunning = true;
            try {
                const normalizedKeyword = keyword.toLowerCase();
                const isUp = direction === "up";
                const startIndex = this.getSearchStartIndex(normalizedKeyword, isUp);
                let match = isUp
                    ? this.findPreviousObjectRow(keyword, startIndex)
                    : this.findNextObjectRow(keyword, startIndex);

                if (!match) {
                    match = isUp
                        ? this.findPreviousObjectRow(keyword, this.objectRows.length - 1)
                        : this.findNextObjectRow(keyword, 0);
                    if (!match) {
                        this.updateDescription(`No object matched "${keyword}".`);
                        input?.focus();
                        return;
                    }
                    const wrapDirection = isUp ? "last" : "first";
                    this.updateDescription(`Search wrapped to the ${wrapDirection} match for "${keyword}".`);
                }

                this.lastSearchKeyword = normalizedKeyword;
                this.lastSearchNodeId = match.NODE_ID;
                this.revealTreeRow(match);
            } finally {
                this.treeSearchRunning = false;
            }
        },

        async searchFilteredObject(direction = "down") {
            const input = getContainerEl("#objectSearch-M90001");
            const keyword = (input?.value || "").trim();
            if (!keyword || this.treeSearchRunning) return;

            this.treeSearchRunning = true;
            try {
                this.refreshTreeRows();
                let match = this.findFilteredObjectRow(direction);
                if (!match) {
                    this.updateDescription(`No object matched "${keyword}".`);
                    input?.focus();
                    return;
                }

                this.lastSearchKeyword = keyword.toLowerCase();
                this.lastSearchNodeId = this.getNodeId(match);
                this.selectedTreeNodeId = this.getNodeId(match);
                this.refreshTreeRows();
                this.scrollToTreeRow(this.getNodeId(match));
            } finally {
                this.treeSearchRunning = false;
            }
        },

        findFilteredObjectRow(direction = "down") {
            const rows = this.visibleObjectRows;
            if (!rows.length) return null;
            const isUp = direction === "up";
            const currentIndex = rows.findIndex((row) => this.getNodeId(row) === (this.lastSearchNodeId || this.selectedTreeNodeId));
            let nextIndex = isUp ? currentIndex - 1 : currentIndex + 1;
            if (currentIndex < 0) {
                nextIndex = isUp ? rows.length - 1 : 0;
            }
            if (nextIndex < 0) nextIndex = rows.length - 1;
            if (nextIndex >= rows.length) nextIndex = 0;
            return rows[nextIndex] || null;
        },

        getSearchStartIndex(normalizedKeyword, isUp = false) {
            if (normalizedKeyword !== this.lastSearchKeyword) {
                return isUp ? this.objectRows.length - 1 : 0;
            }

            const currentNodeId = this.lastSearchNodeId || this.selectedTreeNodeId;
            const currentIndex = this.objectRows.findIndex((row) => this.getNodeId(row) === currentNodeId);
            if (currentIndex < 0) {
                return isUp ? this.objectRows.length - 1 : 0;
            }
            return isUp ? currentIndex - 1 : currentIndex + 1;
        },

        findNextObjectRow(keyword, startIndex = 0) {
            const lowered = keyword.toLowerCase();
            return this.objectRows.slice(Math.max(0, startIndex)).find((row) => this.isObjectSearchMatch(row, lowered));
        },

        findPreviousObjectRow(keyword, startIndex = this.objectRows.length - 1) {
            const lowered = keyword.toLowerCase();
            const safeStart = Math.min(startIndex, this.objectRows.length - 1);
            for (let index = safeStart; index >= 0; index -= 1) {
                const row = this.objectRows[index];
                if (this.isObjectSearchMatch(row, lowered)) return row;
            }
            return null;
        },

        isObjectSearchMatch(row, loweredKeyword) {
            if (!row) return false;
            const values = [
                row.OWNER,
                row.OBJECT_TYPE,
                row.OBJECT_NAME,
                row.OBJECT_LABEL
            ];
            return values.some((value) => String(value || "").toLowerCase().includes(loweredKeyword));
        },

        findObjectRow(keyword, startIndex = 0) {
            return this.findNextObjectRow(keyword, startIndex);
        },

        isRegisteredOnlyTree() {
            return Boolean(getContainerEl("#registeredOnly-M90001")?.checked);
        },

        handleRegisteredFilterLabelClick(event) {
            if (event.target?.id === "registeredOnly-M90001") return;
            event.preventDefault();
            event.stopPropagation();
            if (event.detail > 1) return;

            const checkbox = getContainerEl("#registeredOnly-M90001");
            if (!checkbox) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        },

        handleRegisteredFilterLabelDoubleClick(event) {
            event.preventDefault();
            event.stopPropagation();
        },

        markLoadedTreeNodes() {
            this.loadedGroupNodes = new Set(
                this.objectRows
                    .filter((row) => this.getObjectType(row) === "GROUP")
                    .map((row) => this.getNodeId(row))
                    .filter(Boolean)
            );
            this.loadedPackageNodes = new Set(
                this.objectRows
                    .filter((row) => this.getObjectType(row) === "PACKAGE")
                    .map((row) => this.getNodeId(row))
                    .filter(Boolean)
            );
            this.loadingGroupNodes = new Set();
            this.loadingPackageNodes = new Set();
        },

        isObjectSearchFilterEnabled() {
            return Boolean(getContainerEl("#objectSearchFilter-M90001")?.checked);
        },

        handleObjectSearchInput() {
            const keyword = (getContainerEl("#objectSearch-M90001")?.value || "").trim();
            if (!keyword && this.treeSearchMode) {
                this.treeSearchMode = false;
                this.loadObjectTree(true);
            }
        },

        handleObjectSearchFilterChange() {
            this.lastSearchKeyword = "";
            this.lastSearchNodeId = null;
            this.refreshTreeRows();
        },

        getObjectCategoryFilter() {
            const all = getContainerEl("#objectCategoryAll-M90001");
            if (!all || all.checked) return "ALL";

            const selected = Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".object-category-M90001:checked") || [])
                .map((input) => input.value)
                .filter(Boolean);
            return selected.length > 0 ? selected.join(",") : "ALL";
        },

        handleCategoryAllChange(checkbox) {
            const categoryInputs = Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".object-category-M90001") || []);
            if (checkbox.checked) {
                categoryInputs.forEach((input) => {
                    input.checked = false;
                });
            } else {
                checkbox.checked = true;
            }
        },

        handleCategoryChange() {
            const all = getContainerEl("#objectCategoryAll-M90001");
            const selected = Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".object-category-M90001:checked") || []);
            if (all) {
                all.checked = selected.length === 0;
            }
        },

        revealTreeRow(row) {
            this.expandParentGroups(row);
            this.selectedTreeNodeId = this.getNodeId(row);
            this.refreshTreeRows();
            this.scrollToTreeRow(this.getNodeId(row));
        },

        expandParentGroups(row) {
            let parentId = this.getParentId(row);
            while (parentId) {
                this.collapsedNodes.delete(parentId);
                const parent = this.objectRows.find((item) => this.getNodeId(item) === parentId);
                parentId = this.getParentId(parent);
            }
        },

        scrollToTreeRow(nodeId) {
            const index = this.visibleObjectRows.findIndex((row) => this.getNodeId(row) === nodeId);
            if (index < 0) return;

            const container = getContainerEl("#gridContainer");
            const viewport = container?.querySelector(".env-tree-viewport");
            if (!viewport) return;

            const top = Math.max(0, (index * this.treeRowHeight) - Math.floor(viewport.clientHeight / 2));
            viewport.scrollTop = top;
            this.renderTreeWindow();
            window.requestAnimationFrame(() => {
                const rows = Array.from(container.querySelectorAll(".env-tree-row[data-node-id]"));
                const target = rows.find((element) => element.dataset.nodeId === nodeId);
                target?.focus();
            });
        },

        async selectObject(objectRow) {
            this.selectedObject = objectRow;
            this.setDetailPresetButtonVisible(false);
            this.updateClassificationSettingsButton();
            if (!this.isClassificationSettingsObject(objectRow)) {
                this.closeClassificationSettings();
            }
            this.updateDescription(`Loading ${objectRow.OWNER}.${objectRow.OBJECT_NAME}...`);
            const sourceRequestSeq = this.objectSourceRequestSeq + 1;
            this.objectSourceRequestSeq = sourceRequestSeq;
            this.renderObjectSource("Loading script...", "Loading source...");

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-detail`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        owner: objectRow.OWNER,
                        objectType: objectRow.OBJECT_TYPE,
                        objectName: objectRow.OBJECT_NAME
                    }
                });

                this.objectMeta = this.normalizeObjectMeta(json.metadata, objectRow);
                this.renderObjectMeta();

                const data = this.dedupePredictedTypeDetailRows(Array.isArray(json.data) ? json.data : [], objectRow);
                this.detailSource = this.normalizeDetailSource(data, json.source);
                this.renderDetailSource();
                this.rows = data.map((item) => ({
                    key: item.ITEM_NAME || "",
                    value: item.ITEM_VALUE || "",
                    desc: item.ITEM_DESC || "",
                    defaultValue: item.ITEM_DEFAULT || "",
                    order: item.ITEM_ORDER || 0
                }));
                this.originalRows = this.rows.map((row) => ({ ...row }));
                this.selectedRowIndex = this.rows.length > 0 ? 0 : null;
                this.renderRows();
                this.updateDetailPresetButton();
                this.loadObjectSource(objectRow, sourceRequestSeq);

                const label = objectRow.OBJECT_TYPE === "TABLE" ? "columns" : "parameters";
                this.updateDescription(`${objectRow.OWNER}.${objectRow.OBJECT_NAME} ${label}`);
            } catch (error) {
                console.error("[M90001] object detail load failed", error);
                this.rows = [];
                this.originalRows = [];
                this.selectedRowIndex = null;
                this.objectMeta = this.createDefaultObjectMeta(objectRow);
                this.detailSource = "Request failed";
                this.renderObjectMeta();
                this.renderDetailSource();
                this.renderRows();
                this.setDetailPresetButtonVisible(false);
                this.renderObjectSource("", "Source was not loaded.");
                this.updateDescription("Could not load object detail.");
            }
        },

        async loadObjectSource(objectRow, requestSeq) {
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-source`, {
                    method: "POST",
                    showLoading: false,
                    body: {
                        owner: objectRow.OWNER,
                        objectType: objectRow.OBJECT_TYPE,
                        objectName: objectRow.OBJECT_NAME
                    }
                });
                if (requestSeq !== this.objectSourceRequestSeq) return;
                this.renderObjectSource(json.source || "", json.source ? "Dictionary source" : "No source text found.");
            } catch (error) {
                if (requestSeq !== this.objectSourceRequestSeq) return;
                this.renderObjectSource(error.message || "Script load failed.", "Source load failed.");
            }
        },

        renderObjectSource(source, status) {
            const viewer = getContainerEl("#objectSourceViewer-M90001");
            const statusEl = getContainerEl("#objectSourceStatus-M90001");
            if (viewer) viewer.value = source || "";
            if (statusEl) statusEl.textContent = status || "";
        },

        async copyObjectSource() {
            const viewer = getContainerEl("#objectSourceViewer-M90001");
            const text = viewer?.value || "";
            if (!text.trim()) {
                alert("No script source to copy.");
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                this.renderObjectSource(text, "Script copied.");
            } catch (error) {
                viewer.focus();
                viewer.select();
                document.execCommand("copy");
                this.renderObjectSource(text, "Script copied.");
            }
        },

        normalizeDetailSource(data, fallbackSource = "") {
            const source = data.find((item) => item?.DETAIL_SOURCE || item?.detailSource)?.DETAIL_SOURCE
                || data.find((item) => item?.DETAIL_SOURCE || item?.detailSource)?.detailSource
                || fallbackSource;
            if (source === "SAVED") return "Saved data";
            if (source === "DICTIONARY") return "Dictionary default";
            if (!data.length) return "No detail rows";
            return String(source || "Unknown");
        },

        normalizeObjectMeta(meta, objectRow) {
            const base = this.createDefaultObjectMeta(objectRow);
            if (!meta || typeof meta !== "object") return base;

            return {
                objectId: meta.OBJECT_ID ?? meta.objectId ?? base.objectId,
                owner: meta.OWNER || meta.owner || base.owner,
                objectType: meta.OBJECT_TYPE || meta.objectType || base.objectType,
                objectName: meta.OBJECT_NAME || meta.objectName || base.objectName,
                objectLabel: meta.OBJECT_LABEL || meta.objectLabel || base.objectLabel,
                description: meta.DESCRIPTION || meta.description || meta.DICTIONARY_COMMENT || base.description,
                useYn: meta.USE_YN || meta.useYn || base.useYn,
                sortOrder: meta.SORT_ORDER ?? meta.sortOrder ?? base.sortOrder,
                resultCreateYn: meta.RESULT_CREATE_YN || meta.resultCreateYn || base.resultCreateYn,
                resultOwner: meta.RESULT_OWNER || meta.resultOwner || base.resultOwner,
                resultTableName: meta.RESULT_TABLE_NAME || meta.resultTableName || base.resultTableName
            };
        },

        createDefaultObjectMeta(objectRow) {
            return {
                objectId: "",
                owner: objectRow?.OWNER || "",
                objectType: objectRow?.OBJECT_TYPE || "",
                objectName: objectRow?.OBJECT_NAME || "",
                objectLabel: objectRow?.OBJECT_LABEL || objectRow?.OBJECT_NAME || "",
                description: objectRow?.OBJECT_LABEL || objectRow?.OBJECT_NAME || "",
                useYn: "Y",
                sortOrder: 0,
                resultCreateYn: "N",
                resultOwner: objectRow?.OWNER || "",
                resultTableName: ""
            };
        },

        renderObjectMeta() {
            const meta = this.objectMeta || this.createDefaultObjectMeta(this.selectedObject);
            this.setFieldValue("#objectId-M90001", meta.objectId || "");
            this.setFieldValue("#objectType-M90001", meta.objectType || "");
            this.setFieldValue("#objectName-M90001", meta.objectName || "");
            this.setFieldValue("#objectLabel-M90001", meta.objectLabel || "");
            this.setFieldValue("#objectUseYn-M90001", meta.useYn || "Y");
            this.setFieldValue("#objectSortOrder-M90001", meta.sortOrder ?? 0);
            this.setFieldValue("#objectDescription-M90001", meta.description || "");
            this.setFieldValue("#objectResultCreateYn-M90001", meta.resultCreateYn || "N");
            this.setFieldValue("#objectResultOwner-M90001", meta.resultOwner || "");
            this.setFieldValue("#objectResultTable-M90001", meta.resultTableName || "");
            this.syncResultMetaFields();
            this.renderDetailSource();
        },

        renderDetailSource() {
            const meta = this.objectMeta || this.createDefaultObjectMeta(this.selectedObject);
            this.setFieldValue("#detailObjectId-M90001", meta.objectId || "");
            this.setFieldValue("#detailSource-M90001", this.detailSource || "");
        },

        async updateDetailPresetButton() {
            const button = getContainerEl(".env-detail-preset-btn");
            if (!button) return;
            this.setDetailPresetButtonVisible(false);
            if (!this.selectedObject || !this.rows.length) return;
            const selectedObjectName = this.normalizePresetObjectName(this.selectedObject.OBJECT_NAME);
            const preset = await this.findDetailPresetForSelectedObject();
            if (selectedObjectName !== this.normalizePresetObjectName(this.selectedObject?.OBJECT_NAME)) return;
            this.setDetailPresetButtonVisible(Boolean(preset));
        },

        setDetailPresetButtonVisible(visible) {
            const button = getContainerEl(".env-detail-preset-btn");
            if (button) button.hidden = !visible;
        },

        isClassificationSettingsObject(objectRow = this.selectedObject) {
            return this.normalizePresetKey(objectRow?.OBJECT_TYPE) === "PROCEDURE"
                && this.normalizePresetObjectName(objectRow?.OBJECT_NAME) === CLASSIFICATION_OBJECT_NAME;
        },

        dedupePredictedTypeDetailRows(rows, objectRow = this.selectedObject) {
            if (!this.isClassificationSettingsObject(objectRow)) return rows;
            const seen = new Set();
            return rows.filter((row) => {
                const key = this.normalizePresetKey(row?.ITEM_NAME);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },

        updateClassificationSettingsButton() {
            const button = getContainerEl(".env-classification-settings-btn");
            if (button) button.hidden = !this.isClassificationSettingsObject();
        },

        updateObjectMeta(field, value) {
            this.objectMeta = this.objectMeta || this.createDefaultObjectMeta(this.selectedObject);
            this.objectMeta[field] = value;
        },

        handleResultCreateChange(value) {
            this.updateObjectMeta("resultCreateYn", value);
            this.syncResultMetaFields();
        },

        syncResultMetaFields() {
            const mode = String(getContainerEl("#objectResultCreateYn-M90001")?.value || this.objectMeta?.resultCreateYn || "N").trim().toUpperCase();
            const disabled = mode === "N";
            ["#objectResultOwner-M90001", "#objectResultTable-M90001"].forEach((selector) => {
                const field = getContainerEl(selector);
                if (field) field.disabled = disabled;
            });
        },

        setFieldValue(selector, value) {
            const field = getContainerEl(selector);
            if (field) field.value = value;
        },

        updateDescription(text) {
            const desc = getContainerEl("#envDescription-M90001");
            if (desc) desc.textContent = text;
        },

        renderRows() {
            const grid = getContainerEl("#envRows-M90001");
            if (!grid) return;

            if (this.rows.length === 0) {
                grid.innerHTML = "";
                return;
            }

            grid.innerHTML = `
                <table class="env-detail-table">
                    <thead>
                        <tr>
                            <th class="env-order-head">ORDER</th>
                            <th class="env-key-head">KEY</th>
                            <th class="env-value-head">VALUE</th>
                            <th class="env-desc-head">COMMENT</th>
                            <th class="env-default-head">DEFAULT</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.rows.map((row, index) => this.createRowTemplate(row, index)).join("")}
                    </tbody>
                </table>
            `;
        },

        createRowTemplate(row, index) {
            const isSelected = index === this.selectedRowIndex;
            const safeKey = this.escapeHtml(row.key);
            const safeValue = this.escapeHtml(row.value);
            const safeDesc = this.escapeHtml(row.desc);
            const safeDefault = this.escapeHtml(row.defaultValue);

            return `
                <tr data-row-index="${index}" class="${isSelected ? "is-selected" : ""}" onclick="M90001.selectDetailRow(${index})">
                    <td class="env-order-cell">${index + 1}</td>
                    <td><div class="env-text-cell env-readonly-cell" title="${safeKey}" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()">${safeKey || "&nbsp;"}</div></td>
                    <td><div class="env-text-cell env-readonly-cell" title="${safeValue}" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()">${safeValue || "&nbsp;"}</div></td>
                    <td>
                        <input
                            class="env-field env-desc-input"
                            type="text"
                            value="${safeDesc}"
                            aria-label="Item comment"
                            onclick="event.stopPropagation()"
                            oninput="M90001.updateDesc(${index}, this.value)"
                        >
                    </td>
                    <td>
                        <input
                            class="env-field env-default-input"
                            type="text"
                            value="${safeDefault}"
                            aria-label="Item default value"
                            onclick="event.stopPropagation()"
                            oninput="M90001.updateDefault(${index}, this.value)"
                        >
                    </td>
                </tr>
            `;
        },

        addVariable() {
            alert("Rows are based on the selected DB object and cannot be added manually.");
        },

        deleteVariable(index) {
            alert("Rows are based on the selected DB object and cannot be deleted manually.");
        },

        toggleMask(index) {
            return;
        },

        updateKey(index, value) {
            if (!this.rows[index]) return;
            this.rows[index].key = value;
        },

        updateValue(index, value) {
            if (!this.rows[index]) return;
            this.rows[index].value = value;
        },

        updateDesc(index, value) {
            if (!this.rows[index]) return;
            this.rows[index].desc = value;
        },

        updateDefault(index, value) {
            if (!this.rows[index]) return;
            this.rows[index].defaultValue = value;
        },

        async applyDetailPresets() {
            if (!this.selectedObject) {
                alert("Select a procedure, function, package member, or model first.");
                return;
            }
            if (!this.rows.length) {
                alert("No parameter rows to initialize.");
                return;
            }

            try {
                const preset = await this.findDetailPresetForSelectedObject();
                if (!preset) {
                    alert("No comment/default preset is registered for this object.");
                    return;
                }

                const changedCount = this.applyPresetRows(preset);
                const metaChanged = this.applyPresetMetadata(preset);

                this.renderRows();
                this.renderObjectMeta();
                this.detailSource = changedCount > 0 || metaChanged ? "Preset applied" : this.detailSource;
                this.renderDetailSource();
                alert(changedCount > 0 || metaChanged
                    ? `${changedCount} comment/default value(s) and ${metaChanged ? "metadata" : "no metadata"} applied from preset. Review and click Save to store.`
                    : "Preset found, but no matching parameter keys were changed.");
            } catch (error) {
                console.error("[M90001] detail preset apply failed", error);
                alert(error.message || "Comment/default preset load failed.");
            }
        },

        applyPresetRows(preset) {
            const itemMap = this.createPresetItemMap(preset);
            let changedCount = 0;
            this.rows = this.rows.map((row) => {
                const item = itemMap.get(this.normalizePresetKey(row.key));
                if (!item) return row;

                const next = { ...row };
                const hasComment = Object.prototype.hasOwnProperty.call(item, "comment")
                    || Object.prototype.hasOwnProperty.call(item, "desc");
                const hasDefault = Object.prototype.hasOwnProperty.call(item, "defaultValue")
                    || Object.prototype.hasOwnProperty.call(item, "default");
                if (hasComment) {
                    next.desc = item.comment ?? item.desc ?? "";
                }
                if (hasDefault) {
                    next.defaultValue = item.defaultValue ?? item.default ?? "";
                }
                if (next.desc !== row.desc || next.defaultValue !== row.defaultValue) {
                    changedCount += 1;
                }
                return next;
            });
            return changedCount;
        },

        applyPresetMetadata(preset) {
            if (!preset) return false;
            const source = preset.metadata && typeof preset.metadata === "object" ? preset.metadata : preset;
            const nextMeta = this.objectMeta || this.createDefaultObjectMeta(this.selectedObject);
            const mappings = [
                ["label", "objectLabel"],
                ["objectLabel", "objectLabel"],
                ["description", "description"],
                ["resultCreateYn", "resultCreateYn"],
                ["resultOwner", "resultOwner"],
                ["resultTableName", "resultTableName"]
            ];
            let changed = false;
            mappings.forEach(([sourceKey, targetKey]) => {
                if (!Object.prototype.hasOwnProperty.call(source, sourceKey)) return;
                const value = this.resolvePresetMetadataValue(source[sourceKey]);
                if (String(nextMeta[targetKey] ?? "") !== String(value ?? "")) {
                    nextMeta[targetKey] = value;
                    changed = true;
                }
            });
            this.objectMeta = nextMeta;
            return changed;
        },

        resolvePresetMetadataValue(value) {
            const text = String(value ?? "");
            if (text === "__CURRENT_OWNER__") return this.selectedObject?.OWNER || "";
            if (text === ":OBJECT_OWNER") return this.selectedObject?.OWNER || "";
            if (text === ":OBJECT_NAME") return this.selectedObject?.OBJECT_NAME || "";
            return text;
        },

        async findDetailPresetForSelectedObject() {
            const presets = await this.loadDetailPresets();
            const objects = Array.isArray(presets?.objects) ? presets.objects : [];
            const selected = this.selectedObject || {};
            const owner = this.normalizePresetKey(selected.OWNER);
            const objectType = this.normalizePresetKey(selected.OBJECT_TYPE);
            const objectName = this.normalizePresetObjectName(selected.OBJECT_NAME);

            return objects.find((preset) => {
                const presetOwner = this.normalizePresetKey(preset.owner || "*");
                const presetType = this.normalizePresetKey(preset.objectType || "*");
                const presetName = this.normalizePresetObjectName(preset.objectName);
                const ownerMatches = presetOwner === "*" || presetOwner === owner;
                const typeMatches = presetType === "*" || presetType === objectType;
                return ownerMatches && typeMatches && presetName === objectName;
            }) || null;
        },

        async loadDetailPresets() {
            try {
                const response = await fetch(`${DETAIL_PRESET_URL}?v=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) {
                    console.warn(`[M90001] detail preset file was not loaded: ${response.status}`);
                    this.detailPresets = { objects: [] };
                    return this.detailPresets;
                }
                const presets = await response.json();
                this.detailPresets = {
                    ...presets,
                    objects: Array.isArray(presets?.objects) ? presets.objects : []
                };
            } catch (error) {
                console.warn("[M90001] detail preset file was ignored.", error);
                this.detailPresets = { objects: [] };
            }
            return this.detailPresets;
        },

        createPresetItemMap(preset) {
            const items = Array.isArray(preset?.items) ? preset.items : [];
            return new Map(items
                .filter((item) => item?.key)
                .map((item) => [this.normalizePresetKey(item.key), item]));
        },

        normalizePresetKey(value) {
            return String(value || "").trim().toUpperCase();
        },

        normalizePresetObjectName(value) {
            return this.normalizePresetKey(value).replace(/\s+/g, "");
        },

        async openClassificationSettings() {
            if (!this.isClassificationSettingsObject()) return;
            const layer = getContainerEl("#classificationSettingsLayer-M90001");
            if (!layer) return;
            layer.hidden = false;
            this.enableClassificationSettingsLayerDrag(layer);
            await this.loadClassificationSettings();
        },

        closeClassificationSettings() {
            const layer = getContainerEl("#classificationSettingsLayer-M90001");
            if (!layer) return;
            layer.hidden = true;
            const dialog = layer.querySelector(".env-classification-settings-dialog");
            if (dialog) {
                dialog.style.position = "";
                dialog.style.margin = "";
                dialog.style.left = "";
                dialog.style.top = "";
            }
        },

        handleClassificationSettingsLayerClick(event) {
            if (event?.target?.id === "classificationSettingsLayer-M90001") {
                this.closeClassificationSettings();
            }
        },

        enableClassificationSettingsLayerDrag(layer) {
            const dialog = layer?.querySelector(".env-classification-settings-dialog");
            const header = dialog?.querySelector(":scope > header");
            if (!dialog || !header || dialog.dataset.dragBound === "Y") return;
            dialog.dataset.dragBound = "Y";
            header.classList.add("is-draggable");
            header.addEventListener("pointerdown", (event) => {
                if (event.button !== undefined && event.button !== 0) return;
                if (event.target.closest("button, a, input, select, textarea")) return;
                event.preventDefault();
                const rect = dialog.getBoundingClientRect();
                const pointerId = event.pointerId;
                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = rect.left;
                const startTop = rect.top;
                dialog.style.position = "fixed";
                dialog.style.margin = "0";
                dialog.style.left = `${startLeft}px`;
                dialog.style.top = `${startTop}px`;
                header.setPointerCapture?.(pointerId);

                const move = (moveEvent) => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const maxLeft = Math.max(8, window.innerWidth - dialog.offsetWidth - 8);
                    const maxTop = Math.max(8, window.innerHeight - dialog.offsetHeight - 8);
                    const nextLeft = Math.max(8, Math.min(maxLeft, startLeft + moveEvent.clientX - startX));
                    const nextTop = Math.max(8, Math.min(maxTop, startTop + moveEvent.clientY - startY));
                    dialog.style.left = `${nextLeft}px`;
                    dialog.style.top = `${nextTop}px`;
                };
                const end = (endEvent) => {
                    if (endEvent.pointerId !== pointerId) return;
                    header.removeEventListener("pointermove", move);
                    header.removeEventListener("pointerup", end);
                    header.removeEventListener("pointercancel", end);
                    if (header.hasPointerCapture?.(pointerId)) header.releasePointerCapture(pointerId);
                };
                header.addEventListener("pointermove", move);
                header.addEventListener("pointerup", end);
                header.addEventListener("pointercancel", end);
            });
        },

        async loadClassificationDefaults() {
            try {
                const response = await fetch(`${CLASSIFICATION_PRESET_URL}?v=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const preset = await response.json();
                const categories = Array.isArray(preset?.targetSettingCategories) ? preset.targetSettingCategories : [];
                const category = categories.find((item) => this.normalizePresetKey(item?.CATEGORY_CODE) === CLASSIFICATION_CATEGORY);
                this.classificationDefaults = Array.isArray(category?.DEFAULTS)
                    ? category.DEFAULTS.map((item) => ({ ...item }))
                    : [];
                return categories;
            } catch (error) {
                console.error("[M90001] classification preset load failed", error);
                this.classificationDefaults = [];
                throw error;
            }
        },

        async loadClassificationSettings(preferredKey = this.selectedClassificationKey) {
            this.setClassificationSettingsMessage(getPageMessage(
                "loadingClassificationSettings",
                "Loading column type classification settings..."
            ));
            try {
                await this.loadClassificationDefaults();
                const params = new URLSearchParams({ categoryCode: CLASSIFICATION_CATEGORY });
                const json = await CommonUtils.request(`${API_BASE_URL}/${CLASSIFICATION_API_CODE}/settings?${params.toString()}`, {
                    method: "GET",
                    showLoading: false
                });
                const overrides = Array.isArray(json.data) ? json.data : [];
                this.classificationSettings = this.mergeClassificationSettings(this.classificationDefaults, overrides);
                const normalizedPreferred = this.normalizePresetKey(preferredKey);
                this.selectedClassificationKey = this.classificationSettings.some((item) => item.SETTING_KEY === normalizedPreferred)
                    ? normalizedPreferred
                    : (this.classificationSettings[0]?.SETTING_KEY || "");
                this.renderClassificationSettings();
                this.setClassificationSettingsMessage(getPageMessage(
                    "classificationSettingsLoaded",
                    "{count} classification setting(s) loaded.",
                    { count: this.classificationSettings.length }
                ));
            } catch (error) {
                this.classificationSettings = [];
                this.selectedClassificationKey = "";
                this.renderClassificationSettings();
                this.setClassificationSettingsMessage(
                    `${getPageMessage("classificationSettingsLoadFailed", "Classification settings could not be loaded.")} ${error.message || ""}`.trim(),
                    "error"
                );
            }
        },

        mergeClassificationSettings(defaults, overrides) {
            const rows = new Map();
            (Array.isArray(defaults) ? defaults : []).forEach((item) => {
                const key = this.normalizePresetKey(item?.SETTING_KEY);
                if (!key) return;
                rows.set(key, {
                    CATEGORY_CODE: CLASSIFICATION_CATEGORY,
                    SETTING_KEY: key,
                    SETTING_VALUE: String(item?.SETTING_VALUE ?? ""),
                    SETTING_DESC: String(item?.SETTING_DESC ?? ""),
                    SORT_ORDER: Number(item?.SORT_ORDER || 0),
                    USE_YN: "Y",
                    DEFAULT_VALUE: String(item?.SETTING_VALUE ?? ""),
                    IS_OVERRIDE: false
                });
            });
            (Array.isArray(overrides) ? overrides : []).forEach((item) => {
                const key = this.normalizePresetKey(item?.SETTING_KEY);
                if (!key) return;
                const base = rows.get(key) || {
                    CATEGORY_CODE: CLASSIFICATION_CATEGORY,
                    SETTING_KEY: key,
                    DEFAULT_VALUE: ""
                };
                rows.set(key, {
                    ...base,
                    SETTING_VALUE: String(item?.SETTING_VALUE ?? ""),
                    SETTING_DESC: String(item?.SETTING_DESC ?? base.SETTING_DESC ?? ""),
                    SORT_ORDER: Number(item?.SORT_ORDER ?? base.SORT_ORDER ?? 0),
                    USE_YN: String(item?.USE_YN || "Y").toUpperCase() === "N" ? "N" : "Y",
                    IS_OVERRIDE: true
                });
            });
            return Array.from(rows.values()).sort((left, right) => {
                const sortDiff = Number(left.SORT_ORDER || 0) - Number(right.SORT_ORDER || 0);
                return sortDiff || left.SETTING_KEY.localeCompare(right.SETTING_KEY);
            });
        },

        renderClassificationSettings() {
            const list = getContainerEl("#classificationSettingsList-M90001");
            if (list) {
                list.innerHTML = this.classificationSettings.length
                    ? this.classificationSettings.map((item) => {
                        const selected = item.SETTING_KEY === this.selectedClassificationKey ? " is-selected" : "";
                        const source = item.IS_OVERRIDE
                            ? getPageMessage("targetDbOverride", "Target DB override")
                            : getPageMessage("modelDefault", "Model default");
                        return `
                            <button type="button" class="env-classification-setting-row${selected}" onclick="M90001.selectClassificationSetting('${this.escapeAttr(item.SETTING_KEY)}')">
                                <strong>${this.escapeHtml(item.SETTING_KEY)}</strong>
                                <span>${this.escapeHtml(item.SETTING_VALUE)}</span>
                                <small>${this.escapeHtml(source)}</small>
                            </button>
                        `;
                    }).join("")
                    : `<div class="project-empty">${this.escapeHtml(getPageMessage("noClassificationSettings", "No classification settings found."))}</div>`;
            }
            this.renderClassificationSettingDetail();
        },

        selectClassificationSetting(settingKey) {
            this.selectedClassificationKey = this.normalizePresetKey(settingKey);
            this.renderClassificationSettings();
        },

        getSelectedClassificationSetting() {
            return this.classificationSettings.find((item) => item.SETTING_KEY === this.selectedClassificationKey) || null;
        },

        renderClassificationSettingDetail() {
            const item = this.getSelectedClassificationSetting();
            this.setFieldValue("#classificationSettingKey-M90001", item?.SETTING_KEY || "");
            this.setFieldValue("#classificationSettingValue-M90001", item?.SETTING_VALUE || "");
            this.setFieldValue("#classificationSettingDesc-M90001", item?.SETTING_DESC || "");
            this.setFieldValue("#classificationSettingSort-M90001", item?.SORT_ORDER ?? 0);
            this.setFieldValue("#classificationSettingUseYn-M90001", item?.USE_YN || "Y");
            this.setFieldValue(
                "#classificationSettingSource-M90001",
                item?.IS_OVERRIDE
                    ? getPageMessage("targetDbOverride", "Target DB override")
                    : getPageMessage("modelDefault", "Model default")
            );
            const keyField = getContainerEl("#classificationSettingKey-M90001");
            if (keyField) keyField.readOnly = Boolean(item);
            const deleteButton = getContainerEl("#deleteClassificationSettingBtn-M90001");
            if (deleteButton) deleteButton.disabled = !item?.IS_OVERRIDE;
        },

        newClassificationSetting() {
            this.selectedClassificationKey = "";
            this.renderClassificationSettings();
            const keyField = getContainerEl("#classificationSettingKey-M90001");
            if (keyField) keyField.readOnly = false;
            this.setFieldValue("#classificationSettingSource-M90001", getPageMessage("newOverride", "New override"));
        },

        resetClassificationSetting() {
            if (this.selectedClassificationKey) {
                this.renderClassificationSettingDetail();
            } else {
                this.newClassificationSetting();
            }
        },

        readClassificationSettingPayload() {
            return {
                categoryCode: CLASSIFICATION_CATEGORY,
                settingKey: this.normalizePresetKey(getContainerEl("#classificationSettingKey-M90001")?.value),
                settingValue: getContainerEl("#classificationSettingValue-M90001")?.value || "",
                settingDesc: getContainerEl("#classificationSettingDesc-M90001")?.value || "",
                sortOrder: Number(getContainerEl("#classificationSettingSort-M90001")?.value || 0),
                useYn: String(getContainerEl("#classificationSettingUseYn-M90001")?.value || "Y").toUpperCase() === "N" ? "N" : "Y"
            };
        },

        async saveClassificationSetting() {
            const payload = this.readClassificationSettingPayload();
            if (!payload.settingKey) {
                this.setClassificationSettingsMessage(getPageMessage("classificationKeyRequired", "Setting key is required."), "error");
                return;
            }
            try {
                await CommonUtils.request(`${API_BASE_URL}/${CLASSIFICATION_API_CODE}/setting/save`, {
                    method: "POST",
                    body: payload
                });
                this.selectedClassificationKey = payload.settingKey;
                await this.loadClassificationSettings(payload.settingKey);
                this.setClassificationSettingsMessage(getPageMessage("classificationOverrideSaved", "Target DB override saved."));
            } catch (error) {
                this.setClassificationSettingsMessage(error.message || getPageMessage("classificationOverrideSaveFailed", "Override save failed."), "error");
            }
        },

        async deleteClassificationSetting() {
            const item = this.getSelectedClassificationSetting();
            if (!item?.IS_OVERRIDE) return;
            const confirmed = await CommonMessage.confirm(getPageMessage(
                "confirmDeleteClassificationOverride",
                'Delete the Target DB override "{settingKey}"? The model default will apply afterward.',
                { settingKey: item.SETTING_KEY }
            ));
            if (!confirmed) return;
            try {
                await CommonUtils.request(`${API_BASE_URL}/${CLASSIFICATION_API_CODE}/setting/delete`, {
                    method: "POST",
                    body: {
                        categoryCode: CLASSIFICATION_CATEGORY,
                        settingKey: item.SETTING_KEY
                    }
                });
                await this.loadClassificationSettings(item.SETTING_KEY);
                this.setClassificationSettingsMessage(getPageMessage("classificationOverrideDeleted", "Override deleted. The model default now applies."));
            } catch (error) {
                this.setClassificationSettingsMessage(error.message || getPageMessage("classificationOverrideDeleteFailed", "Override delete failed."), "error");
            }
        },

        async applyClassificationDefaults() {
            const confirmed = await CommonMessage.confirm(getPageMessage(
                "confirmApplyClassificationDefaults",
                "Apply all preset values as Target DB overrides? Existing override values may be overwritten."
            ), { defaultAction: "cancel" });
            if (!confirmed) return;
            try {
                const response = await fetch(`${CLASSIFICATION_PRESET_URL}?v=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const preset = await response.json();
                const categories = Array.isArray(preset?.targetSettingCategories) ? preset.targetSettingCategories : [];
                const json = await CommonUtils.request(`${API_BASE_URL}/${CLASSIFICATION_API_CODE}/setting/defaults`, {
                    method: "POST",
                    body: { categories }
                });
                await this.loadClassificationSettings();
                this.setClassificationSettingsMessage(getPageMessage(
                    "classificationDefaultsApplied",
                    "Preset overrides applied. {created} created and {updated} updated.",
                    {
                        created: Number(json.createdCount || 0),
                        updated: Number(json.updatedCount || 0)
                    }
                ));
            } catch (error) {
                this.setClassificationSettingsMessage(error.message || getPageMessage("classificationDefaultsApplyFailed", "Preset override apply failed."), "error");
            }
        },

        setClassificationSettingsMessage(message, type = "info") {
            const element = getContainerEl("#classificationSettingsMessage-M90001");
            if (!element) return;
            element.textContent = message || "";
            element.className = type === "error" ? "table-error" : "env-detail-hint";
        },

        async resetVariables() {
            this.rows = this.originalRows.map((row) => ({ ...row }));
            this.selectedRowIndex = this.rows.length > 0 ? 0 : null;
            try {
                const preset = await this.findDetailPresetForSelectedObject();
                if (preset) {
                    this.applyPresetRows(preset);
                    this.applyPresetMetadata(preset);
                    this.detailSource = "Preset reset";
                }
            } catch (error) {
                console.warn("[M90001] detail preset reset failed", error);
            }
            this.renderRows();
            this.renderObjectMeta();
        },

        selectDetailRow(index) {
            if (index < 0 || index >= this.rows.length) return;
            this.selectedRowIndex = index;
            this.renderRows();
        },

        moveSelectedRow(direction) {
            if (this.selectedRowIndex === null) return;
            const targetIndex = this.selectedRowIndex + direction;
            if (targetIndex < 0 || targetIndex >= this.rows.length) return;

            const current = this.rows[this.selectedRowIndex];
            this.rows.splice(this.selectedRowIndex, 1);
            this.rows.splice(targetIndex, 0, current);
            this.selectedRowIndex = targetIndex;
            this.renderRows();
        },

        async saveVariables() {
            if (!this.selectedObject) {
                alert("Select a table or procedure before saving.");
                return;
            }

            const payload = {
                object: this.selectedObject,
                metadata: this.objectMeta || this.createDefaultObjectMeta(this.selectedObject),
                items: this.rows
                    .map((row) => ({
                        key: row.key.trim(),
                        value: row.value,
                        desc: row.desc,
                        defaultValue: row.defaultValue,
                        order: row.order
                    }))
                    .filter((row) => row.key || row.value || row.desc || row.defaultValue)
            };

            try {
                const result = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-detail/save`, {
                    method: "POST",
                    body: payload
                });

                console.log("[M90001] Object metadata saved", result);
                alert(`${payload.items.length} items saved.`);
                this.originalRows = this.rows.map((row) => ({ ...row }));
                this.objectMeta = this.normalizeObjectMeta(result?.data?.metadata, this.selectedObject);
                this.detailSource = "Saved data";
                this.markSelectedObjectRegistered();
                this.renderObjectMeta();
            } catch (error) {
                console.error("[M90001] save failed", error);
                alert("Save failed. Check the console for details.");
            }
        },

        async deleteObjectRegistration() {
            if (!this.selectedObject) {
                alert("Select a registered object before deleting.");
                return;
            }

            const meta = this.objectMeta || {};
            const objectLabel = meta.objectLabel || this.selectedObject.OBJECT_LABEL || this.selectedObject.OBJECT_NAME || "selected object";
            const objectId = meta.objectId || meta.OBJECT_ID || "";

            if (!objectId && this.selectedObject.IS_REGISTERED !== "Y") {
                alert("This object is not registered.");
                return;
            }

            const hasSavedDetails = this.detailSource === "Saved data";
            const detailCount = hasSavedDetails
                ? this.rows.filter((row) => (row.key || row.value)).length
                : 0;
            const confirmMessage = detailCount > 0
                ? `Delete "${objectLabel}" object master and ${detailCount} related detail row(s)?`
                : `Delete "${objectLabel}" object master registration?`;

            if (!(await CommonMessage.confirm(confirmMessage))) {
                alert("Delete canceled.");
                return;
            }

            const payload = {
                object: this.selectedObject,
                metadata: this.objectMeta || this.createDefaultObjectMeta(this.selectedObject),
                includeDetails: true
            };

            try {
                const result = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/object-detail/delete`, {
                    method: "POST",
                    body: payload
                });

                const deletedDetailCount = Number(result?.data?.deletedDetailCount || 0);
                const deletedObjectCount = Number(result?.data?.deletedObjectCount || 0);
                const detachedReferenceCount = Number(result?.data?.detachedReferenceCount || 0);
                const referenceMessage = detachedReferenceCount > 0
                    ? ` ${detachedReferenceCount} data work job reference(s) detached.`
                    : "";
                alert(`${deletedObjectCount} object and ${deletedDetailCount} detail rows deleted.${referenceMessage}`);

                this.markSelectedObjectUnregistered();
                await this.loadObjectTree();
                this.clearObjectSelection();
                this.updateDescription("Saved object registration was deleted. Dictionary defaults are shown.");
            } catch (error) {
                console.error("[M90001] delete failed", error);
                alert("Delete failed. Check the console for details.");
            }
        },

        getTreeIcon(type) {
            if (type === "OWNER") return "fas fa-database";
            if (type === "GROUP") return "fas fa-folder";
            if (type === "TABLE") return "fas fa-table";
            if (type === "LOADING") return "fas fa-circle-notch fa-spin";
            if (type === "PROCEDURE") return "fas fa-code";
            if (type === "FUNCTION") return "fas fa-code";
            if (type === "PACKAGE") return "fas fa-folder";
            if (type === "PACKAGE_PROCEDURE") return "fas fa-code-branch";
            if (type === "PACKAGE_FUNCTION") return "fas fa-code";
            if (type === "MINING_MODEL") return "fas fa-brain";
            return "far fa-file";
        },

        getRegisteredIcon(row) {
            if (!row || row.IS_REGISTERED !== "Y") return "";
            return '<i class="fas fa-circle-check env-registered-icon" title="Registered object"></i>';
        },

        getObjectStatusIcon(row) {
            const status = String(row?.OBJECT_STATUS ?? row?.objectStatus ?? row?.object_status ?? row?.STATUS ?? "").toUpperCase();
            if (status !== "INVALID") return "";
            return '<i class="fas fa-exclamation-triangle env-invalid-icon" title="Invalid object"></i>';
        },

        markSelectedObjectRegistered() {
            const nodeId = this.getNodeId(this.selectedObject);
            if (!nodeId) return;
            this.selectedObject.IS_REGISTERED = "Y";
            const target = this.objectRows.find((row) => this.getNodeId(row) === nodeId);
            if (target) target.IS_REGISTERED = "Y";
            this.refreshTreeRows();
        },

        markSelectedObjectUnregistered() {
            const nodeId = this.getNodeId(this.selectedObject);
            if (!nodeId) return;
            this.selectedObject.IS_REGISTERED = "N";
            const target = this.objectRows.find((row) => this.getNodeId(row) === nodeId);
            if (target) target.IS_REGISTERED = "N";
            this.refreshTreeRows();
        },

        clearObjectSelection() {
            this.selectedObject = null;
            this.objectMeta = null;
            this.detailSource = "";
            this.rows = [];
            this.originalRows = [];
            this.selectedRowIndex = null;
            this.selectedTreeNodeId = null;
            this.renderObjectMeta();
            this.renderDetailSource();
            this.renderRows();
            this.updateClassificationSettingsButton();
            this.closeClassificationSettings();
        },

        getExpandIcon(row) {
            if (!this.isExpandable(row)) {
                return '<span class="env-tree-spacer"></span>';
            }

            const nodeId = this.getNodeId(row);
            const type = this.getObjectType(row);
            const isLoading = (type === "GROUP" && this.loadingGroupNodes.has(nodeId))
                || (type === "PACKAGE" && this.loadingPackageNodes.has(nodeId));
            const isUnloaded = (type === "GROUP" && !this.loadedGroupNodes.has(nodeId))
                || (type === "PACKAGE" && !this.loadedPackageNodes.has(nodeId));
            const isClosed = this.collapsedNodes.has(nodeId) || (isUnloaded && !isLoading);
            const icon = isClosed ? "fa-chevron-right" : "fa-chevron-down";
            return `<i class="fas ${icon} env-tree-toggle"></i>`;
        },

        getNodeId(row) {
            return String(row?.NODE_ID ?? row?.nodeId ?? "").trim();
        },

        getParentId(row) {
            return String(row?.PARENT_ID ?? row?.parentId ?? "").trim();
        },

        getObjectType(row) {
            return String(row?.OBJECT_TYPE ?? row?.objectType ?? "").trim().toUpperCase();
        }
    };

    window[PAGE_CODE] = M90001;
})();
