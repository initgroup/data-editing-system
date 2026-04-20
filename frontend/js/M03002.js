/**
 * M03002: 에디팅 판단 스크립트
 */
(function() {
    const M03002 = {
        // 원본 데이터 컨텍스트 유지
        currentViolation: {
            id: 'USER_882',
            rule: '급여 범위 위반 (SALARY < 0)',
            value: '-500',
            table: 'POPULATION',
            context: { name: 'Kim Chul-soo', age: 34, dept: 'Sales', date: '2023-05-12' }
        },

        init() {
            console.log("M03002: 에디팅판단 모듈 로드");
            this.loadData();
        },

        // 화면 데이터 바인딩 (원본 컨텐츠 유지)
        loadData() {
            const v = this.currentViolation;
            const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
            
            safeSet('det-id', v.id);
            safeSet('det-rule', v.rule);
            safeSet('det-value', v.value);
            safeSet('det-table', v.table);
            
            // 텍스트 영역 초기화
            const reasonEl = document.getElementById('decision-reason');
            if (reasonEl) reasonEl.value = "";
        },

        // 최종 판단 저장 (원본 기능)
        saveDecision() {
            const selectedAction = document.querySelector('input[name="edit-action"]:checked').value;
            const reason = document.getElementById('decision-reason').value;

            if (!reason.trim()) {
                alert('판단 근거를 입력해 주세요.');
                return;
            }

            const confirmMsg = `
[에디팅 결정 사항]
- 대상: ${this.currentViolation.id}
- 결정: ${this.getActionLabel(selectedAction)}
- 근거: ${reason}

이대로 최종 확정하시겠습니까?`;

            if (confirm(confirmMsg)) {
                alert('성공적으로 저장되었습니다. 위반 데이터 리스트로 이동합니다.');
                // 실제 환경에서는 여기서 API 호출 후 리스트 페이지(M03001)로 이동하는 로직이 들어갑니다.
            }
        },

        getActionLabel(action) {
            const labels = {
                'correct': '데이터 교정',
                'delete': '데이터 삭제',
                'keep': '현상 유지'
            };
            return labels[action] || action;
        }
    };

    // 전역 초기화 함수 및 네임스페이스 등록
    window.initM03002Page = () => M03002.init();
    window.M03002 = M03002;
})();