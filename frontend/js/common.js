/**
 * common.js: 시스템 전역 공통 유틸리티
 */
const CommonUI = {
    t(path, fallback = "") {
        return window.I18nManager?.t?.(path, fallback) || fallback;
    },

    // --- [로딩바 제어 영역] ---
    /**
     * 동기식 작업 시 화면을 차단하고 로딩바를 표시
     * [요구사항 8] 반영
     */
    showLoading(message = "", detail = "") {
        const loader = document.getElementById('customLoadingBar');
        if (loader) {
            const titleEl = loader.querySelector(".app-loading-copy p");
            const detailEl = loader.querySelector(".app-loading-copy span");
            if (titleEl) titleEl.textContent = message || CommonUI.t("commonUi.loading.title", "Processing data");
            if (detailEl) detailEl.textContent = detail || CommonUI.t("commonUi.loading.detail", "Preparing workspace");
            loader.classList.remove('hidden');
            loader.style.display = 'flex'; // Tailwind hidden 해제 후 flex 적용
        }
    },

    /**
     * 로딩바 숨기기
     */
    hideLoading() {
        const loader = document.getElementById('customLoadingBar');
        if (loader) {
            loader.classList.add('hidden');
            loader.style.display = 'none';
        }
    },

    // --- [메시지 알림 영역] ---
    showPageError(pageCode, msg) {
        const container = document.getElementById(`container-${pageCode}`);
        const anchor = container ? container.querySelector('#msg-anchor') : null;                
        if (!anchor) return null;
        this._displayInPage(anchor, msg, 'error') 
    },

    showPageSuccess(pageCode, msg) {
        const container = document.getElementById(`container-${pageCode}`);
        const anchor = container ? container.querySelector('#msg-anchor') : null;                
        if (!anchor) return null;
        this._displayInPage(anchor, msg, 'success');
    },

    /**
     * 페이지별 메시지 숨기기
     * @param {*} anchor - getContainerEl('#msg-anchor') 
     * @returns 
     */
    hidePageMessage(pageCode) {
        const container = document.getElementById(`container-${pageCode}`);
        const anchor = container ? container.querySelector('#msg-anchor') : null;        
        if (!anchor) return null;
        // 1. 컨테이너 또는 직접 앵커 ID로 찾기
        if (anchor) {
            const box = anchor.querySelector('.local-error-box');
            if (box) {
                box.style.opacity = '0';
                box.classList.add('hidden');
                box.style.display = 'none';
            }
        }
    },

    /**
     * 내부 메시지 렌더링 함수
     * @param {*} anchor - getContainerEl('#msg-anchor')
     * @param {*} msg 
     * @param {*} type 
     * @returns 
     */
    _displayInPage(anchor, msg, type = 'error') {
        if (!anchor) return null;

        const box = anchor.querySelector('.local-error-box');
        const text = anchor.querySelector('.local-error-text');
        const icon = anchor.querySelector('.local-error-icon');

        if (!box || !text) return;

        // [핵심 수정] hidePageMessage에서 none으로 만든 display를 다시 flex로 복구
        box.style.display = 'flex'; 
        box.classList.remove('hidden');
        box.style.opacity = '1';

        // 3. 타입별 디자인 적용
        box.classList.remove('is-success', 'is-error');
        if (type === 'success') {
            box.classList.add('is-success');
            icon.className = 'local-error-icon fas fa-check-circle';
        } else {
            box.classList.add('is-error');
            icon.className = 'local-error-icon fas fa-exclamation-circle';
        }

        // 4. 메시지 삽입
        text.innerText = msg;
    },

    /**
     * [요구사항 9] 객체 Null 및 에러 방지 유틸
     */
    nvl(val, replaceStr = '') {
        return (val === undefined || val === null) ? replaceStr : val;
    },

    /**
     * 두 객체를 깊게 병합 (Deep Merge)
     * 기본 설정(target)에 사용자 설정(source)을 덮어씌움
     */
    mergeConfig(target, source) {
        if (!source) return target;
        
        const output = { ...target };
        
        Object.keys(source).forEach(key => {
            if (source[key] instanceof Object && key in target && !Array.isArray(source[key])) {
                // 객체인 경우 재귀적으로 병합 (Deep Merge)
                output[key] = this.mergeConfig(target[key], source[key]);
            } else {
                // 그 외 값은 덮어씌움
                output[key] = source[key];
            }
        });
        
        return output;
    },

    // --- [신규: 그리드 관련 공통 함수 본체] ---
    /**
     * Grid.js 공통 생성 함수
     */
    createGrid(container, options) {
        if (!container) return null;
        if (typeof gridjs === 'undefined') {
            console.error("Grid.js library is not loaded.");
            return null;
        }

        const defaultOptions = {
           /*  width: '100%', */     // 부모 컨테이너 가로폭에 맞춤
            height: 'auto',
            autoWidth: true,   // 컬럼 너비 자동 계산
            fixedHeader: true, // 헤더 고정 (유지)
            resizable: true,
            // 기본 페이징 설정
            pagination: { 
                enabled: true, // 활성화 명시
                limit: 10, 
                summary: true, 
                buttons: {
                    // 맨 처음 버튼
                    first: document.createRange().createContextualFragment(
                        `<i class="fas fa-angle-double-left" title="${this.t("commonUi.grid.firstTitle", "First")}"></i>`
                    ),
                    // 이전 버튼
                    prev: document.createRange().createContextualFragment(
                        `<i class="fas fa-angle-left" title="${this.t("commonUi.grid.previousTitle", "Previous")}"></i>`
                    ),
                    // 다음 버튼
                    next: document.createRange().createContextualFragment(
                        `<i class="fas fa-angle-right" title="${this.t("commonUi.grid.nextTitle", "Next")}"></i>`
                    ),
                    // 맨 끝 버튼
                    last: document.createRange().createContextualFragment(
                        `<i class="fas fa-angle-double-right" title="${this.t("commonUi.grid.lastTitle", "Last")}"></i>`
                    )
                }
            },
            sort: false,
            // 한국어 메시지 설정
            language: {
                'pagination': {
                    'first': this.t("commonUi.grid.first", "First"),
                    'previous': this.t("commonUi.grid.previous", "Previous"),
                    'next': this.t("commonUi.grid.next", "Next"),
                    'last': this.t("commonUi.grid.last", "Last"),
                    'showing': this.t("commonUi.grid.showing", "Showing"),
                    'results': () => this.t("commonUi.grid.results", "results"),
                    'of': '/',
                    'to': '-'
                },
                'noRecordsFound': this.t("commonUi.grid.noRecordsFound", "No records found."),
                'loading': this.t("commonUi.grid.loading", "Loading data..."),
            },
            // 스타일 클래스 주입
            className: {
                table: 'custom-grid-table', // CSS 클래스 추가
                th: 'gridjs-th',
                td: 'gridjs-td',
                pagination: 'gridjs-pagination'
            }
        };

        // [교체 부분] 가장 안전한 병합 방식
        const finalOptions = this.mergeConfig(defaultOptions, options);

        // 3. 인스턴스 생성 및 렌더링 후 결과 반환 (중요: return 필수)
        const grid = new gridjs.Grid(finalOptions);
        return grid.render(container);
    },

    /**
     * 그리드 동기화 및 동적 렌더링 공통 함수
     * @param {Object} params 
     * {
     * pageInstance: 페이지 객체 (this),
     * gridKey: 'grid1',
     * resData: 서버 응답 데이터,
     * containerSelector: '#gridContainer',
     * staticColumns: 정적 컬럼 설정 (옵션),
     * customColumnStyles: { '컬럼명': { width: '100px' } } (옵션)
     * }
     */
    renderDynamicGrid({ pageInstance, gridKey, resData, container, staticColumns = null, customColumnStyles = {} }) {
        // container가 정상적으로 넘어왔는지 확인
        if (!container) {
            console.error(`Grid container was not found. (GridKey: ${gridKey})`);
            return;
        }

        const manager = pageInstance.gridManagers[gridKey];

        // 1. 기존 인스턴스 파괴 및 DOM 초기화
        if (manager.gridInstance) {
            try {
                manager.gridInstance.destroy();
            } catch (e) {
                console.warn(`GridJS [${gridKey}] destroy error:`, e);
            }
            manager.gridInstance = null;
        }
        container.innerHTML = '';

        // 2. 데이터 구조 정규화
        let rowData = [];
        let columnsData = [];
        if (resData && resData.columns && Array.isArray(resData.columns)) {
            columnsData = resData.columns;
            rowData = resData.data || [];
        } else if (Array.isArray(resData)) {
            rowData = resData;
            columnsData = rowData.length > 0 ? Object.keys(rowData[0]) : [];
        }

        // 3. 컬럼 정의 생성
        let finalColumns = staticColumns;
        if (!finalColumns) {
            if (columnsData.length === 0) columnsData = [CommonUI.t("commonUi.grid.defaultColumn", "Result")];
            finalColumns = columnsData.map(col => {
                let colDef = {
                    id: col,
                    name: pageInstance._translateColumnName ? pageInstance._translateColumnName(col) : col,
                    sort: false,
                    resizable: true,
                    formatter: (cell) => (cell === null || cell === undefined) ? '' : String(cell)
                };
                if (col === 'RNUM') colDef.width = '80px';
                if (col.includes('DATE')) colDef.width = '150px';
                if (customColumnStyles[col]) {
                    colDef = { ...colDef, ...customColumnStyles[col] };
                }
                return colDef;
            });
        }

        // 4. 그리드 생성 및 렌더링
        manager.gridInstance = CommonUI.createGrid(container, {
            columns: finalColumns,
            data: rowData
        });

        if (manager.gridInstance) {
            CommonUI.bindGridRowClick(container);
        }
    },

    /**
     * 그리드 행 선택 시 배경색 변경 이벤트 바인딩
     */
    bindGridRowClick(container) {
        if (!container) return null;

        // 2. 기존에 걸린 이벤트와 충돌 피하기 위해 이벤트를 새로 정의 (이벤트 위임)
        // 한번만 등록되도록 처리하거나, 기존 리스너를 고려해야 함
        container.onclick = (e) => {
            const tr = e.target.closest('.gridjs-tr');
            if (!tr || tr.querySelector('.gridjs-th')) return; // 헤더 클릭 방지

            // 3. 모든 행에서 클래스 제거 후 현재 행에만 추가
            container.querySelectorAll('.gridjs-tr').forEach(el => {
                el.classList.remove('is-selected');
            });
            tr.classList.add('is-selected');

            console.log("Row selected:", tr);
        };
    },
    
    /**
     * 1. 컨테이너 내의 모든 입력 필드에 값 존재 여부에 따른 클래스(has-value) 부여 이벤트를 바인딩
     * @param {string} containerSelector - 대상 컨테이너 셀렉터 (예: '#container-M01001')
     */
    initInputState(containerSelector) {
        const inputs = document.querySelectorAll(`${containerSelector} .form-control`);
        
        inputs.forEach(input => {
            const checkValue = () => {
                // 값이 있고 공백이 아닐 때 'has-value' 클래스 추가
                if (input.value && String(input.value).trim() !== "") {
                    input.classList.add('has-value');
                } else {
                    input.classList.remove('has-value');
                }
            };

            // 이벤트 등록 (중복 등록 방지를 위해 기존 리스너 제거는 브라우저가 처리하거나 명시적 관리 필요)
            input.removeEventListener('change', checkValue);
            input.removeEventListener('input', checkValue);
            input.addEventListener('change', checkValue);
            input.addEventListener('input', checkValue);
            
            // 최초 로드 시점 체크
            checkValue();
        });
    },  

    /**
     * 특정 컨테이너 내의 모든 입력 요소 초기화
     * @param {string} containerId - 초기화할 영역의 ID
     */
    clearInputs(container) {
        if (!container) return null;

        // 1. 일반 입력 필드 및 셀렉트 박스 초기화
        container.querySelectorAll('input[type="text"], input[type="date"], select, .form-control').forEach(el => {
            el.value = '';
            el.classList.remove('has-value'); // resetForm의 스타일 초기화 기능 흡수
            
            // 만약 Select 박스라면 첫 번째 옵션("선택하세요")으로 복구
            if (el.tagName === 'SELECT') {
                el.disabled = true;
                el.innerHTML = `<option value="">${this.t("commonUi.combo.select", "-- Select --")}</option>`;
            }
        });

        // 2. 체크박스 및 라디오 해제
        container.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
            el.checked = false;
        });

        // 3. 페이지 메시지 숨기기 (주석 해제 권장)
        this.hidePageMessage(container);
    }
};

const CommonUtils = {
    activeRequestCount: 0,

    getActiveRequestCount() {
        return this.activeRequestCount;
    },

    async waitForIdle(timeoutMs = 15000) {
        const startedAt = Date.now();
        while (this.activeRequestCount > 0 && Date.now() - startedAt < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return this.activeRequestCount === 0;
    },

    getLoginUser() {
        try {
            return JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
        } catch (_error) {
            return {};
        }
    },

    setRuntimeSettings(settings = null) {
        if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;
        sessionStorage.setItem("initRuntimeSettings", JSON.stringify(settings));
    },

    getRuntimeSetting(settingKey, fallbackValue, minimum = null, maximum = null) {
        let settings = {};
        try {
            settings = JSON.parse(sessionStorage.getItem("initRuntimeSettings") || "{}");
        } catch (_error) {
            settings = {};
        }
        const parsed = Number(settings?.[String(settingKey || "").trim().toUpperCase()]);
        let value = Number.isFinite(parsed) ? parsed : Number(fallbackValue);
        if (!Number.isFinite(value)) value = 0;
        if (Number.isFinite(Number(minimum))) value = Math.max(Number(minimum), value);
        if (Number.isFinite(Number(maximum))) value = Math.min(Number(maximum), value);
        return value;
    },

    isAdminUser() {
        const user = this.getLoginUser();
        return String(user.roleCode || user.ROLE_CODE || user.role || "").toUpperCase() === "ADMIN";
    },

    getLoginUserId() {
        const user = this.getLoginUser();
        return String(user.userId ?? user.USER_ID ?? "").trim();
    },

    getRecordOwnerUserId(row = {}) {
        return String(row.USER_ID ?? row.userId ?? row.PROJECT_USER_ID ?? row.projectUserId ?? row.OWNER_USER_ID ?? row.ownerUserId ?? "").trim();
    },

    getRecordOwnerLabel(row = {}) {
        return String(
            row.LOGIN_ID
            ?? row.loginId
            ?? row.PROJECT_LOGIN_ID
            ?? row.projectLoginId
            ?? row.OWNER_LOGIN_ID
            ?? row.ownerLoginId
            ?? row.USER_LOGIN_ID
            ?? row.userLoginId
            ?? row.USER_EMAIL
            ?? row.userEmail
            ?? row.PROJECT_USER_EMAIL
            ?? row.projectUserEmail
            ?? row.OWNER_USER_EMAIL
            ?? row.ownerUserEmail
            ?? ""
        ).trim();
    },

    getOwnerDisplayId(row = {}) {
        const label = this.getRecordOwnerLabel(row);
        if (label.includes("@")) return label.split("@")[0] || label;
        if (label) return label;
        const ownerUserId = this.getRecordOwnerUserId(row);
        return ownerUserId ? `User #${ownerUserId}` : "";
    },

    getOwnerScopeClass(row = {}) {
        if (!this.isAdminUser()) return "";
        const ownerUserId = this.getRecordOwnerUserId(row);
        if (!ownerUserId) return "";
        const currentUserId = this.getLoginUserId();
        return currentUserId && ownerUserId === currentUserId ? "owner-scope-my" : "owner-scope-other";
    },

    getOwnerScopeSuffix(row = {}) {
        if (!this.isAdminUser()) return "";
        const ownerUserId = this.getRecordOwnerUserId(row);
        if (!ownerUserId) return "";
        const currentUserId = this.getLoginUserId();
        if (currentUserId && ownerUserId === currentUserId) return "";
        const ownerLabel = this.getOwnerDisplayId(row) || `User #${ownerUserId}`;
        return ` [${ownerLabel}]`;
    },

    formatOwnerScopedName(row = {}, name = "") {
        return `${String(name || "").trim()}${this.getOwnerScopeSuffix(row)}`;
    },

    applyOwnerScopeToSelect(select, rows = [], selectedValue = "", idKeys = ["PROJECT_ID", "projectId"]) {
        if (!select) return;
        select.classList.remove("owner-scope-my", "owner-scope-other");
        const selectedText = String(selectedValue ?? "");
        const row = (Array.isArray(rows) ? rows : []).find((item) =>
            idKeys.some((key) => String(item?.[key] ?? "") === selectedText)
        );
        const className = this.getOwnerScopeClass(row || {});
        if (className) select.classList.add(className);
    },
    // 그리드 데이터 구조 표준화
    createGridModel: (itemsPerPage = 10) => ({
        gridInstance: null,
        currentData: [],
        itemsPerPage: itemsPerPage,
        currentPage: 1,
    }),

    /**
     * JSON 응답에서 안전하게 배열 추출
     * @param {Object} json - 서버 응답 객체
     * @param {string} key - 찾고자 하는 데이터 키 (예: 'userList')
     */
    extractArray(json, key = null) {
        if (!json || !json.data) return [];

        // 1. 특정 키가 지정된 경우 (예: json.data.userList)
        if (key && Array.isArray(json.data[key])) {
            return json.data[key];
        }

        // 2. 키가 없거나 못 찾은 경우 기존 방식대로 탐색
        const fallback = json.data?.data ?? json.data;
        return Array.isArray(fallback) ? fallback : [];
    },

    formatErrorMessage(errorJson, context = {}) {
        const detail = errorJson?.detail || errorJson?.message;
        const status = Number(context.status || 0);
        if (Array.isArray(detail)) {
            const message = detail.map((item) => {
                if (typeof item === "string") return item;
                const location = Array.isArray(item.loc) ? item.loc.join(".") : "";
                const message = item.msg || JSON.stringify(item);
                return location ? `${location}: ${message}` : message;
            }).join("\n");
            return this.formatMainErrorMessage(message, { ...context, status });
        }
        if (detail && typeof detail === "object") {
            return this.formatMainErrorMessage(detail.msg || JSON.stringify(detail), { ...context, status });
        }
        return this.formatMainErrorMessage(detail || "Request failed.", { ...context, status });
    },

    formatMainErrorMessage(message, context = {}) {
        const raw = String(message || "").trim();
        const lower = raw.toLowerCase();
        const status = Number(context.status || 0);
        const url = String(context.url || "");
        const isApiRequest = /\/api\//.test(url) || url.startsWith("/api/");
        const appendDetail = (friendly) => {
            if (!raw || raw === friendly) return friendly;
            const detailLabel = CommonUI.t("commonUi.errors.detail", "Detail");
            if (raw.length > 160) return `${friendly}\n${detailLabel}: ${raw.slice(0, 160)}...`;
            return `${friendly}\n${detailLabel}: ${raw}`;
        };

        if (status === 404) {
            return isApiRequest
                ? CommonUI.t("commonUi.errors.apiNotFound", "The requested feature (API) was not found. Check that the screen and server versions match.")
                : CommonUI.t("commonUi.errors.pageNotFound", "The requested page file was not found. Check the page file connection.");
        }

        if ([502, 503, 504].includes(status)) {
            return CommonUI.t("commonUi.errors.serverUnavailable", "The WAS server is not responding. Check the server status or network connection.");
        }

        if (
            lower.includes("failed to fetch")
            || lower.includes("networkerror")
            || lower.includes("network error")
            || lower.includes("load failed")
            || lower.includes("connection refused")
            || lower.includes("err_connection_refused")
        ) {
            return CommonUI.t("commonUi.errors.serverConnectionFailed", "Cannot connect to the WAS server. Check that the server is running and the URL is correct.");
        }

        if (
            lower.includes("getaddrinfo failed")
            || lower.includes("ora-12154")
            || lower.includes("ora-12514")
            || lower.includes("ora-12541")
            || lower.includes("ora-12545")
            || lower.includes("dpy-6005")
            || lower.includes("dpi-1047")
            || lower.includes("database connection")
            || lower.includes("target db")
        ) {
            return appendDetail(CommonUI.t("commonUi.errors.targetDbConnectionFailed", "Cannot connect to the Target DB. Check the DB host, service name, port, and network status."));
        }

        if (status >= 500) {
            return appendDetail(CommonUI.t("commonUi.errors.serverProcessingFailed", "A server processing error occurred. Try again later or contact an administrator."));
        }

        return raw || CommonUI.t("commonUi.errors.requestFailed", "The request could not be processed.");
    },

    async request(url, options = {}) {
        const requestLog = window.ConsoleLogger?.requestStart?.(url, options);
        this.activeRequestCount += 1;
        let responseLogged = false;
        let timeoutId = null;
        try {
            const headers = { 'Content-Type': 'application/json', ...options.headers };
            const targetConnectionId = sessionStorage.getItem("targetConnectionId") || "";
            if (targetConnectionId && !headers["X-Target-Connection-Id"]) {
                headers["X-Target-Connection-Id"] = targetConnectionId;
            }
            const bootstrapToken = sessionStorage.getItem("initBootstrapToken") || "";
            if (bootstrapToken && !headers["X-Bootstrap-Token"]) {
                headers["X-Bootstrap-Token"] = bootstrapToken;
            }
            const controller = options.timeoutMs ? new AbortController() : null;
            if (controller) {
                timeoutId = setTimeout(() => controller.abort(), Number(options.timeoutMs));
            }
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : null,
                credentials: 'include',
                signal: options.signal || controller?.signal
            });
            
            if (!response.ok) {
                const errorJson = await response.json().catch(() => ({}));
                const errorMsg = this.formatErrorMessage(errorJson, { status: response.status, url });
                window.ConsoleLogger?.requestEnd?.(requestLog, response, { message: errorMsg });
                responseLogged = true;
                if (response.status === 401) {
                    this.handleUnauthorizedResponse(url);
                }
                throw new Error(errorMsg);
            }
            const json = await response.json();
            window.ConsoleLogger?.requestEnd?.(requestLog, response);
            responseLogged = true;
            window.PageManager?.extendSessionFromResponse?.(response);
            return json;

        } catch (err) {
            if (err?.name === "AbortError") {
                err = new Error(options.timeoutMessage || CommonUI.t("commonUi.errors.requestTimeout", "The request timed out. Check the WAS server status or network connection."));
            } else if (!responseLogged) {
                err = new Error(this.formatMainErrorMessage(err?.message || err || "Request failed.", { url }));
            }
            if (!responseLogged) {
                window.ConsoleLogger?.requestError?.(requestLog, err);
            }
            throw err;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
        }
    },

    isAuthFlowUrl(url) {
        const text = String(url || "");
        return (
            text.includes("/M91001/login")
            || text.includes("/M91001/signup/save")
            || text.includes("/M91001/admin-contact")
            || text.includes("/M91001/logout")
            || text.includes("/M91001/session/me")
        );
    },

    handleUnauthorizedResponse(url) {
        if (this.isAuthFlowUrl(url)) return;
        if (!window.PageManager?.isAuthenticated?.()) return;
        window.PageManager.resetWorkspaceForLogout?.();
        window.MenuRenderer?.render?.("mainNav", window.handleMenuClick);
        setTimeout(() => {
            window.PageManager?.load?.("login", "Data Editing System Login", false);
        }, 0);
    },

    /**
     * 서버 데이터를 가져와 지정된 콤보박스에 바인딩
     * @param {string} pageCode - 메시지를 출력할 페이지 코드
     * @param {HTMLElement} targetEl - 데이터를 채울 select 박스 요소
     * @param {string} apiUrl - 호출할 API 경로
     * @param {string} dataKey - 기본은 data
     * @param {Object} options - request 시 사용할 옵션 (method, body 등)
     * @param {string} defaultValue - 기본 선택값
     */
    async loadComboData(pageCode, targetEl, apiUrl, dataKey= 'data', options = {}, defaultValue = "") {
        if (!targetEl) return;
        
        try {
            // 1. 로딩 상태 표시
            targetEl.innerHTML = `<option value="">${CommonUI.t("commonUi.combo.loading", "Loading...")}</option>`;
            targetEl.disabled = true;

            ConsoleLogger.info("(server request)", apiUrl, 'CommonnUtils.loadComboData');

            // 2. 공통 유틸리티를 사용하여 데이터 요청
            // (CommonUtils.request가 이미 common.js에 정의되어 있다고 가정)
            const json = await this.request(apiUrl, options);

            if (json.status === 'error_db') {
                CommonUI.showPageError(pageCode, json.message || CommonUI.t("commonUi.combo.dbConnectionError", "DB connection error"));
                ConsoleLogger.error("(DB error)", apiUrl, 'CommonnUtils.loadComboData');
                targetEl.innerHTML = `<option value="">${CommonUI.t("commonUi.combo.loadFailed", "Load failed")}</option>`;
                return;
            }

            if (json.status === 'success') {
                // 3. 데이터 바인딩
                let htmlOptions = `<option value="">${CommonUI.t("commonUi.combo.select", "-- Select --")}</option>`;
                const dataList = this.extractArray(json, dataKey); // 방어적 추출

                if (Array.isArray(dataList) && dataList.length > 0) {
                    dataList.forEach(item => {
                        // CODE, NAME 필드 매핑
                        htmlOptions += `<option value="${item.CODE}">${item.NAME}</option>`;
                    });
                    targetEl.innerHTML = htmlOptions;
                    targetEl.disabled = false;
                    targetEl.classList.remove('bg-gray-50', 'cursor-not-allowed');

                    // 기본값 선택 로직
                    if (defaultValue !== "" && defaultValue !== null) {
                        targetEl.value = defaultValue;
                        
                        // 만약 설정하려는 값이 목록에 없는 경우를 대비해 체크하고 싶다면:
                        if (targetEl.selectedIndex === -1) {
                            targetEl.selectedIndex = 0; // 매칭되는 값 없으면 '선택하세요'로 복구
                        }
                    }
                }else{
                    targetEl.innerHTML = htmlOptions;
                    targetEl.disabled = false;
                    targetEl.classList.remove('bg-gray-50', 'cursor-not-allowed');
                }
                ConsoleLogger.info("(response completed)", apiUrl, 'CommonnUtils.loadComboData');
            } else {
                targetEl.innerHTML = `<option value="">${CommonUI.t("commonUi.combo.noData", "No data")}</option>`;
                targetEl.disabled = true;
            }
        } catch (e) {
            console.error("CommonUI.loadComboData Error:", e);
            CommonUI.showPageError(pageCode, CommonUI.t("commonUi.combo.loadError", "An error occurred while loading the combo box."));
            ConsoleLogger.error(`(response error) Combo box loading failed. ${e}`, apiUrl, 'loadComboData');
            targetEl.innerHTML = `<option value="">${CommonUI.t("commonUi.combo.error", "Error")}</option>`;
        }
    },

    /**
     * Server-side grid pager renderer.
     * Pages pass only state, localized labels, and callbacks so the HTML/CSS
     * contract stays identical across menus.
     */
    renderServerPager(container, options = {}) {
        if (!container) return null;

        const visible = Boolean(options.visible);
        container.hidden = !visible;
        if (!visible) {
            container.innerHTML = "";
            return null;
        }

        const page = Math.max(1, Number(options.page || 1));
        const totalPages = Math.max(1, Number(options.totalPages || 1));
        const pageSize = Math.max(1, Number(options.pageSize || 100));
        const loading = Boolean(options.loading);
        const labels = options.labels || {};
        const escape = (value) => String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        const previousLabel = labels.previousPage || "Previous page";
        const nextLabel = labels.nextPage || "Next page";
        const trailing = options.trailingNumberControl || null;
        const pageSizes = Array.from(new Set((options.pageSizes || [50, 100, 200, 500]).map((value) => Number(value)).filter((value) => value > 0)));

        container.innerHTML = `
            <div class="grid-pager" role="navigation" aria-label="${escape(labels.ariaLabel || "Grid pagination")}">
                <span class="grid-pager-total">${escape(options.totalLabel || "")}</span>
                <span class="grid-pager-navigation">
                    <button type="button" class="table-icon-btn grid-pager-prev" title="${escape(previousLabel)}" aria-label="${escape(previousLabel)}" ${loading || page <= 1 ? "disabled" : ""}>
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <label class="grid-pager-page-field">
                        <span>${escape(labels.page || "Page")}</span>
                        <input class="grid-pager-page-input" type="number" min="1" max="${totalPages}" value="${page}" ${loading ? "disabled" : ""}>
                        <small>/ <span class="grid-pager-total-pages">${totalPages.toLocaleString()}</span></small>
                    </label>
                    <button type="button" class="table-btn grid-pager-go" ${loading ? "disabled" : ""}>${escape(labels.go || "Go")}</button>
                    <button type="button" class="table-icon-btn grid-pager-next" title="${escape(nextLabel)}" aria-label="${escape(nextLabel)}" ${loading || page >= totalPages ? "disabled" : ""}>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </span>
                <span class="grid-pager-settings">
                    <select class="grid-pager-page-size" title="${escape(labels.rowsPerPage || "Rows per page")}" aria-label="${escape(labels.rowsPerPage || "Rows per page")}" ${loading ? "disabled" : ""}>
                        ${pageSizes.map((value) => `<option value="${value}"${value === pageSize ? " selected" : ""}>${value}</option>`).join("")}
                    </select>
                    ${trailing ? `
                        <label class="table-limit-control grid-pager-number-control" title="${escape(trailing.title || "")}">
                            <span>${escape(trailing.label || "")}</span>
                            <input class="grid-pager-number-input" type="number" min="${Number(trailing.min ?? 0)}" max="${Number(trailing.max ?? 999)}" value="${escape(trailing.value ?? 0)}" ${loading ? "disabled" : ""}>
                        </label>
                    ` : ""}
                </span>
            </div>
        `;

        const pageInput = container.querySelector(".grid-pager-page-input");
        container.querySelector(".grid-pager-prev")?.addEventListener("click", () => options.onMove?.(-1));
        container.querySelector(".grid-pager-next")?.addEventListener("click", () => options.onMove?.(1));
        container.querySelector(".grid-pager-go")?.addEventListener("click", () => options.onGo?.(pageInput?.value));
        pageInput?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            options.onGo?.(pageInput.value);
        });
        container.querySelector(".grid-pager-page-size")?.addEventListener("change", (event) => options.onPageSize?.(event.target.value));
        const trailingInput = container.querySelector(".grid-pager-number-input");
        if (trailingInput && trailing?.onInput) {
            ["input", "change"].forEach((eventName) => trailingInput.addEventListener(eventName, () => trailing.onInput(trailingInput.value)));
        }
        return container.querySelector(".grid-pager");
    },

    /**
     * Adds the shared column-width drag handle to a rendered table grid.
     * Dragging moves only a grid-scoped guide; the selected col width is
     * committed on pointer release so adjacent columns never get redistributed.
     */
    enableGridColumnResize(table, onResize) {
        const headerRow = table?.tHead?.rows?.[0];
        const headers = Array.from(headerRow?.cells || []);
        if (!headers.length) return;
        const columnModel = this.ensureGridColumnWidths(table, headers);

        headers.forEach((header, columnIndex) => {
            if (header.querySelector(".grid-column-resizer, .data-sql-grid-col-resizer, .column-resizer")) return;
            header.classList.add("grid-resizable-column");
            const handle = document.createElement("span");
            handle.className = "grid-column-resizer";
            handle.title = window.I18nManager?.t?.("commonUi.grid.resizeColumn", "Resize column") || "Resize column";
            handle.addEventListener("pointerdown", (event) => {
                if (event.button !== undefined && event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                const startX = event.clientX;
                const startWidth = columnModel.widths[columnIndex]
                    || header.getBoundingClientRect().width
                    || header.offsetWidth
                    || 80;
                const pointerId = event.pointerId;
                let pendingWidth = startWidth;
                let previewFrameId = null;
                const headerRect = header.getBoundingClientRect();
                const viewport = table.closest(".data-edit-grid, .table-result-grid, .grid-scroll-container, .table-scroll-container")
                    || table.parentElement;
                const tableRect = table.getBoundingClientRect();
                const viewportRect = viewport?.getBoundingClientRect?.() || tableRect;
                const guideTop = Math.max(0, headerRect.top, viewportRect.top);
                const guideBottom = Math.min(window.innerHeight, viewportRect.bottom, tableRect.bottom);
                const guide = document.createElement("div");
                guide.className = "grid-column-resize-guide";
                guide.style.left = `${headerRect.right}px`;
                guide.style.top = `${guideTop}px`;
                guide.style.height = `${Math.max(0, guideBottom - guideTop)}px`;
                document.body.appendChild(guide);
                const applyPreview = () => {
                    previewFrameId = null;
                    guide.style.transform = `translate3d(${pendingWidth - startWidth}px, 0, 0)`;
                };
                const schedulePreview = () => {
                    if (previewFrameId !== null) return;
                    previewFrameId = window.requestAnimationFrame
                        ? window.requestAnimationFrame(applyPreview)
                        : window.setTimeout(applyPreview, 0);
                };
                const updateGuide = (clientX) => {
                    pendingWidth = Math.max(48, Math.min(900, Math.round(startWidth + clientX - startX)));
                    schedulePreview();
                };
                updateGuide(event.clientX);
                const move = (moveEvent) => {
                    if (moveEvent.pointerId !== pointerId) return;
                    updateGuide(moveEvent.clientX);
                };
                const end = (endEvent) => {
                    if (endEvent.pointerId !== pointerId) return;
                    handle.removeEventListener("pointermove", move);
                    handle.removeEventListener("pointerup", end);
                    handle.removeEventListener("pointercancel", end);
                    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
                    if (endEvent.type !== "pointercancel" && Number.isFinite(endEvent?.clientX)) updateGuide(endEvent.clientX);
                    if (previewFrameId !== null) {
                        if (window.cancelAnimationFrame && window.requestAnimationFrame) {
                            window.cancelAnimationFrame(previewFrameId);
                        } else {
                            window.clearTimeout(previewFrameId);
                        }
                        previewFrameId = null;
                    }
                    applyPreview();
                    if (endEvent.type !== "pointercancel") {
                        this.setGridColumnWidth(table, columnModel, columnIndex, pendingWidth);
                        onResize?.(pendingWidth, header);
                    }
                    guide.remove();
                    document.body.classList.remove("is-column-resizing");
                };
                handle.setPointerCapture?.(pointerId);
                handle.addEventListener("pointermove", move);
                handle.addEventListener("pointerup", end);
                handle.addEventListener("pointercancel", end);
                document.body.classList.add("is-column-resizing");
            });
            header.appendChild(handle);
        });
    },

    ensureGridColumnWidths(table, headers = Array.from(table?.tHead?.rows?.[0]?.cells || [])) {
        let colgroup = Array.from(table?.children || []).find((child) => child.tagName === "COLGROUP");
        if (!colgroup) {
            colgroup = document.createElement("colgroup");
            table.insertBefore(colgroup, table.firstChild);
        }

        while (colgroup.children.length < headers.length) {
            colgroup.appendChild(document.createElement("col"));
        }
        while (colgroup.children.length > headers.length) {
            colgroup.lastElementChild.remove();
        }

        const columns = Array.from(colgroup.children);
        let widths;
        if (colgroup.dataset.gridWidthsReady === "Y") {
            widths = columns.map((column, index) => {
                const savedWidth = Number.parseFloat(column.style.width || "");
                return Math.max(48, Number.isFinite(savedWidth)
                    ? savedWidth
                    : (headers[index]?.getBoundingClientRect?.().width || 48));
            });
        } else {
            widths = headers.map((header) => Math.max(48, Math.round(
                header.getBoundingClientRect().width || header.offsetWidth || 48
            )));
            columns.forEach((column, index) => {
                column.style.width = `${widths[index]}px`;
            });
            colgroup.dataset.gridWidthsReady = "Y";
        }

        table.style.tableLayout = "fixed";
        table.style.minWidth = "0";
        table.style.width = `${Math.ceil(widths.reduce((sum, width) => sum + width, 0))}px`;
        return { colgroup, columns, widths };
    },

    setGridColumnWidth(table, columnModel, columnIndex, width) {
        const nextWidth = Math.max(48, Math.min(900, Math.round(Number(width) || 48)));
        columnModel.widths[columnIndex] = nextWidth;
        columnModel.columns[columnIndex].style.width = `${nextWidth}px`;
        table.style.width = `${Math.ceil(columnModel.widths.reduce((sum, value) => sum + value, 0))}px`;
    },

    syncGridTableWidth(table) {
        const headers = Array.from(table?.tHead?.rows?.[0]?.cells || []);
        if (!headers.length) return;
        this.ensureGridColumnWidths(table, headers);
    },

    /**
     * Shared default for table-grid renderers: a fixed No column at freeze 0
     * and user-resizable headers. Existing grids that already render No keep
     * their own row numbers and only receive the shared behavior.
     */
    applyStandardGridDefaults(table) {
        if (!table?.classList?.contains("table-grid")) return;
        if (table.classList.contains("data-edit-table") || table.classList.contains("data-sql-result-table")) return;
        const headerRow = table.tHead?.rows?.[0];
        if (!headerRow || table.dataset.standardGridReady === "Y") return;

        const originalColumnCount = headerRow.children.length;
        const hasRowNumber = headerRow.children[0]?.classList?.contains("grid-row-no");
        if (!hasRowNumber) {
            const rowOffset = Math.max(0, Number.parseInt(table.dataset.gridRowOffset || "0", 10) || 0);
            const header = document.createElement("th");
            header.className = "grid-row-no";
            header.title = "No";
            header.textContent = "No";
            headerRow.insertBefore(header, headerRow.firstChild);
            const colgroup = Array.from(table.children || []).find((child) => child.tagName === "COLGROUP");
            if (colgroup && colgroup.children.length === originalColumnCount) {
                const rowNumberColumn = document.createElement("col");
                rowNumberColumn.style.width = "48px";
                colgroup.insertBefore(rowNumberColumn, colgroup.firstChild);
            }
            Array.from(table.tBodies?.[0]?.rows || []).forEach((row, index) => {
                if (row.children.length !== originalColumnCount) return;
                const cell = document.createElement("td");
                cell.className = "grid-row-no";
                cell.textContent = String(rowOffset + index + 1);
                row.insertBefore(cell, row.firstChild);
            });
        }

        const freezeColumns = Math.max(0, Number.parseInt(table.dataset.standardGridFreezeColumns || "0", 10) || 0);
        this.enableGridColumnResize(table, () => this.applyStandardGridFreeze(table, freezeColumns));
        this.applyStandardGridFreeze(table, freezeColumns);
        table.dataset.standardGridReady = "Y";
    },

    applyStandardGridFreeze(table, dataColumnCount = 0) {
        const headerCells = Array.from(table?.tHead?.rows?.[0]?.children || []);
        if (!headerCells.length) return;
        const visibleFreezeCount = Math.min(headerCells.length, Math.max(0, Number(dataColumnCount) || 0) + 1);
        const offsets = [];
        let left = 0;
        for (let index = 0; index < visibleFreezeCount; index += 1) {
            offsets[index] = left;
            left += headerCells[index].getBoundingClientRect().width || headerCells[index].offsetWidth || 0;
        }
        Array.from(table.rows || []).forEach((row) => {
            Array.from(row.children || []).forEach((cell, index) => {
                cell.classList.remove("is-frozen-col", "is-frozen-edge");
                cell.style.left = "";
                if (index >= visibleFreezeCount) return;
                cell.classList.add("is-frozen-col");
                if (index === visibleFreezeCount - 1) cell.classList.add("is-frozen-edge");
                cell.style.left = `${offsets[index]}px`;
            });
        });
    },

    observeStandardGrids() {
        if (this._standardGridObserver || typeof MutationObserver === "undefined") return;
        const apply = (root) => {
            if (root?.matches?.("table.table-grid")) this.applyStandardGridDefaults(root);
            root?.querySelectorAll?.("table.table-grid").forEach((table) => this.applyStandardGridDefaults(table));
        };
        apply(document);
        this._standardGridObserver = new MutationObserver((records) => {
            records.forEach((record) => record.addedNodes.forEach((node) => {
                if (node.nodeType === 1) apply(node);
            }));
        });
        this._standardGridObserver.observe(document.body, { childList: true, subtree: true });
    },

    /**
     * Legacy page-number button renderer.
     * @param {*} pageArea  - 렌더링할 tbody 요소(pageArea.innerHTML = html;)
     * @param {*} totalPages 
     * @param {*} currentPage 
     * @param {*} pageCode 
     * @param {*} gridKey 
     * @returns 
     */
    renderPaging(pageArea, totalPages, currentPage, pageCode, gridKey = 'grid') {        
        if (!pageArea) return null;

        let html = '';
        for (let i = 1; i <= totalPages; i++) {
            const activeCls = i === currentPage ? 'bg-blue-600 text-white' : 'bg-white';
            html += `<button onclick="${pageCode}.renderGridPaging(${i}, '${gridKey}')" 
                            class="px-3 py-1 border rounded ${activeCls}">${i}</button>`;
        }
        pageArea.innerHTML = html;
    },

    /**
     * 표준 테이블 바디 렌더러
     * @param {HTMLElement} target - 렌더링할 tbody 요소
     * @param {Array} data - 출력할 데이터 배열
     * @param {number} colSpan - 데이터 없을 때 합칠 컬럼 수
     * @param {Function} rowRenderer - 한 행(tr)의 HTML을 반환하는 함수
     */
    renderTableBody(target, data, colSpan, rowRenderer) {
        if (!target) return;

        // 1. 에러 체크
        if (!Array.isArray(data)) {
            target.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-red-400">${CommonUI.t("commonUi.table.invalidData", "Invalid data format")}</td></tr>`;
            return;
        }

        // 2. 빈 데이터 체크
        if (data.length === 0) {
            target.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-gray-400">${CommonUI.t("commonUi.table.noData", "No data.")}</td></tr>`;
            return;
        }

        // 3. 데이터 렌더링 (rowRenderer 콜백 실행)
        target.innerHTML = data.map(row => rowRenderer(row)).join('');
    },

    // 엑셀 다운로드 공통 처리 (데이터 유무 체크 포함)
    exportExcel(data, fileName, pageCode) {
        if (!data || data.length === 0) {
            const message = CommonUI.t("commonUi.download.noData", "No data to download.");
            CommonUI.showPageError(pageCode, message);
            ConsoleLogger.error(message, `${pageCode} > ${fileName}`, 'expoortExcel')
            return;
        }
        if (window.DataEditingSystem?.downloadXLSX) {
            window.DataEditingSystem.downloadXLSX(data, `${fileName}_${new Date().getTime()}.xlsx`);
        }
    }, 

    /**
     * 공통 데이터 다운로드 (CSV/Excel)
     * @param {string} pageCode - 호출한 페이지 코드 (에러 표시용)
     * @param {Array} data - 다운로드할 JSON 데이터 배열
     * @param {string} defaultFileName - 기본 파일명
     */
    downloadData(pageCode, data, defaultFileName = 'export') {
        // 1. 데이터 유무 확인
        if (!Array.isArray(data) || data.length === 0) {
            if (typeof CommonUI !== 'undefined') {
                CommonUI.showPageError(pageCode, CommonUI.t("commonUi.download.noData", "No data to download."));
            }
            return;
        }

        // 2. 시스템 모듈 확인
        if (window.DataEditingSystem && typeof window.DataEditingSystem.downloadCSV === 'function') {
            // 파일명에 타임스탬프를 붙여 중복 방지
            const timestamp = new Date().getTime();
            const fileName = `${defaultFileName}_${timestamp}.csv`;
            
            window.DataEditingSystem.downloadCSV(data, fileName);
        } else {
            console.error("DataEditingSystem.downloadCSV module was not found.");
            if (typeof CommonUI !== 'undefined') {
                CommonUI.showPageError(pageCode, CommonUI.t("commonUi.download.systemNotLoaded", "The download system module is not loaded."));
            }
        }
    }
};

const DataEditingSystem = {
    /**
     * JSON 데이터를 CSV 파일로 변환하여 다운로드
     * @param {Array} data - 다운로드할 객체 배열
     * @param {string} fileName - 저장될 파일명
     */
    downloadCSV(data, fileName) {
        if (!data || !data.length) return;

        // 1. 헤더 추출 (첫 번째 객체의 키값)
        const headers = Object.keys(data[0]);
        
        // 2. CSV 내용 생성 (BOM 추가로 엑셀 한글 깨짐 방지)
        const csvRows = [];
        csvRows.push(headers.join(',')); // 헤더 행

        for (const row of data) {
            const values = headers.map(header => {
                const escaped = ('' + row[header]).replace(/"/g, '\\"');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        }

        const csvString = '\uFEFF' + csvRows.join('\n'); // 한글 깨짐 방지 BOM 추가
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        // 3. 가상 링크 생성 및 클릭
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    downloadXLSX(data, fileName, columnNames = []) {
        if (!Array.isArray(data) || !data.length) return;
        const columns = Array.isArray(columnNames) && columnNames.length
            ? columnNames
            : Object.keys(data[0] || {});
        const files = this.createXlsxFiles(data, columns);
        const blob = new Blob([this.createZipArchive(files)], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        this.downloadBlob(blob, fileName);
    },

    downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    createXlsxFiles(rows, columns) {
        const now = new Date().toISOString();
        const sheetRows = [
            columns,
            ...rows.map((row) => columns.map((column) => row[column] ?? ""))
        ];
        return [
            {
                path: '[Content_Types].xml',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
            },
            {
                path: '_rels/.rels',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
            },
            {
                path: 'docProps/app.xml',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>INIT Data Editing System</Application>
</Properties>`
            },
            {
                path: 'docProps/core.xml',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>INIT Data Editing System</dc:creator>
<cp:lastModifiedBy>INIT Data Editing System</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
            },
            {
                path: 'xl/workbook.xml',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
            },
            {
                path: 'xl/_rels/workbook.xml.rels',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
            },
            {
                path: 'xl/styles.xml',
                content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
            },
            {
                path: 'xl/worksheets/sheet1.xml',
                content: this.createWorksheetXml(sheetRows)
            }
        ];
    },

    createWorksheetXml(rows) {
        const xmlRows = rows.map((row, rowIndex) => {
            const rowNo = rowIndex + 1;
            const cells = row.map((value, colIndex) => {
                const ref = `${this.columnName(colIndex + 1)}${rowNo}`;
                return `<c r="${ref}" t="inlineStr"><is><t>${this.escapeXml(value)}</t></is></c>`;
            }).join("");
            return `<row r="${rowNo}">${cells}</row>`;
        }).join("");
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetData>${xmlRows}</sheetData>
</worksheet>`;
    },

    columnName(index) {
        let name = "";
        let value = Number(index) || 1;
        while (value > 0) {
            const remainder = (value - 1) % 26;
            name = String.fromCharCode(65 + remainder) + name;
            value = Math.floor((value - 1) / 26);
        }
        return name;
    },

    escapeXml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    },

    createZipArchive(files) {
        const encoder = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        let offset = 0;

        files.forEach((file) => {
            const nameBytes = encoder.encode(file.path);
            const dataBytes = encoder.encode(file.content);
            const crc = this.crc32(dataBytes);
            const localHeader = this.createLocalZipHeader(nameBytes, dataBytes, crc);
            localParts.push(localHeader, dataBytes);
            centralParts.push(this.createCentralZipHeader(nameBytes, dataBytes, crc, offset));
            offset += localHeader.length + dataBytes.length;
        });

        const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
        const endRecord = this.createEndZipRecord(files.length, centralSize, offset);
        return new Blob([...localParts, ...centralParts, endRecord]);
    },

    createLocalZipHeader(nameBytes, dataBytes, crc) {
        const header = new Uint8Array(30 + nameBytes.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, 0, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, 0, true);
        view.setUint32(14, crc, true);
        view.setUint32(18, dataBytes.length, true);
        view.setUint32(22, dataBytes.length, true);
        view.setUint16(26, nameBytes.length, true);
        view.setUint16(28, 0, true);
        header.set(nameBytes, 30);
        return header;
    },

    createCentralZipHeader(nameBytes, dataBytes, crc, offset) {
        const header = new Uint8Array(46 + nameBytes.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 0, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, 0, true);
        view.setUint16(14, 0, true);
        view.setUint32(16, crc, true);
        view.setUint32(20, dataBytes.length, true);
        view.setUint32(24, dataBytes.length, true);
        view.setUint16(28, nameBytes.length, true);
        view.setUint16(30, 0, true);
        view.setUint16(32, 0, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, 0, true);
        view.setUint32(42, offset, true);
        header.set(nameBytes, 46);
        return header;
    },

    createEndZipRecord(fileCount, centralSize, centralOffset) {
        const record = new Uint8Array(22);
        const view = new DataView(record.buffer);
        view.setUint32(0, 0x06054b50, true);
        view.setUint16(4, 0, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, fileCount, true);
        view.setUint16(10, fileCount, true);
        view.setUint32(12, centralSize, true);
        view.setUint32(16, centralOffset, true);
        view.setUint16(20, 0, true);
        return record;
    },

    crc32(bytes) {
        if (!this._crc32Table) {
            this._crc32Table = Array.from({ length: 256 }, (_, index) => {
                let value = index;
                for (let bit = 0; bit < 8; bit += 1) {
                    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
                }
                return value >>> 0;
            });
        }
        let crc = 0xffffffff;
        for (const byte of bytes) {
            crc = this._crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }
};

CommonUI.getActivePageContainer = function() {
    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection) return null;
    return activeSection.querySelector('.page-container') || activeSection;
};

CommonUI.resolveLoadingTarget = function(target) {
    if (target instanceof HTMLElement) return target;
    if (typeof target === 'string') return document.querySelector(target);

    const activePage = this.getActivePageContainer();
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const areaSelector = [
        '[data-loading-scope]',
        '.table-tab-panel.is-active',
        '.m99001-tab-panel.is-active',
        '.m91002-main-panel.is-active',
        '[data-account-panel]:not([hidden])',
        '[data-setting-panel]:not([hidden])',
        '.env-object-panel',
        '.table-object-panel',
        '.data-job-panel',
        '.data-main-panel',
        '.work-context-card',
        '.scenario-list-panel',
        '.env-panel',
        '.table-panel'
    ].join(', ');

    if (activePage && activeElement && activePage.contains(activeElement)) {
        const scopedArea = activeElement.closest(areaSelector);
        if (scopedArea && activePage.contains(scopedArea)) return scopedArea;
    }

    return activePage;
};

CommonUI.showScopedLoading = function(target, message = 'Loading...') {
    const host = this.resolveLoadingTarget(target);
    if (!host) return { type: 'global' };

    const count = Number(host.dataset.loadingCount || '0') + 1;
    host.dataset.loadingCount = String(count);
    host.classList.add('local-loading-host');

    let overlay = host.querySelector(':scope > .local-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'local-loading-overlay';
        overlay.innerHTML = `
            <div class="local-loading-box" role="status" aria-live="polite">
                <span class="local-loading-spinner" aria-hidden="true"></span>
                <span class="local-loading-text"></span>
            </div>
        `;
        host.appendChild(overlay);
    }

    const text = overlay.querySelector('.local-loading-text');
    if (text) text.textContent = message;
    overlay.hidden = false;
    return { type: 'scoped', host };
};

CommonUI.hideScopedLoading = function(token) {
    if (!token) return;
    if (token.type === 'global') {
        this.hideLoading();
        return;
    }

    const host = token.host;
    if (!host) return;

    const count = Math.max(0, Number(host.dataset.loadingCount || '1') - 1);
    if (count > 0) {
        host.dataset.loadingCount = String(count);
        return;
    }

    delete host.dataset.loadingCount;
    const overlay = host.querySelector(':scope > .local-loading-overlay');
    if (overlay) overlay.hidden = true;
};

const originalCommonRequest = CommonUtils.request.bind(CommonUtils);
CommonUtils.request = async function(url, options = {}) {
    const useLoading = options.showLoading !== false;
    let loadingTimer = null;
    let loadingToken = null;

    if (useLoading) {
        loadingTimer = setTimeout(() => {
            loadingToken = CommonUI.showScopedLoading?.(options.loadingTarget, options.loadingMessage) || { type: 'global' };
            if (loadingToken.type === 'global') CommonUI.showLoading();
        }, typeof LOADING_DELAY_MS === "number" ? LOADING_DELAY_MS : 300);
    }

    try {
        return await originalCommonRequest(url, options);
    } finally {
        if (loadingTimer) clearTimeout(loadingTimer);
        if (loadingToken) {
            if (CommonUI.hideScopedLoading) CommonUI.hideScopedLoading(loadingToken);
            else CommonUI.hideLoading();
        }
    }
};

// 전역 메시지 레이어 설정
const CommonMessage = {
    zIndex: 12000,
    activeDrag: null,
    icons: {
        info: "fas fa-circle-info",
        success: "fas fa-circle-check",
        warning: "fas fa-triangle-exclamation",
        error: "fas fa-circle-xmark",
        confirm: "fas fa-circle-question"
    },
    translations: {},
    ensureHost() {
        let host = document.getElementById("commonMessageHost");
        if (!host) {
            host = document.createElement("div");
            host.id = "commonMessageHost";
            host.className = "common-message-host";
            document.body.appendChild(host);
        }
        return host;
    },
    normalizeOptions(message, options = {}) {
        if (typeof options === "string") options = { type: options };
        const type = options.type || "info";
        const modal = Boolean(options.modal);
        const normalizedMessage = String(message ?? "");
        const isSimpleNotice = !modal
            && ["info", "success"].includes(type)
            && normalizedMessage.length <= 180
            && !/[\r\n]/.test(normalizedMessage);
        const autoCloseMs = Number.isFinite(Number(options.autoCloseMs))
            ? Math.max(0, Number(options.autoCloseMs))
            : (isSimpleNotice ? 1600 : (type === "success" && !modal ? 2800 : 0));
        const toast = Boolean(options.toast ?? (autoCloseMs > 0 && !modal && type !== "confirm"));
        return {
            type,
            title: options.title || this.defaultTitle(type),
            modal,
            toast,
            autoCloseMs,
            copyable: options.copyable !== false,
            okText: options.okText || window.I18nManager?.t?.("commonMessage.ok", "OK") || "OK",
            cancelText: options.cancelText || window.I18nManager?.t?.("commonMessage.cancel", "Cancel") || "Cancel",
            defaultAction: options.defaultAction === "cancel" ? "cancel" : "ok",
            message: normalizedMessage
        };
    },
    defaultTitle(type) {
        const fallback = {
            info: "Information",
            success: "Success",
            warning: "Warning",
            error: "Error",
            confirm: "Confirm"
        }[type] || "Message";
        return window.I18nManager?.t?.(`commonMessage.title.${type}`, fallback) || fallback;
    },
    alert(message, options = {}) {
        return this.open(this.normalizeOptions(message, options));
    },
    info(message, options = {}) {
        return this.alert(message, { ...options, type: "info" });
    },
    success(message, options = {}) {
        return this.alert(message, { ...options, type: "success" });
    },
    warn(message, options = {}) {
        return this.alert(message, { ...options, type: "warning" });
    },
    error(message, options = {}) {
        return this.alert(message, { ...options, type: "error", modal: options.modal ?? true });
    },
    inferType(message) {
        const text = String(message || "").toLowerCase();
        if (/(error|failed|fail|cannot|unable|invalid|required|denied|expired|\uC0AD\uC81C\uAC00 \uCDE8\uC18C|\uCDE8\uC18C)/.test(text)) return "error";
        if (/(select|choose|missing|empty|before|\uBA3C\uC800|\uC120\uD0DD|\uD544\uC218)/.test(text)) return "warning";
        if (/(success|saved|deleted|uploaded|completed|created|done|\uC644\uB8CC|\uC131\uACF5)/.test(text)) return "success";
        if (/(warning|cannot be undone|continue|drop|reset|truncate|delete)/.test(text)) return "warning";
        return "info";
    },
    confirm(message, options = {}) {
        return this.open(this.normalizeOptions(message, { ...options, type: "confirm", modal: true }));
    },
    open(options) {
        const host = this.ensureHost();
        const overlay = options.modal ? document.createElement("div") : null;
        const popup = document.createElement("section");
        const bodyId = `common-message-body-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        if (overlay) {
            overlay.className = "common-message-overlay";
            overlay.style.zIndex = String(++this.zIndex);
            host.appendChild(overlay);
        }
        popup.className = `common-message-popup is-${options.type}${options.modal ? " is-modal" : " is-modeless"}${options.toast ? " is-toast" : ""}`;
        popup.style.zIndex = String(++this.zIndex);
        popup.setAttribute("role", options.type === "confirm" || options.modal ? "dialog" : "status");
        popup.setAttribute("aria-modal", String(Boolean(options.modal)));
        popup.setAttribute("aria-describedby", bodyId);
        const copyButtonHtml = options.copyable
            ? `<button type="button" class="common-message-secondary" data-common-message-action="copy"><i class="fas fa-copy"></i><span>${this.escapeHtml(window.I18nManager?.t?.("commonMessage.copy", "Copy") || "Copy")}</span></button>`
            : "";
        const confirmButtons = options.type === "confirm"
            ? `
                <button type="button" class="common-message-secondary common-message-confirm-action${options.defaultAction === "ok" ? " is-default-action" : ""}" data-common-message-action="ok"${options.defaultAction === "ok" ? " autofocus" : ""}>${this.escapeHtml(options.okText)}</button>
                <button type="button" class="common-message-secondary common-message-confirm-action${options.defaultAction === "cancel" ? " is-default-action" : ""}" data-common-message-action="cancel"${options.defaultAction === "cancel" ? " autofocus" : ""}>${this.escapeHtml(options.cancelText)}</button>
                ${copyButtonHtml}
            `
            : `<button type="button" class="common-message-primary" data-common-message-action="ok">${this.escapeHtml(options.okText)}</button>`;
        const footerHtml = options.toast ? "" : `
            <footer class="common-message-footer">
                ${confirmButtons}
                ${options.type === "confirm" ? "" : copyButtonHtml}
            </footer>
        `;
        popup.innerHTML = `
            <header class="common-message-header">
                <span class="common-message-icon"><i class="${this.icons[options.type] || this.icons.info}"></i></span>
                <strong>${this.escapeHtml(options.title)}</strong>
                <button type="button" class="common-message-tool" data-common-message-action="close" title="${this.escapeHtml(window.I18nManager?.t?.("commonMessage.close", "Close") || "Close")}">
                    <i class="fas fa-times"></i>
                </button>
            </header>
            <div id="${bodyId}" class="common-message-body" tabindex="0">${this.formatMessage(options.message)}</div>
            ${footerHtml}
        `;
        host.appendChild(popup);
        this.positionPopup(popup, options.modal);
        this.bindDrag(popup);
        return new Promise((resolve) => {
            let closed = false;
            let autoCloseTimer = null;
            const handleKeydown = (event) => {
                if (event.key === "Escape") cleanup(options.type !== "confirm");
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) cleanup(true);
                if (options.modal && event.key === "Tab") {
                    this.handleModalTabKey(event, popup);
                }
            };
            const cleanup = (result) => {
                if (closed) return;
                closed = true;
                if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
                document.removeEventListener("keydown", handleKeydown, true);
                popup.remove();
                overlay?.remove();
                resolve(result);
            };
            popup.querySelector('[data-common-message-action="ok"]')?.addEventListener("click", () => cleanup(true));
            popup.querySelector('[data-common-message-action="cancel"]')?.addEventListener("click", () => cleanup(false));
            popup.querySelector('[data-common-message-action="close"]')?.addEventListener("click", () => cleanup(options.type !== "confirm"));
            popup.querySelector('[data-common-message-action="copy"]')?.addEventListener("click", async (event) => {
                await this.copyText(this.buildDisplayText(options.message));
                const button = event.currentTarget;
                const original = button.innerHTML;
                const copiedText = this.escapeHtml(window.I18nManager?.t?.("commonMessage.copied", "Copied") || "Copied");
                button.innerHTML = `<i class="fas fa-check"></i><span>${copiedText}</span>`;
                setTimeout(() => {
                    if (button.isConnected) button.innerHTML = original;
                }, 1200);
            });
            popup.addEventListener("keydown", handleKeydown);
            if (options.modal) document.addEventListener("keydown", handleKeydown, true);
            if (options.toast && options.autoCloseMs > 0) {
                const startAutoClose = () => {
                    if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
                    autoCloseTimer = window.setTimeout(() => cleanup(true), options.autoCloseMs);
                };
                popup.addEventListener("pointerenter", () => {
                    if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
                    autoCloseTimer = null;
                });
                popup.addEventListener("pointerleave", startAutoClose);
                startAutoClose();
            } else {
                window.setTimeout(() => {
                    const focusTarget = options.type === "confirm"
                        ? popup.querySelector(`[data-common-message-action="${options.defaultAction}"]`)
                        : popup.querySelector(".common-message-primary");
                    focusTarget?.focus({ preventScroll: true });
                }, 30);
            }
        });
    },
    getFocusableElements(root) {
        return Array.from(root.querySelectorAll([
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "[tabindex]:not([tabindex='-1'])"
        ].join(","))).filter((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0
                && rect.height > 0
                && style.visibility !== "hidden"
                && style.display !== "none";
        });
    },
    handleModalTabKey(event, popup) {
        const focusable = this.getFocusableElements(popup);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!popup.contains(active)) {
            event.preventDefault();
            const entryTarget = event.shiftKey
                ? last
                : (popup.querySelector("[data-common-message-action='ok'], .common-message-primary") || first);
            entryTarget.focus();
            return;
        }
        if (event.shiftKey) {
            if (active === first) {
                event.preventDefault();
                last.focus();
            }
            return;
        }
        if (active === last) {
            event.preventDefault();
            first.focus();
        }
    },
    positionPopup(popup, isModal) {
        popup.style.left = "";
        popup.style.top = "";
        popup.style.right = "";
        popup.style.transform = "";
        if (isModal) {
            popup.classList.add("is-centered");
            return;
        }
        popup.style.right = "22px";
        const headerRect = document.querySelector(".content-header")?.getBoundingClientRect();
        const baseTop = headerRect ? Math.max(22, Math.ceil(headerRect.bottom + 12)) : 22;
        popup.style.top = `${baseTop + document.querySelectorAll(".common-message-popup.is-modeless").length * 14}px`;
    },
    bindDrag(popup) {
        const header = popup.querySelector(".common-message-header");
        if (!header) return;
        header.addEventListener("pointerdown", (event) => {
            if (event.target.closest("button")) return;
            const rect = popup.getBoundingClientRect();
            popup.classList.remove("is-centered");
            popup.style.transform = "none";
            popup.style.right = "auto";
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${rect.top}px`;
            this.activeDrag = { popup, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
            header.setPointerCapture?.(event.pointerId);
        });
        header.addEventListener("pointermove", (event) => {
            if (!this.activeDrag || this.activeDrag.popup !== popup) return;
            const nextLeft = this.activeDrag.left + event.clientX - this.activeDrag.startX;
            const nextTop = this.activeDrag.top + event.clientY - this.activeDrag.startY;
            popup.style.left = `${Math.max(8, Math.min(window.innerWidth - popup.offsetWidth - 8, nextLeft))}px`;
            popup.style.top = `${Math.max(8, Math.min(window.innerHeight - popup.offsetHeight - 8, nextTop))}px`;
        });
        header.addEventListener("pointerup", () => {
            this.activeDrag = null;
        });
    },
    async copyText(text) {
        const value = String(text ?? "");
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                return;
            } catch (error) {
                // Fall back to a selected textarea when Clipboard API is blocked.
            }
        }
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        textarea.style.opacity = "0";
        textarea.setAttribute("readonly", "readonly");
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) {
            throw new Error("Clipboard copy failed.");
        }
    },
    escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },
    hasKorean(value) {
        return /[\uAC00-\uD7A3]/.test(String(value ?? ""));
    },
    normalizeMessageKey(message) {
        return String(message ?? "").replace(/\s+/g, " ").trim();
    },
    formatTemplate(template, values = {}) {
        return String(template ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : match
        ));
    },
    translatePattern(key, fallback = "", values = {}) {
        const template = window.I18nManager?.t?.(`messagePatterns.${key}`, fallback) || fallback;
        return this.formatTemplate(template, values);
    },
    translateMessage(message) {
        const original = String(message ?? "");
        const key = this.normalizeMessageKey(original);
        if (!key || this.hasKorean(key)) return "";
        if (window.I18nManager?.getCurrentLanguage?.() !== "ko") return "";
        const i18nMessage = window.I18nManager?.translateMessage?.(original);
        if (i18nMessage) return i18nMessage;
        if (this.translations[key]) return this.translations[key];
        const patterns = [
            [
                /^You are about to (.+)\.\n{2,}All open pages will be closed and unsaved work may be lost\.\nAny open target DB session will be rolled back and closed before continuing\.(?:\n{2,}There are (\d+) request\(s\) still running\. The app will wait briefly before cleanup\.)?\n{2,}Continue\?$/,
                (m) => {
                    const actionMap = {
                        logout: this.translatePattern("actions.logout", "logout"),
                        "change Target DB": this.translatePattern("actions.changeTargetDb", "change Target DB"),
                        "change target DB": this.translatePattern("actions.changeTargetDb", "change target DB"),
                        "close this page": this.translatePattern("actions.closeThisPage", "close this page"),
                        "close all pages": this.translatePattern("actions.closeAllPages", "close all pages"),
                        continue: this.translatePattern("actions.continue", "continue")
                    };
                    const action = actionMap[m[1]] || m[1];
                    const requestWarning = m[2]
                        ? this.translatePattern("pendingRequests", "There are {count} request(s) still running. The app will wait briefly before cleanup.", { count: m[2] })
                        : "";
                    return this.translatePattern(
                        "transitionWarning",
                        "You are about to {action}.\n\nAll open pages will be closed and unsaved work may be lost.\nAny open target DB session will be rolled back and closed before continuing.{requestWarningBlock}\n\nContinue?",
                        { action, requestWarningBlock: requestWarning ? `\n\n${requestWarning}` : "" }
                    );
                }
            ],
            [/^Delete project "(.+)"\?$/, (m) => this.translatePattern("deleteProject", "\"{name}\" project will be deleted. Continue?", { name: m[1] })],
            [/^Delete scenario "(.+)"\?$/, (m) => this.translatePattern("deleteScenario", "\"{name}\" scenario will be deleted. Continue?", { name: m[1] })],
            [/^Delete all scenarios for "(.+)"\?$/, (m) => this.translatePattern("deleteAllScenarios", "Delete all scenarios for \"{name}\"?", { name: m[1] })],
            [/^(.+) table will be dropped\. Continue\?$/, (m) => this.translatePattern("tableDropContinue", "{name} table will be dropped. Continue?", { name: m[1] })],
            [/^Delete table "(.+)" from this scenario\?$/, (m) => this.translatePattern("deleteScenarioTable", "Delete table \"{name}\" from this scenario?", { name: m[1] })],
            [/^(.+) scenario tables deleted\.$/, (m) => this.translatePattern("scenarioTablesDeleted", "{count} scenario tables deleted.", { count: m[1] })],
            [/^(.+) scenarios deleted\.$/, (m) => this.translatePattern("scenariosDeleted", "{count} scenarios deleted.", { count: m[1] })],
            [/^(.+) items saved\.$/, (m) => this.translatePattern("itemsSaved", "{count} items saved.", { count: m[1] })],
            [/^(.+) object and (.+) detail rows deleted\.(.*)$/, (m) => this.translatePattern("objectDetailRowsDeleted", "{objectCount} object and {detailCount} detail rows deleted.{suffix}", { objectCount: m[1], detailCount: m[2], suffix: m[3] ? ` ${m[3]}` : "" })],
            [/^Delete setting "(.+)"\?$/, (m) => this.translatePattern("deleteSetting", "Delete setting \"{name}\"?", { name: m[1] })],
            [/^Delete notice "(.+)"\?$/, (m) => this.translatePattern("deleteNotice", "Delete notice \"{name}\"?", { name: m[1] })],
            [/^(.+) jobs (.+)\. (.+) failed\.$/, (m) => this.translatePattern("jobsActionFailed", "{count} jobs {action}. {failed} failed.", { count: m[1], action: this.translatePattern(`jobActions.${m[2]}`, m[2]), failed: m[3] })],
            [/^Delete (.+)\?\nNodes, edges, and run history for this flow will also be deleted\.$/, (m) => this.translatePattern("deleteFlow", "Delete {name}?\nNodes, edges, and run history for this flow will also be deleted.", { name: m[1] })],
            [/^(.+)\nFlow ID: (.+)$/, (m) => this.translatePattern("flowIdLine", "{message}\nFlow ID: {flowId}", { message: this.translateMessage(m[1]) || m[1], flowId: m[2] })]
        ];
        for (const [regex, translator] of patterns) {
            const match = original.match(regex);
            if (match) return translator(match);
        }
        return "";
    },
    buildMessageParts(message) {
        const original = String(message ?? "");
        const translated = this.translateMessage(original);
        return { original, translated };
    },
    buildDisplayText(message) {
        const { original, translated } = this.buildMessageParts(message);
        return translated || original;
    },
    formatMessage(message) {
        const { original, translated } = this.buildMessageParts(message);
        const displayText = translated || original;
        const displayHtml = this.escapeHtml(displayText).replace(/\r?\n/g, "<br>");
        return `<div class="common-message-original">${displayHtml}</div>`;
    }
};

const DialogFocusManager = {
    focusableSelector: [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])"
    ].join(","),
    init() {
        if (this.initialized) return;
        this.initialized = true;
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Tab") return;
            const dialog = this.getTopModalDialog();
            if (!dialog) return;
            this.trapTab(event, dialog);
        }, true);
    },
    getTopModalDialog() {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
            .filter((dialog) => {
                if (dialog.closest(".common-message-popup")) return false;
                if (dialog.hidden || dialog.getAttribute("aria-hidden") === "true") return false;
                const layer = dialog.closest("[hidden]");
                if (layer) return false;
                const rect = dialog.getBoundingClientRect();
                const style = window.getComputedStyle(dialog);
                return rect.width > 0
                    && rect.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden";
            });
        return dialogs.length ? dialogs[dialogs.length - 1] : null;
    },
    getFocusableElements(dialog) {
        return Array.from(dialog.querySelectorAll(this.focusableSelector)).filter((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0
                && rect.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden";
        });
    },
    trapTab(event, dialog) {
        const focusable = this.getFocusableElements(dialog);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!dialog.contains(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
            return;
        }
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
            return;
        }
        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }
};

window.CommonUI = CommonUI;
window.CommonUtils = CommonUtils;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => CommonUtils.observeStandardGrids(), { once: true });
} else {
    CommonUtils.observeStandardGrids();
}
window.CommonMessage = CommonMessage;
window.DialogFocusManager = DialogFocusManager;
DialogFocusManager.init();
window.alert = (message) => {
    CommonMessage.alert(message, { type: CommonMessage.inferType(message) });
};
// 전역 객체로 노출 (M00000.js에서 참조 가능하도록)
window.DataEditingSystem = DataEditingSystem;
window.showLoading = () => CommonUI.showLoading();
window.hideLoading = () => CommonUI.hideLoading();
window.showPageError = (pid, msg) => CommonUI.showPageError(pid,msg);
window.showPageSuccess = (pid, msg) => CommonUI.showPageSuccess(pid, msg);
window.hidePageMessage = (pid) => CommonUI.hidePageMessage(pid);
window.clearInputs = (id) => CommonUI.clearInputs(id);

// M00000.js에서 호출하는 핵심 함수 연결
window.createGrid = function(el, options) {
    return CommonUI.createGrid(el, options);
};
