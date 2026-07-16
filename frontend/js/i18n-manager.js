(function() {
    const DEFAULT_LANGUAGE = "en";
    const LANGUAGE_STORAGE_KEY = "initLanguageCode";
    const SUPPORTED_LANGUAGES = new Set(["en", "ko"]);
    const commonPackCache = new Map();
    const pagePackCache = new Map();
    const mergedPagePackCache = new Map();
    const pageTranslationStates = new WeakMap();
    const pageTranslationOwners = new WeakMap();
    const pageTranslationDescendants = new WeakMap();
    const pageCommonPackStates = new WeakMap();
    const shellBaseState = new WeakMap();
    let shellTranslatedElements = new Map();
    let languageReadyPromise = Promise.resolve(DEFAULT_LANGUAGE);
    let languageLoading = false;
    let languageRevision = 0;
    let languageRequestId = 0;

    const PAGE_TRANSLATION_ATTRIBUTES = [
        "data-label-key",
        "data-title-key",
        "data-placeholder-key",
        "data-value-key",
        "data-aria-label-key",
        "data-placeholder",
        "class",
        "id",
        "hidden",
        "data-panel",
        "title",
        "placeholder",
        "aria-label",
        "value"
    ];

    function trackLanguageTask(task) {
        languageLoading = true;
        const tracked = Promise.resolve(task).finally(() => {
            if (languageReadyPromise === tracked) languageLoading = false;
        });
        languageReadyPromise = tracked;
        return tracked;
    }

    function normalizeLanguageCode(value) {
        const text = String(value || DEFAULT_LANGUAGE).trim().toLowerCase().replace("_", "-");
        if (text === "ko" || text === "ko-kr" || text === "kr") return "ko";
        if (text === "en" || text === "en-us" || text === "en-gb") return "en";
        return DEFAULT_LANGUAGE;
    }

    function safeObject(value) {
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function hasAuthenticatedSession() {
        return Boolean(sessionStorage.getItem("initLoginUser"));
    }

    function getAssetUrl(path) {
        if (typeof window.APP_ASSET_URL === "function") {
            return window.APP_ASSET_URL(path);
        }
        const separator = String(path).includes("?") ? "&" : "?";
        const version = window.APP_CACHE_VERSION || "0.0.0";
        return `${path}${separator}v=${encodeURIComponent(version)}`;
    }

    async function fetchJsonOrEmpty(path) {
        try {
            const response = await fetch(getAssetUrl(path), { cache: "force-cache" });
            if (!response.ok) return {};
            const json = await response.json();
            return safeObject(json);
        } catch (error) {
            console.warn(`[i18n] Language pack load failed: ${path}`, error);
            return {};
        }
    }

    function getCommonPagePackCodes(pageCode) {
        const code = String(pageCode || "").trim();
        if (window.PageManager?.dataWorkTemplatePages?.includes?.(code)) return ["MCOM_DATA_WORK"];
        if (window.PageManager?.flowWorkTemplatePages?.includes?.(code)) return ["MCOM_FLOW_WORK"];
        if (window.PageManager?.anlyWorkTemplatePages?.includes?.(code)) return ["MCOM_ANLY_WORK"];
        return [];
    }

    function getByPath(source, path) {
        return String(path || "")
            .split(".")
            .filter(Boolean)
            .reduce((current, key) => safeObject(current)[key], source);
    }

    function rememberBaseMenu(menu) {
        if (!menu || menu._i18nBase) return;
        menu._i18nBase = {
            label: menu.label,
            title: menu.title
        };
    }

    function getShellElementState(element) {
        if (!shellBaseState.has(element)) {
            shellBaseState.set(element, {
                text: element.textContent,
                title: element.getAttribute("title"),
                placeholder: element.getAttribute("placeholder"),
                value: "value" in element ? element.value : undefined,
                ariaLabel: element.getAttribute("aria-label")
            });
        }
        return shellBaseState.get(element);
    }

    function restoreShellTranslations() {
        shellTranslatedElements.forEach((fields, element) => {
            if (!element?.isConnected) return;
            const state = shellBaseState.get(element);
            if (!state) return;
            if (fields.has("text") && state.text !== undefined) element.textContent = state.text;
            if (fields.has("title")) {
                if (state.title === null) element.removeAttribute("title");
                else if (state.title !== undefined) element.setAttribute("title", state.title);
            }
            if (fields.has("placeholder")) {
                if (state.placeholder === null) element.removeAttribute("placeholder");
                else if (state.placeholder !== undefined) element.setAttribute("placeholder", state.placeholder);
            }
            if (fields.has("value") && state.value !== undefined && "value" in element) element.value = state.value;
            if (fields.has("ariaLabel")) {
                if (state.ariaLabel === null) element.removeAttribute("aria-label");
                else if (state.ariaLabel !== undefined) element.setAttribute("aria-label", state.ariaLabel);
            }
        });
        shellTranslatedElements = new Map();
    }

    function getPageSectionOwner(root) {
        if (!root || root.nodeType !== 1) return null;
        if (root.matches?.('.page-section[id^="page-section-"]')) return root;
        return root.closest?.('.page-section[id^="page-section-"]') || pageTranslationOwners.get(root) || null;
    }

    function releaseTranslationState(root) {
        const state = root ? pageTranslationStates.get(root) : null;
        state?.observer?.disconnect();
        state?.observer?.takeRecords?.();
        if (root) pageTranslationStates.delete(root);
    }

    function prunePageTranslationDescendants(owner) {
        const descendants = owner ? pageTranslationDescendants.get(owner) : null;
        if (!descendants) return;
        Array.from(descendants).forEach((innerRoot) => {
            if (owner.contains(innerRoot) && innerRoot.isConnected) return;
            releaseTranslationState(innerRoot);
            descendants.delete(innerRoot);
            pageTranslationOwners.delete(innerRoot);
        });
        if (!descendants.size) pageTranslationDescendants.delete(owner);
    }

    function registerPageTranslationRoot(root) {
        const owner = getPageSectionOwner(root);
        if (!owner || owner === root) {
            if (owner) prunePageTranslationDescendants(owner);
            return;
        }
        prunePageTranslationDescendants(owner);
        let descendants = pageTranslationDescendants.get(owner);
        if (!descendants) {
            descendants = new Set();
            pageTranslationDescendants.set(owner, descendants);
        }
        descendants.add(root);
        pageTranslationOwners.set(root, owner);
    }

    function getPageTranslationState(root) {
        if (!root || typeof root !== "object") return null;
        registerPageTranslationRoot(root);
        let state = pageTranslationStates.get(root);
        if (state) return state;

        state = {
            pageCode: "",
            languageRevision: -1,
            dirty: true,
            observer: null
        };
        if (typeof MutationObserver !== "undefined" && root.nodeType === 1) {
            state.observer = new MutationObserver(() => {
                state.dirty = true;
                state.observer?.disconnect();
                const owner = getPageSectionOwner(root);
                if (owner === root) prunePageTranslationDescendants(owner);
            });
        }
        pageTranslationStates.set(root, state);
        return state;
    }

    function observePageTranslationRoot(root, state) {
        if (!root || !state?.observer || !root.isConnected) return;
        state.observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: PAGE_TRANSLATION_ATTRIBUTES
        });
    }

    const I18nManager = {
        defaultLanguage: DEFAULT_LANGUAGE,
        supportedLanguages: Array.from(SUPPORTED_LANGUAGES),
        currentLanguage: DEFAULT_LANGUAGE,
        commonPack: {},

        normalizeLanguageCode,

        isLanguageLoading() {
            return languageLoading;
        },

        async whenReady() {
            return languageReadyPromise;
        },

        getCurrentLanguage() {
            if (!hasAuthenticatedSession()) return DEFAULT_LANGUAGE;
            const stored = sessionStorage.getItem(LANGUAGE_STORAGE_KEY);
            return normalizeLanguageCode(stored || this.currentLanguage || DEFAULT_LANGUAGE);
        },

        setSessionLanguage(languageCode) {
            const normalized = normalizeLanguageCode(languageCode);
            this.currentLanguage = normalized;
            sessionStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
            document.documentElement.lang = normalized === "ko" ? "ko" : "en";
            this.updateLanguageBadge(normalized);
            return normalized;
        },

        clearSessionLanguage() {
            languageRequestId += 1;
            sessionStorage.removeItem(LANGUAGE_STORAGE_KEY);
            this.currentLanguage = DEFAULT_LANGUAGE;
            this.commonPack = {};
            pagePackCache.clear();
            mergedPagePackCache.clear();
            languageRevision += 1;
            document.documentElement.lang = "en";
            this.applyCommonPack({});
            this.updateLanguageBadge(DEFAULT_LANGUAGE);
        },

        async initFromSession() {
            const requestId = ++languageRequestId;
            return trackLanguageTask((async () => {
                const canUseSessionLanguage = hasAuthenticatedSession();
                if (!canUseSessionLanguage) sessionStorage.removeItem(LANGUAGE_STORAGE_KEY);
                const stored = canUseSessionLanguage ? sessionStorage.getItem(LANGUAGE_STORAGE_KEY) : "";
                const languageCode = stored ? normalizeLanguageCode(stored) : DEFAULT_LANGUAGE;
                await this.applyLanguageNow(languageCode, requestId);
                return languageCode;
            })());
        },

        async loadLanguageFromUserSettings() {
            const requestId = ++languageRequestId;
            return trackLanguageTask((async () => {
                let languageCode = DEFAULT_LANGUAGE;
                try {
                    if (window.CommonUtils && typeof API_BASE_URL !== "undefined") {
                        const params = new URLSearchParams({ categoryCode: "GENERAL" });
                        const json = await CommonUtils.request(`${API_BASE_URL}/M91002/settings?${params.toString()}`, {
                            method: "GET",
                            showLoading: false
                        });
                        const rows = Array.isArray(json?.data) ? json.data : [];
                        const row = rows.find((item) => String(item.SETTING_KEY || "").toUpperCase() === "SYSTEM_LANGUAGE");
                        languageCode = normalizeLanguageCode(row?.SETTING_VALUE || DEFAULT_LANGUAGE);
                    }
                } catch (error) {
                    console.warn("[i18n] User language setting load failed. English fallback will be used.", error);
                }
                await this.applyLanguageNow(languageCode, requestId);
                return languageCode;
            })());
        },

        async applyLanguage(languageCode) {
            const requestId = ++languageRequestId;
            return trackLanguageTask(this.applyLanguageNow(languageCode, requestId));
        },

        async applyLanguageNow(languageCode, requestId) {
            const normalized = normalizeLanguageCode(languageCode);
            if (requestId !== languageRequestId) return this.getCurrentLanguage();
            commonPackCache.delete(normalized);
            const commonPack = await this.loadCommonPack(normalized);
            if (requestId !== languageRequestId) return this.getCurrentLanguage();

            this.setSessionLanguage(normalized);
            pagePackCache.clear();
            mergedPagePackCache.clear();
            languageRevision += 1;
            this.commonPack = commonPack;
            this.applyCommonPack(this.commonPack);
            this.updateLanguageBadge(normalized);
            return normalized;
        },

        async loadCommonPack(languageCode = this.getCurrentLanguage()) {
            const normalized = normalizeLanguageCode(languageCode);
            if (normalized === DEFAULT_LANGUAGE) return {};
            if (!commonPackCache.has(normalized)) {
                commonPackCache.set(normalized, fetchJsonOrEmpty(`./i18n/common/${normalized}.json`));
            }
            const pack = safeObject(await commonPackCache.get(normalized));
            commonPackCache.set(normalized, pack);
            return pack;
        },

        async ensurePagePack(pageCode, languageCode = this.getCurrentLanguage()) {
            const normalizedPageCode = String(pageCode || "").trim();
            const normalizedLanguage = normalizeLanguageCode(languageCode);
            const requestedLanguageRevision = languageRevision;
            if (!normalizedPageCode || normalizedLanguage === DEFAULT_LANGUAGE) {
                delete window[`${normalizedPageCode}_WORK_UI_LABELS`];
                delete window[`${normalizedPageCode}_FLOW_UI_LABELS`];
                delete window[`${normalizedPageCode}_PAGE_I18N`];
                return {};
            }

            const mergedCacheKey = `${normalizedLanguage}:${normalizedPageCode}`;
            if (mergedPagePackCache.has(mergedCacheKey)) {
                const cachedPack = mergedPagePackCache.get(mergedCacheKey);
                this.installPagePack(normalizedPageCode, cachedPack);
                return cachedPack;
            }

            const packs = [];
            for (const commonPageCode of getCommonPagePackCodes(normalizedPageCode)) {
                packs.push(await this.loadPagePack(commonPageCode, normalizedLanguage));
            }
            packs.push(await this.loadPagePack(normalizedPageCode, normalizedLanguage));
            if (requestedLanguageRevision !== languageRevision) return {};

            const mergedPack = packs.reduce((merged, pack) => ({
                ...merged,
                ...pack,
                labels: {
                    ...safeObject(merged.labels),
                    ...safeObject(pack.labels)
                },
                messages: {
                    ...safeObject(merged.messages),
                    ...safeObject(pack.messages)
                },
                selectors: {
                    ...safeObject(merged.selectors),
                    ...safeObject(pack.selectors),
                    text: {
                        ...safeObject(safeObject(merged.selectors).text),
                        ...safeObject(safeObject(pack.selectors).text)
                    },
                    title: {
                        ...safeObject(safeObject(merged.selectors).title),
                        ...safeObject(safeObject(pack.selectors).title)
                    },
                    placeholder: {
                        ...safeObject(safeObject(merged.selectors).placeholder),
                        ...safeObject(safeObject(pack.selectors).placeholder)
                    },
                    value: {
                        ...safeObject(safeObject(merged.selectors).value),
                        ...safeObject(safeObject(pack.selectors).value)
                    },
                    ariaLabel: {
                        ...safeObject(safeObject(merged.selectors).ariaLabel),
                        ...safeObject(safeObject(pack.selectors).ariaLabel)
                    },
                    dataPlaceholder: {
                        ...safeObject(safeObject(merged.selectors).dataPlaceholder),
                        ...safeObject(safeObject(pack.selectors).dataPlaceholder)
                    }
                }
            }), {});
            mergedPagePackCache.set(mergedCacheKey, mergedPack);
            this.installPagePack(normalizedPageCode, mergedPack);
            return mergedPack;
        },

        async loadPagePack(pageCode, languageCode) {
            const normalizedPageCode = String(pageCode || "").trim();
            const normalizedLanguage = normalizeLanguageCode(languageCode);
            const cacheKey = `${normalizedLanguage}:${normalizedPageCode}`;
            if (!pagePackCache.has(cacheKey)) {
                pagePackCache.set(cacheKey, fetchJsonOrEmpty(`./i18n/pages/${normalizedPageCode}.${normalizedLanguage}.json`));
            }
            const pack = safeObject(await pagePackCache.get(cacheKey));
            pagePackCache.set(cacheKey, pack);
            return pack;
        },

        getPageLabelsSync(pageCode, languageCode = this.getCurrentLanguage()) {
            const cacheKey = `${normalizeLanguageCode(languageCode)}:${String(pageCode || "").trim()}`;
            const cached = pagePackCache.get(cacheKey);
            if (!cached || typeof cached.then === "function") return {};
            return safeObject(cached.labels);
        },

        installPagePack(pageCode, pack) {
            const labels = safeObject(pack.labels);
            window[`${pageCode}_PAGE_I18N`] = pack;
            if (Object.keys(labels).length) {
                window[`${pageCode}_WORK_UI_LABELS`] = labels;
                window[`${pageCode}_FLOW_UI_LABELS`] = labels;
            }
        },

        applyPagePack(pageCode, root = document) {
            const normalizedPageCode = String(pageCode || "").trim();
            if (!normalizedPageCode || !root) return false;
            const state = getPageTranslationState(root);
            const pendingRecords = state?.observer?.takeRecords?.() || [];
            if (pendingRecords.length) {
                state.dirty = true;
                state.observer?.disconnect();
            }
            if (
                state
                && !state.dirty
                && state.pageCode === normalizedPageCode
                && state.languageRevision === languageRevision
            ) {
                return false;
            }

            state?.observer?.disconnect();
            state?.observer?.takeRecords?.();
            const pack = safeObject(window[`${normalizedPageCode}_PAGE_I18N`]);
            this.applyElementLabels(root, safeObject(pack.labels));
            this.applyScopedSelectorTranslations(root, safeObject(pack.selectors));
            if (state) {
                state.pageCode = normalizedPageCode;
                state.languageRevision = languageRevision;
                state.dirty = false;
                state.observer?.takeRecords?.();
                observePageTranslationRoot(root, state);
            }
            return true;
        },

        releasePageRoot(root) {
            if (!root) return;
            Array.from(shellTranslatedElements.keys()).forEach((element) => {
                if (!element?.isConnected || element === root || root.contains?.(element)) {
                    shellTranslatedElements.delete(element);
                }
            });
            const owner = getPageSectionOwner(root);
            if (owner === root) {
                const descendants = pageTranslationDescendants.get(owner);
                Array.from(descendants || []).forEach((innerRoot) => {
                    releaseTranslationState(innerRoot);
                    pageTranslationOwners.delete(innerRoot);
                });
                descendants?.clear();
                pageTranslationDescendants.delete(owner);
            } else if (owner) {
                const descendants = pageTranslationDescendants.get(owner);
                descendants?.delete(root);
                if (descendants && !descendants.size) pageTranslationDescendants.delete(owner);
                pageTranslationOwners.delete(root);
            }
            releaseTranslationState(root);
            pageCommonPackStates.delete(root);
        },

        acceptPageRootState(root) {
            const state = root ? pageTranslationStates.get(root) : null;
            if (!state) return;
            state.observer?.disconnect();
            state.observer?.takeRecords?.();
            state.dirty = false;
            observePageTranslationRoot(root, state);
        },

        applyElementLabels(root, labels = {}) {
            const safeLabels = safeObject(labels);
            const hasLabel = (key) => Object.prototype.hasOwnProperty.call(safeLabels, key);
            const getLabel = (key) => hasLabel(key) ? String(safeLabels[key] ?? "") : "";
            const apply = (selector, dataKey, callback) => {
                root.querySelectorAll?.(selector).forEach((element) => {
                    const key = element.dataset?.[dataKey] || "";
                    if (!hasLabel(key)) return;
                    callback(element, getLabel(key));
                });
            };
            apply("[data-label-key]", "labelKey", (element, value) => {
                element.textContent = value;
            });
            apply("[data-title-key]", "titleKey", (element, value) => {
                element.setAttribute("title", value);
                if (element.hasAttribute("aria-label")) element.setAttribute("aria-label", value);
            });
            apply("[data-placeholder-key]", "placeholderKey", (element, value) => {
                element.setAttribute("placeholder", value);
            });
            apply("[data-value-key]", "valueKey", (element, value) => {
                if ("value" in element) element.value = value;
                else element.setAttribute("value", value);
            });
            apply("[data-aria-label-key]", "ariaLabelKey", (element, value) => {
                element.setAttribute("aria-label", value);
            });
        },

        applyScopedSelectorTranslations(root, selectorPack = {}) {
            const safePack = safeObject(selectorPack);
            const apply = (groupName, callback) => {
                const group = safeObject(safePack[groupName]);
                Object.entries(group).forEach(([selector, value]) => {
                    try {
                        root.querySelectorAll?.(selector).forEach((element) => {
                            callback(element, String(value ?? ""));
                        });
                    } catch (error) {
                        console.warn(`[i18n] Invalid page selector skipped: ${selector}`, error);
                    }
                });
            };

            apply("text", (element, value) => {
                element.textContent = value;
            });
            apply("title", (element, value) => {
                element.setAttribute("title", value);
                if (element.hasAttribute("aria-label")) element.setAttribute("aria-label", value);
            });
            apply("placeholder", (element, value) => {
                element.setAttribute("placeholder", value);
            });
            apply("value", (element, value) => {
                if ("value" in element) element.value = value;
            });
            apply("ariaLabel", (element, value) => {
                element.setAttribute("aria-label", value);
            });
            apply("dataPlaceholder", (element, value) => {
                element.setAttribute("data-placeholder", value);
            });
        },

        applyCommonPack(pack = {}) {
            const safePack = safeObject(pack);
            this.applyMenuTranslations(safeObject(safePack.menus));
            this.applySelectorTranslations(safeObject(safePack.shell));
        },

        applyCommonPackForPage(root, pack = {}, force = false) {
            if (!root) {
                this.applyCommonPack(pack);
                return true;
            }
            if (!force && pageCommonPackStates.get(root) === languageRevision) return false;
            Array.from(shellTranslatedElements.keys()).forEach((element) => {
                if (!element?.isConnected) shellTranslatedElements.delete(element);
            });
            this.applySelectorTranslations(safeObject(safeObject(pack).shell), root, false);
            pageCommonPackStates.set(root, languageRevision);
            return true;
        },

        applyMenuTranslations(menuPack = {}) {
            const menus = Array.isArray(window.MENU_CONFIG) ? window.MENU_CONFIG : [];
            const languageCode = this.getCurrentLanguage();

            const visit = (items) => {
                (items || []).forEach((menu) => {
                    rememberBaseMenu(menu);
                    const base = menu._i18nBase || {};
                    const key = menu.page || menu.key || "";
                    const translated = safeObject(menuPack[key]);

                    if (languageCode === DEFAULT_LANGUAGE || !Object.keys(translated).length) {
                        menu.label = base.label;
                        menu.title = base.title;
                    } else {
                        menu.label = translated.label || base.label;
                        menu.title = translated.title || base.title;
                    }

                    if (Array.isArray(menu.children)) visit(menu.children);
                });
            };

            visit(menus);
        },

        applySelectorTranslations(shellPack = {}, root = document, restoreExisting = true) {
            if (restoreExisting) restoreShellTranslations();
            const apply = (groupName, callback) => {
                const group = safeObject(shellPack[groupName]);
                Object.entries(group).forEach(([selector, value]) => {
                    try {
                        const elements = Array.from(root.querySelectorAll?.(selector) || []);
                        if (root.nodeType === 1 && root.matches?.(selector)) elements.unshift(root);
                        elements.forEach((element) => {
                            getShellElementState(element);
                            if (!shellTranslatedElements.has(element)) {
                                shellTranslatedElements.set(element, new Set());
                            }
                            shellTranslatedElements.get(element).add(groupName);
                            callback(element, String(value ?? ""));
                        });
                    } catch (error) {
                        console.warn(`[i18n] Invalid selector skipped: ${selector}`, error);
                    }
                });
            };

            apply("text", (element, value) => {
                element.textContent = value;
            });
            apply("title", (element, value) => {
                element.setAttribute("title", value);
                if (element.hasAttribute("aria-label")) element.setAttribute("aria-label", value);
            });
            apply("placeholder", (element, value) => {
                element.setAttribute("placeholder", value);
            });
            apply("value", (element, value) => {
                if ("value" in element) element.value = value;
            });
            apply("ariaLabel", (element, value) => {
                element.setAttribute("aria-label", value);
            });
        },

        t(path, fallback = "") {
            const value = getByPath(this.commonPack, path);
            return typeof value === "string" && value ? value : fallback;
        },

        tPage(pageCode, key, fallback = "") {
            const pack = safeObject(window[`${String(pageCode || "").trim()}_PAGE_I18N`]);
            const labels = safeObject(pack.labels);
            return Object.prototype.hasOwnProperty.call(labels, key) ? String(labels[key] ?? "") : fallback;
        },

        getActivePageCode() {
            const activeSection = document.querySelector("#pageContainerHolder .page-section.active[id^='page-section-']");
            const sectionId = activeSection?.id || "";
            return sectionId.startsWith("page-section-") ? sectionId.slice("page-section-".length) : "";
        },

        translateMessage(message) {
            const original = String(message ?? "");
            const key = original.replace(/\s+/g, " ").trim();
            if (this.getCurrentLanguage() === DEFAULT_LANGUAGE) return "";
            if (!key || /[\uAC00-\uD7A3]/.test(key)) return "";

            const pageCode = this.getActivePageCode();
            const pageMessages = safeObject(safeObject(window[`${pageCode}_PAGE_I18N`]).messages);
            const pageTranslated = pageMessages[key];
            if (typeof pageTranslated === "string") return pageTranslated;

            const translated = safeObject(this.commonPack.messages)[key];
            return typeof translated === "string" ? translated : "";
        },

        updateLanguageBadge(languageCode = this.getCurrentLanguage()) {
            const badge = document.getElementById("currentLanguageBadge");
            if (!badge) return;
            const normalized = normalizeLanguageCode(languageCode);
            const label = normalized === "ko" ? "KOR" : "ENG";
            badge.textContent = label;
            badge.title = normalized === "ko" ? "Language: Korean" : "Language: English";
            badge.dataset.language = normalized;
        }
    };

    window.I18nManager = I18nManager;
})();
