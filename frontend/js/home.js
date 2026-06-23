(function() {
    const PAGE_CODE = "home";

    const home = {
        ruleTrendChart: null,
        dashboardData: null,
        isRefreshingWorkflow: false,
        isRefreshingQuality: false,
        selectedNoticeId: null,

        init() {
            this.renderIdentity();
            this.renderRuleTrendChart();
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
            const trend = this.normalizeRuleTrend(this.dashboardData?.target?.ruleTrend || this.dashboardData?.ruleTrend || []);

            this.ruleTrendChart = new Chart(canvas, {
                type: "line",
                data: {
                    labels: trend.labels,
                    datasets: [
                        {
                            label: "자동규칙발굴 성공",
                            data: trend.discoverySuccess,
                            borderColor: "#2563eb",
                            backgroundColor: "rgba(37, 99, 235, 0.12)",
                            fill: true,
                            tension: 0.35
                        },
                        {
                            label: "자동규칙발굴 실패",
                            data: trend.discoveryFailed,
                            borderColor: "#1d4ed8",
                            backgroundColor: "rgba(37, 99, 235, 0.04)",
                            borderDash: [6, 5],
                            fill: false,
                            tension: 0.35
                        },
                        {
                            label: "규칙위반탐지 성공",
                            data: trend.violationSuccess,
                            borderColor: "#dc2626",
                            backgroundColor: "rgba(220, 38, 38, 0.10)",
                            fill: true,
                            tension: 0.35
                        },
                        {
                            label: "규칙위반탐지 실패",
                            data: trend.violationFailed,
                            borderColor: "#b91c1c",
                            backgroundColor: "rgba(220, 38, 38, 0.04)",
                            borderDash: [6, 5],
                            fill: false,
                            tension: 0.35
                        },
                        {
                            label: "통합시나리오실행 성공",
                            data: trend.flowSuccess,
                            borderColor: "#16a34a",
                            backgroundColor: "rgba(22, 163, 74, 0.10)",
                            fill: true,
                            tension: 0.35
                        },
                        {
                            label: "통합시나리오실행 실패",
                            data: trend.flowFailed,
                            borderColor: "#15803d",
                            backgroundColor: "rgba(22, 163, 74, 0.04)",
                            borderDash: [6, 5],
                            fill: false,
                            tension: 0.35
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

        normalizeRuleTrend(rows) {
            const fallbackLabels = ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "Today"];
            if (!Array.isArray(rows) || rows.length === 0) {
                return {
                    labels: fallbackLabels,
                    discoverySuccess: [0, 0, 0, 0, 0, 0, 0],
                    discoveryFailed: [0, 0, 0, 0, 0, 0, 0],
                    violationSuccess: [0, 0, 0, 0, 0, 0, 0],
                    violationFailed: [0, 0, 0, 0, 0, 0, 0],
                    flowSuccess: [0, 0, 0, 0, 0, 0, 0],
                    flowFailed: [0, 0, 0, 0, 0, 0, 0]
                };
            }
            const labels = [];
            const byLabel = {};
            rows.forEach((row) => {
                const label = row.label || row.RUN_DATE || "";
                const menuCode = row.menuCode || row.MENU_CODE || "";
                const statusGroup = String(row.statusGroup || row.STATUS_GROUP || "SUCCESS").toUpperCase();
                const count = Number(row.count ?? row.CNT ?? 0);
                if (!label) return;
                if (!byLabel[label]) {
                    labels.push(label);
                    byLabel[label] = {
                        discoverySuccess: 0,
                        discoveryFailed: 0,
                        violationSuccess: 0,
                        violationFailed: 0,
                        flowSuccess: 0,
                        flowFailed: 0
                    };
                }
                const suffix = statusGroup === "FAILED" ? "Failed" : "Success";
                if (menuCode === "M04001") byLabel[label][`flow${suffix}`] += count;
                else if (menuCode === "M03004") byLabel[label][`violation${suffix}`] += count;
                else byLabel[label][`discovery${suffix}`] += count;
            });
            return {
                labels,
                discoverySuccess: labels.map((label) => byLabel[label].discoverySuccess),
                discoveryFailed: labels.map((label) => byLabel[label].discoveryFailed),
                violationSuccess: labels.map((label) => byLabel[label].violationSuccess),
                violationFailed: labels.map((label) => byLabel[label].violationFailed),
                flowSuccess: labels.map((label) => byLabel[label].flowSuccess),
                flowFailed: labels.map((label) => byLabel[label].flowFailed)
            };
        },

        renderAlerts() {
            const alerts = this.getRecentAlerts();
            const container = document.getElementById("homeAlertList");
            if (!container) return;
            if (!this.dashboardData) {
                container.innerHTML = `
                    <article class="home-alert is-info">
                        <span><i class="fas fa-spinner"></i></span>
                        <div>
                            <strong>공지사항 조회 중</strong>
                            <p>등록된 공지사항을 확인하고 있습니다.</p>
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
                            <strong>최근 공지사항 없음</strong>
                            <p>현재 게시 기간에 해당하는 공지사항이 없습니다.</p>
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
                { page: "M03003", title: "자동규칙발굴", icon: "fa-wand-magic-sparkles" },
                { page: "M03004", title: "규칙위반탐지", icon: "fa-shield-halved" },
                { page: "M04001", title: "통합에디팅실행", icon: "fa-diagram-project" },
                { page: "M90001", title: "내부모델등록", icon: "fa-sliders" }
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
                    showLoading: false
                });
                this.dashboardData = json || null;
                if (renderIdentity) this.renderIdentity();
                if (renderChart) this.renderRuleTrendChart();
                if (renderAlerts) this.renderAlerts();
                if (renderLinks) this.renderLinks();
                this.bindEvents();
                if (showPopups) await this.showPopupNotices();
            } catch (error) {
                CommonUI.showPageError(PAGE_CODE, error.message || "Dashboard data load failed.");
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
            await CommonMessage.info(`${notice.title || "Notice"}\n\n${notice.text || ""}`, {
                title: "공지사항",
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
                noticeListButton.onclick = () => this.openNoticeLayer();
            }
            document.querySelectorAll("#container-home [data-home-notice-id]").forEach((item) => {
                item.onclick = () => this.openNoticeLayer(item.dataset.homeNoticeId);
                item.onkeydown = (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        this.openNoticeLayer(item.dataset.homeNoticeId);
                    }
                };
            });
        },

        openNoticeLayer(noticeId = null) {
            const notices = Array.isArray(this.dashboardData?.notices) ? this.dashboardData.notices : [];
            if (!notices.length) {
                CommonMessage.info("현재 게시 기간에 해당하는 공지사항이 없습니다.", {
                    title: "공지사항"
                });
                return;
            }
            const fallbackId = notices[0]?.noticeId || notices[0]?.title || "";
            this.selectedNoticeId = String(noticeId || this.selectedNoticeId || fallbackId || "");
            this.renderNoticeBrowser();
            const layer = document.getElementById("homeNoticeLayer");
            if (layer) layer.hidden = false;
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
            this.setText("homeNoticeTitle", "Notices");
            this.setText("homeNoticeDetailTitle", notice.title || "Notice");
            const meta = document.getElementById("homeNoticeMeta");
            if (meta) {
                meta.innerHTML = `
                    <span><strong>Type</strong> ${this.escapeHtml(notice.noticeType || "")}</span>
                    <span><strong>Period</strong> ${this.escapeHtml([notice.postStartAt, notice.postEndAt].filter(Boolean).join(" ~ ") || "-")}</span>
                    <span><strong>Popup</strong> ${this.escapeHtml(notice.popupYn || "N")}</span>
                `;
            }
            const body = document.getElementById("homeNoticeBody");
            if (body) body.innerHTML = this.sanitizeNoticeHtml(notice.fullText || notice.text || "");
        },

        closeNoticeLayer() {
            const layer = document.getElementById("homeNoticeLayer");
            if (layer) layer.hidden = true;
        },

        openPage(pageCode) {
            if (!pageCode) return;
            const menu = window.MENU_PAGE_MAP?.[pageCode];
            PageManager.load(pageCode, menu?.title || menu?.label || pageCode);
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
        }
    };

    window[PAGE_CODE] = home;
})();
