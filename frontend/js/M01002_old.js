// M01002.js
window.M01002 = {
    grid: null,

    init() {
        console.log("[M01002] Meta Information Module Initialized");
        this.renderGrid();
        this.bindEvents();
    },

    bindEvents() {
        const searchBtn = document.getElementById('btn_search_meta');
        if (searchBtn) {
            searchBtn.onclick = () => this.search();
        }

        const input = document.getElementById('input_table_name');
        if (input) {
            input.onkeyup = (e) => { 
                if (e.key === 'Enter') this.search(); 
            };
        }
    },

    renderGrid() {
        const container = document.getElementById('grid_meta_info');
        if (!container) return;

        // 기존 그리드가 있다면 초기화
        container.innerHTML = '';

        this.grid = new gridjs.Grid({
            columns: [
                { name: "순번", width: "80px" },
                { name: "컬럼ID", width: "150px" },
                { name: "컬럼명", width: "150px" },
                { name: "데이터타입", width: "120px" },
                { name: "길이", width: "80px" },
                { name: "PK여부", width: "80px" },
                { name: "설명", width: "auto" }
            ],
            data: [], 
            pagination: { limit: 10 },
            sort: true,
            resizable: true,
            language: {
                'search': { 'placeholder': '결과 내 검색...' },
                'pagination': {
                    'previous': '이전',
                    'next': '다음',
                    'showing': '검색 결과',
                    'results': () => '개'
                }
            },
            className: {
                table: 'grid-table' // style.css에 정의된 그리드 스타일이 있다면 연결
            }
        }).render(container);
    },

    async search() {
        const tableName = document.getElementById('input_table_name').value;
        
        // 공통 로딩바 유틸리티 사용 (app.js 연동)
        if (window.CommonUI) window.CommonUI.showLoading();

        try {
            // 실제 데이터 통신부 (샘플 데이터 예시)
            const sampleData = [
                ["1", "COL_01", "고객번호", "NUMBER", "10", "Y", "고객 고유 번호"],
                ["2", "COL_02", "고객명", "VARCHAR2", "100", "N", "고객 실명"],
                ["3", "COL_03", "등록일자", "DATE", "8", "N", "데이터 등록일"]
            ];

            this.grid.updateConfig({ data: sampleData }).forceRender();
            
        } catch (error) {
            console.error("Search Error:", error);
            if (window.CommonUI) window.CommonUI.showMessage("데이터 조회 중 오류가 발생했습니다.", "error");
        } finally {
            if (window.CommonUI) window.CommonUI.hideLoading();
        }
    },

    destroy() {
        console.log("[M01002] Module Destroyed");
        this.grid = null;
    }
};