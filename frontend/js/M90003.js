(function() {
    const PAGE_CODE = "M90003";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const getPageContainer = () => document.getElementById(`container-${PAGE_CODE}`);
    const TYPE_GROUPS = ["CATEGORICAL", "CONTINUOUS", "OTHER"];
    const CANONICAL_TYPES = [
        "NUM_IDENTIFIER",
        "CHAR_IDENTIFIER",
        "NUM_CONTINUOUS",
        "NUM_DISCRETE",
        "CAT_GENERAL",
        "CAT_CHAR",
        "CAT_ORDINAL",
        "CAT_NUMERIC",
        "FREE_TEXT",
        "OTHER",
        "UNKNOWN"
    ];
    const TYPE_GROUP_FALLBACK = {
        NUM_IDENTIFIER: "OTHER",
        CHAR_IDENTIFIER: "OTHER",
        NUM_CONTINUOUS: "CONTINUOUS",
        NUM_DISCRETE: "CONTINUOUS",
        CAT_GENERAL: "CATEGORICAL",
        CAT_CHAR: "CATEGORICAL",
        CAT_ORDINAL: "CATEGORICAL",
        CAT_NUMERIC: "CATEGORICAL",
        FREE_TEXT: "OTHER",
        OTHER: "OTHER",
        UNKNOWN: "OTHER"
    };

    function t(key, fallback, values = {}) {
        const pack = window[`${PAGE_CODE}_PAGE_I18N`] || {};
        const labels = pack.labels || {};
        const messages = pack.messages || {};
        let text = typeof labels[key] === "string"
            ? labels[key]
            : (typeof messages[key] === "string" ? messages[key] : fallback);
        Object.entries(values || {}).forEach(([name, value]) => {
            text = String(text).replaceAll(`{${name}}`, String(value ?? ""));
        });
        return String(text ?? "");
    }

    const M90003 = {
        isInit: false,
        generation: 0,
        clickHandler: null,
        changeHandler: null,
        keydownHandler: null,
        submitHandler: null,
        activeTab: "overview",
        summary: {},
        datasetStats: {},
        modelFamilies: [],
        selectedModelKey: "COLUMN_TYPE",
        models: [],
        datasetRows: [],
        runRows: [],
        datasetPage: 1,
        datasetPageSize: 50,
        datasetTotal: 0,
        runPage: 1,
        runPageSize: 50,
        runTotal: 0,
        loadedTabs: new Set(),
        loading: new Set(),

        async init() {
            if (this.isInit) return;
            this.isInit = true;
            this.generation += 1;
            this.bindEvents();
            this.renderLoadingState();
            await this.loadModelFamilies();
            if (!this.isInit) return;
            await Promise.allSettled([
                this.loadSummary(),
                this.loadDatasetStats(),
                this.loadModels()
            ]);
            if (!this.isInit) return;
            this.loadedTabs.add("overview");
            this.loadedTabs.add("train");
            this.renderOverview();
            this.renderCandidateComparison();
        },

        destroy() {
            const container = getPageContainer();
            if (container && this.clickHandler) container.removeEventListener("click", this.clickHandler);
            if (container && this.changeHandler) container.removeEventListener("change", this.changeHandler);
            if (container && this.keydownHandler) container.removeEventListener("keydown", this.keydownHandler);
            const form = getContainerEl("#trainForm-M90003");
            if (form && this.submitHandler) form.removeEventListener("submit", this.submitHandler);
            this.isInit = false;
            this.generation += 1;
            this.clickHandler = null;
            this.changeHandler = null;
            this.keydownHandler = null;
            this.submitHandler = null;
            this.activeTab = "overview";
            this.summary = {};
            this.datasetStats = {};
            this.modelFamilies = [];
            this.selectedModelKey = "COLUMN_TYPE";
            this.models = [];
            this.datasetRows = [];
            this.runRows = [];
            this.datasetPage = 1;
            this.datasetTotal = 0;
            this.runPage = 1;
            this.runTotal = 0;
            this.loadedTabs = new Set();
            this.loading = new Set();
        },

        bindEvents() {
            const container = getPageContainer();
            if (!container) return;
            this.clickHandler = (event) => {
                const button = event.target.closest("[data-action], [data-tab]");
                if (!button || !container.contains(button)) return;
                if (button.dataset.tab) {
                    this.openTab(button.dataset.tab);
                    return;
                }
                this.handleAction(button.dataset.action, button);
            };
            this.changeHandler = (event) => {
                if (event.target.matches("#modelFamily-M90003")) {
                    this.selectModelFamily(event.target.value);
                } else if (event.target.matches("[data-filter='dataset']")) {
                    this.datasetPage = 1;
                    this.loadDataset();
                } else if (event.target.matches("[data-page-size='dataset']")) {
                    this.datasetPageSize = this.boundInteger(event.target.value, 25, 100, 50);
                    this.datasetPage = 1;
                    this.loadDataset();
                } else if (event.target.matches("#trainMinRows-M90003")) {
                    this.renderTrainingReadiness();
                }
            };
            this.keydownHandler = (event) => {
                if (event.key === "Enter" && event.target.matches("[data-search='dataset']")) {
                    event.preventDefault();
                    this.datasetPage = 1;
                    this.loadDataset();
                } else if (event.key === "Enter" && event.target.matches("[data-page-input]")) {
                    event.preventDefault();
                    this.applyPageInput(event.target.dataset.pageInput);
                }
            };
            this.submitHandler = (event) => {
                event.preventDefault();
                this.startTraining();
            };
            container.addEventListener("click", this.clickHandler);
            container.addEventListener("change", this.changeHandler);
            container.addEventListener("keydown", this.keydownHandler);
            getContainerEl("#trainForm-M90003")?.addEventListener("submit", this.submitHandler);
        },

        async openTab(tabName) {
            const allowed = new Set(["overview", "dataset", "train", "versions", "runs"]);
            const tab = allowed.has(tabName) ? tabName : "overview";
            this.activeTab = tab;
            getPageContainer()?.querySelectorAll("[data-tab]").forEach((button) => {
                const selected = button.dataset.tab === tab;
                button.classList.toggle("is-active", selected);
                button.setAttribute("aria-selected", selected ? "true" : "false");
            });
            getPageContainer()?.querySelectorAll("[data-panel]").forEach((panel) => {
                const selected = panel.dataset.panel === tab;
                panel.classList.toggle("is-active", selected);
                panel.hidden = !selected;
            });
            this.updateTabNavigation();
            this.ensureActiveTabVisible(tab);
            if (this.loadedTabs.has(tab)) return;
            if (tab === "dataset") await this.loadDataset();
            if (tab === "versions") await this.loadModels();
            if (tab === "runs") await this.loadRuns();
            this.loadedTabs.add(tab);
        },

        async handleAction(action, button) {
            if (!action || button?.disabled) return;
            if (action === "refresh-all") return this.refreshAll();
            if (action === "tab-prev") return this.moveTab(-1);
            if (action === "tab-next") return this.moveTab(1);
            if (action === "refresh-dataset") return Promise.allSettled([this.loadDatasetStats(), this.loadDataset()]);
            if (action === "search-dataset") {
                this.datasetPage = 1;
                return this.loadDataset();
            }
            if (action === "dataset-prev") return this.changePage("dataset", -1);
            if (action === "dataset-next") return this.changePage("dataset", 1);
            if (action === "refresh-models") return this.loadModels();
            if (action === "rollback-current") return this.rollbackCurrentModel();
            if (action === "refresh-runs") return this.loadRuns();
            if (action === "runs-prev") return this.changePage("runs", -1);
            if (action === "runs-next") return this.changePage("runs", 1);
            const modelId = button?.dataset.modelId || "";
            if (action === "activate-model") return this.activateModel(modelId, false);
            if (action === "rollback-model") return this.rollbackCurrentModel();
            if (action === "archive-model") return this.archiveModel(modelId);
        },

        moveTab(direction) {
            const tabs = Array.from(getPageContainer()?.querySelectorAll("[data-tab]") || [])
                .filter((tab) => !tab.hidden && !tab.disabled);
            const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.dataset.tab === this.activeTab));
            const next = tabs[currentIndex + direction];
            if (next) this.openTab(next.dataset.tab);
        },

        updateTabNavigation() {
            const tabs = Array.from(getPageContainer()?.querySelectorAll("[data-tab]") || [])
                .filter((tab) => !tab.hidden && !tab.disabled);
            const currentIndex = tabs.findIndex((tab) => tab.dataset.tab === this.activeTab);
            const previous = getPageContainer()?.querySelector('[data-action="tab-prev"]');
            const next = getPageContainer()?.querySelector('[data-action="tab-next"]');
            if (previous) previous.disabled = currentIndex <= 0;
            if (next) next.disabled = currentIndex < 0 || currentIndex >= tabs.length - 1;
        },

        ensureActiveTabVisible(tabName) {
            const tab = getPageContainer()?.querySelector(`[data-tab="${tabName}"]`);
            tab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        },

        async refreshAll() {
            this.loadedTabs.clear();
            await this.loadModelFamilies();
            if (!this.isInit) return;
            const tasks = [this.loadSummary(), this.loadDatasetStats(), this.loadModels()];
            if (this.activeTab === "dataset") tasks.push(this.loadDataset());
            if (this.activeTab === "runs") tasks.push(this.loadRuns());
            await Promise.allSettled(tasks);
            this.loadedTabs.add("overview");
            this.loadedTabs.add("train");
            this.loadedTabs.add(this.activeTab);
            this.showMessage("success", t("refreshed", "Refreshed."), 1800);
        },

        async loadModelFamilies() {
            const generation = this.generation;
            try {
                const json = await this.request("/families");
                if (!this.isCurrent(generation)) return;
                const rows = this.unwrapRows(json).rows;
                this.modelFamilies = rows.length ? rows : [this.defaultColumnTypeFamily()];
            } catch (error) {
                if (!this.isCurrent(generation)) return;
                this.modelFamilies = [this.defaultColumnTypeFamily()];
                this.showMessage("error", error.message || t("modelFamiliesLoadFailed", "Model families could not be loaded."));
            }
            if (!this.modelFamilies.some((family) => this.familyKey(family) === this.selectedModelKey)) {
                this.selectedModelKey = this.familyKey(this.modelFamilies[0]) || "COLUMN_TYPE";
            }
            this.renderModelFamilies();
            this.applyModelFamilyCapabilities();
        },

        async selectModelFamily(modelKey) {
            const nextKey = String(modelKey || "").trim().toUpperCase();
            if (!nextKey || nextKey === this.selectedModelKey) return;
            this.selectedModelKey = nextKey;
            this.summary = {};
            this.datasetStats = {};
            this.models = [];
            this.runRows = [];
            this.datasetRows = [];
            this.datasetPage = 1;
            this.runPage = 1;
            this.loadedTabs.clear();
            this.applyModelFamilyCapabilities();
            this.renderLoadingState();
            const tasks = [this.loadSummary(), this.loadModels()];
            if (this.currentFamily()?.supportsDataset) tasks.push(this.loadDatasetStats());
            if (this.activeTab === "runs") tasks.push(this.loadRuns());
            await Promise.allSettled(tasks);
            this.loadedTabs.add("overview");
            this.loadedTabs.add("train");
            this.renderOverview();
            this.renderCandidateComparison();
        },

        async loadSummary() {
            const generation = this.generation;
            try {
                const json = await this.request(`/summary?modelKey=${encodeURIComponent(this.selectedModelKey)}`);
                if (!this.isCurrent(generation)) return;
                this.summary = this.unwrapObject(json);
                this.updateTargetDbLabel();
                this.renderOverview();
            } catch (error) {
                if (!this.isCurrent(generation)) return;
                this.summary = {};
                this.renderOverview();
                this.showMessage("error", error.message || t("summaryLoadFailed", "Model summary could not be loaded."));
            }
        },

        async loadDatasetStats() {
            if (!this.currentFamily()?.supportsDataset) {
                this.datasetStats = {};
                return;
            }
            const generation = this.generation;
            try {
                const json = await this.requestWithGetFallback(["/dataset/stats", "/dataset/distribution"]);
                if (!this.isCurrent(generation)) return;
                this.datasetStats = this.unwrapObject(json);
                this.renderOverview();
            } catch (error) {
                if (!this.isCurrent(generation)) return;
                this.datasetStats = {};
                this.renderOverview();
                this.showMessage("error", error.message || t("datasetStatsLoadFailed", "Dataset statistics could not be loaded."));
            }
        },

        async loadDataset() {
            if (this.loading.has("dataset")) return;
            this.loading.add("dataset");
            const generation = this.generation;
            this.renderTableLoading("#datasetBody-M90003", 12);
            try {
                const params = new URLSearchParams({
                    page: String(this.datasetPage),
                    pageSize: String(this.datasetPageSize),
                    status: getContainerEl("#datasetStatus-M90003")?.value || "ELIGIBLE"
                });
                const typeGroupCode = getContainerEl("#datasetGroup-M90003")?.value || "";
                const keyword = (getContainerEl("#datasetKeyword-M90003")?.value || "").trim();
                if (typeGroupCode) params.set("typeGroupCode", typeGroupCode);
                if (keyword) params.set("keyword", keyword);
                const query = `?${params.toString()}`;
                const json = await this.requestWithGetFallback([`/dataset${query}`, `/labels${query}`]);
                if (!this.isCurrent(generation)) return;
                const result = this.unwrapRows(json);
                this.datasetRows = result.rows;
                this.datasetTotal = result.total;
                this.datasetPage = result.page || this.datasetPage;
                this.datasetPageSize = result.pageSize || this.datasetPageSize;
                this.renderDataset();
                this.loadedTabs.add("dataset");
            } catch (error) {
                if (!this.isCurrent(generation)) return;
                this.datasetRows = [];
                this.datasetTotal = 0;
                this.renderDataset(error.message || t("datasetLoadFailed", "Training data could not be loaded."));
            } finally {
                this.loading.delete("dataset");
            }
        },

        async loadModels() {
            if (this.loading.has("models")) return;
            this.loading.add("models");
            const generation = this.generation;
            this.renderTableLoading("#modelsBody-M90003", 11);
            try {
                const json = await this.request(`/models?modelKey=${encodeURIComponent(this.selectedModelKey)}`);
                if (!this.isCurrent(generation)) return;
                this.models = this.unwrapRows(json).rows;
                this.renderModels();
                this.renderCandidateComparison();
                this.loadedTabs.add("versions");
            } catch (error) {
                if (!this.isCurrent(generation)) return;
                this.models = [];
                this.renderModels(error.message || t("modelsLoadFailed", "Model versions could not be loaded."));
                this.renderCandidateComparison();
            } finally {
                this.loading.delete("models");
            }
        },

        async loadRuns() {
            if (this.loading.has("runs")) return;
            this.loading.add("runs");
            const generation = this.generation;
            this.renderTableLoading("#runsBody-M90003", 14);
            try {
                const params = new URLSearchParams({
                    modelKey: this.selectedModelKey,
                    page: String(this.runPage),
                    pageSize: String(this.runPageSize)
                });
                const json = await this.request(`/runs?${params.toString()}`);
                if (!this.isCurrent(generation)) return;
                const result = this.unwrapRows(json);
                this.runRows = result.rows;
                this.runTotal = result.total;
                this.runPage = result.page || this.runPage;
                this.runPageSize = result.pageSize || this.runPageSize;
                this.renderRuns();
                this.loadedTabs.add("runs");
            } catch (error) {
                if (!this.isCurrent(generation)) return;
                this.runRows = [];
                this.runTotal = 0;
                this.renderRuns(error.message || t("runsLoadFailed", "Training runs could not be loaded."));
            } finally {
                this.loading.delete("runs");
            }
        },

        async startTraining() {
            const form = getContainerEl("#trainForm-M90003");
            const button = getContainerEl("#startTrainingBtn-M90003");
            if (button?.disabled) return;
            if (!form?.reportValidity()) return;
            const payload = {
                modelKey: this.selectedModelKey,
                algorithmCode: getContainerEl("#trainAlgorithm-M90003")?.value || "DECISION_TREE",
                featureVersion: (getContainerEl("#trainFeatureVersion-M90003")?.value || "V2").trim(),
                maxRows: this.boundInteger(getContainerEl("#trainMaxRows-M90003")?.value, 100, 1000000, 25000),
                minConfirmedLabels: this.boundInteger(getContainerEl("#trainMinRows-M90003")?.value, 20, 100000, 30),
                seed: this.boundInteger(getContainerEl("#trainSeed-M90003")?.value, 1, 2147483647, 42),
                holdoutRatio: this.boundNumber(getContainerEl("#trainHoldout-M90003")?.value, 0.1, 0.4, 0.2),
                confirmedGoldOnly: true
            };
            const message = t(
                "confirmStartTraining",
                "Start {algorithm} training with at most {rows} confirmed gold labels?",
                { algorithm: payload.algorithmCode, rows: this.formatInteger(payload.maxRows) }
            );
            if (!(await this.confirm(message))) return;
            this.setButtonLoading(button, true, t("startingTraining", "Starting..."));
            try {
                await this.request("/train", { method: "POST", body: payload });
                this.showMessage("success", t("trainingStarted", "Candidate training started. The champion remains unchanged."));
                this.runPage = 1;
                await Promise.allSettled([this.loadRuns(), this.loadModels()]);
                await this.openTab("runs");
            } catch (error) {
                this.showMessage("error", error.message || t("trainingStartFailed", "Training could not be started."));
            } finally {
                this.setButtonLoading(button, false);
                this.renderTrainingReadiness();
            }
        },

        async activateModel(modelId) {
            if (!modelId) return;
            const model = this.models.find((item) => String(this.pick(item, "id", "modelId", "MODEL_ID", "modelVersionId", "MODEL_VERSION_ID")) === String(modelId));
            const version = this.pick(model, "modelVersion", "MODEL_VERSION", "version") || modelId;
            const message = t("confirmActivateModel", "Activate candidate version {version} as the new champion?", { version });
            if (!(await this.confirm(message))) return;
            try {
                await this.request(`/models/${encodeURIComponent(modelId)}/activate`, {
                    method: "POST",
                    body: { reason: "M90003 explicit activation" }
                });
                this.showMessage("success", t("modelActivated", "The candidate is now the active champion."));
                await Promise.allSettled([this.loadSummary(), this.loadModels()]);
            } catch (error) {
                this.showMessage("error", error.message || t("modelActivationFailed", "Model activation failed."));
            }
        },

        async rollbackCurrentModel() {
            const active = this.models.find((row) => ["CHAMPION", "ACTIVE"].includes(String(this.pick(row, "status", "STATUS", "statusCode", "STATUS_CODE")).toUpperCase()));
            const version = this.pick(active, "modelVersion", "MODEL_VERSION", "version") || "-";
            if (!(await this.confirm(t("confirmRollbackCurrentModel", "Roll back the current champion version {version} to the most recent previous model?", { version })))) return;
            try {
                await this.request("/models/rollback", {
                    method: "POST",
                    body: { modelKey: this.selectedModelKey, reason: "M90003 explicit rollback" }
                });
                this.showMessage("success", t("modelRolledBack", "The model was rolled back safely."));
                await Promise.allSettled([this.loadSummary(), this.loadModels()]);
            } catch (error) {
                this.showMessage("error", error.message || t("modelRollbackFailed", "Model rollback failed."));
            }
        },

        async archiveModel(modelId) {
            if (!modelId) return;
            const model = this.models.find((item) => String(this.pick(item, "id", "modelId", "MODEL_ID", "modelVersionId", "MODEL_VERSION_ID")) === String(modelId));
            const version = this.pick(model, "modelVersion", "MODEL_VERSION", "version") || modelId;
            if (!(await this.confirm(t("confirmArchiveModel", "Archive model version {version}?", { version })))) return;
            try {
                await this.request(`/models/${encodeURIComponent(modelId)}/archive`, { method: "POST", body: {} });
                this.showMessage("success", t("modelArchived", "The model version was archived."));
                await this.loadModels();
            } catch (error) {
                this.showMessage("error", error.message || t("modelArchiveFailed", "Model archive failed."));
            }
        },

        defaultColumnTypeFamily() {
            return {
                modelKey: "COLUMN_TYPE",
                displayNameKey: "modelFamily_COLUMN_TYPE",
                supportsTraining: true,
                supportsDataset: true,
                trainerCode: "COLTYPE_V2",
                sourceProfileTable: "INIT$_TB_COLTYPE_PROFILE",
                sourceLabelTable: "INIT$_TB_COLTYPE_LABEL",
                consumerObject: "INIT$_SP_PREDICTED_TYPE",
                algorithms: ["DECISION_TREE", "RANDOM_FOREST"],
                featureVersions: ["V2"],
                defaultMinTrainRows: 30,
                modelCount: 0,
                runCount: 0
            };
        },

        familyKey(family) {
            return String(this.pick(family, "modelKey", "MODEL_KEY") || "").trim().toUpperCase();
        },

        currentFamily() {
            return this.modelFamilies.find((family) => this.familyKey(family) === this.selectedModelKey)
                || this.defaultColumnTypeFamily();
        },

        familyLabel(family) {
            const modelKey = this.familyKey(family);
            const labelKey = this.pick(family, "displayNameKey", "DISPLAY_NAME_KEY");
            return labelKey ? t(labelKey, modelKey) : modelKey.replaceAll("_", " ");
        },

        renderModelFamilies() {
            const select = getContainerEl("#modelFamily-M90003");
            if (select) {
                select.innerHTML = this.modelFamilies.map((family) => {
                    const modelKey = this.familyKey(family);
                    return `<option value="${this.escapeHtml(modelKey)}" ${modelKey === this.selectedModelKey ? "selected" : ""}>${this.escapeHtml(this.familyLabel(family))} · ${this.escapeHtml(modelKey)}</option>`;
                }).join("");
            }
            this.renderModelFamilyInfo();
        },

        renderModelFamilyInfo() {
            const element = getContainerEl("#modelFamilyInfo-M90003");
            if (!element) return;
            const family = this.currentFamily();
            const sourceProfile = this.pick(family, "sourceProfileTable", "SOURCE_PROFILE_TABLE");
            const sourceLabel = this.pick(family, "sourceLabelTable", "SOURCE_LABEL_TABLE");
            const consumer = this.pick(family, "consumerObject", "CONSUMER_OBJECT");
            const trainer = this.pick(family, "trainerCode", "TRAINER_CODE");
            const modelCount = this.pick(family, "modelCount", "MODEL_COUNT") || 0;
            const runCount = this.pick(family, "runCount", "RUN_COUNT") || 0;
            const sources = [sourceProfile, sourceLabel].filter(Boolean).map((value) => `<code>${this.escapeHtml(value)}</code>`).join(" · ") || "-";
            element.innerHTML = `
                <strong>${this.escapeHtml(this.familyLabel(family))}</strong>
                <span>${this.escapeHtml(t("modelFamilyKey", "Model Key"))}: <code>${this.escapeHtml(this.selectedModelKey)}</code></span>
                <span>${this.escapeHtml(t("trainingAdapter", "Training Adapter"))}: <code>${this.escapeHtml(trainer || t("notRegistered", "Not registered"))}</code></span>
                <span>${this.escapeHtml(t("trainingSources", "Training Sources"))}: ${sources}</span>
                <span>${this.escapeHtml(t("consumerObject", "Consumer"))}: <code>${this.escapeHtml(consumer || "-")}</code></span>
                <span>${this.escapeHtml(t("modelAndRunCounts", "{models} models · {runs} runs", { models: this.formatInteger(modelCount), runs: this.formatInteger(runCount) }))}</span>
            `;
        },

        applyModelFamilyCapabilities() {
            const family = this.currentFamily();
            const supportsDataset = this.asBoolean(this.pick(family, "supportsDataset", "SUPPORTS_DATASET"));
            const supportsTraining = this.asBoolean(this.pick(family, "supportsTraining", "SUPPORTS_TRAINING"));
            const datasetTab = getPageContainer()?.querySelector('[data-tab="dataset"]');
            const trainTab = getPageContainer()?.querySelector('[data-tab="train"]');
            if (datasetTab) datasetTab.hidden = !supportsDataset;
            if (trainTab) trainTab.hidden = !supportsTraining;
            getPageContainer()?.querySelectorAll("[data-column-type-only]").forEach((element) => {
                element.hidden = this.selectedModelKey !== "COLUMN_TYPE";
            });
            if ((!supportsDataset && this.activeTab === "dataset") || (!supportsTraining && this.activeTab === "train")) {
                this.openTab("overview");
            }
            this.configureTrainingForm(family, supportsTraining);
            this.renderModelFamilyInfo();
            this.updateTabNavigation();
        },

        configureTrainingForm(family, supportsTraining) {
            const algorithms = this.asArray(this.pick(family, "algorithms", "ALGORITHMS"));
            const featureVersions = this.asArray(this.pick(family, "featureVersions", "FEATURE_VERSIONS"));
            const algorithmSelect = getContainerEl("#trainAlgorithm-M90003");
            const featureSelect = getContainerEl("#trainFeatureVersion-M90003");
            if (algorithmSelect && algorithms.length) {
                algorithmSelect.innerHTML = algorithms.map((code) => `<option value="${this.escapeHtml(code)}">${this.escapeHtml(code)}</option>`).join("");
            }
            if (featureSelect && featureVersions.length) {
                featureSelect.innerHTML = featureVersions.map((code) => `<option value="${this.escapeHtml(code)}">${this.escapeHtml(code)}</option>`).join("");
            }
            this.setValue("#trainMinRows-M90003", this.pick(family, "defaultMinTrainRows", "DEFAULT_MIN_TRAIN_ROWS") || 30);
            const button = getContainerEl("#startTrainingBtn-M90003");
            if (button) button.disabled = !supportsTraining;
            this.renderTrainingReadiness();
        },

        renderTrainingReadiness() {
            const note = getContainerEl("#trainingReadiness-M90003");
            const button = getContainerEl("#startTrainingBtn-M90003");
            if (!note || !button) return;
            const family = this.currentFamily();
            if (!this.asBoolean(this.pick(family, "supportsTraining", "SUPPORTS_TRAINING"))) {
                note.className = "type-model-note is-warning";
                note.querySelector("span").textContent = t("trainingAdapterUnavailable", "No training adapter is registered for this model family.");
                button.disabled = true;
                return;
            }
            const typeRows = this.normalizeTypeDistribution().filter((row) => Number(row.count) > 0);
            const eligibleRows = typeRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
            const usableClasses = typeRows.filter((row) => Number(row.count) >= 2).length;
            const minimumRows = this.boundInteger(getContainerEl("#trainMinRows-M90003")?.value, 20, 100000, 30);
            const ready = eligibleRows >= minimumRows && usableClasses >= 2;
            note.className = `type-model-note ${ready ? "is-info" : "is-warning"}`;
            note.querySelector("span").textContent = ready
                ? t("trainingReady", "Training is ready with {rows} confirmed rows across {classes} usable classes.", { rows: this.formatInteger(eligibleRows), classes: usableClasses })
                : t("trainingNotReady", "Training requires at least {minimum} confirmed rows and two detailed type classes with two or more rows each. Current: {rows} rows, {classes} usable classes.", { minimum: minimumRows, rows: this.formatInteger(eligibleRows), classes: usableClasses });
            button.disabled = !ready;
        },

        renderLoadingState() {
            const cards = getContainerEl("#activeModelCards-M90003");
            if (cards) cards.innerHTML = this.loadingCards(6);
            const groups = getContainerEl("#groupDistribution-M90003");
            if (groups) groups.innerHTML = this.loadingCards(3);
            const quality = getContainerEl("#labelQuality-M90003");
            if (quality) quality.innerHTML = this.loadingCards(5);
            this.renderTableLoading("#typeDistributionBody-M90003", 4);
        },

        renderOverview() {
            this.renderActiveModel();
            this.renderGroupDistribution();
            this.renderLabelQuality();
            this.renderTypeDistribution();
            this.renderValidation();
            this.renderTrainingReadiness();
        },

        renderActiveModel() {
            const summary = this.summary || {};
            const active = this.pick(summary, "activeModel", "ACTIVE_MODEL", "champion", "CHAMPION") || {};
            const status = String(this.pick(active, "status", "STATUS") || this.pick(summary, "activeStatus", "ACTIVE_STATUS") || "NOT_SET").toUpperCase();
            const statusEl = getContainerEl("#activeStatus-M90003");
            if (statusEl) {
                statusEl.className = `type-model-status ${this.statusClass(status)}`;
                statusEl.textContent = this.statusLabel(status);
            }
            const modelName = this.pick(active, "physicalModelName", "PHYSICAL_MODEL_NAME", "modelName", "MODEL_NAME");
            const modelNameEl = getContainerEl("#activeModelName-M90003");
            if (modelNameEl) {
                const value = modelName || t("noActiveModelName", "No active model");
                modelNameEl.textContent = value;
                modelNameEl.title = value;
            }
            const metrics = [
                [t("modelVersion", "Model Version"), this.pick(active, "modelVersion", "MODEL_VERSION", "version") || "-"],
                [t("algorithm", "Algorithm"), this.pick(active, "algorithmCode", "ALGORITHM_CODE", "algorithm") || "-"],
                [t("featureVersion", "Feature Version"), this.pick(active, "featureVersion", "FEATURE_VERSION") || "-"],
                ["Macro F1", this.formatMetric(this.pick(active, "macroF1", "MACRO_F1"))],
                [t("balancedAccuracy", "Balanced Accuracy"), this.formatMetric(this.pick(active, "balancedAccuracy", "BALANCED_ACCURACY"))],
                [t("trainedAt", "Trained At"), this.formatDate(this.pick(active, "trainedAt", "TRAINED_AT", "createdAt", "CREATED_AT"))]
            ];
            const container = getContainerEl("#activeModelCards-M90003");
            if (container) container.innerHTML = metrics.map(([label, value]) => `
                <article class="type-model-metric">
                    <span>${this.escapeHtml(label)}</span>
                    <strong title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</strong>
                </article>
            `).join("");
        },

        renderGroupDistribution() {
            const rows = this.normalizeGroupDistribution();
            const container = getContainerEl("#groupDistribution-M90003");
            if (!container) return;
            container.innerHTML = rows.map((row) => `
                <article class="type-group-card is-${row.code.toLowerCase()}">
                    <div class="type-group-card-head">
                        <span class="type-group-dot"></span>
                        <strong>${this.escapeHtml(this.typeGroupLabel(row.code))}</strong>
                        <code>${this.escapeHtml(row.code)}</code>
                    </div>
                    <div class="type-group-percentage">${this.escapeHtml(this.formatPercent(row.percentage))}</div>
                    <div class="type-group-count">${this.escapeHtml(t("confirmedLabelsCount", "{count} confirmed labels", { count: this.formatInteger(row.count) }))}</div>
                    <div class="type-group-bar"><span style="width:${Math.min(100, Math.max(0, row.percentage))}%"></span></div>
                </article>
            `).join("");
        },

        renderLabelQuality() {
            const counts = this.pick(this.summary, "counts", "COUNTS", "labelCounts", "LABEL_COUNTS") || this.summary || {};
            const items = [
                ["eligible", t("eligibleConfirmed", "Eligible Confirmed"), this.pick(counts, "confirmedEligible", "CONFIRMED_ELIGIBLE", "eligibleConfirmed", "ELIGIBLE_CONFIRMED")],
                ["auto", t("excludedAutomatic", "Excluded Automatic"), this.pick(counts, "excludedAuto", "EXCLUDED_AUTO", "automaticExcluded", "AUTOMATIC_EXCLUDED")],
                ["legacy", t("excludedLegacy", "Excluded Legacy"), this.pick(counts, "excludedLegacy", "EXCLUDED_LEGACY", "legacyExcluded", "LEGACY_EXCLUDED")],
                ["conflict", t("conflicts", "Conflicts"), this.pick(counts, "conflicts", "CONFLICTS", "conflictCount", "CONFLICT_COUNT")],
                ["duplicate", t("duplicates", "Duplicates"), this.pick(counts, "duplicates", "DUPLICATES", "duplicateCount", "DUPLICATE_COUNT")]
            ];
            const container = getContainerEl("#labelQuality-M90003");
            if (!container) return;
            container.innerHTML = items.map(([kind, label, value]) => `
                <article class="type-quality-item is-${kind}">
                    <span>${this.escapeHtml(label)}</span>
                    <strong>${this.escapeHtml(this.formatInteger(value))}</strong>
                </article>
            `).join("");
        },

        renderTypeDistribution() {
            const rows = this.normalizeTypeDistribution();
            const body = getContainerEl("#typeDistributionBody-M90003");
            if (!body) return;
            body.innerHTML = rows.map((row) => `
                <tr>
                    <td><strong>${this.escapeHtml(this.canonicalTypeLabel(row.code))}</strong><small class="type-model-code">${this.escapeHtml(row.code)}</small></td>
                    <td><span class="type-group-pill is-${row.group.toLowerCase()}">${this.escapeHtml(this.typeGroupLabel(row.group))}</span></td>
                    <td class="is-number">${this.escapeHtml(this.formatInteger(row.count))}</td>
                    <td class="is-number">${this.escapeHtml(this.formatPercent(row.percentage))}</td>
                </tr>
            `).join("");
        },

        renderValidation() {
            const active = this.pick(this.summary, "activeModel", "ACTIVE_MODEL", "champion", "CHAMPION") || {};
            const metrics = this.pick(active, "metrics", "METRICS") || active;
            const perClass = this.asArray(this.pick(metrics, "perClassRecall", "PER_CLASS_RECALL", "classMetrics", "CLASS_METRICS"));
            const confusion = this.pick(metrics, "confusionMatrix", "CONFUSION_MATRIX");
            const container = getContainerEl("#championMetrics-M90003");
            if (!container) return;
            if (!Object.keys(active).length) {
                container.innerHTML = this.emptyBlock(t("noActiveModel", "No active champion model."));
                return;
            }
            container.innerHTML = `
                <div class="type-model-validation-summary">
                    ${this.metricTile("Macro F1", this.formatMetric(this.pick(metrics, "macroF1", "MACRO_F1")))}
                    ${this.metricTile(t("balancedAccuracy", "Balanced Accuracy"), this.formatMetric(this.pick(metrics, "balancedAccuracy", "BALANCED_ACCURACY")))}
                    ${this.metricTile(t("holdoutRows", "Holdout Rows"), this.formatInteger(this.pick(metrics, "holdoutRows", "HOLDOUT_ROWS")))}
                </div>
                ${this.renderPerClassMetrics(perClass)}
                ${this.renderConfusionMatrix(confusion)}
            `;
        },

        renderDataset(errorMessage = "") {
            const body = getContainerEl("#datasetBody-M90003");
            if (!body) return;
            const pageCount = Math.max(1, Math.ceil(this.datasetTotal / this.datasetPageSize));
            this.datasetPage = Math.min(Math.max(1, this.datasetPage), pageCount);
            this.setText("#datasetTotal-M90003", t("totalRows", "Total {count}", { count: this.formatInteger(this.datasetTotal) }));
            this.setValue("#datasetPage-M90003", this.datasetPage);
            this.setText("#datasetPageCount-M90003", `/ ${this.formatInteger(pageCount)}`);
            if (errorMessage) {
                body.innerHTML = this.tableMessage(errorMessage, 12, "error");
                return;
            }
            if (!this.datasetRows.length) {
                body.innerHTML = this.tableMessage(t("noTrainingData", "No training data matches the current filters."), 12);
                return;
            }
            body.innerHTML = this.datasetRows.map((row, index) => {
                const typeCode = String(this.pick(row, "canonicalTypeCode", "CANONICAL_TYPE_CODE", "typeCode", "TYPE_CODE") || "UNKNOWN").toUpperCase();
                const groupCode = String(this.pick(row, "typeGroupCode", "TYPE_GROUP_CODE") || TYPE_GROUP_FALLBACK[typeCode] || "OTHER").toUpperCase();
                const confirmed = this.asBoolean(this.pick(row, "confirmedYn", "CONFIRMED_YN", "confirmed", "CONFIRMED"));
                const conflict = this.asBoolean(this.pick(row, "conflictYn", "CONFLICT_YN", "conflict", "CONFLICT"));
                return `
                    <tr>
                        <td class="no-column">${this.formatInteger((this.datasetPage - 1) * this.datasetPageSize + index + 1)}</td>
                        <td>${this.cell(this.pick(row, "owner", "OWNER", "targetOwner", "TARGET_OWNER"))}</td>
                        <td>${this.cell(this.pick(row, "tableName", "TABLE_NAME", "targetTable", "TARGET_TABLE"))}</td>
                        <td><strong>${this.cell(this.pick(row, "columnName", "COLUMN_NAME"))}</strong></td>
                        <td>${this.cell(this.pick(row, "columnComment", "COLUMN_COMMENT", "columnDesc", "COLUMN_DESC"))}</td>
                        <td><span title="${this.escapeHtml(typeCode)}">${this.escapeHtml(this.canonicalTypeLabel(typeCode))}</span><small class="type-model-code">${this.escapeHtml(typeCode)}</small></td>
                        <td><span class="type-group-pill is-${groupCode.toLowerCase()}">${this.escapeHtml(this.typeGroupLabel(groupCode))}</span></td>
                        <td>${this.cell(this.pick(row, "labelSource", "LABEL_SOURCE"))}</td>
                        <td>${this.booleanBadge(confirmed)}</td>
                        <td class="is-number">${this.formatInteger(this.pick(row, "duplicateCount", "DUPLICATE_COUNT"))}</td>
                        <td>${this.booleanBadge(conflict, true)}</td>
                        <td>${this.escapeHtml(this.formatDate(this.pick(row, "updatedAt", "UPDATED_AT", "confirmedAt", "CONFIRMED_AT")))}</td>
                    </tr>
                `;
            }).join("");
        },

        renderModels(errorMessage = "") {
            const body = getContainerEl("#modelsBody-M90003");
            if (!body) return;
            this.setText("#modelTotal-M90003", t("totalModels", "Total {count} models", { count: this.formatInteger(this.models.length) }));
            if (errorMessage) {
                body.innerHTML = this.tableMessage(errorMessage, 11, "error");
                return;
            }
            if (!this.models.length) {
                body.innerHTML = this.tableMessage(t("noModelVersions", "No model versions."), 11);
                return;
            }
            body.innerHTML = this.models.map((row, index) => {
                const modelId = this.pick(row, "id", "modelId", "MODEL_ID", "modelVersionId", "MODEL_VERSION_ID");
                const status = String(this.pick(row, "status", "STATUS", "statusCode", "STATUS_CODE") || "UNKNOWN").toUpperCase();
                const escapedId = this.escapeHtml(String(modelId ?? ""));
                const canActivate = ["CANDIDATE", "ARCHIVED"].includes(status);
                const canArchive = status === "CANDIDATE";
                return `
                    <tr>
                        <td class="no-column">${index + 1}</td>
                        <td><span class="type-model-status ${this.statusClass(status)}">${this.escapeHtml(this.statusLabel(status))}</span></td>
                        <td><strong>${this.cell(this.pick(row, "modelVersion", "MODEL_VERSION", "version"))}</strong></td>
                        <td>${this.cell(this.pick(row, "physicalModelName", "PHYSICAL_MODEL_NAME", "modelName", "MODEL_NAME"))}</td>
                        <td>${this.cell(this.pick(row, "algorithmCode", "ALGORITHM_CODE", "algorithm"))}</td>
                        <td>${this.cell(this.pick(row, "featureVersion", "FEATURE_VERSION"))}</td>
                        <td class="is-number">${this.formatInteger(this.pick(row, "trainedRows", "TRAINED_ROWS", "trainingRows", "TRAINING_ROWS"))}</td>
                        <td class="is-number">${this.formatMetric(this.pick(row, "macroF1", "MACRO_F1"))}</td>
                        <td class="is-number">${this.formatMetric(this.pick(row, "balancedAccuracy", "BALANCED_ACCURACY"))}</td>
                        <td>${this.escapeHtml(this.formatDate(this.pick(row, "createdAt", "CREATED_AT", "trainedAt", "TRAINED_AT")))}</td>
                        <td><div class="type-model-row-actions">
                            ${canActivate ? this.actionButton("activate-model", escapedId, "fa-check", t("activate", "Activate"), "is-primary") : ""}
                            ${canArchive ? this.actionButton("archive-model", escapedId, "fa-box-archive", t("archive", "Archive"), "") : ""}
                        </div></td>
                    </tr>
                `;
            }).join("");
        },

        renderCandidateComparison() {
            const container = getContainerEl("#candidateComparison-M90003");
            if (!container) return;
            const champion = this.models.find((row) => ["CHAMPION", "ACTIVE"].includes(String(this.pick(row, "status", "STATUS", "statusCode", "STATUS_CODE")).toUpperCase()))
                || this.pick(this.summary, "activeModel", "ACTIVE_MODEL", "champion", "CHAMPION") || null;
            const candidate = this.models.find((row) => ["CANDIDATE", "VALIDATED"].includes(String(this.pick(row, "status", "STATUS", "statusCode", "STATUS_CODE")).toUpperCase())) || null;
            if (!champion && !candidate) {
                container.innerHTML = this.emptyBlock(t("noModelsToCompare", "No champion or candidate is available for comparison."));
                return;
            }
            container.innerHTML = `
                <div class="type-model-compare-grid">
                    ${this.comparisonCard(champion, t("champion", "Champion"), "champion")}
                    <div class="type-model-compare-arrow"><i class="fas fa-arrow-right-arrow-left"></i></div>
                    ${this.comparisonCard(candidate, t("latestCandidate", "Latest Candidate"), "candidate")}
                </div>
            `;
        },

        renderRuns(errorMessage = "") {
            const body = getContainerEl("#runsBody-M90003");
            if (!body) return;
            const pageCount = Math.max(1, Math.ceil(this.runTotal / this.runPageSize));
            this.runPage = Math.min(Math.max(1, this.runPage), pageCount);
            this.setText("#runTotal-M90003", t("totalRuns", "Total {count} runs", { count: this.formatInteger(this.runTotal) }));
            this.setValue("#runPage-M90003", this.runPage);
            this.setText("#runPageCount-M90003", `/ ${this.formatInteger(pageCount)}`);
            if (errorMessage) {
                body.innerHTML = this.tableMessage(errorMessage, 14, "error");
                return;
            }
            if (!this.runRows.length) {
                body.innerHTML = this.tableMessage(t("noTrainingRuns", "No training runs."), 14);
                return;
            }
            body.innerHTML = this.runRows.map((row, index) => {
                const status = String(this.pick(row, "status", "STATUS") || "UNKNOWN").toUpperCase();
                return `
                    <tr>
                        <td class="no-column">${this.formatInteger((this.runPage - 1) * this.runPageSize + index + 1)}</td>
                        <td>${this.cell(this.pick(row, "id", "runId", "RUN_ID"))}</td>
                        <td><span class="type-model-status ${this.statusClass(status)}">${this.escapeHtml(this.statusLabel(status))}</span></td>
                        <td>${this.cell(this.pick(row, "algorithmCode", "ALGORITHM_CODE"))}</td>
                        <td>${this.cell(this.pick(row, "featureVersion", "FEATURE_VERSION"))}</td>
                        <td class="is-number">${this.formatInteger(this.pick(row, "maxRows", "MAX_ROWS"))}</td>
                        <td class="is-number">${this.formatInteger(this.pick(row, "seed", "SEED", "randomSeed", "RANDOM_SEED"))}</td>
                        <td class="is-number">${this.formatMetric(this.pick(row, "holdoutRatio", "HOLDOUT_RATIO"))}</td>
                        <td class="is-number">${this.formatInteger(this.pick(row, "eligibleRows", "ELIGIBLE_ROWS"))}</td>
                        <td class="is-number">${this.formatMetric(this.pick(row, "macroF1", "MACRO_F1"))}</td>
                        <td class="is-number">${this.formatMetric(this.pick(row, "balancedAccuracy", "BALANCED_ACCURACY"))}</td>
                        <td>${this.escapeHtml(this.formatDate(this.pick(row, "startedAt", "STARTED_AT")))}</td>
                        <td>${this.escapeHtml(this.formatDate(this.pick(row, "finishedAt", "FINISHED_AT")))}</td>
                        <td class="type-model-message-cell" title="${this.escapeHtml(this.pick(row, "message", "MESSAGE", "errorMessage", "ERROR_MESSAGE") || "")}">${this.cell(this.pick(row, "message", "MESSAGE", "errorMessage", "ERROR_MESSAGE"))}</td>
                    </tr>
                `;
            }).join("");
        },

        normalizeGroupDistribution() {
            const source = this.asArray(this.pick(this.datasetStats, "groupDistribution", "GROUP_DISTRIBUTION", "typeGroupDistribution", "TYPE_GROUP_DISTRIBUTION", "groups", "GROUPS"));
            const typeRows = this.normalizeTypeDistribution(false);
            const byGroup = new Map(TYPE_GROUPS.map((code) => [code, { code, count: 0, percentage: 0 }]));
            source.forEach((row) => {
                const code = String(this.pick(row, "typeGroupCode", "TYPE_GROUP_CODE", "groupCode", "GROUP_CODE") || "OTHER").toUpperCase();
                if (!byGroup.has(code)) return;
                byGroup.set(code, {
                    code,
                    count: this.toNumber(this.pick(row, "count", "COUNT", "labelCount", "LABEL_COUNT")),
                    percentage: this.normalizePercentage(this.pick(row, "percentage", "PERCENTAGE", "ratio", "RATIO"))
                });
            });
            if (!source.length && typeRows.length) {
                typeRows.forEach((row) => {
                    const target = byGroup.get(row.group) || byGroup.get("OTHER");
                    target.count += row.count;
                });
            }
            const rows = TYPE_GROUPS.map((code) => byGroup.get(code));
            const total = rows.reduce((sum, row) => sum + row.count, 0);
            rows.forEach((row) => {
                if (!row.percentage && total) row.percentage = row.count / total * 100;
            });
            return rows;
        },

        normalizeTypeDistribution(fillMissing = true) {
            const source = this.asArray(this.pick(this.datasetStats, "typeDistribution", "TYPE_DISTRIBUTION", "canonicalTypeDistribution", "CANONICAL_TYPE_DISTRIBUTION", "details", "DETAILS"));
            const byCode = new Map();
            source.forEach((row) => {
                const code = String(this.pick(row, "canonicalTypeCode", "CANONICAL_TYPE_CODE", "typeCode", "TYPE_CODE") || "UNKNOWN").toUpperCase();
                byCode.set(code, {
                    code,
                    group: String(this.pick(row, "typeGroupCode", "TYPE_GROUP_CODE") || TYPE_GROUP_FALLBACK[code] || "OTHER").toUpperCase(),
                    count: this.toNumber(this.pick(row, "count", "COUNT", "labelCount", "LABEL_COUNT")),
                    percentage: this.normalizePercentage(this.pick(row, "percentage", "PERCENTAGE", "ratio", "RATIO"))
                });
            });
            const codes = fillMissing ? [...CANONICAL_TYPES, ...Array.from(byCode.keys()).filter((code) => !CANONICAL_TYPES.includes(code))] : Array.from(byCode.keys());
            const rows = codes.map((code) => byCode.get(code) || { code, group: TYPE_GROUP_FALLBACK[code] || "OTHER", count: 0, percentage: 0 });
            const total = rows.reduce((sum, row) => sum + row.count, 0);
            rows.forEach((row) => {
                if (!row.percentage && total) row.percentage = row.count / total * 100;
            });
            return rows;
        },

        renderPerClassMetrics(rows) {
            if (!rows.length) return this.emptyBlock(t("noPerClassMetrics", "Per-class metrics are not available."));
            return `
                <div class="type-model-table-wrap compact">
                    <table class="type-model-table">
                        <thead><tr>
                            <th>${this.escapeHtml(t("canonicalTypeCode", "Detailed Type Code"))}</th>
                            <th>${this.escapeHtml(t("recall", "Recall"))}</th>
                            <th>${this.escapeHtml(t("precision", "Precision"))}</th>
                            <th>F1</th>
                            <th>${this.escapeHtml(t("support", "Support"))}</th>
                        </tr></thead>
                        <tbody>${rows.map((row) => {
                            const code = String(this.pick(row, "canonicalTypeCode", "CANONICAL_TYPE_CODE", "typeCode", "TYPE_CODE") || "UNKNOWN").toUpperCase();
                            return `<tr>
                                <td><strong>${this.escapeHtml(this.canonicalTypeLabel(code))}</strong><small class="type-model-code">${this.escapeHtml(code)}</small></td>
                                <td class="is-number">${this.formatMetric(this.pick(row, "recall", "RECALL"))}</td>
                                <td class="is-number">${this.formatMetric(this.pick(row, "precision", "PRECISION"))}</td>
                                <td class="is-number">${this.formatMetric(this.pick(row, "f1", "F1", "f1Score", "F1_SCORE"))}</td>
                                <td class="is-number">${this.formatInteger(this.pick(row, "support", "SUPPORT"))}</td>
                            </tr>`;
                        }).join("")}</tbody>
                    </table>
                </div>
            `;
        },

        renderConfusionMatrix(input) {
            const matrix = this.normalizeConfusionMatrix(input);
            if (!matrix.labels.length) return this.emptyBlock(t("noConfusionMatrix", "Confusion matrix data is not available."));
            return `
                <section class="type-model-confusion">
                    <h4>${this.escapeHtml(t("confusionMatrix", "Confusion Matrix"))}</h4>
                    <div class="type-model-table-wrap compact">
                        <table class="type-model-table confusion-table">
                            <thead><tr><th>${this.escapeHtml(t("actualPredicted", "Actual / Predicted"))}</th>${matrix.labels.map((label) => `<th title="${this.escapeHtml(label)}">${this.escapeHtml(label)}</th>`).join("")}</tr></thead>
                            <tbody>${matrix.labels.map((label, rowIndex) => `<tr><th title="${this.escapeHtml(label)}">${this.escapeHtml(label)}</th>${matrix.values[rowIndex].map((value, colIndex) => `<td class="is-number${rowIndex === colIndex ? " is-diagonal" : ""}">${this.formatInteger(value)}</td>`).join("")}</tr>`).join("")}</tbody>
                        </table>
                    </div>
                </section>
            `;
        },

        normalizeConfusionMatrix(input) {
            let value = input;
            if (typeof value === "string") {
                try { value = JSON.parse(value); } catch (_) { return { labels: [], values: [] }; }
            }
            if (Array.isArray(value)) {
                const labels = Array.from(new Set(value.flatMap((row) => [
                    String(this.pick(row, "actual", "ACTUAL", "actualType", "ACTUAL_TYPE") || ""),
                    String(this.pick(row, "predicted", "PREDICTED", "predictedType", "PREDICTED_TYPE") || "")
                ]).filter(Boolean)));
                const index = new Map(labels.map((label, i) => [label, i]));
                const values = labels.map(() => labels.map(() => 0));
                value.forEach((row) => {
                    const actual = String(this.pick(row, "actual", "ACTUAL", "actualType", "ACTUAL_TYPE") || "");
                    const predicted = String(this.pick(row, "predicted", "PREDICTED", "predictedType", "PREDICTED_TYPE") || "");
                    if (index.has(actual) && index.has(predicted)) values[index.get(actual)][index.get(predicted)] = this.toNumber(this.pick(row, "count", "COUNT"));
                });
                return { labels, values };
            }
            if (value && Array.isArray(value.labels) && Array.isArray(value.values)) {
                return { labels: value.labels.map(String), values: value.values.map((row) => this.asArray(row).map((item) => this.toNumber(item))) };
            }
            if (value && typeof value === "object") {
                const labels = Object.keys(value);
                const values = labels.map((actual) => labels.map((predicted) => this.toNumber(value[actual]?.[predicted])));
                return { labels, values };
            }
            return { labels: [], values: [] };
        },

        comparisonCard(model, title, kind) {
            if (!model) return `<article class="type-model-compare-card is-${kind}"><h4>${this.escapeHtml(title)}</h4>${this.emptyBlock(t("notAvailable", "Not available"))}</article>`;
            const status = String(this.pick(model, "status", "STATUS", "statusCode", "STATUS_CODE") || kind).toUpperCase();
            return `
                <article class="type-model-compare-card is-${kind}">
                    <header><h4>${this.escapeHtml(title)}</h4><span class="type-model-status ${this.statusClass(status)}">${this.escapeHtml(this.statusLabel(status))}</span></header>
                    <strong>${this.cell(this.pick(model, "modelVersion", "MODEL_VERSION", "version"))}</strong>
                    <dl>
                        <div><dt>${this.escapeHtml(t("algorithm", "Algorithm"))}</dt><dd>${this.cell(this.pick(model, "algorithmCode", "ALGORITHM_CODE", "algorithm"))}</dd></div>
                        <div><dt>Macro F1</dt><dd>${this.formatMetric(this.pick(model, "macroF1", "MACRO_F1"))}</dd></div>
                        <div><dt>${this.escapeHtml(t("balancedAccuracy", "Balanced Accuracy"))}</dt><dd>${this.formatMetric(this.pick(model, "balancedAccuracy", "BALANCED_ACCURACY"))}</dd></div>
                    </dl>
                </article>
            `;
        },

        normalizePercentage(value) {
            const number = this.toNumber(value);
            return number > 0 && number <= 1 ? number * 100 : number;
        },

        changePage(kind, delta) {
            if (kind === "dataset") {
                const max = Math.max(1, Math.ceil(this.datasetTotal / this.datasetPageSize));
                const next = Math.min(max, Math.max(1, this.datasetPage + delta));
                if (next === this.datasetPage) return;
                this.datasetPage = next;
                return this.loadDataset();
            }
            const max = Math.max(1, Math.ceil(this.runTotal / this.runPageSize));
            const next = Math.min(max, Math.max(1, this.runPage + delta));
            if (next === this.runPage) return;
            this.runPage = next;
            return this.loadRuns();
        },

        applyPageInput(kind) {
            if (kind === "dataset") {
                const max = Math.max(1, Math.ceil(this.datasetTotal / this.datasetPageSize));
                this.datasetPage = this.boundInteger(getContainerEl("#datasetPage-M90003")?.value, 1, max, this.datasetPage);
                return this.loadDataset();
            }
            const max = Math.max(1, Math.ceil(this.runTotal / this.runPageSize));
            this.runPage = this.boundInteger(getContainerEl("#runPage-M90003")?.value, 1, max, this.runPage);
            return this.loadRuns();
        },

        async request(path, options = {}) {
            return CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}${path}`, {
                method: options.method || "GET",
                showLoading: false,
                ...(Object.prototype.hasOwnProperty.call(options, "body") ? { body: options.body } : {})
            });
        },

        async requestWithGetFallback(paths) {
            let firstError = null;
            for (const path of paths) {
                try {
                    return await this.request(path);
                } catch (error) {
                    if (!firstError) firstError = error;
                }
            }
            throw firstError || new Error(t("requestFailed", "Request failed."));
        },

        unwrapObject(json) {
            const data = json?.data;
            if (data && !Array.isArray(data) && typeof data === "object") return data;
            return json && typeof json === "object" ? json : {};
        },

        unwrapRows(json) {
            const data = json?.data;
            const nestedRows = data && !Array.isArray(data) ? (data.rows || data.items || data.data) : null;
            const rows = Array.isArray(data) ? data : (Array.isArray(nestedRows) ? nestedRows : (Array.isArray(json?.rows) ? json.rows : []));
            const total = this.toNumber(json?.total ?? data?.total ?? data?.totalCount ?? data?.TOTAL_COUNT ?? rows.length);
            return {
                rows,
                total,
                page: this.toNumber(json?.page ?? data?.page ?? data?.pageNo),
                pageSize: this.toNumber(json?.pageSize ?? data?.pageSize ?? data?.limit)
            };
        },

        pick(object, ...keys) {
            if (!object || typeof object !== "object") return undefined;
            for (const key of keys) {
                if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined && object[key] !== null) return object[key];
            }
            const normalized = new Map(Object.keys(object).map((key) => [key.replace(/[^a-z0-9]/gi, "").toLowerCase(), key]));
            for (const key of keys) {
                const actual = normalized.get(String(key).replace(/[^a-z0-9]/gi, "").toLowerCase());
                if (actual && object[actual] !== undefined && object[actual] !== null) return object[actual];
            }
            return undefined;
        },

        asArray(value) {
            if (Array.isArray(value)) return value;
            if (typeof value === "string") {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (_) { return []; }
            }
            return [];
        },

        updateTargetDbLabel() {
            const targetDb = this.pick(this.summary, "targetDb", "TARGET_DB", "targetDbName", "TARGET_DB_NAME", "dbAlias", "DB_ALIAS");
            this.setText("#targetDb-M90003", targetDb
                ? t("targetDbValue", "Target DB: {targetDb}", { targetDb })
                : t("currentTargetDb", "Current Target DB"));
        },

        canonicalTypeLabel(code) {
            return t(`type_${String(code).toUpperCase()}`, String(code));
        },

        typeGroupLabel(code) {
            return t(`group_${String(code).toUpperCase()}`, String(code));
        },

        statusLabel(status) {
            const code = String(status || "UNKNOWN").toUpperCase();
            return t(`status_${code}`, code);
        },

        statusClass(status) {
            const code = String(status || "").toUpperCase();
            if (["ACTIVE", "CHAMPION", "SUCCESS", "COMPLETED", "VALIDATED"].includes(code)) return "is-success";
            if (["CANDIDATE", "REQUESTED", "RUNNING", "TRAINING", "QUEUED", "PENDING"].includes(code)) return "is-progress";
            if (["FAILED", "ERROR", "REJECTED"].includes(code)) return "is-error";
            if (["ARCHIVED", "RETIRED", "PREVIOUS"].includes(code)) return "is-muted";
            return "is-empty";
        },

        toNumber(value) {
            const number = Number(value);
            return Number.isFinite(number) ? number : 0;
        },

        asBoolean(value) {
            if (typeof value === "boolean") return value;
            return ["Y", "YES", "TRUE", "1"].includes(String(value ?? "").trim().toUpperCase());
        },

        boundInteger(value, min, max, fallback) {
            const number = Math.round(Number(value));
            if (!Number.isFinite(number)) return fallback;
            return Math.min(max, Math.max(min, number));
        },

        boundNumber(value, min, max, fallback) {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return Math.min(max, Math.max(min, number));
        },

        formatInteger(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return "0";
            const language = window.I18nManager?.getCurrentLanguage?.() === "ko" ? "ko-KR" : "en-US";
            return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(number);
        },

        formatMetric(value) {
            if (value === undefined || value === null || value === "") return "-";
            const number = Number(value);
            return Number.isFinite(number) ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : this.escapeHtml(value);
        },

        formatPercent(value) {
            const number = Number(value);
            return `${Number.isFinite(number) ? number.toFixed(1) : "0.0"}%`;
        },

        formatDate(value) {
            if (!value) return "-";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            const language = window.I18nManager?.getCurrentLanguage?.() === "ko" ? "ko-KR" : "en-US";
            return new Intl.DateTimeFormat(language, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
        },

        booleanBadge(value, danger = false) {
            return value
                ? `<span class="type-model-boolean ${danger ? "is-danger" : "is-yes"}">${this.escapeHtml(t(danger ? "yes" : "confirmed", danger ? "Yes" : "Confirmed"))}</span>`
                : `<span class="type-model-boolean is-no">${this.escapeHtml(t(danger ? "no" : "notConfirmed", danger ? "No" : "Not confirmed"))}</span>`;
        },

        metricTile(label, value) {
            return `<article class="type-model-metric"><span>${this.escapeHtml(label)}</span><strong>${this.escapeHtml(value)}</strong></article>`;
        },

        actionButton(action, modelId, icon, label, extraClass) {
            return `<button type="button" class="type-model-small-btn ${extraClass}" data-action="${action}" data-model-id="${modelId}" title="${this.escapeHtml(label)}"><i class="fas ${icon}"></i><span>${this.escapeHtml(label)}</span></button>`;
        },

        cell(value) {
            const text = value === undefined || value === null || value === "" ? "-" : String(value);
            return `<span title="${this.escapeHtml(text)}">${this.escapeHtml(text)}</span>`;
        },

        tableMessage(message, colspan, kind = "empty") {
            return `<tr><td colspan="${colspan}" class="type-model-table-message is-${kind}">${this.escapeHtml(message)}</td></tr>`;
        },

        emptyBlock(message) {
            return `<div class="type-model-empty"><i class="fas fa-inbox" aria-hidden="true"></i><span>${this.escapeHtml(message)}</span></div>`;
        },

        renderTableLoading(selector, colspan) {
            const body = getContainerEl(selector);
            if (body) body.innerHTML = `<tr><td colspan="${colspan}" class="type-model-table-message"><i class="fas fa-circle-notch fa-spin"></i> ${this.escapeHtml(t("loading", "Loading..."))}</td></tr>`;
        },

        loadingCards(count) {
            return Array.from({ length: count }, () => `<div class="type-model-skeleton"></div>`).join("");
        },

        setText(selector, value) {
            const element = getContainerEl(selector);
            if (element) element.textContent = String(value ?? "");
        },

        setValue(selector, value) {
            const element = getContainerEl(selector);
            if (element) element.value = String(value ?? "");
        },

        setButtonLoading(button, loading, label = "") {
            if (!button) return;
            if (loading) {
                button.dataset.originalHtml = button.innerHTML;
                button.disabled = true;
                button.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i><span>${this.escapeHtml(label)}</span>`;
            } else {
                button.disabled = false;
                if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
                delete button.dataset.originalHtml;
            }
        },

        showMessage(kind, message, timeout = 0) {
            const element = getContainerEl("#pageMessage-M90003");
            if (!element) return;
            element.className = `type-model-message is-${kind || "info"}`;
            element.textContent = String(message || "");
            element.hidden = !message;
            if (timeout > 0) {
                const generation = this.generation;
                window.setTimeout(() => {
                    if (this.isCurrent(generation) && element.textContent === String(message || "")) element.hidden = true;
                }, timeout);
            }
        },

        async confirm(message) {
            if (window.CommonMessage?.confirm) return CommonMessage.confirm(message, { defaultAction: "cancel" });
            return window.confirm(message);
        },

        isCurrent(generation) {
            return this.isInit && generation === this.generation;
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }
    };

    window[PAGE_CODE] = M90003;
})();
