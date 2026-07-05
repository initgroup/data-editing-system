(function() {
    const STORAGE_KEY = "initAssetCacheVersionConfig";

    function normalizeAssetPath(path) {
        return String(path || "")
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/^\/+/, "")
            .replace(/^frontend\//, "");
    }

    function getWindowConfig(sourceWindow = window) {
        try {
            const version = sourceWindow.APP_CACHE_VERSION || "";
            const overrides = sourceWindow.APP_ASSET_VERSION_OVERRIDES || {};
            return {
                version: String(version || ""),
                overrides: overrides && typeof overrides === "object" ? { ...overrides } : {}
            };
        } catch (_error) {
            return { version: "", overrides: {} };
        }
    }

    function readStoredConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { version: "", overrides: {} };
            const config = JSON.parse(raw);
            return {
                version: String(config.version || ""),
                overrides: config.overrides && typeof config.overrides === "object" ? config.overrides : {},
                publishedAt: config.publishedAt || ""
            };
        } catch (_error) {
            return { version: "", overrides: {} };
        }
    }

    function publishConfig(sourceWindow = window) {
        const config = getWindowConfig(sourceWindow);
        if (!config.version) return config;
        const payload = {
            ...config,
            publishedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (_error) {
            // Version display is diagnostic only; ignore storage failures.
        }
        return payload;
    }

    function getConfig(sourceWindow = window) {
        const config = getWindowConfig(sourceWindow);
        if (config.version) return config;
        return readStoredConfig();
    }

    function getAssetVersion(path, sourceWindow = window) {
        const normalized = normalizeAssetPath(path);
        const config = getConfig(sourceWindow);
        return String(config.overrides?.[normalized] || config.version || "");
    }

    function getAssetVersionSource(path, sourceWindow = window) {
        const normalized = normalizeAssetPath(path);
        const config = getConfig(sourceWindow);
        if (config.overrides && Object.prototype.hasOwnProperty.call(config.overrides, normalized)) {
            return "override";
        }
        return config.version ? "default" : "unknown";
    }

    function getAssetUrl(path, sourceWindow = window) {
        const value = String(path || "");
        const version = getAssetVersion(value, sourceWindow);
        if (!version) return value;
        const separator = value.includes("?") ? "&" : "?";
        return `${value}${separator}v=${encodeURIComponent(version)}`;
    }

    function buildRows(items = [], sourceWindow = window) {
        const seen = new Set();
        return items
            .map((item) => typeof item === "string" ? { label: item, path: item } : item)
            .filter((item) => item && item.path)
            .map((item) => {
                const normalizedPath = normalizeAssetPath(item.path);
                return {
                    label: item.label || normalizedPath,
                    path: normalizedPath,
                    version: getAssetVersion(normalizedPath, sourceWindow),
                    source: getAssetVersionSource(normalizedPath, sourceWindow)
                };
            })
            .filter((row) => {
                const key = `${row.label}:${row.path}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    window.AssetCacheVersionUtils = {
        STORAGE_KEY,
        normalizeAssetPath,
        publishConfig,
        readStoredConfig,
        getConfig,
        getAssetVersion,
        getAssetVersionSource,
        getAssetUrl,
        buildRows
    };

    publishConfig();
})();
