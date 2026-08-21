(function () {
    "use strict";

    class QuickEditApiError extends Error {
        constructor(message, options = {}) {
            super(message || "요청을 처리하지 못했습니다.");
            this.name = "QuickEditApiError";
            this.status = Number(options.status || 0);
            this.payload = options.payload || null;
            this.path = options.path || "";
        }
    }

    class QuickEditApiClient {
        constructor(options = {}) {
            this.apiBase = String(options.apiBase || "/api").replace(/\/$/, "");
            this.targetConnectionId = null;
            this.session = null;
        }

        async bootstrapSession() {
            const payload = await this.request("/M91001/session/me", { targetRequired: false });
            const connectionId = Number(payload.targetConnectionId || 0);
            if (!Number.isInteger(connectionId) || connectionId <= 0) {
                throw new QuickEditApiError("대상 DB 연결을 먼저 선택해 주세요.", {
                    status: 409,
                    payload,
                    path: "/M91001/session/me"
                });
            }
            this.targetConnectionId = connectionId;
            this.session = payload;
            return payload;
        }

        async request(path, options = {}) {
            const normalizedPath = path.startsWith("/") ? path : `/${path}`;
            const url = `${this.apiBase}${normalizedPath}`;
            const headers = new Headers(options.headers || {});
            const targetRequired = options.targetRequired !== false;
            if (targetRequired) {
                if (!this.targetConnectionId) {
                    throw new QuickEditApiError("대상 DB 연결 정보가 없습니다.", {
                        status: 409,
                        path: normalizedPath
                    });
                }
                headers.set("X-Target-Connection-Id", String(this.targetConnectionId));
            }

            let body = options.body;
            if (body !== undefined && body !== null && !(body instanceof FormData) && !(body instanceof Blob)) {
                headers.set("Content-Type", "application/json");
                body = JSON.stringify(body);
            }

            let response;
            try {
                response = await fetch(url, {
                    method: options.method || (body === undefined ? "GET" : "POST"),
                    headers,
                    body,
                    credentials: "include",
                    signal: options.signal,
                    cache: "no-store"
                });
            } catch (error) {
                if (error?.name === "AbortError") throw error;
                throw new QuickEditApiError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", {
                    path: normalizedPath
                });
            }

            const contentType = response.headers.get("content-type") || "";
            let payload = null;
            if (contentType.includes("application/json")) {
                try {
                    payload = await response.json();
                } catch (_error) {
                    payload = null;
                }
            } else {
                const text = await response.text();
                payload = text ? { detail: text } : null;
            }

            if (!response.ok || (payload && payload.status && payload.status !== "success")) {
                const message = this.getErrorMessage(payload, response.status);
                throw new QuickEditApiError(message, {
                    status: response.status,
                    payload,
                    path: normalizedPath
                });
            }
            return payload || { status: "success" };
        }

        getErrorMessage(payload, status) {
            const detail = payload?.detail || payload?.message || payload?.error;
            if (typeof detail === "string" && detail.trim()) return detail.trim();
            if (Array.isArray(detail)) {
                return detail.map((item) => item?.msg || String(item)).filter(Boolean).join("\n");
            }
            if (status === 401) return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
            if (status === 403) return "이 작업을 수행할 권한이 없습니다.";
            if (status === 404) return "요청한 데이터를 찾을 수 없습니다.";
            return `요청을 처리하지 못했습니다. (HTTP ${status || 0})`;
        }

        buildPath(path, params = {}) {
            const query = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                if (value === undefined || value === null || value === "") return;
                query.set(key, String(value));
            });
            const suffix = query.toString();
            return suffix ? `${path}?${suffix}` : path;
        }

        getProjects() {
            return this.request("/M01001/projects?keyword=");
        }

        getScenarios(projectId) {
            return this.request(this.buildPath("/M01002/scenarios", { projectId, keyword: "" }));
        }

        saveProject(project) {
            return this.request("/M01001/project/save", {
                method: "POST",
                body: {
                    projectId: null,
                    projectCode: project.projectCode,
                    projectName: project.projectName,
                    projectType: "EDITING",
                    projectDesc: "퀵 데이터 에디팅에서 자동 생성",
                    useYn: "Y",
                    sortOrder: 0
                }
            });
        }

        saveScenario(scenario) {
            return this.request("/M01002/scenario/save", {
                method: "POST",
                body: {
                    scenarioId: null,
                    projectId: scenario.projectId,
                    scenarioCode: scenario.scenarioCode,
                    scenarioName: scenario.scenarioName,
                    scenarioType: "RULE",
                    scenarioDesc: "퀵 데이터 에디팅에서 자동 생성",
                    useYn: "Y",
                    sortOrder: 0
                }
            });
        }

        async stageFile(file, onProgress) {
            const session = await this.request("/M02001/upload-session", {
                method: "POST",
                body: { fileName: file.name, fileSize: file.size }
            });
            const uploadId = session.uploadId;
            const chunkSize = Math.max(1, Number(session.chunkSize || 4 * 1024 * 1024));
            let offset = Number(session.receivedSize || 0);
            if (typeof onProgress === "function") onProgress(file.size ? offset / file.size : 0);

            while (offset < file.size) {
                const end = Math.min(offset + chunkSize, file.size);
                const form = new FormData();
                form.append("uploadId", uploadId);
                form.append("offset", String(offset));
                form.append("chunk", file.slice(offset, end), file.name);
                const result = await this.request("/M02001/upload-chunk", {
                    method: "POST",
                    body: form
                });
                offset = Number(result.receivedSize || end);
                if (typeof onProgress === "function") onProgress(file.size ? Math.min(1, offset / file.size) : 1);
            }
            return { uploadId, fileName: file.name, fileSize: file.size };
        }

        previewStaged(uploadId, fileOptions) {
            const form = this.buildUploadForm(uploadId, fileOptions);
            return this.request("/M02001/preview-staged", { method: "POST", body: form });
        }

        finalizeStagedUpload(uploadId, fileOptions, workspace) {
            const form = this.buildUploadForm(uploadId, fileOptions);
            form.append("projectId", String(workspace.projectId));
            form.append("projectCode", workspace.projectCode);
            form.append("tableComment", fileOptions.tableComment || fileOptions.fileName || "");
            form.append("tableNameRule", "INITUP$_{PROJECT_CODE}_FT_{TIME}");
            return this.request("/M02001/upload-staged", { method: "POST", body: form });
        }

        buildUploadForm(uploadId, fileOptions = {}) {
            const form = new FormData();
            form.append("uploadId", uploadId);
            form.append("fileType", fileOptions.fileType || "csv");
            const delimiter = fileOptions.delimiter === "\\t" ? "\t" : (fileOptions.delimiter || ",");
            form.append("delimiter", delimiter);
            form.append("fixedWidths", fileOptions.fixedWidths || "");
            form.append("hasHeader", fileOptions.hasHeader === "N" ? "N" : "Y");
            form.append("encoding", fileOptions.encoding || "auto");
            return form;
        }

        getUploadTable(projectId, projectCode, tableName) {
            return this.request(this.buildPath("/M02001/upload-table-tree", {
                projectId,
                projectCode,
                tablePrefix: tableName
            }));
        }

        saveScenarioTable(payload) {
            return this.request("/M02002/scenario-table/save", {
                method: "POST",
                body: {
                    scenarioTableId: payload.scenarioTableId || null,
                    projectId: payload.projectId,
                    scenarioId: payload.scenarioId,
                    ownerName: payload.ownerName,
                    tableName: payload.tableName,
                    tableComment: payload.tableComment || "",
                    useYn: "Y",
                    sortOrder: payload.sortOrder || null,
                    autoDesignYn: "Y"
                }
            });
        }

        getFlow(flowId) {
            return this.request(`/M04001/flow/${encodeURIComponent(flowId)}`);
        }

        runFlow(flowPayload) {
            return this.request("/M04001/flow/run", {
                method: "POST",
                body: flowPayload
            });
        }

        runSavedFlow(flowId, projectId, scenarioId, requestToken, quickEditSummary = null) {
            return this.request("/M04001/flow/run-saved", {
                method: "POST",
                body: {
                    flowId,
                    projectId,
                    scenarioId,
                    requestToken,
                    quickEditSummary,
                    batch: false
                }
            });
        }

        getRunSnapshot(flowRunId, projectId, scenarioId) {
            return this.request(this.buildPath(`/M04001/run/${encodeURIComponent(flowRunId)}/snapshot`, {
                projectId,
                scenarioId
            }));
        }

        getQuickEditHistory(page = 1, pageSize = 20) {
            return this.request(this.buildPath("/M04001/quick-edit/history", {
                page,
                pageSize
            }));
        }

        getQuickEditHistoryDetail(flowRunId) {
            return this.request(`/M04001/quick-edit/history/${encodeURIComponent(flowRunId)}`);
        }

        getRunNodes(flowRunId) {
            return this.request(`/M04002/runs/${encodeURIComponent(flowRunId)}/nodes`);
        }

        getDescriptiveStatistics(flowRunId, nodeRunId) {
            return this.request(this.buildPath(
                `/M04002/runs/${encodeURIComponent(flowRunId)}/descriptive-statistics`,
                { nodeRunId }
            ));
        }

        getCategoricalRules(params) {
            return this.request(this.buildPath("/M04002/model-rule-summary", {
                owner: params.owner,
                modelName: params.modelName,
                targetOwner: params.targetOwner,
                targetTable: params.targetTable,
                runSourceType: "FLOW_WORK",
                runId: params.flowRunId,
                flowRunId: params.flowRunId,
                page: 1,
                pageSize: params.pageSize || 12,
                resultColumnPage: 1,
                resultColumnPageSize: 10
            }));
        }

        getContinuousRules(params) {
            return this.request(this.buildPath("/M04002/result-table", {
                owner: params.owner,
                objectName: params.objectName,
                menuCode: "M03003",
                targetOwner: params.targetOwner,
                targetTable: params.targetTable,
                runSourceType: "FLOW_WORK",
                runId: params.flowRunId,
                flowRunId: params.flowRunId,
                page: 1,
                pageSize: params.pageSize || 15
            }));
        }

        getSymbolicRuleSample(params) {
            return this.request(this.buildPath("/M04002/symbolic-rule-sample", {
                owner: params.owner,
                ruleId: params.ruleId,
                runSourceType: "FLOW_WORK",
                runId: params.flowRunId,
                sampleLimit: params.sampleLimit || 200
            }));
        }

        getViolationRows(params) {
            return this.request(this.buildPath("/M04002/result-table", {
                owner: params.owner,
                objectName: params.objectName,
                menuCode: "M03004",
                targetOwner: params.targetOwner,
                targetTable: params.targetTable,
                ruleModelName: params.ruleModelName,
                violationRuleId: params.ruleId,
                violationConfidenceScope: "ALL",
                violationResultScope: "HIT",
                symbolicViolationResultScope: "HIT",
                balancedRuleSummaryYn: params.balancedRuleSummaryYn ? "Y" : undefined,
                runSourceType: "FLOW_WORK",
                runId: params.flowRunId,
                flowRunId: params.flowRunId,
                page: params.page || 1,
                pageSize: params.pageSize || 20
            }));
        }
    }

    window.QuickEditApiError = QuickEditApiError;
    window.QuickEditApiClient = QuickEditApiClient;
})();
