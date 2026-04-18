/**
 * M05001: 시스템 설정 스크립트
 */
{
    const M05001 = {
        init() {
            console.log("M05001: 설정 모듈 로드");
            // 초기 로드 시 프로필 탭 활성화
            this.switchTab('profile');
        },

        /**
         * 탭 전환 로직
         * @param {string} tabId - 'profile', 'system', 'notification'
         */
        switchTab(tabId) {
            const tabs = ['profile', 'system', 'notification'];
            
            tabs.forEach(t => {
                const content = document.getElementById(`tab-content-${t}`);
                const btn = document.getElementById(`tab-btn-${t}`);
                
                if (t === tabId) {
                    // 활성화 상태
                    content.classList.remove('hidden');
                    btn.classList.replace('border-gray-100', 'border-blue-500');
                    btn.classList.replace('text-gray-600', 'text-blue-600');
                    btn.classList.add('shadow-sm', 'font-bold');
                } else {
                    // 비활성화 상태
                    content.classList.add('hidden');
                    btn.classList.replace('border-blue-500', 'border-gray-100');
                    btn.classList.replace('text-blue-600', 'text-gray-600');
                    btn.classList.remove('shadow-sm', 'font-bold');
                }
            });
        },

        saveAllSettings() {
            // 원본 settings.html의 저장 기능 계승
            const confirmSave = confirm('변경된 모든 설정을 저장하시겠습니까?');
            if (confirmSave) {
                // 저장 시뮬레이션
                const btn = event.currentTarget;
                const originalText = btn.innerHTML;
                
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>저장 중...`;
                
                setTimeout(() => {
                    alert('시스템 설정이 마스터 서버에 안전하게 반영되었습니다.');
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }, 1000);
            }
        }
    };

    // 전역 초기화 함수 등록
    window.initM05001Page = () => M05001.init();
    window.M05001 = M05001;
}