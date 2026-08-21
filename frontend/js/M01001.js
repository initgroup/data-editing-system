(function() {
    const PAGE_CODE = "M01001";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const emptyProject = () => ({
        projectId: null,
        projectCode: "",
        projectName: "",
        projectType: "EDITING",
        projectDesc: "",
        useYn: "Y",
        sortOrder: 0,
        userId: null,
        userEmail: "",
        isOwnerYn: "Y",
        ownerScope: "MY"
    });

    const M01001 = {
        
        ...COMMON,
        isInit: false,
        projects: [],
        selectedProject: emptyProject(),
        originalProject: emptyProject(),
        searchTimer: null,

        async init() {
            if (this.isInit) return;
            this.newProject(false);
            await this.loadProjects();
            this.updateAdminPurgeAction();
            this.isInit = true;
        },

        destroy() {
            this.unbindHelpEvents();
            this.projects = [];
            this.selectedProject = emptyProject();
            this.originalProject = emptyProject();
            if (this.searchTimer) {
                clearTimeout(this.searchTimer);
                this.searchTimer = null;
            }
            this.isInit = false;
        },

        async loadProjects() {
            const list = getContainerEl("#projectList-M01001");
            if (!list) return;

            const keyword = (getContainerEl("#projectSearch-M01001")?.value || "").trim();
            list.innerHTML = `<div class="env-tree-loading project-empty">${this.escapeHtml(this.t("loadingProjects", "Loading projects..."))}</div>`;

            try {
                const params = new URLSearchParams({ keyword });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/projects?${params.toString()}`, { method: "GET", showLoading: false });
                this.projects = Array.isArray(json.data) ? json.data : [];
                this.renderProjectList();
            } catch (error) {
                console.error("[M01001] project list load failed", error);
                list.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || this.t("projectListLoadFailed", "Project list load failed."))}</div>`;
            }
        },

        renderProjectList() {
            const list = getContainerEl("#projectList-M01001");
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
            const selectedClass = String(projectId) === String(this.selectedProject.projectId) ? "is-selected" : "";
            const ownerScopeClass = CommonUtils.getOwnerScopeClass(project);
            const name = project.PROJECT_NAME || "";
            const displayName = CommonUtils.formatOwnerScopedName(project, name || this.t("untitledProject", "(Untitled project)"));
            const code = project.PROJECT_CODE || "";
            const type = project.PROJECT_TYPE || "";
            const useYn = project.USE_YN || "Y";
            const title = displayName;
            const codeLabel = code || this.t("noCode", "No code");
            const useLabel = this.tl("useValue", "Use {value}", { value: useYn });
            const createdAtLabel = this.tl("createdAtValue", "Created {value}", {
                value: this.formatDateTime(project.CREATED_AT)
            });

            return `
                <button type="button" class="project-row ${selectedClass} ${this.escapeAttr(ownerScopeClass)}" data-project-id="${this.escapeAttr(projectId)}" onclick="M01001.selectProject('${this.escapeAttr(projectId)}')">
                    <span class="project-row-main">
                        <span class="project-row-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</span>
                        <span class="project-row-sub" title="${this.escapeHtml(codeLabel)}">${this.escapeHtml(codeLabel)}</span>
                    </span>
                    <span class="project-row-meta">
                        <span title="${this.escapeHtml(type)}">${this.escapeHtml(type || "-")}</span>
                        <span title="${this.escapeHtml(useLabel)}">${this.escapeHtml(useLabel)}</span>
                        <span title="${this.escapeHtml(createdAtLabel)}">${this.escapeHtml(createdAtLabel)}</span>
                    </span>
                </button>
            `;
        },

        async selectProject(projectId) {
            if (!projectId) return;

            try {
                const params = new URLSearchParams({ projectId });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/project?${params.toString()}`, { method: "GET" });
                const row = json.data || {};
                this.selectedProject = this.normalizeProject(row);
                this.originalProject = { ...this.selectedProject };
                this.renderProjectDetail();
                this.updateProjectSelection();
                this.updateDescription(this.tl("selectedProjectDescription", "Selected project: {name}", { name: this.selectedProject.projectName || "" }));
            } catch (error) {
                console.error("[M01001] project detail load failed", error);
                alert("Project detail load failed.");
            }
        },

        normalizeProject(row) {
            return {
                projectId: row.PROJECT_ID ?? row.projectId ?? "",
                projectCode: row.PROJECT_CODE ?? row.projectCode ?? "",
                projectName: row.PROJECT_NAME ?? row.projectName ?? "",
                projectType: row.PROJECT_TYPE ?? row.projectType ?? "EDITING",
                projectDesc: row.PROJECT_DESC ?? row.projectDesc ?? "",
                useYn: row.USE_YN ?? row.useYn ?? "Y",
                sortOrder: row.SORT_ORDER ?? row.sortOrder ?? 0,
                userId: row.USER_ID ?? row.userId ?? null,
                userEmail: row.USER_EMAIL ?? row.userEmail ?? "",
                isOwnerYn: row.IS_OWNER_YN ?? row.isOwnerYn ?? "Y",
                ownerScope: row.OWNER_SCOPE ?? row.ownerScope ?? "MY"
            };
        },

        newProject(render = true) {
            this.selectedProject = emptyProject();
            this.originalProject = emptyProject();
            if (render) {
                this.renderProjectDetail();
                this.updateProjectSelection();
                this.updateDescription(this.t("createProjectDescription", "Create a new project."));
                getContainerEl("#projectName-M01001")?.focus();
            }
        },

        updateProjectSelection() {
            const selectedId = String(this.selectedProject.projectId ?? "");
            getContainerEl("#projectList-M01001")?.querySelectorAll(".project-row").forEach((row) => {
                row.classList.toggle("is-selected", row.dataset.projectId === selectedId);
            });
        },

        resetProject() {
            this.selectedProject = { ...this.originalProject };
            this.renderProjectDetail();
        },

        renderProjectDetail() {
            const project = this.selectedProject;
            this.setValue("#projectId-M01001", project.projectId);
            this.setValue("#projectCode-M01001", project.projectCode);
            this.setValue("#projectName-M01001", project.projectName);
            this.ensureProjectTypeOption(project.projectType);
            this.setValue("#projectType-M01001", project.projectType);
            this.setValue("#projectDesc-M01001", project.projectDesc);
            this.setValue("#useYn-M01001", project.useYn || "Y");
            this.setValue("#sortOrder-M01001", project.sortOrder ?? 0);
            this.updateProjectEditAccess();
            this.updateAdminPurgeAction();
            this.hideProjectCodeHelp();
        },

        updateAdminPurgeAction() {
            const button = getContainerEl("#purgeProject-M01001");
            if (!button) return;
            const isAdmin = Boolean(CommonUtils.isAdminUser?.());
            button.hidden = !isAdmin;
            button.disabled = !isAdmin || !this.selectedProject?.projectId;
        },

        updateProjectEditAccess() {
            const isOwned = !this.selectedProject?.projectId || this.selectedProject.isOwnerYn !== "N";
            [
                "#projectCode-M01001",
                "#projectName-M01001",
                "#projectType-M01001",
                "#projectDesc-M01001",
                "#useYn-M01001",
                "#sortOrder-M01001"
            ].forEach((selector) => {
                const element = getContainerEl(selector);
                if (element) element.disabled = !isOwned;
            });
            ["#saveProject-M01001", "#resetProject-M01001", "#deleteProject-M01001"].forEach((selector) => {
                const button = getContainerEl(selector);
                if (button) button.disabled = !isOwned;
            });
        },

        ensureProjectTypeOption(value) {
            const select = getContainerEl("#projectType-M01001");
            const typeValue = String(value || "EDITING").trim();
            if (!select || !typeValue) return;

            const exists = Array.from(select.options).some((option) => option.value === typeValue);
            if (exists) return;

            const option = document.createElement("option");
            option.value = typeValue;
            option.textContent = typeValue;
            select.appendChild(option);
        },

        updateField(field, value) {
            this.selectedProject[field] = value;
        },

        toggleProjectCodeHelp(event) {
            event?.stopPropagation();
            const layer = getContainerEl("#projectCodeHelp-M01001");
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
            const container = getContainerEl("#projectCodeHelp-M01001")?.parentElement;
            if (container?.contains(event.target)) return;
            M01001.hideProjectCodeHelp();
        },

        handleHelpKeydown: (event) => {
            if (event.key === "Escape") {
                M01001.hideProjectCodeHelp();
            }
        },

        hideProjectCodeHelp() {
            const layer = getContainerEl("#projectCodeHelp-M01001");
            if (layer) layer.hidden = true;
            const button = getContainerEl(".project-help-btn");
            button?.setAttribute("aria-expanded", "false");
            this.unbindHelpEvents();
        },

        unbindHelpEvents() {
            document.removeEventListener("click", this.handleHelpOutsideClick);
            document.removeEventListener("keydown", this.handleHelpKeydown);
        },

        updateDescription(text) {
            const desc = getContainerEl("#projectDescription-M01001");
            if (desc) desc.textContent = text;
        },

        handleSearchInput() {
            if (this.searchTimer) clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => this.loadProjects(), 250);
        },

        handleSearchKey(event) {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.loadProjects();
        },

        validateProject() {
            const project = this.selectedProject;
            if (!String(project.projectName || "").trim()) {
                alert("Project name is required.");
                getContainerEl("#projectName-M01001")?.focus();
                return false;
            }
            if (!String(project.projectCode || "").trim()) {
                alert("Project code is required.");
                getContainerEl("#projectCode-M01001")?.focus();
                return false;
            }
            return true;
        },

        async saveProject() {
            if (!this.validateProject()) return;

            const payload = {
                ...this.selectedProject,
                projectId: this.selectedProject.projectId ? Number(this.selectedProject.projectId) : null,
                projectCode: String(this.selectedProject.projectCode || "").trim(),
                projectName: String(this.selectedProject.projectName || "").trim(),
                projectType: String(this.selectedProject.projectType || "EDITING").trim(),
                projectDesc: this.selectedProject.projectDesc || "",
                useYn: String(this.selectedProject.useYn || "Y").toUpperCase() === "N" ? "N" : "Y",
                sortOrder: Number(this.selectedProject.sortOrder || 0)
            };

            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/project/save`, {
                    method: "POST",
                    body: payload
                });

                this.selectedProject = this.normalizeProject(json.data);
                this.originalProject = { ...this.selectedProject };
                this.renderProjectDetail();
                await this.loadProjects();
                this.updateDescription(this.t("projectSavedDescription", "Project was saved."));
                alert("Project saved.");
            } catch (error) {
                console.error("[M01001] project save failed", error);
                alert(error.message || "Project save failed.");
            }
        },

        async deleteProject() {
            const projectId = this.selectedProject.projectId;
            if (!projectId) {
                CommonMessage.warn("Select a saved project before deleting.");
                return;
            }

            if (!(await CommonMessage.confirm(`Delete project "${this.selectedProject.projectName}"?`))) {
                return;
            }

            try {
                await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/project/delete`, {
                    method: "POST",
                    body: { projectId }
                });
                this.newProject(false);
                this.renderProjectDetail();
                await this.loadProjects();
                this.updateDescription(this.t("projectDeletedDescription", "Project was deleted."));
                CommonMessage.success("Project deleted.");
            } catch (error) {
                console.error("[M01001] project delete failed", error);
                CommonMessage.error(error.message || "Project delete failed.");
            }
        },

        async purgeProject() {
            if (!CommonUtils.isAdminUser?.()) {
                CommonMessage.error("관리자 권한이 필요한 기능입니다.");
                return;
            }

            const projectId = this.selectedProject?.projectId;
            if (!projectId) {
                CommonMessage.warn("완전 삭제할 저장된 프로젝트를 선택하세요.");
                return;
            }

            let confirmation = null;
            try {
                const previewResult = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/project/purge-preview`, {
                    method: "POST",
                    body: { projectId }
                });
                const preview = previewResult.data || {};
                if (!preview.canPurge) {
                    const blockers = Array.isArray(preview.blockers) ? preview.blockers.join("\n- ") : "안전 조건을 확인할 수 없습니다.";
                    CommonMessage.error(`프로젝트 완전 삭제가 차단되었습니다.\n\n- ${blockers}`);
                    return;
                }

                confirmation = await this.confirmAdminPurge({
                    scopeLabel: "프로젝트",
                    scopeDescription: "선택 프로젝트와 소속 전체 시나리오",
                    targetCode: preview.targetCode,
                    targetName: preview.targetName,
                    ownerLabel: preview.ownerEmail || `User #${preview.ownerUserId || "-"}`,
                    counts: preview.counts,
                    dropObjects: preview.dropObjects
                });
                if (!confirmation) return;

                const finalConfirmed = await CommonMessage.confirm(
                    `마지막 확인입니다.\n프로젝트 "${preview.targetName}"과 모든 소속 시나리오, 업무 데이터, 실행 이력 및 표시된 물리 테이블을 영구 삭제합니다.\n\n정말 실행하시겠습니까?`
                );
                if (!finalConfirmed) return;

                const result = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/project/purge`, {
                    method: "POST",
                    body: {
                        projectId,
                        confirmationCode: confirmation.confirmationCode,
                        adminKey: confirmation.adminKey
                    }
                });
                confirmation.adminKey = "";
                this.newProject(false);
                this.renderProjectDetail();
                await this.loadProjects();
                this.updateDescription("관리자 프로젝트 완전 삭제가 완료되었습니다.");
                CommonMessage.success(`프로젝트 완전 삭제 완료 · DROP 오브젝트 ${Number(result.droppedObjectCount || 0).toLocaleString()}개`);
            } catch (error) {
                console.error("[M01001] project purge failed", error);
                CommonMessage.error(error.message || "프로젝트 완전 삭제에 실패했습니다.");
            } finally {
                if (confirmation) confirmation.adminKey = "";
            }
        }
    };

    window[PAGE_CODE] = M01001;
})();
