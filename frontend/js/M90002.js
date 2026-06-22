(function() {
    const PAGE_CODE = "M90002";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const M90002 = {
        resources: [],
        params: [],
        selectedResourceId: "",
        isSaving: false,
        isInit: false,

        async init() {
            if (this.isInit) return;
            this.newResource(false);
            await this.loadResources();
            this.isInit = true;
        },

        destroy() {
            this.resources = [];
            this.params = [];
            this.selectedResourceId = "";
            this.isSaving = false;
            this.isInit = false;
        },

        async loadResources() {
            const container = getContainerEl("#resourceGrid-M90002");
            if (!container) return;
            container.innerHTML = `<div class="table-empty">Loading resources...</div>`;
            try {
                const keyword = getContainerEl("#resourceSearch-M90002")?.value || "";
                const useYn = getContainerEl("#resourceUseFilter-M90002")?.value || "ALL";
                const query = new URLSearchParams({ keyword, useYn });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/resources?${query.toString()}`, { method: "GET" });
                this.resources = Array.isArray(json.data) ? json.data : [];
                this.renderResourceList();
            } catch (error) {
                container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Resource load failed.")}</div>`;
            }
        },

        renderResourceList() {
            const container = getContainerEl("#resourceGrid-M90002");
            if (!container) return;
            if (!this.resources.length) {
                container.innerHTML = `<div class="table-empty">No OML4Py resources.</div>${this.renderListFooter(0)}`;
                return;
            }
            container.innerHTML = this.resources.map((row) => {
                const id = row.OML_RESOURCE_ID || "";
                const selected = String(id) === String(this.selectedResourceId) ? "is-selected" : "";
                const label = row.RESOURCE_LABEL || row.RESOURCE_NAME || "(Untitled)";
                const meta = [row.EXEC_METHOD, row.SCRIPT_NAME].filter(Boolean).join(" / ");
                return `
                    <button type="button" class="env-tree-row ${selected}" onclick="M90002.loadResource('${this.escapeJs(id)}')">
                        <span class="env-tree-main">
                            <strong>${this.escapeHtml(label)}</strong>
                            <small>${this.escapeHtml(meta || "-")}</small>
                        </span>
                        <em>${this.escapeHtml(row.USE_YN || "Y")}</em>
                    </button>
                `;
            }).join("") + this.renderListFooter(this.resources.length);
        },

        async loadResource(resourceId) {
            if (!resourceId) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/resource/${encodeURIComponent(resourceId)}`, { method: "GET" });
                const data = json.data || {};
                this.selectedResourceId = String(resourceId);
                this.params = (data.params || []).map((row, index) => ({
                    paramName: row.PARAM_NAME || "",
                    bindName: row.BIND_NAME || "",
                    dataType: row.DATA_TYPE || "",
                    requiredYn: row.REQUIRED_YN || "N",
                    paramDesc: row.PARAM_DESC || "",
                    defaultValue: row.DEFAULT_VALUE || "",
                    itemOrder: row.ITEM_ORDER || index + 1
                }));
                this.renderResourceForm(data.resource || {});
                this.renderParams();
                this.renderResourceList();
            } catch (error) {
                alert(error.message || "OML4Py resource load failed.");
            }
        },

        newResource(renderList = true) {
            this.selectedResourceId = "";
            this.params = [];
            this.renderResourceForm({
                USE_YN: "Y",
                LANGUAGE: "PYTHON",
                RESOURCE_TYPE: "SCRIPT",
                EXEC_API: "SQL_API",
                EXEC_METHOD: "PYQ_TABLE_EVAL",
                INPUT_MODE: "TABLE",
                TIMEOUT_SEC: 300,
                SORT_ORDER: 0
            });
            this.renderParams();
            if (renderList) this.renderResourceList();
        },

        renderResourceForm(resource) {
            this.setValue("#resourceId-M90002", resource.OML_RESOURCE_ID || "");
            this.setValue("#resourceName-M90002", resource.RESOURCE_NAME || "");
            this.setValue("#resourceLabel-M90002", resource.RESOURCE_LABEL || "");
            this.setValue("#resourceUseYn-M90002", resource.USE_YN || "Y");
            this.setValue("#resourceLanguage-M90002", resource.LANGUAGE || "PYTHON");
            this.setValue("#resourceType-M90002", resource.RESOURCE_TYPE || "SCRIPT");
            this.setValue("#execApi-M90002", resource.EXEC_API || "SQL_API");
            this.setValue("#execMethod-M90002", resource.EXEC_METHOD || "PYQ_TABLE_EVAL");
            this.setValue("#scriptName-M90002", resource.SCRIPT_NAME || "");
            this.setValue("#scriptOwner-M90002", resource.SCRIPT_OWNER || "");
            this.setValue("#inputMode-M90002", resource.INPUT_MODE || "TABLE");
            this.setValue("#timeoutSec-M90002", resource.TIMEOUT_SEC || 300);
            this.setValue("#sortOrder-M90002", resource.SORT_ORDER || 0);
            this.setValue("#description-M90002", resource.DESCRIPTION || "");
            this.setValue("#outputFormat-M90002", resource.OUTPUT_FORMAT || "");
            this.setValue("#specJson-M90002", resource.SPEC_JSON || "");
            this.setValue("#scriptSource-M90002", resource.SCRIPT_SOURCE || "");
        },

        renderParams() {
            const container = getContainerEl("#paramGrid-M90002");
            if (!container) return;
            if (!this.params.length) {
                container.innerHTML = `<div class="table-empty">No parameters.</div>`;
                return;
            }
            container.innerHTML = `
                <table class="table-grid">
                    <thead>
                        <tr>
                            <th>Order</th>
                            <th>Param</th>
                            <th>Bind</th>
                            <th>Type</th>
                            <th>Req</th>
                            <th>Default</th>
                            <th>Comment</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.params.map((row, index) => `
                            <tr>
                                <td><input class="env-field" type="number" value="${this.escapeHtml(row.itemOrder || index + 1)}" oninput="M90002.updateParam(${index}, 'itemOrder', this.value)"></td>
                                <td><input class="env-field" type="text" value="${this.escapeHtml(row.paramName)}" oninput="M90002.updateParam(${index}, 'paramName', this.value)"></td>
                                <td><input class="env-field" type="text" value="${this.escapeHtml(row.bindName)}" oninput="M90002.updateParam(${index}, 'bindName', this.value)"></td>
                                <td><input class="env-field" type="text" value="${this.escapeHtml(row.dataType)}" oninput="M90002.updateParam(${index}, 'dataType', this.value)"></td>
                                <td>
                                    <select class="env-field" onchange="M90002.updateParam(${index}, 'requiredYn', this.value)">
                                        <option value="N" ${row.requiredYn !== "Y" ? "selected" : ""}>N</option>
                                        <option value="Y" ${row.requiredYn === "Y" ? "selected" : ""}>Y</option>
                                    </select>
                                </td>
                                <td><input class="env-field" type="text" value="${this.escapeHtml(row.defaultValue)}" oninput="M90002.updateParam(${index}, 'defaultValue', this.value)"></td>
                                <td><input class="env-field" type="text" value="${this.escapeHtml(row.paramDesc)}" oninput="M90002.updateParam(${index}, 'paramDesc', this.value)"></td>
                                <td>
                                    <button type="button" class="table-icon-btn" title="Remove" onclick="M90002.removeParam(${index})">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        },

        addParam() {
            this.params.push({
                paramName: "",
                bindName: "",
                dataType: "VARCHAR2",
                requiredYn: "N",
                paramDesc: "",
                defaultValue: "",
                itemOrder: this.params.length + 1
            });
            this.renderParams();
        },

        updateParam(index, field, value) {
            if (!this.params[index]) return;
            this.params[index][field] = value;
        },

        removeParam(index) {
            this.params.splice(index, 1);
            this.renderParams();
        },

        collectResource() {
            return {
                resourceId: this.getValue("#resourceId-M90002"),
                resourceName: this.getValue("#resourceName-M90002"),
                resourceLabel: this.getValue("#resourceLabel-M90002"),
                resourceType: this.getValue("#resourceType-M90002"),
                language: this.getValue("#resourceLanguage-M90002"),
                execApi: this.getValue("#execApi-M90002"),
                execMethod: this.getValue("#execMethod-M90002"),
                scriptName: this.getValue("#scriptName-M90002"),
                scriptOwner: this.getValue("#scriptOwner-M90002"),
                inputMode: this.getValue("#inputMode-M90002"),
                outputFormat: this.getValue("#outputFormat-M90002"),
                specJson: this.getValue("#specJson-M90002"),
                scriptSource: this.getRawValue("#scriptSource-M90002"),
                description: this.getValue("#description-M90002"),
                timeoutSec: this.getValue("#timeoutSec-M90002"),
                useYn: this.getValue("#resourceUseYn-M90002"),
                sortOrder: this.getValue("#sortOrder-M90002")
            };
        },

        loadHelloPythonSample() {
            this.selectedResourceId = "";
            this.renderResourceForm({
                USE_YN: "Y",
                LANGUAGE: "PYTHON",
                RESOURCE_TYPE: "SCRIPT",
                RESOURCE_NAME: "OML_HELLO_PYTHON",
                RESOURCE_LABEL: "OML4Py Hello Python",
                EXEC_API: "SQL_API",
                EXEC_METHOD: "PYQ_EVAL",
                SCRIPT_NAME: "OML_HELLO_PYTHON",
                SCRIPT_OWNER: "",
                INPUT_MODE: "NONE",
                TIMEOUT_SEC: 60,
                SORT_ORDER: 10,
                DESCRIPTION: "Basic OML4Py Embedded Python Execution hello sample.",
                OUTPUT_FORMAT: "'JSON'",
                SPEC_JSON: "{\n  \"sample\": true,\n  \"sqlApi\": \"pyqEval\",\n  \"note\": \"Save registers this function in the OML script repository with the same SCRIPT_NAME.\"\n}",
                SCRIPT_SOURCE: `def oml_hello_python(pMessage='Hello OML4Py'):\n    import pandas as pd\n    return pd.DataFrame({\n        'MESSAGE': [pMessage],\n        'RUNTIME': ['OML4Py Embedded Python Execution']\n    })\n`
            });
            this.params = [
                {
                    paramName: "P_MESSAGE",
                    bindName: "pMessage",
                    dataType: "VARCHAR2",
                    requiredYn: "N",
                    paramDesc: "Message returned by the hello sample.",
                    defaultValue: "Hello OML4Py",
                    itemOrder: 1
                }
            ];
            this.renderParams();
            this.renderResourceList();
        },

        async saveResource() {
            if (this.isSaving) return;
            const resource = this.collectResource();
            if (!resource.resourceName || !resource.scriptName) {
                alert("Resource Name and Script Name are required.\n리소스명과 스크립트명은 필수입니다.");
                return;
            }
            try {
                this.setSaving(true);
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/resource/save`, {
                    method: "POST",
                    body: { resource, params: this.params }
                });
                alert(`${json.message || "OML4Py resource saved."}\nOML4Py 리소스가 저장되었습니다.`);
                this.selectedResourceId = String(json.resourceId || "");
                await this.loadResources();
                if (this.selectedResourceId) await this.loadResource(this.selectedResourceId);
            } catch (error) {
                alert(error.message || "OML4Py resource save failed.");
            } finally {
                this.setSaving(false);
            }
        },

        setSaving(isSaving) {
            this.isSaving = Boolean(isSaving);
            const button = getContainerEl("#saveResource-M90002");
            if (!button) return;
            button.disabled = this.isSaving;
            const label = button.querySelector("span");
            if (label) label.textContent = this.isSaving ? "Saving..." : "Save";
        },

        async deleteResource() {
            const resourceId = this.getValue("#resourceId-M90002");
            if (!resourceId) {
                alert("Select a saved resource first.\n저장된 리소스를 먼저 선택하세요.");
                return;
            }
            if (!confirm("Delete selected OML4Py resource?\n선택한 OML4Py 리소스를 삭제할까요?")) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/resource/delete`, {
                    method: "POST",
                    body: { resourceId: Number(resourceId) }
                });
                alert(`${json.message || "OML4Py resource deleted."}\nOML4Py 리소스가 삭제되었습니다.`);
                this.newResource(false);
                await this.loadResources();
            } catch (error) {
                alert(error.message || "OML4Py resource delete failed.");
            }
        },

        handleSearchKey(event) {
            if (event.key === "Enter") this.loadResources();
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

        renderListFooter(count) {
            return `<div class="list-count-footer">${Number(count || 0).toLocaleString()} items</div>`;
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
