(function() {
    const DEFAULT_LANGUAGE = "en";
    const LANGUAGE_STORAGE_KEY = "initLanguageCode";
    const SUPPORTED_LANGUAGES = new Set(["en", "ko"]);
    const commonPackCache = new Map();
    const pagePackCache = new Map();
    const shellBaseState = new WeakMap();
    let shellTranslatedElements = new Map();
    let languageReadyPromise = Promise.resolve(DEFAULT_LANGUAGE);
    let languageLoading = false;

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
            sessionStorage.removeItem(LANGUAGE_STORAGE_KEY);
            this.currentLanguage = DEFAULT_LANGUAGE;
            this.commonPack = {};
            document.documentElement.lang = "en";
            this.applyCommonPack({});
            this.updateLanguageBadge(DEFAULT_LANGUAGE);
        },

        async initFromSession() {
            return trackLanguageTask((async () => {
                const canUseSessionLanguage = hasAuthenticatedSession();
                if (!canUseSessionLanguage) sessionStorage.removeItem(LANGUAGE_STORAGE_KEY);
                const stored = canUseSessionLanguage ? sessionStorage.getItem(LANGUAGE_STORAGE_KEY) : "";
                const languageCode = stored ? normalizeLanguageCode(stored) : DEFAULT_LANGUAGE;
                await this.applyLanguageNow(languageCode);
                return languageCode;
            })());
        },

        async loadLanguageFromUserSettings() {
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
                await this.applyLanguageNow(languageCode);
                return languageCode;
            })());
        },

        async applyLanguage(languageCode) {
            return trackLanguageTask(this.applyLanguageNow(languageCode));
        },

        async applyLanguageNow(languageCode) {
            const normalized = this.setSessionLanguage(languageCode);
            pagePackCache.clear();
            commonPackCache.delete(normalized);
            this.commonPack = await this.loadCommonPack(normalized);
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
            if (!normalizedPageCode || normalizedLanguage === DEFAULT_LANGUAGE) {
                delete window[`${normalizedPageCode}_WORK_UI_LABELS`];
                delete window[`${normalizedPageCode}_PAGE_I18N`];
                return {};
            }

            const packs = [];
            for (const commonPageCode of getCommonPagePackCodes(normalizedPageCode)) {
                packs.push(await this.loadPagePack(commonPageCode, normalizedLanguage));
            }
            packs.push(await this.loadPagePack(normalizedPageCode, normalizedLanguage));

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
            if (!normalizedPageCode || !root) return;
            const pack = safeObject(window[`${normalizedPageCode}_PAGE_I18N`]);
            this.applyElementLabels(root, safeObject(pack.labels));
            this.applyScopedSelectorTranslations(root, safeObject(pack.selectors));
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

        applySelectorTranslations(shellPack = {}) {
            restoreShellTranslations();
            const apply = (groupName, callback) => {
                const group = safeObject(shellPack[groupName]);
                Object.entries(group).forEach(([selector, value]) => {
                    try {
                        document.querySelectorAll(selector).forEach((element) => {
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
