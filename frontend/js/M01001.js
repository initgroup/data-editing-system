/**
 * @file        M01001.js
 * @description 데이터 조회 및 관리 (M00000 표준 아키텍처 적용)
 */
(function() {
    const M01001 = {
        gridInstance: null,
        currentData: [],
        sampleData: [
            { id: 1, name: "고객 데이터 2024", type: "csv", size: "15.2 MB", rows: 125000, status: "active", registerDate: "2024-01-15" },
            { id: 2, name: "거래 내역 데이터", type: "json", size: "28.7 MB", rows: 850000, status: "processing", registerDate: "2024-01-14" },
            { id: 3, name: "제품 마스터 데이터", type: "excel", size: "2.1 MB", rows: 15000, status: "active", registerDate: "2024-01-13" },
            { id: 4, name: "재무 데이터", type: "database", size: "45.3 MB", rows: 2100000, status: "error", registerDate: "2024-01-12" }
        ],

        async init() {
            // [해결] DOM이 브라우저에 완전히 렌더링된 후 실행되도록 넉넉한 타이밍 부여
            setTimeout(async () => {
                this.initGrid();
                this.bindEvents();
                console.log("M01001 초기화 완료");
            }, 100); 
        },

        initGrid() {
            const container = document.getElementById('gridContainer');
            if (!container) {
                console.warn("M01001: gridContainer를 아직 찾을 수 없습니다. (재시도)");
                return;
            }

            // [공통] common.js의 createGrid 함수를 사용하여 스타일 일관성 유지
            this.gridInstance = createGrid('gridContainer', {
                columns: [
                    { id: 'id', name: 'ID', width: '80px' },
                    { id: 'name', name: '데이터명', width: '250px' },
                    { id: 'type', name: '유형', width: '100px' },
                    { id: 'size', name: '크기', width: '100px' },
                    { 
                        id: 'status', 
                        name: '상태', 
                        width: '120px',
                        formatter: (cell) => gridjs.html(this.getStatusBadge(cell))
                    },
                    {
                        name: '관리',
                        width: '100px',
                        formatter: (_, row) => gridjs.html(`
                            <button onclick="M01001.previewData(${row.cells[0].data})" class="text-blue-600 hover:underline">보기</button>
                        `)
                    }
                ],
                data: [], // 초기 데이터는 빈 배열
                sort: true,
                pagination: { limit: 10 }
            });
        },

        bindEvents() {
            // 엔터키 검색 이벤트 등
        },

        async searchSync() {
            if (typeof showLoading === 'function') showLoading();
            if (window.CommonUI) window.CommonUI.hideMessage();

            try {
                // 실제 서비스 시 API 연동 구간
                await new Promise(resolve => setTimeout(resolve, 500));
                
                this.currentData = this.sampleData;
                
                if (this.gridInstance) {
                    this.gridInstance.updateConfig({ data: this.currentData }).forceRender();
                    if (typeof showSuccess === 'function') showSuccess(`${this.currentData.length}건이 조회되었습니다.`);
                }
            } catch (e) {
                if (typeof showError === 'function') showError("데이터 조회 실패");
            } finally {
                if (typeof hideLoading === 'function') hideLoading();
            }
        },

        resetSearch() {
            this.currentData = [];
            // common.js 유틸리티 사용 (입력창 초기화)
            if (window.clearInputs) window.clearInputs('page-container');
            if (this.gridInstance) {
                this.gridInstance.updateConfig({ data: [] }).forceRender();
            }
        },

        downloadExcel() {
            if (!this.currentData || this.currentData.length === 0) {
                if (typeof showError === 'function') showError("다운로드할 데이터가 없습니다.");
                return;
            }
            if (window.DataEditingSystem?.downloadCSV) {
                window.DataEditingSystem.downloadCSV(this.currentData, 'M01001_Data.csv');
            }
        },

        getStatusBadge(status) {
            const classes = {
                active: "bg-green-100 text-green-700",
                processing: "bg-blue-100 text-blue-700",
                error: "bg-red-100 text-red-700"
            };
            return `<span class="${classes[status] || 'bg-gray-100 text-gray-700'} px-2 py-1 rounded text-[11px] font-bold uppercase">${status}</span>`;
        },

        previewData(id) {
            const item = this.sampleData.find(d => d.id === id);
            const modal = document.getElementById('preview-modal');
            const content = document.getElementById('preview-content');
            if (!modal || !content || !item) return;

            content.innerHTML = `<pre class="bg-gray-50 p-4 rounded border text-sm">${JSON.stringify(item, null, 2)}</pre>`;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        },

        closePreviewModal() {
            const modal = document.getElementById('preview-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        }
    };

    window.M01001 = M01001;
})();