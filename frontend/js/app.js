const API_BASE_URL = "/api";
const FETCH_TIMEOUT = 10000; // fetch 요청 타임아웃 기본값(ms)
const LOADING_DELAY_MS = 300; // 로딩 표시 지연 시간(ms)
const APP_VERSION = window.APP_CACHE_VERSION || "0.0.0"; // Asset cache version.
const DEFAULT_PAGE_CODE = "login";
const DEFAULT_PAGE_TITLE = "Data Editing System Login";
const SHELL_HIDDEN_PAGES = ["login"];
const PUBLIC_PAGES = ["login"];
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_EXPIRES_AT_KEY = "initLoginExpiresAt";
const CURRENT_PAGE_KEY = "initCurrentPage";
const CURRENT_PAGE_TITLE_KEY = "initCurrentPageTitle";
// const API_BASE_URL = "http://127.0.0.1:8000/api";

const PageManager = {
    modules: {}, // Loaded page modules cache.
    containers: {}, // Open page containers.
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

    extendSession() {
        if (!this.isAuthenticated()) return;
        sessionStorage.setItem(SESSION_EXPIRES_AT_KEY, String(Date.now() + SESSION_TIMEOUT_MS));
        this.updateSessionStatus();
    },

    clearLoginSession() {
        sessionStorage.removeItem("initLoginUser");
        sessionStorage.removeItem("targetConnectionId");
        sessionStorage.removeItem("targetConnectionName");
        sessionStorage.removeItem("initBootstrapToken");
        sessionStorage.removeItem("initBootstrapAdminLoginId");
        sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
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

    rememberCurrentPage(pageCode, title) {
        if (!this.requiresAuth(pageCode) || pageCode === DEFAULT_PAGE_CODE) return;
        sessionStorage.setItem(CURRENT_PAGE_KEY, pageCode);
        if (title) sessionStorage.setItem(CURRENT_PAGE_TITLE_KEY, title);
    },

    getCloseFallbackPage() {
        return { pageCode: "home", title: window.getShellHomeTitle?.() || "Data Editing System" };
    },

    async runPageBeforeCloseHooks(pageCodes) {
        for (const pageCode of pageCodes) {
            const module = window[pageCode] || this.modules[pageCode];
            if (!module || typeof module.beforeClose !== "function") continue;
            const result = await module.beforeClose();
            if (result === false) return false;
        }
        return true;
    },

    buildTransitionWarning(actionText) {
        const activeRequests = CommonUtils.getActiveRequestCount?.() || 0;
        const requestWarning = activeRequests > 0
            ? `\n\nThere are ${activeRequests} request(s) still running. The app will wait briefly before cleanup.`
            : "";
        return [
            `You are about to ${actionText}.`,
            "",
            "All open pages will be closed and unsaved work may be lost.",
            "Any open target DB session will be rolled back and closed before continuing.",
            requestWarning,
            "",
            "Continue?"
        ].join("\n");
    },

    async cleanupCurrentTargetConnection(reason = "") {
        const connectionId = sessionStorage.getItem("targetConnectionId") || "";
        if (!connectionId || !this.isAuthenticated()) return true;
        const response = await CommonUtils.request(`${API_BASE_URL}/M91001/session/cleanup`, {
            method: "POST",
            showLoading: true,
            body: { connectionId, reason }
        });
        return response?.status === "success";
    },

    async confirmAndCleanupBeforeClose(pageCodes = [], actionText = "continue") {
        if (!(await CommonMessage.confirm(this.buildTransitionWarning(actionText)))) return false;

        const canClose = await this.runPageBeforeCloseHooks(pageCodes);
        if (!canClose) return false;

        if (CommonUtils.waitForIdle) {
            const isIdle = await CommonUtils.waitForIdle(15000);
            if (!isIdle && !(await CommonMessage.confirm("Some requests are still running. Continue cleanup anyway?"))) {
                return false;
            }
        }

        await this.cleanupCurrentTargetConnection(actionText);
        return true;
    },

    formatPageTitle(pageCode, title) {
        const menu = window.MENU_PAGE_MAP?.[pageCode];
        const baseTitle = title || menu?.title || menu?.label || pageCode;
        if (!pageCode || pageCode === DEFAULT_PAGE_CODE || pageCode === "home") return baseTitle;
        if (String(baseTitle).includes(`[${pageCode}]`)) return baseTitle;
        return `${baseTitle} [${pageCode}]`;
    },

    show(pageCode) {
        const setupWithoutTarget = pageCode === "M99001"
            && ((this.isAuthenticated() && !sessionStorage.getItem("targetConnectionId")) || this.isBootstrapAuthenticated());
        document.body.classList.toggle("intro-mode", SHELL_HIDDEN_PAGES.includes(pageCode) || setupWithoutTarget);

        document.querySelectorAll(".page-section").forEach(section => {
            section.classList.remove("active");
            section.style.display = "none";
        });

        const targetContainer = this.containers[pageCode];
        if (targetContainer) {
            targetContainer.classList.add("active");
            targetContainer.style.display = "block";
        }

        document.querySelectorAll("#mainNav [data-page]").forEach(el => {
            el.classList.remove("menu-active");
        });

        const targetMenu = document.querySelector(`#mainNav [data-page="${pageCode}"]`);
        if (targetMenu) {
            targetMenu.classList.add("menu-active", "visited-menu");

            const parentSubmenu = targetMenu.closest(".submenu");
            if (parentSubmenu && parentSubmenu.classList.contains("hidden")) {
                parentSubmenu.classList.remove("hidden");

                const folderBtn = parentSubmenu.previousElementSibling;
                if (folderBtn) {
                    const arrow = folderBtn.querySelector(".fa-chevron-down");
                    if (arrow) arrow.classList.add("rotate-180");
                }
            }
        }
        window.MenuRenderer?.markActivePage?.(pageCode);
    },

    closeAll() {
        const openPages = Object.keys(this.containers).filter((pageCode) => pageCode !== DEFAULT_PAGE_CODE);
        if (openPages.length === 0) {
            alert("There are no open pages.");
            return;
        }

        openPages.forEach((pageCode, index) => {
            this.close(pageCode, index === openPages.length - 1);
        });
        MenuRenderer?.collapseAll?.();
        LayoutManager?.collapseAllMenus?.();
    },

    resetWorkspaceForLogout(keepLoginSession = false) {
        Object.keys(this.containers).forEach((pageCode) => {
            this.close(pageCode, false);
        });
        this.containers = {};
        this.modules = {};
        document.querySelectorAll("#pageContainerHolder .page-section").forEach((section) => section.remove());
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
    close(pageCode, moveToMain = true) {
        if (pageCode === DEFAULT_PAGE_CODE) {
            console.log("[System] Closing all open pages.");
            return;
        }

        console.log(`[System] Closing ${pageCode}.`);

        const targetModule = window[pageCode] || this.modules[pageCode];
        if (targetModule && typeof targetModule.destroy === 'function') {
            try {
                targetModule.destroy();
            } catch (error) {
                console.warn(`[System] ${pageCode} destroy failed.`, error);
            }
        }

        const container = document.getElementById(`page-section-${pageCode}`);
        if (container) {
            container.innerHTML = '';
            container.remove();
            delete this.containers[pageCode];
        }

        const scriptTag = document.querySelector(`script[src*="${pageCode}.js"]`);
        if (scriptTag) scriptTag.remove();

        const closedMenu = document.querySelector(`#mainNav [data-page="${pageCode}"]`);
        if (closedMenu) {
            closedMenu.classList.remove('visited-menu', 'menu-active', 'bg-blue-700', 'text-green-500');
        }
        window.MenuRenderer?.visitedPages?.delete?.(pageCode);

        if (window[pageCode]) {
            if (typeof window[pageCode].destroy === 'function') {
                window[pageCode].destroy();
            }
            delete window[pageCode];
        }
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

        if (!force && document.querySelector(`script[src*="${scriptFileName}.js"]`)) {
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

    /**
     * 페이지를 로드하거나 이미 열린 페이지를 활성화합니다.
     * @param {string} pageCode - 페이지 코드
     * @param {string} title - 화면 제목
     * @param {boolean} isRefresh - 강제 새로고침 여부
     */
    async load(pageCode, title, isRefresh = false) {
        if (pageCode === DEFAULT_PAGE_CODE && (Object.keys(this.containers).length || Object.keys(this.modules).length)) {
            this.resetWorkspaceForLogout();
        }

        if (this.requiresAuth(pageCode) && !this.isAuthenticated()) {
            await this.load(DEFAULT_PAGE_CODE, DEFAULT_PAGE_TITLE, false);
            return;
        }
        if (this.requiresAuth(pageCode)) {
            this.extendSession();
            if (window.I18nManager?.isLanguageLoading?.()) {
                CommonUI.showLoading(
                    window.I18nManager?.t?.("commonUi.loading.languageTitle", "Loading language pack"),
                    window.I18nManager?.t?.("commonUi.loading.languageDetail", "Preparing labels and messages")
                );
            }
            await window.I18nManager?.whenReady?.();
        }
        if (this.requiresAuth(pageCode) && !this.isPageAllowed(pageCode)) {
            await this.load("home", window.getShellHomeTitle?.() || "Data Editing System", false);
            return;
        }

        const containerId = `page-section-${pageCode}`;

        if (this.containers[pageCode] && !isRefresh) {
            const module = window[pageCode] || this.modules[pageCode];
            if (pageCode === DEFAULT_PAGE_CODE && module && typeof module.init === 'function') {
                await module.init();
            }
            this.show(pageCode);
            if (module && typeof module.onShow === 'function') {
                await module.onShow();
            }
            await window.I18nManager?.ensurePagePack?.(pageCode);
            window.I18nManager?.applyPagePack?.(pageCode, this.containers[pageCode]);
            window.I18nManager?.applyCommonPack?.(window.I18nManager.commonPack || {});
            const displayTitle = this.formatPageTitle(pageCode, title);
            if (displayTitle) window.updateShellPageHeader?.(pageCode, displayTitle);
            this.rememberCurrentPage(pageCode, displayTitle);
            return;
        }

        if (isRefresh) {
            this.close(pageCode, false);
        }

        const holder = document.getElementById('pageContainerHolder');
        const container = document.createElement('div');
        container.id = containerId;
        container.className = 'page-section';
        holder.appendChild(container);
        this.containers[pageCode] = container;
        this.show(pageCode);

        CommonUI.showLoading();

        try {
            const hasHtml = await this.injectHtml(pageCode);
            if (hasHtml) {
                await window.I18nManager?.ensurePagePack?.(pageCode);
                window.I18nManager?.applyPagePack?.(pageCode, container);
                await this.injectScript(pageCode, isRefresh);
            }

            const module = window[pageCode];
            if (module && typeof module.init === 'function') {
                this.modules[pageCode] = module;
                await module.init();
            }

            this.show(pageCode);
            if (module && typeof module.onShow === 'function') {
                await module.onShow();
            }
            window.I18nManager?.applyPagePack?.(pageCode, container);
            window.I18nManager?.applyCommonPack?.(window.I18nManager.commonPack || {});
        } catch (e) {
            CommonUI.showPageError(pageCode, e.message);
        } finally {
            CommonUI.hideLoading();
            const displayTitle = this.formatPageTitle(pageCode, title);
            if (displayTitle) window.updateShellPageHeader?.(pageCode, displayTitle);
            this.rememberCurrentPage(pageCode, displayTitle);
            this.lastLoadedVersion = APP_VERSION;
        }
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

        if (!document.getElementById('mobile-menu-btn')) {
            const btn = document.createElement('button');
            btn.id = 'mobile-menu-btn';
            btn.className = 'fixed top-4 right-4 w-12 h-12 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center lg:hidden z-[210] transition-transform active:scale-90';
            btn.innerHTML = '<i class="fas fa-bars"></i>';
            document.body.appendChild(btn);
        }
        this.btn = document.getElementById('mobile-menu-btn');
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
                if (this.btn) this.btn.innerHTML = '<i class="fas fa-bars"></i>';
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
        const isShow = this.sidebar.classList.toggle('show');

        if (this.overlay) {
            this.overlay.classList.toggle('active', isShow);
        }

        if (this.btn) {
            this.btn.innerHTML = isShow ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
        }
    },

    close() {
        if (!this.sidebar) return;
        this.sidebar.classList.remove('show');
        this.overlay.classList.remove('active');
        this.btn.innerHTML = '<i class="fas fa-bars"></i>';
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
            headers["X-Login-User-Id"] = String(loginUser.userId);
            if (loginUser.loginId) headers["X-Login-Id"] = String(loginUser.loginId);
            if (loginUser.email) headers["X-Login-Email"] = String(loginUser.email);
            if (loginUser.roleCode) headers["X-Login-Role-Code"] = String(loginUser.roleCode);
            headers["X-Target-Connection-Id"] = String(connectionId);

            const response = await fetch(`${API_BASE_URL}/M91002/settings?categoryCode=OTHER`, { method: "GET", headers });
            if (!response.ok) return;
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
                body: JSON.stringify({ question, mode })
            });

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
        if (!(await PageManager.confirmAndCleanupBeforeClose(pageCodes, "change Target DB"))) return;

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
    await window.reloadShellDisplaySettings?.();
    const initialPage = getInitialPageConfig();
    await PageManager.load(initialPage.pageCode, initialPage.title);
    await window.reloadShellDisplaySettings?.();
});
