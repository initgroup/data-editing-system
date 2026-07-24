(function() {
    const PAGE_CODE = "M90002";
    const PRESET_URL = "./config/M90002.python-api-presets.json";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const PYTHON_API_BASE_GROUP_NAME = "Python API Base JSON";
    const PYTHON_API_BASE_GROUP_ALIASES = new Set([
        PYTHON_API_BASE_GROUP_NAME.toUpperCase(),
        "PYTHON API \uAE30\uBCF8 JSON"
    ]);

    function getPageMessage(key, fallback = "", values = {}) {
        const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
        const messages = pack.messages || {};
        let text = typeof messages[key] === "string" ? messages[key] : fallback;
        Object.entries(values || {}).forEach(([name, value]) => {
            text = text.replaceAll(`{${name}}`, String(value ?? ""));
        });
        return text;
    }

    function getPageLabel(key, fallback = "", values = {}) {
        const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
        const labels = pack.labels || {};
        const messages = pack.messages || {};
        let text = typeof labels[key] === "string"
            ? labels[key]
            : (typeof messages[key] === "string" ? messages[key] : fallback);
        Object.entries(values || {}).forEach(([name, value]) => {
            text = text.replaceAll(`{${name}}`, String(value ?? ""));
        });
        return text;
    }

    const RESERVED_VARIABLES = [
        ":INIT$TargetOwner",
        ":INIT$TargetTable",
        ":INIT$RunSourceType",
        ":INIT$RunId",
        ":INIT$ResultModelName"
    ];

    const M90002 = {
        isInit: false,
        isSaving: false,
        savedObjects: [],
        presets: { groups: [] },
        apiObject: null,
        rows: [],
        originalRows: [],
        selectedRowIndex: null,
        selectedNodeKey: "",
        selectedSource: "",
        collapsedGroups: new Set(),

        async init() {
            if (this.isInit) return;
            this.clearSelection();
            await Promise.all([
                this.loadPresets(),
                this.loadApiObjects()
            ]);
            this.isInit = true;
        },

        destroy() {
            this.isInit = false;
            this.isSaving = false;
            this.savedObjects = [];
            this.presets = { groups: [] };
            this.apiObject = null;
            this.rows = [];
            this.originalRows = [];
            this.selectedRowIndex = null;
            this.selectedNodeKey = "";
            this.selectedSource = "";
            this.collapsedGroups = new Set();
        },

        async loadPresets() {
            try {
                const response = await fetch(`${PRESET_URL}?v=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) throw new Error(`Preset load failed. HTTP ${response.status}`);
                const json = await response.json();
                this.presets = this.normalizePresetFile(json);
            } catch (error) {
                console.warn("[M90002] API preset file was ignored.", error);
                this.presets = { groups: [] };
            }
            this.renderObjectTree();
            return this.presets;
        },

        async loadApiObjects() {
            const tree = getContainerEl("#apiObjectTree-M90002");
            if (tree) tree.innerHTML = `<div class="table-empty">${this.escapeHtml(getPageLabel("loadingApiObjects", "Loading API objects..."))}</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/api-objects`, {
                    method: "GET",
                    showLoading: false
                });
                this.savedObjects = Array.isArray(json.data) ? json.data.map((row) => this.normalizeApiObject(row)) : [];
                this.renderObjectTree();
            } catch (error) {
                if (tree) tree.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || getPageLabel("apiObjectLoadFailed", "API object load failed."))}</div>`;
            }
        },

        async createDefaultApiObjects() {
            const presets = await this.loadPresets();
            const defaultApis = [];
            const savedByName = new Map(
                this.savedObjects.map((item) => [this.normalizeKey(item.objectName), item])
            );
            (presets.groups || []).forEach((group) => {
                (group.resources || []).forEach((resource) => {
                    const apiObject = this.createApiObjectFromPreset(resource, group.groupName);
                    if (apiObject.objectType === "INTERNAL_API") {
                        const savedObject = savedByName.get(this.normalizeKey(apiObject.objectName));
                        if (savedObject?.objectId) {
                            apiObject.objectId = savedObject.objectId;
                        }
                        defaultApis.push({ groupName: group.groupName, resource, apiObject });
                    }
                });
            });
            if (!defaultApis.length) {
                alert(getPageLabel("noDefaultPythonApis", "No default Python API objects were found."));
                return;
            }
            const message = getPageLabel("confirmCreateDefaultApis", "Create or update {count} default Python API object(s)?", { count: defaultApis.length });
            if (!(await CommonMessage.confirm(message, { defaultAction: "cancel" }))) return;

            const button = getContainerEl("#createDefaultApisBtn-M90002");
            const originalHtml = button?.innerHTML || "";
            if (button) {
                button.disabled = true;
                button.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i>`;
            }
            let savedCount = 0;
            let lastObjectId = "";
            try {
                for (const item of defaultApis) {
                    const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/api-object/save`, {
                        method: "POST",
                        showLoading: false,
                        body: {
                            apiObject: item.apiObject,
                            details: this.createRowsFromPreset(item.resource)
                        }
                    });
                    savedCount += 1;
                    lastObjectId = json.objectId || lastObjectId;
                }
                await this.loadApiObjects();
                if (lastObjectId) await this.loadApiObject(lastObjectId);
                alert(getPageLabel("defaultPythonApisSaved", "{count} default Python API object(s) saved.", { count: savedCount }));
            } catch (error) {
                alert(error.message || getPageLabel("defaultPythonApiSetupFailed", "Default Python API setup failed."));
            } finally {
                if (button) {
                    button.disabled = false;
                    button.innerHTML = originalHtml || `<i class="fas fa-wand-magic-sparkles"></i>`;
                }
            }
        },

        renderObjectTree() {
            const tree = getContainerEl("#apiObjectTree-M90002");
            if (!tree) return;
            const rows = this.createTreeRows();
            if (!rows.length) {
                tree.innerHTML = `<div class="table-empty">${this.escapeHtml(getPageLabel("noApiObjects", "No API objects."))}</div>`;
                return;
            }

            tree.innerHTML = `
                <div class="env-tree-head">
                    <div>${this.escapeHtml(getPageLabel("apiObject", "API Object"))}</div>
                    <div>${this.escapeHtml(getPageLabel("type", "Type"))}</div>
                </div>
                <div class="api-tree-body">
                    ${rows.map((row) => row.kind === "GROUP"
                        ? this.createGroupRowTemplate(row)
                        : this.createApiRowTemplate(row)
                    ).join("")}
                </div>
            `;
        },

        createTreeRows() {
            const rows = [];
            const keyword = (getContainerEl("#apiSearch-M90002")?.value || "").trim().toLowerCase();
            const categoryFilter = this.getCategoryFilter();
            const registeredOnly = Boolean(getContainerEl("#registeredOnly-M90002")?.checked);
            const savedByName = new Map(this.savedObjects.map((item) => [this.normalizeKey(item.objectName), item]));
            const presetNames = new Set();

            (this.presets.groups || []).forEach((group) => {
                const children = [];
                (group.resources || []).forEach((preset) => {
                    const presetObject = this.createApiObjectFromPreset(preset, group.groupName);
                    const key = this.normalizeKey(presetObject.objectName);
                    const saved = savedByName.get(key);
                    const item = saved || presetObject;
                    presetNames.add(key);
                    if (registeredOnly && !saved) return;
                    if (!this.isCategoryMatch(item, categoryFilter)) return;
                    if (!this.isKeywordMatch(item, keyword)) return;
                    children.push({
                        kind: "API",
                        source: saved ? "SAVED" : "PRESET",
                        key: saved ? String(saved.objectId) : presetObject.objectName,
                        object: item,
                        isRegistered: Boolean(saved),
                        groupName: group.groupName
                    });
                });
                if (children.length) {
                    const groupKey = this.createGroupKey(group.groupName);
                    rows.push({ kind: "GROUP", key: groupKey, label: this.getApiGroupDisplayName(group.groupName), count: children.length });
                    if (!this.collapsedGroups.has(groupKey)) rows.push(...children);
                }
            });

            const additional = this.savedObjects.filter((item) => !presetNames.has(this.normalizeKey(item.objectName)));
            const grouped = new Map();
            additional.forEach((item) => {
                if (!this.isCategoryMatch(item, categoryFilter)) return;
                if (!this.isKeywordMatch(item, keyword)) return;
                const groupName = item.apiGroup || (item.objectType === "EXTERNAL_API" ? "Additional APIs" : "Registered APIs");
                if (!grouped.has(groupName)) grouped.set(groupName, []);
                grouped.get(groupName).push(item);
            });
            grouped.forEach((items, groupName) => {
                const groupKey = this.createGroupKey(groupName);
                rows.push({ kind: "GROUP", key: groupKey, label: this.getApiGroupDisplayName(groupName), count: items.length });
                if (this.collapsedGroups.has(groupKey)) return;
                items
                    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.objectName).localeCompare(String(b.objectName)))
                    .forEach((item) => {
                        rows.push({
                            kind: "API",
                            source: "SAVED",
                            key: String(item.objectId),
                            object: item,
                            isRegistered: true,
                            groupName
                        });
                    });
            });

            return rows;
        },

        createGroupRowTemplate(row) {
            const collapsed = this.collapsedGroups.has(row.key);
            const icon = collapsed ? "fas fa-folder" : "fas fa-folder-open";
            return `
                <button type="button" class="env-tree-row api-group-row" onclick="M90002.toggleGroup('${this.escapeJs(row.key)}')">
                    <span class="env-tree-node level-1">
                        <i class="${icon}"></i>
                        <span class="env-tree-label">${this.escapeHtml(row.label)}</span>
                        <span class="env-tree-count">${this.escapeHtml(row.count)}</span>
                    </span>
                    <span class="env-tree-muted">${this.escapeHtml(getPageLabel("groupType", "GROUP"))}</span>
                </button>
            `;
        },

        createApiRowTemplate(row) {
            const item = row.object || {};
            const nodeKey = `${row.source}:${row.key}`;
            const selected = nodeKey === this.selectedNodeKey ? "is-selected" : "";
            const endpoint = item.endpoint || "";
            const icon = item.objectType === "EXTERNAL_API" ? "fas fa-cloud" : "fas fa-code";
            return `
                <button type="button" class="env-tree-row ${selected}" data-node-key="${this.escapeHtml(nodeKey)}" onclick="M90002.handleTreeObjectClick('${this.escapeJs(row.source)}', '${this.escapeJs(row.key)}')">
                    <span class="env-tree-node level-2">
                        <span class="env-tree-spacer"></span>
                        <i class="${icon}"></i>
                        ${row.isRegistered ? `<i class="fas fa-check-circle api-registered-icon" title="${this.escapeHtml(getPageLabel("registeredOnly", "Registered"))}"></i>` : ""}
                        <span class="env-tree-label" title="${this.escapeHtml(item.label || item.objectName)}">${this.escapeHtml(item.label || item.objectName)}</span>
                    </span>
                    <span class="env-tree-muted" title="${this.escapeHtml(endpoint)}">${this.escapeHtml(item.objectType || "API")}</span>
                </button>
            `;
        },

        async handleTreeObjectClick(source, key) {
            if (source === "SAVED") {
                await this.loadApiObject(key);
                return;
            }
            this.selectPreset(key);
        },

        async loadApiObject(objectId) {
            if (!objectId) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/api-object/${encodeURIComponent(objectId)}`, {
                    method: "GET"
                });
                const data = json.data || {};
                const apiObject = this.normalizeApiObject(data.apiObject || {});
                const rows = this.normalizeRows(data.details || []);
                this.applyApiState(apiObject, rows, getPageLabel("savedData", "Saved data"), `SAVED:${apiObject.objectId || objectId}`);
            } catch (error) {
                alert(error.message || getPageLabel("apiObjectLoadFailed", "API object load failed."));
            }
        },

        selectPreset(objectName) {
            const preset = this.findPresetByName(objectName);
            if (!preset) return;
            const apiObject = this.createApiObjectFromPreset(preset.resource, preset.groupName);
            const rows = this.createRowsFromPreset(preset.resource);
            this.applyApiState(apiObject, rows, getPageMessage("pythonApiBaseGroupName", "Python API base JSON"), `PRESET:${apiObject.objectName}`);
        },

        newApiObject(renderTree = true) {
            const apiObject = {
                objectId: "",
                objectType: "EXTERNAL_API",
                objectName: "",
                label: "",
                apiGroup: "Additional APIs",
                endpoint: "https://api.example.com/resource",
                httpMethod: "GET",
                authType: "API_KEY",
                authKeyName: "OPEN_API_KEY",
                timeoutSec: 300,
                resultCreateYn: "T",
                resultOwner: ":INIT$TargetOwner",
                resultName: "INIT$_TB_API_RESULT",
                useYn: "Y",
                sortOrder: 100,
                description: ""
            };
            const rows = [
                { key: "AUTH.API_KEY", value: "header.X-API-Key", desc: "API key from runtime or secret reference", defaultValue: ":OPEN_API_KEY", order: 1 },
                { key: "INPUT.query", value: "query.q VARCHAR2", desc: "External API query parameter", defaultValue: "", order: 2 },
                { key: "OUTPUT.responseJson", value: "$", desc: "Raw JSON response stored in the generic API result table", defaultValue: "INIT$_TB_API_RESULT", order: 3 }
            ];
            this.applyApiState(apiObject, rows, getPageLabel("newExternalApi", "New external API"), "NEW:");
            if (renderTree) this.renderObjectTree();
            getContainerEl("#apiObjectName-M90002")?.focus();
        },

        clearSelection() {
            this.applyApiState({
                objectId: "",
                objectType: "INTERNAL_API",
                objectName: "",
                label: "",
                apiGroup: "",
                endpoint: "",
                httpMethod: "POST",
                authType: "NONE",
                authKeyName: "",
                timeoutSec: 300,
                resultCreateYn: "N",
                resultOwner: "",
                resultName: "",
                useYn: "Y",
                sortOrder: 0,
                description: ""
            }, [], getPageLabel("noApiObjectSelected", "No API object selected"), "");
        },

        applyApiState(apiObject, rows, detailSource, nodeKey) {
            this.apiObject = { ...apiObject };
            this.rows = this.normalizeInternalRows(this.apiObject, this.normalizeRows(rows));
            this.originalRows = this.rows.map((row) => ({ ...row }));
            this.selectedRowIndex = this.rows.length ? 0 : null;
            this.selectedSource = detailSource || "";
            this.selectedNodeKey = nodeKey || "";
            this.renderApiMeta();
            this.renderRows();
            this.renderContractPreview();
            this.updateDescription(apiObject.objectName
                ? getPageLabel("apiDefinitionDescription", "{objectName} {objectType} definition", {
                    objectName: apiObject.objectName,
                    objectType: apiObject.objectType || "API"
                })
                : getPageLabel("apiRegistryDescription", "Select an API object from the group tree. Input, auth, and output rules will appear here."));
            this.updatePresetButton();
            this.renderObjectTree();
        },

        renderApiMeta() {
            const meta = this.apiObject || {};
            this.setValue("#apiObjectId-M90002", meta.objectId || "");
            this.setValue("#apiObjectType-M90002", meta.objectType || "INTERNAL_API");
            this.setValue("#apiObjectName-M90002", meta.objectName || "");
            this.setValue("#apiLabel-M90002", meta.label || "");
            this.setValue("#apiUseYn-M90002", meta.useYn || "Y");
            this.setValue("#apiSortOrder-M90002", meta.sortOrder ?? 0);
            this.setValue("#apiDescriptionText-M90002", meta.description || "");
            this.setValue("#apiHttpMethod-M90002", meta.httpMethod || "POST");
            this.setValue("#apiEndpoint-M90002", meta.endpoint || "");
            this.setValue("#apiTimeoutSec-M90002", meta.timeoutSec || 300);
            this.setValue("#apiAuthType-M90002", meta.authType || "NONE");
            this.setValue("#apiAuthKeyName-M90002", meta.authKeyName || "");
            this.setValue("#apiResultCreateYn-M90002", meta.resultCreateYn || "N");
            this.setValue("#apiResultOwner-M90002", meta.resultOwner || "");
            this.setValue("#apiResultName-M90002", meta.resultName || "");
            this.setValue("#apiDetailObjectId-M90002", meta.objectId || "");
            this.setValue("#apiDetailSource-M90002", this.selectedSource || "");
            this.syncResultFields();
            this.syncEditLocks();
        },

        renderRows() {
            const grid = getContainerEl("#apiRows-M90002");
            if (!grid) return;
            if (!this.rows.length) {
                grid.innerHTML = `<div class="table-empty">${this.escapeHtml(getPageLabel("noApiDetailRows", "No API detail rows."))}</div>`;
                return;
            }
            grid.innerHTML = `
                <table class="env-detail-table api-detail-table">
                    <thead>
                        <tr>
                            <th class="env-order-head">${this.escapeHtml(getPageLabel("order", "ORDER"))}</th>
                            <th class="env-key-head">${this.escapeHtml(getPageLabel("key", "KEY"))}</th>
                            <th class="env-value-head">${this.escapeHtml(getPageLabel("value", "VALUE"))}</th>
                            <th class="env-desc-head">${this.escapeHtml(getPageLabel("comment", "COMMENT"))}</th>
                            <th class="env-default-head">${this.escapeHtml(getPageLabel("defaultValue", "DEFAULT"))}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.rows.map((row, index) => this.createRowTemplate(row, index)).join("")}
                    </tbody>
                </table>
            `;
        },

        createRowTemplate(row, index) {
            const selected = index === this.selectedRowIndex ? "is-selected" : "";
            const keyValueDisabled = this.isInternalApiSelected() ? "disabled" : "";
            return `
                <tr data-row-index="${index}" class="${selected}" onclick="M90002.selectDetailRow(${index})">
                    <td class="env-order-cell">${index + 1}</td>
                    <td>
                        <input class="env-field env-key-input" type="text" value="${this.escapeHtml(row.key)}" ${keyValueDisabled} onclick="event.stopPropagation()" oninput="M90002.updateRow(${index}, 'key', this.value)">
                    </td>
                    <td>
                        <input class="env-field env-value-input" type="text" value="${this.escapeHtml(row.value)}" ${keyValueDisabled} onclick="event.stopPropagation()" oninput="M90002.updateRow(${index}, 'value', this.value)">
                    </td>
                    <td>
                        <input class="env-field env-desc-input" type="text" value="${this.escapeHtml(row.desc)}" onclick="event.stopPropagation()" oninput="M90002.updateRow(${index}, 'desc', this.value)">
                    </td>
                    <td>
                        <input class="env-field env-default-input" type="text" value="${this.escapeHtml(row.defaultValue)}" onclick="event.stopPropagation()" oninput="M90002.updateRow(${index}, 'defaultValue', this.value)">
                    </td>
                </tr>
            `;
        },

        addDetailRow() {
            if (this.isInternalApiSelected()) return;
            const kind = (getContainerEl("#apiDetailKind-M90002")?.value || "INPUT").toUpperCase();
            const templates = {
                INPUT: { key: "INPUT.PARAM_NAME", value: "body.paramName VARCHAR2", desc: "", defaultValue: "" },
                OUTPUT: { key: "OUTPUT.COLUMN_NAME", value: "$.items[*].columnName", desc: "JSON path to result column", defaultValue: "" },
                AUTH: { key: "AUTH.API_KEY", value: "header.X-API-Key", desc: "Runtime auth key reference", defaultValue: "" }
            };
            this.rows.push({
                ...(templates[kind] || templates.INPUT),
                order: this.rows.length + 1
            });
            this.selectedRowIndex = this.rows.length - 1;
            this.renderRows();
            this.renderContractPreview();
        },

        removeSelectedRow() {
            if (this.isInternalApiSelected()) return;
            if (this.selectedRowIndex === null || !this.rows[this.selectedRowIndex]) return;
            this.rows.splice(this.selectedRowIndex, 1);
            this.selectedRowIndex = this.rows.length ? Math.min(this.selectedRowIndex, this.rows.length - 1) : null;
            this.renderRows();
            this.renderContractPreview();
        },

        selectDetailRow(index) {
            if (!this.rows[index]) return;
            this.selectedRowIndex = index;
            this.renderRows();
        },

        updateRow(index, field, value) {
            if (!this.rows[index]) return;
            if (this.isInternalApiSelected() && (field === "key" || field === "value")) return;
            this.rows[index][field] = value;
            this.renderContractPreview();
        },

        updateApiMeta(field, value) {
            this.apiObject = this.apiObject || {};
            this.apiObject[field] = value;
            if (field === "objectName" && !this.apiObject.label) {
                this.setValue("#apiLabel-M90002", value);
            }
            this.renderContractPreview();
        },

        handleObjectTypeChange(value) {
            if (this.isObjectTypeLocked()) {
                this.setValue("#apiObjectType-M90002", this.apiObject?.objectType || "EXTERNAL_API");
                return;
            }
            this.updateApiMeta("objectType", value);
            const objectType = String(value || "").toUpperCase();
            if (objectType === "EXTERNAL_API") {
                this.apiObject.apiGroup = this.apiObject.apiGroup || "Additional APIs";
                this.apiObject.httpMethod = this.apiObject.httpMethod || "GET";
                this.apiObject.authType = this.apiObject.authType === "NONE" ? "API_KEY" : (this.apiObject.authType || "API_KEY");
                this.apiObject.resultCreateYn = "T";
                this.apiObject.resultOwner = this.apiObject.resultOwner || ":INIT$TargetOwner";
                this.apiObject.resultName = "INIT$_TB_API_RESULT";
                this.ensureExternalOutputRow();
            } else {
                this.apiObject.apiGroup = this.apiObject.apiGroup || PYTHON_API_BASE_GROUP_NAME;
                this.apiObject.authType = "NONE";
            }
            this.renderApiMeta();
            this.renderRows();
            this.renderContractPreview();
        },

        ensureExternalOutputRow() {
            const hasGenericOutput = this.rows.some((row) => this.normalizeKey(row.key) === "OUTPUT.RESPONSEJSON");
            if (hasGenericOutput) return;
            this.rows = this.rows.filter((row) => this.getDetailSection(row.key) !== "OUTPUT");
            this.rows.push({
                key: "OUTPUT.responseJson",
                value: "$",
                desc: "Raw JSON response stored in the generic API result table",
                defaultValue: "INIT$_TB_API_RESULT",
                order: this.rows.length + 1
            });
        },

        handleResultCreateChange(value) {
            this.updateApiMeta("resultCreateYn", value);
            this.syncResultFields();
        },

        syncResultFields() {
            const mode = String(getContainerEl("#apiResultCreateYn-M90002")?.value || "N").toUpperCase();
            const objectType = String(getContainerEl("#apiObjectType-M90002")?.value || "").toUpperCase();
            const isExternal = objectType === "EXTERNAL_API";
            const isInternal = objectType === "INTERNAL_API";
            const isFixedResult = isExternal || isInternal;
            const ownerDisabled = mode === "N";
            const nameDisabled = mode === "N" || isFixedResult;
            const title = getContainerEl("#apiResultNameTitle-M90002");
            if (title) {
                title.dataset.labelKey = mode === "M" ? "resultModel" : "resultTable";
                title.textContent = mode === "M"
                    ? getPageLabel("resultModel", "Result Model")
                    : getPageLabel("resultTable", "Result Table");
            }
            const createMode = getContainerEl("#apiResultCreateYn-M90002");
            if (createMode) createMode.disabled = isFixedResult;
            const ownerField = getContainerEl("#apiResultOwner-M90002");
            if (ownerField) ownerField.disabled = ownerDisabled;
            const nameField = getContainerEl("#apiResultName-M90002");
            if (nameField) nameField.disabled = nameDisabled;
        },

        syncEditLocks() {
            const isInternal = this.isInternalApiSelected();
            const lockMap = {
                "#apiObjectType-M90002": true,
                "#apiHttpMethod-M90002": isInternal,
                "#apiEndpoint-M90002": isInternal,
                "#addApiDetailRow-M90002": isInternal,
                "#removeApiDetailRow-M90002": isInternal
            };
            Object.entries(lockMap).forEach(([selector, disabled]) => {
                const element = getContainerEl(selector);
                if (element) element.disabled = Boolean(disabled);
            });
        },

        isInternalApiSelected() {
            const type = this.apiObject?.objectType || getContainerEl("#apiObjectType-M90002")?.value || "";
            return String(type).toUpperCase() === "INTERNAL_API";
        },

        isObjectTypeLocked() {
            return true;
        },

        async resetApiObject() {
            if (this.selectedNodeKey.startsWith("SAVED:")) {
                if (this.findPresetByName(this.apiObject?.objectName || "")) {
                    await this.applySelectedPreset();
                    return;
                }
                await this.loadApiObject(this.selectedNodeKey.replace("SAVED:", ""));
                return;
            }
            if (this.selectedNodeKey.startsWith("PRESET:")) {
                this.selectPreset(this.selectedNodeKey.replace("PRESET:", ""));
                return;
            }
            this.rows = this.originalRows.map((row) => ({ ...row }));
            this.selectedRowIndex = this.rows.length ? 0 : null;
            this.renderApiMeta();
            this.renderRows();
            this.renderContractPreview();
        },

        async applySelectedPreset() {
            const currentName = this.apiObject?.objectName || "";
            const preset = this.findPresetByName(currentName);
            if (!preset) {
                alert(getPageLabel("noPythonApiBaseJson", "No Python API base JSON is registered for this API object."));
                return;
            }
            const objectId = this.apiObject?.objectId || "";
            const savedUseYn = this.apiObject?.useYn || "Y";
            const next = this.createApiObjectFromPreset(preset.resource, preset.groupName);
            next.objectId = objectId;
            next.useYn = savedUseYn;
            this.applyApiState(next, this.createRowsFromPreset(preset.resource), "Python API base JSON", this.selectedNodeKey || `PRESET:${next.objectName}`);
        },

        updatePresetButton() {
            const button = getContainerEl("#apiPresetButton-M90002");
            if (!button) return;
            button.hidden = !this.findPresetByName(this.apiObject?.objectName || "");
        },

        async saveApiObject() {
            if (this.isSaving) return;
            const payload = {
                apiObject: this.collectApiObject(),
                details: this.rows.map((row, index) => ({
                    key: row.key,
                    value: row.value,
                    desc: row.desc,
                    defaultValue: row.defaultValue,
                    order: row.order || index + 1
                }))
            };
            if (!payload.apiObject.objectName) {
                alert(getPageLabel("objectNameRequired", "Object Code is required."));
                getContainerEl("#apiObjectName-M90002")?.focus();
                return;
            }
            if (!payload.apiObject.endpoint) {
                alert(getPageLabel("endpointUrlRequired", "Endpoint URL is required."));
                getContainerEl("#apiEndpoint-M90002")?.focus();
                return;
            }
            try {
                this.setSaving(true);
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/api-object/save`, {
                    method: "POST",
                    body: payload
                });
                alert(json.message || getPageLabel("apiObjectSaved", "API object saved."));
                await this.loadApiObjects();
                if (json.objectId) await this.loadApiObject(json.objectId);
            } catch (error) {
                alert(error.message || getPageLabel("apiObjectSaveFailed", "API object save failed."));
            } finally {
                this.setSaving(false);
            }
        },

        async deleteApiObject() {
            const objectId = this.apiObject?.objectId || "";
            if (!objectId) {
                alert(getPageLabel("apiObjectNotSaved", "This API object is not saved."));
                return;
            }
            const label = this.apiObject?.label || this.apiObject?.objectName || getPageLabel("selectedApiObject", "selected API object");
            if (!confirm(getPageLabel("confirmDeleteApiObject", "Delete \"{label}\" API object registration?", { label }))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/api-object/delete`, {
                    method: "POST",
                    body: { objectId: Number(objectId) }
                });
                alert(json.message || getPageLabel("apiObjectDeleted", "API object deleted."));
                this.clearSelection();
                await this.loadApiObjects();
            } catch (error) {
                alert(error.message || getPageLabel("apiObjectDeleteFailed", "API object delete failed."));
            }
        },

        collectApiObject() {
            return {
                ...(this.apiObject || {}),
                objectId: this.getValue("#apiObjectId-M90002"),
                objectType: this.getValue("#apiObjectType-M90002") || "INTERNAL_API",
                objectName: this.getValue("#apiObjectName-M90002"),
                label: this.getValue("#apiLabel-M90002") || this.getValue("#apiObjectName-M90002"),
                endpoint: this.getValue("#apiEndpoint-M90002"),
                httpMethod: this.getValue("#apiHttpMethod-M90002") || "POST",
                authType: this.getValue("#apiAuthType-M90002") || "NONE",
                authKeyName: this.getValue("#apiAuthKeyName-M90002"),
                apiGroup: this.normalizeApiGroupName((this.apiObject || {}).apiGroup || (this.getValue("#apiObjectType-M90002") === "EXTERNAL_API" ? "Additional APIs" : PYTHON_API_BASE_GROUP_NAME)),
                timeoutSec: this.getValue("#apiTimeoutSec-M90002") || 300,
                resultCreateYn: this.getValue("#apiResultCreateYn-M90002") || "N",
                resultOwner: this.getValue("#apiResultOwner-M90002"),
                resultName: this.getValue("#apiResultName-M90002"),
                useYn: this.getValue("#apiUseYn-M90002") || "Y",
                sortOrder: this.getValue("#apiSortOrder-M90002") || 0,
                description: this.getRawValue("#apiDescriptionText-M90002")
            };
        },

        buildContract() {
            const apiObject = this.collectApiObject();
            const details = this.rows.map((row, index) => ({
                order: index + 1,
                key: row.key || "",
                value: row.value || "",
                comment: row.desc || "",
                defaultValue: row.defaultValue || ""
            }));
            const input = details.filter((row) => this.getDetailSection(row.key) === "INPUT");
            const authRows = details.filter((row) => this.getDetailSection(row.key) === "AUTH");
            const outputRows = details.filter((row) => this.getDetailSection(row.key) === "OUTPUT");
            const resultKey = apiObject.resultCreateYn === "M" ? "resultModelName" : "resultTableName";
            return {
                apiRegistryVersion: 2,
                apiGroup: this.normalizeApiGroupName(apiObject.apiGroup || (apiObject.objectType === "EXTERNAL_API" ? "Additional APIs" : PYTHON_API_BASE_GROUP_NAME)),
                apiType: apiObject.objectType,
                method: apiObject.objectName,
                httpMethod: apiObject.httpMethod,
                endpoint: apiObject.endpoint,
                serviceUrl: apiObject.endpoint,
                timeoutSec: Number(apiObject.timeoutSec || 300),
                auth: {
                    type: apiObject.authType || "NONE",
                    keyName: apiObject.authKeyName || "",
                    rules: authRows
                },
                input,
                output: {
                    resultCreateYn: apiObject.resultCreateYn || "N",
                    resultOwner: apiObject.resultOwner || "",
                    [resultKey]: apiObject.resultName || "",
                    persistMode: apiObject.objectType === "INTERNAL_API" ? "SERVICE_MANAGED" : "GENERIC_JSON",
                    rules: outputRows
                },
                reservedVariables: RESERVED_VARIABLES,
                details
            };
        },

        renderContractPreview() {
            const viewer = getContainerEl("#apiContractViewer-M90002");
            if (!viewer) return;
            try {
                viewer.value = JSON.stringify(this.buildContract(), null, 2);
                const status = getContainerEl("#apiContractStatus-M90002");
                if (status) status.textContent = getPageLabel("apiContractGenerated", "Generated from current screen values.");
            } catch (error) {
                viewer.value = "";
            }
        },

        async copyContract() {
            const viewer = getContainerEl("#apiContractViewer-M90002");
            const text = viewer?.value || "";
            if (!text.trim()) {
                alert(getPageLabel("noApiJsonContractToCopy", "No API JSON contract to copy."));
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
            } catch (error) {
                viewer.focus();
                viewer.select();
                document.execCommand("copy");
            }
            const status = getContainerEl("#apiContractStatus-M90002");
            if (status) status.textContent = getPageLabel("apiJsonContractCopied", "API JSON contract copied.");
        },

        normalizePresetFile(json) {
            if (Array.isArray(json?.groups)) {
                return {
                    ...json,
                    groups: json.groups.map((group) => ({
                        groupName: this.normalizeApiGroupName(group.groupName || group.name || PYTHON_API_BASE_GROUP_NAME),
                        resources: Array.isArray(group.resources) ? group.resources : []
                    }))
                };
            }
            return {
                ...json,
                groups: [{
                    groupName: PYTHON_API_BASE_GROUP_NAME,
                    resources: Array.isArray(json?.resources) ? json.resources : []
                }]
            };
        },

        findPresetByName(objectName) {
            const key = this.normalizeKey(objectName);
            if (!key) return null;
            for (const group of (this.presets.groups || [])) {
                for (const resource of (group.resources || [])) {
                    const candidate = this.createApiObjectFromPreset(resource, group.groupName);
                    if (this.normalizeKey(candidate.objectName) === key) {
                        return { groupName: group.groupName, resource };
                    }
                }
            }
            return null;
        },

        createApiObjectFromPreset(preset, groupName = PYTHON_API_BASE_GROUP_NAME) {
            const output = preset.output || preset.outputContract || preset.outputFormat || {};
            const resultName = output.resultModelName || output.resultTableName || output.resultTable || preset.resultTableName || preset.resultTable || "";
            return {
                objectId: "",
                objectType: preset.objectType || preset.apiType || "INTERNAL_API",
                objectName: preset.objectName || preset.resourceName || preset.execMethod || "",
                label: preset.label || preset.resourceLabel || preset.resourceName || "",
                apiGroup: this.normalizeApiGroupName(preset.apiGroup || groupName),
                endpoint: preset.endpoint || preset.serviceUrl || preset.spec?.endpoint || preset.spec?.serviceUrl || "",
                httpMethod: preset.httpMethod || "POST",
                authType: preset.auth?.type || preset.authType || "NONE",
                authKeyName: preset.auth?.keyName || preset.authKeyName || "",
                timeoutSec: preset.timeoutSec || 300,
                resultCreateYn: output.resultCreateYn || preset.resultCreateYn || (resultName ? "T" : "N"),
                resultOwner: output.resultOwner || preset.resultOwner || "",
                resultName,
                useYn: preset.useYn || "Y",
                sortOrder: preset.sortOrder || 0,
                description: preset.description || ""
            };
        },

        createRowsFromPreset(preset) {
            if (Array.isArray(preset.details)) return this.normalizeRows(preset.details);
            const rows = [];
            (preset.params || []).forEach((param, index) => {
                const name = param.paramName || param.name || param.key || "";
                const dataType = param.dataType || param.type || "VARCHAR2";
                rows.push({
                    key: `INPUT.${name}`,
                    value: `IN ${dataType}`,
                    desc: param.paramDesc || param.comment || "",
                    defaultValue: param.defaultValue || param.default || "",
                    order: param.itemOrder || index + 1
                });
            });
            const output = preset.output || preset.outputContract || {};
            (output.rules || []).forEach((rule, index) => {
                rows.push({
                    key: rule.key || `OUTPUT.${rule.column || rule.name || `COLUMN_${index + 1}`}`,
                    value: rule.value || rule.path || "",
                    desc: rule.comment || rule.desc || "",
                    defaultValue: rule.defaultValue || "",
                    order: rows.length + 1
                });
            });
            return this.normalizeRows(rows);
        },

        normalizeInternalRows(apiObject, rows) {
            const objectType = String(apiObject?.objectType || "").toUpperCase();
            if (objectType !== "INTERNAL_API") return rows;
            return rows.map((row) => {
                const section = this.getDetailSection(row.key);
                if (section !== "INPUT") return row;
                const value = String(row.value || "").trim();
                const normalizedValue = value.replace(/^[A-Za-z_][A-Za-z0-9_]*\s+(IN|OUT|IN\s+OUT)\s+/i, "$1 ");
                return { ...row, value: normalizedValue };
            });
        },

        normalizeApiObject(row) {
            const output = row.output || row.OUTPUT || {};
            return {
                objectId: row.objectId ?? row.OBJECT_ID ?? row.OML_RESOURCE_ID ?? "",
                objectType: row.objectType || row.apiType || row.API_TYPE || row.RESOURCE_TYPE || "INTERNAL_API",
                objectName: row.objectName || row.OBJECT_NAME || row.RESOURCE_NAME || "",
                label: row.label || row.OBJECT_LABEL || row.RESOURCE_LABEL || row.RESOURCE_NAME || "",
                apiGroup: this.normalizeApiGroupName(row.apiGroup || row.API_GROUP || ""),
                endpoint: row.endpoint || row.ENDPOINT || row.serviceUrl || row.SERVICE_URL || "",
                httpMethod: row.httpMethod || row.HTTP_METHOD || "POST",
                authType: row.authType || row.AUTH_TYPE || "NONE",
                authKeyName: row.authKeyName || row.AUTH_KEY_NAME || "",
                timeoutSec: row.timeoutSec ?? row.TIMEOUT_SEC ?? 300,
                resultCreateYn: row.resultCreateYn || row.RESULT_CREATE_YN || output.resultCreateYn || "N",
                resultOwner: row.resultOwner || row.RESULT_OWNER || output.resultOwner || "",
                resultName: row.resultName || row.RESULT_NAME || output.resultTableName || output.resultModelName || "",
                useYn: row.useYn || row.USE_YN || "Y",
                sortOrder: row.sortOrder ?? row.SORT_ORDER ?? 0,
                description: row.description || row.DESCRIPTION || ""
            };
        },

        normalizeRows(rows) {
            return (Array.isArray(rows) ? rows : [])
                .map((row, index) => ({
                    key: row.key || row.KEY || row.paramName || row.PARAM_NAME || "",
                    value: row.value || row.VALUE || row.itemValue || row.ITEM_VALUE || row.dataType || row.DATA_TYPE || "",
                    desc: row.desc || row.comment || row.COMMENT || row.paramDesc || row.PARAM_DESC || "",
                    defaultValue: row.defaultValue || row.DEFAULT_VALUE || row.itemDefault || row.ITEM_DEFAULT || "",
                    order: row.order || row.ORDER || row.itemOrder || row.ITEM_ORDER || index + 1
                }))
                .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
        },

        getDetailSection(key) {
            return String(key || "").split(".")[0].trim().toUpperCase() || "INPUT";
        },

        getCategoryFilter() {
            const all = getContainerEl("#apiCategoryAll-M90002");
            if (!all || all.checked) return "ALL";

            const selected = Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".api-category-M90002:checked") || [])
                .map((input) => input.value)
                .filter(Boolean);
            return selected.length > 0 ? selected.join(",") : "ALL";
        },

        handleCategoryAllChange(checkbox) {
            const categoryInputs = Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".api-category-M90002") || []);
            if (checkbox.checked) {
                categoryInputs.forEach((input) => {
                    input.checked = false;
                });
            } else {
                checkbox.checked = true;
            }
            this.resetTreeViewState();
            this.renderObjectTree();
        },

        handleCategoryChange() {
            const all = getContainerEl("#apiCategoryAll-M90002");
            const selected = Array.from(getContainerEl(".env-category-filter")?.querySelectorAll(".api-category-M90002:checked") || []);
            if (all) {
                all.checked = selected.length === 0;
            }
            this.resetTreeViewState();
            this.renderObjectTree();
        },

        resetTreeViewState() {
            this.collapsedGroups = new Set();
            this.selectedNodeKey = "";
        },

        toggleGroup(groupKey) {
            if (!groupKey) return;
            if (this.collapsedGroups.has(groupKey)) {
                this.collapsedGroups.delete(groupKey);
            } else {
                this.collapsedGroups.add(groupKey);
            }
            this.renderObjectTree();
        },

        expandAllGroups() {
            this.collapsedGroups = new Set();
            this.renderObjectTree();
        },

        collapseAllGroups() {
            const groupKeys = this.getVisibleGroupKeys();
            this.collapsedGroups = new Set(groupKeys);
            this.renderObjectTree();
        },

        getVisibleGroupKeys() {
            const keys = [];
            const keyword = (getContainerEl("#apiSearch-M90002")?.value || "").trim().toLowerCase();
            const categoryFilter = this.getCategoryFilter();
            const registeredOnly = Boolean(getContainerEl("#registeredOnly-M90002")?.checked);
            const savedByName = new Map(this.savedObjects.map((item) => [this.normalizeKey(item.objectName), item]));
            const presetNames = new Set();

            (this.presets.groups || []).forEach((group) => {
                const hasChildren = (group.resources || []).some((preset) => {
                    const presetObject = this.createApiObjectFromPreset(preset, group.groupName);
                    const key = this.normalizeKey(presetObject.objectName);
                    const saved = savedByName.get(key);
                    const item = saved || presetObject;
                    presetNames.add(key);
                    if (registeredOnly && !saved) return false;
                    return this.isCategoryMatch(item, categoryFilter) && this.isKeywordMatch(item, keyword);
                });
                if (hasChildren) keys.push(this.createGroupKey(group.groupName));
            });

            const additionalGroups = new Set();
            this.savedObjects
                .filter((item) => !presetNames.has(this.normalizeKey(item.objectName)))
                .forEach((item) => {
                    if (!this.isCategoryMatch(item, categoryFilter)) return;
                    if (!this.isKeywordMatch(item, keyword)) return;
                    additionalGroups.add(item.apiGroup || (item.objectType === "EXTERNAL_API" ? "Additional APIs" : "Registered APIs"));
                });
            additionalGroups.forEach((groupName) => keys.push(this.createGroupKey(groupName)));
            return keys;
        },

        createGroupKey(groupName) {
            return this.normalizeKey(groupName || "API_GROUP") || "API_GROUP";
        },

        isPythonBaseGroupName(groupName) {
            const text = String(groupName || "").trim();
            return Boolean(text) && PYTHON_API_BASE_GROUP_ALIASES.has(text.toUpperCase());
        },

        normalizeApiGroupName(groupName) {
            return this.isPythonBaseGroupName(groupName) ? PYTHON_API_BASE_GROUP_NAME : String(groupName || "").trim();
        },

        getApiGroupDisplayName(groupName) {
            if (this.isPythonBaseGroupName(groupName)) {
                return getPageMessage("pythonApiBaseGroupName", PYTHON_API_BASE_GROUP_NAME);
            }
            return String(groupName || "").trim();
        },

        isCategoryMatch(item, filter) {
            if (filter === "ALL") return true;
            return filter.includes(String(item.objectType || "").toUpperCase());
        },

        isKeywordMatch(item, keyword) {
            if (!keyword) return true;
            return [
                item.objectName,
                item.label,
                item.endpoint,
                item.objectType,
                item.description
            ].some((value) => String(value || "").toLowerCase().includes(keyword));
        },

        handleSearchKey(event) {
            if (event.key === "Enter") this.renderObjectTree();
        },

        setSaving(value) {
            this.isSaving = Boolean(value);
            const button = getContainerEl("#saveApiObject-M90002");
            if (!button) return;
            button.disabled = this.isSaving;
            const label = button.querySelector("span");
            if (label) label.textContent = this.isSaving
                ? getPageLabel("saving", "Saving...")
                : getPageLabel("save", "Save");
        },

        updateDescription(text) {
            const desc = getContainerEl("#apiDescription-M90002");
            if (desc) desc.textContent = text || "";
        },

        getValue(selector) {
            return getContainerEl(selector)?.value?.trim() || "";
        },

        getRawValue(selector) {
            return getContainerEl(selector)?.value || "";
        },

        setValue(selector, value) {
            const element = getContainerEl(selector);
            if (element) element.value = value ?? "";
        },

        normalizeKey(value) {
            return String(value || "").trim().toUpperCase();
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        },

        escapeJs(value) {
            return String(value ?? "")
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\r?\n/g, "\\n");
        }
    };

    window[PAGE_CODE] = M90002;
})();
