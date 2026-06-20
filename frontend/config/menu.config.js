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
            },
            {
                page: 'M02003',
                title: '데이터 프로파일링',
                label: '데이터 프로파일링',
                iconClass: 'fas fa-chart-column text-emerald-300',
                enabled: true
            },
            {
                page: 'M02004',
                title: '컬럼간 상관 분석',
                label: '컬럼간 상관 분석',
                iconClass: 'fas fa-link text-emerald-300',
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
                title: '자동 규칙 발굴',
                label: '자동 규칙 발굴',
                iconClass: 'fas fa-wand-magic-sparkles text-amber-300',
                enabled: true
            },
            {
                page: 'M03002',
                title: '회귀 기반 규칙 (연속형 수치 예측/검증)',
                label: '회귀 기반 규칙',
                iconClass: 'fas fa-chart-line text-amber-300',
                enabled: true
            },
            {
                page: 'M03003',
                title: '분류 기반 규칙 (범주형 속성 판별)',
                label: '분류 기반 규칙',
                iconClass: 'fas fa-tags text-amber-300',
                enabled: true
            },
            {
                page: 'M03004',
                title: '군집 기반 규칙 (이상치/아웃라이어 탐지)',
                label: '군집 기반 규칙',
                iconClass: 'fas fa-object-group text-amber-300',
                enabled: true
            },
            {
                page: 'M03005',
                title: '연관 규칙 발굴 (조건부 동시 발생 규칙)',
                label: '연관 규칙 발굴',
                iconClass: 'fas fa-share-nodes text-amber-300',
                enabled: true
            },
            {
                page: 'M03006',
                title: '시계열 패턴 분석 (시간 흐름에 따른 추세 분석)',
                label: '시계열 패턴 분석',
                iconClass: 'fas fa-wave-square text-amber-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-flow',
        label: '에디팅 통합 실행',
        iconClass: 'fas fa-lightbulb text-amber-400',
        enabled: true,
        children: [
            {
                page: 'M04001',
                title: '통합 에디팅 시나리오',
                label: '통합 에디팅 시나리오',
                iconClass: 'fas fa-wave-square text-amber-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-master',
        label: '에디팅 규칙 마스터',
        iconClass: 'fas fa-clipboard-check text-violet-400',
        enabled: true,
        children: [
            {
                page: 'M05001',
                title: '발굴 규칙 선정 (발굴 규칙 후보 검토/저장)',
                label: '발굴 규칙 선정',
                iconClass: 'fas fa-list-check text-violet-300',
                enabled: true
            },
            {
                page: 'M05002',
                title: '사용자 규칙 등록 (발굴 규칙 수정/수동 SQL)',
                label: '사용자 규칙 등록',
                iconClass: 'fas fa-pen-to-square text-violet-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-data',
        label: '데이터 에디팅 및 정제',
        iconClass: 'fas fa-broom text-lime-400',
        enabled: true,
        children: [
            {
                page: 'M06001',
                title: '규칙 위반 데이터 조회',
                label: '규칙 위반 데이터 조회',
                iconClass: 'fas fa-triangle-exclamation text-lime-300',
                enabled: true
            },
            {
                page: 'M06002',
                title: '오류 데이터 정제/수정',
                label: '오류 데이터 정제/수정',
                iconClass: 'fas fa-eraser text-lime-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-apply',
        label: '검증 및 반영',
        iconClass: 'fas fa-circle-check text-cyan-400',
        enabled: true,
        children: [
            {
                page: 'M07001',
                title: '에디팅 효과 검증 (정제 전/후 품질 비교)',
                label: '에디팅 효과 검증',
                iconClass: 'fas fa-circle-check text-cyan-300',
                enabled: true
            },
            {
                page: 'M07002',
                title: 'DB 최종 반영 (Commit)',
                label: 'DB 최종 반영',
                iconClass: 'fas fa-database text-cyan-300',
                enabled: true
            },
            {
                page: 'M07003',
                title: '에디팅 이력 조회',
                label: '에디팅 이력 조회',
                iconClass: 'fas fa-clock-rotate-left text-cyan-300',
                enabled: true
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
                title: '외부 모델 등록 (Python/R 스크립트)',
                label: '외부 모델 등록',
                iconClass: 'fas fa-code text-pink-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'system-setting',
        label: '시스템 설정',
        iconClass: 'fas fa-gears text-slate-300',
        enabled: true,
        children: [
            {
                page: 'M91001',
                title: 'DB 접속 정보 설정',
                label: 'DB 접속 정보 설정',
                iconClass: 'fas fa-plug text-slate-300',
                enabled: true
            },
            {
                page: 'M91002',
                title: '내 환경 설정',
                label: '내 환경 설정',
                iconClass: 'fas fa-sliders text-slate-300',
                enabled: true
            },
            {
                page: 'M91003',
                title: '데이터베이스관리',
                label: '데이터베이스관리',
                iconClass: 'fas fa-server text-slate-300',
                enabled: true
            },
            {
                page: 'M99098',
                title: 'System Management',
                label: 'System Management',
                iconClass: 'fas fa-user-shield text-red-300',
                roles: ['ADMIN'],
                enabled: true
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ['home', 'login', 'M01001', 'M01002', 'M02001', 'M02002', 'M02003', 'M02004', 'M03001', 'M04001', 'M90001', 'M91001', 'M91002', 'M91003', 'M99098'],
    scriptPages: ['home', 'login', 'M01001', 'M01002', 'M02001', 'M02002', 'M02003', 'M02004', 'M03001', 'M04001', 'M90001', 'M91001', 'M91002', 'M91003', 'M99098']
};
