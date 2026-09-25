(function() {
    const PAGE_CODE = "M00001";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const M00001 = {
        frame: null,
        handleFrameLoad: null,
        contextRecoveryPromise: null,

        init() {
            this.frame = getContainerEl(`#quickEditFrame-${PAGE_CODE}`);
            if (!this.frame) return;
            this.handleFrameLoad = () => {
                const loading = getContainerEl(`#quickEditLoading-${PAGE_CODE}`);
                if (loading) loading.hidden = true;
            };
            this.frame.addEventListener("load", this.handleFrameLoad);
            const url = new URL("/quick-edit/", window.location.origin);
            url.searchParams.set("embedded", "1");
            url.searchParams.set("v", window.APP_CACHE_VERSION || "1");
            this.frame.src = url.href;
            this.onShow();
        },

        onShow() {
            const labels = window[`${PAGE_CODE}_PAGE_I18N`]?.labels || {};
            if (this.frame) this.frame.title = labels.title || "Quick Editing";
            this.frame?.contentWindow?.QuickEditWorkspace?.onShow?.();
        },

        beforeClose() {
            const workspace = this.frame?.contentWindow?.QuickEditWorkspace;
            const state = workspace?.getLifecycleState?.();
            if (state?.canClose === false || workspace?.canClose?.() === false) {
                const labels = window[`${PAGE_CODE}_PAGE_I18N`]?.labels || {};
                CommonMessage.warning(state?.message || labels.busy || "Finish the current Quick Editing task before closing, refreshing or changing the Target DB.");
                return false;
            }
            return true;
        },

        handleContextLoss({ kind } = {}) {
            if (this.contextRecoveryPromise) return this.contextRecoveryPromise;
            this.contextRecoveryPromise = this.recoverServerContext(kind).finally(() => {
                this.contextRecoveryPromise = null;
            });
            return this.contextRecoveryPromise;
        },

        async recoverServerContext(kind) {
            if (kind === "SESSION") {
                await PageManager.handleSessionExpired();
                return true;
            }
            const response = await fetch(`${API_BASE_URL}/M91001/session/me`, { credentials: "include" });
            if (response.status === 401 || response.status === 403) {
                await PageManager.handleSessionExpired();
                return true;
            }
            if (!response.ok) throw new Error("Server session verification failed.");
            const json = await response.json();
            if (!json?.user?.userId) throw new Error("Server session verification failed.");
            let previousUser = null;
            try { previousUser = JSON.parse(sessionStorage.getItem("initLoginUser") || "null"); } catch (_error) {}
            const sameUser = String(previousUser?.userId || "") === String(json.user.userId);
            if (sameUser) {
                const pages = Object.keys(PageManager.containers || {}).filter((page) => page !== PAGE_CODE);
                if (!(await PageManager.runPageBeforeCloseHooks(pages, { reason: "Target DB context changed", preserveServerWork: true }))) return false;
                if (CommonUtils.waitForIdle && !(await CommonUtils.waitForIdle(15000))) {
                    const labels = window[`${PAGE_CODE}_PAGE_I18N`]?.labels || {};
                    CommonMessage.warning(labels.requestsPending || "Wait for the other page requests to finish, then reconnect Quick Editing.");
                    return false;
                }
            }
            // Discard every old-context page before exposing the verified new Target DB.
            // This releases browser resources only; existing server runs are not cancelled.
            PageManager.resetWorkspaceForLogout(sameUser);
            sessionStorage.removeItem("init.quick-edit.pipeline.v1");
            PageManager.applyVerifiedServerSession(json, response);
            await PageManager.load(PAGE_CODE, window.MENU_PAGE_MAP?.[PAGE_CODE]?.title || "Quick Editing");
            return true;
        },

        destroy() {
            if (this.frame) {
                this.frame.removeEventListener("load", this.handleFrameLoad);
                this.frame.src = "about:blank";
            }
            this.frame = null;
            this.handleFrameLoad = null;
        }
    };

    window[PAGE_CODE] = M00001;
})();
