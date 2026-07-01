/**
 * common.js: 시스템 전역 공통 유틸리티
 */
const CommonUI = {
    // --- [로딩바 제어 영역] ---
    /**
     * 동기식 작업 시 화면을 차단하고 로딩바를 표시
     * [요구사항 8] 반영
     */
    showLoading() {
        const loader = document.getElementById('customLoadingBar');
        if (loader) {
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
            console.error("Grid.js 라이브러리가 로드되지 않았습니다.");
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
                        '<i class="fas fa-angle-double-left" title="맨 처음"></i>'
                    ),
                    // 이전 버튼
                    prev: document.createRange().createContextualFragment(
                        '<i class="fas fa-angle-left" title="이전"></i>'
                    ),
                    // 다음 버튼
                    next: document.createRange().createContextualFragment(
                        '<i class="fas fa-angle-right" title="다음"></i>'
                    ),
                    // 맨 끝 버튼
                    last: document.createRange().createContextualFragment(
                        '<i class="fas fa-angle-double-right" title="맨 끝"></i>'
                    )
                }
            },
            sort: false,
            // 한국어 메시지 설정
            language: {
                'pagination': {
                    'first': '맨처음',
                    'previous': '이전',
                    'next': '다음',
                    'last': '맨끝',
                    'showing': '검색 결과',
                    'results': () => '건',
                    'of': '/',
                    'to': '-'
                },
                'noRecordsFound': '조회된 데이터가 없습니다.',
                'loading': '데이터를 불러오는 중...',
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
            console.error(`Grid Container를 찾을 수 없습니다. (GridKey: ${gridKey})`);
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
            if (columnsData.length === 0) columnsData = ['조회결과'];
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

            console.log("행 선택 완료:", tr);
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
                el.innerHTML = '<option value="">-- 선택하세요 --</option>';
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
            if (raw.length > 160) return `${friendly}\n상세: ${raw.slice(0, 160)}...`;
            return `${friendly}\n상세: ${raw}`;
        };

        if (status === 404) {
            return isApiRequest
                ? "요청한 기능(API)을 찾을 수 없습니다. 화면과 서버 버전이 맞는지 확인해 주세요."
                : "요청한 페이지 파일을 찾을 수 없습니다. 화면 파일 연결 상태를 확인해 주세요.";
        }

        if ([502, 503, 504].includes(status)) {
            return "WAS 서버가 응답하지 않습니다. 서버 실행 상태 또는 네트워크 연결을 확인해 주세요.";
        }

        if (
            lower.includes("failed to fetch")
            || lower.includes("networkerror")
            || lower.includes("network error")
            || lower.includes("load failed")
            || lower.includes("connection refused")
            || lower.includes("err_connection_refused")
        ) {
            return "WAS 서버에 연결할 수 없습니다. 서버가 실행 중인지와 접속 주소를 확인해 주세요.";
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
            return appendDetail("Target DB에 접속할 수 없습니다. DB 서버 주소, 서비스명, 포트, 네트워크 상태를 확인해 주세요.");
        }

        if (status >= 500) {
            return appendDetail("서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.");
        }

        return raw || "요청을 처리하지 못했습니다.";
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
            const loginUser = JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
            if (loginUser.userId && !headers["X-Login-User-Id"]) {
                headers["X-Login-User-Id"] = String(loginUser.userId);
            }
            if (loginUser.loginId && !headers["X-Login-Id"]) {
                headers["X-Login-Id"] = String(loginUser.loginId);
            }
            if (loginUser.email && !headers["X-Login-Email"]) {
                headers["X-Login-Email"] = String(loginUser.email);
            }
            if (loginUser.roleCode && !headers["X-Login-Role-Code"]) {
                headers["X-Login-Role-Code"] = String(loginUser.roleCode);
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
                signal: options.signal || controller?.signal
            });
            
            if (!response.ok) {
                const errorJson = await response.json().catch(() => ({}));
                const errorMsg = this.formatErrorMessage(errorJson, { status: response.status, url });
                window.ConsoleLogger?.requestEnd?.(requestLog, response, { message: errorMsg });
                responseLogged = true;
                throw new Error(errorMsg);
            }
            const json = await response.json();
            window.ConsoleLogger?.requestEnd?.(requestLog, response);
            responseLogged = true;
            window.PageManager?.extendSession?.();
            return json;

        } catch (err) {
            if (err?.name === "AbortError") {
                err = new Error(options.timeoutMessage || "요청 시간이 초과되었습니다. WAS 서버 상태 또는 네트워크 연결을 확인해 주세요.");
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
            targetEl.innerHTML = '<option value="">로딩 중...</option>';
            targetEl.disabled = true;

            ConsoleLogger.info("(서버요청)", apiUrl, 'CommonnUtils.loadComboData');

            // 2. 공통 유틸리티를 사용하여 데이터 요청
            // (CommonUtils.request가 이미 common.js에 정의되어 있다고 가정)
            const json = await this.request(apiUrl, options);

            if (json.status === 'error_db') {
                CommonUI.showPageError(pageCode, json.message || "DB 연결 오류");
                ConsoleLogger.error("(DB오류)", apiUrl, 'CommonnUtils.loadComboData');
                targetEl.innerHTML = '<option value="">조회 실패</option>';
                return;
            }

            if (json.status === 'success') {
                // 3. 데이터 바인딩
                let htmlOptions = '<option value="">-- 선택하세요 --</option>';
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
                ConsoleLogger.info("(응답완료)", apiUrl, 'CommonnUtils.loadComboData');
            } else {
                targetEl.innerHTML = '<option value="">데이터 없음</option>';
                targetEl.disabled = true;
            }
        } catch (e) {
            console.error("CommonUI.loadComboData Error:", e);
            CommonUI.showPageError(pageCode, "콤보박스 로딩 중 오류가 발생했습니다.");
            ConsoleLogger.error(`(응답오류)콤보박스 로딩 중 오류가 발생했습니다.${e}`, apiUrl, 'loadComboData');
            targetEl.innerHTML = '<option value="">에러 발생</option>';
        }
    },

    /**
     * 공통 페이징 HTML 생성기 (디자인 통일)
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
            target.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-red-400">데이터 형식 오류</td></tr>`;
            return;
        }

        // 2. 빈 데이터 체크
        if (data.length === 0) {
            target.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>`;
            return;
        }

        // 3. 데이터 렌더링 (rowRenderer 콜백 실행)
        target.innerHTML = data.map(row => rowRenderer(row)).join('');
    },

    // 엑셀 다운로드 공통 처리 (데이터 유무 체크 포함)
    exportExcel(data, fileName, pageCode) {
        if (!data || data.length === 0) {
            CommonUI.showPageError(pageCode, "다운로드할 데이터가 없습니다.");
            ConsoleLogger.error("다운로드할 데이터가 없습니다.", `${pageCode} > ${fileName}`, 'expoortExcel')
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
                CommonUI.showPageError(pageCode, "다운로드할 데이터가 없습니다.");
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
            console.error("DataEditingSystem.downloadCSV 모듈을 찾을 수 없습니다.");
            if (typeof CommonUI !== 'undefined') {
                CommonUI.showPageError(pageCode, "다운로드 시스템 모듈이 로드되지 않았습니다.");
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
    translations: {
        "Some requests are still running. Continue cleanup anyway?": "아직 실행 중인 요청이 있습니다. 그래도 정리를 계속하시겠습니까?",
        "Session expired. Please log in again.": "세션이 만료되었습니다. 다시 로그인하세요.",
        "Please log in first.": "먼저 로그인하세요.",
        "There are no open pages.": "열려 있는 페이지가 없습니다.",
        "Select a target DB.": "대상 DB를 선택하세요.",
        "Target DB change failed.": "대상 DB 변경에 실패했습니다.",
        "Project is required.": "프로젝트를 선택하세요.",
        "Scenario is required.": "시나리오를 선택하세요.",
        "Project detail load failed.": "프로젝트 상세 정보를 불러오지 못했습니다.",
        "Project name is required.": "프로젝트 이름을 입력하세요.",
        "Project code is required.": "프로젝트 코드를 입력하세요.",
        "Project saved.": "프로젝트가 저장되었습니다.",
        "Project save failed.": "프로젝트 저장에 실패했습니다.",
        "Select a saved project before deleting.": "삭제할 저장된 프로젝트를 먼저 선택하세요.",
        "Project deleted.": "프로젝트가 삭제되었습니다.",
        "Project delete failed.": "프로젝트 삭제에 실패했습니다.",
        "Select a project first.": "프로젝트를 먼저 선택하세요.",
        "Scenario detail load failed.": "시나리오 상세 정보를 불러오지 못했습니다.",
        "Scenario name is required.": "시나리오 이름을 입력하세요.",
        "Scenario code is required.": "시나리오 코드를 입력하세요.",
        "Scenario saved.": "시나리오가 저장되었습니다.",
        "Scenario save failed.": "시나리오 저장에 실패했습니다.",
        "Select a saved scenario before deleting.": "삭제할 저장된 시나리오를 먼저 선택하세요.",
        "Scenario deleted.": "시나리오가 삭제되었습니다.",
        "Scenario delete failed.": "시나리오 삭제에 실패했습니다.",
        "There are no scenarios to delete.": "삭제할 시나리오가 없습니다.",
        "Select a file first.": "파일을 먼저 선택하세요.",
        "File uploaded.": "파일이 업로드되었습니다.",
        "Upload failed.": "업로드에 실패했습니다.",
        "Enter a table ID first.": "테이블 ID를 먼저 입력하세요.",
        "Only upload tables starting with INITUP$_ can be deleted.": "INITUP$_로 시작하는 업로드 테이블만 삭제할 수 있습니다.",
        "Upload table deleted.": "업로드 테이블이 삭제되었습니다.",
        "Delete failed.": "삭제에 실패했습니다.",
        "Delete canceled.": "삭제가 취소되었습니다.",
        "Select a table from Table Explorer first.": "먼저 Table Explorer에서 테이블을 선택하세요.",
        "Click Add selected first, then select a scenario table to save.": "먼저 Add selected를 클릭한 뒤 저장할 시나리오 테이블을 선택하세요.",
        "Scenario table saved.": "시나리오 테이블이 저장되었습니다.",
        "Scenario table save failed.": "시나리오 테이블 저장에 실패했습니다.",
        "Select a scenario table to delete.": "삭제할 시나리오 테이블을 선택하세요.",
        "Scenario table deleted.": "시나리오 테이블이 삭제되었습니다.",
        "Scenario table delete failed.": "시나리오 테이블 삭제에 실패했습니다.",
        "There are no scenario tables to delete.": "삭제할 시나리오 테이블이 없습니다.",
        "No grid data to export.": "내보낼 그리드 데이터가 없습니다.",
        "Rows are based on the selected DB object and cannot be added manually.": "행은 선택한 DB 객체 기준으로 생성되므로 수동으로 추가할 수 없습니다.",
        "Rows are based on the selected DB object and cannot be deleted manually.": "행은 선택한 DB 객체 기준으로 생성되므로 수동으로 삭제할 수 없습니다.",
        "Select a table or procedure before saving.": "저장하기 전에 테이블 또는 프로시저를 선택하세요.",
        "Save failed. Check the console for details.": "저장에 실패했습니다. 자세한 내용은 콘솔을 확인하세요.",
        "Select a registered object before deleting.": "삭제할 등록 객체를 먼저 선택하세요.",
        "This object is not registered.": "등록되지 않은 객체입니다.",
        "Delete selected DB connection profile?": "선택한 DB 접속 프로필을 삭제하시겠습니까?",
        "Delete the database connection currently in use?": "현재 사용 중인 데이터베이스 접속을 삭제하시겠습니까?",
        "Please log in again.": "다시 로그인하세요.",
        "Install INIT system tables and create the first administrator account?": "INIT 시스템 테이블을 설치하고 최초 관리자 계정을 생성하시겠습니까?",
        "Install application tables on the selected target database?": "선택한 대상 데이터베이스에 애플리케이션 테이블을 설치하시겠습니까?",
        "Reset all application data in the selected target database? Tables remain, but data will be truncated.": "선택한 대상 데이터베이스의 모든 애플리케이션 데이터를 초기화하시겠습니까? 테이블은 유지되고 데이터만 삭제됩니다.",
        "This cannot be undone. Continue target data reset?": "이 작업은 되돌릴 수 없습니다. 대상 데이터 초기화를 계속하시겠습니까?",
        "Deploy PL/SQL model objects on the selected target database?": "선택한 대상 데이터베이스에 PL/SQL 모델 객체를 배포하시겠습니까?",
        "Basic installation is complete. Move to the login screen?": "기본 설치가 완료되었습니다. 로그인 화면으로 이동하시겠습니까?",
        "Prepare machine learning seed data on the selected target database?": "선택한 대상 데이터베이스에 머신러닝 seed 데이터를 준비하시겠습니까?",
        "Train or install machine learning models on the selected target database?": "선택한 대상 데이터베이스에서 머신러닝 모델을 학습 또는 설치하시겠습니까?",
        "Change your email?": "이메일을 변경하시겠습니까?",
        "Change your login password?": "로그인 비밀번호를 변경하시겠습니까?",
        "Create missing INIT$_ system tables on the current system database?": "현재 시스템 데이터베이스에 누락된 INIT$_ 시스템 테이블을 생성하시겠습니까?",
        "Reset all INIT system data? Users, target DB connections, settings, and setup logs will be truncated.": "모든 INIT 시스템 데이터를 초기화하시겠습니까? 사용자, 대상 DB 접속, 설정, 설정 로그가 삭제됩니다.",
        "This cannot be undone and may require system setup again. Continue system data reset?": "이 작업은 되돌릴 수 없으며 시스템 설정을 다시 해야 할 수 있습니다. 시스템 데이터 초기화를 계속하시겠습니까?",
        "Clear all rows from INIT system tables? Users, target DB connections, settings, and setup logs will be truncated. Tables will not be dropped.": "INIT 시스템 테이블의 모든 데이터를 비우시겠습니까? 사용자, 대상 DB 접속 정보, 설정, 설정 로그가 삭제됩니다. 테이블은 DROP되지 않습니다.",
        "Clear all rows from INIT system tables? Notices, users, target DB connections, settings, and setup logs will be truncated. Tables will not be dropped.": "INIT 시스템 테이블의 모든 데이터를 비우시겠습니까? 공지사항, 사용자, 대상 DB 접속 정보, 설정, 설정 로그가 삭제됩니다. 테이블은 DROP되지 않습니다.",
        "This cannot be undone and may require system setup again. Continue clearing INIT system table data?": "이 작업은 되돌릴 수 없으며 시스템 설정을 다시 해야 할 수 있습니다. INIT 시스템 테이블 데이터 비우기를 계속하시겠습니까?",
        "Approve all pending users in the current result?": "현재 결과의 모든 승인 대기 사용자를 승인하시겠습니까?",
        "Approve selected user(s)?": "선택한 사용자를 승인하시겠습니까?",
        "Select at least one user to reset password.": "비밀번호를 초기화할 사용자를 하나 이상 선택하세요.",
        "Reset password for selected user(s)? Temporary passwords will be shown only once.": "선택한 사용자의 비밀번호를 초기화하시겠습니까? 임시 비밀번호는 한 번만 표시됩니다.",
        "Password reset completed.": "비밀번호 초기화가 완료되었습니다.",
        "Deactivate the selected user(s)? USE_YN will be changed to N.": "선택한 사용자를 비활성화하시겠습니까? USE_YN이 N으로 변경됩니다.",
        "Delete your saved Gemini API key?": "저장된 Gemini API 개인 인증키를 삭제하시겠습니까?",
        "Save this work?": "이 작업을 저장하시겠습니까?",
        "Work saved.": "작업이 저장되었습니다.",
        "Work save failed.": "작업 저장에 실패했습니다.",
        "Save work first, then run the saved work.": "먼저 작업을 저장한 뒤 저장된 작업을 실행하세요.",
        "Job submitted.": "작업이 제출되었습니다.",
        "Job run failed.": "작업 실행에 실패했습니다.",
        "No enabled saved jobs to execute.": "실행 가능한 저장 작업이 없습니다.",
        "Select a scenario table first.": "시나리오 테이블을 먼저 선택하세요.",
        "Job Name is required.": "작업명을 입력하세요.",
        "Job Group is required.": "작업 그룹을 입력하세요.",
        "Registered Model / Procedure is required.": "등록 모델/프로시저를 선택하세요.",
        "Executable PL/SQL script is required. Generate or enter the script first.": "실행 가능한 PL/SQL 스크립트가 필요합니다. 먼저 생성하거나 입력하세요.",
        "Result Owner is required when Result Table Create is T or M.": "결과 사용 방식이 T 또는 M이면 결과 Owner를 입력해야 합니다.",
        "Result Table is required when Result Table Create is T or M.": "결과 사용 방식이 T 또는 M이면 결과 테이블/모델명을 입력해야 합니다.",
        "Result Table is required.": "결과 테이블명을 입력하세요.",
        "SQL result table was created.": "SQL 결과 테이블이 생성되었습니다.",
        "SQL result table save failed.": "SQL 결과 테이블 저장에 실패했습니다.",
        "Flow load failed.": "플로우를 불러오지 못했습니다.",
        "Drag from an output port to an input port to connect nodes.": "출력 포트에서 입력 포트로 드래그해 노드를 연결하세요.",
        "Select project and scenario first.": "프로젝트와 시나리오를 먼저 선택하세요.",
        "Flow saved.": "플로우가 저장되었습니다.",
        "Flow save failed.": "플로우 저장에 실패했습니다.",
        "Select a saved flow first.": "저장된 플로우를 먼저 선택하세요.",
        "Flow deleted.": "플로우가 삭제되었습니다.",
        "Flow delete failed.": "플로우 삭제에 실패했습니다.",
        "Flow validation succeeded.": "플로우 검증에 성공했습니다.",
        "Flow validation failed.": "플로우 검증에 실패했습니다.",
        "Flow run recorded.": "플로우 실행 이력이 기록되었습니다.",
        "Flow run failed.": "플로우 실행에 실패했습니다.",
        "Notice title is required.": "공지사항 제목을 입력하세요.",
        "Notice saved.": "공지사항이 저장되었습니다.",
        "Notice save failed.": "공지사항 저장에 실패했습니다.",
        "Notice deleted.": "공지사항이 삭제되었습니다.",
        "Notice delete failed.": "공지사항 삭제에 실패했습니다.",
        "Select a saved notice before deleting.": "삭제할 저장된 공지사항을 먼저 선택하세요.",
        "Notice was not found.": "공지사항을 찾을 수 없습니다.",
        "Notice type is invalid.": "공지사항 유형이 올바르지 않습니다.",
        "Y/N value is invalid.": "Y/N 값이 올바르지 않습니다.",
        "Post start date must be before post end date.": "게시 시작일은 게시 종료일보다 이전이어야 합니다.",
        "Popup start date must be before popup end date.": "팝업 시작일은 팝업 종료일보다 이전이어야 합니다."
    },
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
        const autoCloseMs = Number.isFinite(Number(options.autoCloseMs))
            ? Math.max(0, Number(options.autoCloseMs))
            : (type === "success" && !modal ? 2800 : 0);
        const toast = Boolean(options.toast ?? (autoCloseMs > 0 && !modal && type !== "confirm"));
        return {
            type,
            title: options.title || this.defaultTitle(type),
            modal,
            toast,
            autoCloseMs,
            copyable: options.copyable !== false,
            okText: options.okText || "OK",
            cancelText: options.cancelText || "Cancel",
            message: String(message ?? "")
        };
    },
    defaultTitle(type) {
        return {
            info: "Information",
            success: "Success",
            warning: "Warning",
            error: "Error",
            confirm: "Confirm"
        }[type] || "Message";
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
        if (/(error|failed|fail|cannot|unable|invalid|required|denied|expired|삭제가 취소|취소)/.test(text)) return "error";
        if (/(success|saved|deleted|uploaded|completed|created|done|완료|성공)/.test(text)) return "success";
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
        const confirmButtons = options.type === "confirm"
            ? `
                <button type="button" class="common-message-primary" data-common-message-action="cancel" autofocus>${this.escapeHtml(options.cancelText)}</button>
                <button type="button" class="common-message-secondary" data-common-message-action="ok">${this.escapeHtml(options.okText)}</button>
            `
            : `<button type="button" class="common-message-primary" data-common-message-action="ok">${this.escapeHtml(options.okText)}</button>`;
        const footerHtml = options.toast ? "" : `
            <footer class="common-message-footer">
                ${options.copyable ? `<button type="button" class="common-message-secondary" data-common-message-action="copy"><i class="fas fa-copy"></i><span>Copy</span></button>` : ""}
                ${confirmButtons}
            </footer>
        `;
        popup.innerHTML = `
            <header class="common-message-header">
                <span class="common-message-icon"><i class="${this.icons[options.type] || this.icons.info}"></i></span>
                <strong>${this.escapeHtml(options.title)}</strong>
                <button type="button" class="common-message-tool" data-common-message-action="close" title="Close">
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
            const cleanup = (result) => {
                if (closed) return;
                closed = true;
                if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
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
                button.innerHTML = '<i class="fas fa-check"></i><span>Copied</span>';
                setTimeout(() => {
                    if (button.isConnected) button.innerHTML = original;
                }, 1200);
            });
            popup.addEventListener("keydown", (event) => {
                if (event.key === "Escape") cleanup(options.type !== "confirm");
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) cleanup(true);
            });
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
                setTimeout(() => {
                    const focusTarget = options.type === "confirm"
                        ? popup.querySelector('[data-common-message-action="cancel"]')
                        : popup.querySelector(".common-message-primary");
                    focusTarget?.focus();
                }, 0);
            }
        });
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
        popup.style.top = `${22 + document.querySelectorAll(".common-message-popup.is-modeless").length * 14}px`;
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
        return /[가-힣]/.test(String(value ?? ""));
    },
    normalizeMessageKey(message) {
        return String(message ?? "").replace(/\s+/g, " ").trim();
    },
    translateMessage(message) {
        const original = String(message ?? "");
        const key = this.normalizeMessageKey(original);
        if (!key || this.hasKorean(key)) return "";
        if (this.translations[key]) return this.translations[key];
        const patterns = [
            [
                /^You are about to (.+)\.\n{2,}All open pages will be closed and unsaved work may be lost\.\nAny open target DB session will be rolled back and closed before continuing\.(?:\n{2,}There are (\d+) request\(s\) still running\. The app will wait briefly before cleanup\.)?\n{2,}Continue\?$/,
                (m) => {
                    const actionMap = {
                        logout: "로그아웃",
                        "change Target DB": "대상 DB 변경",
                        "change target DB": "대상 DB 변경",
                        "close this page": "현재 페이지 닫기",
                        "close all pages": "모든 페이지 닫기",
                        continue: "계속 진행"
                    };
                    const action = actionMap[m[1]] || m[1];
                    const requestWarning = m[2]
                        ? `아직 실행 중인 요청이 ${m[2]}건 있습니다. 정리 전에 잠시 대기합니다.`
                        : "";
                    return [
                        `${action} 작업을 진행하려고 합니다.`,
                        "",
                        "열려 있는 모든 페이지가 닫히고 저장하지 않은 작업이 사라질 수 있습니다.",
                        "계속하기 전에 열려 있는 대상 DB 세션은 롤백 후 종료됩니다.",
                        ...(requestWarning ? ["", requestWarning] : []),
                        "",
                        "계속하시겠습니까?"
                    ].join("\n");
                }
            ],
            [/^Delete project "(.+)"\?$/, (m) => `"${m[1]}" 프로젝트를 삭제하시겠습니까?`],
            [/^Delete scenario "(.+)"\?$/, (m) => `"${m[1]}" 시나리오를 삭제하시겠습니까?`],
            [/^Delete all scenarios for "(.+)"\?$/, (m) => `"${m[1]}"의 모든 시나리오를 삭제하시겠습니까?`],
            [/^(.+) table will be dropped\. Continue\?$/, (m) => `${m[1]} 테이블이 DROP됩니다. 계속하시겠습니까?`],
            [/^Delete table "(.+)" from this scenario\?$/, (m) => `이 시나리오에서 "${m[1]}" 테이블을 삭제하시겠습니까?`],
            [/^(.+) scenario tables deleted\.$/, (m) => `시나리오 테이블 ${m[1]}건이 삭제되었습니다.`],
            [/^(.+) scenarios deleted\.$/, (m) => `시나리오 ${m[1]}건이 삭제되었습니다.`],
            [/^(.+) items saved\.$/, (m) => `${m[1]}건이 저장되었습니다.`],
            [/^(.+) object and (.+) detail rows deleted\.(.*)$/, (m) => `객체 ${m[1]}건과 상세 행 ${m[2]}건이 삭제되었습니다.${m[3] ? ` ${m[3]}` : ""}`],
            [/^Delete setting "(.+)"\?$/, (m) => `"${m[1]}" 설정을 삭제하시겠습니까?`],
            [/^Delete notice "(.+)"\?$/, (m) => `"${m[1]}" 공지사항을 삭제하시겠습니까?`],
            [/^(.+) jobs (.+)\. (.+) failed\.$/, (m) => `작업 ${m[1]}건이 ${m[2]} 처리되었고, ${m[3]}건이 실패했습니다.`],
            [/^Delete (.+)\?\nNodes, edges, and run history for this flow will also be deleted\.$/, (m) => `${m[1]} 플로우를 삭제하시겠습니까?\n이 플로우의 노드, 엣지, 실행 이력도 함께 삭제됩니다.`],
            [/^(.+)\nFlow ID: (.+)$/, (m) => `${this.translateMessage(m[1]) || m[1]}\n플로우 ID: ${m[2]}`]
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
        return translated && translated !== original ? `${original}\n${translated}` : original;
    },
    formatMessage(message) {
        const { original, translated } = this.buildMessageParts(message);
        const originalHtml = this.escapeHtml(original).replace(/\r?\n/g, "<br>");
        if (!translated || translated === original) return `<div class="common-message-original">${originalHtml}</div>`;
        const translatedHtml = this.escapeHtml(translated).replace(/\r?\n/g, "<br>");
        return `
            <div class="common-message-original">${originalHtml}</div>
            <div class="common-message-translation">${translatedHtml}</div>
        `;
    }
};

window.CommonUI = CommonUI;
window.CommonUtils = CommonUtils;
window.CommonMessage = CommonMessage;
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
