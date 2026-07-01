(function() {
    const PAGE_CODE = "M91003";
    const API_CODE = "M91003";
    const DEFAULT_PRESET_URL = "./config/M91003.object-detail-presets.json";
    const DEFAULT_CATEGORY_CODE = "DATA_PROFILING";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const emptySetting = () => ({
        CATEGORY_CODE: "",
        SETTING_KEY: "",
        SETTING_VALUE: "",
        SETTING_DESC: "",
        SORT_ORDER: 0,
        USE_YN: "Y"
    });

    const M91003 = {
        isInit: false,
        categories: [],
        selectedCategoryCode: DEFAULT_CATEGORY_CODE,
        settings: [],
        selectedSetting: emptySetting(),

        async init() {
            if (this.isInit) return;
            await this.loadCategories();
            await this.refreshSelectedCategory();
            this.isInit = true;
        },

        destroy() {
            this.categories = [];
            this.selectedCategoryCode = DEFAULT_CATEGORY_CODE;
            this.settings = [];
            this.selectedSetting = emptySetting();
            this.isInit = false;
        },

        async loadCategories() {
            const list = getContainerEl("#settingCategoryList-M91003");
            if (list) list.innerHTML = `<div class="project-empty">Loading categories...</div>`;
            try {
                this.categories = await this.loadDefaultCategories();
                if (!this.categories.some((item) => item.CATEGORY_CODE === this.selectedCategoryCode)) {
                    this.selectedCategoryCode = this.categories[0]?.CATEGORY_CODE || DEFAULT_CATEGORY_CODE;
                }
                this.renderCategories();
            } catch (error) {
                if (list) list.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || "Category load failed.")}</div>`;
            }
        },

        async loadDefaultPreset() {
            const response = await fetch(`${DEFAULT_PRESET_URL}?v=${Date.now()}`, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`Target default setting preset load failed. HTTP ${response.status}`);
            }
            return response.json();
        },

        async loadDefaultCategories() {
            const preset = await this.loadDefaultPreset();
            const categories = Array.isArray(preset?.targetSettingCategories)
                ? preset.targetSettingCategories
                : [];
            return categories.map((category) => ({ ...category }));
        },

        renderCategories() {
            const list = getContainerEl("#settingCategoryList-M91003");
            if (!list) return;
            if (!this.categories.length) {
                list.innerHTML = `<div class="project-empty">No categories found.</div>${this.renderListFooter(0)}`;
                return;
            }
            list.innerHTML = `
                <div class="project-list-head">
                    <div>Category</div>
                    <div>Sort</div>
                </div>
                <div class="project-list-body">
                    ${this.categories.map((category) => this.createCategoryRow(category)).join("")}
                </div>
                ${this.renderListFooter(this.categories.length)}
            `;
            this.updateCategoryTitle();
        },

        createCategoryRow(category) {
            const selectedClass = category.CATEGORY_CODE === this.selectedCategoryCode ? "is-selected" : "";
            return `
                <button type="button" class="project-row ${selectedClass}" onclick="M91003.selectCategory('${this.escapeAttr(category.CATEGORY_CODE)}')">
                    <span class="project-row-main">
                        <span class="project-row-title">${this.escapeHtml(category.CATEGORY_NAME || category.CATEGORY_CODE)}</span>
                        <span class="project-row-sub">${this.escapeHtml(category.CATEGORY_DESC || "")}</span>
                    </span>
                    <span class="project-row-meta">
                        <span>${this.escapeHtml(category.SORT_ORDER ?? "")}</span>
                    </span>
                </button>
            `;
        },

        async selectCategory(categoryCode) {
            this.selectedCategoryCode = categoryCode || DEFAULT_CATEGORY_CODE;
            this.selectedSetting = emptySetting();
            this.renderCategories();
            await this.refreshSelectedCategory();
        },

        async refreshSelectedCategory() {
            this.updateCategoryTitle();
            await this.loadSettings();
            this.selectFirstSettingOrNew();
        },

        async loadSettings() {
            const grid = getContainerEl("#settingsGrid-M91003");
            if (!grid) return;
            grid.innerHTML = `<div class="project-empty">Loading settings...</div>`;
            try {
                const params = new URLSearchParams({ categoryCode: this.selectedCategoryCode });
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/settings?${params.toString()}`, { method: "GET", showLoading: false });
                this.settings = Array.isArray(json.data) ? json.data : [];
                this.renderSettings();
                this.updateCategoryTitle();
            } catch (error) {
                grid.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Target setting list load failed.")}</div>`;
            }
        },

        renderSettings() {
            const grid = getContainerEl("#settingsGrid-M91003");
            if (!grid) return;
            if (!this.settings.length) {
                grid.innerHTML = `
                    <div class="scenario-list-head">
                        <div>Key / Value</div>
                        <div>Use / Sort</div>
                    </div>
                    <div class="scenario-list-body">
                        <div class="project-empty">No settings found.</div>
                    </div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }
            grid.innerHTML = `
                <div class="scenario-list-head">
                    <div>Key / Value</div>
                    <div>Use / Sort</div>
                </div>
                <div class="scenario-list-body">
                    ${this.settings.map((row) => this.createSettingRow(row)).join("")}
                </div>
                ${this.renderListFooter(this.settings.length)}
            `;
        },

        createSettingRow(row) {
            const selectedClass = row.SETTING_KEY === this.selectedSetting.SETTING_KEY ? "is-selected" : "";
            return `
                <button type="button" class="scenario-row ${selectedClass}" onclick="M91003.selectSetting('${this.escapeAttr(row.SETTING_KEY || "")}')">
                    <span class="project-row-main">
                        <span class="project-row-title">${this.escapeHtml(row.SETTING_KEY || "")}</span>
                        <span class="project-row-sub">${this.escapeHtml(row.SETTING_VALUE || "")}</span>
                    </span>
                    <span class="project-row-meta">
                        <span>Use ${this.escapeHtml(row.USE_YN || "Y")}</span>
                        <span>${this.escapeHtml(row.SORT_ORDER ?? "")}</span>
                    </span>
                </button>
            `;
        },

        selectSetting(settingKey) {
            const row = this.settings.find((item) => item.SETTING_KEY === settingKey);
            if (!row) return;
            const scrollTop = this.getSettingsScrollTop();
            this.selectedSetting = { ...row };
            this.renderSettings();
            this.restoreSettingsScrollTop(scrollTop);
            this.renderSettingDetail();
        },

        selectFirstSettingOrNew() {
            if (this.settings.length > 0) {
                this.selectSetting(this.settings[0].SETTING_KEY || "");
                this.setSystemMessage(`${this.settings.length} target setting(s) loaded.`);
                return;
            }
            this.newSetting(false);
            this.setSystemMessage("No target settings found. Create default settings or add a new setting.");
        },

        newSetting(renderMessage = true) {
            this.selectedSetting = {
                ...emptySetting(),
                CATEGORY_CODE: this.selectedCategoryCode
            };
            this.renderSettings();
            this.renderSettingDetail();
            if (renderMessage) this.setSystemMessage("Create a new target setting.");
        },

        renderSettingDetail() {
            const row = this.selectedSetting || emptySetting();
            this.setValue("#settingCategory-M91003", row.CATEGORY_CODE || this.selectedCategoryCode);
            this.setValue("#settingKey-M91003", row.SETTING_KEY || "");
            this.setValue("#settingValue-M91003", row.SETTING_VALUE || "");
            this.setValue("#settingDesc-M91003", row.SETTING_DESC || "");
            this.setValue("#settingSortOrder-M91003", row.SORT_ORDER ?? 0);
            this.setValue("#settingUseYn-M91003", row.USE_YN || "Y");
        },

        async saveSetting() {
            const payload = {
                categoryCode: this.selectedCategoryCode,
                settingKey: getContainerEl("#settingKey-M91003")?.value.trim() || "",
                settingValue: getContainerEl("#settingValue-M91003")?.value || "",
                settingDesc: getContainerEl("#settingDesc-M91003")?.value || "",
                sortOrder: Number(getContainerEl("#settingSortOrder-M91003")?.value || 0),
                useYn: getContainerEl("#settingUseYn-M91003")?.value || "Y"
            };
            if (!payload.settingKey) {
                this.setSystemMessage("Setting key is required.", "error");
                return;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/save`, {
                    method: "POST",
                    body: payload
                });
                this.setSystemMessage(json.message || "Target setting saved.");
                await this.loadSettings();
                this.selectSetting(payload.settingKey.toUpperCase());
            } catch (error) {
                this.setSystemMessage(error.message || "Target setting save failed.", "error");
            }
        },

        async deleteSetting() {
            const settingKey = getContainerEl("#settingKey-M91003")?.value.trim() || "";
            if (!settingKey) return;
            if (!(await CommonMessage.confirm(`Delete target setting "${settingKey}"?`))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/delete`, {
                    method: "POST",
                    body: {
                        categoryCode: this.selectedCategoryCode,
                        settingKey
                    }
                });
                this.setSystemMessage(json.message || "Target setting deleted.");
                await this.loadSettings();
                this.newSetting(false);
            } catch (error) {
                this.setSystemMessage(error.message || "Target setting delete failed.", "error");
            }
        },

        async createDefaultSettings() {
            if (!(await CommonMessage.confirm("Create or update default target settings in the target database?"))) return;
            const button = getContainerEl("#createDefaultSettingsBtn-M91003");
            const originalHtml = button?.innerHTML || "";
            if (button) {
                button.disabled = true;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }
            this.setSystemMessage("Creating missing target default settings...");
            try {
                const categories = await this.loadDefaultCategories();
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/defaults`, {
                    method: "POST",
                    body: { categories }
                });
                const created = Number(json.createdCount || 0);
                const skipped = Number(json.skippedCount || 0);
                const message = json.message || `Target default settings checked. ${created} created, ${skipped} skipped.`;
                this.categories = categories;
                this.selectedCategoryCode = DEFAULT_CATEGORY_CODE;
                this.renderCategories();
                this.setSystemMessage(message);
                await this.loadSettings();
                this.selectFirstSettingOrNew();
            } catch (error) {
                this.setSystemMessage(error.message || "Target default setting save failed.", "error");
            } finally {
                if (button) {
                    button.disabled = false;
                    button.innerHTML = originalHtml || '<i class="fas fa-wand-magic-sparkles"></i>';
                }
            }
        },

        updateCategoryTitle() {
            const category = this.categories.find((item) => item.CATEGORY_CODE === this.selectedCategoryCode);
            this.setText("#selectedSettingCategoryName-M91003", category?.CATEGORY_NAME || this.selectedCategoryCode);
            this.setValue("#settingCategory-M91003", this.selectedCategoryCode);
            const desc = category?.CATEGORY_DESC || "Manage target key/value settings.";
            this.setText("#settingsDescription-M91003", desc);
        },

        getSettingsScrollTop() {
            return getContainerEl("#settingsGrid-M91003 .scenario-list-body")?.scrollTop || 0;
        },

        restoreSettingsScrollTop(scrollTop = 0) {
            const restore = () => {
                const body = getContainerEl("#settingsGrid-M91003 .scenario-list-body");
                if (body) body.scrollTop = scrollTop;
            };
            restore();
            requestAnimationFrame(restore);
        },

        renderListFooter(count) {
            return `<div class="project-list-footer">${this.escapeHtml(count)} item${Number(count) === 1 ? "" : "s"}</div>`;
        },

        setSystemMessage(message, tone = "") {
            const el = getContainerEl("#systemMessage-M91003");
            if (!el) return;
            el.textContent = message || "";
            el.classList.toggle("text-red-600", tone === "error");
        },

        setValue(selector, value) {
            const el = getContainerEl(selector);
            if (el) el.value = value ?? "";
        },

        setText(selector, value) {
            const el = getContainerEl(selector);
            if (el) el.textContent = value ?? "";
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },

        escapeAttr(value) {
            return this.escapeHtml(value);
        }
    };

    window[PAGE_CODE] = M91003;
})();
