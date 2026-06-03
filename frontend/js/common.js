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
                    'first':'맨처음',
                    'previous': '이전',
                    'next': '다음',
                    'last':'맨끝',
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
                el.innerHTML = '<option value="">선택하세요</option>';
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

    async request(url, options = {}) {
        ConsoleLogger.info("(서버요청)", url, 'CommonnUtils.request');

        try {
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
                body: options.body ? JSON.stringify(options.body) : null
            });
            
            if (!response.ok) {
                const errorJson = await response.json().catch(() => ({}));
                const errorMsg = errorJson.detail || "통신 중 오류가 발생했습니다.";            
                ConsoleLogger.error("(응답오류)", url, errorMsg);
                throw new Error(errorMsg); // 여기서 던진 에러는 호출한 곳의 catch로 갑니다.
            }
            ConsoleLogger.info("(응답완료)", url, 'CommonnUtils.request');
            return await response.json();

        } catch (err) {
            // 네트워크 타임아웃이나 fetch 자체 실패 시 처리
            if (!(err instanceof Error)) {
                ConsoleLogger.error("(네트워크오류)", url, err);
            }
            throw err; // 상위 호출자에게 에러를 최종 전달
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
                let htmlOptions = '<option value="">선택하세요</option>';
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
        if (window.DataEditingSystem?.downloadCSV) {
            window.DataEditingSystem.downloadCSV(data, `${fileName}_${new Date().getTime()}.csv`);
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
    }
};

// 전역 노출 설정 (이 부분이 있어야 M00000.js에서 찾을 수 있음)
window.CommonUI = CommonUI;
window.CommonUtils = CommonUtils;
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