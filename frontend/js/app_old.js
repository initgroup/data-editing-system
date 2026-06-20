const API_BASE_URL = "/api";
const FETCH_TIMEOUT = 10000; // fetch 요청 타임아웃 기본값(ms)
const LOADING_DELAY_MS = 300; // 로딩 표시 지연 시간(ms)
const APP_VERSION = "1.0.77"; // 전체 앱 버전. 값을 올리면 브라우저 캐시가 갱신됩니다.
// const API_BASE_URL = "http://127.0.0.1:8000/api";

const PageManager = {
    modules: {}, // 로드된 페이지 모듈 캐시
    containers: {}, // 열린 페이지 컨테이너 목록
    lastLoadedVersion: null, // 마지막으로 로드한 앱 버전
    dataWorkTemplatePages: ['M02003', 'M02004', 'M03001'],

    /**
     * 각 페이지 모듈에서 공통으로 사용하는 헬퍼를 생성합니다.
     * @param {string} pageCode - 페이지 코드. 예: M01001
     */
    createHelper(pageCode) {
        return {
            getEl: (id) => document.getElementById(`${id}-${pageCode}`),

            getContainerEl: (selector) => {
                const container = document.getElementById(`container-${pageCode}`);
                return container ? container.querySelector(selector) : null;
            }
        };
    },

    /**
     * 지정한 페이지만 활성화하고 나머지는 숨깁니다.
     * @param {string} pageCode - 표시할 페이지 코드
     */
    show(pageCode) {
        document.querySelectorAll('.page-section').forEach(section => {
            section.classList.remove('active');
            section.style.display = 'none';
        });

        const targetContainer = this.containers[pageCode];
        if (targetContainer) {
            targetContainer.classList.add('active');
            targetContainer.style.display = 'block';
        }

        document.querySelectorAll('#mainNav [data-page]').forEach(el => {
            el.classList.remove('menu-active');
        });

        const targetMenu = document.querySelector(`#mainNav [data-page="${pageCode}"]`);
        if (targetMenu) {
            targetMenu.classList.add('menu-active');
            targetMenu.classList.add('visited-menu');

            const parentSubmenu = targetMenu.closest('.submenu');
            if (parentSubmenu && parentSubmenu.classList.contains('hidden')) {
                parentSubmenu.classList.remove('hidden');

                const folderBtn = parentSubmenu.previousElementSibling;
                if (folderBtn) {
                    const arrow = folderBtn.querySelector('.fa-chevron-down');
                    if (arrow) arrow.classList.add('rotate-180');
                }
            }
        }
    },

    /**
     * 현재 열려 있는 모든 페이지를 닫습니다.
     */
    closeAll() {
        console.log("[System] 모든 페이지 리소스 해제를 시작합니다.");

        const openPages = Object.keys(this.containers);
        if (openPages.length === 0) {
            alert("열려 있는 페이지가 없습니다.");
            return;
        }

        openPages.forEach((pageCode, index) => {
            const isLast = index === openPages.length - 1;
            this.close(pageCode, isLast);
        });

        console.log("[System] 모든 페이지가 정상적으로 닫혔습니다.");
    },

    /**
     * 페이지 리소스를 해제하고 컨테이너를 제거합니다.
     * @param {string} pageCode - 닫을 페이지 코드
     * @param {boolean} moveToMain - 닫은 뒤 홈으로 이동할지 여부
     */
    close(pageCode, moveToMain = true) {
        if (pageCode === 'home') {
            console.log("[System] 홈 페이지는 닫을 수 없습니다.");
            return;
        }

        console.log(`[System] ${pageCode} 리소스 해제를 시작합니다.`);

        const targetModule = window[pageCode] || this.modules[pageCode];
        if (targetModule && typeof targetModule.destroy === 'function') {
            try {
                targetModule.destroy();
            } catch (error) {
                console.warn(`[System] ${pageCode} destroy 처리 중 오류가 발생했습니다.`, error);
            }
        }

        const container = document.getElementById(`page-section-${pageCode}`);
        if (container) {
            container.innerHTML = '';
            container.remove();
            delete this.containers[pageCode];
        }

        const scriptTag = document.querySelector(`script[src*="${pageCode}.js"]`);
        if (scriptTag) scriptTag.remove();

        const closedMenu = document.querySelector(`#mainNav [data-page="${pageCode}"]`);
        if (closedMenu) {
            closedMenu.classList.remove('visited-menu', 'menu-active', 'bg-blue-700', 'text-green-500');
        }

        if (window[pageCode]) {
            if (typeof window[pageCode].destroy === 'function') {
                window[pageCode].destroy();
            }
            delete window[pageCode];
        }
        delete this.modules[pageCode];

        if (moveToMain) {
            const homeMenu = document.querySelector('#mainNav [data-page="home"]');
            if (homeMenu) {
                homeMenu.click();
            } else {
                location.hash = '#';
                const titleEl = document.getElementById('contentTitle');
                if (titleEl) titleEl.innerText = "Data Editing System";

                document.querySelectorAll('#mainNav a, #mainNav button').forEach(el => {
                    el.classList.remove('menu-active', 'bg-blue-700');
                });
            }
        }
    },

    /**
     * 페이지 HTML을 fetch하여 컨테이너에 주입합니다.
     * @param {string} pageCode - 페이지 코드
     * @returns {Promise<boolean>} HTML 로드 여부
     */
    async injectHtml(pageCode) {
        const container = this.containers[pageCode];
        if (!container) throw new Error(`컨테이너가 생성되지 않았습니다. ${pageCode}`);

        if (!this.hasRegisteredPageFile(pageCode, 'html')) {
            container.innerHTML = this.createMissingPageHtml(pageCode);
            return false;
        }

        try {
            const useDataWorkTemplate = this.dataWorkTemplatePages.includes(pageCode);
            const htmlFileName = useDataWorkTemplate ? 'MCOMMON_DATA_WORK' : pageCode;
            const response = await fetch(`./pages/${htmlFileName}.html?v=${APP_VERSION}`);
            if (!response.ok) {
                container.innerHTML = this.createMissingPageHtml(pageCode);
                return false;
            }

            const html = await response.text();
            container.innerHTML = useDataWorkTemplate
                ? html.split('__PAGE_CODE__').join(pageCode)
                : html;
            return true;
        } catch (error) {
            container.innerHTML = this.createMissingPageHtml(pageCode);
            return false;
        }
    },

    createMissingPageHtml(pageCode) {
        return `
            <div id="container-${pageCode}" class="h-full min-h-[360px] flex items-center justify-center">
                <div class="text-center text-slate-500">
                    <div class="text-4xl mb-4 text-slate-300">
                        <i class="fas fa-file-circle-question"></i>
                    </div>
                    <div class="text-lg font-semibold text-slate-700">화면 준비 중입니다.</div>
                    <div class="mt-2 text-sm">${pageCode}.html 파일이 아직 연결되지 않았습니다.</div>
                </div>
            </div>
        `;
    },

    hasRegisteredPageFile(pageCode, fileType) {
        const config = window.PAGE_FILE_CONFIG;
        if (!config) return true;

        const pageList = fileType === 'script' ? config.scriptPages : config.htmlPages;
        if (!Array.isArray(pageList)) return true;

        return pageList.includes(pageCode);
    },

    /**
     * 페이지별 스크립트를 동적으로 주입합니다.
     * @param {string} pageCode - 페이지 코드
     * @param {boolean} force - 기존 스크립트를 무시하고 다시 로드할지 여부
     */
    async injectScript(pageCode, force = false) {
        if (!force && document.querySelector(`script[src*="${pageCode}.js"]`)) {
            return true;
        }

        if (!this.hasRegisteredPageFile(pageCode, 'script')) {
            return false;
        }

        const scriptSrc = `./js/${pageCode}.js?v=${APP_VERSION}`;

        try {
            const response = await fetch(scriptSrc, { method: 'HEAD' });
            if (!response.ok) {
                return false;
            }
        } catch (error) {
            return false;
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = scriptSrc;
            script.async = true;

            script.onload = () => {
                console.log(`[Script Loaded] ${pageCode}.js`);
                resolve(true);
            };

            script.onerror = () => {
                resolve(false);
            };

            document.body.appendChild(script);
        });
    },

    /**
     * 페이지를 로드하거나 이미 열린 페이지를 활성화합니다.
     * @param {string} pageCode - 페이지 코드
     * @param {string} title - 화면 제목
     * @param {boolean} isRefresh - 강제 새로고침 여부
     */
    async load(pageCode, title, isRefresh = false) {
        const containerId = `page-section-${pageCode}`;

        if (this.containers[pageCode] && !isRefresh) {
            this.show(pageCode);
            if (title) document.getElementById('contentTitle').innerText = title;
            return;
        }

        if (isRefresh) {
            this.close(pageCode, false);
        }

        const holder = document.getElementById('pageContainerHolder');
        const container = document.createElement('div');
        container.id = containerId;
        container.className = 'page-section active';
        holder.appendChild(container);
        this.containers[pageCode] = container;

        CommonUI.showLoading();

        try {
            const hasHtml = await this.injectHtml(pageCode);
            if (hasHtml) {
                await this.injectScript(pageCode, isRefresh);
            }

            const module = window[pageCode];
            if (module && typeof module.init === 'function') {
                this.modules[pageCode] = module;
                await module.init();
            }

            this.show(pageCode);
        } catch (e) {
            CommonUI.showPageError(pageCode, e.message);
        } finally {
            CommonUI.hideLoading();
            if (title) document.getElementById('contentTitle').innerText = title;
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

        let overlay = document.getElementById('sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }
        this.overlay = overlay;

        if (!document.getElementById('mobile-menu-btn')) {
            const btn = document.createElement('button');
            btn.id = 'mobile-menu-btn';
            btn.className = 'fixed top-4 right-4 w-12 h-12 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center lg:hidden z-[210] transition-transform active:scale-90';
            btn.innerHTML = '<i class="fas fa-bars"></i>';
            document.body.appendChild(btn);
        }
        this.btn = document.getElementById('mobile-menu-btn');

        if (this.btn) this.btn.onclick = () => this.toggle();
        this.overlay.onclick = () => this.toggle();

        document.querySelectorAll('#mainNav [data-page]').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 1024 && this.sidebar.classList.contains('show')) {
                    this.toggle();
                }
            });
        });

        this.bindFolderEvents();

        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) {
                this.sidebar.classList.remove('show');
                this.overlay.classList.remove('active');
                if (this.btn) this.btn.innerHTML = '<i class="fas fa-bars"></i>';
            }
        });
    },

    bindFolderEvents() {
        const folderButtons = document.querySelectorAll('.menu-folder button');
        folderButtons.forEach(button => {
            button.addEventListener('click', () => {
                const submenu = button.nextElementSibling;
                const icon = button.querySelector('.fa-chevron-down');

                if (submenu) {
                    submenu.classList.toggle('hidden');
                }

                if (icon) {
                    icon.classList.toggle('rotate-180');
                }
            });
        });
    },

    expandAllMenus() {
        document.querySelectorAll('.submenu').forEach(menu => {
            menu.classList.remove('hidden');
        });

        document.querySelectorAll('.menu-folder .fa-chevron-down').forEach(icon => {
            icon.classList.add('rotate-180');
        });
    },

    collapseAllMenus() {
        document.querySelectorAll('.submenu').forEach(menu => {
            menu.classList.add('hidden');
        });

        document.querySelectorAll('.menu-folder .fa-chevron-down').forEach(icon => {
            icon.classList.remove('rotate-180');
        });
    },

    toggle() {
        if (!this.sidebar) return;
        const isShow = this.sidebar.classList.toggle('show');

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
    isEnabled: false, // 로그 출력 여부
    maxLines: 500, // 최대 보관 로그 라인 수

    init() {
        const toggle = document.getElementById('chkLogToggle');
        const statusText = document.getElementById('logStatusTextText');

        if (toggle) {
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

        const container = document.querySelector('.log-toggle');
        const track = document.getElementById('logSwitch');
        const text = document.getElementById('logStatusText');

        if (!container || !track || !text) return;

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
        if (!this.isEnabled) return;
        this._write('info', msg, source, location);
    },

    error(msg, source = 'System', location = '') {
        if (!this.isEnabled) return;
        this._write('error', msg, source, location);
    },

    warn(msg, source = 'System', location = '') {
        if (!this.isEnabled) return;
        this._write('warn', msg, source, location);
    },

    /**
     * 콘솔 로그 영역에 로그를 출력합니다.
     * @param {string} level - info, error, warn
     * @param {string} msg - 메시지 내용
     * @param {string} source - 소스 위치
     * @param {string} location - 명령 위치
     */
    _write(level, msg, source, location) {
        const targetMsg = document.getElementById("consoleMsg");
        const targetErr = document.getElementById("consoleErr");
        const scrollParent = document.getElementById("consoleBody");
        if (!targetMsg || !targetErr || !scrollParent) return;

        const now = new Date();
        const timeStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ` +
            `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

        const logLine = document.createElement("pre");
        logLine.className = `console-line log-${level}`;
        logLine.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-level">[${level.toUpperCase()}]</span> <span class="log-location">${source} > ${location}</span> : ${msg}`;

        targetMsg.appendChild(logLine);

        while (targetMsg.children.length > this.maxLines) {
            targetMsg.removeChild(targetMsg.firstChild);
        }

        if (level === 'error') {
            const logLineErr = document.createElement("pre");
            logLineErr.className = `console-line log-${level}`;
            logLineErr.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-level">[${level.toUpperCase()}]</span> <span class="log-location">${source} > ${location}</span> : ${msg}`;

            targetErr.appendChild(logLineErr);
            while (targetErr.children.length > this.maxLines) {
                targetErr.removeChild(targetErr.firstChild);
            }
        }

        setTimeout(() => {
            scrollParent.scrollTop = scrollParent.scrollHeight;
        }, 0);
    }
};

/**
 * AI Chat Manager: Oracle LLM 연동 로직
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

        this.appendMessage('user', question);
        input.value = '';

        const loadingDiv = this.appendMessage('ai', '<i class="fas fa-spinner fa-spin mr-2"></i>AI가 생각 중입니다...');
        ConsoleLogger.info(`AI 요청 시작: ${question}`, 'OracleLLM', 'sendQuestion');

        try {
            const response = await fetch(`${API_BASE_URL}/common/ai/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, mode })
            });

            const result = await response.json();

            loadingDiv.remove();
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

    makeSimpleTable(data, columns) {
        let tableHtml = `<div class="overflow-x-auto border rounded"><table class="w-full text-[11px] bg-white">`;
        tableHtml += `<thead class="bg-gray-100"><tr>`;
        columns.forEach(col => tableHtml += `<th class="p-1 border-b">${col}</th>`);
        tableHtml += `</tr></thead><tbody>`;

        data.slice(0, 5).forEach(row => {
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

        if (type === 'user') {
            msgDiv.style.background = 'var(--c-blue-bg)';
            msgDiv.style.marginLeft = '20px';
        } else if (type === 'ai') {
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

window.addEventListener('DOMContentLoaded', () => {
    LayoutManager.init();
    AIChatManager.init();
    ConsoleLogger.init();
    PageManager.load('home', 'Data Editing System');
});
