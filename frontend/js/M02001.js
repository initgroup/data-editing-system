/**
 * M02001: 규칙 발굴 스크립트
 */
{
    const M02001 = {
        async init() {
            console.log("M02001: 규칙 발굴 모듈 로드 완료");
            await this.loadTableList();
            
            // [핵심] 첫 번째 콤보박스 변경 이벤트 바인딩
            const tableSelect = document.getElementById('targetTable');
            tableSelect?.addEventListener('change', (e) => {
                this.loadColumnList(e.target.value);
            });
        },

        // 1. 페이지 로딩 시 테이블 목록 로드
        async loadTableList() {
            const tableSelect = document.getElementById('targetTable');
            try {
                const response = await fetch(`${API_BASE_URL}/M02001/tables`);
                const result = await response.json();
                
                if (result.status === 'success') {
                    tableSelect.innerHTML = '<option value="">테이블 선택</option>';
                    result.data.forEach(item => {
                        const option = document.createElement('option');
                        // 요청사항: value에는 TABLE_ID, textContent에는 TABLE_NM
                        option.value = item.TABLE_ID;    
                        option.textContent = item.TABLE_NM; 
                        tableSelect.appendChild(option);
                    });
                }
            } catch (error) {
                console.error("테이블 로드 실패:", error);
            }
        },

        // 2. 테이블 선택에 따라 컬럼 목록 동적 로드 (페이지 로딩 없음)
        async loadColumnList(tableName) {
            const colSelect = document.getElementById('targetColumn');
            if (!tableName) {
                colSelect.innerHTML = '<option value="">컬럼 선택</option>';
                return;
            }

            colSelect.innerHTML = '<option value="">로딩 중...</option>';

            try {
                const response = await fetch(`${API_BASE_URL}/M02001/columns/${tableName}`);
                const result = await response.json();

                if (result.status === 'success') {
                    colSelect.innerHTML = '<option value="">컬럼 선택</option>';
                    result.data.forEach(colName => {
                        const option = document.createElement('option');
                        option.value = colName;
                        option.textContent = colName;
                        colSelect.appendChild(option);
                    });
                }
            } catch (error) {
                console.error("컬럼 로드 실패:", error);
                colSelect.innerHTML = '<option value="">로드 실패</option>';
            }
        },

        // 발굴 시작 (API 호출)
        async startDiscovery_old() {
            const table = document.getElementById('targetTable')?.value;
            const column = document.getElementById('targetColumn')?.value;
            const runBtn = document.getElementById('runBtn');
            const statusDiv = document.getElementById('discoveryStatus');
            const resultSection = document.getElementById('resultSection');

            if (!table || !column) {
                alert("대상 테이블과 컬럼을 선택해주세요.");
                return;
            }

            // UI 초기화
            runBtn.disabled = true;
            runBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>분석 중...`;
            statusDiv.classList.remove('hidden');
            resultSection.classList.add('hidden');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            try {
                // 1. 발굴 실행 요청 (POST /run)
                const apiUrl = `${API_BASE_URL}/M02001/run`.replace(/\/+/g, '/');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target_table: table,
                        target_column: column,
                        discovery_type: '머신러닝'
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || `서버 오류 (${response.status})`);
                }

                const result = await response.json();
                console.log("발굴 시작 성공, HIST_ID:", result.hist_id);

                // 2. 분석 시간이 걸리므로 잠시 후 결과 조회 (3.5초 뒤)
                setTimeout(() => this.fetchResults(result.hist_id), 3500);

            } catch (error) {
                console.error("Discovery Error:", error);
                alert("발굴 실행 실패: " + (error.name === 'AbortError' ? "시간 초과" : error.message));
                statusDiv.classList.add('hidden');
                runBtn.disabled = false;
                runBtn.innerHTML = `<i class="fas fa-search mr-2"></i>규칙 발굴 시작`;
            }
        },

        // 결과 조회 및 테이블 출력 (GET /results/{id})
        async fetchResults(histId) {
            const tbody = document.getElementById('discovery-tbody');
            const countEl = document.getElementById('rule-count');
            const statusDiv = document.getElementById('discoveryStatus');
            const resultSection = document.getElementById('resultSection');
            const runBtn = document.getElementById('runBtn');

            try {
                const apiUrl = `${API_BASE_URL}/M02001/results/${histId}`.replace(/\/+/g, '/');
                const response = await fetch(apiUrl);
                const result = await response.json();

                if (result.status === 'success' || result.status === 'empty') {
                    const rules = result.data || [];
                    
                    // 테이블 렌더링
                    tbody.innerHTML = rules.length > 0 ? rules.map(rule => `
                        <tr class="hover:bg-blue-50/30 transition-colors">
                            <td class="px-6 py-4">
                                <span class="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">${rule.RULE_TYPE}</span>
                            </td>
                            <td class="px-6 py-4 font-medium text-gray-700">${rule.RULE_DESC}</td>
                            <td class="px-6 py-4 text-center">
                                <div class="flex items-center justify-center gap-2">
                                    <span class="font-black ${rule.CONFIDENCE >= 95 ? 'text-green-600' : 'text-orange-500'}">${rule.CONFIDENCE}%</span>
                                </div>
                            </td>
                            <td class="px-6 py-4 text-right">
                                <button onclick="M02001.applyRule('${rule.RULE_ID}')" class="text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-bold transition">
                                    <i class="fas fa-plus-circle mr-1"></i>규칙 등록
                                </button>
                            </td>
                        </tr>
                    `).join('') : `<tr><td colspan="4" class="p-10 text-center text-gray-400">발굴된 규칙이 없습니다.</td></tr>`;

                    if (countEl) countEl.innerText = rules.length;

                    // UI 업데이트
                    statusDiv.classList.add('hidden');
                    resultSection.classList.remove('hidden');
                    runBtn.disabled = false;
                    runBtn.innerHTML = `<i class="fas fa-search mr-2"></i>규칙 발굴 시작`;
                }
            } catch (error) {
                console.error("Fetch Results Error:", error);
                alert("결과 조회 실패");
            }
        },

        async startDiscovery() {
            const table = document.getElementById('targetTable')?.value;
            const column = document.getElementById('targetColumn')?.value;
            const runBtn = document.getElementById('runBtn');
            const statusDiv = document.getElementById('discoveryStatus');
            const resultSection = document.getElementById('resultSection');
            const tbody = document.getElementById('discovery-tbody');
            const countEl = document.getElementById('rule-count');

            if (!table || !column) {
                alert("대상 테이블과 컬럼을 선택해주세요.");
                return;
            }

            // UI 초기화
            runBtn.disabled = true;
            runBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>조회 중...`;
            statusDiv.classList.remove('hidden');
            resultSection.classList.add('hidden');

            try {
                // [수정] /run 대신 /select 호출
                const apiUrl = `${API_BASE_URL}/M02001/select`.replace(/\/+/g, '/');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target_table: table,
                        target_column: column,
                        discovery_type: '즉시조회'
                    })
                });

                if (!response.ok) throw new Error(`서버 오류: ${response.status}`);

                const result = await response.json();

                // 백엔드 리턴 형식이 {"status": "success", "data": [...]} 이므로 result.data 사용
                if (result.status === 'success') {
                    const rules = result.data || [];
                    
                    // 테이블 렌더링 (rule.RULE_TYPE 등 대문자 키 매핑 주의)
                    tbody.innerHTML = rules.length > 0 ? rules.map(rule => `
                        <tr class="hover:bg-blue-50/30 transition-colors">
                            <td class="px-6 py-4">
                                <span class="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">${rule.RULE_TYPE}</span>
                            </td>
                            <td class="px-6 py-4 font-medium text-gray-700">${rule.RULE_DESC}</td>
                            <td class="px-6 py-4 text-center">
                                <div class="flex items-center justify-center gap-2">
                                    <span class="font-black ${rule.CONFIDENCE >= 95 ? 'text-green-600' : 'text-orange-500'}">${rule.CONFIDENCE}%</span>
                                </div>
                            </td>
                            <td class="px-6 py-4 text-right">
                                <button onclick="M02001.applyRule('${rule.RULE_ID}')" class="text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-bold transition">
                                    <i class="fas fa-plus-circle mr-1"></i>규칙 등록
                                </button>
                            </td>
                        </tr>
                    `).join('') : `<tr><td colspan="4" class="p-10 text-center text-gray-400">조회된 규칙이 없습니다.</td></tr>`;

                    if (countEl) countEl.innerText = rules.length;

                    // UI 업데이트
                    statusDiv.classList.add('hidden');
                    resultSection.classList.remove('hidden');
                }

            } catch (error) {
                console.error("Select Error:", error);
                alert("조회 실패: " + error.message);
            } finally {
                runBtn.disabled = false;
                runBtn.innerHTML = `<i class="fas fa-search mr-2"></i>규칙 발굴 시작`;
                statusDiv.classList.add('hidden');
            }
        },

        // [핵심] DB 데이터를 기반으로 HTML을 생성하는 함수
        renderDynamicTable(rules) {
            const tbody = document.getElementById('discovery-tbody');
            const countEl = document.getElementById('rule-count');
            const statusDiv = document.getElementById('discoveryStatus');
            const resultSection = document.getElementById('resultSection');
            const runBtn = document.getElementById('runBtn');

            if (!rules || rules.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-gray-400">조회된 데이터가 없습니다.</td></tr>';
            } else {
                tbody.innerHTML = rules.map(rule => `
                    <tr class="hover:bg-blue-50/30 transition-colors">
                        <td class="px-6 py-4">
                            <span class="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase">${rule.type}</span>
                        </td>
                        <td class="px-6 py-4 font-medium text-gray-700">${rule.desc}</td>
                        <td class="px-6 py-4 text-center">
                            <span class="font-black text-blue-600">${rule.conf}%</span>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <button class="text-blue-600 hover:underline text-xs font-bold">등록</button>
                        </td>
                    </tr>
                `).join('');
            }

            countEl.innerText = rules ? rules.length : 0;
            statusDiv.classList.add('hidden');
            resultSection.classList.remove('hidden');
            runBtn.disabled = false;
        },

        // 발굴 시작 시뮬레이션 (원본 로직 유지)
/*         startDiscovery() {
            const statusDiv = document.getElementById('discoveryStatus');
            const resultSection = document.getElementById('resultSection');
            const runBtn = document.getElementById('runBtn');

            // UI 상태 변경
            runBtn.disabled = true;
            runBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>분석 중...`;
            statusDiv.classList.remove('hidden');
            resultSection.classList.add('hidden');

            // 분석 시뮬레이션 (2초 대기)
            setTimeout(() => {
                statusDiv.classList.add('hidden');
                resultSection.classList.remove('hidden');
                runBtn.disabled = false;
                runBtn.innerHTML = `<i class="fas fa-search mr-2"></i>규칙 발굴 시작`;

                this.renderResults();
            }, 2000);
        },
 */
        renderResults() {
            const tbody = document.getElementById('discovery-tbody');
            const countEl = document.getElementById('rule-count');
            
            // rule-mining.html의 원본 예시 데이터 유지
            const sampleRules = [
                { type: "Range", desc: "SALARY는 0 이상 1,000,000,000 이하여야 함", conf: 99.8 },
                { type: "Format", desc: "EMAIL은 표준 이메일 형식을 따라야 함", conf: 95.2 },
                { type: "Referential", desc: "DEPT_ID는 DEPARTMENT 테이블의 ID를 참조해야 함", conf: 100 },
                { type: "Pattern", desc: "PHONE_NUMBER는 '010-XXXX-XXXX' 형식을 따름", conf: 89.5 }
            ];

            if (tbody) {
                tbody.innerHTML = sampleRules.map(rule => `
                    <tr class="hover:bg-blue-50/30 transition-colors">
                        <td class="px-6 py-4">
                            <span class="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">${rule.type}</span>
                        </td>
                        <td class="px-6 py-4 font-medium text-gray-700">${rule.desc}</td>
                        <td class="px-6 py-4 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <span class="font-black ${rule.conf >= 95 ? 'text-green-600' : 'text-orange-500'}">${rule.conf}%</span>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <button onclick="M02001.applyRule('${rule.type}')" class="text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-bold transition">
                                <i class="fas fa-plus-circle mr-1"></i>규칙 등록
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
            
            if (countEl) countEl.innerText = sampleRules.length;
        },

        applyRule(type) {
            alert(`${type} 규칙이 데이터 품질 마스터에 등록되었습니다.`);
        }
    };

    // 전역 초기화 함수
    window.initM02001Page = () => M02001.init();
    window.M02001 = M02001;
}