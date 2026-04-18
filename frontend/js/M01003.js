/**
 * M01003.js: 프로파일링 로직
 */
{
    const M01003 = {
        init() {
            console.log("M01003: 기초 통계 및 이상치 탐지 모듈 로드");
            this.render();
        },

        render() {
            // 요약 카드 데이터 (원본 기반)
            const summaryContainer = document.getElementById('summary-cards');
            if (summaryContainer) {
                const summaries = [
                    { label: '결측치율', value: '4.2%', sub: '3,102건', color: 'text-red-600', bg: 'bg-red-50' },
                    { label: '중복도', value: '1.2%', sub: '128건', color: 'text-orange-600', bg: 'bg-orange-50' },
                    { label: '품질 등급', value: 'B+', sub: '92/100 점', color: 'text-green-600', bg: 'bg-green-50' }
                ];
                summaryContainer.innerHTML = summaries.map(s => `
                    <div class="${s.bg} p-6 rounded-xl border border-white/50 shadow-sm">
                        <div class="text-xs font-bold text-gray-500 uppercase tracking-tighter">${s.label}</div>
                        <div class="text-3xl font-black ${s.color} mt-1">${s.value}</div>
                        <div class="text-xs text-gray-400 mt-1">${s.sub}</div>
                    </div>
                `).join('');
            }

            // 품질 지표 (완결성, 유효성, 일관성)
            const qualityContainer = document.getElementById('quality-list');
            if (qualityContainer) {
                const scores = [
                    { label: '완결성 (Completeness)', score: 95, color: 'bg-blue-500' },
                    { label: '유효성 (Validity)', score: 88, color: 'bg-emerald-500' },
                    { label: '일관성 (Consistency)', score: 92, color: 'bg-amber-500' }
                ];
                qualityContainer.innerHTML = scores.map(s => `
                    <div>
                        <div class="flex justify-between text-sm mb-2">
                            <span class="font-bold text-gray-600">${s.label}</span>
                            <span class="font-black text-blue-700">${s.score}%</span>
                        </div>
                        <div class="w-full bg-gray-100 rounded-full h-2.5">
                            <div class="${s.color} h-2.5 rounded-full transition-all duration-1000" style="width: ${s.score}%"></div>
                        </div>
                    </div>
                `).join('');
            }

            this.initChart();
        },

        initChart() {
            const ctx = document.getElementById('profilingChart');
            if (!ctx) return;
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['ID', 'NAME', 'AGE', 'ADDR', 'EMAIL'],
                    datasets: [
                        { label: '결측치', data: [0, 5, 20, 15, 30], backgroundColor: '#f87171' },
                        { label: '이상치', data: [2, 0, 10, 5, 1], backgroundColor: '#fbbf24' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });
        },

        runAnalysis() {
            const ds = document.getElementById('dataset-select').value;
            if (!ds) return alert('대상 데이터셋을 선택해 주세요.');
            alert("Oracle ML을 활용하여 기초 통계량 분석 및 이상치 탐지를 수행합니다.");
            this.render();
        }
    };

    // 전역 초기화 함수
    window.initM01003Page = () => M01003.init();
    window.M01003 = M01003;
}