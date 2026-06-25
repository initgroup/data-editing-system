(function() {
    const PAGE_CODE = "M04002";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const M04002 = {
        runs: [],
        nodes: [],
        selectedRun: null,
        selectedNode: null,
        runPage: 1,
        runTotal: 0,
        resultPage: 1,
        resultPageSize: 50,
        excludeEmptyConsequent: false,
        currentExport: { filename: "integrated-result.csv", columns: [], rows: [] },

        async init() {
            await this.loadRuns(1);
        },

        destroy() {
            this.runs = [];
            this.nodes = [];
            this.selectedRun = null;
            this.selectedNode = null;
            this.currentExport = { filename: "integrated-result.csv", columns: [], rows: [] };
        },

        async loadRuns(page = this.runPage) {
            this.runPage = Math.max(1, Number(page || 1));
            const pageSize = Number(getContainerEl("#pageSize-M04002")?.value || 20);
            const params = new URLSearchParams({
                page: String(this.runPage),
                pageSize: String(pageSize),
                status: getContainerEl("#status-M04002")?.value || "ALL",
                keyword: getContainerEl("#keyword-M04002")?.value?.trim?.() || ""
            });
            const list = getContainerEl("#runList-M04002");
            if (list) list.innerHTML = `<div class="table-empty">Loading runs...</div>`;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/runs?${params.toString()}`, { method: "GET", showLoading: false });
                this.runs = Array.isArray(json.data) ? json.data : [];
                this.runTotal = Number(json.total || 0);
                this.renderRuns();
                if (this.runs.length) await this.selectRun(this.runs[0].FLOW_RUN_ID);
            } catch (error) {
                if (list) list.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Run load failed.")}</div>`;
            }
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
            if (!el || !run) return;
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
                    </span>
                    <b class="${this.getStatusClass(node.STATUS)}">${this.escapeHtml(node.STATUS || "-")}</b>
                </button>
            `).join("");
        },

        async selectNode(nodeRunId, page = 1) {
            this.selectedNode = this.nodes.find((node) => Number(node.FLOW_NODE_RUN_ID) === Number(nodeRunId)) || null;
            this.resultPage = Math.max(1, Number(page || 1));
            this.renderNodes();
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel || !this.selectedNode) return;
            if (this.selectedNode.RESULT_KIND === "NONE") {
                panel.innerHTML = `<div class="table-empty">이 노드는 저장된 결과 테이블/모델이 없습니다.</div>`;
                return;
            }
            panel.innerHTML = `<div class="table-empty">Loading result...</div>`;
            if (this.selectedNode.RESULT_KIND === "MODEL") {
                await this.loadModelView("VR", this.resultPage);
            } else {
                await this.loadResultTable(this.resultPage);
            }
        },

        async loadResultTable(page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                objectName: node.RESULT_OBJECT_NAME,
                menuCode: node.REF_MENU_CODE || "",
                page: String(page),
                pageSize: String(this.resultPageSize)
            });
            const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/result-table?${params.toString()}`, { method: "GET", showLoading: false });
            this.currentExport = { filename: `${node.RESULT_OBJECT_NAME || "result"}.csv`, columns: json.columns || [], rows: json.data || [] };
            this.renderResultTable(json, "Result Table", "TABLE");
        },

        async loadModelView(viewType = "VR", page = 1) {
            const node = this.selectedNode;
            if (!node) return;
            const params = new URLSearchParams({
                owner: node.RESULT_OWNER,
                modelName: node.RESULT_OBJECT_NAME,
                viewType,
                page: String(page),
                pageSize: String(this.resultPageSize)
            });
            const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/model-view?${params.toString()}`, { method: "GET", showLoading: false });
            this.currentExport = { filename: `${json.viewName || node.RESULT_OBJECT_NAME || "model-view"}.csv`, columns: json.columns || [], rows: json.data || [] };
            this.renderModelView(json);
        },

        renderModelView(json) {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel) return;
            const viewType = json.viewType || "VR";
            const readable = viewType === "VR" ? this.renderReadableRules(json.data || []) : "";
            panel.innerHTML = `
                <header class="m04002-result-header">
                    <div>
                        <span>Oracle ML Model View</span>
                        <strong>${this.escapeHtml(json.owner)}.${this.escapeHtml(json.modelName)}</strong>
                        <small>${this.escapeHtml(json.viewName || "")} · ${this.formatNumber(json.total)} rows</small>
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

        renderResultTable(json, title, type) {
            const panel = getContainerEl("#resultPanel-M04002");
            if (!panel) return;
            panel.innerHTML = `
                <header class="m04002-result-header">
                    <div>
                        <span>${this.escapeHtml(type)}</span>
                        <strong>${this.escapeHtml(json.owner)}.${this.escapeHtml(json.objectName)}</strong>
                        <small>${this.formatNumber(json.total)} rows</small>
                    </div>
                </header>
                ${this.renderGrid(json.columns || [], json.data || [])}
                ${this.renderResultPager(json.page, json.pageSize, json.total, "M04002.loadResultTable(")}
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
            const viewButton = getContainerEl("#resultPanel-M04002 .m04002-result-header nav button.is-active");
            const viewType = viewButton?.textContent?.trim?.() || "VR";
            this.loadModelView(viewType, 1);
        },

        isEmptyRuleText(value) {
            const text = String(value || "").trim();
            return !text || text === "결과 정보 없음" || /값 정보 없음/.test(text);
        },

        renderGrid(columns, rows) {
            const safeColumns = (columns || []).filter((column) => column !== "RN__");
            if (!safeColumns.length) return `<div class="table-empty">조회 결과가 없습니다.</div>`;
            return `
                <div class="m04002-grid-wrap">
                    <table class="table-grid m04002-grid">
                        <thead><tr>${safeColumns.map((column) => `<th>${this.escapeHtml(column)}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${(rows || []).map((row) => `<tr>${safeColumns.map((column) => `<td title="${this.escapeHtml(row?.[column] ?? "")}">${this.escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>`).join("")}
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
            return String(value || "-").replace("T", " ").slice(0, 16);
        },

        formatPercent(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return "-";
            const percent = number <= 1 ? number * 100 : number;
            return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
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
        }
    };

    window[PAGE_CODE] = M04002;
})();
