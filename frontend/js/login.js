(function() {
    const PAGE_CODE = "login";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const LOGIN_LABEL_FALLBACKS = {
        title: "INIT Data Editing System Login",
        loginLanguage: "Login language",
        introEyebrow: "INIT Data Editing Platform",
        introHeadline: "Improve data quality with intelligent rule discovery.",
        introLead: "Profile source data, discover editing rules, and run governed workflows from one workspace.",
        introVisualSource: "Source",
        introVisualRules: "Rules",
        introVisualReview: "Review",
        introStepProfile: "Profile",
        introStepProfileDesc: "Read table signals",
        introStepRule: "Discover",
        introStepRuleDesc: "Shape edit rules",
        introStepRun: "Execute",
        introStepRunDesc: "Trace every run",
        loginId: "Login ID",
        password: "Password",
        loginPassword: "Login Password",
        confirmPassword: "Confirm Password",
        targetDb: "Target DB",
        messageEnterCredentials: "Enter your saved ID and password.",
        invalidLogin: "Invalid login ID or password.",
        targetDbDisabled: "Selected target DB connection is disabled.",
        systemTablesNotInstalledSignup: "System tables are not installed. Sign up as the first administrator to start initial setup.",
        adminSignupKeyNotConfigured: "Admin signup key is not configured.",
        loginIdRequired: "Login ID is required.",
        userNameRequired: "User name is required.",
        invalidSignupRole: "Invalid signup role.",
        duplicateLoginId: "This login ID is already registered.",
        pendingLoginId: "This login ID is already waiting for approval.",
        signupPendingApproval: "Your signup request is waiting for administrator approval. You can log in after approval.",
        adminKeyMismatch: "Admin key does not match.",
        forgotPassword: "Forgot password",
        signup: "Signup",
        login: "Login",
        showPassword: "Show password",
        hidePassword: "Hide password",
        passwordHelpTitle: "Password Reset Request",
        passwordHelpMessage: "Passwords cannot be viewed for security reasons. Contact your system administrator if a reset is required.",
        adminTeam: "Admin Team",
        email: "Email",
        phone: "Phone",
        requestInfo: "Request Info",
        passwordHelpRequestInfo: "Send your login ID, name, and signup email together.",
        close: "Close",
        signupTitle: "Signup Draft",
        userName: "User Name",
        memberType: "Member Type",
        generalMember: "General member",
        adminMember: "Admin member",
        adminKey: "Admin Key",
        signupMessage: "Enter signup information.",
        cancel: "Cancel",
        saveSignup: "Save signup",
        generalMemberApprovalMessage: "General members can log in after administrator approval.",
        adminMemberSetupMessage: "Admin members can continue initial setup when the admin key matches.",
        selectTargetDb: "Select a target DB.",
        loginRequired: "Login ID and password are required.",
        loggingIn: "Logging in...",
        selectTargetThenLoginAgain: "Select a target DB, then click Login again.",
        targetDbAutoSelectFailed: "Target DB could not be selected automatically. Login again after selecting a Target DB.",
        loginFailed: "Login failed.",
        signupGuide: "Enter signup information. Admin members need an admin key.",
        loading: "Loading...",
        loginIdUserNameRequired: "Login ID and User Name are required.",
        emailRequired: "Email is required.",
        validEmailRequired: "Enter a valid email address.",
        loginPasswordRequired: "Login Password is required.",
        passwordConfirmMismatch: "Password confirmation does not match.",
        validMemberTypeRequired: "Select a valid member type.",
        adminKeyRequired: "Admin key is required.",
        savingSignup: "Saving signup...",
        adminKeyVerified: "Admin key verified. Moving to initial setup.",
        signupSubmitted: "Signup request submitted. You can log in after administrator approval.",
        signupFailed: "Signup failed.",
        defaultConnection: "Default",
        sharedConnection: "Shared",
        privateConnection: "Private"
    };
    const LOGIN_SERVER_MESSAGE_KEYS = {
        "invalid login id or password.": "invalidLogin",
        "login id and password are required.": "loginRequired",
        "selected target db connection is disabled.": "targetDbDisabled",
        "system tables are not installed. sign up as the first administrator to start initial setup.": "systemTablesNotInstalledSignup",
        "admin signup key is not configured.": "adminSignupKeyNotConfigured",
        "login id is required.": "loginIdRequired",
        "user name is required.": "userNameRequired",
        "email is required.": "emailRequired",
        "login password is required.": "loginPasswordRequired",
        "invalid signup role.": "invalidSignupRole",
        "이미 등록된 로그인 id입니다.": "duplicateLoginId",
        "이미 승인 대기 중인 로그인 id입니다.": "pendingLoginId",
        "회원가입 신청이 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다.": "signupPendingApproval",
        "관리자 인증키가 일치하지 않습니다.": "adminKeyMismatch"
    };

    const login = {
        hasConnections: false,
        targetSelectionRequired: false,
        isLoggingIn: false,
        passwordVisible: false,
        loginLanguage: "en",
        messageKey: "messageEnterCredentials",
        signupMessageKey: "signupMessage",

        async init() {
            document.body.classList.add("intro-mode");
            await this.applyLoginLanguage("en", { resetMessage: true });
            this.resetLoginForm();
        },

        destroy() {},

        t(key, fallback = "") {
            const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
            const labels = pack && typeof pack.labels === "object" && !Array.isArray(pack.labels) ? pack.labels : {};
            const defaultFallback = fallback || LOGIN_LABEL_FALLBACKS[key] || "";
            return Object.prototype.hasOwnProperty.call(labels, key)
                ? String(labels[key] ?? "")
                : (window.I18nManager?.tPage?.(PAGE_CODE, key, defaultFallback) || defaultFallback);
        },

        normalizeLoginLanguage(languageCode) {
            const code = String(languageCode || "en").trim().toLowerCase().replace("_", "-");
            return code === "ko" || code === "ko-kr" || code === "kr" ? "ko" : "en";
        },

        normalizeServerMessage(message) {
            return String(message || "").replace(/\s+/g, " ").trim().toLowerCase();
        },

        getServerMessageKey(message) {
            return LOGIN_SERVER_MESSAGE_KEYS[this.normalizeServerMessage(message)] || "";
        },

        translateServerMessage(message, fallbackKey = "loginFailed") {
            const messageText = String(message || "").trim();
            const key = this.getServerMessageKey(messageText);
            if (key) {
                return {
                    key,
                    text: this.t(key)
                };
            }
            return {
                key: messageText ? "" : fallbackKey,
                text: messageText || this.t(fallbackKey)
            };
        },

        async changeLoginLanguage(languageCode) {
            await this.applyLoginLanguage(languageCode, { resetMessage: false });
        },

        async applyLoginLanguage(languageCode, options = {}) {
            const normalized = this.normalizeLoginLanguage(languageCode);
            const root = document.getElementById("container-login") || document;
            this.loginLanguage = normalized;
            this.updateLanguageButtons();
            await window.I18nManager?.applyLanguage?.(normalized);
            await window.I18nManager?.ensurePagePack?.(PAGE_CODE, normalized);
            if (normalized === "en") this.applyLoginFallbackLabels(root);
            else window.I18nManager?.applyPagePack?.(PAGE_CODE, root);
            this.updateLanguageButtons();
            this.syncPasswordVisibility();
            if (options.resetMessage || this.messageKey) this.setMessageByKey(this.messageKey || "messageEnterCredentials");
            if (this.signupMessageKey) this.setSignupMessageByKey(this.signupMessageKey);
        },

        applyLoginFallbackLabels(root) {
            const apply = (selector, dataKey, callback) => {
                root.querySelectorAll?.(selector).forEach((element) => {
                    const key = element.dataset?.[dataKey] || "";
                    if (!Object.prototype.hasOwnProperty.call(LOGIN_LABEL_FALLBACKS, key)) return;
                    callback(element, LOGIN_LABEL_FALLBACKS[key]);
                });
            };
            apply("[data-label-key]", "labelKey", (element, value) => {
                element.textContent = value;
            });
            apply("[data-title-key]", "titleKey", (element, value) => {
                element.setAttribute("title", value);
                if (element.hasAttribute("aria-label")) element.setAttribute("aria-label", value);
            });
            apply("[data-value-key]", "valueKey", (element, value) => {
                if ("value" in element) element.value = value;
                else element.setAttribute("value", value);
            });
            apply("[data-aria-label-key]", "ariaLabelKey", (element, value) => {
                element.setAttribute("aria-label", value);
            });
        },

        updateLanguageButtons() {
            const root = document.getElementById("container-login") || document;
            root.querySelectorAll("[data-login-language]").forEach((button) => {
                const active = this.normalizeLoginLanguage(button.dataset.loginLanguage) === this.loginLanguage;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
                button.setAttribute("aria-current", active ? "true" : "false");
            });
        },

        getValue(selector) {
            return getContainerEl(selector)?.value || "";
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },

        getSelectedConnectionId() {
            return getContainerEl("#loginConnectionList input[name='loginConnectionId']:checked")?.value || "";
        },

        getSelectedConnectionName() {
            const selected = getContainerEl("#loginConnectionList input[name='loginConnectionId']:checked");
            return selected?.closest(".login-target-db-option")?.querySelector("strong")?.textContent?.trim() || "";
        },

        isValidEmail(value) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
        },

        setValue(selector, value) {
            const el = getContainerEl(selector);
            if (el) el.value = value ?? "";
        },

        syncPasswordVisibility() {
            const input = getContainerEl("#loginPassword");
            const button = getContainerEl("#loginPasswordToggle");
            const icon = getContainerEl("#loginPasswordToggleIcon");
            if (input) input.type = this.passwordVisible ? "text" : "password";
            if (button) {
                button.setAttribute("aria-pressed", this.passwordVisible ? "true" : "false");
                const title = this.passwordVisible
                    ? this.t("hidePassword", "Hide password")
                    : this.t("showPassword", "Show password");
                button.setAttribute("aria-label", title);
                button.title = title;
            }
            if (icon) {
                icon.className = this.passwordVisible ? "fas fa-eye-slash" : "fas fa-eye";
            }
        },

        togglePasswordVisible() {
            this.passwordVisible = !this.passwordVisible;
            this.syncPasswordVisibility();
            getContainerEl("#loginPassword")?.focus();
        },

        focusLoginButton() {
            const focus = () => {
                const button = getContainerEl("#loginSubmitButton")
                    || getContainerEl(".intro-login-actions .env-save");
                if (!button) return;

                if (document.activeElement && document.activeElement !== button) {
                    document.activeElement.blur?.();
                }
                button.tabIndex = 0;
                button.focus();
            };

            focus();
            requestAnimationFrame(focus);
            setTimeout(focus, 0);
            setTimeout(focus, 50);
            setTimeout(focus, 150);
            setTimeout(focus, 350);
            setTimeout(focus, 700);
        },

        focusLoginId() {
            const focus = () => {
                if (this.targetSelectionRequired) return;
                const signupLayer = getContainerEl("#signupLayer");
                if (signupLayer && !signupLayer.hidden) return;

                const input = getContainerEl("#loginId") || document.getElementById("loginId");
                if (!input) return;
                input.focus();
                input.select?.();
            };
            focus();
            requestAnimationFrame(focus);
            setTimeout(focus, 0);
            setTimeout(focus, 50);
            setTimeout(focus, 150);
            setTimeout(focus, 350);
            setTimeout(focus, 700);
        },

        setMessage(message, type = "info") {
            const el = getContainerEl("#loginMessage");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error" ? "intro-step-msg is-error" : "intro-step-msg";
        },

        setMessageByKey(key, type = "info", fallback = "") {
            this.messageKey = key || "";
            this.setMessage(this.t(key, fallback), type);
        },

        setSignupMessage(message, type = "info") {
            const el = getContainerEl("#signupMessage");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error" ? "intro-step-msg is-error" : "intro-step-msg";
        },

        setSignupMessageByKey(key, type = "info", fallback = "") {
            this.signupMessageKey = key || "";
            this.setSignupMessage(this.t(key, fallback), type);
        },

        setLoginBusy(isBusy) {
            this.isLoggingIn = Boolean(isBusy);
            const button = getContainerEl("#loginSubmitButton");
            if (button) {
                button.disabled = this.isLoggingIn;
                const label = button.querySelector("[data-label-key='login']");
                if (label) {
                    label.textContent = this.isLoggingIn
                        ? this.t("loggingIn", "Logging in...")
                        : this.t("login", "Login");
                }
            }
            getContainerEl("#loginMessage")?.classList.toggle("is-loading", this.isLoggingIn);
            getContainerEl("#loginId")?.toggleAttribute("disabled", this.isLoggingIn);
            getContainerEl("#loginPassword")?.toggleAttribute("disabled", this.isLoggingIn);
            getContainerEl("#loginPasswordToggle")?.toggleAttribute("disabled", this.isLoggingIn);
            getContainerEl("#loginConnectionList")?.querySelectorAll("input[name='loginConnectionId']").forEach((input) => {
                input.disabled = this.isLoggingIn;
            });
        },

        handleLoginKey(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.login();
            }
        },

        resetLoginForm() {
            this.setValue("#loginId", "");
            this.setValue("#loginPassword", "");
            this.passwordVisible = false;
            this.syncPasswordVisibility();
            this.hideTargetSelection();
            const notice = sessionStorage.getItem("loginNotice") || "";
            if (notice) {
                sessionStorage.removeItem("loginNotice");
                this.messageKey = "";
                this.setMessage(notice);
            } else {
                this.setMessageByKey("messageEnterCredentials", "info", "Enter your saved ID and password.");
            }
            this.focusLoginId();
        },

        handleSignupKey(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.saveSignup();
            }
        },

        handleSignupRoleChange() {
            const role = String(this.getValue("#signupRole") || "USER").toUpperCase();
            const field = getContainerEl("#signupAdminKeyField");
            const input = getContainerEl("#signupAdminKey");
            const isAdmin = role === "ADMIN";
            if (field) field.hidden = !isAdmin;
            if (input) {
                input.disabled = !isAdmin;
                input.required = isAdmin;
            }
            if (!isAdmin) {
                this.setValue("#signupAdminKey", "");
                this.setSignupMessageByKey("generalMemberApprovalMessage", "info", "General members can log in after administrator approval.");
                return;
            }
            this.setSignupMessageByKey("adminMemberSetupMessage", "info", "Admin members can continue initial setup when the admin key matches.");
            setTimeout(() => input?.focus(), 0);
        },

        hideTargetSelection() {
            this.targetSelectionRequired = false;
            const field = getContainerEl("#loginTargetDbField");
            const list = getContainerEl("#loginConnectionList");
            if (field) field.hidden = true;
            if (list) list.innerHTML = "";
        },

        showTargetSelection(connections) {
            const field = getContainerEl("#loginTargetDbField");
            const list = getContainerEl("#loginConnectionList");
            if (!field || !list) return;
            const rows = Array.isArray(connections) ? connections : [];
            const defaultRow = rows.find((row) => row.defaultYn === "Y") || rows[0];
            list.innerHTML = rows.map((row) => {
                const id = String(row.connectionId ?? "");
                const checked = String(defaultRow?.connectionId ?? "") === id ? " checked" : "";
                const name = row.connectionName || "(Unnamed connection)";
                const scope = row.connectionScope === "SHARED"
                    ? this.t("sharedConnection", "Shared")
                    : this.t("privateConnection", "Private");
                const meta = [scope, row.dbType, row.defaultYn === "Y" ? this.t("defaultConnection", "Default") : ""].filter(Boolean).join(" / ");
                return `
                    <label class="login-target-db-option">
                        <input type="radio" name="loginConnectionId" value="${this.escapeHtml(id)}"${checked}>
                        <span>
                            <strong>${this.escapeHtml(name)}</strong>
                            ${meta ? `<small>${this.escapeHtml(meta)}</small>` : ""}
                        </span>
                    </label>
                `;
            }).join("");
            field.hidden = false;
            this.targetSelectionRequired = true;
        },

        async login() {
            if (this.isLoggingIn) return;
            const payload = {
                loginId: this.getValue("#loginId").trim(),
                loginPassword: this.getValue("#loginPassword")
            };
            const selectedConnectionId = this.getSelectedConnectionId();
            const selectedConnectionName = this.getSelectedConnectionName();
            if (this.targetSelectionRequired) {
                payload.connectionId = selectedConnectionId;
                if (!payload.connectionId) {
                    this.setMessageByKey("selectTargetDb", "error", "Select a target DB.");
                    return;
                }
            }
            if (!payload.loginId || !payload.loginPassword) {
                this.setMessageByKey("loginRequired", "error", "Login ID and password are required.");
                return;
            }
            this.setMessageByKey("loggingIn", "info", "Logging in...");
            this.setLoginBusy(true);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M91001/login`, {
                    method: "POST",
                    body: payload
                });

                const responseConnections = Array.isArray(json.connections) ? json.connections : [];
                if (json.targetSelectionRequired) {
                    if (responseConnections.length === 1) {
                        payload.connectionId = responseConnections[0].connectionId;
                    } else {
                        this.showTargetSelection(responseConnections);
                        const translated = this.translateServerMessage(json.message, "selectTargetThenLoginAgain");
                        this.messageKey = translated.key;
                        this.setMessage(translated.text);
                        this.setLoginBusy(false);
                        this.focusLoginButton();
                        setTimeout(() => this.focusLoginButton(), 100);
                        return;
                    }
                }

                if (payload.connectionId && json.targetSelectionRequired && responseConnections.length === 1) {
                    const retryJson = await CommonUtils.request(`${API_BASE_URL}/M91001/login`, {
                        method: "POST",
                        body: payload
                    });
                    Object.assign(json, retryJson || {});
                    if (json.targetSelectionRequired) {
                        this.showTargetSelection(json.connections || responseConnections);
                        const translated = this.translateServerMessage(json.message, "selectTargetThenLoginAgain");
                        this.messageKey = translated.key;
                        this.setMessage(translated.text);
                        this.setLoginBusy(false);
                        this.focusLoginButton();
                        setTimeout(() => this.focusLoginButton(), 100);
                        return;
                    }
                }

                const connection = json.connection || null;
                const connectionId = connection?.connectionId || payload.connectionId || selectedConnectionId;
                const connectionName = connection?.connectionName || selectedConnectionName || "";

                if (!connectionId && !json.setupRequired) {
                    this.hideTargetSelection();
                    this.setMessageByKey("targetDbAutoSelectFailed", "error", "Target DB could not be selected automatically. Login again after selecting a Target DB.");
                    return;
                }

                if (json.user) {
                    sessionStorage.setItem("initLoginUser", JSON.stringify(json.user || {}));
                    PageManager.extendSession?.();
                }

                this.setValue("#loginPassword", "");
                if (connectionId) {
                    sessionStorage.setItem("targetConnectionId", String(connectionId));
                    sessionStorage.setItem("targetConnectionName", connectionName);
                    this.hasConnections = true;
                } else {
                    sessionStorage.removeItem("targetConnectionId");
                    sessionStorage.removeItem("targetConnectionName");
                }
                if (connectionId && !json.setupRequired) {
                    await window.I18nManager?.loadLanguageFromUserSettings?.();
                } else {
                    await window.I18nManager?.applyLanguage?.("en");
                }
                if (window.MenuRenderer) MenuRenderer.render("mainNav", window.handleMenuClick);
                window.updateCurrentTargetDbSelect?.();
                if (json.setupRequired || !sessionStorage.getItem("targetConnectionId")) {
                    PageManager.load("M99001", "DB Connection Setup");
                    return;
                }
                await window.reloadShellDisplaySettings?.();
                PageManager.load("home", window.getShellHomeTitle?.() || "Data Editing System");
            } catch (error) {
                const translated = this.translateServerMessage(error.message, "loginFailed");
                this.messageKey = translated.key;
                this.setMessage(translated.text, "error");
            } finally {
                this.setLoginBusy(false);
            }
        },

        openSignup() {
            this.setValue("#signupLoginId", "");
            this.setValue("#signupUserName", "");
            this.setValue("#signupEmail", "");
            this.setValue("#signupPassword", "");
            this.setValue("#signupPasswordConfirm", "");
            this.setValue("#signupRole", "USER");
            this.setValue("#signupAdminKey", "");
            const adminKeyField = getContainerEl("#signupAdminKeyField");
            if (adminKeyField) adminKeyField.hidden = true;
            const adminKeyInput = getContainerEl("#signupAdminKey");
            if (adminKeyInput) {
                adminKeyInput.disabled = true;
                adminKeyInput.required = false;
            }
            const layer = getContainerEl("#signupLayer");
            if (layer) layer.hidden = false;
            this.setSignupMessageByKey("signupGuide", "info", "Enter signup information. Admin members need an admin key.");
            setTimeout(() => getContainerEl("#signupLoginId")?.focus(), 0);
        },

        closeSignup() {
            const layer = getContainerEl("#signupLayer");
            if (layer) layer.hidden = true;
        },

        async openPasswordHelp() {
            const layer = getContainerEl("#passwordHelpLayer");
            if (layer) layer.hidden = false;
            this.setValue("#passwordHelpAdminName", this.t("loading", "Loading..."));
            this.setValue("#passwordHelpAdminEmail", "");
            this.setValue("#passwordHelpAdminPhone", "");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M91001/admin-contact`, {
                    method: "GET",
                    showLoading: false
                });
                const contact = json.data || {};
                this.setValue("#passwordHelpAdminName", contact.name || this.t("systemAdministrator", "System administrator"));
                this.setValue("#passwordHelpAdminEmail", contact.email || "admin@example.com");
                this.setValue("#passwordHelpAdminPhone", contact.phone || "02-0000-0000");
            } catch (error) {
                this.setValue("#passwordHelpAdminName", this.t("systemAdministrator", "System administrator"));
                this.setValue("#passwordHelpAdminEmail", "admin@example.com");
                this.setValue("#passwordHelpAdminPhone", "02-0000-0000");
            }
            setTimeout(() => getContainerEl("#passwordHelpLayer .env-save")?.focus(), 0);
        },

        closePasswordHelp() {
            const layer = getContainerEl("#passwordHelpLayer");
            if (layer) layer.hidden = true;
            setTimeout(() => getContainerEl("#loginId")?.focus(), 0);
        },

        async saveSignup() {
            const password = this.getValue("#signupPassword");
            const passwordConfirm = this.getValue("#signupPasswordConfirm");
            const signupRole = String(this.getValue("#signupRole") || "USER").toUpperCase();
            const payload = {
                loginId: this.getValue("#signupLoginId").trim(),
                userName: this.getValue("#signupUserName").trim(),
                email: this.getValue("#signupEmail").trim(),
                loginPassword: password,
                signupRole,
                adminKey: signupRole === "ADMIN" ? this.getValue("#signupAdminKey") : ""
            };
            if (!payload.loginId || !payload.userName) {
                this.setSignupMessageByKey("loginIdUserNameRequired", "error", "Login ID and User Name are required.");
                return;
            }
            if (!payload.email) {
                this.setSignupMessageByKey("emailRequired", "error", "Email is required.");
                getContainerEl("#signupEmail")?.focus();
                return;
            }
            if (!this.isValidEmail(payload.email)) {
                this.setSignupMessageByKey("validEmailRequired", "error", "Enter a valid email address.");
                getContainerEl("#signupEmail")?.focus();
                return;
            }
            if (!password) {
                this.setSignupMessageByKey("loginPasswordRequired", "error", "Login Password is required.");
                return;
            }
            if (password !== passwordConfirm) {
                this.setSignupMessageByKey("passwordConfirmMismatch", "error", "Password confirmation does not match.");
                return;
            }
            if (!["USER", "ADMIN"].includes(signupRole)) {
                this.setSignupMessageByKey("validMemberTypeRequired", "error", "Select a valid member type.");
                return;
            }
            if (signupRole === "ADMIN" && !payload.adminKey) {
                this.setSignupMessageByKey("adminKeyRequired", "error", "Admin key is required.");
                getContainerEl("#signupAdminKey")?.focus();
                return;
            }
            this.setSignupMessageByKey("savingSignup", "info", "Saving signup...");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M91001/signup/save`, {
                    method: "POST",
                    body: payload
                });
                if (json.bootstrapRequired && json.bootstrapToken) {
                    sessionStorage.setItem("initBootstrapToken", json.bootstrapToken);
                    sessionStorage.setItem("initBootstrapAdminLoginId", json.loginId || payload.loginId);
                    const message = json.message || this.t("adminKeyVerified", "Admin key verified. Moving to initial setup.");
                    this.signupMessageKey = json.message ? "" : "adminKeyVerified";
                    this.setSignupMessage(message);
                    this.messageKey = json.message ? "" : "adminKeyVerified";
                    this.setMessage(message);
                    this.setValue("#signupPassword", "");
                    this.setValue("#signupPasswordConfirm", "");
                    this.setValue("#signupAdminKey", "");
                    this.closeSignup();
                    await PageManager.load("M99001", "Initial System Setup", true);
                    return;
                }
                const message = json.message || this.t("signupSubmitted", "Signup request submitted. You can log in after administrator approval.");
                this.signupMessageKey = json.message ? "" : "signupSubmitted";
                this.setSignupMessage(message);
                this.messageKey = json.message ? "" : "signupSubmitted";
                this.setMessage(message);
                this.setValue("#loginId", "");
                this.setValue("#loginPassword", "");
                this.setValue("#signupPassword", "");
                this.setValue("#signupPasswordConfirm", "");
                this.setValue("#signupAdminKey", "");
                this.closeSignup();
            } catch (error) {
                const translated = this.translateServerMessage(error.message, "signupFailed");
                this.signupMessageKey = translated.key;
                this.setSignupMessage(translated.text, "error");
            }
        }
    };

    window[PAGE_CODE] = login;
})();
