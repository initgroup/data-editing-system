# AGENTS.md

이 문서는 Codex가 이 저장소에서 작업할 때 따라야 할 프로젝트 전용 가이드입니다.

## 작업 원칙

- 사용자의 기존 변경사항을 되돌리지 않습니다. 현재 워킹트리는 변경/삭제/추가 파일이 많을 수 있으므로 작업 전 `git status --short`로 범위를 확인합니다.
- `.env`, `secreats/`, `instantclient/`, 지갑 ZIP, DB 비밀번호, API 키는 읽거나 출력하거나 커밋하지 않습니다.
- 새 문서/코드는 UTF-8로 작성합니다. 기존 파일에 깨진 한글이 있더라도 요청 범위 밖의 대량 인코딩 정리는 하지 않습니다.
- SQL과 DB DDL은 영향 범위가 크므로, 사용자가 명시하지 않은 스키마 변경이나 데이터 삭제를 실행하지 않습니다.
- 파일 검색은 `rg` 또는 `rg --files`를 우선 사용합니다.
- 모든 최종 답변 마지막에는 `Usage 확인: VS Code Codex 입력창에서 /status` 문구를 반드시 추가합니다.

## Windows UTF-8 / Codex 셸 주의

- Windows PowerShell 5.1에서는 파일이 정상 UTF-8이어도 `$OutputEncoding` 또는 콘솔 코드페이지 때문에 Codex 출력에서 한글이 깨져 보일 수 있습니다.
- 한글이 포함된 파일을 읽거나 검색할 때는 먼저 현재 명령 세그먼트에서 UTF-8 셸 가드를 적용합니다.
- 이 PC처럼 PowerShell 실행 정책이 `.ps1` 로드를 막을 수 있으므로, 스크립트를 쓸 때는 프로세스 범위에서만 우회합니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\codex-utf8.ps1
Get-Content -Encoding UTF8 frontend/js/app.js
```

- 스크립트 로드가 번거롭거나 실패하면 아래 inline 가드를 같은 명령 앞에 붙입니다.

```powershell
$utf8NoBom=[System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding=$utf8NoBom; [Console]::OutputEncoding=$utf8NoBom; $OutputEncoding=$utf8NoBom; chcp.com 65001 | Out-Null
Get-Content -Encoding UTF8 frontend/js/app.js
```

- `Get-Content`, `Select-String`, `rg`, `git diff` 출력에서 한글이 깨져 보이면 파일이 깨졌다고 단정하지 않습니다. UTF-8 셸 가드를 적용한 뒤 다시 확인합니다.
- VS Code에서 정상으로 보이는 한글 주석/라벨은 사용자가 요청하지 않는 한 수정하지 않습니다.
- 깨진 출력 내용을 그대로 `apply_patch`에 포함하지 않습니다. 화면에 노출되는 문자열을 고칠 때만 정확한 새 UTF-8 문자열로 좁게 교체합니다.

## 프로젝트 이해

- 앱 진입점은 `main.py`입니다.
- API 라우터는 `backend/routers/*.py`에 있으며 `main.py`의 `routers` 목록에 등록되어야 실제 `/api/{tag}` 경로가 열립니다.
- SQL은 `database/*.sql`에 있고 `-- [SQL_ID]` 섹션으로 구분됩니다.
- `backend/database_helper.py`의 `SqlLoader`가 서버 시작 시 SQL을 로드합니다.
- 프론트는 정적 파일 기반입니다. `frontend/index.html`이 셸이고, `frontend/js/app.js`의 `PageManager`가 `frontend/pages/{PAGE}.html`과 `frontend/js/{PAGE}.js`를 동적으로 로드합니다.
- 메뉴와 페이지 파일 등록은 `frontend/config/menu.config.js`에서 관리합니다.

## 개발 서버

```powershell
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Tailwind 결과물이 필요하면 다음 명령을 사용합니다.

```powershell
npx tailwindcss -i ./frontend/css/input.css -o ./frontend/css/output.css --watch
```

## 백엔드 패턴

라우터 기본 구조:

```python
from fastapi import APIRouter, HTTPException, Request

from backend.database_helper import execute_query, SqlLoader
from backend.target_database import get_target_db_connection
from backend.auth_context import get_request_user_id

router = APIRouter()
```

권장 흐름:

- 조회: `conn = get_target_db_connection(request)` 후 `execute_query(conn, "SQL_ID", params)`
- DML: 커서를 직접 쓰거나 `execute_query(..., is_dml=True)` 사용
- 라우터/서비스 Python 파일에 정적 SQL 문장을 직접 작성하지 않습니다. 정적 `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, PL/SQL block은 `database/*.sql`에 `-- [SQL_ID]` 섹션으로 분리하고 `SqlLoader.get_sql(...)` 또는 `execute_query(...)`로 실행합니다.
- 검증된 식별자, 동적 `IN` 바인드 목록, 사용자 SQL 워크시트의 읽기 전용 wrapper, 설치/DDL 스크립트 실행처럼 런타임 조립이 필요한 경우만 예외로 허용합니다. 이 경우에도 SQL 본문은 가능한 한 `.sql` 템플릿에 두고, Python에서는 화이트리스트/정규식 검증을 통과한 작은 조각만 치환합니다.
- 성공 응답: `{ "status": "success", "data": ..., "columns": ..., "total": ... }` 형태 유지
- 오류: `HTTPException`은 그대로 raise하고, 일반 예외는 로깅 후 `HTTPException(status_code=500, detail=str(e))`
- 커넥션/커서는 `finally`에서 닫습니다.
- 사용자 ID가 필요한 업무 데이터는 `get_request_user_id(request)`를 사용합니다.

## 프론트엔드 패턴

화면 JS는 IIFE와 전역 페이지 객체 패턴을 사용합니다.

```javascript
(function() {
    const PAGE_CODE = "M01001";
    const { getContainerEl } = PageManager.createHelper(PAGE_CODE);

    const M01001 = {
        async init() {},
        destroy() {}
    };

    window[PAGE_CODE] = M01001;
})();
```

가이드:

- DOM ID는 페이지 코드 suffix를 붙이는 기존 패턴을 따릅니다. 예: `projectName-M01001`
- API 호출은 `CommonUtils.request`를 사용합니다. 이 함수가 로그인/Target DB 헤더를 자동으로 붙입니다.
- 페이지 리소스 정리는 `destroy()`에 넣습니다.
- 화면 등록 시 `frontend/config/menu.config.js`의 `MENU_CONFIG`, `PAGE_FILE_CONFIG.htmlPages`, `PAGE_FILE_CONFIG.scriptPages`를 함께 수정합니다.
- `M02003`, `M02004`, `M03001`처럼 데이터 작업 공통 템플릿을 쓰는 화면은 `frontend/pages/MCOMMON_DATA_WORK.html`, `frontend/js/MCOMMON_DATA_WORK.js`, `backend/services/data_work_router.py` 패턴을 먼저 확인합니다.
- `M03100`처럼 FLOW 작업 공통 템플릿을 쓰는 화면은 `frontend/pages/MCOMMON_FLOW_WORK.html`, `frontend/js/MCOMMON_FLOW_WORK.js`, `backend/services/flow_work_router.py` 패턴을 먼저 확인합니다.

## 새 화면 추가 절차

1. 메뉴 코드와 업무 범위를 정합니다. 예: `M12345`.
2. `database/M12345.sql`에 필요한 SQL ID를 추가합니다.
3. `backend/routers/M12345.py`를 작성합니다.
4. `main.py`에 라우터 import와 `routers` 항목을 추가합니다.
5. `frontend/pages/M12345.html`과 `frontend/js/M12345.js`를 작성합니다.
6. `frontend/config/menu.config.js`에 메뉴와 파일 목록을 등록합니다.
7. 서버를 재시작하거나 reload 후 `/docs`, 화면 로딩, 주요 API 응답을 확인합니다.

## 검증 체크리스트

- `python -m compileall main.py backend`
- `uvicorn main:app --reload --host 127.0.0.1 --port 8000`
- `GET /api/health`
- 변경한 화면이 메뉴에서 열리는지 확인
- 저장/삭제/DML 변경은 트랜잭션과 rollback 경로 확인

## 금지/주의 작업

- 사용자 요청 없이 `git reset`, 대량 삭제, DB DROP/TRUNCATE 실행 금지
- 비밀 정보 출력 금지
- 기존 깨진 인코딩 파일 전체를 자동 변환 금지
- SQL 문자열에 사용자 입력을 직접 이어 붙이는 구현 금지
- 정적 SQL을 `backend/routers/*.py` 또는 `backend/services/*.py` 안에 삼중 문자열/일반 문자열로 새로 작성하는 작업 금지
- 등록되지 않은 화면 파일만 만들고 `main.py` 또는 `menu.config.js` 등록을 빠뜨리는 작업 금지
- 단순 오류 수정이나 작은 UI 정리는 필요하면 바로 처리할 수 있지만, 업무 흐름, 화면 단계, 버튼/메뉴 노출, 권한/인증 흐름처럼 사용자의 작업 방식이 달라지는 개선은 구현 전에 사용자에게 먼저 설명하고 확인을 받습니다.
- VS Code에서 정상으로 보이는 한글은 함부로 수정하지 않기
- Codex 출력에서 깨져 보인다고 바로 “파일이 깨졌다”고 판단하지 않기
- 한글 문자열을 수정해야 하면, 해당 줄만 명확히 새 UTF-8 문자열로 교체
- 가능하면 주석은 건드리지 않고, 사용자 화면에 보이는 문자열만 수정
- menu.config.js 같은 한글 라벨 파일은 특히 전체 rewrite를 피하고, 필요 시 아주 좁게 수정
