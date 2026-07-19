const API_BASE_URL = "/api";
const FETCH_TIMEOUT = 10000; // fetch 요청 타임아웃 기본값(ms)
const LOADING_DELAY_MS = 300; // 로딩 표시 지연 시간(ms)
const APP_VERSION = window.APP_CACHE_VERSION || "0.0.0"; // Asset cache version.
const DEFAULT_PAGE_CODE = "login";
const DEFAULT_PAGE_TITLE = "Data Editing System Login";
const SHELL_HIDDEN_PAGES = ["login"];
const PUBLIC_PAGES = ["login"];
const SESSION_TIMEOUT_FALLBACK_MS = 60 * 60 * 1000;
const SESSION_EXPIRES_AT_KEY = "initLoginExpiresAt";
const SESSION_TTL_SECONDS_KEY = "initLoginTtlSeconds";
const CURRENT_PAGE_KEY = "initCurrentPage";
const CURRENT_PAGE_TITLE_KEY = "initCurrentPageTitle";
// const API_BASE_URL = "http://127.0.0.1:8000/api";

const PageManager = {
    modules: {}, // Loaded page modules cache.
    containers: {}, // Open page containers.
    pageLoadPromises: new Map(), // Coalesce concurrent load/refresh requests per page.
    pageLoadModes: new Map(), // Distinguish normal activation from an explicit refresh.
    pageLifecycleVersions: new Map(), // Invalidate async work after a page is closed.
    readyPages: new Set(), // Containers whose HTML/script/init lifecycle completed.
    navigationRequestId: 0, // Monotonic menu activation request id.
    navigationEpoch: 0, // Changes only when the requested page changes.
    requestedPageCode: "",
    activePageCode: "",
    hiddenPages: new Set(),
    navigationLoadingPageCode: "",
    navigationLoadingRequestId: 0,
    lastLoadedVersion: null, // Last loaded asset version.
    dataWorkTemplatePages: ['M03001', 'M03002', 'M03003', 'M03004'],
    flowWorkTemplatePages: ['M04001'],
    anlyWorkTemplatePages: ['M04002'],
    sessionTimerId: null,
    isSessionExpiredHandling: false,

    getAssetUrl(path) {
        if (typeof window.APP_ASSET_URL === "function") {
            return window.APP_ASSET_URL(path);
        }
        const separator = String(path).includes("?") ? "&" : "?";
        return `${path}${separator}v=${encodeURIComponent(APP_VERSION)}`;
    },

    createHelper(pageCode) {
        return {
            getEl: (id) => document.getElementById(`${id}-${pageCode}`),
            getContainerEl: (selector) => {
                const container = document.getElementById(`container-${pageCode}`);
                return container ? container.querySelector(selector) : null;
            }
        };
    },

    isAuthenticated() {
        return Boolean(sessionStorage.getItem("initLoginUser"));
    },

    isBootstrapAuthenticated() {
        return Boolean(sessionStorage.getItem("initBootstrapToken"));
    },

    requiresAuth(pageCode) {
        if (PUBLIC_PAGES.includes(pageCode)) return false;
        if (pageCode === "M99001" && this.isBootstrapAuthenticated()) return false;
        return true;
    },

    getLoginUser() {
        try {
            return JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
        } catch (error) {
            return {};
        }
    },

    getRoleCode() {
        const user = this.getLoginUser();
        return String(user.roleCode || user.ROLE_CODE || user.role || "").toUpperCase();
    },

    isPageAllowed(pageCode) {
        if (!pageCode || pageCode === DEFAULT_PAGE_CODE || pageCode === "home") return true;
        if (pageCode === "M99001" && this.isBootstrapAuthenticated()) return true;
        const menu = window.MENU_PAGE_MAP?.[pageCode];
        if (!menu) return true;
        if (menu.enabled === false) return false;
        const roles = menu.roles || menu.allowedRoles || menu.roleCodes;
        if (!Array.isArray(roles) || roles.length === 0) return true;
        return roles.map((role) => String(role).toUpperCase()).includes(this.getRoleCode());
    },

    getSessionTimeoutMs() {
        const ttlSeconds = Number(sessionStorage.getItem(SESSION_TTL_SECONDS_KEY) || "0");
        return ttlSeconds > 0 ? ttlSeconds * 1000 : SESSION_TIMEOUT_FALLBACK_MS;
    },

    setSessionTtlSeconds(ttlSeconds) {
        const parsed = Number(ttlSeconds);
        if (Number.isFinite(parsed) && parsed > 0) {
            sessionStorage.setItem(SESSION_TTL_SECONDS_KEY, String(Math.floor(parsed)));
        }
    },

    extendSession(ttlSeconds) {
        if (!this.isAuthenticated()) return;
        this.setSessionTtlSeconds(ttlSeconds);
        sessionStorage.setItem(SESSION_EXPIRES_AT_KEY, String(Date.now() + this.getSessionTimeoutMs()));
        this.updateSessionStatus();
    },

    extendSessionFromResponse(response) {
        const ttlSeconds = response?.headers?.get?.("X-INIT-Session-TTL-Seconds");
        this.extendSession(ttlSeconds);
    },

    clearLoginSession() {
        sessionStorage.removeItem("initLoginUser");
        sessionStorage.removeItem("targetConnectionId");
        sessionStorage.removeItem("targetConnectionName");
        sessionStorage.removeItem("initRuntimeSettings");
        sessionStorage.removeItem("initBootstrapToken");
        sessionStorage.removeItem("initBootstrapAdminLoginId");
        sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
        sessionStorage.removeItem(SESSION_TTL_SECONDS_KEY);
        sessionStorage.removeItem(CURRENT_PAGE_KEY);
        sessionStorage.removeItem(CURRENT_PAGE_TITLE_KEY);
        window.I18nManager?.clearSessionLanguage?.();
        updateCurrentTargetDbSelect?.();
        this.updateSessionStatus();
    },

    startSessionTimer() {
        if (this.sessionTimerId) clearInterval(this.sessionTimerId);
        this.sessionTimerId = setInterval(() => this.updateSessionStatus(), 1000);
        this.updateSessionStatus();
    },

    updateSessionStatus() {
        const boxEl = document.getElementById("sessionStatusBox");
        const userEl = document.getElementById("sessionUserName");
        const roleEl = document.getElementById("sessionUserRole");
        const statusEl = document.getElementById("sessionRemainTime") || document.getElementById("sessionStatusText");
        if (!statusEl) return;
        if (!this.isAuthenticated()) {
            statusEl.textContent = "";
            if (roleEl) {
                roleEl.textContent = "";
                roleEl.className = "header-session-role";
                roleEl.removeAttribute("title");
            }
            if (boxEl) boxEl.hidden = true;
            return;
        }

        if (boxEl) boxEl.hidden = false;
        const user = this.getLoginUser();
        if (userEl) {
            userEl.textContent = user.userName || user.USER_NAME || user.loginId || user.LOGIN_ID || "-";
        }
        if (roleEl) {
            const roleCode = String(user.roleCode || user.ROLE_CODE || user.role || "USER").toUpperCase();
            const isAdmin = roleCode === "ADMIN";
            roleEl.textContent = isAdmin
                ? (window.I18nManager?.t?.("roles.admin", "Admin") || "Admin")
                : (window.I18nManager?.t?.("roles.user", "User") || "User");
            roleEl.className = `header-session-role ${isAdmin ? "is-admin" : "is-user"}`;
            roleEl.title = `Role: ${roleCode}`;
        }

        const expiresAt = Number(sessionStorage.getItem(SESSION_EXPIRES_AT_KEY) || "0");
        if (!expiresAt) {
            this.extendSession();
            return;
        }

        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
            statusEl.textContent = "Expired";
            this.handleSessionExpired();
            return;
        }

        statusEl.textContent = this.formatRemainingTime(remainingMs);
    },

    formatRemainingTime(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        return `${minutes}:${seconds}`;
    },

    async handleSessionExpired() {
        if (this.isSessionExpiredHandling) return;
        this.isSessionExpiredHandling = true;
        try {
            await this.cleanupCurrentTargetConnection("session expired");
        } catch (error) {
            console.warn("[System] Session cleanup failed.", error);
        } finally {
            alert("Session expired. Please log in again.");
            await this.revokeLoginSession();
            this.resetWorkspaceForLogout();
            await this.load(DEFAULT_PAGE_CODE, DEFAULT_PAGE_TITLE, false);
            this.isSessionExpiredHandling = false;
        }
    },

    manualExtendSession() {
        if (!this.isAuthenticated()) {
            alert("Please log in first.");
            return;
        }
        this.extendSession();
    },

    async validateServerSession() {
        if (!this.isAuthenticated()) return false;
        try {
            const response = await fetch(`${API_BASE_URL}/M91001/session/me`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
                credentials: "include"
            });
            if (!response.ok) {
                this.resetWorkspaceForLogout();
                return false;
            }
            const json = await response.json().catch(() => ({}));
            if (json.user) {
                sessionStorage.setItem("initLoginUser", JSON.stringify(json.user));
                CommonUtils.setRuntimeSettings(json.runtimeSettings);
                this.extendSession(json.sessionTtlSeconds || response.headers.get("X-INIT-Session-TTL-Seconds"));
            }
            return true;
        } catch (error) {
            console.warn("[System] Session validation failed.", error);
            this.resetWorkspaceForLogout();
            return false;
        }
    },

    rememberCurrentPage(pageCode, title) {
        if (!this.requiresAuth(pageCode) || pageCode === DEFAULT_PAGE_CODE) return;
        sessionStorage.setItem(CURRENT_PAGE_KEY, pageCode);
        if (title) sessionStorage.setItem(CURRENT_PAGE_TITLE_KEY, title);
    },

    beginNavigation(pageCode) {
        const normalizedPageCode = String(pageCode || "");
        if (this.requestedPageCode !== normalizedPageCode) {
            this.navigationEpoch += 1;
        }
        this.requestedPageCode = normalizedPageCode;
        this.navigationRequestId += 1;
        return {
            id: this.navigationRequestId,
            epoch: this.navigationEpoch,
            pageCode: normalizedPageCode
        };
    },

    isCurrentNavigation(navigation) {
        return Boolean(
            navigation
            && navigation.id === this.navigationRequestId
            && navigation.pageCode === this.requestedPageCode
        );
    },

    waitForNextPaint() {
        return new Promise((resolve) => {
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(() => resolve());
                });
                return;
            }
            setTimeout(resolve, 0);
        });
    },

    getPageLifecycleVersion(pageCode) {
        return this.pageLifecycleVersions.get(String(pageCode || "")) || 0;
    },

    invalidatePageLifecycle(pageCode) {
        const normalizedPageCode = String(pageCode || "");
        const nextVersion = this.getPageLifecycleVersion(normalizedPageCode) + 1;
        this.pageLifecycleVersions.set(normalizedPageCode, nextVersion);
        this.readyPages.delete(normalizedPageCode);
        return nextVersion;
    },

    isPageLifecycleCurrent(pageCode, version, container = null) {
        const normalizedPageCode = String(pageCode || "");
        if (this.getPageLifecycleVersion(normalizedPageCode) !== version) return false;
        if (container && this.containers[normalizedPageCode] !== container) return false;
        return true;
    },

    cleanupModuleAfterStaleAsync(pageCode, module) {
        if (!module || typeof module.destroy !== 'function') return;
        try {
            module.destroy();
        } catch (error) {
            console.warn(`[System] ${pageCode} post-async destroy failed.`, error);
        }
    },

    discardStalePageLoad(pageCode, container = null, module = null) {
        this.cleanupModuleAfterStaleAsync(pageCode, module);
        this.readyPages.delete(pageCode);
        if (container && this.containers[pageCode] === container) {
            window.I18nManager?.releasePageRoot?.(container);
            container.replaceChildren();
            container.remove();
            delete this.containers[pageCode];
        }
        if (!this.containers[pageCode]) {
            delete this.modules[pageCode];
            if (window[pageCode]) delete window[pageCode];
            const scriptTag = document.querySelector(`script[src*="${pageCode}.js"]`);
            if (scriptTag) scriptTag.remove();
        }
    },

    showNavigationLoading(navigation, message = "", detail = "") {
        if (!navigation) return;
        this.navigationLoadingPageCode = String(navigation.pageCode || "");
        this.navigationLoadingRequestId = Number(navigation.id || 0);
        CommonUI.showLoading(message, detail);
    },

    hideNavigationLoading(navigation = null) {
        if (!this.navigationLoadingPageCode) return;
        if (navigation && (
            this.navigationLoadingPageCode !== String(navigation.pageCode || "")
            || this.navigationLoadingRequestId !== Number(navigation.id || 0)
        )) return;
        this.navigationLoadingPageCode = "";
        this.navigationLoadingRequestId = 0;
        CommonUI.hideLoading();
    },

    markOpenPageVisited(pageCode) {
        window.MenuRenderer?.visitedPages?.add?.(pageCode);
        if (this.activePageCode) window.MenuRenderer?.markActivePage?.(this.activePageCode);
    },

    updateVisiblePageIdentity(pageCode, title, navigation) {
        if (!this.isCurrentNavigation(navigation)) return false;
        const displayTitle = this.formatPageTitle(pageCode, title);
        if (displayTitle) window.updateShellPageHeader?.(pageCode, displayTitle);
        this.rememberCurrentPage(pageCode, displayTitle);
        return true;
    },

    getCloseFallbackPage() {
        return { pageCode: "home", title: window.getShellHomeTitle?.() || "Data Editing System" };
    },

    async runPageBeforeCloseHooks(pageCodes, context = {}) {
        for (const pageCode of pageCodes) {
            const module = window[pageCode] || this.modules[pageCode];
            if (!module || typeof module.beforeClose !== "function") continue;
            const result = await module.beforeClose({
                reason: String(context.reason || ""),
                cleanupTargetConnection: context.cleanupTargetConnection === true,
                preserveServerWork: context.preserveServerWork !== false
            });
            if (result === false) return false;
        }
        return true;
    },

    buildTransitionWarning(actionText, options = {}) {
        const cleanupTargetConnection = options.cleanupTargetConnection === true;
        const activeRequests = CommonUtils.getActiveRequestCount?.() || 0;
        const actionKeys = {
            logout: "messagePatterns.actions.logout",
            "change Target DB": "messagePatterns.actions.changeTargetDb",
            "change target DB": "messagePatterns.actions.changeTargetDb",
            "close current page": "messagePatterns.actions.closeThisPage",
            "close other pages": "messagePatterns.actions.closeOtherPages",
            "close all pages": "messagePatterns.actions.closeAllPages"
        };
        const action = window.I18nManager?.t?.(actionKeys[actionText], actionText) || actionText;
        const requestWarning = cleanupTargetConnection && activeRequests > 0
            ? (window.I18nManager?.t?.(
                "messagePatterns.pendingRequests",
                "There are {count} request(s) still running. The app will wait briefly before cleanup."
            ) || "There are {count} request(s) still running. The app will wait briefly before cleanup.")
                .replace("{count}", String(activeRequests))
            : "";
        const templateKey = cleanupTargetConnection
            ? "messagePatterns.transitionWarning"
            : "messagePatterns.transitionWarningWithoutTarget";
        const fallback = cleanupTargetConnection
            ? "You are about to {action}.\n\nSelected pages will be closed and unsaved work may be lost.\nAny open target DB session will be rolled back and closed before continuing.{requestWarningBlock}\n\nContinue?"
            : "You are about to {action}.\n\nSelected pages will be closed and unsaved work may be lost.{requestWarningBlock}\n\nContinue?";
        const template = window.I18nManager?.t?.(templateKey, fallback) || fallback;
        return template
            .replace("{action}", action)
            .replace("{requestWarningBlock}", requestWarning ? `\n\n${requestWarning}` : "");
    },

    async cleanupCurrentTargetConnection(reason = "") {
        const connectionId = sessionStorage.getItem("targetConnectionId") || "";
        if (!connectionId || !this.isAuthenticated()) return true;
        const headers = { "Content-Type": "application/json" };
        if (connectionId) headers["X-Target-Connection-Id"] = connectionId;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        let response;
        try {
            response = await fetch(`${API_BASE_URL}/M91001/session/cleanup`, {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ connectionId, reason }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }
        if (response.status === 401 || response.status === 403) {
            console.warn("[System] Target cleanup skipped because the login session is already invalid.");
            return true;
        }
        if (!response.ok) {
            const errorJson = await response.json().catch(() => ({}));
            throw new Error(CommonUtils.formatErrorMessage?.(errorJson, { status: response.status }) || "Target DB cleanup failed.");
        }
        const json = await response.json().catch(() => ({}));
        return json?.status === "success";
    },

    async revokeLoginSession() {
        try {
            await fetch(`${API_BASE_URL}/M91001/logout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include"
            });
        } catch (error) {
            console.warn("[System] Logout session revoke failed.", error);
        }
    },

    async confirmAndCleanupBeforeClose(pageCodes = [], actionText = "continue", options = {}) {
        // Closing an SPA page only releases browser resources. Target DB session
        // cleanup belongs to logout / Target DB changes and must be explicit.
        const cleanupTargetConnection = options.cleanupTargetConnection === true;
        if (!(await CommonMessage.confirm(this.buildTransitionWarning(actionText, { cleanupTargetConnection })))) return false;

        const canClose = await this.runPageBeforeCloseHooks(pageCodes, {
            reason: actionText,
            cleanupTargetConnection,
            preserveServerWork: true
        });
        if (!canClose) return false;

        if (cleanupTargetConnection && CommonUtils.waitForIdle) {
            const isIdle = await CommonUtils.waitForIdle(15000);
            if (!isIdle && !(await CommonMessage.confirm("Some requests are still running. Continue cleanup anyway?"))) {
                return false;
            }
        }

        if (cleanupTargetConnection) {
            try {
                await this.cleanupCurrentTargetConnection(actionText);
            } catch (error) {
                console.warn("[System] Target cleanup failed.", error);
                if (String(actionText || "").toLowerCase() !== "logout") {
                    const proceed = await CommonMessage.confirm("Target DB cleanup failed. Continue anyway?");
                    if (!proceed) return false;
                }
            }
        }
        return true;
    },

    formatPageTitle(pageCode, title) {
        const menu = window.MENU_PAGE_MAP?.[pageCode];
        const baseTitle = title || menu?.title || menu?.label || pageCode;
        if (!pageCode || pageCode === DEFAULT_PAGE_CODE || pageCode === "home") return baseTitle;
        if (String(baseTitle).includes(`[${pageCode}]`)) return baseTitle;
        return `${baseTitle} [${pageCode}]`;
    },

    async notifyPageHidden(nextPageCode = "") {
        const currentPageCode = String(this.activePageCode || "");
        if (!currentPageCode || currentPageCode === String(nextPageCode || "")) return;
        if (this.hiddenPages.has(currentPageCode)) return;

        this.hiddenPages.add(currentPageCode);
        const currentModule = window[currentPageCode] || this.modules[currentPageCode];
        if (!currentModule || typeof currentModule.onHide !== "function") return;
        try {
            await currentModule.onHide({ nextPageCode: String(nextPageCode || "") });
        } catch (error) {
            console.warn(`[System] ${currentPageCode} onHide failed.`, error);
        }
    },

    show(pageCode) {
        const setupWithoutTarget = pageCode === "M99001"
            && ((this.isAuthenticated() && !sessionStorage.getItem("targetConnectionId")) || this.isBootstrapAuthenticated());
        document.body.classList.toggle("intro-mode", SHELL_HIDDEN_PAGES.includes(pageCode) || setupWithoutTarget);

        const targetContainer = this.containers[pageCode];
        if (!targetContainer) return false;

        const activeContainer = this.activePageCode
            ? this.containers[this.activePageCode]
            : document.querySelector(".page-section.active");
        const isAlreadyActive = activeContainer === targetContainer
            && targetContainer.classList.contains("active")
            && targetContainer.style.display !== "none";

        if (isAlreadyActive) {
            this.activePageCode = pageCode;
            return false;
        }

        document.querySelectorAll(".page-section.active").forEach((section) => {
            if (section === targetContainer) return;
            section.classList.remove("active");
            section.style.display = "none";
        });

        targetContainer.classList.add("active");
        targetContainer.style.display = "block";
        this.activePageCode = pageCode;
        window.MenuRenderer?.markActivePage?.(pageCode);
        return true;
    },

    closeAll() {
        const openPages = Array.from(new Set([
            ...Object.keys(this.containers),
            ...this.pageLoadPromises.keys()
        ])).filter((pageCode) => pageCode !== DEFAULT_PAGE_CODE);
        if (openPages.length === 0) {
            alert("There are no open pages.");
            return;
        }

        openPages.forEach((pageCode, index) => {
            this.close(pageCode, index === openPages.length - 1, {
                reason: "close all pages",
                preserveServerWork: true
            });
        });
        MenuRenderer?.collapseAll?.();
        LayoutManager?.collapseAllMenus?.();
    },

    getOtherOpenPageCodes(currentPageCode) {
        return Array.from(new Set([
            ...Object.keys(this.containers),
            ...this.pageLoadPromises.keys()
        ])).filter((pageCode) => (
            pageCode !== DEFAULT_PAGE_CODE && pageCode !== currentPageCode
        ));
    },

    closeOthers(currentPageCode) {
        const openPages = this.getOtherOpenPageCodes(currentPageCode);
        openPages.forEach((pageCode) => {
            this.close(pageCode, false, {
                reason: "close other pages",
                preserveServerWork: true
            });
        });
    },

    resetWorkspaceForLogout(keepLoginSession = false) {
        const lifecyclePages = new Set([
            ...Object.keys(this.containers),
            ...Object.keys(this.modules),
            ...this.pageLoadPromises.keys()
        ]);
        lifecyclePages.forEach((pageCode) => this.invalidatePageLifecycle(pageCode));
        Object.keys(this.containers).forEach((pageCode) => {
            this.close(pageCode, false, { invalidateLoad: false });
        });
        this.containers = {};
        this.modules = {};
        this.readyPages.clear();
        this.activePageCode = "";
        this.hiddenPages.clear();
        this.hideNavigationLoading();
        document.querySelectorAll("#pageContainerHolder .page-section").forEach((section) => {
            window.I18nManager?.releasePageRoot?.(section);
            section.remove();
        });
        document.querySelectorAll("#mainNav [data-page]").forEach((el) => {
            el.classList.remove("visited-menu", "menu-active", "bg-blue-700", "text-green-500");
        });
        window.MenuRenderer?.clearState?.();
        if (!keepLoginSession) {
            this.clearLoginSession();
        }
    },

    /**
     * Close one page and release its resources.
     */
    close(pageCode, moveToMain = true, options = {}) {
        if (pageCode === DEFAULT_PAGE_CODE) {
            console.log("[System] Closing all open pages.");
            return;
        }

        console.log(`[System] Closing ${pageCode}.`);
        if (options.invalidateLoad !== false) this.invalidatePageLifecycle(pageCode);
        else this.readyPages.delete(pageCode);

        const targetModule = window[pageCode] || this.modules[pageCode];
        // Closing an SPA page is a client-side lifecycle operation. It must never
        // imply cancellation of a request/job that the server has already accepted.
        // Page modules receive this context so they only release browser resources.
        const closeContext = {
            closing: true,
            reason: String(options.reason || "page close"),
            cleanupTargetConnection: options.cleanupTargetConnection === true,
            preserveServerWork: options.preserveServerWork !== false
        };
        if (!this.hiddenPages.has(pageCode) && targetModule && typeof targetModule.onHide === "function") {
            this.hiddenPages.add(pageCode);
            try {
                const result = targetModule.onHide(closeContext);
                result?.catch?.((error) => console.warn(`[System] ${pageCode} onHide failed.`, error));
            } catch (error) {
                console.warn(`[System] ${pageCode} onHide failed.`, error);
            }
        }
        if (targetModule && typeof targetModule.destroy === 'function') {
            try {
                targetModule.destroy(closeContext);
            } catch (error) {
                console.warn(`[System] ${pageCode} destroy failed.`, error);
            }
        }

        const container = document.getElementById(`page-section-${pageCode}`);
        if (container) {
            window.I18nManager?.releasePageRoot?.(container);
            container.innerHTML = '';
            container.remove();
        }
        delete this.containers[pageCode];
        this.hiddenPages.delete(pageCode);
        if (this.activePageCode === pageCode) this.activePageCode = "";

        const scriptTag = document.querySelector(`script[src*="${pageCode}.js"]`);
        if (scriptTag) scriptTag.remove();

        const closedMenu = document.querySelector(`#mainNav [data-page="${pageCode}"]`);
        if (closedMenu) {
            closedMenu.classList.remove('visited-menu', 'menu-active', 'bg-blue-700', 'text-green-500');
        }
        window.MenuRenderer?.visitedPages?.delete?.(pageCode);

        if (window[pageCode]) delete window[pageCode];
        delete this.modules[pageCode];

        if (moveToMain) {
            const fallback = this.getCloseFallbackPage();
            const defaultMenu = document.querySelector(`#mainNav [data-page="${fallback.pageCode}"]`);
            if (defaultMenu) {
                defaultMenu.click();
            } else {
                location.hash = '#';
                const titleEl = document.getElementById('contentTitle');
                if (titleEl) window.updateShellPageHeader?.(fallback.pageCode, fallback.title);

                document.querySelectorAll('#mainNav a, #mainNav button').forEach(el => {
                    el.classList.remove('menu-active', 'bg-blue-700');
                });
                this.load(fallback.pageCode, fallback.title);
            }
        }
    },

    /**
     * 페이지 HTML을 fetch하여 컨테이너에 주입합니다.
     * @param {string} pageCode - 페이지 코드
     * @returns {Promise<boolean>} HTML 로드 여부
     */
    async injectHtml(pageCode) {
        const container = this.containers[pageCode];
        if (!container) throw new Error(`Page container was not created: ${pageCode}`);

        if (!this.hasRegisteredPageFile(pageCode, 'html')) {
            container.innerHTML = this.createMissingPageHtml(pageCode, "not-registered");
            return false;
        }

        try {
            const isDataTemplate = this.dataWorkTemplatePages.includes(pageCode);
            const isFlowTemplate = this.flowWorkTemplatePages.includes(pageCode);
            const isAnlyTemplate = this.anlyWorkTemplatePages.includes(pageCode);
            const useCommonTemplate = isDataTemplate || isFlowTemplate || isAnlyTemplate;
            const htmlFileName = this.dataWorkTemplatePages.includes(pageCode)
                ? 'MCOM_DATA_WORK'
                : (this.flowWorkTemplatePages.includes(pageCode) ? 'MCOM_FLOW_WORK' : (isAnlyTemplate ? 'MCOM_ANLY_WORK' : pageCode));
            const htmlUrl = this.getAssetUrl(`./pages/${htmlFileName}.html`);
            const response = await fetch(htmlUrl);
            if (!response.ok) {
                container.innerHTML = this.createMissingPageHtml(pageCode, response.status === 404 ? "not-found" : "load-failed");
                return false;
            }

            const html = await response.text();
            container.innerHTML = useCommonTemplate
                ? html.split('__PAGE_CODE__').join(pageCode)
                : html;
            return true;
        } catch (error) {
            container.innerHTML = this.createMissingPageHtml(pageCode, "server-unavailable");
            return false;
        }
    },

    createMissingPageHtml(pageCode, reason = "not-found") {
        const t = (path, fallback) => window.I18nManager?.t?.(path, fallback) || fallback;
        const format = (text) => String(text || "").replace(/\{pageCode\}/g, pageCode);
        const messages = {
            "not-registered": {
                title: t("missingPage.notRegisteredTitle", "Page is not registered."),
                detail: format(t("missingPage.notRegisteredDetail", "{pageCode} is not connected in the menu settings."))
            },
            "not-found": {
                title: t("missingPage.notFoundTitle", "Page file was not found."),
                detail: format(t("missingPage.notFoundDetail", "Check the {pageCode}.html path or deployment status."))
            },
            "server-unavailable": {
                title: t("missingPage.serverUnavailableTitle", "The WAS server is not responding."),
                detail: t("missingPage.serverUnavailableDetail", "Check the server status or network connection.")
            },
            "load-failed": {
                title: t("missingPage.loadFailedTitle", "Page could not be loaded."),
                detail: t("missingPage.loadFailedDetail", "Try again later or check the server status.")
            }
        };
        const message = messages[reason] || messages["not-found"];
        return `
            <div id="container-${pageCode}" class="h-full min-h-[360px] flex items-center justify-center">
                <div class="text-center text-slate-500">
                    <div class="text-4xl mb-4 text-slate-300">
                        <i class="fas fa-file-circle-question"></i>
                    </div>
                    <div class="text-lg font-semibold text-slate-700">${message.title}</div>
                    <div class="mt-2 text-sm">${message.detail}</div>
                </div>
            </div>
        `;
    },

    hasRegisteredPageFile(pageCode, fileType) {
        const config = window.PAGE_FILE_CONFIG;
        if (!config) return true;

        const pageList = fileType === 'script' ? config.scriptPages : config.htmlPages;
        if (!Array.isArray(pageList)) return true;

        return pageList.includes(pageCode);
    },

    /**
     * 페이지별 스크립트를 동적으로 주입합니다.
     * @param {string} pageCode - 페이지 코드
     * @param {boolean} force - 기존 스크립트를 무시하고 다시 로드할지 여부
     */
    async injectScript(pageCode, force = false) {
        const isAnlyTemplate = this.anlyWorkTemplatePages.includes(pageCode);
        const scriptFileName = isAnlyTemplate ? 'MCOM_ANLY_WORK' : pageCode;

        const existingScript = document.querySelector(`script[src*="${scriptFileName}.js"]`);
        if (existingScript && (!force || isAnlyTemplate)) {
            if (isAnlyTemplate) this.ensureAnlyWorkPage(pageCode);
            return true;
        }

        if (!this.hasRegisteredPageFile(pageCode, 'script')) {
            return false;
        }

        const scriptSrc = this.getAssetUrl(`./js/${scriptFileName}.js`);

        try {
            const response = await fetch(scriptSrc, { method: 'HEAD' });
            if (!response.ok) {
                return false;
            }
        } catch (error) {
            return false;
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = scriptSrc;
            script.async = true;

            script.onload = () => {
                console.log(`[Script Loaded] ${scriptFileName}.js`);
                if (isAnlyTemplate) this.ensureAnlyWorkPage(pageCode);
                resolve(true);
            };

            script.onerror = () => {
                resolve(false);
            };

            document.body.appendChild(script);
        });
    },

    ensureAnlyWorkPage(pageCode) {
        if (window[pageCode]) return window[pageCode];
        if (window.MCOMMON && typeof window.MCOMMON.initAnlyWorkPage === 'function') {
            return window.MCOMMON.initAnlyWorkPage(pageCode);
        }
        return null;
    },

    async activateReadyPage(pageCode, title, navigation, options = {}) {
        const activationResult = {
            activationCompleted: false,
            activationEpoch: navigation?.epoch ?? -1,
            committed: false
        };
        const container = options.container || this.containers[pageCode];
        const lifecycleVersion = options.lifecycleVersion ?? this.getPageLifecycleVersion(pageCode);
        const isActivationCurrent = () => Boolean(
            this.isCurrentNavigation(navigation)
            && this.readyPages.has(pageCode)
            && this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)
        );
        if (!isActivationCurrent()) return activationResult;

        const switched = this.show(pageCode);
        this.updateVisiblePageIdentity(pageCode, title, navigation);
        if (switched || navigation.previewSwitched) {
            navigation.previewSwitched = false;
            await this.waitForNextPaint();
            if (!isActivationCurrent()) return activationResult;
        }

        const module = window[pageCode] || this.modules[pageCode];
        this.hiddenPages.delete(pageCode);
        if (options.reinitializeDefaultPage && pageCode === DEFAULT_PAGE_CODE && module && typeof module.init === 'function') {
            try {
                await module.init();
            } catch (error) {
                if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                    this.cleanupModuleAfterStaleAsync(pageCode, module);
                }
                throw error;
            }
            if (!isActivationCurrent()) {
                if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                    this.cleanupModuleAfterStaleAsync(pageCode, module);
                }
                return activationResult;
            }
        }
        if (options.runOnShow !== false && module && typeof module.onShow === 'function') {
            try {
                await module.onShow();
            } catch (error) {
                if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                    this.cleanupModuleAfterStaleAsync(pageCode, module);
                }
                throw error;
            }
        }
        activationResult.activationCompleted = true;
        if (!isActivationCurrent()) {
            if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                this.cleanupModuleAfterStaleAsync(pageCode, module);
            }
            return activationResult;
        }

        await window.I18nManager?.ensurePagePack?.(pageCode);
        if (!isActivationCurrent()) return activationResult;
        const pagePackApplied = window.I18nManager?.applyPagePack?.(pageCode, container);
        if (typeof window.I18nManager?.applyCommonPackForPage === 'function') {
            window.I18nManager.applyCommonPackForPage(container, window.I18nManager.commonPack || {}, pagePackApplied === true);
        } else {
            window.I18nManager?.applyCommonPack?.(window.I18nManager.commonPack || {});
        }
        window.I18nManager?.acceptPageRootState?.(container);
        this.updateVisiblePageIdentity(pageCode, title, navigation);
        activationResult.committed = true;
        return activationResult;
    },

    /**
     * 페이지를 로드하거나 이미 열린 페이지를 활성화합니다.
     * @param {string} pageCode - 페이지 코드
     * @param {string} title - 화면 제목
     * @param {boolean} isRefresh - 강제 새로고침 여부
     */
    async runPageLoadOperation(pageCode, title, isRefresh, navigation) {
        const mode = isRefresh ? "refresh" : "load";
        const loadPromise = Promise.resolve().then(() => this.loadPage(pageCode, title, isRefresh, navigation));
        this.pageLoadPromises.set(pageCode, loadPromise);
        this.pageLoadModes.set(pageCode, mode);
        try {
            return await loadPromise;
        } finally {
            if (this.pageLoadPromises.get(pageCode) === loadPromise) {
                this.pageLoadPromises.delete(pageCode);
                this.pageLoadModes.delete(pageCode);
            }
        }
    },

    async load(pageCode, title, isRefresh = false) {
        const loadKey = String(pageCode || "");
        const navigation = this.beginNavigation(loadKey);
        await this.notifyPageHidden(loadKey);
        if (!this.isCurrentNavigation(navigation)) return null;
        const existingPromise = this.pageLoadPromises.get(loadKey);
        const existingMode = this.pageLoadModes.get(loadKey) || "load";
        const canPreview = !isRefresh
            && this.readyPages.has(loadKey)
            && Boolean(this.containers[loadKey])
            && (!this.requiresAuth(loadKey) || this.isAuthenticated())
            && this.isPageAllowed(loadKey);

        if (canPreview) {
            navigation.previewSwitched = this.show(loadKey);
            this.updateVisiblePageIdentity(loadKey, title, navigation);
            if (existingPromise && existingMode === "refresh") this.showNavigationLoading(navigation);
            else this.hideNavigationLoading();
        } else {
            this.showNavigationLoading(navigation);
        }

        try {
            while (true) {
                const pendingPromise = this.pageLoadPromises.get(loadKey);
                if (pendingPromise) {
                    const pendingMode = this.pageLoadModes.get(loadKey) || "load";
                    const pendingResult = await pendingPromise;

                    // A refresh is an explicit rebuild request. Never downgrade it to
                    // the normal activation that happened to be in progress first.
                    if (isRefresh && pendingMode !== "refresh") continue;
                    if (!this.readyPages.has(loadKey) || !this.containers[loadKey]) {
                        if (!this.isCurrentNavigation(navigation)) return pendingResult;
                        continue;
                    }
                    if (!this.isCurrentNavigation(navigation)) return pendingResult;

                    const activationAlreadyHandled = Boolean(
                        pendingResult?.activationCompleted
                        && pendingResult.activationEpoch === navigation.epoch
                    );
                    return await this.activateReadyPage(loadKey, title, navigation, {
                        runOnShow: !activationAlreadyHandled && pendingResult?.suppressOnShow !== true
                    });
                }

                const result = await this.runPageLoadOperation(loadKey, title, isRefresh, navigation);
                if (!this.readyPages.has(loadKey) || !this.containers[loadKey]) {
                    if (!this.isCurrentNavigation(navigation)) return result;
                    continue;
                }
                return result;
            }
        } finally {
            this.hideNavigationLoading(navigation);
        }
    },

    async loadPage(pageCode, title, isRefresh = false, navigation = null) {
        const emptyResult = () => ({
            activationCompleted: false,
            activationEpoch: navigation?.epoch ?? -1,
            committed: false,
            suppressOnShow: false
        });
        if (pageCode === DEFAULT_PAGE_CODE && (Object.keys(this.containers).length || Object.keys(this.modules).length)) {
            this.resetWorkspaceForLogout();
        }
        const lifecycleVersion = this.getPageLifecycleVersion(pageCode);

        if (this.requiresAuth(pageCode) && !this.isAuthenticated()) {
            if (this.isCurrentNavigation(navigation)) {
                await this.load(DEFAULT_PAGE_CODE, DEFAULT_PAGE_TITLE, false);
            }
            return emptyResult();
        }
        if (this.requiresAuth(pageCode)) {
            this.extendSession();
            if (
                this.isCurrentNavigation(navigation)
                && window.I18nManager?.isLanguageLoading?.()
                && !this.containers[pageCode]
            ) {
                this.showNavigationLoading(
                    navigation,
                    window.I18nManager?.t?.("commonUi.loading.languageTitle", "Loading language pack"),
                    window.I18nManager?.t?.("commonUi.loading.languageDetail", "Preparing labels and messages")
                );
            }
            await window.I18nManager?.whenReady?.();
            if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion)) {
                this.discardStalePageLoad(pageCode);
                return emptyResult();
            }
        }
        if (this.requiresAuth(pageCode) && !this.isPageAllowed(pageCode)) {
            if (this.isCurrentNavigation(navigation)) {
                await this.load("home", window.getShellHomeTitle?.() || "Data Editing System", false);
            }
            return emptyResult();
        }

        const containerId = `page-section-${pageCode}`;

        if (this.containers[pageCode] && !isRefresh) {
            if (this.readyPages.has(pageCode)) {
                return this.activateReadyPage(pageCode, title, navigation, {
                    reinitializeDefaultPage: true,
                    lifecycleVersion
                });
            }
            this.close(pageCode, false, { invalidateLoad: false });
        }

        if (isRefresh) {
            const canClose = await this.runPageBeforeCloseHooks([pageCode], {
                reason: "refresh page",
                cleanupTargetConnection: false
            });
            if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion)) {
                this.discardStalePageLoad(pageCode);
                return emptyResult();
            }
            if (!canClose) return emptyResult();
            this.close(pageCode, false, { invalidateLoad: false });
        }

        const holder = document.getElementById('pageContainerHolder');
        const container = document.createElement('div');
        container.id = containerId;
        container.className = 'page-section';
        holder.appendChild(container);
        this.containers[pageCode] = container;
        if (this.requestedPageCode === pageCode) this.show(pageCode);

        let activationResult = emptyResult();
        try {
            const hasHtml = await this.injectHtml(pageCode);
            if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                this.discardStalePageLoad(pageCode, container);
                return emptyResult();
            }
            if (hasHtml) {
                await window.I18nManager?.ensurePagePack?.(pageCode);
                if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                    this.discardStalePageLoad(pageCode, container);
                    return emptyResult();
                }
                window.I18nManager?.applyPagePack?.(pageCode, container);
                await this.injectScript(pageCode, isRefresh);
                if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                    this.discardStalePageLoad(pageCode, container);
                    return emptyResult();
                }
            }

            const module = window[pageCode];
            if (module && typeof module.init === 'function') {
                this.modules[pageCode] = module;
                try {
                    await module.init();
                } catch (error) {
                    if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                        this.discardStalePageLoad(pageCode, container, module);
                        return emptyResult();
                    }
                    throw error;
                }
                if (!this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                    this.discardStalePageLoad(pageCode, container, module);
                    return emptyResult();
                }
            }

            this.readyPages.add(pageCode);
            this.markOpenPageVisited(pageCode);
            if (this.isCurrentNavigation(navigation)) {
                activationResult = await this.activateReadyPage(pageCode, title, navigation, {
                    container,
                    lifecycleVersion
                });
            }
        } catch (e) {
            if (this.isPageLifecycleCurrent(pageCode, lifecycleVersion, container)) {
                CommonUI.showPageError(pageCode, e.message);
                this.readyPages.add(pageCode);
                this.markOpenPageVisited(pageCode);
                if (this.isCurrentNavigation(navigation)) {
                    this.show(pageCode);
                    this.updateVisiblePageIdentity(pageCode, title, navigation);
                }
                activationResult.suppressOnShow = true;
            }
        } finally {
            this.updateVisiblePageIdentity(pageCode, title, navigation);
            this.lastLoadedVersion = APP_VERSION;
        }
        return activationResult;
    }
};

const LayoutManager = {
    sidebar: null,
    overlay: null,
    btn: null,
    collapseBtn: null,
    collapseStorageKey: 'INIT_SIDEBAR_USER_COLLAPSED',

    init() {
        this.sidebar = document.querySelector('.sidebar');
        if (!this.sidebar) return;

        let overlay = document.getElementById('sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }
        this.overlay = overlay;

        const header = document.querySelector('.content-header');
        if (!document.getElementById('mobile-menu-btn')) {
            const btn = document.createElement('button');
            btn.id = 'mobile-menu-btn';
            btn.type = 'button';
            btn.className = 'mobile-sidebar-toggle';
            btn.title = 'Open menu';
            btn.setAttribute('aria-label', 'Open menu');
            btn.setAttribute('aria-expanded', 'false');
            btn.innerHTML = '<i class="fas fa-bars"></i>';
            (header || document.body).appendChild(btn);
        }
        this.btn = document.getElementById('mobile-menu-btn');
        if (this.btn) {
            this.btn.className = 'mobile-sidebar-toggle';
            this.btn.title = 'Open menu';
            this.btn.setAttribute('aria-label', 'Open menu');
            this.btn.setAttribute('aria-expanded', 'false');
            if (header && this.btn.parentElement !== header) {
                header.appendChild(this.btn);
            }
        }
        this.collapseBtn = document.getElementById('btnSidebarCollapse');

        if (this.btn) this.btn.onclick = () => this.toggle();
        if (this.collapseBtn) this.collapseBtn.onclick = () => this.toggleSidebarCollapsed();
        this.overlay.onclick = () => this.toggle();
        this.restoreSidebarCollapsed();

        document.querySelectorAll('#mainNav [data-page]').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 1024 && this.sidebar.classList.contains('show')) {
                    this.toggle();
                }
            });
        });

        this.bindFolderEvents();

        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) {
                this.sidebar.classList.remove('show');
                this.overlay.classList.remove('active');
                if (this.btn) {
                    this.btn.innerHTML = '<i class="fas fa-bars"></i>';
                    this.btn.title = 'Open menu';
                    this.btn.setAttribute('aria-label', 'Open menu');
                    this.btn.setAttribute('aria-expanded', 'false');
                }
                this.applySidebarCollapsed(this.isSidebarCollapsed());
            } else {
                this.applySidebarCollapsed(false, { persist: false });
            }
        });
    },

    bindFolderEvents() {
        const folderButtons = document.querySelectorAll('.menu-folder button');
        folderButtons.forEach(button => {
            if (button.dataset.folderToggleBound === 'Y') return;
            button.dataset.folderToggleBound = 'Y';
            button.addEventListener('click', () => {
                const submenu = button.nextElementSibling;
                const icon = button.querySelector('.fa-chevron-down');

                if (submenu) {
                    submenu.classList.toggle('hidden');
                }

                if (icon) {
                    icon.classList.toggle('rotate-180');
                }
            });
        });
    },

    expandAllMenus() {
        document.querySelectorAll('.submenu').forEach(menu => {
            menu.classList.remove('hidden');
        });

        document.querySelectorAll('.menu-folder .fa-chevron-down').forEach(icon => {
            icon.classList.add('rotate-180');
        });
    },

    collapseAllMenus() {
        document.querySelectorAll('.submenu').forEach(menu => {
            menu.classList.add('hidden');
        });

        document.querySelectorAll('.menu-folder .fa-chevron-down').forEach(icon => {
            icon.classList.remove('rotate-180');
        });
    },

    isSidebarCollapsed() {
        return localStorage.getItem(this.collapseStorageKey) === 'Y';
    },

    restoreSidebarCollapsed() {
        this.applySidebarCollapsed(window.innerWidth > 1024 && this.isSidebarCollapsed(), { persist: false });
    },

    toggleSidebarCollapsed() {
        const nextCollapsed = !document.body.classList.contains('sidebar-user-collapsed');
        this.applySidebarCollapsed(nextCollapsed);
    },

    applySidebarCollapsed(collapsed, options = {}) {
        const persist = options.persist !== false;
        const enabled = Boolean(collapsed) && window.innerWidth > 1024;
        if (!enabled) {
            window.MenuRenderer?.closeCollapsedFlyouts?.();
        }
        document.body.classList.toggle('sidebar-user-collapsed', enabled);
        this.sidebar.classList.toggle('sidebar-collapsed', enabled);

        if (persist) {
            localStorage.setItem(this.collapseStorageKey, enabled ? 'Y' : 'N');
        }

        if (this.collapseBtn) {
            this.collapseBtn.title = enabled
                ? (window.I18nManager?.t?.("shellTitles.expandSidebar", "Expand sidebar") || "Expand sidebar")
                : (window.I18nManager?.t?.("shellTitles.collapseSidebar", "Collapse sidebar") || "Collapse sidebar");
            this.collapseBtn.setAttribute('aria-label', this.collapseBtn.title);
            this.collapseBtn.setAttribute('aria-expanded', String(!enabled));
            this.collapseBtn.innerHTML = enabled
                ? '<i class="fas fa-angles-right"></i>'
                : '<i class="fas fa-angles-left"></i>';
        }
    },

    toggle() {
        if (!this.sidebar) return;
        const willOpen = !this.sidebar.classList.contains('show');
        if (willOpen && window.innerWidth <= 1024) {
            window.toggleMobileGemini?.(false);
        }
        const isShow = this.sidebar.classList.toggle('show');

        if (this.overlay) {
            this.overlay.classList.toggle('active', isShow);
        }

        if (this.btn) {
            this.btn.innerHTML = isShow ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
            this.btn.title = isShow ? 'Close menu' : 'Open menu';
            this.btn.setAttribute('aria-label', this.btn.title);
            this.btn.setAttribute('aria-expanded', String(isShow));
        }
    },

    close() {
        if (!this.sidebar) return;
        this.sidebar.classList.remove('show');
        this.overlay.classList.remove('active');
        this.btn.innerHTML = '<i class="fas fa-bars"></i>';
        this.btn.title = 'Open menu';
        this.btn.setAttribute('aria-label', 'Open menu');
        this.btn.setAttribute('aria-expanded', 'false');
    }
};

const ConsoleLogger = {
    isEnabled: false,
    maxLines: 500,
    minLines: 50,
    maxAllowedLines: 5000,
    requestSeq: 0,
    settingsScopeKey: "",
    sensitiveKeyPattern: /(password|passwd|pwd|token|secret|key|authorization|credential|wallet|admin|private)/i,

    init() {
        this.setMaxEntries(localStorage.getItem("initConsoleLogMaxEntries") || this.maxLines, { persist: false });
        const toggle = document.getElementById('chkLogToggle');
        const statusText = document.getElementById('logStatusTextText');

        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.isEnabled = e.target.checked;
                if (statusText) {
                    statusText.innerText = this.isEnabled ? "LOG ON" : "LOG OFF";
                    statusText.style.color = this.isEnabled ? "#94a3b8" : "#ef4444";
                }
            });
        }
        this.clearPlaceholderLines();
        this.updateStats();
        this.loadSettings();
    },

    toggle() {
        this.isEnabled = !this.isEnabled;

        const container = document.querySelector('.log-toggle');
        const track = document.getElementById('logSwitch');
        const text = document.getElementById('logStatusText');

        if (!container || !track || !text) return;

        if (this.isEnabled) {
            container.classList.remove('off');
            track.classList.add('active');
            text.innerText = 'ON';
        } else {
            container.classList.add('off');
            track.classList.remove('active');
            text.innerText = 'OFF';
        }
    },

    info(msg, source = 'System', location = '') {
        if (!this.isEnabled) return;
        this._write('info', msg, source, location);
    },

    error(msg, source = 'System', location = '') {
        if (!this.isEnabled) return;
        this._write('error', msg, source, location);
    },

    warn(msg, source = 'System', location = '') {
        if (!this.isEnabled) return;
        this._write('warn', msg, source, location);
    },

    requestStart(url, options = {}) {
        const method = String(options.method || "GET").toUpperCase();
        const context = {
            id: ++this.requestSeq,
            method,
            url: this.sanitizeUrl(url),
            startedAt: performance.now()
        };
        this.info(`#${context.id} ${method} ${context.url}`, "Network", "request");
        return context;
    },

    requestEnd(context, response, detail = {}) {
        if (!context) return;
        const elapsed = Math.max(0, Math.round(performance.now() - context.startedAt));
        const status = response?.status || 0;
        const statusText = response?.statusText ? ` ${response.statusText}` : "";
        const suffix = detail.message ? ` - ${this.safeText(detail.message, 400)}` : "";
        const level = response?.ok ? "success" : "error";
        this._write(level, `#${context.id} ${context.method} ${context.url} -> ${status}${statusText} (${elapsed} ms)${suffix}`, "Network", "response");
    },

    requestError(context, error, detail = {}) {
        if (!context) return;
        const elapsed = Math.max(0, Math.round(performance.now() - context.startedAt));
        const phase = detail.phase ? `${detail.phase} ` : "";
        const message = this.safeText(error?.message || error || "Request failed.", 600);
        this.error(`#${context.id} ${context.method} ${context.url} -> ${phase}failed (${elapsed} ms) - ${message}`, "Network", "error");
    },

    setMaxEntries(value, options = {}) {
        const parsed = Number.parseInt(value, 10);
        const nextValue = Number.isFinite(parsed) ? parsed : this.maxLines;
        this.maxLines = Math.min(this.maxAllowedLines, Math.max(this.minLines, nextValue));
        if (options.persist !== false) {
            localStorage.setItem("initConsoleLogMaxEntries", String(this.maxLines));
        }
        this.trimAll();
        this.updateStats();
    },

    async loadSettings() {
        try {
            const loginUser = JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
            const connectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (!loginUser.userId || !connectionId || typeof API_BASE_URL === "undefined") return;

            const scopeKey = `${loginUser.userId}:${connectionId}`;
            if (this.settingsScopeKey === scopeKey) return;

            const headers = { "Content-Type": "application/json" };
            headers["X-Target-Connection-Id"] = String(connectionId);

            const response = await fetch(`${API_BASE_URL}/M91002/settings?categoryCode=OTHER`, {
                method: "GET",
                headers,
                credentials: "include"
            });
            if (!response.ok) return;
            window.PageManager?.extendSessionFromResponse?.(response);
            this.settingsScopeKey = scopeKey;
            const json = await response.json();
            const rows = Array.isArray(json?.data) ? json.data : [];
            const setting = rows.find((row) => String(row.SETTING_KEY || "").toUpperCase() === "CONSOLE_LOG_MAX_ENTRIES");
            if (setting?.SETTING_VALUE) this.setMaxEntries(setting.SETTING_VALUE, { persist: true });
        } catch (_) {
            // Settings are optional. The console keeps the local/default value when loading fails.
        }
    },

    sanitizeUrl(url) {
        const raw = String(url || "");
        try {
            const parsed = new URL(raw, window.location.origin);
            parsed.searchParams.forEach((value, key) => {
                if (this.sensitiveKeyPattern.test(key)) parsed.searchParams.set(key, "[masked]");
            });
            const safePath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
            return parsed.origin === window.location.origin ? safePath : `${parsed.origin}${safePath}`;
        } catch (_) {
            return this.maskSensitive(raw);
        }
    },

    safeText(value, maxLength = 1600) {
        let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
        text = this.maskSensitive(text);
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    },

    maskSensitive(text) {
        return String(text ?? "")
            .replace(/([?&][^=]*?(password|passwd|pwd|token|secret|key|authorization|credential|wallet|admin)[^=]*=)[^&\s]*/gi, "$1[masked]")
            .replace(/("(?:password|passwd|pwd|token|secret|key|authorization|credential|wallet|admin)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[masked]"')
            .replace(/((?:password|passwd|pwd|token|secret|key|authorization|credential|wallet|admin)[\w-]*\s*[:=]\s*)[^\s,;]+/gi, "$1[masked]");
    },

    escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    },

    _write(level, msg, source, location) {
        if (!this.isEnabled) return;
        const targetMsg = document.getElementById("consoleMsg");
        const targetErr = document.getElementById("consoleErr");
        const scrollParent = document.getElementById("consoleBody");
        if (!targetMsg || !targetErr || !scrollParent) return;
        this.clearPlaceholderLines();

        const now = new Date();
        const timeStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ` +
            `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

        const safeMsg = this.escapeHtml(this.safeText(msg));
        const safeSource = this.escapeHtml(source || "System");
        const safeLocation = this.escapeHtml(location || "");
        const locationText = safeLocation ? `${safeSource} > ${safeLocation}` : safeSource;
        const shouldStick = scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 24;
        const logLine = document.createElement("pre");
        logLine.className = `console-line log-${level}`;
        logLine.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-level">[${level.toUpperCase()}]</span> <span class="log-location">${locationText}</span> <span class="log-separator">:</span> <span class="log-message">${safeMsg}</span>`;

        targetMsg.appendChild(logLine);
        this.trimContainer(targetMsg);

        if (level === 'error') {
            const logLineErr = document.createElement("pre");
            logLineErr.className = `console-line log-${level}`;
            logLineErr.innerHTML = logLine.innerHTML;

            targetErr.appendChild(logLineErr);
            this.trimContainer(targetErr);
        }

        this.updateStats();
        setTimeout(() => {
            if (shouldStick) scrollParent.scrollTop = scrollParent.scrollHeight;
        }, 0);
    },

    clearPlaceholderLines() {
        document.querySelectorAll("#consoleMsg > .console-line:empty, #consoleErr > .console-line:empty").forEach((line) => line.remove());
    },

    trimContainer(container) {
        while (container.children.length > this.maxLines) {
            container.removeChild(container.firstElementChild);
        }
    },

    trimAll() {
        const targetMsg = document.getElementById("consoleMsg");
        const targetErr = document.getElementById("consoleErr");
        if (targetMsg) this.trimContainer(targetMsg);
        if (targetErr) this.trimContainer(targetErr);
    },

    clear(container) {
        if (!container) return;
        container.innerHTML = "";
        this.updateStats();
    },

    updateStats() {
        const stats = document.getElementById("consoleLogStats");
        const targetMsg = document.getElementById("consoleMsg");
        const targetErr = document.getElementById("consoleErr");
        if (!stats || !targetMsg || !targetErr) return;
        const total = targetMsg.children.length;
        const errors = targetErr.children.length;
        stats.textContent = `${total}/${this.maxLines} lines | ${errors} errors`;
    }
};

/**
 * AI Chat Manager: Oracle LLM 연동 로직
 */
const AIChatManager = {
    init() {
        const input = document.getElementById('chatInputText');
        const btn1 = document.getElementById('btnSendChat1');
        const btn2 = document.getElementById('btnSendChat2');

        if (btn1) btn1.onclick = () => this.sendQuestion('sql');
        if (btn2) btn2.onclick = () => this.sendQuestion('data');
        if (input) {
            input.onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') this.sendQuestion('sql');
            };
        }
    },

    async sendQuestion(mode = 'sql') {
        const input = document.getElementById('chatInputText');
        const question = input.value.trim();

        if (!question) return;

        this.appendMessage('user', question);
        input.value = '';

        const t = (path, fallback) => window.I18nManager?.t?.(path, fallback) || fallback;
        const loadingDiv = this.appendMessage('ai', `<i class="fas fa-spinner fa-spin mr-2"></i>${t("ai.thinking", "AI is thinking...")}`);
        ConsoleLogger.info(`AI request started: ${question}`, 'OracleLLM', 'sendQuestion');

        try {
            const response = await fetch(`${API_BASE_URL}/common/ai/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, mode }),
                credentials: 'include'
            });
            if (response.ok) window.PageManager?.extendSessionFromResponse?.(response);

            const result = await response.json();

            loadingDiv.remove();
            if (result.status === 'success') {
                let html = `<div class="font-bold text-blue-600 mb-1">${t("ai.generatedSql", "[Generated SQL]")}</div>`;
                html += `<pre class="bg-slate-800 text-green-400 p-2 rounded text-xs overflow-x-auto mb-2">${result.generated_sql}</pre>`;

                if (mode === 'data') {
                    html += `<div class="font-bold text-purple-600 mb-1">${t("ai.queryResult", "[Query result: {total} rows]").replace("{total}", result.total)}</div>`;
                    if (result.data.length > 0) {
                        html += this.makeSimpleTable(result.data, result.columns);
                    } else {
                        html += `<div class="text-gray-500 italic text-xs">${t("ai.noData", "No data found.")}</div>`;
                    }
                }
                this.appendMessage('ai', html);
                ConsoleLogger.info("SQL conversion succeeded", 'OracleLLM', 'sendQuestion');
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            loadingDiv.remove();
            this.appendMessage('error', `${t("ai.errorPrefix", "Error")}: ${err.message}`);
            ConsoleLogger.error(`AI request failed: ${err.message}`, 'OracleLLM', 'sendQuestion');
        }
    },

    makeSimpleTable(data, columns) {
        let tableHtml = `<div class="overflow-x-auto border rounded"><table class="w-full text-[11px] bg-white">`;
        tableHtml += `<thead class="bg-gray-100"><tr>`;
        columns.forEach(col => tableHtml += `<th class="p-1 border-b">${col}</th>`);
        tableHtml += `</tr></thead><tbody>`;

        data.slice(0, 5).forEach(row => {
            tableHtml += `<tr>`;
            columns.forEach(col => tableHtml += `<td class="p-1 border-b text-center">${row[col] ?? ''}</td>`);
            tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table></div>`;
        if (data.length > 5) {
            const text = window.I18nManager?.t?.("ai.topRowsOnly", "Only the first 5 rows are shown.") || "Only the first 5 rows are shown.";
            tableHtml += `<div class="text-[10px] text-right text-gray-400 mt-1">${text}</div>`;
        }
        return tableHtml;
    },

    appendMessage(type, text) {
        const chatMsg = document.getElementById('chatMsg');
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-bubble ${type}`;
        msgDiv.style.marginBottom = '15px';
        msgDiv.style.padding = '10px';
        msgDiv.style.borderRadius = '10px';
        msgDiv.style.fontSize = '13px';

        if (type === 'user') {
            msgDiv.style.background = 'var(--c-blue-bg)';
            msgDiv.style.marginLeft = '20px';
        } else if (type === 'ai') {
            msgDiv.style.background = 'white';
            msgDiv.style.border = '1px solid var(--c-border)';
            msgDiv.style.marginRight = '20px';
        } else {
            msgDiv.style.color = type === 'error' ? 'red' : 'gray';
            msgDiv.style.textAlign = 'center';
        }

        msgDiv.innerHTML = text;
        chatMsg.appendChild(msgDiv);
        chatMsg.scrollTop = chatMsg.scrollHeight;
        return msgDiv;
    }
};

window.PageManager = PageManager;
window.LayoutManager = LayoutManager;
window.ConsoleLogger = ConsoleLogger;
window.AIChatManager = AIChatManager;

function updateCurrentTargetDbSelect() {
    const legacySelect = document.getElementById('currentTargetDbSelect');
    if (legacySelect) legacySelect.hidden = true;
    const box = document.getElementById('currentTargetDbBox');
    const text = document.getElementById('currentTargetDbText');
    if (!box || !text) return;

    const isLoggedIn = !!sessionStorage.getItem('initLoginUser');
    const connectionId = sessionStorage.getItem('targetConnectionId') || '';
    const connectionName = sessionStorage.getItem('targetConnectionName') || '';
    box.hidden = !isLoggedIn || !connectionId;
    if (box.hidden) {
        text.textContent = 'Target DB not selected';
        return;
    }

    const label = connectionName || (connectionId ? `Connection #${connectionId}` : 'Target DB not selected');
    text.textContent = label;
    box.title = `Current Target DB: ${label}`;
    window.ConsoleLogger?.loadSettings?.();
}

window.updateCurrentTargetDbSelect = updateCurrentTargetDbSelect;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function openTargetDbChangeDialog() {
    const layer = document.getElementById("targetDbChangeLayer");
    const list = document.getElementById("targetDbChangeList");
    if (!layer || !list) return;
    layer.hidden = false;
    list.innerHTML = '<div class="target-db-change-empty">Loading target DB connections...</div>';
    try {
        const json = await CommonUtils.request(`${API_BASE_URL}/M99001/connections?includeShared=Y`, { method: "GET", showLoading: false });
        const rows = (Array.isArray(json.data) ? json.data : []).filter((row) => String(row.USE_YN || "Y").toUpperCase() === "Y");
        const currentId = sessionStorage.getItem("targetConnectionId") || "";
        if (!rows.length) {
            list.innerHTML = '<div class="target-db-change-empty">No enabled target DB connections found.</div>';
            return;
        }
        list.innerHTML = rows.map((row) => {
            const id = String(row.CONNECTION_ID ?? "");
            const checked = id === currentId ? " checked" : "";
            const name = row.CONNECTION_NAME || "(Unnamed connection)";
            const endpoint = [row.HOST, row.PORT, row.SERVICE_NAME || row.SID].filter(Boolean).join(" / ");
            const scope = row.CONNECTION_SCOPE === "SHARED" ? "Shared" : "Private";
            const meta = [row.DB_TYPE || "ORACLE", scope, row.DEFAULT_YN === "Y" ? "Default" : "", endpoint].filter(Boolean).join(" / ");
            return `
                <label class="target-db-change-option">
                    <input type="radio" name="targetDbChangeConnectionId" value="${escapeHtml(id)}"${checked}>
                    <span>
                        <strong>${escapeHtml(name)}</strong>
                        <small>${escapeHtml(meta)}</small>
                    </span>
                </label>
            `;
        }).join("");
    } catch (error) {
        list.innerHTML = `<div class="target-db-change-empty is-error">${escapeHtml(error.message || "Target DB list load failed.")}</div>`;
    }
}

function closeTargetDbChangeDialog() {
    const layer = document.getElementById("targetDbChangeLayer");
    if (layer) layer.hidden = true;
}

async function applyTargetDbChange() {
    try {
        const selected = document.querySelector('#targetDbChangeList input[name="targetDbChangeConnectionId"]:checked');
        if (!selected) {
            alert("Select a target DB.");
            return;
        }
        const newConnectionId = String(selected.value || "");
        const currentConnectionId = sessionStorage.getItem("targetConnectionId") || "";
        if (newConnectionId === currentConnectionId) {
            closeTargetDbChangeDialog();
            return;
        }

        const pageCodes = Object.keys(PageManager.containers || {});
        if (!(await PageManager.confirmAndCleanupBeforeClose(pageCodes, "change Target DB", { cleanupTargetConnection: true }))) return;

        const label = selected.closest(".target-db-change-option")?.querySelector("strong")?.textContent || `Connection #${newConnectionId}`;
        PageManager.resetWorkspaceForLogout?.(true);
        sessionStorage.setItem("targetConnectionId", newConnectionId);
        sessionStorage.setItem("targetConnectionName", label);
        sessionStorage.removeItem(CURRENT_PAGE_KEY);
        sessionStorage.removeItem(CURRENT_PAGE_TITLE_KEY);
        closeTargetDbChangeDialog();
        updateCurrentTargetDbSelect();
        await window.reloadShellDisplaySettings?.();
        await PageManager.load("home", window.getShellHomeTitle?.() || "Data Editing System");
    } catch (error) {
        alert(error.message || "Target DB change failed.");
    }
}

window.openTargetDbChangeDialog = openTargetDbChangeDialog;
window.closeTargetDbChangeDialog = closeTargetDbChangeDialog;
window.applyTargetDbChange = applyTargetDbChange;

function handleExtendSession() {
    PageManager.manualExtendSession();
}

window.handleExtendSession = handleExtendSession;

function getInitialPageConfig() {
    const params = new URLSearchParams(window.location.search);
    const requestedPage = params.get("page") || window.location.hash.replace(/^#/, "");
    if (requestedPage) {
        const menu = window.MENU_PAGE_MAP?.[requestedPage];
        return { pageCode: requestedPage, title: menu?.title || menu?.label || requestedPage };
    }

    if (PageManager.isAuthenticated()) {
        const savedPage = sessionStorage.getItem(CURRENT_PAGE_KEY);
        const savedTitle = sessionStorage.getItem(CURRENT_PAGE_TITLE_KEY);
        if (savedPage) {
            const menu = window.MENU_PAGE_MAP?.[savedPage];
            return { pageCode: savedPage, title: savedTitle || menu?.title || menu?.label || savedPage };
        }
        return { pageCode: "home", title: window.getShellHomeTitle?.() || "Data Editing System" };
    }

    return { pageCode: DEFAULT_PAGE_CODE, title: DEFAULT_PAGE_TITLE };
}

window.addEventListener('DOMContentLoaded', async () => {
    LayoutManager.init();
    AIChatManager.init();
    ConsoleLogger.init();
    await window.I18nManager?.initFromSession?.();
    window.MenuRenderer?.render?.('mainNav', window.handleMenuClick);
    updateCurrentTargetDbSelect();
    PageManager.startSessionTimer();
    await PageManager.validateServerSession();
    await window.reloadShellDisplaySettings?.();
    const initialPage = getInitialPageConfig();
    await PageManager.load(initialPage.pageCode, initialPage.title);
    await window.reloadShellDisplaySettings?.();
});
