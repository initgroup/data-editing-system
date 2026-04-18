/**
 * M02002: 시각화 분석 스크립트
 */
{
    const M02002 = {
        chartInstance: null,
        currentType: 'bar',

        init() {
            console.log("M02002: 시각화 모듈 초기화");
            this.renderChart();
        },

        // 차트 타입 설정 (원본 버튼 액션)
        setChartType(type) {
            this.currentType = type;
            this.renderChart();
        },

        // 차트 렌더링 (원본 visualization.html의 데이터 구조 유지)
        renderChart() {
            const ctx = document.getElementById('mainVisualizationChart');
            if (!ctx) return;

            // 기존 차트 객체 파괴
            if (this.chartInstance) {
                this.chartInstance.destroy();
            }

            const dataSets = {
                labels: ['20대', '30대', '40대', '50대', '60대 이상'],
                datasets: [{
                    label: '연령대별 평균 구매액',
                    data: [210000, 450000, 580000, 420000, 310000],
                    backgroundColor: this.currentType === 'pie' ? 
                        ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'] : 
                        'rgba(99, 102, 241, 0.7)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    fill: true,
                    tension: 0.4
                }]
            };

            this.chartInstance = new Chart(ctx, {
                type: this.currentType,
                data: dataSets,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    },
                    scales: this.currentType !== 'pie' ? {
                        y: { beginAtZero: true, grid: { color: '#f3f4f6' } },
                        x: { grid: { display: false } }
                    } : {}
                }
            });
        },

        updateChart() {
            alert('설정된 필터로 차트를 갱신합니다.');
            this.renderChart();
        },

        exportChart() {
            const link = document.createElement('a');
            link.download = 'data_visualization.png';
            link.href = document.getElementById('mainVisualizationChart').toDataURL();
            link.click();
        }
    };

    // 전역 초기화 함수 및 네임스페이스 등록
    window.initM02002Page = () => M02002.init();
    window.M02002 = M02002;
}