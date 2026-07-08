(function() {
    const PAGE_CODE = "home";

    const home = {
        ruleTrendChart: null,
        workflowResultChart: null,
        workflowJobChart: null,
        dashboardData: null,
        isRefreshingWorkflow: false,
        isRefreshingQuality: false,
        selectedNoticeId: null,
        noticeLayerMode: "list",
        selectedFlowRunLabel: "",
        selectedFlowRunId: "",
        selectedNodeRunId: "",

        init() {
            this.renderIdentity();
            this.renderWorkflowKpis();
            this.renderRuleTrendChart();
            this.renderFlowRunStrip();
            this.renderFlowDetailPanel({ deferLoad: true });
            this.renderAlerts();
            this.renderLinks();
            this.bindEvents();
            this.loadDashboard();
        },

        getLoginUser() {
            try {
                return JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
            } catch (error) {
                return {};
            }
        },

        getTargetName() {
            return sessionStorage.getItem("targetConnectionName")
                || (sessionStorage.getItem("targetConnectionId") ? `Connection #${sessionStorage.getItem("targetConnectionId")}` : "");
        },

        t(key, fallback = "") {
            return window.I18nManager?.tPage?.(PAGE_CODE, key, fallback) || fallback;
        },

        tFormat(key, fallback = "", values = {}) {
            const template = this.t(key, fallback);
            return template.replace(/\{(\w+)\}/g, (match, name) => (
                Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : match
            ));
        },

        renderIdentity() {
            const user = this.getLoginUser();
            const displayName = user.userName || user.USER_NAME || user.loginId || user.LOGIN_ID || "User";
            const role = user.roleCode || user.ROLE_CODE || "USER";
            const connection = this.dashboardData?.system?.connection;
            const targetName = connection?.connectionName || this.getTargetName();

            this.setText("homeGreeting", `${displayName}, ready for data editing`);
            this.setText("homeContextSummary", targetName
                ? `Active target database: ${targetName}. Recent rule signals are read from target execution history.`
                : "No target database is selected. Select a target DB to view recent rule discovery and violation detection history.");
            this.setText("homeUserName", displayName);
            this.setText("homeUserRole", String(role).toUpperCase());
            this.setText("homeTargetDb", targetName || "Not selected");
        },

        renderRuleTrendChart() {
            const canvas = document.getElementById("homeRuleTrendChart");
            if (!canvas || !window.Chart) return;
            if (this.ruleTrendChart) this.ruleTrendChart.destroy();
            const trend = this.normalizeFlowTrend(this.dashboardData?.target?.flowTrend || []);

            this.ruleTrendChart = new Chart(canvas, {
                type: "line",
                data: {
                    labels: trend.labels,
                    datasets: [
                        {
                            label: this.t("chartSuccessLabel", "Integrated scenario success"),
                            data: trend.success,
                            borderColor: "#2563eb",
                            backgroundColor: "rgba(37, 99, 235, 0.14)",
                            fill: true,
                            tension: 0.35,
                            borderWidth: 2.5,
                            pointRadius: (context) => Number(context.raw || 0) > 0 ? 5 : 0,
                            pointHoverRadius: 8,
                            statusLabel: this.t("statusSuccess", "Success")
                        },
                        {
                            label: this.t("chartFailedLabel", "Integrated scenario failed"),
                            data: trend.failed,
                            borderColor: "#dc2626",
                            backgroundColor: "#dc2626",
                            fill: false,
                            showLine: false,
                            pointStyle: "triangle",
                            pointRadius: (context) => Number(context.raw || 0) > 0 ? 8 : 0,
                            pointHoverRadius: (context) => Number(context.raw || 0) > 0 ? 10 : 0,
                            pointBorderColor: "#ffffff",
                            pointBorderWidth: 2,
                            statusLabel: this.t("statusFailed", "Failed"),
                            hasData: trend.failed.some((value) => Number(value || 0) > 0)
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: {
                            position: "bottom",
                            labels: {
                                boxWidth: 10,
                                usePointStyle: true,
                                filter: (item, data) => {
                                    const dataset = data.datasets[item.datasetIndex];
                                    return dataset.statusLabel !== this.t("statusFailed", "Failed") || dataset.hasData;
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const dataset = context.dataset || {};
                                    return this.tFormat("chartRunCount", "{status} {count} runs", {
                                        status: dataset.statusLabel || "",
                                        count: this.formatNumber(context.raw)
                                    });
                                },
                                afterBody: (items) => {
                                    const hasFailure = items.some((item) => item.dataset?.statusLabel === this.t("statusFailed", "Failed") && Number(item.raw || 0) > 0);
                                    return hasFailure
                                        ? [this.t("tooltipFailureDate", "This date has failed events."), this.t("tooltipSelectDate", "Select a date button below the chart to view runs.")]
                                        : [this.t("tooltipSelectDate", "Select a date button below the chart to view runs.")];
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: {
                            beginAtZero: true,
                            grace: "5%",
                            ticks: { precision: 0 },
                            grid: { color: "rgba(148, 163, 184, 0.24)" }
                        }
                    }
                }
            });
        },

        renderWorkflowKpis() {
            const container = document.getElementById("homeWorkflowKpiGrid");
            if (!container) return;
            const trend = this.normalizeFlowTrend(this.dashboardData?.target?.flowTrend || []);
            const runs = this.getRecentFlowRuns();
            const summary = this.summarizeFlowTrend(trend);
            const latest = runs[0] || null;
            const cards = [
                {
                    label: this.t("kpiTotalRuns", "Total runs"),
                    value: this.formatNumber(summary.totalRuns),
                    trend: summary.lastActivity
                        ? this.tFormat("kpiRecentRun", "Recent run {date}", { date: summary.lastActivity })
                        : this.t("kpiNoRecentRuns", "No runs in the last 7 days"),
                    icon: "fa-diagram-project",
                    tone: "is-primary"
                },
                {
                    label: this.t("kpiSuccessRate", "Success rate"),
                    value: summary.totalRuns ? `${summary.successRate}%` : "-",
                    trend: this.tFormat("kpiSuccessFailed", "{success} success / {failed} failed", {
                        success: this.formatNumber(summary.successRuns),
                        failed: this.formatNumber(summary.failedRuns)
                    }),
                    icon: "fa-chart-line",
                    tone: summary.failedRuns ? "is-warn" : "is-good"
                },
                {
                    label: this.t("kpiFailedRuns", "Failed runs"),
                    value: this.formatNumber(summary.failedRuns),
                    trend: summary.failedRuns
                        ? this.t("kpiFailureMarker", "Failure dates are marked in red")
                        : this.t("kpiNoRecentFailures", "No recent failures"),
                    icon: summary.failedRuns ? "fa-triangle-exclamation" : "fa-circle-check",
                    tone: summary.failedRuns ? "is-warn" : "is-good"
                },
                {
                    label: this.t("kpiLatestScenario", "Latest scenario"),
                    value: latest?.FLOW_NAME || this.t("none", "None"),
                    trend: latest ? `${latest.STATUS || "-"} · Run #${latest.FLOW_RUN_ID}` : this.t("noRunHistory", "No run history"),
                    icon: "fa-clock-rotate-left",
                    tone: latest?.STATUS === "SUCCESS" ? "is-good" : (latest ? "is-warn" : "is-neutral"),
                    wide: true
                }
            ];
            container.innerHTML = cards.map((card) => `
                <article class="home-kpi ${this.escapeHtml(card.tone)} ${card.wide ? "is-wide" : ""}">
                    <span class="home-kpi-icon"><i class="fas ${this.escapeHtml(card.icon)}"></i></span>
                    <div>
                        <span>${this.escapeHtml(card.label)}</span>
                        <strong title="${this.escapeHtml(card.value)}">${this.escapeHtml(card.value)}</strong>
                        <small>${this.escapeHtml(card.trend)}</small>
                    </div>
                </article>
            `).join("");
        },

        normalizeFlowTrend(rows) {
            const fallbackLabels = ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "Today"];
            if (!Array.isArray(rows) || rows.length === 0) {
                return {
                    labels: fallbackLabels,
                    success: [0, 0, 0, 0, 0, 0, 0],
                    failed: [0, 0, 0, 0, 0, 0, 0]
                };
            }
            const labels = [];
            const byLabel = {};
            rows.forEach((row) => {
                const label = row.label || row.RUN_DATE || "";
                const statusGroup = String(row.statusGroup || row.STATUS_GROUP || "SUCCESS").toUpperCase();
                const count = Number(row.count ?? row.CNT ?? 0);
                if (!label) return;
                if (!byLabel[label]) {
                    labels.push(label);
                    byLabel[label] = { success: 0, failed: 0 };
                }
                const statusKey = statusGroup === "FAILED" ? "failed" : "success";
                byLabel[label][statusKey] += count;
            });
            return {
                labels,
                success: labels.map((label) => byLabel[label].success),
                failed: labels.map((label) => byLabel[label].failed)
            };
        },

        summarizeFlowTrend(trend) {
            const successRuns = trend.success.reduce((sum, value) => sum + Number(value || 0), 0);
            const failedRuns = trend.failed.reduce((sum, value) => sum + Number(value || 0), 0);
            let lastActivity = "";
            trend.labels.forEach((label, index) => {
                if (Number(trend.success[index] || 0) + Number(trend.failed[index] || 0) > 0) lastActivity = label;
            });
            const totalRuns = successRuns + failedRuns;
            const successRate = totalRuns ? Math.round((successRuns / totalRuns) * 100) : 0;
            return { totalRuns, successRuns, failedRuns, successRate, lastActivity };
        },

        getRecentFlowRuns() {
            return Array.isArray(this.dashboardData?.target?.recentFlowRuns)
                ? this.dashboardData.target.recentFlowRuns
                : [];
        },

        getFlowRunLabel(row) {
            const value = row?.CREATED_AT || row?.STARTED_AT || "";
            const formatted = this.formatDateTime(value);
            const match = String(formatted || "").match(/^\d{4}-(\d{2})-(\d{2})/);
            if (match) return `${match[1]}-${match[2]}`;
            const compact = String(value || "").match(/^(\d{2})-(\d{2})/);
            return compact ? `${compact[1]}-${compact[2]}` : "";
        },

        renderFlowRunStrip() {
            const container = document.getElementById("homeFlowRunStrip");
            if (!container) return;
            const runs = this.getRecentFlowRuns();
            if (!runs.length) {
                container.innerHTML = `
                    <div class="home-flow-selection-empty">
                        <i class="fas fa-inbox"></i>
                        <span>${this.t("noIntegratedRunHistory", "No recent integrated scenario runs.")}</span>
                    </div>
                `;
                return;
            }
            if (!this.selectedFlowRunLabel) this.selectedFlowRunLabel = this.getFlowRunLabel(runs[0]);
            const trend = this.normalizeFlowTrend(this.dashboardData?.target?.flowTrend || []);
            const dateRuns = this.getFlowRunsByLabel(this.selectedFlowRunLabel);
            if (!dateRuns.some((run) => String(run.FLOW_RUN_ID || "") === String(this.selectedFlowRunId || ""))) {
                this.selectedFlowRunId = String(dateRuns[0]?.FLOW_RUN_ID || runs[0].FLOW_RUN_ID || "");
            }
            const successCount = dateRuns.filter((run) => String(run.STATUS || "").toUpperCase() === "SUCCESS").length;
            const failedCount = dateRuns.filter((run) => ["FAILED", "SKIPPED", "ERROR"].includes(String(run.STATUS || "").toUpperCase())).length;
            container.innerHTML = `
                <div class="home-flow-selection-summary">
                    <span><i class="fas fa-chart-line"></i></span>
                    <div>
                        <small>${this.t("selectedDate", "Selected date")}</small>
                        <strong>${this.escapeHtml(this.selectedFlowRunLabel || this.t("recentRun", "Recent run"))}</strong>
                    </div>
                </div>
                <div class="home-flow-date-selector" aria-label="Integrated scenario run date selector">
                    ${trend.labels.map((label, index) => {
                        const total = Number(trend.success[index] || 0) + Number(trend.failed[index] || 0);
                        const selected = String(label) === String(this.selectedFlowRunLabel || "");
                        return `
                            <button type="button" class="${selected ? "is-selected" : ""}" data-home-flow-label="${this.escapeHtml(label)}">
                                <strong>${this.escapeHtml(label)}</strong>
                                <small>${this.formatNumber(total)} runs</small>
                            </button>
                        `;
                    }).join("")}
                </div>
                <div class="home-flow-selection-metrics">
                    <span><strong>${this.formatNumber(dateRuns.length)}</strong><small>${this.t("runs", "runs")}</small></span>
                    <span><strong>${this.formatNumber(successCount)}</strong><small>${this.t("success", "success")}</small></span>
                    <span><strong>${this.formatNumber(failedCount)}</strong><small>${this.t("failed", "failed")}</small></span>
                </div>
            `;
            container.querySelectorAll("[data-home-flow-label]").forEach((button) => {
                button.onclick = () => this.selectFlowRunLabel(button.dataset.homeFlowLabel);
            });
            const selectedButton = container.querySelector(".home-flow-date-selector button.is-selected");
            selectedButton?.scrollIntoView({ block: "nearest", inline: "end" });
        },

        getFlowRunsByLabel(label) {
            return this.getRecentFlowRuns().filter((item) => this.getFlowRunLabel(item) === label);
        },

        async selectFlowRunLabel(label) {
            if (!label) return;
            await this.preserveHomeScroll(async () => {
                const runs = this.getFlowRunsByLabel(label);
                this.selectedFlowRunLabel = label;
                this.selectedFlowRunId = String(runs[0]?.FLOW_RUN_ID || "");
                this.selectedNodeRunId = "";
                this.renderFlowRunStrip();
                await this.renderFlowDetailPanel({ reload: true });
            });
        },

        async selectFlowRun(flowRunId) {
            if (!flowRunId) return;
            this.selectedFlowRunId = String(flowRunId);
            const selectedRun = this.getRecentFlowRuns().find((item) => String(item.FLOW_RUN_ID || "") === String(flowRunId));
            if (selectedRun) this.selectedFlowRunLabel = this.getFlowRunLabel(selectedRun) || this.selectedFlowRunLabel;
            document.querySelectorAll("#homeFlowDetailPanel [data-home-flow-run-id]").forEach((button) => {
                button.classList.toggle("is-selected", String(button.dataset.homeFlowRunId) === String(flowRunId));
            });
            this.openM04002Run(flowRunId);
        },

        getModuleMeta(menuCode) {
            const map = {
                M03001: { title: this.t("moduleProfiling", "Data Profiling"), icon: "fa-table-columns", tone: "is-profile", description: this.t("moduleProfilingDesc", "Column quality and distribution") },
                M03002: { title: this.t("moduleCorrelation", "Column Correlation"), icon: "fa-grip", tone: "is-correlation", description: this.t("moduleCorrelationDesc", "Correlation pairs and strength") },
                M03003: { title: this.t("moduleRuleDiscovery", "Rule Discovery"), icon: "fa-wand-magic-sparkles", tone: "is-discovery", description: this.t("moduleRuleDiscoveryDesc", "Itemsets and association rules") },
                M03004: { title: this.t("moduleRuleViolation", "Rule Violation"), icon: "fa-shield-halved", tone: "is-violation", description: this.t("moduleRuleViolationDesc", "Violation types and samples") }
            };
            return map[menuCode] || { title: "Flow Node", icon: "fa-cube", tone: "is-neutral", description: this.t("nodeResult", "Node result") };
        },

        async renderFlowDetailPanel(options = {}) {
            const panel = document.getElementById("homeFlowDetailPanel");
            if (!panel) return;
            const runs = this.getRecentFlowRuns();
            if (!this.selectedFlowRunLabel && runs.length) this.selectedFlowRunLabel = this.getFlowRunLabel(runs[0]);
            const dateRuns = this.getFlowRunsByLabel(this.selectedFlowRunLabel);
            if (this.selectedFlowRunLabel && !dateRuns.length) {
                panel.innerHTML = `
                    <div class="home-flow-detail-empty">
                        <i class="fas fa-calendar-xmark"></i>
                        <strong>${this.tFormat("noRunsForDate", "No run history for {date}", { date: this.escapeHtml(this.selectedFlowRunLabel) })}</strong>
                        <span>${this.t("selectDateWithRuns", "Select a chart point with runs to view node results.")}</span>
                    </div>
                `;
                return;
            }
            const selectedRun = dateRuns.find((item) => String(item.FLOW_RUN_ID || "") === String(this.selectedFlowRunId || "")) || dateRuns[0] || runs[0];
            if (!selectedRun) {
                panel.innerHTML = `
                    <div class="home-flow-detail-empty">
                        <i class="fas fa-diagram-project"></i>
                        <strong>${this.t("selectIntegratedScenarioRun", "Select an integrated scenario run")}</strong>
                        <span>${this.t("selectIntegratedScenarioRunDesc", "Select a run point on the line chart to view that date's runs and node results.")}</span>
                    </div>
                `;
                return;
            }
            this.selectedFlowRunId = String(selectedRun.FLOW_RUN_ID || "");
            this.selectedFlowRunLabel = this.getFlowRunLabel(selectedRun) || this.selectedFlowRunLabel;
            if (options.deferLoad && !options.reload) {
                panel.innerHTML = `
                    <header class="home-flow-detail-header">
                        <div>
                            <span>${this.t("scenarioRunSummary", "Scenario Run Summary")}</span>
                            <strong>${this.escapeHtml(selectedRun.FLOW_NAME || "Integrated Scenario")}</strong>
                            <small>Run #${this.escapeHtml(selectedRun.FLOW_RUN_ID || "")} · ${this.escapeHtml(selectedRun.STATUS || "-")} · ${this.escapeHtml(this.formatElapsedTime(selectedRun.STARTED_AT, selectedRun.FINISHED_AT, selectedRun.STATUS))}</small>
                        </div>
                        <button type="button" class="home-icon-button" title="Open integrated result analysis" onclick="home.openM04002Run('${this.escapeHtml(selectedRun.FLOW_RUN_ID || "")}')">
                            <i class="fas fa-up-right-from-square"></i>
                        </button>
                    </header>
                    ${this.renderDateRunList(dateRuns.length ? dateRuns : [selectedRun])}
                `;
                panel.querySelectorAll("[data-home-flow-run-id]").forEach((button) => {
                    button.onclick = () => this.selectFlowRun(button.dataset.homeFlowRunId);
                });
                return;
            }
            this.renderFlowSummaryContent(panel, selectedRun, dateRuns.length ? dateRuns : [selectedRun]);
        },

        renderFlowSummaryContent(panel, run, dateRuns = []) {
            const elapsed = this.formatElapsedTime(run.STARTED_AT, run.FINISHED_AT, run.STATUS);
            panel.innerHTML = `
                <header class="home-flow-detail-header">
                    <div>
                        <span>${this.t("scenarioRunSummary", "Scenario Run Summary")}</span>
                        <strong>${this.escapeHtml(run.FLOW_NAME || "Integrated Scenario")}</strong>
                        <small>Run #${this.escapeHtml(run.FLOW_RUN_ID || "")} · ${this.escapeHtml(run.STATUS || "-")} · ${this.escapeHtml(elapsed)}</small>
                    </div>
                    <button type="button" class="home-icon-button" title="Open integrated result analysis" onclick="home.openM04002Run('${this.escapeHtml(run.FLOW_RUN_ID || "")}')">
                        <i class="fas fa-up-right-from-square"></i>
                    </button>
                </header>
                ${this.renderDateRunList(dateRuns)}
            `;
            panel.querySelectorAll("[data-home-flow-run-id]").forEach((button) => {
                button.onclick = () => this.selectFlowRun(button.dataset.homeFlowRunId);
            });
        },

        openM04002Run(flowRunId = this.selectedFlowRunId) {
            if (flowRunId) {
                sessionStorage.setItem("M04002:selectedRunId", String(flowRunId));
                const run = this.getRecentFlowRuns().find((item) => String(item.FLOW_RUN_ID || "") === String(flowRunId));
                if (run?.PROJECT_ID) sessionStorage.setItem("M04002:selectedProjectId", String(run.PROJECT_ID));
                if (run?.SCENARIO_ID) sessionStorage.setItem("M04002:selectedScenarioId", String(run.SCENARIO_ID));
            }
            const menu = window.MENU_PAGE_MAP?.M04002;
            PageManager.load("M04002", menu?.title || menu?.label || this.t("integratedResultAnalysis", "Integrated Editing Result Analysis"), true);
        },

        showFlowDetailLoading(panel, message) {
            if (!panel) return null;
            panel.classList.add("is-soft-loading");
            const overlay = document.createElement("div");
            overlay.className = "home-flow-detail-loading-overlay";
            overlay.innerHTML = `
                <i class="fas fa-spinner fa-spin"></i>
                <span>${this.escapeHtml(message)}</span>
            `;
            panel.appendChild(overlay);
            return overlay;
        },

        hideFlowDetailLoading(panel, overlay) {
            panel?.classList.remove("is-soft-loading");
            overlay?.remove?.();
        },

        normalizeHomeNodes(rows) {
            const knownOrder = ["M03001", "M03002", "M03003", "M03004"];
            const nodes = rows.map((row) => {
                const payload = row.PAYLOAD || this.parseJson(row.NODE_PAYLOAD_JSON, {});
                const menuCode = row.REF_MENU_CODE || payload.refMenuCode || payload.menuCode || "";
                const meta = this.getModuleMeta(menuCode);
                return {
                    raw: row,
                    payload,
                    flowNodeRunId: String(row.FLOW_NODE_RUN_ID || ""),
                    menuCode,
                    title: meta.title,
                    icon: meta.icon,
                    tone: meta.tone,
                    description: meta.description,
                    nodeName: row.NODE_NAME || payload.nodeName || meta.title,
                    status: String(row.STATUS || "").toUpperCase(),
                    message: row.MESSAGE || "",
                    resultKind: row.RESULT_KIND || "NONE",
                    resultMode: row.RESULT_CREATE_YN || "N",
                    resultOwner: row.RESULT_OWNER || "",
                    resultObjectName: row.RESULT_OBJECT_NAME || "",
                    startedAt: row.STARTED_AT || "",
                    finishedAt: row.FINISHED_AT || ""
                };
            });
            return nodes.sort((a, b) => {
                const ai = knownOrder.indexOf(a.menuCode);
                const bi = knownOrder.indexOf(b.menuCode);
                return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
            });
        },

        renderFlowDetailContent(panel, run, nodes, dateRuns = []) {
            const elapsed = this.formatElapsedTime(run.STARTED_AT, run.FINISHED_AT, run.STATUS);
            panel.innerHTML = `
                <header class="home-flow-detail-header">
                    <div>
                        <span>Scenario Run Detail</span>
                        <strong>${this.escapeHtml(run.FLOW_NAME || "Integrated Scenario")}</strong>
                        <small>Run #${this.escapeHtml(run.FLOW_RUN_ID || "")} · ${this.escapeHtml(run.STATUS || "-")} · ${this.escapeHtml(elapsed)}</small>
                    </div>
                    <button type="button" class="home-icon-button" title="Open integrated result analysis" onclick="home.openM04002Run('${this.escapeHtml(run.FLOW_RUN_ID || "")}')">
                        <i class="fas fa-up-right-from-square"></i>
                    </button>
                </header>
                ${this.renderDateRunList(dateRuns)}
                <div class="home-run-node-divider">
                    <span>Selected Run Nodes</span>
                    <strong>Run #${this.escapeHtml(run.FLOW_RUN_ID || "")}</strong>
                </div>
                <div class="home-node-step-grid">
                    ${nodes.map((node) => this.renderNodeCard(node)).join("") || `<div class="table-empty">${this.t("noNodeRunResults", "No node run results.")}</div>`}
                </div>
                <div class="home-node-visual-panel" id="homeNodeVisualPanel">
                    <div class="home-flow-detail-empty">
                        <i class="fas fa-chart-simple"></i>
                        <strong>${this.t("selectNode", "Select a node")}</strong>
                        <span>${this.t("selectNodeDesc", "A visualization appears based on the result table or model view type.")}</span>
                    </div>
                </div>
            `;
            panel.querySelectorAll("[data-home-flow-run-id]").forEach((button) => {
                button.onclick = () => this.selectFlowRun(button.dataset.homeFlowRunId);
            });
            panel.querySelectorAll("[data-home-node-run-id]").forEach((button) => {
                button.onclick = () => this.selectFlowNode(button.dataset.homeNodeRunId, nodes);
            });
        },

        renderDateRunList(runs = []) {
            if (!runs.length) return "";
            return `
                <p class="home-date-run-hint">${this.t("runClickHint", "Click a run below to open its detailed analysis in M04002.")}</p>
                <div class="home-date-run-list" aria-label="Selected date integrated scenario runs">
                    ${runs.map((run) => {
                        const selected = String(run.FLOW_RUN_ID || "") === String(this.selectedFlowRunId || "");
                        return `
                            <button type="button" class="home-date-run-row ${selected ? "is-selected" : ""} ${this.getStatusClass(run.STATUS)}" data-home-flow-run-id="${this.escapeHtml(run.FLOW_RUN_ID || "")}">
                                <span>
                                    <strong>Run #${this.escapeHtml(run.FLOW_RUN_ID || "")}</strong>
                                    <small>${this.escapeHtml(run.FLOW_NAME || "Integrated Scenario")} · ${this.escapeHtml(this.formatDateTime(run.STARTED_AT || run.CREATED_AT))}</small>
                                </span>
                                <em>${this.escapeHtml(run.STATUS || "-")}</em>
                            </button>
                        `;
                    }).join("")}
                </div>
            `;
        },

        renderNodeCard(node) {
            const selected = String(node.flowNodeRunId) === String(this.selectedNodeRunId || "");
            return `
                <button type="button" class="home-node-card ${node.tone} ${this.getStatusClass(node.status)} ${selected ? "is-selected" : ""}" data-home-node-run-id="${this.escapeHtml(node.flowNodeRunId)}">
                    <span class="home-node-icon"><i class="fas ${this.escapeHtml(node.icon)}"></i></span>
                    <span class="home-node-main">
                        <strong>${this.escapeHtml(node.title)}</strong>
                        <small>${this.escapeHtml(node.nodeName || node.description)}</small>
                        ${node.resultObjectName ? `<em>${this.escapeHtml(node.resultKind)} · ${this.escapeHtml(node.resultOwner)}.${this.escapeHtml(node.resultObjectName)}</em>` : `<em>${this.t("noResult", "No result")}</em>`}
                    </span>
                    <span class="home-node-status">${this.escapeHtml(node.status || "-")}</span>
                </button>
            `;
        },

        async selectFlowNode(flowNodeRunId, nodes = null) {
            this.selectedNodeRunId = String(flowNodeRunId || "");
            const panel = document.getElementById("homeFlowDetailPanel");
            const visual = document.getElementById("homeNodeVisualPanel");
            const nodeRows = nodes || [];
            const node = nodeRows.find((item) => String(item.flowNodeRunId) === String(flowNodeRunId));
            panel?.querySelectorAll("[data-home-node-run-id]").forEach((button) => {
                button.classList.toggle("is-selected", String(button.dataset.homeNodeRunId) === String(flowNodeRunId));
            });
            if (!visual || !node) return;
            visual.innerHTML = `
                <div class="home-flow-detail-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>${this.tFormat("loadingNodeResult", "Loading {title} result.", { title: this.escapeHtml(node.title) })}</span>
                </div>
            `;
            if (node.status !== "SUCCESS") {
                visual.innerHTML = this.renderNodeMessageVisual(node);
                return;
            }
            if (!node.resultOwner || !node.resultObjectName || node.resultKind === "NONE") {
                visual.innerHTML = this.renderNodeMessageVisual(node);
                return;
            }
            try {
                if (node.resultKind === "MODEL") {
                    const params = new URLSearchParams({
                        owner: node.resultOwner,
                        modelName: node.resultObjectName,
                        limit: "120"
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/home/model-detail?${params.toString()}`, {
                        method: "GET",
                        showLoading: false
                    });
                    visual.innerHTML = this.renderModelVisual(node, json);
                } else {
                    const params = new URLSearchParams({
                        owner: node.resultOwner,
                        objectName: node.resultObjectName,
                        menuCode: node.menuCode || "",
                        limit: "80"
                    });
                    const json = await CommonUtils.request(`${API_BASE_URL}/home/result-sample?${params.toString()}`, {
                        method: "GET",
                        showLoading: false
                    });
                    visual.innerHTML = this.renderTableVisual(node, json);
                }
            } catch (error) {
                visual.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || this.t("visualLoadFailed", "Result visualization load failed."))}</div>`;
            }
        },

        renderNodeMessageVisual(node) {
            return `
                <section class="home-node-visual-empty">
                    <i class="fas ${this.escapeHtml(node.icon)}"></i>
                    <strong>${this.escapeHtml(node.title)}</strong>
                    <span>${this.escapeHtml(node.message || this.t("noDisplayResultObject", "No displayable result object."))}</span>
                </section>
            `;
        },

        renderModelVisual(node, json) {
            const views = Array.isArray(json.views) ? json.views : [];
            const vi = views.find((view) => view.viewType === "VI") || {};
            const vr = views.find((view) => view.viewType === "VR") || {};
            const vg = views.find((view) => view.viewType === "VG") || {};
            const va = views.find((view) => view.viewType === "VA") || {};
            const itemTags = this.extractItemsetTags(vi.data || []).slice(0, 28);
            const rules = this.extractRuleRows(vr.data || []).slice(0, 8);
            const itemDictionary = this.buildItemDictionary([...(vi.data || []), ...(va.data || [])]);
            const readableRules = this.buildReadableRuleCards(vr.data || [], itemDictionary).slice(0, 8);
            return `
                <section class="home-node-visual">
                    <header>
                        <div>
                            <span>${this.escapeHtml(node.title)}</span>
                            <strong>${this.escapeHtml(json.owner || node.resultOwner)}.${this.escapeHtml(json.modelName || node.resultObjectName)}</strong>
                        </div>
                        <em>Oracle ML Model View</em>
                    </header>
                    <div class="home-model-tabs">
                        <button type="button" class="is-active" onclick="home.switchModelVisualTab(this, 'readable')">Readable Rules</button>
                        <button type="button" onclick="home.switchModelVisualTab(this, 'raw')">Detail Views</button>
                    </div>
                    <div class="home-model-tab-panel is-active" data-model-tab="readable">
                        <div class="home-readable-rule-intro">
                            <strong>${this.t("readableRulesTitle", "Readable rule summary")}</strong>
                            <span>${this.t("readableRulesDesc", "XML itemsets and condition/result columns from DM$VR are interpreted as IF column = value THEN column = value. If the result value is not available in the model view, it is shown as value unavailable.")}</span>
                        </div>
                        <div class="home-readable-rule-grid">
                            ${readableRules.length ? readableRules.map((rule) => this.renderReadableRuleCard(rule)).join("") : `<div class="table-empty">${this.t("noRuleRows", "No rule rows to display.")}</div>`}
                        </div>
                    </div>
                    <div class="home-model-tab-panel" data-model-tab="raw">
                        <div class="home-model-visual-grid">
                            <div class="home-model-view-card is-vi">
                                ${this.renderModelViewHeader("VI", "Itemset/detail", vi)}
                                <div class="home-model-view-note">
                                    <strong>Extracted itemset values</strong>
                                    <span>${this.t("extractedItemsetDesc", "Values extracted from ITEM / ATTRIBUTE / VALUE / NAME columns in raw DM$VI rows. If only numbers appear, the model view is currently item-ID oriented.")}</span>
                                </div>
                                <div class="home-tag-cloud">
                                    ${itemTags.length ? itemTags.map((item) => `<span style="--tag-weight:${item.weight}">${this.escapeHtml(item.label)}</span>`).join("") : `<small>${this.t("noViItemsetRows", "No DM$VI itemset rows.")}</small>`}
                                </div>
                                ${this.renderSampleTable("DM$VI sample rows", vi.columns || [], vi.data || [], 5)}
                            </div>
                            <div class="home-model-view-card is-vr">
                                ${this.renderModelViewHeader("VR", "Top Rules", vr)}
                                ${rules.length ? `
                                    <div class="home-rule-list">
                                        ${rules.map((rule) => `
                                            <div class="home-rule-bar">
                                                <span title="${this.escapeHtml(rule.label)}">${this.escapeHtml(rule.label)}</span>
                                                <em><i style="width:${Math.max(4, rule.score)}%"></i></em>
                                                <small>
                                                    <b>${this.escapeHtml(rule.scoreName)}</b>
                                                    <strong>${this.escapeHtml(rule.scoreValue)}</strong>
                                                </small>
                                            </div>
                                        `).join("")}
                                    </div>
                                ` : `<small>${this.t("noVrRuleRows", "No DM$VR rule rows.")}</small>`}
                            </div>
                        </div>
                        <div class="home-model-view-card is-vg">
                            ${this.renderModelViewHeader("VG", "Global/detail", vg)}
                            ${this.renderSampleTable("", vg.columns || [], vg.data || [], 4)}
                        </div>
                        <div class="home-model-view-card is-va">
                            ${this.renderModelViewHeader("VA", "Attribute/detail rows", va)}
                            ${this.renderSampleTable("", va.columns || [], va.data || [], 6)}
                        </div>
                        <div class="home-model-view-card is-vr">
                            ${this.renderModelViewHeader("VR", "Rule/detail rows", vr)}
                            ${this.renderSampleTable("", vr.columns || [], vr.data || [], 6)}
                        </div>
                    </div>
                </section>
            `;
        },

        switchModelVisualTab(button, tabName) {
            const root = button?.closest?.(".home-node-visual");
            if (!root) return;
            root.querySelectorAll(".home-model-tabs button").forEach((item) => {
                item.classList.toggle("is-active", item === button);
            });
            root.querySelectorAll(".home-model-tab-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.modelTab === tabName);
            });
        },

        renderReadableRuleCard(rule) {
            const qualityClass = rule.mappingLevel === "mapped" ? "is-mapped" : "is-limited";
            return `
                <article class="home-readable-rule-card ${qualityClass}">
                    <header>
                        <span>${this.escapeHtml(rule.ruleId)}</span>
                        <em>${this.escapeHtml(rule.mappingLabel)}</em>
                    </header>
                    <div class="home-readable-rule-sentence">
                        <b>IF</b>
                        <strong>${this.escapeHtml(rule.ifText)}</strong>
                        <b>THEN</b>
                        <strong>${this.escapeHtml(rule.thenText)}</strong>
                    </div>
                    <p>${this.escapeHtml(rule.note)}</p>
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

        renderModelViewHeader(viewType, title, view = {}) {
            const viewName = view.viewName || `DM$${viewType}`;
            const description = view.description || "";
            const total = Number(view.total || 0);
            return `
                <div class="home-model-view-header">
                    <span class="home-model-view-type">${this.escapeHtml(viewType)}</span>
                    <div>
                        <strong>${this.escapeHtml(title)}</strong>
                        <small>${this.escapeHtml(description)}</small>
                        <code>${this.escapeHtml(viewName)}</code>
                    </div>
                    <em>${this.formatNumber(total)} rows</em>
                </div>
            `;
        },

        renderTableVisual(node, json) {
            const rows = Array.isArray(json.data) ? json.data : [];
            const columns = Array.isArray(json.columns) ? json.columns : [];
            const numericProfile = this.extractNumericProfile(rows, columns).slice(0, 8);
            const filterHint = node.menuCode === "M03002" && node.resultObjectName === "INIT$_TB_CAT_CORR_PAIR"
                ? "PASS_YN = 'Y' only"
                : `${this.formatNumber(rows.length)} sample rows`;
            return `
                <section class="home-node-visual">
                    <header>
                        <div>
                            <span>${this.escapeHtml(node.title)}</span>
                            <strong>${this.escapeHtml(node.resultOwner)}.${this.escapeHtml(node.resultObjectName)}</strong>
                        </div>
                        <em>${this.escapeHtml(filterHint)}</em>
                    </header>
                    <div class="home-table-profile-bars">
                        ${numericProfile.length ? numericProfile.map((item) => `
                            <div class="home-profile-bar">
                                <span>${this.escapeHtml(item.column)}</span>
                                <em style="width:${item.width}%"></em>
                                <small>${this.escapeHtml(item.label)}</small>
                            </div>
                        `).join("") : `<small>${this.t("noNumericProfile", "No numeric summary columns were found, so the sample table is shown.")}</small>`}
                    </div>
                    ${this.renderSampleTable("Result sample", columns, rows, 8)}
                </section>
            `;
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
                const unavailableLabel = this.t("valueUnavailable", "value unavailable");
                const thenText = consequentText && !this.ruleTextHasExplicitValue(consequentText) && !consequentText.includes(unavailableLabel)
                    ? `${consequentText} (${unavailableLabel})`
                    : consequentText;
                const support = this.findMetricValue(row, [/RULE_SUPPORT/i, /^SUPPORT$/i]);
                const confidence = this.findMetricValue(row, [/RULE_CONFIDENCE/i, /^CONFIDENCE$/i]);
                const lift = this.findMetricValue(row, [/RULE_LIFT/i, /^LIFT$/i]);
                const mapped = Boolean(antecedentText && consequentText);
                const missingConsequentValue = mapped && thenText !== consequentText;
                return {
                    ruleId: `Rule #${ruleId}`,
                    mappingLevel: mapped ? "mapped" : "limited",
                    mappingLabel: mapped ? this.t("ruleMapped", "Condition/result mapped") : this.t("ruleLimited", "ID/metric based"),
                    ifText: mapped ? antecedentText : this.t("ruleIfFallback", "Check condition item combinations directly in the view"),
                    thenText: mapped ? thenText : this.t("ruleThenFallback", "Check result items directly in the view"),
                    note: mapped && missingConsequentValue
                        ? this.t("ruleMissingResultValueNote", "Conditions were interpreted from XML itemsets as column = value. The result view currently provides only the column name, so the value is not visible.")
                        : (mapped
                            ? this.t("ruleMappedNote", "Readable text was built from XML itemsets and item dictionary candidates in the model detail views.")
                            : this.t("ruleLimitedNote", "The current DM$VR/DM$VI/DM$VA samples do not expose condition/result mappings that can be restored as column names and values. The detail views are item-ID and metric oriented.")),
                    metrics: [
                        { label: "support", value: support === null ? "-" : this.formatPercentMetric(support) },
                        { label: "confidence", value: confidence === null ? "-" : this.formatPercentMetric(confidence) },
                        { label: "lift", value: lift === null ? "-" : this.formatDecimal(lift) }
                    ]
                };
            });
        },

        findRuleValue(row, patterns = []) {
            const entries = Object.entries(row || {});
            const found = entries.find(([key, value]) => {
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

        readXmlTagValue(text, tagName) {
            const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
            const match = pattern.exec(String(text || ""));
            return match ? this.decodeXmlText(match[1]).trim() : "";
        },

        decodeXmlText(value) {
            return String(value ?? "")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&")
                .replace(/&quot;/g, "\"")
                .replace(/&apos;/g, "'")
                .replace(/&#39;/g, "'");
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
            if (field) return `${field} (${this.t("valueUnavailable", "value unavailable")})`;
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
            const locale = window.I18nManager?.getCurrentLanguage?.() === "ko" ? "ko-KR" : "en-US";
            return `${percent.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
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

        renderSampleTable(title, columns, rows, limit = 6) {
            const safeColumns = (columns || []).slice(0, 8);
            const safeRows = (rows || []).slice(0, limit);
            if (!safeColumns.length || !safeRows.length) return "";
            return `
                <div class="home-sample-table-wrap">
                    ${title ? `<strong>${this.escapeHtml(title)}</strong>` : ""}
                    <table class="table-grid home-sample-table">
                        <thead>
                            <tr>${safeColumns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr>
                        </thead>
                        <tbody>
                            ${safeRows.map((row) => `
                                <tr>${safeColumns.map((column) => `<td title="${this.escapeHtml(row?.[column] ?? "")}">${this.escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        },


        renderAlerts(errorMessage = "") {
            const alerts = this.getRecentAlerts();
            const container = document.getElementById("homeAlertList");
            if (!container) return;
            if (!this.dashboardData) {
                container.innerHTML = `
                    <article class="home-alert is-info">
                        <span><i class="fas fa-spinner"></i></span>
                        <div>
                            <strong>${this.t("noticeLoading", "Loading notices")}</strong>
                            <p>${this.t("noticeLoadingDesc", "Checking registered notices.")}</p>
                        </div>
                    </article>
                `;
                return;
            }
            if (errorMessage) {
                container.innerHTML = `
                    <article class="home-alert is-warn">
                        <span><i class="fas fa-triangle-exclamation"></i></span>
                        <div>
                            <strong>${this.t("dashboardDelayed", "Dashboard load delayed")}</strong>
                            <p>${this.escapeHtml(errorMessage)}</p>
                        </div>
                    </article>
                `;
                return;
            }
            if (!alerts.length) {
                container.innerHTML = `
                    <article class="home-alert is-empty">
                        <span><i class="fas fa-inbox"></i></span>
                        <div>
                            <strong>${this.t("noRecentNotices", "No recent notices")}</strong>
                            <p>${this.t("noNoticesInPeriod", "There are no notices for the current posting period.")}</p>
                        </div>
                    </article>
                `;
                return;
            }
            container.innerHTML = alerts.map((item) => `
                <article class="home-alert ${this.escapeHtml(item.tone || "is-info")}" data-home-notice-id="${this.escapeHtml(item.id)}" tabindex="0" role="button">
                    <span><i class="fas ${this.escapeHtml(item.icon || "fa-info-circle")}"></i></span>
                    <div>
                        <strong>${this.escapeHtml(item.title)}</strong>
                        <p>${this.escapeHtml(item.text)}</p>
                    </div>
                </article>
            `).join("");
        },

        getRecentAlerts() {
            const notices = Array.isArray(this.dashboardData?.notices) ? this.dashboardData.notices : [];
            return notices.slice(0, 4).map((notice) => ({
                id: notice.noticeId || notice.title || "",
                tone: notice.tone || "is-info",
                icon: notice.tone === "is-warn" ? "fa-triangle-exclamation" : "fa-circle-info",
                title: notice.title,
                text: notice.text,
                notice
            }));
        },

        renderLinks() {
            const links = [
                { page: "M03003", title: this.t("shortcutRuleDiscovery", "Rule Discovery"), icon: "fa-wand-magic-sparkles" },
                { page: "M03004", title: this.t("shortcutRuleViolation", "Rule Violation"), icon: "fa-shield-halved" },
                { page: "M04001", title: this.t("shortcutIntegratedEditing", "Integrated Editing Run"), icon: "fa-diagram-project" },
                { page: "M90001", title: this.t("shortcutInternalModel", "Internal Model Registry"), icon: "fa-sliders" }
            ];
            const container = document.getElementById("homeLinkBanner");
            if (!container) return;
            container.innerHTML = links.map((link) => `
                <button type="button" class="home-link-item" data-home-page="${this.escapeHtml(link.page)}">
                    <i class="fas ${this.escapeHtml(link.icon)}"></i>
                    <span>${this.escapeHtml(link.title)}</span>
                </button>
            `).join("");
        },

        async loadDashboard(options = {}) {
            const renderIdentity = options.renderIdentity !== false;
            const renderChart = options.renderChart !== false;
            const renderAlerts = options.renderAlerts !== false;
            const renderLinks = options.renderLinks !== false;
            const showPopups = options.showPopups !== false;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/home/dashboard`, {
                    method: "GET",
                    showLoading: false,
                    timeoutMs: 30000,
                    timeoutMessage: "Dashboard query timed out. Target DB may be busy with a batch job."
                });
                this.dashboardData = json || null;
                if (renderIdentity) this.renderIdentity();
                if (renderChart) {
                    this.renderWorkflowKpis();
                    this.renderRuleTrendChart();
                    this.renderFlowRunStrip();
                    this.renderFlowDetailPanel({ deferLoad: true });
                }
                if (renderAlerts) this.renderAlerts();
                if (renderLinks) this.renderLinks();
                this.bindEvents();
                if (showPopups) await this.showPopupNotices();
            } catch (error) {
                this.dashboardData = this.dashboardData || {
                    system: {},
                    target: {},
                    notices: [],
                    popupNotices: []
                };
                if (renderIdentity) this.renderIdentity();
                if (renderChart) {
                    this.renderWorkflowKpis();
                    this.renderRuleTrendChart();
                    this.renderFlowRunStrip();
                    this.renderFlowDetailPanel({ deferLoad: true });
                }
                if (renderAlerts) this.renderAlerts(error.message || "Dashboard data load failed.");
                if (renderLinks) this.renderLinks();
                this.bindEvents();
            }
        },

        async refreshWorkflowReadiness() {
            if (this.isRefreshingWorkflow) return;
            this.isRefreshingWorkflow = true;
            this.setRefreshButtonLoading("homeRefreshWorkflowButton", true);
            try {
                await this.loadDashboard({
                    renderAlerts: false,
                    renderLinks: false,
                    showPopups: false
                });
            } finally {
                this.isRefreshingWorkflow = false;
                this.setRefreshButtonLoading("homeRefreshWorkflowButton", false);
            }
        },

        async refreshQualitySignal() {
            if (this.isRefreshingQuality) return;
            this.isRefreshingQuality = true;
            this.setRefreshButtonLoading("homeRefreshQualityButton", true);
            try {
                await this.loadDashboard({
                    renderIdentity: false,
                    renderChart: false,
                    renderLinks: false,
                    showPopups: false
                });
            } finally {
                this.isRefreshingQuality = false;
                this.setRefreshButtonLoading("homeRefreshQualityButton", false);
            }
        },

        setRefreshButtonLoading(buttonId, isLoading) {
            const button = document.getElementById(buttonId);
            if (!button) return;
            button.disabled = Boolean(isLoading);
            button.classList.toggle("is-loading", Boolean(isLoading));
            button.querySelector("i")?.classList.toggle("fa-spin", Boolean(isLoading));
        },

        async showPopupNotices() {
            const notices = Array.isArray(this.dashboardData?.popupNotices) ? this.dashboardData.popupNotices : [];
            const notice = notices.find((item) => {
                const id = item.noticeId || item.title || "";
                return id && !sessionStorage.getItem(`homeNoticePopup:${id}`);
            });
            if (!notice) return;

            const id = notice.noticeId || notice.title || "";
            sessionStorage.setItem(`homeNoticePopup:${id}`, "Y");
            await CommonMessage.info(`${notice.title || "Notice"}\n${this.getNoticeDefaultMetaText(notice)}\n\n${notice.popupText || notice.text || ""}`, {
                title: this.t("notice", "Notice"),
                modal: true
            });
        },

        bindEvents() {
            document.querySelectorAll("#container-home [data-home-page]").forEach((button) => {
                button.addEventListener("click", () => this.openPage(button.dataset.homePage));
            });

            const flowButton = document.getElementById("homeOpenFlowButton");
            if (flowButton) {
                flowButton.onclick = () => this.openPage("M04001");
            }
            const workflowRefreshButton = document.getElementById("homeRefreshWorkflowButton");
            if (workflowRefreshButton) {
                workflowRefreshButton.onclick = () => this.refreshWorkflowReadiness();
            }
            const qualityRefreshButton = document.getElementById("homeRefreshQualityButton");
            if (qualityRefreshButton) {
                qualityRefreshButton.onclick = () => this.refreshQualitySignal();
            }
            const noticeListButton = document.getElementById("homeOpenNoticeListButton");
            if (noticeListButton) {
                noticeListButton.onclick = () => this.openNoticeLayer(null, { mode: "list" });
            }
            document.querySelectorAll("#container-home [data-home-notice-id]").forEach((item) => {
                item.onclick = () => this.openNoticeLayer(item.dataset.homeNoticeId, { mode: "detail" });
                item.onkeydown = (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        this.openNoticeLayer(item.dataset.homeNoticeId, { mode: "detail" });
                    }
                };
            });
        },

        openNoticeLayer(noticeId = null, options = {}) {
            const notices = Array.isArray(this.dashboardData?.notices) ? this.dashboardData.notices : [];
            if (!notices.length) {
                CommonMessage.info(this.t("noNoticesInPeriod", "There are no notices for the current posting period."), {
                    title: this.t("notice", "Notice")
                });
                return;
            }
            const fallbackId = notices[0]?.noticeId || notices[0]?.title || "";
            this.selectedNoticeId = String(noticeId || this.selectedNoticeId || fallbackId || "");
            this.noticeLayerMode = options.mode === "detail" ? "detail" : "list";
            this.renderNoticeBrowser();
            const layer = document.getElementById("homeNoticeLayer");
            if (layer) {
                layer.classList.toggle("is-detail-only", this.noticeLayerMode === "detail");
                layer.hidden = false;
                this.enableNoticeLayerDrag(layer);
            }
        },

        renderNoticeBrowser() {
            const notices = Array.isArray(this.dashboardData?.notices) ? this.dashboardData.notices : [];
            const list = document.getElementById("homeNoticeBrowserList");
            if (list) {
                list.innerHTML = notices.map((notice) => {
                    const id = String(notice.noticeId || notice.title || "");
                    const selected = id === String(this.selectedNoticeId || "");
                    const period = [notice.postStartAt, notice.postEndAt].filter(Boolean).join(" ~ ") || "Always";
                    return `
                        <button type="button" class="home-notice-browser-item ${selected ? "is-selected" : ""}" data-home-browser-notice-id="${this.escapeHtml(id)}">
                            <span class="home-notice-browser-type ${this.escapeHtml(notice.tone || "is-info")}">
                                <i class="fas ${this.escapeHtml(notice.tone === "is-warn" ? "fa-triangle-exclamation" : "fa-circle-info")}"></i>
                            </span>
                            <span>
                                <strong>${this.escapeHtml(notice.title || "Notice")}</strong>
                                <em>${this.escapeHtml(period)}</em>
                            </span>
                        </button>
                    `;
                }).join("");
                list.querySelectorAll("[data-home-browser-notice-id]").forEach((button) => {
                    button.onclick = () => {
                        this.selectedNoticeId = button.dataset.homeBrowserNoticeId || "";
                        this.renderNoticeBrowser();
                    };
                });
            }
            const notice = notices.find((item) => String(item.noticeId || item.title || "") === String(this.selectedNoticeId || "")) || notices[0];
            if (!notice) return;
            this.selectedNoticeId = String(notice.noticeId || notice.title || "");
            this.setText("homeNoticeTitle", this.noticeLayerMode === "detail" ? this.t("notice", "Notice") : this.t("notices", "Notices"));
            this.setText("homeNoticeDetailTitle", notice.title || this.t("notice", "Notice"));
            const meta = document.getElementById("homeNoticeMeta");
            if (meta) {
                meta.innerHTML = `
                    <span><strong>Type</strong> ${this.escapeHtml(notice.noticeType || "")}</span>
                    <span><strong>Writer</strong> ${this.escapeHtml(this.getNoticeWriterLabel(notice))}</span>
                    <span><strong>Created</strong> ${this.escapeHtml(this.getNoticeCreatedLabel(notice))}</span>
                    <span><strong>Period</strong> ${this.escapeHtml([notice.postStartAt, notice.postEndAt].filter(Boolean).join(" ~ ") || "-")}</span>
                    <span><strong>Popup</strong> ${this.escapeHtml(notice.popupYn || "N")}</span>
                `;
            }
            const body = document.getElementById("homeNoticeBody");
            if (body) body.innerHTML = this.sanitizeNoticeHtml(notice.fullText || notice.text || "");
            const attachments = document.getElementById("homeNoticeAttachments");
            if (attachments) {
                const files = Array.isArray(notice.attachments) ? notice.attachments : [];
                attachments.innerHTML = files.length ? `
                    <strong>Attachments</strong>
                    ${files.map((file) => `
                        <button type="button" class="home-notice-attachment" onclick="home.downloadNoticeFile('${this.escapeHtml(file.FILE_ID || "")}')">
                            <i class="fas fa-paperclip"></i>
                            <span title="${this.escapeHtml(file.FILE_NAME || "")}">${this.escapeHtml(file.FILE_NAME || "attachment")}</span>
                            <small>${this.escapeHtml(this.formatFileSize(file.FILE_SIZE))}</small>
                        </button>
                    `).join("")}
                ` : "";
            }
        },

        closeNoticeLayer() {
            const layer = document.getElementById("homeNoticeLayer");
            if (layer) layer.hidden = true;
        },

        getNoticeWriterLabel(notice) {
            return String(
                notice?.createdByDisplay
                || notice?.createdByName
                || notice?.createdByLoginId
                || notice?.createdBy
                || "-"
            ).trim() || "-";
        },

        getNoticeCreatedLabel(notice) {
            return this.formatDateTime(notice?.createdAt);
        },

        getNoticeDefaultMetaText(notice) {
            return this.tFormat("noticeDefaultMeta", "Writer {writer}\nCreated {created}", {
                writer: this.getNoticeWriterLabel(notice),
                created: this.getNoticeCreatedLabel(notice)
            });
        },

        enableNoticeLayerDrag(layer) {
            const dialog = layer?.querySelector(".data-help-dialog");
            const header = dialog?.querySelector("header");
            if (!dialog || !header || dialog.dataset.dragBound === "Y") return;
            dialog.dataset.dragBound = "Y";
            header.classList.add("is-draggable");
            header.addEventListener("pointerdown", (event) => {
                if (event.target.closest("button")) return;
                event.preventDefault();
                const rect = dialog.getBoundingClientRect();
                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = rect.left;
                const startTop = rect.top;
                dialog.style.position = "fixed";
                dialog.style.margin = "0";
                dialog.style.left = `${startLeft}px`;
                dialog.style.top = `${startTop}px`;
                header.setPointerCapture?.(event.pointerId);
                const move = (moveEvent) => {
                    const nextLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, startLeft + moveEvent.clientX - startX));
                    const nextTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, startTop + moveEvent.clientY - startY));
                    dialog.style.left = `${nextLeft}px`;
                    dialog.style.top = `${nextTop}px`;
                };
                const up = () => {
                    header.removeEventListener("pointermove", move);
                    header.removeEventListener("pointerup", up);
                    header.removeEventListener("pointercancel", up);
                };
                header.addEventListener("pointermove", move);
                header.addEventListener("pointerup", up);
                header.addEventListener("pointercancel", up);
            });
        },

        openPage(pageCode) {
            if (!pageCode) return;
            const menu = window.MENU_PAGE_MAP?.[pageCode];
            PageManager.load(pageCode, menu?.title || menu?.label || pageCode);
        },

        buildRequestHeaders() {
            const headers = {};
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId) headers["X-Target-Connection-Id"] = targetConnectionId;
            const bootstrapToken = sessionStorage.getItem("initBootstrapToken") || "";
            if (bootstrapToken) headers["X-Bootstrap-Token"] = bootstrapToken;
            return headers;
        },

        async downloadNoticeFile(fileId) {
            if (!fileId) return;
            try {
                const response = await fetch(`${API_BASE_URL}/home/notice-files/${encodeURIComponent(fileId)}/download`, {
                    method: "GET",
                    headers: this.buildRequestHeaders(),
                    credentials: "include"
                });
                if (!response.ok) {
                    const errorJson = await response.json().catch(() => ({}));
                    throw new Error(CommonUtils.formatErrorMessage(errorJson));
                }
                window.PageManager?.extendSessionFromResponse?.(response);
                const blob = await response.blob();
                const fileName = this.getDownloadFileName(response.headers.get("Content-Disposition")) || "attachment";
                if (window.DataEditingSystem?.downloadBlob) {
                    window.DataEditingSystem.downloadBlob(blob, fileName);
                } else {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }
                window.PageManager?.extendSession?.();
            } catch (error) {
                await CommonMessage.error(error.message || "Attachment download failed.");
            }
        },

        setText(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = value || "";
        },

        formatNumber(value) {
            const number = Number(value || 0);
            return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
        },

        formatFileSize(value) {
            const size = Number(value || 0);
            if (!Number.isFinite(size) || size <= 0) return "0 B";
            const units = ["B", "KB", "MB", "GB"];
            let next = size;
            let unitIndex = 0;
            while (next >= 1024 && unitIndex < units.length - 1) {
                next /= 1024;
                unitIndex += 1;
            }
            const digits = unitIndex === 0 ? 0 : (next >= 10 ? 1 : 2);
            return `${next.toFixed(digits)} ${units[unitIndex]}`;
        },

        getDownloadFileName(disposition) {
            const header = String(disposition || "");
            const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
            if (encoded) {
                try {
                    return decodeURIComponent(encoded[1].trim());
                } catch (error) {
                    return encoded[1].trim();
                }
            }
            const quoted = header.match(/filename="([^"]+)"/i);
            if (quoted) return quoted[1].trim();
            return "";
        },

        formatDecimal(value) {
            const number = Number(value || 0);
            if (!Number.isFinite(number)) return "0";
            return number.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
        },

        formatDateTime(value) {
            const date = this.parseDateTime(value);
            if (!date) return String(value || "").trim() || "-";
            const parts = new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            }).formatToParts(date).reduce((acc, part) => {
                acc[part.type] = part.value;
                return acc;
            }, {});
            return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
        },

        parseDateTime(value) {
            if (!value) return null;
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
            const text = String(value).trim();
            const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/);
            if (match) {
                const [, year, month, day, hour, minute, second, fraction] = match;
                if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
                    const parsedWithZone = new Date(text);
                    return Number.isNaN(parsedWithZone.getTime()) ? null : parsedWithZone;
                }
                return new Date(Date.UTC(
                    Number(year),
                    Number(month) - 1,
                    Number(day),
                    Number(hour),
                    Number(minute),
                    Number(second),
                    Number(String(fraction || "0").padEnd(3, "0").slice(0, 3))
                ));
            }
            const parsed = new Date(text);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        },

        formatElapsedTime(startedAt, finishedAt, status = "") {
            if (!startedAt) return "-";
            const start = this.parseDateTime(startedAt);
            const end = finishedAt ? this.parseDateTime(finishedAt) : (String(status || "").toUpperCase() === "RUNNING" ? new Date() : null);
            if (!end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
            const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
            if (seconds < 60) return `${seconds}s`;
            const minutes = Math.floor(seconds / 60);
            const remain = seconds % 60;
            if (minutes < 60) return `${minutes}m ${remain}s`;
            const hours = Math.floor(minutes / 60);
            return `${hours}h ${minutes % 60}m`;
        },

        getHomeScrollSnapshot() {
            const mainScroller = document.getElementById("pageContainerHolder");
            const scrollers = [mainScroller, document.scrollingElement]
                .filter(Boolean)
                .filter((item, index, array) => array.indexOf(item) === index);
            return scrollers.map((element) => ({
                element,
                left: element.scrollLeft,
                top: element.scrollTop
            }));
        },

        restoreHomeScroll(snapshot = []) {
            const restore = () => {
                snapshot.forEach((item) => {
                    if (!item.element) return;
                    item.element.scrollLeft = item.left;
                    item.element.scrollTop = item.top;
                });
            };
            restore();
            requestAnimationFrame(restore);
            setTimeout(restore, 80);
        },

        async preserveHomeScroll(callback) {
            const snapshot = this.getHomeScrollSnapshot();
            try {
                return await callback();
            } finally {
                this.restoreHomeScroll(snapshot);
            }
        },

        getStatusClass(status) {
            const text = String(status || "").toUpperCase();
            if (text === "SUCCESS") return "is-success";
            if (["FAILED", "SKIPPED", "ERROR"].includes(text)) return "is-failed";
            if (["RUNNING", "STARTED"].includes(text)) return "is-running";
            return "is-neutral";
        },

        parseJson(value, fallback = {}) {
            if (!value) return fallback;
            if (typeof value === "object") return value;
            try {
                return JSON.parse(String(value));
            } catch (error) {
                return fallback;
            }
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },

        sanitizeNoticeHtml(value) {
            const template = document.createElement("template");
            template.innerHTML = String(value || "");
            const allowedTags = new Set(["A", "B", "BR", "DIV", "EM", "H3", "I", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL"]);
            const allowedAttrs = {
                A: new Set(["href", "target", "rel"]),
                SPAN: new Set(["style"]),
                P: new Set(["style"]),
                DIV: new Set(["style"])
            };
            const sanitizeNode = (node) => {
                [...node.childNodes].forEach((child) => {
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(child.tagName)) {
                            child.remove();
                            return;
                        }
                        if (!allowedTags.has(child.tagName)) {
                            child.replaceWith(...child.childNodes);
                            return;
                        }
                        [...child.attributes].forEach((attr) => {
                            const allowed = allowedAttrs[child.tagName]?.has(attr.name);
                            if (!allowed) child.removeAttribute(attr.name);
                        });
                        if (child.tagName === "A") {
                            const href = child.getAttribute("href") || "";
                            if (!/^https?:\/\//i.test(href) && !href.startsWith("/")) {
                                child.removeAttribute("href");
                            } else {
                                child.setAttribute("target", "_blank");
                                child.setAttribute("rel", "noopener noreferrer");
                            }
                        }
                        if (child.hasAttribute("style")) {
                            child.setAttribute("style", this.sanitizeInlineStyle(child.getAttribute("style")));
                            if (!child.getAttribute("style")) child.removeAttribute("style");
                        }
                        sanitizeNode(child);
                    } else if (child.nodeType !== Node.TEXT_NODE) {
                        child.remove();
                    }
                });
            };
            sanitizeNode(template.content);
            return template.innerHTML.trim();
        },

        sanitizeInlineStyle(value) {
            return String(value || "")
                .split(";")
                .map((part) => part.trim())
                .filter((part) => /^(color|background-color|font-size|text-align)\s*:/i.test(part))
                .join("; ");
        },

        destroy() {
            if (this.ruleTrendChart) {
                this.ruleTrendChart.destroy();
                this.ruleTrendChart = null;
            }
            if (this.workflowResultChart) {
                this.workflowResultChart.destroy();
                this.workflowResultChart = null;
            }
            if (this.workflowJobChart) {
                this.workflowJobChart.destroy();
                this.workflowJobChart = null;
            }
        }
    };

    window[PAGE_CODE] = home;
})();
