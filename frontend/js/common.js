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
            // [개선] 즉시 숨기지 않고 투명도 조절로 부드럽게 처리
            box.style.opacity = '0';
            // 애니메이션 후 공간을 비워야 할 때만 hidden (선택 사항)
            setTimeout(() => {
                if(box.style.opacity === '0') box.classList.add('invisible'); 
            }, 300);
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

        // 1. 메시지 텍스트 삽입
        text.innerText = msg;
        
        // 2. 초기 상태 설정 (숨김 해제 및 애니메이션 준비)
        box.classList.remove('hidden', 'invisible');
        
        // 3. 타입에 따른 스타일 결정 (중복 제거 및 최적화)
        // 공통 스타일: 하단 고정용 그림자(shadow-2xl)와 클릭 허용(pointer-events-auto) 포함
        let baseClass = "pointer-events-auto relative border-l-4 p-4 rounded-md shadow-2xl transition-all duration-300 animate-slideUp ";
        
        if (type === 'success') {
            // 성공 스타일
            box.className = baseClass + "bg-green-50 border-green-500 text-green-800";
            if (icon) icon.className = "fas fa-check-circle mr-3 text-lg text-green-500";
        } else {
            // 에러 스타일
            box.className = baseClass + "bg-red-50 border-red-500 text-red-800";
            if (icon) icon.className = "fas fa-exclamation-circle mr-3 text-lg text-red-500";
        }

        // 4. 투명도 강제 적용 (CSS transition 연동)
        box.style.opacity = '1';
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
    },

    /**
     * 특정 컨테이너 내의 모든 입력 요소 초기화
     * @param {string} containerId - 초기화할 영역의 ID
     */
    clearInputs(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 1. input(text, date), select 초기화
        container.querySelectorAll('input[type="text"], input[type="date"], select').forEach(el => {
            el.value = '';
            if (el.tagName === 'SELECT' && el.id === 'subCombo') {
                el.disabled = true; // 서브 콤보박스는 비활성화 상태로 복구
                el.innerHTML = '<option value="">메인 먼저 선택</option>';
            }
        });

        // 2. 체크박스 해제
        container.querySelectorAll('input[type="checkbox"]').forEach(el => {
            el.checked = false;
        });

        // 3. 메시지 숨기기
        this.hideMessage();
    }
};

const DataEditingSystem = {
    /**
     * JSON 데이터를 CSV 파일로 변환하여 다운로드
     * @param {Array} data - 다운로드할 객체 배열
     * @param {string} fileName - 저장될 파일명
     */
    downloadCSV(data, fileName) {
        if (!data || !data.length) return;

        // 1. 헤더 추출 (첫 번째 객체의 키값)
        const headers = Object.keys(data[0]);
        
        // 2. CSV 내용 생성 (BOM 추가로 엑셀 한글 깨짐 방지)
        const csvRows = [];
        csvRows.push(headers.join(',')); // 헤더 행

        for (const row of data) {
            const values = headers.map(header => {
                const escaped = ('' + row[header]).replace(/"/g, '\\"');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        }

        const csvString = '\uFEFF' + csvRows.join('\n'); // 한글 깨짐 방지 BOM 추가
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        // 3. 가상 링크 생성 및 클릭
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

// 전역 노출 설정 (이 부분이 있어야 M00000.js에서 찾을 수 있음)
window.CommonUI = CommonUI;
// 전역 객체로 노출 (M00000.js에서 참조 가능하도록)
window.DataEditingSystem = DataEditingSystem;
window.showLoading = () => CommonUI.showLoading();
window.hideLoading = () => CommonUI.hideLoading();
window.showError = (msg) => CommonUI.showError(msg);
window.showSuccess = (msg) => CommonUI.showSuccess(msg);
window.hideMessage = () => CommonUI.hideMessage();
window.clearInputs = (id) => CommonUI.clearInputs(id);

// M00000.js에서 호출하는 핵심 함수 연결
window.createGrid = function(id, options) {
    return CommonUI.createGrid(id, options);
};