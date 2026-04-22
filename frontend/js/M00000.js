/**
 * @file        M00000.js
 * @description 종합 컨트롤 예제 페이지의 비즈니스 로직 및 그리드 제어
 * @author      [인아이티 김진열]
 * @date        2026-04-18
 * @version     1.0.0
 * @dependency  gridjs.umd.js, chart.js, common.js
 */
(function() {
    // 페이지 전역 변수 또는 네임스페이스 정의
    const M00000 = {
        gridInstance: null,
        currentData: [],
        itemsPerPage: 10, // 페이징 예시용 추가
        currentPage: 1,

        /**
         * 화면 초기화 진입점
         */
        async init() {
            console.log("M00000 초기화 완료");
            this.initGrid();
            this.bindEvents();
            this.resetSearch();
            this.currentData = [];
            await this.loadInitialData();
        },

        /**
         * [디자인 수정] Grid.js 기반 메인 데이터 그리드 초기화
         */
        initGrid() {
            // createGrid는 common.js의 래퍼 함수이므로 설정을 최신 스타일로 주입합니다.
            this.gridInstance = createGrid('gridContainer', {
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
            CommonUI.bindGridRowClick('gridContainer');

            // [추가] 행 선택 시 시각적 효과(Selected Row)를 위한 이벤트 리스너
            const container = document.getElementById('gridContainer');
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
            document.getElementById('mainCombo')?.addEventListener('change', async (e) => {
                const parentId = e.target.value;
                const subCombo = document.getElementById('subCombo');
                
                if (!parentId) {
                    subCombo.innerHTML = '<option value="">메인을 먼저 선택하세요</option>';
                    subCombo.disabled = true;
                    subCombo.classList.add('bg-gray-50', 'cursor-not-allowed');
                    return;
                }

                try {
                    const res = await fetch(`${API_BASE_URL}/M00000/cascade/${parentId}`);
                    const json = await res.json();
                    
                    subCombo.innerHTML = '<option value="">선택하세요</option>';
                    json.data?.forEach(item => {
                        subCombo.innerHTML += `<option value="${item.CODE}">${item.NAME}</option>`;
                    });
                    subCombo.disabled = false;
                    subCombo.classList.remove('bg-gray-50', 'cursor-not-allowed');
                } catch (e) {
                    showError("하위 콤보박스 로딩 실패");
                }
            });
        },

        /**
         * 초기 데이터 로딩 (기존 로직 유지)
         */
        async loadInitialData() {
            try {
                const res = await fetch(`${API_BASE_URL}/M00000/init`);
                const json = await res.json();
                const mainCombo = document.getElementById('mainCombo');
                const rawData = json.data?.data ?? json.data ?? [];
                const curData = Array.isArray(rawData) ? rawData : [];
                curData.forEach(item => {
                    mainCombo.innerHTML += `<option value="${item.CODE}">${item.NAME}</option>`;
                });
            } catch (error) {
                showError("초기 데이터 셋업 중 오류가 발생했습니다.");
            }
        },

        getSearchParams() {
            const checks = Array.from(document.querySelectorAll('.status-chk:checked')).map(cb => cb.value);
            return {
                main_combo: document.getElementById('mainCombo')?.value || null,
                sub_combo: document.getElementById('subCombo')?.value || null,
                text_val: document.getElementById('textSearch')?.value || null,
                date_val: document.getElementById('dateSearch')?.value || null,
                check_values: checks
            };
        },

        resetSearch(flag) {
            if (window.clearInputs) {
                window.clearInputs('main-container'); 
            }
            if(flag===1){
                this.currentData = [];
                if (this.gridInstance) {
                    this.gridInstance.updateConfig({ data: [] }).forceRender();
                }
                if (window.hideMessage) window.hideMessage();
            }
        },

        async searchSync() {
            if (typeof CommonUI !== 'undefined') CommonUI.hideMessage();
            if (typeof CommonUI !== 'undefined') CommonUI.showLoading();

            try {
                const params = this.getSearchParams();
                const res = await fetch(`${API_BASE_URL}/M00000/search`, {
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
                    if (typeof showSuccess === 'function') showSuccess(`총 ${this.currentData.length}건이 조회되었습니다.`);
                } else {
                    if (typeof showError === 'function') showError("조회된 데이터가 없습니다.");
                }
            } catch (e) {
                if (typeof showError === 'function') showError(e.message);
            } finally {
                if (typeof hideLoading === 'function') {
                    setTimeout(() => hideLoading(), 300);
                }
            }
        },

        async executeProcedure() {
            if(!confirm("프로시저를 실행하시겠습니까?")) return;
            try {
                const res = await fetch(`${API_BASE_URL}/M00000/procedure`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ val: 'TEST' })
                });
                const result = await res.json();
                if(result.proc_result === 'SUCCESS') {
                    const successHtml = `<span class="text-green-600">성공! ${result.message} (처리건수: ${result.affected_rows}건)</span>`;
                    document.getElementById('errorMsgText').innerHTML = successHtml;
                    document.getElementById('errorBox').classList.remove('hidden', 'bg-red-50', 'border-red-500');
                    document.getElementById('errorBox').classList.add('bg-green-50', 'border-green-500');
                }
            } catch(e) {
                showError("프로시저 실행 실패"+e.message);
            }
        },

        renderGridNoPaging() {
            const tbody = document.getElementById('gridNoPaging');
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
            const tbody = document.getElementById('gridPaging');
            const pageArea = document.getElementById('paginationArea');
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
            const totalPages = Math.ceil(this.currentData.length / this.itemsPerPage);
            const pageArea = document.getElementById('paginationArea');
            let html = '';
            for(let i=1; i<=totalPages; i++) {
                const activeCls = i === this.currentPage ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100';
                html += `<button onclick="M00000.renderGridPaging(${i})" class="px-3 py-1 border rounded ${activeCls}">${i}</button>`;
            }
            pageArea.innerHTML = html;
        },

        downloadExcel() {
            if (!Array.isArray(this.currentData) || this.currentData.length === 0) {
                if (typeof showError === 'function') showError("다운로드할 데이터가 없습니다.");
                return;
            }
            if (window.DataEditingSystem?.downloadCSV) {
                window.DataEditingSystem.downloadCSV(this.currentData, '분석결과_' + new Date().getTime() + '.csv');
            } else {
                showError("다운로드 모듈을 찾을 수 없습니다.");
            }
        },

        downloadFile() {            
            if(this.currentData.length === 0) {
                this.showError("다운로드할 데이터가 없습니다.");
                return;
            }
            if(window.DataEditingSystem) {
                window.DataEditingSystem.downloadCSV(this.currentData, '검색결과.csv');
            }
        }
    };

    window.M00000 = M00000;
})();