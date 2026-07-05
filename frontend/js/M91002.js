(function() {
    const PAGE_CODE = "M91002";
    const API_CODE = "M91002";
    const DEFAULT_PRESET_URL = "./config/M91002.object-detail-presets.json";
    const IS_ACCOUNT_PAGE = PAGE_CODE === "M91001";
    const DEFAULT_CATEGORY_CODE = IS_ACCOUNT_PAGE ? "MY_ACCOUNT" : "";
    const SUPPORTED_LANGUAGE_CODES = new Set(["en", "ko"]);
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);
    const getMessage = (key, fallback = "") => {
        const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
        const messages = pack && typeof pack.messages === "object" && !Array.isArray(pack.messages) ? pack.messages : {};
        const labels = pack && typeof pack.labels === "object" && !Array.isArray(pack.labels) ? pack.labels : {};
        if (Object.prototype.hasOwnProperty.call(messages, key)) return String(messages[key] ?? "");
        if (Object.prototype.hasOwnProperty.call(labels, key)) return String(labels[key] ?? "");
        return fallback;
    };

    const emptySetting = () => ({
        CATEGORY_CODE: "",
        SETTING_KEY: "",
        SETTING_VALUE: "",
        SETTING_DESC: "",
        SORT_ORDER: 0,
        USE_YN: "Y"
    });

    const M91002 = {
        ...COMMON,
        isInit: false,
        categories: [],
        selectedCategoryCode: DEFAULT_CATEGORY_CODE,
        settings: [],
        selectedSetting: emptySetting(),
        accountInfo: null,
        geminiKeyStatus: null,

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
            this.accountInfo = null;
            this.geminiKeyStatus = null;
            this.clearPasswordForm();
            this.isInit = false;
        },

        async loadCategories() {
            const list = getContainerEl("#settingCategoryList-M91002");
            if (list) list.innerHTML = `<div class="project-empty">Loading categories...</div>`;
            try {
                const categories = await this.loadDefaultCategories();
                this.categories = categories.filter((item) => IS_ACCOUNT_PAGE
                    ? item.CATEGORY_CODE === "MY_ACCOUNT"
                    : item.CATEGORY_CODE !== "MY_ACCOUNT"
                );
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
                throw new Error(`Default setting preset load failed. HTTP ${response.status}`);
            }
            return response.json();
        },

        async loadDefaultCategories() {
            const preset = await this.loadDefaultPreset();
            const categories = Array.isArray(preset?.systemSettingCategories)
                ? preset.systemSettingCategories
                : [];
            return categories.map((category) => ({ ...category }));
        },

        renderCategories() {
            const list = getContainerEl("#settingCategoryList-M91002");
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
                <button type="button" class="project-row ${selectedClass}" onclick="M91002.selectCategory('${this.escapeAttr(category.CATEGORY_CODE)}')">
                    <span class="project-row-main">
                        <span class="project-row-title">${this.escapeHtml(this.getCategoryDisplayName(category))}</span>
                        <span class="project-row-sub">${this.escapeHtml(this.getCategoryDisplayDesc(category))}</span>
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
            this.syncCategoryPanels();
            this.updateCategoryTitle();
            if (this.isAccountCategory()) {
                this.settings = [];
                this.selectedSetting = emptySetting();
                this.renderSettings();
                this.renderSettingDetail();
                await this.loadMyAccount();
                await this.loadGeminiApiKeyStatus();
                return;
            }
            await this.loadSettings();
            this.selectFirstSettingOrNew();
        },

        async loadSettings() {
            if (this.isAccountCategory()) return;
            const grid = getContainerEl("#settingsGrid-M91002");
            if (!grid) return;
            grid.innerHTML = `<div class="project-empty">Loading settings...</div>`;
            try {
                const params = new URLSearchParams({ categoryCode: this.selectedCategoryCode });
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/settings?${params.toString()}`, { method: "GET", showLoading: false });
                this.settings = Array.isArray(json.data) ? json.data : [];
                this.renderSettings();
                this.updateCategoryTitle();
            } catch (error) {
                grid.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Setting list load failed.")}</div>`;
            }
        },

        renderSettings() {
            const grid = getContainerEl("#settingsGrid-M91002");
            if (!grid) return;
            if (!this.settings.length) {
                grid.innerHTML = `<div class="project-empty">No settings found.</div>${this.renderListFooter(0)}`;
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
                <button type="button" class="scenario-row ${selectedClass}" onclick="M91002.selectSetting('${this.escapeAttr(row.SETTING_KEY || "")}')">
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
            this.selectedSetting = { ...row };
            this.renderSettings();
            this.renderSettingDetail();
        },

        selectFirstSettingOrNew() {
            if (this.isAccountCategory()) return;
            if (this.settings.length > 0) {
                this.selectSetting(this.settings[0].SETTING_KEY || "");
                this.setSystemMessage(`${this.settings.length} setting(s) loaded.`);
                return;
            }
            this.newSetting(false);
            this.setSystemMessage("No settings found in this category. Create a new setting.");
        },

        newSetting(renderMessage = true) {
            this.selectedSetting = {
                ...emptySetting(),
                CATEGORY_CODE: this.selectedCategoryCode
            };
            this.renderSettings();
            this.renderSettingDetail();
            if (renderMessage) this.setSystemMessage("Create a new setting.");
        },

        renderSettingDetail() {
            const row = this.selectedSetting || emptySetting();
            this.setValue("#settingCategory-M91002", row.CATEGORY_CODE || this.selectedCategoryCode);
            this.setValue("#settingKey-M91002", row.SETTING_KEY || "");
            this.setValue("#settingValue-M91002", row.SETTING_VALUE || "");
            this.setValue("#settingDesc-M91002", row.SETTING_DESC || "");
            this.setValue("#settingSortOrder-M91002", row.SORT_ORDER ?? 0);
            this.setValue("#settingUseYn-M91002", row.USE_YN || "Y");
            this.syncSettingHelpers();
        },

        syncSettingHelpers() {
            this.syncLanguageSettingHelper();
            this.syncLogoSettingHelper();
        },

        isLogoSetting() {
            const categoryCode = (getContainerEl("#settingCategory-M91002")?.value || this.selectedCategoryCode || "").trim().toUpperCase();
            const settingKey = (getContainerEl("#settingKey-M91002")?.value || "").trim().toUpperCase();
            return categoryCode === "GENERAL" && settingKey === "SYSTEM_LOGO_IMAGE";
        },

        isLanguageSetting() {
            const categoryCode = (getContainerEl("#settingCategory-M91002")?.value || this.selectedCategoryCode || "").trim().toUpperCase();
            const settingKey = (getContainerEl("#settingKey-M91002")?.value || "").trim().toUpperCase();
            return categoryCode === "GENERAL" && settingKey === "SYSTEM_LANGUAGE";
        },

        normalizeLanguageCode(value) {
            const code = String(value || "en").trim().toLowerCase().replace("_", "-");
            if (code === "ko" || code === "ko-kr" || code === "kr") return "ko";
            return SUPPORTED_LANGUAGE_CODES.has(code) ? code : "en";
        },

        syncLanguageSettingHelper() {
            const helper = getContainerEl("#languageSettingHelper-M91002");
            if (!helper) return;
            const isLanguageSetting = this.isLanguageSetting();
            helper.hidden = !isLanguageSetting;
            if (!isLanguageSetting) return;

            const select = getContainerEl("#settingLanguageSelect-M91002");
            if (select) {
                select.value = this.normalizeLanguageCode(getContainerEl("#settingValue-M91002")?.value || "en");
            }
        },

        applyLanguageSelectValue() {
            const select = getContainerEl("#settingLanguageSelect-M91002");
            const value = this.normalizeLanguageCode(select?.value || "en");
            this.setValue("#settingValue-M91002", value);
            this.syncLanguageSettingHelper();
        },

        syncLogoSettingHelper() {
            const helper = getContainerEl("#logoSettingHelper-M91002");
            if (!helper) return;
            const isLogoSetting = this.isLogoSetting();
            helper.hidden = !isLogoSetting;
            if (!isLogoSetting) return;

            const value = (getContainerEl("#settingValue-M91002")?.value || "").trim();
            const preview = getContainerEl("#settingLogoPreview-M91002");
            if (preview) {
                if (value) {
                    preview.src = value;
                    preview.hidden = false;
                } else {
                    preview.removeAttribute("src");
                    preview.hidden = true;
                }
            }
        },

        pickLogoImage() {
            getContainerEl("#settingLogoFile-M91002")?.click();
        },

        async uploadLogoImage(file) {
            const input = getContainerEl("#settingLogoFile-M91002");
            if (!file) return;
            if (!file.type || !/^image\/(png|jpeg|webp|svg\+xml)$/i.test(file.type)) {
                this.setSystemMessage("Only PNG, JPG, WEBP, or SVG logo images are allowed.", "error");
                if (input) input.value = "";
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                this.setSystemMessage("Logo image must be 2 MB or smaller.", "error");
                if (input) input.value = "";
                return;
            }
            try {
                const dataUrl = await this.readFileAsDataUrl(file);
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/logo-upload`, {
                    method: "POST",
                    body: {
                        fileName: file.name,
                        dataUrl
                    }
                });
                this.setValue("#settingValue-M91002", json.url || "");
                this.syncSettingHelpers();
                this.setSystemMessage(json.message || "Logo image uploaded. Click Save setting to apply it.");
            } catch (error) {
                this.setSystemMessage(error.message || "Logo image upload failed.", "error");
            } finally {
                if (input) input.value = "";
            }
        },

        readFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = () => reject(new Error("Logo image read failed."));
                reader.readAsDataURL(file);
            });
        },

        isShellDisplaySetting(categoryCode, settingKey) {
            const category = String(categoryCode || "").trim().toUpperCase();
            const key = String(settingKey || "").trim().toUpperCase();
            return category === "GENERAL" && ["SYSTEM_DISPLAY_NAME", "SYSTEM_LOGO_IMAGE"].includes(key);
        },

        async saveSetting() {
            const payload = {
                categoryCode: this.selectedCategoryCode,
                settingKey: getContainerEl("#settingKey-M91002")?.value.trim() || "",
                settingValue: getContainerEl("#settingValue-M91002")?.value || "",
                settingDesc: getContainerEl("#settingDesc-M91002")?.value || "",
                sortOrder: Number(getContainerEl("#settingSortOrder-M91002")?.value || 0),
                useYn: getContainerEl("#settingUseYn-M91002")?.value || "Y"
            };
            if (!payload.settingKey) {
                this.setSystemMessage("Setting key is required.", "error");
                return;
            }
            if (String(payload.categoryCode || "").toUpperCase() === "GENERAL"
                && String(payload.settingKey || "").toUpperCase() === "SYSTEM_LANGUAGE") {
                payload.settingValue = this.normalizeLanguageCode(payload.settingValue);
                this.setValue("#settingValue-M91002", payload.settingValue);
                this.syncLanguageSettingHelper();
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/save`, {
                    method: "POST",
                    body: payload
                });
                const isLanguageSetting = this.isLanguageSetting();
                this.setSystemMessage(isLanguageSetting
                    ? "Setting saved. Language changes are applied after logout and next login."
                    : (json.message || "Setting saved."));
                await this.loadSettings();
                this.selectSetting(payload.settingKey);
                if (this.isShellDisplaySetting(payload.categoryCode, payload.settingKey)) {
                    await window.reloadShellDisplaySettings?.();
                }
            } catch (error) {
                this.setSystemMessage(error.message || "Setting save failed.", "error");
            }
        },

        async deleteSetting() {
            const settingKey = getContainerEl("#settingKey-M91002")?.value.trim() || "";
            if (!settingKey) return;
            if (!(await CommonMessage.confirm(`Delete setting "${settingKey}"?`))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/delete`, {
                    method: "POST",
                    body: {
                        categoryCode: this.selectedCategoryCode,
                        settingKey
                    }
                });
                this.setSystemMessage(json.message || "Setting deleted.");
                await this.loadSettings();
                this.newSetting(false);
            } catch (error) {
                this.setSystemMessage(error.message || "Setting delete failed.", "error");
            }
        },

        async createDefaultSettings() {
            if (!(await CommonMessage.confirm("Create or update default settings in the database?", { defaultAction: "cancel" }))) return;
            const button = getContainerEl("#createDefaultSettingsBtn-M91002");
            const originalHtml = button?.innerHTML || "";
            if (button) {
                button.disabled = true;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }
            this.setSystemMessage("Creating missing default settings...");
            try {
                const categories = await this.loadDefaultCategories();
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/setting/defaults`, {
                    method: "POST",
                    body: { categories }
                });
                const created = Number(json.createdCount || 0);
                const skipped = Number(json.skippedCount || 0);
                const message = json.message || `Default settings checked. ${created} created, ${skipped} skipped.`;
                this.categories = categories.filter((item) => item.CATEGORY_CODE !== "MY_ACCOUNT");
                this.selectedCategoryCode = "GENERAL";
                this.renderCategories();
                this.syncCategoryPanels();
                this.setSystemMessage(message);
                await this.loadSettings();
                this.selectFirstSettingOrNew();
                await window.reloadShellDisplaySettings?.();
            } catch (error) {
                this.setSystemMessage(error.message || "Default setting save failed.", "error");
            } finally {
                if (button) {
                    button.disabled = false;
                    button.innerHTML = originalHtml || '<i class="fas fa-wand-magic-sparkles"></i>';
                }
            }
        },

        handlePasswordKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.changePassword();
        },

        handleEmailKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.changeEmail();
        },

        handleUserNameKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.changeUserName();
        },

        isAccountCategory() {
            return this.selectedCategoryCode === "MY_ACCOUNT";
        },

        syncCategoryPanels() {
            const showAccount = this.isAccountCategory();
            document.querySelectorAll("#container-M91002 [data-setting-panel]").forEach((el) => {
                el.hidden = showAccount;
                el.style.display = showAccount ? "none" : "";
            });
            document.querySelectorAll("#container-M91002 [data-account-panel]").forEach((el) => {
                el.hidden = !showAccount;
                el.style.display = showAccount ? "" : "none";
            });
            document.querySelectorAll("#container-M91002 [data-setting-actions]").forEach((el) => {
                el.hidden = showAccount;
                el.style.display = showAccount ? "none" : "";
            });
        },

        async loadMyAccount() {
            this.setSystemMessage("Loading my account...");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/me`, { method: "GET", showLoading: false });
                this.accountInfo = json.data || {};
                this.renderMyAccount();
                this.setSystemMessage("My account loaded.");
            } catch (error) {
                this.setSystemMessage(error.message || "My account load failed.", "error");
            }
        },

        renderMyAccount() {
            const account = this.accountInfo || {};
            this.setValue("#accountLoginId-M91002", account.loginId || "");
            this.setValue("#accountUserName-M91002", account.userName || "");
            this.setValue("#accountRoleCode-M91002", account.roleCode || "");
            this.setValue("#accountEmail-M91002", account.email || "");
            this.setValue("#newEmail-M91002", account.email || "");
            this.setValue("#emailCurrentPassword-M91002", "");
        },

        async loadGeminiApiKeyStatus() {
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/gemini-key`, { method: "GET", showLoading: false });
                this.geminiKeyStatus = json.data || {};
                this.renderGeminiApiKeyStatus();
            } catch (error) {
                this.setValue("#geminiApiKeyStatus-M91002", error.message || "Gemini key status load failed.");
            }
        },

        renderGeminiApiKeyStatus() {
            const status = this.geminiKeyStatus || {};
            const text = status.registered
                ? `Registered (${status.maskedKey || "masked"})`
                : "Not registered";
            this.setValue("#geminiApiKeyStatus-M91002", text);
            this.setValue("#geminiApiKey-M91002", "");
        },

        async saveGeminiApiKey() {
            const apiKey = getContainerEl("#geminiApiKey-M91002")?.value.trim() || "";
            if (!apiKey) {
                this.setSystemMessage("Gemini API key is required.", "error");
                getContainerEl("#geminiApiKey-M91002")?.focus();
                return;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/gemini-key/save`, {
                    method: "POST",
                    body: { apiKey }
                });
                this.geminiKeyStatus = json.data || {};
                this.renderGeminiApiKeyStatus();
                this.setSystemMessage(json.message || "Gemini API key saved.");
            } catch (error) {
                this.setSystemMessage(error.message || "Gemini API key save failed.", "error");
            }
        },

        async deleteGeminiApiKey() {
            if (!(await CommonMessage.confirm("Delete your saved Gemini API key?"))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/gemini-key/delete`, {
                    method: "POST"
                });
                this.geminiKeyStatus = { registered: false, maskedKey: "" };
                this.renderGeminiApiKeyStatus();
                this.setSystemMessage(json.message || "Gemini API key deleted.");
            } catch (error) {
                this.setSystemMessage(error.message || "Gemini API key delete failed.", "error");
            }
        },

        clearPasswordForm() {
            this.setValue("#currentPassword-M91002", "");
            this.setValue("#newPassword-M91002", "");
            this.setValue("#newPasswordConfirm-M91002", "");
            this.setValue("#geminiApiKey-M91002", "");
        },

        async changeUserName() {
            const payload = {
                userName: getContainerEl("#accountUserName-M91002")?.value.trim() || ""
            };
            if (!payload.userName) {
                this.setSystemMessage("User name is required.", "error");
                getContainerEl("#accountUserName-M91002")?.focus();
                return;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/name/change`, {
                    method: "POST",
                    body: payload
                });
                await this.loadMyAccount();
                const loginUser = PageManager.getLoginUser?.() || {};
                if (loginUser.userId) {
                    loginUser.userName = json.userName || payload.userName;
                    sessionStorage.setItem("initLoginUser", JSON.stringify(loginUser));
                    PageManager.updateSessionStatus?.();
                }
                this.setSystemMessage(json.message || "User name changed.");
            } catch (error) {
                this.setSystemMessage(error.message || "User name change failed.", "error");
            }
        },

        async changeEmail() {
            const payload = {
                newEmail: getContainerEl("#newEmail-M91002")?.value.trim() || "",
                currentPassword: getContainerEl("#emailCurrentPassword-M91002")?.value || ""
            };
            if (!payload.newEmail) {
                this.setSystemMessage("New email is required.", "error");
                getContainerEl("#newEmail-M91002")?.focus();
                return;
            }
            if (!payload.currentPassword) {
                this.setSystemMessage("Current password is required.", "error");
                getContainerEl("#emailCurrentPassword-M91002")?.focus();
                return;
            }
            if (!(await CommonMessage.confirm("Change your email?"))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/email/change`, {
                    method: "POST",
                    body: payload
                });
                this.setValue("#emailCurrentPassword-M91002", "");
                await this.loadMyAccount();
                const loginUser = PageManager.getLoginUser?.() || {};
                if (loginUser.userId) {
                    loginUser.email = json.email || payload.newEmail;
                    sessionStorage.setItem("initLoginUser", JSON.stringify(loginUser));
                }
                this.setSystemMessage(json.message || "Email changed.");
            } catch (error) {
                this.setSystemMessage(error.message || "Email change failed.", "error");
            }
        },

        async changePassword() {
            const payload = {
                currentPassword: getContainerEl("#currentPassword-M91002")?.value || "",
                newPassword: getContainerEl("#newPassword-M91002")?.value || "",
                newPasswordConfirm: getContainerEl("#newPasswordConfirm-M91002")?.value || ""
            };
            if (!payload.currentPassword) {
                this.setSystemMessage("Current password is required.", "error");
                getContainerEl("#currentPassword-M91002")?.focus();
                return;
            }
            if (!payload.newPassword) {
                this.setSystemMessage("New password is required.", "error");
                getContainerEl("#newPassword-M91002")?.focus();
                return;
            }
            if (payload.newPassword.length < 8) {
                this.setSystemMessage("New password must be at least 8 characters.", "error");
                getContainerEl("#newPassword-M91002")?.focus();
                return;
            }
            if (payload.newPassword !== payload.newPasswordConfirm) {
                this.setSystemMessage("New password confirmation does not match.", "error");
                getContainerEl("#newPasswordConfirm-M91002")?.focus();
                return;
            }
            if (!(await CommonMessage.confirm("Change your login password?"))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${API_CODE}/account/password/change`, {
                    method: "POST",
                    body: payload
                });
                this.clearPasswordForm();
                this.setSystemMessage(json.message || "Password changed.");
            } catch (error) {
                this.setSystemMessage(error.message || "Password change failed.", "error");
            }
        },

        updateCategoryTitle() {
            const category = this.categories.find((item) => item.CATEGORY_CODE === this.selectedCategoryCode);
            this.setText("#selectedSettingCategoryName-M91002", this.getCategoryDisplayName(category));
            this.setValue("#settingCategory-M91002", this.selectedCategoryCode);
            this.setText("#settingsDescription-M91002", this.getCategoryDisplayDesc(category));
        },

        getCategoryDisplayName(category = null) {
            const code = String(category?.CATEGORY_CODE || this.selectedCategoryCode || "").toUpperCase();
            const defaults = {
                MY_ACCOUNT: "My Account",
                GENERAL: "System General"
            };
            const keys = {
                MY_ACCOUNT: "categoryMyAccountName",
                GENERAL: "categoryGeneralName"
            };
            return getMessage(keys[code], defaults[code] || category?.CATEGORY_NAME || code || "Settings");
        },

        getCategoryDisplayDesc(category = null) {
            const code = String(category?.CATEGORY_CODE || this.selectedCategoryCode || "").toUpperCase();
            const defaults = {
                MY_ACCOUNT: "Manage your login information, email, and password.",
                GENERAL: "Basic system display settings."
            };
            const keys = {
                MY_ACCOUNT: "categoryMyAccountDesc",
                GENERAL: "categoryGeneralDesc"
            };
            return getMessage(keys[code], defaults[code] || category?.CATEGORY_DESC || "Manage category key/value settings.");
        },

        setSystemMessage(message, type = "info") {
            const el = getContainerEl("#systemMessage-M91002");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error" ? "table-error" : "env-detail-hint";
        }
    };

    window[PAGE_CODE] = M91002;
})();
