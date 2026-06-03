/**
 * M02003: 규칙 확정 스크립트
 */
(function() {
    const M02003 = {
        // 원본 rule-confirmation.html의 샘플 데이터 구조 유지
        rules: [
            { id: 'R-001', name: '급여 범위 체크', target: 'SALARY', table: 'POPULATION', status: '대기' },
            { id: 'R-002', name: '이메일 형식 유효성', target: 'EMAIL', table: 'CUSTOMERS', status: '승인' },
            { id: 'R-003', name: '가구원 수 논리 체크', target: 'MEMB_CNT', table: 'HOUSEHOLD', status: '대기' },
            { id: 'R-004', name: '전화번호 패턴 확인', target: 'TEL_NO', table: 'CUSTOMERS', status: '거부' }
        ],

        init() {
            console.log("M02003: 규칙 확정 모듈 로드");
            this.renderRulesTable();
            this.updateStatistics();
        },

        // 테이블 렌더링 (원본 스타일 및 텍스트 유지)
        renderRulesTable() {
            const tbody = document.getElementById('rules-tbody');
            if (!tbody) return;

            tbody.innerHTML = this.rules.map(rule => `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4 text-center"><input type="checkbox" class="rounded"></td>
                    <td class="px-6 py-4 font-mono text-xs text-gray-400">${rule.id}</td>
                    <td class="px-6 py-4 font-bold text-gray-700">${rule.name}</td>
                    <td class="px-6 py-4">
                        <div class="text-xs text-gray-500">${rule.table}</div>
                        <div class="text-sm font-medium text-blue-600">${rule.target}</div>
                    </td>
                    <td class="px-6 py-4">
                        <span class="${this.getStatusClass(rule.status)} px-2.5 py-1 rounded-full text-[11px] font-bold">
                            ${rule.status}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right space-x-1">
                        ${rule.status === '대기' ? `
                            <button onclick="M02003.changeStatus('${rule.id}', '승인')" class="text-green-600 hover:bg-green-50 p-2 rounded-lg transition" title="승인">
                                <i class="fas fa-check"></i>
                            </button>
                            <button onclick="M02003.changeStatus('${rule.id}', '거부')" class="text-red-600 hover:bg-red-50 p-2 rounded-lg transition" title="거부">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : `
                            <button onclick="M02003.changeStatus('${rule.id}', '대기')" class="text-gray-400 hover:bg-gray-100 p-2 rounded-lg transition" title="재검토">
                                <i class="fas fa-undo"></i>
                            </button>
                        `}
                    </td>
                </tr>
            `).join('');
        },

        // 상태별 뱃지 스타일
        getStatusClass(status) {
            switch(status) {
                case '승인': return 'bg-green-100 text-green-700';
                case '거부': return 'bg-red-100 text-red-700';
                default: return 'bg-yellow-100 text-yellow-700';
            }
        },

        // 통계 업데이트 로직 (원본 기능)
        updateStatistics() {
            const stats = {
                total: this.rules.length,
                pending: this.rules.filter(r => r.status === '대기').length,
                approved: this.rules.filter(r => r.status === '승인').length,
                rejected: this.rules.filter(r => r.status === '거부').length
            };

            document.getElementById('total-rules').innerText = stats.total;
            document.getElementById('pending-rules').innerText = stats.pending;
            document.getElementById('approved-rules').innerText = stats.approved;
            document.getElementById('rejected-rules').innerText = stats.rejected;
        },

        // 상태 변경 로직
        changeStatus(id, newStatus) {
            const rule = this.rules.find(r => r.id === id);
            if (rule) {
                rule.status = newStatus;
                this.renderRulesTable();
                this.updateStatistics();
            }
        },

        approveSelected() {
            if (confirm('선택한 대기 중인 모든 규칙을 승인하시겠습니까?')) {
                this.rules.forEach(r => { if(r.status === '대기') r.status = '승인'; });
                this.renderRulesTable();
                this.updateStatistics();
            }
        }
    };

    // 전역 초기화 함수 및 네임스페이스 등록
    window.initM02003Page = () => M02003.init();
    window.M02003 = M02003;
})();