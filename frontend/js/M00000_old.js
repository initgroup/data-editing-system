{
    const M00000 = {
        currentPage: 1,
        itemsPerPage: 5,
        currentData: [],

        async init() {
            console.log("M00000 초기화 완료");
            this.bindEvents();
            await this.loadInitialData();
        },
        
        bindEvents() {
            document.getElementById('mainCombo')?.addEventListener('change', async (e) => {
                const parentId = e.target.value;
                const subCombo = document.getElementById('subCombo');
                
                if (!parentId) {
                    subCombo.innerHTML = '<option value="">메인을 먼저 선택하세요</option>';
                    subCombo.disabled = true;
                    subCombo.classList.add('bg-gray-50');
                    return;
                }

                try {
                    const res = await fetch(`${API_BASE_URL}/M00000/cascade/${parentId}`);
                    const json = await res.json();
                    
                    subCombo.innerHTML = '<option value="">선택하세요</option>';
                    (json.data ?? []).forEach(item => {
                        subCombo.innerHTML += `<option value="${item.CODE}">${item.NAME}</option>`;
                    });
                    subCombo.disabled = false;
                    subCombo.classList.remove('bg-gray-50');
                } catch (e) {
                    showError("하위 콤보박스 로딩 실패");
                }
            });
        },

        async loadInitialData() {
            try {
                const res = await fetch(`${API_BASE_URL}/M00000/init`);
                const json = await res.json();
                const mainCombo = document.getElementById('mainCombo');
                (json.combo ?? []).forEach(item => {
                    mainCombo.innerHTML += `<option value="${item.CODE}">${item.NAME}</option>`;
                });
            } catch (error) {
                showError("초기 데이터 셋업 중 오류가 발생했습니다.");
            }
        },

        getSearchParams() {
            const checks = Array.from(document.querySelectorAll('.status-chk:checked')).map(cb => cb.value);
            return {
                main_combo: document.getElementById('mainCombo')?.value || null,
                sub_combo: document.getElementById('subCombo')?.value || null,
                text_val: document.getElementById('textSearch')?.value || null,
                date_val: document.getElementById('dateSearch')?.value || null,
                check_values: checks 
            };
        },

        // [수정] JSON 파싱 후 상태 체크 순서 변경 및 데이터 검증 강화
        async searchSync() {
            if (typeof hideMessage === 'function') hideMessage();
            if (typeof showLoading === 'function') showLoading();

            try {
                const params = this.getSearchParams();
                const res = await fetch(`${API_BASE_URL}/M00000/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params)
                });

                let json;
                try {
                    json = await res.json();
                } catch (e) {
                    throw new Error("서버 응답이 올바른 형식이 아닙니다.");
                }

                if (!res.ok) {
                    throw new Error(json.detail || "서버 통신 중 오류가 발생했습니다.");
                }

                // [수정] 확실하게 배열임을 보장
                const rawData = json.data ?? [];
                this.currentData = Array.isArray(rawData) ? rawData : []; 
                
                this.renderGridNoPaging();
                this.renderGridPaging(1);

                if (this.currentData.length > 0) {
                    if (typeof showSuccess === 'function') showSuccess(`총 ${this.currentData.length}건이 조회되었습니다.`);
                } else {
                    if (typeof showError === 'function') showError("조회된 데이터가 없습니다.");
                }
            } catch (e) {
                console.error("조회 에러 상세:", e);
                if (typeof showError === 'function') showError(e.message);
            } finally {
                if (typeof hideLoading === 'function') {
                    setTimeout(() => hideLoading(), 300);
                }
            }
        },

        // [수정] map 에러 방지를 위한 Array.isArray 체크 강화
        renderGridNoPaging() {
            const tbody = document.getElementById('gridNoPaging');
            if (!tbody) return;

            if (!Array.isArray(this.currentData)) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">데이터 형식 오류</td></tr>';
                return;
            }

            if (this.currentData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>';
                return;
            }

            try {
                tbody.innerHTML = this.currentData.map(row => `
                    <tr class="hover:bg-blue-50 transition-colors">
                        <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                        <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                        <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                        <td class="p-3 border-b">${row.DATE ?? ''}</td>
                    </tr>
                `).join('');
            } catch (e) {
                console.error("렌더링 중 에러:", e);
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">렌더링 중 오류 발생</td></tr>';
            }
        },

        // [수정] slice 에러 방지를 위한 방어 로직 추가
        renderGridPaging(page) {
            const tbody = document.getElementById('gridPaging');
            const pageArea = document.getElementById('paginationArea');
            if (!tbody) return;

            if (!Array.isArray(this.currentData) || this.currentData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>';
                if (pageArea) pageArea.innerHTML = '';
                return;
            }

            try {
                this.currentPage = page;
                const start = (page - 1) * this.itemsPerPage;
                const end = start + this.itemsPerPage;
                const pagedData = this.currentData.slice(start, end);
                
                tbody.innerHTML = pagedData.map(row => `
                    <tr class="hover:bg-blue-50 transition-colors">
                        <td class="p-3 border-b">${row.RNUM ?? '-'}</td>
                        <td class="p-3 border-b">${row.COL1 ?? ''}</td>
                        <td class="p-3 border-b">${row.COL2 ?? ''}</td>
                    </tr>
                `).join('');

                this.renderPagination();
            } catch (e) {
                console.error("페이징 렌더링 중 에러:", e);
                tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-red-400">데이터 형식 오류</td></tr>';
            }
        },

        renderPagination() {
            const totalPages = Math.ceil(this.currentData.length / this.itemsPerPage);
            const pageArea = document.getElementById('paginationArea');
            if (!pageArea) return;

            let html = '';
            for(let i=1; i<=totalPages; i++) {
                const activeCls = i === this.currentPage ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100';
                html += `<button onclick="M00000.renderGridPaging(${i})" class="px-3 py-1 border rounded ${activeCls}">${i}</button>`;
            }
            pageArea.innerHTML = html;
        },

        downloadExcel() {
            if(!Array.isArray(this.currentData) || this.currentData.length === 0) {
                showError("다운로드할 데이터가 없습니다.");
                return;
            }
            if(window.DataEditingSystem) {
                window.DataEditingSystem.downloadCSV(this.currentData, '검색결과.csv');
            }
        }
    };

    window.initM00000Page = () => M00000.init();
    window.M00000 = M00000;
}