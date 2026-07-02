(function() {
    const PAGE_CODE = "login";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const login = {
        hasConnections: false,
        targetSelectionRequired: false,
        isLoggingIn: false,

        async init() {
            document.body.classList.add("intro-mode");
            this.resetLoginForm();
        },

        destroy() {},

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

        setSignupMessage(message, type = "info") {
            const el = getContainerEl("#signupMessage");
            if (!el) return;
            el.textContent = message || "";
            el.className = type === "error" ? "intro-step-msg is-error" : "intro-step-msg";
        },

        setLoginBusy(isBusy) {
            this.isLoggingIn = Boolean(isBusy);
            const button = getContainerEl("#loginSubmitButton");
            if (button) {
                button.disabled = this.isLoggingIn;
                button.textContent = this.isLoggingIn ? "Logging in..." : "Login";
            }
            getContainerEl("#loginId")?.toggleAttribute("disabled", this.isLoggingIn);
            getContainerEl("#loginPassword")?.toggleAttribute("disabled", this.isLoggingIn);
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
            this.hideTargetSelection();
            const notice = sessionStorage.getItem("loginNotice") || "";
            if (notice) {
                sessionStorage.removeItem("loginNotice");
                this.setMessage(notice);
            } else {
                this.setMessage("Enter your saved ID and password.");
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
                this.setSignupMessage("일반 회원은 관리자 승인 후 로그인할 수 있습니다.");
                return;
            }
            this.setSignupMessage("관리자 회원은 관리자 인증키가 일치하면 초기 설정을 진행할 수 있습니다.");
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
                const scope = row.connectionScope === "SHARED" ? "공통" : "개인";
                const meta = [scope, row.dbType, row.defaultYn === "Y" ? "Default" : ""].filter(Boolean).join(" / ");
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
                    this.setMessage("Select a target DB.", "error");
                    return;
                }
            }
            if (!payload.loginId || !payload.loginPassword) {
                this.setMessage("Login ID and password are required.", "error");
                return;
            }
            this.setMessage("Logging in...");
            this.setLoginBusy(true);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M91001/login`, {
                    method: "POST",
                    body: payload
                });

                if (json.targetSelectionRequired) {
                    this.showTargetSelection(json.connections || []);
                    this.setMessage(json.message || "Select a target DB, then click Login again.");
                    this.setLoginBusy(false);
                    this.focusLoginButton();
                    setTimeout(() => this.focusLoginButton(), 100);
                    return;
                }

                if (json.user) {
                    sessionStorage.setItem("initLoginUser", JSON.stringify(json.user || {}));
                    PageManager.extendSession?.();
                }

                this.setValue("#loginPassword", "");
                if (window.MenuRenderer) MenuRenderer.render("mainNav", window.handleMenuClick);
                const connectionId = json.connection?.connectionId || payload.connectionId || selectedConnectionId;
                const connectionName = json.connection?.connectionName || selectedConnectionName || "";
                if (connectionId) {
                    sessionStorage.setItem("targetConnectionId", String(connectionId));
                    sessionStorage.setItem("targetConnectionName", connectionName);
                    this.hasConnections = true;
                } else {
                    sessionStorage.removeItem("targetConnectionId");
                    sessionStorage.removeItem("targetConnectionName");
                }
                window.updateCurrentTargetDbSelect?.();
                if (json.setupRequired || !sessionStorage.getItem("targetConnectionId")) {
                    PageManager.load("M99001", "DB Connection Setup");
                    return;
                }
                await window.reloadShellDisplaySettings?.();
                PageManager.load("home", window.getShellHomeTitle?.() || "Data Editing System");
            } catch (error) {
                this.setMessage(error.message || "Login failed.", "error");
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
            this.setSignupMessage("회원가입 정보를 입력하세요. 관리자 회원은 관리자 인증키가 필요합니다.");
            setTimeout(() => getContainerEl("#signupLoginId")?.focus(), 0);
        },

        closeSignup() {
            const layer = getContainerEl("#signupLayer");
            if (layer) layer.hidden = true;
        },

        async openPasswordHelp() {
            const layer = getContainerEl("#passwordHelpLayer");
            if (layer) layer.hidden = false;
            this.setValue("#passwordHelpAdminName", "Loading...");
            this.setValue("#passwordHelpAdminEmail", "");
            this.setValue("#passwordHelpAdminPhone", "");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M91001/admin-contact`, {
                    method: "GET",
                    showLoading: false
                });
                const contact = json.data || {};
                this.setValue("#passwordHelpAdminName", contact.name || "시스템 운영자");
                this.setValue("#passwordHelpAdminEmail", contact.email || "admin@example.com");
                this.setValue("#passwordHelpAdminPhone", contact.phone || "02-0000-0000");
            } catch (error) {
                this.setValue("#passwordHelpAdminName", "시스템 운영자");
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
                this.setSignupMessage("Login ID and User Name are required.", "error");
                return;
            }
            if (!payload.email) {
                this.setSignupMessage("Email is required.", "error");
                getContainerEl("#signupEmail")?.focus();
                return;
            }
            if (!this.isValidEmail(payload.email)) {
                this.setSignupMessage("Enter a valid email address.", "error");
                getContainerEl("#signupEmail")?.focus();
                return;
            }
            if (!password) {
                this.setSignupMessage("Login Password is required.", "error");
                return;
            }
            if (password !== passwordConfirm) {
                this.setSignupMessage("Password confirmation does not match.", "error");
                return;
            }
            if (!["USER", "ADMIN"].includes(signupRole)) {
                this.setSignupMessage("Select a valid member type.", "error");
                return;
            }
            if (signupRole === "ADMIN" && !payload.adminKey) {
                this.setSignupMessage("관리자 인증키를 입력해 주세요.", "error");
                getContainerEl("#signupAdminKey")?.focus();
                return;
            }
            this.setSignupMessage("Saving signup...");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M91001/signup/save`, {
                    method: "POST",
                    body: payload
                });
                if (json.bootstrapRequired && json.bootstrapToken) {
                    sessionStorage.setItem("initBootstrapToken", json.bootstrapToken);
                    sessionStorage.setItem("initBootstrapAdminLoginId", json.loginId || payload.loginId);
                    this.setSignupMessage(json.message || "관리자 인증키가 확인되었습니다. 초기 설정 화면으로 이동합니다.");
                    this.setMessage(json.message || "관리자 인증키가 확인되었습니다. 초기 설정 화면으로 이동합니다.");
                    this.setValue("#signupPassword", "");
                    this.setValue("#signupPasswordConfirm", "");
                    this.setValue("#signupAdminKey", "");
                    this.closeSignup();
                    await PageManager.load("M99001", "Initial System Setup", true);
                    return;
                }
                const message = json.message || "회원가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.";
                this.setSignupMessage(message);
                this.setMessage(message);
                this.setValue("#loginId", "");
                this.setValue("#loginPassword", "");
                this.setValue("#signupPassword", "");
                this.setValue("#signupPasswordConfirm", "");
                this.setValue("#signupAdminKey", "");
                this.closeSignup();
            } catch (error) {
                this.setSignupMessage(error.message || "Signup failed.", "error");
            }
        }
    };

    window[PAGE_CODE] = login;
})();
