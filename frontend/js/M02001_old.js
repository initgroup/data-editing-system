
// startDiscovery 함수 부분 수정
async function startDiscovery() {
    const table = document.getElementById('targetTable').value;
    const column = document.getElementById('targetColumn').value;
    const runBtn = document.getElementById('runBtn');
    const statusDiv = document.getElementById('discoveryStatus');

    // UI 초기화
    runBtn.disabled = true;
    runBtn.classList.add('opacity-50');
    statusDiv.classList.remove('hidden');
    document.getElementById('resultSection').classList.add('hidden');
    hideError();

    // [개선] 타임아웃 제어를 위한 AbortController 추가
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        // [수정] URL 구조 명확화: /api + /M02001/run
        const apiUrl = `${API_BASE_URL}/M02001/run`.replace(/\/+/g, '/');
        // 만약 API_BASE_URL이 비어있다면 http://127.0.0.1:8000/api/M02001/run 직접 입력 테스트

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
        setTimeout(() => fetchResults(result.hist_id), 3500);

    } catch (error) {
        let displayMsg = error.message;
        if (error.name === 'AbortError') displayMsg = "서버 응답 시간 초과 (10초)";
        else if (error.message === 'Failed to fetch') displayMsg = "서버 연결 실패 (백엔드 확인 필요)";

        showError("발굴 실행 실패: " + displayMsg);
        statusDiv.classList.add('hidden');
        runBtn.disabled = false;
        runBtn.classList.remove('opacity-50');
    }
}

async function fetchResults(histId) {
    const statusDiv = document.getElementById('discoveryStatus');
    const runBtn = document.getElementById('runBtn');

    try {
        const apiUrl = `${API_BASE_URL}/M02001/results/${histId}`.replace(/\/+/g, '/');
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "결과 조회 실패");
        }

        const resData = await response.json();
        const tbody = document.getElementById('ruleResultBody');
        tbody.innerHTML = '';

        if (resData && resData.status === "success" && Array.isArray(resData.data)) {
            resData.data.forEach(rule => {
                const tr = `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-4 py-4"><span class="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">${rule.RULE_TYPE}</span></td>
                        <td class="px-4 py-4 font-medium">${rule.RULE_DESC}</td>
                        <td class="px-4 py-4 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <div class="w-16 bg-gray-200 rounded-full h-1.5">
                                    <div class="bg-green-500 h-1.5 rounded-full" style="width: ${rule.CONFIDENCE}%"></div>
                                </div>
                                <span class="text-xs font-bold text-green-600">${rule.CONFIDENCE}%</span>
                            </div>
                        </td>
                        <td class="px-4 py-4 text-right">
                            <button class="text-blue-600 hover:underline text-xs font-bold">확정</button>
                        </td>
                    </tr>
                `;
                tbody.innerHTML += tr;
            });
            statusDiv.classList.add('hidden');
            document.getElementById('resultSection').classList.remove('hidden');
        } else {
            throw new Error(resData.message || "결과가 아직 준비되지 않았습니다.");
        }
    } catch (error) {
        showError("결과 처리 오류: " + error.message);
        statusDiv.classList.add('hidden');
    } finally {
        runBtn.disabled = false;
        runBtn.classList.remove('opacity-50');
    }
}