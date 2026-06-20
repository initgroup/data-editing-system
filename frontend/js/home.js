(function() {
    const PAGE_CODE = "home";

    const home = {
        qualityChart: null,
        trendChart: null,
        dashboardData: null,

        init() {
            this.renderIdentity();
            this.renderKpis();
            this.renderStages();
            this.renderActions();
            this.renderNotices();
            this.renderCharts();
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

        renderIdentity() {
            const user = this.getLoginUser();
            const displayName = user.userName || user.USER_NAME || user.loginId || user.LOGIN_ID || "User";
            const role = user.roleCode || user.ROLE_CODE || "USER";
            const connection = this.dashboardData?.system?.connection;
            const targetName = connection?.connectionName || this.getTargetName();

            this.setText("homeGreeting", `${displayName}, ready for data editing`);
            this.setText("homeContextSummary", targetName
                ? `Active target database: ${targetName}. Dashboard values are read live from existing metadata tables.`
                : "No target database is selected. Select a target DB before running data work or flow execution.");
            this.setText("homeUserName", displayName);
            this.setText("homeUserRole", String(role).toUpperCase());
            this.setText("homeTargetDb", targetName || "Not selected");
        },

        renderKpis() {
            const targetSelected = Boolean(sessionStorage.getItem("targetConnectionId"));
            const kpis = this.dashboardData?.kpis || [
                {
                    label: "Target Readiness",
                    value: targetSelected ? "Ready" : "Required",
                    trend: targetSelected ? "Connection context is active" : "Select DB from the header",
                    icon: "fa-database",
                    tone: targetSelected ? "is-good" : "is-warn"
                },
                {
                    label: "Open Workspace",
                    value: String(Math.max(0, Object.keys(PageManager.containers || {}).length - 1)),
                    trend: "Loaded work pages",
                    icon: "fa-window-restore",
                    tone: "is-info"
                },
                {
                    label: "Flow Stage",
                    value: "4-step",
                    trend: "Prep, discover, edit, apply",
                    icon: "fa-diagram-project",
                    tone: "is-primary"
                },
                {
                    label: "Session",
                    value: document.getElementById("sessionRemainTime")?.textContent || "--:--",
                    trend: "Remaining active time",
                    icon: "fa-clock",
                    tone: "is-neutral"
                }
            ];

            const container = document.getElementById("homeKpiGrid");
            if (!container) return;
            container.innerHTML = kpis.map((item) => `
                <article class="home-kpi ${item.tone}">
                    <div class="home-kpi-icon"><i class="fas ${item.icon}"></i></div>
                    <div>
                        <span>${this.escapeHtml(item.label)}</span>
                        <strong>${this.escapeHtml(item.value)}</strong>
                        <small>${this.escapeHtml(item.trend)}</small>
                    </div>
                </article>
            `).join("");
        },

        renderStages() {
            const stages = this.dashboardData?.stages || [
                { code: "M02002", name: "Target Data", state: "Prepared", icon: "fa-table" },
                { code: "M03003", name: "Rule Discovery", state: "Candidate", icon: "fa-wand-magic-sparkles" },
                { code: "M04001", name: "Integrated Flow", state: "Design", icon: "fa-diagram-project" },
                { code: "M07002", name: "Final Apply", state: "Controlled", icon: "fa-circle-check" }
            ];

            const container = document.getElementById("homeStageTrack");
            if (!container) return;
            container.innerHTML = stages.map((stage, index) => {
                const isEnabled = this.hasRegisteredPage(stage.code);
                return `
                <button type="button" class="home-stage${isEnabled ? "" : " is-disabled"}" ${isEnabled ? `data-home-page="${stage.code}"` : "disabled"} title="${this.escapeHtml(stage.name)}">
                    <span class="home-stage-number">${index + 1}</span>
                    <span class="home-stage-icon"><i class="fas ${stage.icon}"></i></span>
                    <strong>${this.escapeHtml(stage.name)}</strong>
                    <small>${this.escapeHtml(stage.state)} / ${stage.code}</small>
                </button>
            `;
            }).join("");
        },

        renderActions() {
            const counts = this.dashboardData?.target?.counts || {};
            const actions = [
                { page: "M02001", title: "Load Files", desc: `${counts.projects ?? 0} projects available`, icon: "fa-file-arrow-up" },
                { page: "M03001", title: "Profile Data", desc: `${counts.predictedColumns ?? 0} predicted columns`, icon: "fa-chart-column" },
                { page: "M04001", title: "Design Flow", desc: `${counts.flows ?? 0} saved flows`, icon: "fa-diagram-project" },
                { page: "M91001", title: "DB Connections", desc: `${this.dashboardData?.system?.connectionCount ?? 0} registered connections`, icon: "fa-plug" }
            ];

            const container = document.getElementById("homeQuickActions");
            if (!container) return;
            container.innerHTML = actions.map((action) => `
                <button type="button" class="home-action" data-home-page="${action.page}">
                    <span><i class="fas ${action.icon}"></i></span>
                    <strong>${this.escapeHtml(action.title)}</strong>
                    <small>${this.escapeHtml(action.desc)}</small>
                </button>
            `).join("");
        },

        renderNotices() {
            const targetSelected = Boolean(sessionStorage.getItem("targetConnectionId"));
            const user = this.getLoginUser();
            const notices = this.dashboardData?.notices || [
                {
                    tone: targetSelected ? "is-good" : "is-warn",
                    title: targetSelected ? "Target DB is selected" : "Target DB is required",
                    text: targetSelected ? `${this.getTargetName()} is active for API requests.` : "Open the Target DB selector in the header before running jobs."
                },
                {
                    tone: "is-info",
                    title: "Signed-in context",
                    text: `${user.loginId || user.LOGIN_ID || "current user"} / ${(user.roleCode || user.ROLE_CODE || "USER").toString().toUpperCase()}`
                },
                {
                    tone: "is-neutral",
                    title: "Menu workspace",
                    text: "Use the left menu or quick actions to move between preparation, discovery, flow, and apply stages."
                }
            ];

            const container = document.getElementById("homeNoticeList");
            if (!container) return;
            container.innerHTML = notices.map((notice) => `
                <div class="home-notice ${notice.tone}">
                    <span></span>
                    <div>
                        <strong>${this.escapeHtml(notice.title)}</strong>
                        <p>${this.escapeHtml(notice.text)}</p>
                    </div>
                </div>
            `).join("");
        },

        renderCharts() {
            this.renderQualityChart();
            this.renderTrendChart();
        },

        renderQualityChart() {
            const canvas = document.getElementById("homeQualityChart");
            if (!canvas || !window.Chart) return;
            if (this.qualityChart) this.qualityChart.destroy();
            const quality = this.dashboardData?.quality || [
                { label: "Prepared", value: 0 },
                { label: "Review", value: 0 },
                { label: "Pending", value: 0 }
            ];

            this.qualityChart = new Chart(canvas, {
                type: "doughnut",
                data: {
                    labels: quality.map((item) => item.label),
                    datasets: [{
                        data: quality.map((item) => Number(item.value || 0)),
                        backgroundColor: ["#2563eb", "#f59e0b", "#94a3b8"],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "68%",
                    plugins: {
                        legend: {
                            position: "bottom",
                            labels: { boxWidth: 10, usePointStyle: true }
                        }
                    }
                }
            });
        },

        renderTrendChart() {
            const canvas = document.getElementById("homeTrendChart");
            if (!canvas || !window.Chart) return;
            if (this.trendChart) this.trendChart.destroy();
            const trend = this.normalizeTrend(this.dashboardData?.trend || []);

            this.trendChart = new Chart(canvas, {
                type: "line",
                data: {
                    labels: trend.labels,
                    datasets: [
                        {
                            label: "Runs",
                            data: trend.values,
                            borderColor: "#2563eb",
                            backgroundColor: "rgba(37, 99, 235, 0.10)",
                            fill: true,
                            tension: 0.35
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: "bottom",
                            labels: { boxWidth: 10, usePointStyle: true }
                        }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: { beginAtZero: true, ticks: { precision: 0 } }
                    }
                }
            });
        },

        async loadDashboard() {
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/home/dashboard`, {
                    method: "GET",
                    showLoading: false
                });
                this.dashboardData = json || null;
                this.renderIdentity();
                this.renderKpis();
                this.renderStages();
                this.renderActions();
                this.renderNotices();
                this.renderCharts();
                this.bindEvents();
            } catch (error) {
                CommonUI.showPageError(PAGE_CODE, error.message || "Dashboard data load failed.");
            }
        },

        normalizeTrend(rows) {
            if (!Array.isArray(rows) || rows.length === 0) {
                return {
                    labels: ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "Today"],
                    values: [0, 0, 0, 0, 0, 0, 0]
                };
            }
            return {
                labels: rows.map((row) => row.label || row.RUN_DATE || ""),
                values: rows.map((row) => Number(row.count ?? row.CNT ?? 0))
            };
        },

        bindEvents() {
            document.querySelectorAll("#container-home [data-home-page]").forEach((button) => {
                button.addEventListener("click", () => this.openPage(button.dataset.homePage));
            });

            const flowButton = document.getElementById("homeOpenFlowButton");
            if (flowButton) {
                flowButton.addEventListener("click", () => this.openPage("M04001"));
            }
        },

        openPage(pageCode) {
            if (!pageCode) return;
            const menu = window.MENU_PAGE_MAP?.[pageCode];
            PageManager.load(pageCode, menu?.title || menu?.label || pageCode);
        },

        hasRegisteredPage(pageCode) {
            return Boolean(pageCode)
                && PageManager.hasRegisteredPageFile?.(pageCode, "html")
                && PageManager.hasRegisteredPageFile?.(pageCode, "script");
        },

        setText(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = value || "";
        },

        escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },

        destroy() {
            if (this.qualityChart) {
                this.qualityChart.destroy();
                this.qualityChart = null;
            }
            if (this.trendChart) {
                this.trendChart.destroy();
                this.trendChart = null;
            }
        }
    };

    window[PAGE_CODE] = home;
})();
