/**
 * home.js: 메인 대시보드 로직
 */
(function() {
    const home = {
        init() {
            console.log("Home: 대시보드 초기화");
            this.renderCards();
            this.renderChart();
            this.renderAlerts();
        },

        // 상단 요약 카드 렌더링
        renderCards() {
            const container = document.getElementById('home-summary-cards');
            if (!container) return;

            const cards = [
                { title: "전체 데이터", value: "1,284", icon: "fa-database", color: "blue" },
                { title: "위반 의심", value: "42", icon: "fa-exclamation-circle", color: "red" },
                { title: "검토 완료", value: "156", icon: "fa-check-circle", color: "green" },
                { title: "신규 규칙", value: "8", icon: "fa-lightbulb", color: "yellow" }
            ];

            container.innerHTML = cards.map(card => `
                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm text-gray-500 mb-1">${card.title}</p>
                            <h3 class="text-2xl font-bold">${card.value}</h3>
                        </div>
                        <div class="w-12 h-12 bg-${card.color}-50 text-${card.color}-500 rounded-lg flex items-center justify-center text-xl">
                            <i class="fas ${card.icon}"></i>
                        </div>
                    </div>
                </div>
            `).join('');
        },

        // Chart.js 그래프 렌더링
        renderChart() {
            const ctx = document.getElementById('homeStatusChart');
            if (!ctx) return;

            // 기존 차트 객체가 있다면 파괴 (메모리 관리)
            if (this.chart) this.chart.destroy();

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['월', '화', '수', '목', '금', '토', '일'],
                    datasets: [{
                        label: '데이터 에디팅 건수',
                        data: [12, 19, 3, 5, 2, 3, 9],
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
        },

        // 시스템 알림 렌더링
        renderAlerts() {
            const container = document.getElementById('system-alerts');
            if (!container) return;

            const alerts = [
                { type: 'warning', text: '신규 위반 데이터 5건이 감지되었습니다.', time: '10분 전' },
                { type: 'info', text: '오라클 ML 모델 업데이트가 완료되었습니다.', time: '1시간 전' },
                { type: 'success', text: '주간 리포트 자동 생성이 완료되었습니다.', time: '3시간 전' }
            ];

            container.innerHTML = alerts.map(alert => `
                <div class="flex gap-4 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                    <div class="shrink-0 text-sm mt-1">
                        ${alert.type === 'warning' ? '⚠️' : alert.type === 'success' ? '✅' : 'ℹ️'}
                    </div>
                    <div>
                        <p class="text-sm text-gray-700">${alert.text}</p>
                        <span class="text-xs text-gray-400">${alert.time}</span>
                    </div>
                </div>
            `).join('');
        },

        destroy() {
            if (this.chart) this.chart.destroy();
            console.log("Home: 리소스 정리");
        }
    };

    window.home = home;
})();