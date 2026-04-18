/**
 * M04001: 보고서 스크립트
 */
{
    const M04001 = {
        charts: {},

        init() {
            console.log("M04001: 통계 보고서 모듈 로드");
            this.updateCurrentDate();
            this.initCharts();
        },

        updateCurrentDate() {
            const dateEl = document.getElementById('preview-date');
            if (dateEl) {
                const now = new Date();
                dateEl.innerText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 기준`;
            }
        },

        initCharts() {
            // 위반 유형 분포 차트 (Pie)
            const typeCtx = document.getElementById('typeChart');
            if (typeCtx) {
                this.charts.type = new Chart(typeCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['형식 위반', '범위 초과', '결측치', '논리 모순'],
                        datasets: [{
                            data: [35, 20, 30, 15],
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'right' } }
                    }
                });
            }

            // 품질 추이 차트 (Line)
            const trendCtx = document.getElementById('trendChart');
            if (trendCtx) {
                this.charts.trend = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: ['W1', 'W2', 'W3', 'W4'],
                        datasets: [{
                            label: '품질 점수',
                            data: [92, 93.5, 91.2, 94.8],
                            borderColor: '#10b981',
                            tension: 0.3,
                            fill: true,
                            backgroundColor: 'rgba(16, 185, 129, 0.1)'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: { y: { beginAtZero: false, min: 80 } }
                    }
                });
            }
        },

        generatePreview() {
            const type = document.getElementById('report-type').value;
            const titleEl = document.getElementById('preview-title');
            
            const titles = {
                'quality': '데이터 품질 분석 보고서 (미리보기)',
                'editing': '에디팅 작업 이력 보고서 (미리보기)',
                'violation': '규칙 위반 현황 보고서 (미리보기)'
            };

            titleEl.innerText = titles[type];
            
            // 시각적 효과를 위한 애니메이션
            const previewArea = document.getElementById('report-preview-area');
            previewArea.style.opacity = '0.5';
            setTimeout(() => {
                previewArea.style.opacity = '1';
                alert(`${titles[type]} 데이터가 갱신되었습니다.`);
            }, 300);
        },

        downloadReport() {
            const type = document.getElementById('report-type').value;
            alert(`[${type}] 보고서가 PDF 파일로 생성되어 다운로드 폴더에 저장되었습니다.`);
        }
    };

    // 전역 초기화 및 네임스페이스 등록
    window.initM04001Page = () => M04001.init();
    window.M04001 = M04001;
}