// 공통 JavaScript 기능
const DataEditingSystem = {
  // 초기화
  init() {
    this.initNavigation();
    this.initDataTables();
    this.initEventListeners();
    this.loadUserSettings();
  },

  // 네비게이션 초기화
  initNavigation() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const menuLinks = document.querySelectorAll('.menu-link');
    
    menuLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage || (currentPage === 'index.html' && href === 'index.html')) {
        link.classList.add('active');
      }
    });

    // 서브메뉴 토글
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
      const link = item.querySelector('.menu-link');
      const submenu = item.querySelector('.submenu');
      
      if (submenu && link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          submenu.style.display = submenu.style.display === 'block' ? 'none' : 'block';
        });
      }
    });
  },

  // 데이터 테이블 초기화
  initDataTables() {
    // 테이블 정렬 기능
    const tables = document.querySelectorAll('.table');
    tables.forEach(table => {
      const headers = table.querySelectorAll('th');
      headers.forEach((header, index) => {
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => {
          this.sortTable(table, index);
        });
      });
    });
  },

  // 테이블 정렬
  sortTable(table, columnIndex) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    rows.sort((a, b) => {
      const aText = a.cells[columnIndex].textContent.trim();
      const bText = b.cells[columnIndex].textContent.trim();
      
      // 숫자 비교
      if (!isNaN(aText) && !isNaN(bText)) {
        return parseFloat(aText) - parseFloat(bText);
      }
      
      // 날짜 비교
      if (this.isValidDate(aText) && this.isValidDate(bText)) {
        return new Date(aText) - new Date(bText);
      }
      
      // 문자열 비교
      return aText.localeCompare(bText);
    });

    rows.forEach(row => tbody.appendChild(row));
  },

  // 날짜 유효성 검사
  isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
  },

  // 이벤트 리스너 초기화
  initEventListeners() {
    // 파일 업로드 버튼
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
      input.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files[0]);
      });
    });

    // 검색 기능
    const searchInputs = document.querySelectorAll('.search-input');
    searchInputs.forEach(input => {
      input.addEventListener('keyup', (e) => {
        this.filterTable(e.target);
      });
    });

    // 버튼 클릭 이벤트
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
      button.addEventListener('click', (e) => {
        if (button.classList.contains('btn-loading')) {
          this.showLoading(button);
        }
      });
    });
  },

  // 파일 업로드 처리
  handleFileUpload(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.displayDataPreview(data);
      } catch (error) {
        alert('JSON 파일 형식이 올바르지 않습니다.');
      }
    };
    reader.readAsText(file);
  },

  // 데이터 미리보기 표시
  displayDataPreview(data) {
    const preview = document.getElementById('data-preview');
    if (preview) {
      preview.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
      preview.style.display = 'block';
    }
  },

  // 테이블 필터링
  filterTable(searchInput) {
    const searchTerm = searchInput.value.toLowerCase();
    const table = searchInput.closest('.card').querySelector('.table');
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
  },

  // 로딩 상태 표시
  showLoading(element) {
    const originalText = element.innerHTML;
    element.innerHTML = '<span class="loading"></span> 처리 중...';
    element.disabled = true;

    // 3초 후 원래 상태로 복구 (실제로는 API 응답 후)
    setTimeout(() => {
      element.innerHTML = originalText;
      element.disabled = false;
    }, 3000);
  },

  // 사용자 설정 로드
  loadUserSettings() {
    const settings = localStorage.getItem('dataEditingSettings');
    if (settings) {
      this.userSettings = JSON.parse(settings);
    } else {
      this.userSettings = {
        theme: 'light',
        language: 'ko',
        autoSave: true,
        notifications: true
      };
    }
  },

  // 사용자 설정 저장
  saveUserSettings() {
    localStorage.setItem('dataEditingSettings', JSON.stringify(this.userSettings));
  },

  // 알림 표시
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  },

  // 데이터 검증
  validateData(data, rules) {
    const errors = [];
    
    rules.forEach(rule => {
      const value = data[rule.field];
      
      if (rule.required && (!value || value.toString().trim() === '')) {
        errors.push(`${rule.field} 필드는 필수입니다.`);
      }
      
      if (rule.type && value) {
        switch (rule.type) {
          case 'number':
            if (isNaN(value)) {
              errors.push(`${rule.field} 필드는 숫자여야 합니다.`);
            }
            break;
          case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
              errors.push(`${rule.field} 필드는 유효한 이메일이어야 합니다.`);
            }
            break;
          case 'date':
            if (!this.isValidDate(value)) {
              errors.push(`${rule.field} 필드는 유효한 날짜여야 합니다.`);
            }
            break;
        }
      }
    });
    
    return errors;
  },

  // CSV 다운로드
  downloadCSV(data, filename = 'data.csv') {
    const csv = this.convertToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  },

  // 데이터를 CSV로 변환
  convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header];
          return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
        }).join(',')
      )
    ].join('\n');
    
    return csvContent;
  },

  // 랜덤 데이터 생성 (테스트용)
  generateRandomData(count = 10) {
    const data = [];
    const names = ['김철수', '이영희', '박지민', '최민수', '정수진'];
    const departments = ['개발부', '영업부', '인사부', '기획부', '재무부'];
    
    for (let i = 0; i < count; i++) {
      data.push({
        id: i + 1,
        name: names[Math.floor(Math.random() * names.length)],
        department: departments[Math.floor(Math.random() * departments.length)],
        age: Math.floor(Math.random() * 30) + 25,
        salary: Math.floor(Math.random() * 5000) + 3000,
        joinDate: new Date(2020 + Math.floor(Math.random() * 4), 
                          Math.floor(Math.random() * 12), 
                          Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0]
      });
    }
    
    return data;
  }
};

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  DataEditingSystem.init();
});

// 글로벌 함수들 (페이지별에서 호출)
function showPage(pageName) {
  window.location.href = pageName;
}

function showLoading(message = '처리 중...') {
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading-overlay';
  loadingDiv.innerHTML = `
    <div class="loading-container">
      <div class="loading"></div>
      <p>${message}</p>
    </div>
  `;
  document.body.appendChild(loadingDiv);
}

function hideLoading() {
  const loadingDiv = document.querySelector('.loading-overlay');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

function showAlert(message, type = 'info') {
  DataEditingSystem.showNotification(message, type);
}

// 모달 관련 함수
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
  }
}

// 테이블 관련 함수
function toggleAllCheckboxes(source, checkboxClass) {
  const checkboxes = document.querySelectorAll(`.${checkboxClass}:not(:disabled)`);
  checkboxes.forEach(checkbox => {
    checkbox.checked = source.checked;
  });
}

function getSelectedIds(checkboxClass) {
  const checkboxes = document.querySelectorAll(`.${checkboxClass}:checked`);
  return Array.from(checkboxes).map(cb => cb.value);
}

// 날짜 포맷팅 함수
function formatDate(dateString, format = 'YYYY-MM-DD') {
  const date = new Date(dateString);
  if (isNaN(date)) return dateString;
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes);
}

// 숫자 포맷팅 함수
function formatNumber(number, decimals = 0) {
  if (isNaN(number)) return number;
  return Number(number).toLocaleString('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// 통화 포맷팅 함수
function formatCurrency(amount, currency = 'KRW') {
  if (isNaN(amount)) return amount;
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

// 퍼센트 계산 함수
function calculatePercentage(value, total, decimals = 1) {
  if (total === 0) return '0%';
  return ((value / total) * 100).toFixed(decimals) + '%';
}

// 랜덤 색상 생성
function getRandomColor() {
  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#6366F1', '#F97316'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// UUID 생성 함수
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 로컬 스토리지 관련 함수
function saveToLocalStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('로컬 스토리지 저장 실패:', error);
    return false;
  }
}

function getFromLocalStorage(key, defaultValue = null) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (error) {
    console.error('로컬 스토리지 읽기 실패:', error);
    return defaultValue;
  }
}

function removeFromLocalStorage(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error('로컬 스토리지 삭제 실패:', error);
    return false;
  }
}

// 세션 스토리지 관련 함수
function saveToSessionStorage(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('세션 스토리지 저장 실패:', error);
    return false;
  }
}

function getFromSessionStorage(key, defaultValue = null) {
  try {
    const data = sessionStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (error) {
    console.error('세션 스토리지 읽기 실패:', error);
    return defaultValue;
  }
}

// 쿠키 관련 함수
function setCookie(name, value, days = 7) {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) {
      return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// 브라우저 체크 함수
function getBrowserInfo() {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let version = 'Unknown';
  
  if (ua.indexOf('Chrome') > -1) {
    browser = 'Chrome';
    version = ua.match(/Chrome\/(\d+)/)[1];
  } else if (ua.indexOf('Firefox') > -1) {
    browser = 'Firefox';
    version = ua.match(/Firefox\/(\d+)/)[1];
  } else if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) {
    browser = 'Safari';
    version = ua.match(/Version\/(\d+)/)[1];
  } else if (ua.indexOf('Edge') > -1) {
    browser = 'Edge';
    version = ua.match(/Edge\/(\d+)/)[1];
  }
  
  return { browser, version };
}

// 디바이스 체크 함수
function getDeviceInfo() {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  
  return {
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua),
    isTablet: /iPad|Tablet/i.test(ua),
    isDesktop: !(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)),
    platform: platform
  };
}

// API 관련 함수 (테이블 API용)
async function fetchTableData(tableName, page = 1, limit = 10, search = '', sort = '') {
  try {
    const params = new URLSearchParams({
      page: page,
      limit: limit,
      ...(search && { search: search }),
      ...(sort && { sort: sort })
    });
    
    const response = await fetch(`tables/${tableName}?${params}`);
    if (!response.ok) throw new Error('데이터 로드 실패');
    
    return await response.json();
  } catch (error) {
    console.error('테이블 데이터 로드 오류:', error);
    return { data: [], total: 0, page: 1, limit: limit };
  }
}

async function createTableRecord(tableName, data) {
  try {
    const response = await fetch(`tables/${tableName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) throw new Error('데이터 생성 실패');
    return await response.json();
  } catch (error) {
    console.error('테이블 레코드 생성 오류:', error);
    throw error;
  }
}

async function updateTableRecord(tableName, recordId, data) {
  try {
    const response = await fetch(`tables/${tableName}/${recordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) throw new Error('데이터 업데이트 실패');
    return await response.json();
  } catch (error) {
    console.error('테이블 레코드 업데이트 오류:', error);
    throw error;
  }
}

async function deleteTableRecord(tableName, recordId) {
  try {
    const response = await fetch(`tables/${tableName}/${recordId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('데이터 삭제 실패');
    return true;
  } catch (error) {
    console.error('테이블 레코드 삭제 오류:', error);
    throw error;
  }
}