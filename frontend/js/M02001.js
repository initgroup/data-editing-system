/**
 * @file        M02001.js
 * @description 규칙관리 > 규칙발굴
 * @author      [인아이티 김진열]
 * @date        2026-04-18
 * @version     1.0.0
 * @dependency  gridjs.umd.js, chart.js, common.js
 */
(function() {
    // [추가] 페이지 코드 변수 선언 (하단 모든 로직에서 공통 사용)
    const PAGE_CODE = 'M02001';

    // 페이지 전역 변수 또는 네임스페이스 정의
    const M02001 = {
        gridInstance: null,
        currentData: [],
        itemsPerPage: 10, // 페이징 예시용 추가
        currentPage: 1,

        // 내부 헬퍼: 페이지 내의 요소만 찾기
        getEl(id) {
            return document.getElementById(`${id}-${PAGE_CODE}`);
        },

        // 내부 헬퍼: 컨테이너 하위의 일반 ID 요소 찾기
        getContainerEl(selector) {
            const container = document.getElementById(`container-${PAGE_CODE}`);
            return container ? container.querySelector(selector) : null;
        },

        /**
         * 화면 초기화 진입점
         */
        async init() {
            console.log("${PAGE_CODE} 초기화 완료");
            this.initGrid();
            this.bindEvents();
            this.resetSearch();
            this.currentData = [];
            await this.loadInitialData();
            this.onShow(); // 첫 로드 때도 데이터를 가져와야 하므로 호출
        },

        onShow() {
            // 메뉴를 클릭해서 이 페이지가 '보일 때마다' 실행
            // (최신 데이터 조회 등)
            //this.searchSync(); 
        },  

        /**
         * [디자인 수정] Grid.js 기반 메인 데이터 그리드 초기화
         */
        initGrid() {
            const targetId = `gridContainer-${PAGE_CODE}`;
            
            // 요소가 존재하는지 먼저 확인 (디버깅용)
            if (!document.getElementById(targetId)) {
                console.error(`[${PAGE_CODE}] 컨테이너 요소를 찾을 수 없습니다: ${targetId}`);
                return;
            }
            // createGrid는 common.js의 래퍼 함수이므로 설정을 최신 스타일로 주입합니다.
            this.gridInstance = createGrid(targetId, {
                columns: [
                    { id: 'RNUM', name: '순번', width: '80px', sort: true },
                    { id: 'COL1', name: '컬럼1', sort: true },
                    { id: 'COL2', name: '컬럼2', sort: true },
                    { id: 'DATE', name: '일자', width: '150px' }
                ],
                // [최신 스타일 적용]
                fixedHeader: true,
                height: '345px', // 약 5행 정도 노출되는 최적 높이
                style: {
                    table: { 'width': '100%' },
                    td: { 'cursor': 'pointer' }
                },
                className: {
                    table: 'custom-grid-table'
                },
                data: []
            });

            // 기존 행 클릭 바인딩 유지
            CommonUI.bindGridRowClick(targetId);

            // [추가] 행 선택 시 시각적 효과(Selected Row)를 위한 이벤트 리스너
            const container = this.getEl('gridContainer');
            container.addEventListener('click', (e) => {
                const tr = e.target.closest('.gridjs-tr');
                if (tr) {
                    container.querySelectorAll('.gridjs-tr').forEach(el => 
                        el.classList.remove('gridjs-tr-selected')
                    );
                    tr.classList.add('gridjs-tr-selected');
                }
            });
        },
        
        /**
         * DOM 이벤트 바인딩 (기존 로직 유지)
         */
        bindEvents() {
            // 1. 컨테이너를 먼저 찾습니다.
            const container = this.getEl('container');
            const mainCombo = this.getContainerEl('#mainCombo');

            // 2. 컨테이너 하위의 mainCombo를 찾아 이벤트를 연결합니다.
            mainCombo?.addEventListener('change', async (e) => {
                const parentId = e.target.value;
                const subCombo = this.getContainerEl('#subCombo');
                
                if (!parentId) {
                    subCombo.innerHTML = '<option value="">메인을 먼저 선택하세요</option>';
                    subCombo.disabled = true;
                    subCombo.classList.add('bg-gray-50', 'cursor-not-allowed');
                    return;
                }

                try {
                    const res = await fetch(`${API_BASE_URL}/${PAGE_CODE}/cascade/${parentId}`);
                    const json = await res.json();
                    
                    subCombo.innerHTML = '<option value="">선택하세요</option>';
                    json.data?.forEach(item => {
                        subCombo.innerHTML += `<option value="${item.CODE}">${item.NAME}</option>`;
                    });
                    subCombo.disabled = false;
                    subCombo.classList.remove('bg-gray-50', 'cursor-not-allowed');
                } catch (e) {
                    CommonUI.showPageError(PAGE_CODE,"하위 콤보박스 로딩 실패");
                }
            });
        },

        /**
         * 초기 데이터 로딩 (기존 로직 유지)
         */
        async loadInitialData() {
            try {
                const res = await fetch(`${API_BASE_URL}/${PAGE_CODE}/init`);
                const json = await res.json();
                const mainCombo = this.getContainerEl('#mainCombo');
                const rawData = json.data?.data ?? json.data ?? [];
                const curData = Array.isArray(rawData) ? rawData : [];
                curData.forEach(item => {
                    mainCombo.innerHTML += `<option value="${item.CODE}">${item.NAME}</option>`;
                });
            } catch (error) {
                CommonUI.showPageError(PAGE_CODE,"초기 데이터 셋업 중 오류가 발생했습니다.");
            }
        },

        getSearchParams() {
            // 1. 현재 페이지의 고유 컨테이너를 먼저 지정합니다.
            const container = this.getEl('page-section');
            if (!container) return {};

            // 2. document 대신 container.querySelector를 사용하여 범위를 제한합니다.
            const checks = Array.from(container.querySelectorAll('.status-chk:checked')).map(cb => cb.value);
            
            return {
                main_combo: container.querySelector('#mainCombo')?.value || null,
                sub_combo: container.querySelector('#subCombo')?.value || null,
                text_val: container.querySelector('#textSearch')?.value || null,
                date_val: container.querySelector('#dateSearch')?.value || null,
                check_values: checks
            };
        },

        resetSearch(flag) {
            // 1. 현재 페이지의 컨테이너를 찾습니다.
            const container = this.getEl('page-section');

            if (!container) {
                const backupContainer = this.getEl('container');
                if(!backupContainer) return;
                this._executeReset(backupContainer, flag);
            } else {
                this._executeReset(container, flag);
            }
        },

        // 실제 로직 분리 (가독성 및 유지보수용)
        _executeReset(targetEl, flag) {
            // 2. 입력값 초기화 (ID 문자열을 넘겨야 함)
            if (window.clearInputs) {
                // app.js가 만든 ID를 그대로 전달
                window.clearInputs(targetEl.id); 
            } else {
                targetEl.querySelectorAll('input, select, textarea').forEach(el => {
                    if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
                    else el.value = '';
                });
            }

            // 3. 그리드 및 메시지 초기화
            if (flag === 1) {
                this.currentData = [];
                if (this.gridInstance) {
                    this.gridInstance.updateConfig({ data: [] }).forceRender();
                }
                
                // common.js의 hidePageMessage 호출
                if (window.CommonUI && window.CommonUI.hidePageMessage) {
                    window.CommonUI.hidePageMessage(PAGE_CODE);
                }
            }
        },

        async searchSync() {
            if (typeof CommonUI !== 'undefined') CommonUI.hidePageMessage(PAGE_CODE);
            if (typeof CommonUI !== 'undefined') CommonUI.showLoading();

            try {
                const params = this.getSearchParams();
                const res = await fetch(`${API_BASE_URL}/${PAGE_CODE}/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params)
                });

                let json;
                try {
                    json = await res.json();
                } catch (e) {
                    throw new Error("서버 응답이 올바른 형식이 아닙니다.");
                }

                if (!res.ok) {
                    throw new Error(json.detail || "서버 통신 중 오류가 발생했습니다.");
                }

                const rawData = json.data?.data ?? json.data ?? [];
                this.currentData = Array.isArray(rawData) ? rawData : [];

                if (this.gridInstance) {
                    this.gridInstance.updateConfig({ 
                        data: this.currentData 
                    }).forceRender();
                }

                if (this.currentData.length > 0) {
                    if (typeof showPageSuccess === 'function') CommonUI.showPageSuccess(PAGE_CODE,`총 ${this.currentData.length}건이 조회되었습니다.`);
                } else {
                    if (typeof showPageError === 'function') CommonUI.showPageError(PAGE_CODE,"조회된 데이터가 없습니다.");
                }
            } catch (e) {
                if (typeof showPageError === 'function') CommonUI.showPageError(PAGE_CODE,e.message);
            } finally {
                if (typeof hideLoading === 'function') {
                    setTimeout(() => hideLoading(), 300);
                }
            }
        },

        async executeProcedure() {
            if(!confirm("프로시저를 실행하시겠습니까?")) return;
            try {
                const res = await fetch(`${API_BASE_URL}/${PAGE_CODE}/procedure`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ val: 'TEST' })
                });
                const result = await res.json();
                if(result.proc_result === 'SUCCESS') {
                    const successHtml = `<span class="text-green-600">성공! ${result.message} (처리건수: ${result.affected_rows}건)</span>`;
                    CommonUI.showPageSuccess(PAGE_CODE, successHtml);
                }
            } catch(e) {
                CommonUI.showPageError(PAGE_CODE,"프로시저 실행 실패"+e.message);
            }
        },

        renderGridNoPaging() {
            const tbody = this.getEl('gridNoPaging');
            if (!tbody) return;
            if (!Array.isArray(this.currentData)) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">데이터 형식 오류</td></tr>';
                return;
            }
            if (this.currentData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>';
                return;
            }
            tbody.innerHTML = this.currentData.map(row => `
                <tr class="hover:bg-blue-50 transition-colors">
                    <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                    <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                    <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                    <td class="p-3 border-b">${row.DATE ?? ''}</td>
                </tr>
            `).join('');
        },

        renderGridPaging(page) {
            const tbody = this.getEl('gridPaging');
            const pageArea = this.getEl('paginationArea');
            if (!tbody) return;
            if (!Array.isArray(this.currentData) || this.currentData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>';
                if (pageArea) pageArea.innerHTML = '';
                return;
            }
            this.currentPage = page;
            const start = (page - 1) * this.itemsPerPage;
            const end = start + this.itemsPerPage;
            const pagedData = this.currentData.slice(start, end);
            
            tbody.innerHTML = pagedData.map(row => `
                <tr class="hover:bg-blue-50 transition-colors">
                    <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                    <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                    <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                </tr>
            `).join('');
            this.renderPagination();
        },

        renderPagination() {
            const pageArea = this.getEl('paginationArea');
            if (!pageArea) return;

            const totalPages = Math.ceil(this.currentData.length / this.itemsPerPage);

            let html = '';
            for(let i=1; i<=totalPages; i++) {
                const activeCls = i === this.currentPage ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100';
                html += `<button onclick="${PAGE_CODE}.renderGridPaging(${i})" class="px-3 py-1 border rounded ${activeCls}">${i}</button>`;
            }
            pageArea.innerHTML = html;
        },

        downloadExcel() {
            if (!Array.isArray(this.currentData) || this.currentData.length === 0) {
                if (typeof showPageError === 'function') CommonUI.showPageError(PAGE_CODE,"다운로드할 데이터가 없습니다.");
                return;
            }
            if (window.DataEditingSystem?.downloadCSV) {
                window.DataEditingSystem.downloadCSV(this.currentData, '분석결과_' + new Date().getTime() + '.csv');
            } else {
                CommonUI.showPageError(PAGE_CODE,"다운로드 모듈을 찾을 수 없습니다.");
            }
        },

        downloadFile() {            
            if(this.currentData.length === 0) {
                CommonUI.showPageError(PAGE_CODE,"다운로드할 데이터가 없습니다.");
                return;
            }
            if(window.DataEditingSystem) {
                window.DataEditingSystem.downloadCSV(this.currentData, '검색결과.csv');
            }
        }
    };

    window[PAGE_CODE] = M02001;
})();