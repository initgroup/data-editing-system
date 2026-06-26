window.MENU_CONFIG = [
    {
        type: 'page',
        page: 'home',
        title: '인아이티 Data Editing 시스템',
        label: '메인',
        iconClass: 'fas fa-house text-teal-300',
        active: false,
        enabled: true
    },
    {
        type: 'folder',
        key: 'project',
        label: '프로젝트 관리',
        iconClass: 'fas fa-folder-tree text-sky-400',
        enabled: true,
        children: [
            {
                page: 'M01001',
                title: '프로젝트 설정',
                label: '프로젝트 설정',
                iconClass: 'fas fa-folder-plus text-sky-300',
                enabled: true
            },
            {
                page: 'M01002',
                title: '시나리오 정의',
                label: '시나리오 정의',
                iconClass: 'fas fa-route text-sky-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'data-prep',
        label: '데이터 준비 및 탐색',
        iconClass: 'fas fa-database text-emerald-400',
        enabled: true,
        children: [
            {
                page: 'M02001',
                title: '파일 업로드 관리',
                label: '파일 업로드',
                iconClass: 'fas fa-file-arrow-up text-emerald-300',
                enabled: true
            },
            {
                page: 'M02002',
                title: '대상 데이터 선정',
                label: '대상 데이터',
                iconClass: 'fas fa-table text-emerald-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'rule-discovery',
        label: '지능형 규칙 발굴',
        iconClass: 'fas fa-lightbulb text-amber-400',
        enabled: true,
        children: [
            {
                page: 'M03001',
                title: '데이터 프로파일링',
                label: '데이터 프로파일링',
                iconClass: 'fas fa-chart-column text-amber-300',
                enabled: true
            },
            {
                page: 'M03002',
                title: '컬럼간 상관 분석',
                label: '컬럼간 상관 분석',
                iconClass: 'fas fa-link text-amber-300',
                enabled: true
            },
            {
                page: 'M03003',
                title: '자동 규칙 발굴',
                label: '자동 규칙 발굴',
                iconClass: 'fas fa-wand-magic-sparkles text-amber-300',
                enabled: true
            },
            {
                page: 'M03004',
                title: '규칙 위반 탐지',
                label: '규칙 위반 탐지',
                iconClass: 'fas fa-triangle-exclamation text-amber-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-flow',
        label: '에디팅 시나리오',
        iconClass: 'fas fa-lightbulb text-amber-400',
        enabled: true,
        children: [
            {
                page: 'M04001',
                title: '에디팅 시나리오 설계',
                label: '에디팅 시나리오 설계',
                iconClass: 'fas fa-wave-square text-amber-300',
                enabled: true
            },
            {
                page: 'M04002',
                title: '에디팅 시나리오 분석',
                label: '에디팅 시나리오 분석',
                iconClass: 'fas fa-chart-simple text-amber-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-master',
        label: '에디팅 규칙 마스터',
        iconClass: 'fas fa-clipboard-check text-violet-400',
        enabled: false,
        children: [
            {
                page: 'M05001',
                title: '발굴 규칙 선정 (발굴 규칙 후보 검토/저장)',
                label: '발굴 규칙 선정',
                iconClass: 'fas fa-list-check text-violet-300',
                enabled: false
            },
            {
                page: 'M05002',
                title: '사용자 규칙 등록 (발굴 규칙 수정/수동 SQL)',
                label: '사용자 규칙 등록',
                iconClass: 'fas fa-pen-to-square text-violet-300',
                enabled: false
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-data',
        label: '데이터 에디팅 및 정제',
        iconClass: 'fas fa-broom text-lime-400',
        enabled: false,
        children: [
            {
                page: 'M06001',
                title: '규칙 위반 데이터 조회',
                label: '규칙 위반 데이터 조회',
                iconClass: 'fas fa-triangle-exclamation text-lime-300',
                enabled: false
            },
            {
                page: 'M06002',
                title: '오류 데이터 정제/수정',
                label: '오류 데이터 정제/수정',
                iconClass: 'fas fa-eraser text-lime-300',
                enabled: false
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-apply',
        label: '검증 및 반영',
        iconClass: 'fas fa-circle-check text-cyan-400',
        enabled: false,
        children: [
            {
                page: 'M07001',
                title: '에디팅 효과 검증 (정제 전/후 품질 비교)',
                label: '에디팅 효과 검증',
                iconClass: 'fas fa-circle-check text-cyan-300',
                enabled: false
            },
            {
                page: 'M07002',
                title: 'DB 최종 반영 (Commit)',
                label: 'DB 최종 반영',
                iconClass: 'fas fa-database text-cyan-300',
                enabled: false
            },
            {
                page: 'M07003',
                title: '에디팅 이력 조회',
                label: '에디팅 이력 조회',
                iconClass: 'fas fa-clock-rotate-left text-cyan-300',
                enabled: false
            }
        ]
    },
    {
        type: 'folder',
        key: 'model-resource',
        label: '모델 리소스',
        iconClass: 'fas fa-brain text-pink-400',
        enabled: true,
        children: [
            {
                page: 'M90001',
                title: '내부 모델 등록 (프로시저/모델)',
                label: '내부 모델 등록',
                iconClass: 'fas fa-microchip text-pink-300',
                enabled: true
            },
            {
                page: 'M90002',
                title: '외부 모델 등록',
                label: '외부 모델 등록',
                iconClass: 'fas fa-code text-pink-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'system-setting',
        label: '내환경 설정',
        iconClass: 'fas fa-sliders text-slate-300',
        enabled: true,
        children: [
            {
                page: 'M91001',
                title: '나의 회원정보',
                label: '나의 회원정보',
                iconClass: 'fas fa-user text-slate-300',
                enabled: true
            },
            {
                page: 'M91002',
                title: '내 시스템 설정',
                label: '내 시스템 설정',
                iconClass: 'fas fa-sliders text-slate-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'admin-setting',
        label: '관리자설정',
        iconClass: 'fas fa-user-shield text-red-300',
        roles: ['ADMIN'],
        enabled: true,
        children: [
            {
                page: 'M99001',
                title: 'DB 접속 정보 설정',
                label: 'DB 접속 정보 설정',
                iconClass: 'fas fa-plug text-slate-300',
                roles: ['ADMIN'],
                enabled: true
            },
            {
                page: 'M99002',
                title: '데이터베이스관리',
                label: '데이터베이스관리',
                iconClass: 'fas fa-server text-slate-300',
                roles: ['ADMIN'],
                enabled: true
            },
            {
                page: 'M99003',
                title: 'System Management',
                label: 'System Management',
                iconClass: 'fas fa-user-shield text-red-300',
                roles: ['ADMIN'],
                enabled: true
            },
            {
                page: 'M99004',
                title: '공지사항 관리',
                label: '공지사항 관리',
                iconClass: 'fas fa-bullhorn text-slate-300',
                roles: ['ADMIN'],
                enabled: true
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ['home', 'login', 'M01001', 'M01002', 'M02001', 'M02002', 'M03001', 'M03002', 'M03003', 'M03004', 'M04001', 'M04002', 'M05001', 'M05002', 'M06001', 'M06002', 'M07001', 'M07002', 'M07003', 'M90001', 'M90002', 'M91001', 'M91002', 'M99001', 'M99002', 'M99003', 'M99004'],
    scriptPages: ['home', 'login', 'M01001', 'M01002', 'M02001', 'M02002', 'M03001', 'M03002', 'M03003', 'M03004', 'M04001', 'M04002', 'M90001', 'M90002', 'M91001', 'M91002', 'M99001', 'M99002', 'M99003', 'M99004']
};
