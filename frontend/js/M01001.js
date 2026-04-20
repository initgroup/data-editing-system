/**
 * M01001.js: 데이터 조회 및 관리
 */
(function() {
    const M01001 = {
        sampleData: [
            { id: 1, name: "고객 데이터 2024", type: "csv", size: "15.2 MB", rows: 125000, status: "active", registerDate: "2024-01-15", description: "2024년 고객 기본 정보" },
            { id: 2, name: "거래 내역 데이터", type: "json", size: "28.7 MB", rows: 850000, status: "processing", registerDate: "2024-01-14", description: "전체 거래 내역 데이터" },
            { id: 3, name: "제품 마스터 데이터", type: "excel", size: "2.1 MB", rows: 15000, status: "active", registerDate: "2024-01-13", description: "제품 기본 정보 마스터" },
            { id: 4, name: "재무 데이터", type: "database", size: "45.3 MB", rows: 2100000, status: "error", registerDate: "2024-01-12", description: "재무 회계 데이터" },
            { id: 5, name: "인사 데이터", type: "csv", size: "8.9 MB", rows: 68000, status: "inactive", registerDate: "2024-01-11", description: "직원 인사 정보" }
        ],

        init() {
            console.log("M01001: 데이터 관리 모듈 로드");
            this.renderTable(this.sampleData);
        },

        renderTable(data) {
            const tbody = document.getElementById('data-tbody');
            if (!tbody) return;

            tbody.innerHTML = data.map(item => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="px-4 py-3 text-center">${item.id}</td>
                    <td class="px-4 py-3 font-bold text-gray-700">${item.name}</td>
                    <td class="px-4 py-3 text-center"><span class="px-2 py-1 bg-gray-100 rounded text-xs uppercase">${item.type}</span></td>
                    <td class="px-4 py-3 text-right text-gray-500">${item.size}</td>
                    <td class="px-4 py-3 text-right font-mono">${item.rows.toLocaleString()}</td>
                    <td class="px-4 py-3 text-center">${this.getStatusBadge(item.status)}</td>
                    <td class="px-4 py-3 text-center text-gray-500 text-sm">${item.registerDate}</td>
                    <td class="px-4 py-3 text-center">
                        <button onclick="M01001.previewData(${item.id})" class="text-blue-600 hover:text-blue-800 mr-3" title="미리보기"><i class="fas fa-eye"></i></button>
                        <button onclick="M01001.editData(${item.id})" class="text-green-600 hover:text-green-800 mr-3" title="편집"><i class="fas fa-edit"></i></button>
                        <button onclick="M01001.deleteData(${item.id})" class="text-red-600 hover:text-red-800" title="삭제"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        },

        getStatusBadge(status) {
            const classes = {
                active: "bg-green-100 text-green-700",
                processing: "bg-blue-100 text-blue-700",
                error: "bg-red-100 text-red-700",
                inactive: "bg-gray-100 text-gray-700"
            };
            return `<span class="${classes[status] || classes.inactive} px-2 py-1 rounded-full text-[11px] font-bold uppercase">${status}</span>`;
        },

        previewData(id) {
            const modal = document.getElementById('preview-modal');
            const content = document.getElementById('preview-content');
            if (!modal || !content) return;

            content.innerHTML = `<div class="p-4 bg-gray-50 rounded border font-mono text-sm">데이터 ID ${id}의 상세 미리보기 내용을 로드 중입니다...</div>`;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        },

        closePreviewModal() {
            const modal = document.getElementById('preview-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        },

        editData(id) { alert(`ID ${id} 편집 화면으로 이동합니다.`); },
        
        deleteData(id) { if (confirm('정말로 삭제하시겠습니까?')) alert('삭제되었습니다.'); }
    };

    // 전역 초기화 함수 설정
    window.initM01001Page = () => M01001.init();
    window.M01001 = M01001;
})();