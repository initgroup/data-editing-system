/**
 * @file        M00000.js
 * @description 종합 컨트롤 예제 페이지의 비즈니스 로직 및 그리드 제어
 * @author      [인아이티 김진열]
 * @date        2026-04-18
 * @version     1.0.0
 * @dependency  gridjs.umd.js, chart.js, common.js
 * * [수정 이력]
 * - 2026-04-18: 최초 생성 및 기본 조회 기능 구현
 * - 2026-04-19: 엑셀 다운로드 및 프로시저 호출 로직 추가
 */
(function() {
    // 페이지 전역 변수 또는 네임스페이스 정의
    const M00000 = {
        gridInstance: null,
        currentData: [],

        /**
         * 화면 초기화 진입점
         */
        async init() {
            console.log("M00000 초기화 완료");
            this.initGrid();
            this.bindEvents();
            this.resetSearch();
            // 2. 그리드 데이터 비우기 (선택 사항: 초기화 시 결과도 지우고 싶을 때)
            this.currentData = [];
            await this.loadInitialData();
        },

        /**
         * Grid.js 기반 메인 데이터 그리드 초기화
         */
        initGrid() {
            this.gridInstance = createGrid('gridContainer', {
                columns: [
                    { id: 'RNUM', name: '순번', width: '80px', sort: true },
                    { id: 'COL1', name: '컬럼1', sort: true },
                    { id: 'COL2', name: '컬럼2', sort: true },
                    { id: 'DATE', name: '일자', width: '150px' }
                ],
                fixedHeader: true,
                height: '350px',
                data: []
            });

            CommonUI.bindGridRowClick('gridContainer');
        },
        
        /**
         * DOM 이벤트 바인딩 (콤보박스 체인지 등)
         */
        bindEvents() {
            // [요구사항 2] 콤보박스 연동 이벤트 (깜빡임 없음)
            document.getElementById('mainCombo')?.addEventListener('change', async (e) => {
                const parentId = e.target.value;
                const subCombo = document.getElementById('subCombo');
                
                if (!parentId) {
                    subCombo.innerHTML = '<option value="">메인을 먼저 선택하세요</option>';
                    subCombo.disabled = true;
                    subCombo.classList.add('bg-gray-50', 'cursor-not-allowed'); // UX 개선: 금지 커서 추가
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
         * 화면 진입 시 초기 공통 코드 로딩
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

        /**
         * 화면의 검색 조건들을 수집하여 객체로 반환
         * @returns {Object} API 전송용 파라미터 객체
         */
        getSearchParams() {
            const checks = Array.from(document.querySelectorAll('.status-chk:checked')).map(cb => cb.value);
            return {
                main_combo: document.getElementById('mainCombo')?.value || null,
                sub_combo: document.getElementById('subCombo')?.value || null,
                text_val: document.getElementById('textSearch')?.value || null,
                date_val: document.getElementById('dateSearch')?.value || null,
                check_values: checks // [요구사항 5] 배열 형태로 서버 전달
            };
        },

        /**
         * 기본 조건 초기화
         */
        resetSearch(flag) {
            // 1. 공통 폼 초기화 호출 (검색 영역 ID 전달)
            if (window.clearInputs) {
                window.clearInputs('main-container'); 
            }

            // 2. 그리드 데이터 비우기 (선택 사항: 초기화 시 결과도 지우고 싶을 때)
            if(flag===1){
                this.currentData = [];
                if (this.gridInstance) {
                    this.gridInstance.updateConfig({ data: [] }).forceRender();
                }

                // 3. 상단 메시지 즉시 삭제
                if (window.hideMessage) window.hideMessage();
            }
        },

        /**
         * 메인 데이터 동기식(로딩바 포함) 조회
         */
        async searchSync() {
            // [수정] 조회 시작 시 기존 메시지 영역을 먼저 숨깁니다.
            if (typeof CommonUI !== 'undefined') CommonUI.hideMessage();
            if (typeof CommonUI !== 'undefined') CommonUI.showLoading();

            try {
                const params = this.getSearchParams();
                const res = await fetch(`${API_BASE_URL}/M00000/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params)
                });

                // 2. JSON 파싱 시도
                let json;
                try {
                    json = await res.json();
                    console.log("서버 전체 응답:", json);
                    console.log("json.data의 값:", json.data);
                    console.log("json.data가 배열인가?:", Array.isArray(json.data));
                } catch (e) {
                    // 서버가 JSON이 아닌 에러를 던졌을 때의 방어 로직
                    throw new Error("서버 응답이 올바른 형식이 아닙니다.");
                }

                // 3. 응답 상태 체크
                if (!res.ok) {
                    throw new Error(json.detail || "서버 통신 중 오류가 발생했습니다.");
                }                // [수정] 확실하게 배열임을 보장

                // 4. 데이터 저장 및 검증
                // 중첩 데이터 및 배열 여부 안전 검사 (기존 로직 유지)
                const rawData = json.data?.data ?? json.data ?? [];
                this.currentData = Array.isArray(rawData) ? rawData : [];

                //  5. GRID 모듈 렌더링 실행
                if (this.gridInstance) {
                    this.gridInstance.updateConfig({ 
                        data: this.currentData 
                    }).forceRender();
                }

                // 5. HTML 표 렌더링 실행
                //this.renderGridNoPaging();
                //this.renderGridPaging(1);

                // 6. 결과 메시지 출력
                if (this.currentData.length > 0) {
                    if (typeof showSuccess === 'function') showSuccess(`총 ${this.currentData.length}건이 조회되었습니다.`);
                } else {
                    if (typeof showError === 'function') showError("조회된 데이터가 없습니다.");
                }
            } catch (e) {
                console.error("조회 에러 상세:", e);
                if (typeof showError === 'function') showError(e.message); // 에러 발생 시 메시지 고정
            } finally {
                // 7. 로딩바 종료 (0.3초 후 자연스럽게 사라짐)
                if (typeof hideLoading === 'function') {
                    setTimeout(() => hideLoading(), 300);
                }
            }
        },

        // [요구사항 6] 프로시저 호출 시뮬레이션
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
                    // 성공 시 메시지와 처리 건수 표시
                    const successHtml = `<span class="text-green-600">성공! ${result.message} (처리건수: ${result.affected_rows}건)</span>`;
                    document.getElementById('errorMsgText').innerHTML = successHtml;
                    document.getElementById('errorBox').classList.remove('hidden', 'bg-red-50', 'border-red-500');
                    document.getElementById('errorBox').classList.add('bg-green-50', 'border-green-500');
                }
            } catch(e) {
                showError("프로시저 실행 실패"+e.message); // 에러 발생 시 메시지 고정
            }
        },

        // HTML 표로 페이징 없는 전체 그리드 렌더링
        renderGridNoPaging() {
            const tbody = document.getElementById('gridNoPaging');
            if (!tbody) return;
            // 데이터가 배열인지 엄격하게 체크
            if (!Array.isArray(this.currentData)) {
                if(!this.currentData){
                    console.error("데이터가 배열 형식이 아닙니다:", this.currentData);
                }
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">데이터 형식 오류</td></tr>';
                return;
            }

            if (this.currentData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>';
                return;
            }

            try {
                // 이제 안전하게 map을 사용할 수 있습니다.
                tbody.innerHTML = this.currentData.map(row => `
                    <tr class="hover:bg-blue-50 transition-colors">
                        <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                        <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                        <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                        <td class="p-3 border-b">${row.DATE ?? ''}</td>
                    </tr>
                `).join('');
            } catch (e) {
                console.error("렌더링 중 에러:", e);
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">데이터 형식 오류가 발생했습니다.</td></tr>';
            }
        },

        // HTML 표로 페이징 있는 전체 그리드 렌더링
        renderGridPaging(page) {
            const tbody = document.getElementById('gridPaging');
            const pageArea = document.getElementById('paginationArea');
            if (!tbody) return;

            // [수정 포인트] 배열이 아니거나 데이터가 없으면 초기화 후 종료
            if (!Array.isArray(this.currentData) || this.currentData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>';
                if (pageArea) pageArea.innerHTML = '';
                return;
            }

            try {
                this.currentPage = page;
                const start = (page - 1) * this.itemsPerPage;
                const end = start + this.itemsPerPage;
                
                // 이제 안전하게 slice를 사용할 수 있습니다.
                const pagedData = this.currentData.slice(start, end);
                
                if (!pagedData.length) {
                    tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-400">해당 페이지에 데이터가 없습니다.</td></tr>';
                    return;
                }

                tbody.innerHTML = pagedData.map(row => `
                    <tr class="hover:bg-blue-50 transition-colors">
                        <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                        <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                        <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                    </tr>
                `).join('');

                this.renderPagination();
            } catch (e) {
                console.error("페이징 렌더링 중 에러:", e);
                tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-red-400">데이터 형식 오류가 발생했습니다.</td></tr>';
            }
        },

        // HTML 표로 페이징 표시
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

        /**
         * 그리드로 출력했을떄 엑셀 다운로드 (공통 모듈 연동)
         */
        downloadExcel() {
            if (!Array.isArray(this.currentData) || this.currentData.length === 0) {
                if (typeof showError === 'function') showError("다운로드할 데이터가 없습니다.");
                return;
            }
            // 이제 common.js에서 정의한 DataEditingSystem이 호출됩니다.
            if (window.DataEditingSystem?.downloadCSV) {
                window.DataEditingSystem.downloadCSV(this.currentData, '분석결과_' + new Date().getTime() + '.csv');
            } else {
                showError("다운로드 모듈을 찾을 수 없습니다.");
            }
        },

        /**
         * HTML 표로 출력했을떄 파일 다운로드 (main.js에 구현된 convertToCSV 활용)
         */
        downloadFile() {            
            if(this.currentData.length === 0) {
                this.showError("다운로드할 데이터가 없습니다.");
                return;
            }
            // 글로벌로 선언되어 있는 DataEditingSystem 활용
            if(window.DataEditingSystem) {
                window.DataEditingSystem.downloadCSV(this.currentData, '검색결과.csv');
            }
        }
    };

    window.M00000 = M00000;
})();