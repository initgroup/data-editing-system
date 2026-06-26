(function() {
    const PAGE_CODE = "M04002";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const M04002 = {
        runs: [],
        nodes: [],
        projects: [],
        scenarios: [],
        selectedRun: null,
        selectedNode: null,
        runPage: 1,
        runTotal: 0,
        resultPage: 1,
        resultPageSize: 50,
        excludeEmptyConsequent: false,
        readableRuleConditionFilter: "ALL",
        ruleSummaryFilters: { conditionCount: "ALL", resultColumn: "ALL", resultHasValueYn: "ALL", page: 1, resultColumnPage: 1 },
        violationSql: { sql: "", page: 1, pageSize: 50, total: 0, columns: [], rows: [], title: "" },
        currentModelDetail: null,
        pendingRunId: "",
        currentExport: { filename: "integrated-result.csv", columns: [], rows: [] },

        async init() {
            const pendingRunId = sessionStorage.getItem("M04002:selectedRunId") || "";
            const pendingProjectId = sessionStorage.getItem("M04002:selectedProjectId") || "";
            const pendingScenarioId = sessionStorage.getItem("M04002:selectedScenarioId") || "";
            if (pendingRunId) {
                sessionStorage.removeItem("M04002:selectedRunId");
                this.pendingRunId = pendingRunId;
            }
            sessionStorage.removeItem("M04002:selectedProjectId");
            sessionStorage.removeItem("M04002:selectedScenarioId");
            await this.loadProjects(pendingProjectId);
            await this.loadScenarios(pendingScenarioId);
            if (this.pendingRunId) {
                await this.openPendingRunPage();
            } else {
                await this.loadRuns(1);
            }
        },

        destroy() {
            this.runs = [];
            this.nodes = [];
            this.projects = [];
            this.scenarios = [];
            this.selectedRun = null;
            this.selectedNode = null;
            this.currentModelDetail = null;
            this.closeViolationSqlPopup();
            this.pendingRunId = "";
            this.currentExport = { filename: "integrated-result.csv", columns: [], rows: [] };
        },

        async loadRuns(page = this.runPage, options = {}) {
            if (page === 1 && !options.preservePending) this.pendingRunId = "";
            const projectId = getContainerEl("#projectId-M04002")?.value || "";
            if (!projectId) {
                this.runs = [];
                this.nodes = [];
                this.runTotal = 0;
                this.selectedRun = null;
                this.selectedNode = null;
                this.renderRuns();
                this.renderRunSummary();
                const nodeList = getContainerEl("#nodeList-M04002");
                if (nodeList) nodeList.innerHTML = "";
                const panel = getContainerEl("#resultPanel-M04002");
                if (panel) panel.innerHTML = `<div class="table-empty">프로젝트를 선택하면 실행 이력이 표시됩니다.</div>`;
                return;
            }
            this.runPage = Math.max(1, Number(page || 1));
            const pageSize = Number(getContainerEl("#pageSize-M04002")?.value || 20);
            const params = new URLSearchParams({
                page: String(this.runPage),
                pageSize: String(pageSize),
                projectId,
                status: getContainerEl("#status-M04002")?.value || "ALL",
                keyword: getContainerEl("#keyword-M04002")?.value?.trim?.() || ""
            });
            const scenarioId = getContainerEl("#scenarioId-M04002")?.value || "";
            if (scenarioId) params.set("scenarioId", scenarioId);
            const list = getContainerEl("#runList-M04002");
            if (list) list.innerHTML = `<div class="table-empty">Loading runs...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs?${params.toString()}`, { method: "GET", showLoading: false });
                this.runs = Array.isArray(json.data) ? json.data : [];
                this.runTotal = Number(json.total || 0);
                this.renderRuns();
                const targetRunId = this.pendingRunId && this.runs.some((run) => String(run.FLOW_RUN_ID) === String(this.pendingRunId))
                    ? this.pendingRunId
                    : this.runs[0]?.FLOW_RUN_ID;
                if (targetRunId) await this.selectRun(targetRunId);
                if (this.pendingRunId && String(targetRunId) === String(this.pendingRunId)) this.pendingRunId = "";
            } catch (error) {
                if (list) list.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Run load failed.")}</div>`;
            }
        },

        async openPendingRunPage() {
            const flowRunId = this.pendingRunId;
            if (!flowRunId) {
                await this.loadRuns(1);
                return;
            }
            const projectId = getContainerEl("#projectId-M04002")?.value || "";
            if (!projectId) {
                await this.loadRuns(1);
                return;
            }
            const pageSize = Number(getContainerEl("#pageSize-M04002")?.value || 20);
            const params = new URLSearchParams({
                projectId,
                pageSize: String(pageSize),
                status: getContainerEl("#status-M04002")?.value || "ALL",
                keyword: getContainerEl("#keyword-M04002")?.value?.trim?.() || ""
            });
            const scenarioId = getContainerEl("#scenarioId-M04002")?.value || "";
            if (scenarioId) params.set("scenarioId", scenarioId);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs/${encodeURIComponent(flowRunId)}/position?${params.toString()}`, { method: "GET", showLoading: false });
                await this.loadRuns(Number(json.page || 1), { preservePending: true });
            } catch (error) {
                console.warn("[M04002] pending run position failed", error);
                await this.loadRuns(1);
            }
        },

        async loadProjects(preferredProjectId = "") {
            const select = getContainerEl("#projectId-M04002");
            if (select) select.innerHTML = `<option value="">Loading projects...</option>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/projects?keyword=`, { method: "GET", showLoading: false });
                this.projects = Array.isArray(json.data) ? json.data : [];
                if (select) {
                    select.innerHTML = `
                        <option value="">-- Select project --</option>
                        ${this.projects.map((project) => `
                            <option value="${this.escapeHtml(project.PROJECT_ID ?? "")}">
                                ${this.escapeHtml(project.PROJECT_NAME || project.PROJECT_CODE || `Project #${project.PROJECT_ID}`)}
                            </option>
                        `).join("")}
                    `;
                    const exists = this.projects.some((project) => String(project.PROJECT_ID) === String(preferredProjectId));
                    select.value = exists ? String(preferredProjectId) : String(this.projects[0]?.PROJECT_ID || "");
                }
            } catch (error) {
                if (select) select.innerHTML = `<option value="">Project load failed</option>`;
                throw error;
            }
        },

        async loadScenarios(preferredScenarioId = "") {
            const projectId = getContainerEl("#projectId-M04002")?.value || "";
            const select = getContainerEl("#scenarioId-M04002");
            this.scenarios = [];
            if (select) select.innerHTML = `<option value="">ALL</option>`;
            if (!projectId) return;
            const params = new URLSearchParams({ projectId, keyword: "" });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/M01002/scenarios?${params.toString()}`, { method: "GET", showLoading: false });
                this.scenarios = Array.isArray(json.data) ? json.data : [];
                if (select) {
                    select.innerHTML = `
                        <option value="">ALL</option>
                        ${this.scenarios.map((scenario) => `
                            <option value="${this.escapeHtml(scenario.SCENARIO_ID ?? "")}">
                                ${this.escapeHtml(scenario.SCENARIO_NAME || scenario.SCENARIO_CODE || `Scenario #${scenario.SCENARIO_ID}`)}
                            </option>
                        `).join("")}
                    `;
                    const exists = this.scenarios.some((scenario) => String(scenario.SCENARIO_ID) === String(preferredScenarioId));
                    select.value = exists ? String(preferredScenarioId) : "";
                }
            } catch (error) {
                if (select) select.innerHTML = `<option value="">Scenario load failed</option>`;
                throw error;
            }
        },

        async handleProjectChange() {
            await this.loadScenarios("");
            await this.loadRuns(1);
        },

        renderRuns() {
            const list = getContainerEl("#runList-M04002");
            const count = getContainerEl("#runCount-M04002");
            const pageText = getContainerEl("#runPage-M04002");
            const pageSize = Number(getContainerEl("#pageSize-M04002")?.value || 20);
            const totalPages = Math.max(1, Math.ceil(this.runTotal / pageSize));
            if (count) count.textContent = `${this.formatNumber(this.runTotal)} rows`;
            if (pageText) pageText.textContent = `${this.runPage} / ${totalPages}`;
            if (!list) return;
            if (!this.runs.length) {
                list.innerHTML = `<div class="table-empty">실행 이력이 없습니다.</div>`;
                return;
            }
            list.innerHTML = this.runs.map((run) => `
                <button type="button" class="m04002-run-card ${this.selectedRun?.FLOW_RUN_ID === run.FLOW_RUN_ID ? "is-selected" : ""}" onclick="M04002.selectRun(${Number(run.FLOW_RUN_ID)})">
                    <span>
                        <strong>Run #${this.escapeHtml(run.FLOW_RUN_ID)}</strong>
                        <small>${this.escapeHtml(run.FLOW_NAME || "-")}</small>
                        <em>${this.escapeHtml(this.formatDateTime(run.STARTED_AT || run.CREATED_AT))}</em>
                    </span>
                    <b class="${this.getStatusClass(run.STATUS)}">${this.escapeHtml(run.STATUS || "-")}</b>
                </button>
            `).join("");
        },

        changeRunPage(delta) {
            const pageSize = Number(getContainerEl("#pageSize-M04002")?.value || 20);
            const totalPages = Math.max(1, Math.ceil(this.runTotal / pageSize));
            const next = Math.min(totalPages, Math.max(1, this.runPage + delta));
            if (next !== this.runPage) this.loadRuns(next);
        },

        handleKeywordKeydown(event) {
            if (event.key === "Enter") this.loadRuns(1);
        },

        async selectRun(flowRunId) {
            this.selectedRun = this.runs.find((run) => Number(run.FLOW_RUN_ID) === Number(flowRunId)) || null;
            this.selectedNode = null;
            this.renderRuns();
            this.renderRunSummary();
            const nodeList = getContainerEl("#nodeList-M04002");
            const resultPanel = getContainerEl("#resultPanel-M04002");
            if (nodeList) nodeList.innerHTML = `<div class="table-empty">Loading nodes...</div>`;
            if (resultPanel) resultPanel.innerHTML = `<div class="table-empty">노드를 선택하면 결과 상세가 표시됩니다.</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs/${flowRunId}/nodes`, { method: "GET", showLoading: false });
                this.nodes = Array.isArray(json.data) ? json.data : [];
                this.renderNodes();
                const firstResultNode = this.nodes.find((node) => node.RESULT_KIND !== "NONE") || this.nodes[0];
                if (firstResultNode) await this.selectNode(firstResultNode.FLOW_NODE_RUN_ID);
            } catch (error) {
                if (nodeList) nodeList.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Node load failed.")}</div>`;
            }
        },

        renderRunSummary() {
            const el = getContainerEl("#runSummary-M04002");
            const run = this.selectedRun;
            if (!el) return;
            if (!run) {
                el.innerHTML = `<div class="table-empty">실행 이력을 선택하세요.</div>`;
                return;
            }
            el.innerHTML = `
                <article>
                    <span>Selected Run</span>
                    <strong>${this.escapeHtml(run.FLOW_NAME || "-")}</strong>
                    <small>Run #${this.escapeHtml(run.FLOW_RUN_ID)} · ${this.escapeHtml(run.STATUS || "-")} · ${this.escapeHtml(this.formatElapsedTime(run.STARTED_AT, run.FINISHED_AT, run.STATUS))}</small>
                </article>
                <article><span>Nodes</span><strong>${this.formatNumber(run.NODE_COUNT)}</strong><small>${this.formatNumber(run.SUCCESS_NODE_COUNT)} success / ${this.formatNumber(run.FAILED_NODE_COUNT)} failed</small></article>
                <article><span>Started</span><strong>${this.escapeHtml(this.formatDateTime(run.STARTED_AT))}</strong><small>${this.escapeHtml(run.MESSAGE || "")}</small></article>
            `;
        },

        renderNodes() {
            const el = getContainerEl("#nodeList-M04002");
            if (!el) return;
            if (!this.nodes.length) {
                el.innerHTML = `<div class="table-empty">노드 실행 결과가 없습니다.</div>`;
                return;
            }
            el.innerHTML = this.nodes.map((node) => `
                <button type="button" class="m04002-node-card ${this.getNodeTone(node)} ${this.selectedNode?.FLOW_NODE_RUN_ID === node.FLOW_NODE_RUN_ID ? "is-selected" : ""}" onclick="M04002.selectNode(${Number(node.FLOW_NODE_RUN_ID)})">
                    <span>
                        <i class="fas ${this.getNodeIcon(node)}"></i>
                        <strong>${this.escapeHtml(node.NODE_NAME || node.NODE_KEY || "-")}</strong>
                        <small>${this.escapeHtml(node.RESULT_KIND || "NONE")} ${node.RESULT_OBJECT_NAME ? `· ${this.escapeHtml(node.RESULT_OBJECT_NAME)}` : ""}</small>
                        ${this.renderNodeJobDesc(node)}
                    </span>
                    <b class="${this.getStatusClass(node.STATUS)}">${this.escapeHtml(node.STATUS || "-")}</b>
                </button>
            `).join("");
        },

        async selectNode(nodeRunId, page = 1) {
            this.selectedNode = this.nodes.find((node) => Number(node.FLOW_NODE_RUN_ID) === Number(nodeRunId)) || null;
            this.resultPage = Math.max(1, Number(page || 1));
            this.currentModelDetail = null;
            this.ruleSummaryFilters = { conditionCount: "ALL", resultColumn: "ALL", resultHasValueYn: "ALL", page: 1, resultColumnPage: 1 };
            this.renderNodes();
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel || !this.selectedNode) return;
            if (this.selectedNode.RESULT_KIND === "NONE") {
                panel.innerHTML = `<div class="table-empty">이 노드는 저장된 결과 테이블/모델이 없습니다.</div>`;
                return;
            }
            panel.innerHTML = `<div class="table-empty">Loading result...</div>`;
            if (this.selectedNode.RESULT_KIND === "MODEL") {
                await this.loadModelDetailSummary();
            } else {
                await this.loadResultTable(this.resultPage);
            }
        },

        async loadResultTable(page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            this.showResultLoading("결과 테이블 조회 중...");
            const ruleModelName = this.getSelectedNodeRuleModelName(node);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                objectName: node.RESULT_OBJECT_NAME,
                menuCode: node.REF_MENU_CODE || "",
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                page: String(page),
                pageSize: String(this.resultPageSize)
            });
            if (ruleModelName) params.set("ruleModelName", ruleModelName);
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/result-table?${params.toString()}`, { method: "GET", showLoading: false });
                this.currentExport = { filename: `${node.RESULT_OBJECT_NAME || "result"}.csv`, columns: json.columns || [], rows: json.data || [] };
                this.renderResultTable(json, "Result Table", "TABLE");
            } catch (error) {
                this.renderResultError(error.message || "Result table load failed.");
            }
        },

        async loadModelView(viewType = "VR", page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            this.showResultLoading(`${viewType} 뷰 조회 중...`, viewType);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                viewType,
                page: String(page),
                pageSize: String(this.resultPageSize)
            });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/model-view?${params.toString()}`, { method: "GET", showLoading: false });
                this.currentExport = { filename: `${json.viewName || node.RESULT_OBJECT_NAME || "model-view"}.csv`, columns: json.columns || [], rows: json.data || [] };
                this.renderModelView(json);
            } catch (error) {
                this.renderResultError(error.message || "Model view load failed.");
            }
        },

        async loadModelDetailSummary() {
            const node = this.selectedNode;
            if (!node) return;
            this.showResultLoading("모델 상세 분석 조회 중...");
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                limit: "12",
                includeSamples: "false"
            });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/model-detail-summary?${params.toString()}`, { method: "GET", showLoading: false });
                this.currentModelDetail = json;
                this.currentExport = { filename: `${node.RESULT_OBJECT_NAME || "model-detail"}.csv`, columns: [], rows: [] };
                this.renderModelAnalysis(json, "readable");
                this.loadModelRuleSummary(1);
            } catch (error) {
                this.renderResultError(error.message || "Model detail summary load failed.");
            }
        },

        async loadModelRuleSummary(page = 1) {
            const node = this.selectedNode;
            if (!node || !this.currentModelDetail) return;
            const filters = this.ruleSummaryFilters || {};
            this.currentModelDetail.ruleSummaryLoading = true;
            this.currentModelDetail.ruleSummaryError = "";
            this.renderModelAnalysis(this.currentModelDetail, this.getActiveModelAnalysisTab());
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                targetOwner: node.TARGET_OWNER || "",
                targetTable: node.TARGET_TABLE || "",
                page: String(Math.max(1, Number(page || 1))),
                pageSize: "12",
                resultColumnPage: String(Math.max(1, Number(filters.resultColumnPage || 1))),
                resultColumnPageSize: "12"
            });
            if (filters.conditionCount !== "ALL") params.set("conditionCount", String(filters.conditionCount));
            if (filters.resultColumn !== "ALL") params.set("resultColumn", String(filters.resultColumn));
            if (filters.resultHasValueYn !== "ALL") params.set("resultHasValueYn", String(filters.resultHasValueYn));
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/model-rule-summary?${params.toString()}`, {
                    method: "GET",
                    showLoading: false,
                    timeoutMs: 12000,
                    timeoutMessage: "규칙 요약 조회 시간이 길어져 중단했습니다."
                });
                if (this.selectedNode !== node || !this.currentModelDetail) return;
                this.currentModelDetail.ruleSummary = json;
                this.currentModelDetail.ruleSummaryLoading = false;
                this.ruleSummaryFilters.page = Number(json.page || page || 1);
                this.ruleSummaryFilters.resultColumnPage = Number(json.resultTopPage || filters.resultColumnPage || 1);
                this.currentExport = this.buildRuleSummaryExport(node, json);
                this.renderModelAnalysis(this.currentModelDetail, this.getActiveModelAnalysisTab());
            } catch (error) {
                if (this.selectedNode !== node || !this.currentModelDetail) return;
                this.currentModelDetail.ruleSummaryLoading = false;
                this.currentModelDetail.ruleSummaryError = error.message || "Rule summary load failed.";
                this.renderModelAnalysis(this.currentModelDetail, this.getActiveModelAnalysisTab());
            }
        },

        showResultLoading(message = "Loading...", activeViewType = "") {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel) return;
            panel.classList.add("is-loading");
            const activeType = String(activeViewType || "").toUpperCase();
            panel.querySelectorAll(".m04002-result-header nav button").forEach((button) => {
                const type = button.textContent?.trim?.().toUpperCase() || "";
                button.classList.toggle("is-active", Boolean(activeType) && type === activeType);
                button.disabled = true;
            });
            panel.querySelector(".m04002-result-loading-overlay")?.remove();
            const overlay = document.createElement("div");
            overlay.className = "m04002-result-loading-overlay";
            overlay.innerHTML = `
                <span><i class="fas fa-spinner fa-spin"></i></span>
                <strong>${this.escapeHtml(message)}</strong>
            `;
            panel.appendChild(overlay);
        },

        renderModelView(json) {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel) return;
            panel.classList.remove("is-loading");
            const viewType = json.viewType || "VR";
            const readable = viewType === "VR" ? this.renderReadableRules(json.data || []) : "";
            panel.innerHTML = `
                <header class="m04002-result-header">
                    <div>
                        <span>Oracle ML Model View</span>
                        <strong>${this.escapeHtml(json.owner)}.${this.escapeHtml(json.modelName)}</strong>
                        <small>${this.escapeHtml(json.viewName || "")} · ${this.formatNumber(json.total)} rows</small>
                        ${this.renderSelectedNodeJobDesc()}
                        ${this.renderSelectedNodeExecutionMeta()}
                    </div>
                    <nav>
                        ${["VR", "VI", "VG", "VA"].map((type) => `<button type="button" class="${type === viewType ? "is-active" : ""}" onclick="M04002.loadModelView('${type}', 1)">${type}</button>`).join("")}
                    </nav>
                </header>
                ${viewType === "VR" ? this.renderRuleFilterBar() : ""}
                ${readable}
                ${this.renderGrid(json.columns || [], json.data || [])}
                ${this.renderResultPager(json.page, json.pageSize, json.total, `M04002.loadModelView('${viewType}',`)}
            `;
        },

        renderModelAnalysis(json = this.currentModelDetail, activeTab = "readable") {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel || !json) return;
            panel.classList.remove("is-loading");
            const readableActive = activeTab !== "detail";
            const modelHeaderLabel = this.getModelHeaderLabel(json);
            panel.innerHTML = `
                <header class="m04002-result-header">
                    <div>
                        <span>${this.escapeHtml(this.selectedNode?.NODE_NAME || "Oracle ML Model View")}</span>
                        <strong>${this.escapeHtml(json.owner || this.selectedNode?.RESULT_OWNER)}.${this.escapeHtml(json.modelName || this.selectedNode?.RESULT_OBJECT_NAME)}</strong>
                        ${this.renderSelectedNodeJobDesc()}
                        ${this.renderSelectedNodeExecutionMeta()}
                    </div>
                    <em>${this.escapeHtml(modelHeaderLabel)}</em>
                </header>
                <div class="m04002-model-tabs">
                    <button type="button" class="${readableActive ? "is-active" : ""}" onclick="M04002.switchModelAnalysisTab('readable')">Readable Rules</button>
                    <button type="button" class="${!readableActive ? "is-active" : ""}" onclick="M04002.switchModelAnalysisTab('detail')">Detail Views</button>
                </div>
                <div class="m04002-model-tab-panel ${readableActive ? "is-active" : ""}" data-model-tab="readable">
                    ${this.renderReadableRuleSummary(json)}
                </div>
                <div class="m04002-model-tab-panel ${!readableActive ? "is-active" : ""}" data-model-tab="detail">
                    ${this.renderModelDetailViews(json)}
                </div>
            `;
        },

        switchModelAnalysisTab(tabName) {
            this.renderModelAnalysis(this.currentModelDetail, tabName);
        },

        getActiveModelAnalysisTab() {
            const active = getContainerEl("#resultPanel-M04002 .m04002-model-tabs button.is-active");
            return /Detail/i.test(active?.textContent || "") ? "detail" : "readable";
        },

        getModelDetailView(viewType, json = this.currentModelDetail) {
            const views = Array.isArray(json?.views) ? json.views : [];
            return views.find((view) => view.viewType === viewType) || null;
        },

        replaceModelDetailView(nextView) {
            if (!this.currentModelDetail || !nextView?.viewType) return;
            const views = Array.isArray(this.currentModelDetail.views) ? this.currentModelDetail.views : [];
            const index = views.findIndex((view) => view.viewType === nextView.viewType);
            if (index >= 0) views[index] = { ...views[index], ...nextView };
            else views.push(nextView);
            this.currentModelDetail.views = views;
        },

        async loadReadableRulesPage(page = 1) {
            await this.loadModelAnalysisViewPage("VR", page, 12, "readable");
        },

        async loadDetailViewPage(viewType, page = 1) {
            await this.loadModelAnalysisViewPage(viewType, page, 8, "detail");
        },

        async loadModelAnalysisViewPage(viewType, page = 1, pageSize = 8, activeTab = "detail") {
            const node = this.selectedNode;
            if (!node) return;
            const nextPage = Math.max(1, Number(page || 1));
            this.showResultLoading(`${viewType} 샘플 페이지 조회 중...`);
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                viewType,
                page: String(nextPage),
                pageSize: String(pageSize)
            });
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/model-view?${params.toString()}`, { method: "GET", showLoading: false });
                this.replaceModelDetailView({
                    viewType: json.viewType || viewType,
                    viewName: json.viewName || `DM$${viewType}${node.RESULT_OBJECT_NAME || ""}`,
                    description: json.description || "",
                    existsYn: json.existsYn || "Y",
                    columns: json.columns || [],
                    data: json.data || [],
                    total: Number(json.total || 0),
                    page: Number(json.page || nextPage),
                    pageSize: Number(json.pageSize || pageSize)
                });
                this.currentExport = { filename: `${json.viewName || node.RESULT_OBJECT_NAME || "model-view"}.csv`, columns: json.columns || [], rows: json.data || [] };
                if (viewType === "VR") this.readableRuleConditionFilter = "ALL";
                this.renderModelAnalysis(this.currentModelDetail, activeTab);
            } catch (error) {
                this.renderResultError(error.message || "Model view page load failed.");
            }
        },

        goReadableRulesPage() {
            const input = getContainerEl("#readableRulePage-M04002");
            this.loadReadableRulesPage(input?.value || 1);
        },

        goDetailViewPage(viewType) {
            const input = getContainerEl(`#detailViewPage-${viewType}-M04002`);
            this.loadDetailViewPage(viewType, input?.value || 1);
        },

        renderReadableRuleSummary(json) {
            const vi = this.getModelDetailView("VI", json) || {};
            const va = this.getModelDetailView("VA", json) || {};
            const vr = this.getModelDetailView("VR", json) || {};
            const itemDictionary = this.buildItemDictionary([...(vi.data || []), ...(va.data || [])]);
            const readableRules = this.buildReadableRuleCards(vr.data || [], itemDictionary);
            if (json?.ruleSummary || json?.ruleSummaryLoading || json?.ruleSummaryError) {
                return this.renderModelRuleSummaryDashboard(json, readableRules);
            }
            const conditionFiltered = this.applyReadableConditionFilter(readableRules);
            const filtered = this.excludeEmptyConsequent
                ? conditionFiltered.filter((rule) => !/값 정보 없음/.test(rule.thenText))
                : conditionFiltered;
            const visibleRuleCount = filtered.length;
            const baseRuleCount = readableRules.length;
            return `
                <div class="m04002-readable-rule-intro">
                    <div>
                        <strong>사람이 읽는 규칙 요약</strong>
                        <span>DM$VR 전체 ${this.formatNumber(vr.total || 0)}건 중 현재 ${this.getViewSampleRange(vr)} 샘플을 해석해 표시합니다. 조건 개수 칩을 선택하면 아래 규칙 목록이 바뀝니다.</span>
                    </div>
                    <div class="m04002-sample-controls">
                        <label>
                            <input type="checkbox" ${this.excludeEmptyConsequent ? "checked" : ""} onchange="M04002.toggleExcludeEmptyConsequent(this.checked)">
                            <span>결과 정보 없음 제외</span>
                        </label>
                        ${this.renderSamplePageJump("readableRulePage-M04002", vr, "M04002.goReadableRulesPage()", "M04002.loadReadableRulesPage")}
                    </div>
                </div>
                ${this.renderReadableRuleStats(readableRules, visibleRuleCount, baseRuleCount)}
                <div class="m04002-readable-rule-grid">
                    ${filtered.length ? filtered.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">표시할 규칙 행이 없습니다. Detail Views에서 원본 모델뷰를 확인하세요.</div>`}
                </div>
            `;
        },

        renderModelRuleSummaryDashboard(json, fallbackRules = []) {
            const summary = json?.ruleSummary;
            const loading = Boolean(json?.ruleSummaryLoading);
            const error = json?.ruleSummaryError || "";
            if (loading && !summary) {
                return `
                    <div class="m04002-readable-rule-intro">
                        <div>
                            <strong>사람이 읽는 규칙 요약</strong>
                            <span>Job 실행 시 저장된 규칙 요약 테이블을 조회하고 있습니다.</span>
                        </div>
                    </div>
                    <section class="m04002-readable-stats"><div class="table-empty">규칙 요약을 불러오는 중입니다...</div></section>
                    ${this.renderFallbackReadableRuleGrid(fallbackRules)}
                `;
            }
            if (!summary || Number(summary.overview?.TOTAL_RULES || 0) <= 0) {
                const message = error || "저장된 규칙 요약이 없습니다. 이 모델 Job을 다시 실행하면 요약 테이블이 생성됩니다.";
                return `
                    <div class="m04002-readable-rule-intro">
                        <div>
                            <strong>사람이 읽는 규칙 요약</strong>
                            <span>${this.escapeHtml(message)}</span>
                        </div>
                    </div>
                    ${this.renderFallbackReadableRuleGrid(fallbackRules)}
                `;
            }
            const overview = summary.overview || {};
            const rules = this.buildSummaryRuleCards(summary.rules || []);
            const totalPages = Math.max(1, Math.ceil(Number(summary.total || 0) / Number(summary.pageSize || 12)));
            return `
                <div class="m04002-readable-rule-intro">
                    <div>
                        <strong>사람이 읽는 규칙 요약</strong>
                        <span>${this.escapeHtml(this.describeRuleSummaryBasis(overview))} 조건 수나 결과 컬럼을 선택하면 아래 상세 규칙이 바뀝니다.</span>
                    </div>
                    <div class="m04002-sample-controls">
                        <button type="button" class="table-btn" onclick="M04002.exportCurrent()">
                            <i class="fas fa-file-export"></i>
                            Export
                        </button>
                        ${this.renderSamplePageJump("ruleSummaryPage-M04002", { page: summary.page, pageSize: summary.pageSize, total: summary.total }, "M04002.goRuleSummaryPage()", "M04002.loadModelRuleSummary")}
                    </div>
                </div>
                <section class="m04002-readable-stats">
                    <div class="m04002-readable-stat-metrics">
                        <span><b>${this.formatNumber(overview.TOTAL_RULES)}</b><small>전체 규칙</small></span>
                        <span><b>${this.formatNumber(overview.MAPPED_RULES)}</b><small>조건/결과 매핑</small></span>
                        <span><b>${this.formatNumber(overview.MISSING_RESULT_RULES)}</b><small>결과 값 없음</small></span>
                        <span><b>${this.formatNumber(summary.total)}</b><small>필터 결과</small></span>
                    </div>
                    <div class="m04002-readable-condition-dist">
                        <strong>조건 수 선택</strong>
                        <div>
                            <button type="button" class="${this.ruleSummaryFilters.conditionCount === "ALL" ? "is-active" : ""}" onclick="M04002.selectRuleSummaryCondition('ALL')">
                                <small>전체</small>
                                <b>${this.formatNumber(overview.TOTAL_RULES)}</b>
                            </button>
                            ${(summary.conditionDist || []).map((bucket) => `
                                <button type="button" class="${String(this.ruleSummaryFilters.conditionCount) === String(bucket.CONDITION_COUNT) ? "is-active" : ""}" onclick="M04002.selectRuleSummaryCondition('${String(Number(bucket.CONDITION_COUNT || 0))}')">
                                    <small>${Number(bucket.CONDITION_COUNT || 0) > 0 ? `조건 ${this.formatNumber(bucket.CONDITION_COUNT)}개` : "조건 미해석"}</small>
                                    <b>${this.formatNumber(bucket.RULE_COUNT)}</b>
                                </button>
                            `).join("")}
                        </div>
                    </div>
                </section>
                <section class="m04002-rule-facet-panel">
                    <header>
                        <strong>결과 컬럼 Top 12</strong>
                        <div class="m04002-rule-facet-actions">
                            ${this.renderResultColumnPager(summary)}
                            <button type="button" class="${this.ruleSummaryFilters.resultColumn === "ALL" ? "is-active" : ""}" onclick="M04002.selectRuleSummaryResult('ALL')">전체</button>
                        </div>
                    </header>
                    <div>
                        ${(summary.resultTop || []).map((item) => {
                            const rawColumn = item.RESULT_COLUMN === "(RESULT UNKNOWN)" ? "__NULL__" : item.RESULT_COLUMN;
                            return `
                                <button type="button" class="${this.ruleSummaryFilters.resultColumn === rawColumn ? "is-active" : ""}" onclick="M04002.selectRuleSummaryResult('${this.escapeJs(rawColumn)}')">
                                    <span>${this.renderColumnAwareCell(item.RESULT_COLUMN, summary)}</span>
                                    <b>${this.formatNumber(item.RULE_COUNT)}</b>
                                </button>
                            `;
                        }).join("")}
                    </div>
                </section>
                <div class="m04002-readable-rule-grid">
                    ${rules.length ? rules.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">선택한 조건에 해당하는 규칙이 없습니다.</div>`}
                </div>
                ${this.renderRuleSummaryPager(summary.page, totalPages)}
            `;
        },

        renderFallbackReadableRuleGrid(rules = []) {
            const filtered = this.excludeEmptyConsequent
                ? rules.filter((rule) => !/값 정보 없음/.test(rule.thenText))
                : rules;
            return `<div class="m04002-readable-rule-grid">${filtered.length ? filtered.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">표시할 규칙 행이 없습니다.</div>`}</div>`;
        },

        renderReadableRuleStats(rules = [], visibleRuleCount = 0, baseRuleCount = 0) {
            const stats = this.createReadableRuleStats(rules);
            return `
                <section class="m04002-readable-stats">
                    <div class="m04002-readable-stat-metrics">
                        <span><b>${this.formatNumber(stats.total)}</b><small>현재 샘플 규칙</small></span>
                        <span><b>${this.formatNumber(stats.mapped)}</b><small>조건/결과 매핑</small></span>
                        <span><b>${this.formatNumber(stats.missingResult)}</b><small>결과 정보 없음</small></span>
                        <span><b>${this.formatNumber(visibleRuleCount)}</b><small>표시 중</small></span>
                    </div>
                    <div class="m04002-readable-condition-dist">
                        <strong>조건 수 선택</strong>
                        <div>
                            <button type="button" class="${this.readableRuleConditionFilter === "ALL" ? "is-active" : ""}" onclick="M04002.selectReadableConditionFilter('ALL')">
                                <small>전체</small>
                                <b>${this.formatNumber(baseRuleCount)}</b>
                            </button>
                            ${stats.conditionBuckets.map((bucket) => `
                                <button type="button" class="${this.readableRuleConditionFilter === String(bucket.conditionCount) ? "is-active" : ""}" onclick="M04002.selectReadableConditionFilter('${String(Number(bucket.conditionCount || 0))}')">
                                    <small>${this.escapeHtml(bucket.label)}</small>
                                    <b>${this.formatNumber(bucket.count)}</b>
                                </button>
                            `).join("")}
                        </div>
                    </div>
                </section>
            `;
        },

        applyReadableConditionFilter(rules = []) {
            if (this.readableRuleConditionFilter === "ALL") return rules;
            const selected = Number(this.readableRuleConditionFilter);
            return rules.filter((rule) => Number(rule.conditionCount || 0) === selected);
        },

        selectReadableConditionFilter(value) {
            this.readableRuleConditionFilter = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.renderModelAnalysis(this.currentModelDetail, "readable");
        },

        selectRuleSummaryCondition(value) {
            this.ruleSummaryFilters.conditionCount = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.ruleSummaryFilters.page = 1;
            this.loadModelRuleSummary(1);
        },

        selectRuleSummaryResult(value) {
            this.ruleSummaryFilters.resultColumn = value === undefined || value === null || value === "" ? "ALL" : String(value);
            this.ruleSummaryFilters.page = 1;
            this.loadModelRuleSummary(1);
        },

        moveRuleSummaryResultColumns(direction) {
            const current = Math.max(1, Number(this.ruleSummaryFilters.resultColumnPage || 1));
            this.ruleSummaryFilters.resultColumnPage = Math.max(1, current + Number(direction || 0));
            this.loadModelRuleSummary(this.ruleSummaryFilters.page || 1);
        },

        renderResultColumnPager(summary = {}) {
            const page = Math.max(1, Number(summary.resultTopPage || this.ruleSummaryFilters.resultColumnPage || 1));
            const pageSize = Math.max(1, Number(summary.resultTopPageSize || 12));
            const total = Math.max(0, Number(summary.resultTopTotal || 0));
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const start = total ? ((page - 1) * pageSize) + 1 : 0;
            const end = total ? Math.min(total, page * pageSize) : 0;
            if (totalPages <= 1) {
                return `<span class="m04002-result-column-pager is-single"><small>전체 ${this.formatNumber(total)}개</small></span>`;
            }
            return `
                <span class="m04002-result-column-pager">
                    <button type="button" ${page <= 1 ? "disabled" : ""} onclick="M04002.moveRuleSummaryResultColumns(-1)"><i class="fas fa-chevron-left"></i></button>
                    <small>${this.formatNumber(start)}-${this.formatNumber(end)} / ${this.formatNumber(total)}</small>
                    <button type="button" ${page >= totalPages ? "disabled" : ""} onclick="M04002.moveRuleSummaryResultColumns(1)"><i class="fas fa-chevron-right"></i></button>
                </span>
            `;
        },

        goRuleSummaryPage() {
            const input = getContainerEl("#ruleSummaryPage-M04002");
            this.loadModelRuleSummary(input?.value || 1);
        },

        renderRuleSummaryPager(page, totalPages) {
            const current = Math.max(1, Number(page || 1));
            const total = Math.max(1, Number(totalPages || 1));
            const prev = Math.max(1, current - 1);
            const next = Math.min(total, current + 1);
            return `
                <footer class="m04002-pager">
                    <button type="button" ${current <= 1 ? "disabled" : ""} onclick="M04002.loadModelRuleSummary(${prev})"><i class="fas fa-chevron-left"></i></button>
                    <span>${this.formatNumber(current)} / ${this.formatNumber(total)}</span>
                    <button type="button" ${current >= total ? "disabled" : ""} onclick="M04002.loadModelRuleSummary(${next})"><i class="fas fa-chevron-right"></i></button>
                </footer>
            `;
        },

        createReadableRuleStats(rules = []) {
            const buckets = new Map();
            let mapped = 0;
            let missingResult = 0;
            let limited = 0;
            (rules || []).forEach((rule) => {
                if (rule.mappingLevel === "mapped") mapped += 1;
                else limited += 1;
                if (this.isEmptyRuleText(rule.thenText)) missingResult += 1;
                const count = Number(rule.conditionCount || 0);
                buckets.set(count, (buckets.get(count) || 0) + 1);
            });
            const conditionBuckets = Array.from(buckets.entries())
                .map(([conditionCount, count]) => ({
                    conditionCount,
                    label: conditionCount > 0 ? `조건 ${conditionCount}개` : "조건 미해석",
                    count
                }))
                .sort((a, b) => {
                    const aNumber = a.conditionCount > 0 ? a.conditionCount : 9999;
                    const bNumber = b.conditionCount > 0 ? b.conditionCount : 9999;
                    return aNumber - bNumber || a.label.localeCompare(b.label);
                });
            return {
                basis: "sample",
                total: rules.length,
                mapped,
                missingResult,
                limited,
                conditionBuckets
            };
        },

        buildSummaryRuleCards(rows = []) {
            return (rows || []).map((row, index) => {
                const conditionText = this.resolveRuleSideText(row.CONDITION_TEXT || "");
                const resultText = this.resolveRuleSideText(row.RESULT_TEXT || "");
                const hasResultValue = row.RESULT_HAS_VALUE_YN === "Y";
                const thenText = resultText
                    || (row.RESULT_COLUMN ? `${row.RESULT_COLUMN}${hasResultValue ? "" : " (값 정보 없음)"}` : "결과 정보 없음");
                const mapped = Boolean(conditionText && (resultText || row.RESULT_COLUMN));
                const source = String(row.RULE_SOURCE || "").toUpperCase();
                const modelType = String(row.MODEL_TYPE || "").toUpperCase();
                const isConditional = source.includes("CONDITIONAL");
                const isDecisionTree = modelType.includes("DECISION_TREE");
                const supportCount = Number(row.SUPPORT_COUNT || 0);
                const conditionTotal = Number(row.CONDITION_TOTAL_COUNT || 0);
                const frequencyLabel = supportCount && conditionTotal
                    ? `${this.formatNumber(supportCount)} / ${this.formatNumber(conditionTotal)}`
                    : "-";
                const supportText = row.RULE_SUPPORT === null || row.RULE_SUPPORT === undefined ? "-" : this.formatPercentMetric(row.RULE_SUPPORT);
                const confidenceText = row.RULE_CONFIDENCE === null || row.RULE_CONFIDENCE === undefined ? "-" : this.formatPercentMetric(row.RULE_CONFIDENCE);
                const liftText = row.RULE_LIFT === null || row.RULE_LIFT === undefined ? "-" : this.formatDecimal(row.RULE_LIFT);
                const note = this.describeReadableRuleSentence({
                    conditionText,
                    thenText,
                    supportCount,
                    conditionTotal,
                    supportText,
                    confidenceText,
                    liftText,
                    isConditional
                });
                return {
                    ruleId: `Rule #${row.RULE_ID || index + 1}`,
                    mappingLevel: mapped ? "mapped" : "limited",
                    mappingLabel: mapped
                        ? (isDecisionTree ? "Decision Tree 목표 규칙" : (isConditional ? "조건부 확률 규칙" : "조건/결과 매핑됨"))
                        : "ID/지표 중심",
                    ifText: conditionText || "조건 항목 조합을 Detail Views에서 확인해야 합니다",
                    thenText,
                    note,
                    metrics: [
                        { label: "count", value: frequencyLabel },
                        { label: "support", value: supportText },
                        { label: "confidence", value: confidenceText },
                        { label: "lift", value: liftText }
                    ],
                    conditionCount: Number(row.CONDITION_COUNT || 0)
                };
            });
        },

        describeReadableRuleSentence(rule = {}) {
            const condition = String(rule.conditionText || "").trim();
            const result = String(rule.thenText || "").trim();
            if (!condition || !result || result === "결과 정보 없음") {
                return rule.isConditional
                    ? "조건 또는 결과 값을 화면에서 해석하지 못한 조건부 빈도/확률 규칙입니다."
                    : "Job 실행 시 저장된 규칙 요약 테이블에서 가져온 상세 규칙입니다.";
            }
            const supportCount = Number(rule.supportCount || 0);
            const conditionTotal = Number(rule.conditionTotal || 0);
            const confidence = rule.confidenceText || "-";
            const support = rule.supportText || "-";
            const lift = rule.liftText || "-";
            if (supportCount && conditionTotal) {
                return `${condition} 조건을 만족한 ${this.formatNumber(conditionTotal)}건 중 ${result} 결과가 ${this.formatNumber(supportCount)}건입니다. 조건 기준 확률은 ${confidence}, 전체 지지도는 ${support}, lift는 ${lift}입니다.`;
            }
            return `${condition} 조건일 때 ${result} 결과로 이어지는 조건부 규칙입니다. 조건 기준 확률은 ${confidence}, 전체 지지도는 ${support}, lift는 ${lift}입니다.`;
        },

        buildRuleSummaryExport(node = {}, json = {}) {
            const cards = this.buildSummaryRuleCards(json.rules || []);
            const rows = cards.map((card) => {
                const metricMap = {};
                (card.metrics || []).forEach((metric) => {
                    metricMap[String(metric.label || "").toUpperCase()] = metric.value;
                });
                return {
                    RULE_ID: card.ruleId,
                    IF: card.ifText,
                    THEN: card.thenText,
                    DESCRIPTION: card.note,
                    COUNT: metricMap.COUNT || "",
                    SUPPORT: metricMap.SUPPORT || "",
                    CONFIDENCE: metricMap.CONFIDENCE || "",
                    LIFT: metricMap.LIFT || "",
                    CONDITION_COUNT: card.conditionCount,
                    RULE_TYPE: card.mappingLabel
                };
            });
            return {
                filename: `${node.RESULT_OBJECT_NAME || "rule-summary"}_readable.csv`,
                columns: ["RULE_ID", "IF", "THEN", "DESCRIPTION", "COUNT", "SUPPORT", "CONFIDENCE", "LIFT", "CONDITION_COUNT", "RULE_TYPE"],
                rows
            };
        },

        describeRuleSummaryBasis(overview = {}) {
            const modelType = String(overview.MODEL_TYPE || "").toUpperCase();
            const source = String(overview.RULE_SOURCE || "").toUpperCase();
            if (modelType.includes("DECISION_TREE")) {
                return "Decision Tree 분류 모델의 목표 컬럼을 기준으로 저장된 조건부 빈도/확률 규칙 현황을 보여줍니다.";
            }
            if (modelType.includes("APRIORI") && source.includes("CONDITIONAL")) {
                return "Apriori 모델 입력 데이터에서 계산한 조건부 빈도/확률 기반 규칙 현황을 보여줍니다.";
            }
            if (source.includes("ORACLE_DM_VR")) {
                return "Oracle ML 규칙 뷰를 해석해 저장한 규칙 현황을 보여줍니다.";
            }
            return "저장된 요약 테이블 기준으로 전체 규칙 현황을 보여줍니다.";
        },

        getModelHeaderLabel(json = {}) {
            const metadata = json.modelMetadata || {};
            const miningFunction = String(metadata.MINING_FUNCTION || "").trim();
            const algorithm = String(metadata.ALGORITHM || "").trim();
            if (miningFunction && algorithm) return `${miningFunction} · ${algorithm}`;
            if (algorithm) return algorithm;
            if (miningFunction) return miningFunction;
            const overview = json.ruleSummary?.overview || {};
            const modelType = String(overview.MODEL_TYPE || "").trim();
            return modelType || "Oracle ML Model View";
        },

        renderReadableRuleCard(rule) {
            const qualityClass = rule.mappingLevel === "mapped" ? "is-mapped" : "is-limited";
            return `
                <article class="m04002-readable-rule-card ${qualityClass}">
                    <header>
                        <span>${this.escapeHtml(rule.ruleId)}</span>
                        <em>${this.escapeHtml(rule.mappingLabel)}</em>
                    </header>
                    <div class="m04002-readable-rule-sentence">
                        <b>IF</b>
                        <strong>${this.renderColumnAwareText(rule.ifText)}</strong>
                        <b>THEN</b>
                        <strong>${this.renderColumnAwareText(rule.thenText)}</strong>
                    </div>
                    <p>${this.renderColumnAwareText(rule.note)}</p>
                    <footer>
                        ${rule.metrics.map((metric) => `
                            <span>
                                <small>${this.escapeHtml(metric.label)}</small>
                                <strong>${this.escapeHtml(metric.value)}</strong>
                            </span>
                        `).join("")}
                    </footer>
                </article>
            `;
        },

        renderModelDetailViews(json) {
            const vi = this.getModelDetailView("VI", json) || {};
            const vr = this.getModelDetailView("VR", json) || {};
            const vg = this.getModelDetailView("VG", json) || {};
            const va = this.getModelDetailView("VA", json) || {};
            const itemTags = this.extractItemsetTags(vi.data || []).slice(0, 28);
            const rules = this.extractRuleRows(vr.data || []).slice(0, 10);
            return `
                <div class="m04002-model-visual-grid">
                    <div class="m04002-model-view-card is-vi">
                        ${this.renderModelViewHeader("VI", "Itemset/detail", vi)}
                        <div class="m04002-model-view-note">
                            <strong>Extracted itemset values</strong>
                            <span>DM$VI 원본 행의 ITEM / ATTRIBUTE / VALUE / NAME 계열 컬럼에서 추출한 값입니다.</span>
                        </div>
                        <div class="m04002-tag-cloud">
                            ${itemTags.length ? itemTags.map((item) => `<span style="--tag-weight:${item.weight}">${this.escapeHtml(item.label)}</span>`).join("") : `<small>DM$VI itemset row가 없습니다.</small>`}
                        </div>
                        ${this.renderSampleTable("DM$VI sample rows", vi.columns || [], vi.data || [], 5)}
                    </div>
                    <div class="m04002-model-view-card is-vr">
                        ${this.renderModelViewHeader("VR", "Top Rules", vr)}
                        ${rules.length ? `
                            <div class="m04002-rule-bars">
                                ${rules.map((rule) => `
                                    <div class="m04002-rule-bar">
                                        <span title="${this.escapeHtml(rule.label)}">${this.escapeHtml(rule.label)}</span>
                                        <em><i style="width:${Math.max(4, rule.score)}%"></i></em>
                                        <small>
                                            <b>${this.escapeHtml(rule.scoreName)}</b>
                                            <strong>${this.escapeHtml(rule.scoreValue)}</strong>
                                        </small>
                                    </div>
                                `).join("")}
                            </div>
                        ` : `<small>DM$VR rule row가 없습니다.</small>`}
                    </div>
                </div>
                <div class="m04002-model-view-card is-vg">
                    ${this.renderModelViewHeader("VG", "Global/detail", vg)}
                    ${this.renderSampleTable("", vg.columns || [], vg.data || [], 4)}
                </div>
                <div class="m04002-model-view-card is-va">
                    ${this.renderModelViewHeader("VA", "Attribute/detail rows", va)}
                    ${this.renderSampleTable("", va.columns || [], va.data || [], 6)}
                </div>
                <div class="m04002-model-view-card is-vr">
                    ${this.renderModelViewHeader("VR", "Rule/detail rows", vr)}
                    ${this.renderSampleTable("", vr.columns || [], vr.data || [], 8)}
                </div>
            `;
        },

        renderModelViewHeader(viewType, title, view = {}) {
            const exists = (view.existsYn || "N") === "Y";
            const hasRows = Array.isArray(view.data) && view.data.length > 0;
            const loadButton = exists && !hasRows
                ? `<button type="button" class="table-btn" onclick="M04002.loadDetailViewPage('${this.escapeHtml(viewType)}', 1)">샘플 조회</button>`
                : "";
            return `
                <div class="m04002-model-view-header">
                    <span class="m04002-model-view-type">${this.escapeHtml(viewType)}</span>
                    <div>
                        <strong>${this.escapeHtml(title)}</strong>
                        <small>${this.escapeHtml(view.description || "")}</small>
                        <code>${this.escapeHtml(view.viewName || `DM$${viewType}`)}</code>
                        <small>${hasRows ? `샘플 ${this.escapeHtml(this.getViewSampleRange(view))} / 전체 ${this.formatNumber(view.total || 0)} rows` : "초기 로딩 속도를 위해 샘플은 아직 조회하지 않았습니다."}</small>
                    </div>
                    <em>${hasRows ? `${this.formatNumber(view.total || 0)} rows` : (exists ? "ready" : "none")}</em>
                </div>
                <div class="m04002-view-sample-toolbar">
                    <span>${hasRows ? "현재 표는 전체 데이터가 아니라 선택한 페이지의 샘플입니다." : "필요한 상세 뷰만 선택해서 조회합니다."}</span>
                    ${loadButton || this.renderSamplePageJump(`detailViewPage-${viewType}-M04002`, view, `M04002.goDetailViewPage('${viewType}')`, `M04002.loadDetailViewPage('${viewType}', `)}
                </div>
            `;
        },

        renderSampleTable(title, columns, rows, limit = 6) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__").slice(0, 8);
            const safeRows = (rows || []).slice(0, limit);
            if (!safeColumns.length || !safeRows.length) return `<div class="table-empty">표시할 샘플 행이 없습니다.</div>`;
            return `
                <div class="m04002-sample-table-wrap">
                    ${title ? `<strong>${this.escapeHtml(title)} · 화면 표시 ${this.formatNumber(safeRows.length)}건</strong>` : `<strong>화면 표시 ${this.formatNumber(safeRows.length)}건</strong>`}
                    <table class="table-grid m04002-sample-table">
                        <thead><tr>${safeColumns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${safeRows.map((row) => `<tr>${safeColumns.map((column) => `<td title="${this.escapeHtml(row?.[column] ?? "")}">${this.escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        getViewSampleRange(view = {}) {
            const page = Math.max(1, Number(view.page || 1));
            const pageSize = Math.max(1, Number(view.pageSize || view.data?.length || 1));
            const total = Number(view.total || 0);
            const count = Array.isArray(view.data) ? view.data.length : 0;
            if (!total || !count) return "0건";
            const start = ((page - 1) * pageSize) + 1;
            const end = Math.min(total, start + count - 1);
            return `${this.formatNumber(start)}-${this.formatNumber(end)}건`;
        },

        getViewTotalPages(view = {}) {
            const pageSize = Math.max(1, Number(view.pageSize || view.data?.length || 1));
            return Math.max(1, Math.ceil(Number(view.total || 0) / pageSize));
        },

        renderSamplePageJump(inputId, view = {}, goOnclick, pageCall) {
            const page = Math.max(1, Number(view.page || 1));
            const totalPages = this.getViewTotalPages(view);
            const callPage = (nextPage) => pageCall.endsWith(", ")
                ? `${pageCall}${nextPage})`
                : `${pageCall}(${nextPage})`;
            return `
                <div class="m04002-page-jump">
                    <button type="button" ${page <= 1 ? "disabled" : ""} onclick="${callPage(page - 1)}"><i class="fas fa-chevron-left"></i></button>
                    <label>
                        <span>Page</span>
                        <input id="${this.escapeHtml(inputId)}" type="number" min="1" max="${this.escapeHtml(totalPages)}" value="${this.escapeHtml(page)}" onkeydown="if(event.key==='Enter'){${goOnclick}}">
                        <small>/ ${this.formatNumber(totalPages)}</small>
                    </label>
                    <button type="button" onclick="${goOnclick}">Go</button>
                    <button type="button" ${page >= totalPages ? "disabled" : ""} onclick="${callPage(page + 1)}"><i class="fas fa-chevron-right"></i></button>
                </div>
            `;
        },

        renderResultTable(json, title, type) {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel) return;
            panel.classList.remove("is-loading");
            panel.innerHTML = `
                <header class="m04002-result-header">
                    <div>
                        <span>${this.escapeHtml(type)}</span>
                        <strong>${this.escapeHtml(json.owner)}.${this.escapeHtml(json.objectName)}</strong>
                        <small>${this.formatNumber(json.total)} rows</small>
                        ${json.filteredByTarget ? `<small>Target ${this.escapeHtml(json.targetOwner)}.${this.escapeHtml(json.targetTable)}</small>` : ""}
                        ${json.ruleModelName ? `<small>Rule Model ${this.escapeHtml(json.ruleModelName)}</small>` : ""}
                        ${this.renderSelectedNodeJobDesc()}
                        ${this.renderSelectedNodeExecutionMeta()}
                    </div>
                </header>
                ${this.renderViolationSummary(json.violationSummary)}
                ${this.renderCorrelationSummary(json.correlationSummary)}
                ${this.renderPredictedTypeSummary(json.predictedTypeSummary)}
                ${this.renderResultTableProfile(json.columns || [], json.data || [])}
                ${this.renderGrid(json.columns || [], json.data || [], json)}
                ${this.renderResultPager(json.page, json.pageSize, json.total, "M04002.loadResultTable(")}
            `;
        },

        renderResultError(message) {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel) return;
            panel.classList.remove("is-loading");
            panel.innerHTML = `<div class="table-error">${this.escapeHtml(message)}</div>`;
        },

        renderResultTableProfile(columns, rows) {
            const numericProfile = this.extractNumericProfile(rows || [], columns || []).slice(0, 8);
            if (!numericProfile.length) return "";
            return `
                <div class="m04002-table-profile-bars">
                    ${numericProfile.map((item) => `
                        <div class="m04002-profile-bar">
                            <span>${this.escapeHtml(item.column)}</span>
                            <em><i style="width:${item.width}%"></i></em>
                            <small>${this.escapeHtml(item.label)}</small>
                        </div>
                    `).join("")}
                </div>
            `;
        },

        renderViolationSummary(summary) {
            if (!summary) return "";
            this.lastViolationSummary = summary;
            const overview = summary.overview || {};
            const topRules = Array.isArray(summary.topRules) ? summary.topRules : [];
            const topColumns = Array.isArray(summary.topColumns) ? summary.topColumns : [];
            return `
                <section class="m04002-violation-summary">
                    <header>
                        <div>
                            <strong>규칙 위반 탐지 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner || "-")}.${this.escapeHtml(summary.targetTable || "-")}${summary.ruleModelName ? ` · Rule Model ${this.escapeHtml(summary.ruleModelName)}` : ""}</span>
                        </div>
                        <div class="m04002-corr-metrics">
                            <span><b>${this.formatNumber(overview.VIOLATION_COUNT)}</b><small>위반 건수</small></span>
                            <span><b>${this.formatNumber(overview.VIOLATED_ROW_COUNT)}</b><small>위반 Row</small></span>
                            <span><b>${this.formatNumber(overview.VIOLATED_RULE_COUNT)}</b><small>위반 규칙</small></span>
                            <span><b>${this.formatDecimal(overview.MAX_VIOLATION_SCORE)}</b><small>최고 점수</small></span>
                        </div>
                    </header>
                    ${topColumns.length ? `
                        <div class="m04002-violation-column-strip">
                            <strong>위반 결과 컬럼 Top</strong>
                            <div>
                                ${topColumns.map((item) => `
                                    <button type="button" onclick="M04002.openViolationSqlPopup('column', '${this.escapeJs(item.RESULT_COLUMN)}')">
                                        ${this.renderColumnAwareCell(item.RESULT_COLUMN, summary)}
                                        <b>${this.formatNumber(item.VIOLATION_COUNT)}</b>
                                    </button>
                                `).join("")}
                            </div>
                        </div>
                    ` : ""}
                    ${topRules.length ? `
                        <div class="m04002-violation-rule-grid">
                            ${topRules.map((rule) => `
                                <article>
                                    <header>
                                        <strong>${this.escapeHtml(rule.RULE_ID)}</strong>
                                        <button type="button" onclick="M04002.openViolationSqlPopup('rule', '${this.escapeJs(rule.RULE_ID)}')">${this.formatNumber(rule.VIOLATION_COUNT)}건</button>
                                    </header>
                                    <p>
                                        <b>IF</b>
                                        ${this.renderColumnAwareText(rule.CONDITION_TEXT || "", summary)}
                                        <b>THEN</b>
                                        ${this.renderColumnAwareCell(rule.RESULT_COLUMN, summary)} = ${this.escapeHtml(rule.EXPECTED_VALUE || "")}
                                    </p>
                                    <footer>
                                        <span><small>confidence</small><b>${this.formatPercentMetric(rule.RULE_CONFIDENCE)}</b></span>
                                        <span><small>lift</small><b>${this.formatDecimal(rule.RULE_LIFT)}</b></span>
                                        <span><small>score</small><b>${this.formatDecimal(rule.AVG_VIOLATION_SCORE)}</b></span>
                                    </footer>
                                </article>
                            `).join("")}
                        </div>
                    ` : `<div class="table-empty">탐지된 규칙 위반 결과가 없습니다.</div>`}
                </section>
            `;
        },

        openViolationSqlPopup(kind = "all", value = "") {
            const sql = this.createViolationSql(kind, value);
            if (!sql) return;
            const ruleColumns = this.getViolationRuleColumns(kind, value);
            const label = kind === "column"
                ? `결과 컬럼 ${value}`
                : (kind === "rule" ? `Rule ${value}` : "전체 위반");
            this.violationSql = {
                sql,
                page: 1,
                pageSize: 50,
                total: 0,
                columns: [],
                rows: [],
                ruleColumns,
                title: `${label} 위반 Row 조회`
            };
            this.renderViolationSqlPopup();
        },

        getViolationRuleColumns(kind = "all", value = "") {
            const columns = new Set();
            const summary = this.lastViolationSummary || {};
            if (kind === "column" && value) {
                columns.add(String(value).trim().toUpperCase());
            }
            if (kind === "rule" && value) {
                const rule = (summary.topRules || []).find((item) => String(item.RULE_ID) === String(value));
                this.extractColumnsFromRuleText(rule?.CONDITION_TEXT || "").forEach((column) => columns.add(column));
                if (rule?.RESULT_COLUMN) columns.add(String(rule.RESULT_COLUMN).trim().toUpperCase());
            }
            if (kind === "all") {
                (summary.topColumns || []).slice(0, 5).forEach((item) => {
                    if (item.RESULT_COLUMN) columns.add(String(item.RESULT_COLUMN).trim().toUpperCase());
                });
            }
            return [...columns].filter(Boolean);
        },

        extractColumnsFromRuleText(text) {
            const matches = String(text || "").match(/\b[A-Za-z][A-Za-z0-9_$#]{0,127}\b(?=\s*=)/g) || [];
            return [...new Set(matches.map((item) => item.trim().toUpperCase()).filter(Boolean))];
        },

        createViolationSql(kind = "all", value = "") {
            const node = this.selectedNode;
            if (!node) {
                alert("선택된 노드가 없습니다.");
                return "";
            }
            const resultOwner = this.normalizeIdentifierParam(node.RESULT_OWNER);
            const resultTable = this.normalizeIdentifierParam(node.RESULT_OBJECT_NAME);
            const targetOwner = this.normalizeIdentifierParam(node.TARGET_OWNER);
            const targetTable = this.normalizeIdentifierParam(node.TARGET_TABLE);
            if (!resultOwner || !resultTable || !targetOwner || !targetTable) {
                alert("위반 결과 또는 Target Table 정보가 부족합니다.");
                return "";
            }
            const ruleModelName = this.getSelectedNodeRuleModelName(node);
            const filters = [
                `V.TARGET_OWNER = ${this.sqlLiteral(targetOwner)}`,
                `V.TARGET_TABLE = ${this.sqlLiteral(targetTable)}`
            ];
            if (ruleModelName) filters.push(`V.MODEL_NAME = ${this.sqlLiteral(ruleModelName)}`);
            if (kind === "column" && value) filters.push(`V.RESULT_COLUMN = ${this.sqlLiteral(value)}`);
            if (kind === "rule" && value) filters.push(`V.RULE_ID = ${this.sqlLiteral(value)}`);
            return [
                "SELECT",
                "       V.VIOLATION_ID AS V_VIOLATION_ID,",
                "       V.RULE_ID AS V_RULE_ID,",
                "       V.RESULT_COLUMN AS V_RESULT_COLUMN,",
                "       V.EXPECTED_VALUE AS V_EXPECTED_VALUE,",
                "       V.ACTUAL_VALUE AS V_ACTUAL_VALUE,",
                "       V.VIOLATION_SCORE AS V_VIOLATION_SCORE,",
                "       V.RULE_CONFIDENCE AS V_RULE_CONFIDENCE,",
                "       V.RULE_LIFT AS V_RULE_LIFT,",
                "       V.CASE_ID AS V_CASE_ID,",
                "       T.*",
                `  FROM ${this.quoteSqlName(resultOwner)}.${this.quoteSqlName(resultTable)} V`,
                `  JOIN ${this.quoteSqlName(targetOwner)}.${this.quoteSqlName(targetTable)} T`,
                "    ON ROWIDTOCHAR(T.ROWID) = V.CASE_ROWID",
                ` WHERE ${filters.join("\n   AND ")}`,
                " ORDER BY V.VIOLATION_SCORE DESC NULLS LAST, V.RULE_CONFIDENCE DESC NULLS LAST, V.VIOLATION_ID"
            ].join("\n");
        },

        renderViolationSqlPopup() {
            let popup = document.getElementById("m04002ViolationSqlPopup");
            if (!popup) {
                popup = document.createElement("div");
                popup.id = "m04002ViolationSqlPopup";
                document.body.appendChild(popup);
            }
            const state = this.violationSql || {};
            const totalPages = Math.max(1, Math.ceil(Number(state.total || 0) / Number(state.pageSize || 50)));
            popup.className = "m04002-sql-popup";
            popup.innerHTML = `
                <section>
                    <header class="m04002-sql-popup-title" onmousedown="M04002.startViolationSqlPopupDrag(event)">
                        <div>
                            <strong>${this.escapeHtml(state.title || "위반 Row SQL")}</strong>
                            <span>Ctrl+Enter로 현재 SQL을 실행합니다.</span>
                        </div>
                        <button type="button" onclick="M04002.closeViolationSqlPopup()"><i class="fas fa-times"></i></button>
                    </header>
                    <div class="m04002-sql-popup-body">
                        <textarea id="m04002ViolationSqlEditor" class="m04002-sql-editor" spellcheck="false" onkeydown="M04002.handleViolationSqlKeydown(event)">${this.escapeHtml(state.sql || "")}</textarea>
                        <div class="m04002-sql-popup-toolbar">
                            <button type="button" class="table-btn primary" onclick="M04002.executeViolationSql(1)"><i class="fas fa-play"></i> Run</button>
                            <label>Rows
                                <select id="m04002ViolationSqlPageSize" onchange="M04002.executeViolationSql(1)">
                                    ${[20, 50, 100, 200].map((size) => `<option value="${size}" ${Number(state.pageSize || 50) === size ? "selected" : ""}>${size}</option>`).join("")}
                                </select>
                            </label>
                            <span>${this.formatNumber(state.total || 0)} rows</span>
                            <div class="m04002-page-jump">
                                <button type="button" ${Number(state.page || 1) <= 1 ? "disabled" : ""} onclick="M04002.executeViolationSql(${Math.max(1, Number(state.page || 1) - 1)})"><i class="fas fa-chevron-left"></i></button>
                                <label><span>Page</span><input id="m04002ViolationSqlPage" type="number" min="1" max="${totalPages}" value="${this.escapeHtml(state.page || 1)}" onkeydown="if(event.key==='Enter'){M04002.goViolationSqlPage()}"><small>/ ${this.formatNumber(totalPages)}</small></label>
                                <button type="button" onclick="M04002.goViolationSqlPage()">Go</button>
                                <button type="button" ${Number(state.page || 1) >= totalPages ? "disabled" : ""} onclick="M04002.executeViolationSql(${Number(state.page || 1) + 1})"><i class="fas fa-chevron-right"></i></button>
                            </div>
                        </div>
                        <div id="m04002ViolationSqlMessage" class="table-empty">${state.rows?.length ? "" : "SQL을 확인한 뒤 Run 또는 Ctrl+Enter로 조회하세요."}</div>
                        <div class="m04002-sql-result">
                            ${state.columns?.length ? this.renderViolationSqlGrid(state.columns, state.rows, state.ruleColumns || []) : ""}
                        </div>
                    </div>
                </section>
            `;
        },

        renderViolationSqlGrid(columns, rows, ruleColumns = []) {
            const safeColumns = this.orderViolationSqlColumns(columns || [], ruleColumns || []);
            const keyColumns = new Set(["V_VIOLATION_ID", "V_RULE_ID", "V_CASE_ID", "V_RESULT_COLUMN", "V_EXPECTED_VALUE", "V_ACTUAL_VALUE", "V_VIOLATION_SCORE"]);
            const ruleColumnSet = new Set((ruleColumns || []).map((column) => String(column).toUpperCase()));
            if (!safeColumns.length) return `<div class="table-empty">조회 결과가 없습니다.</div>`;
            return `
                <div class="m04002-violation-sql-grid-wrap">
                    <table class="table-grid m04002-violation-sql-grid">
                        <thead><tr>${safeColumns.map((column) => `<th class="${this.getViolationSqlColumnClass(column, keyColumns, ruleColumnSet)}">${this.renderColumnAwareCell(column, this.lastViolationSummary || {})}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${(rows || []).map((row) => `
                                <tr>${safeColumns.map((column) => {
                                    const value = row?.[column] ?? "";
                                    return `<td class="${this.getViolationSqlColumnClass(column, keyColumns, ruleColumnSet)}" title="${this.escapeHtml(value)}">${this.renderColumnAwareCell(value, this.lastViolationSummary || {})}</td>`;
                                }).join("")}</tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        orderViolationSqlColumns(columns, ruleColumns = []) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__");
            const keyOrder = ["V_VIOLATION_ID", "V_RULE_ID", "V_CASE_ID", "V_RESULT_COLUMN", "V_EXPECTED_VALUE", "V_ACTUAL_VALUE", "V_VIOLATION_SCORE"];
            const used = new Set();
            const pick = (names) => names
                .map((name) => safeColumns.find((column) => String(column).toUpperCase() === String(name).toUpperCase()))
                .filter((column) => column && !used.has(column) && used.add(column));
            const keys = pick(keyOrder);
            const rules = pick(ruleColumns || []);
            const rest = safeColumns.filter((column) => !used.has(column));
            return [...keys, ...rules, ...rest];
        },

        getViolationSqlColumnClass(column, keyColumns, ruleColumnSet) {
            const name = String(column || "").toUpperCase();
            if (keyColumns.has(name)) return "is-key";
            if (ruleColumnSet.has(name)) return "is-rule";
            return "";
        },

        closeViolationSqlPopup() {
            const popup = document.getElementById("m04002ViolationSqlPopup");
            if (popup) popup.remove();
        },

        handleViolationSqlKeydown(event) {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                this.executeViolationSql(1);
            }
        },

        async executeViolationSql(page = 1) {
            const editor = document.getElementById("m04002ViolationSqlEditor");
            if (!editor) return;
            const pageSize = Number(document.getElementById("m04002ViolationSqlPageSize")?.value || this.violationSql.pageSize || 50);
            const message = document.getElementById("m04002ViolationSqlMessage");
            if (message) message.textContent = "조회 중...";
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/sql`, {
                    method: "POST",
                    body: {
                        sql: editor.value || "",
                        page: Math.max(1, Number(page || 1)),
                        pageSize
                    },
                    showLoading: false
                });
                this.violationSql = {
                    ...(this.violationSql || {}),
                    sql: editor.value || "",
                    page: Number(json.page || page || 1),
                    pageSize: Number(json.pageSize || pageSize),
                    total: Number(json.total || 0),
                    columns: json.columns || [],
                    rows: json.data || []
                };
                this.renderViolationSqlPopup();
            } catch (error) {
                if (message) message.textContent = error.message || "SQL 조회에 실패했습니다.";
            }
        },

        goViolationSqlPage() {
            const page = Number(document.getElementById("m04002ViolationSqlPage")?.value || 1);
            this.executeViolationSql(page);
        },

        startViolationSqlPopupDrag(event) {
            const popup = document.getElementById("m04002ViolationSqlPopup");
            if (!popup || event.target.closest("button")) return;
            event.preventDefault();
            const rect = popup.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = rect.left;
            const startTop = rect.top;
            const move = (moveEvent) => {
                popup.style.left = `${Math.max(8, startLeft + moveEvent.clientX - startX)}px`;
                popup.style.top = `${Math.max(8, startTop + moveEvent.clientY - startY)}px`;
                popup.style.transform = "none";
            };
            const stop = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", stop);
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", stop);
        },

        renderCorrelationSummary(summary) {
            if (!summary) return "";
            const columns = Array.isArray(summary.associatedColumns) ? summary.associatedColumns : [];
            const visibleColumns = columns.slice(0, 80);
            const hiddenCount = Math.max(0, columns.length - visibleColumns.length);
            return `
                <section class="m04002-corr-summary">
                    <header>
                        <div>
                            <strong>상관 분석 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)}</span>
                        </div>
                        <div class="m04002-corr-metrics">
                            <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>전체 컬럼</small></span>
                            <span><b>${this.formatNumber(summary.associatedColumnCount)}</b><small>연관 컬럼</small></span>
                            <span><b>${this.formatNumber(summary.associatedPairCount)}</b><small>연관 쌍</small></span>
                        </div>
                    </header>
                    <p>PASS_YN=Y로 저장된 상관 컬럼은 ${this.formatNumber(summary.associatedColumnCount)}개입니다.</p>
                    <div class="m04002-corr-tags">
                        ${visibleColumns.map((column) => this.renderColumnChip(column, summary)).join("")}
                        ${hiddenCount ? `<em class="m04002-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                    </div>
                </section>
            `;
        },

        renderPredictedTypeSummary(summary) {
            if (!summary) return "";
            const groups = Array.isArray(summary.summaryGroups) ? summary.summaryGroups : [];
            const detailGroups = Array.isArray(summary.detailGroups) ? summary.detailGroups : [];
            return `
                <section class="m04002-type-summary">
                    <header>
                        <div>
                            <strong>컬럼 유형 예측 요약</strong>
                            <span>Target ${this.escapeHtml(summary.targetOwner)}.${this.escapeHtml(summary.targetTable)}</span>
                        </div>
                        <div class="m04002-corr-metrics">
                            <span><b>${this.formatNumber(summary.totalColumnCount)}</b><small>전체 컬럼</small></span>
                            ${groups.map((group) => `
                                <span><b>${this.formatNumber(group.columnCount)}</b><small>${this.escapeHtml(group.typeGroup)}</small></span>
                            `).join("")}
                        </div>
                    </header>
                    <div class="m04002-type-group-grid">
                        ${groups.map((group) => this.renderPredictedTypeGroup(group, summary)).join("")}
                    </div>
                    ${detailGroups.length ? `
                        <div class="m04002-type-detail">
                            <strong>MODL_PREDICTED_TYPE 상세 그룹</strong>
                            <div>
                                ${detailGroups.map((group) => `
                                    <span title="${this.escapeHtml(group.typeName)}">
                                        <b>${this.escapeHtml(group.typeName)}</b>
                                        <small>${this.formatNumber(group.columnCount)} columns</small>
                                    </span>
                                `).join("")}
                            </div>
                        </div>
                    ` : ""}
                </section>
            `;
        },

        renderPredictedTypeGroup(group, summary = null) {
            const columns = Array.isArray(group.columns) ? group.columns : [];
            const visibleColumns = columns.slice(0, 80);
            const hiddenCount = Math.max(0, columns.length - visibleColumns.length);
            return `
                <article class="m04002-type-group">
                    <header>
                        <strong>${this.escapeHtml(group.typeGroup)}</strong>
                        <small>${this.formatNumber(group.columnCount)} columns</small>
                    </header>
                    <div class="m04002-corr-tags">
                        ${visibleColumns.map((column) => this.renderColumnChip(column, summary || group)).join("")}
                        ${hiddenCount ? `<em class="m04002-column-chip">+${this.formatNumber(hiddenCount)} more</em>` : ""}
                    </div>
                </article>
            `;
        },

        renderReadableRules(rows) {
            const candidates = rows.map((row, index) => {
                const ruleId = row.RULE_ID || `Rule ${index + 1}`;
                const ifText = this.resolveRuleText(row.ANTECEDENT || row.ANTECEDENT_ITEMS || row.LHS || "");
                const thenText = this.resolveRuleText(row.CONSEQUENT || row.RHS || row.ITEM_NAME || "");
                return { row, ruleId, ifText, thenText };
            });
            const filtered = this.excludeEmptyConsequent
                ? candidates.filter((rule) => !this.isEmptyRuleText(rule.thenText))
                : candidates;
            const rules = filtered.slice(0, 12).map((rule) => {
                const row = rule.row;
                return `
                    <article class="m04002-rule-card">
                        <strong>Rule #${this.escapeHtml(rule.ruleId)}</strong>
                        <p><b>IF</b> ${this.escapeHtml(rule.ifText || "조건 정보 없음")}</p>
                        <p><b>THEN</b> ${this.escapeHtml(rule.thenText || "결과 정보 없음")}</p>
                        <small>support ${this.formatPercent(row.RULE_SUPPORT)} · confidence ${this.formatPercent(row.RULE_CONFIDENCE)} · lift ${this.escapeHtml(row.RULE_LIFT ?? "-")}</small>
                    </article>
                `;
            }).join("");
            return `<section class="m04002-rule-grid">${rules || `<div class="table-empty">조건에 맞는 규칙 카드가 없습니다. 원본 행은 아래 테이블에서 확인할 수 있습니다.</div>`}</section>`;
        },

        renderRuleFilterBar() {
            return `
                <div class="m04002-rule-filter-bar">
                    <label>
                        <input type="checkbox" ${this.excludeEmptyConsequent ? "checked" : ""} onchange="M04002.toggleExcludeEmptyConsequent(this.checked)">
                        <span>결과 정보 없음 제외</span>
                    </label>
                </div>
            `;
        },

        toggleExcludeEmptyConsequent(checked) {
            this.excludeEmptyConsequent = Boolean(checked);
            if (this.currentModelDetail) {
                this.renderModelAnalysis(this.currentModelDetail, "readable");
                return;
            }
            const viewButton = getContainerEl("#resultPanel-M04002 .m04002-result-header nav button.is-active");
            const viewType = viewButton?.textContent?.trim?.() || "VR";
            this.loadModelView(viewType, 1);
        },

        getNodeJobDesc(node = this.selectedNode) {
            return String(node?.JOB_DESC || node?.NODE_DESC || "").trim();
        },

        renderNodeJobDesc(node) {
            const desc = this.getNodeJobDesc(node);
            return desc ? `<em class="m04002-node-desc" title="${this.escapeHtml(desc)}">Job Desc: ${this.escapeHtml(desc)}</em>` : "";
        },

        renderSelectedNodeJobDesc() {
            const desc = this.getNodeJobDesc();
            return desc ? `<p class="m04002-result-job-desc" title="${this.escapeHtml(desc)}"><b>Job Desc</b> ${this.escapeHtml(desc)}</p>` : "";
        },

        renderSelectedNodeExecutionMeta() {
            const node = this.selectedNode;
            if (!node) return "";
            const payload = this.normalizeObject(node.PAYLOAD);
            const params = this.normalizeObject(node.RUNTIME_PARAMS);
            const getValue = (...keys) => {
                for (const key of keys) {
                    const value = node[key] ?? payload[key] ?? params[key];
                    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
                }
                return "";
            };
            const targetOwner = getValue("TARGET_OWNER", "targetOwner", "INIT$TargetOwner", "ownerName", "OWNER_NAME");
            const targetTable = getValue("TARGET_TABLE", "targetTable", "INIT$TargetTable", "tableName", "TABLE_NAME");
            const resultOwner = getValue("RESULT_OWNER", "resultOwner", "ownerName");
            const resultObject = getValue("RESULT_OBJECT_NAME", "resultTableName", "tableName", "RESULT_TABLE_NAME");
            const resultMode = getValue("RESULT_CREATE_YN", "resultCreateYn");
            const metaRows = [
                ["Target Owner", targetOwner],
                ["Target Table", targetTable],
                ["Result Owner", resultOwner],
                ["Result Table", resultObject],
                ["Result Mode", resultMode]
            ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
            const paramEntries = Object.entries(params)
                .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
                .map(([key, value]) => [key, this.formatParamValue(value)]);
            if (!metaRows.length && !paramEntries.length) return "";
            return `
                <section class="m04002-execution-meta ${this.getNodeTone(node)}">
                    <div class="m04002-execution-meta-grid">
                        ${metaRows.map(([label, value]) => `
                            <span>
                                <small>${this.escapeHtml(label)}</small>
                                <b title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</b>
                            </span>
                        `).join("")}
                    </div>
                    ${paramEntries.length ? `
                        <details class="m04002-param-details" open>
                            <summary>호출 옵션 파라미터 ${this.formatNumber(paramEntries.length)}개</summary>
                            <div>
                                ${paramEntries.map(([key, value]) => `
                                    <span>
                                        <small>${this.escapeHtml(key)}</small>
                                        <b title="${this.escapeHtml(value)}">${this.escapeHtml(value)}</b>
                                    </span>
                                `).join("")}
                            </div>
                        </details>
                    ` : ""}
                </section>
            `;
        },

        getSelectedNodeRuleModelName(node = this.selectedNode) {
            if (!node) return "";
            const payload = this.normalizeObject(node.PAYLOAD);
            const params = this.normalizeObject(node.RUNTIME_PARAMS);
            const candidates = [
                params.P_RULE_MODEL_NAME,
                params.pRuleModelName,
                params.ruleModelName,
                params["INIT$PreResultTable"],
                payload.P_RULE_MODEL_NAME,
                payload.pRuleModelName,
                payload.ruleModelName
            ];
            for (const value of candidates) {
                const normalized = this.normalizeIdentifierParam(value);
                if (normalized) return normalized;
            }
            return "";
        },

        normalizeIdentifierParam(value) {
            const text = String(value ?? "").trim().toUpperCase();
            return /^[A-Z][A-Z0-9_$#]{0,127}$/.test(text) ? text : "";
        },

        quoteSqlName(value) {
            return `"${String(value || "").replace(/"/g, "\"\"")}"`;
        },

        sqlLiteral(value) {
            return `'${String(value ?? "").replace(/'/g, "''")}'`;
        },

        normalizeObject(value) {
            if (!value) return {};
            if (typeof value === "object" && !Array.isArray(value)) return value;
            if (typeof value !== "string") return {};
            try {
                const parsed = JSON.parse(value);
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch (_error) {
                return {};
            }
        },

        formatParamValue(value) {
            if (value === undefined || value === null) return "";
            if (typeof value === "object") return JSON.stringify(value);
            return String(value);
        },

        getColumnComments(source = null) {
            return {
                ...(this.currentModelDetail?.columnComments || {}),
                ...(this.currentModelDetail?.ruleSummary?.columnComments || {}),
                ...(source?.columnComments || {}),
                ...(source?.correlationSummary?.columnComments || {}),
                ...(source?.predictedTypeSummary?.columnComments || {})
            };
        },

        getColumnComment(columnName, source = null) {
            const key = String(columnName || "").trim().toUpperCase();
            if (!key) return "";
            const comments = this.getColumnComments(source);
            return String(comments[key] || "").trim();
        },

        renderColumnRef(columnName, source = null) {
            const column = String(columnName || "").trim();
            if (!column) return "";
            const comment = this.getColumnComment(column, source);
            if (!comment) return this.escapeHtml(column);
            return `
                <span class="m04002-column-ref" title="${this.escapeHtml(`${column}: ${comment}`)}">
                    <b>${this.escapeHtml(column)}</b>
                    <small>${this.escapeHtml(comment)}</small>
                </span>
            `;
        },

        renderColumnChip(columnName, source = null) {
            const column = String(columnName || "").trim();
            if (!column) return "";
            const comment = this.getColumnComment(column, source);
            return `
                <em class="m04002-column-chip" title="${this.escapeHtml(comment ? `${column}: ${comment}` : column)}">
                    <b>${this.escapeHtml(column)}</b>
                    ${comment ? `<small>${this.escapeHtml(comment)}</small>` : ""}
                </em>
            `;
        },

        renderColumnAwareText(text, source = null) {
            const raw = String(text ?? "");
            if (!raw) return "";
            const pattern = /\b[A-Za-z][A-Za-z0-9_$#]{0,127}\b/g;
            let result = "";
            let lastIndex = 0;
            let match;
            while ((match = pattern.exec(raw)) !== null) {
                const token = match[0];
                result += this.escapeHtml(raw.slice(lastIndex, match.index));
                result += this.getColumnComment(token, source) ? this.renderColumnRef(token, source) : this.escapeHtml(token);
                lastIndex = match.index + token.length;
            }
            result += this.escapeHtml(raw.slice(lastIndex));
            return result;
        },

        renderColumnAwareCell(value, source = null) {
            const text = String(value ?? "");
            return this.getColumnComment(text, source) ? this.renderColumnRef(text, source) : this.escapeHtml(text);
        },

        extractItemsetTags(rows) {
            const counts = new Map();
            rows.forEach((row) => {
                Object.entries(row || {}).forEach(([key, value]) => {
                    if (!/ITEM|ATTRIBUTE|VALUE|NAME/i.test(key)) return;
                    String(value ?? "").split(/[{},;|]+/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
                        if (part.length > 48) return;
                        counts.set(part, (counts.get(part) || 0) + 1);
                    });
                });
            });
            const max = Math.max(1, ...counts.values());
            return [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => ({ label, weight: (0.75 + (count / max) * 0.65).toFixed(2) }));
        },

        extractRuleRows(rows) {
            return rows.map((row, index) => {
                const entries = Object.entries(row || {});
                const labelEntry = entries.find(([key]) => /RULE|ITEM|ANT|CONSE|PRED/i.test(key));
                const scoreEntry = entries.find(([key, value]) => /LIFT|CONF|SUPPORT|PROB/i.test(key) && !Number.isNaN(Number(value)));
                const rawScore = Number(scoreEntry?.[1] ?? 0);
                const score = rawScore <= 1 ? rawScore * 100 : Math.min(rawScore * 10, 100);
                return {
                    label: String(labelEntry?.[1] || `Rule ${index + 1}`).slice(0, 90),
                    score: Math.min(100, Math.max(0, score || 8)),
                    scoreName: scoreEntry?.[0] || "",
                    scoreValue: scoreEntry ? this.formatDecimal(rawScore) : ""
                };
            });
        },

        buildReadableRuleCards(rows, itemDictionary = new Map()) {
            return (rows || []).map((row, index) => {
                const ruleId = this.findRuleValue(row, [/^RULE_ID$/i, /RULE.*ID/i]) || `Rule ${index + 1}`;
                const antecedent = this.findRuleValue(row, [/ANTECEDENT/i, /\bLHS\b/i, /PREMISE/i, /CONDITION/i, /\bIF\b/i]);
                const consequent = this.findRuleValue(row, [/CONSEQUENT/i, /\bRHS\b/i, /PREDICT/i, /OUTCOME/i, /\bTHEN\b/i]);
                const antecedentText = this.resolveRuleSideText(antecedent, itemDictionary);
                const consequentText = this.resolveRuleSideText(consequent, itemDictionary);
                const thenText = consequentText && !this.ruleTextHasExplicitValue(consequentText) && !/값 정보 없음/.test(consequentText)
                    ? `${consequentText} (값 정보 없음)`
                    : consequentText;
                const support = this.findMetricValue(row, [/RULE_SUPPORT/i, /^SUPPORT$/i]);
                const confidence = this.findMetricValue(row, [/RULE_CONFIDENCE/i, /^CONFIDENCE$/i]);
                const lift = this.findMetricValue(row, [/RULE_LIFT/i, /^LIFT$/i]);
                const mapped = Boolean(antecedentText && consequentText);
                const missingConsequentValue = mapped && thenText !== consequentText;
                const conditionCount = mapped ? this.countRuleConditions(antecedentText) : 0;
                return {
                    ruleId: `Rule #${ruleId}`,
                    mappingLevel: mapped ? "mapped" : "limited",
                    mappingLabel: mapped ? "조건/결과 매핑됨" : "ID/지표 중심",
                    ifText: mapped ? antecedentText : "조건 항목 조합을 Detail Views에서 확인해야 합니다",
                    thenText: mapped ? thenText : "결과 항목을 Detail Views에서 확인해야 합니다",
                    note: mapped && missingConsequentValue
                        ? "조건은 XML itemset에서 컬럼 = 값으로 해석했습니다. 결과는 모델뷰가 컬럼명만 제공해서 값은 현재 뷰에서 확인되지 않습니다."
                        : (mapped
                            ? "모델 detail view의 XML itemset과 item dictionary 후보를 사용해 사람이 읽는 문장으로 구성했습니다."
                            : "현재 DM$VR/DM$VI/DM$VA 샘플에는 컬럼명과 값으로 복원 가능한 조건/결과 매핑이 보이지 않습니다."),
                    metrics: [
                        { label: "support", value: support === null ? "-" : this.formatPercentMetric(support) },
                        { label: "confidence", value: confidence === null ? "-" : this.formatPercentMetric(confidence) },
                        { label: "lift", value: lift === null ? "-" : this.formatDecimal(lift) }
                    ],
                    conditionCount,
                    thenText
                };
            });
        },

        countRuleConditions(text) {
            const normalized = String(text || "").trim();
            if (!normalized || /Detail Views에서 확인/.test(normalized)) return 0;
            return normalized
                .split(/\s+AND\s+/i)
                .map((item) => item.trim())
                .filter(Boolean).length || 0;
        },

        findRuleValue(row, patterns = []) {
            const found = Object.entries(row || {}).find(([key, value]) => {
                if (value === null || value === undefined || String(value).trim() === "") return false;
                if (this.isRuleMetricColumn(key)) return false;
                return patterns.some((pattern) => pattern.test(String(key || "")));
            });
            return found ? found[1] : "";
        },

        isRuleMetricColumn(key) {
            return /(SUPPORT|CONFIDENCE|LIFT|COUNT|PROB|P_VALUE|NUMERIC|RANK|PARTITION)/i.test(String(key || ""));
        },

        buildItemDictionary(rows = []) {
            const dictionary = new Map();
            rows.forEach((row) => {
                const entries = Object.entries(row || {});
                const idEntry = entries.find(([key, value]) => /(^|_)(ITEM|ITEMSET|ATTRIBUTE|ATTR).*ID$/i.test(key) && value !== null && value !== undefined);
                if (!idEntry) return;
                const name = this.findDictionaryValue(row, [/ATTRIBUTE.*NAME/i, /ATTR.*NAME/i, /COLUMN.*NAME/i, /^NAME$/i, /ITEM.*NAME/i]);
                const value = this.findDictionaryValue(row, [/ATTRIBUTE.*VALUE/i, /ATTR.*VALUE/i, /^VALUE$/i, /ITEM.*VALUE/i, /STRING.*VALUE/i]);
                const label = [name, value].filter(Boolean).join(" = ");
                if (label) dictionary.set(String(idEntry[1]), label);
            });
            return dictionary;
        },

        findDictionaryValue(row, patterns = []) {
            const found = Object.entries(row || {}).find(([key, value]) => {
                if (value === null || value === undefined || String(value).trim() === "") return false;
                return patterns.some((pattern) => pattern.test(String(key || "")));
            });
            return found ? String(found[1]).trim() : "";
        },

        resolveRuleSideText(value, dictionary = new Map()) {
            const text = String(value ?? "").trim();
            if (!text) return "";
            const itemsetItems = this.parseOracleItemsetText(text);
            if (itemsetItems.length) {
                return itemsetItems
                    .map((item) => this.formatOracleItemsetItem(item, dictionary))
                    .filter(Boolean)
                    .join(" AND ");
            }
            const tokens = text.split(/[{},;|]+/).map((part) => part.trim()).filter(Boolean);
            const resolved = tokens.map((token) => dictionary.get(token) || token);
            const meaningful = resolved.filter((token) => !/^\d+(\.\d+)?$/.test(token));
            if (!meaningful.length) return "";
            return meaningful.map((token) => this.formatRuleExpression(token)).join(" AND ");
        },

        parseOracleItemsetText(value) {
            const text = String(value ?? "").trim();
            if (!/<item\b/i.test(text)) return [];
            const items = [];
            const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
            let match;
            while ((match = itemPattern.exec(text)) !== null) {
                const itemBody = match[1] || "";
                items.push({
                    name: this.readXmlTagValue(itemBody, "item_name"),
                    subname: this.readXmlTagValue(itemBody, "item_subname"),
                    value: this.readXmlTagValue(itemBody, "item_value")
                });
            }
            return items;
        },

        formatOracleItemsetItem(item, dictionary = new Map()) {
            const rawName = String(item?.name || "").trim();
            const rawSubname = String(item?.subname || "").trim();
            const rawValue = String(item?.value || "").trim();
            const dictionaryLabel = dictionary.get(rawName);
            if (dictionaryLabel && !rawValue) return dictionaryLabel;
            const name = dictionaryLabel || rawName;
            if (!name && !rawValue) return "";
            const field = rawSubname ? `${name}.${rawSubname}` : name;
            if (field && rawValue) return `${field} = ${rawValue}`;
            if (field) return `${field} (값 정보 없음)`;
            return rawValue;
        },

        ruleTextHasExplicitValue(value) {
            return /(?:=|>|<|>=|<=|!=|<>|\bIS\b|\bLIKE\b)/i.test(String(value || ""));
        },

        findMetricValue(row, patterns = []) {
            const found = Object.entries(row || {}).find(([key, value]) => {
                if (value === null || value === undefined || String(value).trim() === "") return false;
                if (!patterns.some((pattern) => pattern.test(String(key || "")))) return false;
                return Number.isFinite(Number(value));
            });
            return found ? Number(found[1]) : null;
        },

        formatRuleExpression(value) {
            const text = String(value ?? "").trim();
            if (!text) return "-";
            return text
                .replace(/[{}"]/g, "")
                .replace(/\s*[|;]\s*/g, " AND ")
                .replace(/\s*,\s*/g, " AND ")
                .replace(/\s+/g, " ");
        },

        formatPercentMetric(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return "-";
            const percent = number <= 1 ? number * 100 : number;
            return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
        },

        extractNumericProfile(rows, columns) {
            return columns.map((column) => {
                const values = rows.map((row) => Number(row?.[column])).filter((value) => Number.isFinite(value));
                if (!values.length) return null;
                const max = Math.max(...values);
                const min = Math.min(...values);
                const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
                const width = max === min ? 100 : Math.max(6, Math.min(100, ((avg - min) / (max - min)) * 100));
                return { column, width, label: `avg ${this.formatDecimal(avg)}` };
            }).filter(Boolean);
        },

        isEmptyRuleText(value) {
            const text = String(value || "").trim();
            return !text || text === "결과 정보 없음" || /값 정보 없음/.test(text);
        },

        renderGrid(columns, rows, source = null) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__");
            if (!safeColumns.length) return `<div class="table-empty">조회 결과가 없습니다.</div>`;
            return `
                <div class="m04002-grid-wrap">
                    <table class="table-grid m04002-grid">
                        <thead><tr>${safeColumns.map((column) => `<th>${this.renderColumnAwareCell(column, source)}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${(rows || []).map((row) => `<tr>${safeColumns.map((column) => {
                                const value = row?.[column] ?? "";
                                return `<td title="${this.escapeHtml(value)}">${this.renderColumnAwareCell(value, source)}</td>`;
                            }).join("")}</tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },

        renderResultPager(page, pageSize, total, callPrefix) {
            const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 1)));
            const prev = Math.max(1, Number(page || 1) - 1);
            const next = Math.min(totalPages, Number(page || 1) + 1);
            return `
                <footer class="m04002-pager">
                    <button type="button" ${Number(page) <= 1 ? "disabled" : ""} onclick="${callPrefix}${prev})"><i class="fas fa-chevron-left"></i></button>
                    <span>${this.formatNumber(page)} / ${this.formatNumber(totalPages)}</span>
                    <button type="button" ${Number(page) >= totalPages ? "disabled" : ""} onclick="${callPrefix}${next})"><i class="fas fa-chevron-right"></i></button>
                </footer>
            `;
        },

        exportCurrent() {
            const columns = this.currentExport.columns || [];
            const rows = this.currentExport.rows || [];
            if (!columns.length) {
                alert("Export할 데이터가 없습니다.");
                return;
            }
            const csv = [
                columns.map((column) => this.csvCell(column)).join(","),
                ...rows.map((row) => columns.map((column) => this.csvCell(row?.[column] ?? "")).join(","))
            ].join("\r\n");
            const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = this.currentExport.filename || "integrated-result.csv";
            link.click();
            URL.revokeObjectURL(link.href);
        },

        csvCell(value) {
            return `"${String(value ?? "").replace(/"/g, '""')}"`;
        },

        resolveRuleText(value) {
            const text = String(value ?? "").trim();
            if (!text) return "";
            if (!/<item\b/i.test(text)) return text;
            const items = [];
            const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
            let match;
            while ((match = itemPattern.exec(text)) !== null) {
                const body = match[1] || "";
                const name = this.readXmlTagValue(body, "item_name");
                const subname = this.readXmlTagValue(body, "item_subname");
                const itemValue = this.readXmlTagValue(body, "item_value");
                const field = subname ? `${name}.${subname}` : name;
                if (field && itemValue) items.push(`${field} = ${itemValue}`);
                else if (field) items.push(`${field} (값 정보 없음)`);
            }
            return items.join(" AND ");
        },

        readXmlTagValue(text, tagName) {
            const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
            const match = pattern.exec(String(text || ""));
            return match ? this.decodeXmlText(match[1]).trim() : "";
        },

        decodeXmlText(value) {
            return String(value ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#39;/g, "'");
        },

        formatNumber(value) {
            const number = Number(value || 0);
            return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
        },

        formatDateTime(value) {
            const text = String(value || "").trim();
            if (!text) return "-";
            const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d+))?/);
            if (!match) return text.replace("T", " ");
            const milliseconds = String(match[3] || "000").padEnd(3, "0").slice(0, 3);
            return `${match[1]} ${match[2]}:${milliseconds}`;
        },

        formatPercent(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return "-";
            const percent = number <= 1 ? number * 100 : number;
            return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
        },

        formatDecimal(value) {
            const number = Number(value || 0);
            if (!Number.isFinite(number)) return "0";
            return number.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
        },

        formatElapsedTime(startedAt, finishedAt, status = "") {
            if (!startedAt) return "-";
            const start = new Date(startedAt);
            const end = finishedAt ? new Date(finishedAt) : (String(status).toUpperCase() === "RUNNING" ? new Date() : null);
            if (!end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
            const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
            if (seconds < 60) return `${seconds}s`;
            const minutes = Math.floor(seconds / 60);
            return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        },

        getStatusClass(status) {
            const text = String(status || "").toUpperCase();
            if (text === "SUCCESS") return "is-success";
            if (["FAILED", "SKIPPED", "ERROR"].includes(text)) return "is-failed";
            if (["RUNNING", "STARTED"].includes(text)) return "is-running";
            return "is-neutral";
        },

        getNodeTone(node) {
            const code = String(node.REF_MENU_CODE || node.NODE_TYPE || "").toUpperCase();
            if (code === "M03002") return "is-correlation";
            if (code === "M03003") return "is-discovery";
            if (code === "M03004") return "is-violation";
            return "is-profile";
        },

        getNodeIcon(node) {
            const code = String(node.REF_MENU_CODE || node.NODE_TYPE || "").toUpperCase();
            if (code === "M03002") return "fa-border-all";
            if (code === "M03003") return "fa-wand-magic-sparkles";
            if (code === "M03004") return "fa-shield-halved";
            return "fa-table-columns";
        },

        escapeHtml(value) {
            return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        },

        escapeJs(value) {
            return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n");
        }
    };

    window[PAGE_CODE] = M04002;
})();
