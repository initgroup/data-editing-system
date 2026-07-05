(function() {
    const PAGE_CODE = "M01002";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const emptyScenario = () => ({
        scenarioId: null,
        projectId: null,
        scenarioCode: "",
        scenarioName: "",
        scenarioType: "RULE",
        scenarioDesc: "",
        useYn: "Y",
        sortOrder: ""
    });

    const M01002 = {
        
        ...COMMON,
        isInit: false,
        projects: [],
        scenarios: [],
        selectedProject: null,
        selectedScenario: emptyScenario(),
        originalScenario: emptyScenario(),
        projectSearchTimer: null,
        scenarioSearchTimer: null,

        async init() {
            if (this.isInit) return;
            this.newScenario(false);
            await this.loadProjects();
            this.renderProjectSummary();
            this.renderScenarioDetail();
            this.isInit = true;
        },

        destroy() {
            this.unbindHelpEvents();
            this.projects = [];
            this.scenarios = [];
            this.selectedProject = null;
            this.selectedScenario = emptyScenario();
            this.originalScenario = emptyScenario();
            if (this.projectSearchTimer) clearTimeout(this.projectSearchTimer);
            if (this.scenarioSearchTimer) clearTimeout(this.scenarioSearchTimer);
            this.projectSearchTimer = null;
            this.scenarioSearchTimer = null;
            this.isInit = false;
        },

        async loadProjects() {
            const list = getContainerEl("#projectList-M01002");
            if (!list) return;

            const keyword = (getContainerEl("#projectSearch-M01002")?.value || "").trim();
            list.innerHTML = `<div class="env-tree-loading project-empty">${this.escapeHtml(this.t("loadingProjects", "Loading projects..."))}</div>`;

            try {
                const params = new URLSearchParams({ keyword });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/projects?${params.toString()}`, { method: "GET", showLoading: false });
                this.projects = Array.isArray(json.data) ? json.data : [];
                this.renderProjectList();
            } catch (error) {
                console.error("[M01002] project list load failed", error);
                list.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || this.t("projectListLoadFailed", "Project list load failed."))}</div>`;
            }
        },

        renderProjectList() {
            const list = getContainerEl("#projectList-M01002");
            if (!list) return;

            if (this.projects.length === 0) {
                list.innerHTML = `
                    <div class="project-empty">${this.escapeHtml(this.t("noProjectsFound", "No projects found."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            list.innerHTML = `
                <div class="project-list-head">
                    <div>${this.escapeHtml(this.t("project", "Project"))}</div>
                    <div>${this.escapeHtml(this.t("typeUse", "Type / Use"))}</div>
                </div>
                <div class="project-list-body">
                    ${this.projects.map((project) => this.createProjectRow(project)).join("")}
                </div>
                ${this.renderListFooter(this.projects.length)}
            `;
        },

        createProjectRow(project) {
            const projectId = project.PROJECT_ID ?? "";
            const selectedClass = String(projectId) === String(this.selectedProject?.projectId) ? "is-selected" : "";
            const ownerScopeClass = CommonUtils.getOwnerScopeClass(project);
            const name = project.PROJECT_NAME || "";
            const displayName = CommonUtils.formatOwnerScopedName(project, name || this.t("untitledProject", "(Untitled project)"));
            const code = project.PROJECT_CODE || "";
            const type = project.PROJECT_TYPE || "";
            const useYn = project.USE_YN || "Y";
            const scenarioCount = Number(project.SCENARIO_COUNT || 0);
            const scenarioIcon = scenarioCount > 0
                ? `<i class="fas fa-circle-check env-registered-icon" title="${this.escapeHtml(this.tl("registeredScenariosCount", "Registered scenarios: {count}", { count: scenarioCount }))}"></i>`
                : "";
            const codeLabel = code || this.t("noCode", "No code");
            const useLabel = this.tl("useValue", "Use {value}", { value: useYn });

            return `
                <button type="button" class="project-row ${selectedClass} ${this.escapeAttr(ownerScopeClass)}" data-project-id="${this.escapeAttr(projectId)}" onclick="M01002.selectProject('${this.escapeAttr(projectId)}')">
                    <span class="project-row-main">
                        <span class="project-row-title" title="${this.escapeHtml(displayName)}">
                            <span class="project-row-title-text">${this.escapeHtml(displayName)}</span>
                            <span class="project-scenario-status">${scenarioIcon}</span>
                        </span>
                        <span class="project-row-sub" title="${this.escapeHtml(codeLabel)}">${this.escapeHtml(codeLabel)}</span>
                    </span>
                    <span class="project-row-meta">
                        <span title="${this.escapeHtml(type)}">${this.escapeHtml(type || "-")}</span>
                        <span title="${this.escapeHtml(useLabel)}">${this.escapeHtml(useLabel)}</span>
                    </span>
                </button>
            `;
        },

        async selectProject(projectId) {
            const row = this.projects.find((project) => String(project.PROJECT_ID) === String(projectId));
            if (!row) return;

            this.selectedProject = this.normalizeProject(row);
            this.newScenario(false);
            this.renderProjectSummary();
            this.updateProjectSelection();
            this.renderScenarioDetail();
            this.updateDescription(this.tl("selectedProjectDescription", "Selected project: {name}", { name: this.selectedProject.projectName || "" }));
            await this.loadScenarios();
        },

        updateProjectSelection() {
            const selectedId = String(this.selectedProject?.projectId ?? "");
            getContainerEl("#projectList-M01002")?.querySelectorAll(".project-row").forEach((row) => {
                row.classList.toggle("is-selected", row.dataset.projectId === selectedId);
            });
        },

        normalizeProject(row) {
            return {
                projectId: row.PROJECT_ID ?? row.projectId ?? null,
                projectCode: row.PROJECT_CODE ?? row.projectCode ?? "",
                projectName: row.PROJECT_NAME ?? row.projectName ?? "",
                projectType: row.PROJECT_TYPE ?? row.projectType ?? "",
                projectDesc: row.PROJECT_DESC ?? row.projectDesc ?? "",
                useYn: row.USE_YN ?? row.useYn ?? "Y",
                sortOrder: row.SORT_ORDER ?? row.sortOrder ?? ""
            };
        },

        renderProjectSummary() {
            const project = this.selectedProject || {};
            this.setValue("#selectedProjectId-M01002", project.projectId || "");
            this.setValue("#selectedProjectCode-M01002", project.projectCode || "");
            this.setValue("#selectedProjectName-M01002", project.projectName || "");
        },

        async loadScenarios() {
            const list = getContainerEl("#scenarioList-M01002");
            if (!list) return;

            if (!this.selectedProject?.projectId) {
                this.scenarios = [];
                list.innerHTML = `
                    <div class="project-empty">${this.escapeHtml(this.t("selectProjectFirst", "Select a project first."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            const keyword = (getContainerEl("#scenarioSearch-M01002")?.value || "").trim();
            list.innerHTML = `<div class="project-empty">${this.escapeHtml(this.t("loadingScenarios", "Loading scenarios..."))}</div>`;

            try {
                const params = new URLSearchParams({
                    projectId: this.selectedProject.projectId,
                    keyword
                });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenarios?${params.toString()}`, { method: "GET", showLoading: false });
                this.scenarios = Array.isArray(json.data) ? json.data : [];
                this.updateSelectedProjectScenarioStatus(this.scenarios.length);
                this.renderScenarioList();
            } catch (error) {
                console.error("[M01002] scenario list load failed", error);
                list.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || this.t("scenarioListLoadFailed", "Scenario list load failed."))}</div>`;
            }
        },

        renderScenarioList() {
            const list = getContainerEl("#scenarioList-M01002");
            if (!list) return;

            if (this.scenarios.length === 0) {
                list.innerHTML = `
                    <div class="project-empty">${this.escapeHtml(this.t("noScenariosFound", "No scenarios found."))}</div>
                    ${this.renderListFooter(0)}
                `;
                return;
            }

            list.innerHTML = `
                <div class="scenario-list-head">
                    <div>${this.escapeHtml(this.t("scenario", "Scenario"))}</div>
                    <div>${this.escapeHtml(this.t("typeUse", "Type / Use"))}</div>
                </div>
                <div class="scenario-list-body">
                    ${this.scenarios.map((scenario) => this.createScenarioRow(scenario)).join("")}
                </div>
                ${this.renderListFooter(this.scenarios.length)}
            `;
        },

        updateSelectedProjectScenarioStatus(scenarioCount) {
            const projectId = this.selectedProject?.projectId;
            if (!projectId) return;

            const normalizedCount = Number(scenarioCount || 0);
            const project = this.projects.find((row) => String(row.PROJECT_ID) === String(projectId));
            if (project) {
                project.SCENARIO_COUNT = normalizedCount;
                project.HAS_SCENARIO_YN = normalizedCount > 0 ? "Y" : "N";
            }

            const row = Array.from(getContainerEl("#projectList-M01002")?.querySelectorAll(".project-row") || [])
                .find((item) => item.dataset.projectId === String(projectId));
            const status = row?.querySelector(".project-scenario-status");
            if (!status) return;

            status.innerHTML = normalizedCount > 0
                ? `<i class="fas fa-circle-check env-registered-icon" title="${this.escapeHtml(this.tl("registeredScenariosCount", "Registered scenarios: {count}", { count: normalizedCount }))}"></i>`
                : "";
        },

        createScenarioRow(scenario) {
            const scenarioId = scenario.SCENARIO_ID ?? "";
            const selectedClass = String(scenarioId) === String(this.selectedScenario.scenarioId) ? "is-selected" : "";
            const ownerScopeClass = CommonUtils.getOwnerScopeClass(scenario);
            const name = scenario.SCENARIO_NAME || "";
            const displayName = CommonUtils.formatOwnerScopedName(scenario, name || this.t("untitledScenario", "(Untitled scenario)"));
            const code = scenario.SCENARIO_CODE || "";
            const type = scenario.SCENARIO_TYPE || "";
            const useYn = scenario.USE_YN || "Y";
            const codeLabel = code || this.t("noCode", "No code");
            const useLabel = this.tl("useValue", "Use {value}", { value: useYn });

            return `
                <button type="button" class="scenario-row ${selectedClass} ${this.escapeAttr(ownerScopeClass)}" onclick="M01002.selectScenario('${this.escapeAttr(scenarioId)}')">
                    <span class="project-row-main">
                        <span class="project-row-title" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</span>
                        <span class="project-row-sub" title="${this.escapeHtml(codeLabel)}">${this.escapeHtml(codeLabel)}</span>
                    </span>
                    <span class="project-row-meta">
                        <span title="${this.escapeHtml(type)}">${this.escapeHtml(type || "-")}</span>
                        <span title="${this.escapeHtml(useLabel)}">${this.escapeHtml(useLabel)}</span>
                    </span>
                </button>
            `;
        },

        async selectScenario(scenarioId) {
            if (!scenarioId) return;

            try {
                const params = new URLSearchParams({ scenarioId });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario?${params.toString()}`, { method: "GET" });
                this.selectedScenario = this.normalizeScenario(json.data || {});
                this.originalScenario = { ...this.selectedScenario };
                this.renderScenarioDetail();
                this.renderScenarioList();
                this.updateDescription(this.tl("selectedScenarioDescription", "Selected scenario: {name}", { name: this.selectedScenario.scenarioName || "" }));
            } catch (error) {
                console.error("[M01002] scenario detail load failed", error);
                alert(error.message || "Scenario detail load failed.");
            }
        },

        normalizeScenario(row) {
            return {
                scenarioId: row.SCENARIO_ID ?? row.scenarioId ?? null,
                projectId: row.PROJECT_ID ?? row.projectId ?? this.selectedProject?.projectId ?? null,
                scenarioCode: row.SCENARIO_CODE ?? row.scenarioCode ?? "",
                scenarioName: row.SCENARIO_NAME ?? row.scenarioName ?? "",
                scenarioType: row.SCENARIO_TYPE ?? row.scenarioType ?? "RULE",
                scenarioDesc: row.SCENARIO_DESC ?? row.scenarioDesc ?? "",
                useYn: row.USE_YN ?? row.useYn ?? "Y",
                sortOrder: row.SORT_ORDER ?? row.sortOrder ?? ""
            };
        },

        newScenario(render = true) {
            this.selectedScenario = {
                ...emptyScenario(),
                projectId: this.selectedProject?.projectId || null
            };
            this.originalScenario = { ...this.selectedScenario };
            if (render) {
                this.renderScenarioDetail();
                this.renderScenarioList();
                this.updateDescription(this.selectedProject ? this.t("createScenarioDescription", "Create a new scenario.") : this.t("selectProjectFirst", "Select a project first."));
                getContainerEl("#scenarioName-M01002")?.focus();
            }
        },

        resetScenario() {
            this.selectedScenario = { ...this.originalScenario };
            this.renderScenarioDetail();
        },

        renderScenarioDetail() {
            const scenario = this.selectedScenario;
            this.ensureScenarioTypeOption(scenario.scenarioType);
            this.setValue("#scenarioId-M01002", scenario.scenarioId);
            this.setValue("#scenarioCode-M01002", scenario.scenarioCode);
            this.setValue("#scenarioName-M01002", scenario.scenarioName);
            this.setValue("#scenarioType-M01002", scenario.scenarioType || "RULE");
            this.setValue("#scenarioDesc-M01002", scenario.scenarioDesc);
            this.setValue("#scenarioUseYn-M01002", scenario.useYn || "Y");
            this.setValue("#scenarioSortOrder-M01002", scenario.sortOrder ?? "");
            this.hideScenarioCodeHelp();
        },

        ensureScenarioTypeOption(value) {
            const select = getContainerEl("#scenarioType-M01002");
            const typeValue = String(value || "RULE").trim();
            if (!select || !typeValue) return;

            const exists = Array.from(select.options).some((option) => option.value === typeValue);
            if (exists) return;

            const option = document.createElement("option");
            option.value = typeValue;
            option.textContent = typeValue;
            select.appendChild(option);
        },

        updateField(field, value) {
            this.selectedScenario[field] = value;
        },

        toggleScenarioCodeHelp(event) {
            event?.stopPropagation();
            const layer = getContainerEl("#scenarioCodeHelp-M01002");
            const button = event?.currentTarget;
            if (!layer) return;

            const willOpen = layer.hidden;
            layer.hidden = !willOpen;
            button?.setAttribute("aria-expanded", String(willOpen));

            if (willOpen) {
                setTimeout(() => {
                    document.addEventListener("click", this.handleHelpOutsideClick);
                    document.addEventListener("keydown", this.handleHelpKeydown);
                }, 0);
            } else {
                this.unbindHelpEvents();
            }
        },

        handleHelpOutsideClick: (event) => {
            const container = getContainerEl("#scenarioCodeHelp-M01002")?.parentElement;
            if (container?.contains(event.target)) return;
            M01002.hideScenarioCodeHelp();
        },

        handleHelpKeydown: (event) => {
            if (event.key === "Escape") {
                M01002.hideScenarioCodeHelp();
            }
        },

        hideScenarioCodeHelp() {
            const layer = getContainerEl("#scenarioCodeHelp-M01002");
            if (layer) layer.hidden = true;
            const button = getContainerEl(".scenario-detail .project-help-btn");
            button?.setAttribute("aria-expanded", "false");
            this.unbindHelpEvents();
        },

        unbindHelpEvents() {
            document.removeEventListener("click", this.handleHelpOutsideClick);
            document.removeEventListener("keydown", this.handleHelpKeydown);
        },

        updateDescription(text) {
            const desc = getContainerEl("#scenarioDescription-M01002");
            if (desc) desc.textContent = text;
        },

        validateScenario() {
            if (!this.selectedProject?.projectId) {
                alert("Select a project first.");
                return false;
            }

            const scenario = this.selectedScenario;
            if (!String(scenario.scenarioName || "").trim()) {
                alert("Scenario name is required.");
                getContainerEl("#scenarioName-M01002")?.focus();
                return false;
            }
            if (!String(scenario.scenarioCode || "").trim()) {
                alert("Scenario code is required.");
                getContainerEl("#scenarioCode-M01002")?.focus();
                return false;
            }
            return true;
        },

        async saveScenario() {
            if (!this.validateScenario()) return;

            const payload = {
                ...this.selectedScenario,
                scenarioId: this.selectedScenario.scenarioId ? Number(this.selectedScenario.scenarioId) : null,
                projectId: Number(this.selectedProject.projectId),
                scenarioCode: String(this.selectedScenario.scenarioCode || "").trim(),
                scenarioName: String(this.selectedScenario.scenarioName || "").trim(),
                scenarioType: String(this.selectedScenario.scenarioType || "RULE").trim(),
                scenarioDesc: this.selectedScenario.scenarioDesc || "",
                useYn: String(this.selectedScenario.useYn || "Y").toUpperCase() === "N" ? "N" : "Y",
                sortOrder: String(this.selectedScenario.sortOrder ?? "").trim() === "" ? null : Number(this.selectedScenario.sortOrder)
            };

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario/save`, {
                    method: "POST",
                    body: payload
                });

                this.selectedScenario = this.normalizeScenario(json.data);
                this.originalScenario = { ...this.selectedScenario };
                this.renderScenarioDetail();
                await this.loadScenarios();
                this.updateDescription(this.t("scenarioSavedDescription", "Scenario was saved."));
                alert("Scenario saved.");
            } catch (error) {
                console.error("[M01002] scenario save failed", error);
                alert(error.message || "Scenario save failed.");
            }
        },

        async deleteScenario() {
            const scenarioId = this.selectedScenario.scenarioId;
            if (!scenarioId) {
                alert("Select a saved scenario before deleting.");
                return;
            }

            if (!(await CommonMessage.confirm(`Delete scenario "${this.selectedScenario.scenarioName}"?`))) {
                return;
            }

            try {
                await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario/delete`, {
                    method: "POST",
                    body: { scenarioId }
                });
                this.newScenario(false);
                this.renderScenarioDetail();
                await this.loadScenarios();
                this.updateDescription(this.t("scenarioDeletedDescription", "Scenario was deleted."));
                alert("Scenario deleted.");
            } catch (error) {
                console.error("[M01002] scenario delete failed", error);
                alert(error.message || "Scenario delete failed.");
            }
        },

        async deleteAllScenarios() {
            const projectId = this.selectedProject?.projectId;
            if (!projectId) {
                alert("Select a project first.");
                return;
            }

            if (!this.scenarios.length) {
                alert("There are no scenarios to delete.");
                return;
            }

            const projectName = this.selectedProject.projectName || "selected project";
            if (!(await CommonMessage.confirm(`Delete all scenarios for "${projectName}"?`))) {
                return;
            }

            try {
                const result = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/scenario/delete-all`, {
                    method: "POST",
                    body: { projectId }
                });
                this.scenarios = [];
                this.newScenario(false);
                this.renderScenarioDetail();
                this.renderScenarioList();
                this.updateSelectedProjectScenarioStatus(0);
                this.updateDescription(this.t("allScenariosDeletedDescription", "All scenarios were deleted."));
                alert(`${result.deletedCount ?? 0} scenarios deleted.`);
            } catch (error) {
                console.error("[M01002] all scenario delete failed", error);
                alert(error.message || "Scenario delete failed.");
            }
        },

        handleProjectSearchInput() {
            if (this.projectSearchTimer) clearTimeout(this.projectSearchTimer);
            this.projectSearchTimer = setTimeout(() => this.loadProjects(), 250);
        },

        handleProjectSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.loadProjects();
        },

        handleScenarioSearchInput() {
            if (this.scenarioSearchTimer) clearTimeout(this.scenarioSearchTimer);
            this.scenarioSearchTimer = setTimeout(() => this.loadScenarios(), 250);
        },

        handleScenarioSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.loadScenarios();
        }
    };

    window[PAGE_CODE] = M01002;
})();
