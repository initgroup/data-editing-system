/**
 * M03001: 위반데이터 검토 스크립트
 */
(function() {
    const M03001 = {
        // 원본 violation-review.html의 데이터 샘플 유지
        violations: [
            { id: 'V-1001', severity: 'critical', ruleName: '급여 범위 위반', detail: 'USER_882 (SALARY: -500)', date: '2024-02-01 10:22', status: 'pending' },
            { id: 'V-1002', severity: 'warning', ruleName: '이메일 형식 미준수', detail: 'USER_104 (EMAIL: test#google.com)', date: '2024-02-01 11:45', status: 'resolved' },
            { id: 'V-1003', severity: 'critical', ruleName: '필수값 누락', detail: 'ORDER_55 (CUST_ID: NULL)', date: '2024-02-02 09:10', status: 'pending' },
            { id: 'V-1004', severity: 'info', ruleName: '데이터 타입 불일치', detail: 'EMP_20 (AGE: "Unknown")', date: '2024-02-02 14:20', status: 'pending' },
            { id: 'V-1005', severity: 'warning', ruleName: '참조 무결성 위반', detail: 'ORD_99 (PROD_ID: P999)', date: '2024-02-02 16:30', status: 'resolved' }
        ],

        init() {
            console.log("M03001: 위반데이터 검토 모듈 로드");
            this.renderTable();
            this.updateStatistics();
        },

        // 테이블 렌더링 및 필터링 (원본 로직 반영)
        renderTable() {
            const tbody = document.getElementById('violation-tbody');
            if (!tbody) return;

            const sevFilter = document.getElementById('severity-filter').value;
            const statFilter = document.getElementById('status-filter').value;

            const filteredData = this.violations.filter(v => {
                const matchSev = (sevFilter === 'all' || v.severity === sevFilter);
                const matchStat = (statFilter === 'all' || v.status === statFilter);
                return matchSev && matchStat;
            });

            tbody.innerHTML = filteredData.map(v => `
                <tr class="hover:bg-gray-50/50 transition-colors">
                    <td class="px-6 py-4">
                        <span class="${this.getSeverityClass(v.severity)} px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter">
                            ${v.severity}
                        </span>
                    </td>
                    <td class="px-6 py-4 font-bold text-gray-700">${v.ruleName}</td>
                    <td class="px-6 py-4 text-gray-500 font-mono text-xs">${v.detail}</td>
                    <td class="px-6 py-4 text-gray-400 text-xs">${v.date}</td>
                    <td class="px-6 py-4">
                        <span class="flex items-center gap-1.5 ${v.status === 'resolved' ? 'text-green-600' : 'text-orange-500'} font-bold">
                            <span class="w-1.5 h-1.5 rounded-full ${v.status === 'resolved' ? 'bg-green-600' : 'bg-orange-500 animate-pulse'}"></span>
                            ${v.status === 'resolved' ? '해결됨' : '조치대기'}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                        <button onclick="M03001.toggleStatus('${v.id}')" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-bold transition">
                            상태변경
                        </button>
                    </td>
                </tr>
            `).join('');
        },

        getSeverityClass(sev) {
            switch(sev) {
                case 'critical': return 'bg-red-100 text-red-700 border border-red-200';
                case 'warning': return 'bg-orange-100 text-orange-700 border border-orange-200';
                default: return 'bg-blue-100 text-blue-700 border border-blue-200';
            }
        },

        updateStatistics() {
            const stats = {
                total: this.violations.length,
                critical: this.violations.filter(v => v.severity === 'critical').length,
                pending: this.violations.filter(v => v.status === 'pending').length,
                resolved: this.violations.filter(v => v.status === 'resolved').length
            };

            const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
            safeSet('total-violations', stats.total);
            safeSet('critical-violations', stats.critical);
            safeSet('pending-violations', stats.pending);
            safeSet('resolved-violations', stats.resolved);
        },

        toggleStatus(id) {
            const item = this.violations.find(v => v.id === id);
            if (item) {
                item.status = (item.status === 'pending' ? 'resolved' : 'pending');
                this.renderTable();
                this.updateStatistics();
            }
        },

        exportViolations() {
            alert('현재 필터링된 위반 데이터 리스트를 Excel로 내보냅니다.');
        }
    };

    // 전역 초기화 함수 설정
    window.initM03001Page = () => M03001.init();
    window.M03001 = M03001;
})();