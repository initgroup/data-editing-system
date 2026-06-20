(function() {
    const PAGE_CODE = "M90001";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const M90001 = {
        
        ...COMMON,
        isInit: false,
        selectedObject: null,
        objectMeta: null,
        detailSource: "",
        rows: [],
        originalRows: [],
        selectedRowIndex: null,
        objectRows: [],
        visibleObjectRows: [],
        collapsedNodes: new Set(),
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
                const params = new URLSearchParams({
                    offset: String(reset ? 0 : this.treeNextOffset),
                    limit: String(this.treeFetchLimit),
                    keyword: this.treeSearchMode ? (getContainerEl("#objectSearch-M90001")?.value || "").trim() : "",
                    registeredOnly: this.isRegisteredOnlyTree() ? "Y" : "N",
                    categoryFilter: this.getObjectCategoryFilter(),
                    includePackageMembers: "N"
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
                        <span class="env-tree-label" title="${this.escapeHtml(row.OBJECT_LABEL)}">${this.escapeHtml(treeLabel)}</span>
                        ${childCount !== null ? `<span class="env-tree-count">${childCount}</span>` : ""}
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
            const count = Number(row.CHILD_COUNT ?? row.childCount);
            if (Number.isFinite(count) && this.getObjectType(row) === "GROUP") return count;
            if (this.getObjectType(row) === "PACKAGE" && !this.loadedPackageNodes.has(this.getNodeId(row))) return null;
            const nodeId = this.getNodeId(row);
            return this.objectRows.filter((child) => this.getParentId(child) === nodeId).length;
        },

        async handleTreeRowClick(index) {
            const selected = this.visibleObjectRows[index];
            if (!selected) return;

            this.selectedTreeNodeId = this.getNodeId(selected);

            if (this.getObjectType(selected) === "LOAD_MORE") {
                await this.loadMoreObjects();
                return;
            }

            if (this.getObjectType(selected) === "PACKAGE") {
                await this.handlePackageNodeClick(selected);
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
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/package-members?${params.toString()}`, { method: "GET", showLoading: false });
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
            return Boolean(nodeId) && this.objectRows.some((child) => this.getParentId(child) === nodeId);
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
            this.updateDescription(`Loading ${objectRow.OWNER}.${objectRow.OBJECT_NAME}...`);

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

                const data = Array.isArray(json.data) ? json.data : [];
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
                this.updateDescription("Could not load object detail.");
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
                sortOrder: meta.SORT_ORDER ?? meta.sortOrder ?? base.sortOrder
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
                sortOrder: 0
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
            this.renderDetailSource();
        },

        renderDetailSource() {
            const meta = this.objectMeta || this.createDefaultObjectMeta(this.selectedObject);
            this.setFieldValue("#detailObjectId-M90001", meta.objectId || "");
            this.setFieldValue("#detailSource-M90001", this.detailSource || "");
        },

        updateObjectMeta(field, value) {
            this.objectMeta = this.objectMeta || this.createDefaultObjectMeta(this.selectedObject);
            this.objectMeta[field] = value;
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
                    <td><div class="env-text-cell env-readonly-cell" title="${safeKey}">${safeKey || "&nbsp;"}</div></td>
                    <td><div class="env-text-cell env-readonly-cell" title="${safeValue}">${safeValue || "&nbsp;"}</div></td>
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

        resetVariables() {
            this.rows = this.originalRows.map((row) => ({ ...row }));
            this.selectedRowIndex = this.rows.length > 0 ? 0 : null;
            this.renderRows();
        },

        selectDetailRow(index) {
            if (index < 0 || index >= this.rows.length) return;
            this.selectedRowIndex = index;
            this.renderRows();
            const input = getContainerEl("#envRows-M90001")?.querySelector(`tr[data-row-index="${index}"] .env-desc-input`);
            if (input) input.focus();
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
        },

        getExpandIcon(row) {
            if (!this.isExpandable(row)) {
                return '<span class="env-tree-spacer"></span>';
            }

            const nodeId = this.getNodeId(row);
            const unloadedPackage = this.getObjectType(row) === "PACKAGE" && !this.loadedPackageNodes.has(nodeId);
            const icon = this.collapsedNodes.has(nodeId) || unloadedPackage ? "fa-chevron-right" : "fa-chevron-down";
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

