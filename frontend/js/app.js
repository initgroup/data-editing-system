const API_BASE_URL = "/api";
const FETCH_TIMEOUT = 10000; // 10초 타임아웃 설정
const LOADING_DELAY_MS = 300; // 로딩바 지연 시간 상수화
const APP_VERSION = "1.0.2"; // 앱 전체 버전 관리 - 배포 시 이 숫자를 올리면 캐시가 갱신됩니다.
//const API_BASE_URL = "http://127.0.0.1:8000/api";

const PageManager = {
    modules: {}, // 로드된 모듈들을 저장 (캐시)
    containers: {}, // [중요] 이 줄이 누락되어 에러가 발생한 것입니다.
    lastLoadedVersion: null, // [명시적 선언] 마지막으로 로드된 버전을 저장하는 변수

    /**
     * 각 페이지 모듈에서 공통으로 사용할 헬퍼 함수 생성
     * @param {string} pageCode - 페이지 코드 (예: 'M01001')
     */
    createHelper(pageCode) {
        return {
            // getEl container-페이지코드 하위가 아닌 다른 영역에서 id-페이지코드 명칭으로 찾을 때 사용 
            // 예) page-section-M01001 등
            getEl: (id) => document.getElementById(`${id}-${pageCode}`),
            
            // [핵심 수정] selector로 요소를 찾을 때 'container-pageCode' 내부에서만 탐색
            getContainerEl: (selector) => {
                // M01001.html의 최상위 루트인 container-M01001을 기준으로 탐색
                const container = document.getElementById(`container-${pageCode}`);
                return container ? container.querySelector(selector) : null;
            }
        };
    },

    /**
     * 특정 페이지 섹션만 활성화하고 나머지는 숨김
     * @param {string} pageCode - 보여줄 페이지 코드
     */
    show(pageCode) {
        // 1. 모든 페이지 섹션에서 'active' 클래스 제거 (전체 숨김)
        document.querySelectorAll('.page-section').forEach(section => {
            section.classList.remove('active');
            section.style.display = 'none'; 
        });

        // 2. 선택한 페이지 섹션에만 'active' 클래스 추가 (선택된 것만 표시)
        const targetContainer = this.containers[pageCode];
        if (targetContainer) {
            targetContainer.classList.add('active');
            targetContainer.style.display = 'block';
        }

        // 3. [추가] 현재 pageCode에 해당하는 사이드 메뉴 하이라이트 처리
        // 먼저 기존에 붙어있던 모든 menu-active 클래스를 제거합니다.
        document.querySelectorAll('#mainNav a').forEach(el => {
            el.classList.remove('menu-active');
        });

        // HTML에 작성된 data-page="M01001" 속성을 가진 요소를 정확히 찾습니다.
        const targetMenu = document.querySelector(`#mainNav a[data-page="${pageCode}"]`);
        
        if (targetMenu) {
            targetMenu.classList.add('menu-active');
            targetMenu.classList.add('visited-menu');
            
            // (선택사항) 해당 메뉴가 속한 서브메뉴가 닫혀있다면 자동으로 펼쳐주는 로직
            const parentSubmenu = targetMenu.closest('.submenu');
            if (parentSubmenu && parentSubmenu.classList.contains('hidden')) {
                parentSubmenu.classList.remove('hidden');
                // 부모 폴더의 화살표 아이콘 회전
                const folderBtn = parentSubmenu.previousElementSibling;
                if (folderBtn) {
                    const arrow = folderBtn.querySelector('.fa-chevron-down');
                    if (arrow) arrow.classList.add('rotate-180');
                }
            }
        }
    },    

    /**
     * 모든 열린 페이지 닫기
     * @returns 
     */
    closeAll() {
        console.log("[System] 모든 페이지 자원 해제 시작");

        // 1. 현재 열려 있는 모든 페이지 코드(Key) 추출
        const openPages = Object.keys(this.containers);

        if (openPages.length === 0) {
            alert("열려 있는 페이지가 없습니다.");
            return;
        }

        // 2. 각 페이지를 순회하며 close 호출
        // 마지막 페이지에서만 홈으로 이동하도록 moveToMain을 false로 설정하고 반복
        openPages.forEach((pageCode, index) => {
            // 루프의 마지막 요소일 때만 홈으로 이동하도록 처리
            const isLast = (index === openPages.length - 1);
            
            // 기존에 만든 close 함수를 그대로 활용 (스타일 삭제, 메모리 해제 포함)
            this.close(pageCode, isLast);
        });

        console.log("[System] 모든 페이지가 성공적으로 닫혔습니다.");
    },

    /**
     * 탭 닫기 공통 스크립트 예시
     * @param {*} pageCode 
     * @param {*} moveToMain 
     */
    close(pageCode, moveToMain = true) {
        // [추가] 홈 페이지는 닫기 대상에서 제외
        if (pageCode === 'home') {
            console.log("[System] 홈 페이지는 닫을 수 없습니다.");
            return;
        }
        console.log(`[System] ${pageCode} 자원 해제 시작`);

        // JS 객체 및 메모리 해제 (M01001.destroy() 호출 등)
        const targetModule = window[pageCode] || this.modules[pageCode];
        if (targetModule) {
            if (typeof targetModule.destroy === 'function') {
                targetModule.destroy(); // 그리드/차트 인스턴스 제거 로직 실행
            }
        }
        
        // DOM 제거
        const container = document.getElementById(`page-section-${pageCode}`);
        if (container) {
            // [중요] jQuery 등을 쓴다면 내부 이벤트 제거를 위해 empty() 후 remove() 권장
            container.innerHTML = '';
            container.remove();
            delete this.containers[pageCode];
        }

        // 스크립트 태그 물리적 제거
        const scriptTag = document.querySelector(`script[src*="${pageCode}.js"]`);
        if (scriptTag) scriptTag.remove();

        // [핵심] 현재 닫는 페이지의 메뉴 스타일만 초기화
        // 해당 pageCode를 data-page로 가지고 있는 메뉴 요소를 찾습니다.
        const closedMenu = document.querySelector(`#mainNav [data-page="${pageCode}"]`);
        if (closedMenu) {
            // 방문 스타일(녹색 폰트 등)과 활성 스타일을 해당 메뉴에서만 제거
            closedMenu.classList.remove('visited-menu', 'menu-active', 'bg-blue-700', 'text-green-500');
        }

        // 3. 메모리 해제
        if (window[pageCode]) {
            if (typeof window[pageCode].destroy === 'function') {
                window[pageCode].destroy();
            }
            delete window[pageCode];
        }
        delete this.modules[pageCode];

        // 3. 메인 페이지로 이동 (필요 시)
        if (moveToMain) {            
            // Home 화면을 보여주거나 첫 번째 열린 탭으로 이동하는 로직
            const homeMenu = document.querySelector('#mainNav [data-page="home"]');
            
            if (homeMenu) {
                // 이미 정의된 handleMenuClick을 호출하기 위해 클릭 이벤트를 발생시킵니다.
                homeMenu.click(); 
            } else {
                // 혹시 메뉴를 못 찾을 경우를 대비한 fallback (예비책)
                location.hash = '#';
                const titleEl = document.getElementById('contentTitle');
                if (titleEl) titleEl.innerText = "인아이티 Data Editing 시스템";
                
                // 모든 메뉴 활성화 해제
                document.querySelectorAll('#mainNav a, #mainNav button').forEach(el => {
                    el.classList.remove('menu-active', 'bg-blue-700');
                });
            }
        }
    },

    /**
     * 페이지 HTML을 Fetch하여 컨테이너에 주입
     * @param {string} pageCode 
     */
    async injectHtml(pageCode) {
        const container = this.containers[pageCode];
        if (!container) throw new Error(`컨테이너가 생성되지 않았습니다: ${pageCode}`);

        try {
            // HTML 로드 시 APP_VERSION을 붙여 캐시 방지
            const response = await fetch(`./pages/${pageCode}.html?v=${APP_VERSION}`);
            
            if (!response.ok) {
                throw new Error(`HTML 파일({${pageCode}.html})을 찾을 수 없거나 로드에 실패했습니다.`);
            }

            const htmlText = await response.text();
            
            // [중요] innerHTML 주입
            container.innerHTML = htmlText;
            
            return true;
        } catch (error) {
            console.error(`[injectHtml] Error:`, error);
            throw error;
        }
    },

    // 스크립트 동적 주입 (최초 1회만 실행됨)
    injectScript(pageCode, force = false) {
        return new Promise((resolve, reject) => {
            // 중복 로드 방지: 이미 해당 스크립트가 있다면 바로 종료
            if (!force && document.querySelector(`script[src*="${pageCode}.js"]`)) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = `./js/${pageCode}.js?v=${APP_VERSION}`;
            script.async = true;

            script.onload = () => {
                console.log(`[Script Loaded] ${pageCode}.js`);
                resolve(); // 로드 완료 알림
            };

            script.onerror = () => {
                console.error(`[Script Error] Failed to load ${pageCode}.js`);
                reject(new Error(`Script load error: ${pageCode}`));
            };

            document.body.appendChild(script);
        });
    },

    /**
     * 페이지 로드 시 실행
     * @param {*} pageCode 
     * @param {*} title 
     * @param {*} isRefresh 
     * @returns 
     */
    async load(pageCode, title, isRefresh = false) {    
        const containerId = `page-section-${pageCode}`;

        // 1. 이미 열린 페이지인데 새로고침이 아닐 경우 -> 화면 전환만 수행
        if (this.containers[pageCode] && !isRefresh) {
            this.show(pageCode);
            if (title) document.getElementById('contentTitle').innerText = title;
            return;
        }        

        // 2. 새로고침(forceRefresh)인 경우 기존 자원 해제 (중요!)
        if (isRefresh) {
            this.close(pageCode, false); // false를 넘겨서 메인 이동은 방지
        }        

        // 3. 신규 컨테이너 생성 및 표시
        const holder = document.getElementById('pageContainerHolder'); 
        const container = document.createElement('div');
        container.id = containerId;
        container.className = 'page-section active'; // 초기 생성시 active 부여
        holder.appendChild(container);
        this.containers[pageCode] = container;     

        CommonUI.showLoading();

        try {
            // 4. HTML 주입 (분리한 함수 호출)
            await this.injectHtml(pageCode);
            
            // 5. 스크립트 주입 (isRefresh = true 이면 강제 로드)
            await this.injectScript(pageCode, isRefresh);

            // 6. 모듈 초기화
            const module = window[pageCode];
            if (module && typeof module.init === 'function') {
                this.modules[pageCode]=module; // 캐시등록
                await module.init();
            }            
            
            this.show(pageCode);
        } catch (e) {
            CommonUI.showPageError(pageCode, e.message);
        } finally {
            CommonUI.hideLoading();
            if (title) document.getElementById('contentTitle').innerText = title;
            // 스크립트 로드 시점에 버전 기록
            this.lastLoadedVersion = APP_VERSION;
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

        // [수정] 폴더 클릭 이벤트 바인딩을 init 단계에서 수행
        this.bindFolderEvents();

        // [추가] 초기 로딩 시 모든 폴더 메뉴 펼치기
        this.expandAllMenus();        

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
    // 폴더 클릭 시 열고 닫기 + 아이콘 회전 통합 관리
    bindFolderEvents() {
        const folderButtons = document.querySelectorAll('.menu-folder button');
        folderButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const submenu = button.nextElementSibling;
                const icon = button.querySelector('.fa-chevron-down');
                
                // 서브메뉴 토글
                if (submenu) {
                    submenu.classList.toggle('hidden');
                }
                
                // 아이콘 회전 토글
                if (icon) {
                    icon.classList.toggle('rotate-180');
                }
            });
        });
    },

    // 모든 메뉴를 펼치는 신규 메서드
    expandAllMenus() {
        // 1. 모든 서브메뉴 보이기
        const submenus = document.querySelectorAll('.submenu');
        submenus.forEach(menu => {
            menu.classList.remove('hidden');
        });

        // 2. 모든 폴더 아이콘 회전 (화살표 방향 변경)
        const folderIcons = document.querySelectorAll('.menu-folder .fa-chevron-down');
        folderIcons.forEach(icon => {
            icon.classList.add('rotate-180');
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

const ConsoleLogger = {
    isEnabled: false, // 로그 출력 여부 상태 변수
    maxLines: 500, // 최대 보관 라인 수    

    // 초기화 함수: 페이지 로드 시 호출하여 이벤트 바인딩
    init() {
        const toggle = document.getElementById('chkLogToggle');
        const statusText = document.getElementById('logStatusTextText');
        
        if (toggle) {
            // 체크박스 변경 시 상태 업데이트
            toggle.addEventListener('change', (e) => {
                this.isEnabled = e.target.checked;
                if (statusText) {
                    statusText.innerText = this.isEnabled ? "LOG ON" : "LOG OFF";
                    statusText.style.color = this.isEnabled ? "#94a3b8" : "#ef4444";
                }
            });
        }
    },

    toggle() {
        this.isEnabled = !this.isEnabled;
        
        // UI 업데이트
        const container = document.querySelector('.log-toggle');
        const track = document.getElementById('logSwitch');
        const text = document.getElementById('logStatusText');

        if (this.isEnabled) {
            container.classList.remove('off');
            track.classList.add('active');
            text.innerText = 'ON';
        } else {
            container.classList.add('off');
            track.classList.remove('active');
            text.innerText = 'OFF';
        }
    },

    info(msg, source = 'System', location = '') {
        if (!this.isEnabled) return; // 분기 처리: 꺼져있으면 중단
        this._write('info', msg, source, location);
    },

    error(msg, source = 'System', location = '') {
        // 에러는 중요하므로 ON/OFF와 상관없이 출력하고 싶다면 이 조건문을 빼도 됩니다.
        if (!this.isEnabled) return; 
        this._write('error', msg, source, location);
    },

    warn(msg, source = 'System', location = '') {
        if (!this.isEnabled) return;
        this._write('warn', msg, source, location);
    },

    /**
     * 로그 출력 실행
     * @param {string} level - info, error, warn
     * @param {string} msg - 메시지 내용
     * @param {string} source - 소스 위치
     * @param {string} location - 명령 위치
     */
    _write(level, msg, source, location) {
        const targetMsg = document.getElementById("consoleMsg");
        const targetErr = document.getElementById("consoleErr");
        const scrollParent = document.getElementById("consoleBody"); // 스크롤은 부모가 담당
        if (!targetMsg || !targetErr ||!scrollParent) return;

        // 1. 시간 생성 (YYYY-MM-DD HH:mm:ss.SSS)
        const now = new Date();
        const timeStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ` +
                        `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

        // 2. 로그 라인 생성
        const logLine = document.createElement("pre");
        logLine.className = `console-line log-${level}`;
        logLine.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-level">[${level.toUpperCase()}]</span> <span class="log-location">${source} > ${location}</span> : ${msg}`;
        
        // 3. 화면 추가(로그창에는 항상 추가)
        targetMsg.appendChild(logLine);
        
        // 4. 메모리 관리 (오래된 로그 삭제)
        while (targetMsg.children.length > this.maxLines) {
            targetMsg.removeChild(targetMsg.firstChild);
        }

        // 5. 에러는 에러콘솔에 별도 추가
        if(level === 'error') {
            const logLineErr = document.createElement("pre");
            logLineErr.className = `console-line log-${level}`;
            logLineErr.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-level">[${level.toUpperCase()}]</span> <span class="log-location">${source} > ${location}</span> : ${msg}`;
            
            targetErr.appendChild(logLineErr);        
            while (targetErr.children.length > this.maxLines) {
                targetErr.removeChild(targetErr.firstChild);
            }
        }

        // [스크롤 해결] 렌더링 사이클을 고려하여 setTimeout(0) 사용
        setTimeout(() => {
            scrollParent.scrollTop = scrollParent.scrollHeight;
        }, 0);
    }
};

/**
 * AI Chat Manager: 오라클 LLM 연동 로직
 */
const AIChatManager = {
    init() {
        const input = document.getElementById('chatInputText');
        const btn1 = document.getElementById('btnSendChat1');
        const btn2 = document.getElementById('btnSendChat2');

        if (btn1) btn1.onclick = () => this.sendQuestion('sql');
        if (btn2) btn2.onclick = () => this.sendQuestion('data');
        if (input) {
            input.onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') this.sendQuestion('sql');
            };
        }
    },

    async sendQuestion(mode = 'sql') {
        const input = document.getElementById('chatInputText');
        const question = input.value.trim();

        if (!question) return;

        // 1. 사용자 메시지 추가
        this.appendMessage('user', question);
        input.value = '';

        // 2. 로딩 표시 및 로그 기록
        const loadingDiv = this.appendMessage('ai', '<i class="fas fa-spinner fa-spin mr-2"></i>AI가 생각 중입니다...');
        ConsoleLogger.info(`AI 요청 시작: ${question}`, 'OracleLLM', 'sendQuestion');

        try {
            // 3. 서버 호출 (오라클 LLM 연동 API)
            const response = await fetch(`${API_BASE_URL}/common/ai/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, mode })
            });

            const result = await response.json();

            // 4. 결과 출력
            loadingDiv.remove(); // 로딩 메시지 제거
            if (result.status === 'success') {
                let html = `<div class="font-bold text-blue-600 mb-1">[생성된 SQL]</div>`;
                html += `<pre class="bg-slate-800 text-green-400 p-2 rounded text-xs overflow-x-auto mb-2">${result.generated_sql}</pre>`;
                
                if (mode === 'data') {
                    html += `<div class="font-bold text-purple-600 mb-1">[조회 결과: ${result.total}건]</div>`;
                    if (result.data.length > 0) {
                        html += this.makeSimpleTable(result.data, result.columns);
                    } else {
                        html += `<div class="text-gray-500 italic text-xs">조회된 데이터가 없습니다.</div>`;
                    }
                }
                this.appendMessage('ai', html);
                ConsoleLogger.info("SQL 변환 성공", 'OracleLLM', 'sendQuestion');
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            loadingDiv.remove();
            this.appendMessage('error', `오류 발생: ${err.message}`);
            ConsoleLogger.error(`AI 요청 실패: ${err.message}`, 'OracleLLM', 'sendQuestion');
        }
    },

    // 간단한 결과 테이블 생성 헬퍼
    makeSimpleTable(data, columns) {
        let tableHtml = `<div class="overflow-x-auto border rounded"><table class="w-full text-[11px] bg-white">`;
        tableHtml += `<thead class="bg-gray-100"><tr>`;
        columns.forEach(col => tableHtml += `<th class="p-1 border-b">${col}</th>`);
        tableHtml += `</tr></thead><tbody>`;
        
        data.slice(0, 5).forEach(row => { // 최대 5건만 샘플로 표시
            tableHtml += `<tr>`;
            columns.forEach(col => tableHtml += `<td class="p-1 border-b text-center">${row[col] ?? ''}</td>`);
            tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table></div>`;
        if (data.length > 5) tableHtml += `<div class="text-[10px] text-right text-gray-400 mt-1">상위 5건만 표시됨</div>`;
        return tableHtml;
    },

    appendMessage(type, text) {
        const chatMsg = document.getElementById('chatMsg');
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-bubble ${type}`;
        msgDiv.style.marginBottom = '15px';
        msgDiv.style.padding = '10px';
        msgDiv.style.borderRadius = '10px';
        msgDiv.style.fontSize = '13px';
        
        if(type === 'user') {
            msgDiv.style.background = 'var(--c-blue-bg)';
            msgDiv.style.marginLeft = '20px';
        } else if(type === 'ai') {
            msgDiv.style.background = 'white';
            msgDiv.style.border = '1px solid var(--c-border)';
            msgDiv.style.marginRight = '20px';
        } else {
            msgDiv.style.color = type === 'error' ? 'red' : 'gray';
            msgDiv.style.textAlign = 'center';
        }

        msgDiv.innerHTML = text;
        chatMsg.appendChild(msgDiv);
        chatMsg.scrollTop = chatMsg.scrollHeight;
        return msgDiv;
    }
};

window.PageManager = PageManager;
window.LayoutManager = LayoutManager;
window.ConsoleLogger = ConsoleLogger;
window.AIChatManager = AIChatManager;

// 기존 DOMContentLoaded에 추가
window.addEventListener('DOMContentLoaded', () => {
    LayoutManager.init();
    AIChatManager.init();
    ConsoleLogger.init();
    PageManager.load('home', '인아이티 Data Editing 시스템');
});