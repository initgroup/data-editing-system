const API_BASE_URL = "/api";
const FETCH_TIMEOUT = 10000; // 10초 타임아웃 설정
const LOADING_DELAY_MS = 300; // 로딩바 지연 시간 상수화
//const API_BASE_URL = "http://127.0.0.1:8000/api";

const PageManager = {
    modules: {}, // 로드된 모듈들을 저장 (캐시)
    currentModule: null,

    // 페이지 로드 시 실행
    async load(page, title) {
        const body = document.getElementById('contentBody');
        const titleEl = document.getElementById('contentTitle');

        if (titleEl) {
            titleEl.innerText = title; // 이 부분이 실행되는지 확인
        }
        body.innerHTML = `<div class='flex justify-center p-10'><i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>`;
        
        try {
            // 1. HTML 로드
            const htmlRes = await fetch(`./pages/${page}.html`);
            if (!htmlRes.ok) throw new Error('HTML 로드 실패');
            body.innerHTML = await htmlRes.text();

            // 2. 모듈 실행 (이미 로드된 적이 있다면 재사용)
            if (this.modules[page]) {
                this.activateModule(page);
            } else {
                this.injectScript(page);
            }
        } catch (e) {
            body.innerHTML = `<div class="p-10 text-red-500 bg-red-50 rounded-lg">
                <i class="fas fa-exclamation-triangle mr-2"></i>화면을 불러오지 못했습니다: ${e.message}
            </div>`;
        }
    },

    // 스크립트 동적 주입 (최초 1회만 실행됨)
    injectScript(page) {
        // 이미 해당 ID의 스크립트가 있다면 제거 (중복 방지)
        const existingScript = document.getElementById(`script-${page}`);
        if (existingScript) existingScript.remove();

        const script = document.createElement('script');
        script.id = `script-${page}`;
        // v=Date.now()를 제거하여 Sources 탭에 무한 생성되는 것을 방지합니다.
        script.src = `./js/${page}.js`; 
        
        script.onload = () => {
            console.log(`[System] ${page} module registered.`);
            this.activateModule(page);
        };
        document.body.appendChild(script);
    },

    // 모듈 활성화 및 초기화
    activateModule(page) {
        // 이전 모듈 정리 (이벤트 리스너 해제 등)
        if (this.currentModule && typeof this.currentModule.destroy === 'function') {
            this.currentModule.destroy();
        }

        // 새 모듈 초기화
        const module = window[page]; // M01001.js 등에서 window.M01001로 할당한 객체
        if (module && typeof module.init === 'function') {
            module.init();
            this.currentModule = module;
            this.modules[page] = module; // 캐시에 저장
        }
    }
};

const LayoutManager = {
    sidebar: null,
    overlay: null,
    btn: null,
    init() {
        this.sidebar = document.querySelector('.sidebar');
        if (!this.sidebar) return;

        // 1. 오버레이가 없으면 생성 (회색 레이어 역할)
        let overlay = document.getElementById('sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sidebar-overlay';
            // style.css에 정의된 스타일이 적용되도록 id 부여
            document.body.appendChild(overlay);
        }
        this.overlay = overlay;

        // LayoutManager 내의 init 또는 버튼 생성 로직 부분
        if (!document.getElementById('mobile-menu-btn')) {
            const btn = document.createElement('button');
            btn.id = 'mobile-menu-btn';
            // right-4 설정으로 우측 배치, z-index를 높게 설정(사이드바보다 위에 오도록)
            btn.className = 'fixed top-4 right-4 w-12 h-12 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center lg:hidden z-[210] transition-transform active:scale-90';
            btn.innerHTML = '<i class="fas fa-bars"></i>';
            document.body.appendChild(btn);
        }
        this.btn = document.getElementById('mobile-menu-btn');

        // 3. 클릭 이벤트 연결
        if (this.btn) this.btn.onclick = () => this.toggle();
        this.overlay.onclick = () => this.toggle(); // 오버레이 클릭 시 닫기

        // [추가] 메뉴 클릭 시 자동 닫기 (모바일 대응)
        const navLinks = document.querySelectorAll('#mainNav a');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                // 모바일 화면이고 사이드바가 열려있는 경우에만 실행
                if (window.innerWidth <= 1024 && this.sidebar.classList.contains('show')) {
                    this.toggle(); // 사이드바, 오버레이, 버튼 아이콘을 한 번에 원복
                }
            });
        });

        // [추가] 리사이즈 이벤트 강화
        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) {
                // PC 모드로 전환 시 모바일 클래스 강제 제거
                this.sidebar.classList.remove('show');
                this.overlay.classList.remove('active');
                if(this.btn) this.btn.innerHTML = '<i class="fas fa-bars"></i>';
            }
        });
    },

    toggle() {
        if (!this.sidebar) return;
        const isShow = this.sidebar.classList.toggle('show');
        // [핵심] 오버레이에 active 클래스 토글
        if (this.overlay) {
            this.overlay.classList.toggle('active', isShow);
        }
        
        if (this.btn) {
            this.btn.innerHTML = isShow ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
        }
    },

    close() {
        if (!this.sidebar) return;
        this.sidebar.classList.remove('show');
        this.overlay.classList.remove('active');
        this.btn.innerHTML = '<i class="fas fa-bars"></i>';
    }
};

// 기존 DOMContentLoaded에 추가
window.addEventListener('DOMContentLoaded', () => {
    LayoutManager.init();
    PageManager.load('home', '인아이티 Data Editing 시스템');
});
