/**
 * M01002.js: 메타정보 관리
 */
(function() {
    const M01002 = {
        sampleMetadata: [
            { id: 1, tableName: "TB_CUST_INFO", logicalName: "고객기본정보", columnCount: 24, description: "고객의 기본 인적 사항" },
            { id: 2, tableName: "TB_ORD_HIST", logicalName: "주문내역", columnCount: 15, description: "상품 주문 및 결제 이력" },
            { id: 3, tableName: "TB_PROD_MST", logicalName: "상품마스터", columnCount: 12, description: "판매 상품 정보 관리" }
        ],

        init() {
            console.log("M01002: 메타데이터 관리 모듈 로드");
            this.render();
        },

        render() {
            const tbody = document.getElementById('metadata-tbody');
            if (!tbody) return;

            tbody.innerHTML = this.sampleMetadata.map(item => `
                <tr class="hover:bg-gray-50 border-b transition-colors">
                    <td class="px-4 py-3 text-gray-400 text-sm">${item.id}</td>
                    <td class="px-4 py-3 font-mono text-blue-600 font-bold">${item.tableName}</td>
                    <td class="px-4 py-3 font-medium text-gray-700">${item.logicalName}</td>
                    <td class="px-4 py-3 text-center bg-gray-50/50">${item.columnCount}</td>
                    <td class="px-4 py-3 text-gray-500 text-sm">${item.description}</td>
                    <td class="px-4 py-3 text-center">
                        <button onclick="M01002.openModal(${item.id})" class="bg-gray-100 hover:bg-blue-600 hover:text-white text-gray-600 px-3 py-1 rounded transition text-xs font-bold">수정</button>
                    </td>
                </tr>
            `).join('');

            this.updateSummary();
        },

        updateSummary() {
            const totalDatasets = document.getElementById('total-datasets');
            const totalColumns = document.getElementById('total-columns');
            
            if (totalDatasets) totalDatasets.textContent = this.sampleMetadata.length;
            if (totalColumns) totalColumns.textContent = this.sampleMetadata.reduce((sum, item) => sum + item.columnCount, 0);
        },

        openModal(id) {
            const modal = document.getElementById('metadata-modal');
            if (modal) modal.classList.remove('hidden');
        },

        closeModal() {
            const modal = document.getElementById('metadata-modal');
            if (modal) modal.classList.add('hidden');
        }
    };

    // 전역 초기화 함수 설정
    window.initM01002Page = () => M01002.init();
    window.M01002 = M01002;
})();