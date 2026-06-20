# Data Editing System

Oracle 기반 데이터 편집/규칙 발굴 업무를 위한 FastAPI + 정적 프론트엔드 프로젝트입니다. 백엔드는 Oracle DB와 SQL 파일을 통해 업무 API를 제공하고, 프론트엔드는 `frontend/index.html`에서 페이지 HTML/JS를 동적으로 로드합니다.

## 기술 스택

- Backend: Python, FastAPI, Uvicorn, python-oracledb
- Frontend: Vanilla JavaScript, HTML, CSS, Tailwind CSS, Font Awesome, Grid.js
- Database: Oracle, SQL 파일 기반 쿼리 로딩

## 주요 구조

```text
.
├─ main.py                         # FastAPI 앱 진입점, 라우터 등록, 정적 파일 서빙
├─ backend/
│  ├─ database.py                  # 시스템 DB 연결 풀
│  ├─ target_database.py           # 로그인 후 선택한 Target DB 연결
│  ├─ database_helper.py           # SQL 파일 로더 및 execute_query
│  ├─ auth_context.py              # 요청 헤더 기반 사용자 컨텍스트
│  ├─ routers/                     # 화면/API별 라우터
│  └─ services/                    # 공통 업무 서비스
├─ database/                       # SQL ID별 쿼리 파일
├─ frontend/
│  ├─ index.html                   # SPA 셸
│  ├─ config/menu.config.js        # 메뉴와 페이지 파일 등록
│  ├─ pages/                       # 화면 HTML
│  ├─ js/                          # 화면별 JS 및 공통 JS
│  └─ css/                         # 스타일/Tailwind 결과물
├─ requirements.txt
├─ package.json
└─ AGENTS.md                       # Codex 작업 가이드
```

## 실행 방법

Python 가상환경을 준비합니다.

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

필요한 환경 변수는 `.env`에 설정합니다. `.env`, `secreats/`, `instantclient/`는 비밀 정보 또는 로컬 의존성이므로 Git에 올리지 않습니다.

```text
DB_MODE=local 또는 cloud
DB_USER_LOC=...
DB_PASSWORD_LOC=...
DB_HOST=127.0.0.1
DB_PORT=1521
DB_SERVICE=...

DB_USER_CLD=...
DB_PASSWORD_CLD=...
DB_DSN_CLD=...
DB_WALLET_PATH=/etc/secrets
DB_ORACLE_MODE=thin

DB_POOL_MIN=1
DB_POOL_MAX=5
DB_POOL_INCREMENT=1

TARGET_DB_POOL_MIN=1
TARGET_DB_POOL_MAX=3
TARGET_DB_POOL_INCREMENT=1
```

개발 서버를 실행합니다.

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

브라우저에서 `http://127.0.0.1:8000`을 엽니다. API 문서는 `http://127.0.0.1:8000/docs`에서 확인할 수 있습니다.

Tailwind CSS를 수정할 때는 별도 터미널에서 빌드합니다.

```powershell
npx tailwindcss -i ./frontend/css/input.css -o ./frontend/css/output.css --watch
```

## 화면 추가 체크리스트

새 화면 코드가 `M12345`라고 가정합니다.

1. `backend/routers/M12345.py`를 만들고 `router = APIRouter()`를 정의합니다.
2. `main.py`에서 라우터를 import하고 `routers` 목록에 `(M12345.router, "M12345")`를 추가합니다.
3. `database/M12345.sql`에 `-- [M12345_...]` 형식으로 SQL ID를 작성합니다.
4. `frontend/pages/M12345.html`을 추가합니다.
5. `frontend/js/M12345.js`를 추가하고 `(function(){ ... window.M12345 = M12345; })();` 패턴을 사용합니다.
6. `frontend/config/menu.config.js`의 `MENU_CONFIG`, `PAGE_FILE_CONFIG.htmlPages`, `PAGE_FILE_CONFIG.scriptPages`에 화면 코드를 등록합니다.
7. API 호출은 `CommonUtils.request(`${API_BASE_URL}/M12345/...`)` 패턴을 사용합니다.

## SQL 작성 규칙

`backend.database_helper.SqlLoader`는 `database/*.sql` 파일을 읽고 `-- [SQL_ID]` 구분자를 기준으로 쿼리를 메모리에 로드합니다.

```sql
-- [M01001_PROJECT_LIST]
SELECT ...
  FROM ...
 WHERE (:keyword IS NULL OR ...)
```

- Python에서는 `execute_query(conn, "M01001_PROJECT_LIST", params)`처럼 SQL ID로 실행합니다.
- 바인드 변수는 `:camelCase` 또는 기존 파일의 관례에 맞춥니다.
- 테이블명/동적 SQL은 허용된 자리에서만 `dynamicTable`, `dynamicSql` 치환을 사용합니다.
- 사용자 입력으로 식별자나 SQL 조각을 만들 때는 라우터/서비스에서 검증 후 사용합니다.

## 요청 컨텍스트

프론트의 `CommonUtils.request`는 로그인/Target DB 정보를 헤더로 전달합니다.

- `X-Login-User-Id`
- `X-Login-Id`
- `X-Login-Email`
- `X-Login-Role-Code`
- `X-Target-Connection-Id`

업무 화면 라우터는 보통 `get_target_db_connection(request)`를 사용해 Target DB에 연결합니다. 시스템 설정/로그인/관리 기능은 필요에 따라 `get_db_connection()`으로 시스템 DB에 연결합니다.

## 주의사항

- 현재 일부 기존 파일의 한글 주석/문자열이 깨져 보일 수 있습니다. 기존 인코딩을 일괄 변환하지 말고, 수정 범위 안에서만 UTF-8로 정리합니다.
- `.env`, 지갑 파일, Oracle Instant Client, DB 접속 정보는 커밋하지 않습니다.
- 이 저장소에는 아직 표준 테스트 스크립트가 없습니다. 변경 후 최소한 `uvicorn main:app --reload`로 앱 기동과 `/api/health`를 확인합니다.
