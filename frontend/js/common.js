/**
 * common.js: 시스템 전역 공통 유틸리티
 */
const CommonUI = {
    // --- [로딩바 제어 영역] ---
    /**
     * 동기식 작업 시 화면을 차단하고 로딩바를 표시
     * [요구사항 8] 반영
     */
    showLoading() {
        const loader = document.getElementById('customLoadingBar');
        if (loader) {
            loader.classList.remove('hidden');
            loader.style.display = 'flex'; // Tailwind hidden 해제 후 flex 적용
        }
    },

    /**
     * 로딩바 숨기기
     */
    hideLoading() {
        const loader = document.getElementById('customLoadingBar');
        if (loader) {
            loader.classList.add('hidden');
            loader.style.display = 'none';
        }
    },

    // --- [메시지 알림 영역] ---
    /**
     * 에러 메시지 표시 (자동으로 사라지지 않음)
     */
    showError(msg) {
        this._display(msg, 'error');
    },

    /**
     * 성공 메시지 표시
     */
    showSuccess(msg) {
        this._display(msg, 'success');
    },

    /**
     * 메시지 영역 숨기기 (조회 시작 시 또는 X 버튼 클릭 시)
     * [요구사항 7] 반영
     */
    hideMessage() {
        const box = document.getElementById('errorBox');
        if (box) {
            // 2. 숨길 때 여백도 함께 제거하여 본문이 위로 딱 붙게 함
            box.classList.add('hidden');
            box.classList.remove('mb-6');
        }
    },

    /**
     * 내부 메시지 렌더링 함수
     * @private
     */
    _display(msg, type) {
        const box = document.getElementById('errorBox');
        const text = document.getElementById('errorMsgText');
        const icon = document.getElementById('errorIcon');
        
        if (!box || !text) return;

        text.innerText = msg;
        
        // 1. 메시지 표시와 동시에 하단 여백 추가 (평소엔 0)
        box.classList.remove('hidden');
        box.classList.add('mb-6'); 

        if (type === 'success') {
            box.className = "relative border-l-4 p-4 rounded-md shadow-sm mb-6 bg-green-50 border-green-500 text-green-800 transition-all";
            if (icon) icon.className = "fas fa-check-circle mr-3 text-lg text-green-500";
        } else {
            box.className = "relative border-l-4 p-4 rounded-md shadow-sm mb-6 bg-red-50 border-red-500 text-red-800 transition-all";
            if (icon) icon.className = "fas fa-exclamation-circle mr-3 text-lg text-red-500";
        }
    },

    /**
     * [요구사항 9] 객체 Null 및 에러 방지 유틸
     */
    nvl(val, replaceStr = '') {
        return (val === undefined || val === null) ? replaceStr : val;
    },

    // --- [신규: 그리드 관련 공통 함수 본체] ---
    /**
     * Grid.js 공통 생성 함수
     */
    createGrid(elementId, options) {
        if (typeof gridjs === 'undefined') {
            console.error("Grid.js 라이브러리가 로드되지 않았습니다.");
            return null;
        }

        const defaultOptions = {
            width: '100%',     // 부모 컨테이너 가로폭에 맞춤
            autoWidth: true,   // 컬럼 너비 자동 계산
            fixedHeader: true, // 헤더 고정 (유지)
            resizable: true,
            // 기본 페이징 설정
            pagination: { 
                limit: 10, 
                summary: true, 
                buttonsCount: 5 
            },
            sort: false,
            resizable: true,
            // 한국어 메시지 설정
            language: {
                'pagination': {
                    'previous': '이전',
                    'next': '다음',
                    'showing': '검색 결과',
                    'results': () => '건',
                    'of': '/',
                    'to': '-'
                },
                'noRecordsFound': '조회된 데이터가 없습니다.',
                'loading': '데이터를 불러오는 중...',
            },
            // 스타일 클래스 주입
            className: {
                table: 'min-w-full custom-grid-table', // CSS 클래스 추가
                th: 'gridjs-th',
                td: 'gridjs-td',
                pagination: 'gridjs-pagination'
            }
        };

        // 사용자가 전달한 options와 기본 설정을 병합 (Deep merge 권장하나 간단히 assign)
        const finalOptions = Object.assign({}, defaultOptions, options);
        
        const grid = new gridjs.Grid(finalOptions);
        grid.render(document.getElementById(elementId));
        
        return grid;
    },

    /**
     * 그리드 행 선택 시 배경색 변경 이벤트 바인딩
     */
    bindGridRowClick(elementId) {
        const container = document.getElementById(elementId);
        if (!container) return;

        container.addEventListener('click', (e) => {
            const tr = e.target.closest('tr');
            if (tr && tr.parentElement.tagName === 'TBODY') {
                // 이전 선택된 행 배경색 초기화
                tr.parentElement.querySelectorAll('tr').forEach(el => el.classList.remove('bg-blue-100'));
                // 현재 행 배경색 변경
                tr.classList.add('bg-blue-100');
            }
        });
    }
};

// 전역 노출 설정 (이 부분이 있어야 M00000.js에서 찾을 수 있음)
window.CommonUI = CommonUI;
window.showLoading = () => CommonUI.showLoading();
window.hideLoading = () => CommonUI.hideLoading();
window.showError = (msg) => CommonUI.showError(msg);
window.showSuccess = (msg) => CommonUI.showSuccess(msg);
window.hideMessage = () => CommonUI.hideMessage();

// M00000.js에서 호출하는 핵심 함수 연결
window.createGrid = function(id, options) {
    return CommonUI.createGrid(id, options);
};