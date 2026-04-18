/**
 * home.js: 메인홈(대시보드) 로직
 */
{
    const homeManager = {
        init() {
            console.log("Home: 대시보드 모듈 로드");
            this.renderSummary();
            this.renderAlerts();
            this.initChart();
        },

        renderSummary() {
            const container = document.getElementById('home-summary-cards');
            if (!container) return;

            const data = [
                { title: '전체 데이터셋', value: '1,284', icon: 'fa-database', color: 'blue' },
                { title: '에디팅 완료', value: '856', icon: 'fa-check-circle', color: 'green' },
                { title: '위반 데이터', value: '42', icon: 'fa-exclamation-triangle', color: 'red' },
                { title: '수행 대기', value: '12', icon: 'fa-clock', color: 'amber' }
            ];

            container.innerHTML = data.map(item => `
                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-lg bg-${item.color}-50 flex items-center justify-center text-${item.color}-600 text-xl">
                        <i class="fas ${item.icon}"></i>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500 font-medium">${item.title}</p>
                        <h4 class="text-2xl font-bold text-gray-800">${item.value}</h4>
                    </div>
                </div>
            `).join('');
        },

        renderAlerts() {
            const container = document.getElementById('system-alerts');
            if (!container) return;

            const alerts = [
                { type: 'info', msg: 'TB_CUST_INFO 에디팅이 완료되었습니다.', time: '10분 전' },
                { type: 'warning', msg: '새로운 위반 규칙이 탐색되었습니다.', time: '1시간 전' },
                { type: 'error', msg: '데이터베이스 연결 상태를 확인하세요.', time: '3시간 전' }
            ];

            container.innerHTML = alerts.map(a => `
                <div class="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                    <div class="mt-1"><i class="fas fa-circle text-[8px] ${a.type === 'error' ? 'text-red-500' : 'text-blue-500'}"></i></div>
                    <div class="flex-1">
                        <p class="text-sm text-gray-700 font-medium">${a.msg}</p>
                        <span class="text-xs text-gray-400">${a.time}</span>
                    </div>
                </div>
            `).join('');
        },

        initChart() {
            const ctx = document.getElementById('homeStatusChart');
            if (!ctx) return;

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['월', '화', '수', '목', '금', '토', '일'],
                    datasets: [{
                        label: '에디팅 수행 건수',
                        data: [65, 59, 80, 81, 56, 55, 40],
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#f3f4f6' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    };

    // index.html에서 호출할 초기화 함수 등록
    window.inithomePage = function() {
        homeManager.init();
    };
}