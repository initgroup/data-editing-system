(function() {
    const PAGE_CODE = "M99001";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);
    const COMMON = MCOMMON.createPageHelper(PAGE_CODE);

    const emptyConnection = () => ({
        connectionId: "",
        connectionName: "",
        dbType: "ORACLE",
        host: "",
        port: 1521,
        serviceName: "",
        sid: "",
        username: "",
        password: "",
        walletPath: "",
        walletPassword: "",
        connectionMethod: "basic",
        dsnAlias: "",
        connectOptions: "",
        defaultYn: "N",
        sharedYn: "Y",
        useYn: "Y",
        sortOrder: 0
    });

    const M99001 = {
        ...COMMON,
        isInit: false,
        connections: [],
        selectedConnection: emptyConnection(),

        async init() {
            if (this.isInit) {
                this.applyBootstrapMode();
                this.updateConnectionDependentActions();
                return;
            }
            this.newConnection(false);
            this.applyBootstrapMode();
            if (!this.isBootstrapMode()) {
                await this.loadConnections();
            } else {
                this.renderConnectionList();
                this.renderLog("Admin key verified. Test the system DB connection information, then install system DDL.", "success");
            }
            this.isInit = true;
        },

        destroy() {
            this.connections = [];
            this.selectedConnection = emptyConnection();
            this.isInit = false;
        },

        isBootstrapMode() {
            return Boolean(sessionStorage.getItem("initBootstrapToken"));
        },

        isSetupWithoutTargetMode() {
            return !this.isBootstrapMode()
                && Boolean(sessionStorage.getItem("initLoginUser"))
                && !sessionStorage.getItem("targetConnectionId");
        },

        setElementHidden(el, hidden) {
            if (!el) return;
            el.hidden = hidden;
            if (hidden) {
                el.style.setProperty("display", "none", "important");
            } else {
                el.style.removeProperty("display");
            }
        },

        hasSelectedConnection() {
            if (this.isBootstrapMode()) return false;
            return Boolean(getContainerEl("#connectionId-M99001")?.value);
        },

        getContainer() {
            return document.getElementById("container-M99001");
        },

        applyBootstrapMode() {
            const bootstrap = this.isBootstrapMode();
            const setupWithoutTarget = this.isSetupWithoutTargetMode();
            this.getContainer()?.querySelectorAll("[data-operational-only]").forEach((el) => {
                this.setElementHidden(el, bootstrap);
            });
            this.getContainer()?.querySelectorAll("[data-bootstrap-only]").forEach((el) => {
                this.setElementHidden(el, !bootstrap);
            });
            this.getContainer()?.querySelectorAll("[data-setup-only]").forEach((el) => {
                this.setElementHidden(el, !setupWithoutTarget);
            });
            this.getContainer()?.querySelectorAll("[data-login-exit-only]").forEach((el) => {
                this.setElementHidden(el, !(bootstrap || setupWithoutTarget));
            });
            const initSystemButton = getContainerEl("#bootstrapInitSystemBtn-M99001");
            if (initSystemButton) {
                initSystemButton.disabled = !bootstrap;
                initSystemButton.onclick = () => this.bootstrapInitSystem();
            }
            if (bootstrap) {
                this.switchTab("connection");
                this.updateDescription("Initial system setup. Save/Delete are available after INIT_SYSTEM_DDL creates system tables.");
            }
            this.updateConnectionDependentActions();
        },

        backToLogin() {
            sessionStorage.removeItem("initBootstrapToken");
            sessionStorage.removeItem("initBootstrapAdminLoginId");
            PageManager.clearLoginSession?.();
            PageManager.resetWorkspaceForLogout?.();
            PageManager.load("login", "Data Editing System Login");
        },

        switchTab(tabName) {
            if (this.isBootstrapMode() && tabName !== "connection") {
                this.renderLog("Install system DDL first. Target installation is available after login.", "error");
                tabName = "connection";
            }
            getContainerEl(".m99001-tabs")?.querySelectorAll(".m99001-tab").forEach((button) => {
                button.classList.toggle("is-active", button.dataset.tab === tabName);
            });
            getContainerEl(".env-panel")?.querySelectorAll(".m99001-tab-panel").forEach((panel) => {
                panel.classList.toggle("is-active", panel.dataset.panel === tabName);
            });
            this.refreshActiveTabGrids();
            if (tabName === "deploy" && !this.hasSelectedConnection()) {
                this.renderDeployLog("Select a DB connection first.", "error");
            } else if (tabName === "ml" && !this.hasSelectedConnection()) {
                this.renderMlLog("Select a DB connection first.", "error");
            }
        },

        refreshActiveTabGrids() {
            const panel = getContainerEl(".m99001-tab-panel.is-active");
            if (!panel) return;
            const apply = () => {
                panel.querySelectorAll("table.table-grid").forEach((table) => {
                    CommonUtils.applyStandardGridDefaults?.(table);
                });
            };
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(apply);
            } else {
                window.setTimeout(apply, 0);
            }
        },

        markInstallTabAttention(active = true) {
            getContainerEl(".m99001-tabs")?.querySelector('[data-tab="deploy"]')?.classList.toggle("is-attention", active);
        },

        async updateInstallAttention(showLoading = false) {
            if (!this.hasSelectedConnection()) {
                this.markInstallTabAttention(false);
                return null;
            }
            const schema = await this.checkSchema(false);
            const needsInstall = schema ? !this.isSchemaReady(schema) : false;
            this.markInstallTabAttention(needsInstall);
            if (showLoading) {
                await this.loadModelDeployStatus(false);
            }
            return schema;
        },

        handleSearchKey(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.loadConnections();
            }
        },

        async loadConnections() {
            if (this.isBootstrapMode()) {
                this.connections = [];
                this.renderConnectionList();
                return;
            }
            const list = getContainerEl("#connectionList-M99001");
            if (!list) return;
            const keyword = getContainerEl("#connectionSearch-M99001")?.value.trim() || "";
            list.innerHTML = `<div class="env-tree-loading project-empty">Loading connections...</div>`;
            try {
                const params = new URLSearchParams({ keyword });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/connections?${params.toString()}`, { method: "GET", showLoading: false });
                this.connections = Array.isArray(json.data) ? json.data : [];
                this.renderConnectionList();
            } catch (error) {
                list.innerHTML = `<div class="env-tree-error">${this.escapeHtml(error.message || "Connection list load failed.")}</div>`;
            }
        },

        renderConnectionList() {
            const list = getContainerEl("#connectionList-M99001");
            if (!list) return;
            if (this.isBootstrapMode()) {
                list.innerHTML = `<div class="project-empty">Initial setup mode.</div>${this.renderListFooter(0)}`;
                return;
            }
            if (!this.connections.length) {
                list.innerHTML = `<div class="project-empty">No DB connections found.</div>${this.renderListFooter(0)}`;
                return;
            }
            list.innerHTML = `
                <div class="project-list-head">
                    <div>Connection</div>
                    <div>Status</div>
                </div>
                <div class="project-list-body">
                    ${this.connections.map((row) => this.createConnectionRow(row)).join("")}
                </div>
                ${this.renderListFooter(this.connections.length)}
            `;
        },

        createConnectionRow(row) {
            const id = row.CONNECTION_ID ?? "";
            const selectedClass = String(id) === String(this.selectedConnection.connectionId) ? "is-selected" : "";
            const name = row.CONNECTION_NAME || "";
            const endpoint = `${row.HOST || ""}:${row.PORT || ""}/${row.SERVICE_NAME || row.SID || ""}`;
            const status = row.LAST_TEST_STATUS || (row.DEFAULT_YN === "Y" ? "DEFAULT" : row.USE_YN || "Y");
            const shareStatus = row.SHARED_YN === "Y" ? "SHARED" : "PRIVATE";
            return `
                <button type="button" class="project-row ${selectedClass}" onclick="M99001.selectConnection('${this.escapeAttr(id)}')">
                    <span class="project-row-main">
                        <span class="project-row-title" title="${this.escapeHtml(name)}">${this.escapeHtml(name || "(Unnamed connection)")}</span>
                        <span class="project-row-sub" title="${this.escapeHtml(endpoint)}">${this.escapeHtml(endpoint || "-")}</span>
                    </span>
                    <span class="project-row-meta">
                        <span>${this.escapeHtml(row.DB_TYPE || "ORACLE")}</span>
                        <span>${this.escapeHtml(`${status} / ${shareStatus}`)}</span>
                    </span>
                </button>
            `;
        },

        async selectConnection(connectionId) {
            if (!connectionId) return;
            try {
                const params = new URLSearchParams({ connectionId });
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/connection?${params.toString()}`, { method: "GET" });
                const data = json.data || {};
                this.selectedConnection = {
                    connectionId: data.connectionId || "",
                    connectionName: data.connectionName || "",
                    dbType: data.dbType || "ORACLE",
                    host: data.host || "",
                    port: data.port || 1521,
                    serviceName: data.serviceName || "",
                    sid: data.sid || "",
                    username: data.username || "",
                    password: "",
                    walletPath: data.walletPath || "",
                    walletPassword: "",
                    ...this.parseConnectOptions(data.connectOptions || "", data.serviceName || "", data.walletPath || ""),
                    connectOptions: data.connectOptions || "",
                    defaultYn: data.defaultYn || "N",
                    sharedYn: data.sharedYn || "Y",
                    useYn: data.useYn || "Y",
                    sortOrder: data.sortOrder ?? 0
                };
                this.clearAllMessages();
                this.renderConnectionDetail();
                this.updateDescription(`Selected connection: ${this.selectedConnection.connectionName}`);
                this.renderConnectionList();
                this.updateConnectionDependentActions();
                await this.refreshSelectedConnectionStatus(false);
            } catch (error) {
                this.renderLog(error.message || "Connection detail load failed.", "error");
            }
        },

        newConnection(clearLog = true) {
            this.selectedConnection = emptyConnection();
            this.renderConnectionDetail();
            this.updateDescription("Create a new target database connection.");
            this.updateConnectionDependentActions();
            if (clearLog) {
                this.renderSchemaStatus([]);
                this.renderModelDeployStatus([]);
                this.clearAllMessages();
            }
        },

        getPayload() {
            const payload = {
                connectionId: getContainerEl("#connectionId-M99001")?.value || null,
                connectionName: getContainerEl("#connectionName-M99001")?.value.trim() || "",
                dbType: getContainerEl("#dbType-M99001")?.value || "ORACLE",
                host: getContainerEl("#host-M99001")?.value.trim() || "",
                port: getContainerEl("#port-M99001")?.value || 1521,
                serviceName: getContainerEl("#serviceName-M99001")?.value.trim() || "",
                sid: getContainerEl("#sid-M99001")?.value.trim() || "",
                username: getContainerEl("#username-M99001")?.value.trim() || "",
                password: getContainerEl("#password-M99001")?.value || "",
                walletPath: getContainerEl("#walletPath-M99001")?.value.trim() || "",
                walletPassword: getContainerEl("#walletPassword-M99001")?.value || "",
                connectOptions: this.buildConnectOptions(),
                defaultYn: getContainerEl("#defaultYn-M99001")?.value || "N",
                sharedYn: getContainerEl("#sharedYn-M99001")?.value || "Y",
                useYn: getContainerEl("#useYn-M99001")?.value || "Y",
                sortOrder: getContainerEl("#sortOrder-M99001")?.value || 0
            };
            if (this.isBootstrapMode()) {
                payload.bootstrapToken = sessionStorage.getItem("initBootstrapToken") || "";
            }
            return payload;
        },

        renderConnectionDetail() {
            const item = this.selectedConnection;
            this.setValue("#connectionId-M99001", item.connectionId || "");
            this.setValue("#connectionName-M99001", item.connectionName || "");
            this.setValue("#dbType-M99001", item.dbType || "ORACLE");
            this.setValue("#host-M99001", item.host || "");
            this.setValue("#port-M99001", item.port || 1521);
            this.setValue("#serviceName-M99001", item.serviceName || "");
            this.setValue("#sid-M99001", item.sid || "");
            this.setValue("#username-M99001", item.username || "");
            this.setValue("#password-M99001", "");
            this.setValue("#walletPath-M99001", item.walletPath || "");
            this.setValue("#walletPassword-M99001", "");
            this.setValue("#connectionMethod-M99001", item.connectionMethod || "basic");
            this.setValue("#dsnAlias-M99001", item.dsnAlias || "");
            this.setValue("#connectOptions-M99001", item.connectOptions || "");
            this.setValue("#defaultYn-M99001", item.defaultYn || "N");
            this.setValue("#sharedYn-M99001", item.sharedYn || "Y");
            this.setValue("#useYn-M99001", item.useYn || "Y");
            this.setValue("#sortOrder-M99001", item.sortOrder ?? 0);
            this.applyConnectionMethod();
            this.updateConnectionDependentActions();
        },

        updateConnectionDependentActions() {
            const shouldDisable = !this.hasSelectedConnection();
            this.getContainer()?.querySelectorAll("[data-requires-connection]").forEach((el) => {
                this.setElementHidden(el, false);
                if ("disabled" in el) el.disabled = shouldDisable;
                el.classList.toggle("is-disabled", shouldDisable);
                if (shouldDisable) {
                    el.title = "Select a DB connection first.";
                } else if (el.title === "Select a DB connection first.") {
                    el.removeAttribute("title");
                }
            });
        },

        requireSelectedConnection(messageRenderer) {
            if (this.hasSelectedConnection()) return true;
            messageRenderer.call(this, "Select a DB connection first.", "error");
            this.updateConnectionDependentActions();
            return false;
        },

        updateDescription(message) {
            this.setText("#connectionDescription-M99001", message || "");
        },

        parseConnectOptions(rawOptions, fallbackAlias = "", walletPath = "") {
            let options = {};
            try {
                options = rawOptions ? JSON.parse(rawOptions) : {};
            } catch (error) {
                options = {};
            }
            const connectionMethod = options.connectionMethod || (walletPath ? "cloudWallet" : "basic");
            return {
                connectionMethod,
                dsnAlias: options.dsnAlias || options.jdbcUrl || (connectionMethod === "basic" ? "" : fallbackAlias) || ""
            };
        },

        buildConnectOptions() {
            let options = {};
            const raw = getContainerEl("#connectOptions-M99001")?.value || "";
            try {
                options = raw.trim() ? JSON.parse(raw) : {};
            } catch (error) {
                options = {};
            }
            const connectionMethod = getContainerEl("#connectionMethod-M99001")?.value || "basic";
            const dsnAlias = getContainerEl("#dsnAlias-M99001")?.value.trim() || "";
            options.connectionMethod = connectionMethod;
            if (connectionMethod === "customJdbc") {
                delete options.dsnAlias;
                if (dsnAlias) {
                    options.jdbcUrl = dsnAlias;
                } else {
                    delete options.jdbcUrl;
                }
            } else if (connectionMethod === "tnsAlias" || connectionMethod === "cloudWallet") {
                delete options.jdbcUrl;
                if (dsnAlias) {
                    options.dsnAlias = dsnAlias;
                } else {
                    delete options.dsnAlias;
                }
            } else {
                delete options.jdbcUrl;
                delete options.dsnAlias;
            }
            return JSON.stringify(options, null, 2);
        },

        applyConnectionMethod() {
            const method = getContainerEl("#connectionMethod-M99001")?.value || "basic";
            const isBasic = method === "basic";
            const isWallet = method === "cloudWallet";
            const host = getContainerEl("#host-M99001");
            const port = getContainerEl("#port-M99001");
            const serviceName = getContainerEl("#serviceName-M99001");
            const sid = getContainerEl("#sid-M99001");
            const dsnAlias = getContainerEl("#dsnAlias-M99001");
            const walletPath = getContainerEl("#walletPath-M99001");
            const walletPassword = getContainerEl("#walletPassword-M99001");

            [host, port, serviceName, sid].forEach((el) => {
                if (el) el.disabled = !isBasic;
            });
            if (dsnAlias) {
                dsnAlias.disabled = isBasic;
                dsnAlias.placeholder = method === "customJdbc" ? "jdbc:oracle:thin:@host:port/service" : "initgroupediting_high";
            }
            if (walletPath) walletPath.disabled = !isWallet;
            if (walletPassword) walletPassword.disabled = !isWallet;

            const options = this.buildConnectOptions();
            this.setValue("#connectOptions-M99001", options);
        },

        async saveConnection() {
            if (this.isBootstrapMode()) {
                this.renderLog("Connection save is available after system tables are installed and you login.", "error");
                return;
            }
            const payload = this.getPayload();
            if (!payload.username) {
                this.renderLog("DB username is required.", "error");
                getContainerEl("#username-M99001")?.focus();
                return;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/connection/save`, {
                    method: "POST",
                    body: payload
                });
                this.renderLog(json.message || "Connection profile saved.", "success");
                await this.loadConnections();
                if (json.connectionId) {
                    await this.selectConnection(json.connectionId);
                }
                const schema = await this.updateInstallAttention(false);
                if (schema && !this.isSchemaReady(schema)) {
                    this.renderDeployLog("Connection saved. Target installation is not complete.", "info");
                }
            } catch (error) {
                this.renderLog(error.message || "Connection save failed.", "error");
            }
        },

        async deleteConnection() {
            if (this.isBootstrapMode()) {
                this.renderLog("Connection delete is available after system tables are installed and you login.", "error");
                return;
            }
            const connectionId = getContainerEl("#connectionId-M99001")?.value;
            if (!connectionId) {
                this.renderLog("Select a connection first.", "error");
                return;
            }
            const isCurrentTarget = String(connectionId) === String(sessionStorage.getItem("targetConnectionId") || "");
            if (!(await CommonMessage.confirm("Delete selected DB connection profile?"))) return;
            if (isCurrentTarget && !(await CommonMessage.confirm("Delete the database connection currently in use?"))) return;
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/connection/delete`, {
                    method: "POST",
                    body: { connectionId }
                });
                if (isCurrentTarget) {
                    alert("Please log in again.");
                    PageManager.clearLoginSession?.();
                    PageManager.resetWorkspaceForLogout?.();
                    await PageManager.load("login", "Data Editing System Login");
                    return;
                }
                this.renderLog(json.message || "Connection profile deleted.", "success");
                this.newConnection(false);
                await this.loadConnections();
            } catch (error) {
                this.renderLog(error.message || "Connection delete failed.", "error");
            }
        },

        async testConnection() {
            this.renderLog("Testing connection...", "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/connection/test`, {
                    method: "POST",
                    body: this.getPayload()
                });
                this.renderLog(json.message || "Connection succeeded.", "success");
                if (!this.isBootstrapMode()) await this.loadConnections();
            } catch (error) {
                this.renderLog(error.message || "Connection failed.", "error");
            }
        },

        async bootstrapInitSystem() {
            const bootstrapToken = sessionStorage.getItem("initBootstrapToken") || "";
            if (!bootstrapToken) {
                this.renderLog("Bootstrap authorization was not found. Sign up as the first administrator again.", "error");
                return;
            }
            if (!(await CommonMessage.confirm("Install INIT system tables and create the first administrator account?"))) return;
            this.renderLog("Installing INIT_SYSTEM_DDL and creating bootstrap administrator...", "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/bootstrap/init-system`, {
                    method: "POST",
                    body: this.getPayload()
                });
                const logs = json.logs || [json.message || "Initial system setup completed."];
                sessionStorage.removeItem("initBootstrapToken");
                const loginId = json.adminLoginId || sessionStorage.getItem("initBootstrapAdminLoginId") || "";
                sessionStorage.removeItem("initBootstrapAdminLoginId");
                sessionStorage.setItem("loginNotice", `${logs.join("\n")}\n\nInitial administrator created. Login with ${loginId || "the administrator account"}.`);
                PageManager.clearLoginSession?.();
                await PageManager.load("login", "Data Editing System Login");
            } catch (error) {
                this.renderLog(error.message || "Initial system setup failed.", "error");
            }
        },

        async checkSchema(showLog = true) {
            if (showLog) {
                this.renderLog("Checking target schema...", "info");
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/check`, {
                    method: "POST",
                    body: this.getPayload()
                });
                this.renderSchemaStatus(json.data || []);
                if (showLog) {
                    this.renderLog(`${json.installedCount || 0}/${json.total || 0} required tables exist. Created dates are shown in Table Status.`, "success");
                }
                return json;
            } catch (error) {
                if (showLog) {
                    this.renderLog(error.message || "Schema check failed.", "error");
                } else {
                    this.renderSchemaStatus([]);
                }
                return null;
            }
        },

        async refreshSelectedConnectionStatus(showLoading = true) {
            const connectionId = getContainerEl("#connectionId-M99001")?.value;
            if (!connectionId) {
                this.renderSchemaStatus([]);
                this.renderModelDeployStatus([]);
                return;
            }
            if (showLoading) {
                const schemaContainer = getContainerEl("#schemaStatus-M99001");
                if (schemaContainer) {
                    schemaContainer.innerHTML = `<div class="table-empty">Loading table status...</div>`;
                }
            }
            const schema = await this.checkSchema(false);
            this.markInstallTabAttention(schema ? !this.isSchemaReady(schema) : false);
            await this.loadModelDeployStatus(showLoading);
        },

        async refreshTableStatus() {
            const connectionId = getContainerEl("#connectionId-M99001")?.value;
            const schemaContainer = getContainerEl("#schemaStatus-M99001");
            if (!connectionId) {
                this.renderSchemaStatus([]);
                this.renderDeployLog("Select a DB connection first.", "error");
                return;
            }
            if (schemaContainer) {
                schemaContainer.innerHTML = `<div class="table-empty">Refreshing application table status...</div>`;
            }
            const result = await this.checkSchema(false);
            if (result) {
                this.renderDeployLog(`${result.installedCount || 0}/${result.total || 0} application tables exist.`, "success");
            } else {
                this.renderDeployLog("Application table status refresh failed.", "error");
            }
        },

        async refreshMlDeployStatus() {
            const connectionId = getContainerEl("#connectionId-M99001")?.value;
            const container = getContainerEl("#mlDeployStatus-M99001");
            if (!connectionId) {
                this.renderMlDeployStatus([]);
                this.renderMlLog("Select a DB connection first.", "error");
                return;
            }
            if (container) {
                container.innerHTML = `<div class="table-empty">Refreshing ML deploy status...</div>`;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/model-status`, {
                    method: "POST",
                    showLoading: false,
                    body: this.getPayload()
                });
                const rows = json.data || [];
                this.renderModelDeployStatus(rows);
                this.renderMlDeployStatus(rows);
                this.renderMlLog(`ML deploy status refreshed. ${this.countMlRows(rows)} row(s) found.`, "success");
            } catch (error) {
                this.renderMlDeployStatus([]);
                this.renderMlLog(error.message || "ML deploy status refresh failed.", "error");
            }
        },

        async initSchema() {
            if (!this.requireSelectedConnection(this.renderDeployLog)) return;
            if (!(await CommonMessage.confirm("Install application tables on the selected target database?"))) return;
            this.renderDeployLog("Installing application tables...", "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/init`, {
                    method: "POST",
                    body: this.getPayload()
                });
                const logs = json.logs || [json.message || "Application table installation completed."];
                this.renderDeployLog(`${logs.join("\n")}\n\nNext required step: click Deploy PL/SQL Objects.`, "success");
                const schema = await this.checkSchema(false);
                this.markInstallTabAttention(schema ? !this.isSchemaReady(schema) : true);
            } catch (error) {
                this.renderDeployLog(error.message || "Application table installation failed.", "error");
            }
        },

        async truncateTargetData() {
            if (!this.requireSelectedConnection(this.renderDeployLog)) return;
            if (!(await CommonMessage.confirm("Reset all application data in the selected target database? Tables remain, but data will be truncated."))) return;
            if (!(await CommonMessage.confirm("This cannot be undone. Continue target data reset?"))) return;
            this.renderDeployLog("Resetting target application data...", "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/truncate-target`, {
                    method: "POST",
                    body: this.getPayload()
                });
                const logs = json.logs || [json.message || "Target data reset completed."];
                this.renderDeployLog(logs.join("\n"), "success");
                await this.checkSchema(false);
                await this.loadModelDeployStatus(false);
            } catch (error) {
                this.renderDeployLog(error.message || "Target data reset failed.", "error");
            }
        },

        getSelectedModelObjectGroup() {
            const select = getContainerEl("#modelObjectGroup-M99001");
            const value = String(select?.value || "ALL").trim().toUpperCase();
            const label = select?.selectedOptions?.[0]?.textContent?.trim() || "All groups";
            return {
                value: value || "ALL",
                label
            };
        },

        async deployModelObjects() {
            if (!this.requireSelectedConnection(this.renderDeployLog)) return;
            const group = this.getSelectedModelObjectGroup();
            if (!(await CommonMessage.confirm(`Deploy PL/SQL model objects (${group.label}) on the selected target database?`))) return;
            this.renderDeployLog(`Deploying PL/SQL model objects (${group.label})...`, "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/model-objects`, {
                    method: "POST",
                    body: {
                        ...this.getPayload(),
                        modelObjectGroup: group.value
                    }
                });
                const logs = json.logs || [json.message || "Model object deployment completed."];
                const summary = json.checksum ? [`Checksum: ${json.checksum}`, ...logs] : logs;
                this.renderDeployLog(summary.join("\n"), "success");
                await this.loadModelDeployStatus(false);
                const schema = await this.checkSchema(false);
                this.markInstallTabAttention(false);
                if (group.value !== "ALL") {
                    this.renderDeployLog(`${summary.join("\n")}\n\nSelected PL/SQL object group deployment completed.`, "success");
                    return;
                }
                if (await CommonMessage.confirm("Basic installation is complete. Move to the login screen?")) {
                    sessionStorage.setItem(
                        "loginNotice",
                        "Target DB setup completed. Login again and select the target DB."
                    );
                    PageManager.clearLoginSession?.();
                    PageManager.load("login", "Data Editing System Login");
                } else {
                    this.renderDeployLog(`${summary.join("\n")}\n\nBasic installation completed. You can move to login when ready.`, "success");
                }
                return;
                if (!sessionStorage.getItem("targetConnectionId")) {
                    if (await CommonMessage.confirm("Basic installation is complete. Move to the login screen?")) {
                        sessionStorage.setItem(
                            "loginNotice",
                            "Target DB setup completed. Login again and select the target DB."
                        );
                        PageManager.clearLoginSession?.();
                        PageManager.load("login", "Data Editing System Login");
                    } else {
                        this.renderDeployLog(`${summary.join("\n")}\n\nBasic installation completed. You can move to login when ready.`, "success");
                    }
                    return;
                }
                if (!sessionStorage.getItem("targetConnectionId") && this.isSchemaReady(schema)) {
                    if (await CommonMessage.confirm("Basic installation is complete. Move to the login screen?")) {
                        sessionStorage.setItem(
                            "loginNotice",
                            "Target DB setup completed. Login again and select the target DB."
                        );
                        PageManager.clearLoginSession?.();
                        PageManager.load("login", "Data Editing System Login");
                    } else {
                        this.renderDeployLog(`${summary.join("\n")}\n\nBasic installation completed. You can move to login when ready.`, "success");
                    }
                } else if (!this.isSchemaReady(schema)) {
                    this.renderDeployLog(`${summary.join("\n")}\n\nPL/SQL objects deployed, but application table status is not complete. Check Application Table Status.`, "error");
                }
            } catch (error) {
                this.renderDeployLog(error.message || "Model object deployment failed.", "error");
            }
        },

        async prepareMlSeed() {
            if (!this.requireSelectedConnection(this.renderMlLog)) return;
            if (!(await CommonMessage.confirm("Prepare machine learning seed data on the selected target database?"))) return;
            this.renderMlLog("Preparing ML seed data...", "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/ml-seed`, {
                    method: "POST",
                    body: this.getPayload()
                });
                const logs = json.logs || [json.message || "ML seed data preparation completed."];
                const summary = json.checksum ? [`Checksum: ${json.checksum}`, ...logs] : logs;
                this.renderMlLog(summary.join("\n"), "success");
                await this.loadModelDeployStatus(false);
            } catch (error) {
                this.renderMlLog(error.message || "ML seed data preparation failed.", "error");
            }
        },

        async trainMlModels() {
            if (!this.requireSelectedConnection(this.renderMlLog)) return;
            if (!(await CommonMessage.confirm("Train or install machine learning models on the selected target database?"))) return;
            this.renderMlLog("Training ML models...", "info");
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/ml-train`, {
                    method: "POST",
                    body: this.getPayload()
                });
                const logs = json.logs || [json.message || "ML model training completed."];
                const summary = json.checksum ? [`Checksum: ${json.checksum}`, ...logs] : logs;
                this.renderMlLog(summary.join("\n"), "success");
                await this.loadModelDeployStatus(false);
            } catch (error) {
                this.renderMlLog(error.message || "ML model training failed.", "error");
            }
        },

        async loadModelDeployStatus(showLoading = true) {
            const connectionId = getContainerEl("#connectionId-M99001")?.value;
            if (!connectionId) {
                this.renderModelDeployStatus([]);
                this.renderMlDeployStatus([]);
                return;
            }
            const container = getContainerEl("#modelDeployStatus-M99001");
            if (showLoading && container) {
                container.innerHTML = `<div class="table-empty">Loading model object deploy status...</div>`;
            }
            try {
                const json = await CommonUtils.request(`${API_BASE_URL}/${PAGE_CODE}/schema/model-status`, {
                    method: "POST",
                    showLoading: false,
                    body: this.getPayload()
                });
                this.renderModelDeployStatus(json.data || []);
                this.renderMlDeployStatus(json.data || []);
                return json.data || [];
            } catch (error) {
                if (container) {
                    container.innerHTML = `<div class="table-error">${this.escapeHtml(error.message || "Model object deploy status load failed.")}</div>`;
                }
                this.renderMlDeployStatus([]);
                return [];
            }
        },

        isSchemaReady(schemaResult) {
            if (!schemaResult) return false;
            const total = Number(schemaResult.total || 0);
            const installed = Number(schemaResult.installedCount || 0);
            return total > 0 && installed === total;
        },

        renderSchemaStatus(rows) {
            const container = getContainerEl("#schemaStatus-M99001");
            if (!container) return;
            if (!Array.isArray(rows) || !rows.length) {
                this.renderStatusSummary("#schemaStatusSummary-M99001", []);
                container.innerHTML = `<div class="table-empty">No schema check result.</div>`;
                return;
            }
            this.renderStatusSummary("#schemaStatusSummary-M99001", rows, {
                statusGetter: (row) => row.EXISTS_YN === "Y" ? "INSTALLED" : "MISSING",
                successStatuses: ["INSTALLED"],
                missingStatuses: ["MISSING"]
            });
            container.innerHTML = `
                <table class="table-grid">
                    <thead>
                        <tr>
                            <th>Table</th>
                            <th>Status</th>
                            <th>Created At</th>
                            <th>Last DDL Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => `
                            <tr>
                                <td>${this.escapeHtml(row.TABLE_NAME || "")}</td>
                                <td>${row.EXISTS_YN === "Y" ? "Installed" : "Missing"}</td>
                                <td title="${this.escapeHtml(row.CREATED_AT || "")}">${this.escapeHtml(this.formatKstDateTime(row.CREATED_AT))}</td>
                                <td title="${this.escapeHtml(row.LAST_DDL_TIME || "")}">${this.escapeHtml(this.formatKstDateTime(row.LAST_DDL_TIME))}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
            this.refreshActiveTabGrids();
        },

        renderModelDeployStatus(rows) {
            const container = getContainerEl("#modelDeployStatus-M99001");
            if (!container) return;
            this.renderDeployStatusTable(container, this.filterInitDeployRows(rows), "No INIT$ model object deploy status.", "#modelDeployStatusSummary-M99001");
        },

        renderMlDeployStatus(rows) {
            const container = getContainerEl("#mlDeployStatus-M99001");
            if (!container) return;
            const mlRows = this.filterMlDeployRows(rows);
            this.renderDeployStatusTable(container, mlRows, "No ML deploy status.", "#mlDeployStatusSummary-M99001");
        },

        filterMlDeployRows(rows) {
            return Array.isArray(rows)
                ? rows.filter((row) => {
                    const group = String(row.OBJECT_GROUP || "").toUpperCase();
                    const type = String(row.OBJECT_TYPE || "").toUpperCase();
                    return group.includes("ML") || group.includes("MODEL_SEED") || group.includes("MODEL_TRAIN") || ["ML_MODEL", "MODEL_SEED", "MODEL_TRAINING_DATA", "MODEL_SETTING"].includes(type);
                })
                : [];
        },

        filterInitDeployRows(rows) {
            const objectTypes = new Set(["PACKAGE", "PACKAGE BODY", "PROCEDURE", "FUNCTION", "MODEL", "MINING MODEL"]);
            return Array.isArray(rows)
                ? rows.filter((row) => {
                    const name = String(row.OBJECT_NAME || "").toUpperCase();
                    const type = String(row.OBJECT_TYPE || "").toUpperCase();
                    return name.startsWith("INIT$") && objectTypes.has(type);
                })
                : [];
        },

        countMlRows(rows) {
            return this.filterMlDeployRows(rows).length;
        },

        renderDeployStatusTable(container, rows, emptyMessage, summarySelector = "") {
            if (!Array.isArray(rows) || !rows.length) {
                if (summarySelector) this.renderStatusSummary(summarySelector, []);
                container.innerHTML = `<div class="table-empty">${this.escapeHtml(emptyMessage)}</div>`;
                return;
            }
            if (summarySelector) {
                this.renderStatusSummary(summarySelector, rows, {
                    statusGetter: (row) => row.DEPLOY_STATUS || "",
                    successStatuses: ["SUCCESS", "INSTALLED", "VALID"],
                    missingStatuses: ["MISSING"],
                    failStatuses: ["FAILED", "INVALID"]
                });
            }
            container.innerHTML = `
                <table class="table-grid">
                    <thead>
                        <tr>
                            <th>Object Group</th>
                            <th>Object Name</th>
                            <th>Object Type</th>
                            <th>Version</th>
                            <th>Checksum</th>
                            <th>Status</th>
                            <th>Deployed At</th>
                            <th>Error Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => {
                            const status = row.DEPLOY_STATUS || "";
                            const statusClass = status === "SUCCESS" ? "is-ok" : (status === "FAILED" ? "is-fail" : "");
                            return `
                                <tr>
                                    <td>${this.escapeHtml(row.OBJECT_GROUP || "")}</td>
                                    <td>${this.escapeHtml(row.OBJECT_NAME || "")}</td>
                                    <td>${this.escapeHtml(row.OBJECT_TYPE || "")}</td>
                                    <td>${this.escapeHtml(row.OBJECT_VERSION || "")}</td>
                                    <td class="m99001-checksum-cell" title="${this.escapeHtml(row.CHECKSUM || "")}">${this.escapeHtml(row.CHECKSUM || "")}</td>
                                    <td class="${statusClass}">${this.escapeHtml(status)}</td>
                                    <td title="${this.escapeHtml(row.DEPLOYED_AT || "")}">${this.escapeHtml(this.formatKstDateTime(row.DEPLOYED_AT))}</td>
                                    <td class="m99001-error-cell" title="${this.escapeHtml(row.ERROR_MESSAGE || "")}">${this.escapeHtml(row.ERROR_MESSAGE || "")}</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            `;
            this.refreshActiveTabGrids();
        },

        renderStatusSummary(selector, rows, options = {}) {
            const el = getContainerEl(selector);
            if (!el) return;
            const list = Array.isArray(rows) ? rows : [];
            if (!list.length) {
                el.textContent = this.tl("statusSummary", "Total {total} / Success {success} / Failed {failed}", { total: 0, success: 0, failed: 0 });
                return;
            }
            const statusGetter = options.statusGetter || ((row) => row.STATUS || "");
            const successStatuses = new Set(options.successStatuses || ["SUCCESS", "INSTALLED", "VALID"]);
            const missingStatuses = new Set(options.missingStatuses || ["MISSING"]);
            const failStatuses = new Set(options.failStatuses || ["FAILED", "INVALID"]);
            let success = 0;
            let missing = 0;
            let failed = 0;
            list.forEach((row) => {
                const status = String(statusGetter(row) || "").toUpperCase();
                if (successStatuses.has(status)) success += 1;
                else if (missingStatuses.has(status)) {
                    missing += 1;
                    failed += 1;
                }
                else if (failStatuses.has(status)) failed += 1;
            });
            el.textContent = this.tl("statusSummary", "Total {total} / Success {success} / Failed {failed}", { total: list.length, success, failed });
        },

        formatKstDateTime(value) {
            const date = this.parseDateTime(value);
            if (!date) return value || "";
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

        renderLog(message, type = "info", selector = "#setupLog-M99001") {
            const log = getContainerEl(selector);
            if (!log) return;
            log.textContent = message || "";
            log.className = type === "error" ? "table-error" : "sql-editor data-script-editor";
        },

        renderDeployLog(message, type = "info") {
            this.renderLog(message, type, "#deployLog-M99001");
        },

        renderMlLog(message, type = "info") {
            this.renderLog(message, type, "#mlLog-M99001");
        },

        clearAllMessages() {
            this.renderLog("");
            this.renderDeployLog("");
            this.renderMlLog("");
        }
    };

    window[PAGE_CODE] = M99001;
})();
