/**
 * @file        M00000.js
 * @description 샘플페이지 > DB연동
 * @author      [인아이티 김진열]
 * @date        2026-04-18
 * @version     1.0.0
 * @dependency  gridjs.umd.js, chart.js, common.js
 */
(function() { // IIFE(즉시실행함수)로 독립적인 스코프를 구분하여 하단의 PAGE_CODE가 다른 페이지의 동일한 변수명이라도 충돌되지 않는다.
    // 페이지 코드 변수 선언 (하단 모든 로직에서 공통 사용)
    const PAGE_CODE = 'M00000';    
    // app.js에서 제공하는 헬퍼 생성
    const { getEl, getContainerEl } = PageManager.createHelper(PAGE_CODE);

    // 페이지 전역 변수 또는 네임스페이스 정의
    const M00000 = {
        isInit: false, // 초기화 여부 플래그
        /**
         * 화면 공용 오브젝트
         */
        gridManagers: {
            grid1: CommonUtils.createGridModel(10),
            grid2: CommonUtils.createGridModel(20)
        },   

        /**
         * 화면 초기화 진입점
         */
        async init() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            if (this.isInit) return; // 이미 실행됐다면 즉시 종료

            console.log(`${pageCode} 초기화 완료`);

            // 1. 초기화 함수
            this.resetSearch();
            
            // 2. 초기 화면 데이터 로드(순차 실행 필수)
            await this.loadInitialData(); 

            // 3. 이벤트 리스너 등록
            this.bindEvents();
            this.bindInputEvents();

            // 4. 실제 데이터 조회
            //await this.onShow();

            console.log(`${pageCode} 모든 초기화 완료`);
            this.isInit = true; // 실행 완료 표시
        },        

        /**
         * 페이지가 화면에 나타날 때(또는 조회가 필요할 때) 실행
         * 여러 그리드를 병렬로 빠르게 로드
         */
        async onShow() { // await 로 호출할때는 async 추가 필수
            try {
                // Promise.all을 사용하여 grid1, grid2 데이터를 동시에 가져옵니다. (속도 향상)
                // Promise.all은 여러 데이터가 독립적으로 연관성이 없을때 사용할 것.
                await Promise.all([
                    this.searchSync('grid1'),
                    this.searchSync('grid2')
                ]);
            } catch (e) {
                console.error("데이터 로드 중 오류 발생:", e);
            }
        }, 

        /**
         * 페이지 자원해제시 호출 함수
         */
        destroy() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            console.log(`${pageCode} 자원 해제 시작`);

            // 1. 모든 그리드 인스턴스 파괴 (라이브러리 전용 메서드 호출)
            Object.values(this.gridManagers).forEach(mgr => {
                if (mgr.gridInstance && typeof mgr.gridInstance.destroy === 'function') {
                    mgr.gridInstance.destroy(); // 예: TOAST UI Grid, AG-Grid 등의 파괴 메서드
                    mgr.gridInstance = null;    // 참조 제거
                }
                mgr.currentData = []; // 대용량 통계 데이터 메모리 비우기
            });

            // 2. 이벤트 리스너가 있다면 여기서 제거 (window 이벤트 등)
            // window.removeEventListener('resize', this.onResize);

            // 3. 전역 객체에서 삭제 (선택 사항)
            delete window[pageCode];

            console.log(`${pageCode} 자원 해제 완료`);
        },

        /**
         * 초기 데이터 로딩 함수
         * async 는 함수반환을 Promise 객체로 감싸서 반환
         * async 가 없는 경우 await 함수() 호출 불가(즉, 동기흐름으로 함수 호출하라면 async 필수)
         */
        async loadInitialData() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용

            try {
                const mainCombo = getContainerEl('#mainCombo');
                const apiUrl = `${API_BASE_URL}/${pageCode}/init`;
                await CommonUtils.loadComboData( pageCode, mainCombo,apiUrl,'data1', { method: 'GET' }, 'C##INITAI');

                // 방법1. subCombo change 이벤트를 발생시켜 sub2Combo 로딩 유도
                /* mainCombo.dispatchEvent(new Event('change')); */
                // 방법2. await로 sub2Combo 바인딩 직접 실행                
                const subCombo = getContainerEl('#subCombo');
                const apiUrl2 = `${API_BASE_URL}/${pageCode}/searchCombo`;
                await CommonUtils.loadComboData(pageCode, subCombo, apiUrl2,'data', {method: 'POST'
                    ,body: {
                        mainCombo: mainCombo.value || null
                    }} );
            } catch (error) {
                CommonUI.showPageError(pageCode,"초기 데이터 셋업 중 오류가 발생했습니다.");
            }
        },
        
        /**
         * DOM 이벤트 바인딩 (최초 1회만 사용)
         */
        bindEvents() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            const mainCombo = getContainerEl('#mainCombo');            
            const subCombo = getContainerEl('#subCombo');
            const sub2Combo = getContainerEl('#sub2Combo');
    
            // 이제 리스너는 로직을 직접 들고 있지 않고 분리된 함수만 호출합니다.
            mainCombo.addEventListener('change', async (e) => {
                await CommonUtils.loadComboData(pageCode, subCombo, `${API_BASE_URL}/${pageCode}/searchCombo`, 'data', {method: 'POST'
                    ,body: {mainCombo: e.target.value}} );
                sub2Combo.innerHTML = '<option value="">테이블명을 먼저 선택하세요</option>';
                sub2Combo.disabled = true;

                if (subCombo.options.length > 1) {
                    // 0번이 '선택하세요'이므로 1번이 첫 데이터 (단, change 이벤트는 발생하지 않는다.)
                    subCombo.selectedIndex = 1;  
                    
                    // 방법1. subCombo change 이벤트를 발생시켜 sub2Combo 로딩 유도
                    subCombo.dispatchEvent(new Event('change'));

                    // 방법2. await로 sub2Combo 바인딩 직접 실행
                    /* await CommonUtils.loadComboData(pageCode, sub2Combo, `${API_BASE_URL}/${pageCode}/search2Combo`, {method: 'POST'
                        ,body: {
                            mainCombo: mainCombo.value || null,
                            subCombo: subCombo.value || null
                        }} ); */
                } else {
                    // 데이터가 없는 경우 수동으로 비워주는 로직이 필요할 수 있음
                    sub2Combo.innerHTML = '<option value="">데이터 없음</option>';
                }
            });

            subCombo.addEventListener('change', async (e) => {
                await CommonUtils.loadComboData(pageCode, sub2Combo, `${API_BASE_URL}/${pageCode}/search2Combo`, 'data', {method: 'POST'
                    ,body: {
                        mainCombo: mainCombo.value || null,
                        subCombo: e.target.value || null
                    }} );
            });
        },

        /**
         * 컨트롤 속성 초기화 이벤트 바인딩(최초 1회만 사용)
         */
        bindInputEvents() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            // 한 줄로 공통 함수 호출
            CommonUI.initInputState(`#container-${pageCode}`);
        },    

        /**
         * 초기화
         */
        resetSearch(flag) {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            // 1. 값 및 스타일 초기화
            CommonUI.clearInputs(getEl(pageCode));
            
            // 2. 추가적인 특정 컨트롤 제어 (필요한 경우에만 작성)
            const subCombo = getContainerEl('#subCombo');
            if (subCombo) {
                subCombo.disabled = true;
                subCombo.innerHTML = '<option value="">사용자계정을 먼저 선택하세요</option>';
            }

            console.log("검색 조건 초기화 완료");
        },
        
        /** 
         * 현재 폼의 컨트롤 값을 반환한다.
         */
        getSearchParams() {
            // 1. 현재 페이지의 고유 컨테이너를 먼저 지정합니다.
            const container = getEl('page-section');
            if (!container) return {};

            // 2. document 대신 container.querySelector를 사용하여 범위를 제한합니다.
            const checks = Array.from(container.querySelectorAll('.status-chk:checked')).map(cb => cb.value);
            
            return {
                mainCombo: container.querySelector('#mainCombo')?.value || null,
                subCombo: container.querySelector('#subCombo')?.value || null,
                textVal: container.querySelector('#textSearch')?.value || null,
                dateVal: container.querySelector('#dateSearch')?.value || null,
                checkValues: checks
            };
        },        

        /** 
         * 조회 함수
         * 데이터를 동적으로 조회하여 특정 그리드에 바인딩
         * @param {string} gridKey - 대상 그리드 키 ('grid1', 'grid2' 등)
         */
        async searchSync(gridKey = 'grid1') {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            // 1. UI 초기화
            CommonUI.hidePageMessage(pageCode);
            CommonUI.showLoading();

            try {
                // 2. 검색 조건 및 URL 설정 
                // (그리드별로 API 경로가 다르다면 URL도 인자로 받을 수 있음)
                const params = this.getSearchParams();
                const url = `${API_BASE_URL}/${pageCode}/search`;
                /* const url2 = `${API_BASE_URL}/${pageCode}/search/${gridKey}`; */ // 그리드별 경로 구분 예시

                // 3. 공통 유틸로 데이터 호출
                const json = await CommonUtils.request(url, {
                    method: 'POST',
                    body: params
                });

                // 4. DB 에러 처리
                if (json.status === 'error_db') {
                    CommonUI.showPageError(pageCode, json.message || "DB 연결 오류");
                    return;
                }

                // 5. 데이터 매핑 (대괄호 표기법 활용 ★)
                const rawData = json.data?.data ?? json.data ?? [];
                this.gridManagers[gridKey].currentData = Array.isArray(rawData) ? rawData : [];

                // 6. 동적 그리드 렌더링 (그리드별로 높이나 설정을 다르게 줄 수 있음)
                const gridHeight = gridKey === 'grid1' ? '550px' : '300px';
                // 헬퍼 함수인 getContainerEl을 사용하여 엘리먼트를 직접 찾아서 넘깁니다.
                const container = getContainerEl('#gridContainer'); 
                CommonUI.renderDynamicGrid({
                    pageInstance: this,
                    gridKey: gridKey,
                    resData: json,
                    container: container, // 셀렉터 문자열 대신 실제 DOM 객체 전달
                    customColumnStyles: {
                        // 필요시 스타일 정의
                    }
                });

                // 7. 성공 메시지
                const count = this.gridManagers[gridKey].currentData.length;
                if (count > 0) {
                    CommonUI.showPageSuccess(pageCode, `[${gridKey}] 총 ${count}건이 조회되었습니다.`);
                } else {
                    CommonUI.showPageError(pageCode, `[${gridKey}] 조회된 데이터가 없습니다.`);
                }
            } catch (e) {
                CommonUI.showPageError(pageCode, e.message);
            } finally {
                setTimeout(() => CommonUI.hideLoading(), 300);
            }
        },

        /** 
         * 프로시저 호출 함수
         * 데이터를 동적으로 조회하여 특정 그리드에 바인딩
         * @param {string} testParam - 파라미터
         */
        async executeProcedure() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            if(!confirm("프로시저를 실행하시겠습니까?")) return;
            try {
                const res = await fetch(`${API_BASE_URL}/${pageCode}/procedure`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ val: 'TEST' })
                });
                const result = await res.json();
                if(result.proc_result === 'SUCCESS') {
                    const successHtml = `<span class="text-green-600">성공! ${result.message} (처리건수: ${result.affected_rows}건)</span>`;
                    CommonUI.showPageSuccess(pageCode, successHtml);
                }
            } catch(e) {
                CommonUI.showPageError(pageCode,"프로시저 실행 실패"+e.message);
            }
        },

        /**
         * 부가 기능 공용 함수
         * 페이지 렌더링
         * @param {number} pageNum - 이동할 페이지 번호
         * @param {string} gridKey - 제어할 그리드 키 (예: 'grid1', 'grid2')
         */
        renderGridPaging(pageNum, gridKey = 'grid1') {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            // 1. 선택한 그리드의 현재 페이지 갱신 (대괄호 표기법 사용)
            this.gridManagers[gridKey].currentPage = pageNum;            
            // 2. 전체 페이지 수 계산 (실제 데이터에 따라 계산 로직 필요)
            const totalPages = 5;             
            // 3. 페이징 UI 렌더링 (대상 ID도 동적으로 처리 가능)
            // 예: gridPaging-grid1 형태
            const targetId = `#gridPaging-${gridKey}`;
            const pageArea = getContainerEl(targetId);
            // 4. 공통 유틸 호출 (클릭 시 다시 이 함수를 호출하도록 gridKey 전달)
            CommonUtils.renderPaging(g, totalPages, pageNum, pageCode, gridKey);            
            // 5. 데이터 재조회
            this.searchSync(gridKey);
        },

        /**
         * 엑셀 다운로드
         */
        downloadExcel() {
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            CommonUtils.exportExcel(this.gridManagers.grid1.currentData, '탐색데이터', pageCode);
        },

        /**
         * 파일 다운로드
         */
        downloadFile() {      
            const pageCode = PAGE_CODE; // IIFE 내부 변수 사용
            // 공통 함수에 페이지코드, 데이터, 파일명만 넘깁니다.
            CommonUtils.downloadData(
                pageCode, 
                this.gridManagers['grid1'].currentData, 
                '검색결과'
            );
        },

        /**
         * 그리드 페이징
         */
        renderGridNoPaging() {
            const tbody = getContainerEl('#gridNoPaging');
            const data = this.gridManagers['grid1'].currentData;

            CommonUtils.renderTableBody(tbody, data, 4, (row) => `
                <tr class="hover:bg-blue-50 transition-colors">
                    <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                    <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                    <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                    <td class="p-3 border-b">${row.DATE ?? ''}</td>
                </tr>
            `);
        },
    };

    window[PAGE_CODE] = M00000;
})();